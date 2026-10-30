/**
 * 日志文件（轮转、脱敏、尾部）+ 故障排查（测试模型 / 测试代理的分段判定 / 接口与报告不泄露密钥）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { closeFileLog, initFileLog, lineLogger, logger, readLogTail, redactText, registerSecret } from "../src/log.js";
import { probeChat, testAgent } from "../src/diagnostics.js";
import type { HostEvent } from "../src/agent/host.js";
import type { ProxyEvent } from "../src/agent/bridge.js";
import { mockOpenAI } from "./helpers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "amb-diag-"));

describe("日志文件", () => {
  it("按大小轮转，只保留固定个数", () => {
    const dir = tmp();
    initFileLog(dir, { maxBytes: 2000, files: 3 });
    const log = logger("t");
    for (let i = 0; i < 200; i++) log.info(`line ${i} ${"x".repeat(40)}`);
    closeFileLog();
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(["app.1.log", "app.2.log", "app.log"]);
    for (const f of files) expect(fs.statSync(path.join(dir, f)).size).toBeLessThanOrEqual(2000);
    const tail = readLogTail(5, dir);
    expect(tail).toHaveLength(5);
    expect(tail.at(-1)).toContain("line 199");
    expect(tail[0]).toContain("line 195");
    // 尾部跨文件：当前文件不够时从旧文件补
    const many = readLogTail(60, dir);
    expect(many.at(-1)).toContain("line 199");
    expect(many.length).toBeGreaterThan(fs.readFileSync(path.join(dir, "app.log"), "utf8").trim().split("\n").length);
  });

  it("写进文件的每一行都脱敏：登记过的密钥、sk-/Bearer、URL 令牌参数、JSON 密钥字段", () => {
    const dir = tmp();
    initFileLog(dir);
    registerSecret("ui-token-1234567890");
    const log = logger("t");
    log.info("open http://127.0.0.1:3600/?token=ui-token-1234567890 now");
    log.warn("upstream said", { body: '{"error":{"message":"bad"},"api_key":"mf-live-abcdef123456"}', auth: "Bearer abcdefghijkl", note: "sk-proj-abcdefghijklmnop" });
    log.info("magpie web http://127.0.0.1:5000/?k=AbCdEfGhIjKlMnOp&x=1");
    closeFileLog();
    const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
    expect(text).not.toMatch(/ui-token-1234567890|mf-live-abcdef123456|abcdefghijkl|sk-proj-abcdefghijklmnop|AbCdEfGhIjKlMnOp/);
    expect(text).toContain("?token=***");
    expect(text).toContain("k=***&x=1");
    expect(redactText("x ui-token-1234567890 y")).toBe("x *** y");
  });

  it("控制台坏了（EPIPE）：日志调用不抛错，'error' 事件不成为未捕获异常，日志文件照写", () => {
    const dir = tmp();
    initFileLog(dir);
    const orig = process.stdout.write;
    (process.stdout as any).write = () => {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    };
    try {
      expect(() => logger("t").info("still logged")).not.toThrow();
    } finally {
      (process.stdout as any).write = orig;
    }
    // 异步的写失败以 'error' 事件出现：log.ts 已经挂了监听，不会变成未捕获异常
    expect(process.stdout.listenerCount("error")).toBeGreaterThan(0);
    process.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(() => logger("t").warn("after broken stdout")).not.toThrow();
    closeFileLog();
    const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
    expect(text).toContain("still logged");
    expect(text).toContain("after broken stdout");
  });

  it("子进程输出按行记录（跨块的半行拼起来），带作用域前缀", () => {
    const dir = tmp();
    initFileLog(dir);
    const seen: string[] = [];
    const l = lineLogger("dsh:default", "info", (s) => seen.push(s));
    l.push("first li");
    l.push(Buffer.from("ne\r\nsecond line\nthi"));
    l.push("rd");
    l.flush();
    closeFileLog();
    expect(seen).toEqual(["first line", "second line", "third"]);
    const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
    expect(text).toMatch(/INFO  \[dsh:default\] first line/);
  });
});

describe("测试模型 probeChat", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  beforeAll(async () => {
    llm = await mockOpenAI({ key: "probe-key-123456", reply: () => "pong" });
  });
  afterAll(() => llm.close());

  it("正常：状态码、耗时、回复", async () => {
    const r = await probeChat("direct", llm.url + "/v1", "probe-key-123456", "mock-a");
    expect(r).toMatchObject({ ok: true, status: 200, reply: "pong", model: "mock-a", url: llm.url + "/v1" });
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(llm.calls.at(-1)!.messages[0].content).toMatch(/pong/);
  });
  it("失败：带回错误体，不带密钥", async () => {
    const r = await probeChat("direct", llm.url + "/v1", "wrong-key-abcdef", "mock-a");
    expect(r).toMatchObject({ ok: false, status: 401, error: "bad key" });
    expect(JSON.stringify(r)).not.toContain("wrong-key-abcdef");
  });
  it("连不上：给出原因", async () => {
    const r = await probeChat("gateway", "http://127.0.0.1:9/v1", "", "m", { timeoutMs: 3000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED|fetch failed|超时/);
  });
});

/** 只实现 testAgent 用到的部分：用事件模拟代理进程走到哪一步 */
function fakeApp(script: (h: { emit: (e: HostEvent) => void; proxy: (e: ProxyEvent) => void; text: string }) => Promise<{ text: string }>) {
  const hostListeners = new Set<(e: HostEvent) => void>();
  const proxyListeners = new Set<(e: ProxyEvent) => void>();
  const host = {
    state: "stopped",
    initStage: "",
    diagnostics: () => ({}),
    pid: undefined as number | undefined,
    stderrTail: ["boom from stderr"],
    on: (fn: (e: HostEvent) => void) => (hostListeners.add(fn), () => hostListeners.delete(fn)),
    resetBackoff: () => {},
    runTurn: (input: { text: string }) =>
      script({ emit: (e) => hostListeners.forEach((f) => f(e)), proxy: (e) => proxyListeners.forEach((f) => f(e)), text: input.text }).then((r) => ({ ...r, sessionId: "s", files: [], usage: { tokens: 0, window: 0, maxTokens: 0 } })),
  };
  const app: any = {
    agent: {
      available: true,
      host: () => host,
    diagnostics: () => ({ turns: [] }),
      settings: () => ({ memory: { enabled: true } }),
      bridge: { onProxy: (fn: (e: ProxyEvent) => void) => (proxyListeners.add(fn), () => proxyListeners.delete(fn)) },
    },
    store: { listBots: () => [{ id: "b1" }], getBot: () => ({ id: "b1", defaultModel: "m1" }), clearAgentSession: () => {} },
    config: { llm: { defaultModel: "" }, agent: { mode: "dsh" } },
    runtime: { listModels: async () => ["m1"] },
    routeModel: (_bot: string, m: string) => m,
    lastDiagnostics: {},
  };
  return app as App;
}
const TOOLS = ["present", "ask_user_question", "remember", "bash"];

describe("测试代理：分段定位", () => {
  it("全部通过", async () => {
    const app = fakeApp(async ({ emit, proxy, text }) => {
      emit({ type: "spawned", pid: 42 });
      emit({ type: "initialized", pid: 42, ms: 1200 });
      proxy({ phase: "request", id: 1, path: "/v1/chat/completions", tools: TOOLS, lastUser: text });
      proxy({ phase: "response", id: 1, path: "/v1/chat/completions", status: 200, ms: 300 });
      return { text: "pong" };
    });
    const r = await testAgent(app, { timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    expect(r.stages.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(r.stages[1]).toMatchObject({ ms: 1200, detail: "pid 42" });
    expect(r.stages[3]).toMatchObject({ ms: 300, detail: "HTTP 200" });
    expect(r.reply).toBe("pong");
    expect((app as any).lastDiagnostics.agent).toBe(r);
  });

  it("模型请求发出后上游一直不响应：卡在“调用模型”（超时）", async () => {
    const app = fakeApp(({ emit, proxy, text }) => {
      emit({ type: "spawned", pid: 7 });
      emit({ type: "initialized", pid: 7, ms: 10 });
      proxy({ phase: "request", id: 9, path: "/v1/chat/completions", tools: TOOLS, lastUser: text });
      return new Promise(() => {});
    });
    const r = await testAgent(app, { timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.stuckAt).toBe("model");
    expect(r.stages.map((s) => s.status)).toEqual(["ok", "ok", "ok", "timeout", "skipped"]);
    expect(r.stages[3].detail).toContain("上游没有响应");
  }, 10_000);

  it("初始化失败：卡在“启动代理进程”，带上错误", async () => {
    const app = fakeApp(async ({ emit }) => {
      emit({ type: "spawned", pid: 7 });
      emit({ type: "failed", message: "initialize timed out after 90000ms; stderr tail: plugin amb-memory failed" });
      throw new Error("initialize timed out after 90000ms");
    });
    const r = await testAgent(app, { timeoutMs: 5000 });
    expect(r.stuckAt).toBe("spawn");
    expect(r.stages[1]).toMatchObject({ status: "fail" });
    expect(r.stages[1].detail).toContain("plugin amb-memory failed");
    expect(r.stages.slice(2).map((s) => s.status)).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("插件工具缺失、上游 401：分别标在“加载插件”和“调用模型”", async () => {
    const app = fakeApp(async ({ emit, proxy, text }) => {
      emit({ type: "initialized", pid: 1, ms: 5 });
      proxy({ phase: "request", id: 1, path: "/v1/chat/completions", tools: ["bash"], lastUser: text });
      proxy({ phase: "response", id: 1, path: "/v1/chat/completions", status: 401, ms: 20, error: "invalid api key" });
      throw new Error("401 invalid api key");
    });
    const r = await testAgent(app, { timeoutMs: 5000 });
    expect(r.stages[2]).toMatchObject({ status: "fail" });
    expect(r.stages[2].detail).toContain("present");
    expect(r.stages[3]).toMatchObject({ status: "fail", detail: "HTTP 401：invalid api key" });
  });

  it("别的会话的模型请求不算（按诊断标记区分）", async () => {
    const app = fakeApp(({ emit, proxy }) => {
      emit({ type: "initialized", pid: 1, ms: 5 });
      proxy({ phase: "request", id: 3, path: "/v1/chat/completions", tools: TOOLS, lastUser: "someone else's chat" });
      proxy({ phase: "response", id: 3, path: "/v1/chat/completions", status: 200, ms: 20 });
      return new Promise(() => {});
    });
    const r = await testAgent(app, { timeoutMs: 5000 });
    expect(r.stuckAt).toBe("plugins");
    expect(r.stages[2].detail).toContain("没有发出模型请求");
  }, 10_000);

  it("代理进程中途退出：标在当时那一步，并附 stderr", async () => {
    const app = fakeApp(async ({ emit }) => {
      emit({ type: "initialized", pid: 1, ms: 5 });
      emit({ type: "exit", pid: 1, code: 3, signal: null });
      throw new Error("DeepSeek Harness runtime exited");
    });
    const r = await testAgent(app, { timeoutMs: 5000 });
    expect(r.stuckAt).toBe("plugins");
    expect(r.stages[2].detail).toMatch(/code=3.*boom from stderr/);
  });
});

describe("故障排查接口", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let app: App;
  let base: string;
  const TOKEN = "ui-token-for-diag-tests";
  const KEY = "gw-key-for-diag-tests";
  const api = async (p: string, init: { method?: string; body?: unknown; token?: string | null } = {}) => {
    const res = await fetch(base + "/amb/api" + p, {
      method: init.method ?? "GET",
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.token === null ? {} : { "x-amb-token": init.token ?? TOKEN }) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    return { status: res.status, json, text };
  };

  beforeAll(async () => {
    llm = await mockOpenAI({ key: KEY, models: ["mock-a"], reply: () => "pong" });
    const dataDir = tmp();
    const config = loadConfig({
      dataDir,
      env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: KEY, AMB_UI_PORT: "0", AMB_UI_TOKEN: TOKEN, AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" },
    });
    app = new App(config, { printQrToTerminal: false });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  });
  afterAll(async () => {
    await app?.stop();
    await llm?.close();
  });

  it("/status 不进会话队列：前面有卡住的回合也立刻回答", async () => {
    let release!: () => void;
    void app.queue.run("web:default:console", () => new Promise<void>((r) => (release = r)));
    const t0 = Date.now();
    const r = await api("/bots/default/chat", { method: "POST", body: { text: "/status" } });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.json.reply).toContain("当前模型");
    expect(r.json.reply).toContain("纯对话模式");
    release();
  });

  it("需要访问令牌", async () => {
    expect((await api("/diagnostics", { token: null })).status).toBe(401);
    expect((await api("/diagnostics/logs", { token: "wrong" })).status).toBe(401);
  });

  it("状态：版本、平台、目录、网关与代理", async () => {
    const r = await api("/diagnostics");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ platform: process.platform, arch: process.arch, gateway: { mode: "external" }, agent: { enabled: false, available: false } });
    expect(r.json.dataDir).toBe(app.config.dataDir);
    expect(r.json.logFile).toBe(path.join(app.config.dataDir, "logs", "app.log"));
    expect(r.text).not.toContain(KEY);
    expect(r.text).not.toContain(TOKEN);
  });

  it("测试模型：外部端点模式只直连，网关一项标为未测", async () => {
    const r = await api("/diagnostics/test-model", { method: "POST", body: {} });
    expect(r.status).toBe(200);
    expect(r.json.model).toBe("mock-a");
    expect(r.json.direct).toMatchObject({ ok: true, status: 200, reply: "pong" });
    expect(r.json.gateway.skipped).toBeTruthy();
    expect(llm.calls.at(-1)!.auth).toBe(`Bearer ${KEY}`);
    expect(r.text).not.toContain(KEY);
  });

  it("测试代理：代理关闭时停在第一步并说明原因", async () => {
    const r = await api("/diagnostics/test-agent", { method: "POST", body: {} });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, stuckAt: "spawn" });
    expect(r.json.stages[1].detail).toContain("代理模式已关闭");
    expect((await api("/diagnostics/test-agent", { method: "POST", body: { botId: "nope" } })).status).toBe(404);
  });

  it("重启代理进程、写操作要求 JSON", async () => {
    const r = await api("/diagnostics/restart-agent", { method: "POST", body: {} });
    expect(r.status).toBe(200);
    expect(r.json.restarted).toEqual([]);
    const bad = await fetch(base + "/amb/api/diagnostics/restart-agent", { method: "POST", headers: { "x-amb-token": TOKEN, "content-type": "text/plain" }, body: "{}" });
    expect(bad.status).toBe(415);
  });

  it("日志尾部与诊断报告：带测试结果，不含任何密钥", async () => {
    const logs = await api("/diagnostics/logs?lines=50");
    expect(logs.status).toBe(200);
    expect(logs.json.lines.length).toBeGreaterThan(0);
    expect(logs.json.lines.join("\n")).toMatch(/\[app\] anymodel bot .* starting/);
    const rep = await api("/diagnostics/report");
    expect(rep.status).toBe(200);
    expect(rep.json.text).toContain("[测试模型]");
    expect(rep.json.text).toContain("[测试代理]");
    expect(rep.json.text).toContain("[最近 200 行日志]");
    expect(rep.text).not.toContain(KEY);
    expect(rep.text).not.toContain(TOKEN);
  });
});

describe("代理还在启动时的消息", () => {
  it("先说明在启动，等待超过时限就由模型直接回答（启动在后台继续）", async () => {
    const { BotRuntime } = await import("../src/core/runtime.js");
    const { Store } = await import("../src/store/db.js");
    const store = new Store(path.join(tmp(), "t.db"));
    const bot = store.createBot({ id: "b1", name: "b", defaultModel: "m1" });
    let ensureCalls = 0;
    const host = { state: "starting", ensure: () => (ensureCalls++, new Promise(() => {})), diagnostics: () => ({ firstStart: true }) };
    const agent: any = {
      available: true,
      host: () => host,
      approvals: { bindSink: () => () => {}, handleReply: () => ({ handled: false }), pending: () => [] },
      runTurn: () => Promise.reject(new Error("should not run")),
      settings: () => ({ memory: { enabled: false } }),
    };
    const models: any = { listModels: async () => ["m1"], streamChat: async (_r: unknown, onDelta: (d: string) => void) => (onDelta("plain answer"), "plain answer") };
    const rt = new BotRuntime({ store, models, defaultModel: () => "", contextMessages: 10, contextChars: 5000, agent });
    const ops: any[] = [];
    const prev = process.env.AMB_AGENT_START_WAIT_MS;
    process.env.AMB_AGENT_START_WAIT_MS = "300";
    try {
      const ev: any = { id: "e1", channel: "web", botId: bot.id, conversation: { kind: "dm", id: "console" }, sender: { id: "u", name: "u" }, parts: [{ type: "text", text: "hi" }], replyHandle: {}, receivedAt: Date.now() };
      await rt.handle(ev, { apply: async (op: any) => void ops.push(op) });
    } finally {
      if (prev === undefined) delete process.env.AMB_AGENT_START_WAIT_MS;
      else process.env.AMB_AGENT_START_WAIT_MS = prev;
    }
    expect(ensureCalls).toBe(1);
    expect(ops.find((o) => o.type === "stream.update")?.text).toContain("代理正在启动");
    const fin = ops.filter((o) => o.type === "stream.finish").at(-1);
    expect(fin.text).toContain("代理还在启动");
    expect(fin.text).toContain("plain answer");
    // 历史里只存模型的回答，不存提示
    expect(store.listMessages("b1:web:console").map((m: any) => m.content)).toEqual(["hi", "plain answer"]);
    store.close();
  });
});
