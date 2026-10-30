import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cuaConfig, cuaMcpEnv, cuaRoots, CUA_INPUT_TOOLS, CUA_READ_TOOLS, CUA_TOOLS, detectCua, linuxDesktopApps, uniqueApps, windowsAppsFrom, type CuaProbe } from "../src/agent/cua-driver.js";
import { Store } from "../src/store/db.js";

const proxy = path.join(__dirname, "..", "dsh-runtime", "plugins", "amb-cua-mcp.mjs");

describe("cua-driver detection", () => {
  const probe = (o: Partial<CuaProbe> & { files?: string[] } = {}): CuaProbe => {
    const files = new Set(o.files ?? []);
    return { platform: "linux", arch: "x64", env: {}, homedir: "/home/u", isFile: (p) => files.has(p), ...o };
  };
  it("needs the bundled binary", () => {
    expect(detectCua(["/r"], probe({ env: { DISPLAY: ":0" } })).reason).toMatch(/缺少 linux-x64/);
  });
  it("linux: X11 ok, Wayland degraded, no display unavailable", () => {
    const files = ["/r/cua-driver"];
    expect(detectCua(["/r"], probe({ files })).available).toBe(false);
    const x = detectCua(["/r"], probe({ files, env: { DISPLAY: ":0" } }));
    expect(x).toMatchObject({ available: true, bin: "/r/cua-driver" });
    expect(x.notice).toMatch(/AT-SPI/);
    const w = detectCua(["/r"], probe({ files, env: { WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" } }));
    expect(w.available).toBe(true);
    expect(w.notice).toMatch(/Wayland.*降级.*XWayland.*前台/);
  });
  it("macOS: permission guidance and --direct (unverified)", () => {
    const m = detectCua(["/r"], probe({ platform: "darwin", arch: "arm64", files: ["/r/cua-driver"] }));
    expect(m).toMatchObject({ available: true, direct: true });
    expect(m.notice).toMatch(/辅助功能.*屏幕录制/);
    expect(m.notice).toMatch(/未在真机验证/);
  });
  it("windows: interactive session via SESSIONNAME or SessionId", () => {
    const files = ["/r/cua-driver.exe"];
    const base = { platform: "win32" as const, files };
    // SESSIONNAME 非空 → 可用
    expect(detectCua(["/r"], probe({ ...base, env: { SESSIONNAME: "Console" } })).available).toBe(true);
    // 缺 SESSIONNAME 但 SessionId > 0 → 可用（GUI/Electron 常见）
    expect(detectCua(["/r"], probe({ ...base, windowsSessionId: 1 })).available).toBe(true);
    expect(detectCua(["/r"], probe({ ...base, windowsSessionId: 2, env: { USERPROFILE: "C:\\Users\\u" } })).available).toBe(true);
    // SessionId 0（服务/非交互）→ 不可用
    const s0 = detectCua(["/r"], probe({ ...base, windowsSessionId: 0 }));
    expect(s0.available).toBe(false);
    expect(s0.reason).toMatch(/交互式会话/);
    // 查不到 SessionId 且不像用户桌面 → 不可用
    expect(detectCua(["/r"], probe({ ...base, windowsSessionId: null })).reason).toMatch(/交互式会话/);
    // 查不到 SessionId 但 USERPROFILE+SystemRoot 像正常桌面 → 可用（避免误报）
    const heuristic = detectCua(
      ["/r"],
      probe({ ...base, windowsSessionId: null, env: { USERPROFILE: "C:\\Users\\Alice", SystemRoot: "C:\\Windows" } }),
    );
    expect(heuristic.available).toBe(true);
  });
  it("roots cover packaged and dev layouts", () => {
    expect(cuaRoots("/a/dsh-runtime", "linux", "x64")).toContain("/a/build/cua-driver/linux-x64");
    expect(cuaRoots("/r/dsh")).toContain("/r/cua-driver");
  });
});

describe("cua-driver config", () => {
  it("tool sets exclude risky tools; readonly preset gets read tools only", () => {
    for (const bad of ["run_script", "kill_app", "clipboard_read", "browser_click", "parse_visual_regions", "install_extension", "check_for_update", "set_config", "start_recording", "replay_trajectory"]) {
      expect(CUA_TOOLS).not.toContain(bad);
    }
    const st = { available: true, reason: "", bin: "/r/cua-driver" };
    expect(cuaConfig(st, "/h/cua", { readonly: true, apps: [] }).tools).toEqual(CUA_READ_TOOLS);
    const c = cuaConfig(st, "/h/cua", { readonly: false, apps: [{ executable: "/usr/bin/x" }] });
    expect(c.tools).toEqual([...CUA_READ_TOOLS, ...CUA_INPUT_TOOLS]);
    expect(c.manifest).toBe(path.join("/h/cua", "manifest.yaml"));
  });
  it("child env carries the display but no secrets, telemetry off", () => {
    const env = cuaMcpEnv({ DISPLAY: ":77", MODEL_PROVIDER_API_KEY: "sk-x", AWS_SECRET: "y", DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/b", PATH: "/usr/bin" }, "/home/u", "/h/cua/config.json");
    expect(env).toMatchObject({ DISPLAY: ":77", DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/b", HOME: "/home/u", DO_NOT_TRACK: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0", AMB_CUA_CONFIG: "/h/cua/config.json" });
    expect(JSON.stringify(env)).not.toMatch(/sk-x|AWS_SECRET|API_KEY/);
  });
  it("discovers linux apps from .desktop files as canonical paths", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "cua-apps-"));
    fs.mkdirSync(path.join(d, "share", "applications"), { recursive: true });
    fs.mkdirSync(path.join(d, "bin"));
    fs.writeFileSync(path.join(d, "bin", "editor"), "");
    fs.symlinkSync(path.join(d, "bin", "editor"), path.join(d, "bin", "ed-link"));
    const w = (n: string, t: string) => fs.writeFileSync(path.join(d, "share", "applications", n), t);
    w("a.desktop", "[Desktop Entry]\nExec=ed-link %F\n");
    w("b.desktop", "[Desktop Entry]\nExec=env FOO=1 editor\n");
    w("c.desktop", "[Desktop Entry]\nNoDisplay=true\nExec=hidden\n");
    w("d.desktop", "[Desktop Entry]\nExec=flatpak run org.x\n");
    w("e.desktop", "[Desktop Entry]\nExec=missing-prog\n");
    const apps = linuxDesktopApps({ XDG_DATA_HOME: path.join(d, "none"), XDG_DATA_DIRS: path.join(d, "share"), PATH: path.join(d, "bin") }, "/nonexistent");
    expect(apps).toEqual([{ executable: fs.realpathSync(path.join(d, "bin", "editor")) }]);
  });
});

describe("Windows app manifest", () => {
  it("dedupes Start-menu targets case-insensitively (v0.1.5 MCP crash loop)", () => {
    // 真实 windows-2025 runner 上的情况：系统自带的 notepad/mspaint 与开始菜单快捷方式只差大小写
    const onDisk = new Set(["C:\\Windows\\System32\\notepad.exe", "C:\\Windows\\System32\\mspaint.exe", "C:\\Windows\\explorer.exe", "C:\\Program Files\\App\\app.exe"].map((p) => p.toLowerCase()));
    const exists = (p: string) => onDisk.has(p.toLowerCase());
    const shortcuts = ["C:\\WINDOWS\\system32\\notepad.exe", "C:\\WINDOWS\\system32\\mspaint.exe", "C:\\Program Files\\App\\app.exe", "C:\\PROGRAM FILES\\APP\\APP.EXE", "C:\\gone\\x.exe", "C:\\x\\readme.txt", ""].join("\r\n");
    const apps = windowsAppsFrom({ SystemRoot: "C:\\Windows" }, shortcuts, exists, (p) => p);
    const ids = apps.map((a) => ("executable" in a ? a.executable.toLowerCase() : ""));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["c:\\program files\\app\\app.exe", "c:\\windows\\explorer.exe", "c:\\windows\\system32\\mspaint.exe", "c:\\windows\\system32\\notepad.exe"]);
    expect(uniqueApps([{ bundle_id: "com.apple.Safari" }, { bundle_id: "com.apple.safari" }], "darwin")).toHaveLength(1);
  });
});

/** 假的 cua-driver 子进程：记录写进 stdin 的消息，测试从 stdout 回消息 */
function fakeDriver() {
  const c: any = new EventEmitter();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.sent = [] as any[];
  c.stdin = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split("\n")) if (l.trim()) c.sent.push(JSON.parse(l));
      cb();
    },
  });
  c.reply = (msg: unknown) => c.stdout.write(JSON.stringify(msg) + "\n");
  c.kill = () => c.emit("exit", null);
  return c;
}

describe("cua MCP front: startup never waits for (or crash-loops on) the driver", () => {
  const setup = async (o: { list?: () => Promise<Set<string>> } = {}) => {
    const m = await import(proxy);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-front-"));
    const out: any[] = [];
    const logs: string[] = [];
    const drivers: any[] = [];
    const front = m.createFront({
      cfg: { bin: "cua-driver", manifest: path.join(dir, "m.yaml"), tools: ["click", "list_windows"], apps: [], display: true },
      env: {},
      send: (msg: any) => out.push(msg),
      log: (s: string) => logs.push(s),
      spawnDriver: () => {
        const d = fakeDriver();
        drivers.push(d);
        return d;
      },
      listTools: o.list ?? (async () => new Set(["click", "list_windows", "run_script"])),
    });
    return { front, out, logs, drivers, dir };
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it("answers initialize itself, then lists the driver's (filtered) tools once it is up", async () => {
    const { front, out, drivers } = await setup();
    await front.onClient({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(out[0]).toMatchObject({ id: 1, result: { capabilities: { tools: { listChanged: true } } } });
    await tick();
    const d = drivers[0];
    expect(d.sent[0]).toMatchObject({ method: "initialize" });
    d.reply({ jsonrpc: "2.0", id: d.sent[0].id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
    await tick();
    expect(front.ready).toBe(true);
    const listing = front.onClient({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await listing;
    const fwd = d.sent.find((x: any) => x.id === 2);
    expect(fwd.method).toBe("tools/list");
    d.reply({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "click" }, { name: "run_script" }] } });
    await tick();
    expect(out.find((x) => x.id === 2).result.tools.map((t: any) => t.name)).toEqual(["click"]);
  });

  it("a slow driver: tools/list is empty at first, then tools/list_changed", async () => {
    const { front, out, drivers } = await setup();
    await front.onClient({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await front.onClient({ jsonrpc: "2.0", id: 2, method: "tools/list" }); // waits ~3 s, driver silent
    expect(out.find((x) => x.id === 2).result.tools).toEqual([]);
    const d = drivers[0];
    d.reply({ jsonrpc: "2.0", id: d.sent[0].id, result: {} });
    await tick();
    expect(out.at(-1)).toMatchObject({ method: "notifications/tools/list_changed" });
  }, 10_000);

  it("a driver that dies at startup: no exit, no restart storm, calls report why", async () => {
    const { front, out, drivers, logs } = await setup();
    await front.onClient({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await tick();
    drivers[0].stderr.write("Error: application resources repeat an identity\n");
    drivers[0].emit("exit", 1);
    await tick();
    expect(logs.join("\n")).toContain("cua-driver mcp exited (1)");
    await front.onClient({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "click", arguments: {} } });
    const r = out.find((x) => x.id === 3);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("exited (1)");
    expect(drivers).toHaveLength(1); // retried at most once a minute, not per message
  });

  it("list-tools failing is reported the same way", async () => {
    const { front, out, drivers } = await setup({ list: async () => Promise.reject(new Error("cua-driver list-tools failed: timeout")) });
    await front.onClient({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await tick();
    await front.onClient({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "click" } });
    expect(out.find((x) => x.id === 2).result.content[0].text).toContain("list-tools failed");
    expect(drivers).toHaveLength(0);
  });
});

describe("cua MCP front (amb-cua-mcp.mjs)", () => {
  it("writes a bounded v3 manifest", async () => {
    const m = await import(proxy);
    const y = m.manifestYaml({ tools: ["click", "list_windows"], apps: [{ executable: "/usr/bin/x" }, { bundle_id: "com.a.b" }], display: true });
    expect(y).toContain("version: 3\nexpires_after: 24h\nidle_timeout: 24h");
    expect(y).toContain('    - "click"');
    expect(y).toContain('    - executable: "/usr/bin/x"');
    expect(y).toContain('    - bundle_id: "com.a.b"');
    expect(y).toContain("terminate: driver_launched");
    expect(y).toContain("  desktop:\n    display: true");
  });
  it("never repeats an app identity (cua-driver refuses to start on duplicates)", async () => {
    const m = await import(proxy);
    const apps = [{ executable: "C:\\Windows\\System32\\notepad.exe" }, { executable: "C:\\WINDOWS\\system32\\notepad.exe" }, { bundle_id: "com.A.b" }, { bundle_id: "com.a.B" }];
    expect(m.uniqueApps(apps, "win32")).toEqual([apps[0], apps[2]]);
    expect(m.uniqueApps([{ executable: "/usr/bin/x" }, { executable: "/usr/bin/X" }], "linux")).toHaveLength(2);
    const y = m.manifestYaml({ tools: ["click"], apps: process.platform === "win32" ? apps : [{ executable: "/a" }, { executable: "/a" }] });
    expect(y.match(/- (executable|bundle_id):/g)!.length).toBe(process.platform === "win32" ? 2 : 1);
  });
  it("parses list-tools and builds a bounded, telemetry-free env", async () => {
    const m = await import(proxy);
    expect([...m.parseToolList("click: Click a thing\nbrowser_x: y\n  indented: no\nnot a tool\n")]).toEqual(["click", "browser_x"]);
    const env = m.childEnv({ PATH: "/bin", AMB_CUA_CONFIG: "/c", OPENAI_API_KEY: "k", CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS: "1", ELECTRON_RUN_AS_NODE: "1" }, { manifest: "/m.yaml" });
    expect(env).toMatchObject({ PATH: "/bin", CUA_DRIVER_PERMISSION_MODE: "bounded", CUA_DRIVER_CAPABILITY_MANIFEST_FILE: "/m.yaml", CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: "1", DO_NOT_TRACK: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0", CUA_DRIVER_DISABLE_RUN_SCRIPT: "1" });
    for (const k of ["AMB_CUA_CONFIG", "OPENAI_API_KEY", "CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS", "ELECTRON_RUN_AS_NODE"]) expect(env[k]).toBeUndefined();
  });
  it("hides and refuses tools outside the allow list", async () => {
    const m = await import(proxy);
    const f = m.createFilter(new Set(["click"]));
    expect(f.fromClient({ jsonrpc: "2.0", id: 1, method: "tools/list" }).forward).toBeTruthy();
    const listed = f.fromDriver({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "click" }, { name: "run_script" }] } });
    expect(listed.result.tools.map((t: any) => t.name)).toEqual(["click"]);
    const denied = f.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kill_app" } });
    expect(denied.forward).toBeUndefined();
    expect(denied.reply.result.isError).toBe(true);
    expect(f.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "click" } }).forward).toBeTruthy();
  });
});

describe("settings migration", () => {
  it("moves existing bots to auto-run once", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "cua-mig-"));
    const f = path.join(d, "t.db");
    const s1 = new Store(f);
    const b = s1.createBot({ name: "x" } as any);
    s1.db.prepare("UPDATE bots SET settings = ? WHERE id = ?").run(JSON.stringify({ computerUse: { enabled: false, approval: "always" } }), b.id);
    s1.db.prepare("DELETE FROM kv WHERE key = 'migration.computer-use-auto'").run();
    s1.close();
    const s2 = new Store(f);
    const raw = JSON.parse(String((s2.db.prepare("SELECT settings FROM bots WHERE id = ?").get(b.id) as any).settings));
    expect(raw.computerUse).toEqual({ enabled: false, backend: "cua", approval: "auto" });
    // 之后用户自己选的 ask-input 不会再被改回
    s2.db.prepare("UPDATE bots SET settings = ? WHERE id = ?").run(JSON.stringify({ computerUse: { approval: "ask-input" } }), b.id);
    s2.close();
    const s3 = new Store(f);
    expect(s3.getBot(b.id)!.settings.computerUse.approval).toBe("ask-input");
    s3.close();
  });
});
