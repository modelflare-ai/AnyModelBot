/**
 * Modelflare 账户登录：OIDC 授权码 + PKCE（RFC 7636），按 RFC 8252 作为原生应用。
 * - 本程序是公共客户端：只发 client_id，没有客户端密钥；PKCE verifier 证明是同一个发起方。
 * - 回调到本机 127.0.0.1 的临时端口（服务端允许回环地址任意端口），浏览器把授权码交回给本进程。
 * - 授权地址等全部取自发现文档，并要求与发行方同源，伪造的发现文档不能把令牌引到别处。
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { lang, t, tl, type Lang } from "../i18n/index.js";

export interface OidcEndpoints {
  issuer: string;
  authorization: string;
  token: string;
  revocation: string;
}

export interface TokenSet {
  accessToken: string;
  /** 毫秒时间戳；提前一分钟视为过期 */
  expiresAt: number;
  refreshToken: string;
  scope: string;
}

export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

export async function discover(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcEndpoints> {
  let res: Response;
  try {
    res = await fetchImpl(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new OAuthError("network", t("account.host_unreachable", { host: new URL(issuer).host, reason: (e as Error).message }));
  }
  if (!res.ok) throw new OAuthError("discovery", t("account.discovery_failed", { status: res.status }), res.status);
  const doc = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const origin = new URL(issuer).origin;
  const endpoint = (key: string) => {
    const v = typeof doc[key] === "string" ? (doc[key] as string) : "";
    if (!v || new URL(v).origin !== origin) throw new OAuthError("discovery", t("account.discovery_bad_endpoint", { key }));
    return v;
  };
  if (doc.issuer !== issuer) throw new OAuthError("discovery", t("account.discovery_issuer_mismatch"));
  return {
    issuer,
    authorization: endpoint("authorization_endpoint"),
    token: endpoint("token_endpoint"),
    revocation: endpoint("revocation_endpoint"),
  };
}

async function tokenRequest(endpoint: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new OAuthError("network", t("account.unreachable", { reason: (e as Error).message }));
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    throw new OAuthError(code, typeof body.error_description === "string" ? body.error_description : `HTTP ${res.status}`, res.status);
  }
  const accessToken = String(body.access_token ?? "");
  const refreshToken = String(body.refresh_token ?? params.refresh_token ?? "");
  if (!accessToken || !refreshToken) throw new OAuthError("bad_response", t("account.tokens_incomplete"));
  const ttl = Number(body.expires_in);
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 900) * 1000 - 60_000,
    scope: String(body.scope ?? ""),
  };
}

export function refreshTokens(ep: OidcEndpoints, clientId: string, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<TokenSet> {
  return tokenRequest(ep.token, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }, fetchImpl);
}

/** 撤销 refresh token：服务端让这台设备退出登录，并删除这次授权创建的 API Key */
export async function revokeToken(ep: OidcEndpoints, clientId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(ep.revocation, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, client_id: clientId }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new OAuthError(`http_${res.status}`, t("account.logout_failed", { status: res.status }), res.status);
}

export interface LoginAttempt {
  /** 在浏览器里打开的授权地址 */
  url: string;
  result: Promise<TokenSet>;
  cancel(): void;
}

export interface LoginOptions {
  clientId: string;
  scope: string;
  /** 带到授权请求上的额外参数（注册来源 utm_*） */
  extra?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const PAGE = (l: Lang, title: string, text: string) =>
  `<!doctype html><html lang="${l}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#222;background:#fafafa">` +
  `<main style="text-align:center;padding:24px"><h1 style="font-size:20px">${title}</h1><p>${text}</p></main></body></html>`;

/**
 * 开始一次登录：在 127.0.0.1 的临时端口上等浏览器回调。state 不匹配的请求一律忽略（不结束这次登录），
 * 只接受第一次合法回调；超时（默认 10 分钟，与服务端授权请求的有效期一致）或取消时结束。
 */
export async function startLogin(ep: OidcEndpoints, o: LoginOptions): Promise<LoginAttempt> {
  const fetchImpl = o.fetchImpl ?? fetch;
  // 浏览器回调不在发起登录的那个请求里：语言在这里定下（授权页、回调页、报错都用它）
  const l = lang();
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(24));
  let settle: { resolve: (t: TokenSet) => void; reject: (e: Error) => void };
  const result = new Promise<TokenSet>((resolve, reject) => (settle = { resolve, reject }));
  // 浏览器可能在调用方挂上处理之前就回调失败；先标记为已处理，调用方照样能拿到这个拒绝
  result.catch(() => {});
  let done = false;
  let timer: NodeJS.Timeout | undefined;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const sameState = (v: string | null) => !!v && v.length === state.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(state));
    if (req.method !== "GET" || u.pathname !== "/callback" || done || !sameState(u.searchParams.get("state"))) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    const error = u.searchParams.get("error");
    const code = u.searchParams.get("code");
    const html = (status: number, title: string, text: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(PAGE(l, title, text));
    };
    if (error || !code) {
      html(400, tl(l, "account.page_not_done_title"), tl(l, error === "access_denied" ? "account.page_denied" : "account.page_not_done"));
      finish(new OAuthError(error || "invalid_request", error === "access_denied" ? tl(l, "account.denied") : u.searchParams.get("error_description") || tl(l, "account.not_done")));
      return;
    }
    html(200, tl(l, "account.page_done_title"), tl(l, "account.page_done"));
    done = true;
    tokenRequest(ep.token, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: o.clientId, code_verifier: verifier }, fetchImpl).then(
      (t) => finish(undefined, t),
      (e) => finish(e as Error),
    );
  });
  const finish = (err?: Error, tokens?: TokenSet) => {
    done = true;
    if (timer) clearTimeout(timer);
    server.closeAllConnections?.();
    server.close();
    if (err) settle.reject(err);
    else settle.resolve(tokens!);
  };
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  timer = setTimeout(() => finish(new OAuthError("timeout", tl(l, "account.login_timeout"))), o.timeoutMs ?? 10 * 60_000);
  const url = new URL(ep.authorization);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: redirectUri,
    scope: o.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    ui_locales: l,
    ...o.extra,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    url: url.toString(),
    result,
    cancel: () => {
      if (!done) finish(new OAuthError("cancelled", tl(l, "account.login_cancelled")));
    },
  };
}
