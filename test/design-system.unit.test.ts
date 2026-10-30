/**
 * 设计规范守卫（ui/design/README.md）：颜色、字号、圆角、动效、层级只能来自 token。
 * 原始值只允许出现在 ui/design/tokens/ 里；组件文件里需要的"魔法数"先起名（--组件-xxx: 值）再用。
 * 另外检查所有 var(--x) 都有定义，改名或删 token 时不会留下悬空引用。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const UI = path.join(import.meta.dirname, "..", "ui");
const TOKENS = path.join(UI, "design", "tokens");

const files = (ext: string) =>
  (fs.readdirSync(UI, { recursive: true }) as string[]).filter((f) => f.endsWith(ext)).map((f) => path.join(UI, f));
const rel = (f: string) => path.relative(path.join(UI, ".."), f);
/** 注释换成等长空白，保留行号 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
const lineOf = (s: string, i: number) => s.slice(0, i).split("\n").length;
/** 去掉自定义属性名，剩下的才是原始值（--ease-out 之类不算缓动关键字） */
const withoutVars = (v: string) => v.replace(/--[\w-]+/g, "");

type Hit = string;

function lintCss(file: string): Hit[] {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const hits: Hit[] = [];
  const decl = /([\w-]+)\s*:\s*([^;{}]+)/g;
  for (let m; (m = decl.exec(src)); ) {
    const [, prop, value] = m;
    const at = `${rel(file)}:${lineOf(src, m.index)}`;
    const raw = withoutVars(value);
    const custom = prop.startsWith("--");
    if (/#[0-9a-fA-F]{3,8}\b/.test(value) || /\b(rgba?|hsla?)\((?![^)]*var\()/.test(value)) hits.push(`${at} 原始颜色：${prop}: ${value.trim()}`);
    if (custom) continue;
    if ((prop === "font-size" || prop === "font") && /\d(px|rem|pt)\b/.test(raw)) hits.push(`${at} 原始字号：${prop}: ${value.trim()}`);
    if (prop === "border-radius" && (raw.match(/[\d.]+px/g) || []).some((n) => parseFloat(n) >= 3)) hits.push(`${at} 原始圆角：${value.trim()}`);
    if (/^(transition|animation)(-duration|-delay)?$/.test(prop) && (raw.match(/(?<![\w.-])[\d.]+m?s\b/g) || []).some((t) => parseFloat(t) > 0)) hits.push(`${at} 原始时长：${prop}: ${value.trim()}`);
    if (/^(transition|animation)(-timing-function)?$/.test(prop) && /cubic-bezier\(|\bease(-in-out|-in|-out)?\b/.test(raw)) hits.push(`${at} 原始缓动：${prop}: ${value.trim()}`);
    if (prop === "z-index" && /^\s*-?\d+\s*$/.test(value) && value.trim() !== "0") hits.push(`${at} 原始层级：z-index: ${value.trim()}`);
  }
  return hits;
}

function lintJs(file: string): Hit[] {
  const src = fs.readFileSync(file, "utf8");
  const hits: Hit[] = [];
  const bad = /(background|color|border|fill|stroke)[\w-]*\s*:\s*[^;"'`]*(#[0-9a-fA-F]{3,8}\b|rgba?\()|font-size\s*:\s*\d/g;
  for (let m; (m = bad.exec(src)); ) hits.push(`${rel(file)}:${lineOf(src, m.index)} 内联样式里的原始值：${m[0]}`);
  return hits;
}

describe("设计规范", () => {
  const css = files(".css").filter((f) => !f.startsWith(TOKENS + path.sep));
  const js = files(".js");

  it("颜色 / 字号 / 圆角 / 动效 / 层级只用 token", () => {
    expect([...css.flatMap(lintCss), ...js.flatMap(lintJs)]).toEqual([]);
  });

  it("每个 var(--x)（没有回退值的）都有定义", () => {
    const all = [...files(".css"), ...js].map((f) => [f, fs.readFileSync(f, "utf8")] as const);
    const defined = new Set<string>();
    for (const [, s] of all) for (const m of s.matchAll(/(?:^|[\s;{("'`])(--[\w-]+)\s*["'`]?\s*:/g)) defined.add(m[1]);
    const missing: string[] = [];
    for (const [f, s] of all)
      for (const m of s.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) if (!defined.has(m[1])) missing.push(`${rel(f)}:${lineOf(s, m.index!)} ${m[1]}`);
    expect(missing).toEqual([]);
  });

  it("入口按层引入了每个组件与基础样式文件", () => {
    const entry = fs.readFileSync(path.join(UI, "design", "index.css"), "utf8");
    const want = ["tokens", "base", "components"].flatMap((d) =>
      fs.readdirSync(path.join(UI, "design", d)).filter((f) => f.endsWith(".css")).map((f) => `${d}/${f}`),
    );
    expect(want.filter((f) => !entry.includes(`"${f}"`))).toEqual([]);
  });
});
