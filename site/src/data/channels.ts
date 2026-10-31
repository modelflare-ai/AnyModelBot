// 首页"在哪都能用"（sections/Devices.astro）里的聊天渠道：切换台里的入口和接入步骤都由这里生成。
//
// 不放在 i18n 里：中英文页面展示的渠道可以不同，不是同一份内容的两种语言——
// 中文页面是微信、飞书；英文页面是微信、飞书，外加标着 Coming soon 的 Slack（应用里还没有 Slack 渠道）。
// 只列应用里真有的渠道；还没做好的写 soon（卡片和标签上标出来，接入指南里不放步骤），做好了再补步骤、去掉 soon。
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
      id: "wechat", icon: "chat", title: "WeChat", body: "Scan a QR code, then chat with it right in WeChat — pictures and files too.", format: "Channel (iLink QR login)",
      guide: {
        title: "Connect WeChat",
        steps: [
          "Click the bot name at the top of the chat → info panel → Channels → WeChat → Log in with QR code.",
          "Scan the QR code with WeChat and confirm. You can also run npm run weixin:login from the command line.",
          "The login is kept in your data directory and resumes after restarts; when it expires, the app asks you to scan again.",
        ],
        limit: "Platform limit: after each message you send, the bot can reply at most 10 times within 24 hours.",
        qr: "Sample QR code — not scannable",
      },
    },
    {
      id: "feishu", icon: "card", title: "Feishu", body: "A Feishu bot with streaming reply cards and approval cards.", format: "Channel (long connection + cards)",
      guide: {
        title: "Connect Feishu",
        steps: [
          "On the Feishu Open Platform, create a custom app, add the Bot capability, and grant the permissions to read direct messages, send messages as the app and write cards.",
          "In the info panel, open Channels → Feishu, enter the App ID and App Secret, and save.",
          "Under event subscriptions, choose to receive events over a long connection and add im.message.receive_v1. Publish a version, then message the bot in Feishu.",
        ],
        limit: "One-to-one chats only for now; group messages are ignored.",
      },
    },
    {
      id: "slack", icon: "hash", title: "Slack", soon: "Coming soon", body: "We're building it: DM your bot, or @mention it in a channel.", format: "Channel (in development)",
      guide: { title: "Slack", steps: [] },
    },
  ],
};
