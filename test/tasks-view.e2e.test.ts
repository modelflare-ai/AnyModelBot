/**
 * 任务视图的接口（3f）：真实的 App 和本机服务（代理关着，任务和规则直接写库）。
 * GET /tasks?group= 按进行中 / 等你 / 结束了分组（归档了的不列，组名不对 400）；详情里有来自、大小；改预算（加多少、改成多少、
 * 不对的金额、停了的任务）；删除连同文件夹；保留文件夹（详情里、「需要你」里）；打开文件夹只在桌面版；规则编辑器的预算；
 * 规则运行记录和任务导出成 Markdown（下载的文件名、按 ?lang= 的语言）。
 * 问了个有默认回答的问题、接着在做的任务：在进行中那组，「进行中，有个问题等你回答」；详情、「需要你」、对话里的卡片都有那一句
 * 「不回复就按中文做」（按界面的语言）。
 * 观察够了的规则：「需要你」里问要不要改为执行；改为执行（同 PUT /rules/:id 切模式）、继续观察（这一版不再问）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RunOutcome } from "../src/store/db.js";
import { mockOpenAI } from "./helpers.js";

const CONV = "default:weixin:owner@im.wechat";
let app: App;
let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let dataDir = "";
let base = "";

async function api(p: string, init: { method?: string; body?: unknown; lang?: string } = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(`${base}/amb/api${p}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.lang ? { "x-amb-lang": init.lang } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** 一个任务：最近的 run 是 state / outcome（queued = 在排队） */
function task(title: string, outcome: RunOutcome | "queued", o: { endReason?: string } = {}): string {
  const id = `t_${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
  const now = Date.now();
  const origin = app.store.addMessage(CONV, "user", `帮我做${title}`);
  app.store.insertTask({ id, botId: "default", conversationId: CONV, originMessageId: origin, originRef: "", title, brief: title, sessionId: `task-${id}`, folder: `tasks/task-${id.slice(2, 8)}`, model: "m", permission: "workspace", budgetUsd: 1, createdAt: now, updatedAt: now });
  app.store.insertRun({ id: `r_${id.slice(2)}`, botId: "default", taskId: id, sessionId: `task-${id}`, cause: "launch", queuedAt: now });
  if (outcome !== "queued") app.store.updateRun(`r_${id.slice(2)}`, { state: "ended", outcome, startedAt: now, endedAt: now, delivery: `task:${id}:x:dropped` });
  if (outcome === "done" || o.endReason) app.store.updateTask(id, { endedAt: now, endReason: o.endReason ?? "done" });
  fs.mkdirSync(path.join(dataDir, "workspaces", "default", app.store.getTask(id)!.folder), { recursive: true });
  return id;
}

beforeAll(async () => {
  llm = await mockOpenAI({ key: "gw-key" });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-tasks-view-e2e-"));
  const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_AGENT: "off" } });
  app = new App(config, { printQrToTerminal: false, timeZone: "Asia/Shanghai" });
  await app.start();
  base = app.web!.url.replace(/\/+$/, "");
  app.store.ensureConversation("default", "weixin", "owner@im.wechat", "owner");
});

afterAll(async () => {
  await app?.stop();
  await llm?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("任务视图的接口", () => {
  let working = "";
  let failed = "";
  let budget = "";
  let done = "";
  let stopped = "";
  beforeAll(() => {
    working = task("GPU 价格调研", "queued");
    failed = task("季度报告", "failed");
    budget = task("季度报告 PPT", "budget");
    done = task("整理下载目录", "done");
    stopped = task("清理旧构建", "stopped", { endReason: "stopped" });
    task("去年的任务", "done", { endReason: "archived" });
  });

  it("GET /tasks?group=：进行中、等你、结束了；几组用逗号；归档了的不列；组名不对 400", async () => {
    const ids = async (q: string) => (await api(`/tasks?bot=default${q}`)).data.tasks.map((t: any) => t.id).sort();
    expect(await ids("&group=working")).toEqual([working]);
    expect(await ids("&group=needs")).toEqual([failed, budget].sort());
    expect(await ids("&group=ended")).toEqual([done, stopped].sort());
    expect(await ids("&group=working,needs")).toEqual([working, failed, budget].sort());
    expect(await ids("")).toEqual([working, failed, budget, done, stopped].sort());
    const groups = (await api("/tasks?bot=default")).data.tasks.map((t: any) => t.stage.group);
    expect(groups).toEqual(["working", "needs", "needs", "ended", "ended"]);
    const bad = await api("/tasks?group=archived");
    expect(bad).toEqual({ status: 400, data: { error: "分组只能是 working、needs 或 ended" } });
    expect((await api("/tasks?group=x", { lang: "en" })).data.error).toBe("group must be working, needs or ended");
  });

  it("GET /tasks/:id：来自（渠道、时间、原话）、文件夹和会话记录的大小；打开文件夹只在桌面版", async () => {
    const dir = path.join(dataDir, "workspaces", "default", app.store.getTask(done)!.folder);
    fs.writeFileSync(path.join(dir, "list.txt"), "x".repeat(1500));
    const { data } = await api(`/tasks/${done}`);
    expect(data.origin).toMatchObject({ channel: "weixin", text: "帮我做整理下载目录" });
    expect(data.sizes).toEqual({ folder: 1500, sessions: 0 });
    expect(data.canOpen).toBe(false);
    expect(data.task).toMatchObject({ id: done, cleanupAt: 0, stage: { key: "ready" } });
    expect((await api(`/tasks/${done}/open`, { method: "POST", body: {} })).status).toBe(400);
  });

  it("POST /tasks/:id/budget：{budgetUsd} 改成多少、{addUsd} 加多少；停在预算上的接着排；金额不对、停了的 400", async () => {
    expect((await api(`/tasks/${working}/budget`, { method: "POST", body: { budgetUsd: 3 } })).data.task).toMatchObject({ budgetUsd: 3 });
    expect((await api(`/tasks/${working}/budget`, { method: "POST", body: { addUsd: 1.5 } })).data.task).toMatchObject({ budgetUsd: 4.5 });
    expect(await api(`/tasks/${working}/budget`, { method: "POST", body: { budgetUsd: -1 } })).toEqual({ status: 400, data: { error: "金额不对" } });
    expect((await api(`/tasks/${working}/budget`, { method: "POST", body: { budgetUsd: "abc" } })).status).toBe(400);
    expect((await api(`/tasks/${stopped}/budget`, { method: "POST", body: { budgetUsd: 2 } })).data.error).toBe("「清理旧构建」已停止");
    app.store.updateTask(budget, { spentUsd: 1 });
    const r = await api(`/tasks/${budget}/budget`, { method: "POST", body: { budgetUsd: 2 } });
    expect(r.data.task).toMatchObject({ budgetUsd: 2, stage: { group: "working" } });
    expect(app.store.listRuns({ taskId: budget }).at(-1)).toMatchObject({ cause: "continue", state: "queued" });
    expect((await api(`/tasks/nope/budget`, { method: "POST", body: { addUsd: 1 } })).status).toBe(404);
  });

  it("保留文件夹：详情里的保留、「需要你」里的保留和知道了", async () => {
    app.store.updateTask(done, { cleanupAt: Date.now() + 3 * 86400_000 });
    const item = (await api("/attention")).data.items.find((i: any) => i.id === "cleanup:default");
    expect(item).toMatchObject({ kind: "cleanup", actions: ["keep", "dismiss"], line: "整理下载目录 · 30 天没动过" });
    expect((await api("/attention/cleanup:default/dismiss", { method: "POST", body: {} })).data.items.find((i: any) => i.kind === "cleanup")).toBeUndefined();
    app.store.updateTask(failed, { cleanupAt: Date.now() + 4 * 86400_000 });
    expect((await api("/attention")).data.items.filter((i: any) => i.kind === "cleanup")).toHaveLength(1);
    await api("/attention/cleanup:default/keep", { method: "POST", body: {} });
    expect([app.store.getTask(done)!.cleanupAt, app.store.getTask(failed)!.cleanupAt]).toEqual([0, 0]);
    app.store.updateTask(done, { cleanupAt: Date.now() + 86400_000 });
    expect((await api(`/tasks/${done}/keep`, { method: "POST", body: {} })).data.task).toMatchObject({ cleanupAt: 0 });
  });

  it("导出：任务和规则的运行记录是 Markdown 下载，按 ?lang= 的语言", async () => {
    const res = await fetch(`${base}/amb/api/tasks/${done}/export?lang=en`);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="______.md"; filename*=UTF-8''${encodeURIComponent("整理下载目录.md")}`);
    const md = await res.text();
    expect(md).toMatch(/^# 整理下载目录\n\nDone · about \$0\.00 of \$1\.00\n\n- From: WeChat · \d{4}-\d\d-\d\d \d\d:\d\d\n/);
    expect(md).toContain("## Run 1 · Started · ");
    const rule = (await api("/rules", { method: "POST", body: { botId: "default", conversationId: CONV, kind: "check", title: "看 X 价格", instruction: "每天早上看看 X 的价格", schedule: { kind: "daily", time: "08:00" }, runBudgetUsd: 0.2, monthBudgetUsd: 5 } })).data.rule;
    expect(rule).toMatchObject({ runBudgetUsd: 0.2, monthBudgetUsd: 5, mode: "observe" });
    expect((await api(`/rules/${rule.id}`, { method: "PUT", body: { runBudgetUsd: 0.15, monthBudgetUsd: 4 } })).data.rule).toMatchObject({ runBudgetUsd: 0.15, monthBudgetUsd: 4 });
    expect((await api("/rules", { method: "POST", body: { botId: "default", conversationId: CONV, kind: "check", title: "x", instruction: "x", schedule: { kind: "daily", time: "08:00" }, monthBudgetUsd: 0 } })).status).toBe(400);
    const zh = await (await fetch(`${base}/amb/api/rules/${rule.id}/export`)).text();
    expect(zh).toMatch(/^# 看 X 价格\n\n> 每天早上看看 X 的价格\n\n每天 08:00（Asia\/Shanghai） · 观察中 · 本月 约 \$0\.00 \/ \$4\.00\n\n导出于 .+\n\n## 运行记录\n\n还没有运行过。\n$/);
    const en = await (await fetch(`${base}/amb/api/rules/${rule.id}/export?lang=en`)).text();
    expect(en).toContain("## Run log");
  });

  it("DELETE /tasks/:id：任务、运行记录和文件夹一起删", async () => {
    const dir = path.join(dataDir, "workspaces", "default", app.store.getTask(failed)!.folder);
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    expect(await api(`/tasks/${failed}`, { method: "DELETE" })).toEqual({ status: 200, data: { ok: true } });
    expect(app.store.getTask(failed)).toBeUndefined();
    expect(app.store.listRuns({ taskId: failed })).toEqual([]);
    expect(fs.existsSync(dir)).toBe(false);
    expect((await api(`/tasks/${failed}`)).status).toBe(404);
  });
});

describe("问了还在做：有默认回答的提问", () => {
  it("任务在进行中那组（进行中，有个问题等你回答）；详情、「需要你」和提问卡片都有不回复会怎样；回答了就回到进行中", async () => {
    const id = task("竞品周报", "queued");
    const runId = `r_${id.slice(2)}`;
    app.store.updateRun(runId, { state: "running", startedAt: Date.now() });
    const payload = JSON.stringify([{ id: "answer", question: "报告用中文还是英文？", options: [{ label: "中文" }, { label: "英文" }], default: "中文" }]);
    const q = app.agent.approvals.create({ kind: "question", botId: "default", conversationId: CONV, sessionId: `task-${id}`, tool: "task_report", detail: "报告用中文还是英文？", reason: "", payload, taskId: id, runId, blocking: false, ttlMs: 0 });
    const list = (await api("/tasks?bot=default&group=working")).data.tasks;
    expect(list.find((t: any) => t.id === id)).toMatchObject({ stage: { key: "working/asking", label: "进行中，有个问题等你回答", group: "working" }, question: { text: "报告用中文还是英文？", note: "不回复就按中文做" } });
    expect((await api(`/tasks/${id}`, { lang: "en" })).data.task).toMatchObject({ stage: { label: "In progress, with a question for you" }, question: { note: "If you don't reply, it goes with 中文" } });
    const item = (await api("/attention")).data.items.find((i: any) => i.id === `approval:${q.id}`);
    expect(item).toMatchObject({ kind: "question", subject: "竞品周报", status: "等你回答", line: "报告用中文还是英文？", note: "不回复就按中文做", actions: ["answer"], taskId: id });
    expect((await api(`/approvals/${q.id}`)).data.approval).toMatchObject({ taskTitle: "竞品周报", note: "不回复就按中文做", questions: [{ default: "中文" }] });
    // 在「需要你」里回答了：回到进行中，卡片上不再有那一句
    expect((await api(`/attention/approval:${q.id}/answer`, { method: "POST", body: { text: "2" } })).status).toBe(200);
    expect((await api(`/tasks/${id}`)).data.task).toMatchObject({ stage: { key: "working", label: "进行中" } });
    expect((await api(`/tasks/${id}`)).data.task.question).toBeUndefined();
    expect((await api(`/approvals/${q.id}`)).data.approval).toMatchObject({ status: "answered" });
    expect((await api(`/approvals/${q.id}`)).data.approval.note).toBeUndefined();
  });
});

describe("观察够了的规则：「需要你」里问要不要改为执行", () => {
  /** 一条观察中的检查和它这一版的 n 次好好观察（直接写库；最近那次「本会发送」） */
  const observed = async (title: string, n: number): Promise<string> => {
    const rule = (await api("/rules", { method: "POST", body: { botId: "default", conversationId: CONV, kind: "check", title, instruction: `每天看看${title}`, schedule: { kind: "daily", time: "08:00" } } })).data.rule;
    for (let i = 0; i < n; i++) {
      const at = Date.now() - (n - i) * 86400_000;
      const id = `r_${rule.id.slice(3, 9)}${String(i).padStart(6, "0")}`;
      app.store.insertEndedRun({ id, botId: "default", ruleId: rule.id, ruleVersion: 1, mode: "observe", cause: "schedule", outcome: "done", error: "", queuedAt: at, endedAt: at + 60_000 });
      app.store.updateRun(id, { report: { state: "done", summary: "X 现在 ¥259", message: i === n - 1 ? "X 降到 199 了" : "", at } });
    }
    return rule.id;
  };
  const find = async (id: string, lang?: string) => (await api("/attention", { lang })).data.items.find((i: any) => i.id === `suggest:${id}`);

  it("改为执行和规则详情里切模式一样，那一行随之消失；继续观察了这一版不再问；英文", async () => {
    const few = await observed("Y 价格", 2);
    expect(await find(few)).toBeUndefined();
    const id = await observed("X 价格", 3);
    expect(await find(id)).toMatchObject({ kind: "suggest", subject: "规则「X 价格」已观察 3 次，需要你来决定是否执行", status: "", line: "本会发送：“X 降到 199 了”", actions: ["act", "dismiss"], ruleId: id, ruleTitle: "X 价格" });
    expect((await find(id, "en")).subject).toBe("Rule “X 价格” has observed 3 times; decide whether it should act");
    // 算在侧栏的件数里
    expect((await api("/agent")).data.attention).toBeGreaterThan(0);
    const r = await api(`/attention/suggest:${id}/act`, { method: "POST", body: {} });
    expect(r.status).toBe(200);
    expect(r.data.items.find((i: any) => i.id === `suggest:${id}`)).toBeUndefined();
    expect((await api(`/rules/${id}`)).data.rule).toMatchObject({ mode: "act", state: { key: "act", label: "执行中" } });
    // 已经处理掉了：再点是 409
    expect((await api(`/attention/suggest:${id}/act`, { method: "POST", body: {} })).status).toBe(409);
    // 继续观察：这一版不再问，模式不变
    const keep = await observed("Z 价格", 3);
    expect(await find(keep)).toBeDefined();
    expect((await api(`/attention/suggest:${keep}/dismiss`, { method: "POST", body: {} })).status).toBe(200);
    expect(await find(keep)).toBeUndefined();
    expect((await api(`/rules/${keep}`)).data.rule).toMatchObject({ mode: "observe" });
    // 不支持的操作
    const other = await observed("W 价格", 3);
    expect((await api(`/attention/suggest:${other}/retry`, { method: "POST", body: {} })).status).toBe(400);
    for (const x of [few, id, keep, other]) await api(`/rules/${x}`, { method: "DELETE" });
  });
});
