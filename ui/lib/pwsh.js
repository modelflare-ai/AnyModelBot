// Windows：没有 PowerShell 7 时建议安装。检测结果放在一个全局 store 里，对话空状态、设置 → 常规、故障排查共用，
// "重新检测""不再提示"立即同步到每一处。检测在后端（只看文件、不拉起进程），这里只读接口。
import { useEffect } from "preact/hooks";
import { api } from "./api.js";
import { createStore, toast, useStore } from "./store.js";
import { t } from "./i18n.js";

export const PWSH_INSTALL_URL = "https://aka.ms/PSWindows";
export const PWSH_WINGET = "winget install --id Microsoft.PowerShell --source winget";

export const pwshState = createStore(null);
let loading = null;

export function loadPwsh() {
  loading ??= api("/pwsh")
    .then((s) => pwshState.set(s))
    .catch(() => {})
    .finally(() => (loading = null));
  return loading;
}

/** 重新检测：装好后点它，下一条消息起代理就用 PowerShell 7 */
export async function recheckPwsh() {
  const s = await api("/pwsh/recheck", { method: "POST", body: {} });
  pwshState.set(s);
  toast(s.missing ? t("pwsh.notFound") : t("pwsh.found", { version: s.version || "7" }), s.missing ? "warn" : "ok");
  return s;
}

/** 不再提示：记在 config.json（ui.pwshHintDismissed）；故障排查里的状态行照常显示 */
export async function dismissPwsh() {
  pwshState.set(await api("/pwsh", { method: "PUT", body: { dismissed: true } }));
}

export function usePwsh() {
  const s = useStore(pwshState);
  useEffect(() => {
    if (!pwshState.get()) loadPwsh();
  }, []);
  return s;
}

/** 要不要显示提示：Windows（或模拟）、没有 PowerShell 7、没点过"不再提示" */
export const showPwshHint = (s) => !!(s && s.applicable && s.missing && !s.dismissed);
