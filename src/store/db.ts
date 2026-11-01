import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { normalizeSettings, type BotSettings } from "../agent/settings.js";
import type { Schedule } from "../tasks/schedule.js";

/**
 * SQLite 存储（node:sqlite，无原生模块，Electron 下也无需 rebuild）。
 * 敏感字段（飞书 app_secret、iLink bot_token、context_token）只存本地数据目录，文件权限 600。
 */
export interface Bot {
  id: string;
  name: string;
  systemPrompt: string;
  defaultModel: string;
  feishuAppId: string;
  feishuAppSecret: string;
  weixinEnabled: boolean;
  /** 身份与行为设置（权限预设、记忆、上下文管家） */
  settings: BotSettings;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  botId: string;
  channel: string;
  peerId: string;
  title: string;
  model: string;
  /** dm 或 group（群聊使用群记忆） */
  kind: "dm" | "group";
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: number;
  conversationId: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: number;
  /** 代理回合的活动记录有几步（内容按需用 getActivity 取） */
  steps?: number;
  /** 模型在回合中间说的话（按说的顺序），显示在 content 前面 */
  interim?: string[];
  /** 这条回复交付的文件（真实路径） */
  files?: string[];
}

/** 一条助手消息除了正文之外的东西：回合中间说的话、交付的文件 */
export interface MessageExtra {
  interim?: string[];
  files?: string[];
}

export interface WeixinAccount {
  botId: string;
  botToken: string;
  ilinkBotId: string;
  baseUrl: string;
  ownerUserId: string;
  cursor: string;
  pausedUntil: number;
  updatedAt: number;
}

export interface WeixinPeer {
  botId: string;
  userId: string;
  contextToken: string;
  quotaRemaining: number;
  windowStartedAt: number;
}

export type ApprovalStatus = "pending" | "allowed" | "rejected" | "expired" | "cancelled" | "answered";

/** 需要用户决定的请求：工具审批（approval）或 ask_user_question（question）。 */
export interface ApprovalRow {
  id: string;
  code: string;
  kind: "approval" | "question";
  botId: string;
  conversationId: string;
  sessionId: string;
  tool: string;
  detail: string;
  reason: string;
  /** question 的原始问题 JSON */
  payload: string;
  status: ApprovalStatus;
  /** question 的回答 JSON */
  result: string;
  decidedBy: string;
  createdAt: number;
  /** 0 = 不过期（后台任务的提问，等多久都行） */
  expiresAt: number;
  decidedAt: number;
  /** 后台任务的（任务会话或它的子代理里来的，或任务报的 needs_you 提问）；聊天里的是空 */
  taskId: string;
  /** 规则（3d）执行时的审批：属于哪条规则（runId 是那次运行）；只在「需要你」里，不推、不进聊天回合 */
  ruleId: string;
  runId: string;
  /** true：有一次 DSH 调用在等它（审批、聊天里的提问）；false：任务的提问，回答作为任务的新输入 */
  blocking: boolean;
}

/**
 * 谁能和机器人对话（每个机器人、每个渠道）：owner = 连上之后第一个发消息的主人（微信的主人默认是扫码登录的人，不存在这里），
 * allowed = 允许名单，pending = 等主人处理的使用请求，denied = 被拒绝（不再回复，主人可移除）。
 * peerId 是单聊会话 id（微信 = 用户 id，飞书 = 单聊 chat_id）。
 */
export type AccessStatus = "owner" | "allowed" | "pending" | "denied";
export interface AccessEntry {
  id: string;
  botId: string;
  channel: string;
  peerId: string;
  /** 平台上的发送者 id（飞书 open_id；微信同 peerId） */
  senderId: string;
  name: string;
  status: AccessStatus;
  /** 怎么来的：request（发消息申请）、first-message（第一个发消息，成了主人）、migration（升级前已在使用）、previous-owner（之前的主人）、app（在应用里添加） */
  source: string;
  /** 待处理请求的配对码（主人回复「同意 1234」）；处理后清空 */
  code: string;
  /** 第一条消息（截断），帮主人认出是谁 */
  text: string;
  requests: number;
  createdAt: number;
  updatedAt: number;
  decidedAt: number;
  decidedBy: string;
  /** 上次给这个人回"还没被允许"的时间（限频） */
  repliedAt: number;
  /** 上次把这个请求通知给主人的时间（限频） */
  notifiedAt: number;
}

/**
 * pending 等着发；scheduled 主动消息排到某个时间再发（免打扰、每天上限、合并）；held 等对方先发消息（微信）；
 * sent 发出去了；merged 合进别的一条发出去了；gone 再也发不出去
 */
export type OutboxStatus = "pending" | "scheduled" | "held" | "sent" | "merged" | "gone";
/**
 * 主动推送的用途（设计文档第 6 节）：任务结果、任务失败、规则命中、固定提醒、问题（3b）、微信续期提醒；
 * 空 = 对话里的回复、提示和系统通知（从不推迟）
 */
export type OutboxPurpose = "" | "result" | "failure" | "rule" | "reminder" | "question" | "nudge";
/** 出站消息的内容：文本（最终回复、提示、通知）、文件、带按钮的卡片（飞书审批） */
export interface OutboxBody {
  text?: string;
  /** 单独发出去时接在 text 后面的一句（任务结果的「引用这条消息可以继续问。」）；合成摘要、「你不在时」时不带 */
  hint?: string;
  /** 微信：原样发送，不过 Markdown 过滤（审批提示里的反引号要保留） */
  raw?: boolean;
  path?: string;
  name?: string;
  /** 飞书交互卡片 JSON（发不了时发 text） */
  card?: Record<string, unknown>;
  /** 飞书流式卡片：最终回复先写进这张卡片，失败再发文本 */
  cardId?: string;
  cardSeq?: number;
  /** 卡片上已经是最终全文 */
  shown?: boolean;
  /** 已经是合成的「你不在时：…」（再被留着时不再加前缀） */
  away?: boolean;
  /** 几条主动消息合成的摘要 */
  digest?: boolean;
  /** 不受免打扰和每天上限限制（任务或规则要求马上告诉用户） */
  anytime?: boolean;
}
export type OutboxKind = "text" | "file" | "card" | "notice";
/** 持久化的出站消息（见 core/outbox.ts） */
export interface OutboxRow {
  id: string;
  seq: number;
  botId: string;
  channel: string;
  /** 排序单位：同一会话按 seq 依次发送 */
  conversationId: string;
  peerId: string;
  kind: OutboxKind;
  body: OutboxBody;
  /** 飞书：回复的消息 id */
  replyTo: string;
  status: OutboxStatus;
  attempts: number;
  /** 已经发出去的分段数（长文本分多条发，崩溃后从这里接着发） */
  progress: number;
  due: number;
  /** 最近一次失败的原因；held / gone 时是留着 / 发不出去的原因 */
  error: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  sentAt: number;
  /** 主动推送的用途；空 = 回复 */
  purpose: OutboxPurpose;
  /** 推的是什么（任务标题、规则名）：摘要、续期提醒和「需要你」里用 */
  subject: string;
  /** 来自哪里：task:<id>、rule:<id> */
  ref: string;
  /** 排着 / 留着的原因：quiet_hours、daily_cap、coalesce、window_closed、quota、no_token；对方发消息时放出来的是 inbound */
  reason: string;
  /** merged：合进了哪一条 */
  mergedInto: string;
  /** 发不出去的，在「需要你」里被处理掉的时间 */
  seenAt: number;
}

/**
 * 后台任务（见 docs/design/background-tasks-and-proactive.md 第 9 节）：一个人要求的后台工作，有自己的 DSH 会话与文件夹。
 * Report 是代理经 task_report 报来的状态：message 是给用户的一句话，summary 只给内部看。
 */
export type ReportState = "progress" | "needs_you" | "done" | "failed";
export interface TaskReport {
  state: ReportState;
  summary: string;
  message?: string;
  /** 3d 规则：观察时本会做的事（执行时做了的事） */
  would?: string;
  files?: string[];
  /**
   * 3b：要问用户的一个问题。default：有合理默认的问题（用户没回答就按它做，任务不停下来等）；没有 = 非用户定不可，这一轮结束、任务等着
   */
  question?: { question: string; options?: string[]; multiSelect?: boolean; default?: string };
  at: number;
}
export interface TaskRow {
  id: string;
  botId: string;
  conversationId: string;
  /** 请求那条用户消息（messages.id） */
  originMessageId: number;
  /** 回复到哪条渠道消息（飞书 message_id）；不是密钥 */
  originRef: string;
  title: string;
  brief: string;
  sessionId: string;
  /** 相对工作区：tasks/<slug>-<id6> */
  folder: string;
  model: string;
  /** 建任务时机器人的权限预设（快照） */
  permission: string;
  /** 预算（美元，默认 1；用完时停下问「再给 $1 继续？」）与估算的已花费用（各个 run 的 cost_usd 之和） */
  budgetUsd: number;
  spentUsd: number;
  /** 最近一次 Report */
  report: TaskReport | undefined;
  endedAt: number;
  /** done | stopped | archived */
  endReason: string;
  stoppedBy: string;
  /** 结果不受免打扰和每天上限限制（用户说了做完马上告诉他） */
  anytime: boolean;
  /** 3f：文件夹定在什么时候清理（30 天没动、在「需要你」里告诉过用户之后）；0 = 没定 */
  cleanupAt: number;
  createdAt: number;
  updatedAt: number;
}
export type RunState = "queued" | "running" | "settling" | "ended";
export type RunOutcome = "" | "done" | "needs_you" | "failed" | "budget" | "stopped" | "interrupted" | "skipped";
export type RunCause = "launch" | "answer" | "followup" | "retry" | "continue" | "recover" | "schedule" | "manual" | "event";
/** 一段工作（一次启动、回答、追加、重试、恢复）：占着名额直到结束 */
export interface RunRow {
  id: string;
  botId: string;
  taskId: string;
  ruleId: string;
  ruleVersion: number;
  mode: string;
  sessionId: string;
  cause: RunCause;
  state: RunState;
  outcome: RunOutcome;
  report: TaskReport | undefined;
  would: string;
  /** ActivityStep[] JSON（最多 120 步） */
  activity: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  error: string;
  /** 结果交给出站队列 / 写进会话时的确定 id（交过就不再交） */
  delivery: string;
  /** 规则的 run 当时的沙箱：read-only / workspace-write（任务的是空的，权限记在任务上） */
  permission: string;
  /** 排队时间；规则的 run 是它该跑的时间（错过、等名额都从这里算宽限） */
  queuedAt: number;
  startedAt: number;
  endedAt: number;
}
export type InputKind = "brief" | "answer" | "followup" | "note" | "recovery" | "nudge" | "schedule";
/** 宿主欠会话的一条输入：交给 DSH 时记下收件 id（delivered），会话里出现这条用户消息时记下 taken；重启后没 taken 的再交一次 */
export interface RunInputRow {
  id: string;
  taskId: string;
  ruleId: string;
  runId: string;
  kind: InputKind;
  text: string;
  fromPerson: boolean;
  messageId: string;
  deliveredAt: number;
  takenAt: number;
  createdAt: number;
}

/**
 * 规则（设计文档第 1、4、5、9 节，3d）：用户写的一条长期指令 + 什么时候跑 + 模式。check 每次开一个新会话判断要不要说话，
 * remind 到点只发一句固定的话（不进模型）。
 * 触发是带标签的联合：schedule（宿主的定时器）或 event（事件源：以后由用户配置的 workload 接进来，见 TaskService.emitRuleEvent）。
 */
export type RuleKind = "check" | "remind";
export type RuleMode = "off" | "observe" | "act";
export type RuleTrigger = { kind: "schedule"; schedule: Schedule } | { kind: "event"; source: string; filter?: Record<string, unknown> };
export interface RuleRow {
  id: string;
  botId: string;
  /** 结果发到哪个会话（建规则的那个） */
  conversationId: string;
  title: string;
  /** 用户的原话 */
  instruction: string;
  /** remind：到点发的那句话 */
  message: string;
  kind: RuleKind;
  trigger: RuleTrigger;
  mode: RuleMode;
  /** 相对工作区：rules/<slug>-<id6> */
  folder: string;
  /** 原话每改一次加 1；每个 run 记下它跑的是哪一版 */
  version: number;
  /** 下次该跑的时间；0 = 没有（事件触发、关着、暂停了、一次性的已经跑过） */
  nextRunAt: number;
  /** 连续失败几次（成功一次清零；3 次自动暂停） */
  failures: number;
  /** 暂停的原因：failures（连续失败）、budget（本月预算用完，下个月自动恢复）；空 = 没暂停 */
  pausedReason: string;
  /** 每次运行的预算、每月的预算（美元，3e）；本月花了多少从 runs 汇总 */
  runBudgetUsd: number;
  monthBudgetUsd: number;
  /** 不受免打扰和每天上限限制（固定提醒：时间是用户定的） */
  anytime: boolean;
  createdAt: number;
  updatedAt: number;
}

type Row = Record<string, unknown>;

/** JSON 列 → 对象；坏的、空的都当没有 */
function parseJson<T>(v: unknown): T | undefined {
  if (v == null || v === "") return undefined;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return undefined;
  }
}

/** JSON 字符串数组列；坏的、空的都当空数组 */
function strings(v: unknown): string[] {
  const a = parseJson<unknown>(v);
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** 按字段名改一行：cols 是字段 → 列名，布尔值存 0/1，对象存 JSON */
function updateRow(db: DatabaseSync, table: string, cols: Record<string, string>, id: string, patch: Record<string, unknown>): void {
  const keys = Object.keys(patch).filter((k) => k in cols && patch[k] !== undefined);
  if (!keys.length) return;
  const vals = keys.map((k) => {
    const v = patch[k];
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v && typeof v === "object") return JSON.stringify(v);
    return v as string | number;
  });
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
}

const TASK_COLS: Record<string, string> = {
  originRef: "origin_ref",
  title: "title",
  sessionId: "session_id",
  model: "model",
  budgetUsd: "budget_usd",
  spentUsd: "spent_usd",
  report: "report",
  endedAt: "ended_at",
  endReason: "end_reason",
  stoppedBy: "stopped_by",
  cleanupAt: "cleanup_at",
  updatedAt: "updated_at",
};
const RUN_COLS: Record<string, string> = {
  sessionId: "session_id",
  state: "state",
  outcome: "outcome",
  report: "report",
  would: "would",
  activity: "activity",
  tokensIn: "tokens_in",
  tokensOut: "tokens_out",
  costUsd: "cost_usd",
  error: "error",
  delivery: "delivery",
  permission: "permission",
  startedAt: "started_at",
  endedAt: "ended_at",
};
const INPUT_COLS: Record<string, string> = { runId: "run_id", messageId: "message_id", deliveredAt: "delivered_at", takenAt: "taken_at" };
const RULE_COLS: Record<string, string> = {
  conversationId: "conversation_id",
  title: "title",
  instruction: "instruction",
  message: "message",
  kind: "kind",
  trigger: "trigger_spec",
  mode: "mode",
  version: "version",
  nextRunAt: "next_run_at",
  failures: "failures",
  pausedReason: "paused_reason",
  runBudgetUsd: "run_budget_usd",
  monthBudgetUsd: "month_budget_usd",
  anytime: "anytime",
  updatedAt: "updated_at",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '',
  default_model TEXT NOT NULL DEFAULT '', feishu_app_id TEXT NOT NULL DEFAULT '',
  feishu_app_secret TEXT NOT NULL DEFAULT '', weixin_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, channel TEXT NOT NULL, peer_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS conv_peer ON conversations(bot_id, channel, peer_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS msg_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS weixin_accounts (
  bot_id TEXT PRIMARY KEY, bot_token TEXT NOT NULL, ilink_bot_id TEXT NOT NULL, base_url TEXT NOT NULL,
  owner_user_id TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '', paused_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS weixin_peers (
  bot_id TEXT NOT NULL, user_id TEXT NOT NULL, context_token TEXT NOT NULL DEFAULT '',
  quota_remaining INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, user_id));
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_sessions (
  conversation_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'approval', bot_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status, expires_at);
CREATE TABLE IF NOT EXISTS agent_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, session_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', handoff TEXT NOT NULL DEFAULT '', ended_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS access (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, channel TEXT NOT NULL, peer_id TEXT NOT NULL,
  sender_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  decided_at INTEGER NOT NULL DEFAULT 0, decided_by TEXT NOT NULL DEFAULT '',
  replied_at INTEGER NOT NULL DEFAULT 0, notified_at INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS access_peer ON access(bot_id, channel, peer_id);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL, bot_id TEXT NOT NULL, channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL, peer_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
  reply_to TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, seq);
CREATE INDEX IF NOT EXISTS outbox_bot ON outbox(bot_id, status);
CREATE INDEX IF NOT EXISTS outbox_conv ON outbox(conversation_id, status);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  origin_message_id INTEGER NOT NULL DEFAULT 0, origin_ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, brief TEXT NOT NULL, session_id TEXT NOT NULL, folder TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '', permission TEXT NOT NULL, budget_usd REAL NOT NULL, spent_usd REAL NOT NULL DEFAULT 0,
  report TEXT NOT NULL DEFAULT '', ended_at INTEGER NOT NULL DEFAULT 0, end_reason TEXT NOT NULL DEFAULT '',
  stopped_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_open ON tasks(bot_id, ended_at);
CREATE INDEX IF NOT EXISTS tasks_conv ON tasks(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '', rule_id TEXT NOT NULL DEFAULT '',
  rule_version INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'act', session_id TEXT NOT NULL,
  cause TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '',
  report TEXT NOT NULL DEFAULT '', would TEXT NOT NULL DEFAULT '', activity TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '', delivery TEXT NOT NULL DEFAULT '',
  queued_at INTEGER NOT NULL, started_at INTEGER NOT NULL DEFAULT 0, ended_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS runs_live ON runs(state, queued_at);
CREATE INDEX IF NOT EXISTS runs_task ON runs(task_id, queued_at);
CREATE TABLE IF NOT EXISTS run_inputs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL DEFAULT '', rule_id TEXT NOT NULL DEFAULT '', run_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, text TEXT NOT NULL, from_person INTEGER NOT NULL DEFAULT 0,
  message_id TEXT NOT NULL DEFAULT '', delivered_at INTEGER NOT NULL DEFAULT 0, taken_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS run_inputs_open ON run_inputs(task_id, taken_at);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  title TEXT NOT NULL, instruction TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'check', trigger_spec TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'observe',
  -- observe_left（改了原话后先观察几次）2026-11-01 起不再用，列留着
  observe_left INTEGER NOT NULL DEFAULT 0, folder TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, paused_reason TEXT NOT NULL DEFAULT '',
  anytime INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rules_due ON rules(mode, next_run_at);
CREATE INDEX IF NOT EXISTS runs_rule ON runs(rule_id, queued_at);
CREATE INDEX IF NOT EXISTS run_inputs_run ON run_inputs(run_id, taken_at);
`;

/** 旧库补列（CREATE TABLE IF NOT EXISTS 不会改已有表）。 */
const COLUMNS: Array<[string, string, string]> = [
  ["bots", "settings", "TEXT NOT NULL DEFAULT '{}'"],
  ["conversations", "kind", "TEXT NOT NULL DEFAULT 'dm'"],
  // 代理回合的活动记录（JSON 数组，见 agent/activity.ts）；只在助手消息上
  ["messages", "activity", "TEXT NOT NULL DEFAULT ''"],
  // 模型在回合中间说的话、交付的文件（JSON 字符串数组）；只在助手消息上
  ["messages", "interim", "TEXT NOT NULL DEFAULT ''"],
  ["messages", "files", "TEXT NOT NULL DEFAULT ''"],
  // 主动消息的送达规则（core/delivery.ts）
  ["outbox", "purpose", "TEXT NOT NULL DEFAULT ''"],
  ["outbox", "subject", "TEXT NOT NULL DEFAULT ''"],
  ["outbox", "ref", "TEXT NOT NULL DEFAULT ''"],
  ["outbox", "reason", "TEXT NOT NULL DEFAULT ''"],
  ["outbox", "merged_into", "TEXT NOT NULL DEFAULT ''"],
  ["outbox", "seen_at", "INTEGER NOT NULL DEFAULT 0"],
  // 任务的结果不受免打扰限制（用户说了做完马上告诉他）
  ["tasks", "anytime", "INTEGER NOT NULL DEFAULT 0"],
  // 后台任务的提问与审批（3b）：属于哪个任务、哪个 run；blocking = 有 DSH 调用在等它
  ["approvals", "task_id", "TEXT NOT NULL DEFAULT ''"],
  ["approvals", "run_id", "TEXT NOT NULL DEFAULT ''"],
  ["approvals", "blocking", "INTEGER NOT NULL DEFAULT 1"],
  // 规则（3d）执行时的审批
  ["approvals", "rule_id", "TEXT NOT NULL DEFAULT ''"],
  ["runs", "permission", "TEXT NOT NULL DEFAULT ''"],
  // 规则的预算（3e）：每次运行、每月
  ["rules", "run_budget_usd", "REAL NOT NULL DEFAULT 0.1"],
  ["rules", "month_budget_usd", "REAL NOT NULL DEFAULT 3"],
  // 保留与清理（3f）：任务文件夹定在什么时候清理
  ["tasks", "cleanup_at", "INTEGER NOT NULL DEFAULT 0"],
];

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") {
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows 等平台忽略 */
      }
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    for (const [table, col, def] of COLUMNS) {
      const cols = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name));
      if (!cols.includes(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
    this.migrateComputerUseAuto();
    this.migrateAccess();
  }

  /**
   * 一次性迁移（引入允许名单时）：已经和机器人有单聊会话的人自动加入允许名单（来源 migration，可在机器人设置里移除），
   * 升级后不会被拦在外面。扫码登录的微信本来就是主人，不用加；群聊不受名单限制。
   */
  private migrateAccess(): void {
    const KEY = "migration.access-allowlist";
    if (this.getKV(KEY)) return;
    const now = Date.now();
    const rows = this.db.prepare("SELECT bot_id, channel, peer_id, title FROM conversations WHERE channel IN ('weixin', 'feishu') AND kind != 'group'").all() as Row[];
    for (const r of rows) {
      const botId = String(r.bot_id);
      const channel = String(r.channel);
      const peerId = String(r.peer_id);
      if (channel === "weixin" && this.getWeixinAccount(botId)?.ownerUserId === peerId) continue;
      this.db
        .prepare(
          `INSERT OR IGNORE INTO access(id, bot_id, channel, peer_id, sender_id, name, status, source, created_at, updated_at, decided_at, decided_by)
           VALUES(?, ?, ?, ?, ?, ?, 'allowed', 'migration', ?, ?, ?, 'migration')`,
        )
        .run(randomUUID(), botId, channel, peerId, channel === "weixin" ? peerId : "", String(r.title ?? ""), now, now, now);
    }
    this.setKV(KEY, String(now));
  }

  /** 一次性迁移：电脑操作改为默认自动执行（旧的 always / readonly-free 审批设置一律改成 auto）。 */
  private migrateComputerUseAuto(): void {
    const KEY = "migration.computer-use-auto";
    if (this.getKV(KEY)) return;
    for (const r of this.db.prepare("SELECT id, settings FROM bots").all() as Row[]) {
      let raw: any = {};
      try {
        raw = JSON.parse(String(r.settings ?? "{}"));
      } catch {
        raw = {};
      }
      if (raw && typeof raw === "object" && raw.computerUse && typeof raw.computerUse === "object") raw.computerUse.approval = "auto";
      this.db.prepare("UPDATE bots SET settings = ? WHERE id = ?").run(JSON.stringify(normalizeSettings(raw)), String(r.id));
    }
    this.setKV(KEY, String(Date.now()));
  }

  close(): void {
    this.db.close();
  }

  // ---------- kv ----------
  getKV(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }
  setKV(key: string, value: string): void {
    this.db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  deleteKV(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
  /** 以 prefix 开头的全部键值 */
  listKV(prefix: string): Array<[string, string]> {
    const rows = this.db.prepare("SELECT key, value FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key").all(prefix.length, prefix) as Row[];
    return rows.map((r) => [String(r.key), String(r.value)]);
  }

  // ---------- bots ----------
  private toBot(r: Row): Bot {
    return {
      id: String(r.id),
      name: String(r.name),
      systemPrompt: String(r.system_prompt),
      defaultModel: String(r.default_model),
      feishuAppId: String(r.feishu_app_id),
      feishuAppSecret: String(r.feishu_app_secret),
      weixinEnabled: Number(r.weixin_enabled) === 1,
      settings: parseSettings(r.settings),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  listBots(): Bot[] {
    return (this.db.prepare("SELECT * FROM bots ORDER BY created_at").all() as Row[]).map((r) => this.toBot(r));
  }
  getBot(id: string): Bot | undefined {
    const r = this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toBot(r) : undefined;
  }
  createBot(input: Partial<Bot> & { name: string }): Bot {
    const now = Date.now();
    const id = input.id || randomUUID().slice(0, 8);
    this.db
      .prepare(
        `INSERT INTO bots(id, name, system_prompt, default_model, feishu_app_id, feishu_app_secret, weixin_enabled, settings, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.systemPrompt ?? "", input.defaultModel ?? "", input.feishuAppId ?? "", input.feishuAppSecret ?? "", input.weixinEnabled ? 1 : 0, JSON.stringify(normalizeSettings(input.settings)), now, now);
    return this.getBot(id)!;
  }
  updateBot(id: string, patch: Partial<Omit<Bot, "id" | "createdAt" | "updatedAt">>): Bot | undefined {
    const cur = this.getBot(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE bots SET name=?, system_prompt=?, default_model=?, feishu_app_id=?, feishu_app_secret=?, weixin_enabled=?, settings=?, updated_at=? WHERE id=?`,
      )
      .run(next.name, next.systemPrompt, next.defaultModel, next.feishuAppId, next.feishuAppSecret, next.weixinEnabled ? 1 : 0, JSON.stringify(normalizeSettings(next.settings)), Date.now(), id);
    return this.getBot(id);
  }
  deleteBot(id: string): void {
    const convs = this.db.prepare("SELECT id FROM conversations WHERE bot_id = ?").all(id) as Row[];
    for (const c of convs) this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(String(c.id));
    this.db.prepare("DELETE FROM agent_segments WHERE conversation_id IN (SELECT id FROM conversations WHERE bot_id = ?)").run(id);
    this.db.prepare("DELETE FROM conversations WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM weixin_accounts WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM weixin_peers WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM agent_sessions WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM access WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM outbox WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM run_inputs WHERE task_id IN (SELECT id FROM tasks WHERE bot_id = ?)").run(id);
    this.db.prepare("DELETE FROM run_inputs WHERE rule_id IN (SELECT id FROM rules WHERE bot_id = ?)").run(id);
    this.db.prepare("DELETE FROM runs WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM rules WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
  }

  // ---------- conversations ----------
  private toConv(r: Row): Conversation {
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      channel: String(r.channel),
      peerId: String(r.peer_id),
      title: String(r.title),
      model: String(r.model),
      kind: String(r.kind ?? "dm") === "group" ? "group" : "dm",
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  ensureConversation(botId: string, channel: string, peerId: string, title = "", kind: "dm" | "group" = "dm"): Conversation {
    const r = this.db
      .prepare("SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND peer_id = ?")
      .get(botId, channel, peerId) as Row | undefined;
    if (r) {
      if (kind === "group" && String(r.kind) !== "group") this.db.prepare("UPDATE conversations SET kind = 'group' WHERE id = ?").run(String(r.id));
      return this.toConv({ ...r, kind: kind === "group" ? "group" : r.kind });
    }
    const now = Date.now();
    const id = `${botId}:${channel}:${peerId}`;
    this.db
      .prepare("INSERT INTO conversations(id, bot_id, channel, peer_id, title, model, kind, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '', ?, ?, ?)")
      .run(id, botId, channel, peerId, title, kind, now, now);
    return this.getConversation(id)!;
  }
  getConversation(id: string): Conversation | undefined {
    const r = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toConv(r) : undefined;
  }
  listConversations(botId?: string): Array<Conversation & { messageCount: number; lastMessage: string }> {
    const sql = `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n,
      (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last
      FROM conversations c ${botId ? "WHERE c.bot_id = ?" : ""} ORDER BY c.updated_at DESC LIMIT 200`;
    const rows = (botId ? this.db.prepare(sql).all(botId) : this.db.prepare(sql).all()) as Row[];
    return rows.map((r) => ({ ...this.toConv(r), messageCount: Number(r.n), lastMessage: r.last == null ? "" : String(r.last).slice(0, 120) }));
  }
  setConversationModel(id: string, model: string): void {
    this.db.prepare("UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?").run(model, Date.now(), id);
  }

  // ---------- messages ----------
  addMessage(conversationId: string, role: Message["role"], content: string, activity?: unknown[], extra: MessageExtra = {}): number {
    const now = Date.now();
    const json = (a: unknown[] | undefined) => (a?.length ? JSON.stringify(a) : "");
    const res = this.db
      .prepare("INSERT INTO messages(conversation_id, role, content, created_at, activity, interim, files) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .run(conversationId, role, content, now, json(activity), json(extra.interim), json(extra.files));
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return Number(res.lastInsertRowid);
  }
  /** 这个会话里用户最近一次发消息的时间（没有返回 0） */
  lastUserMessageAt(conversationId: string): number {
    const r = this.db.prepare("SELECT MAX(created_at) AS at FROM messages WHERE conversation_id = ? AND role = 'user'").get(conversationId) as Row;
    return Number(r?.at ?? 0) || 0;
  }
  /** 一条消息（任务详情里的「来自」：请求那条用户消息） */
  getMessage(id: number): Message | undefined {
    const r = this.db.prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE id = ?").get(id) as Row | undefined;
    return r ? { id: Number(r.id), conversationId: String(r.conversation_id), role: String(r.role) as Message["role"], content: String(r.content), createdAt: Number(r.created_at) } : undefined;
  }
  listMessages(conversationId: string, limit = 500): Message[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM (SELECT id, conversation_id, role, content, created_at, interim, files, CASE WHEN json_valid(activity) THEN json_array_length(activity) ELSE 0 END AS steps FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
      )
      .all(conversationId, limit) as Row[];
    return rows.map((r) => {
      const interim = strings(r.interim);
      const files = strings(r.files);
      return {
        id: Number(r.id),
        conversationId: String(r.conversation_id),
        role: String(r.role) as Message["role"],
        content: String(r.content),
        createdAt: Number(r.created_at),
        ...(Number(r.steps) ? { steps: Number(r.steps) } : {}),
        ...(interim.length ? { interim } : {}),
        ...(files.length ? { files } : {}),
      };
    });
  }
  /** 这个会话里交付过的文件（真实路径，旧→新，去重） */
  deliveredFiles(conversationId: string): string[] {
    const rows = this.db.prepare("SELECT files FROM messages WHERE conversation_id = ? AND files != '' ORDER BY id").all(conversationId) as Row[];
    return [...new Set(rows.flatMap((r) => strings(r.files)))];
  }
  /** 一条消息的活动记录（没有则为空数组） */
  getActivity(conversationId: string, messageId: number): unknown[] {
    const r = this.db.prepare("SELECT activity FROM messages WHERE id = ? AND conversation_id = ?").get(messageId, conversationId) as Row | undefined;
    try {
      return r?.activity ? (JSON.parse(String(r.activity)) as unknown[]) : [];
    } catch {
      return [];
    }
  }
  clearMessages(conversationId: string): void {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  }

  /**
   * 滑动窗口上下文：从最新往回取，直到条数或字符数超限；保证以 user 消息开头。
   */
  contextWindow(conversationId: string, maxMessages: number, maxChars: number): Array<Pick<Message, "role" | "content">> {
    const recent = this.listMessages(conversationId, maxMessages);
    const picked: Array<Pick<Message, "role" | "content">> = [];
    let chars = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const m = recent[i];
      if (picked.length > 0 && chars + m.content.length > maxChars) break;
      chars += m.content.length;
      picked.unshift({ role: m.role, content: m.content });
    }
    while (picked.length > 1 && picked[0].role !== "user") picked.shift();
    return picked;
  }

  // ---------- weixin ----------
  getWeixinAccount(botId: string): WeixinAccount | undefined {
    const r = this.db.prepare("SELECT * FROM weixin_accounts WHERE bot_id = ?").get(botId) as Row | undefined;
    if (!r) return undefined;
    return {
      botId: String(r.bot_id),
      botToken: String(r.bot_token),
      ilinkBotId: String(r.ilink_bot_id),
      baseUrl: String(r.base_url),
      ownerUserId: String(r.owner_user_id),
      cursor: String(r.cursor),
      pausedUntil: Number(r.paused_until),
      updatedAt: Number(r.updated_at),
    };
  }
  saveWeixinAccount(a: Omit<WeixinAccount, "cursor" | "pausedUntil" | "updatedAt">): void {
    this.db
      .prepare(
        `INSERT INTO weixin_accounts(bot_id, bot_token, ilink_bot_id, base_url, owner_user_id, cursor, paused_until, updated_at)
         VALUES(?, ?, ?, ?, ?, '', 0, ?)
         ON CONFLICT(bot_id) DO UPDATE SET bot_token=excluded.bot_token, ilink_bot_id=excluded.ilink_bot_id,
           base_url=excluded.base_url, owner_user_id=excluded.owner_user_id, cursor='', paused_until=0, updated_at=excluded.updated_at`,
      )
      .run(a.botId, a.botToken, a.ilinkBotId, a.baseUrl, a.ownerUserId, Date.now());
  }
  setWeixinCursor(botId: string, cursor: string): void {
    this.db.prepare("UPDATE weixin_accounts SET cursor = ?, updated_at = ? WHERE bot_id = ?").run(cursor, Date.now(), botId);
  }
  setWeixinPaused(botId: string, until: number): void {
    this.db.prepare("UPDATE weixin_accounts SET paused_until = ?, updated_at = ? WHERE bot_id = ?").run(until, Date.now(), botId);
  }
  deleteWeixinAccount(botId: string): void {
    this.db.prepare("DELETE FROM weixin_accounts WHERE bot_id = ?").run(botId);
    this.db.prepare("DELETE FROM weixin_peers WHERE bot_id = ?").run(botId);
  }
  getWeixinPeer(botId: string, userId: string): WeixinPeer | undefined {
    const r = this.db.prepare("SELECT * FROM weixin_peers WHERE bot_id = ? AND user_id = ?").get(botId, userId) as Row | undefined;
    if (!r) return undefined;
    return {
      botId: String(r.bot_id),
      userId: String(r.user_id),
      contextToken: String(r.context_token),
      quotaRemaining: Number(r.quota_remaining),
      windowStartedAt: Number(r.window_started_at),
    };
  }
  listWeixinPeers(botId: string): WeixinPeer[] {
    return (this.db.prepare("SELECT user_id FROM weixin_peers WHERE bot_id = ?").all(botId) as Row[]).map(
      (r) => this.getWeixinPeer(botId, String(r.user_id))!,
    );
  }
  upsertWeixinPeer(p: WeixinPeer): void {
    this.db
      .prepare(
        `INSERT INTO weixin_peers(bot_id, user_id, context_token, quota_remaining, window_started_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, user_id) DO UPDATE SET context_token=excluded.context_token,
           quota_remaining=excluded.quota_remaining, window_started_at=excluded.window_started_at`,
      )
      .run(p.botId, p.userId, p.contextToken, p.quotaRemaining, p.windowStartedAt);
  }

  // ---------- agent sessions（会话 ↔ DSH session） ----------
  getAgentSession(conversationId: string): string | undefined {
    const r = this.db.prepare("SELECT session_id FROM agent_sessions WHERE conversation_id = ?").get(conversationId) as Row | undefined;
    return r ? String(r.session_id) : undefined;
  }
  setAgentSession(conversationId: string, botId: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_sessions(conversation_id, bot_id, session_id, updated_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at`,
      )
      .run(conversationId, botId, sessionId, Date.now());
  }
  clearAgentSession(conversationId: string): void {
    this.db.prepare("DELETE FROM agent_sessions WHERE conversation_id = ?").run(conversationId);
  }
  /** 段落归档：上下文管家换段时记下旧 session 与交接便条。 */
  archiveSegment(conversationId: string, sessionId: string, reason: string, handoff: string): void {
    this.db
      .prepare("INSERT INTO agent_segments(conversation_id, session_id, reason, handoff, ended_at) VALUES(?, ?, ?, ?, ?)")
      .run(conversationId, sessionId, reason, handoff, Date.now());
  }
  listSegments(conversationId: string): Array<{ sessionId: string; reason: string; handoff: string; endedAt: number }> {
    return (this.db.prepare("SELECT * FROM agent_segments WHERE conversation_id = ? ORDER BY id").all(conversationId) as Row[]).map((r) => ({
      sessionId: String(r.session_id),
      reason: String(r.reason),
      handoff: String(r.handoff),
      endedAt: Number(r.ended_at),
    }));
  }
  /** 消息 id 大于 afterId 的消息（旧→新） */
  messagesAfter(conversationId: string, afterId: number, limit = 60): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT ?")
      .all(conversationId, afterId, limit) as Row[];
    return rows.reverse().map((r) => ({ id: Number(r.id), conversationId: String(r.conversation_id), role: String(r.role) as Message["role"], content: String(r.content), createdAt: Number(r.created_at) }));
  }

  conversationForSession(sessionId: string): string | undefined {
    const r = this.db.prepare("SELECT conversation_id FROM agent_sessions WHERE session_id = ?").get(sessionId) as Row | undefined;
    return r ? String(r.conversation_id) : undefined;
  }

  // ---------- approvals ----------
  private toApproval(r: Row): ApprovalRow {
    return {
      id: String(r.id),
      code: String(r.code),
      kind: String(r.kind) as ApprovalRow["kind"],
      botId: String(r.bot_id),
      conversationId: String(r.conversation_id),
      sessionId: String(r.session_id),
      tool: String(r.tool),
      detail: String(r.detail),
      reason: String(r.reason),
      payload: String(r.payload),
      status: String(r.status) as ApprovalStatus,
      result: String(r.result),
      decidedBy: String(r.decided_by),
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      decidedAt: Number(r.decided_at),
      taskId: String(r.task_id ?? ""),
      ruleId: String(r.rule_id ?? ""),
      runId: String(r.run_id ?? ""),
      blocking: Number(r.blocking ?? 1) !== 0,
    };
  }
  insertApproval(a: Omit<ApprovalRow, "status" | "result" | "decidedBy" | "decidedAt" | "taskId" | "ruleId" | "runId" | "blocking"> & Partial<Pick<ApprovalRow, "taskId" | "ruleId" | "runId" | "blocking">>): ApprovalRow {
    this.db
      .prepare(
        `INSERT INTO approvals(id, code, kind, bot_id, conversation_id, session_id, tool, detail, reason, payload, status, created_at, expires_at, task_id, rule_id, run_id, blocking)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.code, a.kind, a.botId, a.conversationId, a.sessionId, a.tool, a.detail, a.reason, a.payload, a.createdAt, a.expiresAt, a.taskId ?? "", a.ruleId ?? "", a.runId ?? "", a.blocking === false ? 0 : 1);
    return this.getApproval(a.id)!;
  }
  getApproval(id: string): ApprovalRow | undefined {
    const r = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toApproval(r) : undefined;
  }
  pendingApprovalByCode(code: string): ApprovalRow | undefined {
    const r = this.db.prepare("SELECT * FROM approvals WHERE code = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(code) as Row | undefined;
    return r ? this.toApproval(r) : undefined;
  }
  listApprovals(opts: { status?: ApprovalStatus; botId?: string; conversationId?: string; taskId?: string; ruleId?: string; runId?: string; limit?: number } = {}): ApprovalRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.conversationId) (where.push("conversation_id = ?"), args.push(opts.conversationId));
    if (opts.taskId) (where.push("task_id = ?"), args.push(opts.taskId));
    if (opts.ruleId) (where.push("rule_id = ?"), args.push(opts.ruleId));
    if (opts.runId) (where.push("run_id = ?"), args.push(opts.runId));
    const sql = `SELECT * FROM approvals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 100))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toApproval(r));
  }
  /** 只在 pending 时生效，返回是否更新成功（防止重复决定）。 */
  decideApproval(id: string, status: Exclude<ApprovalStatus, "pending">, decidedBy: string, result = "", at = Date.now()): boolean {
    const res = this.db
      .prepare("UPDATE approvals SET status = ?, decided_by = ?, result = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, decidedBy, result, at, id);
    return Number(res.changes) > 0;
  }

  // ---------- access（允许名单与使用请求） ----------
  private toAccess(r: Row): AccessEntry {
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      channel: String(r.channel),
      peerId: String(r.peer_id),
      senderId: String(r.sender_id),
      name: String(r.name),
      status: String(r.status) as AccessStatus,
      source: String(r.source),
      code: String(r.code),
      text: String(r.text),
      requests: Number(r.requests),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      decidedAt: Number(r.decided_at),
      decidedBy: String(r.decided_by),
      repliedAt: Number(r.replied_at),
      notifiedAt: Number(r.notified_at),
    };
  }
  getAccess(botId: string, channel: string, peerId: string): AccessEntry | undefined {
    const r = this.db.prepare("SELECT * FROM access WHERE bot_id = ? AND channel = ? AND peer_id = ?").get(botId, channel, peerId) as Row | undefined;
    return r ? this.toAccess(r) : undefined;
  }
  getAccessById(id: string): AccessEntry | undefined {
    const r = this.db.prepare("SELECT * FROM access WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toAccess(r) : undefined;
  }
  listAccess(opts: { botId?: string; channel?: string; status?: AccessStatus } = {}): AccessEntry[] {
    const where: string[] = [];
    const args: string[] = [];
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.channel) (where.push("channel = ?"), args.push(opts.channel));
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    const sql = `SELECT * FROM access ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 500`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toAccess(r));
  }
  /** 新建；同一机器人、渠道、会话已有一条时只改状态和来源 */
  putAccess(e: AccessEntry): AccessEntry {
    this.db
      .prepare(
        `INSERT INTO access(id, bot_id, channel, peer_id, sender_id, name, status, source, code, text, requests, created_at, updated_at, decided_at, decided_by, replied_at, notified_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, channel, peer_id) DO UPDATE SET status=excluded.status, source=excluded.source, code=excluded.code,
           updated_at=excluded.updated_at, decided_at=excluded.decided_at, decided_by=excluded.decided_by`,
      )
      .run(e.id, e.botId, e.channel, e.peerId, e.senderId, e.name, e.status, e.source, e.code, e.text, e.requests, e.createdAt, e.updatedAt, e.decidedAt, e.decidedBy, e.repliedAt, e.notifiedAt);
    return this.getAccess(e.botId, e.channel, e.peerId)!;
  }
  updateAccess(id: string, patch: Partial<Pick<AccessEntry, "status" | "source" | "code" | "requests" | "updatedAt" | "decidedAt" | "decidedBy" | "repliedAt" | "notifiedAt">>): void {
    const cols: Record<string, string> = { status: "status", source: "source", code: "code", requests: "requests", updatedAt: "updated_at", decidedAt: "decided_at", decidedBy: "decided_by", repliedAt: "replied_at", notifiedAt: "notified_at" };
    const keys = (Object.keys(patch) as Array<keyof typeof patch>).filter((k) => k in cols);
    if (!keys.length) return;
    this.db.prepare(`UPDATE access SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number), id);
  }
  deleteAccess(id: string): void {
    this.db.prepare("DELETE FROM access WHERE id = ?").run(id);
  }
  pendingAccessByCode(botId: string, code: string): AccessEntry | undefined {
    const r = this.db.prepare("SELECT * FROM access WHERE bot_id = ? AND code = ? AND status = 'pending' LIMIT 1").get(botId, code) as Row | undefined;
    return r ? this.toAccess(r) : undefined;
  }
  /** 待处理请求占用的配对码（与审批码同是 4 位数字，不能撞） */
  pendingAccessCodes(): string[] {
    return (this.db.prepare("SELECT code FROM access WHERE status = 'pending' AND code != ''").all() as Row[]).map((r) => String(r.code));
  }
  /** since 之后通知过主人的请求数（限频） */
  accessNotifiedSince(botId: string, since: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM access WHERE bot_id = ? AND notified_at > 0 AND notified_at > ?").get(botId, since) as Row;
    return Number(r.n);
  }

  // ---------- outbox（持久化的出站消息，见 core/outbox.ts） ----------
  private toOutbox(r: Row): OutboxRow {
    let body: OutboxBody = {};
    try {
      body = JSON.parse(String(r.body)) as OutboxBody;
    } catch {
      body = {};
    }
    return {
      id: String(r.id),
      seq: Number(r.seq),
      botId: String(r.bot_id),
      channel: String(r.channel),
      conversationId: String(r.conversation_id),
      peerId: String(r.peer_id),
      kind: String(r.kind) as OutboxKind,
      body,
      replyTo: String(r.reply_to),
      status: String(r.status) as OutboxStatus,
      attempts: Number(r.attempts),
      progress: Number(r.progress),
      due: Number(r.due),
      error: String(r.error),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      expiresAt: Number(r.expires_at),
      sentAt: Number(r.sent_at),
      purpose: String(r.purpose ?? "") as OutboxPurpose,
      subject: String(r.subject ?? ""),
      ref: String(r.ref ?? ""),
      reason: String(r.reason ?? ""),
      mergedInto: String(r.merged_into ?? ""),
      seenAt: Number(r.seen_at ?? 0),
    };
  }
  /** 同一 id 只写一次；返回是否是新写入的 */
  insertOutbox(
    o: Pick<OutboxRow, "id" | "botId" | "channel" | "conversationId" | "peerId" | "kind" | "body" | "replyTo" | "due" | "createdAt" | "expiresAt"> &
      Partial<Pick<OutboxRow, "status" | "purpose" | "subject" | "ref" | "reason">>,
  ): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox(id, seq, bot_id, channel, conversation_id, peer_id, kind, body, reply_to, due, created_at, updated_at, expires_at, status, purpose, subject, ref, reason)
         VALUES(?, (SELECT IFNULL(MAX(seq), 0) + 1 FROM outbox), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.id, o.botId, o.channel, o.conversationId, o.peerId, o.kind, JSON.stringify(o.body), o.replyTo, o.due, o.createdAt, o.createdAt, o.expiresAt,
        o.status ?? "pending", o.purpose ?? "", o.subject ?? "", o.ref ?? "", o.reason ?? "",
      );
    return Number(res.changes) > 0;
  }
  getOutbox(id: string): OutboxRow | undefined {
    const r = this.db.prepare("SELECT * FROM outbox WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toOutbox(r) : undefined;
  }
  /** 还没发出去的，按写入顺序 */
  pendingOutbox(limit = 1000): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?").all(limit) as Row[]).map((r) => this.toOutbox(r));
  }
  updateOutbox(
    id: string,
    patch: Partial<Pick<OutboxRow, "status" | "attempts" | "progress" | "due" | "error" | "sentAt" | "expiresAt" | "body" | "kind" | "replyTo" | "reason" | "mergedInto" | "seenAt">>,
    now = Date.now(),
  ): void {
    const cols: Record<string, string> = {
      status: "status", attempts: "attempts", progress: "progress", due: "due", error: "error", sentAt: "sent_at", expiresAt: "expires_at", body: "body",
      kind: "kind", replyTo: "reply_to", reason: "reason", mergedInto: "merged_into", seenAt: "seen_at",
    };
    const keys = (Object.keys(patch) as Array<keyof typeof patch>).filter((k) => k in cols);
    if (!keys.length) return;
    const vals = keys.map((k) => (k === "body" ? JSON.stringify(patch.body) : (patch[k] as string | number)));
    this.db.prepare(`UPDATE outbox SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now, id);
  }
  listOutbox(opts: { botId?: string; status?: OutboxStatus; since?: number; limit?: number } = {}): OutboxRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    if (opts.since) (where.push("updated_at >= ?"), args.push(opts.since));
    const sql = `SELECT * FROM outbox ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq DESC LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 100))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 机器人在这个会话里最近发（或要发）的一条消息（合并掉的、放弃了的不算）：微信里光回编号算不算回答提问，看它 */
  lastOutbox(conversationId: string): OutboxRow | undefined {
    const r = this.db.prepare("SELECT * FROM outbox WHERE conversation_id = ? AND status IN ('pending', 'held', 'sent') ORDER BY seq DESC LIMIT 1").get(conversationId) as Row | undefined;
    return r ? this.toOutbox(r) : undefined;
  }
  /** 留着等这个会话的对方发消息的，按写入顺序 */
  heldOutbox(conversationId: string): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE conversation_id = ? AND status = 'held' ORDER BY seq").all(conversationId) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 这个会话还没发出去、在等的：留着的（等对方发消息）和排着的（主动消息等时间），按写入顺序 */
  waitingOutbox(conversationId: string): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE conversation_id = ? AND status IN ('held', 'scheduled') ORDER BY seq").all(conversationId) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 排着的主动消息里到时间了的，按写入顺序 */
  dueScheduledOutbox(now: number): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE status = 'scheduled' AND due <= ? ORDER BY seq").all(now) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 排着的主动消息里最早的时间（没有返回 0） */
  nextScheduledDue(): number {
    const r = this.db.prepare("SELECT MIN(due) AS due FROM outbox WHERE status = 'scheduled'").get() as Row;
    return Number(r?.due ?? 0) || 0;
  }
  /** 这个会话排着的主动消息（不含文件），按时间 */
  scheduledPushes(conversationId: string): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE conversation_id = ? AND status = 'scheduled' AND kind != 'file' AND purpose NOT IN ('', 'nudge') ORDER BY due, seq").all(conversationId) as Row[]).map((r) =>
      this.toOutbox(r),
    );
  }
  /**
   * 这个会话在 [since, until) 里推送出去（或正要推送、留着）的主动消息条数：一条摘要算一条，文件、续期提醒、
   * 对方发消息时一起放出来的不算（每天上限）
   */
  countPushes(conversationId: string, since: number, until: number): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM outbox WHERE conversation_id = ? AND status IN ('pending', 'sent', 'held') AND kind != 'file'
         AND purpose NOT IN ('', 'nudge') AND reason != 'inbound' AND due >= ? AND due < ?`,
      )
      .get(conversationId, since, until) as Row;
    return Number(r.n);
  }
  /** 这个会话最近一次推送主动消息的时间（合并窗口；没有返回 0） */
  lastPushAt(conversationId: string): number {
    const r = this.db
      .prepare("SELECT MAX(due) AS due FROM outbox WHERE conversation_id = ? AND status IN ('pending', 'sent', 'held') AND kind != 'file' AND purpose NOT IN ('', 'nudge')")
      .get(conversationId) as Row;
    return Number(r?.due ?? 0) || 0;
  }
  /** 这个会话最近发出去的一条 */
  lastSentOutbox(conversationId: string): OutboxRow | undefined {
    const r = this.db.prepare("SELECT * FROM outbox WHERE conversation_id = ? AND status = 'sent' ORDER BY seq DESC LIMIT 1").get(conversationId) as Row | undefined;
    return r ? this.toOutbox(r) : undefined;
  }
  /** 合进这一条的那几条 */
  mergedOutbox(id: string): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE merged_into = ? ORDER BY seq").all(id) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 一条消息实际的去向：合进别的一条的，看那一条 */
  carrierOutbox(id: string): OutboxRow | undefined {
    let row = this.getOutbox(id);
    for (let i = 0; row && row.status === "merged" && row.mergedInto && i < 8; i++) row = this.getOutbox(row.mergedInto);
    return row;
  }
  /** 没送到、要人管的：留着的、一直失败的（试了 minAttempts 次还在试）、放弃了还没处理掉的（since 之后） */
  undeliveredOutbox(o: { botId?: string; minAttempts: number; since: number }): OutboxRow[] {
    const where = ["(status = 'held' OR (status = 'pending' AND attempts >= ?) OR (status = 'gone' AND seen_at = 0 AND updated_at >= ?))", "purpose != 'nudge'"];
    const args: Array<string | number> = [o.minAttempts, o.since];
    if (o.botId) (where.push("bot_id = ?"), args.push(o.botId));
    return (this.db.prepare(`SELECT * FROM outbox WHERE ${where.join(" AND ")} ORDER BY seq`).all(...args) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 启动时：等着退避重试的马上再试一次 */
  resumeOutbox(now = Date.now()): number {
    return Number(this.db.prepare("UPDATE outbox SET due = ? WHERE status = 'pending' AND due > ?").run(now, now).changes);
  }
  /** 清理：发出去的（含合进别的一条发的）留 7 天（这期间同一 id 不会再发），发不出去的留 30 天 */
  pruneOutbox(now = Date.now()): void {
    this.db.prepare("DELETE FROM outbox WHERE (status IN ('sent', 'merged') AND updated_at < ?) OR (status = 'gone' AND updated_at < ?)").run(now - 7 * 86400_000, now - 30 * 86400_000);
  }

  // ---------- 后台任务（tasks / runs / run_inputs，只由 TaskService 写，见 tasks/service.ts） ----------
  private toTask(r: Row): TaskRow {
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      conversationId: String(r.conversation_id),
      originMessageId: Number(r.origin_message_id),
      originRef: String(r.origin_ref),
      title: String(r.title),
      brief: String(r.brief),
      sessionId: String(r.session_id),
      folder: String(r.folder),
      model: String(r.model),
      permission: String(r.permission),
      budgetUsd: Number(r.budget_usd),
      spentUsd: Number(r.spent_usd),
      report: parseJson<TaskReport>(r.report),
      endedAt: Number(r.ended_at),
      endReason: String(r.end_reason),
      stoppedBy: String(r.stopped_by),
      anytime: Number(r.anytime ?? 0) === 1,
      cleanupAt: Number(r.cleanup_at ?? 0),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  insertTask(t: Omit<TaskRow, "spentUsd" | "report" | "endedAt" | "endReason" | "stoppedBy" | "anytime" | "cleanupAt"> & { anytime?: boolean }): TaskRow {
    this.db
      .prepare(
        `INSERT INTO tasks(id, bot_id, conversation_id, origin_message_id, origin_ref, title, brief, session_id, folder, model, permission, budget_usd, anytime, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.id, t.botId, t.conversationId, t.originMessageId, t.originRef, t.title, t.brief, t.sessionId, t.folder, t.model, t.permission, t.budgetUsd, t.anytime ? 1 : 0, t.createdAt, t.updatedAt);
    return this.getTask(t.id)!;
  }
  getTask(id: string): TaskRow | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toTask(r) : undefined;
  }
  /** 任务会话（task-…）属于哪个任务 */
  taskBySession(sessionId: string): TaskRow | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE session_id = ?").get(sessionId) as Row | undefined;
    return r ? this.toTask(r) : undefined;
  }
  updateTask(id: string, patch: Partial<Pick<TaskRow, "originRef" | "title" | "sessionId" | "model" | "budgetUsd" | "spentUsd" | "report" | "endedAt" | "endReason" | "stoppedBy" | "cleanupAt" | "updatedAt">>): void {
    updateRow(this.db, "tasks", TASK_COLS, id, patch);
  }
  /** 任务又花了一点（每次模型请求的估算加上去） */
  addTaskSpent(id: string, usd: number): void {
    if (usd > 0) this.db.prepare("UPDATE tasks SET spent_usd = spent_usd + ? WHERE id = ?").run(usd, id);
  }
  /** open：还没结束（停止、归档）的；since：之后更新过的；归档了的（3f：30 天没动）不列，除非 archived */
  listTasks(opts: { botId?: string; conversationId?: string; open?: boolean; since?: number; limit?: number; archived?: boolean } = {}): TaskRow[] {
    const where: string[] = opts.archived ? [] : ["end_reason != 'archived'"];
    const args: Array<string | number> = [];
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.conversationId) (where.push("conversation_id = ?"), args.push(opts.conversationId));
    if (opts.open !== undefined) where.push(opts.open ? "ended_at = 0" : "ended_at > 0");
    if (opts.since) (where.push("updated_at >= ?"), args.push(opts.since));
    const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 100))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toTask(r));
  }

  private toRun(r: Row): RunRow {
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      taskId: String(r.task_id),
      ruleId: String(r.rule_id),
      ruleVersion: Number(r.rule_version),
      mode: String(r.mode),
      sessionId: String(r.session_id),
      cause: String(r.cause) as RunCause,
      state: String(r.state) as RunState,
      outcome: String(r.outcome) as RunOutcome,
      report: parseJson<TaskReport>(r.report),
      would: String(r.would),
      activity: String(r.activity),
      tokensIn: Number(r.tokens_in),
      tokensOut: Number(r.tokens_out),
      costUsd: Number(r.cost_usd),
      error: String(r.error),
      delivery: String(r.delivery),
      permission: String(r.permission ?? ""),
      queuedAt: Number(r.queued_at),
      startedAt: Number(r.started_at),
      endedAt: Number(r.ended_at),
    };
  }
  insertRun(r: Pick<RunRow, "id" | "botId" | "taskId" | "sessionId" | "cause" | "queuedAt"> & Partial<Pick<RunRow, "ruleId" | "ruleVersion" | "mode">>): RunRow {
    this.db
      .prepare("INSERT INTO runs(id, bot_id, task_id, rule_id, rule_version, mode, session_id, cause, state, queued_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)")
      .run(r.id, r.botId, r.taskId, r.ruleId ?? "", r.ruleVersion ?? 0, r.mode ?? "act", r.sessionId, r.cause, r.queuedAt);
    return this.getRun(r.id)!;
  }
  /** 规则的一条运行记录，直接以结束的状态写进去（跳过：电脑没开、一直在忙、上次还没跑完） */
  insertEndedRun(r: Pick<RunRow, "id" | "botId" | "ruleId" | "ruleVersion" | "mode" | "cause" | "outcome" | "error" | "queuedAt" | "endedAt">): RunRow {
    this.db
      .prepare("INSERT INTO runs(id, bot_id, rule_id, rule_version, mode, session_id, cause, state, outcome, error, queued_at, ended_at) VALUES(?, ?, ?, ?, ?, '', ?, 'ended', ?, ?, ?, ?)")
      .run(r.id, r.botId, r.ruleId, r.ruleVersion, r.mode, r.cause, r.outcome, r.error, r.queuedAt, r.endedAt);
    return this.getRun(r.id)!;
  }
  getRun(id: string): RunRow | undefined {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toRun(r) : undefined;
  }
  updateRun(id: string, patch: Partial<Pick<RunRow, "sessionId" | "state" | "outcome" | "report" | "would" | "activity" | "tokensIn" | "tokensOut" | "costUsd" | "error" | "delivery" | "permission" | "startedAt" | "endedAt">>): void {
    updateRow(this.db, "runs", RUN_COLS, id, patch);
  }
  /** 一个任务（或规则）的 runs（旧→新）；不含活动记录（大） */
  listRuns(opts: { taskId?: string; ruleId?: string; botId?: string; states?: RunState[]; limit?: number } = {}): RunRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.taskId) (where.push("task_id = ?"), args.push(opts.taskId));
    if (opts.ruleId) (where.push("rule_id = ?"), args.push(opts.ruleId));
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.states?.length) (where.push(`state IN (${opts.states.map(() => "?").join(", ")})`), args.push(...opts.states));
    const sql = `SELECT id, bot_id, task_id, rule_id, rule_version, mode, session_id, cause, state, outcome, report, would, '' AS activity, tokens_in, tokens_out, cost_usd, error, delivery, permission, queued_at, started_at, ended_at
      FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY queued_at, rowid LIMIT ${Math.max(1, Math.min(1000, opts.limit ?? 500))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toRun(r));
  }
  /** 规则的运行记录（新→旧）：before 之前的（按排队时间，翻页用） */
  ruleRuns(ruleId: string, opts: { before?: number; limit?: number; mode?: string; outcome?: RunOutcome; version?: number } = {}): RunRow[] {
    const where = ["rule_id = ?"];
    const args: Array<string | number> = [ruleId];
    if (opts.before) (where.push("queued_at < ?"), args.push(opts.before));
    if (opts.mode) (where.push("mode = ?"), args.push(opts.mode));
    if (opts.outcome) (where.push("outcome = ?"), args.push(opts.outcome));
    if (opts.version) (where.push("rule_version = ?"), args.push(opts.version));
    const sql = `SELECT id, bot_id, task_id, rule_id, rule_version, mode, session_id, cause, state, outcome, report, would, '' AS activity, tokens_in, tokens_out, cost_usd, error, delivery, permission, queued_at, started_at, ended_at
      FROM runs WHERE ${where.join(" AND ")} ORDER BY queued_at DESC, rowid DESC LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 20))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toRun(r));
  }
  /** 任务最近的一个 run（不含活动记录） */
  latestRun(taskId: string): RunRow | undefined {
    const r = this.db
      .prepare("SELECT id, bot_id, task_id, rule_id, rule_version, mode, session_id, cause, state, outcome, report, would, '' AS activity, tokens_in, tokens_out, cost_usd, error, delivery, permission, queued_at, started_at, ended_at FROM runs WHERE task_id = ? ORDER BY queued_at DESC, rowid DESC LIMIT 1")
      .get(taskId) as Row | undefined;
    return r ? this.toRun(r) : undefined;
  }

  private toInput(r: Row): RunInputRow {
    return {
      id: String(r.id),
      taskId: String(r.task_id),
      ruleId: String(r.rule_id),
      runId: String(r.run_id),
      kind: String(r.kind) as InputKind,
      text: String(r.text),
      fromPerson: Number(r.from_person) === 1,
      messageId: String(r.message_id),
      deliveredAt: Number(r.delivered_at),
      takenAt: Number(r.taken_at),
      createdAt: Number(r.created_at),
    };
  }
  insertInput(i: Pick<RunInputRow, "id" | "taskId" | "runId" | "kind" | "text" | "fromPerson" | "createdAt"> & Partial<Pick<RunInputRow, "ruleId" | "messageId" | "deliveredAt">>): RunInputRow {
    this.db
      .prepare("INSERT INTO run_inputs(id, task_id, rule_id, run_id, kind, text, from_person, message_id, delivered_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(i.id, i.taskId, i.ruleId ?? "", i.runId, i.kind, i.text, i.fromPerson ? 1 : 0, i.messageId ?? "", i.deliveredAt ?? 0, i.createdAt);
    return this.toInput(this.db.prepare("SELECT * FROM run_inputs WHERE id = ?").get(i.id) as Row);
  }
  updateInput(id: string, patch: Partial<Pick<RunInputRow, "runId" | "messageId" | "deliveredAt" | "takenAt">>): void {
    updateRow(this.db, "run_inputs", INPUT_COLS, id, patch);
  }
  /** 会话还没收下的输入（旧→新）：下一个 run 开始时交给它 */
  openInputs(taskId: string): RunInputRow[] {
    return (this.db.prepare("SELECT * FROM run_inputs WHERE task_id = ? AND taken_at = 0 ORDER BY created_at, rowid").all(taskId) as Row[]).map((r) => this.toInput(r));
  }
  listInputs(taskId: string): RunInputRow[] {
    return (this.db.prepare("SELECT * FROM run_inputs WHERE task_id = ? ORDER BY created_at, rowid").all(taskId) as Row[]).map((r) => this.toInput(r));
  }
  /** 会话里出现了这条用户消息（DSH 收件 id）：记下 taken；返回记下了几条 */
  takeInputs(taskId: string, messageId: string, at = Date.now()): number {
    return Number(this.db.prepare("UPDATE run_inputs SET taken_at = ? WHERE task_id = ? AND message_id = ? AND taken_at = 0").run(at, taskId, messageId).changes);
  }
  /** 规则的一个 run 里会话还没收下的输入（旧→新）：每个 run 一个新会话，输入跟着 run 走 */
  openRunInputs(runId: string): RunInputRow[] {
    return (this.db.prepare("SELECT * FROM run_inputs WHERE run_id = ? AND task_id = '' AND taken_at = 0 ORDER BY created_at, rowid").all(runId) as Row[]).map((r) => this.toInput(r));
  }
  /** 规则的 run：会话里出现了这条用户消息 */
  takeRunInputs(runId: string, messageId: string, at = Date.now()): number {
    return Number(this.db.prepare("UPDATE run_inputs SET taken_at = ? WHERE run_id = ? AND task_id = '' AND message_id = ? AND taken_at = 0").run(at, runId, messageId).changes);
  }
  /** 规则的 run 的第一条输入（重跑时照原样再交一次） */
  runInputs(runId: string): RunInputRow[] {
    return (this.db.prepare("SELECT * FROM run_inputs WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as Row[]).map((r) => this.toInput(r));
  }

  // ---------- rules（3d） ----------
  private toRule(r: Row): RuleRow {
    const trigger = parseJson<RuleTrigger>(r.trigger_spec) ?? { kind: "event", source: "" };
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      conversationId: String(r.conversation_id),
      title: String(r.title),
      instruction: String(r.instruction),
      message: String(r.message),
      kind: String(r.kind) === "remind" ? "remind" : "check",
      trigger,
      mode: (["off", "observe", "act"].includes(String(r.mode)) ? String(r.mode) : "off") as RuleMode,
      folder: String(r.folder),
      version: Number(r.version),
      nextRunAt: Number(r.next_run_at),
      failures: Number(r.failures),
      pausedReason: String(r.paused_reason),
      runBudgetUsd: Number(r.run_budget_usd ?? 0.1),
      monthBudgetUsd: Number(r.month_budget_usd ?? 3),
      anytime: Number(r.anytime) === 1,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  insertRule(
    r: Omit<RuleRow, "version" | "failures" | "pausedReason" | "runBudgetUsd" | "monthBudgetUsd"> & Partial<Pick<RuleRow, "version" | "runBudgetUsd" | "monthBudgetUsd">>,
  ): RuleRow {
    this.db
      .prepare(
        `INSERT INTO rules(id, bot_id, conversation_id, title, instruction, message, kind, trigger_spec, mode, folder, version, next_run_at, anytime, created_at, updated_at, run_budget_usd, month_budget_usd)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.botId, r.conversationId, r.title, r.instruction, r.message, r.kind, JSON.stringify(r.trigger), r.mode, r.folder, r.version ?? 1, r.nextRunAt, r.anytime ? 1 : 0, r.createdAt, r.updatedAt, r.runBudgetUsd ?? 0.1, r.monthBudgetUsd ?? 3);
    return this.getRule(r.id)!;
  }
  /** 规则从 since 起（按该跑的时间）花了多少：本月的花费 */
  ruleSpent(ruleId: string, since: number): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM runs WHERE rule_id = ? AND queued_at >= ?").get(ruleId, since) as Row | undefined;
    return Number(r?.s ?? 0);
  }
  getRule(id: string): RuleRow | undefined {
    const r = this.db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toRule(r) : undefined;
  }
  updateRule(id: string, patch: Partial<Omit<RuleRow, "id" | "botId" | "folder" | "createdAt">>): void {
    updateRow(this.db, "rules", RULE_COLS, id, patch);
  }
  listRules(opts: { botId?: string; conversationId?: string; limit?: number } = {}): RuleRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.conversationId) (where.push("conversation_id = ?"), args.push(opts.conversationId));
    const sql = `SELECT * FROM rules ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 200))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toRule(r));
  }
  /** 到点了的规则（开着、没暂停、按时间表）：next_run_at 在 now 及之前 */
  dueRules(now: number): RuleRow[] {
    return (this.db.prepare("SELECT * FROM rules WHERE mode != 'off' AND paused_reason = '' AND next_run_at > 0 AND next_run_at <= ? ORDER BY next_run_at").all(now) as Row[]).map((r) => this.toRule(r));
  }
  /** 最早的下次运行时间（定时器只设这一个）；没有就是 0 */
  nextRuleDue(): number {
    const r = this.db.prepare("SELECT MIN(next_run_at) AS t FROM rules WHERE mode != 'off' AND paused_reason = '' AND next_run_at > 0").get() as Row | undefined;
    return Number(r?.t ?? 0) || 0;
  }
  /** 删掉规则和它的运行记录 */
  deleteRule(id: string): void {
    this.db.prepare("DELETE FROM run_inputs WHERE rule_id = ?").run(id);
    this.db.prepare("DELETE FROM runs WHERE rule_id = ?").run(id);
    this.db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  }

  /** 删掉任务和它的运行记录、输入（3f：界面里的删除；文件夹由任务服务删） */
  deleteTask(id: string): void {
    this.db.prepare("DELETE FROM run_inputs WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM runs WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
  /** 归档的任务不会再跑：它的输入（交过的、没交的）都不要了 */
  deleteTaskInputs(taskId: string): void {
    this.db.prepare("DELETE FROM run_inputs WHERE task_id = ?").run(taskId);
  }
  /**
   * 清理旧的运行记录（3f，决定 9：留 30 天）：before 之前结束的 run 删掉，连同它们的输入；每个任务最近的那个 run 留着
   * （任务的阶段看它）。会话收下过的任务输入也只留到 before。返回删了几个 run
   */
  pruneRuns(before: number): number {
    const n = Number(
      this.db
        .prepare(
          `DELETE FROM runs WHERE state = 'ended' AND MAX(queued_at, ended_at) < ? AND (rule_id != '' OR (task_id != '' AND id != (
             SELECT r2.id FROM runs r2 WHERE r2.task_id = runs.task_id ORDER BY r2.queued_at DESC, r2.rowid DESC LIMIT 1)))`,
        )
        .run(before).changes,
    );
    this.db.prepare("DELETE FROM run_inputs WHERE task_id = '' AND run_id != '' AND run_id NOT IN (SELECT id FROM runs)").run();
    this.db.prepare("DELETE FROM run_inputs WHERE task_id != '' AND taken_at > 0 AND created_at < ?").run(before);
    return n;
  }

  /** 任务的会话建过（交出去过输入）：之后要 resume */
  taskPrompted(taskId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM run_inputs WHERE task_id = ? AND delivered_at > 0 LIMIT 1").get(taskId);
  }
}

function parseSettings(v: unknown): BotSettings {
  try {
    return normalizeSettings(JSON.parse(String(v ?? "{}")));
  } catch {
    return normalizeSettings({});
  }
}
