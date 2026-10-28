import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { appVersion, type App } from "../app.js";
import type { InboundEvent, OutboundOp, ReplySession } from "../core/types.js";
import { findAppRoot } from "../magpie/supervisor.js";
import { logger, mask } from "../log.js";
import { ZOOMS, saveConfigFile } from "../config.js";
import { normalizeLine } from "../modelflare.js";
import { SseReply } from "./sse-reply.js";
import { connectionFromPids } from "../agent/peer-guard.js";
import type { ApprovalRow } from "../store/db.js";
import { normalizeSettings } from "../agent/settings.js";
import { scopeLabel } from "../agent/memory.js";

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
  ".woff2": "font/woff2",
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
    settings: b.settings,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** 网页“测试对话”渠道：收集输出 */
class CollectReply implements ReplySession {
  text = "";
  prompts: Array<{ kind: string; prompt: string; requestId?: string; code?: string }> = [];
  files: string[] = [];
  async apply(op: OutboundOp): Promise<void> {
    if (op.type === "file") this.files.push(op.name);
    if (op.type === "stream.finish" || op.type === "text") this.text += (this.text ? "\n" : "") + op.text;
    else if (op.type === "interactive") this.prompts.push({ kind: op.kind, prompt: op.prompt, requestId: op.requestId, code: op.code });
  }
}

/** 网页控制台对话：每个机器人一个固定会话 <botId>:web:console */
function webEvent(botId: string, text: string): InboundEvent {
  return {
    id: crypto.randomUUID(),
    channel: "web",
    botId,
    conversation: { kind: "dm", id: "console" },
    sender: { id: "owner", name: "控制台" },
    parts: [{ type: "text", text }],
    replyHandle: {},
    receivedAt: Date.now(),
  };
}
const consoleConvId = (botId: string) => `${botId}:web:console`;

function publicApproval(r: ApprovalRow) {
  const { payload, result, ...rest } = r;
  let questions: unknown = undefined;
  if (r.kind === "question") {
    try {
      questions = JSON.parse(payload);
    } catch {
      questions = [];
    }
  }
  return { ...rest, questions };
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

  let boundPort = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`]);

  function authorized(req: http.IncomingMessage, url: URL, res: http.ServerResponse): boolean {
    // 代理沙箱可访问回环网络：拒绝一切来自 DSH 子进程及其工具进程的请求（防止自行批准/读取配置）
    const pids = app.agent.childPids();
    if (pids.length && connectionFromPids(req.socket.remotePort, req.socket.localPort, pids)) {
      log.warn("blocked request from agent sandbox", { path: url.pathname });
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("forbidden from agent sandbox");
      return false;
    }
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
        version: appVersion(),
        dataDir: cfg.dataDir,
        username: app.username,
        desktop: !!app.desktop,
        platform: process.platform,
        // 诊断信息：内置网关只是实现细节，界面里只在"关于 → 诊断信息"展示
        gateway: mp ? { mode: "managed", state: mp.state, lastError: mp.lastError, restarts: mp.restarts } : { mode: "external", state: "external" },
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
    if (p === "/modelflare" || p === "/modelflare/line") {
      if (m === "GET" && p === "/modelflare") return send(res, 200, app.modelflareStatus());
      if (m !== "GET" && !app.magpie) throw new HttpError(409, "外部模型端点模式下不管理 Modelflare 连接");
    }
    if (p === "/modelflare") {
      if (m === "PUT") {
        const b = await readJson(req);
        const apiKey = String(b.apiKey ?? "").trim();
        if (!apiKey) throw new HttpError(400, "缺少 API Key");
        const r = await app.connectModelflare(apiKey, normalizeLine(b.line ?? cfg.modelflare.line));
        if (!r.ok) return send(res, 400, { error: r.message, code: r.code, status: r.status, suggestLine: r.suggestLine });
        return send(res, 200, { ...app.modelflareStatus(), models: r.models });
      }
      if (m === "DELETE") {
        await app.disconnectModelflare();
        return send(res, 200, app.modelflareStatus());
      }
    }
    if (p === "/modelflare/line" && m === "PUT") {
      const b = await readJson(req);
      await app.setModelflareLine(normalizeLine(b.line));
      return send(res, 200, app.modelflareStatus());
    }
    if (p === "/settings") {
      if (m === "PUT") {
        const b = await readJson(req);
        if (b.defaultModel !== undefined) app.setDefaultModel(String(b.defaultModel));
        if (b.closeToTray !== undefined) {
          cfg.ui.closeToTray = !!b.closeToTray;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), closeToTray: cfg.ui.closeToTray }));
        }
        if (b.zoom !== undefined) {
          const z = Number(b.zoom);
          if (!ZOOMS.includes(z)) throw new HttpError(400, "不支持的缩放比例");
          cfg.ui.zoom = z;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), zoom: z }));
          app.desktop?.applyZoom(z);
        }
        if (b.autostart !== undefined) {
          if (!app.desktop?.autostart().supported) throw new HttpError(400, "当前环境不支持开机自启");
          app.desktop.setAutostart(!!b.autostart);
        }
      } else if (m !== "GET") throw new HttpError(405, "method not allowed");
      return send(res, 200, {
        defaultModel: cfg.llm.defaultModel,
        closeToTray: cfg.ui.closeToTray,
        zoom: cfg.ui.zoom,
        autostart: app.desktop ? app.desktop.autostart() : { supported: false, on: false },
        desktop: !!app.desktop,
        listen: { host, port: boundPort, tokenRequired: !!token },
        dataDir: cfg.dataDir,
      });
    }
    if (p === "/notices" && m === "GET") {
      const read = (f: string) => {
        try {
          return fs.readFileSync(path.join(findAppRoot(), f), "utf8");
        } catch {
          return "";
        }
      };
      return send(res, 200, { license: read("LICENSE"), notices: read("THIRD_PARTY_NOTICES.md") });
    }
    if (p === "/desktop/open-data-dir" && m === "POST") {
      if (!app.desktop) throw new HttpError(400, "仅桌面版可用");
      app.desktop.openDataDir();
      return send(res, 200, { ok: true });
    }
    if (p === "/desktop/open-in-browser" && m === "POST") {
      if (!app.desktop) throw new HttpError(400, "仅桌面版可用");
      app.desktop.openInBrowser();
      return send(res, 200, { ok: true });
    }
    if (p === "/agent" && m === "GET") return send(res, 200, app.agent.status());
    if (seg[0] === "approvals") {
      if (seg.length === 1 && m === "GET") {
        const status = url.searchParams.get("status") || undefined;
        return send(res, 200, { approvals: app.store.listApprovals({ status: status as any, botId: url.searchParams.get("bot") || undefined, limit: 100 }).map(publicApproval) });
      }
      const row = seg[1] ? app.store.getApproval(decodeURIComponent(seg[1])) : undefined;
      if (!row) throw new HttpError(404, "请求不存在");
      if (seg.length === 2 && m === "GET") return send(res, 200, { approval: publicApproval(row) });
      if (seg.length === 3 && m === "POST" && (seg[2] === "approve" || seg[2] === "deny")) {
        if (row.kind !== "approval") throw new HttpError(400, "不是审批请求");
        const ok = app.agent.approvals.decide(row.id, seg[2] === "approve", "web");
        if (!ok) throw new HttpError(409, "请求已处理或已过期");
        return send(res, 200, { approval: publicApproval(app.store.getApproval(row.id)!) });
      }
      if (seg.length === 3 && m === "POST" && seg[2] === "answer") {
        if (row.kind !== "question" || row.status !== "pending") throw new HttpError(409, "请求已处理或已过期");
        const b = await readJson(req);
        const ok = Array.isArray(b.answers)
          ? app.agent.approvals.answer(row.id, { answers: b.answers.map((a: any) => ({ id: String(a.id), selected: (a.selected ?? []).map(String), ...(a.custom ? { custom: String(a.custom) } : {}) })) }, "web")
          : app.agent.approvals.handleReply(row.conversationId, String(b.text ?? ""), "web").handled;
        if (!ok) throw new HttpError(409, "提交失败");
        return send(res, 200, { approval: publicApproval(app.store.getApproval(row.id)!) });
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
          await app.agent.stopBot(id);
          app.store.deleteBot(id);
          return send(res, 200, { ok: true });
        }
      }
      const sub = seg.slice(2).join("/");
      if (sub === "channels" && m === "GET") return send(res, 200, app.channelStatus(id));
      if (sub === "settings" && m === "GET") return send(res, 200, { settings: bot.settings, computerUse: app.agent.computerUse(id) });
      if (sub === "settings" && m === "PUT") {
        const b = await readJson(req);
        // 只接受已知字段；未给出的沿用当前值
        const cur = bot.settings;
        const merged = normalizeSettings({
          ...cur,
          ...(b.permission !== undefined ? { permission: b.permission } : {}),
          ...(b.utilityModel !== undefined ? { utilityModel: b.utilityModel } : {}),
          ...(b.computerUse !== undefined ? { computerUse: { ...cur.computerUse, ...b.computerUse } } : {}),
          memory: { ...cur.memory, ...(b.memory ?? {}) },
          steward: { ...cur.steward, ...(b.steward ?? {}) },
        });
        const next = app.store.updateBot(id, { settings: merged })!;
        return send(res, 200, { settings: next.settings, computerUse: app.agent.computerUse(id) });
      }
      if (sub === "memory" && m === "GET") {
        const scopes = [
          { kind: "team" as const, id: "" },
          { kind: "bot" as const, id },
          ...app.store
            .listConversations(id)
            .filter((c) => c.kind === "group")
            .map((c) => ({ kind: "group" as const, id: c.id })),
        ];
        return send(res, 200, {
          scopes: scopes.map((s) => ({
            kind: s.kind,
            id: s.id,
            label: scopeLabel(s),
            entries: app.agent.memory.entries(s).map((e) => ({ text: e.text, meta: e.meta })),
            topics: app.agent.memory.topics(s).map((t) => ({ name: t, entries: app.agent.memory.entries(s, t).map((e) => ({ text: e.text, meta: e.meta })) })),
          })),
          journal: app.agent.memory.journalTail(30).filter((j) => j.scope === "team" || j.scope.includes(id)),
          steward: app.agent.stewardLog.filter((l) => l.conversationId.startsWith(id + ":")).slice(-20),
        });
      }
      if (sub === "memory/forget" && m === "POST") {
        const b = await readJson(req);
        const kind = String(b.kind ?? "bot");
        const scope = kind === "team" ? { kind: "team" as const, id: "" } : kind === "group" ? { kind: "group" as const, id: String(b.id ?? "") } : { kind: "bot" as const, id };
        if (scope.kind === "group" && !scope.id.startsWith(id + ":")) throw new HttpError(400, "群不属于该机器人");
        try {
          const text = app.agent.memory.forget(scope, String(b.match ?? ""), { topic: b.topic ? String(b.topic) : undefined, by: "web" });
          return send(res, 200, { ok: true, text });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
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
      if (sub === "chat" && m === "GET") {
        const conv = app.store.getConversation(consoleConvId(id));
        return send(res, 200, {
          conversationId: consoleConvId(id),
          model: conv?.model ?? "",
          messages: conv ? app.store.listMessages(conv.id, 200) : [],
          pending: app.store.listApprovals({ status: "pending", conversationId: consoleConvId(id), limit: 50 }).map(publicApproval),
        });
      }
      if (sub === "chat/model" && m === "PUT") {
        const b = await readJson(req);
        const conv = app.store.ensureConversation(id, "web", "console", "控制台");
        app.store.setConversationModel(conv.id, String(b.model ?? ""));
        return send(res, 200, { conversationId: conv.id, model: String(b.model ?? "") });
      }
      if (sub === "chat" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, "内容为空");
        const ev = webEvent(id, text);
        const intercepted = app.runtime.interceptReply(ev);
        if (intercepted.handled) return send(res, 200, { reply: intercepted.ack ?? "", prompts: [] });
        const out = new CollectReply();
        await app.queue.run(`web:${id}:console`, () => app.runtime.handle(ev, out));
        return send(res, 200, { reply: out.text, prompts: out.prompts, files: out.files, conversationId: consoleConvId(id) });
      }
      if (sub === "chat/stream" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, "内容为空");
        const ev = webEvent(id, text);
        const out = new SseReply(res);
        const ac = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) ac.abort();
        });
        try {
          const intercepted = app.runtime.interceptReply(ev);
          if (intercepted.handled) {
            if (intercepted.ack) out.send("text", { text: intercepted.ack, final: true, ack: true });
            return out.end("done", { conversationId: consoleConvId(id) });
          }
          await app.queue.run(`web:${id}:console`, async () => {
            if (!ac.signal.aborted) await app.runtime.handle(ev, out, { signal: ac.signal });
          });
          out.end("done", { conversationId: consoleConvId(id) });
        } catch (e) {
          log.warn("web chat failed", { message: (e as Error).message.slice(0, 300) });
          out.end("error", { message: (e as Error).message });
        }
        return;
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
    // 不再反代内置网关的界面或 /v1：网关只供本进程内部调用
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  });
  server.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"));

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
