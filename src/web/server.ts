import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import type { App } from "../app.js";
import type { InboundEvent, ReplySession } from "../core/types.js";
import { eventText } from "../core/types.js";
import { findAppRoot } from "../magpie/supervisor.js";
import { serveBotAppStatic } from "../botkit/static.js";
import { logger, registerSecret } from "../log.js";
import { LiveTurns, type LiveTurn } from "./live.js";
import { connectionFromPids } from "../agent/peer-guard.js";
import { groupPeer, type BotGroup } from "../store/db.js";
import { GroupChats } from "../core/groups.js";
import { ConnectionError, connectionUserMessage } from "../tools/accounts/index.js";
import { lang, normalizeLang, requestLang, t } from "../i18n/index.js";
import { HttpError, NOTION_CALLBACK, send, webEvent, consoleConvId, isLoopback, type Route, type WebContext } from "./http.js";
import { systemRoutes } from "./routes/system.js";
import { modelsRoutes } from "./routes/models.js";
import { accountRoutes } from "./routes/account.js";
import { settingsRoutes } from "./routes/settings.js";
import { computerRoutes } from "./routes/computer.js";
import { channelsRoutes } from "./routes/channels.js";
import { connectionsRoutes } from "./routes/connections.js";
import { APPS_CALLBACK, appsRoutes } from "./routes/apps.js";
import { AppUserError } from "../tools/apps/service.js";
import { tasksRoutes } from "./routes/tasks.js";
import { chatRoutes } from "./routes/chat.js";
import { botsRoutes } from "./routes/bots.js";
import { FilePreviews } from "./file-previews.js";

const log = logger("web");
const require = createRequire(import.meta.url);

export interface WebServer {
  url: string;
  port: number;
  token: string;
  busy(): boolean;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
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

export async function startWebServer(app: App, opts: { port?: number; host?: string } = {}): Promise<WebServer> {
  const cfg = app.config;
  const host = opts.host ?? cfg.ui.host;
  const uiDir = path.join(findAppRoot(), "ui");
  const vendor = vendorFiles();
  const filePreviews = new FilePreviews();
  // 非回环地址（如 Docker 0.0.0.0）必须带访问令牌；未配置则生成并写入数据目录（不打印到日志）
  let token = cfg.ui.token;
  // 用上目录 Bot 之后，命令行方式在非 Linux 的回环模式下也要令牌：技能脚本是外部代码，而进程来源检查只在 Linux 生效（agent/peer-guard.ts）。
  // 目录没启用时没有外部代码，行为不变
  const usesCatalog = app.catalog.enabled || app.store.listBots().some((b) => b.origin === "catalog");
  const loopbackNeedsToken = isLoopback(host) && !app.desktop && process.platform !== "linux" && usesCatalog;
  if ((!isLoopback(host) || loopbackNeedsToken) && !token) {
    const f = path.join(cfg.dataDir, "ui-token");
    token = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : crypto.randomBytes(18).toString("base64url");
    fs.writeFileSync(f, token, { mode: 0o600 });
    log.warn(`UI 监听在 ${host}，访问需带令牌：见 ${f}（打开 /?token=<令牌> 一次即可）`);
  }
  registerSecret(token);

  let boundPort = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`]);

  // —— 网页控制台进行中的消息：切走再切回、刷新后能接上，停止按钮不依赖发消息的那个请求 ——
  const live = new LiveTurns();
  function startLive(botId: string, text: string): LiveTurn {
    const convId = consoleConvId(botId);
    const last = app.store.getConversation(convId) ? (app.store.listMessages(convId, 1).at(-1)?.id ?? 0) : 0;
    return live.start(convId, botId, text, last);
  }
  // 代理自己醒来的一轮（后台命令结束）：像一条进行中的消息那样登记（没有用户消息），界面接上就能看到；结束时移出登记
  app.runtime.registerReplier("*", "web", (conv) => {
    if (conv.id !== consoleConvId(conv.botId)) return undefined;
    const t = startLive(conv.botId, "");
    return { out: t, done: () => live.end(t, "done", { conversationId: conv.id }) };
  });

  /** 排进会话队列交给运行时；结束时先移出登记，再通知发消息的请求和所有接上的界面。不抛错 */
  async function runLive(t: LiveTurn, ev: InboundEvent, out: ReplySession = t): Promise<void> {
    let err: Error | undefined;
    await app.queue.run(t.conversationId === consoleConvId(t.botId) ? `web:${t.botId}:console` : `web:${t.conversationId}`, async () => {
      try {
        await app.runtime.handle(ev, out, { signal: t.abort.signal });
      } catch (e) {
        err = e as Error;
      }
    });
    if (err) {
      log.warn("web chat failed", { message: err.message.slice(0, 300) });
      live.end(t, "error", { message: err.message });
    } else live.end(t, "done", { conversationId: t.conversationId });
  }

  // —— 应用内群聊（core/groups.ts）：一轮就是成员会话里的一条网页消息，事件转给接着这个群的界面 ——
  const groupTurns = new Map<string, LiveTurn>();
  const groups = new GroupChats({
    store: app.store,
    runTurn: async (botId, groupId, input) => {
      const g = app.store.getGroup(groupId);
      const peer = groupPeer(groupId);
      const conv = app.store.ensureConversation(botId, "web", peer, g?.name ?? "", "group");
      const before = app.store.listMessages(conv.id, 1).at(-1)?.id ?? 0;
      const lt = live.start(conv.id, botId, "", before);
      groupTurns.set(groupId, lt);
      groups.emit(groupId, "turn", { botId, conversationId: conv.id, ...lt.snapshot() });
      let failure = "";
      const off = lt.subscribe((e, d) => {
        if (e === "error") failure = String((d as { message?: unknown }).message ?? "");
        else if (e !== "done") groups.emit(groupId, e, d);
      });
      await runLive(lt, webEvent(botId, input, { kind: "group", id: peer }));
      off();
      groupTurns.delete(groupId);
      const replies = app.store.listMessages(conv.id, 20).filter((m) => m.id > before && m.role === "assistant");
      // 单聊里失败的话只显示在这一轮；群的时间线靠存下来的消息，所以记一条
      if (!replies.length && (failure || lt.text)) {
        const text = failure || lt.text;
        app.store.addMessage(conv.id, "assistant", text.startsWith("⚠️") ? text : `⚠️ ${text}`);
      }
      groups.emit(groupId, "turnEnd", { botId });
      return replies.map((m) => m.content).join("\n\n");
    },
  });
  function publicGroup(g: BotGroup) {
    const last = app.store.listGroupMessages(g.id, 5).filter((m) => m.role !== "system").at(-1);
    return {
      ...g,
      running: groups.isRunning(g.id),
      current: groups.current(g.id),
      last: last ? { id: last.id, botId: last.botId, text: last.content.slice(0, 120), at: last.createdAt } : null,
    };
  }
  /** 请求里的成员：去重、只留还在的机器人，至少两个 */
  function groupMembers(input: unknown): string[] {
    const ids = [...new Set(Array.isArray(input) ? input.map(String) : [])].filter((id) => app.store.getBot(id));
    if (ids.length < 2) throw new HttpError(400, t("web.groupTooFew"));
    return ids;
  }

  /** 停止会话里在处理的消息：网页的（含排队的）和其它渠道的都停 */
  function stopConversation(convId: string): boolean {
    const n = live.stop(convId);
    return app.runtime.stop(convId) || n > 0;
  }
  /** 网页里发的 /stop 连排在后面的网页消息一起停；其余同 interceptReply */
  function interceptWeb(ev: InboundEvent): { handled: boolean; ack?: string } {
    if (eventText(ev).trim().toLowerCase() === "/stop") live.stop(consoleConvId(ev.botId));
    return app.runtime.interceptReply(ev);
  }

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
    // This path validates its own expiring, directory-scoped capability in serve().
    if (FilePreviews.isAssetRequest(req, url)) return true;
    if (!token) return true;
    // 目录 Bot 的界面跑在不透明来源的沙箱里，带不上 Cookie；这条路径下只有静态文件，没有用户数据（botkit/static.ts）
    if (url.pathname.startsWith("/amb/botapp/") && (req.method === "GET" || req.method === "HEAD")) return true;
    const cookie = String(req.headers.cookie || "");
    const ok = cookie.split(/;\s*/).includes(`amb_token=${token}`) || req.headers["x-amb-token"] === token;
    if (ok) return true;
    if (url.searchParams.get("token") === token) {
      url.searchParams.delete("token");
      res.writeHead(302, { "set-cookie": `amb_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000`, location: url.pathname + url.search });
      res.end();
      return false;
    }
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" }).end(t("web.needToken"));
    return false;
  }

  // —— 接口按领域分在 web/routes/ 下：各组拿到同一份上下文，按顺序问一遍，谁处理了就停 ——
  const ctx: WebContext = {
    app,
    host,
    token,
    usesCatalog,
    get boundPort() {
      return boundPort;
    },
    live,
    startLive,
    runLive,
    interceptWeb,
    stopConversation,
    groups,
    groupTurns,
    publicGroup,
    groupMembers,
  };
  const routes: Route[] = [systemRoutes(ctx), modelsRoutes(ctx), accountRoutes(ctx), settingsRoutes(ctx), computerRoutes(ctx), channelsRoutes(ctx), connectionsRoutes(ctx), appsRoutes(ctx), tasksRoutes(ctx), chatRoutes(ctx, filePreviews), botsRoutes(ctx, filePreviews)];

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const p = url.pathname.slice("/amb/api".length);
    const m = req.method || "GET";
    const seg = p.split("/").filter(Boolean);
    // JSON 和技能 ZIP 都触发 CORS 预检；不接受跨站表单能发送的简单 Content-Type。
    const zipUpload = m === "POST" && seg[0] === "bots" && seg[2] === "skills" && (seg.length === 3 || (seg.length === 4 && seg[3] === "preview")) && /^application\/(zip|octet-stream)\s*(;|$)/i.test(String(req.headers["content-type"] || "").trim());
    if ((m === "POST" || m === "PUT" || m === "PATCH") && !zipUpload && !/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || "").trim())) {
      throw new HttpError(415, t("web.needJson"));
    }

    for (const route of routes) if ((await route(req, res, url, seg, p, m)) !== false) return;
    throw new HttpError(404, "not found");
  }

  function serveFile(res: http.ServerResponse, file: string): void {
    fs.readFile(file, (err, data) => {
      if (err) return void res.writeHead(404).end("not found");
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(data);
    });
  }

  // 界面请求带 x-amb-lang（界面当前的语言）：整个请求里的报错和状态文字都用这种语言（src/i18n）；
  // 没带的（curl、旧页面）按应用的语言偏好。连接关闭后，请求里启动的后台任务退回应用语言
  async function notionCallback(res: http.ServerResponse, url: URL): Promise<void> {
    let title = t("web.oauthDone");
    let detail = t("web.oauthClose");
    try {
      const account = await app.connections.notion.finishAuthorization({ state: url.searchParams.get("state"), code: url.searchParams.get("code"), error: url.searchParams.get("error") });
      detail = `${account.label} · ${detail}`;
    } catch (e) {
      title = t("web.oauthFailed");
      detail = connectionUserMessage(e);
      if (!(e instanceof ConnectionError)) log.warn("notion authorization failed", { message: (e as Error).message });
    }
    callbackPage(res, title, detail);
  }

  /** 连接应用的授权登录跳回来（tools/apps/service.ts）：一次性的 state 就是凭据，和 Notion 的回调一样不带控制台的令牌 */
  async function appsCallback(res: http.ServerResponse, url: URL): Promise<void> {
    let title = t("web.oauthDone");
    let detail = t("web.oauthClose");
    try {
      const done = await app.apps.oauthCallback({ state: url.searchParams.get("state"), code: url.searchParams.get("code"), error: url.searchParams.get("error") });
      detail = `${done.label} · ${detail}`;
    } catch (e) {
      title = t("web.oauthFailed");
      detail = e instanceof AppUserError ? e.message : t("apps.oauthFailed");
      if (!(e instanceof AppUserError)) log.warn("app authorization failed", { message: (e as Error).message });
    }
    callbackPage(res, title, detail);
  }

  function callbackPage(res: http.ServerResponse, title: string, detail: string): void {
    const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }).end(
      `<!doctype html><html lang="${escape(lang())}"><head><meta charset="utf-8"><title>${escape(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:16px system-ui,sans-serif;display:grid;place-content:center;min-height:90vh;text-align:center"><h1 style="font-size:20px;font-weight:600">${escape(title)}</h1><p>${escape(detail)}</p></body></html>`,
    );
  }

  const server = http.createServer((req, res) => {
    const scope = requestLang(normalizeLang(req.headers["x-amb-lang"]));
    res.once("close", scope.end);
    scope.run(() => handle(req, res));
  });
  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || "/", "http://localhost");
    // Notion 授权页跳回来：地址是固定的回环地址，浏览器不一定带着控制台的令牌；一次性的 state 就是凭据（tools/accounts/notion.ts）
    if (url.pathname === NOTION_CALLBACK && req.method === "GET") {
      void notionCallback(res, url);
      return;
    }
    if (url.pathname === APPS_CALLBACK && req.method === "GET") {
      void appsCallback(res, url);
      return;
    }
    if (!authorized(req, url, res)) return;
    if (filePreviews.serve(req, res, url)) return;
    if (url.pathname.startsWith("/amb/api/")) {
      api(req, res, url).catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log.error("api error", { path: url.pathname, message: (e as Error).message });
        if (!res.headersSent) send(res, status, { error: (e as Error).message });
      });
      return;
    }
    if (serveBotAppStatic(req, res, url, { uiDir, vendor, catalog: app.catalog })) return;
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
  }
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
    busy: () => live.bots().length > 0 || groups.hasActive(),
    close: () =>
      new Promise<void>((r) => {
        groups.stopAll();
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
