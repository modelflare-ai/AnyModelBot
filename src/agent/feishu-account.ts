/**
 * 飞书账号（accounts.ts）：用用户身份读这个人能看到的会话和消息，只读。和飞书聊天渠道（channels/feishu）是两回事：
 * 渠道是机器人自己的应用，只能看到发给机器人的消息。
 *
 * 添加账号（和官方 lark-cli 同一套流程）：
 * 1. 一键授权：用飞书扫码，飞书替用户创建一个个人应用，回 App ID 和 Secret。也可以填已有的自建应用，跳过这一步。
 * 2. 设备授权：用户再确认一次，把读消息的权限授给这个应用，回 user_access_token 和 refresh token。
 * 页面和桌面版都轮询流程状态（flow），不需要回调地址。
 */
import crypto from "node:crypto";
import QRCode from "qrcode";
import { logger } from "../log.js";
import { AccountStore, ConnectionError, capped, clampLimit, wait, type ConnectedAccount, type FeishuBrand, type FeishuUserAuth } from "./accounts.js";

const log = logger("agent.feishu-account");

const HOSTS: Record<FeishuBrand, { accounts: string; open: string }> = {
  feishu: { accounts: "https://accounts.feishu.cn", open: "https://open.feishu.cn" },
  lark: { accounts: "https://accounts.larksuite.com", open: "https://open.larksuite.com" },
};
/** 读会话、读群聊和单聊消息、搜消息；offline_access 才有 refresh token */
export const FEISHU_SCOPES = "offline_access im:chat:read im:message.group_msg:get_as_user im:message.p2p_msg:get_as_user search:message";
const TIMEOUT_MS = 30_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
const MAX_POLL_S = 60;
/** 飞书说令牌无效或过期的错误码：换一次令牌再试 */
const TOKEN_CODES = new Set([99991663, 99991668, 99991677, 20005]);
const RECONNECT = "Ask the user to re-authorize this account in Settings > Connections.";

/** 模型给的时间（ISO 或日期）转成秒。空就不限 */
function seconds(v: unknown, name: string): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const ms = Date.parse(v.trim());
  if (Number.isNaN(ms)) throw new ConnectionError(`${name} isn't a date. Use a form like 2026-11-01 or 2026-11-01T09:00:00+08:00.`, 400);
  return String(Math.floor(ms / 1000));
}

/** 消息内容转成一行文字。飞书的内容是 JSON，各类型结构不同；图片、文件这些只说是什么 */
export function messageText(m: any): string {
  if (m?.deleted) return "[deleted]";
  const type = String(m?.msg_type ?? "");
  let body: any;
  try {
    body = JSON.parse(String(m?.body?.content ?? ""));
  } catch {
    return String(m?.body?.content ?? "");
  }
  let text: string;
  switch (type) {
    case "text":
      text = String(body?.text ?? "");
      break;
    case "post": {
      const post = body?.content ? body : (Object.values(body ?? {})[0] as any);
      const lines = (Array.isArray(post?.content) ? post.content : []).map((line: any[]) =>
        (Array.isArray(line) ? line : []).map((el) => el?.text ?? (el?.tag === "img" ? "[image]" : el?.user_name ?? "")).join(""),
      );
      text = [post?.title, ...lines].filter(Boolean).join("\n");
      break;
    }
    case "image":
      text = "[image]";
      break;
    case "file":
      text = `[file: ${body?.file_name ?? ""}]`;
      break;
    case "audio":
      text = "[voice message]";
      break;
    case "media":
      text = `[video: ${body?.file_name ?? ""}]`;
      break;
    case "sticker":
      text = "[sticker]";
      break;
    case "interactive":
      text = "[card message]";
      break;
    case "merge_forward":
      text = "[forwarded messages]";
      break;
    case "system":
      text = "[system message]";
      break;
    default:
      text = `[${type || "message"}]`;
  }
  for (const mention of Array.isArray(m?.mentions) ? m.mentions : []) {
    if (mention?.key && mention?.name) text = text.replaceAll(mention.key, `@${mention.name}`);
  }
  return text;
}

function messageLine(m: any, withChat = false): string {
  const when = new Date(Number(m?.create_time) || 0).toISOString().slice(0, 16).replace("T", " ");
  const who = m?.sender?.sender_name ?? m?.sender?.name ?? m?.sender?.id ?? "unknown";
  return `[${when} UTC] ${who}${withChat && m?.chat_id ? ` (chat ${m.chat_id})` : ""}: ${messageText(m)}`;
}

export type FeishuFlowState = "create-app" | "authorize" | "done" | "failed";
export interface FeishuFlowView {
  id: string;
  state: FeishuFlowState;
  /** 要用户打开或扫码的地址 */
  url: string;
  qr: string;
  error: string;
  label: string;
}
interface Flow extends FeishuFlowView {
  abort: AbortController;
}

export interface FeishuAccountsOptions {
  accounts: AccountStore;
  fetch?: () => typeof fetch | undefined;
  timeoutMs?: number;
}

export class FeishuAccounts {
  private refreshing = new Map<string, Promise<string>>();
  private flows = new Map<string, Flow>();

  constructor(private o: FeishuAccountsOptions) {}

  private send(): typeof fetch {
    return this.o.fetch?.() ?? fetch;
  }
  private deadline(signal?: AbortSignal): AbortSignal {
    const timer = AbortSignal.timeout(this.o.timeoutMs ?? TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timer]) : timer;
  }

  /** 执行一次工具调用，回给模型看的文字 */
  async run(account: ConnectedAccount, op: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    switch (op) {
      case "chats":
        return this.chats(account, args, signal);
      case "read":
        return this.read(account, args, signal);
      case "search":
        return this.search(account, args, signal);
      default:
        throw new ConnectionError(`Unknown Feishu operation: ${op}`);
    }
  }

  private async chats(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const size = clampLimit(args.limit, 20, 100);
    const cursor = typeof args.cursor === "string" && args.cursor ? `&page_token=${encodeURIComponent(args.cursor)}` : "";
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const data = query
      ? await this.api(account, "POST", `/open-apis/im/v2/chats/search?page_size=${size}${cursor}`, { query }, signal)
      : await this.api(account, "GET", `/open-apis/im/v1/chats?page_size=${size}&sort_type=ByActiveTimeDesc&types=p2p,group&user_id_type=open_id${cursor}`, undefined, signal);
    const items: any[] = (Array.isArray(data?.items) ? data.items : []).map((x: any) => x?.meta_data ?? x);
    if (!items.length) return "No chats found.";
    return capped(
      [
        ...items.map((c) => `- ${c?.name || "(direct message)"} | ${c?.chat_mode ?? "chat"} | chat_id: ${c?.chat_id}`),
        ...(data?.has_more && data?.page_token ? [`More chats: call again with cursor "${data.page_token}".`] : []),
      ].join("\n"),
    );
  }

  private async read(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const chat = typeof args.chat_id === "string" ? args.chat_id.trim() : "";
    if (!chat) throw new ConnectionError("Missing chat_id. feishu_list_chats lists the chats.", 400);
    const params = new URLSearchParams({
      container_id_type: "chat",
      container_id: chat,
      sort_type: "ByCreateTimeDesc",
      page_size: String(clampLimit(args.limit, 20, 50)),
      card_msg_content_type: "raw_card_content",
      with_sender_name: "true",
      user_id_type: "open_id",
    });
    const start = seconds(args.start, "start");
    const end = seconds(args.end, "end");
    if (start) params.set("start_time", start);
    if (end) params.set("end_time", end);
    if (typeof args.cursor === "string" && args.cursor) params.set("page_token", args.cursor);
    const data = await this.api(account, "GET", `/open-apis/im/v1/messages?${params}`, undefined, signal);
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return "No messages in this chat for that time.";
    return capped(
      [
        "Newest first:",
        ...items.map((m) => messageLine(m)),
        ...(data?.has_more && data?.page_token ? [`Older messages: call again with cursor "${data.page_token}".`] : []),
      ].join("\n"),
    );
  }

  private async search(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const filter: Record<string, unknown> = {};
    const time: Record<string, string> = {};
    if (seconds(args.start, "start")) time.start_time = String(args.start).trim();
    if (seconds(args.end, "end")) time.end_time = String(args.end).trim();
    if (Object.keys(time).length) filter.time_range = time;
    if (typeof args.chat_id === "string" && args.chat_id.trim()) filter.chat_ids = [args.chat_id.trim()];
    const cursor = typeof args.cursor === "string" && args.cursor ? `&page_token=${encodeURIComponent(args.cursor)}` : "";
    const found = await this.api(
      account,
      "POST",
      `/open-apis/im/v1/messages/search?page_size=${clampLimit(args.limit, 20, 50)}${cursor}`,
      { query: typeof args.query === "string" ? args.query : "", ...(Object.keys(filter).length ? { filter } : {}) },
      signal,
    );
    const ids: string[] = (Array.isArray(found?.items) ? found.items : []).map((x: any) => x?.meta_data?.message_id).filter(Boolean);
    if (!ids.length) return "No matching messages.";
    const params = new URLSearchParams({ card_msg_content_type: "raw_card_content", with_sender_name: "true", user_id_type: "open_id" });
    for (const id of ids) params.append("message_ids", id);
    const details = await this.api(account, "GET", `/open-apis/im/v1/messages/mget?${params}`, undefined, signal);
    const items: any[] = Array.isArray(details?.items) ? details.items : [];
    return capped(
      [
        ...items.map((m) => messageLine(m, true)),
        ...(found?.has_more && found?.page_token ? [`More results: call again with cursor "${found.page_token}".`] : []),
      ].join("\n"),
    );
  }

  private auth(account: ConnectedAccount): FeishuUserAuth {
    const auth = this.o.accounts.get(account.id)?.auth ?? account.auth;
    if (auth.kind !== "feishu-user") throw new ConnectionError("This isn't a Feishu account.");
    return auth;
  }

  private async api(account: ConnectedAccount, method: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<any> {
    const route = path.split("?")[0];
    for (let attempt = 0; ; attempt++) {
      const auth = this.auth(account);
      const token = await this.token(account, signal, attempt > 0);
      let res: Response;
      try {
        res = await this.send()(HOSTS[auth.brand].open + path, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: this.deadline(signal),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        log.warn("feishu request failed", { route });
        throw new ConnectionError("Could not reach Feishu. Try again in a moment.");
      }
      const data: any = await res.json().catch(() => undefined);
      const code = Number(data?.code ?? (res.ok ? 0 : res.status));
      if (code === 0) {
        if (this.o.accounts.get(account.id)?.needsReauth) this.o.accounts.update(account.id, { needsReauth: false });
        return data?.data;
      }
      if ((TOKEN_CODES.has(code) || res.status === 401) && attempt === 0) continue;
      log.warn("feishu request refused", { route, status: res.status, code });
      if (TOKEN_CODES.has(code) || res.status === 401) {
        this.o.accounts.update(account.id, { needsReauth: true });
        throw new ConnectionError(`Feishu rejected this account's sign-in. ${RECONNECT}`, 401);
      }
      throw new ConnectionError(`Feishu refused the request (${code}): ${String(data?.msg ?? "").slice(0, 300)}`, res.status);
    }
  }

  private token(account: ConnectedAccount, signal: AbortSignal | undefined, force: boolean): Promise<string> {
    const auth = this.auth(account);
    if (!force && auth.expiresAt - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(auth.accessToken);
    let job = this.refreshing.get(account.id);
    if (!job) {
      job = this.refresh(account, signal).finally(() => this.refreshing.delete(account.id));
      this.refreshing.set(account.id, job);
    }
    return job;
  }

  /** 换令牌。refresh token 每次都会变，同一账号排队，新的马上落盘 */
  private async refresh(account: ConnectedAccount, signal: AbortSignal | undefined): Promise<string> {
    const auth = this.auth(account);
    let data: any;
    let status = 0;
    try {
      const res = await this.send()(`${HOSTS[auth.brand].open}/open-apis/authen/v2/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: auth.refreshToken, client_id: auth.appId, client_secret: auth.appSecret }),
        signal: this.deadline(signal),
      });
      status = res.status;
      data = await res.json().catch(() => undefined);
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ConnectionError("Could not reach Feishu. Try again in a moment.");
    }
    if (data?.access_token) {
      this.o.accounts.update(account.id, {
        needsReauth: false,
        auth: { ...auth, accessToken: data.access_token, refreshToken: data.refresh_token || auth.refreshToken, expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 },
      });
      return data.access_token;
    }
    if (status >= 500 || status === 429) throw new ConnectionError("Feishu is temporarily unavailable. Try again in a moment.", status);
    log.warn("feishu token refresh failed", { status, code: String(data?.code ?? data?.error ?? "") });
    this.o.accounts.update(account.id, { needsReauth: true });
    throw new ConnectionError(`This Feishu account's authorization has expired. ${RECONNECT}`, 401);
  }

  // ---------- 添加账号 ----------

  /** 开始添加：给了 App ID 和 Secret 就用已有的应用，否则一键创建 */
  startFlow(app?: { appId: string; appSecret: string; brand?: FeishuBrand }): FeishuFlowView {
    for (const [k, f] of this.flows) if (f.state === "done" || f.state === "failed") this.flows.delete(k);
    const flow: Flow = { id: crypto.randomBytes(12).toString("hex"), state: app ? "authorize" : "create-app", url: "", qr: "", error: "", label: "", abort: new AbortController() };
    this.flows.set(flow.id, flow);
    this.runFlow(flow, app).catch((e) => {
      if (flow.abort.signal.aborted) return;
      flow.state = "failed";
      flow.error = e instanceof ConnectionError ? e.message : "Feishu didn't complete the authorization. Try again.";
      log.warn("feishu flow failed", { reason: e instanceof Error ? e.message : String(e) });
    });
    return this.view(flow);
  }

  flow(id: string): FeishuFlowView | undefined {
    const f = this.flows.get(id);
    return f && this.view(f);
  }

  cancelFlow(id: string): void {
    this.flows.get(id)?.abort.abort();
    this.flows.delete(id);
  }

  private view(f: Flow): FeishuFlowView {
    return { id: f.id, state: f.state, url: f.url, qr: f.qr, error: f.error, label: f.label };
  }

  private async showUrl(flow: Flow, state: FeishuFlowState, url: string): Promise<void> {
    flow.state = state;
    flow.url = url;
    flow.qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
  }

  private async form(url: string, fields: Record<string, string>, signal: AbortSignal, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
    const res = await this.send()(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
      signal: this.deadline(signal),
    });
    return { status: res.status, data: await res.json().catch(() => undefined) };
  }

  private async runFlow(flow: Flow, app?: { appId: string; appSecret: string; brand?: FeishuBrand }): Promise<void> {
    const signal = flow.abort.signal;
    const creds = app ? { appId: app.appId, appSecret: app.appSecret, brand: app.brand ?? ("feishu" as FeishuBrand) } : await this.createApp(flow, signal);
    const tokens = await this.authorize(flow, creds, signal);
    const me = await this.send()(`${HOSTS[creds.brand].open}/open-apis/authen/v1/user_info`, { headers: { authorization: `Bearer ${tokens.accessToken}` }, signal: this.deadline(signal) })
      .then((r) => r.json())
      .catch(() => undefined);
    const info = (me as any)?.data ?? {};
    const account = this.o.accounts.upsert({
      service: "feishu",
      label: String(info.name || info.en_name || "Feishu"),
      identity: `${creds.brand}:${info.open_id || crypto.createHash("sha256").update(tokens.refreshToken).digest("hex").slice(0, 16)}`,
      auth: { kind: "feishu-user", brand: creds.brand, appId: creds.appId, appSecret: creds.appSecret, ...tokens },
    });
    flow.label = account.label;
    flow.url = "";
    flow.qr = "";
    flow.state = "done";
    log.info("feishu account added", { brand: creds.brand });
  }

  /** 第 1 步：飞书替用户创建个人应用。飞书和 Lark 从同一个入口开始，轮询时飞书会告诉我们该换到哪个品牌 */
  private async createApp(flow: Flow, signal: AbortSignal): Promise<{ appId: string; appSecret: string; brand: FeishuBrand }> {
    const begin = await this.form(`${HOSTS.feishu.accounts}/oauth/v1/app/registration`, { action: "begin", archetype: "PersonalAgent", auth_method: "client_secret", request_user_info: "open_id tenant_brand" }, signal);
    const device = String(begin.data?.device_code ?? "");
    if (!device) throw new ConnectionError("Feishu refused to start. Try again, or use an app you already have.");
    // 官方 CLI 也是自己拼这个页面地址，不用接口回的 verification_uri
    await this.showUrl(flow, "create-app", begin.data.user_code ? `${HOSTS.feishu.open}/page/cli?user_code=${encodeURIComponent(String(begin.data.user_code))}&from=cli` : String(begin.data.verification_uri_complete ?? begin.data.verification_uri ?? ""));
    let brand: FeishuBrand = "feishu";
    let interval = Number(begin.data.interval) || 5;
    const until = Date.now() + (Number(begin.data.expire_in ?? begin.data.expires_in) || 600) * 1000;
    let first = false;
    while (Date.now() < until) {
      if (first) await wait(interval * 1000, signal);
      first = true;
      let data: any;
      try {
        data = (await this.form(`${HOSTS[brand].accounts}/oauth/v1/app/registration`, { action: "poll", device_code: device }, signal)).data;
      } catch (e) {
        if (signal.aborted) throw e;
        interval = Math.min(interval + 1, MAX_POLL_S);
        continue;
      }
      const tenant = data?.user_info?.tenant_brand;
      if ((tenant === "lark" || tenant === "feishu") && tenant !== brand) {
        brand = tenant;
        first = false;
        continue;
      }
      if (data?.client_id && data?.client_secret) return { appId: String(data.client_id), appSecret: String(data.client_secret), brand };
      switch (data?.error) {
        case undefined:
        case "authorization_pending":
          break;
        case "slow_down":
          interval = Math.min(interval + 5, MAX_POLL_S);
          break;
        case "access_denied":
          throw new ConnectionError("You declined in Feishu.");
        default:
          throw new ConnectionError("The QR code expired. Try again.");
      }
    }
    throw new ConnectionError("The QR code expired. Try again.");
  }

  /** 第 2 步：设备授权，用户确认后拿到用户身份的令牌 */
  private async authorize(flow: Flow, app: { appId: string; appSecret: string; brand: FeishuBrand }, signal: AbortSignal): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
    const basic = Buffer.from(`${app.appId}:${app.appSecret}`).toString("base64");
    const begin = await this.form(`${HOSTS[app.brand].accounts}/oauth/v1/device_authorization`, { client_id: app.appId, scope: FEISHU_SCOPES }, signal, { authorization: `Basic ${basic}` });
    if (!begin.data?.device_code) {
      log.warn("feishu device authorization refused", { status: begin.status, error: String(begin.data?.error ?? begin.data?.code ?? "") });
      throw new ConnectionError("Feishu refused this app. Check the App ID and Secret, and that the app has the message permissions.");
    }
    await this.showUrl(flow, "authorize", String(begin.data.verification_uri_complete || begin.data.verification_uri));
    let interval = Number(begin.data.interval) || 5;
    const until = Date.now() + (Number(begin.data.expires_in) || 240) * 1000;
    while (Date.now() < until) {
      await wait(interval * 1000, signal);
      let data: any;
      try {
        data = (await this.form(`${HOSTS[app.brand].open}/open-apis/authen/v2/oauth/token`, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: String(begin.data.device_code), client_id: app.appId, client_secret: app.appSecret }, signal)).data;
      } catch (e) {
        if (signal.aborted) throw e;
        interval = Math.min(interval + 1, MAX_POLL_S);
        continue;
      }
      if (data?.access_token) {
        if (!data.refresh_token) throw new ConnectionError("Feishu didn't give a long-lived sign-in. Try again.");
        return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000 };
      }
      switch (data?.error) {
        case "authorization_pending":
          break;
        case "slow_down":
          interval = Math.min(interval + 5, MAX_POLL_S);
          break;
        case "access_denied":
          throw new ConnectionError("You declined in Feishu.");
        case "expired_token":
        case "invalid_grant":
          throw new ConnectionError("The authorization expired. Try again.");
        default:
          log.warn("feishu token poll refused", { code: String(data?.code ?? ""), error: String(data?.error ?? "") });
          throw new ConnectionError("Feishu didn't complete the authorization. Try again.");
      }
    }
    throw new ConnectionError("The authorization expired. Try again.");
  }
}
