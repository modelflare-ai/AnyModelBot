/**
 * 规则（3d）的零件：时间表（解析、给人看的话、下一次 / 上一次、夏令时、宽限期、cron）、宿主的定时器、事件的过滤条件、数据目录锁，
 * 以及 TaskService 对着一个假宿主和一个假时钟：从观察开始、观察只记「本会发送」、3 次好的观察后提示改为执行、执行时经出站队列发一句、
 * 改了原话先观察 1 次再回到执行、连续失败 3 次自动暂停（执行的推一句，观察的只在「需要你」里）、错过的按宽限期补跑一次或记为跳过、
 * 等名额超过宽限期跳过、固定提醒不进模型、重启后宽限期内重跑一次、运行记录、事件触发、时间上限、观察时的审批自动拒绝、
 * 检查用小模型而那一句用主模型写、微信配额预留和续期提醒、/tasks 列出并关掉规则。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describe as describeSchedule, graceOf, latestRun, localTime, nextRun, normalizeSchedule, parseSchedule, type Schedule } from "../src/tasks/schedule.js";
import { Scheduler } from "../src/tasks/scheduler.js";
import { RuleEvents, matchesFilter } from "../src/tasks/rule-events.js";
import { RULE_DENY, runLine } from "../src/tasks/rules.js";
import { TaskService, type TaskHost, type TaskNotification } from "../src/tasks/service.js";
import { setLangPref, t as tServer, withLang } from "../src/i18n/index.js";
import { ApprovalCenter } from "../src/agent/approvals.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import { RULE_NUDGE, RULE_RERUN, RULE_RESULT_SYSTEM, ruleRules } from "../src/agent/prompts/index.js";
import { Outbox } from "../src/core/outbox.js";
import { Delivery } from "../src/core/delivery.js";
import { Store, type RunRow } from "../src/store/db.js";
import { DataDirLocked, LOCK_FILE, lockDataDir } from "../src/store/lock.js";

const TZ = "Asia/Shanghai";
const NY = "America/New_York";
/** 上海时间 "2026-11-06T08:00" → 时间戳 */
const at = (s: string) => Date.parse(`${s}${s.length === 16 ? ":00" : ""}+08:00`);
const MIN = 60_000;
const H = 3600_000;
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

describe("时间表：解析、给人看的话", () => {
  const now = at("2026-11-02T10:00");
  const p = (t: string) => parseSchedule(t, TZ, now);
  it("聊天代理给的一行", () => {
    expect(p("daily 08:00").schedule).toEqual({ kind: "daily", time: "08:00", tz: TZ });
    expect(p("weekdays 8:00").schedule).toEqual({ kind: "daily", time: "08:00", days: [1, 2, 3, 4, 5], tz: TZ });
    expect(p("weekly mon,thu 09:30").schedule).toEqual({ kind: "weekly", time: "09:30", days: [1, 4], tz: TZ });
    expect(p("weekly 周一、周日 09:30").schedule).toMatchObject({ days: [0, 1] });
    expect(p("every 30m").schedule).toEqual({ kind: "every", minutes: 30, from: now + MIN, tz: TZ });
    expect(p("every 2 hours").schedule).toMatchObject({ kind: "every", minutes: 120 });
    expect(p("once 2026-11-03 15:00").schedule).toEqual({ kind: "once", at: at("2026-11-03T15:00"), tz: TZ });
    expect(p("cron 0 8 * * 1-5").schedule).toEqual({ kind: "cron", cron: "0 8 * * 1-5", tz: TZ });
  });
  it("说不清的给出能照着改的错误", () => {
    expect(p("every 10m").error).toMatch(/at least 15 minutes/);
    expect(p("once 2026-11-01 15:00").error).toMatch(/already passed/);
    expect(p("cron 0 8 * *").error).toMatch(/5 fields/);
    expect(p("每天早上").error).toMatch(/Use one of: once YYYY-MM-DD HH:MM \| daily HH:MM/);
    expect(p("daily 25:00").error).toBeDefined();
    expect(normalizeSchedule({ kind: "weekly", time: "08:00", days: [] }, TZ, now).error).toBe("选一天或几天");
  });
  it("给用户看：每天 08:00、每个工作日、每周一、周四、每 30 分钟、日期", () => {
    const d = (t: string, z = false) => describeSchedule(p(t).schedule!, z);
    expect(d("daily 08:00")).toBe("每天 08:00");
    expect(d("weekdays 08:00", true)).toBe("每个工作日 08:00（Asia/Shanghai）");
    expect(d("weekly sun,thu,mon 09:00")).toBe("每周一、周四、周日 09:00");
    expect(d("every 30m")).toBe("每 30 分钟");
    expect(d("every 2h")).toBe("每 2 小时");
    expect(d("once 2026-11-03 15:00")).toBe("11月3日 15:00");
    expect(d("cron 0 8 * * 1-5")).toBe("cron 0 8 * * 1-5");
  });
});

describe("时间表：下一次、上一次、宽限期", () => {
  const daily = (time: string, tz = TZ, days?: number[]): Schedule => ({ kind: "daily", time, tz, ...(days ? { days } : {}) });
  it("每天 08:00：今天还没到就是今天，过了就是明天（不含当时）", () => {
    expect(nextRun(daily("08:00"), at("2026-11-02T07:59"))).toBe(at("2026-11-02T08:00"));
    expect(nextRun(daily("08:00"), at("2026-11-02T08:00"))).toBe(at("2026-11-03T08:00"));
    expect(latestRun(daily("08:00"), at("2026-11-02T07:59"))).toBe(at("2026-11-01T08:00"));
    expect(latestRun(daily("08:00"), at("2026-11-02T08:00"))).toBe(at("2026-11-02T08:00"));
    expect(latestRun(daily("08:00"), at("2026-11-02T07:59"), at("2026-11-02T00:00"))).toBeUndefined();
  });
  it("工作日：周五晚上之后是周一", () => {
    // 2026-11-06 是周五
    expect(nextRun(daily("08:00", TZ, [1, 2, 3, 4, 5]), at("2026-11-06T09:00"))).toBe(at("2026-11-09T08:00"));
    expect(nextRun({ kind: "weekly", time: "09:00", days: [4], tz: TZ }, at("2026-11-06T09:00"))).toBe(at("2026-11-12T09:00"));
  });
  it("夏令时（纽约）：跳过的那一小时里的时刻顺延，重复的那一小时取第一次，钟面时间不变", () => {
    // 3 月 8 日凌晨 2:00 → 3:00：02:30 不存在，顺延到 03:30（EDT）
    expect(localTime(2026, 3, 8, 150, NY)).toBe(Date.parse("2026-03-08T03:30:00-04:00"));
    expect(nextRun(daily("02:30", NY), Date.parse("2026-03-07T12:00:00-05:00"))).toBe(Date.parse("2026-03-08T03:30:00-04:00"));
    expect(nextRun(daily("02:30", NY), Date.parse("2026-03-08T04:00:00-04:00"))).toBe(Date.parse("2026-03-09T02:30:00-04:00"));
    // 11 月 1 日凌晨 2:00 → 1:00：01:30 有两次，取第一次（EDT），第二天照常
    expect(nextRun(daily("01:30", NY), Date.parse("2026-10-31T12:00:00-04:00"))).toBe(Date.parse("2026-11-01T01:30:00-04:00"));
    expect(nextRun(daily("01:30", NY), Date.parse("2026-11-01T01:30:00-04:00"))).toBe(Date.parse("2026-11-02T01:30:00-05:00"));
    // 早上 8 点在切换前后都是 8 点（中间差 25 小时）
    const a = nextRun(daily("08:00", NY), Date.parse("2026-10-31T09:00:00-04:00"))!;
    expect(a).toBe(Date.parse("2026-11-01T08:00:00-05:00"));
    expect(a - Date.parse("2026-10-31T08:00:00-04:00")).toBe(25 * H);
    // every 按绝对时间：切换那晚照样每 60 分钟一次
    const every: Schedule = { kind: "every", minutes: 60, from: Date.parse("2026-11-01T00:00:00-04:00"), tz: NY };
    expect(nextRun(every, Date.parse("2026-11-01T01:30:00-04:00"))! - Date.parse("2026-11-01T01:30:00-04:00")).toBe(30 * MIN);
  });
  it("every：从起点一格一格往后排；上一次是起点之后最近的一格", () => {
    const s: Schedule = { kind: "every", minutes: 15, from: at("2026-11-02T10:00"), tz: TZ };
    expect(nextRun(s, at("2026-11-02T09:00"))).toBe(at("2026-11-02T10:00"));
    expect(nextRun(s, at("2026-11-02T10:00"))).toBe(at("2026-11-02T10:15"));
    expect(nextRun(s, at("2026-11-02T10:16"))).toBe(at("2026-11-02T10:30"));
    expect(latestRun(s, at("2026-11-02T11:07"))).toBe(at("2026-11-02T11:00"));
    expect(latestRun(s, at("2026-11-02T09:59"))).toBeUndefined();
  });
  it("cron：工作日 8 点；日和星期都限定时满足一个就行；每 10 分钟", () => {
    expect(nextRun({ kind: "cron", cron: "0 8 * * 1-5", tz: TZ }, at("2026-11-06T09:00"))).toBe(at("2026-11-09T08:00"));
    // 每月 1 号或者周一
    const c: Schedule = { kind: "cron", cron: "30 9 1 * 1", tz: TZ };
    expect(nextRun(c, at("2026-11-02T10:00"))).toBe(at("2026-11-09T09:30"));
    expect(nextRun(c, at("2026-11-30T10:00"))).toBe(at("2026-12-01T09:30"));
    expect(nextRun({ kind: "cron", cron: "*/10 * * * *", tz: TZ }, at("2026-11-02T10:03"))).toBe(at("2026-11-02T10:10"));
    expect(latestRun({ kind: "cron", cron: "0 8 * * 1-5", tz: TZ }, at("2026-11-08T12:00"))).toBe(at("2026-11-06T08:00"));
  });
  it("once：到点之前有，之后没有", () => {
    const s: Schedule = { kind: "once", at: at("2026-11-03T15:00"), tz: TZ };
    expect(nextRun(s, at("2026-11-03T14:00"))).toBe(s.at);
    expect(nextRun(s, s.at)).toBeUndefined();
    expect(latestRun(s, at("2026-11-03T16:00"))).toBe(s.at);
  });
  it("宽限期：间隔的一半和 2 小时取小的", () => {
    const ref = at("2026-11-02T10:00");
    expect(graceOf(daily("08:00"), ref)).toBe(2 * H);
    expect(graceOf({ kind: "every", minutes: 15, from: ref, tz: TZ }, ref)).toBe(7.5 * MIN);
    expect(graceOf({ kind: "every", minutes: 60, from: ref, tz: TZ }, ref)).toBe(30 * MIN);
    expect(graceOf({ kind: "cron", cron: "*/10 * * * *", tz: TZ }, ref)).toBe(5 * MIN);
    expect(graceOf({ kind: "once", at: ref, tz: TZ }, ref)).toBe(2 * H);
  });
});

describe("界面：规则的一行（健康时只有状态和下次）", () => {
  it("第二行：观察中 · 下次 明天 08:00；正在运行；暂停了说连续失败几次；关了、跑完了只有状态；运行记录的时间", async () => {
    (globalThis as any).window ??= { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    // @ts-expect-error 界面代码是不经构建的 JS
    const { ruleSub, fmtRunAt, fmtNext } = await import("../ui/components/rules.js");
    // @ts-expect-error 同上
    const ui = await import("../ui/lib/i18n.js");
    ui.setLangPref("zh-CN");
    const now = new Date(2026, 10, 2, 7, 30).getTime();
    const t = (d: number, h: number, m = 0) => new Date(2026, 10, 2 + d, h, m).getTime();
    const r = (o: any) => ({ failures: 0, nextRunAt: t(1, 8), state: { key: "observe", label: "观察中" }, ...o });
    expect(ruleSub(r({}), now)).toBe("观察中 · 下次 明天 08:00");
    expect(ruleSub(r({ state: { key: "act", label: "执行中" }, nextRunAt: t(0, 15) }), now)).toBe("执行中 · 下次 今天 15:00");
    expect(ruleSub(r({ live: { state: "running" } }), now)).toBe("观察中 · 正在运行");
    expect(ruleSub(r({ state: { key: "paused", label: "已暂停" }, failures: 3, nextRunAt: 0 }), now)).toBe("已暂停 · 连续失败 3 次");
    expect(ruleSub(r({ state: { key: "off", label: "已关闭" } }), now)).toBe("已关闭");
    expect(ruleSub(r({ state: { key: "done", label: "已结束" }, nextRunAt: 0 }), now)).toBe("已结束");
    expect([fmtRunAt(t(0, 8), now), fmtRunAt(t(-1, 8), now), fmtRunAt(t(-6, 8), now)]).toEqual(["今天 08:00", "昨天 08:00", "10/27 08:00"]);
    // 2026-11-02 是周一
    expect([fmtNext(t(3, 9), now), fmtNext(t(10, 9), now)]).toEqual(["周四 09:00", "11/12 09:00"]);
    // 英文：状态文字是服务端按界面语言给的，这里只换了界面自己的那部分
    ui.setLangPref("en");
    expect(ruleSub(r({ state: { key: "observe", label: "Observing" } }), now)).toBe("Observing · Next: Tomorrow 08:00");
    expect(ruleSub(r({ state: { key: "paused", label: "Paused" }, failures: 3, nextRunAt: 0 }), now)).toBe("Paused · failed 3 times in a row");
    expect([fmtRunAt(t(-1, 8), now), fmtNext(t(3, 9), now)]).toEqual(["Yesterday 08:00", "Thu 09:00"]);
    ui.setLangPref("zh-CN");
  });
});

describe("宿主的定时器", () => {
  it("开始时先看一遍，按最早的那个设定时器（最长睡 5 分钟）；wake 马上再看", () => {
    let now = 1_000_000;
    let next = now + 30 * MIN;
    const fired: number[] = [];
    const s = new Scheduler({ next: () => next, fire: (t) => fired.push(t), now: () => now });
    s.start();
    expect(fired).toEqual([now]);
    expect(s.wakeAt).toBe(now + 5 * MIN);
    next = now + 2 * MIN;
    now += MIN;
    s.wake();
    expect(fired).toHaveLength(2);
    expect(s.wakeAt).toBe(now + MIN);
    s.stop();
    s.wake();
    expect(fired).toHaveLength(2);
  });
});

describe("事件的过滤条件", () => {
  it("每个键都要相等（数组是其中之一，路径用点）；没有条件都算", () => {
    expect(matchesFilter(undefined, { a: 1 })).toBe(true);
    expect(matchesFilter({ repo: "a/b" }, { repo: "a/b", n: 1 })).toBe(true);
    expect(matchesFilter({ repo: "a/b" }, { repo: "a/c" })).toBe(false);
    expect(matchesFilter({ action: ["opened", "reopened"] }, { action: "reopened" })).toBe(true);
    expect(matchesFilter({ "issue.number": 12 }, { issue: { number: "12" } })).toBe(true);
    expect(matchesFilter({ "issue.number": 12 }, { issue: {} })).toBe(false);
  });
});

describe("数据目录锁", () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-lock-"))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it("另一个活着的进程拿着：拿不到；那个进程不在了：接管；放锁只放自己的", () => {
    const file = path.join(dir, LOCK_FILE);
    // 父进程（vitest 的）活着
    fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, host: os.hostname(), at: Date.now(), token: "x" }));
    expect(() => lockDataDir(dir)).toThrow(DataDirLocked);
    expect(() => lockDataDir(dir)).toThrow(/正被另一个 anymodel bot 进程使用/);
    // 不在了（崩溃、kill -9）
    fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), at: Date.now(), token: "x" }));
    const a = lockDataDir(dir);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(process.pid);
    // 同一进程里又开了一个 App（测试里重启）：接过来；先开的那个放锁时不动后来的
    const b = lockDataDir(dir);
    a.release();
    expect(fs.existsSync(file)).toBe(true);
    b.release();
    expect(fs.existsSync(file)).toBe(false);
  });
  it("另一台机器（两个容器挂同一个卷）：看心跳，3 分钟没碰就接管", () => {
    const file = path.join(dir, LOCK_FILE);
    fs.writeFileSync(file, JSON.stringify({ pid: 1, host: "other-container", at: Date.now(), token: "x" }));
    expect(() => lockDataDir(dir)).toThrow(/other-container 上的 pid 1/);
    const old = new Date(Date.now() - 10 * MIN);
    fs.writeFileSync(file, JSON.stringify({ pid: 1, host: "other-container", at: old.getTime(), token: "x" }));
    fs.utimesSync(file, old, old);
    lockDataDir(dir).release();
  });
  it("同一台机器、进程号还在但心跳停了（断电重启后进程号被别的程序占了）：接管", () => {
    const file = path.join(dir, LOCK_FILE);
    const old = new Date(Date.now() - 10 * MIN);
    // 父进程（vitest 的）活着，但锁文件 10 分钟没碰过
    fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, host: os.hostname(), at: old.getTime(), token: "x" }));
    fs.utimesSync(file, old, old);
    const l = lockDataDir(dir);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(process.pid);
    l.release();
  });
});

/** 假的宿主：记下交给会话的输入和停止；安静与否按队列回答 */
class FakeHost implements TaskHost {
  available = true;
  prompts: Array<{ botId: string; sessionId: string; folder: string; model: string; text: string; resume: boolean; id: string }> = [];
  stops: string[] = [];
  settingsValue = { ...DEFAULT_SETTINGS };
  private n = 0;
  constructor(readonly ws: string) {}
  workspace() {
    return this.ws;
  }
  settings() {
    return this.settingsValue;
  }
  memoryPrefix() {
    return "- 用户关心 X 的价格";
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
  async quiet() {
    return { quiet: true };
  }
}

describe("规则（假宿主、假时钟）", () => {
  let store: Store;
  let host: FakeHost;
  let outbox: Outbox;
  let delivery: Delivery;
  let approvals: ApprovalCenter;
  let svc: TaskService;
  let ws: string;
  let now: number;
  let writes: Array<{ model: string; system: string; user: string }>;
  const CONV = "b:weixin:owner";
  const WEB = "b:web:console";

  const make = (o: { maxBackground?: number; cap?: number } = {}) =>
    new TaskService({
      store,
      host,
      delivery,
      approvals,
      defaultModel: () => "main-model",
      retryDelaysMs: [5, 5, 5],
      maxBackground: o.maxBackground ?? 4,
      now: () => now,
      timeZone: TZ,
      ruleRunCapMs: o.cap,
      complete: async (_botId, model, system, user) => {
        writes.push({ model, system, user });
        return "「X 降价了：现在 ¥199（昨天 ¥259）。」";
      },
    });
  beforeEach(() => {
    now = at("2026-11-02T07:00");
    writes = [];
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-rules-unit-"));
    store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝", weixinEnabled: true });
    store.ensureConversation("b", "weixin", "owner", "owner");
    store.ensureConversation("b", "web", "console", "console");
    host = new FakeHost(ws);
    host.settingsValue = { ...DEFAULT_SETTINGS, utilityModel: "small-model" };
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

  const ev = (sessionId: string, type: string, data: any = {}): TaskNotification => ({ method: "session.event", params: { sessionId, event: { type, data, time: now } } });
  const status = (sessionId: string, s: "running" | "idle"): TaskNotification => ({ method: "session.status", params: { sessionId, status: s } });
  /** 最近一次交给规则会话的输入跑一轮；during 里报告 */
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
  const report = (state: string, message = "", extra: Record<string, unknown> = {}) => (sid: string) => void expect(svc.report({ sessionId: sid, state, summary: "X 现在 ¥199", message, ...extra }).error).toBeUndefined();
  /** 拨钟，到点的开 run */
  const go = async (t: number) => {
    now = t;
    svc.fireDue(now);
    await flush();
  };
  const create = async (schedule = "daily 08:00", extra: Record<string, unknown> = {}) => {
    const r = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "看 X 价格", instruction: "每天早上 8 点看看 X 的价格，低于 200 告诉我", schedule, ...extra } });
    expect(r.error).toBeUndefined();
    return { text: r.text!, rule: store.listRules({ botId: "b" }).at(-1)! };
  };
  const runsOf = (ruleId: string) => store.ruleRuns(ruleId, { limit: 100 }).reverse();
  const pushes = () => store.listOutbox({ limit: 100 }).filter((r) => r.id.startsWith("rule:"));
  /** 跑一天：到 08:00 开 run，跑一轮，报告 */
  const day = async (date: string, during: (sid: string) => void) => {
    await go(at(`${date}T08:00`));
    await turn(during);
  };

  beforeEach(() => store.setAgentSession(CONV, "b", "chat-1"));

  it("rule_create：从观察开始，用户原话原样存，自己的文件夹；回复里有设计里那句话，微信加上 24 小时那句", async () => {
    const { text, rule } = await create();
    expect(rule).toMatchObject({ kind: "check", mode: "observe", version: 1, conversationId: CONV, instruction: "每天早上 8 点看看 X 的价格，低于 200 告诉我", anytime: false });
    expect(rule.id).toMatch(/^rl_[0-9a-f]{12}$/);
    expect(rule.folder).toBe(`rules/x-${rule.id.slice(3, 9)}`);
    expect(rule.trigger).toEqual({ kind: "schedule", schedule: { kind: "daily", time: "08:00", tz: TZ } });
    expect(rule.nextRunAt).toBe(at("2026-11-02T08:00"));
    expect(text).toContain("「已建好规则：每天 08:00 看 X 价格。先观察几天，只记录不打扰你；在「任务」里可以改成执行。」");
    expect(text).toContain(tServer("rules.weixinNote"));
    expect(svc.getRuleView(rule.id)).toMatchObject({ when: "每天 08:00", state: { key: "observe", label: "观察中", dot: "" }, hint: false });
    // 时间表说不清：照着错误改
    const bad = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "t", instruction: "i", schedule: "每天" } });
    expect(bad.error).toMatch(/Use one of/);
  });

  it("退出演示的单元版：观察 3 天（只记「本会发送」，什么都不推），提示改为执行；改了之后命中时推一句（主模型写的）", async () => {
    const { rule } = await create();
    // 第 1 天：到点开一个新会话，第一条输入是规则、原话、这次是观察；检查用小模型
    await go(at("2026-11-02T08:00"));
    const p1 = host.prompts.at(-1)!;
    expect(p1.sessionId).toMatch(new RegExp(`^rule-${rule.id}-[0-9a-f]{12}$`));
    expect(p1).toMatchObject({ resume: false, model: "small-model", folder: path.join(ws, rule.folder) });
    expect(p1.text).toContain("[规则]\n看 X 价格（每天 08:00）");
    expect(p1.text).toContain("[用户的原话]\n每天早上 8 点看看 X 的价格，低于 200 告诉我");
    expect(p1.text).toContain("[这次]\n观察：只看不动，message 只记下来，不会发给用户。");
    expect(p1.text).toContain("- 用户关心 X 的价格");
    // 插件取配置：观察只读、去掉能改变什么的工具、规则段
    expect(svc.sessionConfig({ sessionId: p1.sessionId })).toEqual({ kind: "rule", mode: "observe", deny: RULE_DENY.observe, denyPrefix: ["mcp__computer-use__"], section: ruleRules("observe"), permission: "read-only" });
    expect(RULE_DENY.observe).toEqual(expect.arrayContaining(["remember", "forget", "generate_image", "present", "rule_create"]));
    await turn((sid) => void expect(svc.report({ sessionId: sid, state: "done", summary: "X 现在 ¥259，高于 200", message: "" }).text).toMatch(/hears nothing/));
    // 第 2 天：上一次的结果带进来（连续性靠它）
    await go(at("2026-11-03T08:00"));
    expect(host.prompts.at(-1)!.text).toContain("[最近几次的结果]\n- 11月2日 08:00：没有告诉用户。X 现在 ¥259，高于 200");
    await turn((sid) => void expect(svc.report({ sessionId: sid, state: "done", summary: "X 现在 ¥199", message: "X 降到 199 了" }).text).toMatch(/observe mode: nothing is sent/));
    // 第 3 天
    await day("2026-11-04", report("done", "", { would: "在 X 的页面上点「降价提醒」" }));
    // 观察什么都不推；只记下来
    expect(pushes()).toEqual([]);
    expect(store.listMessages(CONV)).toEqual([]);
    const log = svc.ruleLog(rule.id);
    expect(log.map((r) => [r.mode, r.outcome, r.line])).toEqual([
      ["observe", "done", "本会做：在 X 的页面上点「降价提醒」"],
      // 那一句用主模型写（检查用的是小模型）
      ["observe", "done", "本会发送：“X 降价了：现在 ¥199（昨天 ¥259）。”"],
      ["observe", "done", "本会保持安静：X 现在 ¥259，高于 200"],
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ model: "main-model", system: RULE_RESULT_SYSTEM });
    expect(writes[0].user).toContain("[草稿]\nX 降到 199 了");
    expect(log[0]).toMatchObject({ version: 1, permission: "只读", cause: "schedule", at: at("2026-11-04T08:00") });
    // 3 次好的观察：提示改为执行（不推）
    expect(svc.getRuleView(rule.id)).toMatchObject({ hint: true, observed: 3, state: { key: "observe" } });
    // 改为执行：下一次带着「执行」，权限是可写工作区，命中时推一句（id 固定）
    svc.updateRule(rule.id, { mode: "act" });
    expect(svc.getRuleView(rule.id)).toMatchObject({ hint: false, state: { key: "act", label: "执行中", dot: "ok" } });
    await go(at("2026-11-05T08:00"));
    expect(host.prompts.at(-1)!.text).toContain("[这次]\n执行：message 会发给用户。");
    expect(svc.sessionConfig({ sessionId: host.prompts.at(-1)!.sessionId })).toMatchObject({ mode: "act", permission: "workspace-write", deny: RULE_DENY.act });
    await turn(report("done", "X 降到 199 了"));
    const run = runsOf(rule.id).at(-1)!;
    expect(pushes().map((r) => [r.id, r.purpose, r.subject, r.body.text, r.ref])).toEqual([[`rule:${rule.id}:${run.id}`, "rule", "看 X 价格", "X 降价了：现在 ¥199（昨天 ¥259）。", `rule:${rule.id}`]]);
    expect(store.listMessages(CONV).at(-1)!.content).toBe("X 降价了：现在 ¥199（昨天 ¥259）。");
    expect(svc.ruleLog(rule.id)[0]).toMatchObject({ mode: "act", permission: "可写工作区", line: "待发送：“X 降价了：现在 ¥199（昨天 ¥259）。”" });
    // 没命中：保持安静，不推
    await day("2026-11-06", report("done"));
    expect(pushes()).toHaveLength(1);
    expect(svc.ruleLog(rule.id)[0].line).toBe("保持安静：X 现在 ¥199");
  });

  it("完全权限的机器人：执行时最多可写工作区；只读的机器人：执行也只读", async () => {
    const { rule } = await create();
    svc.updateRule(rule.id, { mode: "act" });
    host.settingsValue = { ...host.settingsValue, permission: "full" };
    await go(at("2026-11-02T08:00"));
    expect(svc.sessionConfig({ sessionId: host.prompts.at(-1)!.sessionId }).permission).toBe("workspace-write");
    await turn(report("done"));
    host.settingsValue = { ...host.settingsValue, permission: "readonly" };
    await go(at("2026-11-03T08:00"));
    expect(svc.sessionConfig({ sessionId: host.prompts.at(-1)!.sessionId }).permission).toBe("read-only");
    expect(svc.sessionConfig({ sessionId: "task-x" }).error).toBeDefined();
  });

  it("改原话：版本加 1，执行中的先观察 1 次再回到执行；只改时间表不动模式；正在跑的照原来的版本跑完", async () => {
    const { rule } = await create();
    svc.updateRule(rule.id, { mode: "act" });
    await go(at("2026-11-02T08:00"));
    // 跑的时候改了原话
    svc.updateRule(rule.id, { instruction: "每天早上看看 X 的价格，低于 180 告诉我" });
    expect(store.getRule(rule.id)).toMatchObject({ version: 2, observeLeft: 1, mode: "act" });
    expect(svc.getRuleView(rule.id)!.state.key).toBe("observe");
    await turn(report("done", "X 降到 199 了"));
    // 那一次是第 1 版、执行的：照样发
    expect(runsOf(rule.id).at(-1)).toMatchObject({ ruleVersion: 1, mode: "act" });
    await flush();
    expect(pushes()).toHaveLength(1);
    expect(store.getRule(rule.id)!.observeLeft).toBe(1);
    // 下一次：第 2 版、观察
    await go(at("2026-11-03T08:00"));
    expect(host.prompts.at(-1)!.text).toContain("低于 180");
    expect(host.prompts.at(-1)!.text).toContain("[这次]\n观察");
    await turn(report("done", "X 降到 170 了"));
    await flush();
    expect(pushes()).toHaveLength(1);
    expect(store.getRule(rule.id)).toMatchObject({ observeLeft: 0, mode: "act" });
    expect(svc.ruleLog(rule.id)[0]).toMatchObject({ mode: "observe", version: 2 });
    // 再下一次：回到执行
    await go(at("2026-11-04T08:00"));
    expect(host.prompts.at(-1)!.text).toContain("[这次]\n执行");
    await turn(report("done"));
    // 只改时间表：模式不变，下一次按新时间
    svc.updateRule(rule.id, { schedule: parseSchedule("daily 09:30", TZ, now).schedule! });
    expect(store.getRule(rule.id)).toMatchObject({ mode: "act", observeLeft: 0, version: 2, nextRunAt: at("2026-11-04T09:30") });
  });

  it("连续失败 3 次自动暂停：执行中的推一句 ⚠️，「需要你」里一行（2 次时就有黄的）；成功一次清零；重试重新开并马上跑", async () => {
    const { rule } = await create();
    svc.updateRule(rule.id, { mode: "act" });
    await day("2026-11-02", report("failed", "X 的页面打不开"));
    expect(store.getRule(rule.id)!.failures).toBe(1);
    expect(svc.ruleAttention()).toEqual([]);
    await day("2026-11-03", report("done"));
    expect(store.getRule(rule.id)!.failures).toBe(0);
    await day("2026-11-04", report("failed", "X 的页面打不开"));
    await day("2026-11-05", report("failed", "X 的页面打不开"));
    expect(svc.ruleAttention().map((a) => [a.kind, a.subject, a.status, a.severity, a.line])).toEqual([["rule", "规则「看 X 价格」", "连续失败 2 次", "warn", "X 的页面打不开"]]);
    expect(pushes()).toEqual([]);
    await day("2026-11-06", report("failed", "X 的页面打不开"));
    expect(store.getRule(rule.id)).toMatchObject({ failures: 3, pausedReason: "failures", nextRunAt: 0 });
    expect(svc.getRuleView(rule.id)!.state).toEqual({ key: "paused", label: "已暂停", dot: "err" });
    const last = runsOf(rule.id).at(-1)!;
    expect(pushes().map((r) => [r.id, r.purpose, r.body.text])).toEqual([[`rule:${rule.id}:paused:${last.id}`, "failure", "⚠️ 规则「看 X 价格」连续失败 3 次，已暂停：X 的页面打不开"]]);
    expect(svc.ruleAttention()[0]).toMatchObject({ status: "连续失败 3 次，已暂停", severity: "err", actions: ["retry"], ruleId: rule.id });
    // 暂停了就不再到点开 run
    const n = host.prompts.length;
    await go(at("2026-11-07T08:00"));
    expect(host.prompts).toHaveLength(n);
    // 重试：重新开、马上跑（人要求的）
    expect(svc.resumeRule(rule.id)).toEqual({});
    await flush();
    expect(host.prompts).toHaveLength(n + 1);
    expect(runsOf(rule.id).at(-1)).toMatchObject({ cause: "manual", mode: "act" });
    expect(store.getRule(rule.id)).toMatchObject({ failures: 0, pausedReason: "", nextRunAt: at("2026-11-08T08:00") });
    expect(svc.ruleAttention()).toEqual([]);
  });

  it("观察中的规则连续失败 3 次也暂停，但什么都不推，只在「需要你」里", async () => {
    const { rule } = await create();
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04"]) await day(d, report("failed", "打不开"));
    expect(store.getRule(rule.id)!.pausedReason).toBe("failures");
    expect(pushes()).toEqual([]);
    expect(svc.ruleAttention()).toHaveLength(1);
  });

  it("错过的：宽限期（2 小时）内启动补跑一次（算那个时间的），更早的记一条「跳过：电脑没开」，从不补一串", async () => {
    const { rule } = await create();
    svc.stop();
    // 应用 08:00 没开，09:30 开：补跑一次
    now = at("2026-11-02T09:30");
    svc = make();
    svc.start();
    await flush();
    expect(runsOf(rule.id).map((r) => [r.cause, r.queuedAt, r.state])).toEqual([["schedule", at("2026-11-02T08:00"), "running"]]);
    await turn(report("done"));
    expect(store.getRule(rule.id)!.nextRunAt).toBe(at("2026-11-03T08:00"));
    // 关了两天，11:00 开：错过的都太久了，只记一条跳过，不跑
    svc.stop();
    now = at("2026-11-05T11:00");
    svc = make();
    svc.start();
    await flush();
    expect(runsOf(rule.id).slice(1).map((r) => [r.outcome, r.error, r.queuedAt])).toEqual([["skipped", "app_off", at("2026-11-03T08:00")]]);
    expect(svc.ruleLog(rule.id)[0].line).toBe("跳过：电脑没开");
    expect(store.getRule(rule.id)!.nextRunAt).toBe(at("2026-11-06T08:00"));
    // 每 15 分钟的：关了一小时，最近的那格在 7.5 分钟内 → 跳过一条、跑一次
    const every = (await create("every 15m")).rule;
    expect(every.nextRunAt).toBe(at("2026-11-05T11:01"));
    svc.stop();
    now = at("2026-11-05T12:20");
    svc = make();
    svc.start();
    await flush();
    expect(runsOf(every.id).map((r) => [r.outcome || r.state, r.queuedAt])).toEqual([
      ["skipped", at("2026-11-05T11:01")],
      ["running", at("2026-11-05T12:16")],
    ]);
    expect(store.getRule(every.id)!.nextRunAt).toBe(at("2026-11-05T12:31"));
  });

  it("名额一直被占着：等过了宽限期就跳过（「一直在忙」）；上一次还没跑完，这次跳过", async () => {
    svc.stop();
    svc = make({ maxBackground: 0 });
    svc.start();
    const { rule } = await create();
    await go(at("2026-11-02T08:00"));
    expect(runsOf(rule.id).map((r) => r.state)).toEqual(["queued"]);
    now = at("2026-11-02T10:01");
    svc.pump();
    expect(runsOf(rule.id).map((r) => [r.outcome, r.error])).toEqual([["skipped", "busy"]]);
    expect(svc.ruleLog(rule.id)[0].line).toBe("跳过：一直在忙");
    svc.stop();
    svc = make();
    svc.start();
    await go(at("2026-11-03T08:00"));
    // 跑了一整天还没完（没有时间上限的假设）：第二天到点时跳过
    await go(at("2026-11-04T08:00"));
    expect(runsOf(rule.id).map((r) => [r.state, r.outcome, r.error]).slice(1)).toEqual([
      ["running", "", ""],
      ["ended", "skipped", "overlap"],
    ]);
  });

  it("固定提醒：直接执行，到点只发那句话（不进模型、不占名额、不受免打扰限制），一次性的跑完就结束", async () => {
    const r = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "开会", instruction: "明天下午 3 点提醒我开会", schedule: "once 2026-11-03 15:00", kind: "remind", message: "该去开会了。" } });
    expect(r.text).toContain("Created reminder");
    expect(r.text).toContain("「好，11月3日 15:00 提醒你。」");
    const rule = store.listRules({ botId: "b" })[0];
    expect(rule).toMatchObject({ kind: "remind", mode: "act", anytime: true, message: "该去开会了。" });
    expect(svc.getRuleView(rule.id)!.state).toMatchObject({ key: "remind", label: "提醒" });
    await go(at("2026-11-03T15:00"));
    expect(host.prompts).toEqual([]);
    const [run] = runsOf(rule.id);
    expect(run).toMatchObject({ state: "ended", outcome: "done", mode: "act" });
    expect(pushes().map((x) => [x.id, x.purpose, x.body.text, x.body.anytime])).toEqual([[`rule:${rule.id}:${run.id}`, "reminder", "该去开会了。", true]]);
    expect(svc.ruleLog(rule.id)[0].line).toBe("待发送：“该去开会了。”");
    expect(store.getRule(rule.id)!.nextRunAt).toBe(0);
    expect(svc.getRuleView(rule.id)!.state).toMatchObject({ key: "done", label: "已结束" });
    // 提醒没有观察模式
    expect(svc.updateRule(rule.id, { mode: "observe" }).error).toBe("提醒没有观察模式");
    // 没给那句话
    const bad = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "x", instruction: "x", schedule: "daily 09:00", kind: "remind" } });
    expect(bad.error).toMatch(/needs message/);
  });

  it("重启时被打断：宽限期内用新会话重跑一次（前面加一句说明），重跑的再被打断就跳过；超过宽限期的跳过", async () => {
    const { rule } = await create();
    await go(at("2026-11-02T08:00"));
    const first = host.prompts.at(-1)!;
    svc.stop();
    now = at("2026-11-02T08:10");
    svc = make();
    svc.start();
    await flush();
    const runs = runsOf(rule.id);
    expect(runs.map((r) => [r.cause, r.outcome || r.state])).toEqual([
      ["schedule", "interrupted"],
      ["recover", "running"],
    ]);
    const again = host.prompts.at(-1)!;
    expect(again.sessionId).not.toBe(first.sessionId);
    expect(again.text.startsWith(RULE_RERUN)).toBe(true);
    expect(again.text).toContain(first.text);
    // 重跑的又被打断：不再重跑
    svc.stop();
    svc = make();
    svc.start();
    await flush();
    expect(runsOf(rule.id).map((r) => [r.cause, r.outcome])).toEqual([
      ["schedule", "interrupted"],
      ["recover", "skipped"],
    ]);
    expect(svc.ruleLog(rule.id)[0].line).toBe("跳过：应用重启了");
    // 超过宽限期才重启：跳过
    await go(at("2026-11-03T08:00"));
    svc.stop();
    now = at("2026-11-03T10:30");
    svc = make();
    svc.start();
    await flush();
    expect(runsOf(rule.id).at(-1)).toMatchObject({ cause: "schedule", outcome: "skipped", error: "restart" });
  });

  it("运行记录：新的在前，一次一行，可以往前翻；展开有报告、版本、权限；runLine 的几种说法", async () => {
    const { rule } = await create("every 15m");
    for (let i = 0; i < 4; i++) {
      await go(store.getRule(rule.id)!.nextRunAt);
      await turn(report("done"));
    }
    const all = svc.ruleLog(rule.id);
    expect(all).toHaveLength(4);
    expect(all.map((r) => r.at)).toEqual([...all.map((r) => r.at)].sort((a, b) => b - a));
    const page = svc.ruleLog(rule.id, { before: all[1].at, limit: 10 });
    expect(page.map((r) => r.id)).toEqual(all.slice(2).map((r) => r.id));
    expect(all[0]).toMatchObject({ summary: "X 现在 ¥199", message: "", version: 1, permission: "只读", outcome: "done" });
    const run = (o: Partial<RunRow>): RunRow => ({ id: "r", botId: "b", taskId: "", ruleId: "x", ruleVersion: 1, mode: "act", sessionId: "", cause: "schedule", state: "ended", outcome: "done", report: undefined, would: "", activity: "", tokensIn: 0, tokensOut: 0, costUsd: 0, error: "", delivery: "", permission: "", queuedAt: 0, startedAt: 0, endedAt: 0, ...o });
    expect(runLine(run({ outcome: "failed", error: "timeout" }), "check")).toBe("失败：超时");
    expect(runLine(run({ outcome: "interrupted" }), "check")).toBe("中断：应用重启了");
    expect(runLine(run({ state: "queued" }), "check")).toBe("排队中");
    expect(runLine(run({ state: "running" }), "check")).toBe("正在运行");
    expect(runLine(run({ report: { state: "done", summary: "", message: "hi", at: 0 } }), "check", { status: "sent" } as any)).toBe("已发送：“hi”");
    expect(runLine(run({ report: { state: "done", summary: "", message: "hi", at: 0 } }), "check", { status: "held", attempts: 0 } as any)).toBe("未送达：“hi”");
    expect(runLine(run({ report: { state: "done", summary: "", message: "该开会了", at: 0 } }), "remind", { status: "sent" } as any)).toBe("已提醒：“该开会了”");
  });

  it("事件触发（扩展点）：来源和过滤条件对得上的开着的规则各开一个 run，走同一条观察 / 执行的路；对不上、关着的不开", async () => {
    const events = new RuleEvents(svc);
    const r = svc.createRule({ botId: "b", conversationId: CONV, title: "仓库新 issue", instruction: "有新 issue 时看看要不要我处理", trigger: { kind: "event", source: "fake", filter: { repo: "me/app" } } });
    const other = svc.createRule({ botId: "b", conversationId: CONV, title: "别的仓库", instruction: "x", trigger: { kind: "event", source: "fake", filter: { repo: "me/other" } } });
    expect(r.rule).toMatchObject({ mode: "observe", nextRunAt: 0, trigger: { kind: "event", source: "fake" } });
    expect(svc.getRuleView(r.rule!.id)).toMatchObject({ when: "事件 fake", state: { key: "observe" } });
    expect(events.emit("fake", { repo: "me/app", title: "登录页打不开", number: 12 })).toEqual([r.rule!.id]);
    await flush();
    const p = host.prompts.at(-1)!;
    expect(p.sessionId).toMatch(new RegExp(`^rule-${r.rule!.id}-`));
    expect(p.text).toContain('[事件]\n来源：fake\n{"repo":"me/app","title":"登录页打不开","number":12}');
    expect(runsOf(r.rule!.id)[0]).toMatchObject({ cause: "event", mode: "observe" });
    await turn(report("done", "仓库有个新 issue #12：登录页打不开"));
    expect(svc.ruleLog(r.rule!.id)[0].line).toBe("本会发送：“X 降价了：现在 ¥199（昨天 ¥259）。”");
    expect(pushes()).toEqual([]);
    // 对不上、关着的、别的来源
    expect(events.emit("fake", { repo: "me/nothing" })).toEqual([]);
    svc.updateRule(other.rule!.id, { mode: "off" });
    expect(events.emit("fake", { repo: "me/other" })).toEqual([]);
    expect(events.emit("github", { repo: "me/app" })).toEqual([]);
    // 执行：命中推一句，id 一样固定
    svc.updateRule(r.rule!.id, { mode: "act" });
    expect(events.emit("fake", { repo: "me/app", title: "又一个" })).toEqual([r.rule!.id]);
    await flush();
    await turn(report("done", "又一个新 issue"));
    expect(pushes().map((x) => x.purpose)).toEqual(["rule"]);
  });

  it("一次运行最长 15 分钟：到了就停掉会话、这次算失败（超时）", async () => {
    svc.stop();
    svc = make({ cap: 20 });
    svc.start();
    const { rule } = await create();
    await go(at("2026-11-02T08:00"));
    const sid = host.prompts.at(-1)!.sessionId;
    await new Promise((r) => setTimeout(r, 60));
    await flush();
    expect(runsOf(rule.id)[0]).toMatchObject({ outcome: "failed", error: "timeout" });
    expect(svc.ruleLog(rule.id)[0]).toMatchObject({ line: "失败：超时", error: "超时" });
    expect(host.stops).toContain(sid);
    expect(store.getRule(rule.id)!.failures).toBe(1);
  });

  it("没报告：提醒一次（规则的说法），还没有就失败；观察时要批准的自动拒绝、记成「需要批准」", async () => {
    const { rule } = await create();
    await go(at("2026-11-02T08:00"));
    svc.wouldNeedApproval(runsOf(rule.id)[0].id, "curl -X POST https://x.example/alert");
    await turn();
    expect(host.prompts.at(-1)!.text).toBe(RULE_NUDGE);
    await turn();
    const [run] = runsOf(rule.id);
    expect(run).toMatchObject({ outcome: "failed", error: "没有给出结果", would: "approval: curl -X POST https://x.example/alert" });
    expect(svc.ruleLog(rule.id)[0]).toMatchObject({ line: "失败：没有给出结果", would: "需要批准：curl -X POST https://x.example/alert" });
    // 不能问用户
    await go(at("2026-11-03T08:00"));
    expect(svc.report({ sessionId: host.prompts.at(-1)!.sessionId, state: "needs_you", summary: "" }).error).toMatch(/cannot ask the user/);
  });

  it("执行时的审批：在「需要你」里（规则名），不进聊天回合；1 小时没人管就拒绝、这次失败；ruleOfSession 认得子代理", async () => {
    const { rule } = await create();
    svc.updateRule(rule.id, { mode: "act" });
    await go(at("2026-11-02T08:00"));
    const sid = host.prompts.at(-1)!.sessionId;
    const who = svc.ruleOfSession("sub-1", sid)!;
    expect(who).toMatchObject({ ruleId: rule.id, conversationId: CONV, mode: "act" });
    const row = approvals.create({ kind: "approval", botId: "b", conversationId: CONV, sessionId: sid, tool: "bash", detail: "npm publish", reason: "", ruleId: rule.id, runId: who.runId, ttlMs: 3600_000 });
    expect(approvals.pendingChat(CONV)).toEqual([]);
    expect(approvals.handleReply(CONV, "y", "weixin:owner")).toEqual({ handled: false });
    now += 3600_001;
    approvals.sweep();
    await flush();
    expect(store.getApproval(row.id)!.status).toBe("expired");
    expect(runsOf(rule.id)[0]).toMatchObject({ outcome: "failed", error: "approval_timeout" });
    expect(host.stops).toContain(sid);
  });

  it("微信：执行中的规则（含提醒）每条留 1 条配额，观察中的不留；续期提醒列出窗口关了以后要跑的", async () => {
    const { rule } = await create();
    expect(delivery.reserved("b", "weixin", "owner")).toBe(0);
    svc.updateRule(rule.id, { mode: "act" });
    expect(delivery.reserved("b", "weixin", "owner")).toBe(1);
    await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "喝水", instruction: "每天下午三点提醒我喝水", schedule: "daily 15:00", kind: "remind", message: "喝水。" } });
    expect(delivery.reserved("b", "weixin", "owner")).toBe(2);
    const peer = { botId: "b", channel: "weixin", peerId: "owner", conversationId: CONV };
    expect(delivery.upcoming(peer, at("2026-11-02T07:30")).map((u) => [u.label, u.at, u.kind])).toEqual([
      ["看 X 价格", at("2026-11-02T08:00"), "rule"],
      ["喝水", at("2026-11-02T15:00"), "reminder"],
    ]);
    expect(delivery.upcoming(peer, at("2026-11-02T09:00")).map((u) => u.label)).toEqual(["喝水"]);
    svc.updateRule(rule.id, { mode: "observe" });
    expect(delivery.reserved("b", "weixin", "owner")).toBe(1);
  });

  it("聊天代理：task_list 列出规则；rule_update 改模式、改原话、删掉；/tasks 列出规则，/stop 编号 关掉它", async () => {
    const { rule } = await create();
    const list = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "list", args: {} });
    expect(list.text).toBe(`rule ${rule.id} 「看 X 价格」 每天 08:00 · 观察中`);
    const up = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_update", args: { rule: "X 价格", mode: "act" } });
    expect(up.text).toMatch(/^Updated rule 「看 X 价格」: 每天 08:00, 执行中\./);
    const re = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_update", args: { rule: rule.id, instruction: "低于 150 告诉我" } });
    expect(re.text).toContain("its next run only observes");
    expect(svc.listText(CONV)).toBe("规则：\n1. 每天 08:00 看 X 价格 · 观察中\n发 /stop 编号 可停止。");
    expect(svc.stopByIndex(CONV, 1, "weixin:owner")).toBe("已关闭规则「看 X 价格」。");
    expect(store.getRule(rule.id)!.mode).toBe("off");
    expect(svc.listText(CONV)).toBe("没有后台任务。");
    const del = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_update", args: { rule: "X", delete: true } });
    expect(del.text).toMatch(/^Deleted rule/);
    expect(store.getRule(rule.id)).toBeUndefined();
    expect((await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_update", args: { rule: "X", mode: "act" } })).error).toMatch(/No rule matches/);
  });

  it("没设小模型：检查和写那一句都用主模型，不再多调一次；网页会话：写进会话历史", async () => {
    host.settingsValue = { ...DEFAULT_SETTINGS };
    const r = svc.createRule({ botId: "b", conversationId: WEB, title: "看 X 价格", instruction: "看看 X", schedule: parseSchedule("daily 08:00", TZ, now).schedule });
    svc.updateRule(r.rule!.id, { mode: "act" });
    await go(at("2026-11-02T08:00"));
    expect(host.prompts.at(-1)!.model).toBe("main-model");
    await turn(report("done", "X 降到 199 了"));
    await flush();
    expect(writes).toEqual([]);
    expect(pushes()).toEqual([]);
    expect(store.listMessages(WEB).at(-1)!.content).toBe("X 降到 199 了");
    expect(runsOf(r.rule!.id)[0].delivery).toBe(`rule:${r.rule!.id}:${runsOf(r.rule!.id)[0].id}`);
  });

  it("英文（界面请求、应用语言是英文时）：时间表的话、状态、运行记录、「需要你」、暂停推送、建规则时建议的回复；给模型的第一条输入照旧是中文", async () => {
    const d = (text: string) => describeSchedule(parseSchedule(text, TZ, now).schedule!, false, "en");
    expect([d("daily 08:00"), d("weekdays 08:00"), d("weekly sun,thu,mon 09:00"), d("every 30m"), d("every 1h"), d("every 2h"), d("once 2026-11-03 15:00")]).toEqual([
      "Daily 08:00",
      "Weekdays 08:00",
      "Every Mon, Thu, Sun 09:00",
      "Every 30 min",
      "Every hour",
      "Every 2 hours",
      "Nov 3 15:00",
    ]);
    expect(normalizeSchedule({ kind: "every", minutes: 5 }, TZ, now, "en").error).toBe("The interval must be at least 15 minutes");
    const { rule } = await create();
    svc.updateRule(rule.id, { mode: "act" });
    await day("2026-11-02", report("done", "X 降到 199 了"));
    await day("2026-11-03", report("done"));
    withLang("en", () => {
      expect(svc.getRuleView(rule.id)).toMatchObject({ when: "Daily 08:00", state: { key: "act", label: "Acting" } });
      expect(svc.ruleLog(rule.id).map((r) => [r.line, r.permission])).toEqual([
        ["Stayed quiet: X 现在 ¥199", "Can write the workspace"],
        ["Waiting to send: “X 降价了：现在 ¥199（昨天 ¥259）。”", "Can write the workspace"],
      ]);
    });
    // 应用语言是英文：推送的暂停那句、「需要你」、/tasks、建规则时建议的回复都是英文；给模型的第一条输入照旧
    setLangPref("en");
    try {
      for (const date of ["2026-11-04", "2026-11-05", "2026-11-06"]) await day(date, report("failed", "", {}));
      expect(pushes().find((r) => r.purpose === "failure")!.body.text).toBe("⚠️ Rule “看 X 价格” failed 3 times in a row and is paused: no result");
      expect(svc.ruleAttention()[0]).toMatchObject({ subject: "Rule “看 X 价格”", status: "Failed 3 times in a row, paused", line: "no result" });
      expect(svc.listText(CONV)).toBe("Rules:\n1. Daily 08:00 看 X 价格 · Paused\nSend /stop <number> to stop one.");
      expect(host.prompts.at(-1)!.text).toContain("[规则]\n看 X 价格（每天 08:00）");
      const made = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "Weather", instruction: "check the rain every weekday", schedule: "weekdays 07:30" } });
      expect(made.text).toContain("「Rule set: Weather, Weekdays 07:30. It watches quietly for a few days; switch it to act under Tasks.」");
      expect(made.text).toContain("WeChat lets the bot message you only within 24 hours of your last message.");
      expect(svc.updateRule(rule.id, { title: " " }).error).toBe("Name can't be empty");
    } finally {
      setLangPref("system");
    }
  });

  it("模拟 48 小时：三条规则（每天、每 30 分钟、一次性提醒），中间应用关了 3 小时；次数、跳过、推送都对", async () => {
    const daily = (await create("daily 08:00")).rule;
    const half = (await create("every 30m")).rule;
    await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "rule_create", args: { title: "交房租", instruction: "明天中午提醒我交房租", schedule: "once 2026-11-03 12:00", kind: "remind", message: "该交房租了。" } });
    svc.updateRule(daily.id, { mode: "act" });
    const end = at("2026-11-04T07:00");
    let off = false;
    for (let t = now; t <= end; t += 5 * MIN) {
      // 11 月 3 日 01:00–04:00 应用没开
      const closed = t >= at("2026-11-03T01:00") && t < at("2026-11-03T04:00");
      if (closed && !off) (svc.stop(), (off = true));
      if (closed) continue;
      if (off) {
        now = t;
        svc = make();
        svc.start();
        off = false;
        await flush();
      } else await go(t);
      // 开了 run 的：这一轮就跑完（每次都没命中，每天的那条命中）
      while (svc.background().b) {
        const p = host.prompts.at(-1)!;
        const isDaily = p.sessionId.startsWith(`rule-${daily.id}`);
        await turn(report("done", isDaily ? "X 降到 199 了" : ""));
      }
    }
    await flush();
    const count = (id: string, outcome: string) => runsOf(id).filter((r) => r.outcome === outcome).length;
    expect([count(daily.id, "done"), count(daily.id, "skipped")]).toEqual([2, 0]);
    // 每 30 分钟：48 小时减去关着的 3 小时；重新打开时补跑一次、跳过一条
    expect(count(half.id, "skipped")).toBe(1);
    expect(count(half.id, "done")).toBeGreaterThanOrEqual(84);
    expect(count(half.id, "done")).toBeLessThanOrEqual(90);
    expect(pushes().map((r) => r.purpose).sort()).toEqual(["reminder", "rule", "rule"]);
    expect(writes).toHaveLength(2);
  });
});
