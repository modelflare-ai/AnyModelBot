import { localizeSnapshotUSD } from "../lib/locale-format";
import type { Dict } from "./zh";
import { RAW_DICTS } from "./catalogs";
import { LOCALES, type Lang } from "./locales";
export { LANGS, READY_LANGS, languageLabel, LOCALES, href, switchHref, normalizeLang, type Lang } from "./locales";
import { pricing, releases } from "../lib/site";

export { RAW_DICTS };
export const DICTS = RAW_DICTS satisfies Record<Lang, Dict>;
export const dict = (lang: Lang): Dict => DICTS[lang];

/** "{a} / {b}" + { a, b } → 文本；未提供的变量原样保留（生产构建的占位符检查会拦下） */
export function fmt(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{([A-Za-z][A-Za-z0-9_.]*)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** 日期本地化：中文 2026-10-30，英文 Oct 30, 2026 */
export function fmtDate(iso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  const time = hh ? ` ${hh}:${mm}` : "";
  if (lang === "zh") return `${y}-${mo}-${d}${time}`;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return new Intl.DateTimeFormat(LOCALES[lang].tag, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date) + time;
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
    sampleMonthly: localizeSnapshotUSD(s.sample.monthly, lang),
    version: releases.version,
    publishedAt: releases.publishedAt,
  };
}
