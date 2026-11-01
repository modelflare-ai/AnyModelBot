/**
 * 花费与预算（3e）：估算（参考价 × 用量、缓存价、阶梯计费取基础档、会话和子代理的每次模型请求）、
 * 任务的预算（停在 $1：取消这一轮但不封会话，问「已用约 $1.00，再给 $1 继续？」；回编号、接口加预算、聊天里追加都能接着做，
 * 回「停止」停掉；预算用完后再来的输入先问、不交给会话；重启后补问）、规则每次 $0.10（这次以 budget 结束、算一次失败）、
 * 每月 $3（停下并暂停，下个月 1 号按主人的时区恢复，「再给 $3」接着跑）、机器人的预算 Key 剩不到 20% 时停后台工作留给聊天、
 * 任务每次运行 4 小时（等人批准的时间不算）。TaskService 对着假宿主和假时钟。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUDGET_TOOL, costOf, usdText, type Rates } from "../src/tasks/cost.js";
import { estimateRates, referencePrice } from "../src/account/model-info.js";
import { TaskService, askId, type TaskHost, type TaskNotification } from "../src/tasks/service.js";
import { approvalItems } from "../src/tasks/attention.js";
import { ApprovalCenter } from "../src/agent/approvals.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import { Outbox } from "../src/core/outbox.js";
import { Delivery } from "../src/core/delivery.js";
import { Store } from "../src/store/db.js";

const TZ = "Asia/Shanghai";
/** 上海时间 "2026-11-06T08:00" → 时间戳 */
const at = (s: string) => Date.parse(`${s}${s.length === 16 ? ":00" : ""}+08:00`);
const MIN = 60_000;
const H = 3600_000;
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

describe("估算：参考价 × 用量", () => {
  it("一次模型请求：输入、输出、缓存命中、写入各按各的价；没有缓存价按输入价（宁可多估）；没有价格就是 0", () => {
    const r: Rates = { input: 10, output: 40, cacheRead: 1, cacheWrite: 12.5 };
    expect(costOf({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10_000, cacheWriteTokens: 2000 }, r)).toBeCloseTo(0.01 + 0.02 + 0.01 + 0.025, 10);
    expect(costOf({ cacheReadTokens: 1_000_000 }, { input: 2, output: 8 })).toBe(2);
    expect(costOf({ inputTokens: 1000 }, undefined)).toBe(0);
    expect(costOf({ inputTokens: -5, outputTokens: Number.NaN }, r)).toBe(0);
    expect([usdText(1), usdText(0.084), usdText(0.004), usdText(0)]).toEqual(["$1.00", "$0.08", "<$0.01", "$0.00"]);
  });

  it("单价：可用分组里最低的倍率、缓存倍率；阶梯计费取基础那一档；按次计费、没有可用分组的不给；模型选择器的参考价照旧不给阶梯计费的", () => {
    const catalog = { group_ratio: { default: 1, vip: 0.5, hidden: 0.1 }, usable_group: { default: "", vip: "" } };
    expect(estimateRates({ model_name: "m", quota_type: 0, input_price: 2, completion_ratio: 4, cache_ratio: 0.1, create_cache_ratio: 1.25, enable_groups: ["default", "vip", "hidden"] }, catalog)).toEqual({ input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1.25 });
    const tiered = {
      model_name: "t",
      quota_type: 0,
      input_price: 5,
      billing_mode: "tiered_expr",
      pricing_rules: { tiers: [{ label: "base", conditions: null, unit_prices: { input: 5, output: 30, cache_read: 0.5 } }, { label: "long", conditions: [{ var: "len" }], unit_prices: { input: 10, output: 45 } }] },
      enable_groups: ["default"],
    };
    expect(estimateRates(tiered, catalog)).toEqual({ input: 5, output: 30, cacheRead: 0.5 });
    expect(referencePrice(tiered, catalog)).toBeUndefined();
    expect(estimateRates({ model_name: "v", quota_type: 1, model_price: 0.5, enable_groups: ["default"] }, catalog)).toBeUndefined();
    expect(estimateRates({ model_name: "h", quota_type: 0, input_price: 1, enable_groups: ["hidden"] }, catalog)).toBeUndefined();
  });
});

/** 假的宿主：记下交给会话的输入、取消（会话还能接着用）和停止（之后的工具调用一律拒绝） */
class FakeHost implements TaskHost {
  available = true;
  prompts: Array<{ botId: string; sessionId: string; folder: string; model: string; text: string; resume: boolean; id: string }> = [];
  stops: string[] = [];
  cancels: string[] = [];
  settingsValue = { ...DEFAULT_SETTINGS, utilityModel: "small-model" };
  private n = 0;
  constructor(readonly ws: string) {}
  workspace() {
    return this.ws;
  }
  settings() {
    return this.settingsValue;
  }
  memoryPrefix() {
    return "";
  }
  async prompt(botId: string, o: { sessionId: string; folder: string; model: string; text: string; resume: boolean }) {
    const id = `msg-${++this.n}`;
    this.prompts.push({ botId, ...o, id });
    return id;
  }
  async steer() {
    return false;
  }
  async stop(_botId: string, sessionId: string) {
    this.stops.push(sessionId);
  }
  async cancel(_botId: string, sessionId: string) {
    this.cancels.push(sessionId);
  }
  async quiet() {
    return { quiet: true };
  }
}

describe("预算（假宿主、假时钟）", () => {
  let store: Store;
  let host: FakeHost;
  let outbox: Outbox;
  let delivery: Delivery;
  let approvals: ApprovalCenter;
  let svc: TaskService;
  let ws: string;
  let now: number;
  /** 机器人的 Modelflare 预算 Key（没开就是 undefined） */
  let budget: { limitUsd: number; remainUsd: number; at: number } | undefined;
  const CONV = "b:weixin:owner";
  /** 美元 / 百万 tokens：主模型输入 $10（10 万 tokens = $1），子代理用的模型更贵 */
  const RATES: Record<string, Rates> = { "main-model": { input: 10, output: 40, cacheRead: 1 }, "small-model": { input: 10, output: 40 }, "sub-model": { input: 100, output: 100 } };

  const make = (o: { cap?: number } = {}) =>
    new TaskService({
      store,
      host,
      delivery,
      approvals,
      defaultModel: () => "main-model",
      retryDelaysMs: [5, 5, 5],
      maxBackground: 4,
      now: () => now,
      timeZone: TZ,
      taskRunCapMs: o.cap,
      rates: (m) => RATES[m],
      botBudget: () => budget,
    });
  beforeEach(() => {
    now = at("2026-11-02T10:00");
    budget = undefined;
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-cost-unit-"));
    store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝", weixinEnabled: true });
    store.ensureConversation("b", "weixin", "owner", "owner");
    store.addMessage(CONV, "user", "帮我后台做个季度报告 PPT");
    store.setAgentSession(CONV, "b", "chat-1");
    host = new FakeHost(ws);
    outbox = new Outbox(store, { now: () => now });
    delivery = new Delivery({ store, outbox, now: () => now, timeZone: TZ });
    approvals = new ApprovalCenter(store, { now: () => now });
    svc = make();
    svc.start();
  });
  afterEach(() => {
    svc.stop();
    store.close();
    fs.rmSync(ws, { recursive: true, force: true });
  });

  let step = 0;
  /** 会话（或它的子代理：root 是任务会话）的一次模型请求带着用量 */
  const used = (sessionId: string, usage: Record<string, number>, model = "", root = sessionId) =>
    svc.onEvent("b", root, { method: "session.event", params: { sessionId, event: { type: "assistant/message", data: { turn: 1, step: ++step, message: { role: "assistant", content: [{ type: "text", text: "…" }], ...(model ? { source: { model } } : {}) }, usage }, time: now } } });
  /** 花 usd 美元的一次请求（按主模型、小模型的输入价：10 万 tokens = $1） */
  const spend = (sessionId: string, usd: number) => used(sessionId, { inputTokens: Math.round(usd * 100_000), outputTokens: 0 });
  const ev = (sessionId: string, type: string, data: any = {}): TaskNotification => ({ method: "session.event", params: { sessionId, event: { type, data, time: now } } });
  const status = (sessionId: string, s: "running" | "idle"): TaskNotification => ({ method: "session.status", params: { sessionId, status: s } });
  /** 最近一次交给这个会话（不给就是最近的那个会话）的输入跑一轮；during 在这一轮中间花钱、报告 */
  const turn = async (sessionId: string | undefined, during?: (sid: string) => void) => {
    const p = (sessionId ? host.prompts.filter((x) => x.sessionId === sessionId) : host.prompts).at(-1)!;
    const sid = p.sessionId;
    svc.onEvent("b", sid, status(sid, "running"));
    svc.onEvent("b", sid, ev(sid, "turn/start", { turn: 1 }));
    svc.onEvent("b", sid, ev(sid, "user/message", { id: p.id, role: "user", content: [{ type: "text", text: p.text }] }));
    during?.(sid);
    svc.onEvent("b", sid, ev(sid, "turn/end", { turn: 1, reason: { kind: "completed" } }));
    svc.onEvent("b", sid, status(sid, "idle"));
    await flush();
  };
  const start = (title = "季度报告 PPT") => {
    const r = svc.create({ botId: "b", conversationId: CONV, title, brief: "做 10 页" });
    expect(r.error).toBeUndefined();
    return r.task!;
  };
  const report = (sessionId: string, state: string, message = "") => expect(svc.report({ sessionId, state, summary: "做好了", message }).error).toBeUndefined();
  const runs = (taskId: string) => store.listRuns({ taskId }).map((r) => [r.cause, r.state, r.outcome]);
  const asks = () => store.listOutbox({ limit: 100 }).filter((r) => r.id.includes(":ask:")).reverse();
  const reply = (text: string) => approvals.handleReply(CONV, text, "weixin:owner", svc.replyContext(CONV));
  /** 规则：拨钟，到点的开 run */
  const go = async (t: number) => {
    now = t;
    svc.fireDue(now);
    await flush();
  };
  /** 新规则直接执行；extra 里 mode: "observe" = 用户说了先观察 */
  const createRule = async (extra: Record<string, unknown> = {}) => {
    const r = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "看 X 价格", instruction: "每天早上看看 X 的价格，低于 200 告诉我", schedule: "daily 08:00", ...extra } });
    expect(r.error).toBeUndefined();
    return store.listRules({ botId: "b" }).at(-1)!;
  };
  const ruleRuns = (ruleId: string) => store.ruleRuns(ruleId, { limit: 100 }).reverse();

  it("估算：会话和子代理的每次模型请求按回答它的模型的价算（没说是哪个模型就按任务的），记在 run 上、加到任务上；没有价格的不算", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, (sid) => {
      // 主模型：输入 $0.01 + 输出 $0.02 + 缓存命中 $0.01
      used(sid, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10_000 }, "main-model");
      // 子代理用的另一个模型：$0.02
      used("sub-1", { inputTokens: 100, outputTokens: 100 }, "sub-model", sid);
      // 事件里的模型没有价格：按任务的模型算 $0.01
      used(sid, { inputTokens: 1000 }, "unknown-model");
      report(sid, "done", "做好了");
    });
    const run = store.listRuns({ taskId: t.id })[0];
    expect(run.costUsd).toBeCloseTo(0.07, 10);
    expect(run.tokensIn).toBe(1000 + 10_000 + 100 + 1000);
    expect(run.tokensOut).toBe(600);
    expect(store.getTask(t.id)!.spentUsd).toBeCloseTo(0.07, 10);
    expect(svc.get(t.id)).toMatchObject({ budgetUsd: 1, stage: { key: "ready" } });
    expect(svc.get(t.id)!.spentUsd).toBeCloseTo(0.07, 10);
    // 没有价格（外部端点、目录里没有）：不估算，预算也就不起作用
    svc.stop();
    svc = new TaskService({ store, host, delivery, approvals, defaultModel: () => "no-price", now: () => now, timeZone: TZ, rates: (m) => RATES[m] });
    svc.start();
    const u = start("没有价格");
    await flush();
    await turn(u.sessionId, (sid) => {
      used(sid, { inputTokens: 5_000_000 });
      report(sid, "done", "好了");
    });
    expect(store.getTask(u.id)!.spentUsd).toBe(0);
    expect(store.listRuns({ taskId: u.id })[0]).toMatchObject({ outcome: "done", costUsd: 0, tokensIn: 5_000_000 });
  });

  it("退出演示的单元版：任务停在 $1（取消这一轮，会话不封），问「已用约 $1.00，再给 $1 继续？」；回 1 加预算，在同一个会话里接着做完", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, (sid) => {
      for (let i = 0; i < 3; i++) spend(sid, 0.25);
      expect(host.cancels).toEqual([]);
      spend(sid, 0.25);
    });
    expect(host.cancels).toEqual([t.sessionId]);
    expect(host.stops).toEqual([]);
    expect(runs(t.id)).toEqual([["launch", "ended", "budget"]]);
    expect(store.listRuns({ taskId: t.id })[0].costUsd).toBeCloseTo(1, 10);
    // 取消到达之前已经发出去的那次请求：花费照样记上
    spend(t.sessionId, 0.05);
    const run = store.listRuns({ taskId: t.id })[0];
    expect(run.costUsd).toBeCloseTo(1.05, 10);
    expect(store.getTask(t.id)!.spentUsd).toBeCloseTo(1.05, 10);
    expect(svc.activity(run.id).at(-1)).toMatchObject({ kind: "error", summary: "预算用完" });
    expect(svc.get(t.id)).toMatchObject({ stage: { key: "needs-you/budget", label: "预算用完", group: "needs" }, budgetUsd: 1 });
    // 问用户：一个不阻塞、不过期的提问，推到微信（一次），和任务的提问一个样子
    const [q] = approvals.pendingForTask(t.id);
    expect(q).toMatchObject({ kind: "question", tool: BUDGET_TOOL, blocking: false, expiresAt: 0, runId: run.id, detail: "已用约 $1.00，再给 $1 继续？" });
    expect(asks().map((r) => [r.id, r.body.text])).toEqual([[askId(q), "❓「季度报告 PPT」想问你：已用约 $1.00，再给 $1 继续？\n1. 继续\n2. 停止\n（回复编号，或引用这条消息回答）"]]);
    // 「需要你」：一行（审批中心那一份，状态是预算用完）；任务那一份不重复
    expect(approvalItems(store, approvals.pendingAll())).toMatchObject([{ kind: "question", subject: "季度报告 PPT", status: "预算用完", line: "已用约 $1.00，再给 $1 继续？", taskId: t.id, actions: ["answer"] }]);
    expect(svc.attention()).toEqual([]);
    expect(svc.listText(CONV)).toContain("季度报告 PPT · 预算用完");
    // 回 1：预算加 $1，同一个会话接着做（continue run，第一条是说明）
    expect(reply("1")).toEqual({ handled: true, ack: "收到，「季度报告 PPT」继续。" });
    await flush();
    expect(store.getTask(t.id)!.budgetUsd).toBe(2);
    expect(runs(t.id)).toEqual([
      ["launch", "ended", "budget"],
      ["continue", "running", ""],
    ]);
    expect(host.prompts.at(-1)).toMatchObject({ sessionId: t.sessionId, resume: true });
    expect(host.prompts.at(-1)!.text).toMatch(/^This task was stopped when it used its budget, and the user has now added more\. .*task_report\.$/);
    await turn(t.sessionId, (sid) => {
      spend(sid, 0.2);
      report(sid, "done", "季度报告做好了，在 report.pptx。");
    });
    expect(runs(t.id).at(-1)).toEqual(["continue", "ended", "done"]);
    expect(svc.get(t.id)!.stage.key).toBe("ready");
    expect(store.getTask(t.id)!.spentUsd).toBeCloseTo(1.25, 10);
    expect(store.listOutbox({ limit: 50 }).find((r) => r.id.includes(":result:"))!.body.text).toBe("季度报告做好了，在 report.pptx。");
    expect(approvals.pendingAll()).toEqual([]);
  });

  it("继续的其他办法：接口加预算（问的那个作废）；回「停止」就停掉；聊天里转来的话连同加预算一起交给任务；写了金额就加那么多", async () => {
    const a = start("A");
    await flush();
    await turn(a.sessionId, (sid) => spend(sid, 1.05));
    const qa = approvals.pendingForTask(a.id)[0];
    expect(qa.detail).toBe("已用约 $1.05，再给 $1 继续？");
    // 接口（POST /tasks/:id/budget）：加 $2
    const r = await svc.addBudget(a.id, 2, "web");
    expect(r.task).toMatchObject({ budgetUsd: 3, stage: { key: "working" } });
    expect(store.getApproval(qa.id)).toMatchObject({ status: "cancelled", decidedBy: "web" });
    expect(runs(a.id).at(-1)).toEqual(["continue", "running", ""]);
    expect(asks().find((x) => x.id === askId(qa))!.status).toBe("gone");
    expect((await svc.addBudget(a.id, 0)).error).toBe("金额不对");
    await turn(a.sessionId, (sid) => report(sid, "done", "A 好了"));

    // 回「停止」：停掉任务，回一句停了
    const b = start("B");
    await flush();
    await turn(b.sessionId, (sid) => spend(sid, 1));
    expect(asks().at(-1)!.body.text).toContain("「B」想问你：已用约 $1.00");
    expect(reply("停止")).toEqual({ handled: true, ack: "已停止后台任务「B」。" });
    await flush();
    expect(store.getTask(b.id)!.endReason).toBe("stopped");

    // 聊天代理转来的话（task_message）：是对这个提问的回答，加 $1，话一起交给任务
    const c = start("C");
    await flush();
    await turn(c.sessionId, (sid) => spend(sid, 1));
    expect((await svc.message(c.id, "继续，但改成英文")).how).toBe("answered");
    await flush();
    expect(store.getTask(c.id)!.budgetUsd).toBe(2);
    expect(host.prompts.at(-1)!.text).toMatch(/^This task was stopped when it used its budget[\s\S]*\n\n\[用户追加\]\n继续，但改成英文$/);
    await turn(c.sessionId, (sid) => report(sid, "done", "C 好了"));

    // 写了金额：加那么多
    const d = start("D");
    await flush();
    await turn(d.sessionId, (sid) => spend(sid, 1));
    approvals.answerText(approvals.pendingForTask(d.id)[0].id, "再给 3 美元", "weixin:owner");
    await flush();
    expect(store.getTask(d.id)!.budgetUsd).toBe(4);
    expect(host.prompts.at(-1)!.text).not.toContain("[用户追加]");
  });

  it("预算用完以后又来的输入（重试、追加）不交给会话，先问；问的那个没了（重启前没问出去）就在启动时补问，「需要你」里任务那一份先顶上", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, (sid) => spend(sid, 1));
    const q = approvals.pendingForTask(t.id)[0];
    approvals.cancel(q.id, "test");
    // 问的那个不在了：任务那一份（继续 / 停止）
    expect(svc.attention()).toMatchObject([{ id: `task:${t.id}`, kind: "failed", status: "预算用完", line: "已用约 $1.00，再给 $1 继续？", actions: ["continue", "stop"], severity: "warn" }]);
    // 重启：补问一次
    svc.stop();
    svc = make();
    svc.start();
    expect(approvals.pendingForTask(t.id).map((r) => [r.tool, r.status])).toEqual([[BUDGET_TOOL, "pending"]]);
    expect(svc.attention()).toEqual([]);
    // 重试：不交给会话（还没加预算），这次 run 直接以 budget 结束；不再问第二遍
    const prompts = host.prompts.length;
    expect((await svc.retry(t.id)).how).toBe("resumed");
    await flush();
    expect(host.prompts).toHaveLength(prompts);
    expect(runs(t.id).at(-1)).toEqual(["retry", "ended", "budget"]);
    expect(approvals.pendingForTask(t.id)).toHaveLength(1);
    // 加了预算：那条重试的话也交过去
    await svc.addBudget(t.id);
    await flush();
    expect(host.prompts.at(-1)!.text).toContain("[用户让你再试一次]");
    expect(host.prompts.at(-1)!.text).toContain("This task was stopped when it used its budget");
  });

  it("规则每次 $0.10：超了就停下（这次以 budget 结束，算一次失败，运行记录写原因和花费）；连续 3 次暂停", async () => {
    const rule = await createRule();
    for (const [i, day] of ["2026-11-03", "2026-11-04", "2026-11-05"].entries()) {
      await go(at(`${day}T08:00`));
      const sid = host.prompts.at(-1)!.sessionId;
      expect(host.prompts.at(-1)!.model).toBe("small-model");
      await turn(sid, () => {
        spend(sid, 0.06);
        expect(host.stops).not.toContain(sid);
        spend(sid, 0.06);
      });
      expect(host.stops).toContain(sid);
      expect(store.getRule(rule.id)!.failures).toBe(i + 1);
    }
    expect(svc.ruleLog(rule.id)[0]).toMatchObject({ outcome: "budget", line: "停下：超出单次预算", error: "超出单次预算" });
    expect(svc.ruleLog(rule.id)[0].costUsd).toBeCloseTo(0.12, 10);
    expect(store.getRule(rule.id)).toMatchObject({ pausedReason: "failures", nextRunAt: 0 });
    expect(svc.ruleAttention()).toMatchObject([{ status: "连续失败 3 次，已暂停", line: "超出单次预算", actions: ["retry"] }]);
    // 本月的花费：三次一共
    expect(svc.getRuleView(rule.id)!.monthUsd).toBeCloseTo(0.36, 10);
  });

  it("规则每月 $3：用完就停下并暂停（执行中的推一句，「需要你」里一行），下个月 1 号 0 点（主人的时区）自动恢复", async () => {
    const rule = await createRule();
    svc.updateRule(rule.id, { runBudgetUsd: 2 });
    const day = async (d: string, usd: number[]) => {
      await go(at(`${d}T08:00`));
      await turn(undefined, (sid) => {
        for (const x of usd) spend(sid, x);
        report(sid, "done");
      });
    };
    await day("2026-11-03", [1.5]);
    await day("2026-11-04", [1.0]);
    expect(store.getRule(rule.id)!.pausedReason).toBe("");
    // 第三天花到 $3.10：这一次停下（还没报告），规则暂停
    await go(at("2026-11-05T08:00"));
    const sid = host.prompts.at(-1)!.sessionId;
    spend(sid, 0.3);
    expect(host.stops).not.toContain(sid);
    spend(sid, 0.3);
    await flush();
    expect(host.stops).toContain(sid);
    expect(ruleRuns(rule.id).at(-1)).toMatchObject({ outcome: "budget", error: "month_budget" });
    expect(svc.ruleLog(rule.id)[0].line).toBe("停下：本月预算用完");
    expect(store.getRule(rule.id)).toMatchObject({ pausedReason: "budget", nextRunAt: 0, failures: 0 });
    const v = svc.getRuleView(rule.id)!;
    expect(v).toMatchObject({ state: { key: "paused", dot: "warn" }, pausedReason: "budget", monthBudgetUsd: 3 });
    expect(v.monthUsd).toBeCloseTo(3.1, 10);
    // 执行中的规则：推一句（一个月一次）；「需要你」里一行，可以再给 $3
    const pushed = store.listOutbox({ limit: 50 }).filter((r) => r.id.startsWith(`rule:${rule.id}:budget:`));
    expect(pushed.map((r) => [r.id, r.purpose, r.body.text])).toEqual([[`rule:${rule.id}:budget:2026-11:3`, "failure", "⚠️ 规则「看 X 价格」本月预算用完（约 $3.10），已暂停，下月自动恢复。"]]);
    expect(svc.ruleAttention()).toEqual([
      expect.objectContaining({ id: `rule:${rule.id}`, kind: "rule", subject: "规则「看 X 价格」", status: "本月预算用完", line: "已用约 $3.10，下月自动恢复。再给 $3 继续？", severity: "warn", actions: ["continue"] }),
    ]);
    expect(svc.runRuleNow(rule.id).error).toBe("本月预算已用完（约 $3.10）");
    // 这个月里不再跑；定时器在下个月 1 号 0 点（上海）醒来
    await go(at("2026-11-06T08:00"));
    expect(ruleRuns(rule.id)).toHaveLength(3);
    expect((svc as any).nextWake()).toBe(at("2026-12-01T00:00"));
    // 上海还是 11 月 30 日 23:59（UTC 已经是 15:59）：还停着
    await go(at("2026-11-30T23:59"));
    expect(store.getRule(rule.id)!.pausedReason).toBe("budget");
    // 上海 12 月 1 日 0 点（UTC 还是 11 月 30 日 16:00）：恢复，按时间表跑；「需要你」里那行消失
    await go(at("2026-12-01T00:00"));
    expect(store.getRule(rule.id)).toMatchObject({ pausedReason: "", nextRunAt: at("2026-12-01T08:00") });
    expect(svc.ruleAttention()).toEqual([]);
    expect(svc.getRuleView(rule.id)!.monthUsd).toBe(0);
    await go(at("2026-12-01T08:00"));
    expect(ruleRuns(rule.id).at(-1)).toMatchObject({ state: "running", queuedAt: at("2026-12-01T08:00") });
  });

  it("「再给 $3」：本月预算用完暂停着的规则加了预算就接着按时间表跑；观察中的不推", async () => {
    const rule = await createRule({ mode: "observe" });
    svc.updateRule(rule.id, { monthBudgetUsd: 0.2, runBudgetUsd: 1 });
    await go(at("2026-11-03T08:00"));
    await turn(undefined, (sid) => {
      spend(sid, 0.15);
      report(sid, "done");
    });
    // 这一次报完了才超：照常结束，之后暂停
    await go(at("2026-11-04T08:00"));
    await turn(undefined, (sid) => {
      report(sid, "done");
      spend(sid, 0.1);
    });
    expect(ruleRuns(rule.id).at(-1)).toMatchObject({ outcome: "done" });
    expect(store.getRule(rule.id)!.pausedReason).toBe("budget");
    expect(store.listOutbox({ limit: 50 }).filter((r) => r.id.startsWith("rule:"))).toEqual([]);
    expect(svc.addRuleBudget(rule.id).rule).toMatchObject({ monthBudgetUsd: 3.2, pausedReason: "", nextRunAt: at("2026-11-05T08:00"), state: { key: "observe" } });
    expect(svc.ruleAttention()).toEqual([]);
    expect(svc.updateRule(rule.id, { monthBudgetUsd: -1 }).error).toBe("金额不对");
  });

  it("机器人的预算 Key 剩不到 20%：在跑的任务停下排着（不算失败）、规则跳过、不开新任务，「需要你」里一行；预算回来就接着做", async () => {
    budget = { limitUsd: 10, remainUsd: 2.3, at: 1 };
    const rule = await createRule();
    const t = start();
    await flush();
    await turn(t.sessionId, (sid) => {
      spend(sid, 0.25);
      expect(host.cancels).toEqual([]);
      spend(sid, 0.1);
    });
    // 剩 $1.95 < $2：停下这一轮，排一个 run 等预算回来
    expect(host.cancels).toEqual([t.sessionId]);
    expect(runs(t.id)).toEqual([
      ["launch", "ended", "interrupted"],
      ["recover", "queued", ""],
    ]);
    expect(store.listRuns({ taskId: t.id })[0].error).toBe("reserve");
    expect(svc.get(t.id)!.stage.key).toBe("working/queued");
    expect(svc.attention()).toEqual([{ id: "reserve:b", kind: "budget", botId: "b", botName: "小蓝", subject: "后台工作已停", status: "", head: "后台工作已停", line: "机器人预算只剩约 $1.95（共 $10），留给聊天", since: now, severity: "warn", actions: ["open"] }]);
    expect(approvals.pendingAll()).toEqual([]);
    // 不开新任务（聊天代理照实说）；规则到点跳过
    const r = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "start", args: { title: "又一个", brief: "" } });
    expect(r.error).toMatch(/about \$1\.95 of \$10 left\) and the rest is kept for chat/);
    expect(store.listTasks({ botId: "b" })).toHaveLength(1);
    await go(at("2026-11-03T08:00"));
    expect(svc.ruleLog(rule.id)[0]).toMatchObject({ outcome: "skipped", line: "跳过：机器人预算留给聊天" });
    expect(svc.runRuleNow(rule.id).error).toBe("机器人预算留给聊天");
    // 预算回来了（调高了预算，应用读到新的余额）：排着的接着做，第一条是说明
    budget = { limitUsd: 20, remainUsd: 11.95, at: 2 };
    svc.budgetsChanged();
    await flush();
    expect(runs(t.id).at(-1)).toEqual(["recover", "running", ""]);
    expect(host.prompts.at(-1)).toMatchObject({ sessionId: t.sessionId, resume: true });
    expect(host.prompts.at(-1)!.text).toMatch(/^The app paused this task to keep the bot's remaining budget for chat, and has now resumed it\./);
    expect(svc.attention()).toEqual([]);
    // 没开预算的机器人：从不停
    budget = undefined;
    expect(svc.reserve("b")).toBeUndefined();
  });

  it("任务每次运行最多 4 小时，等人批准的时间不算；到了取消这一轮、算失败（推一句，可以重试）", async () => {
    const t = start();
    await flush();
    const t0 = now;
    const runId = store.listRuns({ taskId: t.id })[0].id;
    now = t0 + 1 * H;
    const a = approvals.create({ kind: "approval", botId: "b", conversationId: CONV, sessionId: t.sessionId, tool: "bash", detail: "rm -rf build/", reason: "", taskId: t.id, runId, ttlMs: 12 * H });
    // 还在等批准：等着的这段到现在都不算
    now = t0 + 4 * H + 30 * MIN;
    svc.checkCaps();
    expect(runs(t.id)).toEqual([["launch", "running", ""]]);
    now = t0 + 5 * H;
    approvals.decide(a.id, true, "weixin:owner");
    // 过了将近 8 小时，其中等了 4 小时：还差一分钟
    now = t0 + 8 * H - MIN;
    svc.checkCaps();
    expect(runs(t.id)).toEqual([["launch", "running", ""]]);
    expect(host.cancels).toEqual([]);
    now = t0 + 8 * H;
    svc.checkCaps();
    expect(runs(t.id)).toEqual([["launch", "ended", "failed"]]);
    expect(host.cancels).toEqual([t.sessionId]);
    expect(host.stops).toEqual([]);
    expect(store.listRuns({ taskId: t.id })[0].error).toBe("运行超过 4 小时，已停下");
    expect(store.listMessages(CONV).at(-1)!.content).toBe("⚠️「季度报告 PPT」没做完：运行超过 4 小时，已停下");
    expect(svc.attention()).toMatchObject([{ id: `task:${t.id}`, kind: "failed", line: "运行超过 4 小时，已停下", actions: ["retry", "stop"] }]);
    // 重试：新的一次运行，重新计时
    await svc.retry(t.id);
    await flush();
    expect(runs(t.id).at(-1)).toEqual(["retry", "running", ""]);
    now += 3 * H;
    svc.checkCaps();
    expect(runs(t.id).at(-1)).toEqual(["retry", "running", ""]);
  });
});
