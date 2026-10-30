/**
 * 设计规范守卫（ui/design/README.md）：颜色、字号、圆角、动效、层级、间距只能来自 token。
 * 原始值只允许出现在 ui/design/tokens/ 里；组件文件里需要的"魔法数"先起名（--组件-xxx: 值）再用。
 * 间距例外只有三种：0、≤1px 的细线，以及同一行带 /* 微调：… *\/ 注释的光学微调。
 * 容器（README「容器与层次」）：内容里的一组靠 --well 底色成组，不描边、不加侧边色条；要保留的边在同一行写 /* 描边：… *\/。
 * 另外检查所有 var(--x) 都有定义，改名或删 token 时不会留下悬空引用。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

// —— 间距 ——
/** 间距属性：外边距、内边距、间隙、定位偏移 */
const SPACING = /^(margin|padding|scroll-margin|scroll-padding)(-[a-z-]+)?$|^(gap|row-gap|column-gap|inset(-[a-z-]+)?|top|right|bottom|left)$/;
/** 按用途命名的间距变量（--row-py、--pop-pad、--page-px、--composer-pad …）：它们是组件对外的间距接口，也要取自 token */
const SPACING_VAR = /^--[\w-]+-(gap|pad|px|py|pl|pr|pt|pb|inset|gutter)$/;
/** 写死的像素；0 和 ≤1px 的细线不算 */
const rawPx = (v: string) => (v.match(/(?<![\w.-])-?[\d.]+px\b/g) || []).filter((n) => Math.abs(parseFloat(n)) > 1);
/** calc() 里加减写死的像素：藏在宽度里的边距（calc(100% - 48px)）也算间距 */
const calcPx = (v: string) => (/calc\(/.test(v) ? (v.match(/[+-]\s+[\d.]+px\b/g) || []).filter((n) => parseFloat(n.replace(/[+-]\s+/, "")) > 1) : []);
/** 同一行带"微调"注释的声明：有意的光学微调 */
const TUNED = /\/\*\s*微调/;

function lintSpacingCss(file: string): Hit[] {
  const text = fs.readFileSync(file, "utf8");
  const tuned = new Set(text.split("\n").flatMap((l, i) => (TUNED.test(l) ? [i + 1] : [])));
  const src = stripComments(text);
  const hits: Hit[] = [];
  const decl = /([\w-]+)\s*:\s*([^;{}]+)/g;
  for (let m; (m = decl.exec(src)); ) {
    const [, prop, value] = m;
    const line = lineOf(src, m.index);
    if (tuned.has(line)) continue;
    const raw = withoutVars(value);
    const px = SPACING.test(prop) || SPACING_VAR.test(prop) ? rawPx(raw) : prop.startsWith("--") ? [] : calcPx(raw);
    if (px.length) hits.push(`${rel(file)}:${line} 原始间距：${prop}: ${value.trim()}`);
  }
  return hits;
}

function lintSpacingJs(file: string): Hit[] {
  const src = fs.readFileSync(file, "utf8");
  const hits: Hit[] = [];
  const bad = /\b(margin|padding|gap|inset|top|right|bottom|left)[\w-]*\s*:\s*[^;"'`}]*?(?<![\w.-])-?[\d.]+px\b/g;
  for (let m; (m = bad.exec(src)); ) if (rawPx(m[0].slice(m[0].indexOf(":") + 1)).length) hits.push(`${rel(file)}:${lineOf(src, m.index)} 内联样式里的原始间距：${m[0]}`);
  return hits;
}

// —— 容器（README「容器与层次」）——
// 内容里的一组靠 --well 底色和间距成组，不画描边；描边只留给输入框和浮层玻璃，而且要在同一行写明理由。
/** 同一行带"描边"注释的声明：有意保留的边（输入框、浮层玻璃、图形本身） */
const EDGE_OK = /\/\*\s*描边[：:]/;
/** box-shadow 画的一圈边：0 0 0 <宽>（可带 inset），宽度是像素或变量 */
const RING = /(?:^|[,(\s])(?:inset\s+)?0\s+0\s+0\s+(?:[\d.]+px|var\()/;
/** box-shadow 画的侧边色条：inset ±Npx 0 0（N ≥ 2） */
const SIDE_BAR = /inset\s+-?([\d.]+)px\s+0\s+0\b/;
/** 宽度：取声明里第一个长度（px 或 calc/var 都算"有宽度"） */
const edgeWidth = (v: string) => {
  if (/^\s*(0|none)\s*(!important)?\s*$/.test(v) || /^\s*(0|none)\s/.test(v)) return 0;
  const px = v.match(/(?<![\w.-])([\d.]+)px\b/);
  return px ? parseFloat(px[1]) : /calc\(|var\(|\b(thin|medium|thick)\b/.test(v) ? Infinity : 0;
};

function lintEdgesCss(file: string): Hit[] {
  const text = fs.readFileSync(file, "utf8");
  const marked = new Set(text.split("\n").flatMap((l, i) => (EDGE_OK.test(l) ? [i + 1] : [])));
  const src = stripComments(text);
  const hits: Hit[] = [];
  const block = /([^{}]*)\{([^{}]*)\}/g;
  for (let b; (b = block.exec(src)); ) {
    const selector = b[1].trim();
    const focus = /:focus/.test(selector);
    const bodyAt = b.index + b[1].length + 1;
    const decl = /([\w-]+)\s*:\s*([^;{}]+)/g;
    for (let m; (m = decl.exec(b[2])); ) {
      const [, prop, value] = m;
      const line = lineOf(src, bodyAt + m.index);
      if (marked.has(line)) continue;
      const at = `${rel(file)}:${line}`;
      if (/^(border|border-width|outline|outline-width)$/.test(prop) && !focus && edgeWidth(value) > 0)
        hits.push(`${at} 描边容器：${selector} { ${prop}: ${value.trim()} } —— 用 --well 底色成组；确实要边（输入框、浮层玻璃）就在同一行写 /* 描边：理由 */`);
      else if (/^border-(left|right|inline(-start|-end)?)(-width)?$/.test(prop) && edgeWidth(value) >= 2)
        hits.push(`${at} 侧边色条：${selector} { ${prop}: ${value.trim()} } —— 提示用淡底 + 图标，不加左侧色条`);
      else if (/^border-(top|bottom|block(-start|-end)?)(-width)?$/.test(prop) && edgeWidth(value) > 1)
        hits.push(`${at} 粗分隔线：${selector} { ${prop}: ${value.trim()} } —— 行间只用 ≤1px 的 --line-2`);
      else if (SIDE_BAR.test(value) && parseFloat(value.match(SIDE_BAR)![1]) >= 2)
        hits.push(`${at} 侧边色条：${selector} { ${prop}: ${value.trim()} } —— 提示用淡底 + 图标，不加左侧色条`);
      else if ((prop === "box-shadow" || prop.startsWith("--")) && RING.test(value) && !focus)
        hits.push(`${at} 投影描边：${selector} { ${prop}: ${value.trim()} } —— 内容里的组不描边；确实要边就在同一行写 /* 描边：理由 */`);
    }
  }
  return hits;
}

/** 小标签：不全大写、不加字距 */
function lintLabelsCss(file: string): Hit[] {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const hits: Hit[] = [];
  for (const m of src.matchAll(/(text-transform)\s*:\s*(uppercase|capitalize)|(letter-spacing)\s*:\s*\+?(\.\d+|\d+(\.\d+)?)(em|px|rem)/g))
    if (!m[4] || parseFloat(m[4]) > 0) hits.push(`${rel(file)}:${lineOf(src, m.index!)} 大写 / 加字距的小标签：${m[0]}`);
  return hits;
}

function lintEdgesJs(file: string): Hit[] {
  const src = fs.readFileSync(file, "utf8");
  const hits: Hit[] = [];
  const bad = /\b(border(-left|-right)?\s*:\s*[^;"'`}]*?\d[^;"'`}]*?solid|box-shadow\s*:\s*[^;"'`}]*?\b0 0 0 [\d.]+px)/g;
  for (let m; (m = bad.exec(src)); ) hits.push(`${rel(file)}:${lineOf(src, m.index)} 内联样式里的描边：${m[0]}`);
  return hits;
}

describe("设计规范", () => {
  const css = files(".css").filter((f) => !f.startsWith(TOKENS + path.sep));
  const js = files(".js");

  it("内容里的组不描边、不加侧边色条（输入框、浮层玻璃等写明「描边：」理由的除外）", () => {
    expect([...css.flatMap(lintEdgesCss), ...js.flatMap(lintEdgesJs)]).toEqual([]);
  });

  it("容器守卫能拦下描边卡片、投影描边和侧边色条", () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amb-edges-")), "x.css");
    try {
      fs.writeFileSync(tmp, [
        ".a { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-xl); }",
        ".b { box-shadow: inset 0 0 0 .5px var(--line), var(--shadow-xs); }",
        ".c { border-left: 3px solid var(--red); }",
        ".d { --notice-edge: inset 3px 0 0 var(--red), inset 0 0 0 1px var(--line); }",
        ".e { border: 0; border-top: 1px solid var(--line-2); background: var(--well); }",
        ".f:focus-visible { outline: 2px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }",
        ".g { border: 1px solid var(--ctl-edge); }   /* 描边：输入框的边 */",
        ".h { --x-edge: 0 0 0 var(--w) var(--line); }",
        ".i { border-bottom: 2px solid var(--accent); }",
      ].join("\n"));
      expect(lintEdgesCss(tmp).map((h) => h.split(" ")[0].split(":").pop())).toEqual(["1", "2", "3", "4", "8", "9"]);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });

  it("小标签不全大写、不加字距", () => {
    expect(css.flatMap(lintLabelsCss)).toEqual([]);
  });

  it("颜色 / 字号 / 圆角 / 动效 / 层级只用 token", () => {
    expect([...css.flatMap(lintCss), ...js.flatMap(lintJs)]).toEqual([]);
  });

  it("间距只用 token（0、≤1px 细线、带「微调」注释的光学微调除外）", () => {
    expect([...css.flatMap(lintSpacingCss), ...js.flatMap(lintSpacingJs)]).toEqual([]);
  });

  it("间距守卫能拦下写死的像素", () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amb-spacing-")), "x.css");
    try {
      fs.writeFileSync(tmp, [
        ".a { padding: 0 12px; }",
        ".b { width: min(var(--col-w), calc(100% - 48px)); }",
        ".c { --row-py: 7px; }",
        ".d { margin: 0; gap: 1px; padding: var(--space-2); }",
        ".e { top: 3px; }   /* 微调：居中 */",
      ].join("\n"));
      expect(lintSpacingCss(tmp).map((h) => h.split(" ")[0].split(":").pop())).toEqual(["1", "2", "3"]);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
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
