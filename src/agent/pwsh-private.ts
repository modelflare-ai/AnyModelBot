/**
 * 应用内置的 PowerShell 7（只在 Windows 上）：系统里没有能用的 PowerShell 7 时，应用自己下载官方 zip，校验、解压、试运行后
 * 装在用户目录里，代理用它执行命令。不要管理员权限，不写注册表、不改 PATH，不碰用户自己的 PowerShell。
 *
 * - 位置：%LOCALAPPDATA%\AnyModelBot\pwsh\<版本>-<架构>\（AMB_PWSH_HOME 可改）。不放数据目录：数据目录在 Roaming（%APPDATA%），
 *   漫游配置文件会同步这两百多 MB；LOCALAPPDATA 只在本机，开发版和安装版共用一份，删数据目录也不用重新下载。
 * - 步骤：下载到临时文件 → 核对 SHA256（版本和哈希写死在 PRIVATE_PWSH）→ 解压到临时目录（系统自带的 tar.exe，不行再用 5.1 的
 *   Expand-Archive）→ 核对 pwsh.exe 等文件的 Authenticode 签名（5.1 的 Get-AuthenticodeSignature，必须是 Microsoft 签发）→ 按 DSH 的
 *   方式试运行（版本号、读写临时文件、拉起外部程序）→ 写标记文件 → 整个目录改名到位。任何一步失败都删掉临时文件，不留半个副本。
 * - 同一时间只装一个（跨进程的锁文件，带心跳）；装到一半退出，下次启动先清掉残留。
 * - 每次启动只看文件指纹（大小 + 修改时间）：和上次试运行通过时一样就直接用；变了或超过 7 天才重新核对签名、试运行（约 1 秒）。
 * - 运行中发现坏了（代理拉不起它、文件被杀毒软件删了）就标记为坏（记在 state.json，带指纹），用户重新安装或重新检测之前不再用。
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../log.js";
import { t as tr } from "../i18n/index.js";

const log = logger("pwsh.private");
const W = path.win32;

/**
 * 固定的版本与哈希（一处改齐）。7.6 是 LTS（.NET 10），x64 与 arm64 都支持 Windows 10 1607 / Server 2016 起的系统。
 * 哈希来源：GitHub release v7.6.9 页面的 "SHA256 Hashes of the release artifacts"，与同一 release 里的 hashes.sha256、
 * GitHub API 的 asset digest 一致（2026-10-31 核对，并下载两个 zip 复算过）。升级：node scripts/pwsh-hashes.mjs <版本>，把输出贴到这里。
 */
export const PRIVATE_PWSH = {
  version: "7.6.9",
  sha256: {
    x64: "ce7484804c0f0ad4dda10c958e71acdaf7eebfb22505c1b480f89e0e9f1da94d",
    arm64: "2157fb002178e606c2a5532c56647118d90d029742f04d4900a71e3b478c2363",
  },
  size: { x64: 109620855, arm64: 102310068 },
  /** .NET 10 支持的最低版本：Windows 10 1607 / Windows Server 2016（build 14393） */
  minBuild: 14393,
};
export type PwshPin = typeof PRIVATE_PWSH;
export type PwshArch = "x64" | "arm64";

export const PWSH_RELEASES = "https://github.com/PowerShell/PowerShell/releases/download";
export const zipName = (pin: PwshPin, arch: PwshArch) => `PowerShell-${pin.version}-win-${arch}.zip`;

/** 下载地址：GitHub release；AMB_PWSH_MIRROR 可换成镜像前缀（照样核对哈希和签名） */
export function zipUrl(pin: PwshPin, arch: PwshArch, env: NodeJS.ProcessEnv = process.env): string {
  const mirror = env.AMB_PWSH_MIRROR?.trim();
  return mirror ? `${mirror.replace(/\/+$/, "")}/${zipName(pin, arch)}` : `${PWSH_RELEASES}/v${pin.version}/${zipName(pin, arch)}`;
}

/** DSH（dsh-pwsh-local）拉起每条命令的方式：同样的参数、同样的 UTF-8 前缀 */
export const DSH_PWSH_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];
export const DSH_ENCODING_PREAMBLE = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";

/** 试运行：版本号、在临时目录里写一个文件再读回来、拉起一个外部程序，最后打一行结果 */
export const TEST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$d = Join-Path ([System.IO.Path]::GetTempPath()) ('amb-pwsh-' + [guid]::NewGuid().ToString('N'))",
  "New-Item -ItemType Directory -Path $d | Out-Null",
  "try {",
  "  $f = Join-Path $d 'probe.txt'",
  "  Set-Content -LiteralPath $f -Value 'rw-ok' -Encoding utf8",
  "  $rw = (Get-Content -LiteralPath $f -Raw).Trim()",
  '  $ext = (& "$env:SystemRoot\\System32\\cmd.exe" /d /c echo ext-ok | Out-String).Trim()',
  '  "AMB-PWSH-TEST ver=$($PSVersionTable.PSVersion) rw=$rw ext=$ext"',
  "} finally { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }",
].join("\n");

/** 核对签名：每个文件一项（状态、签名者、颁发者），JSON 数组 */
const SIG_SCRIPT =
  "$ErrorActionPreference = 'Stop'; $r = foreach ($p in ($env:AMB_SIG_FILES -split '\\|')) { $s = Get-AuthenticodeSignature -LiteralPath $p; " +
  "[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject; issuer = [string]$s.SignerCertificate.Issuer } }; " +
  "ConvertTo-Json -Compress -InputObject @($r)";

/** 关键文件：缺一个就不能用；它们的大小和修改时间就是指纹 */
const KEY_FILES = ["pwsh.exe", "pwsh.dll", "System.Management.Automation.dll", "hostfxr.dll", "coreclr.dll"];
/** 要核对签名的文件 */
const SIGNED_FILES = ["pwsh.exe", "pwsh.dll", "System.Management.Automation.dll"];
const MARKER = ".amb-pwsh.json";
/** 上次试运行通过超过这么久就再试一次 */
const RETEST_MS = 7 * 24 * 3600_000;
/** 锁文件超过这么久没有心跳就当作残留 */
const LOCK_STALE_MS = 3 * 60_000;
/** 等另一个进程装完，最多等这么久 */
const LOCK_WAIT_MS = 30 * 60_000;
/** 自动安装失败后的等待：第 1 次失败后 1 小时，第 2 次后 1 天，3 次后不再自动装（手动点安装会清零） */
const AUTO_BACKOFF = [0, 3600_000, 24 * 3600_000];

// ---------- 子进程 ----------

export interface RunResult {
  /** 退出码；没跑起来或被超时杀掉时为 null */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** 没能拉起（ENOENT、EACCES…） */
  error?: string;
}
export type Runner = (exe: string, args: string[], o: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string }) => Promise<RunResult>;

/** 隐藏窗口、有超时；不抛错，结果里带退出码 / 超时 / 拉起失败 */
export const runProcess: Runner = (exe, args, o) =>
  new Promise((resolve) => {
    try {
      execFile(exe, args, { windowsHide: true, timeout: o.timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", env: o.env, cwd: o.cwd }, (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; killed?: boolean }) | null;
        resolve({
          code: !e ? 0 : typeof e.code === "number" ? e.code : null,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          ...(e?.killed ? { timedOut: true } : {}),
          ...(e && typeof e.code === "string" ? { error: `${e.code}: ${e.message}`.slice(0, 300) } : {}),
        });
      });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: "", error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  });

/** 给 PowerShell 的环境：和 DSH 给代理子进程的一样只带系统目录类变量（不带本进程的其他变量），加上 DSH 的去颜色、去分页 */
const SHELL_ENV = [
  "PATH", "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432",
  "ALLUSERSPROFILE", "PUBLIC", "OS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "NUMBER_OF_PROCESSORS", "USERNAME", "USERDOMAIN", "COMPUTERNAME",
];
export function shellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = { NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat" };
  for (const k of SHELL_ENV) {
    const v = env[k];
    if (v) out[k] = v;
  }
  return out;
}

const sysRoot = (env: NodeJS.ProcessEnv) => env.SystemRoot || env.windir || "C:\\Windows";
/** 系统自带的 Windows PowerShell 5.1 */
export const windowsPowerShell = (env: NodeJS.ProcessEnv = process.env) => W.join(sysRoot(env), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const clip = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);

// ---------- 版本、试运行、签名、解压 ----------

/** pwsh.deps.json 里的版本："pwsh/7.4.6"，新版是 "pwsh/7.6.9.500"（第四段不要），预览版 "pwsh/7.6.0-preview.5" */
export function depsJsonVersion(text: string): string | undefined {
  const m = /"pwsh\/(\d+\.\d+\.\d+)(?:\.\d+)?(-[0-9A-Za-z.]+)?"/.exec(text);
  return m ? m[1] + (m[2] ?? "") : undefined;
}

export interface LaunchTest {
  ok: boolean;
  at: number;
  ms: number;
  version?: string;
  error?: string;
  timedOut?: boolean;
}

/** 按 DSH 的方式拉起 pwsh 跑 TEST_SCRIPT；expect：版本号必须是它 */
export async function launchTest(exe: string, run: Runner, o: { timeoutMs: number; env?: NodeJS.ProcessEnv; expect?: string }): Promise<LaunchTest> {
  const t0 = Date.now();
  const r = await run(exe, [...DSH_PWSH_ARGS, DSH_ENCODING_PREAMBLE + TEST_SCRIPT], { timeoutMs: o.timeoutMs, env: shellEnv(o.env ?? process.env), cwd: os.tmpdir() });
  const ms = Date.now() - t0;
  const m = /AMB-PWSH-TEST ver=(\S+) rw=(\S*) ext=(\S*)/.exec(r.stdout);
  const fail = (error: string): LaunchTest => ({ ok: false, at: Date.now(), ms, ...(m ? { version: m[1] } : {}), error, ...(r.timedOut ? { timedOut: true } : {}) });
  if (r.timedOut) return fail(tr("pwsh.privTimeout", { s: Math.round(o.timeoutMs / 1000) }));
  if (r.error) return fail(tr("pwsh.privCantStart", { error: r.error }));
  if (!m || r.code !== 0) return fail(tr("pwsh.privUnexpected", { code: r.code, out: r.stderr || r.stdout ? tr("pwsh.privColon", { text: clip(r.stderr || r.stdout) }) : "" }));
  if (m[2] !== "rw-ok") return fail(tr("pwsh.privRwFailed"));
  if (m[3] !== "ext-ok") return fail(tr("pwsh.privExtFailed"));
  if (!(Number(m[1].split(".")[0]) >= 7)) return fail(tr("pwsh.privNot7", { v: m[1] }));
  if (o.expect && m[1] !== o.expect) return fail(tr("pwsh.privWrongVersion", { v: m[1], want: o.expect }));
  return { ok: true, at: Date.now(), ms, version: m[1] };
}

/**
 * 用 Windows PowerShell 5.1 核对 Authenticode：每个文件都要有效（Valid），签名者和颁发者都是 Microsoft。
 * 刚解压的文件杀毒软件要先扫一遍，加上证书吊销检查，冷机器上要几十秒（CI 上约 30 秒），给足时间。
 */
export async function verifySignatures(files: string[], run: Runner, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; error?: string }> {
  const r = await run(windowsPowerShell(env), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SIG_SCRIPT], {
    timeoutMs: 180_000,
    env: { ...shellEnv(env), AMB_SIG_FILES: files.join("|") },
  });
  if (r.timedOut) return { ok: false, error: tr("pwsh.privSigTimeout") };
  if (r.error || r.code !== 0) return { ok: false, error: tr("pwsh.privSigFailed", { error: clip(r.error || r.stderr || r.stdout || tr("pwsh.privExitCode", { code: r.code })) }) };
  let list: Array<{ status?: string; subject?: string; issuer?: string }>;
  try {
    list = JSON.parse(r.stdout.replace(/^\uFEFF/, "").trim());
  } catch {
    return { ok: false, error: tr("pwsh.privSigUnreadable", { out: clip(r.stdout) }) };
  }
  if (!Array.isArray(list) || list.length !== files.length) return { ok: false, error: tr("pwsh.privSigCount") };
  const ms = /\bO=Microsoft Corporation\b/;
  for (const [i, s] of list.entries()) {
    const name = path.basename(files[i]);
    if (s?.status !== "Valid") return { ok: false, error: tr("pwsh.privSigInvalid", { name, status: s?.status || tr("pwsh.privNoSig") }) };
    if (!ms.test(s.subject ?? "") || !ms.test(s.issuer ?? "")) return { ok: false, error: tr("pwsh.privNotMs", { name, subject: clip(s.subject ?? "", 120) }) };
  }
  return { ok: true };
}

/** 解压 zip：系统自带的 tar.exe（Windows 10 1803 起有，认 zip）；没有或失败时用 5.1 的 Expand-Archive。不用 PATH 里的 tar（Git 的 GNU tar 不认 zip） */
export async function extractZip(zip: string, dest: string, run: Runner, env: NodeJS.ProcessEnv): Promise<void> {
  const r = await run(W.join(sysRoot(env), "System32", "tar.exe"), ["-xf", zip, "-C", dest], { timeoutMs: 10 * 60_000, env: shellEnv(env) });
  if (r.code === 0 && !r.error && !r.timedOut) return;
  log.warn("tar.exe could not extract the PowerShell zip; trying Expand-Archive", { code: r.code, error: r.error, stderr: clip(r.stderr) });
  await fs.promises.rm(dest, { recursive: true, force: true });
  await fs.promises.mkdir(dest, { recursive: true });
  const ps = "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $env:AMB_ZIP -DestinationPath $env:AMB_DEST -Force";
  const r2 = await run(windowsPowerShell(env), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    timeoutMs: 20 * 60_000,
    env: { ...shellEnv(env), AMB_ZIP: zip, AMB_DEST: dest },
  });
  if (r2.code !== 0 || r2.error || r2.timedOut) throw new Error(tr("pwsh.privUnzipFailed", { error: clip(r2.error || r2.stderr || r2.stdout || (r2.timedOut ? tr("pwsh.privTimedOut") : tr("pwsh.privExitCode", { code: r2.code }))) }));
}

// ---------- 系统版本与架构 ----------

/** os.release() 形如 10.0.22631；读不出来就不拦（试运行会把关） */
export function osSupport(release: string, pin: PwshPin = PRIVATE_PWSH): { ok: boolean; build?: number; reason?: string } {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(release);
  if (!m) return { ok: true };
  const major = Number(m[1]);
  const build = Number(m[3]);
  if (major > 10 || (major === 10 && build >= pin.minBuild)) return { ok: true, build };
  return { ok: false, build, reason: tr("pwsh.privOldWindows", { release, version: pin.version }) };
}

/**
 * 装哪个架构：arm64 进程装 arm64；x64 进程在 ARM64 的 Windows 上是模拟运行，也装原生 arm64（快得多）。
 * PROCESSOR_IDENTIFIER 不随模拟改写（Intel64 / AMD64 开头就是真 x64）；认不出来时问注册表里的本机架构。32 位进程不装。
 */
export async function resolveArch(o: { arch?: string; env?: NodeJS.ProcessEnv; run?: Runner } = {}): Promise<PwshArch | undefined> {
  const arch = o.arch ?? process.arch;
  if (arch === "arm64") return "arm64";
  if (arch !== "x64") return undefined;
  const env = o.env ?? process.env;
  const id = env.PROCESSOR_IDENTIFIER ?? "";
  if (/\bARM/i.test(id) || /^ARM64$/i.test(env.PROCESSOR_ARCHITEW6432 ?? "")) return "arm64";
  if (/^(Intel64|AMD64|EM64T)\b/i.test(id)) return "x64";
  const r = await (o.run ?? runProcess)(W.join(sysRoot(env), "System32", "reg.exe"), ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "PROCESSOR_ARCHITECTURE"], { timeoutMs: 10_000, env: shellEnv(env) });
  return /\bARM64\b/i.test(r.stdout) ? "arm64" : "x64";
}

/** 安装根目录：AMB_PWSH_HOME，否则 %LOCALAPPDATA%\AnyModelBot\pwsh */
export function pwshRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AMB_PWSH_HOME) return path.resolve(env.AMB_PWSH_HOME);
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AnyModelBot", "pwsh");
}

// ---------- 下载 ----------

export class HashMismatch extends Error {}
/** 重试也没用的下载错误：大小不对（多半是代理或网关返回了网页）、HTTP 4xx */
export class DownloadRefused extends Error {}

/** 流式下载并边下边算 SHA256；长时间没有数据或总时长超限就中止。哈希不对时抛 HashMismatch（文件留给调用方删） */
export async function download(o: {
  fetch: typeof fetch;
  url: string;
  dest: string;
  sha256: string;
  size?: number;
  onProgress?: (received: number, total?: number) => void;
  stallMs?: number;
  totalMs?: number;
}): Promise<void> {
  const ac = new AbortController();
  const stallMs = o.stallMs ?? 90_000;
  let stall: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ac.abort(new Error(tr("pwsh.privStall", { s: Math.round(stallMs / 1000) }))), stallMs);
  };
  const total = setTimeout(() => ac.abort(new Error(tr("pwsh.privDownloadTimeout"))), o.totalMs ?? 60 * 60_000);
  const hash = crypto.createHash("sha256");
  const fh = await fs.promises.open(o.dest, "w");
  let received = 0;
  try {
    arm();
    const res = await o.fetch(o.url, { signal: ac.signal, redirect: "follow" });
    if (!res.ok || !res.body) throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new DownloadRefused(`HTTP ${res.status}`) : new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length")) || undefined;
    if (o.size && len && len !== o.size) throw new DownloadRefused(tr("pwsh.privSizeWrong", { len, size: o.size }));
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      received += value.byteLength;
      if (o.size && received > o.size) throw new DownloadRefused(tr("pwsh.privTooBig", { size: o.size }));
      hash.update(value);
      await fh.write(value);
      o.onProgress?.(received, o.size ?? len);
    }
  } catch (e) {
    throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
  } finally {
    clearTimeout(stall);
    clearTimeout(total);
    await fh.close();
  }
  const got = hash.digest("hex");
  if (got !== o.sha256) throw new HashMismatch(tr("pwsh.privHash", { got: got.slice(0, 12), want: o.sha256.slice(0, 12) }));
}

// ---------- 文件 ----------

/** 关键文件的大小 + 修改时间；missing：第一个缺的文件 */
async function fingerprint(dir: string): Promise<{ value: string; missing?: string }> {
  const parts: string[] = [];
  let missing: string | undefined;
  for (const f of KEY_FILES) {
    try {
      const s = await fs.promises.stat(path.join(dir, f));
      parts.push(`${f}:${s.size}:${Math.round(s.mtimeMs)}`);
    } catch {
      missing ??= f;
      parts.push(`${f}:-`);
    }
  }
  return { value: parts.join("|"), missing };
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 改名，Windows 上杀毒软件刚扫过的文件常被占用一会儿（EPERM / EBUSY / EACCES），等一等再试 */
async function renameRetry(from: string, to: string, tries = 20): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fs.promises.rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (i >= tries - 1 || !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(code)) throw e;
      await sleep(500);
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ---------- 状态 ----------

export type InstallState = "idle" | "waiting" | "downloading" | "extracting" | "verifying" | "testing" | "done" | "failed";

export interface InstallProgress {
  state: InstallState;
  /** 已下载 / 总字节 */
  received?: number;
  total?: number;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** 用户点的（不是自动装的） */
  manual?: boolean;
}

export interface PrivatePwshStatus {
  version: string;
  arch?: PwshArch;
  /** 这台电脑能不能装（Windows 版本、架构） */
  supported: boolean;
  reason?: string;
  dir?: string;
  /** 目录和标记文件在 */
  installed: boolean;
  /** 试运行通过、没被标记为坏：代理可以用 */
  ready: boolean;
  test?: LaunchTest;
  bad?: { reason: string; at: number };
  install: InstallProgress;
}

interface InstallRecord {
  fp: string;
  test?: LaunchTest;
  bad?: { reason: string; at: number };
}
interface StateFile {
  installs?: Record<string, InstallRecord>;
  /** 自动安装：连续失败次数与上次时间 */
  auto?: { attempts: number; lastAt: number };
}

export interface PrivateDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** process.arch */
  arch?: string;
  /** os.release() */
  osRelease?: string;
  /** 下载用的 fetch（桌面版换成 Electron 的 net.fetch：走系统代理）；每次下载时取 */
  fetch?: () => typeof fetch | undefined;
  run?: Runner;
  pidAlive?: (pid: number) => boolean;
  /** 下载重试的间隔基数、等别的进程装完时看锁的间隔（测试里调小） */
  retryDelayMs?: number;
  lockPollMs?: number;
  /** 测试用：换掉固定的版本与哈希 */
  pin?: PwshPin;
}

export class PrivatePwsh {
  readonly pin: PwshPin;
  arch?: PwshArch;
  private archP?: Promise<PwshArch | undefined>;
  private prep?: Promise<void>;
  private installing?: Promise<boolean>;
  private progress: InstallProgress = { state: "idle" };
  private cur: { installed: boolean; ready: boolean; test?: LaunchTest; bad?: { reason: string; at: number }; fp?: string } = { installed: false, ready: false };
  private listeners = new Set<() => void>();

  constructor(private readonly d: PrivateDeps = {}) {
    this.pin = d.pin ?? PRIVATE_PWSH;
  }

  private get env(): NodeJS.ProcessEnv {
    return this.d.env ?? process.env;
  }
  private get run(): Runner {
    return this.d.run ?? runProcess;
  }
  get root(): string {
    return pwshRoot(this.env);
  }
  get support(): { ok: boolean; build?: number; reason?: string } {
    if ((this.d.platform ?? process.platform) !== "win32") return { ok: false, reason: tr("pwsh.privWindowsOnly") };
    return osSupport(this.d.osRelease ?? os.release(), this.pin);
  }
  private get key(): string {
    return `${this.pin.version}-${this.arch}`;
  }
  get dir(): string | undefined {
    return this.arch ? path.join(this.root, this.key) : undefined;
  }
  get exe(): string | undefined {
    return this.dir && path.join(this.dir, "pwsh.exe");
  }
  /** 试运行通过、没被标记为坏 */
  get ready(): boolean {
    return this.cur.ready;
  }
  get busy(): boolean {
    return !!this.installing;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }
  private set(next: PrivatePwsh["cur"]): void {
    const before = this.cur.ready;
    this.cur = next;
    if (before !== next.ready) this.changed();
  }
  private setProgress(p: Partial<InstallProgress>, notify = false): void {
    this.progress = { ...this.progress, ...p };
    if (notify) this.changed();
  }

  status(): PrivatePwshStatus {
    const sup = this.support;
    const ok = sup.ok && !!this.arch;
    return {
      version: this.pin.version,
      ...(this.arch ? { arch: this.arch } : {}),
      supported: ok,
      ...(!sup.ok ? { reason: sup.reason } : !this.arch && this.prep ? { reason: tr("pwsh.privNoArch") } : {}),
      ...(this.dir ? { dir: this.dir } : {}),
      installed: this.cur.installed,
      ready: this.cur.ready,
      ...(this.cur.test ? { test: this.cur.test } : {}),
      ...(this.cur.bad ? { bad: this.cur.bad } : {}),
      install: { ...this.progress },
    };
  }

  // ---------- state.json ----------
  private get stateFile(): string {
    return path.join(this.root, "state.json");
  }
  private readState(): StateFile {
    return readJson<StateFile>(this.stateFile) ?? {};
  }
  private updateState(fn: (s: StateFile) => void): void {
    try {
      const s = this.readState();
      fn(s);
      writeJsonAtomic(this.stateFile, s);
    } catch (e) {
      log.warn("could not write the PowerShell state file", { err: String((e as Error)?.message ?? e) });
    }
  }
  private saveRecord(rec: InstallRecord | undefined): void {
    this.updateState((s) => {
      s.installs ??= {};
      if (rec) s.installs[this.key] = rec;
      else delete s.installs[this.key];
    });
  }

  // ---------- 锁 ----------
  private get lockFile(): string {
    return path.join(this.root, ".lock");
  }
  /** 另一个进程正在装（锁文件的进程还在、心跳是新的） */
  private lockHeld(): boolean {
    try {
      const st = fs.statSync(this.lockFile);
      const pid = Number(readJson<{ pid?: number }>(this.lockFile)?.pid);
      // 自己的（上次没删掉，或 pid 被复用）不算；没有心跳太久、进程不在了也不算
      if (pid === process.pid || !(pid > 0) || Date.now() - st.mtimeMs > LOCK_STALE_MS) return false;
      return (this.d.pidAlive ?? pidAlive)(pid);
    } catch {
      return false;
    }
  }
  private takeLock(): boolean {
    fs.mkdirSync(this.root, { recursive: true });
    for (let i = 0; i < 2; i++) {
      try {
        fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      if (this.lockHeld()) return false;
      fs.rmSync(this.lockFile, { force: true });
    }
    return false;
  }

  /** 没人在装时清掉上次留下的临时文件、半个目录和旧版本（旧版本先改名再删：正被别的进程用着就改不了名，留着） */
  private async cleanup(): Promise<void> {
    if (this.installing || this.lockHeld()) return;
    fs.rmSync(this.lockFile, { force: true });
    const names = await fs.promises.readdir(this.root).catch(() => [] as string[]);
    for (const n of names) {
      const p = path.join(this.root, n);
      if (/^\.(staging|dl|trash)-/.test(n)) {
        log.info("removing a leftover from an earlier PowerShell install", { path: p });
        await fs.promises.rm(p, { recursive: true, force: true }).catch(() => undefined);
      } else if (n !== this.key && /^\d+\.\d+\.\d+(-[\w.]+)?-(x64|arm64)$/.test(n) && fs.existsSync(path.join(p, MARKER))) {
        const trash = path.join(this.root, `.trash-${crypto.randomBytes(4).toString("hex")}`);
        try {
          await fs.promises.rename(p, trash);
          await fs.promises.rm(trash, { recursive: true, force: true });
          log.info("removed an older app-managed PowerShell", { path: p });
        } catch {
          /* 正在用 */
        }
      }
    }
  }

  // ---------- 检查已装的副本 ----------

  private resolveArchOnce(): Promise<PwshArch | undefined> {
    this.archP ??= resolveArch({ arch: this.d.arch, env: this.env, run: this.run }).catch(() => undefined);
    return this.archP;
  }

  /**
   * 启动时（以及"重新检测"时）看一眼已装的副本：清理残留，文件指纹和上次试运行通过时一样就直接用；
   * 变了就重新核对签名并试运行；refresh 时清掉"坏了"的标记并重新试运行。
   */
  prepare(refresh = false): Promise<void> {
    if (this.prep && !refresh) return this.prep;
    const p = this.doPrepare(refresh).catch((e) => log.warn("checking the app-managed PowerShell failed", { err: String((e as Error)?.message ?? e) }));
    this.prep = p;
    return p;
  }

  private async doPrepare(refresh: boolean): Promise<void> {
    this.arch = await this.resolveArchOnce();
    if (!this.support.ok || !this.arch) return this.set({ installed: false, ready: false });
    if (this.installing) return;
    await this.cleanup();
    await this.evaluate(refresh);
  }

  /** 看已装的副本能不能用（标记文件、指纹、签名、试运行），结果记进 state.json */
  private async evaluate(refresh: boolean): Promise<void> {
    if (!this.arch) return;
    const dir = this.dir!;
    const marker = readJson<{ version?: string; arch?: string; sha256?: string }>(path.join(dir, MARKER));
    if (!marker || marker.version !== this.pin.version || marker.sha256 !== this.pin.sha256[this.arch]) return this.set({ installed: false, ready: false });
    const fp = await fingerprint(dir);
    const rec = this.readState().installs?.[this.key];
    if (fp.missing) {
      const bad = rec?.bad && rec.fp === fp.value ? rec.bad : { reason: tr("pwsh.privFileMissing", { file: fp.missing }), at: Date.now() };
      this.saveRecord({ fp: fp.value, test: rec?.test, bad });
      log.warn("app-managed PowerShell is incomplete", { dir, missing: fp.missing });
      return this.set({ installed: true, ready: false, bad, test: rec?.test, fp: fp.value });
    }
    if (!refresh && rec?.fp === fp.value) {
      if (rec.bad) return this.set({ installed: true, ready: false, bad: rec.bad, test: rec.test, fp: fp.value });
      if (rec.test?.ok && Date.now() - rec.test.at < RETEST_MS) return this.set({ installed: true, ready: true, test: rec.test, fp: fp.value });
    }
    // 文件变了（或从没测过）：先核对签名；然后试运行
    if (rec?.fp !== fp.value) {
      const sig = await verifySignatures(SIGNED_FILES.map((f) => path.join(dir, f)), this.run, this.env);
      if (!sig.ok) {
        const bad = { reason: tr("pwsh.privSigNotPassed", { error: sig.error }), at: Date.now() };
        this.saveRecord({ fp: fp.value, bad });
        log.warn("app-managed PowerShell failed the signature check", { dir, error: sig.error });
        return this.set({ installed: true, ready: false, bad, fp: fp.value });
      }
    }
    const test = await launchTest(path.join(dir, "pwsh.exe"), this.run, { timeoutMs: 60_000, env: this.env, expect: this.pin.version });
    log.info("app-managed PowerShell launch test", { dir, ok: test.ok, ms: test.ms, version: test.version, error: test.error });
    if (!test.ok) {
      const bad = { reason: tr("pwsh.testFailed", { error: test.error }), at: Date.now() };
      this.saveRecord({ fp: fp.value, test, bad });
      return this.set({ installed: true, ready: false, bad, test, fp: fp.value });
    }
    this.saveRecord({ fp: fp.value, test });
    this.set({ installed: true, ready: true, test, fp: fp.value });
  }

  /** 运行中发现坏了（代理拉不起它等）：标记为坏，记下原因；重新安装或重新检测之前不再用 */
  markBad(reason: string): void {
    if (!this.cur.installed) return;
    const bad = { reason, at: Date.now() };
    const rec = this.readState().installs?.[this.key];
    this.saveRecord({ fp: this.cur.fp ?? rec?.fp ?? "", test: rec?.test, bad });
    log.warn("app-managed PowerShell marked as broken", { dir: this.dir, reason });
    this.set({ ...this.cur, ready: false, bad });
  }

  // ---------- 自动安装的节奏 ----------

  /**
   * 现在能不能自动装；不能时返回原因。只在一份都没装时自动装：装过但坏了（试运行没过、代理拉不起、文件被删）要用户点"重新安装"，
   * 免得"装好 → 坏 → 再装"一直循环下载。
   */
  autoBlocked(): string | undefined {
    if (this.env.AMB_PWSH_AUTO_INSTALL === "0") return "AMB_PWSH_AUTO_INSTALL=0";
    if (!this.support.ok) return this.support.reason;
    if (!this.arch) return tr("pwsh.privArchUnsupported");
    if (this.installing) return tr("pwsh.privInstalling");
    if (this.cur.installed) return this.cur.bad ? tr("pwsh.privBadCopy", { reason: this.cur.bad.reason }) : tr("pwsh.privAlreadyInstalled");
    const a = this.readState().auto ?? { attempts: 0, lastAt: 0 };
    if (a.attempts >= AUTO_BACKOFF.length) return tr("pwsh.privAutoFailedN", { n: a.attempts });
    if (Date.now() - a.lastAt < AUTO_BACKOFF[a.attempts]) return tr("pwsh.privAutoBackoff");
    return undefined;
  }

  // ---------- 安装 ----------

  /**
   * 下载、校验、解压、核对签名、试运行，然后换上。reinstall：已经有能用的也重装（删掉旧的）。
   * 同一进程里只跑一个；另一个进程正在装时返回 false（状态是 waiting）。
   */
  install(o: { reinstall?: boolean; manual?: boolean } = {}): Promise<boolean> {
    this.installing ??= this.doInstall(o).finally(() => (this.installing = undefined));
    return this.installing;
  }

  private async doInstall(o: { reinstall?: boolean; manual?: boolean }): Promise<boolean> {
    const startedAt = Date.now();
    this.progress = { state: "waiting", startedAt, ...(o.manual ? { manual: true } : {}) };
    this.changed();
    await this.prep?.catch(() => undefined);
    this.arch = await this.resolveArchOnce();
    const sup = this.support;
    // 自动安装失败才记一次（装到一半退出不算，下次启动接着装）；手动点安装清零
    const fail = (error: string) => {
      if (!o.manual)
        this.updateState((s) => {
          const a = s.auto ?? { attempts: 0, lastAt: 0 };
          s.auto = { attempts: a.attempts + 1, lastAt: Date.now() };
        });
      this.setProgress({ state: "failed", error, finishedAt: Date.now() }, true);
      return false;
    };
    if (!sup.ok) return fail(sup.reason ?? tr("pwsh.privCantInstall"));
    if (!this.arch) return fail(tr("pwsh.privNoArch"));
    if (o.manual) this.updateState((s) => (s.auto = { attempts: 0, lastAt: 0 }));
    if (!o.reinstall && this.cur.ready) {
      this.setProgress({ state: "done", finishedAt: Date.now() }, true);
      return true;
    }
    // 另一个 AnyModelBot 正在装：等它（锁没了再看一眼，它装好了就直接用），最多等 LOCK_WAIT_MS
    const waitUntil = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      let locked = false;
      try {
        locked = this.takeLock();
      } catch (e) {
        return fail(tr("pwsh.privMkdir", { dir: this.root, error: (e as Error).message }));
      }
      if (locked) break;
      if (Date.now() > waitUntil) {
        this.setProgress({ state: "failed", error: tr("pwsh.privOtherInstalling"), finishedAt: Date.now() }, true);
        return false;
      }
      this.setProgress({ state: "waiting", error: tr("pwsh.privOtherWaiting") }, true);
      await sleep(this.d.lockPollMs ?? 5000);
      if (this.lockHeld()) continue;
      await this.evaluate(false);
      if (this.cur.ready && !o.reinstall) {
        this.setProgress({ state: "done", finishedAt: Date.now(), error: undefined }, true);
        return true;
      }
    }
    const heartbeat = setInterval(() => fs.promises.utimes(this.lockFile, new Date(), new Date()).catch(() => undefined), 30_000);
    heartbeat.unref?.();
    const arch = this.arch;
    const tag = crypto.randomBytes(4).toString("hex");
    const zip = path.join(this.root, `.dl-${tag}.zip`);
    const stage = path.join(this.root, `.staging-${tag}`);
    const trash = path.join(this.root, `.trash-${tag}`);
    const dir = this.dir!;
    const url = zipUrl(this.pin, arch, this.env);
    log.info("installing the app-managed PowerShell 7", { version: this.pin.version, arch, url, dir, manual: !!o.manual, reinstall: !!o.reinstall });
    try {
      // 1. 下载（网络错误重试两次；哈希不对不重试）
      const fetchFn = this.d.fetch?.() ?? globalThis.fetch;
      const size = this.pin.size[arch];
      this.setProgress({ state: "downloading", received: 0, total: size, error: undefined }, true);
      let lastLog = 0;
      for (let attempt = 1; ; attempt++) {
        try {
          await download({
            fetch: fetchFn,
            url,
            dest: zip,
            sha256: this.pin.sha256[arch],
            size,
            onProgress: (received, total) => {
              this.setProgress({ received, total });
              if (Date.now() - lastLog > 10_000) {
                lastLog = Date.now();
                log.info("downloading PowerShell 7", { received, total });
              }
            },
          });
          break;
        } catch (e) {
          if (e instanceof HashMismatch) throw new Error(tr("pwsh.privDiscarded", { error: e.message }));
          if (e instanceof DownloadRefused || attempt >= 3) throw new Error(tr("pwsh.privDownloadFailed", { url, error: String((e as Error)?.message ?? e) }));
          log.warn("PowerShell download failed; retrying", { attempt, err: String((e as Error)?.message ?? e) });
          this.setProgress({ received: 0 });
          await sleep(attempt * (this.d.retryDelayMs ?? 3000));
        }
      }
      // 2. 解压到临时目录
      this.setProgress({ state: "extracting" }, true);
      await fs.promises.mkdir(stage, { recursive: true });
      await extractZip(zip, stage, this.run, this.env);
      await fs.promises.rm(zip, { force: true });
      // 3. 核对：版本号、关键文件、签名
      this.setProgress({ state: "verifying" }, true);
      const ver = depsJsonVersion(await fs.promises.readFile(path.join(stage, "pwsh.deps.json"), "utf8").catch(() => ""));
      if (ver !== this.pin.version) throw new Error(tr("pwsh.privExtractedVersion", { v: ver ?? tr("pwsh.privUnknown"), want: this.pin.version }));
      const fp = await fingerprint(stage);
      if (fp.missing) throw new Error(tr("pwsh.privMissingAfterExtract", { file: fp.missing }));
      const sig = await verifySignatures(SIGNED_FILES.map((f) => path.join(stage, f)), this.run, this.env);
      if (!sig.ok) throw new Error(tr("pwsh.privSigNotPassed", { error: sig.error }));
      // 4. 按 DSH 的方式试运行（第一次启动时杀毒软件要扫一遍，给足时间）
      this.setProgress({ state: "testing" }, true);
      const test = await launchTest(path.join(stage, "pwsh.exe"), this.run, { timeoutMs: 120_000, env: this.env, expect: this.pin.version });
      if (!test.ok) throw new Error(tr("pwsh.testFailed", { error: test.error }));
      fs.writeFileSync(path.join(stage, MARKER), JSON.stringify({ version: this.pin.version, arch, sha256: this.pin.sha256[arch], installedAt: Date.now(), test }, null, 2));
      // 5. 换上：旧目录先挪开（里面的 pwsh 正在跑时挪不动，过一会儿再装），新目录整个改名到位
      let moved = false;
      if (fs.existsSync(dir)) {
        try {
          await renameRetry(dir, trash);
          moved = true;
        } catch (e) {
          throw new Error(tr("pwsh.privInUse", { error: (e as NodeJS.ErrnoException).code ?? (e as Error).message }));
        }
      }
      try {
        await renameRetry(stage, dir);
      } catch (e) {
        if (moved) await fs.promises.rename(trash, dir).catch(() => undefined);
        throw new Error(tr("pwsh.privCantPlace", { error: (e as Error).message }));
      }
      this.saveRecord({ fp: fp.value, test });
      this.updateState((s) => (s.auto = { attempts: 0, lastAt: 0 }));
      this.set({ installed: true, ready: true, test, fp: fp.value });
      this.setProgress({ state: "done", finishedAt: Date.now(), error: undefined }, true);
      log.info("app-managed PowerShell 7 is ready", { dir, version: test.version, ms: Date.now() - startedAt, testMs: test.ms });
      return true;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 400);
      log.warn("installing the app-managed PowerShell 7 failed", { err: msg, ms: Date.now() - startedAt });
      return fail(msg);
    } finally {
      clearInterval(heartbeat);
      await fs.promises.rm(zip, { force: true }).catch(() => undefined);
      await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      await fs.promises.rm(trash, { recursive: true, force: true }).catch(() => undefined);
      fs.rmSync(this.lockFile, { force: true });
    }
  }
}
