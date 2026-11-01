// 首页"在哪都能用"（sections/Devices.astro）里的聊天渠道：切换台里的入口和接入步骤都由这里生成。
//
// 不放在 i18n 里：中英文页面展示的渠道可以不同，不是同一份内容的两种语言——
// 中文页面是微信、飞书；英文页面是 Slack、Telegram、Discord、WhatsApp（用户 2026-11-01 定的：英文页不出现微信 / 飞书，
// 这四个直接按已支持来写；应用里目前只有 weixin、feishu 两个渠道，接入步骤照各平台的通用做法写，渠道做好后按真实界面核对）。
// 还没做好、要标出来的渠道写 soon（卡片和标签上标出来，接入指南里不放步骤），做好了再补步骤、去掉 soon。
// 所以两边条数可以不同，check-i18n 的"结构一致"不适用；禁词扫描（scripts/banned.ts）照样覆盖这个文件。
//
// 改渠道只改这一个文件：清单顺序就是数组顺序；icon 用 components/Icon.astro 里的自绘线稿，不用品牌 Logo；
// guide.qr 有值时，步骤下面附一张示意二维码（扫码登录类渠道用）。
import type { Lang } from "../i18n";

export type ChannelIcon = "chat" | "card" | "hash" | "send" | "headset" | "phone";
export interface Channel {
  id: string;
  icon: ChannelIcon;
  title: string;
  /** 一句话，卡片上两行以内 */
  body: string;
  /** 接入方式，卡片上的小字 */
  format: string;
  /** 还没上线时的标记文字（如 "Coming soon"）：入口行不列它，接入指南的标签上带这个标记，面板里只有一句说明、没有步骤 */
  soon?: string;
  guide: { title: string; steps: string[]; limit?: string; qr?: string };
}

export const CHANNELS: Record<Lang, Channel[]> = {
  zh: [
    {
      id: "wechat", icon: "chat", title: "微信", body: "扫码接入，在微信里直接聊，图片和文件也能发。", format: "渠道（iLink 扫码登录）",
      guide: {
        title: "接入微信",
        steps: [
          "打开对话页顶部的机器人名称 → 信息面板 →「渠道」→ 微信 →「扫码登录」。",
          "用微信扫描二维码并确认。也可以在命令行运行 npm run weixin:login。",
          "登录态保存在数据目录，重启后自动续用；登录过期时界面会提示重新扫码。",
        ],
        limit: "平台限制：你每发来一条消息后 24 小时内机器人最多可回复 10 条。",
        qr: "示意二维码，不可扫描",
      },
    },
    {
      id: "feishu", icon: "card", title: "飞书", body: "飞书机器人，流式回复卡片 + 审批卡片。", format: "渠道（长连接 + 卡片）",
      guide: {
        title: "接入飞书",
        steps: [
          "在飞书开放平台创建企业自建应用，添加「机器人」能力，开通单聊读取、以应用身份发消息、卡片写入权限。",
          "在信息面板「渠道 → 飞书」填入 App ID / App Secret 并保存。",
          "事件订阅选「使用长连接接收事件」，添加 im.message.receive_v1；发布版本后在飞书里私聊机器人。",
        ],
        limit: "目前只处理单聊，群聊消息会被忽略。",
      },
    },
  ],
  en: [
    {
      id: "slack", icon: "hash", title: "Slack", body: "Message it in a Slack DM — at your desk or on your phone, pictures and files too.", format: "Channel (Socket Mode)",
      guide: {
        title: "Connect Slack",
        steps: [
          "At api.slack.com/apps, create an app, turn on Socket Mode and generate an app-level token (xapp-…).",
          "Add the bot scopes chat:write and im:history, subscribe to the message.im event and allow messages in App Home. Install the app to your workspace and copy the bot token (xoxb-…).",
          "Click the bot name at the top of the chat → info panel → Channels → Slack, paste both tokens and save. Then send the bot a direct message in Slack.",
        ],
      },
    },
    {
      id: "telegram", icon: "send", title: "Telegram", body: "Create a bot with @BotFather, then chat with it anywhere — pictures and files too.", format: "Channel (bot token)",
      guide: {
        title: "Connect Telegram",
        steps: [
          "In Telegram, message @BotFather, send /newbot and follow the prompts. Copy the bot token it gives you.",
          "Click the bot name at the top of the chat → info panel → Channels → Telegram, paste the token and save.",
          "Open your new bot in Telegram and send it a message. It connects over long polling, so your computer needs no public address.",
        ],
      },
    },
    {
      id: "discord", icon: "headset", title: "Discord", body: "Add it to your server, then DM it from the desktop or the Discord app.", format: "Channel (bot token)",
      guide: {
        title: "Connect Discord",
        steps: [
          "In the Discord Developer Portal, create an application, add a bot and copy its token.",
          "Under OAuth2 → URL Generator, tick the bot scope and open the link to add the bot to a server you're in.",
          "Click the bot name at the top of the chat → info panel → Channels → Discord, paste the token and save. Then send the bot a direct message.",
        ],
      },
    },
    {
      id: "whatsapp", icon: "phone", title: "WhatsApp", body: "Link a number by QR code, then message it like any other contact.", format: "Channel (QR login)",
      guide: {
        title: "Connect WhatsApp",
        steps: [
          "Click the bot name at the top of the chat → info panel → Channels → WhatsApp → Log in with QR code.",
          "On the phone with the bot's number, open WhatsApp → Settings → Linked devices → Link a device, and scan the QR code. A separate number for the bot works best.",
          "Message that number from your own WhatsApp. The login is kept in your data directory and resumes after restarts; when it expires, the app asks you to scan again.",
        ],
        qr: "Sample QR code — not scannable",
      },
    },
  ],
};
