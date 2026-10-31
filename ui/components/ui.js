// 共用组件：图标、按钮、分段控件、弹出菜单、确认框、提示胶囊、复制按钮、骨架。
// 样式在 ui/design/components/*.css；这里的组件只是给常用组合一个带逻辑的写法，直接写 class 也可以。
import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "preact/hooks";
import htm from "htm";
import { useStore, toasts, dismissToast, dialog } from "../lib/store.js";
import { usePresence } from "../design/motion.js";
import { has, t } from "../lib/i18n.js";

export const html = htm.bind(h);

// —— 线性图标（16 格画布，currentColor；样式 design/components/icon.css，规范见 README「图标」）——
// 每个图标是一条描边路径；要实心的部分（信息点、省略号、停止方块）写成 { s: 描边, f: 实心 }。
/** 实心圆点的路径：圆心 (x, y)、半径 r */
const dot = (x, y, r) => `M${x} ${y - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
const P = {
  search: "M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5ZM11.2 11.2 14 14",
  plus: "M8 3v10M3 8h10",
  close: "M4 4l8 8M12 4l-8 8",
  chevDown: "M4 6l4 4 4-4",
  chevLeft: "M10 3.5 5.5 8l4.5 4.5",
  chevRight: "M6 3.5 10.5 8 6 12.5",
  check: "M3.5 8.5l3 3 6-7",
  up: "M8 13V3.5M3.75 7.75 8 3.5l4.25 4.25",
  down: "M8 3v9.5M3.75 8.25 8 12.5l4.25-4.25",
  gear: "M8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM13 8c0-.4-.04-.79-.12-1.16l1.37-1.07-1.3-2.25-1.62.65a5 5 0 0 0-2-1.16L9.1 1.3H6.5L6.25 3a5 5 0 0 0-2 1.16l-1.62-.65-1.3 2.25 1.37 1.07a5 5 0 0 0 0 2.32L1.33 10.3l1.3 2.25 1.62-.65a5 5 0 0 0 2 1.16l.25 1.64h2.6l.25-1.64a5 5 0 0 0 2-1.16l1.62.65 1.3-2.25-1.37-1.07c.08-.37.12-.76.12-1.16Z",
  copy: "M5.5 5.5V3.25c0-.41.34-.75.75-.75h6.5c.41 0 .75.34.75.75v6.5c0 .41-.34.75-.75.75H10.5M3.25 5.5h6.5c.41 0 .75.34.75.75v6.5c0 .41-.34.75-.75.75h-6.5a.75.75 0 0 1-.75-.75v-6.5c0-.41.34-.75.75-.75Z",
  ext: "M6.5 3.5H3.75a.75.75 0 0 0-.75.75v8c0 .41.34.75.75.75h8c.41 0 .75-.34.75-.75V9.5M9 3h4v4M13 3 7.5 8.5",
  eye: "M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  eyeOff: "M2.5 2.5l11 11M6.6 6.6a2 2 0 0 0 2.8 2.8M4.3 4.9C2.7 6 1.75 8 1.75 8S4 12.25 8 12.25c1.2 0 2.27-.38 3.17-.93M7 3.82c.32-.05.65-.07 1-.07 4 0 6.25 4.25 6.25 4.25s-.52.98-1.48 2.05",
  paste: "M5.5 2.75h5v1.5h-5zM10.5 3.5h1.75c.41 0 .75.34.75.75v9c0 .41-.34.75-.75.75h-8.5a.75.75 0 0 1-.75-.75v-9c0-.41.34-.75.75-.75H5.5",
  trash: "M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.6c.03.4.36.7.75.7h5.3c.4 0 .72-.3.75-.7l.6-8.6",
  file: "M9 1.75H4.25a.75.75 0 0 0-.75.75v11c0 .41.34.75.75.75h7.5c.41 0 .75-.34.75-.75V5.25L9 1.75ZM9 1.75v3.5h3.5M5.75 8.25h4.5M5.75 10.75h4.5",
  refresh: "M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.75v2.5h-2.5",
  stop: { f: "M5.75 4h4.5c.97 0 1.75.78 1.75 1.75v4.5c0 .97-.78 1.75-1.75 1.75h-4.5C4.78 12 4 11.22 4 10.25v-4.5C4 4.78 4.78 4 5.75 4Z" },
  more: { f: dot(3.5, 8, 1.25) + dot(8, 8, 1.25) + dot(12.5, 8, 1.25) },
  panel: "M2.75 3.25h10.5c.41 0 .75.34.75.75v8c0 .41-.34.75-.75.75H2.75a.75.75 0 0 1-.75-.75V4c0-.41.34-.75.75-.75ZM10 3.25v9.5",
  compose: "M7.5 2.75H3.75a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V8.5M11.6 2.4a1.4 1.4 0 0 1 2 2L8 10l-2.5.5L6 8l5.6-5.6Z",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.75V8l2.25 1.5",
  arrowLeft: "M13 8H3.5M7.25 3.75 3 8l4.25 4.25",
  sliders: "M2.5 4.5h6.5M12.5 4.5h1M2.5 11.5h1M7 11.5h6.5M10.75 3v3M5.25 10v3",
  spark: "M8 1.75c.35 2.9 1.35 3.9 4.25 4.25C9.35 6.35 8.35 7.35 8 10.25 7.65 7.35 6.65 6.35 3.75 6 6.65 5.65 7.65 4.65 8 1.75ZM12.25 10.5c.15 1.15.6 1.6 1.75 1.75-1.15.15-1.6.6-1.75 1.75-.15-1.15-.6-1.6-1.75-1.75 1.15-.15 1.6-.6 1.75-1.75Z",
  monitor: "M2.75 2.75h10.5c.41 0 .75.34.75.75v6.75c0 .41-.34.75-.75.75H2.75a.75.75 0 0 1-.75-.75V3.5c0-.41.34-.75.75-.75ZM5.75 13.75h4.5M8 11v2.75",
  lock: "M4.25 7.25h7.5c.41 0 .75.34.75.75v5c0 .41-.34.75-.75.75h-7.5a.75.75 0 0 1-.75-.75V8c0-.41.34-.75.75-.75ZM5.5 7.25V5a2.5 2.5 0 0 1 5 0v2.25",
  unlock: "M4.25 7.25h7.5c.41 0 .75.34.75.75v5c0 .41-.34.75-.75.75h-7.5a.75.75 0 0 1-.75-.75V8c0-.41.34-.75.75-.75ZM5.5 7.25V5a2.5 2.5 0 0 1 4.9-.7",
  globe: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM2.25 8h11.5M8 2c1.55 1.65 2.35 3.65 2.35 6S9.55 12.35 8 14M8 2C6.45 3.65 5.65 5.65 5.65 8s.8 4.35 2.35 6",
  database: "M8 5.25c2.9 0 5.25-.78 5.25-1.75S10.9 1.75 8 1.75 2.75 2.53 2.75 3.5 5.1 5.25 8 5.25ZM2.75 3.5v9c0 .97 2.35 1.75 5.25 1.75s5.25-.78 5.25-1.75v-9M2.75 8c0 .97 2.35 1.75 5.25 1.75S13.25 8.97 13.25 8",
  info: { s: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 7.25v3.75", f: dot(8, 5, 0.8) },
  alert: { s: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.75v3.5", f: dot(8, 10.9, 0.8) },
  chat: "M3.25 2.75h9.5c.41 0 .75.34.75.75v6.75c0 .41-.34.75-.75.75H7.25L4.5 13.25V11H3.25a.75.75 0 0 1-.75-.75V3.5c0-.41.34-.75.75-.75Z",
  code: "M5.25 4.5 1.75 8l3.5 3.5M10.75 4.5 14.25 8l-3.5 3.5M9.1 2.75 6.9 13.25",
  shield: "M8 1.75 2.75 3.6v4.15c0 3.05 2.2 5.4 5.25 6.5 3.05-1.1 5.25-3.45 5.25-6.5V3.6L8 1.75Z",
  pulse: "M1.75 8.25h2.5l1.5-3.75 2.75 7.5 1.75-5 1 1.25h3",
  palette: {
    s: "M8 1.75a6.25 6.25 0 1 0 0 12.5c.83 0 1.25-.55 1.25-1.2 0-.75-.6-1.05-.6-1.75 0-.62.5-1.05 1.15-1.05h1.45a3 3 0 0 0 3-3C14.25 4.2 11.45 1.75 8 1.75Z",
    f: dot(4.75, 8.25, 0.8) + dot(5.75, 5.25, 0.8) + dot(8.75, 4.25, 0.8) + dot(11.25, 6.25, 0.8),
  },
};
export const ICONS = Object.keys(P);
const IC_PX = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 }; // 和 --ic-xs … --ic-xl 一致；宽高属性只是样式表加载前的兜底

const cx = (...a) => a.filter(Boolean).join(" ");

/**
 * 图标。size = "xs" 12 | "sm" 14 | "md" 16 | "lg" 20 | "xl" 24；不传时由上下文的 CSS 决定（缺省 md）。
 * strong：实心面上的图标（发送钮、完成圆点）用粗一档的线。线宽按显示像素算，换尺寸不会变粗。
 */
export function Icon({ name, size, strong, class: cls }) {
  const p = P[name];
  const s = typeof p === "string" ? p : p.s;
  const f = typeof p === "string" ? null : p.f;
  const px = IC_PX[size] ?? IC_PX.md;
  return html`<svg class=${cx("ic", size && `ic-${size}`, strong && "ic-strong", cls)} width=${px} height=${px} viewBox="0 0 16 16" fill="none"
    stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s && html`<path d=${s} />`}${f && html`<path d=${f} fill="currentColor" stroke="none" />`}</svg>`;
}

/** 按钮：variant = "primary" | "ghost" | "danger"；size = "sm" | "lg"；loading 时转圈并禁用 */
export function Button({ variant, size, block, loading, icon, class: cls, type = "button", disabled, children, ...rest }) {
  return html`<button type=${type} class=${cx("btn", variant, size, block && "block", cls)} disabled=${disabled || loading} aria-busy=${loading || undefined} ...${rest}>
    ${loading ? html`<${Spinner} />` : icon && html`<${Icon} name=${icon} size="sm" />`}${children}
  </button>`;
}

/** 图标按钮：必须给 label（读屏与悬停提示） */
export function IconButton({ icon, label, size, iconSize = "sm", on, class: cls, type = "button", ...rest }) {
  return html`<button type=${type} class=${cx("icon-btn", size, on && "on", cls)} title=${label} aria-label=${label} ...${rest}>
    <${Icon} name=${icon} size=${iconSize} />
  </button>`;
}

/** 行内提示：tone = "amber" | "red"（缺省为中性）；左边一个图标表达语气，action 放在右侧 */
export function Notice({ tone, action, children }) {
  return html`<div class=${cx("notice", tone)} role=${tone === "red" ? "alert" : undefined}>
    <${Icon} name=${tone ? "alert" : "info"} size="sm" /><span class="notice-text">${children}</span>${action}
  </div>`;
}

/** 骨架条：w / h 为任意 CSS 长度；circle 画圆 */
export function Skeleton({ w, h: height, circle }) {
  return html`<span class=${cx("skel", circle && "circle")} style=${{ width: w, height: height ?? (circle ? w : undefined) }} aria-hidden="true"></span>`;
}

/** 关闭 / 外部点击 / Esc */
export function useDismiss(ref, onClose, active = true, ignore) {
  useEffect(() => {
    if (!active) return;
    const down = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (ignore?.current?.contains(e.target)) return;
      onClose();
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [active, onClose]);
}

// —— 开关：只有开 / 关两态的设置 ——
export function Switch({ value, onChange, disabled, label, size }) {
  return html`<button type="button" role="switch" class=${cx("switch", size)} aria-checked=${!!value} aria-label=${label} title=${label}
    disabled=${disabled} onClick=${() => onChange(!value)}></button>`;
}

// —— 分段控件：滑动的 thumb ——
export function Seg({ options, value, onChange, disabled, label }) {
  const ref = useRef(null);
  const thumb = useRef(null);
  const first = useRef(true);
  const place = useCallback(() => {
    const on = ref.current?.querySelector("button.on");
    const t = thumb.current;
    if (!t) return;
    if (!on) {
      t.style.opacity = "0";
      return;
    }
    t.style.opacity = "1";
    t.style.width = on.offsetWidth + "px";
    t.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);
  useLayoutEffect(() => {
    place();
    if (first.current) {
      first.current = false;
      requestAnimationFrame(() => thumb.current?.classList.remove("still"));
    }
  }, [value, options.length]);
  useEffect(() => {
    document.fonts?.ready?.then(place);
  }, []);
  return html`<div class=${`seg${disabled ? " disabled" : ""}`} ref=${ref} role="radiogroup" aria-label=${label}>
    <span class="thumb still" ref=${thumb} aria-hidden="true"></span>
    ${options.map(([v, text, title]) => html`<button type="button" role="radio" aria-checked=${v === value} class=${v === value ? "on" : ""}
      disabled=${disabled} title=${title} onClick=${() => v !== value && onChange(v)}>${text}</button>`)}
  </div>`;
}

/** 长度 token 的像素值（"--pop-offset" → 6，"--side-w-cap: 36vw" → 窗口宽 × .36）：JS 里的尺寸也从 token 来，不写死。
 *  el：从哪个元素上读（缺省 <html>；注册过的属性如 .app 上的 --side-col 要从定义它的元素读） */
export function tokenPx(name, fallback, el = document.documentElement) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith("vw") ? (n * window.innerWidth) / 100 : n;
}

// —— 分隔条：拖动两块面板之间的空隙调整一侧面板的宽度（README「分隔条」，样式 design/components/splitter.css）——
const SPLIT_STEP = 8; //      ← → 一次挪 8px，按住 Shift 挪 32px
const SPLIT_STEP_BIG = 32;
const SPLIT_SNAP = 6; //      拖到离默认宽度 6px 以内时吸附回默认宽度
/**
 * size：宽度 token，例如 "--side-w"：默认宽度 --side-w，范围 --side-w-min … min(--side-w-max, --side-w-cap, room())；
 *   拖动时直接改 <html> 上的 --side-w-user（不经过渲染，跟手），页面用 var(--side-w-user, var(--side-w)) 取值。
 * edge：面板在分隔条的哪一边。"start" = 左边的面板（往右拖变宽），"end" = 右边的面板（往左拖变宽）。
 * value：当前保存的宽度（px，0 = 默认），变了会同步读屏的数值。
 * room()：可选，此刻最多还能给多宽（比如窗口宽 − 另一侧面板 − 主区最小宽度）。
 * onCommit(px)：松手、键盘调整、双击恢复时调用一次；px = 0 表示回到默认宽度（之后跟着默认值和断点走）。
 * 交互：拖动；双击恢复默认；聚焦后 ← → 调整（Shift 大步），Home / End 最窄 / 最宽，Enter 恢复默认。
 */
export function Splitter({ size, edge = "start", label, value = 0, room, onCommit, class: cls }) {
  const ref = useRef(null);
  const root = document.documentElement;
  const user = `${size}-user`;
  // cap：CSS 里的上限（-max 和 -cap，页面的 clamp() 也是它）；max 再加上此刻的 room()。
  // 已经比 room 宽的面板不会被一下子挤窄，只是不能再变宽
  const limits = () => {
    const def = Math.round(tokenPx(size, 0));
    const min = Math.round(tokenPx(`${size}-min`, def));
    const cap = Math.max(min, Math.round(Math.min(tokenPx(`${size}-max`, Infinity), tokenPx(`${size}-cap`, Infinity))));
    const w = Math.round(Math.min(cap, Math.max(min, tokenPx(user, def))));
    const max = Math.max(min, Math.min(cap, Math.max(w, room ? Math.round(room()) : Infinity)));
    return { def, min, max, w };
  };
  const clamp = (w, l) => Math.round(Math.min(l.max, Math.max(l.min, w)));
  const current = (l) => l.w;
  const sync = (w, l) => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("aria-valuenow", String(w));
    el.setAttribute("aria-valuemin", String(l.min));
    el.setAttribute("aria-valuemax", String(l.max));
  };
  const write = (w) => (w ? root.style.setProperty(user, `${w}px`) : root.style.removeProperty(user));
  const commit = (w, l) => {
    const v = w === l.def ? 0 : w;
    write(v);
    sync(w, l);
    onCommit?.(v);
  };
  useLayoutEffect(() => {
    const l = limits();
    sync(current(l), l);
  }, [value]);

  const onPointerDown = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault(); // 不选中文字、不抢焦点
    const el = ref.current;
    const l = limits();
    const start = current(l);
    const x0 = e.clientX;
    const dir = edge === "start" ? 1 : -1;
    // 到头了：指针换成单向箭头，提示只能往另一边拖
    const grow = edge === "start" ? "e" : "w";
    const shrink = edge === "start" ? "w" : "e";
    let w = start;
    let moved = false;
    let raf = 0;
    let done = false;
    el.setPointerCapture?.(e.pointerId);
    const paint = () => {
      raf = 0;
      write(w);
      el.setAttribute("aria-valuenow", String(w));
      root.dataset.resizing = w >= l.max && l.max > l.min ? shrink : w <= l.min && l.max > l.min ? grow : "col";
    };
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved) {
        if (Math.abs(dx) < 2) return; // 手抖不算拖：双击时不会把宽度改掉
        moved = true;
        el.classList.add("dragging");
        root.dataset.resizing = "col";
      }
      let next = clamp(start + dir * dx, l);
      if (Math.abs(next - l.def) <= SPLIT_SNAP && l.def >= l.min && l.def <= l.max) next = l.def;
      w = next;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const end = () => {
      if (done) return;
      done = true;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
      if (raf) {
        // 最后一次移动还没画：趁 data-resizing 还在（列宽不过渡）先画上并让样式生效，松手时不会再"滑"一下
        cancelAnimationFrame(raf);
        paint();
        void getComputedStyle(el).left;
      }
      el.classList.remove("dragging");
      delete root.dataset.resizing;
      if (moved) commit(w, l);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };
  const reset = () => {
    const l = limits();
    commit(clamp(l.def, l), l);
  };
  const onKeyDown = (e) => {
    const l = limits();
    const cur = current(l);
    const step = e.shiftKey ? SPLIT_STEP_BIG : SPLIT_STEP;
    const wider = edge === "start" ? "ArrowRight" : "ArrowLeft";
    const narrower = edge === "start" ? "ArrowLeft" : "ArrowRight";
    const next =
      e.key === wider ? cur + step : e.key === narrower ? cur - step : e.key === "Home" ? l.min : e.key === "End" ? l.max : e.key === "Enter" ? l.def : null;
    if (next === null) return;
    e.preventDefault();
    commit(clamp(next, l), l);
  };
  return html`<div class=${cx("splitter", cls)} ref=${ref} role="separator" aria-orientation="vertical" aria-label=${label} tabindex="0"
    onPointerDown=${onPointerDown} onDblClick=${reset} onKeyDown=${onKeyDown}></div>`;
}

/** 打开在锚点下方（空间不够时在上方）的浮层，position: fixed。离锚点 --pop-offset，离窗口边缘 --pane-gap（和面板的边对齐） */
export function usePopPosition(anchor, open, { width = 280, prefer = "down", align = "left", maxHeight = 360 } = {}) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return setPos(null);
    const compute = () => {
      const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = tokenPx("--pop-offset", 6);
      const edge = tokenPx("--pane-gap", 8);
      const below = vh - r.bottom - gap - edge;
      const above = r.top - gap - edge;
      const up = prefer === "up" ? above > 160 || above > below : below < Math.min(maxHeight, 220) && above > below;
      let left = align === "right" ? r.right - width : r.left;
      left = Math.max(edge, Math.min(left, vw - width - edge));
      const ox = Math.max(12, Math.min(width - 12, r.left + (r.width || 0) / 2 - left));
      setPos(up ? { left, bottom: vh - r.top + gap, up: true, ox, max: Math.min(maxHeight, above) } : { left, top: r.bottom + gap, up: false, ox, max: Math.min(maxHeight, below) });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [open, anchor]);
  return pos;
}

export function Popover({ anchor, onClose, class: cls = "", width = 280, prefer, align, maxHeight, children, label, keepFocus }) {
  const ref = useRef(null);
  const anchorRef = useRef(anchor && anchor.nodeType ? anchor : null);
  anchorRef.current = anchor && anchor.nodeType ? anchor : null;
  const pos = usePopPosition(anchor, true, { width, prefer, align, maxHeight });
  useDismiss(ref, onClose, true, anchorRef);
  useEffect(() => {
    if (keepFocus) return;
    const prev = document.activeElement;
    requestAnimationFrame(() => {
      const target = ref.current?.querySelector("input, [role=option], [role=menuitem], button");
      target?.focus?.();
    });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  if (!pos) return null;
  const style = { left: pos.left + "px", width: width + "px", "--ox": pos.ox + "px", maxHeight: pos.max + "px", ...(pos.up ? { bottom: pos.bottom + "px" } : { top: pos.top + "px" }) };
  return html`<div class=${`pop ${cls}${pos.up ? " up" : ""}`} ref=${ref} style=${style} role="dialog" aria-label=${label}>${children}</div>`;
}

/**
 * 菜单：items = [{ label, note, onSelect, danger, disabled, cur }] | { sep: true } | { group: "…" }
 * 键盘：↑↓ 选择，Enter 执行，Esc 关闭。
 */
export function Menu({ anchor, items, onClose, width = 240, prefer, align, label }) {
  const pickable = items.map((it, i) => (it.sep || it.group || it.disabled ? -1 : i)).filter((i) => i >= 0);
  const [sel, setSel] = useState(pickable[0] ?? -1);
  const listRef = useRef(null);
  const run = (it) => {
    onClose();
    it.onSelect?.();
  };
  const onKey = (e) => {
    const k = pickable.indexOf(sel);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel(pickable[(k + 1) % pickable.length]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel(pickable[(k - 1 + pickable.length) % pickable.length]);
    } else if (e.key === "Enter" && sel >= 0) {
      e.preventDefault();
      run(items[sel]);
    }
  };
  useEffect(() => listRef.current?.focus(), []);
  return html`<${Popover} anchor=${anchor} onClose=${onClose} width=${width} prefer=${prefer} align=${align} label=${label}>
    <ul role="menu" tabindex="-1" ref=${listRef} onKeyDown=${onKey} style="outline:none">
      ${items.map((it, i) =>
        it.sep
          ? html`<li class="sep" role="separator"></li>`
          : it.group
            ? html`<li class="group">${it.group}</li>`
            : html`<li role="menuitem" aria-disabled=${!!it.disabled}
                class=${[sel === i ? "sel" : "", it.danger ? "danger" : "", it.disabled ? "disabled" : "", it.cur ? "cur" : "", it.note ? "rich" : ""].join(" ")}
                onPointerMove=${() => !it.disabled && setSel(i)} onClick=${() => !it.disabled && run(it)}>
                ${it.icon && html`<span class="lead"><${Icon} name=${it.icon} size="sm" /></span>`}
                ${it.note ? html`<span class="txt"><span class="v">${it.label}</span><span class="n">${it.note}</span></span>` : html`<span class="v">${it.label}</span>`}
                <span class="check"><${Icon} name="check" size="sm" /></span>
              </li>`,
      )}
    </ul>
  <//>`;
}

/** 行右侧的菜单按钮（magpie .proto.pick） */
export function MenuButton({ value, options, onChange, disabled, label, width = 260 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cur = options.find((o) => o[0] === value);
  return html`<button type="button" class="pick" ref=${ref} disabled=${disabled} aria-haspopup="menu" aria-expanded=${open} aria-label=${label}
      onClick=${() => setOpen((v) => !v)}>
      <span class="v">${cur ? cur[1] : value || "—"}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${Menu} anchor=${ref.current} width=${width} align="right" label=${label} onClose=${() => setOpen(false)}
      items=${options.map(([v, text, note]) => ({ label: text, note, cur: v === value, onSelect: () => v !== value && onChange(v) }))} />`}`;
}

/** label 缺省为「复制」 */
export function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  const name = label || t("common.copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return html`<button type="button" class=${`icon-btn copy${done ? " done" : ""}`} title=${done ? t("common.copied") : name} aria-label=${name} onClick=${copy}>
    <${Icon} name=${done ? "check" : "copy"} size="sm" />
  </button>`;
}

/** 状态 → 徽标的语气；文字在 ui/locales/<语言>/ui.js 的 state.<状态>。不认识的状态原样显示 */
const STATE_KIND = {
  disabled: "off", connecting: "warn", connected: "ok", error: "err", expired: "err",
  paused: "off", login_required: "off", running: "ok", starting: "warn", restarting: "warn",
  failed: "err", stopped: "off", wait: "warn", scaned: "warn", need_verifycode: "warn",
  confirmed: "ok", already_bound: "ok", cancelled: "off", idle: "off", fetching: "warn",
  pending: "warn", allowed: "ok", rejected: "err", answered: "ok",
  denied: "err",
};
export const Badge = ({ s }) => {
  const known = Object.hasOwn(STATE_KIND, s) && has(`ui.state.${s}`);
  return html`<span class=${`badge ${known ? STATE_KIND[s] : ""}`}>${known ? t(`ui.state.${s}`) : s}</span>`;
};

/** 自绘确认框：焦点先在"取消"（安全选项），Esc 关闭，Tab 在框内循环 */
export function Sheet({ title, onClose, children, wide, label, leaving }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    requestAnimationFrame(() => (ref.current?.querySelector("[data-autofocus]") || ref.current?.querySelector("button, input, textarea"))?.focus());
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll("button:not(:disabled), input, textarea, a[href], [tabindex='0']")];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  return html`<div class=${cx("scrim", leaving && "leaving")} onPointerDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${`sheet${wide ? " wide" : ""}`} ref=${ref} role="dialog" aria-modal="true" aria-label=${label || title}>
      ${title && html`<h2>${title}</h2>`}
      ${children}
    </div>
  </div>`;
}

export function DialogHost() {
  const cur = useStore(dialog);
  const last = useRef(cur);
  if (cur) last.current = cur;
  const { mounted, leaving } = usePresence(!!cur);
  if (!mounted) return null;
  const d = last.current;
  const done = (v) => {
    if (leaving) return;
    dialog.set(null);
    d.resolve(v);
  };
  return html`<${Sheet} title=${d.title} leaving=${leaving} onClose=${() => done(false)}>
    ${d.body && html`<p class="body">${d.body}</p>`}
    <div class="actions">
      <${Button} data-autofocus onClick=${() => done(false)}>${d.cancelLabel || t("common.cancel")}<//>
      <${Button} variant=${d.danger ? "danger" : "primary"} onClick=${() => done(true)}>${d.confirmLabel || t("common.confirm")}<//>
    </div>
  <//>`;
}

export function Toasts() {
  const list = useStore(toasts);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map((it) => html`<div key=${it.id} class=${`toast ${it.kind}${it.leaving ? " leaving" : ""}`}>
      <span>${it.text}</span>
      ${it.kind === "err" && html`<${IconButton} icon="close" size="xs" iconSize="xs" label=${t("common.close")} onClick=${() => dismissToast(it.id)} />`}
    </div>`)}
  </div>`;
}

export function Spinner() {
  return html`<span class="spinner" aria-hidden="true"></span>`;
}

/** 文本框随内容增高（最多 max 行） */
export function autoGrow(el, maxPx) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, maxPx || 9999) + "px";
}
