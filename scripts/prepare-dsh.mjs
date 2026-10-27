#!/usr/bin/env node
// 安装并裁剪 DSH 代理运行时（dsh-runtime/）：npm ci + 删除其他平台的预编译二进制、source map、类型声明。
//   node scripts/prepare-dsh.mjs            # 当前平台
//   node scripts/prepare-dsh.mjs --os linux --cpu x64   # 交叉准备（npm >= 10 的 --os/--cpu）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "dsh-runtime");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const os = arg("os", process.platform);
const cpu = arg("cpu", process.arch);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (!process.argv.includes("--prune-only")) {
  const extra = os !== process.platform || cpu !== process.arch ? [`--os=${os}`, `--cpu=${cpu}`] : [];
  execFileSync(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund", ...extra], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
}

const nm = path.join(dir, "node_modules");
let removed = 0;
const rm = (p) => {
  if (!fs.existsSync(p)) return;
  removed += size(p);
  fs.rmSync(p, { recursive: true, force: true });
};
function size(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of fs.readdirSync(p)) n += size(path.join(p, e));
  return n;
}
const keep = `${os}-${cpu}`;
// node-pty 自带全平台 prebuilds
for (const pre of findDirs(nm, "prebuilds")) for (const d of fs.readdirSync(pre)) if (!d.startsWith(keep)) rm(path.join(pre, d));
// koffi：只保留目标平台目录
const koffi = path.join(nm, "@koromix");
if (fs.existsSync(koffi)) for (const pkg of fs.readdirSync(koffi)) {
  const p = path.join(koffi, pkg);
  for (const d of fs.readdirSync(p)) if (/^(linux|musl|darwin|win|freebsd|openbsd)_/.test(d) && !(d === `${os === "win32" ? "win32" : os}_${cpu}` || (os === "linux" && d === `musl_${cpu}`))) rm(path.join(p, d));
}
// 无运行价值的文件
walk(nm, (p, name) => {
  if (/\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/.test(name)) rm(p);
});
console.log(`dsh-runtime 已准备（${keep}），裁剪 ${(removed / 1048576).toFixed(1)} MB`);

function findDirs(base, name, out = []) {
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(base, e.name);
    if (e.name === name) out.push(p);
    else findDirs(p, name, out);
  }
  return out;
}
function walk(base, fn) {
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const p = path.join(base, e.name);
    if (e.isDirectory()) walk(p, fn);
    else fn(p, e.name);
  }
}
