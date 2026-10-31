/**
 * 服务端压缩（server-compaction.ts）：前缀匹配与改写、探测与缓存、各种失败时的退回，以及经真实 bridge 的整条路径。
 * 上游是按 OpenAI 文档行为写的 mock：/v1/responses/compact 保留用户消息并给出一个带密文的 compaction 项；
 * /v1/responses 只接受这个 mock 给同一模型签出的压缩项。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listen } from "./helpers.js";
import { AgentBridge } from "../src/agent/bridge.js";
import { AgentManager } from "../src/agent/manager.js";
import { ActivityLog } from "../src/agent/activity.js";
import { Store } from "../src/store/db.js";
import { locateDshRuntime } from "../src/agent/host.js";
import { MagpieSupervisor, findAppRoot } from "../src/magpie/supervisor.js";
import { loadModelInfo } from "../src/account/model-info.js";
import {
  ServerCompaction,
  compactLine,
  compactedWindow,
  estimateTokens,
  peekStream,
  prefixHashes,
  splitLead,
  sseVerdict,
  type CompactionEvent,
} from "../src/agent/server-compaction.js";

const LEAD = { role: "developer", content: "SYSTEM PROMPT" };
const TOOLS = [{ type: "function", name: "bash", description: "run", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }, strict: false }];
const user = (t: string) => ({ role: "user", content: [{ type: "input_text", text: t }] });
/** 一次工具调用（约 1000 tokens 的输出） */
const call = (i: number) => [
  { type: "reasoning", id: `rs_${i}`, summary: [], encrypted_content: `R${i}` },
  { type: "function_call", id: `fc_${i}`, call_id: `call_${i}`, name: "bash", arguments: JSON.stringify({ command: `ls ${i}` }) },
  { type: "function_call_output", call_id: `call_${i}`, output: `${i}`.padEnd(3000, "x") },
];
const calls = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => call(from + k)).flat();
/** pi-ai 发出的 Responses 请求形状 */
const req = (model: string, items: unknown[], session = "sess-1", lead: unknown[] = [LEAD]) => ({
  model,
  input: [...lead, ...items],
  stream: true,
  prompt_cache_key: session,
  store: false,
  tools: TOOLS,
  reasoning: { effort: "medium", summary: "auto" },
  include: ["reasoning.encrypted_content"],
});
const buf = (j: unknown) => Buffer.from(JSON.stringify(j));
const HEADERS = { session_id: "sess-1" };

interface MockState {
  compact: "ok" | "404" | "badshape" | "503";
  items: "ok" | "reject" | "streamfail";
  /** 回复里报的 input_tokens = 估算 × boost */
  boost: number;
  /** 助手回复的文字 */
  reply: string;
}

/** 按文档行为的上游：记下每个请求 */
async function mockUpstream() {
  const state: MockState = { compact: "ok", items: "ok", boost: 1, reply: "ok" };
  const seen: Array<{ path: string; auth?: string; body: any }> = [];
  let n = 0;
  const srv = await listen(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const p = String(req.url).split("?")[0];
    seen.push({ path: p, auth: req.headers.authorization, body });
    const name = String(body.model ?? "").split("/").pop();
    const json = (status: number, j: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(j));
    if (p === "/v1/responses/compact") {
      if (state.compact === "404") return json(404, { error: { message: "Invalid URL (POST /v1/responses/compact)", type: "invalid_request_error" } });
      if (state.compact === "503") return json(503, { error: { message: "upstream overloaded" } });
      // 保留用户（和 developer）消息，其余压进一个 compaction 项
      const kept = body.input.filter((it: any) => it.role === "user" || it.role === "developer").map((it: any, i: number) => ({ id: `msg_${i}`, type: "message", status: "completed", ...it }));
      const output = state.compact === "badshape" ? kept : [...kept, { type: "compaction", id: `cmp_${++n}`, encrypted_content: `ENC.${name}.${n}` }];
      return json(200, { id: `resp_c${n}`, object: "response.compaction", created_at: 1, output, usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 } });
    }
    if (p !== "/v1/responses") return json(404, { error: { message: "not found" } });
    const sealed = (body.input as any[]).filter((it) => it?.type === "compaction");
    if (sealed.length) {
      if (state.items === "reject") return json(400, { error: { message: "Invalid value: 'compaction'. Supported values are: 'message', 'reasoning', ...", type: "invalid_request_error" } });
      if (sealed.some((it) => String(it.encrypted_content).split(".")[1] !== name)) return json(400, { error: { message: "The encrypted content could not be decrypted", code: "invalid_encrypted_content" } });
    }
    const input_tokens = Math.round(estimateTokens(body.input) * state.boost);
    const usage = { input_tokens, output_tokens: 10, total_tokens: input_tokens + 10 };
    const output = [{ type: "message", id: `msg_out${seen.length}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: state.reply, annotations: [] }] }];
    if (!body.stream) return json(200, { id: "resp_1", object: "response", status: "completed", output, usage });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (o: any) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
    ev({ type: "response.created", response: { id: "resp_1", status: "in_progress" } });
    if (sealed.length && state.items === "streamfail") {
      ev({ type: "error", code: "invalid_request_error", message: "compaction item not supported" });
      return res.end();
    }
    ev({ type: "response.output_item.added", output_index: 0, item: { ...output[0], content: [] } });
    ev({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: state.reply });
    ev({ type: "response.output_item.done", output_index: 0, item: output[0] });
    ev({ type: "response.completed", response: { id: "resp_1", status: "completed", output, usage } });
    res.end();
  });
  return { ...srv, state, seen, of: (p: string) => seen.filter((s) => s.path === p) };
}

let dir = "";
let mock: Awaited<ReturnType<typeof mockUpstream>>;
const env = { ...process.env };

function make(o: { listed?: boolean | undefined; key?: string; now?: () => number; events?: CompactionEvent[] } = {}) {
  return new ServerCompaction({
    dir,
    upstream: () => ({ baseUrl: mock.url + "/v1", apiKey: "gateway-key" }),
    endpoint: (model) => ({ baseUrl: mock.url + "/v1", apiKey: o.key ?? "mf-key-1", model: model.split("/").pop()!, headers: { "x-skill": "t" } }),
    listed: async () => ("listed" in o ? o.listed : true),
    limits: async () => ({ window: 400_000, maxTokens: 32_000 }),
    onEvent: (e) => o.events?.push(e),
    now: o.now,
  });
}

/** 发一次请求（先让窗口大小等后台信息就位），等后台任务结束 */
async function send(sc: ServerCompaction, body: unknown, headers: Record<string, string> = HEADERS) {
  const plan = sc.prepare("/v1/responses", headers, buf(body));
  await sc.settled();
  return plan;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-sc-"));
  mock = await mockUpstream();
  process.env.AMB_SERVER_COMPACTION_TOKENS = "4000";
  delete process.env.AMB_SERVER_COMPACTION;
});
afterEach(async () => {
  process.env = { ...env };
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("服务端压缩：纯函数", () => {
  it("压缩线：不超过 20 万、窗口一半，并且在 DSH 自己的压缩线之前；太小的窗口不做", () => {
    delete process.env.AMB_SERVER_COMPACTION_TOKENS;
    expect(compactLine(1_050_000, 32_000)).toBe(200_000);
    expect(compactLine(400_000, 32_000)).toBe(200_000);
    // 256k：DSH 在 min(204.8k, 158.5k) 压缩，服务端压缩要在它之前
    expect(compactLine(256_000, 32_000)).toBe(128_000);
    expect(compactLine(200_000, 32_000)).toBeLessThan(200_000 - 32_000 - 65_536);
    expect(compactLine(64_000, 16_000)).toBe(0);
    process.env.AMB_SERVER_COMPACTION_TOKENS = "1234";
    expect(compactLine(1_050_000, 32_000)).toBe(1234);
  });

  it("估算偏大：中文按字节，密文和图片单算", () => {
    expect(estimateTokens([user("a".repeat(3000))])).toBeGreaterThanOrEqual(1000);
    expect(estimateTokens([user("中".repeat(1000))])).toBeGreaterThanOrEqual(1000);
    expect(estimateTokens([{ type: "compaction", encrypted_content: "x".repeat(4000) }])).toBeGreaterThanOrEqual(1000);
    expect(estimateTokens([{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64," + "A".repeat(500_000) }] }])).toBeLessThan(2000);
  });

  it("开头的 system / developer 消息是系统提示，不算进历史哈希", () => {
    const { lead, rest } = splitLead([LEAD, { role: "system", content: "x" }, user("hi"), { role: "developer", content: "mid" }]);
    expect(lead).toHaveLength(2);
    expect(rest).toEqual([user("hi"), { role: "developer", content: "mid" }]);
    // 逐项累计：前缀相同哈希就相同，任何一项不同之后都不同
    const a = prefixHashes([user("1"), user("2"), user("3")]);
    const b = prefixHashes([user("1"), user("2"), user("X")]);
    expect(a).toHaveLength(4);
    expect(a.slice(0, 3)).toEqual(b.slice(0, 3));
    expect(a[3]).not.toBe(b[3]);
  });

  it("压缩回复的校验：要有带密文的 compaction 项、object 对得上", () => {
    const ok = { object: "response.compaction", output: [user("hi"), { type: "compaction", id: "cmp_1", encrypted_content: "gAAA" }] };
    expect(compactedWindow(ok)).toEqual(ok.output);
    expect(compactedWindow({ output: ok.output })).toEqual(ok.output);
    expect(compactedWindow({ ...ok, object: "response" })).toBeUndefined();
    expect(compactedWindow({ object: "response.compaction", output: [user("hi")] })).toBeUndefined();
    expect(compactedWindow({ object: "response.compaction", output: [{ type: "compaction", encrypted_content: "" }] })).toBeUndefined();
    expect(compactedWindow({ object: "response.compaction", output: [1, { type: "compaction", encrypted_content: "x" }] })).toBeUndefined();
    expect(compactedWindow({ error: { message: "x" } })).toBeUndefined();
  });

  it("流开头的判断：created / in_progress 之后看第一个实质事件", async () => {
    const ev = (o: any) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    expect(sseVerdict(ev({ type: "response.created" }))).toBe("wait");
    expect(sseVerdict(ev({ type: "response.created" }) + ev({ type: "response.output_item.added" }))).toBe("ok");
    expect(sseVerdict(ev({ type: "response.created" }) + ev({ type: "error", message: "bad item" }))).toEqual({ error: "bad item" });
    expect(sseVerdict(ev({ type: "response.failed", response: { error: { message: "nope" } } }))).toEqual({ error: "nope" });
    expect(sseVerdict('data: {"type":"response.output_text.delta"')).toBe("wait");
    // 看过开头后交出去的流从第一个字节开始
    const enc = new TextEncoder();
    const parts = [ev({ type: "response.created" }), ev({ type: "response.output_text.delta", delta: "a" }), ev({ type: "response.completed" })];
    const src = new ReadableStream<Uint8Array>({ start: (c) => (parts.forEach((p) => c.enqueue(enc.encode(p))), c.close()) });
    const peek = await peekStream(src);
    expect(peek.error).toBeUndefined();
    expect(await new Response(peek.stream).text()).toBe(parts.join(""));
  });
});

describe("服务端压缩：探测、压缩与改写", () => {
  it("先探测一次，过线后在后台压缩，之后同一会话的请求把这段历史换成压缩窗口（系统提示用当次的）", async () => {
    const events: CompactionEvent[] = [];
    const sc = make({ events });
    const M = "mf/good";
    // 短对话：不探测、不改写
    expect((await send(sc, req(M, [user("start"), ...calls(1, 1)])))!.rewritten).toBe(false);
    expect(mock.seen).toHaveLength(0);
    // 过了压缩线的一半：探测（直连压缩 + 经网关续接）
    await send(sc, req(M, [user("start"), ...calls(1, 3)]));
    const [probeCompact] = mock.of("/v1/responses/compact");
    expect(probeCompact.body.model).toBe("good");
    expect(probeCompact.auth).toBe("Bearer mf-key-1");
    const [follow] = mock.of("/v1/responses");
    expect(follow.auth).toBe("Bearer gateway-key");
    expect(follow.body).toMatchObject({ model: M, store: false, stream: false });
    expect(follow.body.input.at(-2)).toMatchObject({ type: "compaction" });
    expect(sc.status()[M]).toMatchObject({ ok: true });
    // 过了压缩线：后台压缩这次请求的全部输入
    const h3 = [user("start"), ...calls(1, 5)];
    const p3 = await send(sc, req(M, h3));
    expect(p3!.rewritten).toBe(false);
    const compact = mock.of("/v1/responses/compact")[1];
    expect(compact.body).toEqual({ model: "good", input: [LEAD, ...h3], tools: TOOLS });
    expect(events).toEqual([expect.objectContaining({ session: "sess-1", model: M, ok: true })]);
    expect(events[0].after!).toBeLessThan(events[0].before);
    // 往后长的历史：开头这段换成压缩窗口（窗口里重复的系统提示去掉），新增的原样接上
    const p4 = await send(sc, req(M, [...h3, ...call(6)], "sess-1", [{ role: "developer", content: "SYSTEM PROMPT v2" }]));
    expect(p4!.rewritten).toBe(true);
    const sent = JSON.parse(p4!.body.toString());
    expect(sent.input).toEqual([
      { role: "developer", content: "SYSTEM PROMPT v2" },
      { id: "msg_1", type: "message", status: "completed", ...user("start") },
      { type: "compaction", id: "cmp_2", encrypted_content: "ENC.good.2" },
      ...call(6),
    ]);
    expect(sent).toMatchObject({ model: M, tools: TOOLS, store: false, prompt_cache_key: "sess-1" });
    // 上游接受改写后的请求
    const up = await fetch(mock.url + "/v1/responses", { method: "POST", body: new Uint8Array(p4!.body) });
    expect(up.status).toBe(200);
    p4!.accepted();
  });

  it("历史开头对不上、换了模型或 Key 都原样发；重启后从磁盘读回映射", async () => {
    const sc = make();
    const M = "mf/good";
    const h = [user("start"), ...calls(1, 5)];
    await send(sc, req(M, h.slice(0, 1)));
    await send(sc, req(M, [user("start"), ...calls(1, 3)]));
    await send(sc, req(M, h));
    expect(mock.of("/v1/responses/compact")).toHaveLength(2);
    // 中间改了一项（例如 DSH 自己压缩过）：原样
    const edited = [...h];
    edited[3] = { ...(edited[3] as any), output: "changed" };
    expect(sc.prepare("/v1/responses", HEADERS, buf(req(M, [...edited, ...call(6)])))!.rewritten).toBe(false);
    // 同一会话换了模型（那个模型自己也探测通过了）：不把别的模型压出来的项发过去
    const probed = async (s: ServerCompaction, model: string) => {
      for (const n of [0, 3]) await send(s, req(model, [user("probe"), ...calls(1, n)], "sess-probe"), { session_id: "sess-probe" });
      expect(s.status()[model]).toMatchObject({ ok: true });
    };
    await probed(sc, "mf/other");
    expect(sc.prepare("/v1/responses", HEADERS, buf(req("mf/other", [...h, ...call(6)])))!.rewritten).toBe(false);
    expect(sc.prepare("/v1/responses", HEADERS, buf(req(M, [...h, ...call(6)])))!.rewritten).toBe(true);
    // 同一模型换了 Key（可能换了账户；新 Key 也探测通过了）
    const other = make({ key: "mf-key-2" });
    await probed(other, M);
    expect(other.prepare("/v1/responses", HEADERS, buf(req(M, [...h, ...call(6)])))!.rewritten).toBe(false);
    await sc.settled();
    await other.settled();
    // 应用重启：探测结果和映射都在磁盘上
    const again = make();
    const plan = again.prepare("/v1/responses", HEADERS, buf(req(M, [...h, ...call(6)])));
    expect(plan!.rewritten).toBe(true);
    expect(JSON.parse(plan!.body.toString()).input.filter((it: any) => it.type === "compaction")).toHaveLength(1);
    // 没有 prompt_cache_key 时按会话头找
    const { prompt_cache_key: _k, ...noKey } = req(M, [...h, ...call(6)]);
    expect(again.prepare("/v1/responses", HEADERS, buf(noKey))!.rewritten).toBe(true);
    await again.settled();
  });

  it("目录没列出（或不知道）就不探测，也不改写", async () => {
    for (const listed of [false, undefined]) {
      const sc = make({ listed });
      for (const n of [1, 3, 5, 7]) await send(sc, req("mf/good", [user("start"), ...calls(1, n)]));
      expect(mock.seen).toHaveLength(0);
    }
  });

  it("压缩端点 404 / 回复里没有压缩项：记为不支持，存盘，一天内不再探测", async () => {
    let now = 1_800_000_000_000;
    for (const mode of ["404", "badshape"] as const) {
      mock.state.compact = mode;
      mock.seen.length = 0;
      fs.rmSync(path.join(dir, "probe.json"), { force: true });
      const sc = make({ now: () => now });
      await send(sc, req("mf/good", [user("start")]));
      for (const n of [3, 5, 7]) await send(sc, req("mf/good", [user("start"), ...calls(1, n)]));
      expect(mock.of("/v1/responses/compact"), mode).toHaveLength(1);
      expect(mock.of("/v1/responses"), mode).toHaveLength(0);
      expect(sc.status()["mf/good"]).toMatchObject({ ok: false });
      // 重启后仍记得；过了一天重新探测
      const again = make({ now: () => now });
      await send(again, req("mf/good", [user("start"), ...calls(1, 8)]));
      expect(mock.of("/v1/responses/compact"), mode).toHaveLength(1);
      now += 25 * 3600_000;
      await send(again, req("mf/good", [user("start"), ...calls(1, 9)]));
      await send(again, req("mf/good", [user("start"), ...calls(1, 9)]));
      expect(mock.of("/v1/responses/compact"), mode).toHaveLength(2);
    }
  });

  it("续接请求不收压缩项：探测不通过", async () => {
    mock.state.items = "reject";
    const sc = make();
    await send(sc, req("mf/good", [user("start")]));
    for (const n of [3, 5, 7]) await send(sc, req("mf/good", [user("start"), ...calls(1, n)]));
    expect(sc.status()["mf/good"]).toMatchObject({ ok: false, reason: expect.stringContaining("HTTP 400") });
    expect(mock.of("/v1/responses/compact")).toHaveLength(1);
  });

  it("临时失败（5xx）不记结论，10 分钟后再探测", async () => {
    let now = 1_800_000_000_000;
    mock.state.compact = "503";
    const sc = make({ now: () => now });
    await send(sc, req("mf/good", [user("start")]));
    await send(sc, req("mf/good", [user("start"), ...calls(1, 3)]));
    await send(sc, req("mf/good", [user("start"), ...calls(1, 5)]));
    expect(mock.of("/v1/responses/compact")).toHaveLength(1);
    expect(sc.status()).toEqual({});
    mock.state.compact = "ok";
    now += 11 * 60_000;
    await send(sc, req("mf/good", [user("start"), ...calls(1, 6)]));
    expect(sc.status()["mf/good"]).toMatchObject({ ok: true });
  });

  it("改写过的请求被拒、原请求能过：这段映射作废，记下不支持，之后不再改写", async () => {
    const sc = make();
    const h = [user("start"), ...calls(1, 5)];
    await send(sc, req("mf/good", h.slice(0, 1)));
    await send(sc, req("mf/good", [user("start"), ...calls(1, 3)]));
    await send(sc, req("mf/good", h));
    const plan = sc.prepare("/v1/responses", HEADERS, buf(req("mf/good", [...h, ...call(6)])))!;
    expect(plan.rewritten).toBe(true);
    // 5xx 一次：映射还留着
    plan.rejected(502, "bad gateway", true);
    expect(sc.prepare("/v1/responses", HEADERS, buf(req("mf/good", [...h, ...call(6)])))!.rewritten).toBe(true);
    plan.rejected(400, "Invalid value: 'compaction'", true);
    expect(sc.status()["mf/good"]).toMatchObject({ ok: false });
    expect(sc.prepare("/v1/responses", HEADERS, buf(req("mf/good", [...h, ...calls(6, 7)])))!.rewritten).toBe(false);
    await sc.settled();
  });

  it("历史不是往后长的（例如 DSH 的摘要请求）不触发压缩；压出来没被用上的会话半小时内不再压", async () => {
    const sc = make();
    await send(sc, req("mf/good", [user("start")]));
    await send(sc, req("mf/good", [user("start"), ...calls(1, 3)]));
    // 和上一次不是同一段历史
    await send(sc, req("mf/good", [user("other start"), ...calls(1, 5)]));
    expect(mock.of("/v1/responses/compact")).toHaveLength(1);
    await send(sc, req("mf/good", [user("other start"), ...calls(1, 6)]));
    expect(mock.of("/v1/responses/compact")).toHaveLength(2);
    // 压完以后历史开头又变了（映射用不上），还在线上：不反复压
    for (const n of [7, 8, 9]) await send(sc, req("mf/good", [user("third"), ...calls(1, n)]));
    expect(mock.of("/v1/responses/compact")).toHaveLength(2);
  });

  it("AMB_SERVER_COMPACTION=0 整个关掉；不是无状态 Responses 请求的不碰", async () => {
    const sc = make();
    const body = req("mf/good", [user("start"), ...calls(1, 5)]);
    expect(sc.prepare("/v1/chat/completions", HEADERS, buf(body))).toBeUndefined();
    expect(sc.prepare("/v1/responses", HEADERS, buf({ ...body, store: true }))).toBeUndefined();
    expect(sc.prepare("/v1/responses", HEADERS, buf({ ...body, previous_response_id: "resp_1" }))).toBeUndefined();
    expect(sc.prepare("/v1/responses", HEADERS, buf({ ...body, context_management: [{ type: "compaction", compact_threshold: 1000 }] }))).toBeUndefined();
    expect(sc.prepare("/v1/responses", HEADERS, Buffer.from("not json"))).toBeUndefined();
    expect(sc.prepare("/v1/responses", HEADERS, buf(body))).toBeDefined();
    process.env.AMB_SERVER_COMPACTION = "0";
    expect(sc.prepare("/v1/responses", HEADERS, buf(body))).toBeUndefined();
    await sc.settled();
  });
});

describe("服务端压缩：经 bridge", () => {
  async function bridgeWith(sc: ServerCompaction) {
    const bridge = new AgentBridge({
      upstream: () => ({ baseUrl: mock.url + "/v1", apiKey: "gateway-key" }),
      ask: async () => ({ id: "" }),
      wait: async () => ({}),
      cancel: async () => {},
      compaction: sc,
    });
    await bridge.start();
    const post = async (body: unknown) => {
      const r = await fetch(`${bridge.url}/v1/responses`, { method: "POST", headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json", session_id: "sess-1" }, body: JSON.stringify(body) });
      const text = await r.text();
      await sc.settled();
      return { status: r.status, text };
    };
    return { bridge, post };
  }

  /** 让会话走到"已压缩"：返回下一次请求会被改写的历史 */
  async function compacted(post: (b: unknown) => Promise<{ status: number; text: string }>) {
    const h = [user("start"), ...calls(1, 5)];
    for (const items of [h.slice(0, 1), [user("start"), ...calls(1, 3)], h]) expect((await post(req("mf/good", items))).status).toBe(200);
    expect(mock.of("/v1/responses/compact")).toHaveLength(2);
    return [...h, ...call(6)];
  }

  it("改写后的请求经 bridge 发出；上游拒绝压缩项时用原请求重发一次，回合照常，之后不再改写", async () => {
    const sc = make();
    const { bridge, post } = await bridgeWith(sc);
    try {
      const h = await compacted(post);
      let r = await post(req("mf/good", h));
      expect(r.status).toBe(200);
      expect(r.text).toContain("response.completed");
      const last = mock.of("/v1/responses").at(-1)!;
      expect(last.auth).toBe("Bearer gateway-key");
      expect(last.body.input.some((it: any) => it.type === "compaction")).toBe(true);
      // 上游（换了渠道等）不再收压缩项：bridge 重发原请求，DSH 看到的是成功
      mock.state.items = "reject";
      const before = mock.of("/v1/responses").length;
      r = await post(req("mf/good", [...h, ...call(7)]));
      expect(r.status).toBe(200);
      expect(r.text).toContain("response.completed");
      const [rejected, original] = mock.of("/v1/responses").slice(before);
      expect(rejected.body.input.some((it: any) => it.type === "compaction")).toBe(true);
      expect(original.body.input).toEqual(req("mf/good", [...h, ...call(7)]).input);
      expect(sc.status()["mf/good"]).toMatchObject({ ok: false });
      // 之后原样发
      r = await post(req("mf/good", [...h, ...calls(7, 8)]));
      expect(r.status).toBe(200);
      expect(mock.of("/v1/responses").at(-1)!.body.input.some((it: any) => it.type === "compaction")).toBe(false);
    } finally {
      await bridge.stop();
    }
  });

  it("流一开头就报错（还没交出任何字节）：同样用原请求重发", async () => {
    const sc = make();
    const { bridge, post } = await bridgeWith(sc);
    try {
      const h = await compacted(post);
      mock.state.items = "streamfail";
      const before = mock.of("/v1/responses").length;
      const r = await post(req("mf/good", h));
      expect(r.status).toBe(200);
      expect(r.text).not.toContain("compaction item not supported");
      expect(r.text).toContain("response.completed");
      expect(mock.of("/v1/responses").length - before).toBe(2);
      expect(sc.status()["mf/good"]).toMatchObject({ ok: false, reason: expect.stringContaining("stream error") });
    } finally {
      await bridge.stop();
    }
  });

  it("上游报的用量也算进压缩线（估算偏小时不至于压得太晚）", async () => {
    const sc = make();
    const { bridge, post } = await bridgeWith(sc);
    try {
      mock.state.boost = 3;
      await post(req("mf/good", [user("start")]));
      await post(req("mf/good", [user("start"), ...calls(1, 2)]));
      expect(sc.status()["mf/good"]).toMatchObject({ ok: true });
      // 估算还不到 4000，但上一次回复报了约三倍的用量
      const next = req("mf/good", [user("start"), ...calls(1, 2), user("x")]);
      expect(estimateTokens(next.input) + estimateTokens(next.tools)).toBeLessThan(4000);
      await post(next);
      expect(mock.of("/v1/responses/compact")).toHaveLength(2);
    } finally {
      await bridge.stop();
    }
  });
});

const runtime = locateDshRuntime(findAppRoot());
const piAi = runtime ? path.join(runtime, "node_modules", "@earendil-works", "pi-ai") : "";

describe("服务端压缩：DSH 用的 pi-ai 客户端", () => {
  it.skipIf(!runtime || !fs.existsSync(piAi))("pi-ai 的真实请求经 bridge：过线后压缩、之后的请求带压缩窗口，回合不受影响", async () => {
    const { stream } = await import(pathToFileURL(path.join(piAi, "dist", "api", "openai-responses.js")).href);
    const { normalizeContext } = await import(pathToFileURL(path.join(piAi, "dist", "utils", "transcript.js")).href);
    const sc = make();
    const bridge = new AgentBridge({ upstream: () => ({ baseUrl: mock.url + "/v1", apiKey: "gateway-key" }), ask: async () => ({ id: "" }), wait: async () => ({}), cancel: async () => {}, compaction: sc });
    await bridge.start();
    try {
      const model = { id: "mf/good", name: "good", api: "openai-responses", provider: "magpie", baseUrl: `${bridge.url}/v1`, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400_000, maxTokens: 32_000 };
      const tools = [{ name: "bash", description: "run", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }];
      const messages: any[] = [];
      // 长回复、短提问：压缩只保留用户消息，压完明显变小
      mock.state.reply = "ok " + "z".repeat(3000);
      for (let turn = 1; turn <= 8; turn++) {
        messages.push({ role: "user", content: `turn ${turn}`, timestamp: turn });
        let out: any;
        for await (const e of stream(model, normalizeContext({ systemPrompt: "SYSTEM PROMPT", messages, tools }), { apiKey: bridge.token, sessionId: "sess-pi", reasoningEffort: "medium" })) {
          if (e.type === "done") out = e.message;
          if (e.type === "error") throw new Error(e.error.errorMessage);
        }
        expect(out.content.find((c: any) => c.type === "text")?.text).toBe(mock.state.reply);
        messages.push(out);
        await sc.settled();
      }
      const compacts = mock.of("/v1/responses/compact");
      expect(compacts.length).toBeGreaterThanOrEqual(2);
      // 真实请求（stream:true）里，压缩之后的那些带着压缩项、developer 系统提示在最前
      const real = mock.of("/v1/responses").filter((s) => s.body.stream);
      const withItem = real.filter((s) => s.body.input.some((it: any) => it.type === "compaction"));
      expect(withItem.length).toBeGreaterThan(0);
      for (const s of withItem) {
        expect(s.body.input[0]).toEqual({ role: "developer", content: "SYSTEM PROMPT" });
        expect(s.body.prompt_cache_key).toBe("sess-pi");
        expect(s.body.input.at(-1)).toEqual({ role: "user", content: [{ type: "input_text", text: expect.stringMatching(/^turn \d+$/) }] });
      }
      // 改写后发往上游的比 DSH 发来的小
      expect(estimateTokens(withItem.at(-1)!.body.input)).toBeLessThan(estimateTokens(normalizeContext({ systemPrompt: "SYSTEM PROMPT", messages, tools }).messages));
    } finally {
      await bridge.stop();
    }
  });
});

describe("服务端压缩：活动记录与模型资料", () => {
  it("压缩做完时，正在进行回合的会话多一步「服务端压缩上下文」", () => {
    const store = new Store(":memory:");
    const mgr = new AgentManager({
      store,
      dataDir: dir,
      runtimeDir: undefined,
      upstream: () => ({ baseUrl: "", apiKey: "" }),
      enabled: false,
      serverCompaction: { listed: async () => true, endpoint: () => undefined },
    });
    expect(mgr.serverCompaction).toBeDefined();
    store.setAgentSession("c1", "b1", "sess-1");
    const activity = new ActivityLog();
    mgr.turnsInProgress.set("c1", { botId: "b1", since: 0, lastProgress: 0, activity, abort: new AbortController() });
    (mgr as any).onServerCompaction({ session: "sess-1", model: "mf/good", ok: true, before: 210_000, after: 31_000, at: 1000, ms: 4200 });
    (mgr as any).onServerCompaction({ session: "sess-1", model: "mf/good", ok: false, before: 210_000, at: 2000, ms: 10, error: "HTTP 404" });
    (mgr as any).onServerCompaction({ session: "other", model: "mf/good", ok: true, before: 1, after: 1, at: 3000, ms: 1 });
    expect(activity.steps).toEqual([{ id: "sc1000", kind: "compact", title: "服务端压缩上下文", summary: "约 210k → 31k tokens", status: "ok", at: 1000, ms: 4200 }]);
    expect(mgr.stewardLog.map((l) => l.action)).toEqual(["server-compact", "server-compact-failed"]);
  });

  it("内置网关的 provider 打开 nativeCompaction：只保存一次，失败后 10 分钟内不再试", async () => {
    const sup = new MagpieSupervisor({ dataDir: dir });
    const cfg = path.join(dir, "magpie", "config", "magpie");
    fs.mkdirSync(cfg, { recursive: true });
    const write = (p: Record<string, unknown>) => fs.writeFileSync(path.join(cfg, "providers.json"), JSON.stringify({ providers: [{ id: "modelflare", chat: "https://mf/v1", ...p }] }));
    write({});
    const saves: unknown[] = [];
    let fail = true;
    (sup as any).saveProvider = async (id: string, patch: Record<string, unknown>) => {
      saves.push([id, patch]);
      await new Promise((r) => setTimeout(r, 5));
      if (fail) throw new Error("save refused");
      write(patch);
    };
    expect(sup.nativeCompaction("modelflare")).toBe(false);
    const both = await Promise.allSettled([sup.ensureNativeCompaction("modelflare"), sup.ensureNativeCompaction("modelflare")]);
    expect(both.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(saves).toEqual([["modelflare", { nativeCompaction: true }]]);
    await sup.ensureNativeCompaction("modelflare");
    expect(saves).toHaveLength(1);
    // 冷却过后再试，成功后不再保存
    (sup as any).nativeFailedAt.clear();
    fail = false;
    await sup.ensureNativeCompaction("modelflare");
    expect(sup.nativeCompaction("modelflare")).toBe(true);
    await sup.ensureNativeCompaction("modelflare");
    expect(saves).toHaveLength(2);
  });

  it("模型资料带上价格目录的 supported_endpoint_types", async () => {
    const fetchImpl = (async () =>
      Response.json({ data: [{ model_name: "gpt-6.1-terra", quota_type: 0, supported_endpoint_types: ["openai", "openai-response", "openai-response-compact"] }, { model_name: "grok-4.7", quota_type: 0 }] })) as any;
    const info = await loadModelInfo({ baseUrl: "http://mf/v1", apiKey: "", headers: {}, pricingUrl: "http://mf/api/pricing", fetchImpl });
    expect(info["gpt-6.1-terra"].endpoints).toEqual(["openai", "openai-response", "openai-response-compact"]);
    expect(info["grok-4.7"]?.endpoints).toBeUndefined();
  });
});
