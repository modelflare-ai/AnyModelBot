// 外观：跟随系统 / 浅色 / 深色。<html data-theme> 总是解析后的值，CSS 只需定义一份深色变量。
import { createStore } from "./store.js";

const KEY = "amb-theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");

function readMode() {
  try {
    const m = localStorage.getItem(KEY);
    return m === "light" || m === "dark" ? m : "system";
  } catch {
    return "system";
  }
}

export const themeMode = createStore(readMode());

function apply(mode) {
  const resolved = mode === "system" ? (mq.matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function setThemeMode(mode) {
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* 隐私模式等：只在本次生效 */
  }
  themeMode.set(mode);
  apply(mode);
}

mq.addEventListener?.("change", () => apply(themeMode.get()));
apply(themeMode.get());
