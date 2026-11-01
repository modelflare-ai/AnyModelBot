/**
 * 后台任务服务（设计文档第 1–3、9–11 节，3a 部分）：任务、run 与输入的唯一写入者。
 *
 * - 一个任务一个 DSH 会话（task-<id>）和一个文件夹（工作区里的 tasks/<slug>-<id6>/），由宿主经 SDK 建、恢复、发消息；
 *   amb-tasks 插件给这些会话限定工具、加任务规则和 task_report。
 * - run 是一段工作：排队 → 跑（占名额）→ 收尾（会话空了但还有后台命令或子代理：settling，仍占名额）→ 结束。
 *   名额见 slots.ts；聊天从不占名额（人的通道）。
 * - 一轮结束、会话安静下来时按代理最近的 Report 结束这个 run：done / failed 的那一句按主动消息的规则（core/delivery.ts：
 *   免打扰、合并、每天上限、微信窗口）发回请求它的会话（飞书回复在请求那条消息下），网页写进会话历史。
 *   没有 Report 就提醒一次，还没有就算失败。进行中的任务给微信留配额，也算续期提醒里"之后还要发的"。
 * - 宿主欠会话的每条输入都落库（交出去时记 DSH 收件 id，会话里出现这条用户消息时记 taken）。应用重启或代理进程退出时，
 *   跑着的 run 记为 interrupted，给任务排一个恢复 run：先交一条恢复说明，没被会话收下的输入再交一次，收下过的不再交。
 * - 停止只停这个任务（指令通道：取消这一轮、停它的后台命令、之后的工具调用一律拒绝），聊天和别的任务照常。
 *
 * - 提问（3b）：代理报 needs_you 带一个问题，马上变成审批中心里一条不阻塞、不过期的提问，推给请求它的会话
 *   （一个会话同时只推一个）；回答成为任务的新输入（同追加：在跑就并进去，结束了就在人的名额里接着做）。
 *   带默认回答的问题不停下来等：代理接着做不依赖回答的部分，先做完就按默认做、在结果里说一声，提问随之撤回（「需要你」、
 *   推送都撤）；之后引用那条提问回答，同引用结果一样交给任务接着做。没带默认的（非用户定不可）这一轮结束、任务等着。
 *   任务会话里的审批也推过去（阻塞、12 小时）。
 *
 * - 规则（3d）：一条规则每次运行开一个新会话（rule-<规则>-<run>，工作目录是 rules/<slug>-<id6>/），和任务的 run 走同一套
 *   排队、名额、收尾、提醒、重试；不同的是结束之后（见「规则」一节）：观察只记「本会发送」，执行时那一句经出站队列发出去，
 *   连续失败 3 次自动暂停。定时器在 scheduler.ts，错过的按宽限期补跑一次或记为跳过。
 *
 * - 花费（3e，设计第 8 节）：会话里每次模型请求的用量按参考价估算（cost.ts），记在 run 上、累加到任务上，规则按月汇总。
 *   任务的预算（默认 $1）用完时取消这一轮（指令通道，之后还能接着用），问用户「已用约 $1.00，再给 $1 继续？」（一个提问：
 *   推给会话、在「需要你」里，回答「继续」加预算接着做，「停止」停掉）；规则每次运行 $0.10（这次以 budget 结束，算一次失败），
 *   每月 $3（暂停，「需要你」里一行，下个月自动恢复）。机器人有 Modelflare 预算 Key 时，剩下的不到 20% 就停后台工作，留给聊天。
 *   任务每次运行最多 4 小时（等人批准的时间不算），到了算失败。
 *
 * - 保留与清理（3f，决定 9，见 retention.ts）：30 天没动过的任务归档、运行记录只留 30 天；任务文件夹 30 天没动过就清理，
 *   清理前在「需要你」里告诉用户一次（可以保留），连同 DSH 里的会话记录。界面里删任务也删它的文件夹。规则的运行记录、
 *   任务的每次运行可以导出成 Markdown（export.ts）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { needsPerson, type Delivery } from "../core/delivery.js";
import { sentText } from "../core/outbox.js";
import { ActivityLog, type ActivityStep } from "../agent/activity.js";
import { ResumeFailed, deliverables } from "../agent/host.js";
import { answerLine, defaultLine, defaultOf, parseAnswer, promptButtons, questionsOf, taskPromptText, type ApprovalCenter, type ApprovalEvent, type QuestionItem, type ReplyContext } from "../agent/approvals.js";
import { actionCardSpec } from "../channels/feishu/transport.js";
import { NUDGE, RULE_NUDGE, RULE_RERUN, RULE_RESULT_SYSTEM, attachmentsOf, rebrief, recoveryNote, resumeNote, retryNote, ruleBrief, ruleResultInput, ruleRules, taskBrief } from "../agent/prompts/index.js";
import type { BotSettings } from "../agent/settings.js";
import type { ApprovalRow, Conversation, InputKind, RuleKind, RuleMode, RuleRow, RuleTrigger, RunCause, RunInputRow, RunOutcome, RunRow, Store, TaskReport, TaskRow } from "../store/db.js";
import type { AttentionItem } from "./attention.js";
import { logger } from "../log.js";
import { localParts, systemTimeZone } from "../core/quiet.js";
import {
  BUDGET_TOOL,
  RESERVE_SHARE,
  RULE_MONTH_BUDGET_USD,
  TASK_BUDGET_MAX_USD,
  TASK_BUDGET_STEP_USD,
  TASK_BUDGET_USD,
  TASK_RUN_CAP_MS,
  costOf,
  stepText,
  usdText,
  type Rates,
} from "./cost.js";
import { DEFAULT_MAX_BACKGROUND, pickRuns, priorityOf } from "./slots.js";
import { taskStage, type Stage, type StageGroup } from "./stage.js";
import { MAX_GRACE_MS, graceOf, localTime, nextRun, latestRun, parseSchedule, type Schedule } from "./schedule.js";
import { Scheduler } from "./scheduler.js";
import { matchesFilter, type RuleEvent } from "./rule-events.js";
import {
  MAX_RULES,
  RULE_APPROVAL_TTL_MS,
  RULE_DENY,
  RULE_DENY_PREFIX,
  RULE_FAILS_TO_PAUSE,
  RULE_FAILS_TO_SHOW,
  RULE_RUN_CAP_MS,
  RULE_SUGGEST_AFTER,
  RUN_ERROR,
  WOULD_APPROVAL,
  errorText,
  permissionText,
  ruleState,
  rulePermission,
  runLine,
  runMode,
  whenOf,
  wouldText,
  type RuleRunView,
  type RuleView,
} from "./rules.js";
import { t as tr } from "../i18n/index.js";
import { KEEP_MS, SWEEP_MS, WARN_MS, dirBytes, hasFiles, taskFolder } from "./retention.js";
import { ruleMarkdown, taskMarkdown, type ExportedTaskRun } from "./export.js";

const log = logger("tasks");

/** 每个机器人同时在进行的任务上限：再多就拒绝 task_start */
export const MAX_WORKING_TASKS = 10;
/** 给用户的一句话上限 */
export const MESSAGE_MAX = 300;
/** 一轮出错后重试前等多久（设计：15、30、60 秒） */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000];

/** 提问的问题、选项的上限 */
export const QUESTION_MAX = 300;
export const OPTIONS_MAX = 6;

/** 审批中心里任务要用的这几样（审批中心是提问和审批的唯一写入者） */
export type TaskApprovals = Pick<ApprovalCenter, "create" | "cancel" | "answerText" | "pending" | "pendingForTask" | "pendingAll" | "listen">;

/** 推给用户的提问 / 审批在出站队列里的 id（同一条只推一次；引用、"最后一条消息"按它认） */
export const askId = (row: Pick<ApprovalRow, "taskId" | "id">) => `task:${row.taskId}:ask:${row.id}`;

/** 宿主这边能为任务做的事（AgentManager 实现；单元测试换成假的） */
export interface TaskHost {
  /** 代理模式可用 */
  readonly available: boolean;
  workspace(botId: string): string;
  settings(botId: string): BotSettings;
  memoryPrefix(botId: string, conversationId: string): string;
  /**
   * 把一条输入交给任务会话：第一次建会话（工作目录是任务文件夹），之后在新的代理进程里先 resume。返回 DSH 的收件 id。
   * resume 失败（会话记录丢了）抛 ResumeFailed（host.ts）。
   */
  prompt(botId: string, o: { sessionId: string; folder: string; model: string; text: string; resume: boolean }): Promise<string>;
  /** 并进正在进行的一轮（agent.steer）；会话空闲时返回 false */
  steer(botId: string, sessionId: string, id: string, text: string): Promise<boolean>;
  /** 停掉这个会话：取消这一轮、它的子代理和后台命令，之后的工具调用一律拒绝 */
  stop(botId: string, sessionId: string): Promise<void>;
  /** 停下这一轮（取消、停它的子代理和后台命令），会话之后还能接着用：预算用完、时间到了、给聊天留预算（3e） */
  cancel(botId: string, sessionId: string): Promise<void>;
  /** 会话空闲时还有没有后台命令、子代理在跑；有就由插件在它们结束、会话再次空闲时报 task-settled */
  quiet(botId: string, sessionId: string): Promise<{ quiet: boolean; jobs?: string[] }>;
  /** 这个机器人的一个 run 结束了：代理进程完全空闲、开过的会话又多了，就换一个新的（host.ts restartIfStale） */
  runEnded?(botId: string): void;
  /** 3f：任务的会话在 DSH 里的记录占多大（字节；没有就是 0） */
  sessionBytes?(botId: string, taskId: string): number;
  /** 3f：删掉任务的会话记录（SDK 没有删会话的接口，宿主直接删目录）；会话还开在当前代理进程里时不删、返回 false，下次清理再删 */
  removeSessions?(botId: string, taskId: string): boolean;
}

/** DSH 的一条通知（SDK 的 session.event / session.status / subagent.*） */
export interface TaskNotification {
  method: string;
  params: any;
}

export interface TaskServiceOptions {
  store: Store;
  host: TaskHost;
  /** 微信、飞书的结果按主动消息的规则经出站队列发（没有就只写进会话历史）；任务的提问也经它推 */
  delivery?: Delivery;
  /** 任务的提问、任务会话里的审批（没有就不能问用户） */
  approvals?: TaskApprovals;
  /** 机器人没设模型时用的默认模型 */
  defaultModel?: () => string;
  /** 发给网关前限定到机器人用的 Key（同聊天） */
  route?: (botId: string, model: string) => string;
  maxBackground?: number;
  now?: () => number;
  retryDelaysMs?: number[];
  /** 任务有变化（阶段、进展）；规则有变化时是规则 id */
  onChange?: (taskId: string) => void;
  /** 规则：用主模型写那一句结果（检查用的是小模型）；没有就用检查时的草稿 */
  complete?: (botId: string, model: string, system: string, user: string) => Promise<string>;
  /** 新规则的时区（默认本机的） */
  timeZone?: string;
  /** 规则一次运行最长多久（测试注入） */
  ruleRunCapMs?: number;
  /** 任务一次运行最长多久，不算等人批准的时间（默认 4 小时；测试注入） */
  taskRunCapMs?: number;
  /** 多久看一次任务的时间上限（默认 1 分钟） */
  capCheckMs?: number;
  /** 估算花费的单价（模型 → 美元 / 百万 tokens；同步，取应用缓存的 Modelflare 目录）；没有就不估算 */
  rates?: (model: string) => Rates | undefined;
  /** 机器人的 Modelflare 预算 Key（总额、还剩多少、什么时候读的）；没开预算就是 undefined */
  botBudget?: (botId: string) => { limitUsd: number; remainUsd: number; at: number } | undefined;
}

/** 界面、/tasks 和 task_list 看到的任务 */
export interface TaskView {
  id: string;
  botId: string;
  conversationId: string;
  channel: string;
  title: string;
  stage: Stage;
  /** 最新进展：最近一次 Report 的那句话（给用户的，没有就是内部摘要的第一行） */
  latest: string;
  folder: string;
  originMessageId: number;
  createdAt: number;
  updatedAt: number;
  endedAt: number;
  /** 跑了几个 run */
  runs: number;
  /** 估算已花的、预算（美元） */
  spentUsd: number;
  budgetUsd: number;
  /** 3f：文件夹定在什么时候清理（30 天没动过、告诉过用户）；0 = 没定 */
  cleanupAt: number;
  /** 它问用户的、还没回答的问题；note：有默认回答时那一句「不回复就按中文做」 */
  question?: { text: string; note?: string };
  /** 正在跑的那个 run：开始时间与步数 */
  live?: { runId: string; since: number; steps: number; current?: ActivityStep };
}

/** 一个在跑（或收尾中）的 run 的内存状态（任务的，或规则的：ruleId 不空、taskId 是空的） */
interface Live {
  runId: string;
  taskId: string;
  ruleId: string;
  /** 规则：这次是观察还是执行；会话的工作目录和模型（每次一个新会话，不 resume） */
  mode: "observe" | "act";
  folder: string;
  model: string;
  /** 规则：一次运行的时间上限 */
  capTimer?: NodeJS.Timeout;
  botId: string;
  sessionId: string;
  activity: ActivityLog;
  /** 会话正在跑一轮 */
  busy: boolean;
  /** 正在把输入交给会话（等代理进程、resume、session/prompt） */
  starting: boolean;
  /** 在问插件还有没有后台命令 */
  checking: boolean;
  /** 会话空了，等后台命令、子代理结束 */
  settling: boolean;
  /** 这个 run 里代理报的 done / failed */
  final?: TaskReport;
  nudged: boolean;
  /** 最近一轮出的错 */
  turnError?: string;
  retries: number;
  /** 等着重试（出错后过一会儿接着做） */
  timer?: NodeJS.Timeout;
  /** 会话里出现过的用户消息 id（收件 id 可能比 session/prompt 的回复先到） */
  seen: Set<string>;
  tokensIn: number;
  tokensOut: number;
  /** 这个 run 估算花了多少（美元） */
  costUsd: number;
  /** 按哪个模型的价估算（事件里没说是哪个模型时） */
  priceModel: string;
  /** 宿主让它停下的原因（预算、时间上限、给聊天留预算）：交输入时正好停了，再取消一次 */
  halted?: Halt;
  /** 规则观察时要批准的事（自动拒绝了，记成「需要批准：…」） */
  would?: string[];
}

/** 宿主让一个 run 停下：任务的预算、时间上限；规则的单次、本月预算；机器人的预算留给聊天 */
type Halt = "budget" | "cap" | "run" | "month" | "reserve";

const hex = (n: number) => crypto.randomBytes(n).toString("hex");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const pad2 = (n: number) => String(n).padStart(2, "0");
/** 给模型看的时间：11月1日 08:00（规则的时区） */
function stamp(ts: number, tz: string): string {
  const p = localParts(ts, tz);
  const m = Math.floor(p.minute);
  return `${p.mo}月${p.d}日 ${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 文件夹名里的 slug：标题里的字母数字（中文标题就是 task） */
export function slugOf(title: string): string {
  const s = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return s || "task";
}

const NOTES = "task-notes:";
/** 还没删掉的会话记录（"<机器人>:<任务>"，会话开在代理进程里时删不了，下次清理再删） */
const TRASH = "tasks:session-trash";
/** 「需要你」里问要不要改为执行的那一行点过「继续观察」：哪一版不再问（每条规则一个；删规则时一起删） */
const SUGGEST_SEEN = "rules:suggest-seen:";

/** 预算用完时的回答：不要了 */
const STOP_WORDS = /^(停止|停|不用了?|不要了?|算了|取消|stop|no|cancel)[。.!！]*$/i;
/** 只写了一个金额（「再给 $3」里的 3） */
const AMOUNT_ONLY = /^\s*(?:再给|加|给它)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:美元|美金|刀|块|dollars?|usd)?\s*$/i;
const amountIn = (text: string) => {
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  const v = m ? Number(m[1]) : NaN;
  return v > 0 && v <= 100 ? v : undefined;
};

/** 给聊天代理的便条：后台任务的结果发出去了，下一条聊天消息带上它（模型知道这件事，用户问"详细说说"时能接上） */
export function takeTaskNotes(store: Store, conversationId: string): string {
  const v = store.getKV(NOTES + conversationId);
  if (!v) return "";
  store.deleteKV(NOTES + conversationId);
  try {
    const list = JSON.parse(v) as string[];
    return Array.isArray(list) ? list.join("\n") : "";
  } catch {
    return "";
  }
}

export class TaskService {
  /** runId → 在跑的 run */
  private live = new Map<string, Live>();
  /** 会话 id → 在跑的 run */
  private bySession = new Map<string, Live>();
  private started = false;
  private closing = false;
  /** 正在删除的机器人 */
  private dropped = new Set<string>();
  private unlisten: (() => void) | undefined;
  /** 隔一会儿看一次任务的时间上限 */
  private capTimer: NodeJS.Timeout | undefined;
  /** 机器人从上次读预算 Key 之后又估算花了多少（读到新的就从零算）：快到 20% 时不用等下一次读 */
  private botSpend = new Map<string, { at: number; usd: number }>();
  /** 机器人从什么时候起预算不够、后台工作停着（「需要你」里那一行的时间） */
  private reserveSince = new Map<string, number>();
  /** 刚被宿主停下的会话：取消到达之前已经发出去的那次模型请求，花费照样记到这个 run 上（几分钟内） */
  private halted = new Map<string, { runId: string; taskId: string; botId: string; model: string; until: number }>();
  /** 每小时看一次保留与清理（3f） */
  private retainTimer: NodeJS.Timeout | undefined;
  /** 任务文件夹、会话记录有多大（详情每几秒取一次，不用每次都数一遍） */
  private sizeCache = new Map<string, { at: number; v: { folder: number; sessions: number } }>();

  /** 宿主的定时器：规则到点开 run（scheduler.ts） */
  readonly scheduler: Scheduler;

  constructor(private o: TaskServiceOptions) {
    // 进行中的任务：给微信留 1 条配额（聊天回复不会把它挤掉），续期提醒里也算"之后还要发的"
    o.delivery?.addReserver((p) => this.working(p.conversationId).length);
    // 推给用户、还没回答的提问（审批）：再留 1 条（设计第 6 节：任务、待答问题各占 1 条，一共最多 3 条）
    o.delivery?.addReserver((p) => (o.approvals?.pending(p.conversationId).some((r) => r.taskId) ? 1 : 0));
    o.delivery?.addUpcoming((p) => this.working(p.conversationId).map((t) => ({ label: t.title, kind: "task" as const })));
    // 执行中的规则（含提醒）：每条留 1 条配额；窗口关闭之后还要跑的，续期提醒里列出来（观察中的规则什么都不发，不算）
    o.delivery?.addReserver((p) => this.pushingRules(p.conversationId).length);
    o.delivery?.addUpcoming((p, after) =>
      this.pushingRules(p.conversationId)
        .filter((r) => r.nextRunAt >= after)
        .map((r) => ({ label: r.title, at: r.nextRunAt, kind: r.kind === "remind" ? ("reminder" as const) : ("rule" as const) })),
    );
    this.scheduler = new Scheduler({ next: () => this.nextWake(), fire: (now) => this.fireDue(now), now: () => this.now() });
  }

  private get store(): Store {
    return this.o.store;
  }
  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  // ---------- 生命周期 ----------

  /**
   * 启动：上次没跑完的 run 记为 interrupted 并排恢复；结束了却没送出的结果补送、没问出去的问题补问；
   * 每个会话把该推的提问推出去；开始排队的 run
   */
  start(): void {
    this.started = true;
    this.closing = false;
    this.unlisten ??= this.o.approvals?.listen((e) => this.onApproval(e));
    this.recover(undefined, tr("tasks.recoverAppRestart"));
    for (const r of this.store.listRuns({ states: ["ended"] })) {
      if (!r.taskId) continue;
      if (!r.delivery && (r.outcome === "done" || r.outcome === "failed")) {
        const task = this.store.getTask(r.taskId);
        if (task) this.deliver(task, r.id, r.outcome, r.report, r.error);
      } else if (r.outcome === "needs_you" && r.report?.question) {
        const task = this.store.getTask(r.taskId);
        if (task && task.endReason !== "stopped" && this.store.latestRun(task.id)?.id === r.id) this.ask(task, r.id, r.report.question);
      } else if (r.outcome === "budget") {
        // 停在预算上、还没问出去就退出了：补问一次
        const task = this.store.getTask(r.taskId);
        if (task && task.endReason !== "stopped" && this.store.latestRun(task.id)?.id === r.id) this.askBudget(task, r.id);
      }
    }
    for (const conv of new Set((this.o.approvals?.pendingAll() ?? []).filter((r) => r.taskId).map((r) => r.conversationId))) this.pushNext(conv);
    this.redeliverRules();
    this.pump();
    // 定时器最后开：应用没开时错过的规则，宽限期内的补跑一次，更早的记为跳过
    this.scheduler.start();
    clearInterval(this.capTimer);
    this.capTimer = setInterval(() => this.checkCaps(), this.o.capCheckMs ?? 60_000);
    this.capTimer.unref?.();
    // 保留与清理：启动时看一次（应用关着的这些天也算），之后每小时一次
    this.retain();
    clearInterval(this.retainTimer);
    this.retainTimer = setInterval(() => this.retain(), SWEEP_MS);
    this.retainTimer.unref?.();
  }

  /** 应用退出：不再开始新的 run；跑着的留在库里（下次启动时恢复），步骤先存下 */
  stop(): void {
    this.closing = true;
    this.scheduler.stop();
    clearInterval(this.capTimer);
    this.capTimer = undefined;
    clearInterval(this.retainTimer);
    this.retainTimer = undefined;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const l of this.live.values()) {
      clearTimeout(l.timer);
      clearTimeout(l.capTimer);
      try {
        this.store.updateRun(l.runId, { activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd });
      } catch {
        /* 数据库可能已经关了 */
      }
    }
  }

  /** 删机器人之前：它的任务不再跑、不再恢复（不然停它的代理进程会触发恢复，又把进程拉起来） */
  dropBot(botId: string): void {
    this.dropped.add(botId);
    for (const l of [...this.live.values()]) if (l.botId === botId) this.forget(l);
  }

  /** 代理进程退出（崩溃、设置变化后重启、手动重启）：它上面跑着的 run 记为 interrupted，排恢复 */
  onChildExit(botId: string): void {
    if (this.closing || !this.started || this.dropped.has(botId)) return;
    if (!this.store.listRuns({ botId, states: ["running", "settling"] }).length) return;
    log.warn("agent process exited with background tasks running; recovering them", { bot: botId });
    this.recover(botId, tr("tasks.recoverAgentExit"));
    this.pump();
  }

  /**
   * 恢复（设计 3.restart）：running / settling 的 run 记为 interrupted；任务没结束的排一个恢复 run，
   * 第一条输入是恢复说明（被停掉的后台命令列在里面），之后是会话没收下的输入（收下过的不再交）。
   */
  private recover(botId: string | undefined, why: string): void {
    for (const run of this.store.listRuns({ botId, states: ["running", "settling"] })) {
      const l = this.live.get(run.id);
      const steps: ActivityStep[] = l ? l.activity.steps : parseSteps(this.store.getRun(run.id)?.activity);
      if (l) this.forget(l);
      this.store.updateRun(run.id, { state: "ended", outcome: "interrupted", endedAt: this.now(), error: why, ...(l ? { activity: JSON.stringify(steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd } : {}) });
      if (run.ruleId) {
        this.recoverRule(run);
        continue;
      }
      const task = run.taskId ? this.store.getTask(run.taskId) : undefined;
      // 这一轮在等的批准随它没了（DSH 那次调用不在了）：恢复后代理需要的话再问
      for (const a of run.taskId ? (this.o.approvals?.pendingForTask(run.taskId) ?? []) : []) if (a.blocking) this.o.approvals!.cancel(a.id, "interrupted");
      if (!task || task.endedAt) continue;
      const jobs = steps.filter((s) => s.kind === "job" && s.status === "running").map((s) => clip(oneLine(s.summary || s.title), 120));
      this.addInput(task.id, "recovery", recoveryNote(jobs), false);
      // 这一轮已经报了 needs_you（没有默认回答）、问题还开着（收尾时重启的）：它本来就在等回答，run 记为 needs_you，不排恢复；
      // 恢复说明跟着回答交给下一个 run。带默认回答的照常恢复：问题开着，回答到了交给恢复的 run
      const final = l?.final ?? run.report;
      const waits = final?.state === "needs_you" && !final.question?.default && (this.o.approvals?.pendingForTask(task.id) ?? []).some((a) => a.kind === "question" && a.tool === "task_report" && !defaultOf(a));
      if (waits) this.store.updateRun(run.id, { outcome: "needs_you", error: "" });
      else if (!this.queuedRun(task.id)) this.enqueue(task, "recover");
      this.changed(task.id);
    }
  }

  // ---------- 建任务、追加、停止 ----------

  /** 新任务（聊天代理的 task_start）：用户原话、说明、最近的对话、附件和记忆快照作为第一条输入，排进队列 */
  create(o: { botId: string; conversationId: string; title: string; brief: string; budgetUsd?: number; anytime?: boolean }): { task?: TaskRow; error?: string } {
    const conv = this.store.getConversation(o.conversationId);
    const bot = this.store.getBot(o.botId);
    if (!conv || !bot) return { error: "conversation not found" };
    const title = clip(oneLine(o.title), 40);
    if (!title) return { error: "title is required" };
    const working = this.store.listTasks({ botId: o.botId, open: true, limit: 500 }).filter((t) => this.stage(t).group === "working").length;
    if (working >= MAX_WORKING_TASKS) return { error: `This bot already has ${working} background tasks running; finish or stop one first (the user can send /tasks).` };
    const msgs = this.store.listMessages(conv.id, 40);
    const at = msgs.findLastIndex((m) => m.role === "user");
    const origin = at >= 0 ? msgs[at] : undefined;
    const recent = msgs
      .slice(0, Math.max(0, at))
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.content }));
    const id = `t_${hex(6)}`;
    const now = this.now();
    const folder = `tasks/${slugOf(title)}-${id.slice(2, 8)}`;
    const st = this.o.host.settings(o.botId);
    const task = this.store.insertTask({
      id,
      botId: o.botId,
      conversationId: conv.id,
      originMessageId: origin?.id ?? 0,
      originRef: conv.channel === "feishu" ? replyHandle(this.store, conv.id).messageId ?? "" : "",
      title,
      brief: clip(o.brief.trim(), 1500),
      sessionId: `task-${id}`,
      folder,
      model: conv.model || bot.defaultModel || this.o.defaultModel?.() || "",
      permission: st.permission,
      budgetUsd: o.budgetUsd && o.budgetUsd > 0 ? Math.min(o.budgetUsd, 100) : TASK_BUDGET_USD,
      anytime: !!o.anytime,
      createdAt: now,
      updatedAt: now,
    });
    const text = taskBrief({
      title,
      original: origin?.content ?? o.brief,
      brief: o.brief,
      recent,
      attachments: attachmentsOf(origin?.content ?? ""),
      memory: st.memory.enabled ? this.o.host.memoryPrefix(o.botId, conv.id) : undefined,
      folder,
    });
    this.addInput(task.id, "brief", text, true);
    this.enqueue(task, "launch");
    log.info("background task created", { bot: o.botId, task: id, conversationId: conv.id });
    this.changed(id);
    this.pump();
    return { task };
  }

  /**
   * 人的追加（task_message）：任务在跑一轮就并进去（下一步看到）；空着（收尾、等重试）就马上交给会话；
   * 在排队就跟着这个 run 一起交；已完成或失败了就在同一个任务里开一个新 run（人的唤醒，排在前面）。停了的不接。
   */
  async message(taskId: string, text: string): Promise<{ how?: "steered" | "sent" | "queued" | "resumed" | "answered"; error?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { error: "task not found" };
    if (task.endReason === "stopped") return { error: tr("tasks.stoppedNoFollowup", { title: task.title }) };
    if (task.endReason === "archived") return { error: tr("tasks.archivedNoFollowup", { title: task.title }) };
    // 任务在等用户回答：这句话就是回答（回答成为它的新输入，见 onApproval）
    const open = this.o.approvals?.pendingForTask(task.id).find((r) => r.kind === "question" && !r.blocking);
    if (open && this.o.approvals!.answerText(open.id, text.trim(), "followup")) return { how: "answered" };
    const input = this.addInput(task.id, "followup", `[用户追加]\n${text.trim()}`, true);
    return { how: await this.wake(task, input, "followup") };
  }

  /** 失败的任务再试一次（"需要你"里的重试）：人的输入，开一个 retry run */
  async retry(taskId: string): Promise<{ how?: "steered" | "sent" | "queued" | "resumed"; error?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { error: "task not found" };
    if (task.endReason === "stopped") return { error: tr("tasks.stoppedShort", { title: task.title }) };
    if (task.endReason === "archived") return { error: tr("tasks.archivedNoFollowup", { title: task.title }) };
    const last = this.store.latestRun(task.id);
    const why = last?.report?.message || last?.error || "";
    const input = this.addInput(task.id, "followup", `[用户让你再试一次]${why ? `\n上次没做完：${clip(oneLine(why), 300)}` : ""}`, true);
    return { how: await this.wake(task, input, "retry") };
  }

  /**
   * 把人的输入交给任务：在跑一轮就并进去（下一步看到）；空着（收尾、等重试）就马上交给会话；在排队就跟着这个 run 一起交；
   * 已完成、失败了或在等回答，就在同一个任务里开一个新 run（人的唤醒，排在前面）。
   */
  private async wake(task: TaskRow, input: RunInputRow, cause: RunCause): Promise<"steered" | "sent" | "queued" | "resumed"> {
    const l = this.liveOf(task.id);
    if (l) {
      if (l.busy && !l.starting && (await this.o.host.steer(l.botId, l.sessionId, input.id, input.text).catch(() => false))) {
        this.store.updateInput(input.id, { runId: l.runId, messageId: input.id, deliveredAt: this.now(), ...(l.seen.has(input.id) ? { takenAt: this.now() } : {}) });
        this.reopen(l);
        return "steered";
      }
      if (!l.busy && !l.starting && !l.checking) {
        clearTimeout(l.timer);
        l.timer = undefined;
        void this.deliver_(l, [input]);
        return "sent";
      }
      // 正在交上一条：这一轮空下来时交（checkSettle 先交没交出去的输入）
      return "queued";
    }
    if (this.queuedRun(task.id)) return "queued";
    if (task.endedAt) this.store.updateTask(task.id, { endedAt: 0, endReason: "", updatedAt: this.now() });
    this.enqueue(task, cause);
    this.changed(task.id);
    this.pump();
    return "resumed";
  }

  /** 停止（/stop 编号、界面、聊天代理）：只停这个任务，聊天和别的任务照常 */
  async stopTask(taskId: string, by: string): Promise<boolean> {
    const task = this.store.getTask(taskId);
    if (!task || task.endReason === "stopped") return false;
    const now = this.now();
    this.store.updateTask(taskId, { endedAt: now, endReason: "stopped", stoppedBy: by, updatedAt: now });
    for (const r of this.store.listRuns({ taskId, states: ["queued"] })) this.store.updateRun(r.id, { state: "ended", outcome: "stopped", endedAt: now });
    // 它在等的提问、审批作废（"需要你"里随之消失，同一会话的下一个提问可以推了）
    for (const a of this.o.approvals?.pendingForTask(taskId) ?? []) this.o.approvals!.cancel(a.id, "stopped");
    const l = this.liveOf(taskId);
    if (l) {
      l.activity.end(tr("tasks.endStopped"));
      this.end(l, "stopped");
      await this.o.host.stop(l.botId, l.sessionId).catch((e) => log.warn("stopping the task session failed", { task: taskId, message: (e as Error).message.slice(0, 200) }));
    }
    log.info("background task stopped", { task: taskId, by });
    this.changed(taskId);
    this.pump();
    return true;
  }

  // ---------- 排队与名额 ----------

  private enqueue(task: TaskRow, cause: RunCause): RunRow {
    return this.store.insertRun({ id: `r_${hex(6)}`, botId: task.botId, taskId: task.id, sessionId: task.sessionId, cause, queuedAt: this.now() });
  }

  private queuedRun(taskId: string): RunRow | undefined {
    return this.store.listRuns({ taskId, states: ["queued"] })[0];
  }

  private liveOf(taskId: string): Live | undefined {
    for (const l of this.live.values()) if (l.taskId === taskId) return l;
    return undefined;
  }

  private slots(botId: string): number {
    return this.o.host.settings(botId).taskSlots;
  }

  // ---------- 暂停后台工作 ----------

  /** 这个机器人的后台工作暂停了（机器人设置 › 主动消息、信息面板、聊天代理的 background_pause） */
  paused(botId: string): boolean {
    return !!this.store.getBot(botId)?.settings.paused;
  }

  /**
   * 暂停、恢复后台工作：暂停时不开始新的 run（任务的排着等，规则到点记为跳过、之后不补），主动消息排着（core/delivery.ts）；
   * 聊天照常，正在跑的那一轮照常做完。恢复时排着的 run 开始、排着的主动消息按平常的规则发（免打扰、每天上限照旧）。
   */
  setPaused(botId: string, paused: boolean, by: string): boolean {
    const bot = this.store.getBot(botId);
    if (!bot) return false;
    if (bot.settings.paused === paused) return true;
    this.store.updateBot(botId, { settings: { ...bot.settings, paused } });
    log.info(paused ? "background work paused" : "background work resumed", { bot: botId, by });
    if (!paused) {
      this.o.delivery?.resume(botId);
      this.pump();
    }
    this.scheduler.wake();
    this.changed(botId);
    return true;
  }

  /** 暂停时排着的 run：任务的等恢复；规则的这次记为跳过（暂停），之后不补。返回 true = 现在不开始 */
  private heldByPause(run: RunRow): boolean {
    if (!this.paused(run.botId)) return false;
    if (run.ruleId) {
      this.store.updateRun(run.id, { state: "ended", outcome: "skipped", error: RUN_ERROR.paused, endedAt: this.now() });
      log.info("rule run skipped: background work is paused", { rule: run.ruleId, run: run.id });
      this.changed(run.ruleId);
    }
    return true;
  }

  /**
   * 机器人的预算快用完了：任务的排着等（加了预算、读到的余额回到 20% 以上再开始）；规则的这次记为跳过（预算留给聊天）。
   * 返回 true = 现在不开始
   */
  private heldByReserve(run: RunRow): boolean {
    if (!this.reserve(run.botId)) return false;
    if (run.ruleId) {
      this.store.updateRun(run.id, { state: "ended", outcome: "skipped", error: RUN_ERROR.reserve, endedAt: this.now() });
      log.info("rule run skipped: the bot's budget is kept for chat", { rule: run.ruleId, run: run.id });
      this.changed(run.ruleId);
    }
    return true;
  }

  /** 有空名额就开始排队的 run（人的唤醒在前，见 slots.ts）；后台工作暂停了、预算留给聊天的机器人不开始新的 */
  pump(): void {
    if (!this.started || this.closing) return;
    const queued = this.store
      .listRuns({ states: ["queued"] })
      .filter((r) => (r.taskId || (r.ruleId && !this.skipStale(r))) && !this.dropped.has(r.botId) && !this.heldByPause(r) && !this.heldByReserve(r));
    if (!queued.length) return;
    // 等批准的 run 让出名额（DSH 那次调用照样等着，批了就接着做）
    const blocked = new Set((this.o.approvals?.pendingAll() ?? []).filter((a) => a.taskId && a.blocking && a.kind === "approval").map((a) => a.taskId));
    const running = this.store.listRuns({ states: ["running", "settling"] }).filter((r) => !blocked.has(r.taskId));
    const picks = pickRuns(
      queued.map((r) => ({ id: r.id, botId: r.botId, priority: priorityOf(r.cause), queuedAt: r.queuedAt })),
      running,
      { perBot: (b) => this.slots(b), global: this.o.maxBackground ?? DEFAULT_MAX_BACKGROUND },
    );
    for (const p of picks) void this.startRun(p.id);
  }

  /** 开始一个 run：先同步占住名额，再把没被会话收下的输入（恢复说明在最前）交给会话 */
  private async startRun(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run || run.state !== "queued") return;
    if (run.ruleId) return this.startRuleRun(run);
    const task = this.store.getTask(run.taskId);
    const now = this.now();
    if (!task || task.endReason === "stopped") {
      this.store.updateRun(runId, { state: "ended", outcome: "stopped", endedAt: now });
      return;
    }
    // 预算已经用完（预算用完后又来了回答、追加）：不交给会话，输入留着，再问一次要不要加预算
    if (task.spentUsd >= task.budgetUsd) {
      this.store.updateRun(runId, { state: "ended", outcome: "budget", startedAt: now, endedAt: now, sessionId: task.sessionId });
      log.info("background task is over its budget; asking before it continues", { task: task.id, run: runId });
      this.askBudget(task, runId);
      this.changed(task.id);
      return;
    }
    this.store.updateRun(runId, { state: "running", startedAt: now, sessionId: task.sessionId });
    const l: Live = {
      runId,
      taskId: task.id,
      ruleId: "",
      mode: "act",
      folder: "",
      model: "",
      botId: task.botId,
      sessionId: task.sessionId,
      activity: new ActivityLog(undefined, task.model),
      busy: false,
      starting: false,
      checking: false,
      settling: false,
      nudged: false,
      retries: 0,
      seen: new Set(),
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      priceModel: task.model || this.store.getBot(task.botId)?.defaultModel || this.o.defaultModel?.() || "",
    };
    this.live.set(runId, l);
    this.bySession.set(task.sessionId, l);
    this.changed(task.id);
    const inputs = this.store.openInputs(task.id).sort((a, b) => Number(b.kind === "recovery") - Number(a.kind === "recovery"));
    await this.deliver_(l, inputs.length ? inputs : [this.addInput(task.id, "nudge", NUDGE, false)]);
  }

  /**
   * 把输入交给会话（一次 session/prompt，几条拼在一起）：记下收件 id。代理进程起不来、会话恢复不了时按情况重试、
   * 换新会话或让这个 run 失败。
   */
  private async deliver_(l: Live, inputs: RunInputRow[]): Promise<void> {
    if (!inputs.length || this.live.get(l.runId) !== l) return;
    // 规则的 run：每次一个新会话，工作目录和模型在开始时定好
    const task = l.ruleId ? undefined : this.store.getTask(l.taskId);
    if (!task && !l.ruleId) return;
    l.starting = true;
    if (l.settling) {
      // 收尾中又有输入（回答、追加）：又在跑了
      l.settling = false;
      this.store.updateRun(l.runId, { state: "running" });
    }
    if (inputs.some((i) => i.fromPerson)) this.reopen(l);
    const text = inputs.map((i) => i.text).join("\n\n");
    const folder = task ? path.join(this.o.host.workspace(task.botId), task.folder) : l.folder;
    const model = task ? this.modelOf(task) : l.model;
    try {
      let id: string;
      try {
        fs.mkdirSync(folder, { recursive: true });
        id = await this.o.host.prompt(l.botId, { sessionId: l.sessionId, folder, model, text, resume: task ? this.store.taskPrompted(task.id) : false });
      } catch (e) {
        if (!(e instanceof ResumeFailed) || !task) throw e;
        // 会话记录恢复不了：换一个新会话，从宿主记下的任务重新交代
        const n = this.store.listRuns({ taskId: task.id }).length + 1;
        const sessionId = `task-${task.id}-${n}`;
        log.warn("task session could not be resumed; starting a new one", { task: task.id, sessionId, message: e.message.slice(0, 200) });
        this.bySession.delete(l.sessionId);
        l.sessionId = sessionId;
        this.bySession.set(sessionId, l);
        this.store.updateTask(task.id, { sessionId, updatedAt: this.now() });
        this.store.updateRun(l.runId, { sessionId });
        const brief = this.store.listInputs(task.id).find((i) => i.kind === "brief")?.text ?? task.brief;
        const again = rebrief(brief, task.report?.message || task.report?.summary);
        id = await this.o.host.prompt(task.botId, { sessionId, folder, model, text: `${again}\n\n${text}`, resume: false });
      }
      if (this.live.get(l.runId) !== l) {
        // 交出去的时候任务被停了（规则被删了、超时了）：输入已经到了会话里，再停一次（插件拒绝它之后的工具调用）
        if (l.ruleId || this.store.getTask(l.taskId)?.endReason === "stopped") await this.o.host.stop(l.botId, l.sessionId).catch(() => undefined);
        // 预算用完、时间到了、给聊天留预算：再取消一次这一轮（会话之后还要接着用）
        else if (l.halted) await this.o.host.cancel(l.botId, l.sessionId).catch(() => undefined);
        return;
      }
      const at = this.now();
      for (const i of inputs) {
        this.store.updateInput(i.id, { runId: l.runId, messageId: id, deliveredAt: at });
        if (l.seen.has(id)) this.store.updateInput(i.id, { takenAt: at });
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (this.live.get(l.runId) !== l) return;
      log.warn("could not hand the task its input", { task: l.taskId, message: msg.slice(0, 300) });
      l.starting = false;
      if (this.o.host.available && l.retries < this.delays.length) {
        const delay = this.delays[l.retries++];
        l.timer = setTimeout(() => {
          l.timer = undefined;
          void this.deliver_(l, this.inputsOf(l).filter((i) => !i.deliveredAt || i.runId === l.runId));
        }, delay);
        l.timer.unref?.();
        return;
      }
      if (l.ruleId) this.end(l, "failed", undefined, this.o.host.available ? RUN_ERROR.agentFailed : RUN_ERROR.agentUnavailable);
      else this.end(l, "failed", undefined, this.o.host.available ? tr("tasks.agentDidntStart") : tr("tasks.agentUnavailable"));
      return;
    } finally {
      l.starting = false;
    }
    // 交出去的时候这一轮可能已经跑完了
    if (!l.busy) void this.checkSettle(l);
  }

  private get delays(): number[] {
    return this.o.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  /** 人又给了输入：之前报的 done / failed 不算了，等新的 Report */
  private reopen(l: Live): void {
    l.final = undefined;
    l.nudged = false;
  }

  private modelOf(task: TaskRow): string {
    const bot = this.store.getBot(task.botId);
    const m = task.model || bot?.defaultModel || this.o.defaultModel?.() || "";
    return m && this.o.route ? this.o.route(task.botId, m) : m;
  }

  private addInput(taskId: string, kind: InputKind, text: string, fromPerson: boolean): RunInputRow {
    return this.store.insertInput({ id: `i_${hex(6)}`, taskId, runId: "", kind, text, fromPerson, createdAt: this.now() });
  }

  /** 会话还没收下的输入：任务的按任务，规则的按这次 run（每次一个新会话） */
  private inputsOf(l: Live): RunInputRow[] {
    return l.ruleId ? this.store.openRunInputs(l.runId) : this.store.openInputs(l.taskId);
  }

  /** 给这个 run 的会话加一条（自动的）输入 */
  private inputFor(l: Live, kind: InputKind, text: string): RunInputRow {
    if (!l.ruleId) return this.addInput(l.taskId, kind, text, false);
    return this.store.insertInput({ id: `i_${hex(6)}`, taskId: "", ruleId: l.ruleId, runId: l.runId, kind, text, fromPerson: false, createdAt: this.now() });
  }

  // ---------- 会话事件（宿主转来的 SDK 通知） ----------

  /** root：任务会话 id（子代理的通知也归到它） */
  onEvent(_botId: string, root: string, n: TaskNotification): void {
    const l = this.bySession.get(root);
    if (!l) return this.lateUsage(root, n);
    const p = n.params ?? {};
    if (n.method === "subagent.started" || n.method === "subagent.finished") {
      l.activity.apply(n.method.replace(".", "/"), p);
      return;
    }
    if (p.sessionId !== root) {
      // 子代理的模型请求也算进花费（它的步骤不进这个 run 的处理过程）
      if (n.method === "session.event" && p.event?.type === "assistant/message" && p.event.data?.usage) this.usage(l, p.event.data);
      return;
    }
    if (n.method === "session.status") {
      if (p.status === "running") {
        l.busy = true;
        if (l.settling) {
          // 后台命令结束，代理被叫醒：还是这个 run
          l.settling = false;
          this.store.updateRun(l.runId, { state: "running" });
        }
      } else if (p.status === "idle") {
        l.busy = false;
        void this.checkSettle(l);
      }
      return;
    }
    if (n.method !== "session.event") return;
    const ev = p.event ?? {};
    const data = ev.data ?? {};
    const type = String(ev.type ?? "");
    l.activity.apply(type, data, Number(ev.time) || this.now());
    if (type === "user/message" && data.id) {
      const id = String(data.id);
      l.seen.add(id);
      const took = l.ruleId ? this.store.takeRunInputs(l.runId, id, this.now()) : this.store.takeInputs(l.taskId, id, this.now());
      if (took) this.changed(l.taskId || l.ruleId);
    } else if (type === "turn/start") l.turnError = undefined;
    else if (type === "turn/end") {
      if (data?.reason?.kind === "error") l.turnError = String(data.reason.error?.message ?? "unknown error");
      this.store.updateRun(l.runId, { activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd });
      this.changed(l.taskId || l.ruleId);
    } else if (type === "assistant/message" && data.usage) this.usage(l, data);
  }

  // ---------- 花费与预算（3e） ----------

  /**
   * 一次模型请求的用量（assistant/message）：按参考价估算，记在 run 上（马上落库：本月的花费从库里汇总）、加到任务上，
   * 再看各级预算。事件里有回答的模型就按它的价（子代理可能用别的模型），没有就按这个 run 的模型。
   */
  private usage(l: Live, data: any): void {
    const u = data.usage ?? {};
    l.tokensIn += (Number(u.inputTokens) || 0) + (Number(u.cacheReadTokens) || 0) + (Number(u.cacheWriteTokens) || 0);
    l.tokensOut += Number(u.outputTokens) || 0;
    const model = String(data.message?.source?.model ?? "");
    const usd = costOf(u, (model ? this.o.rates?.(model) : undefined) ?? (l.priceModel ? this.o.rates?.(l.priceModel) : undefined));
    if (usd > 0) {
      l.costUsd += usd;
      if (l.taskId) this.store.addTaskSpent(l.taskId, usd);
      const b = this.o.botBudget?.(l.botId);
      if (b) {
        const cur = this.botSpend.get(l.botId);
        this.botSpend.set(l.botId, { at: b.at, usd: (cur?.at === b.at ? cur.usd : 0) + usd });
      }
    }
    this.store.updateRun(l.runId, { tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd });
    if (usd <= 0) return;
    this.changed(l.taskId || l.ruleId);
    this.checkBudgets(l);
  }

  /**
   * 花了钱之后看预算（第一条超了的为准）：机器人的预算要留给聊天 → 停下这个机器人所有的后台 run；
   * 任务的预算用完 → 停下、问要不要加；规则本月的、这次的预算用完 → 停下（本月的还要暂停规则）。
   * 已经报了 done / failed、只差收尾的不停（下一次开始前再看）。
   */
  private checkBudgets(l: Live): void {
    if (this.live.get(l.runId) !== l || this.closing) return;
    if (this.reserve(l.botId)) return this.holdForReserve(l.botId);
    if (l.final) return;
    if (l.taskId) {
      const task = this.store.getTask(l.taskId);
      if (task && task.spentUsd >= task.budgetUsd) this.halt(l, "budget");
      return;
    }
    const rule = this.store.getRule(l.ruleId);
    if (!rule) return;
    if (this.monthSpent(rule) >= rule.monthBudgetUsd) this.halt(l, "month");
    else if (l.costUsd >= rule.runBudgetUsd) this.halt(l, "run");
  }

  /**
   * 让一个 run 停下：取消这一轮（任务的会话之后还要接着用：只取消不封；规则的每次一个新会话，直接停掉）。
   * 任务：预算用完 → budget，问要不要加；时间到了 → 失败（告诉用户，可以重试）；给聊天留预算 → 中断，排一个 run 等预算回来。
   * 规则：budget 结束，原因是单次 / 本月 / 留给聊天。
   */
  private halt(l: Live, why: Halt): void {
    if (this.live.get(l.runId) !== l) return;
    l.halted = why;
    const now = this.now();
    this.halted.set(l.sessionId, { runId: l.runId, taskId: l.taskId, botId: l.botId, model: l.priceModel, until: now + 10 * 60_000 });
    if (l.ruleId) {
      l.activity.end(errorText(why === "run" ? RUN_ERROR.runBudget : why === "month" ? RUN_ERROR.monthBudget : RUN_ERROR.reserve), now);
      log.warn("rule run stopped at a budget", { rule: l.ruleId, run: l.runId, why, costUsd: Math.round(l.costUsd * 10_000) / 10_000 });
      this.end(l, "budget", undefined, why === "run" ? RUN_ERROR.runBudget : why === "month" ? RUN_ERROR.monthBudget : RUN_ERROR.reserve);
      void this.o.host.stop(l.botId, l.sessionId).catch(() => undefined);
      return;
    }
    const jobs = l.activity.steps.filter((s) => s.kind === "job" && s.status === "running").map((s) => clip(oneLine(s.summary || s.title), 120));
    if (why === "budget") {
      l.activity.end(tr("tasks.stageBudget"), now);
      log.warn("background task used its budget; stopping it and asking the user", { task: l.taskId, run: l.runId, spentUsd: Math.round((this.store.getTask(l.taskId)?.spentUsd ?? 0) * 10_000) / 10_000 });
      this.end(l, "budget");
    } else if (why === "cap") {
      const error = tr("tasks.timeCap", { hours: Math.round((this.o.taskRunCapMs ?? TASK_RUN_CAP_MS) / 3600_000) || 1 });
      l.activity.end(error, now);
      log.warn("background task run hit its time cap; stopping it", { task: l.taskId, run: l.runId });
      this.end(l, "failed", undefined, error);
    } else {
      l.activity.end(tr("tasks.reserveStep"), now);
      log.warn("background task paused: the bot's budget is kept for chat", { task: l.taskId, run: l.runId });
      this.end(l, "interrupted", undefined, RUN_ERROR.reserve);
      const task = this.store.getTask(l.taskId);
      if (task && !task.endedAt) {
        this.addInput(task.id, "recovery", resumeNote("reserve", jobs), false);
        if (!this.queuedRun(task.id)) this.enqueue(task, "recover");
        this.changed(task.id);
      }
    }
    void this.o.host.cancel(l.botId, l.sessionId).catch((e) => log.warn("cancelling the task's turn failed", { task: l.taskId, message: (e as Error).message.slice(0, 200) }));
  }

  /** 停下之后才到的用量（取消到达之前已经发出去的请求）：记到停下的那个 run 和任务上，不再看预算 */
  private lateUsage(root: string, n: TaskNotification): void {
    const h = this.halted.get(root);
    const ev = n.params?.event;
    if (!h || n.method !== "session.event" || ev?.type !== "assistant/message" || !ev.data?.usage) return;
    if (this.now() > h.until) return void this.halted.delete(root);
    const model = String(ev.data.message?.source?.model ?? "");
    const usd = costOf(ev.data.usage, (model ? this.o.rates?.(model) : undefined) ?? (h.model ? this.o.rates?.(h.model) : undefined));
    const run = usd > 0 ? this.store.getRun(h.runId) : undefined;
    if (!run) return;
    this.store.updateRun(run.id, { costUsd: run.costUsd + usd });
    if (h.taskId) this.store.addTaskSpent(h.taskId, usd);
    const b = this.o.botBudget?.(h.botId);
    const cur = this.botSpend.get(h.botId);
    if (b) this.botSpend.set(h.botId, { at: b.at, usd: (cur?.at === b.at ? cur.usd : 0) + usd });
    this.changed(h.taskId || run.ruleId);
  }

  /** 机器人的预算要留给聊天：它在跑的后台 run 都停下（已经报了结果、只差收尾的除外） */
  private holdForReserve(botId: string): void {
    for (const l of [...this.live.values()]) if (l.botId === botId && !l.final) this.halt(l, "reserve");
    this.changed(botId);
  }

  /**
   * 机器人的 Modelflare 预算 Key 快用完了：剩下的（上次读到的余额减去之后估算花掉的）不到总额的 20%，就返回还剩多少、总额。
   * 没开预算（或没登录）是 undefined。
   */
  reserve(botId: string): { remainUsd: number; limitUsd: number } | undefined {
    const b = this.o.botBudget?.(botId);
    if (!b || !(b.limitUsd > 0)) {
      this.reserveSince.delete(botId);
      return undefined;
    }
    const spent = this.botSpend.get(botId);
    const remain = b.remainUsd - (spent?.at === b.at ? spent.usd : 0);
    if (remain >= RESERVE_SHARE * b.limitUsd) {
      this.reserveSince.delete(botId);
      return undefined;
    }
    if (!this.reserveSince.has(botId)) this.reserveSince.set(botId, this.now());
    return { remainUsd: Math.max(0, remain), limitUsd: b.limitUsd };
  }

  /** 应用读到了新的预算 Key 余额（或改了预算）：预算回来了，等着的开始；「需要你」跟着变 */
  budgetsChanged(): void {
    this.pump();
    this.scheduler.wake();
    this.changed("");
  }

  /**
   * 时间上限（每分钟看一次）：任务一次运行最多 4 小时，等人批准的时间不算（approvals 里这个 run 阻塞着的那几段）。
   * 已经报了结果、只差收尾的不算（收尾最多 30 分钟，插件管）。
   */
  checkCaps(now = this.now()): void {
    if (!this.started || this.closing) return;
    for (const [sid, h] of this.halted) if (now > h.until) this.halted.delete(sid);
    const cap = this.o.taskRunCapMs ?? TASK_RUN_CAP_MS;
    for (const l of [...this.live.values()]) {
      if (l.ruleId || l.final || this.live.get(l.runId) !== l) continue;
      const run = this.store.getRun(l.runId);
      if (!run?.startedAt) continue;
      if (now - run.startedAt - this.waitedMs(l.runId, now) >= cap) this.halt(l, "cap");
    }
  }

  /** 这个 run 里等人批准（或回答阻塞着的提问）一共等了多久 */
  private waitedMs(runId: string, now: number): number {
    let ms = 0;
    for (const a of this.store.listApprovals({ runId, limit: 100 })) if (a.blocking) ms += Math.max(0, Math.min(now, a.decidedAt || now) - a.createdAt);
    return ms;
  }

  /** 本月（主人的时区）从几号几点开始；next = 下个月 1 号 0 点 */
  private monthStart(now: number, next = false): number {
    const p = localParts(now, this.timeZone);
    const mo = next ? (p.mo === 12 ? 1 : p.mo + 1) : p.mo;
    const y = next && p.mo === 12 ? p.y + 1 : p.y;
    return localTime(y, mo, 1, 0, this.timeZone);
  }

  /** 规则本月（主人的时区）估算花了多少 */
  private monthSpent(rule: RuleRow, now = this.now()): number {
    return this.store.ruleSpent(rule.id, this.monthStart(now));
  }

  /** 定时器下次醒来：最早该跑的规则；有规则因为本月预算暂停着，还有下个月 1 号（到时自动恢复） */
  private nextWake(): number {
    const due = this.store.nextRuleDue();
    if (!this.store.listRules().some((r) => r.pausedReason === "budget")) return due;
    const month = this.monthStart(this.now(), true);
    return due ? Math.min(due, month) : month;
  }

  /**
   * 会话空了：交出去的输入都被收下了（不然是旧的空闲）、没有要交的了，就问插件还有没有后台命令、子代理；
   * 没有就结束这个 run，有就收尾（settling），等插件报 task-settled。
   */
  private async checkSettle(l: Live): Promise<void> {
    if (l.busy || l.starting || l.checking || l.timer || this.closing || this.live.get(l.runId) !== l) return;
    const open = this.inputsOf(l);
    if (open.some((i) => i.deliveredAt && i.runId === l.runId)) return;
    const waiting = open.filter((i) => !i.deliveredAt);
    if (waiting.length) return void this.deliver_(l, waiting);
    l.checking = true;
    let q: { quiet: boolean; jobs?: string[] };
    try {
      q = await this.o.host.quiet(l.botId, l.sessionId);
    } catch {
      q = { quiet: true };
    } finally {
      l.checking = false;
    }
    if (this.live.get(l.runId) !== l || l.busy || l.starting) return;
    // 问插件的时候来了输入（回答、追加）：先交给会话，不结束
    const late = this.inputsOf(l).filter((i) => !i.deliveredAt);
    if (late.length) return void this.deliver_(l, late);
    if (q.quiet) return this.finish(l);
    l.settling = true;
    this.store.updateRun(l.runId, { state: "settling" });
    this.changed(l.taskId || l.ruleId);
  }

  /** 插件：收尾中的会话安静下来了（后台命令、子代理都结束了，或者收尾超时被停掉了） */
  settled(b: any): { ok: true } {
    const l = this.bySession.get(String(b?.sessionId ?? ""));
    if (!l || l.busy || l.starting || l.checking) return { ok: true };
    const open = this.inputsOf(l);
    if (open.some((i) => i.deliveredAt && i.runId === l.runId)) return { ok: true };
    // 收尾时来了还没交出去的输入（回答、追加）：交给会话，接着做，不结束
    const waiting = open.filter((i) => !i.deliveredAt);
    if (waiting.length) {
      void this.deliver_(l, waiting);
      return { ok: true };
    }
    const killed = Array.isArray(b?.killedJobs) ? b.killedJobs.map(String) : [];
    if (killed.length) log.info("task settling timed out; background jobs were stopped", { task: l.taskId || l.ruleId, jobs: killed });
    this.finish(l);
    return { ok: true };
  }

  /**
   * 一轮结束、会话安静：有 done / failed 就按它结束；出错了过一会儿接着做（最多 3 次）；没报就提醒一次；还没有就失败。
   */
  private finish(l: Live): void {
    if (this.live.get(l.runId) !== l) return;
    if (l.final) return this.end(l, l.final.state === "done" ? "done" : l.final.state === "needs_you" ? "needs_you" : "failed", l.final);
    if (l.turnError && l.retries < this.delays.length) {
      const error = l.turnError;
      l.turnError = undefined;
      const delay = this.delays[l.retries++];
      log.warn("task turn failed; continuing after a pause", { task: l.taskId || l.ruleId, inMs: delay, message: error.slice(0, 200) });
      l.timer = setTimeout(() => {
        l.timer = undefined;
        void this.deliver_(l, [this.inputFor(l, "note", retryNote(error))]);
      }, delay);
      l.timer.unref?.();
      return;
    }
    if (!l.nudged) {
      l.nudged = true;
      void this.deliver_(l, [this.inputFor(l, "nudge", l.ruleId ? RULE_NUDGE : NUDGE)]);
      return;
    }
    if (l.turnError) log.warn("task failed after retries", { task: l.taskId || l.ruleId, message: l.turnError.slice(0, 300) });
    // 规则的 run 存原因的代码（运行记录按看的人的语言翻），任务的照旧存说给用户的那句
    if (l.ruleId) this.end(l, "failed", undefined, l.turnError ? RUN_ERROR.modelErrors : RUN_ERROR.noReport);
    else this.end(l, "failed", undefined, l.turnError ? tr("tasks.modelKeptFailing") : tr("tasks.noResult"));
  }

  /** 结束 run：存下步骤、结果；done / failed 发回会话；空出名额 */
  private end(l: Live, outcome: RunOutcome, report?: TaskReport, error = ""): void {
    if (this.live.get(l.runId) !== l) return;
    if (l.ruleId) return this.endRule(l, outcome, report, error);
    this.forget(l);
    const now = this.now();
    this.store.updateRun(l.runId, { state: "ended", outcome, report, error, endedAt: now, activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd });
    const task = this.store.getTask(l.taskId);
    if (task && outcome === "done") this.store.updateTask(task.id, { endedAt: now, endReason: "done", updatedAt: now });
    else if (task) this.store.updateTask(task.id, { updatedAt: now });
    if (task && (outcome === "done" || outcome === "failed")) this.deliver(task, l.runId, outcome, report, error);
    // 做完了还没回答的提问：有默认回答的就是按默认做了（结果里说了），作废、撤回；失败了也一样（重试时它会再问）
    if (task && (outcome === "done" || outcome === "failed")) this.withdrawQuestions(task, outcome === "done" ? "default" : "failed");
    // 报 needs_you 时已经问了（report）；这里只是兜底（同一个 run 同一个问题不会问两次）
    if (task && outcome === "needs_you" && report?.question) this.ask(task, l.runId, report.question);
    if (task && outcome === "budget") this.askBudget(task, l.runId);
    log.info("background task run ended", { task: l.taskId, run: l.runId, outcome, ...(error ? { error } : {}) });
    this.changed(l.taskId);
    this.pump();
    this.o.host.runEnded?.(l.botId);
  }

  private forget(l: Live): void {
    clearTimeout(l.timer);
    clearTimeout(l.capTimer);
    l.timer = undefined;
    l.capTimer = undefined;
    this.live.delete(l.runId);
    if (this.bySession.get(l.sessionId) === l) this.bySession.delete(l.sessionId);
  }

  // ---------- 送达 ----------

  /**
   * 把结果（或失败）发回请求它的会话：微信、飞书按主动消息的规则推送（id 固定：task:<任务>:result|failure:<run>，同一 id 只发一次；
   * 免打扰时排到早上、几条一起到的合成摘要，微信在发送时才查 24 小时窗口和配额），飞书回复在请求那条消息下；
   * 网页只写进会话历史。同时写进会话历史，给聊天代理留一张便条。交过的 run 不再交（重启后补送也一样）。
   */
  private deliver(task: TaskRow, runId: string, outcome: "done" | "failed", report: TaskReport | undefined, error: string): void {
    const run = this.store.getRun(runId);
    if (!run || run.delivery) return;
    const conv = this.store.getConversation(task.conversationId);
    const purpose = outcome === "done" ? "result" : "failure";
    const id = `task:${task.id}:${purpose}:${runId}`;
    if (!conv) {
      this.store.updateRun(runId, { delivery: `${id}:dropped` });
      return;
    }
    const msg = oneLine(report?.message ?? "");
    const pushed = (conv.channel === "weixin" || conv.channel === "feishu") && !!this.o.delivery;
    // 结果后面那句「引用这条消息可以继续问」（失败那句本来就说了怎么办）：微信总有；飞书只在结果回复在请求那条消息下时有
    // （回复链对得上才认得出是哪个任务，见 followUp）。连它一起不超过 300 字
    const hint = pushed && outcome === "done" ? (conv.channel === "weixin" ? tr("tasks.hintQuote") : task.originRef ? tr("tasks.hintReply") : "") : "";
    const text = outcome === "done" ? clip(msg, MESSAGE_MAX - (hint ? hint.length + 2 : 0)) || tr("tasks.done", { title: task.title }) : tr("tasks.notDone", { title: task.title, why: clip(msg || error || tr("tasks.noResult"), MESSAGE_MAX) });
    const files = outcome === "done" ? this.files(task, report?.files ?? []) : [];
    if (pushed) this.post(conv, task, id, purpose, text, files, hint);
    // 交付的文件跟着这条消息存下：网页对话里是文件卡片（图片直接显示），点开就能看
    this.store.addMessage(conv.id, "assistant", text, undefined, { files });
    this.store.updateRun(runId, { delivery: id });
    this.note(conv.id, outcome === "done" ? `[后台任务「${task.title}」已完成，已把结果发给用户] ${text}` : `[后台任务「${task.title}」失败了，已告诉用户] ${text}`);
  }

  /** 微信、飞书：按主动消息的规则写进出站队列（同步落库；渠道没上线时等它上线） */
  private post(conv: Conversation, task: TaskRow, id: string, purpose: "result" | "failure", text: string, files: string[], hint: string): void {
    const channel = conv.channel as "weixin" | "feishu";
    const replyTo = channel === "feishu" ? task.originRef || replyHandle(this.store, conv.id).messageId || "" : "";
    const notice = channel === "feishu" && !replyTo;
    this.o.delivery!.push({
      id,
      botId: task.botId,
      channel,
      peerId: conv.peerId,
      purpose,
      subject: task.title,
      text,
      ...(hint ? { hint } : {}),
      files: notice ? [] : files,
      replyTo,
      kind: notice ? "notice" : "text",
      anytime: task.anytime,
      ref: `task:${task.id}`,
    });
  }

  /** task_report 里的文件：先按任务文件夹找，再按工作区找；只交工作区里真实存在的文件 */
  private files(task: TaskRow, list: string[]): string[] {
    const ws = this.o.host.workspace(task.botId);
    const folder = path.join(ws, task.folder);
    return deliverables(
      ws,
      list.map((f) => {
        const inFolder = path.resolve(folder, f);
        return fs.existsSync(inFolder) ? inFolder : path.resolve(ws, f);
      }),
    );
  }

  private note(conversationId: string, line: string): void {
    let list: string[] = [];
    try {
      list = JSON.parse(this.store.getKV(NOTES + conversationId) || "[]");
    } catch {
      list = [];
    }
    list.push(clip(line, 500));
    this.store.setKV(NOTES + conversationId, JSON.stringify(list.slice(-5)));
  }

  // ---------- 插件经 bridge 来的 ----------

  /**
   * task_report：记下 Report；done / failed 在这一轮结束、会话安静后发给用户。needs_you 的问题马上问用户（推出去、进「需要你」）：
   * 带默认回答的，代理接着做（回答在它的下一步到，同追加）；没带的，代理结束这一轮，安静后 run 以 needs_you 结束、任务等着回答。
   */
  report(b: any): { text?: string; error?: string } {
    const l = this.bySession.get(String(b?.sessionId ?? ""));
    if (!l) return { error: "This background task is not running any more (it was stopped or has ended). Stop working on it." };
    if (l.ruleId) return this.ruleReport(l, b);
    const state = String(b?.state ?? "");
    if (state !== "progress" && state !== "done" && state !== "failed" && state !== "needs_you") return { error: "state must be progress, needs_you, done or failed" };
    const question = state === "needs_you" ? questionOf(b) : undefined;
    if (state === "needs_you" && !question) return { error: "needs_you needs a question: one question for the user, with options when there are clear choices." };
    if (question?.default && question.options?.length && !question.options.includes(question.default)) return { error: `default must be one of the options: ${question.options.join(" / ")}.` };
    if (state === "needs_you" && !this.o.approvals) return { error: "The app cannot ask the user right now. Decide yourself and say so in the result." };
    const message = typeof b?.message === "string" ? oneLine(b.message) : "";
    const report: TaskReport = {
      state,
      summary: clip(String(b?.summary ?? "").trim(), 2000),
      ...(message ? { message: clip(message, MESSAGE_MAX) } : {}),
      ...(Array.isArray(b?.files) && b.files.length ? { files: b.files.map(String).slice(0, 8) } : {}),
      ...(question ? { question } : {}),
      at: this.now(),
    };
    this.store.updateRun(l.runId, { report });
    this.store.updateTask(l.taskId, { report, updatedAt: this.now() });
    // 带默认回答的问题不结束这个 run（代理接着做），其余的 done / failed / needs_you 是这一轮的结果
    if (state !== "progress" && !question?.default) l.final = report;
    const task = question ? this.store.getTask(l.taskId) : undefined;
    if (task && question) this.ask(task, l.runId, question);
    this.changed(l.taskId);
    if (state === "progress") return { text: "Progress recorded (it is not sent to the user). Continue the task." };
    if (question?.default)
      return {
        text: `Asked the user. Keep working on what does not depend on the answer; if they answer, it arrives as a message at your next step. If you finish first, use "${question.default}", say so in your message, and report done.`,
      };
    if (state === "needs_you") return { text: "Recorded. End your turn now: the app asks the user, and their answer arrives as your next message." };
    return { text: `Recorded. End your turn now: the app sends your message to the user${state === "done" && !message ? " (you gave no message, so the user only hears that the task is done)" : ""}.` };
  }

  /** 聊天代理的工具：task_start / task_message / task_list */
  async chatTool(b: any): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    const convId = this.store.conversationForSession(String(b?.sessionId ?? ""));
    const conv = convId ? this.store.getConversation(convId) : undefined;
    if (!conv || conv.botId !== botId) return { error: "Background tasks can only be managed from a chat with the user." };
    const a = (b?.args ?? {}) as Record<string, unknown>;
    switch (String(b?.op ?? "")) {
      case "start": {
        const low = this.reserve(botId);
        if (low)
          return {
            error: `This bot's Modelflare budget is almost used up (about ${usdText(low.remainUsd)} of ${stepText(low.limitUsd)} left) and the rest is kept for chat, so no background task can start. Tell the user in one sentence; they can raise the bot's budget in its settings.`,
          };
        const r = this.create({ botId, conversationId: conv.id, title: String(a.title ?? ""), brief: String(a.brief ?? ""), budgetUsd: Number(a.budget_usd) || undefined, anytime: a.anytime === true });
        if (!r.task) return { error: r.error };
        if (this.paused(botId))
          return { text: `Queued background task ${r.task.id} 「${r.task.title}」, but background work is paused, so it starts only when the user resumes it. Tell the user so in one sentence. Do not do the task yourself.` };
        return {
          text: `Started background task ${r.task.id} 「${r.task.title}」 in folder ${r.task.folder}. In your reply, tell the user in one sentence what now runs in the background and that they will hear back when it is done; they can keep chatting. Do not do the task yourself.`,
        };
      }
      case "message": {
        const task = this.find(conv.id, String(a.task ?? ""));
        if (!task) return { error: `No background task matches "${String(a.task ?? "")}". Call task_list to see them.` };
        const r = await this.message(task.id, String(a.text ?? ""));
        if (r.error) return { error: r.error };
        const how = { steered: "It reaches the task at its next step.", sent: "The task picks it up now.", queued: "The task gets it when it starts.", resumed: "The finished task resumes with it.", answered: "It answers the task's open question; the task continues." }[r.how!];
        return { text: `Passed to 「${task.title}」. ${how} Tell the user in one short sentence.` };
      }
      case "list": {
        const list = this.list({ conversationId: conv.id, limit: 10 });
        const rules = this.listRules({ conversationId: conv.id });
        const paused = this.paused(botId) ? ["Background work is paused: no task or rule runs, pushed messages wait."] : [];
        if (!list.length && !rules.length) return { text: [...paused, "This conversation has no background tasks or rules."].join("\n") };
        return {
          text: [
            ...paused,
            ...list.map((t) => `${t.id} 「${t.title}」 ${t.stage.label}${t.latest ? ` — ${t.latest}` : ""}`),
            ...rules.map((r) => `rule ${r.id} 「${r.title}」 ${r.when} · ${r.state.label}${r.last ? ` — ${r.last.line}` : ""}`),
          ].join("\n"),
        };
      }
      case "rule_create":
        return this.ruleCreateTool(conv, a);
      case "rule_update":
        return this.ruleUpdateTool(conv, a);
      case "pause": {
        const paused = a.paused === true;
        if (typeof a.paused !== "boolean") return { error: "paused must be true or false" };
        const was = this.paused(botId);
        this.setPaused(botId, paused, `chat:${conv.id}`);
        if (paused) return { text: `${was ? "Background work was already paused" : "Paused this bot's background work"}: no task or rule runs, pushed messages wait; chat still works. Tell the user in one short sentence.` };
        return { text: `${was ? "Resumed background work: waiting tasks start and held messages go out" : "Background work was not paused; nothing changed"}. Tell the user in one short sentence.` };
      }
      default:
        return { error: "unknown task tool" };
    }
  }

  /** 按 id 或标题里的字找这个会话的任务（新的在前） */
  private find(conversationId: string, ref: string): TaskRow | undefined {
    const r = ref.trim();
    if (!r) return undefined;
    const list = this.store.listTasks({ conversationId, limit: 50 });
    return list.find((t) => t.id === r || t.sessionId === r) ?? list.find((t) => t.title.includes(r) || r.includes(t.title));
  }

  /** 任务会话所在的聊天（任务会话里的审批落到请求它的会话） */
  conversationOf(sessionId: string): string | undefined {
    return this.taskOfSession(sessionId)?.conversationId;
  }

  /** 任务会话（或它的子代理：root 是所在的任务会话）属于哪个任务、哪个 run、哪个会话 */
  taskOfSession(sessionId: string, root?: string): { taskId: string; runId: string; conversationId: string } | undefined {
    const l = this.bySession.get(sessionId) ?? (root ? this.bySession.get(root) : undefined);
    const task = l ? this.store.getTask(l.taskId) : (this.store.taskBySession(sessionId) ?? (root ? this.store.taskBySession(root) : undefined));
    if (!task) return undefined;
    return { taskId: task.id, runId: l?.runId ?? this.store.latestRun(task.id)?.id ?? "", conversationId: task.conversationId };
  }

  // ---------- 提问与审批（3b） ----------

  /**
   * 代理报了 needs_you：马上把问题记成一条不阻塞、不过期的提问（审批中心建好就推，见 onApproval），给聊天代理留张便条。
   * 同一个问题只问一次：还开着的（重启后恢复的 run 又问一遍），或这个 run 里问过的（重启后补问）都不再问；
   * 同一个问题换了默认回答（或去掉了默认），开着的那个作废、以新的为准。
   */
  private ask(task: TaskRow, runId: string, q: NonNullable<TaskReport["question"]>): void {
    const a = this.o.approvals;
    if (!a) return;
    const same = this.store.listApprovals({ taskId: task.id, limit: 100 }).filter((r) => r.kind === "question" && r.tool === "task_report" && r.detail === q.question);
    if (same.some((r) => (r.status === "pending" || r.runId === runId) && (defaultOf(r) ?? "") === (q.default ?? ""))) return;
    for (const r of same) if (r.status === "pending") a.cancel(r.id, "superseded");
    const item: QuestionItem = {
      id: "answer",
      question: q.question,
      ...(q.options?.length ? { options: q.options.map((label) => ({ label })) } : {}),
      ...(q.multiSelect ? { multiSelect: true } : {}),
      ...(q.default ? { default: q.default } : {}),
    };
    a.create({ kind: "question", botId: task.botId, conversationId: task.conversationId, sessionId: task.sessionId, tool: "task_report", detail: q.question, reason: "", payload: JSON.stringify([item]), taskId: task.id, runId, blocking: false, ttlMs: 0 });
    log.info("background task asks the user", { task: task.id, run: runId, ...(q.default ? { keepsWorking: true } : {}) });
    const opts = q.options?.length ? `（${q.options.join(" / ")}）` : "";
    this.note(
      task.conversationId,
      q.default
        ? `[后台任务「${task.title}」问了用户：${q.question}${opts}，没回答就按「${q.default}」做，任务照常在做。用户在聊天里回答它时，用 task_message 转给这个任务]`
        : `[后台任务「${task.title}」在等用户回答：${q.question}${opts}。用户在聊天里回答它时，用 task_message 转给这个任务]`,
    );
  }

  /** 任务做完了（按默认回答做的，或做不下去了）：它还开着的提问作废，「需要你」里的、推给用户还没发出去的随之撤回（onApproval） */
  private withdrawQuestions(task: TaskRow, by: "default" | "failed"): void {
    for (const r of this.o.approvals?.pendingForTask(task.id) ?? []) {
      if (r.kind !== "question" || r.tool !== "task_report") continue;
      this.o.approvals!.cancel(r.id, by);
      log.info("withdrew a background task's open question", { task: task.id, by, ...(defaultOf(r) ? { usedDefault: by === "default" } : {}) });
    }
  }

  /** 审批中心有新的、或有了决定：任务的提问有了回答就交给任务；更新阶段；同一会话的下一个提问可以推了 */
  private onApproval(e: ApprovalEvent): void {
    const row = e.row;
    if (row.ruleId) return this.onRuleApproval(e);
    if (!row.taskId) return;
    const task = this.store.getTask(row.taskId);
    if (!task) return;
    if (e.type === "decided" && row.kind === "question" && !row.blocking && row.status === "answered" && task.endReason !== "stopped") this.answered(task, row);
    // 有了决定（在桌面上回答了、批了，任务停了）：推给用户还没发出去的那条（排到早上、等微信窗口）不用再发了
    if (e.type === "decided") this.o.delivery?.withdraw(askId(row), tr(row.status === "answered" ? "tasks.withdrawAnswered" : "tasks.withdrawHandled"));
    this.changed(task.id);
    // 等批准时让出的名额：有了决定，排队的可能要等它了
    if (e.type === "decided" && row.blocking) this.pump();
    this.pushNext(row.conversationId);
  }

  /** 用户回答了任务的提问：回答成为任务的新输入（人的唤醒：预留名额、排在前面）；预算的那个由任务服务自己处理 */
  private answered(task: TaskRow, row: ApprovalRow): void {
    if (row.tool === BUDGET_TOOL) return this.budgetAnswered(task, row);
    const q = questionsOf(row)[0]?.question ?? row.detail;
    const input = this.addInput(task.id, "answer", `[用户回答了你的问题]\n问题：${q}\n回答：${answerLine(row) || "（没有写）"}`, true);
    log.info("the user answered a background task's question", { task: task.id, by: row.decidedBy });
    void this.wake(task, input, "answer");
  }

  /**
   * 任务的预算用完了（3e）：问用户「已用约 $1.00，再给 $1 继续？」——一个不阻塞、不过期的提问（选项：继续 / 停止），
   * 和任务的提问走同一条路：推给请求它的会话（一个会话一次一个）、在「需要你」里、回编号或引用回答。一个任务同时只问一个。
   */
  private askBudget(task: TaskRow, runId: string): void {
    const a = this.o.approvals;
    if (!a || a.pendingForTask(task.id).some((r) => r.tool === BUDGET_TOOL)) return;
    const spent = this.store.getTask(task.id)?.spentUsd ?? task.spentUsd;
    const question = tr("tasks.budgetAsk", { spent: usdText(spent), add: stepText(TASK_BUDGET_STEP_USD) });
    const go = tr("tasks.budgetGo");
    const stop = tr("tasks.budgetStop");
    const item: QuestionItem = { id: "budget", question, options: [{ label: go }, { label: stop }] };
    a.create({ kind: "question", botId: task.botId, conversationId: task.conversationId, sessionId: task.sessionId, tool: BUDGET_TOOL, detail: question, reason: "", payload: JSON.stringify([item]), taskId: task.id, runId, blocking: false, ttlMs: 0 });
    log.info("background task asks the user for more budget", { task: task.id, run: runId });
    this.note(task.conversationId, `[后台任务「${task.title}」预算用完，在等用户决定：${question}（${go} / ${stop}）。用户在聊天里回答它时，用 task_message 转给这个任务]`);
  }

  /**
   * 用户回答了要不要加预算：选「停止」或说不要了 → 停掉任务；选「继续」→ 加 $1 接着做；自己写的：有金额就加那么多，
   * 别的话连同加预算一起交给任务（「继续，改成英文」）。
   */
  private budgetAnswered(task: TaskRow, row: ApprovalRow): void {
    const [go, stop] = (questionsOf(row)[0]?.options ?? []).map((o) => o.label);
    const said = answerLine(row).trim();
    const by = row.decidedBy || "user";
    if (said === stop || STOP_WORDS.test(said)) {
      log.info("the user stopped a background task at its budget", { task: task.id, by });
      void this.stopTask(task.id, by);
      return;
    }
    const custom = said && said !== go ? said : "";
    const amount = custom ? amountIn(custom) : undefined;
    const extra = custom && !AMOUNT_ONLY.test(custom) ? custom : "";
    void this.addBudget(task.id, amount ?? TASK_BUDGET_STEP_USD, by, extra);
  }

  /**
   * 加预算（「需要你」里的继续、预算提问的回答、POST /tasks/:id/budget {addUsd}）：预算加上 addUsd（加完还不够已花的，就从已花的再加）；
   * 停在预算上的任务接着做（人的唤醒：continue run，第一条是说明），还在等的那个预算提问作废。没停的只是把预算调高。
   */
  async addBudget(taskId: string, addUsd: number = TASK_BUDGET_STEP_USD, by = "web", text = ""): Promise<{ task?: TaskView; error?: string }> {
    const add = Number(addUsd);
    return this.changeBudget(taskId, Number.isFinite(add) && add > 0 && add <= 100, (t) => {
      const raised = t.budgetUsd + add;
      return raised > t.spentUsd ? raised : t.spentUsd + add;
    }, by, text);
  }

  /**
   * 改预算（3f：任务详情里改，POST /tasks/:id/budget {budgetUsd}）：预算就是这个数，调低也行（在跑的、花到了就停下问）；
   * 比已花的多、又停在预算上的，接着做（同加预算）。
   */
  async setBudget(taskId: string, budgetUsd: number, by = "web"): Promise<{ task?: TaskView; error?: string }> {
    const v = Number(budgetUsd);
    return this.changeBudget(taskId, Number.isFinite(v) && v > 0 && v <= TASK_BUDGET_MAX_USD, () => v, by, "");
  }

  private async changeBudget(taskId: string, ok: boolean, next: (t: TaskRow) => number, by: string, text: string): Promise<{ task?: TaskView; error?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { error: "task not found" };
    if (task.endReason === "stopped") return { error: tr("tasks.stoppedShort", { title: task.title }) };
    if (task.endReason === "archived") return { error: tr("tasks.archivedNoFollowup", { title: task.title }) };
    if (!ok) return { error: tr("tasks.badBudget") };
    const budget = Math.round(Math.min(TASK_BUDGET_MAX_USD, next(task)) * 100) / 100;
    this.store.updateTask(task.id, { budgetUsd: budget, updatedAt: this.now() });
    log.info("background task budget changed", { task: task.id, budgetUsd: budget, by });
    if (budget > task.spentUsd) {
      for (const r of this.o.approvals?.pendingForTask(task.id) ?? []) if (r.tool === BUDGET_TOOL) this.o.approvals!.cancel(r.id, by);
      const last = this.store.latestRun(task.id);
      if (last?.state === "ended" && last.outcome === "budget") {
        const jobs = parseSteps(this.store.getRun(last.id)?.activity)
          .filter((s) => s.kind === "job" && s.cut)
          .map((s) => clip(oneLine(s.summary || s.title), 120));
        const input = this.addInput(task.id, "followup", `${resumeNote("budget", jobs)}${text ? `\n\n[用户追加]\n${text.trim()}` : ""}`, true);
        await this.wake(this.store.getTask(task.id)!, input, "continue");
      }
    } else {
      // 调到已花的以下：在跑的这就停下，问要不要加
      const l = this.liveOf(task.id);
      if (l) this.checkBudgets(l);
    }
    this.changed(task.id);
    return { task: this.get(task.id) };
  }

  /**
   * 推给请求它的会话（微信、飞书；网页的提问卡片就在对话里）：一个会话同时只推一个，前一个没回答，后面的只在"需要你"里等，
   * 微信里光回编号才不会认错。按主动消息的规则推（core/delivery.ts：免打扰、每天上限；问题不合并）：排着的、留着的都算推了。
   * 出站 id 固定（askId），同一条只推一次；发不出去（微信窗口关了）由出站队列留着。
   */
  private pushNext(conversationId: string): void {
    const a = this.o.approvals;
    const delivery = this.o.delivery;
    if (!a || !delivery || !this.started) return;
    const conv = this.store.getConversation(conversationId);
    if (!conv || (conv.channel !== "weixin" && conv.channel !== "feishu")) return;
    const rows = a.pending(conversationId).filter((r) => r.taskId).sort((x, y) => x.createdAt - y.createdAt);
    const pushed = (r: ApprovalRow) => this.store.getOutbox(askId(r));
    if (rows.some((r) => (pushed(r)?.status ?? "gone") !== "gone")) return;
    const row = rows.find((r) => !pushed(r));
    const task = row ? this.store.getTask(row.taskId) : undefined;
    if (!row || !task || task.endReason === "stopped") return;
    const text = taskPromptText(row, task.title);
    const base = { id: askId(row), botId: task.botId, channel: conv.channel as "weixin" | "feishu", peerId: conv.peerId, purpose: "question" as const, subject: task.title, text, ref: `task:${task.id}` };
    if (conv.channel === "weixin") delivery.push({ ...base, raw: true });
    else {
      const replyTo = task.originRef || replyHandle(this.store, conv.id).messageId || "";
      const buttons = promptButtons(row);
      const title = row.kind === "approval" ? tr("tasks.approvalTitle", { title: task.title }) : tr("tasks.questionTitle", { title: task.title });
      const fallback = defaultLine(row);
      const body = row.kind === "approval" ? (row.detail ? "`" + row.detail.slice(0, 300) + "`" : row.tool) : `${questionsOf(row)[0]?.question ?? row.detail}${fallback ? `\n${fallback}` : ""}`;
      if (replyTo && buttons) delivery.push({ ...base, replyTo, card: actionCardSpec(title, body, buttons) });
      else delivery.push({ ...base, replyTo, kind: replyTo ? "text" : "notice" });
    }
    if (row.kind === "question") this.store.addMessage(conv.id, "assistant", text);
    log.info("pushed a background task's prompt", { task: task.id, kind: row.kind, channel: conv.channel });
  }

  /**
   * 渠道里的回复怎么认任务的提问（ApprovalCenter.handleReply 用）：推给用户的那条是不是机器人最后一条消息（出站队列里这个会话最新的一条）、
   * 引用的是不是那一条（按推出去的原文比，引用可能被截短、前面带名字）、回答之后回一句"收到"。
   */
  replyContext(conversationId: string): ReplyContext {
    return {
      latest: (row) => !!row.taskId && this.store.lastOutbox(conversationId)?.id === askId(row),
      quotes: (row, quote) => !!row.taskId && quotes(this.store.getOutbox(askId(row))?.body.text ?? "", quote, questionsOf(row)[0]?.question ?? row.detail),
      answered: (row) => {
        const t = this.store.getTask(row.taskId);
        // 预算用完时回了「停止」：说停了
        return t ? tr(t.endReason === "stopped" ? "tasks.stoppedTask" : "tasks.continuing", { title: t.title }) : undefined;
      },
    };
  }

  /**
   * 渠道里的一条消息是不是对某个任务的追加（设计 3「Follow-ups and routing」）：微信引用了推出去的结果或失败那句，
   * 飞书发在请求那条消息的回复链里（结果就回复在它下面）。是就直接交给任务（同 task_message：在跑就并进去，
   * 做完了、失败了在同一个任务里接着做），回一句收到，不经聊天代理；停了的照旧说不能再追加。
   * 对不上、对上不止一个（引用了合成的摘要）就是普通聊天。runtime.interceptReply 在任务的提问、审批之后调用。
   */
  followUp(conversationId: string, m: { text: string; quote?: string; rootId?: string; parentId?: string }): { handled: boolean; ack?: string } {
    const text = m.text.trim();
    if (!text || text.startsWith("/")) return { handled: false };
    const hit = this.followTarget(conversationId, m);
    if (!hit) return { handled: false };
    const { task, asked } = hit;
    if (task.endReason === "stopped") return { handled: true, ack: tr("tasks.stoppedNoFollowup", { title: task.title }) };
    if (asked) return this.lateAnswer(task, asked, text);
    log.info("a follow-up goes straight to its background task", { task: task.id, by: m.quote ? "quote" : "thread" });
    void this.message(task.id, text).catch((e) => log.warn("follow-up to a background task failed", { task: task.id, message: (e as Error).message.slice(0, 200) }));
    return { handled: true, ack: tr("tasks.continuing", { title: task.title }) };
  }

  /**
   * 引用的是哪个任务推出去的结果或失败那句（按发出去的原文比，取最像的，见 quoteScore），或它推出去、之后撤回了的提问
   * （任务按默认回答先做完了，asked 是那一条）；飞书按回复链的根、直接回复的那条比请求那条消息。
   * 对上不止一个（引用了合成的摘要、一条消息开了两个任务）就不算
   */
  private followTarget(conversationId: string, m: { quote?: string; rootId?: string; parentId?: string }): { task: TaskRow; asked?: ApprovalRow } | undefined {
    const tasks = this.store.listTasks({ conversationId, limit: 50 });
    let hits: Array<{ task: TaskRow; asked?: ApprovalRow }> = [];
    if (m.quote) {
      const quote = m.quote;
      const score = (t: TaskRow): { s: number; asked?: ApprovalRow } => {
        let best: { s: number; asked?: ApprovalRow } = { s: 0 };
        for (const r of this.store.listRuns({ taskId: t.id })) {
          if (!/^task:[^:]+:(result|failure):/.test(r.delivery) || r.delivery.endsWith(":dropped")) continue;
          const row = this.store.getOutbox(r.delivery);
          const s = row ? quoteScore(sentText(row.body), row.body.text ?? "", quote) : 0;
          if (s > best.s) best = { s };
        }
        for (const a of this.withdrawnAsks(t.id)) {
          const row = this.store.getOutbox(askId(a));
          if (row?.status !== "sent") continue;
          const s = Math.max(quoteScore(sentText(row.body), row.body.text ?? "", quote), quotes(row.body.text ?? "", quote, questionsOf(a)[0]?.question ?? a.detail) ? 2 : 0);
          if (s > best.s) best = { s, asked: a };
        }
        return best;
      };
      const scored = tasks.map((t) => ({ task: t, ...score(t) }));
      const best = Math.max(0, ...scored.map((x) => x.s));
      hits = best ? scored.filter((x) => x.s === best).map((x) => ({ task: x.task, asked: x.asked })) : [];
    } else {
      const refs = [m.rootId, m.parentId].filter(Boolean);
      if (refs.length) hits = tasks.filter((t) => !!t.originRef && refs.includes(t.originRef)).map((task) => ({ task }));
    }
    return hits.length === 1 ? hits[0] : undefined;
  }

  /** 任务问过、因为它先做完了（按默认回答）或失败了而撤回的提问（新的在前） */
  private withdrawnAsks(taskId: string): ApprovalRow[] {
    return this.store.listApprovals({ taskId, status: "cancelled", limit: 20 }).filter((a) => a.kind === "question" && a.tool === "task_report" && (a.decidedBy === "default" || a.decidedBy === "failed"));
  }

  /**
   * 撤回了的提问又被回答了（微信引用那条提问、飞书点了卡片上的按钮）：任务已经按默认做完（或失败了），这个回答作为追加交给它，
   * 在同一个任务里接着做（人的唤醒），回一句收到。编号按那个问题的选项认。
   */
  private lateAnswer(task: TaskRow, asked: ApprovalRow, text: string): { handled: boolean; ack?: string } {
    if (task.endReason === "stopped") return { handled: true, ack: tr("tasks.stoppedNoFollowup", { title: task.title }) };
    if (task.endReason === "archived") return { handled: true, ack: tr("tasks.archivedNoFollowup", { title: task.title }) };
    const qs = questionsOf(asked);
    const a = parseAnswer(qs, text).answers[0];
    const said = a ? [...a.selected, ...(a.custom ? [a.custom] : [])].join("、") : text;
    const used = asked.decidedBy === "default" ? defaultOf(asked) : undefined;
    const head = used ? `[用户回答了你之前问的问题（你已经按「${used}」做完了）]` : "[用户回答了你之前问的问题]";
    const input = this.addInput(task.id, "answer", `${head}\n问题：${qs[0]?.question ?? asked.detail}\n回答：${said || text}`, true);
    log.info("a late answer to a withdrawn question goes to its background task", { task: task.id });
    void this.wake(task, input, "answer").catch((e) => log.warn("late answer to a background task failed", { task: task.id, message: (e as Error).message.slice(0, 200) }));
    return { handled: true, ack: tr("tasks.continuing", { title: task.title }) };
  }

  /** 飞书卡片上的按钮：提问已经撤回（任务按默认先做完了），按钮还点得到——当作迟到的回答（同引用那条提问） */
  answerWithdrawn(approvalId: string, text: string): { handled: boolean; ack?: string } {
    const row = this.store.getApproval(approvalId);
    const task = row?.taskId ? this.store.getTask(row.taskId) : undefined;
    if (!row || !task || !this.withdrawnAsks(task.id).some((a) => a.id === row.id)) return { handled: false };
    return this.lateAnswer(task, row, text);
  }

  /**
   * "需要你"里任务那一份：失败的；预算用完的（平常由审批中心那一份给：那个「再给 $1 继续？」的提问；这里只在它不在时补上）；
   * 机器人的预算留给聊天、后台工作停着的（一个机器人一行，没有后台工作时不提）。
   * 提问和审批由审批中心那一份给，没送到的由出站队列那一份给（core/delivery.ts）。
   */
  attention(): AttentionItem[] {
    const out: AttentionItem[] = [];
    const since = this.now() - 7 * 86400_000;
    const tasks = [...this.store.listTasks({ open: true, limit: 200 }), ...this.store.listTasks({ open: false, since, limit: 100 })];
    const asking = new Set((this.o.approvals?.pendingAll() ?? []).filter((a) => a.tool === BUDGET_TOOL).map((a) => a.taskId));
    for (const t of tasks) {
      const run = this.store.latestRun(t.id);
      const st = this.stage(t, run);
      if (st.key !== "failed" && st.key !== "needs-you/budget") continue;
      if (st.key === "needs-you/budget" && asking.has(t.id)) continue;
      const bot = this.store.getBot(t.botId);
      const conv = this.store.getConversation(t.conversationId);
      const r = run?.report ?? t.report;
      const line = st.key === "failed" ? r?.message || run?.error || tr("tasks.noResult") : tr("tasks.budgetAsk", { spent: usdText(t.spentUsd), add: stepText(TASK_BUDGET_STEP_USD) });
      out.push({
        id: `task:${t.id}`,
        kind: "failed",
        botId: t.botId,
        botName: bot?.name ?? t.botId,
        subject: t.title,
        status: st.label,
        head: tr(st.key === "failed" ? "tasks.headFailed" : "tasks.headBudget", { title: t.title }),
        line: clip(oneLine(line), 200),
        since: run?.endedAt || t.updatedAt,
        severity: st.key === "failed" ? "err" : "warn",
        actions: st.key === "failed" ? ["retry", "stop"] : ["continue", "stop"],
        conversationId: t.conversationId,
        channel: conv?.channel ?? "",
        taskId: t.id,
      });
    }
    for (const bot of this.store.listBots()) {
      const low = this.reserve(bot.id);
      if (!low || !this.hasBackground(bot.id)) continue;
      out.push({
        id: `reserve:${bot.id}`,
        kind: "budget",
        botId: bot.id,
        botName: bot.name,
        subject: tr("tasks.reserveSubject"),
        status: "",
        head: tr("tasks.reserveSubject"),
        line: tr("tasks.reserveLine", { remain: usdText(low.remainUsd), limit: stepText(low.limitUsd) }),
        since: this.reserveSince.get(bot.id) ?? this.now(),
        severity: "warn",
        actions: ["open"],
      });
    }
    return out;
  }

  /** 这个机器人有没有后台工作：排着、在跑的 run，或开着的规则 */
  private hasBackground(botId: string): boolean {
    return this.store.listRuns({ botId, states: ["queued", "running", "settling"], limit: 1 }).length > 0 || this.store.listRules({ botId }).some((r) => r.mode !== "off" && !r.pausedReason);
  }

  // ---------- 查看 ----------

  private stage(task: TaskRow, run = this.store.latestRun(task.id)): Stage {
    // 结果没送到：留着等对方发消息、一直失败、放弃了（合进摘要的看那一条）；排着等早上的、在「需要你」里不再提示的不算
    const delivery = run?.delivery && !run.delivery.endsWith(":dropped") ? this.o.store.carrierOutbox(run.delivery) : undefined;
    // 它在等的：任务会话（或子代理）里的审批、它报的提问（预算用完时的那个提问不算：阶段是预算用完）
    const now = this.now();
    const rows = this.store
      .listApprovals({ status: "pending", botId: task.botId, limit: 200 })
      .filter((a) => (a.taskId === task.id || a.sessionId === task.sessionId) && a.tool !== BUDGET_TOOL && (a.expiresAt === 0 || a.expiresAt > now));
    // 有默认回答的提问不算等你：任务接着做（进行中，有个问题等你回答）
    const blocking = rows.filter((a) => a.kind === "approval" || !defaultOf(a));
    const waiting = blocking.some((a) => a.kind === "approval") ? "approval" : blocking.length ? "answer" : undefined;
    const asking = rows.some((a) => a.kind === "question" && !!defaultOf(a));
    return taskStage({ stopped: task.endReason === "stopped", undelivered: needsPerson(delivery), waiting, asking, run });
  }

  view(task: TaskRow): TaskView {
    const run = this.store.latestRun(task.id);
    const l = run ? this.live.get(run.id) : undefined;
    const r = task.report;
    const conv = this.store.getConversation(task.conversationId);
    return {
      id: task.id,
      botId: task.botId,
      conversationId: task.conversationId,
      channel: conv?.channel ?? "",
      title: task.title,
      stage: this.stage(task, run),
      latest: r ? clip(oneLine(r.message || r.summary.split("\n")[0] || ""), 120) : "",
      folder: task.folder,
      originMessageId: task.originMessageId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      endedAt: task.endedAt,
      runs: this.store.listRuns({ taskId: task.id }).length,
      spentUsd: task.spentUsd,
      budgetUsd: task.budgetUsd,
      cleanupAt: task.cleanupAt,
      ...this.openQuestion(task),
      ...(l && run ? { live: { runId: run.id, since: run.startedAt, steps: l.activity.steps.length, current: l.activity.steps.findLast((s) => s.status === "running") } } : {}),
    };
  }

  /** 任务问用户的、还没回答的那个问题（最新的；预算的那个不算，它有自己的阶段） */
  private openQuestion(task: TaskRow): Pick<TaskView, "question"> {
    const row = this.o.approvals?.pendingForTask(task.id).find((r) => r.kind === "question" && r.tool === "task_report");
    if (!row) return {};
    const note = defaultLine(row);
    return { question: { text: questionsOf(row)[0]?.question ?? row.detail, ...(note ? { note } : {}) } };
  }

  /** 任务列表：进行中、等你的在前，再按新旧；group 只要这几组的（GET /tasks?group=，3f）。归档了的不列 */
  list(o: { botId?: string; conversationId?: string; limit?: number; since?: number; group?: StageGroup[] } = {}): TaskView[] {
    const rank = { working: 0, needs: 1, ended: 2 } as const;
    return this.store
      .listTasks({ botId: o.botId, conversationId: o.conversationId, limit: 200 })
      .map((t) => this.view(t))
      .filter((v) => !o.group?.length || o.group.includes(v.stage.group))
      .filter((v) => !o.since || v.stage.group !== "ended" || v.updatedAt >= o.since)
      .sort((a, b) => rank[a.stage.group] - rank[b.stage.group] || b.createdAt - a.createdAt)
      .slice(0, o.limit ?? 50);
  }

  get(taskId: string): TaskView | undefined {
    const t = this.store.getTask(taskId);
    return t ? this.view(t) : undefined;
  }

  /** 一个 run 的步骤（在跑的用内存里的） */
  activity(runId: string): ActivityStep[] {
    const l = this.live.get(runId);
    if (l) return l.activity.steps;
    return parseSteps(this.store.getRun(runId)?.activity);
  }

  /** 这个机器人有没有在跑、收尾中的 run（任务的或规则的）：有就不换代理进程 */
  busy(botId: string): boolean {
    return [...this.live.values()].some((l) => l.botId === botId) || this.store.listRuns({ botId, states: ["running", "settling"], limit: 1 }).length > 0;
  }

  /** 每个机器人正在进行的任务数（侧栏"正在工作"） */
  background(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.store.listRuns({ states: ["queued", "running", "settling"] })) out[r.botId] = (out[r.botId] ?? 0) + 1;
    return out;
  }

  /** /tasks：这个会话的任务，带编号（/stop 编号 用同一个顺序） */
  listText(conversationId: string): string {
    const list = this.list({ conversationId, limit: 10, since: this.now() - 7 * 86400_000 });
    const rules = this.activeRules(conversationId);
    const conv = this.store.getConversation(conversationId);
    const paused = conv && this.paused(conv.botId) ? [tr("tasks.pausedLine")] : [];
    if (!list.length && !rules.length) return [tr("tasks.none"), ...paused].join("\n");
    const lines = list.map((x, i) => `${i + 1}. ${x.title} · ${x.stage.label}${x.latest ? tr("tasks.latestSuffix", { text: clip(x.latest, 40) }) : ""}`);
    // 规则接着编号（/stop 编号 关掉它），和任务同一种写法：标题 · 状态：时间表
    const ruleLines = rules.map((r, i) => `${list.length + i + 1}. ${r.title} · ${r.state.label}${tr("tasks.latestSuffix", { text: r.when })}`);
    const working = list.findIndex((x) => x.stage.group === "working");
    return [...(list.length ? [tr("tasks.listHead"), ...lines] : []), ...(rules.length ? [tr("rules.listHead"), ...ruleLines] : []), ...(working >= 0 || rules.length ? [tr("tasks.stopHint")] : []), ...paused].join("\n");
  }

  /** /tasks 里列出的规则：开着的（关了的、跑完了的一次性规则不列） */
  private activeRules(conversationId: string): RuleView[] {
    return this.listRules({ conversationId }).filter((r) => r.state.key !== "off" && r.state.key !== "done");
  }

  /** /stop 编号：立即记为停止（停会话在后台进行），返回给用户的话 */
  stopByIndex(conversationId: string, n: number, by: string): string {
    const list = this.list({ conversationId, limit: 10, since: this.now() - 7 * 86400_000 });
    const t = list[n - 1];
    const rule = t ? undefined : this.activeRules(conversationId)[n - 1 - list.length];
    if (rule) {
      this.updateRule(rule.id, { mode: "off" });
      log.info("rule turned off from chat", { rule: rule.id, by });
      return tr("rules.turnedOff", { title: rule.title });
    }
    if (!t) return tr("tasks.noSuchIndex", { n });
    if (t.stage.group !== "working") return tr("tasks.alreadyStage", { title: t.title, stage: t.stage.label });
    void this.stopTask(t.id, by);
    return tr("tasks.stoppedTask", { title: t.title });
  }

  /** 这个会话有没有正在进行的任务（/stop 不带编号时提示） */
  working(conversationId: string): TaskView[] {
    return this.list({ conversationId, limit: 10 }).filter((t) => t.stage.group === "working");
  }

  private changed(taskId: string): void {
    try {
      this.o.onChange?.(taskId);
    } catch {
      /* ignore */
    }
  }

  // ---------- 保留与清理、删除、导出（3f） ----------

  /**
   * 保留与清理（启动时一次，之后每小时一次；决定 9）：每个没在跑的任务看它多久没动了（最近的输入、结果、改预算、保留）：
   * - 不到 27 天：什么都不做（之前定了清理的取消：用户又用了它）；
   * - 文件夹是空的：到 30 天归档（没什么会丢的，不打扰）；
   * - 有文件、还没定：定在 3 天后（且不早于第 30 天）清理。不问用户、不发通知（产品负责人 2026-11-01）：任务详情里写着
   *   哪天清理，可以保留；
   * - 到了定的时间、也满 30 天了：删文件夹，归档（连同 DSH 里的会话记录）。
   * 运行记录只留 30 天（本月的规则运行留着：本月花费从它们汇总）。之前删不掉的会话记录（还开在代理进程里）再删一次。
   */
  retain(now = this.now()): void {
    if (!this.started || this.closing) return;
    this.emptyTrash();
    for (const task of this.store.listTasks({ limit: 500 })) {
      if (this.dropped.has(task.botId)) continue;
      try {
        this.retainTask(task, now);
      } catch (e) {
        log.warn("retention check failed for a task", { task: task.id, message: (e as Error).message.slice(0, 200) });
      }
    }
    const pruned = this.store.pruneRuns(Math.min(now - KEEP_MS, this.monthStart(now)));
    if (pruned) log.info("old run logs pruned", { runs: pruned });
  }

  private retainTask(task: TaskRow, now: number): void {
    const run = this.store.latestRun(task.id);
    const last = Math.max(task.updatedAt, task.endedAt, run?.endedAt ?? 0, run?.queuedAt ?? 0);
    const idle = now - last;
    if ((run && run.state !== "ended") || this.liveOf(task.id) || idle < KEEP_MS - WARN_MS) {
      if (task.cleanupAt) {
        this.store.updateTask(task.id, { cleanupAt: 0 });
        this.changed(task.id);
      }
      return;
    }
    const dir = taskFolder(this.o.host.workspace(task.botId), task.folder);
    if (!dir || !hasFiles(dir)) {
      if (idle >= KEEP_MS) this.archive(task, now);
      return;
    }
    if (!task.cleanupAt) {
      const at = Math.max(now + WARN_MS, last + KEEP_MS);
      this.store.updateTask(task.id, { cleanupAt: at });
      log.info("task folder unused for a while; cleanup date set", { task: task.id, at: new Date(at).toISOString() });
      this.changed(task.id);
      return;
    }
    if (now < task.cleanupAt || idle < KEEP_MS) return;
    this.removeFolder(task);
    log.info("task folder cleaned up after 30 idle days", { task: task.id });
    this.archive(task, now);
  }

  /** 归档：不再列出、不能再追加；等着的提问作废，输入、DSH 里的会话记录不要了（最近的那个 run 留着，运行记录过 30 天另删） */
  private archive(task: TaskRow, now: number): void {
    for (const a of this.o.approvals?.pendingForTask(task.id) ?? []) this.o.approvals!.cancel(a.id, "archived");
    this.store.updateTask(task.id, { endedAt: task.endedAt || now, endReason: "archived", cleanupAt: 0 });
    this.store.deleteTaskInputs(task.id);
    this.trashSessions(task.botId, task.id);
    this.sizeCache.delete(task.id);
    log.info("background task archived", { task: task.id });
    this.changed(task.id);
  }

  private removeFolder(task: TaskRow): void {
    const dir = taskFolder(this.o.host.workspace(task.botId), task.folder);
    if (!dir) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      log.warn("removing a task folder failed", { task: task.id, message: (e as Error).message.slice(0, 200) });
    }
  }

  /** 删掉任务在 DSH 里的会话记录；还开在代理进程里的记下来（库里），下次清理再删 */
  private trashSessions(botId: string, taskId: string): void {
    if (this.o.host.removeSessions?.(botId, taskId) !== false) return;
    const list = this.trash();
    if (!list.includes(`${botId}:${taskId}`)) this.store.setKV(TRASH, JSON.stringify([...list, `${botId}:${taskId}`].slice(-500)));
  }

  private trash(): string[] {
    try {
      const v = JSON.parse(this.store.getKV(TRASH) || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }

  private emptyTrash(): void {
    const list = this.trash();
    if (!list.length) return;
    const left = list.filter((k) => {
      const i = k.indexOf(":");
      return this.o.host.removeSessions?.(k.slice(0, i), k.slice(i + 1)) === false;
    });
    if (left.length !== list.length) this.store.setKV(TRASH, JSON.stringify(left));
  }

  /** 保留这个任务的文件夹（任务详情里的「保留」）：从现在起再算 30 天 */
  keepFolder(taskId: string): TaskView | undefined {
    const task = this.store.getTask(taskId);
    if (!task || task.endReason === "archived") return undefined;
    this.store.updateTask(task.id, { cleanupAt: 0, updatedAt: this.now() });
    log.info("task folder kept", { task: task.id });
    this.changed(task.id);
    return this.get(task.id);
  }

  /** 删掉任务（任务详情里的删除）：在跑的先停下，等着的提问、审批作废，没发出去的结果不发了，文件夹和 DSH 里的会话记录、运行记录一起删 */
  async deleteTask(taskId: string, by: string): Promise<boolean> {
    const task = this.store.getTask(taskId);
    if (!task) return false;
    if (this.liveOf(taskId) || this.queuedRun(taskId)) await this.stopTask(taskId, by);
    for (const a of this.o.approvals?.pendingForTask(taskId) ?? []) this.o.approvals!.cancel(a.id, "deleted");
    // 还排着、留着没发出去的结果不发了（「需要你」里那一行也跟着消失）
    for (const r of this.store.listRuns({ taskId })) if (r.delivery && !r.delivery.endsWith(":dropped")) this.o.delivery?.withdraw(r.delivery, tr("tasks.withdrawHandled"));
    this.removeFolder(task);
    this.trashSessions(task.botId, task.id);
    this.store.deleteTask(taskId);
    this.sizeCache.delete(taskId);
    log.info("background task deleted", { task: taskId, by });
    this.changed(taskId);
    return true;
  }

  /** 任务详情里的大小：文件夹、DSH 里的会话记录（字节；半分钟内不重数） */
  sizes(taskId: string): { folder: number; sessions: number } | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;
    const now = this.now();
    const hit = this.sizeCache.get(taskId);
    if (hit && now - hit.at < 30_000) return hit.v;
    const dir = taskFolder(this.o.host.workspace(task.botId), task.folder);
    const v = { folder: dir ? dirBytes(dir) : 0, sessions: this.o.host.sessionBytes?.(task.botId, task.id) ?? 0 };
    this.sizeCache.set(taskId, { at: now, v });
    return v;
  }

  /** 任务的文件夹（绝对路径；不在工作区 tasks/ 下的不给） */
  folderPath(taskId: string): string | undefined {
    const task = this.store.getTask(taskId);
    return task ? taskFolder(this.o.host.workspace(task.botId), task.folder) : undefined;
  }

  /** 任务从哪来：渠道、请求那条消息的时间和原话 */
  origin(taskId: string): { channel: string; at: number; text: string } | undefined {
    const task = this.store.getTask(taskId);
    const m = task?.originMessageId ? this.store.getMessage(task.originMessageId) : undefined;
    if (!task || !m) return undefined;
    return { channel: this.store.getConversation(task.conversationId)?.channel ?? "", at: m.createdAt, text: clip(m.content.trim(), 500) };
  }

  /** 任务导出成 Markdown：状态、来自、文件夹、每次运行（结果、花费、处理过程） */
  exportTask(taskId: string): { title: string; text: string } | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;
    const origin = this.origin(taskId);
    const ch = origin?.channel;
    const runs: ExportedTaskRun[] = this.store.listRuns({ taskId }).map((r) => ({
      cause: r.cause,
      outcome: r.state === "ended" ? r.outcome : "",
      error: r.error,
      message: r.report?.message ?? "",
      summary: r.report?.summary ?? "",
      question: r.report?.question?.question ?? "",
      costUsd: r.costUsd,
      queuedAt: r.queuedAt,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      steps: this.activity(r.id),
    }));
    const channel = ch === "weixin" ? tr("tasks.chWeixin") : ch === "feishu" ? tr("tasks.chFeishu") : ch ? tr("tasks.chWeb") : "";
    return { title: task.title, text: taskMarkdown(this.view(task), origin && { ...origin, channel }, runs, this.timeZone, this.now()) };
  }

  /** 规则的运行记录导出成 Markdown（留着的都导出：30 天） */
  exportRule(ruleId: string): { title: string; text: string } | undefined {
    const rule = this.store.getRule(ruleId);
    if (!rule) return undefined;
    const runs = this.ruleLog(ruleId, { limit: 500 }).map((r) => ({ ...r, stepList: r.steps ? this.activity(r.id) : [] }));
    return { title: rule.title, text: ruleMarkdown(this.ruleView(rule), whenOf(rule, true), runs, this.timeZone, this.now()) };
  }

  // ---------- 规则（3d） ----------

  private get timeZone(): string {
    return this.o.timeZone ?? systemTimeZone();
  }

  /** 主模型：发到的那个会话的模型 → 机器人的默认 → 应用的默认（和任务一样） */
  private mainModel(rule: RuleRow): string {
    const conv = this.store.getConversation(rule.conversationId);
    return conv?.model || this.store.getBot(rule.botId)?.defaultModel || this.o.defaultModel?.() || "";
  }

  /** 检查用的模型：机器人的小模型（没设就是主模型；产品负责人的决定 5） */
  private checkModel(rule: RuleRow): string {
    return this.o.host.settings(rule.botId).utilityModel || this.mainModel(rule);
  }

  /** 发到这个会话、会主动发消息的规则（执行中的检查和提醒，没暂停）：给微信留配额、续期提醒里列出来 */
  private pushingRules(conversationId: string): RuleRow[] {
    return this.store
      .listRules({ conversationId })
      .filter((r) => r.mode !== "off" && !r.pausedReason && runMode(r) === "act" && (r.nextRunAt > 0 || r.trigger.kind === "event"));
  }

  /** 这条规则有没有还没结束的 run（排队、在跑、收尾） */
  private ruleBusy(ruleId: string): boolean {
    return this.store.listRuns({ ruleId, states: ["queued", "running", "settling"], limit: 1 }).length > 0;
  }

  /** 时间表的下一次（关着、暂停了、事件触发的没有） */
  private nextFor(rule: Pick<RuleRow, "trigger" | "mode" | "pausedReason">, now: number): number {
    if (rule.mode === "off" || rule.pausedReason || rule.trigger.kind !== "schedule") return 0;
    return nextRun(rule.trigger.schedule, now) ?? 0;
  }

  private graceFor(rule: RuleRow, at: number): number {
    return rule.trigger.kind === "schedule" ? graceOf(rule.trigger.schedule, at) : MAX_GRACE_MS;
  }

  /**
   * 新规则（聊天代理的 rule_create、界面）：直接执行，用户的原话就是授权，和让做的任务一样（产品负责人 2026-11-01）；
   * 用户说了先观察（mode observe）的检查才观察。固定提醒没什么要判断的，总是执行（决定 6），不受免打扰限制（时间是用户定的）。
   * 时间表或事件触发二选一。
   */
  createRule(o: {
    botId: string;
    conversationId: string;
    title: string;
    instruction: string;
    kind?: RuleKind;
    /** 检查的模式：默认执行；observe = 用户要先观察 */
    mode?: "observe" | "act";
    message?: string;
    schedule?: Schedule;
    trigger?: RuleTrigger;
    /** 3f：规则编辑器里填的每次、每月预算（不填用默认的 $0.10、$3） */
    runBudgetUsd?: number;
    monthBudgetUsd?: number;
  }): { rule?: RuleRow; error?: string } {
    const conv = this.store.getConversation(o.conversationId);
    if (!conv || conv.botId !== o.botId || !this.store.getBot(o.botId)) return { error: "conversation not found" };
    const kind: RuleKind = o.kind === "remind" ? "remind" : "check";
    const title = clip(oneLine(o.title), 40);
    const message = clip(oneLine(o.message ?? ""), MESSAGE_MAX);
    // 提醒：界面里只写那句话时，它也是原话
    const instruction = (o.instruction.trim() || (kind === "remind" ? message : "")).slice(0, 2000);
    if (!title) return { error: "title is required" };
    if (!instruction) return { error: "instruction is required: the user's words" };
    if (kind === "remind" && !message) return { error: "a reminder needs message: the exact line to send" };
    const trigger: RuleTrigger | undefined = o.trigger ?? (o.schedule ? { kind: "schedule", schedule: o.schedule } : undefined);
    if (!trigger || (trigger.kind === "event" && !trigger.source.trim())) return { error: "schedule is required" };
    if (kind === "remind" && trigger.kind !== "schedule") return { error: "a reminder needs a schedule" };
    if (this.store.listRules({ botId: o.botId }).length >= MAX_RULES) return { error: `This bot already has ${MAX_RULES} rules; delete one first.` };
    const budgets: { runBudgetUsd?: number; monthBudgetUsd?: number } = {};
    for (const k of ["runBudgetUsd", "monthBudgetUsd"] as const) {
      if (o[k] === undefined) continue;
      const v = Number(o[k]);
      if (!Number.isFinite(v) || v <= 0 || v > TASK_BUDGET_MAX_USD) return { error: tr("tasks.badBudget") };
      budgets[k] = Math.round(v * 100) / 100;
    }
    const now = this.now();
    const id = `rl_${hex(6)}`;
    const mode: RuleMode = kind === "check" && o.mode === "observe" ? "observe" : "act";
    const rule = this.store.insertRule({
      id,
      botId: o.botId,
      conversationId: conv.id,
      title,
      instruction,
      message: kind === "remind" ? message : "",
      kind,
      trigger,
      mode,
      folder: `rules/${slugOf(title).replace(/^task$/, "rule")}-${id.slice(3, 9)}`,
      nextRunAt: this.nextFor({ trigger, mode, pausedReason: "" }, now),
      anytime: kind === "remind",
      ...budgets,
      createdAt: now,
      updatedAt: now,
    });
    log.info("rule created", { bot: o.botId, rule: id, kind, mode, trigger: trigger.kind, conversationId: conv.id });
    this.ruleChanged(id);
    return { rule };
  }

  /**
   * 改规则（界面、rule_update）。改原话：版本加 1，模式不变（执行中的照样执行，不再先观察：产品负责人 2026-11-01）。
   * 只改时间表：模式不变。改模式：重新开的清掉连续失败和暂停。正在跑的那次照它开始时的版本跑完。
   */
  updateRule(
    id: string,
    patch: { title?: string; instruction?: string; message?: string; schedule?: Schedule; mode?: RuleMode; conversationId?: string; runBudgetUsd?: number; monthBudgetUsd?: number },
  ): { rule?: RuleRow; error?: string } {
    const rule = this.store.getRule(id);
    if (!rule) return { error: "rule not found" };
    const now = this.now();
    const next: Partial<RuleRow> = { updatedAt: now };
    // 预算（3e）：每次、每月；本月预算调高了、因此暂停着的，下次定时器醒来时接着跑
    for (const k of ["runBudgetUsd", "monthBudgetUsd"] as const) {
      if (patch[k] === undefined) continue;
      const v = Number(patch[k]);
      if (!Number.isFinite(v) || v <= 0 || v > TASK_BUDGET_MAX_USD) return { error: tr("tasks.badBudget") };
      next[k] = Math.round(v * 100) / 100;
    }
    if (patch.title !== undefined) {
      const t = clip(oneLine(patch.title), 40);
      if (!t) return { error: tr("rules.nameEmpty") };
      next.title = t;
    }
    let reworded = false;
    if (patch.instruction !== undefined) {
      const t = patch.instruction.trim().slice(0, 2000);
      if (!t) return { error: tr("rules.wordsEmpty") };
      if (t !== rule.instruction) (next.instruction = t), (reworded = true);
    }
    if (patch.message !== undefined && rule.kind === "remind") {
      const m = clip(oneLine(patch.message), MESSAGE_MAX);
      if (!m) return { error: tr("rules.messageEmpty") };
      if (m !== rule.message) (next.message = m), (reworded = true);
    }
    if (patch.conversationId !== undefined && patch.conversationId !== rule.conversationId) {
      const c = this.store.getConversation(patch.conversationId);
      if (!c || c.botId !== rule.botId) return { error: tr("rules.noConversation") };
      next.conversationId = c.id;
    }
    let trigger = rule.trigger;
    if (patch.schedule) {
      if (rule.trigger.kind !== "schedule") return { error: tr("rules.eventNoSchedule") };
      trigger = next.trigger = { kind: "schedule", schedule: patch.schedule };
    }
    let mode = rule.mode;
    if (patch.mode !== undefined && patch.mode !== rule.mode) {
      if (rule.kind === "remind" && patch.mode === "observe") return { error: tr("rules.remindNoObserve") };
      mode = next.mode = patch.mode;
    }
    if (reworded) next.version = rule.version + 1;
    // 重新开（关着、暂停了 → 开着）：连续失败清零
    const reopened = patch.mode !== undefined && mode !== "off" && (rule.mode === "off" || !!rule.pausedReason || patch.mode !== rule.mode);
    if (reopened) (next.failures = 0), (next.pausedReason = "");
    if (next.trigger || next.mode !== undefined || reopened) next.nextRunAt = this.nextFor({ trigger, mode, pausedReason: reopened ? "" : rule.pausedReason }, now);
    this.store.updateRule(id, next);
    // 自己选了观察（从执行、关着切回来）：这一版算是决定过了，「需要你」里不再问要不要改为执行（改了原话的新一版照样会问）
    if (mode === "observe" && rule.mode !== "observe" && !reworded) this.store.setKV(SUGGEST_SEEN + id, String(rule.version));
    log.info("rule updated", { rule: id, fields: Object.keys(next).filter((k) => k !== "updatedAt") });
    this.ruleChanged(id);
    return { rule: this.store.getRule(id) };
  }

  /** 暂停的规则重新开（「需要你」里的重试）：清掉连续失败，接着按时间表跑，并马上跑一次（本月预算用完暂停的要先加预算） */
  resumeRule(id: string): { error?: string } {
    const rule = this.store.getRule(id);
    if (!rule) return { error: "rule not found" };
    if (rule.pausedReason === "budget" && this.monthSpent(rule) >= rule.monthBudgetUsd) return { error: tr("rules.monthUsed", { spent: usdText(this.monthSpent(rule)) }) };
    if (rule.pausedReason || rule.failures) {
      const mode = rule.mode === "off" ? "act" : rule.mode;
      this.store.updateRule(id, { failures: 0, pausedReason: "", mode, nextRunAt: this.nextFor({ trigger: rule.trigger, mode, pausedReason: "" }, this.now()), updatedAt: this.now() });
    }
    return this.runRuleNow(id);
  }

  /** 立即运行（界面）：按规则现在的模式跑一次（人要求的：排在前面） */
  runRuleNow(id: string): { error?: string } {
    const rule = this.store.getRule(id);
    if (!rule) return { error: "rule not found" };
    if (rule.mode === "off") return { error: tr("rules.isOff") };
    if (this.paused(rule.botId)) return { error: tr("rules.isPaused") };
    if (this.ruleBusy(id)) return { error: tr("rules.isRunning") };
    if (rule.kind === "check" && this.reserve(rule.botId)) return { error: tr("rules.whyReserve") };
    if (rule.kind === "check" && this.monthSpent(rule) >= rule.monthBudgetUsd) return { error: tr("rules.monthUsed", { spent: usdText(this.monthSpent(rule)) }) };
    this.fireRule(rule, "manual", this.now());
    this.pump();
    return {};
  }

  /** 删掉规则：正在跑的那次停掉，等着的批准作废，运行记录一起删 */
  async deleteRule(id: string): Promise<boolean> {
    const rule = this.store.getRule(id);
    if (!rule) return false;
    for (const a of this.o.approvals?.pendingAll().filter((x) => x.ruleId === id) ?? []) this.o.approvals!.cancel(a.id, "deleted");
    const l = [...this.live.values()].find((x) => x.ruleId === id);
    if (l) this.forget(l);
    this.store.deleteRule(id);
    this.store.deleteKV(SUGGEST_SEEN + id);
    if (l) await this.o.host.stop(l.botId, l.sessionId).catch(() => undefined);
    log.info("rule deleted", { rule: id });
    this.ruleChanged(id);
    this.pump();
    return true;
  }

  private ruleChanged(id: string): void {
    this.changed(id);
    this.scheduler.wake();
  }

  /**
   * 定时器到点（也在启动时、电脑醒来时）：每条到点的规则把 next_run_at 往后挪，最近该跑的那次在宽限期内就跑一次，
   * 更早错过的记一条「跳过：电脑没开」，从不补一串。上一次还没跑完的，这次跳过。
   */
  fireDue(now = this.now()): void {
    if (!this.started || this.closing) return;
    this.resumeMonth(now);
    for (const rule of this.store.dueRules(now)) {
      if (this.dropped.has(rule.botId) || rule.trigger.kind !== "schedule") continue;
      const s = rule.trigger.schedule;
      const due = rule.nextRunAt;
      const last = latestRun(s, now, due) ?? due;
      this.store.updateRule(rule.id, { nextRunAt: nextRun(s, now) ?? 0 });
      if (now - last > graceOf(s, last)) {
        this.skipRun(rule, due, RUN_ERROR.appOff);
        continue;
      }
      if (last > due) this.skipRun(rule, due, RUN_ERROR.appOff);
      // 后台工作暂停了：这次记为跳过，恢复后不补
      if (this.paused(rule.botId)) {
        this.skipRun(rule, last, RUN_ERROR.paused);
        continue;
      }
      // 机器人的预算留给聊天：检查跳过（固定提醒不花钱，照发）
      if (rule.kind === "check" && this.reserve(rule.botId)) {
        this.skipRun(rule, last, RUN_ERROR.reserve);
        continue;
      }
      this.fireRule(rule, "schedule", last);
    }
    this.pump();
  }

  /**
   * 事件到了（RuleEvents.emit，见 rule-events.ts）：来源相同、过滤条件对得上的开着的规则各开一个 run，和定时的走同一条路。
   * 以后用户配置的 workload 在这里接进来。返回开了 run 的规则 id。
   */
  emitRuleEvent(source: string, event: RuleEvent): string[] {
    if (!this.started || this.closing) return [];
    const out: string[] = [];
    const now = this.now();
    for (const rule of this.store.listRules()) {
      if (rule.trigger.kind !== "event" || rule.trigger.source !== source || rule.mode === "off" || rule.pausedReason || this.dropped.has(rule.botId)) continue;
      if (!matchesFilter(rule.trigger.filter, event)) continue;
      if (this.paused(rule.botId)) {
        this.skipRun(rule, now, RUN_ERROR.paused);
        continue;
      }
      if (rule.kind === "check" && this.reserve(rule.botId)) {
        this.skipRun(rule, now, RUN_ERROR.reserve);
        continue;
      }
      if (this.fireRule(rule, "event", now, { source, event })) out.push(rule.id);
    }
    if (out.length) {
      log.info("rule event", { source, rules: out.length });
      this.pump();
    }
    return out;
  }

  /**
   * 开一次：提醒直接发那句话（不进模型、不占名额）；检查排一个 run（新会话，第一条输入是规则、原话、最近 3 次的结果）。
   * 上一次还没结束：到点的、事件来的这次跳过。
   */
  private fireRule(rule: RuleRow, cause: RunCause, at: number, event?: { source: string; event: RuleEvent }): RunRow | undefined {
    if (this.ruleBusy(rule.id)) {
      if (cause === "schedule" || cause === "event") this.skipRun(rule, at, RUN_ERROR.overlap);
      return undefined;
    }
    if (rule.kind === "remind") return this.remind(rule, cause, at);
    // 本月的预算已经用完（预算调低了、这个月里又改回开着）：不跑，暂停到下个月
    if (this.monthSpent(rule) >= rule.monthBudgetUsd) {
      this.pauseForMonth(rule);
      return undefined;
    }
    const mode = runMode(rule);
    const id = `r_${hex(6)}`;
    const run = this.store.insertRun({ id, botId: rule.botId, taskId: "", ruleId: rule.id, ruleVersion: rule.version, mode, sessionId: `rule-${rule.id}-${id.slice(2)}`, cause, queuedAt: at });
    this.store.insertInput({ id: `i_${hex(6)}`, taskId: "", ruleId: rule.id, runId: id, kind: "schedule", text: this.ruleBriefFor(rule, mode, event), fromPerson: cause === "manual", createdAt: this.now() });
    this.changed(rule.id);
    return run;
  }

  /** 第一条输入：规则、用户原话、最近 3 次的结果（连续性靠它，每次是新会话）、事件、记忆快照、这次是观察还是执行 */
  private ruleBriefFor(rule: RuleRow, mode: "observe" | "act", event?: { source: string; event: RuleEvent }): string {
    const tz = rule.trigger.kind === "schedule" ? rule.trigger.schedule.tz : this.timeZone;
    const recent = this.store
      .ruleRuns(rule.id, { limit: 10 })
      .filter((r) => r.state === "ended" && r.report)
      .slice(0, 3)
      .reverse()
      .map((r) => {
        const msg = oneLine(r.report!.message ?? "");
        const head = r.outcome === "failed" ? "失败" : msg ? `${r.mode === "observe" ? "本会告诉用户" : "告诉了用户"}：${msg}` : "没有告诉用户";
        return { at: stamp(r.queuedAt, tz), line: [head, oneLine(r.report!.summary)].filter(Boolean).join("。") };
      });
    const st = this.o.host.settings(rule.botId);
    let payload = "";
    try {
      payload = event ? JSON.stringify(event.event) : "";
    } catch {
      payload = "{}";
    }
    return ruleBrief({
      title: rule.title,
      // 第一条输入是给模型的，和别的提示词一样固定用简体中文
      when: whenOf(rule, false, "zh-CN"),
      instruction: rule.instruction,
      mode,
      recent,
      ...(event ? { event: { source: event.source, payload } } : {}),
      memory: st.memory.enabled ? this.o.host.memoryPrefix(rule.botId, rule.conversationId) : undefined,
    });
  }

  /** 固定提醒：到点把那句话发出去，记一条运行记录（不进模型） */
  private remind(rule: RuleRow, cause: RunCause, at: number): RunRow {
    const now = this.now();
    const id = `r_${hex(6)}`;
    this.store.insertEndedRun({ id, botId: rule.botId, ruleId: rule.id, ruleVersion: rule.version, mode: "act", cause, outcome: "done", error: "", queuedAt: at, endedAt: now });
    this.store.updateRun(id, { startedAt: now, report: { state: "done", summary: "", message: rule.message, at: now } });
    this.deliverRule(rule, id, "reminder", rule.message);
    log.info("reminder sent", { rule: rule.id, run: id });
    this.changed(rule.id);
    return this.store.getRun(id)!;
  }

  /** 记一条跳过（电脑没开、一直在忙、上次还没跑完：why 是 RUN_ERROR 里的代码） */
  private skipRun(rule: RuleRow, at: number, why: string): void {
    this.store.insertEndedRun({ id: `r_${hex(6)}`, botId: rule.botId, ruleId: rule.id, ruleVersion: rule.version, mode: runMode(rule), cause: "schedule", outcome: "skipped", error: why, queuedAt: at, endedAt: this.now() });
    log.info("rule run skipped", { rule: rule.id, at, why });
    this.changed(rule.id);
  }

  /** 排着的规则 run 等名额超过宽限期：跳过（「一直在忙」）；规则删了的作废。返回 true = 不用再排了 */
  private skipStale(run: RunRow): boolean {
    const rule = this.store.getRule(run.ruleId);
    const now = this.now();
    if (!rule) {
      this.store.updateRun(run.id, { state: "ended", outcome: "stopped", endedAt: now });
      return true;
    }
    if (now - run.queuedAt <= this.graceFor(rule, run.queuedAt)) return false;
    this.store.updateRun(run.id, { state: "ended", outcome: "skipped", error: RUN_ERROR.busy, endedAt: now });
    log.info("rule run skipped: no free slot within its grace period", { rule: rule.id, run: run.id });
    this.changed(rule.id);
    return true;
  }

  /** 开始规则的一个 run：新会话，工作目录是规则的文件夹，检查用小模型；观察只读，执行最多可写工作区 */
  private async startRuleRun(run: RunRow): Promise<void> {
    const rule = this.store.getRule(run.ruleId);
    const now = this.now();
    if (!rule) {
      this.store.updateRun(run.id, { state: "ended", outcome: "stopped", endedAt: now });
      return;
    }
    const mode = run.mode === "act" ? "act" : "observe";
    const permission = rulePermission(mode, this.o.host.settings(rule.botId).permission);
    this.store.updateRun(run.id, { state: "running", startedAt: now, permission });
    const model = this.checkModel(rule);
    const l: Live = {
      runId: run.id,
      taskId: "",
      ruleId: rule.id,
      mode,
      folder: path.join(this.o.host.workspace(rule.botId), rule.folder),
      model: model && this.o.route ? this.o.route(rule.botId, model) : model,
      botId: rule.botId,
      sessionId: run.sessionId,
      activity: new ActivityLog(undefined, model),
      busy: false,
      starting: false,
      checking: false,
      settling: false,
      nudged: false,
      retries: 0,
      seen: new Set(),
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      priceModel: model,
      would: [],
    };
    this.live.set(run.id, l);
    this.bySession.set(run.sessionId, l);
    this.armCap(l, this.o.ruleRunCapMs ?? RULE_RUN_CAP_MS);
    this.changed(rule.id);
    const inputs = this.store.openRunInputs(run.id);
    await this.deliver_(l, inputs.length ? inputs : [this.inputFor(l, "nudge", RULE_NUDGE)]);
  }

  /** 一次运行的时间上限：到了就停掉会话，这次算失败（在等批准时不算，批准最多等 1 小时） */
  private armCap(l: Live, ms: number): void {
    clearTimeout(l.capTimer);
    l.capTimer = setTimeout(() => {
      l.capTimer = undefined;
      if (this.live.get(l.runId) !== l) return;
      if (this.o.approvals?.pendingAll().some((a) => a.ruleId && a.runId === l.runId)) return this.armCap(l, 60_000);
      log.warn("rule run hit its time cap; stopping it", { rule: l.ruleId, run: l.runId });
      l.activity.end(tr("rules.whyTimeout"));
      this.end(l, "failed", undefined, RUN_ERROR.timeout);
      void this.o.host.stop(l.botId, l.sessionId).catch(() => undefined);
    }, ms);
    l.capTimer.unref?.();
  }

  /** 规则会话的 task_report：done（带 message = 要告诉用户的一句，不带 = 保持安静）、failed、progress；没有 needs_you */
  private ruleReport(l: Live, b: any): { text?: string; error?: string } {
    const state = String(b?.state ?? "");
    if (state !== "progress" && state !== "done" && state !== "failed") return { error: "state must be progress, done or failed (a rule run cannot ask the user)" };
    const message = typeof b?.message === "string" ? oneLine(b.message) : "";
    const would = typeof b?.would === "string" ? clip(b.would.trim(), 1000) : "";
    const report: TaskReport = {
      state,
      summary: clip(String(b?.summary ?? "").trim(), 2000),
      ...(message ? { message: clip(message, MESSAGE_MAX) } : {}),
      ...(would ? { would } : {}),
      at: this.now(),
    };
    this.store.updateRun(l.runId, { report });
    if (state !== "progress") l.final = report;
    this.changed(l.ruleId);
    if (state === "progress") return { text: "Progress recorded (it is not sent). Continue the check." };
    if (state === "failed") return { text: "Recorded. End your turn now." };
    if (!message) return { text: "Recorded: the user hears nothing this time. End your turn now." };
    return { text: l.mode === "observe" ? "Recorded as what you would have said (observe mode: nothing is sent). End your turn now." : "Recorded. End your turn now: the app sends your message to the user." };
  }

  /** 结束规则的 run：存下步骤、报告、本会做的事；之后按结果更新规则（连续失败）、送出那一句 */
  private endRule(l: Live, outcome: RunOutcome, report?: TaskReport, error = ""): void {
    this.forget(l);
    const now = this.now();
    const would = [report?.would ?? "", ...(l.would ?? []).map((d) => `${WOULD_APPROVAL}${d}`)].filter(Boolean).join("\n");
    this.store.updateRun(l.runId, { state: "ended", outcome, report, would, error, endedAt: now, activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd });
    for (const a of this.o.approvals?.pendingAll().filter((x) => x.ruleId && x.runId === l.runId) ?? []) this.o.approvals!.cancel(a.id, "run ended");
    const rule = this.store.getRule(l.ruleId);
    if (rule) this.afterRuleRun(rule, l.runId, l.mode, outcome, report, error);
    log.info("rule run ended", { rule: l.ruleId, run: l.runId, mode: l.mode, outcome, ...(error ? { error } : {}) });
    this.changed(l.ruleId);
    this.pump();
    this.o.host.runEnded?.(l.botId);
  }

  /**
   * 一次运行之后：成功清零连续失败；有要说的那一句（观察时是「本会发送」）用主模型写，执行时发出去。
   * 失败加 1（超出单次预算也算），连续 3 次自动暂停：执行中的规则推一句 ⚠️，观察中的只在「需要你」里。
   * 最后看本月的预算：用完了就暂停到下个月。
   */
  private afterRuleRun(rule: RuleRow, runId: string, mode: "observe" | "act", outcome: RunOutcome, report: TaskReport | undefined, error: string): void {
    if (outcome === "done") {
      this.store.updateRule(rule.id, { failures: 0 });
      if (report?.message) void this.ruleResult(rule, runId, mode, report);
    } else if (outcome === "failed" || (outcome === "budget" && error === RUN_ERROR.runBudget)) {
      const failures = rule.failures + 1;
      if (failures < RULE_FAILS_TO_PAUSE) this.store.updateRule(rule.id, { failures });
      else {
        this.store.updateRule(rule.id, { failures, pausedReason: "failures", nextRunAt: 0 });
        log.warn("rule paused after failing in a row", { rule: rule.id, failures });
        if (rule.mode === "act") {
          // 后台推送：应用的语言
          const why = clip(oneLine(report?.message || errorText(error || RUN_ERROR.noReport)), 200);
          this.deliverRule(rule, runId, "failure", tr("rules.pausedPush", { title: rule.title, count: failures, why }));
        }
        return;
      }
    }
    const fresh = this.store.getRule(rule.id);
    if (fresh && fresh.kind === "check" && this.monthSpent(fresh) >= fresh.monthBudgetUsd) this.pauseForMonth(fresh);
  }

  /**
   * 本月的预算用完：暂停到下个月 1 号（主人的时区，定时器到时自动恢复），「需要你」里一行（可以再给 $3 接着跑）；
   * 执行中的规则还推一句（用户在等它的结果，不能悄悄停下），一个月只推一次。
   */
  private pauseForMonth(rule: RuleRow): void {
    if (rule.pausedReason) return;
    const now = this.now();
    this.store.updateRule(rule.id, { pausedReason: "budget", nextRunAt: 0, updatedAt: now });
    const spent = this.monthSpent(rule, now);
    log.warn("rule paused: its monthly budget is used up", { rule: rule.id, spentUsd: Math.round(spent * 10_000) / 10_000, budgetUsd: rule.monthBudgetUsd });
    if (rule.mode === "act") {
      const p = localParts(now, this.timeZone);
      // 一个月、一个预算额只推一次（加了预算又用完会再推）
      this.pushRule(rule, `rule:${rule.id}:budget:${p.y}-${pad2(p.mo)}:${rule.monthBudgetUsd}`, "failure", tr("rules.monthPush", { title: rule.title, spent: usdText(spent) }));
    }
    this.ruleChanged(rule.id);
  }

  /** 新的一个月（或加了预算）：因为本月预算暂停的规则，花费回到预算以内的就接着按时间表跑 */
  private resumeMonth(now: number): void {
    for (const rule of this.store.listRules()) {
      if (rule.pausedReason !== "budget" || this.monthSpent(rule, now) >= rule.monthBudgetUsd) continue;
      this.store.updateRule(rule.id, { pausedReason: "", nextRunAt: this.nextFor({ ...rule, pausedReason: "" }, now), updatedAt: now });
      log.info("rule resumed: its monthly budget has room again", { rule: rule.id });
      this.changed(rule.id);
    }
  }

  /** 给规则每月的预算加钱（「需要你」里的继续、接口）：本月预算用完暂停着的接着按时间表跑 */
  addRuleBudget(id: string, addUsd = RULE_MONTH_BUDGET_USD): { rule?: RuleView; error?: string } {
    const rule = this.store.getRule(id);
    if (!rule) return { error: "rule not found" };
    const add = Number(addUsd);
    if (!Number.isFinite(add) || add <= 0 || add > 100) return { error: tr("tasks.badBudget") };
    const now = this.now();
    const spent = this.monthSpent(rule, now);
    const raised = rule.monthBudgetUsd + add;
    const budget = Math.round(Math.min(TASK_BUDGET_MAX_USD, raised > spent ? raised : spent + add) * 100) / 100;
    this.store.updateRule(id, { monthBudgetUsd: budget, updatedAt: now });
    log.info("rule monthly budget raised", { rule: id, budgetUsd: budget });
    this.resumeMonth(now);
    this.ruleChanged(id);
    return { rule: this.getRuleView(id) };
  }

  /** 那一句用主模型写（检查用的小模型只给草稿）；执行时发出去。主模型不可用就用草稿 */
  private async ruleResult(rule: RuleRow, runId: string, mode: "observe" | "act", report: TaskReport): Promise<void> {
    let message = report.message ?? "";
    const main = this.mainModel(rule);
    if (this.o.complete && main && this.checkModel(rule) !== main) {
      try {
        const out = await this.o.complete(rule.botId, main, RULE_RESULT_SYSTEM, ruleResultInput({ instruction: rule.instruction, summary: report.summary, draft: message }));
        const line = clip(oneLine(out).replace(/^["“「]+|["”」]+$/g, ""), MESSAGE_MAX);
        if (line) message = line;
      } catch (e) {
        log.warn("writing the rule result with the main model failed; sending the draft", { rule: rule.id, message: (e as Error).message.slice(0, 200) });
      }
      if (message !== report.message) this.store.updateRun(runId, { report: { ...report, message } });
    }
    const fresh = this.store.getRule(rule.id);
    if (mode === "act" && fresh) this.deliverRule(fresh, runId, "rule", message);
    this.changed(rule.id);
  }

  /**
   * 送出规则的那一句（命中、提醒、暂停）：微信、飞书按主动消息的规则经出站队列（id 固定：rule:<规则>:<run>，同一 id 只发一次），
   * 飞书直接发到会话；同时写进会话历史，给聊天代理留张便条。交过的 run 不再交。
   */
  private deliverRule(rule: RuleRow, runId: string, purpose: "rule" | "reminder" | "failure", text: string): void {
    const run = this.store.getRun(runId);
    if (!run || run.delivery) return;
    const id = purpose === "failure" ? `rule:${rule.id}:paused:${runId}` : `rule:${rule.id}:${runId}`;
    this.store.updateRun(runId, { delivery: this.pushRule(rule, id, purpose, text) ? id : `${id}:dropped` });
  }

  /** 经出站队列送出规则的一句（id 固定，同一 id 只发一次），写进会话历史、给聊天代理留便条；会话没了返回 false */
  private pushRule(rule: RuleRow, id: string, purpose: "rule" | "reminder" | "failure", text: string): boolean {
    const conv = this.store.getConversation(rule.conversationId);
    if (!conv) return false;
    if (this.store.getOutbox(id)) return true;
    if ((conv.channel === "weixin" || conv.channel === "feishu") && this.o.delivery) {
      this.o.delivery.push({
        id,
        botId: rule.botId,
        channel: conv.channel,
        peerId: conv.peerId,
        purpose,
        subject: rule.title,
        text,
        kind: conv.channel === "feishu" ? "notice" : "text",
        anytime: rule.anytime,
        ref: `rule:${rule.id}`,
      });
    }
    this.store.addMessage(conv.id, "assistant", text);
    this.note(conv.id, purpose === "failure" ? `[规则「${rule.title}」暂停了，已告诉用户] ${text}` : `[规则「${rule.title}」发给了用户] ${text}`);
    log.info("rule message handed over", { rule: rule.id, id, purpose, channel: conv.channel });
    return true;
  }

  /** 启动：结束了、要发却还没交出去的（交之前应用退出了）补交；只看两天之内的 */
  private redeliverRules(): void {
    const since = this.now() - 2 * 86400_000;
    for (const rule of this.store.listRules()) {
      for (const r of this.store.ruleRuns(rule.id, { limit: 5 })) {
        if (r.state !== "ended" || r.delivery || r.endedAt < since || r.outcome !== "done" || r.mode !== "act" || !r.report?.message) continue;
        this.deliverRule(rule, r.id, rule.kind === "remind" ? "reminder" : "rule", r.report.message);
      }
    }
  }

  /**
   * 重启时被打断的规则 run（已记为 interrupted）：还在宽限期内、不是重跑过的，就用新会话再跑一次（照原样交第一条输入，
   * 前面加一句说明）；否则记为跳过（设计 3.restart 第 7 条）。
   */
  private recoverRule(run: RunRow): void {
    const rule = this.store.getRule(run.ruleId);
    if (!rule) return;
    const fresh = this.now() - run.queuedAt <= this.graceFor(rule, run.queuedAt);
    if (run.cause === "recover" || !fresh || rule.mode === "off" || rule.pausedReason || this.ruleBusy(rule.id)) {
      this.store.updateRun(run.id, { outcome: "skipped", error: RUN_ERROR.restart });
      this.changed(rule.id);
      return;
    }
    const id = `r_${hex(6)}`;
    const mode = run.mode === "act" ? "act" : "observe";
    this.store.insertRun({ id, botId: rule.botId, taskId: "", ruleId: rule.id, ruleVersion: run.ruleVersion, mode, sessionId: `rule-${rule.id}-${id.slice(2)}`, cause: "recover", queuedAt: run.queuedAt });
    const brief = this.store.runInputs(run.id).find((i) => i.kind === "schedule")?.text ?? this.ruleBriefFor(rule, mode);
    this.store.insertInput({ id: `i_${hex(6)}`, taskId: "", ruleId: rule.id, runId: id, kind: "schedule", text: `${RULE_RERUN}\n\n${brief}`, fromPerson: false, createdAt: this.now() });
    log.info("rule run interrupted by a restart; running it again", { rule: rule.id, run: run.id, rerun: id });
    this.changed(rule.id);
  }

  /** 插件（/dsh/task-config）：规则会话的配置——观察只读、去掉能改变什么的工具；执行最多可写工作区。宿主说了算 */
  sessionConfig(b: any): { kind?: string; mode?: string; deny?: string[]; denyPrefix?: string[]; section?: string; permission?: string; error?: string } {
    const l = this.bySession.get(String(b?.sessionId ?? ""));
    if (!l?.ruleId) return { error: "not a rule session the app is running" };
    return { kind: "rule", mode: l.mode, deny: RULE_DENY[l.mode], denyPrefix: RULE_DENY_PREFIX, section: ruleRules(l.mode), permission: rulePermission(l.mode, this.o.host.settings(l.botId).permission) };
  }

  /** 规则会话（或它的子代理）属于哪条规则、哪次运行、这次是观察还是执行（审批落到哪里、观察时自动拒绝） */
  ruleOfSession(sessionId: string, root?: string): { ruleId: string; runId: string; conversationId: string; mode: "observe" | "act" } | undefined {
    const l = this.bySession.get(sessionId) ?? (root ? this.bySession.get(root) : undefined);
    if (!l?.ruleId) return undefined;
    const rule = this.store.getRule(l.ruleId);
    return rule ? { ruleId: rule.id, runId: l.runId, conversationId: rule.conversationId, mode: l.mode } : undefined;
  }

  /** 观察时要批准的事：自动拒绝，记成「需要批准：…」 */
  wouldNeedApproval(runId: string, detail: string): void {
    const l = this.live.get(runId);
    if (!l?.ruleId) return;
    (l.would ??= []).push(clip(oneLine(detail || "一个操作"), 200));
    log.info("rule run in observe mode asked for approval; rejected and recorded", { rule: l.ruleId, run: runId });
  }

  /** 规则执行时的审批：有了决定刷新；1 小时没人管（过期）就拒绝，这次运行失败（设计第 7 节） */
  private onRuleApproval(e: ApprovalEvent): void {
    const row = e.row;
    this.changed(row.ruleId);
    if (e.type !== "decided" || row.status !== "expired" || row.decidedBy !== "timeout") return;
    const l = this.live.get(row.runId);
    if (!l) return;
    void this.o.host.stop(l.botId, l.sessionId).catch(() => undefined);
    this.end(l, "failed", undefined, RUN_ERROR.approvalTimeout);
  }

  // ---------- 规则：聊天代理的工具 ----------

  /** rule_create：用户原话、一行时间表、检查还是提醒；检查默认执行，用户说先观察时 mode 是 observe */
  private ruleCreateTool(conv: Conversation, a: Record<string, unknown>): { text?: string; error?: string } {
    const s = parseSchedule(String(a.schedule ?? ""), this.timeZone, this.now());
    if (!s.schedule) return { error: s.error };
    const kind: RuleKind = a.kind === "remind" ? "remind" : "check";
    const mode = a.mode === "observe" ? "observe" : "act";
    const r = this.createRule({ botId: conv.botId, conversationId: conv.id, title: String(a.title ?? ""), instruction: String(a.instruction ?? ""), kind, mode, message: String(a.message ?? ""), schedule: s.schedule });
    if (!r.rule) return { error: r.error };
    // 建议给用户的那几句按应用的语言（模型照着说，聊天的语言不同时它会自己换）；其余是给模型的指示
    const when = whenOf(r.rule);
    const title = r.rule.title;
    const wx = conv.channel === "weixin" ? ` This chat is WeChat, so also say: 「${tr("rules.weixinNote")}」` : "";
    if (kind === "remind") return { text: `Created reminder ${r.rule.id}: ${when} the user gets 「${r.rule.message}」. Confirm in one sentence, e.g. 「${tr("rules.remindReply", { when })}」${wx}` };
    if (r.rule.mode === "observe") return { text: `Created rule ${r.rule.id} 「${title}」 (${when}) in observe mode: it only records what it would say until the user switches it to act. Tell the user in one sentence: 「${tr("rules.createdObserveReply", { when, title })}」${wx}` };
    return { text: `Created rule ${r.rule.id} 「${title}」 (${when}): each run checks and messages the user only when something matters. Tell the user in one sentence: 「${tr("rules.createdReply", { when, title })}」${wx}` };
  }

  /** rule_update：改模式（执行 / 观察 / 关）、原话、时间表，或删掉 */
  private async ruleUpdateTool(conv: Conversation, a: Record<string, unknown>): Promise<{ text?: string; error?: string }> {
    const ref = String(a.rule ?? "").trim();
    const list = this.store.listRules({ conversationId: conv.id });
    const rule = list.find((r) => r.id === ref) ?? (ref ? list.find((r) => r.title.includes(ref) || ref.includes(r.title)) : undefined);
    if (!rule) return { error: `No rule matches "${ref}". Call task_list to see them.` };
    if (a.delete === true) {
      await this.deleteRule(rule.id);
      return { text: `Deleted rule 「${rule.title}」. Tell the user in one short sentence.` };
    }
    const patch: Parameters<TaskService["updateRule"]>[1] = {};
    if (a.mode !== undefined) {
      if (a.mode !== "observe" && a.mode !== "act" && a.mode !== "off") return { error: "mode must be observe, act or off" };
      patch.mode = a.mode;
    }
    if (typeof a.instruction === "string" && a.instruction.trim()) patch[rule.kind === "remind" ? "message" : "instruction"] = a.instruction;
    if (typeof a.schedule === "string" && a.schedule.trim()) {
      const s = parseSchedule(a.schedule, rule.trigger.kind === "schedule" ? rule.trigger.schedule.tz : this.timeZone, this.now());
      if (!s.schedule) return { error: s.error };
      patch.schedule = s.schedule;
    }
    if (!Object.keys(patch).length) return { error: "Nothing to change: give mode, instruction, schedule or delete." };
    const r = this.updateRule(rule.id, patch);
    if (!r.rule) return { error: r.error };
    const v = this.ruleView(r.rule);
    return { text: `Updated rule 「${v.title}」: ${v.when}, ${v.state.label}. Tell the user in one short sentence.` };
  }

  // ---------- 规则：查看 ----------

  /** 出站队列里那一句现在怎样了（合进摘要的看那一条） */
  private carrier(run: RunRow) {
    return run.delivery && !run.delivery.endsWith(":dropped") ? this.store.carrierOutbox(run.delivery) : undefined;
  }

  ruleView(rule: RuleRow): RuleView {
    const live = this.store.listRuns({ ruleId: rule.id, states: ["queued", "running", "settling"], limit: 1 })[0];
    const last = this.store.ruleRuns(rule.id, { limit: 5 }).find((r) => r.state === "ended");
    return {
      id: rule.id,
      botId: rule.botId,
      conversationId: rule.conversationId,
      channel: this.store.getConversation(rule.conversationId)?.channel ?? "",
      title: rule.title,
      instruction: rule.instruction,
      message: rule.message,
      kind: rule.kind,
      trigger: rule.trigger,
      when: whenOf(rule),
      mode: rule.mode,
      state: ruleState(rule, !!live),
      nextRunAt: rule.nextRunAt,
      ...(last ? { last: { at: last.queuedAt, outcome: last.outcome, line: runLine(last, rule.kind, this.carrier(last)) } } : {}),
      failures: rule.failures,
      pausedReason: rule.pausedReason,
      monthUsd: rule.kind === "check" ? this.monthSpent(rule) : 0,
      monthBudgetUsd: rule.monthBudgetUsd,
      runBudgetUsd: rule.runBudgetUsd,
      folder: rule.folder,
      version: rule.version,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      ...(live ? { live: { runId: live.id, state: live.state, since: live.startedAt || live.queuedAt } } : {}),
    };
  }

  listRules(o: { botId?: string; conversationId?: string } = {}): RuleView[] {
    return this.store.listRules(o).map((r) => this.ruleView(r));
  }

  getRuleView(id: string): RuleView | undefined {
    const r = this.store.getRule(id);
    return r ? this.ruleView(r) : undefined;
  }

  /** 运行记录（新→旧，一次一行）：时间、模式、结果、一行话；展开看报告、步骤、版本和权限 */
  ruleLog(ruleId: string, o: { before?: number; limit?: number } = {}): RuleRunView[] {
    const rule = this.store.getRule(ruleId);
    if (!rule) return [];
    return this.store.ruleRuns(ruleId, { before: o.before, limit: o.limit ?? 20 }).map((r) => ({
      id: r.id,
      at: r.queuedAt,
      mode: r.mode,
      cause: r.cause,
      state: r.state,
      outcome: r.outcome,
      line: runLine(r, rule.kind, this.carrier(r)),
      summary: r.report?.summary ?? "",
      message: r.report?.message ?? "",
      would: wouldText(r.would || r.report?.would || ""),
      error: errorText(r.error),
      version: r.ruleVersion,
      permission: permissionText(r.permission),
      steps: r.startedAt && r.outcome !== "skipped" ? this.activity(r.id).length : 0,
      costUsd: r.costUsd,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    }));
  }

  /**
   * 「需要你」里规则那一份：连续失败 3 次暂停了的（红），连续失败 2 次的（黄），本月预算用完暂停了的（黄，可以再给 $3 接着跑），
   * 观察够了、问要不要改为执行的（suggestItem）。原因没了（重试成功、关掉、删掉、下个月了）就消失。规则执行时的审批由审批中心那一份给。
   */
  ruleAttention(): AttentionItem[] {
    const out: AttentionItem[] = [];
    for (const rule of this.store.listRules()) {
      const suggest = this.suggestItem(rule);
      if (suggest) out.push(suggest);
      const paused = !!rule.pausedReason;
      if (!paused && (rule.mode === "off" || rule.failures < RULE_FAILS_TO_SHOW)) continue;
      const conv = this.store.getConversation(rule.conversationId);
      if (rule.pausedReason === "budget") {
        out.push({
          id: `rule:${rule.id}`,
          kind: "rule",
          botId: rule.botId,
          botName: this.store.getBot(rule.botId)?.name ?? rule.botId,
          subject: tr("rules.subject", { title: rule.title }),
          status: tr("rules.monthPaused"),
          head: tr("rules.headMonth", { title: rule.title }),
          line: tr("rules.monthLine", { spent: usdText(this.monthSpent(rule)), add: stepText(RULE_MONTH_BUDGET_USD) }),
          since: rule.updatedAt,
          severity: "warn",
          actions: ["continue"],
          conversationId: rule.conversationId,
          channel: conv?.channel ?? "",
          ruleId: rule.id,
        });
        continue;
      }
      // 最近一次失败（超出单次预算也算）
      const last = this.store.ruleRuns(rule.id, { limit: 10 }).find((r) => r.outcome === "failed" || (r.outcome === "budget" && r.error === RUN_ERROR.runBudget));
      out.push({
        id: `rule:${rule.id}`,
        kind: "rule",
        botId: rule.botId,
        botName: this.store.getBot(rule.botId)?.name ?? rule.botId,
        subject: tr("rules.subject", { title: rule.title }),
        status: tr(paused ? "rules.failingPaused" : "rules.failing", { count: rule.failures }),
        head: tr(paused ? "rules.headFailingPaused" : "rules.headFailing", { title: rule.title, count: rule.failures }),
        line: last ? clip(oneLine((last.outcome === "failed" && last.report?.message) || errorText(last.error || RUN_ERROR.noReport)), 200) : "",
        since: last?.endedAt || rule.updatedAt,
        severity: paused ? "err" : "warn",
        actions: ["retry"],
        conversationId: rule.conversationId,
        channel: conv?.channel ?? "",
        ruleId: rule.id,
      });
    }
    return out;
  }

  /**
   * 用户选了观察、没暂停的检查，这一版好好观察了 3 次（做完了的；失败、跳过的不算）：「需要你」里问要不要改为执行，第二行是最近那次
   * 运行记录里的那一行。只在应用里：不推送、不发系统通知。改为执行、关掉、暂停、删掉就消失；继续观察了的这一版不再问
   * （改了原话版本加 1，新的一版再好好观察 3 次再问）。
   */
  private suggestItem(rule: RuleRow): AttentionItem | undefined {
    if (rule.kind !== "check" || rule.mode !== "observe" || rule.pausedReason) return undefined;
    if (Number(this.store.getKV(SUGGEST_SEEN + rule.id) || 0) >= rule.version) return undefined;
    const good = this.store.ruleRuns(rule.id, { mode: "observe", outcome: "done", version: rule.version, limit: RULE_SUGGEST_AFTER });
    if (good.length < RULE_SUGGEST_AFTER) return undefined;
    const last = good[0];
    const subject = tr("rules.suggest", { title: rule.title, count: RULE_SUGGEST_AFTER });
    return {
      id: `suggest:${rule.id}`,
      kind: "suggest",
      botId: rule.botId,
      botName: this.store.getBot(rule.botId)?.name ?? rule.botId,
      subject,
      status: "",
      head: subject,
      line: runLine(last, rule.kind, this.carrier(last)),
      since: last.endedAt || last.queuedAt,
      severity: "warn",
      actions: ["act", "dismiss"],
      conversationId: rule.conversationId,
      channel: this.store.getConversation(rule.conversationId)?.channel ?? "",
      ruleId: rule.id,
      ruleTitle: rule.title,
    };
  }

  /** 「需要你」里的继续观察：这一版不再问要不要改为执行 */
  keepObserving(id: string): boolean {
    const rule = this.store.getRule(id);
    if (!rule) return false;
    this.store.setKV(SUGGEST_SEEN + id, String(rule.version));
    log.info("rule keeps observing", { rule: id, version: rule.version });
    this.changed(id);
    return true;
  }
}

/**
 * task_report 的 question：一句问题（字符串或 {question, options, multiSelect, default}），选项最多 6 个；
 * default：用户没回答时按它做（有选项时要是其中一个，report 里查）
 */
function questionOf(b: any): TaskReport["question"] | undefined {
  const raw = b?.question;
  const obj = typeof raw === "object" && raw ? raw : undefined;
  const text = oneLine(String(obj ? (obj.question ?? "") : (raw ?? "")));
  if (!text) return undefined;
  const list = (Array.isArray(obj?.options) ? obj.options : Array.isArray(b?.options) ? b.options : []) as unknown[];
  const label = (o: unknown) => clip(oneLine(String(typeof o === "object" && o ? ((o as { label?: unknown }).label ?? "") : (o ?? ""))), 60);
  const options = [...new Set(list.map(label).filter(Boolean))].slice(0, OPTIONS_MAX);
  const multi = obj?.multiSelect === true || b?.multi_select === true;
  const given = clip(oneLine(String(obj?.default ?? b?.default ?? "")), 60);
  // 写成了选项编号（"1"）：换成那个选项
  const fallback = !options.includes(given) && /^\d+$/.test(given) && Number(given) >= 1 && Number(given) <= options.length ? options[Number(given) - 1] : given;
  return {
    question: clip(text, QUESTION_MAX),
    ...(options.length ? { options } : {}),
    ...(multi && options.length > 1 ? { multiSelect: true } : {}),
    ...(fallback ? { default: fallback } : {}),
  };
}

/** 比引用时去掉空白、记号和末尾的省略号（引用可能被截短） */
const normQuote = (s: string) => s.replace(/\s+/g, "").replace(/[❓⚠\uFE0F]/g, "").replace(/(…|\.\.\.)+$/, "");
/** 前面可能带着发送者的名字（"小蓝："） */
const unnamed = (q: string) => q.replace(/^[^:：「]{1,24}[:：]/, "");

/** 引用的是不是推出去的那一条：去掉空白和记号再比；引用可能被截短（末尾省略号）、前面带名字 */
export function quotes(sent: string, quote: string, question: string): boolean {
  const q = normQuote(quote);
  if (!q) return false;
  const s = normQuote(sent);
  const ask = normQuote(question);
  const bare = unnamed(q);
  return (!!s && (s === q || [q, bare].some((x) => x.length >= 6 && s.includes(x)))) || (ask.length >= 2 && q.includes(ask));
}

/**
 * 引用和推出去的结果（或失败那句）有多像，几个任务都对得上时取最像的：3 = 就是它（前面可能带名字）；
 * 2 = 引用里有整句结果（「你不在时」合成的一条），或是它被截短；1 = 去掉开头像名字的一段才对得上（"RESULT：…" 这种开头也会被当成名字）；0 = 不是
 */
export function quoteScore(sent: string, text: string, quote: string): number {
  const q = normQuote(quote);
  const s = normQuote(sent);
  if (!q || !s) return 0;
  const a = normQuote(text);
  const bare = unnamed(q);
  if (s === q || s === bare) return 3;
  if ((a.length >= 2 && q.includes(a)) || (q.length >= 6 && s.includes(q))) return 2;
  return bare.length >= 6 && s.includes(bare) ? 1 : 0;
}

function parseSteps(json: string | undefined): ActivityStep[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 会话最近收到的那条消息的回复句柄（runtime 存在 KV 里） */
function replyHandle(store: Store, conversationId: string): Record<string, string> {
  try {
    return JSON.parse(store.getKV(`reply-to:${conversationId}`) || "{}") ?? {};
  } catch {
    return {};
  }
}
