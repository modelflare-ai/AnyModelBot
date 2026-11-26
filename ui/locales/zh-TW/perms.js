// perms · zh-TW
export default {
  workspace: "工作區可寫",
  workspaceNote: "只能改這個機器人的工作區，越界操作先問你",
  readonly: "唯讀",
  readonlyNote: "不能改檔案，指令在唯讀沙箱裡執行",
  full: "完全權限",
  fullNote: "指令不經沙箱，可讀寫你的所有檔案；遞迴刪除仍會先問你",
  fullWarning: "指令不經沙箱，以你的使用者身分直接執行：可以讀取和修改你電腦上的任何檔案，包括 AnyModelBot 自己的資料（對話記錄、管道權杖和金鑰）。越界操作不再請求核准，只有遞迴刪除（rm -r、Remove-Item -Recurse 等）仍會先問你。只在你信任目前模型和任務時開啟。",
  confirmTitle: "開啟完全權限？",
  confirmLabel: "開啟完全權限",
};
