#!/usr/bin/env node
// 下载并校验官方预编译的 Cua Driver（trycua/cua，MIT），只解出 cua-driver(.exe)、LICENSE、THIRD_PARTY_NOTICES.md
// 到 build/cua-driver/<os>-<electron arch>/，供 electron-builder extraResources 打包。
// 不下载/不打包 cua-perception（含 AGPL 的 OmniParser）或 Cua Spaces（FSL）的任何内容。
//
// 用法：node scripts/fetch-cua-driver.mjs [--target current|linux/x64,linux/arm64,darwin/x64,darwin/arm64,win32/x64,win32/arm64]
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CUA_VERSION = "0.37.0";
const BASE = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_VERSION}/`;
// 官方发布页的 SHA256（固定版本，校验失败即中止构建）
export const ASSETS = {
  "darwin-arm64": { file: `cua-driver-rs-${CUA_VERSION}-darwin-arm64.tar.gz`, sha256: "1e9b8c58cc830e080ada881ec76286529f5f1264fe9ecc371b0ae95cff98928b" },
  "darwin-x64": { file: `cua-driver-rs-${CUA_VERSION}-darwin-x86_64.tar.gz`, sha256: "2f9f0d652b2a571d210a3280028774cd640f805284868e8beef160a83fc07bfd" },
  "linux-arm64": { file: `cua-driver-rs-${CUA_VERSION}-linux-arm64.tar.gz`, sha256: "b20393b9b0c317daa05934cd6ee131b4250e34abb5967c596494634f3114fa89" },
  "linux-x64": { file: `cua-driver-rs-${CUA_VERSION}-linux-x86_64.tar.gz`, sha256: "d9421e143df6da3c695f5007f4db25fa619473d62965927e880c1dbfeeab1bf2" },
  "win32-arm64": { file: `cua-driver-rs-${CUA_VERSION}-windows-arm64.zip`, sha256: "612818fb1ebea702b5934c1d982a815375f25ac0e1b1389249c9f20f21354b70" },
  "win32-x64": { file: `cua-driver-rs-${CUA_VERSION}-windows-x86_64.zip`, sha256: "109ab57e5c0a6e13a73e2ce2daf01b338027366eb1a20c6e0b413a10610bc8e2" },
};
const KEEP = ["cua-driver", "cua-driver.exe", "LICENSE", "THIRD_PARTY_NOTICES.md"];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "build", "cua-driver");
const cacheDir = path.join(outRoot, ".cache");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function download(asset) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, asset.file);
  // 本地已有（缓存或 AMB_CUA_CACHE 目录）且哈希一致就复用
  for (const cand of [dest, process.env.AMB_CUA_CACHE && path.join(process.env.AMB_CUA_CACHE, asset.file)].filter(Boolean)) {
    if (fs.existsSync(cand) && sha256(cand) === asset.sha256) {
      if (cand !== dest) fs.copyFileSync(cand, dest);
      return dest;
    }
  }
  const res = await fetch(BASE + asset.file, { redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 ${asset.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash("sha256").update(buf).digest("hex");
  if (got !== asset.sha256) throw new Error(`SHA256 不匹配 ${asset.file}: 期望 ${asset.sha256}，实际 ${got}`);
  fs.writeFileSync(dest, buf);
  return dest;
}

function extract(archive, into) {
  if (archive.endsWith(".zip")) {
    try {
      execFileSync("unzip", ["-q", "-o", archive, "-d", into], { stdio: "inherit" });
    } catch {
      execFileSync("tar", ["-xf", archive, "-C", into], { stdio: "inherit" }); // Windows 自带 bsdtar 也能解 zip
    }
  } else execFileSync("tar", ["-xzf", archive, "-C", into], { stdio: "inherit" });
}

function findFiles(dir, names, found = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, names, found);
    else if (names.includes(e.name) && !found.has(e.name)) found.set(e.name, p);
  }
  return found;
}

export async function fetchOne(key) {
  const asset = ASSETS[key];
  if (!asset) throw new Error(`不支持的平台 ${key}`);
  const archive = await download(asset);
  if (sha256(archive) !== asset.sha256) throw new Error(`SHA256 不匹配 ${asset.file}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cua-x-"));
  try {
    extract(archive, tmp);
    const found = findFiles(tmp, KEEP);
    const bin = found.get(key.startsWith("win32") ? "cua-driver.exe" : "cua-driver");
    if (!bin) throw new Error(`${asset.file} 里没有 cua-driver 可执行文件`);
    const out = path.join(outRoot, key);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    for (const [name, p] of found) {
      if (name.startsWith("cua-driver") && p !== bin) continue;
      fs.copyFileSync(p, path.join(out, name));
    }
    if (!key.startsWith("win32")) fs.chmodSync(path.join(out, "cua-driver"), 0o755);
    console.log(`cua-driver ${CUA_VERSION} ${key} → ${path.relative(root, out)}（SHA256 已校验）`);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function targets(arg) {
  if (!arg || arg === "current") return [`${process.platform}-${process.arch}`];
  return arg.split(",").map((t) => t.trim().replace("/", "-").replace("windows", "win32").replace("amd64", "x64").replace("x86_64", "x64"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--target");
  const list = targets(i > 0 ? process.argv[i + 1] : undefined);
  try {
    for (const k of list) await fetchOne(k);
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
