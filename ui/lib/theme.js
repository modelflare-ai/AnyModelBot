// 外观：跟随系统 / 浅色 / 深色。<html data-theme> 总是解析后的值，CSS 只需定义一份深色变量。
import { api } from "./api.js";
import { createStore } from "./store.js";

const KEY = "amb-theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");
// Windows 桌面版：右上角的最小化 / 最大化 / 关闭是系统画在界面上的，符号颜色要跟着主题换（electron/main.ts 的 titleBarOverlay）
const winApp = document.documentElement.classList.contains("win-app");
let sentDark;
function syncTitleBar(dark) {
  if (!winApp || dark === sentDark) return;
  sentDark = dark;
  api("/desktop/title-bar", { method: "POST", body: { dark } }).catch(() => {
    sentDark = undefined; // 下次切主题再试
  });
}

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
  syncTitleBar(resolved === "dark");
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
