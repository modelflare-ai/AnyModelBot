/**
 * 极简日志：统一脱敏，任何密钥/令牌都不会原样写进日志。
 * 输出到 stdout/stderr，并在 initFileLog() 之后同时写入 <dataDir>/logs/app.log（按大小轮转，保留几个旧文件）。
 * 打包后的 Windows/macOS 桌面版看不到 stdout，日志文件是唯一的现场记录（设置 → 故障排查 里可看最近几百行）。
 */
import fs from "node:fs";
import path from "node:path";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.AMB_LOG_LEVEL as Level) || "info";

const SECRET_KEYS = /(secret|token|password|api[_-]?key|authorization|cookie|aeskey|bot_token|context_token|key)$/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]{6,})/g;
/** URL 参数里的令牌（magpie 的启动链接带 ?k=<web key>，界面入口带 ?token=） */
const SECRET_PARAM = /([?&](?:token|k|key|api[_-]?key|access_token)=)[^&\s"'<>]+/gi;
/** JSON 文本里的密钥字段（例如上游错误体回显了请求） */
const SECRET_JSON = /("(?:api[_-]?key|apiKey|token|secret|password|authorization|key)"\s*:\s*")[^"]*(")/gi;

/** 运行时已知的密钥原文（界面令牌、bridge 令牌、网关密钥、上游 API Key…）：出现在任何日志里都替换成 *** */
const known = new Set<string>();
let knownSorted: string[] = [];

export function registerSecret(value: string | undefined | null): void {
  const v = String(value ?? "").trim();
  if (v.length < 6 || known.has(v)) return;
  known.add(v);
  knownSorted = [...known].sort((a, b) => b.length - a.length);
}

export function setLogLevel(level: Level): void {
  threshold = level;
}

/** 文本脱敏：已登记的密钥原文、sk-…/Bearer …、URL 里的 token 参数、JSON 里的密钥字段。 */
export function redactText(s: string): string {
  let out = s;
  for (const v of knownSorted) if (out.includes(v)) out = out.split(v).join("***");
  return out
    .replace(SECRET_VALUE, (m) => m.slice(0, 4) + "***")
    .replace(SECRET_PARAM, "$1***")
    .replace(SECRET_JSON, "$1***$2");
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return redactText(value);
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

// ---------- 文件输出（按大小轮转） ----------
interface FileSink {
  dir: string;
  file: string;
  fd: number;
  size: number;
  maxBytes: number;
  /** 总文件数（app.log + app.1.log … app.<files-1>.log） */
  files: number;
}
let sink: FileSink | undefined;

export const LOG_FILE = "app.log";
const rotated = (dir: string, i: number) => path.join(dir, i === 0 ? LOG_FILE : `app.${i}.log`);

/**
 * 打开 <dir>/app.log（追加）。同一目录重复调用不做事；换目录时关掉旧文件。
 * 默认单文件 3 MB、共 4 个文件。失败时只写控制台，不影响程序。
 */
export function initFileLog(dir: string, opts: { maxBytes?: number; files?: number } = {}): string | undefined {
  const abs = path.resolve(dir);
  if (sink?.dir === abs) return sink.file;
  closeFileLog();
  try {
    fs.mkdirSync(abs, { recursive: true });
    const file = path.join(abs, LOG_FILE);
    const fd = fs.openSync(file, "a", 0o600);
    sink = { dir: abs, file, fd, size: fs.fstatSync(fd).size, maxBytes: opts.maxBytes ?? 3 * 1024 * 1024, files: Math.max(2, opts.files ?? 4) };
    return file;
  } catch (e) {
    writeConsole(process.stderr, `log: cannot open log file in ${abs}: ${(e as Error).message}\n`);
    sink = undefined;
    return undefined;
  }
}

export function closeFileLog(): void {
  if (!sink) return;
  try {
    fs.closeSync(sink.fd);
  } catch {
    /* ignore */
  }
  sink = undefined;
}

export function logFilePath(): string | undefined {
  return sink?.file;
}

function rotate(s: FileSink): void {
  fs.closeSync(s.fd);
  try {
    fs.rmSync(rotated(s.dir, s.files - 1), { force: true });
    for (let i = s.files - 2; i >= 0; i--) {
      const from = rotated(s.dir, i);
      if (fs.existsSync(from)) fs.renameSync(from, rotated(s.dir, i + 1));
    }
  } catch {
    // Windows 上杀毒软件或别的进程正开着旧文件时改名会失败：这次不轮转，继续写当前文件
  }
  s.fd = fs.openSync(s.file, "a", 0o600);
  s.size = fs.fstatSync(s.fd).size > s.maxBytes ? 0 : fs.fstatSync(s.fd).size;
}

function writeFile(line: string): void {
  const s = sink;
  if (!s) return;
  try {
    const buf = Buffer.from(line, "utf8");
    if (s.size > 0 && s.size + buf.length > s.maxBytes) rotate(s);
    fs.writeSync(s.fd, buf);
    s.size += buf.length;
  } catch (e) {
    sink = undefined;
    writeConsole(process.stderr, `log: writing ${s.file} failed, file logging disabled: ${(e as Error).message}\n`);
  }
}

/** 最近 n 行（从当前文件往旧文件读，已脱敏）。 */
export function readLogTail(n = 200, dir = sink?.dir): string[] {
  if (!dir) return [];
  const out: string[] = [];
  for (let i = 0; i < 10 && out.length < n; i++) {
    const f = rotated(dir, i);
    let text: string;
    try {
      const st = fs.statSync(f);
      const want = Math.min(st.size, 512 * 1024);
      const fd = fs.openSync(f, "r");
      try {
        const buf = Buffer.alloc(want);
        fs.readSync(fd, buf, 0, want, st.size - want);
        text = buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
      if (want < st.size) text = text.slice(text.indexOf("\n") + 1); // 去掉被截断的第一行
    } catch {
      break;
    }
    const lines = text.split(/\r?\n/).filter((l) => l.length);
    out.unshift(...lines.slice(-(n - out.length)));
  }
  return out.map(redactText);
}

// ---------- 控制台输出：永远不能把异常抛回调用方 ----------
// Windows 上 GUI 程序的 stdout/stderr 要么不存在，要么是别人建的管道（例如 PowerShell 的 *> 重定向）：
// 管道读端关了，写入就是 EPIPE（未处理的 'error' 事件 = 未捕获异常，Electron 会弹出阻塞主进程的错误框）；
// 读端不读，Windows 上的同步管道写入会卡住整个主进程。所以：stdio 出错一次就不再写控制台，
// 桌面版在 Windows 上默认只写日志文件（electron/main.ts 调 setConsoleLog(false)）。
let consoleOn = process.env.AMB_LOG_STDOUT !== "0";
const brokenStdio = new Set<NodeJS.WriteStream>();
function guardStdio(stream: NodeJS.WriteStream | undefined): void {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("error", () => {
    // EPIPE / EBADF / EOF：读端没了。之后不再写这个流（日志文件不受影响）
    brokenStdio.add(stream);
  });
}
guardStdio(process.stdout);
guardStdio(process.stderr);

/** 控制台输出开关（日志文件不受影响） */
export function setConsoleLog(on: boolean): void {
  consoleOn = on;
}

function writeConsole(stream: NodeJS.WriteStream, line: string): void {
  if (!consoleOn || brokenStdio.has(stream) || stream.destroyed || stream.writable === false) return;
  try {
    stream.write(line, () => {});
  } catch {
    brokenStdio.add(stream);
  }
}

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[threshold]) return;
  let line: string;
  try {
    const ts = new Date().toISOString();
    line = redactText(`${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${redactValue(msg)}` + (extra === undefined ? "" : " " + safeJson(redactValue(extra)))) + "\n";
  } catch {
    return;
  }
  // 先写文件：控制台不可用时日志照样留下
  writeFile(line);
  writeConsole(level === "error" || level === "warn" ? process.stderr : process.stdout, line);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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

/**
 * 子进程输出 → 日志：按行切分（保留跨块的半行），每行带作用域前缀并脱敏；onLine 拿到的是脱敏后的行。
 * 返回的函数直接接到 stream.on("data") 上；flush() 把最后半行也写出去。
 */
export function lineLogger(scope: string, level: Level = "info", onLine?: (line: string) => void): { push(chunk: Buffer | string): void; flush(): void } {
  const log = logger(scope);
  let buf = "";
  const one = (raw: string) => {
    const line = raw.replace(/\s+$/, "");
    if (!line) return;
    const safe = redactText(line).slice(0, 4000);
    onLine?.(safe);
    log[level](safe);
  };
  return {
    push(chunk) {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        one(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 16_000) {
        one(buf);
        buf = "";
      }
    },
    flush() {
      if (buf) one(buf);
      buf = "";
    },
  };
}
