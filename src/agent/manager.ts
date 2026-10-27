import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import { AgentBridge } from "./bridge.js";
import { AgentHost, callDetail, type TurnObserver } from "./host.js";
import { ApprovalCenter, type QuestionItem } from "./approvals.js";

const log = logger("agent");

export interface AgentManagerOptions {
  store: Store;
  dataDir: string;
  runtimeDir: string | undefined;
  upstream: () => { baseUrl: string; apiKey: string };
  enabled: boolean;
  turnTimeoutMs?: number;
  approvalTtlMs?: number;
}

/** 代理宿主总管：一个内部 bridge、一个审批中心、每个 bot 一个 DSH 子进程。 */
export class AgentManager {
  readonly approvals: ApprovalCenter;
  readonly bridge: AgentBridge;
  private hosts = new Map<string, AgentHost>();
  /** botId → 正在进行回合的会话（子代理 session 无映射时用来归属审批） */
  private activeConvs = new Map<string, Set<string>>();

  constructor(private o: AgentManagerOptions) {
    this.approvals = new ApprovalCenter(o.store, { ttlMs: o.approvalTtlMs });
    this.bridge = new AgentBridge({
      upstream: o.upstream,
      ask: (b) => this.ask(b),
      wait: (b) => this.wait(b),
      cancel: async (b) => void this.approvals.cancel(String(b?.id ?? ""), "agent"),
    });
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
      h = new AgentHost({ botId, dataDir: this.o.dataDir, runtimeDir: this.o.runtimeDir!, bridge: this.bridge, store: this.o.store, turnTimeoutMs: this.o.turnTimeoutMs });
      this.hosts.set(botId, h);
    }
    return h;
  }

  async runTurn(botId: string, input: { conversationId: string; text: string; model: string; observer?: TurnObserver }) {
    const set = this.activeConvs.get(botId) ?? new Set<string>();
    this.activeConvs.set(botId, set);
    set.add(input.conversationId);
    try {
      return await this.host(botId).runTurn(input);
    } finally {
      set.delete(input.conversationId);
    }
  }

  resetConversation(conversationId: string): void {
    this.o.store.clearAgentSession(conversationId);
    for (const r of this.approvals.pending(conversationId)) this.approvals.cancel(r.id, "reset");
  }

  async stopBot(botId: string): Promise<void> {
    const h = this.hosts.get(botId);
    this.hosts.delete(botId);
    await h?.stop();
  }

  async stop(): Promise<void> {
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
