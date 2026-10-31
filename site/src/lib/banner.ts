// 顶部公告条：构建时把 data/announcements.ts 和 releases.json 整理成当前语言的条目（纯函数，单测见 tests/banner.test.ts）。
// 访客侧还要再筛一遍（关闭记录、时间窗、浏览器语言），在 components/SiteBanner.astro 的内联脚本里。
import { ANNOUNCEMENTS, RELEASE, type Announcement, type BannerLink, type Tone } from "../data/announcements";
import { buildVars, dict, fmt, href, type Lang } from "../i18n";
import type { Dict } from "../i18n/zh";
import { releases } from "./site";

export interface BannerAction { label: string; href: string; external: boolean }
export interface BannerItem {
  id: string;
  kind: "release" | "promo" | "notice";
  tone: Tone;
  /** 带时区的完整时间，浏览器里用 Date.parse 比较 */
  start?: string;
  end?: string;
  tag: string;
  text: string;
  note?: string;
  /** dl：按访客系统换成安装包直链（scripts/banner.ts） */
  cta?: BannerAction & { dl?: boolean };
  link?: BannerAction;
}

const DAY = 864e5;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 部署占位符（{VERSION} 之类）还没替换 */
export const isPlaceholder = (s: string) => /\{[A-Z][A-Z0-9_]*\}/.test(s);

/** 只写日期时按北京时间补成整天：start → 当天 00:00，end → 当天 23:59:59.999 */
export function edge(s: string | undefined, side: "start" | "end"): string | undefined {
  if (!s) return undefined;
  return DATE_ONLY.test(s) ? `${s}T${side === "start" ? "00:00:00" : "23:59:59.999"}+08:00` : s;
}

/** 截止日期的短写法：中文 11 月 30 日，英文 Nov 30（取写在配置里的那个日期，不换算时区） */
export function shortDate(s: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const mo = Number(m[2]), d = Number(m[3]);
  return lang === "zh" ? `${mo} 月 ${d} 日` : `${MON[mo - 1]} ${d}`;
}

function action(l: BannerLink, lang: Lang): BannerAction {
  return { label: l.label, href: l.href.startsWith("/") ? href(lang, l.href) : l.href, external: /^https?:/i.test(l.href) };
}

export interface BannerSource {
  announcements: Announcement[];
  release: { enabled: boolean; days: number; highlights: Record<string, { zh: string; en: string }> };
  releases: { version: string; publishedAt: string };
  t: Dict["banner"];
  vars: Record<string, string | number>;
}

export function buildBannerItems(lang: Lang, src: BannerSource, now = Date.now()): BannerItem[] {
  const { announcements, release, releases: rel, t, vars } = src;
  const items: BannerItem[] = [];

  if (release.enabled && !isPlaceholder(rel.version)) {
    const pub = Date.parse(rel.publishedAt);
    const end = Number.isNaN(pub) ? undefined : new Date(pub + release.days * DAY).toISOString();
    if (!end || Date.parse(end) > now) {
      items.push({
        id: `release-${rel.version}`,
        kind: "release",
        tone: "accent",
        end,
        tag: fmt(t.release.tag, { version: rel.version }),
        text: release.highlights[rel.version]?.[lang] ?? fmt(t.release.text, { version: rel.version }),
        cta: { label: t.release.cta, href: href(lang, "/download"), external: false, dl: true },
        link: { label: t.release.link, href: href(lang, "/changelog"), external: false },
      });
    }
  }

  for (const a of announcements) {
    const start = edge(a.start, "start"), end = edge(a.end, "end");
    if (end && Date.parse(end) <= now) continue;
    const c = a[lang];
    items.push({
      id: a.id,
      kind: a.kind,
      tone: a.tone ?? (a.kind === "promo" ? "promo" : "neutral"),
      start,
      end,
      tag: fmt(c.tag, vars),
      text: fmt(c.text, vars),
      note: a.countdown && a.end ? fmt(t.until, { date: shortDate(a.end, lang) }) : undefined,
      cta: c.cta && action(c.cta, lang),
      link: c.link && action(c.link, lang),
    });
  }
  return items;
}

/** 当前配置下某个语言的条目 */
export const bannerItems = (lang: Lang, now = Date.now()) =>
  buildBannerItems(lang, { announcements: ANNOUNCEMENTS, release: RELEASE, releases, t: dict(lang).banner, vars: buildVars(lang) }, now);
