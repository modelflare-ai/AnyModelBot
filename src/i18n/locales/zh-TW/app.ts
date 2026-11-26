import type { TranslatedCatalog } from "../../index.js";

export default {
  external_mode: "外部模型端點模式下不管理 Modelflare 連線",
  bot_not_found: "機器人不存在",
  magpie_failed: "magpie 啟動失敗：{message}",
  // 第一次啟動時建的機器人（按當時的語言）
  default_bot_name: "我的助手",
  default_bot_prompt: "你是一個樂於助人的中文助手，回答簡潔準確。",
  feishu_failed: "飛書帳號「{name}」持續連線啟動失敗：{message}",
  messenger_failed: "{channel} 帳號「{name}」連不上，請在 設定 › 聊天管道 裡檢查認證資料：{message}",
  feishu_history_denied: "飛書帳號「{name}」讀不到飛書的歷史訊息，離線時發來的訊息補不上。在飛書開放平台給應用程式開通 im:message.history:readonly 權限即可。",
  weixin_expired: "微信帳號「{name}」登入已過期，請在 設定 › 聊天管道 裡重新掃碼",
  weixin_connected: "微信帳號「{name}」已連線",
  weixin_account_name: "微信",
  feishu_account_name: "飛書",
  // 收到的訊息裡圖片 / 檔案 / 語音的佔位（core/types.ts eventText）
  media_image: "圖片",
  media_file: "檔案",
  media_video: "影片",
  media_quoted_image: "引用的圖片",
  media_quoted_file: "引用的檔案",
  media_quoted_video: "引用的影片",
  media_voice: "[語音]",
  media_not_downloaded: "{label}（未能下載：{error}）",
  weixinExpiredSubject: "微信登入已過期",
  // 資料目錄鎖（store/lock.ts）：同一個資料目錄只能有一個宿主
  data_dir_locked: "資料目錄 {dir} 正被另一個 anymodel bot 程序使用（{who}）。先結束它，或者換一個資料目錄（AMB_DATA_DIR）。",
  data_dir_locked_remote: "{host} 上的 pid {pid}",
} satisfies TranslatedCatalog["app"];
