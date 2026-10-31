// 动效的 JS 一侧：读取 CSS 时长 token、尊重"减少 / 关闭动画"、让退场动画播完再卸载。
// 时长只在 tokens/motion.css 里定义一次，JS 用 ms("--dur-base") 读，不要再写死毫秒数。
import { useEffect, useState } from "preact/hooks";

const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

/** 减少或关闭了动画：<html data-motion>（lib/prefs.js 解析设置 › 外观 › 动画）不是 full；没有这个属性时看系统 */
export const reducedMotion = () => {
  const m = document.documentElement.dataset.motion;
  return m ? m !== "full" : mq.matches;
};

/** "--dur-base" → 180；token 不存在或不是时长时返回 fallback */
export function ms(token, fallback = 0) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : fallback;
}

/**
 * 进出场：open 变 false 后再保留挂载 exit 时长，期间 leaving = true（给元素加 .leaving 或 .anim-*-out）。
 *   const { mounted, leaving } = usePresence(open);
 *   if (!mounted) return null;
 */
export function usePresence(open, exit = "--dur-base") {
  const [state, setState] = useState(open ? "open" : "closed");
  useEffect(() => {
    if (open) return setState("open");
    if (state === "closed") return;
    setState("leaving");
    const t = setTimeout(() => setState("closed"), ms(exit, 180));
    return () => clearTimeout(t);
  }, [open]);
  return { mounted: open || state !== "closed", leaving: !open && state !== "closed" };
}
