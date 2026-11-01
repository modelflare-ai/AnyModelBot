import type { ChannelCapabilities, ChannelStatus, InboundEvent, Part, ReplySession } from "../../core/types.js";
import { Dedup, KeyedQueue } from "../../core/queue.js";
import type { BotRuntime } from "../../core/runtime.js";
import { HistoryDenied, type FeishuMessageEvent, type FeishuTransport } from "./transport.js";
import { FeishuReply, deliverFeishu } from "./card.js";
import { Outbox, stableId } from "../../core/outbox.js";
import type { Delivery } from "../../core/delivery.js";
import type { Store } from "../../store/db.js";
import { logger } from "../../log.js";
import { t } from "../../i18n/index.js";

/** 离线补消息：只看这么久之内有过来往的会话、这么久之内发的消息，每个会话最多这么多条 */
export const CATCH_UP_ACTIVE_MS = 7 * 86400_000;
export const CATCH_UP_WINDOW_MS = 24 * 3600_000;
export const CATCH_UP_MAX = 20;

export const FEISHU_CAPS: ChannelCapabilities = {
  streaming: true,
  cards: true,
  groups: true,
  mentions: true,
  typing: false,
  maxTextLength: 4000,
  proactiveQuota: false,
};

export function feishuParts(ev: FeishuMessageEvent): Part[] {
  let c: any = {};
  try {
    c = JSON.parse(ev.content || "{}");
  } catch {
    /* ignore */
  }
  switch (ev.messageType) {
    case "text": {
      let t = String(c.text ?? "");
      for (const m of ev.mentions) t = t.replaceAll(m.key, "");
      return [{ type: "text", text: t.trim() }];
    }
    case "post": {
      const blocks = (c.content ?? c.zh_cn?.content ?? []) as any[][];
      const text = blocks
        .map((line) => line.map((n) => (n.tag === "text" || n.tag === "a" ? n.text : "")).join(""))
        .join("\n");
      return [{ type: "text", text: `${c.title ? c.title + "\n" : ""}${text}`.trim() }];
    }
    case "image":
      return [{ type: "image", ref: c.image_key }];
    case "file":
      return [{ type: "file", ref: c.file_key, name: c.file_name }];
    case "audio":
      return [{ type: "voice", ref: c.file_key }];
    default:
      return [{ type: "text", text: t("channel.unsupported_message", { type: ev.messageType }) }];
  }
}

/** 一个机器人对应一个飞书应用（长连接，P1 仅处理单聊）。 */
export class FeishuChannel {
  readonly caps = FEISHU_CAPS;
  status: ChannelStatus = { state: "disabled", since: Date.now() };
  private dedup = new Dedup();
  private log = logger("feishu");
  /** 测试用：等待所有已入队任务 */
  readonly pending = new Set<Promise<void>>();
  /** 出站队列（App 共用一个；没给时用内存库自己建一个） */
  readonly outbox: Outbox;
  /** 主动消息的送达规则（App 设）：对方发消息时，排着的主动消息先发，合成一条摘要 */
  delivery: Delivery | undefined;
  /** 读不了历史消息（离线时漏掉的补不上）：App 显示一条提示；直到读得了之前只提示一次 */
  onHistoryDenied: (() => void) | undefined;
  private unregister: (() => void) | undefined;
  /** 正在补离线时漏掉的消息 */
  private catching: Promise<number> | undefined;
  /** 这个会话的消息交给哪个机器人（app.ts 按 core/routes.ts 设置）；没设置时账号 key 就是机器人 id */
  route: ((chatId: string) => string) | undefined;
  private botOf(chatId: string): string {
    return this.route?.(chatId) ?? this.account;
  }

  constructor(
    private account: string,
    private transport: FeishuTransport,
    private runtime: BotRuntime,
    private queue: KeyedQueue,
    private throttleMs = 400,
    outbox?: Outbox,
    private store?: Store,
  ) {
    if (outbox) this.outbox = outbox;
    else {
      if (!store) throw new Error("FeishuChannel needs an outbox or a store");
      this.outbox = new Outbox(store);
      this.outbox.start();
    }
  }

  async start(): Promise<void> {
    // 上线：出站队列里这个机器人的飞书消息（含上次没发完的）由这里发
    this.unregister ??= this.outbox.register(this.account, "feishu", (row, progress) => deliverFeishu(this.transport, row, progress));
    await this.transport.start(
      (ev) => this.onMessage(ev),
      (state, detail) => {
        this.status = { state, detail, since: Date.now() };
        this.log.info(`bot ${this.account} ws ${state}`, detail ? { detail } : undefined);
        // 连上（启动、断线重连）：长连接不补推离线时的事件，自己去会话历史里补
        if (state === "connected") void this.catchUp().catch((e) => this.log.warn("feishu catch-up failed", { message: (e as Error).message.slice(0, 200) }));
      },
      (a) => this.runtime.cardAction(this.account, a.value, `feishu:${a.operatorOpenId}`),
    );
  }

  async stop(): Promise<void> {
    this.unregister?.();
    this.unregister = undefined;
    await this.transport.stop();
    this.status = { state: "disabled", since: Date.now() };
  }

  /** 同步返回（ack），处理放入每会话串行队列。返回这条是不是第一次见到 */
  onMessage(ev: FeishuMessageEvent): boolean {
    if (!ev.messageId || !this.dedup.firstSeen(ev.messageId)) return false;
    this.markSeen(ev);
    if (ev.chatType !== "p2p") return true; // P1：仅单聊
    const inbound: InboundEvent = {
      id: ev.messageId,
      channel: "feishu",
      botId: this.botOf(ev.chatId),
      account: this.account,
      conversation: { kind: "dm", id: ev.chatId },
      sender: { id: ev.senderOpenId },
      parts: feishuParts(ev),
      mentions: ev.mentions.map((m) => m.openId ?? m.key),
      replyHandle: { messageId: ev.messageId, chatId: ev.chatId },
      ...(ev.rootId || ev.parentId ? { thread: { rootId: ev.rootId, parentId: ev.parentId } } : {}),
      receivedAt: Date.now(),
    };
    // 人在：排着的主动消息（免打扰、每天上限）不用再等，排在这次的回复前面
    const delivery = this.delivery;
    if (delivery) this.outbox.releasePeer("feishu", ev.chatId, (rows) => delivery.combine(rows), this.account);
    // 审批/提问回复在入队前处理（正在进行的回合正等着它）
    // 没处理掉但带 ack 的（前一条还在处理）：先说一声，消息照常入队
    const intercepted = this.runtime.interceptReply(inbound);
    if (intercepted.ack) {
      const ack = new FeishuReply(this.transport, ev.messageId, this.throttleMs, { outbox: this.outbox, botId: this.botOf(ev.chatId), account: this.account, chatId: ev.chatId, key: `${ev.messageId}:ack`, ttlMs: 10 * 60_000 });
      const p = ack.apply({ type: "text", text: intercepted.ack }).catch((e) => this.log.warn("ack failed", { message: (e as Error).message }));
      this.pending.add(p);
      void p.finally(() => this.pending.delete(p));
    }
    if (intercepted.handled) return true;
    const p = this.queue.run(`feishu:${this.account}:${ev.chatId}`, async () => {
      const reply = new FeishuReply(this.transport, ev.messageId, this.throttleMs, { outbox: this.outbox, botId: this.botOf(ev.chatId), account: this.account, chatId: ev.chatId, key: ev.messageId });
      try {
        await this.runtime.handle(inbound, reply);
      } catch (e) {
        this.log.error("handle failed", { message: (e as Error).message });
        await reply.apply({ type: "text", text: t("channel.handle_failed", { message: (e as Error).message }) }).catch(() => {});
      }
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    return true;
  }

  /** 这个会话见到的最后一条消息（离线补消息从它之后开始；存在 KV 里，重启也在） */
  private seenKey(chatId: string): string {
    return `feishu-seen:${this.account}:${chatId}`;
  }
  private seen(chatId: string): { at: number; id: string } | undefined {
    try {
      const v = JSON.parse(this.store?.getKV(this.seenKey(chatId)) || "null");
      return v && Number(v.at) > 0 ? { at: Number(v.at), id: String(v.id ?? "") } : undefined;
    } catch {
      return undefined;
    }
  }
  private markSeen(ev: FeishuMessageEvent): void {
    if (!this.store || !ev.chatId || !(ev.createTime > 0)) return;
    if ((this.seen(ev.chatId)?.at ?? 0) > ev.createTime) return;
    this.store.setKV(this.seenKey(ev.chatId), JSON.stringify({ at: ev.createTime, id: ev.messageId }));
  }

  /**
   * 补离线时漏掉的消息（启动、断线重连时）：飞书长连接不补推离线时发来的事件，从会话历史里取回来，和收到的一样走一遍
   * （去重、准入、群里只认 @ 机器人的规则都照旧）。只看 7 天内有过来往的飞书会话，只取 24 小时内、见到的最后一条之后的，
   * 每个会话最多 20 条。没有读历史消息的权限：记一次日志、提示一次，渠道照常。返回补了几条
   */
  catchUp(now = Date.now()): Promise<number> {
    this.catching ??= this.catchUpOnce(now).finally(() => (this.catching = undefined));
    return this.catching;
  }

  private async catchUpOnce(now: number): Promise<number> {
    const store = this.store;
    const list = this.transport.listMessages?.bind(this.transport);
    if (!store || !list) return 0;
    let fed = 0;
    const convs = store.listAccountConversations(this.account, "feishu").filter((c) => c.updatedAt >= now - CATCH_UP_ACTIVE_MS);
    for (const c of convs) {
      // 见到的最后一条之后；还没记过（升级前的会话）就从最后一次来往之后
      const seen = this.seen(c.peerId);
      const since = Math.max(seen?.at ?? c.updatedAt, now - CATCH_UP_WINDOW_MS);
      let missed: FeishuMessageEvent[];
      try {
        missed = await list(c.peerId, { since, limit: CATCH_UP_MAX, chatType: c.kind === "group" ? "group" : "p2p" });
      } catch (e) {
        if (e instanceof HistoryDenied) {
          this.historyDenied(e.message);
          return fed;
        }
        this.log.warn("feishu catch-up: could not read the chat history", { bot: this.account, message: (e as Error).message.slice(0, 200) });
        continue;
      }
      store.deleteKV(this.deniedKey);
      for (const ev of missed.slice(-CATCH_UP_MAX)) if (ev.messageId !== seen?.id && this.onMessage({ ...ev, chatId: ev.chatId || c.peerId })) fed++;
    }
    if (fed) this.log.info("caught up on feishu messages sent while offline", { bot: this.account, count: fed });
    return fed;
  }

  private get deniedKey(): string {
    return `feishu-history-denied:${this.account}`;
  }

  /** 读不了历史消息：日志和提示各一次（读得了之后再没权限会再提示） */
  private historyDenied(detail: string): void {
    if (this.store?.getKV(this.deniedKey)) return;
    this.store?.setKV(this.deniedKey, String(Date.now()));
    this.log.warn("feishu catch-up: the app may not read chat history; messages sent while offline are not caught up", { bot: this.account, detail: detail.slice(0, 200) });
    this.onHistoryDenied?.();
  }

  /**
   * 主动发到一个飞书会话的回复（代理自己醒来的一轮：后台命令结束）：回复用户最近的那条消息（replyTo 存在会话的 KV 里，重启也在），
   * 和普通回复一样经出站队列，id 由 key 推出。
   */
  followUp(chatId: string, replyTo: string, key: string, botId?: string): ReplySession {
    return new FeishuReply(this.transport, replyTo, this.throttleMs, { outbox: this.outbox, botId: botId ?? this.botOf(chatId), account: this.account, chatId, key });
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    await this.outbox.idle();
  }

  /**
   * 主动发一条通知到单聊会话（余额提醒、使用请求、批准结果）：进出站队列，id 不给时同样的内容一分钟内只发一次。
   * 传输层不支持主动发消息时返回 false。
   */
  notify(chatId: string, text: string, id?: string): boolean {
    if (!this.transport.sendText) return false;
    const key = id ?? `notice:${this.account}:feishu:${stableId(`${chatId}:${text}`, Math.floor(Date.now() / 60_000), 16)}`;
    void this.outbox.send({ id: key, botId: this.botOf(chatId), account: this.account, channel: "feishu", peerId: chatId, kind: "notice", body: { text } });
    return true;
  }
}
