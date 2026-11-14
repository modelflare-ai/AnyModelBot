import { describe, expect, it } from "vitest";
import { accountProfile } from "../src/account/profile.js";
describe("账户基本资料显示", () => {
  it("按昵称、自设用户名、邮箱前缀、脱敏电话顺序回退", () => {
    const base = { nickname: " Ada ", username: "ada-l", email: "ada@example.com", phone: "13812341234" };
    expect(accountProfile(base).name).toBe("Ada");
    expect(accountProfile({ ...base, nickname: "" }).name).toBe("ada-l");
    expect(accountProfile({ ...base, nickname: "", username: "mf_a1b2" }).name).toBe("ada");
    expect(accountProfile({ ...base, nickname: "", username: "mf_a1b2", email: "" }).name).toBe("138****1234");
    expect(accountProfile({ username: "mf_a1b2" }).name).toBe("");
    expect(accountProfile({ name: "mf_a1b2", username: "mf_a1b2", email: "ada@example.com" }).name).toBe("ada");
  });
  it("接受标准用户信息字段；头像仅使用 https，完整电话不进入缓存", () => {
    expect(accountProfile({ name: "Alice", preferred_username: "alice", picture: "https://example.com/me.png" })).toEqual({ name: "Alice", avatar: "https://example.com/me.png", email: "" });
    expect(accountProfile({ phone_number: "+86 13812341234", avatar_url: "javascript:alert(1)" })).toEqual({ name: "861****1234", email: "", avatar: "" });
  });
});
