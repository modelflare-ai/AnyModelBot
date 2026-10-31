import type { ChannelCapabilities, ChannelStatus, InboundEvent, Part } from "../../core/types.js";
import { Dedup, KeyedQueue } from "../../core/queue.js";
import type { BotRuntime } from "../../core/runtime.js";
import type { FeishuMessageEvent, FeishuTransport } from "./transport.js";
import { FeishuReply } from "./card.js";
import { logger } from "../../log.js";

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
      return [{ type: "text", text: `[暂不支持的消息类型：${ev.messageType}]` }];
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

  constructor(
    private botId: string,
    private transport: FeishuTransport,
    private runtime: BotRuntime,
    private queue: KeyedQueue,
    private throttleMs = 400,
  ) {}

  async start(): Promise<void> {
    await this.transport.start(
      (ev) => this.onMessage(ev),
      (state, detail) => {
        this.status = { state, detail, since: Date.now() };
        this.log.info(`bot ${this.botId} ws ${state}`, detail ? { detail } : undefined);
      },
      (a) => this.runtime.cardAction(this.botId, a.value, `feishu:${a.operatorOpenId}`),
    );
  }

  async stop(): Promise<void> {
    await this.transport.stop();
    this.status = { state: "disabled", since: Date.now() };
  }

  /** 同步返回（ack），处理放入每会话串行队列。 */
  onMessage(ev: FeishuMessageEvent): void {
    if (!ev.messageId || !this.dedup.firstSeen(ev.messageId)) return;
    if (ev.chatType !== "p2p") return; // P1：仅单聊
    const inbound: InboundEvent = {
      id: ev.messageId,
      channel: "feishu",
      botId: this.botId,
      conversation: { kind: "dm", id: ev.chatId },
      sender: { id: ev.senderOpenId },
      parts: feishuParts(ev),
      mentions: ev.mentions.map((m) => m.openId ?? m.key),
      replyHandle: { messageId: ev.messageId, chatId: ev.chatId },
      receivedAt: Date.now(),
    };
    // 审批/提问回复在入队前处理（正在进行的回合正等着它）
    // 没处理掉但带 ack 的（前一条还在处理）：先说一声，消息照常入队
    const intercepted = this.runtime.interceptReply(inbound);
    if (intercepted.ack) {
      const p = this.transport.replyText(ev.messageId, intercepted.ack).catch((e) => this.log.warn("ack failed", { message: (e as Error).message }));
      this.pending.add(p);
      void p.finally(() => this.pending.delete(p));
    }
    if (intercepted.handled) return;
    const p = this.queue.run(`feishu:${this.botId}:${ev.chatId}`, async () => {
      const reply = new FeishuReply(this.transport, ev.messageId, this.throttleMs);
      try {
        await this.runtime.handle(inbound, reply);
      } catch (e) {
        this.log.error("handle failed", { message: (e as Error).message });
        await reply.apply({ type: "text", text: `⚠️ 处理失败：${(e as Error).message}` }).catch(() => {});
      }
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** 主动提醒：发到一个已有的单聊会话；传输层不支持时返回 false */
  async notify(chatId: string, text: string): Promise<boolean> {
    if (!this.transport.sendText) return false;
    await this.transport.sendText(chatId, text);
    return true;
  }
}
