import type { Store, WeixinPeer } from "../../store/db.js";

/**
 * iLink 出站配额：每收到用户一条消息后，24 小时内最多可向该用户发送 10 条。
 * 发送方在每条 sendmessage 前调用 tryConsume；超额的内容会被合并/丢弃并记录。
 */
export const QUOTA_PER_INBOUND = 10;
export const QUOTA_WINDOW_MS = 24 * 3600_000;

export class WeixinQuota {
  /** 现在要给主动消息（任务结果等）留几条：聊天回复只能用 remaining − reserved（core/delivery.ts 设） */
  reserver: ((userId: string) => number) | undefined;

  constructor(private store: Store, private botId: string, private now: () => number = Date.now) {}

  reserved(userId: string): number {
    try {
      return Math.max(0, this.reserver?.(userId) ?? 0);
    } catch {
      return 0;
    }
  }

  onInbound(userId: string, contextToken: string): WeixinPeer {
    const peer: WeixinPeer = {
      botId: this.botId,
      userId,
      contextToken: contextToken || this.store.getWeixinPeer(this.botId, userId)?.contextToken || "",
      quotaRemaining: QUOTA_PER_INBOUND,
      windowStartedAt: this.now(),
    };
    this.store.upsertWeixinPeer(peer);
    return peer;
  }

  peer(userId: string): WeixinPeer | undefined {
    return this.store.getWeixinPeer(this.botId, userId);
  }

  /** 会话凭证还在 24 小时窗口内（对方最近发过消息） */
  open(userId: string): boolean {
    const p = this.peer(userId);
    return !!p?.contextToken && this.now() - p.windowStartedAt <= QUOTA_WINDOW_MS;
  }

  remaining(userId: string): number {
    const p = this.store.getWeixinPeer(this.botId, userId);
    if (!p) return 0;
    if (this.now() - p.windowStartedAt > QUOTA_WINDOW_MS) return 0;
    return p.quotaRemaining;
  }

  tryConsume(userId: string): boolean {
    const p = this.store.getWeixinPeer(this.botId, userId);
    if (!p || this.remaining(userId) <= 0) return false;
    this.store.upsertWeixinPeer({ ...p, quotaRemaining: p.quotaRemaining - 1 });
    return true;
  }
}
