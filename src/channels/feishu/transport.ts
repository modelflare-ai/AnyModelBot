import * as Lark from "@larksuiteoapi/node-sdk";
import { randomUUID } from "node:crypto";
import { logger } from "../../log.js";

/** 归一化后的飞书 im.message.receive_v1 关键字段 */
export interface FeishuMessageEvent {
  eventId?: string;
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group" | string;
  messageType: string;
  content: string; // 原始 JSON 字符串
  senderOpenId: string;
  mentions: Array<{ key: string; name?: string; openId?: string }>;
  createTime: number;
}

/**
 * 飞书传输层抽象（便于离线测试用 mock 替换）。
 * 真实实现：WSClient 长连接接收事件 + OpenAPI（CardKit 流式卡片 / 文本回复）。
 */
export interface FeishuTransport {
  start(onMessage: (ev: FeishuMessageEvent) => void, onState: (state: "connecting" | "connected" | "error", detail?: string) => void): Promise<void>;
  stop(): Promise<void>;
  createStreamingCard(initial: string): Promise<string>;
  sendCardReply(replyToMessageId: string, cardId: string): Promise<void>;
  updateCardText(cardId: string, elementId: string, text: string, sequence: number): Promise<void>;
  finishCard(cardId: string, sequence: number, summary: string): Promise<void>;
  replyText(replyToMessageId: string, text: string): Promise<void>;
}

export const CARD_ELEMENT_ID = "md";

export function streamingCardSpec(initial: string) {
  return {
    schema: "2.0",
    config: {
      streaming_mode: true,
      summary: { content: "[生成中…]" },
      streaming_config: {
        print_frequency_ms: { default: 50 },
        print_step: { default: 2 },
        print_strategy: "fast",
      },
    },
    body: { elements: [{ tag: "markdown", element_id: CARD_ELEMENT_ID, content: initial }] },
  };
}

function check(res: { code?: number; msg?: string } | undefined, what: string): void {
  if (res && typeof res.code === "number" && res.code !== 0) throw new Error(`${what} failed: code=${res.code} msg=${res.msg}`);
}

export class LarkTransport implements FeishuTransport {
  private client: Lark.Client;
  private ws: Lark.WSClient | undefined;
  private log = logger("feishu");

  constructor(private appId: string, private appSecret: string, private domain: "feishu" | "lark" = "feishu") {
    this.client = new Lark.Client({
      appId,
      appSecret,
      domain: domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.warn,
    });
  }

  async start(onMessage: (ev: FeishuMessageEvent) => void, onState: (s: "connecting" | "connected" | "error", d?: string) => void): Promise<void> {
    onState("connecting");
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        // 3 秒规则：立即返回，业务异步处理（onMessage 内只入队）
        try {
          const m = data.message ?? {};
          onMessage({
            eventId: data.event_id,
            messageId: m.message_id,
            chatId: m.chat_id,
            chatType: m.chat_type,
            messageType: m.message_type,
            content: m.content ?? "{}",
            senderOpenId: data.sender?.sender_id?.open_id ?? "",
            mentions: (m.mentions ?? []).map((x: any) => ({ key: x.key, name: x.name, openId: x.id?.open_id })),
            createTime: Number(m.create_time ?? Date.now()),
          });
        } catch (e) {
          this.log.warn("bad event", { message: (e as Error).message });
        }
      },
    });
    this.ws = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: this.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.warn,
      autoReconnect: true,
      onReady: () => onState("connected"),
      onError: (err: Error) => onState("error", err?.message),
      onReconnecting: () => onState("connecting", "reconnecting"),
    } as any);
    await this.ws.start({ eventDispatcher: dispatcher });
  }

  async stop(): Promise<void> {
    try {
      (this.ws as any)?.close?.({ force: true });
    } catch {
      /* ignore */
    }
    this.ws = undefined;
  }

  async createStreamingCard(initial: string): Promise<string> {
    const res: any = await this.client.cardkit.v1.card.create({
      data: { type: "card_json", data: JSON.stringify(streamingCardSpec(initial)) },
    });
    check(res, "cardkit.card.create");
    const id = res?.data?.card_id;
    if (!id) throw new Error("cardkit.card.create returned no card_id");
    return id;
  }

  async sendCardReply(replyToMessageId: string, cardId: string): Promise<void> {
    const res: any = await this.client.im.v1.message.reply({
      path: { message_id: replyToMessageId },
      data: { msg_type: "interactive", content: JSON.stringify({ type: "card", data: { card_id: cardId } }) },
    });
    check(res, "im.message.reply(card)");
  }

  async updateCardText(cardId: string, elementId: string, text: string, sequence: number): Promise<void> {
    const res: any = await this.client.cardkit.v1.cardElement.content({
      path: { card_id: cardId, element_id: elementId },
      data: { content: text, sequence, uuid: randomUUID() },
    });
    check(res, "cardkit.cardElement.content");
  }

  async finishCard(cardId: string, sequence: number, summary: string): Promise<void> {
    const res: any = await this.client.cardkit.v1.card.settings({
      path: { card_id: cardId },
      data: {
        settings: JSON.stringify({ config: { streaming_mode: false, summary: { content: summary } } }),
        sequence,
        uuid: randomUUID(),
      },
    });
    check(res, "cardkit.card.settings");
  }

  async replyText(replyToMessageId: string, text: string): Promise<void> {
    const res: any = await this.client.im.v1.message.reply({
      path: { message_id: replyToMessageId },
      data: { msg_type: "text", content: JSON.stringify({ text }) },
    });
    check(res, "im.message.reply(text)");
  }
}
