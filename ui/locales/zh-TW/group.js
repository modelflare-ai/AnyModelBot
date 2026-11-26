// group · zh-TW：群聊（screens/group.js）
export default {
  /** @ 清單裡代表所有成員的那一項，寫進輸入欄位的也是它（伺服器端 core/groups.ts 認得） */
  everyone: "所有人",
  placeholder: "傳送訊息，@ 指定誰回答",
  mentionLabel: "選擇要 @ 的成員",
  editTitle: "群聊名稱和成員",
  empty: "@ 誰，誰回答；沒有 @ 時，由上一個回答的機器人接著答。每個機器人用自己的模型、工作區和記憶。",
  /** 機器人被刪除後，它留下的回覆顯示的名字 */
  removedBot: "已刪除的機器人",
  working: "{name} 正在回答…",
  noMessages: "還沒有訊息",
  sheet: {
    newTitle: "新增群聊",
    editTitle: "群聊名稱和成員",
    name: "名稱",
    namePlaceholder: "不填就用成員的名字",
    members: "成員",
    membersHint: "至少選兩個機器人",
    create: "建立",
    save: "儲存",
  },
  delete: {
    title: "刪除「{name}」？",
    body: "會永久刪除這個群聊和裡面的訊息，無法還原。機器人和它們的單聊不受影響。",
    confirm: "永久刪除",
  },
};
