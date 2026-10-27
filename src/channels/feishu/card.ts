import type { OutboundOp, ReplySession } from "../../core/types.js";
import { splitText } from "../../core/types.js";
import { CARD_ELEMENT_ID, type FeishuTransport } from "./transport.js";
import { logger } from "../../log.js";

const log = logger("feishu.card");

/**
 * 飞书回复会话：CardKit 流式卡片（~400ms 节流，单卡 ≤10 次/秒），结束时关闭 streaming_mode。
 * 卡片创建/发送失败或中途失败 → 降级为纯文本回复。
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

  constructor(private transport: FeishuTransport, private replyTo: string, private throttleMs = 400) {}

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
        return this.sendText(op.text);
      case "interactive":
        return this.sendText(`${op.prompt}${op.options?.length ? "\n" + op.options.map((o, i) => `${i + 1}. ${o}`).join("\n") : ""}`);
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

  private async finish(text: string): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inflight;
    if (!this.started) await this.start();
    if (this.fallback || !this.cardId) return this.sendText(text);
    try {
      if (text !== this.flushed) {
        await this.transport.updateCardText(this.cardId, CARD_ELEMENT_ID, text, ++this.seq);
        this.flushed = text;
      }
      await this.transport.finishCard(this.cardId, ++this.seq, text.replace(/\s+/g, " ").slice(0, 60));
    } catch (e) {
      log.warn("card finish failed, sending text", { message: (e as Error).message });
      if (this.flushed !== text) await this.sendText(text);
    }
  }

  private async sendText(text: string): Promise<void> {
    for (const chunk of splitText(text, 4000)) await this.transport.replyText(this.replyTo, chunk);
  }
}
