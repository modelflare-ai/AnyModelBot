import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { lineLogger, logger } from "../log.js";
import type { Store } from "../store/db.js";
import { BOT_HEADER, type AgentBridge, type Rejection } from "./bridge.js";
import { ApiFallbacks, shapeRejection, type ApiFallback } from "./api-fallback.js";
import { ControlChannel } from "./control.js";
import os from "node:os";
import { findAppRoot } from "../magpie/supervisor.js";
import { adaptSkill, mcpPatchLines, resolveComputerUse, type CuResolved } from "./computer-use.js";
import { cuaConfig, cuaMcpEnv, discoverAppsCached, type CuaApp } from "./cua-driver.js";
import { pwshPatchLines, pwshProbe } from "./pwsh.js";
import { hasEnvProxy, networkEnv, systemProxyEnv } from "./proxy-env.js";
import { DEFAULT_SETTINGS, permissionMode, type BotSettings } from "./settings.js";
import { acceptsImages } from "../llm/client.js";
import { CUA_SKILL, MEDIA_SKILL, TASK_RULES, agentPersona, botPrompt } from "./prompts/index.js";
import { t, t as tr } from "../i18n/index.js";
import { dirBytes, taskSessionDirs } from "../tasks/retention.js";

const log = logger("agent.host");

// ---------- @deepseek-ai/dsh-sdk-client 的最小本地类型（运行时从 dsh-runtime / app.asar/dsh 动态加载） ----------
interface SdkNotification {
  method: string;
  params: any;
}
interface SdkRunResult {
  sessionId: string;
  finalResponse: string;
  events: Array<{ type: string; data: any }>;
}
interface SdkSession {
  id: string;
  run(input: string | unknown[], options?: { onNotification?: (n: SdkNotification) => void }): Promise<SdkRunResult>;
  setWorkingDirectory(p: string): Promise<unknown>;
}
interface SdkHarness {
  client: any;
  start(): Promise<void>;
  session(id?: string): SdkSession;
  resumeSession(id: string): Promise<SdkSession>;
  close(): Promise<void>;
}
interface SdkModule {
  DeepSeekHarness: new (opts: Record<string, unknown>) => SdkHarness;
}

/** DSH 运行时是否具备可加载的 sdk-client。 */
function isDshRuntime(dir: string): boolean {
  return fs.existsSync(path.join(dir, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json"));
}

/**
 * 找到随应用分发的 DSH 运行时目录（含 node_modules/@deepseek-ai/dsh）。
 * 打包后是 `resources/dsh/dsh.asar`（JS 打成一个归档，原生包是旁边的 resources/dsh/node_modules 实文件）；开发时用 `dsh-runtime/`。
 * Electron 主进程与 ELECTRON_RUN_AS_NODE 子进程都能直接读 asar，无需再 extract。
 */
export function locateDshRuntime(appRoot: string): string | undefined {
  const res = (process as any).resourcesPath as string | undefined;
  const cands = [
    process.env.AMB_DSH_RUNTIME,
    path.join(appRoot, "dsh-runtime"), // dev checkout
    res ? path.join(res, "dsh", "dsh.asar") : undefined, // packaged: resources/dsh/dsh.asar (scripts/bundle-dsh.mjs)
    res ? path.join(res, "dsh") : undefined, // packaged: resources/dsh (pruned tree, ≤ 0.1.5)
    path.join(appRoot, "dsh"), // packaged inside app.asar (older layout)
    res ? path.join(res, "app.asar", "dsh") : undefined,
    res ? path.join(res, "app.asar.unpacked", "dsh") : undefined,
  ].filter(Boolean) as string[];
  return cands.find(isDshRuntime);
}

/**
 * Identity for callers that historically extracted asar → dataDir.
 * DSH ships as `resources/dsh/dsh.asar`, which Electron reads in place (no first-launch extract).
 * Kept so App / tests can call it without branching; returns `runtimeDir` unchanged.
 */
export function materializeDshRuntime(runtimeDir: string, _cacheRoot?: string): string {
  return runtimeDir;
}

/** present 工具参数里的文件路径（原样，相对路径以工作区为准）。 */
export function presentPaths(args: string): string[] {
  try {
    const a = JSON.parse(args) as { files?: Array<{ path?: unknown }> };
    return (a.files ?? []).map((f) => String(f?.path ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

export const MAX_DELIVERABLE_BYTES = 50 * 1024 * 1024;

/**
 * 只交付工作区内（解析符号链接后）真实存在的普通文件，去重，最多 8 个、单个 ≤ 50 MB。
 * 防止模型借 present 把工作区外的文件（如 ~/.ssh、数据目录）发到聊天里。
 */
export function deliverables(workspace: string, paths: string[]): string[] {
  let root: string;
  try {
    root = fs.realpathSync(workspace);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const p of paths) {
    try {
      const real = fs.realpathSync(path.resolve(workspace, p));
      if (real !== root && !real.startsWith(root + path.sep)) continue;
      const st = fs.statSync(real);
      if (!st.isFile() || st.size === 0 || st.size > MAX_DELIVERABLE_BYTES) continue;
      if (!out.includes(real)) out.push(real);
    } catch {
      /* 不存在则忽略 */
    }
  }
  return out.slice(0, 8);
}

/** p 在 ms 内没结果就用 fallback */
function withTimeoutOr<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((r) => (t = setTimeout(() => r(fallback), ms)))]).finally(() => clearTimeout(t));
}

let sdkPromise: Promise<SdkModule> | undefined;
function loadSdk(runtimeDir: string): Promise<SdkModule> {
  sdkPromise ??= import(pathToFileURL(path.join(runtimeDir, "node_modules", "@deepseek-ai", "dsh-sdk-client", "lib", "index.js")).href) as Promise<SdkModule>;
  return sdkPromise;
}

/** 回合中的可见进度（工具调用等），由渠道批量发送。 */
export interface TurnObserver {
  onProgress?(text: string): void;
  /**
   * DSH 会话事件（time 是事件自带的时间）；子代理的开始/结束以 subagent/started、subagent/finished 送来，
   * 子代理会话里的事件以 subagent/event（data = { sessionId, event }）送来
   */
  onEvent?(type: string, data: any, time?: number): void;
  /** 消息已经交给代理（之前是等进程、等会话） */
  onStart?(): void;
}

/**
 * 回合被中止：用户 /stop、长时间没有进展（idle）、超过单回合上限（timeout）。
 * 经指令通道只中止这个会话的回合（agent.cancel）；宽限期内没停下才重启子进程（restarted）。
 * ms 是触发时的时长（idle、timeout 为阈值）。
 */
export class TurnStopped extends Error {
  constructor(
    readonly reason: "user" | "idle" | "timeout",
    readonly ms: number,
    readonly restarted = false,
  ) {
    super(`agent turn stopped (${reason})`);
  }
}

/**
 * 回合失败，原因是上游不接受这个接口上的请求（Responses / Anthropic Messages 被拒）。已记下回退；
 * retryable：这一轮还没有调用过工具、也没有别的回合在用这个代理进程，可以换 Chat Completions 重做一遍。
 */
export class ApiRejected extends Error {
  constructor(
    message: string,
    readonly api: AgentApi,
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** 后台任务的会话记录恢复不了（DSH 主目录里没有了或坏了）：任务服务换一个新会话、重新交代 */
export class ResumeFailed extends Error {}

/** 设置变了、后台任务又一直在跑：最多等这么久就重启代理进程（任务随后恢复） */
export const TASK_RESTART_WAIT_MS = 10 * 60_000;

/**
 * SDK 关不掉会话：每个任务、规则会话都留在子进程里，直到它重启。实测（真实 DSH + mock 模型，一次运行两三次模型请求）
 * 一个跑完、空闲的会话让子进程多占约 0.25–0.45 MB（新进程约 160 MB）。开过这么多个之后，完全空闲时换一个新的子进程：
 * 多出来的最多约 40 MB；最勤的规则（每 15 分钟，一天 96 次）大约一天换一次。AMB_DSH_RECYCLE_SESSIONS 可改。
 */
export const RECYCLE_AFTER_SESSIONS = 100;

/** 换接口重做时交给模型的话（上一条用户消息已经在会话里） */
export const RETRY_NOTE = "[系统提示]\n上一条用户消息因模型接口不兼容没有处理，现已换用其它接口。请直接处理上面那条用户消息。";

export interface AgentHostOptions {
  botId: string;
  dataDir: string;
  runtimeDir: string;
  bridge: AgentBridge;
  store: Store;
  /** 当前机器人设置（权限预设、记忆开关）；变化后空闲时重启子进程 */
  settings?: () => BotSettings;
  /** 单回合上限，超时则重启子进程（SDK 无中断接口） */
  turnTimeoutMs?: number;
  /** 需要让用户看到的提示（界面通知） */
  onNotice?: (text: string) => void;
  /** 能生图 / 生视频（已连接 Modelflare）：写入 media 技能说明 */
  media?: boolean;
  /** 模型的上下文长度（Modelflare 模型资料）；不知道时 undefined，用内置兜底表 */
  contextWindow?: (model: string) => Promise<number | undefined>;
  /** 模型支持的接口与是否推理（Modelflare 模型资料），用来选对话接口；不知道时 undefined，走 Chat Completions */
  apiInfo?: (model: string) => Promise<ModelApiInfo | undefined>;
  /** 被上游拒绝过的模型 → 改走 Chat Completions（所有机器人共用，存在数据目录）；不给时只在本进程内记 */
  apiFallbacks?: ApiFallbacks;
  /** 代理自己醒来开了一轮（后台命令结束）：调用方用 followTurn 跟踪它，把回复发到会话里 */
  onWake?: (conversationId: string, sessionId: string) => void;
  /** 后台任务会话（task-*）和它们子代理的通知：root 是任务会话 id（任务服务据此记步骤、判断这一轮结束） */
  onTaskEvent?: (root: string, n: SdkNotification) => void;
  /** 宿主这边也空闲（没有在跑或收尾的任务、规则 run，没有等批准的，没有在压缩的会话）：开过的会话多了可以换新的子进程 */
  idle?: () => boolean;
  /** 桌面版：系统给这个地址用的代理（PAC 写法，如 "PROXY 127.0.0.1:7890"）；环境里没设代理时每次拉起子进程问一次 */
  systemProxy?: (url: string) => Promise<string | undefined>;
}

export type HostState = "stopped" | "starting" | "running" | "backoff" | "error";

/** 传给 Windows 上代理子进程的系统变量（都不是密钥；值来自本进程环境） */
export const WIN_SYSTEM_ENV = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "ALLUSERSPROFILE",
  "PUBLIC",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "NUMBER_OF_PROCESSORS",
  "USERNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
];

/** 子进程生命周期事件（故障排查的"测试代理"按它判断卡在哪一步） */
export type HostEvent =
  | { type: "spawned"; pid: number | undefined }
  | { type: "initialized"; pid: number | undefined; ms: number }
  | { type: "failed"; message: string }
  /** recycled：空闲时为了放掉开过的会话换的（上面没有在跑的东西，不用恢复） */
  | { type: "exit"; pid: number | undefined; code: number | null; signal: string | null; recycled?: boolean };

/** 拿不到 Modelflare 的模型资料时的兜底（上下文窗口、最大输出） */
const MODEL_LIMITS: Array<[RegExp, number, number]> = [
  [/-terra\b/i, 1_050_000, 32_000],
  [/grok-4/i, 256_000, 32_000],
  [/claude/i, 200_000, 32_000],
  [/gpt-[5-9]|gpt-4\.1/i, 400_000, 32_000],
  [/gemini/i, 1_000_000, 32_000],
  [/deepseek/i, 128_000, 32_000],
];

/**
 * 模型的上下文窗口与最大输出（写进 DSH 补丁，上下文管家也按它算检查线）。
 * known：Modelflare 模型资料里的上下文长度，有就用它；窗口写小了，DSH 和管家会过早、反复地压缩上下文。
 */
export function modelLimits(model: string, known?: number): { window: number; maxTokens: number } {
  const lim = MODEL_LIMITS.find(([re]) => re.test(model)) ?? [/./, 128_000, 16_000];
  const window = Number(known) > 0 ? Number(known) : lim[1];
  // 最大输出不超过窗口的四分之一（小窗口模型留够消息空间）
  return { window, maxTokens: Math.min(lim[2], Math.floor(window / 4)) };
}

/** DSH 跟模型说话用的接口（DSH 补丁里 provider 的 api） */
export type AgentApi = "openai-completions" | "openai-responses" | "anthropic-messages";

/** 选接口用的模型资料：endpoints 是 Modelflare 目录里的 supported_endpoint_types，reasoning 来自 model-profiles */
export interface ModelApiInfo {
  endpoints?: string[];
  reasoning?: boolean;
}

/**
 * 代理用哪个接口：模型支持 Responses 就用 Responses，否则支持 Anthropic Messages 就用它（Claude），
 * 都没有或不知道（离线、目录拿不到）时用 Chat Completions。AMB_AGENT_API=chat 强制 Chat（排查用）。
 */
export function agentApi(endpoints: string[] | undefined, env: NodeJS.ProcessEnv = process.env): AgentApi {
  if (env.AMB_AGENT_API?.trim().toLowerCase() === "chat") return "openai-completions";
  if (endpoints?.includes("openai-response")) return "openai-responses";
  if (endpoints?.includes("anthropic")) return "anthropic-messages";
  return "openai-completions";
}

/**
 * 一个模型在 DSH 里怎么走：哪个 provider（按接口分）、接口、上下文窗口与最大输出、是否推理。
 * 同一个代理进程里每个会话用自己的模型（amb-control 插件按会话选 provider/model），不用为换模型重启。
 */
export interface ModelRoute {
  model: string;
  provider: string;
  api: AgentApi;
  /** 这个模型在选中的接口上被拒过、改走 Chat 的回退记录 */
  fallback?: ApiFallback;
  limits: { window: number; maxTokens: number };
  reasoning?: boolean;
}

/**
 * 补丁里的 provider：每种接口一个（Anthropic 的 baseURL 是 bridge 根地址，另两个是 …/v1）。Responses 再按推理分两个：
 * provider 一级的推理强度（medium）遇到不推理的模型会被 pi-ai 拒绝。
 */
export function providerFor(api: AgentApi, reasoning?: boolean): string {
  if (api === "openai-responses") return reasoning === false ? "magpie-responses-plain" : "magpie-responses";
  if (api === "anthropic-messages") return "magpie-anthropic";
  return "magpie";
}

/** llm-pi-ai 的一个 provider（补丁和运行时更新共用这份结构） */
export interface ProviderProfile {
  displayName: string;
  api: AgentApi;
  baseURL: string;
  reasoning?: string;
  apiKeyEnv: string;
  headers: Record<string, string>;
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    input?: string[];
    reasoningEfforts?: Record<string, string>;
    compat?: Record<string, boolean>;
  }>;
}

/**
 * 所有路线的 provider 配置。每个模型都同时列在 Chat Completions（magpie）下：被上游拒过的模型改走 Chat 时不用再注册。
 * - Responses：store:false 下推理条目要带 encrypted_content 才能回放，而 DSH 只在指定了推理强度时才要它，
 *   所以推理模型（或不知道是不是）声明 low/medium/high、默认 medium；明确不推理的不发推理参数。
 *   系统提示用 system 角色（网关转给非 OpenAI 模型时不一定认 developer）；工具显式 strict:false。
 * - Anthropic、Chat 不声明推理（和以前一样，用模型默认）。
 */
export function providerProfiles(routes: ModelRoute[], bridgeUrl: string, botId: string): Record<string, ProviderProfile> {
  const out: Record<string, ProviderProfile> = {};
  const add = (provider: string, api: AgentApi, r: ModelRoute, reasoning?: boolean) => {
    const p = (out[provider] ??= {
      displayName: "anymodel",
      api,
      baseURL: api === "anthropic-messages" ? bridgeUrl : bridgeUrl + "/v1",
      ...(api === "openai-responses" && reasoning !== false ? { reasoning: "medium" } : {}),
      apiKeyEnv: "AMB_MAGPIE_KEY",
      // 标明是哪个机器人发的：bridge 据此把上游错误归到这个代理进程（不转给上游）
      headers: { [BOT_HEADER]: botId },
      models: [],
    });
    if (p.models.some((m) => m.id === r.model)) return;
    p.models.push({
      id: r.model,
      name: r.model.split("/").pop() || r.model,
      contextWindow: r.limits.window,
      maxTokens: r.limits.maxTokens,
      // 默认只收文字；能看图的模型声明图片输入，用户发来的图片才会作为图片交给它
      ...(acceptsImages(r.model) ? { input: ["text", "image"] } : {}),
      ...(api === "openai-responses"
        ? {
            ...(reasoning !== false ? { reasoningEfforts: { low: "low", medium: "medium", high: "high" } } : {}),
            compat: { supportsDeveloperRole: false, supportsStrictMode: true },
          }
        : {}),
    });
  };
  for (const r of routes) {
    if (r.api !== "openai-completions") add(r.provider, r.api, r, r.reasoning);
    add("magpie", "openai-completions", r);
  }
  return out;
}

/** provider 配置写成补丁里的 YAML 行（字符串都按 JSON 写，是合法的 YAML 标量） */
export function providerPatchLines(profiles: Record<string, ProviderProfile>): string[] {
  const lines = ["- id: llm-pi-ai", "  config:", "    providers:"];
  for (const [name, p] of Object.entries(profiles)) {
    lines.push(`      ${name}:`, `        displayName: ${p.displayName}`, `        api: ${p.api}`, `        baseURL: ${yamlStr(p.baseURL)}`);
    if (p.reasoning) lines.push(`        reasoning: ${p.reasoning}`);
    lines.push(`        apiKeyEnv: ${p.apiKeyEnv}`, "        headers:", ...Object.entries(p.headers).map(([k, v]) => `          ${k}: ${yamlStr(v)}`), "        models:");
    for (const m of p.models) {
      lines.push(`          - id: ${yamlStr(m.id)}`, `            name: ${yamlStr(m.name)}`, `            contextWindow: ${m.contextWindow}`, `            maxTokens: ${m.maxTokens}`);
      if (m.input) lines.push(`            input: [${m.input.join(", ")}]`);
      if (m.reasoningEfforts) lines.push("            reasoningEfforts:", ...Object.entries(m.reasoningEfforts).map(([k, v]) => `              ${k}: ${v}`));
      if (m.compat) lines.push("            compat:", ...Object.entries(m.compat).map(([k, v]) => `              ${k}: ${v}`));
    }
  }
  return lines;
}

/**
 * 长命令转后台：前台命令等这么久还没完就转成后台任务（不杀掉），代理收到任务 id，结束时在会话里收到结果。
 * 模型可以要求更长的前台等待，但不超过上限；job_output 的等待同样有上限。这样一步最多卡一两分钟，
 * 插进来的消息、/stop 都能及时生效。Windows 上 PowerShell 5.1 一条命令就要二三十秒，放宽一些。
 */
export const SHELL_LIMITS = { bashMs: 30_000, bashMaxMs: 60_000, pwshMs: 60_000, pwshMaxMs: 120_000, waitMs: 30_000, waitMaxMs: 60_000 };

/** 命令与后台任务的补丁行（pwsh-sandbox 一行里还要带上检测到的 PowerShell：补丁按行整体替换 config） */
export function shellPatchLines(pwshPath: string | undefined, l = SHELL_LIMITS): string[] {
  return [
    "- id: bash-sandbox",
    "  config:",
    `    timeoutMs: ${l.bashMs}`,
    `    maxTimeoutMs: ${l.bashMaxMs}`,
    "- id: pwsh-sandbox",
    "  config:",
    `    timeoutMs: ${l.pwshMs}`,
    `    maxTimeoutMs: ${l.pwshMaxMs}`,
    ...pwshPatchLines(pwshPath).slice(2),
    // 后台任务结束时 DSH 默认唤醒空闲的代理开一轮（completionDelivery: wakeup），宿主跟着这一轮把回复发给用户（见 wake）
    "- id: tool-jobs",
    "  config:",
    `    waitTimeoutMs: ${l.waitMs}`,
    `    maxWaitTimeoutMs: ${l.waitMaxMs}`,
  ];
}

/** 随消息交给模型的图片（DSH SDK 的内联图片块：base64 + 格式，进会话前存入 DSH 的附件库） */
export interface TurnImage {
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

export interface TurnInput {
  conversationId: string;
  text: string;
  model: string;
  observer?: TurnObserver;
  /** 只在模型能看图时传（acceptsImages），否则模型只拿到文字里的工作区路径 */
  images?: TurnImage[];
  /** 中止这个回合（reason 为 TurnStopped）：只中止这个会话的回合；宽限期内没停下才重启子进程 */
  signal?: AbortSignal;
}

/** 回合结束时的上下文用量（来自 DSH 事件）。 */
export interface TurnUsage {
  /** 最后一次模型请求的输入+输出 token，约等于当前上下文大小 */
  tokens: number;
  window: number;
  maxTokens: number;
}

function yamlStr(s: string): string {
  return JSON.stringify(s); // JSON 字符串是合法的 YAML 标量
}

/** 工具结果的文字（content 是字符串或 [{type:"text",text}]） */
function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("\n");
  return "";
}

/** 把工具调用压成一行可读进度。 */
export function summarizeCall(name: string, argsJson: string): string {
  let a: any = {};
  try {
    a = JSON.parse(argsJson || "{}");
  } catch {
    /* ignore */
  }
  const pick = a.command ?? a.cmd ?? a.path ?? a.file_path ?? a.filePath ?? a.file ?? a.url ?? a.query ?? a.pattern;
  const s = typeof pick === "string" ? pick : Array.isArray(pick) ? pick.join(" ") : "";
  const one = s.replace(/\s+/g, " ").trim();
  return one ? `${name}: ${one.length > 120 ? one.slice(0, 117) + "…" : one}` : name;
}

/** 审批提示里展示的“命令”：bash 用完整命令，其余用主要参数。 */
export function callDetail(name: string, argsJson: string): string {
  let a: any = {};
  try {
    a = JSON.parse(argsJson || "{}");
  } catch {
    return argsJson.slice(0, 300);
  }
  const pick = a.command ?? a.cmd ?? a.path ?? a.file_path ?? a.filePath ?? a.url;
  if (typeof pick === "string") return pick;
  if (Array.isArray(pick)) return pick.join(" ");
  const s = JSON.stringify(a);
  return s === "{}" ? "" : s.slice(0, 300);
}

/** 一个进行中的回合（插话、中止用） */
interface HostTurn {
  sessionId: string;
  /** 这一轮的模型（插话带的图片只给能看图的模型） */
  model: string;
  /** 代理收下了这条消息（收到第一条会话事件）：此后插话、中止才落得到这一轮上 */
  accepted: Promise<void>;
  /** run 已经结束（代理空闲了），正在收尾 */
  finishing: boolean;
  stopping: boolean;
  /** 跟踪的是代理自己醒来的一轮（不是宿主发的消息） */
  wake?: boolean;
  /** 宿主发起的这一轮已经空闲过一次：之后再忙起来就是代理自己醒了 */
  idleSeen?: boolean;
}

/** 一轮的结果 */
export interface TurnResult {
  text: string;
  sessionId: string;
  files: string[];
  usage: TurnUsage;
}

/** 代理自己醒来的一轮：先缓存通知，有人跟踪时交给它；代理空闲时结束 */
class Wake {
  buffer: SdkNotification[] = [];
  listener: ((n: SdkNotification) => void) | undefined;
  ended = false;
  /** 已经有人在跟踪 */
  taken = false;
  readonly done: Promise<void>;
  private settle!: (err?: Error) => void;
  constructor(
    readonly conversationId: string,
    readonly sessionId: string,
    /** 这一轮的回合号（会话上一轮 + 1） */
    readonly turn: number,
  ) {
    this.done = new Promise<void>((resolve, reject) => (this.settle = (err) => (err ? reject(err) : resolve())));
    this.done.catch(() => undefined);
  }
  push(n: SdkNotification): void {
    if (this.listener) this.listener(n);
    else if (this.buffer.length < 5000) this.buffer.push(n);
  }
  attach(fn: (n: SdkNotification) => void): void {
    this.listener = fn;
    for (const n of this.buffer.splice(0)) fn(n);
  }
  end(err?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.settle(err);
  }
}

/** 中止信号的原因（manager 用 TurnStopped 中止；别的原因按用户中止算） */
function stopReason(sig: AbortSignal): TurnStopped {
  return sig.reason instanceof TurnStopped ? sig.reason : new TurnStopped("user", 0);
}

/** 一条 assistant/message 是不是完整的回答（不带工具调用、没被打断）：是就返回它的文字 */
export function answerText(data: any): string {
  if (data?.interrupted) return "";
  const content: any[] = Array.isArray(data?.message?.content) ? data.message.content : [];
  if (content.some((b) => b?.type === "tool-call")) return "";
  return content
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("")
    .trim();
}

/**
 * 每个 bot 一个 DSH 子进程（懒启动）：DSH_HOME = <data>/dsh/<botId>，工作区 = <data>/workspaces/<botId>，
 * workspace-write 沙箱；模型请求经本地 bridge 代理到 magpie（子进程拿不到真实密钥）。
 * 每个会话一个 DSH session（id 存 sqlite，重启后 resume）。
 */
export class AgentHost {
  state: HostState = "stopped";
  lastError = "";
  restarts = 0;
  /** 最近一轮用的模型（子进程启动时是启动用的模型） */
  model = "";
  /** 最近一轮跟模型说话用的接口 */
  api: AgentApi | "" = "";
  /** 最近一轮因为回退才走 Chat Completions：回退记录（状态里显示原因） */
  fallback: ApiFallback | undefined;
  private ownFallbacks: ApiFallbacks | undefined;
  /** 宿主 → 子进程的指令通道（amb-control 插件） */
  readonly control = new ControlChannel();
  /** 模型 → 路线（当前子进程内有效，换进程时重新查模型资料） */
  private routes = new Map<string, Promise<ModelRoute>>();
  /** 用过的模型：重新拉起子进程时都写进补丁 */
  private known = new Set<string>();
  /** 当前子进程已经能用的 provider/model（补丁里的，加上运行中补上的） */
  private childRoutes = new Map<string, ModelRoute>();
  /** 当前子进程启动时的默认路线（会话没选模型时用它） */
  private initRoute: ModelRoute | undefined;
  /** 会话 → 进行中的回合（插话、中止用） */
  private turns = new Map<string, HostTurn>();
  /** DSH session → 代理自己醒来的一轮 */
  private wakes = new Map<string, Wake>();
  /** 正在把消息交给代理的会话（还没登记成回合） */
  private claimed = new Set<string>();
  /** DSH session → 最近的回合号 */
  private lastTurn = new Map<string, number>();
  private harness: SdkHarness | undefined;
  private starting: Promise<SdkHarness> | undefined;
  private opened = new Set<string>();
  private active = 0;
  private failures = 0;
  private nextStartAt = 0;
  private stopped = false;
  /** callId → 工具调用（供审批提示展示命令） */
  readonly calls = new Map<string, { name: string; args: string; at: number }>();
  /** DSH 子进程 stderr 的最后几十行（已脱敏），故障排查页展示 */
  readonly stderrTail: string[] = [];
  /** 最近一次子进程退出 */
  lastExit: { pid: number | undefined; code: number | null; signal: string | null; at: number } | undefined;
  /** 当前子进程启动完成的时间 */
  startedAt = 0;
  /** 正在启动：开始时间与当前阶段（故障排查页显示进度） */
  startingSince = 0;
  initStage = "";
  /** 最近一次成功初始化（子进程拉起到 initialize 返回）的耗时 */
  lastInitMs = 0;
  private initFailures = 0;
  private retryAfter = 0;
  private listeners = new Set<(e: HostEvent) => void>();
  /** 当前子进程补丁里写的 PowerShell（Windows）；代理拉不起它时据此退回 */
  private pwshPath: string | undefined;
  /** 进入 runOnce 还没结束的回合（含还在等进程、等会话的）：有就不在后台重启 */
  private entering = 0;
  /** 当前子进程里打开过的任务会话（子代理的通知按它们归属） */
  private taskSessions = new Set<string>();
  /** 正在跑一轮的任务会话：有就不为设置变化重启（最多等 TASK_RESTART_WAIT_MS） */
  private taskBusy = new Set<string>();
  /** 设置变了、等着重启的起点（0 = 没在等） */
  private staleSince = 0;
  /** 正在问子进程空不空（换新的子进程之前） */
  private recycling = false;
  /** 空闲时换掉的那个子进程（它的退出不用恢复什么） */
  private recycledPid: number | undefined;
  /** 空闲时换过几次子进程（不算重启：用户看不到） */
  recycles = 0;

  constructor(private o: AgentHostOptions) {}

  get home(): string {
    return path.join(this.o.dataDir, "dsh", this.o.botId);
  }
  get workspace(): string {
    return path.join(this.o.dataDir, "workspaces", this.o.botId);
  }
  private get pidFile(): string {
    return path.join(this.home, "amb-host.pid");
  }
  /** 机器人段（amb-prompt 插件现读）：在数据目录里、DSH 主目录之外，代理的文件工具读不到也改不了 */
  get promptFile(): string {
    return path.join(this.o.dataDir, "dsh", ".prompts", `${this.o.botId}.md`);
  }
  get pid(): number | undefined {
    return this.harness?.client?.child?.pid;
  }

  /** 订阅生命周期事件；返回取消函数 */
  on(fn: (e: HostEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: HostEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* ignore */
      }
    }
  }

  /** 接上子进程的 stderr（逐行写日志 + 保留尾部）与退出事件。sdk-client 自己也在读 stderr，两边互不影响。 */
  private watchChild(child: any): void {
    if (!child) return;
    const pid: number | undefined = child.pid;
    const lines = lineLogger(`dsh:${this.o.botId}`, "info", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 80) this.stderrTail.splice(0, this.stderrTail.length - 80);
    });
    child.stderr?.on?.("data", (d: Buffer | string) => lines.push(d));
    child.once?.("exit", (code: number | null, signal: string | null) => {
      lines.flush();
      this.lastExit = { pid, code, signal, at: Date.now() };
      const recycled = pid !== undefined && pid === this.recycledPid;
      if (recycled) this.recycledPid = undefined;
      log.info("dsh process exited", { bot: this.o.botId, pid, code, signal, ...(recycled ? { recycled } : {}) });
      this.emit({ type: "exit", pid, code, signal, ...(recycled ? { recycled } : {}) });
    });
  }

  /**
   * routes：这个代理进程要能用的所有模型（每个接口一个 provider，见 providerProfiles）；第一条是启动时的默认路线。
   * 之后会话换到没列出的模型时由 amb-control 插件在运行中补上（不重启）。
   */
  private writePatch(routes: ModelRoute[] | string, apps: CuaApp[] = [], pwshPath?: string): string {
    const list = typeof routes === "string" ? [this.fallbackRoute(routes)] : routes;
    const plugin = path.join(this.o.runtimeDir, "plugins", "amb-bridge.mjs");
    const memory = path.join(this.o.runtimeDir, "plugins", "amb-memory.mjs");
    this.writeMediaSkill();
    const cuOn = !!this.computerUseActive();
    const text = [
      "# 由 anymodel bot 每次启动生成；请勿手改。",
      // 接口按模型选（agentApi）：Responses / Anthropic Messages / Chat Completions，各一个 provider
      ...providerPatchLines(providerProfiles(list, this.o.bridge.url, this.o.botId)),
      // 长命令转后台；Windows：命令用检测到的 PowerShell 7（DSH 自己只看 Program Files\PowerShell\7 和 PATH，找不到就退回 5.1）
      ...shellPatchLines(pwshPath),
      // 人设：个人助手（替换 DSH 的 coding agent 人设），不要 "powered by DeepSeek Harness" 那句身份
      "- id: system-prompt",
      "  config:",
      `    personaPrefix: ${yamlStr(agentPersona({ computerUse: cuOn }))}`,
      "    includeHarnessIdentity: false",
      "- insert:",
      "    - id: amb-bridge",
      `      name: ${yamlStr(plugin)}`,
      // 机器人段（聊天规则、记忆说明、名字与人设）：每次模型请求从 AMB_PROMPT_FILE 现读
      "    - id: amb-prompt",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-prompt.mjs"))}`,
      // 长期记忆工具（remember/forget/recall，经 bridge 由宿主读写）+ 上下文管家的原地压缩钩子
      // 已有会话也跟随机器人的权限预设（DSH 默认只对新会话生效）
      "    - id: amb-permission",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-permission.mjs"))}`,
      "    - id: amb-memory",
      `      name: ${yamlStr(memory)}`,
      // 生图 / 生视频：宿主带着本机器人的 Key 调 Modelflare，文件存进工作区 media/；技能说明在 skills/media
      "    - id: amb-media",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-media.mjs"))}`,
      // sdk 配置默认不带这两个工具：ask_user_question 走 user-questions → 插件 → 审批中心；
      // present 只声明交付文件，由宿主在回合结束后经渠道发送。
      "    - id: amb-tool-ask-user",
      "      name: '@deepseek-ai/dsh-tool-ask-user'",
      "    - id: amb-present",
      "      name: '@deepseek-ai/dsh-tool-present'",
      // 宿主 → 代理进程的指令通道：按会话中止、插话、按会话选模型；长命令转后台后等它的结果
      "    - id: amb-control",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-control.mjs"))}`,
      // 后台任务：聊天会话的 task_start / task_message / task_list；任务会话的限定工具、任务规则、task_report、收尾
      "    - id: amb-tasks",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-tasks.mjs"))}`,
      ...this.computerUseLines(apps),
      ...this.fullAccessLines(),
      "",
    ].join("\n");
    const f = path.join(this.home, "amb.patch.yml");
    fs.writeFileSync(f, text, { mode: 0o600 });
    return f;
  }

  /**
   * 完全权限：DSH 的 danger-full-access（不进沙箱、不请求提权）。它自带的这个预设把审批策略设成 never（一律自动拒绝），
   * 这里改成 ask，递归删除闸门（amb-delete-gate）才能经审批中心问用户；其他两个预设原样保留。
   * 必须跟在插件 insert 列表的最后：后面两条是顶层的行补丁。
   */
  private fullAccessLines(): string[] {
    if (this.settings().permission !== "full") return [];
    return [
      "    - id: amb-delete-gate",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-delete-gate.mjs"))}`,
      "- id: approval",
      "  config:",
      "    policy: ask",
      "- id: permission",
      "  config:",
      "    presets:",
      "      read-only: { sandbox: read-only, approval: ask }",
      "      workspace-write: { sandbox: workspace-write, approval: ask }",
      "      danger-full-access: { sandbox: danger-full-access, approval: ask }",
    ];
  }

  /** media 技能：怎么挑模型、读文档、写请求体、交付结果。没有连接 Modelflare 时删掉。 */
  private writeMediaSkill(): void {
    const dir = path.join(this.home, "skills", "media");
    try {
      if (!this.o.media) fs.rmSync(dir, { recursive: true, force: true });
      else {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), MEDIA_SKILL);
      }
    } catch (e) {
      log.warn("media skill setup failed", { err: String(e) });
    }
  }

  /** 当前机器上本机器人所选后端的可用性（不看本机器人的开关）。 */
  computerUseStatus(): CuResolved {
    return resolveComputerUse(this.settings().computerUse.backend, this.o.runtimeDir);
  }
  /** 本机器人实际是否启用 Computer Use：系统支持且设置里开着。 */
  private computerUseActive(): CuResolved | undefined {
    if (!this.settings().computerUse.enabled) return undefined;
    const st = this.computerUseStatus();
    return st.available ? st : undefined;
  }
  private cuReadTools = "";
  /**
   * Computer Use：插入 mcp-client（Cua Driver 经 amb-cua-mcp.mjs，或 macOS 上的 Codex 桥；都用宿主自己的
   * node/Electron 运行），并写入对应的 SKILL.md。默认所有操作自动执行；只有设置为 ask-input 时才加载审批闸门。
   */
  private computerUseLines(apps: CuaApp[]): string[] {
    const skillDir = path.join(this.home, "skills", "computer-use");
    const st = this.computerUseActive();
    this.cuReadTools = st ? st.readTools.join(",") : "";
    if (!st) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return [];
    }
    let lines: string[];
    try {
      fs.mkdirSync(skillDir, { recursive: true });
      if (st.backend === "codex") {
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), adaptSkill(fs.readFileSync(st.codex.skill!, "utf8")));
        lines = mcpPatchLines(st.codex, process.execPath, yamlStr);
      } else {
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), CUA_SKILL);
        lines = this.cuaLines(st, apps);
      }
    } catch (e) {
      log.warn("computer-use setup failed", { err: String(e) });
      return [];
    }
    if (this.settings().computerUse.approval === "ask-input") {
      lines.push("    - id: amb-computer-use-gate", `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-computer-use-gate.mjs"))}`);
    }
    return lines;
  }

  /** Cua Driver：写配置（清单在 amb-cua-mcp.mjs 启动时按本平台实有工具生成），返回 mcp-client 配置行。 */
  private cuaLines(st: CuResolved, apps: CuaApp[]): string[] {
    const dir = path.join(this.home, "cua");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const cfg = cuaConfig(st.cua, dir, { readonly: this.settings().permission === "readonly", apps });
    const cfgFile = path.join(dir, "config.json");
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    const env = cuaMcpEnv(process.env, os.homedir(), cfgFile);
    return [
      "    - id: amb-computer-use",
      "      name: '@deepseek-ai/dsh-mcp-client'",
      "      config:",
      "        transport: stdio",
      "        serverName: computer-use",
      `        command: ${yamlStr(process.execPath)}`,
      `        args: [${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-cua-mcp.mjs"))}]`,
      "        env:",
      ...Object.entries(env).map(([k, v]) => `          ${k}: ${yamlStr(v)}`),
      "        toolCallTimeoutMs: 120000",
      "        failOnStartupError: false",
      // 默认最多重连 10 次（约 2.5 分钟）：驱动起不来时每次都要重新拉起 cua-driver，3 次足够分辨偶发与必然
      "        reconnect:",
      "          maxAttempts: 3",
      "          initialDelayMs: 2000",
    ];
  }

  /**
   * Linux：在 PATH 前放一个 bwrap 包装脚本，把整个数据目录（数据库、渠道令牌、magpie 密钥）
   * 用空 tmpfs 遮住，只重新挂回本机器人的工作区与 DSH 主目录。DSH 自带沙箱只限制写，不限制读。
   */
  private writeBwrapShim(): string | undefined {
    if (process.platform !== "linux") return undefined;
    const real = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"].find((p) => fs.existsSync(p));
    if (!real) return undefined;
    const dir = path.join(this.home, ".amb-bin");
    fs.mkdirSync(dir, { recursive: true });
    const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
    const data = path.resolve(this.o.dataDir);
    const script = `#!/bin/sh
# 由 anymodel bot 生成：遮住宿主数据目录后再交给真正的 bwrap。
REAL=${q(real)}
DATA=${q(data)}
WS=${q(path.resolve(this.workspace))}
DHOME=${q(path.resolve(this.home))}
rw=0
prev=
for a do
  if [ "$prev" = "--bind" ] && [ "$a" = "$WS" ]; then rw=1; fi
  prev=$a
done
injected=0
first=1
for a do
  if [ $first = 1 ]; then set --; first=0; fi
  if [ $injected = 0 ] && [ "$a" = "--" ]; then
    set -- "$@" --tmpfs "$DATA"
    if [ $rw = 1 ]; then set -- "$@" --bind "$WS" "$WS"; else set -- "$@" --ro-bind-try "$WS" "$WS"; fi
    set -- "$@" --ro-bind-try "$DHOME" "$DHOME"
    injected=1
  fi
  set -- "$@" "$a"
done
exec "$REAL" "$@"
`;
    const f = path.join(dir, "bwrap");
    fs.writeFileSync(f, script, { mode: 0o755 });
    return dir;
  }

  /** 环境里没设代理时问桌面外壳系统用的代理（每次拉起子进程都重新问：之后才开的代理，下次重启就用上）；命令行、Docker 没有 */
  private async systemProxy(): Promise<Record<string, string>> {
    return this.o.systemProxy && !hasEnvProxy(process.env) ? systemProxyEnv(this.o.systemProxy) : {};
  }

  /** 子进程环境：完全替换 process.env，只给必需项；真实模型密钥永不进入。sysProxy：桌面版问到的系统代理（环境里没设代理时用） */
  private env(sysProxy: Record<string, string> = {}): Record<string, string> {
    const shim = this.writeBwrapShim();
    const basePath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
    const env: Record<string, string> = {
      PATH: shim ? `${shim}${path.delimiter}${basePath}` : basePath,
      AMB_DENY_READ: JSON.stringify([path.resolve(this.o.dataDir)]),
      AMB_ALLOW_READ: JSON.stringify([path.resolve(this.workspace), path.resolve(this.home)]),
      HOME: this.home,
      LANG: "C.UTF-8",
      DSH_PERMISSION_MODE: permissionMode(this.settings().permission),
      AMB_MEMORY: this.settings().memory.enabled ? "1" : "0",
      AMB_CU_APPROVAL: this.settings().computerUse.approval,
      AMB_CU_READ_TOOLS: this.cuReadTools,
      AMB_MAGPIE_KEY: this.o.bridge.token,
      AMB_BRIDGE_URL: this.o.bridge.url,
      AMB_BRIDGE_TOKEN: this.o.bridge.token,
      AMB_BOT_ID: this.o.botId,
      AMB_PROMPT_FILE: this.promptFile,
      AMB_CONTROL_TOKEN: this.control.id,
      // 任务会话的系统提示词段（amb-tasks 插件加在机器人段之后）
      AMB_TASK_RULES: TASK_RULES,
    };
    // 时区：本进程设了 TZ 才传下去；没设就不设，子进程用系统时区（各平台都是，Windows 上 TZ 也只认 POSIX 写法）
    if (process.env.TZ) env.TZ = process.env.TZ;
    // 代理与证书（用户自己的网络设置，不是密钥）：命令里的 pip、npm、git、curl 和用户平时一样联网；回环地址永远不走代理（proxy-env.ts）
    Object.assign(env, networkEnv(process.env, sysProxy));
    if (process.platform === "win32") {
      // Windows：系统目录类变量不是密钥，但工具进程离不开（npm/pip 找 APPDATA，脚本找 ProgramFiles、ComSpec…）。
      // libuv 只自动补 SystemRoot/TEMP/USERPROFILE 等少数几个。
      for (const k of WIN_SYSTEM_ENV) {
        const v = process.env[k];
        if (v) env[k] = v;
      }
    }
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    if (process.env.AMB_DSH_LOG_LEVEL) env.DSH_LOG_LEVEL = process.env.AMB_DSH_LOG_LEVEL;
    return env;
  }

  private settings(): BotSettings {
    return this.o.settings?.() ?? DEFAULT_SETTINGS;
  }
  /**
   * 影响子进程启动参数的设置签名。带上 PowerShell 路径：装好 PowerShell 7、内置的装好或坏了退回时，空闲的代理进程换用新的。
   * 启动时记的是补丁里实际写的路径（pwsh），不是记签名那一刻的选择：中间隔着几次 await，选择可能刚好变了。
   */
  private settingsSig(pwsh = pwshProbe.cachedDshPath): string {
    const st = this.settings();
    return `${st.permission}|${st.memory.enabled}|${st.computerUse.enabled}|${st.computerUse.backend}|${st.computerUse.approval}|${pwsh ?? ""}`;
  }
  private sig = "";

  private reapStale(): void {
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(this.pidFile, "utf8").trim());
    } catch {
      return;
    }
    if (!pid || pid === this.pid) return;
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    let cmd = "";
    try {
      if (process.platform === "linux") cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      else if (process.platform === "darwin") cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      /* ignore */
    }
    if (cmd.includes("--profile") && cmd.includes("amb.patch.yml")) {
      log.warn("reaping orphaned dsh child", { pid });
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }

  /** 上次写进 promptFile 的内容（没变就不写） */
  private promptText: string | undefined;

  /**
   * 把机器人段写进 promptFile（原子替换）。每个回合开始前（ensure）都调一次：改了人设、名字，
   * 下一次模型请求就用上，不用 /new、不用重启代理进程；没变就不写，系统提示词也就保持不变（前缀缓存）。
   */
  syncPrompt(force = false): void {
    const bot = this.o.store.getBot(this.o.botId);
    const text = botPrompt({ name: bot?.name ?? "", persona: bot?.systemPrompt ?? "", memory: this.settings().memory.enabled });
    if (!force && text === this.promptText) return;
    try {
      fs.mkdirSync(path.dirname(this.promptFile), { recursive: true, mode: 0o700 });
      const tmp = `${this.promptFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, this.promptFile);
      this.promptText = text;
    } catch (e) {
      this.promptText = undefined;
      log.warn("bot prompt write failed", { bot: this.o.botId, message: (e as Error).message.slice(0, 200) });
    }
  }

  /**
   * 确保子进程在跑（懒启动）。换模型不再重启：每个会话按自己的模型走（见 useRoute）；
   * 只有设置或 PowerShell 变了、而且没有回合在跑时才重启。
   */
  async ensure(model: string): Promise<SdkHarness> {
    if (this.stopped) throw new Error("agent host stopped");
    this.syncPrompt();
    // 连续启动失败后不再每条消息都重试一遍（每次都要等满初始化超时）：直到手动重启或冷却结束
    if (!this.harness && !this.starting && this.state === "error" && Date.now() < this.retryAfter) {
      throw new Error(t("agent.startRetryLater", { min: Math.ceil((this.retryAfter - Date.now()) / 60_000), error: this.lastError }));
    }
    if (this.harness && this.sig !== this.settingsSig() && this.active === 0 && this.tasksAllowRestart()) {
      log.info("bot settings or PowerShell changed, restarting dsh", { bot: this.o.botId, backgroundTasks: this.taskBusy.size });
      await this.closeHarness();
    }
    if (this.harness) return this.harness;
    this.starting ??= this.spawn(model).finally(() => (this.starting = undefined));
    return this.starting;
  }

  /** 没有模型资料时的路线（Chat Completions、内置兜底的窗口） */
  private fallbackRoute(model: string): ModelRoute {
    return { model, provider: "magpie", api: "openai-completions", limits: modelLimits(model) };
  }

  /**
   * 模型的路线：按 Modelflare 模型资料选接口（agentApi）、定上下文窗口；在该接口上被拒过（24 小时内）就走 Chat。
   * 模型资料在一个子进程的生命期内只查一次（和以前一样：接口在拉起进程时选定）。
   */
  async routeFor(model: string): Promise<ModelRoute> {
    let p = this.routes.get(model);
    if (!p) {
      const ask = <T>(q: Promise<T | undefined> | undefined) => withTimeoutOr(q ?? Promise.resolve(undefined), 3000, undefined).catch(() => undefined);
      p = Promise.all([ask(this.o.contextWindow?.(model)), ask(this.o.apiInfo?.(model))]).then(([known, info]) => {
        const api = agentApi(info?.endpoints);
        return { model, provider: providerFor(api, info?.reasoning), api, limits: modelLimits(model, known), reasoning: info?.reasoning };
      });
      this.routes.set(model, p);
    }
    const r = await p;
    const fb = r.api !== "openai-completions" ? this.fallbacks.get(model) : undefined;
    return fb ? { ...r, provider: "magpie", api: "openai-completions", fallback: fb } : r;
  }

  private routeKey(r: { provider: string; model: string }): string {
    return `${r.provider}|${r.model}`;
  }

  /**
   * 设置变了时，后台任务允不允许重启：没有任务在跑一轮就可以；一直有就最多等 TASK_RESTART_WAIT_MS，
   * 之后照样重启（跑着的任务记为中断，随后带着恢复说明接着做）。
   */
  private tasksAllowRestart(): boolean {
    if (!this.taskBusy.size) {
      this.staleSince = 0;
      return true;
    }
    this.staleSince ||= Date.now();
    return Date.now() - this.staleSince >= TASK_RESTART_WAIT_MS;
  }

  /**
   * 设置或 PowerShell 变了（比如内置 PowerShell 7 刚装好、或者坏了退回）而且空闲：在后台重启子进程，
   * 下一条消息不用再等启动。正在跑的回合不打断，等下一条消息时由 ensure() 换。
   * 开过的任务、规则会话多了（RECYCLE_AFTER_SESSIONS）也走这里换一个新的，但只在完全空闲时（见 fullyIdle），从不等着打断谁：
   * 没有要恢复的，用户看不到。回合、任务和规则的 run 结束时都来看一次。
   */
  async restartIfStale(): Promise<void> {
    if (!this.harness || this.starting || this.active > 0 || this.entering > 0 || this.stopped) return;
    if (this.sig !== this.settingsSig()) {
      if (!this.tasksAllowRestart()) return;
      log.info("bot settings or PowerShell changed while idle, restarting dsh in the background", { bot: this.o.botId });
    } else if (this.worn && !this.recycling) {
      this.recycling = true;
      let idle = false;
      try {
        idle = await this.fullyIdle();
      } finally {
        this.recycling = false;
      }
      if (!idle) return;
      log.info("dsh holds many finished task and rule sessions; replacing it while idle", { bot: this.o.botId, sessions: this.taskSessions.size, pid: this.pid });
      this.recycledPid = this.pid;
      this.recycles++;
    } else return;
    const model = this.model;
    await this.closeHarness();
    this.state = "stopped";
    await this.ensure(model).catch(() => undefined);
  }

  /** 这个子进程开过的任务、规则会话（含 resume 的）比 RECYCLE_AFTER_SESSIONS 多 */
  private get worn(): boolean {
    const env = Number(process.env.AMB_DSH_RECYCLE_SESSIONS);
    return this.taskSessions.size > (env > 0 ? env : RECYCLE_AFTER_SESSIONS);
  }

  /**
   * 能不能悄悄换掉子进程：这边没有聊天回合（含正在进入的、代理自己醒来的）、没有任务会话在跑一轮，宿主那边也空闲（o.idle：
   * 没有在跑或收尾的 run、没有等批准的、没有在压缩的会话），子进程里每个代理都空着、没有排着的输入、没有在跑的后台命令。
   * 问子进程要一来一回，回来之后再看一遍这边。
   */
  private async fullyIdle(): Promise<boolean> {
    const here = () =>
      !!this.harness &&
      !this.starting &&
      !this.stopped &&
      this.active === 0 &&
      this.entering === 0 &&
      this.turns.size === 0 &&
      this.claimed.size === 0 &&
      this.wakes.size === 0 &&
      this.taskBusy.size === 0 &&
      (this.o.idle?.() ?? true);
    if (!here() || !this.control.connected) return false;
    const r = await this.control.send<{ busy?: number; jobs?: number }>("idle", {}, 5_000).catch(() => undefined);
    return r?.busy === 0 && r?.jobs === 0 && here();
  }

  /** 本机上一次成功启动的耗时；没有记录 = 第一次启动（冷启动：杀毒软件逐个扫描运行时文件，可能要几分钟） */
  private get initRecordFile(): string {
    return path.join(this.o.dataDir, "dsh", ".init.json");
  }
  private readInitRecord(): { ms: number; at: number } | undefined {
    try {
      const j = JSON.parse(fs.readFileSync(this.initRecordFile, "utf8"));
      return Number(j?.ms) > 0 ? { ms: Number(j.ms), at: Number(j.at) || 0 } : undefined;
    } catch {
      return undefined;
    }
  }
  /** 初始化超时：第一次 10 分钟，之后 3 分钟（AMB_DSH_INIT_TIMEOUT_MS 可覆盖） */
  initTimeoutMs(): number {
    const env = Number(process.env.AMB_DSH_INIT_TIMEOUT_MS);
    if (env > 0) return env;
    return this.readInitRecord() ? 180_000 : 600_000;
  }

  private stage(name: string, t0: number, extra: Record<string, unknown> = {}): void {
    this.initStage = name;
    log.info(`dsh start: ${name}`, { bot: this.o.botId, ms: Date.now() - t0, ...extra });
  }

  private async spawn(model: string): Promise<SdkHarness> {
    const wait = this.nextStartAt - Date.now();
    if (wait > 0) {
      this.state = "backoff";
      await new Promise((r) => setTimeout(r, wait));
    }
    this.state = "starting";
    this.startingSince = Date.now();
    this.initStage = "prepare";
    const t0 = Date.now();
    let h: SdkHarness | undefined;
    let watchdog: NodeJS.Timeout | undefined;
    try {
      fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
      fs.mkdirSync(this.workspace, { recursive: true });
      this.reapStale();
      await this.o.bridge.start();
      this.stage("bridge ready", t0, { port: this.o.bridge.port });
      const sdk = await loadSdk(this.o.runtimeDir);
      this.stage("sdk loaded", t0);
      // 应用清单（Computer Use 的能力清单用）异步扫描并缓存，不阻塞主进程
      const cu = this.computerUseActive();
      const apps = cu && cu.backend === "cua" ? await discoverAppsCached() : [];
      const pwshPath = await pwshProbe.dshPath();
      const sysProxy = await this.systemProxy();
      // 模型资料在新进程里重新查；用过的模型都写进补丁（会话各用各的模型），启动用的模型排第一
      this.routes.clear();
      this.known.add(model);
      const first = await this.routeFor(model);
      const routes = [first, ...(await Promise.all([...this.known].filter((m) => m !== model).map((m) => this.routeFor(m))))];
      const api = first.api;
      const patch = this.writePatch(routes, apps, pwshPath);
      this.syncPrompt(true);
      this.pwshPath = pwshPath;
      this.sig = this.settingsSig(pwshPath);
      const timeoutMs = this.initTimeoutMs();
      this.control.reset();
      this.stage("patch written", t0, { api, models: routes.length, computerUse: cu ? cu.backend : "off", apps: apps.length, initTimeoutMs: timeoutMs, proxy: hasEnvProxy(process.env) ? "env" : (sysProxy.HTTPS_PROXY ?? sysProxy.ALL_PROXY ?? "none"), ...(process.platform === "win32" ? { pwsh: pwshPath ?? "dsh default (Windows PowerShell 5.1)" } : {}) });
      h = new sdk.DeepSeekHarness({
        profile: "sdk",
        patches: [patch],
        dshHome: this.home,
        env: this.env(sysProxy),
        cwd: this.workspace,
        processCwd: this.workspace,
        provider: first.provider,
        model,
        initializeTimeoutMs: timeoutMs,
        shutdownTimeoutMs: 3000,
      });
      // start() 同步拉起子进程，然后才等 initialize：此时就能接上 stderr，启动阶段的报错也不会漏
      const tSpawn = Date.now();
      const started = h.start();
      const spawned = h.client?.child;
      this.watchChild(spawned);
      this.stage("child spawned", t0, { pid: spawned?.pid, model, runtime: this.o.runtimeDir });
      this.initStage = "initializing";
      this.emit({ type: "spawned", pid: spawned?.pid });
      // 初始化迟迟不回来时每 15 秒记一条，带上最近的 stderr：冷启动慢还是卡住，日志里一眼能看出来
      watchdog = setInterval(
        () => log.warn("dsh still initializing", { bot: this.o.botId, pid: spawned?.pid, waitedMs: Date.now() - tSpawn, timeoutMs, lastStderr: this.stderrTail.at(-1) }),
        15_000,
      );
      await started;
      clearInterval(watchdog);
      const initMs = Date.now() - tSpawn;
      this.lastInitMs = initMs;
      this.emit({ type: "initialized", pid: spawned?.pid, ms: initMs });
      try {
        fs.writeFileSync(this.initRecordFile, JSON.stringify({ ms: initMs, at: Date.now() }));
      } catch {
        /* ignore */
      }
      const child = h.client?.child;
      if (child?.pid) fs.writeFileSync(this.pidFile, String(child.pid));
      const harness = h;
      // 所有通知先同步经过 tap（filter 回调按到达顺序调用；返回 false 不排队）：认出代理自己醒来的一轮
      h.client?.subscribe?.((n: SdkNotification) => {
        if (this.harness === harness) {
          try {
            this.tap(n);
          } catch (e) {
            log.warn("notification tap failed", { message: (e as Error).message });
          }
        }
        return false;
      });
      child?.once?.("exit", (code: number | null, sig: string | null) => {
        if (this.harness !== harness) return;
        this.harness = undefined;
        this.opened.clear();
        this.taskSessions.clear();
        this.taskBusy.clear();
        this.control.close();
        this.endWakes();
        if (this.stopped) return;
        this.onFailure(new Error(`dsh exited (code=${code} signal=${sig})`));
      });
      this.harness = h;
      this.childRoutes = new Map(routes.flatMap((r) => [[this.routeKey(r), r] as const, [this.routeKey({ provider: "magpie", model: r.model }), r] as const]));
      this.initRoute = first;
      this.model = model;
      this.api = api;
      this.fallback = first.fallback;
      this.state = "running";
      this.initStage = "";
      this.lastError = "";
      this.initFailures = 0;
      this.startedAt = Date.now();
      log.info("dsh started", { bot: this.o.botId, pid: child?.pid, model, api, models: routes.length, ms: Date.now() - t0, initMs });
      return h;
    } catch (e) {
      clearInterval(watchdog);
      this.control.close(tr("agent.closeStartFailed"));
      this.emit({ type: "failed", message: (e as Error).message });
      this.initFailures++;
      this.onFailure(e as Error);
      if (h) {
        try {
          await h.close();
        } catch {
          /* ignore */
        }
      }
      throw e;
    } finally {
      this.startingSince = 0;
    }
  }

  private onFailure(e: Error): void {
    this.failures++;
    this.restarts++;
    this.lastError = e.message.slice(0, 500);
    if (this.initFailures >= 2) {
      // 连续两次起不来：先停 10 分钟（期间纯对话照常），不再每条消息都等一遍初始化
      this.state = "error";
      this.retryAfter = Date.now() + 10 * 60_000;
      log.error("dsh failed to start twice; agent paused for 10 minutes (plain chat still works)", { bot: this.o.botId, message: this.lastError });
      this.o.onNotice?.(t("agent.startPaused", { error: this.lastError.slice(0, 200) }));
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5));
    this.nextStartAt = Date.now() + delay;
    this.state = "backoff";
    log.warn("dsh failure, will restart on demand", { bot: this.o.botId, delayMs: delay, message: this.lastError });
  }

  /** 子进程没了：醒着的那几轮随之失败 */
  private endWakes(): void {
    for (const w of this.wakes.values()) w.end(new Error(tr("agent.processExited")));
    this.wakes.clear();
  }

  private async closeHarness(): Promise<void> {
    const h = this.harness;
    this.harness = undefined;
    this.opened.clear();
    this.taskSessions.clear();
    this.taskBusy.clear();
    this.control.close(tr("agent.processRestarted"));
    this.endWakes();
    if (!h) return;
    try {
      await h.close();
    } catch (e) {
      log.warn("dsh close failed", { message: (e as Error).message });
    }
    try {
      fs.rmSync(this.pidFile, { force: true });
    } catch {
      /* ignore */
    }
  }

  /** 会话 → DSH session（重启后从 sqlite resume；resume 失败则开新 session）。 */
  private async sessionFor(h: SdkHarness, conversationId: string): Promise<SdkSession> {
    const stored = this.o.store.getAgentSession(conversationId);
    if (stored && this.opened.has(stored)) return h.session(stored);
    if (stored) {
      try {
        const s = await h.resumeSession(stored);
        this.opened.add(stored);
        return s;
      } catch (e) {
        log.warn("session resume failed, starting new", { message: (e as Error).message.slice(0, 200) });
      }
    }
    const s = h.session();
    this.o.store.setAgentSession(conversationId, this.o.botId, s.id);
    this.opened.add(s.id);
    return s;
  }

  resetConversation(conversationId: string): void {
    this.o.store.clearAgentSession(conversationId);
  }

  /**
   * 能否把用户发来的图片交给 DSH。DSH 收图时用 sharp 规范化，而 sharp 在 Linux 上的 Electron 里会让进程崩溃
   * （SharpElectronLinux，见 scripts/verify-dsh-bundle.mjs），那里只给工作区路径。其它平台上如果带图的回合
   * 让 DSH 崩了，本次运行期间也不再给图。
   */
  imageInput = !(process.versions.electron && process.platform === "linux") && process.env.AMB_DSH_IMAGES !== "0";

  get fallbacks(): ApiFallbacks {
    return this.o.apiFallbacks ?? (this.ownFallbacks ??= new ApiFallbacks());
  }

  /**
   * 跑一个回合。Responses / Anthropic Messages 上的请求被上游拒绝（请求形状不被接受，不是限流、余额、故障）时：
   * 记下这个模型改走 Chat Completions；这一轮还没调用过工具的话，把这个会话换到 Chat 上重做一遍（只重做一次，不重启进程）。
   */
  async runTurn(input: TurnInput): Promise<TurnResult> {
    try {
      return await this.runOnce(input);
    } catch (e) {
      if (!(e instanceof ApiRejected) || !e.retryable || input.signal?.aborted) throw e;
      log.warn("agent turn rejected on its API; retrying it once over Chat Completions", { bot: this.o.botId, model: input.model, api: e.api, reason: e.reason });
      input.observer?.onEvent?.("api/fallback", { from: e.api, to: "openai-completions", reason: e.reason }, Date.now());
      // routeFor() 看到回退记录，这个会话改选 Chat 的路线。用户这条消息（连同图片）在被拒之前已经存进会话，
      // 不再发一遍，只请模型处理它
      return await this.runOnce({ ...input, text: RETRY_NOTE, images: undefined });
    }
  }

  private async runOnce(input: TurnInput): Promise<TurnResult> {
    this.entering++;
    try {
      return await this.runEntered(input);
    } finally {
      this.entering--;
      // 回合中 PowerShell 换了（比如刚发现它起不来）：回合结束、空闲了就在后台换上
      if (this.entering === 0) void this.restartIfStale();
    }
  }

  /**
   * 让这个会话用这条路线：子进程还不认识这个模型就经插件补进 provider 配置，再按会话选定。
   * 插件不通、补不进去时返回 false（只有启动时的默认路线不用选）。
   */
  private async useRoute(sessionId: string, route: ModelRoute): Promise<boolean> {
    const key = this.routeKey(route);
    const isInit = !!this.initRoute && this.routeKey(this.initRoute) === key;
    // 插件刚起来可能还没来取指令：要靠它时等一会儿；启动时的默认路线不靠它也能用
    const ready = this.control.connected || (!(isInit && this.childRoutes.has(key)) && (await this.control.ready(5000)));
    if (!this.childRoutes.has(key)) {
      if (!ready) return false;
      const list = [...new Set(this.childRoutes.values()), route];
      try {
        await this.control.send("providers", { providers: providerProfiles(list, this.o.bridge.url, this.o.botId) }, 20_000);
        this.childRoutes.set(key, route);
        this.childRoutes.set(this.routeKey({ provider: "magpie", model: route.model }), route);
        log.info("model added to the running dsh", { bot: this.o.botId, model: route.model, provider: route.provider });
      } catch (e) {
        log.warn("could not add a model to the running dsh", { bot: this.o.botId, model: route.model, message: (e as Error).message.slice(0, 300) });
        return false;
      }
    }
    if (ready) {
      try {
        await this.control.send("select", { sessionId, provider: route.provider, model: route.model }, 10_000);
        return true;
      } catch (e) {
        log.warn("model selection failed", { bot: this.o.botId, model: route.model, message: (e as Error).message.slice(0, 200) });
      }
    }
    return isInit;
  }

  private async runEntered(input: TurnInput): Promise<TurnResult> {
    const conv = input.conversationId;
    // 这个会话正在交给代理：期间代理自己醒来（后台命令结束）不另开一轮跟踪，这一轮的 run 会收下它的事件
    this.claimed.add(conv);
    try {
      return await this.runClaimed(input);
    } finally {
      this.claimed.delete(conv);
    }
  }

  private async runClaimed(input: TurnInput): Promise<TurnResult> {
    const route = await this.routeFor(input.model);
    let s = await this.sessionFor(await this.ensure(input.model), input.conversationId);
    // 在等进程 / 会话时就被中止了：消息还没交出去，不用动子进程
    if (input.signal?.aborted) throw stopReason(input.signal);
    if (!(await this.useRoute(s.id, route))) {
      // 指令通道不通、或补不进这个模型：没有别的回合在跑时，带上这个模型重启子进程；忙的时候不能让这个会话悄悄用错模型
      if (this.active > 0 || this.taskBusy.size > 0) throw new Error(tr("agent.cantSwitchBusy", { model: input.model }));
      log.warn("restarting dsh to use a model it could not add at runtime", { bot: this.o.botId, model: input.model });
      this.known.add(input.model);
      await this.closeHarness();
      this.state = "stopped";
      s = await this.sessionFor(await this.ensure(input.model), input.conversationId);
      if (!(await this.useRoute(s.id, route))) throw new Error(tr("agent.cantUseModel", { model: input.model }));
    }
    // 代理自己醒着的一轮（后台命令结束）还没完：等它完了再发这条（它的回复由跟踪它的那一轮发出）
    const woke = this.wakes.get(s.id);
    if (woke && !woke.ended) await withTimeoutOr(woke.done.catch(() => undefined), this.o.turnTimeoutMs ?? 30 * 60_000, undefined);
    if (input.signal?.aborted) throw stopReason(input.signal);
    this.active++;
    this.known.add(input.model);
    this.model = input.model;
    this.api = route.api;
    this.fallback = route.fallback;
    let accept!: () => void;
    const turn: HostTurn = { sessionId: s.id, model: input.model, accepted: new Promise<void>((r) => (accept = r)), finishing: false, stopping: false };
    this.turns.set(input.conversationId, turn);
    this.claimed.delete(input.conversationId);
    const images = this.imageInput ? (input.images ?? []) : [];
    // 这一轮：用的接口、上游拒绝过本机器人的哪些模型请求
    const api = route.api;
    const trk = this.tracker(s.id, route, input.observer, accept);
    const rejections: Rejection[] = [];
    const offRejection =
      this.o.bridge.onRejection?.((r) => {
        if (r.bot === this.o.botId && /\/v1\/(responses|messages)$/.test(r.path)) rejections.push(r);
      }) ?? (() => {});
    try {
      const prompt = images.length ? [{ type: "text", text: input.text }, ...images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }))] : input.text;
      input.observer?.onStart?.();
      const run = s.run(prompt, { onNotification: trk.onNotification });
      const r = await this.awaitTurn(turn, run, input.signal);
      this.failures = 0;
      const { turnError, toolCalls, presented, answers, usage } = trk.st;
      const rejected = turnError !== undefined && api !== "openai-completions" ? shapeRejection(rejections, turnError) : undefined;
      if (rejected) this.rememberFallback(input.model, api, rejected);
      if (!r.finalResponse && turnError) {
        // 已经调用过工具（命令可能已经执行）就不重做，照常报错；下一轮起走 Chat
        if (rejected) throw new ApiRejected(turnError, api, rejected, toolCalls === 0 && presented.length === 0);
        throw new Error(turnError);
      }
      return { text: answers.length > 1 ? answers.join("\n\n") : r.finalResponse, sessionId: s.id, files: deliverables(this.workspace, presented), usage };
    } catch (e) {
      if (e instanceof TurnStopped) {
        log.warn("agent turn stopped", { bot: this.o.botId, reason: e.reason, ms: e.ms, restarted: e.restarted, otherTurns: this.active - 1 });
      } else if (images.length && this.state !== "running") {
        this.imageInput = false;
        log.warn("dsh died on a turn with images; sending images by path only until the app restarts", { bot: this.o.botId, message: (e as Error).message.slice(0, 200) });
      }
      throw e;
    } finally {
      turn.finishing = true;
      offRejection();
      if (this.turns.get(input.conversationId) === turn) this.turns.delete(input.conversationId);
      this.active--;
    }
  }

  /**
   * 一轮的事件处理：工具调用（审批提示用）、交付文件、用量、模型的完整回答、出错原因，再转给观察者（活动记录、看门狗）。
   * accept：第一条本会话事件到达时调用（代理收下了消息）。
   */
  private tracker(sessionId: string, route: ModelRoute, observer: TurnObserver | undefined, accept?: () => void) {
    const st = {
      toolCalls: 0,
      presented: [] as string[],
      /** 这一轮里模型的每个完整回答（不带工具调用的回复）：插进来的消息让回合多答了一次时，几次回答都交给用户 */
      answers: [] as string[],
      usage: { tokens: 0, window: route.limits.window, maxTokens: route.limits.maxTokens } as TurnUsage,
      turnError: undefined as string | undefined,
    };
    const onNotification = (n: SdkNotification) => {
      if (process.env.AMB_DSH_TRACE) fs.appendFileSync(process.env.AMB_DSH_TRACE, JSON.stringify(n).slice(0, 2000) + "\n");
      if (n.method === "subagent.started" || n.method === "subagent.finished") return observer?.onEvent?.(n.method.replace(".", "/"), n.params, Date.now());
      if (n.method !== "session.event") return;
      // 子代理会话的事件（只送来本会话和它的子代理的通知）：不进本回合的用量和步骤，只说明子代理还在干活
      if (n.params?.sessionId !== sessionId) return observer?.onEvent?.("subagent/event", { sessionId: n.params?.sessionId, event: n.params?.event }, Number(n.params?.event?.time) || Date.now());
      // 第一条通知就是代理收下这条消息的回执：此后才能插话、中止
      accept?.();
      const ev = n.params.event;
      const data = ev?.data ?? {};
      if (ev?.type === "tool/call") {
        st.toolCalls++;
        this.calls.set(String(data.callId), { name: String(data.name), args: String(data.arguments ?? ""), at: Date.now() });
        if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!);
        if (data.name === "present") st.presented.push(...presentPaths(String(data.arguments ?? "")));
        observer?.onProgress?.(`🔧 ${summarizeCall(String(data.name), String(data.arguments ?? "")).split(this.workspace + "/").join("")}`);
      }
      if (ev?.type === "tool/result") {
        // Windows：PowerShell 本身拉不起来（被杀毒软件删了、被策略拦了…）时退回下一个，不让代理一直用一个起不来的 shell（其他平台上探测器不管）
        const msg = data?.message ?? {};
        const call = this.calls.get(String(msg.toolCallId ?? ""));
        if (call && /^(pwsh|powershell)$/i.test(call.name)) pwshProbe.observeToolResult(this.pwshPath, contentText(msg.content));
      }
      if (ev?.type === "request/context" && Number(data?.contextWindow) > 0) st.usage.window = Number(data.contextWindow);
      if (ev?.type === "assistant/message") {
        if (data?.usage) {
          const u = data.usage;
          const t = Number(u.totalTokens) || (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0);
          if (t > 0) st.usage.tokens = t;
        }
        const answer = answerText(data);
        if (answer) st.answers.push(answer);
      }
      if (ev?.type === "turn/end" && data?.reason?.kind === "error") st.turnError = String(data.reason.error?.message ?? "unknown error");
      observer?.onEvent?.(String(ev?.type), data, Number(ev?.time) || Date.now());
    };
    return { st, onNotification };
  }

  /**
   * 等一轮结束；中止（/stop、看门狗、单回合上限）时只中止这个会话（agent.cancel），宽限期内没停下才重启子进程。
   * 中止了就抛 TurnStopped（restarted 说明有没有重启）。
   */
  private async awaitTurn<T>(turn: HostTurn, run: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    // 宽限期内没停下、子进程被关掉时，run 随后以"runtime closed"失败，已经没人等它
    run.catch(() => undefined);
    const timeoutMs = this.o.turnTimeoutMs ?? 30 * 60_000;
    let stopping: Promise<TurnStopped> | undefined;
    let wake!: () => void;
    const stopRequested = new Promise<void>((r) => (wake = r));
    const stop = (why: TurnStopped) => {
      if (stopping) return;
      turn.stopping = true;
      stopping = this.stopSession(turn, why, run);
      wake();
    };
    const timer = setTimeout(() => stop(new TurnStopped("timeout", timeoutMs)), timeoutMs);
    const onAbort = () => stop(stopReason(signal!));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const first = await Promise.race([run.then((r) => ({ r }), (e: unknown) => ({ e })), stopRequested.then(() => undefined)]);
      turn.finishing = true;
      if (stopping) throw await stopping;
      if (!first) throw new Error("agent turn ended without a result");
      if ("e" in first) throw first.e;
      return first.r;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 所有通知都先经过这里（同步，按到达顺序）：认出代理自己醒来的一轮（后台命令结束时 DSH 唤醒空闲的代理），
   * 把这一轮的事件交给跟踪它的人。宿主发起的一轮在它第一次空闲之前不算。
   */
  private tap(n: SdkNotification): void {
    // 后台任务的会话：交给任务服务（它自己判断一轮什么时候结束），不当成聊天会话的醒来
    const root = this.taskRoot(n);
    if (root) {
      if (n.method === "session.status" && n.params?.sessionId === root) {
        if (n.params.status === "running") this.taskBusy.add(root);
        else if (n.params.status === "idle") this.taskBusy.delete(root);
      }
      // 任务会话（和它的子代理）的工具调用也记下：它们要批准时，审批里显示这条命令
      const ev = n.method === "session.event" ? n.params?.event : undefined;
      if (ev?.type === "tool/call" && ev.data?.callId) {
        this.calls.set(String(ev.data.callId), { name: String(ev.data.name), args: String(ev.data.arguments ?? ""), at: Date.now() });
        if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!);
      }
      this.o.onTaskEvent?.(root, n);
      return;
    }
    for (const w of this.wakes.values()) if (!w.ended && this.relates(n, w.sessionId)) w.push(n);
    // 每个会话最近的回合号（代理自己醒来的那一轮是下一个）
    const ev = n.method === "session.event" ? n.params?.event : undefined;
    if ((ev?.type === "turn/start" || ev?.type === "turn/end") && Number(ev.data?.turn) > 0) this.lastTurn.set(String(n.params.sessionId), Number(ev.data.turn));
    if (n.method !== "session.status") return;
    const sid = String(n.params?.sessionId ?? "");
    const own = [...this.turns.values()].find((t) => t.sessionId === sid && !t.wake);
    if (n.params?.status === "idle") {
      if (own) own.idleSeen = true;
      this.wakes.get(sid)?.end();
      return;
    }
    if (n.params?.status !== "running" || (own && !own.idleSeen)) return;
    const prev = this.wakes.get(sid);
    if (prev && !prev.ended) return;
    const conv = this.o.store.conversationForSession(sid);
    // 只跟踪会话自己的 DSH session（不是子代理、不是归档了的旧段）
    if (!conv || this.o.store.getAgentSession(conv) !== sid || this.claimed.has(conv)) return;
    const w = new Wake(conv, sid, (this.lastTurn.get(sid) ?? 0) + 1);
    this.wakes.set(sid, w);
    log.info("agent woke up on its own (a background job ended); following that turn", { bot: this.o.botId, conversationId: conv });
    // 没人接（没有渠道能回复）：结束一分钟后丢掉
    void w.done.then(
      () => setTimeout(() => !w.taken && this.wakes.get(sid) === w && this.wakes.delete(sid), 60_000).unref?.(),
      () => undefined,
    );
    try {
      this.o.onWake?.(conv, sid);
    } catch (e) {
      log.warn("wake handler failed", { message: (e as Error).message });
    }
  }

  /** 这个会话是不是任务会话或它的子代理：是就给出任务会话 id（子代理里的审批也算这个任务的） */
  taskRootOf(sessionId: string): string | undefined {
    return this.taskRoot({ method: "session.event", params: { sessionId } } as SdkNotification);
  }

  /** 通知属于哪个任务会话（task-* 本身、规则的 rule-*，或它们的子代理）；不属于任务就是 undefined */
  private taskRoot(n: SdkNotification): string | undefined {
    const sub = n.method === "subagent.started" || n.method === "subagent.finished";
    const sid = String((sub ? n.params?.parentSessionId : n.params?.sessionId) ?? "");
    if (!sid) return undefined;
    if (sid.startsWith("task-") || sid.startsWith("rule-")) return sid;
    if (!this.taskSessions.size) return undefined;
    const c = this.harness?.client;
    if (typeof c?.isDescendantOf !== "function") return undefined;
    for (const t of this.taskSessions) if (c.isDescendantOf(sid, t)) return t;
    return undefined;
  }

  /**
   * 把一条输入交给后台任务的会话（SDK：session/prompt），返回 DSH 的收件 id，不等这一轮结束：
   * 这一轮的事件经 onTaskEvent 交给任务服务。会话第一次用时建出来（工作目录是任务文件夹，在工作区里，沙箱根仍是工作区）；
   * 在新的子进程里先 resume（失败抛 ResumeFailed）。任务用它自己的模型（按会话选，和聊天一样不用重启）。
   */
  async promptTask(o: { sessionId: string; folder: string; model: string; text: string; resume: boolean }): Promise<string> {
    if (!o.model) throw new Error(tr("agent.noModelAvailable"));
    const route = await this.routeFor(o.model);
    const h = await this.ensure(o.model);
    this.taskSessions.add(o.sessionId);
    if (!this.opened.has(o.sessionId)) {
      if (o.resume) {
        try {
          await h.resumeSession(o.sessionId);
        } catch (e) {
          throw new ResumeFailed((e as Error).message);
        }
      } else {
        fs.mkdirSync(o.folder, { recursive: true });
        await h.session(o.sessionId).setWorkingDirectory(o.folder);
      }
      this.opened.add(o.sessionId);
    }
    if (!(await this.useRoute(o.sessionId, route))) throw new Error(tr("agent.cantUseModel", { model: o.model }));
    this.known.add(o.model);
    return await h.client.prompt(o.sessionId, [{ type: "text", text: o.text }]);
  }

  /**
   * 并进任务正在进行的一轮（agent.steer，messageId 是我们的输入 id，会话里的用户消息用同一个 id：任务服务按它记下"收下了"）；
   * 会话空闲时返回 false。不能叫 id：那是指令自己的 id（control.ts 的 send 会盖掉它）
   */
  async steerTask(sessionId: string, id: string, text: string): Promise<boolean> {
    if (!this.control.connected) return false;
    const r = await this.control.send<{ accepted?: boolean }>("steer", { sessionId, messageId: id, text, images: [] }, 15_000);
    return !!r.accepted;
  }

  /** 任务的会话在 DSH 里的记录（DSH_HOME/sessions 下，见 tasks/retention.ts）占多大 */
  taskSessionBytes(taskId: string): number {
    return taskSessionDirs(this.home, taskId).reduce((n, d) => n + dirBytes(d), 0);
  }

  /**
   * 删掉任务会话在 DSH 里的记录（3f：归档、删除任务时）。SDK 没有删会话的接口，直接删目录；会话还开在当前子进程里的不删
   * （DSH 可能还拿着它的文件），返回 false，等子进程换过之后再删。
   */
  removeTaskSessions(taskId: string): boolean {
    const name = `task-${taskId}`;
    if ([...this.opened].some((id) => id === name || id.startsWith(name + "-"))) return false;
    for (const dir of taskSessionDirs(this.home, taskId)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        log.warn("removing a task's session files failed", { task: taskId, message: (e as Error).message.slice(0, 200) });
        return false;
      }
    }
    return true;
  }

  /** 停掉任务会话（amb-tasks：取消这一轮、子代理和它的所有后台命令，之后的工具调用一律拒绝） */
  async stopTask(sessionId: string): Promise<void> {
    if (!this.harness || !this.control.connected) return;
    await this.control.send("task-stop", { sessionId }, 15_000);
  }

  /** 停下任务会话的这一轮（amb-tasks：取消它、子代理和它的后台命令），会话之后还能接着用：预算用完、时间到了（3e） */
  async cancelTask(sessionId: string): Promise<void> {
    if (!this.harness || !this.control.connected) return;
    await this.control.send("task-cancel", { sessionId }, 15_000);
  }

  /** 任务会话空闲时，还有没有它的后台命令、子代理在跑（插件在它们结束后报 task-settled）；通道不通按安静算 */
  async taskQuiet(sessionId: string): Promise<{ quiet: boolean; jobs?: string[] }> {
    if (!this.harness || !this.control.connected) return { quiet: true };
    return await this.control.send<{ quiet: boolean; jobs?: string[] }>("task-quiet", { sessionId }, 15_000);
  }

  /** 通知属于这个会话或它的子代理 */
  private relates(n: SdkNotification, root: string): boolean {
    const c = this.harness?.client;
    const under = (id: string) => id === root || (typeof c?.isDescendantOf === "function" && !!c.isDescendantOf(id, root));
    if (n.method === "subagent.started" || n.method === "subagent.finished") return under(String(n.params?.parentSessionId ?? "")) || n.params?.childSessionId === root;
    return under(String(n.params?.sessionId ?? ""));
  }

  /** 这个会话的代理自己醒着（后台命令结束后被唤醒） */
  woke(conversationId: string): boolean {
    return !!this.wakeId(conversationId);
  }

  /** 代理自己醒来、还没人跟着的那一轮的确定标识（DSH session + 回合号）：出站消息的 id 由它推出，同一轮的回复只发一次 */
  wakeId(conversationId: string): string | undefined {
    const w = [...this.wakes.values()].find((x) => x.conversationId === conversationId && !x.taken);
    return w ? `${w.sessionId}:t${w.turn}` : undefined;
  }

  /**
   * 跟踪代理自己醒来的一轮（见 tap）：和普通回合一样记步骤、算用量、收交付文件，能插话、能中止，
   * 结束时返回模型的回复，由运行时发到会话里。
   */
  async followTurn(input: { conversationId: string; model: string; observer?: TurnObserver; signal?: AbortSignal }): Promise<TurnResult> {
    const w = [...this.wakes.values()].find((x) => x.conversationId === input.conversationId && !x.taken);
    if (!w) throw new Error("no wake-up turn to follow");
    w.taken = true;
    const route = await this.routeFor(input.model);
    this.active++;
    const turn: HostTurn = { sessionId: w.sessionId, model: input.model, accepted: Promise.resolve(), finishing: false, stopping: false, wake: true };
    this.turns.set(input.conversationId, turn);
    const trk = this.tracker(w.sessionId, route, input.observer);
    try {
      input.observer?.onStart?.();
      w.attach(trk.onNotification);
      await this.awaitTurn(turn, w.done, input.signal);
      const { turnError, answers, presented, usage } = trk.st;
      if (!answers.length && turnError) throw new Error(turnError);
      return { text: answers.join("\n\n"), sessionId: w.sessionId, files: deliverables(this.workspace, presented), usage };
    } catch (e) {
      if (e instanceof TurnStopped) log.warn("agent wake-up turn stopped", { bot: this.o.botId, reason: e.reason, restarted: e.restarted });
      throw e;
    } finally {
      turn.finishing = true;
      if (this.wakes.get(w.sessionId) === w) this.wakes.delete(w.sessionId);
      if (this.turns.get(input.conversationId) === turn) this.turns.delete(input.conversationId);
      this.active--;
      if (this.active === 0) void this.restartIfStale();
    }
  }

  /**
   * 中止一个会话的回合：等代理收下这条消息（否则 cancel 落空），经指令通道 agent.cancel（连同它的子代理和这一轮起的命令），
   * 等回合停下。宽限期（AMB_STOP_GRACE_MS，默认 10 秒）内没停下、或指令通道不通，才关掉整个子进程
   * （同一机器人其它会话的回合也会失败）。
   */
  private async stopSession(turn: HostTurn, why: TurnStopped, run: Promise<unknown>): Promise<TurnStopped> {
    const graceMs = Number(process.env.AMB_STOP_GRACE_MS) > 0 ? Number(process.env.AMB_STOP_GRACE_MS) : 10_000;
    const deadline = Date.now() + graceMs;
    const left = () => Math.max(0, deadline - Date.now());
    const settled = run.then(
      () => true,
      () => true,
    );
    let ok = false;
    try {
      const accepted = await withTimeoutOr(Promise.race([turn.accepted.then(() => true), settled]), left(), false);
      if (await withTimeoutOr(settled, 0, false)) ok = true;
      else if (accepted && this.control.connected) {
        await this.control.send("cancel", { sessionId: turn.sessionId }, Math.max(1000, left()));
        ok = await withTimeoutOr(settled, left(), false);
      }
    } catch (e) {
      log.warn("cancelling the session's turn failed", { bot: this.o.botId, message: (e as Error).message.slice(0, 200) });
    }
    if (ok) return new TurnStopped(why.reason, why.ms, false);
    log.warn("agent turn did not stop in time; restarting dsh", { bot: this.o.botId, reason: why.reason, graceMs, otherTurns: this.active - 1 });
    await this.closeHarness();
    this.state = "stopped";
    return new TurnStopped(why.reason, why.ms, true);
  }

  /** 这个会话有回合在跑、还没在收尾或中止、指令通道在线：新消息可以并进这一轮 */
  canSteer(conversationId: string): boolean {
    const t = this.turns.get(conversationId);
    return !!t && !t.finishing && !t.stopping && this.control.connected;
  }

  /**
   * 把一条新消息并入这个会话正在进行的回合（agent.steer：模型在下一步看到它）。代理已经空闲或正在收尾时插件拒绝，
   * 返回 false，调用方照常排队。同一个 id 重发是幂等的（结果没收到时再问一次）。
   */
  async steer(conversationId: string, msg: { id: string; text: string; images?: TurnImage[] }): Promise<boolean> {
    const t = this.turns.get(conversationId);
    if (!t || !this.canSteer(conversationId)) return false;
    await withTimeoutOr(t.accepted, 5000, undefined);
    if (this.turns.get(conversationId) !== t || t.finishing || t.stopping) return false;
    const images = this.imageInput && acceptsImages(t.model) ? (msg.images ?? []) : [];
    for (let i = 0; i < 2 && this.control.connected; i++) {
      try {
        const r = await this.control.send<{ accepted?: boolean; reason?: string }>("steer", { sessionId: t.sessionId, messageId: msg.id, text: msg.text, images }, 15_000);
        if (!r.accepted) log.info("steer refused; the message waits for the next turn", { bot: this.o.botId, reason: r.reason });
        return !!r.accepted;
      } catch (e) {
        log.warn("steer failed", { bot: this.o.botId, attempt: i + 1, message: (e as Error).message.slice(0, 200) });
      }
    }
    return false;
  }

  private rememberFallback(model: string, api: AgentApi, reason: string): void {
    const fb = this.fallbacks.set(model, api, reason);
    log.warn("upstream rejected the agent's requests on this API; using Chat Completions for this model", {
      bot: this.o.botId,
      model,
      api,
      reason,
      until: new Date(fb.until).toISOString(),
    });
  }

  status(): Record<string, unknown> {
    const api = this.api ? (this.fallback ? `${this.api} (fallback: ${this.fallback.reason})` : this.api) : undefined;
    const models = [...new Set([...this.childRoutes.values()].map((r) => r.model))];
    return { state: this.state, pid: this.pid, model: this.model, api, models, control: this.control.connected, restarts: this.restarts, lastError: this.lastError, workspace: this.workspace, activeTurns: this.active };
  }

  /** 故障排查用的完整状态（含 stderr 尾部与最近一次退出） */
  diagnostics(): Record<string, unknown> {
    const rec = this.readInitRecord();
    return {
      ...this.status(),
      startingForMs: this.startingSince ? Date.now() - this.startingSince : undefined,
      initStage: this.initStage || undefined,
      initTimeoutMs: this.initTimeoutMs(),
      lastInitMs: this.lastInitMs || rec?.ms,
      firstStart: !rec,
      retryInMs: this.state === "error" ? Math.max(0, this.retryAfter - Date.now()) : undefined,
      startedAt: this.startedAt || undefined,
      lastExit: this.lastExit,
      // 这个子进程开过的任务、规则会话，和空闲时换过几次（见 RECYCLE_AFTER_SESSIONS）
      taskSessions: this.taskSessions.size,
      recycles: this.recycles,
      nextStartInMs: this.state === "backoff" ? Math.max(0, this.nextStartAt - Date.now()) : undefined,
      stderrTail: this.stderrTail.slice(-50),
    };
  }

  /** 清掉失败退避与暂停（故障排查时立即重试，不等退避时间） */
  resetBackoff(): void {
    this.nextStartAt = 0;
    this.retryAfter = 0;
    if (this.state === "error") this.state = "stopped";
  }

  /** 手动重启：关掉子进程、清掉退避与暂停，下一条消息（或 ensure）重新拉起。 */
  async restart(): Promise<void> {
    await this.starting?.catch(() => undefined);
    await this.closeHarness();
    this.failures = 0;
    this.initFailures = 0;
    this.retryAfter = 0;
    this.nextStartAt = 0;
    this.state = "stopped";
    log.info("dsh restarted by user", { bot: this.o.botId });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.starting?.catch(() => undefined);
    await this.closeHarness();
    this.state = "stopped";
  }
}
