import type { TranslatedCatalog } from "../../index.js";

export default {
  instanceLockUnavailable: "應用程式無法取得啟動鎖定。可能已有另一個執行個體正在執行，或是無法建立鎖定。請查看啟動記錄中的鎖定狀態與資料目錄。",

  updateReady: "{version} 已下載，準備好後可重新啟動並更新。",
  updateInstallFailed: "更新安裝未完成，應用程式將重新啟動。請稍後重試。",
  trayOpen: "開啟 {product}",
  trayOpenInBrowser: "在瀏覽器中開啟",
  trayAutostart: "開機時自動啟動",
  trayOpenDataDir: "開啟資料目錄",
  trayQuit: "結束",
  errorTitle: "{product} 出錯了",
  errorDetail: "{message}\n\n詳細資訊見記錄：{log}",
  logDisabled: "（未啟用）",
  bootFailed: "{product} 啟動失敗",
  uiNotStarted: "管理介面未啟動",
  trayNeeds: "需要你（{count}）",
} satisfies TranslatedCatalog["desktop"];
