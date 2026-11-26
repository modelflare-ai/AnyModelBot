export default {
  "eyebrow": "價格 · 依用量付費",
  "h2mark": "沒有訂閱費",
  "h2rest": "。用多少，付多少。",
  "lead": "AnyModelBot 免費開放原始碼，沒有訂閱、沒有檔位。模型用量由 Modelflare 按 token 計費，價格表完全公開。",
  "source": "價格取自 modelflare.dev/pricing，資料抓取於 {fetchedAt}（UTC+8），版本 {pricingVersion}。",
  "stale": "價格快照日期：{snapshotDate}（暫未能更新，請以 modelflare.dev/pricing 為準）。",
  "cards": {
    "app": {
      "tag": "AnyModelBot",
      "price": "$0",
      "unit": "/ 永久",
      "note": "免費開放原始碼（MIT）",
      "points": [
        "桌面（Windows / macOS / Linux）、Docker、CLI 都免費",
        "沒有訂閱，沒有套餐檔位",
        "機器人想建幾個建幾個，每個都由你定義",
        "新使用者註冊 Modelflare 即送 $1 Bot 額度，只能在 AnyModelBot 裡使用"
      ]
    },
    "usage": {
      "tag": "模型用量 · 由 Modelflare 計費",
      "unit": "/ 100 萬輸入 tokens",
      "note": "範例：{model} · 預設線路 · 輸出 {output} / 100 萬 tokens；官方價 {officialIn} / {officialOut}",
      "points": [
        "按 token 計價，輸入輸出分開",
        "價格表公開可查",
        "換模型隨時換，價格跟著模型走",
        "訂閱 Modelflare 套餐，另送套餐額度 10% 的 Bot 額度"
      ],
      "cta": "查看完整價格表 ↗"
    },
    "month": {
      "tag": "日常用量估算",
      "unit": "/ 月",
      "note": "範例用量：每天 50 則訊息，每條 3,000 輸入 + 600 輸出 tokens，{model}。",
      "points": [
        "用下面的計算器換成你的用量",
        "估算不含快取折扣與特殊請求倍率",
        "實際以 Modelflare 帳單為準"
      ],
      "cta": "開啟計算器"
    }
  },
  "contrast": {
    "caption": "依用量付費與訂閱制檔位的通用對照",
    "head": [
      "",
      "依用量付費（AnyModelBot + Modelflare）",
      "訂閱制檔位（同類產品的通常做法）"
    ],
    "rows": [
      [
        "怎麼收費",
        "用多少付多少，沒有訂閱費",
        "先付訂閱費，檔位決定可用量"
      ],
      [
        "用不完的部分",
        "不產生固定支出",
        "當月額度通常不累計"
      ],
      [
        "換模型",
        "隨時換，價格跟著模型走",
        "可選模型通常受檔位限制"
      ],
      [
        "價格怎麼看",
        "每 100 萬 tokens 的單價，公開可查",
        "常以「相對額度」的倍數表述"
      ]
    ],
    "note": "「訂閱制檔位」指以訂閱費分檔的這一類產品的通常做法，不指任何具體產品，也不代表其實際價格。"
  },
  "table": {
    "more": "查看全部 {textCount} 個文字模型的價格 →",
    "caption": "Modelflare 文字模型價格（預設線路，USD / 100 萬 tokens）",
    "col": {
      "model": "模型",
      "route": "預設線路",
      "input": "輸入 / 1M",
      "output": "輸出 / 1M",
      "official": "官方價（輸入 / 輸出）",
      "vs": "相當於官方價"
    },
    "default": "預設",
    "context": "上下文 {n}",
    "showAll": "查看全部 {textCount} 個文字模型",
    "showFeatured": "只看精選",
    "search": "搜尋模型",
    "allVendors": "全部廠商",
    "media": "影像與影片模型（{mediaCount} 個）請見 modelflare.dev/pricing ↗",
    "expand": "展開 {model} 的全部線路",
    "detail": {
      "route": "線路",
      "positioning": "定位",
      "vs": "相當於官方價",
      "price": "輸入 / 輸出"
    },
    "positioning": {
      "stable": "高穩定線路",
      "award": "高性價比線路",
      "campaign": "限時活動線路",
      "enterprise": "高穩定線路（僅限授權的企業生產場景）",
      "other": "其他線路"
    },
    "unlock": "單次充值達 US${amount} 解鎖（限時活動，規則以 Modelflare 為準）",
    "tiers": "超過 {n} tokens 的單條請求按長上下文件計價：輸入 {input} · 輸出 {output}",
    "none": "沒有找到符合條件的模型。",
    "note": "價格單位為美元 / 100 萬 tokens，顯示的是「預設線路」的價格；你的帳號可能有不同的權限或折扣（Modelflare 頁面同樣說明）。資料取自 modelflare.dev/pricing，抓取於 {fetchedAt}（UTC+8），版本 {pricingVersion}。"
  },
  "calc": {
    "title": "算算你每月大概花多少",
    "model": "模型",
    "search": "輸入以搜尋模型",
    "none": "沒有找到符合條件的模型。",
    "route": "線路",
    "routeDefault": "預設線路",
    "routeAward": "價格優先線路（award）",
    "routeAwardNote": "適合可重試的開發與測試場景",
    "msgs": "每天訊息數",
    "inTok": "每條輸入 tokens",
    "inTokNote": "含歷史上下文與工具結果",
    "outTok": "每條輸出 tokens",
    "days": "按 30 天估算",
    "presets": {
      "light": "輕度",
      "everyday": "日常",
      "heavy": "重度（Agent）"
    },
    "hint": "一則訊息 = 你發一則訊息、機器人完成一次回覆所產生的模型呼叫合計；Agent 執行任務時一次回覆可能包含多次模型呼叫。",
    "result": "≈ {amount} / 月",
    "split": "輸入 {input} · 輸出 {output}",
    "perMsg": "每則訊息約 {amount}",
    "official": "按官方價約 {amount}",
    "disclaimer": "估算值，不含快取折扣與請求級倍率（如 priority 服務層）；超過該模型分檔閾值的請求按更高檔計價（已計入）；實際以 Modelflare 帳單為準。",
    "copy": "複製估算",
    "copyText": "AnyModelBot 用量估算：{model}（{route}），每天 {msgs} 條，每條 {inTok} 輸入 + {outTok} 輸出 tokens，約 {amount} / 月（按 30 天，價格抓取於 {fetchedAt}）",
    "full": "查看這個模型的完整價格 ↗",
    "expandBar": "展開"
  },
  "banner": {
    "text": "已有 Modelflare 帳號？在 App 裡登入一次就能用，用量按價格表計費。",
    "cta": "開啟 Modelflare ↗"
  },
  "pageTitle": "AnyModelBot 價格｜依用量付費，價格表公開",
  "pageDescription": "AnyModelBot 免費開放原始碼、沒有訂閱。模型用量由 Modelflare 按 token 計費：公開價格表與每月費用計算器。"
};
