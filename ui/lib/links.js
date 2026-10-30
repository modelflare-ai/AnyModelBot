// Modelflare 官网链接：都带注册来源参数（utm_source=anymodelbot），后台用它统计从本程序来的注册与充值。
export const MF_SITE = "https://modelflare.dev";
export const MF_DOCS = "https://docs.modelflare.dev";

export function mfLink(path, campaign) {
  const u = new URL(path, MF_SITE);
  u.searchParams.set("utm_source", "anymodelbot");
  u.searchParams.set("utm_medium", "app");
  if (campaign) u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

export const MF_CONSOLE = mfLink("/dashboard/overview", "console");
export const MF_KEYS = mfLink("/keys", "keys");
export const MF_SIGNUP = mfLink("/sign-up", "signup");
export const MF_TOPUP = mfLink("/billing", "topup");
export const MF_PRICING = mfLink("/pricing", "pricing");

/** 美元金额：两位小数；很小的数保留四位，避免显示成 $0.00 */
export function usd(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `$${Math.abs(v) > 0 && Math.abs(v) < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}
