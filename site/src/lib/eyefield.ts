// 页脚"眼睛田"的纯逻辑（无 DOM，单测在 tests/eyefield.test.ts）：把字标采样成格子、目光、眨眼、配色、挑模型名。
// 每一格是一枚迷你 Eyes 标记——面罩 + 两只眼，比例和 components/EyesMark.astro 的 100×100 画布一致。

/** 一枚标记在 100 单位画布里的几何（EyesMark.astro）：面罩 94×82 圆角 36，眼睛 13×28，左右眼中心离中线 14.5，目光幅度 x 11 / y 5 */
export const MARK = {
  plateW: 0.94, plateH: 0.82, plateR: 0.36,
  eyeW: 0.13, eyeH: 0.28, eyeDX: 0.145,
  ampX: 0.11, ampY: 0.05, headX: 0.02, headY: 0.01,
} as const;

/** 字标的排法：画布够扁（宽高比 ≥ 3，CSS 在宽屏给的比例）排一行，否则三行。按画布比例判断，和 CSS 的断点永远一致 */
export function wordLines(width: number, height: number): string[] {
  return height > 0 && width / height >= 3 ? ["AnyModelBot"] : ["Any", "Model", "Bot"];
}

/** 格子边长：让字标高度方向大约有 rows 格，限制在 [min, max] 像素之间（太小看不出眼睛，太大字形太粗糙） */
export function cellSize(capHeight: number, rows: number, min = 9, max = 20): number {
  return Math.max(min, Math.min(max, capHeight / rows));
}

export interface Cell {
  /** 格子中心（CSS 像素） */
  x: number; y: number;
  col: number; row: number;
}

/**
 * 从一张"字形遮罩"里取格子：每格取 3×3 个采样点，覆盖到 minCover 以上的才算字里面。
 * alpha(x, y) 返回该像素的不透明度 0–1（调用方从 ImageData 里取，已经换算成 CSS 像素坐标）。
 */
export function sampleCells(width: number, height: number, cell: number, alpha: (x: number, y: number) => number, minCover = 0.45): Cell[] {
  const cols = Math.floor(width / cell), rows = Math.floor(height / cell);
  const ox = (width - cols * cell) / 2, oy = (height - rows * cell) / 2;
  const out: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let hit = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        hit += alpha(ox + (c + (i + 0.5) / 3) * cell, oy + (r + (j + 0.5) / 3) * cell);
      }
      if (hit / 9 >= minCover) out.push({ x: ox + (c + 0.5) * cell, y: oy + (r + 0.5) * cell, col: c, row: r });
    }
  }
  return out;
}

/** 目光：指向目标的单位向量，乘一个随距离增大的系数——近处也会转，远处看满幅；|向量| ≤ 1 */
export function aim(dx: number, dy: number, reach: number): [number, number] {
  const d = Math.hypot(dx, dy);
  if (d < 1) return [0, 0];
  const t = Math.min(d / reach, 1), e = 1 - (1 - t) * (1 - t);
  return [(dx / d) * e, (dy / d) * e];
}

/** "注意到你"的程度：离指针越近越接近 1，平方衰减；半径外是 0 */
export function lens(d: number, radius: number): number {
  if (d >= radius) return 0;
  const k = 1 - d / radius;
  return k * k;
}

/** 眨眼：p 是从开始眨算起的进度（一次眨眼 = 1），返回眼睛的竖向开合 0.08–1；double 时 1.25–2.25 再眨一次 */
export function blinkLid(p: number, double = false): number {
  const one = (q: number) => (q <= 0 || q >= 1 ? 1 : 1 - 0.92 * Math.sin(Math.PI * q));
  if (p < 1) return one(p);
  return double ? one(p - 1.25) : 1;
}
export const blinkSpan = (double: boolean) => (double ? 2.25 : 1);

/** 入场：带一点回弹的放大（0 → 1，中途略超过 1） */
export function easeOutBack(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** 眼睛的配色：六个机器人的眼睛色 + 品牌黄绿。每一轮"换模型"选一个主色，七成格子用主色，其余撒别的颜色 */
export const EYE_TOKENS = ["--lime", "--bot-blue-eye", "--bot-purple-eye", "--bot-orange-eye", "--bot-green-eye", "--bot-red-eye", "--bot-yellow-eye"] as const;
/** 浅色下给面罩上色用的角色色（和 EYE_TOKENS 一一对应：同一个下标是同一个角色）：辉光色和底色调和成淡彩，眼睛统一用墨色 */
export const PLATE_TOKENS = ["--lime", "--bot-blue-glow", "--bot-purple-glow", "--bot-orange-glow", "--bot-green-glow", "--bot-red-glow", "--bot-yellow-glow"] as const;

/** "#rgb" / "#rrggbb" → [r, g, b]；认不出来时返回 null */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}
/** 在 sRGB 里把颜色 a 按比例 t 混进底色 b（t = 0 是 b，1 是 a）；任何一个认不出来就原样返回 b */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return b;
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}

export function pickColor(main: number, count: number, roll: number, roll2: number, share = 0.7): number {
  if (roll < share || count < 2) return main;
  const k = Math.floor(roll2 * (count - 1));
  return k >= main ? k + 1 : k;
}

/** 换模型时显示的模型名：每家厂商取第一个，最多 n 个，顺序和价格快照一致 */
export function pickModels(rows: { model: string; vendor?: string }[], n = 8): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const r of rows) {
    const v = r.vendor ?? r.model;
    if (seen.has(v)) continue;
    seen.add(v); out.push(r.model);
    if (out.length >= n) break;
  }
  return out;
}

/** 可复现的伪随机（mulberry32）：同一个种子每次排出同样的田，刷新页面不会"换一批" */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
