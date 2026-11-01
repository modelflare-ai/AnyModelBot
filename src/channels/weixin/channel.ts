import crypto from "node:crypto";
import type { ChannelCapabilities, ChannelStatus, InboundEvent, OutboundOp, Part, ReplySession } from "../../core/types.js";
import { splitText } from "../../core/types.js";
import { Dedup, KeyedQueue } from "../../core/queue.js";
import type { BotRuntime } from "../../core/runtime.js";
import type { OutboxBody, OutboxKind, OutboxRow, Store } from "../../store/db.js";
import { Gone, Held, Later, Outbox, ReplyIds, sentText, stableId, type HeldGroup } from "../../core/outbox.js";
import { IlinkClient, MessageItemType, MessageType, WeixinApiError, hasDownloadableMedia, type InboundMedia, type MessageItem, type WeixinMessage } from "./api.js";
import { StreamingMarkdownFilter } from "./markdown-filter.js";
import { WeixinQuota } from "./quota.js";
import type { Delivery } from "../../core/delivery.js";
import { logger } from "../../log.js";
import { t, t as tr, tl } from "../../i18n/index.js";

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

const deliverLog = logger("weixin.send");
/** 回复太长、本轮配额不够时，最后一条末尾的说明 */
const overQuotaNote = () => "\n\n" + tr("channel.reply_truncated");
/** 文件临时发不出去（网络、CDN 5xx）时先重试这么多次，再改发一句"发送失败" */
const MEDIA_RETRIES = 2;
/** ack、审批提示：过一会儿就没意义了，发不出去不必一直等 */
export const SHORT_TTL_MS = 10 * 60_000;

/** 网络断开、超时、5xx 这类过一会儿可能就好的错误（本地文件读不了、平台拒绝、CDN 4xx 不算） */
function transient(e: unknown): boolean {
  const x = e as { rejected?: boolean; fatal?: boolean; syscall?: string };
  if (x?.rejected || x?.fatal) return false;
  return !(x?.syscall && ["open", "read", "stat", "scandir"].includes(x.syscall));
}

/**
 * 这条能用几条配额：主动消息（任务结果、续期提醒…）用全部剩下的；聊天回复要给主动消息留出 reserved 条（core/delivery.ts）
 */
function budgetOf(quota: WeixinQuota, userId: string, row: Pick<OutboxRow, "purpose">): number {
  const left = quota.remaining(userId);
  return row.purpose ? left : left - quota.reserved(userId);
}

/** 能不能给这个人发：要有会话凭证、24 小时窗口没过、还有配额；不能就留着（Held），等他下次发消息；返回凭证 */
function reachable(quota: WeixinQuota, userId: string, row: Pick<OutboxRow, "purpose">): string {
  const peer = quota.peer(userId);
  if (!peer?.contextToken) throw new Held(tr("channel.heldNoToken"), "no_token");
  if (!quota.open(userId)) throw new Held(tr("channel.heldWindowClosed"), "window_closed");
  if (quota.remaining(userId) <= 0) throw new Held(tr("channel.heldQuota"), "quota");
  if (budgetOf(quota, userId, row) <= 0) throw new Held(tr("channel.heldReserved"), "quota");
  return peer.contextToken;
}

/** 留着的消息在对方下次发消息时送达，开头加上这句 */
/** 合并发出的「你不在时」那条的开头（按当前语言）；去掉它时两种语言的都认 */
export const awayPrefix = () => tr("channel.awayPrefix");
const stripAway = (s: string) => {
  for (const p of [tl("zh-CN", "channel.awayPrefix"), tl("en", "channel.awayPrefix")]) if (s.startsWith(p)) return s.slice(p.length);
  return s;
};

/**
 * 对方又发消息了，留着给他的消息怎么发（Outbox.release 的 combine）：相邻的文字合成一条「你不在时：…」（一条微信放得下就合），
 * 文件和发了一半的长回复照原样发，顺序不变。
 */
export function combineHeld(rows: OutboxRow[]): HeldGroup[] {
  const groups: HeldGroup[] = [];
  let cur: { rows: OutboxRow[]; texts: string[]; len: number } | undefined;
  const flush = () => {
    if (cur) groups.push({ rows: cur.rows, body: { text: awayPrefix() + (cur.texts.length > 1 ? "\n" : "") + cur.texts.join("\n\n"), raw: true, away: true } });
    cur = undefined;
  };
  for (const r of rows) {
    const raw = r.body.text ?? "";
    if (r.kind === "file" || r.progress > 0 || !raw.trim()) {
      flush();
      groups.push({ rows: [r] });
      continue;
    }
    // 已经合成过的（又被留着）不再加前缀；Markdown 先按微信的规则过滤掉，合成的那条原样发
    const text = r.body.away ? stripAway(raw).trim() : r.body.raw ? raw.trim() : filterMarkdown(raw);
    if (cur && cur.len + 2 + text.length > WEIXIN_CAPS.maxTextLength) flush();
    cur ??= { rows: [], texts: [], len: awayPrefix().length };
    cur.rows.push(r);
    cur.texts.push(text);
    cur.len += 2 + text.length;
  }
  flush();
  return groups;
}

/**
 * 把一条出站记录发到微信：文本按 4000 字切分，配额不够时截断并在末尾说明；文件走 CDN，发不出去改发一句说明。
 * 发送成功才扣配额（出站队列按会话一条一条发，先查后扣不会超发）；每段带确定的 client_id。
 */
export async function deliverWeixin(client: IlinkClient, quota: WeixinQuota, row: OutboxRow, progress: (n: number) => void, retry = true): Promise<void> {
  const user = row.peerId;
  const token = reachable(quota, user, row);
  if (row.kind === "file") {
    const name = row.body.name ?? tr("channel.fileFallback");
    if (row.progress === 0) {
      try {
        // 上传失败不占配额
        await client.sendMedia(user, row.body.path ?? "", token, stableId(row.id, 0));
        quota.tryConsume(user);
        return;
      } catch (e) {
        if (retry && transient(e) && row.attempts < MEDIA_RETRIES) throw e;
        deliverLog.warn("weixin media send failed", { name, message: (e as Error).message.slice(0, 200) });
      }
      progress(1);
    }
    await client.sendText(user, tr("channel.file_failed", { name }), token, stableId(row.id, 1));
    quota.tryConsume(user);
    return;
  }
  const text = sentText(row.body);
  const chunks = splitText(row.body.raw ? text.trim() : filterMarkdown(text), WEIXIN_CAPS.maxTextLength);
  let rest = chunks.slice(row.progress);
  const budget = budgetOf(quota, user, row);
  if (rest.length > budget) {
    rest = rest.slice(0, budget);
    const note = overQuotaNote();
    rest[budget - 1] = rest[budget - 1].slice(0, WEIXIN_CAPS.maxTextLength - note.length) + note;
  }
  for (let i = 0; i < rest.length; i++) {
    const n = row.progress + i;
    await client.sendText(user, rest[i], token, stableId(row.id, n));
    quota.tryConsume(user);
    progress(n + 1);
  }
}

/** 回复会话把消息交给出站队列需要的东西：key 由入站消息推出（同一条入站的第 n 条回复 id 固定） */
export interface WeixinOutbox {
  outbox: Outbox;
  botId: string;
  account?: string;
  key: string;
  ttlMs?: number;
}

/**
 * 微信回复会话：不流式；生成期间只显示“正在输入”（每 5 秒续期），结束时一次性发送最终回复（>4000 字切分），遵守配额。
 * 不发送工具调用进度；只有最终回复、审批/提问提示和交付文件会成为聊天消息，配额全部留给它们。
 * 这些消息先写进出站队列（持久化、按会话排队、失败重试），没给队列时（单元测试）直接发。
 */
export class WeixinReply implements ReplySession {
  private ticket: string | undefined;
  private typingTimer: NodeJS.Timeout | undefined;
  private typingOn = false;
  private chain: Promise<void> = Promise.resolve();
  private ids = new ReplyIds();
  private log = logger("weixin.reply");

  constructor(
    private client: IlinkClient,
    private userId: string,
    private contextToken: string,
    private quota: WeixinQuota,
    private out?: WeixinOutbox,
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
      case "stream.finish": {
        const role = this.ids.final();
        return this.enqueue(() => this.post("text", { text: op.text }, role));
      }
      case "text":
        // ack（"收到，这条会并入…"）过一会儿就没意义了，发不出去不必一直等
        return this.enqueue(() => this.post("text", { text: op.text }, this.ids.of(op.ack ? "ack" : "text", op.text), op.ack ? SHORT_TTL_MS : undefined));
      case "file":
        return this.enqueue(() => this.post("file", { path: op.path, name: op.name }, this.ids.of("file", op.path)));
      case "interactive": {
        const text = op.requestId
          ? op.prompt // 代理请求：提示里已含编号/回复方式
          : `${op.prompt}${op.options?.length ? "\n" + op.options.map((o, i) => `${i + 1}. ${o}`).join("\n") + "\n" + t("channel.reply_with_number") : ""}`;
        return this.enqueue(async () => {
          await this.post("text", { text, raw: !!op.requestId }, this.ids.of("prompt", op.requestId ?? text), SHORT_TTL_MS);
          if (this.typingOn) await this.typing(true);
        });
      }
    }
  }

  /** 交给出站队列（先落库再发，等第一次发送结束）；没有队列就直接发 */
  private async post(kind: OutboxKind, body: OutboxBody, role: string, ttlMs?: number): Promise<void> {
    if (kind === "text" && this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = undefined;
    }
    if (this.out) {
      const { outbox, botId, account, key } = this.out;
      await outbox.send({ id: `wx:${botId}:${key}:${role}`, botId, account, channel: "weixin", peerId: this.userId, kind, body, ttlMs: ttlMs ?? this.out.ttlMs });
      return;
    }
    const row = { id: crypto.randomUUID(), peerId: this.userId, kind, body, progress: 0, attempts: 0 } as OutboxRow;
    try {
      await deliverWeixin(this.client, this.quota, row, () => {}, false);
    } catch (e) {
      if (!(e instanceof Gone) && !(e instanceof Held)) throw e;
      this.log.warn("weixin reply dropped", { userId: this.userId, reason: e.message });
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
}

/** 微信 iLink 渠道：getupdates 长轮询 → 每用户串行队列 → 运行时。 */
export class WeixinChannel {
  readonly caps = WEIXIN_CAPS;
  private st: ChannelStatus = { state: "disabled", since: Date.now() };

  /** 尚未扫码、登录过期的说明读的时候再翻译（界面换了语言跟着变） */
  get status(): ChannelStatus {
    if (this.st.state === "login_required") return { ...this.st, detail: t("channel.wx_login_required") };
    if (this.st.state === "expired") return { ...this.st, detail: t("channel.wx_expired") };
    return this.st;
  }
  private client: IlinkClient | undefined;
  private abort: AbortController | undefined;
  private loop: Promise<void> | undefined;
  private dedup = new Dedup();
  private log = logger("weixin");
  readonly quota: WeixinQuota;
  readonly pending = new Set<Promise<void>>();
  /** 出站队列（App 共用一个；单独构造时自己建一个） */
  readonly outbox: Outbox;
  private unregister: (() => void) | undefined;
  /** -14 会话过期时的通知回调（UI/日志） */
  onExpired: ((botId: string) => void) | undefined;

  constructor(
    private account: string,
    private store: Store,
    private runtime: BotRuntime,
    private queue: KeyedQueue,
    private opts: { fetchImpl?: typeof fetch; cdnBaseUrl?: string; pollTimeoutMs?: number; retryDelayMs?: number; backoffMs?: number; outbox?: Outbox; delivery?: Delivery } = {},
  ) {
    this.quota = new WeixinQuota(store, account);
    // 聊天回复给主动消息（进行中的任务的结果等）留出配额
    const delivery = opts.delivery;
    if (delivery) this.quota.reserver = (userId) => delivery.reserved(this.botOf(userId), "weixin", userId);
    if (opts.outbox) this.outbox = opts.outbox;
    else {
      this.outbox = new Outbox(store);
      this.outbox.start();
    }
  }

  /** 这个人的消息交给哪个机器人（app.ts 按 core/routes.ts 设置）；没设置时账号 key 就是机器人 id */
  route: ((userId: string) => string) | undefined;
  private botOf(userId: string): string {
    return this.route?.(userId) ?? this.account;
  }

  get running(): boolean {
    return !!this.loop;
  }

  start(): void {
    if (this.loop) return;
    const acct = this.store.getWeixinAccount(this.account);
    if (!acct) {
      this.st = { state: "login_required", since: Date.now() };
      return;
    }
    this.client = new IlinkClient({ baseUrl: acct.baseUrl, token: acct.botToken, fetchImpl: this.opts.fetchImpl, cdnBaseUrl: this.opts.cdnBaseUrl });
    this.abort = new AbortController();
    this.loop = this.run(this.abort.signal).finally(() => (this.loop = undefined));
    // 上线：出站队列里这个机器人的微信消息（含上次没发完的）由这里发
    this.unregister = this.outbox.register(this.account, "weixin", (row, progress) => this.deliver(row, progress));
  }

  private async deliver(row: OutboxRow, progress: (n: number) => void): Promise<void> {
    if (!this.client) throw new Later(tr("channel.laterNotRunning"));
    if ((this.store.getWeixinAccount(this.account)?.pausedUntil ?? 0) > Date.now()) throw new Later(tr("channel.laterExpired"));
    try {
      await deliverWeixin(this.client, this.quota, row, progress);
    } catch (e) {
      if (e instanceof WeixinApiError && e.sessionExpired) throw new Later(tr("channel.laterExpired"));
      throw e;
    }
  }

  /**
   * 主动给某人发一条通知（使用请求、批准结果、余额提醒）：要他最近 24 小时内发过消息、还有配额，否则返回 false。
   * 进出站队列（同一 id 只发一次），占用他的回复配额。
   */
  tell(userId: string, text: string, id: string): boolean {
    if (!this.client || !this.quota.open(userId) || this.quota.remaining(userId) <= 0) return false;
    void this.outbox.send({ id, botId: this.botOf(userId), account: this.account, channel: "weixin", peerId: userId, kind: "notice", body: { text, raw: true } });
    return true;
  }

  /** 主动发给某个微信用户（余额提醒、重启后的提醒）：同 tell；同样的内容一分钟内只发一次 */
  async notify(userId: string, text: string): Promise<boolean> {
    return !!userId && this.tell(userId, text, `notice:${this.account}:weixin:${stableId(`${userId}:${text}`, Math.floor(Date.now() / 60_000), 16)}`);
  }

  /** 主动提醒：发给扫码登录的那个微信用户 */
  async notifyOwner(text: string): Promise<boolean> {
    return this.notify(this.store.getWeixinAccount(this.account)?.ownerUserId ?? "", text);
  }

  /**
   * 主动发到一个微信会话的回复（代理自己醒来的一轮：后台命令结束）：和普通回复一样经出站队列，id 由 key 推出；
   * 会话凭证、24 小时窗口和配额在发送时才查（deliverWeixin），发不出去就留着，等对方下次发消息时先发。
   */
  followUp(userId: string, key: string, botId?: string): ReplySession {
    const token = this.store.getWeixinPeer(this.account, userId)?.contextToken ?? "";
    return new WeixinReply(this.client!, userId, token, this.quota, { outbox: this.outbox, botId: botId ?? this.botOf(userId), account: this.account, key });
  }

  async stop(): Promise<void> {
    this.unregister?.();
    this.unregister = undefined;
    this.abort?.abort();
    await this.loop?.catch(() => {});
    this.loop = undefined;
    if (this.st.state !== "expired") this.st = { state: "disabled", since: Date.now() };
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
    this.st = { state: "connecting", since: Date.now() };
    while (!signal.aborted) {
      const acct = this.store.getWeixinAccount(this.account);
      if (!acct) {
        this.st = { state: "login_required", since: Date.now() };
        return;
      }
      if (acct.pausedUntil > Date.now()) {
        this.st = { state: "expired", since: Date.now() };
        await this.sleep(Math.min(acct.pausedUntil - Date.now(), 60_000), signal);
        continue;
      }
      try {
        const resp = await this.client!.getUpdates(acct.cursor, this.opts.pollTimeoutMs ?? 35_000, signal);
        failures = 0;
        if (this.st.state !== "connected") this.st = { state: "connected", since: Date.now() };
        if (resp.get_updates_buf) this.store.setWeixinCursor(this.account, resp.get_updates_buf);
        for (const m of resp.msgs ?? []) this.onMessage(m);
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof WeixinApiError && e.sessionExpired) {
          this.log.warn(`bot ${this.account}: iLink session expired (-14), pausing 1h; re-login required`);
          this.store.setWeixinPaused(this.account, Date.now() + SESSION_PAUSE_MS);
          this.st = { state: "expired", since: Date.now() };
          this.onExpired?.(this.account);
          continue;
        }
        failures++;
        this.st = { state: "error", detail: (e as Error).message, since: Date.now() };
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
    const delivery = this.opts.delivery;
    // 回的是续期提醒（「ok」）：先认出来（之后放出留着的消息，最近发的一条就不是提醒了）
    const said = weixinParts(m.item_list).map((p) => (p.type === "text" ? p.text : "")).join("").trim();
    const ack = said ? delivery?.ack(this.botOf(userId), "weixin", userId, said) : undefined;
    const peer = this.quota.onInbound(userId, m.context_token ?? "");
    // 对方又发消息了（24 小时窗口和配额重新开始）：之前留着没发的、排着的主动消息先发，合成一条（「你不在时：…」或摘要），排在这次的回复前面
    const released = this.outbox.releasePeer("weixin", userId, (rows) => (delivery ? delivery.combine(rows) : combineHeld(rows)), this.account);
    if (ack) return this.acked(id, userId, peer.contextToken, said, released ? "" : ack);
    const ev: InboundEvent = {
      id,
      channel: "weixin",
      botId: this.botOf(userId),
      account: this.account,
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
      const ack = new WeixinReply(this.client!, userId, peer.contextToken, this.quota, { outbox: this.outbox, botId: this.botOf(userId), account: this.account, key: `${id}:ack`, ttlMs: SHORT_TTL_MS });
      const p = ack.apply({ type: "text", text: intercepted.ack }).catch((e) => this.log.warn("ack failed", { message: (e as Error).message }));
      this.pending.add(p);
      void p.finally(() => this.pending.delete(p));
    }
    if (intercepted.handled) return;
    const media = mediaItems(m.item_list);
    const p = this.queue.run(`weixin:${this.account}:${userId}`, async () => {
      const reply = new WeixinReply(this.client!, userId, this.store.getWeixinPeer(this.account, userId)?.contextToken ?? peer.contextToken, this.quota, { outbox: this.outbox, botId: this.botOf(userId), account: this.account, key: id });
      try {
        if (media.length) ev.parts = weixinParts(m.item_list, await this.download(media));
        await this.runtime.handle(ev, reply);
      } catch (e) {
        this.log.error("handle failed", { message: (e as Error).message });
        await reply.apply({ type: "text", text: t("channel.handle_failed", { message: (e as Error).message }) }).catch(() => {});
      }
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /**
   * 对方回了续期提醒（「ok」）：窗口已经重新开始，不进模型；记进会话历史，回一句（留着的消息刚放出去时它们就是回应，不再多说）
   */
  private acked(id: string, userId: string, contextToken: string, said: string, text: string): void {
    const conv = this.store.ensureConversation(this.botOf(userId), "weixin", userId);
    if (conv.account !== this.account) this.store.setConversationAccount(conv.id, this.account);
    this.store.addMessage(conv.id, "user", said);
    if (!text) return;
    this.store.addMessage(conv.id, "assistant", text);
    const reply = new WeixinReply(this.client!, userId, contextToken, this.quota, { outbox: this.outbox, botId: this.botOf(userId), account: this.account, key: `${id}:ack` });
    const p = reply.apply({ type: "text", text }).catch((e) => this.log.warn("nudge ack failed", { message: (e as Error).message }));
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
    await this.outbox.idle();
  }
}
