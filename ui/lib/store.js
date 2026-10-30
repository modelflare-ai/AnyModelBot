// 极小的全局状态：toast、确认框、主题。组件用 useStore 订阅。
import { useEffect, useState } from "preact/hooks";
import { ms } from "../design/motion.js";

export function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(next) {
      value = typeof next === "function" ? next(value) : next;
      for (const fn of subs) fn(value);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore(store) {
  const [v, setV] = useState(store.get());
  useEffect(() => store.subscribe(setV), [store]);
  return v;
}

// —— toasts ——
export const toasts = createStore([]);
let toastSeq = 0;
/** 成功提示 1.6 秒后淡出；错误提示一直留着，直到点掉 */
export function toast(text, kind = "ok") {
  const id = ++toastSeq;
  toasts.set((l) => [...l.filter((t) => !(t.kind === kind && t.text === text)), { id, text, kind }]);
  if (kind !== "err") setTimeout(() => dismissToast(id), 1600);
  return id;
}
export function dismissToast(id) {
  toasts.set((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  setTimeout(() => toasts.set((l) => l.filter((t) => t.id !== id)), ms("--dur-base", 180));
}
export const saved = () => toast("已保存");
export const failed = (e) => toast(typeof e === "string" ? e : e?.message || "出错了", "err");

// —— confirm sheet ——
export const dialog = createStore(null);
/** confirm({ title, body, confirmLabel, danger }) → Promise<boolean> */
export function confirmSheet(opts) {
  return new Promise((resolve) => dialog.set({ ...opts, resolve }));
}
