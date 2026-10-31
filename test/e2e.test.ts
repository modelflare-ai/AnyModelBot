/**
 * 离线端到端：mock OpenAI（流式）+ mock iLink + 假飞书传输层 + 真实 App/Web 服务（外部模型端点模式）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
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
    env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_WEIXIN_CDN_BASE: ilink.cdnBase, AMB_FEISHU_THROTTLE_MS: "30", AMB_AGENT: "off" },
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
  // 只有主人和允许名单里的人能用（准入见 access-outbox.e2e.test.ts）：这里的单聊都先放进允许名单
  beforeAll(() => {
    for (const chat of ["oc_chat1", "oc_m", "oc_other"]) app.access.allow("default", "feishu", chat, "test");
  });
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
    expect(acct.ownerUserId).toBe("owner@im.wechat");
    // 扫码的是 owner@im.wechat；下面这些人先放进允许名单（准入见 access-outbox.e2e.test.ts）
    for (const u of ["alice@im.wechat", "bob@im.wechat", "carol@im.wechat", "dave@im.wechat"]) app.access.allow("default", "weixin", u, "test");

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
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  it("收图片/文件：CDN 下载解密；能看图的模型收到图片本身，其余模型只收到标注；下载失败照常回复", async () => {
    const conv = app.store.ensureConversation("default", "weixin", "carol@im.wechat", "carol@im.wechat", "dm");
    app.store.setConversationModel(conv.id, "gpt-5.4");
    let prev = llm.calls.length;
    const img = ilink.imageItem(png);
    ilink.pushItems("carol@im.wechat", [{ type: 1, text_item: { text: "这是什么？" } }, img]);
    await until(() => llm.calls.length > prev, 8000);
    expect(ilink.state.cdnDownloads).toContain(img.image_item.media.encrypt_query_param);
    let call = llm.calls.at(-1)!;
    expect(call.model).toBe("gpt-5.4");
    expect(call.messages.at(-1).content).toEqual([
      { type: "text", text: "这是什么？\n[图片]" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
    ]);
    await until(() => ilink.state.sent.some((s) => s.to === "carol@im.wechat"), 8000);

    // 纯文字模型（mock-a）：只有标注，不发图片
    prev = llm.calls.length;
    ilink.pushItems("dave@im.wechat", [ilink.imageItem(png), ilink.fileItem(Buffer.from("hi"), "notes.txt")]);
    await until(() => llm.calls.length > prev, 8000);
    expect(llm.calls.at(-1)!.messages.at(-1).content).toBe("[图片]\n[文件 notes.txt]");

    prev = llm.calls.length;
    ilink.pushItems("dave@im.wechat", [{ type: 2, image_item: { media: { encrypt_query_param: "gone" } } }]);
    await until(() => llm.calls.length > prev, 8000);
    expect(llm.calls.at(-1)!.messages.at(-1).content).toBe("[图片（未能下载：CDN 下载失败 HTTP 400 invalid encrypted_param）]");
    await app.channels.get("default")!.weixin!.idle();
  });
  it("发图片：getuploadurl → 加密上传 CDN → 图片消息；收件方按消息里的引用和密钥能取回原图", async () => {
    const f = path.join(dataDir, "out.png");
    fs.writeFileSync(f, png);
    const client = (app.channels.get("default")!.weixin as any).client;
    const before = ilink.state.sent.length;
    await client.sendMedia("alice@im.wechat", f, "ctx-1");
    const s = ilink.state.sent.at(-1)!;
    expect(ilink.state.sent.length).toBe(before + 1);
    expect(s).toMatchObject({ to: "alice@im.wechat", contextToken: "ctx-1", item: { type: 2, image_item: { mid_size: 80, media: { encrypt_type: 1 } } } });
    const got = await client.downloadMedia(s.item);
    expect(got.data.equals(png)).toBe(true);
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
    // index.html 里引用的每一个样式与脚本、以及脚本之间的相对 import 都能取到
    const refs = [...html.matchAll(/(?:href|src)="(\/amb\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs).toContain("/amb/static/main.js");
    const seen = new Set<string>();
    const queue = [...refs, "/amb/vendor/preact.mjs", "/amb/vendor/hooks.mjs", "/amb/vendor/htm.mjs"];
    while (queue.length) {
      const p = queue.shift()!;
      if (seen.has(p)) continue;
      seen.add(p);
      const r = await fetch(base + p);
      expect(r.status, p).toBe(200);
      if (p.startsWith("/amb/static/") && p.endsWith(".js")) {
        const src = await r.text();
        for (const m of src.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) queue.push(new URL(m[1], "http://x" + p).pathname);
      }
    }
    expect(seen.size).toBeGreaterThan(15);
  });
  it("机器人 CRUD + 飞书凭据（secret 不回显）+ 测试对话", async () => {
    const c = await api("/bots", { method: "POST", body: { name: "测试机器人", systemPrompt: "你是测试", defaultModel: "mock-b", avatar: "red" } });
    expect(c.status).toBe(201);
    const id = c.json.bot.id;
    // 头像角色：创建时带上，设置里可以改，未知值被忽略
    expect(c.json.bot.settings.avatar).toBe("red");
    expect((await api(`/bots/${id}/settings`, { method: "PUT", body: { avatar: "purple" } })).json.settings.avatar).toBe("purple");
    expect((await api(`/bots/${id}/settings`, { method: "PUT", body: { avatar: "pink" } })).json.settings.avatar).toBe("");
    // 暂停后台工作：经任务服务改，机器人详情里带着（信息面板据此显示那一行）
    expect((await api(`/bots/${id}/settings`, { method: "PUT", body: { paused: true } })).json.settings).toMatchObject({ paused: true, avatar: "" });
    expect((await api(`/bots/${id}`)).json.bot.settings.paused).toBe(true);
    expect((await api(`/bots/${id}/settings`, { method: "PUT", body: { paused: false } })).json.settings.paused).toBe(false);
    expect((await api("/bots/default")).json.bot.settings.avatar).toBe("blue");
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
  it("安全：错误 Host 拒绝、非 JSON 写请求拒绝、不再反代内置网关（/magpie、/v1 均 404）", async () => {
    const http = await import("node:http");
    const port = new URL(base).port;
    const status = await new Promise<number>((r) => http.get({ host: "127.0.0.1", port, path: "/amb/api/status", headers: { host: "evil.example:80" } }, (res) => r(res.statusCode!)));
    expect(status).toBe(421);
    const form = await fetch(base + "/amb/api/bots", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(form.status).toBe(415);
    for (const p of ["/magpie/", "/v1/models", "/api/providers"]) expect((await fetch(base + p)).status, p).toBe(404);
    expect((await api("/providers", { method: "POST", body: { preset: "deepseek", apiKey: "x" } })).status).toBe(404);
  });
  it("状态：版本号来自 package.json，不暴露网关端口与二进制路径", async () => {
    const st = await api("/status");
    expect(st.json.version).toBe(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
    expect(st.json.gateway).toEqual({ mode: "external", state: "external" });
    expect(JSON.stringify(st.json)).not.toMatch(/gatewayPort|webPort|binary/);
  });
  it("Modelflare：外部端点模式视为已连接，不能在界面里连接/断开", async () => {
    const mf = await api("/modelflare");
    expect(mf.json).toMatchObject({ mode: "external", connected: true });
    expect((await api("/modelflare", { method: "PUT", body: { apiKey: "k" } })).status).toBe(409);
    expect((await api("/modelflare", { method: "DELETE" })).status).toBe(409);
  });
  it("设置：改动即保存到 config.json；非法值拒绝；桌面专属项在浏览器模式下不可改", async () => {
    const s = await api("/settings");
    expect(s.json).toMatchObject({ closeToTray: true, zoom: 1, desktop: false, autostart: { supported: false } });
    const r = await api("/settings", { method: "PUT", body: { defaultModel: "mock-b", closeToTray: false, zoom: 1.25 } });
    expect(r.json).toMatchObject({ defaultModel: "mock-b", closeToTray: false, zoom: 1.25 });
    const file = JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8"));
    expect(file).toMatchObject({ llm: { defaultModel: "mock-b" }, ui: { closeToTray: false, zoom: 1.25 } });
    expect((await api("/settings", { method: "PUT", body: { zoom: 3 } })).status).toBe(400);
    expect((await api("/settings", { method: "PUT", body: { autostart: true } })).status).toBe(400);
    await api("/settings", { method: "PUT", body: { defaultModel: "", closeToTray: true, zoom: 1 } });
  });
  it("窗口按钮配色：浏览器模式下没有桌面外壳，静默忽略", async () => {
    const r = await api("/desktop/title-bar", { method: "POST", body: { dark: true } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
  });
  it("许可与第三方声明可在界面查看", async () => {
    const n = await api("/notices");
    expect(n.json.license).toContain("MIT");
    expect(n.json.notices).toContain("magpie");
  });
});

/** 读完一个 SSE 响应，返回 [事件, 数据] 列表 */
async function sse(p: string, body: unknown, signal?: AbortSignal, onEvent?: (ev: string, data: any) => void) {
  const res = await fetch(base + "/amb/api" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const events: Array<[string, any]> = [];
  let buf = "";
  const dec = new TextDecoder();
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev && data) {
          events.push([ev, JSON.parse(data)]);
          onEvent?.(ev, JSON.parse(data));
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
  return events;
}

describe("网页对话（流式）", () => {
  it("SSE：逐段 text（覆盖式累计）→ done；消息持久化；GET /chat 读回", async () => {
    const ev = await sse("/bots/default/chat/stream", { text: "流式你好" });
    const texts = ev.filter(([e]) => e === "text").map(([, d]) => d.text);
    expect(texts.length).toBeGreaterThan(2);
    for (let i = 1; i < texts.length; i++) expect(texts[i].startsWith(texts[i - 1].slice(0, -1))).toBe(true);
    expect(texts.at(-1)).toMatch(/你说：流式你好$/);
    expect(ev.at(-1)).toEqual(["done", { conversationId: "default:web:console" }]);
    const chat = await api("/bots/default/chat");
    expect(chat.json.conversationId).toBe("default:web:console");
    expect(chat.json.messages.slice(-2).map((m: any) => [m.role, m.content])).toEqual([
      ["user", "流式你好"],
      ["assistant", texts.at(-1)],
    ]);
    expect(chat.json.pending).toEqual([]);
  });
  it("会话级模型：PUT /chat/model 后下一条消息使用它，空字符串恢复默认", async () => {
    expect((await api("/bots/default/chat/model", { method: "PUT", body: { model: "mock-b" } })).json.model).toBe("mock-b");
    expect((await api("/bots/default/chat")).json.model).toBe("mock-b");
    await sse("/bots/default/chat/stream", { text: "用哪个" });
    expect(llm.calls.at(-1)!.model).toBe("mock-b");
    await api("/bots/default/chat/model", { method: "PUT", body: { model: "" } });
    await sse("/bots/default/chat/stream", { text: "又用哪个" });
    expect(llm.calls.at(-1)!.model).toBe("mock-a");
  });
  it("命令回复也走流：/status 一次性 text(final)", async () => {
    const ev = await sse("/bots/default/chat/stream", { text: "/status" });
    expect(ev.find(([e, d]) => e === "text" && d.final)?.[1].text).toContain("当前模型");
  });
  it("客户端断开（切走、刷新）不中止：回复照常生成并存下", async () => {
    const before = llm.calls.length;
    const aborted = llm.aborted;
    const ac = new AbortController();
    let got = 0;
    await sse("/bots/default/chat/stream", { text: "长".repeat(400) }, ac.signal, (e) => {
      if (e === "text" && ++got === 3) ac.abort();
    });
    expect(llm.calls.length).toBe(before + 1);
    await until(async () => (await api("/bots/default/chat")).json.live.length === 0, 5000, 20);
    expect(llm.aborted).toBe(aborted);
    const last = (await api("/bots/default/chat")).json.messages.at(-1);
    expect(last.role).toBe("assistant");
    expect(last.content).toMatch(/你说：长{400}$/);
  });
  it("停止：经 /conversations/:id/stop 中止上游请求，已生成的部分保留为助手消息", async () => {
    const before = llm.calls.length;
    const aborted = llm.aborted;
    let got = 0;
    const ev = await sse("/bots/default/chat/stream", { text: "长".repeat(4000) }, undefined, (e) => {
      if (e === "text" && ++got === 3) void api(`/conversations/${encodeURIComponent("default:web:console")}/stop`, { method: "POST", body: {} });
    });
    expect(llm.calls.length).toBe(before + 1);
    await until(() => llm.aborted > aborted, 3000, 20);
    expect(ev.map(([e]) => e)).toContain("stopping");
    expect(ev.at(-1)![0]).toBe("done");
    const msgs = (await api("/bots/default/chat")).json.messages;
    const last = msgs.at(-1);
    expect(last.role).toBe("assistant");
    expect(last.content).toMatch(/\n\n（已中止）$/);
    expect(last.content.length).toBeLessThan(4000);
    // 中止后同一会话还能继续对话（队列没被卡住）
    const next = await sse("/bots/default/chat/stream", { text: "还在吗" });
    expect(next.at(-1)![0]).toBe("done");
  });
  it("日志与数据库外文件中不含明文密钥", () => {
    const files = fs.readdirSync(dataDir, { recursive: true }).map(String).filter((f) => !f.endsWith(".db") && !f.includes(".db-") && !f.endsWith(".png"));
    for (const f of files) {
      const p = path.join(dataDir, f);
      if (fs.statSync(p).isFile()) expect(fs.readFileSync(p, "utf8")).not.toContain("tok-secret-123");
    }
  });
});
