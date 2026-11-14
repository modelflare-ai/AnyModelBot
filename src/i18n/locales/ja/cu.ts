import type { TranslatedCatalog } from "../../index.js";
export default {
  waiting: "権限の有効化を待っています",
  channelWait: "パソコン操作には、このパソコンで {items} 権限を有効にする必要があります。デスクトップアプリの案内に従って有効にすると続行します。",

  "codexUnavailable": "Codex Computer Use ブリッジ：macOS 14.4 以降と Codex Computer Use のインストールが必要です",
  "codexOff": "{base}（{why}）",
  "codexNotMac": "このシステムは macOS ではありません",
  "codexOldMac": "macOS が 14.4 より古いバージョンです",
  "codexNoBridge": "kimi-computer-use コンポーネントがインストールされていません",
  "codexNoClient": "Codex Computer Use クライアントが見つかりません",
  "codexNoLauncher": "ChatGPT/Codex アプリに同梱の codex ランチャーが見つかりません",
  "codexAvailable": "Codex Computer Use ブリッジ：利用可能（macOS）",
  "codexFallback": "（Codex ブリッジを利用できないため、Cua Driver を使用します：{reason}）",
  "cuaOff": "Cua Driver：利用不可（{why}）",
  "cuaAvailable": "Cua Driver：利用可能（{os}）",
  "cuaUnsupported": "{platform} には対応していません",
  "cuaMissing": "{plat} 用の cua-driver {version} がインストールされていません",
  "cuaNoDisplay": "グラフィカルセッションがありません。DISPLAY と WAYLAND_DISPLAY が両方とも未設定です",
  "cuaAtspi": "ウィンドウ要素の読み取りには AT-SPI（at-spi2-core）が必要です",
  "cuaWayland": "Wayland セッションでは機能が制限されます。ウィンドウの読み取りには AT-SPI を使い、キーボードとマウス入力は XWayland 経由で行います。操作できるのは前面のウィンドウだけです。{atspi}",
  "cuaX11": "X11 セッション。{atspi}",
  "cuaMacNotice": "初回使用時に「システム設定 → プライバシーとセキュリティ」で、このアプリにアクセシビリティと画面収録を許可してください。--direct モードで動作するため、このアプリへの許可が必要になる想定です（Mac 実機では未検証）。",
  "cuaWinNotice": "ログイン済みユーザーの対話型デスクトップセッションで実行する必要があります。管理者権限で動くウィンドウは、このアプリも管理者権限で実行しない限り操作できません。",
  "cuaNonInteractive": "ログイン済みユーザーの対話型セッションで実行する必要があります。サービスまたは非対話型セッションが検出されました"
} satisfies TranslatedCatalog["cu"];
