// 系统通知（设置 › 常规 › 回复完成时通知）：窗口不在前台时，机器人回复完或等你确认，弹一条系统通知。
// 桌面版走 Electron 的 HTML5 通知（默认已授权）；浏览器里第一次打开开关时向用户申请权限。
import { prefs } from "./prefs.js";
import { t } from "./i18n.js";

export const canNotify = typeof window !== "undefined" && "Notification" in window;

/** 打开开关前申请权限；返回是否可以发通知 */
export async function requestNotify() {
  if (!canNotify) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Markdown 回复 → 一行摘要 */
export function plainSnippet(text, max = 120) {
  const s = String(text || "")
    .replace(/```[\s\S]*?```/g, () => ` ${t("notify.code")} `)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, () => ` ${t("notify.image")} `)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** 偏好打开、已授权、窗口不在前台时才发；tag 相同的通知会互相替换 */
export function notify(title, body, tag) {
  if (!canNotify || !prefs.get().notify || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* 有的环境（比如 Android Chrome）不允许页面直接 new Notification */
  }
}
