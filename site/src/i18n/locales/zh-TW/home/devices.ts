export default {
  "h2": "在哪都找得到它。",
  "h2dim": "同一個機器人，同一份記憶。",
  "lead": "在電腦上使用桌面版、Docker 或瀏覽器，也能用手機上的 Slack、Telegram 或 Discord 接著聊。",
  "items": {
    "desktop": {
      "title": "桌面",
      "sub": "Windows · macOS · Linux",
      "body": "Windows、macOS、Linux，下載即用。",
      "more": "全部下載與驗證 →"
    },
    "docker": {
      "title": "Docker",
      "sub": "NAS / 伺服器",
      "body": "放在 NAS 或伺服器上，24 小時線上。"
    },
    "browser": {
      "title": "瀏覽器",
      "body": "桌面版或 Docker 內附本機網頁控制台。",
      "format": "本機 / 自行架設"
    }
  },
  "pick": "選擇入口",
  "groupChat": "通訊軟體",
  "thread": {
    "user": "日報一般幾點發？",
    "bot": "每天 17:00，你上週跟我說過。",
    "memo": "日報每天 17:00 發",
    "memoLabel": "記憶"
  },
  "chatBody": "連線後就能用手機指派任務。執行機器人的電腦或伺服器必須保持開機並連上網路。",
  "howTo": "查看步驟",
  "guideTitle": "連接指南",
  "note": "在手機上可透過 Slack、Telegram 或 Discord 聊天。目前尚無獨立的 iOS 或 Android 應用程式。網頁控制台在你的電腦或自行架設的伺服器上執行。",
  "browserGuide": {
    "title": "本機網頁控制台",
    "steps": [
      "桌面版：系統匣選單 → 在瀏覽器中開啟；介面只監聽 127.0.0.1，每次啟動產生隨機存取權杖。",
      "Docker：開啟 http://<主機>:3600/?token=<權杖>，權杖用 docker exec amb cat /data/ui-token 查看。",
      "請勿將通訊埠 3600 直接開放到網際網路。"
    ]
  }
};
