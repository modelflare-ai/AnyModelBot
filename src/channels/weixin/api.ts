/*
 * iLink Bot API 客户端（微信官方 ClawBot 通道）。
 * 协议细节移植自 Tencent/openclaw-weixin (src/api/api.ts, src/auth/login-qr.ts, v2.4.10)，
 * 精简并改写为可注入 baseUrl/fetch 的类。
 * Portions Copyright (C) 2026 Tencent. All rights reserved. Licensed under the MIT, see ./LICENSE.openclaw-weixin.
 */
import crypto from "node:crypto";

export const ILINK_APP_ID = "bot";
export const DEFAULT_ILINK_BASE = "https://ilinkai.weixin.qq.com";
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

export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  file_item?: { file_name?: string };
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
          item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
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
