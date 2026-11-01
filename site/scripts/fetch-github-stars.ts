// 构建时取 GitHub 星数，写进 src/data/github.json（首屏的 GitHub 按钮显示，见 sections/Hero.astro）。
// 不在访客的浏览器里请求 GitHub：不用把访客 IP 发给第三方（隐私说明页的承诺），也不受匿名每小时 60 次的限制。
// 代价是数字最多晚一天：builder 每天 04:00（UTC+8）构建一次，部署时也会构建。
//   GITHUB_URL     仓库地址，如 https://github.com/modelflare-ai/AnyModelBot；没配时跳过
//   GITHUB_TOKEN   可选；匿名请求一般够用
// 取不到不算构建失败：沿用文件里的上一个值，页面上只是数字旧一点。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, "src/data/github.json");
const keep = (why: string) => console.warn(`GitHub 星数未更新（${why}），沿用上一个值`);

const m = /github\.com\/([^/]+)\/([^/.]+)/.exec(process.env.GITHUB_URL || "");
if (!m) {
  keep("GITHUB_URL 不是 GitHub 仓库地址");
  process.exit(0);
}

const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "anymodelbot-site" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

try {
  const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stars = (await res.json()).stargazers_count;
  if (!Number.isInteger(stars) || stars < 0) throw new Error(`返回的星数不对：${stars}`);
  fs.writeFileSync(file, JSON.stringify({ stars, fetchedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`GitHub 星数：${stars}`);
} catch (e) {
  keep((e as Error).message);
}
