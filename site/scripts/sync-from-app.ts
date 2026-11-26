// 从应用（同仓库上一级）同步素材：机器人精灵图、第三方许可；并检查 BOT_CHARS 几何是否与 App 一致（只警告）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOT_CHARS_HASH, CHAR_KEYS } from "../src/lib/bots";

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = path.dirname(site);

// 容器里只有 site/（构建上下文），这时用仓库里已经同步好的副本
if (!fs.existsSync(path.join(app, "ui/components/avatar.js"))) {
  console.log("没有找到应用目录，使用已提交的素材副本");
  process.exit(0);
}
const bots = path.join(app, "ui/design/bots");
fs.mkdirSync(path.join(site, "public/bots"), { recursive: true });
// App 里还有领域专家的精灵图，官网只用六个基础角色（连同它们的小档 <角色>@<边长>.webp）
const siteChars = new Set<string>(CHAR_KEYS);
for (const f of fs.readdirSync(bots).filter((f) => f.endsWith(".webp") && siteChars.has(path.parse(f).name.split("@")[0]))) {
  fs.copyFileSync(path.join(bots, f), path.join(site, "public/bots", f));
}
fs.copyFileSync(path.join(app, "THIRD_PARTY_NOTICES.md"), path.join(site, "src/data/third-party.md"));
// 英文页用英文译本（英文页整页不出现中文）；改了中文版记得同步改 THIRD_PARTY_NOTICES_en.md
fs.copyFileSync(path.join(app, "THIRD_PARTY_NOTICES_en.md"), path.join(site, "src/data/third-party.en.md"));
// 更新日志页：英文页不出现微信、飞书（用户 2026-11-01 定的），提到它们的行不带过去
fs.copyFileSync(path.join(app, "CHANGELOG.md"), path.join(site, "src/data/changelog.md"));
const changelogEn = fs.readFileSync(path.join(app, "CHANGELOG_en.md"), "utf8").split("\n").filter((line) => !/wechat|weixin|feishu/i.test(line)).join("\n");
fs.writeFileSync(path.join(site, "src/data/changelog.en.md"), changelogEn);

// Additional languages are independently authored; only the English channel policy filters its own changelog.
for (const lang of ["zh-TW", "ja", "ko", "ru", "es", "pt", "tr"]) {
  if (fs.existsSync(path.join(app, `THIRD_PARTY_NOTICES_${lang}.md`))) fs.copyFileSync(path.join(app, `THIRD_PARTY_NOTICES_${lang}.md`), path.join(site, `src/data/third-party.${lang}.md`));
  if (fs.existsSync(path.join(app, `CHANGELOG_${lang}.md`))) fs.copyFileSync(path.join(app, `CHANGELOG_${lang}.md`), path.join(site, `src/data/changelog.${lang}.md`));
}

// 首页的演示视频：只要 MP4（GIF 大 3 倍多，官网不用）
fs.mkdirSync(path.join(site, "public/demo"), { recursive: true });
for (const f of fs.readdirSync(path.join(app, "docs/assets/demo")).filter((f) => f.endsWith(".mp4"))) {
  fs.copyFileSync(path.join(app, "docs/assets/demo", f), path.join(site, "public/demo", f));
}

// Bot 目录页（/bots）：名称、简介、说明和可点的话都来自 bots/*/bot.json，官网和 App 用同一份文案。容器里没有 bots/，用已提交的副本
const removed = (() => {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(app, "catalog.json"), "utf8")).removed ?? {});
  } catch {
    return [] as string[];
  }
})();
const catalogBots = fs.readdirSync(path.join(app, "bots"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(app, "bots", e.name, "bot.json")))
  .map((e) => e.name)
  .sort()
  .map((id) => JSON.parse(fs.readFileSync(path.join(app, "bots", id, "bot.json"), "utf8")))
  .filter((m) => !removed.includes(m.id))
  .map(({ id, minAppVersion, avatar, name, summary, about, starters }) => ({ id, minAppVersion, avatar, name, summary, about, starters }));
fs.writeFileSync(path.join(site, "src/data/catalog-bots.json"), `${JSON.stringify(catalogBots, null, 2)}\n`);

export function botCharsHash(src: string) {
  const m = src.match(/export const BOT_CHARS = (\{[\s\S]*?\n\});/);
  if (!m) return null;
  // 只比几何：去掉名称、岗位、说明这些文字，剩下的数字依次拼起来
  const nums = m[1].replace(/(name|role|pick): "[^"]*",?/g, "").match(/-?\d+(?:\.\d+)?/g) ?? [];
  return crypto.createHash("sha256").update(nums.join(",")).digest("hex").slice(0, 16);
}
const h = botCharsHash(fs.readFileSync(path.join(app, "ui/components/avatar.js"), "utf8"));
if (h !== BOT_CHARS_HASH) {
  console.warn(`⚠ App 的 BOT_CHARS 几何已变化（${h} ≠ ${BOT_CHARS_HASH}）：请把 ui/components/avatar.js 的新几何同步到 src/lib/bots.ts，并更新 BOT_CHARS_HASH`);
} else {
  console.log("素材已同步；BOT_CHARS 与 App 一致");
}
