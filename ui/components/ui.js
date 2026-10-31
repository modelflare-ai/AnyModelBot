// 共用组件：图标、按钮、分段控件、弹出菜单、确认框、提示胶囊、复制按钮、骨架。
// 样式在 ui/design/components/*.css；这里的组件只是给常用组合一个带逻辑的写法，直接写 class 也可以。
import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "preact/hooks";
import htm from "htm";
import { useStore, toasts, dismissToast, dialog } from "../lib/store.js";
import { usePresence } from "../design/motion.js";

export const html = htm.bind(h);

// —— 线性图标（16px，currentColor）——
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
  stop: "M4.5 4.5h7v7h-7z",
  more: "M4 8h.01M8 8h.01M12 8h.01",
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
  info: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 7.25v3.75M8 4.9v.1",
  alert: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.75v3.75M8 11v.1",
  chat: "M3.25 2.75h9.5c.41 0 .75.34.75.75v6.75c0 .41-.34.75-.75.75H7.25L4.5 13.25V11H3.25a.75.75 0 0 1-.75-.75V3.5c0-.41.34-.75.75-.75Z",
  code: "M5.25 4.5 1.75 8l3.5 3.5M10.75 4.5 14.25 8l-3.5 3.5M9.1 2.75 6.9 13.25",
  shield: "M8 1.75 2.75 3.6v4.15c0 3.05 2.2 5.4 5.25 6.5 3.05-1.1 5.25-3.45 5.25-6.5V3.6L8 1.75Z",
  pulse: "M1.75 8.25h2.5l1.5-3.75 2.75 7.5 1.75-5 1 1.25h3",
};
export function Icon({ name, size = 16, stroke = 1.6, class: cls = "" }) {
  const fill = name === "stop";
  return html`<svg class=${`ic ${cls}`} width=${size} height=${size} viewBox="0 0 16 16" fill=${fill ? "currentColor" : "none"}
    stroke="currentColor" stroke-width=${name === "more" ? 2.6 : stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name]} /></svg>`;
}

const cx = (...a) => a.filter(Boolean).join(" ");

/** 按钮：variant = "primary" | "ghost" | "danger"；size = "sm" | "lg"；loading 时转圈并禁用 */
export function Button({ variant, size, block, loading, icon, class: cls, type = "button", disabled, children, ...rest }) {
  return html`<button type=${type} class=${cx("btn", variant, size, block && "block", cls)} disabled=${disabled || loading} aria-busy=${loading || undefined} ...${rest}>
    ${loading ? html`<${Spinner} />` : icon && html`<${Icon} name=${icon} size=${14} />`}${children}
  </button>`;
}

/** 图标按钮：必须给 label（读屏与悬停提示） */
export function IconButton({ icon, label, size, iconSize = 14, on, class: cls, type = "button", ...rest }) {
  return html`<button type=${type} class=${cx("icon-btn", size, on && "on", cls)} title=${label} aria-label=${label} ...${rest}>
    <${Icon} name=${icon} size=${iconSize} />
  </button>`;
}

/** 行内提示：tone = "amber" | "red"（缺省为中性）；左边一个图标表达语气，action 放在右侧 */
export function Notice({ tone, action, children }) {
  return html`<div class=${cx("notice", tone)} role=${tone === "red" ? "alert" : undefined}>
    <${Icon} name=${tone ? "alert" : "info"} size=${14} /><span class="notice-text">${children}</span>${action}
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

/** 长度 token 的像素值（"--pop-offset" → 6）：JS 里的间距也从 token 来，不写死 */
function tokenPx(name, fallback) {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) ? n : fallback;
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
                ${it.icon && html`<span class="lead"><${Icon} name=${it.icon} size=${15} /></span>`}
                ${it.note ? html`<span class="txt"><span class="v">${it.label}</span><span class="n">${it.note}</span></span>` : html`<span class="v">${it.label}</span>`}
                <span class="check"><${Icon} name="check" size=${14} /></span>
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

export function CopyButton({ text, label = "复制" }) {
  const [done, setDone] = useState(false);
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
  return html`<button type="button" class=${`icon-btn copy${done ? " done" : ""}`} title=${done ? "已复制" : label} aria-label=${label} onClick=${copy}>
    <${Icon} name=${done ? "check" : "copy"} size=${14} />
  </button>`;
}

const STATE = {
  disabled: ["未启用", "off"], connecting: ["连接中", "warn"], connected: ["已连接", "ok"], error: ["错误", "err"], expired: ["已过期", "err"],
  paused: ["已暂停", "off"], login_required: ["未登录", "off"], running: ["运行中", "ok"], starting: ["启动中", "warn"], restarting: ["重启中", "warn"],
  failed: ["失败", "err"], stopped: ["已停止", "off"], wait: ["等待扫码", "warn"], scaned: ["已扫码", "warn"], need_verifycode: ["需验证码", "warn"],
  confirmed: ["已确认", "ok"], already_bound: ["已绑定", "ok"], cancelled: ["已取消", "off"], idle: ["空闲", "off"], fetching: ["获取中", "warn"],
  pending: ["待处理", "warn"], allowed: ["已批准", "ok"], rejected: ["已拒绝", "err"], answered: ["已回答", "ok"],
};
export const Badge = ({ s }) => {
  const [text, kind] = STATE[s] || [s, ""];
  return html`<span class=${`badge ${kind}`}>${text}</span>`;
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
      <${Button} data-autofocus onClick=${() => done(false)}>${d.cancelLabel || "取消"}<//>
      <${Button} variant=${d.danger ? "danger" : "primary"} onClick=${() => done(true)}>${d.confirmLabel || "确定"}<//>
    </div>
  <//>`;
}

export function Toasts() {
  const list = useStore(toasts);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map((t) => html`<div key=${t.id} class=${`toast ${t.kind}${t.leaving ? " leaving" : ""}`}>
      <span>${t.text}</span>
      ${t.kind === "err" && html`<${IconButton} icon="close" size="xs" iconSize=${12} label="关闭" onClick=${() => dismissToast(t.id)} />`}
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
