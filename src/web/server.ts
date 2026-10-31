import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { appVersion, type App } from "../app.js";
import type { InboundEvent, OutboundOp, ReplySession } from "../core/types.js";
import { eventText } from "../core/types.js";
import { findAppRoot } from "../magpie/supervisor.js";
import { logFilePath, logger, mask, readLogTail, registerSecret } from "../log.js";
import { diagnosticsReport, safeStatus, testAgent, testModel } from "../diagnostics.js";
import { ZOOMS, normalizeLowBalance, saveConfigFile } from "../config.js";
import { ApiError } from "../account/client.js";
import { OAuthError } from "../account/oauth.js";
import { normalizeLine } from "../modelflare.js";
import { SseReply } from "./sse-reply.js";
import { LiveTurns, type LiveTurn } from "./live.js";
import { connectionFromPids } from "../agent/peer-guard.js";
import type { ApprovalRow } from "../store/db.js";
import { normalizeSettings } from "../agent/settings.js";
import { scopeLabel } from "../agent/memory.js";
import { pwshProbe, type PwshMode } from "../agent/pwsh.js";
import { shortPeer, whoText } from "../core/access.js";
import type { AccessEntry, OutboxRow } from "../store/db.js";

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

/** 出站队列里等着重发或发不出去的消息：发给谁、内容摘要、原因 */
function publicOutbox(app: App, r: OutboxRow) {
  const owner = app.access.owner(r.botId, r.channel)?.peerId === r.peerId;
  const e = owner ? undefined : app.store.getAccess(r.botId, r.channel, r.peerId);
  const preview = r.kind === "file" ? `文件「${r.body.name ?? ""}」` : (r.body.text ?? "").replace(/\s+/g, " ").slice(0, 120);
  return {
    id: r.id,
    channel: r.channel,
    to: owner ? `${r.channel === "weixin" ? "微信" : "飞书"}主人` : whoText(e ?? { channel: r.channel, peerId: r.peerId, senderId: r.peerId, name: "" }),
    kind: r.kind,
    preview,
    status: r.status,
    attempts: r.attempts,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    due: r.due,
    expiresAt: r.expiresAt,
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
      if (m !== "GET" && !app.magpie) throw new HttpError(409, "外部模型端点模式下不管理 Modelflare 账户");
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
        if (!loginAvailable) throw new HttpError(409, "Docker 或远程部署时无法用浏览器登录，请改用 API Key");
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
          if (v !== Number(b.lowBalanceUsd)) throw new HttpError(400, "提醒线要在 0 到 1000 美元之间");
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
        imageModel: cfg.media.imageModel,
        videoModel: cfg.media.videoModel,
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
    // busy：有消息在处理的机器人（纯对话、排队、代理还在启动都算），侧栏的"正在工作"
    // background：每个机器人正在进行的后台任务数
    if (p === "/agent" && m === "GET") return send(res, 200, { ...app.agent.status(), busy: [...new Set([...live.bots(), ...app.runtime.busyBots()])], background: app.tasks.background() });
    // —— 后台任务（3a：列表、详情、一个 run 的步骤、停止）——
    if (seg[0] === "tasks") {
      if (seg.length === 1 && m === "GET") {
        const recent = url.searchParams.get("recent");
        return send(res, 200, {
          tasks: app.tasks.list({
            botId: url.searchParams.get("bot") || undefined,
            conversationId: url.searchParams.get("conversation") || undefined,
            since: recent ? Date.now() - Math.min(30, Math.max(0, Number(recent) || 1)) * 86400_000 : undefined,
            limit: Math.min(100, Number(url.searchParams.get("limit")) || 50),
          }),
        });
      }
      const task = seg[1] ? app.tasks.get(decodeURIComponent(seg[1])) : undefined;
      if (!task) throw new HttpError(404, "任务不存在");
      if (seg.length === 2 && m === "GET") {
        const runs = app.store.listRuns({ taskId: task.id }).map((r) => ({ id: r.id, cause: r.cause, state: r.state, outcome: r.outcome, error: r.error, queuedAt: r.queuedAt, startedAt: r.startedAt, endedAt: r.endedAt, steps: app.tasks.activity(r.id).length }));
        return send(res, 200, { task, runs });
      }
      if (seg.length === 5 && seg[2] === "runs" && seg[4] === "activity" && m === "GET") {
        const run = app.store.getRun(decodeURIComponent(seg[3]));
        if (!run || run.taskId !== task.id) throw new HttpError(404, "没有这次运行");
        return send(res, 200, { steps: app.tasks.activity(run.id) });
      }
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        const ok = await app.tasks.stopTask(task.id, "web");
        if (!ok) throw new HttpError(409, "任务已经停止了");
        return send(res, 200, { task: app.tasks.get(task.id) });
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
        if (process.platform !== "win32" || !pwshProbe.applicable) throw new HttpError(400, "只在 Windows 上需要");
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
        if (botId && !app.store.getBot(botId)) throw new HttpError(404, "机器人不存在");
        return send(res, 200, await testModel(app, { botId, model: b.model ? String(b.model) : undefined, timeoutMs: b.timeoutMs ? Number(b.timeoutMs) : undefined }));
      }
      if (sub === "test-agent" && m === "POST") {
        const b = await readJson(req);
        const botId = b.botId ? String(b.botId) : undefined;
        if (botId && !app.store.getBot(botId)) throw new HttpError(404, "机器人不存在");
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
      // 一条回复的代理活动记录（展开时才取）
      if (seg.length === 5 && seg[2] === "messages" && seg[4] === "activity" && m === "GET") {
        return send(res, 200, { steps: app.store.getActivity(decodeURIComponent(seg[1]), Number(seg[3])) });
      }
      // 正在处理的回合：处理了多久、最近一次进展、到目前为止的步骤（信息面板轮询）
      if (seg.length === 3 && seg[2] === "turn" && m === "GET") {
        const t = app.agent.turnsInProgress.get(decodeURIComponent(seg[1]));
        return send(res, 200, { turn: t ? { since: t.since, lastProgress: t.lastProgress, steps: t.activity.steps } : null });
      }
      // 停止：网页消息（排队的也算）、纯对话、还在等代理启动的、代理回合，都在这里停
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        return send(res, 200, { stopped: stopConversation(decodeURIComponent(seg[1])) });
      }
    }
    if (seg[0] === "bots") {
      if (seg.length === 1) {
        if (m === "GET") return send(res, 200, { bots: app.store.listBots().map(publicBot) });
        if (m === "POST") {
          const b = await readJson(req);
          if (!String(b.name || "").trim()) throw new HttpError(400, "名称不能为空");
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
          memory: { ...cur.memory, ...(b.memory ?? {}) },
          steward: { ...cur.steward, ...(b.steward ?? {}) },
        });
        const next = app.store.updateBot(id, { settings: merged })!;
        return send(res, 200, { settings: next.settings, computerUse: app.agent.computerUse(id) });
      }
      if (sub === "budget" && m === "PUT") {
        const b = await readJson(req);
        const limitUsd = Number(b.limitUsd ?? bot.settings.budget.limitUsd);
        if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 100_000) throw new HttpError(400, "预算要在 0 到 100000 美元之间");
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
        if (scope.kind === "group" && !scope.id.startsWith(id + ":")) throw new HttpError(400, "群不属于该机器人");
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
        const owner = (ch: "weixin" | "feishu") => {
          const o = v.owners[ch];
          const e = o?.entryId ? app.store.getAccessById(o.entryId) : undefined;
          return o ? { peer: shortPeer(o.peerId), who: e ? whoText(e) : whoText({ channel: ch, peerId: o.peerId, senderId: o.peerId, name: "" }), via: o.via, entryId: o.entryId ?? null } : null;
        };
        return send(res, 200, {
          policy: v.policy,
          owners: { weixin: owner("weixin"), feishu: owner("feishu") },
          requests: v.requests.map(publicAccess),
          entries: v.entries.filter((e) => e.status !== "owner").map(publicAccess),
        });
      }
      if (seg[2] === "access" && seg.length === 5 && m === "POST") {
        const entry = app.store.getAccessById(decodeURIComponent(seg[3]));
        if (!entry || entry.botId !== id) throw new HttpError(404, "记录不存在");
        if (seg[4] === "approve" || seg[4] === "deny") {
          const r = app.access.decide(entry.id, seg[4] === "approve", "web");
          if (!r) throw new HttpError(409, "这个请求已经处理过了");
          return send(res, 200, { entry: publicAccess(r) });
        }
        if (seg[4] === "owner") {
          try {
            return send(res, 200, { entry: publicAccess(app.access.setOwner(entry.id, "web")) });
          } catch (e) {
            throw new HttpError(409, (e as Error).message);
          }
        }
      }
      if (seg[2] === "access" && seg.length === 4 && m === "DELETE") {
        const entry = app.store.getAccessById(decodeURIComponent(seg[3]));
        if (!entry || entry.botId !== id) throw new HttpError(404, "记录不存在");
        app.access.remove(entry.id);
        return send(res, 200, { ok: true });
      }
      // —— 出站队列：等着重发的、发不出去的（信息面板） ——
      if (sub === "outbox" && m === "GET") {
        const waiting = app.store.listOutbox({ botId: id, status: "pending", limit: 50 }).filter((r) => r.attempts > 0 || r.error);
        const failed = app.store.listOutbox({ botId: id, status: "gone", dismissed: false, since: Date.now() - 7 * 86400_000, limit: 50 });
        return send(res, 200, { waiting: waiting.map((r) => publicOutbox(app, r)), failed: failed.map((r) => publicOutbox(app, r)) });
      }
      if (seg[2] === "outbox" && seg.length === 5 && seg[4] === "dismiss" && m === "POST") {
        const row = app.store.getOutbox(decodeURIComponent(seg[3]));
        if (!row || row.botId !== id) throw new HttpError(404, "消息不存在");
        if (!app.outbox.dismiss(row.id)) throw new HttpError(409, "这条消息还在发送");
        return send(res, 200, { ok: true });
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
        // 进行中的消息由 live 显示（用户消息、到目前为止的回复与步骤）；它开始之后存下的消息先不列，免得重复
        const turns = live.list(consoleConvId(id));
        const cut = turns[0]?.afterMessageId ?? Infinity;
        return send(res, 200, {
          conversationId: consoleConvId(id),
          model: conv?.model ?? "",
          messages: conv ? app.store.listMessages(conv.id, 200).filter((x) => x.id <= cut) : [],
          pending: app.store.listApprovals({ status: "pending", conversationId: consoleConvId(id), limit: 50 }).map(publicApproval),
          live: turns.map((t) => t.snapshot()),
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
        if (!text) throw new HttpError(400, "内容为空");
        const ev = webEvent(id, text);
        const intercepted = interceptWeb(ev);
        if (intercepted.handled) return send(res, 200, { reply: intercepted.ack ?? "", prompts: [] });
        const out = new CollectReply();
        const t = startLive(id, text);
        await runLive(t, ev, { apply: async (op) => (await t.apply(op), await out.apply(op)) });
        return send(res, 200, { reply: out.text, prompts: out.prompts, files: out.files, conversationId: consoleConvId(id) });
      }
      // 断开连接（切走、刷新、关窗口）不再中止这条消息：回合照常跑完，界面回来时经 chat/live 接上；停止走 /conversations/:id/stop
      if (sub === "chat/stream" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, "内容为空");
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
        const t = startLive(id, text);
        const off = t.subscribe((e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d)));
        res.on("close", off);
        await runLive(t, ev);
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
