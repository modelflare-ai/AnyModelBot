import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireDesktopInstance, StartupLog, type StartupApp } from "../electron/startup.js";
import { registerSecret } from "../src/log.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-startup-test-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const application = (overrides: Partial<StartupApp> = {}): StartupApp => ({
  getPath: () => path.join(dir, "anymodel bot"), getName: () => "anymodel bot", getVersion: () => "0.1.33", isPackaged: true,
  requestSingleInstanceLock: () => true, ...overrides,
});
const records = (log: StartupLog) => fs.readFileSync(log.file!, "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("desktop startup diagnostics", () => {
  it("records a denied lock before boot, without changing the primary app log or bypassing the lock", () => {
    const logs = path.join(dir, "anymodel bot", "data", "logs"); fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "app.log"), "primary instance log\n");
    let startup: StartupLog;
    const request = vi.fn(() => {
      expect(records(startup).map((x) => x.stage)).toEqual(["entry", "single_instance_lock_requested"]);
      return false;
    });
    const app = application({ requestSingleInstanceLock: request }); startup = new StartupLog(app, { env: {} });
    expect(acquireDesktopInstance(app, startup)).toBe(false); expect(request).toHaveBeenCalledOnce();
    expect(records(startup).at(-1)).toMatchObject({ stage: "single_instance_lock_result", acquired: false });
    expect(startup.dataDir).toBe(path.join(dir, "anymodel bot", "data"));
    expect(fs.readFileSync(path.join(logs, "app.log"), "utf8")).toBe("primary instance log\n");
  });
  it("preserves AMB_DATA_DIR and keeps launches in separate diagnostic files", () => {
    const custom = path.join(dir, "custom data"); const app = application();
    const first = new StartupLog(app, { env: { AMB_DATA_DIR: custom }, now: 1, pid: 1 });
    const second = new StartupLog(app, { env: { AMB_DATA_DIR: custom }, now: 1, pid: 2 });
    expect(first.dataDir).toBe(custom); expect(first.file).not.toBe(second.file);
    expect(acquireDesktopInstance(app, first)).toBe(true);
    expect(records(first).at(-1)).toMatchObject({ acquired: true });
  });
  it("uses a temporary log if the data path cannot be created, without throwing", () => {
    const blocked = path.join(dir, "a-file"); fs.writeFileSync(blocked, "not a directory");
    const startup = new StartupLog(application(), { env: { AMB_DATA_DIR: blocked }, tempDir: dir });
    expect(startup.file).toContain(path.join(dir, "anymodel-bot-startup-"));
    expect(records(startup)[0].pathError).toBeTruthy();
    expect(acquireDesktopInstance(application(), startup)).toBe(true);
  });
  it("still records a path-provider error before the ordinary app logger can exist", () => {
    const startup = new StartupLog(application({ getPath: () => { throw new Error("userData unavailable"); } }), { env: {}, tempDir: dir });
    expect(records(startup)[0]).toMatchObject({ stage: "entry", pathError: "Error: userData unavailable" });
    expect(startup.dataDir).toBeUndefined();
  });
  it("does not block startup even if both diagnostic locations are unavailable", () => {
    const blocked = path.join(dir, "a-file"); fs.writeFileSync(blocked, "not a directory");
    const app = application();
    const startup = new StartupLog(app, { env: { AMB_DATA_DIR: blocked }, tempDir: blocked });
    expect(startup.file).toBeUndefined();
    expect(acquireDesktopInstance(app, startup)).toBe(true);
  });
  it("records exceptions from Electron's lock call and propagates them to fatal-startup handling", () => {
    const app = application({ requestSingleInstanceLock: () => { throw new Error("lock API failed"); } });
    const startup = new StartupLog(app, { env: {} });
    expect(() => acquireDesktopInstance(app, startup)).toThrow("lock API failed");
    expect(records(startup).at(-1)).toMatchObject({ stage: "single_instance_lock_error", error: "Error: lock API failed" });
  });
  it("does not dump environment values and redacts recorded errors", () => {
    const secret = "startup-test-private-value"; registerSecret(secret);
    const startup = new StartupLog(application(), { env: { NODE_OPTIONS: `--require=${secret}`, ELECTRON_RUN_AS_NODE: "1", ANOTHER_SECRET: secret } });
    startup.record("boot_failed", { error: `error ${secret} https://localhost/?token=${secret}`, password: secret });
    const text = fs.readFileSync(startup.file!, "utf8");
    expect(text).not.toContain(secret); expect(text).not.toContain("ANOTHER_SECRET");
    expect(records(startup)[0]).toMatchObject({ nodeOptionsPresent: true, runAsNodePresent: true });
  });
  it("prunes only older startup logs after acquiring the lock", () => {
    const app = application(); const files: string[] = [];
    for (let i = 0; i < 24; i++) {
      const s = new StartupLog(app, { env: {}, now: 100 + i, pid: i + 1 });
      fs.utimesSync(s.file!, i + 1, i + 1); files.push(s.file!);
    }
    const current = new StartupLog(app, { env: {}, now: 200, pid: 100 });
    fs.writeFileSync(path.join(path.dirname(current.file!), "keep.txt"), "other file");
    acquireDesktopInstance(app, current);
    expect(fs.readdirSync(path.dirname(current.file!)).filter((f) => f.startsWith("startup-"))).toHaveLength(20);
    expect(fs.existsSync(current.file!)).toBe(true); expect(fs.existsSync(files[0])).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(current.file!), "keep.txt"))).toBe(true);
  });
});
