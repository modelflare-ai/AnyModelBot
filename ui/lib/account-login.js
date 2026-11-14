// 浏览器授权属于应用会话；页面卸载、菜单关闭都不会取消它。
import { createStore, toast } from "./store.js";
import { api } from "./api.js";
import { t } from "./i18n.js";
export const accountLogin = createStore({ waiting: false, url: "", error: "", success: 0, account: null });
let timer = null;
let generation = 0;
let operations = Promise.resolve();
let cancelling = false;
const sequence = (fn) => { const run = operations.then(fn); operations = run.catch(() => {}); return run; };
const stopPoll = () => { clearTimeout(timer); timer = null; };
async function poll(gen) {
  if (gen !== generation || !accountLogin.get().waiting) return;
  const result = await api("/account").catch(() => null);
  if (gen !== generation) return;
  if (result?.state === "signed_in") {
    stopPoll();
    accountLogin.set((s) => ({ ...s, waiting: false, error: "", account: result, success: s.success + 1 }));
    toast(t("welcome.loginSuccess"));
    window.dispatchEvent(new Event("amb-connection-change"));
    window.dispatchEvent(new Event("amb-account-refresh"));
  } else if (result && result.state !== "signing_in") {
    stopPoll(); accountLogin.set((s) => ({ ...s, waiting: false, error: result.error || "" }));
    if (result.error) toast(result.error, "err");
  } else timer = setTimeout(() => poll(gen), 1000);
}
export async function startAccountLogin() {
  if (accountLogin.get().waiting) return;
  const gen = ++generation;
  accountLogin.set((s) => ({ ...s, waiting: true, url: "", error: "" }));
  try {
    const r = await sequence(() => api("/account/login", { method: "POST", body: {} }));
    if (gen !== generation) return;
    accountLogin.set((s) => ({ ...s, url: r.loginUrl }));
    if (!r.opened) window.open(r.loginUrl, "_blank", "noopener");
    void poll(gen);
  } catch (e) {
    if (gen !== generation) return;
    const error = t("welcome.loginFailed", { reason: e.message });
    accountLogin.set((s) => ({ ...s, waiting: false, error })); toast(error, "err");
  }
}
export async function cancelAccountLogin() {
  ++generation; stopPoll();
  accountLogin.set((s) => ({ ...s, waiting: false, url: "", error: "" }));
  cancelling = true;
  await sequence(() => api("/account/login/cancel", { method: "POST", body: {} })).catch(() => {});
  cancelling = false;
}
export function resumeAccountLogin(account) {
  if (cancelling || account?.state !== "signing_in" || accountLogin.get().waiting) return;
  accountLogin.set((s) => ({ ...s, waiting: true, url: account.loginUrl, error: "" }));
  void poll(++generation);
}
window.addEventListener("amb-sign-in", startAccountLogin);
