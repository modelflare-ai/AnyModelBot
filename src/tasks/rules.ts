/**
 * 规则（3d）的纯函数部分：状态、给人看的一行、每种模式的权限和去掉的工具。写库的是任务服务（service.ts，唯一的写入者）。
 *
 * 状态（第一条符合的为准）：暂停了（连续失败 3 次、本月预算用完）→ 已暂停；关了 → 已关闭；一次性的跑过了 → 已结束；提醒 → 提醒；
 * 观察中（含改了原话后先观察的那一次）→ 观察中；其余 → 执行中。状态是"点 + 文字"：红 = 连续失败暂停，黄 = 本月预算用完暂停，
 * 绿 = 执行中、提醒，灰 = 观察、关闭、结束。
 * 给人看的文字跟着语言（src/i18n 的 rules.*）；跳过、失败的原因存成代码（RUN_ERROR），显示时再翻。
 */
import type { OutboxRow, RuleMode, RuleRow, RunRow } from "../store/db.js";
import { lang as currentLang, tl, type Lang, type MessageKey } from "../i18n/index.js";
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
const COMMON_DENY = ["present", "ask_user_question", "task_start", "task_message", "task_list", "rule_create", "rule_update", "background_pause", "generate_image", "generate_video", "media_models", "media_docs"];
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
  /** 状态点：err 红、warn 黄、ok 绿、空 = 灰 */
  dot: "" | "ok" | "warn" | "err";
}

export function ruleState(rule: RuleRow, live = false, l: Lang = currentLang()): RuleState {
  const s = (key: RuleState["key"], label: MessageKey, dot: RuleState["dot"]): RuleState => ({ key, label: tl(l, label), dot });
  if (rule.pausedReason) return s("paused", "rules.statePaused", rule.pausedReason === "budget" ? "warn" : "err");
  if (rule.mode === "off") return s("off", "rules.stateOff", "");
  if (!live && !rule.nextRunAt && rule.trigger.kind === "schedule") return s("done", "rules.stateDone", "");
  if (rule.kind === "remind") return s("remind", "rules.stateRemind", "ok");
  if (runMode(rule) === "observe") return s("observe", "rules.stateObserve", "");
  return s("act", "rules.stateAct", "ok");
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
  /** 暂停的原因：failures / budget；空 = 没暂停 */
  pausedReason: string;
  /** 本月估算花了多少、每月的预算、每次的预算（美元） */
  monthUsd: number;
  monthBudgetUsd: number;
  runBudgetUsd: number;
  folder: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 正在跑（或排队）的那一次 */
  live?: { runId: string; state: string; since: number };
}

export function whenOf(rule: Pick<RuleRow, "trigger">, withZone = false, l: Lang = currentLang()): string {
  return rule.trigger.kind === "schedule" ? describe(rule.trigger.schedule, withZone, l) : tl(l, "rules.event", { source: rule.trigger.source });
}

/** 跳过、失败的原因：存进 runs.error 的代码（显示时按语言翻，见 errorText） */
export const RUN_ERROR = {
  appOff: "app_off",
  busy: "busy",
  overlap: "overlap",
  restart: "restart",
  paused: "paused",
  timeout: "timeout",
  approvalTimeout: "approval_timeout",
  noReport: "no_report",
  modelErrors: "model_errors",
  agentFailed: "agent_failed",
  agentUnavailable: "agent_unavailable",
  /** 3e：超出单次预算、本月预算用完、机器人的预算留给聊天 */
  runBudget: "run_budget",
  monthBudget: "month_budget",
  reserve: "reserve",
} as const;

/** 原因 → 词条：规则自己的，和任务共用的那几种（tasks.*，和任务失败时的说法一样） */
const WHY: Record<string, MessageKey> = {
  app_off: "rules.whyAppOff",
  busy: "rules.whyBusy",
  overlap: "rules.whyOverlap",
  restart: "rules.whyRestart",
  paused: "rules.whyPaused",
  timeout: "rules.whyTimeout",
  approval_timeout: "rules.whyApprovalTimeout",
  no_report: "tasks.noResult",
  model_errors: "tasks.modelKeptFailing",
  agent_failed: "tasks.agentDidntStart",
  agent_unavailable: "tasks.agentUnavailable",
  run_budget: "rules.whyRunBudget",
  month_budget: "rules.whyMonthBudget",
  reserve: "rules.whyReserve",
};

/** 存下来的原因给人看：认得的翻成当前语言，其余（模型自己说的）原样 */
export function errorText(error: string, l: Lang = currentLang()): string {
  const key = WHY[error];
  return key ? tl(l, key) : error;
}

/** 观察时要批准、被自动拒绝的事：在 runs.would 里一行一个，带这个前缀（显示时翻成「需要批准：…」） */
export const WOULD_APPROVAL = "approval: ";

/** runs.would 给人看：需要批准的那几行按语言翻，模型写的原样 */
export function wouldText(would: string, l: Lang = currentLang()): string {
  return would
    .split("\n")
    .map((x) => (x.startsWith(WOULD_APPROVAL) ? tl(l, "rules.needsApproval", { what: x.slice(WOULD_APPROVAL.length) }) : x))
    .join("\n");
}

/** DSH 的沙箱 → 给人看的权限 */
export function permissionText(p: string, l: Lang = currentLang()): string {
  return p === "read-only" ? tl(l, "rules.permReadOnly") : p === "workspace-write" ? tl(l, "rules.permWorkspace") : "";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** 出站队列里那一条的送达状态（合进摘要的看那一条）→ 已发送 / 待发送 / 未送达 */
function sentKey(row: OutboxRow | undefined): "rules.sent" | "rules.unsent" | "rules.pending" {
  if (!row || row.status === "sent" || row.status === "merged") return "rules.sent";
  if (row.status === "held" || row.status === "gone" || row.attempts >= 3) return "rules.unsent";
  return "rules.pending";
}

/**
 * 运行记录的一行（设计第 6 节「Auditing a rule」）：
 * 观察：本会发送：“…” / 本会做：… / 本会保持安静；执行：已发送：“…”（待发送、未送达）/ 保持安静；提醒：已提醒：“…”；
 * 失败：…；跳过：电脑没开；中断。
 */
export function runLine(run: RunRow, kind: RuleRow["kind"], carrier?: OutboxRow, l: Lang = currentLang()): string {
  if (run.state === "queued") return tl(l, "tasks.stageQueued");
  if (run.state !== "ended") return tl(l, "rules.running");
  const r = run.report;
  const msg = oneLine(r?.message ?? "");
  const note = oneLine(r?.summary.split("\n")[0] ?? "");
  switch (run.outcome) {
    case "skipped":
      return tl(l, "rules.skipped", { why: errorText(run.error || RUN_ERROR.appOff, l) });
    case "failed":
      return tl(l, "rules.failed", { why: clip(oneLine(r?.message || errorText(run.error || RUN_ERROR.noReport, l)), 120) });
    case "interrupted":
      return tl(l, "rules.interrupted");
    case "stopped":
      return tl(l, "tasks.stageStopped");
    case "budget":
      return run.error ? tl(l, "rules.budgetStopped", { why: errorText(run.error, l) }) : tl(l, "tasks.stageBudget");
    case "done":
      break;
    default:
      return run.outcome;
  }
  const text = clip(msg, 120);
  if (kind === "remind") {
    const key = sentKey(carrier);
    return tl(l, key === "rules.sent" ? "rules.reminded" : key, { text });
  }
  const would = oneLine(wouldText(run.would || r?.would || "", l));
  if (run.mode === "observe") {
    if (msg) return tl(l, "rules.wouldSend", { text });
    if (would) return tl(l, "rules.wouldDo", { text: clip(would, 120) });
    return note ? tl(l, "rules.wouldQuietNote", { note: clip(note, 60) }) : tl(l, "rules.wouldQuiet");
  }
  if (msg) return tl(l, sentKey(carrier), { text });
  return note ? tl(l, "rules.quietNote", { note: clip(note, 60) }) : tl(l, "rules.quiet");
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
  /** 估算花了多少（美元） */
  costUsd: number;
  startedAt: number;
  endedAt: number;
}
