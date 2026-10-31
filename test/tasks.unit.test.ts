/**
 * 后台任务（3a）的零件：阶段表（一行一行）、名额（每个机器人、总数、人的预留名额与先后）、
 * TaskService 对着一个假的宿主：建任务与第一条输入、一轮结束与收尾、Report、提醒、出错重试、追加、停止、
 * 重启恢复（恢复说明在前、没收下的输入再交一次）、送达（出站队列 id 固定，只交一次）、/tasks 与 /stop 编号。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskStage, type StageInput } from "../src/tasks/stage.js";
import { byPriority, pickRuns, priorityOf, type Waiting } from "../src/tasks/slots.js";
import { TaskService, slugOf, takeTaskNotes, type TaskHost, type TaskNotification } from "../src/tasks/service.js";
import { AgentHost, ResumeFailed } from "../src/agent/host.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/agent/settings.js";
import { NUDGE, TASK_RULES, recoveryNote, taskBrief } from "../src/agent/prompts/index.js";
import { Outbox } from "../src/core/outbox.js";
import { Store } from "../src/store/db.js";

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

describe("阶段表：第一条符合的为准", () => {
  const run = (state: any, outcome: any = "") => ({ state, outcome });
  const rows: Array<[string, StageInput, string, string]> = [
    ["1 停止了，哪怕结果没送到", { stopped: true, undelivered: true, run: run("ended", "stopped") }, "stopped", "已停止"],
    ["2 结果没送到", { stopped: false, undelivered: true, run: run("ended", "done") }, "needs-you/delivery", "未送达"],
    ["2 失败消息没送到", { stopped: false, undelivered: true, run: run("ended", "failed") }, "needs-you/delivery", "未送达"],
    ["3 等你回答", { stopped: false, waiting: "answer", run: run("running") }, "needs-you/answer", "等你回答"],
    ["3 等你批准（阻塞着的审批）", { stopped: false, waiting: "approval", run: run("running") }, "needs-you/approval", "等你批准"],
    ["3 run 以问题结束", { stopped: false, run: run("ended", "needs_you") }, "needs-you/answer", "等你回答"],
    ["4 预算用完", { stopped: false, run: run("ended", "budget") }, "needs-you/budget", "预算用完"],
    ["5 失败", { stopped: false, run: run("ended", "failed") }, "failed", "失败"],
    ["6 已完成", { stopped: false, run: run("ended", "done") }, "ready", "已完成"],
    ["7 排队中", { stopped: false, run: run("queued") }, "working/queued", "排队中"],
    ["7 中断后等恢复", { stopped: false, run: run("ended", "interrupted") }, "working/queued", "排队中"],
    ["8 进行中", { stopped: false, run: run("running") }, "working", "进行中"],
    ["8 收尾中（后台命令还在跑）也是进行中", { stopped: false, run: run("settling") }, "working", "进行中"],
    ["人的输入开了新 run：失败之后又在进行", { stopped: false, run: run("queued") }, "working/queued", "排队中"],
    ["送达问题只在 run 结束后才算", { stopped: false, undelivered: true, run: run("running") }, "working", "进行中"],
  ];
  it.each(rows)("%s", (_name, input, key, label) => {
    const s = taskStage(input);
    expect([s.key, s.label]).toEqual([key, label]);
  });
  it("分组：进行中、等你、结束了", () => {
    expect(taskStage({ stopped: false, run: run("running") }).group).toBe("working");
    expect(taskStage({ stopped: false, run: run("ended", "failed") }).group).toBe("needs");
    expect(taskStage({ stopped: false, run: run("ended", "done") }).group).toBe("ended");
    expect(taskStage({ stopped: true }).group).toBe("ended");
  });
});

describe("名额：每个机器人 2 个、总共 4 个，聊天不占；人的唤醒可多用一个、排在前面", () => {
  const limits = { perBot: () => 2, global: 4 };
  const q = (id: string, botId: string, priority: Waiting["priority"], queuedAt: number): Waiting => ({ id, botId, priority, queuedAt });
  it("起因 → 先后", () => {
    expect(["launch", "recover", "schedule", "followup", "answer", "retry", "continue", "manual"].map((c) => priorityOf(c as any))).toEqual(["launch", "recover", "rule", "person", "person", "person", "person", "person"]);
  });
  it("人的唤醒 → 启动 → 恢复 → 规则，同一级按排队时间", () => {
    const list = [q("r", "a", "rule", 1), q("rec", "a", "recover", 2), q("l2", "a", "launch", 5), q("l1", "a", "launch", 3), q("p", "a", "person", 9)];
    expect(byPriority(list).map((x) => x.id)).toEqual(["p", "l1", "l2", "rec", "r"]);
  });
  it("每个机器人最多 2 个", () => {
    const picks = pickRuns([q("1", "a", "launch", 1), q("2", "a", "launch", 2), q("3", "a", "launch", 3)], [], limits);
    expect(picks.map((x) => x.id)).toEqual(["1", "2"]);
    expect(pickRuns([q("3", "a", "launch", 3)], [{ botId: "a" }, { botId: "a" }], limits)).toEqual([]);
  });
  it("所有机器人加起来最多 4 个", () => {
    const running = [{ botId: "a" }, { botId: "a" }, { botId: "b" }];
    expect(pickRuns([q("c1", "c", "launch", 1), q("c2", "c", "launch", 2)], running, limits).map((x) => x.id)).toEqual(["c1"]);
  });
  it("人的唤醒：本机器人多一个预留名额，也不受总数限制，并排在排队的启动前面", () => {
    const running = [{ botId: "a" }, { botId: "a" }, { botId: "b" }, { botId: "b" }];
    const picks = pickRuns([q("launch", "a", "launch", 1), q("answer", "a", "person", 5), q("answer2", "a", "person", 6)], running, limits);
    expect(picks.map((x) => x.id)).toEqual(["answer"]);
  });
  it("名额空出来时，排在前面的先走", () => {
    const picks = pickRuns([q("rec", "a", "recover", 1), q("launch", "a", "launch", 9)], [{ botId: "a" }], limits);
    expect(picks.map((x) => x.id)).toEqual(["launch"]);
  });
  it("不同机器人各算各的", () => {
    const picks = pickRuns([q("a1", "a", "launch", 1), q("b1", "b", "launch", 2)], [{ botId: "a" }, { botId: "a" }], limits);
    expect(picks.map((x) => x.id)).toEqual(["b1"]);
  });
});

describe("文件夹名与提示词", () => {
  it("slug：标题里的字母数字，中文标题是 task", () => {
    expect(slugOf("GPU 价格调研")).toBe("gpu");
    expect(slugOf("Build the Quarterly Report deck!")).toBe("build-the-quarterly-repo");
    expect(slugOf("季度报告")).toBe("task");
  });
  it("第一条输入：用户原话在最前，说明不能替代原话", () => {
    const t = taskBrief({ title: "GPU 价格调研", original: "帮我调研三家云的 GPU 价格", brief: "比较 A100", recent: [{ role: "user", text: "你好" }], attachments: ["inbox/a.pdf"], memory: "- 用户在上海", folder: "tasks/gpu-abc123" });
    expect(t.indexOf("[用户的原话]\n帮我调研三家云的 GPU 价格")).toBeLessThan(t.indexOf("[对话助手的说明]\n比较 A100"));
    expect(t).toContain("[之前的对话]\n用户：你好");
    expect(t).toContain("[附件]\ninbox/a.pdf");
    expect(t).toContain("[长期记忆快照]\n- 用户在上海");
    expect(t).toContain("tasks/gpu-abc123");
  });
  it("恢复说明：被停掉的后台命令、先看日志和外部系统再重复外部动作", () => {
    expect(recoveryNote([])).toContain("these background jobs were stopped: none.");
    expect(recoveryNote(["sleep 600"])).toContain("stopped: sleep 600.");
    expect(recoveryNote([])).toContain("read `.task/journal.md`");
  });
});

/** 假的宿主：记下交给会话的输入、插话、停止；安静与否按队列回答 */
class FakeHost implements TaskHost {
  available = true;
  prompts: Array<{ botId: string; sessionId: string; folder: string; model: string; text: string; resume: boolean; id: string }> = [];
  steers: Array<{ sessionId: string; id: string; text: string }> = [];
  stops: string[] = [];
  quiets: Array<{ quiet: boolean; jobs?: string[] }> = [];
  steerOk = true;
  failResume = false;
  failPrompt = 0;
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
    return "- 用户叫小王";
  }
  async prompt(botId: string, o: { sessionId: string; folder: string; model: string; text: string; resume: boolean }) {
    if (this.failPrompt > 0) {
      this.failPrompt--;
      throw new Error("代理进程启动失败");
    }
    if (o.resume && this.failResume) throw new ResumeFailed("session not found");
    const id = `msg-${++this.n}`;
    this.prompts.push({ botId, ...o, id });
    return id;
  }
  async steer(_botId: string, sessionId: string, id: string, text: string) {
    this.steers.push({ sessionId, id, text });
    return this.steerOk;
  }
  async stop(_botId: string, sessionId: string) {
    this.stops.push(sessionId);
  }
  async quiet() {
    return this.quiets.shift() ?? { quiet: true };
  }
}

describe("TaskService（假宿主）", () => {
  let store: Store;
  let host: FakeHost;
  let outbox: Outbox;
  let svc: TaskService;
  let ws: string;
  const CONV = "b:weixin:owner";

  const make = () => new TaskService({ store, host, outbox, defaultModel: () => "mock-model", retryDelaysMs: [5, 5, 5], maxBackground: 4 });
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-tasks-unit-"));
    store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝" });
    store.ensureConversation("b", "weixin", "owner", "owner");
    store.addMessage(CONV, "user", "早上好");
    store.addMessage(CONV, "assistant", "早");
    store.addMessage(CONV, "user", "帮我后台调研一下三家云的 GPU 价格 [文件 价目.pdf → inbox/20261031-x-价目.pdf]");
    host = new FakeHost(ws);
    outbox = new Outbox(store);
    svc = make();
    svc.start();
  });
  afterEach(() => {
    svc.stop();
    store.close();
    fs.rmSync(ws, { recursive: true, force: true });
  });

  const ev = (sessionId: string, type: string, data: any = {}): TaskNotification => ({ method: "session.event", params: { sessionId, event: { type, data, time: Date.now() } } });
  const status = (sessionId: string, s: "running" | "idle"): TaskNotification => ({ method: "session.status", params: { sessionId, status: s } });
  /** 会话收下最近一次交给它的输入，跑一轮；during 在这一轮中间做点什么（报告、出错） */
  const turn = async (sessionId: string, during?: () => void | Promise<void>, end: any = { kind: "completed" }) => {
    const p = host.prompts.filter((x) => x.sessionId === sessionId).at(-1)!;
    svc.onEvent("b", sessionId, status(sessionId, "running"));
    svc.onEvent("b", sessionId, ev(sessionId, "turn/start", { turn: 1 }));
    svc.onEvent("b", sessionId, ev(sessionId, "user/message", { id: p.id, role: "user", content: [{ type: "text", text: p.text }] }));
    await during?.();
    svc.onEvent("b", sessionId, ev(sessionId, "turn/end", { turn: 1, reason: end }));
    svc.onEvent("b", sessionId, status(sessionId, "idle"));
    await flush();
  };
  const start = (title = "GPU 价格调研") => {
    const r = svc.create({ botId: "b", conversationId: CONV, title, brief: "比较三家云 A100 的包月价格" });
    expect(r.error).toBeUndefined();
    return r.task!;
  };
  const report = (sessionId: string, state: string, message = "", files?: string[]) => svc.report({ sessionId, state, summary: "查了三家", message, files });
  const runs = (taskId: string) => store.listRuns({ taskId }).map((r) => [r.cause, r.state, r.outcome]);

  it("建任务：自己的会话和文件夹，第一条输入有用户原话、说明、之前的对话、附件和记忆；交给会话时是新会话", async () => {
    const t = start();
    await flush();
    expect(t.id).toMatch(/^t_[0-9a-f]{12}$/);
    expect(t.sessionId).toBe(`task-${t.id}`);
    expect(t.folder).toBe(`tasks/gpu-${t.id.slice(2, 8)}`);
    expect(t.permission).toBe("workspace");
    expect(t.model).toBe("mock-model");
    expect(fs.existsSync(path.join(ws, t.folder))).toBe(true);
    expect(host.prompts).toHaveLength(1);
    const p = host.prompts[0];
    expect(p).toMatchObject({ sessionId: t.sessionId, folder: path.join(ws, t.folder), resume: false, model: "mock-model" });
    expect(p.text).toContain("[用户的原话]\n帮我后台调研一下三家云的 GPU 价格");
    expect(p.text).toContain("[对话助手的说明]\n比较三家云 A100 的包月价格");
    expect(p.text).toContain("用户：早上好\n助手：早");
    expect(p.text).toContain("[附件]\ninbox/20261031-x-价目.pdf");
    expect(p.text).toContain("- 用户叫小王");
    expect(svc.get(t.id)!.stage.key).toBe("working");
    expect(store.getTask(t.id)!.originMessageId).toBe(store.listMessages(CONV).at(-1)!.id);
  });

  it("一轮结束、会话安静：按 done 结束，那句话经出站队列发回原会话（id 固定），写进历史，给聊天代理留便条；只交一次", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, () => void expect(report(t.sessionId, "done", "GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800。").text).toMatch(/^Recorded/));
    expect(runs(t.id)).toEqual([["launch", "ended", "done"]]);
    const run = store.listRuns({ taskId: t.id })[0];
    const id = `task:${t.id}:result:${run.id}`;
    expect(run.delivery).toBe(id);
    const row = store.getOutbox(id)!;
    expect(row).toMatchObject({ channel: "weixin", peerId: "owner", kind: "text", status: "pending", conversationId: CONV });
    expect(row.body.text).toBe("GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800。");
    expect(store.listMessages(CONV).at(-1)!.content).toBe(row.body.text);
    expect(svc.get(t.id)!.stage.key).toBe("ready");
    expect(store.getTask(t.id)!.endReason).toBe("done");
    expect(takeTaskNotes(store, CONV)).toBe(`[后台任务「GPU 价格调研」已完成，已把结果发给用户] ${row.body.text}`);
    expect(takeTaskNotes(store, CONV)).toBe("");
    // 重启后不再交一次
    svc.stop();
    svc = make();
    svc.start();
    expect(store.listOutbox({ limit: 50 }).filter((r) => r.id.startsWith(`task:${t.id}`))).toHaveLength(1);
    expect(store.listMessages(CONV).filter((m) => m.content === row.body.text)).toHaveLength(1);
  });

  it("失败：⚠️ 加任务名和原因；progress 只记下、不发", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, () => {
      expect(report(t.sessionId, "progress", "已比较两家").text).toMatch(/^Progress recorded/);
      report(t.sessionId, "failed", "X 云的价格页要登录，我进不去");
    });
    expect(runs(t.id)).toEqual([["launch", "ended", "failed"]]);
    expect(store.listMessages(CONV).at(-1)!.content).toBe("⚠️「GPU 价格调研」没做完：X 云的价格页要登录，我进不去");
    expect(svc.get(t.id)!.stage.key).toBe("failed");
    expect(store.listOutbox({ limit: 50 }).map((r) => r.id)).toEqual([`task:${t.id}:failure:${store.listRuns({ taskId: t.id })[0].id}`]);
  });

  it("问用户在 3a 不可用：needs_you 被拒，代理自己决定", async () => {
    const t = start();
    await flush();
    expect(report(t.sessionId, "needs_you").error).toMatch(/cannot ask the user/);
    expect(report(t.sessionId, "maybe").error).toMatch(/state must be/);
  });

  it("这一轮没报告：提醒一次；还没有就失败（没有给出结果）", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId);
    expect(host.prompts.at(-1)!.text).toBe(NUDGE);
    expect(runs(t.id)).toEqual([["launch", "running", ""]]);
    await turn(t.sessionId);
    expect(runs(t.id)).toEqual([["launch", "ended", "failed"]]);
    expect(store.listMessages(CONV).at(-1)!.content).toBe("⚠️「GPU 价格调研」没做完：没有给出结果");
  });

  it("这一轮出错：过一会儿带着错误接着做（最多 3 次）", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, undefined, { kind: "error", error: { message: "upstream 503" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(host.prompts.at(-1)!.text).toMatch(/^Your previous step failed with an error: upstream 503\./);
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    expect(runs(t.id)).toEqual([["launch", "ended", "done"]]);
  });

  it("收尾：会话空了还有后台命令时占着名额（settling），插件报 settled 后才结束；没收下的输入时的空闲不算", async () => {
    const t = start();
    await flush();
    // 旧的空闲（输入还没被收下）：不结束
    svc.onEvent("b", t.sessionId, status(t.sessionId, "idle"));
    await flush();
    expect(runs(t.id)).toEqual([["launch", "running", ""]]);
    host.quiets.push({ quiet: false, jobs: ["bash-1"] });
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    expect(runs(t.id)).toEqual([["launch", "settling", ""]]);
    expect(svc.get(t.id)!.stage.key).toBe("working");
    // 后台命令结束，代理被叫醒又跑一轮：还是这个 run
    svc.onEvent("b", t.sessionId, status(t.sessionId, "running"));
    expect(runs(t.id)).toEqual([["launch", "running", ""]]);
    expect(svc.settled({ sessionId: t.sessionId })).toEqual({ ok: true });
    expect(runs(t.id)).toEqual([["launch", "running", ""]]);
    host.quiets.push({ quiet: false });
    svc.onEvent("b", t.sessionId, status(t.sessionId, "idle"));
    await flush();
    expect(runs(t.id)).toEqual([["launch", "settling", ""]]);
    svc.settled({ sessionId: t.sessionId, killedJobs: [] });
    expect(runs(t.id)).toEqual([["launch", "ended", "done"]]);
  });

  it("名额：同一机器人第三个任务排队，前面的结束了它才开始；聊天从不经过这里", async () => {
    const a = start("A");
    const b = start("B");
    const c = start("C");
    await flush();
    expect(host.prompts.map((p) => p.sessionId)).toEqual([a.sessionId, b.sessionId]);
    expect([a, b, c].map((t) => svc.get(t.id)!.stage.key)).toEqual(["working", "working", "working/queued"]);
    await turn(a.sessionId, () => void report(a.sessionId, "done", "A 好了"));
    await flush();
    expect(host.prompts.map((p) => p.sessionId)).toEqual([a.sessionId, b.sessionId, c.sessionId]);
    expect(svc.background()).toEqual({ b: 2 });
  });

  it("名额是机器人设置：设成 1 就一次一个", async () => {
    host.settingsValue = normalizeSettings({ taskSlots: 1 });
    start("A");
    start("B");
    await flush();
    expect(host.prompts).toHaveLength(1);
  });

  it("追加：在跑一轮就并进去（插话，id 就是输入 id）；会话空着就马上交；已完成的在同一任务里开新 run（人的唤醒）", async () => {
    const t = start();
    await flush();
    svc.onEvent("b", t.sessionId, status(t.sessionId, "running"));
    expect(await svc.message(t.id, "报告用英文")).toEqual({ how: "steered" });
    expect(host.steers).toEqual([{ sessionId: t.sessionId, id: expect.stringMatching(/^i_/), text: "[用户追加]\n报告用英文" }]);
    const steered = store.listInputs(t.id).at(-1)!;
    expect(steered).toMatchObject({ messageId: steered.id, fromPerson: true });
    expect(steered.deliveredAt).toBeGreaterThan(0);
    // 插话被收下
    svc.onEvent("b", t.sessionId, ev(t.sessionId, "user/message", { id: steered.id }));
    expect(store.listInputs(t.id).at(-1)!.takenAt).toBeGreaterThan(0);
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    expect(svc.get(t.id)!.stage.key).toBe("ready");
    // 已完成：同一个任务、同一个会话再开一个 run
    expect(await svc.message(t.id, "再加上 H100")).toEqual({ how: "resumed" });
    await flush();
    expect(runs(t.id)).toEqual([
      ["launch", "ended", "done"],
      ["followup", "running", ""],
    ]);
    expect(host.prompts.at(-1)).toMatchObject({ sessionId: t.sessionId, text: "[用户追加]\n再加上 H100", resume: true });
    expect(store.getTask(t.id)!.endedAt).toBe(0);
  });

  it("停止：只停这个任务（宿主停会话），不发任何消息；之后的报告被拒；停了的不能再追加；/stop 编号一样", async () => {
    const a = start("A");
    const b = start("B");
    await flush();
    svc.onEvent("b", a.sessionId, status(a.sessionId, "running"));
    expect(await svc.stopTask(a.id, "web")).toBe(true);
    expect(host.stops).toEqual([a.sessionId]);
    expect(runs(a.id)).toEqual([["launch", "ended", "stopped"]]);
    expect(svc.get(a.id)!.stage.key).toBe("stopped");
    expect(store.getTask(a.id)).toMatchObject({ endReason: "stopped", stoppedBy: "web" });
    expect(report(a.sessionId, "done", "x").error).toMatch(/not running any more/);
    expect((await svc.message(a.id, "继续")).error).toMatch(/已停止，不能再追加/);
    expect(store.listOutbox({ limit: 50 })).toEqual([]);
    expect(await svc.stopTask(a.id, "web")).toBe(false);
    // /tasks 与 /stop 编号：进行中的在前
    expect(svc.listText(CONV)).toBe("后台任务：\n1. B · 进行中\n2. A · 已停止\n发 /stop 编号 可停止。");
    expect(svc.stopByIndex(CONV, 2, "weixin:owner")).toBe("「A」已停止。");
    expect(svc.stopByIndex(CONV, 1, "weixin:owner")).toBe("已停止后台任务「B」。");
    await flush();
    expect(svc.get(b.id)!.stage.key).toBe("stopped");
    expect(svc.stopByIndex(CONV, 5, "weixin:owner")).toBe("没有第 5 个后台任务，发 /tasks 查看。");
    expect(svc.listText("b:weixin:nobody")).toBe("没有后台任务。");
  });

  it("重启恢复：跑着的 run 记为中断，排恢复 run；恢复说明在最前（列出被停的后台命令），没被收下的输入再交，收下过的不再交；同一个会话 resume", async () => {
    const t = start();
    await flush();
    const brief = host.prompts[0];
    svc.onEvent("b", t.sessionId, status(t.sessionId, "running"));
    svc.onEvent("b", t.sessionId, ev(t.sessionId, "user/message", { id: brief.id }));
    // 这一轮把一条命令转到了后台；用户又追加了一条，还没交出去（会话忙）
    svc.onEvent("b", t.sessionId, ev(t.sessionId, "tool/call", { callId: "c1", name: "bash", arguments: JSON.stringify({ command: "sleep 600" }) }));
    svc.onEvent("b", t.sessionId, ev(t.sessionId, "tool/result", { message: { toolCallId: "c1", content: [{ type: "text", text: "[still running after 30000ms; moved to background job bash-7]" }] } }));
    svc.onEvent("b", t.sessionId, ev(t.sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } }));
    host.steerOk = false;
    await svc.message(t.id, "加上 H100");
    // 应用退出又启动
    svc.stop();
    svc = make();
    svc.start();
    await flush();
    expect(runs(t.id)).toEqual([
      ["launch", "ended", "interrupted"],
      ["recover", "running", ""],
    ]);
    const p = host.prompts.at(-1)!;
    expect(p).toMatchObject({ sessionId: t.sessionId, resume: true });
    expect(p.text.startsWith(recoveryNote(["sleep 600"]))).toBe(true);
    expect(p.text).toContain("[用户追加]\n加上 H100");
    expect(p.text).not.toContain("[用户的原话]");
    expect(svc.get(t.id)!.stage.key).toBe("working");
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    expect(runs(t.id).at(-1)).toEqual(["recover", "ended", "done"]);
  });

  it("代理进程退出：同样中断、恢复；停了的、已完成的任务不动", async () => {
    const a = start("A");
    const b = start("B");
    await flush();
    await turn(b.sessionId, () => void report(b.sessionId, "done", "B 好了"));
    svc.onEvent("b", a.sessionId, status(a.sessionId, "running"));
    svc.onEvent("b", a.sessionId, ev(a.sessionId, "user/message", { id: host.prompts[0].id }));
    svc.onChildExit("b");
    await flush();
    expect(runs(a.id)).toEqual([
      ["launch", "ended", "interrupted"],
      ["recover", "running", ""],
    ]);
    expect(runs(b.id)).toEqual([["launch", "ended", "done"]]);
    expect(host.prompts.at(-1)!.text).toBe(recoveryNote([]));
  });

  it("会话记录恢复不了：换一个新会话，从宿主记下的说明重新交代", async () => {
    const t = start();
    await flush();
    svc.onEvent("b", t.sessionId, ev(t.sessionId, "user/message", { id: host.prompts[0].id }));
    svc.stop();
    svc = make();
    host.failResume = true;
    svc.start();
    await flush();
    const p = host.prompts.at(-1)!;
    expect(p.sessionId).toMatch(new RegExp(`^task-${t.id}-\\d+$`));
    expect(p.resume).toBe(false);
    expect(p.text).toContain("[用户的原话]\n帮我后台调研一下三家云的 GPU 价格");
    expect(p.text).toContain("之前的会话记录丢了");
    expect(store.getTask(t.id)!.sessionId).toBe(p.sessionId);
    await turn(p.sessionId, () => void report(p.sessionId, "done", "好了"));
    expect(svc.get(t.id)!.stage.key).toBe("ready");
  });

  it("代理暂时起不来：过一会儿再交；一直不行就失败并告诉用户", async () => {
    host.failPrompt = 1;
    const t = start();
    await flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(host.prompts).toHaveLength(1);
    expect(svc.get(t.id)!.stage.key).toBe("working");
    host.failPrompt = 10;
    const u = start("U");
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10));
    expect(svc.get(u.id)!.stage.key).toBe("failed");
    expect(store.listMessages(CONV).at(-1)!.content).toBe("⚠️「U」没做完：代理没能启动");
  });

  it("交付文件：只交工作区里真实存在的，先按任务文件夹找", async () => {
    const t = start();
    await flush();
    fs.writeFileSync(path.join(ws, t.folder, "report.md"), "# GPU");
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了", ["report.md", "/etc/hostname", "missing.md"]));
    const files = store.listOutbox({ limit: 50 }).filter((r) => r.kind === "file");
    expect(files.map((f) => f.body.path)).toEqual([fs.realpathSync(path.join(ws, t.folder, "report.md"))]);
    expect(files[0].id).toMatch(/^task:t_[0-9a-f]+:result:r_[0-9a-f]+:file:0$/);
  });

  it("聊天工具：只在用户的会话里；task_start 建任务，task_list 列出，task_message 按标题找", async () => {
    store.setAgentSession(CONV, "b", "session-chat");
    expect((await svc.chatTool({ botId: "b", sessionId: "task-x", op: "start", args: {} })).error).toMatch(/only be managed from a chat/);
    const r = await svc.chatTool({ botId: "b", sessionId: "session-chat", op: "start", args: { title: "GPU 价格调研", brief: "调研" } });
    expect(r.text).toMatch(/^Started background task t_[0-9a-f]{12} 「GPU 价格调研」/);
    await flush();
    expect((await svc.chatTool({ botId: "b", sessionId: "session-chat", op: "list", args: {} })).text).toMatch(/^t_[0-9a-f]{12} 「GPU 价格调研」 进行中$/);
    const t = store.listTasks({ conversationId: CONV })[0];
    svc.onEvent("b", t.sessionId, status(t.sessionId, "running"));
    expect((await svc.chatTool({ botId: "b", sessionId: "session-chat", op: "message", args: { task: "GPU", text: "用英文" } })).text).toMatch(/^Passed to 「GPU 价格调研」\. It reaches the task at its next step\./);
    expect((await svc.chatTool({ botId: "b", sessionId: "session-chat", op: "message", args: { task: "不存在", text: "x" } })).error).toMatch(/No background task matches/);
    // 任务会话所在的聊天（任务里的审批落到这里）
    expect(svc.conversationOf(t.sessionId)).toBe(CONV);
  });

  it("飞书：结果回复在请求那条消息下（出站队列）；网页：只写进会话历史，不进出站队列", async () => {
    const fs1 = store.ensureConversation("b", "feishu", "oc_1", "主人");
    store.addMessage(fs1.id, "user", "后台调研一下 GPU 价格");
    store.setKV(`reply-to:${fs1.id}`, JSON.stringify({ messageId: "om_req", chatId: "oc_1" }));
    const f = svc.create({ botId: "b", conversationId: fs1.id, title: "GPU", brief: "" }).task!;
    expect(f.originRef).toBe("om_req");
    const web = store.ensureConversation("b", "web", "console", "控制台");
    store.addMessage(web.id, "user", "后台整理发票");
    const w = svc.create({ botId: "b", conversationId: web.id, title: "发票", brief: "" }).task!;
    await flush();
    // 之后又来了一条消息：飞书还是回复在请求那条下面
    store.setKV(`reply-to:${fs1.id}`, JSON.stringify({ messageId: "om_later", chatId: "oc_1" }));
    await turn(f.sessionId, () => void report(f.sessionId, "done", "GPU 好了"));
    await turn(w.sessionId, () => void report(w.sessionId, "done", "发票好了"));
    const rows = store.listOutbox({ limit: 50 });
    expect(rows.map((r) => [r.channel, r.kind, r.replyTo, r.peerId, r.body.text])).toEqual([["feishu", "text", "om_req", "oc_1", "GPU 好了"]]);
    expect(store.listMessages(web.id).at(-1)!.content).toBe("发票好了");
    expect(svc.get(w.id)!.stage.key).toBe("ready");
  });

  it("出站队列放弃了（比如微信 24 小时窗口关了）：阶段是未送达", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    const run = store.listRuns({ taskId: t.id })[0];
    store.updateOutbox(run.delivery, { status: "gone", error: "对方超过 24 小时没有发消息，微信不再允许回复" });
    expect(svc.get(t.id)!.stage).toMatchObject({ key: "needs-you/delivery", label: "未送达", group: "needs" });
  });

  it("任务会话里阻塞着的审批：阶段是等你批准", async () => {
    const t = start();
    await flush();
    store.insertApproval({ id: "a1", code: "1234", kind: "approval", botId: "b", conversationId: CONV, sessionId: t.sessionId, tool: "bash", detail: "rm -rf build", reason: "", payload: "", createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    expect(svc.get(t.id)!.stage.key).toBe("needs-you/approval");
  });

  it("每个机器人最多 10 个进行中的任务", async () => {
    host.settingsValue = normalizeSettings({ taskSlots: 8 });
    for (let i = 0; i < 10; i++) start(`T${i}`);
    expect(svc.create({ botId: "b", conversationId: CONV, title: "再来一个", brief: "" }).error).toMatch(/already has 10 background tasks/);
  });
});

describe("宿主：补丁加载 amb-tasks，任务规则经环境变量交给插件；任务会话的通知交给任务服务", () => {
  it("补丁与环境", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-tasks-host-"));
    const store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝" });
    const host = new AgentHost({ botId: "b", dataDir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1", token: "t" } as any, store, settings: () => normalizeSettings({ computerUse: { enabled: false } }) });
    try {
      fs.mkdirSync(host.home, { recursive: true });
      const text = fs.readFileSync((host as any).writePatch("m"), "utf8");
      expect(text).toContain('    - id: amb-tasks\n      name: "/rt/plugins/amb-tasks.mjs"\n');
      expect((host as any).env().AMB_TASK_RULES).toBe(TASK_RULES);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("task-* 会话和它们子代理的通知不当成聊天的醒来，交给任务服务；记下哪些任务会话在跑一轮", () => {
    const store = new Store(":memory:");
    const seen: Array<[string, string]> = [];
    const host = new AgentHost({ botId: "b", dataDir: os.tmpdir(), runtimeDir: "/rt", bridge: {} as any, store, onTaskEvent: (root, n) => seen.push([root, n.method]) });
    (host as any).harness = { client: { isDescendantOf: (id: string, root: string) => id === "sub-1" && root === "task-t_1" } };
    (host as any).taskSessions.add("task-t_1");
    const tap = (n: any) => (host as any).tap(n);
    tap({ method: "session.status", params: { sessionId: "task-t_1", status: "running" } });
    expect((host as any).taskBusy.has("task-t_1")).toBe(true);
    tap({ method: "subagent.started", params: { parentSessionId: "task-t_1", childSessionId: "sub-1" } });
    tap({ method: "session.event", params: { sessionId: "sub-1", event: { type: "tool/call", data: {} } } });
    tap({ method: "session.status", params: { sessionId: "task-t_1", status: "idle" } });
    expect((host as any).taskBusy.size).toBe(0);
    // 聊天会话的通知不归任务
    tap({ method: "session.status", params: { sessionId: "session-chat", status: "running" } });
    expect(seen).toEqual([
      ["task-t_1", "session.status"],
      ["task-t_1", "subagent.started"],
      ["task-t_1", "session.event"],
      ["task-t_1", "session.status"],
    ]);
    store.close();
  });
});
