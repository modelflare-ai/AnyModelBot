// 千分位和小数点两种写法都认：1,234.5 / 1.234,5 / 1 234,5 / 41,78%
const NUM = /^[-+(]?\s*[$€¥£]?\s*\d(?:[\d.,\u00a0\u202f ]*\d)?\s*(%|pp|个百分点)?\s*\)?$/i;
const MAX_ROWS = 12;
const MAX_SERIES = 2;

function parseCell(raw) {
  const s = String(raw ?? "").replace(/\*\*/g, "").trim();
  if (!NUM.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  return { neg, digits: s.replace(/[^\d.,]/g, ""), pct: /%$/.test(s), text: /^\(.*\)$/.test(s) ? `−${s.slice(1, -1)}` : s };
}

/** 这一格能不能单独看出小数点："41,78" → ","；"1,234.5" → "."；"1.234.567" → ","；"365,817" 这种只有一个分隔符、后面正好三位的看不出 → null */
function decimalHint(d) {
  if (d.includes(",") && d.includes(".")) return d.lastIndexOf(",") > d.lastIndexOf(".") ? "," : ".";
  for (const sep of [",", "."]) {
    const parts = d.split(sep);
    if (parts.length === 1) continue;
    if (parts.length > 2) return sep === "," ? "." : ",";
    return parts[1].length === 3 ? null : sep;
  }
  return null;
}

/** 整列用同一种小数点：先看列里有没有能单独判断的格，都没有时按报告语言的习惯（ru、es、pt 用逗号） */
function columnValues(cells, lang, tableDecimal) {
  const dec = cells.map((c) => c && decimalHint(c.digits)).find(Boolean)
    ?? tableDecimal
    ?? (new Intl.NumberFormat(lang || "en").format(1.5).includes(",") ? "," : ".");
  const group = dec === "," ? "." : ",";
  return cells.map((c) => {
    if (!c) return null;
    const n = Number(c.digits.split(group).join("").replace(dec, "."));
    return Number.isFinite(n) ? { value: c.neg ? -n : n, pct: c.pct, text: c.text } : null;
  });
}

/** 第一张能画的表：至少两行，第一列是期间或名称，至少一列大部分是数字 */
export function chartsFrom(blocks, lang) {
  for (const [index, b] of blocks.entries()) {
    if (b.type !== "table" || b.rows.length < 2 || b.rows.length > MAX_ROWS || b.head.length < 2) continue;
    const cats = b.rows.map((r) => String(r[0] ?? "").replace(/\*\*/g, ""));
    // Reports can retain the source's numeric convention after translation.
    // A clear decimal elsewhere in the table resolves ambiguous three-digit fractions.
    const tableDecimal = b.rows.flatMap((row) => row.slice(1).map(parseCell)).map((cell) => cell && decimalHint(cell.digits)).find(Boolean);
    const cols = [];
    for (let c = 1; c < b.head.length; c++) {
      const cells = columnValues(b.rows.map((r) => parseCell(r[c])), lang, tableDecimal);
      const ok = cells.filter(Boolean);
      if (ok.length < Math.max(2, Math.ceil(cells.length * 0.7))) continue;
      cols.push({ color: cols.length % 4, name: String(b.head[c]).replace(/\*\*/g, ""), cells, pct: ok.filter((x) => x.pct).length > ok.length / 2 });
    }
    if (!cols.length) continue;
    const bars = cols.filter((c) => !c.pct).slice(0, MAX_SERIES);
    const lines = cols.filter((c) => c.pct).slice(0, MAX_SERIES);
    [...bars, ...lines].forEach((series, i) => { series.color = i; });
    const before = blocks[index - 1];
    const unitNote = before?.type === "p" && before.text.length <= 200 ? before.text : "";
    return { cats, bars, lines, unitNote };
  }
  return null;
}

/** A shared numeric domain: signed bars include zero, line charts retain their range. */
export function chartScale(values, includeZero = false) {
  const finite = values.filter(Number.isFinite);
  let lo = Math.min(...finite), hi = Math.max(...finite);
  if (!finite.length) return { lo: 0, hi: 1, ticks: [0, 0.5, 1] };
  if (includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  else { const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Number((lo + i * step).toPrecision(12)));
  return { lo, hi, ticks };
}

/** Missing observations break a line instead of implying an observed trend. */
export function lineSegments(cells, point) {
  const segments = [];
  let current = [];
  cells.forEach((cell, i) => {
    if (cell == null) { if (current.length) segments.push(current); current = []; }
    else current.push(point(cell, i));
  });
  if (current.length) segments.push(current);
  return segments;
}
