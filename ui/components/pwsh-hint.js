// "建议安装 PowerShell 7"：一条安静的 .notice（淡底 + 图标 + 字，不描边），多一行等宽的安装命令和一排操作。
// 放在对话空状态和设置 → 常规的顶部；只在 Windows 上、没有 PowerShell 7、没点过"不再提示"时出现。
import { useState } from "preact/hooks";
import { html, Icon, CopyButton } from "./ui.js";
import { PWSH_INSTALL_URL, PWSH_WINGET, dismissPwsh, recheckPwsh, showPwshHint, usePwsh } from "../lib/pwsh.js";
import { failed } from "../lib/store.js";

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
  return html`<div class="notice pwsh-hint" role="note" aria-label="建议安装 PowerShell 7">
    <${Icon} name="info" size=${14} />
    <div class="pwsh-body">
      <p><b>建议安装 PowerShell 7</b>机器人执行命令现在用的是系统自带的 Windows PowerShell 5.1，每条可能要等二三十秒。装上 PowerShell 7，命令执行快得多，也更稳定。</p>
      <div class="pwsh-cmd"><span class="t-meta">或在终端运行</span><code>${PWSH_WINGET}</code><${CopyButton} text=${PWSH_WINGET} label="复制安装命令" /></div>
      <div class="pwsh-actions">
        <a class="btn" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">安装 PowerShell 7 ↗</a>
        <button type="button" class="text" disabled=${busy} aria-busy=${busy || undefined} onClick=${recheck}>${busy ? "检测中…" : "重新检测"}</button>
        <button type="button" class="text" onClick=${() => dismissPwsh().catch(failed)}>不再提示</button>
      </div>
    </div>
  </div>`;
}
