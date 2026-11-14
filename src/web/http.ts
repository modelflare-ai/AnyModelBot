/** 网页接口共用的小函数（读请求、回 JSON、给界面的数据形状）和各组接口的约定（web/routes/）。 */
import http from "node:http";
import crypto from "node:crypto";
import type { App } from "../app.js";
import type { InboundEvent, OutboundOp, ReplySession } from "../core/types.js";
import { ApiError } from "../account/client.js";
import { OAuthError } from "../account/oauth.js";
import { LiveTurns, type LiveTurn } from "./live.js";
import { describeFile } from "./files.js";
import type { ApprovalRow, BotGroup, Message, Store } from "../store/db.js";
import { GroupChats } from "../core/groups.js";
import { appConnectOf, appToolOf, defaultLine } from "../agent/approvals.js";
import { shortPeer, whoText } from "../core/access.js";
import type { AccessEntry } from "../store/db.js";
import { exportFileName } from "../tasks/export.js";
import { t } from "../i18n/index.js";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function readJson(req: http.IncomingMessage): Promise<any> {
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
export const NOTION_CALLBACK = "/oauth/notion/callback";

export function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** 下载一份 Markdown（3f 的导出）：文件名用 RFC 5987 编码，中文标题照样 */
export function sendMarkdown(res: http.ServerResponse, title: string, text: string): void {
  const name = exportFileName(title);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  res.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  res.end(text);
}

export function publicBot(b: NonNullable<ReturnType<App["store"]["getBot"]>>) {
  return {
    id: b.id,
    name: b.name,
    templateId: b.templateId || undefined, templateVersion: b.templateVersion || undefined,
    systemPrompt: b.systemPrompt,
    defaultModel: b.defaultModel,
    settings: b.settings,
    origin: b.origin,
    app: b.app,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** 历史消息给界面：交付的文件带上名字、大小、是不是直接显示的图片、还在不在 */
export function publicMessage(m: Message) {
  return m.files ? { ...m, files: m.files.map((p) => describeFile(p)) } : m;
}

/** 网页“测试对话”渠道：收集输出 */
export class CollectReply implements ReplySession {
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
export function webEvent(botId: string, text: string, conversation: InboundEvent["conversation"] = { kind: "dm", id: "console" }): InboundEvent {
  return {
    id: crypto.randomUUID(),
    channel: "web",
    botId,
    conversation,
    sender: { id: "owner", name: "控制台" },
    parts: [{ type: "text", text }],
    replyHandle: {},
    receivedAt: Date.now(),
  };
}

export const consoleConvId = (botId: string) => `${botId}:web:console`;

/** 审批 / 提问给界面的字段；后台任务的带上任务名（卡片上「GPU 价格调研」想问你），有默认回答的带上「不回复就按中文做」 */
export function publicApproval(r: ApprovalRow, store?: Store) {
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
  // 连接应用的两种卡片（应用工具的审批、去连接 / 修复）：界面按这两个字段画
  const appTool = appToolOf(r);
  const appConnect = appConnectOf(r);
  const always = r.kind === "approval" && r.status === "allowed" && result === "always";
  return { ...rest, questions, ...(taskTitle ? { taskTitle } : {}), ...(note ? { note } : {}), ...(appTool ? { appTool: { ...appTool, botName: store?.getBot(r.botId)?.name ?? "" } } : {}), ...(appConnect ? { appConnect } : {}), ...(always ? { always: true } : {}) };
}

/** 允许名单 / 使用请求：界面要的字段（平台 id 只给末尾几位，界面不需要完整的） */
export function publicAccess(e: AccessEntry) {
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
export async function accountCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw new HttpError(e.status >= 400 && e.status < 500 ? e.status : 502, e.message);
    if (e instanceof OAuthError) throw new HttpError(502, e.message);
    throw e;
  }
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** 各组接口共用的东西（web/server.ts 里建好传进来） */
export interface WebContext {
  app: App;
  /** 监听的地址（判断是不是回环） */
  host: string;
  /** 访问令牌；回环模式下可能为空 */
  token: string;
  usesCatalog: boolean;
  /** 实际监听的端口（启动完成后才有） */
  readonly boundPort: number;
  live: LiveTurns;
  startLive(botId: string, text: string): LiveTurn;
  runLive(t: LiveTurn, ev: InboundEvent, out?: ReplySession): Promise<void>;
  interceptWeb(ev: InboundEvent): { handled: boolean; ack?: string };
  stopConversation(convId: string): boolean;
  groups: GroupChats;
  groupTurns: Map<string, LiveTurn>;
  publicGroup(g: BotGroup): unknown;
  groupMembers(input: unknown): string[];
}

/** 一组接口：处理了就返回（任何值），不是这组的返回 false，交给下一组 */
export type Route = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, seg: string[], p: string, m: string) => Promise<unknown>;
