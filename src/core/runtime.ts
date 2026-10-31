import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChannelId, InboundEvent, ReplySession } from "./types.js";
import { KeyedQueue } from "./queue.js";
import { eventText } from "./types.js";
import { acceptsImages, type ModelClient, type ChatMessage } from "../llm/client.js";
import { TurnStopped, type TurnImage } from "../agent/host.js";
import { describeStep, fmtSecs, type ActivityStep } from "../agent/activity.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import type { AgentManager } from "../agent/manager.js";
import { promptButtons, promptText } from "../agent/approvals.js";
import { segmentInput, type ChatPlace } from "../agent/prompts/index.js";
import { clearInflight, markInflight, takeNotice } from "./recovery.js";
import { pwshProbe, pwshStatusLine } from "../agent/pwsh.js";
import { isBotProviderModel } from "../modelflare.js";
import type { ApprovalRow, Conversation } from "../store/db.js";
import type { AccessControl } from "./access.js";
import { takeTaskNotes } from "../tasks/service.js";

const log = logger("runtime");

const IMAGE_EXT: Record<TurnImage["mimeType"], string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const MAX_INLINE_IMAGES = 4;
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

/** 用户这条消息里能直接交给模型看的图片（格式已识别、不太大） */
export function inboundImages(ev: InboundEvent): TurnImage[] {
  const out: TurnImage[] = [];
  for (const p of ev.parts) {
    if (p.type !== "image" || !p.data || !(p.mime && p.mime in IMAGE_EXT) || p.data.length > MAX_INLINE_IMAGE_BYTES) continue;
    if (out.length < MAX_INLINE_IMAGES) out.push({ data: p.data.toString("base64"), mimeType: p.mime as TurnImage["mimeType"] });
  }
  return out;
}

/** Windows 的保留设备名（带不带扩展名都不能用作文件名） */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
/** 文件名上限（UTF-8 字节；前面还要加 23 字节的时间戳前缀，常见文件系统上限 255） */
const MAX_NAME_BYTES = 150;

/**
 * 发送者给的文件名，在三个平台上都能用：只留最后一段，去掉控制字符和 Windows 不允许的 <>:"/\|?*
 * （冒号在 NTFS 上还会写进备用数据流）、开头的点、结尾的点和空格，避开保留设备名，
 * 按字节限长（保留扩展名，不切开字符）。中文照常保留。
 */
export function safeFileName(name: string | undefined): string {
  const base = path
    .basename((name ?? "").replace(/\\/g, "/"))
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "")
    .trim()
    .replace(/^\.+/, "");
  const ext = path.extname(base).length <= 16 ? path.extname(base) : "";
  let stem = "";
  let bytes = Buffer.byteLength(ext);
  for (const ch of base.slice(0, base.length - ext.length)) {
    bytes += Buffer.byteLength(ch);
    if (bytes > MAX_NAME_BYTES) break;
    stem += ch;
  }
  const out = (stem + ext).replace(/[. ]+$/, "");
  if (!out) return "file";
  return RESERVED_NAME.test(out) ? `_${out}` : out;
}

/**
 * 把用户发来的图片/文件/视频存进机器人工作区的 inbox/，消息文字里换成相对路径：
 * 代理可以读取、处理，或当生图的参考素材（workspace:inbox/...）。
 */
export function storeInbound(workspace: string, ev: InboundEvent, now = new Date()): void {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  for (const p of ev.parts) {
    if ((p.type !== "image" && p.type !== "file" && p.type !== "video") || !p.data || p.path) continue;
    const id = `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
    const name =
      p.type === "image" ? `${id}${IMAGE_EXT[p.mime as TurnImage["mimeType"]] ?? ".jpg"}` : p.type === "video" ? `${id}.mp4` : `${id}-${safeFileName(p.name)}`;
    try {
      fs.mkdirSync(path.join(workspace, "inbox"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "inbox", name), p.data);
      p.path = `inbox/${name}`;
    } catch (e) {
      log.warn("save inbound media failed", { type: p.type, message: (e as Error).message.slice(0, 200) });
      p.error = "保存到工作区失败";
    }
  }
}

export interface RuntimeOptions {
  store: Store;
  models: ModelClient;
  defaultModel: () => string;
  contextMessages: number;
  contextChars: number;
  /** DSH 代理宿主；缺省或不可用时走纯对话路径 */
  agent?: AgentManager;
  /**
   * 发给模型网关前把模型 id 限定到该机器人用的 Key（共用 Key 或它自己的预算 Key）。
   * 会话与界面里保存的仍是不带 provider 的 id。缺省原样发送。
   */
  route?: (botId: string, model: string) => string;
  /** 谁能和机器人对话（主人 + 允许名单）；缺省不限制 */
  access?: AccessControl;
}

const HELP = [
  "可用命令：",
  "/model — 列出可用模型（带编号）",
  "/model <编号或模型名> — 切换当前会话的模型",
  "/reset — 清空当前会话的上下文（代理模式下同时开启新的代理会话；长期记忆保留）",
  "/new — 开始新的一段对话：旧对话归档并生成交接便条，长期记忆保留",
  "/status — 查看当前模型、代理状态和正在处理的消息走到了哪一步",
  "/stop — 中止正在处理的消息（只停这个会话，机器人的其它会话照常进行）",
  "/tasks — 列出这个会话的后台任务",
  "/stop <编号> — 停止 /tasks 里的一个后台任务",
  "/help — 显示本帮助",
].join("\n");

/** 一条正在处理的消息（各渠道都有）：/stop、网页的停止按钮经 abort 中止它 */
interface Inflight {
  botId: string;
  since: number;
  abort: AbortController;
  /** 被应用退出打断：不回复，标记留着，下次启动时告诉用户（recovery.ts） */
  interrupted?: boolean;
  /** 让出渠道的串行队列：代理收下这条消息（或这条并进了进行中的回合）后，后来的消息不必再等它结束 */
  release?: () => void;
  /** 用户消息已经存进历史（交给代理时就存，保证插进来的消息排在它后面） */
  userStored?: boolean;
}

/** 回合还没交给代理（或纯对话还没出字）就被停止时的回复 */
export const stoppedText = (ms: number) => `已中止（处理了 ${fmtSecs(ms)}）。`;

/** 新消息并进了正在进行的代理回合：先回这一句，回复在那一轮结束时一起给 */
export const STEER_ACK = "收到，这条会并入正在进行的处理，稍后一起回复。";

/**
 * 不是回复某条消息、而是主动发到会话里（代理自己醒来的一轮：后台命令结束）：渠道给出这个会话的出站会话。
 * 微信、飞书的回复会话经出站队列发（和普通回复同一条路：落库、按会话排队、重试、发送时才查微信的窗口和配额）。
 * handle 是这个会话最近收到的那条消息的回复句柄（存在 KV 里，重启也在）；key 决定出站消息的 id（同一轮的回复只发一次）；
 * done 在这一轮结束时调用。没有办法发时返回 undefined。
 */
export type Replier = (conv: Conversation, handle: Record<string, string> | undefined, key: string) => { out: ReplySession; done?: () => void } | undefined;

/** 会话最近收到的那条消息的回复句柄（飞书回复要它） */
const REPLY_TO = "reply-to:";

/** 渠道无关的对话运行时：命令处理、上下文拼装、流式调用模型、持久化。 */
export class BotRuntime {
  private modelCache: { at: number; list: string[] } | undefined;
  /** 会话 → 正在处理的消息 */
  private inflight = new Map<string, Set<Inflight>>();
  /** 应用正在退出：正在处理的消息算被打断，不再回复也不改用纯对话 */
  private closing = false;
  /** 会话 → 之前所有消息都处理完的时刻（同一会话的消息按到达顺序处理；并进进行中回合的不必等） */
  private tails = new Map<string, Promise<void>>();
  /** "<botId>:<渠道>" → 主动发消息的出站会话 */
  private repliers = new Map<string, Replier>();
  constructor(private opts: RuntimeOptions) {
    // 代理自己醒来开了一轮（后台命令结束）：跟着它，把回复发到会话里
    if (opts.agent) opts.agent.onWake = (botId, convId) => void this.wake(botId, convId).catch((e) => log.warn("wake-up turn failed", { message: (e as Error).message }));
  }

  /** 渠道登记怎么主动往它的会话里发消息（代理自己醒来的一轮用）；botId 为 "*" 时对所有机器人有效 */
  registerReplier(botId: string, channel: ChannelId, fn: Replier | undefined): void {
    if (fn) this.repliers.set(`${botId}:${channel}`, fn);
    else this.repliers.delete(`${botId}:${channel}`);
  }

  /** 应用退出前调用（App.stop）：之后失败的回合留下重启标记，由下次启动告诉用户 */
  shutdown(): void {
    this.closing = true;
  }

  /**
   * 中止会话里正在处理的消息：纯对话中止模型请求（已生成的部分保留），代理回合交给代理之前直接收尾、之后在服务端中止
   * （会重启代理进程）。返回有没有正在处理的消息。
   */
  stop(conversationId: string): boolean {
    const set = this.inflight.get(conversationId);
    for (const t of set ?? []) t.abort.abort();
    const agentTurn = this.opts.agent?.stopTurn(conversationId) ?? false;
    return !!set?.size || agentTurn;
  }

  /** 会话里最早那条还在处理的消息是什么时候收到的 */
  busySince(conversationId: string): number | undefined {
    const set = this.inflight.get(conversationId);
    return set?.size ? Math.min(...[...set].map((t) => t.since)) : undefined;
  }

  /** 有消息正在处理的机器人（侧栏"正在工作"） */
  busyBots(): string[] {
    return [...new Set([...this.inflight.values()].flatMap((s) => [...s].map((t) => t.botId)))];
  }

  async listModels(force = false): Promise<string[]> {
    if (!force && this.modelCache && Date.now() - this.modelCache.at < 30_000) return this.modelCache.list;
    // 机器人预算 Key 的 provider 列出同一批模型，只展示共用连接的那份
    const list = (await this.opts.models.listModels()).filter((m) => !isBotProviderModel(m));
    this.modelCache = { at: Date.now(), list };
    return list;
  }

  private async resolveModel(convModel: string, botModel: string): Promise<string> {
    const m = convModel || botModel || this.opts.defaultModel();
    if (m) return m;
    const list = await this.listModels();
    if (!list.length) throw new Error("没有可用模型：请先连接 Modelflare（设置 → Modelflare）");
    return list[0];
  }

  /**
   * signal：网页的停止按钮（排队时就停了也算）；/stop 经 stop() 走同一条路。纯对话中止模型请求并保留已生成的部分，
   * 代理回合交给代理之前直接收尾，之后由代理中止。
   */
  async handle(ev: InboundEvent, out: ReplySession, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const { store } = this.opts;
    // 兜底：不在允许名单里的人不建会话、不进模型（正常已在 interceptReply 拦下）
    if (this.opts.access && !this.opts.access.allowed(ev)) {
      log.warn("dropped a message from a sender who is not allowed", { bot: ev.botId, channel: ev.channel });
      return;
    }
    const bot = store.getBot(ev.botId);
    if (!bot) throw new Error(`unknown bot ${ev.botId}`);
    const conv = store.ensureConversation(bot.id, ev.channel, ev.conversation.id, ev.sender.name || ev.sender.id, ev.conversation.kind === "group" ? "group" : "dm");
    const t: Inflight = { botId: bot.id, since: Date.now(), abort: new AbortController(), release: KeyedQueue.releaser() };
    const link = () => t.abort.abort();
    if (opts.signal?.aborted) link();
    else opts.signal?.addEventListener("abort", link, { once: true });
    // 回复句柄存下来（代理自己醒来的一轮要回复到它；重启也在）
    if (Object.keys(ev.replyHandle).length) store.setKV(REPLY_TO + conv.id, JSON.stringify(ev.replyHandle));
    const done = this.enter(conv.id, t);
    // 重启标记：应用退出或崩溃时还没处理完的，下次启动告诉用户
    const text = eventText(ev);
    if (text) markInflight(store, conv.id, text);
    try {
      await this.handleMessage(ev, out, bot, conv.id, t, done.prior);
    } finally {
      opts.signal?.removeEventListener("abort", link);
      done.leave();
      if (!this.inflight.get(conv.id)?.size && !t.interrupted) {
        try {
          clearInflight(store, conv.id);
        } catch {
          /* 退出时数据库可能已经关了：标记留着，下次启动多提醒一次 */
        }
      }
    }
  }

  /**
   * 登记一条正在处理的消息（或代理自己醒来的一轮）：/stop 能停它；排进会话的先后（prior 是它前面那些都处理完）。
   * 渠道的串行队列在代理收下消息后就让位（Inflight.release），之后的先后由这里保证。
   */
  private enter(convId: string, t: Inflight): { prior: Promise<void> | undefined; leave: () => void } {
    const set = this.inflight.get(convId) ?? new Set<Inflight>();
    this.inflight.set(convId, set);
    set.add(t);
    const prior = this.tails.get(convId);
    let finish!: () => void;
    const mine = new Promise<void>((r) => (finish = r));
    const tail = (prior ?? Promise.resolve()).then(() => mine);
    this.tails.set(convId, tail);
    return {
      prior,
      leave: () => {
        finish();
        if (this.tails.get(convId) === tail) this.tails.delete(convId);
        set.delete(t);
        if (!set.size && this.inflight.get(convId) === set) this.inflight.delete(convId);
      },
    };
  }

  private async handleMessage(ev: InboundEvent, out: ReplySession, bot: NonNullable<ReturnType<Store["getBot"]>>, convId: string, t: Inflight, prior: Promise<void> | undefined): Promise<void> {
    const { store } = this.opts;
    const signal = t.abort.signal;
    const agent = this.opts.agent;
    // 代理模式：收到的图片/文件先进工作区，消息里写路径
    if (agent?.available) storeInbound(agent.host(bot.id).workspace, ev);
    const text = eventText(ev);
    if (!text) return;
    const images = inboundImages(ev);
    // 上次重启时没处理完、当时又没能告诉用户的：先说一声
    const notice = takeNotice(store, convId);
    if (notice) await out.apply({ type: "text", text: notice }).catch((e) => log.warn("restart notice failed", { message: (e as Error).message.slice(0, 200) }));

    // 前面还有消息在处理：代理回合进行中就把这条并进去（模型下一步看到，回复一起给），否则排在它们后面。
    // 命令（/model、/reset…）不并入，等前面的处理完
    if (prior) {
      if (agent?.available && !signal.aborted && !text.startsWith("/") && (await this.steer(agent, bot.id, convId, text, images, out, t))) {
        await prior;
        // 应用正在退出、它并进的那一轮没做完：重启标记留着（下次启动告诉用户）
        if (this.closing) t.interrupted = true;
        return;
      }
      await prior;
    }
    // 前面的消息可能换了模型（/model）
    const conv = { id: convId, model: store.getConversation(convId)?.model ?? "" };

    // 排队时就被停止了：不再处理（命令也不执行），留一句"已中止"
    if (signal.aborted) {
      const msg = stoppedText(Date.now() - t.since);
      if (!text.startsWith("/")) {
        if (!t.userStored) store.addMessage(conv.id, "user", text);
        store.addMessage(conv.id, "assistant", msg);
      }
      await out.apply({ type: "text", text: msg });
      return;
    }

    if (text.startsWith("/")) {
      const reply = await this.command(text, conv.id, conv.model, bot.defaultModel, bot.id);
      if (reply !== null) {
        await out.apply({ type: "text", text: reply });
        return;
      }
    }

    const model = await this.resolveModel(conv.model, bot.defaultModel).catch(async (e: Error) => {
      await out.apply({ type: "text", text: `⚠️ ${e.message}` });
      return "";
    });
    if (!model) return;
    const routed = this.opts.route ? this.opts.route(bot.id, model) : model;
    // 只有能看图的模型才收到图片本身；其余模型只看到文字里的“[图片 …]”
    const seen = acceptsImages(routed) ? images : [];

    let note = "";
    if (agent?.available) {
      const place: ChatPlace = { channel: ev.channel, kind: ev.conversation.kind === "group" ? "group" : "dm" };
      const handled = await this.handleAgent(agent, bot.id, conv.id, text, routed, place, out, seen, t);
      if (handled === true) return;
      // 应用正在退出：代理进程没了不是该改用纯对话的时候，留给下次启动提醒
      if (this.closing) {
        t.interrupted = true;
        return;
      }
      // 代理进程还在启动（第一次可能要几分钟）：这条消息先由模型直接回答，不让用户干等
      if (handled === "starting") note = "（代理还在启动，这条消息先由模型直接回答；启动完成后会自动用回代理。）";
    }

    if (!t.userStored) store.addMessage(conv.id, "user", text);
    t.userStored = true;
    const history = store.contextWindow(conv.id, this.opts.contextMessages, this.opts.contextChars);
    const messages: ChatMessage[] = [];
    if (bot.systemPrompt.trim()) messages.push({ role: "system", content: bot.systemPrompt });
    for (const m of history) if (m.role !== "system") messages.push({ role: m.role, content: m.content });
    const last = messages[messages.length - 1];
    if (seen.length && last?.role === "user" && typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content }, ...seen.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))];
    }

    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    let acc = "";
    try {
      const full = await this.opts.models.streamChat({ model: routed, messages, signal }, (delta) => {
        acc += delta;
        void out.apply({ type: "stream.update", text: acc });
      });
      const finalText = full || acc || "（模型没有返回内容）";
      store.addMessage(conv.id, "assistant", finalText);
      await out.apply({ type: "stream.finish", text: note ? `${note}\n\n${finalText}` : finalText });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (signal.aborted) {
        // 停止：已生成的部分保留，末尾注明；还没出字就只说已中止
        const msg = acc ? `${acc}\n\n（已中止）` : stoppedText(Date.now() - t.since);
        store.addMessage(conv.id, "assistant", msg);
        await out.apply({ type: "stream.finish", text: msg });
        return;
      }
      log.warn("model call failed", { model, status: err.status, message: err.message });
      const msg = acc ? `${acc}\n\n⚠️ 生成中断：${err.message}` : `⚠️ 模型调用失败（${model}）：${err.message}`;
      await out.apply({ type: "stream.finish", text: msg });
    } finally {
      await out.apply({ type: "typing", on: false });
    }
  }

  /**
   * 渠道在进入每会话串行队列之前调用：处理审批回复（y 1234 / n 1234）、提问回答和 /status /help /stop。
   * handled=false 但带 ack：前一条还在处理，渠道先把 ack 发出去，消息照常入队。
   */
  interceptReply(ev: InboundEvent): { handled: boolean; ack?: string } {
    // 准入：不在允许名单里的人只收到一句提示（限频），不进队列、不碰模型；主人可以用「同意 1234」处理使用请求
    const gate = this.opts.access?.admit(ev);
    if (gate && !gate.ok) return { handled: true, ack: gate.reply };
    const paired = this.opts.access?.handleReply(ev);
    if (paired?.handled) return paired;
    const text = eventText(ev);
    const convId = `${ev.botId}:${ev.channel}:${ev.conversation.id}`;
    // /status、/help 只读、不碰模型和代理进程：不进会话队列，不会排在一个卡住或正在启动代理的回合后面
    const cmd = text.trim().toLowerCase();
    if (cmd === "/status" || cmd === "/help") {
      const bot = this.opts.store.getBot(ev.botId);
      if (bot) return { handled: true, ack: cmd === "/help" ? HELP : this.statusText(bot.id, convId, this.opts.store.getConversation(convId)?.model ?? "", bot.defaultModel) };
    }
    const agent = this.opts.agent;
    const tasks = agent?.tasks;
    // 后台任务：/tasks 列出，/stop 编号 停止一个（只读本地状态、不碰聊天回合，不进会话队列）
    if (cmd === "/tasks") return { handled: true, ack: tasks ? tasks.listText(convId) : "后台任务只在代理模式下可用。" };
    const stopTask = /^\/stop\s+(\d{1,2})$/.exec(cmd);
    if (stopTask) return { handled: true, ack: tasks ? tasks.stopByIndex(convId, Number(stopTask[1]), `${ev.channel}:${ev.sender.id}`) : "后台任务只在代理模式下可用。" };
    // /stop 必须插队：它要停的正是排在前面、卡住的那个回合（纯对话、代理还在启动时也算）
    if (cmd === "/stop") {
      const since = this.busySince(convId) ?? agent?.turnsInProgress.get(convId)?.since;
      if (since === undefined || !this.stop(convId)) {
        // 没有在处理的消息，但有后台任务在跑：说一声怎么停它（/stop 不停后台任务）
        const working = tasks?.working(convId) ?? [];
        const hint = working.length ? `\n后台任务在进行：${working.map((t, i) => `${i + 1}. ${t.title}`).join("；")}。发 /stop 编号 可停止。` : "";
        return { handled: true, ack: `当前没有正在处理的消息。${hint}` };
      }
      return { handled: true, ack: `正在中止上一条消息（已处理 ${fmtSecs(Date.now() - since)}）…` };
    }
    if (!agent) return { handled: false };
    // 审批、提问的回复；后台任务的只认引用、编号开头，或它是机器人最后一条消息时的选项编号（见 ApprovalCenter.handleReply）
    const { quote, plain } = quoteOf(ev);
    const r = agent.approvals.handleReply(convId, text, `${ev.channel}:${ev.sender.id}`, { ...tasks?.replyContext(convId), ...(quote ? { quote, plain } : {}) });
    if (r.handled) return r;
    // 前一条还在处理：能并入进行中的代理回合时由 handle 并入并回一句；不能时说一声这条排在后面、怎么中止（每个回合只说一次），消息照常入队
    const t = agent.turnsInProgress.get(convId);
    if (t && !t.queuedNotice && !agent.canSteer(convId)) {
      t.queuedNotice = true;
      const last = t.activity.last;
      return { handled: false, ack: `上一条消息还在处理（已 ${fmtSecs(Date.now() - t.since)}${last ? `，现在：${clipLine(describeStep(last))}` : ""}），这条会排在它后面。发送 /stop 可以中止。` };
    }
    return r;
  }

  /** /status 的内容：只读本地状态，立即返回 */
  statusText(botId: string, convId: string, convModel: string, botModel: string): string {
    const m = convModel || botModel || this.opts.defaultModel() || "（自动：第一个可用模型）";
    const a = this.opts.agent;
    const perm = a?.available ? a.settings(botId).permission : undefined;
    const mode = !a?.available ? "纯对话模式" : `代理模式（DeepSeek Harness，${perm === "full" ? "完全权限：不经沙箱" : perm === "readonly" ? "只读沙箱" : "工作区沙箱"}）`;
    // 完全权限：每次 /status 都提醒风险
    const full = perm === "full" ? ["注意：完全权限下命令以你的用户身份直接运行，可以读写你电脑上的任何文件（包括 AnyModelBot 自己的数据）；只有递归删除仍会先问你。在机器人设置里可以改回「工作区可写」。"] : [];
    const pend = a ? a.approvals.pending(convId).map((r) => `${r.kind === "approval" ? "待批准" : "待回答"} ${r.code}`) : [];
    const cui = a?.available ? a.computerUse(botId) : undefined;
    const cu = cui ? [`电脑操作：${cui.backend === "codex" ? "Codex 桥" : "Cua Driver"}，${cui.active ? "已启用" : "未启用"}——${cui.reason}`, ...(cui.notice && cui.enabled ? [cui.notice] : [])] : [];
    const host = a?.available ? [a.hostSummary(botId)] : [];
    // Windows：代理执行命令用的 PowerShell；没有 7 时建议安装
    const ps = a?.available ? pwshStatusLine(pwshProbe.snapshot()) : "";
    const turn = a?.turnsInProgress.get(convId);
    const busy = turn ? [busyLine(turn.since, turn.lastProgress, turn.activity.steps, !!a?.canSteer(convId))] : [];
    const who = this.opts.access ? [this.opts.access.policyLine(botId)] : [];
    // 这个会话有后台任务在进行时说一句（没有就不说）
    const working = a?.tasks?.working(convId) ?? [];
    const bg = working.length ? [`后台任务：${working.map((t) => `「${t.title}」${t.stage.label}`).join("，")}`] : [];
    return [`当前模型：${m}${convModel ? "（会话设置）" : ""}`, `运行方式：${mode}`, ...full, ...who, ...host, ...(ps ? [ps] : []), ...busy, ...bg, ...cu, ...(pend.length ? [`未决：${pend.join("，")}`] : [])].join("\n");
  }

  /** 卡片按钮回调：批准/拒绝/选择选项。 */
  cardAction(botId: string, value: Record<string, string>, by: string): { toast: string; ok: boolean } {
    const agent = this.opts.agent;
    const row = agent && value?.id ? this.opts.store.getApproval(String(value.id)) : undefined;
    if (!agent || !row || row.botId !== botId) return { toast: "请求不存在", ok: false };
    if (row.status !== "pending") return { toast: `请求 ${row.code} 已处理或已过期`, ok: false };
    if (value.amb === "approval") {
      const allow = value.decision === "allow";
      return agent.approvals.decide(row.id, allow, by) ? { toast: allow ? `已批准 ${row.code}（仅本次）` : `已拒绝 ${row.code}`, ok: true } : { toast: "已过期", ok: false };
    }
    if (value.amb === "question") {
      // 回答按钮所在的这一个提问（会话里可能同时有几个）
      return agent.approvals.answerText(row.id, String(value.option ?? ""), by) ? { toast: "已提交", ok: true } : { toast: "提交失败", ok: false };
    }
    return { toast: "未知操作", ok: false };
  }

  /**
   * 代理回合；返回 false 表示宿主不可用且尚无任何输出（调用方回退到纯对话），
   * "starting" 表示代理进程在等待时限内没有启动好（同样回退，启动在后台继续）。
   */
  private async handleAgent(
    agent: AgentManager,
    botId: string,
    convId: string,
    text: string,
    model: string,
    place: ChatPlace,
    out: ReplySession,
    images: TurnImage[],
    inflight: Inflight,
  ): Promise<boolean | "starting"> {
    const { store } = this.opts;
    const signal = inflight.abort.signal;
    let visible = false;
    // 活动记录：网页对话实时显示（其它渠道忽略这个操作），回合结束后随回复存下来，信息面板里能看
    const steps = new Map<string, ActivityStep>();
    const onStep = (step: ActivityStep) => {
      steps.set(step.id, step);
      void out.apply({ type: "activity", step });
    };
    const unbind = agent.approvals.bindSink(convId, async (row) => {
      visible = true;
      await out.apply(interactiveOp(row));
    });
    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    // 代理进程还没就绪（第一次启动可能要几分钟）：先说清楚在等什么，而不是一直"思考中"。最终回复会替换这段文字
    const host = agent.host(botId);
    let startup: NodeJS.Timeout | undefined;
    if (host.state !== "running") {
      const since = Date.now();
      const show = () => {
        if (host.state === "running") {
          clearInterval(startup);
          return void out.apply({ type: "stream.update", text: "代理已就绪，正在处理…" });
        }
        const s = Math.round((Date.now() - since) / 1000);
        const first = (host.diagnostics() as any).firstStart;
        void out.apply({ type: "stream.update", text: `代理正在启动…${s >= 5 ? `（已 ${s} 秒）` : ""}${first ? "首次启动可能需要几分钟。" : ""}` });
      };
      show();
      startup = setInterval(show, 5000);
    }
    // 交给代理之前就被停止：不用动代理进程（启动在后台继续），直接收尾
    const stoppedEarly = async () => {
      clearInterval(startup);
      log.info("message stopped before the agent took it", { bot: botId, conversationId: convId });
      const msg = stoppedText(Date.now() - inflight.since);
      if (!inflight.userStored) store.addMessage(convId, "user", text);
      inflight.userStored = true;
      store.addMessage(convId, "assistant", msg);
      await out.apply({ type: "stream.finish", text: msg });
      return true;
    };
    const stopped = new Promise<"stopped">((r) => (signal.aborted ? r("stopped") : signal.addEventListener("abort", () => r("stopped"), { once: true })));
    try {
      if (host.state !== "running") {
        const waitMs = Number(process.env.AMB_AGENT_START_WAIT_MS) || 90_000;
        let timer: NodeJS.Timeout | undefined;
        const ready = await Promise.race([
          host.ensure(model).then(
            () => true,
            () => false,
          ),
          new Promise<boolean>((r) => (timer = setTimeout(() => r(false), waitMs))),
          stopped,
        ]).finally(() => clearTimeout(timer));
        if (ready === "stopped") return await stoppedEarly();
        if (!ready && (host.state as string) !== "running") {
          log.warn("agent host not ready, answering with plain chat", { bot: botId, state: host.state, waitedMs: waitMs });
          return host.state === "starting" ? "starting" : false;
        }
      }
      if (signal.aborted) return await stoppedEarly();
      const first = store.getAgentSession(convId) ? text : firstInput(agent, botId, convId, text, place);
      // 后台任务的结果发出去之后，下一条聊天消息带上那张便条：聊天代理知道发生了什么
      const notes = takeTaskNotes(store, convId);
      const input = notes ? `${notes}\n\n${first}` : first;
      // runTurn 同步登记回合，之后的停止交给代理（TurnStopped，会重启代理进程）
      const turn = agent.runTurn(botId, {
        conversationId: convId,
        text: input,
        model,
        ...(images.length ? { images } : {}),
        onStep,
        observer: {
          // 工具调用不进入聊天：只用于判断代理已开始工作（不再回退到纯对话），正在输入状态由渠道维持
          onProgress: () => {
            visible = true;
          },
          // 代理收下了这条消息：先存用户消息（之后并进来的消息排在它后面），再让出渠道队列，后来的消息可以并入这一轮
          onStart: () => {
            if (!inflight.userStored) store.addMessage(convId, "user", text);
            inflight.userStored = true;
            inflight.release?.();
          },
        },
      });
      const halt = () => agent.stopTurn(convId);
      signal.addEventListener("abort", halt, { once: true });
      const r = await turn.finally(() => {
        clearInterval(startup);
        signal.removeEventListener("abort", halt);
      });
      if (!inflight.userStored) store.addMessage(convId, "user", text);
      inflight.userStored = true;
      const finalText = r.text.trim() || "（已完成，没有文字回复）";
      store.addMessage(convId, "assistant", finalText, [...steps.values()]);
      await out.apply({ type: "stream.finish", text: finalText });
      for (const f of r.files ?? []) {
        try {
          await out.apply({ type: "file", path: f, name: path.basename(f) });
        } catch (e) {
          log.warn("deliver file failed", { name: path.basename(f), message: (e as Error).message.slice(0, 200) });
        }
      }
      return true;
    } catch (e) {
      const err = e as Error;
      log.warn("agent turn failed", { message: err.message.slice(0, 300) });
      // 应用正在退出时代理进程被关掉：不回复（渠道也停了），下次启动告诉用户这条没处理完
      if (this.closing) {
        inflight.interrupted = true;
        return true;
      }
      if (!(err instanceof TurnStopped) && !visible && agent.host(botId).state !== "running") {
        log.warn("agent host unavailable, falling back to plain chat");
        return false;
      }
      const msg = turnFailedText(err, [...steps.values()]);
      if (!inflight.userStored) store.addMessage(convId, "user", text);
      inflight.userStored = true;
      store.addMessage(convId, "assistant", msg, [...steps.values()]);
      await out.apply({ type: "stream.finish", text: msg });
      return true;
    } finally {
      clearInterval(startup);
      unbind();
      await out.apply({ type: "typing", on: false });
    }
  }

  /**
   * 把新消息并入这个会话正在进行的代理回合：成功就存下用户消息（排在上一条后面）、让出渠道队列、回一句收到。
   * 回合没在跑、正在收尾或中止、指令通道不通时返回 false，消息照常排队。图片只交给能看图的模型（由宿主判断）。
   */
  private async steer(agent: AgentManager, botId: string, convId: string, text: string, images: TurnImage[], out: ReplySession, t: Inflight): Promise<boolean> {
    if (!agent.canSteer(convId)) return false;
    const ok = await agent.steer(botId, convId, { text, ...(images.length ? { images } : {}) }).catch((e: Error) => {
      log.warn("steer failed", { message: e.message.slice(0, 200) });
      return false;
    });
    if (!ok) return false;
    log.info("message steered into the running turn", { bot: botId, conversationId: convId });
    this.opts.store.addMessage(convId, "user", text);
    t.userStored = true;
    t.release?.();
    await out.apply({ type: "text", text: STEER_ACK, ack: true });
    return true;
  }

  /**
   * 代理自己醒来的一轮（后台命令结束，DSH 唤醒了空闲的代理）：像普通回合一样登记（/status、/stop、看门狗、插话都认它），
   * 经渠道主动发到会话里（网页对话进 live 登记；飞书回复最近一条消息；微信占一条回复配额），回复与步骤存进历史。
   */
  async wake(botId: string, convId: string): Promise<void> {
    const { store } = this.opts;
    const agent = this.opts.agent;
    const conv = store.getConversation(convId);
    const bot = store.getBot(botId);
    // 那一轮已经有人跟着、或者随代理进程一起没了：不发任何东西
    const wakeId = agent?.available ? agent.host(botId).wakeId(convId) : undefined;
    if (this.closing || !agent || !conv || !bot || !wakeId) return;
    let handle: Record<string, string> | undefined;
    try {
      handle = JSON.parse(store.getKV(REPLY_TO + convId) || "null") ?? undefined;
    } catch {
      handle = undefined;
    }
    const r = (this.repliers.get(`${botId}:${conv.channel}`) ?? this.repliers.get(`*:${conv.channel}`))?.(conv, handle, `wake:${wakeId}`);
    if (!r) log.warn("no way to reply in this conversation; the wake-up reply is only kept in its history", { bot: botId, conversationId: convId, channel: conv.channel });
    const out: ReplySession = r?.out ?? { apply: async () => undefined };
    const t: Inflight = { botId, since: Date.now(), abort: new AbortController(), userStored: true };
    const done = this.enter(convId, t);
    // 重启标记：这一轮没做完应用就退出或崩溃了，下次启动告诉用户（说的是让命令跑起来的那条消息）
    const asked = store.listMessages(convId, 20).filter((m) => m.role === "user").at(-1)?.content;
    markInflight(store, convId, asked || "后台命令的结果");
    const steps = new Map<string, ActivityStep>();
    const unbind = agent.approvals.bindSink(convId, async (row) => void (await out.apply(interactiveOp(row))));
    const halt = () => agent.stopTurn(convId);
    t.abort.signal.addEventListener("abort", halt, { once: true });
    try {
      const model = conv.model || bot.defaultModel || this.opts.defaultModel();
      const routed = model && this.opts.route ? this.opts.route(botId, model) : model;
      await out.apply({ type: "typing", on: true });
      await out.apply({ type: "stream.start" });
      let res: Awaited<ReturnType<AgentManager["followTurn"]>>;
      try {
        res = await agent.followTurn(botId, {
          conversationId: convId,
          model: routed,
          onStep: (step) => {
            steps.set(step.id, step);
            void out.apply({ type: "activity", step });
          },
        });
      } catch (e) {
        // 应用正在退出时代理进程被关掉：不回复，重启标记留着
        if (this.closing) {
          t.interrupted = true;
          return;
        }
        const msg = turnFailedText(e as Error, [...steps.values()]);
        store.addMessage(convId, "assistant", msg, [...steps.values()]);
        await out.apply({ type: "stream.finish", text: msg });
        return;
      }
      const finalText = res.text.trim() || "（后台任务已结束，没有文字回复）";
      store.addMessage(convId, "assistant", finalText, [...steps.values()]);
      await out.apply({ type: "stream.finish", text: finalText });
      for (const f of res.files ?? []) {
        try {
          await out.apply({ type: "file", path: f, name: path.basename(f) });
        } catch (e) {
          log.warn("deliver file failed", { name: path.basename(f), message: (e as Error).message.slice(0, 200) });
        }
      }
    } finally {
      t.abort.signal.removeEventListener("abort", halt);
      unbind();
      await out.apply({ type: "typing", on: false }).catch(() => undefined);
      done.leave();
      if (!this.inflight.get(convId)?.size && !t.interrupted) {
        try {
          clearInflight(store, convId);
        } catch {
          /* 退出时数据库可能已经关了 */
        }
      }
      r?.done?.();
    }
  }

  /** 返回 null 表示不是已知命令，按普通消息处理。 */
  private async command(text: string, convId: string, convModel: string, botModel: string, botId: string): Promise<string | null> {
    const [cmd, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "/help":
        return HELP;
      case "/reset":
        this.opts.store.clearMessages(convId);
        this.opts.agent?.resetConversation(convId);
        return "✅ 已清空本会话上下文";
      case "/new": {
        const a = this.opts.agent;
        if (!a?.available) return "⚠️ /new 只在代理模式下可用；纯对话模式请用 /reset";
        if (!this.opts.store.getAgentSession(convId)) return "当前已经是新的一段对话";
        try {
          await a.newSegment(botId, convId, await this.resolveModel(convModel, botModel));
        } catch (e) {
          return `⚠️ 开新段失败：${(e as Error).message.slice(0, 200)}`;
        }
        return "✅ 已开始新的一段对话（旧对话已归档并留下交接便条，长期记忆保留）";
      }
      case "/status":
        return this.statusText(botId, convId, convModel, botModel);
      case "/model": {
        let list: string[];
        try {
          list = await this.listModels(true);
        } catch (e) {
          return `⚠️ 获取模型列表失败：${(e as Error).message}`;
        }
        if (!arg) {
          const cur = convModel || botModel || this.opts.defaultModel();
          if (!list.length) return "暂无可用模型：请先连接 Modelflare（设置 → Modelflare）。";
          return ["可用模型（回复 /model 编号 切换）：", ...list.map((m, i) => `${i + 1}. ${m}${m === cur ? "  ← 当前" : ""}`)].join("\n");
        }
        if (arg === "default" || arg === "reset") {
          this.opts.store.setConversationModel(convId, "");
          return "✅ 已恢复为机器人默认模型";
        }
        const idx = /^\d+$/.test(arg) ? Number(arg) - 1 : -1;
        const target = idx >= 0 ? list[idx] : list.find((m) => m === arg) ?? list.find((m) => m.endsWith("/" + arg) || m.includes(arg));
        if (!target) return `⚠️ 找不到模型「${arg}」，发送 /model 查看列表`;
        this.opts.store.setConversationModel(convId, target);
        return `✅ 本会话已切换到 ${target}`;
      }
      default:
        return null;
    }
  }
}

/**
 * 一段代理会话的首条输入：对话渠道 + 冻结的记忆快照 + 交接便条（一次性）+ 用户消息（prompts/segment.ts）。
 * 人设、聊天规则和记忆说明不在这里，在每次模型请求现读的系统提示词里（amb-prompt 插件）：改人设不用 /new。
 * 这一段之内不再变化，便于模型端前缀缓存；记忆快照在下一段才刷新（本段内用 recall 查最新），
 * 放进系统提示词的话每记一条都会让整段前缀缓存失效，而且各会话（群记忆）不一样。
 */
export function firstInput(agent: AgentManager, botId: string, convId: string, text: string, place?: ChatPlace): string {
  const memory = agent.settings(botId).memory.enabled ? agent.memoryPrefix(botId, convId) : undefined;
  return segmentInput({ place, memory, handoff: agent.takeSeed(convId), text });
}

/** 审批/提问 → 出站交互操作（文本渠道用 prompt；卡片渠道用 buttons）。 */
export function interactiveOp(row: ApprovalRow) {
  return {
    type: "interactive" as const,
    kind: row.kind === "approval" ? ("approval" as const) : ("ask_user" as const),
    prompt: promptText(row),
    requestId: row.id,
    code: row.code,
    buttons: promptButtons(row),
  };
}

/** 消息里引用的那段（微信的引用）和用户自己写的（去掉引用） */
export function quoteOf(ev: InboundEvent): { quote: string; plain: string } {
  const quote = ev.parts.map((p) => (p.type === "quote" ? p.text : "")).filter(Boolean).join("\n");
  const plain = eventText({ ...ev, parts: ev.parts.filter((p) => p.type !== "quote") });
  return { quote, plain };
}

const clipLine = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** /status 里"上一条还在处理"那一行：处理了多久、现在在做什么、多久没动了；steer = 新消息会并入这一轮 */
export function busyLine(since: number, lastProgress: number, steps: ActivityStep[], steer = false): string {
  const now = Date.now();
  const last = steps.at(-1);
  const parts = [`已 ${fmtSecs(now - since)}`];
  if (steps.length) parts.push(`${steps.length} 步`);
  if (!lastProgress) parts.push("还在等代理进程接手");
  else if (last) parts.push(`现在：${clipLine(describeStep(last))}`);
  if (lastProgress && now - lastProgress >= 60_000) parts.push(`${fmtSecs(now - lastProgress)}没有新进展`);
  return `本会话上一条消息还在处理（${parts.join("，")}），${steer ? "新消息会并入正在进行的处理" : "新消息会排在它后面"}。发送 /stop 可以中止`;
}

/** 代理回合失败时给用户的话：中止（/stop、没进展、超时）各说清原因和下一步，进程被重启的另说 */
export function turnFailedText(err: Error, steps: ActivityStep[]): string {
  const last = steps.filter((s) => s.kind !== "error").at(-1);
  const where = last ? `${last.cut || last.status === "running" ? "卡在" : "最后一步"}：${clipLine(describeStep(last))}。` : "";
  if (err instanceof TurnStopped) {
    // 只中止了这个会话；宽限期内没停下才重启了代理进程（同一机器人的其它会话也被打断）
    const restart = err.restarted ? "并重启代理进程" : "";
    if (err.reason === "user") return `已中止（处理了 ${fmtSecs(err.ms)}）。${err.restarted ? "代理进程已重启，" : ""}可以继续发消息。`;
    if (err.reason === "idle") return `⚠️ 代理 ${fmtSecs(err.ms)}没有任何进展，已自动中止${restart}。${where}可以重新发送，或用 /model 换个模型试试。`;
    return `⚠️ 这条消息处理超过了 ${fmtSecs(err.ms)}的上限，已中止${restart}。${where}可以把任务拆小一点再发。`;
  }
  if (/runtime (closed|exited)/i.test(err.message)) return "⚠️ 代理进程重启了（可能是同一机器人的另一个会话中止了卡住的消息），这条消息没有处理完，请重新发送。";
  return `⚠️ 代理执行失败：${err.message.slice(0, 300)}`;
}
