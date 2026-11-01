import WebSocket from "ws";
import { logger } from "../../log.js";
import { PlatformError, fetchFile, readForUpload, type MessengerFile, type MessengerMessage, type MessengerTransport, type StateFn } from "./transport.js";
import { fenceTables } from "./format.js";

const log = logger("discord");
/** 官方上限 2000 */
const MAX_TEXT = 1950;
/** 没有 Nitro 的机器人一次最多传 10 MB */
const MAX_UPLOAD = 10 * 1024 * 1024;
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
/** 只要单聊消息。单聊里的正文不需要 Message Content 这个特权 intent */
const INTENT_DIRECT_MESSAGES = 1 << 12;
const RECONNECT_MS = [1000, 5000, 15_000, 30_000];
/** token 不对、intent 不对这些：重连也没用（官方文档的 close code 列表） */
const FATAL_CLOSE = new Map<number, string>([
  [4004, "the bot token was rejected"],
  [4010, "invalid shard"],
  [4011, "sharding required"],
  [4012, "invalid API version"],
  [4013, "invalid intents"],
  [4014, "disallowed intents"],
]);

/** MESSAGE_CREATE → 归一化。机器人（包括自己）发的跳过 */
export function discordMessage(d: any, download: (url: string) => Promise<Buffer>): MessengerMessage | undefined {
  if (!d?.id || !d.channel_id || !d.author || d.author.bot) return undefined;
  const files: MessengerFile[] = [];
  for (const a of d.attachments ?? []) {
    if (!a.url) continue;
    const mime = String(a.content_type ?? "");
    const type: MessengerFile["type"] = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";
    files.push({ type, ...(type === "file" ? { name: String(a.filename ?? "file") } : {}), download: () => download(a.url) });
  }
  const name = d.author.global_name || d.author.username;
  const quote = d.referenced_message?.content;
  return {
    id: String(d.id),
    chatId: String(d.channel_id),
    // 服务器里的消息带 guild_id
    dm: !d.guild_id,
    senderId: String(d.author.id),
    ...(name ? { senderName: String(name) } : {}),
    text: String(d.content ?? ""),
    files,
    ...(quote ? { quote: String(quote) } : {}),
  };
}

/** Discord：Gateway 长连接收消息（不需要公网地址），REST 发消息 */
export class DiscordTransport implements MessengerTransport {
  readonly id = "discord" as const;
  readonly maxText = MAX_TEXT;
  private socket: WebSocket | undefined;
  private stopped = true;
  private retry: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private failures = 0;
  /** 断线后接着上次的位置（RESUME），期间的消息平台会补发 */
  private session: { id: string; url: string } | undefined;
  private seq: number | null = null;

  constructor(
    private token: string,
    private o: { fetchImpl?: typeof fetch; baseUrl?: string; gatewayUrl?: string; reconnectMs?: readonly number[] } = {},
  ) {}

  private get base(): string {
    return this.o.baseUrl ?? "https://discord.com/api/v10";
  }
  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }

  private async call<T = any>(method: string, route: string, body?: Record<string, unknown> | FormData): Promise<T> {
    const form = body instanceof FormData;
    const res = await this.fetch(`${this.base}${route}`, {
      method,
      headers: { authorization: `Bot ${this.token}`, "user-agent": "DiscordBot (https://anymodel.bot, 1)", ...(body && !form ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(form ? 120_000 : 30_000),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => undefined)) as (T & { message?: string }) | undefined;
    if (res.ok) return data as T;
    // 限流和服务器错误过一会儿就好；其余（没有权限、消息没了、对方关了私信）重试也没用
    throw new PlatformError(`discord ${method} ${route}: ${res.status} ${data?.message ?? ""}`.trim(), res.status < 500 && res.status !== 429, res.status === 401);
  }

  async verify(): Promise<{ name: string }> {
    const me = await this.call("GET", "/users/@me");
    return { name: String(me.username ?? "") };
  }

  async start(onMessage: (m: MessengerMessage) => void, onState: StateFn): Promise<void> {
    this.stopped = false;
    onState("connecting");
    this.connect(onMessage, onState);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.socket?.terminate();
    this.socket = undefined;
    this.session = undefined;
    this.seq = null;
  }

  private connect(onMessage: (m: MessengerMessage) => void, onState: StateFn): void {
    if (this.stopped) return;
    const socket = (this.socket = new WebSocket(this.session?.url ?? this.o.gatewayUrl ?? GATEWAY));
    let acked = true;
    const send = (op: number, d: unknown) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ op, d }));
    socket.on("message", (raw) => {
      let p: any;
      try {
        p = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof p.s === "number") this.seq = p.s;
      switch (p.op) {
        case 10: {
          // HELLO：开始心跳，然后登录或接上次的会话
          clearInterval(this.heartbeat);
          acked = true;
          this.heartbeat = setInterval(() => {
            // 上一次心跳没回：连接已经断了（官方要求这时重连）
            if (!acked) return socket.terminate();
            acked = false;
            send(1, this.seq);
          }, Number(p.d?.heartbeat_interval ?? 41_250));
          this.heartbeat.unref?.();
          if (this.session) send(6, { token: this.token, session_id: this.session.id, seq: this.seq });
          else send(2, { token: this.token, intents: INTENT_DIRECT_MESSAGES, properties: { os: process.platform, browser: "anymodel-bot", device: "anymodel-bot" } });
          return;
        }
        case 11:
          acked = true;
          return;
        case 1:
          send(1, this.seq);
          return;
        case 7:
          // 平台要我们换连接：断开，走重连（RESUME）
          socket.close(4000);
          return;
        case 9:
          // 会话失效：能不能接上由 d 决定，不能就重新登录
          if (!p.d) {
            this.session = undefined;
            this.seq = null;
          }
          socket.close(4000);
          return;
        case 0:
          if (p.t === "READY") {
            this.session = { id: String(p.d.session_id), url: `${String(p.d.resume_gateway_url ?? GATEWAY).replace(/\/$/, "")}/?v=10&encoding=json` };
            this.failures = 0;
            onState("connected");
          } else if (p.t === "RESUMED") {
            this.failures = 0;
            onState("connected");
          } else if (p.t === "MESSAGE_CREATE") {
            const m = discordMessage(p.d, (u) => this.download(u));
            if (m) onMessage(m);
          }
          return;
      }
    });
    socket.on("error", (e) => log.warn("gateway error", { message: e.message.slice(0, 200) }));
    socket.on("close", (code) => {
      if (this.socket !== socket || this.stopped) return;
      clearInterval(this.heartbeat);
      const fatal = FATAL_CLOSE.get(code);
      if (fatal) return onState("error", `discord gateway: ${fatal}`, true);
      // 这两种接不上了，重新登录
      if (code === 4007 || code === 4009) {
        this.session = undefined;
        this.seq = null;
      }
      onState("connecting", "reconnecting");
      const delays = this.o.reconnectMs ?? RECONNECT_MS;
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(onMessage, onState), delays[Math.min(this.failures++, delays.length - 1)]);
      this.retry.unref?.();
    });
  }

  private async download(url: string): Promise<Buffer> {
    return (await fetchFile(this.fetch, url)).buffer;
  }

  async sendText(chatId: string, text: string, key?: string): Promise<string> {
    // nonce：平台几分钟内对同一 nonce 只发一次（重试不会重复）；不让消息里的 @ 真的提醒到人
    const r = await this.call<{ id: string }>("POST", `/channels/${chatId}/messages`, {
      content: fenceTables(text),
      allowed_mentions: { parse: [] },
      ...(key ? { nonce: key.slice(0, 25), enforce_nonce: true } : {}),
    });
    return r.id;
  }

  async editText(chatId: string, messageId: string, text: string): Promise<void> {
    await this.call("PATCH", `/channels/${chatId}/messages/${messageId}`, { content: fenceTables(text), allowed_mentions: { parse: [] } });
  }

  async sendFile(chatId: string, filePath: string, name: string): Promise<void> {
    const data = await readForUpload(filePath, MAX_UPLOAD);
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ allowed_mentions: { parse: [] } }));
    form.set("files[0]", new Blob([new Uint8Array(data)]), name);
    await this.call("POST", `/channels/${chatId}/messages`, form);
  }

  async typing(chatId: string): Promise<void> {
    await this.call("POST", `/channels/${chatId}/typing`);
  }
}
