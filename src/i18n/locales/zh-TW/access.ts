import type { TranslatedCatalog } from "../../index.js";

export default {
  refusal: "你還沒有被允許使用這個機器人，已通知主人。主人同意後就可以直接對話了。",
  approved: "主人已經同意了，現在可以直接和我對話。",
  chWeixin: "微信",
  chFeishu: "飛書",
  chWeb: "網頁",
  who: "{channel}使用者 {name}",
  ownerNotice: "有人想使用機器人「{bot}」——{who}{said}\n回覆「同意 {code}」允許，「拒絕 {code}」拒絕；也可以在 AnyModelBot 的資訊面板裡處理。",
  allowedAck: "✅ 已允許「{who}」使用這個機器人",
  deniedAck: "❌ 已拒絕「{who}」",
  ownerOf: "{channel}主人{who}",
  notSet: "未設定",
  listSep: "，",
  pendingRequests: "；{count} 個使用請求待處理（回覆「同意 編號」或在應用程式的資訊面板裡處理）",
  policy: "誰能使用：只有主人和允許名單裡的人（{owners}；已允許 {allowed} 人）{req}",
  said: "：「{text}」",
} satisfies TranslatedCatalog["access"];
