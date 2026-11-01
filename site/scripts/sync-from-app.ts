// 从应用（同仓库上一级）同步素材：机器人精灵图、第三方许可；并检查 BOT_CHARS 几何是否与 App 一致（只警告）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOT_CHARS_HASH } from "../src/lib/bots";

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = path.dirname(site);

// 容器里只有 site/（构建上下文），这时用仓库里已经同步好的副本
if (!fs.existsSync(path.join(app, "ui/components/avatar.js"))) {
  console.log("没有找到应用目录，使用已提交的素材副本");
  process.exit(0);
}
const bots = path.join(app, "ui/design/bots");
fs.mkdirSync(path.join(site, "public/bots"), { recursive: true });
for (const f of fs.readdirSync(bots).filter((f) => f.endsWith(".webp"))) {
  fs.copyFileSync(path.join(bots, f), path.join(site, "public/bots", f));
}
fs.copyFileSync(path.join(app, "THIRD_PARTY_NOTICES.md"), path.join(site, "src/data/third-party.md"));
// 英文页用英文译本（英文页整页不出现中文）；改了中文版记得同步改 THIRD_PARTY_NOTICES_en.md
fs.copyFileSync(path.join(app, "THIRD_PARTY_NOTICES_en.md"), path.join(site, "src/data/third-party.en.md"));

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
