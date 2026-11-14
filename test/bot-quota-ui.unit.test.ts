/**
 * 设置中的余额概览、Bot 额度、金额状态，以及处理完一件事后刷新额度用的节流。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** 组件返回的 vnode 树里找节点（htm 生成的是 preact 的 vnode：type + props.children） */
function find(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, pred, out));
  else if (node && typeof node === "object") {
    if (pred(node)) out.push(node);
    find(node.props?.children, pred, out);
  }
  return out;
}
/** 节点里的文字（只看字符串和数字子节点） */
function text(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

const load = async (lang = "zh-CN") => {
  // 界面模块在浏览器里跑：只补上它们加载时要的那一点
  (globalThis as any).window ??= { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  (globalThis as any).document ??= { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} };
  (globalThis as any).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  // @ts-expect-error 界面代码是不经构建的 JS
  const i18n = await import("../ui/lib/i18n.js");
  i18n.setLangPref(lang);
  // @ts-expect-error 同上
  const balance = await import("../ui/components/account-balance.js");
  // @ts-expect-error 同上
  const links = await import("../ui/lib/links.js");
  return { ...balance, ...links };
};

const account = (over: Record<string, unknown> = {}) => ({
  state: "signed_in",
  balanceUsd: 12.345,
  bot: { balanceUsd: 0.83, remainingPercent: 83 },
  lowBalance: false,
  alerts: { lowBalanceUsd: 5, push: false },
  topupUrl: "https://modelflare.dev/billing?utm_source=anymodelbot&utm_campaign=amb_topup#amb_account=sub-1",
  error: "",
  ...over,
});

describe("设置中的余额概览", () => {
  const cls = (v: any, c: string) => find(v, (n) => n.props?.class === c);
  it("直接展示余额和 Bot 额度，充值链接带当前账户标识", async () => {
    const { AccountBalance } = await load();
    const v = AccountBalance({ account: account() });
    expect(text(cls(v, "account-balance-value")[0])).toBe("余额$12.35");
    expect(text(cls(v, "account-credit-heading")[0])).toBe("Bot 额度$0.83剩余 83%");
    expect(text(v)).toContain("Bot 额度只能在 AnyModelBot 里使用");
    expect(find(v, (n) => n.props?.role === "meter")[0].props["aria-valuenow"]).toBe(83);
    expect(find(v, (n) => n.type === "a")[0].props).toMatchObject({ href: account().topupUrl, target: "_blank" });
  });
  it("真实的零额度正常显示，很小的余额保留精度", async () => {
    const { AccountBalance } = await load();
    const v = AccountBalance({ account: account({ balanceUsd: 0.004, bot: { balanceUsd: 0, remainingPercent: 0 } }) });
    expect(text(v)).toContain("余额$0.0040");
    expect(text(cls(v, "account-credit-heading")[0])).toBe("Bot 额度$0.00剩余 0%");
  });
  it("没有 Bot 额度时只显示余额，不显示空额度区域", async () => {
    const { AccountBalance } = await load();
    const v = AccountBalance({ account: account({ bot: null }) });
    expect(cls(v, "account-credit")).toHaveLength(0);
    expect(text(cls(v, "account-balance-value")[0])).toBe("余额$12.35");
  });
  it("加载中和读取失败不显示零或旧额度", async () => {
    const { AccountBalance, balanceText } = await load();
    expect(balanceText(account({ balanceUsd: null }))).toBe("加载中");
    const v = AccountBalance({ account: account({ error: "连接失败" }) });
    expect(text(cls(v, "account-balance-value")[0])).toBe("余额暂不可用");
    expect(cls(v, "account-credit")).toHaveLength(0);
    expect(text(v)).not.toContain("$12.35");
  });
  it("低余额提示直接展示，错误状态不重复提示低余额", async () => {
    const { AccountBalance } = await load();
    expect(text(cls(AccountBalance({ account: account({ lowBalance: true }) }), "account-balance-warning")[0])).toBe("低于提醒线 $5.00");
    expect(cls(AccountBalance({ account: account({ lowBalance: true, error: "fail" }) }), "account-balance-warning")).toHaveLength(0);
  });
  it("刷新时保留已有数字，并将刷新按钮置为加载中", async () => {
    const { AccountBalance } = await load();
    const refresh = vi.fn();
    const v = AccountBalance({ account: account(), refreshing: true, onRefresh: refresh });
    expect(v.props["aria-busy"]).toBe(true);
    expect(text(v)).toContain("$12.35");
    const button = find(v, (n) => n.props?.["aria-label"] === "刷新余额")[0];
    expect(button.props.loading).toBe(true);
    expect(button.props.onClick).toBe(refresh);
  });
  it("没有账户充值链接时使用默认充值页", async () => {
    const { AccountBalance, MF_TOPUP } = await load();
    const v = AccountBalance({ account: account({ topupUrl: "" }) });
    expect(find(v, (n) => n.type === "a")[0].props.href).toBe(MF_TOPUP);
  });
  it("英文界面展示同样的信息", async () => {
    const { AccountBalance } = await load("en");
    const v = AccountBalance({ account: account() });
    expect(text(cls(v, "account-balance-value")[0])).toBe("Balance$12.35");
    expect(text(cls(v, "account-credit-heading")[0])).toBe("Bot credits$0.8383% left");
    expect(text(v)).toContain("Bot credits are usable only in AnyModelBot");
  });
});

describe("usd()", () => {
  it("默认很小的数保留四位；指定位数时按指定的", async () => {
    const { usd } = await load();
    expect(usd(0.004)).toBe("$0.0040");
    expect(usd(0.004, 2)).toBe("$0.00");
    expect(usd(12.345, 2)).toBe("$12.35");
    expect(usd(null, 2)).toBe("—");
  });
});

describe("处理完一件事后刷新额度的节流", () => {
  afterEach(() => vi.useRealTimers());

  it("第一次等 delay 再刷新；间隔内的多次并成一次，并且在最后那次之后补一次", async () => {
    vi.useFakeTimers();
    // @ts-expect-error 界面代码是不经构建的 JS
    const { trailingThrottle } = await import("../ui/lib/throttle.js");
    const fn = vi.fn();
    const run = trailingThrottle(fn, 10_000, 1500);
    run();
    run();
    vi.advanceTimersByTime(1499);
    expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    // 刚刷新过：等满 10 秒再刷，期间的调用都并进这一次
    vi.advanceTimersByTime(2000);
    run();
    vi.advanceTimersByTime(3000);
    run();
    vi.advanceTimersByTime(4999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    // 很久没刷过：又只等 delay
    vi.advanceTimersByTime(60_000);
    run();
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
