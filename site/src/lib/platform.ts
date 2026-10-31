// 系统识别（§12.2）：userAgentData.platform → 回退 userAgent；macOS 再尽量判断架构，判断不了时默认 Apple 芯片。
export type OS = "win" | "mac" | "linux" | "mobile" | "unknown";
export interface Platform { os: OS; arch: "arm64" | "x64" | "unknown" }

type UAData = { platform?: string; mobile?: boolean; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> };

export function osFromStrings(platform: string, ua: string, touchMac = false): OS {
  const s = `${platform} ${ua}`;
  if (/android|iphone|ipad|ipod/i.test(s) || touchMac) return "mobile";
  if (/win/i.test(platform) || /windows/i.test(ua)) return "win";
  if (/mac/i.test(platform) || /macintosh|mac os x/i.test(ua)) return "mac";
  if (/linux|x11|cros/i.test(s)) return "linux";
  return "unknown";
}

export async function detectPlatform(): Promise<Platform> {
  const uad = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  const ua = navigator.userAgent;
  // iPadOS 13+ 报自己是 Macintosh，用触点数区分
  const touchMac = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  const os = uad?.mobile ? "mobile" : osFromStrings(uad?.platform ?? navigator.platform ?? "", ua, touchMac);
  let arch: Platform["arch"] = "unknown";
  if (os === "mac" && uad?.getHighEntropyValues) {
    try {
      const v = await uad.getHighEntropyValues(["architecture"]);
      arch = v.architecture === "x86" ? "x64" : v.architecture === "arm" ? "arm64" : "unknown";
    } catch { /* 浏览器不给就按默认 */ }
  }
  return { os, arch };
}
