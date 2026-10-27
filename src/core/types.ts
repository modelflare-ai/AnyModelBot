/**
 * 统一消息/事件模型：渠道把平台消息归一化成 InboundEvent，
 * 运行时只产出 OutboundOp，由渠道按自身能力（ChannelCapabilities）落地或降级。
 */
export type ChannelId = "feishu" | "weixin" | "web";

export type Part =
  | { type: "text"; text: string }
  | { type: "image" | "file" | "video"; ref?: string; name?: string }
  | { type: "voice"; ref?: string; transcript?: string }
  | { type: "quote"; text: string };

export interface InboundEvent {
  /** 平台消息 ID，用于去重 */
  id: string;
  channel: ChannelId;
  botId: string;
  conversation: { kind: "dm" | "group"; id: string };
  sender: { id: string; name?: string };
  parts: Part[];
  mentions?: string[];
  /** 回复所需的平台句柄：飞书 message_id / 微信 context_token 等 */
  replyHandle: Record<string, string>;
  receivedAt: number;
}

export type OutboundOp =
  | { type: "typing"; on: boolean }
  | { type: "stream.start" }
  | { type: "stream.update"; text: string }
  | { type: "stream.finish"; text: string }
  | { type: "text"; text: string }
  /** 代理交付的本地文件（present）：微信走 CDN 媒体消息，飞书上传文件/图片，网页列出文件名 */
  | { type: "file"; path: string; name: string }
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

export function eventText(ev: InboundEvent): string {
  return ev.parts
    .map((p) => {
      switch (p.type) {
        case "text":
          return p.text;
        case "quote":
          return `> ${p.text}`;
        case "voice":
          return p.transcript ? p.transcript : "[语音]";
        case "image":
          return "[图片]";
        case "file":
          return `[文件${p.name ? " " + p.name : ""}]`;
        case "video":
          return "[视频]";
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
