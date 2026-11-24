import type { ReasoningEffort } from "../config.js";
import crypto from "node:crypto";
import { resolveComputerUse } from "../tools/computer-use/index.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import type { CuPermissions } from "../tools/computer-use/permissions.js";
import { AgentBridge } from "./bridge.js";
import path from "node:path";
import { AgentHost, TurnStopped, callDetail, modelLimits, type ModelApiInfo, type TurnImage, type TurnInput, type TurnObserver, type TurnResult, type TurnUsage } from "./host.js";
import { ServerCompaction, type CompactEndpoint, type CompactionEvent } from "./server-compaction.js";
import type { SkillRuntime } from "../skills/display.js";
import { ActivityLog, promotedJob, type ActivityStep } from "./activity.js";
import { ApiFallbacks, type ApiFallback } from "./api-fallback.js";
import type { MediaModel, MediaPlan, MediaService } from "../tools/media/index.js";
import { MAX_CARDS_PER_MESSAGE, type SkillInstalls } from "../skills/installs.js";
import type { SkillDrafts, SkillRecords } from "../skills/drafts.js";
import type { UserSkills } from "../skills/service.js";
import { skillRecordsOf } from "../skills/records.js";
import { skillDisplay } from "../skills/display.js";
import { groupPeer } from "../store/db.js";
import { SearchAborted, type SearchService, type WebSource } from "../tools/search.js";
import { ConnectionError } from "../tools/accounts/index.js";
import type { AppService, GateInput } from "../tools/apps/service.js";
import { AppError } from "../tools/apps/types.js";
import { CUSTOM_APP, appName, builtinApp, customKey } from "../tools/apps/catalog.js";
import type { ToolInfo } from "../tools/apps/types.js";
import { ALWAYS_RESULT, APPROVAL_TTL_MS, APPS_BY, ApprovalCenter, RULE_APPROVAL_TTL_MS, TASK_APPROVAL_TTL_MS, appConnectOf, type AppConnectPayload, type AppToolPayload, type QuestionItem } from "./approvals.js";
import { MemoryError, MemoryStore, type Scope } from "./memory.js";
import { AboutMe, type BotAddResult, type BotForgetResult } from "./about-me.js";
import type { TaskHost, TaskService } from "../tasks/service.js";
import type { CollabService } from "../collab/service.js";
import { DEFAULT_SETTINGS, type BotSettings, type MediaConfirm } from "./settings.js";
import { t, tl, t as tr, TARGET_LANGS, lang as currentLang } from "../i18n/index.js";
import type { Attachments } from "../attachments/service.js";
import { zipTool } from "../attachments/zip-tools.js";
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
  /** Linux 上 bubblewrap 用不了时允许命令改用 Landlock 沙箱（config.agent.allowLandlock）；缺省不允许，命令被拒绝 */
  allowLandlock?: boolean;
  /** 机器人和会话都没选模型时用的全局默认模型（关于我「不再记回」的判断用小模型） */
  defaultModel?: () => string;
  /** 后台小模型调用（管家判定、交接便条、记忆整理）；缺省则这些功能静默跳过。botId 用来把请求记到该机器人的 Key 上 */
  complete?: (botId: string, model: string, system: string, user: string) => Promise<string>;
  /** 回合后记忆整理的防抖延迟 */
  reviewDelayMs?: number;
  /** 用户随消息发的附件（ZIP 的 zip_list / zip_extract 要核对归属、读原文件）；缺省时 zip 工具不可用 */
  attachments?: Attachments;
  /** 生图 / 生视频（amb-media 插件经 bridge 调用）；缺省时工具返回不可用 */
  media?: MediaService;
  /** 生图 / 生视频现在能不能用（要连着 Modelflare：只填了官方 Key 时不能）。缺省 = 有 media 就能用 */
  mediaReady?: () => boolean;
  /**
   * 生图（generate_image）用哪个型号的门槛：账号登录时只能用这条会话当前选的精确型号（返回 { model }），
   * 它不能生图、能力不明或代理要换型号时返回 { error }（不生成、不扣费）；undefined = 不管（自定义 Key 照旧）。
   */
  imageGate?: (botId: string, conversationId: string, requested: string) => Promise<{ model: string } | { error: string } | undefined>;
  /** 技能安装卡片（amb-skills 插件的 install_skill 经 bridge 调用）；缺省时工具返回不可用 */
  skillInstalls?: SkillInstalls;
  /** 这个会话是不是主人的（渠道里只有主人能装技能）；缺省都算 */
  ownsConversation?: (conversationId: string) => boolean;
  /** 「存成技能」的草稿卡（amb-my-skills 插件的 save_skill 经 bridge 调用）；缺省时工具返回不可用 */
  skillDrafts?: SkillDrafts;
  /** 导入的技能和「我的技能」：草稿里写用到的技能的来源；用到「我的技能」的回合正常结束后去掉「未验证」 */
  userSkills?: UserSkills;
  /** 联网搜索（amb-web-search 插件经 bridge 调用，DSH 的 web_search 用它）；缺省时搜索返回不可用 */
  search?: SearchService;
  /** 连接应用（全局，amb-connections 插件经 bridge 调用，见 tools/apps/service.ts）；缺省时机器人没有这些工具 */
  apps?: AppService;
  /** 需要让用户看到的提示（代理进程起不来等） */
  onNotice?: (text: string) => void;
  /** 模型的上下文长度（Modelflare 模型资料），写进 DSH 补丁 */
  contextWindow?: (model: string) => Promise<number | undefined>;
  /** 模型支持的接口与是否推理（Modelflare 模型资料），DSH 按它选对话接口 */
  apiInfo?: (model: string) => Promise<ModelApiInfo | undefined>;
  /** 用户选的推理强度（全局） */
  effort?: () => ReasoningEffort;
  /** 桌面版：系统给这个地址用的代理（PAC 写法）；代理进程的环境里没设代理时用它 */
  systemProxy?: (url: string) => Promise<string | undefined>;
  /** macOS 桌面版：电脑操作的系统权限（缺项时拦下工具调用并结束这一轮），见 tools/computer-use/permissions.ts */
  cuPermissions?: CuPermissions;
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
  senderId?: string;
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
  /** 模型在这一轮中间说过的话（信息面板里和步骤一起显示；步骤里不再重复这些文字） */
  interim: string[];
  /** 这一轮绑定的工作文件夹（PRD R2）：id 用来判断后来的消息能不能并进来；root 是核对过的真实路径（不可用时没有） */
  folderId?: string;
  folderRoot?: string;
}

/** 生成确认里"取消"那一项（问题建好后界面语言可能变了：两种语言的都认） */
const CANCELS = TARGET_LANGS.map((l) => tl(l, "media.cancel"));

/** 每个会话读到的关于我是哪一版（aboutMe.seq）：之后变了，下一条消息带上新内容 */
const ABOUT_SEEN = "aboutme-seen:";

/** 用户明确要求记住（各界面语言的说法）：这一轮的记忆整理提前做 */
const EXPLICIT_REMEMBER = /^(请|請)?(记住|記住|帮我记住|幫我記住|remember|please remember|覚えて|覚えておいて|기억해|запомни|recuerda|lembre|lembra)/i;
const EXPLICIT_REVIEW_DELAY_MS = 1500;

/** 预计花费超过它（美元）就先问用户 */
export const MEDIA_ASK_USD = 0.5;

/** 为什么要先问：机器人设成每次都问 / 花费超过上限 */
export type MediaAskReason = "always" | "cost";

/**
 * 生成前要不要先问用户；不用问时为空。默认（需要时再问）只在预计花费超过上限时问，视频算不出花费也算（可能很贵）。
 * 代理或用户选了不是默认的模型、要求不够明确，都不问：代理按最合理的理解直接生成（产品负责人 2026-11-01）。
 * "每次都问"是用户自己打开的。
 */
export function mediaAsk(plan: Pick<MediaPlan, "kind" | "estimate">, setting: MediaConfirm): MediaAskReason | undefined {
  if (setting === "always") return "always";
  if (plan.estimate !== undefined ? plan.estimate > MEDIA_ASK_USD : plan.kind === "video") return "cost";
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
  /** 关于我：所有机器人共用的、关于用户本人的事（about-me.ts） */
  readonly aboutMe: AboutMe;
  /** 在 Responses / Anthropic Messages 上被拒过、暂时改走 Chat Completions 的模型（所有机器人共用） */
  readonly apiFallbacks: ApiFallbacks;
  /** 会话 → 管家判定（是否原地压缩），插件在代理空闲时取 */
  private decisions = new Map<string, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();
  /** 会话 → 下一回合开始前要等的事（判定、压缩完成） */
  private gates = new Map<string, Promise<unknown>>();
  /** DSH session → 进行中的原地压缩；插件回报、超时、会话被重置或换段、代理进程退出时结束 */
  private compactDone = new Map<string, { botId: string; conv: string; resolve: (v: unknown) => void }>();
  private judgedAt = new Map<string, number>();
  /**
   * 用户开新对话后在后台写的交接便条：会话 → 这次的进度。写好时还没被新对话的第一句取走就换掉兜底原文；
   * dropped：第一句等了 8 秒没等到（或这段对话又被清空），之后写好的不再补进
   */
  private seedJobs = new Map<string, { done: Promise<void>; settled: boolean; dropped: boolean }>();
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  /** 会话 → 用户在生成确认里换了模型、代理要按新模型文档重写请求：重写后的那一次免确认 */
  private mediaGrants = new Map<string, { kind: string; model: string; at: number }>();
  /** 最近一次管家/整理结果（状态页展示） */
  readonly stewardLog: Array<{ at: number; conversationId: string; action: string; detail: string }> = [];

  /** 服务端压缩（经 bridge 改写长会话的 Responses 请求）；没有注入时为空 */
  readonly serverCompaction: ServerCompaction | undefined;
  /** 后台任务服务（App 建好后接上）：插件的 task_report / task-settled / 聊天工具经 bridge 交给它，任务会话的通知也给它 */
  tasks: TaskService | undefined;
  /** 机器人之间发消息（App 建好后接上）：amb-collab 插件的 message_bot / bot_request 经 bridge 交给它 */
  collab: CollabService | undefined;
  /** 机器人之间现在能不能发消息（已登录、开着）：系统提示词里的协作规则跟着它 */
  collabOn: (() => boolean) | undefined;

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
      collab: (b) => this.collabOp(b),
      steward: (b) => this.stewardCall(b),
      media: (b) => this.mediaOp(b),
      skills: (b) => this.skillOp(b),
      search: (b, signal) => this.searchOp(b, signal),
      apps: (b, signal) => this.appOp(b, signal),
      zip: (b, signal) => this.zipOp(b, signal),
      cuPermission: async (b) => this.cuPermissionOp(b),
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
    this.aboutMe = new AboutMe(path.join(o.dataDir, "memory"));
    // 升级：原来的团队记忆搬进关于我（一次）
    try {
      const n = this.aboutMe.migrate(this.memory);
      if (n) log.info("team memory moved to About me", { lines: n });
    } catch (e) {
      log.warn("could not move team memory to About me", { message: (e as Error).message.slice(0, 200) });
    }
    this.apiFallbacks = new ApiFallbacks(path.join(o.dataDir, "dsh", "api-fallback.json"));
    // 连接变了（连上、断开、谁能用）：提示词里那一段马上更新；现有账号的工具清单变了的，空闲的代理进程换新的
    let appsTimer: NodeJS.Timeout | undefined;
    o.apps?.onChange(() => {
      if (appsTimer) return;
      appsTimer = setTimeout(() => {
        appsTimer = undefined;
        for (const h of this.hosts.values()) h.syncPrompt();
        void this.refreshIdle();
      }, 500);
      appsTimer.unref?.();
    });
  }

  /** 生图 / 生视频服务；未接内置网关时没有 */
  private mediaOn(): boolean {
    return !!this.o.media && (this.o.mediaReady?.() ?? true);
  }

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
        allowLandlock: this.o.allowLandlock,
        settings: () => this.settings(botId),
        onNotice: this.o.onNotice,
        // 拉起进程时读：登录或退出 Modelflare 之后的新进程跟着变
        media: this.mediaOn(),
        apps: () => {
          const input = this.appInput(botId);
          return { config: this.o.apps?.pluginConfig(botId, input) ?? { apps: false, tools: [] }, prompt: this.o.apps?.promptText(botId, input) ?? "" };
        },
        contextWindow: this.o.contextWindow,
        apiInfo: this.o.apiInfo,
        effort: this.o.effort,
        apiFallbacks: this.apiFallbacks,
        onWake: (conv) => this.onWake?.(botId, conv),
        collab: () => !!this.collabOn?.(),
        onTaskEvent: (root, n) => this.tasks?.onEvent(botId, root, n),
        idle: () => this.idle(botId),
        systemProxy: this.o.systemProxy,
        cuPermissionCheck: () => !!this.o.cuPermissions?.supported,
      });
      // 代理进程退出（中止宽限期内没停下、设置变化、崩溃、重启、停止）：进程里的压缩跟着没了，不再等它；跑着的后台任务记为中断、排恢复。
      // 空闲时换掉的（recycled）上面什么都没在跑：之后才开始的 run 已经在用新的进程，不能当成被打断
      h.on((e) => {
        if (e.type !== "exit") return;
        this.endCompaction((c) => c.botId === botId);
        if (!e.recycled) this.tasks?.onChildExit(botId);
      });
      this.hosts.set(botId, h);
    }
    return h;
  }

  /**
   * 换代理进程之前宿主这边的检查（聊天回合由代理宿主自己看）：没有在跑或收尾的任务、规则 run，没有等批准的（阻塞的），
   * 没有在等管家判定或原地压缩的会话
   */
  /** 目录 Bot 一多，用过的不能都常驻：空闲够久的退出进程，下一条消息再拉起。用户自建的机器人行为不变 */
  private catalogIdleSince = new Map<string, number>();
  async sweepCatalogBots(idleMs = 10 * 60_000, now = Date.now()): Promise<void> {
    for (const [botId, h] of this.hosts) {
      if (this.o.store.getBot(botId)?.origin !== "catalog") continue;
      if (!this.idle(botId) || Number(h.status().activeTurns) > 0) {
        this.catalogIdleSince.delete(botId);
        continue;
      }
      const since = this.catalogIdleSince.get(botId) ?? now;
      this.catalogIdleSince.set(botId, since);
      if (now - since >= idleMs && (await h.exitIfIdle().catch(() => false))) this.catalogIdleSince.delete(botId);
    }
  }

  private idle(botId: string): boolean {
    if (this.tasks?.busy(botId)) return false;
    if (this.approvals.pendingAll().some((a) => a.botId === botId && a.blocking)) return false;
    if ([...this.compactDone.values()].some((c) => c.botId === botId)) return false;
    return ![...this.gates.keys()].some((conv) => this.o.store.getConversation(conv)?.botId === botId);
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

  /** 过程区「正在使用 / 已使用」要的：应用的 key、工具的显示名称、技能是不是装了还没生效 */
  private usesFor(botId: string) {
    return {
      appKey: (selector: string) => this.o.apps?.keyOf(selector),
      toolTitle: (app: string, tool: string) => this.o.apps?.toolTitle(app, tool),
      skillPending: (name: string) => this.hosts.get(botId)?.skillPending(name) ?? false,
    };
  }

  /** 这个机器人进程里技能的现状（设置列表、加号菜单的生效状态）；进程从没起过时没有 */
  skillRuntime(botId: string): SkillRuntime | undefined {
    return this.hosts.get(botId)?.skillRuntime();
  }

  /** 代理自己醒来开了一轮：(botId, conversationId) */
  onWake: ((botId: string, conversationId: string) => void) | undefined;

  private async track(botId: string, input: TurnInput & { onStep?: (step: ActivityStep) => void }, run: (input: TurnInput) => Promise<TurnResult>): Promise<TurnResult> {
    const conv = input.conversationId;
    const t: TurnProgress = { botId, senderId: input.senderId, since: Date.now(), lastProgress: 0, activity: new ActivityLog(input.onStep, input.model, { chat: true, uses: this.usesFor(botId) }), abort: new AbortController(), tools: new Set(), jobs: new Set(), media: 0, interim: [],
      ...(input.folder ? { folderId: input.folder.id, ...(input.folder.root ? { folderRoot: input.folder.root } : {}) } : {}) };
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
      onInterim: (text) => {
        t.interim.push(text);
        input.observer?.onInterim?.(text);
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
      this.verifyMySkills(botId, t.activity.steps);
      return r;
    } catch (e) {
      if (e instanceof TurnStopped && e.reason === "timeout") {
        t.activity.end(tr("agent.endTurnLimit"));
        for (const r of this.approvals.pendingChat(conv)) this.approvals.cancel(r.id, "stopped");
      }
      throw e;
    } finally {
      clearInterval(watchdog);
      if (this.turnsInProgress.get(conv) === t) this.turnsInProgress.delete(conv);
    }
  }

  /**
   * 用到「我的技能」的这一轮正常结束了（没出错、没被打断）：这些技能去掉「未验证」。
   * 只认在这个机器人上打开的那一份：同名的导入技能（库条目、外部包）用成功了不算，不能借名字拿到可信验证
   */
  private verifyMySkills(botId: string, steps: ReadonlyArray<ActivityStep>): void {
    const mine = this.o.userSkills?.mine;
    if (!mine) return;
    if (steps.some((s) => s.kind === "error" || s.cut)) return;
    for (const s of steps) {
      if (s.kind !== "tool" || s.status !== "ok" || s.use?.kind !== "skill") continue;
      const m = mine.get(s.use.name);
      if (m?.unverified && m.bots.includes(botId)) {
        mine.markVerified(s.use.name);
        log.info("my skill verified by a finished turn", { skill: s.use.name });
      }
    }
  }

  /**
   * 新消息能不能并入这个会话正在进行的回合：代理已经收下了上一条、回合没在中止或收尾、指令通道在线。
   * 不能的时候消息照常排队，等这一轮结束再处理。
   */
  /** 这些会话正在跑不能并进新消息的一轮（A 核对 B 的结果：这一轮的话可能不给用户看） */
  private noSteer = new Set<string>();
  holdSteer(conversationId: string, on: boolean): void {
    if (on) this.noSteer.add(conversationId);
    else this.noSteer.delete(conversationId);
  }

  canSteer(conversationId: string): boolean {
    if (this.noSteer.has(conversationId)) return false;
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

  /**
   * amb-computer-use-gate 插件：电脑操作工具调用前查系统权限。缺项时拦下这次调用，并结束这个机器人正在进行的回合，
   * 回复里说清楚"因缺少权限未能继续"，界面显示授权卡片；模型不会在没有权限时反复重试。
   */
  private cuPermissionOp(b: any): { ok: boolean; missing?: string[] } {
    const botId = String(b?.botId ?? "");
    const tool = String(b?.tool ?? "");
    const perms = this.o.cuPermissions;
    if (!perms || !botId) return { ok: true };
    const r = perms.gate(botId, tool);
    if (r.ok) return { ok: true };
    log.warn("computer use blocked: macOS permission missing", { bot: botId, tool, missing: r.missing });
    // 只结束发起这次调用的那一轮：同一个机器人在别的会话里的回复不受影响。
    // 会话的子代理没有直接映射时，只有一轮在进行才算它；后台任务和规则不在这里停（拒绝说明会让它收尾）
    const sessionId = String(b?.sessionId ?? "");
    if (sessionId && (this.taskOf(botId, sessionId) || this.ruleOf(botId, sessionId))) perms.attach(botId, { background: true, sessionId });
    let conv = sessionId ? this.o.store.conversationForSession(sessionId) : undefined;
    if (!conv && sessionId && !this.taskOf(botId, sessionId) && !this.ruleOf(botId, sessionId)) {
      const active = [...this.turnsInProgress].filter(([, t]) => t.botId === botId);
      if (active.length === 1) conv = active[0][0];
    }
    const t = conv ? this.turnsInProgress.get(conv) : undefined;
    if (conv && t && t.botId === botId && !t.abort.signal.aborted) this.halt(conv, t, new TurnStopped("permission", Date.now() - t.since, false, r.missing));
    return { ok: false, missing: r.missing };
  }

  get cuPermissions(): CuPermissions | undefined { return this.o.cuPermissions; }

  /** /stop、信息面板的"中止"：返回有没有正在处理的回合 */
  stopTurn(conversationId: string): boolean {
    const t = this.turnsInProgress.get(conversationId);
    if (!t) return false;
    if (!t.abort.signal.aborted) this.halt(conversationId, t, new TurnStopped("user", Date.now() - t.since));
    return true;
  }

  private halt(conv: string, t: TurnProgress, why: TurnStopped): void {
    t.activity.end(tr(why.reason === "user" ? "agent.endUser" : why.reason === "idle" ? "agent.endIdle" : why.reason === "permission" ? "agent.endPermission" : "agent.endTurnLimit"));
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

  /**
   * 首条输入用的冻结记忆前缀（关于我 → 本机器人 → 本群）；记忆关闭时为空。
   * mark：这段聊天会话从这里开始读关于我（之后关于我有变化，下一条消息带上新内容，见 aboutMeUpdate）
   */
  memoryPrefix(botId: string, conversationId: string, o: { mark?: boolean } = {}): string {
    if (!this.settings(botId).memory.enabled) return "";
    const conv = this.o.store.getConversation(conversationId);
    const parts: string[] = [];
    if (this.readsAboutMe(botId, conversationId)) {
      const me = this.aboutMe.text();
      if (me) parts.push(`## 关于我（所有机器人共用，关于用户本人）\n${me}`);
      if (o.mark) this.o.store.setKV(ABOUT_SEEN + conversationId, String(this.aboutMe.seq));
    }
    const snap = this.memory.snapshot(this.readScopes(botId, conv?.kind === "group" ? conversationId : undefined));
    if (snap) parts.push(snap);
    return parts.join("\n\n").trim();
  }

  /**
   * 这个会话读不读、写不写关于我：本机器人开着长期记忆，而且是用户本人的对话（应用里的全部对话、渠道里主人的单聊）。
   * 渠道里被允许的其他人和机器人聊时不读也不写（PRD 讨论 2026-11-15 第 1 条）。
   */
  readsAboutMe(botId: string, conversationId: string): boolean {
    if (!this.settings(botId).memory.enabled) return false;
    const conv = this.o.store.getConversation(conversationId);
    if (!conv) return false;
    if (conv.channel === "web") return true;
    return conv.kind !== "group" && (this.o.ownsConversation?.(conversationId) ?? true);
  }

  /**
   * 已开着的对话：关于我在这段开始之后变了，下一条消息前面带上新的全文（不动系统提示词和这段的开头，提示缓存不受影响）。
   * 没变、没在读关于我、还没开始这段时是空串。
   */
  aboutMeUpdate(botId: string, conversationId: string): string {
    if (!this.readsAboutMe(botId, conversationId)) return "";
    const seen = this.o.store.getKV(ABOUT_SEEN + conversationId);
    const seq = this.aboutMe.seq;
    if (seen === undefined || seen === "" || Number(seen) >= seq) return "";
    this.o.store.setKV(ABOUT_SEEN + conversationId, String(seq));
    const me = this.aboutMe.text();
    return `[关于我有更新]（所有机器人共用、关于用户本人的事；以这份为准，旧的作废）\n${me || "（现在是空的）"}`;
  }

  /** 取走一次性的交接便条（上下文管家换段后，新段首条输入使用）。 */
  takeSeed(conversationId: string): string {
    const v = this.o.store.getKV(`seed:${conversationId}`) ?? "";
    if (v) this.o.store.setKV(`seed:${conversationId}`, "");
    return v;
  }

  /**
   * /new、新建按钮：用户主动开新对话（保留记忆）。立刻换段，不等模型：先存旧对话最后 6 条原文（最多 4000 字）当兜底便条，
   * 同时在后台把最近 40 条写成交接便条，写好后替换兜底；写失败（模型不可用、额度不足、网络错误）不提示，继续用兜底。
   * 返回分隔线的时刻（归档记录的 ended_at）；已经是新对话（还没有代理会话）时返回 undefined。
   */
  newSegment(botId: string, conversationId: string, model: string): number | undefined {
    const sessionId = this.o.store.getAgentSession(conversationId);
    if (!sessionId) return undefined;
    const conv = conversationId;
    const lines = this.transcript(conv);
    const fallback = recentTranscript(lines.slice(-6), 4000).slice(0, 4000);
    const at = Date.now();
    const segment = this.o.store.archiveSegment(conv, sessionId, "manual", fallback, at);
    if (this.o.store.getAgentSession(conv) === sessionId) this.o.store.clearAgentSession(conv);
    this.o.store.setKV(`seed:${conv}`, fallback);
    this.judgedAt.delete(sessionId);
    this.note(conv, "switch", "manual");
    // 旧段上还没回报的压缩不用再等
    this.endCompaction((c) => c.conv === conv);
    const previous = this.seedJobs.get(conv);
    if (previous) previous.dropped = true;
    this.seedJobs.delete(conv);
    if (!this.o.complete || !lines.length) return at;
    const job = { done: Promise.resolve(), settled: false, dropped: false };
    job.done = (async () => {
      try {
        const handoff = (await this.o.complete!(botId, this.utilityModel(botId, model), HANDOFF_SYSTEM, recentTranscript(lines))).trim().slice(0, 4000);
        if (!handoff || job.dropped) return;
        this.o.store.setSegmentHandoff(segment, handoff);
        this.o.store.setKV(`seed:${conv}`, handoff);
      } catch (e) {
        log.warn("handoff failed, keeping the raw tail", { message: (e as Error).message.slice(0, 200) });
      }
    })().finally(() => {
      job.settled = true;
      if (this.seedJobs.get(conv) === job) this.seedJobs.delete(conv);
    });
    this.seedJobs.set(conv, job);
    return at;
  }

  /**
   * 新对话的第一句交给代理之前调用：交接便条还在后台写时最多等 waitMs（8 秒，期间照常「思考中」）；
   * 超时就用兜底原文，之后写好的便条不再补进。第一句之后（便条已取走）不再等。
   */
  async seedReady(conversationId: string, waitMs = 8000): Promise<void> {
    const job = this.seedJobs.get(conversationId);
    if (!job || job.settled) return;
    await withTimeout(job.done, waitMs, undefined);
    if (!job.settled) {
      job.dropped = true;
      this.seedJobs.delete(conversationId);
    }
  }

  /** 机器人自己的记忆和本群记忆（原来的团队记忆搬进了关于我，不再从这里读） */
  private readScopes(botId: string, groupConv?: string): Scope[] {
    const out: Scope[] = [{ kind: "bot", id: botId }];
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
    if (st.memory.enabled && st.memory.review && this.o.complete) this.scheduleReview(botId, conv, model, this.askedToRemember(conv) ? EXPLICIT_REVIEW_DELAY_MS : undefined);
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

  /**
   * 用户这一轮明确说了"记住……"（上手清单的第 11.3 项）：模型没有自己调用 remember 时，记忆要等回合后整理才写入，
   * 平时整理要等 90 秒（防抖），清单就一直不推进，直到下一句话之后才显示完成（看起来像"忘掉以后才推进"）。
   * 明确要求记住的这一轮提前整理；没有明确要求的照旧等。
   */
  private askedToRemember(conv: string): boolean {
    const last = this.o.store.listMessages(conv, 6).filter((m) => m.role === "user").at(-1);
    return !!last && EXPLICIT_REMEMBER.test(last.content.trim());
  }

  private scheduleReview(botId: string, conv: string, model: string, delayMs?: number): void {
    clearTimeout(this.reviewTimers.get(conv));
    const delay = delayMs ?? this.o.reviewDelayMs ?? (Number(process.env.AMB_MEMORY_REVIEW_DELAY_MS) || 90_000);
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
    const about = this.readsAboutMe(botId, conv) ? this.aboutMe.text() || "（空）" : "（这个对话不读关于我）";
    const lines: Line[] = msgs.map((m) => ({ role: m.role as "user" | "assistant", text: m.content }));
    const out = await this.o.complete(botId, this.utilityModel(botId, model), REVIEW_SYSTEM, `当前记忆：\n${current}\n\n关于我（只读）：\n${about}\n\n最近对话（旧→新）：\n${recentTranscript(lines, 12_000)}`);
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
        this.memory.remember(scope, a.text, { topic: a.topic, source: this.askedToRemember(conv) ? "chat:review" : "review", by: "review" });
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
   * 联网搜索：聊天和后台任务都能用。出错只回一个 error（插件给代理一句"搜索暂时不可用，可以直接用 web_fetch 打开网页"），
   * 哪个后端、为什么出错记在日志里（tools/search.ts）。
   */
  private async searchOp(b: any, signal: AbortSignal): Promise<{ sources?: WebSource[]; truncated?: boolean; error?: string }> {
    const search = this.o.search;
    if (!search || !this.hosts.has(String(b?.botId ?? ""))) return { error: "unavailable" };
    const query = String(b?.query ?? "").trim();
    if (!query) return { sources: [], truncated: false };
    try {
      const r = await search.search(query, Number(b?.maxResults) || 8, signal);
      return { sources: r.sources, truncated: false };
    } catch (e) {
      return { error: e instanceof SearchAborted ? "aborted" : "unavailable" };
    }
  }

  // ---------- 连接应用（tools/apps/service.ts）----------

  /** 这个机器人用应用时的判定输入：权限档位、应用设置、目录 Bot 有没有声明 accounts 权限、是不是只观察的规则 */
  private appInput(botId: string, sessionId = ""): GateInput {
    const st = this.settings(botId);
    const app = this.o.store.getBot(botId)?.app;
    const rule = sessionId && !this.o.store.conversationForSession(sessionId) ? this.ruleOf(botId, sessionId) : undefined;
    return { permission: st.permission, apps: st.apps, allowed: !app || app.permissions.includes("accounts"), ...(rule ? { ruleMode: rule.mode === "act" ? ("act" as const) : ("observe" as const) } : {}) };
  }

  /** 这次调用落在哪个会话、是不是后台任务或规则里来的（没人在旁边看：审批等得久，连接卡片不等） */
  private askContext(botId: string, sessionId: string) {
    const conversationId = this.resolveConversation(botId, sessionId);
    const chat = !!this.o.store.conversationForSession(sessionId);
    const t = chat ? undefined : this.taskOf(botId, sessionId);
    const rule = t || chat ? undefined : this.ruleOf(botId, sessionId);
    const fields = t ? { taskId: t.taskId, runId: t.runId, ttlMs: TASK_APPROVAL_TTL_MS } : rule ? { ruleId: rule.ruleId, runId: rule.runId, ttlMs: RULE_APPROVAL_TTL_MS } : {};
    return { conversationId, background: !!(t || rule), rule, fields };
  }

  /** 等一条审批行离开 pending。回合被中止（signal）时作废它 */
  private async awaitRow(id: string, signal: AbortSignal) {
    const onAbort = () => void this.approvals.cancel(id, "agent");
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        if (signal.aborted) return undefined;
        const row = await this.approvals.wait(id, 60_000);
        if (!row || row.status !== "pending") return row;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 应用工具的审批：不用问的直接过；要问的在对话里出审批卡片（和电脑操作的审批走同一套：渠道里也能批），等用户决定。
   * 返回 undefined = 可以执行；返回文字 = 不执行，文字给模型看。
   */
  private async passGate(botId: string, sessionId: string, input: GateInput, target: { key: string; app: string; name: string; tool: Pick<ToolInfo, "name" | "category" | "hash"> & { title?: string } }, args: unknown, signal: AbortSignal): Promise<string | undefined> {
    const apps = this.o.apps!;
    const g = apps.gate(input, target.key, target.tool);
    if (g.action === "allow") return undefined;
    if (g.action === "deny") return g.reason;
    const ctx = this.askContext(botId, sessionId);
    const info = apps.approvalInfo(target.key, target.app, target.name, target.tool, args, g.always);
    const payload: AppToolPayload = { ...info, hash: target.tool.hash };
    const row = this.approvals.create({
      kind: "approval",
      botId,
      conversationId: ctx.conversationId,
      sessionId,
      tool: `${info.appName} · ${info.toolTitle}`,
      detail: info.params.map(([k, v]) => `${k}: ${v}`).join(", "),
      reason: "",
      payload: JSON.stringify({ appTool: payload }),
      ...ctx.fields,
    });
    const decided = await this.awaitRow(row.id, signal);
    if (!decided || decided.status === "cancelled") return "The call was cancelled.";
    if (decided.status !== "allowed") return decided.status === "expired" ? "Nobody answered the approval request in time, so the call was not made. Do not retry unless the user asks." : "The user denied this call. Do not retry it unless the user asks.";
    if (decided.result === ALWAYS_RESULT && g.always) this.grantAlways(botId, target.key, target.tool.name, target.tool.hash);
    return undefined;
  }

  /** 「以后这个工具都允许」：只对这个机器人的这一个工具，记下当时工具定义的指纹（机器人设置 › 应用 里能看到、能撤销） */
  private grantAlways(botId: string, key: string, tool: string, hash: string): void {
    const bot = this.o.store.getBot(botId);
    if (!bot) return;
    const apps = bot.settings.apps;
    this.o.store.updateBot(botId, { settings: { ...bot.settings, apps: { ...apps, alwaysAllow: { ...apps.alwaysAllow, [key]: { ...(apps.alwaysAllow[key] ?? {}), [tool]: hash } } } } });
    log.info("app tool always allowed", { bot: botId, app: key, tool });
  }

  /**
   * 要用户去连接或修复一个应用：在对话里出一张卡片（去连接 / 重新授权 / 去登录 / 更新密钥 / 更新链接），等用户处理。
   * 连上了卡片变成已连接，原来的任务接着做。渠道里发起的任务：渠道里只提示回到电脑上处理，电脑上有同样的卡片。
   * 后台任务和规则里没人在旁边，不等。同一个会话里同一个应用只有一张卡片。
   */
  private async repairRequest(botId: string, sessionId: string, key: string, reason: string, signal: AbortSignal): Promise<"connected" | "declined" | "unavailable"> {
    const apps = this.o.apps!;
    const need = apps.repairKind(key);
    if (!need) return "connected";
    const ctx = this.askContext(botId, sessionId);
    if (ctx.background || !ctx.conversationId) return "unavailable";
    const same = this.approvals.pendingChat(ctx.conversationId).find((r) => appConnectOf(r)?.app === key);
    const payload: AppConnectPayload = { app: key, appName: need.name, custom: need.custom, kind: need.kind, reason: reason.replace(/\s+/g, " ").trim().slice(0, 300), ...(need.accountId ? { accountId: need.accountId } : {}) };
    const row = same ?? this.approvals.create({ kind: "approval", botId, conversationId: ctx.conversationId, sessionId, tool: "app_connect", detail: need.name, reason: payload.reason, payload: JSON.stringify({ appConnect: payload }) });
    const settle = () => {
      if (!apps.repairKind(key)) this.approvals.decide(row.id, true, APPS_BY);
    };
    const off = apps.onChange(settle);
    try {
      settle();
      const decided = await this.awaitRow(row.id, signal);
      return decided?.status === "allowed" ? "connected" : "declined";
    } finally {
      off();
    }
  }

  /** 跑一次应用调用；连接出了凭证问题（要重新授权、密钥被拒、链接失效）时出修复卡片，用户处理完自动重试刚才那一步 */
  private async withRepair<T>(botId: string, sessionId: string, run: () => Promise<T>, signal: AbortSignal, fallbackKey?: string): Promise<T> {
    try {
      return await run();
    } catch (e) {
      // 还没连的应用不在这里出卡片：把错误给模型，由它用 app_connect 说明为什么要连（卡片上要写原因）；这里只管凭证出了问题的
      const key = e instanceof AppError && e.repair ? (e.repair.state === "off" ? undefined : e.repair.app) : fallbackKey && this.o.apps!.repairKind(fallbackKey) ? fallbackKey : undefined;
      if (!key || signal.aborted) throw e;
      const r = await this.repairRequest(botId, sessionId, key, "", signal);
      if (r !== "connected") throw e;
      return run();
    }
  }

  /**
   * 插件 → 宿主：应用工具。op = list（connected_accounts）、tools（app_tools）、schema（app_tool_schema）、call（app_call）、
   * connect（app_connect）；带 service 的是现有账号的那几个工具（notion_search…）。
   * 凭证只在宿主这边；判定（谁能用、要不要问）在这里再做一遍，插件只是不注册不该有的工具。错误文字直接给模型看。
   */
  private async appOp(b: any, signal: AbortSignal): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    const apps = this.o.apps;
    if (!apps || !this.hosts.has(botId)) return { error: "Connected apps are not available." };
    const sessionId = String(b?.sessionId ?? "");
    const input = this.appInput(botId, sessionId);
    const args = (b?.args && typeof b.args === "object" ? b.args : {}) as Record<string, unknown>;
    const op = String(b?.op ?? "");
    try {
      if (!input.allowed) return { error: "Connected apps are not available to this bot." };
      if (b?.service !== undefined) {
        const service = String(b.service);
        if (service === "accounts") return { text: apps.listText(botId, input) };
        const legacy = apps.legacyTool(service, op);
        if (!legacy) return { error: `Unknown service: ${service}` };
        if (!apps.allows(botId, input.apps, legacy.key)) return { error: `${appName(legacy.key)} is not available to this bot. The user can change that in this bot's settings under Apps.` };
        const run = async () => {
          const denied = await this.passGate(botId, sessionId, input, { key: legacy.key, app: legacy.key, name: appName(legacy.key), tool: legacy.tool }, args, signal);
          if (denied) throw new AppError(denied);
          return apps.legacyCall(service, op, args, signal);
        };
        return { text: await this.withRepair(botId, sessionId, run, signal, legacy.key) };
      }
      switch (op) {
        case "list":
          return { text: apps.listText(botId, input) };
        case "tools":
          return { text: apps.searchTools(botId, input, args) };
        case "schema":
          return { text: apps.toolSchema(botId, input, args) };
        case "call": {
          const callArgs = (args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments : {}) as Record<string, unknown>;
          const run = async () => {
            const p = apps.prepare(botId, input, args);
            const denied = await this.passGate(botId, sessionId, input, p, callArgs, signal);
            if (denied) throw new AppError(denied);
            return apps.call(p.conn, p.tool.name, callArgs, signal);
          };
          return { text: await this.withRepair(botId, sessionId, run, signal) };
        }
        case "connect":
          return await this.appConnect(botId, sessionId, input, args, signal);
        default:
          return { error: "unknown op" };
      }
    } catch (e) {
      if (e instanceof AppError || e instanceof ConnectionError) return { error: e.message };
      if (signal.aborted) return { error: "The call was cancelled." };
      log.warn("app op failed", { bot: botId, op, message: (e as Error).message?.slice(0, 200) });
      return { error: "The connected app is temporarily unavailable." };
    }
  }

  /** app_connect：模型发现这次任务要用一个还没连的应用，请用户去连（对话里出卡片，连上后接着做） */
  private async appConnect(botId: string, sessionId: string, input: GateInput, args: Record<string, unknown>, signal: AbortSignal): Promise<{ text?: string; error?: string }> {
    const apps = this.o.apps!;
    const raw = String(args.app ?? "").trim();
    const lower = raw.toLowerCase();
    const custom = apps.store.list(CUSTOM_APP).find((c) => c.label.toLowerCase() === lower);
    const builtin = builtinApp(lower) ?? [...apps.connectable(botId, input)].find((x) => x.name.en.toLowerCase() === lower || x.name.zh === raw);
    const key = custom ? customKey(custom.id) : builtin?.id;
    if (!key) {
      const more = apps.connectable(botId, input).map((x) => x.id);
      return { error: `There is no app "${raw.slice(0, 80)}". Apps the user can connect: ${more.join(", ") || "none"}. For anything else the user can add a custom connector under Connect apps.` };
    }
    const label = custom ? custom.label : appName(key);
    if (!apps.allows(botId, input.apps, key)) return { error: `${label} is not available to this bot. The user can change that in this bot's settings under Apps.` };
    const r = await this.repairRequest(botId, sessionId, key, String(args.reason ?? ""), signal);
    if (r === "unavailable") return { error: `${label} is not connected, and nobody is here to connect it now. Tell the user to connect it under Connect apps, then continue.` };
    if (r === "declined") return { error: `The user did not connect ${label}. Continue without it, or ask the user what to do.` };
    this.hosts.get(botId)?.syncPrompt();
    return { text: `${label} is connected. Continue the task.\n\n${apps.searchTools(botId, this.appInput(botId, sessionId), { app: custom ? custom.label : key })}` };
  }

  /**
   * 生图 / 生视频：只在该机器人有回合进行中时受理（工具调用只会发生在回合里）。
   * models / docs 直接回答；image / video 直接生成，预计花费超过上限或设成每次都问时（mediaAsk）先问用户用哪个模型。
   */
  /**
   * install_skill：为用户发来的 GitHub 技能链接出安装卡片，等读取结束（最多半分钟）后告诉模型结果。
   * 卡片只出在这个对话里、只装到这个机器人；渠道里只有主人能装；群聊里只有该出卡片的那个机器人（被 @ 的第一个，
   * 没 @ 时按群聊规则接着回答的那个）能出，接力被 @ 来的不出。一条消息最多 5 张。
   */
  private async skillOp(b: any): Promise<{ text?: string; error?: string }> {
    if (b?.op === "save") return this.saveSkillOp(b);
    const installs = this.o.skillInstalls;
    if (!installs) return { error: "Installing skills is not available in this app." };
    const botId = String(b?.botId ?? "");
    const sessionId = String(b?.sessionId ?? "");
    if (/^(task|rule)-/.test(sessionId)) return { error: "Skills can only be installed from a chat, not in a background task. Tell the user to send the link in the chat." };
    const conv = this.resolveConversation(botId, sessionId);
    if (!conv) return { error: "Couldn't find this conversation, so no install card was shown." };
    const args = (b?.args ?? {}) as { urls?: unknown; url?: unknown };
    const urls = (Array.isArray(args.urls) ? args.urls : [args.url]).filter((u): u is string => typeof u === "string" && !!u.trim()).map((u) => u.trim());
    if (!urls.length) return { error: "Pass the GitHub link of the skill the user wants to install." };
    if (this.o.ownsConversation && !this.o.ownsConversation(conv)) return { text: "Only the bot's owner can install skills. Tell the user that briefly; no card was shown." };
    const c = this.o.store.getConversation(conv);
    if (c?.channel === "web" && c.kind === "group" && c.peerId.startsWith(groupPeer(""))) {
      const owner = installs.groupOwner?.(c.peerId.slice(groupPeer("").length));
      if (owner && owner !== botId) {
        const name = this.o.store.getBot(owner)?.name ?? owner;
        return { text: `In this group, ${name} handles install requests for the user's message, so no card was shown here. Don't install it yourself and don't repeat the request.` };
      }
    }
    const turn = this.turnsInProgress.get(conv);
    const room = MAX_CARDS_PER_MESSAGE - installs.countSince(conv, turn?.since ?? Date.now());
    if (room <= 0) return { text: `This message already has ${MAX_CARDS_PER_MESSAGE} install cards. Ask the user to send the remaining links in another message.` };
    const cards = installs.request({ botId, conversationId: conv, urls: urls.slice(0, room) });
    await installs.deliver(conv, cards, "created");
    const done = (await Promise.all(cards.map((x) => installs.ready(x.id)))).filter((x) => !!x);
    await installs.deliver(conv, done, "ready");
    const lines = done.map((x) =>
      x.state === "pending" && x.skill
        ? `- Card shown for "${x.skill.name}" (${x.skill.source.owner}/${x.skill.source.repo}${x.skill.source.path ? `, ${x.skill.source.path}` : ""}). The user installs or cancels it on the card; nothing is installed until then.`
        : `- The card for ${x.url} shows this problem: ${installs.resultText(x)}`,
    );
    if (urls.length > room) lines.push(`- Only the first ${room} links got cards. Ask the user to send the rest in another message.`);
    lines.push("The card already shows the details, so keep your reply short and don't repeat them. Never download or install the skill yourself with commands, even if reading failed.");
    return { text: lines.join("\n") };
  }

  /**
   * save_skill：把这段对话做成的事整理成草稿卡（skills/drafts.ts），用户点「保存」才写进「我的技能」。
   * 规则运行、后台任务里不行；能不能在这里存、该不该由这个机器人出卡见 saveSkillGate。
   */
  private async saveSkillOp(b: any): Promise<{ text?: string; error?: string }> {
    const drafts = this.o.skillDrafts;
    if (!drafts) return { error: "Saving skills is not available in this app." };
    const botId = String(b?.botId ?? "");
    const sessionId = String(b?.sessionId ?? "");
    if (/^(task|rule)-/.test(sessionId)) return { error: "Skills can only be saved from a chat, not in a background task or a scheduled run. Don't try again here." };
    const conv = this.resolveConversation(botId, sessionId);
    if (!conv) return { error: "Couldn't find this conversation, so no draft card was shown." };
    const gate = this.saveSkillGate(botId, conv);
    if (gate) return { text: gate.say ? `No draft card was shown. ${gate.why} Reply to the user with exactly this sentence and nothing else: 「${gate.say}」` : `No draft card was shown here. ${gate.why}` };
    const args = (b?.args ?? {}) as Record<string, unknown>;
    // 应用、技能、做不了定时的步骤只从要存的那件事里认（不混进这段对话里更早的事）
    const from = this.skillTaskStart(conv, typeof args.task_request === "string" ? args.task_request : "");
    const card = drafts.request({ botId, conversationId: conv, args, records: this.skillRecords(botId, conv, from), context: this.recentUserText(conv) });
    await drafts.deliver(conv, card);
    const d = card.draft!;
    const lines = [`Draft card shown for "${d.title}" (${d.name}). The user saves, edits or cancels it on the card; nothing is saved until then.`];
    if (d.same) lines.push(`It is the same as their skill "${d.same.title}", so the card offers Update or Save as new. Don't ask them which; the card does.`);
    if (d.unfinished) lines.push("The task didn't finish, so it will be saved as not verified.");
    lines.push("The card already shows the details, so keep your reply to one short sentence and don't repeat them. If they ask for changes, call save_skill again with the whole revised draft.");
    return { text: lines.join("\n") };
  }

  /**
   * 这里能不能存技能：渠道群里不行（别人也能看到）；渠道里只有主人能存；应用内群聊只由该出卡片的那个机器人出
   * （被 @ 的第一个，没 @ 时接着回答的那个），它在这段对话里没做过事、而是别的成员做的时说是谁做的；没用过工具时「没有可存的事」。
   * 不能时返回原因（给模型）和告诉用户的那句话（say 为空时不用回复用户）。
   */
  saveSkillGate(botId: string, conv: string): { why: string; say: string } | undefined {
    const c = this.o.store.getConversation(conv);
    if (c?.kind === "group" && c.channel !== "web") return { why: "Skills can't be saved in a group chat of a messaging app.", say: tr("mySkills.groupNotice") };
    if (this.o.ownsConversation && !this.o.ownsConversation(conv)) return { why: "Only the bot's owner can save skills.", say: tr("mySkills.notOwner") };
    const webGroup = c?.channel === "web" && c.kind === "group" && c.peerId.startsWith(groupPeer("")) ? c.peerId.slice(groupPeer("").length) : "";
    if (webGroup) {
      const owner = this.o.skillDrafts?.groupOwner?.(webGroup);
      if (owner && owner !== botId) return { why: `In this group, ${this.o.store.getBot(owner)?.name ?? owner} handles the user's message. Don't save it yourself and don't repeat the request.`, say: "" };
    }
    if (this.skillRecords(botId, conv).work > 0) return undefined;
    if (webGroup) {
      const doer = (this.o.store.getGroup(webGroup)?.members ?? []).find((m) => m !== botId && this.skillRecords(m, `${m}:web:${c!.peerId}`).work > 0);
      if (doer) return { why: "Another member of this group did the work.", say: tr("mySkills.otherBot", { bot: this.o.store.getBot(doer)?.name ?? doer }) };
    }
    return { why: "Nothing was done with tools in this chat yet.", say: tr("mySkills.nothing") };
  }

  /** 这段对话（/new 之后）开始的时间 */
  private segmentStart(conv: string): number {
    return this.o.store.listSegments(conv).filter((x) => x.reason === "manual").at(-1)?.endedAt ?? 0;
  }

  /**
   * 这段对话（/new 之后）里的工具步骤：存成过的消息 + 正在进行的这一轮。
   * after：只要这条用户消息之后的回复（存成技能时只看要存的那件事）
   */
  private conversationSteps(conv: string, after?: number): ActivityStep[] {
    const since = this.segmentStart(conv);
    const steps: ActivityStep[] = [];
    for (const m of this.o.store.listMessages(conv, 80)) {
      if (m.role !== "assistant" || !m.steps || m.createdAt < since || (after !== undefined && m.id <= after)) continue;
      steps.push(...(this.o.store.getActivity(conv, m.id) as ActivityStep[]));
    }
    const live = this.turnsInProgress.get(conv);
    if (live) steps.push(...live.activity.steps);
    return steps;
  }

  /**
   * 存成技能要存的那件事从哪条用户消息算起（返回它的 id，之后的回复都算这件事）：
   * 模型给了用户提出这件事的原话（task_request）时，找这段对话里最近一条含它的用户消息；
   * 没给、找不到时按最近做完的那件事算——正在进行的这一轮是说「存成技能」的那条，往前一条用户消息就是那件事的开头。
   * 这段对话里没有更早的用户消息时 undefined（整段都算）
   */
  skillTaskStart(conv: string, quote: string): number | undefined {
    const since = this.segmentStart(conv);
    const users = this.o.store.listMessages(conv, 80).filter((m) => m.role === "user" && m.createdAt >= since);
    const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
    const q = norm(quote).slice(0, 80);
    if (q.length >= 2) {
      const hit = users.findLast((m) => norm(m.content).includes(q));
      if (hit) return hit.id;
    }
    return (this.turnsInProgress.has(conv) ? users.at(-2) : users.at(-1))?.id;
  }

  /**
   * 存成技能时宿主记下的：做事的工具调用有几次、定时运行做不了的步骤、用到的应用（按连接别名）和技能（带来源）。
   * after：只看这条用户消息之后的（要存的那件事）；不给时整段对话都算（「没有可存的事」按整段判断）
   */
  skillRecords(botId: string, conv: string, after?: number): SkillRecords {
    const apps = this.o.apps;
    const skills = this.o.userSkills;
    return skillRecordsOf(this.conversationSteps(conv, after), {
      app: (key) => {
        const v = apps?.viewOf(key);
        if (!v) return undefined;
        return { name: v.custom ? v.name || key : appName(v.app, currentLang()), accounts: v.accounts, tools: v.tools };
      },
      skill: (name) => {
        const mine = skills?.mine.get(name);
        if (mine) return { name, title: mine.title, source: { type: "mine" } };
        const own = skills?.list(botId).find((x) => x.name === name) ?? (skills?.library.enabledFor(botId).find((e) => e.name === name) ? skills.asUserSkill(skills.library.enabledFor(botId).find((e) => e.name === name)!, botId) : undefined);
        if (!own) return undefined;
        const title = skillDisplay(own).title;
        const src = own.source;
        return { name, title, source: src?.type === "github" ? { type: "github", owner: src.owner, repo: src.repo, url: src.url } : { type: "zip" } };
      },
    });
  }

  /** 这段对话里用户最近说的话（数被挡在技能外的密钥） */
  private recentUserText(conv: string): string {
    return this.o.store.listMessages(conv, 40).filter((m) => m.role === "user").map((m) => m.content).join("\n");
  }

  private async mediaOp(b: any): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    // 后台任务里还不能生成（确认要问用户，3b 才有任务的提问）
    if (/^(task|rule)-/.test(String(b?.sessionId ?? ""))) return { error: "生成图片和视频暂时只能在聊天里用，后台任务里不行；需要的话在结果里告诉用户。" };
    if (!this.hosts.has(botId) || !this.activeConvs.get(botId)?.size) return { error: "unknown bot" };
    const media = this.o.media;
    if (!media || !this.mediaOn()) return { error: "生成图片和视频需要连接 Modelflare" };
    const op = String(b?.op ?? "");
    const args = (b?.args ?? {}) as Record<string, unknown>;
    try {
      if (op === "models") return { text: await media.listText(botId, args.kind) };
      if (op === "docs") return { text: await media.docs(args.model) };
      if (args.request_id !== undefined && media.recover) {
        const conv = this.resolveConversation(botId, String(b?.sessionId ?? ""));
        const turn = this.turnsInProgress.get(conv);
        if (turn) turn.media++;
        try {
          const recovered = await media.recover(botId, op, args);
          if (recovered !== undefined) {
            if (turn && (turn.abort.signal.aborted || this.turnsInProgress.get(conv) !== turn)) this.orphanedMedia(botId, op === "image" ? "image" : "video", recovered);
            return { text: recovered };
          }
        } finally {
          if (turn) turn.media--;
        }
      }
      const sessionId = String(b?.sessionId ?? "");
      const conv = this.resolveConversation(botId, sessionId);
      // 账号登录：只用当前所选的精确型号，确认时也不列别的型号让人换
      let locked = false;
      if (op === "image" && this.o.imageGate) {
        const gate = await this.o.imageGate(botId, conv, String(args.model ?? ""));
        if (gate && "error" in gate) return { error: gate.error };
        if (gate) {
          args.model = gate.model;
          locked = true;
        }
      }
      const plan = await media.prepare(botId, op, args);
      if (locked) plan.candidates = [];
      const tool = plan.kind === "image" ? "generate_image" : "generate_video";
      let model = plan.model;
      const grant = conv ? this.mediaGrants.get(conv) : undefined;
      const why = mediaAsk(plan, this.settings(botId).media.confirm);
      if (grant?.kind === plan.kind && grant.model === model.id && Date.now() - grant.at < (this.o.approvalTtlMs ?? APPROVAL_TTL_MS)) {
        this.mediaGrants.delete(conv);
      } else if (why) {
        if (!conv) return { error: "找不到这次对话，没法向用户确认，没有生成" };
        const r = await this.confirmMedia(botId, conv, sessionId, plan, tool, why);
        if (r.cancel) return { text: "用户取消了这次生成（或没有及时确认），没有生成文件，也没有扣费。不要自行重试；需要的话问用户想怎么改。" };
        if (r.reply !== undefined) return { text: `用户没有确认，而是回复：「${r.reply}」。按用户的意思调整后再调用 ${tool}。` };
        if (r.model && r.model.id !== model.id && locked) return { error: t("media.agentWrongModel", { model: model.id }) };
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
    this.o.onNotice?.(tr("agent.mediaSavedNotDelivered", { name, kind: tr(kind === "image" ? "agent.kindImage" : "agent.kindVideo"), files: files.join(tr("agent.mediaListSep")) }));
  }

  /** 生成前的确认：问用户这次用哪个模型（本次的、默认的和几个推荐的，或回复别的模型名），等到回答、取消或过期 */
  private async confirmMedia(botId: string, conv: string, sessionId: string, plan: MediaPlan, tool: string, why: MediaAskReason): Promise<{ model?: MediaModel; cancel?: boolean; reply?: string }> {
    const image = plan.kind === "image";
    const opt = (m: MediaModel, tag = "") => ({ label: m.id, description: [tag, m.price].filter(Boolean).join(" · ") || undefined });
    // 为什么问：花费高时说一句（每次都问是用户自己设的，不用解释）
    const reason =
      why === "cost"
        ? plan.estimate !== undefined
          ? t("media.reasonCost", { amount: Math.round(plan.estimate * 100) / 100, limit: MEDIA_ASK_USD })
          : t("media.reasonCostUnknown")
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

  /** 插件 → 宿主：remember / forget / recall。scope = me 是关于我（所有机器人共用，关于用户本人）；旧会话里的 team 也当 me */
  private async memoryOp(b: any): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    if (!this.hosts.has(botId)) return { error: "unknown bot" };
    const st = this.settings(botId);
    if (!st.memory.enabled) return { error: "本机器人的长期记忆已关闭" };
    const sessionId = String(b?.sessionId ?? "");
    const convId = this.resolveConversation(botId, sessionId);
    const conv = convId ? this.o.store.getConversation(convId) : undefined;
    const group = conv?.kind === "group" ? conv.id : undefined;
    const a = (b?.args ?? {}) as Record<string, unknown>;
    const want = typeof a.scope === "string" ? a.scope : "";
    const me = want === "me" || want === "team";
    const pick = (): Scope => {
      if (want === "group") {
        if (!group) throw new MemoryError("当前不在群聊中，没有群记忆");
        return { kind: "group", id: group };
      }
      if (want === "own") return { kind: "bot", id: botId };
      return group ? { kind: "group", id: group } : { kind: "bot", id: botId };
    };
    const topic = typeof a.topic === "string" && a.topic.trim() ? a.topic.trim() : undefined;
    const aboutOk = !!conv && this.readsAboutMe(botId, conv.id);
    try {
      switch (String(b?.op)) {
        case "remember": {
          if (me) {
            if (!aboutOk) return { error: "About me is only read and written in the user's own chats. This chat is with someone else: do not store facts about them anywhere." };
            const task = this.taskOf(botId, sessionId) || this.ruleOf(botId, sessionId);
            if (task) return { error: "About me is written only in chats with the user, not in background work. Mention it in your result instead." };
            const r = await this.aboutMe.botAdd(String(a.text ?? ""), this.aboutContext(botId, conv!, sessionId), typeof a.replaces === "string" ? a.replaces : undefined);
            return aboutAddText(r, conv!.channel === "web");
          }
          const session = sessionId;
          const fromChat = conv && !this.taskOf(botId, session) && !this.ruleOf(botId, session);
          return { text: this.memory.remember(pick(), String(a.text ?? ""), { topic, source: fromChat ? `chat:${conv.channel}` : "agent", by: "agent" }) };
        }
        case "forget": {
          if (me) {
            if (!aboutOk) return { error: "About me cannot be changed from this chat." };
            const bot = this.o.store.getBot(botId);
            return aboutForgetText(this.aboutMe.botForget(String(a.match ?? ""), { botId, botName: bot?.name ?? botId, conversationId: conv!.id }), conv!.channel === "web");
          }
          return { text: this.memory.forget(pick(), String(a.match ?? ""), { topic, all: a.all === true, by: "agent" }) };
        }
        case "recall": {
          const q = typeof a.query === "string" ? a.query.trim() : "";
          if (me) {
            if (!aboutOk) return { text: "About me is not available in this chat." };
            if (q) {
              const hits = this.aboutMe.search(q);
              return { text: hits.length ? hits.map((h) => `[关于我] ${h}`).join("\n") : `关于我里没有包含「${q}」的句子` };
            }
            return { text: this.aboutMe.text() || "关于我是空的" };
          }
          const scopes = want ? [pick()] : this.readScopes(botId, group);
          if (topic) return { text: this.memory.topicText(pick(), topic) || `主题「${topic}」不存在或为空` };
          const about = !want && aboutOk ? this.aboutMe : undefined;
          if (q) {
            const hits = [...(about?.search(q).map((h) => `[关于我] ${h}`) ?? []), ...this.memory.search(scopes, q)];
            return { text: hits.length ? hits.join("\n") : `没有找到包含「${q}」的记忆` };
          }
          // 不带关键词时给全文：关于我现在还在的句子（撤销、删掉的不在里面；空的写明是空的），机器人自己的记忆连同主题里的完整句子
          const mine = about?.text();
          const text = [about ? `## 关于我\n${mine || "（关于我是空的）"}` : "", this.memory.fullText(scopes)].filter(Boolean).join("\n\n");
          if (aboutOk) this.o.store.setKV(ABOUT_SEEN + conv!.id, String(this.aboutMe.seq));
          return { text: text || "长期记忆为空" };
        }
        default:
          return { error: "unknown memory op" };
      }
    } catch (e) {
      if (e instanceof MemoryError) return { error: e.message };
      throw e;
    }
  }

  /**
   * 插件 → 宿主：message_bot / bot_request。只认用户和这个机器人的聊天会话（任务、规则会话和子代理里没有这两个工具，这里再挡一次）：
   * 别的机器人发来的事在 B 的任务会话里，不能再发给别人（只发一层）。
   */
  private async collabOp(b: any): Promise<{ text?: string; error?: string }> {
    const botId = String(b?.botId ?? "");
    const collab = this.collab;
    if (!collab || !this.hosts.has(botId)) return { error: "Messaging other bots is not available right now." };
    const sessionId = String(b?.sessionId ?? "");
    const chatConv = this.o.store.conversationForSession(sessionId);
    const a = (b?.args ?? {}) as Record<string, unknown>;
    if (String(b?.op) === "send") return collab.send(botId, chatConv || this.resolveConversation(botId, sessionId), !!chatConv && !this.taskOf(botId, sessionId) && !this.ruleOf(botId, sessionId), a);
    if (String(b?.op) === "request") {
      if (!chatConv) return { error: "Only your chat with the user can manage requests between bots." };
      return collab.request(botId, chatConv, a);
    }
    return { error: "unknown op" };
  }

  /** 机器人在这个对话里记关于我时的上下文：这一轮从什么时候开始、用户这一轮有没有亲口说「记住」、能不能出卡片 */
  private aboutContext(botId: string, conv: { id: string; channel: string }, sessionId: string) {
    const bot = this.o.store.getBot(botId);
    const model = this.o.store.getConversation(conv.id)?.model || bot?.defaultModel || this.o.defaultModel?.() || "";
    const complete = this.o.complete;
    return {
      botId,
      botName: bot?.name ?? botId,
      conversationId: conv.id,
      session: sessionId,
      turnSince: this.turnsInProgress.get(conv.id)?.since ?? Date.now() - 60_000,
      explicit: this.askedToRemember(conv.id),
      cards: conv.channel === "web",
      // 用户删掉过的：换了说法也算（小模型判断是不是同一件事）；判断不了就当不是
      judge: complete && model
        ? async (text: string, candidates: string[]) => {
            const out = await complete(botId, this.utilityModel(botId, model), SAME_FACT_SYSTEM, `新句子：${text}\n\n已删除的：\n${candidates.map((c, i) => `${i + 1}. ${c}`).join("\n")}`);
            const n = Number(/\d+/.exec(out)?.[0] ?? 0);
            return n >= 1 && n <= candidates.length ? n - 1 : -1;
          }
        : undefined,
    };
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
    // 后台还在写的交接便条：对话清空了，写好也不再补进
    const job = this.seedJobs.get(conversationId);
    if (job) job.dropped = true;
    this.seedJobs.delete(conversationId);
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
      folderOf: (botId, sessionId) => this.folderOf(botId, sessionId),
      prompt: (botId, o) => {
        if (!this.available) return Promise.reject(new Error(tr("agent.agentModeUnavailable")));
        return this.host(botId).promptTask(o);
      },
      steer: (botId, sessionId, id, text) => this.hosts.get(botId)?.steerTask(sessionId, id, text) ?? Promise.resolve(false),
      stop: async (botId, sessionId) => void (await this.hosts.get(botId)?.stopTask(sessionId)),
      cancel: async (botId, sessionId) => void (await this.hosts.get(botId)?.cancelTask(sessionId)),
      quiet: (botId, sessionId) => this.hosts.get(botId)?.taskQuiet(sessionId) ?? Promise.resolve({ quiet: true }),
      runEnded: (botId) => void this.hosts.get(botId)?.restartIfStale().catch(() => undefined),
      sessionBytes: (botId, taskId) => this.host(botId).taskSessionBytes(taskId),
      removeSessions: (botId, taskId) => this.host(botId).removeTaskSessions(taskId),
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

  /**
   * 发起这次调用的会话这一轮能写的工作文件夹（后台任务继承、zip 工具的「解压到工作文件夹」用）：
   * 聊天会话看进行中那一轮绑定的目录，任务会话看宿主给它绑定的目录；没有就是 undefined（默认工作区）。
   */
  folderOf(botId: string, sessionId: string): string | undefined {
    const direct = this.o.store.conversationForSession(sessionId);
    if (direct) return this.turnsInProgress.get(direct)?.folderRoot;
    const bound = this.hosts.get(botId)?.boundRoot(sessionId);
    if (bound) return bound;
    // 任务会话的子代理：看它所在的任务会话；聊天会话的子代理：落到它所属的会话
    const root = this.hosts.get(botId)?.taskRootOf(sessionId);
    if (root) return this.hosts.get(botId)?.boundRoot(root);
    const conv = this.resolveConversation(botId, sessionId);
    return conv ? this.turnsInProgress.get(conv)?.folderRoot : undefined;
  }

  /** amb-zip 插件：查看 / 安全解压用户随消息发的 ZIP（attachments/zip-tools.ts）；解到可写目录之外要先问用户 */
  private zipOp(b: any, signal: AbortSignal): Promise<{ text?: string; error?: string }> {
    const attachments = this.o.attachments;
    if (!attachments) return Promise.resolve({ error: "ZIP attachments are not available here." });
    return zipTool(
      {
        attachments,
        dataDir: this.o.dataDir,
        workspace: (botId) => this.host(botId).workspace,
        // 目录 Bot 没声明写工作区：按只读（只能解到受管空间）
        permission: (botId) => {
          const ref = this.o.store.getBot(botId)?.app;
          return ref && !ref.permissions.includes("workspace-write") ? "readonly" : this.settings(botId).permission;
        },
        conversationOf: (botId, sessionId) => this.resolveConversation(botId, sessionId),
        folderOf: (botId, sessionId) => this.folderOf(botId, sessionId),
        approve: async (botId, sessionId, detail, sig) => {
          const ctx = this.askContext(botId, sessionId);
          const row = this.approvals.create({ kind: "approval", botId, conversationId: ctx.conversationId, sessionId, tool: "zip_extract", detail, reason: "", ...ctx.fields });
          return (await this.awaitRow(row.id, sig))?.status === "allowed";
        },
      },
      b,
      signal,
    );
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

/** 「不再记回」：新句子和用户删掉过的是不是同一件事 */
const SAME_FACT_SYSTEM = [
  "判断「新句子」和「已删除的」里的哪一条说的是同一件关于用户的事实（同一个事实换了说法、换了详略都算同一件；相关但不同的事不算）。",
  "只回一个编号；没有同一件就回 0。",
].join("\n");

const SENSITIVE_WORD: Record<string, string> = { address: "address", phone: "phone number", email: "email address" };

/** 关于我记一句的结果 → 给模型的那句话 */
function aboutAddText(r: BotAddResult, web: boolean): { text?: string; error?: string } {
  switch (r.kind) {
    case "added":
      return { text: `Saved to About me (shared by all of the user's bots): "${r.change.after?.text}". ${web ? "The app shows a one-line note with Undo under your reply; you need not repeat it." : "The app appends a one-line note to your reply; the user can reply 撤销/undo."}` };
    case "edited":
      return { text: `Updated About me: "${r.change.before?.text}" → "${r.change.after?.text}". ${web ? "The app shows a one-line note with Undo under your reply." : "The app appends a one-line note to your reply."}` };
    case "duplicate":
      return { text: "Already in About me; nothing changed." };
    case "off":
      return { text: "Not saved: the user has turned off \"Let bots add to this\" for About me, so it is read-only. Do not store it anywhere else; just use it in this chat." };
    case "secret":
      return { error: "Not saved: passwords, keys, tokens and codes are never stored." };
    case "idOrCard":
      return { text: "Not saved: ID and bank card numbers are never stored. Use it in this chat only, and say in a few words that you did not save it." };
    case "full":
      return { text: "Not saved: About me is full. Tell the user in one sentence that they can tidy it in Settings › About me." };
    case "perTurn":
      return { text: "Not saved: at most 3 lines per reply. Save the rest later if they still matter." };
    case "suppressed":
      return { text: "Not saved: the user removed this from About me before, so bots do not add it back on their own. Only if the user explicitly says \"remember …\" again is it saved. Use it in this chat only; do not mention the removed line." };
    case "tooLong":
      return { error: "Too long: one short sentence, at most 300 characters." };
    case "empty":
      return { error: "text is empty" };
    case "noTarget":
      return { error: r.candidates.length ? `replaces matches several lines; use a distinctive part of one: ${r.candidates.map((c) => `"${c}"`).join(", ")}` : "No About me line matches replaces. Call recall with scope me to see the lines." };
    case "sensitive":
      return { text: `Not saved yet: it is the user's ${SENSITIVE_WORD[r.proposal.category ?? "address"]}, which every bot would see, so the app shows a card under your reply (Add / Just this time). Ask in one short sentence whether to add it to About me; use it in this chat either way.` };
    case "sensitiveOnce":
      return { text: `Not saved: the user's ${SENSITIVE_WORD[r.category]} is only saved after they confirm in the app. Use it in this chat only.` };
    case "sensitiveAsked":
      return { text: "Already asked about this in this chat; do not ask again. Use it in this chat." };
    case "locked":
      if (r.asked) return { text: "You already suggested changing that line in this chat; do not suggest it again." };
      if (r.proposal) return { text: `Not changed: "${r.line.text}" was written or edited by the user, so bots cannot change it. The app shows a card under your reply (Change it / Keep it). Say in one sentence that it is their own line and ask whether to change it.` };
      return { text: `Not changed: "${r.line.text}" was written or edited by the user, so bots cannot change it from here. Tell them they can change it in the app (Settings › About me).` };
  }
}

function aboutForgetText(r: BotForgetResult, web: boolean): { text?: string; error?: string } {
  if (r.kind === "deleted") return { text: `Removed from About me: "${r.change.before?.text}". Bots will not add it back unless the user explicitly says it again. ${web ? "The app shows a one-line note with Undo under your reply." : "The app appends a one-line note to your reply."}` };
  if (r.kind === "off") return { text: "Not removed: About me is read-only for bots (the user turned off \"Let bots add to this\"). Tell the user they can delete it in Settings › About me." };
  if (r.kind === "many") return { error: `Several lines match; use a distinctive part of one: ${r.candidates.map((c) => `"${c}"`).join(", ")}` };
  return { error: "No About me line matches. Call recall with scope me to see the lines." };
}
