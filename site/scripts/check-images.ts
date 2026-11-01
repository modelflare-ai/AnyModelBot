// 图片与字体体积守卫（§11、§16.1）：超出预算即失败。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BADGES, badgeVariants } from "../src/data/badges";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, "public");
const KB = 1024;
const RULES: [RegExp, number, string][] = [
  [/^og\/.+\.png$/, 300 * KB, "OG 图 ≤ 300 KB"],
  [/^bots\/.+\.(webp|avif)$/, 120 * KB, "机器人精灵图 ≤ 120 KB"],
  [/^(favicon|apple-touch-icon|icon-).+\.png$/, 40 * KB, "图标 ≤ 40 KB"],
  [/\.svg$/, 4 * KB, "SVG ≤ 4 KB"],
  [/\.(png|jpe?g|webp|avif|gif)$/, 200 * KB, "其他图片 ≤ 200 KB"],
];
const files: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else files.push(path.relative(pub, p));
  }
})(pub);

const bad: string[] = [];
for (const f of files) {
  const rule = RULES.find(([re]) => re.test(f));
  if (!rule) continue;
  const size = fs.statSync(path.join(pub, f)).size;
  if (size > rule[1]) bad.push(`${f}：${Math.round(size / KB)} KB（${rule[2]}）`);
}
// 精灵图的 AVIF 版（scripts/make-bot-avif.ts）必须和当前的 WebP 是同一版：WebP 更新了而 AVIF 没重做，
// 支持 AVIF 的浏览器会显示旧图，眼睛（SVG，按新几何画）也对不上
const avifOf: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "src/data/bots-avif.json"), "utf8"));
for (const f of files.filter((f) => /^bots\/.+\.webp$/.test(f))) {
  const key = path.basename(f, ".webp");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(pub, f))).digest("hex");
  if (!files.includes(`bots/${key}.avif`) || avifOf[key] !== hash) bad.push(`bots/${key}.avif 不是从当前的 ${f} 生成的（npm run bots:avif 重新生成）`);
}
// 每张图片徽章都要有本地备份，否则站方的图连不上时格子是空的（styles/footer.css）
for (const { copy } of BADGES.flatMap(badgeVariants)) {
  if (copy && !files.includes(copy.path)) bad.push(`${copy.path} 不存在（npm run badges:copies 重新生成）`);
}
const fonts = files.filter((f) => f.endsWith(".woff2")).reduce((n, f) => n + fs.statSync(path.join(pub, f)).size, 0);
if (fonts > 60 * KB) bad.push(`字体合计 ${Math.round(fonts / KB)} KB（≤ 60 KB）`);
if (bad.length) { console.error(`✗ 图片与字体检查未通过：\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`图片与字体体积检查通过（字体合计 ${Math.round(fonts / KB)} KB）`);
