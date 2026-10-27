import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { splitText } from "../src/core/types.js";
import { KeyedQueue, Dedup } from "../src/core/queue.js";
import { Store } from "../src/store/db.js";
import { SSEParser, OpenAICompatClient } from "../src/llm/client.js";
import { StreamingMarkdownFilter } from "../src/channels/weixin/markdown-filter.js";
import { filterMarkdown, weixinParts } from "../src/channels/weixin/channel.js";
import { WeixinQuota, QUOTA_PER_INBOUND } from "../src/channels/weixin/quota.js";
import { parseWeixinApiJson, WeixinApiError } from "../src/channels/weixin/api.js";
import { FeishuReply } from "../src/channels/feishu/card.js";
import { feishuParts } from "../src/channels/feishu/channel.js";
import { redactValue, mask } from "../src/log.js";
import { loadConfig } from "../src/config.js";
import { isBlockedPath } from "../src/web/proxy.js";
import { FakeFeishu, feishuEvent, mockOpenAI } from "./helpers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "amb-unit-"));

describe("splitText", () => {
  it("短文本不切分", () => expect(splitText("abc", 10)).toEqual(["abc"]));
  it("按上限切分且无丢失，优先在换行处", () => {
    const text = Array.from({ length: 50 }, (_, i) => `第${i}段 ` + "字".repeat(150)).join("\n\n");
    const parts = splitText(text, 4000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4000);
    expect(parts.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    expect(parts[1].startsWith("第")).toBe(true);
  });
  it("无换行的超长文本硬切", () => {
    const parts = splitText("x".repeat(9000), 4000);
    expect(parts.map((p) => p.length)).toEqual([4000, 4000, 1000]);
  });
});

describe("KeyedQueue / Dedup", () => {
  it("同 key 串行、不同 key 并行", async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    const task = (k: string, n: number, ms: number) => q.run(k, async () => { log.push(`${k}${n}+`); await new Promise((r) => setTimeout(r, ms)); log.push(`${k}${n}-`); });
    await Promise.all([task("a", 1, 30), task("a", 2, 1), task("b", 1, 5)]);
    expect(log.indexOf("a1-")).toBeLessThan(log.indexOf("a2+"));
    expect(log.indexOf("b1+")).toBeLessThan(log.indexOf("a1-"));
  });
  it("前一个任务失败不阻塞后续", async () => {
    const q = new KeyedQueue();
    const p1 = q.run("k", async () => { throw new Error("x"); }).catch(() => undefined);
    let ran = false;
    await q.run("k", async () => { ran = true; });
    await p1;
    expect(ran).toBe(true);
  });
  it("去重与过期", () => {
    const d = new Dedup(1000);
    expect(d.firstSeen("m1", 0)).toBe(true);
    expect(d.firstSeen("m1", 500)).toBe(false);
    expect(d.firstSeen("m1", 2000)).toBe(true);
  });
});

describe("Store", () => {
  it("机器人 CRUD、会话与滑动窗口", () => {
    const s = new Store(path.join(tmp(), "t.db"));
    const bot = s.createBot({ name: "b1" });
    expect(s.getBot(bot.id)?.name).toBe("b1");
    s.updateBot(bot.id, { defaultModel: "m" });
    expect(s.getBot(bot.id)?.defaultModel).toBe("m");
    const c = s.ensureConversation(bot.id, "feishu", "oc1");
    expect(s.ensureConversation(bot.id, "feishu", "oc1").id).toBe(c.id);
    for (let i = 0; i < 10; i++) {
      s.addMessage(c.id, "user", `u${i}`);
      s.addMessage(c.id, "assistant", `a${i}` + "x".repeat(100));
    }
    const w = s.contextWindow(c.id, 5, 100000);
    expect(w[0].role).toBe("user");
    expect(w.at(-1)?.content.startsWith("a9")).toBe(true);
    expect(w.length).toBeLessThanOrEqual(5);
    const w2 = s.contextWindow(c.id, 100, 350);
    expect(w2.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(350);
    expect(w2[0].role).toBe("user");
    expect(s.listConversations()[0].messageCount).toBe(20);
    s.clearMessages(c.id);
    expect(s.listMessages(c.id)).toHaveLength(0);
    s.deleteBot(bot.id);
    expect(s.getBot(bot.id)).toBeUndefined();
    s.close();
  });
  it("数据库文件权限 600", () => {
    if (process.platform === "win32") return;
    const f = path.join(tmp(), "p.db");
    new Store(f).close();
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe("SSE / OpenAI 兼容客户端", () => {
  it("SSE 解析跨块拼接", () => {
    const got: string[] = [];
    const p = new SSEParser((d) => got.push(d));
    p.push("data: {\"a\":1}\n\nda");
    p.push("ta: {\"b\":2}\r\n\r\n: comment\n\ndata: [DONE]");
    p.end();
    expect(got).toEqual(['{"a":1}', '{"b":2}', "[DONE]"]);
  });
  it("流式调用与模型列表", async () => {
    const m = await mockOpenAI({ key: "k1" });
    const c = new OpenAICompatClient(() => ({ baseUrl: m.url + "/v1", apiKey: "k1" }));
    expect(await c.listModels()).toEqual(["mock-a", "mock-b"]);
    const deltas: string[] = [];
    const full = await c.streamChat({ model: "mock-b", messages: [{ role: "user", content: "你好世界" }] }, (d) => deltas.push(d));
    expect(full).toBe("[mock-b] 你说：你好世界");
    expect(deltas.length).toBeGreaterThan(1);
    const bad = new OpenAICompatClient(() => ({ baseUrl: m.url + "/v1", apiKey: "nope" }));
    await expect(bad.listModels()).rejects.toThrow();
    await m.close();
  });
});

describe("微信", () => {
  it("Markdown 过滤", () => {
    // 与上游行为一致：微信能渲染的（粗体/代码/表格）保留；H5/H6、图片、包裹中文的斜体去掉
    const out = filterMarkdown("##### 小标题\n**粗体** 和 *中文斜体*\n![图](https://x.com/a.png)\n```js\nconst *a* = 1;\n```");
    expect(out).not.toContain("#####");
    expect(out).not.toContain("![");
    expect(out).toContain("**粗体**");
    expect(out).toContain("中文斜体");
    expect(out).not.toContain("*中文斜体*");
    expect(out).toContain("const *a* = 1;");
    const f = new StreamingMarkdownFilter();
    const streamed = ["*中", "文*", "结束"].map((d) => f.feed(d)).join("") + f.flush();
    expect(streamed).toBe(filterMarkdown("*中文*结束"));
    expect(streamed).toBe("中文结束");
  });
  it("消息项解析", () => {
    const parts = weixinParts([{ type: 1, text_item: { text: "hi" } }, { type: 3, voice_item: { text: "语音转写" } } as any, { type: 2 } as any]);
    expect(parts).toEqual([{ type: "text", text: "hi" }, { type: "voice", transcript: "语音转写" }, { type: "image" }]);
  });
  it("配额：每条入站后 24h 内 10 条", () => {
    const s = new Store(path.join(tmp(), "q.db"));
    let now = 1_000_000;
    const q = new WeixinQuota(s, "b", () => now);
    expect(q.remaining("u")).toBe(0);
    q.onInbound("u", "ctx");
    for (let i = 0; i < QUOTA_PER_INBOUND; i++) expect(q.tryConsume("u")).toBe(true);
    expect(q.tryConsume("u")).toBe(false);
    q.onInbound("u", "ctx2");
    expect(q.remaining("u")).toBe(10);
    now += 25 * 3600_000;
    expect(q.remaining("u")).toBe(0);
    s.close();
  });
  it("iLink JSON 大整数保持为字符串、-14 识别", () => {
    const r = parseWeixinApiJson<{ message_id: unknown }>('{"message_id": 12345678901234567890}');
    expect(String(r.message_id)).toBe("12345678901234567890");
    expect(new WeixinApiError("x", -14, undefined).sessionExpired).toBe(true);
    expect(new WeixinApiError("x", 0, -14).sessionExpired).toBe(true);
  });
});

describe("飞书", () => {
  it("消息解析：去掉 @ 占位符、富文本", () => {
    expect(feishuParts(feishuEvent("", { content: JSON.stringify({ text: "@_user_1 你好" }), mentions: [{ key: "@_user_1" }] }))).toEqual([{ type: "text", text: "你好" }]);
    const post = feishuEvent("", { messageType: "post", content: JSON.stringify({ title: "T", content: [[{ tag: "text", text: "a" }, { tag: "a", text: "b" }]] }) });
    expect(feishuParts(post)).toEqual([{ type: "text", text: "T\nab" }]);
  });
  it("流式卡片节流 + 收尾关闭 streaming", async () => {
    const t = new FakeFeishu();
    const r = new FeishuReply(t, "om_1", 50);
    await r.apply({ type: "stream.start" });
    let acc = "";
    for (let i = 0; i < 20; i++) {
      acc += "字";
      await r.apply({ type: "stream.update", text: acc });
      await new Promise((res) => setTimeout(res, 5));
    }
    await r.apply({ type: "stream.finish", text: acc + "完" });
    const updates = t.calls.filter((c) => c.op === "update");
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.length).toBeLessThan(10);
    const seqs = updates.map((u) => u.args[3] as number);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(t.cards.get("card1")).toBe(acc + "完");
    expect(t.finished.has("card1")).toBe(true);
    expect(t.calls.at(-1)?.op).toBe("finish");
  });
  it("卡片创建失败 → 纯文本降级（超长切分）", async () => {
    const t = new FakeFeishu();
    t.failCreate = true;
    const r = new FeishuReply(t, "om_1", 10);
    await r.apply({ type: "stream.start" });
    await r.apply({ type: "stream.update", text: "abc" });
    await r.apply({ type: "stream.finish", text: "y".repeat(8500) });
    expect(t.texts.map((x) => x.length)).toEqual([4000, 4000, 500]);
  });
  it("收尾失败：卡片已含全文则不重复发；最终更新也失败则以文本补发", async () => {
    const t = new FakeFeishu();
    t.failFinish = true;
    const r = new FeishuReply(t, "om_1", 10);
    await r.apply({ type: "stream.start" });
    await r.apply({ type: "stream.finish", text: "最终答案" });
    expect(t.texts).toEqual([]);
    const t2 = new FakeFeishu();
    t2.updateCardText = async () => { throw new Error("rate limited"); };
    const r2 = new FeishuReply(t2, "om_2", 10);
    await r2.apply({ type: "stream.start" });
    await r2.apply({ type: "stream.finish", text: "最终答案2" });
    expect(t2.texts).toEqual(["最终答案2"]);
  });
});

describe("安全", () => {
  it("日志脱敏", () => {
    const out = JSON.stringify(redactValue({ appSecret: "abc", bot_token: "t", apiKey: "k", nested: { authorization: "Bearer xyz" }, msg: "key sk-abcdefghijklmnop and Bearer qqqqqqqqqqqq", name: "ok" }));
    expect(out).not.toMatch(/abc"|"t"|"k"|xyz|abcdefghijklmnop|qqqqqqqqqqqq/);
    expect(out).toContain('"name":"ok"');
    expect(mask("1234567890")).toBe("****7890");
  });
  it("代理拒绝 agent 改写 / 账号复用 / 自更新接口（含编码绕过）", () => {
    for (const p of ["/api/agents/connect/claude", "/magpie/api/agents/", "/api/accounts/authorize", "/api/%61gents/connect/codex", "//api//agents/x", "/api/agent-models/codex", "/api/update", "/API/Agents"]) expect(isBlockedPath(p), p).toBe(true);
    for (const p of ["/api/gateway/trace", "/magpie/", "/v1/models", "/api/state", "/icons/x.svg"]) expect(isBlockedPath(p), p).toBe(false);
  });
  it("配置：环境变量优先，AMB_UI_PORT=0 合法", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ ui: { port: 4000 }, llm: { defaultModel: "f" } }));
    const c = loadConfig({ dataDir: dir, env: { AMB_UI_PORT: "0", AMB_MAGPIE_BASE_URL: "http://x/v1" } });
    expect(c.ui.port).toBe(0);
    expect(c.llm.defaultModel).toBe("f");
    expect(c.magpie.mode).toBe("external");
  });
});
