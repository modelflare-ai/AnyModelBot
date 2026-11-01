import fsp from "node:fs/promises";
import type { ChannelStatus, MessengerId } from "../../core/types.js";
import { t as tr } from "../../i18n/index.js";

/**
 * Telegram、Slack、Discord 共用的传输层接口：长连接或长轮询收消息，HTTP 接口发消息。
 * 真实实现直接调平台的公开接口（没有 SDK）；离线测试用假的替换。
 */

/** 对方发来的文件：处理这条消息时才下载（陌生人的不下载） */
export interface MessengerFile {
  type: "image" | "file" | "video" | "voice";
  name?: string;
  download: () => Promise<Buffer>;
}

export interface MessengerMessage {
  /** 平台消息 id（去重用，在这个机器人的这个平台里唯一） */
  id: string;
  chatId: string;
  /** 单聊。群里的消息目前不处理 */
  dm: boolean;
  senderId: string;
  senderName?: string;
  text: string;
  files: MessengerFile[];
  /** 这条回复的是哪句（平台给了原文时） */
  quote?: string;
  /** 处理不了的消息类型（贴纸等）：回答时说明 */
  unsupported?: string;
}

/** fatal：凭据失效，不再重连，要用户处理 */
export type StateFn = (state: ChannelStatus["state"], detail?: string, fatal?: boolean) => void;

export interface MessengerTransport {
  readonly id: MessengerId;
  /** 一条消息最多放多少字（留了余量） */
  readonly maxText: number;
  /** 检查凭据，返回平台上机器人的名字；凭据不对抛 rejected 的错误 */
  verify?(): Promise<{ name: string }>;
  start(onMessage: (m: MessengerMessage) => void, onState: StateFn): Promise<void>;
  stop(): Promise<void>;
  /** 发一条，返回消息 id。key 是确定的（同一条消息的同一段不变），平台能去重时用它 */
  sendText(chatId: string, text: string, key?: string): Promise<string>;
  editText(chatId: string, messageId: string, text: string): Promise<void>;
  sendFile(chatId: string, filePath: string, name: string): Promise<void>;
  /** 显示"正在输入"（几秒后自动消失）；没有这个能力的平台不实现 */
  typing?(chatId: string): Promise<void>;
}

/** 平台返回的错误。rejected = 平台明确拒绝，重试没用（见 core/outbox.ts）；fatal = 凭据失效，重连也没用 */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly rejected = false,
    readonly fatal = false,
  ) {
    super(message);
  }
}

/** 收发文件的上限：进内存处理，太大的不接 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const tooLarge = (bytes: number, max: number) => new Error(tr("channel.too_large", { size: (bytes / 1048576).toFixed(1), max: Math.round(max / 1048576) }));

/** 读要发的本地文件；太大的不读 */
export async function readForUpload(filePath: string, max = MAX_FILE_BYTES): Promise<Buffer> {
  const { size } = await fsp.stat(filePath);
  if (size > max) throw tooLarge(size, max);
  return fsp.readFile(filePath);
}

/** 下载对方发来的文件。先看声明的大小，再看实际大小 */
export async function fetchFile(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, max = MAX_FILE_BYTES): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw tooLarge(declared, max);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > max) throw tooLarge(buffer.length, max);
  return { buffer, contentType: res.headers.get("content-type") ?? "" };
}
