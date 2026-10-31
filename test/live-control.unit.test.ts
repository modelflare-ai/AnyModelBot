/** 实时控制的零件：渠道队列让位、宿主 → 代理进程的指令通道（经 bridge）、后台命令与插话在活动记录里的样子、只算完整回答。 */
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { KeyedQueue } from "../src/core/queue.js";
import { AgentBridge } from "../src/agent/bridge.js";
import { ControlChannel } from "../src/agent/control.js";
import { ActivityLog, describeStep, promotedJob } from "../src/agent/activity.js";
import { answerText } from "../src/agent/host.js";
import { BotRuntime, STEER_ACK } from "../src/core/runtime.js";
import { Store } from "../src/store/db.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import type { AgentManager } from "../src/agent/manager.js";
import type { InboundEvent, OutboundOp } from "../src/core/types.js";
import { until } from "./helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("KeyedQueue: a task can give up its slot early", () => {
  it("the next task of the same key starts once the first releases; run() still resolves when the task ends", async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    let finishFirst!: () => void;
    const first = q.run("k", async () => {
      log.push("a+");
      const release = KeyedQueue.releaser();
      await sleep(10);
      release?.();
      await new Promise<void>((r) => (finishFirst = r));
      log.push("a-");
    });
    const second = q.run("k", async () => void log.push("b"));
    await second;
    expect(log).toEqual(["a+", "b"]);
    let firstDone = false;
    void first.then(() => (firstDone = true));
    await sleep(5);
    expect(firstDone).toBe(false);
    finishFirst();
    await first;
    expect(log).toEqual(["a+", "b", "a-"]);
  });

  it("outside a queued task there is nothing to release", () => {
    expect(KeyedQueue.releaser()).toBeUndefined();
  });
});

describe("control channel (host → amb-control plugin over the bridge)", () => {
  let bridge: AgentBridge | undefined;
  afterEach(async () => {
    await bridge?.stop();
    bridge = undefined;
  });
  const setup = async () => {
    const ch = new ControlChannel();
    bridge = new AgentBridge({ upstream: () => ({ baseUrl: "", apiKey: "" }), ask: async () => ({ id: "" }), wait: async () => ({}), cancel: async () => {}, control: { poll: (b, s) => ch.poll(b, s), result: (b) => ch.result(b) } });
    await bridge.start();
    const post = async (p: string, body: unknown, token = bridge!.token) =>
      fetch(bridge!.url + p, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ch, post };
  };

  it("a command reaches the waiting poll, its result comes back; nothing in either carries the bridge token", async () => {
    const { ch, post } = await setup();
    const id = ch.reset();
    expect(ch.connected).toBe(false);
    const polling = post("/dsh/control/poll", { botId: "b", controlId: id });
    await sleep(50);
    expect(ch.connected).toBe(true);
    const sent = ch.send("steer", { sessionId: "s1", text: "hi" }, 5000);
    const got = (await (await polling).json()) as any;
    expect(got.commands).toEqual([{ sessionId: "s1", text: "hi", id: expect.any(String), op: "steer" }]);
    expect(JSON.stringify(got)).not.toContain(bridge!.token);
    expect((await post("/dsh/control/result", { botId: "b", controlId: id, id: got.commands[0].id, ok: true, result: { accepted: true } })).status).toBe(200);
    expect(await sent).toEqual({ accepted: true });
  });

  it("queued commands wait for the next poll; a failed command rejects with the plugin's error", async () => {
    const { ch, post } = await setup();
    const id = ch.reset();
    const sent = ch.send("providers", {}, 5000);
    const got = (await (await post("/dsh/control/poll", { botId: "b", controlId: id })).json()) as any;
    expect(got.commands.map((c: any) => c.op)).toEqual(["providers"]);
    const failed = expect(sent).rejects.toThrow("llm-pi-ai entry not found");
    await post("/dsh/control/result", { botId: "b", controlId: id, id: got.commands[0].id, ok: false, error: "llm-pi-ai entry not found" });
    await failed;
  });

  it("a restarted child gets a new id: the old one's poll is told to stop, its pending commands fail at once", async () => {
    const { ch, post } = await setup();
    const old = ch.reset();
    const sent = ch.send("cancel", { sessionId: "s" }, 60_000);
    const fresh = ch.reset();
    await expect(sent).rejects.toThrow("代理进程已重启");
    expect(fresh).not.toBe(old);
    expect(await (await post("/dsh/control/poll", { botId: "b", controlId: old })).json()).toEqual({ stop: true });
    // 子进程退出：通道关闭，发不出去
    ch.close();
    await expect(ch.send("ping", {}, 1000)).rejects.toThrow("代理进程没有运行");
  });

  it("no answer within the timeout: the command fails and is not delivered later", async () => {
    const { ch, post } = await setup();
    const id = ch.reset();
    await expect(ch.send("ping", {}, 30)).rejects.toThrow("代理进程没有响应（ping）");
    const r = post("/dsh/control/poll", { botId: "b", controlId: id });
    await sleep(50);
    ch.close();
    expect(((await (await r).json()) as any).commands).toEqual([]);
  });

  it("requests without the bridge token are refused", async () => {
    const { ch, post } = await setup();
    const id = ch.reset();
    expect((await post("/dsh/control/poll", { botId: "b", controlId: id }, "wrong")).status).toBe(401);
  });
});

describe("activity: background commands and steered messages", () => {
  const T0 = 1_800_000_000_000;
  const promoted = (id: string) => ({ message: { toolCallId: "c1", content: [{ type: "text", text: `[still running after 30000ms; moved to background job ${id}]\nThe command keeps running in the background.` }], isError: false } });

  it("a command moved to the background gets its own step; it ends during the turn (job/settled) or is noted as still running", () => {
    expect(promotedJob(promoted("bash-1"))).toBe("bash-1");
    expect(promotedJob({ message: { content: [{ type: "text", text: "started background job bash-2" }] } })).toBeUndefined();
    const log = new ActivityLog();
    log.apply("tool/call", { callId: "c1", name: "bash", arguments: '{"command":"npm test"}' }, T0);
    log.apply("tool/result", promoted("bash-1"), T0 + 30_000);
    expect(log.steps.map((s) => [s.kind, s.title, s.status])).toEqual([
      ["tool", "bash", "ok"],
      ["job", "后台命令", "running"],
    ]);
    expect(describeStep(log.last!)).toBe("后台命令在运行：npm test");
    log.apply("job/settled", { jobId: "bash-1", status: "completed", detail: "exit code: 1", finishedAt: T0 + 50_000 }, T0 + 50_000);
    expect(log.last).toMatchObject({ kind: "job", status: "error", ms: 20_000, output: "exit code: 1" });

    const still = new ActivityLog();
    still.apply("tool/call", { callId: "c1", name: "bash", arguments: '{"command":"make"}' }, T0);
    still.apply("tool/result", promoted("bash-3"), T0 + 30_000);
    still.finish(T0 + 31_000);
    expect(still.last).toMatchObject({ kind: "job", status: "ok", summary: "make （回复时仍在后台运行）" });
  });

  it("the wake-up turn shows the job's end from DSH's notice; a steered message is a step of its own", () => {
    const log = new ActivityLog();
    log.apply("user/message", { role: "user", content: [{ type: "text", text: "background job bash-9 (bash: make) finished [status: completed, exit code: 0]. Read its output with job_output." }], source: { kind: "tool-jobs", form: "notice", summary: "bash make [status: completed]" } }, T0);
    expect(log.last).toMatchObject({ id: "j:bash-9", kind: "job", title: "后台命令结束", summary: "bash make [status: completed]", status: "ok" });
    log.apply("user/message", { role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }, T0 + 1);
    expect(log.steps).toHaveLength(1);
    log.apply("steer", { text: "also check the README" }, T0 + 2);
    expect(log.last).toMatchObject({ kind: "steer", title: "追加消息", summary: "also check the README", status: "ok" });
    expect(describeStep(log.last!)).toBe("收到追加消息：also check the README");
  });
});

describe("the reply of a turn", () => {
  it("only complete answers count: no tool calls, not interrupted", () => {
    const msg = (content: unknown[], extra = {}) => ({ message: { role: "assistant", content }, ...extra });
    expect(answerText(msg([{ type: "text", text: " done " }]))).toBe("done");
    expect(answerText(msg([{ type: "text", text: "let me look" }, { type: "tool-call", id: "c", name: "bash", arguments: "{}" }]))).toBe("");
    expect(answerText(msg([{ type: "text", text: "half" }], { interrupted: true }))).toBe("");
    expect(answerText(msg([{ type: "reasoning", text: "hmm" }]))).toBe("");
  });
});

describe("runtime: a message sent while an agent turn runs", () => {
  const ev = (text: string): InboundEvent => ({ id: Math.random().toString(36), channel: "web", botId: "b1", conversation: { kind: "dm", id: "console" }, sender: { id: "owner" }, parts: [{ type: "text", text }], replyHandle: {}, receivedAt: Date.now() });
  function setup(steerable: boolean) {
    const store = new Store(":memory:");
    store.createBot({ id: "b1", name: "测试" });
    const turns = new Map<string, any>();
    const steered: string[] = [];
    const finishers: Array<(v: unknown) => void> = [];
    let runs = 0;
    const agent = {
      available: true,
      host: () => ({ state: "running", workspace: os.tmpdir(), diagnostics: () => ({}) }),
      approvals: { bindSink: () => () => {}, handleReply: () => ({ handled: false }), pending: () => [] },
      turnsInProgress: turns,
      settings: () => ({ ...DEFAULT_SETTINGS, memory: { ...DEFAULT_SETTINGS.memory, enabled: false } }),
      memoryPrefix: () => "",
      takeSeed: () => "",
      canSteer: (conv: string) => steerable && turns.has(conv),
      steer: async (_bot: string, _conv: string, m: { text: string }) => (steered.push(m.text), true),
      runTurn: (_bot: string, input: any) => {
        runs++;
        turns.set(input.conversationId, { since: Date.now(), lastProgress: Date.now(), activity: { steps: [] } });
        input.observer?.onStart?.();
        return new Promise((r) => finishers.push(r)).finally(() => turns.delete(input.conversationId));
      },
      stopTurn: () => false,
    } as unknown as AgentManager;
    const models = { listModels: async () => ["m1"], streamChat: async () => "纯对话" };
    const rt = new BotRuntime({ store, models: models as any, defaultModel: () => "m1", contextMessages: 20, contextChars: 20_000, agent });
    const q = new KeyedQueue();
    const send = (text: string) => {
      const ops: OutboundOp[] = [];
      const done = q.run("web:b1:console", () => rt.handle(ev(text), { apply: async (op) => void ops.push(op) }));
      return { ops, done, texts: () => ops.filter((o): o is Extract<OutboundOp, { text: string }> => "text" in o).map((o) => o.text) };
    };
    const history = () => store.listMessages("b1:web:console").map((m) => [m.role, m.content]);
    return { rt, send, steered, finishers, runs: () => runs, history };
  }
  const reply = { text: "一起回答", sessionId: "S", files: [], usage: { tokens: 1, window: 10, maxTokens: 1 } };

  it("is steered into it: the channel queue gives way once the agent took the first, one reply, history in order", async () => {
    const s = setup(true);
    const a = s.send("第一条");
    await until(() => s.finishers.length === 1);
    const b = s.send("补充一句");
    await until(() => b.texts().length > 0);
    expect(b.texts()).toEqual([STEER_ACK]);
    expect(s.steered).toEqual(["补充一句"]);
    // 第二条等第一条的回合结束才算处理完（网页 live 登记里它一直在）
    let bDone = false;
    void b.done.then(() => (bDone = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(bDone).toBe(false);
    s.finishers[0](reply);
    await a.done;
    await b.done;
    expect(s.runs()).toBe(1);
    expect(a.texts().at(-1)).toBe("一起回答");
    expect(s.history()).toEqual([
      ["user", "第一条"],
      ["user", "补充一句"],
      ["assistant", "一起回答"],
    ]);
  });

  it("can't be steered (turn finishing, channel down): it waits and runs as its own turn afterwards", async () => {
    const s = setup(false);
    const a = s.send("第一条");
    await until(() => s.finishers.length === 1);
    const b = s.send("第二条");
    await new Promise((r) => setTimeout(r, 30));
    expect(s.runs()).toBe(1);
    s.finishers[0](reply);
    await a.done;
    await until(() => s.finishers.length === 2);
    s.finishers[1]({ ...reply, text: "第二个回答" });
    await b.done;
    expect(s.steered).toEqual([]);
    expect(s.history()).toEqual([
      ["user", "第一条"],
      ["assistant", "一起回答"],
      ["user", "第二条"],
      ["assistant", "第二个回答"],
    ]);
  });

  it("commands never steer: /model waits for the running turn", async () => {
    const s = setup(true);
    const a = s.send("第一条");
    await until(() => s.finishers.length === 1);
    const b = s.send("/help");
    await new Promise((r) => setTimeout(r, 30));
    expect(b.texts()).toEqual([]);
    s.finishers[0](reply);
    await a.done;
    await b.done;
    expect(b.texts()[0]).toMatch(/^可用命令/);
    expect(s.steered).toEqual([]);
  });
});
