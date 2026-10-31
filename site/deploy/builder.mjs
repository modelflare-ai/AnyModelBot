// 构建器主循环（容器内运行）：
//   启动时构建一次 → 每天 04:00（UTC+8）再构建一次（价格每日刷新）。
//   每次构建输出到 /srv/site/builds/<时间戳>，成功后把 /srv/site/current 这个软链接原子地换过去；失败则继续用上一版。
//   只保留最近 3 版。SITE_BUILD=draft 时用草稿构建（部署值没填齐时也能先跑起来，页面上会留着占位符）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.SITE_OUT || "/srv/site";
const KEEP = 3;
const mode = process.env.SITE_BUILD === "draft" ? "build:draft" : "build";
const log = (...a) => console.log(new Date().toISOString(), ...a);

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: process.env });
    p.on("exit", (code) => resolve(code === 0));
  });
}

async function build() {
  log(`开始构建（npm run ${mode}）`);
  // 下载数据：默认读 GitHub 最新 Release（安装包由 GitHub 提供下载）；配了 DOWNLOADS_DIR 才改为读本机安装包目录
  const releases = process.env.DOWNLOADS_DIR ? "scripts/releases-from-dir.ts" : process.env.GITHUB_URL ? "scripts/releases-from-github.ts" : "";
  if (releases && !(await run("npx", ["tsx", releases]))) {
    log("生成 releases.json 失败，本次不构建");
    return;
  }
  if (!(await run("npm", ["run", mode]))) {
    log("构建失败，继续使用上一版");
    return;
  }
  const id = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");
  const dir = path.join(OUT, "builds", id);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync("dist", dir, { recursive: true });
  const tmp = path.join(OUT, `current.${process.pid}`);
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(path.join("builds", id), tmp);
  fs.renameSync(tmp, path.join(OUT, "current")); // rename 覆盖旧软链接是原子的
  const old = fs.readdirSync(path.dirname(dir)).sort().slice(0, -KEEP);
  for (const o of old) fs.rmSync(path.join(path.dirname(dir), o), { recursive: true, force: true });
  log(`已上线 builds/${id}`);
}

/** 距下一个 04:00（UTC+8，即 UTC 20:00）的毫秒数 */
function untilNextRun(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(20, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

let timer;
async function loop() {
  await build();
  const ms = untilNextRun();
  log(`下次构建在 ${Math.round(ms / 60000)} 分钟后`);
  timer = setTimeout(loop, ms);
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { clearTimeout(timer); process.exit(0); });
loop();
