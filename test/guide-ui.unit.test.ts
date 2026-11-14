import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let ui: any;
const state = () => ({ owner: "local", version: 2, done: [], skipped: [], hidden: false, seen: [], welcomeAvailable: true, primaryBotId: "default", connectedChannels: [] });
const response = (data: any) => ({ ok: true, json: async () => ({ ...data }) });
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  // @ts-expect-error Unbundled browser module.
  ui = await import("../ui/lib/guide.js");
});
afterEach(() => vi.unstubAllGlobals());
describe("首次欢迎的会话边界", () => {
  it("初次进入后保留欢迎；退出再接入同一本机身份不重放", async () => {
    const saved = state();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: any) => {
      if (options?.body && JSON.parse(options.body).entered) saved.welcomeAvailable = false;
      return response(saved);
    }));
    await ui.loadGuide(); expect(ui.guide.get().welcome).toBe(true);
    ui.enteredWelcome(); await ui.refreshGuide(); expect(ui.guide.get().welcome).toBe(true);
    ui.leaveGuideSession(); await ui.loadGuide(); expect(ui.guide.get().welcome).toBe(false);
  });
  it("退出之后迟到的进度加载不能重新打开欢迎状态", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const loading = ui.loadGuide(); ui.leaveGuideSession(); resolve(response(state())); await loading;
    expect(ui.guide.get()).toMatchObject({ loaded: false, welcome: false });
  });
  it("读取已有完成里程碑不会重新弹完成卡片", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...state(), seen: ["completed"], migration: true })));
    await ui.loadGuide(); expect(ui.isActive()).toBe(false); expect(ui.completionCard.get()).toBe(null);
  });
});
