import crypto from "node:crypto";
import { resolveComputerUse } from "./computer-use.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import { AgentBridge } from "./bridge.js";
import path from "node:path";
import { AgentHost, TurnStopped, callDetail, modelLimits, type ModelApiInfo, type TurnImage, type TurnInput, type TurnObserver, type TurnResult, type TurnUsage } from "./host.js";
import { ServerCompaction, type CompactEndpoint, type CompactionEvent } from "./server-compaction.js";
import { ActivityLog, promotedJob, type ActivityStep } from "./activity.js";
import { ApiFallbacks, type ApiFallback } from "./api-fallback.js";
import type { MediaModel, MediaPlan, MediaService } from "./media.js";
import { APPROVAL_TTL_MS, ApprovalCenter, TASK_APPROVAL_TTL_MS, type QuestionItem } from "./approvals.js";
import { MemoryError, MemoryStore, type Scope } from "./memory.js";
import type { TaskHost, TaskService } from "../tasks/service.js";
import { RULE_APPROVAL_TTL_MS } from "../tasks/rules.js";
import { DEFAULT_SETTINGS, type BotSettings, type MediaConfirm } from "./settings.js";
import { t, tl } from "../i18n/index.js";
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

/** 规则观察时的审批：不建审批行，直接按拒绝回给插件（id 以它开头） */
const AUTO_REJECT = "auto-reject:";

export interface AgentManagerOptions {
  store: Store;
  dataDir: string;
  runtimeDir: string | undefined;
  upstream: () => { baseUrl: string; apiKey: string };
  enabled: boolean;
  turnTimeoutMs?: number;
  /** 代理已经在处理、却这么久没有任何进展（模型不回、工具不动、只在重试）就中止；等用户批准/回答不算 */
  idleTimeoutMs?: number;
  approvalTtlMs?: number;
  /** 后台小模型调用（管家判定、交接便条、记忆整理）；缺省则这些功能静默跳过。botId 用来把请求记到该机器人的 Key 上 */
  complete?: (botId: string, model: string, system: string, user: string) => Promise<string>;
  /** 回合后记忆整理的防抖延迟 */
  reviewDelayMs?: number;
  /** 生图 / 生视频（amb-media 插件经 bridge 调用）；缺省时工具返回不可用 */
  media?: MediaService;
  /** 需要让用户看到的提示（代理进程起不来等） */
  onNotice?: (text: string) => void;
  /** 模型的上下文长度（Modelflare 模型资料），写进 DSH 补丁 */
  contextWindow?: (model: string) => Promise<number | undefined>;
  /** 模型支持的接口与是否推理（Modelflare 模型资料），DSH 按它选对话接口 */
  apiInfo?: (model: string) => Promise<ModelApiInfo | undefined>;
  /**
   * 服务端压缩（见 server-compaction.ts）：listed = 价格目录是否列出该模型的压缩端点（只是提示，用前还要探测）；
   * endpoint = 该模型（网关里的名字）直连的压缩端点。缺省则不做。
   */
  serverCompaction?: {
    listed(model: string): Promise<boolean | undefined>;
    endpoint(model: string): CompactEndpoint | undefined;
  };
}

/** 一个进行中的回合（/status、/stop、排队提示、信息面板和故障排查用） */
export interface TurnProgress {
  botId: string;
  since: number;
  /** 最近一次有进展的时间；0 = 消息还没交给代理（在等进程、等会话） */
  lastProgress: number;
  activity: ActivityLog;
  abort: AbortController;
  /** 已经提示过"后来的消息排在它后面" */
  queuedNotice?: boolean;
  /** 正在运行的工具调用（含子代理的）：工具运行期间 DSH 不发事件，看门狗不把它当成卡住 */
  tools: Set<string>;
  /** 转到后台、回合在等它结果的长命令：等的时候同样不算卡住 */
  jobs: Set<string>;
  /** 进行中的生图 / 生视频任务 */
  media: number;
}

/** 生成确认里"取消"那一项（问题建好后界面语言可能变了：两种语言的都认） */
const CANCELS = [tl("zh-CN", "media.cancel"), tl("en", "media.cancel")];

/** 预计花费超过它（美元）就先问用户 */
export const MEDIA_ASK_USD = 0.5;

/** 为什么要先问：机器人设成每次都问 / 代理说要问 / 花费 / 模型不是默认的 */
export type MediaAskReason = "always" | "agent" | "cost" | "model";

/**
 * 生成前要不要先问用户；不用问时为空。confirm 是代理传的：true = 要求不明确，要问；false = 用户点名了这个模型。
 * 花费超过上限（视频算不出花费也算）和"每次都问"不看 confirm。
 */
export function mediaAsk(plan: Pick<MediaPlan, "kind" | "model" | "default" | "estimate">, confirm: unknown, setting: MediaConfirm): MediaAskReason | undefined {
  if (setting === "always") return "always";
  if (confirm === true || confirm === "true") return "agent";
  if (plan.estimate !== undefined ? plan.estimate > MEDIA_ASK_USD : plan.kind === "video") return "cost";
  if (plan.model.id !== plan.default.id && confirm !== false && confirm !== "false") return "model";
  return undefined;
}

/**
 * 记下正在运行的工具调用（"session:callId"，本会话的 session 记为空）：tool/call 加入、tool/result 移除；
 * 同一会话开始下一步（下一次模型请求要等所有工具结果）或回合结束时，清掉它剩下的。
 */
function trackTools(tools: Set<string>, session: string, type: string, data: any): void {
  if (type === "tool/call") tools.add(`${session}:${data?.callId}`);
  else if (type === "tool/result") tools.delete(`${session}:${data?.message?.toolCallId}`);
  else if (type === "step/start" || type === "turn/end") for (const k of tools) if (k.startsWith(`${session}:`)) tools.delete(k);
}

/**
 * 记下转到后台、回合在等它结果的命令（工具结果里"moved to background job"），结束（job/settled）时移除。
 * 模型自己放到后台的（run_in_background，比如开着的服务）回合不等，不算。
 */
function trackJobs(jobs: Set<string>, type: string, data: any): void {
  const id = type === "tool/result" ? promotedJob(data) : undefined;
  if (id) jobs.add(id);
  else if (type === "job/settled") jobs.delete(String(data?.jobId));
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
  /** 在 Responses / Anthropic Messages 上被拒过、暂时改走 Chat Completions 的模型（所有机器人共用） */
  readonly apiFallbacks: ApiFallbacks;
  /** 会话 → 管家判定（是否原地压缩），插件在代理空闲时取 */
  private decisions = new Map<string, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();
  /** 会话 → 下一回合开始前要等的事（判定、压缩完成） */
  private gates = new Map<string, Promise<unknown>>();
  /** DSH session → 进行中的原地压缩；插件回报、超时、会话被重置或换段、代理进程退出时结束 */
  private compactDone = new Map<string, { botId: string; conv: string; resolve: (v: unknown) => void }>();
  private judgedAt = new Map<string, number>();
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  /** 会话 → 用户在生成确认里换了模型、代理要按新模型文档重写请求：重写后的那一次免确认 */
  private mediaGrants = new Map<string, { kind: string; model: string; at: number }>();
  /** 最近一次管家/整理结果（状态页展示） */
  readonly stewardLog: Array<{ at: number; conversationId: string; action: string; detail: string }> = [];

  /** 服务端压缩（经 bridge 改写长会话的 Responses 请求）；没有注入时为空 */
  readonly serverCompaction: ServerCompaction | undefined;
  /** 后台任务服务（App 建好后接上）：插件的 task_report / task-settled / 聊天工具经 bridge 交给它，任务会话的通知也给它 */
  tasks: TaskService | undefined;

  constructor(private o: AgentManagerOptions) {
    this.approvals = new ApprovalCenter(o.store, { ttlMs: o.approvalTtlMs });
    const sc = o.serverCompaction;
    this.serverCompaction = sc
      ? new ServerCompaction({
          dir: path.join(o.dataDir, "dsh", "server-compaction"),
          upstream: o.upstream,
          endpoint: (model) => sc.endpoint(model),
          listed: (model) => sc.listed(model),
          limits: async (model) => modelLimits(model, await o.contextWindow?.(model).catch(() => undefined)),
          onEvent: (e) => this.onServerCompaction(e),
        })
      : undefined;
    this.bridge = new AgentBridge({
      upstream: o.upstream,
      ask: (b) => this.ask(b),
      wait: (b) => this.wait(b),
      cancel: async (b) => void this.approvals.cancel(String(b?.id ?? ""), "agent"),
      memory: (b) => this.memoryOp(b),
      steward: (b) => this.stewardCall(b),
      media: (b) => this.mediaOp(b),
      // amb-control 插件按机器人取指令；不认识的机器人（已删除、已停止）让它别再来
      control: {
        poll: (b, signal) => this.hosts.get(String(b?.botId ?? ""))?.control.poll(b, signal) ?? Promise.resolve({ stop: true }),
        result: (b) => this.hosts.get(String(b?.botId ?? ""))?.control.result(b),
      },
      compaction: this.serverCompaction,
      tasks: async (route, b) => {
        const t = this.tasks;
        if (!t || !this.hosts.has(String(b?.botId ?? ""))) return { error: "background tasks are not available" };
        if (route === "report") return t.report(b);
        if (route === "settled") return t.settled(b);
        if (route === "tool") return t.chatTool(b);
        if (route === "config") return t.sessionConfig(b);
        return { error: "unknown route" };
      },
    });
    this.memory = new MemoryStore(path.join(o.dataDir, "memory"));
    this.apiFallbacks = new ApiFallbacks(path.join(o.dataDir, "dsh", "api-fallback.json"));
  }

  /** 生图 / 生视频服务；未接内置网关时没有 */
  get media(): MediaService | undefined {
    return this.o.media;
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
        onNotice: this.o.onNotice,
        media: !!this.o.media,
        contextWindow: this.o.contextWindow,
        apiInfo: this.o.apiInfo,
        apiFallbacks: this.apiFallbacks,
        onWake: (conv) => this.onWake?.(botId, conv),
        onTaskEvent: (root, n) => this.tasks?.onEvent(botId, root, n),
      });
      // 代理进程退出（中止宽限期内没停下、设置变化、崩溃、重启、停止）：进程里的压缩跟着没了，不再等它；跑着的后台任务记为中断、排恢复
      h.on((e) => {
        if (e.type !== "exit") return;
        this.endCompaction((c) => c.botId === botId);
        this.tasks?.onChildExit(botId);
      });
      this.hosts.set(botId, h);
    }
    return h;
  }

  /** PowerShell 等启动参数变了：空闲的代理进程在后台换用新的（正在跑回合的等下一条消息） */
  async refreshIdle(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((h) => h.restartIfStale().catch(() => undefined)));
  }

  /** Computer Use 的系统可用性 + 本机器人开关，供界面与 /status 显示 */
  computerUse(botId: string): ComputerUseInfo {
    const st = this.settings(botId).computerUse;
    if (!this.o.runtimeDir) {
      const reason = t("agent.cuNoRuntime");
      return { available: false, enabled: st.enabled, active: false, backend: st.backend, selectedBackend: st.backend, approval: st.approval, reason, backends: [] };
    }
    const sys = resolveComputerUse(st.backend, this.o.runtimeDir);
    const active = this.available && sys.available && st.enabled;
    const mode = t(st.approval === "ask-input" ? "agent.cuModeAsk" : "agent.cuModeAuto");
    const reason = !st.enabled ? t("agent.cuDisabled") : sys.available ? t("agent.cuReasonMode", { reason: sys.reason, mode }) : sys.reason;
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

  /**
   * 预热：应用启动后就在后台拉起代理进程，第一次启动（冷启动）可能要几分钟，不该等到用户发第一条消息。
   * 失败只记日志（ensure 自己会记录并退避），不抛错。
   */
  prewarm(botId: string, model: string): void {
    if (!this.available || !model) return;
    const h = this.host(botId);
    if (h.state === "running" || h.state === "starting") return;
    log.info("prewarming agent host", { bot: botId, model });
    void h.ensure(model).catch(() => undefined);
  }

  /** 会话 → 正在进行的回合（后来的消息排在它后面） */
  readonly turnsInProgress = new Map<string, TurnProgress>();

  /** onStep：活动记录里每新增或更新一步就回调一次（网页对话实时显示、回合结束后存进消息） */
  async runTurn(botId: string, input: TurnInput & { onStep?: (step: ActivityStep) => void }) {
    return this.track(botId, input, (i) => this.runTurnInner(botId, i));
  }

  /**
   * 代理自己醒来的一轮（后台命令结束，DSH 唤醒空闲的代理）：和普通回合一样登记（/status、中止、看门狗、插话），
   * 跟踪到结束，返回回复。onWake 由运行时设置，收到后调这个。
   */
  async followTurn(botId: string, input: { conversationId: string; model: string; observer?: TurnObserver; onStep?: (step: ActivityStep) => void }) {
    return this.track(botId, { ...input, text: "" }, (i) => this.followInner(botId, i));
  }

  /** 代理自己醒来开了一轮：(botId, conversationId) */
  onWake: ((botId: string, conversationId: string) => void) | undefined;

  private async track(botId: string, input: TurnInput & { onStep?: (step: ActivityStep) => void }, run: (input: TurnInput) => Promise<TurnResult>): Promise<TurnResult> {
    const conv = input.conversationId;
    const t: TurnProgress = { botId, since: Date.now(), lastProgress: 0, activity: new ActivityLog(input.onStep, input.model), abort: new AbortController(), tools: new Set(), jobs: new Set(), media: 0 };
    this.turnsInProgress.set(conv, t);
    // 看门狗：代理已经在处理，却长时间没有进展（模型不回、只在重试），又不是在等用户批准或回答、
    // 也没有工具、命令或生成任务在跑（生视频、转到后台的长命令、子代理里的工具）→ 中止
    const idleMs = this.o.idleTimeoutMs ?? 10 * 60_000;
    const watchdog = setInterval(() => {
      if (!t.lastProgress || t.abort.signal.aborted) return;
      if (this.approvals.pendingChat(conv).length || t.tools.size || t.jobs.size || t.media) t.lastProgress = Date.now();
      else if (Date.now() - t.lastProgress > idleMs) {
        log.warn("agent turn idle, stopping", { bot: botId, conversationId: conv, idleMs, lastStep: t.activity.last });
        this.halt(conv, t, new TurnStopped("idle", idleMs));
      }
    }, Math.max(250, Math.min(15_000, idleMs / 4)));
    const observer: TurnObserver = {
      ...input.observer,
      onStart: () => {
        t.lastProgress = Date.now();
        input.observer?.onStart?.();
      },
      onEvent: (type, data, time) => {
        if (type === "subagent/event") {
          // 子代理在干活：它的工具调用、命令同样记下；它在重试模型请求不算进展
          const ev = data?.event ?? {};
          trackTools(t.tools, String(data?.sessionId ?? ""), String(ev.type), ev.data);
          trackJobs(t.jobs, String(ev.type), ev.data);
          if (ev.type !== "llm/retry" && ev.type !== "llm/retry-started") t.lastProgress = Date.now();
        } else {
          trackTools(t.tools, "", type, data);
          trackJobs(t.jobs, type, data);
          if (t.activity.apply(type, data, time)) t.lastProgress = Date.now();
        }
        input.observer?.onEvent?.(type, data, time);
      },
    };
    try {
      const r = await run({ ...input, observer, signal: t.abort.signal });
      t.activity.finish();
      return r;
    } catch (e) {
      if (e instanceof TurnStopped && e.reason === "timeout") {
        t.activity.end("超过单回合上限");
        for (const r of this.approvals.pendingChat(conv)) this.approvals.cancel(r.id, "stopped");
      }
      throw e;
    } finally {
      clearInterval(watchdog);
      if (this.turnsInProgress.get(conv) === t) this.turnsInProgress.delete(conv);
    }
  }

  /**
   * 新消息能不能并入这个会话正在进行的回合：代理已经收下了上一条、回合没在中止或收尾、指令通道在线。
   * 不能的时候消息照常排队，等这一轮结束再处理。
   */
  canSteer(conversationId: string): boolean {
    const t = this.turnsInProgress.get(conversationId);
    return !!t && !!t.lastProgress && !t.abort.signal.aborted && !!this.hosts.get(t.botId)?.canSteer(conversationId);
  }

  /** 把新消息并入进行中的回合（模型在下一步看到它）；并不进去返回 false */
  async steer(botId: string, conversationId: string, msg: { text: string; images?: TurnImage[] }): Promise<boolean> {
    const t = this.turnsInProgress.get(conversationId);
    if (!t || t.botId !== botId || !this.canSteer(conversationId)) return false;
    const ok = await this.hosts.get(botId)!.steer(conversationId, { id: `amb-steer:${crypto.randomUUID()}`, ...msg });
    if (ok && this.turnsInProgress.get(conversationId) === t) {
      t.activity.apply("steer", { text: msg.text }, Date.now());
      t.lastProgress = Date.now();
    }
    return ok;
  }

  /** /stop、信息面板的"中止"：返回有没有正在处理的回合 */
  stopTurn(conversationId: string): boolean {
    const t = this.turnsInProgress.get(conversationId);
    if (!t) return false;
    if (!t.abort.signal.aborted) this.halt(conversationId, t, new TurnStopped("user", Date.now() - t.since));
    return true;
  }

  private halt(conv: string, t: TurnProgress, why: TurnStopped): void {
    t.activity.end(why.reason === "user" ? "用户中止" : why.reason === "idle" ? "长时间没有进展，自动中止" : "超过单回合上限");
    t.abort.abort(why);
    // 这一轮还在等的批准 / 回答随之作废（回合被中止，没人再等它们）
    for (const r of this.approvals.pendingChat(conv)) this.approvals.cancel(r.id, "stopped");
  }

  /** 跟踪代理自己醒来的一轮：不用等管家闸门（代理已经在跑），结束后同样交给管家判定 */
  private async followInner(botId: string, input: TurnInput): Promise<TurnResult> {
    const conv = input.conversationId;
    const set = this.activeConvs.get(botId) ?? new Set<string>();
    this.activeConvs.set(botId, set);
    set.add(conv);
    this.decisions.get(conv)?.resolve(false);
    const d = deferred<boolean>();
    this.decisions.set(conv, d);
    let r: TurnResult | undefined;
    try {
      r = await this.host(botId).followTurn(input);
      return r;
    } finally {
      set.delete(conv);
      if (r) this.afterTurn(botId, conv, r.sessionId, input.model, r.usage, d);
      else d.resolve(false);
    }
  }

  private async runTurnInner(botId: string, input: TurnInput) {
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
      if (r) this.afterTurn(botId, conv, r.sessionId, input.model, r.usage, d);
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

  /** 服务端压缩做完：记进管家日志；会话正在进行回合时在活动记录里加一步（失败只记日志，请求照常发） */
  private onServerCompaction(e: CompactionEvent): void {
    const conv = e.session ? this.o.store.conversationForSession(e.session) : undefined;
    if (!conv) return;
    this.note(conv, e.ok ? "server-compact" : "server-compact-failed", `${e.model} ≈${e.before}${e.after !== undefined ? `→${e.after}` : ""} tokens${e.error ? `: ${e.error}` : ""}`);
    if (e.ok) this.turnsInProgress.get(conv)?.activity.apply("server-compaction", e, e.at);
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
  private afterTurn(botId: string, conv: string, sessionId: string, model: string, usage: TurnUsage, d: { promise: Promise<boolean>; resolve: (v: boolean) => void }): void {
    const st = this.settings(botId);
    if (st.memory.enabled && st.memory.review && this.o.complete) this.scheduleReview(botId, conv, model);
    const lines = linesFor(usage.window, usage.maxTokens);
    if (!st.steward.enabled || !this.o.complete || !shouldJudge(usage.tokens, lines, this.judgedAt.get(sessionId))) {
      d.resolve(false);
      return;
    }
    this.judgedAt.set(sessionId, usage.tokens);
    const job = (async () => {
      const group = this.o.store.getConversation(conv)?.kind === "group";
      let action: "switch" | "compact" | undefined;
      try {
        const out = await this.o.complete!(botId, this.utilityModel(botId, model), STEWARD_SYSTEM, stewardRequest(this.transcript(conv), group));
        action = parseDecision(out);
      } catch (e) {
        log.warn("steward judge failed", { message: (e as Error).message.slice(0, 200) });
      }
      // 过了硬线还判不出来时换段（DS-Bot 的做法：判不出 = switch）
      if (action === "compact") {
        // 插件等判定已经超时（120 秒）走了：没人会去压缩，不设闸门，下一回合再判
        if (this.decisions.get(conv) !== d) {
          this.judgedAt.delete(sessionId);
          this.note(conv, "compact-skipped", "判定太慢，插件没等到");
          return;
        }
        const done = deferred<unknown>();
        this.compactDone.set(sessionId, { botId, conv, resolve: done.resolve });
        this.gates.set(conv, done.promise);
        this.note(conv, "compact", `tokens=${usage.tokens}/${lines.usable}`);
        d.resolve(true);
        // 插件迟迟不回报也只等 200 秒：闸门不能比这次压缩活得久
        await withTimeout(done.promise, 200_000, undefined);
        this.endCompaction((_, sid) => sid === sessionId);
        if (this.gates.get(conv) === done.promise) this.gates.delete(conv);
        return;
      }
      d.resolve(false);
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
        handoff = (await this.o.complete(botId, this.utilityModel(botId, model), HANDOFF_SYSTEM, recentTranscript(lines))).trim();
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
    // 旧段上还没回报的压缩（/new 不等闸门）不用再等
    this.endCompaction((c) => c.conv === conv);
  }

  /** 结束匹配的原地压缩：等着它的回合随即放行，闸门随之清掉 */
  private endCompaction(match: (c: { botId: string; conv: string }, sessionId: string) => boolean): void {
    for (const [sid, c] of this.compactDone) {
      if (!match(c, sid)) continue;
      this.compactDone.delete(sid);
      c.resolve(true);
    }
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
    const out = await this.o.complete(botId, this.utilityModel(botId, model), REVIEW_SYSTEM, `当前记忆：\n${current}\n\n最近对话（旧→新）：\n${recentTranscript(lines, 12_000)}`);
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

  /**
   * 生图 / 生视频：只在该机器人有回合进行中时受理（工具调用只会发生在回合里）。
   * models / docs 直接回答；image / video 用默认模型、花费不高时直接生成，需要时（mediaAsk）先问用户用哪个模型。
   */
  private async mediaOp(b: any): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    // 后台任务里还不能生成（确认要问用户，3b 才有任务的提问）
    if (/^(task|rule)-/.test(String(b?.sessionId ?? ""))) return { error: "生成图片和视频暂时只能在聊天里用，后台任务里不行；需要的话在结果里告诉用户。" };
    if (!this.hosts.has(botId) || !this.activeConvs.get(botId)?.size) return { error: "unknown bot" };
    const media = this.o.media;
    if (!media) return { error: "生成图片和视频需要连接 Modelflare" };
    const op = String(b?.op ?? "");
    const args = (b?.args ?? {}) as Record<string, unknown>;
    try {
      if (op === "models") return { text: await media.listText(botId, args.kind) };
      if (op === "docs") return { text: await media.docs(args.model) };
      const plan = await media.prepare(botId, op, args);
      const sessionId = String(b?.sessionId ?? "");
      const conv = this.resolveConversation(botId, sessionId);
      const tool = plan.kind === "image" ? "generate_image" : "generate_video";
      let model = plan.model;
      const grant = conv ? this.mediaGrants.get(conv) : undefined;
      const why = mediaAsk(plan, args.confirm, this.settings(botId).media.confirm);
      if (grant?.kind === plan.kind && grant.model === model.id && Date.now() - grant.at < (this.o.approvalTtlMs ?? APPROVAL_TTL_MS)) {
        this.mediaGrants.delete(conv);
      } else if (why) {
        if (!conv) return { error: "找不到这次对话，没法向用户确认，没有生成" };
        const r = await this.confirmMedia(botId, conv, sessionId, plan, tool, why);
        if (r.cancel) return { text: "用户取消了这次生成（或没有及时确认），没有生成文件，也没有扣费。不要自行重试；需要的话问用户想怎么改。" };
        if (r.reply !== undefined) return { text: `用户没有确认，而是回复：「${r.reply}」。按用户的意思调整后再调用 ${tool}。` };
        if (r.model && r.model.id !== model.id) {
          if (plan.custom) {
            // 请求体是按原模型的文档写的，换了模型就得按新模型的文档重写；重写后的那一次不再确认
            this.mediaGrants.set(conv, { kind: plan.kind, model: r.model.id, at: Date.now() });
            return { text: `用户选择改用 ${r.model.id}。各模型的请求格式不同：先用 media_docs 查 ${r.model.id} 的文档，按它重写 body，再调用 ${tool}（model 填 ${r.model.id}）。这一次不会再要求确认。` };
          }
          model = r.model;
        }
      }
      // 生成可能要十几分钟，期间没有会话事件：看门狗不把它当成卡住
      const turn = this.turnsInProgress.get(conv);
      if (turn) turn.media++;
      let text: string;
      try {
        text = await media.execute(botId, model, args);
      } finally {
        if (turn) turn.media--;
      }
      // 回合已经中止（/stop、超过上限、代理进程被关）：结果到不了代理，已扣费的文件留在工作区，告诉用户
      if (turn && (turn.abort.signal.aborted || this.turnsInProgress.get(conv) !== turn)) this.orphanedMedia(botId, plan.kind, text);
      return { text };
    } catch (e) {
      log.warn("media tool failed", { bot: botId, op, message: (e as Error).message.slice(0, 300) });
      return { error: (e as Error).message };
    }
  }

  /** 生成完了，请求它的回合却已经结束：文件在工作区 media/，用界面通知告诉用户 */
  private orphanedMedia(botId: string, kind: string, text: string): void {
    const files = text.match(/media\/[\w.-]+/g) ?? ["media/"];
    log.warn("media finished after its turn ended", { bot: botId, files });
    const name = this.o.store.getBot(botId)?.name ?? botId;
    this.o.onNotice?.(`机器人「${name}」生成的${kind === "image" ? "图片" : "视频"}已保存在它的工作区（${files.join("、")}），但请求它的那条消息已经中止，没有发到聊天里。需要的话在对话里让机器人把它发出来。`);
  }

  /** 生成前的确认：问用户这次用哪个模型（本次的、默认的和几个推荐的，或回复别的模型名），等到回答、取消或过期 */
  private async confirmMedia(botId: string, conv: string, sessionId: string, plan: MediaPlan, tool: string, why: MediaAskReason): Promise<{ model?: MediaModel; cancel?: boolean; reply?: string }> {
    const image = plan.kind === "image";
    const opt = (m: MediaModel, tag = "") => ({ label: m.id, description: [tag, m.price].filter(Boolean).join(" · ") || undefined });
    // 为什么问：花费高、不是默认模型时说一句（每次都问、代理要问的不用解释）
    const reason =
      why === "cost"
        ? plan.estimate !== undefined
          ? t("media.reasonCost", { amount: Math.round(plan.estimate * 100) / 100, limit: MEDIA_ASK_USD })
          : t("media.reasonCostUnknown")
        : why === "model"
          ? t("media.reasonModel", { model: plan.default.id })
          : "";
    const q: QuestionItem = {
      id: "model",
      header: t(image ? "media.confirmHeaderImage" : "media.confirmHeaderVideo"),
      question: t(image ? "media.confirmQuestionImage" : "media.confirmQuestionVideo", { model: plan.model.id }),
      detail: t("media.confirmDetail", { summary: plan.summary, reason: reason ? `\n${reason}` : "" }),
      options: [
        opt(plan.model, t(plan.model === plan.default ? "media.tagDefault" : "media.tagBotPick")),
        ...plan.candidates.map((m) => opt(m, m === plan.default ? t("media.tagDefault") : "")),
        { label: t("media.cancel"), description: t("media.cancelDesc") },
      ],
    };
    const row = this.approvals.create({ kind: "question", botId, conversationId: conv, sessionId, tool, detail: q.question, reason: "", payload: JSON.stringify([q]) });
    const deadline = Date.now() + (this.o.approvalTtlMs ?? APPROVAL_TTL_MS) + 10_000;
    let cur = row;
    while (cur.status === "pending") {
      if (Date.now() > deadline) {
        this.approvals.cancel(row.id, "timeout");
        return { cancel: true };
      }
      const next = await this.approvals.wait(row.id, 60_000);
      if (!next) return { cancel: true };
      cur = next;
    }
    if (cur.status !== "answered") return { cancel: true };
    let a: { selected?: string[]; custom?: string } | undefined;
    try {
      a = (JSON.parse(cur.result) as { answers?: Array<{ selected?: string[]; custom?: string }> }).answers?.[0];
    } catch {
      a = undefined;
    }
    const pick = (a?.selected?.[0] ?? "").trim();
    const text = (a?.custom ?? "").trim();
    if (CANCELS.includes(pick) || /^(取消|不要?|不用|算了|no?|cancel|don'?t|stop|skip)$/i.test(text)) return { cancel: true };
    if (!pick && /^(好的?|行|可以|确认|确定|是的?|对|嗯|ok(ay)?|y(es)?|sure|confirm|go( ahead)?|generate( it)?|生成吧?|就用它)$/i.test(text)) return { model: plan.model };
    const want = (pick || text).replace(/^(用|换成|改用)\s*/, "").replace(/^(use|switch to)\s+/i, "");
    const hit = plan.all.find((m) => m.id.toLowerCase() === want.toLowerCase());
    if (hit) return { model: hit };
    return text ? { reply: text } : { cancel: true };
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
    if (b?.phase === "done") {
      // 按 session 结束：会话可能已被 /reset、/new 换掉，闸门也得放开
      const c = this.compactDone.get(sessionId)?.conv ?? this.o.store.conversationForSession(sessionId);
      if (c) this.note(c, "compact-result", String(b?.result ?? ""));
      this.endCompaction((_, sid) => sid === sessionId);
      return { ok: true };
    }
    const conv = this.o.store.conversationForSession(sessionId);
    if (!conv || this.o.store.getAgentSession(conv) !== sessionId) return { compact: false };
    const d = this.decisions.get(conv);
    if (!d) return { compact: false };
    const compact = await withTimeout(d.promise, 120_000, false);
    if (this.decisions.get(conv) === d) this.decisions.delete(conv);
    return { compact };
  }

  resetConversation(conversationId: string): void {
    // 会话换掉了：它上面还没回报的压缩不用再等
    this.endCompaction((c) => c.conv === conversationId);
    this.o.store.clearAgentSession(conversationId);
    this.o.store.setKV(`seed:${conversationId}`, "");
    this.mediaGrants.delete(conversationId);
    for (const r of this.approvals.pendingChat(conversationId)) this.approvals.cancel(r.id, "reset");
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

  /** 故障排查：运行时位置 + 每个已创建的代理进程的详细状态（stderr 尾部、最近一次退出）+ 进行中的回合 */
  diagnostics(): {
    enabled: boolean;
    available: boolean;
    runtimeDir?: string;
    hosts: Record<string, Record<string, unknown>>;
    apiFallbacks: Array<ApiFallback & { model: string }>;
    turns: Array<{ conversationId: string; botId: string; forMs: number; idleMs?: number; lastStep?: ActivityStep }>;
    serverCompaction?: { enabled: boolean; models: Record<string, { ok: boolean; at: number; reason: string }> };
  } {
    return {
      enabled: this.o.enabled,
      available: this.available,
      runtimeDir: this.o.runtimeDir,
      // 服务端压缩：各模型的探测结论（支持 / 不支持及原因）
      ...(this.serverCompaction ? { serverCompaction: { enabled: this.serverCompaction.enabled, models: this.serverCompaction.status() } } : {}),
      hosts: Object.fromEntries([...this.hosts].map(([id, h]) => [id, h.diagnostics()])),
      apiFallbacks: this.apiFallbacks.list(),
      turns: [...this.turnsInProgress].map(([conversationId, t]) => ({
        conversationId,
        botId: t.botId,
        forMs: Date.now() - t.since,
        idleMs: t.lastProgress ? Date.now() - t.lastProgress : undefined,
        lastStep: t.activity.last,
      })),
    };
  }

  /** 一句话的代理状态（/status 用；不等待、不拉起进程） */
  hostSummary(botId: string): string {
    if (!this.available) return "";
    const h = this.hosts.get(botId);
    if (!h || h.state === "stopped") return t("agent.hostNotStarted");
    const d = h.diagnostics() as any;
    if (h.state === "running") return t("agent.hostRunning", { pid: h.pid ?? "?", init: d.lastInitMs ? t("agent.hostRunningInit", { s: Math.round(d.lastInitMs / 1000) }) : "" });
    if (h.state === "starting") {
      const s = Math.round((d.startingForMs ?? 0) / 1000);
      return t("agent.hostStarting", { s, first: d.firstStart ? t("agent.hostStartingFirst") : "" });
    }
    if (h.state === "backoff") return t("agent.hostBackoff", { error: h.lastError.slice(0, 120) });
    return t("agent.hostPaused", { error: h.lastError.slice(0, 120) });
  }

  /** 故障排查的"重启代理进程"：关掉（全部或指定机器人的）子进程并清掉退避；返回重启了哪些。 */
  async restartHosts(botId?: string): Promise<string[]> {
    const ids = [...this.hosts.keys()].filter((id) => !botId || id === botId);
    await Promise.all(ids.map((id) => this.hosts.get(id)!.restart()));
    return ids;
  }

  /** 任务服务用的宿主接口：每个机器人的代理进程 */
  taskHost(): TaskHost {
    const self = this;
    return {
      get available() {
        return self.available;
      },
      workspace: (botId) => this.host(botId).workspace,
      settings: (botId) => this.settings(botId),
      memoryPrefix: (botId, conv) => this.memoryPrefix(botId, conv),
      prompt: (botId, o) => {
        if (!this.available) return Promise.reject(new Error("代理模式不可用"));
        return this.host(botId).promptTask(o);
      },
      steer: (botId, sessionId, id, text) => this.hosts.get(botId)?.steerTask(sessionId, id, text) ?? Promise.resolve(false),
      stop: async (botId, sessionId) => void (await this.hosts.get(botId)?.stopTask(sessionId)),
      quiet: (botId, sessionId) => this.hosts.get(botId)?.taskQuiet(sessionId) ?? Promise.resolve({ quiet: true }),
    };
  }

  /** 任务会话或它的子代理属于哪个任务（审批落到请求这个任务的会话，"需要你"里也认得它） */
  private taskOf(botId: string, sessionId: string) {
    return this.tasks?.taskOfSession(sessionId, this.hosts.get(botId)?.taskRootOf(sessionId));
  }

  /** 规则会话或它的子代理属于哪条规则、哪次运行 */
  private ruleOf(botId: string, sessionId: string) {
    return this.tasks?.ruleOfSession(sessionId, this.hosts.get(botId)?.taskRootOf(sessionId));
  }

  private resolveConversation(botId: string, sessionId: string): string {
    const c = this.o.store.conversationForSession(sessionId);
    if (c) return c;
    // 后台任务会话（和它的子代理）：落到请求它的会话
    const task = this.taskOf(botId, sessionId);
    if (task) return task.conversationId;
    const rule = this.ruleOf(botId, sessionId);
    if (rule) return rule.conversationId;
    const active = [...(this.activeConvs.get(botId) ?? [])];
    return active.length === 1 ? active[0] : "";
  }

  private async ask(b: any): Promise<{ id: string }> {
    const botId = String(b?.botId ?? "");
    if (!this.hosts.has(botId)) throw new Error("unknown bot");
    const sessionId = String(b?.sessionId ?? "");
    const conversationId = this.resolveConversation(botId, sessionId);
    // 后台任务里来的：记下是哪个任务、哪个 run，由任务服务推给用户；没人在旁边看，等 12 小时
    const t = this.o.store.conversationForSession(sessionId) ? undefined : this.taskOf(botId, sessionId);
    // 规则（3d）：观察时一律自动拒绝，记成「需要批准：…」；执行时进「需要你」，等 1 小时
    const rule = t || this.o.store.conversationForSession(sessionId) ? undefined : this.ruleOf(botId, sessionId);
    const task = t ? { taskId: t.taskId, runId: t.runId, ttlMs: TASK_APPROVAL_TTL_MS } : rule ? { ruleId: rule.ruleId, runId: rule.runId, ttlMs: RULE_APPROVAL_TTL_MS } : {};
    if (b?.kind === "question" && !rule) {
      const qs = (Array.isArray(b.questions) ? b.questions : []) as QuestionItem[];
      const row = this.approvals.create({ kind: "question", botId, conversationId, sessionId, tool: "ask_user_question", detail: qs.map((q) => q.question).join(" / "), reason: "", payload: JSON.stringify(qs), ...task });
      return { id: row.id };
    }
    const host = this.hosts.get(botId)!;
    const callId = String(b?.callId ?? "");
    let call = callId ? host.calls.get(callId) : undefined;
    for (let i = 0; !call && callId && i < 10; i++) {
      await new Promise((r) => setTimeout(r, 50));
      call = host.calls.get(callId);
    }
    // 观察时（规则会话里也没人能回答提问）：不建审批，直接拒绝，记成「需要批准：…」
    if (rule && (rule.mode === "observe" || b?.kind === "question")) {
      this.tasks!.wouldNeedApproval(rule.runId, call ? callDetail(call.name, call.args) : String(b?.toolName ?? b?.reason ?? ""));
      return { id: `${AUTO_REJECT}${crypto.randomUUID()}` };
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
      ...task,
    });
    return { id: row.id };
  }

  private async wait(b: any): Promise<Record<string, unknown>> {
    const id = String(b?.id ?? "");
    if (id.startsWith(AUTO_REJECT)) return { done: true, outcome: "rejected", answer: null };
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
