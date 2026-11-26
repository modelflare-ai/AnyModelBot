// guide · zh-TW：新手引導（入門清單）。lib/guide.js 的步驟文案 + components/guide.js 的介面
export default {
  /** 文案裡 {name} 的預設值：預設機器人的名字 */
  defaultBotName: "天天",
  /** 清單選單裡各步驟標題的 {name}（不針對某個機器人） */
  nameGeneric: "機器人",
  /** 完成一步時提示裡的 {name} */
  nameToast: "它",
  title: "入門清單",
  allDone: "入門清單全部完成",
  /** 「入門清單 · 3/6」；progress 可以是帶樣式的數字 */
  progress: "入門清單 · {progress}",
  toastProgress: "入門清單 {progress} · {title}",
  collapse: "收起到左下角",
  demoThis: "示範這句",
  watchDemo: "看示範",
  tryThis: "試試這句",
  sendThis: "傳送這句",
  followHint: "跟著提示點一下就好",
  takeMe: "帶我去",
  completed: "已完成",
  upNext: "接下來做這個",
  hide: "不再顯示清單",
  coachLabel: "入門引導",
  closeCoach: "關閉引導",
  doneTitle: "做好了",
  fill: "填入",
  openConsole: "去 Modelflare 控制台開通圖片模型 ↗",
  later: "稍後再說",
  stopHere: "先到這裡",
  next: "下一步：{title}",
  /** 主動點清單步驟卻被擋住時的提示（按優先順序只說最前一條） */
  blocked: {
    permission: "先處理完目前的權限請求，再繼續入門引導",
    needs: "先處理完需要你處理的事項，再繼續入門引導",
    replying: "等它回覆完，再繼續入門引導",
  },
  demo: {
    label: "預置示範",
    generating: "正在產生範例圖",
    alt: "範例圖：戴著耳機的藍色小機器人，扁平插畫風",
    zoomIn: "看大圖",
    zoomOut: "縮小",
    caption: "範例圖是用戶端內附的，沒有呼叫模型。",
    enable: "開通圖片模型 ↗",
  },
  /**
   * 各步驟（id 與 src/guide.ts 的 GUIDE_STEPS 一致）：title、desc、how（幾條怎麼做）、try（可以一鍵發出的範例，沒有就不給按鈕）、
   * note、doneText（做完後）；生圖那一步另有 demoNote、noModelText（帳號還沒有圖片模型時的 doneText）。{name} = 機器人的名字
   */
  steps: {
    hello: {
      title: "跟{name}打個招呼",
      desc: "在這裡直接和機器人聊天，回覆會邊寫邊出來。",
      how: ["Enter 傳送，Shift + Enter 換行", "Esc 讓它停下", "輸入 / 查看全部指令"],
      try: "你能幫我做什麼？",
      doneText: "以後在這裡隨時找它；左下角的清單會一直陪著你。",
    },
    model: {
      title: "換個模型",
      desc: "一個帳號就能用 GPT、Claude、Gemini 等模型，不同的事可以交給不同的模型。",
      how: ["點輸入欄位右下角的模型名，選一個就換好了", "只對這段對話生效；想一直用它，點清單底部的「設為此機器人的預設模型」", "每個模型都標著上下文長度、能力和參考價"],
      doneText: "換好了，只對這段對話生效。問它一句試試。",
    },
    weixin: {
      title: "把{name}接到微信",
      desc: "掃碼後，在微信裡直接私聊它，不用裝新 App。電腦開著，它就線上。",
      how: ["點頂部的機器人名字，開啟右側面板，點「管理聊天管道」", "在「微信」那一行點「連線」", "用微信掃碼，在手機上確認"],
      note: "微信的規定：你每發一則訊息，它 24 小時內最多回 10 條。用飛書、Telegram、Slack、Discord 的話，在同一處新增帳號。所有機器人共用帳號，聊天時發 /bot 名字 換一個機器人。",
      doneText: "在微信裡給它發則訊息試試。想換一個機器人聊，發 /bot。",
    },
    hands: {
      title: "讓它動手做件事",
      desc: "它能在自己的工作區裡寫檔案、跑指令，做好的檔案會交給你。",
      how: ["它只改自己工作區裡的東西", "要動工作區以外的檔案，會先在對話裡問你，你點「允許」才做", "不放心？把輸入欄位左下角的權限切成「唯讀」"],
      try: "在你的工作區建一個「今日待辦.md」，列三件今天要做的事，然後發給我。",
      doneText: "做好的檔案在對話裡；在微信、飛書裡會直接發給你。",
    },
    memory: {
      title: "讓它記住你",
      desc: "告訴它你的習慣和常用資訊，所有機器人都會記得，開新對話、到微信裡也一樣。密碼、金鑰這類內容不會記。",
      how: ["說「記住……」就行，聊天中它也會自己記下重要的事", "想讓它忘掉，說「忘掉……」，或在右側面板的「記憶」裡刪掉"],
      try: "記住：回答盡量簡短，結論放在最前面。",
      doneText: "記下了。所有機器人都知道了，在設定 › 關於我裡能看到、也能改。",
    },
    media: {
      title: "產生一張圖",
      desc: "它可以畫圖、做影片。說一句就產生，花費較高時才先問你。",
      how: ["描述你想要的畫面", "畫好的圖直接顯示在對話裡，點開看大圖", "預計花費超過 $0.5 時，會先問你用哪個模型"],
      try: "畫一隻戴著耳機的藍色小機器人，扁平插畫風。",
      demoNote: "示範的流程和真的一樣，只是不呼叫模型、不扣費。",
      doneText: "剛才是示範。想真的畫，直接跟它說一句。",
      noModelText: "剛才是示範。你的帳號暫時還沒有可用的圖片模型，開通後同樣一句話它就會真的畫給你。",
    },
  },
};
