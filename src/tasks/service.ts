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
 * - 提问（3b）：代理报 needs_you 带一个问题，这一轮结束时变成审批中心里一条不阻塞、不过期的提问，推给请求它的会话
 *   （一个会话同时只推一个）；回答成为任务的新输入，任务在人的名额里接着做。任务会话里的审批也推过去（阻塞、12 小时）。
 *
 * 3c–3f 的缝：规则（rule_id）、花费（cost_usd、budget）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { needsPerson, type Delivery } from "../core/delivery.js";
import { ActivityLog, type ActivityStep } from "../agent/activity.js";
import { ResumeFailed, deliverables } from "../agent/host.js";
import { answerLine, promptButtons, questionsOf, taskPromptText, type ApprovalCenter, type ApprovalEvent, type QuestionItem, type ReplyContext } from "../agent/approvals.js";
import { actionCardSpec } from "../channels/feishu/transport.js";
import { NUDGE, attachmentsOf, rebrief, recoveryNote, retryNote, taskBrief } from "../agent/prompts/index.js";
import type { BotSettings } from "../agent/settings.js";
import type { ApprovalRow, Conversation, InputKind, RunCause, RunInputRow, RunOutcome, RunRow, Store, TaskReport, TaskRow } from "../store/db.js";
import type { AttentionItem } from "./attention.js";
import { logger } from "../log.js";
import { DEFAULT_MAX_BACKGROUND, pickRuns, priorityOf } from "./slots.js";
import { taskStage, type Stage } from "./stage.js";

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
  /** 会话空闲时还有没有后台命令、子代理在跑；有就由插件在它们结束、会话再次空闲时报 task-settled */
  quiet(botId: string, sessionId: string): Promise<{ quiet: boolean; jobs?: string[] }>;
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
  /** 任务有变化（阶段、进展） */
  onChange?: (taskId: string) => void;
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
  /** 正在跑的那个 run：开始时间与步数 */
  live?: { runId: string; since: number; steps: number; current?: ActivityStep };
}

/** 一个在跑（或收尾中）的 run 的内存状态 */
interface Live {
  runId: string;
  taskId: string;
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
}

const hex = (n: number) => crypto.randomBytes(n).toString("hex");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

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

  constructor(private o: TaskServiceOptions) {
    // 进行中的任务：给微信留 1 条配额（聊天回复不会把它挤掉），续期提醒里也算"之后还要发的"
    o.delivery?.addReserver((p) => this.working(p.conversationId).length);
    // 推给用户、还没回答的提问（审批）：再留 1 条（设计第 6 节：任务、待答问题各占 1 条，一共最多 3 条）
    o.delivery?.addReserver((p) => (o.approvals?.pending(p.conversationId).some((r) => r.taskId) ? 1 : 0));
    o.delivery?.addUpcoming((p) => this.working(p.conversationId).map((t) => ({ label: t.title, kind: "task" as const })));
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
    this.recover(undefined, "应用重启");
    for (const r of this.store.listRuns({ states: ["ended"] })) {
      if (!r.taskId) continue;
      if (!r.delivery && (r.outcome === "done" || r.outcome === "failed")) {
        const task = this.store.getTask(r.taskId);
        if (task) this.deliver(task, r.id, r.outcome, r.report, r.error);
      } else if (r.outcome === "needs_you" && r.report?.question) {
        const task = this.store.getTask(r.taskId);
        if (task && task.endReason !== "stopped" && this.store.latestRun(task.id)?.id === r.id) this.ask(task, r.id, r.report.question);
      }
    }
    for (const conv of new Set((this.o.approvals?.pendingAll() ?? []).filter((r) => r.taskId).map((r) => r.conversationId))) this.pushNext(conv);
    this.pump();
  }

  /** 应用退出：不再开始新的 run；跑着的留在库里（下次启动时恢复），步骤先存下 */
  stop(): void {
    this.closing = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const l of this.live.values()) {
      clearTimeout(l.timer);
      try {
        this.store.updateRun(l.runId, { activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut });
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
    this.recover(botId, "代理进程退出");
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
      this.store.updateRun(run.id, { state: "ended", outcome: "interrupted", endedAt: this.now(), error: why, ...(l ? { activity: JSON.stringify(steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut } : {}) });
      const task = run.taskId ? this.store.getTask(run.taskId) : undefined;
      // 这一轮在等的批准随它没了（DSH 那次调用不在了）：恢复后代理需要的话再问
      for (const a of run.taskId ? (this.o.approvals?.pendingForTask(run.taskId) ?? []) : []) if (a.blocking) this.o.approvals!.cancel(a.id, "interrupted");
      if (!task || task.endedAt) continue;
      const jobs = steps.filter((s) => s.kind === "job" && s.status === "running").map((s) => clip(oneLine(s.summary || s.title), 120));
      this.addInput(task.id, "recovery", recoveryNote(jobs), false);
      if (!this.queuedRun(task.id)) this.enqueue(task, "recover");
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
      budgetUsd: o.budgetUsd && o.budgetUsd > 0 ? Math.min(o.budgetUsd, 100) : 1,
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
    if (task.endReason === "stopped") return { error: `「${task.title}」已停止，不能再追加；需要的话开个新任务。` };
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
    if (task.endReason === "stopped") return { error: `「${task.title}」已停止` };
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
      l.activity.end("已停止");
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

  /** 有空名额就开始排队的 run（人的唤醒在前，见 slots.ts） */
  pump(): void {
    if (!this.started || this.closing) return;
    const queued = this.store.listRuns({ states: ["queued"] }).filter((r) => r.taskId && !this.dropped.has(r.botId));
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
    const task = this.store.getTask(run.taskId);
    const now = this.now();
    if (!task || task.endReason === "stopped") {
      this.store.updateRun(runId, { state: "ended", outcome: "stopped", endedAt: now });
      return;
    }
    this.store.updateRun(runId, { state: "running", startedAt: now, sessionId: task.sessionId });
    const l: Live = {
      runId,
      taskId: task.id,
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
    const task = this.store.getTask(l.taskId);
    if (!task) return;
    l.starting = true;
    l.settling = false;
    if (inputs.some((i) => i.fromPerson)) this.reopen(l);
    const text = inputs.map((i) => i.text).join("\n\n");
    const folder = path.join(this.o.host.workspace(task.botId), task.folder);
    const model = this.modelOf(task);
    try {
      let id: string;
      try {
        fs.mkdirSync(folder, { recursive: true });
        id = await this.o.host.prompt(task.botId, { sessionId: l.sessionId, folder, model, text, resume: this.store.taskPrompted(task.id) });
      } catch (e) {
        if (!(e instanceof ResumeFailed)) throw e;
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
        // 交出去的时候任务被停了：输入已经到了会话里，再停一次（插件拒绝它之后的工具调用）
        if (this.store.getTask(l.taskId)?.endReason === "stopped") await this.o.host.stop(l.botId, l.sessionId).catch(() => undefined);
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
          void this.deliver_(l, this.store.openInputs(l.taskId).filter((i) => !i.deliveredAt || i.runId === l.runId));
        }, delay);
        l.timer.unref?.();
        return;
      }
      this.end(l, "failed", undefined, this.o.host.available ? "代理没能启动" : "代理不可用");
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

  // ---------- 会话事件（宿主转来的 SDK 通知） ----------

  /** root：任务会话 id（子代理的通知也归到它） */
  onEvent(_botId: string, root: string, n: TaskNotification): void {
    const l = this.bySession.get(root);
    if (!l) return;
    const p = n.params ?? {};
    if (n.method === "subagent.started" || n.method === "subagent.finished") {
      l.activity.apply(n.method.replace(".", "/"), p);
      return;
    }
    if (p.sessionId !== root) return;
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
      if (this.store.takeInputs(l.taskId, id, this.now())) this.changed(l.taskId);
    } else if (type === "turn/start") l.turnError = undefined;
    else if (type === "turn/end") {
      if (data?.reason?.kind === "error") l.turnError = String(data.reason.error?.message ?? "unknown error");
      this.store.updateRun(l.runId, { activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut });
      this.changed(l.taskId);
    } else if (type === "assistant/message" && data.usage) {
      l.tokensIn += Number(data.usage.inputTokens) || 0;
      l.tokensOut += Number(data.usage.outputTokens) || 0;
    }
  }

  /**
   * 会话空了：交出去的输入都被收下了（不然是旧的空闲）、没有要交的了，就问插件还有没有后台命令、子代理；
   * 没有就结束这个 run，有就收尾（settling），等插件报 task-settled。
   */
  private async checkSettle(l: Live): Promise<void> {
    if (l.busy || l.starting || l.checking || l.timer || this.closing || this.live.get(l.runId) !== l) return;
    const open = this.store.openInputs(l.taskId);
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
    if (q.quiet) return this.finish(l);
    l.settling = true;
    this.store.updateRun(l.runId, { state: "settling" });
    this.changed(l.taskId);
  }

  /** 插件：收尾中的会话安静下来了（后台命令、子代理都结束了，或者收尾超时被停掉了） */
  settled(b: any): { ok: true } {
    const l = this.bySession.get(String(b?.sessionId ?? ""));
    if (!l || l.busy || l.starting || l.checking) return { ok: true };
    if (this.store.openInputs(l.taskId).some((i) => i.deliveredAt && i.runId === l.runId)) return { ok: true };
    const killed = Array.isArray(b?.killedJobs) ? b.killedJobs.map(String) : [];
    if (killed.length) log.info("task settling timed out; background jobs were stopped", { task: l.taskId, jobs: killed });
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
      log.warn("task turn failed; continuing after a pause", { task: l.taskId, inMs: delay, message: error.slice(0, 200) });
      l.timer = setTimeout(() => {
        l.timer = undefined;
        void this.deliver_(l, [this.addInput(l.taskId, "note", retryNote(error), false)]);
      }, delay);
      l.timer.unref?.();
      return;
    }
    if (!l.nudged) {
      l.nudged = true;
      void this.deliver_(l, [this.addInput(l.taskId, "nudge", NUDGE, false)]);
      return;
    }
    if (l.turnError) log.warn("task failed after retries", { task: l.taskId, message: l.turnError.slice(0, 300) });
    this.end(l, "failed", undefined, l.turnError ? "模型一直出错" : "没有给出结果");
  }

  /** 结束 run：存下步骤、结果；done / failed 发回会话；空出名额 */
  private end(l: Live, outcome: RunOutcome, report?: TaskReport, error = ""): void {
    if (this.live.get(l.runId) !== l) return;
    this.forget(l);
    const now = this.now();
    this.store.updateRun(l.runId, { state: "ended", outcome, report, error, endedAt: now, activity: JSON.stringify(l.activity.steps), tokensIn: l.tokensIn, tokensOut: l.tokensOut });
    const task = this.store.getTask(l.taskId);
    if (task && outcome === "done") this.store.updateTask(task.id, { endedAt: now, endReason: "done", updatedAt: now });
    else if (task) this.store.updateTask(task.id, { updatedAt: now });
    if (task && (outcome === "done" || outcome === "failed")) this.deliver(task, l.runId, outcome, report, error);
    if (task && outcome === "needs_you" && report?.question) this.ask(task, l.runId, report.question);
    log.info("background task run ended", { task: l.taskId, run: l.runId, outcome, ...(error ? { error } : {}) });
    this.changed(l.taskId);
    this.pump();
  }

  private forget(l: Live): void {
    clearTimeout(l.timer);
    l.timer = undefined;
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
    const text = outcome === "done" ? clip(msg, MESSAGE_MAX) || `「${task.title}」做好了。` : `⚠️「${task.title}」没做完：${clip(msg || error || "没有给出结果", MESSAGE_MAX)}`;
    const files = outcome === "done" ? this.files(task, report?.files ?? []) : [];
    if ((conv.channel === "weixin" || conv.channel === "feishu") && this.o.delivery) this.post(conv, task, id, purpose, text, files);
    this.store.addMessage(conv.id, "assistant", files.length && conv.channel === "web" ? `${text}\n\n${files.map((f) => `- ${path.relative(this.o.host.workspace(task.botId), f)}`).join("\n")}` : text);
    this.store.updateRun(runId, { delivery: id });
    this.note(conv.id, outcome === "done" ? `[后台任务「${task.title}」已完成，已把结果发给用户] ${text}` : `[后台任务「${task.title}」失败了，已告诉用户] ${text}`);
  }

  /** 微信、飞书：按主动消息的规则写进出站队列（同步落库；渠道没上线时等它上线） */
  private post(conv: Conversation, task: TaskRow, id: string, purpose: "result" | "failure", text: string, files: string[]): void {
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

  /** task_report：记下 Report；done / failed 在这一轮结束、会话安静后发给用户，needs_you 的问题那时问用户 */
  report(b: any): { text?: string; error?: string } {
    const l = this.bySession.get(String(b?.sessionId ?? ""));
    if (!l) return { error: "This background task is not running any more (it was stopped or has ended). Stop working on it." };
    const state = String(b?.state ?? "");
    if (state !== "progress" && state !== "done" && state !== "failed" && state !== "needs_you") return { error: "state must be progress, needs_you, done or failed" };
    const question = state === "needs_you" ? questionOf(b) : undefined;
    if (state === "needs_you" && !question) return { error: "needs_you needs a question: one question for the user, with options when there are clear choices." };
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
    if (state !== "progress") l.final = report;
    this.changed(l.taskId);
    if (state === "progress") return { text: "Progress recorded (it is not sent to the user). Continue the task." };
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
        const r = this.create({ botId, conversationId: conv.id, title: String(a.title ?? ""), brief: String(a.brief ?? ""), budgetUsd: Number(a.budget_usd) || undefined, anytime: a.anytime === true });
        if (!r.task) return { error: r.error };
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
        if (!list.length) return { text: "This conversation has no background tasks." };
        return { text: list.map((t) => `${t.id} 「${t.title}」 ${t.stage.label}${t.latest ? ` — ${t.latest}` : ""}`).join("\n") };
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

  /** 代理报了 needs_you、这一轮结束了：问题记成一条不阻塞、不过期的提问（每个 run 只问一次），给聊天代理留张便条 */
  private ask(task: TaskRow, runId: string, q: NonNullable<TaskReport["question"]>): void {
    const a = this.o.approvals;
    if (!a || this.store.listApprovals({ runId, limit: 5 }).some((r) => r.kind === "question" && r.taskId === task.id)) return;
    const item: QuestionItem = { id: "answer", question: q.question, ...(q.options?.length ? { options: q.options.map((label) => ({ label })) } : {}), ...(q.multiSelect ? { multiSelect: true } : {}) };
    a.create({ kind: "question", botId: task.botId, conversationId: task.conversationId, sessionId: task.sessionId, tool: "task_report", detail: q.question, reason: "", payload: JSON.stringify([item]), taskId: task.id, runId, blocking: false, ttlMs: 0 });
    log.info("background task asks the user", { task: task.id, run: runId });
    this.note(task.conversationId, `[后台任务「${task.title}」在等用户回答：${q.question}${q.options?.length ? `（${q.options.join(" / ")}）` : ""}。用户在聊天里回答它时，用 task_message 转给这个任务]`);
  }

  /** 审批中心有新的、或有了决定：任务的提问有了回答就交给任务；更新阶段；同一会话的下一个提问可以推了 */
  private onApproval(e: ApprovalEvent): void {
    const row = e.row;
    if (!row.taskId) return;
    const task = this.store.getTask(row.taskId);
    if (!task) return;
    if (e.type === "decided" && row.kind === "question" && !row.blocking && row.status === "answered" && task.endReason !== "stopped") this.answered(task, row);
    // 有了决定（在桌面上回答了、批了，任务停了）：推给用户还没发出去的那条（排到早上、等微信窗口）不用再发了
    if (e.type === "decided") this.o.delivery?.withdraw(askId(row), `已${row.status === "answered" ? "回答" : "处理"}`);
    this.changed(task.id);
    // 等批准时让出的名额：有了决定，排队的可能要等它了
    if (e.type === "decided" && row.blocking) this.pump();
    this.pushNext(row.conversationId);
  }

  /** 用户回答了任务的提问：回答成为任务的新输入（人的唤醒：预留名额、排在前面） */
  private answered(task: TaskRow, row: ApprovalRow): void {
    const q = questionsOf(row)[0]?.question ?? row.detail;
    const input = this.addInput(task.id, "answer", `[用户回答了你的问题]\n问题：${q}\n回答：${answerLine(row) || "（没有写）"}`, true);
    log.info("the user answered a background task's question", { task: task.id, by: row.decidedBy });
    void this.wake(task, input, "answer");
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
      const title = row.kind === "approval" ? `需批准（任务「${task.title}」）` : `「${task.title}」想问你`;
      const body = row.kind === "approval" ? (row.detail ? "`" + row.detail.slice(0, 300) + "`" : row.tool) : (questionsOf(row)[0]?.question ?? row.detail);
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
        return t ? `收到，「${t.title}」继续。` : undefined;
      },
    };
  }

  /** "需要你"里任务那一份：失败、预算用完（提问和审批由审批中心那一份给，没送到的由出站队列那一份给：core/delivery.ts） */
  attention(): AttentionItem[] {
    const out: AttentionItem[] = [];
    const since = this.now() - 7 * 86400_000;
    const tasks = [...this.store.listTasks({ open: true, limit: 200 }), ...this.store.listTasks({ open: false, since, limit: 100 })];
    for (const t of tasks) {
      const run = this.store.latestRun(t.id);
      const st = this.stage(t, run);
      if (st.key !== "failed" && st.key !== "needs-you/budget") continue;
      const bot = this.store.getBot(t.botId);
      const conv = this.store.getConversation(t.conversationId);
      const r = run?.report ?? t.report;
      const line = st.key === "failed" ? r?.message || run?.error || "没有给出结果" : r?.message || r?.summary.split("\n")[0] || "";
      out.push({
        id: `task:${t.id}`,
        kind: "failed",
        botId: t.botId,
        botName: bot?.name ?? t.botId,
        subject: t.title,
        status: st.label,
        line: clip(oneLine(line), 200),
        since: run?.endedAt || t.updatedAt,
        severity: st.key === "failed" ? "err" : "warn",
        actions: ["retry", "stop"],
        conversationId: t.conversationId,
        channel: conv?.channel ?? "",
        taskId: t.id,
      });
    }
    return out;
  }

  // ---------- 查看 ----------

  private stage(task: TaskRow, run = this.store.latestRun(task.id)): Stage {
    // 结果没送到：留着等对方发消息、一直失败、放弃了（合进摘要的看那一条）；排着等早上的、在「需要你」里不再提示的不算
    const delivery = run?.delivery && !run.delivery.endsWith(":dropped") ? this.o.store.carrierOutbox(run.delivery) : undefined;
    // 它在等的：任务会话（或子代理）里的审批、它报的提问
    const now = this.now();
    const rows = this.store.listApprovals({ status: "pending", botId: task.botId, limit: 200 }).filter((a) => (a.taskId === task.id || a.sessionId === task.sessionId) && (a.expiresAt === 0 || a.expiresAt > now));
    const waiting = rows.some((a) => a.kind === "approval") ? "approval" : rows.length ? "answer" : undefined;
    return taskStage({ stopped: task.endReason === "stopped", undelivered: needsPerson(delivery), waiting, run });
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
      ...(l && run ? { live: { runId: run.id, since: run.startedAt, steps: l.activity.steps.length, current: l.activity.steps.findLast((s) => s.status === "running") } } : {}),
    };
  }

  /** 任务列表：进行中、等你的在前，再按新旧 */
  list(o: { botId?: string; conversationId?: string; limit?: number; since?: number } = {}): TaskView[] {
    const rank = { working: 0, needs: 1, ended: 2 } as const;
    return this.store
      .listTasks({ botId: o.botId, conversationId: o.conversationId, limit: 200 })
      .map((t) => this.view(t))
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

  /** 每个机器人正在进行的任务数（侧栏"正在工作"） */
  background(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.store.listRuns({ states: ["queued", "running", "settling"] })) out[r.botId] = (out[r.botId] ?? 0) + 1;
    return out;
  }

  /** /tasks：这个会话的任务，带编号（/stop 编号 用同一个顺序） */
  listText(conversationId: string): string {
    const list = this.list({ conversationId, limit: 10, since: this.now() - 7 * 86400_000 });
    if (!list.length) return "没有后台任务。";
    const lines = list.map((t, i) => `${i + 1}. ${t.title} · ${t.stage.label}${t.latest ? `：${clip(t.latest, 40)}` : ""}`);
    const working = list.findIndex((t) => t.stage.group === "working");
    return ["后台任务：", ...lines, ...(working >= 0 ? ["发 /stop 编号 可停止。"] : [])].join("\n");
  }

  /** /stop 编号：立即记为停止（停会话在后台进行），返回给用户的话 */
  stopByIndex(conversationId: string, n: number, by: string): string {
    const list = this.list({ conversationId, limit: 10, since: this.now() - 7 * 86400_000 });
    const t = list[n - 1];
    if (!t) return `没有第 ${n} 个后台任务，发 /tasks 查看。`;
    if (t.stage.group !== "working") return `「${t.title}」${t.stage.label}。`;
    void this.stopTask(t.id, by);
    return `已停止后台任务「${t.title}」。`;
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
}

/** task_report 的 question：一句问题（字符串或 {question, options, multiSelect}），选项最多 6 个 */
function questionOf(b: any): TaskReport["question"] | undefined {
  const raw = b?.question;
  const obj = typeof raw === "object" && raw ? raw : undefined;
  const text = oneLine(String(obj ? (obj.question ?? "") : (raw ?? "")));
  if (!text) return undefined;
  const list = (Array.isArray(obj?.options) ? obj.options : Array.isArray(b?.options) ? b.options : []) as unknown[];
  const label = (o: unknown) => clip(oneLine(String(typeof o === "object" && o ? ((o as { label?: unknown }).label ?? "") : (o ?? ""))), 60);
  const options = [...new Set(list.map(label).filter(Boolean))].slice(0, OPTIONS_MAX);
  const multi = obj?.multiSelect === true || b?.multi_select === true;
  return { question: clip(text, QUESTION_MAX), ...(options.length ? { options } : {}), ...(multi && options.length > 1 ? { multiSelect: true } : {}) };
}

/** 引用的是不是推出去的那一条：去掉空白和记号再比；引用可能被截短（末尾省略号）、前面带名字 */
export function quotes(sent: string, quote: string, question: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[❓⚠\uFE0F]/g, "").replace(/(…|\.\.\.)+$/, "");
  const q = norm(quote);
  if (!q) return false;
  const s = norm(sent);
  const ask = norm(question);
  // 前面可能带着发送者的名字（"小蓝："）
  const bare = q.replace(/^[^:：「]{1,24}[:：]/, "");
  return (!!s && (s === q || [q, bare].some((x) => x.length >= 6 && s.includes(x)))) || (ask.length >= 2 && q.includes(ask));
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
