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
  // 交叉准备时跳过依赖的 install 脚本：它们按宿主机而不是目标平台执行（koffi 找不到宿主机的预编译包就会用 CMake 现场编译宿主机架构）。
  // 目标平台需要的那一步（spawn-helper 可执行位）在下面补上。
  const extra = os !== process.platform || cpu !== process.arch ? [`--os=${os}`, `--cpu=${cpu}`, "--ignore-scripts"] : [];
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
// npm 包里 spawn-helper 没有可执行位；dsh-subprocess-local 的 postinstall 只修宿主机架构那份，这里修目标架构那份
const spawnHelper = path.join(nm, "node-pty", "prebuilds", keep, "spawn-helper");
if (os !== "win32" && fs.existsSync(spawnHelper)) fs.chmodSync(spawnHelper, 0o755);
// koffi：只保留目标平台目录
const koffi = path.join(nm, "@koromix");
if (fs.existsSync(koffi)) for (const pkg of fs.readdirSync(koffi)) {
  const p = path.join(koffi, pkg);
  for (const d of fs.readdirSync(p)) if (/^(linux|musl|darwin|win|freebsd|openbsd)_/.test(d) && !(d === `${os === "win32" ? "win32" : os}_${cpu}` || (os === "linux" && d === `musl_${cpu}`))) rm(path.join(p, d));
}
// 无运行价值的文件：源码映射、TypeScript 源码与声明（导出里指向 .ts 的只在 source 等自定义条件下，Node 默认不走）、
// 包说明文档。文件数直接决定 Windows 安装速度（解压 + 杀毒逐个扫描）。LICENSE、SKILL.md 等保留。
walk(nm, (p, name) => {
  if (/\.(map|ts|mts|cts|tsx|tsbuildinfo)$/.test(name)) rm(p);
  else if (/^(readme|changelog|history|contributing|code_of_conduct)([.-][^/]*)?\.(md|markdown|yaml)$/i.test(name)) rm(p);
});
// 其他平台的 libreoffice-kit 预编译包（只留当前 os-cpu）。Linux 没有原生包，libreoffice-kit 在 Linux 上用 -wasm 引擎，必须保留。
const loPrefix = "@deepseek-ai";
const loRoot = path.join(nm, loPrefix);
if (fs.existsSync(loRoot)) {
  const want = os === "linux" ? "libreoffice-kit-wasm" : `libreoffice-kit-${os === "win32" ? "win32" : os}-${cpu}`;
  for (const pkg of fs.readdirSync(loRoot)) {
    if (pkg.startsWith("libreoffice-kit-") && pkg !== want) rm(path.join(loRoot, pkg));
  }
}
// 已有平台 sharp 时丢掉 wasm 兜底（安装包体积）
const img = path.join(nm, "@img");
if (fs.existsSync(img)) {
  const hasNative = fs.readdirSync(img).some((d) => d.startsWith(`sharp-${os === "win32" ? "win32" : os}-`));
  if (hasNative) rm(path.join(img, "sharp-wasm32"));
}
// node-pty third_party 里非目标 arch 的 conpty
const ptyConpty = path.join(nm, "node-pty", "third_party", "conpty");
if (fs.existsSync(ptyConpty)) {
  for (const ver of fs.readdirSync(ptyConpty)) {
    const vdir = path.join(ptyConpty, ver);
    if (!fs.statSync(vdir).isDirectory()) continue;
    for (const archDir of fs.readdirSync(vdir)) {
      const keepArch = os === "win32" && ((cpu === "x64" && archDir === "win10-x64") || (cpu === "arm64" && archDir === "win10-arm64"));
      if (!keepArch) rm(path.join(vdir, archDir));
    }
  }
}
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
