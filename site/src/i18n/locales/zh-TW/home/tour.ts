export default {
  "title": "AnyModelBot 示範",
  "note": "示範動畫，介面為示意。",
  "prev": "上一步",
  "next": "下一步",
  "steps": "示範步驟",
  "scenes": [
    {
      "title": "下載安裝",
      "caption": "依作業系統下載 Windows、macOS 或 Linux 安裝檔，也可以用 Docker 部署到伺服器。"
    },
    {
      "title": "登入 Modelflare",
      "caption": "首次啟動在瀏覽器中登入一次 Modelflare，回來就自動連好；Docker / 遠端部署登入後把連結貼回來即可。"
    },
    {
      "title": "選預設模型",
      "caption": "連上後列出帳號裡能用的模型，選一個當預設；之後隨時可以在對話裡換。"
    },
    {
      "title": "新增機器人",
      "caption": "取個名字，寫下機器人的工作和說話方式，再挑一張大頭貼。也能從範本開始，依需要修改。"
    },
    {
      "title": "開聊，隨時換模型",
      "caption": "回覆會逐字顯示，隨時都能停止。點選輸入欄位中的模型名稱即可切換。"
    },
    {
      "title": "讓它動手",
      "caption": "讀寫檔案、跑指令；越出工作區的操作會停下來，等你在對話裡點頭。"
    },
    {
      "title": "在通訊軟體裡找它",
      "caption": "在 Telegram 連上機器人後，拿起手機就能接著聊，電腦和手機共用同一份記憶。"
    }
  ],
  "ui": {
    "installing": "正在安裝 AnyModelBot…",
    "slogan": "任意模型，一個助手",
    "login": "登入 / 註冊 Modelflare",
    "loginWait": "在瀏覽器中完成登入後，會自動回到這裡",
    "loginReopen": "重新開啟登入頁 ↗",
    "loginCopy": "複製連結",
    "loginCancel": "取消",
    "authTitle": "授權 AnyModelBot 使用你的帳號",
    "authSub": "授權後會在這台電腦上產生一把只給它用的 Key。",
    "authBtn": "授權並返回",
    "connected": "已連線 · 找到 {n} 個模型",
    "pickHint": "選一個預設模型，之後隨時可在對話裡切換。",
    "filter": "篩選模型",
    "start": "開始對話",
    "newBot": "新機器人",
    "creating": "正在建立…",
    "noChat": "還沒有對話",
    "newFirst": "建立你的第一個機器人",
    "botName": "名稱",
    "botNamePh": "例如：群聊日報",
    "botNameValue": "程式碼助手",
    "botPersona": "人設",
    "botPersonaPh": "例如：你是一個樂於助人的中文助手，回答簡潔準確。",
    "botPersonaValue": "你是程式碼助手。閱讀和修改工作區裡的程式碼，編寫指令碼解決問題。",
    "create": "建立",
    "templates": "從範本開始",
    "tpls": [
      {
        "name": "群聊日報",
        "desc": "把群裡的討論整理成日報"
      },
      {
        "name": "客服助手",
        "desc": "按已知資料回答，不確定就轉人工"
      },
      {
        "name": "程式碼助手",
        "desc": "讀程式碼、寫指令碼，在工作區裡改檔案"
      }
    ],
    "search": "搜尋",
    "today": "今天 21:08",
    "thinking": "思考中…",
    "working": "正在工作…",
    "took": "用時 {s}",
    "input": "傳送訊息給「{name}」，/ 查看指令",
    "perm": "工作區可寫",
    "pickerSearch": "篩選，或輸入任意模型 ID",
    "switched": "已切換到 {model}",
    "chatUser": "幫我查看這個函式為什麼會越界。",
    "chatReply": "循環條件用了 <=，最後一次存取了 arr[len]。改成 < 就好，我把改好的版本放在下面。",
    "task": "把下載裡的發票整理進「報帳」。",
    "approvalMeta": "需要你的核准",
    "allowOnce": "允許（僅本次）",
    "deny": "拒絕",
    "allowed": "已允許",
    "fileSub": "已儲存到工作區",
    "channelOk": "{im} · 已連線",
    "channelSub": "連線後，私訊會直接傳給這個機器人",
    "imFrom": "Telegram",
    "imUser": "今天的日報好了嗎？",
    "imReply": "好了：3 個決定、2 個待辦，已存入記憶。"
  }
};
