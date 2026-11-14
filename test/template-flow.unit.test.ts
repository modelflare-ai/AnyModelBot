import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let flow: any; let dialog: any;
const draft = () => ({ id: "writer", name: "Writer 2", initialName: "Writer 2", persona: "Original", initialPersona: "Original", avatar: "writing", busy: false });
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  vi.stubGlobal("location", { hash: "#/templates/writer" });
  // @ts-expect-error Unbundled browser JS.
  flow = await import("../ui/lib/template-flow.js");
  // @ts-expect-error Unbundled browser JS.
  ({ dialog } = await import("../ui/lib/store.js"));
});
afterEach(() => vi.unstubAllGlobals());
describe("模板导航与草稿", () => {
  it("名称含自动后缀未改过、只改头像或模型时，直接返回", async () => {
    flow.templateFlow.set({ entry: "new", category: "writing", scroll: 300, preview: { ...draft(), avatar: "red", model: "m2" } });
    expect(await flow.mayLeaveTemplate("#/templates")).toBe(true); expect(dialog.get()).toBe(null);
    expect(flow.templateFlow.get()).toMatchObject({ entry: "new", category: "writing", scroll: 300, preview: null });
  });
  it("改名后取消（含Esc/遮罩的false结果）保留修改，只有明确放弃才离开", async () => {
    flow.templateFlow.set({ preview: { ...draft(), name: "My writer" } });
    const leave = flow.mayLeaveTemplate("#/chat/default");
    expect(dialog.get()).toMatchObject({ cancelVariant: "primary", confirmVariant: "ghost" });
    const d = dialog.get(); dialog.set(null); d.resolve(false);
    expect(await leave).toBe(false); expect(flow.templateFlow.get().preview.name).toBe("My writer");
    const again = flow.mayLeaveTemplate("#/new?fresh=1"); dialog.get().resolve(true);
    expect(await again).toBe(true); expect(flow.templateFlow.get().preview).toBe(null);
  });
  it("从加号或命令面板重开画廊不会绕过预览修改确认", async () => {
    flow.templateFlow.set({ entry: "new", preview: { ...draft(), persona: "Changed" } });
    const opening = flow.openTemplates(); await Promise.resolve();
    dialog.get().resolve(false); await opening;
    expect(location.hash).toBe("#/templates/writer");
    expect(flow.templateFlow.get()).toMatchObject({ entry: "new", preview: { persona: "Changed" } });
  });
  it("新建页的完整草稿进入画廊后仍在；创建中禁止离开", async () => {
    const form = { name: "Mine", prompt: "My text", avatar: "green", model: "m1" };
    flow.blankBotDraft.set(form); await flow.openTemplates("new");
    expect(flow.blankBotDraft.get()).toEqual(form);
    flow.templateFlow.set({ preview: { ...draft(), busy: true } });
    expect(await flow.mayLeaveTemplate("#/discover")).toBe(false);
  });
});
