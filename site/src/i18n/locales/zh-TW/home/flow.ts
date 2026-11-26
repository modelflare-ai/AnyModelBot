export default {
  "h2": "你的資料，",
  "h2dim": "到底去了哪？",
  "lead": "留在你電腦上的，和必須出去的，都畫給你看。",
  "local": "你的裝置（本機）",
  "localBadge": "本機",
  "out": "出網",
  "vendors": "模型廠商",
  "channels": "你主動連線的管道",
  "onlyRequest": "僅目前請求",
  "nodes": {
    "chats": {
      "label": "對話記錄（SQLite）",
      "body": "存在資料目錄的 SQLite 資料庫裡；刪除機器人即刪除它的對話。"
    },
    "memory": {
      "label": "長期記憶（Markdown 檔案）",
      "body": "資料目錄裡的 Markdown 檔案，附變更記錄 journal.jsonl；密碼、金鑰、證件號不會被記住。"
    },
    "workspace": {
      "label": "工作區檔案",
      "body": "機器人自己的工作區；預設唯寫這裡；要寫到工作區以外，得先經過你點頭。"
    },
    "key": {
      "label": "模型 Key（隔離，末 4 位顯示）",
      "body": "只在閘道程序與設定裡；Agent 子程序環境裡沒有真實金鑰；介面只顯示末 4 位。"
    },
    "console": {
      "label": "控制台：127.0.0.1 + 權杖",
      "body": "預設只監聽 127.0.0.1 並驗證 Host；Docker 模式必須帶存取權杖。"
    },
    "gateway": {
      "label": "Modelflare 閘道",
      "sub": "轉送本次請求 · 記錄保留期可選",
      "body": "轉送本次請求到你選擇的廠商；記錄保留期以 Modelflare 文件《Data retention》為準。"
    },
    "vendors": {
      "label": "OpenAI / Anthropic / Google …",
      "body": "收到的是你發給模型的內容，包括電腦操作時的螢幕內容。"
    },
    "channels": {
      "label": "聊天管道",
      "sub": "Slack、Telegram、Discord 等",
      "body": "訊息會經過這些平台的伺服器。"
    }
  },
  "retentionLink": "Modelflare 文件《資料保留》",
  "retentionUrl": "https://docs.modelflare.dev/zh/guides/features/data-retention/?utm_source=anymodelbot&utm_campaign=amb_homepage",
  "compare": {
    "caption": "AnyModelBot 與典型雲端託管型助手的對照",
    "head": [
      "",
      "AnyModelBot",
      "典型雲端託管型助手"
    ],
    "rows": [
      [
        "執行位置",
        "你的電腦 / 你的伺服器",
        "廠商的雲端"
      ],
      [
        "對話與記憶存放",
        "你的硬碟",
        "廠商伺服器"
      ],
      [
        "模型",
        "Modelflare 上任選，隨時換",
        "通常綁定自家模型"
      ],
      [
        "計費",
        "App 免費；模型依用量付費給 Modelflare",
        "通常按月訂閱、分檔"
      ],
      [
        "電腦操作",
        "操作你自己的電腦（受限 24 個動作）",
        "操作廠商提供的雲端電腦"
      ],
      [
        "推理請求是否出網",
        "是，經 Modelflare 到模型廠商",
        "是"
      ],
      [
        "程式碼可審計",
        "MIT",
        "多數否"
      ]
    ],
    "note": "「典型雲端託管型助手」指執行在廠商雲端、按訂閱費計費的這一類產品的通常做法，不指任何具體產品。"
  },
  "security": "查看完整安全說明 →"
};
