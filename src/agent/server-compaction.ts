/**
 * 服务端压缩（OpenAI Responses API 的 compaction）：长会话里，把 DSH 每次重发的完整历史换成上游压缩出来的窗口。
 *
 * - DSH 的 Responses 客户端（pi-ai）是无状态的：store:false，每次请求都带上全部历史；它不发 context_management，
 *   也会丢掉回复里不认识的 compaction 输出项。所以这件事在 bridge 里做。
 * - 某个会话发往上游的输入过了压缩线，就在后台调一次 POST /responses/compact（内置网关不转发这个路径，直接发给该模型
 *   所在的 Modelflare 连接），记下"这段历史（逐项哈希）→ 压缩后的窗口"，按会话存盘。之后同一会话的请求只要开头逐项
 *   一致，就把这段换成压缩窗口再发（系统提示用当次请求的）；有任何不一致就原样发。压缩不阻塞当次请求。
 * - 价格目录列出 openai-response-compact 只是提示：每个模型（连同所用的 Key）先做一次很小的压缩 + 续接探测，通过了才用，
 *   结果缓存（内存 + 磁盘，会过期）。压缩调用要推理、要付费（实测 30–75 秒），所以目录没列出的不探测，同一模型 + Key
 *   同时只探测一次，"不支持"的结论 7 天内不再探测。
 * - 改写过的请求被拒（4xx、流一开头就报错）时，bridge 用原请求重发一次，这里记下该模型不支持。压缩项只发回产生它的
 *   同一个模型 + 同一个 Key。AMB_SERVER_COMPACTION=0 整个关掉。
 *
 * 接口形状见 OpenAI 文档 https://developers.openai.com/api/docs/guides/compaction 与
 * https://developers.openai.com/api/reference/resources/responses/methods/compact 。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { IncomingHttpHeaders } from "node:http";
import { logger, redactText } from "../log.js";

const log = logger("agent.compaction");

/** Modelflare 价格目录 supported_endpoint_types 里表示 POST /v1/responses/compact 的值 */
export const COMPACT_ENDPOINT = "openai-response-compact";

const DAY = 24 * 3600_000;
/** 探测结果的有效期：支持 3 天，不支持 7 天（之后重新探测）；临时失败 10 分钟后再试，连着失败每次加倍，最多 6 小时 */
const OK_TTL = 3 * DAY;
const NO_TTL = 7 * DAY;
const RETRY_MS = 10 * 60_000;
const RETRY_MAX_MS = 6 * 3600_000;
/** 一个会话最多留几段映射；映射文件多久没动就删 */
const KEEP_MAPPINGS = 3;
const FILE_TTL = 14 * DAY;
/** 上次压缩出来的映射一次都没用上（历史开头不稳定）时，这么久之内不再压缩同一会话 */
const QUIET_MS = 30 * 60_000;
const COMPACT_TIMEOUT_MS = 180_000;

/** 直连压缩端点：地址（…/v1）、Key、上游模型名（去掉网关的 provider 前缀）、附加请求头 */
export interface CompactEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

export interface ServerCompactionOptions {
  /** 映射与探测结果的存放目录 */
  dir: string;
  /** bridge 代理的上游（内置网关）：探测的续接请求和真实请求走同一条路 */
  upstream(): { baseUrl: string; apiKey: string };
  /** 该模型（网关里的名字）的压缩端点；没有就不压缩 */
  endpoint(model: string): CompactEndpoint | undefined;
  /** 价格目录是否列出了压缩端点（只是提示；undefined = 不知道） */
  listed(model: string): Promise<boolean | undefined>;
  /** 上下文窗口与最大输出（定压缩线） */
  limits(model: string): Promise<{ window: number; maxTokens: number }>;
  /** 一次压缩结束（成功或失败）；session 是 DSH 会话 id（不知道时为空） */
  onEvent?(e: CompactionEvent): void;
  fetchImpl?: typeof fetch;
  now?(): number;
}

export interface CompactionEvent {
  session: string;
  model: string;
  ok: boolean;
  /** 压缩前后发往上游的输入（估算 tokens） */
  before: number;
  after?: number;
  at: number;
  ms: number;
  error?: string;
}

/** bridge 对一次 /v1/responses 请求的处理方案 */
export interface CompactionPlan {
  /** 发给上游的请求体：改写过的，或原样 */
  body: Buffer;
  rewritten: boolean;
  /** 改写过的请求上游接受了 */
  accepted(): void;
  /** 改写过的请求被拒（status 0 = 流一开头就报错）；originalOk：随后用原请求重发成功了 */
  rejected(status: number, error: string, originalOk: boolean): void;
  /** 流式回复的字节（读 response.completed 里的用量） */
  observe(chunk: Buffer): void;
}

interface Verdict {
  ok: boolean;
  at: number;
  reason: string;
}

interface Mapping {
  id: string;
  model: string;
  /** 压缩时所用 Key 的指纹：换了 Key（可能换了账户）就不再用 */
  key: string;
  /** 覆盖的历史条数与这段的哈希（不含开头的系统提示） */
  k: number;
  hash: string;
  window: unknown[];
  at: number;
  before: number;
  after: number;
  hits?: number;
  /** 改写后连续遇到 5xx 的次数 */
  fails?: number;
}

interface SessionState {
  file: string;
  mappings: Mapping[];
  /** 上一次请求的历史（判断会话是不是在往后长） */
  last?: { len: number; hash: string; model: string };
  /** 上一次回复报的用量（同一份映射下才可比） */
  usage?: { mapping: string; tokens: number };
  busy?: boolean;
  quietUntil?: number;
}

/** 回复里报的用量与费用（日志用）：tokens、推理 tokens、cost_in_usd_ticks（原样） */
export type CallUsage = Partial<Record<"input" | "output" | "reasoning" | "costTicks", number>>;

class CompactError extends Error {
  constructor(
    message: string,
    /** 这个模型不支持（4xx、形状不对）；否则是临时问题 */
    readonly unsupported: boolean,
    readonly status = 0,
    /** 上游回了用量（这次调用照样计费） */
    readonly usage?: CallUsage,
  ) {
    super(message);
  }
}

/** 回复里的用量与费用；一项都没有时 undefined */
export function usageOf(j: any): CallUsage | undefined {
  const u = j?.usage;
  if (!u || typeof u !== "object") return undefined;
  const out: CallUsage = {};
  const put = (k: keyof CallUsage, v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  };
  put("input", u.input_tokens);
  put("output", u.output_tokens);
  put("reasoning", u.output_tokens_details?.reasoning_tokens);
  put("costTicks", u.cost_in_usd_ticks ?? j.cost_in_usd_ticks);
  return Object.keys(out).length ? out : undefined;
}

/** 上游错误体里的那句话（error.message），不是 JSON 就用原文；已脱敏、压成一行 */
function errorText(body: string, n = 200): string {
  let m = body;
  try {
    const j = JSON.parse(body);
    const x = j?.error?.message ?? j?.message;
    if (typeof x === "string" && x.trim()) m = x;
  } catch {
    /* 不是 JSON */
  }
  return redactText(m).replace(/\s+/g, " ").trim().slice(0, n);
}

export function serverCompactionEnabled(): boolean {
  return process.env.AMB_SERVER_COMPACTION !== "0";
}

/**
 * 压缩线：发往上游的输入（估算）过了它就在后台压缩。不超过 20 万、窗口的一半，并且留在 DSH 自己的压缩线之前
 * （compaction-basic 默认 min(窗口 × 0.8, 窗口 − 最大输出 − 65536)），让服务端压缩先发生；太小的窗口不做。
 * AMB_SERVER_COMPACTION_TOKENS 可覆盖（测试用）。
 */
export function compactLine(window: number, maxTokens: number): number {
  const env = Number(process.env.AMB_SERVER_COMPACTION_TOKENS);
  if (env > 0) return env;
  const dsh = Math.min(window * 0.8, window - maxTokens - 65_536);
  const line = Math.floor(Math.min(200_000, window / 2, dsh * 0.85));
  return line >= 16_000 ? line : 0;
}

/** 粗估 tokens（偏大）：文字按 UTF-8 字节 / 3，密文 / 4，内联图片每张 1500 */
export function estimateTokens(v: unknown): number {
  let bytes = 0;
  let sealed = 0;
  let images = 0;
  let items = 0;
  const walk = (x: unknown, key: string, depth: number): void => {
    if (typeof x === "string") {
      if (key === "encrypted_content") sealed += x.length;
      else if (x.startsWith("data:") && x.length > 1000) images++;
      else bytes += Buffer.byteLength(x);
    } else if (Array.isArray(x)) {
      if (depth === 0) items += x.length;
      for (const y of x) walk(y, key, depth + 1);
    } else if (x && typeof x === "object") {
      for (const [k, y] of Object.entries(x)) walk(y, k, depth + 1);
    }
  };
  walk(v, "", 0);
  return Math.ceil(bytes / 3 + sealed / 4 + images * 1500 + items * 4);
}

function isInstruction(it: any): boolean {
  return !!it && typeof it === "object" && (it.role === "system" || it.role === "developer") && (it.type === undefined || it.type === "message");
}

/** 开头的系统提示（system / developer 消息）与其后的历史 */
export function splitLead(input: unknown[]): { lead: unknown[]; rest: unknown[] } {
  let i = 0;
  while (i < input.length && isInstruction(input[i])) i++;
  return { lead: input.slice(0, i), rest: input.slice(i) };
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** 逐项累计哈希：h[i] = 前 i 项（h[0] 为空串） */
export function prefixHashes(items: unknown[]): string[] {
  const out = [""];
  let h = "";
  for (const it of items) {
    h = sha(h + sha(JSON.stringify(it)));
    out.push(h);
  }
  return out;
}

/** 改写后的输入：当次请求的系统提示 + 压缩窗口 + 压缩之后新增的历史 */
export function splice(lead: unknown[], window: unknown[], tail: unknown[]): unknown[] {
  return [...lead, ...window, ...tail];
}

/**
 * /responses/compact 的回复是否可用：output 里至少有一个带密文的 compaction 项；不可用时 undefined。
 * object 按文档是 response.compaction；Modelflare（实测 grok）回的是 response，output 只有那一个 compaction 项
 * （不保留用户消息）。两种都收，object 没有也收。
 */
export function compactedWindow(j: any): unknown[] | undefined {
  if (!j || typeof j !== "object" || !Array.isArray(j.output) || !j.output.length) return undefined;
  if (j.object !== undefined && j.object !== "response.compaction" && j.object !== "response") return undefined;
  if ((j.error && typeof j.error === "object") || j.status === "failed") return undefined;
  const items: any[] = j.output;
  if (!items.every((it) => it && typeof it === "object" && !Array.isArray(it) && (typeof it.type === "string" || typeof it.role === "string"))) return undefined;
  if (!items.some((it) => it.type === "compaction" && typeof it.encrypted_content === "string" && it.encrypted_content.length > 0)) return undefined;
  return items;
}

/** 流式回复开头的判断：ok = 已经开始正常输出；wait = 还看不出来；error = 开头就报错 */
export function sseVerdict(text: string): "ok" | "wait" | { error: string } {
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks.slice(0, -1)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      return "ok"; // 看不懂的不拦
    }
    const type = String(ev?.type ?? "");
    if (type === "response.created" || type === "response.in_progress" || type === "response.queued") continue;
    if (type === "error" || type === "response.failed") return { error: String(ev?.error?.message ?? ev?.message ?? ev?.response?.error?.message ?? type).slice(0, 300) };
    return "ok";
  }
  return "wait";
}

/**
 * 读流式回复的开头，直到第一个实质事件；开头就报错（error / response.failed）时返回错误，一个字节都还没交给下游，
 * 可以换原请求重发。其余情况返回一条从头开始的完整流。
 */
export async function peekStream(body: ReadableStream<Uint8Array>, maxBytes = 256 * 1024): Promise<{ error?: string; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  const dec = new TextDecoder();
  let text = "";
  let n = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    head.push(r.value);
    n += r.value.length;
    text += dec.decode(r.value, { stream: true });
    const v = sseVerdict(text);
    if (v === "ok") break;
    if (v !== "wait") {
      void reader.cancel().catch(() => undefined);
      return { error: v.error, stream: new ReadableStream({ start: (c) => c.close() }) };
    }
    if (n >= maxBytes) break;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const h of head) c.enqueue(h);
    },
    async pull(c) {
      const r = await reader.read();
      if (r.done) c.close();
      else c.enqueue(r.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { stream };
}

/** 只改写无状态的 Responses 请求：输入是数组、store:false，没有 previous_response_id / conversation / context_management，也没带压缩项 */
function stateless(j: any): boolean {
  return (
    !!j &&
    typeof j === "object" &&
    typeof j.model === "string" &&
    !!j.model &&
    Array.isArray(j.input) &&
    j.input.length > 0 &&
    j.store === false &&
    j.previous_response_id == null &&
    j.conversation == null &&
    j.context_management == null &&
    !j.input.some((it: any) => it?.type === "compaction" || it?.type === "compaction_trigger")
  );
}

/** 会话：pi-ai 的 prompt_cache_key（= DSH 会话 id），其次 session_id 请求头；都没有就按模型 + 第一条历史分组（是否可用仍靠逐项哈希） */
function sessionOf(j: any, headers: IncomingHttpHeaders, rest: unknown[]): { key: string; session: string } {
  const h = (n: string) => {
    const v = headers[n];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = (typeof j.prompt_cache_key === "string" && j.prompt_cache_key) || h("session_id") || h("x-client-request-id") || "";
  return id ? { key: `s:${id}`, session: id } : { key: `h:${j.model}:${sha(JSON.stringify(rest[0] ?? null))}`, session: "" };
}

const keyPrint = (ep: CompactEndpoint) => sha(`${ep.baseUrl}\n${ep.apiKey}`).slice(0, 16);

/** 消息的文字（content 是字符串或内容块数组） */
function messageText(it: any): string {
  const c = it?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((p: any) => (typeof p === "string" ? p : String(p?.text ?? ""))).join("") : "";
}

/**
 * 压缩窗口里去掉系统提示：上游可能把输入里的 system / developer 消息原样保留（还会加上 id、status）。
 * 当次请求的系统提示每次都放在最前面，窗口里再留一份就重复了（还是旧的）。
 */
export function withoutLead(window: unknown[], lead: unknown[]): unknown[] {
  const texts = new Set(lead.map(messageText));
  return window.filter((it: any) => !((it?.role === "system" || it?.role === "developer") && texts.has(messageText(it))));
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

// ---------- 探测用的小对话（和 pi-ai 发的形状一致：系统提示、用户消息、工具调用与结果、助手回复） ----------
const PROBE_LEAD = [{ role: "system", content: "You are a terse assistant. Answer in one word." }];
const PROBE_ITEMS = [
  { role: "user", content: [{ type: "input_text", text: "Look up the code word with the lookup tool." }] },
  { type: "function_call", call_id: "call_amb_probe", name: "lookup", arguments: '{"what":"code word"}' },
  { type: "function_call_output", call_id: "call_amb_probe", output: "teal" },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "The code word is teal.", annotations: [] }], status: "completed", id: "msg_amb_probe" },
];
const PROBE_ASK = { role: "user", content: [{ type: "input_text", text: "Reply with the code word only." }] };
const PROBE_TOOLS = [
  {
    type: "function",
    name: "lookup",
    description: "Look something up.",
    parameters: { type: "object", properties: { what: { type: "string" } }, required: ["what"] },
    strict: false,
  },
];

export class ServerCompaction {
  private sessions = new Map<string, SessionState>();
  private verdicts = new Map<string, Verdict>();
  private retryAt = new Map<string, number>();
  private probing = new Map<string, Promise<void>>();
  private limitCache = new Map<string, { window: number; maxTokens: number; at: number }>();
  private limitPending = new Set<string>();
  private tasks = new Set<Promise<unknown>>();
  private readonly fetch: typeof fetch;

  constructor(private o: ServerCompactionOptions) {
    this.fetch = o.fetchImpl ?? fetch;
    const saved = readJson(this.verdictFile);
    for (const [k, v] of Object.entries<any>(saved && typeof saved === "object" ? saved : {})) {
      if (typeof v?.ok === "boolean" && Number(v.at) > 0) this.verdicts.set(k, { ok: v.ok, at: Number(v.at), reason: String(v.reason ?? "") });
    }
    if (this.enabled) this.track(this.prune());
  }

  get enabled(): boolean {
    return serverCompactionEnabled();
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }
  private get verdictFile(): string {
    return path.join(this.o.dir, "probe.json");
  }
  private get sessionDir(): string {
    return path.join(this.o.dir, "sessions");
  }

  /** 后台任务（压缩、探测）都结束（测试用） */
  async settled(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.tasks.add(p);
    void p.catch(() => undefined).finally(() => this.tasks.delete(p));
    return p;
  }

  /** 故障排查用：各模型的探测结论 */
  status(): Record<string, { ok: boolean; at: number; reason: string }> {
    return Object.fromEntries([...this.verdicts].map(([k, v]) => [k.split("|")[0], v]));
  }

  /**
   * 一次 DSH → 上游的请求：不是可改写的 /v1/responses 时返回 undefined（bridge 原样转发）。
   * 不阻塞：探测、取窗口大小、压缩都在后台做，这次用不上就下次。
   */
  prepare(p: string, headers: IncomingHttpHeaders, body: Buffer): CompactionPlan | undefined {
    if (!this.enabled || p !== "/v1/responses" || body.length < 2) return undefined;
    let j: any;
    try {
      j = JSON.parse(body.toString("utf8"));
    } catch {
      return undefined;
    }
    if (!stateless(j)) return undefined;
    const model: string = j.model;
    const { lead, rest } = splitLead(j.input);
    const hashes = prefixHashes(rest);
    const { key, session } = sessionOf(j, headers, rest);
    const st = this.state(key);
    const ep = this.endpointFor(model);
    const fp = ep ? keyPrint(ep) : "";
    const verdict = ep ? this.verdicts.get(`${model}|${fp}`) : undefined;
    // 只用同一模型、同一 Key 压出来的映射，且历史开头逐项一致；覆盖最长的那段优先
    const mapping = verdict?.ok
      ? st.mappings.filter((m) => m.model === model && m.key === fp && m.k <= rest.length && hashes[m.k] === m.hash).sort((a, b) => b.k - a.k || b.at - a.at)[0]
      : undefined;
    const input = mapping ? splice(lead, mapping.window, rest.slice(mapping.k)) : j.input;
    const out = mapping ? Buffer.from(JSON.stringify({ ...j, input })) : body;
    const est = estimateTokens(input) + estimateTokens(j.tools);
    let tokens = est;
    if (st.usage && st.usage.mapping === (mapping?.id ?? "")) tokens = Math.max(tokens, st.usage.tokens);
    const growing = !!st.last && st.last.model === model && rest.length > st.last.len && hashes[st.last.len] === st.last.hash;
    st.last = { len: rest.length, hash: hashes[rest.length], model };
    if (ep) {
      try {
        this.consider({ st, key, session, model, ep, fp, verdict, tokens, est, growing, input, lead, tools: j.tools, instructions: j.instructions, k: rest.length, hash: hashes[rest.length] });
      } catch (e) {
        log.warn("server compaction check failed", { message: (e as Error).message });
      }
    }
    const mid = mapping?.id ?? "";
    let decoder: StringDecoder | undefined;
    let buf = "";
    return {
      body: out,
      rewritten: !!mapping,
      accepted: () => {
        if (!mapping) return;
        mapping.hits = (mapping.hits ?? 0) + 1;
        mapping.fails = 0;
      },
      rejected: (status, error, originalOk) => {
        if (!mapping) return;
        const snippet = errorText(error, 300);
        log.warn("compacted request rejected upstream; resent the original", { model, status, originalOk, error: snippet });
        // 5xx 可能只是上游一时的问题：映射先留着，连着两次才不用；其余（4xx、流开头报错）这段映射不再用
        if (status >= 500 && (mapping.fails = (mapping.fails ?? 0) + 1) < 2) return;
        st.mappings = st.mappings.filter((m) => m !== mapping);
        this.saveSession(key, st);
        // 原请求能过、改写的不能：是压缩项的问题，记下这个模型不支持
        if (originalOk && status < 500) this.setVerdict(model, fp, { ok: false, at: this.now(), reason: `rewritten request rejected (${status || "stream error"}): ${snippet}` });
      },
      observe: (chunk) => {
        decoder ??= new StringDecoder("utf8");
        buf += decoder.write(chunk);
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:") || !(line.includes('"response.completed"') || line.includes('"response.incomplete"'))) continue;
          try {
            const u = JSON.parse(line.slice(5))?.response?.usage;
            const t = (Number(u?.input_tokens) || 0) + (Number(u?.output_tokens) || 0);
            if (t > 0) st.usage = { mapping: mid, tokens: t };
          } catch {
            /* ignore */
          }
        }
        // 一行太长（整段回复带密文）就不读了
        if (buf.length > 16 * 1024 * 1024) buf = "";
      },
    };
  }

  /** 要不要探测 / 压缩（都在后台） */
  private consider(c: {
    st: SessionState;
    key: string;
    session: string;
    model: string;
    ep: CompactEndpoint;
    fp: string;
    verdict: Verdict | undefined;
    /** 发往上游的输入：估算与上游报的用量取大（定什么时候压） */
    tokens: number;
    /** 只按估算（和压缩后的窗口比大小，同一把尺子） */
    est: number;
    growing: boolean;
    input: unknown[];
    lead: unknown[];
    tools: unknown;
    instructions: unknown;
    k: number;
    hash: string;
  }): void {
    const lim = this.limitsFor(c.model);
    if (!lim) return;
    const line = compactLine(lim.window, lim.maxTokens);
    if (!line || c.tokens < line / 2) return;
    // 快到压缩线了：先确认这个模型（和这把 Key）真的支持
    const fresh = c.verdict && this.now() - c.verdict.at < (c.verdict.ok ? OK_TTL : NO_TTL);
    if (!fresh) this.ensureVerdict(c.model, c.ep, c.fp);
    if (!c.verdict?.ok || c.tokens < line || !c.growing || c.st.busy || this.now() < (c.st.quietUntil ?? 0)) return;
    const prev = c.st.mappings.at(-1);
    if (prev && !prev.hits && this.now() - prev.at < QUIET_MS) return;
    // 压缩只换掉系统提示之后的历史，系统提示和工具原样再发：它们占到一半以上时，压得再好请求也很难小三成，
    // 先不花这次钱，等历史再长些（只在压缩线调得很低时会遇到）
    if (estimateTokens(c.lead) + estimateTokens(c.tools) > c.est / 2) return;
    this.track(this.compact(c));
  }

  /** 端点（地址、Key）每次都要读网关配置文件：缓存半分钟 */
  private endpoints = new Map<string, { ep: CompactEndpoint | undefined; at: number }>();
  private endpointFor(model: string): CompactEndpoint | undefined {
    const hit = this.endpoints.get(model);
    if (hit && Date.now() - hit.at < 30_000) return hit.ep;
    const ep = this.o.endpoint(model);
    this.endpoints.set(model, { ep, at: Date.now() });
    return ep;
  }

  private limitsFor(model: string): { window: number; maxTokens: number } | undefined {
    const hit = this.limitCache.get(model);
    if (hit && this.now() - hit.at < 10 * 60_000) return hit;
    if (!this.limitPending.has(model)) {
      this.limitPending.add(model);
      this.track(
        this.o
          .limits(model)
          .then((l) => {
            if (Number(l?.window) > 0) this.limitCache.set(model, { window: Number(l.window), maxTokens: Number(l.maxTokens) || 0, at: this.now() });
          })
          .catch(() => undefined)
          .finally(() => this.limitPending.delete(model)),
      );
    }
    return hit;
  }

  private async compact(c: Parameters<ServerCompaction["consider"]>[0]): Promise<void> {
    const { st, model, fp } = c;
    st.busy = true;
    const at = this.now();
    const t0 = Date.now();
    let quiet = RETRY_MS;
    try {
      const { output, usage } = await this.callCompact(c.ep, { input: c.input, tools: c.tools, instructions: c.instructions });
      const window = withoutLead(output, c.lead);
      // 改写后的请求（系统提示 + 窗口 + 工具）要比这次请求小三成以上，两边都按估算比。窗口可能只有一个 compaction 项
      // （Modelflare 不保留用户消息），一样算；没小多少就不用，半小时内这个会话不再压
      const after = estimateTokens(splice(c.lead, window, [])) + estimateTokens(c.tools);
      if (after > c.est * 0.7) {
        quiet = QUIET_MS;
        throw new CompactError(`compacted window is not smaller (${after} vs ${c.est})`, false, 200, usage);
      }
      const m: Mapping = { id: crypto.randomBytes(6).toString("hex"), model, key: fp, k: c.k, hash: c.hash, window, at, before: c.tokens, after };
      st.mappings = [...st.mappings, m].slice(-KEEP_MAPPINGS);
      this.saveSession(c.key, st);
      log.info("server compaction done", { model, session: c.session.slice(0, 12), before: c.tokens, after, items: window.length, ms: Date.now() - t0, ...(usage && { usage }) });
      this.o.onEvent?.({ session: c.session, model, ok: true, before: c.tokens, after, at, ms: Date.now() - t0 });
    } catch (e) {
      const err = e as CompactError;
      const message = redactText(err.message).slice(0, 300);
      log.warn("server compaction failed; requests go on uncompacted", { model, session: c.session.slice(0, 12), status: err.status, unsupported: !!err.unsupported, message, ...(err.usage && { usage: err.usage }) });
      if (err.unsupported) this.setVerdict(model, fp, { ok: false, at: this.now(), reason: `compact: ${message}` });
      st.quietUntil = this.now() + (err.unsupported ? QUIET_MS : quiet);
      this.o.onEvent?.({ session: c.session, model, ok: false, before: c.tokens, at, ms: Date.now() - t0, error: message });
    } finally {
      st.busy = false;
    }
  }

  /** POST /responses/compact（直连）：返回压缩后的窗口与上游报的用量；失败抛 CompactError */
  private async callCompact(ep: CompactEndpoint, req: { input: unknown[]; tools?: unknown; instructions?: unknown }): Promise<{ output: any[]; usage?: CallUsage }> {
    const url = ep.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1/responses/compact";
    const body = { model: ep.model, input: req.input, ...(Array.isArray(req.tools) && req.tools.length ? { tools: req.tools } : {}), ...(typeof req.instructions === "string" && req.instructions ? { instructions: req.instructions } : {}) };
    let r: Response;
    try {
      r = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...ep.headers, authorization: `Bearer ${ep.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(COMPACT_TIMEOUT_MS),
      });
    } catch (e) {
      throw new CompactError(`network: ${(e as Error).message}`, false);
    }
    const text = await r.text().catch(() => "");
    if (r.status >= 400) throw new CompactError(`HTTP ${r.status}: ${errorText(text, 300)}`, unsupportedStatus(r.status), r.status);
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new CompactError(`not JSON: ${text.slice(0, 120)}`, true, r.status);
    }
    const usage = usageOf(j);
    const output = compactedWindow(j);
    if (!output) {
      const items = Array.isArray(j?.output) ? j.output.map((it: any) => String(it?.type ?? it?.role ?? "?")).join(",") : "-";
      throw new CompactError(`no usable compaction item in the reply (object ${String(j?.object ?? "-")}, output [${items.slice(0, 120)}])`, true, r.status, usage);
    }
    return { output: output as any[], usage };
  }

  /** 连着几次临时失败（探测不出结论） */
  private retries = new Map<string, number>();

  /**
   * 确认这个模型 + Key 支持服务端压缩（后台）。探测是付费的推理调用：同一模型 + Key 同时只探测一次；
   * 目录没列出的不探测；"不支持"没过期（7 天）不再探测；临时失败后等 10 分钟起、每次加倍。
   */
  private ensureVerdict(model: string, ep: CompactEndpoint, fp: string): void {
    const k = `${model}|${fp}`;
    if (this.probing.has(k) || this.now() < (this.retryAt.get(k) ?? 0)) return;
    const had = this.verdicts.get(k);
    if (had && !had.ok && this.now() - had.at < NO_TTL) return;
    const later = () => {
      const n = (this.retries.get(k) ?? 0) + 1;
      this.retries.set(k, n);
      this.retryAt.set(k, this.now() + Math.min(RETRY_MS * 2 ** (n - 1), RETRY_MAX_MS));
    };
    const job = (async () => {
      const listed = await this.o.listed(model).catch(() => undefined);
      if (listed !== true) {
        // 目录明确不再列出：已有的"支持"作废；不知道（目录读不到）就先不动
        if (listed === false && this.verdicts.get(k)?.ok) this.setVerdict(model, fp, { ok: false, at: this.now(), reason: "no longer listed in the catalog" });
        this.retryAt.set(k, this.now() + 30 * 60_000);
        return;
      }
      const v = await this.probe(model, ep);
      if (!v) return later();
      this.retries.delete(k);
      this.setVerdict(model, fp, v);
    })()
      .catch((e) => {
        log.warn("server compaction probe crashed", { model, message: (e as Error).message });
        later();
      })
      .finally(() => this.probing.delete(k));
    this.probing.set(k, job);
    this.track(job);
  }

  /**
   * 探测：① 直连 /responses/compact 压一段很小的对话，回复里要有带密文的 compaction 项；② 把压缩窗口按真实请求的拼法
   * 经内置网关发一次 /v1/responses 续接，上游要接受。由 ② 定论：Modelflare 上 grok 的 ① 能过，② 带着 compaction 项
   * 就回 400。返回 undefined = 临时问题（网络、限流、5xx），过一会儿再试。回复报了用量和费用就记进日志。
   */
  async probe(model: string, ep: CompactEndpoint): Promise<Verdict | undefined> {
    const t0 = Date.now();
    const no = (reason: string): Verdict => ({ ok: false, at: this.now(), reason: `probe: ${reason}` });
    let window: any[];
    try {
      const c = await this.callCompact(ep, { input: [...PROBE_LEAD, ...PROBE_ITEMS], tools: PROBE_TOOLS });
      window = c.output;
      log.info("server compaction probe: compact call ok", { model, ms: Date.now() - t0, items: window.map((it) => String(it?.type ?? it?.role)).join(","), ...(c.usage && { usage: c.usage }) });
    } catch (e) {
      const err = e as CompactError;
      const message = redactText(err.message).slice(0, 300);
      log.warn("server compaction probe: compact call failed", { model, status: err.status, unsupported: err.unsupported, ms: Date.now() - t0, message, ...(err.usage && { usage: err.usage }) });
      return err.unsupported ? no(`compact call failed: ${message.slice(0, 200)}`) : undefined;
    }
    const up = this.o.upstream();
    if (!up.baseUrl) return undefined;
    const input = splice(PROBE_LEAD, withoutLead(window, PROBE_LEAD), [PROBE_ASK]);
    const t1 = Date.now();
    let r: Response;
    try {
      r = await this.fetch(up.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(up.apiKey ? { authorization: `Bearer ${up.apiKey}` } : {}) },
        body: JSON.stringify({ model, input, tools: PROBE_TOOLS, store: false, stream: false, max_output_tokens: 64 }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      log.warn("server compaction probe: follow-up failed", { model, message: (e as Error).message });
      return undefined;
    }
    const text = await r.text().catch(() => "");
    if (r.status >= 400) {
      const message = errorText(text, 300);
      log.warn("server compaction probe: follow-up rejected", { model, status: r.status, ms: Date.now() - t1, message });
      return unsupportedStatus(r.status) ? no(`compact call ok, but the follow-up /v1/responses carrying its compaction item was rejected (HTTP ${r.status}): ${message.slice(0, 200)}`) : undefined;
    }
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return no("compact call ok, but the follow-up /v1/responses reply is not JSON");
    }
    const usage = usageOf(j);
    if ((j?.object !== undefined && j.object !== "response") || j?.status === "failed" || (j?.error && typeof j.error === "object") || !Array.isArray(j?.output)) {
      log.warn("server compaction probe: follow-up failed", { model, ms: Date.now() - t1, status: String(j?.status ?? j?.object ?? "?"), ...(usage && { usage }) });
      return no(`compact call ok, but the follow-up /v1/responses carrying its compaction item failed (${String(j?.status ?? j?.object ?? "?")}${j?.error?.message ? `: ${errorText(JSON.stringify(j), 160)}` : ""})`);
    }
    log.info("server compaction probe passed", { model, ms: Date.now() - t0, windowItems: window.length, ...(usage && { followUpUsage: usage }) });
    return { ok: true, at: this.now(), reason: "probe passed" };
  }

  private setVerdict(model: string, fp: string, v: Verdict): void {
    const k = `${model}|${fp}`;
    const prev = this.verdicts.get(k);
    this.verdicts.set(k, v);
    if (!v.ok && prev?.ok !== false) log.warn("server compaction off for this model", { model, reason: v.reason });
    try {
      writeJson(this.verdictFile, Object.fromEntries(this.verdicts));
    } catch (e) {
      log.warn("saving server compaction probe results failed", { message: (e as Error).message });
    }
  }

  private state(key: string): SessionState {
    let st = this.sessions.get(key);
    if (st) {
      this.sessions.delete(key);
      this.sessions.set(key, st);
      return st;
    }
    const file = path.join(this.sessionDir, `${sha(key).slice(0, 40)}.json`);
    const saved = readJson(file);
    const cutoff = this.now() - FILE_TTL;
    const mappings: Mapping[] = (saved?.key === key && Array.isArray(saved.mappings) ? saved.mappings : []).filter(
      (m: any) => m && typeof m.model === "string" && typeof m.hash === "string" && Number.isInteger(m.k) && Array.isArray(m.window) && Number(m.at) > cutoff,
    );
    st = { file, mappings };
    this.sessions.set(key, st);
    if (this.sessions.size > 500) this.sessions.delete(this.sessions.keys().next().value!);
    return st;
  }

  private saveSession(key: string, st: SessionState): void {
    try {
      if (!st.mappings.length) fs.rmSync(st.file, { force: true });
      else writeJson(st.file, { v: 1, key, mappings: st.mappings.map(({ hits: _h, fails: _f, ...m }) => m) });
    } catch (e) {
      log.warn("saving server compaction mapping failed", { message: (e as Error).message });
    }
  }

  /** 删掉很久没动的映射文件 */
  private async prune(): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(this.sessionDir);
    } catch {
      return;
    }
    const cutoff = Date.now() - FILE_TTL;
    for (const n of names) {
      const f = path.join(this.sessionDir, n);
      try {
        if ((await fs.promises.stat(f)).mtimeMs < cutoff) await fs.promises.rm(f, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/** 这个状态码说明"不支持"（不是 Key、限流、超时或上游一时的问题） */
function unsupportedStatus(status: number): boolean {
  return (status >= 400 && status < 500 && ![401, 408, 409, 429].includes(status)) || status === 501;
}
