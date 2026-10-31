/**
 * 任务的阶段（设计文档第 2 节的阶段表）：从上往下，第一条符合的为准。任务自己定义阶段，不跟着 DSH 会话的状态走。
 * 用户看到的只有这几种：进行中、等你、已完成、失败、已停止。改编自 dsh-superagent 的 core/stage.ts（MIT）。
 */
import type { RunOutcome, RunState } from "../store/db.js";
import { t as tr, type MessageKey } from "../i18n/index.js";

export type StageKey =
  | "stopped"
  | "needs-you/delivery"
  | "needs-you/answer"
  | "needs-you/approval"
  | "needs-you/budget"
  | "failed"
  | "ready"
  | "working/queued"
  | "working";

/** 分组：进行中 / 等你 / 结束了 */
export type StageGroup = "working" | "needs" | "ended";

export interface Stage {
  key: StageKey;
  label: string;
  group: StageGroup;
}

export interface StageInput {
  /** 有人停了它 */
  stopped: boolean;
  /** 最近的结果 / 失败消息没送到会话（出站队列放弃了，或渠道要用户先做点什么） */
  undelivered?: boolean;
  /** 等用户回答（3b）或批准（阻塞着的审批） */
  waiting?: "answer" | "approval";
  /** 最近的 run（它的结果就是最近一次 Report 的状态：done / failed / needs_you） */
  run?: { state: RunState; outcome: RunOutcome };
}

const STAGES: Record<StageKey, Stage> = {
  stopped: { key: "stopped", get label() { return tr("tasks.stageStopped" as MessageKey); }, group: "ended" },
  "needs-you/delivery": { key: "needs-you/delivery", get label() { return tr("tasks.stageDelivery" as MessageKey); }, group: "needs" },
  "needs-you/answer": { key: "needs-you/answer", get label() { return tr("tasks.stageAnswer" as MessageKey); }, group: "needs" },
  "needs-you/approval": { key: "needs-you/approval", get label() { return tr("tasks.stageApproval" as MessageKey); }, group: "needs" },
  "needs-you/budget": { key: "needs-you/budget", get label() { return tr("tasks.stageBudget" as MessageKey); }, group: "needs" },
  failed: { key: "failed", get label() { return tr("tasks.stageFailed" as MessageKey); }, group: "needs" },
  ready: { key: "ready", get label() { return tr("tasks.stageReady" as MessageKey); }, group: "ended" },
  "working/queued": { key: "working/queued", get label() { return tr("tasks.stageQueued" as MessageKey); }, group: "working" },
  working: { key: "working", get label() { return tr("tasks.stageWorking" as MessageKey); }, group: "working" },
};

export function stageOf(key: StageKey): Stage {
  return STAGES[key];
}

/**
 * 阶段表：
 * 1 停止了 → 已停止；2 最近的消息没送到 → 未送达；3 有问题或审批在等 → 等你回答 / 等你批准；4 run 停在预算上 → 预算用完；
 * 5 最近的 run 以失败结束（之后没有人的输入）→ 失败；6 以完成结束 → 已完成；7 有输入在等名额 → 排队中；8 其余 → 进行中。
 * 人的输入（回答、追加、重试）会开新的 run，最近的 run 就不再是结束的那个；自动的输入（恢复）不越过 2–5。
 */
export function taskStage(i: StageInput): Stage {
  if (i.stopped) return STAGES.stopped;
  const run = i.run;
  const ended = !run || run.state === "ended";
  if (i.undelivered && ended) return STAGES["needs-you/delivery"];
  if (i.waiting === "answer") return STAGES["needs-you/answer"];
  if (i.waiting === "approval") return STAGES["needs-you/approval"];
  if (ended && run?.outcome === "needs_you") return STAGES["needs-you/answer"];
  if (ended && run?.outcome === "budget") return STAGES["needs-you/budget"];
  if (ended && run?.outcome === "failed") return STAGES.failed;
  if (ended && run?.outcome === "done") return STAGES.ready;
  if (!run || run.state === "queued" || run.outcome === "interrupted" || run.outcome === "skipped") return STAGES["working/queued"];
  return STAGES.working;
}
