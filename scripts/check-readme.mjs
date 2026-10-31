#!/usr/bin/env node
// README 自检（npm run docs:check）。无第三方依赖。任一项失败时退出码为 1。
//
//   1. README.md / README_en.md 引用的 docs/assets/... 文件都存在，且不超过体积上限（docs/assets/README.md 的总表）；GIF 合计 ≤ 30 MB
//   2. 中英两份 README 的一级、二级标题数量相同，<img> 数量相同，文末引用式链接定义完全相同
//   3. README、贡献指南、SECURITY.md、docs/*.md 里的相对链接指向存在的文件；#锚点能在目标文档的标题里找到（按 GitHub 的规则生成）
//   4. 两份 README 不出现禁用词；「定时任务 / Scheduled tasks」只允许出现在路线图一节
//   5. 所有图片（<img> 与 Markdown 图片）都有非空 alt
//
// --allow-missing：素材还没录完时，把「素材文件不存在」降为警告（其余检查照常失败）。全部素材提交后去掉这个参数。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW_MISSING = process.argv.includes("--allow-missing");

const READMES = { zh: "README.md", en: "README_en.md" };
const LINKED_DOCS = [
  ...Object.values(READMES),
  "CONTRIBUTING.md",
  "CONTRIBUTING_en.md",
  "SECURITY.md",
  "docs/development.md",
  "docs/development_en.md",
  "docs/privacy.md",
  "docs/privacy_en.md",
  "docs/assets/README.md",
];

const KB = 1024;
const MB = 1024 * KB;
// 按顺序匹配，先写更具体的规则。
const LIMITS = [
  [/^docs\/assets\/brand\/logo-eyes\.webp$/, 80 * KB],
  [/^docs\/assets\/brand\/logo-eyes\.svg$/, 2 * KB],
  [/^docs\/assets\/brand\/wordmark-(light|dark)\.svg$/, 12 * KB],
  [/^docs\/assets\/brand\/social-preview\.png$/, 400 * KB],
  [/^docs\/assets\/hero\/hero-demo\.gif$/, 5 * MB],
  [/^docs\/assets\/modelflare\/modelflare-logo\.png$/, 40 * KB],
  [/^docs\/assets\/download\/install-windows\.gif$/, 2.5 * MB],
  [/^docs\/assets\/screenshots\/[a-z]+-(light|dark)\.webp$/, 300 * KB],
  [/^docs\/assets\/features\/characters-eyes\.gif$/, 1.5 * MB],
  [/^docs\/assets\/features\/[a-z-]+\.gif$/, 3 * MB],
  [/^docs\/assets\/diagrams\/[a-z-]+-(light|dark)\.svg$/, 60 * KB],
];
const GIF_TOTAL = 30 * MB;

const BANNED =
  /绝对安全|100% ?安全|absolutely secure|零遥测|no telemetry at all|离线可用|works offline|全平台|all platforms|最便宜|cheapest|省 ?\d+%|save \d+%|Modelflare ?(没有|无)订阅|Modelflare has no subscription|\$ ?\d|多机器人协同|群聊支持|color=blue/gi;
const ROADMAP_ONLY = /定时任务|Scheduled tasks/gi;

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const fmtSize = (n) => (n >= MB ? `${(n / MB).toFixed(2)} MB` : `${(n / KB).toFixed(1)} KB`);

/** 去掉围栏代码块（保留行数，便于报行号）。 */
function stripFences(text) {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

/** 标题列表：[{ level, text, line }]，不含代码块里的行。 */
function headings(text) {
  const out = [];
  stripFences(text)
    .split("\n")
    .forEach((line, i) => {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
    });
  return out;
}

/** GitHub 的标题锚点：先去掉 Markdown / HTML 标记，再按 github-slugger 的规则生成，重名加 -1、-2。 */
function anchorsOf(text) {
  const seen = new Map();
  const set = new Set();
  for (const h of headings(text)) {
    const plain = h.text
      .replace(/<[^>]+>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/[`*]/g, "");
    let slug = plain
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    set.add(slug);
  }
  return set;
}

/** 链接目标：Markdown 链接、HTML href / src / srcset，以及引用式定义。 */
function linkTargets(text) {
  const body = stripFences(text);
  const out = [];
  const push = (t) => t && out.push(t.trim());
  for (const m of body.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) push(m[1]);
  for (const m of body.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/g)) push(m[1]);
  for (const m of body.matchAll(/\bsrcset\s*=\s*"([^"]+)"/g)) for (const part of m[1].split(",")) push(part.trim().split(/\s+/)[0]);
  for (const m of body.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)) push(m[1]);
  return out;
}

const isExternal = (t) => /^(https?:|mailto:|data:|tel:)/i.test(t);

// ---------- 3. 相对链接与锚点 ----------
const anchorCache = new Map();
const anchorsFor = (rel) => {
  if (!anchorCache.has(rel)) anchorCache.set(rel, anchorsOf(read(rel)));
  return anchorCache.get(rel);
};

for (const doc of LINKED_DOCS) {
  if (!exists(doc)) {
    err(doc, "文件不存在");
    continue;
  }
  const text = read(doc);
  const dir = path.posix.dirname(doc);
  for (const target of linkTargets(text)) {
    if (isExternal(target)) continue;
    const [rawPath, anchor] = target.split("#");
    if (/^docs\/assets\//.test(rawPath) && Object.values(READMES).includes(doc)) continue; // 素材在第 1 项里单独检查
    const rel = rawPath ? path.posix.normalize(path.posix.join(dir, decodeURI(rawPath))) : doc;
    if (rawPath && !exists(rel)) {
      err(doc, `相对链接指向不存在的文件：${target}`);
      continue;
    }
    if (anchor !== undefined && anchor !== "" && rel.endsWith(".md")) {
      const want = decodeURIComponent(anchor).toLowerCase();
      if (!anchorsFor(rel).has(want)) err(doc, `锚点在 ${rel} 的标题里找不到：#${anchor}`);
    }
  }
}

// ---------- 1. 素材 ----------
let gifTotal = 0;
const assetSeen = new Set();
for (const readme of Object.values(READMES)) {
  if (!exists(readme)) continue;
  for (const m of read(readme).matchAll(/docs\/assets\/[^\s"'()<>]+/g)) {
    const rel = m[0];
    if (assetSeen.has(rel)) continue;
    assetSeen.add(rel);
    if (!exists(rel)) {
      (ALLOW_MISSING ? warn : err)(readme, `素材不存在：${rel}`);
      continue;
    }
    const size = fs.statSync(path.join(ROOT, rel)).size;
    if (rel.endsWith(".gif")) gifTotal += size;
    const rule = LIMITS.find(([re]) => re.test(rel));
    if (!rule) warn(readme, `素材没有对应的体积上限规则：${rel}（${fmtSize(size)}）`);
    else if (size > rule[1]) err(readme, `素材超出体积上限：${rel} ${fmtSize(size)} > ${fmtSize(rule[1])}`);
  }
}
if (gifTotal > GIF_TOTAL) err("docs/assets", `GIF 合计 ${fmtSize(gifTotal)} 超过 ${fmtSize(GIF_TOTAL)}`);

// ---------- 2. 中英结构一致 ----------
if (exists(READMES.zh) && exists(READMES.en)) {
  const zh = read(READMES.zh);
  const en = read(READMES.en);
  for (const level of [1, 2]) {
    const a = headings(zh).filter((h) => h.level === level).length;
    const b = headings(en).filter((h) => h.level === level).length;
    if (a !== b) err("README", `${level} 级标题数量不同：${READMES.zh} ${a} 个，${READMES.en} ${b} 个`);
  }
  const imgs = (t) => (t.match(/<img\b/g) || []).length;
  if (imgs(zh) !== imgs(en)) err("README", `<img> 数量不同：${READMES.zh} ${imgs(zh)} 个，${READMES.en} ${imgs(en)} 个`);
  const defs = (t) =>
    stripFences(t)
      .split("\n")
      .filter((l) => /^\[[^\]]+\]:\s*\S+/.test(l))
      .map((l) => l.trim())
      .sort()
      .join("\n");
  if (defs(zh) !== defs(en)) err("README", "文末引用式链接定义不一致（两份 README 应逐字相同）");
}

// ---------- 4. 禁用词 ----------
for (const readme of Object.values(READMES)) {
  if (!exists(readme)) continue;
  const lines = stripFences(read(readme)).split("\n");
  let inRoadmap = false;
  lines.forEach((line, i) => {
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) inRoadmap = /Roadmap|路线图/.test(h1[1]);
    for (const m of line.matchAll(BANNED)) err(readme, `第 ${i + 1} 行出现禁用词「${m[0]}」`);
    if (!inRoadmap) for (const m of line.matchAll(ROADMAP_ONLY)) err(readme, `第 ${i + 1} 行：「${m[0]}」只能出现在路线图一节`);
  });
}

// ---------- 5. alt ----------
for (const readme of Object.values(READMES)) {
  if (!exists(readme)) continue;
  const body = stripFences(read(readme));
  for (const m of body.matchAll(/<img\b[^>]*>/g)) {
    const alt = /\balt\s*=\s*"([^"]*)"/.exec(m[0]);
    if (!alt || !alt[1].trim()) err(readme, `<img> 缺少 alt：${m[0].slice(0, 90)}`);
  }
  for (const m of body.matchAll(/!\[([^\]]*)\](?:\(|\[)/g)) if (!m[1].trim()) err(readme, `Markdown 图片缺少 alt：${m[0]}`);
}

// ---------- 输出 ----------
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const summary = `docs:check — ${errors.length} 个错误，${warnings.length} 个警告（素材 ${assetSeen.size} 个，GIF 合计 ${fmtSize(gifTotal)}）`;
if (errors.length) {
  console.error(summary);
  process.exit(1);
}
console.log(summary);
