import { afterEach, describe, expect, it, vi } from "vitest";
import { previewSchedule } from "../src/tasks/schedule.js";
import { CuPermissions } from "../src/tools/computer-use/permissions.js";
import { Store } from "../src/store/db.js";

afterEach(() => vi.unstubAllGlobals());
describe("PRD：错误归类和恢复入口", () => {
  const load = async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {} });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
    // @ts-expect-error Browser JS.
    return import("../ui/lib/errors.js");
  };
  it("任意语言前缀保留状态码、请求编号，额度预占优先于鉴权和限流", async () => {
    const { classifyError, previewText } = await load();
    for (const prefix of ["", "⚠️ 代理执行失败：", "⚠️ Agent run failed: ", "⚠️ Ошибка агента: ", "エラー："]) {
      for (const status of [401, 402, 403, 429, 500]) {
        const message = `${prefix}${status} {"error":{"message":"Modelflare: Unable to reserve quota","request_id":"req_12345678"}}`;
        expect(classifyError(message)).toMatchObject({ kind: "balance", status, requestId: "req_12345678" });
      }
    }
    expect(classifyError("⚠️ 代理执行失败：403 {\"error\":\"Forbidden\"}")).toMatchObject({ kind: "forbidden", status: 403 });
    expect(classifyError("HTTP 401 invalid api key").kind).toBe("auth");
    expect(classifyError("HTTP 429 too many requests").kind).toBe("rate");
    expect(classifyError("403 model not found").kind).toBe("model");
    expect(classifyError("fetch failed").kind).toBe("network");
    expect(previewText('⚠️ 代理执行失败：403 {"message":"Unable to reserve quota"}')).not.toMatch(/403|reserve|message/);
  });
});
describe("PRD：未来30天的计划次数", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  it.each([[15, 2880], [60, 720], [120, 360], [180, 240], [1440, 30]])("每隔%d分钟有%d次", (minutes, count) => {
    expect(previewSchedule({ kind: "every", minutes, from: now, tz: "UTC" }, now).monthlyRuns).toBe(count);
  });
  it("排除今天已过去的计划，包含30天窗口末端；未来才开始的间隔按实际起点计算", () => {
    const at = Date.parse("2026-11-14T12:00:00Z");
    expect(previewSchedule({ kind: "weekly", days: [6], time: "10:00", tz: "UTC" }, at).monthlyRuns).toBe(4);
    expect(previewSchedule({ kind: "every", minutes: 1440, from: at + 10 * 86400_000, tz: "UTC" }, at).monthlyRuns).toBe(21);
    expect(previewSchedule({ kind: "every", minutes: 60, from: at + 31 * 86400_000, tz: "UTC" }, at).monthlyRuns).toBe(0);
  });
});
describe("PRD：重新打开后的权限恢复", () => {
  it("请求录屏后提示重启，重新打开仍未授权时重新回到授权状态，成功后只继续一次", async () => {
    const store = new Store(":memory:"); store.createBot({ id: "b", name: "b" });
    const conv = store.ensureConversation("b", "web", "console");
    let granted = false;
    const hooks = () => ({ status: () => ({ screen: granted ? "granted" as const : "denied" as const, accessibility: "granted" as const }), request: async () => {}, openSettings() {} });
    const p = new CuPermissions(hooks); p.bindStore(store); p.gate("b", "zoom");
    const user = store.addMessage(conv.id, "user", "操作电脑"); const message = store.addMessage(conv.id, "assistant", "");
    p.attach("b", { conversationId: conv.id, messageId: message, lastUserId: user });
    await p.request("screen"); expect(p.view().restartSuggested).toBe(true);
    const after = new CuPermissions(hooks); after.bindStore(store); const resume = vi.fn(async () => {}); after.start(resume);
    try {
      expect(after.view().restartSuggested).toBe(false);
      expect(after.view().blocked.b).toMatchObject({ state: "waiting", messageId: message });
      granted = true; await Promise.all([after.check(), after.check()]); expect(resume).toHaveBeenCalledTimes(1);
    } finally { after.stop(); store.close(); }
  });
});

describe("PRD：重新打开保留草稿", () => {
  it("保留长聊天文本、新建机器人和模板表单，恢复时不覆盖已输入内容", async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {} });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
    // @ts-expect-error Browser JS.
    const chat = await import("../ui/lib/chat-view.js");
    // @ts-expect-error Browser JS.
    const forms = await import("../ui/lib/template-flow.js");
    // @ts-expect-error Browser JS.
    const relaunch = await import("../ui/lib/relaunch.js");
    const long = "长草稿".repeat(4000);
    chat.saveChatView("long", { text: long }); forms.blankBotDraft.set({ name: "未完成的机器人", prompt: long });
    forms.templateFlow.set({ entry: "new", category: "all", preview: { id: "writer", name: "写作", model: "chosen", modelTouched: true, busy: true } });
    const saved = relaunch.relaunchDrafts();
    expect(saved.drafts.long).toBe(long);
    chat.saveChatView("long", { text: "" }); forms.blankBotDraft.set(null); forms.clearTemplatePreview();
    relaunch.restoreRelaunchDrafts(saved);
    expect(chat.chatView("long").text).toBe(long);
    expect(forms.blankBotDraft.get().prompt).toBe(long);
    expect(forms.templateFlow.get().preview).toMatchObject({ model: "chosen", modelTouched: true, busy: false });
    chat.saveChatView("long", { text: "新的内容" }); relaunch.restoreRelaunchDrafts(saved);
    expect(chat.chatView("long").text).toBe("新的内容");
  });
});
