import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { lineLogger, logger } from "../log.js";
import type { Store } from "../store/db.js";
import { BOT_HEADER, type AgentBridge, type Rejection } from "./bridge.js";
import { ApiFallbacks, shapeRejection, type ApiFallback } from "./api-fallback.js";
import os from "node:os";
import { findAppRoot } from "../magpie/supervisor.js";
import { adaptSkill, mcpPatchLines, resolveComputerUse, type CuResolved } from "./computer-use.js";
import { cuaConfig, cuaMcpEnv, discoverAppsCached, type CuaApp } from "./cua-driver.js";
import { pwshPatchLines, pwshProbe } from "./pwsh.js";
import { DEFAULT_SETTINGS, permissionMode, type BotSettings } from "./settings.js";
import { acceptsImages } from "../llm/client.js";

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
  /** DSH 会话事件（time 是事件自带的时间）；子代理的开始/结束以 subagent/started、subagent/finished 送来 */
  onEvent?(type: string, data: any, time?: number): void;
  /** 消息已经交给代理（之前是等进程、等会话） */
  onStart?(): void;
}

/**
 * 回合被中止：用户 /stop、长时间没有进展（idle）、超过单回合上限（timeout）。
 * SDK 没有中断单个回合的接口，只能关掉子进程；ms 是触发时的时长（idle、timeout 为阈值）。
 */
export class TurnStopped extends Error {
  constructor(
    readonly reason: "user" | "idle" | "timeout",
    readonly ms: number,
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
  | { type: "exit"; pid: number | undefined; code: number | null; signal: string | null };

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
 * 补丁里随接口变化的几行（provider 一级、模型一级）。
 * - Anthropic SDK 自己拼 /v1/messages，baseURL 是 bridge 根地址；另两个是 …/v1。
 * - Responses：store:false 下推理条目要带 encrypted_content 才能回放，而 DSH 只在指定了推理强度时才要它，
 *   所以推理模型（或不知道是不是）声明 low/medium/high、默认 medium；明确不推理的不发推理参数。
 *   系统提示用 system 角色（网关转给非 OpenAI 模型时不一定认 developer）；工具显式 strict:false。
 * - Anthropic、Chat 不声明推理（和以前一样，用模型默认）。
 */
export function apiPatchLines(api: AgentApi, bridgeUrl: string, reasoning?: boolean): { provider: string[]; model: string[] } {
  const provider = [`        api: ${api}`, `        baseURL: ${yamlStr(api === "anthropic-messages" ? bridgeUrl : bridgeUrl + "/v1")}`];
  if (api !== "openai-responses") return { provider, model: [] };
  const think = reasoning !== false;
  return {
    provider: [...provider, ...(think ? ["        reasoning: medium"] : [])],
    model: [
      ...(think ? ["            reasoningEfforts:", "              low: low", "              medium: medium", "              high: high"] : []),
      "            compat:",
      "              supportsDeveloperRole: false",
      "              supportsStrictMode: true",
    ],
  };
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
  /** 中止这个回合（reason 为 TurnStopped）：会关掉子进程，同一机器人其它进行中的回合也会失败 */
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

/**
 * 每个 bot 一个 DSH 子进程（懒启动）：DSH_HOME = <data>/dsh/<botId>，工作区 = <data>/workspaces/<botId>，
 * workspace-write 沙箱；模型请求经本地 bridge 代理到 magpie（子进程拿不到真实密钥）。
 * 每个会话一个 DSH session（id 存 sqlite，重启后 resume）。
 */
export class AgentHost {
  state: HostState = "stopped";
  lastError = "";
  restarts = 0;
  model = "";
  /** 当前子进程跟模型说话用的接口 */
  api: AgentApi | "" = "";
  /** 当前子进程因为回退才走 Chat Completions：回退记录（状态里显示原因） */
  fallback: ApiFallback | undefined;
  private ownFallbacks: ApiFallbacks | undefined;
  /** 当前子进程补丁里写的上下文窗口与最大输出 */
  private limits: { window: number; maxTokens: number } | undefined;
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
      log.info("dsh process exited", { bot: this.o.botId, pid, code, signal });
      this.emit({ type: "exit", pid, code, signal });
    });
  }

  private writePatch(model: string, apps: CuaApp[] = [], pwshPath?: string, lim = modelLimits(model), api: AgentApi = "openai-completions", reasoning?: boolean): string {
    this.limits = lim;
    const wire = apiPatchLines(api, this.o.bridge.url, reasoning);
    const plugin = path.join(this.o.runtimeDir, "plugins", "amb-bridge.mjs");
    const memory = path.join(this.o.runtimeDir, "plugins", "amb-memory.mjs");
    this.writeMediaSkill();
    const text = [
      "# 由 anymodel bot 每次启动生成；请勿手改。",
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
      "      magpie:",
      "        displayName: anymodel",
      // 接口按模型选（agentApi）：Responses / Anthropic Messages / Chat Completions
      ...wire.provider,
      "        apiKeyEnv: AMB_MAGPIE_KEY",
      // 标明是哪个机器人发的：bridge 据此把上游错误归到这个代理进程（不转给上游）
      "        headers:",
      `          ${BOT_HEADER}: ${yamlStr(this.o.botId)}`,
      "        models:",
      `          - id: ${yamlStr(model)}`,
      `            name: ${yamlStr(model.split("/").pop() || model)}`,
      `            contextWindow: ${lim.window}`,
      `            maxTokens: ${lim.maxTokens}`,
      // 默认只收文字；能看图的模型声明图片输入，用户发来的图片才会作为图片交给它
      ...(acceptsImages(model) ? ["            input: [text, image]"] : []),
      ...wire.model,
      // Windows：命令用检测到的 PowerShell 7（DSH 自己只看 Program Files\PowerShell\7 和 PATH，找不到就退回 5.1）
      ...pwshPatchLines(pwshPath),
      "- insert:",
      "    - id: amb-bridge",
      `      name: ${yamlStr(plugin)}`,
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

  /** 子进程环境：完全替换 process.env，只给必需项；真实模型密钥永不进入。 */
  private env(): Record<string, string> {
    const shim = this.writeBwrapShim();
    const basePath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
    const env: Record<string, string> = {
      PATH: shim ? `${shim}${path.delimiter}${basePath}` : basePath,
      AMB_DENY_READ: JSON.stringify([path.resolve(this.o.dataDir)]),
      AMB_ALLOW_READ: JSON.stringify([path.resolve(this.workspace), path.resolve(this.home)]),
      HOME: this.home,
      LANG: "C.UTF-8",
      TZ: process.env.TZ || "Asia/Shanghai",
      DSH_PERMISSION_MODE: permissionMode(this.settings().permission),
      AMB_MEMORY: this.settings().memory.enabled ? "1" : "0",
      AMB_CU_APPROVAL: this.settings().computerUse.approval,
      AMB_CU_READ_TOOLS: this.cuReadTools,
      AMB_MAGPIE_KEY: this.o.bridge.token,
      AMB_BRIDGE_URL: this.o.bridge.url,
      AMB_BRIDGE_TOKEN: this.o.bridge.token,
      AMB_BOT_ID: this.o.botId,
    };
    if (process.platform === "win32") {
      // Windows：系统目录类变量不是密钥，但工具进程离不开（npm/pip 找 APPDATA，脚本找 ProgramFiles、ComSpec…）。
      // libuv 只自动补 SystemRoot/TEMP/USERPROFILE 等少数几个。TZ 只认 POSIX 写法，不设，用系统时区。
      for (const k of WIN_SYSTEM_ENV) {
        const v = process.env[k];
        if (v) env[k] = v;
      }
      if (!process.env.TZ) delete env.TZ;
    }
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    if (process.env.AMB_DSH_LOG_LEVEL) env.DSH_LOG_LEVEL = process.env.AMB_DSH_LOG_LEVEL;
    return env;
  }

  private settings(): BotSettings {
    return this.o.settings?.() ?? DEFAULT_SETTINGS;
  }
  /** 影响子进程启动参数的设置签名 */
  private settingsSig(): string {
    const st = this.settings();
    // 带上 PowerShell 路径：用户装好 PowerShell 7 点"重新检测"后，空闲的代理进程在下一条消息时换用它
    return `${st.permission}|${st.memory.enabled}|${st.computerUse.enabled}|${st.computerUse.backend}|${st.computerUse.approval}|${pwshProbe.cachedDshPath ?? ""}`;
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

  async ensure(model: string): Promise<SdkHarness> {
    if (this.stopped) throw new Error("agent host stopped");
    // 连续启动失败后不再每条消息都重试一遍（每次都要等满初始化超时）：直到手动重启或冷却结束
    if (!this.harness && !this.starting && this.state === "error" && Date.now() < this.retryAfter) {
      throw new Error(`代理进程启动失败，${Math.ceil((this.retryAfter - Date.now()) / 60_000)} 分钟后再试（或在 设置 → 故障排查 里重启代理进程）：${this.lastError}`);
    }
    if (this.harness && this.model !== model && this.active === 0) {
      log.info("model changed, restarting dsh", { bot: this.o.botId, model });
      await this.closeHarness();
    }
    if (this.harness && this.api && this.api !== "openai-completions" && this.fallbacks.get(this.model) && this.active === 0) {
      log.info("model was rejected on its API before, restarting dsh on Chat Completions", { bot: this.o.botId, model: this.model, api: this.api });
      await this.closeHarness();
    }
    if (this.harness && this.sig !== this.settingsSig() && this.active === 0) {
      log.info("bot settings or PowerShell changed, restarting dsh", { bot: this.o.botId });
      await this.closeHarness();
    }
    if (this.harness) return this.harness;
    this.starting ??= this.spawn(model).finally(() => (this.starting = undefined));
    return this.starting;
  }

  /**
   * 设置或 PowerShell 变了（比如内置 PowerShell 7 刚装好、或者坏了退回）而且空闲：在后台重启子进程，
   * 下一条消息不用再等启动。正在跑的回合不打断，等下一条消息时由 ensure() 换。
   */
  async restartIfStale(): Promise<void> {
    if (!this.harness || this.starting || this.active > 0 || this.entering > 0 || this.stopped || this.sig === this.settingsSig()) return;
    const model = this.model;
    log.info("bot settings or PowerShell changed while idle, restarting dsh in the background", { bot: this.o.botId });
    await this.closeHarness();
    this.state = "stopped";
    await this.ensure(model).catch(() => undefined);
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
      const ask = <T>(p: Promise<T | undefined> | undefined) => withTimeoutOr(p ?? Promise.resolve(undefined), 3000, undefined).catch(() => undefined);
      const [known, info] = await Promise.all([ask(this.o.contextWindow?.(model)), ask(this.o.apiInfo?.(model))]);
      const chosen = agentApi(info?.endpoints);
      // 这个模型在该接口上被拒过（24 小时内）：直接走 Chat Completions
      const fb = chosen !== "openai-completions" ? this.fallbacks.get(model) : undefined;
      const api: AgentApi = fb ? "openai-completions" : chosen;
      this.fallback = fb;
      const patch = this.writePatch(model, apps, pwshPath, modelLimits(model, known), api, info?.reasoning);
      this.pwshPath = pwshPath;
      this.sig = this.settingsSig();
      const timeoutMs = this.initTimeoutMs();
      this.stage("patch written", t0, { api, computerUse: cu ? cu.backend : "off", apps: apps.length, initTimeoutMs: timeoutMs, ...(process.platform === "win32" ? { pwsh: pwshPath ?? "dsh default (Windows PowerShell 5.1)" } : {}) });
      h = new sdk.DeepSeekHarness({
        profile: "sdk",
        patches: [patch],
        dshHome: this.home,
        env: this.env(),
        cwd: this.workspace,
        processCwd: this.workspace,
        provider: "magpie",
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
      child?.once?.("exit", (code: number | null, sig: string | null) => {
        if (this.harness !== harness) return;
        this.harness = undefined;
        this.opened.clear();
        if (this.stopped) return;
        this.onFailure(new Error(`dsh exited (code=${code} signal=${sig})`));
      });
      this.harness = h;
      this.model = model;
      this.api = api;
      this.state = "running";
      this.initStage = "";
      this.lastError = "";
      this.initFailures = 0;
      this.startedAt = Date.now();
      log.info("dsh started", { bot: this.o.botId, pid: child?.pid, model, api, ms: Date.now() - t0, initMs });
      return h;
    } catch (e) {
      clearInterval(watchdog);
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
      this.o.onNotice?.(`代理进程连续两次启动失败，已暂停 10 分钟（期间用纯对话回复）。可在 设置 → 故障排查 查看原因并重启代理进程。原因：${this.lastError.slice(0, 200)}`);
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5));
    this.nextStartAt = Date.now() + delay;
    this.state = "backoff";
    log.warn("dsh failure, will restart on demand", { bot: this.o.botId, delayMs: delay, message: this.lastError });
  }

  private async closeHarness(): Promise<void> {
    const h = this.harness;
    this.harness = undefined;
    this.opened.clear();
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
   * 记下这个模型改走 Chat Completions；这一轮还没调用过工具的话，把代理进程换到 Chat 上重做一遍（只重做一次）。
   */
  async runTurn(input: TurnInput): Promise<{ text: string; sessionId: string; files: string[]; usage: TurnUsage }> {
    try {
      return await this.runOnce(input);
    } catch (e) {
      if (!(e instanceof ApiRejected) || !e.retryable || input.signal?.aborted) throw e;
      log.warn("agent turn rejected on its API; retrying it once over Chat Completions", { bot: this.o.botId, model: input.model, api: e.api, reason: e.reason });
      input.observer?.onEvent?.("api/fallback", { from: e.api, to: "openai-completions", reason: e.reason }, Date.now());
      // ensure() 看到回退记录，空闲时把子进程换到 Chat 上。用户这条消息（连同图片）在被拒之前已经存进会话，
      // 不再发一遍，只请模型处理它
      return await this.runOnce({ ...input, text: RETRY_NOTE, images: undefined });
    }
  }

  private async runOnce(input: TurnInput): Promise<{ text: string; sessionId: string; files: string[]; usage: TurnUsage }> {
    this.entering++;
    try {
      return await this.runEntered(input);
    } finally {
      this.entering--;
      // 回合中 PowerShell 换了（比如刚发现它起不来）：回合结束、空闲了就在后台换上
      if (this.entering === 0) void this.restartIfStale();
    }
  }

  private async runEntered(input: TurnInput): Promise<{ text: string; sessionId: string; files: string[]; usage: TurnUsage }> {
    const h = await this.ensure(input.model);
    const s = await this.sessionFor(h, input.conversationId);
    // 在等进程 / 会话时就被中止了：消息还没交出去，不用重启子进程
    if (input.signal?.aborted) throw input.signal.reason instanceof TurnStopped ? input.signal.reason : new TurnStopped("user", 0);
    this.active++;
    let timer: NodeJS.Timeout | undefined;
    let turnError: string | undefined;
    const presented: string[] = [];
    const lim = input.model === this.model && this.limits ? this.limits : modelLimits(input.model);
    const usage: TurnUsage = { tokens: 0, window: lim.window, maxTokens: lim.maxTokens };
    const images = this.imageInput ? (input.images ?? []) : [];
    let unlisten = () => {};
    // 这一轮：用的接口、调用过几次工具、上游拒绝过本机器人的哪些模型请求
    const api = this.api || "openai-completions";
    let toolCalls = 0;
    const rejections: Rejection[] = [];
    const offRejection =
      this.o.bridge.onRejection?.((r) => {
        if (r.bot === this.o.botId && /\/v1\/(responses|messages)$/.test(r.path)) rejections.push(r);
      }) ?? (() => {});
    try {
      const timeoutMs = this.o.turnTimeoutMs ?? 30 * 60_000;
      const prompt = images.length ? [{ type: "text", text: input.text }, ...images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }))] : input.text;
      input.observer?.onStart?.();
      const run = s.run(prompt, {
        onNotification: (n) => {
          if (process.env.AMB_DSH_TRACE) fs.appendFileSync(process.env.AMB_DSH_TRACE, JSON.stringify(n).slice(0, 2000) + "\n");
          if (n.method === "subagent.started" || n.method === "subagent.finished") return input.observer?.onEvent?.(n.method.replace(".", "/"), n.params, Date.now());
          if (n.method !== "session.event" || n.params?.sessionId !== s.id) return;
          const ev = n.params.event;
          const data = ev?.data ?? {};
          if (ev?.type === "tool/call") {
            toolCalls++;
            this.calls.set(String(data.callId), { name: String(data.name), args: String(data.arguments ?? ""), at: Date.now() });
            if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!);
            if (data.name === "present") presented.push(...presentPaths(String(data.arguments ?? "")));
            input.observer?.onProgress?.(`🔧 ${summarizeCall(String(data.name), String(data.arguments ?? "")).split(this.workspace + "/").join("")}`);
          }
          if (ev?.type === "tool/result") {
            // Windows：PowerShell 本身拉不起来（被杀毒软件删了、被策略拦了…）时退回下一个，不让代理一直用一个起不来的 shell（其他平台上探测器不管）
            const msg = data?.message ?? {};
            const call = this.calls.get(String(msg.toolCallId ?? ""));
            if (call && /^(pwsh|powershell)$/i.test(call.name)) pwshProbe.observeToolResult(this.pwshPath, contentText(msg.content));
          }
          if (ev?.type === "request/context" && Number(data?.contextWindow) > 0) usage.window = Number(data.contextWindow);
          if (ev?.type === "assistant/message" && data?.usage) {
            const u = data.usage;
            const t = Number(u.totalTokens) || (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0);
            if (t > 0) usage.tokens = t;
          }
          if (ev?.type === "turn/end" && data?.reason?.kind === "error") turnError = String(data.reason.error?.message ?? "unknown error");
          input.observer?.onEvent?.(String(ev?.type), data, Number(ev?.time) || Date.now());
        },
      });
      // 中止后子进程被关掉，run 随后以"runtime closed"失败，已经没人等它
      run.catch(() => undefined);
      const stopped = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new TurnStopped("timeout", timeoutMs)), timeoutMs);
        const sig = input.signal;
        if (!sig) return;
        const onAbort = () => rej(sig.reason instanceof TurnStopped ? sig.reason : new TurnStopped("user", 0));
        if (sig.aborted) return onAbort();
        sig.addEventListener("abort", onAbort, { once: true });
        unlisten = () => sig.removeEventListener("abort", onAbort);
      });
      const r = await Promise.race([run, stopped]);
      this.failures = 0;
      const rejected = turnError !== undefined && api !== "openai-completions" ? shapeRejection(rejections, turnError) : undefined;
      if (rejected) this.rememberFallback(input.model, api, rejected);
      if (!r.finalResponse && turnError) {
        // 已经调用过工具（命令可能已经执行）就不重做，照常报错；下一轮起走 Chat
        if (rejected) throw new ApiRejected(turnError, api, rejected, toolCalls === 0 && presented.length === 0 && this.active === 1);
        throw new Error(turnError);
      }
      return { text: r.finalResponse, sessionId: s.id, files: deliverables(this.workspace, presented), usage };
    } catch (e) {
      if (e instanceof TurnStopped) {
        log.warn("agent turn stopped, restarting dsh", { bot: this.o.botId, reason: e.reason, ms: e.ms, otherTurns: this.active - 1 });
        await this.closeHarness();
        this.state = "stopped";
      } else if (images.length && this.state !== "running") {
        this.imageInput = false;
        log.warn("dsh died on a turn with images; sending images by path only until the app restarts", { bot: this.o.botId, message: (e as Error).message.slice(0, 200) });
      }
      throw e;
    } finally {
      clearTimeout(timer);
      unlisten();
      offRejection();
      this.active--;
    }
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
    return { state: this.state, pid: this.pid, model: this.model, api, restarts: this.restarts, lastError: this.lastError, workspace: this.workspace, activeTurns: this.active };
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

/** Cua Driver 后端的技能说明（由 anymodel bot 编写；工具来自 trycua/cua 的 cua-driver，MIT）。 */
const CUA_SKILL = `---
name: computer-use
description: Operate native desktop apps on this computer (read windows, click, type, press keys, scroll, drag) through the bundled Cua Driver. Use when the user asks you to do something in a GUI application on their computer.
---

# Computer Use (Cua Driver)

Tools are named \`mcp__computer-use__<tool>\`. Actions run automatically; no approval is needed unless this bot is set to ask before input actions (then wait for the user's answer).

## Loop
1. Find the target: \`list_windows\` (or \`list_apps\`), or start one with \`launch_app\`.
2. Read it narrowly: \`get_window_state({pid, window_id, query:"<what you need>"})\`. Rows look like \`[N] role "label"\`; the element token for row N is \`<snapshot_id>:N\` (e.g. "s0000002a:11"), never a bare number.
3. Act with the token on the same window: \`click\`, \`type_text\`, \`set_value\`, \`press_key\`, \`hotkey\`, \`scroll\`, \`drag\`, \`invoke_menu\`. Prefer \`run_steps({steps:[{tool,args},...], observe:{}})\` to act and see what changed in one call.
4. Verify at checkpoints with \`verify_state\` or a targeted \`get_window_state\` (use \`since:"latest"\` for just the changes). Use pixel coordinates only for surfaces missing from the accessibility tree, from a fresh screenshot of the same window.

## Rules
- Screenshots are for you to look at. Do not send them to the user unless they ask; if they do, save the image into the workspace and present that file.
- Only apps installed on this computer are in scope; if a call says the app or resource is outside the capability manifest, tell the user instead of looking for a workaround.
- Do not type passwords, payment details or other secrets unless the user explicitly gave them for this task. Do not confirm purchases, deletions or messages to other people without the user asking for exactly that.
- On Linux, reading window contents needs AT-SPI; on Wayland only the foreground window can be driven. On macOS the app needs Accessibility and Screen Recording permission; if \`check_permissions\` reports them missing, tell the user how to grant them.
`;


/** 生图 / 生视频的技能说明（由 anymodel bot 编写；不含 Key、不让代理自己调接口，参数格式以 Modelflare 文档为准）。 */
const MEDIA_SKILL = `---
name: media
description: Generate or edit images and generate videos with Modelflare image and video models through the media_models, media_docs, generate_image and generate_video tools. Use when the user asks to draw, create, edit or restyle a picture, animate an image, or make a video.
---

# Images and videos (Modelflare)

You have no Modelflare key and must not call the API yourself (no curl, no scripts): the tools call it with this bot's key. Every generation costs the user money, so the user confirms the model before anything is generated.

## Steps
1. \`media_models\` (kind \`image\` or \`video\`) lists the models this bot may use, the default one, their parameter ranges and reference prices. Use the default unless the user named a model or the request needs something the default cannot do (a reference image, a ratio or length it does not support).
2. Plain text-to-image or text-to-video with default settings: call \`generate_image\` / \`generate_video\` with a detailed \`prompt\` only.
3. Anything else (ratio, resolution, size, length, quality, audio, reference images, first/last frames, editing an image): call \`media_docs\` for the chosen model, then pass \`body\` in exactly the format its page shows, without \`model\`. Every family is different (for example Seedance uses \`content[]\`, Kling \`contents\` and \`settings\`, Wan \`input\` and \`parameters\`, Gemini \`contents[].parts[]\` with \`generationConfig\`), so never reuse field names from another model's page. For OpenAI Images models whose page sends references to \`/v1/images/edits\`, also pass \`endpoint: "edits"\`. Keep \`prompt\` the same as the prompt inside \`body\`: the user sees \`prompt\` in the confirmation.
4. Reference media: a file in the workspace is written as \`"workspace:media/x.png"\` (sent as a data URL) or \`"workspace-base64:media/x.png"\` (raw Base64, e.g. Gemini \`inline_data.data\`), up to 20 MB each. A public https URL can be used as is. Models marked 必须带参考素材 (image-to-video, reference-to-video) only work with references; many models accept reference videos only as public URLs, see the docs. Images and files the user sends in chat are saved in the workspace under \`inbox/\`, and the message shows where (for example \`[图片 inbox/20261031-143012-ab12cd.jpg]\`), so write such an image as \`"workspace:inbox/20261031-143012-ab12cd.jpg"\`. If you have no file or link for a reference, ask the user for one.
5. The tool result says what happened:
   - Generated: the file is under \`media/\`; deliver it with \`present\`.
   - The user picked another model while you had passed a \`body\`: read that model's page with \`media_docs\`, rewrite \`body\` for it and call again with \`model\` set to it. That call is not confirmed again.
   - The user answered something else: adjust as they said and call again (they will be asked again).
   - Cancelled or not confirmed in time: nothing was generated or charged; do not retry on your own.
6. Videos take minutes and cost much more than images: only make a video when the user asks for one, and do not generate extra variants unless asked.

## Errors
- 这把 Key 不能用这个模型 (model_not_found): this account cannot use that model; pick another one from \`media_models\`.
- Any other 4xx names the problem: fix the body according to the model's page instead of sending the same request again. If the balance is empty, tell the user to top up on Modelflare.
`;
