import crypto from "node:crypto";
import type { ApprovalRow, Store } from "../store/db.js";
import { logger } from "../log.js";
import { t } from "../i18n/index.js";

const log = logger("approvals");

export const APPROVAL_TTL_MS = 10 * 60_000;
/** 后台任务里的审批：任务会话的那次调用一直等着，12 小时没人批就拒绝（设计第 7 节） */
export const TASK_APPROVAL_TTL_MS = 12 * 3600_000;

export interface QuestionItem {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}
export interface QuestionAnswer {
  answers: Array<{ id: string; selected: string[]; custom?: string }>;
}

/** 当前回合的提示出口：审批/提问发生时，把提示送到正在进行的回复会话里（属于正常 bot 回复）。 */
export type PromptSink = (row: ApprovalRow) => Promise<void>;

export interface ReplyResult {
  handled: boolean;
  /** 给用户的确认文本（可选） */
  ack?: string;
}

/**
 * 渠道里的一条回复能不能算对后台任务的提问 / 审批的回答（设计第 6 节"回答任务的提问"）：
 * 引用了推给用户的那条提示、以 4 位编号开头，或者那条提示是机器人最后一条消息时只回了选项编号 / 选项原文 / y、n。
 * 其余都是普通聊天：任务的提问可以等几个小时，不能像聊天回合里的提问那样"随便回一句就算"。
 */
export interface ReplyContext {
  /** 用户引用的那条消息的文字（微信的引用） */
  quote?: string;
  /** 去掉引用之后用户自己写的 */
  plain?: string;
  /** 引用的是不是推给用户的这一条提示 */
  quotes?: (row: ApprovalRow, quote: string) => boolean;
  /** 这一条的提示是不是机器人在这个会话里最后发的一条消息 */
  latest?: (row: ApprovalRow) => boolean;
  /** 回答了任务的提问之后给用户的一句话 */
  answered?: (row: ApprovalRow) => string | undefined;
}

export type ApprovalEvent = { type: "created" | "decided"; row: ApprovalRow };

const YES = /^(y|yes|ok|是|同意|批准|允许)$/i;
const YES_NO = /^(y|yes|ok|是|同意|批准|允许|n|no|否|拒绝|不)\s*[#:：]?\s*(\d{4})?$/i;

/**
 * 审批中心：DSH 插件经 bridge 发来的审批/提问请求落入 sqlite（4 位码、10 分钟过期、重启后仍可查），
 * 由微信文本 “y 1234 / n 1234”、飞书卡片按钮或网页/API 决定。允许 = allow once；拒绝/超时/退出 = reject。
 * 后台任务的也在这里（taskId）：任务会话里的审批（阻塞，12 小时），任务报 needs_you 的提问（不阻塞、不过期，
 * 回答成为任务的新输入）。任务的提示不进聊天回合的出口，由任务服务推给用户（listen 的 created）。
 */
export class ApprovalCenter {
  private waiters = new Map<string, Set<() => void>>();
  private sinks = new Map<string, PromptSink>();
  private listeners = new Set<(e: ApprovalEvent) => void>();
  private timer: NodeJS.Timeout | undefined;
  /** 决定后的回调（例如通知 UI/日志） */
  onDecided: ((row: ApprovalRow) => void) | undefined;

  constructor(
    private store: Store,
    private opts: { ttlMs?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** 还在等：没过期（0 = 不过期） */
  private alive(r: ApprovalRow): boolean {
    return r.expiresAt === 0 || r.expiresAt > this.now();
  }

  /** 订阅新建与决定（任务服务推提示、更新阶段，"需要你"刷新）；返回取消函数 */
  listen(fn: (e: ApprovalEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ApprovalEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        log.warn("approval listener failed", { message: (err as Error).message });
      }
    }
  }

  /** 启动：上次运行遗留的阻塞请求（DSH 那次调用已经不在了）一律视为拒绝；任务的提问留着。之后定时清理过期。 */
  start(): void {
    for (const r of this.store.listApprovals({ status: "pending", limit: 500 })) {
      if (r.blocking) this.store.decideApproval(r.id, "expired", "restart");
    }
    this.timer ??= setInterval(() => this.sweep(), 5000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // 进程退出：阻塞着的按拒绝处理；任务的提问留到下次启动
    for (const r of this.store.listApprovals({ status: "pending", limit: 500 })) if (r.blocking) this.finish(r.id, "expired", "shutdown");
  }

  sweep(): void {
    const now = this.now();
    for (const r of this.store.listApprovals({ status: "pending", limit: 500 })) {
      if (r.expiresAt && r.expiresAt <= now) this.finish(r.id, "expired", "timeout");
    }
  }

  private newCode(): string {
    // 也避开待处理的使用请求的配对码（主人回复「同意 1234」时不会认错）
    const pending = new Set([...this.store.listApprovals({ status: "pending", limit: 500 }).map((r) => r.code), ...this.store.pendingAccessCodes()]);
    for (let i = 0; i < 50; i++) {
      const c = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      if (!pending.has(c)) return c;
    }
    return String(crypto.randomInt(1000, 10000));
  }

  /** ttlMs = 0：不过期（任务的提问） */
  create(input: {
    kind: ApprovalRow["kind"];
    botId: string;
    conversationId: string;
    sessionId: string;
    tool: string;
    detail: string;
    reason: string;
    payload?: string;
    taskId?: string;
    /** 规则（3d）执行时的审批：只在「需要你」里，不进聊天回合 */
    ruleId?: string;
    runId?: string;
    blocking?: boolean;
    ttlMs?: number;
  }): ApprovalRow {
    const now = this.now();
    const ttl = input.ttlMs ?? this.opts.ttlMs ?? APPROVAL_TTL_MS;
    const row = this.store.insertApproval({
      id: crypto.randomUUID(),
      code: this.newCode(),
      kind: input.kind,
      botId: input.botId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      tool: input.tool,
      detail: input.detail.slice(0, 2000),
      reason: input.reason.slice(0, 1000),
      payload: input.payload ?? "",
      createdAt: now,
      expiresAt: ttl === 0 ? 0 : now + ttl,
      taskId: input.taskId ?? "",
      ruleId: input.ruleId ?? "",
      runId: input.runId ?? "",
      blocking: input.blocking !== false,
    });
    log.info(`${row.kind} ${row.code} created`, { bot: row.botId, tool: row.tool, ...(row.taskId ? { task: row.taskId } : {}), ...(row.ruleId ? { rule: row.ruleId } : {}) });
    // 聊天回合的提示进这一轮的回复；任务的由任务服务推（不混进同一会话里正在进行的聊天回复）；规则的只在「需要你」里
    const sink = row.taskId || row.ruleId ? undefined : this.sinks.get(row.conversationId);
    if (sink) void sink(row).catch((e) => log.warn("prompt sink failed", { message: (e as Error).message }));
    this.emit({ type: "created", row });
    return row;
  }

  /** 注册某会话当前回合的提示出口，返回注销函数。 */
  bindSink(conversationId: string, sink: PromptSink): () => void {
    this.sinks.set(conversationId, sink);
    return () => {
      if (this.sinks.get(conversationId) === sink) this.sinks.delete(conversationId);
    };
  }

  private finish(id: string, status: Exclude<ApprovalRow["status"], "pending">, by: string, result = ""): boolean {
    const ok = this.store.decideApproval(id, status, by, result);
    if (ok) {
      const row = this.store.getApproval(id)!;
      log.info(`${row.kind} ${row.code} → ${status}`, { by });
      this.onDecided?.(row);
      for (const w of this.waiters.get(id) ?? []) w();
      this.waiters.delete(id);
      this.emit({ type: "decided", row });
    }
    return ok;
  }

  decide(id: string, allow: boolean, by: string): boolean {
    const r = this.store.getApproval(id);
    if (!r || r.kind !== "approval") return false;
    if (!this.alive(r)) {
      this.finish(id, "expired", "timeout");
      return false;
    }
    return this.finish(id, allow ? "allowed" : "rejected", by);
  }

  answer(id: string, answer: QuestionAnswer, by: string): boolean {
    const r = this.store.getApproval(id);
    if (!r || r.kind !== "question") return false;
    return this.finish(id, "answered", by, JSON.stringify(answer));
  }

  /** 用一段文字回答这一个提问：编号对应选项，其余算用户自己写的回答 */
  answerText(id: string, text: string, by: string): boolean {
    const r = this.store.getApproval(id);
    if (!r || r.kind !== "question" || r.status !== "pending") return false;
    return this.answer(id, parseAnswer(questionsOf(r), text), by);
  }

  cancel(id: string, by = "agent"): boolean {
    return this.finish(id, "cancelled", by);
  }

  /** 等到请求离开 pending 或超时；返回最新行。 */
  async wait(id: string, timeoutMs: number): Promise<ApprovalRow | undefined> {
    const cur = this.store.getApproval(id);
    if (!cur || cur.status !== "pending") return cur;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      const done = () => {
        clearTimeout(t);
        set.delete(done);
        resolve();
      };
      const t = setTimeout(done, Math.max(0, Math.min(timeoutMs, 60_000)));
      set.add(done);
    });
    return this.store.getApproval(id);
  }

  pending(conversationId: string, kind?: ApprovalRow["kind"]): ApprovalRow[] {
    return this.store.listApprovals({ status: "pending", conversationId }).filter((r) => (!kind || r.kind === kind) && this.alive(r));
  }

  /** 这个会话里聊天回合在等的（不含后台任务的）：中止、/reset 只作废这些 */
  pendingChat(conversationId: string): ApprovalRow[] {
    return this.pending(conversationId).filter((r) => !r.taskId && !r.ruleId);
  }

  /** 这个任务还在等的提问和审批 */
  pendingForTask(taskId: string): ApprovalRow[] {
    return this.store.listApprovals({ status: "pending", taskId, limit: 50 }).filter((r) => this.alive(r));
  }

  /** 所有还在等的（"需要你"） */
  pendingAll(): ApprovalRow[] {
    return this.store.listApprovals({ status: "pending", limit: 500 }).filter((r) => this.alive(r));
  }

  /**
   * 解析渠道里的用户回复（在每用户串行队列之前调用，避免与等待审批的回合互相阻塞）：
   * - 引用了任务推来的提示（ctx.quote）：这条就是对它的回答
   * - “y 1234” / “n 1234”（也接受 是/否/同意/拒绝/yes/no）；聊天里只有一个待批准、或任务的审批是机器人最后一条消息时可省略编号
   * - “1234 中文”：以任务提问的编号开头
   * - 聊天回合在等的提问：回复编号（多选用逗号/空格分隔）或直接回复文字
   * - 任务的提问是机器人最后一条消息：只认选项编号或选项原文
   */
  handleReply(conversationId: string, text: string, by: string, ctx: ReplyContext = {}): ReplyResult {
    const msg = text.trim();
    if (!msg || msg.startsWith("/")) return { handled: false };
    const all = this.pending(conversationId);
    const chat = all.filter((r) => !r.taskId && !r.ruleId);
    const task = all.filter((r) => r.taskId);
    // 引用了任务的提示
    const quote = ctx.quote;
    const quoted = quote ? task.find((r) => ctx.quotes?.(r, quote)) : undefined;
    if (quoted) return this.replyTo(quoted, (ctx.plain ?? msg).trim(), by, ctx);
    const m = YES_NO.exec(msg);
    if (m && m[2]) {
      const row = this.store.pendingApprovalByCode(m[2]);
      if (!row || row.conversationId !== conversationId || row.kind !== "approval") {
        return { handled: true, ack: t("approvals.noSuchCode", { code: m[2] }) };
      }
      return this.decideReply(row, YES.test(m[1]), by);
    }
    if (m) {
      const list = [...chat.filter((r) => r.kind === "approval"), ...task.filter((r) => r.kind === "approval" && ctx.latest?.(r))];
      if (list.length === 1) return this.decideReply(list[0], YES.test(m[1]), by);
      if (list.length > 1) return { handled: true, ack: t("approvals.needCode", { count: list.length, code: list[0].code }) };
    }
    // 「1234 中文」：以任务提问的编号开头
    const c = /^(\d{4})(?:\s*[:：,，.。、]\s*|\s+)(\S[\s\S]*)$/.exec(msg);
    const byCode = c ? task.find((r) => r.kind === "question" && r.code === c[1]) : undefined;
    if (c && byCode) return this.replyTo(byCode, c[2], by, ctx);
    // 聊天回合在等的提问：直接回复就是回答
    const q = chat.find((r) => r.kind === "question");
    if (q) {
      this.answer(q.id, parseAnswer(questionsOf(q), msg), by);
      return { handled: true };
    }
    // 任务的提问是机器人最后一条消息：只认选项编号或选项原文
    const last = task.find((r) => r.kind === "question" && ctx.latest?.(r));
    if (last && isOptionReply(questionsOf(last), msg)) return this.replyTo(last, msg, by, ctx);
    return { handled: false };
  }

  private decideReply(row: ApprovalRow, allow: boolean, by: string): ReplyResult {
    if (!this.decide(row.id, allow, by)) return { handled: true, ack: t("approvals.expiredOrDone", { code: row.code }) };
    return { handled: true, ack: t(allow ? "approvals.approved" : "approvals.rejected", { code: row.code }) };
  }

  /** 认定是对这一条的回答：提问记下回答；审批要 y / n */
  private replyTo(row: ApprovalRow, text: string, by: string, ctx: ReplyContext): ReplyResult {
    if (row.kind === "approval") {
      const m = YES_NO.exec(text);
      if (!m || (m[2] && m[2] !== row.code)) return { handled: true, ack: t("approvals.replyYesNo", { code: row.code }) };
      return this.decideReply(row, YES.test(m[1]), by);
    }
    if (!text) return { handled: true, ack: t("approvals.quoteNeedsAnswer") };
    if (!this.answerText(row.id, text, by)) return { handled: true, ack: t("approvals.alreadyAnswered") };
    return { handled: true, ack: ctx.answered?.(row) };
  }
}

function safeJson<T>(s: string, d: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
}

/** 提问行里的问题 */
export function questionsOf(row: ApprovalRow): QuestionItem[] {
  return row.kind === "question" ? safeJson<QuestionItem[]>(row.payload, []) : [];
}

/** 只是选项编号（多选可以几个）或某个选项的原文：光回这个才算回答"最后一条消息"的那个提问 */
export function isOptionReply(questions: QuestionItem[], text: string): boolean {
  const q = questions.length === 1 ? questions[0] : undefined;
  const opts = q?.options ?? [];
  if (!q || !opts.length) return false;
  const t = text.trim();
  if (opts.some((o) => o.label === t)) return true;
  const nums = t.split(/[\s,，、]+/).filter(Boolean);
  return nums.length > 0 && (!!q.multiSelect || nums.length === 1) && nums.every((n) => /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= opts.length);
}

/** 记下的回答 → 一句话（"中文"、"中文、英文"、用户自己写的） */
export function answerLine(row: ApprovalRow): string {
  const a = safeJson<QuestionAnswer>(row.result, { answers: [] }).answers ?? [];
  return a
    .map((x) => [...(x.selected ?? []), ...(x.custom ? [x.custom] : [])].join("、"))
    .filter(Boolean)
    .join("\n");
}

/** 把用户的文本回复映射成 ask_user_question 的答案：多个问题按行对应；编号选项；其余作为自定义回答。 */
export function parseAnswer(questions: QuestionItem[], text: string): QuestionAnswer {
  const lines = questions.length > 1 ? text.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [text.trim()];
  return {
    answers: questions.map((q, i) => {
      const raw = lines[i] ?? "";
      const line = questions.length > 1 ? raw.replace(/^\d+[.、:：)]\s+/, "") : raw;
      const opts = q.options ?? [];
      const nums = line.split(/[\s,，、]+/).filter(Boolean);
      if (opts.length && nums.length && nums.every((n) => /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= opts.length)) {
        const picked = (q.multiSelect ? nums : nums.slice(0, 1)).map((n) => opts[Number(n) - 1].label);
        return { id: q.id, selected: [...new Set(picked)] };
      }
      const byLabel = opts.find((o) => o.label === line);
      if (byLabel) return { id: q.id, selected: [byLabel.label] };
      return { id: q.id, selected: [], custom: line };
    }),
  };
}

/** 微信/纯文本渠道的提示文案。 */
export function promptText(row: ApprovalRow): string {
  if (row.kind === "approval") {
    const cmd = row.detail ? ` \`${row.detail.replace(/`/g, "'").slice(0, 300)}\`` : "";
    const why = row.reason && !row.detail ? t("approvals.promptWhy", { reason: row.reason.slice(0, 200) }) : "";
    return t("approvals.prompt", { tool: row.tool, cmd, why, code: row.code });
  }
  const qs = questionsOf(row);
  const blocks = qs.map((q, i) => {
    const head = `${qs.length > 1 ? `${i + 1}) ` : ""}${q.question}${q.detail ? `\n${q.detail}` : ""}`;
    const opts = (q.options ?? []).map((o, j) => `  ${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
    return [head, ...opts].join("\n");
  });
  const hint =
    qs.length > 1
      ? t("approvals.hintMulti")
      : qs[0]?.options?.length
        ? t("approvals.hintOptions", { multi: qs[0].multiSelect ? t("approvals.hintOptionsMulti") : "" })
        : t("approvals.hintFree");
  return `❓ ${blocks.join("\n\n")}\n${hint}`;
}

/**
 * 后台任务推给用户的提示（设计第 6 节的消息样式）：
 * 提问「❓「GPU 价格调研」想问你：报告用中文还是英文？\n1. 中文\n2. 英文\n（回复编号，或引用这条消息回答）」；
 * 审批「需批准（任务「清理旧构建」）：`rm -rf build/` — 回复 y 4821 / n 4821」。
 */
export function taskPromptText(row: ApprovalRow, title: string): string {
  if (row.kind === "approval") {
    const what = row.detail ? `\`${row.detail.replace(/`/g, "'").slice(0, 300)}\`` : `${row.tool}${row.reason ? `（${row.reason.slice(0, 200)}）` : ""}`;
    return t("approvals.taskApproval", { title, what, code: row.code });
  }
  const q = questionsOf(row)[0];
  const opts = (q?.options ?? []).map((o, i) => `${i + 1}. ${o.label}`);
  const hint = opts.length ? t("approvals.taskHintOptions", { multi: q?.multiSelect ? t("approvals.taskHintMulti") : "" }) : t("approvals.taskHintQuote");
  return [t("approvals.taskQuestion", { title, question: q?.question ?? row.detail }), ...opts, hint].join("\n");
}

/** 卡片渠道（飞书）的按钮：审批是允许 / 拒绝；单选的提问是每个选项一个按钮 */
export function promptButtons(row: ApprovalRow): Array<{ label: string; value: Record<string, string>; style: "primary" | "danger" | "default" }> | undefined {
  if (row.kind === "approval") {
    return [
      { label: t("approvals.allowOnce"), value: { amb: "approval", id: row.id, decision: "allow" }, style: "primary" },
      { label: t("approvals.deny"), value: { amb: "approval", id: row.id, decision: "deny" }, style: "danger" },
    ];
  }
  const qs = questionsOf(row);
  const single = qs.length === 1 ? qs[0] : undefined;
  return single?.options?.length && !single.multiSelect ? single.options.map((o, i) => ({ label: o.label, value: { amb: "question", id: row.id, option: String(i + 1) }, style: "default" as const })) : undefined;
}
