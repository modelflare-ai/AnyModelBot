#!/usr/bin/env node
// 从 vendor/magpie 源码构建 magpie（无 GUI，纯 Go，CGO_ENABLED=0，可交叉编译）。
// 用法：node scripts/build-magpie.mjs [--target current|all|<goos>/<goarch>,...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "vendor", "magpie");
const out = path.join(root, "build", "bin");
const MIN_GO = [1, 26, 8];

const GOOS = { linux: "linux", darwin: "darwin", win32: "windows" };
const GOARCH = { x64: "amd64", arm64: "arm64" };
const NODE_OS = Object.fromEntries(Object.entries(GOOS).map(([k, v]) => [v, k]));
const NODE_ARCH = Object.fromEntries(Object.entries(GOARCH).map(([k, v]) => [v, k]));
const ALL = ["linux/amd64", "linux/arm64", "darwin/amd64", "darwin/arm64", "windows/amd64", "windows/arm64"];

function arg(name, d) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : d;
}

if (!fs.existsSync(path.join(src, "go.mod"))) {
  console.error("vendor/magpie 不存在：请先运行 git submodule update --init --depth 1 vendor/magpie");
  process.exit(1);
}
let gover;
try {
  gover = execFileSync("go", ["env", "GOVERSION"], { encoding: "utf8" }).trim();
} catch {
  console.error(`找不到 Go 工具链：请安装 Go ${MIN_GO.join(".")}+（https://go.dev/dl/）`);
  process.exit(1);
}
const v = gover.replace(/^go/, "").split(/[.-]/).map(Number);
const ok = v[0] > MIN_GO[0] || (v[0] === MIN_GO[0] && (v[1] > MIN_GO[1] || (v[1] === MIN_GO[1] && (v[2] || 0) >= MIN_GO[2])));
if (!ok) console.warn(`警告：${gover} 低于 magpie 要求的 go${MIN_GO.join(".")}，Go 会尝试自动下载工具链（GOTOOLCHAIN=auto）`);

let version = "dev";
try {
  version = execFileSync("git", ["-C", src, "describe", "--tags", "--always"], { encoding: "utf8" }).trim();
} catch {}

const t = arg("--target", "current");
const current = `${GOOS[process.platform]}/${GOARCH[process.arch]}`;
const targets = t === "all" ? ALL : t === "current" ? [current] : t.split(",");
fs.mkdirSync(out, { recursive: true });
for (const target of targets) {
  const [goos, goarch] = target.split("/");
  const name = `magpie-${NODE_OS[goos]}-${NODE_ARCH[goarch]}${goos === "windows" ? ".exe" : ""}`;
  const dest = path.join(out, name);
  console.log(`构建 magpie ${version} → build/bin/${name}`);
  execFileSync("go", ["build", "-tags", "nogui", "-trimpath", "-ldflags", `-s -w -X main.version=${version}`, "-o", dest, "."], {
    cwd: src,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
  });
  if (target === current) {
    const generic = path.join(out, `magpie${goos === "windows" ? ".exe" : ""}`);
    fs.copyFileSync(dest, generic);
    fs.chmodSync(generic, 0o755);
  }
}
console.log("完成");
