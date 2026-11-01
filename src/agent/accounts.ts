/**
 * 已授权账号：全局一份（设置 › 连接），所有机器人共用。同一个服务可以加多个账号，
 * 用户可以对任何机器人说「看我第一个飞书和第二个飞书的消息」，模型按序号或名字选账号。
 *
 * 机器人之间的差别只来自权限：只读机器人和观察规则不能写（manager.ts connectionOp）。
 * 令牌只留在宿主进程，代理进程经 bridge 调用（amb-connections 插件）。
 *
 * 这里抛出的 ConnectionError 的文字会直接给模型看：说清楚怎么办，不带令牌。
 * 飞书、微信等聊天渠道是另一回事：渠道是机器人自己的账号身份，还是每个机器人配一个。
 */
import crypto from "node:crypto";
import { registerSecret } from "../log.js";

export const ACCOUNT_SERVICES = ["notion", "feishu"] as const;
export type AccountService = (typeof ACCOUNT_SERVICES)[number];
export type FeishuBrand = "feishu" | "lark";

export interface NotionTokenAuth {
  kind: "notion-token";
  token: string;
}
export interface NotionOAuthAuth {
  kind: "notion-oauth";
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface FeishuUserAuth {
  kind: "feishu-user";
  brand: FeishuBrand;
  appId: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export type AccountAuth = NotionTokenAuth | NotionOAuthAuth | FeishuUserAuth;

export interface ConnectedAccount {
  id: string;
  service: AccountService;
  label: string;
  /** 这个账号是谁（工作区 + 用户）：重新授权同一个账号时更新它，不多出一条 */
  identity: string;
  /** 授权失效了，要用户重新授权 */
  needsReauth: boolean;
  createdAt: number;
  auth: AccountAuth;
}

/** 设置页看到的：没有任何令牌 */
export interface AccountView {
  id: string;
  service: AccountService;
  /** 这个服务里的第几个，从 1 开始（用户说「第一个飞书」就是它） */
  number: number;
  label: string;
  method: "token" | "oauth";
  needsReauth: boolean;
}

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}

const SERVICE_NAME: Record<AccountService, string> = { notion: "Notion", feishu: "Feishu" };
const MAX_TEXT = 60_000;

/** 一次工具结果的上限（字符）：太长就截断，告诉模型被截断了 */
export function capped(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n\n[Cut off here: the result was too long.]`;
}

export function clampLimit(v: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function secretsOf(auth: AccountAuth): string[] {
  switch (auth.kind) {
    case "notion-token":
      return [auth.token];
    case "notion-oauth":
      return [auth.accessToken, auth.refreshToken];
    case "feishu-user":
      return [auth.appSecret, auth.accessToken, auth.refreshToken];
  }
}

function validAuth(a: any): a is AccountAuth {
  if (!a || typeof a !== "object") return false;
  const str = (k: string) => typeof a[k] === "string" && a[k].length > 0;
  if (a.kind === "notion-token") return str("token");
  if (a.kind === "notion-oauth") return str("clientId") && str("accessToken") && str("refreshToken") && typeof a.expiresAt === "number";
  if (a.kind === "feishu-user") return (a.brand === "feishu" || a.brand === "lark") && str("appId") && str("appSecret") && str("accessToken") && str("refreshToken") && typeof a.expiresAt === "number";
  return false;
}

export const ACCOUNTS_KV = "connected-accounts";

interface KvStore {
  getKV(key: string): string | undefined;
  setKV(key: string, value: string): void;
}

export class AccountStore {
  private accounts: ConnectedAccount[] = [];

  constructor(private kv: KvStore) {
    let raw: unknown;
    try {
      raw = JSON.parse(kv.getKV(ACCOUNTS_KV) ?? "[]");
    } catch {
      raw = [];
    }
    for (const a of Array.isArray(raw) ? raw : []) {
      if (!a || typeof a !== "object") continue;
      if (!(ACCOUNT_SERVICES as readonly unknown[]).includes(a.service) || typeof a.id !== "string" || typeof a.identity !== "string" || !validAuth(a.auth)) continue;
      this.accounts.push({
        id: a.id,
        service: a.service,
        label: typeof a.label === "string" && a.label ? a.label : SERVICE_NAME[a.service as AccountService],
        identity: a.identity,
        needsReauth: a.needsReauth === true,
        createdAt: Number(a.createdAt) || 0,
        auth: a.auth,
      });
      secretsOf(a.auth).forEach(registerSecret);
    }
  }

  private save(): void {
    for (const a of this.accounts) secretsOf(a.auth).forEach(registerSecret);
    this.kv.setKV(ACCOUNTS_KV, JSON.stringify(this.accounts));
  }

  list(service?: AccountService): ConnectedAccount[] {
    return service ? this.accounts.filter((a) => a.service === service) : [...this.accounts];
  }

  get(id: string): ConnectedAccount | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  /** 同一个账号（服务 + identity）再授权一次：换令牌，保留用户起的名字和序号；否则加到最后 */
  upsert(input: { service: AccountService; label: string; identity: string; auth: AccountAuth }): ConnectedAccount {
    const same = this.accounts.find((a) => a.service === input.service && a.identity === input.identity);
    if (same) {
      same.auth = input.auth;
      same.needsReauth = false;
      this.save();
      return same;
    }
    const account: ConnectedAccount = {
      id: crypto.randomBytes(8).toString("hex"),
      service: input.service,
      label: input.label.trim().slice(0, 80) || SERVICE_NAME[input.service],
      identity: input.identity,
      needsReauth: false,
      createdAt: Date.now(),
      auth: input.auth,
    };
    this.accounts.push(account);
    this.save();
    return account;
  }

  /** 改令牌或状态。令牌轮换后要马上落盘：旧的 refresh token 不能再用 */
  update(id: string, patch: { auth?: AccountAuth; needsReauth?: boolean }): void {
    const a = this.get(id);
    if (!a) return;
    if (patch.auth) a.auth = patch.auth;
    if (patch.needsReauth !== undefined) a.needsReauth = patch.needsReauth;
    this.save();
  }

  rename(id: string, label: string): boolean {
    const a = this.get(id);
    const name = label.trim().slice(0, 80);
    if (!a || !name) return false;
    a.label = name;
    this.save();
    return true;
  }

  remove(id: string): boolean {
    const before = this.accounts.length;
    this.accounts = this.accounts.filter((a) => a.id !== id);
    if (this.accounts.length === before) return false;
    this.save();
    return true;
  }

  view(): AccountView[] {
    const seen: Partial<Record<AccountService, number>> = {};
    return this.accounts.map((a) => {
      seen[a.service] = (seen[a.service] ?? 0) + 1;
      return { id: a.id, service: a.service, number: seen[a.service]!, label: a.label, method: a.auth.kind === "notion-token" ? "token" : "oauth", needsReauth: a.needsReauth };
    });
  }

  /** 给模型看的账号清单 */
  listText(service: AccountService): string {
    return this.list(service)
      .map((a, i) => `${i + 1}. ${a.label}${a.needsReauth ? " (needs re-authorization)" : ""}`)
      .join("\n");
  }

  /** 模型给的 account：序号或名字。只有一个账号时可以不给；有几个又没说清楚时，报错并列出来，模型再选或问用户 */
  resolve(service: AccountService, selector: unknown): ConnectedAccount {
    const name = SERVICE_NAME[service];
    const list = this.list(service);
    if (!list.length) throw new ConnectionError(`No ${name} account is connected. Ask the user to add one in Settings > Connections.`);
    const raw = selector === undefined || selector === null ? "" : String(selector).trim();
    if (!raw) {
      if (list.length === 1) return list[0];
      throw new ConnectionError(`Several ${name} accounts are connected. Say which one with account, or ask the user:\n${this.listText(service)}`);
    }
    const pick = /^\d+$/.test(raw) ? list[Number(raw) - 1] : undefined;
    if (pick) return pick;
    const lower = raw.toLowerCase();
    const exact = list.find((a) => a.label.toLowerCase() === lower);
    if (exact) return exact;
    const near = list.filter((a) => a.label.toLowerCase().includes(lower));
    if (near.length === 1) return near[0];
    throw new ConnectionError(`There is no ${name} account "${raw.slice(0, 80)}". Connected accounts:\n${this.listText(service)}`);
  }
}
