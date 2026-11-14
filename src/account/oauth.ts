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
import { fetchFailureReason } from "../providers/modelflare.js";

export interface OidcEndpoints {
  issuer: string;
  authorization: string;
  token: string;
  revocation: string;
  userinfo?: string;
}

export interface TokenSet {
  accessToken: string;
  /** 毫秒时间戳；提前一分钟视为过期 */
  expiresAt: number;
  refreshToken: string;
  scope: string;
  /**
   * ID Token 里的 sub（账户的稳定标识，不是密钥）。只当作提示用：打开充值页时放在网址的 # 后面，
   * 让 Modelflare 网页核对浏览器登录的是不是同一个账户；不用它做任何授权判断，所以这里不验签。服务端没返回时为空。
   */
  subject?: string;
}

/** 从 ID Token（JWT）的载荷里读 sub；读不出来时 undefined */
export function idTokenSubject(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  const part = idToken.split(".")[1];
  if (!part) return undefined;
  try {
    const sub = (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub && sub.length <= 64 ? sub : typeof sub === "number" ? String(sub) : undefined;
  } catch {
    return undefined;
  }
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
    throw new OAuthError("network", t("account.host_unreachable", { host: new URL(issuer).host, reason: fetchFailureReason(e) }));
  }
  if (!res.ok) throw new OAuthError("discovery", t("account.discovery_failed", { status: res.status }), res.status);
  const doc = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const origin = new URL(issuer).origin;
  const endpoint = (key: string) => {
    const v = typeof doc[key] === "string" ? (doc[key] as string) : "";
    if (!v || new URL(v).origin !== origin) throw new OAuthError("discovery", t("account.discovery_bad_endpoint", { key }));
    return v;
  };
  let userinfo: string | undefined;
  if (doc.userinfo_endpoint) {
    try { userinfo = endpoint("userinfo_endpoint"); } catch { /* Optional profile endpoint is ignored if invalid. */ }
  }
  if (doc.issuer !== issuer) throw new OAuthError("discovery", t("account.discovery_issuer_mismatch"));
  return {
    issuer,
    authorization: endpoint("authorization_endpoint"),
    token: endpoint("token_endpoint"),
    revocation: endpoint("revocation_endpoint"),
    ...(userinfo ? { userinfo } : {}),
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
    throw new OAuthError("network", t("account.unreachable", { reason: fetchFailureReason(e) }));
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
    ...(idTokenSubject(body.id_token) ? { subject: idTokenSubject(body.id_token) } : {}),
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
  /** 换到令牌、而且 finalize（账户读取、签发本机 Key、接网关）也成功后才 resolve */
  result: Promise<TokenSet>;
  cancel(): void;
  /**
   * 手动交回回调链接：Docker、远程部署时浏览器回不到这台机器，用户把登录后地址栏里的链接贴回来。
   * 链接不属于这次登录时抛错，这次登录继续等，可以重新粘贴。
   */
  complete(link: string): void;
  /** 桌面版收到了成功页唤起的 anymodelbot:// 链接：nonce 对得上时成功页才显示"已返回 AnyModelBot" */
  markReturned(nonce: string): boolean;
}

export interface LoginOptions {
  clientId: string;
  scope: string;
  /** 带到授权请求上的额外参数（注册来源 utm_*） */
  extra?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * 换到令牌之后、告诉浏览器"登录成功"之前要做完的事（读账户、签发本机 Key、接到网关）。
   * 抛错 = 这次登录失败，成功页显示失败原因，不会把失败的登录说成成功。
   */
  finalize?: (tokens: TokenSet, signal: AbortSignal) => Promise<void>;
  /**
   * 桌面版的应用链接（如 anymodelbot://login-complete）：成功页的"打开 AnyModelBot"按钮和加载后的一次自动唤起用它。
   * 不传（命令行、Docker、浏览器里用）时成功页只请用户切回 AnyModelBot，不去唤起本机可能装着的另一个客户端。
   */
  appLink?: string;
  /** 成功页上的应用图标（PNG） */
  logo?: () => Buffer | undefined;
}

/** 成功后回调服务再留多久：成功页靠它查询"是否已返回应用"，过后自动关闭 */
const RETURN_WINDOW_MS = 3 * 60_000;
/** 浏览器授权之后，换令牌 + finalize 最多等多久：网络卡住时不让登录一直挂着 */
const FINALIZE_MS = 2 * 60_000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 授权被拒、没有授权码这类当场就能确定的结果 */
const PAGE = (l: Lang, title: string, text: string) =>
  `<!doctype html><html lang="${l}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
  `<body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#222;background:#fafafa">` +
  `<main style="text-align:center;padding:24px"><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`;

/**
 * 回调页：先显示"正在完成登录"，每秒问一次本页所在的回环服务（带着同一个 state），
 * 登录真正完成后换成成功卡片（AnyModelBot 标志 + 成功图标 + 打开按钮），失败时换成失败原因。
 * 文案全部由服务端按登录时的语言填好；脚本只切换显示，不拼接用户可见的句子。
 */
function callbackPage(l: Lang, o: { state: string; appLink?: string }): string {
  const s = (k: Parameters<typeof tl>[1]) => esc(tl(l, k));
  const data = JSON.stringify({ state: o.state, app: o.appLink || "" }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AnyModelBot</title><meta name="referrer" content="no-referrer">
<style>
:root{color-scheme:light dark;--bg:#f5f5f4;--card:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:rgba(0,0,0,.08);--ok:#1f9d55;--err:#c0392b;--btn:#161a00;--on-btn:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111;--card:#1c1c1c;--fg:#ececec;--muted:#a0a0a0;--line:rgba(255,255,255,.1);--ok:#3ecf7a;--err:#ff7b6b;--btn:#ececec;--on-btn:#161a00}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:16px}
.card{width:min(420px,100%);background:var(--card);border-radius:16px;box-shadow:0 0 0 1px var(--line),0 12px 40px rgba(0,0,0,.08);padding:32px 28px;text-align:center}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:600;font-size:15px;margin-bottom:24px}
.brand img{width:28px;height:28px;border-radius:7px}
.mark{width:48px;height:48px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center}
.mark.ok{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}.mark.err{background:color-mix(in srgb,var(--err) 14%,transparent);color:var(--err)}
.spin{width:28px;height:28px;margin:8px auto 16px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--fg);animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}}
h1{font-size:20px;margin:0 0 6px;letter-spacing:-.01em}p{margin:0;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 20px;margin:20px 0 12px;border:0;border-radius:10px;background:var(--btn);color:var(--on-btn);font:inherit;font-weight:500;cursor:pointer;text-decoration:none;width:100%}
.btn:focus-visible{outline:2px solid var(--fg);outline-offset:2px}.small{font-size:13px}.foot{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
[hidden]{display:none!important}
</style></head><body><main class="card" aria-live="polite">
<div class="brand"><img src="/callback/logo.png" alt="" onerror="this.remove()"><span>AnyModelBot</span></div>
<section id="pending"><div class="spin" aria-hidden="true"></div><h1>${s("account.page_pending_title")}</h1><p>${s("account.page_pending")}</p>
<noscript><p>${s("account.page_noscript")}</p></noscript></section>
<section id="done" hidden><div class="mark ok" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
<h1>${s("account.page_done_title")}</h1><p>${s("account.page_done")}</p>
<div id="app"${o.appLink ? "" : " hidden"}><button type="button" class="btn" id="open">${s("account.page_open")}</button>
<p class="small" id="hint">${s("account.page_open_hint")}</p><p class="small foot" id="retry">${s("account.page_open_retry")}</p>
<p class="small foot" id="returned" hidden>${s("account.page_returned")}</p></div>
<p class="small foot"${o.appLink ? " hidden" : ""}>${s("account.page_switch_back")}</p></section>
<section id="failed" hidden><div class="mark err" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></div>
<h1>${s("account.page_not_done_title")}</h1><p id="reason"></p><p class="small foot">${s("account.page_failed_back")}</p></section>
</main><script>
(function(){var d=${data},launched=false,returned=false;
function $(id){return document.getElementById(id)}
function show(id){["pending","done","failed"].forEach(function(x){$(x).hidden=x!==id})}
function launch(){if(!d.app)return;var a=document.createElement("a");a.href=d.app;a.rel="noopener";document.body.appendChild(a);a.click();a.remove()}
if($("open"))$("open").onclick=launch;
function poll(){fetch("/callback/status?state="+encodeURIComponent(d.state),{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){
 if(j.state==="pending"){setTimeout(poll,800);return}
 if(j.state==="failed"){$("reason").textContent=j.message||"";show("failed");return}
 show("done");if(!launched){launched=true;launch()}
 if(j.returned){returned=true;$("returned").hidden=false;$("hint").hidden=true;$("retry").hidden=true}
 if(d.app&&!returned)setTimeout(poll,1000)
}).catch(function(){setTimeout(poll,1500)})}
poll()})();
</script></body></html>`;
}

/**
 * 开始一次登录：在 127.0.0.1 的临时端口上等浏览器回调。state 不匹配的请求一律忽略（不结束这次登录），
 * 只接受第一次合法回调；超时（默认 10 分钟，与服务端授权请求的有效期一致）或取消时结束。
 * 合法回调先拿到"正在完成登录"的页面；换令牌 + finalize 都成功后页面才变成"登录成功"，失败时显示原因。
 * 成功后回环服务再留 RETURN_WINDOW_MS，只回答本页的状态查询和标志图片，然后关闭。
 */
export async function startLogin(ep: OidcEndpoints, o: LoginOptions): Promise<LoginAttempt> {
  const fetchImpl = o.fetchImpl ?? fetch;
  // 浏览器回调不在发起登录的那个请求里：语言在这里定下（授权页、回调页、报错都用它）
  const l = lang();
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(24));
  const returnNonce = b64url(crypto.randomBytes(16));
  const appLink = o.appLink ? `${o.appLink}${o.appLink.includes("?") ? "&" : "?"}r=${returnNonce}` : undefined;
  let settle: { resolve: (t: TokenSet) => void; reject: (e: Error) => void };
  const result = new Promise<TokenSet>((resolve, reject) => (settle = { resolve, reject }));
  // 浏览器可能在调用方挂上处理之前就回调失败；先标记为已处理，调用方照样能拿到这个拒绝
  result.catch(() => {});
  /** 已收到合法回调（或手动链接）：之后的回调一律忽略 */
  let accepted = false;
  /** 这次登录有了结论：成功页查询用 */
  let outcome: { state: "pending" | "done" | "failed"; message?: string } = { state: "pending" };
  let returned = false;
  let ended = false;
  let timer: NodeJS.Timeout | undefined;
  let closeTimer: NodeJS.Timeout | undefined;
  /** 授权之后的收尾被放弃（超时、在应用里取消）：finalize 据此在落地前撤销刚签发的东西 */
  const finalizing = new AbortController();
  const sameState = (v: string | null) => {
    if (!v) return false;
    const got = Buffer.from(v);
    const want = Buffer.from(state);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  };
  const close = () => {
    if (closeTimer) clearTimeout(closeTimer);
    server.closeAllConnections?.();
    server.close();
  };
  /** 收下一次合法回调（state 已核对）：有授权码就去换令牌并完成登录，否则结束这次登录 */
  const accept = (q: URLSearchParams) => {
    accepted = true;
    const error = q.get("error");
    const code = q.get("code");
    if (error || !code) {
      finish(new OAuthError(error || "invalid_request", error === "access_denied" ? tl(l, "account.denied") : q.get("error_description") || tl(l, "account.not_done")));
      return;
    }
    // 授权码到手：换令牌和 finalize 另有一个上限（FINALIZE_MS），卡住时以超时结束，不让登录一直挂着
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      finalizing.abort();
      finish(new OAuthError("timeout", tl(l, "account.login_timeout")));
    }, FINALIZE_MS);
    tokenRequest(ep.token, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: o.clientId, code_verifier: verifier }, fetchImpl)
      .then(async (t) => {
        if (ended) throw new OAuthError("timeout", tl(l, "account.login_timeout"));
        await o.finalize?.(t, finalizing.signal);
        return t;
      })
      .then(
        (t) => finish(undefined, t),
        (e) => finish(e as Error),
      );
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "GET") return void res.writeHead(404).end();
    // 成功页的状态查询：必须带着这次登录的 state，别的本机网页猜不到
    if (u.pathname === "/callback/status" && sameState(u.searchParams.get("state"))) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return void res.end(JSON.stringify({ ...outcome, returned }));
    }
    if (u.pathname === "/callback/logo.png") {
      const png = o.logo?.();
      if (!png) return void res.writeHead(404).end();
      return void res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=600" }).end(png);
    }
    if (u.pathname !== "/callback" || accepted || ended || !sameState(u.searchParams.get("state"))) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    const html = (status: number, page: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }).end(page);
    };
    const error = u.searchParams.get("error");
    if (error || !u.searchParams.get("code")) html(400, PAGE(l, tl(l, "account.page_not_done_title"), tl(l, error === "access_denied" ? "account.page_denied" : "account.page_not_done")));
    else html(200, callbackPage(l, { state, appLink }));
    accept(u.searchParams);
  });
  const finish = (err?: Error, tokens?: TokenSet) => {
    if (ended) return;
    ended = true;
    if (timer) clearTimeout(timer);
    outcome = err ? { state: "failed", message: err.message } : { state: "done" };
    if (err) settle.reject(err);
    else settle.resolve(tokens!);
    // 失败：成功页还要拿到失败原因，留一小会儿再关；成功：留着回答"是否已返回应用"
    closeTimer = setTimeout(close, err ? 15_000 : RETURN_WINDOW_MS);
    closeTimer.unref?.();
  };
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  timer = setTimeout(() => {
    finish(new OAuthError("timeout", tl(l, "account.login_timeout")));
    close();
  }, o.timeoutMs ?? 10 * 60_000);
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
      if (ended) return;
      // 正在完成登录时取消：finalize 在落地前看到取消，撤销这次授权和刚签发的 Key，不会过一会儿突然登录上
      finalizing.abort();
      finish(new OAuthError("cancelled", tl(l, "account.login_cancelled")));
    },
    complete: (link) => {
      if (accepted || ended) throw new OAuthError("expired", tl(l, "account.login_ended"));
      // 只看查询串：地址栏复制出来可能没有 http://，结尾可能带 #
      const raw = link.trim();
      const i = raw.indexOf("?");
      const q = new URLSearchParams(i >= 0 ? raw.slice(i + 1).split("#")[0] : "");
      if (!sameState(q.get("state"))) throw new OAuthError("invalid_link", tl(l, "account.login_link_invalid"));
      accept(q);
    },
    markReturned: (nonce) => {
      const a = Buffer.from(String(nonce));
      const b = Buffer.from(returnNonce);
      if (outcome.state !== "done" || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
      returned = true;
      return true;
    },
  };
}
