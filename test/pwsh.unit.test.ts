/**
 * Windows 上的 PowerShell 7 检测（文件系统、环境变量和路径都是假的，在任何平台上跑）+ 界面接口、诊断报告。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 读版本号的最后手段（`pwsh -Version`）：只拦假的 pwsh.exe，其余照常
const spawned: Array<{ exe: string; args: string[]; opts: any }> = [];
vi.mock("node:child_process", async (orig) => {
  const real: any = await orig();
  const execFile = (exe: string, args: string[], opts: any, cb: (e: Error | null, out: string, err: string) => void) => {
    if (!/^C:\\.*pwsh\.exe$/i.test(exe)) return real.execFile(exe, args, opts, cb);
    spawned.push({ exe, args, opts });
    setImmediate(() => cb(null, "PowerShell 7.5.4\r\n", ""));
    return {} as any;
  };
  return { ...real, default: { ...real, execFile }, execFile };
});

import { PwshProbe, findPwsh, parsePwshVersion, pwshPatchLines, pwshReportLine, pwshStatusLine, readPwshVersion, PWSH_WINGET, type PwshDeps } from "../src/agent/pwsh.js";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const PF = "C:\\Program Files";
const LOCAL = "C:\\Users\\li\\AppData\\Local";
const APPS = `${LOCAL}\\Microsoft\\WindowsApps`;
const PS5 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\";
const ENV = { ProgramFiles: PF, ProgramW6432: PF, LOCALAPPDATA: LOCAL, PATH: `C:\\Windows\\system32;C:\\Windows;${PS5};${APPS}` };
const DEPS_746 = '{"targets":{".NETCoreApp,Version=v8.0/win-x64":{"pwsh/7.4.6":{"dependencies":{}}}},"libraries":{"pwsh/7.4.6":{"type":"project"}}}';

/** 假的 Windows 文件系统：exes 里是存在的 pwsh.exe（file 或 Store 别名 alias），texts 是可读的文件，dirs 是目录列表 */
function fakeWin(o: { exes?: Record<string, "file" | "alias">; texts?: Record<string, string>; dirs?: Record<string, string[]>; env?: NodeJS.ProcessEnv; runVersion?: PwshDeps["runVersion"] } = {}) {
  const k = (p: string) => p.toLowerCase();
  const exes = new Map(Object.entries(o.exes ?? {}).map(([p, v]) => [k(p), v]));
  const texts = new Map(Object.entries(o.texts ?? {}).map(([p, v]) => [k(p), v]));
  const lstats: string[] = [];
  const runs: string[] = [];
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  const deps: PwshDeps = {
    platform: "win32",
    env: o.env ?? ENV,
    lstat: async (p) => {
      lstats.push(p);
      const v = exes.get(k(p));
      if (!v) throw enoent(p);
      return { isFile: () => v === "file", isSymbolicLink: () => v === "alias" };
    },
    readdir: async (p) => {
      const d = o.dirs?.[p];
      if (!d) throw enoent(p);
      return d;
    },
    readFile: async (p) => {
      const v = texts.get(k(p));
      if (v === undefined) throw enoent(p);
      return v;
    },
    runVersion: async (exe) => {
      runs.push(exe);
      if (!o.runVersion) throw new Error("no version");
      return o.runVersion(exe);
    },
  };
  return { deps, lstats, runs, addExe: (p: string, v: "file" | "alias" = "file") => exes.set(k(p), v) };
}

describe("PowerShell 7 检测", () => {
  it("不是 Windows：不检测、不碰文件，DSH 补丁里不写 pwshPath", async () => {
    const w = fakeWin({ exes: { [`${PF}\\PowerShell\\7\\pwsh.exe`]: "file" } });
    const probe = new PwshProbe({ ...w.deps, platform: "linux", env: {} });
    expect(probe.applicable).toBe(false);
    expect(await probe.check()).toMatchObject({ applicable: false, found: false, missing: false });
    expect(await probe.dshPath()).toBeUndefined();
    expect(w.lstats).toEqual([]);
    expect(pwshStatusLine(probe.snapshot())).toBe("");
    expect(pwshReportLine(probe.snapshot())).toBeUndefined();
  });

  it("和 DSH 一样先认 Program Files\\PowerShell\\7；版本号从 pwsh.deps.json 读，不拉起进程", async () => {
    const exe = `${PF}\\PowerShell\\7\\pwsh.exe`;
    const w = fakeWin({ exes: { [exe]: "file", [`${APPS}\\pwsh.exe`]: "alias" }, texts: { [`${PF}\\PowerShell\\7\\pwsh.deps.json`]: DEPS_746 } });
    const probe = new PwshProbe(w.deps);
    const st = await probe.check();
    expect(st).toMatchObject({ applicable: true, found: true, missing: false, path: exe, source: "program-files", version: "7.4.6" });
    expect(w.runs).toEqual([]);
    expect(await probe.dshPath()).toBe(exe);
    expect(probe.cachedDshPath).toBe(exe);
    expect(pwshStatusLine(st)).toBe("PowerShell：7.4.6（代理用它执行命令）");
    expect(pwshReportLine(st)).toBe(`[PowerShell] 7.4.6 · ${exe}（安装目录） · 代理用它执行命令`);
  });

  it("PATH 里的 pwsh.exe（带引号和空格的项）；读不到 deps.json 时问 pwsh -Version", async () => {
    const dir = "D:\\Tools\\PowerShell 7";
    const env = { ...ENV, PATH: `C:\\Windows\\system32; "${dir}" ;${PS5}` };
    const w = fakeWin({ env, exes: { [`${dir}\\pwsh.exe`]: "file" }, runVersion: async () => "PowerShell 7.5.4\r\n" });
    const st = await new PwshProbe(w.deps).check();
    expect(st).toMatchObject({ found: true, missing: false, path: `${dir}\\pwsh.exe`, source: "path", version: "7.5.4" });
    expect(w.runs).toEqual([`${dir}\\pwsh.exe`]);
  });

  it("预览版（7-preview，DSH 自己找不到）：找到并写进 DSH 补丁", async () => {
    const exe = `${PF}\\PowerShell\\7-preview\\pwsh.exe`;
    const w = fakeWin({
      exes: { [exe]: "file" },
      dirs: { [`${PF}\\PowerShell`]: ["Modules", "7-preview"] },
      texts: { [`${PF}\\PowerShell\\7-preview\\pwsh.deps.json`]: DEPS_746.replaceAll("7.4.6", "7.6.0-preview.5") },
    });
    const probe = new PwshProbe(w.deps);
    expect(await probe.check()).toMatchObject({ found: true, missing: false, source: "preview", version: "7.6.0-preview.5" });
    expect(pwshPatchLines(await probe.dshPath())).toEqual(["- id: pwsh-sandbox", "  config:", '    pwshPath: "C:\\\\Program Files\\\\PowerShell\\\\7-preview\\\\pwsh.exe"']);
    expect(pwshPatchLines(undefined)).toEqual([]);
  });

  it("正式版和预览版都在时先用正式版", async () => {
    const w = fakeWin({
      exes: { [`${PF}\\PowerShell\\7.5\\pwsh.exe`]: "file", [`${PF}\\PowerShell\\7-preview\\pwsh.exe`]: "file" },
      dirs: { [`${PF}\\PowerShell`]: ["7-preview", "7.5"] },
    });
    expect(await findPwsh(w.deps)).toEqual({ path: `${PF}\\PowerShell\\7.5\\pwsh.exe`, source: "program-files" });
  });

  it("Microsoft Store / winget 的 WindowsApps 别名：lstat 报成符号链接也算；不在 PATH 里也找得到", async () => {
    const env = { ...ENV, PATH: `C:\\Windows\\system32;${PS5}` };
    const w = fakeWin({ env, exes: { [`${APPS}\\pwsh.exe`]: "alias" }, runVersion: async () => "PowerShell 7.5.4" });
    const st = await new PwshProbe(w.deps).check();
    expect(st).toMatchObject({ found: true, missing: false, path: `${APPS}\\pwsh.exe`, source: "store", version: "7.5.4" });
    // 在 PATH 里（默认如此）时同样标成 Store
    const w2 = fakeWin({ exes: { [`${APPS}\\pwsh.exe`]: "alias" } });
    expect(await findPwsh(w2.deps)).toEqual({ path: `${APPS}\\pwsh.exe`, source: "store" });
  });

  it("没有 PowerShell 7：提示安装；DSH 补丁不写 pwshPath（它退回 Windows PowerShell 5.1）", async () => {
    const w = fakeWin({ exes: { [`${PS5}powershell.exe`]: "file" } });
    const probe = new PwshProbe(w.deps);
    const st = await probe.check();
    expect(st).toMatchObject({ applicable: true, found: false, missing: true });
    expect(st.path).toBeUndefined();
    expect(await probe.dshPath()).toBeUndefined();
    expect(pwshStatusLine(st)).toContain("Windows PowerShell 5.1");
    expect(pwshStatusLine(st)).toContain(PWSH_WINGET);
    expect(pwshReportLine(st)).toContain("未安装 PowerShell 7");
    // 每个候选都只看了一次文件（PATH 里重复的目录去重）
    expect(new Set(w.lstats.map((p) => p.toLowerCase())).size).toBe(w.lstats.length);
    expect(w.lstats.every((p) => p.toLowerCase().endsWith("pwsh.exe"))).toBe(true);
  });

  it("PATH 里只有 PowerShell 6：仍建议装 7", async () => {
    const w = fakeWin({ exes: { "C:\\PS6\\pwsh.exe": "file" }, env: { ...ENV, PATH: "C:\\PS6" }, runVersion: async () => "PowerShell 6.2.7" });
    const st = await new PwshProbe(w.deps).check();
    expect(st).toMatchObject({ found: true, missing: true, version: "6.2.7" });
    expect(pwshStatusLine(st)).toContain("6.2.7 版本较旧");
  });

  it("读不到版本号也算找到了", async () => {
    const w = fakeWin({ exes: { [`${PF}\\PowerShell\\7\\pwsh.exe`]: "file" } });
    const st = await new PwshProbe(w.deps).check();
    expect(st).toMatchObject({ found: true, missing: false });
    expect(st.version).toBeUndefined();
    expect(pwshReportLine(st)).toContain("7（版本未知）");
  });

  it("结果缓存；重新检测时重新找（装好后点“重新检测”），宿主看到的路径随之更新", async () => {
    const w = fakeWin();
    const probe = new PwshProbe(w.deps);
    expect(probe.snapshot()).toMatchObject({ applicable: true, checking: true });
    expect(await probe.check()).toMatchObject({ missing: true });
    const n = w.lstats.length;
    expect(await probe.check()).toMatchObject({ missing: true });
    expect(probe.snapshot()).toMatchObject({ missing: true });
    expect(w.lstats.length).toBe(n);
    expect(probe.cachedDshPath).toBeUndefined();
    w.addExe(`${PF}\\PowerShell\\7\\pwsh.exe`);
    expect(await probe.check(true)).toMatchObject({ found: true, missing: false });
    expect(w.lstats.length).toBeGreaterThan(n);
    expect(probe.cachedDshPath).toBe(`${PF}\\PowerShell\\7\\pwsh.exe`);
    expect(probe.snapshot()).toMatchObject({ found: true, missing: false });
  });

  it("AMB_PWSH_FORCE=missing：任何平台都模拟“未安装”（截图、测试），不影响 DSH", async () => {
    const w = fakeWin({ exes: { [`${PF}\\PowerShell\\7\\pwsh.exe`]: "file" } });
    for (const platform of ["linux", "win32"] as const) {
      const probe = new PwshProbe({ ...w.deps, platform, env: { ...ENV, AMB_PWSH_FORCE: "missing" } });
      expect(probe.applicable).toBe(true);
      expect(await probe.check()).toMatchObject({ applicable: true, found: false, missing: true, forced: true });
      expect(await probe.dshPath()).toBeUndefined();
      expect(probe.cachedDshPath).toBeUndefined();
    }
    expect(w.lstats).toEqual([]);
  });

  it("版本号：pwsh -Version 拉起时隐藏窗口、有超时", async () => {
    spawned.length = 0;
    const exe = `${APPS}\\pwsh.exe`;
    expect(await readPwshVersion({ path: exe, source: "store" }, { readFile: async () => "{}" })).toBe("7.5.4");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ exe, args: ["-Version"], opts: { windowsHide: true } });
    expect(spawned[0].opts.timeout).toBeGreaterThan(0);
    expect(spawned[0].opts.timeout).toBeLessThanOrEqual(10_000);
    expect(parsePwshVersion("PowerShell 7.6.0-preview.5\n")).toBe("7.6.0-preview.5");
    expect(parsePwshVersion("garbage")).toBeUndefined();
  });
});

describe("界面接口与诊断（AMB_PWSH_FORCE=missing）", () => {
  let app: App;
  let base = "";
  const TOKEN = "ui-token-pwsh-0123456789";
  const prev = process.env.AMB_PWSH_FORCE;
  const api = async (p: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}/amb/api${p}`, {
      method: init.method ?? "GET",
      headers: { "x-amb-token": TOKEN, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    process.env.AMB_PWSH_FORCE = "missing";
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-pwsh-"));
    const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_UI_PORT: "0", AMB_UI_TOKEN: TOKEN, AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } });
    app = new App(config, { printQrToTerminal: false });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  });
  afterAll(async () => {
    await app?.stop();
    if (prev === undefined) delete process.env.AMB_PWSH_FORCE;
    else process.env.AMB_PWSH_FORCE = prev;
  });

  it("GET /pwsh、诊断状态与复制的报告都带 PowerShell 状态", async () => {
    const r = await api("/pwsh");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ applicable: true, found: false, missing: true, forced: true, dismissed: false });
    expect((await api("/diagnostics")).json.pwsh).toMatchObject({ applicable: true, missing: true });
    expect((await api("/diagnostics/report")).json.text).toContain("[PowerShell] 未安装 PowerShell 7");
  });

  it("重新检测；“不再提示”写进 config.json，重启后还在", async () => {
    expect((await api("/pwsh/recheck", { method: "POST", body: {} })).json).toMatchObject({ missing: true, dismissed: false });
    const r = await api("/pwsh", { method: "PUT", body: { dismissed: true } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ missing: true, dismissed: true });
    expect(JSON.parse(fs.readFileSync(path.join(app.config.dataDir, "config.json"), "utf8")).ui.pwshHintDismissed).toBe(true);
    expect(loadConfig({ dataDir: app.config.dataDir, env: {} }).ui.pwshHintDismissed).toBe(true);
    expect((await api("/pwsh")).json.dismissed).toBe(true);
    expect((await api("/pwsh", { method: "DELETE" })).status).toBe(405);
  });
});
