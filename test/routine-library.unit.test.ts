/**
 * 任务库（PRD 2026-11-15）：任务数据和各语言的文案对得上；按参数写出名称、原话（[……] 没填就去掉、末尾统一追加的要求）；
 * 参数校验；按参数定的时间表（每月几号提前几天、每年几月几日、按市场选）；任务卡的默认时间和每月次数；
 * 以及规则服务这边：「用起来」建开着 / 关着的规则（来源、结果样式、重复检测、改模板自带的那条）、「先试一次」
 * （关着也能跑、只读、不发、不算失败、记进本月花费、能停）、简报（保留多行、主模型只润色、渠道里超长截断）、
 * 对话里的 routine_library（列出、按任务建规则、缺参数和缺应用时说清楚）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultWhen, draftRule, fillTemplate, libraryStrings, libraryTask, libraryTasks, normalizeParams, scheduleFor, searchText } from "../src/tasks/library.js";
import { describe as describeSchedule, nextRun, normalizeSchedule, parseSchedule, previewSchedule, type Schedule } from "../src/tasks/schedule.js";
import { TaskService, type TaskHost, type TaskNotification } from "../src/tasks/service.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import { RULE_BRIEF_SYSTEM, RULE_RESULT_SYSTEM, ruleRules } from "../src/agent/prompts/index.js";
import { Outbox } from "../src/core/outbox.js";
import { Delivery } from "../src/delivery/index.js";
import { Store } from "../src/store/db.js";
import { takeTaskNotes } from "../src/core/task-notes.js";
import { BUILTIN_APPS } from "../src/tools/apps/catalog.js";
import { withLang, type Lang } from "../src/i18n/index.js";
import manifest from "../ui/locales/manifest.json" with { type: "json" };

const TZ = "Asia/Shanghai";
const at = (s: string) => Date.parse(`${s}${s.length === 16 ? ":00" : ""}+08:00`);
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const LANGS = manifest.locales.map((l) => l.code) as Lang[];
const task = (id: string) => libraryTask(id)!;

describe("任务库：数据和文案", () => {
  const visible = libraryTasks().filter((x) => !x.hidden);
  it("一期 20 条：分类计数、推荐顺序、首屏 6 条都不用连应用", () => {
    expect(visible).toHaveLength(20);
    const count = (c: string) => visible.filter((x) => x.category === c).length;
    expect([count("news"), count("work"), count("learning"), count("life"), count("money")]).toEqual([5, 6, 3, 4, 2]);
    expect(new Set(visible.map((x) => x.rank)).size).toBe(20);
    const first = visible.slice(0, 6);
    expect(first.map((x) => x.id)).toEqual(["industry-brief", "company-watch", "weekly-report-reminder", "language-practice", "weather", "bill-reminder"]);
    for (const x of first) expect((x.needs.apps ?? []).some((a) => a.required) || !!x.needs.group).toBe(false);
    expect(visible.filter((x) => !(x.needs.apps ?? []).some((a) => a.required) && !x.needs.group)).toHaveLength(15);
    // 联网版只能从「改用联网版」到
    expect(task("repo-activity").fallback).toBe("repo-activity-web");
    expect(task("repo-activity-web").hidden).toBe(true);
    // 检查类的默认频率都不超过每天一次；唯一的高频是提醒
    for (const x of visible.filter((y) => y.kind === "check")) {
      const s = scheduleFor(x, { day: 1, date: "03-15" }, TZ, at("2026-11-15T10:00"));
      expect(previewSchedule(s!, at("2026-11-15T10:00")).monthlyRuns, x.id).toBeLessThanOrEqual(31);
    }
  });
  it("应用都在当前版本里；每种语言都有每条任务的文案，步骤 3–5 条，参数和选项一一对应", () => {
    const apps = new Set(BUILTIN_APPS.map((a) => a.id));
    for (const x of libraryTasks()) for (const a of x.needs.apps ?? []) for (const id of [a.id, ...(a.alternatives ?? [])]) expect(apps.has(id)).toBe(true);
    for (const l of LANGS) {
      const s = libraryStrings(l);
      for (const x of libraryTasks()) {
        const c = s.tasks[x.id];
        expect(c, `${l} ${x.id}`).toBeDefined();
        for (const k of ["title", "oneLine", "audience", "sample", "instruction"] as const) expect(c[k].trim(), `${l} ${x.id} ${k}`).not.toBe("");
        expect(c.steps.length, `${l} ${x.id}`).toBeGreaterThanOrEqual(2);
        expect(c.steps.length).toBeLessThanOrEqual(5);
        expect(c.steps.length).toBe(libraryStrings("zh-CN").tasks[x.id].steps.length);
        // 模板里的占位只用这条任务的参数
        const keys = new Set(x.params.map((p) => p.key));
        for (const m of c.instruction.matchAll(/\{(\w+)(\.say)?\}/g)) expect(keys.has(m[1]), `${l} ${x.id} {${m[1]}}`).toBe(true);
        for (const p of x.params) {
          expect(c.params[p.key]?.label, `${l} ${x.id} ${p.key}`).toBeTruthy();
          if (p.type === "select" || p.type === "multiselect") for (const o of p.options!) expect(c.params[p.key].options?.[o], `${l} ${x.id} ${p.key}.${o}`).toBeTruthy();
          if (p.prefill) expect(c.params[p.key].prefill, `${l} ${x.id} ${p.key}`).toBeTruthy();
        }
      }
    }
  });
  it("搜索：中英文都能搜，应用名也算", () => {
    const hits = (q: string) => visible.filter((x) => searchText(x, "zh-CN").includes(q.toLowerCase())).map((x) => x.id);
    expect(hits("钉钉")).toContain("today-agenda");
    expect(hits("GitHub")).toEqual(expect.arrayContaining(["github-trending", "my-issues", "repo-activity"]));
    expect(hits("天气")).toContain("weather");
    expect(hits("weather")).toContain("weather");
  });
});

describe("任务库：名称、原话和参数", () => {
  const now = at("2026-11-15T10:00");
  const draft = (id: string, params: Record<string, unknown>, lang: Lang = "zh-CN", groups?: Array<{ id: string; name: string }>) => draftRule(task(id), params, { lang, tz: TZ, now, groups });
  it("{key} 换成参数；[……] 里有没填的就整段去掉；末尾按属性统一追加", () => {
    const a = draft("industry-brief", { field: "新能源汽车", exclude: "融资快讯" });
    expect(a.title).toBe("行业早报 · 新能源汽车");
    expect(a.instruction).toContain("整理过去 24 小时「新能源汽车」领域最值得关注的 5 条动态");
    expect(a.instruction).toContain("不要：融资快讯。按重要程度排序");
    expect(a.instruction).toContain("只用可以公开访问的网页");
    expect(a.instruction).toContain("用列表写，不超过 1500 字。");
    expect(a.instruction).not.toContain("没有新内容时不发消息");
    expect(a).toMatchObject({ kind: "check", resultStyle: "brief", errors: {} });
    const b = draft("industry-brief", { field: "新能源\n汽车", count: "3" });
    expect(b.instruction).not.toContain("不要：");
    expect(b.instruction).toContain("「新能源 汽车」领域最值得关注的 3 条动态");
    // 关注类：没新内容就不发；读应用的只读取
    expect(draft("company-watch", { names: "甲公司，乙品牌" }).instruction).toContain("「甲公司、乙品牌」");
    expect(draft("company-watch", { names: ["甲公司"] }).instruction).toContain("没有新内容时不发消息。");
    expect(draft("today-agenda", { scope: "important" }).instruction).toContain("每项给一个下一步建议，只看标为重要的。");
    expect(draft("today-agenda", {}).instruction).toContain("每项给一个下一步建议。今天没有安排");
    expect(draft("today-agenda", {}).instruction).toContain("只读取，不修改、不发送任何内容。");
    // 提醒：原话就是到点发的那句话，不追加要求
    const r = draft("weekly-report-reminder", {});
    expect(r).toMatchObject({ kind: "remind", message: "该写周报了，把这周做的事发给我，我帮你整理。", instruction: "该写周报了，把这周做的事发给我，我帮你整理。" });
    expect(draft("birthday-reminder", { who: "妈妈", date: "03-15", advance: "3" }).message).toBe("3 天后是妈妈的生日，记得准备。");
    expect(draft("bill-reminder", { item: "房租", day: "last" }).message).toBe("房租：月底到期，记得处理。");
    expect(draft("price-alert", { item: "usd", direction: "below", price: "7.10" }).instruction).toContain("查美元兑人民币现在的价格。低于 7.1 时");
    // 修复四 R7：到价提醒和收盘简报一样，命中时带免责说明；取不到价格写「没取到」，不估算、不算到价
    const alert = draft("price-alert", { item: "usd", direction: "below", price: "7.10" }).instruction;
    expect(alert).toContain("末尾写「仅供参考，不构成投资建议。」");
    expect(alert).toContain("只写「美元兑人民币没取到。」，不要估算价格，也不算到价");
    expect(draft("price-alert", { item: "gold", direction: "above", price: "600" }, "en").instruction).toContain("end with \"For reference only, not investment advice.\"");
    // 规则名称里的群名
    expect(draft("group-digest", { group: "g1" }, "zh-CN", [{ id: "g1", name: "产品群" }]).title).toBe("应用内群聊日报 · 产品群");
    // 原话保持建立时的语言
    expect(draft("weather", { city: "Seattle" }, "en").instruction).toMatch(/^Check today's weather forecast for Seattle/);
  });
  it("每种语言、每条任务按样例参数都能写出完整的名称和原话：没有剩下的 {key}、[……]", () => {
    const sample: Record<string, unknown> = { field: "AI", names: "A, B", message: "", language: "ja", city: "X", item: "usd", day: 15, rivals: "A", topic: "AI", groups: "G", group: "g1", app: "github", project: "P", repos: "a/b", who: "W", date: "03-15", advance: "3", symbols: "S", price: "7.1", direction: "below", scope: "important", focus: "x" };
    for (const l of LANGS) for (const x of libraryTasks()) {
      const params = Object.fromEntries(x.params.map((p) => [p.key, p.type === "multiselect" ? [p.options![0]] : p.key === "item" && x.id === "bill-reminder" ? "Rent" : p.prefill ? undefined : sample[p.key]]).filter(([, v]) => v !== undefined));
      const d = draft(x.id, params, l, [{ id: "g1", name: "G" }]);
      expect(d.errors, `${l} ${x.id}`).toEqual({});
      for (const text of [d.title, d.instruction, d.message]) expect(text, `${l} ${x.id}`).not.toMatch(/\{\w+(\.say)?\}|\[|\]/);
      expect(d.title.length, `${l} ${x.id}`).toBeGreaterThan(2);
    }
  });
  it("[……] 嵌在句子里、说法（say）为空时不留多余的标点", () => {
    expect(fillTemplate("A[，B：{b}]。", (k) => (k === "b" ? "" : "x"))).toBe("A。");
    expect(fillTemplate("A[，B：{b}]。", (k) => (k === "b" ? "1" : "x"))).toBe("A，B：1。");
  });
  it("校验：必填、超长（不截断）、列表项数、仓库格式、日期、选项", () => {
    const e = (id: string, params: Record<string, unknown>) => normalizeParams(task(id), params, "zh-CN").errors;
    expect(e("industry-brief", {})).toEqual({ field: "required" });
    expect(e("industry-brief", { field: "一".repeat(21) })).toEqual({ field: "tooLong" });
    expect(e("company-watch", { names: "a,b,c,d,e,f" })).toEqual({ names: "tooMany" });
    expect(e("repo-activity", { repos: "not a repo" })).toEqual({ repos: "repoFormat" });
    expect(normalizeParams(task("repo-activity"), { repos: "https://github.com/acme/app/" }, "zh-CN").values.repos).toEqual(["acme/app"]);
    expect(e("birthday-reminder", { who: "妈妈", date: "02-30" })).toEqual({ date: "format" });
    expect(e("birthday-reminder", { who: "妈妈", date: "02-29" })).toEqual({});
    expect(e("price-alert", { item: "btc", price: "1" })).toEqual({ item: "invalid" });
    expect(e("price-alert", { item: "gold", price: "-1" })).toEqual({ price: "format" });
    expect(e("ai-tools-weekly", { scope: [] })).toEqual({ scope: "required" });
    expect(e("feishu-digest", {})).toEqual({});
    expect(normalizeParams(task("group-digest"), { group: "g9" }, "zh-CN", { groups: ["g1"] }).errors).toEqual({ group: "invalid" });
  });
});

describe("任务库：按参数定的时间表", () => {
  const now = at("2026-11-15T10:00");
  const s = (id: string, params: Record<string, unknown>) => scheduleFor(task(id), params, TZ, now)!;
  it("每月几号、提前几天：跨到上个月；当月没有这一天落在最后一天", () => {
    expect(s("bill-reminder", { day: 1, advance: "1" })).toEqual({ kind: "monthly", time: "09:00", day: 1, before: 1, tz: TZ });
    expect(nextRun(s("bill-reminder", { day: 1, advance: "1" }), now)).toBe(at("2026-11-30T09:00"));
    expect(nextRun(s("bill-reminder", { day: 31 }), now)).toBe(at("2026-11-30T09:00"));
    expect(nextRun(s("bill-reminder", { day: "last", advance: "3" }), now)).toBe(at("2026-11-27T09:00"));
    expect(nextRun(s("bill-reminder", { day: 15 }), now)).toBe(at("2026-12-15T09:00"));
    expect(previewSchedule(s("bill-reminder", { day: 20 }), now).monthlyRuns).toBe(1);
    expect(describeSchedule(s("bill-reminder", { day: 1, advance: "1" }), false, "zh-CN")).toBe("每月 1 日 09:00（提前 1 天）");
    expect(scheduleFor(task("bill-reminder"), {}, TZ, now)).toBeUndefined();
  });
  it("每年几月几日：2 月 29 日平年按 2 月 28 日；提前几天", () => {
    const feb29 = s("birthday-reminder", { date: "02-29" });
    expect(feb29).toEqual({ kind: "yearly", time: "09:00", month: 2, day: 29, tz: TZ });
    expect(nextRun(feb29, now)).toBe(at("2027-02-28T09:00"));
    expect(nextRun(feb29, at("2027-03-01T00:00"))).toBe(at("2028-02-29T09:00"));
    expect(nextRun(s("birthday-reminder", { date: "02-29", advance: "3" }), now)).toBe(at("2027-02-25T09:00"));
    expect(nextRun(s("birthday-reminder", { date: "01-02", advance: "7" }), now)).toBe(at("2026-12-26T09:00"));
    expect(describeSchedule(s("birthday-reminder", { date: "03-15" }), false, "zh-CN")).toBe("每年 3月15日 09:00");
    expect(describeSchedule(s("birthday-reminder", { date: "03-15", advance: "7" }), false, "en")).toBe("Every year on Mar 15 at 09:00 (7 days early)");
    expect(parseSchedule("yearly 03-15 09:00", TZ, now).schedule).toEqual({ kind: "yearly", time: "09:00", month: 3, day: 15, tz: TZ });
    expect(normalizeSchedule({ kind: "yearly", month: 4, day: 31, time: "09:00" }, TZ, now).error).toBeDefined();
  });
  it("收盘简报按市场选时间；喝水提醒的 cron 说成人话，约 110 次", () => {
    expect(s("watchlist-close", {})).toEqual({ kind: "daily", time: "15:30", days: [1, 2, 3, 4, 5], tz: TZ });
    expect(s("watchlist-close", { market: "us" })).toEqual({ kind: "weekly", time: "07:00", days: [2, 3, 4, 5, 6], tz: TZ });
    const water = s("water-break", {});
    expect(describeSchedule(water, false, "zh-CN")).toBe("工作日 10:00–18:00 每 2 小时");
    expect(describeSchedule(water, false, "en")).toBe("Weekdays 10:00–18:00, every 2 hours");
    expect(describeSchedule({ kind: "cron", cron: "0 8 * * 1-5", tz: TZ }, false, "zh-CN")).toBe("cron 0 8 * * 1-5");
    const runs = previewSchedule(water, now).monthlyRuns;
    expect(runs).toBeGreaterThanOrEqual(100);
    expect(runs).toBeLessThanOrEqual(115);
  });
  it("任务卡的默认时间：等参数的用文案里的那句；每年的说每年 1 次", () => {
    expect(defaultWhen(task("industry-brief"), "zh-CN", TZ, now)).toMatchObject({ text: "每个工作日 08:30" });
    expect(defaultWhen(task("industry-brief"), "zh-CN", TZ, now).monthlyRuns).toBeGreaterThanOrEqual(20);
    expect(defaultWhen(task("bill-reminder"), "zh-CN", TZ, now)).toEqual({ text: "每月你定的那天 09:00", monthlyRuns: 1 });
    expect(defaultWhen(task("birthday-reminder"), "zh-CN", TZ, now)).toEqual({ text: "每年你定的那天 09:00", yearly: true });
    expect(defaultWhen(task("watchlist-close"), "zh-CN", TZ, now).text).toBe("交易日收盘后");
  });
});

class FakeHost implements TaskHost {
  available = true;
  prompts: Array<{ botId: string; sessionId: string; folder: string; model: string; text: string; resume: boolean; id: string }> = [];
  stops: string[] = [];
  settingsValue = { ...DEFAULT_SETTINGS, utilityModel: "small-model" };
  private n = 0;
  constructor(readonly ws: string) {}
  workspace() { return this.ws; }
  settings() { return this.settingsValue; }
  memoryPrefix() { return ""; }
  async prompt(botId: string, o: { sessionId: string; folder: string; model: string; text: string; resume: boolean }) {
    const id = `msg-${++this.n}`;
    this.prompts.push({ botId, ...o, id });
    return id;
  }
  async steer() { return false; }
  async stop(_botId: string, sessionId: string) { this.stops.push(sessionId); }
  async cancel() {}
  async quiet() { return { quiet: true }; }
}

describe("任务库：规则服务（假宿主、假时钟）", () => {
  let store: Store;
  let host: FakeHost;
  let svc: TaskService;
  let ws: string;
  let now: number;
  let apps: Record<string, "connected" | "reauth" | "none">;
  let writes: Array<{ system: string; user: string }>;
  let answer: string;
  const WX = "b:weixin:owner";
  const WEB = "b:web:console";
  beforeEach(() => {
    now = at("2026-11-15T07:00");
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-routines-"));
    store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝", weixinEnabled: true });
    store.ensureConversation("b", "weixin", "owner", "owner");
    store.ensureConversation("b", "web", "console", "console");
    host = new FakeHost(ws);
    apps = {};
    writes = [];
    answer = "";
    const outbox = new Outbox(store, { now: () => now });
    const delivery = new Delivery({ store, outbox, now: () => now, timeZone: TZ });
    svc = new TaskService({
      store, host, delivery, now: () => now, timeZone: TZ, catchupDelayMs: 0, retryDelaysMs: [5, 5, 5], defaultModel: () => "main-model",
      appState: (id) => apps[id] ?? "none",
      rates: () => ({ input: 1, output: 1 }) as any,
      complete: async (_b, _m, system, user) => { writes.push({ system, user }); return answer; },
    });
    svc.start();
  });
  afterEach(() => {
    svc.stop();
    store.close();
    fs.rmSync(ws, { recursive: true, force: true });
  });
  const ev = (sessionId: string, type: string, data: any = {}): TaskNotification => ({ method: "session.event", params: { sessionId, event: { type, data, time: now } } });
  const status = (sessionId: string, s: "running" | "idle"): TaskNotification => ({ method: "session.status", params: { sessionId, status: s } });
  const turn = async (during?: (sessionId: string) => void) => {
    const p = host.prompts.at(-1)!;
    const sid = p.sessionId;
    svc.onEvent("b", sid, status(sid, "running"));
    svc.onEvent("b", sid, ev(sid, "turn/start", { turn: 1 }));
    svc.onEvent("b", sid, ev(sid, "user/message", { id: p.id, role: "user", content: [{ type: "text", text: p.text }] }));
    during?.(sid);
    svc.onEvent("b", sid, ev(sid, "turn/end", { turn: 1, reason: { kind: "completed" } }));
    svc.onEvent("b", sid, status(sid, "idle"));
    await flush();
  };
  const save = (o: Partial<Parameters<TaskService["saveRoutine"]>[0]> = {}) =>
    withLang("zh-CN", () => svc.saveRoutine({ taskId: "industry-brief", params: { field: "新能源汽车" }, botId: "b", on: true, ...o }));

  it("「打开」：开着的检查、执行模式、简报、来源记下 id 和 version；名称带参数、超过 40 字截断；留一张便条", async () => {
    const r = await save();
    expect(r.error).toBeUndefined();
    expect(r.rule).toMatchObject({ kind: "check", mode: "act", resultStyle: "brief", title: "行业早报 · 新能源汽车", conversationId: WEB, source: { id: "industry-brief", version: 1, params: { field: "新能源汽车", count: "5" } } });
    expect(r.rule!.trigger).toEqual({ kind: "schedule", schedule: { kind: "daily", time: "08:30", days: [1, 2, 3, 4, 5], tz: TZ } });
    expect(svc.getRuleView(r.rule!.id)).toMatchObject({ resultStyle: "brief", source: { id: "industry-brief", title: "行业早报" } });
    const long = await save({ params: { field: "一二三四五六七八九十一二三四五六七八九十" }, force: true });
    expect([...long.rule!.title].length).toBeLessThanOrEqual(40);
    expect(takeTaskNotes(store, WEB)).toContain("用户从任务库打开了规则「行业早报 · 新能源汽车」：整理过去 24 小时");
  });
  it("同一个机器人、同一任务、参数相同：先返回重复；仍然新建就建；预算按任务给的默认", async () => {
    await save();
    const again = await save();
    expect(again.duplicate?.title).toBe("行业早报 · 新能源汽车");
    expect(again.rule).toBeUndefined();
    expect((await save({ force: true })).rule).toBeDefined();
    expect((await save({ params: { field: "新能源汽车", count: "8" } })).duplicate).toBeUndefined();
    const weekly = await save({ taskId: "ai-tools-weekly", params: {} });
    expect(weekly.rule).toMatchObject({ runBudgetUsd: 0.3, monthBudgetUsd: 3 });
  });
  it("必需的应用没连就不能打开；三选一看用户选的那个；机器人不在了说清楚", async () => {
    expect(await save({ taskId: "today-agenda", params: {} })).toMatchObject({ code: "app", error: "先连接钉钉" });
    apps.dingtalk = "reauth";
    expect((await save({ taskId: "today-agenda", params: {} })).code).toBe("app");
    apps.dingtalk = "connected";
    expect((await save({ taskId: "today-agenda", params: {} })).rule).toBeDefined();
    apps.linear = "connected";
    expect((await save({ taskId: "my-issues", params: { app: "github" } })).code).toBe("app");
    expect((await save({ taskId: "my-issues", params: { app: "linear" } })).rule?.title).toBe("我的待办工单早报 · Linear");
    expect(await save({ botId: "gone" })).toMatchObject({ code: "bot_gone", error: "这个机器人已经不在了，换一个吧。" });
    expect(await save({ params: {} })).toMatchObject({ code: "params", error: "先填「关注领域」" });
  });
  it("先试一次：存成关着的规则；只读跑一次，结果不发、只进运行记录（标试跑）；关着到点不跑；花费计入本月；打开后照常", async () => {
    const r = await save({ on: false });
    expect(r.rule!.mode).toBe("off");
    const trial = svc.trialRule(r.rule!.id);
    expect(trial.error).toBeUndefined();
    await flush();
    const p = host.prompts.at(-1)!;
    expect(p.text).toContain("[这次]\n试跑：用户正在看效果");
    expect(svc.sessionConfig({ sessionId: p.sessionId })).toMatchObject({ mode: "observe", style: "brief", permission: "read-only", section: ruleRules("observe", "brief") });
    // 同一条规则同时只能有一次试跑
    expect(svc.trialRule(r.rule!.id).error).toBe("这条规则正在运行，等它跑完再试。");
    answer = "**新能源汽车早报**\n1. 甲车企发布新车 [来源](https://example.com/1)\n2. 乙电池厂扩产 [来源](https://example.com/2)";
    await turn((sid) => {
      svc.onEvent("b", sid, ev(sid, "usage", { model: "small-model", usage: { input_tokens: 1000, output_tokens: 500 } }));
      expect(svc.report({ sessionId: sid, state: "done", summary: "查了 12 篇", message: "**早报**\n1. 甲 [来源](https://example.com/1)\n\n\n\n2. 乙" }).error).toBeUndefined();
    });
    await flush();
    const log = withLang("zh-CN", () => svc.ruleLog(r.rule!.id));
    expect(log[0]).toMatchObject({ cause: "trial", state: "ended", outcome: "done", message: answer, permission: "只读" });
    // 运行记录的一行：简报去掉 Markdown 记号，链接只留文字
    expect(log[0].line).toBe("本会发送：“新能源汽车早报 1. 甲车企发布新车 来源 2. 乙电池厂扩产 来源”");
    expect(writes[0].system).toBe(RULE_BRIEF_SYSTEM);
    expect(store.listOutbox({ limit: 50 })).toHaveLength(0);
    expect(store.listMessages(WEB, 50).some((m) => m.content.includes("甲车企"))).toBe(false);
    expect(svc.getRuleView(r.rule!.id)).toMatchObject({ mode: "off", needsAttention: false });
    // 关着：到点不跑
    now = at("2026-11-16T08:30");
    svc.fireDue(now);
    expect(svc.ruleLog(r.rule!.id)).toHaveLength(1);
    // 再按当前设置打开：改那一条，不另建
    const on = await save({ ruleId: r.rule!.id, params: { field: "新能源汽车", count: "3" } });
    expect(on.rule!.id).toBe(r.rule!.id);
    expect(on.rule).toMatchObject({ mode: "act", title: "行业早报 · 新能源汽车" });
    expect(on.rule!.instruction).toContain("最值得关注的 3 条动态");
    expect(store.listRules({ botId: "b" })).toHaveLength(1);
  });
  it("试跑失败不算连续失败、不暂停；能停；提醒不用试；暂停了后台工作不试", async () => {
    const r = await save({ on: false });
    for (let i = 0; i < 3; i++) {
      expect(svc.trialRule(r.rule!.id).error).toBeUndefined();
      await flush();
      await turn((sid) => void svc.report({ sessionId: sid, state: "failed", summary: "联网搜索暂时不可用", message: "联网搜索暂时不可用" }));
    }
    expect(store.getRule(r.rule!.id)).toMatchObject({ failures: 0, pausedReason: "" });
    svc.trialRule(r.rule!.id);
    await flush();
    expect(svc.stopTrial(r.rule!.id)).toBe(true);
    expect(svc.ruleLog(r.rule!.id)[0]).toMatchObject({ cause: "trial", outcome: "stopped" });
    const remind = await save({ taskId: "study-checkin", params: {}, on: false });
    expect(svc.trialRule(remind.rule!.id).error).toBe("提醒不用试跑。");
    svc.setPaused("b", true, "test");
    expect(withLang("zh-CN", () => svc.trialRule(r.rule!.id).error)).toBeTruthy();
  });
  it("简报到点：保留多行发出；微信里超过单条长度截断并写完整内容在桌面端；一句话的规则照旧压成一句", async () => {
    const r = await save({ conversationId: WX });
    now = at("2026-11-16T08:30");
    svc.fireDue(now);
    await flush();
    const long = Array.from({ length: 120 }, (_, i) => `${i + 1}. 第 ${i + 1} 条动态，写得很长很长很长很长 [来源](https://example.com/${i})`).join("\n");
    answer = long;
    await turn((sid) => void svc.report({ sessionId: sid, state: "done", summary: "s", message: "1. 甲\n2. 乙" }));
    await flush();
    const run = svc.ruleLog(r.rule!.id)[0];
    expect(run.message.length).toBeLessThanOrEqual(1500);
    expect(run.message).toContain("\n");
    const push = store.listOutbox({ limit: 10 }).find((x) => x.id.startsWith(`rule:${r.rule!.id}`));
    expect(push).toBeDefined();
    // 1500 字的简报没超过微信的 4000：不截断
    expect(JSON.stringify(push!.body)).not.toContain("完整内容在桌面端");
    expect(JSON.stringify(push!.body)).toContain("\\n2. ");
    // 一句话：主模型照旧写一句
    const line = await save({ taskId: "weather", params: { city: "上海浦东" } });
    now = at("2026-11-17T07:30");
    svc.fireDue(now);
    await flush();
    answer = "今天多云，\n12–19°C。";
    await turn((sid) => void svc.report({ sessionId: sid, state: "done", summary: "s", message: "多云\n12–19°C" }));
    await flush();
    expect(writes.at(-1)!.system).toBe(RULE_RESULT_SYSTEM);
    expect(svc.ruleLog(line.rule!.id)[0].message).toBe("今天多云， 12–19°C。");
  });
  it("用模板新建：标了替换的任务改模板自带的那条（开着、发到桌面、有来源），机器人只有一条", async () => {
    store.createBot({ id: "t", name: "周报助手", templateId: "work-report", templateVersion: 1 });
    const tpl = svc.createRule({ botId: "t", conversationId: "", kind: "remind", title: "周五写周报", instruction: "该写周报了", message: "该写周报了", schedule: { kind: "weekly", time: "16:30", days: [5], tz: TZ }, mode: "off", allowEmptyDestination: true });
    const r = await save({ taskId: "weekly-report-reminder", params: {}, botId: "t", templateRule: true });
    expect(r.rule!.id).toBe(tpl.rule!.id);
    expect(store.listRules({ botId: "t" })).toHaveLength(1);
    expect(store.getRule(tpl.rule!.id)).toMatchObject({ mode: "act", conversationId: "t:web:console", source: { id: "weekly-report-reminder" }, message: "该写周报了，把这周做的事发给我，我帮你整理。" });
    // 不是这个模板建的机器人、或任务没标替换：照常另建
    expect((await save({ taskId: "study-checkin", params: {}, botId: "t", templateRule: true })).rule!.id).not.toBe(tpl.rule!.id);
  });
  it("对话里：列出任务库；按任务建规则（来源、规则卡）；缺参数、缺应用说清楚；改默认时间", async () => {
    store.setAgentSession(WX, "b", "chat-1");
    const list = await withLang("zh-CN", () => svc.chatTool({ botId: "b", sessionId: "chat-1", op: "routine", args: {} }));
    expect(list.text).toContain("industry-brief 「行业早报」");
    expect(list.text).not.toContain("repo-activity-web");
    // 只有要问用户的才带 *：有默认的、预填了提醒话的不用问
    expect(list.text).toContain("field* (关注领域)");
    expect(list.text).toContain("count (条数: 3/5/8; default 5)");
    expect(list.text).toContain("message (提醒的话; has default text)");
    const miss = await withLang("zh-CN", () => svc.chatTool({ botId: "b", sessionId: "chat-1", op: "routine", args: { task: "出门天气提醒" } }));
    expect(miss.error).toMatch(/city \(城市, e\.g\. 上海浦东\): required/);
    const ok = await withLang("zh-CN", () => svc.chatTool({ botId: "b", sessionId: "chat-1", op: "routine", args: { task: "weather", fields: JSON.stringify({ city: "上海" }) } }));
    expect(ok.error).toBeUndefined();
    const rule = store.listRules({ botId: "b" }).at(-1)!;
    expect(rule).toMatchObject({ title: "出门天气提醒 · 上海", conversationId: WX, mode: "act", source: { id: "weather" } });
    expect(rule.trigger).toMatchObject({ schedule: { kind: "daily", time: "07:30" } });
    expect(svc.ruleActions(WX).at(-1)).toMatchObject({ ruleId: rule.id, kind: "create" });
    const app = await withLang("zh-CN", () => svc.chatTool({ botId: "b", sessionId: "chat-1", op: "routine", args: { task: "repo-activity", fields: '{"repos":"acme/app"}' } }));
    expect(app.error).toMatch(/needs GitHub connected first.*repo-activity-web/);
    const nine = await withLang("zh-CN", () => svc.chatTool({ botId: "b", sessionId: "chat-1", op: "routine", args: { task: "industry-brief", fields: '{"field":"AI"}', schedule: "weekdays 09:00" } }));
    expect(nine.error).toBeUndefined();
    expect(store.listRules({ botId: "b" }).at(-1)!.trigger).toMatchObject({ schedule: { kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] } });
  });
});
