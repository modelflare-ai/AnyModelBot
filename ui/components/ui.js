// 共用组件：图标、按钮、分段控件、弹出菜单、确认框、提示胶囊、复制按钮、骨架。
// 样式在 ui/design/components/*.css；这里的组件只是给常用组合一个带逻辑的写法，直接写 class 也可以。
import { h, render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "preact/hooks";
import htm from "htm";
import { HEROICONS } from "../icons/heroicons.js";
import { useStore, toasts, dismissToast, dialog } from "../lib/store.js";
import { usePresence } from "../design/motion.js";
import { has, t } from "../lib/i18n.js";

export const html = htm.bind(h);

// Heroicons Outline 通用操作图标：保留应用内部名称，原始图形与出处见 ui/icons/。
export const ICONS = Object.keys(HEROICONS);
const IC_PX = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 }; // 和 --ic-xs … --ic-xl 一致；宽高属性只是样式表加载前的兜底

const cx = (...a) => a.filter(Boolean).join(" ");

/**
 * 图标。size = "xs" 12 | "sm" 14 | "md" 16 | "lg" 20 | "xl" 24；不传时由上下文的 CSS 决定（缺省 md）。
 * strong：实心面上的图标（发送钮、完成圆点）用粗一档的线。线宽按显示像素算，换尺寸不会变粗。
 */
export function Icon({ name, size, strong, class: cls }) {
  // 兼容历史数字写法，但仍只允许五档尺寸；CSS 和 SVG 的尺寸使用同一个规范化值。
  const sizeName = Object.hasOwn(IC_PX, size) ? size : Object.keys(IC_PX).find((key) => IC_PX[key] === Number(size)) || "md";
  const px = IC_PX[sizeName];
  return html`<svg class=${cx("ic", `ic-${sizeName}`, strong && "ic-strong", cls)} width=${px} height=${px} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${HEROICONS[name].map(([tag, attrs], key) => h(tag, { ...attrs, key }))}</svg>`;
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
      if (e.isComposing || e.keyCode === 229) return;
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

// —— 档位滑块：几档离散的值（模型选择器里的性价比、模型智能）——
/**
 * 方向键怎么走：→ ↑ 往后一档，← ↓ 往前一档，Home / End 两头。value < 0 是"不在任何一档上"：从 anchor（落在哪两档之间的小数位置）
 * 往上或往下走到最近的一档，没有 anchor 时去 fallback。不是这几个键时 undefined。
 */
export function stepKey(key, value, count, anchor, fallback = 0) {
  const last = count - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  const up = key === "ArrowRight" || key === "ArrowUp";
  const down = key === "ArrowLeft" || key === "ArrowDown";
  if (!up && !down) return undefined;
  if (value < 0) return anchor === undefined ? fallback : Math.max(0, Math.min(last, up ? Math.ceil(anchor) : Math.floor(anchor)));
  return Math.max(0, Math.min(last, value + (up ? 1 : -1)));
}

/**
 * count 档的滑块（role=slider）。value = 当前档，-1 = 不在任何一档上（没有圆钮和填充，见 stepKey）。
 * 拖动时只预览，松手才 onChange；点轨道直接跳到那一档；键盘见 stepKey。valueText 是读屏读的当前值。
 */
export function Stops({ count, value, onChange, label, valueText, anchor, fallback = 0, autoFocus, class: cls }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const shown = drag ?? value;
  const last = Math.max(1, count - 1);
  /** 指针落在哪一档：圆钮中心离两头各半个轨道高 */
  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left - r.height / 2) / Math.max(1, r.width - r.height);
    return Math.max(0, Math.min(count - 1, Math.round(x * last)));
  };
  const end = (e) => {
    if (drag === null) return;
    setDrag(null);
    const v = at(e);
    if (v !== value) onChange(v);
  };
  const onKeyDown = (e) => {
    const v = stepKey(e.key, value, count, anchor, fallback);
    if (v === undefined) return;
    e.preventDefault();
    if (v !== value) onChange(v);
  };
  return html`<div class=${cx("stops", shown < 0 && "custom", drag !== null && "dragging", cls)} ref=${ref} role="slider" tabindex="0" data-autofocus=${autoFocus ? "" : undefined}
      aria-label=${label} aria-valuemin="0" aria-valuemax=${count - 1} aria-valuenow=${shown >= 0 ? shown : undefined} aria-valuetext=${valueText}
      style=${{ "--stops-at": String(shown >= 0 ? shown / last : 0) }}
      onKeyDown=${onKeyDown} onPointerDown=${(e) => { ref.current.setPointerCapture?.(e.pointerId); setDrag(at(e)); }}
      onPointerMove=${(e) => drag !== null && setDrag(at(e))} onPointerUp=${end} onPointerCancel=${() => setDrag(null)}>
    <span class="stops-fill"></span>
    ${Array.from({ length: count }, (_, i) => html`<span key=${i} class=${cx("stops-dot", shown >= 0 && i <= shown && "on")} style=${{ "--stops-i": String(i / last) }}></span>`)}
    <span class="stops-knob"></span>
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
      const next = up ? { left, bottom: vh - r.top + gap, max: Math.min(maxHeight, above) } : { left, top: r.bottom + gap, max: Math.min(maxHeight, below) };
      setPos((p) => (p && p.left === next.left && p.top === next.top && p.bottom === next.bottom && p.max === next.max ? p : next));
    };
    compute();
    // 任何一层滚动（capture 才收得到）或窗口变化，都跟着锚点走
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchor]);
  return pos;
}

/**
 * 渲染到 <body> 下面的一层。祖先带 backdrop-filter / transform（对话框、抽屉、正在入场的页面）时，
 * position: fixed 是相对它们算的，还会被它们裁切，所以浮层都放到最外面。
 */
function Portal({ children }) {
  const host = useRef(null);
  if (!host.current) host.current = document.createElement("div");
  useLayoutEffect(() => {
    const el = host.current;
    document.body.appendChild(el);
    return () => {
      render(null, el);
      el.remove();
    };
  }, []);
  useLayoutEffect(() => {
    render(children, host.current);
  });
  return null;
}

/**
 * 浮层。anchor 决定位置；点 anchor 不算"点外面"（让它自己的 onClick 去开关）。
 * trigger：位置跟着一块更大的区域、开关却是其中一个按钮时传这个按钮，只有点它不关浮层（账户菜单贴着整个账户区）。
 */
export function Popover({ anchor, trigger, onClose, class: cls = "", width = 280, prefer, align, maxHeight, children, label, keepFocus }) {
  const ref = useRef(null);
  const own = trigger || anchor;
  const anchorRef = useRef(own && own.nodeType ? own : null);
  anchorRef.current = own && own.nodeType ? own : null;
  const pos = usePopPosition(anchor, true, { width, prefer, align, maxHeight });
  useDismiss(ref, onClose, true, anchorRef);
  useEffect(() => {
    if (keepFocus) return;
    const prev = document.activeElement;
    requestAnimationFrame(() => {
      const target = ref.current?.querySelector("[data-autofocus]") || ref.current?.querySelector("input, [role=option], [role=menuitem], button");
      target?.focus?.();
    });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  if (!pos) return null;
  const style = { left: pos.left + "px", width: width + "px", maxHeight: pos.max + "px", ...(pos.bottom !== undefined ? { bottom: pos.bottom + "px" } : { top: pos.top + "px" }) };
  // 局部主题（样例页的双主题对照）跟着锚点
  const theme = anchor?.closest?.("[data-theme]:not(html)")?.dataset.theme;
  return html`<${Portal}><div class=${`pop ${cls}`} ref=${ref} style=${style} role="dialog" aria-label=${label} data-theme=${theme}>${children}</div><//>`;
}

/**
 * 菜单：items = [{ label, icon, note, onSelect, danger, disabled, cur }] | { sep: true } | { group: "…" }
 * 键盘：↑↓ 选择，Enter 执行，Esc 关闭。
 */
export function Menu({ anchor, items, onClose, width = 240, prefer, align, label }) {
  const hasIcons = items.some((it) => it.icon);
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
  return html`<${Popover} class="menu-pop" anchor=${anchor} onClose=${onClose} width=${width} prefer=${prefer} align=${align} label=${label}>
    <ul role="menu" tabindex="-1" ref=${listRef} onKeyDown=${onKey} style="outline:none">
      ${items.map((it, i) =>
        it.sep
          ? html`<li class="sep" role="separator"></li>`
          : it.group
            ? html`<li class="group">${it.group}</li>`
            : html`<li role="menuitem" aria-disabled=${!!it.disabled}
                class=${[sel === i ? "sel" : "", it.danger ? "danger" : "", it.disabled ? "disabled" : "", it.cur ? "cur" : "", it.note ? "rich" : ""].join(" ")}
                onPointerMove=${() => !it.disabled && setSel(i)} onClick=${() => !it.disabled && run(it)}>
                ${hasIcons && html`<span class=${cx("lead", !it.icon && "empty-icon")} aria-hidden="true">${it.icon && html`<${Icon} name=${it.icon} size="sm" />`}</span>`}
                ${it.note ? html`<span class="txt"><span class="v">${it.label}</span><span class="n">${it.note}</span></span>` : html`<span class="v">${it.label}</span>`}
                ${it.kbd && html`<kbd class="menu-shortcut">${it.kbd}</kbd>`}
                <span class="check"><${Icon} name="check" size="sm" /></span>
              </li>`,
      )}
    </ul>
  <//>`;
}

/** 行右侧的菜单按钮（magpie .proto.pick） */
export function MenuButton({ value, options, onChange, disabled, label, width = 260, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cur = options.find((o) => o[0] === value);
  return html`<button type="button" class="pick" ref=${ref} disabled=${disabled} aria-haspopup="menu" aria-expanded=${open} aria-label=${label}
      onClick=${() => setOpen((v) => !v)}>
      <span class="v">${cur ? cur[1] : value || "—"}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${Menu} anchor=${ref.current} width=${width} align=${align} label=${label} onClose=${() => setOpen(false)}
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
/** sticky：点遮罩不关（扫码、填表进行到一半时，误点不该把流程丢掉）；Esc 和关闭钮照常 */
export function Sheet({ title, onClose, children, wide, label, leaving, closable = true, sticky = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    requestAnimationFrame(() => (ref.current?.querySelector("[data-autofocus]") || ref.current?.querySelector("input, textarea") || ref.current?.querySelector("button"))?.focus());
    const key = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        // 对话框里开着下拉时，Esc 先关下拉（useDismiss）
        if (document.querySelector(".pop")) return;
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
  return html`<div class=${cx("scrim", leaving && "leaving")} onPointerDown=${(e) => !sticky && e.target === e.currentTarget && onClose()}>
    <div class=${`sheet${wide ? " wide" : ""}`} ref=${ref} role="dialog" aria-modal="true" aria-label=${label || title}>
      ${title && html`<div class="sheet-head"><h2>${title}</h2>${closable && html`<${IconButton} icon="close" iconSize="md" class="sheet-close" label=${t("common.close")} onClick=${onClose} />`}</div>`}
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
  return html`<${Sheet} title=${d.title} leaving=${leaving} closable=${false} onClose=${() => done(false)}>
    ${d.body && html`<p class="body">${d.body}</p>`}
    ${d.check && html`<label class="sheet-check"><input type="checkbox" checked=${d.check.value} onChange=${(e) => (d.check.value = e.target.checked)} /><span>${d.check.label}</span></label>`}
    <div class="actions">
      <${Button} variant=${d.cancelVariant} data-autofocus onClick=${() => done(false)}>${d.cancelLabel || t("common.cancel")}<//>
      <${Button} variant=${d.confirmVariant || (d.danger ? "danger" : "primary")} onClick=${() => done(true)}>${d.confirmLabel || t("common.confirm")}<//>
    </div>
  <//>`;
}

export function Toasts({ scope = "" }) {
  const list = useStore(toasts);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.filter((it) => (it.scope || "") === scope).map((it) => html`<div key=${it.id} class=${`toast ${it.kind}${it.leaving ? " leaving" : ""}`}>
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
