import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { logger } from "../log.js";
import type { Store } from "../store/db.js";
import type { AgentBridge } from "./bridge.js";
import { adaptSkill, bundledRoots, detectComputerUse, mcpPatchLines, type CuStatus } from "./computer-use.js";
import { DEFAULT_SETTINGS, permissionMode, type BotSettings } from "./settings.js";

const log = logger("agent.host");

// ---------- @deepseek-ai/dsh-sdk-client 的最小本地类型（运行时动态加载，避免进入 app asar） ----------
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

/** 找到随应用分发的 DSH 运行时目录（含 node_modules/@deepseek-ai/dsh）。 */
export function locateDshRuntime(appRoot: string): string | undefined {
  const cands = [
    process.env.AMB_DSH_RUNTIME,
    (process as any).resourcesPath ? path.join((process as any).resourcesPath, "dsh") : undefined,
    path.join(appRoot, "dsh-runtime"),
  ].filter(Boolean) as string[];
  return cands.find((d) => fs.existsSync(path.join(d, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json")));
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

let sdkPromise: Promise<SdkModule> | undefined;
function loadSdk(runtimeDir: string): Promise<SdkModule> {
  sdkPromise ??= import(pathToFileURL(path.join(runtimeDir, "node_modules", "@deepseek-ai", "dsh-sdk-client", "lib", "index.js")).href) as Promise<SdkModule>;
  return sdkPromise;
}

/** 回合中的可见进度（工具调用等），由渠道批量发送。 */
export interface TurnObserver {
  onProgress?(text: string): void;
  onEvent?(type: string, data: any): void;
}

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
}

export type HostState = "stopped" | "starting" | "running" | "backoff" | "error";

const MODEL_LIMITS: Array<[RegExp, number, number]> = [
  [/grok-4/i, 256_000, 32_000],
  [/claude/i, 200_000, 32_000],
  [/gpt-5|gpt-4\.1/i, 400_000, 32_000],
  [/gemini/i, 1_000_000, 32_000],
  [/deepseek/i, 128_000, 32_000],
];

/** 模型的上下文窗口与最大输出（与写入 DSH 补丁的数值一致）。 */
export function modelLimits(model: string): { window: number; maxTokens: number } {
  const lim = MODEL_LIMITS.find(([re]) => re.test(model)) ?? [/./, 128_000, 16_000];
  return { window: lim[1], maxTokens: lim[2] };
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
  private harness: SdkHarness | undefined;
  private starting: Promise<SdkHarness> | undefined;
  private opened = new Set<string>();
  private active = 0;
  private failures = 0;
  private nextStartAt = 0;
  private stopped = false;
  /** callId → 工具调用（供审批提示展示命令） */
  readonly calls = new Map<string, { name: string; args: string; at: number }>();

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

  private writePatch(model: string): string {
    const lim = MODEL_LIMITS.find(([re]) => re.test(model)) ?? [/./, 128_000, 16_000];
    const plugin = path.join(this.o.runtimeDir, "plugins", "amb-bridge.mjs");
    const memory = path.join(this.o.runtimeDir, "plugins", "amb-memory.mjs");
    const text = [
      "# 由 anymodel bot 每次启动生成；请勿手改。",
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
      "      magpie:",
      "        displayName: anymodel",
      "        api: openai-completions",
      `        baseURL: ${yamlStr(this.o.bridge.url + "/v1")}`,
      "        apiKeyEnv: AMB_MAGPIE_KEY",
      "        models:",
      `          - id: ${yamlStr(model)}`,
      `            name: ${yamlStr(model.split("/").pop() || model)}`,
      `            contextWindow: ${lim[1]}`,
      `            maxTokens: ${lim[2]}`,
      "- insert:",
      "    - id: amb-bridge",
      `      name: ${yamlStr(plugin)}`,
      // 长期记忆工具（remember/forget/recall，经 bridge 由宿主读写）+ 上下文管家的原地压缩钩子
      // 已有会话也跟随机器人的权限预设（DSH 默认只对新会话生效）
      "    - id: amb-permission",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-permission.mjs"))}`,
      "    - id: amb-memory",
      `      name: ${yamlStr(memory)}`,
      // sdk 配置默认不带这两个工具：ask_user_question 走 user-questions → 插件 → 审批中心；
      // present 只声明交付文件，由宿主在回合结束后经渠道发送。
      "    - id: amb-tool-ask-user",
      "      name: '@deepseek-ai/dsh-tool-ask-user'",
      "    - id: amb-present",
      "      name: '@deepseek-ai/dsh-tool-present'",
      ...this.computerUseLines(),
      "",
    ].join("\n");
    const f = path.join(this.home, "amb.patch.yml");
    fs.writeFileSync(f, text, { mode: 0o600 });
    return f;
  }

  /** 当前机器上 Computer Use 的可用性（不看本机器人的开关）。 */
  computerUseStatus(): CuStatus {
    return detectComputerUse(bundledRoots(this.o.runtimeDir));
  }
  /** 本机器人实际是否启用 Computer Use：系统支持且设置里开着。 */
  private computerUseActive(): CuStatus | undefined {
    if (!this.settings().computerUse.enabled) return undefined;
    const st = this.computerUseStatus();
    return st.available ? st : undefined;
  }
  /**
   * Computer Use：插入 mcp-client（随附的 kimi-computer-use 桥，用宿主自己的 node/Electron 运行）
   * 与审批闸门；把改写过工具名的 SKILL.md 放进 DSH 主目录的用户技能目录。不可用时删掉这份技能。
   */
  private computerUseLines(): string[] {
    const skillDir = path.join(this.home, "skills", "computer-use");
    const st = this.computerUseActive();
    if (!st) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return [];
    }
    try {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), adaptSkill(fs.readFileSync(st.skill!, "utf8")));
    } catch (e) {
      log.warn("computer-use skill copy failed", { err: String(e) });
    }
    return [
      ...mcpPatchLines(st, process.execPath, yamlStr),
      "    - id: amb-computer-use-gate",
      `      name: ${yamlStr(path.join(this.o.runtimeDir, "plugins", "amb-computer-use-gate.mjs"))}`,
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
      AMB_MAGPIE_KEY: this.o.bridge.token,
      AMB_BRIDGE_URL: this.o.bridge.url,
      AMB_BRIDGE_TOKEN: this.o.bridge.token,
      AMB_BOT_ID: this.o.botId,
    };
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
    return `${st.permission}|${st.memory.enabled}|${st.computerUse.enabled}|${st.computerUse.approval}`;
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
      else if (process.platform === "darwin") cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
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
    if (this.harness && this.model !== model && this.active === 0) {
      log.info("model changed, restarting dsh", { bot: this.o.botId, model });
      await this.closeHarness();
    }
    if (this.harness && this.sig !== this.settingsSig() && this.active === 0) {
      log.info("bot settings changed, restarting dsh", { bot: this.o.botId });
      await this.closeHarness();
    }
    if (this.harness) return this.harness;
    this.starting ??= this.spawn(model).finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async spawn(model: string): Promise<SdkHarness> {
    const wait = this.nextStartAt - Date.now();
    if (wait > 0) {
      this.state = "backoff";
      await new Promise((r) => setTimeout(r, wait));
    }
    this.state = "starting";
    fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.workspace, { recursive: true });
    this.reapStale();
    await this.o.bridge.start();
    const sdk = await loadSdk(this.o.runtimeDir);
    const patch = this.writePatch(model);
    this.sig = this.settingsSig();
    const h = new sdk.DeepSeekHarness({
      profile: "sdk",
      patches: [patch],
      dshHome: this.home,
      env: this.env(),
      cwd: this.workspace,
      processCwd: this.workspace,
      provider: "magpie",
      model,
      initializeTimeoutMs: 90_000,
      shutdownTimeoutMs: 3000,
    });
    try {
      await h.start();
    } catch (e) {
      this.onFailure(e as Error);
      try {
        await h.close();
      } catch {
        /* ignore */
      }
      throw e;
    }
    const child = h.client?.child;
    if (child?.pid) fs.writeFileSync(this.pidFile, String(child.pid));
    child?.once?.("exit", (code: number | null, sig: string | null) => {
      if (this.harness !== h) return;
      this.harness = undefined;
      this.opened.clear();
      if (this.stopped) return;
      this.onFailure(new Error(`dsh exited (code=${code} signal=${sig})`));
    });
    this.harness = h;
    this.model = model;
    this.state = "running";
    this.lastError = "";
    log.info("dsh started", { bot: this.o.botId, pid: child?.pid, model });
    return h;
  }

  private onFailure(e: Error): void {
    this.failures++;
    this.restarts++;
    this.lastError = e.message.slice(0, 500);
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

  async runTurn(input: { conversationId: string; text: string; model: string; observer?: TurnObserver }): Promise<{ text: string; sessionId: string; files: string[]; usage: TurnUsage }> {
    const h = await this.ensure(input.model);
    const s = await this.sessionFor(h, input.conversationId);
    this.active++;
    let timer: NodeJS.Timeout | undefined;
    let turnError: string | undefined;
    const presented: string[] = [];
    const lim = modelLimits(input.model);
    const usage: TurnUsage = { tokens: 0, window: lim.window, maxTokens: lim.maxTokens };
    try {
      const timeoutMs = this.o.turnTimeoutMs ?? 30 * 60_000;
      const run = s.run(input.text, {
        onNotification: (n) => {
          if (process.env.AMB_DSH_TRACE) fs.appendFileSync(process.env.AMB_DSH_TRACE, JSON.stringify(n).slice(0, 2000) + "\n");
          if (n.method !== "session.event" || n.params?.sessionId !== s.id) return;
          const ev = n.params.event;
          const data = ev?.data ?? {};
          if (ev?.type === "tool/call") {
            this.calls.set(String(data.callId), { name: String(data.name), args: String(data.arguments ?? ""), at: Date.now() });
            if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!);
            if (data.name === "present") presented.push(...presentPaths(String(data.arguments ?? "")));
            input.observer?.onProgress?.(`🔧 ${summarizeCall(String(data.name), String(data.arguments ?? "")).split(this.workspace + "/").join("")}`);
          }
          if (ev?.type === "request/context" && Number(data?.contextWindow) > 0) usage.window = Number(data.contextWindow);
          if (ev?.type === "assistant/message" && data?.usage) {
            const u = data.usage;
            const t = Number(u.totalTokens) || (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0);
            if (t > 0) usage.tokens = t;
          }
          if (ev?.type === "turn/end" && data?.reason?.kind === "error") turnError = String(data.reason.error?.message ?? "unknown error");
          input.observer?.onEvent?.(String(ev?.type), data);
        },
      });
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("agent turn timed out")), timeoutMs);
      });
      const r = await Promise.race([run, timeout]);
      this.failures = 0;
      if (!r.finalResponse && turnError) throw new Error(turnError);
      return { text: r.finalResponse, sessionId: s.id, files: deliverables(this.workspace, presented), usage };
    } catch (e) {
      if (/timed out/.test((e as Error).message)) await this.closeHarness();
      throw e;
    } finally {
      clearTimeout(timer);
      this.active--;
    }
  }

  status(): Record<string, unknown> {
    return { state: this.state, pid: this.pid, model: this.model, restarts: this.restarts, lastError: this.lastError, workspace: this.workspace, activeTurns: this.active };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.starting?.catch(() => undefined);
    await this.closeHarness();
    this.state = "stopped";
  }
}
