/**
 * 规则（3d）的纯函数部分：状态、给人看的一行、每种模式的权限和去掉的工具。写库的是任务服务（service.ts，唯一的写入者）。
 *
 * 状态（第一条符合的为准）：暂停了（连续失败 3 次）→ 已暂停；关了 → 已关闭；一次性的跑过了 → 已结束；提醒 → 提醒；
 * 观察中（含改了原话后先观察的那一次）→ 观察中；其余 → 执行中。状态是"点 + 文字"：红 = 暂停，绿 = 执行中、提醒，灰 = 观察、关闭、结束。
 */
import type { OutboxRow, RuleMode, RuleRow, RunRow } from "../store/db.js";
import { describe } from "./schedule.js";

/** 连续失败几次自动暂停 */
export const RULE_FAILS_TO_PAUSE = 3;
/** 连续失败几次出现在「需要你」里 */
export const RULE_FAILS_TO_SHOW = 2;
/** 观察几次好的之后提示改为执行 */
export const RULE_HINT_AFTER = 3;
/** 改了原话之后先观察几次（产品负责人：1 次） */
export const RULE_OBSERVE_AFTER_EDIT = 1;
/** 每个机器人最多几条规则 */
export const MAX_RULES = 30;
/** 一次运行最长多久（不算等批准的时间） */
export const RULE_RUN_CAP_MS = 15 * 60_000;
/** 执行时的审批在「需要你」里等多久，过了就拒绝、这次运行失败 */
export const RULE_APPROVAL_TTL_MS = 3600_000;

/**
 * 规则会话去掉的工具（只去掉注册了的；插件按 tools.restrict 的规矩过滤）。观察：能改变什么的都去掉，记忆只留 recall；
 * 执行：上限是可写工作区（决定 12），电脑操作和生图、生视频不给（设计第 7 节：除非规则上开了，3d 不做这个开关）。
 */
const COMMON_DENY = ["present", "ask_user_question", "task_start", "task_message", "task_list", "rule_create", "rule_update", "generate_image", "generate_video", "media_models", "media_docs"];
export const RULE_DENY: Readonly<Record<"observe" | "act", string[]>> = {
  observe: [...COMMON_DENY, "remember", "forget"],
  act: COMMON_DENY,
};
/** 按前缀拒绝的工具（MCP 的电脑操作，名字随平台变化，没法列全） */
export const RULE_DENY_PREFIX = ["mcp__computer-use__"];

/** 这次运行用的模式：改了原话后先观察 observeLeft 次 */
export function runMode(rule: Pick<RuleRow, "mode" | "observeLeft" | "kind">): "observe" | "act" {
  if (rule.kind === "remind") return "act";
  return rule.mode === "act" && rule.observeLeft <= 0 ? "act" : "observe";
}

/** DSH 的沙箱：观察只读；执行是机器人的预设和可写工作区里取小的（完全权限的机器人也一样，决定 12） */
export function rulePermission(mode: "observe" | "act", botPreset: string): "read-only" | "workspace-write" {
  return mode === "observe" || botPreset === "readonly" ? "read-only" : "workspace-write";
}

export interface RuleState {
  key: "paused" | "off" | "done" | "remind" | "observe" | "act";
  label: string;
  /** 状态点：err 红、ok 绿、空 = 灰 */
  dot: "" | "ok" | "err";
}

export function ruleState(rule: RuleRow, live = false): RuleState {
  if (rule.pausedReason) return { key: "paused", label: "已暂停", dot: "err" };
  if (rule.mode === "off") return { key: "off", label: "已关闭", dot: "" };
  if (!live && !rule.nextRunAt && rule.trigger.kind === "schedule") return { key: "done", label: "已结束", dot: "" };
  if (rule.kind === "remind") return { key: "remind", label: "提醒", dot: "ok" };
  if (runMode(rule) === "observe") return { key: "observe", label: "观察中", dot: "" };
  return { key: "act", label: "执行中", dot: "ok" };
}

/** 规则在界面上的样子 */
export interface RuleView {
  id: string;
  botId: string;
  conversationId: string;
  channel: string;
  title: string;
  instruction: string;
  message: string;
  kind: RuleRow["kind"];
  trigger: RuleRow["trigger"];
  /** 时间表的话：每天 08:00；事件触发的是来源 */
  when: string;
  mode: RuleMode;
  /** 改了原话后还要先观察几次 */
  observeLeft: number;
  state: RuleState;
  nextRunAt: number;
  /** 最近一次：时间、结果、一行 */
  last?: { at: number; outcome: string; line: string };
  /** 已观察 3 次（这一版）、可以改为执行 */
  hint: boolean;
  /** 这一版好好观察过几次 */
  observed: number;
  failures: number;
  folder: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 正在跑（或排队）的那一次 */
  live?: { runId: string; state: string; since: number };
}

export function whenOf(rule: Pick<RuleRow, "trigger">, withZone = false): string {
  return rule.trigger.kind === "schedule" ? describe(rule.trigger.schedule, withZone) : `事件 ${rule.trigger.source}`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** 出站队列里那一条的送达状态（合进摘要的看那一条）→ 已发送 / 待发送 / 未送达 */
function sentWord(row: OutboxRow | undefined): string {
  if (!row || row.status === "sent" || row.status === "merged") return "已发送";
  if (row.status === "held" || row.status === "gone" || row.attempts >= 3) return "未送达";
  return "待发送";
}

/**
 * 运行记录的一行（设计第 6 节「Auditing a rule」）：
 * 观察：本会发送：“…” / 本会做：… / 本会保持安静；执行：已发送：“…”（待发送、未送达）/ 保持安静；提醒：已提醒：“…”；
 * 失败：…；跳过：电脑没开；中断。
 */
export function runLine(run: RunRow, kind: RuleRow["kind"], carrier?: OutboxRow): string {
  if (run.state === "queued") return "排队中";
  if (run.state !== "ended") return "正在运行";
  const r = run.report;
  const msg = oneLine(r?.message ?? "");
  const note = oneLine(r?.summary.split("\n")[0] ?? "");
  switch (run.outcome) {
    case "skipped":
      return `跳过：${run.error || "电脑没开"}`;
    case "failed":
      return `失败：${clip(oneLine(r?.message || run.error || "没有给出结果"), 120)}`;
    case "interrupted":
      return "中断：应用重启了";
    case "stopped":
      return "已停止";
    case "budget":
      return "预算用完";
    case "done":
      break;
    default:
      return run.outcome;
  }
  if (kind === "remind") return `${sentWord(carrier) === "已发送" ? "已提醒" : sentWord(carrier)}：“${clip(msg, 120)}”`;
  const would = oneLine(run.would || r?.would || "");
  if (run.mode === "observe") {
    if (msg) return `本会发送：“${clip(msg, 120)}”`;
    if (would) return `本会做：${clip(would, 120)}`;
    return note ? `本会保持安静：${clip(note, 60)}` : "本会保持安静";
  }
  if (msg) return `${sentWord(carrier)}：“${clip(msg, 120)}”`;
  return note ? `保持安静：${clip(note, 60)}` : "保持安静";
}

/** 运行记录里的一项（界面展开看报告、步骤、版本和权限） */
export interface RuleRunView {
  id: string;
  at: number;
  mode: string;
  cause: string;
  state: string;
  outcome: string;
  line: string;
  summary: string;
  message: string;
  would: string;
  error: string;
  version: number;
  /** 那次的权限：只读 / 可写工作区 */
  permission: string;
  steps: number;
  startedAt: number;
  endedAt: number;
}
