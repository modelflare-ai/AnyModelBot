import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { firstUseModel } from "./account/first-model.js";
import { CuPermissions, type CuPermissionHooks } from "./tools/computer-use/permissions.js";
import { saveConfigFile, type AppConfig, type ReasoningEffort } from "./config.js";
import { Store, type Bot, type ChannelAccount } from "./store/db.js";
import { OpenAICompatClient, type ModelClient } from "./llm/client.js";
import { BotRuntime } from "./core/runtime.js";
import { KeyedQueue } from "./core/queue.js";
import { deferNotice, interruptedText, takeInterrupted, type Interrupted } from "./core/recovery.js";
import { Outbox } from "./core/outbox.js";
import { Delivery, type DeliveryOptions } from "./delivery/index.js";
import { AccessControl } from "./core/access.js";
import { MESSENGERS, MESSENGER_LABEL, isMessenger, type ChannelStatus, type MessengerId } from "./core/types.js";
import { botForPeer, defaultBotFor } from "./core/routes.js";
import { MagpieSupervisor } from "./magpie/supervisor.js";
import { FeishuChannel } from "./channels/feishu/channel.js";
import { LarkTransport, type FeishuTransport } from "./channels/feishu/transport.js";
import { WeixinChannel } from "./channels/weixin/channel.js";
import { WeixinLogin } from "./channels/weixin/login.js";
import { MessengerChannel } from "./channels/messenger/channel.js";
import { MESSENGER_FIELDS, createTransport, telegramOffsetKey } from "./channels/messenger/index.js";
import { PlatformError, type MessengerTransport } from "./channels/messenger/transport.js";
import { startWebServer, type WebServer } from "./web/server.js";
import { initFileLog, logFilePath, logger, mask, registerSecret } from "./log.js";
import { AgentManager } from "./agent/manager.js";
import { normalizeSettings } from "./agent/settings.js";
import { locateDshRuntime } from "./agent/host.js";
import { pwshProbe } from "./tools/pwsh/index.js";
import { findAppRoot } from "./magpie/supervisor.js";
import { appVersion } from "./version.js";
import { BotCatalog } from "./botkit/catalog.js";
import { catalogConfig } from "./botkit/config.js";
import { BotInstaller } from "./botkit/installer.js";
import {
  MODELFLARE_LINES,
  MODELFLARE_PROVIDER,
  bareModel,
  botProviderId,
  modelflareBaseUrl,
  modelflareIssuer,
  routeModel,
  skillHeader,
  verifyModelflareKey,
  type ModelflareLine,
  type VerifyResult,
} from "./providers/modelflare.js";
import { OFFICIAL_PROVIDERS, officialFailure, officialModelName, officialOf, officialPicks, officialProvider, officialProviderId, type OfficialFailure, type OfficialProvider } from "./providers/official.js";
import { AccountManager } from "./account/manager.js";
import { AccountVault, type LegacySecretBox } from "./account/vault.js";
import { gatewayModelInfo, loadModelInfo, type ModelInfo, type Rates } from "./account/model-info.js";
import { loadQualitySnapshot } from "./account/model-quality.js";
import { MediaService, pickDefault } from "./tools/media/index.js";
import { SearchService, loadWebSearch, saveWebSearch, type SearchProvider, type WebSearchSettings, type WebSearchView } from "./tools/search.js";
import { ConnectionService } from "./tools/accounts/connections.js";
import { AppService } from "./tools/apps/service.js";
import { SecretsFile } from "./tools/apps/secrets.js";
import { UpdateChecker, isNewer, type DesktopUpdates } from "./updates/check.js";
import { readLocalChangelog } from "./changelog.js";
import { COMPACT_ENDPOINT, serverCompactionEnabled, type CompactEndpoint } from "./agent/server-compaction.js";
import type { BotSettings } from "./agent/settings.js";
import { UserSkills } from "./skills/service.js";
import { TaskService } from "./tasks/service.js";
import { RuleEvents } from "./tasks/rule-events.js";
import { lockDataDir, type DataDirLock } from "./store/lock.js";
import { detached, setLangPref, t, t as tr } from "./i18n/index.js";
import { Attention, approvalItems, deliveryItem, type AttentionItem } from "./tasks/attention.js";

const log = logger("app");


/** 桌面外壳（Electron 主进程）提供的能力；CLI / Docker 下为空 */
export interface DesktopHooks {
  ruleNotification?(botId: string, title: string, text: string): void;
  updates?: DesktopUpdates;
  autostart(): { supported: boolean; on: boolean };
  setAutostart(on: boolean): void;
  applyZoom(zoom: number): void;
  /** Windows 桌面版：窗口右上角的最小化 / 最大化 / 关闭由系统画在界面上，符号颜色跟界面主题（主题只存在界面里） */
  setTitleBarTheme?(dark: boolean): void;
  openDataDir(): void;
  /** 用系统的默认程序打开一个文件或文件夹（任务详情里的「打开」，3f；对话里交付的文件） */
  openPath?(p: string): void;
  /** 在系统的文件管理器里显示一个文件（选中它） */
  showItemInFolder?(p: string): void;
  openInBrowser(): void;
  /** 在系统浏览器里打开外部链接（Modelflare 登录、充值） */
  openExternal(url: string): void;
  /** 解密 0.1.30 及以前桌面版用系统钥匙串加密的账户文件（Electron safeStorage），只用于一次性迁移 */
  legacySecretBox?: LegacySecretBox;
  /** 走 Chromium 网络栈的 fetch（Electron net.fetch：系统代理、系统证书）；下载内置 PowerShell 用，缺省时用 Node 的 fetch */
  fetch?: typeof fetch;
  /** 系统给这个地址用的代理（Electron resolveProxy：系统设置和 PAC），PAC 写法，如 "PROXY 127.0.0.1:7890" 或 "DIRECT" */
  resolveProxy?(url: string): Promise<string>;
  /**
   * 桌面版注册的应用链接（anymodelbot://login-complete）：浏览器里的登录成功页用它把用户带回应用。
   * 只有桌面版有；命令行、Docker 没有，成功页就不去唤起本机可能装着的另一个客户端。
   */
  appLink?: string;
  /** macOS 桌面版：电脑操作需要的系统权限（辅助功能、屏幕录制），见 tools/computer-use/permissions.ts */
  cuPermissions?: CuPermissionHooks;
  /** 退出并重新打开应用（系统要求重启后权限才生效时；聊天、任务和输入草稿都已保存） */
  relaunch?(): void;
}

export interface ModelflareStatus {
  setupRequired?: boolean;
  keyChangeNotice?: string;
  /** managed：经内置网关连接模型；external：使用环境变量指定的端点（开发/测试），界面不做连接管理 */
  mode: "managed" | "external";
  /** 连上了 Modelflare */
  connected: boolean;
  /** 填了至少一家官方 API 的 Key：这时没有 Modelflare 也能用 */
  official: boolean;
  keyTail: string;
  line: ModelflareLine;
  baseUrl: string;
  gateway: string;
}

/** 随安装包带的语雀 MCP（vendor/yuque-mcp，scripts/vendor-yuque-mcp.mjs 生成）：打包后在 resources/yuque-mcp，开发和 Docker 里在 vendor/ */
function locateYuqueProgram(): string | undefined {
  const res = (process as any).resourcesPath as string | undefined;
  const candidates = [res ? path.join(res, "yuque-mcp", "yuque-mcp.mjs") : undefined, path.join(findAppRoot(), "vendor", "yuque-mcp", "yuque-mcp.mjs")];
  return candidates.find((p): p is string => !!p && fs.existsSync(p));
}

/** 看过哪一版的"更新了什么"（版本号） */
const WHATS_NEW_SEEN = "whatsNew.seen";

// 版本号在 version.ts（web、诊断不用为了它依赖整个 App）；这里接着导出，旧的 import 照旧能用
export { appVersion };

/** 设置页里的一家官方 API（只有 Key 尾号，不外传 Key） */
export interface OfficialView {
  id: string;
  name: string;
  region?: "cn" | "global";
  keysUrl: string;
  connected: boolean;
  keyTail: string;
  models: number;
}

export type OfficialConnectResult = { ok: true; models: string[] } | { ok: false; code: OfficialFailure; message: string };

export interface AppOptions {
  /** 测试注入：替换飞书传输层 */
  feishuTransport?: (account: { id: string; feishuAppId: string; feishuAppSecret: string; brand: "feishu" | "lark" }) => FeishuTransport;
  /** 测试用：替换 Telegram、Slack、Discord 的传输层 */
  messengerTransport?: (id: MessengerId, botId: string, credentials: Record<string, string>) => MessengerTransport;
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
  /** 测试注入：主人的时区（免打扰、续期提醒；默认本机的） */
  timeZone?: string;
  /** 测试注入：主动消息的每天上限、合并间隔（delivery/index.ts） */
  deliveryLimits?: Pick<DeliveryOptions, "dailyCap" | "coalesceMs">;
}

interface BotChannels {
  feishu?: FeishuChannel;
  feishuError?: string;
  weixin?: WeixinChannel;
  weixinLogin?: WeixinLogin;
  /** Telegram、Slack、Discord */
  messengers?: Partial<Record<MessengerId, MessengerChannel>>;
  /** 启动失败或凭据失效的原因（信息面板显示） */
  messengerErrors?: Partial<Record<MessengerId, string>>;
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
  /**
   * 主动消息的送达规则：免打扰、合并与摘要、每天上限、微信配额预留和续期提醒；没送到的进「需要你」（attentionItems）。
   * 3b / 3d 经它登记占配额的东西和之后要发的东西
   */
  readonly delivery: Delivery;
  /** 谁能和机器人对话：主人 + 允许名单 + 使用请求 */
  readonly access: AccessControl;
  /** 后台任务：自己的会话和文件夹，结果经出站队列回到请求它的会话；规则（3d）也由它跑（定时器是 tasks.scheduler） */
  readonly tasks: TaskService;
  /** 事件触发的规则的入口：以后用户配置的 workload（事件源）在这里把事件交进来（见 tasks/rule-events.ts） */
  readonly ruleEvents: RuleEvents;
  /** "需要你"：所有机器人里在等人的事（侧栏、托盘角标、系统通知） */
  readonly attention: Attention;
  /** 联网搜索（代理的 web_search）：默认免费，设置 › 网络 里可换成带 Key 的接口 */
  readonly search: SearchService;
  private webSearch: WebSearchSettings;
  /** 已授权账号：全局一份，所有机器人共用（设置 › 连接） */
  readonly connections: ConnectionService;
  /** 连接应用：内置应用连接器和自定义 MCP（tools/apps/service.ts） */
  readonly apps: AppService;
  /** 新版本提示：只有桌面版启动检查（src/updates/check.ts） */
  readonly updates: UpdateChecker;
  /** 目录 Bot：目录同步和实例（docs/bot-framework.md）。目录为空时对现有功能没有影响 */
  readonly catalog: BotCatalog;
  readonly botInstaller: BotInstaller;
  readonly userSkills: UserSkills;
  web: WebServer | undefined;
  private catalogSweep: NodeJS.Timeout | undefined;
  desktop: DesktopHooks | undefined;
  /** macOS 桌面版：电脑操作的系统权限（钩子由 Electron 主进程提供；其他运行方式一律放行） */
  readonly cuPermissions = new CuPermissions(() => this.desktop?.cuPermissions);
  /** Modelflare 账户（登录、余额、预算）；start() 时创建，桌面外壳的钩子那时已就绪 */
  account!: AccountManager;
  /** 故障排查页最近一次"测试模型 / 测试代理"的结果（复制诊断信息时带上） */
  lastDiagnostics: { model?: import("./diagnostics.js").ModelTestResult; agent?: import("./diagnostics.js").AgentTestResult } = {};
  private notices: Array<{ at: number; level: "info" | "warn"; text: string }> = [];
  private offPwsh: (() => void) | undefined;
  private accountTimer: NodeJS.Timeout | undefined;
  private picksTimer: NodeJS.Timeout | undefined;
  private modelInfoCache: { at: number; data: Record<string, ModelInfo> } | undefined;
  private modelInfoLoading: Promise<Record<string, ModelInfo>> | undefined;
  /** 各机器人预算 Key 的总额与余额（每 5 分钟随余额一起读；后台工作在剩下不到 20% 时停下，3e） */
  private botBudgetCache: { at: number; data: Record<string, { limitUsd: number; remainUsd: number }> } | undefined;
  /** 数据目录锁（命令行、Docker：同一个数据目录只能一个宿主，调度器开始之前拿） */
  private lock: DataDirLock | undefined;

  constructor(readonly config: AppConfig, readonly opts: AppOptions = {}) {
    // 应用语言（托盘菜单、后台和发到微信 / 飞书的系统消息用它；界面请求用请求自己的语言，见 src/i18n）
    setLangPref(config.ui.lang);
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
    const freshData = !fs.existsSync(path.join(config.dataDir, "anymodel.db"));
    this.store = new Store(path.join(config.dataDir, "anymodel.db"));
    this.cuPermissions.bindStore(this.store);
    // "更新了什么"：全新安装第一次启动不弹，直接记成当前版本；升级上来的（库已经在）还没有记录时弹一次这一版
    if (freshData && !this.store.getKV(WHATS_NEW_SEEN) && appVersion()) this.store.setKV(WHATS_NEW_SEEN, appVersion());
    if (!freshData) this.store.setKV("bots.initialized", "1");
    this.userSkills = new UserSkills(config.dataDir, this.store);
    this.outbox = new Outbox(this.store);
    this.delivery = new Delivery({ store: this.store, outbox: this.outbox, timeZone: opts.timeZone, ...opts.deliveryLimits });
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
    this.webSearch = loadWebSearch(this.store);
    // 桌面版搜索走 Chromium 的网络栈（系统代理、PAC、系统证书）；命令行 / Docker 用 Node 的 fetch
    this.search = new SearchService({ settings: () => this.webSearch, fetch: () => this.desktop?.fetch });
    // 连接应用的凭证放在数据库外面的一个文件里（权限 600，不用系统钥匙串，见 tools/apps/secrets.ts）；
    // 以前写在数据库里的 Notion、飞书令牌在这里搬过去，用户不用重新授权
    const secrets = SecretsFile.at(config.dataDir);
    this.connections = new ConnectionService({ kv: this.store, fetch: () => this.desktop?.fetch, secrets });
    this.apps = new AppService({ kv: this.store, secrets, connections: this.connections, fetch: () => this.desktop?.fetch, yuqueProgram: locateYuqueProgram });
    this.updates = new UpdateChecker({ current: appVersion(), fetch: () => this.desktop?.fetch });
    this.catalog = new BotCatalog({ dataDir: config.dataDir, appVersion: appVersion(), ...catalogConfig(), fetch: () => this.desktop?.fetch });
    this.botInstaller = new BotInstaller({
      dataDir: config.dataDir,
      store: this.store,
      catalog: this.catalog,
      stopAgent: (id) => this.agent.stopBot(id),
      busy: (id) => this.runtime.busyBots().includes(id) || this.tasks.busy(id),
      startBot: (id) => this.startBot(id),
    });
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
      // 桌面版：代理执行的命令用系统代理（环境里没设代理时）；命令行、Docker 只认环境变量
      systemProxy: async (url) => this.desktop?.resolveProxy?.(url),
      cuPermissions: this.cuPermissions,
      // 代理的对话接口按 Modelflare 目录选（Responses / Anthropic Messages / Chat）；外部端点只当它会 Chat
      apiInfo: async (model) => {
        if (!this.magpie) return undefined;
        const info = await this.infoOf(model);
        return info && { endpoints: info.endpoints, reasoning: info.reasoning };
      },
      effort: () => this.config.llm.reasoningEffort,
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
      mediaReady: () => !!this.magpie?.modelflareInfo().connected,
      search: this.search,
      apps: this.apps,
      onNotice: (text) => this.notice("warn", text),
    });
    this.attention = new Attention({ store: this.store });
    this.tasks = new TaskService({
      canManageAllRules: (conv) => conv.kind === "dm" && this.access.owner(conv.account || conv.botId, conv.channel)?.peerId === conv.peerId,
      canKeepAwake: () => !!this.desktop,
      onRuleResult: (botId, _id, text) => this.desktop?.ruleNotification?.(botId, this.store.getBot(botId)?.name || botId, text),
      store: this.store,
      host: this.agent.taskHost(),
      delivery: this.delivery,
      approvals: this.agent.approvals,
      onChange: () => this.attention.kick(),
      defaultModel: () => this.config.llm.defaultModel,
      route: (botId, model) => this.routeModel(botId, model),
      maxBackground: config.agent.maxBackground,
      // 规则：检查用小模型，真要发的那一句用主模型写（决定 5）
      complete: (botId, model, system, user) =>
        this.models.streamChat(
          { model: this.routeModel(botId, model), messages: [{ role: "system", content: system }, { role: "user", content: user }], signal: AbortSignal.timeout(120_000) },
          () => {},
        ),
      timeZone: opts.timeZone,
      // 花费按 Modelflare 目录的参考价估算（缓存的那份；没读过就先不算，顺手去读）
      rates: (model) => this.ratesOf(model),
      botBudget: (botId) => {
        const c = this.botBudgetCache;
        const b = c?.data[botId];
        return c && b && this.store.getBot(botId)?.settings.budget.enabled ? { ...b, at: c.at } : undefined;
      },
    });
    this.agent.tasks = this.tasks;
    this.ruleEvents = new RuleEvents(this.tasks);
    // "需要你"的五份：在等的提问和审批、任务（失败、预算）、规则（连续失败、暂停了）、没送到的结果（出站队列）、渠道（微信登录过期）
    this.attention.addSource(() => approvalItems(this.store, this.agent.approvals.pendingAll()));
    this.attention.addSource(() => this.tasks.attention());
    this.attention.addSource(() => this.tasks.ruleAttention());
    this.attention.addSource(() => this.delivery.attentionItems().map((d) => deliveryItem(d, this.store.getBot(d.botId)?.name ?? d.botId)));
    this.attention.addSource(() => this.loginAttention());
    this.agent.approvals.listen(() => this.attention.kick());
    // 出站队列的变化（结果留着等微信、发出去了、放弃了）：任务的"未送达"随之出现、消失
    this.delivery.onChange(() => this.attention.kick());
    this.runtime = new BotRuntime({
      agent: this.agent,
      store: this.store,
      models: this.models,
      defaultModel: () => this.config.llm.defaultModel,
      contextMessages: config.llm.contextMessages,
      contextChars: config.llm.contextChars,
      // 纯对话路径的推理强度：用户选了、模型资料也标了推理才带（外部端点没有模型资料，不带）
      reasoningEffort: async (model) => {
        const effort = this.config.llm.reasoningEffort;
        return effort !== "auto" && (await this.infoOf(model))?.reasoning === true ? effort : undefined;
      },
      route: (botId, model) => this.routeModel(botId, model),
      access: this.access,
      // Key 可能在 Modelflare 控制台被删了：核对一下，重新签发了就让失败的那条消息再试一次
      recoverKey: () => (this.account?.signedIn ? this.account.repairKeys(15_000) : Promise.resolve(false)),
    });
  }

  /** 渠道登录过期了（微信 -14）："需要你"里一行，去重新扫码 */
  private loginAttention(): AttentionItem[] {
    const out: AttentionItem[] = [];
    for (const [key, ch] of this.channels) {
      const st = ch.weixin?.status;
      if (st?.state !== "expired") continue;
      const subject = tr("app.weixinExpiredSubject");
      out.push({ id: `login:${key}:weixin`, kind: "login", botId: defaultBotFor(this.store, key, "weixin"), botName: this.store.getChannelAccount(key, "weixin")?.label ?? key, subject, status: "", head: subject, line: "", since: st.since, severity: "err", actions: ["relogin"], channel: "weixin" });
    }
    return out;
  }

  /** 主动给某个渠道的某个人发通知（使用请求、批准结果）：能发就进出站队列，返回是否已排队 */
  private reach(to: { botId: string; channel: string; peerId: string }, text: string, id: string): boolean {
    const ch = this.channels.get(to.botId);
    try {
      if (to.channel === "weixin") return !!ch?.weixin?.tell(to.peerId, text, id);
      if (to.channel === "feishu") return !!ch?.feishu?.notify(to.peerId, text, id);
      if (isMessenger(to.channel)) return !!ch?.messengers?.[to.channel]?.notify(to.peerId, text, id);
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
    // 官方 API 不做：压缩端点是 Modelflare 的目录列出来的，请求头也是发给 Modelflare 的
    if (!this.magpie || officialOf(model)) return undefined;
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
   * 发给内置网关的模型 id：官方 API 的模型发给那家厂商；其余限定到该机器人用的 provider——开了预算的
   * 机器人用自己的 Key，其余用共用连接。外部端点模式原样发送。
   * 选了官方 API 的模型，Key 被移除后也不换来源：改走 Modelflare 是另一份账单、另一条数据路径，不能悄悄发生，让网关报错，用户自己选。
   * 反过来，不带来源的模型名在没有 Modelflare 时可以找填了 Key 的厂商：那是直连，用的是用户自己给的 Key。
   */
  routeModel(botId: string, model: string): string {
    if (!this.magpie) return model;
    if (officialOf(model)) return model.trim();
    const name = bareModel(model.trim());
    const own = botProviderId(botId);
    const shared = this.magpie.hasProvider(own) ? own : this.magpie.modelflareProviderId;
    if (shared) return routeModel(name, shared);
    const other = this.magpie.officialProviderIds().find((id) => this.magpie!.modelPicks(id).includes(name));
    return other ? `${other}/${name}` : routeModel(model, MODELFLARE_PROVIDER);
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
    for (const p of OFFICIAL_PROVIDERS) {
      await magpie.syncOfficialPicks(p).catch((e) => log.warn("sync model picks failed", { provider: p.id, message: (e as Error).message }));
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

  /** 发往 Modelflare 账户与校验接口的请求：桌面版用系统代理，命令行 / Docker 用 Node 的 fetch（认 NODE_USE_ENV_PROXY） */
  private accountFetch: typeof fetch = (input, init) => (this.desktop?.fetch ?? fetch)(input, init);

  private createAccount(): AccountManager {
    const account = new AccountManager({
      issuer: modelflareIssuer(),
      vault: AccountVault.at(this.config.dataDir, this.desktop?.legacySecretBox),
      store: this.store,
      appLink: () => this.desktop?.appLink,
      // 桌面版走 Chromium 的网络栈（系统代理、PAC）：浏览器靠系统代理完成了授权，应用进程直连却可能连不上，
      // 换令牌时报 fetch failed。每次请求时取：desktop 在创建之后才挂上
      fetchImpl: (input, init) => this.accountFetch(input, init),
      logo: () => {
        try {
          return fs.readFileSync(path.join(findAppRoot(), "assets", "icon.png"));
        } catch {
          return undefined;
        }
      },
      alerts: () => ({ lowBalanceUsd: this.config.modelflare.lowBalanceUsd, push: this.config.modelflare.lowBalancePush }),
      hooks: {
        connectKey: async (key) => {
          const r = await this.connectModelflare(key, this.config.modelflare.line);
          if (!r.ok) throw new Error(r.message);
          this.store.deleteKV("connection.setup");
        },
        disconnect: () => this.disconnectModelflare(),
        setBotKey: async (botId, key) => {
          if (!this.magpie) throw new Error(t("app.external_mode"));
          const baseUrl = modelflareBaseUrl(this.config.modelflare.line);
          const r = await verifyModelflareKey(baseUrl, key, { line: this.config.modelflare.line });
          if (!r.ok) throw new Error(r.message);
          await this.magpie.setBotProvider(botId, key, baseUrl, this.allowedModelflareUrls(), this.requestHeaders(), r.chatModels);
        },
        removeBotKey: async (botId) => {
          await this.magpie?.removeBotProvider(botId);
        },
        sharedKeyTail: () => this.magpie?.modelflareInfo().keyTail ?? "",
        sharedKeyRejected: async () => {
          if (!this.magpie) return false;
          const key = this.magpie.providerKey(this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER);
          if (!key) return true;
          // 只认 401：连不上、限流、上游出错都不算 Key 坏了，不换
          const line = this.config.modelflare.line;
          const r = await verifyModelflareKey(modelflareBaseUrl(line), key, { line });
          return !r.ok && r.code === "invalid_key";
        },
        alert: (text, push, kind) => {
          // 低余额已在侧栏账户区常驻显示：应用内不重复提醒同一状态；其他账户提醒（授权被撤销、Key 重签）照常
          if (kind !== "low_balance") this.notice("warn", text);
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
    for (const [key, ch] of this.channels) {
      try {
        if (ch?.weixin && (await ch.weixin.notifyOwner(text))) return true;
        // 飞书：发给主人；还没设主人时发到最近的单聊
        const chat = ch?.feishu ? (this.access.owner(key, "feishu")?.peerId ?? this.store.listAccountConversations(key, "feishu").find((c) => c.kind === "dm")?.peerId) : undefined;
        if (chat && ch?.feishu?.notify(chat, text)) return true;
        // 其他平台：发给主人（连上之后第一个发消息的人）
        for (const id of MESSENGERS) {
          const owner = this.access.owner(key, id)?.peerId;
          if (owner && ch?.messengers?.[id]?.notify(owner, text)) return true;
        }
      } catch (e) {
        log.warn("push to owner failed", { account: key, message: (e as Error).message.slice(0, 200) });
      }
    }
    return false;
  }

  /** 开启 / 调整 / 关闭机器人预算：先改 Modelflare 上的 Key，成功后才保存设置 */
  async setBotBudget(botId: string, budget: BotSettings["budget"]): Promise<Bot> {
    const bot = this.store.getBot(botId);
    if (!bot) throw new Error(t("app.bot_not_found"));
    await this.account.setBotBudget(bot.id, bot.name, budget);
    const out = this.store.updateBot(botId, { settings: { ...bot.settings, budget } })!;
    // 调高了预算：留给聊天而停着的后台工作马上接着来
    void this.refreshBotBudgets();
    return out;
  }

  /**
   * 读各机器人预算 Key 的总额与余额（登录了、有机器人开着预算时）。任务服务按它决定后台工作要不要为聊天停下；
   * 读到了就告诉它（预算回来了，等着的开始）。读不到就留着上一次的。
   */
  async refreshBotBudgets(): Promise<void> {
    if (!this.account?.signedIn || !this.store.listBots().some((b) => b.settings.budget.enabled)) {
      if (this.botBudgetCache) {
        this.botBudgetCache = undefined;
        this.tasks.budgetsChanged();
      }
      return;
    }
    try {
      const keys = await this.account.botBudgets();
      const data: Record<string, { limitUsd: number; remainUsd: number }> = {};
      for (const [botId, k] of Object.entries(keys)) {
        if (k.limit_usd === null || !(k.limit_usd > 0)) continue;
        data[botId] = { limitUsd: k.limit_usd, remainUsd: k.status === "exhausted" ? 0 : Math.max(0, Number(k.remain_usd ?? k.limit_usd - k.used_usd)) };
      }
      this.botBudgetCache = { at: Date.now(), data };
      this.tasks.budgetsChanged();
    } catch (e) {
      log.warn("reading bot budgets failed", { message: (e as Error).message.slice(0, 200) });
    }
  }

  /** 估算花费用的单价：缓存的 Modelflare 目录里这个模型的（去掉内置网关的 provider 前缀，再试最后一段）；没读过就去读，这次先没有 */
  private ratesOf(model: string): Rates | undefined {
    const c = this.modelInfoCache;
    if (!c || Date.now() - c.at > 3600_000) void this.modelInfo().catch(() => undefined);
    if (!c) return undefined;
    if (officialOf(model)) return c.data[model.trim()]?.rates;
    const bare = bareModel(model);
    return (c.data[bare] ?? c.data[bare.split("/").pop() ?? bare])?.rates;
  }

  /** 删除机器人时一并删掉它的预算 Key */
  async deleteBot(botId: string, opts: { keepData?: boolean } = {}): Promise<void> {
    const bot = this.store.getBot(botId);
    this.tasks.dropBot(botId);
    // 渠道账号是全局的，不跟着机器人停：之后它们的消息交给别的机器人（core/routes.ts）
    await this.agent.stopBot(botId);
    if (bot) this.userSkills.cleanup(botId);
    if (bot?.settings.budget.enabled && this.account.signedIn) {
      await this.account.setBotBudget(botId, bot.name, { ...bot.settings.budget, enabled: false }).catch((e) => log.warn("remove bot key failed", { message: (e as Error).message }));
    }
    if (bot?.app) this.botInstaller.markRemoved(bot.app.catalogId);
    this.store.deleteBot(botId);
    // 目录 Bot 移除时不留目录，用户选了保留数据时只留工作区。用户自建的机器人行为不变
    if (bot?.origin === "catalog") this.botInstaller.cleanup(botId, !!opts.keepData);
  }

  /** 模型选择器里的能力与参考价（缓存一小时） */
  async modelInfo(force = false): Promise<Record<string, ModelInfo>> {
    if (!force && this.modelInfoCache && Date.now() - this.modelInfoCache.at < 3600_000) return this.modelInfoCache.data;
    // 同时来的几次（代理启动时上下文长度和接口一起问）共用一次加载
    this.modelInfoLoading ??= (async () => {
      const key = this.magpie?.providerKey(this.magpie.modelflareProviderId ?? MODELFLARE_PROVIDER) ?? "";
      // 只填了官方 Key 的用户和 Modelflare 没有关系：连公开价格目录也不去读（docs/privacy.md）
      const official = this.magpie?.officialProviderIds().length ?? 0;
      const data = {
        ...(key || !official
          ? await loadModelInfo({
              baseUrl: modelflareBaseUrl(this.config.modelflare.line),
              apiKey: key,
              headers: this.requestHeaders(),
              pricingUrl: `${modelflareIssuer()}/api/pricing`,
              quality: loadQualitySnapshot(),
            })
          : {}),
        ...(official ? await this.officialModelInfo() : {}),
      };
      // 网关的模型目录是启动后才同步好的：刚启动时官方 API 的模型可能还没有上下文长度，这种结果一分钟后就重读，不留一小时
      const thin = Object.entries(data).some(([id, m]) => officialOf(id) && !m.context);
      this.modelInfoCache = { at: thin ? Date.now() - 3600_000 + 60_000 : Date.now(), data };
      return data;
    })().finally(() => (this.modelInfoLoading = undefined));
    return this.modelInfoLoading;
  }

  /** 官方 API 模型的资料：网关的模型目录（不联网读）；读不到时这次先没有，选择器和代理都能没有它 */
  private async officialModelInfo(): Promise<Record<string, ModelInfo>> {
    const rows = await this.magpie!.gatewayModels().catch((e) => {
      log.warn("reading gateway models failed", { message: (e as Error).message });
      return [];
    });
    return gatewayModelInfo(rows, (id) => officialOf(id)?.api, officialModelName, loadQualitySnapshot());
  }

  /** 某个模型的资料：官方 API 的按完整 id；其余去掉内置网关的 provider 前缀，再试最后一段（openai/x → x） */
  private async infoOf(model: string): Promise<ModelInfo | undefined> {
    const info = await this.modelInfo();
    if (officialOf(model)) return info[model.trim()];
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
    // 同一个数据目录只能有一个宿主（两个调度器会把规则跑两遍、两个渠道连接抢同一个微信）：桌面版另有单实例锁
    this.lock ??= lockDataDir(this.config.dataDir);
    if (this.magpie) {
      try {
        await this.magpie.start();
      } catch (e) {
        this.notice("warn", t("app.magpie_failed", { message: (e as Error).message }));
      }
    }
    this.agent.start();
    this.cuPermissions.start((botId, pending) => this.runtime.resumePermission(botId, pending));
    this.apps.start();
    this.ensureAccount();
    await this.retirePastedKey();
    this.seedDefaultBot();
    // 上次退出或崩溃时没处理完的消息：渠道开始收新消息之前取走标记，渠道起来后告诉用户
    const interrupted = takeInterrupted(this.store);
    // 出站队列先开：渠道上线时登记发送函数，上次没发完的消息接着发
    this.outbox.start();
    this.delivery.start();
    for (const bot of this.store.listBots()) this.adoptBotChannels(bot.id);
    for (const key of new Set(this.store.listChannelAccounts().map((a) => a.key))) await this.startBot(key);
    if (interrupted.length) void this.tellInterrupted(interrupted);
    // 后台任务：上次没跑完的记为中断、带着恢复说明接着做（渠道已经上线，结果能发出去）；估算花费用的价格目录先读起来
    if (this.agent.available) {
      this.tasks.start();
      void this.modelInfo().catch(() => undefined);
    }
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
    if (this.desktop) (this.desktop.updates ?? this.updates).start();
    this.catalog.on("changed", () => {
      try {
        this.botInstaller.followAvatars();
      } catch (e) {
        log.warn("catalog avatar follow failed", { err: String(e) });
      }
      void this.botInstaller.applyTakedowns().catch((e) => log.warn("catalog takedown failed", { err: String(e) }));
    });
    this.catalog.start();
    // 用过的目录 Bot 空闲够久就退出进程，下一条消息再拉起
    this.catalogSweep = setInterval(() => void this.agent.sweepCatalogBots().catch(() => undefined), 60_000);
    this.catalogSweep.unref();
    if (this.magpie && !this.opts.noWeb) {
      // 余额与低余额提醒：启动后读一次，之后每 5 分钟一次
      const tick = () => {
        if (this.account.signedIn) void this.account.refresh();
        void this.refreshBotBudgets();
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
      const ch = this.channels.get(conv.account || conv.botId);
      let sent = false;
      try {
        if (conv.channel === "web") {
          this.store.addMessage(conv.id, "assistant", text);
          sent = true;
        } else if (conv.channel === "weixin" && ch?.weixin) sent = await ch.weixin.notify(conv.peerId, text);
        else if (conv.channel === "feishu" && ch?.feishu) sent = await ch.feishu.notify(conv.peerId, text);
        else if (isMessenger(conv.channel)) sent = !!ch?.messengers?.[conv.channel]?.notify(conv.peerId, text);
      } catch (e) {
        log.warn("restart notice failed", { conversationId: conv.id, message: (e as Error).message.slice(0, 200) });
      }
      if (!sent) deferNotice(this.store, conv.id, text);
      log.info("message interrupted by the last exit", { conversationId: conv.id, since: it.at, told: sent ? "now" : "with the next message" });
    }
  }

  async stop(): Promise<void> {
    this.cuPermissions.stop();
    this.catalog.stop();
    if (this.catalogSweep) clearInterval(this.catalogSweep);
    // 先告诉运行时：之后因为退出而失败的回合不回复、不改用纯对话，留给下次启动提醒
    this.runtime.shutdown();
    // 后台任务不再开始新的 run；跑着的留在库里，下次启动时恢复
    this.tasks.stop();
    this.attention.stop();
    this.offPwsh?.();
    this.updates.stop();
    this.desktop?.updates?.stop();
    if (this.accountTimer) clearInterval(this.accountTimer);
    if (this.picksTimer) clearInterval(this.picksTimer);
    this.account?.cancelLogin();
    await this.web?.close();
    // 不再开始新的发送，等正在发的结束；没发完的留在库里，下次启动接着发
    this.delivery.stop();
    await this.outbox.stop();
    for (const id of [...this.channels.keys()]) await this.stopBot(id);
    await this.agent.stop();
    await this.apps.stop();
    await this.magpie?.stop();
    this.store.close();
    this.lock?.release();
    this.lock = undefined;
  }

  /** 更新只能在前台对话和后台任务都空闲时重启。 */
  busyForUpdate(): boolean {
    return this.runtime.busyBots().length > 0 || !!this.web?.busy() || this.store.listRuns({ states: ["running", "settling"], limit: 1 }).length > 0;
  }

  /**
   * "更新了什么"弹窗：这一版没看过（看过的比它旧，或升级上来还没有记录）、而且更新日志里有这一版时弹一次。
   * seen：上次看过的版本，弹窗把它之后的版本都算作新内容；空 = 不知道（从没有这个功能的版本升上来），只算这一版。
   */
  whatsNew(): { show: boolean; current: string; seen: string } {
    const current = appVersion();
    const seen = this.store.getKV(WHATS_NEW_SEEN) ?? "";
    const unseen = !!current && seen !== current && (!seen || isNewer(current, seen));
    return { show: unseen && readLocalChangelog("zh-CN").some((e) => e.version === current), current, seen };
  }

  markWhatsNewSeen(): void {
    if (appVersion()) this.store.setKV(WHATS_NEW_SEEN, appVersion());
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
    if (!this.magpie) return { mode: "external", connected: true, official: false, keyTail: "", line, baseUrl: this.config.magpie.externalBaseUrl, gateway: "external" };
    const info = this.magpie.modelflareInfo();
    return { mode: "managed", connected: info.connected, official: this.magpie.officialProviderIds().length > 0, keyTail: info.keyTail, line, baseUrl: info.baseUrl || modelflareBaseUrl(line), gateway: this.magpie.state,
      setupRequired: this.store.getKV("connection.setup") === "1", keyChangeNotice: this.store.getKV("connection.notice") || "" };
  }

  // ---------- 官方 API（用户自己的 Key，src/providers/official.ts） ----------
  officialStatus(): OfficialView[] {
    return OFFICIAL_PROVIDERS.map((p) => ({ id: p.id, name: p.name, region: p.region, keysUrl: p.keysUrl, connected: false, keyTail: "", models: 0, ...this.magpie?.officialInfo(p) }));
  }

  /** 先问厂商这把 Key 能不能列出模型，通过后才写入网关；失败时什么都不改 */
  async connectOfficial(id: string, apiKey: string): Promise<OfficialConnectResult> {
    if (!this.magpie) throw new Error(t("app.external_mode"));
    const p = this.requireOfficial(id);
    const key = apiKey.trim();
    const listed = await this.magpie.listOfficialModels(p, key);
    if (!listed.ok) return { ok: false, ...officialFailure(p, listed.error, key) };
    const picks = officialPicks(listed.models);
    await this.magpie.connectOfficial(p, key, picks);
    // 保存成功后才记：换了 Key / 服务时在主界面顶部提示一次（界面只拿到一个随机提示 ID，拿不到 Key 或摘要）
    this.noteConnection(`official:${p.id}`, id, key);
    this.store.deleteKV("connection.setup");
    this.modelInfoCache = undefined;
    log.info("official API connected", { provider: p.id, models: picks.length });
    await this.runtime.listModels(true).catch(() => []);
    await this.chooseFirstModel();
    void this.prewarmAgent();
    return { ok: true, models: picks };
  }

  /** 移除一家官方 API 的 Key。默认模型指着它时清掉，不然新会话一直报"模型不存在" */
  async disconnectOfficial(id: string): Promise<void> {
    if (!this.magpie) throw new Error(t("app.external_mode"));
    const p = this.requireOfficial(id);
    await this.magpie.removeOfficial(p);
    if (officialOf(this.config.llm.defaultModel)?.id === p.id) this.setDefaultModel("");
    this.modelInfoCache = undefined;
    log.info("official API removed", { provider: p.id });
    await this.runtime.listModels(true).catch(() => []);
  }

  private requireOfficial(id: string): OfficialProvider {
    const p = officialProvider(id);
    if (!p) throw new Error(`unknown provider ${id}`);
    return p;
  }

  /**
   * 现在只能登录使用。旧版本填过 API Key、没有登录的：把 Key 从网关删掉，回到登录页并说明原因。
   * 账户文件读不出来（unavailable）时不动：那把 Key 可能是登录时签发的，换回桌面版还要用。
   */
  async retirePastedKey(): Promise<void> {
    const account = this.ensureAccount();
    if (!this.magpie || this.magpie.state !== "running" || account.status().state !== "signed_out") return;
    if (!this.magpie.modelflareInfo().connected) return;
    try {
      await this.disconnectModelflare();
      account.explainSignedOut(t("account.pasted_key_retired"));
      log.info("pasted API key retired: sign-in is now required");
    } catch (e) {
      // 这次没删掉就下次启动再试；不挡启动
      log.warn("could not retire the pasted API key", { message: (e as Error).message });
    }
  }

  /** 先校验（GET /models），通过后才写入网关；失败时什么都不改 */
  async connectModelflare(apiKey: string, line: ModelflareLine): Promise<VerifyResult> {
    if (!this.magpie) throw new Error(t("app.external_mode"));
    const baseUrl = modelflareBaseUrl(line);
    const r = await verifyModelflareKey(baseUrl, apiKey.trim(), { line, fetchImpl: this.accountFetch });
    if (!r.ok) return r;
    await this.magpie.connectModelflare(apiKey, baseUrl, this.allowedModelflareUrls(), this.requestHeaders(), r.chatModels);
    // Modelflare 账户算一种服务：重新登录、换账号签发的新设备 Key 都是同一个模型目录，不算换了服务
    this.noteConnection("modelflare", "modelflare", "account");
    this.modelInfoCache = undefined;
    this.setModelflareLineConfig(line);
    await this.runtime.listModels(true).catch(() => []);
    await this.chooseFirstModel();
    // 刚连上：现在才有模型可用，把代理进程也提前拉起来（首次启动可能要几分钟）
    void this.prewarmAgent();
    return r;
  }

  /**
   * 首次使用的默认模型（规则见 account/first-model.ts）：只在全局默认还空着、而且以前没自动选过时选一次。
   * 已有的全局、机器人、会话里的选择都不动；之后用户清空或改掉默认，也不会再被自动改回来。
   */
  async chooseFirstModel(): Promise<string> {
    if (this.config.llm.defaultModel) return this.config.llm.defaultModel;
    if (this.store.getKV("llm.firstModelChosen")) return "";
    const models = await this.runtime.listModels().catch(() => [] as string[]);
    const info = await this.modelInfo().catch(() => ({}));
    const pick = firstUseModel(models, info, this.account?.knownBalanceUsd());
    log.info("first-use model", { model: pick.model || "(none)", candidates: pick.reviewed.length, passed: pick.reviewed.filter((r) => r.passed).length });
    if (pick.model) {
      this.setDefaultModel(pick.model);
      this.store.setKV("llm.firstModelChosen", pick.model);
    }
    return pick.model;
  }

  /**
   * 记下这次接入的模型来源，判断要不要提示"已切换 Key 配置"（第 19 项）。
   * 只在"原来能用的来源被换掉"时提示：同一家换了 Key，或者以前接过的来源现在已经不在了（比如退出账户后改用自己的 Key）。
   * 在原有来源之外再加一个（自己的 Key 用户又登录了 Modelflare）不提示；第一次接入不提示；同一配置关掉过的不再提示。
   * 只存 HMAC（本机随机盐），不存 Key；界面只拿到随机提示 ID。
   */
  private noteConnection(source: string, scope: string, secret: string): void {
    const salt = this.store.getKV("connection.salt") || crypto.randomBytes(32).toString("hex");
    this.store.setKV("connection.salt", salt);
    const fp = crypto.createHmac("sha256", salt).update(scope).update("\n").update(secret).digest("hex");
    const previousFp = this.store.getKV(`connection.fingerprint.${scope}`);
    const live = new Set<string>([...(this.magpie?.officialProviderIds() ?? []).map((id) => `official:${id}`), ...(this.magpie?.modelflareInfo().connected ? ["modelflare"] : [])]);
    let had: string[] = [];
    try {
      had = JSON.parse(this.store.getKV("connection.sources") || "[]");
    } catch {
      had = [];
    }
    const replacedKey = !!previousFp && previousFp !== fp;
    const lostSource = had.some((x) => x !== source && !live.has(x));
    const dismissed = this.store.getKV("connection.notice.dismissed") === fp;
    if ((replacedKey || lostSource) && !dismissed && this.store.listBots().length > 0) {
      this.store.setKV("connection.notice", crypto.randomUUID());
      this.store.setKV("connection.notice.fp", fp);
    }
    this.store.setKV(`connection.fingerprint.${scope}`, fp);
    this.store.setKV("connection.sources", JSON.stringify([...live, source].filter((x, i, a) => a.indexOf(x) === i)));
  }

  /** 关掉"已切换 Key 配置"的提示：这个配置以后不再提示 */
  dismissKeyChangeNotice(): void {
    const fp = this.store.getKV("connection.notice.fp");
    if (fp) this.store.setKV("connection.notice.dismissed", fp);
    this.store.deleteKV("connection.notice");
    this.store.deleteKV("connection.notice.fp");
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
    if (!this.magpie) throw new Error(t("app.external_mode"));
    await this.magpie.disconnectModelflare();
    await this.runtime.listModels(true).catch(() => []);
  }

  setDefaultModel(model: string): void {
    this.config.llm.defaultModel = model;
    saveConfigFile(this.config.dataDir, (f) => (f.llm = { ...(f.llm ?? {}), defaultModel: model }));
  }

  setReasoningEffort(effort: ReasoningEffort): void {
    this.config.llm.reasoningEffort = effort;
    saveConfigFile(this.config.dataDir, (f) => (f.llm = { ...(f.llm ?? {}), reasoningEffort: effort }));
  }

  /** 联网搜索设置（设置 › 网络）：Key 只给末 4 位 */
  webSearchView(): WebSearchView {
    return this.search.view();
  }

  /** 改联网搜索（已校验）：provider 换接口，各接口的 Key 分开留着；key 存给当前接口，空 = 删掉；url 是 SearXNG 地址 */
  setWebSearch(patch: { provider?: SearchProvider; key?: string; url?: string }): WebSearchView {
    const next: WebSearchSettings = { ...this.webSearch, keys: { ...this.webSearch.keys } };
    if (patch.provider) next.provider = patch.provider;
    const p = next.provider;
    if (patch.key !== undefined && p !== "auto" && p !== "searxng") {
      if (patch.key) next.keys[p] = patch.key;
      else delete next.keys[p];
    }
    if (patch.url !== undefined) next.url = patch.url;
    saveWebSearch(this.store, next);
    this.webSearch = next;
    log.info("web search settings changed", { provider: p, key: p !== "auto" && p !== "searxng" && !!next.keys[p], url: !!next.url });
    return this.search.view();
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
    if (this.store.listBots().length || this.store.getKV("bots.initialized")) return;
    this.store.setKV("bots.initialized", "1");
    const bot = this.store.createBot({
      id: "default",
      name: t("app.default_bot_name"),
      systemPrompt: t("app.default_bot_prompt"),
      feishuAppId: process.env.FEISHU_APP_ID ?? "",
      feishuAppSecret: process.env.FEISHU_APP_SECRET ?? "",
      weixinEnabled: true,
      settings: normalizeSettings({ avatar: "blue" }),
    });
    log.info(`created default bot ${bot.id}`, { feishuAppId: bot.feishuAppId || "(未配置)" });
  }

  /**
   * 旧版把渠道存在机器人身上：第一次见到就变成全局账号。key 沿用机器人 id，登录态、配额、名单、队列的数据都不用搬，
   * 默认回复的还是原来的机器人（core/routes.ts）。飞书凭据搬进账号后清掉机器人上的，移除账号后不会又变回来。
   */
  private adoptBotChannels(botId: string): void {
    const bot = this.store.getBot(botId);
    if (!bot) return;
    if (bot.feishuAppId) {
      const cur = this.store.getChannelAccount(botId, "feishu");
      this.store.saveChannelAccount({
        key: botId,
        channel: "feishu",
        label: cur?.label ?? this.freeChannelLabel("feishu", bot.name),
        defaultBot: cur?.defaultBot ?? botId,
        enabled: cur?.enabled ?? true,
        credentials: { appId: bot.feishuAppId, appSecret: bot.feishuAppSecret },
        createdAt: cur?.createdAt ?? Date.now(),
      });
      this.store.updateBot(botId, { feishuAppId: "", feishuAppSecret: "" });
    }
    if (this.store.getWeixinAccount(botId)) this.ensureChannelAccount(botId, "weixin", bot.name, bot.weixinEnabled);
    for (const id of MESSENGERS) if (this.store.getMessengerAccount(botId, id)) this.ensureChannelAccount(botId, id, bot.name);
  }

  /** 新账号的默认名字：同一个渠道里不重复，也不能全是数字（用户说名字时要能选到唯一一个） */
  private freeChannelLabel(channel: string, wanted: string): string {
    const raw = wanted.trim().slice(0, 76);
    const fallback = channel === "weixin" ? t("app.weixin_account_name") : channel === "feishu" ? t("app.feishu_account_name") : (MESSENGER_LABEL[channel as MessengerId] ?? channel);
    const base = !raw || /^\d+$/.test(raw) ? fallback : raw;
    const taken = new Set(this.store.listChannelAccounts(channel).map((a) => a.label.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  }

  private ensureChannelAccount(key: string, channel: string, label: string, enabled = true): ChannelAccount {
    const cur = this.store.getChannelAccount(key, channel);
    if (cur) return cur;
    const account: ChannelAccount = { key, channel, label: this.freeChannelLabel(channel, label), defaultBot: defaultBotFor(this.store, key, channel), enabled, credentials: {}, createdAt: Date.now() };
    this.store.saveChannelAccount(account);
    return account;
  }

  /** 启动一个 key 下的所有渠道账号（升级前同一个 key 可能有好几个渠道） */
  async startBot(key: string): Promise<void> {
    this.adoptBotChannels(key);
    const ch: BotChannels = this.channels.get(key) ?? {};
    this.channels.set(key, ch);
    const route = (channel: string) => (peer: string) => botForPeer(this.store, key, channel, peer);
    const nameOf = (channel: string) => this.store.getChannelAccount(key, channel)?.label ?? key;

    const fsAccount = this.store.getChannelAccount(key, "feishu");
    const { appId, appSecret } = fsAccount?.credentials ?? {};
    if (fsAccount?.enabled && appId && appSecret && !ch.feishu) {
      registerSecret(appSecret);
      const brand = fsAccount.credentials.brand === "lark" ? "lark" : "feishu";
      const transport = this.opts.feishuTransport?.({ id: key, feishuAppId: appId, feishuAppSecret: appSecret, brand }) ?? new LarkTransport(appId, appSecret, brand);
      ch.feishu = new FeishuChannel(key, transport, this.runtime, this.queue, this.config.feishu.throttleMs, this.outbox, this.store);
      ch.feishu.delivery = this.delivery;
      ch.feishu.route = route("feishu");
      // 读不了飞书的历史消息：离线时发来的补不上，提示一次
      ch.feishu.onHistoryDenied = () => this.notice("warn", t("app.feishu_history_denied", { name: nameOf("feishu") }));
      // 代理自己醒来的一轮（后台命令结束）：经出站队列回复到这个会话最近收到的那条消息
      const fs = ch.feishu;
      this.runtime.registerReplier(key, "feishu", (conv, handle, wakeKey) => (handle?.messageId ? { out: fs.followUp(conv.peerId, handle.messageId, wakeKey, conv.botId) } : undefined));
      ch.feishuError = undefined;
      const feishu = ch.feishu;
      detached(() => feishu.start()).catch((e) => {
        ch.feishuError = (e as Error).message;
        this.notice("warn", t("app.feishu_failed", { name: nameOf("feishu"), message: ch.feishuError }));
      });
      log.info(`account ${key}: feishu starting`, { appId, secret: mask(appSecret) });
    }

    registerSecret(this.store.getWeixinAccount(key)?.botToken);
    if (this.store.getChannelAccount(key, "weixin")?.enabled && !ch.weixin) {
      ch.weixin = new WeixinChannel(key, this.store, this.runtime, this.queue, {
        fetchImpl: this.opts.weixinFetch,
        cdnBaseUrl: this.config.weixin.cdnBaseUrl,
        pollTimeoutMs: this.opts.weixinPollTimeoutMs,
        outbox: this.outbox,
        delivery: this.delivery,
      });
      ch.weixin.route = route("weixin");
      ch.weixin.onExpired = () => {
        this.notice("warn", t("app.weixin_expired", { name: nameOf("weixin") }));
        this.attention.kick();
      };
      const wx = ch.weixin;
      // 代理自己醒来的一轮：经出站队列发给这个微信用户（发送时才查 24 小时窗口和配额）
      this.runtime.registerReplier(key, "weixin", (conv, _handle, wakeKey) => ({ out: wx.followUp(conv.peerId, wakeKey, conv.botId) }));
      detached(() => wx.start());
    }
    for (const id of MESSENGERS) this.startMessenger(key, id, ch);
  }

  /** 填了凭据、还没在跑的平台：连上 */
  private startMessenger(key: string, id: MessengerId, ch: BotChannels): void {
    const acct = this.store.getMessengerAccount(key, id);
    if (!acct || ch.messengers?.[id] || this.store.getChannelAccount(key, id)?.enabled === false) return;
    for (const secret of Object.values(acct.credentials)) registerSecret(secret);
    const transport = this.opts.messengerTransport?.(id, key, acct.credentials) ?? createTransport(id, key, acct.credentials, this.store);
    const channel = new MessengerChannel(key, transport, this.runtime, this.queue, this.outbox);
    channel.delivery = this.delivery;
    channel.route = (peer) => botForPeer(this.store, key, id, peer);
    channel.onFatal = (detail) => {
      (ch.messengerErrors ??= {})[id] = detail;
      this.notice("warn", t("app.messenger_failed", { name: this.store.getChannelAccount(key, id)?.label ?? key, channel: MESSENGER_LABEL[id], message: detail }));
    };
    (ch.messengers ??= {})[id] = channel;
    if (ch.messengerErrors) delete ch.messengerErrors[id];
    // 代理自己醒来的一轮（后台命令结束）：经出站队列发到这个会话
    this.runtime.registerReplier(key, id, (conv, _handle, wakeKey) => ({ out: channel.followUp(conv.peerId, wakeKey, conv.botId) }));
    detached(() => channel.start()).catch((e) => channel.onFatal?.((e as Error).message));
    log.info(`account ${key}: ${id} starting`);
  }

  private async stopMessenger(key: string, id: MessengerId): Promise<void> {
    const ch = this.channels.get(key);
    this.runtime.registerReplier(key, id, undefined);
    await ch?.messengers?.[id]?.stop().catch(() => {});
    if (ch?.messengers) delete ch.messengers[id];
    if (ch?.messengerErrors) delete ch.messengerErrors[id];
  }

  /**
   * 连接（或改凭据）：留空的凭据沿用已保存的。凭据被平台拒绝就报错、不保存；一时连不上平台照样保存，渠道自己会重试。
   * 换了一个机器人（凭据变了）：主人对不上了，连上后第一个发消息的人成为主人；Telegram 的收取位置也作废。
   */
  async connectMessenger(key: string, id: MessengerId, input: Record<string, unknown>): Promise<void> {
    const old = this.store.getMessengerAccount(key, id);
    const credentials: Record<string, string> = {};
    for (const field of MESSENGER_FIELDS[id]) {
      credentials[field] = String(input[field] ?? "").trim() || (old?.credentials[field] ?? "");
      if (!credentials[field]) throw new PlatformError(t("channel.messengerMissing", { channel: MESSENGER_LABEL[id] }), true);
    }
    const transport = this.opts.messengerTransport?.(id, key, credentials) ?? createTransport(id, key, credentials, this.store);
    let name = old?.name ?? "";
    try {
      name = (await transport.verify?.())?.name ?? name;
    } catch (e) {
      if ((e as PlatformError).rejected) throw e;
      log.warn("couldn't verify the credentials now, saving anyway", { channel: id, message: (e as Error).message.slice(0, 200) });
    }
    const changed = MESSENGER_FIELDS[id].some((f) => f !== "appToken" && credentials[f] !== old?.credentials[f]);
    await this.stopMessenger(key, id);
    if (changed) {
      this.access.resetOwner(key, id);
      if (id === "telegram") this.store.deleteKV(telegramOffsetKey(key));
    }
    this.store.saveMessengerAccount({ botId: key, channel: id, credentials, name });
    this.ensureChannelAccount(key, id, name || MESSENGER_LABEL[id]);
    await this.startBot(key);
  }

  async disconnectMessenger(key: string, id: MessengerId): Promise<void> {
    await this.stopMessenger(key, id);
    this.access.resetOwner(key, id);
    this.store.deleteMessengerAccount(key, id);
    this.store.deleteChannelAccount(key, id);
    if (id === "telegram") this.store.deleteKV(telegramOffsetKey(key));
  }

  /** 连接（或改凭据）飞书应用：Secret 留空沿用已保存的；App ID 留空就是移除。换了应用：单聊会话都是新的，连上后第一个发消息的人成为主人 */
  async connectFeishu(key: string, appId: string, appSecret: string, brand?: "feishu" | "lark"): Promise<void> {
    if (!appId) return this.removeFeishu(key);
    const cur = this.store.getChannelAccount(key, "feishu");
    const same = appId === cur?.credentials.appId;
    if (!same) this.access.resetOwner(key, "feishu");
    const base = this.ensureChannelAccount(key, "feishu", t("app.feishu_account_name"));
    const lark = (brand ?? (same ? cur?.credentials.brand : undefined)) === "lark";
    this.store.saveChannelAccount({ ...base, credentials: { appId, appSecret: appSecret || cur?.credentials.appSecret || "", ...(lark ? { brand: "lark" } : {}) } });
    await this.stopFeishu(key);
    await this.startBot(key);
  }

  private async stopFeishu(key: string): Promise<void> {
    const ch = this.channels.get(key);
    this.runtime.registerReplier(key, "feishu", undefined);
    await ch?.feishu?.stop().catch(() => {});
    if (ch) {
      ch.feishu = undefined;
      ch.feishuError = undefined;
    }
  }

  private async removeFeishu(key: string): Promise<void> {
    await this.stopFeishu(key);
    this.access.resetOwner(key, "feishu");
    this.store.deleteChannelAccount(key, "feishu");
  }

  /** 全局渠道账号的列表（设置 › 连接）：别名、默认机器人、状态。序号按渠道数，和用户说的「第二个微信」一致 */
  channelAccounts() {
    const seen: Record<string, number> = {};
    return this.store.listChannelAccounts().map((a) => {
      seen[a.channel] = (seen[a.channel] ?? 0) + 1;
      const status = this.channelStatus(a.key) as unknown as Record<string, ChannelStatus>;
      return {
        key: a.key,
        channel: a.channel,
        number: seen[a.channel],
        label: a.label,
        defaultBot: defaultBotFor(this.store, a.key, a.channel),
        enabled: a.enabled,
        status: status[a.channel],
        requests: this.store.listAccess({ botId: a.key, channel: a.channel, status: "pending" }).length,
        // 还没有主人：连上之后第一个发单聊消息的人成为主人，界面据此提示"等第一条消息"
        hasOwner: !!this.access.owner(a.key, a.channel),
      };
    });
  }

  /** 改别名、默认机器人、开关。别名在同一个渠道里不能重复，也不能全是数字 */
  async updateChannelAccount(key: string, channel: string, patch: { label?: string; defaultBot?: string; enabled?: boolean }): Promise<"ok" | "missing" | "invalid" | "taken" | "no-bot"> {
    const cur = this.store.getChannelAccount(key, channel);
    if (!cur) return "missing";
    const next = { ...cur };
    if (patch.label !== undefined) {
      const name = patch.label.trim().slice(0, 80);
      if (!name || /^\d+$/.test(name)) return "invalid";
      if (this.store.listChannelAccounts(channel).some((a) => a.key !== key && a.label.toLowerCase() === name.toLowerCase())) return "taken";
      next.label = name;
    }
    if (patch.defaultBot !== undefined) {
      if (!this.store.getBot(patch.defaultBot)) return "no-bot";
      next.defaultBot = patch.defaultBot;
    }
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    this.store.saveChannelAccount(next);
    if (patch.enabled !== undefined && patch.enabled !== cur.enabled) await this.restartBot(key);
    return "ok";
  }

  /** 移除一个渠道账号：退出登录，删掉它的凭据和名单 */
  async removeChannelAccount(key: string, channel: string): Promise<void> {
    if (channel === "feishu") await this.removeFeishu(key);
    else if (channel === "weixin") await this.weixinLogout(key);
    else if (isMessenger(channel)) await this.disconnectMessenger(key, channel);
    for (const e of this.store.listAccess({ botId: key, channel })) this.access.remove(e.id);
  }

  /** 设置页的一行：状态、平台上的名字、已保存凭据的掩码（界面显示"留空不修改"） */
  private messengerStatus(key: string, id: MessengerId): ChannelStatus & { account?: { name: string; saved: Record<string, string> } } {
    const acct = this.store.getMessengerAccount(key, id);
    if (!acct) return { state: "disabled", since: 0 };
    const ch = this.channels.get(key);
    const error = ch?.messengerErrors?.[id];
    const st: ChannelStatus = error ? { state: "error", detail: error, since: Date.now() } : ch?.messengers?.[id]?.status ?? { state: "disabled", since: 0 };
    return { ...st, account: { name: acct.name, saved: Object.fromEntries(Object.entries(acct.credentials).map(([k, v]) => [k, mask(v)])) } };
  }

  async stopBot(key: string): Promise<void> {
    const ch = this.channels.get(key);
    if (!ch) return;
    ch.weixinLogin?.cancel();
    this.runtime.registerReplier(key, "feishu", undefined);
    this.runtime.registerReplier(key, "weixin", undefined);
    for (const id of MESSENGERS) await this.stopMessenger(key, id);
    await ch.feishu?.stop().catch(() => {});
    await ch.weixin?.stop().catch(() => {});
    this.channels.delete(key);
  }

  async restartBot(key: string): Promise<void> {
    await this.stopBot(key);
    await this.startBot(key);
  }

  // ---------- 微信扫码 ----------
  startWeixinLogin(key: string): WeixinLogin {
    const ch = this.channels.get(key) ?? {};
    this.channels.set(key, ch);
    ch.weixinLogin?.cancel();
    const login = new WeixinLogin({
      apiBaseUrl: this.config.weixin.apiBaseUrl,
      pngPath: path.join(this.config.dataDir, "weixin", `${key}-login-qr.png`),
      fetchImpl: this.opts.weixinFetch,
      printTerminal: this.opts.printQrToTerminal ?? true,
      pollDelayMs: this.opts.weixinFetch ? 50 : 1000,
    });
    ch.weixinLogin = login;
    void login.run().then(async (res) => {
      if (!res) return;
      // 换了一个微信扫码：原来的主人留在允许名单里（可以移除），不会被拦在外面
      const prevOwner = this.store.getWeixinAccount(key)?.ownerUserId;
      this.store.saveWeixinAccount({ botId: key, botToken: res.botToken, ilinkBotId: res.ilinkBotId, baseUrl: res.baseUrl, ownerUserId: res.userId });
      if (prevOwner && prevOwner !== res.userId) this.access.allow(key, "weixin", prevOwner, "previous-owner");
      // 这次拿到了扫码者：之前没拿到时第一个发消息成为主人的人，也留在允许名单里
      if (res.userId) this.access.resetOwner(key, "weixin", { keep: true });
      const account = this.ensureChannelAccount(key, "weixin", t("app.weixin_account_name"));
      if (!account.enabled) this.store.saveChannelAccount({ ...account, enabled: true });
      await ch.weixin?.stop();
      ch.weixin = undefined;
      await this.startBot(key);
      this.notice("info", t("app.weixin_connected", { name: account.label }));
    });
    return login;
  }

  async weixinLogout(key: string): Promise<void> {
    const ch = this.channels.get(key);
    await ch?.weixin?.stop();
    if (ch) ch.weixin = undefined;
    this.runtime.registerReplier(key, "weixin", undefined);
    this.store.deleteWeixinAccount(key);
    this.store.deleteChannelAccount(key, "weixin");
  }

  channelStatus(key: string): { feishu: ChannelStatus; weixin: ChannelStatus & { login?: unknown; quota?: unknown } } & Record<MessengerId, ChannelStatus> {
    const ch = this.channels.get(key);
    const fsAccount = this.store.getChannelAccount(key, "feishu");
    const feishu: ChannelStatus & { account?: { appId: string; brand: string; saved: { appSecret: string } } } = !fsAccount?.credentials.appId
      ? { state: "disabled", detail: t("channel.feishu_no_credentials"), since: 0 }
      : ch?.feishuError
        ? { state: "error", detail: ch.feishuError, since: Date.now() }
        : ch?.feishu?.status ?? { state: "disabled", since: 0 };
    if (fsAccount?.credentials.appId) feishu.account = { appId: fsAccount.credentials.appId, brand: fsAccount.credentials.brand === "lark" ? "lark" : "feishu", saved: { appSecret: mask(fsAccount.credentials.appSecret) } };
    const acct = this.store.getWeixinAccount(key);
    const wx = ch?.weixin?.status ?? (acct ? { state: "disabled" as const, since: 0 } : { state: "login_required" as const, detail: t("channel.wx_login_required"), since: 0 });
    const quota = ch?.weixin
      ? this.store.listWeixinPeers(key).map((p) => ({ userId: p.userId, remaining: ch.weixin!.quota.remaining(p.userId), windowStartedAt: p.windowStartedAt }))
      : [];
    return {
      feishu,
      weixin: {
        ...wx,
        ...(acct ? { account: { ilinkBotId: acct.ilinkBotId, pausedUntil: acct.pausedUntil } } : {}),
        login: ch?.weixinLogin?.snapshot,
        quota,
      },
      telegram: this.messengerStatus(key, "telegram"),
      slack: this.messengerStatus(key, "slack"),
      discord: this.messengerStatus(key, "discord"),
    };
  }
}
