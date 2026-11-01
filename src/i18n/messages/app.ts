// app：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  external_mode: "外部模型端点模式下不管理 Modelflare 连接",
  bot_not_found: "机器人不存在",
  magpie_failed: "magpie 启动失败：{message}",
  // 第一次启动时建的机器人（按当时的语言）
  default_bot_name: "我的助手",
  default_bot_prompt: "你是一个乐于助人的中文助手，回答简洁准确。",
  feishu_failed: "飞书账号「{name}」长连接启动失败：{message}",
  messenger_failed: "{channel} 账号「{name}」连不上，请在 设置 › 连接 里检查凭据：{message}",
  feishu_history_denied: "飞书账号「{name}」读不到飞书的历史消息，离线时发来的消息补不上。在飞书开放平台给应用开通 im:message.history:readonly 权限即可。",
  weixin_expired: "微信账号「{name}」登录已过期，请在 设置 › 连接 里重新扫码",
  weixin_connected: "微信账号「{name}」已连接",
  weixin_account_name: "微信",
  feishu_account_name: "飞书",
  // 收到的消息里图片 / 文件 / 语音的占位（core/types.ts eventText）
  media_image: "图片",
  media_file: "文件",
  media_video: "视频",
  media_quoted_image: "引用的图片",
  media_quoted_file: "引用的文件",
  media_quoted_video: "引用的视频",
  media_voice: "[语音]",
  media_not_downloaded: "{label}（未能下载：{error}）",
  weixinExpiredSubject: "微信登录已过期",
  // 数据目录锁（store/lock.ts）：同一个数据目录只能有一个宿主
  data_dir_locked: "数据目录 {dir} 正被另一个 anymodel bot 进程使用（{who}）。先退出它，或者换一个数据目录（AMB_DATA_DIR）。",
  data_dir_locked_remote: "{host} 上的 pid {pid}",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  external_mode: "Modelflare connections aren't managed when using an external model endpoint",
  bot_not_found: "Bot not found",
  magpie_failed: "magpie failed to start: {message}",
  default_bot_name: "My Assistant",
  default_bot_prompt: "You are a helpful assistant. Answer concisely and accurately.",
  feishu_failed: "Feishu account \"{name}\": long connection failed to start: {message}",
  messenger_failed: "{channel} account \"{name}\" can't connect. Check its credentials in Settings > Connections: {message}",
  feishu_history_denied: "Feishu account \"{name}\" can't read Feishu message history, so messages sent while it was offline can't be caught up. Grant the app the im:message.history:readonly scope in the Feishu Open Platform.",
  weixin_expired: "WeChat account \"{name}\": sign-in expired. Scan the QR code again in Settings > Connections",
  weixin_connected: "WeChat account \"{name}\" connected",
  weixin_account_name: "WeChat",
  feishu_account_name: "Feishu",
  media_image: "Image",
  media_file: "File",
  media_video: "Video",
  media_quoted_image: "Quoted image",
  media_quoted_file: "Quoted file",
  media_quoted_video: "Quoted video",
  media_voice: "[Voice]",
  media_not_downloaded: "{label} (couldn't download: {error})",
  weixinExpiredSubject: "WeChat sign-in expired",
  data_dir_locked: "Another anymodel bot process ({who}) is using the data directory {dir}. Quit it, or use another data directory (AMB_DATA_DIR).",
  data_dir_locked_remote: "pid {pid} on {host}",
};
