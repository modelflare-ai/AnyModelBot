// ui · zh-TW：共用元件（components/ui.js）。按鈕的「取消 / 確定 / 關閉 / 複製」用 common
export default {
  /** 狀態徽標（Badge s="…"）：管道、閘道、掃碼登入、核准、提問卡片的狀態 */
  state: {
    disabled: "未啟用",
    connecting: "連線中",
    connected: "已連線",
    error: "錯誤",
    expired: "已過期",
    paused: "已暫停",
    login_required: "未登入",
    running: "執行中",
    starting: "啟動中",
    restarting: "重新啟動中",
    failed: "失敗",
    stopped: "已停止",
    wait: "等待掃碼",
    scaned: "已掃碼",
    need_verifycode: "需驗證碼",
    confirmed: "已確認",
    already_bound: "已綁定",
    cancelled: "已取消",
    idle: "空閒",
    fetching: "取得中",
    pending: "待處理",
    allowed: "已核准",
    rejected: "已拒絕",
    answered: "已回答",
    denied: "已拒絕",
  },
  /** 行最右側「⋯」的懸停提示和讀屏名稱（MoreButton） */
  more: "更多",
  moreFor: "「{name}」的更多操作",
};
