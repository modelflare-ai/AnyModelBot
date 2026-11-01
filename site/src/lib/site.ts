// 站点级数据：部署值（环境变量，缺省时保留占位符，生产构建由 check-placeholders 拦下）、下载数据、价格快照。
import { z } from "zod";
import releasesJson from "../data/releases.json";
import snapshotJson from "../data/pricing.snapshot.json";
import githubJson from "../data/github.json";
import type { Snapshot } from "./pricing";

const env = (k: string) => (import.meta.env[k] as string | undefined) || process.env[k] || `{${k}}`;

export const SITE_DOMAIN = env("SITE_DOMAIN");
export const GITHUB_URL = env("GITHUB_URL");
export const SECURITY_EMAIL = env("SECURITY_EMAIL");
// 统计是可选的：没配置时页面不加载统计脚本（不留占位符）
const optional = (k: string) => (import.meta.env[k] as string | undefined) || process.env[k] || "";
export const ANALYTICS_SCRIPT_URL = optional("ANALYTICS_SCRIPT_URL");
export const ANALYTICS_SITE_ID = optional("ANALYTICS_SITE_ID");
export const ORIGIN = `https://${SITE_DOMAIN}`;
/** GitHub 星数：构建时取（scripts/fetch-github-stars.ts），不在浏览器里请求 */
export const githubStars = z.object({ stars: z.number().int().nonnegative() }).parse(githubJson).stars;

/** 跳到 Modelflare 的链接都带来源参数：全项目统一 utm_source=anymodelbot&utm_campaign=amb_<位置>，官网是 amb_homepage */
export const MF_UTM = "utm_source=anymodelbot&utm_campaign=amb_homepage";
const mf = (url: string) => `${url}${url.includes("?") ? "&" : "?"}${MF_UTM}`;

export const MF = {
  home: mf("https://modelflare.dev/"),
  pricing: mf("https://modelflare.dev/pricing"),
  docs: mf("https://docs.modelflare.dev/"),
};

const Bin = z.object({ url: z.string().min(1), sha256: z.string().min(1), sizeMB: z.number().nonnegative() });
const Releases = z.object({
  version: z.string().min(1),
  publishedAt: z.string().min(1),
  platforms: z.object({
    "win-x64": Bin,
    "mac-arm64": Bin,
    "mac-x64": Bin,
    "linux-x64": Bin,
    docker: z.object({ image: z.string().min(1), command: z.string().min(1) }),
  }),
});
export const releases = Releases.parse(releasesJson);
export type PlatformId = "win-x64" | "mac-arm64" | "mac-x64" | "linux-x64";
export const PLATFORMS: PlatformId[] = ["win-x64", "mac-arm64", "mac-x64", "linux-x64"];

export const pricing = snapshotJson as Snapshot;
export const rowOf = (model: string) => pricing.rows.find((r) => r.model === model);
