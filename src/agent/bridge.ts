import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import { logger, redactText, registerSecret } from "../log.js";
import { peekStream, type CompactionPlan, type ServerCompaction } from "./server-compaction.js";

const log = logger("agent.bridge");
/** 长调用的保活间隔：远小于 fetch 默认的 5 分钟数据间隔超时 */
const KEEPALIVE_MS = 60_000;

export interface BridgeHandlers {
  /** 模型上游（magpie 网关或外部端点），密钥只在本进程内使用 */
  upstream(): { baseUrl: string; apiKey: string };
  ask(body: any): Promise<{ id: string }>;
  wait(body: any): Promise<Record<string, unknown>>;
  cancel(body: any): Promise<void>;
  /** amb-memory 插件：remember / forget / recall */
  memory?(body: any): Promise<unknown>;
  /** amb-memory 插件：上下文管家判定 / 压缩回报 */
  steward?(body: any): Promise<unknown>;
  /** amb-media 插件：生图 / 生视频 */
  media?(body: any): Promise<unknown>;
  /** amb-control 插件：长轮询取宿主的指令（signal = 连接断了）、回报结果 */
  control?: { poll(body: any, signal: AbortSignal): Promise<unknown>; result(body: any): void };
  /** 服务端压缩：长会话的 /v1/responses 换上上游压缩过的历史（见 server-compaction.ts） */
  compaction?: ServerCompaction;
  /** amb-tasks 插件：task_report（report）、收尾结束（settled）、聊天代理的任务工具（tool） */
  tasks?(route: "report" | "settled" | "tool", body: any): Promise<unknown>;
}

/** 模型代理的一次请求（故障排查的"测试代理"用它判断模型调用这一步） */
export type ProxyEvent =
  | { phase: "request"; id: number; path: string; model?: string; tools?: string[]; lastUser?: string }
  | { phase: "response"; id: number; path: string; status: number; ms: number; error?: string }
  | { phase: "error"; id: number; path: string; ms: number; error: string };

/** 上游拒绝了一个模型请求（状态码 ≥ 400）：哪个机器人的代理进程发的、哪个路径、状态码、错误体（已脱敏、截断） */
export interface Rejection {
  bot?: string;
  path: string;
  status: number;
  error: string;
}

/** 代理进程在每个模型请求上带的头：标明是哪个机器人发的（bridge 用它归属上游错误，不转给上游） */
export const BOT_HEADER = "x-amb-bot";

/**
 * 仅回环的内部桥：DSH 子进程用每次启动随机生成的令牌访问。
 * - /v1/*：模型代理（Chat Completions、Responses、Anthropic Messages），把令牌换成真实网关密钥（子进程环境里没有任何真实密钥）
 * - /dsh/ask|wait|cancel：amb-bridge 插件的审批/提问长轮询
 * - /dsh/control/poll|result：amb-control 插件取宿主的指令（中止、插话、换模型）并回报
 * - /dsh/task-report|task-settled|task-tool：amb-tasks 插件（后台任务的报告、收尾结束、聊天代理的任务工具）
 */
export class AgentBridge {
  readonly token = crypto.randomBytes(24).toString("base64url");
  private server: http.Server | undefined;
  port = 0;
  private seq = 0;
  private proxyListeners = new Set<(e: ProxyEvent) => void>();
  private rejectionListeners = new Set<(e: Rejection) => void>();

  constructor(private h: BridgeHandlers) {
    registerSecret(this.token);
  }

  /** 订阅模型代理事件；返回取消函数 */
  onProxy(fn: (e: ProxyEvent) => void): () => void {
    this.proxyListeners.add(fn);
    return () => this.proxyListeners.delete(fn);
  }
  private emitProxy(e: ProxyEvent): void {
    for (const fn of this.proxyListeners) {
      try {
        fn(e);
      } catch {
        /* ignore */
      }
    }
  }

  /** 订阅上游拒绝（代理接口回退用；不解析请求体，开销很小）；返回取消函数 */
  onRejection(fn: (e: Rejection) => void): () => void {
    this.rejectionListeners.add(fn);
    return () => this.rejectionListeners.delete(fn);
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** OpenAI 兼容客户端用 Authorization: Bearer 带令牌，Anthropic 客户端用 x-api-key */
  private authorized(req: http.IncomingMessage): boolean {
    const same = (got: unknown, want: string) => {
      const a = Buffer.from(String(got || ""));
      const b = Buffer.from(want);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    };
    return same(req.headers.authorization, `Bearer ${this.token}`) || same(req.headers["x-api-key"], this.token);
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      if (!this.authorized(req)) {
        res.writeHead(401).end();
        return;
      }
      const url = req.url || "/";
      const p = url.startsWith("/v1/") || url === "/v1" ? this.proxy(req, res, url) : this.dsh(req, res, url);
      p.catch((e) => {
        log.warn("bridge request failed", { path: url.split("?")[0], message: (e as Error).message });
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: (e as Error).message } }));
      });
    });
    this.server.requestTimeout = 0;
    this.server.headersTimeout = 60_000;
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = undefined;
    if (!s) return;
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of req) {
      n += (c as Buffer).length;
      if (n > 64 * 1024 * 1024) throw new Error("body too large");
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private async proxy(req: http.IncomingMessage, res: http.ServerResponse, url: string): Promise<void> {
    const up = this.h.upstream();
    if (!up.baseUrl) throw new Error("模型网关未就绪");
    const target = up.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + url;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "authorization", "x-api-key", BOT_HEADER, "connection", "content-length", "transfer-encoding", "cookie"].includes(k) || v === undefined) continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    // 令牌只在本机有效：换成真实密钥；Anthropic 客户端发来的 x-api-key 也换掉（magpie 两种都认）
    if (up.apiKey) {
      headers.authorization = `Bearer ${up.apiKey}`;
      if (req.headers["x-api-key"] !== undefined) headers["x-api-key"] = up.apiKey;
    }
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await this.readBody(req);
    const id = ++this.seq;
    const p = url.split("?")[0];
    const t0 = Date.now();
    if (this.proxyListeners.size) this.emitProxy({ phase: "request", id, path: p, ...requestInfo(body) });
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    // 上游迟迟不回响应头时每分钟记一条：代理"一直转圈"多半是这里卡住（代理自己要等 5 分钟才判超时并重试）
    const slow = setInterval(() => log.warn("model request still waiting for upstream response", { path: p, waitedMs: Date.now() - t0 }), 60_000);
    // 最后发出去的是不是 DSH 的原请求体：改写过（换上压缩历史）的请求被拒先由 checkRewritten 用原请求重发，
    // 不报给代理接口回退（onRejection）；只有原请求被拒才可能让这个模型改走 Chat
    let unmodified = true;
    const send = (b: Buffer | undefined) => {
      unmodified = b === body;
      return fetch(target, { method: req.method, headers, body: b ? new Uint8Array(b) : undefined, signal: ac.signal });
    };
    let plan: CompactionPlan | undefined;
    if (body && req.method === "POST" && this.h.compaction) {
      try {
        plan = this.h.compaction.prepare(p, req.headers, body);
      } catch (e) {
        log.warn("server compaction skipped", { message: (e as Error).message });
      }
    }
    let r: Response;
    try {
      r = await send(plan?.body ?? body);
      if (plan?.rewritten) r = await this.checkRewritten(plan, r, () => send(body), p);
    } catch (e) {
      const error = (e as Error).message;
      this.emitProxy({ phase: "error", id, path: p, ms: Date.now() - t0, error });
      throw e;
    } finally {
      clearInterval(slow);
    }
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].includes(k)) out[k] = v;
    });
    if (r.status >= 400) {
      // 上游报错：读完错误体（不大）记日志，再原样转给子进程
      const text = await r.text().catch(() => "");
      const error = redactText(text.slice(0, 1000));
      const bot = typeof req.headers[BOT_HEADER] === "string" ? (req.headers[BOT_HEADER] as string) : undefined;
      log.warn("model request rejected by upstream", { path: p, status: r.status, ms: Date.now() - t0, bot, body: error });
      this.emitProxy({ phase: "response", id, path: p, status: r.status, ms: Date.now() - t0, error });
      if (unmodified)
        for (const fn of this.rejectionListeners) {
          try {
            fn({ bot, path: p, status: r.status, error });
          } catch {
            /* ignore */
          }
        }
      res.writeHead(r.status, out);
      return void res.end(text);
    }
    const headersMs = Date.now() - t0;
    this.emitProxy({ phase: "response", id, path: p, status: r.status, ms: headersMs });
    res.writeHead(r.status, out);
    if (!r.body) return void res.end();
    const stream = Readable.fromWeb(r.body as any);
    let bytes = 0;
    stream.on("data", (c: Buffer) => {
      bytes += c.length;
      plan?.observe(c);
    });
    stream.on("end", () => log.info("model request done", { path: p, status: r.status, headersMs, totalMs: Date.now() - t0, bytes }));
    stream.on("error", (e) => {
      // 子进程读完 [DONE] 就断开时上游流会被中止（res close → abort），这不是错误
      if (ac.signal.aborted) log.debug("model response closed by the agent", { path: p, ms: Date.now() - t0, bytes });
      else log.warn("model response stream failed", { path: p, ms: Date.now() - t0, bytes, error: e.message });
      res.destroy();
    });
    stream.pipe(res);
  }

  /**
   * 改写过（换上压缩历史）的请求：被拒（4xx/5xx，Key 与限流问题除外）或流一开头就报错时，用原请求重发一次，
   * 回合照常进行；server-compaction 据此记下这个模型不支持。这次被拒不算代理接口被拒（不触发改走 Chat），
   * 原请求重发后再被拒才算。
   */
  private async checkRewritten(plan: CompactionPlan, r: Response, original: () => Promise<Response>, p: string): Promise<Response> {
    if (r.status >= 400 && r.status !== 401 && r.status !== 429) {
      const text = await r.text().catch(() => "");
      log.warn("compacted model request rejected, resending the original", { path: p, status: r.status, body: redactText(text.slice(0, 500)) });
      const again = await original();
      plan.rejected(r.status, text, again.status < 400);
      return again;
    }
    if (r.status < 300 && r.body && /event-stream/i.test(r.headers.get("content-type") ?? "")) {
      const peek = await peekStream(r.body as ReadableStream<Uint8Array>);
      if (peek.error !== undefined) {
        log.warn("compacted model request failed at stream start, resending the original", { path: p, error: redactText(peek.error) });
        const again = await original();
        plan.rejected(0, peek.error, again.status < 400);
        return again;
      }
      r = new Response(peek.stream, { status: r.status, statusText: r.statusText, headers: r.headers });
    }
    if (r.status < 400) plan.accepted();
    return r;
  }

  private async dsh(req: http.IncomingMessage, res: http.ServerResponse, url: string): Promise<void> {
    if (req.method !== "POST") return void res.writeHead(405).end();
    const raw = await this.readBody(req);
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    let out: unknown;
    if (url === "/dsh/ask") out = await this.h.ask(body);
    else if (url === "/dsh/wait") out = await this.h.wait(body);
    else if (url === "/dsh/cancel") out = (await this.h.cancel(body), { ok: true });
    else if (url === "/dsh/memory" && this.h.memory) out = await this.h.memory(body);
    else if (url === "/dsh/steward" && this.h.steward) out = await this.h.steward(body);
    else if (url === "/dsh/media" && this.h.media) return this.longCall(res, this.h.media(body));
    else if (url === "/dsh/control/poll" && this.h.control) {
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      out = await this.h.control.poll(body, ac.signal);
    } else if (url === "/dsh/control/result" && this.h.control) out = (this.h.control.result(body), { ok: true });
    else if (url === "/dsh/task-report" && this.h.tasks) out = await this.h.tasks("report", body);
    else if (url === "/dsh/task-settled" && this.h.tasks) out = await this.h.tasks("settled", body);
    else if (url === "/dsh/task-tool" && this.h.tasks) out = await this.h.tasks("tool", body);
    else return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  }

  /**
   * 可能要十几分钟的调用（生视频）：先回响应头，每分钟写一个空格，做完再写 JSON（前导空白不影响解析）。
   * 子进程里的 fetch 等响应头、等下一段数据都只等 5 分钟，超时工具就失败了，生成却还在继续、照样扣费。
   */
  private async longCall(res: http.ServerResponse, p: Promise<unknown>): Promise<void> {
    res.writeHead(200, { "content-type": "application/json" });
    res.flushHeaders();
    const keep = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(" ");
    }, KEEPALIVE_MS);
    res.on("close", () => clearInterval(keep));
    try {
      res.end(JSON.stringify(await p.catch((e: Error) => ({ error: e.message }))));
    } finally {
      clearInterval(keep);
    }
  }
}

/** 模型请求的路径：Chat Completions、Responses、Anthropic Messages（代理按模型选其一） */
export function isModelPath(p: string): boolean {
  return /\/v1\/(chat\/completions|responses|messages)$/.test(p);
}

/** 请求体里的模型名、工具名与第一条用户消息开头（只在有人订阅时解析；解析失败就不给） */
function requestInfo(body: Buffer | undefined): { model?: string; tools?: string[]; lastUser?: string } {
  if (!body || body.length > 8 * 1024 * 1024) return {};
  try {
    const j = JSON.parse(body.toString("utf8"));
    const tools = Array.isArray(j?.tools) ? j.tools.map((t: any) => String(t?.function?.name ?? t?.name ?? "")).filter(Boolean) : undefined;
    // Chat、Anthropic 是 messages；Responses 是 input（字符串，或条目列表）
    const items = Array.isArray(j?.messages) ? j.messages : Array.isArray(j?.input) ? j.input : typeof j?.input === "string" ? [{ role: "user", content: j.input }] : [];
    const users = items.filter((m: any) => m?.role === "user");
    const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => (typeof p === "string" ? p : String(p?.text ?? ""))).join("") : "");
    const lastUser = users.length ? users.map((m: any) => text(m.content).slice(0, 2000)).join("\n") : undefined;
    return { model: typeof j?.model === "string" ? j.model : undefined, tools, lastUser };
  } catch {
    return {};
  }
}
