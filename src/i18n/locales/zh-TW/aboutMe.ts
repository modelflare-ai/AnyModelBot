import type { TranslatedCatalog } from "../../index.js";

export default {
  addedChannel: "✓ 已記到關於我：{line}（回覆「撤銷」可撤回）",
  changedChannel: "✓ 已改關於我：{line}（回覆「撤銷」可撤回）",
  removedChannel: "✓ 已從關於我刪除：{line}（回覆「撤銷」可撤回）",
  undone: "已撤銷，關於我還原為原來的樣子",
  empty: "寫一句話再儲存",
  tooLong: "一句最多 300 字",
  secret: "密碼、金鑰、權杖、驗證碼不能存",
  idOrCard: "證件號、銀行卡號不能存進關於我",
  missing: "這一句已經不在了",
  stale: "這一句已經改過了，這個建議不再有效",
  notUndoable: "這次變更已經不能撤銷了",
} satisfies TranslatedCatalog["aboutMe"];
