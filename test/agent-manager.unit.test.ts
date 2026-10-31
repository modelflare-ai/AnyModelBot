/** AgentManager 的回合调度：上下文管家的压缩闸门、空闲看门狗。代理进程用桩代替（不起 DSH）。 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../src/store/db.js";
import { AgentManager } from "../src/agent/manager.js";
import { TurnStopped, type TurnInput } from "../src/agent/host.js";
import type { MediaModel, MediaService } from "../src/agent/media.js";
import { STEWARD_SYSTEM } from "../src/agent/steward.js";

const COMPACT = '{"action":"compact","reason":"still working"}';
const CONV = "b:web:console";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-mgr-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 第一回合上下文很大（管家会判定），之后都很小；judge 是管家判定的回答 */
function setup(judge: () => Promise<string> = async () => COMPACT) {
  const store = new Store(":memory:");
  store.createBot({ id: "b", name: "b" });
  store.ensureConversation("b", "web", "console");
  const mgr = new AgentManager({
    store,
    dataDir: dir,
    runtimeDir: "/rt",
    upstream: () => ({ baseUrl: "", apiKey: "" }),
    enabled: true,
    reviewDelayMs: 1e9,
    complete: async (_bot, _model, system) => (system === STEWARD_SYSTEM ? judge() : "交接便条"),
  });
  const host = mgr.host("b");
  let turns = 0;
  host.runTurn = async (input: TurnInput) => {
    turns++;
    let sid = store.getAgentSession(input.conversationId);
    if (!sid) store.setAgentSession(input.conversationId, "b", (sid = `S${turns}`));
    return { text: "ok", sessionId: sid, files: [], usage: { tokens: turns === 1 ? 190_000 : 2_000, window: 200_000, maxTokens: 32_000 } };
  };
  return {
    store,
    mgr,
    host,
    turns: () => turns,
    turn: () => mgr.runTurn("b", { conversationId: CONV, text: "hi", model: "m" }),
    steward: (body: Record<string, unknown>) => (mgr as any).stewardCall({ botId: "b", ...body }) as Promise<Record<string, unknown>>,
  };
}

/** 第一回合结束、管家判定"压缩"、插件来取判定：此后 DSH 在压缩 S1，下一回合要等它回报 */
async function compacting(s: ReturnType<typeof setup>) {
  await s.turn();
  expect(await s.steward({ sessionId: "S1", phase: "idle" })).toEqual({ compact: true });
}

/** 发一条消息：1 秒内应该交给代理 */
async function promptly(s: ReturnType<typeof setup>) {
  const before = s.turns();
  const p = s.turn();
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.turns(), "the turn is still waiting for a compaction that will never report").toBe(before + 1);
  await p;
}

describe("context steward: the compaction gate never outlives its compaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("waits for the plugin to report, then lets the next turn through", async () => {
    const s = setup();
    await compacting(s);
    const p = s.turn();
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.turns()).toBe(1);
    expect(await s.steward({ sessionId: "S1", phase: "done", result: "compacted" })).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.turns()).toBe(2);
    await p;
    await promptly(s);
  });

  it("/reset while compacting: the next turns do not wait, and a late report for the old session is harmless", async () => {
    const s = setup();
    await compacting(s);
    s.mgr.resetConversation(CONV);
    await promptly(s);
    expect(await s.steward({ sessionId: "S1", phase: "done", result: "compacted" })).toEqual({ ok: true });
    await promptly(s);
    await promptly(s);
  });

  it("/new while compacting: the new segment starts right away", async () => {
    const s = setup();
    await compacting(s);
    await s.mgr.newSegment("b", CONV, "m");
    expect(s.store.getAgentSession(CONV)).toBeUndefined();
    await promptly(s);
  });

  it("the plugin's report counts even after the conversation moved to another session", async () => {
    const s = setup();
    await compacting(s);
    s.store.setAgentSession(CONV, "b", "S9");
    expect(await s.steward({ sessionId: "S1", phase: "done", result: "compacted" })).toEqual({ ok: true });
    await promptly(s);
  });

  it("the agent process exits while compacting (/stop, idle watchdog, model change, crash): no more waiting", async () => {
    const s = setup();
    await compacting(s);
    const child = new EventEmitter();
    (s.host as any).watchChild(child);
    child.emit("exit", null, "SIGTERM");
    await promptly(s);
  });

  it("the plugin never reports: a turn waits at most until the 200 s cap, later turns not at all", async () => {
    const s = setup();
    await compacting(s);
    await vi.advanceTimersByTimeAsync(100_000);
    const p = s.turn();
    await vi.advanceTimersByTimeAsync(100_001);
    expect(s.turns()).toBe(2);
    await p;
    await promptly(s);
    await vi.advanceTimersByTimeAsync(300_000);
    await promptly(s);
  });

  it("a judgement the plugin gave up waiting for (120 s) sets no gate", async () => {
    let decide!: (v: string) => void;
    const s = setup(() => new Promise<string>((r) => (decide = r)));
    await s.turn();
    const idle = s.steward({ sessionId: "S1", phase: "idle" });
    await vi.advanceTimersByTimeAsync(120_001);
    expect(await idle).toEqual({ compact: false });
    decide(COMPACT);
    await vi.advanceTimersByTimeAsync(0);
    await promptly(s);
    expect(s.mgr.stewardLog.map((e) => e.action)).toEqual(["compact-skipped"]);
  });
});

/** 一条 DSH 会话事件通知 */
const ev = (sessionId: string, type: string, data: Record<string, unknown> = {}) => ({ method: "session.event", params: { sessionId, event: { type, data, time: Date.now() } } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IDLE = 600;
const VIDEO: MediaModel = { id: "v1", kind: "video", route: "videos", requiresReference: false, price: "", priority: 0 };

/**
 * 真的 AgentHost（会话事件经它的过滤送到看门狗），DSH 换成桩：run 按脚本发通知，返回最终回复。
 * 看门狗阈值 600 ms；生视频任务 2 秒。
 */
function setupHost(script: (emit: (n: any) => void, s: { mgr: AgentManager }) => Promise<string>) {
  const store = new Store(":memory:");
  store.createBot({ id: "b", name: "小蓝" });
  store.ensureConversation("b", "web", "console");
  const notices: string[] = [];
  const media = {
    prepare: async () => ({ kind: "video", model: VIDEO, default: VIDEO, candidates: [], all: [VIDEO], custom: false, summary: "" }),
    execute: async () => {
      await sleep(2000);
      return "已用 v1 生成视频，保存在工作区：media/video-20261031-120000.mp4。要发给用户，请用 present 工具交付这个文件。";
    },
  } as unknown as MediaService;
  const mgr = new AgentManager({ store, dataDir: dir, runtimeDir: "/rt", upstream: () => ({ baseUrl: "", apiKey: "" }), enabled: true, idleTimeoutMs: IDLE, media, onNotice: (t) => notices.push(t) });
  const host = mgr.host("b");
  const closed = new AbortController();
  const session = {
    id: "R",
    run: async (_prompt: unknown, o: { onNotification: (n: any) => void }) => ({ sessionId: "R", finalResponse: await script(o.onNotification, { mgr }), events: [] }),
    setWorkingDirectory: async () => undefined,
  };
  const harness = { client: {}, start: async () => undefined, session: () => session, resumeSession: async () => session, close: async () => void closed.abort() };
  // 启动时的默认路线就是 m（Chat Completions）：不用指令通道也能跑
  const route = { model: "m", provider: "magpie", api: "openai-completions", limits: { window: 128_000, maxTokens: 16_000 } };
  Object.assign(host as any, { harness, model: "m", sig: (host as any).settingsSig(), state: "running", initRoute: route, childRoutes: new Map([["magpie|m", route]]) });
  return {
    mgr,
    notices,
    /** 等到 DSH 桩被关掉为止（看门狗、/stop 都会关掉它） */
    hang: () => new Promise<string>((r) => closed.signal.addEventListener("abort", () => r(""))),
    turn: () => mgr.runTurn("b", { conversationId: CONV, text: "make a video", model: "m" }),
  };
}

/** 回合被看门狗中止所用的时间（毫秒） */
async function stoppedIdle(p: Promise<unknown>): Promise<number> {
  const t0 = Date.now();
  const e = await p.then(
    () => undefined,
    (e) => e,
  );
  expect(e).toBeInstanceOf(TurnStopped);
  expect(e.reason).toBe("idle");
  return Date.now() - t0;
}

describe("idle watchdog: long tool calls are work, a silent turn is still stopped", () => {
  it("a tool call that runs longer than the idle limit (a video, a long command) is not stopped", async () => {
    const s = setupHost(async (emit) => {
      emit(ev("R", "step/start", { turn: 1, step: 1 }));
      emit(ev("R", "tool/call", { callId: "c1", name: "generate_video", arguments: "{}" }));
      await sleep(2000);
      emit(ev("R", "tool/result", { message: { toolCallId: "c1", content: [], isError: false } }));
      emit(ev("R", "step/start", { turn: 1, step: 2 }));
      return "video ready";
    });
    expect((await s.turn()).text).toBe("video ready");
  });

  it("a subagent at work keeps the turn alive: its own events and its long tool calls count", async () => {
    const s = setupHost(async (emit) => {
      emit(ev("R", "step/start", { turn: 1, step: 1 }));
      emit(ev("R", "tool/call", { callId: "c1", name: "agent", arguments: "{}" }));
      emit(ev("R", "tool/result", { message: { toolCallId: "c1", content: [{ type: "text", text: "started subagent K" }], isError: false } }));
      emit({ method: "subagent.started", params: { parentSessionId: "R", childSessionId: "K" } });
      for (let i = 1; i <= 8; i++) {
        await sleep(150);
        emit(ev("K", "step/start", { turn: 1, step: i }));
      }
      emit(ev("K", "tool/call", { callId: "k1", name: "bash", arguments: '{"command":"make"}' }));
      await sleep(2000);
      emit(ev("K", "tool/result", { message: { toolCallId: "k1", content: [], isError: false } }));
      emit({ method: "subagent.finished", params: { parentSessionId: "R", childSessionId: "K", status: "ok" } });
      return "subagent done";
    });
    expect((await s.turn()).text).toBe("subagent done");
  });

  it("a generation job in flight counts as work even without a visible tool call", async () => {
    const s = setupHost(async (emit, { mgr }) => {
      emit(ev("R", "step/start", { turn: 1, step: 1 }));
      (mgr as any).mediaGrants.set(CONV, { kind: "video", model: "v1", at: Date.now() });
      const r = await (mgr as any).mediaOp({ botId: "b", sessionId: "R", op: "video", args: { prompt: "a cat" } });
      return r.text;
    });
    expect((await s.turn()).text).toMatch(/^已用 v1 生成视频/);
    expect(s.notices).toEqual([]);
  });

  it("a video that finishes after its turn was stopped is kept, and the user is told where it is", async () => {
    let finished!: () => void;
    const done = new Promise<void>((r) => (finished = r));
    const s = setupHost(async (emit, { mgr }) => {
      emit(ev("R", "step/start", { turn: 1, step: 1 }));
      emit(ev("R", "tool/call", { callId: "c1", name: "generate_video", arguments: "{}" }));
      (mgr as any).mediaGrants.set(CONV, { kind: "video", model: "v1", at: Date.now() });
      setTimeout(() => mgr.stopTurn(CONV), 300);
      await (mgr as any).mediaOp({ botId: "b", sessionId: "R", op: "video", args: { prompt: "a cat" } });
      finished();
      return "";
    });
    await expect(s.turn()).rejects.toMatchObject({ reason: "user" });
    await done;
    expect(s.notices).toEqual(["机器人「小蓝」生成的视频已保存在它的工作区（media/video-20261031-120000.mp4），但请求它的那条消息已经中止，没有发到聊天里。需要的话在对话里让机器人把它发出来。"]);
  });

  it("still stops a turn whose model request hangs after its tools finished", async () => {
    const s = setupHost(async (emit) => {
      emit(ev("R", "step/start", { turn: 1, step: 1 }));
      emit(ev("R", "tool/call", { callId: "c1", name: "bash", arguments: "{}" }));
      emit(ev("R", "tool/result", { message: { toolCallId: "c1", content: [], isError: false } }));
      emit(ev("R", "step/start", { turn: 1, step: 2 }));
      return s.hang();
    });
    expect(await stoppedIdle(s.turn())).toBeLessThan(5000);
  });

  it("still stops a turn whose subagent hangs on its model, or only retries it", async () => {
    for (const retry of [false, true]) {
      const s = setupHost(async (emit) => {
        emit(ev("R", "step/start", { turn: 1, step: 1 }));
        emit({ method: "subagent.started", params: { parentSessionId: "R", childSessionId: "K" } });
        emit(ev("K", "step/start", { turn: 1, step: 1 }));
        emit(ev("K", "tool/call", { callId: "k1", name: "bash", arguments: "{}" }));
        emit(ev("K", "tool/result", { message: { toolCallId: "k1", content: [], isError: false } }));
        emit(ev("K", "step/start", { turn: 1, step: 2 }));
        const hang = s.hang();
        if (retry) {
          const t = setInterval(() => emit(ev("K", "llm/retry", { retry: 1, maxRetries: 9, delayMs: 100 })), 100);
          void hang.then(() => clearInterval(t));
        }
        return hang;
      });
      expect(await stoppedIdle(s.turn())).toBeLessThan(5000);
    }
  });
});
