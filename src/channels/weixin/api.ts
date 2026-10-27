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
export function aesEcbPaddedSize(n: number): number {
  return Math.ceil((n + 1) / 16) * 16;
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
}

export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  file_item?: { file_name?: string; media?: CdnMedia; len?: string };
  image_item?: { media?: CdnMedia; mid_size?: number };
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

  async sendText(toUserId: string, text: string, contextToken: string): Promise<void> {
    await this.sendItem(toUserId, { type: MessageItemType.TEXT, text_item: { text } }, contextToken);
  }

  /**
   * 发送本地文件：getuploadurl → AES-128-ECB 加密后 POST 到 CDN → sendmessage 媒体条目。
   * 移植自 openclaw-weixin src/cdn/upload.ts、src/cdn/cdn-upload.ts、src/messaging/send.ts。
   */
  async sendMedia(toUserId: string, filePath: string, contextToken: string): Promise<void> {
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
    const up = parseWeixinApiJson<{ ret?: number; errmsg?: string; upload_full_url?: string; upload_param?: string }>(raw || "{}");
    const cdnBase = (this.opts.cdnBaseUrl || DEFAULT_CDN_BASE).replace(/\/+$/, "");
    const url = up.upload_full_url?.trim() || (up.upload_param ? `${cdnBase}/upload?encrypted_query_param=${encodeURIComponent(up.upload_param)}&filekey=${encodeURIComponent(filekey)}` : "");
    if (!url) throw new WeixinApiError(`getuploadurl returned no upload url (ret=${up.ret ?? ""})`, up.ret);
    const cipher = encryptAesEcb(plain, aeskey);
    let param = "";
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !param; attempt++) {
      try {
        const res = await this.fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(cipher) });
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(`CDN upload client error ${res.status}`), { fatal: true });
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
    await this.sendItem(toUserId, item, contextToken);
  }

  private async sendItem(toUserId: string, item: MessageItem, contextToken: string): Promise<void> {
    const raw = await this.request(
      "POST",
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: `amb:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
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
