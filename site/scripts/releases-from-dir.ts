// 从安装包目录生成 src/data/releases.json（§12.3），不用手填版本、地址和 SHA-256。
// 文件名按应用 electron-builder 的 artifactName：anymodel-bot-<版本>-<系统>-<架构>.<扩展名>
//   win-x64 ← *-win-x64.exe（NSIS）   mac-arm64 / mac-x64 ← *-mac-<架构>.dmg   linux-x64 ← *-linux-(x64|x86_64).AppImage
// 取目录里最高的版本；该版本缺的平台保留占位符（生产构建会因此失败，提醒补齐）。
//   DOWNLOADS_DIR       安装包目录（必填）
//   DOWNLOADS_BASE_URL  下载地址前缀，默认 https://<SITE_DOMAIN>/downloads
//   DOCKER_IMAGE        应用镜像名
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = process.env.DOWNLOADS_DIR;
if (!dir) { console.error("缺少 DOWNLOADS_DIR"); process.exit(1); }

const RE = /^anymodel-bot-(\d+\.\d+\.\d+)-(win|mac|linux)-(x64|arm64|x86_64)\.(exe|dmg|AppImage)$/;
const PLATFORM: Record<string, string> = { "win-x64-exe": "win-x64", "mac-arm64-dmg": "mac-arm64", "mac-x64-dmg": "mac-x64", "linux-x64-AppImage": "linux-x64", "linux-x86_64-AppImage": "linux-x64" };
const cmpVer = (a: string, b: string) => a.split(".").map(Number).reduce((r, n, i) => r || n - Number(b.split(".")[i]), 0);

const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const found = files.flatMap((name) => {
  const m = RE.exec(name);
  const id = m && PLATFORM[`${m[2]}-${m[3]}-${m[4]}`];
  return m && id ? [{ name, version: m[1], id }] : [];
});
const version = found.map((f) => f.version).sort(cmpVer).at(-1);

const base = (process.env.DOWNLOADS_BASE_URL || `https://${process.env.SITE_DOMAIN || "{SITE_DOMAIN}"}/downloads`).replace(/\/$/, "");
const sha = (file: string) => new Promise<string>((resolve, reject) => {
  const h = crypto.createHash("sha256");
  fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});

const placeholder = (id: string) => {
  const k = id.toUpperCase().replace("-", "_");
  return { url: `{${k}_URL}`, sha256: `{${k}_SHA256}`, sizeMB: 0 };
};
const platforms: Record<string, unknown> = {};
let newest = 0;
for (const id of ["win-x64", "mac-arm64", "mac-x64", "linux-x64"]) {
  const f = found.find((x) => x.id === id && x.version === version);
  if (!f) { platforms[id] = placeholder(id); continue; }
  const full = path.join(dir, f.name);
  const st = fs.statSync(full);
  newest = Math.max(newest, st.mtimeMs);
  platforms[id] = { url: `${base}/${encodeURIComponent(f.name)}`, sha256: await sha(full), sizeMB: Math.round((st.size / 1048576) * 10) / 10 };
}
// 还没发布镜像（DOCKER_IMAGE 为空）时给"从源码构建"的命令，和 README 的写法一致
const image = process.env.DOCKER_IMAGE || "anymodel-bot";
const runCmd = `docker run -d --name amb -p 3600:3600 -v amb-data:/data ${image}`;
const repo = (process.env.GITHUB_URL || "https://github.com/modelflare-ai/AnyModelBot").replace(/\/+$/, "");
platforms.docker = {
  image,
  command: process.env.DOCKER_IMAGE ? runCmd : `git clone ${repo}.git && cd AnyModelBot && git submodule update --init --depth 1 vendor/magpie && docker build -t ${image} . && ${runCmd}`,
};

const out = {
  version: version ?? "{VERSION}",
  publishedAt: newest ? new Date(newest + 8 * 3600_000).toISOString().slice(0, 10) : "{PUBLISHED_AT}",
  platforms,
};
fs.writeFileSync(path.join(root, "src/data/releases.json"), JSON.stringify(out, null, 2) + "\n");
const missing = Object.entries(platforms).filter(([, v]) => /\{[A-Z0-9_]+\}/.test(JSON.stringify(v))).map(([k]) => k);
console.log(`releases.json：版本 ${out.version}${missing.length ? `，缺少 ${missing.join("、")}` : "，四个平台齐全"}`);
