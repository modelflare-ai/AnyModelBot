import type { Channel } from "./channels";
export default [
  {
    id: "slack", icon: "hash", title: "Slack", body: "在電腦或手機上用 Slack 私訊機器人，也可以傳送圖片和檔案。", format: "聊天管道（Socket Mode）",
    guide: {
      title: "連接 Slack",
      steps: [
        "在 api.slack.com/apps 建立應用程式，開啟 Socket Mode，並產生具備 connections:write 權限的應用程式層級權杖（xapp-…）。",
        "加入 chat:write、im:history、files:read 和 files:write 權限，訂閱 message.im 事件，並在 App Home 啟用訊息功能。將應用程式安裝到工作區，再複製機器人權杖（xoxb-…）。",
        "開啟「設定 → 聊天管道 → Slack → 新增帳號」，貼上兩個權杖並儲存，接著就能在 Slack 私訊機器人。",
      ],
      limit: "目前僅支援私訊。請保持 AnyModelBot 開啟，關閉期間收不到訊息。",
    },
  },
  {
    id: "telegram", icon: "send", title: "Telegram", body: "透過 @BotFather 建立機器人，隨時傳送訊息、圖片或檔案。", format: "聊天管道（機器人權杖）",
    guide: {
      title: "連接 Telegram",
      steps: [
        "在 Telegram 私訊 @BotFather，傳送 /newbot，依指示建立機器人並複製權杖。",
        "開啟「設定 → 聊天管道 → Telegram → 新增帳號」，貼上權杖並儲存。",
        "在 Telegram 開啟剛建立的機器人並傳送訊息。連線採用長輪詢，電腦無須配置公開 IP 位址。",
      ],
      limit: "目前僅支援私訊。AnyModelBot 重新開啟後可補收過去 24 小時內的訊息。",
    },
  },
  {
    id: "discord", icon: "headset", title: "Discord", body: "把機器人加入伺服器後，即可從電腦或手機版 Discord 傳送私訊。", format: "聊天管道（機器人權杖）",
    guide: {
      title: "連接 Discord",
      steps: [
        "在 Discord Developer Portal 建立應用程式，新增機器人並複製權杖。",
        "在 OAuth2 → URL Generator 勾選 bot，開啟產生的連結，將機器人加入你的伺服器。",
        "開啟「設定 → 聊天管道 → Discord → 新增帳號」，貼上權杖並儲存，再私訊機器人。",
      ],
      limit: "目前僅支援私訊。請保持 AnyModelBot 開啟，關閉期間收不到訊息。",
    },
  },
] satisfies Channel[];
