import crypto from "node:crypto";
import type { OutboundOp, ReplySession } from "../../core/types.js";
import { splitText } from "../../core/types.js";
import { Gone, ReplyIds, stableId, type Outbox } from "../../core/outbox.js";
import type { OutboxBody, OutboxKind, OutboxRow } from "../../store/db.js";
import { CARD_ELEMENT_ID, actionCardSpec, type FeishuTransport } from "./transport.js";
import { logger } from "../../log.js";
import { t } from "../../i18n/index.js";

const log = logger("feishu.card");

/** 文件、审批卡片临时发不出去时先重试这么多次，再改发文本 */
const FILE_RETRIES = 2;

/** 网络断开、超时这类过一会儿可能就好的错误（飞书返回错误码、本地文件读不了不算） */
function transient(e: unknown): boolean {
  const x = e as { rejected?: boolean; syscall?: string };
  if (x?.rejected) return false;
  return !(x?.syscall && ["open", "read", "stat"].includes(x.syscall)) && !/too large/i.test(String((e as Error)?.message));
}

/**
 * 把一条出站记录发到飞书。最终回复先写进流式卡片（只在第一次尝试；卡片已经是全文就只收尾），
 * 卡片失败或重试时改发文本回复。每段带确定的 uuid，飞书 1 小时内对同一 uuid 只发一次。
 */
export async function deliverFeishu(transport: FeishuTransport, row: OutboxRow, progress: (n: number) => void, retry = true): Promise<void> {
  const b = row.body;
  // 分段回复：progress = 已发出的段数，崩溃重启后从下一段接着发；uuidBase 让卡片和降级文本的 uuid 不撞
  const replyText = async (text: string, uuidBase = 0) => {
    const chunks = splitText(text, 4000);
    for (let i = row.progress; i < chunks.length; i++) {
      await transport.replyText(row.replyTo, chunks[i], stableId(row.id, uuidBase + i));
      progress(i + 1);
    }
  };
  switch (row.kind) {
    case "text": {
      const text = b.text ?? "";
      if (b.cardId && row.attempts === 0 && row.progress === 0) {
        let shown = !!b.shown;
        const seq = b.cardSeq ?? 1;
        try {
          if (!shown) {
            await transport.updateCardText(b.cardId, CARD_ELEMENT_ID, text, seq);
            shown = true;
          }
          await transport.finishCard(b.cardId, seq + 1, text.replace(/\s+/g, " ").slice(0, 60));
          return;
        } catch (e) {
          log.warn("card finish failed, sending text", { message: (e as Error).message });
          // 卡片上已经是全文：不重复发
          if (shown) return;
        }
      }
      return replyText(text);
    }
    case "notice": {
      if (!transport.sendText) throw new Gone("飞书传输层不支持主动发消息");
      await transport.sendText(row.peerId, b.text ?? "", stableId(row.id, 0));
      return;
    }
    case "file": {
      const name = b.name ?? "文件";
      if (transport.replyFile && row.progress === 0) {
        try {
          await transport.replyFile(row.replyTo, b.path ?? "", stableId(row.id, 0));
          return;
        } catch (e) {
          if (retry && transient(e) && row.attempts < FILE_RETRIES) throw e;
          log.warn("feishu file upload failed", { name, message: (e as Error).message.slice(0, 200) });
        }
        progress(1);
      }
      await transport.replyText(row.replyTo, `⚠️ 文件「${name}」发送失败，可在工作区中查看。`, stableId(row.id, 1));
      return;
    }
    case "card": {
      if (b.card && transport.replyActionCard && row.progress === 0) {
        try {
          await transport.replyActionCard(row.replyTo, b.card, stableId(row.id, 0));
          return;
        } catch (e) {
          if (retry && transient(e) && row.attempts < FILE_RETRIES) throw e;
          log.warn("action card failed, sending text", { message: (e as Error).message });
        }
      }
      return replyText(b.text ?? "", 1);
    }
  }
}

/** 回复会话把消息交给出站队列需要的东西：key 由入站消息推出（同一条入站的第 n 条回复 id 固定） */
export interface FeishuOutbox {
  outbox: Outbox;
  botId: string;
  chatId: string;
  key: string;
  ttlMs?: number;
}

/**
 * 飞书回复会话：CardKit 流式卡片（~400ms 节流，单卡 ≤10 次/秒），结束时关闭 streaming_mode。
 * 卡片创建/发送失败或中途失败 → 降级为纯文本回复。
 * 最终回复、文件、审批卡片先写进出站队列（持久化、按会话排队、失败重试）；流式的中间内容不经过它。没给队列时（单元测试）直接发。
 */
export class FeishuReply implements ReplySession {
  private cardId: string | undefined;
  private seq = 0;
  private latest = "";
  private flushed = "";
  private timer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> = Promise.resolve();
  private fallback = false;
  private started = false;
  private closed = false;
  private ids = new ReplyIds();

  constructor(
    private transport: FeishuTransport,
    private replyTo: string,
    private throttleMs = 400,
    private out?: FeishuOutbox,
  ) {}

  get usedCard(): boolean {
    return !!this.cardId && !this.fallback;
  }

  async apply(op: OutboundOp): Promise<void> {
    switch (op.type) {
      case "typing":
        return; // 飞书无 typing；卡片本身就是“正在生成”的反馈
      case "stream.start":
        return this.start();
      case "stream.update":
        this.latest = op.text;
        this.schedule();
        return;
      case "stream.finish":
        return this.finish(op.text);
      case "text":
        // ack（"收到，这条会并入…"）过一会儿就没意义了，发不出去不必一直等
        return this.post("text", { text: op.text }, this.ids.of(op.ack ? "ack" : "text", op.text), op.ack ? 10 * 60_000 : undefined);
      case "file":
        await this.inflight;
        return this.post("file", { path: op.path, name: op.name }, this.ids.of("file", op.path));
      case "interactive": {
        const text = op.requestId ? op.prompt : `${op.prompt}${op.options?.length ? "\n" + op.options.map((o, i) => `${i + 1}. ${o}`).join("\n") : ""}`;
        const title = op.kind === "approval" ? t("channel.approval_title", { code: op.code ?? "" }) : t("channel.question_title");
        const card = op.buttons?.length ? actionCardSpec(title, op.prompt, op.buttons) : undefined;
        // 审批/提问十分钟后过期，发不出去就不必再等
        return this.post(card ? "card" : "text", { text, ...(card ? { card } : {}) }, this.ids.of("prompt", op.requestId ?? text), 10 * 60_000);
      }
    }
  }

  /** 交给出站队列（先落库再发，等第一次发送结束）；没有队列就直接发 */
  private async post(kind: OutboxKind, body: OutboxBody, role: string, ttlMs?: number): Promise<void> {
    if (this.out) {
      const { outbox, botId, chatId, key } = this.out;
      await outbox.send({ id: `fs:${botId}:${key}:${role}`, botId, channel: "feishu", peerId: chatId, kind, body, replyTo: this.replyTo, ttlMs: ttlMs ?? this.out.ttlMs });
      return;
    }
    const row = { id: crypto.randomUUID(), kind, body, replyTo: this.replyTo, progress: 0, attempts: 0 } as OutboxRow;
    try {
      await deliverFeishu(this.transport, row, () => {}, false);
    } catch (e) {
      if (!(e instanceof Gone)) throw e;
      log.warn("feishu reply dropped", { reason: e.message });
    }
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      this.cardId = await this.transport.createStreamingCard("…");
      await this.transport.sendCardReply(this.replyTo, this.cardId);
    } catch (e) {
      log.warn("streaming card unavailable, falling back to text", { message: (e as Error).message });
      this.fallback = true;
    }
  }

  private schedule(): void {
    if (this.fallback || !this.cardId || this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inflight = this.inflight.then(() => this.flush());
    }, this.throttleMs);
  }

  private async flush(): Promise<void> {
    if (this.fallback || !this.cardId || this.latest === this.flushed) return;
    const text = this.latest;
    try {
      await this.transport.updateCardText(this.cardId, CARD_ELEMENT_ID, text, ++this.seq);
      this.flushed = text;
    } catch (e) {
      log.warn("card update failed", { message: (e as Error).message });
    }
  }

  /** 最终回复：写进卡片并收尾（卡片不可用时发文本）——这一步经出站队列，崩溃重启后会补发 */
  private async finish(text: string): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inflight;
    if (!this.started) await this.start();
    const role = this.ids.final();
    if (this.fallback || !this.cardId) return this.post("text", { text }, role);
    const cardSeq = this.seq + 1;
    this.seq += 2;
    return this.post("text", { text, cardId: this.cardId, cardSeq, shown: text === this.flushed }, role);
  }
}
