// desktop：Electron 外壳（electron/main.ts）的托盘菜单与对话框。zh 与 en 的键必须一一对应（en 的类型由 zh 推出）。
import type { Catalog } from "../types.js";

export const zh = {
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
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
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
};
