/** Display-only account data. Missing optional identity fields never prevent sign-in. */
export interface AccountProfile { name: string; email: string; avatar: string }
export function accountProfile(value: Record<string, unknown>): AccountProfile {
  const text = (...keys: string[]) => keys.map((key) => typeof value[key] === "string" ? value[key].trim() : "").find(Boolean) || "";
  const email = text("email");
  const username = text("username", "preferred_username");
  const digits = text("phone_number", "phone", "mobile").replace(/\D/g, "");
  const phone = digits.length >= 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : "";
  const standardName = text("name");
  const name = text("nickname", "display_name") || (/^mf_[a-z0-9]+$/i.test(standardName) ? "" : standardName) || (/^mf_[a-z0-9]+$/i.test(username) ? "" : username) || (email.includes("@") ? email.split("@")[0] : "") || phone;
  let avatar = text("avatar_url", "picture", "avatar");
  try { if (new URL(avatar).protocol !== "https:") avatar = ""; } catch { avatar = ""; }
  return { name, email, avatar };
}
