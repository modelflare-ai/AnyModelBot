/**
 * "需要你"（设计第 1、6 节的 Attention）：所有机器人里在等人的事。有的存着（提问、审批：approvals 表），
 * 有的从状态推出来（失败的任务、没送到的结果、过期的微信登录）。原因没了它自己就消失。
 *
 * - 来源可以登记（addSource）：审批中心、任务服务、渠道各给一份；3c 的"留着没发出去的消息"也从这里接进来。
 * - 有变化（kick，或每 10 秒看一眼）时通知订阅者：侧栏的数字、托盘角标、系统通知。
 * - 系统通知每一项最多一次（takeNew：记在 KV 里，重启也算）。
 * 健康时什么都没有：没有行、没有角标、没有通知。
 */
import type { ApprovalRow, Store } from "../store/db.js";
import { questionsOf, type QuestionItem } from "../agent/approvals.js";
import type { AttentionItem as DeliveryItem } from "../core/delivery.js";
import { logger } from "../log.js";
import { t as tr } from "../i18n/index.js";

const log = logger("attention");

/** question / approval：在等你回答、批准；failed：任务失败了；delivery：结果没送到；login：渠道登录过期了 */
export type AttentionKind = "question" | "approval" | "failed" | "delivery" | "login";
/** answer、approve、deny、retry（任务再试 / 消息再发）、stop、dismiss（不再提示）、relogin（去重新扫码）、open（打开对话） */
export type AttentionAction = "answer" | "approve" | "deny" | "retry" | "stop" | "dismiss" | "relogin" | "open";

export interface AttentionItem {
  /** 稳定 id：approval:<id>、task:<id>、delivery:<会话>:held|failed、login:<bot>:<渠道> */
  id: string;
  kind: AttentionKind;
  botId: string;
  botName: string;
  /** 说的是什么：任务名、渠道名（"微信"），或一句话（"微信登录已过期"） */
  subject: string;
  /** 状态：等你回答 / 等你批准 / 失败 / 未送达；没有就不显示 */
  status: string;
  /** 第二行：问题、命令、失败原因、没送到的那句话 */
  line: string;
  since: number;
  severity: "warn" | "err";
  actions: AttentionAction[];
  conversationId?: string;
  channel?: string;
  taskId?: string;
  approvalId?: string;
  code?: string;
  questions?: QuestionItem[];
}

export type AttentionSource = () => AttentionItem[];

/** 排序：提问和审批在前（等着的事），再是失败、没送到，最后是系统的（登录）；同一类旧的在前 */
const ORDER: Record<AttentionKind, number> = { question: 0, approval: 0, failed: 1, delivery: 2, login: 3 };

const NOTIFIED = "attention:notified";

export class Attention {
  private sources = new Set<AttentionSource>();
  private listeners = new Set<(items: AttentionItem[]) => void>();
  private sig = "";
  private scheduled: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private o: { store: Store; intervalMs?: number; debounceMs?: number }) {}

  /** 登记一个来源，返回注销函数 */
  addSource(fn: AttentionSource): () => void {
    this.sources.add(fn);
    this.kick();
    return () => {
      this.sources.delete(fn);
      this.kick();
    };
  }

  list(): AttentionItem[] {
    const out: AttentionItem[] = [];
    const seen = new Set<string>();
    for (const fn of this.sources) {
      let items: AttentionItem[] = [];
      try {
        items = fn();
      } catch (e) {
        log.warn("attention source failed", { message: (e as Error).message.slice(0, 200) });
      }
      for (const it of items) if (!seen.has(it.id)) (seen.add(it.id), out.push(it));
    }
    return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.since - b.since);
  }

  count(): number {
    return this.list().length;
  }

  /** 每个机器人几件、最早那件是什么（侧栏机器人行的"GPU 价格调研等你回答"） */
  byBot(items = this.list()): Record<string, { n: number; line: string }> {
    const out: Record<string, { n: number; line: string }> = {};
    for (const it of items) {
      const cur = out[it.botId];
      if (cur) cur.n++;
      else out[it.botId] = { n: 1, line: botLine(it) };
    }
    return out;
  }

  /** 订阅变化（立即收到当前的一份）；返回取消函数。有订阅者时每 intervalMs 看一眼（推出来的状态没有事件） */
  onChange(fn: (items: AttentionItem[]) => void): () => void {
    this.listeners.add(fn);
    const items = this.list();
    this.sig = signature(items);
    fn(items);
    if (!this.timer) {
      this.timer = setInterval(() => this.check(), this.o.intervalMs ?? 10_000);
      this.timer.unref?.();
    }
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  /** 有东西变了（审批、任务、渠道）：稍等一下再看（同一时刻的几次变化合成一次） */
  kick(): void {
    if (!this.listeners.size || this.scheduled) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      this.check();
    }, this.o.debounceMs ?? 200);
    this.scheduled.unref?.();
  }

  stop(): void {
    clearTimeout(this.scheduled);
    clearInterval(this.timer);
    this.scheduled = this.timer = undefined;
    this.listeners.clear();
  }

  private check(): void {
    const items = this.list();
    const sig = signature(items);
    if (sig === this.sig) return;
    this.sig = sig;
    for (const fn of this.listeners) {
      try {
        fn(items);
      } catch (e) {
        log.warn("attention listener failed", { message: (e as Error).message });
      }
    }
  }

  /** 还没发过系统通知的项（记下来，之后不再给；重启后也一样）。已经不在列表里的记录随之清掉 */
  takeNew(items = this.list()): AttentionItem[] {
    let done: string[] = [];
    try {
      done = JSON.parse(this.o.store.getKV(NOTIFIED) || "[]");
    } catch {
      done = [];
    }
    const had = new Set(done);
    const fresh = items.filter((it) => !had.has(it.id));
    const keep = items.map((it) => it.id);
    if (fresh.length || keep.length !== done.length) this.o.store.setKV(NOTIFIED, JSON.stringify(keep.slice(-500)));
    return fresh;
  }
}

const channelLabel = (c: string) => (c === "weixin" ? tr("tasks.chWeixin") : c === "feishu" ? tr("tasks.chFeishu") : c === "web" ? tr("tasks.chWeb") : undefined);

/**
 * 审批中心那一份：还在等的提问和审批（聊天回合里的、后台任务的）。任务的以任务名为题，聊天里的以渠道为题：
 * 「小蓝 · GPU 价格调研 · 等你回答」「小蓝 · 微信 · 等你批准」。
 */
export function approvalItems(store: Store, rows: ApprovalRow[]): AttentionItem[] {
  return rows.map((r) => {
    const task = r.taskId ? store.getTask(r.taskId) : undefined;
    const channel = store.getConversation(r.conversationId)?.channel ?? r.conversationId.split(":")[1] ?? "";
    const qs = questionsOf(r);
    const line = r.kind === "approval" ? r.detail || r.reason || r.tool : qs.map((q) => q.question).join(" / ") || r.detail;
    return {
      id: `approval:${r.id}`,
      kind: r.kind,
      botId: r.botId,
      botName: store.getBot(r.botId)?.name ?? r.botId,
      subject: task?.title ?? channelLabel(channel) ?? tr("tasks.chWeb"),
      status: r.kind === "approval" ? tr("tasks.stageApproval") : tr("tasks.stageAnswer"),
      line: line.length > 300 ? line.slice(0, 299) + "…" : line,
      since: r.createdAt,
      severity: "warn",
      actions: r.kind === "approval" ? ["approve", "deny"] : ["answer"],
      conversationId: r.conversationId,
      channel,
      ...(r.taskId ? { taskId: r.taskId } : {}),
      approvalId: r.id,
      code: r.code,
      ...(r.kind === "question" ? { questions: qs } : {}),
    };
  });
}

/**
 * 出站队列那一份（core/delivery.ts）：没送到的结果，一个会话一行。「1 条结果未送达微信 · 在微信里发条消息就能收到」，
 * 第二行是没送到的那几句（在这里就能看到）；一直失败的可以重试、放弃了的可以不再提示
 */
export function deliveryItem(d: DeliveryItem, botName: string): AttentionItem {
  const text = d.messages.map((m) => m.text.replace(/\s+/g, " ").trim()).filter(Boolean).join(" / ");
  return {
    id: d.id,
    kind: "delivery",
    botId: d.botId,
    botName,
    subject: d.title,
    status: d.line,
    line: text.length > 300 ? text.slice(0, 299) + "…" : text,
    since: d.since,
    severity: d.severity === "error" ? "err" : "warn",
    actions: d.actions,
    conversationId: d.conversationId,
    channel: d.channel,
  };
}

/** 列表变没变：id + 状态 + 第二行 */
function signature(items: AttentionItem[]): string {
  return items.map((it) => `${it.id}|${it.status}|${it.line}`).join("\n");
}

/** 侧栏机器人行的第二行："GPU 价格调研等你回答"、"微信登录已过期" */
export function botLine(it: AttentionItem): string {
  return it.status ? `${it.subject}${it.status}` : it.subject;
}

/** 系统通知：标题「小蓝 需要你」，正文「GPU 价格调研：报告用中文还是英文？」（设计第 6 节） */
export function notificationOf(it: AttentionItem): { title: string; body: string } {
  const body = it.line ? `${it.subject}：${it.line}` : botLine(it);
  return { title: tr("tasks.notifyTitle", { name: it.botName }), body: body.length > 120 ? body.slice(0, 119) + "…" : body };
}

/** 托盘：有事时提示文字带上件数，没事时只有应用名（健康时什么都不加） */
export function trayTitle(product: string, n: number): string {
  return n > 0 ? tr("tasks.trayTitle", { product, count: n }) : product;
}
