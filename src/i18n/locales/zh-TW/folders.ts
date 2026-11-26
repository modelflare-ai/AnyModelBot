import type { TranslatedCatalog } from "../../index.js";

export default {
  err_notAllowed: "不能選擇這個位置，請選擇具體的專案資料夾",
  err_unavailable: "無法存取這個資料夾，請重新選擇",
  err_system: "系統不允許存取這個資料夾，請檢查存取權限後再試",
  err_desktopOnly: "請在執行機器人的桌面版選擇資料夾",
  err_changed: "傳送條件已變化，請檢查後再試",
  promptFolderGone: "[這則訊息綁定的工作資料夾「{name}」現在不可用（{reason}）：不要讀寫其他位置的同名檔案或改用別的目錄，本輪不能修改檔案。告訴使用者這個資料夾已不可用，請重新選擇後再試]",
  reasonUnavailable: "不在了、被替換或不是目錄",
  reasonSystem: "系統不允許存取",
  reasonNotAllowed: "這個位置不能作為工作資料夾",
} satisfies TranslatedCatalog["folders"];
