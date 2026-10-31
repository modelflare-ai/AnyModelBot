// app：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  external_mode: "外部模型端点模式下不管理 Modelflare 连接",
  bot_not_found: "机器人不存在",
  magpie_failed: "magpie 启动失败：{message}",
  // 第一次启动时建的机器人（按当时的语言）
  default_bot_name: "我的助手",
  default_bot_prompt: "你是一个乐于助人的中文助手，回答简洁准确。",
  feishu_failed: "机器人「{name}」飞书长连接启动失败：{message}",
  weixin_expired: "机器人「{name}」微信登录已过期，请在信息面板的「渠道」里重新扫码",
  weixin_connected: "机器人「{name}」微信已连接",
  // 收到的消息里图片 / 文件 / 语音的占位（core/types.ts eventText）
  media_image: "图片",
  media_file: "文件",
  media_video: "视频",
  media_quoted_image: "引用的图片",
  media_quoted_file: "引用的文件",
  media_quoted_video: "引用的视频",
  media_voice: "[语音]",
  media_not_downloaded: "{label}（未能下载：{error}）",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  external_mode: "Modelflare connections aren't managed when using an external model endpoint",
  bot_not_found: "Bot not found",
  magpie_failed: "magpie failed to start: {message}",
  default_bot_name: "My Assistant",
  default_bot_prompt: "You are a helpful assistant. Answer concisely and accurately.",
  feishu_failed: "Bot \"{name}\": Feishu long connection failed to start: {message}",
  weixin_expired: "Bot \"{name}\": WeChat sign-in expired. Scan the QR code again under Channels in the info panel",
  weixin_connected: "Bot \"{name}\": WeChat connected",
  media_image: "Image",
  media_file: "File",
  media_video: "Video",
  media_quoted_image: "Quoted image",
  media_quoted_file: "Quoted file",
  media_quoted_video: "Quoted video",
  media_voice: "[Voice]",
  media_not_downloaded: "{label} (couldn't download: {error})",
};
