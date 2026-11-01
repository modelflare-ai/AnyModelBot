import type { ChannelStatus, InboundEvent, OutboundOp, Part, ReplySession } from "../../core/types.js";
import { Dedup, KeyedQueue } from "../../core/queue.js";
import type { BotRuntime } from "../../core/runtime.js";
import { Gone, Later, Outbox, ReplyIds, sentText, stableId } from "../../core/outbox.js";
import type { Delivery } from "../../core/delivery.js";
import type { OutboxBody, OutboxKind, OutboxRow } from "../../store/db.js";
import { sniffImageMime } from "../weixin/api.js";
import { logger } from "../../log.js";
import { t, t as tr } from "../../i18n/index.js";
import { splitMarkdown } from "./format.js";
import { PlatformError, type MessengerMessage, type MessengerTransport } from "./transport.js";

/** 改消息的间隔：三个平台里最严的 Telegram 约每秒一次，再留点余量 */
export const EDIT_THROTTLE_MS = 1500;
/** "正在输入"的续期间隔（Telegram 5 秒后消失，Discord 10 秒） */
const TYPING_EVERY_MS = 4500;
/** 文件临时发不出去时先重试这么多次，再改发一句说明 */
const FILE_RETRIES = 2;
/** ack、审批提示：过一会儿就没意义了，发不出去不必一直等 */
const SHORT_TTL_MS = 10 * 60_000;

/** 网络断开、限流这类过一会儿可能就好的错误（平台拒绝、本地文件读不了、文件太大不算） */
function transient(e: unknown): boolean {
  const x = e as { rejected?: boolean; syscall?: string };
  if (x?.rejected) return false;
  return !(x?.syscall && ["open", "read", "stat"].includes(x.syscall)) && !/too large|过大/i.test(String((e as Error)?.message));
}

/**
 * 把一条出站记录发到平台。文字按平台上限切段；有流式显示的那条消息时第一段改写它（改写可以重复做，不会多出消息），
 * 它被删了或太旧改不了就发新的。progress 记下已发出的段数，崩溃重启后从下一段接着发。
 */
export async function deliverMessenger(transport: MessengerTransport, row: OutboxRow, progress: (n: number) => void, retry = true): Promise<void> {
  const b = row.body;
  if (row.kind === "file") {
    const name = b.name ?? tr("channel.fileFallback");
    if (row.progress === 0) {
      try {
        await transport.sendFile(row.peerId, b.path ?? "", name);
        return;
      } catch (e) {
        if (retry && transient(e) && row.attempts < FILE_RETRIES) throw e;
        logger(`${transport.id}.send`).warn("file send failed", { name, message: (e as Error).message.slice(0, 200) });
      }
      progress(1);
    }
    await transport.sendText(row.peerId, tr("channel.file_failed", { name }), stableId(row.id, 1));
    return;
  }
  const chunks = splitMarkdown(sentText(b).trim(), transport.maxText);
  for (let i = row.progress; i < chunks.length; i++) {
    if (i === 0 && b.editId) {
      try {
        await transport.editText(row.peerId, b.editId, chunks[0]);
        progress(1);
        continue;
      } catch (e) {
        if (!(e as PlatformError)?.rejected) throw e;
        logger(`${transport.id}.send`).warn("couldn't edit the live message, sending a new one", { message: (e as Error).message.slice(0, 200) });
      }
    }
    await transport.sendText(row.peerId, chunks[i], stableId(row.id, i));
    progress(i + 1);
  }
}

/** 回复会话把消息交给出站队列需要的东西：key 由入站消息推出（同一条入站的第 n 条回复 id 固定） */
export interface MessengerOutbox {
  outbox: Outbox;
  botId: string;
  key: string;
  ttlMs?: number;
}

/**
 * 回复会话：等第一句话时显示"正在输入"，开始说话后发一条消息、不断改写它（节流），结束时写成最终回复（太长的后面几段发新消息）。
 * 最终回复、文件、提问先写进出站队列（持久化、按会话排队、失败重试）；流式的中间内容不经过它，发不出去就算了。
 * 审批和提问发文字（编号回复），没有按钮。
 */
export class MessengerReply implements ReplySession {
  private messageId: string | undefined;
  private latest = "";
  private shown = "";
  private interim: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private typingTimer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> = Promise.resolve();
  private closed = false;
  private ids = new ReplyIds();
  private log;

  constructor(
    private transport: MessengerTransport,
    private chatId: string,
    private throttleMs: number,
    private out?: MessengerOutbox,
  ) {
    this.log = logger(`${transport.id}.reply`);
  }

  async apply(op: OutboundOp): Promise<void> {
    switch (op.type) {
      case "typing":
        return this.typing(op.on);
      case "stream.start":
        // 没有"正在输入"的平台（Slack）：先发一条占位，不然生成期间对方什么也看不到
        if (!this.transport.typing) {
          this.latest = "…";
          this.schedule();
        }
        return;
      case "stream.update":
        this.latest = op.text;
        this.schedule();
        return;
      case "interim":
        this.interim.push(op.text);
        this.latest = this.interim.join("\n\n");
        this.schedule();
        return;
      case "stream.finish":
        return this.finish(op.text);
      case "text":
        // ack（"收到，这条会并入…"）过一会儿就没意义了，发不出去不必一直等
        return this.post("text", { text: op.text }, this.ids.of(op.ack ? "ack" : "text", op.text), op.ack ? SHORT_TTL_MS : undefined);
      case "file":
        await this.inflight;
        return this.post("file", { path: op.path, name: op.name }, this.ids.of("file", op.path));
      case "interactive": {
        const text = op.requestId
          ? op.prompt // 代理请求：提示里已含编号/回复方式
          : `${op.prompt}${op.options?.length ? "\n" + op.options.map((o, i) => `${i + 1}. ${o}`).join("\n") + "\n" + t("channel.reply_with_number") : ""}`;
        return this.post("text", { text }, this.ids.of("prompt", op.requestId ?? text), SHORT_TTL_MS);
      }
    }
  }

  private async typing(on: boolean): Promise<void> {
    clearInterval(this.typingTimer);
    this.typingTimer = undefined;
    if (!on || !this.transport.typing) return;
    const send = () => void this.transport.typing!(this.chatId).catch((e) => this.log.debug("typing failed", { message: (e as Error).message }));
    send();
    this.typingTimer = setInterval(send, TYPING_EVERY_MS);
    this.typingTimer.unref?.();
  }

  private schedule(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inflight = this.inflight.then(() => this.flush());
    }, this.throttleMs);
  }

  /** 流式显示：放不下时显示最新的部分（最终回复会写全） */
  private async flush(): Promise<void> {
    const max = this.transport.maxText;
    const text = this.latest.length > max ? `…${this.latest.slice(-(max - 1))}` : this.latest;
    if (this.closed || !text.trim() || text === this.shown) return;
    try {
      if (this.messageId) await this.transport.editText(this.chatId, this.messageId, text);
      else this.messageId = await this.transport.sendText(this.chatId, text);
      this.shown = text;
    } catch (e) {
      this.log.warn("live update failed", { message: (e as Error).message.slice(0, 200) });
    }
  }

  private async finish(answer: string): Promise<void> {
    // 最后没再说话时，回复就是中间说的最后一句：不重复
    const before = this.interim.at(-1) === answer ? this.interim.slice(0, -1) : this.interim;
    const text = [...before, answer].filter(Boolean).join("\n\n");
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.inflight;
    await this.typing(false);
    return this.post("text", { text, ...(this.messageId ? { editId: this.messageId } : {}) }, this.ids.final());
  }

  /** 交给出站队列（先落库再发，等第一次发送结束）；没有队列就直接发（单元测试） */
  private async post(kind: OutboxKind, body: OutboxBody, role: string, ttlMs?: number): Promise<void> {
    if (this.out) {
      const { outbox, botId, key } = this.out;
      await outbox.send({ id: `${this.transport.id}:${botId}:${key}:${role}`, botId, channel: this.transport.id, peerId: this.chatId, kind, body, ttlMs: ttlMs ?? this.out.ttlMs });
      return;
    }
    const row = { id: `${role}`, kind, body, peerId: this.chatId, replyTo: "", progress: 0, attempts: 0 } as OutboxRow;
    try {
      await deliverMessenger(this.transport, row, () => {}, false);
    } catch (e) {
      if (!(e instanceof Gone)) throw e;
    }
  }
}

/** 这条消息 → 运行时的 parts：引用的那句、文字、文件（下载好的带 data，失败的带 error） */
export function messengerParts(m: MessengerMessage, got?: Map<MessengerMessage["files"][number], Buffer | Error>): Part[] {
  const parts: Part[] = [];
  if (m.quote) parts.push({ type: "quote", text: m.quote });
  if (m.text) parts.push({ type: "text", text: m.text });
  if (m.unsupported) parts.push({ type: "text", text: t("channel.unsupported_message", { type: m.unsupported }) });
  for (const f of m.files) {
    if (f.type === "voice") {
      parts.push({ type: "voice" });
      continue;
    }
    const base = { type: f.type, ...(f.name ? { name: f.name } : {}) };
    const r = got?.get(f);
    if (r instanceof Error) parts.push({ ...base, error: r.message.slice(0, 120) });
    else if (r) {
      const mime = f.type === "image" ? sniffImageMime(r) : undefined;
      parts.push({ ...base, data: r, ...(mime ? { mime } : {}) });
    } else parts.push(base);
  }
  return parts;
}

/** 一个机器人在一个平台上的渠道：只处理单聊，准入、审批、队列和飞书、微信走同一条路 */
export class MessengerChannel {
  status: ChannelStatus = { state: "disabled", since: Date.now() };
  private dedup = new Dedup();
  private log;
  /** 测试用：等待所有已入队任务 */
  readonly pending = new Set<Promise<void>>();
  /** 主动消息的送达规则（App 设）：对方发消息时，排着的主动消息先发，合成一条摘要 */
  delivery: Delivery | undefined;
  /** 凭据失效，重连也没用：App 显示一条提示 */
  onFatal: ((detail: string) => void) | undefined;
  private unregister: (() => void) | undefined;
  private running = false;

  constructor(
    private botId: string,
    private transport: MessengerTransport,
    private runtime: BotRuntime,
    private queue: KeyedQueue,
    readonly outbox: Outbox,
    private throttleMs = EDIT_THROTTLE_MS,
  ) {
    this.log = logger(transport.id);
  }

  private get id() {
    return this.transport.id;
  }

  async start(): Promise<void> {
    this.running = true;
    // 上线：出站队列里这个机器人在这个平台上的消息（含上次没发完的）由这里发
    this.unregister ??= this.outbox.register(this.botId, this.id, async (row, progress) => {
      if (!this.running) throw new Later(tr("channel.laterNotRunning"));
      await deliverMessenger(this.transport, row, progress);
    });
    await this.transport.start(
      (m) => void this.onMessage(m),
      (state, detail, fatal) => {
        if (state === this.status.state && detail === this.status.detail) return;
        this.status = { state, detail, since: Date.now() };
        this.log.info(`bot ${this.botId} ${state}`, detail ? { detail } : undefined);
        if (fatal) this.onFatal?.(detail ?? "");
      },
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unregister?.();
    this.unregister = undefined;
    await this.transport.stop();
    this.status = { state: "disabled", since: Date.now() };
  }

  /** 同步返回，处理放入每会话串行队列。返回这条是不是第一次见到 */
  onMessage(m: MessengerMessage): boolean {
    if (!m.id || !this.dedup.firstSeen(m.id)) return false;
    // 群聊不处理：准入规则还没有定（access.ts 对群是放行的，所以不能往下走）
    if (!m.dm) return true;
    const ev: InboundEvent = {
      id: m.id,
      channel: this.id,
      botId: this.botId,
      conversation: { kind: "dm", id: m.chatId },
      sender: { id: m.senderId, ...(m.senderName ? { name: m.senderName } : {}) },
      parts: messengerParts(m),
      replyHandle: { messageId: m.id, chatId: m.chatId },
      receivedAt: Date.now(),
    };
    // 人在：排着的主动消息（免打扰、每天上限）不用再等，排在这次的回复前面
    const delivery = this.delivery;
    if (delivery) this.outbox.release(this.botId, this.id, m.chatId, (rows) => delivery.combine(rows));
    // 审批/提问回复、准入在入队前处理（正在进行的回合正等着它）；没处理掉但带 ack 的：先说一声，消息照常入队
    const intercepted = this.runtime.interceptReply(ev);
    if (intercepted.ack) {
      const ack = this.reply(m.chatId, `${m.id}:ack`, SHORT_TTL_MS);
      this.track(ack.apply({ type: "text", text: intercepted.ack }).catch((e) => this.log.warn("ack failed", { message: (e as Error).message })));
    }
    if (intercepted.handled) return true;
    this.track(
      this.queue.run(`${this.id}:${this.botId}:${m.chatId}`, async () => {
        const reply = this.reply(m.chatId, m.id);
        try {
          if (m.files.length) ev.parts = messengerParts(m, await this.download(m));
          await this.runtime.handle(ev, reply);
        } catch (e) {
          this.log.error("handle failed", { message: (e as Error).message });
          await reply.apply({ type: "text", text: t("channel.handle_failed", { message: (e as Error).message }) }).catch(() => {});
        }
      }),
    );
    return true;
  }

  private reply(chatId: string, key: string, ttlMs?: number): MessengerReply {
    return new MessengerReply(this.transport, chatId, this.throttleMs, { outbox: this.outbox, botId: this.botId, key, ttlMs });
  }

  private track(p: Promise<void>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** 逐个下载；失败的记下原因（消息照常处理，文字里会说明没下载成功） */
  private async download(m: MessengerMessage): Promise<Map<MessengerMessage["files"][number], Buffer | Error>> {
    const out = new Map<MessengerMessage["files"][number], Buffer | Error>();
    for (const f of m.files) {
      if (f.type === "voice") continue;
      try {
        out.set(f, await f.download());
      } catch (e) {
        this.log.warn("file download failed", { type: f.type, message: (e as Error).message.slice(0, 200) });
        out.set(f, e as Error);
      }
    }
    return out;
  }

  /** 代理自己醒来的一轮（后台命令结束）：和普通回复一样经出站队列，id 由 key 推出 */
  followUp(chatId: string, key: string): ReplySession {
    return this.reply(chatId, key);
  }

  /** 主动发一条通知到单聊（使用请求、批准结果、余额提醒）：进出站队列；id 不给时同样的内容一分钟内只发一次 */
  notify(chatId: string, text: string, id?: string): boolean {
    if (!chatId) return false;
    const key = id ?? `notice:${this.botId}:${this.id}:${stableId(`${chatId}:${text}`, Math.floor(Date.now() / 60_000), 16)}`;
    void this.outbox.send({ id: key, botId: this.botId, channel: this.id, peerId: chatId, kind: "notice", body: { text } });
    return true;
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    await this.outbox.idle();
  }
}
