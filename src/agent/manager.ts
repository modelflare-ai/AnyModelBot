import { resolveComputerUse } from "./computer-use.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import { AgentBridge } from "./bridge.js";
import path from "node:path";
import { AgentHost, callDetail, type TurnObserver, type TurnUsage } from "./host.js";
import { ApprovalCenter, type QuestionItem } from "./approvals.js";
import { MemoryError, MemoryStore, type Scope } from "./memory.js";
import { DEFAULT_SETTINGS, type BotSettings } from "./settings.js";
import {
  HANDOFF_SYSTEM,
  REVIEW_SYSTEM,
  STEWARD_SYSTEM,
  linesFor,
  parseDecision,
  parseReview,
  recentTranscript,
  shouldJudge,
  stewardRequest,
  type Line,
} from "./steward.js";

const log = logger("agent");

export interface AgentManagerOptions {
  store: Store;
  dataDir: string;
  runtimeDir: string | undefined;
  upstream: () => { baseUrl: string; apiKey: string };
  enabled: boolean;
  turnTimeoutMs?: number;
  approvalTtlMs?: number;
  /** 后台小模型调用（管家判定、交接便条、记忆整理）；缺省则这些功能静默跳过 */
  complete?: (model: string, system: string, user: string) => Promise<string>;
  /** 回合后记忆整理的防抖延迟 */
  reviewDelayMs?: number;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((r) => (t = setTimeout(() => r(fallback), ms)))]).finally(() => clearTimeout(t));
}

/** 代理宿主总管：一个内部 bridge、一个审批中心、每个 bot 一个 DSH 子进程。 */
export class AgentManager {
  readonly approvals: ApprovalCenter;
  readonly bridge: AgentBridge;
  private hosts = new Map<string, AgentHost>();
  /** botId → 正在进行回合的会话（子代理 session 无映射时用来归属审批） */
  private activeConvs = new Map<string, Set<string>>();
  readonly memory: MemoryStore;
  /** 会话 → 管家判定（是否原地压缩），插件在代理空闲时取 */
  private decisions = new Map<string, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();
  /** 会话 → 下一回合开始前要等的事（判定、压缩完成） */
  private gates = new Map<string, Promise<unknown>>();
  private compactDone = new Map<string, (v: unknown) => void>();
  private judgedAt = new Map<string, number>();
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  /** 最近一次管家/整理结果（状态页展示） */
  readonly stewardLog: Array<{ at: number; conversationId: string; action: string; detail: string }> = [];

  constructor(private o: AgentManagerOptions) {
    this.approvals = new ApprovalCenter(o.store, { ttlMs: o.approvalTtlMs });
    this.bridge = new AgentBridge({
      upstream: o.upstream,
      ask: (b) => this.ask(b),
      wait: (b) => this.wait(b),
      cancel: async (b) => void this.approvals.cancel(String(b?.id ?? ""), "agent"),
      memory: (b) => this.memoryOp(b),
      steward: (b) => this.stewardCall(b),
    });
    this.memory = new MemoryStore(path.join(o.dataDir, "memory"));
  }

  /** 是否可用（已启用且找到 DSH 运行时）。 */
  get available(): boolean {
    return this.o.enabled && !!this.o.runtimeDir;
  }

  start(): void {
    this.approvals.start();
    if (this.o.enabled && !this.o.runtimeDir) log.warn("DSH runtime not found; agent mode disabled (plain chat fallback)");
  }

  host(botId: string): AgentHost {
    let h = this.hosts.get(botId);
    if (!h) {
      h = new AgentHost({
        botId,
        dataDir: this.o.dataDir,
        runtimeDir: this.o.runtimeDir!,
        bridge: this.bridge,
        store: this.o.store,
        turnTimeoutMs: this.o.turnTimeoutMs,
        settings: () => this.settings(botId),
      });
      this.hosts.set(botId, h);
    }
    return h;
  }

  /** Computer Use 的系统可用性 + 本机器人开关，供界面与 /status 显示 */
  computerUse(botId: string): ComputerUseInfo {
    const st = this.settings(botId).computerUse;
    if (!this.o.runtimeDir) {
      const reason = "Computer Use: 不可用（代理运行时缺失）";
      return { available: false, enabled: st.enabled, active: false, backend: st.backend, selectedBackend: st.backend, approval: st.approval, reason, backends: [] };
    }
    const sys = resolveComputerUse(st.backend, this.o.runtimeDir);
    const active = this.available && sys.available && st.enabled;
    const mode = st.approval === "ask-input" ? "点击/输入前先问我" : "操作自动执行";
    const reason = !st.enabled ? "Computer Use: 已在本机器人设置中关闭" : sys.available ? `${sys.reason}；${mode}` : sys.reason;
    return {
      available: sys.available,
      enabled: st.enabled,
      active,
      backend: sys.backend,
      selectedBackend: st.backend,
      approval: st.approval,
      reason,
      notice: sys.notice,
      backends: sys.backends,
    };
  }

  settings(botId: string): BotSettings {
    return this.o.store.getBot(botId)?.settings ?? DEFAULT_SETTINGS;
  }

  async runTurn(botId: string, input: { conversationId: string; text: string; model: string; observer?: TurnObserver }) {
    const conv = input.conversationId;
    const gate = this.gates.get(conv);
    if (gate) await withTimeout(gate, 240_000, undefined);
    const set = this.activeConvs.get(botId) ?? new Set<string>();
    this.activeConvs.set(botId, set);
    set.add(conv);
    // 插件在代理空闲时来取判定；回合结束后由 afterTurn 给出
    this.decisions.get(conv)?.resolve(false);
    const d = deferred<boolean>();
    this.decisions.set(conv, d);
    let r: Awaited<ReturnType<AgentHost["runTurn"]>> | undefined;
    try {
      r = await this.host(botId).runTurn(input);
      return r;
    } finally {
      set.delete(conv);
      if (r) this.afterTurn(botId, conv, r.sessionId, input.model, r.usage, d.resolve);
      else d.resolve(false);
    }
  }

  /** 首条输入用的冻结记忆前缀（团队 → 本机器人 → 本群）；记忆关闭时为空。 */
  memoryPrefix(botId: string, conversationId: string): string {
    if (!this.settings(botId).memory.enabled) return "";
    const conv = this.o.store.getConversation(conversationId);
    const snap = this.memory.snapshot(this.readScopes(botId, conv?.kind === "group" ? conversationId : undefined));
    return snap.trim();
  }

  /** 取走一次性的交接便条（上下文管家换段后，新段首条输入使用）。 */
  takeSeed(conversationId: string): string {
    const v = this.o.store.getKV(`seed:${conversationId}`) ?? "";
    if (v) this.o.store.setKV(`seed:${conversationId}`, "");
    return v;
  }

  /** /new：主动开新段（保留记忆，生成交接便条）。 */
  async newSegment(botId: string, conversationId: string, model: string): Promise<void> {
    const sessionId = this.o.store.getAgentSession(conversationId);
    if (!sessionId) return;
    await this.switchSegment(botId, conversationId, sessionId, model, "manual");
  }

  private readScopes(botId: string, groupConv?: string): Scope[] {
    const out: Scope[] = [{ kind: "team", id: "" }, { kind: "bot", id: botId }];
    if (groupConv) out.push({ kind: "group", id: groupConv });
    return out;
  }

  private note(conversationId: string, action: string, detail: string): void {
    this.stewardLog.push({ at: Date.now(), conversationId, action, detail: detail.slice(0, 300) });
    if (this.stewardLog.length > 50) this.stewardLog.shift();
    log.info("steward", { conversationId, action, detail: detail.slice(0, 200) });
  }

  private utilityModel(botId: string, model: string): string {
    return this.settings(botId).utilityModel || model;
  }

  private transcript(conversationId: string, n = 40): Line[] {
    return this.o.store
      .messagesAfter(conversationId, 0, n)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.content }));
  }

  /** 回合结束：上下文管家判定 + 安排记忆整理。不抛错。 */
  private afterTurn(botId: string, conv: string, sessionId: string, model: string, usage: TurnUsage, decide: (compact: boolean) => void): void {
    const st = this.settings(botId);
    if (st.memory.enabled && st.memory.review && this.o.complete) this.scheduleReview(botId, conv, model);
    const lines = linesFor(usage.window, usage.maxTokens);
    if (!st.steward.enabled || !this.o.complete || !shouldJudge(usage.tokens, lines, this.judgedAt.get(sessionId))) {
      decide(false);
      return;
    }
    this.judgedAt.set(sessionId, usage.tokens);
    const job = (async () => {
      const group = this.o.store.getConversation(conv)?.kind === "group";
      let action: "switch" | "compact" | undefined;
      try {
        const out = await this.o.complete!(this.utilityModel(botId, model), STEWARD_SYSTEM, stewardRequest(this.transcript(conv), group));
        action = parseDecision(out);
      } catch (e) {
        log.warn("steward judge failed", { message: (e as Error).message.slice(0, 200) });
      }
      // 过了硬线还判不出来时换段（DS-Bot 的做法：判不出 = switch）
      if (action === "compact") {
        const done = deferred<unknown>();
        this.compactDone.set(sessionId, done.resolve);
        this.gates.set(conv, done.promise);
        this.note(conv, "compact", `tokens=${usage.tokens}/${lines.usable}`);
        decide(true);
        await withTimeout(done.promise, 200_000, undefined);
        this.compactDone.delete(sessionId);
        return;
      }
      decide(false);
      if (action === undefined && usage.tokens < lines.hard) return;
      await this.switchSegment(botId, conv, sessionId, model, action ?? "fallback");
    })();
    this.gates.set(conv, job);
    void job.catch((e) => log.warn("steward failed", { message: (e as Error).message })).finally(() => {
      if (this.gates.get(conv) === job) this.gates.delete(conv);
    });
  }

  private async switchSegment(botId: string, conv: string, sessionId: string, model: string, reason: string): Promise<void> {
    const lines = this.transcript(conv);
    let handoff = "";
    if (this.o.complete) {
      try {
        handoff = (await this.o.complete(this.utilityModel(botId, model), HANDOFF_SYSTEM, recentTranscript(lines))).trim();
      } catch (e) {
        log.warn("handoff failed, using raw tail", { message: (e as Error).message.slice(0, 200) });
      }
    }
    if (!handoff) handoff = recentTranscript(lines.slice(-6), 4000);
    handoff = handoff.slice(0, 4000);
    this.o.store.archiveSegment(conv, sessionId, reason, handoff);
    if (this.o.store.getAgentSession(conv) === sessionId) this.o.store.clearAgentSession(conv);
    this.o.store.setKV(`seed:${conv}`, handoff);
    this.judgedAt.delete(sessionId);
    this.note(conv, "switch", reason);
  }

  private scheduleReview(botId: string, conv: string, model: string): void {
    clearTimeout(this.reviewTimers.get(conv));
    const delay = this.o.reviewDelayMs ?? (Number(process.env.AMB_MEMORY_REVIEW_DELAY_MS) || 90_000);
    const t = setTimeout(() => {
      this.reviewTimers.delete(conv);
      void this.review(botId, conv, model).catch((e) => log.warn("memory review failed", { message: (e as Error).message.slice(0, 200) }));
    }, delay);
    t.unref?.();
    this.reviewTimers.set(conv, t);
  }

  /** 回合后记忆整理：读上次整理之后的新消息，让小模型给出增删，写入（来源 review）。 */
  async review(botId: string, conv: string, model: string): Promise<{ added: number; removed: number }> {
    const res = { added: 0, removed: 0 };
    if (!this.o.complete) return res;
    const { store } = this.o;
    const last = Number(store.getKV(`review:${conv}`) || 0);
    const msgs = store.messagesAfter(conv, last, 40).filter((m) => m.role === "user" || m.role === "assistant");
    if (msgs.length < 2) return res;
    const c = store.getConversation(conv);
    const scope: Scope = c?.kind === "group" ? { kind: "group", id: conv } : { kind: "bot", id: botId };
    const current = this.memory.snapshot([scope]) || "（空）";
    const lines: Line[] = msgs.map((m) => ({ role: m.role as "user" | "assistant", text: m.content }));
    const out = await this.o.complete(this.utilityModel(botId, model), REVIEW_SYSTEM, `当前记忆：\n${current}\n\n最近对话（旧→新）：\n${recentTranscript(lines, 12_000)}`);
    const ops = parseReview(out);
    for (const r of ops.remove) {
      try {
        this.memory.forget(scope, r, { by: "review" });
        res.removed++;
      } catch {
        /* 模糊或不存在：跳过 */
      }
    }
    for (const a of ops.add) {
      try {
        this.memory.remember(scope, a.text, { topic: a.topic, source: "review", by: "review" });
        res.added++;
      } catch {
        /* 重复、超限或像密钥：跳过 */
      }
    }
    store.setKV(`review:${conv}`, String(msgs[msgs.length - 1].id));
    log.info("memory review", { conversationId: conv, added: res.added, removed: res.removed });
    if (res.added || res.removed) this.note(conv, "review", `+${res.added} -${res.removed}`);
    return res;
  }

  /** 插件 → 宿主：remember / forget / recall。 */
  private async memoryOp(b: any): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    if (!this.hosts.has(botId)) return { error: "unknown bot" };
    const st = this.settings(botId);
    if (!st.memory.enabled) return { error: "本机器人的长期记忆已关闭" };
    const convId = this.resolveConversation(botId, String(b?.sessionId ?? ""));
    const conv = convId ? this.o.store.getConversation(convId) : undefined;
    const group = conv?.kind === "group" ? conv.id : undefined;
    const a = (b?.args ?? {}) as Record<string, unknown>;
    const want = typeof a.scope === "string" ? a.scope : "";
    const pick = (): Scope => {
      if (want === "team") return { kind: "team", id: "" };
      if (want === "group") {
        if (!group) throw new MemoryError("当前不在群聊中，没有群记忆");
        return { kind: "group", id: group };
      }
      if (want === "own") return { kind: "bot", id: botId };
      return group ? { kind: "group", id: group } : { kind: "bot", id: botId };
    };
    const topic = typeof a.topic === "string" && a.topic.trim() ? a.topic.trim() : undefined;
    try {
      switch (String(b?.op)) {
        case "remember": {
          const s = pick();
          if (s.kind === "team" && !st.memory.teamWrite) return { error: "本机器人没有写团队记忆的权限（可在机器人设置中开启）" };
          return { text: this.memory.remember(s, String(a.text ?? ""), { topic, source: conv?.channel ?? "agent", by: "agent" }) };
        }
        case "forget": {
          const s = pick();
          if (s.kind === "team" && !st.memory.teamWrite) return { error: "本机器人没有写团队记忆的权限" };
          return { text: this.memory.forget(s, String(a.match ?? ""), { topic, all: a.all === true, by: "agent" }) };
        }
        case "recall": {
          const scopes = want ? [pick()] : this.readScopes(botId, group);
          if (topic) return { text: this.memory.topicText(pick(), topic) || `主题「${topic}」不存在或为空` };
          const q = typeof a.query === "string" ? a.query.trim() : "";
          if (q) {
            const hits = this.memory.search(scopes, q);
            return { text: hits.length ? hits.join("\n") : `没有找到包含「${q}」的记忆` };
          }
          return { text: this.memory.snapshot(scopes) || "长期记忆为空" };
        }
        default:
          return { error: "unknown memory op" };
      }
    } catch (e) {
      if (e instanceof MemoryError) return { error: e.message };
      throw e;
    }
  }

  /** 插件 → 宿主：代理空闲时取管家判定（phase=idle），压缩完成后回报（phase=done）。 */
  private async stewardCall(b: any): Promise<Record<string, unknown>> {
    const sessionId = String(b?.sessionId ?? "");
    const conv = this.o.store.conversationForSession(sessionId);
    if (!conv || this.o.store.getAgentSession(conv) !== sessionId) return { compact: false };
    if (b?.phase === "done") {
      this.note(conv, "compact-result", String(b?.result ?? ""));
      this.compactDone.get(sessionId)?.(true);
      return { ok: true };
    }
    const d = this.decisions.get(conv);
    if (!d) return { compact: false };
    const compact = await withTimeout(d.promise, 120_000, false);
    if (this.decisions.get(conv) === d) this.decisions.delete(conv);
    return { compact };
  }

  resetConversation(conversationId: string): void {
    this.o.store.clearAgentSession(conversationId);
    this.o.store.setKV(`seed:${conversationId}`, "");
    for (const r of this.approvals.pending(conversationId)) this.approvals.cancel(r.id, "reset");
  }

  async stopBot(botId: string): Promise<void> {
    const h = this.hosts.get(botId);
    this.hosts.delete(botId);
    await h?.stop();
  }

  async stop(): Promise<void> {
    for (const t of this.reviewTimers.values()) clearTimeout(t);
    this.reviewTimers.clear();
    await Promise.all([...this.hosts.values()].map((h) => h.stop()));
    this.hosts.clear();
    this.approvals.stop();
    await this.bridge.stop();
  }

  /** 正在运行的 DSH 子进程 pid（用于识别来自代理沙箱的回环连接） */
  childPids(): number[] {
    return [...this.hosts.values()].map((h) => h.pid).filter((p): p is number => !!p);
  }

  status(): Record<string, unknown> {
    return {
      enabled: this.o.enabled,
      runtime: this.o.runtimeDir ? "found" : "missing",
      hosts: Object.fromEntries([...this.hosts].map(([id, h]) => [id, h.status()])),
    };
  }

  private resolveConversation(botId: string, sessionId: string): string {
    const c = this.o.store.conversationForSession(sessionId);
    if (c) return c;
    const active = [...(this.activeConvs.get(botId) ?? [])];
    return active.length === 1 ? active[0] : "";
  }

  private async ask(b: any): Promise<{ id: string }> {
    const botId = String(b?.botId ?? "");
    if (!this.hosts.has(botId)) throw new Error("unknown bot");
    const sessionId = String(b?.sessionId ?? "");
    const conversationId = this.resolveConversation(botId, sessionId);
    if (b?.kind === "question") {
      const qs = (Array.isArray(b.questions) ? b.questions : []) as QuestionItem[];
      const row = this.approvals.create({ kind: "question", botId, conversationId, sessionId, tool: "ask_user_question", detail: qs.map((q) => q.question).join(" / "), reason: "", payload: JSON.stringify(qs) });
      return { id: row.id };
    }
    const host = this.hosts.get(botId)!;
    const callId = String(b?.callId ?? "");
    let call = callId ? host.calls.get(callId) : undefined;
    for (let i = 0; !call && callId && i < 10; i++) {
      await new Promise((r) => setTimeout(r, 50));
      call = host.calls.get(callId);
    }
    const tool = String(b?.toolName ?? call?.name ?? "tool");
    const row = this.approvals.create({
      kind: "approval",
      botId,
      conversationId,
      sessionId,
      tool,
      detail: call ? callDetail(call.name, call.args) : "",
      reason: String(b?.reason ?? ""),
    });
    return { id: row.id };
  }

  private async wait(b: any): Promise<Record<string, unknown>> {
    const id = String(b?.id ?? "");
    const row = await this.approvals.wait(id, Math.min(Number(b?.timeoutMs) || 20_000, 25_000));
    if (!row) return { done: true, outcome: "rejected", answer: null };
    if (row.status === "pending") return { done: false };
    if (row.kind === "question") {
      let answer: unknown = null;
      if (row.status === "answered") {
        try {
          answer = JSON.parse(row.result);
        } catch {
          answer = null;
        }
      }
      return { done: true, answer };
    }
    return { done: true, outcome: row.status === "allowed" ? "allowed-once" : row.status === "cancelled" ? "cancelled" : "rejected" };
  }
}

export interface ComputerUseInfo {
  available: boolean;
  enabled: boolean;
  active: boolean;
  /** 实际使用的后端 */
  backend: string;
  /** 设置里选的后端 */
  selectedBackend: string;
  approval: string;
  reason: string;
  notice?: string;
  backends: Array<{ id: string; available: boolean; reason: string }>;
}
