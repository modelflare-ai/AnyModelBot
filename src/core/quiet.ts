/**
 * 主人的本地时间与免打扰时段（设计文档第 6 节、决定 4）：默认 22:00–08:00，按主人的时区（本机的 IANA 时区）算，
 * 跨午夜的时段也行。夏令时切换那天按本地钟面时间对齐。
 */

import { t as tr } from "../i18n/index.js";
export interface QuietHours {
  enabled: boolean;
  /** "22:00" */
  from: string;
  /** "08:00" */
  to: string;
}

export const DEFAULT_QUIET: QuietHours = { enabled: true, from: "22:00", to: "08:00" };

const MIN = 60_000;
const DAY = 1440;

/** 本机的时区（主人的时区） */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "22:00" → 1320；格式不对返回 undefined */
export function minuteOf(hhmm: string): number | undefined {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    fmts.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ts 在 tz 里的日期、星期（0 = 周日）和一天里的第几分钟（带秒的小数） */
export function localParts(ts: number, tz: string): { y: number; mo: number; d: number; weekday: number; minute: number } {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(ts)) p[x.type] = x.value;
  const ms = ((ts % 1000) + 1000) % 1000;
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    weekday: WEEKDAYS.indexOf(p.weekday),
    minute: Number(p.hour) * 60 + Number(p.minute) + (Number(p.second) + ms / 1000) / 60,
  };
}

/** ts 之后（不含）第一次到本地 minute 分的时刻 */
export function nextAt(ts: number, minute: number, tz: string): number {
  let delta = minute - localParts(ts, tz).minute;
  if (delta <= 0) delta += DAY;
  let t = ts + Math.round(delta * MIN);
  // 夏令时那天差一小时：按钟面时间再对一次
  const off = minute - Math.round(localParts(t, tz).minute);
  if (off && Math.abs(off) <= 120) t += off * MIN;
  return t;
}

/** ts 及之前最后一次到本地 minute 分的时刻 */
export function prevAt(ts: number, minute: number, tz: string): number {
  const t = nextAt(ts - DAY * MIN, minute, tz);
  return t > ts ? nextAt(ts - 2 * DAY * MIN, minute, tz) : t;
}

/** 本地这一天的 0 点 */
export function startOfDay(ts: number, tz: string): number {
  return prevAt(ts, 0, tz);
}

function range(q: QuietHours): [number, number] | undefined {
  const s = minuteOf(q.from);
  const e = minuteOf(q.to);
  if (!q.enabled || s === undefined || e === undefined || s === e) return undefined;
  return [s, e];
}

/** ts 在免打扰时段里 */
export function inQuiet(ts: number, q: QuietHours, tz: string): boolean {
  const r = range(q);
  if (!r) return false;
  const m = localParts(ts, tz).minute;
  return r[0] < r[1] ? m >= r[0] && m < r[1] : m >= r[0] || m < r[1];
}

/** 在免打扰时段里时：这段结束的时刻；不在时就是 ts */
export function quietEnd(ts: number, q: QuietHours, tz: string): number {
  const r = range(q);
  return r && inQuiet(ts, q, tz) ? nextAt(ts, r[1], tz) : ts;
}

/** 在免打扰时段里时：这段开始的时刻；不在时就是 ts */
export function quietStart(ts: number, q: QuietHours, tz: string): number {
  const r = range(q);
  return r && inQuiet(ts, q, tz) ? prevAt(ts, r[0], tz) : ts;
}

/** 最早能发主动消息的时刻：ts 不在免打扰时段里就是 ts，在就是这段结束时 */
export function allowedAt(ts: number, q: QuietHours, tz: string): number {
  return quietEnd(ts, q, tz);
}


/** 给用户看的时间（按当前语言）：今天 21:30、今晚 22:00、明早 8:00、明天 15:00、周一 9:00、11月3日 9:00 */
export function fmtWhen(at: number, now: number, tz: string): string {
  const a = localParts(at, tz);
  const m = Math.floor(a.minute);
  const hm = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  const days = Math.round((startOfDay(at, tz) - startOfDay(now, tz)) / (DAY * MIN));
  if (days <= 0) return tr(m >= 18 * 60 ? "delivery.tonight" : "delivery.today", { hm });
  if (days === 1) return tr(m < 12 * 60 ? "delivery.tomorrowMorning" : "delivery.tomorrow", { hm });
  if (days < 7) return tr(`delivery.weekday${a.weekday}` as "delivery.weekday0", { hm });
  return tr("delivery.date", { month: tr(`delivery.month${a.mo}` as "delivery.month1"), d: a.d, hm });
}
