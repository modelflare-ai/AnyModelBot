// 部署占位符校验（§13.2）：dist/ 与数据文件里残留 {大写占位符} 或未替换的构建变量 → 生产构建失败；--warn 只提示。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const warnOnly = process.argv.includes("--warn");
const DEPLOY = /\{[A-Z][A-Z0-9_]*\}/g;
const TEMPLATE = /\{(fetchedAt|pricingVersion|modelCount|vendorCount|textCount|mediaCount|sample\.\w+|sampleModel|sampleMonthly|snapshotDate|amount|sizeMB|sha256|version|publishedAt|model|input|output|officialIn|officialOut|n|email|domain)\}/g;

function walk(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|xml|txt|json|webmanifest)$/.test(p)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(root, "dist")), path.join(root, "src/data/releases.json")];
const found = new Map<string, Set<string>>();
for (const f of files) {
  const raw = fs.readFileSync(f, "utf8");
  // 岛组件的 props、JSON 数据块和 data-template 属性里是客户端再替换的文案模板，只对部署占位符严格检查
  const text = raw.replace(/<astro-island[^>]*>/g, "").replace(/<script type="application\/json"[^>]*>[\s\S]*?<\/script>/g, "").replace(/\sdata-template="[^"]*"/g, "");
  for (const [re, src] of [[DEPLOY, raw], [TEMPLATE, text]] as const) for (const m of src.matchAll(re)) {
    const rel = path.relative(root, f);
    if (!found.has(m[0])) found.set(m[0], new Set());
    found.get(m[0])!.add(rel);
  }
}
if (!found.size) { console.log("占位符校验通过"); process.exit(0); }
const lines = [...found].map(([k, fs]) => `  ${k}  ← ${[...fs].slice(0, 3).join(", ")}${fs.size > 3 ? ` 等 ${fs.size} 个文件` : ""}`);
const msg = `残留占位符 ${found.size} 种：\n${lines.join("\n")}\n部署值请通过环境变量（SITE_DOMAIN、GITHUB_URL、SECURITY_EMAIL、ANALYTICS_SCRIPT_URL、ANALYTICS_SITE_ID）与 src/data/releases.json 提供。`;
if (warnOnly) { console.warn(`⚠ ${msg}`); process.exit(0); }
console.error(`✗ ${msg}`);
process.exit(1);
