import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import type { App } from "../app.js";
import type { InboundEvent, OutboundOp, ReplySession } from "../core/types.js";
import { findAppRoot } from "../magpie/supervisor.js";
import { proxyHttp, proxyUpgrade, type ProxyTarget } from "./proxy.js";
import { logger, mask } from "../log.js";

const log = logger("web");
const require = createRequire(import.meta.url);

export interface WebServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function vendorFiles(): Record<string, string> {
  const resolve = (spec: string) => {
    try {
      return require.resolve(spec);
    } catch {
      return "";
    }
  };
  const preact = resolve("preact");
  const preactDir = preact ? path.dirname(path.dirname(preact)) : "";
  return {
    "preact.mjs": preactDir ? path.join(preactDir, "dist", "preact.mjs") : "",
    "hooks.mjs": preactDir ? path.join(preactDir, "hooks", "dist", "hooks.mjs") : "",
    "htm.mjs": (() => {
      const h = resolve("htm");
      return h ? path.join(path.dirname(h), "htm.mjs") : "";
    })(),
  };
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) throw new HttpError(415, "需要 application/json");
  let body = "";
  for await (const c of req) {
    body += c;
    if (body.length > 1_000_000) throw new HttpError(413, "请求体过大");
  }
  return body ? JSON.parse(body) : {};
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function publicBot(b: NonNullable<ReturnType<App["store"]["getBot"]>>) {
  return {
    id: b.id,
    name: b.name,
    systemPrompt: b.systemPrompt,
    defaultModel: b.defaultModel,
    feishuAppId: b.feishuAppId,
    feishuAppSecretMasked: mask(b.feishuAppSecret),
    weixinEnabled: b.weixinEnabled,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** 网页“测试对话”渠道：收集输出 */
class CollectReply implements ReplySession {
  text = "";
  async apply(op: OutboundOp): Promise<void> {
    if (op.type === "stream.finish" || op.type === "text") this.text += (this.text ? "\n" : "") + op.text;
  }
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export async function startWebServer(app: App, opts: { port?: number; host?: string } = {}): Promise<WebServer> {
  const cfg = app.config;
  const host = opts.host ?? cfg.ui.host;
  const uiDir = path.join(findAppRoot(), "ui");
  const vendor = vendorFiles();
  // 非回环地址（如 Docker 0.0.0.0）必须带访问令牌；未配置则生成并写入数据目录（不打印到日志）
  let token = cfg.ui.token;
  if (!isLoopback(host) && !token) {
    const f = path.join(cfg.dataDir, "ui-token");
    token = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : crypto.randomBytes(18).toString("base64url");
    fs.writeFileSync(f, token, { mode: 0o600 });
    log.warn(`UI 监听在非回环地址 ${host}，访问需带令牌：见 ${f}（打开 /?token=<令牌> 一次即可）`);
  }

  const target: ProxyTarget = {
    webOrigin: () => app.magpie?.webOrigin ?? "http://127.0.0.1:9",
    gatewayOrigin: () => (app.magpie ? `http://127.0.0.1:${app.magpie.gatewayPort}` : "http://127.0.0.1:9"),
    cookie: () => (app.magpie ? `${app.magpie.cookieName}=${app.magpie.webKey}` : ""),
    gatewayKey: () => app.magpie?.gatewayKey ?? "",
    ready: () => !!app.magpie && app.magpie.state === "running",
  };

  let boundPort = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`]);

  function authorized(req: http.IncomingMessage, url: URL, res: http.ServerResponse): boolean {
    // 防 DNS rebinding：回环模式只接受 127.0.0.1/localhost 的 Host
    if (isLoopback(host) && !allowedHosts().has(String(req.headers.host))) {
      res.writeHead(421).end("bad host");
      return false;
    }
    if (!token) return true;
    const cookie = String(req.headers.cookie || "");
    const ok = cookie.split(/;\s*/).includes(`amb_token=${token}`) || req.headers["x-amb-token"] === token;
    if (ok) return true;
    if (url.searchParams.get("token") === token) {
      url.searchParams.delete("token");
      res.writeHead(302, { "set-cookie": `amb_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000`, location: url.pathname + url.search });
      res.end();
      return false;
    }
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" }).end("需要访问令牌：打开 /?token=<令牌>");
    return false;
  }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const p = url.pathname.slice("/amb/api".length);
    const m = req.method || "GET";
    const seg = p.split("/").filter(Boolean);
    // 写操作要求 JSON（触发 CORS 预检，阻止跨站表单 CSRF）
    if ((m === "POST" || m === "PUT" || m === "PATCH") && !/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || "").trim())) {
      throw new HttpError(415, "需要 application/json");
    }

    if (p === "/status" && m === "GET") {
      const mp = app.magpie;
      return send(res, 200, {
        version: "0.1.0",
        dataDir: cfg.dataDir,
        magpie: mp
          ? { mode: "managed", state: mp.state, lastError: mp.lastError, restarts: mp.restarts, gatewayPort: mp.gatewayPort, webPort: mp.webPort, binary: mp.binPath ?? null, providers: mp.listProviders().length }
          : { mode: "external", state: "external", baseUrl: cfg.magpie.externalBaseUrl },
        notices: app.recentNotices,
      });
    }
    if (p === "/models" && m === "GET") {
      try {
        return send(res, 200, { models: await app.runtime.listModels(true) });
      } catch (e) {
        return send(res, 200, { models: [], error: (e as Error).message });
      }
    }
    if (p === "/providers") {
      if (!app.magpie) throw new HttpError(400, "外部模型端点模式下不管理服务商");
      if (m === "GET") return send(res, 200, { providers: app.magpie.listProviders() });
      if (m === "POST") {
        const b = await readJson(req);
        if (!b.apiKey && !b.url) throw new HttpError(400, "缺少 apiKey");
        const id = b.url
          ? await app.magpie.addCustomProvider(String(b.name || "custom"), String(b.url), String(b.apiKey || ""), String(b.models || "").split(",").map((s: string) => s.trim()).filter(Boolean))
          : await app.magpie.addPresetProvider(String(b.preset), String(b.apiKey));
        return send(res, 200, { id });
      }
    }
    if (seg[0] === "conversations") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { conversations: app.store.listConversations(url.searchParams.get("bot") || undefined) });
      if (seg.length === 3 && seg[2] === "messages" && m === "GET") {
        const conv = app.store.getConversation(decodeURIComponent(seg[1]));
        if (!conv) throw new HttpError(404, "会话不存在");
        return send(res, 200, { conversation: conv, messages: app.store.listMessages(conv.id) });
      }
    }
    if (seg[0] === "bots") {
      if (seg.length === 1) {
        if (m === "GET") return send(res, 200, { bots: app.store.listBots().map(publicBot) });
        if (m === "POST") {
          const b = await readJson(req);
          if (!String(b.name || "").trim()) throw new HttpError(400, "名称不能为空");
          const bot = app.store.createBot({ name: String(b.name).trim(), systemPrompt: String(b.systemPrompt ?? ""), defaultModel: String(b.defaultModel ?? "") });
          await app.startBot(bot.id);
          return send(res, 201, { bot: publicBot(bot) });
        }
      }
      const id = seg[1];
      const bot = id ? app.store.getBot(id) : undefined;
      if (!bot) throw new HttpError(404, "机器人不存在");
      if (seg.length === 2) {
        if (m === "GET") return send(res, 200, { bot: publicBot(bot), channels: app.channelStatus(id) });
        if (m === "PUT") {
          const b = await readJson(req);
          const next = app.store.updateBot(id, {
            ...(b.name !== undefined ? { name: String(b.name) } : {}),
            ...(b.systemPrompt !== undefined ? { systemPrompt: String(b.systemPrompt) } : {}),
            ...(b.defaultModel !== undefined ? { defaultModel: String(b.defaultModel) } : {}),
          })!;
          return send(res, 200, { bot: publicBot(next) });
        }
        if (m === "DELETE") {
          await app.stopBot(id);
          app.store.deleteBot(id);
          return send(res, 200, { ok: true });
        }
      }
      const sub = seg.slice(2).join("/");
      if (sub === "channels" && m === "GET") return send(res, 200, app.channelStatus(id));
      if (sub === "feishu" && m === "PUT") {
        const b = await readJson(req);
        const appId = String(b.appId ?? "").trim();
        const appSecret = String(b.appSecret ?? "").trim() || bot.feishuAppSecret;
        app.store.updateBot(id, { feishuAppId: appId, feishuAppSecret: appId ? appSecret : "" });
        await app.restartBot(id);
        return send(res, 200, app.channelStatus(id));
      }
      if (sub === "feishu" && m === "DELETE") {
        app.store.updateBot(id, { feishuAppId: "", feishuAppSecret: "" });
        await app.restartBot(id);
        return send(res, 200, app.channelStatus(id));
      }
      if (sub === "weixin" && m === "PUT") {
        const b = await readJson(req);
        app.store.updateBot(id, { weixinEnabled: !!b.enabled });
        await app.restartBot(id);
        return send(res, 200, app.channelStatus(id));
      }
      if (sub === "weixin/login" && m === "POST") {
        const login = app.startWeixinLogin(id);
        // 等待二维码就绪（最多 10 秒）
        const t0 = Date.now();
        while (login.snapshot.state === "idle" || login.snapshot.state === "fetching") {
          if (Date.now() - t0 > 10_000) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        return send(res, 200, login.snapshot);
      }
      if (sub === "weixin/login" && m === "GET") return send(res, 200, app.channels.get(id)?.weixinLogin?.snapshot ?? { state: "idle" });
      if (sub === "weixin/verify" && m === "POST") {
        const b = await readJson(req);
        app.channels.get(id)?.weixinLogin?.submitVerifyCode(String(b.code ?? ""));
        return send(res, 200, { ok: true });
      }
      if (sub === "weixin/cancel" && m === "POST") {
        app.channels.get(id)?.weixinLogin?.cancel();
        return send(res, 200, { ok: true });
      }
      if (sub === "weixin/logout" && m === "POST") {
        await app.weixinLogout(id);
        return send(res, 200, app.channelStatus(id));
      }
      if (sub === "chat" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, "内容为空");
        const ev: InboundEvent = {
          id: crypto.randomUUID(),
          channel: "web",
          botId: id,
          conversation: { kind: "dm", id: "console" },
          sender: { id: "owner", name: "控制台" },
          parts: [{ type: "text", text }],
          replyHandle: {},
          receivedAt: Date.now(),
        };
        const out = new CollectReply();
        await app.queue.run(`web:${id}:console`, () => app.runtime.handle(ev, out));
        return send(res, 200, { reply: out.text });
      }
    }
    throw new HttpError(404, "not found");
  }

  function serveFile(res: http.ServerResponse, file: string): void {
    fs.readFile(file, (err, data) => {
      if (err) return void res.writeHead(404).end("not found");
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (!authorized(req, url, res)) return;
    if (url.pathname.startsWith("/amb/api/")) {
      api(req, res, url).catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log.error("api error", { path: url.pathname, message: (e as Error).message });
        if (!res.headersSent) send(res, status, { error: (e as Error).message });
      });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return serveFile(res, path.join(uiDir, "index.html"));
    if (url.pathname.startsWith("/amb/static/")) {
      const rel = path.normalize(url.pathname.slice("/amb/static/".length)).replace(/^(\.\.[/\\])+/, "");
      return serveFile(res, path.join(uiDir, rel));
    }
    if (url.pathname.startsWith("/amb/vendor/")) {
      const f = vendor[url.pathname.slice("/amb/vendor/".length)];
      if (!f) return void res.writeHead(404).end();
      return serveFile(res, f);
    }
    if (url.pathname === "/amb/healthz") return send(res, 200, { ok: true });
    // 其余路径全部交给 magpie（/magpie/* 以及 magpie 前端用到的绝对路径）
    proxyHttp(req, res, target);
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://localhost");
    const fake = { writeHead: () => ({ end: () => socket.destroy() }), end: () => socket.destroy() } as unknown as http.ServerResponse;
    if (!authorized(req, url, fake)) return;
    proxyUpgrade(req, socket, head, target);
  });

  const port = opts.port ?? cfg.ui.port;
  const listen = (p: number) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(p, host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  try {
    await listen(port);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0) throw e;
    log.warn(`端口 ${port} 被占用，改用随机端口`);
    await listen(0);
  }
  boundPort = (server.address() as import("node:net").AddressInfo).port;
  const shownHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${shownHost}:${boundPort}/`;
  log.info(`UI: ${url}`);
  return {
    url,
    port: boundPort,
    token,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
