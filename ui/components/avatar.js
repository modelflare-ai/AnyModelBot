// 机器人头像（每个机器人一个色相；只在工作中才动）与应用标志。
import { useEffect } from "preact/hooks";
import { html } from "./ui.js";

/** Stable soft hue (0–359) from bot id/name. */
export function botHue(id, name) {
  const s = String(id || name || "?");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/**
 * One shared pointermove on a container; writes --look-x/--look-y on each working face
 * inside it (idle faces stay still).
 */
export function usePointerLook(containerRef) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let px = -1e5;
    let py = -1e5;
    const apply = () => {
      raf = 0;
      for (const el of root.querySelectorAll(".bot-face.is-working")) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const dx = px - (r.left + r.width / 2);
        const dy = py - (r.top + r.height / 2);
        const reach = Math.max(96, r.width * 3.2);
        const fall = Math.max(0, 1 - Math.hypot(dx, dy) / reach);
        el.style.setProperty("--look-x", Math.max(-1, Math.min(1, (dx / (r.width * 0.55)) * fall)).toFixed(3));
        el.style.setProperty("--look-y", Math.max(-1, Math.min(1, (dy / (r.height * 0.55)) * fall)).toFixed(3));
      }
    };
    const onMove = (e) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      px = py = -1e5;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

export function BotAvatar({ name, id, size = 34, working = false }) {
  const vb = size;
  const eyeR = size * 0.11;
  const pupilR = size * 0.055;
  const eyeY = size * 0.42;
  const eyeDX = size * 0.16;
  const mouthY = size * 0.68;
  return html`<div class=${`bot-face${working ? " is-working" : ""}`} style=${{ width: size + "px", height: size + "px", "--bot-hue": String(botHue(id, name)) }} aria-hidden="true">
    <div class="bot-face-3d">
      <svg width=${size} height=${size} viewBox=${`0 0 ${vb} ${vb}`} xmlns="http://www.w3.org/2000/svg">
        <circle class="bot-head" cx=${vb / 2} cy=${vb / 2} r=${vb / 2 - 0.5} />
        <ellipse class="bot-eye-white" cx=${vb / 2 - eyeDX} cy=${eyeY} rx=${eyeR * 1.15} ry=${eyeR} />
        <ellipse class="bot-eye-white" cx=${vb / 2 + eyeDX} cy=${eyeY} rx=${eyeR * 1.15} ry=${eyeR} />
        <g class="bot-pupils">
          <circle class="bot-pupil" cx=${vb / 2 - eyeDX} cy=${eyeY} r=${pupilR} />
          <circle class="bot-pupil" cx=${vb / 2 + eyeDX} cy=${eyeY} r=${pupilR} />
        </g>
        <path class="bot-mouth bot-mouth-idle" d=${`M ${vb / 2 - size * 0.12} ${mouthY} Q ${vb / 2} ${mouthY + size * 0.08} ${vb / 2 + size * 0.12} ${mouthY}`} stroke-linecap="round" />
        <ellipse class="bot-mouth bot-mouth-work" cx=${vb / 2} cy=${mouthY + size * 0.02} rx=${size * 0.07} ry=${size * 0.045} />
      </svg>
    </div>
  </div>`;
}

/** AnyModelBot 自己的标志：一个 m 字形的折线 */
export function AppMark({ size = 32 }) {
  return html`<div class="app-mark" style=${{ width: size + "px", height: size + "px" }} aria-hidden="true">
    <svg viewBox="0 0 18 18" fill="none"><path d="M4 12.5V5.5L9 10l5-4.5v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </div>`;
}
