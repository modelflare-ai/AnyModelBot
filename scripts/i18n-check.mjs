#!/usr/bin/env node
// 界面多语言自检（test/i18n.unit.test.ts 也调这里的函数）。无第三方依赖。
//
//   node scripts/i18n-check.mjs                 检查全部界面代码
//   node scripts/i18n-check.mjs ui/screens/chat.js ...   只查这几个文件（词典的对齐检查照做）
//
//   1. 界面代码（去掉注释后）不再出现中文：文案都应该进 ui/locales/。确实要留的（字体名、语言自称、
//      匹配中文输入的正则……）在那一行写 `// i18n-ignore`
//   2. 代码里 t("…") 用到的键在两种语言的词典里都有
//   3. zh-CN 与 en 的键一一对应；同一个键两边的 {占位符} 相同；复数文案两边都有 other
//
// 动态拼出来的键（t(`gateway.${state}`)）查不到，写的时候配合 has() 兜底。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LANGS = ["zh-CN", "en"];
const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/;
/** 只给开发者看的页面（设计库展示页），不进多语言 */
const SKIP = new Set(["ui/design/gallery.js"]);

/** 界面代码：ui/ 下的 .js，去掉词典和第三方 */
export function uiFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (rel !== "ui/locales" && rel !== "ui/vendor") walk(rel);
      } else if (e.name.endsWith(".js") && !SKIP.has(rel)) out.push(rel);
    }
  };
  walk("ui");
  return out.sort();
}

/**
 * 去掉 JS 注释（换成空格，保留换行，行号不变）。认得字符串、模板字符串（含嵌套的 ${}）和正则字面量，
 * 所以 "https://…" 和 /\/\// 不会被当成注释。正则的判断是启发式的（看前一个有效字符），界面代码够用。
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const stack = []; // 模板字符串里 ${ 的花括号深度
  let prev = ""; // 上一个非空白的代码字符，用来判断 / 是除号还是正则
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const readString = (q) => {
    let j = i + 1;
    while (j < n && src[j] !== q) {
      if (src[j] === "\\") j++;
      else if (src[j] === "\n") break;
      j++;
    }
    out += src.slice(i, j + 1);
    i = j + 1;
    prev = q;
  };
  const readTemplate = () => {
    // i 指向 ` 或 }（从 ${} 回到模板）后的第一个字符
    let j = i;
    while (j < n) {
      if (src[j] === "\\") {
        j += 2;
        continue;
      }
      if (src[j] === "`") {
        out += src.slice(i, j + 1);
        i = j + 1;
        prev = "`";
        return;
      }
      if (src[j] === "$" && src[j + 1] === "{") {
        out += src.slice(i, j + 2);
        i = j + 2;
        stack.push(0);
        prev = "{";
        return;
      }
      j++;
    }
    out += src.slice(i);
    i = n;
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      readString(c);
    } else if (c === "`") {
      out += c;
      i++;
      readTemplate();
    } else if (c === "/" && (prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(return|typeof|case|in|of)$/.test(out.trimEnd()))) {
      // 正则字面量
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j);
      i = j;
      prev = "/";
    } else {
      if (stack.length && c === "{") stack[stack.length - 1]++;
      else if (stack.length && c === "}") {
        if (stack[stack.length - 1] === 0) {
          stack.pop();
          out += c;
          i++;
          readTemplate();
          continue;
        }
        stack[stack.length - 1]--;
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  return out;
}

/** 去掉注释后仍含中文、且没标 i18n-ignore 的行 */
export function cjkLines(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const raw = src.split("\n");
  return stripComments(src)
    .split("\n")
    .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
    .filter((l) => CJK.test(l.text) && !raw[l.line - 1].includes("i18n-ignore"));
}

/** 代码里写死的 t("…") 键（模板字符串里带 ${} 的动态键跳过） */
export function usedKeys(rel) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const keys = [];
  for (const m of src.matchAll(/(?<![\w.$])t\(\s*(["'`])([A-Za-z][\w.]*)\1/g)) keys.push(m[2]);
  return keys;
}

export async function loadDicts() {
  const dicts = {};
  for (const l of LANGS) dicts[l] = (await import(pathToFileURL(path.join(ROOT, "ui/locales", l, "index.js")).href)).default;
  return dicts;
}

const isPlural = (v) => v !== null && typeof v === "object" && typeof v.other === "string";

/** 拍平成 { "ns.key": string | {one, other} } */
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" || isPlural(v)) out[key] = v;
    else if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v; // 非法值，交给 checkDicts 报
  }
  return out;
}

const placeholders = (v) => {
  const texts = typeof v === "string" ? [v] : isPlural(v) ? Object.values(v) : [];
  const s = new Set();
  for (const t of texts) for (const m of String(t).matchAll(/\{(\w+)\}/g)) s.add(m[1]);
  return [...s].sort().join(",");
};

/** 两种语言的词典是否对齐；返回问题列表 */
export function checkDicts(dicts) {
  const errs = [];
  const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(dicts[l])]));
  const [a, b] = LANGS;
  for (const l of LANGS)
    for (const [k, v] of Object.entries(flat[l])) {
      if (typeof v !== "string" && !isPlural(v)) errs.push(`${l}: ${k} 的值不是字符串或 { one, other }`);
      else if ((typeof v === "string" ? v : v.other).trim() === "") errs.push(`${l}: ${k} 是空文案`);
    }
  for (const k of Object.keys(flat[a])) if (!(k in flat[b])) errs.push(`${b} 缺少 ${k}`);
  for (const k of Object.keys(flat[b])) if (!(k in flat[a])) errs.push(`${a} 缺少 ${k}`);
  for (const k of Object.keys(flat[a])) {
    if (!(k in flat[b])) continue;
    const pa = placeholders(flat[a][k]);
    const pb = placeholders(flat[b][k]);
    if (pa !== pb) errs.push(`${k} 的占位符不一致：${a} {${pa}} / ${b} {${pb}}`);
  }
  return errs;
}

export function missingKeys(dicts, files) {
  const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(dicts[l])]));
  const out = [];
  for (const f of files)
    for (const k of usedKeys(f)) for (const l of LANGS) if (!(k in flat[l])) out.push(`${f}: ${l} 缺少 ${k}`);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args.map((f) => path.relative(ROOT, path.resolve(f)).split(path.sep).join("/")) : uiFiles();
  const dicts = await loadDicts();
  const problems = [...checkDicts(dicts), ...missingKeys(dicts, files)];
  for (const f of files) for (const l of cjkLines(f)) problems.push(`${f}:${l.line}: 还有中文 → ${l.text.slice(0, 120)}`);
  for (const p of problems) console.log(p);
  console.log(problems.length ? `\n${problems.length} 个问题` : "多语言检查通过");
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
