/**
 * Windows 上代理用哪个 PowerShell。
 *
 * 代理（DSH）在 Windows 上用 PowerShell 执行命令（@deepseek-ai/dsh-pwsh-sandbox，经 Windows ACL 沙箱）。经沙箱时
 * Windows PowerShell 5.1 每条命令要二三十秒，PowerShell 7 大约 1 秒。DSH 自己按 %ProgramFiles%\PowerShell\7\pwsh.exe → PATH 里的
 * pwsh.exe → 5.1 的顺序找（dsh-pwsh-local 的 resolvePwshPath）；这里选好一个写进 DSH 补丁（pwsh-sandbox 的 pwshPath）：
 *
 * 1. 系统里能用的 PowerShell 7（用户自己装的，什么都不下载）：先按 DSH 的顺序找文件，再补上 DSH 不看的位置（7-preview 等其他 7*
 *    目录、Microsoft Store / winget 的 WindowsApps 别名）。找到后在后台按 DSH 的方式试运行一次，没通过就不用它。
 * 2. 应用内置的 PowerShell 7（pwsh-private.ts）：没有 1 时在后台自动下载安装，试运行通过才用。
 * 3. 都没有：Windows PowerShell 5.1（和以前一样）。系统里有被排除的 pwsh 时明确写 5.1 的路径，免得 DSH 自己又找回它。
 *
 * - 运行中代理拉不起所用的 pwsh（宿主把 pwsh 工具的结果转过来，observeToolResult）就把它标记为坏，退回下一个，空闲时重启 DSH，并告诉用户。
 * - 选择变了（装好了、坏了、改回系统默认）就通知订阅者：宿主的设置签名里带着路径，空闲的代理进程换用新的。
 * - 版本号：先读 pwsh.deps.json，读不到（Store 别名）再 `pwsh -Version`（20 秒超时）；试运行也会报版本。
 * - AMB_PWSH_FORCE=missing 在任何平台上模拟"未安装"（截图、测试；installing / installed / broken / failed 模拟内置副本的几种状态），
 *   不影响 DSH；AMB_PWSH_IGNORE_SYSTEM=1 不用系统里的 PowerShell
 *   （CI 用它验证内置副本）；AMB_PWSH_AUTO_INSTALL=0 不自动安装。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../log.js";
import {
  PrivatePwsh,
  depsJsonVersion,
  launchTest,
  runProcess,
  windowsPowerShell,
  type InstallProgress,
  type InstallState,
  type LaunchTest,
  type PrivatePwshStatus,
  type Runner,
} from "./pwsh-private.js";

const log = logger("pwsh");
const W = path.win32;

export const PWSH_INSTALL_URL = "https://aka.ms/PSWindows";
export const PWSH_WINGET = "winget install --id Microsoft.PowerShell --source winget";

/** program-files：%ProgramFiles%\PowerShell\7（MSI、winget）；preview：7-preview 等；store：WindowsApps 别名；path：PATH 里的其他位置；private：应用内置 */
export type PwshSource = "program-files" | "path" | "preview" | "store" | "private";
/** auto：系统里没有能用的 7 时用应用内置的（自动安装）；system：改回系统默认，不用内置的 */
export type PwshMode = "auto" | "system";

export interface PwshCandidate {
  path: string;
  source: PwshSource;
}

export interface PwshStatus {
  /** 只在 Windows 上检测（或 AMB_PWSH_FORCE 模拟）；其他平台代理用 bash */
  applicable: boolean;
  /** 第一次检测还没完成 */
  checking?: boolean;
  /** 找到了 pwsh.exe（系统里的，或内置的已就绪） */
  found: boolean;
  /** 没有能用的 PowerShell 7：代理会退回 Windows PowerShell 5.1 */
  missing: boolean;
  path?: string;
  source?: PwshSource;
  /** 例如 7.4.6；读不到时为空 */
  version?: string;
  /** AMB_PWSH_FORCE=missing 模拟的结果 */
  forced?: boolean;
  checkedAt: number;
  /** 写进 DSH 补丁的路径；空 = 交给 DSH 自己找 */
  using?: string;
  /** 应用内置的 PowerShell 7 */
  private?: PrivatePwshStatus;
  mode?: PwshMode;
  /** 是否会自动安装内置副本（AMB_PWSH_AUTO_INSTALL=0 关掉；代理模式关着时也不装） */
  autoInstall?: boolean;
  /** AMB_PWSH_IGNORE_SYSTEM=1 */
  ignoreSystem?: boolean;
  /** 系统里找到的 PowerShell 7 用不了的原因（试运行没过、代理拉不起它） */
  systemIssue?: string;
  /** 最近一次自动退回：哪个 pwsh 出了问题、原因、改用了什么 */
  fallback?: { from: string; reason: string; to?: string; at: number };
}

/** 选择变了（path）、内置副本装好或没装上（install）；notice 是要告诉用户的话 */
export interface PwshEvent {
  kind: "path" | "install";
  from?: string;
  to?: string;
  notice?: { level: "info" | "warn"; text: string };
}

/** 可替换的环境、文件系统与子进程（测试用） */
export interface PwshDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  lstat?: (p: string) => Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  readdir?: (p: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
  /** `pwsh -Version` 的输出（读版本号的最后手段） */
  runVersion?: (exe: string) => Promise<string>;
  /** 试运行用 */
  run?: Runner;
  /** 内置副本 */
  priv?: PrivatePwsh;
}

const dirKey = (p: string) => W.normalize(p).replace(/\\+$/, "").toLowerCase();

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? env.Path ?? "")
    .split(";")
    .map((e) => e.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** 按优先级排好的候选位置：前两类和 DSH 的顺序一致，后两类是 DSH 自己不看的 */
export async function pwshCandidates(d: PwshDeps = {}): Promise<PwshCandidate[]> {
  const env = d.env ?? process.env;
  const readdir = d.readdir ?? ((p: string) => fs.promises.readdir(p));
  const roots = [...new Set([env.ProgramFiles || "C:\\Program Files", env.ProgramW6432].filter((r): r is string => !!r).map((r) => W.join(r, "PowerShell")))];
  const store = env.LOCALAPPDATA ? W.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps") : "";
  const list: PwshCandidate[] = [{ path: W.join(roots[0], "7", "pwsh.exe"), source: "program-files" }];
  for (const dir of pathEntries(env)) list.push({ path: W.join(dir, "pwsh.exe"), source: store && dirKey(dir) === dirKey(store) ? "store" : "path" });
  for (const root of roots) {
    const names = (await readdir(root).catch(() => [] as string[])).filter((n) => /^7/.test(n));
    names.sort((a, b) => Number(/preview/i.test(a)) - Number(/preview/i.test(b)) || a.localeCompare(b));
    for (const n of names) list.push({ path: W.join(root, n, "pwsh.exe"), source: /preview/i.test(n) ? "preview" : "program-files" });
  }
  if (store) list.push({ path: W.join(store, "pwsh.exe"), source: "store" });
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(dirKey(c.path)) && !!seen.add(dirKey(c.path)));
}

/**
 * 第一个存在的 pwsh.exe。和 DSH 一样用 lstat：Store 的应用执行别名是重解析点，stat 会撞上目标的 ACL（EACCES），
 * lstat 看到的是别名本身（新版 Node 报成符号链接，旧版报成文件）。
 */
export async function findPwsh(d: PwshDeps = {}): Promise<PwshCandidate | undefined> {
  const lstat = d.lstat ?? ((p: string) => fs.promises.lstat(p));
  const list = await pwshCandidates(d);
  const hits = await Promise.all(list.map((c) => lstat(c.path).then((s) => s.isFile() || s.isSymbolicLink(), () => false)));
  const i = hits.indexOf(true);
  return i >= 0 ? list[i] : undefined;
}

export function parsePwshVersion(text: string): string | undefined {
  return /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(text)?.[1];
}

/** 冷启动的机器上 pwsh 第一次启动可能要十几秒（CI 上 5 秒超时出过错） */
function runVersion(exe: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(exe, ["-Version"], { windowsHide: true, timeout: 20_000, encoding: "utf8", maxBuffer: 64 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))),
  );
}

/** 版本号：MSI / zip 安装目录里的 pwsh.deps.json 有 "pwsh/7.4.6"（新版 "pwsh/7.6.9.500"），不用拉起进程；Store 别名旁边没有，再问 pwsh 自己 */
export async function readPwshVersion(c: PwshCandidate, d: PwshDeps = {}): Promise<string | undefined> {
  const readFile = d.readFile ?? ((p: string) => fs.promises.readFile(p, "utf8"));
  try {
    const v = depsJsonVersion(await readFile(W.join(W.dirname(c.path), "pwsh.deps.json")));
    if (v) return v;
  } catch {
    /* 没有这个文件 */
  }
  try {
    return parsePwshVersion(await (d.runVersion ?? runVersion)(c.path));
  } catch (e) {
    log.warn("could not read the PowerShell version", { path: c.path, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return undefined;
  }
}

const norm = (s: string) => s.replace(/\\\\/g, "\\").replace(/\//g, "\\").toLowerCase();
/** 沙箱 runner 的 CreateProcess 失败码里，说明"这个程序本身起不来"的：找不到文件 / 路径、拒绝访问、不是有效程序、不兼容、病毒、策略拦截、文件损坏、WDAC */
const EXE_WIN32_CODES = new Set([2, 3, 5, 193, 216, 225, 1260, 1392, 4551]);

/**
 * pwsh 工具的结果说明 PowerShell 本身没拉起来（强信号，立即退回）：返回出错的那一行，否则 undefined。
 * - 沙箱（工作区可写 / 只读）：windows-acl-run: CreateProcessAsUserW failed (Win32 2): command: <exe>, cwd: …
 * - 不经沙箱（完全权限）：subprocess failed before reporting an outcome: Error: spawn <exe> ENOENT
 * 都带着 exe 的完整路径；别的命令失败（退出码非 0、命令写错）不算。
 */
export function shellStartFailure(text: string, exe: string): string | undefined {
  const want = norm(exe);
  if (!text || !norm(text).includes(want)) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const l = norm(line);
    if (!l.includes(want)) continue;
    // DSH 把整段沙箱错误写在一行里（几百个字），返回从 runner / spawn 的那句开始的部分
    const from = (i: number) => line.slice(Math.max(0, i)).trim().slice(0, 300);
    const acl = /windows-acl-run:.*createprocess\w*\s+failed\s+\(win32\s+(\d+)\)/.exec(l);
    if (acl && EXE_WIN32_CODES.has(Number(acl[1]))) return from(acl.index);
    const spawn = /failed before reporting an outcome|\bspawn\s.*\b(enoent|eacces|eperm|unknown|einval)\b/.exec(l);
    if (spawn) return from(spawn.index);
  }
  return undefined;
}

/** 拉不起来的原因，说给用户听：Win32 错误码 / Node 的 spawn 错误码 → 一句话 */
export function startFailureReason(line: string): string {
  const code = /\(win32\s+(\d+)\)/i.exec(line)?.[1] ?? /\b(ENOENT|EACCES|EPERM|UNKNOWN|EINVAL)\b/i.exec(line)?.[1]?.toUpperCase();
  const missing = "找不到 pwsh.exe（可能被杀毒软件删除或隔离）";
  const denied = "没有权限运行它（可能被安全软件拦截）";
  const why: Record<string, string> = {
    "2": missing,
    "3": missing,
    ENOENT: missing,
    "5": denied,
    EACCES: denied,
    EPERM: denied,
    "225": "被杀毒软件拦截",
    "1260": "被系统策略禁止运行（AppLocker / 软件限制策略）",
    "4551": "被 Windows Defender 应用程序控制拦截",
    "193": "文件损坏，或不是这台电脑能运行的程序",
    "216": "文件损坏，或不是这台电脑能运行的程序",
    "1392": "文件已损坏",
  };
  return `${(code && why[code]) || "拉不起来"}（${code ? (/^\d+$/.test(code) ? `Win32 ${code}` : code) : line.slice(0, 120)}）`;
}

/** 弱信号：.NET 宿主起不来、沙箱 runner 拉它时出了别的错。重新试运行一次，没通过才退回 */
const SUSPECT = /hostfxr|hostpolicy|coreclr\.dll|A fatal error (was encountered|occurred)|The application to execute does not exist|Could not load file or assembly 'System\.Management\.Automation|windows-acl-run:.*CreateProcess/i;

const INSTALLING: InstallState[] = ["waiting", "downloading", "extracting", "verifying", "testing"];
export const isInstalling = (p?: InstallProgress) => !!p && INSTALLING.includes(p.state);

export class PwshProbe {
  readonly priv: PrivatePwsh;
  private run?: Promise<PwshStatus>;
  private locating?: Promise<unknown>;
  /** 系统里找到的候选（找完才有；版本稍后补上） */
  private sys?: { c?: PwshCandidate; version?: string };
  private checkedAt = 0;
  private legacyExists = false;
  /** 系统 pwsh 的试运行结果（按路径） */
  private sysTests = new Map<string, LaunchTest | "pending">();
  /** 代理拉不起来的系统 pwsh（本次运行内） */
  private sysBad = new Map<string, { reason: string; at: number }>();
  private fallback?: PwshStatus["fallback"];
  private cfg: { agent: boolean; mode: PwshMode; fetch?: () => typeof fetch | undefined } = { agent: false, mode: "auto" };
  private listeners = new Set<(e: PwshEvent) => void>();
  private lastPath: string | undefined | null = null;
  private lastInstall: InstallState = "idle";
  private suspected = new Map<string, number>();
  /** markBroken 里标记内置副本时先不通知，标记完一次性带上提示 */
  private quiet = false;

  constructor(private readonly d: PwshDeps = {}) {
    this.priv = d.priv ?? new PrivatePwsh({ env: d.env, platform: d.platform, run: d.run, fetch: () => this.cfg.fetch?.() });
    this.priv.onChange(() => this.onPrivateChange());
  }

  private get env(): NodeJS.ProcessEnv {
    return this.d.env ?? process.env;
  }
  private get platform(): NodeJS.Platform {
    return this.d.platform ?? process.platform;
  }
  private get forced(): boolean {
    return FORCE_DEMO.includes(this.env.AMB_PWSH_FORCE ?? "");
  }
  private get ignoreSystem(): boolean {
    return this.env.AMB_PWSH_IGNORE_SYSTEM === "1";
  }
  get applicable(): boolean {
    return this.platform === "win32" || this.forced;
  }
  /** 真的要选 pwsh（Windows、不是模拟） */
  private get active(): boolean {
    return this.platform === "win32" && !this.forced;
  }
  get mode(): PwshMode {
    return this.cfg.mode;
  }

  /** 应用启动时：代理模式开没开（关着不自动装）、用户的选择、下载用的 fetch（桌面版走系统代理） */
  configure(o: { agent?: boolean; mode?: PwshMode; fetch?: () => typeof fetch | undefined }): void {
    if (o.agent !== undefined) this.cfg.agent = o.agent;
    if (o.mode !== undefined) this.cfg.mode = o.mode;
    if (o.fetch !== undefined) this.cfg.fetch = o.fetch;
    this.update();
    this.maybeAutoInstall("configure");
  }

  onChange(fn: (e: PwshEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: PwshEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        log.warn("PowerShell listener failed", { err: String(err) });
      }
    }
  }

  /** 检测（结果缓存）；refresh = 重新检测：重新找、重新试运行，清掉"坏了"的标记 */
  check(refresh = false): Promise<PwshStatus> {
    if (this.run && !refresh) return this.run;
    if (!this.active) {
      this.checkedAt = Date.now();
      return (this.run = Promise.resolve(this.compose()));
    }
    if (refresh) {
      this.sysTests.clear();
      this.sysBad.clear();
      this.suspected.clear();
      this.fallback = undefined;
    }
    const t0 = Date.now();
    const lstat = this.d.lstat ?? ((p: string) => fs.promises.lstat(p));
    const locating = (this.ignoreSystem ? Promise.resolve(undefined) : findPwsh(this.d))
      .catch((e) => {
        log.warn("PowerShell detection failed", { err: String((e as Error)?.message ?? e) });
        return undefined;
      })
      .then(async (c) => {
        this.legacyExists = await lstat(windowsPowerShell(this.env)).then((s) => s.isFile(), () => false);
        if (this.locating === locating) this.sys = { c };
        return c;
      });
    this.locating = locating;
    const run: Promise<PwshStatus> = locating.then(async (c) => {
      const version = c ? await readPwshVersion(c, this.d) : undefined;
      if (this.locating === locating && this.sys) this.sys.version = version;
      await this.priv.prepare(refresh);
      this.checkedAt = Date.now();
      const st = this.compose();
      log.info("PowerShell", { found: st.found, missing: st.missing, path: st.path, source: st.source, version: st.version, using: st.using, private: st.private && { ready: st.private.ready, installed: st.private.installed, supported: st.private.supported, bad: st.private.bad?.reason }, ms: Date.now() - t0 });
      this.update();
      this.testSystem();
      this.maybeAutoInstall("check");
      return st;
    });
    this.run = run;
    return run;
  }

  /** 同步快照（/status、诊断、界面）：没检测过就开始检测，先返回"检测中"；安装进度是实时的 */
  snapshot(): PwshStatus {
    if (!this.run) void this.check();
    return this.compose();
  }

  /** 现在该用哪个 */
  private choose(): { kind: "system" | "private" | "legacy"; path?: string; source?: PwshSource; version?: string } {
    const s = this.sys;
    if (s?.c && !this.systemIssue()) {
      const t = this.sysTests.get(dirKey(s.c.path));
      const version = s.version ?? (t && t !== "pending" ? t.version : undefined);
      if (!(Number(version?.split(".")[0]) < 7)) return { kind: "system", path: s.c.path, source: s.c.source, version };
    }
    if (this.cfg.mode === "auto" && this.priv.ready && this.priv.exe) return { kind: "private", path: this.priv.exe, source: "private", version: this.priv.pin.version };
    return { kind: "legacy", path: (s?.c || this.ignoreSystem) && this.legacyExists ? windowsPowerShell(this.env) : undefined };
  }

  /** 系统里的那个为什么不能用 */
  private systemIssue(): string | undefined {
    const c = this.sys?.c;
    if (!c) return undefined;
    const bad = this.sysBad.get(dirKey(c.path));
    if (bad) return `代理拉不起它：${bad.reason}`;
    const t = this.sysTests.get(dirKey(c.path));
    if (t && t !== "pending" && !t.ok && !t.timedOut) return `试运行没通过：${t.error}`;
    return undefined;
  }

  private compose(): PwshStatus {
    if (!this.applicable) return { applicable: false, found: false, missing: false, checkedAt: this.checkedAt || Date.now() };
    if (this.forced) return forcedStatus(this.env.AMB_PWSH_FORCE!, this.priv.pin.version);
    const extra = {
      mode: this.cfg.mode,
      autoInstall: this.cfg.agent && this.cfg.mode === "auto" && this.env.AMB_PWSH_AUTO_INSTALL !== "0",
      ...(this.ignoreSystem ? { ignoreSystem: true } : {}),
      private: this.priv.status(),
      ...(this.fallback ? { fallback: this.fallback } : {}),
    };
    const s = this.sys;
    if (!s) return { applicable: true, checking: true, found: false, missing: false, checkedAt: 0, ...extra };
    const ch = this.choose();
    const issue = this.systemIssue();
    const base =
      ch.kind !== "legacy"
        ? { found: true, missing: false, path: ch.path, source: ch.source, version: ch.version }
        : s.c
          ? { found: true, missing: true, path: s.c.path, source: s.c.source, version: s.version }
          : { found: false, missing: true };
    return { applicable: true, ...base, checkedAt: this.checkedAt, ...(ch.path ? { using: ch.path } : {}), ...(issue ? { systemIssue: issue } : {}), ...extra };
  }

  /**
   * DSH 启动前调用：要写进补丁的 pwshPath。最多等 waitMs（找文件、看一眼内置副本；不等版本号和试运行）；
   * 不是 Windows、模拟"未安装"、或什么都没有时返回 undefined（DSH 自己找）。
   */
  async dshPath(waitMs = 3000): Promise<string | undefined> {
    if (!this.active) return undefined;
    if (!this.run) void this.check();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((r) => (timer = setTimeout(r, waitMs)));
    try {
      await Promise.race([this.locating, deadline]);
      if (this.sys && this.choose().kind === "legacy" && this.cfg.mode === "auto") await Promise.race([this.priv.prepare(), deadline]);
    } finally {
      clearTimeout(timer);
    }
    return this.choose().path;
  }

  /** 现在写进 DSH 补丁的路径（同步）：变了就在代理进程空闲时重启它 */
  get cachedDshPath(): string | undefined {
    return this.active && this.sys ? this.choose().path : undefined;
  }

  /** 选择变了就通知（notice：同时要告诉用户的话） */
  private update(notice?: PwshEvent["notice"]): void {
    if (!this.active || !this.sys) return;
    const to = this.choose().path;
    if (this.lastPath === null) {
      this.lastPath = to;
      return;
    }
    if (to === this.lastPath && !notice) return;
    const from = this.lastPath;
    this.lastPath = to;
    if (from !== to) log.info("PowerShell for the agent changed; idle agent hosts restart", { from, to });
    this.emit({ kind: "path", from, to, notice });
  }

  private onPrivateChange(): void {
    if (this.quiet) return;
    const p = this.priv.status().install;
    const was = this.lastInstall;
    this.lastInstall = p.state;
    if (was !== p.state && INSTALLING.includes(was)) {
      if (p.state === "done")
        this.emit({ kind: "install", notice: { level: "info", text: `已为代理装好 PowerShell ${this.priv.pin.version}（应用内置，不影响你自己的 PowerShell），代理执行命令会快很多。` } });
      if (p.state === "failed")
        this.emit({
          kind: "install",
          notice: { level: "warn", text: `为代理安装 PowerShell 7 没有成功：${p.error ?? "未知原因"}。代理照常用 Windows PowerShell 5.1 执行命令；可在 设置 → 故障排查 里重试。` },
        });
    }
    this.update();
  }

  /** 系统里的 pwsh 在后台按 DSH 的方式试运行一次（每个路径每次运行一次）；没通过就换下一个 */
  private testSystem(): void {
    const c = this.sys?.c;
    if (!this.active || !c) return;
    const k = dirKey(c.path);
    if (this.sysTests.has(k)) return;
    this.sysTests.set(k, "pending");
    void launchTest(c.path, this.d.run ?? runProcess, { timeoutMs: 60_000, env: this.env }).then((t) => {
      if (this.sysTests.get(k) !== "pending") return;
      this.sysTests.set(k, t);
      log.info("PowerShell launch test", { path: c.path, ok: t.ok, ms: t.ms, version: t.version, error: t.error });
      if (!t.ok && !t.timedOut && this.sys?.c?.path === c.path) {
        const to = this.choose().path;
        this.fallback = { from: c.path, reason: `试运行没通过：${t.error}`, to, at: Date.now() };
        this.update({ level: "warn", text: `系统里的 PowerShell（${c.path}）试运行没通过：${t.error}。代理改用${describe(to, this.priv.exe)}执行命令。` });
        this.maybeAutoInstall("system test failed");
      } else this.update();
    });
  }

  /** 系统里没有能用的 7、内置的也没装：后台自动装（Windows、代理模式开着、没被关掉、这台电脑能装） */
  private maybeAutoInstall(why: string): void {
    if (!this.active || !this.sys || !this.cfg.agent || this.cfg.mode !== "auto") return;
    if (this.choose().kind !== "legacy" || this.priv.busy) return;
    const blocked = this.priv.autoBlocked();
    if (blocked) return void log.info("not installing PowerShell 7 automatically", { why, reason: blocked });
    log.info("no working PowerShell 7; installing the app-managed copy in the background", { why });
    void this.priv.install();
  }

  /** 手动安装 / 重新安装（设置 → 故障排查、提示里的按钮）：同时把选择改回 auto */
  install(o: { reinstall?: boolean } = {}): void {
    this.cfg.mode = "auto";
    this.fallback = undefined;
    const st = this.priv.status();
    void this.priv.install({ manual: true, reinstall: !!o.reinstall || !!st.bad }).then(() => this.update());
  }

  /** 改回系统默认 / 重新用内置的 */
  setMode(mode: PwshMode): void {
    this.cfg.mode = mode;
    this.update();
    this.maybeAutoInstall("mode");
  }

  /**
   * 代理 pwsh 工具的结果（宿主转来；exe = 这个代理进程补丁里写的路径）。
   * 强信号（PowerShell 本身没拉起来）立即退回下一个；弱信号（.NET 宿主报错之类）重新试运行一次，没通过才退回。
   */
  observeToolResult(exe: string | undefined, text: string): void {
    if (!this.active || !exe || !text) return;
    const hit = shellStartFailure(text, exe);
    if (hit) {
      log.warn("the agent's pwsh tool could not start PowerShell", { exe, line: hit });
      return this.markBroken(exe, startFailureReason(hit));
    }
    if (SUSPECT.test(text)) void this.suspect(exe);
  }

  private async suspect(exe: string): Promise<void> {
    const k = dirKey(exe);
    if (Date.now() - (this.suspected.get(k) ?? 0) < 60_000) return;
    this.suspected.set(k, Date.now());
    const t = await launchTest(exe, this.d.run ?? runProcess, { timeoutMs: 60_000, env: this.env });
    log.info("PowerShell re-test after a suspicious tool result", { path: exe, ok: t.ok, error: t.error });
    if (!t.ok && !t.timedOut) this.markBroken(exe, `试运行没通过：${t.error}`);
  }

  /** 代理拉不起 exe：标记为坏，退回下一个（空闲时重启代理进程），告诉用户；必要时自动安装内置副本 */
  markBroken(exe: string, reason: string): void {
    const k = dirKey(exe);
    if (this.priv.exe && dirKey(this.priv.exe) === k) {
      if (!this.priv.ready) return;
      this.quiet = true;
      try {
        this.priv.markBad(`代理拉不起它：${reason}`);
      } finally {
        this.quiet = false;
      }
    } else if (this.sys?.c && dirKey(this.sys.c.path) === k) {
      if (this.sysBad.has(k)) return;
      this.sysBad.set(k, { reason, at: Date.now() });
    } else {
      // Windows PowerShell 5.1 也起不来：已经没有可退的了（多半是沙箱本身的问题），只记日志
      return void log.warn("the agent could not start PowerShell, and there is nothing left to fall back to", { exe, reason });
    }
    const to = this.choose().path;
    this.fallback = { from: exe, reason, to, at: Date.now() };
    log.warn("the agent could not start its PowerShell; falling back", { from: exe, to, reason });
    this.update({
      level: "warn",
      text: `代理用的 PowerShell 起不来（${exe}：${reason.slice(0, 160)}），已自动改用${describe(to, this.priv.exe)}，代理空闲时生效。可在 设置 → 故障排查 里重新安装或重新检测。`,
    });
    this.maybeAutoInstall("broken");
  }
}

const FORCE_DEMO = ["missing", "installing", "installed", "broken", "failed"];

/** AMB_PWSH_FORCE 模拟的状态（截图、界面测试；任何平台） */
function forcedStatus(kind: string, version: string): PwshStatus {
  const now = Date.now();
  const dir = "C:\\Users\\you\\AppData\\Local\\AnyModelBot\\pwsh\\" + `${version}-x64`;
  const exe = `${dir}\\pwsh.exe`;
  const priv = (o: Partial<PrivatePwshStatus>): PrivatePwshStatus => ({ version, arch: "x64", supported: true, dir, installed: false, ready: false, install: { state: "idle" }, ...o });
  const base = { applicable: true, forced: true, checkedAt: now, mode: "auto" as const, autoInstall: true };
  if (kind === "installing") return { ...base, found: false, missing: true, private: priv({ install: { state: "downloading", received: 47 * 1048576, total: 104 * 1048576, startedAt: now - 20_000 } }) };
  if (kind === "installed") {
    const test = { ok: true, at: now, ms: 1180, version };
    return { ...base, found: true, missing: false, path: exe, source: "private", version, using: exe, private: priv({ installed: true, ready: true, test, install: { state: "done", startedAt: now - 60_000, finishedAt: now } }) };
  }
  if (kind === "broken") {
    const reason = "代理拉不起它：找不到 pwsh.exe（可能被杀毒软件删除或隔离）（Win32 2）";
    return { ...base, found: false, missing: true, private: priv({ installed: true, bad: { reason, at: now } }), fallback: { from: exe, reason, at: now } };
  }
  if (kind === "failed") return { ...base, found: false, missing: true, private: priv({ install: { state: "failed", error: "下载失败（https://github.com/…）：90 秒没有收到数据", finishedAt: now } }) };
  return { applicable: true, found: false, missing: true, forced: true, checkedAt: now };
}

/** 给用户看的名字 */
function describe(p: string | undefined, privateExe: string | undefined): string {
  if (!p || /\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i.test(p)) return "系统自带的 Windows PowerShell 5.1";
  if (privateExe && dirKey(p) === dirKey(privateExe)) return "应用内置的 PowerShell 7";
  return ` ${p} `;
}

/** 进程内共用的一个：宿主、诊断、/status、界面接口都读它 */
export const pwshProbe = new PwshProbe();

/** DSH 补丁：Windows 上的 pwsh 执行器（pwsh-sandbox；基础 profile 里它没有 config）用选好的这一个 */
export function pwshPatchLines(pwshPath: string | undefined): string[] {
  return pwshPath ? ["- id: pwsh-sandbox", "  config:", `    pwshPath: ${JSON.stringify(pwshPath)}`] : [];
}

const SOURCE: Record<PwshSource, string> = { "program-files": "安装目录", path: "PATH", preview: "预览版", store: "Microsoft Store", private: "应用内置" };
const mb = (n?: number) => (n === undefined ? "?" : (n / 1048576).toFixed(0));

/** 安装进度的一句话 */
export function installProgressText(p: InstallProgress): string {
  switch (p.state) {
    case "waiting":
      return p.error ?? "准备中";
    case "downloading":
      return `下载 ${mb(p.received)} / ${mb(p.total)} MB${p.total ? `（${Math.min(100, Math.floor(((p.received ?? 0) / p.total) * 100))}%）` : ""}`;
    case "extracting":
      return "解压";
    case "verifying":
      return "核对签名";
    case "testing":
      return "试运行";
    case "done":
      return "已装好";
    case "failed":
      return `没装上：${p.error ?? "未知原因"}`;
    default:
      return "";
  }
}

const SLOW = "代理执行命令用的是系统自带的 Windows PowerShell 5.1，每条可能要二三十秒";

/** 聊天里 /status 的一行（只在 Windows 上有） */
export function pwshStatusLine(st: PwshStatus): string {
  if (!st.applicable) return "";
  if (st.checking) return "PowerShell：检测中";
  const fb = st.fallback ? `；之前用的 ${st.fallback.from} 起不来（${st.fallback.reason.slice(0, 120)}），已自动换掉` : "";
  if (!st.missing) return `PowerShell：${st.version ?? "7"}（${st.source === "private" ? "应用内置，" : ""}代理用它执行命令）${fb}`;
  const p = st.private;
  if (p && isInstalling(p.install)) return `PowerShell：正在为代理安装 PowerShell 7…${installProgressText(p.install)}。装好之前命令照常用 Windows PowerShell 5.1`;
  if (p?.bad && st.mode !== "system") return `PowerShell：应用内置的 PowerShell 7 用不了（${p.bad.reason.slice(0, 160)}），${SLOW}。在 设置 → 故障排查 里可以一键重新安装`;
  if (p?.install.state === "failed" && st.mode !== "system") return `PowerShell：为代理安装 PowerShell 7 没有成功（${p.install.error ?? "未知原因"}），${SLOW}。在 设置 → 故障排查 里可以重试，或者自己安装：${PWSH_WINGET}`;
  if (p && !p.supported && p.reason) return `PowerShell：${p.reason}，${SLOW}`;
  const now = st.systemIssue ? `系统里的 PowerShell 7 用不了（${st.systemIssue.slice(0, 120)}），${SLOW}` : st.found && st.version ? `PowerShell ${st.version} 版本较旧，${SLOW}` : `没有安装 PowerShell 7，${SLOW}`;
  const how = st.mode === "system" || !p?.supported ? `装上 PowerShell 7，命令执行快得多，也更稳定：${PWSH_WINGET}（或打开 ${PWSH_INSTALL_URL}）` : `应用可以自己装一份（不需要管理员权限）：设置 → 故障排查 → 安装；或者：${PWSH_WINGET}`;
  return `PowerShell：${now}。${how}`;
}

/** 诊断报告里的 PowerShell 行（只在 Windows 上有；内置副本另起一行） */
export function pwshReportLine(st: PwshStatus): string | undefined {
  if (!st.applicable) return undefined;
  if (st.checking) return "[PowerShell] 检测中";
  const where = st.path ? ` · ${st.path}（${SOURCE[st.source!] ?? st.source}）` : "";
  const lines: string[] = [];
  if (!st.missing) lines.push(`[PowerShell] ${st.version ?? "7（版本未知）"}${where} · 代理用它执行命令`);
  else if (st.systemIssue) lines.push(`[PowerShell] 系统里的 PowerShell 7 用不了${where} · ${st.systemIssue} · 代理用 ${st.using ?? "Windows PowerShell 5.1（DSH 默认）"}`);
  else if (st.found) lines.push(`[PowerShell] ${st.version ?? "?"} 版本较旧${where} · 建议安装 PowerShell 7`);
  else lines.push(`[PowerShell] 未安装 PowerShell 7：代理用 Windows PowerShell 5.1 执行命令（经沙箱每条约 25 秒，7 约 1 秒）${st.forced ? " · AMB_PWSH_FORCE 模拟" : ""}`);
  if (st.fallback) lines.push(`  自动退回 ${new Date(st.fallback.at).toISOString()}：${st.fallback.from} → ${st.fallback.to ?? "DSH 默认"} · ${st.fallback.reason}`);
  const p = st.private;
  if (p) {
    const state = !p.supported
      ? `不能装：${p.reason ?? "?"}`
      : p.ready
        ? `已就绪 · 试运行通过${p.test ? `（${p.test.ms} ms，${new Date(p.test.at).toISOString()}）` : ""}`
        : p.bad
          ? `用不了：${p.bad.reason}`
          : p.installed
            ? "已装，还没试运行"
            : "未安装";
    const inst = p.install.state !== "idle" ? ` · 安装：${installProgressText(p.install)}` : "";
    lines.push(`  内置 PowerShell ${p.version}${p.arch ? ` ${p.arch}` : ""} · ${state}${inst}${p.dir ? ` · ${p.dir}` : ""} · ${st.mode === "system" ? "已改回系统默认" : st.autoInstall ? "缺 7 时自动安装" : "不自动安装"}${st.ignoreSystem ? " · AMB_PWSH_IGNORE_SYSTEM=1" : ""}`);
  }
  return lines.join("\n");
}
