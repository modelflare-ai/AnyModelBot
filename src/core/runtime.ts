import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChannelId, InboundEvent, ReplySession } from "./types.js";
import { findBot, setBotForPeer } from "./routes.js";
import { KeyedQueue } from "./queue.js";
import { eventText } from "./types.js";
import { acceptsImages, type ModelClient, type ChatMessage } from "../llm/client.js";
import { TurnStopped, type TurnFolder, type TurnImage } from "../agent/host.js";
import { describeStep, fmtSecs, type ActivityStep } from "../agent/activity.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import type { AgentManager } from "../agent/manager.js";
import { promptButtons, promptText, questionsOf } from "../agent/approvals.js";
import { segmentInput, type ChatPlace } from "../agent/prompts/index.js";
import { clearInflight, markInflight, takeNotice } from "./recovery.js";
import { pwshProbe, pwshStatusLine } from "../tools/pwsh/index.js";
import { isBotProviderModel, isGatewayGroupModel } from "../providers/modelflare.js";
import type { ApprovalRow, Conversation } from "../store/db.js";
import type { AccessControl } from "./access.js";
import { takeTaskNotes } from "./task-notes.js";
import { lang, t } from "../i18n/index.js";
import { replyLanguageHint } from "../agent/prompts/system.js";
import { localProxyFailureHint } from "../network-error.js";
import type { CuBlocked } from "../tools/computer-use/permissions.js";
import { installPromptLinks, MAX_CARDS_PER_MESSAGE, type SkillInstalls } from "../skills/installs.js";
import type { SkillDrafts } from "../skills/drafts.js";
import type { Attachments } from "../attachments/service.js";
import type { FolderBinding, FolderService } from "../folders/service.js";

const log = logger("runtime");
/** 只发了附件、没有文字的消息在重启提醒里怎么称呼 */
const attachmentsLabel = () => t("attachments.messageLabel");

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
      p.error = t("runtime.saveFailed");
    }
  }
}

export interface RuntimeOptions {
  store: Store;
  models: ModelClient;
  defaultModel: () => string;
  contextMessages: number;
  contextChars: number;
  /**
   * 这个模型看不看图（附件、选模型控件和实际请求用同一个判断，见 app.ts visionOf）：只有 supported 才把图片本身交给它。
   * 缺省按模型名判断（acceptsImages）。
   */
  vision?: (model: string) => Promise<"supported" | "unsupported" | "unknown">;
  /** 网页对话随消息发的附件（受管副本）：历史里的附件按原版本重读 */
  attachments?: Attachments;
  /** 工作文件夹（folders/service.ts）：回合开始时核对消息绑定的目录还在不在 */
  folders?: FolderService;
  /**
   * 宿主直接生图（imagegen/generate.ts）：plan 判断选的是不是纯图片生成型号（是就把这条纯文字做成文生图计划，
   * 渠道里给一句说明 refuse；不是返回 undefined 照常对话）；run 执行计划。没有内置网关时不给。
   */
  imageGen?: {
    plan(botId: string, conversationId: string, model: string, text: string, web: boolean): Promise<import("../imagegen/generate.js").GenerationPlan | { refuse: string } | undefined>;
    run(plan: import("../imagegen/generate.js").GenerationPlan, out: ReplySession, signal: AbortSignal): Promise<void>;
  };
  /** 这个模型该带的推理强度（用户选了、模型也支持时）；纯对话路径用，代理路径由 AgentHost 自己带 */
  reasoningEffort?: (model: string) => Promise<string | undefined>;
  /** DSH 代理宿主；缺省或不可用时走纯对话路径 */
  agent?: AgentManager;
  /**
   * 发给模型网关前把模型 id 限定到该机器人用的 Key（共用 Key 或它自己的预算 Key）。
   * 会话与界面里保存的仍是不带 provider 的 id。缺省原样发送。
   */
  route?: (botId: string, model: string) => string;
  /** 谁能和机器人对话（主人 + 允许名单）；缺省不限制 */
  access?: AccessControl;
  /**
   * 模型请求失败后调用：核对 Key 是否已失效（例如在 Modelflare 控制台被删）并重新签发。
   * 返回 true = 换了 Key，这条消息自动再试一次（只在还没有任何输出时）。缺省不重试。
   */
  recoverKey?: () => Promise<boolean>;
  /** 技能安装卡片（skills/installs.ts）：技能库的安装指令由这里直接出卡片，渠道里的「y 1234」、飞书按钮也在这里处理 */
  skillInstalls?: SkillInstalls;
  /** 「存成技能」草稿卡（skills/drafts.ts）：/skill 先出「正在整理技能…」，渠道里的「保存」「取消」、飞书按钮也在这里处理 */
  skillDrafts?: SkillDrafts;
}

const help = () => t("runtime.help");

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
  /** 并进了进行中的回合：那一轮的回复也是它的回复 */
  steered?: boolean;
}

/** 回合还没交给代理（或纯对话还没出字）就被停止时的回复 */
export const stoppedText = (ms: number) => t("runtime.stopped", { d: fmtSecs(ms) });

/** 新消息并进了正在进行的代理回合：先回这一句，回复在那一轮结束时一起给 */
/** 处理中又发来一句、并进正在进行的回合时回的那句（按当前语言） */
export const steerAck = () => t("runtime.steerAck");

/** 一条回复最多显示几个交付的文件（同 deliverables） */
const MAX_SHOWN_FILES = 8;

/**
 * 一轮里模型说的话和交付的文件：回合中间说的话一段一段交给渠道（网页、飞书卡片显示，微信不发），
 * present 交付的文件马上给网页看（文件本身照旧在回复之后发）；回合结束时随回复存进历史。
 */
export class TurnSaid {
  readonly interim: string[] = [];
  readonly presented: string[] = [];
  /** 等代理启动时显示过的临时文字（「代理已就绪，正在处理…」）：第一段话来了就换掉 */
  provisional = false;

  constructor(private out: ReplySession) {}

  readonly observer = {
    onInterim: (text: string) => {
      // 不 await：几个操作按调用顺序交给渠道
      if (this.provisional) {
        this.provisional = false;
        void this.out.apply({ type: "stream.update", text: "" });
      }
      this.interim.push(text);
      void this.out.apply({ type: "interim", text });
    },
    onPresent: (files: string[]) => {
      for (const f of files) {
        if (this.presented.includes(f) || this.presented.length >= MAX_SHOWN_FILES) continue;
        this.presented.push(f);
        void this.out.apply({ type: "presented", path: f, name: path.basename(f) });
      }
    },
  };

  /**
   * 回合结束时的回复：模型最后的回答；最后没再说话时，回合中间说的最后一句就是回复（不再算在中间说的话里），
   * 什么都没说时用 empty。interim 是显示在回复前面的那些话
   */
  reply(answer: string, empty: string): { text: string; interim: string[] } {
    const text = answer.trim();
    if (text) return { text, interim: this.interim.filter((x, i, a) => !(i === a.length - 1 && x === text)) };
    if (this.interim.length) return { text: this.interim.at(-1)!, interim: this.interim.slice(0, -1) };
    return { text: empty, interim: [] };
  }
}

/**
 * 不是回复某条消息、而是主动发到会话里（代理自己醒来的一轮：后台命令结束）：渠道给出这个会话的出站会话。
 * 微信、飞书的回复会话经出站队列发（和普通回复同一条路：落库、按会话排队、重试、发送时才查微信的窗口和配额）。
 * handle 是这个会话最近收到的那条消息的回复句柄（存在 KV 里，重启也在）；key 决定出站消息的 id（同一轮的回复只发一次）；
 * done 在这一轮结束时调用。没有办法发时返回 undefined。
 */
export type Replier = (conv: Conversation, handle: Record<string, string> | undefined, key: string) => { out: ReplySession; done?: () => void } | undefined;

/** 开新对话的结果（BotRuntime.newConversation / 渠道的 /new） */
export type NewConversation = { status: "started"; at: number } | { status: "already" | "off" } | { status: "failed"; error: string };

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

  /** 渠道登记怎么主动往它的会话里发消息（代理自己醒来的一轮用）：按渠道账号；"*" 时对所有账号有效 */
  registerReplier(account: string, channel: ChannelId, fn: Replier | undefined): void {
    if (fn) this.repliers.set(`${account}:${channel}`, fn);
    else this.repliers.delete(`${account}:${channel}`);
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

  /** 正在处理消息的会话（纯对话和代理回合）：退出登录前停下它们用 */
  activeConversations(): string[] {
    return [...new Set([...[...this.inflight].filter(([, set]) => set.size > 0).map(([id]) => id), ...(this.opts.agent?.turnsInProgress.keys() ?? [])])];
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
    // 内置网关自己合成的组（auto/<模型名>）也不列：选了它会把 auto/… 原样发给 Modelflare
    const list = (await this.opts.models.listModels()).filter((m) => !isBotProviderModel(m) && !isGatewayGroupModel(m));
    this.modelCache = { at: Date.now(), list };
    return list;
  }

  private async resolveModel(convModel: string, botModel: string): Promise<string> {
    const m = convModel || botModel || this.opts.defaultModel();
    if (m) return m;
    const list = await this.listModels();
    if (!list.length) throw new Error(t("runtime.noModels"));
    return list[0];
  }

  /** 失败后是否值得重试一次：Key 被换掉了才重试；核对本身出错按不重试处理 */
  private async keyRecovered(): Promise<boolean> {
    const recovered = await this.opts.recoverKey?.().catch(() => false);
    if (recovered) log.info("model key was reissued, retrying the message once");
    return !!recovered;
  }

  /** 这个模型收不收图片本身（附件核验、选模型控件和这里用同一个判断） */
  private async sees(model: string): Promise<boolean> {
    if (!this.opts.vision) return acceptsImages(model);
    return (await this.opts.vision(model).catch(() => "unknown" as const)) === "supported";
  }

  /**
   * 纯对话路径的历史：带附件的用户消息按原内容版本重读——文本文件是带来源标记的全文，图片是真实的图像内容块。
   * 每次请求最多带最近 4 张还在的图片（这一条的优先）；更早的图片、放不下的旧文件只留一行说明，不假装模型还看得见。
   * 模型不看图时只发文字。
   */
  private withAttachments(botId: string, history: Array<{ role: "system" | "user" | "assistant"; content: string; attachments?: import("../attachments/service.js").MessageAttachment[] }>, canSee: boolean): ChatMessage[] {
    const atts = this.opts.attachments;
    const out: ChatMessage[] = new Array(history.length);
    let imagesLeft = 4;
    let charsLeft = Math.max(this.opts.contextChars, 0);
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (!atts || !m.attachments?.length) {
        out[i] = { role: m.role, content: m.content };
        continue;
      }
      const newest = i === history.length - 1;
      const size = m.attachments.reduce((n, a) => n + (a.kind === "text" ? a.size : 0), 0);
      // 这一条的附件总是完整给；更早的文件在字符预算内才重读全文
      const refs = newest || size <= charsLeft ? m.attachments : m.attachments.filter((a) => a.kind === "image");
      const skipped = m.attachments.filter((a) => !refs.includes(a));
      if (refs !== m.attachments) charsLeft = 0;
      else if (!newest) charsLeft -= size;
      const c = atts.compose(refs, botId, m.content, { images: canSee, maxImages: imagesLeft });
      imagesLeft -= c.images.length;
      const text = skipped.length ? `${t("attachments.promptEarlier", { names: skipped.map((a) => a.name).join(t("runtime.listSep")) })}\n${c.text}` : c.text;
      out[i] = c.images.length
        ? { role: m.role, content: [{ type: "text", text }, ...c.images.map((im) => ({ type: "image_url" as const, image_url: { url: `data:${im.mimeType};base64,${im.data}` } }))] }
        : { role: m.role, content: text };
    }
    return out;
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
    // 回复和之后的主动消息走这个账号
    if (ev.account && conv.account !== ev.account) store.setConversationAccount(conv.id, ev.account);
    const t: Inflight = { botId: bot.id, since: Date.now(), abort: new AbortController(), release: KeyedQueue.releaser() };
    const link = () => t.abort.abort();
    if (opts.signal?.aborted) link();
    else opts.signal?.addEventListener("abort", link, { once: true });
    // 回复句柄存下来（代理自己醒来的一轮要回复到它；重启也在）
    if (Object.keys(ev.replyHandle).length) store.setKV(REPLY_TO + conv.id, JSON.stringify(ev.replyHandle));
    const done = this.enter(conv.id, t);
    // 重启标记：应用退出或崩溃时还没处理完的，下次启动告诉用户
    const text = eventText(ev);
    if (text || ev.prepared) markInflight(store, conv.id, text || attachmentsLabel());
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

  /**
   * 这一轮的回复（和交付的文件）已经交给渠道：清掉重启标记，不等收尾。微信、飞书的回复这时已经落进出站队列，重启后会补发；
   * 之后还有关"正在输入"（微信要一次网络请求）、让出会话，在那之间退出或崩溃，下次启动不该再说"没处理完，请重新发送"。
   * 并进这一轮的消息随它一起答完了；会话里还有排着、没答的消息时标记留着。
   */
  private answered(convId: string, run: Inflight): void {
    if (run.interrupted) return;
    for (const x of this.inflight.get(convId) ?? []) if (x !== run && !x.steered) return;
    try {
      clearInflight(this.opts.store, convId);
    } catch {
      /* 退出时数据库可能已经关了 */
    }
  }

  private async handleMessage(ev: InboundEvent, out: ReplySession, bot: NonNullable<ReturnType<Store["getBot"]>>, convId: string, run: Inflight, prior: Promise<void> | undefined): Promise<void> {
    const { store } = this.opts;
    const signal = run.abort.signal;
    const agent = this.opts.agent;
    // 网页对话随消息发的附件：用户消息已经原子存好（带附件引用），这里拿到的是交给模型的全文和图片；
    // 不当命令解释、不并进别的回合、不进工作区
    const pre = ev.prepared;
    if (pre) run.userStored = true;
    // 代理模式：收到的图片/文件先进工作区，消息里写路径
    if (agent?.available && !pre) storeInbound(agent.host(bot.id).workspace, ev);
    let text = pre ? pre.text : eventText(ev);
    if (!text) return;
    const images = pre ? pre.images : inboundImages(ev);
    // 上次重启时没处理完、当时又没能告诉用户的：先说一声
    const notice = takeNotice(store, convId);
    if (notice) await out.apply({ type: "text", text: notice }).catch((e) => log.warn("restart notice failed", { message: (e as Error).message.slice(0, 200) }));

    // 技能库「复制安装指令」的固定格式：不经过模型，直接出安装卡片（也不并进进行中的回合）
    const installLinks = this.opts.skillInstalls && !pre ? installPromptLinks(text) : null;
    if (installLinks) return this.installFromPrompt(ev, out, bot.id, convId, text, installLinks, run);

    // 前面还有消息在处理：代理回合进行中就把这条并进去（模型下一步看到，回复一起给），否则排在它们后面。
    // 命令（/model、/reset…）不并入，等前面的处理完
    if (prior) {
      // 并进进行中的那一轮只在两条绑定的是同一个工作文件夹时（PRD R2）：换了目录的新消息排在它后面，用自己的目录
      if (agent?.available && !pre && !signal.aborted && !text.startsWith("/")
        && (ev.conversation.kind !== "group" || agent.turnsInProgress.get(convId)?.senderId === ev.sender.id)
        && (agent.turnsInProgress.get(convId)?.folderId ?? "") === (ev.folder?.id ?? "")
        && (await this.steer(agent, bot.id, convId, text, images, out, run))) {
        await prior;
        // 应用正在退出、它并进的那一轮没做完：重启标记留着（下次启动告诉用户）
        if (this.closing) run.interrupted = true;
        return;
      }
      await prior;
    }
    // 前面的消息可能换了模型（/model）
    const conv = { id: convId, model: store.getConversation(convId)?.model ?? "" };

    // 排队时就被停止了：不再处理（命令也不执行），留一句"已中止"
    if (signal.aborted) {
      const msg = stoppedText(Date.now() - run.since);
      if (!text.startsWith("/")) {
        if (!run.userStored) store.addMessage(conv.id, "user", text);
        store.addMessage(conv.id, "assistant", msg);
      }
      await out.apply({ type: "text", text: msg });
      return;
    }

    // 参考图生图（网页单聊受理时冻结的计划）：由宿主直接执行，不交给聊天模型或代理
    if (ev.generate && pre) {
      if (this.opts.imageGen) await this.opts.imageGen.run(ev.generate, out, signal);
      else {
        const msg = `⚠️ ${t("attachments.changed")}`;
        store.addMessage(conv.id, "assistant", msg);
        await out.apply({ type: "text", text: msg });
      }
      this.answered(conv.id, run);
      return;
    }

    // /skill：等同于说「把刚才做的事存成技能」（后面的文字是补充说明），交给机器人整理成草稿卡；不能存时
    // （渠道群、不是主人、群里该别的机器人出、没有可存的事）直接回一句。用户消息照原样记下
    const skillCmd = pre ? null : /^\/skill(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (skillCmd) {
      const gate = agent?.available ? agent.saveSkillGate(bot.id, conv.id) : { why: "", say: t("mySkills.nothing") };
      if (gate && !gate.say) return;
      if (!run.userStored) store.addMessage(conv.id, "user", text);
      run.userStored = true;
      if (gate) {
        store.addMessage(conv.id, "assistant", gate.say);
        await out.apply({ type: "text", text: gate.say });
        this.answered(conv.id, run);
        return;
      }
      text = skillCmd[1]?.trim() ? t("mySkills.slashPromptWith", { text: skillCmd[1].trim() }) : t("mySkills.slashPrompt");
      // 网页单聊：先出一张「正在整理技能…」，机器人交来草稿时原位变成草稿卡
      const drafts = this.opts.skillDrafts;
      if (drafts && ev.channel === "web" && ev.conversation.kind !== "group") await out.apply(drafts.op(drafts.begin(bot.id, conv.id)));
    }

    if (!pre && text.startsWith("/")) {
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
    // 右下角选的是纯图片生成型号：这条文字就是文生图指令，直接走图片接口（不当聊天模型调用、不拼聊天记录）
    if (!pre && this.opts.imageGen) {
      const web = ev.channel === "web" && ev.conversation.kind !== "group" && ev.conversation.id === "console";
      const plan = await this.opts.imageGen.plan(bot.id, conv.id, model, text, web).catch((e: Error) => {
        log.warn("image model check failed", { message: e.message.slice(0, 200) });
        return undefined;
      });
      if (plan) {
        if (!run.userStored) store.addMessage(conv.id, "user", text, undefined, "refuse" in plan ? {} : { generation: { model: plan.model, mode: "text" } });
        run.userStored = true;
        if ("refuse" in plan) {
          store.addMessage(conv.id, "assistant", plan.refuse);
          await out.apply({ type: "text", text: plan.refuse });
        } else await this.opts.imageGen.run(plan, out, signal);
        this.answered(conv.id, run);
        return;
      }
    }
    const routed = this.opts.route ? this.opts.route(bot.id, model) : model;
    // 只有能看图的模型才收到图片本身；其余模型只看到文字里的“[图片 …]”
    const canSee = await this.sees(routed);
    const seen = canSee ? images : [];
    // 受理时核对过模型能看图；到这里条件变了（模型资料刚更新）就不发残缺的内容，说明原因
    if (pre?.images.length && !canSee) {
      const msg = `⚠️ ${t("attachments.changed")}`;
      store.addMessage(conv.id, "assistant", msg);
      await out.apply({ type: "text", text: msg });
      this.answered(conv.id, run);
      return;
    }

    let note = "";
    if (agent?.available) {
      const place: ChatPlace = { channel: ev.channel, kind: ev.conversation.kind === "group" ? "group" : "dm" };
      const handled = await this.handleAgent(agent, bot.id, conv.id, text, routed, place, out, seen, run, ev.sender.id, !!pre?.images.length, this.turnFolder(ev.folder));
      if (handled === true) return;
      // 应用正在退出：代理进程没了不是该改用纯对话的时候，留给下次启动提醒
      if (this.closing) {
        run.interrupted = true;
        return;
      }
      // 代理进程还在启动（第一次可能要几分钟）：这条消息先由模型直接回答，不让用户干等
      if (handled === "starting") note = t("runtime.startingNote");
    }

    if (!run.userStored) store.addMessage(conv.id, "user", text);
    run.userStored = true;
    const history = store.contextWindow(conv.id, this.opts.contextMessages, this.opts.contextChars);
    const messages: ChatMessage[] = [];
    const system = [replyLanguageHint(lang()), bot.systemPrompt].filter((part) => part.trim()).join("\n\n");
    if (system) messages.push({ role: "system", content: system });
    messages.push(...this.withAttachments(bot.id, history.filter((m) => m.role !== "system"), canSee));
    const last = messages[messages.length - 1];
    if (!pre && seen.length && last?.role === "user" && typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content }, ...seen.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))];
    }

    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    let acc = "";
    const reasoningEffort = await this.opts.reasoningEffort?.(routed).catch(() => undefined);
    const call = () =>
      this.opts.models.streamChat({ model: routed, messages, signal, reasoningEffort }, (delta) => {
        acc += delta;
        void out.apply({ type: "stream.update", text: acc });
      });
    try {
      const full = await call().catch(async (e: Error) => {
        // 一个字都还没出来就失败：Key 若刚被换掉，就用新 Key 再发一次
        if (acc || signal.aborted || !(await this.keyRecovered())) throw e;
        return call();
      });
      const finalText = full || acc || t("runtime.emptyReply");
      store.addMessage(conv.id, "assistant", finalText);
      await out.apply({ type: "stream.finish", text: note ? `${note}\n\n${finalText}` : finalText });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (signal.aborted) {
        // 停止：已生成的部分保留，末尾注明；还没出字就只说已中止
        const msg = acc ? `${acc}\n\n${t("runtime.stoppedMark")}` : stoppedText(Date.now() - run.since);
        store.addMessage(conv.id, "assistant", msg);
        await out.apply({ type: "stream.finish", text: msg });
        return;
      }
      log.warn("model call failed", { model, status: err.status, message: err.message });
      // 带着图片的请求被上游拒绝：按真实原因说，不自动去掉图片或换接口重发
      const imageRejected = !acc && !!pre?.images.length && imageRejection(err);
      const msg = acc ? `${acc}\n\n${t("runtime.interrupted", { error: err.message })}` : imageRejected ? `⚠️ ${t("attachments.upstreamImage")}\n${err.message.slice(0, 300)}` : t("runtime.modelFailed", { model, error: err.message });
      await out.apply({ type: "stream.finish", text: msg });
    } finally {
      this.answered(conv.id, run);
      await out.apply({ type: "typing", on: false });
    }
  }

  /**
   * 技能库的安装指令（「帮我安装这个技能：链接」，每行一条）：应用直接读取、出确认卡片，不经过模型。
   * 网页对话一出卡片就显示（卡片自己显示读取中）；渠道等读完再发文字版（带编号）。渠道里只有主人能装。
   */
  private async installFromPrompt(ev: InboundEvent, out: ReplySession, botId: string, convId: string, text: string, links: string[], run: Inflight): Promise<void> {
    const { store } = this.opts;
    const installs = this.opts.skillInstalls!;
    if (!run.userStored) store.addMessage(convId, "user", text);
    run.userStored = true;
    const say = async (msg: string) => {
      store.addMessage(convId, "assistant", msg);
      await out.apply({ type: "text", text: msg });
    };
    try {
      if (this.opts.access && !this.opts.access.ownsConversation(convId)) return await say(t("skills.notOwner"));
      const cards = installs.request({ botId, conversationId: convId, urls: links });
      if (ev.channel === "web") for (const c of cards) await out.apply(installs.op(c));
      else {
        for (const c of cards) {
          const done = await installs.ready(c.id);
          if (done) await out.apply(installs.op(done));
        }
      }
      if (links.length > MAX_CARDS_PER_MESSAGE) await say(t("skills.tooManyLinks", { max: MAX_CARDS_PER_MESSAGE }));
    } finally {
      this.answered(convId, run);
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
    // /bot：换这个会话和哪个机器人聊（渠道账号是全局的，所有机器人共用）。不碰模型，不进队列
    const switching = ev.account ? /^\/bot(?:\s+(.+))?$/i.exec(text.trim()) : null;
    if (switching && ev.account) return { handled: true, ack: this.switchBot(ev, ev.account, switching[1]) };
    // /status、/help 只读、不碰模型和代理进程：不进会话队列，不会排在一个卡住或正在启动代理的回合后面
    const cmd = text.trim().toLowerCase();
    if (cmd === "/status" || cmd === "/help") {
      const bot = this.opts.store.getBot(ev.botId);
      if (bot) return { handled: true, ack: cmd === "/help" ? help() : this.statusText(bot.id, convId, this.opts.store.getConversation(convId)?.model ?? "", bot.defaultModel) };
    }
    const agent = this.opts.agent;
    const tasks = agent?.tasks;
    // 后台任务：/tasks 列出，/stop 编号 停止一个（只读本地状态、不碰聊天回合，不进会话队列）
    if (cmd === "/tasks") return { handled: true, ack: tasks ? tasks.listText(convId) : t("runtime.tasksAgentOnly") };
    const stopTask = /^\/stop\s+(\d{1,2})$/.exec(cmd);
    if (stopTask) return { handled: true, ack: tasks ? tasks.stopByIndex(convId, Number(stopTask[1]), `${ev.channel}:${ev.sender.id}`) : t("runtime.tasksAgentOnly") };
    // /stop 必须插队：它要停的正是排在前面、卡住的那个回合（纯对话、代理还在启动时也算）
    if (cmd === "/stop") {
      const since = this.busySince(convId) ?? agent?.turnsInProgress.get(convId)?.since;
      if (since === undefined || !this.stop(convId)) {
        // 没有在处理的消息，但有后台任务在跑：说一声怎么停它（/stop 不停后台任务）
        const working = tasks?.working(convId) ?? [];
        const hint = working.length ? t("runtime.stopHint", { list: working.map((x, i) => `${i + 1}. ${x.title}`).join(t("runtime.listSepStrong")) }) : "";
        return { handled: true, ack: t("runtime.nothingToStop", { hint }) };
      }
      return { handled: true, ack: t("runtime.stoppingPrev", { d: fmtSecs(Date.now() - since) }) };
    }
    if (!agent) return { handled: false };
    // 审批、提问的回复；后台任务的只认引用、编号开头，或它是机器人最后一条消息时的选项编号（见 ApprovalCenter.handleReply）
    const { quote, plain } = quoteOf(ev);
    const ruleAction = tasks?.ruleReplyAction(convId, quote ? plain : text, quote || "", ev.sender.id);
    if (ruleAction?.handled) return { handled: true, ack: ruleAction.text };
    // 渠道里对技能安装卡片的回复：「y 1234」安装、「n 1234」取消（网页对话里有按钮，不认文字）
    const installReply = ev.channel !== "web" ? this.opts.skillInstalls?.handleReply(convId, quote ? plain : text, `${ev.channel}:${ev.sender.id}`) : undefined;
    if (installReply?.handled) return installReply;
    // 渠道里对「存成技能」草稿的回复：「保存」「取消」「保留个人信息」「另存」（别的话交给机器人，它判断是不是在改草稿）
    const draftReply = ev.channel !== "web" ? this.opts.skillDrafts?.handleReply(convId, quote ? plain : text, `${ev.channel}:${ev.sender.id}`) : undefined;
    if (draftReply?.handled) return draftReply;
    const r = agent.approvals.handleReply(convId, text, `${ev.channel}:${ev.sender.id}`, { ...tasks?.replyContext(convId), ...(quote ? { quote, plain } : {}) });
    if (r.handled) return r;
    // 聊天软件里回「撤销」：撤销机器人上一条回复里记到关于我的（网页对话里点按钮，不认文字）
    if (ev.channel !== "web" && UNDO_WORDS.test(text.trim()) && agent.readsAboutMe?.(ev.botId, convId)) {
      const undone = agent.aboutMe.undoRecent(convId, this.opts.store.lastUserMessageAt(convId));
      if (undone.length) return { handled: true, ack: t("aboutMe.undone") };
    }
    // 引用了后台任务推来的结果或失败那句（微信），或发在任务请求那条消息的回复链里（飞书）：直接交给那个任务，不经聊天代理
    const follow = tasks?.followUp(convId, { text: quote ? plain : text, ...(quote ? { quote } : {}), ...ev.thread });
    if (follow?.handled) return follow;
    // 前一条还在处理：能并入进行中的代理回合时由 handle 并入并回一句；不能时说一声这条排在后面、怎么中止（每个回合只说一次），消息照常入队
    const cur = agent.turnsInProgress.get(convId);
    if (cur && !cur.queuedNotice && !agent.canSteer(convId)) {
      cur.queuedNotice = true;
      const last = cur.activity.last;
      return { handled: false, ack: t("runtime.queuedBehind", { d: fmtSecs(Date.now() - cur.since), now: last ? t("runtime.nowDoing", { step: clipLine(describeStep(last)) }) : "" }) };
    }
    return r;
  }

  /** /status 的内容：只读本地状态，立即返回 */
  statusText(botId: string, convId: string, convModel: string, botModel: string): string {
    const m = convModel || botModel || this.opts.defaultModel() || t("runtime.autoModel");
    const a = this.opts.agent;
    const perm = a?.available ? a.settings(botId).permission : undefined;
    const sandbox = t(perm === "full" ? "runtime.sandboxFull" : perm === "readonly" ? "runtime.sandboxReadonly" : "runtime.sandboxWorkspace");
    const mode = a?.available ? t("runtime.modeAgent", { sandbox }) : t("runtime.modeChat");
    // 完全权限：每次 /status 都提醒风险
    const full = perm === "full" ? [t("runtime.fullWarning")] : [];
    const pend = a ? a.approvals.pending(convId).map((r) => t(r.kind === "approval" ? "runtime.pendingApproval" : "runtime.pendingQuestion", { code: r.code })) : [];
    const cui = a?.available ? a.computerUse(botId) : undefined;
    const cu = cui
      ? [
          t("runtime.cuLine", { backend: cui.backend === "codex" ? t("runtime.cuCodex") : "Cua Driver", state: t(cui.active ? "runtime.cuOn" : "runtime.cuOff"), reason: cui.reason }),
          ...(cui.notice && cui.enabled ? [cui.notice] : []),
        ]
      : [];
    const host = a?.available ? [a.hostSummary(botId)] : [];
    // Windows：代理执行命令用的 PowerShell；没有 7 时建议安装
    const ps = a?.available ? pwshStatusLine(pwshProbe.snapshot()) : "";
    const turn = a?.turnsInProgress.get(convId);
    const busy = turn ? [busyLine(turn.since, turn.lastProgress, turn.activity.steps, !!a?.canSteer(convId))] : [];
    const who = this.opts.access ? [this.opts.access.policyLine(this.opts.store.getConversation(convId)?.account || botId)] : [];
    // 这个会话有后台任务在进行时说一句（没有就不说）
    const working = a?.tasks?.working(convId) ?? [];
    const bg = working.length ? [t("runtime.backgroundTasks", { list: working.map((x) => t("runtime.backgroundTask", { title: x.title, stage: x.stage.label })).join(t("runtime.listSep")) })] : [];
    return [
      t("runtime.currentModel", { model: m, suffix: convModel ? t("runtime.convSetting") : "" }),
      t("runtime.runMode", { mode }),
      ...full,
      ...who,
      ...host,
      ...(ps ? [ps] : []),
      ...busy,
      ...bg,
      ...cu,
      ...(pend.length ? [t("runtime.pending", { list: pend.join(t("runtime.listSep")) })] : []),
    ].join("\n");
  }

  /** 卡片按钮回调：批准/拒绝/选择选项。 */
  cardAction(botId: string, value: Record<string, string>, by: string): { toast: string; ok: boolean; card?: Record<string, unknown> } {
    const agent = this.opts.agent;
    if (value?.amb === "skill") return this.opts.skillInstalls ? this.opts.skillInstalls.cardAction(botId, value, by) : { toast: t("runtime.requestMissing"), ok: false };
    if (value?.amb === "skill-draft") return this.opts.skillDrafts ? this.opts.skillDrafts.cardAction(botId, value, by) : { toast: t("runtime.requestMissing"), ok: false };
    if (value?.amb === "rule" && by.startsWith("feishu:") && agent?.tasks) return agent.tasks.ruleCardAction(botId, value.id, value.op, by.slice(7));
    const row = agent && value?.id ? this.opts.store.getApproval(String(value.id)) : undefined;
    // 卡片从渠道账号发回来：看这条请求所在的会话是不是走这个账号
    const owner = row && (this.opts.store.getConversation(row.conversationId)?.account || row.botId);
    if (!agent || !row || owner !== botId) return { toast: t("runtime.requestMissing"), ok: false };
    if (row.status !== "pending" && value.amb === "question" && row.taskId) {
      // 后台任务按默认回答先做完了、提问撤回了，卡片上的按钮还点得到：当作迟到的回答交给任务（同引用那条提问）
      const opt = (questionsOf(row)[0]?.options ?? [])[Number(value.option) - 1]?.label;
      const late = opt ? agent.tasks?.answerWithdrawn(row.id, opt) : undefined;
      if (late?.handled) return { toast: late.ack ?? t("runtime.submitted"), ok: true };
    }
    if (row.status !== "pending") return { toast: t("runtime.requestDone", { code: row.code }), ok: false };
    if (value.amb === "approval") {
      const allow = value.decision === "allow";
      return agent.approvals.decide(row.id, allow, by) ? { toast: t(allow ? "runtime.approvedOnce" : "runtime.rejected", { code: row.code }), ok: true } : { toast: t("runtime.expired"), ok: false };
    }
    if (value.amb === "question") {
      // 回答按钮所在的这一个提问（会话里可能同时有几个）
      return agent.approvals.answerText(row.id, String(value.option ?? ""), by) ? { toast: t("runtime.submitted"), ok: true } : { toast: t("runtime.submitFailed"), ok: false };
    }
    return { toast: t("runtime.unknownAction"), ok: false };
  }

  /**
   * 代理回合；返回 false 表示宿主不可用且尚无任何输出（调用方回退到纯对话），
   * "starting" 表示代理进程在等待时限内没有启动好（同样回退，启动在后台继续）。
   */
  /**
   * 消息绑定的工作文件夹 → 交给代理的那一份。这时（排队、等前一条之后，真要动文件之前）再核对一次：不在了、被换成别的同名目录、
   * 没有权限都按不可用处理，不退回默认工作区、不去别处找。undefined（其他渠道）= 不动会话现在的绑定。
   */
  private turnFolder(b: FolderBinding | null | undefined): TurnFolder | undefined {
    if (b === undefined) return undefined;
    if (b === null) return null;
    const r = this.opts.folders?.resolve(b) ?? { root: b.path };
    return "root" in r ? { id: b.id, root: r.root, name: b.name } : { id: b.id, name: b.name, unavailable: true, reason: r.error };
  }

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
    senderId?: string,
    /** 这条消息带着用户附件里的图片：上游拒绝时按图片的原因说明 */
    attachedImages = false,
    /** 这条消息绑定的工作文件夹（回合开始时刚核对过；undefined = 默认工作区） */
    folder?: TurnFolder,
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
    const unbindApprovals = agent.approvals.bindSink(convId, async (row) => {
      visible = true;
      await out.apply(interactiveOp(row));
    });
    // install_skill 工具出的卡片：网页对话一出就显示（卡片自己显示读取中），渠道读完再发那段文字
    const installs = this.opts.skillInstalls;
    const webConv = store.getConversation(convId)?.channel === "web";
    const unbindInstalls = installs?.bindSink(convId, async (card, phase) => {
      if (phase !== (webConv ? "created" : "ready")) return;
      visible = true;
      await out.apply(installs.op(card));
    });
    // save_skill 工具出的草稿卡：网页显示卡片，渠道发文字版（飞书带按钮）
    const drafts = this.opts.skillDrafts;
    const unbindDrafts = drafts?.bindSink(convId, async (card) => {
      visible = true;
      await out.apply(drafts.op(card));
    });
    const unbind = () => {
      unbindApprovals();
      unbindInstalls?.();
      unbindDrafts?.();
      // 这一轮结束了还在「正在整理技能…」的卡（机器人没交草稿）：整理失败，带重试
      drafts?.settle(convId);
    };
    // 模型在回合中间说的话、交付的文件：马上显示，结束时随回复存下
    const said = new TurnSaid(out);
    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    // 代理进程还没就绪（第一次启动可能要几分钟）：先说清楚在等什么，而不是一直"思考中"。模型说的第一段话或最终回复会替换这段文字
    const host = agent.host(botId);
    let startup: NodeJS.Timeout | undefined;
    if (host.state !== "running") {
      const since = Date.now();
      const show = () => {
        said.provisional = true;
        if (host.state === "running") {
          clearInterval(startup);
          return void out.apply({ type: "stream.update", text: t("runtime.agentReady") });
        }
        const s = Math.round((Date.now() - since) / 1000);
        const first = (host.diagnostics() as any).firstStart;
        void out.apply({ type: "stream.update", text: t("runtime.agentStarting", { elapsed: s >= 5 ? t("runtime.agentStartingElapsed", { s }) : "", first: first ? t("runtime.agentStartingFirst") : "" }) });
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
      this.answered(convId, inflight);
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
      // 新对话的第一句：交接便条还在后台写就等一会儿（最多 8 秒，期间照常「思考中」/「正在输入」）
      if (!store.getAgentSession(convId)) await agent.seedReady?.(convId);
      if (signal.aborted) return await stoppedEarly();
      const first = store.getAgentSession(convId) ? text : firstInput(agent, botId, convId, text, place);
      // 后台任务的结果发出去之后，下一条聊天消息带上那张便条：聊天代理知道发生了什么；
      // 关于我在这段开始之后变了（别的机器人刚记下的）：带上新的全文
      const notes = [takeTaskNotes(store, convId), store.getAgentSession(convId) ? (agent.aboutMeUpdate?.(botId, convId) ?? "") : "", agent.collab?.chatNote(botId, convId) ?? ""].filter(Boolean).join("\n\n");
      const input = notes ? `${notes}\n\n${first}` : first;
      const runOnce = async () => {
        // runTurn 同步登记回合，之后的停止交给代理（TurnStopped，会重启代理进程）
        const turn = agent.runTurn(botId, {
          conversationId: convId,
          senderId,
          ...(folder !== undefined ? { folder } : {}),
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
            ...said.observer,
          },
        });
        const halt = () => agent.stopTurn(convId);
        signal.addEventListener("abort", halt, { once: true });
        try {
          return await turn;
        } finally {
          signal.removeEventListener("abort", halt);
        }
      };
      const r = await runOnce()
        .catch(async (e: Error) => {
          // 还没有任何步骤就失败（没调用工具、没有副作用）：Key 若刚被换掉，就用新 Key 把这一回合再跑一次
          if (e instanceof TurnStopped || signal.aborted || visible || steps.size || agent.host(botId).state !== "running" || !(await this.keyRecovered())) throw e;
          return runOnce();
        })
        .finally(() => clearInterval(startup));
      if (!inflight.userStored) store.addMessage(convId, "user", text);
      inflight.userStored = true;
      const reply = said.reply(r.text, t("runtime.doneNoText"));
      const ruleChanges = agent.tasks?.pendingRuleActions(convId) || [];
      const replyChannel = store.getConversation(convId)?.channel;
      if (ruleChanges.length && replyChannel !== "web" && replyChannel !== "feishu") reply.text += `\n\n${t("rules.undoHint")}`;
      // 关于我：聊天软件里没有按钮，记下、改了、删了的那一行直接写在回复后面，回「撤销」可撤回（网页对话里是带按钮的一行）
      if (replyChannel !== "web") {
        const lines = aboutMeLines(agent, convId, inflight.since);
        if (lines) reply.text += `\n\n${lines}`;
      }
      const replyId = store.addMessage(convId, "assistant", reply.text, [...steps.values()], { interim: reply.interim, files: r.files });
      agent.tasks?.finishRuleActions(convId, replyId);
      await out.apply({ type: "stream.finish", text: reply.text });
      if (replyChannel === "feishu") for (const change of ruleChanges) {
        const card = agent.tasks?.ruleActionCard(change.id);
        if (card) await out.apply({ type: "interactive", kind: "rule", title: card.title, prompt: card.text, buttons: card.buttons, requestId: change.id });
      }
      for (const f of r.files ?? []) {
        try {
          await out.apply({ type: "file", path: f, name: path.basename(f) });
        } catch (e) {
          log.warn("deliver file failed", { name: path.basename(f), message: (e as Error).message.slice(0, 200) });
        }
      }
      this.answered(convId, inflight);
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
      if (!inflight.userStored) store.addMessage(convId, "user", text);
      inflight.userStored = true;
      let msg: string;
      if (err instanceof TurnStopped && err.reason === "permission") {
        const paused = this.pauseForPermission(botId, convId, err, [...steps.values()], said, { senderId, text });
        msg = paused.text;
        agent.tasks?.finishRuleActions(convId, paused.messageId);
      } else {
        msg = attachedImages && !(err instanceof TurnStopped) && !steps.size && imageRejection(err) ? `⚠️ ${t("attachments.upstreamImage")}\n${err.message.slice(0, 300)}` : turnFailedText(err, [...steps.values()]);
        // 出错、中止之前说过的话和交付过的文件留在历史里（文件不再发到其它渠道）
        const messageId = store.addMessage(convId, "assistant", msg, [...steps.values()], { interim: said.interim, files: said.presented });
        agent.tasks?.finishRuleActions(convId, messageId);
      }
      await out.apply({ type: "stream.finish", text: msg });
      this.answered(convId, inflight);
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
    t.steered = true;
    t.release?.();
    await out.apply({ type: "text", text: steerAck(), ack: true });
    return true;
  }

  /**
   * 代理自己醒来的一轮（后台命令结束，DSH 唤醒了空闲的代理）：像普通回合一样登记（/status、/stop、看门狗、插话都认它），
   * 经渠道主动发到会话里（网页对话进 live 登记；飞书回复最近一条消息；微信占一条回复配额），回复与步骤存进历史。
   */
  /**
   * 电脑操作缺 macOS 权限被拦下：这一轮暂停，不出红色错误条。网页对话里这一轮的位置显示权限卡；
   * 外部渠道只有文字说明，卡片放在「桌面对话」。开启后 30 分钟内且没有新消息就自动接着做，否则点「继续」。
   */
  private pauseForPermission(botId: string, convId: string, err: TurnStopped, steps: ActivityStep[], said: TurnSaid, request: { senderId?: string; text: string }): { text: string; messageId: number } {
    const { store, agent } = this.opts;
    const conv = store.getConversation(convId);
    const text = conv?.channel === "web" ? t("cu.waiting")
      : t("cu.channelWait", { items: err.missing.map((k) => t(k === "screen" ? "runtime.permScreen" : "runtime.permAccessibility")).join(t("runtime.listSep")) });
    const messageId = store.addMessage(convId, "assistant", text, steps, { interim: said.interim, files: said.presented, permissionWait: true });
    const desktop = store.ensureConversation(botId, "web", "console", "控制台");
    const cardId = desktop.id === convId ? messageId : store.addMessage(desktop.id, "assistant", t("cu.waiting"), undefined, { permissionWait: true });
    agent?.cuPermissions?.attach(botId, {
      senderId: request.senderId, conversationId: convId, sessionId: store.getAgentSession(convId), messageId: cardId,
      lastUserId: store.listMessages(convId, 30).filter((m) => m.role === "user").at(-1)?.id || 0, background: false, requestText: request.text,
      missing: err.missing as CuBlocked["missing"],
    });
    return { text, messageId };
  }

  /** 权限恢复只在原代理会话里继续，不重新提交原始请求、不占用输入草稿。 */
  async resumePermission(botId: string, pending: CuBlocked): Promise<void> {
    const { store, agent } = this.opts;
    const convId = pending.conversationId || "";
    const conv = store.getConversation(convId);
    const bot = store.getBot(botId);
    if (this.closing || !agent?.available || !conv || !bot || this.busySince(convId) !== undefined || !pending.sessionId || store.getAgentSession(convId) !== pending.sessionId) throw new Error("The original conversation is no longer available to continue.");
    let handle: Record<string, string> | undefined;
    try { handle = JSON.parse(store.getKV(REPLY_TO + convId) || "null") || undefined; } catch { /* 可在历史里继续 */ }
    const reply = (this.repliers.get(`${conv.account || botId}:${conv.channel}`) ?? this.repliers.get(`*:${conv.channel}`))?.(conv, handle, `permission:${botId}:${pending.at}`);
    if (!reply && conv.channel !== "web") throw Object.assign(new Error("The channel is reconnecting."), { retryable: true });
    const inflight: Inflight = { botId, since: Date.now(), abort: new AbortController(), userStored: true };
    const done = this.enter(convId, inflight);
    try {
      const model = conv.model || bot.defaultModel || this.opts.defaultModel();
      const routed = model && this.opts.route ? this.opts.route(botId, model) : model;
      const result = await this.handleAgent(agent, botId, convId,
        `[系统权限恢复] 所需的系统权限已开启。继续本会话中因 ${pending.tool} 缺少权限而被拦下的请求，从尚未完成的步骤接着做。先检查之前的步骤、已交付结果和当前应用状态，不要重复已完成的操作；不要重新执行整个原始请求。\n[待继续的请求]\n${pending.requestText || "见本会话中被权限拦下的那一轮"}`,
        routed, { channel: conv.channel, kind: conv.kind }, reply?.out || { apply: async () => undefined }, [], inflight, pending.senderId);
      if (result !== true) throw new Error("The agent is not ready to continue.");
    } finally { done.leave(); reply?.done?.(); }
  }

  /**
   * 机器人之间发消息：B 回消息后 A 开一轮核对、汇总（collab/service.ts）。排在这个会话正在处理的消息后面（你正和 A 说别的时先回完当前这条），
   * 这一轮不接受并进来的新消息。界面上不实时显示：结束后 keep() 为真才把 A 的回复存进对话（A 让 B 重做时这一轮的话不给用户看），
   * 存下的那条的 id 返回给调用方。代理不可用、出错时返回 error。
   */
  async collabTurn(botId: string, convId: string, input: string, keep: () => boolean): Promise<{ messageId?: number; text?: string; error?: string }> {
    const { store } = this.opts;
    const agent = this.opts.agent;
    const conv = store.getConversation(convId);
    const bot = store.getBot(botId);
    if (this.closing || !agent?.available || !conv || !bot) return { error: "unavailable" };
    const fl: Inflight = { botId, since: Date.now(), abort: new AbortController(), userStored: true };
    const { prior, leave } = this.enter(convId, fl);
    try {
      await prior;
      // 前面的消息并进了回合、或是代理自己醒来的一轮：等那一轮也结束
      for (let i = 0; agent.turnsInProgress.has(convId) && i < 7200; i++) await new Promise((r) => setTimeout(r, 1000));
      if (this.closing) return { error: "closing" };
      fl.since = Date.now();
      const steps = new Map<string, ActivityStep>();
      const model = conv.model || bot.defaultModel || this.opts.defaultModel();
      const routed = model && this.opts.route ? this.opts.route(botId, model) : model;
      agent.holdSteer(convId, true);
      let r: Awaited<ReturnType<AgentManager["runTurn"]>>;
      const halt = () => agent.stopTurn(convId);
      fl.abort.signal.addEventListener("abort", halt, { once: true });
      try {
        if (!store.getAgentSession(convId)) await agent.seedReady?.(convId);
        const first = store.getAgentSession(convId) ? input : firstInput(agent, botId, convId, input, { channel: conv.channel, kind: conv.kind === "group" ? "group" : "dm" });
        const notes = [takeTaskNotes(store, convId), store.getAgentSession(convId) ? (agent.aboutMeUpdate?.(botId, convId) ?? "") : "", agent.collab?.chatNote(botId, convId) ?? ""].filter(Boolean).join("\n\n");
        r = await agent.runTurn(botId, { conversationId: convId, text: notes ? `${notes}\n\n${first}` : first, model: routed, onStep: (step) => void steps.set(step.id, step), observer: {} });
      } catch (e) {
        log.warn("collab turn failed", { bot: botId, message: (e as Error).message.slice(0, 200) });
        return { error: (e as Error).message };
      } finally {
        agent.holdSteer(convId, false);
        fl.abort.signal.removeEventListener("abort", halt);
      }
      const text = (r.text || "").trim();
      if (!keep()) return { text };
      const messageId = store.addMessage(convId, "assistant", text || t("runtime.doneNoText"), [...steps.values()], { files: r.files });
      return { messageId, text };
    } finally {
      leave();
      this.answered(convId, fl);
    }
  }

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
    const r = (this.repliers.get(`${conv.account || botId}:${conv.channel}`) ?? this.repliers.get(`*:${conv.channel}`))?.(conv, handle, `wake:${wakeId}`);
    if (!r) log.warn("no way to reply in this conversation; the wake-up reply is only kept in its history", { bot: botId, conversationId: convId, channel: conv.channel });
    const out: ReplySession = r?.out ?? { apply: async () => undefined };
    const fl: Inflight = { botId, since: Date.now(), abort: new AbortController(), userStored: true };
    const done = this.enter(convId, fl);
    // 重启标记：这一轮没做完应用就退出或崩溃了，下次启动告诉用户（说的是让命令跑起来的那条消息）
    const asked = store.listMessages(convId, 20).filter((m) => m.role === "user").at(-1)?.content;
    markInflight(store, convId, asked || t("runtime.jobResult"));
    const steps = new Map<string, ActivityStep>();
    const said = new TurnSaid(out);
    const unbind = agent.approvals.bindSink(convId, async (row) => void (await out.apply(interactiveOp(row))));
    const halt = () => agent.stopTurn(convId);
    fl.abort.signal.addEventListener("abort", halt, { once: true });
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
          observer: said.observer,
          onStep: (step) => {
            steps.set(step.id, step);
            void out.apply({ type: "activity", step });
          },
        });
      } catch (e) {
        // 应用正在退出时代理进程被关掉：不回复，重启标记留着
        if (this.closing) {
          fl.interrupted = true;
          return;
        }
        // 后台命令结束后自己接着做时被权限拦下：和回复用户消息时一样暂停、挂权限卡，开启后在原对话接着做
        let msg: string;
        if (e instanceof TurnStopped && e.reason === "permission") {
          msg = this.pauseForPermission(botId, convId, e, [...steps.values()], said, { text: asked || t("runtime.jobResult") }).text;
        } else {
          msg = turnFailedText(e as Error, [...steps.values()]);
          store.addMessage(convId, "assistant", msg, [...steps.values()], { interim: said.interim, files: said.presented });
        }
        await out.apply({ type: "stream.finish", text: msg });
        this.answered(convId, fl);
        return;
      }
      const reply = said.reply(res.text, t("runtime.jobDoneNoText"));
      store.addMessage(convId, "assistant", reply.text, [...steps.values()], { interim: reply.interim, files: res.files });
      await out.apply({ type: "stream.finish", text: reply.text });
      for (const f of res.files ?? []) {
        try {
          await out.apply({ type: "file", path: f, name: path.basename(f) });
        } catch (e) {
          log.warn("deliver file failed", { name: path.basename(f), message: (e as Error).message.slice(0, 200) });
        }
      }
      this.answered(convId, fl);
    } finally {
      fl.abort.signal.removeEventListener("abort", halt);
      unbind();
      await out.apply({ type: "typing", on: false }).catch(() => undefined);
      done.leave();
      if (!this.inflight.get(convId)?.size && !fl.interrupted) {
        try {
          clearInflight(store, convId);
        } catch {
          /* 退出时数据库可能已经关了 */
        }
      }
      r?.done?.();
    }
  }

  /**
   * 开新对话（渠道里的 /new、应用里的新建按钮和 /new 共用）：代理没启用 → off；还没有代理会话（分隔线后没发过消息、从没聊过）→ already；
   * 开新段本身出错 → failed；否则 started，at 是分隔线的位置（应用里画「已开始新对话」）。
   */
  private async startNew(botId: string, convId: string, convModel: string, botModel: string): Promise<NewConversation> {
    const a = this.opts.agent;
    if (!a?.available) return { status: "off" };
    if (!this.opts.store.getAgentSession(convId)) return { status: "already" };
    try {
      const at = a.newSegment(botId, convId, await this.resolveModel(convModel, botModel).catch(() => ""));
      return at === undefined ? { status: "already" } : { status: "started", at };
    } catch (e) {
      return { status: "failed", error: (e as Error).message.slice(0, 200) };
    }
  }

  /**
   * 应用里的「开始新对话」（新建按钮、加号菜单、手动输入 /new）：不发消息、不出回复，排在这个会话里还没处理完的消息后面
   * （界面在回复进行中会先置灰按钮、把手动输入的 /new 排到回复结束后）。
   */
  async newConversation(botId: string, convId: string): Promise<NewConversation> {
    const { store } = this.opts;
    const run: Inflight = { botId, since: Date.now(), abort: new AbortController(), release: KeyedQueue.releaser() };
    const done = this.enter(convId, run);
    try {
      await done.prior;
      const conv = store.getConversation(convId);
      return await this.startNew(botId, convId, conv?.model ?? "", store.getBot(botId)?.defaultModel ?? "");
    } finally {
      done.leave();
    }
  }

  /** 返回 null 表示不是已知命令，按普通消息处理。 */
  private switchBot(ev: InboundEvent, account: string, wanted: string | undefined): string {
    const { store } = this.opts;
    if (!wanted?.trim()) {
      const list = store.listBots().map((b, i) => `${i + 1}. ${b.name}${b.id === ev.botId ? t("runtime.botCurrent") : ""}`).join("\n");
      return t("runtime.botList", { list });
    }
    const pick = findBot(store, wanted);
    if (!pick) return t("runtime.botMissing", { name: wanted.trim().slice(0, 40) });
    setBotForPeer(store, account, ev.channel, ev.conversation.id, pick.id);
    log.info("conversation switched to another bot", { channel: ev.channel, bot: pick.id });
    return t("runtime.botSwitched", { name: pick.name });
  }

  private async command(text: string, convId: string, convModel: string, botModel: string, botId: string): Promise<string | null> {
    const [cmd, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "/help":
        return help();
      case "/reset":
        this.opts.store.clearMessages(convId);
        this.opts.attachments?.dropBot(botId, convId);
        this.opts.agent?.resetConversation(convId);
        return t("runtime.resetDone");
      case "/new": {
        // 后面的文字忽略；立即回复，交接便条在后台写（新对话的第一句最多等它 8 秒）
        const r = await this.startNew(botId, convId, convModel, botModel);
        if (r.status === "failed") return t("runtime.newFailed", { error: r.error });
        return r.status === "started" ? t("runtime.newDone") : r.status === "already" ? t("runtime.alreadyNew") : t("runtime.newAgentOnly");
      }
      case "/status":
        return this.statusText(botId, convId, convModel, botModel);
      case "/model": {
        let list: string[];
        try {
          list = await this.listModels(true);
        } catch (e) {
          return t("runtime.modelListFailed", { error: (e as Error).message });
        }
        if (!arg) {
          const cur = convModel || botModel || this.opts.defaultModel();
          if (!list.length) return t("runtime.modelListEmpty");
          return [t("runtime.modelListHead"), ...list.map((m, i) => `${i + 1}. ${m}${m === cur ? t("runtime.modelCurrent") : ""}`)].join("\n");
        }
        if (arg === "default" || arg === "reset") {
          this.opts.store.setConversationModel(convId, "");
          return t("runtime.modelReset");
        }
        const idx = /^\d+$/.test(arg) ? Number(arg) - 1 : -1;
        const target = idx >= 0 ? list[idx] : list.find((m) => m === arg) ?? list.find((m) => m.endsWith("/" + arg) || m.includes(arg));
        if (!target) return t("runtime.modelNotFound", { name: arg });
        this.opts.store.setConversationModel(convId, target);
        return t("runtime.modelSwitched", { model: target });
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
  const memory = agent.settings(botId).memory.enabled ? agent.memoryPrefix(botId, convId, { mark: true }) : undefined;
  return segmentInput({ place, memory, handoff: agent.takeSeed(convId), text });
}

/** 聊天软件里这一轮关于我的变化（回复后面那几行）；没有就是空串 */
export function aboutMeLines(agent: AgentManager, convId: string, since: number): string {
  const changes = agent.aboutMe?.forConversation(convId, since).changes.filter((h) => h.by === "bot" && !h.undoOf) ?? [];
  return changes
    .map((h) => t(h.op === "delete" ? "aboutMe.removedChannel" : h.op === "edit" ? "aboutMe.changedChannel" : "aboutMe.addedChannel", { line: (h.op === "delete" ? h.before?.text : h.after?.text) ?? "" }))
    .join("\n");
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

/** 上游报的错像是不接受这次的图片（请求形状、不支持图片输入），不是限流、余额或网络 */
export function imageRejection(err: Error & { status?: number; detail?: string }): boolean {
  const text = `${err.message} ${err.detail ?? ""}`;
  if (/rate[ _-]?limit|quota|insufficient|balance|credit|billing|timeout|ECONN|network/i.test(text)) return false;
  if (/image|vision|multi-?modal|content[ _-]?(type|part)|image_url|unsupported.*(input|content)/i.test(text)) return true;
  return [400, 415, 422].includes(Number(err.status));
}

/** 消息里引用的那段（微信的引用）和用户自己写的（去掉引用） */
export function quoteOf(ev: InboundEvent): { quote: string; plain: string } {
  const quote = ev.parts.map((p) => (p.type === "quote" ? p.text : "")).filter(Boolean).join("\n");
  const plain = eventText({ ...ev, parts: ev.parts.filter((p) => p.type !== "quote") });
  return { quote, plain };
}

/** 聊天软件里撤销关于我的那句话 */
const UNDO_WORDS = /^(撤销|撤回|撤銷|undo|取り消し|元に戻す|취소|отменить|deshacer|desfazer)[。.!！]?$/i;

const clipLine = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** /status 里"上一条还在处理"那一行：处理了多久、现在在做什么、多久没动了；steer = 新消息会并入这一轮 */
export function busyLine(since: number, lastProgress: number, steps: ActivityStep[], steer = false): string {
  const now = Date.now();
  const last = steps.at(-1);
  const parts = [t("runtime.busyFor", { d: fmtSecs(now - since) })];
  if (steps.length) parts.push(t("runtime.busySteps", { count: steps.length }));
  if (!lastProgress) parts.push(t("runtime.busyWaitingAgent"));
  else if (last) parts.push(t("runtime.busyNow", { step: clipLine(describeStep(last)) }));
  if (lastProgress && now - lastProgress >= 60_000) parts.push(t("runtime.busyIdle", { d: fmtSecs(now - lastProgress) }));
  return t(steer ? "runtime.busySteer" : "runtime.busyQueue", { parts: parts.join(t("runtime.listSep")) });
}

/** 代理回合失败时给用户的话：中止（/stop、没进展、超时）各说清原因和下一步，进程被重启的另说 */
export function turnFailedText(err: Error, steps: ActivityStep[]): string {
  const last = steps.filter((s) => s.kind !== "error").at(-1);
  const where = last ? t(last.cut || last.status === "running" ? "runtime.stuckAt" : "runtime.lastStep", { step: clipLine(describeStep(last)) }) : "";
  if (err instanceof TurnStopped) {
    // 只中止了这个会话；宽限期内没停下才重启了代理进程（同一机器人的其它会话也被打断）
    const restart = err.restarted ? t("runtime.andRestarted") : "";
    if (err.reason === "user") return t("runtime.stoppedByUser", { d: fmtSecs(err.ms), restarted: err.restarted ? t("runtime.restartedNote") : "" });
    if (err.reason === "idle") return t("runtime.stoppedIdle", { d: fmtSecs(err.ms), restart, where });
    if (err.reason === "permission") {
      const names = err.missing.map((k) => t(k === "screen" ? "runtime.permScreen" : "runtime.permAccessibility"));
      return t("runtime.stoppedPermission", { missing: names.join(t("runtime.listSep")) });
    }
    return t("runtime.stoppedLimit", { d: fmtSecs(err.ms), restart, where });
  }
  if (/runtime (closed|exited)/i.test(err.message)) return t("runtime.runtimeRestarted");
  const proxyHint = localProxyFailureHint(err.message);
  if (proxyHint) return `⚠️ ${proxyHint}`;
  return t("runtime.agentFailed", { error: err.message.slice(0, 300) });
}
