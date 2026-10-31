/**
 * Modelflare 账户：登录 / 退出、本机设备 Key、余额与低余额提醒、每个机器人的预算 Key、
 * 用量 / 通知 / 邀请。只用 API Key 连接（没有登录账户）时，余额改从 credit_grants 读，
 * 依赖账户授权的功能（用量、通知、邀请、机器人预算）不可用。
 */
import os from "node:os";
import { logger } from "../log.js";
import { t } from "../i18n/index.js";
import type { Store } from "../store/db.js";
import { MODELFLARE_CLIENT_ID, MODELFLARE_SCOPES, MODELFLARE_WEB, UTM, webUrl, type KeyBalance } from "../modelflare.js";
import { discover, OAuthError, revokeToken, startLogin, type LoginAttempt, type OidcEndpoints } from "./oauth.js";
import { AccountRevokedError, AccountSession, ApiError, type AppKey, type ConnectedAccount, type UsageRow } from "./client.js";
import type { AccountRecord, AccountVault } from "./vault.js";

const log = logger("account");

export interface AccountHooks {
  /** 把签发的 Key 接到内置网关（先校验再写入） */
  connectKey(key: string): Promise<void>;
  /** 从内置网关删除 Modelflare 连接与全部机器人 provider */
  disconnect(): Promise<void>;
  setBotKey(botId: string, key: string): Promise<void>;
  removeBotKey(botId: string): Promise<void>;
  /** 只有 API Key 时的余额；没有连接时 undefined */
  keyBalance(): Promise<KeyBalance | undefined>;
  /** 内置网关共用连接当前那把 Key 的最后 4 位；没连接时为空 */
  sharedKeyTail(): string;
  /** 共用连接的 Key 已经不能用：没连接，或 Modelflare 说这把 Key 无效 */
  sharedKeyRejected(): Promise<boolean>;
  /** 提醒：写入应用通知；push = 同时经机器人发到你的微信 / 飞书 */
  alert(text: string, push: boolean): void;
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

export type AccountState = "signed_out" | "signing_in" | "signed_in" | "unavailable";

export interface AccountStatus {
  state: AccountState;
  /** 账户名称（登录后） */
  name: string;
  /** 余额来源：account = 登录账户；key = 只用 API Key；none = 未连接 */
  source: "account" | "key" | "none";
  balanceUsd: number | null;
  usedUsd: number | null;
  billedToEnterprise: boolean;
  updatedAt: number;
  error: string;
  loginUrl: string;
  alerts: AlertSettings;
  lowBalance: boolean;
}

const BOT_KEY = (botId: string) => `account.botKey.${botId}`;
const ALERTED = "account.lowBalanceAlerted";

export class AccountManager {
  private session: AccountSession | undefined;
  private endpoints: OidcEndpoints | undefined;
  private login: LoginAttempt | undefined;
  private snapshot: Pick<AccountStatus, "name" | "source" | "balanceUsd" | "usedUsd" | "billedToEnterprise" | "updatedAt" | "error"> = {
    name: "",
    source: "none",
    balanceUsd: null,
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

  constructor(
    private o: {
      issuer: string;
      vault: AccountVault;
      store: Store;
      hooks: AccountHooks;
      alerts: () => AlertSettings;
      fetchImpl?: typeof fetch;
      hostname?: string;
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
      }
    } catch (e) {
      this.state = "unavailable";
      this.snapshot.error = (e as Error).message;
    }
  }

  get signedIn(): boolean {
    return this.state === "signed_in" && !!this.session;
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
    };
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
    });
    this.login = attempt;
    this.state = "signing_in";
    this.snapshot.error = "";
    void attempt.result.then(
      (tokens) => this.completeLogin(tokens),
      (e: Error) => {
        if (this.login !== attempt) return;
        this.login = undefined;
        this.state = this.session ? "signed_in" : "signed_out";
        if (!(e instanceof OAuthError && e.code === "cancelled")) this.snapshot.error = e.message;
      },
    );
    return attempt.url;
  }

  cancelLogin(): void {
    this.login?.cancel();
  }

  private async completeLogin(tokens: { accessToken: string; expiresAt: number; refreshToken: string; scope: string }): Promise<void> {
    const rec: AccountRecord = { issuer: this.o.issuer, refreshToken: tokens.refreshToken, scope: tokens.scope, deviceKeyId: 0, signedInAt: Date.now() };
    const session = this.newSession(rec, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    try {
      const account = await session.account();
      const key = await session.createKey(this.deviceKeyName());
      if (!key.key) throw new Error(t("account.no_new_key"));
      try {
        await this.o.hooks.connectKey(key.key);
      } catch (e) {
        // 接不上网关就不留这次授权：撤销会连同刚签发的 Key 一起删除
        await this.revokeQuietly(session);
        throw e;
      }
      session.updateRecord({ deviceKeyId: key.id });
      this.session = session;
      this.state = "signed_in";
      this.applyAccount(account);
      log.info("signed in to Modelflare", { name: account.display_name || account.username });
      this.checkLowBalance();
      // 给开着预算、还没有 Key 的机器人补签（换设备或重新登录后）。走核对，和刷新余额时的核对合并，不会重复签发
      void this.repairKeys();
    } catch (e) {
      this.state = this.session ? "signed_in" : "signed_out";
      this.snapshot.error = t("account.login_incomplete", { reason: (e as Error).message });
      log.warn("login failed", { message: (e as Error).message });
    } finally {
      this.login = undefined;
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
    await this.o.hooks.disconnect();
    for (const botId of this.botKeyIds().keys()) this.o.store.deleteKV(BOT_KEY(botId));
    this.snapshot = { name: "", source: "none", balanceUsd: null, usedUsd: null, billedToEnterprise: false, updatedAt: 0, error: "" };
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
    this.quotaPerUnit = a.quota_per_unit;
    this.snapshot = {
      name: a.display_name || a.username,
      source: "account",
      balanceUsd: a.balance_usd,
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
        this.applyAccount(await this.call((s) => s.account()));
        // 启动后、之后每 5 分钟、切回窗口时都顺带核对一次 Key；不拖慢余额的返回
        void this.repairKeys(60_000);
      } else {
        const b = await this.o.hooks.keyBalance();
        this.snapshot = {
          ...this.snapshot,
          source: b ? "key" : "none",
          balanceUsd: b ? b.available : null,
          usedUsd: b ? b.used : null,
          updatedAt: Date.now(),
          error: "",
        };
      }
      this.checkLowBalance();
    } catch (e) {
      if (!(e instanceof AccountRevokedError)) this.snapshot.error = (e as Error).message;
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
      this.o.hooks.alert(t("account.low_balance", { balance: bal.toFixed(2), threshold: lowBalanceUsd, url: webUrl("/billing", "amb_low_balance") }), push);
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
    const key = await this.call((s) => s.createKey(keyName(botName), budget.limitUsd));
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
      const key = await this.call((s) => s.createKey(this.deviceKeyName()));
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
    return replaced;
  }

  /**
   * 0.1.10 及更早的版本在令牌轮换时把本机 Key 的 id 写回了 0：按网关里那把 Key 的尾号把它认回来。
   * 认不回来说明网关里用的不是这次授权签发的 Key（被删了，或者用户自己粘贴了一把）。
   */
  private adoptDeviceKey(session: AccountSession, keys: AppKey[], botKeys: Map<string, number>): boolean {
    const tail = this.o.hooks.sharedKeyTail();
    const budgetIds = new Set(botKeys.values());
    const k = tail ? keys.find((k) => k.key_tail === tail && !budgetIds.has(k.id)) : undefined;
    if (!k) return false;
    session.updateRecord({ deviceKeyId: k.id });
    return true;
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
