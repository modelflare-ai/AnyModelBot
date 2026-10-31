// 从 LobeHub Icons 的静态 SVG（npm 包 @lobehub/icons-static-svg，MIT）生成厂商标志数据 src/data/vendor-logos.ts。
// 两份：VENDOR_LOGOS 是单色版（fill="currentColor"，跟着文字颜色走）；VENDOR_LOGOS_COLOR 是官方彩色版（<文件名>-color.svg），
// 只有有彩色版的厂商才有——OpenAI、Anthropic、xAI、Moonshot、TypeSafe 这几家的标志本来就是单色的，没有彩色版，照用单色。
// 都去掉 <svg> 外壳和 <title>，路径原样保留。彩色版里的渐变 id 是 LobeHub 自带的"lobe-icons-…"前缀，整页唯一，放进图标表不冲突。
//
// 用法（包不进依赖，用的时候临时拉一份）：
//   npm pack @lobehub/icons-static-svg && tar -xzf lobehub-icons-static-svg-*.tgz
//   npx tsx scripts/vendor-logos.ts package/icons
//
// 新厂商：在下面的 FILES 里加一行「归一化的厂商名 → 图标文件名」，重跑（有 <文件名>-color.svg 就自动带上彩色版）。
// 归一化 = 价格快照里的厂商名转小写、只留字母数字（"Moonshot AI" → "moonshotai"），和 src/lib/vendors.ts 的 vendorKey 一致。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  xai: "xai",
  moonshotai: "moonshot",
  meta: "meta",
  typesafe: "typesafeai",
  zhipuai: "zhipu",
  minimax: "minimax",
  alibabacloud: "alibabacloud",
  bytedance: "bytedance",
};

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("用法：npx tsx scripts/vendor-logos.ts <@lobehub/icons-static-svg 解包后的 icons 目录>");
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8")) as { version: string };
const inner = (svg: string) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/, "").trim();

const mono: Record<string, string> = {};
const color: Record<string, string> = {};
for (const [key, file] of Object.entries(FILES)) {
  const svg = fs.readFileSync(path.join(dir, `${file}.svg`), "utf8");
  if (!/viewBox="0 0 24 24"/.test(svg)) throw new Error(`${file}.svg：viewBox 不是 0 0 24 24`);
  if (/\sid="|<defs|<linearGradient|<radialGradient/.test(svg)) throw new Error(`${file}.svg：带 id 或渐变，合进图标表会冲突，换单色版`);
  mono[key] = inner(svg);

  const cf = path.join(dir, `${file}-color.svg`);
  if (!fs.existsSync(cf)) continue;
  const csvg = fs.readFileSync(cf, "utf8");
  if (!/viewBox="0 0 24 24"/.test(csvg)) throw new Error(`${file}-color.svg：viewBox 不是 0 0 24 24`);
  const ids = [...csvg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const bad = ids.filter((id) => !id.startsWith(`lobe-icons-${file}-`));
  if (bad.length) throw new Error(`${file}-color.svg：id 没有 lobe-icons-${file}- 前缀（${bad.join("、")}），放进图标表可能冲突`);
  color[key] = inner(csvg);
}

const map = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
fs.writeFileSync(
  path.join(root, "src/data/vendor-logos.ts"),
  `// 由 scripts/vendor-logos.ts 生成，别手改。来源：@lobehub/icons-static-svg ${pkg.version}（MIT，https://github.com/lobehub/lobe-icons）。
// 各标志是其所有者的商标，这里只用来标明模型出自哪家厂商。键是归一化的厂商名（src/lib/vendors.ts 的 vendorKey），值是 24×24 的路径。
// VENDOR_LOGOS：单色（跟着文字颜色走）。VENDOR_LOGOS_COLOR：官方彩色版，只有有彩色版的厂商才有。
export const VENDOR_LOGOS: Record<string, string> = {
${map(mono)}
};

export const VENDOR_LOGOS_COLOR: Record<string, string> = {
${map(color)}
};
`,
);
console.log(`写入 ${Object.keys(mono).length} 个厂商标志，其中 ${Object.keys(color).length} 个有彩色版（@lobehub/icons-static-svg ${pkg.version}）`);
