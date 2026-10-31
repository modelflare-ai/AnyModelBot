/**
 * 后台名额（设计文档第 3 节）：每个机器人最多 taskSlots 个 run（默认 2），所有机器人加起来最多 maxBackground 个（默认 4）。
 * run 在 running、settling 时占着名额。聊天回合从不占名额，也从不排进任务的队列（人的通道）。
 * 人引起的唤醒（回答、批准、追加、重试、继续）可以多用每个机器人一个预留名额，并排在排队的工作前面。
 * 先后：人的唤醒 → 新任务启动 → 重启后的恢复 → 规则（3d）。改编自 dsh-superagent 的 WorkerSlots（MIT）。
 */
import type { RunCause } from "../store/db.js";

export type Priority = "person" | "launch" | "recover" | "rule";

const ORDER: Record<Priority, number> = { person: 0, launch: 1, recover: 2, rule: 3 };

/** run 的起因 → 先后 */
export function priorityOf(cause: RunCause): Priority {
  if (cause === "launch") return "launch";
  if (cause === "recover") return "recover";
  if (cause === "schedule") return "rule";
  return "person";
}

export const DEFAULT_TASK_SLOTS = 2;
export const DEFAULT_MAX_BACKGROUND = 4;

export interface SlotLimits {
  /** 这个机器人的名额 */
  perBot(botId: string): number;
  /** 所有机器人加起来 */
  global: number;
}

export interface Waiting {
  id: string;
  botId: string;
  priority: Priority;
  queuedAt: number;
}

/** 按先后排好：人的唤醒在前，同一级按排队时间 */
export function byPriority<T extends Waiting>(list: T[]): T[] {
  return [...list].sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || a.queuedAt - b.queuedAt);
}

/**
 * 现在能开始哪些排队的 run：running 是正占着名额的（每个一项，给出机器人）。
 * 人的唤醒可以多用本机器人一个名额，也不受总数限制（预留名额只给人）；其余的受两个上限约束。
 */
export function pickRuns<T extends Waiting>(queued: T[], running: Array<{ botId: string }>, limits: SlotLimits): T[] {
  const perBot = new Map<string, number>();
  for (const r of running) perBot.set(r.botId, (perBot.get(r.botId) ?? 0) + 1);
  let total = running.length;
  const out: T[] = [];
  for (const q of byPriority(queued)) {
    const used = perBot.get(q.botId) ?? 0;
    const person = q.priority === "person";
    const cap = Math.max(0, limits.perBot(q.botId)) + (person ? 1 : 0);
    if (used >= cap) continue;
    if (!person && total >= limits.global) continue;
    out.push(q);
    perBot.set(q.botId, used + 1);
    total++;
  }
  return out;
}
