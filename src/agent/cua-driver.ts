import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "../i18n/index.js";

/**
 * Cua Driver（trycua/cua libs/cua-driver，MIT）：默认的电脑操作后端，三个平台都用官方预编译的
 * cua-driver 二进制（构建时按固定版本下载并校验 SHA256，见 scripts/fetch-cua-driver.mjs）。
 * 以 `cua-driver mcp` 作为 DSH 内置 MCP 服务器运行，始终是 bounded 模式 + 我们生成的能力清单；
 * 中间隔一层 dsh-runtime/plugins/amb-cua-mcp.mjs，只暴露下面审核过的工具。
 * 不随附 cua-perception / OmniParser（AGPL）或 Cua Spaces（FSL）的任何东西。
 */
export const CUA_VERSION = "0.37.0";

/** 只读取界面（含截图）的工具 */
export const CUA_READ_TOOLS = [
  "list_apps",
  "list_windows",
  "get_window_state",
  "get_desktop_state",
  "get_screen_size",
  "get_cursor_position",
  "zoom",
  "verify_state",
  "check_permissions",
];
/** 会改变界面的输入工具（ask-input 模式下逐个审批） */
export const CUA_INPUT_TOOLS = [
  "launch_app",
  "bring_to_front",
  "click",
  "double_click",
  "right_click",
  "type_text",
  "press_key",
  "hotkey",
  "scroll",
  "drag",
  "set_value",
  "invoke_menu",
  "move_cursor",
  "set_window_frame",
  "run_steps",
];
/**
 * 明确不开放：browser_*（另需独立运行时）、剪贴板、kill_app、run_script、录制/回放、
 * parse_visual_regions（感知/视觉模型）、安装扩展/ffmpeg、检查更新、读写配置、会话提权等。
 */
export const CUA_TOOLS = [...CUA_READ_TOOLS, ...CUA_INPUT_TOOLS];

export interface CuaProbe {
  platform: NodeJS.Platform;
  arch: string;
  env: Record<string, string | undefined>;
  homedir: string;
  isFile(p: string): boolean;
  /** Windows：当前进程 SessionId；测试可注入。未设置时在 win32 上查询。null 表示查询失败。 */
  windowsSessionId?: number | null;
}

export interface CuaStatus {
  available: boolean;
  /** 给界面与 /status 的说明（检测时的当前语言；每次读状态都重新检测） */
  reason: string;
  /** 平台提示（权限、Wayland 降级等） */
  notice?: string;
  bin?: string;
  /** macOS：用 --direct 让授权归属到本应用（未在真机验证） */
  direct?: boolean;
}

export function defaultCuaProbe(): CuaProbe {
  return {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    homedir: os.homedir(),
    isFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
}

/** electron-builder 的 ${os}-${arch} 目录名，例如 linux-x64、darwin-arm64、win32-x64 */
export function platKey(platform: string, arch: string): string {
  return `${platform}-${arch}`;
}

/** 二进制所在目录候选：打包后是 resources/cua-driver，开发时是 build/cua-driver/<plat-arch> */
export function cuaRoots(runtimeDir: string, platform = process.platform, arch = process.arch): string[] {
  const up = path.dirname(path.resolve(runtimeDir));
  const res = (process as any).resourcesPath as string | undefined;
  return [
    process.env.AMB_CUA_DRIVER_DIR,
    res ? path.join(res, "cua-driver") : undefined,
    path.join(up, "cua-driver"),
    path.join(up, "build", "cua-driver", platKey(platform, arch)),
  ].filter((x): x is string => !!x);
}

export function detectCua(roots: string[], probe: CuaProbe = defaultCuaProbe()): CuaStatus {
  const off = (why: string): CuaStatus => ({ available: false, reason: t("cu.cuaOff", { why }) });
  if (!["linux", "darwin", "win32"].includes(probe.platform)) return off(t("cu.cuaUnsupported", { platform: probe.platform }));
  const exe = probe.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const root = roots.find((r) => probe.isFile(path.join(r, exe)));
  if (!root) return off(t("cu.cuaMissing", { plat: `${probe.platform}-${probe.arch}`, version: CUA_VERSION }));
  const bin = path.join(root, exe);
  const env = probe.env;
  if (probe.platform === "linux") {
    const x11 = !!env.DISPLAY;
    const wayland = !!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland";
    if (!x11 && !wayland) return off(t("cu.cuaNoDisplay"));
    const notice = t(wayland ? "cu.cuaWayland" : "cu.cuaX11", { atspi: t("cu.cuaAtspi") });
    return { available: true, reason: t("cu.cuaAvailable", { os: "Linux" }), notice, bin };
  }
  if (probe.platform === "darwin") {
    return {
      available: true,
      reason: t("cu.cuaAvailable", { os: "macOS" }),
      notice: t("cu.cuaMacNotice"),
      bin,
      direct: true,
    };
  }
  // Windows：服务 / 会话 0 里没有可操作的桌面。GUI/Electron 常不设 SESSIONNAME，不能单靠它判断。
  if (env.SESSIONNAME) {
    return {
      available: true,
      reason: t("cu.cuaAvailable", { os: "Windows" }),
      notice: t("cu.cuaWinNotice"),
      bin,
    };
  }
  let sid = probe.windowsSessionId;
  if (sid === undefined) {
    // 仅在真实 Windows 进程上查询；交叉平台单测不注入时走下方启发式，避免误起 PowerShell。
    sid = process.platform === "win32" ? (queryWindowsSessionId() ?? null) : null;
  }
  if (sid === 0) return off(t("cu.cuaNonInteractive"));
  if (typeof sid === "number" && sid > 0) {
    return {
      available: true,
      reason: t("cu.cuaAvailable", { os: "Windows" }),
      notice: t("cu.cuaWinNotice"),
      bin,
    };
  }
  // 查不到 SessionId 时：宁可在像正常用户桌面的环境里判可用，也不要因缺 SESSIONNAME 误报不可用。
  if (looksLikeWindowsUserDesktop(env)) {
    return {
      available: true,
      reason: t("cu.cuaAvailable", { os: "Windows" }),
      notice: t("cu.cuaWinNotice"),
      bin,
    };
  }
  return off(t("cu.cuaNonInteractive"));
}

/** 进程的 SessionId 不会变：只查一次（每次查都要同步起一个 PowerShell，冷启动时会卡住主进程好几秒）。 */
let sessionIdCache: { v: number | undefined } | undefined;

/** Windows：当前进程的 SessionId（交互式用户会话 > 0；服务/Session 0 = 0）。失败返回 undefined。 */
export function queryWindowsSessionId(): number | undefined {
  sessionIdCache ??= { v: querySessionIdOnce() };
  return sessionIdCache.v;
}

function querySessionIdOnce(): number | undefined {
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process -Id $PID).SessionId"],
      // stdio 显式：execFileSync 默认把子进程 stderr 转写到本进程 stderr（GUI 程序里可能是坏管道）
      { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const n = Number(out);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** USERPROFILE 像 C:\Users\... 且带 SystemRoot 时，视为正常用户桌面（排除 systemprofile）。 */
export function looksLikeWindowsUserDesktop(env: Record<string, string | undefined>): boolean {
  const profile = env.USERPROFILE || "";
  const root = env.SystemRoot || env.WINDIR || "";
  return !!root && /\\Users\\/i.test(profile) && !/systemprofile/i.test(profile);
}

export type CuaApp = { executable: string } | { bundle_id: string };

/** Linux：从 .desktop 文件的 Exec= 解析可执行文件的规范绝对路径（清单只接受这种身份）。 */
export function linuxDesktopApps(env: Record<string, string | undefined>, homedir: string, fsx: Pick<typeof fs, "readdirSync" | "readFileSync" | "realpathSync" | "existsSync"> = fs): CuaApp[] {
  const dataDirs = [path.join(env.XDG_DATA_HOME || path.join(homedir, ".local", "share")), ...(env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":")];
  const pathDirs = (env.PATH || "/usr/local/bin:/usr/bin:/bin").split(":").filter(Boolean);
  const out = new Set<string>();
  const resolve = (cmd: string): string | undefined => {
    const cand = cmd.includes("/") ? [cmd] : pathDirs.map((d) => path.join(d, cmd));
    for (const c of cand) {
      try {
        if (fsx.existsSync(c)) return fsx.realpathSync(c);
      } catch {
        /* 下一个 */
      }
    }
    return undefined;
  };
  for (const d of dataDirs) {
    const dir = path.join(d, "applications");
    let names: string[] = [];
    try {
      names = fsx.readdirSync(dir) as unknown as string[];
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".desktop")) continue;
      let text = "";
      try {
        text = String(fsx.readFileSync(path.join(dir, n), "utf8"));
      } catch {
        continue;
      }
      const entry = text.split(/\n\[/)[0];
      if (/^NoDisplay=true/m.test(entry) || /^Hidden=true/m.test(entry)) continue;
      const exec = /^Exec=(.*)$/m.exec(entry)?.[1];
      if (!exec) continue;
      const toks = exec.trim().replace(/^"([^"]+)"/, "$1").split(/\s+/);
      let i = 0;
      if (toks[0] === "env" || toks[0]?.endsWith("/env")) {
        i = 1;
        while (toks[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
      }
      const cmd = toks[i];
      if (!cmd || /^(flatpak|snap|sh|bash)$/.test(path.basename(cmd))) continue;
      const real = resolve(cmd);
      if (real) out.add(real);
    }
  }
  return [...out].sort().map((executable) => ({ executable }));
}

/** macOS：/Applications 等目录下 .app 的 CFBundleIdentifier（未在真机验证）。 */
export function macApps(homedir: string): CuaApp[] {
  const dirs = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", path.join(homedir, "Applications")];
  const out = new Set<string>();
  for (const d of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".app")) continue;
      const plist = path.join(d, n, "Contents", "Info.plist");
      let id = "";
      try {
        const raw = fs.readFileSync(plist);
        if (raw.subarray(0, 6).toString() === "bplist") {
          id = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
        } else {
          id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(raw.toString("utf8"))?.[1]?.trim() ?? "";
        }
      } catch {
        continue;
      }
      if (id) out.add(id);
    }
  }
  return [...out].sort().map((bundle_id) => ({ bundle_id }));
}

const WIN_SHORTCUTS_PS =
  "$s=New-Object -ComObject WScript.Shell;" +
  "$d=@([Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('StartMenu'));" +
  "Get-ChildItem -Path $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue|ForEach-Object{try{$s.CreateShortcut($_.FullName).TargetPath}catch{}}";

/** 真实路径（Windows 上 realpath.native 给出盘上的大小写与长文件名）；失败时原样返回。 */
function canonicalPath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/**
 * 按"身份"去重：Windows 路径不分大小写。cua-driver 的能力清单里同一个程序出现两次（例如系统自带的
 * C:\Windows\System32\notepad.exe 和开始菜单快捷方式指向的 C:\WINDOWS\system32\notepad.exe）时，
 * `cua-driver mcp` 会以 "application resources repeat an identity" 拒绝启动——v0.1.5 在 Windows 上
 * 就是这样陷入 MCP 重连循环、不停弹出控制台窗口的。
 */
export function uniqueApps(apps: CuaApp[], platform: NodeJS.Platform = process.platform): CuaApp[] {
  const seen = new Set<string>();
  const out: CuaApp[] = [];
  for (const a of apps) {
    const key = "executable" in a ? `x:${platform === "win32" || platform === "darwin" ? a.executable.toLowerCase() : a.executable}` : `b:${a.bundle_id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Windows：几个系统自带程序 + PowerShell 列出的开始菜单快捷方式目标（只留存在的 .exe，按路径不分大小写去重）。 */
export function windowsAppsFrom(
  env: Record<string, string | undefined>,
  shortcutTargets: string,
  exists: (p: string) => boolean = fs.existsSync,
  canon: (p: string) => string = canonicalPath,
): CuaApp[] {
  const found: string[] = [];
  const win = env.SystemRoot || env.WINDIR || "C:\\Windows";
  for (const p of ["notepad.exe", "mspaint.exe", "write.exe", "explorer.exe"].map((x) => (x === "explorer.exe" ? path.win32.join(win, x) : path.win32.join(win, "System32", x)))) {
    if (exists(p)) found.push(canon(p));
  }
  for (const line of shortcutTargets.split(/\r?\n/)) {
    const p = line.trim();
    if (/\.exe$/i.test(p) && exists(p)) found.push(canon(p));
  }
  const apps = found.sort((a, b) => a.localeCompare(b)).map((executable) => ({ executable }));
  return uniqueApps(apps, "win32");
}

/** Windows：开始菜单快捷方式指向的 .exe + 几个系统自带程序（未在真机验证）。异步，不阻塞主进程。 */
export async function windowsApps(env: Record<string, string | undefined>): Promise<CuaApp[]> {
  const text = await new Promise<string>((resolve) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_SHORTCUTS_PS], { encoding: "utf8", timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? "" : String(stdout)), // PowerShell 不可用时只用系统程序
    ),
  );
  return windowsAppsFrom(env, text);
}

export async function discoverApps(platform: NodeJS.Platform = process.platform, env = process.env, homedir = os.homedir()): Promise<CuaApp[]> {
  const self = platform === "win32" ? process.execPath.toLowerCase() : process.execPath;
  const apps = platform === "linux" ? linuxDesktopApps(env, homedir) : platform === "darwin" ? macApps(homedir) : platform === "win32" ? await windowsApps(env) : [];
  return uniqueApps(apps, platform)
    .filter((a) => !("executable" in a) || (platform === "win32" ? a.executable.toLowerCase() : a.executable) !== self)
    .slice(0, 800);
}

let appsCache: { at: number; apps: Promise<CuaApp[]> } | undefined;
/** 已安装应用清单（10 分钟内复用）：每次重启代理进程都重扫一遍开始菜单太慢。 */
export function discoverAppsCached(ttlMs = 10 * 60_000): Promise<CuaApp[]> {
  if (!appsCache || Date.now() - appsCache.at > ttlMs) {
    const apps = discoverApps().catch(() => [] as CuaApp[]);
    appsCache = { at: Date.now(), apps };
  }
  return appsCache.apps;
}

export interface CuaConfig {
  bin: string;
  manifest: string;
  tools: string[];
  apps: CuaApp[];
  display: boolean;
  direct: boolean;
}

/** 给 amb-cua-mcp.mjs 的配置。readonly 预设下只开放读取工具。 */
export function cuaConfig(st: CuaStatus, dir: string, opts: { readonly: boolean; apps: CuaApp[] }): CuaConfig {
  return {
    bin: st.bin!,
    manifest: path.join(dir, "manifest.yaml"),
    tools: opts.readonly ? [...CUA_READ_TOOLS] : [...CUA_TOOLS],
    apps: opts.apps,
    // 允许整屏截图与屏幕坐标输入（list_windows 也需要）
    display: true,
    direct: !!st.direct,
  };
}

/**
 * 图形会话相关的环境变量（DSH 子进程的环境里没有这些，需要显式传给 MCP 子进程）。不含任何密钥。
 * 代理与证书不用在这里传：DSH 的 MCP 客户端把它自己的环境（去掉密钥样的变量）并在这些前面，代理变量已经在里面（host.ts env()）。
 */
export const CUA_PASS_ENV = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "DBUS_SESSION_BUS_ADDRESS",
  "XAUTHORITY",
  "SESSIONNAME",
  "SystemRoot",
  "WINDIR",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "TMPDIR",
  "TEMP",
  "TMP",
];

export function cuaMcpEnv(parent: Record<string, string | undefined>, home: string, configFile: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of CUA_PASS_ENV) {
    const v = parent[k];
    if (v && !/KEY|PASSWORD|SECRET|TOKEN/i.test(k)) env[k] = v;
  }
  // 真实用户主目录：cua-driver 启动的应用会继承它（DSH 子进程的 HOME 是机器人自己的目录）
  env.HOME = home;
  env.AMB_CUA_CONFIG = configFile;
  env.DO_NOT_TRACK = "1";
  env.CUA_TELEMETRY_ENABLED = "0";
  env.CUA_DRIVER_RS_TELEMETRY_ENABLED = "0";
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}
