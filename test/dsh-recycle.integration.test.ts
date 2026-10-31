/**
 * 空闲时换掉开过很多会话的代理进程（SDK 关不掉会话，每次规则运行都开一个新的）：真实 DSH 子进程 + 脚本化的模型 + mock iLink。
 * 这里把门槛调成 3 个会话。开过的会话多了、完全空闲时换一个新的子进程：规则的运行都正常结束（没有被打断、没有重跑），
 * 不发任何消息，聊天照常；聊天会话还有后台命令在跑时不换，命令结束、醒来的那一轮回复发出去之后才换。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { locateDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { listen, mockIlink } from "./helpers.js";

const runtime = locateDshRuntime(findAppRoot());
const hasBwrap = fs.existsSync("/usr/bin/bwrap");

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
const textOf = (c: any): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).join("") : "");
type Step = { tool?: { name: string; args: any }; text?: string };

describe.skipIf(!runtime || !hasBwrap || process.platform !== "linux")("recycling the idle agent process (real DSH)", () => {
  const OWNER = "owner@im.wechat";
  const CONV = `default:weixin:${OWNER}`;
  let app: App;
  let dataDir: string;
  let llm: Awaited<ReturnType<typeof listen>>;
  let ilink: Awaited<ReturnType<typeof mockIlink>>;
  const env = process.env.AMB_DSH_RECYCLE_SESSIONS;

  /** 规则会话：报一句「没什么要说的」就结束；聊天：PING → PONG，JOB → 放一个后台命令，醒来时说 JOB-DONE */
  function plan(messages: any[], tools: string[]): Step {
    let last = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && !/^Current runtime context/.test(textOf(messages[i].content))) { last = i; break; }
    const user = textOf(messages[last]?.content);
    const done = messages.slice(last + 1).filter((m) => m.role === "tool").length;
    if (tools.includes("task_report")) return done ? { text: "已报告" } : { tool: { name: "task_report", args: { state: "done", summary: "X 还是 ¥259" } } };
    if (/background job/.test(user)) return { text: "JOB-DONE" };
    if (/JOB/.test(user)) return done ? { text: "JOB-STARTED" } : { tool: { name: "bash", args: { description: "run", command: "sleep 8 && echo job-done", run_in_background: true } } };
    const p = /PING (\w+)/.exec(user);
    return { text: p ? `PONG-${p[1]}` : "好的" };
  }

  beforeAll(async () => {
    process.env.AMB_DSH_RECYCLE_SESSIONS = "3";
    llm = await listen(async (req, res) => {
      const url = req.url?.split("?")[0] ?? "";
      if (url.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-agent", object: "model" }] }));
      const b = await body(req);
      const tools = (b.tools ?? []).map((t: any) => t.function?.name ?? t.name);
      const step: Step = b.tools ? plan(b.messages ?? [], tools) : { text: "标题" };
      if (!b.stream) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: step.text ?? "" }, finish_reason: "stop" }] }));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: any) => res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: b.model, ...o })}\n\n`);
      if (step.tool) {
        send({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_" + Math.random().toString(36).slice(2, 8), type: "function", function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        send({ choices: [{ index: 0, delta: { role: "assistant", content: step.text } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      res.end("data: [DONE]\n\n");
    });
    ilink = await mockIlink();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-recycle-"));
    app = new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_DEFAULT_MODEL: "mock-agent", AMB_AGENT_PREWARM: "0" } }), {
      printQrToTerminal: false,
      weixinPollTimeoutMs: 1000,
      deliveryLimits: { dailyCap: { weixin: 1000 }, coalesceMs: 0 },
    });
    app.store.createBot({ id: "default", name: "小蓝", weixinEnabled: true, settings: { avatar: "blue", quietHours: { enabled: false, from: "22:00", to: "08:00" } } as any });
    app.store.saveWeixinAccount({ botId: "default", botToken: "tok", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: OWNER });
    await app.start();
  }, 60_000);

  afterAll(async () => {
    if (env === undefined) delete process.env.AMB_DSH_RECYCLE_SESSIONS;
    else process.env.AMB_DSH_RECYCLE_SESSIONS = env;
    await app?.stop();
    await llm?.close();
    await ilink?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 60_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return;
    throw new Error("waitFor: timeout");
  };
  const sentTo = (text = "") => ilink.state.sent.filter((s) => s.to === OWNER && s.text.startsWith(text));
  const host = () => app.agent.host("default");
  let ruleId = "";
  /** 立即运行一次规则，等它跑完 */
  const runOnce = async () => {
    const before = app.store.ruleRuns(ruleId, { limit: 100 }).length;
    expect(app.tasks.runRuleNow(ruleId)).toEqual({});
    await waitFor(() => {
      const runs = app.store.ruleRuns(ruleId, { limit: 100 });
      return runs.length > before && runs[0].state === "ended";
    });
  };
  /** 等一会儿：要换的话这时已经换了 */
  const settle = () => new Promise((r) => setTimeout(r, 1500));

  it("after more than 3 rule sessions the idle child is replaced: every run ends done, nothing is sent, chat carries on", async () => {
    ilink.push(OWNER, "PING first");
    await waitFor(() => sentTo("PONG-first").length === 1);
    ruleId = app.tasks.createRule({ botId: "default", conversationId: CONV, title: "看 X 价格", instruction: "看看 X 的价格", schedule: { kind: "once", at: Date.now() + 7 * 86400_000, tz: "UTC" } }).rule!.id;
    const pid = host().pid;
    for (let i = 0; i < 3; i++) await runOnce();
    await settle();
    // 3 个还不到门槛
    expect([host().pid, host().recycles]).toEqual([pid, 0]);
    await runOnce();
    await waitFor(() => host().recycles === 1 && host().state === "running" && host().pid !== pid);
    expect(host().restarts).toBe(0);
    // 看不出来：每次运行都正常结束，没有被打断、重跑或跳过的；什么都没发给用户
    expect(app.store.ruleRuns(ruleId, { limit: 100 }).map((r) => [r.cause, r.outcome])).toEqual(Array(4).fill(["manual", "done"]));
    expect(sentTo()).toHaveLength(1);
    // 聊天照常（在新的进程里接着原来的会话），没有任何重启说明
    ilink.push(OWNER, "PING after");
    await waitFor(() => sentTo("PONG-after").length === 1);
    expect(sentTo().map((s) => s.text)).toEqual(["PONG-first", "PONG-after"]);
    // 新进程里重新计数
    await runOnce();
    await settle();
    expect(host().recycles).toBe(1);
    expect(host().diagnostics()).toMatchObject({ taskSessions: 1, recycles: 1 });
  }, 120_000);

  it("a chat's background job holds it: no recycle while the job runs; after the job's wake-up reply it goes", async () => {
    const pid = host().pid;
    ilink.push(OWNER, "JOB");
    await waitFor(() => sentTo("JOB-STARTED").length === 1);
    // 门槛早过了（新进程里第 2–5 个会话），但聊天会话的后台命令还在跑
    for (let i = 0; i < 4; i++) await runOnce();
    await settle();
    expect([host().pid, host().recycles]).toEqual([pid, 1]);
    // 命令结束：代理醒来、回复发出去，之后才换
    await waitFor(() => sentTo("JOB-DONE").length === 1, 30_000);
    await waitFor(() => host().recycles === 2 && host().state === "running" && host().pid !== pid);
    expect(host().restarts).toBe(0);
    expect(app.store.ruleRuns(ruleId, { limit: 100 }).every((r) => r.outcome === "done")).toBe(true);
    expect(sentTo().map((s) => s.text)).toEqual(["PONG-first", "PONG-after", "JOB-STARTED", "JOB-DONE"]);
  }, 120_000);
});
