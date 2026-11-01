/**
 * 保留与清理、删除、导出、改预算（3f）：TaskService 对着假宿主和假时钟。
 * 30 天没动过的任务归档（不再列出、不能追加，等着的提问作废）；运行记录只留 30 天（任务最近的那个 run 和本月的规则运行留着）；
 * 有文件的文件夹第 27 天定下清理的日期，至少 3 天后、满 30 天才删，连同 DSH 里的会话记录（开在代理进程里的下次再删）。
 * 不问用户（产品负责人 2026-11-01）：「需要你」里没有它，也没有系统通知；日期和「保留」在任务详情里。保留、又用了它都会重新算。
 * 状态都在库里：重启、应用关了很久都照样。删任务删文件夹。导出成 Markdown。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskService, type TaskHost } from "../src/tasks/service.js";
import { DAY_MS, KEEP_MS, WARN_MS, dirBytes, taskSessionDirs } from "../src/tasks/retention.js";
import { exportFileName, ruleMarkdown, stampOf } from "../src/tasks/export.js";
import { ApprovalCenter } from "../src/agent/approvals.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import { Outbox } from "../src/core/outbox.js";
import { Delivery } from "../src/core/delivery.js";
import { Store, type RunOutcome } from "../src/store/db.js";
import { Attention } from "../src/tasks/attention.js";

const TZ = "Asia/Shanghai";
const at = (s: string) => Date.parse(`${s}${s.length === 16 ? ":00" : ""}+08:00`);
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** 假的宿主：工作区和 DSH 主目录在临时目录里；open 是开在代理进程里的会话（删不了） */
class FakeHost implements TaskHost {
  available = true;
  prompts: Array<{ sessionId: string; text: string }> = [];
  stops: string[] = [];
  open = new Set<string>();
  constructor(readonly ws: string, readonly home: string) {}
  workspace() {
    return this.ws;
  }
  settings() {
    return { ...DEFAULT_SETTINGS };
  }
  memoryPrefix() {
    return "";
  }
  async prompt(_botId: string, o: { sessionId: string; text: string }) {
    this.prompts.push({ sessionId: o.sessionId, text: o.text });
    return `msg-${this.prompts.length}`;
  }
  async steer() {
    return false;
  }
  async stop(_botId: string, sessionId: string) {
    this.stops.push(sessionId);
  }
  async cancel() {}
  async quiet() {
    return { quiet: true };
  }
  sessionBytes(_botId: string, taskId: string) {
    return taskSessionDirs(this.home, taskId).reduce((n, d) => n + dirBytes(d), 0);
  }
  removeSessions(_botId: string, taskId: string) {
    if ([...this.open].some((s) => s.startsWith(`task-${taskId}`))) return false;
    for (const d of taskSessionDirs(this.home, taskId)) fs.rmSync(d, { recursive: true, force: true });
    return true;
  }
}

describe("保留与清理（假宿主、假时钟）", () => {
  let store: Store;
  let host: FakeHost;
  let outbox: Outbox;
  let approvals: ApprovalCenter;
  let svc: TaskService;
  let tmp: string;
  let now: number;
  const CONV = "b:weixin:owner";

  const make = () =>
    new TaskService({ store, host, delivery: new Delivery({ store, outbox, now: () => now, timeZone: TZ }), approvals, defaultModel: () => "m", maxBackground: 4, now: () => now, timeZone: TZ, retryDelaysMs: [5, 5, 5] });
  beforeEach(() => {
    now = at("2026-11-01T10:00");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amb-retention-unit-"));
    fs.mkdirSync(path.join(tmp, "ws"));
    store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝", weixinEnabled: true });
    store.ensureConversation("b", "weixin", "owner", "owner");
    store.addMessage(CONV, "user", "帮我后台调研一下三家云的 GPU 价格");
    host = new FakeHost(path.join(tmp, "ws"), path.join(tmp, "dsh"));
    outbox = new Outbox(store, { now: () => now });
    approvals = new ApprovalCenter(store, { now: () => now });
    svc = make();
    svc.start();
  });
  afterEach(() => {
    svc.stop();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** 一个做完了的任务（结束于 endAt），文件夹里有 files 个文件，DSH 里有它的会话记录 */
  const ended = (title: string, endAt: number, o: { files?: number; outcome?: RunOutcome; sessions?: string[] } = {}) => {
    const id = `t_${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
    const folder = `tasks/task-${id.slice(2, 8)}`;
    const origin = store.listMessages(CONV).at(-1)!;
    store.insertTask({ id, botId: "b", conversationId: CONV, originMessageId: origin.id, originRef: "", title, brief: "b", sessionId: `task-${id}`, folder, model: "m", permission: "workspace", budgetUsd: 1, createdAt: endAt - 3600_000, updatedAt: endAt });
    const outcome = o.outcome ?? "done";
    store.insertRun({ id: `r_${id.slice(2)}`, botId: "b", taskId: id, sessionId: `task-${id}`, cause: "launch", queuedAt: endAt - 3600_000 });
    store.updateRun(`r_${id.slice(2)}`, { state: "ended", outcome, startedAt: endAt - 3600_000, endedAt: endAt, costUsd: 0.08, delivery: `task:${id}:x:dropped`, report: { state: outcome === "done" ? "done" : "failed", summary: "查了三家", message: "A100 最便宜的是 X 云", at: endAt } });
    const report = { state: outcome === "done" ? ("done" as const) : ("failed" as const), summary: "查了三家", message: "A100 最便宜的是 X 云", at: endAt };
    store.updateTask(id, outcome === "done" ? { endedAt: endAt, endReason: "done", spentUsd: 0.08, report } : { spentUsd: 0.08, report });
    const dir = path.join(host.ws, folder);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < (o.files ?? 0); i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), "x".repeat(1000));
    for (const s of o.sessions ?? [`task-${id}`]) {
      const sd = path.join(host.home, "sessions", "--ws-tasks--", s);
      fs.mkdirSync(sd, { recursive: true });
      fs.writeFileSync(path.join(sd, "v4.jsonl"), "{}\n".repeat(100));
    }
    return id;
  };
  const sessionDirs = (id: string) => taskSessionDirs(host.home, id).length;

  it("没文件的任务：30 天没动过就归档（不再列出、不能追加、会话记录删掉），不打扰用户；运行记录只留 30 天，最近的那个留着", async () => {
    const t = ended("整理下载目录", now);
    store.insertRun({ id: "r_old", botId: "b", taskId: t, sessionId: `task-${t}`, cause: "followup", queuedAt: now - 40 * DAY_MS });
    store.updateRun("r_old", { state: "ended", outcome: "done", endedAt: now - 40 * DAY_MS });
    expect(svc.list().map((x) => x.id)).toEqual([t]);
    now += KEEP_MS - DAY_MS;
    svc.retain();
    expect(store.getTask(t)!.endReason).toBe("done");
    expect(store.getRun("r_old")).toBeUndefined();
    expect(svc.attention()).toEqual([]);
    now += DAY_MS;
    svc.retain();
    expect(store.getTask(t)).toMatchObject({ endReason: "archived", cleanupAt: 0 });
    expect(svc.list()).toEqual([]);
    expect(svc.get(t)!.stage.key).toBe("ready");
    expect(store.listRuns({ taskId: t })).toHaveLength(1);
    expect(sessionDirs(t)).toBe(0);
    expect((await svc.message(t, "再看看")).error).toBe("「整理下载目录」已归档，不能再追加；需要的话开个新任务。");
    expect((await svc.retry(t)).error).toMatch(/已归档/);
    expect(svc.attention()).toEqual([]);
  });

  it("有文件的文件夹：第 27 天定下日期（不问、不通知，任务详情里看得到），满 30 天删掉文件夹和会话记录、归档；等着的提问作废", async () => {
    const t = ended("GPU 价格调研", now, { files: 3, outcome: "failed", sessions: [] });
    // 换过一次会话（task-<id>-2）：两份记录都要删
    for (const s of [`task-${t}`, `task-${t}-2`]) (fs.mkdirSync(path.join(host.home, "sessions", "--p--", s), { recursive: true }), fs.writeFileSync(path.join(host.home, "sessions", "--p--", s, "v4.jsonl"), "{}\n"));
    // 别的任务的记录不碰
    fs.mkdirSync(path.join(host.home, "sessions", "--p--", `task-${t}x`), { recursive: true });
    approvals.create({ kind: "question", botId: "b", conversationId: CONV, sessionId: `task-${t}`, tool: "task_report", detail: "要不要再查一家？", reason: "", payload: JSON.stringify([{ id: "answer", question: "要不要再查一家？" }]), taskId: t, runId: "", blocking: false, ttlMs: 0 });
    // 「需要你」和系统通知：定下清理日期前后一样（只有这个失败了的任务那一行，早就有了）
    const attention = new Attention({ store });
    attention.addSource(() => svc.attention());
    attention.takeNew();
    const before = svc.attention();
    const pushed = store.listOutbox({ limit: 100 }).map((r) => r.id);
    now += KEEP_MS - WARN_MS - 3600_000;
    svc.retain();
    expect(store.getTask(t)!.cleanupAt).toBe(0);
    now += 3600_000;
    svc.retain();
    const due = store.getTask(t)!.cleanupAt;
    expect(due).toBe(now + WARN_MS);
    // 任务详情里有日期（和保留）；「需要你」里没有多出什么，也没有系统通知、推送
    expect(svc.get(t)!.cleanupAt).toBe(due);
    expect(svc.attention()).toEqual(before);
    expect(attention.takeNew()).toEqual([]);
    expect(store.listOutbox({ limit: 100 }).map((r) => r.id)).toEqual(pushed);
    // 再看一次：不会再定一次
    now += DAY_MS;
    svc.retain();
    expect(store.getTask(t)!.cleanupAt).toBe(due);
    expect(fs.existsSync(path.join(host.ws, store.getTask(t)!.folder))).toBe(true);
    now = due;
    svc.retain();
    expect(store.getTask(t)!.endReason).toBe("archived");
    expect(fs.existsSync(path.join(host.ws, store.getTask(t)!.folder))).toBe(false);
    expect(taskSessionDirs(host.home, t)).toEqual([]);
    expect(fs.existsSync(path.join(host.home, "sessions", "--p--", `task-${t}x`))).toBe(true);
    expect(approvals.pendingForTask(t)).toEqual([]);
    expect(svc.attention().filter((i) => i.taskId === t)).toEqual([]);
  });

  it("保留（任务详情）：再算 30 天，别的照样清理；定了清理之后又用了它（追加、改预算），清理取消", async () => {
    const a = ended("A", now, { files: 1 });
    const b = ended("B", now, { files: 1 });
    now += KEEP_MS - WARN_MS;
    svc.retain();
    expect([svc.get(a)!.cleanupAt, svc.get(b)!.cleanupAt]).toEqual([now + WARN_MS, now + WARN_MS]);
    expect(svc.keepFolder(a)!.cleanupAt).toBe(0);
    now += WARN_MS + DAY_MS;
    svc.retain();
    expect(store.getTask(a)).toMatchObject({ endReason: "done", cleanupAt: 0 });
    expect(store.getTask(b)!.endReason).toBe("archived");
    expect(fs.existsSync(path.join(host.ws, store.getTask(a)!.folder))).toBe(true);
    expect(fs.existsSync(path.join(host.ws, store.getTask(b)!.folder))).toBe(false);
    // 又过了 27 天：再定一次，还是至少 3 天后
    now += KEEP_MS - WARN_MS;
    svc.retain();
    expect(store.getTask(a)!.cleanupAt).toBeGreaterThan(now);
    // 用了它：改预算（任务详情）→ 下次看时清理取消
    await svc.setBudget(a, 3);
    svc.retain();
    expect(store.getTask(a)!.cleanupAt).toBe(0);
  });

  it("重启和应用关了很久：定下的日期记在库里；关了 60 天也要先定日期、至少 3 天后才删", async () => {
    const t = ended("GPU 价格调研", now, { files: 2 });
    now += 60 * DAY_MS;
    svc.stop();
    svc = make();
    svc.start();
    const due = store.getTask(t)!.cleanupAt;
    expect(due).toBe(now + WARN_MS);
    expect(fs.existsSync(path.join(host.ws, store.getTask(t)!.folder))).toBe(true);
    // 重启：不会再定一次，任务详情里还是那个日期
    now += DAY_MS;
    svc.stop();
    svc = make();
    svc.start();
    expect(store.getTask(t)!.cleanupAt).toBe(due);
    expect(svc.get(t)!.cleanupAt).toBe(due);
    // 关着过了清理时间：下次启动时删
    svc.stop();
    now = due + 10 * DAY_MS;
    svc = make();
    svc.start();
    expect(store.getTask(t)!.endReason).toBe("archived");
    expect(fs.existsSync(path.join(host.ws, store.getTask(t)!.folder))).toBe(false);
  });

  it("会话还开在代理进程里：先不删，记在库里，重启后（代理进程换过）再删", async () => {
    const t = ended("A", now);
    host.open.add(`task-${t}`);
    now += KEEP_MS;
    svc.retain();
    expect(store.getTask(t)!.endReason).toBe("archived");
    expect(sessionDirs(t)).toBe(1);
    svc.stop();
    host.open.clear();
    svc = make();
    svc.start();
    expect(sessionDirs(t)).toBe(0);
    expect(store.getKV("tasks:session-trash")).toBe("[]");
  });

  it("规则的运行记录留 30 天，本月的留着（本月花费从它们汇总）", async () => {
    const r = svc.createRule({ botId: "b", conversationId: CONV, title: "看 X 价格", instruction: "看看 X 的价格", schedule: { kind: "daily", time: "08:00", tz: TZ } }).rule!;
    const run = (id: string, q: number, cost = 0.02) => {
      store.insertEndedRun({ id, botId: "b", ruleId: r.id, ruleVersion: 1, mode: "observe", cause: "schedule", outcome: "done", error: "", queuedAt: q, endedAt: q + 60_000 });
      store.updateRun(id, { costUsd: cost });
    };
    now = at("2026-12-31T10:00");
    run("r_dec1", at("2026-12-01T08:00"));
    run("r_nov30", at("2026-11-30T08:00"));
    run("r_oct", at("2026-10-15T08:00"));
    svc.retain();
    expect(store.ruleRuns(r.id, { limit: 10 }).map((x) => x.id)).toEqual(["r_dec1"]);
    expect(svc.getRuleView(r.id)!.monthUsd).toBeCloseTo(0.02);
    now = at("2027-01-02T10:00");
    svc.retain();
    expect(store.ruleRuns(r.id, { limit: 10 })).toEqual([]);
  });

  it("删任务：在跑的先停下，文件夹、会话记录、运行记录一起删", async () => {
    const r = svc.create({ botId: "b", conversationId: CONV, title: "季度报告", brief: "做个季度报告" });
    const t = r.task!;
    await flush();
    fs.writeFileSync(path.join(host.ws, t.folder, "deck.pptx"), "x".repeat(2048));
    fs.mkdirSync(path.join(host.home, "sessions", "--p--", t.sessionId), { recursive: true });
    fs.writeFileSync(path.join(host.home, "sessions", "--p--", t.sessionId, "v4.jsonl"), "x".repeat(512));
    expect(svc.sizes(t.id)).toEqual({ folder: 2048, sessions: 512 });
    expect(svc.get(t.id)!.stage.group).toBe("working");
    expect(await svc.deleteTask(t.id, "web")).toBe(true);
    expect(host.stops).toEqual([t.sessionId]);
    expect(store.getTask(t.id)).toBeUndefined();
    expect(store.listRuns({ taskId: t.id })).toEqual([]);
    expect(fs.existsSync(path.join(host.ws, t.folder))).toBe(false);
    expect(sessionDirs(t.id)).toBe(0);
    expect(await svc.deleteTask(t.id, "web")).toBe(false);
  });

  it("改预算：调高；停在预算上的，改到已花的以上就接着做；不对的金额不收", async () => {
    const t = ended("季度报告 PPT", now, { outcome: "budget" });
    store.updateTask(t, { spentUsd: 1, budgetUsd: 1 });
    expect(svc.get(t)!.stage.key).toBe("needs-you/budget");
    expect((await svc.setBudget(t, 0)).error).toBe("金额不对");
    expect((await svc.setBudget(t, 5000)).error).toBe("金额不对");
    // 调到已花的以下：只改数，不接着做
    expect((await svc.setBudget(t, 0.5)).task).toMatchObject({ budgetUsd: 0.5, stage: { key: "needs-you/budget" } });
    const r = await svc.setBudget(t, 2.5);
    expect(r.task).toMatchObject({ budgetUsd: 2.5 });
    expect(store.listRuns({ taskId: t }).at(-1)).toMatchObject({ cause: "continue" });
    expect((await svc.addBudget(t, 1)).task!.budgetUsd).toBe(3.5);
  });

  it("导出：规则的运行记录、任务的每次运行（Markdown）", async () => {
    const t = ended("GPU 价格调研", at("2026-11-01T10:00"));
    store.updateRun(`r_${t.slice(2)}`, { activity: JSON.stringify([{ id: "1", kind: "tool", title: "bash", summary: "curl -s x.example/prices", status: "ok", at: 0 }, { id: "2", kind: "tool", title: "read", summary: "b.html", status: "error", at: 0 }]) });
    expect(svc.exportTask(t)!.text).toBe(
      [
        "# GPU 价格调研",
        "",
        "已完成 · 约 $0.08 / $1.00",
        "",
        `- 来自: 微信 · ${stampOf(store.listMessages(CONV).at(-1)!.createdAt, TZ)}`,
        `- 文件夹: \`tasks/task-${t.slice(2, 8)}\``,
        "- 最新进展: A100 最便宜的是 X 云",
        "- 导出于 2026-11-01 10:00",
        "",
        "> 帮我后台调研一下三家云的 GPU 价格",
        "",
        "## 第 1 次 · 开始 · 2026-11-01 09:00 · 60 分钟 · 约 $0.08",
        "",
        "A100 最便宜的是 X 云",
        "",
        "查了三家",
        "",
        "- bash: curl -s x.example/prices",
        "- read: b.html (出错)",
        "",
      ].join("\n"),
    );
    const rule = svc.createRule({ botId: "b", conversationId: CONV, title: "看 X 价格", instruction: "每天早上看看 X 的价格，降到 200 以下告诉我", mode: "observe", schedule: { kind: "daily", time: "08:00", tz: TZ } }).rule!;
    store.insertEndedRun({ id: "r_x1", botId: "b", ruleId: rule.id, ruleVersion: 1, mode: "observe", cause: "schedule", outcome: "done", error: "", queuedAt: at("2026-11-01T08:00"), endedAt: at("2026-11-01T08:01") });
    store.updateRun("r_x1", { costUsd: 0.03, permission: "read-only", report: { state: "done", summary: "X 现在 ¥199", message: "X 降价了，现在 ¥199", at: 0 } });
    store.insertEndedRun({ id: "r_x0", botId: "b", ruleId: rule.id, ruleVersion: 1, mode: "observe", cause: "schedule", outcome: "skipped", error: "app_off", queuedAt: at("2026-10-31T08:00"), endedAt: at("2026-10-31T08:00") });
    expect(svc.exportRule(rule.id)!.text).toBe(
      [
        "# 看 X 价格",
        "",
        "> 每天早上看看 X 的价格，降到 200 以下告诉我",
        "",
        "每天 08:00（Asia/Shanghai） · 观察中 · 本月 约 $0.03 / $3.00",
        "",
        "导出于 2026-11-01 10:00",
        "",
        "## 运行记录",
        "",
        "### 2026-11-01 08:00 · 观察 · 约 $0.03",
        "",
        "本会发送：“X 降价了，现在 ¥199”",
        "",
        "X 现在 ¥199",
        "",
        "第 1 版 · 只读",
        "",
        "### 2026-10-31 08:00 · 观察",
        "",
        "跳过：电脑没开",
        "",
        "第 1 版",
        "",
      ].join("\n"),
    );
    expect(exportFileName("看 X 价格/每天")).toBe("看 X 价格-每天.md");
    expect(ruleMarkdown(svc.getRuleView(rule.id)!, "w", [], TZ, now)).toContain("还没有运行过。");
  });
});
