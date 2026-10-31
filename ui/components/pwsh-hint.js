// "建议安装 PowerShell 7"：一条安静的 .notice（淡底 + 图标 + 字，不描边），多一行等宽的安装命令和一排操作。
// 放在对话空状态和设置 → 常规的顶部；只在 Windows 上、没有 PowerShell 7、没点过"不再提示"时出现。
import { useState } from "preact/hooks";
import { html, Icon, CopyButton } from "./ui.js";
import { PWSH_INSTALL_URL, PWSH_WINGET, dismissPwsh, recheckPwsh, showPwshHint, usePwsh } from "../lib/pwsh.js";
import { failed } from "../lib/store.js";
import { t } from "../lib/i18n.js";

export function PwshHint() {
  const s = usePwsh();
  const [busy, setBusy] = useState(false);
  if (!showPwshHint(s)) return null;
  const recheck = async () => {
    setBusy(true);
    try {
      await recheckPwsh();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="notice pwsh-hint" role="note" aria-label=${t("pwsh.title")}>
    <${Icon} name="info" size="sm" />
    <div class="pwsh-body">
      <p><b>${t("pwsh.title")}</b>${t("pwsh.body")}</p>
      <div class="pwsh-cmd"><span class="t-meta">${t("pwsh.orRun")}</span><code>${PWSH_WINGET}</code><${CopyButton} text=${PWSH_WINGET} label=${t("pwsh.copyCommand")} /></div>
      <div class="pwsh-actions">
        <a class="btn" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">${t("pwsh.install")}</a>
        <button type="button" class="text" disabled=${busy} aria-busy=${busy || undefined} onClick=${recheck}>${busy ? t("pwsh.checking") : t("pwsh.recheck")}</button>
        <button type="button" class="text" onClick=${() => dismissPwsh().catch(failed)}>${t("pwsh.dismiss")}</button>
      </div>
    </div>
  </div>`;
}
