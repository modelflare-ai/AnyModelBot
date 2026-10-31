import { describe, expect, it } from "vitest";
import { osFromStrings } from "../src/lib/platform";
import { fmt, fmtDate, href } from "../src/i18n";

describe("系统识别", () => {
  it.each([
    ["Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "win"],
    ["MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)", "mac"],
    ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", "linux"],
    ["Linux armv8l", "Mozilla/5.0 (Linux; Android 14; Pixel 8)", "mobile"],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "mobile"],
    ["", "", "unknown"],
  ])("%s → %s", (p, ua, os) => expect(osFromStrings(p, ua)).toBe(os));
  it("iPadOS 伪装成 Mac 时按手机处理", () => expect(osFromStrings("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true)).toBe("mobile"));
});

describe("i18n 工具", () => {
  it("fmt 只替换提供的变量", () => expect(fmt("{a} / {b}", { a: 1 })).toBe("1 / {b}"));
  it("日期本地化", () => {
    expect(fmtDate("2026-10-30T21:24:41+08:00", "zh")).toBe("2026-10-30 21:24");
    expect(fmtDate("2026-10-30T21:24:41+08:00", "en")).toBe("Oct 30, 2026 21:24");
  });
  it("站内链接", () => {
    expect(href("zh", "/pricing")).toBe("/pricing");
    expect(href("en", "/")).toBe("/en/");
    expect(href("en", "/pricing")).toBe("/en/pricing");
  });
});
