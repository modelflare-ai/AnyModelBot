/**
 * 统一消息/事件模型：渠道把平台消息归一化成 InboundEvent，
 * 运行时只产出 OutboundOp，由渠道按自身能力（ChannelCapabilities）落地或降级。
 */
import type { ActivityStep } from "../agent/activity.js";
import { t, type MessageKey } from "../i18n/index.js";

/** 同一套接法的聊天平台（channels/messenger）：填 token 连上，单聊，流式靠改消息 */
export const MESSENGERS = ["telegram", "slack", "discord"] as const;
export type MessengerId = (typeof MESSENGERS)[number];
/** 平台名（品牌名，不分语言） */
export const MESSENGER_LABEL: Readonly<Record<MessengerId, string>> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
export const isMessenger = (c: string): c is MessengerId => (MESSENGERS as readonly string[]).includes(c);

export type ChannelId = "feishu" | "weixin" | "web" | MessengerId;
/** 消息经出站队列发到平台的渠道（网页对话不走出站队列） */
export type PushChannel = Exclude<ChannelId, "web">;
export const isPushChannel = (c: string): c is PushChannel => c === "weixin" || c === "feishu" || isMessenger(c);

export type Part =
  | { type: "text"; text: string }
  | {
      type: "image" | "file" | "video";
      ref?: string;
      name?: string;
      /** 渠道下载到的内容（运行时存进工作区后填 path） */
      data?: Buffer;
      /** 图片格式（按文件头识别） */
      mime?: string;
      /** 存进机器人工作区后的相对路径，如 inbox/20261031-143012-ab12cd.jpg */
      path?: string;
      /** 下载失败的原因 */
      error?: string;
      /** 来自被引用的消息 */
      quoted?: boolean;
    }
  | { type: "voice"; ref?: string; transcript?: string }
  | { type: "quote"; text: string };

export interface InboundEvent {
  /** 平台消息 ID，用于去重 */
  id: string;
  channel: ChannelId;
  /** 回复这条消息的机器人（渠道按 core/routes.ts 选好） */
  botId: string;
  /** 消息从哪个全局渠道账号进来；网页没有 */
  account?: string;
  conversation: { kind: "dm" | "group"; id: string };
  sender: { id: string; name?: string };
  parts: Part[];
  mentions?: string[];
  /** 回复所需的平台句柄：飞书 message_id / 微信 context_token 等 */
  replyHandle: Record<string, string>;
  /** 飞书：这条是回复（或话题里的消息）时，回复链的根消息和直接回复的那条（message_id） */
  thread?: { rootId?: string; parentId?: string };
  receivedAt: number;
}

export type OutboundOp =
  | { type: "typing"; on: boolean }
  | { type: "stream.start" }
  | { type: "stream.update"; text: string }
  | { type: "stream.finish"; text: string }
  /** ack：一句确认（"收到，这条会并入正在进行的处理…"），没有自己的回复；渠道给它短的有效期 */
  | { type: "text"; text: string; ack?: boolean }
  /** 代理回合的一步（新增或更新，按 id）：只有网页对话显示，其它渠道忽略 */
  | { type: "activity"; step: ActivityStep }
  /** 代理交付的本地文件（present）：微信走 CDN 媒体消息，飞书上传文件/图片，网页显示成文件卡片（图片直接显示） */
  | { type: "file"; path: string; name: string }
  /**
   * 模型在回合中间说的话（带工具调用的那一步里的文字），按说的顺序一段一段来：网页对话和飞书的流式卡片显示在回复前面，
   * 微信不发（只发最后的回复，配额留给它）
   */
  | { type: "interim"; text: string }
  /** 代理在回合中交付了一个文件（present）：网页对话马上显示；文件本身照旧在回复之后由 file 发出，其它渠道忽略这个操作 */
  | { type: "presented"; path: string; name: string }
  /**
   * ask_user / approval / secret_request 等交互，按能力映射到卡片按钮或编号文本。
   * prompt 为完整的纯文本提示（文本渠道直接发送）；buttons 供卡片渠道使用，value 会原样回传。
   */
  | {
      type: "interactive";
      kind: "ask_user" | "approval" | "secret_request";
      prompt: string;
      options?: string[];
      requestId?: string;
      code?: string;
      buttons?: Array<{ label: string; value: Record<string, string>; style?: "primary" | "danger" | "default" }>;
    };

export interface ChannelCapabilities {
  streaming: boolean;
  cards: boolean;
  groups: boolean;
  mentions: boolean;
  typing: boolean;
  /** 单条消息建议的最大字符数 */
  maxTextLength: number;
  /** 是否存在主动发消息配额（微信 iLink：每次入站后 24h 内 10 条） */
  proactiveQuota: boolean;
}

/** 一次回复的出站会话：运行时依次 apply OutboundOp。 */
export interface ReplySession {
  apply(op: OutboundOp): Promise<void>;
}

export type ChannelStatus = {
  state: "disabled" | "connecting" | "connected" | "error" | "expired" | "paused" | "login_required";
  detail?: string;
  since: number;
};

const MEDIA_LABEL = {
  image: ["app.media_image", "app.media_quoted_image"],
  file: ["app.media_file", "app.media_quoted_file"],
  video: ["app.media_video", "app.media_quoted_video"],
} as const satisfies Record<string, readonly [MessageKey, MessageKey]>;

export function eventText(ev: InboundEvent): string {
  return ev.parts
    .map((p) => {
      switch (p.type) {
        case "text":
          return p.text;
        case "quote":
          return `> ${p.text}`;
        case "voice":
          return p.transcript ? p.transcript : t("app.media_voice");
        case "image":
        case "file":
        case "video": {
          // [图片 inbox/x.jpg]、[引用的文件 报告.pdf → inbox/x-报告.pdf]、[视频（未能下载：…）]
          const label = `${t(MEDIA_LABEL[p.type][p.quoted ? 1 : 0])}${p.type === "file" && p.name ? " " + p.name : ""}`;
          if (p.path) return `[${label}${p.type === "file" && p.name ? " →" : ""} ${p.path}]`;
          return p.error ? `[${t("app.media_not_downloaded", { label, error: p.error })}]` : `[${label}]`;
        }
      }
    })
    .join("\n")
    .trim();
}

/** 按段落/换行优先切分长文本。 */
export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return text ? [text] : [];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
}
