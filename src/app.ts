import path from "node:path";
import type { AppConfig } from "./config.js";
import { Store, type Bot } from "./store/db.js";
import { OpenAICompatClient, type ModelClient } from "./llm/client.js";
import { BotRuntime } from "./core/runtime.js";
import { KeyedQueue } from "./core/queue.js";
import type { ChannelStatus } from "./core/types.js";
import { MagpieSupervisor } from "./magpie/supervisor.js";
import { FeishuChannel } from "./channels/feishu/channel.js";
import { LarkTransport, type FeishuTransport } from "./channels/feishu/transport.js";
import { WeixinChannel } from "./channels/weixin/channel.js";
import { WeixinLogin } from "./channels/weixin/login.js";
import { startWebServer, type WebServer } from "./web/server.js";
import { logger, mask } from "./log.js";
import { AgentManager } from "./agent/manager.js";
import { locateDshRuntime } from "./agent/host.js";
import { findAppRoot } from "./magpie/supervisor.js";

const log = logger("app");

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
  web: WebServer | undefined;
  private notices: Array<{ at: number; level: "info" | "warn"; text: string }> = [];

  constructor(readonly config: AppConfig, readonly opts: AppOptions = {}) {
    this.store = new Store(path.join(config.dataDir, "anymodel.db"));
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
      approvalTtlMs: config.agent.approvalTtlMs,
      // 后台小任务（管家判定/交接/记忆整理）直接走 magpie，不经代理子进程
      complete: (model, system, user) =>
        this.models.streamChat({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], signal: AbortSignal.timeout(120_000) }, () => {}),
    });
    this.runtime = new BotRuntime({
      agent: this.agent,
      store: this.store,
      models: this.models,
      defaultModel: () => this.config.llm.defaultModel,
      contextMessages: config.llm.contextMessages,
      contextChars: config.llm.contextChars,
    });
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
    this.seedDefaultBot();
    for (const bot of this.store.listBots()) await this.startBot(bot.id);
    if (!this.opts.noWeb) this.web = await startWebServer(this);
  }

  async stop(): Promise<void> {
    await this.web?.close();
    for (const id of [...this.channels.keys()]) await this.stopBot(id);
    await this.agent.stop();
    await this.magpie?.stop();
    this.store.close();
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
    });
    log.info(`created default bot ${bot.id}`, { feishuAppId: bot.feishuAppId || "(未配置)" });
  }

  async startBot(botId: string): Promise<void> {
    const bot = this.store.getBot(botId);
    if (!bot) return;
    const ch: BotChannels = this.channels.get(botId) ?? {};
    this.channels.set(botId, ch);
    if (bot.feishuAppId && bot.feishuAppSecret && !ch.feishu) {
      const transport = this.opts.feishuTransport?.(bot) ?? new LarkTransport(bot.feishuAppId, bot.feishuAppSecret);
      ch.feishu = new FeishuChannel(bot.id, transport, this.runtime, this.queue, this.config.feishu.throttleMs);
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
        pollTimeoutMs: this.opts.weixinPollTimeoutMs,
      });
      ch.weixin.onExpired = () => this.notice("warn", `机器人「${bot.name}」微信登录已过期，请在「渠道」页重新扫码`);
      ch.weixin.start();
    }
  }

  async stopBot(botId: string): Promise<void> {
    const ch = this.channels.get(botId);
    if (!ch) return;
    ch.weixinLogin?.cancel();
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
      this.store.saveWeixinAccount({ botId, botToken: res.botToken, ilinkBotId: res.ilinkBotId, baseUrl: res.baseUrl, ownerUserId: res.userId });
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
