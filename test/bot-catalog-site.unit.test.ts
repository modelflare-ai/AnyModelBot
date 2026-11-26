// 上架的 Bot：每种界面语言都要有，官网 /bots 的数据和头像要跟上。忘了在 site/ 运行 npm run sync 时，这里会失败。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const LANGS = ["zh-CN", "zh-TW", "en", "ja", "ko", "ru", "es", "pt", "tr"];
const ids = fs.readdirSync(path.join(ROOT, "bots")).filter((d) => fs.existsSync(path.join(ROOT, "bots", d, "bot.json"))).sort();
const manifest = (id: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "bots", id, "bot.json"), "utf8"));

describe.each(ids)("Bot %s", (id) => {
  it.each(LANGS)("%s：文案、界面和示例都有", (lang) => {
    const m = manifest(id);
    for (const field of ["name", "summary", "about", "starters"]) expect(m[field][lang], field).toBeTruthy();
    expect(m.starters[lang]).toHaveLength(m.starters.en.length);
    const en = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "bots", id, "ui/locales/en.json"), "utf8"))).sort();
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "bots", id, `ui/locales/${lang}.json`), "utf8"))).sort()).toEqual(en);
    expect(fs.existsSync(path.join(ROOT, "bots", id, `sample.${lang}.json`))).toBe(true);
  });
  it("官网有它的静态头像", () => {
    expect(fs.existsSync(path.join(ROOT, "site/public/bot-stills", `${manifest(id).avatar}.webp`))).toBe(true);
  });
});

describe("官网的 Bot 目录", () => {
  it("和 bots/ 一致", () => {
    const removed = (() => {
      try {
        return Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8")).removed ?? {});
      } catch {
        return [] as string[];
      }
    })();
    const want = ids.map(manifest).filter((m) => !removed.includes(m.id)).map(({ id, minAppVersion, avatar, name, summary, about, starters }) => ({ id, minAppVersion, avatar, name, summary, about, starters }));
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, "site/src/data/catalog-bots.json"), "utf8"))).toEqual(want);
  });
});
