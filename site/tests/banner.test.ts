import { describe, expect, it } from "vitest";
import { buildBannerItems, edge, isPlaceholder, shortDate, type BannerSource } from "../src/lib/banner";
import { zh } from "../src/i18n/zh";
import { en } from "../src/i18n/en";
import type { Announcement } from "../src/data/announcements";

const NOW = Date.parse("2026-11-10T12:00:00+08:00");
const promo: Announcement = {
  id: "p1", kind: "promo",
  zh: { tag: "活动", text: "{modelCount} 个模型", cta: { label: "看价格", href: "/pricing" }, link: { label: "文档", href: "https://docs.example.com" } },
  en: { tag: "Promo", text: "{modelCount} models", cta: { label: "Pricing", href: "/pricing" } },
};
const src = (over: Partial<BannerSource> = {}, lang: "zh" | "en" = "zh"): BannerSource => ({
  announcements: [promo],
  release: { enabled: true, days: 30, highlights: { "0.2.0": { zh: "亮点", en: "Highlight" } } },
  releases: { version: "0.2.0", publishedAt: "2026-11-01T10:00:00+08:00" },
  t: (lang === "zh" ? zh : en).banner,
  vars: { modelCount: 42 },
  ...over,
});

describe("公告条：时间", () => {
  it("只写日期按北京时间补成整天", () => {
    expect(edge("2026-11-30", "start")).toBe("2026-11-30T00:00:00+08:00");
    expect(edge("2026-11-30", "end")).toBe("2026-11-30T23:59:59.999+08:00");
    expect(edge("2026-11-11T20:00+08:00", "end")).toBe("2026-11-11T20:00+08:00");
    expect(edge(undefined, "start")).toBeUndefined();
  });
  it("截止日期短写法", () => {
    expect(shortDate("2026-11-30", "zh")).toBe("11 月 30 日");
    expect(shortDate("2026-11-30T20:00+08:00", "en")).toBe("Nov 30");
  });
  it("部署占位符", () => {
    expect(isPlaceholder("{VERSION}")).toBe(true);
    expect(isPlaceholder("0.1.10")).toBe(false);
  });
});

describe("公告条：条目", () => {
  it("发版条排第一，用版本亮点，按钮去下载页、可换直链", () => {
    const [rel, p] = buildBannerItems("zh", src(), NOW);
    expect(rel).toMatchObject({ id: "release-0.2.0", kind: "release", tone: "accent", tag: "新版 v0.2.0", text: "亮点" });
    expect(rel.cta).toMatchObject({ href: "/download", dl: true });
    expect(rel.link?.href).toBe("/changelog");
    expect(Date.parse(rel.end!)).toBe(Date.parse("2026-12-01T10:00:00+08:00"));
    expect(p.id).toBe("p1");
  });
  it("没有亮点时用通用文案；英文页链接带 /en 前缀", () => {
    const [rel, p] = buildBannerItems("en", src({ release: { enabled: true, days: 30, highlights: {} } }, "en"), NOW);
    expect(rel.text).toBe("AnyModelBot 0.2.0 is out");
    expect(rel.cta?.href).toBe("/en/download");
    expect(p.cta).toMatchObject({ href: "/en/pricing", external: false });
  });
  it("版本是占位符、关掉了或过了展示期，就没有发版条", () => {
    const ids = (s: BannerSource) => buildBannerItems("zh", s, NOW).map((i) => i.id);
    expect(ids(src({ releases: { version: "{VERSION}", publishedAt: "{PUBLISHED_AT}" } }))).toEqual(["p1"]);
    expect(ids(src({ release: { enabled: false, days: 30, highlights: {} } }))).toEqual(["p1"]);
    expect(ids(src({ releases: { version: "0.2.0", publishedAt: "2026-09-01" } }))).toEqual(["p1"]);
    // 发布日期无效：一直显示
    expect(ids(src({ releases: { version: "0.2.0", publishedAt: "{PUBLISHED_AT}" } }))).toEqual(["release-0.2.0", "p1"]);
  });
  it("宣传条：替换构建变量、默认配色、外链标记", () => {
    const p = buildBannerItems("zh", src(), NOW)[1];
    expect(p).toMatchObject({ tone: "promo", tag: "活动", text: "42 个模型" });
    expect(p.link).toMatchObject({ href: "https://docs.example.com", external: true });
    expect(p.note).toBeUndefined();
  });
  it("时间窗：过期的不输出，没开始的输出（浏览器到点再显示），countdown 带截止日期", () => {
    const list: Announcement[] = [
      { ...promo, id: "old", end: "2026-11-09" },
      { ...promo, id: "today", end: "2026-11-10", countdown: true },
      { ...promo, id: "later", kind: "notice", start: "2026-11-20" },
    ];
    const items = buildBannerItems("zh", src({ announcements: list, release: { enabled: false, days: 30, highlights: {} } }), NOW);
    expect(items.map((i) => i.id)).toEqual(["today", "later"]);
    expect(items[0].note).toBe("截至 11 月 10 日");
    expect(items[1]).toMatchObject({ tone: "neutral", start: "2026-11-20T00:00:00+08:00" });
  });
});
