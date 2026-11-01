// 首页"在哪都能用"（sections/Devices.astro）里的聊天渠道：切换台里的入口和接入步骤都由这里生成。
//
// 不放在 i18n 里：中英文页面展示的渠道可以不同，不是同一份内容的两种语言——
// 中文页面是微信、飞书；英文页面是 Slack、Telegram、Discord（用户 2026-11-01 定的：英文页不出现微信 / 飞书）。
// 接入步骤和应用 设置 › 连接 里的说明一致（ui/screens/connections.js）。账号全局共用，所有机器人都能用。
// 还没做好、要标出来的渠道写 soon（卡片和标签上标出来，接入指南里不放步骤），做好了再补步骤、去掉 soon。
// 所以两边条数可以不同，check-i18n 的"结构一致"不适用；禁词扫描（scripts/banned.ts）照样覆盖这个文件。
//
// 改渠道只改这一个文件：清单顺序就是数组顺序；icon 用 components/Icon.astro 里的自绘线稿，不用品牌 Logo；
// guide.qr 有值时，步骤下面附一张示意二维码（扫码登录类渠道用）。
import type { Lang } from "../i18n";

export type ChannelIcon = "chat" | "card" | "hash" | "send" | "headset";
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
          "打开 设置 → 连接 → 微信 →「添加账号」→「扫码登录」。",
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
          "打开 设置 → 连接 → 飞书 →「添加账号」。",
          "用飞书扫码，自动创建机器人应用。也可以点「用已有应用」，填企业自建应用的 App ID / App Secret。",
          "在飞书里私聊机器人。第一个发消息的人成为主人。",
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
          "At api.slack.com/apps, create an app, turn on Socket Mode and generate an app-level token (xapp-…) with connections:write.",
          "Add the bot scopes chat:write, im:history, files:read and files:write, subscribe to the message.im event and allow messages in App Home. Install the app to your workspace and copy the bot token (xoxb-…).",
          "Open Settings → Connections → Slack → Add account, paste both tokens and save. Then send the bot a direct message in Slack.",
        ],
        limit: "Direct messages only for now. The app has to be running: messages sent while it's closed aren't received.",
      },
    },
    {
      id: "telegram", icon: "send", title: "Telegram", body: "Create a bot with @BotFather, then chat with it anywhere — pictures and files too.", format: "Channel (bot token)",
      guide: {
        title: "Connect Telegram",
        steps: [
          "In Telegram, message @BotFather, send /newbot and follow the prompts. Copy the bot token it gives you.",
          "Open Settings → Connections → Telegram → Add account, paste the token and save.",
          "Open your new bot in Telegram and send it a message. It connects over long polling, so your computer needs no public address.",
        ],
        limit: "Direct messages only for now. Messages sent while the app is closed are picked up for up to 24 hours.",
      },
    },
    {
      id: "discord", icon: "headset", title: "Discord", body: "Add it to your server, then DM it from the desktop or the Discord app.", format: "Channel (bot token)",
      guide: {
        title: "Connect Discord",
        steps: [
          "In the Discord Developer Portal, create an application, add a bot and copy its token.",
          "Under OAuth2 → URL Generator, tick the bot scope and open the link to add the bot to a server you're in.",
          "Open Settings → Connections → Discord → Add account, paste the token and save. Then send the bot a direct message.",
        ],
        limit: "Direct messages only for now. The app has to be running: messages sent while it's closed aren't received.",
      },
    },
  ],
};
