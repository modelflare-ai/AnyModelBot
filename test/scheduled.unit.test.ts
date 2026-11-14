import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store, groupPeer } from "../src/store/db.js";
import { TaskService, type TaskHost, type TaskServiceOptions } from "../src/tasks/service.js";
import { DEFAULT_SETTINGS } from "../src/domain/bot-settings.js";
import { nextRun, previewSchedule, parseSchedule } from "../src/tasks/schedule.js";
import { CuPermissions } from "../src/tools/computer-use/permissions.js";

const zone = "Asia/Shanghai";
const at = (s: string) => Date.parse(s + ":00+08:00");
const daily = { kind: "daily" as const, time: "08:00", tz: zone };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

describe("定时规则的产品边界", () => {
  let store: Store;
  let service: TaskService;
  let root: string;
  let now: number;
  let prompts: string[];
  let host: TaskHost;
  const make = (options: Partial<TaskServiceOptions> = {}) => new TaskService({ store, host, now: () => now, timeZone: zone, catchupDelayMs: 0, ...options });
  const create = (o: Partial<Parameters<TaskService["createRule"]>[0]> = {}) => {
    const r = service.createRule({ botId: "bot", conversationId: "", title: "早报", instruction: "每天给我早报", schedule: daily, ...o });
    expect(r.error).toBeUndefined(); return r.rule!;
  };
  const chatCreate = async (name = "早报") => {
    const conv = store.ensureConversation("bot", "web", "console");
    store.setAgentSession(conv.id, "bot", "chat");
    const r = await service.chatTool({ botId: "bot", sessionId: "chat", op: "rule_create", args: { title: name, instruction: "每天给我早报", schedule: "daily 08:00" } });
    expect(r.error).toBeUndefined();
    return service.ruleActions(conv.id).at(-1)!;
  };
  beforeEach(() => {
    now = at("2026-11-13T07:00"); root = fs.mkdtempSync(path.join(os.tmpdir(), "amb-scheduled-"));
    store = new Store(":memory:"); store.createBot({ id: "bot", name: "日报助手" }); prompts = [];
    host = { available: true, workspace: () => root, settings: () => DEFAULT_SETTINGS, memoryPrefix: () => "", prompt: async (_id, o) => { prompts.push(o.text); return `input-${prompts.length}`; }, steer: async () => false, stop: async () => {}, cancel: async () => {}, quiet: async () => ({ quiet: true }) };
    service = make(); service.start();
  });
  afterEach(() => { service.stop(); store.close(); fs.rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

  it("每月 31 日在小月和闰年二月落到最后一天，预览与实际相同", () => {
    const s = parseSchedule("monthly 31 08:00", zone, now).schedule!;
    expect(nextRun(s, now)).toBe(at("2026-11-30T08:00"));
    expect(nextRun(s, at("2028-02-01T00:00"))).toBe(at("2028-02-29T08:00"));
    const preview = previewSchedule(s, now); expect(preview.times).toEqual([at("2026-11-30T08:00"), at("2026-12-31T08:00"), at("2027-01-31T08:00")]);
    expect(previewSchedule(parseSchedule("every 15m", zone, now).schedule!, now).monthlyRuns).toBe(2880);
  });
  it("从没聊过的机器人新建默认桌面对话；关闭的模板可无目的地", () => {
    expect(store.listConversations("bot")).toHaveLength(0);
    const r = create({ mode: "off" }); expect(r.conversationId).toBe("bot:web:console");
    expect(store.listConversations("bot")).toHaveLength(1);
    const template = create({ mode: "off", allowEmptyDestination: true, requiresGroup: true });
    expect(template.conversationId).toBe(""); expect(template.nextRunAt).toBe(0);
    expect(service.updateRule(template.id, { mode: "act" }).error).toBeTruthy();
    expect(store.getRule(template.id)?.mode).toBe("off");
    const g = store.createGroup("完整名称的群", ["bot"]);
    expect(service.updateRule(template.id, { mode: "act", conversationId: `bot:web:group:${g.id}`, sourceGroupId: g.id }).rule?.mode).toBe("act");
    for (let i = 0; i < 8; i++) store.ensureConversation("bot", "telegram", `peer${i}`, `Conversation ${i}`);
    expect(service.ruleDestinations("bot")).toHaveLength(10);
  });
  it("创建撤销持久化、列表隐藏、10 分钟内恢复，过期删除", async () => {
    const a = await chatCreate(); const b = await chatCreate("另一条");
    expect(service.undoRuleAction(a.id)).toEqual({});
    expect(service.listRules().map((r) => r.id)).toEqual([b.ruleId]);
    service.stop(); service = make(); service.start();
    expect(service.ruleActions("bot:web:console")[0].canRestore).toBe(true);
    expect(service.restoreRuleAction(a.id)).toEqual({}); expect(service.listRules()).toHaveLength(2);
    expect(service.undoRuleAction(a.id)).toEqual({}); now += 600_001; service.fireDue();
    expect(service.restoreRuleAction(a.id).error).toBeTruthy(); expect(store.getRule(a.ruleId)).toBeUndefined();
  });
  it("第一次运行和 24 小时分别终止撤销资格，旧卡不覆盖后续修改", async () => {
    const a = await chatCreate(); service.runRuleNow(a.ruleId); await flush();
    expect(service.undoRuleAction(a.id).error).toBeTruthy();
    const b = await chatCreate("周报"); service.updateRule(b.ruleId, { title: "新名字" });
    expect(service.undoRuleAction(b.id).error).toBeTruthy(); expect(store.getRule(b.ruleId)?.title).toBe("新名字");
    const c = await chatCreate("过期"); now += 86400_001; expect(service.undoRuleAction(c.id).error).toBeTruthy();
  });
  it("撤销修改恢复上一版；重名先询问；本机其他会话可以管理", async () => {
    const a = await chatCreate();
    const other = store.ensureConversation("bot", "web", "second"); store.setAgentSession(other.id, "bot", "second");
    const update = await service.chatTool({ botId: "bot", sessionId: "second", op: "rule_update", args: { rule: a.ruleId, schedule: "daily 09:00" } });
    expect(update.error).toBeUndefined(); const change = service.ruleActions(other.id)[0];
    expect(service.undoRuleAction(change.id)).toEqual({}); expect(store.getRule(a.ruleId)?.trigger).toEqual({ kind: "schedule", schedule: daily });
    await chatCreate();
    const ambiguous = await service.chatTool({ botId: "bot", sessionId: "second", op: "rule_update", args: { rule: "早报", mode: "off" } });
    expect(ambiguous.error).toMatch(/Several rules/);
  });
  it("非主人渠道会话不能列出或修改别处规则；撤销只认最近确认", async () => {
    const a = await chatCreate();
    const c = store.ensureConversation("bot", "telegram", "guest"); store.setAgentSession(c.id, "bot", "guest");
    expect((await service.chatTool({ botId: "bot", sessionId: "guest", op: "rule_update", args: { rule: a.ruleId, mode: "off" } })).error).toBeTruthy();
    const confirmation = store.addMessage("bot:web:console", "assistant", "已建好早报。"); service.finishRuleActions("bot:web:console", confirmation);
    store.addMessage("bot:web:console", "assistant", "别的回复");
    expect(service.ruleReplyAction("bot:web:console", "撤销").handled).toBe(false);
    expect(service.ruleReplyAction("bot:web:console", "撤销", "已建好早报。").handled).toBe(true);
    expect(service.ruleReplyAction("bot:web:console", "恢复").handled).toBe(true);
  });
  it("开机等一分钟，19:30 仍补 08:00 的提醒，来源和通知只产生一次", () => {
    const notify = vi.fn(); const r = create({ kind: "remind", message: "看安排" });
    service.stop(); now = at("2026-11-13T19:30"); service = make({ catchupDelayMs: 60_000, onRuleResult: notify }); service.start();
    expect(store.ruleRuns(r.id)).toHaveLength(0); now += 60_000; service.fireDue(); service.fireDue();
    expect(store.ruleRuns(r.id)).toHaveLength(1); expect(notify).toHaveBeenCalledTimes(1);
    expect(store.listMessages(r.conversationId).at(-1)?.ruleSource).toMatchObject({ ruleId: r.id, dueAt: at("2026-11-13T08:00"), late: true });
  });
  it("超过宽限或选跳过不会补跑；用户暂停后台工作时恢复不补", () => {
    const r = create({ missedPolicy: "skip" }); now = at("2026-11-13T09:40"); service.fireDue();
    expect(store.ruleRuns(r.id)[0]).toMatchObject({ outcome: "skipped", error: "app_off" });
    expect(service.getRuleView(r.id)?.needsAttention).toBe(true);
    service.updateRule(r.id, { mode: "off" }); expect(service.getRuleView(r.id)?.needsAttention).toBe(false);
    const q = create(); service.setPaused("bot", true, "test"); now = at("2026-11-14T08:00"); service.fireDue();
    service.setPaused("bot", false, "test"); expect(store.ruleRuns(q.id)[0].error).toBe("paused"); expect(prompts).toHaveLength(0);
  });
  it("补跑排队不因等待名额而超时，关闭会取消排队", () => {
    service.stop(); service = make({ maxBackground: 0 }); service.start(); const r = create();
    now = at("2026-11-13T19:30"); service.fireDue();
    expect(store.ruleRuns(r.id)[0]).toMatchObject({ cause: "catchup", state: "queued" });
    now = at("2026-11-14T00:01"); service.pump(); expect(store.ruleRuns(r.id)[0].state).toBe("queued");
    service.updateRule(r.id, { mode: "off" }); expect(store.ruleRuns(r.id)[0]).toMatchObject({ state: "ended", outcome: "stopped" });
  });
  it("跨天补日报只取原定那天 00:00 至原定 18:00，空群不调用模型", async () => {
    const g = store.createGroup("日报群", ["bot"]);
    const message = (when: string, text: string) => { const id = store.addMessage(groupPeer(g.id), "user", text); store.db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(at(when), id); };
    message("2026-11-13T09:00", "昨天上午的讨论"); message("2026-11-13T19:00", "截止之后的讨论"); message("2026-11-14T00:20", "今天凌晨的讨论");
    const r = create({ sourceGroupId: g.id, requiresGroup: true, schedule: { ...daily, time: "18:00" } });
    now = at("2026-11-14T01:00"); service.fireDue(); await flush();
    expect(prompts[0]).toContain("昨天上午的讨论"); expect(prompts[0]).not.toContain("截止之后的讨论"); expect(prompts[0]).not.toContain("今天凌晨的讨论");
    service.updateRule(r.id, { mode: "off" });
    const empty = store.createGroup("空群", ["bot"]); const q = create({ sourceGroupId: empty.id, requiresGroup: true });
    service.runRuleNow(q.id); expect(store.ruleRuns(q.id)[0]).toMatchObject({ outcome: "done", costUsd: 0, error: "group_empty" }); expect(prompts).toHaveLength(1);
    store.updateGroup(empty.id, { members: [] }); service.runRuleNow(q.id);
    expect(store.ruleRuns(q.id)[0]).toMatchObject({ outcome: "failed", error: "group_missing" });
  });
  it("宽限内回来，启动等待一分钟不会把刚获得的补跑资格过期", () => {
    const r = create({ kind: "remind", message: "看安排" });
    service.stop(); now = at("2026-11-13T19:59") + 30_000;
    service = make({ catchupDelayMs: 60_000 }); service.start(); now += 60_000; service.fireDue();
    expect(store.ruleRuns(r.id)[0]).toMatchObject({ outcome: "done", cause: "catchup" });
  });
  it("暂停期间没有定时器回调，恢复也不补那段时间的规则", () => {
    const r = create({ kind: "remind", message: "看安排" }); service.setPaused("bot", true, "test");
    now = at("2026-11-13T09:30"); service.setPaused("bot", false, "test");
    expect(store.ruleRuns(r.id)[0]).toMatchObject({ outcome: "skipped", error: "paused" });
    expect(store.listMessages(r.conversationId)).toHaveLength(0);
  });
  it("飞书回调核对账号与操作者，原卡按钮切换为恢复", async () => {
    const conv = store.ensureConversation("bot", "feishu", "oc_chat"); store.setAgentSession(conv.id, "bot", "feishu-session");
    store.putAccess({ id: "owner", botId: "bot", channel: "feishu", peerId: "oc_chat", senderId: "ou_owner", name: "owner", status: "owner", source: "first-message", code: "", text: "", requests: 1, createdAt: now, updatedAt: now, decidedAt: now, decidedBy: "", repliedAt: 0, notifiedAt: 0 });
    await service.chatTool({ botId: "bot", sessionId: "feishu-session", op: "rule_create", args: { title: "飞书早报", instruction: "每天给我早报", schedule: "daily 08:00" } });
    const action = service.ruleActions(conv.id)[0];
    expect(service.ruleCardAction("bot", action.id, "undo", "other").ok).toBe(false);
    const undone = service.ruleCardAction("bot", action.id, "undo", "ou_owner");
    expect(undone.ok).toBe(true); expect(JSON.stringify(undone.card)).toContain('"op":"restore"');
    expect(service.ruleCardAction("bot", action.id, "restore", "ou_owner").ok).toBe(true);
    expect(store.getRule(action.ruleId)?.mode).toBe("act");
  });
  it("预算耗尽不能靠开关绕过，主动关闭不会在次月恢复", () => {
    const r = create();
    store.insertEndedRun({ id: "spent", botId: "bot", ruleId: r.id, ruleVersion: 1, mode: "act", cause: "schedule", outcome: "budget", error: "month_budget", queuedAt: now, endedAt: now }); store.updateRun("spent", { costUsd: 3 }); store.updateRule(r.id, { pausedReason: "budget", nextRunAt: 0 });
    expect(service.updateRule(r.id, { mode: "act" }).error).toBeTruthy();
    service.updateRule(r.id, { mode: "off" }); now = at("2026-12-01T09:00"); service.fireDue();
    expect(store.getRule(r.id)).toMatchObject({ mode: "off", nextRunAt: 0 });
  });
});

describe("权限恢复不重放用户请求", () => {
  it("收起后仍检测；并发检测只恢复一次；有新消息时改为手动继续；重启保留待继续状态", async () => {
    const store = new Store(":memory:"); store.createBot({ id: "b", name: "b" });
    const c = store.ensureConversation("b", "web", "console");
    let granted = false;
    const hooks = () => ({ status: () => ({ accessibility: granted ? "granted" as const : "denied" as const, screen: "granted" as const }), request: async () => {}, openSettings: () => {} });
    const p = new CuPermissions(hooks); p.bindStore(store); const resumed = vi.fn(async () => {}); p.start(resumed);
    const request = store.addMessage(c.id, "user", "操作电脑"); const marker = store.addMessage(c.id, "assistant", "", undefined, { permissionWait: true });
    p.gate("b", "click"); p.attach("b", { conversationId: c.id, messageId: marker, lastUserId: request, sessionId: "session" }); p.dismiss("b"); granted = true;
    await Promise.all([p.check(), p.check()]); expect(resumed).toHaveBeenCalledTimes(1);
    granted = false; p.gate("b", "click"); p.attach("b", { conversationId: c.id, messageId: marker, lastUserId: request, sessionId: "session" });
    store.addMessage(c.id, "user", "先聊别的"); granted = true; await p.check(); expect(resumed).toHaveBeenCalledTimes(1); expect(p.view().blocked.b.state).toBe("ready"); p.stop();
    const restored = new CuPermissions(hooks); restored.bindStore(store); restored.start(resumed); await restored.check(); expect(resumed).toHaveBeenCalledTimes(1);
    await restored.check("b", true); expect(resumed).toHaveBeenCalledTimes(2); restored.stop(); store.close();
  });
});
