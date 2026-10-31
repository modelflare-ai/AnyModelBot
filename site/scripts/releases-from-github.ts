// 从 GitHub 最新 Release 生成 src/data/releases.json：下载按钮直达 GitHub 上的安装包，官网服务器不提供下载。
// 文件名按应用 electron-builder 的 artifactName：anymodel-bot-<版本>-<系统>-<架构>.<扩展名>
//   win-x64 ← *-win-x64.exe（NSIS）   mac-arm64 / mac-x64 ← *-mac-<架构>.dmg   linux-x64 ← *-linux-(x64|x86_64).AppImage
// SHA-256 取 Release 里的 SHA256SUMS；没有时用 GitHub 给每个文件算的 digest。缺平台时保留占位符（生产构建会因此失败）。
//   GITHUB_URL     仓库地址（必填），如 https://github.com/modelflare-ai/AnyModelBot
//   GITHUB_TOKEN   可选；匿名请求每小时 60 次，构建一天一次，一般用不上
//   DOCKER_IMAGE   应用镜像名；为空时给"从源码构建"的命令
// 请求失败（重试 3 次后）退出码为 1：builder 这次不构建，继续用上一版。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoUrl = (process.env.GITHUB_URL || "").replace(/\/+$/, "").replace(/\.git$/, "");
const m = /github\.com\/([^/]+)\/([^/]+)$/.exec(repoUrl);
if (!m) {
  console.error(`GITHUB_URL 不是 GitHub 仓库地址：${repoUrl || "（空）"}`);
  process.exit(1);
}
const [owner, repo] = [m[1], m[2]];

const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "anymodelbot-site" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function get(url: string, json = true): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: json ? headers : { "user-agent": headers["user-agent"] }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return json ? await res.json() : await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

interface Asset { name: string; size: number; browser_download_url: string; digest?: string | null }
let release: { tag_name: string; published_at: string; html_url: string; assets: Asset[] };
try {
  release = await get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
} catch (e) {
  console.error(`读取最新 Release 失败：${(e as Error).message}`);
  process.exit(1);
}

const RE = /^anymodel-bot-(\d+\.\d+\.\d+)-(win|mac|linux)-(x64|arm64|x86_64)\.(exe|dmg|AppImage)$/;
const PLATFORM: Record<string, string> = { "win-x64-exe": "win-x64", "mac-arm64-dmg": "mac-arm64", "mac-x64-dmg": "mac-x64", "linux-x64-AppImage": "linux-x64", "linux-x86_64-AppImage": "linux-x64" };

// SHA256SUMS：每行 "<64 位十六进制>  <文件名>"
const sums = new Map<string, string>();
const sumsAsset = release.assets.find((a) => a.name === "SHA256SUMS");
if (sumsAsset) {
  try {
    for (const line of String(await get(sumsAsset.browser_download_url, false)).split("\n")) {
      const s = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
      if (s) sums.set(s[2].trim(), s[1].toLowerCase());
    }
  } catch (e) {
    console.warn(`读取 SHA256SUMS 失败，改用 GitHub 的 digest：${(e as Error).message}`);
  }
}

const placeholder = (id: string) => {
  const k = id.toUpperCase().replace("-", "_");
  return { url: `{${k}_URL}`, sha256: `{${k}_SHA256}`, sizeMB: 0 };
};
const platforms: Record<string, unknown> = {};
let version = release.tag_name.replace(/^v/, "");
for (const id of ["win-x64", "mac-arm64", "mac-x64", "linux-x64"]) {
  const a = release.assets.find((x) => {
    const r = RE.exec(x.name);
    return r && PLATFORM[`${r[2]}-${r[3]}-${r[4]}`] === id;
  });
  const sha = a && (sums.get(a.name) || (a.digest?.startsWith("sha256:") ? a.digest.slice(7) : ""));
  if (!a || !sha) {
    platforms[id] = placeholder(id);
    continue;
  }
  version = RE.exec(a.name)![1];
  platforms[id] = { url: a.browser_download_url, sha256: sha, sizeMB: Math.round((a.size / 1048576) * 10) / 10 };
}

// 还没发布镜像（DOCKER_IMAGE 为空）时给"从源码构建"的命令，和 README 的写法一致
const image = process.env.DOCKER_IMAGE || "anymodel-bot";
const runCmd = `docker run -d --name amb -p 3600:3600 -v amb-data:/data ${image}`;
platforms.docker = {
  image,
  command: process.env.DOCKER_IMAGE ? runCmd : `git clone ${repoUrl}.git && cd ${repo} && git submodule update --init --depth 1 vendor/magpie && docker build -t ${image} . && ${runCmd}`,
};

const out = {
  version,
  // 发布日期按 UTC+8 记
  publishedAt: new Date(Date.parse(release.published_at) + 8 * 3600_000).toISOString().slice(0, 10),
  platforms,
};
fs.writeFileSync(path.join(root, "src/data/releases.json"), JSON.stringify(out, null, 2) + "\n");
const missing = Object.entries(platforms).filter(([, v]) => /\{[A-Z0-9_]+\}/.test(JSON.stringify(v))).map(([k]) => k);
console.log(`releases.json：${release.tag_name}（${release.html_url}）${missing.length ? `，缺少 ${missing.join("、")}` : "，四个平台齐全"}`);
