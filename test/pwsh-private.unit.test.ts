/**
 * 应用内置的 PowerShell 7：下载 → 校验 → 解压 → 核对签名 → 试运行 → 换上，以及探测器的优先级、自动安装、运行中坏了自动退回。
 * 文件系统是真的（临时目录，AMB_PWSH_HOME），下载（fetch）和子进程（tar.exe / powershell.exe / pwsh.exe）是假的，在任何平台上跑。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DSH_ENCODING_PREAMBLE,
  PRIVATE_PWSH,
  PrivatePwsh,
  TEST_SCRIPT,
  osSupport,
  resolveArch,
  zipUrl,
  type PwshPin,
  type RunResult,
  type Runner,
} from "../src/agent/pwsh-private.js";
import { PwshProbe, pwshStatusLine, pwshReportLine, shellStartFailure, type PwshDeps, type PwshEvent } from "../src/agent/pwsh.js";
import { AgentHost } from "../src/agent/host.js";
import { Store } from "../src/store/db.js";

const PF = "C:\\Program Files";
const SYS_PWSH = `${PF}\\PowerShell\\7\\pwsh.exe`;
const PS5 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const ZIP = crypto.randomBytes(64 * 1024);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const PIN: PwshPin = { ...PRIVATE_PWSH, sha256: { x64: sha(ZIP), arm64: sha(ZIP) }, size: { x64: ZIP.length, arm64: ZIP.length } };
const FILES = ["pwsh.exe", "pwsh.dll", "System.Management.Automation.dll", "hostfxr.dll", "coreclr.dll"];
const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

interface FakeOpts {
  /** 下载给出的内容（默认就是 ZIP） */
  body?: Buffer;
  fetchFails?: number;
  tarFails?: boolean;
  /** 签名结果 */
  sig?: { status: string; subject?: string };
  /** 内置 pwsh 的试运行 */
  privateTest?: Partial<RunResult>;
  /** 系统 pwsh 的试运行 */
  systemTest?: Partial<RunResult>;
  osRelease?: string;
  env?: NodeJS.ProcessEnv;
  root?: string;
  pidAlive?: (pid: number) => boolean;
}

const okTest = (ver: string): RunResult => ({ code: 0, stdout: `AMB-PWSH-TEST ver=${ver} rw=rw-ok ext=ext-ok\r\n`, stderr: "" });

/** 假的下载与子进程；calls 记下每次调用 */
function fake(o: FakeOpts = {}) {
  const root = o.root ?? fs.mkdtempSync(path.join(os.tmpdir(), "amb-pwsh-priv-"));
  roots.push(root);
  const calls: Array<{ exe: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const fetches: string[] = [];
  let fetchFails = o.fetchFails ?? 0;
  const env: NodeJS.ProcessEnv = { SystemRoot: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\li\\AppData\\Local", ProgramFiles: PF, PATH: "C:\\Windows\\system32", PROCESSOR_IDENTIFIER: "Intel64 Family 6", AMB_PWSH_HOME: root, ...o.env };
  const run: Runner = async (exe, args, opts) => {
    calls.push({ exe, args, env: opts.env });
    if (/tar\.exe$/i.test(exe) || (/powershell\.exe$/i.test(exe) && args.join(" ").includes("Expand-Archive"))) {
      if (/tar\.exe$/i.test(exe) && o.tarFails) return { code: 1, stdout: "", stderr: "tar.exe: Error opening archive" };
      const dest = /tar\.exe$/i.test(exe) ? args[args.indexOf("-C") + 1] : opts.env!.AMB_DEST!;
      for (const f of FILES) fs.writeFileSync(path.join(dest, f), `fake ${f}`);
      fs.mkdirSync(path.join(dest, "Modules", "Microsoft.PowerShell.Archive"), { recursive: true });
      fs.writeFileSync(path.join(dest, "pwsh.deps.json"), `{"targets":{"x":{"pwsh/${PIN.version}.500":{}}}}`);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (/powershell\.exe$/i.test(exe)) {
      const files = String(opts.env?.AMB_SIG_FILES ?? "").split("|");
      const s = o.sig ?? { status: "Valid", subject: "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" };
      return { code: 0, stdout: JSON.stringify(files.map(() => ({ status: s.status, subject: s.subject ?? "", issuer: "CN=Microsoft Code Signing PCA 2011, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" }))), stderr: "" };
    }
    if (/reg\.exe$/i.test(exe)) return { code: 0, stdout: "    PROCESSOR_ARCHITECTURE    REG_SZ    AMD64\r\n", stderr: "" };
    if (/pwsh\.exe$/i.test(exe)) {
      const priv = exe.startsWith(root);
      return { ...okTest(priv ? PIN.version : "7.4.6"), ...(priv ? o.privateTest : o.systemTest) };
    }
    return { code: null, stdout: "", stderr: "", error: `ENOENT: ${exe}` };
  };
  const fetchFn = (async (url: string) => {
    fetches.push(String(url));
    if (fetchFails-- > 0) throw new Error("ECONNRESET");
    return new Response(new Uint8Array(o.body ?? ZIP), { headers: { "content-length": String((o.body ?? ZIP).length) } });
  }) as unknown as typeof fetch;
  const priv = new PrivatePwsh({ env, platform: "win32", arch: "x64", osRelease: o.osRelease ?? "10.0.22631", run, fetch: () => fetchFn, pin: PIN, pidAlive: o.pidAlive ?? (() => false), retryDelayMs: 1 });
  return { root, env, run, calls, fetches, priv, fetchFn, dir: path.join(root, `${PIN.version}-x64`) };
}

const leftovers = (root: string) => fs.readdirSync(root).filter((n) => n.startsWith("."));
const states = (p: PrivatePwsh) => {
  const seen: string[] = [];
  p.onChange(() => {
    const s = p.status().install.state;
    if (seen.at(-1) !== s) seen.push(s);
  });
  return seen;
};

describe("内置 PowerShell 7：安装", () => {
  it("下载 → SHA256 → tar.exe 解压 → 签名 → 按 DSH 的方式试运行 → 整个目录改名到位；不留临时文件和锁", async () => {
    const f = fake();
    const seen = states(f.priv);
    expect(await f.priv.install({ manual: true })).toBe(true);
    const st = f.priv.status();
    expect(st).toMatchObject({ version: PIN.version, arch: "x64", supported: true, installed: true, ready: true, dir: f.dir, install: { state: "done", received: ZIP.length, total: ZIP.length } });
    expect(f.priv.exe).toBe(path.join(f.dir, "pwsh.exe"));
    expect(seen).toEqual(["waiting", "downloading", "extracting", "verifying", "testing", "done"]);
    expect(f.fetches).toEqual([`https://github.com/PowerShell/PowerShell/releases/download/v${PIN.version}/PowerShell-${PIN.version}-win-x64.zip`]);
    // tar 用系统自带的（不是 PATH 里 Git 的 GNU tar），解到临时目录
    const tar = f.calls.find((c) => /tar\.exe$/i.test(c.exe))!;
    expect(tar.exe).toBe("C:\\Windows\\System32\\tar.exe");
    expect(tar.args[tar.args.indexOf("-C") + 1]).toMatch(/[\\/]\.staging-[0-9a-f]+$/);
    // 签名：Windows PowerShell 5.1 核对 pwsh.exe、pwsh.dll、System.Management.Automation.dll
    const sig = f.calls.find((c) => /powershell\.exe$/i.test(c.exe))!;
    expect(sig.exe).toBe(PS5);
    expect(sig.args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]));
    expect(sig.args.at(-1)).toContain("Get-AuthenticodeSignature");
    expect(String(sig.env?.AMB_SIG_FILES).split("|").map((p) => path.basename(p))).toEqual(["pwsh.exe", "pwsh.dll", "System.Management.Automation.dll"]);
    // 试运行：和 DSH 一模一样的参数（-NoLogo -NoProfile -NonInteractive -Command + UTF-8 前缀），只带系统目录类环境变量
    const test = f.calls.find((c) => /pwsh\.exe$/i.test(c.exe))!;
    expect(test.args).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DSH_ENCODING_PREAMBLE + TEST_SCRIPT]);
    expect(TEST_SCRIPT).toContain("$PSVersionTable.PSVersion");
    expect(TEST_SCRIPT).toContain("Set-Content");
    expect(TEST_SCRIPT).toContain("cmd.exe");
    expect(test.env).toMatchObject({ NO_COLOR: "1", SystemRoot: "C:\\Windows" });
    expect(test.env).not.toHaveProperty("AMB_PWSH_HOME");
    // 结果
    expect(fs.existsSync(path.join(f.dir, ".amb-pwsh.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(f.root, "state.json"), "utf8")).installs[`${PIN.version}-x64`].test.ok).toBe(true);
    expect(leftovers(f.root)).toEqual([]);
  });

  it("SHA256 不符：不解压、不留文件，报原因", async () => {
    const f = fake({ body: Buffer.concat([ZIP.subarray(0, ZIP.length - 1), Buffer.from([ZIP[ZIP.length - 1] ^ 1])]) });
    expect(await f.priv.install({ manual: true })).toBe(false);
    expect(f.priv.status()).toMatchObject({ installed: false, ready: false, install: { state: "failed" } });
    expect(f.priv.status().install.error).toMatch(/SHA256 不符/);
    expect(f.calls.some((c) => /tar\.exe$/i.test(c.exe))).toBe(false);
    expect(f.fetches).toHaveLength(1); // 哈希不对不重试
    expect(fs.existsSync(f.dir)).toBe(false);
    expect(leftovers(f.root)).toEqual([]);
  });

  it("大小不对（比如代理返回了网页）：直接失败", async () => {
    const f = fake({ body: Buffer.from("<html>blocked</html>") });
    expect(await f.priv.install({ manual: true })).toBe(false);
    expect(f.priv.status().install.error).toMatch(/大小不对/);
    expect(f.fetches).toHaveLength(1); // 重试也没用，不重试
    expect(leftovers(f.root)).toEqual([]);
  });

  it("网络错误重试；签名不是 Microsoft 的：删掉解压出来的东西", async () => {
    const f = fake({ fetchFails: 1, sig: { status: "Valid", subject: "CN=Evil Corp, O=Evil Corp" } });
    expect(await f.priv.install({ manual: true })).toBe(false);
    expect(f.fetches).toHaveLength(2);
    expect(f.priv.status().install.error).toMatch(/签名核对没通过.*不是 Microsoft 签名的/);
    expect(fs.existsSync(f.dir)).toBe(false);
    expect(leftovers(f.root)).toEqual([]);
    const g = fake({ sig: { status: "HashMismatch" } });
    expect(await g.priv.install({ manual: true })).toBe(false);
    expect(g.priv.status().install.error).toMatch(/签名无效（HashMismatch）/);
  });

  it("试运行没通过（比如被策略拦下）：不用，也不留下", async () => {
    const f = fake({ privateTest: { code: 1, stdout: "", stderr: "Program 'pwsh.exe' failed to run: This program is blocked by group policy." } });
    expect(await f.priv.install({ manual: true })).toBe(false);
    expect(f.priv.status()).toMatchObject({ installed: false, ready: false });
    expect(f.priv.status().install.error).toMatch(/试运行没通过.*blocked by group policy/);
    expect(fs.existsSync(f.dir)).toBe(false);
    expect(leftovers(f.root)).toEqual([]);
    // 版本不对也不行
    const g = fake({ privateTest: okTest("7.4.0") });
    expect(await g.priv.install({ manual: true })).toBe(false);
    expect(g.priv.status().install.error).toMatch(/版本是 7\.4\.0/);
  });

  it("tar.exe 解不了：改用 Windows PowerShell 5.1 的 Expand-Archive", async () => {
    const f = fake({ tarFails: true });
    expect(await f.priv.install({ manual: true })).toBe(true);
    expect(f.calls.some((c) => /powershell\.exe$/i.test(c.exe) && c.args.join(" ").includes("Expand-Archive"))).toBe(true);
    expect(f.priv.ready).toBe(true);
  });

  it("装到一半退出：下次启动清掉临时文件和残留的锁；另一个进程正在装时不抢", async () => {
    const f = fake();
    fs.mkdirSync(path.join(f.root, ".staging-dead", "Modules"), { recursive: true });
    fs.writeFileSync(path.join(f.root, ".dl-dead.zip"), "partial");
    fs.writeFileSync(path.join(f.root, ".lock"), JSON.stringify({ pid: 999_999, at: Date.now() }));
    await f.priv.prepare();
    expect(leftovers(f.root)).toEqual([]);
    expect(f.priv.status()).toMatchObject({ installed: false, ready: false });
    // 锁的主人还活着、心跳是新的：等它
    const g = fake({ root: f.root, pidAlive: () => true });
    fs.writeFileSync(path.join(f.root, ".lock"), JSON.stringify({ pid: 999_999, at: Date.now() }));
    fs.writeFileSync(path.join(f.root, ".dl-other.zip"), "theirs");
    await g.priv.prepare();
    expect(fs.existsSync(path.join(f.root, ".dl-other.zip"))).toBe(true);
    expect(await g.priv.install({ manual: true })).toBe(false);
    expect(g.priv.status().install).toMatchObject({ state: "waiting", error: expect.stringContaining("正在安装") });
    expect(g.fetches).toEqual([]);
    // 心跳停了 3 分钟以上：当作残留
    const old = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(path.join(f.root, ".lock"), old, old);
    expect(await g.priv.install({ manual: true })).toBe(true);
  });

  it("每次启动只看文件指纹：没变就直接用（不拉起任何进程）；变了重新核对签名、试运行", async () => {
    const f = fake();
    expect(await f.priv.install({ manual: true })).toBe(true);
    const again = fake({ root: f.root });
    await again.priv.prepare();
    expect(again.priv.status()).toMatchObject({ installed: true, ready: true });
    expect(again.calls).toEqual([]);
    // pwsh.dll 被换了：重新核对签名并试运行
    fs.appendFileSync(path.join(f.dir, "pwsh.dll"), "changed");
    const third = fake({ root: f.root });
    await third.priv.prepare();
    expect(third.priv.ready).toBe(true);
    expect(third.calls.map((c) => path.win32.basename(c.exe).toLowerCase())).toEqual(["powershell.exe", "pwsh.exe"]);
    // 重新检测（refresh）：再试运行一次
    await third.priv.prepare(true);
    expect(third.calls.filter((c) => /pwsh\.exe$/i.test(c.exe))).toHaveLength(2);
  });

  it("文件被杀毒软件删了：标记为坏、不自动重装（要用户点重新安装），重新安装后恢复", async () => {
    const f = fake();
    expect(await f.priv.install({ manual: true })).toBe(true);
    fs.rmSync(path.join(f.dir, "coreclr.dll"));
    const next = fake({ root: f.root });
    await next.priv.prepare();
    expect(next.priv.status()).toMatchObject({ installed: true, ready: false, bad: { reason: expect.stringContaining("coreclr.dll") } });
    expect(next.priv.autoBlocked()).toMatch(/需要手动重新安装/);
    expect(await next.priv.install({ manual: true, reinstall: true })).toBe(true);
    expect(next.priv.status()).toMatchObject({ installed: true, ready: true });
    expect(next.priv.status().bad).toBeUndefined();
    expect(fs.existsSync(path.join(f.dir, "coreclr.dll"))).toBe(true);
    expect(leftovers(f.root)).toEqual([]);
  });

  it("Windows 太旧（低于 10 1607 / Server 2016）：不下载，说明原因", async () => {
    const f = fake({ osRelease: "10.0.10586" });
    await f.priv.prepare();
    expect(f.priv.status()).toMatchObject({ supported: false, reason: expect.stringContaining("Windows 版本较旧") });
    expect(f.priv.autoBlocked()).toMatch(/Windows 版本较旧/);
    expect(await f.priv.install({ manual: true })).toBe(false);
    expect(f.fetches).toEqual([]);
    expect(osSupport("10.0.14393").ok).toBe(true);
    expect(osSupport("10.0.17763").ok).toBe(true);
    expect(osSupport("6.3.9600").ok).toBe(false);
    expect(osSupport("10.0.26100.1").ok).toBe(true);
    expect(osSupport("weird").ok).toBe(true);
  });

  it("自动安装失败后退避（1 小时、1 天、之后不再自动装）；AMB_PWSH_AUTO_INSTALL=0 关掉；手动点安装清零", async () => {
    const f = fake({ body: Buffer.from("x".repeat(ZIP.length)) });
    expect(f.priv.autoBlocked()).toBe("不支持的处理器架构"); // 还没看过这台电脑（prepare 之前）
    await f.priv.prepare();
    expect(f.priv.autoBlocked()).toBeUndefined();
    expect(await f.priv.install()).toBe(false);
    expect(f.priv.autoBlocked()).toMatch(/稍后再试/);
    const state = () => JSON.parse(fs.readFileSync(path.join(f.root, "state.json"), "utf8"));
    expect(state().auto.attempts).toBe(1);
    await f.priv.install({ manual: true });
    expect(state().auto.attempts).toBe(0);
    expect(fake({ env: { AMB_PWSH_AUTO_INSTALL: "0" } }).priv.autoBlocked()).toBe("AMB_PWSH_AUTO_INSTALL=0");
  });

  it("架构：arm64 进程装 arm64；x64 进程在 ARM64 Windows 上（模拟运行）也装 arm64；32 位不装；镜像前缀", async () => {
    expect(await resolveArch({ arch: "arm64", env: {} })).toBe("arm64");
    expect(await resolveArch({ arch: "x64", env: { PROCESSOR_IDENTIFIER: "ARMv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc" } })).toBe("arm64");
    expect(await resolveArch({ arch: "x64", env: { PROCESSOR_IDENTIFIER: "AMD64 Family 25 Model 33 Stepping 0, AuthenticAMD" } })).toBe("x64");
    expect(await resolveArch({ arch: "ia32", env: {} })).toBeUndefined();
    // 认不出来：问注册表里的本机架构
    const reg = vi.fn(async () => ({ code: 0, stdout: "    PROCESSOR_ARCHITECTURE    REG_SZ    ARM64\r\n", stderr: "" }));
    expect(await resolveArch({ arch: "x64", env: { SystemRoot: "C:\\Windows" }, run: reg })).toBe("arm64");
    expect((reg.mock.calls[0] as unknown as [string])[0]).toBe("C:\\Windows\\System32\\reg.exe");
    expect(zipUrl(PRIVATE_PWSH, "arm64", {})).toBe(`https://github.com/PowerShell/PowerShell/releases/download/v${PRIVATE_PWSH.version}/PowerShell-${PRIVATE_PWSH.version}-win-arm64.zip`);
    expect(zipUrl(PRIVATE_PWSH, "x64", { AMB_PWSH_MIRROR: "https://mirror.example/pwsh/" })).toBe(`https://mirror.example/pwsh/PowerShell-${PRIVATE_PWSH.version}-win-x64.zip`);
    // 固定的哈希是 64 位十六进制
    expect(PRIVATE_PWSH.sha256.x64).toMatch(/^[0-9a-f]{64}$/);
    expect(PRIVATE_PWSH.sha256.arm64).toMatch(/^[0-9a-f]{64}$/);
  });
});

/** 探测器：系统 pwsh 在不在由 exes 决定，内置副本用上面的假环境 */
function probeWith(f: ReturnType<typeof fake>, o: { exes?: string[]; versions?: Record<string, string> } = {}) {
  const exes = new Set([PS5, ...(o.exes ?? [])].map((p) => p.toLowerCase()));
  const deps: PwshDeps = {
    platform: "win32",
    env: f.env,
    run: f.run,
    priv: f.priv,
    lstat: async (p) => {
      if (!exes.has(p.toLowerCase())) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { isFile: () => true, isSymbolicLink: () => false };
    },
    readdir: async () => [],
    readFile: async (p) => {
      const v = o.versions?.[path.win32.dirname(p).toLowerCase()];
      if (!v) throw new Error("ENOENT");
      return `{"libraries":{"pwsh/${v}":{}}}`;
    },
    runVersion: async () => "PowerShell 7.4.6",
  };
  const probe = new PwshProbe(deps);
  const events: PwshEvent[] = [];
  probe.onChange((e) => events.push(e));
  return { probe, events };
}

/** 等后台的安装 / 试运行做完 */
async function settle(p: PrivatePwsh, probe?: PwshProbe) {
  for (let i = 0; i < 200 && (p.busy || (probe && (probe as any).sysTests && [...(probe as any).sysTests.values()].includes("pending"))); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 5));
}

describe("探测器：优先级、自动安装、自动退回", () => {
  it("系统里有能用的 PowerShell 7：用它，什么都不下载", async () => {
    const f = fake();
    const { probe } = probeWith(f, { exes: [SYS_PWSH] });
    probe.configure({ agent: true, mode: "auto" });
    const st = await probe.check();
    await settle(f.priv, probe);
    expect(st).toMatchObject({ found: true, missing: false, path: SYS_PWSH, source: "program-files", using: SYS_PWSH, autoInstall: true });
    expect(await probe.dshPath()).toBe(SYS_PWSH);
    expect(f.fetches).toEqual([]);
    expect(f.calls.filter((c) => c.exe === SYS_PWSH)).toHaveLength(1); // 后台试运行了一次
  });

  it("没有 PowerShell 7（代理模式开着）：后台自动装内置的；装的时候照旧用 5.1，装好后切过去并通知", async () => {
    const f = fake();
    const { probe, events } = probeWith(f);
    probe.configure({ agent: true, mode: "auto" });
    const st = await probe.check();
    expect(st).toMatchObject({ missing: true });
    // 装的时候：DSH 照旧拿到默认（不等安装）
    expect(f.priv.busy).toBe(true);
    expect(await probe.dshPath(50)).toBeUndefined();
    expect(pwshStatusLine(probe.snapshot())).toMatch(/正在为代理安装 PowerShell 7…/);
    await settle(f.priv);
    const done = probe.snapshot();
    expect(done).toMatchObject({ found: true, missing: false, source: "private", version: PIN.version, path: f.priv.exe, using: f.priv.exe });
    expect(probe.cachedDshPath).toBe(f.priv.exe);
    expect(await probe.dshPath()).toBe(f.priv.exe);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "path", to: f.priv.exe }), expect.objectContaining({ kind: "install", notice: expect.objectContaining({ level: "info" }) })]));
    expect(pwshStatusLine(done)).toBe(`PowerShell：${PIN.version}（应用内置，代理用它执行命令）`);
    expect(pwshReportLine(done)).toContain(`内置 PowerShell ${PIN.version} x64 · 已就绪 · 试运行通过`);
  });

  it("代理模式没开、AMB_PWSH_AUTO_INSTALL=0、改回系统默认：都不自动装；手动安装照样可以", async () => {
    for (const [cfg, env] of [
      [{ agent: false, mode: "auto" as const }, {}],
      [{ agent: true, mode: "auto" as const }, { AMB_PWSH_AUTO_INSTALL: "0" }],
      [{ agent: true, mode: "system" as const }, {}],
    ] as const) {
      const f = fake({ env });
      const { probe } = probeWith(f);
      probe.configure(cfg);
      const st = await probe.check();
      await settle(f.priv);
      expect(f.fetches).toEqual([]);
      expect(st.missing).toBe(true);
      expect(pwshStatusLine(st)).toContain("Windows PowerShell 5.1");
    }
    const f = fake({ env: { AMB_PWSH_AUTO_INSTALL: "0" } });
    const { probe } = probeWith(f);
    probe.configure({ agent: true, mode: "auto" });
    await probe.check();
    probe.install();
    await settle(f.priv);
    expect(probe.snapshot()).toMatchObject({ missing: false, source: "private" });
    // 改回系统默认：不再用内置的，空闲时换回 5.1
    probe.setMode("system");
    expect(probe.snapshot()).toMatchObject({ missing: true, mode: "system" });
    expect(probe.cachedDshPath).toBeUndefined();
  });

  it("系统里的 PowerShell 7 试运行没通过：不用它，改用（自动装好的）内置副本", async () => {
    const f = fake({ systemTest: { code: -532462766, stdout: "", stderr: "Failed to load the dll from [C:\\Program Files\\PowerShell\\7\\hostfxr.dll], HRESULT: 0x80070002" } });
    const { probe, events } = probeWith(f, { exes: [SYS_PWSH] });
    probe.configure({ agent: true, mode: "auto" });
    expect(await probe.check()).toMatchObject({ missing: false, source: "program-files" });
    await settle(f.priv, probe);
    await settle(f.priv, probe);
    const st = probe.snapshot();
    expect(st).toMatchObject({ missing: false, source: "private", systemIssue: expect.stringContaining("试运行没通过") });
    expect(st.fallback).toMatchObject({ from: SYS_PWSH });
    expect(events.some((e) => e.notice?.level === "warn" && e.notice.text.includes(SYS_PWSH))).toBe(true);
  });

  it("AMB_PWSH_IGNORE_SYSTEM=1（CI）：不看系统里的；内置的装好前明确写 5.1（免得 DSH 自己找回系统的）", async () => {
    const f = fake({ env: { AMB_PWSH_IGNORE_SYSTEM: "1" } });
    const { probe } = probeWith(f, { exes: [SYS_PWSH] });
    probe.configure({ agent: false });
    const st = await probe.check();
    expect(st).toMatchObject({ found: false, missing: true, ignoreSystem: true, using: PS5 });
    expect(await probe.dshPath()).toBe(PS5);
    probe.install();
    await settle(f.priv);
    expect(await probe.dshPath()).toBe(f.priv.exe);
  });

  it("运行中代理拉不起内置的 pwsh（被删、被拦）：立即标记为坏、退回、通知；重启后还记得；重新检测通过后恢复", async () => {
    const f = fake({ env: { AMB_PWSH_IGNORE_SYSTEM: "1" } });
    const { probe, events } = probeWith(f);
    probe.configure({ agent: true, mode: "auto" });
    await probe.check();
    await settle(f.priv);
    const exe = f.priv.exe!;
    expect(probe.cachedDshPath).toBe(exe);
    // 普通的命令失败不算
    probe.observeToolResult(exe, "Get-Foo: The term 'Get-Foo' is not recognized as a name of a cmdlet\n[exit code: 1]");
    probe.observeToolResult(exe, `windows-acl-run: CreateProcessAsUserW failed (Win32 2): command: C:\\other\\pwsh.exe, cwd: C:\\ws`);
    expect(probe.cachedDshPath).toBe(exe);
    // 沙箱 runner 拉不起它
    const text = `sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Runner failure: windows-acl-run: CreateProcessAsUserW failed (Win32 2): command: ${exe}, cwd: C:\\data\\workspaces\\default`;
    expect(shellStartFailure(text, exe)).toContain("CreateProcessAsUserW failed (Win32 2)");
    probe.observeToolResult(exe, text);
    const st = probe.snapshot();
    expect(st).toMatchObject({ missing: true, using: PS5, private: { ready: false, bad: { reason: expect.stringContaining("代理拉不起它") } }, fallback: { from: exe, to: PS5 } });
    expect(probe.cachedDshPath).toBe(PS5);
    const ev = events.at(-1)!;
    expect(ev).toMatchObject({ kind: "path", from: exe, to: PS5, notice: { level: "warn" } });
    expect(ev.notice!.text).toContain("Windows PowerShell 5.1");
    expect(pwshStatusLine(st)).toMatch(/应用内置的 PowerShell 7 用不了.*重新安装/);
    // 同一个回合里再失败：不重复通知
    const n = events.length;
    probe.observeToolResult(exe, text);
    expect(events).toHaveLength(n);
    // 坏了不自动重装（免得循环下载）
    expect(f.fetches).toHaveLength(1);
    // 重启后还记得
    const again = fake({ root: f.root, env: { AMB_PWSH_IGNORE_SYSTEM: "1" } });
    await again.priv.prepare();
    expect(again.priv.status()).toMatchObject({ installed: true, ready: false, bad: expect.anything() });
    // 重新检测：重新试运行，通过就恢复
    await probe.check(true);
    expect(probe.snapshot()).toMatchObject({ missing: false, source: "private" });
    expect(probe.snapshot().fallback).toBeUndefined();
  });

  it("不经沙箱（完全权限）时 spawn 失败也算；系统的 pwsh 坏了退回内置的", async () => {
    const f = fake();
    const { probe } = probeWith(f, { exes: [SYS_PWSH] });
    probe.configure({ agent: true, mode: "auto" });
    await probe.check();
    await settle(f.priv, probe);
    expect(probe.cachedDshPath).toBe(SYS_PWSH);
    probe.observeToolResult(SYS_PWSH, `subprocess failed before reporting an outcome: Error: spawn ${SYS_PWSH} ENOENT`);
    expect(probe.snapshot()).toMatchObject({ systemIssue: expect.stringContaining("代理拉不起它"), missing: true });
    // 系统的坏了、内置的没装：自动装上
    expect(f.priv.busy).toBe(true);
    await settle(f.priv);
    expect(probe.cachedDshPath).toBe(f.priv.exe);
    expect(shellStartFailure(`Error: spawn ${SYS_PWSH.replaceAll("\\", "\\\\")} EACCES`, SYS_PWSH)).toBeTruthy();
    // 沙箱里别的错误码（不是程序本身的问题）不算强信号
    expect(shellStartFailure(`windows-acl-run: CreateProcessAsUserW failed (Win32 1314): command: ${SYS_PWSH}, cwd: C:\\ws`, SYS_PWSH)).toBeUndefined();
  });

  it(".NET 宿主报错之类的弱信号：重新试运行一次，通过就不动，没通过才退回", async () => {
    const f = fake({ env: { AMB_PWSH_IGNORE_SYSTEM: "1" } });
    const { probe } = probeWith(f);
    probe.configure({ agent: true, mode: "auto" });
    await probe.check();
    await settle(f.priv);
    const exe = f.priv.exe!;
    const tests = () => f.calls.filter((c) => c.exe === exe).length;
    const before = tests();
    probe.observeToolResult(exe, "A fatal error was encountered. The library 'hostfxr.dll' required to execute the application was not found");
    await new Promise((r) => setTimeout(r, 20));
    expect(tests()).toBe(before + 1);
    expect(probe.cachedDshPath).toBe(exe);
    // 一分钟内不再重复试
    probe.observeToolResult(exe, "A fatal error was encountered.");
    await new Promise((r) => setTimeout(r, 20));
    expect(tests()).toBe(before + 1);
  });

  it("改回系统默认再改回来；重新安装（坏了也行）", async () => {
    const f = fake({ env: { AMB_PWSH_IGNORE_SYSTEM: "1" } });
    const { probe } = probeWith(f);
    probe.configure({ agent: true, mode: "auto" });
    await probe.check();
    await settle(f.priv);
    probe.markBroken(f.priv.exe!, "test");
    expect(probe.snapshot().private?.bad).toBeTruthy();
    probe.install({ reinstall: true });
    await settle(f.priv);
    expect(probe.snapshot()).toMatchObject({ missing: false, source: "private" });
    expect(probe.snapshot().private?.bad).toBeUndefined();
    expect(f.fetches).toHaveLength(2);
  });
});

describe("代理进程：PowerShell 换了就在空闲时重启；pwsh 工具结果交给探测器", () => {
  const mkHost = () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-pwsh-host-"));
    roots.push(dataDir);
    return new AgentHost({ botId: "b", dataDir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1" } as any, store: new Store(":memory:") });
  };

  it("空闲时设置签名变了（PowerShell 换了）：后台重启；有回合在跑（或正要开始）时不动", async () => {
    const host = mkHost() as any;
    const closed: string[] = [];
    const fakeHarness = (id: string) => ({ id, close: async () => void closed.push(id), client: {} });
    host.harness = fakeHarness("old");
    host.model = "m";
    host.sig = "stale";
    let spawned = 0;
    host.spawn = async () => {
      spawned++;
      host.sig = host.settingsSig();
      return (host.harness = fakeHarness(`new${spawned}`));
    };
    host.entering = 1;
    await host.restartIfStale();
    expect(closed).toEqual([]);
    host.entering = 0;
    host.active = 1;
    await host.restartIfStale();
    expect(closed).toEqual([]);
    host.active = 0;
    await host.restartIfStale();
    expect(closed).toEqual(["old"]);
    expect(spawned).toBe(1);
    // 签名没变：不重启
    await host.restartIfStale();
    expect(spawned).toBe(1);
  });

  it("pwsh 工具的结果（连同这个代理进程用的路径）交给探测器", async () => {
    const { pwshProbe } = await import("../src/agent/pwsh.js");
    const seen = vi.spyOn(pwshProbe, "observeToolResult").mockImplementation(() => undefined);
    const host = mkHost() as any;
    host.pwshPath = "C:\\pw\\pwsh.exe";
    const session = {
      id: "s1",
      run: async (_p: unknown, o: { onNotification: (n: unknown) => void }) => {
        const ev = (type: string, data: unknown) => o.onNotification({ method: "session.event", params: { sessionId: "s1", event: { type, data, time: Date.now() } } });
        ev("tool/call", { callId: "c1", name: "pwsh", arguments: '{"command":"dir"}' });
        ev("tool/result", { message: { toolCallId: "c1", isError: true, content: [{ type: "text", text: "windows-acl-run: boom" }] } });
        ev("tool/call", { callId: "c2", name: "read_file", arguments: "{}" });
        ev("tool/result", { message: { toolCallId: "c2", content: [{ type: "text", text: "x" }] } });
        return { sessionId: "s1", finalResponse: "done", events: [] };
      },
    };
    host.ensure = async () => ({});
    host.sessionFor = async () => session;
    const r = await host.runTurn({ conversationId: "c", text: "hi", model: "m" });
    expect(r.text).toBe("done");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("C:\\pw\\pwsh.exe", "windows-acl-run: boom");
    seen.mockRestore();
  });
});
