import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cuaConfig, cuaMcpEnv, cuaRoots, CUA_INPUT_TOOLS, CUA_READ_TOOLS, CUA_TOOLS, detectCua, linuxDesktopApps, type CuaProbe } from "../src/agent/cua-driver.js";
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
  it("windows: needs an interactive session", () => {
    const files = ["/r/cua-driver.exe"];
    expect(detectCua(["/r"], probe({ platform: "win32", files })).reason).toMatch(/交互式会话/);
    expect(detectCua(["/r"], probe({ platform: "win32", files, env: { SESSIONNAME: "Console" } })).available).toBe(true);
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
