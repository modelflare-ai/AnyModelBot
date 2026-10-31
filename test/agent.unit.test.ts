import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store/db.js";
import { ApprovalCenter, parseAnswer, promptText } from "../src/agent/approvals.js";
import { WeixinReply } from "../src/channels/weixin/channel.js";
import { WeixinQuota } from "../src/channels/weixin/quota.js";
import { AgentHost, agentApi, modelLimits, type AgentApi } from "../src/agent/host.js";
import { AgentBridge, BOT_HEADER, type ProxyEvent, type Rejection } from "../src/agent/bridge.js";
import { ApiFallbacks, shapeRejection } from "../src/agent/api-fallback.js";
import { ActivityLog } from "../src/agent/activity.js";
import { listen } from "./helpers.js";
import { normalizeSettings } from "../src/agent/settings.js";

let dir: string;
let store: Store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-ap-"));
  store = new Store(path.join(dir, "t.db"));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const base = { botId: "b", conversationId: "b:weixin:u1", sessionId: "s", tool: "bash", detail: "rm -rf build", reason: "" };

describe("ApprovalCenter", () => {
  it("formats the WeChat prompt and accepts 'y CODE' once", async () => {
    const c = new ApprovalCenter(store);
    const row = c.create({ kind: "approval", ...base });
    expect(row.code).toMatch(/^\d{4}$/);
    expect(promptText(row)).toBe(`需批准: bash \`rm -rf build\` — 回复 y ${row.code} / n ${row.code}`);
    expect(c.handleReply("b:weixin:u1", `y ${row.code}`, "u1")).toEqual({ handled: true, ack: `✅ 已批准 ${row.code}（仅本次）` });
    expect(store.getApproval(row.id)!.status).toBe("allowed");
    // 二次回复不再生效
    expect(c.handleReply("b:weixin:u1", `y ${row.code}`, "u1").ack).toContain("没有编号");
  });

  it("rejects codes from another conversation and requires a code when ambiguous", () => {
    const c = new ApprovalCenter(store);
    const a = c.create({ kind: "approval", ...base });
    const b = c.create({ kind: "approval", ...base });
    expect(c.handleReply("b:weixin:other", `y ${a.code}`, "x").ack).toContain("没有编号");
    expect(store.getApproval(a.id)!.status).toBe("pending");
    expect(c.handleReply("b:weixin:u1", "y", "u1").ack).toContain("请带上编号");
    expect(c.handleReply("b:weixin:u1", `n ${b.code}`, "u1").ack).toBe(`❌ 已拒绝 ${b.code}`);
    expect(c.handleReply("b:weixin:u1", "同意", "u1").ack).toBe(`✅ 已批准 ${a.code}（仅本次）`);
  });

  it("ignores unrelated text and slash commands", () => {
    const c = new ApprovalCenter(store);
    c.create({ kind: "approval", ...base });
    expect(c.handleReply("b:weixin:u1", "你好", "u1").handled).toBe(false);
    expect(c.handleReply("b:weixin:u1", "/status", "u1").handled).toBe(false);
    expect(c.handleReply("b:weixin:u2", "y", "u2").handled).toBe(false);
  });

  it("expires after the TTL and on restart", async () => {
    let now = 1_000;
    const c = new ApprovalCenter(store, { ttlMs: 1000, now: () => now });
    const r = c.create({ kind: "approval", ...base });
    now += 1500;
    c.sweep();
    expect(store.getApproval(r.id)!.status).toBe("expired");
    const r2 = c.create({ kind: "approval", ...base });
    const c2 = new ApprovalCenter(store);
    c2.start();
    c2.stop();
    expect(store.getApproval(r2.id)!.status).toBe("expired");
  });

  it("wait() resolves when decided", async () => {
    const c = new ApprovalCenter(store);
    const r = c.create({ kind: "approval", ...base });
    const w = c.wait(r.id, 5000);
    setTimeout(() => c.decide(r.id, true, "web"), 20);
    expect((await w)!.status).toBe("allowed");
  });

  it("answers a pending question from free text (even 'y')", () => {
    const c = new ApprovalCenter(store);
    const q = c.create({ kind: "question", ...base, tool: "", detail: "", payload: JSON.stringify([{ id: "q1", question: "继续吗？", options: [{ label: "是" }, { label: "否" }] }]) });
    expect(c.handleReply("b:weixin:u1", "2", "u1").handled).toBe(true);
    expect(JSON.parse(store.getApproval(q.id)!.result)).toEqual({ answers: [{ id: "q1", selected: ["否"] }] });
  });
});

describe("parseAnswer", () => {
  const qs = [
    { id: "a", question: "颜色", options: [{ label: "红" }, { label: "蓝" }, { label: "绿" }], multiSelect: true },
    { id: "b", question: "名字" },
  ];
  it("maps lines to questions, numbers to options, rest to custom", () => {
    expect(parseAnswer(qs, "1, 3\n小明")).toEqual({ answers: [{ id: "a", selected: ["红", "绿"] }, { id: "b", selected: [], custom: "小明" }] });
    expect(parseAnswer([qs[0]], "蓝")).toEqual({ answers: [{ id: "a", selected: ["蓝"] }] });
    expect(parseAnswer([qs[0]], "9")).toEqual({ answers: [{ id: "a", selected: [], custom: "9" }] });
  });
});

describe("WeixinReply: only final reply / prompts / files become messages", () => {
  function setup(remaining = 10) {
    store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: remaining, windowStartedAt: Date.now() });
    const sent: string[] = [];
    const typing: boolean[] = [];
    const client = {
      sendText: async (_u: string, t: string) => void sent.push(t),
      getTypingTicket: async () => "ticket",
      sendTyping: async (_u: string, _t: string, on: boolean) => void typing.push(on),
    } as any;
    return { sent, typing, reply: new WeixinReply(client, "u1", "ctx", new WeixinQuota(store, "b")) };
  }
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("uses the typing indicator as the only working signal and sends just the final reply", async () => {
    const { sent, typing, reply } = setup();
    await reply.apply({ type: "typing", on: true });
    await reply.apply({ type: "stream.start" });
    await reply.apply({ type: "stream.finish", text: "完成" });
    await reply.apply({ type: "typing", on: false });
    await tick(10);
    expect(sent).toEqual(["完成"]);
    expect(typing).toEqual([true, false]);
  });

  it("no quota is reserved: the last remaining message goes to the reply", async () => {
    const low = setup(1);
    await low.reply.apply({ type: "stream.finish", text: "最终答案" });
    expect(low.sent).toEqual(["最终答案"]);
  });

  it("sends approval prompts raw (backticks intact) and resumes typing", async () => {
    const { sent, typing, reply } = setup();
    await reply.apply({ type: "typing", on: true });
    await reply.apply({ type: "interactive", kind: "approval", prompt: "需批准: bash `rm -rf build` — 回复 y 1234 / n 1234", requestId: "r1", code: "1234" });
    await tick(10);
    expect(sent).toEqual(["需批准: bash `rm -rf build` — 回复 y 1234 / n 1234"]);
    expect(typing.filter(Boolean).length).toBe(2);
    await reply.apply({ type: "typing", on: false });
  });
});

describe("WeChat media delivery", () => {
  it("IlinkClient.sendMedia: getuploadurl → encrypted CDN upload → file item", async () => {
    const { IlinkClient } = await import("../src/channels/weixin/api.js");
    const crypto = await import("node:crypto");
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amb-media-")), "report.txt");
    fs.writeFileSync(f, "hello deliverable");
    const calls: Array<{ url: string; body: any; raw?: Buffer }> = [];
    let aeskey = "";
    const fetchImpl = (async (url: string, init: any) => {
      if (url.includes("getuploadurl")) {
        const b = JSON.parse(init.body);
        aeskey = b.aeskey;
        calls.push({ url, body: b });
        return new Response(JSON.stringify({ ret: 0, upload_param: "UP+/=" }), { status: 200 });
      }
      if (url.includes("/upload?")) {
        calls.push({ url, body: null, raw: Buffer.from(init.body) });
        return new Response("", { status: 200, headers: { "x-encrypted-param": "DOWN" } });
      }
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
    }) as any;
    const c = new IlinkClient({ baseUrl: "http://ilink", token: "t", fetchImpl, cdnBaseUrl: "http://cdn/c2c" });
    await c.sendMedia("u1", f, "ctx");
    expect(calls).toHaveLength(3);
    expect(calls[0].body).toMatchObject({ media_type: 3, to_user_id: "u1", rawsize: 17, filesize: 32, no_need_thumb: true });
    expect(calls[1].url).toBe("http://cdn/c2c/upload?encrypted_query_param=UP%2B%2F%3D&filekey=" + calls[0].body.filekey);
    const d = crypto.createDecipheriv("aes-128-ecb", Buffer.from(aeskey, "hex"), null);
    expect(Buffer.concat([d.update(calls[1].raw!), d.final()]).toString()).toBe("hello deliverable");
    const item = calls[2].body.msg.item_list[0];
    expect(item.type).toBe(4);
    expect(item.file_item).toMatchObject({ file_name: "report.txt", len: "17", media: { encrypt_query_param: "DOWN", encrypt_type: 1 } });
    expect(Buffer.from(item.file_item.media.aes_key, "base64").toString()).toBe(aeskey);
    expect(calls[2].body.msg.context_token).toBe("ctx");
  });

  it("WeixinReply file op consumes quota and falls back to text on failure", async () => {
    store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 2, windowStartedAt: Date.now() });
    const sent: string[] = [];
    let fail = false;
    const client = {
      sendText: async (_u: string, t: string) => void sent.push(t),
      sendMedia: async (_u: string, p: string) => {
        if (fail) throw new Error("cdn down");
        sent.push("media:" + p);
      },
    } as any;
    const quota = new WeixinQuota(store, "b");
    const reply = new WeixinReply(client, "u1", "ctx", quota);
    await reply.apply({ type: "file", path: "/w/a.png", name: "a.png" });
    expect(sent).toEqual(["media:/w/a.png"]);
    expect(quota.remaining("u1")).toBe(1);
    fail = true;
    await reply.apply({ type: "file", path: "/w/b.png", name: "b.png" });
    expect(sent[1]).toContain("b.png");
    expect(quota.remaining("u1")).toBe(0);
  });

  it("deliverables() keeps only regular files inside the workspace", async () => {
    const { deliverables, presentPaths } = await import("../src/agent/host.js");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-ws-"));
    fs.writeFileSync(path.join(ws, "ok.txt"), "x");
    fs.writeFileSync(path.join(ws, "empty.txt"), "");
    fs.symlinkSync("/etc/hostname", path.join(ws, "link.txt"));
    const args = JSON.stringify({ files: [{ path: "ok.txt" }, { path: path.join(ws, "ok.txt") }, { path: "../../etc/passwd" }, { path: "/etc/hostname" }, { path: "link.txt" }, { path: "empty.txt" }, { path: "missing" }] });
    expect(deliverables(ws, presentPaths(args))).toEqual([path.join(fs.realpathSync(ws), "ok.txt")]);
  });
});

describe("context window written for DSH", () => {
  it("uses the window from Modelflare's model data; the built-in table is only a fallback", () => {
    expect(modelLimits("mfb-b/gpt-6.1-terra", 1_050_000)).toEqual({ window: 1_050_000, maxTokens: 32_000 });
    expect(modelLimits("modelflare/gpt-6.1-terra")).toEqual({ window: 1_050_000, maxTokens: 32_000 });
    expect(modelLimits("gpt-6.2-sol")).toEqual({ window: 400_000, maxTokens: 32_000 });
    expect(modelLimits("some-new-model")).toEqual({ window: 128_000, maxTokens: 16_000 });
    // 小窗口模型：最大输出不超过窗口的四分之一
    expect(modelLimits("claude-mini", 32_000)).toEqual({ window: 32_000, maxTokens: 8_000 });
  });

  it("the patch carries those numbers", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-patch-"));
    const host = new AgentHost({ botId: "b", dataDir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1" } as any, store: new Store(":memory:") });
    fs.mkdirSync(host.home, { recursive: true });
    const file = (host as any).writePatch("mfb-b/gpt-6.1-terra", [], undefined, modelLimits("gpt-6.1-terra", 1_050_000));
    const text = fs.readFileSync(file, "utf8");
    expect(text).toMatch(/contextWindow: 1050000\n\s+maxTokens: 32000/);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

describe("agent API per model", () => {
  // Modelflare 公开目录里的 supported_endpoint_types（2026-10）
  const gpt = ["openai", "openai-response", "openai-response-compact"];
  const deepseek = ["openai", "openai-response", "anthropic", "gemini"];
  const claude = ["anthropic", "openai"];
  const gemini = ["gemini", "openai"];

  it("Responses when offered, else Anthropic Messages, else Chat Completions", () => {
    expect(agentApi(gpt, {})).toBe("openai-responses");
    expect(agentApi(["openai-response", "openai-response-compact", "openai"], {})).toBe("openai-responses");
    expect(agentApi(deepseek, {})).toBe("openai-responses");
    expect(agentApi(claude, {})).toBe("anthropic-messages");
    expect(agentApi(gemini, {})).toBe("openai-completions");
    expect(agentApi(["openai"], {})).toBe("openai-completions");
  });

  it("unknown model or no catalog (offline, China line) stays on Chat Completions", () => {
    expect(agentApi(undefined, {})).toBe("openai-completions");
    expect(agentApi([], {})).toBe("openai-completions");
  });

  it("AMB_AGENT_API=chat forces Chat Completions", () => {
    expect(agentApi(gpt, { AMB_AGENT_API: "chat" })).toBe("openai-completions");
    expect(agentApi(claude, { AMB_AGENT_API: " Chat " })).toBe("openai-completions");
    expect(agentApi(claude, { AMB_AGENT_API: "" })).toBe("anthropic-messages");
  });

  const patchFor = (model: string, api: AgentApi, reasoning?: boolean) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-patch-"));
    const host = new AgentHost({ botId: "b", dataDir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1" } as any, store: new Store(":memory:") });
    fs.mkdirSync(host.home, { recursive: true });
    const text = fs.readFileSync((host as any).writePatch(model, [], undefined, modelLimits(model, 1_000_000), api, reasoning), "utf8");
    fs.rmSync(dataDir, { recursive: true, force: true });
    return text;
  };

  it("the patch names the API; Anthropic's base URL is the bridge root (the SDK adds /v1/messages)", () => {
    const chat = patchFor("mfb-b/gemini-3.6-flash", "openai-completions");
    expect(chat).toContain('        api: openai-completions\n        baseURL: "http://127.0.0.1:1/v1"\n');
    // 每个模型请求都标明机器人（bridge 用来归属上游错误）
    expect(chat).toContain(`        apiKeyEnv: AMB_MAGPIE_KEY\n        headers:\n          ${BOT_HEADER}: "b"\n`);
    expect(chat).not.toMatch(/reasoning|compat/);
    const claude = patchFor("mfb-b/claude-sonnet-5", "anthropic-messages", true);
    expect(claude).toContain('        api: anthropic-messages\n        baseURL: "http://127.0.0.1:1"\n');
    expect(claude).toContain("            input: [text, image]\n");
    // Claude 不开思考（和以前一样用模型默认）
    expect(claude).not.toMatch(/reasoning|compat/);
  });

  it("Responses: reasoning models ask for medium effort (encrypted reasoning for replay); system role; explicit strict:false", () => {
    const resp = patchFor("mfb-b/gpt-6.1-terra", "openai-responses", true);
    expect(resp).toContain('        api: openai-responses\n        baseURL: "http://127.0.0.1:1/v1"\n        reasoning: medium\n        apiKeyEnv: AMB_MAGPIE_KEY\n');
    expect(resp).toContain(
      "            maxTokens: 32000\n            input: [text, image]\n            reasoningEfforts:\n              low: low\n              medium: medium\n              high: high\n            compat:\n              supportsDeveloperRole: false\n              supportsStrictMode: true\n",
    );
    // 不知道是不是推理模型：按推理模型处理（store:false 下推理条目没有 encrypted_content 就回放不了）
    expect(patchFor("mfb-b/gpt-6.1-terra", "openai-responses")).toContain("        reasoning: medium\n");
    // 明确不推理：不发推理参数
    const plain = patchFor("mfb-b/gpt-6.1-terra", "openai-responses", false);
    expect(plain).not.toMatch(/reasoning/);
    expect(plain).toContain("            compat:\n              supportsDeveloperRole: false\n              supportsStrictMode: true\n");
  });
});

describe("agent bridge model proxy", () => {
  let up: Awaited<ReturnType<typeof listen>>;
  let bridge: AgentBridge;
  const seen: Array<{ path: string; headers: Record<string, unknown>; body: string }> = [];
  beforeEach(async () => {
    seen.length = 0;
    up = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      seen.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "text/event-stream" }).end("event: message_stop\ndata: {}\n\n");
    });
    bridge = new AgentBridge({ upstream: () => ({ baseUrl: up.url + "/v1", apiKey: "real-key" }), ask: async () => ({ id: "" }), wait: async () => ({}), cancel: async () => {} });
    await bridge.start();
  });
  afterEach(async () => {
    await bridge.stop();
    await up.close();
  });
  const post = (p: string, headers: Record<string, string>, body: unknown) => fetch(bridge.url + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("Anthropic clients authenticate with x-api-key; upstream gets the real key, never the bridge token", async () => {
    const r = await post("/v1/messages?beta=true", { "x-api-key": bridge.token, "anthropic-version": "2023-06-01" }, { model: "m", messages: [] });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("message_stop");
    expect(seen[0].path).toBe("/v1/messages?beta=true");
    expect(seen[0].headers).toMatchObject({ authorization: "Bearer real-key", "x-api-key": "real-key", "anthropic-version": "2023-06-01" });
    expect(JSON.stringify(seen[0].headers)).not.toContain(bridge.token);
  });

  it("OpenAI clients keep using Authorization; no x-api-key is invented for them", async () => {
    expect((await post("/v1/responses", { authorization: `Bearer ${bridge.token}` }, { model: "m", input: [] })).status).toBe(200);
    expect(seen[0].headers.authorization).toBe("Bearer real-key");
    expect(seen[0].headers["x-api-key"]).toBeUndefined();
  });

  it("the bot header is not forwarded; upstream rejections are reported with the bot that sent the request", async () => {
    await up.close();
    up = await listen(async (req, res) => {
      seen.push({ path: req.url!, headers: req.headers, body: "" });
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `bad ${bridge.token}` } }));
    });
    const got: Rejection[] = [];
    bridge.onRejection((r) => void got.push(r));
    const r = await post("/v1/responses", { authorization: `Bearer ${bridge.token}`, [BOT_HEADER]: "bot-7" }, { model: "m", input: [] });
    expect(r.status).toBe(400);
    expect(seen[0].headers[BOT_HEADER]).toBeUndefined();
    expect(got).toEqual([{ bot: "bot-7", path: "/v1/responses", status: 400, error: expect.stringContaining("bad ") }]);
    // 错误体已脱敏（令牌不进日志、不进回退原因）
    expect(got[0].error).not.toContain(bridge.token);
  });

  it("rejects a wrong token in either header", async () => {
    expect((await post("/v1/messages", { "x-api-key": "nope" }, {})).status).toBe(401);
    expect((await post("/v1/responses", { authorization: "Bearer nope" }, {})).status).toBe(401);
    expect((await post("/v1/messages", { "x-api-key": bridge.token.slice(1) }, {})).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("troubleshooting sees model requests on every API, with the first user message", async () => {
    const events: ProxyEvent[] = [];
    bridge.onProxy((e) => void events.push(e));
    const auth = { authorization: `Bearer ${bridge.token}` };
    await post("/v1/chat/completions", auth, { model: "a", tools: [{ type: "function", function: { name: "bash" } }], messages: [{ role: "user", content: "hi chat" }] });
    await post("/v1/responses", auth, { model: "b", tools: [{ type: "function", name: "bash" }], input: [{ role: "system", content: "sys" }, { role: "user", content: [{ type: "input_text", text: "hi responses" }] }] });
    await post("/v1/messages?beta=true", { "x-api-key": bridge.token }, { model: "c", tools: [{ name: "bash" }], messages: [{ role: "user", content: [{ type: "text", text: "hi messages" }] }] });
    const reqs = events.filter((e) => e.phase === "request") as Array<Extract<ProxyEvent, { phase: "request" }>>;
    expect(reqs.map((e) => [e.path, e.model, e.tools, e.lastUser])).toEqual([
      ["/v1/chat/completions", "a", ["bash"], "hi chat"],
      ["/v1/responses", "b", ["bash"], "hi responses"],
      ["/v1/messages", "c", ["bash"], "hi messages"],
    ]);
  });
});

describe("agent API fallback", () => {
  const unsupported = JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning.summary'", type: "invalid_request_error", code: "unsupported_parameter" } });

  it("request-shape rejections (400/404/405/415/422) fall back; the reason is the upstream's message", () => {
    expect(shapeRejection([{ status: 400, error: unsupported }], "magpie API error (400): …")).toBe("HTTP 400: Unsupported parameter: 'reasoning.summary'");
    for (const status of [404, 405, 415, 422]) expect(shapeRejection([{ status, error: "no such route" }], "x")).toBe(`HTTP ${status}: no such route`);
    expect(shapeRejection([{ status: 400, error: "" }], "x")).toBe("HTTP 400");
    // 最近的一次说了算
    expect(shapeRejection([{ status: 503, error: "x" }, { status: 422, error: "unknown field 'include'" }], "")).toBe("HTTP 422: unknown field 'include'");
  });

  it("rate limits, quota, auth, server errors, context overflow and content filters do not", () => {
    for (const status of [401, 402, 403, 408, 409, 429, 500, 502, 503, 504, 529]) expect(shapeRejection([{ status, error: unsupported }], `${status} unsupported parameter`)).toBeUndefined();
    expect(shapeRejection([{ status: 400, error: JSON.stringify({ error: { message: "This model's maximum context length is 200000 tokens", code: "context_length_exceeded" } }) }], "")).toBeUndefined();
    expect(shapeRejection([{ status: 400, error: "Input is too long for requested model." }], "")).toBeUndefined();
    expect(shapeRejection([{ status: 400, error: "Your request was flagged by our content policy" }], "")).toBeUndefined();
    expect(shapeRejection([{ status: 400, error: "insufficient balance" }], "")).toBeUndefined();
    expect(shapeRejection([], "pi-ai stream idle timeout after 300000ms")).toBeUndefined();
    expect(shapeRejection([], "")).toBeUndefined();
  });

  it("without a status (error only in the stream): an 'unsupported / unknown parameter or endpoint' message falls back", () => {
    expect(shapeRejection([], "Error Code invalid_request_error: Unsupported parameter: 'reasoning.effort'")).toMatch(/^Error Code/);
    expect(shapeRejection([], "unknown_parameter: prompt_cache_retention")).toBeTruthy();
    expect(shapeRejection([], "This endpoint does not support tools of type custom")).toBeTruthy();
    expect(shapeRejection([], "429: unsupported parameter while rate limited")).toBeUndefined();
    expect(shapeRejection([], "Rate limit reached for requests")).toBeUndefined();
  });

  it("is keyed by the bare model id, kept on disk for 24 hours, and expires", () => {
    const file = path.join(dir, "dsh", "api-fallback.json");
    const a = new ApiFallbacks(file);
    a.set("mfb-b1/deepseek-v4-pro", "openai-responses", "HTTP 400: nope");
    expect(a.get("modelflare/deepseek-v4-pro")).toMatchObject({ from: "openai-responses", reason: "HTTP 400: nope" });
    expect(a.get("deepseek-v4-pro")).toBeTruthy();
    expect(a.get("gpt-6-sol")).toBeUndefined();
    const rec = JSON.parse(fs.readFileSync(file, "utf8")).models["deepseek-v4-pro"];
    expect(rec.until - rec.at).toBe(24 * 3600_000);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // 重启后仍然有效
    expect(new ApiFallbacks(file).list()).toEqual([expect.objectContaining({ model: "deepseek-v4-pro", from: "openai-responses" })]);
    // 过期了就不算，也从文件里去掉
    const short = new ApiFallbacks(file, -1);
    short.set("glm-5.3", "anthropic-messages", "HTTP 404");
    expect(short.get("glm-5.3")).toBeUndefined();
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).models)).not.toContain("glm-5.3");
    // 文件坏了：从空开始
    fs.writeFileSync(file, "{oops");
    expect(new ApiFallbacks(file).list()).toEqual([]);
    // 不给文件：只在内存里
    const mem = new ApiFallbacks();
    mem.set("x", "openai-responses", "r");
    expect(mem.get("x")).toBeTruthy();
  });

  it("host status names the fallback; the activity log shows the redo as a retry step", () => {
    const host = new AgentHost({ botId: "b", dataDir: dir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1" } as any, store });
    host.api = "openai-responses";
    expect(host.status().api).toBe("openai-responses");
    host.api = "openai-completions";
    host.fallback = { from: "openai-responses", reason: "HTTP 400: Unsupported parameter", at: 0, until: 1 };
    expect(host.status().api).toBe("openai-completions (fallback: HTTP 400: Unsupported parameter)");
    const log = new ActivityLog();
    log.apply("api/fallback", { from: "openai-responses", to: "openai-completions", reason: "HTTP 400: Unsupported parameter" }, 1000);
    expect(log.steps).toEqual([expect.objectContaining({ kind: "retry", title: "改用 Chat Completions 重试", summary: "openai-responses 被拒：HTTP 400: Unsupported parameter", status: "ok" })]);
  });
});

describe("full access patch", () => {
  const patch = (permission: "readonly" | "workspace" | "full") => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-patch-"));
    const settings = normalizeSettings({ permission, computerUse: { enabled: false } });
    const host = new AgentHost({ botId: "b", dataDir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1" } as any, store: new Store(":memory:"), settings: () => settings });
    fs.mkdirSync(host.home, { recursive: true });
    const text = fs.readFileSync((host as any).writePatch("m"), "utf8");
    const env = (host as any).env();
    fs.rmSync(dataDir, { recursive: true, force: true });
    return { text, env };
  };
  it("full: danger-full-access, the delete gate, and approvals still answerable (ask, not never)", () => {
    const { text, env } = patch("full");
    expect(env.DSH_PERMISSION_MODE).toBe("danger-full-access");
    // 闸门是插件 insert 列表的最后一项，后面是顶层的行补丁
    expect(text).toContain('    - id: amb-delete-gate\n      name: "/rt/plugins/amb-delete-gate.mjs"\n- id: approval\n  config:\n    policy: ask\n- id: permission\n');
    expect(text).toContain("danger-full-access: { sandbox: danger-full-access, approval: ask }");
    expect(text).not.toMatch(/approval: never/);
    // 网页/渠道的审批、读围栏照旧
    expect(text).toContain("- id: amb-bridge");
    expect(text).toContain("- id: amb-permission");
    expect(JSON.parse(env.AMB_DENY_READ)).toHaveLength(1);
  });
  it("other presets keep DSH's own permission rows", () => {
    for (const p of ["workspace", "readonly"] as const) {
      const { text, env } = patch(p);
      expect(env.DSH_PERMISSION_MODE).toBe(p === "readonly" ? "read-only" : "workspace-write");
      expect(text).not.toContain("amb-delete-gate");
      expect(text).not.toMatch(/^- id: (approval|permission)$/m);
    }
  });
});
