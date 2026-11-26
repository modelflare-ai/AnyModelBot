import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { groupPeer } from "../src/store/db.js";
import { listen, signIn } from "./helpers.js";

const require = createRequire(import.meta.url);
let chromium: any;
try { ({ chromium } = require("playwright")); }
catch { try { ({ chromium } = require(require.resolve("playwright-core", { paths: [path.join(import.meta.dirname, "../site")] }))); } catch { /* Browser QA is optional on minimal CI images. */ } }
const chrome = process.env.AMB_TEST_CHROME || chromium?.executablePath();
const browserAvailable = !!chromium && chrome && fs.existsSync(chrome);
let app: App, llm: Awaited<ReturnType<typeof listen>>, root: string, base: string, browser: any;
let oldId: number, recentId: number, externalId: number, groupId: string, groupReply: number, groupUser: number;
let heldReply: { finish: () => void; closed: boolean } | undefined;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "amb-search-e2e-"));
  llm = await listen(async (req, res) => {
    if (req.method !== "POST") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "mock-model", object: "model" }] }));
    for await (const _chunk of req) { /* Drain the local mock request. */ }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Still working" } }] })}\n\n`);
    const call = { closed: false, finish: () => res.end("data: [DONE]\n\n") };
    heldReply = call;
    res.on("close", () => { if (!res.writableEnded) call.closed = true; });
  });
  app = new App(loadConfig({ dataDir: root, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "test-key", AMB_UI_PORT: "0", AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } }), { printQrToTerminal: false });
  await app.start();
  base = app.web!.url.replace(/\/$/, "");
  app.store.db.exec("BEGIN");
  app.store.createBot({ id: "film", name: "Film Studio" });
  app.store.createBot({ id: "research", name: "Research" });
  const conv = app.store.ensureConversation("film", "web", "console").id;
  oldId = app.store.addMessage(conv, "user", 'Old storyboard 分镜 <img src=x onerror="window.injected=1">');
  app.store.db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(Date.now() - 3 * 86400000, oldId);
  for (let i = 0; i < 260; i++) app.store.addMessage(conv, "assistant", `Paging fixture ${i}: a regular conversation message with enough text to read.`);
  recentId = app.store.addMessage(conv, "assistant", "Recent storyboard 分镜 [draft] a+b 100%_done.");
  const external = app.store.ensureConversation("research", "feishu", "team", "Planning team").id;
  externalId = app.store.addMessage(external, "user", "External discussion 分镜");
  const group = app.store.createGroup("Production group", ["film", "research"]);
  groupId = group.id;
  groupUser = app.store.addMessage(groupPeer(groupId), "user", "Group user 分镜");
  const gc = app.store.ensureConversation("film", "web", groupPeer(groupId), "", "group").id;
  app.store.addMessage(gc, "user", "Group user 分镜 hidden duplicate");
  groupReply = app.store.addMessage(gc, "assistant", "Group assistant 分镜");
  app.store.db.exec("COMMIT");
  if (browserAvailable) browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});
afterAll(async () => { heldReply?.finish(); await browser?.close(); await app?.stop(); await llm?.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe("chat search API", () => {
  it("returns full-history hits, channel filters and message context", async () => {
    const all = await (await fetch(`${base}/amb/api/messages/search?q=${encodeURIComponent("分镜")}`)).json();
    expect(all.total).toBe(5);
    expect(all.results.some((r: any) => r.id === oldId)).toBe(true);
    const ext = await (await fetch(`${base}/amb/api/messages/search?q=${encodeURIComponent("分镜")}&channel=feishu`)).json();
    expect(ext.results.map((r: any) => r.id)).toEqual([externalId]);
    const scopes = await (await fetch(`${base}/amb/api/messages/scopes`)).json();
    expect(scopes.conversations).toContainEqual(expect.objectContaining({ id: "research:feishu:team", title: "Planning team", lastMessageId: externalId }));
    const context = await (await fetch(`${base}/amb/api/messages/${groupUser}/context`)).json();
    expect(context.target.groupId).toBe(groupId);
    expect(context.messages.map((m: any) => m.id)).toEqual([groupUser, groupReply]);
  });
  it("lists recent conversations: one row per timeline, newest first, group copies hidden", async () => {
    const recent = await (await fetch(`${base}/amb/api/messages/recent`)).json();
    // 群聊（成员的回复存在各自会话里）合成一行、取最新那条；成员会话里复制进去的用户消息不出现
    expect(recent.conversations.map((r: any) => r.id)).toEqual([groupReply, externalId, recentId]);
    expect(recent.conversations[0]).toMatchObject({ groupId, groupName: "Production group", role: "assistant" });
    expect(recent.conversations[1]).toMatchObject({ conversationId: "research:feishu:team", channel: "feishu", title: "Planning team" });
    expect(recent.conversations[2]).toMatchObject({ botId: "film", conversationId: "film:web:console", channel: "web" });
    expect(JSON.stringify(recent)).not.toContain("hidden duplicate");
    const one = await (await fetch(`${base}/amb/api/messages/recent?limit=1`)).json();
    expect(one.conversations.map((r: any) => r.id)).toEqual([groupReply]);
    expect((await fetch(`${base}/amb/api/messages/recent?limit=-1`)).status).toBe(400);
  });
  it("rejects malformed requests and nonexistent messages", async () => {
    expect((await fetch(`${base}/amb/api/messages/search?q=x&limit=100000`)).status).toBe(400);
    expect((await fetch(`${base}/amb/api/messages/search?q=x&cursor=broken`)).status).toBe(400);
    expect((await fetch(`${base}/amb/api/messages/${oldId}/context?before=-2`)).status).toBe(400);
    expect((await fetch(`${base}/amb/api/messages/999999999/context`)).status).toBe(404);
  });
});

describe.skipIf(!browserAvailable)("chat search UI", () => {
  const pageFor = async (width = 1200, lang = "zh-CN", theme = "light") => {
    const page = await browser.newPage({ viewport: { width, height: 820 }, locale: lang, colorScheme: theme });
    await signIn(page, base);
    page.setDefaultTimeout(5000);
    page.on("pageerror", (e: Error) => console.error("Search browser error:", e.message));
    await page.route("**/amb/api/settings", async (route: any) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      await route.fulfill({ json: { ...await response.json(), lang } });
    });
    await page.goto(`${base}/#/chat/film`);
    await page.locator('[data-screen="chat"] .composer textarea').waitFor();
    await page.locator(`[data-message-id="${recentId}"]`).waitFor();
    await page.waitForFunction((l: string) => document.documentElement.lang === l, lang);
    return page;
  };

  it("opens global search, locates an old message, and preserves draft and search state", async () => {
    const page = await pageFor();
    const errors: string[] = []; page.on("pageerror", (e: Error) => errors.push(e.message));
    const draft = page.locator('[data-screen="chat"] .composer textarea');
    await draft.fill("An unsent draft");
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    await results.getByRole("searchbox").fill("分镜");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 5);
    expect(await results.locator("mark").count()).toBeGreaterThanOrEqual(5);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await results.getByRole("button", { name: /Old storyboard/ }).click();
    await page.locator(`[data-message-id="${oldId}"]`).waitFor();
    expect(await draft.inputValue()).toBe("An unsent draft");
    expect(await page.locator(`[data-message-id="${oldId}"]`).evaluate((el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })).toBe(true);
    await page.getByRole("button", { name: "返回搜索结果", exact: true }).click();
    expect(await results.getByRole("searchbox").inputValue()).toBe("分镜");
    expect(await results.locator(".search-result").count()).toBe(5);
    await page.keyboard.press("Escape");
    await results.waitFor({ state: "hidden" });
    expect(await results.isVisible()).toBe(false);
    expect(await draft.inputValue()).toBe("An unsent draft");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("finds all messages inside a chat and navigates into unloaded history", async () => {
    const page = await pageFor();
    await page.keyboard.press("Control+f");
    const find = page.locator(".conversation-find:visible");
    await find.getByRole("searchbox").fill("分镜");
    await find.getByText("第 1 / 2 条", { exact: true }).waitFor();
    await find.getByRole("button", { name: "下一条匹配消息" }).click();
    await page.locator(`[data-message-id="${oldId}"]`).waitFor();
    expect(await find.locator(".find-count").innerText()).toBe("第 2 / 2 条");
    await page.keyboard.press("Escape");
    expect(await find.isVisible()).toBe(false);
    await page.getByRole("button", { name: "回到最新消息", exact: true }).click();
    await page.locator(`[data-message-id="${recentId}"]`).waitFor();
    await page.close();
  });

  it("filters channels and groups and opens the correct original timeline", async () => {
    const page = await pageFor();
    // 侧栏的搜索入口是个按钮，打开搜索弹窗
    await page.getByRole("button", { name: "搜索聊天记录", exact: true }).click();
    const results = page.getByRole("dialog", { name: "搜索聊天记录", exact: true });
    await results.getByRole("searchbox").fill("分镜");
    await results.getByRole("button", { name: "筛选", exact: true }).click();
    await results.getByLabel("聊天渠道", { exact: true }).selectOption("feishu");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 1);
    await results.getByLabel("机器人或会话", { exact: true }).selectOption("conversation:research:feishu:team");
    await results.getByRole("button", { name: /External discussion/ }).click();
    await page.locator(`[data-screen="conversation-history"] [data-message-id="${externalId}"]`).waitFor();
    await page.getByRole("button", { name: "返回搜索结果", exact: true }).click();
    await results.getByRole("button", { name: "清除筛选", exact: true }).click();
    await results.getByLabel("机器人或会话", { exact: true }).selectOption(`group:${groupId}`);
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 2);
    await results.getByRole("button", { name: /Group user/ }).click();
    await page.locator(`[data-screen="group"] [data-message-id="${groupUser}"]`).waitFor();
    expect(await page.locator(`[data-screen="group"] [data-message-id="${groupReply}"]`).count()).toBe(1);
    await page.close();
  });

  it("paginates results and preserves the result scroll position", async () => {
    const page = await pageFor();
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    await results.getByRole("searchbox").fill("Paging fixture");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 40);
    await results.getByRole("button", { name: "加载更多结果", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 80);
    await results.locator(".search-result").nth(60).scrollIntoViewIfNeeded();
    const top = await results.locator(".search-results").evaluate((el: HTMLElement) => el.scrollTop);
    await results.locator(".search-result").nth(60).click();
    await page.getByRole("button", { name: "返回搜索结果", exact: true }).click();
    const restored = await results.locator(".search-results").evaluate((el: HTMLElement) => el.scrollTop);
    expect(Math.abs(restored - top)).toBeLessThan(4);
    await page.close();
  });

  it("keeps the original chat scroll and draft when search closes without a jump", async () => {
    const page = await pageFor();
    const draft = page.locator('[data-screen="chat"] .composer textarea');
    await draft.fill("Keep this draft too");
    const scroll = page.locator('[data-screen="chat"] .chat-scroll');
    const top = await scroll.evaluate((el: HTMLElement) => { el.scrollTop = 1200; el.dispatchEvent(new Event("scroll")); return el.scrollTop; });
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    await results.getByRole("searchbox").fill("分镜");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 5);
    await page.keyboard.press("Escape");
    await results.waitFor({ state: "hidden" });
    expect(await draft.inputValue()).toBe("Keep this draft too");
    expect(Math.abs(await scroll.evaluate((el: HTMLElement) => el.scrollTop) - top)).toBeLessThan(4);
    await page.close();
  });

  it("filters recent days and a custom inclusive date range", async () => {
    const page = await pageFor();
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    await results.getByRole("searchbox").fill("分镜");
    await results.getByRole("button", { name: "筛选", exact: true }).click();
    await results.getByLabel("时间范围", { exact: true }).selectOption("today");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 4);
    await results.getByLabel("时间范围", { exact: true }).selectOption("custom");
    const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await results.getByLabel("开始日期", { exact: true }).fill(day);
    await results.getByLabel("结束日期", { exact: true }).fill(day);
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 1);
    expect(await results.locator(".search-result").innerText()).toContain("Old storyboard");
    await page.close();
  });

  it("opens as a dialog over the chat and lists recent conversations before typing", async () => {
    const page = await pageFor();
    await page.keyboard.press("Control+Shift+f");
    const dialog = page.getByRole("dialog", { name: "搜索聊天记录", exact: true });
    await dialog.waitFor({ state: "visible" });
    // 弹窗不占用页面：后面的聊天还在
    expect(await page.locator('[data-screen="chat"]').isVisible()).toBe(true);
    expect(await dialog.evaluate((el: HTMLElement) => el.getBoundingClientRect().width)).toBeLessThan(720);
    // 没输入：按天分组的最近对话，群聊和渠道会话各占一行，最新的在前
    await dialog.locator(".search-recent-row").first().waitFor();
    const rows = await dialog.locator(".search-recent-row .search-recent-name").allInnerTexts();
    expect(rows).toContain("Production group");
    expect(rows.some((r: string) => r.startsWith("Planning team"))).toBe(true);
    expect(new Set(rows).size).toBe(rows.length);
    expect(await dialog.locator(".search-recent-day").first().innerText()).toBe("今天");
    if (process.env.AMB_SEARCH_SCREENSHOTS) {
      fs.mkdirSync(process.env.AMB_SEARCH_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AMB_SEARCH_SCREENSHOTS, "recent.png") });
    }
    // 回车打开第一行；渠道会话打开历史记录
    await dialog.getByRole("button", { name: /Planning team/ }).click();
    await page.locator(`[data-screen="conversation-history"] [data-message-id="${externalId}"]`).waitFor();
    await dialog.waitFor({ state: "hidden" });
    // 再打开，键盘选群聊打开群
    await page.keyboard.press("Control+Shift+f");
    await dialog.getByRole("button", { name: /Production group/ }).click();
    await page.locator('[data-screen="group"]').waitFor();
    await page.close();
  });

  it("keeps the command palette and exposes search as a command", async () => {
    const page = await pageFor();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
    await palette.getByRole("textbox").fill("搜索聊天记录");
    await page.keyboard.press("Enter");
    await page.locator('[data-screen="message-search"]').waitFor({ state: "visible" });
    await palette.waitFor({ state: "hidden" });
    await page.close();
  });

  it("does not stop an ongoing reply when opening and closing search", async () => {
    const page = await pageFor();
    const stops: string[] = [];
    page.on("request", (req: any) => { if (req.url().endsWith("/stop")) stops.push(req.url()); });
    await page.locator('[data-screen="chat"] .composer textarea').fill("Keep working while I search");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator(".msg-row.live").getByText("Still working", { exact: true }).waitFor();
    await page.keyboard.press("Control+Shift+f");
    await page.locator('[data-screen="message-search"]').waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator('[data-screen="message-search"]').waitFor({ state: "hidden" });
    expect(stops).toEqual([]);
    expect(heldReply?.closed).toBe(false);
    expect(await page.locator(".msg-row.live").isVisible()).toBe(true);
    heldReply!.finish();
    await page.locator(".msg-row.live").waitFor({ state: "hidden" });
    await page.close();
  });

  it("highlights punctuation as literal text, not a regular expression", async () => {
    const page = await pageFor();
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    for (const query of ["[draft]", "a+b", "100%_done"]) {
      await results.getByRole("searchbox").fill(query);
      await page.waitForFunction((q: string) => document.querySelectorAll(".search-result").length === 1 && document.querySelector(".search-result mark")?.textContent === q, query);
      expect(await results.locator(".search-result mark").allTextContents()).toEqual([query]);
    }
    await page.close();
  });

  it("uses the full phone width and exposes filters from the top bar", async () => {
    const page = await pageFor(390);
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    await results.getByRole("searchbox").fill("分镜");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 5);
    expect(await results.evaluate((el: HTMLElement) => el.getBoundingClientRect().width)).toBeGreaterThan(350);
    await results.getByRole("button", { name: "筛选", exact: true }).click();
    await results.getByLabel("聊天渠道", { exact: true }).selectOption("feishu");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.AMB_SEARCH_SCREENSHOTS) {
      fs.mkdirSync(process.env.AMB_SEARCH_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AMB_SEARCH_SCREENSHOTS, "mobile.png") });
    }
    await page.close();
  });

  it.each(["zh-CN", "zh-TW", "en", "ja", "ko", "ru", "es", "pt", "tr"])("renders %s search with working filters", async (lang) => {
    const page = await pageFor(1200, lang, lang === "en" ? "dark" : "light");
    await page.keyboard.press("Control+Shift+f");
    const results = page.locator('[data-screen="message-search"]');
    await results.getByRole("searchbox").fill("分镜");
    await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 5);
    expect(await page.locator("html").getAttribute("lang")).toBe(lang);
    if (lang === "zh-TW") expect(await results.getAttribute("aria-label")).toBe("搜尋聊天記錄");
    expect(await results.innerText()).not.toContain("search.");
    expect(await results.locator("select").count()).toBe(3);
    if (process.env.AMB_SEARCH_SCREENSHOTS && (lang === "zh-CN" || lang === "en")) {
      fs.mkdirSync(process.env.AMB_SEARCH_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AMB_SEARCH_SCREENSHOTS, lang === "en" ? "dark.png" : "light.png") });
    }
    await page.close();
  });
});
