/** 代理回合的活动记录：DSH 事件 → 步骤；/status、排队提示、中止消息里的说法。 */
import { describe, it, expect } from "vitest";
import { ActivityLog, describeStep, fmtSecs, type ActivityStep } from "../src/agent/activity.js";
import { TurnStopped } from "../src/agent/host.js";
import { busyLine, turnFailedText } from "../src/core/runtime.js";

const T0 = 1_800_000_000_000;

/** 一轮真实形状的事件（取自 DSH 的 session.event）：模型要求跑 bash → 工具结果 → 模型作答 */
function toolTurn(log: ActivityLog) {
  log.apply("turn/start", { turn: 1 }, T0);
  log.apply("step/start", { turn: 1, step: 1 }, T0 + 10);
  expect(log.last!.title).toBe("模型");
  log.apply("request/context", { provider: "magpie", model: "grok-4.7", contextWindow: 128000 }, T0 + 20);
  expect(log.last!.title).toBe("grok-4.7");
  log.apply(
    "assistant/message",
    {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [{ type: "reasoning", text: "先看看目录" }, { type: "tool-call", id: "call_1", name: "bash", arguments: '{"description":"list","command":"ls -la\\n  src"}' }], source: { model: "grok-4.7" } },
      usage: { inputTokens: 1200, outputTokens: 30 },
    },
    T0 + 2010,
  );
  log.apply("tool/call", { turn: 1, step: 1, callId: "call_1", name: "bash", arguments: '{"description":"list","command":"ls -la\\n  src"}' }, T0 + 2020);
  log.apply("job/registered", { jobId: "j" }, T0 + 2030);
  log.apply("tool/result", { turn: 1, step: 1, message: { toolCallId: "call_1", content: [{ type: "text", text: "a.ts\nb.ts\n" }], isError: false } }, T0 + 2520);
  log.apply("step/end", { turn: 1, step: 1 }, T0 + 2530);
  log.apply("step/start", { turn: 1, step: 2 }, T0 + 2540);
  log.apply("assistant/message", { turn: 1, step: 2, message: { role: "assistant", content: [{ type: "text", text: "两个文件：\na.ts 和 b.ts" }], source: { model: "grok-4.7" } }, usage: { inputTokens: 1300, outputTokens: 12 } }, T0 + 3540);
  log.apply("turn/end", { turn: 1, reason: { kind: "completed" } }, T0 + 3550);
}

describe("ActivityLog", () => {
  it("folds a tool turn into model / tool / model steps with timings, tokens, args and output", () => {
    const changes: ActivityStep[] = [];
    const log = new ActivityLog((s) => changes.push(s));
    toolTurn(log);
    expect(log.steps.map((s) => [s.kind, s.title, s.status, s.ms])).toEqual([
      ["model", "grok-4.7", "ok", 2000],
      ["tool", "bash", "ok", 500],
      ["model", "grok-4.7", "ok", 1000],
    ]);
    const [m1, tool, m2] = log.steps;
    expect(m1).toMatchObject({ summary: "调用 bash", tokens: { input: 1200, output: 30 } });
    expect(m1.output).toContain("[思考]\n先看看目录");
    expect(tool).toMatchObject({ id: "call_1", summary: "ls -la src", output: "a.ts\nb.ts\n" });
    expect(JSON.parse(tool.input!)).toEqual({ description: "list", command: "ls -la\n  src" });
    expect(m2.summary).toBe("两个文件： a.ts 和 b.ts");
    // 每次新增或更新都通知一次，拿到的是副本
    expect(changes.filter((s) => s.id === "call_1").map((s) => s.status)).toEqual(["running", "ok"]);
    changes[0].title = "changed";
    expect(log.steps[0].title).toBe("grok-4.7");
  });

  it("progress: retries are not progress (the watchdog keeps counting); everything else is", () => {
    const log = new ActivityLog();
    expect(log.apply("step/start", { turn: 1, step: 1 }, T0)).toBe(true);
    expect(log.apply("llm/retry", { retryId: "r1", turn: 1, step: 1, retry: 2, maxRetries: 5, delayMs: 4000, failure: { code: "rate_limited", message: "HTTP 429 Too Many Requests" } }, T0 + 5)).toBe(false);
    expect(log.apply("llm/retry-started", { retryId: "r1", retry: 2 }, T0 + 4005)).toBe(false);
    expect(log.last).toMatchObject({ kind: "retry", status: "error", summary: "第 2/5 次，4 秒后：HTTP 429 Too Many Requests" });
    expect(describeStep(log.last!)).toBe("模型请求失败，正在重试（第 2/5 次，4 秒后：HTTP 429 Too Many Requests）");
    expect(log.apply("agent/inbox/spliced", {}, T0 + 4010)).toBe(true);
  });

  it("turn errors and external stops close the running steps", () => {
    const log = new ActivityLog();
    log.apply("step/start", { turn: 3, step: 1 }, T0);
    log.apply("tool/call", { callId: "c", name: "read", arguments: '{"file_path":"x.md"}' }, T0 + 10);
    log.apply("turn/end", { turn: 3, reason: { kind: "error", error: { message: "HTTP 400 image input not supported" } } }, T0 + 50);
    expect(log.steps.map((s) => [s.kind, s.status])).toEqual([["model", "error"], ["tool", "error"], ["error", "error"]]);
    expect(log.last!.summary).toBe("HTTP 400 image input not supported");

    const stopped = new ActivityLog();
    stopped.apply("step/start", { turn: 1, step: 1 }, T0);
    stopped.end("用户中止", T0 + 90_000);
    expect(stopped.steps).toMatchObject([{ kind: "model", status: "error", cut: true, ms: 90_000 }, { kind: "error", title: "已中止", summary: "用户中止" }]);
    expect(describeStep(stopped.steps[0])).toBe("等待 模型 回复");
  });

  it("subagents and compaction become their own steps; unknown tool results are ignored", () => {
    const log = new ActivityLog();
    log.apply("subagent/started", { parentSessionId: "p", childSessionId: "k" }, T0);
    log.apply("compaction/start", {}, T0 + 1);
    log.apply("compaction/end", {}, T0 + 101);
    log.apply("subagent/finished", { childSessionId: "k", status: "ok", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "查完了" }] }, T0 + 500);
    log.apply("tool/result", { message: { toolCallId: "nope", content: [] } }, T0 + 600);
    expect(log.steps.map((s) => [s.kind, s.status, s.ms, s.summary])).toEqual([
      ["subagent", "ok", 500, "查完了"],
      ["compact", "ok", 100, undefined],
    ]);
  });

  it("keeps the newest steps and clips long arguments and output", () => {
    const log = new ActivityLog();
    for (let i = 0; i < 130; i++) log.apply("tool/call", { callId: `c${i}`, name: "bash", arguments: JSON.stringify({ command: "x".repeat(5000) }) }, T0 + i);
    log.apply("tool/result", { message: { toolCallId: "c129", content: [{ type: "text", text: "y".repeat(10_000) }] } }, T0 + 200);
    expect(log.steps).toHaveLength(120);
    expect(log.steps[0].id).toBe("c10");
    expect(log.last!.input!.length).toBeLessThanOrEqual(1000);
    expect(log.last!.output!.length).toBeLessThanOrEqual(2000);
    expect(log.last!.summary!.length).toBeLessThanOrEqual(120);
  });
});

describe("what the user is told", () => {
  const step = (s: Partial<ActivityStep>): ActivityStep => ({ id: "x", kind: "tool", title: "bash", status: "running", at: Date.now(), ...s });

  it("fmtSecs", () => {
    expect([fmtSecs(400), fmtSecs(12_000), fmtSecs(180_000), fmtSecs(1_315_000)]).toEqual(["0 秒", "12 秒", "3 分钟", "21 分 55 秒"]);
  });

  it("/status busy line: how long, how many steps, what it is doing now, how long without progress", () => {
    const now = Date.now();
    const line = busyLine(now - 1_315_000, now - 400_000, [step({ kind: "model", title: "grok-4.7", status: "ok" }), step({ summary: "npm test", at: now - 400_000 })]);
    expect(line).toBe("本会话上一条消息还在处理（已 21 分 55 秒，2 步，现在：正在运行 bash：npm test，6 分 40 秒没有新进展），新消息会排在它后面。发送 /stop 可以中止");
    expect(busyLine(now - 5_000, 0, [])).toBe("本会话上一条消息还在处理（已 5 秒，还在等代理进程接手），新消息会排在它后面。发送 /stop 可以中止");
  });

  it("stopped / idle / timeout / restarted / other failures", () => {
    const steps = [step({ kind: "model", title: "grok-4.7", status: "error", cut: true }), step({ kind: "error", title: "已中止", status: "error" })];
    expect(turnFailedText(new TurnStopped("user", 95_000), steps)).toBe("已中止（处理了 1 分 35 秒）。代理进程已重启，可以继续发消息。");
    expect(turnFailedText(new TurnStopped("idle", 600_000), steps)).toBe("⚠️ 代理 10 分钟没有任何进展，已自动中止并重启代理进程。卡在：等待 grok-4.7 回复。可以重新发送，或用 /model 换个模型试试。");
    expect(turnFailedText(new TurnStopped("timeout", 1_800_000), [step({ summary: "npm test", status: "ok" })])).toBe("⚠️ 这条消息处理超过了 30 分钟的上限，已中止并重启代理进程。最后一步：bash：npm test（完成）。可以把任务拆小一点再发。");
    expect(turnFailedText(new TurnStopped("timeout", 1_800_000), [])).toBe("⚠️ 这条消息处理超过了 30 分钟的上限，已中止并重启代理进程。可以把任务拆小一点再发。");
    expect(turnFailedText(new Error("DeepSeek Harness runtime closed"), [])).toMatch(/^⚠️ 代理进程重启了/);
    expect(turnFailedText(new Error("boom"), [])).toBe("⚠️ 代理执行失败：boom");
  });
});
