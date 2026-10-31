/**
 * 来源参数的统一格式：utm_source=anymodelbot&utm_campaign=amb_<位置>，不带 utm_medium。
 * Modelflare 后台按它统计从本程序（应用、README、官网）来的注册与充值；改格式前先和后台对齐。
 */
import { describe, it, expect } from "vitest";
import { UTM, webUrl, SIGNUP_URL, TOPUP_URL, CONSOLE_URL } from "../src/modelflare.js";
// @ts-expect-error 前端模块是无类型的原生 ES 模块
import { mfLink, tagLink, MF_CONSOLE, MF_DOCS_LINK, MF_KEYS, MF_PRICING, MF_SIGNUP, MF_TOPUP } from "../ui/lib/links.js";

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("UTM 来源参数", () => {
  it("后端：只有 utm_source 和 amb_ 开头的 utm_campaign", () => {
    expect(UTM).toEqual({ utm_source: "anymodelbot" });
    expect(params(webUrl("/billing", "amb_low_balance"))).toEqual({ utm_source: "anymodelbot", utm_campaign: "amb_low_balance" });
    expect(params(SIGNUP_URL)).toEqual({ utm_source: "anymodelbot", utm_campaign: "amb_signup" });
    expect(params(TOPUP_URL).utm_campaign).toBe("amb_topup");
    expect(params(CONSOLE_URL).utm_campaign).toBe("amb_console");
  });

  it("界面：所有固定链接都是 amb_ 开头，没有 utm_medium", () => {
    for (const url of [MF_CONSOLE, MF_KEYS, MF_SIGNUP, MF_TOPUP, MF_PRICING, MF_DOCS_LINK]) {
      const p = params(url);
      expect(p.utm_source).toBe("anymodelbot");
      expect(p.utm_campaign).toMatch(/^amb_[a-z_]+$/);
      expect(p).not.toHaveProperty("utm_medium");
    }
    expect(MF_SIGNUP).toBe("https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_signup");
    expect(new URL(MF_DOCS_LINK).origin).toBe("https://docs.modelflare.dev");
    expect(params(mfLink("/pricing", "amb_pricing"))).toEqual({ utm_source: "anymodelbot", utm_campaign: "amb_pricing" });
  });

  it("服务端下发的链接：Modelflare 的页面补上参数，已带参数或别的网站不动", () => {
    expect(params(tagLink("https://modelflare.dev/blog/x", "amb_notice"))).toEqual({ utm_source: "anymodelbot", utm_campaign: "amb_notice" });
    expect(params(tagLink("https://docs.modelflare.dev/guides", "amb_notice")).utm_campaign).toBe("amb_notice");
    expect(tagLink("https://modelflare.dev/x?utm_source=mail&utm_campaign=promo", "amb_notice")).toBe("https://modelflare.dev/x?utm_source=mail&utm_campaign=promo");
    expect(tagLink("https://example.com/a", "amb_notice")).toBe("https://example.com/a");
    expect(tagLink("https://evilmodelflare.dev/a", "amb_notice")).toBe("https://evilmodelflare.dev/a");
  });
});
