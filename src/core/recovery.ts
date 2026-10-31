/**
 * 重启后告诉用户哪条消息没处理完。
 *
 * 正在处理的消息在 KV 里留一个标记（inflight:<会话>），处理完就删；应用退出或崩溃时还在处理的，标记留了下来。
 * 下次启动时（渠道开始收消息之前）取走这些标记，在原会话里说一次「没处理完，请重新发送」，不自动重发。
 * 启动时发不出去的（微信超过 24 小时窗口或配额用完、渠道没起来）记成 notice:<会话>，等用户在那个会话里
 * 发下一条消息时先说。
 */
import type { Store } from "../store/db.js";
import { t as tr } from "../i18n/index.js";

const INFLIGHT = "inflight:";
const NOTICE = "notice:";

export interface Interrupted {
  conversationId: string;
  /** 那条消息开始处理的时间 */
  at: number;
  /** 那条消息的开头，告诉用户是哪一条 */
  preview: string;
}

/** 消息开头一行，最多 30 个字 */
export function previewOf(text: string): string {
  const line = text.trim().split("\n")[0].trim();
  return line.length > 30 ? `${line.slice(0, 29)}…` : line;
}

/** 告诉用户的话 */
export function interruptedText(preview: string): string {
  return tr("delivery.recovered", { preview: preview ? tr("delivery.quoted", { text: preview }) : "" });
}

/** 开始处理一条消息（同一会话已有标记时保留最早那条） */
export function markInflight(store: Store, conversationId: string, text: string, at = Date.now()): void {
  if (store.getKV(INFLIGHT + conversationId)) return;
  store.setKV(INFLIGHT + conversationId, JSON.stringify({ at, preview: previewOf(text) }));
}

/** 会话里的消息都处理完了 */
export function clearInflight(store: Store, conversationId: string): void {
  store.deleteKV(INFLIGHT + conversationId);
}

/** 启动时取走全部标记（每个只说一次） */
export function takeInterrupted(store: Store): Interrupted[] {
  const out: Interrupted[] = [];
  for (const [key, value] of store.listKV(INFLIGHT)) {
    store.deleteKV(key);
    let v: { at?: unknown; preview?: unknown } = {};
    try {
      v = JSON.parse(value);
    } catch {
      /* 坏标记也照样提醒 */
    }
    out.push({ conversationId: key.slice(INFLIGHT.length), at: Number(v.at) || 0, preview: typeof v.preview === "string" ? v.preview : "" });
  }
  return out;
}

/** 启动时没发出去：等这个会话的下一条消息时再说 */
export function deferNotice(store: Store, conversationId: string, text: string): void {
  store.setKV(NOTICE + conversationId, text);
}

/** 取走会话里等着说的提醒（没有为空） */
export function takeNotice(store: Store, conversationId: string): string {
  const v = store.getKV(NOTICE + conversationId) ?? "";
  if (v) store.deleteKV(NOTICE + conversationId);
  return v;
}
