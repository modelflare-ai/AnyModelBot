// 报告里的第一张数字表画成两张小图：金额一类画柱（从 0 开始），百分比画线（只看走势，不从 0 开始）。
// 金额与百分比分开；每张图最多两组数据，专用配色在图例、柱线和 KPI 中保持一致：
// 平时显示最后一期，鼠标移到哪一期就显示哪一期（整列都是感应区，不用对准细小的点）。表格本身仍在报告里。
import { html, useEffect, useRef, useState } from "/amb/botapp/kit/kit.js";

import { chartScale, lineSegments } from "./chart-data.js";
export { chartsFrom } from "./chart-data.js";

/** 宽度跟着容器走（每张图按实际像素画，字不会跟着缩放） */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // 下一帧再更新（在回调里直接改尺寸会触发 ResizeObserver 的循环警告）；界面被藏起来时宽度是 0，不跟着变
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = Math.floor(el.clientWidth);
        if (width > 0) setW(width);
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);
  return [ref, w];
}

const H = 208;
const TOP = 12;
const BOTTOM = 30;
const LEFT = 64;
const RIGHT = 8;

function Legend({ series, at, cats }) {
  return html`<div class="ch-legend">
    ${series.map((s) => html`<span class="ch-key" key=${s.name}>
      <i class=${`ch-swatch s${s.color}`} aria-hidden="true"></i>
      <span class="ch-name">${s.name}</span><strong class="ch-value">${s.cells[at]?.text ?? "—"}</strong>
    </span>`)}
    <span class="ch-cat">${cats[at]}</span>
  </div>`;
}

function Plot({ kind, cats, series, w, at, setAt, lang }) {
  const { lo, hi, ticks } = chartScale(series.flatMap((s) => s.cells.filter(Boolean).map((c) => c.value)), kind === "bars");
  const band = Math.max(1, w - LEFT - RIGHT) / cats.length;
  const y = (v) => TOP + (H - TOP - BOTTOM) * (hi - v) / (hi - lo);
  const x = (i) => LEFT + i * band;
  const cx = (i) => x(i) + band / 2;
  const number = new Intl.NumberFormat(lang || "en", { notation: "compact", maximumFractionDigits: 1 });
  const every = Math.max(1, Math.ceil(54 / band));
  const thick = Math.max(1, Math.min(26, band * 0.65 / series.length));
  return html`<svg class="ch-svg" width=${w} height=${H} role="img" aria-label=${series.map((s) => s.name).join(" / ")}>
    ${ticks.map((v) => html`<g key=${v}><line class=${v === 0 ? "ch-base" : "ch-grid"} x1=${LEFT} x2=${w - RIGHT} y1=${y(v)} y2=${y(v)} />
      <text class="ch-axis" x=${LEFT - 8} y=${y(v) + 4} text-anchor="end">${number.format(v)}${kind === "lines" ? "%" : ""}</text></g>`)}
    <line class="ch-cross" x1=${cx(at)} x2=${cx(at)} y1=${TOP} y2=${H - BOTTOM} />
    ${kind === "bars" ? cats.map((_, i) => html`<g key=${i} class=${at === i ? "ch-col on" : "ch-col"}>
      ${series.map((s, j) => {
        const c = s.cells[i];
        if (!c) return null;
        const bx = cx(i) - (series.length * thick + (series.length - 1) * 2) / 2 + j * (thick + 2);
        return html`<rect key=${j} class=${`ch-bar s${s.color}`} x=${bx} y=${Math.min(y(0), y(c.value))} width=${thick} height=${Math.abs(y(c.value) - y(0))} rx="2"><title>${s.name}: ${c.text}</title></rect>`;
      })}
    </g>`) : series.map((s) => html`<g key=${s.name}>
      ${lineSegments(s.cells, (c, i) => [cx(i), y(c.value)]).filter((points) => points.length > 1).map((points, i) => html`<polyline key=${i} class=${`ch-line s${s.color}`} points=${points.map((p) => p.join(",")).join(" ")} />`)}
      ${s.cells.map((c, i) => c && html`<circle key=${i} class=${`ch-dot s${s.color}${i === at ? " on" : ""}`} cx=${cx(i)} cy=${y(c.value)} r=${i === at ? 5 : 3}><title>${s.name}: ${c.text}</title></circle>`)}
    </g>`)}
    ${cats.map((cat, i) => i % every && i !== cats.length - 1 ? null : html`<text key=${i} class=${`ch-axis${i === at ? " on" : ""}`} x=${cx(i)} y=${H - 8} text-anchor="middle">${cat}</text>`)}
    ${cats.map((_, i) => html`<rect key=${i} class="ch-hit" x=${x(i)} y="0" width=${band} height=${H} onPointerEnter=${() => setAt(i)} onPointerDown=${() => setAt(i)} />`)}
  </svg>`;
}

function Chart({ kind, cats, series, unitNote, lang, t }) {
  const last = cats.length - 1;
  const [at, setAt] = useState(last);
  const selected = Math.max(0, Math.min(last, at));
  const [ref, w] = useWidth();
  useEffect(() => setAt(last), [cats.join("|"), series.map((s) => s.name).join("|")]);
  return html`<figure class="ch" tabindex="0" aria-label=${t("chart.interact")} onKeyDown=${(e) => {
    const next = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: last }[e.key];
    if (next !== undefined) { e.preventDefault(); setAt(Math.max(0, Math.min(last, next))); }
  }}>
    <${Legend} series=${series} at=${selected} cats=${cats} />
    <figcaption class="ch-note">${kind === "lines" ? "%" : unitNote || t("chart.units")}</figcaption>
    <div class="ch-plot" ref=${ref}>${w > 0 && html`<${Plot} kind=${kind} cats=${cats} series=${series} w=${w} at=${selected} setAt=${setAt} lang=${lang} />`}</div>
  </figure>`;
}

export function Charts({ data, lang, t }) {
  if (!data) return null;
  return html`<div class="ch-row">
    ${data.bars.length > 0 && html`<${Chart} kind="bars" cats=${data.cats} series=${data.bars} unitNote=${data.unitNote} lang=${lang} t=${t} />`}
    ${data.lines.length > 0 && html`<${Chart} kind="lines" cats=${data.cats} series=${data.lines} lang=${lang} t=${t} />`}
  </div>`;
}

/**
 * 关键数字：每组数据一张卡——最后一期的值，和第一期比变了多少（金额算百分比，比率算百分点）。
 * 给只想看结论的人一眼读懂，懂行的人也能直接拿去核对表格。
 */
export function Kpis({ data, t, lang }) {
  if (!data) return null;
  const tiles = [...data.bars, ...data.lines].map((s) => {
    const idx = s.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return null;
    const a = s.cells[idx[0]], b = s.cells[idx[idx.length - 1]];
    const diff = s.pct ? b.value - a.value : a.value ? ((b.value - a.value) / Math.abs(a.value)) * 100 : null;
    if (diff == null || !Number.isFinite(diff)) return null;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
    const digits = s.pct ? 2 : 1;
    const n = new Intl.NumberFormat(lang || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(Math.abs(diff));
    return { color: s.color, name: s.name, value: b.text, delta: s.pct ? t("kpi.pp", { v: `${sign}${n}` }) : `${sign}${n}%`, up: diff > 0, down: diff < 0, from: data.cats[idx[0]], to: data.cats[idx[idx.length - 1]] };
  }).filter(Boolean);
  if (!tiles.length) return null;
  return html`<div class="kpis" role="list" aria-label=${t("kpi.title")}>
    ${tiles.map((k) => html`<div class="kpi" role="listitem" key=${k.name}>
      <span class="kpi-name"><span><i class=${`ch-swatch s${k.color}`} aria-hidden="true"></i> ${k.name}</span><span class="kpi-at">${k.to}</span></span>
      <strong class="kpi-value">${k.value}</strong>
      <span class="kpi-delta"><span aria-hidden="true">${k.up ? "▲" : k.down ? "▼" : "■"}</span> ${k.delta} <span class="kpi-at">${t("kpi.vs", { cat: k.from })}</span></span>
    </div>`)}
  </div>`;
}
