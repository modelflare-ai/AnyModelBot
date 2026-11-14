// desktop：Electron 外壳（electron/main.ts）的托盘菜单与对话框。zh 与 en 的键必须一一对应（en 的类型由 zh 推出）。
import type { Catalog } from "../types.js";

export const zh = {
  instanceLockUnavailable: "这次启动未获得单实例锁。已有实例可能仍在运行，也可能是锁创建失败。请查看启动日志中的锁结果和实际数据目录。",

  updateReady: "{version} 已下载，准备好后可重启并更新。",
  updateInstallFailed: "更新安装未完成，应用将重新启动。请稍后重试。",
  trayOpen: "打开 {product}",
  trayOpenInBrowser: "在浏览器中打开",
  trayAutostart: "开机自启",
  trayOpenDataDir: "打开数据目录",
  trayQuit: "退出",
  errorTitle: "{product} 出错了",
  errorDetail: "{message}\n\n详细信息见日志：{log}",
  logDisabled: "（未启用）",
  bootFailed: "{product} 启动失败",
  uiNotStarted: "管理界面未启动",
  trayNeeds: "需要你（{count}）",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  instanceLockUnavailable: "This launch did not acquire the single-instance lock. Another instance may be running, or lock creation may have failed. Check the startup log for the lock result and actual data directory.",

  updateReady: "Version {version} has downloaded. Restart and update when you're ready.",
  updateInstallFailed: "The update installation did not finish. The app will restart. Please try again later.",
  trayOpen: "Open {product}",
  trayOpenInBrowser: "Open in browser",
  trayAutostart: "Launch at login",
  trayOpenDataDir: "Open data folder",
  trayQuit: "Quit",
  errorTitle: "{product} ran into a problem",
  errorDetail: "{message}\n\nSee the log for details: {log}",
  logDisabled: "(disabled)",
  bootFailed: "{product} couldn't start",
  uiNotStarted: "The local interface didn't start",
  trayNeeds: "Needs you ({count})",
};
