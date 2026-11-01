// 收录徽章的本地备份（public/badges/*.webp）：站方图片连不上或被拦截时，页脚显示这一份，不留破图。
// 页面 HTML 里的站方原码不变，校验机器人读到的还是站方的图片地址；备份只是垫在下面（styles/footer.css）。
//
// 一律转成 WebP：大的 SVG 有几十 KB，放不进 check-images 的 SVG 预算；转成位图也就不用在自家域名上托管第三方 SVG。
// 高度 88px：页脚的徽章高 30px，三倍屏也够清晰。
// 同时把每张图的宽高比写进 src/data/badge-ratios.json：页脚按它给徽章定宽，图片加载前就占好位，不会把一排挤乱。
//
// 用法：npm run badges:copies（需要联网）。data/badges.ts 新增或换了图片徽章后要重跑，check-images 会查缺的文件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BADGES, badgeVariants } from "../src/data/badges";

const HEIGHT = 88;
const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "public");

// 服务器上 SVG 指定的字体大多没有，默认的 DejaVu 又偏宽，长一点的字会超出徽章（Fazier 被裁掉最后一个字母）。
// 换成窄一些的 Noto Sans，更接近访客系统字体的效果；等宽字体保持不变。这台机器没有这个字体时会退回默认字体，不影响生成
function narrowFont(file: Buffer) {
  if (!file.subarray(0, 1024).toString().includes("<svg")) return file;
  return Buffer.from(file.toString().replace(/font-family\s*(=\s*"[^"]*"|:\s*[^;}"]+)/g, (m, value: string) =>
    /mono/i.test(value) ? m : value.startsWith("=") ? 'font-family="Noto Sans SC"' : "font-family: 'Noto Sans SC'"));
}

const failed: string[] = [];
const ratios: Record<string, number> = {};
const copies = BADGES.flatMap(badgeVariants).flatMap((v) => v.copy ?? []);
for (const copy of copies) {
  try {
    const res = await fetch(copy.remote, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // density 决定 SVG 的光栅化精度：先画到足够大再缩，文字才不糊。位图不受影响
    const image = sharp(narrowFont(Buffer.from(await res.arrayBuffer())), { density: 288 });
    const file = path.join(out, copy.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const info = await image.resize({ height: HEIGHT }).webp({ quality: 88, effort: 6 }).toFile(file);
    ratios[copy.path] = +(info.width / info.height).toFixed(2);
    console.log(`${copy.path} ${info.width}×${info.height} ${(info.size / 1024).toFixed(1)} KB`);
  } catch (err) {
    failed.push(`${copy.remote}：${err instanceof Error ? err.message : err}`);
  }
}
if (failed.length) {
  console.error(`✗ 这些徽章没有生成备份：\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
fs.writeFileSync(path.join(path.dirname(out), "src/data/badge-ratios.json"), JSON.stringify(ratios, null, 2) + "\n");
// 全部成功才清理：徽章换了款或删掉后，旧备份不留在 public/ 里
const dir = path.join(out, "badges");
const keep = new Set(copies.map((c) => path.basename(c.path)));
for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f));
