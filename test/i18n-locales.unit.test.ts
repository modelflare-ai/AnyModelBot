import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfigFile } from "../src/config.js";
// @ts-expect-error Browser catalogs and the shared validator use native JS.
import { inspectLocale } from "../scripts/lib/locale-check.mjs";
// @ts-expect-error Browser i18n is an unbundled JS module.
import * as ui from "../ui/lib/i18n.js";
// @ts-expect-error Plain JS catalog loader.
import { loadDicts, TARGET_LANGS } from "../scripts/i18n-check.mjs";
import { envLang, normalizeLang, requestLang, setLangPref, t, tl, translations } from "../src/i18n/index.js";
import { catalogs } from "../src/i18n/messages/index.js";

afterEach(() => { setLangPref("system"); ui.setLangPref("system"); vi.unstubAllGlobals(); });

describe("multi-language foundation (no database)", () => {
  it.each([["ja-JP", "ja"], ["ko_KR.UTF-8", "ko"], ["ru_RU.UTF-8", "ru"], ["RU-ru", "ru"], ["es-MX", "es"], ["es_ES.UTF-8", "es"], ["pt-BR", "pt"], ["pt_PT.UTF-8", "pt"], ["tr-TR", "tr"], ["tr_TR.UTF-8", "tr"], ["english", undefined], ["javascript", undefined]])("normalizes exact language subtags: %s", (input, expected) => {
    expect(normalizeLang(input)).toBe(expected);
    expect(ui.normalizeLang(input)).toBe(expected ?? null);
  });
  it.each([
    ["zh", "zh-CN"], ["zh-SG", "zh-CN"], ["zh-Hans-TW", "zh-CN"],
    ["zh-TW", "zh-TW"], ["zh_HK.UTF-8", "zh-TW"], ["zh-MO", "zh-TW"],
    ["ZH_hAnT_CN", "zh-TW"], ["zh-TW-u-nu-hanidec", "zh-TW"],
  ])("resolves the Chinese script or region of %s on the server and in the UI", (input, expected) => {
    expect(normalizeLang(input)).toBe(expected);
    expect(ui.normalizeLang(input)).toBe(expected);
    expect(envLang({ LANG: input })).toBe(expected);
  });
  it("uses Taiwan wording when following a Traditional Chinese system", () => {
    vi.stubGlobal("navigator", { languages: ["fr", "zh-Hant", "en"] });
    ui.setLangPref("system");
    expect(ui.getLang()).toBe("zh-TW");
    expect(ui.t("common.save")).toBe("儲存");
    expect(ui.t("time.minutesAgo", { count: 10 })).toBe("10 分鐘前");
    expect(tl("zh-TW", "desktop.trayOpen", { product: "AnyModelBot" })).toBe("開啟 AnyModelBot");
  });
  it("resolves command-line and browser preference lists", () => {
    expect(envLang({ AMB_LANG: "ru-RU", LANG: "ja_JP.UTF-8" })).toBe("ru");
    expect(envLang({ AMB_LANG: "ko_KR.UTF-8" })).toBe("ko");
    vi.stubGlobal("navigator", { languages: ["fr-FR", "ja-JP", "en"] });
    expect(ui.systemLang()).toBe(ui.LANGS.includes("ja") ? "ja" : "en");
  });
  it("selects Russian one/few/many forms, including 11 and 21", () => {
    ui.setLangPref("ru");
    for (const [count, noun] of [[1, "запрос"], [2, "запроса"], [5, "запросов"], [11, "запросов"], [21, "запрос"], [22, "запроса"]]) {
      expect(ui.t("sidebar.pending", { count })).toBe(`${count} ${noun} на подтверждение`);
    }
    expect(ui.t("time.minutesAgo", { count: 1 })).toBe("1 минуту назад");
    ui.setLangPref("ja");
    expect(ui.t("time.minutesAgo", { count: 2 })).toBe("2分前");
    ui.setLangPref("ko");
    expect(ui.t("time.minutesAgo", { count: 2 })).toBe("2분 전");
  });
  it("keeps request language scoped and restores the app language", () => {
    setLangPref("ru");
    const scope = requestLang("ja");
    scope.run(() => {
      expect(t("desktop.trayQuit")).toBe("終了");
      scope.end();
      expect(t("desktop.trayQuit")).toBe("Выйти");
    });
    expect(tl("ko", "desktop.trayQuit")).toBe("종료");
  });
  it("uses the same full plural categories on the server", () => {
    expect(tl("ru", "runtime.busySteps", { count: 1 })).toBe("1 шаг");
    expect(tl("ru", "runtime.busySteps", { count: 2 })).toBe("2 шага");
    expect(tl("ru", "runtime.busySteps", { count: 5 })).toBe("5 шагов");
    expect(tl("ru", "runtime.busySteps", { count: 21 })).toBe("21 шаг");
    expect(tl("ja", "runtime.busySteps", { count: 21 })).toMatch(/^21\s*ステップ$/);
    expect(tl("ko", "runtime.busySteps", { count: 21 })).toBe("21단계");
  });
  it("rolls back a language change when saving fails", async () => {
    ui.setLangPref("en");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "save failed" }) }));
    await expect(ui.changeLang("ru")).rejects.toThrow("save failed");
    expect(ui.getLangPref()).toBe("en");
  });
  it("round-trips every new language through the existing config file without a database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-locale-config-"));
    try {
      for (const language of ["zh-TW", "ja", "ko", "ru", "es", "pt", "tr"] as const) {
        saveConfigFile(dir, (file) => { file.ui = { ...(file.ui || {}), lang: language }; });
        expect(loadConfig({ dataDir: dir, env: {} }).ui.lang).toBe(language);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("validates every authored message even while catalogs are incomplete", async () => {
    const dicts = await loadDicts(TARGET_LANGS);
    const base = Object.fromEntries(Object.entries(catalogs).map(([ns, c]) => [ns, c.en]));
    for (const lang of ["zh-TW", "ja", "ko", "ru", "es", "pt", "tr"] as const) {
      expect(inspectLocale(dicts.en, dicts[lang], lang).errors.filter((e: { reason: string }) => e.reason !== "missing")).toEqual([]);
      expect(inspectLocale(base, translations[lang], lang).errors.filter((e: { reason: string }) => e.reason !== "missing")).toEqual([]);
    }
  });
});

describe("release validator checks raw trees", () => {
  const source = { home: { hero: { title: "Hello {name}" }, cards: ["First", "Second"] }, tasks: { one: "{count} task", other: "{count} tasks" } };
  it("catches missing nested keys and array entries", () => {
    const report = inspectLocale(source, { home: { hero: { title: "こんにちは {name}" }, cards: ["最初"] } }, "ja");
    expect(report.errors).toContainEqual({ key: "home.cards.1", reason: "missing" });
    expect(report.errors).toContainEqual({ key: "tasks", reason: "missing" });
  });
  it("catches empty copy, extra keys, placeholder damage and missing Russian forms", () => {
    const report = inspectLocale(source, { home: { hero: { title: "Привет {person}" }, cards: ["", "Второй"], extra: "Лишнее" }, tasks: { one: "{count} задача", other: "{count} задач" } }, "ru");
    expect(report.errors).toContainEqual({ key: "home.hero.title", reason: "placeholder mismatch" });
    expect(report.errors).toContainEqual({ key: "home.cards.0", reason: "empty" });
    expect(report.errors).toContainEqual({ key: "home.extra", reason: "extra key" });
    expect(report.errors.find((e: { key: string }) => e.key === "tasks").reason).toContain("few, many");
  });
  it("does not mistake a normal object with an other key for a plural", () => {
    expect(inspectLocale({ routes: { stable: "Stable", other: "Other" } }, { routes: { stable: "安定", other: "その他" } }, "ja").errors).toEqual([]);
  });
  it("rejects copied English prose and a plural branch that lost its parameter", () => {
    expect(inspectLocale({ text: "Please select a model to continue" }, { text: "Please select a model to continue" }, "ja").errors)
      .toContainEqual({ key: "text", reason: "unchanged source prose" });
    const result = inspectLocale({ n: { other: "{count} tasks" } }, { n: { one: "{count} задача", few: "задачи", many: "{count} задач", other: "{count} задачи" } }, "ru");
    expect(result.errors).toContainEqual({ key: "n", reason: "placeholder mismatch in plural branch" });
  });
  it("requires a documented exact-value exception for intentional source-language exercises", () => {
    const source = { exercise: "Gestern ich bin ins Kino." };
    const options = { unchanged: { exercise: { value: source.exercise, reason: "German tutor exercise" } } };
    expect(inspectLocale(source, source, "ja", options).errors).toEqual([]);
    const changed = { exercise: "Different untranslated source sentence" };
    expect(inspectLocale(changed, changed, "ja", options).errors).toContainEqual({ key: "exercise", reason: "unchanged source prose" });
  });
});
