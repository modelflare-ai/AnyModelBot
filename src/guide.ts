// 上手清单 v2。完成与隐藏是持久状态；渠道跳过与真正连接分别记录。
export const GUIDE_STEPS = ["hello", "memory", "second", "hands", "weixin"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];
export const GUIDE_CHANNELS = ["weixin", "feishu", "telegram", "slack", "discord"] as const;
export type GuideChannel = (typeof GUIDE_CHANNELS)[number];
export interface GuideState {
  version: 2;
  done: GuideStep[];
  hidden: boolean;
  seen: string[];
  skipped: "weixin"[];
  channel?: GuideChannel;
}
export const isGuideChannel = (s: unknown): s is GuideChannel => (GUIDE_CHANNELS as readonly unknown[]).includes(s);
export const isGuideStep = (s: unknown): s is GuideStep => (GUIDE_STEPS as readonly unknown[]).includes(s);
const SEEN_ID = /^[\w-]{1,40}$/;
export function normalizeGuide(v: unknown): GuideState {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const old = Array.isArray(o.done) ? o.done : [];
  const done = GUIDE_STEPS.filter((s) => old.includes(s) || (s === "hands" && old.includes("media")));
  const seen = Array.isArray(o.seen) ? [...new Set(o.seen.filter((x): x is string => typeof x === "string" && SEEN_ID.test(x)))].slice(0, 100) : [];
  if (o.version !== 2 && ["hello", "model", "weixin", "hands", "memory", "media"].every((s) => old.includes(s)) && !seen.includes("completed")) seen.push("completed");
  return { version: 2, done, hidden: o.hidden === true, seen,
    skipped: Array.isArray(o.skipped) && o.skipped.includes("weixin") && !done.includes("weixin") ? ["weixin"] : [],
    ...(isGuideChannel(o.channel) ? { channel: o.channel } : {}) };
}
export const guideComplete = (g: GuideState) => g.seen.includes("completed") || GUIDE_STEPS.every((s) => g.done.includes(s) || (s === "weixin" && g.skipped.includes(s)));
export interface GuideFacts {
  conversations: Array<{ botId?: string; messageCount?: number; model?: string; successfulReply?: boolean; deliveredFile?: boolean }>;
  bots: Array<{ id: string; defaultModel: string; feishuAppId: string }>;
  channelBound: (botId: string) => boolean;
  memoryCount: (botId: string) => number;
}
export function deriveGuide(f: GuideFacts): GuideStep[] {
  const found: GuideStep[] = [];
  if (f.conversations.some((c) => c.successfulReply)) found.push("hello");
  if (f.bots.some((b) => f.memoryCount(b.id) > 0)) found.push("memory");
  if (f.conversations.some((c) => c.botId && c.botId !== "default" && c.successfulReply)) found.push("second");
  if (f.conversations.some((c) => c.deliveredFile)) found.push("hands");
  if (f.bots.some((b) => f.channelBound(b.id))) found.push("weixin");
  return found;
}
export function mergeGuide(g: GuideState, extra: readonly GuideStep[]): GuideState {
  return normalizeGuide({ ...g, done: [...g.done, ...extra] });
}
