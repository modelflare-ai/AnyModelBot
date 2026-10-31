import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveConfigFile, type AppConfig } from "./config.js";
import { Store, type Bot } from "./store/db.js";
import { OpenAICompatClient, type ModelClient } from "./llm/client.js";
import { BotRuntime } from "./core/runtime.js";
import { KeyedQueue } from "./core/queue.js";
import { deferNotice, interruptedText, takeInterrupted, type Interrupted } from "./core/recovery.js";
import { Outbox } from "./core/outbox.js";
import { AccessControl } from "./core/access.js";
import type { ChannelStatus } from "./core/types.js";
import { MagpieSupervisor } from "./magpie/supervisor.js";
import { FeishuChannel } from "./channels/feishu/channel.js";
import { LarkTransport, type FeishuTransport } from "./channels/feishu/transport.js";
import { WeixinChannel } from "./channels/weixin/channel.js";
import { WeixinLogin } from "./channels/weixin/login.js";
import { startWebServer, type WebServer } from "./web/server.js";
import { initFileLog, logFilePath, logger, mask, registerSecret } from "./log.js";
import { AgentManager } from "./agent/manager.js";
import { normalizeSettings } from "./agent/settings.js";
import { locateDshRuntime } from "./agent/host.js";
import { pwshProbe } from "./agent/pwsh.js";
import { findAppRoot } from "./magpie/supervisor.js";
import {
  MODELFLARE_LINES,
  MODELFLARE_PROVIDER,
  bareModel,
  botProviderId,
  fetchKeyBalance,
  modelflareBaseUrl,
  modelflareIssuer,
  routeModel,
  skillHeader,
  verifyModelflareKey,
  type ModelflareLine,
  type VerifyResult,
} from "./modelflare.js";
import { AccountManager } from "./account/manager.js";
import { AccountVault, type SecretBox } from "./account/vault.js";
import { loadModelInfo, type ModelInfo } from "./account/model-info.js";
import { MediaService, pickDefault } from "./agent/media.js";
import { COMPACT_ENDPOINT, serverCompactionEnabled, type CompactEndpoint } from "./agent/server-compaction.js";
import type { BotSettings } from "./agent/settings.js";
import { TaskService } from "./tasks/service.js";
import { Attention, approvalItems, type AttentionItem } from "./tasks/attention.js";

const log = logger("app");

/** 桌面外壳（Electron 主进程）提供的能力；CLI / Docker 下为空 */
export interface DesktopHooks {
  autostart(): { supported: boolean; on: boolean };
  setAutostart(on: boolean): void;
  applyZoom(zoom: number): void;
  openDataDir(): void;
  openInBrowser(): void;
  /** 在系统浏览器里打开外部链接（Modelflare 登录、充值） */
  openExternal(url: string): void;
  /** 系统钥匙串加密（Electron safeStorage）；不可用时缺省，账户凭据改靠文件权限保护 */
  secretBox?: SecretBox;
  /** 走 Chromium 网络栈的 fetch（Electron net.fetch：系统代理、系统证书）；下载内置 PowerShell 用，缺省时用 Node 的 fetch */
  fetch?: typeof fetch;
}

export interface ModelflareStatus {
  /** managed：经内置网关连接 Modelflare；external：使用环境变量指定的端点（开发/测试），界面不做连接管理 */
  mode: "managed" | "external";
  connected: boolean;
  keyTail: string;
  line: ModelflareLine;
  baseUrl: string;
  gateway: string;
}

let cachedVersion = "";
export function appVersion(): string {
  if (!cachedVersion) {
    try {
      cachedVersion = String(JSON.parse(fs.readFileSync(path.join(findAppRoot(), "package.json"), "utf8")).version || "");
    } catch {
      cachedVersion = "";
    }
  }
  return cachedVersion;
}

export interface AppOptions {
  /** 测试注入：替换飞书传输层 */
  feishuTransport?: (bot: Bot) => FeishuTransport;
  /** 测试注入：替换 iLink 的 fetch */
  weixinFetch?: typeof fetch;
  weixinPollTimeoutMs?: number;
  /** 测试注入：替换模型客户端 */
  models?: ModelClient;
  /** 不启动 web 服务（CLI 子命令用） */
  noWeb?: boolean;
  /** 登录二维码是否打印到终端 */
  printQrToTerminal?: boolean;
  /** 写 <dataDir>/logs/app.log（默认 true） */
  fileLog?: boolean;
}

interface BotChannels {
  feishu?: FeishuChannel;
  feishuError?: string;
  weixin?: WeixinChannel;
  weixinLogin?: WeixinLogin;
}

export class App {
  readonly store: Store;
  readonly magpie: MagpieSupervisor | undefined;
  readonly models: ModelClient;
  readonly runtime: BotRuntime;
  readonly agent: AgentManager;
  readonly queue = new KeyedQueue();
  readonly channels = new Map<string, BotChannels>();
  /** 持久化的出站队列：最终回复、文件、重要通知先落库再发，重启后接着发 */
  readonly outbox: Outbox;
  /** 谁能和机器人对话：主人 + 允许名单 + 使用请求 */
  readonly access: AccessControl;
  /** 后台任务：自己的会话和文件夹，结果经出站队列回到请求它的会话 */
  readonly tasks: TaskService;
  /** "需要你"：所有机器人里在等人的事（侧栏、托盘角标、系统通知） */
  readonly attention: Attention;
  web: WebServer | undefined;
  desktop: DesktopHooks | undefined;
  /** Modelflare 账户（登录、余额、预算）；start() 时创建，桌面外壳的钥匙串那时已就绪 */
  account!: AccountManager;
  /** 故障排查页最近一次"测试模型 / 测试代理"的结果（复制诊断信息时带上） */
  lastDiagnostics: { model?: import("./diagnostics.js").ModelTestResult; agent?: import("./diagnostics.js").AgentTestResult } = {};
  private notices: Array<{ at: number; level: "info" | "warn"; text: string }> = [];
  private offPwsh: (() => void) | undefined;
  private accountTimer: NodeJS.Timeout | undefined;
  private picksTimer: NodeJS.Timeout | undefined;
  private modelInfoCache: { at: number; data: Record<string, ModelInfo> } | undefined;
  private modelInfoLoading: Promise<Record<string, ModelInfo>> | undefined;

  constructor(readonly config: AppConfig, readonly opts: AppOptions = {}) {
    // 日志文件：<dataDir>/logs/app.log（打包后的桌面版看不到 stdout，故障排查全靠它）
    if (opts.fileLog !== false) initFileLog(path.join(config.dataDir, "logs"));
    registerSecret(config.ui.token);
    registerSecret(config.magpie.externalApiKey);
    log.info(`anymodel bot ${appVersion()} starting`, {
      platform: process.platform,
      arch: process.arch,
      os: os.release(),
      electron: process.versions.electron,
      node: process.versions.node,
      pid: process.pid,
      dataDir: config.dataDir,
      gateway: config.magpie.mode,
      agent: config.agent.mode,
      log: logFilePath(),
    });
    this.store = new Store(path.join(config.dataDir, "anymodel.db"));
    this.outbox = new Outbox(this.store);
    this.access = new AccessControl(this.store, { notify: (to, text, id) => this.reach(to, text, id) });
    if (config.magpie.mode === "managed") {
      this.magpie = new MagpieSupervisor({ dataDir: config.dataDir, binPath: config.magpie.binPath || undefined });
    }
    this.models =
      opts.models ??
      new OpenAICompatClient(() =>
        this.magpie
          ? { baseUrl: this.magpie.baseUrl, apiKey: this.magpie.gatewayKey }
          : { baseUrl: config.magpie.externalBaseUrl.replace(/\/+$/, ""), apiKey: config.magpie.externalApiKey },
      );
    const upstream = () =>
      this.magpie
        ? { baseUrl: this.magpie.baseUrl, apiKey: this.magpie.gatewayKey }
        : { baseUrl: config.magpie.externalBaseUrl.replace(/\/+$/, ""), apiKey: config.magpie.externalApiKey };
    this.agent = new AgentManager({
      store: this.store,
      dataDir: config.dataDir,
      runtimeDir: config.agent.mode === "dsh" ? locateDshRuntime(findAppRoot()) : undefined,
      upstream,
      enabled: config.agent.mode === "dsh" && !opts.models,
      turnTimeoutMs: config.agent.turnTimeoutMs,
      idleTimeoutMs: config.agent.idleTimeoutMs,
      approvalTtlMs: config.agent.approvalTtlMs,
      // 上下文长度来自 Modelflare 的模型资料（和模型选择器里显示的一致）；内置兜底表跟不上新模型
      contextWindow: async (model) => (await this.infoOf(model))?.context,
      // 代理的对话接口按 Modelflare 目录选（Responses / Anthropic Messages / Chat）；外部端点只当它会 Chat
      apiInfo: async (model) => {
        if (!this.magpie) return undefined;
        const info = await this.infoOf(model);
        return info && { endpoints: info.endpoints, reasoning: info.reasoning };
      },
      // 服务端压缩：价格目录列出压缩端点只是提示，bridge 用之前会探测
      serverCompaction: {
        listed: async (model) => {
          const info = await this.infoOf(model);
          return info?.endpoints ? info.endpoints.includes(COMPACT_ENDPOINT) : undefined;
        },
        endpoint: (model) => this.compactEndpoint(model),
      },
      // 后台小任务（管家判定/交接/记忆整理）直接走 magpie，不经代理子进程
      complete: (botId, model, system, user) =>
        this.models.streamChat(
          { model: this.routeModel(botId, model), messages: [{ role: "system", content: system }, { role: "user", content: user }], signal: AbortSignal.timeout(120_000) },
          () => {},
        ),
      media: this.magpie
        ? new MediaService({
            baseUrl: () => modelflareBaseUrl(this.config.modelflare.line),
            keyFor: (botId) => this.botKey(botId),
            headers: () => this.requestHeaders(),
            workspace: (botId) => path.join(config.dataDir, "workspaces", botId),
            defaults: () => ({ image: this.config.media.imageModel, video: this.config.media.videoModel }),
            pricingUrl: () => `${modelflareIssuer()}/api/pricing`,
          })
        : undefined,
      onNotice: (text) => this.notice("warn", text),
    });
    this.attention = new Attention({ store: this.store });
    this.tasks = new TaskService({
      store: this.store,
      host: this.agent.taskHost(),
      outbox: this.outbox,
      approvals: this.agent.approvals,
      onChange: () => this.attention.kick(),
      defaultModel: () => this.config.llm.defaultModel,
      route: (botId, model) => this.routeModel(botId, model),
      maxBackground: config.agent.maxBackground,
    });
    this.agent.tasks = this.tasks;
    // "需要你"的三份：在等的提问和审批、任务（失败、没送到）、渠道（微信登录过期）
    this.attention.addSource(() => approvalItems(this.store, this.agent.approvals.pendingAll()));
    this.attention.addSource(() => this.tasks.attention());
    this.attention.addSource(() => this.loginAttention());
    this.agent.approvals.listen(() => this.attention.kick());
    this.runtime = new BotRuntime({
      agent: this.agent,
      store: this.store,
      models: this.models,
      defaultModel: () => this.config.llm.defaultModel,
      contextMessages: config.llm.contextMessages,
      contextChars: config.llm.contextChars,
      route: (botId, model) => this.routeModel(botId, model),
      access: this.access,
    });
  }

  /** 渠道登录过期了（微信 -14）："需要你"里一行，去重新扫码 */
  private loginAttention(): AttentionItem[] {
    const out: AttentionItem[] = [];
    for (const [botId, ch] of this.channels) {
      const st = ch.weixin?.status;
      if (st?.state !== "expired") continue;
      out.push({ id: `login:${botId}:weixin`, kind: "login", botId, botName: this.store.getBot(botId)?.name ?? botId, subject: "微信登录已过期", status: "", line: "", since: st.since, severity: "err", actions: ["relogin"], channel: "weixin" });
    }
    return out;
  }

  /** 主动给某个渠道的某个人发通知（使用请求、批准结果）：能发就进出站队列，返回是否已排队 */
  private reach(to: { botId: string; channel: string; peerId: string }, text: string, id: string): boolean {
    const ch = this.channels.get(to.botId);
    try {
      if (to.channel === "weixin") return !!ch?.weixin?.tell(to.peerId, text, id);
      if (to.channel === "feishu") return !!ch?.feishu?.notify(to.peerId, text, id);
    } catch (e) {
      log.warn("notify failed", { bot: to.botId, channel: to.channel, message: (e as Error).message });
    }
    return false;
  }

  /**
   * 启动后在后台拉起默认机器人的代理进程（AMB_AGENT_PREWARM=0 关闭）。第一次启动要加载上万个运行时文件，
   * 杀毒软件逐个扫描时可能要几分钟；提前做，用户发第一条消息时多半已经就绪。
   */
  async prewarmAgent(): Promise<void> {
    if (process.env.AMB_AGENT_PREWARM === "0" || this.opts.noWeb || !this.agent.available) return;
    const bot = this.store.listBots()[0];
    if (!bot) return;
    try {
      const model = bot.defaultModel || this.config.llm.defaultModel || (await this.runtime.listModels(true).catch(() => [] as string[]))[0] || "";
      if (model) this.agent.prewarm(bot.id, this.routeModel(bot.id, model));
    } catch (e) {
      log.warn("agent prewarm skipped", { message: (e as Error).message });
    }
  }

  /**
   * 服务端压缩直连的端点：内置网关不转发 /v1/responses/compact（回 404），压缩请求直接发给模型所在的 Modelflare 连接
   * （同一把 Key）。压缩后的请求仍经网关；网关要先开启 nativeCompaction，带压缩项的请求被拒时才会原样报错，
   * 而不是悄悄删掉压缩项重试（那样会丢掉之前的上下文）。外部端点模式下代理只走 Chat（见 apiInfo），不做。
   */
  private compactEndpoint(model: string): CompactEndpoint | undefined {
    if (!this.magpie) return undefined;
    // 网关里的模型名是 <provider id>/<上游模型名>；provider 必须正好是它（upstreamEndpoint 找不到时会退回共用连接）
    const i = model.indexOf("/");
    const id = i > 0 ? model.slice(0, i) : "";
    const up = id ? this.magpie.upstreamEndpoint(id) : undefined;
    if (!up || up.id !== id) return undefined;
    if (!this.magpie.nativeCompaction(up.id)) {
      void this.magpie.ensureNativeCompaction(up.id).catch((e) => log.warn("turning on native compaction failed", { provider: up.id, message: (e as Error).message }));
      return undefined;
    }
    return { baseUrl: up.baseUrl, apiKey: up.apiKey, model: model.slice(i + 1), headers: this.requestHeaders() };
  }

  /** 每个经 Modelflare 的请求都带的请求头（调用归因） */
  requestHeaders(): Record<string, string> {
    return skillHeader(appVersion());
  }

  /**
   * 发给内置网关的模型 id：限定到该机器人用的 provider——开了预算的机器人用自己的 Key，
   * 其余用共用连接。外部端点模式原样发送。
   */
  routeModel(botId: string, model: string): string {
    if (!this.magpie) return model;
    const own = botProviderId(botId);
    return routeModel(model, this.magpie.hasProvider(own) ? own : (this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER));
  }

  /**
   * 让每个 Modelflare 连接启用的模型等于 Modelflare 当前列出的全部对话模型（见 setModelPicks）：
   * 0.1.8 及以前连接的补上，新上架的加入，下架的移出。读不到列表时什么都不改，下次再试。
   * 顺带给 0.1.8 及以前的连接补上 Responses 和 Messages 地址（ensureModelflareApis）。
   */
  private async syncModelPicks(): Promise<void> {
    const magpie = this.magpie;
    if (!magpie || magpie.state !== "running") return;
    const baseUrl = modelflareBaseUrl(this.config.modelflare.line);
    const ids = [magpie.modelflareProviderId, ...magpie.botProviderIds()].filter((id): id is string => !!id);
    for (const id of ids) {
      const key = magpie.providerKey(id);
      if (!key) continue;
      try {
        await magpie.ensureModelflareApis(id);
        if (serverCompactionEnabled()) await magpie.ensureNativeCompaction(id).catch((e) => log.warn("turning on native compaction failed", { provider: id, message: (e as Error).message }));
        const r = await verifyModelflareKey(baseUrl, key, { line: this.config.modelflare.line });
        if (r.ok) await magpie.setModelPicks(id, r.chatModels);
      } catch (e) {
        log.warn("sync model picks failed", { provider: id, message: (e as Error).message });
      }
    }
  }

  /** 该机器人请求 Modelflare 用的 Key（只在本进程内使用） */
  private botKey(botId: string): string {
    if (!this.magpie) return "";
    return this.magpie.providerKey(botProviderId(botId)) || this.magpie.providerKey(this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER);
  }

  /** 账户管理器：start() 时创建；命令行向导不启动整套服务，直接调用这里 */
  ensureAccount(): AccountManager {
    this.account ??= this.createAccount();
    return this.account;
  }

  private createAccount(): AccountManager {
    const account = new AccountManager({
      issuer: modelflareIssuer(),
      vault: AccountVault.at(this.config.dataDir, this.desktop?.secretBox),
      store: this.store,
      alerts: () => ({ lowBalanceUsd: this.config.modelflare.lowBalanceUsd, push: this.config.modelflare.lowBalancePush }),
      hooks: {
        connectKey: async (key) => {
          const r = await this.connectModelflare(key, this.config.modelflare.line);
          if (!r.ok) throw new Error(r.message);
        },
        disconnect: () => this.disconnectModelflare(),
        setBotKey: async (botId, key) => {
          if (!this.magpie) throw new Error("外部模型端点模式下不管理 Modelflare 连接");
          const baseUrl = modelflareBaseUrl(this.config.modelflare.line);
          const r = await verifyModelflareKey(baseUrl, key, { line: this.config.modelflare.line });
          if (!r.ok) throw new Error(r.message);
          await this.magpie.setBotProvider(botId, key, baseUrl, this.allowedModelflareUrls(), this.requestHeaders(), r.chatModels);
        },
        removeBotKey: async (botId) => {
          await this.magpie?.removeBotProvider(botId);
        },
        keyBalance: async () => {
          const key = this.magpie?.providerKey(this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER);
          return key ? fetchKeyBalance(modelflareBaseUrl(this.config.modelflare.line), key) : undefined;
        },
        alert: (text, push) => {
          this.notice("warn", text);
          if (push) void this.pushToOwner(text);
        },
      },
    });
    account.botsSource = () => this.store.listBots().map((b) => ({ id: b.id, name: b.name, budget: b.settings.budget }));
    account.init();
    return account;
  }

  /** 提醒经机器人发给你：用第一个能发出去的渠道（微信发给扫码的人，飞书发到最近的单聊） */
  async pushToOwner(text: string): Promise<boolean> {
    for (const bot of this.store.listBots()) {
      const ch = this.channels.get(bot.id);
      try {
        if (ch?.weixin && (await ch.weixin.notifyOwner(text))) return true;
        // 飞书：发给主人；还没设主人时发到最近的单聊
        const chat = ch?.feishu ? (this.access.owner(bot.id, "feishu")?.peerId ?? this.store.listConversations(bot.id).find((c) => c.channel === "feishu" && c.kind === "dm")?.peerId) : undefined;
        if (chat && ch?.feishu?.notify(chat, text)) return true;
      } catch (e) {
        log.warn("push to owner failed", { bot: bot.id, message: (e as Error).message.slice(0, 200) });
      }
    }
    return false;
  }

  /** 开启 / 调整 / 关闭机器人预算：先改 Modelflare 上的 Key，成功后才保存设置 */
  async setBotBudget(botId: string, budget: BotSettings["budget"]): Promise<Bot> {
    const bot = this.store.getBot(botId);
    if (!bot) throw new Error("机器人不存在");
    await this.account.setBotBudget(bot.id, bot.name, budget);
    return this.store.updateBot(botId, { settings: { ...bot.settings, budget } })!;
  }

  /** 删除机器人时一并删掉它的预算 Key */
  async deleteBot(botId: string): Promise<void> {
    const bot = this.store.getBot(botId);
    this.tasks.dropBot(botId);
    await this.stopBot(botId);
    await this.agent.stopBot(botId);
    if (bot?.settings.budget.enabled && this.account.signedIn) {
      await this.account.setBotBudget(botId, bot.name, { ...bot.settings.budget, enabled: false }).catch((e) => log.warn("remove bot key failed", { message: (e as Error).message }));
    }
    this.store.deleteBot(botId);
  }

  /** 模型选择器里的能力与参考价（缓存一小时） */
  async modelInfo(force = false): Promise<Record<string, ModelInfo>> {
    if (!force && this.modelInfoCache && Date.now() - this.modelInfoCache.at < 3600_000) return this.modelInfoCache.data;
    // 同时来的几次（代理启动时上下文长度和接口一起问）共用一次加载
    this.modelInfoLoading ??= (async () => {
      const key = this.magpie?.providerKey(this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER) ?? "";
      const data = await loadModelInfo({
        baseUrl: modelflareBaseUrl(this.config.modelflare.line),
        apiKey: key,
        headers: this.requestHeaders(),
        pricingUrl: `${modelflareIssuer()}/api/pricing`,
      });
      this.modelInfoCache = { at: Date.now(), data };
      return data;
    })().finally(() => (this.modelInfoLoading = undefined));
    return this.modelInfoLoading;
  }

  /** 某个模型的资料：去掉内置网关的 provider 前缀，再试最后一段（openai/x → x） */
  private async infoOf(model: string): Promise<ModelInfo | undefined> {
    const info = await this.modelInfo();
    const bare = bareModel(model);
    return info[bare] ?? info[bare.split("/").pop() ?? bare];
  }

  notice(level: "info" | "warn", text: string): void {
    this.notices.push({ at: Date.now(), level, text });
    if (this.notices.length > 50) this.notices.shift();
    log[level](text);
  }

  get recentNotices() {
    return this.notices.slice().reverse();
  }

  async start(): Promise<void> {
    if (this.magpie) {
      try {
        await this.magpie.start();
      } catch (e) {
        this.notice("warn", `magpie 启动失败：${(e as Error).message}`);
      }
    }
    this.agent.start();
    this.ensureAccount();
    this.seedDefaultBot();
    // 上次退出或崩溃时没处理完的消息：渠道开始收新消息之前取走标记，渠道起来后告诉用户
    const interrupted = takeInterrupted(this.store);
    // 出站队列先开：渠道上线时登记发送函数，上次没发完的消息接着发
    this.outbox.start();
    for (const bot of this.store.listBots()) await this.startBot(bot.id);
    if (interrupted.length) void this.tellInterrupted(interrupted);
    // 后台任务：上次没跑完的记为中断、带着恢复说明接着做（渠道已经上线，结果能发出去）
    if (this.agent.available) this.tasks.start();
    if (!this.opts.noWeb) this.web = await startWebServer(this);
    if (this.magpie) {
      // 启动时和之后每小时核对一次启用的模型（新上架的加入，下架的移出）
      void this.syncModelPicks();
      this.picksTimer = setInterval(() => void this.syncModelPicks(), 3600_000);
      this.picksTimer.unref();
    }
    // Windows：选代理用的 PowerShell（系统里能用的 7 → 应用内置的 → 5.1），没有 7 时在后台自动装内置的；
    // 选择变了（装好了、坏了退回）就告诉用户，空闲的代理进程在后台换用新的
    if (pwshProbe.applicable) {
      pwshProbe.configure({ agent: this.agent.available, mode: this.config.agent.pwsh, fetch: () => this.desktop?.fetch });
      this.offPwsh = pwshProbe.onChange((e) => {
        if (e.notice) this.notice(e.notice.level, e.notice.text);
        if (e.kind === "path") void this.agent.refreshIdle();
      });
      void pwshProbe.check();
    }
    void this.prewarmAgent();
    if (this.magpie && !this.opts.noWeb) {
      // 余额与低余额提醒：启动后读一次，之后每 5 分钟一次
      const tick = () => {
        if (this.account.signedIn || this.magpie?.modelflareInfo().connected) void this.account.refresh();
      };
      setTimeout(tick, 3000).unref();
      this.accountTimer = setInterval(tick, 5 * 60_000);
      this.accountTimer.unref();
    }
  }

  /**
   * 重启前没处理完的消息：在原会话里说一次「没处理完，请重新发送」，不自动重发。网页对话记进会话历史；
   * 微信用存下的 context_token、占回复配额，飞书发到原单聊。现在发不出去的，等那个会话的下一条消息时先说。
   */
  async tellInterrupted(list: Interrupted[]): Promise<void> {
    for (const it of list) {
      const conv = this.store.getConversation(it.conversationId);
      if (!conv) continue;
      const text = interruptedText(it.preview);
      const ch = this.channels.get(conv.botId);
      let sent = false;
      try {
        if (conv.channel === "web") {
          this.store.addMessage(conv.id, "assistant", text);
          sent = true;
        } else if (conv.channel === "weixin" && ch?.weixin) sent = await ch.weixin.notify(conv.peerId, text);
        else if (conv.channel === "feishu" && ch?.feishu) sent = await ch.feishu.notify(conv.peerId, text);
      } catch (e) {
        log.warn("restart notice failed", { conversationId: conv.id, message: (e as Error).message.slice(0, 200) });
      }
      if (!sent) deferNotice(this.store, conv.id, text);
      log.info("message interrupted by the last exit", { conversationId: conv.id, since: it.at, told: sent ? "now" : "with the next message" });
    }
  }

  async stop(): Promise<void> {
    // 先告诉运行时：之后因为退出而失败的回合不回复、不改用纯对话，留给下次启动提醒
    this.runtime.shutdown();
    // 后台任务不再开始新的 run；跑着的留在库里，下次启动时恢复
    this.tasks.stop();
    this.attention.stop();
    this.offPwsh?.();
    if (this.accountTimer) clearInterval(this.accountTimer);
    if (this.picksTimer) clearInterval(this.picksTimer);
    this.account?.cancelLogin();
    await this.web?.close();
    // 不再开始新的发送，等正在发的结束；没发完的留在库里，下次启动接着发
    await this.outbox.stop();
    for (const id of [...this.channels.keys()]) await this.stopBot(id);
    await this.agent.stop();
    await this.magpie?.stop();
    this.store.close();
  }

  get username(): string {
    try {
      return os.userInfo().username;
    } catch {
      return "";
    }
  }

  // ---------- Modelflare ----------
  private allowedModelflareUrls(): string[] {
    return [...new Set([...Object.values(MODELFLARE_LINES), modelflareBaseUrl("auto"), modelflareBaseUrl("cn")])];
  }

  modelflareStatus(): ModelflareStatus {
    const line = this.config.modelflare.line;
    if (!this.magpie) return { mode: "external", connected: true, keyTail: "", line, baseUrl: this.config.magpie.externalBaseUrl, gateway: "external" };
    const info = this.magpie.modelflareInfo();
    return { mode: "managed", connected: info.connected, keyTail: info.keyTail, line, baseUrl: info.baseUrl || modelflareBaseUrl(line), gateway: this.magpie.state };
  }

  /** 先校验（GET /models），通过后才写入网关；失败时什么都不改 */
  async connectModelflare(apiKey: string, line: ModelflareLine): Promise<VerifyResult> {
    if (!this.magpie) throw new Error("外部模型端点模式下不管理 Modelflare 连接");
    const baseUrl = modelflareBaseUrl(line);
    const r = await verifyModelflareKey(baseUrl, apiKey.trim(), { line });
    if (!r.ok) return r;
    await this.magpie.connectModelflare(apiKey, baseUrl, this.allowedModelflareUrls(), this.requestHeaders(), r.chatModels);
    this.modelInfoCache = undefined;
    this.setModelflareLineConfig(line);
    await this.runtime.listModels(true).catch(() => []);
    // 刚连上：现在才有模型可用，把代理进程也提前拉起来（首次启动可能要几分钟）
    void this.prewarmAgent();
    return r;
  }

  async setModelflareLine(line: ModelflareLine): Promise<void> {
    if (this.magpie && this.magpie.modelflareInfo().connected) await this.magpie.setModelflareUrl(modelflareBaseUrl(line), this.allowedModelflareUrls());
    this.setModelflareLineConfig(line);
  }

  private setModelflareLineConfig(line: ModelflareLine): void {
    this.config.modelflare.line = line;
    saveConfigFile(this.config.dataDir, (f) => (f.modelflare = { ...(f.modelflare ?? {}), line }));
  }

  async disconnectModelflare(): Promise<void> {
    if (!this.magpie) throw new Error("外部模型端点模式下不管理 Modelflare 连接");
    await this.magpie.disconnectModelflare();
    await this.runtime.listModels(true).catch(() => []);
  }

  setDefaultModel(model: string): void {
    this.config.llm.defaultModel = model;
    saveConfigFile(this.config.dataDir, (f) => (f.llm = { ...(f.llm ?? {}), defaultModel: model }));
  }

  /** 默认的图片 / 视频模型；空字符串 = 自动（推荐顺序的第一个） */
  setMediaModels(patch: { imageModel?: string; videoModel?: string }): void {
    Object.assign(this.config.media, patch);
    saveConfigFile(this.config.dataDir, (f) => (f.media = { ...(f.media ?? {}), ...patch }));
  }

  /** 设置页与首次设置用：共用 Key 能用的图片 / 视频模型（按推荐顺序）与自动时会选的那个 */
  async mediaModels(): Promise<{ image: string[]; video: string[]; recommended: { image: string; video: string }; error?: string }> {
    const media = this.agent.media;
    const key = this.magpie?.providerKey(this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER) ?? "";
    const empty = { image: [], video: [], recommended: { image: "", video: "" } };
    if (!media || !key) return empty;
    try {
      const [image, video] = await Promise.all([media.available(key, "image"), media.available(key, "video")]);
      return {
        image: image.map((m) => m.id),
        video: video.map((m) => m.id),
        recommended: { image: pickDefault(image, "")?.id ?? "", video: pickDefault(video, "")?.id ?? "" },
      };
    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
  }

  private seedDefaultBot(): void {
    if (this.store.listBots().length) return;
    const bot = this.store.createBot({
      id: "default",
      name: "我的助手",
      systemPrompt: "你是一个乐于助人的中文助手，回答简洁准确。",
      feishuAppId: process.env.FEISHU_APP_ID ?? "",
      feishuAppSecret: process.env.FEISHU_APP_SECRET ?? "",
      weixinEnabled: true,
      settings: normalizeSettings({ avatar: "blue" }),
    });
    log.info(`created default bot ${bot.id}`, { feishuAppId: bot.feishuAppId || "(未配置)" });
  }

  async startBot(botId: string): Promise<void> {
    const bot = this.store.getBot(botId);
    if (!bot) return;
    registerSecret(bot.feishuAppSecret);
    registerSecret(this.store.getWeixinAccount(botId)?.botToken);
    const ch: BotChannels = this.channels.get(botId) ?? {};
    this.channels.set(botId, ch);
    if (bot.feishuAppId && bot.feishuAppSecret && !ch.feishu) {
      const transport = this.opts.feishuTransport?.(bot) ?? new LarkTransport(bot.feishuAppId, bot.feishuAppSecret);
      ch.feishu = new FeishuChannel(bot.id, transport, this.runtime, this.queue, this.config.feishu.throttleMs, this.outbox);
      // 代理自己醒来的一轮（后台命令结束）：经出站队列回复到这个会话最近收到的那条消息
      const fs = ch.feishu;
      this.runtime.registerReplier(bot.id, "feishu", (conv, handle, key) => (handle?.messageId ? { out: fs.followUp(conv.peerId, handle.messageId, key) } : undefined));
      ch.feishuError = undefined;
      ch.feishu.start().catch((e) => {
        ch.feishuError = (e as Error).message;
        this.notice("warn", `机器人「${bot.name}」飞书长连接启动失败：${ch.feishuError}`);
      });
      log.info(`bot ${bot.id}: feishu starting`, { appId: bot.feishuAppId, secret: mask(bot.feishuAppSecret) });
    }
    if (bot.weixinEnabled && !ch.weixin) {
      ch.weixin = new WeixinChannel(bot.id, this.store, this.runtime, this.queue, {
        fetchImpl: this.opts.weixinFetch,
        cdnBaseUrl: this.config.weixin.cdnBaseUrl,
        pollTimeoutMs: this.opts.weixinPollTimeoutMs,
        outbox: this.outbox,
      });
      ch.weixin.onExpired = () => {
        this.notice("warn", `机器人「${bot.name}」微信登录已过期，请在信息面板的「渠道」里重新扫码`);
        this.attention.kick();
      };
      const wx = ch.weixin;
      // 代理自己醒来的一轮：经出站队列发给这个微信用户（发送时才查 24 小时窗口和配额）
      this.runtime.registerReplier(bot.id, "weixin", (conv, _handle, key) => ({ out: wx.followUp(conv.peerId, key) }));
      ch.weixin.start();
    }
  }

  async stopBot(botId: string): Promise<void> {
    const ch = this.channels.get(botId);
    if (!ch) return;
    ch.weixinLogin?.cancel();
    this.runtime.registerReplier(botId, "feishu", undefined);
    this.runtime.registerReplier(botId, "weixin", undefined);
    await ch.feishu?.stop().catch(() => {});
    await ch.weixin?.stop().catch(() => {});
    this.channels.delete(botId);
  }

  async restartBot(botId: string): Promise<void> {
    await this.stopBot(botId);
    await this.startBot(botId);
  }

  // ---------- 微信扫码 ----------
  startWeixinLogin(botId: string): WeixinLogin {
    const ch = this.channels.get(botId) ?? {};
    this.channels.set(botId, ch);
    ch.weixinLogin?.cancel();
    const login = new WeixinLogin({
      apiBaseUrl: this.config.weixin.apiBaseUrl,
      pngPath: path.join(this.config.dataDir, "weixin", `${botId}-login-qr.png`),
      fetchImpl: this.opts.weixinFetch,
      printTerminal: this.opts.printQrToTerminal ?? true,
      pollDelayMs: this.opts.weixinFetch ? 50 : 1000,
    });
    ch.weixinLogin = login;
    void login.run().then(async (res) => {
      if (!res) return;
      // 换了一个微信扫码：原来的主人留在允许名单里（可在机器人设置里移除），不会被拦在外面
      const prevOwner = this.store.getWeixinAccount(botId)?.ownerUserId;
      this.store.saveWeixinAccount({ botId, botToken: res.botToken, ilinkBotId: res.ilinkBotId, baseUrl: res.baseUrl, ownerUserId: res.userId });
      if (prevOwner && prevOwner !== res.userId) this.access.allow(botId, "weixin", prevOwner, "previous-owner");
      // 这次拿到了扫码者：之前没拿到时第一个发消息成为主人的人，也留在允许名单里
      if (res.userId) this.access.resetOwner(botId, "weixin", { keep: true });
      const bot = this.store.getBot(botId);
      if (bot && !bot.weixinEnabled) this.store.updateBot(botId, { weixinEnabled: true });
      await ch.weixin?.stop();
      ch.weixin = undefined;
      await this.startBot(botId);
      this.notice("info", `机器人「${bot?.name ?? botId}」微信已连接`);
    });
    return login;
  }

  async weixinLogout(botId: string): Promise<void> {
    const ch = this.channels.get(botId);
    await ch?.weixin?.stop();
    if (ch) ch.weixin = undefined;
    this.store.deleteWeixinAccount(botId);
    await this.startBot(botId);
  }

  channelStatus(botId: string): { feishu: ChannelStatus; weixin: ChannelStatus & { login?: unknown; quota?: unknown } } {
    const bot = this.store.getBot(botId);
    const ch = this.channels.get(botId);
    const feishu: ChannelStatus = !bot?.feishuAppId
      ? { state: "disabled", detail: "未配置凭据", since: 0 }
      : ch?.feishuError
        ? { state: "error", detail: ch.feishuError, since: Date.now() }
        : ch?.feishu?.status ?? { state: "disabled", since: 0 };
    const acct = this.store.getWeixinAccount(botId);
    const wx = ch?.weixin?.status ?? (acct ? { state: "disabled" as const, since: 0 } : { state: "login_required" as const, detail: "尚未扫码登录", since: 0 });
    const quota = ch?.weixin
      ? this.store.listWeixinPeers(botId).map((p) => ({ userId: p.userId, remaining: ch.weixin!.quota.remaining(p.userId), windowStartedAt: p.windowStartedAt }))
      : [];
    return {
      feishu,
      weixin: {
        ...wx,
        ...(acct ? { account: { ilinkBotId: acct.ilinkBotId, pausedUntil: acct.pausedUntil } } : {}),
        login: ch?.weixinLogin?.snapshot,
        quota,
      },
    };
  }
}
