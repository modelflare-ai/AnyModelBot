/**
 * 规则（3d）的提示词：规则会话的系统提示词段（amb-tasks 插件经 /dsh/task-config 取，加在机器人段之后）、每次运行的第一条输入、
 * 没有报告时的提醒、重启后重跑的说明，以及用主模型写那一句结果的提示词。改这里的文字要过 test/prompts.unit.test.ts。
 *
 * 每次运行是一个新会话：连续性来自宿主给的最近 3 次结果和（执行时）规则的文件夹。观察时只看不动，message 只记成「本会发送」；
 * 执行时 message 会发给用户。检查用机器人的小模型跑，真要发的那一句由主模型来写（产品负责人的决定 5）。
 */

export type RuleRunMode = "observe" | "act";

/** 规则会话的系统提示词段（观察 / 执行） */
export function ruleRules(mode: RuleRunMode): string {
  const lines = [
    "# 规则（优先于上面的聊天规则）",
    "你在按用户写的一条规则做一次例行检查，用户不在旁边。规则原话和最近几次的结果在第一条消息里；当前目录是这条规则的文件夹。",
    mode === "observe"
      ? "- 这次是观察：只看、只查，不改任何东西（不写文件、不发消息、不调用会改动东西的接口）。本来要做的事写进 would。"
      : "- 只做规则里写的事。做会改变外部的事之前和之后，各在 .task/journal.md 里追加一行。",
    `- 查完调用 task_report：值得告诉用户就 state 为 done，message 是给用户的一句话（不超过 300 字${mode === "observe" ? "，这次只记下来" : "，会发给用户"}）；不值得说就 done 不带 message。查不了报 failed 和原因。然后结束这一轮。`,
    "- 不调用 task_report，这次就算失败。",
  ];
  return lines.join("\n");
}

export interface RuleBriefInput {
  title: string;
  /** 时间表的话（每天 08:00）；事件触发的是事件源 */
  when: string;
  /** 用户的原话 */
  instruction: string;
  mode: RuleRunMode;
  /** 最近几次的结果（旧→新）：时间和一句话 */
  recent: Array<{ at: string; line: string }>;
  /** 事件触发：来源和内容（JSON） */
  event?: { source: string; payload: string };
  /** 冻结的记忆快照；undefined = 关着记忆 */
  memory?: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** 每次运行的第一条输入：规则、用户原话、最近几次的结果、这次是观察还是执行 */
export function ruleBrief(o: RuleBriefInput): string {
  const parts = [`[规则]\n${o.title}（${o.when}）`, `[用户的原话]\n${o.instruction.trim()}`];
  if (o.recent.length) parts.push(`[最近几次的结果]\n${o.recent.map((r) => `- ${r.at}：${clip(r.line.replace(/\s+/g, " ").trim(), 300)}`).join("\n")}`);
  if (o.event) parts.push(`[事件]\n来源：${o.event.source}\n${clip(o.event.payload, 2000)}`);
  if (o.memory !== undefined) parts.push(`[长期记忆快照]\n${o.memory.trim() || "（目前为空）"}`);
  parts.push(o.mode === "observe" ? "[这次]\n观察：只看不动，message 只记下来，不会发给用户。" : "[这次]\n执行：message 会发给用户。");
  return parts.join("\n\n");
}

/** 一轮结束了却没有 task_report：提醒一次 */
export const RULE_NUDGE = "Report this check with task_report now: state done with a one-line message if the user should hear about it, done without a message to stay quiet, or failed with the reason if you could not check.";

/** 上一次运行被应用重启打断了，这次重跑（新会话）：重复外部动作之前先看日志 */
export const RULE_RERUN =
  "[说明]\n上一次运行被应用重启打断了，这是重跑。重复会改变外部的事之前，先看这个文件夹里的 .task/journal.md 和外部系统。";

/** 用主模型写那一句结果（检查用的是小模型）：系统提示词 */
export const RULE_RESULT_SYSTEM = [
  "你替用户的个人助手写一条主动发给用户的消息。下面是用户写的一条规则、这次检查的记录和草稿。",
  "只输出这一句话：用用户的语言，先说结果（数字、变化、要做什么），不超过 120 字；不说过程，不提规则和检查本身，不加表情符号。",
].join("\n");

/** 用主模型写那一句结果：用户消息 */
export function ruleResultInput(o: { instruction: string; summary: string; draft: string }): string {
  return `[规则]\n${o.instruction.trim()}\n\n[这次检查的记录]\n${clip(o.summary.trim(), 2000) || "（没有）"}\n\n[草稿]\n${o.draft.trim()}`;
}
