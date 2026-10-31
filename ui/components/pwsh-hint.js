// 代理的 PowerShell：一条安静的 .notice（淡底 + 图标 + 字，不描边），放在对话空状态和设置 → 常规的顶部，只在 Windows 上出现。
// 正在为代理安装 PowerShell 7（带进度）→ 装好了 / 没装上；用的 PowerShell 起不来、已自动换掉；这台电脑装不了；没有 PowerShell 7。
import { useState } from "preact/hooks";
import { html, Icon, CopyButton, Spinner } from "./ui.js";
import { PWSH_INSTALL_URL, PWSH_WINGET, ackPwsh, dismissPwsh, installPwsh, pwshHint, pwshProgress, recheckPwsh, usePwsh } from "../lib/pwsh.js";
import { failed } from "../lib/store.js";

const SLOW = "机器人执行命令现在用的是系统自带的 Windows PowerShell 5.1，每条可能要等二三十秒";

export function PwshHint() {
  const s = usePwsh();
  const [busy, setBusy] = useState("");
  const kind = pwshHint(s);
  if (!kind) return null;
  const run = (what, fn) => async () => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      failed(e);
    } finally {
      setBusy("");
    }
  };
  const p = s.private || {};
  const inst = p.install || {};
  const btn = (what, label, fn, cls = "text", busyLabel = `${label}…`) =>
    html`<button type="button" class=${cls} disabled=${!!busy} aria-busy=${busy === what || undefined} onClick=${run(what, fn)}>${busy === what ? busyLabel : label}</button>`;
  const dismiss = btn("dismiss", "不再提示", dismissPwsh);
  const box = (icon, title, body, actions, tone = "") => html`<div class=${`notice pwsh-hint${tone ? ` ${tone}` : ""}`} role=${kind === "installing" ? "status" : "note"} aria-label=${title}>
    ${icon === "spinner" ? html`<${Spinner} />` : html`<${Icon} name=${icon} size=${14} />`}
    <div class="pwsh-body">
      <p><b>${title}</b>${body}</p>
      ${actions && html`<div class="pwsh-actions">${actions}</div>`}
    </div>
  </div>`;

  if (kind === "installing")
    return box("spinner", "正在为代理安装 PowerShell 7…", `${pwshProgress(inst)}。装好后机器人执行命令快得多（大约 1 秒一条）；不需要管理员权限，也不影响你自己的 PowerShell。装好之前命令照常用 Windows PowerShell 5.1。`);
  if (kind === "installed")
    return box("check", "PowerShell 7 已就绪", `机器人之后执行命令用应用内置的 PowerShell ${s.version || p.version}（已核对微软签名并试运行通过），大约 1 秒一条。`, html`<button type="button" class="text" onClick=${() => ackPwsh(`ok:${inst.finishedAt}`)}>知道了</button>`);
  if (kind === "fallback")
    return box(
      "alert",
      "PowerShell 出了问题，已自动换掉",
      `${s.fallback.from} 起不来（${s.fallback.reason}）。机器人改用 ${s.source === "private" ? "应用内置的" : ""}PowerShell ${s.version || "7"} 执行命令。`,
      html`<button type="button" class="text" onClick=${() => ackPwsh(`fb:${s.fallback.at}`)}>知道了</button>`,
      "amber",
    );
  if (kind === "broken")
    return box("alert", "应用内置的 PowerShell 7 用不了", `${p.bad.reason}。${SLOW}。重新安装一般就能恢复。`, html`${btn("install", "重新安装", () => installPwsh(true), "btn")}${dismiss}`, "amber");
  if (kind === "failed")
    return box(
      "alert",
      "PowerShell 7 没装上",
      `${inst.error || "未知原因"}。${SLOW}。`,
      html`${btn("install", "重试", () => installPwsh(false), "btn")}<a class="text" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">自己安装 ↗</a>${dismiss}`,
      "amber",
    );
  if (kind === "unsupported") return box("info", "这台电脑装不了 PowerShell 7", `${p.reason}。${SLOW}。`, dismiss);
  // missing：改回了系统默认、关了自动安装，或者还没开始装
  return html`<div class="notice pwsh-hint" role="note" aria-label="建议安装 PowerShell 7">
    <${Icon} name="info" size=${14} />
    <div class="pwsh-body">
      <p><b>建议安装 PowerShell 7</b>${SLOW}。装上 PowerShell 7，命令执行快得多，也更稳定。${p.supported ? "应用可以自己装一份，不需要管理员权限，也不影响你自己的 PowerShell。" : ""}</p>
      <div class="pwsh-cmd"><span class="t-meta">或在终端运行</span><code>${PWSH_WINGET}</code><${CopyButton} text=${PWSH_WINGET} label="复制安装命令" /></div>
      <div class="pwsh-actions">
        ${p.supported ? btn("install", "一键安装", () => installPwsh(false), "btn") : html`<a class="btn" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">安装 PowerShell 7 ↗</a>`}
        ${p.supported && html`<a class="text" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">自己安装 ↗</a>`}
        ${btn("recheck", "重新检测", recheckPwsh, "text", "检测中…")}
        ${dismiss}
      </div>
    </div>
  </div>`;
}
