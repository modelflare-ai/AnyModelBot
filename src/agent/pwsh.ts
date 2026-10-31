/**
 * Windows 上的 PowerShell 7（pwsh）检测。
 *
 * 代理（DSH）在 Windows 上用 PowerShell 执行命令（@deepseek-ai/dsh-pwsh-sandbox，经 Windows ACL 沙箱）。它自己按
 * %ProgramFiles%\PowerShell\7\pwsh.exe → PATH 里的 pwsh.exe → Windows PowerShell 5.1 的顺序找
 * （dsh-pwsh-local 的 resolvePwshPath）。经沙箱时 5.1 每条命令要二三十秒，PowerShell 7 大约 1 秒，
 * 所以没装 7 时界面里建议安装。
 *
 * - 只看文件，不拉起进程、不阻塞主线程：先按 DSH 的顺序，再补上 DSH 不看的位置（7-preview 等其他 7* 目录、
 *   Microsoft Store / winget 的 WindowsApps 别名）。
 * - 找到的路径写进 DSH 补丁（pwsh-sandbox 的 pwshPath），DSH 用的就是这里检测到的那一个。
 * - 版本号异步读：先读 pwsh.deps.json，读不到（Store 别名）再 `pwsh -Version`（windowsHide，5 秒超时）。
 * - 结果缓存；"重新检测"时刷新。AMB_PWSH_FORCE=missing 在任何平台上模拟"未安装"（截图、测试），不影响 DSH。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../log.js";
import { t, type MessageKey } from "../i18n/index.js";

const log = logger("pwsh");
const W = path.win32;

export const PWSH_INSTALL_URL = "https://aka.ms/PSWindows";
export const PWSH_WINGET = "winget install --id Microsoft.PowerShell --source winget";

/** program-files：%ProgramFiles%\PowerShell\7（MSI、winget）；preview：7-preview 等；store：WindowsApps 别名；path：PATH 里的其他位置 */
export type PwshSource = "program-files" | "path" | "preview" | "store";

export interface PwshCandidate {
  path: string;
  source: PwshSource;
}

export interface PwshStatus {
  /** 只在 Windows 上检测（或 AMB_PWSH_FORCE 模拟）；其他平台代理用 bash */
  applicable: boolean;
  /** 第一次检测还没完成 */
  checking?: boolean;
  /** 找到了 pwsh.exe */
  found: boolean;
  /** 没有 PowerShell 7+：代理会退回 Windows PowerShell 5.1（或更旧的 pwsh），界面建议安装 */
  missing: boolean;
  path?: string;
  source?: PwshSource;
  /** 例如 7.4.6；读不到时为空 */
  version?: string;
  /** AMB_PWSH_FORCE=missing 模拟的结果 */
  forced?: boolean;
  checkedAt: number;
}

/** 可替换的环境与文件系统（测试用） */
export interface PwshDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  lstat?: (p: string) => Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  readdir?: (p: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
  /** `pwsh -Version` 的输出（读版本号的最后手段） */
  runVersion?: (exe: string) => Promise<string>;
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

function runVersion(exe: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(exe, ["-Version"], { windowsHide: true, timeout: 5000, encoding: "utf8", maxBuffer: 64 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))),
  );
}

/** 版本号：MSI / zip 安装目录里的 pwsh.deps.json 有 "pwsh/7.4.6"，不用拉起进程；Store 别名旁边没有，再问 pwsh 自己 */
export async function readPwshVersion(c: PwshCandidate, d: PwshDeps = {}): Promise<string | undefined> {
  const readFile = d.readFile ?? ((p: string) => fs.promises.readFile(p, "utf8"));
  try {
    const m = /"pwsh\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)"/.exec(await readFile(W.join(W.dirname(c.path), "pwsh.deps.json")));
    if (m) return m[1];
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

export class PwshProbe {
  private run?: Promise<PwshStatus>;
  private locating?: Promise<PwshCandidate | undefined>;
  private located?: PwshCandidate;
  private last?: PwshStatus;

  constructor(private readonly d: PwshDeps = {}) {}

  private get platform(): NodeJS.Platform {
    return this.d.platform ?? process.platform;
  }
  private get forced(): boolean {
    return (this.d.env ?? process.env).AMB_PWSH_FORCE === "missing";
  }
  get applicable(): boolean {
    return this.platform === "win32" || this.forced;
  }

  /** 检测（结果缓存）；refresh = 重新检测 */
  check(refresh = false): Promise<PwshStatus> {
    if (this.run && !refresh) return this.run;
    if (!this.applicable || this.forced) {
      this.last = { applicable: this.applicable, found: false, missing: this.forced, ...(this.forced ? { forced: true } : {}), checkedAt: Date.now() };
      return (this.run = Promise.resolve(this.last));
    }
    const t0 = Date.now();
    const locating = findPwsh(this.d).catch((e) => {
      log.warn("PowerShell detection failed", { err: String((e as Error)?.message ?? e) });
      return undefined;
    });
    this.locating = locating;
    const run: Promise<PwshStatus> = locating.then(async (c) => {
      if (this.locating === locating) this.located = c;
      const version = c ? await readPwshVersion(c, this.d) : undefined;
      const st: PwshStatus = { applicable: true, found: !!c, missing: !c || Number(version?.split(".")[0]) < 7, path: c?.path, source: c?.source, version, checkedAt: Date.now() };
      if (this.run === run) this.last = st;
      log.info("PowerShell", { found: st.found, missing: st.missing, path: st.path, source: st.source, version: st.version, ms: Date.now() - t0 });
      return st;
    });
    this.run = run;
    return run;
  }

  /** 同步快照（/status、诊断）：没检测过就开始检测，先返回"检测中" */
  snapshot(): PwshStatus {
    if (!this.run) void this.check();
    return this.last ?? { applicable: this.applicable, checking: true, found: false, missing: false, checkedAt: 0 };
  }

  /**
   * DSH 启动前调用：要写进补丁的 pwshPath。只等文件检测（不等版本号），最多 waitMs；
   * 不是 Windows、模拟"未安装"或没找到时返回 undefined（DSH 自己找）。
   */
  async dshPath(waitMs = 3000): Promise<string | undefined> {
    if (this.platform !== "win32" || this.forced) return undefined;
    if (!this.run) void this.check();
    let timer: NodeJS.Timeout | undefined;
    const c = await Promise.race([this.locating!, new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), waitMs)))]);
    clearTimeout(timer);
    return c?.path;
  }

  /** 最近一次检测到的 DSH 路径（同步）：变了就在代理进程空闲时重启它 */
  get cachedDshPath(): string | undefined {
    return this.platform !== "win32" || this.forced ? undefined : this.located?.path;
  }
}

/** 进程内共用的一个：宿主、诊断、/status、界面接口都读它 */
export const pwshProbe = new PwshProbe();

/** DSH 补丁：Windows 上的 pwsh 执行器（pwsh-sandbox；基础 profile 里它没有 config）用检测到的这一个 */
export function pwshPatchLines(pwshPath: string | undefined): string[] {
  return pwshPath ? ["- id: pwsh-sandbox", "  config:", `    pwshPath: ${JSON.stringify(pwshPath)}`] : [];
}

const SOURCE: Record<PwshSource, MessageKey> = { "program-files": "pwsh.sourceProgramFiles", path: "pwsh.sourcePath", preview: "pwsh.sourcePreview", store: "pwsh.sourceStore" };

/** 聊天里 /status 的一行（只在 Windows 上有；按当前语言，读的时候才拼） */
export function pwshStatusLine(st: PwshStatus): string {
  if (!st.applicable) return "";
  if (st.checking) return t("pwsh.statusChecking");
  if (!st.missing) return t("pwsh.statusOk", { version: st.version ?? "7" });
  const now = st.found && st.version ? t("pwsh.statusOld", { version: st.version }) : t("pwsh.statusNone");
  return t("pwsh.statusAdvice", { now, winget: PWSH_WINGET, url: PWSH_INSTALL_URL });
}

/** 诊断报告里的一行（只在 Windows 上有） */
export function pwshReportLine(st: PwshStatus): string | undefined {
  if (!st.applicable) return undefined;
  if (st.checking) return t("pwsh.reportChecking");
  const source = st.source && SOURCE[st.source] ? t(SOURCE[st.source]) : st.source;
  const where = st.path ? t("pwsh.reportWhere", { path: st.path, source }) : "";
  if (!st.missing) return t("pwsh.reportOk", { version: st.version ?? t("pwsh.reportUnknownVersion"), where });
  if (st.found) return t("pwsh.reportOld", { version: st.version ?? "?", where });
  return t("pwsh.reportNone", { forced: st.forced ? t("pwsh.reportForced") : "" });
}
