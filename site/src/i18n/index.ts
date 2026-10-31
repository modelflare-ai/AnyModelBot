import { zh, type Dict } from "./zh";
import { en } from "./en";
import { pricing, releases } from "../lib/site";

export type Lang = "zh" | "en";
export const LANGS: Lang[] = ["zh", "en"];
export const dict = (lang: Lang): Dict => (lang === "en" ? en : zh);

/** "{a} / {b}" + { a, b } → 文本；未提供的变量原样保留（生产构建的占位符检查会拦下） */
export function fmt(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{([A-Za-z][A-Za-z0-9_.]*)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** 站内链接：中文在根路径，英文在 /en/ */
export const href = (lang: Lang, p: string) => (lang === "en" ? `/en${p === "/" ? "/" : p}` : p);
export const altLang = (lang: Lang): Lang => (lang === "zh" ? "en" : "zh");
/** 切换语言时去的路径：404 只有一份，切到另一语言的首页 */
export const switchHref = (lang: Lang, p: string) => href(altLang(lang), p === "/404" ? "/" : p);

/** 日期本地化：中文 2026-10-30，英文 Oct 30, 2026 */
export function fmtDate(iso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  const time = hh ? ` ${hh}:${mm}` : "";
  if (lang === "zh") return `${y}-${mo}-${d}${time}`;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mo) - 1];
  return `${mon} ${Number(d)}, ${y}${time}`;
}

/** 构建时变量（§13.2）：价格与下载数据 */
export function buildVars(lang: Lang): Record<string, string | number> {
  const s = pricing;
  return {
    fetchedAt: fmtDate(s.fetchedAt, lang),
    snapshotDate: fmtDate(s.fetchedAt, lang),
    pricingVersion: s.pricingVersion,
    modelCount: s.counts.models,
    vendorCount: s.counts.vendors,
    textCount: s.counts.text,
    mediaCount: s.counts.media,
    sampleModel: s.sample.model,
    sampleMonthly: s.sample.monthly,
    version: releases.version,
    publishedAt: releases.publishedAt,
  };
}
