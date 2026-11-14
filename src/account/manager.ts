/**
 * Modelflare 账户：登录 / 退出、本机设备 Key、余额与低余额提醒、每个机器人的预算 Key、
 * 用量 / 通知 / 邀请、Key 的性价比（路由策略）。只用 API Key 连接（没有登录账户）时，余额改从 credit_grants 读，
 * 依赖账户授权的功能（用量、通知、邀请、机器人预算、性价比）不可用。
 */
import os from "node:os";
import crypto from "node:crypto";
import { logger } from "../log.js";
import { t } from "../i18n/index.js";
import type { Store } from "../store/db.js";
import { MODELFLARE_CLIENT_ID, MODELFLARE_SCOPES, MODELFLARE_WEB, UTM, webUrl } from "../providers/modelflare.js";
import { discover, OAuthError, revokeToken, startLogin, type LoginAttempt, type OidcEndpoints } from "./oauth.js";
import { AccountRevokedError, AccountSession, ApiError, ROUTING_STRATEGIES, type AppKey, type ConnectedAccount, type RoutingStrategy, type UsageRow } from "./client.js";
import type { AccountRecord, AccountVault } from "./vault.js";

import { accountProfile } from "./profile.js";

const log = logger("account");

export interface AccountHooks {
  /** 把签发的 Key 接到内置网关（先校验再写入） */
  connectKey(key: string): Promise<void>;
  /** 从内置网关删除 Modelflare 连接与全部机器人 provider */
  disconnect(): Promise<void>;
  setBotKey(botId: string, key: string): Promise<void>;
  removeBotKey(botId: string): Promise<void>;
  /** 内置网关共用连接当前那把 Key 的最后 4 位；没连接时为空 */
  sharedKeyTail(): string;
  /** 共用连接的 Key 已经不能用：没连接，或 Modelflare 说这把 Key 无效 */
  sharedKeyRejected(): Promise<boolean>;
  /**
   * 提醒：写入应用通知；push = 同时经机器人发到你的微信 / 飞书。
   * kind = low_balance：侧栏账户区已经常驻显示"余额较低 + 充值"，应用内不再另弹同一状态的通知，只按设置推送。
   */
  alert(text: string, push: boolean, kind?: "low_balance"): void;
}

export interface AlertSettings {
  /** 余额低于它（美元）时提醒；0 = 不提醒 */
  lowBalanceUsd: number;
  /** 同时经机器人推送到微信 / 飞书 */
  push: boolean;
}

export interface BotBudget {
  enabled: boolean;
  limitUsd: number;
}

export interface BotQuota {
  balanceUsd: number;
  remainingPercent: number;
}

/** 读接口里的 bot 字段：不是对象、缺数或数不对时当作没有（界面退回只显示余额）；百分比夹到 0–100 的整数 */
export function botQuota(v: unknown): BotQuota | null {
  if (!v || typeof v !== "object") return null;
  const { balance_usd: bal, remaining_percent: pct } = v as Record<string, unknown>;
  if (typeof bal !== "number" || !Number.isFinite(bal) || typeof pct !== "number" || !Number.isFinite(pct)) return null;
  return { balanceUsd: bal, remainingPercent: Math.min(100, Math.max(0, Math.floor(pct))) };
}

export type AccountState = "signed_out" | "signing_in" | "signed_in" | "unavailable";

export interface AccountStatus {
  state: AccountState;
  /** 账户名称（登录后） */
  name: string;
  avatar?: string;
  email?: string;
  profileReady?: boolean;
  profileUrl?: string;
  /** 余额来源：account = 登录账户；key = 只用 API Key；none = 未连接 */
  source: "account" | "none";
  balanceUsd: number | null;
  /**
   * bot 额度（只能在 AnyModelBot 里用，本机签发的 Key 先扣它）：balanceUsd 是金额，remainingPercent 是相对最近一次发放的
   * 剩余百分比（0–100 的整数）。没有 bot 额度、企业托管成员、服务端还没有这个字段、读取失败时为 null，界面照旧只显示余额。
   */
  bot: BotQuota | null;
  usedUsd: number | null;
  billedToEnterprise: boolean;
  updatedAt: number;
  error: string;
  loginUrl: string;
  alerts: AlertSettings;
  lowBalance: boolean;
  /** Key 的性价比：supported = Modelflare 认这个设置（回显过 routing_strategy），否则界面不显示这个控件 */
  keyQuality: { strategy: RoutingStrategy; supported: boolean };
  /**
   * 充值页地址：登录时拿到了账户标识就放在 # 后面（#amb_account=…），Modelflare 网页据此核对浏览器里登录的是不是同一个账户，
   * 不一致时提示切换。# 后面的内容不会发给服务器、CDN 或统计；没有标识时就是普通的充值页。
   */
  topupUrl: string;
}

/**
 * 性价比（路由策略）的本机记录，存在 KV 的 account.routing 里：
 * chosen：现在的策略（在应用里选的，或从 Modelflare 上本机 Key 读回来的；都没有时按 DEFAULT_ROUTING）；
 * support：Modelflare 认不认这个字段（yes = 回显了，no = 拒绝或忽略），checkedAt：上次判断的时间（no 隔一天再试一次）；
 * applied：已经应用到本机全部 Key 的策略；migrated：老 Key 的一次性迁移做过了。
 */
interface RoutingState {
  chosen?: RoutingStrategy;
  support?: "yes" | "no";
  checkedAt?: number;
  applied?: RoutingStrategy;
  migrated?: boolean;
}

export const DEFAULT_ROUTING: RoutingStrategy = "balanced";
/** Modelflare 不认这个字段时，隔多久再试一次（服务端可能已经加上了） */
const ROUTING_RETRY_MS = 24 * 3600_000;
/**
 * 老 Key 的一次性迁移：Modelflare 加上这个字段之前签发的 Key 默认是稳定优先。只把「稳定优先、而且签发于这之前」的
 * 本机 Key 改成均衡；之后的 stable 是用户自己选的，别的值也是后来改的，都不动（Modelflare 后端的约定）。
 */
const LEGACY_ROUTING_BEFORE = Date.parse("2026-10-31T00:00:00+08:00") / 1000;
/** created_at 一般是秒；万一是毫秒也认 */
const createdSec = (k: AppKey) => (k.created_at > 1e12 ? k.created_at / 1000 : k.created_at);

const BOT_KEY = (botId: string) => `account.botKey.${botId}`;
const ALERTED = "account.lowBalanceAlerted";
const ROUTING = "account.routing";
/** 服务端拒绝了请求里的某个字段（校验失败）；HTTP 200 + success:false 也按 400 算 */
const rejected = (e: unknown) => e instanceof ApiError && (e.status === 400 || e.status === 422);

export class AccountManager {
  private session: AccountSession | undefined;
  private endpoints: OidcEndpoints | undefined;
  private login: LoginAttempt | undefined;
  /** 最近一次已经完成的登录：成功页唤起应用后，用它确认"已返回 AnyModelBot" */
  private finishedLogin: LoginAttempt | undefined;
  /** 正在完成登录时读到的余额（还没写进快照）：首用模型按它算体验额度 */
  private loginBalanceUsd: number | null = null;
  private snapshot: Pick<AccountStatus, "name" | "avatar" | "email" | "profileReady" | "source" | "balanceUsd" | "bot" | "usedUsd" | "billedToEnterprise" | "updatedAt" | "error"> = {
    name: "", avatar: "", email: "", profileReady: false,
    source: "none",
    balanceUsd: null,
    bot: null,
    usedUsd: null,
    billedToEnterprise: false,
    updatedAt: 0,
    error: "",
  };
  private quotaPerUnit = 0;
  private state: AccountState = "signed_out";
  private refreshing: Promise<AccountStatus> | undefined;
  private keyCheck: Promise<boolean> | undefined;
  private keysChecked = { at: 0, replaced: false };
  /** 改性价比和核对时的应用排成一队，免得旧的策略后到、盖掉新的 */
  private routingQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private o: {
      issuer: string;
      vault: AccountVault;
      store: Store;
      hooks: AccountHooks;
      alerts: () => AlertSettings;
      fetchImpl?: typeof fetch;
      hostname?: string;
      /** 桌面版的应用链接（anymodelbot://login-complete）：登录成功页用它把用户带回应用；其他运行方式不传 */
      appLink?: () => string | undefined;
      /** 登录成功页上的应用图标 */
      logo?: () => Buffer | undefined;
    },
  ) {}

  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }

  /** 读本机账户文件；读不出来时标记为不可用（不删文件，换回桌面版仍能用） */
  init(): void {
    try {
      const rec = this.o.vault.load();
      if (rec && rec.issuer === this.o.issuer) {
        this.session = this.newSession(rec);
        this.state = "signed_in";
        if (rec.profile) Object.assign(this.snapshot, rec.profile, { profileReady: true });
      }
    } catch (e) {
      this.state = "unavailable";
      this.snapshot.error = (e as Error).message;
    }
  }

  get signedIn(): boolean {
    return this.state === "signed_in" && !!this.session;
  }

  get ownerKey(): string {
    return this.session?.record.ownerKey || (this.signedIn ? "pending-account" : "local");
  }

  status(): AccountStatus {
    const alerts = this.o.alerts();
    const bal = this.snapshot.balanceUsd;
    return {
      ...this.snapshot,
      state: this.state,
      loginUrl: this.state === "signing_in" ? (this.login?.url ?? "") : "",
      alerts,
      lowBalance: bal !== null && alerts.lowBalanceUsd > 0 && bal < alerts.lowBalanceUsd,
      keyQuality: { strategy: this.routingStrategy(), supported: this.routing().support === "yes" },
      topupUrl: this.topupUrl(),
      profileUrl: webUrl("/profile", "amb_profile"),
    };
  }

  private topupUrl(): string {
    const base = webUrl("/billing", "amb_topup");
    const sub = this.state === "signed_in" ? this.session?.record.subject : undefined;
    return sub ? `${base}#amb_account=${encodeURIComponent(sub)}` : base;
  }

  private async ensureEndpoints(): Promise<OidcEndpoints> {
    this.endpoints ??= await discover(this.o.issuer, this.fetch);
    return this.endpoints;
  }

  private newSession(rec: AccountRecord, access?: { token: string; expiresAt: number }): AccountSession {
    return new AccountSession(
      {
        issuer: this.o.issuer,
        endpoints: () => this.ensureEndpoints(),
        clientId: MODELFLARE_CLIENT_ID,
        record: rec,
        persist: (r) => this.o.vault.save(r),
        fetchImpl: this.fetch,
      },
      access,
    );
  }

  // ---------- 登录 / 退出 ----------

  /** 开始登录：返回在浏览器里打开的地址；完成后自动签发本机 Key 并接到内置网关 */
  async startLogin(): Promise<string> {
    if (this.state === "signing_in" && this.login) return this.login.url;
    if (this.session) throw new ApiError(t("account.already_signed_in"), 409);
    const ep = await this.ensureEndpoints();
    const attempt = await startLogin(ep, {
      clientId: MODELFLARE_CLIENT_ID,
      scope: MODELFLARE_SCOPES,
      extra: { ...UTM, utm_campaign: "amb_signup" }, // 授权页也是注册入口：没有账户的人在这里注册
      fetchImpl: this.fetch,
      // 成功页要等这一步做完才说"登录成功"：读账户、签发本机 Key、接到网关任何一步失败，页面显示失败原因
      finalize: (tokens, signal) => this.completeLogin(tokens, signal),
      appLink: this.o.appLink?.(),
      logo: this.o.logo,
    });
    this.login = attempt;
    this.state = "signing_in";
    this.snapshot.error = "";
    void attempt.result.then(
      () => {
        this.finishedLogin = attempt;
      },
      (e: Error) => {
        if (this.login !== attempt) return;
        this.login = undefined;
        this.state = this.session ? "signed_in" : "signed_out";
        if (!(e instanceof OAuthError && ["cancelled", "access_denied"].includes(e.code))) this.snapshot.error = t("account.login_incomplete", { reason: e.message });
      },
    );
    return attempt.url;
  }

  cancelLogin(): void {
    this.login?.cancel();
  }

  /** 桌面版收到 anymodelbot://login-complete?r=…：确认是这次登录的成功页唤起的，成功页随后显示"已返回" */
  markLoginReturned(nonce: string): boolean {
    return !!this.finishedLogin?.markReturned(nonce);
  }

  /** 已知的余额（含正在完成登录时刚读到的）；不知道时 null */
  knownBalanceUsd(): number | null {
    return this.snapshot.balanceUsd ?? this.loginBalanceUsd;
  }

  /** Docker、远程部署：浏览器回不到这台机器，用户把登录后地址栏里的链接贴回来 */
  completeLoginFromLink(link: string): void {
    if (this.state !== "signing_in" || !this.login) throw new ApiError(t("account.login_ended"), 409);
    try {
      this.login.complete(link);
    } catch (e) {
      if (e instanceof OAuthError) throw new ApiError(e.message, 400);
      throw e;
    }
  }

  /** 登录页要说明的原因（比如旧版本填的 Key 不再使用），登录成功后清掉 */
  explainSignedOut(text: string): void {
    this.snapshot.error = text;
  }

  private async completeLogin(tokens: { accessToken: string; expiresAt: number; refreshToken: string; scope: string; subject?: string }, signal?: AbortSignal): Promise<void> {
    const rec: AccountRecord = { issuer: this.o.issuer, refreshToken: tokens.refreshToken, scope: tokens.scope, deviceKeyId: 0, signedInAt: Date.now(), ...(tokens.subject ? { subject: tokens.subject } : {}) };
    const session = this.newSession(rec, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    try {
      const account = await session.account();
      this.loginBalanceUsd = Number.isFinite(account.balance_usd) ? account.balance_usd : null;
      const key = await this.issueKey((routing) => session.createKey(this.deviceKeyName(), undefined, routing));
      if (!key.key) throw new Error(t("account.no_new_key"));
      // 用户已经取消、或者收尾超时：不留这次授权（撤销会连同刚签发的 Key 一起删除）
      const abandoned = async () => {
        await this.revokeQuietly(session);
        throw new Error(t("account.login_cancelled"));
      };
      if (signal?.aborted) await abandoned();
      try {
        await this.o.hooks.connectKey(key.key);
      } catch (e) {
        // 接不上网关就不留这次授权：撤销会连同刚签发的 Key 一起删除
        await this.revokeQuietly(session);
        throw e;
      }
      if (signal?.aborted) {
        await this.o.hooks.disconnect().catch(() => {});
        await abandoned();
      }
      session.updateRecord({ deviceKeyId: key.id });
      // 刚登录时本机只有这一把 Key：它带着策略签发成功，就算已经应用过了
      if (key.routing_strategy === this.routingStrategy()) this.saveRouting({ applied: this.routingStrategy() });
      this.session = session;
      this.state = "signed_in";
      this.applyAccount(account);
      log.info("signed in to Modelflare", { name: account.display_name || account.username });
      this.checkLowBalance();
      // 给开着预算、还没有 Key 的机器人补签（换设备或重新登录后）。走核对，和刷新余额时的核对合并，不会重复签发
      void this.repairKeys();
    } catch (e) {
      this.state = this.session ? "signed_in" : "signed_out";
      // 取消或超时时原因已经记下（取消不算出错），不再改写成"登录没有完成"
      if (!signal?.aborted) this.snapshot.error = t("account.login_incomplete", { reason: (e as Error).message });
      log.warn("login failed", { message: (e as Error).message });
      // 交给登录页：浏览器里的回调页显示同一个原因，不把失败说成成功
      throw new Error(this.snapshot.error);
    } finally {
      this.login = undefined;
      this.loginBalanceUsd = null;
    }
  }

  /** 退出登录：撤销本机授权（服务端同时删除它签发的全部 Key），再断开内置网关 */
  async logout(): Promise<{ revoked: boolean }> {
    const session = this.session;
    const revoked = session ? await this.revokeQuietly(session) : true;
    await this.forget();
    return { revoked };
  }

  private async revokeQuietly(session: AccountSession): Promise<boolean> {
    try {
      const ep = await this.ensureEndpoints();
      await revokeToken(ep, MODELFLARE_CLIENT_ID, session.record.refreshToken, this.fetch);
      return true;
    } catch (e) {
      log.warn("revoke failed", { message: (e as Error).message });
      return false;
    }
  }

  /** 本机清掉登录状态（授权已撤销或刚退出） */
  private async forget(): Promise<void> {
    this.session = undefined;
    this.state = "signed_out";
    this.o.vault.clear();
    this.saveRouting({ applied: undefined });
    await this.o.hooks.disconnect();
    for (const botId of this.botKeyIds().keys()) this.o.store.deleteKV(BOT_KEY(botId));
    this.snapshot = { name: "", avatar: "", email: "", profileReady: false, source: "none", balanceUsd: null, bot: null, usedUsd: null, billedToEnterprise: false, updatedAt: 0, error: "" };
  }

  /** 授权在别处被撤销：断开并回到登录页 */
  private async onRevoked(): Promise<void> {
    log.warn("Modelflare authorization revoked");
    await this.forget();
    this.snapshot.error = t("account.revoked_elsewhere");
    this.o.hooks.alert(this.snapshot.error, false);
  }

  private async call<T>(fn: (s: AccountSession) => Promise<T>): Promise<T> {
    if (!this.session) throw new ApiError(t("account.sign_in_first"), 409);
    try {
      return await fn(this.session);
    } catch (e) {
      if (e instanceof AccountRevokedError) await this.onRevoked();
      throw e;
    }
  }

  // ---------- 余额 ----------

  private applyAccount(a: ConnectedAccount): void {
    if (this.session && a.username && !this.session.record.ownerKey) {
      this.session.updateRecord({ ownerKey: crypto.createHash("sha256").update(`${this.o.issuer}\n${a.username}`).digest("hex") });
    }
    const profile = accountProfile({ ...a });
    if (this.session && JSON.stringify(this.session.record.profile) !== JSON.stringify(profile)) this.session.updateRecord({ profile });
    this.quotaPerUnit = a.quota_per_unit;
    this.snapshot = {
      ...profile, profileReady: true,
      source: "account",
      balanceUsd: a.balance_usd,
      bot: botQuota(a.bot),
      usedUsd: a.used_usd,
      billedToEnterprise: a.billed_to_enterprise,
      updatedAt: Date.now(),
      error: "",
    };
  }

  /** 刷新余额（并发调用合并成一次） */
  refresh(): Promise<AccountStatus> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async doRefresh(): Promise<AccountStatus> {
    try {
      if (this.session) {
        const session = this.session;
        const account = await this.call((s) => s.account());
        if (this.session !== session) return this.status();
        this.applyAccount(account);
        // 启动后、之后每 5 分钟、切回窗口时都顺带核对一次 Key；不拖慢余额的返回
        void this.repairKeys(60_000);
      } else {
        this.snapshot = { ...this.snapshot, source: "none", balanceUsd: null, bot: null, usedUsd: null, updatedAt: Date.now() };
      }
      this.checkLowBalance();
    } catch (e) {
      if (!(e instanceof AccountRevokedError)) {
        this.snapshot.error = (e as Error).message;
        this.snapshot.profileReady = true;
        // 读不到时 bot 额度也不留旧数：界面和以前一样显示"暂不可用"
        this.snapshot.balanceUsd = null;
        this.snapshot.bot = null;
      }
    }
    return this.status();
  }

  /** 余额跌破阈值时提醒一次；回到阈值以上后才会再次提醒 */
  private checkLowBalance(): void {
    const { lowBalanceUsd, push } = this.o.alerts();
    const bal = this.snapshot.balanceUsd;
    if (bal === null || lowBalanceUsd <= 0) return;
    const alerted = !!this.o.store.getKV(ALERTED);
    if (bal < lowBalanceUsd && !alerted) {
      this.o.store.setKV(ALERTED, String(Date.now()));
      this.o.hooks.alert(t("account.low_balance", { balance: bal.toFixed(2), threshold: lowBalanceUsd, url: webUrl("/billing", "amb_low_balance") }), push, "low_balance");
    } else if (bal >= lowBalanceUsd && alerted) {
      this.o.store.deleteKV(ALERTED);
    }
  }

  // ---------- 用量 / 通知 / 邀请 ----------

  async usage(days: number): Promise<UsageSummary> {
    const now = Date.now();
    const start = startOfLocalDay(now - (days - 1) * 86_400_000);
    const rows = await this.call((s) => s.usage(Math.floor(start / 1000), Math.floor(now / 1000)));
    if (!this.quotaPerUnit) this.applyAccount(await this.call((s) => s.account()));
    return summarizeUsage(rows ?? [], this.quotaPerUnit, start, days);
  }

  notifications(): Promise<unknown> {
    return this.call((s) => s.notifications());
  }

  async invite(): Promise<{ code: string; url: string }> {
    const code = await this.call((s) => s.invite());
    const u = new URL("/sign-up", MODELFLARE_WEB);
    u.searchParams.set("aff", code);
    for (const [k, v] of Object.entries(UTM)) u.searchParams.set(k, v);
    u.searchParams.set("utm_campaign", "amb_invite");
    return { code, url: u.toString() };
  }

  // ---------- 机器人预算 Key ----------

  private botKeyIds(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, v] of this.o.store.listKV("account.botKey.")) out.set(k.slice("account.botKey.".length), Number(v));
    return out;
  }

  /** 各机器人预算 Key 的用量（只含已开启预算且 Key 仍在的机器人） */
  async botBudgets(): Promise<Record<string, Pick<AppKey, "status" | "limit_usd" | "remain_usd" | "used_usd">>> {
    const ids = this.botKeyIds();
    if (!ids.size || !this.session) return {};
    const keys = new Map((await this.call((s) => s.listKeys())).map((k) => [k.id, k]));
    const out: Record<string, Pick<AppKey, "status" | "limit_usd" | "remain_usd" | "used_usd">> = {};
    for (const [botId, id] of ids) {
      const k = keys.get(id);
      if (k) out[botId] = { status: k.status, limit_usd: k.limit_usd, remain_usd: k.remain_usd, used_usd: k.used_usd };
    }
    return out;
  }

  /**
   * 开启 / 调整 / 关闭一个机器人的预算。开启时为它签发自己的 Key（预算 = 这把 Key 的总额度），
   * 机器人的请求改走这把 Key；关闭时删除 Key，机器人回到本机共用的 Key。
   */
  async setBotBudget(botId: string, botName: string, budget: BotBudget): Promise<void> {
    if (!this.session) throw new ApiError(t("account.budget_needs_login"), 409);
    let id = this.botKeyIds().get(botId);
    if (!budget.enabled) {
      if (id) await this.deleteKeyQuietly(id);
      await this.o.hooks.removeBotKey(botId);
      this.o.store.deleteKV(BOT_KEY(botId));
      return;
    }
    if (id) {
      try {
        await this.call((s) => s.updateKey(id!, { limit_usd: budget.limitUsd, name: keyName(botName) }));
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        id = undefined; // 在控制台里被删掉了：重新签发
      }
    }
    const key = await this.issueKey((routing) => this.call((s) => s.createKey(keyName(botName), budget.limitUsd, routing)));
    if (!key.key) throw new Error(t("account.no_new_key"));
    try {
      await this.o.hooks.setBotKey(botId, key.key);
    } catch (e) {
      await this.deleteKeyQuietly(key.id);
      throw e;
    }
    this.o.store.setKV(BOT_KEY(botId), String(key.id));
  }

  private async deleteKeyQuietly(id: number): Promise<void> {
    try {
      await this.call((s) => s.deleteKey(id));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) log.warn("delete key failed", { id, message: (e as Error).message });
    }
  }

  // ---------- Key 核对 ----------

  private deviceKeyName(): string {
    return `AnyModelBot · ${this.o.hostname ?? os.hostname()}`.slice(0, 50);
  }

  /**
   * 核对本机 Key 和各机器人的预算 Key 还在不在（用户可能在 Modelflare 控制台把它们删了），
   * 不在就重新签发并接到内置网关。返回 true = 换了 Key，刚才失败的请求可以再试一次。
   * 并发调用合并成一次；maxAgeMs 内刚核对过就沿用那次的结果。不抛错。
   */
  repairKeys(maxAgeMs = 0): Promise<boolean> {
    if (!this.session) return Promise.resolve(false);
    if (this.keyCheck) return this.keyCheck;
    if (Date.now() - this.keysChecked.at < maxAgeMs) return Promise.resolve(this.keysChecked.replaced);
    this.keyCheck = this.doRepairKeys(this.session)
      .catch((e: Error) => {
        log.warn("key check failed", { message: e.message });
        return false;
      })
      .then((replaced) => {
        this.keysChecked = { at: Date.now(), replaced };
        this.keyCheck = undefined;
        return replaced;
      });
    return this.keyCheck;
  }

  private async doRepairKeys(session: AccountSession): Promise<boolean> {
    // 列表只含这次授权签发、而且还在的 Key
    const keys = await this.call((s) => s.listKeys());
    const alive = new Set(keys.map((k) => k.id));
    const botKeys = this.botKeyIds();
    let replaced = false;

    if (!alive.has(session.record.deviceKeyId) && !this.adoptDeviceKey(session, keys, botKeys) && (await this.o.hooks.sharedKeyRejected())) {
      if (this.session !== session) return false;
      log.warn("device key is gone on Modelflare, issuing a new one", { id: session.record.deviceKeyId });
      const key = await this.issueKey((routing) => this.call((s) => s.createKey(this.deviceKeyName(), undefined, routing)));
      if (!key.key) throw new Error(t("account.no_new_key"));
      try {
        await this.o.hooks.connectKey(key.key);
      } catch (e) {
        await this.deleteKeyQuietly(key.id);
        throw e;
      }
      session.updateRecord({ deviceKeyId: key.id });
      this.o.hooks.alert(t("account.key_reissued"), false);
      replaced = true;
    }

    // 开着预算却没有 Key 的机器人（Key 被删，或刚登录还没补签）：按现在的预算签发，用量从零算起。失败的留到下次核对再试
    const lost = new Set<string>();
    for (const [botId, id] of botKeys) {
      if (alive.has(id)) continue;
      this.o.store.deleteKV(BOT_KEY(botId));
      lost.add(botId);
    }
    for (const b of this.botsSource()) {
      if (!b.budget.enabled || this.botKeyIds().has(b.id) || this.session !== session) continue;
      try {
        await this.setBotBudget(b.id, b.name, b.budget);
        log.info("issued bot budget key", { bot: b.id, replacedDeleted: lost.has(b.id) });
        if (lost.has(b.id)) this.o.hooks.alert(t("account.bot_key_reissued", { name: b.name, limit: b.budget.limitUsd }), false);
        replaced = true;
      } catch (e) {
        log.warn("reissue bot key failed", { bot: b.id, message: (e as Error).message });
      }
      lost.delete(b.id);
    }
    // 预算已经关掉的机器人：只把内置网关里它那把失效的 Key 拿掉
    for (const botId of lost) await this.o.hooks.removeBotKey(botId).catch(() => {});
    if (this.session === session) await this.syncRouting(session, keys);
    return replaced;
  }

  /**
   * 0.1.10 及更早的版本在令牌轮换时把本机 Key 的 id 写回了 0：按网关里那把 Key 的尾号把它认回来。
   * 认不回来说明网关里用的不是这次授权签发的 Key（被删了，或者是旧版本里粘贴的）。
   */
  private adoptDeviceKey(session: AccountSession, keys: AppKey[], botKeys: Map<string, number>): boolean {
    const tail = this.o.hooks.sharedKeyTail();
    const budgetIds = new Set(botKeys.values());
    const k = tail ? keys.find((k) => k.key_tail === tail && !budgetIds.has(k.id)) : undefined;
    if (!k) return false;
    session.updateRecord({ deviceKeyId: k.id });
    return true;
  }

  // ---------- 性价比（Key 的路由策略） ----------

  private routing(): RoutingState {
    try {
      const v = JSON.parse(this.o.store.getKV(ROUTING) ?? "{}") as RoutingState;
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }

  private saveRouting(patch: Partial<RoutingState>): void {
    this.o.store.setKV(ROUTING, JSON.stringify({ ...this.routing(), ...patch }));
  }

  /** 现在的性价比：用户选的，没选过时是均衡 */
  routingStrategy(): RoutingStrategy {
    const c = this.routing().chosen;
    return c && ROUTING_STRATEGIES.includes(c) ? c : DEFAULT_ROUTING;
  }

  /** 记下 Modelflare 认不认这个字段；不认时写日志（只在状态变了时） */
  private noteRouting(supported: boolean, why: string): void {
    const before = this.routing().support;
    this.saveRouting({ support: supported ? "yes" : "no", checkedAt: Date.now() });
    if (!supported && before !== "no") log.warn("Modelflare doesn't accept a routing strategy on app keys", { why });
  }

  /** 签发 Key 时要带的策略：Modelflare 最近说过不认就不带（隔一天再试） */
  private routingToSend(): RoutingStrategy | undefined {
    const st = this.routing();
    if (st.support === "no" && Date.now() - (st.checkedAt ?? 0) < ROUTING_RETRY_MS) return undefined;
    return this.routingStrategy();
  }

  /**
   * 签发一把 Key，带上性价比。被拒（400 / 422）就不带再签一次，记下"不支持"；签发本身绝不因为这个字段失败。
   * 签发成功后看回显：带回同样的 routing_strategy 才算支持，没回显说明服务端忽略了它。
   */
  private async issueKey(create: (routing?: RoutingStrategy) => Promise<AppKey>): Promise<AppKey> {
    const routing = this.routingToSend();
    if (!routing) return create();
    let key: AppKey;
    try {
      key = await create(routing);
    } catch (e) {
      if (!rejected(e)) throw e;
      key = await create();
      this.noteRouting(false, `create rejected: ${(e as Error).message}`);
      return key;
    }
    this.noteRouting(key.routing_strategy === routing, "create ignored the field");
    return key;
  }

  /**
   * 把策略应用到本机签发的全部 Key（本机 Key + 各机器人的预算 Key）。
   * 返回 ok；unsupported = Modelflare 拒绝或忽略了这个字段；网络等其他错误照常抛出。已被删除的 Key 跳过（核对时会重签）。
   */
  private applyRouting(strategy: RoutingStrategy, ids: number[]): Promise<"ok" | "unsupported"> {
    const run = async (): Promise<"ok" | "unsupported"> => {
      for (const id of ids) {
        let k: AppKey;
        try {
          k = await this.call((s) => s.updateKey(id, { routing_strategy: strategy }));
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) continue;
          if (!rejected(e)) throw e;
          this.noteRouting(false, `update rejected: ${(e as Error).message}`);
          return "unsupported";
        }
        if (k?.routing_strategy !== strategy) {
          this.noteRouting(false, "update ignored the field");
          return "unsupported";
        }
        this.noteRouting(true, "");
      }
      this.saveRouting({ applied: strategy });
      return "ok";
    };
    const p = this.routingQueue.then(run, run);
    this.routingQueue = p.catch(() => undefined);
    return p;
  }

  private appKeyIds(session: AccountSession): number[] {
    return [session.record.deviceKeyId, ...this.botKeyIds().values()].filter((id) => id > 0);
  }

  /**
   * 改性价比：先改 Modelflare 上本机签发的全部 Key，成功了才算改好。Modelflare 不认这个字段时不改，返回 409，
   * 状态里 supported 变成 false（界面随之收起这个控件）。
   */
  async setRoutingStrategy(strategy: RoutingStrategy): Promise<AccountStatus> {
    if (!this.session) throw new ApiError(t("account.sign_in_first"), 409);
    if (!ROUTING_STRATEGIES.includes(strategy)) throw new ApiError(t("account.routing_invalid"), 400);
    const prev = this.routing().chosen;
    this.saveRouting({ chosen: strategy });
    let r: "ok" | "unsupported";
    try {
      r = await this.applyRouting(strategy, this.appKeyIds(this.session));
    } catch (e) {
      this.saveRouting({ chosen: prev });
      throw e;
    }
    if (r === "unsupported") {
      this.saveRouting({ chosen: prev });
      throw new ApiError(t("account.routing_unsupported"), 409);
    }
    log.info("key routing strategy changed", { strategy });
    return this.status();
  }

  /**
   * 核对 Key 时顺带（keys 是这次核对拿到的 Key 列表），不抛错：
   * 1. 列表里的 Key 不带 routing_strategy：Modelflare 不认，隔一天再看。
   * 2. 老 Key 迁移，只做一次：稳定优先、签发于 LEGACY_ROUTING_BEFORE 之前的本机 Key 改成均衡，别的不动。
   * 3. 在应用里改过、还没改到全部 Key 上的（上次没改完），补上。
   * 4. 否则以 Modelflare 上本机 Key 的为准：在控制台里改过的，应用跟着显示，不盖掉。
   */
  private async syncRouting(session: AccountSession, keys: AppKey[]): Promise<void> {
    const st = this.routing();
    if (st.support === "no" && Date.now() - (st.checkedAt ?? 0) < ROUTING_RETRY_MS) return;
    const mine = new Set(this.appKeyIds(session));
    const own = keys.filter((k) => mine.has(k.id));
    const device = own.find((k) => k.id === session.record.deviceKeyId);
    if (!device) return; // 本机 Key 刚重签：下次核对再说
    if (!ROUTING_STRATEGIES.some((x) => x === device.routing_strategy)) {
      this.noteRouting(false, "key list has no routing_strategy");
      return;
    }
    this.noteRouting(true, "");
    try {
      if (!st.migrated) {
        const legacy = own.filter((k) => k.routing_strategy === "stable" && createdSec(k) < LEGACY_ROUTING_BEFORE);
        if (legacy.length && (await this.applyRouting("balanced", legacy.map((k) => k.id))) === "ok") {
          for (const k of legacy) k.routing_strategy = "balanced";
          log.info("moved legacy app keys from stability first to balanced", { keys: legacy.length });
        }
        this.saveRouting({ migrated: true });
      }
      const cur = this.routing();
      if (cur.chosen && cur.applied !== cur.chosen) {
        if ((await this.applyRouting(cur.chosen, own.map((k) => k.id))) === "ok") log.info("applied key routing strategy", { strategy: cur.chosen, keys: own.length });
        return;
      }
      const now = ROUTING_STRATEGIES.find((x) => x === device.routing_strategy)!;
      if (now !== cur.chosen || cur.applied !== now) {
        this.saveRouting({ chosen: now, applied: now });
        if (cur.chosen && now !== cur.chosen) log.info("key routing strategy was changed on Modelflare, following it", { strategy: now });
      }
    } catch (e) {
      log.warn("applying key routing strategy failed", { message: (e as Error).message });
    }
  }

  /** App 注入：当前机器人及其预算设置 */
  botsSource: () => Array<{ id: string; name: string; budget: BotBudget }> = () => [];
}

function keyName(botName: string): string {
  return `AnyModelBot · ${botName}`.slice(0, 50);
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface UsageSummary {
  days: Array<{ date: string; usd: number; requests: number }>;
  models: Array<{ model: string; usd: number; requests: number }>;
  totalUsd: number;
}

/** 把按小时、按模型的用量行汇总成本地日期的日合计与模型合计（金额 = quota / quota_per_unit） */
export function summarizeUsage(rows: UsageRow[], quotaPerUnit: number, startMs: number, days: number): UsageSummary {
  const usd = (q: number) => (quotaPerUnit > 0 ? q / quotaPerUnit : 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOf = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const byDay = new Map<string, { usd: number; requests: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs);
    d.setDate(d.getDate() + i);
    byDay.set(dateOf(d.getTime()), { usd: 0, requests: 0 });
  }
  const byModel = new Map<string, { usd: number; requests: number }>();
  let total = 0;
  for (const r of rows) {
    const v = usd(Number(r.quota) || 0);
    const n = Number(r.count) || 0;
    total += v;
    const day = byDay.get(dateOf(Number(r.created_at) * 1000));
    if (day) {
      day.usd += v;
      day.requests += n;
    }
    const m = byModel.get(r.model_name) ?? { usd: 0, requests: 0 };
    m.usd += v;
    m.requests += n;
    byModel.set(r.model_name, m);
  }
  return {
    days: [...byDay].map(([date, v]) => ({ date, ...v })),
    models: [...byModel].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.usd - a.usd),
    totalUsd: total,
  };
}
