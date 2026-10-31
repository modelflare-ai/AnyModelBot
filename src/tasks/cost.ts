/**
 * 花费与预算（设计文档第 8 节，3e）：估算一次运行花了多少、各级预算的默认值。
 *
 * - 估算：任务、规则会话的订阅已经看到的 assistant/message 事件带着这次模型请求的用量（DSH 的 inputTokens 不含缓存命中和写入，
 *   它们另算 cacheReadTokens、cacheWriteTokens），乘上 Modelflare 的参考价（account/model-info.ts 的 rates，美元 / 百万 tokens）。
 *   存在 runs.cost_usd 上，任务累加到 tasks.spent_usd，规则按月从 runs 汇总。界面上写「约」：账单为准。
 * - 拿不到价格（外部端点、目录里没有这个模型、离线）就不算，预算也就不起作用；时间上限照常。
 */
import type { Rates } from "../account/model-info.js";

export type { Rates };

/** 任务的预算（建任务时、之后都能改） */
export const TASK_BUDGET_USD = 1;
/** 预算用完时「再给 $1 继续？」每次加多少 */
export const TASK_BUDGET_STEP_USD = 1;
/** 一个任务的预算最多到多少（防手滑） */
export const TASK_BUDGET_MAX_USD = 1000;
/** 规则每次运行的预算 */
export const RULE_RUN_BUDGET_USD = 0.1;
/** 规则每月的预算；用完暂停，「再给 $3」每次加多少 */
export const RULE_MONTH_BUDGET_USD = 3;
/** 机器人有 Modelflare 预算 Key 时：剩下的不到总额的这一份就停后台工作，留给聊天 */
export const RESERVE_SHARE = 0.2;
/** 任务每次运行最多跑多久（不算等人批准的时间） */
export const TASK_RUN_CAP_MS = 4 * 3600_000;

/** 预算用完时问用户的那个提问（审批中心里 tool 记成它，回答由任务服务处理，不交给模型） */
export const BUDGET_TOOL = "task_budget";

/** DSH assistant/message 事件里的用量（一次模型请求） */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** 一次模型请求的花费（美元）；没有价格就是 0。缓存命中、写入没有单独的价时按输入价算（宁可多估） */
export function costOf(u: Usage | undefined, r: Rates | undefined): number {
  if (!u || !r) return 0;
  const input = n(r.input);
  const usd = n(u.inputTokens) * input + n(u.outputTokens) * n(r.output ?? input) + n(u.cacheReadTokens) * (r.cacheRead ?? input) + n(u.cacheWriteTokens) * (r.cacheWrite ?? input);
  return usd / 1_000_000;
}

/** 给人看的金额：$1.00、$0.08；不到半分的写 <$0.01 */
export function usdText(v: number): string {
  if (v > 0 && v < 0.005) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

/** 加预算时的金额：$1、$3、$0.50 */
export function stepText(v: number): string {
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}
