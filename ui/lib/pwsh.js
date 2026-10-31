// Windows：代理用哪个 PowerShell（系统里的 7 → 应用内置的 7 → 5.1）。状态放在一个全局 store 里，对话空状态、设置 → 常规、
// 故障排查共用，按钮的结果立即同步到每一处。安装在后台进行：装的时候每 1.5 秒刷新进度，平时每分钟看一次（自动安装、自动退回都在后台发生）。
import { useEffect } from "preact/hooks";
import { api } from "./api.js";
import { createStore, toast, useStore } from "./store.js";
import { t } from "./i18n.js";

export const PWSH_INSTALL_URL = "https://aka.ms/PSWindows";
export const PWSH_WINGET = "winget install --id Microsoft.PowerShell --source winget";

export const pwshState = createStore(null);
let loading = null;
let timer = null;
let users = 0;

const BUSY = ["waiting", "downloading", "extracting", "verifying", "testing"];
/** 内置副本正在安装 */
export const pwshInstalling = (s) => !!s?.private && BUSY.includes(s.private.install?.state);

const mb = (n) => (n === undefined || n === null ? "?" : Math.round(n / 1048576));
/** 安装进度的一句话（按当前语言） */
export function pwshProgress(p) {
  if (!p) return "";
  if (p.state === "downloading")
    return t("pwsh.progress.downloading", { received: mb(p.received), total: mb(p.total), pct: p.total ? t("pwsh.progress.pct", { n: Math.min(100, Math.floor(((p.received || 0) / p.total) * 100)) }) : "" });
  if (p.state === "waiting") return p.error || t("pwsh.progress.waiting");
  if (p.state === "failed") return t("pwsh.progress.failed", { error: p.error || t("pwsh.unknownReason") });
  return ["extracting", "verifying", "testing", "done"].includes(p.state) ? t(`pwsh.progress.${p.state}`) : "";
}

function schedule(s) {
  clearTimeout(timer);
  timer = null;
  if (!users || !s?.applicable) return;
  timer = setTimeout(loadPwsh, s.checking || pwshInstalling(s) ? 1500 : 60_000);
}
function set(s) {
  pwshState.set(s);
  schedule(s);
  return s;
}

export function loadPwsh() {
  loading ??= api("/pwsh")
    .then(set)
    .catch(() => {})
    .finally(() => (loading = null));
  return loading;
}

/** 重新检测：重新找、重新试运行（装好系统的 PowerShell 7 后点它；代理空闲时换用） */
export async function recheckPwsh() {
  const s = set(await api("/pwsh/recheck", { method: "POST", body: {} }));
  if (!s.missing) toast(t("pwsh.found", { version: s.version || "7", private: s.source === "private" ? t("pwsh.privateSuffix") : "" }), "ok");
  else toast(t(pwshInstalling(s) ? "pwsh.notFoundInstalling" : "pwsh.notFound"), "warn");
  return s;
}

/** 安装 / 重新安装应用内置的 PowerShell 7（后台进行，进度在提示和故障排查里） */
export async function installPwsh(reinstall = false) {
  const s = set(await api("/pwsh/install", { method: "POST", body: { reinstall } }));
  if (pwshInstalling(s)) toast(t(reinstall ? "pwsh.reinstalling" : "pwsh.installing"));
  else if (!s.missing) toast(t("pwsh.using", { version: s.version || "7" }), "ok");
  return s;
}

/** 改回系统默认（system）/ 重新用应用内置的（auto） */
export async function setPwshMode(mode) {
  const s = set(await api("/pwsh/mode", { method: "PUT", body: { mode } }));
  toast(t(mode === "system" ? "pwsh.modeSystem" : "pwsh.modePrivate"), "ok");
  return s;
}

/** 不再提示：记在 config.json（ui.pwshHintDismissed）；故障排查里的状态行照常显示 */
export async function dismissPwsh() {
  set(await api("/pwsh", { method: "PUT", body: { dismissed: true } }));
}

// "知道了"：装好、自动退回这类一次性的结果，看过就不再显示（记在本机浏览器里）
const SEEN = "amb.pwsh.seen";
function seenList() {
  try {
    return JSON.parse(localStorage.getItem(SEEN) || "[]");
  } catch {
    return [];
  }
}
const ackedNow = new Set();
export function ackPwsh(key) {
  ackedNow.add(key);
  try {
    localStorage.setItem(SEEN, JSON.stringify([...seenList(), key].slice(-20)));
  } catch {
    /* 存不了就只在这次运行里隐藏 */
  }
  const s = pwshState.get();
  if (s) pwshState.set({ ...s });
}
const acked = (key) => ackedNow.has(key) || seenList().includes(key);

export function usePwsh() {
  const s = useStore(pwshState);
  useEffect(() => {
    users++;
    if (!pwshState.get()) loadPwsh();
    else schedule(pwshState.get());
    return () => {
      users--;
      if (!users) clearTimeout(timer);
    };
  }, []);
  return s;
}

/**
 * 提示显示哪一种（null = 不显示）：
 * installing 正在安装；installed 刚装好；fallback 用的 PowerShell 起不来、已自动换掉（还有能用的 7）；
 * broken 内置的坏了、退回了 5.1；failed 没装上；unsupported 这台电脑装不了；missing 没有 PowerShell 7。
 * 后四种点过"不再提示"就不显示（故障排查里照常有）。
 */
export function pwshHint(s) {
  if (!s || !s.applicable || s.checking) return null;
  const p = s.private;
  const inst = p?.install;
  if (pwshInstalling(s)) return "installing";
  if (!s.missing) {
    if (s.fallback && !acked(`fb:${s.fallback.at}`)) return "fallback";
    if (s.source === "private" && inst?.state === "done" && inst.finishedAt && !acked(`ok:${inst.finishedAt}`)) return "installed";
    return null;
  }
  if (s.dismissed) return null;
  if (s.mode !== "system" && p?.bad) return "broken";
  if (s.mode !== "system" && inst?.state === "failed") return "failed";
  if (p && !p.supported && p.reason) return "unsupported";
  return "missing";
}
export const showPwshHint = (s) => !!pwshHint(s);
