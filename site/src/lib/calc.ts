// 计算器：每月费用估算（§6.5 D）。不含缓存折扣与请求级倍率；超过分档阈值的请求按更高档计价。
import { tierFor, type PriceRow } from "./pricing";

export interface CalcState { model: string; group: string; msgs: number; inTok: number; outTok: number }
export interface CalcResult { monthly: number; input: number; output: number; perMsg: number; official: number }

export const DAYS = 30;
export const LIMITS = { msgs: [1, 500], inTok: [100, 200_000], outTok: [50, 20_000] } as const;
export const PRESETS = {
  light: { msgs: 20, inTok: 1000, outTok: 300 },
  everyday: { msgs: 50, inTok: 3000, outTok: 600 },
  heavy: { msgs: 200, inTok: 20_000, outTok: 1500 },
} as const;
export type PresetId = keyof typeof PRESETS;

export function estimate(row: PriceRow, s: Omit<CalcState, "model">, days = DAYS): CalcResult {
  const t = tierFor(row, s.inTok);
  const g = row.groups.find((x) => x.id === s.group && !x.conditional) ?? row.groups.find((x) => x.id === row.defaultGroup)!;
  const n = days * s.msgs;
  const input = (n * s.inTok * t.input * g.ratio) / 1e6;
  const output = (n * s.outTok * t.output * g.ratio) / 1e6;
  const monthly = input + output;
  const official = (n * (s.inTok * t.input + s.outTok * t.output)) / 1e6;
  return { monthly, input, output, perMsg: monthly / n, official };
}

/** 计算器可选的线路：默认线路 + 该模型的 award 线路（条件价线路不提供） */
export function calcGroups(row: PriceRow) {
  const def = row.groups.find((g) => g.id === row.defaultGroup)!;
  const award = row.groups.find((g) => g.kind === "award" && !g.conditional);
  return award ? [def, award] : [def];
}

/** 金额：两位小数；< $0.01 显示 "< $0.01"；千分位 */
export function fmtMoney(n: number): string {
  if (n > 0 && n < 0.01) return "< $0.01";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 每条消息：最多 6 位小数，去掉末尾 0 */
export function fmtSmall(n: number): string {
  if (n > 0 && n < 0.000001) return "< $0.000001";
  return "$" + Number(n.toFixed(6)).toString();
}

export const clampInt = (v: unknown, [a, b]: readonly [number, number], d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= a && n <= b ? n : d;
};
