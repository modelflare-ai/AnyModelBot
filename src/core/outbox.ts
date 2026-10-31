/**
 * 持久化的出站队列：最终回复、文件、审批提示和重要通知先写进 sqlite，再发送。
 * - 每条消息有确定的 id（由入站消息 id 推出来），同一 id 只写一次、只发一次；
 * - 同一会话按写入顺序一条一条发，前一条没发完，后面的等着；
 * - 临时失败按退避重试（5 秒起，翻倍到 5 分钟），渠道没在运行时等它上线；
 * - 发不出去了（配额用完、超过 24 小时、过期、平台多次拒绝）标记 gone 并记下原因，界面里能看到；
 * - 应用重启后接着发。流式的中间内容和"正在输入"不经过这里。
 *
 * 设计改编自 deepseek-ai/dsh-superagent-prototype（MIT，© 2026 DeepSeek Harness Team）：src/app/outbox.ts 的回执 +
 * src/app/effects.ts 的持久化副作用队列（按会话排队、Later 不计失败、指数退避、关机时留到下次启动），见 THIRD_PARTY_NOTICES.md。
 */
import crypto from "node:crypto";
import type { OutboxBody, OutboxKind, OutboxRow, Store } from "../store/db.js";
import { logger } from "../log.js";

const log = logger("outbox");

/** 暂时不能发（渠道没上线、登录过期等）：稍后再试，不算失败 */
export class Later extends Error {}
/** 再也发不出去了：标记 gone，message 是给人看的原因 */
export class Gone extends Error {}

/** 普通消息最长等多久（微信的会话凭证 24 小时有效，飞书也不该再补发一天前的回复） */
export const OUTBOX_TTL_MS = 24 * 3600_000;
/** 平台明确拒绝（有错误码）的，试这么多次就放弃 */
export const REJECTIONS_BEFORE_GONE = 5;

export interface OutboxInput {
  id: string;
  botId: string;
  channel: "weixin" | "feishu";
  /** 微信：用户 id；飞书：单聊 chat_id */
  peerId: string;
  kind: OutboxKind;
  body: OutboxBody;
  /** 飞书：回复的消息 id */
  replyTo?: string;
  /** 多久之后不再发（默认 24 小时；ack、审批提示更短） */
  ttlMs?: number;
}

/** 渠道的发送函数：成功返回；Later / Gone / 其他错误（临时失败，会重试）。progress 记下长文本已发出的分段数 */
export type Deliver = (row: OutboxRow, progress: (n: number) => void) => Promise<void>;

/** 平台给的确定 id（微信 client_id、飞书 uuid）：同一条消息的同一段每次都一样，平台去重时不会重复 */
export function stableId(id: string, part: number, len = 32): string {
  return crypto.createHash("sha256").update(`${id}#${part}`).digest("hex").slice(0, len);
}

/**
 * 一次回复里每条出站消息 id 的最后一段：最终回复按"第几个"（同一条入站只有一个最终回复，平台重复投递、模型答得不一样时也不会再发一遍），
 * 其余按内容（不同的消息不会因为先后顺序不同撞上同一个 id 而被吞掉）。
 */
export class ReplyIds {
  private finals = 0;
  final(): string {
    return `final${this.finals++ || ""}`;
  }
  of(kind: string, content: string): string {
    return `${kind}-${stableId(content, 0, 12)}`;
  }
}

export class Outbox {
  private handlers = new Map<string, Deliver>();
  /** 会话 → 正在进行的那次发送 */
  private inflight = new Map<string, { id: string; done: Promise<void> }>();
  private timer: NodeJS.Timeout | undefined;
  private scheduled = false;
  private started = false;
  private stopped = false;
  /** 一条消息发不出去了（界面提示、日志） */
  onGone: ((row: OutboxRow) => void) | undefined;

  constructor(
    private store: Store,
    private opts: { now?: () => number; retry?: readonly [number, number] } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** 渠道上线时登记自己的发送函数，返回注销函数（渠道停下时调用；没登记的消息等着） */
  register(botId: string, channel: string, deliver: Deliver): () => void {
    const key = `${botId}:${channel}`;
    this.handlers.set(key, deliver);
    this.kick();
    return () => {
      if (this.handlers.get(key) === deliver) this.handlers.delete(key);
    };
  }

  /**
   * 先写库再发。同一 id 已经写过就不再写（也不会再发一遍）。
   * 等到这条消息的第一次发送结束（成功、失败待重试或放弃）才返回；排在同一会话前一条后面时立即返回。不抛错。
   */
  async send(input: OutboxInput): Promise<OutboxRow | undefined> {
    const now = this.now();
    const conversationId = `${input.botId}:${input.channel}:${input.peerId}`;
    this.store.insertOutbox({
      id: input.id,
      botId: input.botId,
      channel: input.channel,
      conversationId,
      peerId: input.peerId,
      kind: input.kind,
      body: input.body,
      replyTo: input.replyTo ?? "",
      due: now,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? OUTBOX_TTL_MS),
    });
    this.pump();
    const f = this.inflight.get(conversationId);
    if (f?.id === input.id) await f.done;
    return this.store.getOutbox(input.id);
  }

  /** 开始发送（含上次没发完的）；清理旧记录 */
  start(): void {
    this.started = true;
    this.stopped = false;
    try {
      this.store.pruneOutbox(this.now());
      // 重启了：等着退避的不用再等，马上试一次
      this.store.resumeOutbox(this.now());
    } catch (e) {
      log.warn("prune failed", { message: (e as Error).message });
    }
    const left = this.store.pendingOutbox().length;
    if (left) log.info(`resuming ${left} unsent message(s)`);
    this.kick();
  }

  /** 不再开始新的发送，等正在发的结束（最多 waitMs）；没发完的留在库里，下次启动接着发 */
  async stop(waitMs = 5000): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    const running = [...this.inflight.values()].map((f) => f.done);
    if (!running.length) return;
    let t: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(running), new Promise((r) => (t = setTimeout(r, waitMs)))]);
    clearTimeout(t);
  }

  /** 等到没有正在进行的发送（到期待重试的不等） */
  async idle(): Promise<void> {
    for (;;) {
      this.pump();
      const running = [...this.inflight.values()].map((f) => f.done);
      if (!running.length) return;
      await Promise.allSettled(running);
    }
  }

  /** 界面上"知道了" */
  dismiss(id: string): boolean {
    const row = this.store.getOutbox(id);
    if (!row || row.status !== "gone") return false;
    this.store.updateOutbox(id, { dismissed: true }, this.now());
    return true;
  }

  private kick(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  /** 每个会话只看最早的一条没发出去的：到期且渠道在线就发，否则记下最早什么时候再看 */
  private pump(): void {
    if (!this.started || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    let next = Infinity;
    const heads = new Set<string>();
    for (const row of this.store.pendingOutbox()) {
      if (heads.has(row.conversationId)) continue;
      heads.add(row.conversationId);
      if (this.inflight.has(row.conversationId)) continue;
      if (row.expiresAt <= now) {
        this.gone(row, row.error ? `一直没能发出去（${row.error}）` : "等待太久，已不再发送");
        this.kick();
        continue;
      }
      const deliver = this.handlers.get(`${row.botId}:${row.channel}`);
      if (row.due > now || !deliver) {
        // 渠道没上线：等它注册；到了过期时间也要醒来标记 gone
        next = Math.min(next, deliver ? row.due : row.expiresAt);
        continue;
      }
      this.attempt(row, deliver);
    }
    if (next < Infinity) {
      this.timer = setTimeout(() => this.pump(), Math.max(20, next - now));
      this.timer.unref?.();
    }
  }

  private attempt(row: OutboxRow, deliver: Deliver): void {
    const conv = row.conversationId;
    const done = (async () => {
      try {
        await deliver(row, (n) => this.store.updateOutbox(row.id, { progress: n }, this.now()));
        this.store.updateOutbox(row.id, { status: "sent", sentAt: this.now(), error: "" }, this.now());
      } catch (e) {
        this.failed(row, e);
      }
    })().finally(() => {
      if (this.inflight.get(conv)?.done === done) this.inflight.delete(conv);
      this.kick();
    });
    this.inflight.set(conv, { id: row.id, done });
  }

  private failed(row: OutboxRow, e: unknown): void {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    const now = this.now();
    if (e instanceof Gone) return this.gone(row, msg);
    // 关机中：留到下次启动
    if (this.stopped) return;
    const [base, max] = this.opts.retry ?? [5000, 300_000];
    if (e instanceof Later) {
      this.store.updateOutbox(row.id, { due: now + base, error: msg }, now);
      return;
    }
    const attempts = row.attempts + 1;
    const rejected = (e as { rejected?: boolean })?.rejected === true;
    if ((rejected && attempts >= REJECTIONS_BEFORE_GONE) || now >= row.expiresAt) return this.gone(row, `发送失败：${msg}`);
    const delay = Math.min(max, base * 2 ** Math.min(attempts - 1, 16));
    log.warn("send failed, will retry", { id: row.id, channel: row.channel, attempts, inMs: delay, message: msg });
    this.store.updateOutbox(row.id, { attempts, error: msg, due: now + delay }, now);
  }

  private gone(row: OutboxRow, reason: string): void {
    this.store.updateOutbox(row.id, { status: "gone", error: reason }, this.now());
    log.warn("message gone", { id: row.id, channel: row.channel, kind: row.kind, reason });
    try {
      this.onGone?.({ ...row, status: "gone", error: reason });
    } catch {
      /* ignore */
    }
  }
}
