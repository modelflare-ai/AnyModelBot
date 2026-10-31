// 时间与时长的显示，跟着界面语言（文案在 ui/locales/<语言>/time.js，日期部分交给 Intl）。
import { t, locale } from "./i18n.js";

const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateFmt = (opts) => new Intl.DateTimeFormat(locale(), opts);

/** 消息流里的时间分隔条："今天 15:33" / "昨天 09:10" / "10月26日 14:00" / "2025年3月1日 08:00"（英文：Today 15:33 / Oct 26 14:00 / Mar 1, 2025 08:00） */
export function fmtSep(at) {
  const d = new Date(at);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return t("time.today", { time: hm(d) });
  if (diff === 1) return t("time.yesterday", { time: hm(d) });
  const date = dateFmt(d.getFullYear() === now.getFullYear() ? { month: locale() === "en" ? "short" : "long", day: "numeric" } : { year: "numeric", month: locale() === "en" ? "short" : "long", day: "numeric" }).format(d);
  return t("time.dateTime", { date, time: hm(d) });
}

/** 列表里的相对时间："刚刚" / "5 分钟前" / "15:33" / "10月26日" */
export function fmtAgo(at) {
  if (!at) return "";
  const s = (Date.now() - at) / 1000;
  if (s < 60) return t("time.justNow");
  if (s < 3600) return t("time.minutesAgo", { count: Math.floor(s / 60) });
  const d = new Date(at);
  if (new Date().toDateString() === d.toDateString()) return hm(d);
  return dateFmt({ month: locale() === "en" ? "short" : "long", day: "numeric" }).format(d);
}

/** 消息旁的时刻："15:33" */
export const fmtClock = (at) => (at ? hm(new Date(at)) : "");

/** 一段工作的用时："12 秒" / "1 分 24 秒"（英文：12s / 1m 24s） */
export function fmtDur(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? t("time.seconds", { s }) : t("time.minSec", { m: Math.floor(s / 60), s: s % 60 });
}

/** 完整的日期时间（24 小时制） */
export function fmtTime(at) {
  return at ? new Date(at).toLocaleString(locale(), { hour12: false }) : "";
}

/** 只有时刻（带秒）："15:33:08" */
export function fmtTimeOfDay(at) {
  return at ? new Date(at).toLocaleTimeString(locale(), { hour12: false }) : "";
}

/** 只有日期："11月4日"（英文：Nov 4） */
export function fmtDay(at) {
  return at ? dateFmt({ month: locale() === "en" ? "short" : "long", day: "numeric" }).format(new Date(at)) : "";
}

/** 文件大小："900 B" / "12 KB" / "2.4 MB" / "1.1 GB" */
export function fmtSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) (x /= 1024), i++;
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}
