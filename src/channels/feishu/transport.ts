import fsp from "node:fs/promises";
import path from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import { randomUUID } from "node:crypto";
import { logger } from "../../log.js";

const FEISHU_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const FEISHU_FILE_TYPES: Record<string, string> = {
  pdf: "pdf", doc: "doc", docx: "doc", xls: "xls", xlsx: "xls", csv: "xls", ppt: "ppt", pptx: "ppt", mp4: "mp4", opus: "opus",
};

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
/** 卡片按钮回调（card.action.trigger）：value 为按钮上携带的值 */
export interface FeishuCardAction {
  value: Record<string, string>;
  operatorOpenId: string;
  messageId?: string;
}
export type CardActionHandler = (a: FeishuCardAction) => { toast: string; ok: boolean } | Promise<{ toast: string; ok: boolean }>;

export interface FeishuTransport {
  start(
    onMessage: (ev: FeishuMessageEvent) => void,
    onState: (state: "connecting" | "connected" | "error", detail?: string) => void,
    onCardAction?: CardActionHandler,
  ): Promise<void>;
  /** 发送带按钮的交互卡片（审批/提问）；未实现时降级为文本 */
  replyActionCard?(replyToMessageId: string, card: Record<string, unknown>): Promise<void>;
  stop(): Promise<void>;
  createStreamingCard(initial: string): Promise<string>;
  sendCardReply(replyToMessageId: string, cardId: string): Promise<void>;
  updateCardText(cardId: string, elementId: string, text: string, sequence: number): Promise<void>;
  finishCard(cardId: string, sequence: number, summary: string): Promise<void>;
  replyText(replyToMessageId: string, text: string): Promise<void>;
  /** 上传本地文件并作为图片/文件消息回复（present 交付物） */
  replyFile?(replyToMessageId: string, filePath: string): Promise<void>;
  /** 主动发一条文本到会话（不是回复某条消息；用于余额提醒） */
  sendText?(chatId: string, text: string): Promise<void>;
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

/** 审批/提问卡片：说明 + 一排回调按钮（schema 2.0）。 */
export function actionCardSpec(title: string, text: string, buttons: Array<{ label: string; value: Record<string, string>; style?: string }>) {
  return {
    schema: "2.0",
    config: { summary: { content: title } },
    header: { title: { tag: "plain_text", content: title }, template: "orange" },
    body: {
      elements: [
        { tag: "markdown", content: text },
        {
          tag: "column_set",
          columns: buttons.map((b) => ({
            tag: "column",
            width: "auto",
            elements: [
              {
                tag: "button",
                text: { tag: "plain_text", content: b.label },
                type: b.style === "danger" ? "danger" : b.style === "primary" ? "primary" : "default",
                behaviors: [{ type: "callback", value: b.value }],
              },
            ],
          })),
        },
      ],
    },
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

  async start(
    onMessage: (ev: FeishuMessageEvent) => void,
    onState: (s: "connecting" | "connected" | "error", d?: string) => void,
    onCardAction?: CardActionHandler,
  ): Promise<void> {
    onState("connecting");
    const dispatcher = new Lark.EventDispatcher({}).register({
      // 卡片按钮回调（长连接模式下以事件形式下发；需在开发者后台订阅 card.action.trigger）
      "card.action.trigger": async (data: any) => {
        if (!onCardAction) return {};
        try {
          const r = await onCardAction({
            value: (data?.action?.value ?? {}) as Record<string, string>,
            operatorOpenId: data?.operator?.open_id ?? "",
            messageId: data?.context?.open_message_id,
          });
          return { toast: { type: r.ok ? "success" : "warning", content: r.toast } };
        } catch (e) {
          this.log.warn("card action failed", { message: (e as Error).message });
          return { toast: { type: "error", content: "处理失败" } };
        }
      },
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

  async replyActionCard(replyToMessageId: string, card: Record<string, unknown>): Promise<void> {
    const res: any = await this.client.im.v1.message.reply({
      path: { message_id: replyToMessageId },
      data: { msg_type: "interactive", content: JSON.stringify(card) },
    });
    check(res, "im.message.reply(action card)");
  }

  async replyFile(replyToMessageId: string, filePath: string): Promise<void> {
    const buf = await fsp.readFile(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(name).toLowerCase().slice(1);
    let msgType: "image" | "file";
    let content: string;
    if (FEISHU_IMAGE_EXT.has(ext) && buf.length <= 10 * 1024 * 1024) {
      const res: any = await this.client.im.v1.image.create({ data: { image_type: "message", image: buf } as any });
      const key = res?.image_key ?? res?.data?.image_key;
      if (!key) throw new Error(`im.image.create failed${res?.code ? ` (code ${res.code})` : ""}`);
      msgType = "image";
      content = JSON.stringify({ image_key: key });
    } else {
      if (buf.length > 30 * 1024 * 1024) throw new Error("file too large for feishu (>30MB)");
      const fileType = FEISHU_FILE_TYPES[ext] ?? "stream";
      const res: any = await this.client.im.v1.file.create({ data: { file_type: fileType, file_name: name, file: buf } as any });
      const key = res?.file_key ?? res?.data?.file_key;
      if (!key) throw new Error(`im.file.create failed${res?.code ? ` (code ${res.code})` : ""}`);
      msgType = "file";
      content = JSON.stringify({ file_key: key });
    }
    const res: any = await this.client.im.v1.message.reply({ path: { message_id: replyToMessageId }, data: { msg_type: msgType, content } });
    check(res, `im.message.reply(${msgType})`);
  }

  async replyText(replyToMessageId: string, text: string): Promise<void> {
    const res: any = await this.client.im.v1.message.reply({
      path: { message_id: replyToMessageId },
      data: { msg_type: "text", content: JSON.stringify({ text }) },
    });
    check(res, "im.message.reply(text)");
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const res: any = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
    });
    check(res, "im.message.create(text)");
  }
}
