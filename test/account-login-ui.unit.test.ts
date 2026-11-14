import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const result = (data: unknown) => ({ ok: true, json: async () => data });
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>((r) => { resolve = r; }); return { resolve, promise }; };
let login: any;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  const win = Object.assign(new EventTarget(), { open: vi.fn(), matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  // @ts-expect-error Unbundled browser module.
  login = await import("../ui/lib/account-login.js");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("共享浏览器登录", () => {
  it("请求未返回时重复点击只启动一次；页面取消订阅不取消登录", async () => {
    const start = deferred(); let signedIn = false;
    const fetch = vi.fn(async (url: string) => url.endsWith("/login") ? start.promise : result({ state: signedIn ? "signed_in" : "signing_in" }));
    vi.stubGlobal("fetch", fetch);
    const pending = login.startAccountLogin();
    await login.startAccountLogin();
    expect(login.accountLogin.get().waiting).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
    start.resolve(result({ loginUrl: "https://example.com/authorize", opened: false })); await pending;
    const off = login.accountLogin.subscribe(() => {}); off();
    window.dispatchEvent(new Event("focus"));
    signedIn = true; await vi.advanceTimersByTimeAsync(1000);
    expect(login.accountLogin.get()).toMatchObject({ waiting: false, success: 1 });
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
    expect(window.open).toHaveBeenCalledTimes(1);
  });
  it("取消正在发起的请求后重试，旧请求不会取消新授权", async () => {
    const first = deferred(); const calls: string[] = []; let starts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/login")) return ++starts === 1 ? first.promise : result({ loginUrl: "https://example.com/new", opened: true });
      return result({ state: "signing_in" });
    }));
    const a = login.startAccountLogin(); await Promise.resolve();
    const cancel = login.cancelAccountLogin(); const b = login.startAccountLogin();
    first.resolve(result({ loginUrl: "https://example.com/old", opened: true }));
    await Promise.all([a, cancel, b]);
    expect(calls.filter((url) => url !== "/amb/api/account")).toEqual(["/amb/api/account/login", "/amb/api/account/login/cancel", "/amb/api/account/login"]);
    expect(login.accountLogin.get()).toMatchObject({ waiting: true, url: "https://example.com/new" });
  });
});
