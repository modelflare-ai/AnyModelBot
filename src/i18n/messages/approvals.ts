// approvals：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  noSuchCode: "⚠️ 没有编号为 {code} 的待批准请求（可能已过期或已处理）",
  needCode: "有 {count} 个待批准请求，请带上编号回复，例如 y {code}",
  expiredOrDone: "⚠️ 请求 {code} 已过期或已处理",
  approved: "✅ 已批准 {code}（仅本次）",
  rejected: "❌ 已拒绝 {code}",
  prompt: "需批准: {tool}{cmd}{why} — 回复 y {code} / n {code}",
  promptWhy: "（{reason}）",
  hintMulti: "（每行回答一个问题：回复编号或直接写答案）",
  hintOptions: "（回复编号{multi}，或直接写答案）",
  hintOptionsMulti: "，可多选用逗号分隔",
  hintFree: "（直接回复答案）",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  noSuchCode: "⚠️ No request {code} is awaiting approval (it may have expired or been handled)",
  needCode: "{count} requests are awaiting approval; reply with the code, e.g. y {code}",
  expiredOrDone: "⚠️ Request {code} has expired or was already handled",
  approved: "✅ Approved {code} (this time only)",
  rejected: "❌ Denied {code}",
  prompt: "Approval needed: {tool}{cmd}{why} — reply y {code} / n {code}",
  promptWhy: " ({reason})",
  hintMulti: "(Answer one question per line: reply with an option number or type your answer)",
  hintOptions: "(Reply with an option number{multi}, or type your answer)",
  hintOptionsMulti: " or several separated by commas",
  hintFree: "(Type your answer)",
};
