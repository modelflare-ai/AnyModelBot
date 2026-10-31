#!/usr/bin/env node
// 升级应用内置的 PowerShell 7 时用：打印某个版本 win-x64 / win-arm64 zip 的 SHA256 和大小，贴进 src/agent/pwsh-private.ts 的 PRIVATE_PWSH。
// 哈希取自该 release 里的 hashes.sha256，再和 GitHub API 的 asset digest 对一遍（不一致就报错）；--verify 时再把两个 zip 下载下来复算。
// 选版本：最新的稳定版或 LTS（不要 preview / rc）；再看一眼 .NET 支持的最低 Windows 版本，必要时改 minBuild。
//
//   node scripts/pwsh-hashes.mjs 7.6.9 [--verify]
import crypto from "node:crypto";

const args = process.argv.slice(2);
const ver = args.find((a) => !a.startsWith("--"));
const verify = args.includes("--verify");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(ver ?? "")) {
  console.error("usage: node scripts/pwsh-hashes.mjs <version> [--verify]");
  process.exit(2);
}
const base = `https://github.com/PowerShell/PowerShell/releases/download/v${ver}`;
const names = { x64: `PowerShell-${ver}-win-x64.zip`, arm64: `PowerShell-${ver}-win-arm64.zip` };

async function get(url, headers = {}) {
  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

// 1. release 里的 hashes.sha256（"<hex> *<文件名>"；这个文件是 UTF-16LE 带 BOM 的）
const raw = Buffer.from(await (await get(`${base}/hashes.sha256`)).arrayBuffer());
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.subarray(2).toString("utf16le") : raw.toString("utf8").replace(/^\uFEFF/, "");
const listed = {};
for (const line of text.split(/\r?\n/)) {
  const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
  if (m) listed[m[2]] = m[1].toLowerCase();
}
// 2. GitHub API：asset 的 digest 与大小，release 是否预发布（GITHUB_TOKEN 可选，只用来放宽限流）
const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
const rel = await (await get(`https://api.github.com/repos/PowerShell/PowerShell/releases/tags/v${ver}`, { accept: "application/vnd.github+json", ...auth })).json();
if (rel.prerelease) console.error(`warning: v${ver} is a prerelease; pin a stable or LTS release`);

const out = { sha256: {}, size: {} };
for (const [arch, name] of Object.entries(names)) {
  const sha = listed[name];
  const asset = (rel.assets ?? []).find((a) => a.name === name);
  if (!sha || !asset) throw new Error(`${name} is missing from the v${ver} release`);
  const digest = String(asset.digest ?? "").replace(/^sha256:/, "").toLowerCase();
  if (digest && digest !== sha) throw new Error(`${name}: hashes.sha256 says ${sha}, the API digest says ${digest}`);
  if (verify) {
    const buf = Buffer.from(await (await get(`${base}/${name}`)).arrayBuffer());
    const got = crypto.createHash("sha256").update(buf).digest("hex");
    if (got !== sha || buf.length !== asset.size) throw new Error(`${name}: downloaded ${got} (${buf.length} bytes), expected ${sha} (${asset.size} bytes)`);
    console.error(`verified ${name}: ${buf.length} bytes`);
  }
  out.sha256[arch] = sha;
  out.size[arch] = asset.size;
}

console.log(`// ${rel.name ?? `v${ver}`}, published ${rel.published_at}; hashes from the release's hashes.sha256, matching the GitHub API asset digests${verify ? " and the downloaded zips" : ""}
  version: "${ver}",
  sha256: {
    x64: "${out.sha256.x64}",
    arm64: "${out.sha256.arm64}",
  },
  size: { x64: ${out.size.x64}, arm64: ${out.size.arm64} },`);
