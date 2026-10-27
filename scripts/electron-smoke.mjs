// 桌面版冒烟测试：启动 Electron（Linux 无显示时自动用 xvfb-run），加载界面、截图、检查 /amb/api/status 与 /magpie/，然后干净退出。
// 用法：node scripts/electron-smoke.mjs [可执行文件路径，默认 node_modules 中的 electron + 当前目录]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const exe = process.argv[2];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-electron-"));
const shot = path.join(dataDir, "smoke.png");
let cmd = exe ?? require("electron");
let args = exe ? [] : ["."];
if (process.platform === "linux") args.push("--no-sandbox");
if (process.platform === "linux" && !process.env.DISPLAY) {
  args = ["-a", "-s", "-screen 0 1400x900x24", cmd, ...args];
  cmd = "xvfb-run";
}
const r = spawnSync(cmd, args, { env: { ...process.env, AMB_DATA_DIR: dataDir, AMB_UI_PORT: "0", AMB_ELECTRON_SMOKE: shot }, encoding: "utf8", timeout: 120_000 });
const out = (r.stdout || "") + (r.stderr || "");
const line = out.split("\n").find((l) => l.startsWith("SMOKE "));
if (!line) {
  console.error(out.slice(-3000));
  process.exit(1);
}
const res = JSON.parse(line.slice(6));
console.log(res, "截图：", shot);
const ok = res.hasUi && res.status === 200 && res.magpie === 200 && res.magpieState === "running" && fs.existsSync(shot);
process.exit(ok ? 0 : 1);
