/**
 * 后台任务（3a）的零件：阶段表（一行一行）、名额（每个机器人、总数、人的预留名额与先后）、
 * TaskService 对着一个假的宿主：建任务与第一条输入、一轮结束与收尾、Report、提醒、出错重试、追加、停止、
 * 重启恢复（恢复说明在前、没收下的输入再交一次）、送达（出站队列 id 固定，只交一次）、/tasks 与 /stop 编号。
 * 3b：任务的提问（needs_you → 不阻塞的提问 → 推给会话、一次一个 → 回答成为新输入）、任务会话里的审批、「需要你」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskStage, type StageInput } from "../src/tasks/stage.js";
import { byPriority, pickRuns, priorityOf, type Waiting } from "../src/tasks/slots.js";
import { TaskService, askId, quotes, slugOf, takeTaskNotes, type TaskHost, type TaskNotification } from "../src/tasks/service.js";
import { ApprovalCenter } from "../src/agent/approvals.js";
import { AgentHost, ResumeFailed } from "../src/agent/host.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/agent/settings.js";
import { NUDGE, TASK_RULES, recoveryNote, taskBrief } from "../src/agent/prompts/index.js";
import { Outbox, sentText } from "../src/core/outbox.js";
import { Delivery } from "../src/core/delivery.js";
import { Store } from "../src/store/db.js";
import { BotRuntime } from "../src/core/runtime.js";
import { KeyedQueue } from "../src/core/queue.js";
import { FeishuChannel } from "../src/channels/feishu/channel.js";
import { messageEventOf } from "../src/channels/feishu/transport.js";
import type { AgentManager } from "../src/agent/manager.js";
import { FakeFeishu, feishuEvent } from "./helpers.js";

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
  let approvals: ApprovalCenter;
  let svc: TaskService;
  let ws: string;
  const CONV = "b:weixin:owner";

  const make = () => new TaskService({ store, host, delivery: new Delivery({ store, outbox }), approvals, defaultModel: () => "mock-model", retryDelaysMs: [5, 5, 5], maxBackground: 4 });
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
    approvals = new ApprovalCenter(store);
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

  /** 代理报 needs_you 带一个问题，结束这一轮 */
  const ask = (sessionId: string, question = "报告用中文还是英文？", options: string[] | undefined = ["中文", "英文"]) =>
    turn(sessionId, () => void expect(svc.report({ sessionId, state: "needs_you", summary: "查完了，差语言", question, ...(options ? { options } : {}) }).text).toMatch(/^Recorded\. End your turn now: the app asks the user/));
  const reply = (text: string, ctx = {}) => approvals.handleReply(CONV, text, "weixin:owner", { ...svc.replyContext(CONV), ...ctx });
  const asks = () => store.listOutbox({ limit: 100 }).filter((r) => r.id.includes(":ask:")).reverse();

  it("needs_you：要有一个问题；没有审批中心就不能问", async () => {
    const t = start();
    await flush();
    expect(report(t.sessionId, "needs_you").error).toMatch(/needs a question/);
    expect(report(t.sessionId, "maybe").error).toMatch(/state must be progress, needs_you, done or failed/);
    svc.stop();
    const bare = new TaskService({ store, host, delivery: new Delivery({ store, outbox }), defaultModel: () => "m" });
    bare.start();
    const u = bare.create({ botId: "b", conversationId: CONV, title: "U", brief: "" }).task!;
    await flush();
    expect(bare.report({ sessionId: u.sessionId, state: "needs_you", summary: "", question: "要吗？" }).error).toMatch(/cannot ask the user right now/);
    bare.stop();
  });

  it("退出演示的单元版：提问推到微信（一次），阶段等你回答；回编号算回答，回答成为新输入、开一个 answer run，任务接着做完", async () => {
    const t = start();
    await flush();
    await ask(t.sessionId);
    expect(runs(t.id)).toEqual([["launch", "ended", "needs_you"]]);
    const [q] = approvals.pendingForTask(t.id);
    expect(q).toMatchObject({ kind: "question", blocking: false, expiresAt: 0, taskId: t.id, runId: store.listRuns({ taskId: t.id })[0].id, conversationId: CONV, sessionId: t.sessionId });
    expect(svc.get(t.id)!.stage).toMatchObject({ key: "needs-you/answer", label: "等你回答", group: "needs" });
    // 推给微信：设计里的样式，原样发（不过 Markdown 过滤），id 固定
    expect(asks().map((r) => [r.id, r.kind, r.body.text, r.body.raw])).toEqual([[askId(q), "text", "❓「GPU 价格调研」想问你：报告用中文还是英文？\n1. 中文\n2. 英文\n（回复编号，或引用这条消息回答）", true]]);
    expect(store.listMessages(CONV).at(-1)!.content).toBe(asks()[0].body.text);
    // 聊天代理知道这件事（用户在聊天里回答时，它能转给任务）
    expect(takeTaskNotes(store, CONV)).toBe("[后台任务「GPU 价格调研」在等用户回答：报告用中文还是英文？（中文 / 英文）。用户在聊天里回答它时，用 task_message 转给这个任务]");
    // 提问是机器人最后一条消息：光回编号就是回答
    expect(reply("1")).toEqual({ handled: true, ack: "收到，「GPU 价格调研」继续。" });
    await flush();
    expect(store.getApproval(q.id)).toMatchObject({ status: "answered", decidedBy: "weixin:owner" });
    expect(runs(t.id)).toEqual([["launch", "ended", "needs_you"], ["answer", "running", ""]]);
    expect(host.prompts.at(-1)).toMatchObject({ sessionId: t.sessionId, resume: true });
    expect(host.prompts.at(-1)!.text).toBe("[用户回答了你的问题]\n问题：报告用中文还是英文？\n回答：中文");
    expect(svc.get(t.id)!.stage.key).toBe("working");
    await turn(t.sessionId, () => void report(t.sessionId, "done", "报告写好了（中文），在 report.md。"));
    expect(runs(t.id).at(-1)).toEqual(["answer", "ended", "done"]);
    expect(store.listOutbox({ limit: 50 }).find((r) => r.id.includes(":result:"))!.body.text).toBe("报告写好了（中文），在 report.md。");
    expect(asks()).toHaveLength(1);
  });

  it("提问不是机器人最后一条消息时，光回编号是普通聊天；引用和编号开头什么时候都算", async () => {
    const t = start();
    await flush();
    await ask(t.sessionId);
    const [q] = approvals.pendingForTask(t.id);
    // 之后机器人又在这个会话里回了一句（聊天）
    store.insertOutbox({ id: "wx:b:m9:final", botId: "b", channel: "weixin", conversationId: CONV, peerId: "owner", kind: "text", body: { text: "下午 3 点的会是线上的" }, replyTo: "", due: Date.now(), createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    expect(reply("1")).toEqual({ handled: false });
    expect(reply("中文")).toEqual({ handled: false });
    expect(reply("好的")).toEqual({ handled: false });
    // 以编号开头
    expect(reply(`${q.code} 英文`)).toEqual({ handled: true, ack: "收到，「GPU 价格调研」继续。" });
    await flush();
    expect(host.prompts.at(-1)!.text).toContain("回答：英文");
    // 引用（被截短、前面带名字也认得）
    const u = start("季度报告");
    await flush();
    await ask(u.sessionId, "PPT 要几页？", []);
    const [q2] = approvals.pendingForTask(u.id);
    expect(asks().find((r) => r.id === askId(q2))!.body.text).toBe("❓「季度报告」想问你：PPT 要几页？\n（引用这条消息回答）");
    expect(reply("10 页左右", { quote: "引用了别的消息", plain: "10 页左右" })).toEqual({ handled: false });
    expect(reply("> 小蓝: ❓「季度报告」想问你：PPT 要…\n10 页左右", { quote: "小蓝: ❓「季度报告」想问你：PPT 要…", plain: "10 页左右" })).toEqual({ handled: true, ack: "收到，「季度报告」继续。" });
    await flush();
    expect(host.prompts.at(-1)!.text).toBe("[用户回答了你的问题]\n问题：PPT 要几页？\n回答：10 页左右");
  });

  it("引用匹配：推出去的原文、截短的、带名字的；太短的片段和别的消息不算", () => {
    const sent = "❓「GPU 价格调研」想问你：报告用中文还是英文？\n1. 中文\n2. 英文\n（回复编号，或引用这条消息回答）";
    expect(quotes(sent, sent, "报告用中文还是英文？")).toBe(true);
    expect(quotes(sent, "❓「GPU 价格调研」想问你：报告用中文还是…", "报告用中文还是英文？")).toBe(true);
    expect(quotes(sent, "小蓝：报告用中文还是英文？", "报告用中文还是英文？")).toBe(true);
    expect(quotes(sent, "中文", "报告用中文还是英文？")).toBe(false);
    expect(quotes(sent, "下午 3 点的会是线上的", "报告用中文还是英文？")).toBe(false);
    expect(quotes(sent, "", "报告用中文还是英文？")).toBe(false);
  });

  it("一个会话同时只推一个：第二个任务的提问在「需要你」里等，第一个回答了才推", async () => {
    host.settingsValue = normalizeSettings({ taskSlots: 4 });
    const a = start("A 任务");
    const b = start("B 任务");
    await flush();
    await ask(a.sessionId, "A 用哪个？");
    await ask(b.sessionId, "B 用哪个？");
    const qa = approvals.pendingForTask(a.id)[0];
    const qb = approvals.pendingForTask(b.id)[0];
    expect(asks().map((r) => r.id)).toEqual([askId(qa)]);
    expect(svc.get(b.id)!.stage.key).toBe("needs-you/answer");
    // 光回编号只认推出去的那个（它是最后一条消息）
    expect(reply("2")).toMatchObject({ handled: true, ack: "收到，「A 任务」继续。" });
    await flush();
    expect(store.getApproval(qb.id)!.status).toBe("pending");
    expect(asks().map((r) => r.id)).toEqual([askId(qa), askId(qb)]);
    expect(asks().at(-1)!.body.text).toBe("❓「B 任务」想问你：B 用哪个？\n1. 中文\n2. 英文\n（回复编号，或引用这条消息回答）");
  });

  it("聊天代理的 task_message：任务在等回答时，这句话就是回答", async () => {
    store.setAgentSession(CONV, "b", "session-chat");
    const t = start();
    await flush();
    await ask(t.sessionId);
    const r = await svc.chatTool({ botId: "b", sessionId: "session-chat", op: "message", args: { task: "GPU", text: "用英文吧" } });
    expect(r.text).toMatch(/^Passed to 「GPU 价格调研」\. It answers the task's open question; the task continues\./);
    await flush();
    expect(approvals.pendingForTask(t.id)).toEqual([]);
    expect(host.prompts.at(-1)!.text).toBe("[用户回答了你的问题]\n问题：报告用中文还是英文？\n回答：用英文吧");
    expect(runs(t.id).at(-1)).toEqual(["answer", "running", ""]);
  });

  it("重启：提问留着（不阻塞的不作废），不再推一遍；重启后回答照样开 run；阻塞的审批作废", async () => {
    const t = start();
    await flush();
    await ask(t.sessionId);
    const blocking = approvals.create({ kind: "approval", botId: "b", conversationId: "b:web:console", sessionId: "session-chat", tool: "bash", detail: "rm -rf x", reason: "" });
    svc.stop();
    approvals = new ApprovalCenter(store);
    approvals.start();
    approvals.stop();
    expect(store.getApproval(blocking.id)!.status).toBe("expired");
    svc = make();
    svc.start();
    const [q] = approvals.pendingForTask(t.id);
    expect(q.status).toBe("pending");
    expect(asks()).toHaveLength(1);
    expect(svc.get(t.id)!.stage.key).toBe("needs-you/answer");
    expect(reply("2").handled).toBe(true);
    await flush();
    expect(runs(t.id).at(-1)).toEqual(["answer", "running", ""]);
  });

  it("这一轮以 needs_you 结束、提问还没建就重启了：启动时补问一次", async () => {
    const t = start();
    await flush();
    const run = store.listRuns({ taskId: t.id })[0];
    svc.stop();
    store.updateRun(run.id, { state: "ended", outcome: "needs_you", endedAt: Date.now(), report: { state: "needs_you", summary: "", question: { question: "要几页？" }, at: Date.now() } });
    svc = make();
    svc.start();
    expect(approvals.pendingForTask(t.id).map((r) => [r.detail, r.runId])).toEqual([["要几页？", run.id]]);
    svc.stop();
    svc = make();
    svc.start();
    expect(approvals.pendingForTask(t.id)).toHaveLength(1);
  });

  it("停止任务：它的提问作废，同一会话的下一个提问推出去", async () => {
    host.settingsValue = normalizeSettings({ taskSlots: 4 });
    const a = start("A 任务");
    const b = start("B 任务");
    await flush();
    await ask(a.sessionId);
    await ask(b.sessionId);
    const qa = approvals.pendingForTask(a.id)[0];
    expect(asks()).toHaveLength(1);
    await svc.stopTask(a.id, "test");
    expect(store.getApproval(qa.id)).toMatchObject({ status: "cancelled", decidedBy: "stopped" });
    expect(asks()).toHaveLength(2);
    expect(svc.get(a.id)!.stage.key).toBe("stopped");
  });

  it("任务会话里的审批：推到会话（带任务名）；最后一条消息是它时光回 y 也行；等批准时让出名额", async () => {
    host.settingsValue = normalizeSettings({ taskSlots: 1 });
    const t = start();
    await flush();
    const runId = store.listRuns({ taskId: t.id })[0].id;
    const a = approvals.create({ kind: "approval", botId: "b", conversationId: CONV, sessionId: t.sessionId, tool: "bash", detail: "rm -rf build/", reason: "", taskId: t.id, runId, ttlMs: 12 * 3600_000 });
    expect(svc.get(t.id)!.stage.key).toBe("needs-you/approval");
    expect(asks().map((r) => r.body.text)).toEqual([`需批准（任务「GPU 价格调研」）：\`rm -rf build/\` — 回复 y ${a.code} / n ${a.code}`]);
    // 名额：1 个，被等批准的 run 让出来了，第二个任务能开始
    const u = start("U");
    await flush();
    expect(runs(u.id)).toEqual([["launch", "running", ""]]);
    expect(reply("y")).toEqual({ handled: true, ack: `✅ 已批准 ${a.code}（仅本次）` });
    expect(store.getApproval(a.id)!.status).toBe("allowed");
    expect(svc.get(t.id)!.stage.key).toBe("working");
  });

  it("飞书：提问是带选项按钮的卡片，回复在请求那条消息下", async () => {
    const fs1 = store.ensureConversation("b", "feishu", "oc_1", "主人");
    store.addMessage(fs1.id, "user", "后台调研一下 GPU 价格");
    store.setKV(`reply-to:${fs1.id}`, JSON.stringify({ messageId: "om_req", chatId: "oc_1" }));
    const f = svc.create({ botId: "b", conversationId: fs1.id, title: "GPU", brief: "" }).task!;
    await flush();
    await ask(f.sessionId);
    const row = asks()[0];
    expect(row).toMatchObject({ channel: "feishu", kind: "card", replyTo: "om_req", peerId: "oc_1" });
    expect(JSON.stringify(row.body.card)).toContain("「GPU」想问你");
    const q = approvals.pendingForTask(f.id)[0];
    expect(JSON.stringify(row.body.card)).toContain(JSON.stringify({ amb: "question", id: q.id, option: "2" }));
  });

  it("网页：提问不进出站队列（卡片就在对话里）", async () => {
    const web = store.ensureConversation("b", "web", "console", "控制台");
    store.addMessage(web.id, "user", "后台整理发票");
    const w = svc.create({ botId: "b", conversationId: web.id, title: "发票", brief: "" }).task!;
    await flush();
    await ask(w.sessionId);
    expect(asks()).toEqual([]);
    expect(approvals.pending(web.id).map((r) => r.taskId)).toEqual([w.id]);
  });

  it("「需要你」里任务的那一份：失败的（重试、停止）；没送到的不在这里（出站队列那一份）；重试开一个 retry run", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, () => void report(t.sessionId, "failed", "X 云的价格页要登录"));
    const [item] = svc.attention();
    expect(item).toMatchObject({ id: `task:${t.id}`, kind: "failed", botName: "小蓝", subject: "GPU 价格调研", status: "失败", line: "X 云的价格页要登录", severity: "err", actions: ["retry", "stop"], channel: "weixin" });
    expect((await svc.retry(t.id)).how).toBe("resumed");
    await flush();
    expect(runs(t.id).at(-1)).toEqual(["retry", "running", ""]);
    expect(host.prompts.at(-1)!.text).toBe("[用户让你再试一次]\n上次没做完：X 云的价格页要登录");
    expect(svc.attention()).toEqual([]);
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    store.updateOutbox(store.latestRun(t.id)!.delivery, { status: "gone", error: "窗口关了" });
    expect(svc.get(t.id)!.stage.key).toBe("needs-you/delivery");
    expect(svc.attention()).toEqual([]);
    // 在「需要你」里点了不再提示（出站队列记作看过）：任务回到已完成
    store.updateOutbox(store.latestRun(t.id)!.delivery, { seenAt: Date.now() });
    expect(svc.get(t.id)!.stage.key).toBe("ready");
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

  it("追加不经聊天代理（微信）：引用推出去的结果（带「引用这条消息可以继续问。」）或失败那句就交给任务，在同一任务里接着做；对不上的是普通聊天；停了的照旧", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, () => void report(t.sessionId, "done", "GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800"));
    const row = store.listOutbox({ limit: 50 })[0];
    expect(row.body).toMatchObject({ text: "GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800", hint: "引用这条消息可以继续问。" });
    const sent = sentText(row.body);
    expect(sent).toBe("GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800。引用这条消息可以继续问。");
    // 会话历史里只有结果本身
    expect(store.listMessages(CONV).at(-1)!.content).toBe(row.body.text);
    // 引用了别的、没有引用、只是个命令：普通聊天
    expect(svc.followUp(CONV, { text: "改成英文", quote: "下午 3 点的会是线上的" })).toEqual({ handled: false });
    expect(svc.followUp(CONV, { text: "改成英文" })).toEqual({ handled: false });
    expect(svc.followUp(CONV, { text: "/status", quote: sent })).toEqual({ handled: false });
    // 引用结果（被截短、前面带名字也认得）：交给任务，回一句收到
    expect(svc.followUp(CONV, { text: "改成英文", quote: `小蓝: ${sent.slice(0, 20)}…` })).toEqual({ handled: true, ack: "收到，「GPU 价格调研」继续。" });
    await flush();
    expect(runs(t.id)).toEqual([
      ["launch", "ended", "done"],
      ["followup", "running", ""],
    ]);
    expect(host.prompts.at(-1)).toMatchObject({ sessionId: t.sessionId, text: "[用户追加]\n改成英文", resume: true });
    // 失败那句也认（它不带提示：失败那句本来就说了怎么办）
    await turn(t.sessionId, () => void report(t.sessionId, "failed", "英文版的价格页打不开"));
    const fail = store.listOutbox({ limit: 50 }).find((r) => r.id.includes(":failure:"))!;
    expect(fail.body.hint).toBeUndefined();
    expect(svc.followUp(CONV, { text: "试试这个链接", quote: fail.body.text })).toEqual({ handled: true, ack: "收到，「GPU 价格调研」继续。" });
    await flush();
    expect(runs(t.id).at(-1)).toEqual(["followup", "running", ""]);
    expect(host.prompts.at(-1)!.text).toBe("[用户追加]\n试试这个链接");
    // 停了的：照旧说不能再追加，不开 run
    await svc.stopTask(t.id, "web");
    expect(svc.followUp(CONV, { text: "再试一次", quote: sent })).toEqual({ handled: true, ack: "「GPU 价格调研」已停止，不能再追加；需要的话开个新任务。" });
    await flush();
    expect(runs(t.id).at(-1)).toEqual(["followup", "ended", "stopped"]);
    expect(store.listRuns({ taskId: t.id })).toHaveLength(3);
  });

  it("追加不经聊天代理：引用合成的摘要（不止一个任务）是普通聊天；结果连提示一起不超过 300 字", async () => {
    host.settingsValue = normalizeSettings({ taskSlots: 8 });
    const a = start("A");
    const b = start("B");
    await flush();
    await turn(a.sessionId, () => void report(a.sessionId, "done", "A 做好了，在 a.md"));
    await turn(b.sessionId, () => void report(b.sessionId, "done", "B 做好了，在 b.md"));
    expect(svc.followUp(CONV, { text: "详细说说", quote: "2 个后台任务：\n· A 做好了，在 a.md\n· B 做好了，在 b.md" })).toEqual({ handled: false });
    // 「你不在时」合成的一条里只有一个任务：认得出
    expect(svc.followUp(CONV, { text: "详细说说", quote: "你不在时：A 做好了，在 a.md" })).toEqual({ handled: true, ack: "收到，「A」继续。" });
    // 两句结果后半句一样（开头的「D：」也像个名字）：取最像的那个
    const d = start("D");
    const e = start("E");
    await flush();
    await turn(d.sessionId, () => void report(d.sessionId, "done", "D：调研好了，结论在 notes.md。"));
    await turn(e.sessionId, () => void report(e.sessionId, "done", "E：调研好了，结论在 notes.md。"));
    const dRow = store.listOutbox({ limit: 50 }).find((r) => r.ref === `task:${d.id}`)!;
    expect(svc.followUp(CONV, { text: "加上 H100", quote: sentText(dRow.body) })).toEqual({ handled: true, ack: "收到，「D」继续。" });
    const c = start("C");
    await flush();
    await turn(c.sessionId, () => void report(c.sessionId, "done", "长".repeat(400)));
    const row = store.listOutbox({ limit: 50 }).find((r) => r.ref === `task:${c.id}`)!;
    expect(sentText(row.body).length).toBeLessThanOrEqual(300);
    expect(sentText(row.body)).toMatch(/长…引用这条消息可以继续问。$/);
  });

  it("追加不经聊天代理（飞书）：发在请求那条消息的回复链里（回复结果、回复请求）就交给任务；结果带「回复这条消息可以继续问。」", async () => {
    const fs1 = store.ensureConversation("b", "feishu", "oc_1", "主人");
    store.addMessage(fs1.id, "user", "后台调研一下 GPU 价格");
    store.setKV(`reply-to:${fs1.id}`, JSON.stringify({ messageId: "om_req", chatId: "oc_1" }));
    const f = svc.create({ botId: "b", conversationId: fs1.id, title: "GPU", brief: "" }).task!;
    await flush();
    await turn(f.sessionId, () => void report(f.sessionId, "done", "GPU 好了"));
    const row = store.listOutbox({ limit: 50 })[0];
    expect([row.replyTo, row.body.text, row.body.hint]).toEqual(["om_req", "GPU 好了", "回复这条消息可以继续问。"]);
    expect(svc.followUp(fs1.id, { text: "加上 H100", rootId: "om_other", parentId: "om_other2" })).toEqual({ handled: false });
    expect(svc.followUp(fs1.id, { text: "加上 H100" })).toEqual({ handled: false });
    // 回复结果：回复链的根是请求那条
    expect(svc.followUp(fs1.id, { text: "加上 H100", rootId: "om_req", parentId: "om_result" })).toEqual({ handled: true, ack: "收到，「GPU」继续。" });
    await flush();
    expect(host.prompts.at(-1)).toMatchObject({ sessionId: f.sessionId, text: "[用户追加]\n加上 H100", resume: true });
    // 直接回复请求那条也一样（在跑：并进这一轮）
    svc.onEvent("b", f.sessionId, status(f.sessionId, "running"));
    expect(svc.followUp(fs1.id, { text: "再加上 L40S", parentId: "om_req" })).toEqual({ handled: true, ack: "收到，「GPU」继续。" });
    await flush();
    expect(host.steers.at(-1)).toMatchObject({ sessionId: f.sessionId, text: "[用户追加]\n再加上 L40S" });
    // 建任务时会话里还没收到过飞书消息：结果直接发到会话，不带提示（回复链认不出是哪个任务）
    const fs2 = store.ensureConversation("b", "feishu", "oc_2", "主人");
    store.addMessage(fs2.id, "user", "后台整理发票");
    const g = svc.create({ botId: "b", conversationId: fs2.id, title: "发票", brief: "" }).task!;
    await flush();
    await turn(g.sessionId, () => void report(g.sessionId, "done", "发票好了"));
    const notice = store.listOutbox({ limit: 50 }).find((r) => r.ref === `task:${g.id}`)!;
    expect([notice.kind, notice.body.hint]).toEqual(["notice", undefined]);
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

  it("3c：结果留着等对方在微信里发消息、一直发不出去、合进的摘要留着：未送达；排着等早上的：已完成", async () => {
    const t = start();
    await flush();
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    const id = store.listRuns({ taskId: t.id })[0].delivery;
    const stage = () => svc.get(t.id)!.stage.key;
    store.updateOutbox(id, { status: "scheduled", due: Date.now() + 8 * 3600_000 });
    expect(stage()).toBe("ready");
    store.updateOutbox(id, { status: "held", reason: "window_closed" });
    expect(stage()).toBe("needs-you/delivery");
    store.updateOutbox(id, { status: "pending", attempts: 3 });
    expect(stage()).toBe("needs-you/delivery");
    store.insertOutbox({ id: "digest", botId: "b", channel: "weixin", conversationId: CONV, peerId: "owner", kind: "text", body: { text: "2 个后台任务：…" }, replyTo: "", due: 0, createdAt: 0, expiresAt: Date.now() + 3600_000, status: "held" });
    store.updateOutbox(id, { status: "merged", mergedInto: "digest" });
    expect(stage()).toBe("needs-you/delivery");
    store.updateOutbox("digest", { status: "sent" });
    expect(stage()).toBe("ready");
  });

  it("3c：进行中的任务给微信留 1 条配额，续期提醒里也算；task_start 的 anytime 让结果不受免打扰限制", async () => {
    const delivery = new Delivery({ store, outbox });
    svc.stop();
    svc = new TaskService({ store, host, delivery, defaultModel: () => "mock-model", retryDelaysMs: [5, 5, 5], maxBackground: 4 });
    svc.start();
    const t = start();
    await flush();
    const peer = { botId: "b", channel: "weixin", peerId: "owner", conversationId: CONV };
    expect(delivery.reserved("b", "weixin", "owner")).toBe(1);
    expect(delivery.upcoming(peer, Date.now())).toEqual([{ label: "GPU 价格调研", kind: "task" }]);
    await turn(t.sessionId, () => void report(t.sessionId, "done", "好了"));
    expect(delivery.reserved("b", "weixin", "owner")).toBe(0);
    store.setAgentSession(CONV, "b", "chat-1");
    const r = await svc.chatTool({ botId: "b", sessionId: "chat-1", op: "start", args: { title: "夜里也要", brief: "做完马上告诉我", anytime: true } });
    expect(r.error ?? "").toBe("");
    const night = store.listTasks({ conversationId: CONV }).find((x) => x.title === "夜里也要")!;
    expect(night.anytime).toBe(true);
    expect(store.getTask(t.id)!.anytime).toBe(false);
  });

  it("3b + 3c：任务的提问按主动消息的规则推（免打扰时排到早上）；没回答前给微信多留 1 条配额；在桌面上回答了，排着的那条撤回", async () => {
    // 主人的时区 23:00，主人 10 分钟内没说过话：在免打扰里
    const at = Date.UTC(2026, 10, 6, 23, 0);
    const delivery = new Delivery({ store, outbox, timeZone: "UTC", now: () => at });
    svc.stop();
    svc = new TaskService({ store, host, delivery, approvals, defaultModel: () => "mock-model", retryDelaysMs: [5, 5, 5], maxBackground: 4 });
    svc.start();
    const t = start();
    await flush();
    await ask(t.sessionId);
    const [row] = asks();
    expect(row).toMatchObject({ kind: "text", status: "scheduled", purpose: "question", reason: "quiet_hours", due: Date.UTC(2026, 10, 7, 8, 0), subject: "GPU 价格调研", ref: `task:${t.id}` });
    expect(row.body.raw).toBe(true);
    // 排着的提问 1 条 + 待答的提问 1 条（任务在等回答，不算进行中）
    expect(delivery.reserved("b", "weixin", "owner")).toBe(2);
    const [q] = approvals.pendingForTask(t.id);
    expect(approvals.answerText(q.id, "2", "web")).toBe(true);
    await flush();
    // 早上不会再问一个已经回答了的问题；也不算没送到
    expect(store.getOutbox(row.id)).toMatchObject({ status: "gone", error: "已回答" });
    expect(store.getOutbox(row.id)!.seenAt).toBeGreaterThan(0);
    expect(svc.get(t.id)!.stage.group).toBe("working");
    expect(delivery.reserved("b", "weixin", "owner")).toBe(1);
  });

  it("任务会话里阻塞着的审批：阶段是等你批准", async () => {
    const t = start();
    await flush();
    store.insertApproval({ id: "a1", code: "1234", kind: "approval", botId: "b", conversationId: CONV, sessionId: t.sessionId, tool: "bash", detail: "rm -rf build", reason: "", payload: "", createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    expect(svc.get(t.id)!.stage.key).toBe("needs-you/approval");
    // 子代理里的（会话 id 不同，记着任务）也算
    store.decideApproval("a1", "allowed", "t");
    store.insertApproval({ id: "a2", code: "1235", kind: "approval", botId: "b", conversationId: CONV, sessionId: "sub-1", tool: "bash", detail: "rm -rf build", reason: "", payload: "", createdAt: Date.now(), expiresAt: Date.now() + 60_000, taskId: t.id });
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

describe("追加不经聊天代理：渠道 → runtime.interceptReply → 任务", () => {
  it("飞书事件带上回复链（root_id、parent_id）；发在任务请求那条消息下的不进聊天，交给任务，回一句收到；别的照常进聊天", async () => {
    const raw = { event_id: "e1", sender: { sender_id: { open_id: "ou_1" } }, message: { message_id: "om_2", root_id: "om_req", parent_id: "om_res", chat_id: "oc_1", chat_type: "p2p", message_type: "text", content: '{"text":"hi"}', create_time: "1" } };
    expect(messageEventOf(raw)).toMatchObject({ messageId: "om_2", chatId: "oc_1", senderOpenId: "ou_1", rootId: "om_req", parentId: "om_res" });
    expect(messageEventOf({ message: { message_id: "om_3", chat_id: "oc_1" } })).not.toHaveProperty("rootId");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-tasks-follow-"));
    const store = new Store(":memory:");
    store.createBot({ id: "b", name: "小蓝" });
    const host = new FakeHost(ws);
    const outbox = new Outbox(store);
    const approvals = new ApprovalCenter(store);
    const svc = new TaskService({ store, host, delivery: new Delivery({ store, outbox }), approvals, defaultModel: () => "m", retryDelaysMs: [5, 5, 5] });
    svc.start();
    const conv = store.ensureConversation("b", "feishu", "oc_1", "主人");
    store.addMessage(conv.id, "user", "后台调研一下 GPU 价格");
    store.setKV(`reply-to:${conv.id}`, JSON.stringify({ messageId: "om_req", chatId: "oc_1" }));
    const task = svc.create({ botId: "b", conversationId: conv.id, title: "GPU", brief: "" }).task!;
    await flush();
    const agent = { available: true, approvals, tasks: svc, turnsInProgress: new Map(), canSteer: () => false } as unknown as AgentManager;
    const rt = new BotRuntime({ store, models: {} as any, defaultModel: () => "m", contextMessages: 20, contextChars: 20_000, agent });
    const chats: string[] = [];
    rt.handle = async (ev) => void chats.push(ev.id);
    const fake = new FakeFeishu();
    const ch = new FeishuChannel("b", fake, rt, new KeyedQueue(), 0, outbox);
    outbox.start();
    try {
      await ch.start();
      fake.onMessage!(feishuEvent("加上 H100", { messageId: "om_f1", chatId: "oc_1", rootId: "om_req", parentId: "om_res" }));
      await ch.idle();
      await flush();
      expect(chats).toEqual([]);
      expect(fake.calls.filter((c) => c.op === "text").map((c) => c.args.slice(0, 2))).toEqual([["om_f1", "收到，「GPU」继续。"]]);
      expect(host.prompts.at(-1)).toMatchObject({ sessionId: task.sessionId, text: "[用户追加]\n加上 H100" });
      // 不在回复链里：照常进聊天
      fake.onMessage!(feishuEvent("你好", { messageId: "om_f2", chatId: "oc_1" }));
      await ch.idle();
      expect(chats).toEqual(["om_f2"]);
    } finally {
      await ch.stop();
      await outbox.stop();
      svc.stop();
      store.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
