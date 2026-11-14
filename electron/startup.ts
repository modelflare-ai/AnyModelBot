/** Startup diagnostics must exist before Electron's single-instance decision. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactValue } from "../src/log.js";

export interface StartupApp {
  getPath(name: "userData"): string;
  getName(): string;
  getVersion(): string;
  readonly isPackaged: boolean;
  requestSingleInstanceLock(): boolean;
}

/** Separate files keep a secondary launch from rotating the running app's app.log. */
export class StartupLog {
  readonly file: string | undefined;
  readonly dataDir: string | undefined;
  readonly userData: string | undefined;

  constructor(app: StartupApp, o: { env?: NodeJS.ProcessEnv; tempDir?: string; pid?: number; now?: number } = {}) {
    const env = o.env ?? process.env;
    const name = `startup-${o.now ?? Date.now()}-${o.pid ?? process.pid}.log`;
    let pathError: string | undefined;
    try {
      this.userData = app.getPath("userData");
      this.dataDir = env.AMB_DATA_DIR ? path.resolve(env.AMB_DATA_DIR) : path.join(this.userData, "data");
      const dir = path.join(this.dataDir, "logs");
      fs.mkdirSync(dir, { recursive: true });
      this.file = path.join(dir, name);
      fs.writeFileSync(this.file, "", { mode: 0o600, flag: "wx" });
    } catch (error) {
      pathError = String(error);
      this.file = undefined;
      try {
        const dir = fs.mkdtempSync(path.join(o.tempDir ?? os.tmpdir(), "anymodel-bot-startup-"));
        this.file = path.join(dir, name);
        fs.writeFileSync(this.file, "", { mode: 0o600, flag: "wx" });
      } catch { /* Diagnostics must never prevent the application from starting. */ }
    }
    this.record("entry", {
      app: app.getName(), version: app.getVersion(), packaged: app.isPackaged,
      pid: o.pid ?? process.pid, platform: process.platform, osRelease: os.release(), arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, executable: process.execPath,
      userData: this.userData, dataDir: this.dataDir, pathError,
      // No argv, login links or environment contents: they can contain credentials.
      runAsNodePresent: !!env.ELECTRON_RUN_AS_NODE, nodeOptionsPresent: !!env.NODE_OPTIONS,
    });
  }

  record(stage: string, fields: Record<string, unknown> = {}): void {
    if (!this.file) return;
    try {
      fs.appendFileSync(this.file, JSON.stringify(redactValue({ at: new Date().toISOString(), stage, ...fields })) + "\n");
    } catch { /* Keep the primary startup path independent from diagnostic I/O. */ }
  }

  /** Only the primary process prunes old launches; never touch ordinary app logs. */
  prune(): void {
    if (!this.file) return;
    try {
      const dir = path.dirname(this.file);
      const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter((f) => f.isFile() && /^startup-\d+-\d+\.log$/.test(f.name))
        .map((f) => ({ file: path.join(dir, f.name), at: fs.statSync(path.join(dir, f.name)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      for (const old of files.slice(20)) if (old.file !== this.file) fs.rmSync(old.file, { force: true });
    } catch { /* Another launch may have touched the directory. */ }
  }
}

export function acquireDesktopInstance(app: StartupApp, startup: StartupLog): boolean {
  startup.record("single_instance_lock_requested");
  try {
    const acquired = app.requestSingleInstanceLock();
    startup.record("single_instance_lock_result", { acquired });
    if (acquired) startup.prune();
    return acquired;
  } catch (error) {
    startup.record("single_instance_lock_error", { error: String(error) });
    throw error;
  }
}
