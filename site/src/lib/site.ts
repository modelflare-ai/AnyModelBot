// 站点级数据：部署值（环境变量，缺省时保留占位符，生产构建由 check-placeholders 拦下）、下载数据、价格快照。
import { z } from "zod";
import releasesJson from "../data/releases.json";
import snapshotJson from "../data/pricing.snapshot.json";
import githubJson from "../data/github.json";
import type { Lang } from "../i18n/locales";
import type { Snapshot } from "./pricing";

const env = (k: string) => (import.meta.env[k] as string | undefined) || process.env[k] || `{${k}}`;

export const SITE_DOMAIN = env("SITE_DOMAIN");
export const GITHUB_URL = env("GITHUB_URL");
export const SECURITY_EMAIL = env("SECURITY_EMAIL");
// 统计是可选的：没配置时页面不加载统计脚本（不留占位符）
const optional = (k: string) => (import.meta.env[k] as string | undefined) || process.env[k] || "";
export const ANALYTICS_SCRIPT_URL = optional("ANALYTICS_SCRIPT_URL");
export const ANALYTICS_SITE_ID = optional("ANALYTICS_SITE_ID");
export const PARTNERS_EMAIL = "support@anymodel.bot";
export const ORIGIN = `https://${SITE_DOMAIN}`;
/** GitHub 星数的初始值：构建时取（scripts/fetch-github-stars.ts）；页面打开后由 scripts/stars.ts 换成站内 /stars.json 的值 */
export const githubStars = z.object({ stars: z.number().int().nonnegative() }).parse(githubJson).stars;

/** 跳到 Modelflare 的链接都带来源参数：全项目统一 utm_source=anymodelbot&utm_campaign=amb_<位置>，官网是 amb_homepage */
export const MF_UTM = "utm_source=anymodelbot&utm_campaign=amb_homepage";
const mf = (url: string) => `${url}${url.includes("?") ? "&" : "?"}${MF_UTM}`;
/** Modelflare 的公开页：英文在根路径（/en/pricing 会 301 到 /pricing），其他语言带前缀 */
// The external service uses /zh for its Chinese pages.
const mfLang = (lang: Lang) => lang === "zh-TW" ? "zh" : lang;
const mfPage = (lang: Lang, path: string) => mf(`https://modelflare.dev${lang === "en" ? path || "/" : `/${mfLang(lang)}${path}`}`);

export const MF = {
  home: (lang: Lang) => mfPage(lang, ""),
  pricing: (lang: Lang) => mfPage(lang, "/pricing"),
  /** 登录页：/<语言>/sign-in 先设好界面语言再登录，没有账号的人可以从这里转去注册 */
  signIn: (lang: Lang) => mf(`https://modelflare.dev/${mfLang(lang)}/sign-in`),
  docs: mf("https://docs.modelflare.dev/"),
  /**
   * 合作伙伴申请：进 Modelflare 控制台里的 AnyModelBot 合作页。
   * 控制台路径没有语言前缀（/zh/affiliate-program 是 404），要从 /<语言>/sign-in 进：它先设好界面语言再登录，已登录的人直接跳到 redirect。
   * 账号里存过语言的，进控制台后以账号语言为准；管理员账号会被 Modelflare 带去管理后台，不到合作页。
   */
  partnerApply: (lang: Lang) => mf(`https://modelflare.dev/${mfLang(lang)}/sign-in?redirect=${encodeURIComponent("/affiliate-program?tab=anymodelbot")}`),
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
