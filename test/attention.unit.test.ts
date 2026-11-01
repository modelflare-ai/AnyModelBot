/**
 * 「需要你」（3b）：来源合在一起、排好序；有变化才通知；系统通知每项最多一次（重启也算）；健康时什么都没有。
 * 界面那一半：侧栏的「需要你」行和托盘角标在没事时不画。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store/db.js";
import { ApprovalCenter } from "../src/agent/approvals.js";
import { Attention, approvalItems, botLine, notificationOf, trayTitle, type AttentionItem } from "../src/tasks/attention.js";
import { withLang } from "../src/i18n/index.js";

const item = (o: Partial<AttentionItem> & Pick<AttentionItem, "id" | "kind">): AttentionItem => ({
  botId: "b",
  botName: "小蓝",
  subject: "GPU 价格调研",
  status: "等你回答",
  head: "「GPU 价格调研」在等你回答",
  line: "报告用中文还是英文？",
  since: 1,
  severity: "warn",
  actions: [],
  ...o,
});

/** vnode 里所有的字（只看结构，不渲染） */
const textOf = (v: any): string => (v == null || typeof v === "boolean" ? "" : typeof v !== "object" ? String(v) : Array.isArray(v) ? v.map(textOf).join("") : textOf(v.props?.children));

describe("界面：侧栏的「需要你」行", () => {
  it("没事时不画这一行；有事时是黄点、「需要你」和件数", async () => {
    // 界面模块在浏览器里跑：只补上它们加载时要的那一点
    (globalThis as any).window ??= { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    // @ts-expect-error 界面代码是不经构建的 JS
    const { NeedsRow } = await import("../ui/screens/needs-you.js");
    // @ts-expect-error 同上
    const ui = await import("../ui/lib/i18n.js");
    expect(NeedsRow({ count: 0 })).toBeNull();
    expect(NeedsRow({ count: undefined })).toBeNull();
    ui.setLangPref("zh-CN");
    const row = NeedsRow({ count: 3, on: true, onClick: () => {} }) as any;
    expect(row.props.class).toBe("needs-row sel");
    expect(textOf(row)).toBe("需要你3");
    // 文字跟着界面语言
    ui.setLangPref("en");
    expect(textOf(NeedsRow({ count: 3, on: true, onClick: () => {} }))).toBe("Needs you3");
    ui.setLangPref("zh-CN");
  });
});

describe("Attention", () => {
  let store: Store;
  let att: Attention;
  beforeEach(() => {
    store = new Store(":memory:");
    att = new Attention({ store, debounceMs: 1, intervalMs: 60_000 });
  });
  afterEach(() => {
    att.stop();
    store.close();
  });

  it("健康时什么都没有：没有项、没有件数、托盘只有应用名", () => {
    att.addSource(() => []);
    expect(att.list()).toEqual([]);
    expect(att.count()).toBe(0);
    expect(att.byBot()).toEqual({});
    expect(trayTitle("AnyModelBot", 0)).toBe("AnyModelBot");
    expect(att.takeNew()).toEqual([]);
  });

  it("排序：提问和审批在前，再是失败、没送到、登录；同一类旧的在前；同一 id 只算一次", () => {
    att.addSource(() => [item({ id: "login:b:weixin", kind: "login", since: 1 }), item({ id: "task:t2", kind: "failed", since: 2 }), item({ id: "approval:a2", kind: "approval", since: 9 })]);
    att.addSource(() => [item({ id: "task:t3", kind: "delivery", since: 0 }), item({ id: "approval:a1", kind: "question", since: 5 }), item({ id: "task:t2", kind: "failed", since: 2 })]);
    expect(att.list().map((x) => x.id)).toEqual(["approval:a1", "approval:a2", "task:t2", "task:t3", "login:b:weixin"]);
    expect(att.count()).toBe(5);
  });

  it("每个机器人几件、最早那件（侧栏机器人行的第二行）", () => {
    att.addSource(() => [item({ id: "a", kind: "question", since: 1 }), item({ id: "b", kind: "failed", since: 2, status: "失败", head: "「GPU 价格调研」失败了" }), item({ id: "c", kind: "login", botId: "g", botName: "绿草", subject: "微信登录已过期", status: "", head: "微信登录已过期" })]);
    expect(att.byBot()).toEqual({ b: { n: 2, line: "「GPU 价格调研」在等你回答" }, g: { n: 1, line: "微信登录已过期" } });
  });

  it("系统通知每项最多一次，重启后也不再给；处理掉的项从记录里清掉", () => {
    let items = [item({ id: "approval:a1", kind: "question" })];
    att.addSource(() => items);
    expect(att.takeNew().map((x) => x.id)).toEqual(["approval:a1"]);
    expect(att.takeNew()).toEqual([]);
    const again = new Attention({ store });
    again.addSource(() => items);
    expect(again.takeNew()).toEqual([]);
    items = [item({ id: "approval:a2", kind: "approval" })];
    expect(again.takeNew().map((x) => x.id)).toEqual(["approval:a2"]);
    expect(JSON.parse(store.getKV("attention:notified")!)).toEqual(["approval:a2"]);
  });

  it("订阅：立即拿到一份；有变化才再通知（kick 合并同一时刻的几次）", async () => {
    let items: AttentionItem[] = [];
    att.addSource(() => items);
    const seen: number[] = [];
    const off = att.onChange((x) => seen.push(x.length));
    expect(seen).toEqual([0]);
    att.kick();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([0]);
    items = [item({ id: "a", kind: "question" })];
    att.kick();
    att.kick();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([0, 1]);
    off();
    items = [];
    att.kick();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([0, 1]);
  });

  it("系统通知的样子：标题「小蓝 需要你」，正文「GPU 价格调研：报告用中文还是英文？」", () => {
    expect(notificationOf(item({ id: "a", kind: "question" }))).toEqual({ title: "小蓝 需要你", body: "GPU 价格调研：报告用中文还是英文？" });
    expect(notificationOf(item({ id: "l", kind: "login", subject: "微信登录已过期", status: "", head: "微信登录已过期", line: "" }))).toEqual({ title: "小蓝 需要你", body: "微信登录已过期" });
    expect(botLine(item({ id: "f", kind: "failed", status: "失败", head: "「GPU 价格调研」失败了" }))).toBe("「GPU 价格调研」失败了");
    expect(trayTitle("AnyModelBot", 3)).toBe("AnyModelBot 有 3 件事需要你");
    expect(withLang("en", () => [trayTitle("AnyModelBot", 1), trayTitle("AnyModelBot", 3)])).toEqual(["AnyModelBot has 1 thing that needs you", "AnyModelBot has 3 things that need you"]);
  });

  it("审批中心那一份：任务的以任务名为题，聊天里的以渠道为题；那一句（界面上的标题行）是一句话", () => {
    store.createBot({ id: "b", name: "小蓝" });
    store.ensureConversation("b", "weixin", "owner", "owner");
    const c = new ApprovalCenter(store);
    const now = Date.now();
    store.insertTask({ id: "t_1", botId: "b", conversationId: "b:weixin:owner", originMessageId: 0, originRef: "", title: "清理旧构建", brief: "", sessionId: "task-t_1", folder: "tasks/x", model: "m", permission: "workspace", budgetUsd: 1, createdAt: now, updatedAt: now });
    const a = c.create({ kind: "approval", botId: "b", conversationId: "b:weixin:owner", sessionId: "task-t_1", tool: "bash", detail: "rm -rf build/", reason: "", taskId: "t_1" });
    const q = c.create({ kind: "question", botId: "b", conversationId: "b:weixin:owner", sessionId: "chat", tool: "ask_user_question", detail: "继续吗？", reason: "", payload: JSON.stringify([{ id: "q", question: "继续吗？" }]) });
    const items = approvalItems(store, c.pendingAll());
    expect(items.find((x) => x.id === `approval:${a.id}`)).toMatchObject({ kind: "approval", subject: "清理旧构建", status: "等你批准", head: "「清理旧构建」在等你批准", line: "rm -rf build/", actions: ["approve", "deny"], taskId: "t_1", code: a.code, channel: "weixin" });
    expect(items.find((x) => x.id === `approval:${q.id}`)).toMatchObject({ kind: "question", subject: "微信", status: "等你回答", head: "微信里有个问题等你回答", line: "继续吗？", actions: ["answer"], questions: [{ id: "q", question: "继续吗？" }] });
    expect(withLang("en", () => approvalItems(store, c.pendingAll()).map((x) => x.head)).sort()).toEqual(["WeChat has a question for you", "“清理旧构建” is waiting for your approval"]);
    expect(items.find((x) => x.id === `approval:${q.id}`)!.taskId).toBeUndefined();
    expect(items.find((x) => x.id === `approval:${q.id}`)!.note).toBeUndefined();
  });

  it("任务问的有默认回答的问题：多一句不回复会怎样（任务接着在做）；没有默认的没有这一句", () => {
    store.createBot({ id: "b", name: "小蓝" });
    store.ensureConversation("b", "weixin", "owner", "owner");
    const c = new ApprovalCenter(store);
    const now = Date.now();
    store.insertTask({ id: "t_1", botId: "b", conversationId: "b:weixin:owner", originMessageId: 0, originRef: "", title: "竞品周报", brief: "", sessionId: "task-t_1", folder: "tasks/x", model: "m", permission: "workspace", budgetUsd: 1, createdAt: now, updatedAt: now });
    const ask = (question: string, dflt?: string) =>
      c.create({ kind: "question", botId: "b", conversationId: "b:weixin:owner", sessionId: "task-t_1", tool: "task_report", detail: question, reason: "", taskId: "t_1", blocking: false, ttlMs: 0, payload: JSON.stringify([{ id: "answer", question, options: [{ label: "中文" }, { label: "英文" }], ...(dflt ? { default: dflt } : {}) }]) });
    const d = ask("报告用中文还是英文？", "中文");
    const m = ask("用哪个账号付款？");
    const items = approvalItems(store, c.pendingAll());
    expect(items.find((x) => x.id === `approval:${d.id}`)).toMatchObject({ kind: "question", subject: "竞品周报", status: "等你回答", line: "报告用中文还是英文？", note: "不回复就按中文做", actions: ["answer"] });
    expect(items.find((x) => x.id === `approval:${m.id}`)!.note).toBeUndefined();
  });
});
