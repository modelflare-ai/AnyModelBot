/**
 * Modelflare connected-app 接口（/api/connected-app/*）的客户端。access token 只在内存里，
 * 过期前用 refresh token 换新；refresh token 每次都会轮换，新值立刻写回本机账户文件。
 */
import { OAuthError, refreshTokens, type OidcEndpoints } from "./oauth.js";
import type { AccountRecord } from "./vault.js";
import { lang, t } from "../i18n/index.js";

/** 授权已失效（用户在网页上撤销、账户被停用等）：需要重新登录 */
export class AccountRevokedError extends Error {}

export interface ConnectedAccount {
  display_name: string;
  username: string;
  group: string;
  balance_usd: number;
  used_usd: number;
  billed_to_enterprise: boolean;
  quota_per_unit: number;
}

export interface AppKey {
  id: number;
  name: string;
  key_tail: string;
  status: "enabled" | "disabled" | "expired" | "exhausted";
  unlimited: boolean;
  limit_usd: number | null;
  remain_usd: number | null;
  used_usd: number;
  created_at: number;
  accessed_at: number;
  /** 只在创建时返回一次 */
  key?: string;
}

export interface UsageRow {
  model_name: string;
  created_at: number;
  count: number;
  quota: number;
  token_used: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class AccountSession {
  private access: { token: string; expiresAt: number } | undefined;
  private refreshing: Promise<string> | undefined;

  constructor(
    private o: {
      /** 资源接口所在的发行方地址 */
      issuer: string;
      /** 令牌端点等取自发现文档；第一次需要换令牌时才去读，启动时不联网 */
      endpoints: () => Promise<OidcEndpoints>;
      clientId: string;
      record: AccountRecord;
      /** 轮换后的 refresh token 必须立刻落盘，否则重启后就换不了新令牌 */
      persist: (rec: AccountRecord) => void;
      fetchImpl?: typeof fetch;
    },
    initialAccess?: { token: string; expiresAt: number },
  ) {
    this.access = initialAccess;
  }

  get record(): AccountRecord {
    return this.o.record;
  }

  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }

  /** 同一时刻只换一次：refresh token 会轮换，并发地拿旧值去换，第二个必然失败 */
  async accessToken(force = false): Promise<string> {
    if (!force && this.access && Date.now() < this.access.expiresAt) return this.access.token;
    this.refreshing ??= (async () => {
      try {
        const t = await refreshTokens(await this.o.endpoints(), this.o.clientId, this.o.record.refreshToken, this.fetch);
        this.o.record = { ...this.o.record, refreshToken: t.refreshToken, scope: t.scope || this.o.record.scope };
        this.o.persist(this.o.record);
        this.access = { token: t.accessToken, expiresAt: t.expiresAt };
        return t.accessToken;
      } catch (e) {
        if (e instanceof OAuthError && e.code === "invalid_grant") throw new AccountRevokedError(t("account.revoked"));
        throw e;
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  /** 调用 connected-app 接口；401 时强制换一次令牌重试，仍然 401 说明授权已撤销 */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(attempt > 0);
      let res: Response;
      try {
        res = await this.fetch(`${this.o.issuer}/api/connected-app${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            // 通知等内容按语言返回
            "Accept-Language": lang(),
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        throw new ApiError(t("account.unreachable", { reason: (e as Error).message }), 0);
      }
      if (res.status === 401) {
        if (attempt === 0) continue;
        throw new AccountRevokedError(t("account.revoked"));
      }
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; message?: string; error_description?: string };
      // 部分校验沿用控制台的写法：HTTP 200 + success:false
      if (!res.ok || data.success === false) throw new ApiError(data.message || data.error_description || `HTTP ${res.status}`, res.ok ? 400 : res.status);
      return data.data as T;
    }
  }

  account(): Promise<ConnectedAccount> {
    return this.request("GET", "/account");
  }
  usage(start: number, end: number): Promise<UsageRow[] | null> {
    return this.request("GET", `/usage?start_timestamp=${start}&end_timestamp=${end}`);
  }
  notifications(): Promise<unknown> {
    return this.request("GET", "/notifications");
  }
  invite(): Promise<string> {
    return this.request("GET", "/invite");
  }
  listKeys(): Promise<AppKey[]> {
    return this.request("GET", "/api-keys");
  }
  createKey(name: string, limitUsd?: number): Promise<AppKey> {
    return this.request("POST", "/api-keys", { name, ...(limitUsd !== undefined ? { limit_usd: limitUsd } : {}) });
  }
  updateKey(id: number, patch: { name?: string; limit_usd?: number; unlimited?: boolean }): Promise<AppKey> {
    return this.request("PATCH", `/api-keys/${id}`, patch);
  }
  async deleteKey(id: number): Promise<void> {
    await this.request("DELETE", `/api-keys/${id}`);
  }
}
