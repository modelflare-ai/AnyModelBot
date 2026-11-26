import { describe, expect, it } from "vitest";
import { LANGS, LOCALES, href, normalizeLang, switchHref } from "../src/i18n/locales";
import siteManifest from "../src/i18n/manifest.json";
import appManifest from "../../ui/locales/manifest.json";
import { fmtMoney, fmtSmall } from "../src/lib/calc";
import { fmtPrice } from "../src/lib/pricing";
import { localizeSnapshotUSD } from "../src/lib/locale-format";
import { headingUnits } from "../src/lib/heading-units";

describe("locale URLs and presentation", () => {
  it("keeps Korean words and Japanese loanwords together in animated headings", () => {
    expect(headingUnits("내 기기에서 실행하는", "ko")).toContain("기기에서");
    expect(headingUnits("あなたのデバイスで動く", "ja")).toContain("デバイス");
    expect(headingUnits("AI アシスタント", "ja")).toContain("アシスタント");
    expect(headingUnits("繁體中文", "zh-TW")).toEqual(["繁", "體", "中", "文"]);
    expect(headingUnits("Hello world", "en").join("")).toBe("Hello world");
  });
  it("keeps the app and standalone site's language manifests in sync", () => {
    expect(siteManifest).toEqual(appManifest);
    expect([...LANGS]).toEqual(appManifest.locales.map((l) => l.siteCode));
  });
  it.each([["ja-JP", "ja"], ["ko_KR.UTF-8", "ko"], ["ru-RU", "ru"], ["es-419", "es"], ["pt-BR", "pt"], ["pt_PT.UTF-8", "pt"], ["tr-TR", "tr"], ["tr_TR.UTF-8", "tr"], ["zh-Hans", "zh"], ["zh-Hans-TW", "zh"], ["zh_TW.UTF-8", "zh-TW"], ["zh-Hant-HK", "zh-TW"], ["zh-MO", "zh-TW"], ["english", undefined]])("recognizes complete language subtags: %s", (input, expected) => {
    expect(normalizeLang(input!)).toBe(expected);
  });
  it("preserves pages, query strings and fragments across language links", () => {
    for (const lang of LANGS) {
      expect(switchHref(lang, "/pricing?m=demo#calc")).toBe(`${lang === "zh" ? "" : `/${lang}`}/pricing?m=demo#calc`);
      expect(switchHref(lang, "/404")).toBe(href(lang, "/"));
      expect(LOCALES[lang].tag).toBe(lang === "zh" ? "zh-CN" : lang === "pt" ? "pt-BR" : lang);
    }
  });
  it("formats Russian decimal separators while keeping prices in US dollars", () => {
    expect(fmtMoney(1234.5, "ru").replaceAll("\u00a0", " ")).toBe("1 234,50 $");
    expect(fmtMoney(0.001, "ru").replaceAll("\u00a0", " ")).toBe("< 0,01 $");
    expect(fmtSmall(0.001234, "ru").replaceAll("\u00a0", " ")).toBe("0,001234 $");
    expect(fmtPrice(0.25, "ja")).toBe("$0.25");
    expect(fmtPrice(0.25, "ko")).toBe("$0.25");
    expect(localizeSnapshotUSD("$1.20", "ru").replaceAll("\u00a0", " ")).toBe("1,20 $");
    expect(fmtMoney(1234.5, "es").replaceAll("\u00a0", " ")).toBe("1.234,50 $");
    expect(fmtMoney(1234.5, "pt").replaceAll("\u00a0", " ")).toBe("$ 1.234,50");
  });
});
