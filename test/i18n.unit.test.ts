// 多语言：界面词典两种语言对齐、界面代码里没有漏掉的中文、t() 的插值 / 复数 / 回退，
// 服务端的语言选择（请求头 → 应用偏好 → 系统）、/settings 的语言偏好与 config.json 持久化。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error 检查脚本是无类型的原生 ES 模块
import { checkDicts, cjkLines, loadDicts, missingKeys, stripComments, uiFiles } from "../scripts/i18n-check.mjs";
// @ts-expect-error 界面代码是不经构建的 JS
import * as ui from "../ui/lib/i18n.js";
import { catalogs } from "../src/i18n/messages/index.js";
import { appLang, detached, envLang, lang, normalizeLang, normalizeLangPref, requestLang, setLangPref, setSystemLang, t, tl, withLang } from "../src/i18n/index.js";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("界面词典", () => {
  it("zh-CN 与 en 的键一一对应，占位符相同", async () => {
    expect(checkDicts(await loadDicts())).toEqual([]);
  });

  it("界面代码里 t() 用到的键两种语言都有", async () => {
    expect(missingKeys(await loadDicts(), uiFiles())).toEqual([]);
  });

  it("界面代码里没有漏掉的中文（注释除外；确需保留的行标 i18n-ignore）", () => {
    const left = uiFiles().flatMap((f: string) => cjkLines(f).map((l: { line: number; text: string }) => `${f}:${l.line} ${l.text}`));
    expect(left).toEqual([]);
  });

  it("去注释认得字符串、模板和正则", () => {
    const src = 'const a = "https://x.dev"; // 注释\nconst b = /\\/\\//g; /* 块 */ const c = `${"//"}中文`;';
    const out = stripComments(src);
    expect(out).toContain('"https://x.dev"');
    expect(out).not.toContain("注释");
    expect(out).not.toContain("块");
    expect(out).toContain("/\\/\\//g");
    expect(out).toContain("中文");
    expect(out.split("\n").length).toBe(2);
  });
});

describe("界面 t()", () => {
  it("插值、复数、vnode 参数、回退", () => {
    ui.setLangPref("en");
    expect(ui.getLang()).toBe("en");
    expect(ui.t("common.cancel")).toBe("Cancel");
    expect(ui.t("app.cmd.switchBot", { name: "Ping" })).toBe("Switch to “Ping”");
    expect(ui.t("time.minutesAgo", { count: 1 })).toBe("1 min ago");
    // vnode（对象）参数：返回数组，可直接放进 htm 模板
    const node = { type: "b" };
    expect(ui.t("app.serviceDown", { error: node })).toEqual(["Can't reach the local service: ", node]);
    // 没有的键原样返回键名
    expect(ui.t("nope.missing")).toBe("nope.missing");
    expect(ui.has("common.cancel")).toBe(true);
    expect(ui.has("nope.missing")).toBe(false);

    ui.setLangPref("zh-CN");
    expect(ui.t("common.cancel")).toBe("取消");
    expect(ui.t("time.minutesAgo", { count: 5 })).toBe("5 分钟前");
    expect(ui.format("{a} 和 {b}", { a: 1 })).toBe("1 和 {b}");
  });

  it("语言代码规整", () => {
    expect(ui.normalizeLang("zh-Hans-CN")).toBe("zh-CN");
    expect(ui.normalizeLang("zh-TW")).toBe("zh-CN");
    expect(ui.normalizeLang("en-GB")).toBe("en");
    expect(ui.normalizeLang("ja")).toBe(null);
    expect(ui.normalizePref("fr")).toBe("system");
    expect(ui.normalizePref("en")).toBe("en");
  });

  it("订阅：切换语言时通知，同一语言不重复通知", () => {
    ui.setLangPref("zh-CN");
    let n = 0;
    const off = ui.onLangChange(() => n++);
    ui.setLangPref("en");
    ui.setLangPref("en");
    off();
    ui.setLangPref("zh-CN");
    expect(n).toBe(1);
  });
});

describe("服务端词典", () => {
  it("每个命名空间 zh 与 en 的键、占位符一致", () => {
    const ph = (v: unknown) => [...new Set([...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");
    for (const [ns, c] of Object.entries(catalogs)) {
      const zh = c.zh as Record<string, unknown>;
      const en = c.en as Record<string, unknown>;
      expect(Object.keys(en).sort(), ns).toEqual(Object.keys(zh).sort());
      for (const k of Object.keys(zh)) expect(ph(en[k]), `${ns}.${k}`).toBe(ph(zh[k]));
    }
  });

  it("系统语言：AMB_LANG → LC_ALL → LC_MESSAGES → LANG；C / POSIX / 没设时用简体中文", () => {
    expect(envLang({ AMB_LANG: "en", LANG: "zh_CN.UTF-8" })).toBe("en");
    expect(envLang({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(envLang({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" })).toBe("zh-CN");
    expect(envLang({ LANG: "C.UTF-8" })).toBe("zh-CN");
    expect(envLang({ LANG: "POSIX" })).toBe("zh-CN");
    expect(envLang({ LANG: "de_DE.UTF-8" })).toBe("en");
    expect(envLang({})).toBe("zh-CN");
    expect(normalizeLang("zh_CN.UTF-8")).toBe("zh-CN");
    expect(normalizeLangPref("xx")).toBe("system");
  });

  it("请求语言优先于应用语言；应用语言 = 偏好，跟随系统时 = 系统语言", async () => {
    setSystemLang("zh-CN");
    setLangPref("system");
    expect(lang()).toBe("zh-CN");
    expect(t("web.botNotFound")).toBe("机器人不存在");
    setLangPref("en");
    expect(appLang()).toBe("en");
    expect(t("web.botNotFound")).toBe("Bot not found");
    // withLang 里的异步延续也用请求的语言
    const inner = await withLang("zh-CN", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return t("web.botNotFound");
    });
    expect(inner).toBe("机器人不存在");
    expect(tl("en", "desktop.trayOpen", { product: "AnyModelBot" })).toBe("Open AnyModelBot");
    setLangPref("system");
  });

  it("请求结束后，请求里启动的后台任务退回应用语言；detached 一开始就用应用语言", async () => {
    setSystemLang("zh-CN");
    setLangPref("system");
    const scope = requestLang("en");
    let later: () => string = () => "";
    scope.run(() => {
      later = () => lang(); // 在请求里注册、之后才调用的回调（像渠道循环、子进程事件）
      expect(lang()).toBe("en");
      expect(detached(() => lang())).toBe("zh-CN");
    });
    const loop = scope.run(() => new Promise<string>((r) => setTimeout(() => r(lang()), 20)));
    scope.end();
    expect(await loop).toBe("zh-CN");
    expect(later()).toBe("zh-CN");
    expect(requestLang(undefined).run(() => lang())).toBe("zh-CN");
  });
});

describe("界面接口：语言偏好", () => {
  let app: App;
  let base = "";
  const TOKEN = "ui-token-i18n-0123456789";
  const api = async (p: string, init: { method?: string; body?: unknown; lang?: string } = {}) => {
    const res = await fetch(`${base}/amb/api${p}`, {
      method: init.method ?? "GET",
      headers: {
        "x-amb-token": TOKEN,
        ...(init.lang ? { "x-amb-lang": init.lang } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-i18n-"));
    const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_UI_PORT: "0", AMB_UI_TOKEN: TOKEN, AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } });
    app = new App(config, { printQrToTerminal: false });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  });
  afterAll(async () => {
    setLangPref("system");
    await app?.stop();
  });

  it("报错跟着请求头 x-amb-lang 的语言", async () => {
    expect((await api("/bots/nope", { lang: "en" })).json.error).toBe("Bot not found");
    expect((await api("/bots/nope", { lang: "zh-CN" })).json.error).toBe("机器人不存在");
  });

  it("语言偏好写进 config.json；没带请求头时报错用应用语言", async () => {
    expect((await api("/settings")).json.lang).toBe("system");
    const r = await api("/settings", { method: "PUT", body: { lang: "en" } });
    expect(r.status).toBe(200);
    expect(r.json.lang).toBe("en");
    expect(JSON.parse(fs.readFileSync(path.join(app.config.dataDir, "config.json"), "utf8")).ui.lang).toBe("en");
    expect(loadConfig({ dataDir: app.config.dataDir, env: {} }).ui.lang).toBe("en");
    expect(appLang()).toBe("en");
    expect((await api("/bots/nope")).json.error).toBe("Bot not found");
    expect((await api("/settings", { method: "PUT", body: { lang: "fr" }, lang: "en" })).json.error).toBe("Unsupported language");
    expect((await api("/settings", { method: "PUT", body: { lang: "system" } })).json.lang).toBe("system");
  });
});
