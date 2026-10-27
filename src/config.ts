import fs from "node:fs";
import path from "node:path";

/**
 * 配置：<dataDir>/config.json + 环境变量（环境变量优先）。
 * 机器人/渠道凭据存在 SQLite 中，由 UI 或 `npm run init` 写入。
 */
export interface AppConfig {
  dataDir: string;
  ui: { host: string; port: number; token: string };
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
}

export function defaultDataDir(): string {
  return process.env.AMB_DATA_DIR ? path.resolve(process.env.AMB_DATA_DIR) : path.resolve(process.cwd(), "data");
}

function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
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
  };
}
