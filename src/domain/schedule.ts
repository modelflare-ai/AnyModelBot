/** 规则的触发时间（存在 rules.trigger_spec 列里）。解析、算下一次、说明文字在 tasks/schedule.ts。 */
export type Schedule =
  | { kind: "once"; at: number; tz: string }
  /** days：0 = 周日；没有 = 每天 */
  | { kind: "daily"; time: string; days?: number[]; tz: string }
  | { kind: "weekly"; time: string; days: number[]; tz: string }
  /** 不存在的日期落在当月最后一天。 */
  | { kind: "monthly"; time: string; day: number | "last"; tz: string }
  /** from：第一次的时间（之后每 minutes 分钟一次） */
  | { kind: "every"; minutes: number; from: number; tz: string }
  | { kind: "cron"; cron: string; tz: string };
