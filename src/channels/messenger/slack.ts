import WebSocket from "ws";
import { logger } from "../../log.js";
import { toSlackMrkdwn } from "./format.js";
import { PlatformError, fetchFile, readForUpload, type MessengerFile, type MessengerMessage, type MessengerTransport, type StateFn } from "./transport.js";

const log = logger("slack");
/** 官方建议一条不超过 4000 字 */
const MAX_TEXT = 3900;
const RECONNECT_MS = [1000, 5000, 15_000, 30_000];
/** 多久 ping 一次；两轮没回 pong 就当连接断了（断网、电脑睡醒后 TCP 可能一直不报错） */
const PING_MS = 30_000;
/** 这些错误重试也没用，也不是暂时的：凭据不对了 */
const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "account_inactive", "token_revoked", "token_expired", "not_allowed_token_type", "app_uninstalled"]);
/** 这些是暂时的：其余都算平台拒绝 */
const TRANSIENT_ERRORS = new Set(["ratelimited", "internal_error", "fatal_error", "service_unavailable", "request_timeout", "team_added_to_org"]);

/**
 * events_api 里的一个事件 → 归一化。只认真人发的消息：机器人自己的、改消息删消息这类系统事件都跳过。
 * 引用没有办法拿到原文（Slack 的回复事件不带被回复的内容）。
 */
export function slackMessage(ev: any, download: (url: string) => Promise<Buffer>): MessengerMessage | undefined {
  if (ev?.type !== "message" || !ev.user || !ev.channel || !ev.ts || ev.bot_id) return undefined;
  if (ev.subtype && ev.subtype !== "file_share") return undefined;
  const files: MessengerFile[] = [];
  for (const f of ev.files ?? []) {
    const url = f.url_private_download ?? f.url_private;
    if (!url) continue;
    const mime = String(f.mimetype ?? "");
    const type: MessengerFile["type"] = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";
    files.push({ type, ...(type === "file" ? { name: String(f.name ?? "file") } : {}), download: () => download(url) });
  }
  return {
    id: `${ev.channel}:${ev.ts}`,
    chatId: String(ev.channel),
    dm: ev.channel_type === "im",
    senderId: String(ev.user),
    text: String(ev.text ?? ""),
    files,
  };
}

/** Slack：Socket Mode 收消息（不需要公网地址），Web API 发消息 */
export class SlackTransport implements MessengerTransport {
  readonly id = "slack" as const;
  readonly maxText = MAX_TEXT;
  private socket: WebSocket | undefined;
  private stopped = true;
  private retry: NodeJS.Timeout | undefined;
  private ping: NodeJS.Timeout | undefined;
  private failures = 0;

  constructor(
    private botToken: string,
    private appToken: string,
    private o: { fetchImpl?: typeof fetch; baseUrl?: string; reconnectMs?: readonly number[]; pingMs?: number } = {},
  ) {}

  private get base(): string {
    return this.o.baseUrl ?? "https://slack.com/api";
  }
  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }

  private async call<T = any>(method: string, body: Record<string, unknown> = {}, token = this.botToken): Promise<T> {
    const res = await this.fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status >= 500) throw new PlatformError(`slack ${method}: HTTP ${res.status}`);
    const data = (await res.json().catch(() => undefined)) as ({ ok?: boolean; error?: string } & T) | undefined;
    if (data?.ok) return data;
    const code = data?.error ?? `HTTP ${res.status}`;
    throw new PlatformError(`slack ${method}: ${code}`, !TRANSIENT_ERRORS.has(code), AUTH_ERRORS.has(code));
  }

  async verify(): Promise<{ name: string }> {
    if (!this.botToken.startsWith("xoxb-")) throw new PlatformError("Slack: the bot token starts with xoxb-", true);
    if (!this.appToken.startsWith("xapp-")) throw new PlatformError("Slack: the app-level token starts with xapp-", true);
    const me = await this.call("auth.test");
    await this.call("apps.connections.open", {}, this.appToken);
    return { name: [me.user ? `@${me.user}` : "", me.team].filter(Boolean).join(" · ") };
  }

  async start(onMessage: (m: MessengerMessage) => void, onState: StateFn): Promise<void> {
    this.stopped = false;
    onState("connecting");
    void this.connect(onMessage, onState);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    this.socket?.terminate();
    this.socket = undefined;
  }

  private reconnect(onMessage: (m: MessengerMessage) => void, onState: StateFn): void {
    if (this.stopped) return;
    clearInterval(this.ping);
    const delays = this.o.reconnectMs ?? RECONNECT_MS;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.connect(onMessage, onState), delays[Math.min(this.failures++, delays.length - 1)]);
    this.retry.unref?.();
  }

  private async connect(onMessage: (m: MessengerMessage) => void, onState: StateFn): Promise<void> {
    if (this.stopped) return;
    let url: string;
    try {
      ({ url } = await this.call<{ url: string }>("apps.connections.open", {}, this.appToken));
    } catch (e) {
      const err = e as PlatformError;
      // Socket Mode 没开、app token 失效：要用户去改设置，一直重连没有意义
      if (err.fatal || err.rejected) return onState("error", err.message, true);
      onState("error", err.message);
      return this.reconnect(onMessage, onState);
    }
    if (this.stopped) return;
    const socket = (this.socket = new WebSocket(url));
    let alive = true;
    socket.on("pong", () => (alive = true));
    socket.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "hello") {
        this.failures = 0;
        onState("connected");
        clearInterval(this.ping);
        this.ping = setInterval(() => {
          if (!alive) return socket.terminate();
          alive = false;
          socket.ping();
        }, this.o.pingMs ?? PING_MS);
        this.ping.unref?.();
      } else if (msg.type === "disconnect") {
        // Slack 要换连接了：关掉，走重连
        socket.close();
      } else if (msg.envelope_id) {
        // 三秒内要回执，否则 Slack 会重发；处理在队列里做
        socket.send(JSON.stringify({ envelope_id: msg.envelope_id }));
        if (msg.type === "events_api") {
          const m = slackMessage(msg.payload?.event, (u) => this.download(u));
          if (m) onMessage(m);
        }
      }
    });
    socket.on("error", (e) => log.warn("socket error", { message: e.message.slice(0, 200) }));
    socket.on("close", () => {
      if (this.socket !== socket || this.stopped) return;
      onState("connecting", "reconnecting");
      this.reconnect(onMessage, onState);
    });
  }

  private async download(url: string): Promise<Buffer> {
    const { buffer, contentType } = await fetchFile(this.fetch, url, { headers: { authorization: `Bearer ${this.botToken}` } });
    // 没有 files:read 权限时 Slack 不报错，返回登录页
    if (contentType.startsWith("text/html")) throw new Error("the Slack app needs the files:read scope");
    return buffer;
  }

  async sendText(chatId: string, text: string): Promise<string> {
    const r = await this.call<{ ts: string }>("chat.postMessage", { channel: chatId, text: toSlackMrkdwn(text), unfurl_links: false, unfurl_media: false });
    return r.ts;
  }

  async editText(chatId: string, messageId: string, text: string): Promise<void> {
    await this.call("chat.update", { channel: chatId, ts: messageId, text: toSlackMrkdwn(text) });
  }

  /** 三步：要一个上传地址 → 传上去 → 发到会话 */
  async sendFile(chatId: string, filePath: string, name: string): Promise<void> {
    const data = await readForUpload(filePath);
    const form = new URLSearchParams({ filename: name, length: String(data.length) });
    const res = await this.fetch(`${this.base}/files.getUploadURLExternal`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.botToken}`, "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const up = (await res.json().catch(() => undefined)) as { ok?: boolean; error?: string; upload_url?: string; file_id?: string } | undefined;
    if (!up?.ok || !up.upload_url || !up.file_id) throw new PlatformError(`slack files.getUploadURLExternal: ${up?.error ?? `HTTP ${res.status}`}`, !TRANSIENT_ERRORS.has(up?.error ?? "") && res.status < 500);
    const put = await this.fetch(up.upload_url, { method: "POST", body: new Uint8Array(data), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) throw new PlatformError(`slack file upload: HTTP ${put.status}`);
    await this.call("files.completeUploadExternal", { files: [{ id: up.file_id, title: name }], channel_id: chatId });
  }
}
