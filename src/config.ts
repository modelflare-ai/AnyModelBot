import fs from "node:fs";
import path from "node:path";
import { normalizeLine, type ModelflareLine } from "./modelflare.js";

/**
 * 配置：<dataDir>/config.json + 环境变量（环境变量优先）。
 * 机器人/渠道凭据存在 SQLite 中，由 UI 或 `npm run init` 写入。
 */
export interface AppConfig {
  dataDir: string;
  ui: {
    host: string;
    port: number;
    token: string;
    /** 桌面版窗口缩放（1 = 100%） */
    zoom: number;
    /** 桌面版关闭窗口时：true 隐藏到托盘，false 退出 */
    closeToTray: boolean;
    /** Windows 上"建议安装 PowerShell 7"的提示点过"不再提示" */
    pwshHintDismissed: boolean;
  };
  /**
   * Modelflare 线路；密钥本身只存在内置 magpie 的隔离配置里。
   * lowBalanceUsd：余额低于它（美元）时提醒，0 = 不提醒；lowBalancePush：同时经机器人发到微信 / 飞书。
   */
  modelflare: { line: ModelflareLine; lowBalanceUsd: number; lowBalancePush: boolean };
  magpie: {
    /** managed：由本程序启动并守护内置 magpie；external：使用已有 OpenAI 兼容端点（测试/高级用法） */
    mode: "managed" | "external";
    binPath: string;
    externalBaseUrl: string;
    externalApiKey: string;
  };
  llm: { defaultModel: string; contextMessages: number; contextChars: number };
  feishu: { throttleMs: number };
  weixin: { apiBaseUrl: string };
  /** 代理宿主：dsh = DeepSeek Harness（工具/沙箱/审批）；off = 纯对话 */
  agent: { mode: "dsh" | "off"; turnTimeoutMs: number; approvalTtlMs: number };
}

export function defaultDataDir(): string {
  return process.env.AMB_DATA_DIR ? path.resolve(process.env.AMB_DATA_DIR) : path.resolve(process.cwd(), "data");
}

export const ZOOMS = [1, 1.1, 1.25, 1.5];

function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 低余额提醒线（美元）：0–1000，缺省 1 */
export function normalizeLowBalance(v: unknown): number {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) && n >= 0 && n <= 1000 ? n : 1;
}

export function loadConfig(overrides: { dataDir?: string; env?: NodeJS.ProcessEnv } = {}): AppConfig {
  const env = overrides.env ?? process.env;
  const dataDir = overrides.dataDir ?? (env.AMB_DATA_DIR ? path.resolve(env.AMB_DATA_DIR) : defaultDataDir());
  let file: Partial<AppConfig> & Record<string, any> = {};
  const p = path.join(dataDir, "config.json");
  if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    dataDir,
    ui: {
      host: env.AMB_UI_HOST || file.ui?.host || "127.0.0.1",
      port: num(env.AMB_UI_PORT, file.ui?.port ?? 3600),
      token: env.AMB_UI_TOKEN || file.ui?.token || "",
      zoom: ZOOMS.includes(Number(file.ui?.zoom)) ? Number(file.ui?.zoom) : 1,
      closeToTray: file.ui?.closeToTray !== false,
      pwshHintDismissed: file.ui?.pwshHintDismissed === true,
    },
    modelflare: {
      line: normalizeLine(file.modelflare?.line),
      lowBalanceUsd: normalizeLowBalance(file.modelflare?.lowBalanceUsd),
      lowBalancePush: file.modelflare?.lowBalancePush === true,
    },
    magpie: {
      mode: (env.AMB_MAGPIE_BASE_URL ? "external" : file.magpie?.mode) || "managed",
      binPath: env.AMB_MAGPIE_BIN || file.magpie?.binPath || "",
      externalBaseUrl: env.AMB_MAGPIE_BASE_URL || file.magpie?.externalBaseUrl || "",
      externalApiKey: env.AMB_MAGPIE_API_KEY || file.magpie?.externalApiKey || "",
    },
    llm: {
      defaultModel: env.AMB_DEFAULT_MODEL || file.llm?.defaultModel || "",
      contextMessages: num(env.AMB_CONTEXT_MESSAGES, file.llm?.contextMessages ?? 40),
      contextChars: num(env.AMB_CONTEXT_CHARS, file.llm?.contextChars ?? 24000),
    },
    feishu: { throttleMs: num(env.AMB_FEISHU_THROTTLE_MS, file.feishu?.throttleMs ?? 400) },
    weixin: { apiBaseUrl: env.AMB_WEIXIN_API_BASE || file.weixin?.apiBaseUrl || "https://ilinkai.weixin.qq.com" },
    agent: {
      mode: (env.AMB_AGENT || file.agent?.mode || "dsh") === "off" ? "off" : "dsh",
      turnTimeoutMs: num(env.AMB_AGENT_TURN_TIMEOUT_MS, file.agent?.turnTimeoutMs ?? 30 * 60_000),
      approvalTtlMs: num(env.AMB_APPROVAL_TTL_MS, file.agent?.approvalTtlMs ?? 10 * 60_000),
    },
  };
}

/**
 * 改写 <dataDir>/config.json 的部分字段（读-改-写，经临时文件改名，避免写到一半被读到）。
 * 只写调用方给出的键；环境变量覆盖的值不会被写回文件。
 */
export function saveConfigFile(dataDir: string, mutate: (file: Record<string, any>) => void): void {
  const p = path.join(dataDir, "config.json");
  let file: Record<string, any> = {};
  if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, "utf8"));
  mutate(file);
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, p);
}
