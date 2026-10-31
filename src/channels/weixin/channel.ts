import type { ChannelCapabilities, ChannelStatus, InboundEvent, OutboundOp, Part, ReplySession } from "../../core/types.js";
import { splitText } from "../../core/types.js";
import { Dedup, KeyedQueue } from "../../core/queue.js";
import type { BotRuntime } from "../../core/runtime.js";
import type { Store } from "../../store/db.js";
import { IlinkClient, MessageItemType, MessageType, WeixinApiError, hasDownloadableMedia, type InboundMedia, type MessageItem, type WeixinMessage } from "./api.js";
import { StreamingMarkdownFilter } from "./markdown-filter.js";
import { WeixinQuota } from "./quota.js";
import { logger } from "../../log.js";

export const WEIXIN_CAPS: ChannelCapabilities = {
  streaming: false,
  cards: false,
  groups: false,
  mentions: false,
  typing: true,
  maxTextLength: 4000,
  proactiveQuota: true,
};

export const SESSION_PAUSE_MS = 60 * 60_000;

export function filterMarkdown(text: string): string {
  const f = new StreamingMarkdownFilter();
  return (f.feed(text) + f.flush()).trim();
}

/** 媒体下载结果，按条目对象对应（含 ref_msg 里被引用的条目） */
export type WeixinMediaResults = Map<MessageItem, InboundMedia | Error>;

function mediaPart(it: MessageItem, got: InboundMedia | Error | undefined, quoted: boolean): Part {
  const type = it.type === MessageItemType.IMAGE ? "image" : it.type === MessageItemType.FILE ? "file" : "video";
  const part: Part = { type, ...(type === "file" ? { name: it.file_item?.file_name } : {}), ...(quoted ? { quoted: true } : {}) };
  if (got instanceof Error) return { ...part, error: got.message.slice(0, 120) };
  if (got) return { ...part, data: got.data, ...(got.mime ? { mime: got.mime } : {}) };
  return part;
}

export function weixinParts(items: MessageItem[] | undefined, media?: WeixinMediaResults): Part[] {
  const parts: Part[] = [];
  for (const it of items ?? []) {
    switch (it.type) {
      case MessageItemType.TEXT: {
        const t = it.text_item?.text ?? "";
        const quoted = it.ref_msg?.message_item;
        // 引用了一张图片/一个文件：把它本身交给运行时，而不是只给标题
        if (quoted && hasDownloadableMedia(quoted)) parts.push(mediaPart(quoted, media?.get(quoted), true));
        else {
          const ref = quoted?.text_item?.text || it.ref_msg?.title;
          if (ref) parts.push({ type: "quote", text: ref });
        }
        if (t) parts.push({ type: "text", text: t });
        break;
      }
      case MessageItemType.VOICE:
        parts.push({ type: "voice", transcript: it.voice_item?.text });
        break;
      case MessageItemType.IMAGE:
      case MessageItemType.FILE:
      case MessageItemType.VIDEO:
        parts.push(mediaPart(it, media?.get(it), false));
        break;
    }
  }
  return parts;
}

/** 消息里需要下载的条目（含被引用的） */
function mediaItems(items: MessageItem[] | undefined): MessageItem[] {
  return (items ?? []).flatMap((it) => [it, ...(it.ref_msg?.message_item ? [it.ref_msg.message_item] : [])]).filter(hasDownloadableMedia);
}

/**
 * 微信回复会话：不流式；生成期间只显示“正在输入”（每 5 秒续期），结束时一次性发送最终回复（>4000 字切分），遵守配额。
 * 不发送工具调用进度；只有最终回复、审批/提问提示和交付文件会成为聊天消息，配额全部留给它们。
 */
export class WeixinReply implements ReplySession {
  private ticket: string | undefined;
  private typingTimer: NodeJS.Timeout | undefined;
  private typingOn = false;
  private chain: Promise<void> = Promise.resolve();
  readonly sent: string[] = [];
  private log = logger("weixin.reply");

  constructor(
    private client: IlinkClient,
    private userId: string,
    private contextToken: string,
    private quota: WeixinQuota,
  ) {}

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  async apply(op: OutboundOp): Promise<void> {
    switch (op.type) {
      case "typing":
        this.typingOn = op.on;
        return this.typing(op.on);
      case "stream.start":
      case "stream.update":
        return;
      case "stream.finish":
      case "text":
        return this.enqueue(() => this.send(op.text));
      case "file":
        return this.enqueue(async () => {
          if (this.quota.remaining(this.userId) <= 0) {
            this.log.warn("weixin quota exhausted, file dropped", { userId: this.userId });
            return;
          }
          try {
            // 上传失败不占配额；发送串行，先查后扣不会超发
            await this.client.sendMedia(this.userId, op.path, this.contextToken);
            this.quota.tryConsume(this.userId);
            this.sent.push(`[文件] ${op.name}`);
          } catch (e) {
            this.log.warn("weixin media send failed", { name: op.name, message: (e as Error).message.slice(0, 200) });
            if (this.quota.tryConsume(this.userId)) {
              const t = `⚠️ 文件「${op.name}」发送失败，可在工作区中查看。`;
              await this.client.sendText(this.userId, t, this.contextToken);
              this.sent.push(t);
            }
          }
        });
      case "interactive": {
        const text = op.requestId
          ? op.prompt // 代理请求：提示里已含编号/回复方式
          : `${op.prompt}${op.options?.length ? "\n" + op.options.map((o, i) => `${i + 1}. ${o}`).join("\n") + "\n（回复编号选择）" : ""}`;
        return this.enqueue(async () => {
          await this.send(text, { raw: !!op.requestId });
          if (this.typingOn) await this.typing(true);
        });
      }
    }
  }

  private async typing(on: boolean): Promise<void> {
    try {
      if (on) {
        this.ticket ??= await this.client.getTypingTicket(this.userId, this.contextToken);
        if (!this.ticket) return;
        await this.client.sendTyping(this.userId, this.ticket, true);
        // 输入状态会过期，生成较久时每 5 秒续一次
        this.typingTimer ??= setInterval(() => {
          if (this.ticket) void this.client.sendTyping(this.userId, this.ticket, true).catch(() => {});
        }, 5000);
      } else {
        if (this.typingTimer) clearInterval(this.typingTimer);
        this.typingTimer = undefined;
        if (this.ticket) await this.client.sendTyping(this.userId, this.ticket, false);
      }
    } catch (e) {
      this.log.debug("typing failed", { message: (e as Error).message });
    }
  }

  private async send(text: string, o: { raw?: boolean; maxChunks?: number } = {}): Promise<void> {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = undefined;
    }
    let chunks = splitText(o.raw ? text.trim() : filterMarkdown(text), WEIXIN_CAPS.maxTextLength);
    if (o.maxChunks) chunks = chunks.slice(0, o.maxChunks);
    const budget = this.quota.remaining(this.userId);
    if (budget <= 0) {
      this.log.warn("weixin quota exhausted, reply dropped", { userId: this.userId });
      return;
    }
    let toSend = chunks;
    if (chunks.length > budget) {
      toSend = chunks.slice(0, budget);
      const note = "\n\n…（回复过长，已达到本轮可发送条数上限，请回复任意消息继续）";
      toSend[budget - 1] = toSend[budget - 1].slice(0, WEIXIN_CAPS.maxTextLength - note.length) + note;
    }
    for (const c of toSend) {
      if (!this.quota.tryConsume(this.userId)) break;
      await this.client.sendText(this.userId, c, this.contextToken);
      this.sent.push(c);
    }
  }
}

/** 微信 iLink 渠道：getupdates 长轮询 → 每用户串行队列 → 运行时。 */
export class WeixinChannel {
  readonly caps = WEIXIN_CAPS;
  status: ChannelStatus = { state: "disabled", since: Date.now() };
  private client: IlinkClient | undefined;
  private abort: AbortController | undefined;
  private loop: Promise<void> | undefined;
  private dedup = new Dedup();
  private log = logger("weixin");
  readonly quota: WeixinQuota;
  readonly pending = new Set<Promise<void>>();
  /** -14 会话过期时的通知回调（UI/日志） */
  onExpired: ((botId: string) => void) | undefined;

  constructor(
    private botId: string,
    private store: Store,
    private runtime: BotRuntime,
    private queue: KeyedQueue,
    private opts: { fetchImpl?: typeof fetch; cdnBaseUrl?: string; pollTimeoutMs?: number; retryDelayMs?: number; backoffMs?: number } = {},
  ) {
    this.quota = new WeixinQuota(store, botId);
  }

  get running(): boolean {
    return !!this.loop;
  }

  start(): void {
    if (this.loop) return;
    const acct = this.store.getWeixinAccount(this.botId);
    if (!acct) {
      this.status = { state: "login_required", detail: "尚未扫码登录", since: Date.now() };
      return;
    }
    this.client = new IlinkClient({ baseUrl: acct.baseUrl, token: acct.botToken, fetchImpl: this.opts.fetchImpl, cdnBaseUrl: this.opts.cdnBaseUrl });
    this.abort = new AbortController();
    this.loop = this.run(this.abort.signal).finally(() => (this.loop = undefined));
  }

  /**
   * 主动提醒：发给扫码登录的那个微信用户。需要他最近发过消息（有 context_token），
   * 并占用同一份回复配额；没有可用配额时放弃，返回 false。
   */
  async notifyOwner(text: string): Promise<boolean> {
    return this.notify(this.store.getWeixinAccount(this.botId)?.ownerUserId ?? "", text);
  }

  /** 主动发给某个微信用户（如重启后的提醒）：同样要有他最近的 context_token、占用同一份回复配额；发不出去返回 false */
  async notify(userId: string, text: string): Promise<boolean> {
    const peer = userId ? this.store.getWeixinPeer(this.botId, userId) : undefined;
    if (!this.client || !peer?.contextToken || !this.quota.tryConsume(userId)) return false;
    await this.client.sendText(userId, text, peer.contextToken);
    return true;
  }

  /** 主动发到一个微信会话（代理自己醒来的一轮）：用这个用户最近的 context_token，占同一份回复配额；登录不在时没有 */
  replyTo(userId: string): ReplySession | undefined {
    const token = this.store.getWeixinPeer(this.botId, userId)?.contextToken;
    return this.client && token ? new WeixinReply(this.client, userId, token, this.quota) : undefined;
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.loop?.catch(() => {});
    this.loop = undefined;
    if (this.status.state !== "expired") this.status = { state: "disabled", since: Date.now() };
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        r();
      }, { once: true });
    });
  }

  private async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
    this.status = { state: "connecting", since: Date.now() };
    while (!signal.aborted) {
      const acct = this.store.getWeixinAccount(this.botId);
      if (!acct) {
        this.status = { state: "login_required", detail: "尚未扫码登录", since: Date.now() };
        return;
      }
      if (acct.pausedUntil > Date.now()) {
        this.status = { state: "expired", detail: "登录已过期（-14），请在界面重新扫码", since: Date.now() };
        await this.sleep(Math.min(acct.pausedUntil - Date.now(), 60_000), signal);
        continue;
      }
      try {
        const resp = await this.client!.getUpdates(acct.cursor, this.opts.pollTimeoutMs ?? 35_000, signal);
        failures = 0;
        if (this.status.state !== "connected") this.status = { state: "connected", since: Date.now() };
        if (resp.get_updates_buf) this.store.setWeixinCursor(this.botId, resp.get_updates_buf);
        for (const m of resp.msgs ?? []) this.onMessage(m);
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof WeixinApiError && e.sessionExpired) {
          this.log.warn(`bot ${this.botId}: iLink session expired (-14), pausing 1h; re-login required`);
          this.store.setWeixinPaused(this.botId, Date.now() + SESSION_PAUSE_MS);
          this.status = { state: "expired", detail: "登录已过期（-14），请在界面重新扫码", since: Date.now() };
          this.onExpired?.(this.botId);
          continue;
        }
        failures++;
        this.status = { state: "error", detail: (e as Error).message, since: Date.now() };
        this.log.warn("getupdates failed", { failures, message: (e as Error).message });
        await this.sleep(failures >= 3 ? this.opts.backoffMs ?? 30_000 : this.opts.retryDelayMs ?? 2000, signal);
        if (failures >= 3) failures = 0;
      }
    }
  }

  onMessage(m: WeixinMessage): void {
    if (m.message_type !== MessageType.USER || !m.from_user_id) return;
    const id = String(m.message_id ?? m.client_id ?? `${m.from_user_id}:${m.seq}:${m.create_time_ms}`);
    if (!this.dedup.firstSeen(id)) return;
    const userId = m.from_user_id;
    const peer = this.quota.onInbound(userId, m.context_token ?? "");
    const ev: InboundEvent = {
      id,
      channel: "weixin",
      botId: this.botId,
      conversation: { kind: "dm", id: userId },
      sender: { id: userId },
      parts: weixinParts(m.item_list),
      replyHandle: { contextToken: peer.contextToken },
      receivedAt: Date.now(),
    };
    // 审批/提问回复不能排在正在等待审批的回合后面（会死锁），在入队前处理
    // 没处理掉但带 ack 的（前一条还在处理）：先说一声，消息照常入队
    const intercepted = this.runtime.interceptReply(ev);
    if (intercepted.ack) {
      const ack = new WeixinReply(this.client!, userId, peer.contextToken, this.quota);
      const p = ack.apply({ type: "text", text: intercepted.ack }).catch((e) => this.log.warn("ack failed", { message: (e as Error).message }));
      this.pending.add(p);
      void p.finally(() => this.pending.delete(p));
    }
    if (intercepted.handled) return;
    const media = mediaItems(m.item_list);
    const p = this.queue.run(`weixin:${this.botId}:${userId}`, async () => {
      const reply = new WeixinReply(this.client!, userId, this.store.getWeixinPeer(this.botId, userId)?.contextToken ?? peer.contextToken, this.quota);
      try {
        if (media.length) ev.parts = weixinParts(m.item_list, await this.download(media));
        await this.runtime.handle(ev, reply);
      } catch (e) {
        this.log.error("handle failed", { message: (e as Error).message });
        await reply.apply({ type: "text", text: `⚠️ 处理失败：${(e as Error).message}` }).catch(() => {});
      }
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** 逐个下载解密；失败的记下原因（消息照常处理，文字里会说明没下载成功） */
  private async download(items: MessageItem[]): Promise<WeixinMediaResults> {
    const out: WeixinMediaResults = new Map();
    for (const it of items) {
      try {
        out.set(it, await this.client!.downloadMedia(it));
      } catch (e) {
        this.log.warn("weixin media download failed", { type: it.type, message: (e as Error).message.slice(0, 200) });
        out.set(it, e as Error);
      }
    }
    return out;
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
}
