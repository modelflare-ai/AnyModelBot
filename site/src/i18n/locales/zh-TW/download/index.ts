export default {
  "warn": "不要把 3600 連接埠直接暴露到公用網路。",
  "win": "下載 Windows 版",
  "mac": "下載 macOS 版",
  "linux": "下載 Linux 版",
  "mobile": "透過手機上的 Slack、Telegram 或 Discord 使用",
  "generic": "下載",
  "more": "其它平台",
  "items": {
    "win-x64": "Windows 安裝套件（NSIS）",
    "mac-arm64": "macOS Apple 芯片",
    "mac-x64": "macOS Intel",
    "linux-x64": "Linux AppImage",
    "docker": "Docker 指令",
    "changelog": "更新紀錄"
  },
  "platform": {
    "win-x64": "Windows",
    "mac-arm64": "macOS",
    "mac-x64": "macOS",
    "linux-x64": "Linux"
  },
  "arch": {
    "win-x64": "x64",
    "mac-arm64": "Apple 芯片",
    "mac-x64": "Intel",
    "linux-x64": "x64 · AppImage"
  },
  "meta": "版本 {version} · 發布於 {publishedAt}",
  "sha": "SHA-256",
  "started": "已開始下載，可在瀏覽器下載清單查看。",
  "downloading": "正在下載…",
  "macNote": "macOS 上的電腦操作目前為 Beta：直連模式還要在更多真機上驗證。「輔助功能」和「螢幕錄製」權限在機器人第一次用到時才請求。其餘功能和 Windows、Linux 版一樣。",
  "linuxHint": "chmod +x anymodel-bot-*.AppImage && ./anymodel-bot-*.AppImage",
  "winHint": "系統提示風險時，點「更多資訊 → 仍要執行」。",
  "macHint": "已完成 Developer ID 簽名和蘋果公證。將套用拖入「應用程式」後開啟，首次出現下載確認時點「開啟」。",
  "firstRun": "首次執行",
  "yourSystem": "你的系統",
  "verifyTitle": "驗證下載",
  "verifyLead": "用對應的指令算出安裝套件的 SHA-256，和這裡列出的值一致，就說明檔案完好。",
  "verifyUnixLabel": "macOS / Linux",
  "verifyWin": "Get-FileHash .\\<檔案> -Algorithm SHA256",
  "verifyUnix": "shasum -a 256 <檔案>",
  "pageTitle": "下載 AnyModelBot",
  "pageLead": "免費開放原始碼。App 本身不必註冊，首次啟動登入 Modelflare 就能用。",
  "pageDescription": "下載 AnyModelBot：Windows、macOS、Linux 與 Docker。免費開放原始碼，依用量付費。",
  "altTitle": "其它安裝方式",
  "dockerTitle": "Docker",
  "dockerSteps": {
    "run": "啟動容器",
    "token": "讀取存取權杖",
    "open": "在瀏覽器中開啟"
  },
  "dockerUrl": "http://<主機>:3600/?token=<權杖>",
  "cliTitle": "命令列（CLI）",
  "cliBody": "從原始碼執行，需要 Node.js 22.13+ 與 Go 1.26.8+（用於編譯內建閘道）。",
  "cliSteps": {
    "clone": "複製儲存庫",
    "setup": "安裝相依套件，編譯內建閘道",
    "start": "啟動，然後開啟 http://127.0.0.1:3600/"
  },
  "releases": "GitHub 發布頁",
  "changelog": "更新紀錄"
};
