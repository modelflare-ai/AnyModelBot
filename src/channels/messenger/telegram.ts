import path from "node:path";
import { logger } from "../../log.js";
import { toTelegramHtml } from "./format.js";
import { PlatformError, fetchFile, readForUpload, type MessengerFile, type MessengerMessage, type MessengerTransport, type StateFn } from "./transport.js";

const log = logger("telegram");
/** 官方上限 4096（按解析后的文字算），留点余量 */
const MAX_TEXT = 4000;
/** Bot API 只能下载 20 MB 以内的文件 */
const MAX_DOWNLOAD = 20 * 1024 * 1024;
/** Bot API 只能上传 50 MB 以内的文件；图片单独是 10 MB */
const MAX_PHOTO = 10 * 1024 * 1024;
const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const POLL_SECONDS = 30;
const BACKOFF_MS = [2000, 5000, 15_000, 30_000];

/** getUpdates 的一条消息 → 归一化。不是消息、没有发送者时返回 undefined */
export function telegramMessage(u: any, download: (fileId: string) => Promise<Buffer>): MessengerMessage | undefined {
  const m = u?.message;
  if (!m?.chat || !m.from || m.from.is_bot) return undefined;
  const files: MessengerFile[] = [];
  const file = (type: MessengerFile["type"], fileId: string | undefined, name?: string) => {
    if (fileId) files.push({ type, ...(name ? { name } : {}), download: () => download(fileId) });
  };
  // 照片有好几种尺寸，最后一个最大
  if (Array.isArray(m.photo) && m.photo.length) file("image", m.photo.at(-1).file_id);
  if (m.document) file("file", m.document.file_id, m.document.file_name || "file");
  if (m.video) file("video", m.video.file_id);
  if (m.video_note) file("video", m.video_note.file_id);
  if (m.voice) file("voice", m.voice.file_id);
  if (m.audio) file("file", m.audio.file_id, m.audio.file_name || "audio");
  const reply = m.reply_to_message;
  const quote = m.quote?.text || reply?.text || reply?.caption;
  const text = String(m.text ?? m.caption ?? "");
  const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(" ") || m.from.username;
  return {
    id: `${m.chat.id}:${m.message_id}`,
    chatId: String(m.chat.id),
    dm: m.chat.type === "private",
    senderId: String(m.from.id),
    ...(name ? { senderName: String(name) } : {}),
    // 打开机器人时 Telegram 自动发 /start：回一段帮助，不用花钱问模型
    text: /^\/start(@\S+)?(\s|$)/.test(text) ? "/help" : text,
    files,
    ...(quote ? { quote: String(quote) } : {}),
    ...(m.sticker ? { unsupported: "sticker" } : {}),
  };
}

/** Telegram Bot API：长轮询收消息（离线时的消息平台留 24 小时，上线后接着收），不需要公网地址 */
export class TelegramTransport implements MessengerTransport {
  readonly id = "telegram" as const;
  readonly maxText = MAX_TEXT;
  private abort: AbortController | undefined;
  private loop: Promise<void> | undefined;

  constructor(
    private token: string,
    private o: {
      fetchImpl?: typeof fetch;
      baseUrl?: string;
      /** 收到哪了（存进库里，重启后接着收，不会重复） */
      offset?: { get: () => number; set: (n: number) => void };
      pollSeconds?: number;
      backoffMs?: readonly number[];
    } = {},
  ) {}

  private get base(): string {
    return this.o.baseUrl ?? "https://api.telegram.org";
  }
  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }

  private async call<T = any>(method: string, body: Record<string, unknown> | FormData = {}, signal?: AbortSignal): Promise<T> {
    const form = body instanceof FormData;
    const res = await this.fetch(`${this.base}/bot${this.token}/${method}`, {
      method: "POST",
      ...(form ? {} : { headers: { "content-type": "application/json" } }),
      body: form ? body : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(form ? 120_000 : 30_000),
    });
    const data = (await res.json().catch(() => undefined)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | undefined;
    if (data?.ok) return data.result as T;
    const code = data?.error_code ?? res.status;
    // 限流和服务器错误过一会儿就好；其余（聊天不存在、被拉黑、参数不对）重试也没用
    throw new PlatformError(`telegram ${method}: ${code} ${data?.description ?? ""}`.trim(), code < 500 && code !== 429, code === 401 || code === 404);
  }

  async verify(): Promise<{ name: string }> {
    const me = await this.call("getMe");
    return { name: me.username ? `@${me.username}` : String(me.first_name ?? "") };
  }

  async start(onMessage: (m: MessengerMessage) => void, onState: StateFn): Promise<void> {
    if (this.loop) return;
    const abort = (this.abort = new AbortController());
    this.loop = this.run(onMessage, onState, abort.signal).finally(() => (this.loop = undefined));
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.loop?.catch(() => {});
  }

  private async run(onMessage: (m: MessengerMessage) => void, onState: StateFn, signal: AbortSignal): Promise<void> {
    const backoff = this.o.backoffMs ?? BACKOFF_MS;
    let failures = 0;
    let offset = this.o.offset?.get() ?? 0;
    onState("connecting");
    // 配过 webhook 的机器人收不到长轮询，先清掉；失败了下面的 getUpdates 会报
    await this.call("deleteWebhook", {}, AbortSignal.any([signal, AbortSignal.timeout(30_000)])).catch(() => {});
    const seconds = this.o.pollSeconds ?? POLL_SECONDS;
    while (!signal.aborted) {
      try {
        // 比长轮询多等一会儿：连接悄悄断了（电脑睡醒、换网络）时不会一直挂着
        const limit = AbortSignal.any([signal, AbortSignal.timeout((seconds + 15) * 1000)]);
        const updates = await this.call<any[]>("getUpdates", { offset, timeout: seconds, allowed_updates: ["message"] }, limit);
        failures = 0;
        onState("connected");
        for (const u of updates) {
          offset = Math.max(offset, Number(u.update_id) + 1);
          const m = telegramMessage(u, (id) => this.download(id));
          if (m) onMessage(m);
        }
        if (updates.length) this.o.offset?.set(offset);
      } catch (e) {
        if (signal.aborted) return;
        const err = e as PlatformError;
        if (err.fatal) {
          onState("error", err.message, true);
          return;
        }
        onState("error", err.message);
        log.warn("getUpdates failed", { failures, message: err.message.slice(0, 200) });
        await sleep(backoff[Math.min(failures++, backoff.length - 1)], signal);
      }
    }
  }

  private async download(fileId: string): Promise<Buffer> {
    const f = await this.call("getFile", { file_id: fileId });
    return (await fetchFile(this.fetch, `${this.base}/file/bot${this.token}/${f.file_path}`, {}, MAX_DOWNLOAD)).buffer;
  }

  /** 发 HTML；转出来的格式 Telegram 不认（标签嵌套不对之类）就发原文 */
  private async formatted<T>(chunk: string, send: (fields: Record<string, unknown>) => Promise<T>): Promise<T> {
    try {
      return await send({ text: toTelegramHtml(chunk), parse_mode: "HTML" });
    } catch (e) {
      if (!/can't parse entities/i.test((e as Error).message)) throw e;
      return send({ text: chunk });
    }
  }

  async sendText(chatId: string, text: string): Promise<string> {
    const r = await this.formatted(text, (f) => this.call("sendMessage", { chat_id: chatId, link_preview_options: { is_disabled: true }, ...f }));
    return String(r.message_id);
  }

  async editText(chatId: string, messageId: string, text: string): Promise<void> {
    try {
      await this.formatted(text, (f) => this.call("editMessageText", { chat_id: chatId, message_id: Number(messageId), link_preview_options: { is_disabled: true }, ...f }));
    } catch (e) {
      // 内容没变：不算失败
      if (!/message is not modified/i.test((e as Error).message)) throw e;
    }
  }

  async sendFile(chatId: string, filePath: string, name: string): Promise<void> {
    const data = await readForUpload(filePath);
    const photo = PHOTO_EXT.has(path.extname(name).toLowerCase()) && data.length <= MAX_PHOTO;
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set(photo ? "photo" : "document", new Blob([new Uint8Array(data)]), name);
    await this.call(photo ? "sendPhoto" : "sendDocument", form);
  }

  async typing(chatId: string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });
}
