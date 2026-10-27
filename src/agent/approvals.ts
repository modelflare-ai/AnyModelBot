import crypto from "node:crypto";
import type { ApprovalRow, Store } from "../store/db.js";
import { logger } from "../log.js";

const log = logger("approvals");

export const APPROVAL_TTL_MS = 10 * 60_000;

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
 * 审批中心：DSH 插件经 bridge 发来的审批/提问请求落入 sqlite（4 位码、10 分钟过期、重启后仍可查），
 * 由微信文本 “y 1234 / n 1234”、飞书卡片按钮或网页/API 决定。允许 = allow once；拒绝/超时/退出 = reject。
 */
export class ApprovalCenter {
  private waiters = new Map<string, Set<() => void>>();
  private sinks = new Map<string, PromptSink>();
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

  /** 启动：上次运行遗留的 pending（DSH 子进程已不在）一律视为拒绝；之后定时清理过期。 */
  start(): void {
    for (const r of this.store.listApprovals({ status: "pending", limit: 500 })) {
      this.store.decideApproval(r.id, "expired", "restart");
    }
    this.timer ??= setInterval(() => this.sweep(), 5000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // 进程退出：未决请求按拒绝处理
    for (const r of this.store.listApprovals({ status: "pending", limit: 500 })) this.finish(r.id, "expired", "shutdown");
  }

  sweep(): void {
    const now = this.now();
    for (const r of this.store.listApprovals({ status: "pending", limit: 500 })) {
      if (r.expiresAt <= now) this.finish(r.id, "expired", "timeout");
    }
  }

  private newCode(): string {
    const pending = new Set(this.store.listApprovals({ status: "pending", limit: 500 }).map((r) => r.code));
    for (let i = 0; i < 50; i++) {
      const c = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      if (!pending.has(c)) return c;
    }
    return String(crypto.randomInt(1000, 10000));
  }

  create(input: { kind: ApprovalRow["kind"]; botId: string; conversationId: string; sessionId: string; tool: string; detail: string; reason: string; payload?: string }): ApprovalRow {
    const now = this.now();
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
      expiresAt: now + (this.opts.ttlMs ?? APPROVAL_TTL_MS),
    });
    log.info(`${row.kind} ${row.code} created`, { bot: row.botId, tool: row.tool });
    const sink = this.sinks.get(row.conversationId);
    if (sink) void sink(row).catch((e) => log.warn("prompt sink failed", { message: (e as Error).message }));
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
    }
    return ok;
  }

  decide(id: string, allow: boolean, by: string): boolean {
    const r = this.store.getApproval(id);
    if (!r || r.kind !== "approval") return false;
    if (r.expiresAt <= this.now()) {
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
    return this.store.listApprovals({ status: "pending", conversationId }).filter((r) => (!kind || r.kind === kind) && r.expiresAt > this.now());
  }

  /**
   * 解析渠道里的用户回复（在每用户串行队列之前调用，避免与等待审批的回合互相阻塞）：
   * - “y 1234” / “n 1234”（也接受 是/否/同意/拒绝/yes/no；会话中只有一个待批准时可省略编号）
   * - 有待回答的提问时，回复编号（多选用逗号/空格分隔）或直接回复文字
   */
  handleReply(conversationId: string, text: string, by: string): ReplyResult {
    const t = text.trim();
    if (!t || t.startsWith("/")) return { handled: false };
    const m = /^(y|yes|ok|是|同意|批准|允许|n|no|否|拒绝|不)\s*[#:：]?\s*(\d{4})?$/i.exec(t);
    if (m && (m[2] || this.pending(conversationId, "approval").length)) {
      const allow = /^(y|yes|ok|是|同意|批准|允许)$/i.test(m[1]);
      let row: ApprovalRow | undefined;
      if (m[2]) {
        row = this.store.pendingApprovalByCode(m[2]);
        if (!row || row.conversationId !== conversationId || row.kind !== "approval") {
          return { handled: true, ack: `⚠️ 没有编号为 ${m[2]} 的待批准请求（可能已过期或已处理）` };
        }
      } else {
        const list = this.pending(conversationId, "approval");
        if (list.length === 1) row = list[0];
        else return { handled: true, ack: `有 ${list.length} 个待批准请求，请带上编号回复，例如 y ${list[0].code}` };
      }
      const ok = this.decide(row.id, allow, by);
      if (!ok) return { handled: true, ack: `⚠️ 请求 ${row.code} 已过期或已处理` };
      return { handled: true, ack: allow ? `✅ 已批准 ${row.code}（仅本次）` : `❌ 已拒绝 ${row.code}` };
    }
    const q = this.pending(conversationId, "question")[0];
    if (q) {
      const questions = safeJson<QuestionItem[]>(q.payload, []);
      const answer = parseAnswer(questions, t);
      this.answer(q.id, answer, by);
      return { handled: true };
    }
    return { handled: false };
  }
}

function safeJson<T>(s: string, d: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
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
    const why = row.reason && !row.detail ? `（${row.reason.slice(0, 200)}）` : "";
    return `需批准: ${row.tool}${cmd}${why} — 回复 y ${row.code} / n ${row.code}`;
  }
  const qs = safeJson<QuestionItem[]>(row.payload, []);
  const blocks = qs.map((q, i) => {
    const head = `${qs.length > 1 ? `${i + 1}) ` : ""}${q.question}${q.detail ? `\n${q.detail}` : ""}`;
    const opts = (q.options ?? []).map((o, j) => `  ${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
    return [head, ...opts].join("\n");
  });
  const hint = qs.length > 1 ? "（每行回答一个问题：回复编号或直接写答案）" : qs[0]?.options?.length ? `（回复编号${qs[0].multiSelect ? "，可多选用逗号分隔" : ""}，或直接写答案）` : "（直接回复答案）";
  return `❓ ${blocks.join("\n\n")}\n${hint}`;
}
