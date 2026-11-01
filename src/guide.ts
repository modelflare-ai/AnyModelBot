// 新手引导（界面里的「上手清单」）：进度存在 config.json 的 ui.guide。
// 有些步骤能从现有数据看出来已经做过（有过回复、换过模型、绑了微信或飞书、记下过东西），读取时并进去，
// 老用户升级后不会被要求从头再做一遍；其余步骤（动手、生图）由界面在看到结果时标记。

export const GUIDE_STEPS = ["hello", "model", "weixin", "hands", "memory", "media"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

export interface GuideState {
  /** 做过的步骤（按清单顺序） */
  done: GuideStep[];
  /** 整个清单不再显示（清单浮层里的「不再显示」） */
  hidden: boolean;
  /** 看过的一次性提示：intro = 对话空状态里的清单卡已收起；以后的「随用随教」提示也记在这里 */
  seen: string[];
}

export const isGuideStep = (s: unknown): s is GuideStep => (GUIDE_STEPS as readonly unknown[]).includes(s);

const SEEN_ID = /^[\w-]{1,40}$/;

export function normalizeGuide(v: unknown): GuideState {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const done = Array.isArray(o.done) ? GUIDE_STEPS.filter((s) => (o.done as unknown[]).includes(s)) : [];
  const seen = Array.isArray(o.seen) ? [...new Set(o.seen.filter((x): x is string => typeof x === "string" && SEEN_ID.test(x)))].slice(0, 100) : [];
  return { done, hidden: o.hidden === true, seen };
}

/** 推导需要的数据，由调用方从 store / 记忆里取（便于测试） */
export interface GuideFacts {
  conversations: Array<{ messageCount: number; model: string }>;
  bots: Array<{ id: string; defaultModel: string; feishuAppId: string }>;
  /** 微信扫码绑定了，或者连上了 Telegram、Slack、Discord */
  channelBound: (botId: string) => boolean;
  memoryCount: (botId: string) => number;
}

export function deriveGuide(f: GuideFacts): GuideStep[] {
  const out: GuideStep[] = [];
  // 一问一答至少两条消息
  if (f.conversations.some((c) => c.messageCount >= 2)) out.push("hello");
  if (f.conversations.some((c) => c.model) || f.bots.some((b) => b.defaultModel)) out.push("model");
  if (f.bots.some((b) => b.feishuAppId || f.channelBound(b.id))) out.push("weixin");
  if (f.bots.some((b) => f.memoryCount(b.id) > 0)) out.push("memory");
  return out;
}

/** 合并：已记录的 + 推导出的，保持清单顺序 */
export function mergeGuide(g: GuideState, extra: readonly GuideStep[]): GuideState {
  return { ...g, done: GUIDE_STEPS.filter((s) => g.done.includes(s) || extra.includes(s)) };
}
