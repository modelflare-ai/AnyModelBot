import type { TranslatedCatalog } from "../../index.js";

export default {
  failed: "連線未能完成，請檢查網路後重試。",
  feishuStartRefused: "飛書未能開始授權，請重試，或使用已有的應用程式。",
  feishuDeclined: "你在飛書中取消了授權。",
  feishuQrExpired: "QR Code已過期，請重試。",
  feishuAppRefused: "飛書拒絕了這個應用程式，請檢查 App ID、App Secret 和訊息權限。",
  feishuNoRefreshToken: "飛書沒有返回長期登入認證資料，請重新授權。",
  feishuAuthExpired: "授權已過期，請重試。",
  feishuAuthIncomplete: "飛書授權未完成，請重試。",
  notionUnavailable: "無法連線 Notion 登入服務，請稍後重試。",
  notionUnexpected: "Notion 登入服務返回了無法識別的內容，請重試。",
  notionRegistrationUnavailable: "Notion 登入服務暫不接受新用戶端，請稍後重試。",
  notionRegistrationRefused: "Notion 登入服務未能註冊此應用程式，請重試。",
  notionLinkExpired: "此登入連結已過期，請從設定中重新開始。",
  notionDeclined: "你取消了授權。",
  notionAuthIncomplete: "Notion 授權未完成。",
  notionExchangeFailed: "Notion 授權未完成，請重試。",
} satisfies TranslatedCatalog["connections"];
