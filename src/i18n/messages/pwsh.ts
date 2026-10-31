// pwsh：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  // 装在哪儿
  sourceProgramFiles: "安装目录",
  sourcePath: "PATH",
  sourcePreview: "预览版",
  sourceStore: "Microsoft Store",
  // 聊天里 /status 的一行
  statusChecking: "PowerShell：检测中",
  statusOk: "PowerShell：{version}（代理用它执行命令）",
  statusOld: "PowerShell {version} 版本较旧",
  statusNone: "没有安装 PowerShell 7，代理执行命令用的是系统自带的 Windows PowerShell 5.1，每条可能要二三十秒",
  statusAdvice: "PowerShell：{now}。装上 PowerShell 7，命令执行快得多，也更稳定：{winget}（或打开 {url}）",
  // 诊断报告里的一行
  reportChecking: "[PowerShell] 检测中",
  reportWhere: " · {path}（{source}）",
  reportUnknownVersion: "7（版本未知）",
  reportOk: "[PowerShell] {version}{where} · 代理用它执行命令",
  reportOld: "[PowerShell] {version} 版本较旧{where} · 建议安装 PowerShell 7",
  reportNone: "[PowerShell] 未安装 PowerShell 7：代理用 Windows PowerShell 5.1 执行命令（经沙箱每条约 25 秒，7 约 1 秒）{forced}",
  reportForced: " · AMB_PWSH_FORCE 模拟",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  sourceProgramFiles: "install folder",
  sourcePath: "PATH",
  sourcePreview: "preview",
  sourceStore: "Microsoft Store",
  statusChecking: "PowerShell: checking",
  statusOk: "PowerShell: {version} (the agent runs commands with it)",
  statusOld: "PowerShell {version} is outdated",
  statusNone: "PowerShell 7 isn't installed, so the agent runs commands with the built-in Windows PowerShell 5.1, which can take 20–30 seconds each",
  statusAdvice: "PowerShell: {now}. Install PowerShell 7 for much faster, more reliable commands: {winget} (or open {url})",
  reportChecking: "[PowerShell] checking",
  reportWhere: " · {path} ({source})",
  reportUnknownVersion: "7 (version unknown)",
  reportOk: "[PowerShell] {version}{where} · the agent runs commands with it",
  reportOld: "[PowerShell] {version} is outdated{where} · installing PowerShell 7 is recommended",
  reportNone: "[PowerShell] PowerShell 7 not installed: the agent runs commands with Windows PowerShell 5.1 (about 25 s per command in the sandbox vs. about 1 s with 7){forced}",
  reportForced: " · simulated by AMB_PWSH_FORCE",
};
