// tasks：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  stageStopped: "已停止",
  stageDelivery: "未送达",
  stageAnswer: "等你回答",
  stageApproval: "等你批准",
  stageBudget: "预算用完",
  stageFailed: "失败",
  stageReady: "已完成",
  stageQueued: "排队中",
  stageWorking: "进行中",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  stageStopped: "Stopped",
  stageDelivery: "Not delivered",
  stageAnswer: "Waiting for your answer",
  stageApproval: "Waiting for your approval",
  stageBudget: "Budget used up",
  stageFailed: "Failed",
  stageReady: "Done",
  stageQueued: "Queued",
  stageWorking: "In progress",
};
