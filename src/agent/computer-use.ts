import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 电脑操作（Computer Use）：随附 songkeys/kimi-computer-use（MIT）的 stdio MCP 桥，
 * 它把本机已安装的 OpenAI「Codex Computer Use」服务暴露成 MCP 工具。仅 macOS 14.4+ 可用，
 * 且需要用户自己安装 Codex Computer Use；否则整项功能关闭并在界面给出原因。
 */
export const CU_SERVER = "computer-use";
export const CU_TOOL_PREFIX = `mcp__${CU_SERVER}__`;
/** 只读取界面、不改变任何东西的工具（设置为 readonly-free 时免审批） */
export const CU_READONLY_TOOLS = ["list_apps", "get_app_state"];
export const CU_UNAVAILABLE = "Computer Use: 需要 macOS 14.4+ 和已安装的 Codex Computer Use";

export interface CuProbe {
  platform: NodeJS.Platform;
  /** os.release()（Darwin 内核版本，23.4 = macOS 14.4） */
  release: string;
  env: Record<string, string | undefined>;
  homedir: string;
  isExecutable(p: string): boolean;
  isFile(p: string): boolean;
}

export interface CuStatus {
  available: boolean;
  /** 给界面的说明（中文） */
  reason: string;
  client?: string;
  launcher?: string;
  bridge?: string;
  skill?: string;
  codexHome?: string;
  homedir?: string;
}

export function defaultProbe(): CuProbe {
  return {
    platform: process.platform,
    release: os.release(),
    env: process.env,
    homedir: os.homedir(),
    isExecutable: (p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    isFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
}

/** 与上游桥相同的路径约定：$CODEX_HOME 或 ~/.codex 下的 SkyComputerUseClient。 */
export function clientPath(env: Record<string, string | undefined>, homedir: string): { codexHome: string; client: string } {
  const override = env.COMPUTER_USE_CLIENT_PATH?.trim();
  const codexHome = env.CODEX_HOME?.trim() || path.join(homedir, ".codex");
  const client = override
    ? path.resolve(override)
    : path.join(codexHome, "computer-use", "Codex Computer Use.app", "Contents", "SharedSupport", "SkyComputerUseClient.app", "Contents", "MacOS", "SkyComputerUseClient");
  return { codexHome, client };
}

export function launcherCandidates(env: Record<string, string | undefined>): string[] {
  return [env.COMPUTER_USE_CODEX_LAUNCHER_PATH?.trim(), "/Applications/ChatGPT.app/Contents/Resources/codex", "/Applications/Codex.app/Contents/Resources/codex"].filter(
    (x): x is string => !!x,
  );
}

/** Darwin 内核版本 → 是否 ≥ macOS 14.4（Darwin 23.4）。 */
export function macAtLeast144(release: string): boolean {
  const [maj, min] = release.split(".").map((n) => Number(n) || 0);
  return maj > 23 || (maj === 23 && min >= 4);
}

/**
 * 随附的桥目录。runtimeDir 在打包后是 resources/dsh（桥在 resources/kimi-computer-use），
 * 开发时是 app/dsh-runtime（桥在 app/vendor/kimi-computer-use 子模块）。
 */
export function bundledRoots(runtimeDir: string): string[] {
  const up = path.dirname(path.resolve(runtimeDir));
  const res = (process as any).resourcesPath as string | undefined;
  return [
    process.env.AMB_COMPUTER_USE_DIR,
    res ? path.join(res, "kimi-computer-use") : undefined,
    path.join(up, "kimi-computer-use"),
    path.join(up, "vendor", "kimi-computer-use"),
  ].filter((x): x is string => !!x);
}

export function detectComputerUse(roots: string[], probe: CuProbe = defaultProbe()): CuStatus {
  const off = (why: string): CuStatus => ({ available: false, reason: `${CU_UNAVAILABLE}（${why}）` });
  if (probe.platform !== "darwin") return off("当前系统不是 macOS");
  if (!macAtLeast144(probe.release)) return off("macOS 版本低于 14.4");
  const root = roots.find((r) => probe.isFile(path.join(r, "bin", "computer-use-mcp-bridge.mjs")));
  if (!root) return off("安装包缺少 kimi-computer-use 组件");
  const { codexHome, client } = clientPath(probe.env, probe.homedir);
  if (!probe.isExecutable(client)) return off("未找到 Codex Computer Use 客户端");
  const direct = probe.env.COMPUTER_USE_BRIDGE_DIRECT_LAUNCH === "1";
  const launcher = direct ? undefined : launcherCandidates(probe.env).find((p) => probe.isExecutable(p));
  if (!direct && !launcher) return off("未找到 ChatGPT/Codex 应用自带的 codex 启动器");
  return {
    available: true,
    reason: "Computer Use: 可用（操作 macOS 应用；默认每次操作需审批）",
    client,
    launcher,
    codexHome,
    homedir: probe.homedir,
    bridge: path.join(root, "bin", "computer-use-mcp-bridge.mjs"),
    skill: path.join(root, "skills", "computer-use", "SKILL.md"),
  };
}

/** 把上游 SKILL.md 改成我们的工具名并加上来源与审批说明。 */
export function adaptSkill(md: string): string {
  const body = md.replaceAll("mcp__plugin-kimi-computer-use_computer-use__", CU_TOOL_PREFIX).replace(
    /The bridge automatically handles the service's app-access elicitation\.[^\n]*\n[^\n]*\n[^\n]*\n/,
    "Each action may need the user's approval in chat before it runs; wait for it. Do not try to manage the OpenAI app's allowlist.\n",
  );
  const end = body.startsWith("---") ? body.indexOf("\n---", 3) : -1;
  const note = "\n<!-- Adapted from songkeys/kimi-computer-use skills/computer-use/SKILL.md (MIT, Copyright (c) 2026 Songkeys). -->\n";
  return end > 0 ? body.slice(0, end + 4) + note + body.slice(end + 4) : note + body;
}

/** 写给 DSH 的 mcp-client 配置（YAML 行，缩进到 insert 列表项）。 */
export function mcpPatchLines(st: CuStatus, nodePath: string, yamlStr: (s: string) => string): string[] {
  if (!st.available || !st.bridge) return [];
  // 只给桥需要的：真实 HOME（codex 启动器读 ~/.codex）与 CODEX_HOME；不含任何密钥。
  // DSH 的 mcp-client 会再并入已剔除 *KEY*/*TOKEN*/*SECRET*/*PASSWORD* 的父环境。
  const env: Record<string, string> = { HOME: st.homedir ?? "", CODEX_HOME: st.codexHome ?? "" };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return [
    "    - id: amb-computer-use",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        transport: stdio",
    `        serverName: ${CU_SERVER}`,
    `        command: ${yamlStr(nodePath)}`,
    `        args: [${yamlStr(st.bridge)}]`,
    "        env:",
    ...Object.entries(env).map(([k, v]) => `          ${k}: ${yamlStr(v)}`),
    "        toolCallTimeoutMs: 120000",
    "        failOnStartupError: false",
  ];
}
