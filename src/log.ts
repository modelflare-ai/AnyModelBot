/** 极简日志：统一脱敏，任何密钥/令牌都不会原样写进日志。 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.AMB_LOG_LEVEL as Level) || "info";

const SECRET_KEYS = /(secret|token|password|api[_-]?key|authorization|cookie|aeskey|bot_token|context_token|key)$/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]{6,})/g;

export function setLogLevel(level: Level): void {
  threshold = level;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, (m) => m.slice(0, 4) + "***");
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && v ? "***" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** 只显示末 4 位，用于界面展示。 */
export function mask(secret: string | undefined | null): string {
  if (!secret) return "";
  return secret.length <= 4 ? "****" : "****" + secret.slice(-4);
}

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${redactValue(msg)}` +
    (extra === undefined ? "" : " " + JSON.stringify(redactValue(extra)));
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export function logger(scope: string): Logger {
  return {
    debug: (m, e) => emit("debug", scope, m, e),
    info: (m, e) => emit("info", scope, m, e),
    warn: (m, e) => emit("warn", scope, m, e),
    error: (m, e) => emit("error", scope, m, e),
  };
}
