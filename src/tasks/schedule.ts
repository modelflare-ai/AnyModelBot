/**
 * 规则的时间表（设计文档第 4 节）：once(at)、daily(time, days?)、weekly(days, time)、every(N 分钟，N ≥ 15)、cron（高级）。
 * 时区是建规则时本机的 IANA 时区，存在时间表里；按本地钟面时间算，夏令时那天：跳过的那一小时里的时刻顺延到跳过之后
 * （02:30 → 03:30），重复的那一小时取第一次。every 按绝对时间，从起点一格一格往后排。
 *
 * - nextRun：after 之后（不含）第一次到点；latestRun：t 及之前最后一次到点（错过的补跑只补最近的一次）。
 * - graceOf：错过多久之内还补跑一次（间隔的一半和 2 小时取小的）；更早的记为跳过，从不补一串。
 * - parseSchedule：聊天代理给的一行（"daily 08:00"、"weekly mon,thu 09:00"、"every 30m"、"once 2026-11-02 15:00"、"cron 0 8 * * 1-5"）。
 * - describe：给用户看的话：每天 08:00、每个工作日 08:00、每周一、周四 09:00、每 30 分钟、11月2日 15:00。
 */
import { localParts, minuteOf } from "../core/quiet.js";

export type Schedule =
  | { kind: "once"; at: number; tz: string }
  /** days：0 = 周日；没有 = 每天 */
  | { kind: "daily"; time: string; days?: number[]; tz: string }
  | { kind: "weekly"; time: string; days: number[]; tz: string }
  /** from：第一次的时间（之后每 minutes 分钟一次） */
  | { kind: "every"; minutes: number; from: number; tz: string }
  | { kind: "cron"; cron: string; tz: string };

/** every 最短间隔 */
export const MIN_EVERY_MIN = 15;
/** 错过之后最多多久内还补跑 */
export const MAX_GRACE_MS = 2 * 3600_000;

const MIN = 60_000;
const DAY_MS = 86_400_000;

/** ts 在 tz 里的钟面时间（当作 UTC 的毫秒数）减去 ts：这一刻的时区偏移 */
function offsetAt(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  const wall = Date.UTC(p.y, p.mo - 1, p.d) + p.minute * MIN;
  return Math.round((wall - ts) / MIN) * MIN;
}

/**
 * 本地日期 y-mo-d 的第 minute 分钟是哪一刻。夏令时：重复的那一小时取第一次；跳过的那一小时里的时刻顺延到跳过之后
 * （按切换前的偏移算，和 Temporal 的 compatible 一样）。
 */
export function localTime(y: number, mo: number, d: number, minute: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d) + minute * MIN;
  const before = guess - offsetAt(guess - DAY_MS / 2, tz);
  const after = guess - offsetAt(guess + DAY_MS / 2, tz);
  const ok = (t: number) => {
    const p = localParts(t, tz);
    return p.y === y && p.mo === mo && p.d === d && Math.floor(p.minute) === minute;
  };
  const valid = [before, after].filter(ok);
  return valid.length ? Math.min(...valid) : before;
}

/** 从 ts 所在的本地日期起第 i 天（i 可以是负数）：年、月、日、星期 */
function dayAt(ts: number, i: number, tz: string): { y: number; mo: number; d: number; weekday: number } {
  const p = localParts(ts, tz);
  const u = new Date(Date.UTC(p.y, p.mo - 1, p.d + i));
  return { y: u.getUTCFullYear(), mo: u.getUTCMonth() + 1, d: u.getUTCDate(), weekday: u.getUTCDay() };
}

// ---------- cron（分 时 日 月 星期；* , - /） ----------

interface Cron {
  minutes: number[];
  hours: number[];
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

function cronField(f: string, lo: number, hi: number): number[] | undefined {
  const out = new Set<number>();
  for (const part of f.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return undefined;
    const step = m[4] ? Number(m[4]) : 1;
    const a = m[1] === "*" ? lo : Number(m[2]);
    const b = m[1] === "*" ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    if (!(step >= 1) || a < lo || b > hi || a > b) return undefined;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

export function parseCron(expr: string): Cron | undefined {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return undefined;
  const minutes = cronField(f[0], 0, 59);
  const hours = cronField(f[1], 0, 23);
  const dom = cronField(f[2], 1, 31);
  const months = cronField(f[3], 1, 12);
  // 星期 0–7，7 也是周日
  const dow = cronField(f[4], 0, 7);
  if (!minutes || !hours || !dom || !months || !dow) return undefined;
  return {
    minutes,
    hours,
    dom: new Set(dom),
    months: new Set(months),
    dow: new Set(dow.map((x) => x % 7)),
    domAny: f[2] === "*",
    dowAny: f[4] === "*",
  };
}

/** 这一天合不合 cron 的日、月、星期（日和星期都限定时，满足一个就行，和 cron 一样） */
function cronDay(c: Cron, day: { mo: number; d: number; weekday: number }): boolean {
  if (!c.months.has(day.mo)) return false;
  const dom = c.dom.has(day.d);
  const dow = c.dow.has(day.weekday);
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dow;
  if (c.dowAny) return dom;
  return dom || dow;
}

// ---------- 下一次、上一次 ----------

/** 这一天里到点的分钟（本地），从小到大；这一天不跑就是空的 */
function minutesOn(s: Schedule, day: { mo: number; d: number; weekday: number }, cron?: Cron): number[] {
  if (s.kind === "daily" || s.kind === "weekly") {
    const m = minuteOf(s.time);
    if (m === undefined) return [];
    if (s.days?.length && !s.days.includes(day.weekday)) return [];
    return [m];
  }
  if (s.kind === "cron" && cron) {
    if (!cronDay(cron, day)) return [];
    return cron.hours.flatMap((h) => cron.minutes.map((m) => h * 60 + m));
  }
  return [];
}

/** 按日历找的那几种（每天、每周、cron）最多往前、往后看多少天 */
const SCAN_DAYS = 400;

/** after 之后（不含）第一次到点；没有了（once 已经过了）就是 undefined */
export function nextRun(s: Schedule, after: number): number | undefined {
  if (s.kind === "once") return s.at > after ? s.at : undefined;
  if (s.kind === "every") {
    const step = s.minutes * MIN;
    if (after < s.from) return s.from;
    return s.from + (Math.floor((after - s.from) / step) + 1) * step;
  }
  const cron = s.kind === "cron" ? parseCron(s.cron) : undefined;
  if (s.kind === "cron" && !cron) return undefined;
  for (let i = 0; i <= SCAN_DAYS; i++) {
    const day = dayAt(after, i, s.tz);
    for (const m of minutesOn(s, day, cron)) {
      const t = localTime(day.y, day.mo, day.d, m, s.tz);
      if (t > after) return t;
    }
  }
  return undefined;
}

/** t 及之前最后一次到点（不早于 since）；没有就是 undefined */
export function latestRun(s: Schedule, t: number, since = -Infinity): number | undefined {
  if (s.kind === "once") return s.at <= t && s.at >= since ? s.at : undefined;
  if (s.kind === "every") {
    if (t < s.from) return undefined;
    const step = s.minutes * MIN;
    const v = s.from + Math.floor((t - s.from) / step) * step;
    return v >= since ? v : undefined;
  }
  const cron = s.kind === "cron" ? parseCron(s.cron) : undefined;
  if (s.kind === "cron" && !cron) return undefined;
  for (let i = 0; i >= -SCAN_DAYS; i--) {
    const day = dayAt(t, i, s.tz);
    const list = minutesOn(s, day, cron);
    for (let k = list.length - 1; k >= 0; k--) {
      const v = localTime(day.y, day.mo, day.d, list[k], s.tz);
      if (v <= t) return v >= since ? v : undefined;
    }
    // 这一天整个都在 since 之前（多留一天给时区偏移）：再往前也不会有
    if (Date.UTC(day.y, day.mo - 1, day.d) < since - DAY_MS) return undefined;
  }
  return undefined;
}

/** 大约多久跑一次（毫秒）：every 是间隔，cron 看从 ref 起的两次之间，其余一天或更长 */
export function intervalOf(s: Schedule, ref: number): number {
  if (s.kind === "every") return s.minutes * MIN;
  if (s.kind === "cron") {
    const a = nextRun(s, ref);
    const b = a === undefined ? undefined : nextRun(s, a);
    return a !== undefined && b !== undefined ? b - a : DAY_MS;
  }
  return DAY_MS;
}

/** 错过多久之内还补跑一次：间隔的一半和 2 小时取小的 */
export function graceOf(s: Schedule, ref: number): number {
  return Math.min(MAX_GRACE_MS, intervalOf(s, ref) / 2);
}

// ---------- 校验、解析、给人看的话 ----------

const DAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function dayList(text: string): number[] | undefined {
  const out = new Set<number>();
  for (const raw of text.split(/[,，、\s]+/).filter(Boolean)) {
    const w = raw.toLowerCase().replace(/^(周|星期|礼拜)/, "").slice(0, 3);
    const n = /^\d$/.test(w) ? Number(w) % 7 : DAY_NAMES[w];
    if (n === undefined) return undefined;
    out.add(n);
  }
  return out.size ? [...out].sort((a, b) => a - b) : undefined;
}

const hhmm = (s: string): string | undefined => {
  const m = /^(\d{1,2})[:：](\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const t = `${m[1].padStart(2, "0")}:${m[2]}`;
  return minuteOf(t) !== undefined ? t : undefined;
};

/**
 * 校验界面或接口给的结构化时间表（JSON），补上时区；有错时 error 是给人看的一句话。
 * now：once 不能在过去；every 没给起点就从下一个整分钟起。
 */
export function normalizeSchedule(raw: unknown, tz: string, now: number): { schedule?: Schedule; error?: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const zone = typeof r.tz === "string" && validZone(r.tz) ? r.tz : tz;
  switch (r.kind) {
    case "once": {
      const at = Number(r.at);
      if (!Number.isFinite(at) || at <= 0) return { error: "缺少时间" };
      if (at <= now) return { error: "这个时间已经过了" };
      return { schedule: { kind: "once", at: Math.floor(at / MIN) * MIN, tz: zone } };
    }
    case "daily":
    case "weekly": {
      const time = hhmm(String(r.time ?? ""));
      if (!time) return { error: "时间要写成 08:00 这样" };
      const days = Array.isArray(r.days) ? [...new Set(r.days.map((d) => Number(d) % 7).filter((d) => Number.isInteger(d) && d >= 0))].sort((a, b) => a - b) : [];
      if (r.kind === "weekly" && !days.length) return { error: "选一天或几天" };
      if (r.kind === "weekly") return { schedule: { kind: "weekly", time, days, tz: zone } };
      return { schedule: { kind: "daily", time, ...(days.length && days.length < 7 ? { days } : {}), tz: zone } };
    }
    case "every": {
      const minutes = Math.round(Number(r.minutes));
      if (!Number.isFinite(minutes) || minutes < MIN_EVERY_MIN) return { error: `间隔至少 ${MIN_EVERY_MIN} 分钟` };
      if (minutes > 7 * 1440) return { error: "间隔最长 7 天" };
      const from = Number(r.from) > 0 ? Number(r.from) : Math.ceil((now + 1) / MIN) * MIN;
      return { schedule: { kind: "every", minutes, from, tz: zone } };
    }
    case "cron": {
      const cron = String(r.cron ?? "").trim().replace(/\s+/g, " ");
      if (!parseCron(cron)) return { error: "cron 要写 5 段：分 时 日 月 星期" };
      return { schedule: { kind: "cron", cron, tz: zone } };
    }
    default:
      return { error: "不认识的时间表" };
  }
}

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * 聊天代理给的一行（rule_create 的 schedule）：once 2026-11-02 15:00 | daily 08:00 | weekdays 08:00 | weekly mon,thu 09:00 |
 * every 30m（或 2h、30 minutes） | cron 0 8 * * 1-5。时间是 tz 里的本地时间。
 */
export function parseSchedule(text: string, tz: string, now: number): { schedule?: Schedule; error?: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const [head, ...rest] = t.split(" ");
  const tail = rest.join(" ");
  const kind = head.toLowerCase();
  const bad = { error: `Unrecognized schedule "${t}". Use one of: once YYYY-MM-DD HH:MM | daily HH:MM | weekdays HH:MM | weekly mon,thu HH:MM | every 30m | cron M H DOM MON DOW` };
  if (kind === "daily" || kind === "weekdays" || kind === "weekends") {
    const time = hhmm(tail);
    if (!time) return bad;
    return normalizeSchedule({ kind: "daily", time, days: kind === "weekdays" ? [1, 2, 3, 4, 5] : kind === "weekends" ? [0, 6] : [] }, tz, now);
  }
  if (kind === "weekly") {
    const m = /^(.+?) (\d{1,2}[:：]\d{2})$/.exec(tail);
    const days = m ? dayList(m[1]) : undefined;
    if (!m || !days) return bad;
    return normalizeSchedule({ kind: "weekly", time: m[2], days }, tz, now);
  }
  if (kind === "every") {
    const m = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/i.exec(tail);
    if (!m) return bad;
    const n = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1);
    const r = normalizeSchedule({ kind: "every", minutes: n }, tz, now);
    return r.error ? { error: `every needs at least ${MIN_EVERY_MIN} minutes` } : r;
  }
  if (kind === "once") {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}[:：]\d{2})$/.exec(tail);
    const time = m ? hhmm(m[4]) : undefined;
    if (!m || !time) return bad;
    const at = localTime(Number(m[1]), Number(m[2]), Number(m[3]), minuteOf(time)!, tz);
    const r = normalizeSchedule({ kind: "once", at }, tz, now);
    return r.error ? { error: `That time (${tail}, ${tz}) has already passed.` } : r;
  }
  if (kind === "cron") {
    const r = normalizeSchedule({ kind: "cron", cron: tail }, tz, now);
    return r.error ? { error: "cron needs 5 fields: minute hour day-of-month month day-of-week" } : r;
  }
  return bad;
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const pad = (n: number) => String(n).padStart(2, "0");

function daysText(days: number[] | undefined): string {
  if (!days?.length || days.length === 7) return "每天";
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "每个工作日";
  if (key === "0,6") return "每个周末";
  // 周一在前、周日在最后
  return "每" + [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEK[d]).join("、");
}

/** 给用户看的时间表：每天 08:00、每个工作日 08:00、每周一、周四 09:00、每 30 分钟、11月2日 15:00；withZone 时带上时区 */
export function describe(s: Schedule, withZone = false): string {
  let text: string;
  if (s.kind === "once") {
    const p = localParts(s.at, s.tz);
    const m = Math.floor(p.minute);
    text = `${p.mo}月${p.d}日 ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  } else if (s.kind === "daily" || s.kind === "weekly") text = `${daysText(s.days)} ${s.time}`;
  else if (s.kind === "every") text = s.minutes % 60 === 0 ? `每 ${s.minutes / 60} 小时` : `每 ${s.minutes} 分钟`;
  else text = `cron ${s.cron}`;
  return withZone ? `${text}（${s.tz}）` : text;
}
