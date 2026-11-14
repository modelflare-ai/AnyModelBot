import type { TranslatedCatalog } from "../../index.js";
export default {
  instanceLockUnavailable: "今回の起動では単一インスタンスのロックを取得できませんでした。別のインスタンスが実行中か、ロックの作成に失敗した可能性があります。起動ログで結果と実際のデータフォルダーを確認してください。",

  "updateReady": "バージョン {version} のダウンロードが完了しました。準備ができたら再起動して更新してください。",
  "updateInstallFailed": "更新のインストールが完了しませんでした。アプリを再起動します。しばらくしてから再試行してください。",
  "trayOpen": "{product} を開く",
  "trayOpenInBrowser": "ブラウザーで開く",
  "trayAutostart": "ログイン時に起動",
  "trayOpenDataDir": "データフォルダーを開く",
  "trayQuit": "終了",
  "errorTitle": "{product} で問題が発生しました",
  "errorDetail": "{message}\n\n詳しくはログを確認してください：{log}",
  "logDisabled": "（無効）",
  "bootFailed": "{product} を起動できませんでした",
  "uiNotStarted": "ローカル画面を起動できませんでした",
  "trayNeeds": "あなたの対応待ち（{count}）"
} satisfies TranslatedCatalog["desktop"];
