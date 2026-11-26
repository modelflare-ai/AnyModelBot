export default {
  "facts": [
    {
      "text": "控制台預設只監聽 127.0.0.1，並驗證 Host；本機存取也要帶存取權杖。",
      "path": "src/web/server.ts"
    },
    {
      "text": "模型 Key 不進入 Agent 子程序；介面只顯示末 4 位。",
      "path": "src/agent/bridge.ts · src/agent/host.ts"
    },
    {
      "text": "檔案與指令在沙箱工作區內執行，越界走核准；Linux 上指令只在 bubblewrap 裡執行並遮住資料目錄，用不了時拒絕執行。",
      "path": "src/agent/host.ts"
    },
    {
      "text": "記憶自動拒存密碼、金鑰、證件號。",
      "path": "src/agent/memory.ts"
    },
    {
      "text": "電腦操作驅動（Cua）的遙測環境變數被置 0；magpie 的自動更新被關閉。",
      "path": "src/agent/cua-driver.ts · src/magpie/supervisor.ts"
    }
  ]
};
