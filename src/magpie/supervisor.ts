import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../log.js";
import { MODELFLARE_PROVIDER, keyTail } from "../modelflare.js";

const log = logger("magpie");

/**
 * 内置 magpie 守护进程：
 * - 独立 HOME / XDG_CONFIG_HOME（在本程序数据目录内），不读取用户已有的 Claude/Codex 等订阅凭据，
 *   不改写任何 agent 配置（gateway 模式 + 隔离 HOME 下没有可检测的 agent）；
 * - 关闭自动更新、账户发现、统计、handover；
 * - 空闲端口 + 自动生成的 web key / gateway key；
 * - 健康检查（/v1/models）、崩溃重启（指数退避）、优雅退出。
 */
export interface MagpieOptions {
  dataDir: string;
  binPath?: string;
  gatewayPort?: number;
  webPort?: number;
  healthTimeoutMs?: number;
}

export type MagpieState = "stopped" | "starting" | "running" | "restarting" | "failed";

interface Keys {
  webKey: string;
  gatewayKey: string;
  gatewayKeyRegistered?: boolean;
}

export function findAppRoot(start = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, "utf8")).name === "anymodel-bot") return dir;
      } catch {
        /* ignore */
      }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function magpieBinaryName(platform = process.platform, arch = process.arch): string {
  return `magpie-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

/** 查找 magpie 可执行文件：显式路径 → Electron resources → build/bin（按平台命名 / 通用名）。 */
export function resolveMagpieBinary(explicit?: string): string | undefined {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    explicit,
    process.env.AMB_MAGPIE_BIN,
    (process as any).resourcesPath ? path.join((process as any).resourcesPath, "magpie", `magpie${exe}`) : undefined,
    path.join(findAppRoot(), "build", "bin", magpieBinaryName()),
    path.join(findAppRoot(), "build", "bin", `magpie${exe}`),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function genKey(): string {
  return crypto.randomBytes(24).toString("base64url"); // [A-Za-z0-9-_]，满足 MAGPIE_WEB_KEY 要求
}

export class MagpieSupervisor {
  state: MagpieState = "stopped";
  lastError = "";
  restarts = 0;
  gatewayPort = 0;
  webPort = 0;
  readonly binPath: string | undefined;
  private child: ChildProcess | undefined;
  private stopping = false;
  private keys!: Keys;
  private readonly root: string;
  private restartTimer: NodeJS.Timeout | undefined;
  private logTail: string[] = [];

  constructor(private opts: MagpieOptions) {
    this.root = path.join(opts.dataDir, "magpie");
    this.binPath = resolveMagpieBinary(opts.binPath);
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.gatewayPort}/v1`;
  }
  get gatewayKey(): string {
    return this.keys?.gatewayKey ?? "";
  }
  get webKey(): string {
    return this.keys?.webKey ?? "";
  }
  get webOrigin(): string {
    return `http://127.0.0.1:${this.webPort}`;
  }
  get cookieName(): string {
    return `magpie_web_${this.webPort}`;
  }
  get recentLog(): string[] {
    return this.logTail.slice(-50);
  }

  /** magpie 子进程环境：完全隔离，不继承用户 HOME。 */
  env(): NodeJS.ProcessEnv {
    const home = path.join(this.root, "home");
    const cfg = path.join(this.root, "config");
    const keep = ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR"];
    const env: NodeJS.ProcessEnv = {};
    for (const k of keep) if (process.env[k]) env[k] = process.env[k];
    return {
      ...env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: cfg,
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      MAGPIE_NO_ACCOUNTS: "1",
      MAGPIE_NO_STATS: "1",
      MAGPIE_NO_HANDOVER: "1",
      DO_NOT_TRACK: "1",
      MAGPIE_UPDATE_FEED: "http://127.0.0.1:9/disabled",
      MAGPIE_WEB_KEY: this.keys.webKey,
      MAGPIE_ADDR: `127.0.0.1:${this.gatewayPort}`,
    };
  }

  private prepare(): void {
    const home = path.join(this.root, "home");
    const cfgDir = path.join(this.root, "config", "magpie");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
    // 预写设置：关闭自动更新与账户（订阅凭据）发现；保留 magpie 写入的其它字段
    const settingsPath = path.join(cfgDir, "settings.json");
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      /* new */
    }
    settings.noAutoUpdate = true;
    settings.noAccountDiscovery = true;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });

    const keysPath = path.join(this.root, "keys.json");
    try {
      this.keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    } catch {
      this.keys = { webKey: genKey(), gatewayKey: "amb-" + genKey() };
    }
    this.saveKeys();
  }

  private saveKeys(): void {
    fs.writeFileSync(path.join(this.root, "keys.json"), JSON.stringify(this.keys), { mode: 0o600 });
  }

  /** 运行一次 magpie CLI（同一隔离环境）。secret 通过 stdin 传入，不出现在命令行参数里。 */
  runCli(args: string[], stdin?: string, timeoutMs = 20_000): Promise<{ code: number; stdout: string; stderr: string }> {
    if (!this.binPath) return Promise.reject(new Error("找不到 magpie 可执行文件，请先运行 npm run setup"));
    if (!this.keys) this.prepare();
    return new Promise((resolve, reject) => {
      const p = spawn(this.binPath!, args, { env: this.env(), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
      p.on("close", (code) => {
        clearTimeout(t);
        resolve({ code: code ?? -1, stdout, stderr });
      });
      p.stdin.end(stdin ?? "");
    });
  }

  async start(): Promise<void> {
    if (!this.binPath) {
      this.state = "failed";
      this.lastError = "找不到 magpie 可执行文件（运行 npm run setup 从 vendor/magpie 构建）";
      throw new Error(this.lastError);
    }
    this.stopping = false;
    this.prepare();
    this.reapStale();
    this.gatewayPort ||= this.opts.gatewayPort || (await freePort());
    this.webPort ||= this.opts.webPort || (await freePort());
    if (!this.keys.gatewayKeyRegistered) {
      // 注册专用 gateway key（loopback 本可免 key，这里仍使用独立 key，便于将来开放局域网/Docker）
      const r = await this.runCli(["gateway-key", "add", "anymodel-bot", "--key", "-"], this.keys.gatewayKey);
      if (r.code === 0) {
        this.keys.gatewayKeyRegistered = true;
        this.saveKeys();
      } else log.warn("gateway-key add failed (loopback still works)", { stderr: r.stderr.slice(0, 200) });
    }
    await this.spawnOnce();
  }

  private async spawnOnce(): Promise<void> {
    this.state = this.restarts ? "restarting" : "starting";
    const args = ["web", "--addr", `127.0.0.1:${this.webPort}`, "--no-open", "--gateway"];
    const child = spawn(this.binPath!, args, { env: this.env(), stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    if (child.pid) fs.writeFileSync(this.pidFile, String(child.pid));
    const onLine = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        // magpie 打印的启动链接含 ?k=<web key>，记录前脱敏
        const safe = line.replaceAll(this.keys.webKey, "***").replaceAll(this.keys.gatewayKey, "***");
        this.logTail.push(safe);
        if (this.logTail.length > 200) this.logTail.shift();
        log.debug(safe);
      }
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.stopping) {
        this.state = "stopped";
        return;
      }
      this.lastError = `magpie exited (code=${code}, signal=${signal})`;
      log.warn(this.lastError);
      this.scheduleRestart();
    });
    try {
      await this.waitHealthy(this.opts.healthTimeoutMs ?? 20_000);
      this.state = "running";
      log.info(`magpie running: gateway 127.0.0.1:${this.gatewayPort}, web 127.0.0.1:${this.webPort}`);
    } catch (e) {
      this.lastError = (e as Error).message;
      if (this.child === child) child.kill("SIGKILL");
      throw e;
    }
  }

  private scheduleRestart(): void {
    this.restarts++;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.restarts, 6));
    this.state = "restarting";
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.spawnOnce().catch((e) => {
        log.error("magpie restart failed", { message: (e as Error).message });
        if (!this.stopping) this.scheduleRestart();
      });
    }, delay);
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.gatewayKey}` }, signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitHealthy(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error("magpie exited during startup: " + this.recentLog.slice(-3).join(" | "));
      if (await this.healthy()) {
        try {
          const r = await fetch(this.webOrigin + "/", { headers: { Cookie: `${this.cookieName}=${this.webKey}` }, signal: AbortSignal.timeout(2000) });
          if (r.ok) return;
        } catch {
          /* retry */
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("magpie health check timed out");
  }

  private get pidFile(): string {
    return path.join(this.root, "magpie.pid");
  }

  /** 上次本程序被强杀时可能残留 magpie 子进程：按 pid 文件确认是 magpie 后结束它（Linux/macOS） */
  private reapStale(): void {
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(this.pidFile, "utf8").trim());
    } catch {
      return;
    }
    if (!pid || pid === this.child?.pid) return;
    try {
      process.kill(pid, 0);
    } catch {
      return; // 已不存在
    }
    let cmd = "";
    try {
      if (process.platform === "linux") cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      else if (process.platform === "darwin") cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    } catch {
      return;
    }
    if (this.binPath && cmd.includes(path.basename(this.binPath)) && cmd.includes(" web ")) {
      log.warn(`结束残留的 magpie 进程 ${pid}`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }

  /** 测试用：模拟崩溃 */
  killForTest(): void {
    this.child?.kill("SIGKILL");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) {
      this.state = "stopped";
      return;
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    });
    this.child = undefined;
    this.state = "stopped";
  }

  // ---------- Modelflare（唯一的服务商；界面里不出现"服务商"概念） ----------
  /**
   * 连接 Modelflare：没有就以占位 key 创建固定 id 的 provider，再经 /api/provider/save 写入地址与真实 key
   * （key 不出现在进程参数里）。重复连接 = 覆盖。baseUrl 必须是白名单里的地址。
   */
  async connectModelflare(apiKey: string, baseUrl: string, allowed: string[]): Promise<void> {
    if (!allowed.includes(baseUrl)) throw new Error("不支持的 Modelflare 地址");
    if (!apiKey.trim()) throw new Error("缺少 API Key");
    let id = this.modelflareId();
    if (!id) {
      const add = await this.runCli(["provider", "add", "Modelflare", `id=${MODELFLARE_PROVIDER}`, `url=${baseUrl}`, "key=placeholder-key"]);
      if (add.code !== 0) throw new Error(`创建 Modelflare 连接失败：${(add.stderr || add.stdout).trim().slice(0, 300)}`);
      id = this.modelflareId() ?? (await this.findProviderId(MODELFLARE_PROVIDER));
    }
    await this.saveProvider(id, { chat: baseUrl, key: apiKey.trim() });
  }

  /** 切换线路：只改地址，key 不变 */
  async setModelflareUrl(baseUrl: string, allowed: string[]): Promise<void> {
    if (!allowed.includes(baseUrl)) throw new Error("不支持的 Modelflare 地址");
    const id = this.modelflareId();
    if (!id) return;
    await this.saveProvider(id, { chat: baseUrl });
  }

  async disconnectModelflare(): Promise<void> {
    const id = this.modelflareId();
    if (!id) return;
    if (this.state !== "running") throw new Error("模型网关未运行，稍后再试");
    const res = await fetch(`${this.webOrigin}/api/provider/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${this.cookieName}=${this.webKey}`, origin: this.webOrigin },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`断开失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  /** 当前 Modelflare 连接（只回传尾号，不外传 key） */
  modelflareInfo(): { connected: boolean; keyTail: string; baseUrl: string } {
    const id = this.modelflareId();
    const p = id ? this.readProviderRaw(id) : undefined;
    const key = String(p?.key ?? "");
    const connected = !!key && key !== "placeholder-key";
    return { connected, keyTail: connected ? keyTail(key) : "", baseUrl: String(p?.chat ?? "") };
  }

  private modelflareId(): string | undefined {
    const hit = this.listProviders().find((p) => p.id.toLowerCase() === MODELFLARE_PROVIDER || p.name.toLowerCase() === MODELFLARE_PROVIDER);
    return hit?.id;
  }

  private async saveProvider(id: string, patch: Record<string, string>): Promise<void> {
    if (this.state !== "running") throw new Error("模型网关未运行，稍后再试");
    const p = this.readProviderRaw(id);
    if (!p) throw new Error(`provider ${id} not found`);
    const res = await fetch(`${this.webOrigin}/api/provider/save`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${this.cookieName}=${this.webKey}`, origin: this.webOrigin },
      body: JSON.stringify({ ...p, ...patch, from: id }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`保存失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const saved = this.readProviderRaw(id);
    for (const [k, v] of Object.entries(patch)) if (saved?.[k] !== v) throw new Error("保存后校验失败");
  }

  private readProviderRaw(id: string): Record<string, unknown> | undefined {
    const f = path.join(this.root, "config", "magpie", "providers.json");
    if (!fs.existsSync(f)) return undefined;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const arr: any[] = Array.isArray(j) ? j : j.providers ?? [];
    return arr.find((x) => x.id === id);
  }

  /** 读取 magpie 的 providers.json（只取 id/name，不外传 key） */
  listProviders(): Array<{ id: string; name: string }> {
    for (const f of ["providers.json", "config.json"]) {
      const p = path.join(this.root, "config", "magpie", f);
      if (!fs.existsSync(p)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        const arr = Array.isArray(j) ? j : Array.isArray(j.providers) ? j.providers : [];
        if (arr.length) return arr.map((x: any) => ({ id: String(x.id ?? ""), name: String(x.name ?? x.id ?? "") }));
      } catch {
        /* ignore */
      }
    }
    return [];
  }

  private async findProviderId(nameOrPreset: string): Promise<string> {
    const list = this.listProviders();
    const want = nameOrPreset.toLowerCase();
    const hit = [...list].reverse().find((p) => p.id.toLowerCase() === want || p.name.toLowerCase() === want || p.id.toLowerCase().startsWith(want));
    if (hit) return hit.id;
    const r = await this.runCli(["providers"]);
    const m = r.stdout.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    const id = m.reverse().find((x) => x.toLowerCase().startsWith(want));
    if (!id) throw new Error(`could not determine provider id for ${nameOrPreset}`);
    return id;
  }
}
