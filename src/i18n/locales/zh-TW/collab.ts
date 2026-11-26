import type { TranslatedCatalog } from "../../index.js";

export default {
  msgPoints: "背景要點：",
  msgFiles: "相關檔案：",
  msgAskOnly: "不用動手，只回答就行。",
  msgDoneWhen: "做完的標準：{criteria}",
  msgRedo: "{issue}，請改一下。（重做 {n}/{limit}）",
  msgAdds: "使用者補充：{text}",
  whyUser: "你讓它停下了",
  whyTimeout: "超過 {limit}",
  whyBudget: "這件事已花滿 {budget}",
  whyError: "出錯了：{reason}",
  hours: { other: "{count} 小時" },
  minutes: { other: "{count} 分鐘" },
  noText: "（沒有寫說明）",
  fallbackReply: "收到{bot}的訊息：\n\n{text}",
  fallbackStopped: "{bot}先停下了（{why}）。{text}",
  droppedExpired: "{bot}排隊超過 24 小時還沒開始，這件事作廢了。",
  droppedModel: "{bot}換成了你自己的 API Key 模型，排著的這件沒法開始，已取消。",
  deleted: "{bot}已被刪除，這件事停下了。",
} satisfies TranslatedCatalog["collab"];
