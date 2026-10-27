import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import { logger } from "../log.js";

const log = logger("agent.bridge");

export interface BridgeHandlers {
  /** 模型上游（magpie 网关或外部端点），密钥只在本进程内使用 */
  upstream(): { baseUrl: string; apiKey: string };
  ask(body: any): Promise<{ id: string }>;
  wait(body: any): Promise<Record<string, unknown>>;
  cancel(body: any): Promise<void>;
}

/**
 * 仅回环的内部桥：DSH 子进程用每次启动随机生成的令牌访问。
 * - /v1/*：模型代理，替换 Authorization 为真实网关密钥（子进程环境里没有任何真实密钥）
 * - /dsh/ask|wait|cancel：amb-bridge 插件的审批/提问长轮询
 */
export class AgentBridge {
  readonly token = crypto.randomBytes(24).toString("base64url");
  private server: http.Server | undefined;
  port = 0;

  constructor(private h: BridgeHandlers) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private authorized(req: http.IncomingMessage): boolean {
    const got = Buffer.from(String(req.headers.authorization || ""));
    const want = Buffer.from(`Bearer ${this.token}`);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
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
      if (["host", "authorization", "connection", "content-length", "transfer-encoding", "cookie"].includes(k) || v === undefined) continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    if (up.apiKey) headers.authorization = `Bearer ${up.apiKey}`;
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await this.readBody(req);
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    const r = await fetch(target, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined, signal: ac.signal });
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].includes(k)) out[k] = v;
    });
    res.writeHead(r.status, out);
    if (!r.body) return void res.end();
    Readable.fromWeb(r.body as any).on("error", () => res.destroy()).pipe(res);
  }

  private async dsh(req: http.IncomingMessage, res: http.ServerResponse, url: string): Promise<void> {
    if (req.method !== "POST") return void res.writeHead(405).end();
    const raw = await this.readBody(req);
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    let out: unknown;
    if (url === "/dsh/ask") out = await this.h.ask(body);
    else if (url === "/dsh/wait") out = await this.h.wait(body);
    else if (url === "/dsh/cancel") out = (await this.h.cancel(body), { ok: true });
    else return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  }
}
