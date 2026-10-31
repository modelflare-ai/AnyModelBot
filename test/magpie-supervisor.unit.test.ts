/** magpie 守护：起不来时只有一条重启链，同一时间只有一个实例，stop() 之后不再拉起、不留实例。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MagpieSupervisor } from "../src/magpie/supervisor.js";
import { until } from "./helpers.js";

const realSetTimeout = globalThis.setTimeout;
const sleep = (ms: number) => new Promise((r) => realSetTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let dir: string;
let sup: MagpieSupervisor | undefined;
let pids: () => number[] = () => [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-magpie-"));
});
afterEach(async () => {
  await sup?.stop();
  sup = undefined;
  vi.restoreAllMocks();
  for (const pid of pids()) if (alive(pid)) process.kill(pid, "SIGKILL");
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 假的 magpie（Node 脚本）：前 failFirst 次 `web` 立刻退出，之后在网关和网页端口上回 200；端口被占就退出。
 * 每次运行记一行 "<pid> <参数>"。返回可执行文件路径。
 */
function fakeMagpie(failFirst: number): string {
  const log = path.join(dir, "calls.log");
  const bin = path.join(dir, "magpie-fake");
  fs.writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("node:fs");
const http = require("node:http");
const LOG = ${JSON.stringify(log)};
const args = process.argv.slice(2);
fs.appendFileSync(LOG, process.pid + " " + args.join(" ") + "\\n");
if (args[0] !== "web") process.exit(0);
const n = fs.readFileSync(LOG, "utf8").split("\\n").filter((l) => l.includes(" web ")).length;
if (n <= ${failFirst}) process.exit(1);
const listen = (addr) => new Promise((ok, fail) => {
  const [host, port] = addr.split(":");
  const s = http.createServer((req, res) => res.end("{}"));
  s.on("error", fail);
  s.listen(Number(port), host, ok);
});
Promise.all([listen(process.env.MAGPIE_ADDR), listen(args[args.indexOf("--addr") + 1])]).catch(() => process.exit(1));
`,
    { mode: 0o755 },
  );
  pids = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").split("\n").filter((l) => l.includes(" web ")).map((l) => Number(l.split(" ")[0]));
  return bin;
}

/** 时间缩短 20 倍：重启退避（1 s、2 s、4 s…）和健康检查的轮询间隔（200 ms）一起缩，先后顺序和真实的一样 */
function fastBackoff() {
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) => realSetTimeout(fn, Math.ceil((ms ?? 0) / 20), ...a)) as any);
}

describe.skipIf(process.platform === "win32")("magpie supervisor restarts", () => {
  it("a magpie that keeps failing is retried on one chain, and nothing is spawned after stop()", async () => {
    const bin = fakeMagpie(Infinity);
    fastBackoff();
    sup = new MagpieSupervisor({ dataDir: dir, binPath: bin, healthTimeoutMs: 3000 });
    await expect(sup.start()).rejects.toThrow(/exited during startup/);
    await sleep(3000);
    const spawns = pids().length;
    expect(spawns).toBeGreaterThan(3);
    // 每次失败只排一次重启（两处都排的话，重启链每轮翻倍）
    expect(sup.restarts).toBeLessThanOrEqual(spawns);
    await sup.stop();
    expect(sup.state).toBe("stopped");
    const atStop = pids().length;
    await sleep(1500);
    expect(pids().length, "magpie was spawned again after stop()").toBe(atStop);
  }, 20_000);

  it("the instance that came up is the one tracked: stop() leaves no magpie running", async () => {
    const bin = fakeMagpie(2);
    fastBackoff();
    sup = new MagpieSupervisor({ dataDir: dir, binPath: bin, healthTimeoutMs: 3000 });
    await expect(sup.start()).rejects.toThrow(/exited during startup/);
    await until(() => sup!.state === "running", 10_000);
    // 第二条重启链（如果有）这时会再拉起实例，顶掉正在跑的那个
    await sleep(1500);
    const { state, restarts } = sup;
    const spawned = pids();
    const pidFile = fs.readFileSync(path.join(dir, "magpie", "magpie.pid"), "utf8");
    await sup.stop();
    expect(pids().filter(alive), "a magpie instance is still running after stop()").toEqual([]);
    expect(state).toBe("running");
    expect(spawned).toHaveLength(3);
    expect(restarts).toBe(2);
    expect(pidFile).toBe(String(spawned[2]));
  }, 20_000);
});
