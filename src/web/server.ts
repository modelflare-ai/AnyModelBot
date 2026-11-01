import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { appVersion, type App } from "../app.js";
import type { InboundEvent, OutboundOp, ReplySession } from "../core/types.js";
import { MESSENGERS, eventText, isMessenger, isPushChannel } from "../core/types.js";
import type { PlatformError } from "../channels/messenger/transport.js";
import { findAppRoot } from "../magpie/supervisor.js";
import { logFilePath, logger, mask, readLogTail, registerSecret } from "../log.js";
import { diagnosticsReport, safeStatus, testAgent, testModel } from "../diagnostics.js";
import { ZOOMS, normalizeLowBalance, saveConfigFile } from "../config.js";
import { ApiError } from "../account/client.js";
import { OAuthError } from "../account/oauth.js";
import { normalizeLine } from "../modelflare.js";
import { SseReply } from "./sse-reply.js";
import { LiveTurns, type LiveTurn } from "./live.js";
import { botWorkspace, describeFile, resolveFile, runnable, sendFile } from "./files.js";
import { connectionFromPids } from "../agent/peer-guard.js";
import type { ApprovalRow, Message, Store } from "../store/db.js";
import { defaultLine } from "../agent/approvals.js";
import { normalizeSettings } from "../agent/settings.js";
import { SEARCH_PROVIDERS, normalizeSearxUrl, type SearchProvider } from "../agent/search.js";
import { ConnectionError } from "../agent/accounts.js";
import { scopeLabel } from "../agent/memory.js";
import { pwshProbe, type PwshMode, type PwshStatus } from "../agent/pwsh.js";
import { ACCESS_CHANNELS, peerName, shortPeer, whoText, type AccessChannel } from "../core/access.js";
import type { AccessEntry, RuleMode } from "../store/db.js";
import { normalizeSchedule, type Schedule } from "../tasks/schedule.js";
import { exportFileName } from "../tasks/export.js";
import type { StageGroup } from "../tasks/stage.js";
import { GUIDE_STEPS, deriveGuide, isGuideStep, mergeGuide, normalizeGuide, type GuideState } from "../guide.js";
import { normalizeLang, requestLang, setLangPref, t, withLang, type LangPref, t as tr } from "../i18n/index.js";

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

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) throw new HttpError(415, t("web.needJson"));
  let body = "";
  for await (const c of req) {
    body += c;
    if (body.length > 1_000_000) throw new HttpError(413, t("web.bodyTooLarge"));
  }
  return body ? JSON.parse(body) : {};
}

/** Notion 一键授权的回调地址（必须和注册时一致，所以固定） */
const NOTION_CALLBACK = "/oauth/notion/callback";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** 下载一份 Markdown（3f 的导出）：文件名用 RFC 5987 编码，中文标题照样 */
function sendMarkdown(res: http.ServerResponse, title: string, text: string): void {
  const name = exportFileName(title);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  res.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  res.end(text);
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

/** 历史消息给界面：交付的文件带上名字、大小、是不是直接显示的图片、还在不在 */
function publicMessage(m: Message) {
  return m.files ? { ...m, files: m.files.map((p) => describeFile(p)) } : m;
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

/** 审批 / 提问给界面的字段；后台任务的带上任务名（卡片上「GPU 价格调研」想问你），有默认回答的带上「不回复就按中文做」 */
function publicApproval(r: ApprovalRow, store?: Store) {
  const { payload, result, ...rest } = r;
  let questions: unknown = undefined;
  if (r.kind === "question") {
    try {
      questions = JSON.parse(payload);
    } catch {
      questions = [];
    }
  }
  const taskTitle = r.taskId ? store?.getTask(r.taskId)?.title : undefined;
  const note = r.taskId && r.status === "pending" ? defaultLine(r) : undefined;
  return { ...rest, questions, ...(taskTitle ? { taskTitle } : {}), ...(note ? { note } : {}) };
}

/** 允许名单 / 使用请求：界面要的字段（平台 id 只给末尾几位，界面不需要完整的） */
function publicAccess(e: AccessEntry) {
  return {
    id: e.id,
    channel: e.channel,
    peer: shortPeer(e.peerId),
    who: whoText(e),
    status: e.status,
    source: e.source,
    code: e.code,
    text: e.text,
    requests: e.requests,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    decidedAt: e.decidedAt,
  };
}

/** 账户操作的错误：Modelflare 返回的状态码原样带给界面（没有状态码的网络错误按 502） */
async function accountCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw new HttpError(e.status >= 400 && e.status < 500 ? e.status : 502, e.message);
    if (e instanceof OAuthError) throw new HttpError(502, e.message);
    throw e;
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
    await app.queue.run(`web:${t.botId}:console`, async () => {
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
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" }).end(t("web.needToken"));
    return false;
  }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const p = url.pathname.slice("/amb/api".length);
    const m = req.method || "GET";
    const seg = p.split("/").filter(Boolean);
    // 写操作要求 JSON（触发 CORS 预检，阻止跨站表单 CSRF）
    if ((m === "POST" || m === "PUT" || m === "PATCH") && !/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || "").trim())) {
      throw new HttpError(415, t("web.needJson"));
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
      if (m !== "GET" && !app.magpie) throw new HttpError(409, t("web.externalNoConnection"));
    }
    if (p === "/modelflare") {
      if (m === "PUT") {
        const b = await readJson(req);
        const apiKey = String(b.apiKey ?? "").trim();
        if (!apiKey) throw new HttpError(400, t("web.missingApiKey"));
        const r = await app.connectModelflare(apiKey, normalizeLine(b.line ?? cfg.modelflare.line));
        if (!r.ok) return send(res, 400, { error: r.message, code: r.code, status: r.status, suggestLine: r.suggestLine });
        return send(res, 200, { ...app.modelflareStatus(), models: r.models });
      }
      if (m === "DELETE") {
        // 登录状态下断开 = 退出登录：先撤销授权，服务端会删除本机签发的 Key
        if (app.account.signedIn) await app.account.logout();
        else await app.disconnectModelflare();
        return send(res, 200, app.modelflareStatus());
      }
    }
    if (p === "/modelflare/line" && m === "PUT") {
      const b = await readJson(req);
      await app.setModelflareLine(normalizeLine(b.line));
      return send(res, 200, app.modelflareStatus());
    }
    if (p === "/media/models" && m === "GET") return send(res, 200, await app.mediaModels());
    if (p === "/models/info" && m === "GET") {
      if (!app.magpie) return send(res, 200, { models: {} });
      return send(res, 200, { models: await app.modelInfo(url.searchParams.get("refresh") === "1") });
    }
    if (seg[0] === "account") {
      const sub = seg.slice(1).join("/");
      if (m !== "GET" && !app.magpie) throw new HttpError(409, t("web.externalNoAccount"));
      // 浏览器登录的回调落在本程序所在机器的 127.0.0.1；界面监听在非本机地址（Docker、远程部署）时，
      // 用户的浏览器访问不到它，只能粘贴 API Key
      const loginAvailable = isLoopback(host);
      const status = () => ({ ...app.account.status(), loginAvailable });
      if (sub === "" && m === "GET") return send(res, 200, status());
      if (sub === "refresh" && m === "POST") {
        // 切回窗口时界面会来刷新；20 秒内刚读过就直接返回
        if (Date.now() - app.account.status().updatedAt >= 20_000) await app.account.refresh();
        return send(res, 200, status());
      }
      if (sub === "login" && m === "POST") {
        if (!loginAvailable) throw new HttpError(409, t("web.noBrowserLogin"));
        const loginUrl = await accountCall(() => app.account.startLogin());
        app.desktop?.openExternal(loginUrl);
        return send(res, 200, { ...status(), loginUrl, opened: !!app.desktop });
      }
      if (sub === "login/cancel" && m === "POST") {
        app.account.cancelLogin();
        return send(res, 200, status());
      }
      if (sub === "logout" && m === "POST") {
        const r = await app.account.logout();
        return send(res, 200, { ...status(), revoked: r.revoked });
      }
      if (sub === "alerts" && m === "PUT") {
        const b = await readJson(req);
        const mf = cfg.modelflare;
        if (b.lowBalanceUsd !== undefined) {
          const v = normalizeLowBalance(b.lowBalanceUsd);
          if (v !== Number(b.lowBalanceUsd)) throw new HttpError(400, t("web.lowBalanceRange"));
          mf.lowBalanceUsd = v;
        }
        if (b.lowBalancePush !== undefined) mf.lowBalancePush = !!b.lowBalancePush;
        saveConfigFile(cfg.dataDir, (f) => (f.modelflare = { ...(f.modelflare ?? {}), lowBalanceUsd: mf.lowBalanceUsd, lowBalancePush: mf.lowBalancePush }));
        return send(res, 200, status());
      }
      if (sub === "usage" && m === "GET") {
        // Modelflare 一次最多给 30 天的用量
        const days = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get("days") || 7)) || 7));
        return send(res, 200, await accountCall(() => app.account.usage(days)));
      }
      if (sub === "notifications" && m === "GET") return send(res, 200, { data: await accountCall(() => app.account.notifications()) });
      if (sub === "invite" && m === "GET") return send(res, 200, await accountCall(() => app.account.invite()));
      if (sub === "budgets" && m === "GET") return send(res, 200, { budgets: await accountCall(() => app.account.botBudgets()) });
    }
    if (p === "/settings") {
      if (m === "PUT") {
        const b = await readJson(req);
        if (b.defaultModel !== undefined) app.setDefaultModel(String(b.defaultModel));
        if (b.imageModel !== undefined || b.videoModel !== undefined) {
          app.setMediaModels({
            ...(b.imageModel !== undefined ? { imageModel: String(b.imageModel) } : {}),
            ...(b.videoModel !== undefined ? { videoModel: String(b.videoModel) } : {}),
          });
        }
        if (b.closeToTray !== undefined) {
          cfg.ui.closeToTray = !!b.closeToTray;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), closeToTray: cfg.ui.closeToTray }));
        }
        if (b.zoom !== undefined) {
          const z = Number(b.zoom);
          if (!ZOOMS.includes(z)) throw new HttpError(400, t("web.badZoom"));
          cfg.ui.zoom = z;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), zoom: z }));
          app.desktop?.applyZoom(z);
        }
        if (b.lang !== undefined) {
          const l = b.lang === "system" ? "system" : normalizeLang(b.lang);
          if (!l) throw new HttpError(400, t("web.badLang"));
          cfg.ui.lang = l as LangPref;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), lang: l }));
          setLangPref(cfg.ui.lang);
        }
        if (b.autostart !== undefined) {
          if (!app.desktop?.autostart().supported) throw new HttpError(400, t("web.noAutostart"));
          app.desktop.setAutostart(!!b.autostart);
        }
        if (b.webSearch && typeof b.webSearch === "object") {
          const w = b.webSearch as Record<string, unknown>;
          if (w.provider !== undefined && !SEARCH_PROVIDERS.includes(w.provider as SearchProvider)) throw new HttpError(400, t("web.badSearchProvider"));
          const url = w.url === undefined ? undefined : normalizeSearxUrl(String(w.url));
          if (url === undefined && w.url !== undefined) throw new HttpError(400, t("web.badSearchUrl"));
          app.setWebSearch({
            ...(w.provider !== undefined ? { provider: w.provider as SearchProvider } : {}),
            ...(w.key !== undefined ? { key: String(w.key).trim() } : {}),
            ...(url !== undefined ? { url } : {}),
          });
        }
      } else if (m !== "GET") throw new HttpError(405, "method not allowed");
      return send(res, 200, {
        defaultModel: cfg.llm.defaultModel,
        imageModel: cfg.media.imageModel,
        videoModel: cfg.media.videoModel,
        closeToTray: cfg.ui.closeToTray,
        zoom: cfg.ui.zoom,
        lang: cfg.ui.lang,
        autostart: app.desktop ? app.desktop.autostart() : { supported: false, on: false },
        desktop: !!app.desktop,
        listen: { host, port: boundPort, tokenRequired: !!token },
        dataDir: cfg.dataDir,
        webSearch: app.webSearchView(),
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
      if (!app.desktop) throw new HttpError(400, t("web.desktopOnly"));
      app.desktop.openDataDir();
      return send(res, 200, { ok: true });
    }
    // 界面主题变了（或刚加载完）：窗口按钮的符号颜色跟着换。只有 Windows 桌面版有这个钩子，其他环境静默忽略
    if (p === "/desktop/title-bar" && m === "POST") {
      const b = await readJson(req);
      app.desktop?.setTitleBarTheme?.(b.dark === true);
      return send(res, 200, { ok: true });
    }
    if (p === "/desktop/open-in-browser" && m === "POST") {
      if (!app.desktop) throw new HttpError(400, t("web.desktopOnly"));
      app.desktop.openInBrowser();
      return send(res, 200, { ok: true });
    }
    // busy：有消息在处理的机器人（纯对话、排队、代理还在启动都算），侧栏的"正在工作"
    // background：每个机器人正在进行的后台任务数
    // attention："需要你"的件数（侧栏那一行，没有就是 0）；needs：每个机器人几件、最早那件（机器人行的第二行）
    if (p === "/agent" && m === "GET") {
      const items = app.attention.list();
      return send(res, 200, { ...app.agent.status(), busy: [...new Set([...live.bots(), ...app.runtime.busyBots()])], background: app.tasks.background(), attention: items.length, needs: app.attention.byBot(items) });
    }
    // —— 需要你（3b）：所有机器人里在等人的事，和对它们的操作 ——
    // 已授权账号（设置 › 连接）：全局一份，所有机器人共用。令牌不出现在任何回复里
    if (seg[0] === "connections") {
      const c = app.connections;
      const guard = async <T>(run: () => Promise<T>): Promise<T> => {
        try {
          return await run();
        } catch (e) {
          if (e instanceof ConnectionError) throw new HttpError(400, e.message);
          throw e;
        }
      };
      if (seg.length === 1 && m === "GET") return send(res, 200, { accounts: c.accounts.view() });
      if (p === "/connections/notion/token" && m === "POST") {
        const b = await readJson(req);
        const token = String(b.token ?? "").trim();
        if (!token) throw new HttpError(400, t("web.notionTokenRejected"));
        const who = await c.notion.verifyToken(token);
        if (who.rejected) throw new HttpError(400, t("web.notionTokenRejected"));
        c.accounts.upsert({ service: "notion", label: who.label, identity: who.identity, auth: { kind: "notion-token", token } });
        return send(res, 200, { accounts: c.accounts.view() });
      }
      if (p === "/connections/notion/oauth" && m === "POST") {
        const url = await guard(() => c.notion.startAuthorization(`http://127.0.0.1:${boundPort}${NOTION_CALLBACK}`));
        return send(res, 200, { url });
      }
      if (p === "/connections/feishu" && m === "POST") {
        const b = await readJson(req);
        const appId = String(b.appId ?? "").trim();
        const appSecret = String(b.appSecret ?? "").trim();
        if (Boolean(appId) !== Boolean(appSecret)) throw new HttpError(400, t("web.feishuAppIncomplete"));
        return send(res, 200, { flow: c.feishu.startFlow(appId ? { appId, appSecret } : undefined) });
      }
      if (seg[1] === "flows" && seg[2]) {
        if (m === "DELETE") {
          c.feishu.cancelFlow(seg[2]);
          return send(res, 200, { ok: true });
        }
        const flow = c.feishu.flow(seg[2]);
        if (!flow) throw new HttpError(404, "not found");
        return send(res, 200, { flow, accounts: c.accounts.view() });
      }
      if (seg.length === 2 && m === "PUT") {
        const b = await readJson(req);
        const renamed = c.accounts.rename(seg[1], String(b.label ?? ""));
        if (renamed !== "ok") throw new HttpError(400, t(renamed === "taken" ? "web.accountNameTaken" : "web.badAccountName"));
        return send(res, 200, { accounts: c.accounts.view() });
      }
      if (seg.length === 2 && m === "DELETE") {
        c.accounts.remove(seg[1]);
        return send(res, 200, { accounts: c.accounts.view() });
      }
      throw new HttpError(405, "method not allowed");
    }
    if (seg[0] === "attention") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { items: app.attention.list() });
      const id = decodeURIComponent(seg[1] ?? "");
      const action = seg[2] ?? "";
      if (seg.length !== 3 || m !== "POST") throw new HttpError(404, "not found");
      const item = app.attention.list().find((x) => x.id === id);
      if (!item) throw new HttpError(409, tr("web.alreadyHandled"));
      if (!(item.actions as string[]).includes(action)) throw new HttpError(400, tr("web.unsupportedAction"));
      const b = await readJson(req);
      let ok = false;
      if (action === "approve" || action === "deny") ok = app.agent.approvals.decide(item.approvalId!, action === "approve", "web");
      else if (action === "answer") {
        ok = Array.isArray(b.answers)
          ? app.agent.approvals.answer(item.approvalId!, { answers: b.answers.map((a: any) => ({ id: String(a.id), selected: (a.selected ?? []).map(String), ...(a.custom ? { custom: String(a.custom) } : {}) })) }, "web")
          : app.agent.approvals.answerText(item.approvalId!, String(b.text ?? ""), "web");
      } else if (item.kind === "delivery" && (action === "retry" || action === "dismiss")) ok = app.delivery.act(item.id, action);
      // 观察够了的规则：改为执行（和规则详情里切模式一样）、继续观察（这一版不再问）
      else if (item.kind === "suggest") ok = action === "act" ? !app.tasks.updateRule(item.ruleId!, { mode: "act" }).error : app.tasks.keepObserving(item.ruleId!);
      else if (item.kind === "rule" && action === "retry") ok = !app.tasks.resumeRule(item.ruleId!).error;
      // 加预算接着做：规则每月再给 $3，任务再给 $1
      else if (item.kind === "rule" && action === "continue") ok = !app.tasks.addRuleBudget(item.ruleId!).error;
      else if (action === "continue") ok = !(await app.tasks.addBudget(item.taskId!, undefined, "web")).error;
      else if (action === "retry") ok = !(await app.tasks.retry(item.taskId!)).error;
      else if (action === "stop") ok = await app.tasks.stopTask(item.taskId!, "web");
      if (!ok) throw new HttpError(409, tr("web.couldntComplete"));
      app.attention.kick();
      return send(res, 200, { ok: true, items: app.attention.list() });
    }
    // —— 后台任务（3a：列表、详情、一个 run 的步骤、停止；3f：分组、大小、改预算、保留、打开文件夹、删除、导出）——
    if (seg[0] === "tasks") {
      if (seg.length === 1 && m === "GET") {
        const recent = url.searchParams.get("recent");
        // group=working|needs|ended（可以用逗号写几组）：进行中、等你、结束了（归档了的不列）
        const groups = (url.searchParams.get("group") || "").split(",").map((g) => g.trim()).filter(Boolean);
        if (groups.some((g) => !["working", "needs", "ended"].includes(g))) throw new HttpError(400, tr("web.badGroup"));
        return send(res, 200, {
          tasks: app.tasks.list({
            botId: url.searchParams.get("bot") || undefined,
            conversationId: url.searchParams.get("conversation") || undefined,
            since: recent ? Date.now() - Math.min(30, Math.max(0, Number(recent) || 1)) * 86400_000 : undefined,
            limit: Math.min(100, Number(url.searchParams.get("limit")) || 50),
            group: groups as StageGroup[],
          }),
        });
      }
      const task = seg[1] ? app.tasks.get(decodeURIComponent(seg[1])) : undefined;
      if (!task) throw new HttpError(404, tr("web.taskNotFound"));
      if (seg.length === 2 && m === "GET") {
        const runs = app.store
          .listRuns({ taskId: task.id })
          .map((r) => ({ id: r.id, cause: r.cause, state: r.state, outcome: r.outcome, error: r.error, costUsd: r.costUsd, queuedAt: r.queuedAt, startedAt: r.startedAt, endedAt: r.endedAt, steps: app.tasks.activity(r.id).length }));
        // 来自（渠道、时间、原话）、文件夹和会话记录的大小、能不能在系统里打开文件夹（桌面版）
        return send(res, 200, { task, runs, origin: app.tasks.origin(task.id), sizes: app.tasks.sizes(task.id), canOpen: !!app.desktop?.openPath });
      }
      // 删掉任务：在跑的先停下，文件夹、会话记录、运行记录一起删
      if (seg.length === 2 && m === "DELETE") {
        await app.tasks.deleteTask(task.id, "web");
        return send(res, 200, { ok: true });
      }
      // 预算（3e、3f）：{addUsd} 加多少（默认 $1），或 {budgetUsd} 改成多少；停在预算上的任务接着做
      if (seg.length === 3 && seg[2] === "budget" && m === "POST") {
        const b = await readJson(req);
        const r =
          b.budgetUsd !== undefined
            ? await app.tasks.setBudget(task.id, Number(b.budgetUsd), "web")
            : await app.tasks.addBudget(task.id, b.addUsd === undefined ? undefined : Number(b.addUsd), "web");
        if (r.error) throw new HttpError(400, r.error);
        return send(res, 200, { task: r.task });
      }
      // 保留文件夹：定了清理的不清理了，从现在起再算 30 天
      if (seg.length === 3 && seg[2] === "keep" && m === "POST") {
        const v = app.tasks.keepFolder(task.id);
        if (!v) throw new HttpError(409, tr("web.couldntComplete"));
        return send(res, 200, { task: v });
      }
      // 在系统的文件管理器里打开任务文件夹（桌面版）
      if (seg.length === 3 && seg[2] === "open" && m === "POST") {
        const dir = app.tasks.folderPath(task.id);
        if (!app.desktop?.openPath) throw new HttpError(400, tr("web.desktopOnly"));
        if (!dir) throw new HttpError(404, tr("web.taskNotFound"));
        fs.mkdirSync(dir, { recursive: true });
        app.desktop.openPath(dir);
        return send(res, 200, { ok: true });
      }
      // 导出成 Markdown：?lang= 是界面的语言（下载链接带不了请求头）
      if (seg.length === 3 && seg[2] === "export" && m === "GET") {
        const r = withLang(normalizeLang(url.searchParams.get("lang")), () => app.tasks.exportTask(task.id));
        if (!r) throw new HttpError(404, tr("web.taskNotFound"));
        return sendMarkdown(res, r.title, r.text);
      }
      if (seg.length === 5 && seg[2] === "runs" && seg[4] === "activity" && m === "GET") {
        const run = app.store.getRun(decodeURIComponent(seg[3]));
        if (!run || run.taskId !== task.id) throw new HttpError(404, tr("web.runNotFound"));
        return send(res, 200, { steps: app.tasks.activity(run.id) });
      }
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        const ok = await app.tasks.stopTask(task.id, "web");
        if (!ok) throw new HttpError(409, tr("web.taskAlreadyStopped"));
        return send(res, 200, { task: app.tasks.get(task.id) });
      }
      throw new HttpError(404, "not found");
    }
    // —— 规则（3d）：列表、新建、改（原话、时间表、模式、发到哪）、删、立即运行、运行记录与一次运行的步骤 ——
    if (seg[0] === "rules") {
      const scheduleOf = (raw: unknown, tz: string): Schedule => {
        const r = normalizeSchedule(raw, tz, Date.now());
        if (!r.schedule) throw new HttpError(400, r.error ?? t("rules.badSchedule"));
        return r.schedule;
      };
      if (seg.length === 1 && m === "GET") {
        return send(res, 200, { rules: app.tasks.listRules({ botId: url.searchParams.get("bot") || undefined, conversationId: url.searchParams.get("conversation") || undefined }) });
      }
      if (seg.length === 1 && m === "POST") {
        const b = await readJson(req);
        // 检查默认执行；mode observe = 用户在编辑器里选了先观察
        if (b.mode !== undefined && !["observe", "act"].includes(b.mode)) throw new HttpError(400, t("rules.badMode"));
        const r = app.tasks.createRule({
          botId: String(b.botId ?? ""),
          conversationId: String(b.conversationId ?? ""),
          title: String(b.title ?? ""),
          instruction: String(b.instruction ?? ""),
          kind: b.kind === "remind" ? "remind" : "check",
          ...(b.mode === "observe" ? { mode: "observe" as const } : {}),
          message: String(b.message ?? ""),
          schedule: scheduleOf(b.schedule, app.delivery.timeZone),
          ...(b.runBudgetUsd !== undefined ? { runBudgetUsd: Number(b.runBudgetUsd) } : {}),
          ...(b.monthBudgetUsd !== undefined ? { monthBudgetUsd: Number(b.monthBudgetUsd) } : {}),
        });
        if (!r.rule) throw new HttpError(400, r.error ?? t("rules.createFailed"));
        return send(res, 200, { rule: app.tasks.getRuleView(r.rule.id) });
      }
      const rule = seg[1] ? app.store.getRule(decodeURIComponent(seg[1])) : undefined;
      if (!rule) throw new HttpError(404, t("rules.notFound"));
      if (seg.length === 2 && m === "GET") return send(res, 200, { rule: app.tasks.getRuleView(rule.id) });
      if (seg.length === 2 && m === "PUT") {
        const b = await readJson(req);
        const patch: Parameters<typeof app.tasks.updateRule>[1] = {};
        if (b.title !== undefined) patch.title = String(b.title);
        if (b.instruction !== undefined) patch.instruction = String(b.instruction);
        if (b.message !== undefined) patch.message = String(b.message);
        if (b.conversationId !== undefined) patch.conversationId = String(b.conversationId);
        if (b.runBudgetUsd !== undefined) patch.runBudgetUsd = Number(b.runBudgetUsd);
        if (b.monthBudgetUsd !== undefined) patch.monthBudgetUsd = Number(b.monthBudgetUsd);
        if (b.mode !== undefined) {
          if (!["off", "observe", "act"].includes(b.mode)) throw new HttpError(400, t("rules.badMode"));
          patch.mode = b.mode as RuleMode;
        }
        if (b.schedule !== undefined) patch.schedule = scheduleOf(b.schedule, rule.trigger.kind === "schedule" ? rule.trigger.schedule.tz : app.delivery.timeZone);
        const r = app.tasks.updateRule(rule.id, patch);
        if (!r.rule) throw new HttpError(400, r.error ?? t("rules.saveFailed"));
        return send(res, 200, { rule: app.tasks.getRuleView(rule.id) });
      }
      if (seg.length === 2 && m === "DELETE") {
        await app.tasks.deleteRule(rule.id);
        return send(res, 200, { ok: true });
      }
      if (seg.length === 3 && seg[2] === "run" && m === "POST") {
        const r = rule.pausedReason ? app.tasks.resumeRule(rule.id) : app.tasks.runRuleNow(rule.id);
        if (r.error) throw new HttpError(409, r.error);
        return send(res, 200, { rule: app.tasks.getRuleView(rule.id) });
      }
      if (seg.length === 3 && seg[2] === "runs" && m === "GET") {
        const before = Number(url.searchParams.get("before")) || undefined;
        return send(res, 200, { runs: app.tasks.ruleLog(rule.id, { before, limit: Math.min(100, Number(url.searchParams.get("limit")) || 20) }) });
      }
      // 运行记录导出成 Markdown（3f）
      if (seg.length === 3 && seg[2] === "export" && m === "GET") {
        const r = withLang(normalizeLang(url.searchParams.get("lang")), () => app.tasks.exportRule(rule.id));
        if (!r) throw new HttpError(404, t("rules.notFound"));
        return sendMarkdown(res, r.title, r.text);
      }
      if (seg.length === 5 && seg[2] === "runs" && seg[4] === "activity" && m === "GET") {
        const run = app.store.getRun(decodeURIComponent(seg[3]));
        if (!run || run.ruleId !== rule.id) throw new HttpError(404, t("rules.runNotFound"));
        return send(res, 200, { steps: app.tasks.activity(run.id) });
      }
      throw new HttpError(404, "not found");
    }
    // —— Windows：代理用的 PowerShell（对话空状态、设置 → 常规、故障排查）——
    if (seg[0] === "pwsh") {
      const view = () => ({ ...pwshProbe.snapshot(), dismissed: cfg.ui.pwshHintDismissed });
      const setMode = (mode: PwshMode) => {
        if (cfg.agent.pwsh === mode) return;
        cfg.agent.pwsh = mode;
        saveConfigFile(cfg.dataDir, (f) => (f.agent = { ...(f.agent ?? {}), pwsh: mode }));
      };
      if (seg.length === 1 && m === "GET") {
        await pwshProbe.check();
        return send(res, 200, view());
      }
      // 重新检测：重新找、重新试运行（装好系统 PowerShell 7 后点它；空闲的代理进程随后换用）
      if (seg[1] === "recheck" && m === "POST") {
        await pwshProbe.check(true);
        return send(res, 200, view());
      }
      // 安装 / 重新安装应用内置的 PowerShell 7：后台进行，进度从 GET 读
      if (seg[1] === "install" && m === "POST") {
        if (process.platform !== "win32" || !pwshProbe.applicable) throw new HttpError(400, tr("web.windowsOnly"));
        const b = await readJson(req);
        setMode("auto");
        await pwshProbe.check();
        pwshProbe.install({ reinstall: !!b.reinstall });
        return send(res, 200, view());
      }
      // 改回系统默认（system）/ 重新用内置的（auto）
      if (seg[1] === "mode" && m === "PUT") {
        const b = await readJson(req);
        const mode: PwshMode = b.mode === "system" ? "system" : "auto";
        setMode(mode);
        pwshProbe.setMode(mode);
        return send(res, 200, view());
      }
      if (seg.length === 1 && m === "PUT") {
        const b = await readJson(req);
        if (b.dismissed !== undefined) {
          cfg.ui.pwshHintDismissed = !!b.dismissed;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), pwshHintDismissed: cfg.ui.pwshHintDismissed }));
        }
        await pwshProbe.check();
        return send(res, 200, view());
      }
      throw new HttpError(405, "method not allowed");
    }
    // —— 新手引导（上手清单）：进度写进 config.json；读的时候把能从数据里看出来做过的步骤并进去 ——
    if (p === "/guide") {
      const save = (g: GuideState) => {
        cfg.ui.guide = g;
        saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), guide: g }));
      };
      if (m === "PUT") {
        const b = await readJson(req);
        const add: unknown[] = b.done === undefined ? [] : Array.isArray(b.done) ? b.done : [b.done];
        if (!add.every(isGuideStep)) throw new HttpError(400, t("web.unknownGuideStep"));
        const g = b.reset ? normalizeGuide({}) : cfg.ui.guide;
        save(normalizeGuide({
          done: [...g.done, ...add],
          hidden: b.hidden !== undefined ? !!b.hidden : g.hidden,
          seen: [...g.seen, ...(typeof b.seen === "string" ? [b.seen] : [])],
        }));
      } else if (m !== "GET") throw new HttpError(405, "method not allowed");
      const bots = app.store.listBots();
      const derived = deriveGuide({
        conversations: app.store.listConversations(),
        bots,
        channelBound: (id) => !!app.store.getWeixinAccount(id) || MESSENGERS.some((c) => !!app.store.getMessengerAccount(id, c)),
        // 机器人自己的记忆，或所有机器人共享的团队记忆，有一条就算记下过
        memoryCount: (id) =>
          [{ kind: "bot" as const, id }, { kind: "team" as const, id: "" }].reduce((n, s) => n + app.agent.memory.entries(s).length + app.agent.memory.topics(s).length, 0),
      });
      const merged = mergeGuide(cfg.ui.guide, derived);
      if (merged.done.length !== cfg.ui.guide.done.length) save(merged);
      return send(res, 200, { steps: GUIDE_STEPS, ...cfg.ui.guide });
    }
    // —— 故障排查（设置 → 故障排查）：所有输出都已脱敏 ——
    if (seg[0] === "diagnostics") {
      const sub = seg.slice(1).join("/");
      if (sub === "" && m === "GET") return send(res, 200, safeStatus(app));
      if (sub === "logs" && m === "GET") {
        const n = Math.min(Math.max(Number(url.searchParams.get("lines")) || 200, 1), 2000);
        return send(res, 200, { file: logFilePath() ?? "", lines: readLogTail(n) });
      }
      if (sub === "report" && m === "GET") return send(res, 200, { text: diagnosticsReport(app, Math.min(Math.max(Number(url.searchParams.get("lines")) || 200, 1), 2000)) });
      if (sub === "test-model" && m === "POST") {
        const b = await readJson(req);
        const botId = b.botId ? String(b.botId) : undefined;
        if (botId && !app.store.getBot(botId)) throw new HttpError(404, t("web.botNotFound"));
        return send(res, 200, await testModel(app, { botId, model: b.model ? String(b.model) : undefined, timeoutMs: b.timeoutMs ? Number(b.timeoutMs) : undefined }));
      }
      if (sub === "test-agent" && m === "POST") {
        const b = await readJson(req);
        const botId = b.botId ? String(b.botId) : undefined;
        if (botId && !app.store.getBot(botId)) throw new HttpError(404, t("web.botNotFound"));
        return send(res, 200, await testAgent(app, { botId, model: b.model ? String(b.model) : undefined, timeoutMs: b.timeoutMs ? Number(b.timeoutMs) : undefined }));
      }
      if (sub === "restart-agent" && m === "POST") {
        const b = await readJson(req);
        const restarted = await app.agent.restartHosts(b.botId ? String(b.botId) : undefined);
        log.info("agent hosts restarted from troubleshooting", { restarted });
        return send(res, 200, { restarted, agent: (safeStatus(app) as any).agent });
      }
      throw new HttpError(404, "not found");
    }
    if (seg[0] === "approvals") {
      if (seg.length === 1 && m === "GET") {
        const status = url.searchParams.get("status") || undefined;
        return send(res, 200, { approvals: app.store.listApprovals({ status: status as any, botId: url.searchParams.get("bot") || undefined, limit: 100 }).map((r) => publicApproval(r, app.store)) });
      }
      const row = seg[1] ? app.store.getApproval(decodeURIComponent(seg[1])) : undefined;
      if (!row) throw new HttpError(404, t("web.requestNotFound"));
      if (seg.length === 2 && m === "GET") return send(res, 200, { approval: publicApproval(row, app.store) });
      if (seg.length === 3 && m === "POST" && (seg[2] === "approve" || seg[2] === "deny")) {
        if (row.kind !== "approval") throw new HttpError(400, t("web.notApproval"));
        const ok = app.agent.approvals.decide(row.id, seg[2] === "approve", "web");
        if (!ok) throw new HttpError(409, t("web.requestDone"));
        return send(res, 200, { approval: publicApproval(app.store.getApproval(row.id)!, app.store) });
      }
      if (seg.length === 3 && m === "POST" && seg[2] === "answer") {
        if (row.kind !== "question" || row.status !== "pending") throw new HttpError(409, t("web.requestDone"));
        const b = await readJson(req);
        const ok = Array.isArray(b.answers)
          ? app.agent.approvals.answer(row.id, { answers: b.answers.map((a: any) => ({ id: String(a.id), selected: (a.selected ?? []).map(String), ...(a.custom ? { custom: String(a.custom) } : {}) })) }, "web")
          : app.agent.approvals.answerText(row.id, String(b.text ?? ""), "web");
        if (!ok) throw new HttpError(409, t("web.submitFailed"));
        return send(res, 200, { approval: publicApproval(app.store.getApproval(row.id)!, app.store) });
      }
    }
    if (seg[0] === "conversations") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { conversations: app.store.listConversations(url.searchParams.get("bot") || undefined) });
      if (seg.length === 3 && seg[2] === "messages" && m === "GET") {
        const conv = app.store.getConversation(decodeURIComponent(seg[1]));
        if (!conv) throw new HttpError(404, t("web.conversationNotFound"));
        return send(res, 200, { conversation: conv, messages: app.store.listMessages(conv.id).map(publicMessage), canOpen: !!app.desktop?.openPath });
      }
      // 一条回复的代理活动记录（展开时才取）
      if (seg.length === 5 && seg[2] === "messages" && seg[4] === "activity" && m === "GET") {
        return send(res, 200, { steps: app.store.getActivity(decodeURIComponent(seg[1]), Number(seg[3])) });
      }
      // 正在处理的回合：处理了多久、最近一次进展、到目前为止的步骤（信息面板轮询）
      if (seg.length === 3 && seg[2] === "turn" && m === "GET") {
        const t = app.agent.turnsInProgress.get(decodeURIComponent(seg[1]));
        return send(res, 200, { turn: t ? { since: t.since, lastProgress: t.lastProgress, steps: t.activity.steps, interim: t.interim } : null });
      }
      // 停止：网页消息（排队的也算）、纯对话、还在等代理启动的、代理回合，都在这里停
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        return send(res, 200, { stopped: stopConversation(decodeURIComponent(seg[1])) });
      }
      // 交付的文件（web/files.ts）：GET file?path= 发给浏览器（图片、PDF、纯文本直接显示，其余下载）；
      // 桌面版 POST file/open 用系统的默认程序打开（打开就会运行的只在文件夹中显示），file/reveal 在文件夹中显示。
      // 只给这个会话交付过的文件和这个机器人工作区里的文件
      if (seg[2] === "file" && (seg.length === 3 ? m === "GET" : seg.length === 4 && (seg[3] === "open" || seg[3] === "reveal") && m === "POST")) {
        const conv = app.store.getConversation(decodeURIComponent(seg[1]));
        if (!conv) throw new HttpError(404, t("web.conversationNotFound"));
        const desktop = app.desktop;
        if (m === "POST" && !desktop?.openPath) throw new HttpError(400, t("web.desktopOnly"));
        const input = m === "GET" ? url.searchParams.get("path") : (await readJson(req)).path;
        const ws = botWorkspace(cfg.dataDir, conv.botId);
        const f = ws ? resolveFile(String(input ?? ""), { workspace: ws, dataDir: cfg.dataDir, delivered: app.store.deliveredFiles(conv.id) }) : undefined;
        if (!f) throw new HttpError(404, t("web.fileNotFound"));
        if (m === "GET") return sendFile(req, res, f);
        if (seg[3] === "open" && !runnable(f)) {
          desktop!.openPath!(f.path);
          return send(res, 200, { ok: true });
        }
        if (desktop!.showItemInFolder) desktop!.showItemInFolder(f.path);
        else desktop!.openPath!(path.dirname(f.path));
        return send(res, 200, { ok: true, revealed: true });
      }
    }
    if (seg[0] === "bots") {
      if (seg.length === 1) {
        if (m === "GET") return send(res, 200, { bots: app.store.listBots().map(publicBot) });
        if (m === "POST") {
          const b = await readJson(req);
          if (!String(b.name || "").trim()) throw new HttpError(400, t("web.nameRequired"));
          const bot = app.store.createBot({
            name: String(b.name).trim(),
            systemPrompt: String(b.systemPrompt ?? ""),
            defaultModel: String(b.defaultModel ?? ""),
            settings: normalizeSettings({ avatar: b.avatar }),
          });
          await app.startBot(bot.id);
          return send(res, 201, { bot: publicBot(bot) });
        }
      }
      const id = seg[1];
      const bot = id ? app.store.getBot(id) : undefined;
      if (!bot) throw new HttpError(404, t("web.botNotFound"));
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
          await app.deleteBot(id);
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
          ...(b.avatar !== undefined ? { avatar: b.avatar } : {}),
          ...(b.computerUse !== undefined ? { computerUse: { ...cur.computerUse, ...b.computerUse } } : {}),
          ...(b.media !== undefined ? { media: { ...cur.media, ...b.media } } : {}),
          ...(b.quietHours !== undefined ? { quietHours: { ...cur.quietHours, ...b.quietHours } } : {}),
          ...(b.nudge !== undefined ? { nudge: b.nudge } : {}),
          memory: { ...cur.memory, ...(b.memory ?? {}) },
          steward: { ...cur.steward, ...(b.steward ?? {}) },
        });
        app.store.updateBot(id, { settings: merged });
        // 暂停 / 恢复后台工作：恢复时排着的 run、主动消息要放出来，经任务服务改
        if (typeof b.paused === "boolean") app.tasks.setPaused(id, b.paused, "web");
        const next = app.store.getBot(id)!;
        return send(res, 200, { settings: next.settings, computerUse: app.agent.computerUse(id) });
      }
      if (sub === "budget" && m === "PUT") {
        const b = await readJson(req);
        const limitUsd = Number(b.limitUsd ?? bot.settings.budget.limitUsd);
        if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 100_000) throw new HttpError(400, t("web.budgetRange"));
        const next = await accountCall(() => app.setBotBudget(id, normalizeSettings({ budget: { enabled: !!b.enabled, limitUsd } }).budget));
        return send(res, 200, { settings: next.settings });
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
        if (scope.kind === "group" && !scope.id.startsWith(id + ":")) throw new HttpError(400, t("web.groupNotOwned"));
        try {
          const text = app.agent.memory.forget(scope, String(b.match ?? ""), { topic: b.topic ? String(b.topic) : undefined, by: "web" });
          return send(res, 200, { ok: true, text });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      // —— 谁能使用：主人、允许名单、使用请求 ——
      if (sub === "access" && m === "GET") {
        const v = app.access.view(id);
        const owner = (ch: AccessChannel) => {
          const o = v.owners[ch];
          if (!o) return null;
          const e = (o.entryId ? app.store.getAccessById(o.entryId) : undefined) ?? { channel: ch, peerId: o.peerId, senderId: o.peerId, name: "" };
          return { peer: shortPeer(o.peerId), name: peerName(e), via: o.via };
        };
        return send(res, 200, {
          policy: v.policy,
          owners: Object.fromEntries(ACCESS_CHANNELS.map((ch) => [ch, owner(ch)])),
          requests: v.requests.map(publicAccess),
          entries: v.entries.filter((e) => e.status !== "owner").map(publicAccess),
        });
      }
      if (seg[2] === "access" && seg.length === 5 && m === "POST") {
        const entry = app.store.getAccessById(decodeURIComponent(seg[3]));
        if (!entry || entry.botId !== id) throw new HttpError(404, tr("web.recordNotFound"));
        if (seg[4] === "approve" || seg[4] === "deny") {
          const r = app.access.decide(entry.id, seg[4] === "approve", "web");
          if (!r) throw new HttpError(409, tr("web.requestAlreadyHandled"));
          return send(res, 200, { entry: publicAccess(r) });
        }
      }
      // 更换主人：清掉"第一个发消息"的主人，下一个发单聊消息的人成为主人（扫码登录的微信要重新扫码）
      if (seg[2] === "access" && seg[3] === "owner" && seg.length === 5 && m === "DELETE") {
        const ch = seg[4];
        if (!isPushChannel(ch)) throw new HttpError(404, tr("web.noSuchChannel"));
        if (app.access.owner(id, ch)?.via === "login") throw new HttpError(409, tr("web.weixinOwnerRescan"));
        app.access.resetOwner(id, ch);
        return send(res, 200, { ok: true });
      }
      if (seg[2] === "access" && seg.length === 4 && m === "DELETE") {
        const entry = app.store.getAccessById(decodeURIComponent(seg[3]));
        if (!entry || entry.botId !== id) throw new HttpError(404, tr("web.recordNotFound"));
        app.access.remove(entry.id);
        return send(res, 200, { ok: true });
      }
      if (sub === "feishu" && m === "PUT") {
        const b = await readJson(req);
        const appId = String(b.appId ?? "").trim();
        const appSecret = String(b.appSecret ?? "").trim() || bot.feishuAppSecret;
        // 换了一个飞书应用：单聊会话都是新的，原来的主人对不上了，连上后第一个发消息的人成为主人
        if (appId !== bot.feishuAppId) app.access.resetOwner(id, "feishu");
        app.store.updateBot(id, { feishuAppId: appId, feishuAppSecret: appId ? appSecret : "" });
        await app.restartBot(id);
        return send(res, 200, app.channelStatus(id));
      }
      if (sub === "feishu" && m === "DELETE") {
        app.access.resetOwner(id, "feishu");
        app.store.updateBot(id, { feishuAppId: "", feishuAppSecret: "" });
        await app.restartBot(id);
        return send(res, 200, app.channelStatus(id));
      }
      if (isMessenger(sub) && m === "PUT") {
        try {
          await app.connectMessenger(id, sub, await readJson(req));
        } catch (e) {
          if ((e as PlatformError).rejected) throw new HttpError(400, (e as Error).message);
          throw e;
        }
        return send(res, 200, app.channelStatus(id));
      }
      if (isMessenger(sub) && m === "DELETE") {
        await app.disconnectMessenger(id, sub);
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
        // 进行中的消息由 live 显示（用户消息、到目前为止的回复与步骤）；它开始之后存下的消息先不列，免得重复
        const turns = live.list(consoleConvId(id));
        const cut = turns[0]?.afterMessageId ?? Infinity;
        return send(res, 200, {
          conversationId: consoleConvId(id),
          model: conv?.model ?? "",
          messages: conv ? app.store.listMessages(conv.id, 200).filter((x) => x.id <= cut).map(publicMessage) : [],
          pending: app.store.listApprovals({ status: "pending", conversationId: consoleConvId(id), limit: 50 }).map((r) => publicApproval(r, app.store)),
          live: turns.map((t) => t.snapshot()),
          // 桌面版：交付的文件用系统程序打开；网页里在新标签页打开
          canOpen: !!app.desktop?.openPath,
        });
      }
      // 接上进行中的消息（切走再切回、刷新后）：先发 snapshot，再转发之后的事件（同 chat/stream），最后 done / error。
      // turn 不给就接正在处理的那条；已经结束了直接 done
      if (sub === "chat/live" && m === "GET") {
        const t = live.get(consoleConvId(id), url.searchParams.get("turn"));
        const out = new SseReply(res);
        if (!t) return out.end("done", { conversationId: consoleConvId(id), ended: true });
        out.send("snapshot", t.snapshot());
        const off = t.subscribe((e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d)));
        res.on("close", off);
        return;
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
        if (!text) throw new HttpError(400, t("web.emptyText"));
        const ev = webEvent(id, text);
        const intercepted = interceptWeb(ev);
        if (intercepted.handled) return send(res, 200, { reply: intercepted.ack ?? "", prompts: [] });
        const out = new CollectReply();
        const lt = startLive(id, text);
        await runLive(lt, ev, { apply: async (op) => (await lt.apply(op), await out.apply(op)) });
        return send(res, 200, { reply: out.text, prompts: out.prompts, files: out.files, conversationId: consoleConvId(id) });
      }
      // 断开连接（切走、刷新、关窗口）不再中止这条消息：回合照常跑完，界面回来时经 chat/live 接上；停止走 /conversations/:id/stop
      if (sub === "chat/stream" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, t("web.emptyText"));
        const ev = webEvent(id, text);
        const out = new SseReply(res);
        try {
          const intercepted = interceptWeb(ev);
          if (intercepted.handled) {
            if (intercepted.ack) out.send("text", { text: intercepted.ack, final: true, ack: true });
            return out.end("done", { conversationId: consoleConvId(id) });
          }
        } catch (e) {
          return out.end("error", { message: (e as Error).message });
        }
        const lt = startLive(id, text);
        const off = lt.subscribe((e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d)));
        res.on("close", off);
        await runLive(lt, ev);
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
      detail = e instanceof ConnectionError ? e.message : t("web.oauthFailedRetry");
      if (!(e instanceof ConnectionError)) log.warn("notion authorization failed", { message: (e as Error).message });
    }
    const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }).end(
      `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui,sans-serif;display:grid;place-content:center;min-height:90vh;text-align:center"><h1 style="font-size:20px;font-weight:600">${escape(title)}</h1><p>${escape(detail)}</p></body>`,
    );
  }

  const server = http.createServer((req, res) => {
    const scope = requestLang(normalizeLang(req.headers["x-amb-lang"]));
    res.once("close", scope.end);
    scope.run(() => handle(req, res));
  });
  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || "/", "http://localhost");
    // Notion 授权页跳回来：地址是固定的回环地址，浏览器不一定带着控制台的令牌；一次性的 state 就是凭据（notion.ts）
    if (url.pathname === NOTION_CALLBACK && req.method === "GET") {
      void notionCallback(res, url);
      return;
    }
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
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
