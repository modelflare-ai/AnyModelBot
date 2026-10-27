/**
 * 离线端到端：mock OpenAI（流式）+ mock iLink + 假飞书传输层 + 真实 App/Web 服务（外部模型端点模式）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { FakeFeishu, feishuEvent, mockIlink, mockOpenAI, until } from "./helpers.js";

let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let ilink: Awaited<ReturnType<typeof mockIlink>>;
let app: App;
let base: string;
let dataDir: string;
const feishu = new FakeFeishu();

async function api(p: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + "/amb/api" + p, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  llm = await mockOpenAI({ key: "gw-key" });
  ilink = await mockIlink();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-e2e-"));
  const config = loadConfig({
    dataDir,
    env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_FEISHU_THROTTLE_MS: "30", AMB_AGENT: "off" },
  });
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret_test";
  app = new App(config, { feishuTransport: () => feishu, weixinPollTimeoutMs: 2000, printQrToTerminal: false });
  await app.start();
  base = app.web!.url.replace(/\/$/, "");
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
});

afterAll(async () => {
  await app?.stop();
  await llm?.close();
  await ilink?.close();
});

describe("飞书 E2E", () => {
  it("单聊：快速 ack + 流式卡片 + 历史持久化", async () => {
    const ev = feishuEvent("你好");
    const t0 = Date.now();
    feishu.onMessage!(ev);
    expect(Date.now() - t0).toBeLessThan(50); // 同步返回（3 秒规则）
    await app.channels.get("default")!.feishu!.idle();
    const cardId = [...feishu.cards.keys()].at(-1)!;
    expect(feishu.cards.get(cardId)).toBe("[mock-a] 你说：你好");
    expect(feishu.finished.has(cardId)).toBe(true);
    expect(feishu.calls.find((c) => c.op === "reply")?.args[0]).toBe(ev.messageId);
    expect(llm.calls.at(-1)!.auth).toBe("Bearer gw-key");
    expect(llm.calls.at(-1)!.messages[0].role).toBe("system");
  });
  it("重复 message_id 去重；群聊忽略", async () => {
    const before = llm.calls.length;
    const ev = feishuEvent("一次", { messageId: "om_dup" });
    feishu.onMessage!(ev);
    feishu.onMessage!(ev);
    feishu.onMessage!(feishuEvent("群里", { chatType: "group" }));
    await app.channels.get("default")!.feishu!.idle();
    expect(llm.calls.length - before).toBe(1);
  });
  it("多轮上下文 + /model 列表与切换（按会话）", async () => {
    const ch = app.channels.get("default")!.feishu!;
    feishu.onMessage!(feishuEvent("/model", { chatId: "oc_m" }));
    await ch.idle();
    expect(feishu.texts.at(-1)).toMatch(/1\. mock-a[\s\S]*2\. mock-b/);
    feishu.onMessage!(feishuEvent("/model 2", { chatId: "oc_m" }));
    await ch.idle();
    expect(feishu.texts.at(-1)).toContain("mock-b");
    feishu.onMessage!(feishuEvent("第一句", { chatId: "oc_m" }));
    feishu.onMessage!(feishuEvent("第二句", { chatId: "oc_m" }));
    await ch.idle();
    const last = llm.calls.at(-1)!;
    expect(last.model).toBe("mock-b");
    expect(last.messages.map((m: any) => m.content)).toEqual(expect.arrayContaining(["第一句", "[mock-b] 你说：第一句", "第二句"]));
    // 其他会话不受影响
    feishu.onMessage!(feishuEvent("别处", { chatId: "oc_other" }));
    await ch.idle();
    expect(llm.calls.at(-1)!.model).toBe("mock-a");
    feishu.onMessage!(feishuEvent("/reset", { chatId: "oc_m" }));
    await ch.idle();
    feishu.onMessage!(feishuEvent("新开始", { chatId: "oc_m" }));
    await ch.idle();
    expect(llm.calls.at(-1)!.messages.filter((m: any) => m.role !== "system")).toHaveLength(1);
  });
});

describe("微信 E2E", () => {
  it("界面扫码登录 → 长轮询收消息 → 输入状态 → 一次性回复", async () => {
    const st0 = await api("/bots/default/channels");
    expect(st0.json.weixin.state).toBe("login_required");
    const start = await api("/bots/default/weixin/login", { method: "POST", body: {} });
    expect(start.status).toBe(200);
    expect(start.json.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    await until(async () => (await api("/bots/default/channels")).json.weixin.state === "connected", 8000);
    expect(fs.existsSync(path.join(dataDir, "weixin", "default-login-qr.png"))).toBe(true);
    const acct = app.store.getWeixinAccount("default")!;
    expect(acct.ilinkBotId).toBe("bot@im.bot");

    ilink.push("alice@im.wechat", "**你好** 微信");
    await until(() => ilink.state.sent.length >= 1, 8000);
    expect(ilink.state.sent[0]).toMatchObject({ to: "alice@im.wechat", contextToken: "ctx-1" });
    expect(ilink.state.sent[0].text).toContain("你好");
    expect(ilink.state.typing).toContain(1);
    await until(() => ilink.state.typing.includes(2));
    expect(ilink.state.authSeen).toContain("Bearer tok-secret-123");
    const st = await api("/bots/default/channels");
    expect(st.json.weixin.quota[0]).toMatchObject({ userId: "alice@im.wechat", remaining: 9 });
    expect(app.store.getWeixinAccount("default")!.cursor).toMatch(/^cur-/);
  });
  it("超长回复按 4000 切分并受配额约束", async () => {
    const big = "段落".repeat(2600) + "\n\n" + "尾".repeat(3000); // ~8200 字
    const prev = ilink.state.sent.length;
    const orig = llm.calls.length;
    (globalThis as any).__bigReply = big;
    // 通过 /model 之外的方式定制回复：直接替换 runtime 的模型调用
    const models = (app.runtime as any).opts.models;
    const saved = models.streamChat.bind(models);
    models.streamChat = async (_req: unknown, onDelta: (d: string) => void) => { onDelta(big); return big; };
    ilink.push("bob@im.wechat", "长文");
    await until(() => ilink.state.sent.length >= prev + 3, 8000);
    models.streamChat = saved;
    const chunks = ilink.state.sent.slice(prev).filter((s) => s.to === "bob@im.wechat");
    expect(chunks.every((c) => c.text.length <= 4000)).toBe(true);
    expect(chunks.map((c) => c.text).join("").length).toBeGreaterThanOrEqual(big.length - 10);
    expect(llm.calls.length).toBe(orig);
  });
  it("会话过期 -14 → 暂停并提示重新扫码", async () => {
    ilink.state.expireNext = true;
    await until(async () => (await api("/bots/default/channels")).json.weixin.state === "expired", 8000);
    expect(app.store.getWeixinAccount("default")!.pausedUntil).toBeGreaterThan(Date.now());
    const s = await api("/status");
    expect(s.json.notices.some((n: any) => n.text.includes("重新扫码"))).toBe(true);
  });
});

describe("Web 界面 / API", () => {
  it("页面与前端依赖可加载", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("importmap");
    for (const p of ["/amb/vendor/preact.mjs", "/amb/vendor/hooks.mjs", "/amb/vendor/htm.mjs", "/amb/static/app.js", "/amb/static/style.css"]) {
      expect((await fetch(base + p)).status, p).toBe(200);
    }
  });
  it("机器人 CRUD + 飞书凭据（secret 不回显）+ 测试对话", async () => {
    const c = await api("/bots", { method: "POST", body: { name: "测试机器人", systemPrompt: "你是测试", defaultModel: "mock-b" } });
    expect(c.status).toBe(201);
    const id = c.json.bot.id;
    const f = await api(`/bots/${id}/feishu`, { method: "PUT", body: { appId: "cli_x", appSecret: "very-secret-value" } });
    expect(f.status).toBe(200);
    const g = await api(`/bots/${id}`);
    expect(JSON.stringify(g.json)).not.toContain("very-secret-value");
    expect(g.json.bot.feishuAppSecretMasked).toBe("****alue");
    const chat = await api(`/bots/${id}/chat`, { method: "POST", body: { text: "hi" } });
    expect(chat.json.reply).toBe("[mock-b] 你说：hi");
    const convs = await api(`/conversations?bot=${id}`);
    expect(convs.json.conversations[0].channel).toBe("web");
    const msgs = await api(`/conversations/${encodeURIComponent(convs.json.conversations[0].id)}/messages`);
    expect(msgs.json.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect((await api(`/bots/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/bots/${id}`)).status).toBe(404);
  });
  it("安全：错误 Host 拒绝、非 JSON 写请求拒绝、外部模式下 /magpie 503", async () => {
    const http = await import("node:http");
    const port = new URL(base).port;
    const status = await new Promise<number>((r) => http.get({ host: "127.0.0.1", port, path: "/amb/api/status", headers: { host: "evil.example:80" } }, (res) => r(res.statusCode!)));
    expect(status).toBe(421);
    const form = await fetch(base + "/amb/api/bots", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(form.status).toBe(415);
    expect((await fetch(base + "/magpie/")).status).toBe(503);
  });
  it("日志与数据库外文件中不含明文密钥", () => {
    const files = fs.readdirSync(dataDir, { recursive: true }).map(String).filter((f) => !f.endsWith(".db") && !f.includes(".db-") && !f.endsWith(".png"));
    for (const f of files) {
      const p = path.join(dataDir, f);
      if (fs.statSync(p).isFile()) expect(fs.readFileSync(p, "utf8")).not.toContain("tok-secret-123");
    }
  });
});
