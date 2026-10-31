// Modelflare 官网链接：都带来源参数，后台用它统计从本程序来的注册与充值。
// 全项目统一 utm_source=anymodelbot&utm_campaign=amb_<位置>（和 src/modelflare.ts 的 UTM 一致）。
export const MF_SITE = "https://modelflare.dev";
export const MF_DOCS = "https://docs.modelflare.dev";

export function mfLink(path, campaign) {
  const u = new URL(path, MF_SITE);
  u.searchParams.set("utm_source", "anymodelbot");
  if (campaign) u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

export const MF_CONSOLE = mfLink("/dashboard/overview", "amb_console");
export const MF_KEYS = mfLink("/keys", "amb_keys");
export const MF_SIGNUP = mfLink("/sign-up", "amb_signup");
export const MF_TOPUP = mfLink("/billing", "amb_topup");
export const MF_PRICING = mfLink("/pricing", "amb_pricing");
/** 文档站首页（给人点的链接；MF_DOCS 是基址，拼路径用） */
export const MF_DOCS_LINK = mfLink(MF_DOCS + "/", "amb_docs");

/** 服务端下发的链接（通知等）：是 modelflare.dev 的页面、且还没带来源参数时补上；别的网站原样返回 */
export function tagLink(url, campaign) {
  try {
    const u = new URL(url, MF_SITE);
    if (!/(^|\.)modelflare\.dev$/.test(u.hostname) || u.searchParams.has("utm_source")) return u.toString();
    return mfLink(u.toString(), campaign);
  } catch {
    return url;
  }
}

/** 美元金额：两位小数；很小的数保留四位，避免显示成 $0.00 */
export function usd(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `$${Math.abs(v) > 0 && Math.abs(v) < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}
