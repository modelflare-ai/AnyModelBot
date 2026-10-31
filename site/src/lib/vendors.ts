// 厂商名 → 标志（src/data/vendor-logos.ts）。价格快照里的厂商名照 Modelflare 写（"Moonshot AI"、"Zhipu AI"），
// 先归一化成小写字母数字再查；查不到（比如"快手"）就返回 null，组件改用首字母小圆片。
import { VENDOR_LOGOS, VENDOR_LOGOS_COLOR } from "../data/vendor-logos";

export const vendorKey = (vendor: string) => vendor.toLowerCase().replace(/[^a-z0-9]/g, "");

// 同一家厂商在别处的写法
const ALIAS: Record<string, string> = { moonshot: "moonshotai", kimi: "moonshotai", zhipu: "zhipuai", alibaba: "alibabacloud", qwen: "alibabacloud", typesafeai: "typesafe", x: "xai" };

/** 有标志时返回图标表里的键（<symbol id="vl-键">），没有时返回 null */
export function vendorLogo(vendor: string | undefined): string | null {
  if (!vendor) return null;
  const k = vendorKey(vendor);
  const key = k in VENDOR_LOGOS ? k : ALIAS[k];
  return key && key in VENDOR_LOGOS ? key : null;
}

export { VENDOR_LOGOS, VENDOR_LOGOS_COLOR };
