/**
 * 一段代理对话的第一条消息：按会话变化、又要在这一段里保持不变的内容（对话渠道、记忆快照、交接便条）放在用户消息前面。
 * 不放进系统提示词：系统提示词是同一机器人所有会话共用的前缀，记一条记忆或换一个会话都不该让它失效。
 */

/** 会话在哪里：渠道（weixin / feishu / web）与单聊 / 群聊 */
export interface ChatPlace {
  channel: string;
  kind: "dm" | "group";
}

/** 渠道的一句说明（让模型知道回复会显示在哪里：微信只显示纯文本，IM 里要短） */
export function placeLine(p: ChatPlace): string {
  const chat = p.kind === "group" ? "群聊" : "私聊";
  if (p.channel === "weixin") return `微信${chat}（手机上看，只显示纯文本）`;
  if (p.channel === "feishu") return `飞书${chat}（支持 Markdown）`;
  if (p.channel === "web") return "本机网页对话（支持 Markdown）";
  return `${p.channel}${chat}`;
}

export interface SegmentInput {
  place?: ChatPlace;
  /** 冻结的记忆快照；undefined = 本机器人关着长期记忆 */
  memory?: string;
  /** 上一段留下的交接便条（一次性） */
  handoff?: string;
  /** 用户这条消息 */
  text: string;
}

/** 第一条消息的全文；什么附加内容都没有时就是用户消息本身 */
export function segmentInput(o: SegmentInput): string {
  const parts: string[] = [];
  if (o.place) parts.push(`[对话渠道]\n${placeLine(o.place)}`);
  if (o.memory !== undefined) parts.push(`[长期记忆快照]（这段对话开始时的；之后的变化用 recall 查）\n${o.memory.trim() || "（目前为空）"}`);
  if (o.handoff) parts.push(`[交接]\n以下是上一段对话留下的交接便条，供你延续上下文：\n${o.handoff}`);
  if (!parts.length) return o.text;
  return `${parts.join("\n\n")}\n\n[用户消息]\n${o.text}`;
}
