// media：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
// 只有给用户看的部分（生成前的确认、参考价）在这里；工具结果与错误是给模型看的，留在 media.ts。
import type { Catalog } from "../types.js";

export const zh = {
  // 参考价
  pricePerSecond: "{price}/秒（{res}）",
  pricePerImage: "{price}/张",
  pricePerCall: "{price}/次",
  priceToken: "按 token 计费",
  // 确认里的摘要
  seconds: "{n} 秒",
  references: "{count} 个参考素材",
  summaryPrompt: "提示词：{prompt}",
  summaryParams: "参数：{params}",
  summaryPrice: "参考价：{price}",
  // 生成前的确认（manager.ts confirmMedia）
  confirmHeaderImage: "生成图片",
  confirmHeaderVideo: "生成视频",
  confirmQuestionImage: "这次用 {model} 生成图片吗？",
  confirmQuestionVideo: "这次用 {model} 生成视频吗？",
  confirmDetail: "{summary}{reason}\n也可以直接回复其他模型名。",
  reasonCost: "预计花费约 ${amount}，超过 ${limit}",
  reasonCostUnknown: "这次的花费估算不出来",
  tagDefault: "默认",
  tagBotPick: "机器人选的",
  cancel: "取消",
  cancelDesc: "这次不生成",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  pricePerSecond: "{price}/s ({res})",
  pricePerImage: "{price}/image",
  pricePerCall: "{price}/call",
  priceToken: "billed per token",
  seconds: "{n}s",
  references: { one: "1 reference", other: "{count} references" },
  summaryPrompt: "Prompt: {prompt}",
  summaryParams: "Settings: {params}",
  summaryPrice: "Estimated price: {price}",
  confirmHeaderImage: "Generate image",
  confirmHeaderVideo: "Generate video",
  confirmQuestionImage: "Generate this image with {model}?",
  confirmQuestionVideo: "Generate this video with {model}?",
  confirmDetail: "{summary}{reason}\nYou can also reply with another model name.",
  reasonCost: "Estimated cost about ${amount}, above ${limit}",
  reasonCostUnknown: "The cost of this run can't be estimated",
  tagDefault: "default",
  tagBotPick: "picked by the bot",
  cancel: "Cancel",
  cancelDesc: "Don't generate this time",
};
