/*
 * iLink Bot API 客户端（微信官方 ClawBot 通道）。
 * 协议细节移植自 Tencent/openclaw-weixin (src/api/api.ts, src/auth/login-qr.ts, src/cdn/*.ts, src/messaging/send.ts, v2.4.10)，
 * 精简并改写为可注入 baseUrl/fetch 的类。
 * Portions Copyright (C) 2026 Tencent. All rights reserved. Licensed under the MIT, see ./LICENSE.openclaw-weixin.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ILINK_APP_ID = "bot";
export const DEFAULT_ILINK_BASE = "https://ilinkai.weixin.qq.com";
export const DEFAULT_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
/** proto: UploadMediaType */
export const UploadMediaType = { IMAGE: 1, VIDEO: 2, FILE: 3 } as const;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);
export function mediaKind(file: string): "image" | "video" | "file" {
  const ext = path.extname(file).toLowerCase();
  return IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : "file";
}

/** AES-128-ECB（PKCS7）加密，CDN 上传要求。 */
export function encryptAesEcb(plain: Buffer, key: Buffer): Buffer {
  const c = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([c.update(plain), c.final()]);
}
export function decryptAesEcb(cipher: Buffer, key: Buffer): Buffer {
  const d = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([d.update(cipher), d.final()]);
}
export function aesEcbPaddedSize(n: number): number {
  return Math.ceil((n + 1) / 16) * 16;
}

/**
 * CDNMedia.aes_key 有两种编码（移植自 openclaw-weixin src/cdn/pic-decrypt.ts）：
 * 图片是 16 字节原始密钥的 base64；文件/语音/视频是 32 位十六进制字符串的 base64。
 */
export function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  const ascii = decoded.toString("ascii");
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(ascii)) return Buffer.from(ascii, "hex");
  throw new Error(`aes_key 解码后为 ${decoded.length} 字节，应为 16 字节或 32 位十六进制`);
}

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const IMAGE_MIME_EXT: Record<ImageMime, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };

/** 按文件头识别图片格式（微信图片条目不带文件名和 MIME）；不认识的返回 undefined。 */
export function sniffImageMime(buf: Buffer): ImageMime | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 6 && buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}
export function imageExt(mime: string | undefined): string {
  return IMAGE_MIME_EXT[mime as ImageMime] ?? ".jpg";
}

/** 单个入站媒体（解密后）的大小上限 */
export const MAX_INBOUND_MEDIA_BYTES = 50 * 1024 * 1024;
const CDN_TIMEOUT_MS = 60_000;

export interface InboundMedia {
  kind: "image" | "file" | "video";
  data: Buffer;
  /** 文件条目的原始文件名 */
  name?: string;
  /** 图片按文件头识别出的格式 */
  mime?: ImageMime;
}

/** 图片/文件/视频条目带有可下载的 CDN 引用。语音不下载：有转写文字，原始音频是 SILK。 */
export function hasDownloadableMedia(item: MessageItem | undefined): boolean {
  const media =
    item?.type === MessageItemType.IMAGE ? item.image_item?.media : item?.type === MessageItemType.FILE ? item.file_item?.media : item?.type === MessageItemType.VIDEO ? item.video_item?.media : undefined;
  return !!(media?.encrypt_query_param || media?.full_url);
}
export const SESSION_EXPIRED_ERRCODE = -14;
const CHANNEL_VERSION = "0.1.0";
const BOT_AGENT = "AnymodelBot/0.1.0";

export function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

const LOSSLESS_ID_FIELDS = new Set(["message_id", "msg_id", "svr_id"]);

/** 解析前把 uint64 消息 ID 加上引号，避免 JS number 精度丢失（移植自 openclaw-weixin）。 */
export function parseWeixinApiJson<T>(rawText: string): T {
  let output = "";
  let index = 0;
  while (index < rawText.length) {
    if (rawText[index] !== '"') {
      output += rawText[index++];
      continue;
    }
    const stringStart = index;
    index++;
    let escaped = false;
    while (index < rawText.length) {
      const char = rawText[index++];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') break;
    }
    const stringToken = rawText.slice(stringStart, index);
    output += stringToken;
    let cursor = index;
    while (/\s/.test(rawText[cursor] ?? "")) cursor++;
    if (rawText[cursor] !== ":") continue;
    let key: unknown;
    try {
      key = JSON.parse(stringToken);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !LOSSLESS_ID_FIELDS.has(key)) continue;
    output += rawText.slice(index, cursor + 1);
    cursor++;
    while (/\s/.test(rawText[cursor] ?? "")) output += rawText[cursor++];
    const numberStart = cursor;
    if (rawText[cursor] === "-") cursor++;
    while (/\d/.test(rawText[cursor] ?? "")) cursor++;
    if (cursor > numberStart && !(cursor === numberStart + 1 && rawText[numberStart] === "-")) {
      output += `"${rawText.slice(numberStart, cursor)}"`;
      index = cursor;
    } else {
      index = numberStart;
    }
  }
  return JSON.parse(output) as T;
}

// ---------- 协议类型（节选） ----------
export const MessageType = { USER: 1, BOT: 2 } as const;
export const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;

export interface CdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  /** 完整下载地址（服务端给出时优先用它，不再自己拼） */
  full_url?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string; media?: CdnMedia };
  file_item?: { file_name?: string; media?: CdnMedia; len?: string };
  /** aeskey：入站图片的原始密钥（十六进制），优先于 media.aes_key */
  image_item?: { media?: CdnMedia; aeskey?: string; mid_size?: number };
  video_item?: { media?: CdnMedia; video_size?: number };
  ref_msg?: { title?: string; message_item?: MessageItem };
}

export interface WeixinMessage {
  seq?: number;
  message_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface QrCodeResp {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResp {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect" | "need_verifycode" | "verify_code_blocked" | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export class WeixinApiError extends Error {
  constructor(message: string, readonly ret?: number, readonly errcode?: number) {
    super(message);
  }
  get sessionExpired(): boolean {
    return this.ret === SESSION_EXPIRED_ERRCODE || this.errcode === SESSION_EXPIRED_ERRCODE;
  }
  /** 服务端明确拒绝（有错误码或 HTTP 4xx）：出站队列试几次就放弃；网络错误、5xx 一直重试到过期 */
  get rejected(): boolean {
    if (this.sessionExpired) return false;
    return (this.ret !== undefined && this.ret !== 0) || (this.errcode !== undefined && this.errcode !== 0) || /HTTP 4\d\d/.test(this.message);
  }
}

export interface IlinkClientOptions {
  baseUrl?: string;
  token?: string;
  routeTag?: string;
  fetchImpl?: typeof fetch;
  cdnBaseUrl?: string;
}

export class IlinkClient {
  baseUrl: string;
  token: string;
  private fetchImpl: typeof fetch;
  constructor(private opts: IlinkClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_ILINK_BASE).replace(/\/+$/, "");
    this.token = opts.token || "";
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  private headers(withBody: boolean): Record<string, string> {
    const h: Record<string, string> = {
      "iLink-App-Id": ILINK_APP_ID,
      "iLink-App-ClientVersion": String(buildClientVersion(CHANNEL_VERSION)),
    };
    if (this.opts.routeTag) h.SKRouteTag = this.opts.routeTag;
    if (withBody) {
      h["Content-Type"] = "application/json";
      h.AuthorizationType = "ilink_bot_token";
      h["X-WECHAT-UIN"] = randomWechatUin();
      if (this.token.trim()) h.Authorization = `Bearer ${this.token.trim()}`;
    }
    return h;
  }

  private baseInfo() {
    return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
  }

  private async request(method: "GET" | "POST", endpoint: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => ctrl.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, {
        method,
        headers: this.headers(method === "POST"),
        body: method === "POST" ? JSON.stringify({ ...(body as object), base_info: this.baseInfo() }) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new WeixinApiError(`${endpoint} HTTP ${res.status}`);
      return text;
    } finally {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  // ---------- 登录 ----------
  async getBotQrCode(localTokens: string[] = []): Promise<QrCodeResp> {
    const raw = await this.request("POST", "ilink/bot/get_bot_qrcode?bot_type=3", { local_token_list: localTokens }, 15_000);
    return JSON.parse(raw) as QrCodeResp;
  }

  /** 长轮询二维码状态；超时/网络错误视为 wait。 */
  async getQrCodeStatus(qrcode: string, verifyCode?: string, timeoutMs = 35_000, signal?: AbortSignal): Promise<QrStatusResp> {
    const q = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}${verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : ""}`;
    try {
      return JSON.parse(await this.request("GET", q, undefined, timeoutMs, signal)) as QrStatusResp;
    } catch (e) {
      if (signal?.aborted) throw e;
      return { status: "wait" };
    }
  }

  // ---------- 消息 ----------
  /** 长轮询拉取消息；客户端超时返回空结果（正常现象）。 */
  async getUpdates(cursor: string, timeoutMs = 35_000, signal?: AbortSignal): Promise<GetUpdatesResp> {
    let raw: string;
    try {
      raw = await this.request("POST", "ilink/bot/getupdates", { get_updates_buf: cursor }, timeoutMs, signal);
    } catch (e) {
      if (!signal?.aborted && (e as Error).name === "AbortError") return { ret: 0, msgs: [], get_updates_buf: cursor };
      if (!signal?.aborted && /timeout/i.test(String((e as Error).message))) return { ret: 0, msgs: [], get_updates_buf: cursor };
      throw e;
    }
    const resp = parseWeixinApiJson<GetUpdatesResp>(raw);
    if ((resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0)) {
      throw new WeixinApiError(`getupdates ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`, resp.ret, resp.errcode);
    }
    return resp;
  }

  /** clientId：出站队列给的确定 id（同一条消息的同一段每次相同），不给就随机 */
  async sendText(toUserId: string, text: string, contextToken: string, clientId?: string): Promise<void> {
    await this.sendItem(toUserId, { type: MessageItemType.TEXT, text_item: { text } }, contextToken, clientId);
  }

  /**
   * 发送本地文件：getuploadurl → AES-128-ECB 加密后 POST 到 CDN → sendmessage 媒体条目。
   * 移植自 openclaw-weixin src/cdn/upload.ts、src/cdn/cdn-upload.ts、src/messaging/send.ts。
   */
  async sendMedia(toUserId: string, filePath: string, contextToken: string, clientId?: string): Promise<void> {
    const plain = await fs.readFile(filePath);
    const kind = mediaKind(filePath);
    const filekey = crypto.randomBytes(16).toString("hex");
    const aeskey = crypto.randomBytes(16);
    const filesize = aesEcbPaddedSize(plain.length);
    const raw = await this.request(
      "POST",
      "ilink/bot/getuploadurl",
      {
        filekey,
        media_type: kind === "image" ? UploadMediaType.IMAGE : kind === "video" ? UploadMediaType.VIDEO : UploadMediaType.FILE,
        to_user_id: toUserId,
        rawsize: plain.length,
        rawfilemd5: crypto.createHash("md5").update(plain).digest("hex"),
        filesize,
        no_need_thumb: true,
        aeskey: aeskey.toString("hex"),
      },
      15_000,
    );
    const up = parseWeixinApiJson<{ ret?: number; errcode?: number; errmsg?: string; upload_full_url?: string; upload_param?: string }>(raw || "{}");
    if ((up.ret && up.ret !== 0) || (up.errcode && up.errcode !== 0)) {
      throw new WeixinApiError(`getuploadurl ret=${up.ret} errcode=${up.errcode} errmsg=${up.errmsg ?? ""}`, up.ret, up.errcode);
    }
    const url = up.upload_full_url?.trim() || (up.upload_param ? `${this.cdnBase}/upload?encrypted_query_param=${encodeURIComponent(up.upload_param)}&filekey=${encodeURIComponent(filekey)}` : "");
    if (!url) throw new WeixinApiError(`getuploadurl returned no upload url (ret=${up.ret ?? ""})`, up.ret);
    const cipher = encryptAesEcb(plain, aeskey);
    let param = "";
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !param; attempt++) {
      try {
        const res = await this.fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(cipher), signal: AbortSignal.timeout(CDN_TIMEOUT_MS) });
        await res.arrayBuffer().catch(() => {});
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(`CDN upload client error ${res.status} ${res.headers.get("x-error-message") ?? ""}`.trim()), { fatal: true });
        if (res.status !== 200) throw new Error(`CDN upload server error ${res.status}`);
        param = res.headers.get("x-encrypted-param") ?? "";
        if (!param) throw new Error("CDN upload response missing x-encrypted-param");
      } catch (e) {
        lastErr = e;
        if ((e as { fatal?: boolean }).fatal) throw e;
      }
    }
    if (!param) throw lastErr instanceof Error ? lastErr : new Error("CDN upload failed");
    // 与上游一致：aes_key 为十六进制密钥字符串的 base64
    const media = { encrypt_query_param: param, aes_key: Buffer.from(aeskey.toString("hex")).toString("base64"), encrypt_type: 1 };
    const item: MessageItem =
      kind === "image"
        ? { type: MessageItemType.IMAGE, image_item: { media, mid_size: filesize } }
        : kind === "video"
          ? { type: MessageItemType.VIDEO, video_item: { media, video_size: filesize } }
          : { type: MessageItemType.FILE, file_item: { media, file_name: path.basename(filePath), len: String(plain.length) } };
    await this.sendItem(toUserId, item, contextToken, clientId);
  }

  private get cdnBase(): string {
    return (this.opts.cdnBaseUrl || DEFAULT_CDN_BASE).replace(/\/+$/, "");
  }

  /**
   * 下载并解密用户发来的图片/文件/视频（含被引用消息里的）。
   * 移植自 openclaw-weixin src/media/media-download.ts、src/cdn/pic-decrypt.ts、src/cdn/cdn-url.ts。
   */
  async downloadMedia(item: MessageItem, maxBytes = MAX_INBOUND_MEDIA_BYTES): Promise<InboundMedia> {
    let kind: InboundMedia["kind"];
    let media: CdnMedia | undefined;
    let key: Buffer | undefined;
    if (item.type === MessageItemType.IMAGE) {
      kind = "image";
      media = item.image_item?.media;
      // image_item.aeskey（十六进制）优先；两者都没有时图片未加密
      const hex = item.image_item?.aeskey;
      if (hex && /^[0-9a-fA-F]{32}$/.test(hex)) key = Buffer.from(hex, "hex");
      else if (media?.aes_key) key = parseAesKey(media.aes_key);
    } else if (item.type === MessageItemType.FILE || item.type === MessageItemType.VIDEO) {
      kind = item.type === MessageItemType.FILE ? "file" : "video";
      media = kind === "file" ? item.file_item?.media : item.video_item?.media;
      if (!media?.aes_key) throw new Error("缺少 aes_key");
      key = parseAesKey(media.aes_key);
    } else {
      throw new Error(`不支持下载的条目类型 ${item.type}`);
    }
    const full = media?.full_url?.trim();
    if (full && !/^https?:\/\//i.test(full)) throw new Error("full_url 不是 http(s) 地址");
    if (!full && !media?.encrypt_query_param) throw new Error("没有 CDN 引用");
    const url = full || `${this.cdnBase}/download?encrypted_query_param=${encodeURIComponent(media!.encrypt_query_param!)}`;

    let raw: Buffer | undefined;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !raw; attempt++) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(CDN_TIMEOUT_MS) });
        if (!res.ok) {
          await res.arrayBuffer().catch(() => {});
          const err = new Error(`CDN 下载失败 HTTP ${res.status} ${res.headers.get("x-error-message") ?? ""}`.trim());
          throw res.status < 500 ? Object.assign(err, { fatal: true }) : err;
        }
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > maxBytes) {
          await res.body?.cancel().catch(() => {});
          throw Object.assign(new Error(`文件过大（${(declared / 1048576).toFixed(1)} MB，上限 ${maxBytes / 1048576} MB）`), { fatal: true });
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxBytes) throw Object.assign(new Error(`文件过大（${(buf.length / 1048576).toFixed(1)} MB，上限 ${maxBytes / 1048576} MB）`), { fatal: true });
        raw = buf;
      } catch (e) {
        lastErr = e;
        if ((e as { fatal?: boolean }).fatal) throw e;
      }
    }
    if (!raw) throw lastErr instanceof Error ? lastErr : new Error("CDN 下载失败");
    let data: Buffer;
    try {
      data = key ? decryptAesEcb(raw, key) : raw;
    } catch {
      throw new Error("解密失败（密钥不对？）");
    }
    if (kind === "image") return { kind, data, mime: sniffImageMime(data) };
    if (kind === "file") return { kind, data, name: item.file_item?.file_name || "file" };
    return { kind, data };
  }

  private async sendItem(toUserId: string, item: MessageItem, contextToken: string, clientId?: string): Promise<void> {
    const raw = await this.request(
      "POST",
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: clientId ? `amb:${clientId}` : `amb:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
          message_type: MessageType.BOT,
          message_state: 2, // FINISH
          context_token: contextToken || undefined,
          item_list: [item],
        },
      },
      15_000,
    );
    const resp = parseWeixinApiJson<{ ret?: number; errcode?: number; errmsg?: string }>(raw || "{}");
    if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
      throw new WeixinApiError(`sendmessage ret=${resp.ret} errmsg=${resp.errmsg ?? ""}`, resp.ret, resp.errcode);
    }
  }

  async getTypingTicket(userId: string, contextToken?: string): Promise<string> {
    const raw = await this.request("POST", "ilink/bot/getconfig", { ilink_user_id: userId, context_token: contextToken }, 10_000);
    const resp = JSON.parse(raw || "{}") as { ret?: number; typing_ticket?: string };
    return resp.typing_ticket || "";
  }

  async sendTyping(userId: string, ticket: string, typing: boolean): Promise<void> {
    await this.request("POST", "ilink/bot/sendtyping", { ilink_user_id: userId, typing_ticket: ticket, status: typing ? 1 : 2 }, 10_000);
  }
}
