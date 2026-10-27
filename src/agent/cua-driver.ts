import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
}

export interface CuaStatus {
  available: boolean;
  /** 给界面与 /status 的说明（中文） */
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

const LINUX_ATSPI = "需要 AT-SPI（at-spi2-core）才能读取窗口元素";

export function detectCua(roots: string[], probe: CuaProbe = defaultCuaProbe()): CuaStatus {
  const off = (why: string): CuaStatus => ({ available: false, reason: `Cua Driver: 不可用（${why}）` });
  if (!["linux", "darwin", "win32"].includes(probe.platform)) return off(`不支持 ${probe.platform}`);
  const exe = probe.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const root = roots.find((r) => probe.isFile(path.join(r, exe)));
  if (!root) return off(`安装包缺少 ${probe.platform}-${probe.arch} 的 cua-driver ${CUA_VERSION}`);
  const bin = path.join(root, exe);
  const env = probe.env;
  if (probe.platform === "linux") {
    const x11 = !!env.DISPLAY;
    const wayland = !!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland";
    if (!x11 && !wayland) return off("没有图形会话：DISPLAY / WAYLAND_DISPLAY 均未设置");
    const notice = wayland
      ? `Wayland 会话：功能降级——窗口读取依赖 AT-SPI，键鼠输入走 XWayland，只能操作前台窗口；${LINUX_ATSPI}`
      : `X11 会话；${LINUX_ATSPI}`;
    return { available: true, reason: "Cua Driver: 可用（Linux）", notice, bin };
  }
  if (probe.platform === "darwin") {
    return {
      available: true,
      reason: "Cua Driver: 可用（macOS）",
      notice:
        "首次使用需在「系统设置 → 隐私与安全性」给本应用打开「辅助功能」和「屏幕录制」。以 --direct 模式运行，授权应归属本应用（尚未在真机验证）。",
      bin,
      direct: true,
    };
  }
  // Windows：服务 / 会话 0 里没有可操作的桌面
  if (!env.SESSIONNAME) return off("需要在已登录用户的交互式会话中运行（检测到服务或非交互会话）");
  return { available: true, reason: "Cua Driver: 可用（Windows）", notice: "需在已登录用户的交互式桌面会话中运行；无法操作以管理员权限运行的窗口（除非本应用也以管理员运行）。", bin };
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
          id = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], { encoding: "utf8", timeout: 5000 }).trim();
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

/** Windows：开始菜单快捷方式指向的 .exe + 几个系统自带程序（未在真机验证）。 */
export function windowsApps(env: Record<string, string | undefined>): CuaApp[] {
  const out = new Set<string>();
  const win = env.SystemRoot || env.WINDIR || "C:\\Windows";
  for (const p of ["notepad.exe", "mspaint.exe", "write.exe", "explorer.exe"].map((x) => (x === "explorer.exe" ? path.win32.join(win, x) : path.win32.join(win, "System32", x)))) {
    if (fs.existsSync(p)) out.add(p);
  }
  try {
    const ps =
      "$s=New-Object -ComObject WScript.Shell;" +
      "$d=@([Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('StartMenu'));" +
      "Get-ChildItem -Path $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue|ForEach-Object{try{$s.CreateShortcut($_.FullName).TargetPath}catch{}}";
    const text = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 20000, windowsHide: true });
    for (const line of text.split(/\r?\n/)) {
      const p = line.trim();
      if (/\.exe$/i.test(p) && fs.existsSync(p)) out.add(p);
    }
  } catch {
    /* PowerShell 不可用时只用系统程序 */
  }
  return [...out].sort().map((executable) => ({ executable }));
}

export function discoverApps(platform: NodeJS.Platform = process.platform, env = process.env, homedir = os.homedir()): CuaApp[] {
  const self = process.execPath;
  const apps = platform === "linux" ? linuxDesktopApps(env, homedir) : platform === "darwin" ? macApps(homedir) : platform === "win32" ? windowsApps(env) : [];
  return apps.filter((a) => !("executable" in a) || a.executable !== self).slice(0, 800);
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

/** 图形会话相关的环境变量（DSH 子进程的环境里没有这些，需要显式传给 MCP 子进程）。不含任何密钥。 */
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
