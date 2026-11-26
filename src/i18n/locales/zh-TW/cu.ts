import type { TranslatedCatalog } from "../../index.js";

export default {
  waiting: "等待開啟權限",
  channelWait: "電腦操作需要先在這台電腦上開啟「{items}」權限。請在桌面版按提示開啟，開啟後我會接著做。",

  // Codex Computer Use 橋（tools/computer-use/index.ts）
  codexUnavailable: "Codex Computer Use 橋: 需要 macOS 14.4+ 和已安裝的 Codex Computer Use",
  codexOff: "{base}（{why}）",
  codexNotMac: "目前系統不是 macOS",
  codexOldMac: "macOS 版本低於 14.4",
  codexNoBridge: "安裝套件缺少 kimi-computer-use 元件",
  codexNoClient: "未找到 Codex Computer Use 用戶端",
  codexNoLauncher: "未找到 ChatGPT/Codex 應用程式內附的 codex 啟動器",
  codexAvailable: "Codex Computer Use 橋: 可用（macOS）",
  codexFallback: "（Codex 橋不可用，已改用 Cua Driver：{reason}）",
  // Cua Driver（tools/computer-use/cua-driver.ts）
  cuaOff: "Cua Driver: 不可用（{why}）",
  cuaAvailable: "Cua Driver: 可用（{os}）",
  cuaUnsupported: "不支援 {platform}",
  cuaMissing: "安裝套件缺少 {plat} 的 cua-driver {version}",
  cuaNoDisplay: "沒有圖形對話：DISPLAY / WAYLAND_DISPLAY 均未設定",
  cuaAtspi: "需要 AT-SPI（at-spi2-core）才能讀取視窗元素",
  cuaWayland: "Wayland 對話：功能降級——視窗讀取依賴 AT-SPI，鍵鼠輸入走 XWayland，只能操作前景視窗；{atspi}",
  cuaX11: "X11 對話；{atspi}",
  cuaMacNotice: "首次使用需在「系統設定 → 隱私與安全性」給本應用程式開啟「輔助功能」和「螢幕錄製」。以 --direct 模式執行，授權應歸屬本應用程式（尚未在真機驗證）。",
  cuaWinNotice: "需在已登入使用者的互動式桌面對話中執行；無法操作以管理員權限執行的視窗（除非本應用程式也以管理員執行）。",
  cuaNonInteractive: "需要在已登入使用者的互動式對話中執行（偵測到服務或非互動對話）",
} satisfies TranslatedCatalog["cu"];
