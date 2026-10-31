// access：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  refusal: "你还没有被允许使用这个机器人，已通知主人。主人同意后就可以直接对话了。",
  approved: "主人已经同意了，现在可以直接和我对话。",
  chWeixin: "微信",
  chFeishu: "飞书",
  chWeb: "网页",
  who: "{channel}用户 {name}",
  ownerNotice: "有人想使用机器人「{bot}」——{who}{said}\n回复「同意 {code}」允许，「拒绝 {code}」拒绝；也可以在 AnyModelBot 的信息面板里处理。",
  allowedAck: "✅ 已允许「{who}」使用这个机器人",
  deniedAck: "❌ 已拒绝「{who}」",
  ownerOf: "{channel}主人{who}",
  notSet: "未设置",
  listSep: "，",
  pendingRequests: "；{count} 个使用请求待处理（回复「同意 编号」或在应用的信息面板里处理）",
  policy: "谁能使用：只有主人和允许名单里的人（{owners}；已允许 {allowed} 人）{req}",
  said: "：「{text}」",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  refusal: "You haven't been allowed to use this bot yet; the owner has been notified. Once they approve, you can chat right away.",
  approved: "The owner has approved you. You can chat with me now.",
  chWeixin: "WeChat",
  chFeishu: "Feishu",
  chWeb: "web",
  who: "{channel} user {name}",
  ownerNotice: "Someone wants to use the bot \"{bot}\": {who}{said}\nReply \"yes {code}\" to allow or \"no {code}\" to deny, or handle it in AnyModelBot's info panel.",
  allowedAck: "✅ Allowed \"{who}\" to use this bot",
  deniedAck: "❌ Denied \"{who}\"",
  ownerOf: "{channel} owner{who}",
  notSet: " not set",
  listSep: ", ",
  pendingRequests: "; {count} usage request(s) waiting (reply \"yes <code>\" or handle them in the app's info panel)",
  policy: "Who can use it: only the owners and people on the allow list ({owners}; {allowed} allowed){req}",
  said: ": \"{text}\"",
};
