/** AgentManager 的回合调度：上下文管家的压缩闸门。代理进程用桩代替（不起 DSH）。 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../src/store/db.js";
import { AgentManager } from "../src/agent/manager.js";
import type { TurnInput } from "../src/agent/host.js";
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
