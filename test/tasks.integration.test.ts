/**
 * 后台任务（3a）端到端：真实 DSH 子进程 + 脚本化的模型 + mock iLink（主人在微信里和自己的机器人聊）。
 * 退出演示：微信里说「调研 Y」，聊天代理开一个后台任务，聊天照常回答；任务跑完，结果经出站队列回到同一个微信会话、只发一次；
 * 任务跑到一半应用重启，带着恢复说明接着做，结果仍只发一次。另外：/stop 编号和界面的停止只停这个任务；
 * 两个任务在跑时，聊天消息不排在它们后面（人的通道）；收尾（后台命令）、没报告时的提醒、每种会话的工具。
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
type Step = { tool?: { name: string; args: any }; text?: string; hang?: boolean };

describe.skipIf(!runtime || !hasBwrap || process.platform !== "linux")("background tasks (real DSH, WeChat)", () => {
  const OWNER = "owner@im.wechat";
  const CONV = `default:weixin:${OWNER}`;
  let app: App;
  let dataDir: string;
  let llm: Awaited<ReturnType<typeof listen>>;
  let ilink: Awaited<ReturnType<typeof mockIlink>>;
  let base = "";
  /** 每个模型请求：工具名、用户消息、是不是任务会话 */
  const calls: Array<{ tools: string[]; users: string[]; task: boolean; at: number }> = [];
  const hung: http.ServerResponse[] = [];

  /** 脚本：聊天会话（没有 task_report）和任务会话（有）各自按最后一条带记号的用户消息走 */
  function plan(messages: any[], tools: string[]): Step {
    const task = tools.includes("task_report");
    // DSH 在用户消息后面插"Current runtime context"那条：跳过它
    let last = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && !/^Current runtime context/.test(textOf(messages[i].content))) { last = i; break; }
    const user = textOf(messages[last]?.content);
    const done = messages.slice(last + 1).filter((m) => m.role === "tool").length;
    if (!task) {
      const r = /RESEARCH (\w+)/.exec(user);
      if (r) return done ? { text: `ACK-${r[1]}：好，后台开始调研，好了告诉你，你可以继续聊别的。` } : { tool: { name: "task_start", args: { title: `调研 ${r[1]}`, brief: `research ${r[1]} and write notes.md` } } };
      const p = /PING (\w+)/.exec(user);
      if (p) return { text: `PONG-${p[1]}` };
      const l = /LISTTOOLS/.exec(user);
      if (l) return { text: `CHATTOOLS<<${tools.join(",")}>>` };
      return { text: "好的" };
    }
    // 任务会话：最近一条带记号的输入（第一条输入里是用户原话）
    const all = messages.map((m, i) => ({ i, role: m.role, text: textOf(m.content) }));
    const tag = /RESEARCH (\w+)/.exec(all.find((m) => m.role === "user" && /\[用户的原话\]/.test(m.text))?.text ?? "")?.[1] ?? "X";
    // at：这一轮里前面已经有几次工具调用（报告是第 at+1 个）
    const report = (message: string, at = 0): Step => (done > at ? { text: "已报告" } : { tool: { name: "task_report", args: { state: "done", summary: `notes for ${tag}`, message, files: tag.startsWith("FILE") ? ["notes.md"] : [] } } });
    if (/The app restarted while you were working/.test(user)) return report(`RECOVERED-${tag}：调研好了，结论在 notes.md。`);
    if (/^Report this task's state with task_report now/.test(user)) return report(`NUDGED-${tag}`);
    if (/^background job /.test(user)) return report(`BGRESULT-${tag}`);
    if (tag.startsWith("HANG")) return { hang: true };
    if (tag.startsWith("TOOLS")) return done ? { text: `TASKTOOLS` } : report(`TASKTOOLS-${tag}<<${tools.join(",")}>>`);
    if (tag.startsWith("QUIET")) return { text: "我做完了" }; // 不调用 task_report：宿主提醒一次
    if (tag.startsWith("BG")) return done ? { text: "后台命令在跑" } : { tool: { name: "bash", args: { description: "run", command: "sleep 2 && echo bg-done", run_in_background: true } } };
    // SLOW / FILE：跑一条几秒的命令写文件，再报告
    if (done === 0) return { tool: { name: "bash", args: { description: "run", command: `sleep 3 && pwd > notes.md && echo found-${tag} >> notes.md && cat notes.md` } } };
    return report(`RESULT-${tag}：调研好了，结论在 notes.md。`, 1);
  }

  const makeApp = () =>
    new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_DEFAULT_MODEL: "mock-agent", AMB_AGENT_PREWARM: "0" } }), {
      printQrToTerminal: false,
      weixinPollTimeoutMs: 1000,
    });

  beforeAll(async () => {
    llm = await listen(async (req, res) => {
      const url = req.url?.split("?")[0] ?? "";
      if (url.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-agent", object: "model" }] }));
      const b = await body(req);
      const tools = (b.tools ?? []).map((t: any) => t.function?.name ?? t.name);
      const step: Step = b.tools ? plan(b.messages ?? [], tools) : { text: "标题" };
      if (b.tools) calls.push({ tools, users: (b.messages ?? []).filter((m: any) => m.role === "user").map((m: any) => textOf(m.content)), task: tools.includes("task_report"), at: Date.now() });
      if (step.hang) return void hung.push(res);
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
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-tasks-"));
    app = makeApp();
    // 主人已经扫码登录；渠道连到 mock iLink
    app.store.createBot({ id: "default", name: "小蓝", weixinEnabled: true, settings: { avatar: "blue" } as any });
    app.store.saveWeixinAccount({ botId: "default", botToken: "tok", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: OWNER });
    await app.start();
    base = app.web!.url.replace(/\/+$/, "");
  }, 60_000);

  afterAll(async () => {
    for (const r of hung.splice(0)) r.destroy();
    await app?.stop();
    await llm?.close();
    await ilink?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const api = async (p: string, init?: RequestInit) => (await fetch(`${base}/amb/api${p}`, init)).json() as Promise<any>;
  const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 60_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return;
    throw new Error("waitFor: timeout");
  };
  /** 发给主人的、以这段文字开头的微信消息 */
  const sentTo = (text: string) => ilink.state.sent.filter((s) => s.to === OWNER && s.text.startsWith(text));
  const taskOf = (tag: string) => app.tasks.list({ conversationId: CONV, limit: 100 }).find((t) => t.title === `调研 ${tag}`);
  /** 在微信里请机器人后台调研：等它回了确认、任务建好 */
  const research = async (tag: string) => {
    ilink.push(OWNER, `RESEARCH ${tag}`);
    await waitFor(() => sentTo(`ACK-${tag}`).length === 1);
    await waitFor(() => !!taskOf(tag));
    return taskOf(tag)!;
  };
  const stage = (tag: string) => taskOf(tag)?.stage.key;
  /** 任务在跑一轮：模型请求挂着（HANG） */
  const hanging = (tag: string) => calls.some((c) => c.task && c.users.some((u) => u.includes(`RESEARCH ${tag}`)));

  it("demo: 'research Y' from WeChat runs in the background while chat continues; the result reaches the same chat once, through the outbox", async () => {
    const host = app.agent.host("default");
    const t = await research("SLOWY");
    expect(t.stage.group).toBe("working");
    expect(t.folder).toBe(`tasks/slowy-${t.id.slice(2, 8)}`);
    // 任务在跑的时候聊天照常回答
    await waitFor(() => calls.some((c) => c.task && c.users.some((u) => u.includes("RESEARCH SLOWY"))));
    expect(stage("SLOWY")).toBe("working");
    const t0 = Date.now();
    ilink.push(OWNER, "PING during");
    await waitFor(() => sentTo("PONG-during").length === 1);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(stage("SLOWY")).toBe("working");
    // 结果：一句话，经出站队列发回同一个微信会话，只发一次
    await waitFor(() => sentTo("RESULT-SLOWY").length === 1);
    await waitFor(() => stage("SLOWY") === "ready");
    await new Promise((r) => setTimeout(r, 1500));
    await app.outbox.idle();
    expect(sentTo("RESULT-SLOWY")).toHaveLength(1);
    const rows = app.store.listOutbox({ botId: "default", limit: 500 }).filter((r) => r.id.startsWith(`task:${t.id}:`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", channel: "weixin", peerId: OWNER });
    expect(rows[0].id).toMatch(new RegExp(`^task:${t.id}:result:r_[0-9a-f]{12}$`));
    // 任务在自己的文件夹里干活（在工作区里）
    const notes = fs.readFileSync(path.join(host.workspace, t.folder, "notes.md"), "utf8");
    expect(notes).toContain(path.join(host.workspace, t.folder));
    expect(notes).toContain("found-SLOWY");
    // 会话历史里有这句结果；聊天代理的下一条输入带着便条
    expect(app.store.listMessages(CONV).map((m) => m.content)).toContain("RESULT-SLOWY：调研好了，结论在 notes.md。");
    ilink.push(OWNER, "PING after");
    await waitFor(() => sentTo("PONG-after").length === 1);
    const after = calls.findLast((c) => !c.task && c.users.some((u) => u.includes("PING after")))!;
    expect(after.users.at(-1)).toMatch(/^\[后台任务「调研 SLOWY」已完成，已把结果发给用户\] RESULT-SLOWY/);
    // 一个 run，结果 done，有步骤；没有重启过代理进程
    const d = await api(`/tasks/${t.id}`);
    expect(d.runs.map((r: any) => [r.cause, r.state, r.outcome])).toEqual([["launch", "ended", "done"]]);
    expect(d.runs[0].steps).toBeGreaterThan(2);
    expect(d.task.stage).toMatchObject({ key: "ready", label: "已完成" });
    expect(host.restarts).toBe(0);
  }, 180_000);

  it("each session kind gets its own tools: tasks report and never present, ask or start tasks; chats start tasks but cannot report", async () => {
    ilink.push(OWNER, "LISTTOOLS");
    await waitFor(() => sentTo("CHATTOOLS<<").length === 1);
    const chatTools = /CHATTOOLS<<(.*)>>/.exec(sentTo("CHATTOOLS<<")[0].text)![1].split(",");
    expect(chatTools).toEqual(expect.arrayContaining(["task_start", "task_message", "task_list", "present", "ask_user_question"]));
    expect(chatTools).not.toContain("task_report");
    await research("TOOLS1");
    await waitFor(() => stage("TOOLS1") === "ready");
    const taskTools = calls.find((c) => c.task && c.users.some((u) => u.includes("RESEARCH TOOLS1")))!.tools;
    expect(taskTools).toContain("task_report");
    for (const t of ["present", "ask_user_question", "task_start", "task_message", "task_list"]) expect(taskTools).not.toContain(t);
  }, 120_000);

  it("a turn that ends without task_report gets one nudge; a background job keeps the run settling until it ends", async () => {
    await research("QUIET1");
    await waitFor(() => sentTo("NUDGED-QUIET1").length === 1);
    expect(stage("QUIET1")).toBe("ready");
    const nudges = calls.filter((c) => c.task && c.users.some((u) => u.includes("RESEARCH QUIET1"))).at(-1)!.users.filter((u) => /^Report this task's state/.test(u));
    expect(nudges).toHaveLength(1);
    // 后台命令：这一轮没报告就结束了，但命令还在跑——run 收尾中（仍占名额），命令结束唤醒代理，它报告完才结束
    const t = await research("BG1");
    await waitFor(async () => (await api(`/tasks/${t.id}`)).runs[0]?.state === "settling", 30_000);
    expect(stage("BG1")).toBe("working");
    await waitFor(() => sentTo("BGRESULT-BG1").length === 1);
    expect(stage("BG1")).toBe("ready");
    expect(calls.filter((c) => c.task && c.users.some((u) => u.includes("RESEARCH BG1"))).at(-1)!.users.some((u) => /^Report this task's state/.test(u))).toBe(false);
  }, 120_000);

  it("the human lane: a chat message never waits behind 2 running tasks; a third task waits for a slot", async () => {
    const a = await research("HANGA");
    const b = await research("HANGB");
    await waitFor(() => hanging("HANGA") && hanging("HANGB"));
    expect([stage("HANGA"), stage("HANGB")]).toEqual(["working", "working"]);
    const c = await research("HANGC");
    expect(stage("HANGC")).toBe("working/queued");
    expect(hanging("HANGC")).toBe(false);
    const t0 = Date.now();
    ilink.push(OWNER, "PING lane");
    await waitFor(() => sentTo("PONG-lane").length === 1);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect([stage("HANGA"), stage("HANGB"), stage("HANGC")]).toEqual(["working", "working", "working/queued"]);
    // 停掉一个，排队的那个接上
    expect(await app.tasks.stopTask(a.id, "test")).toBe(true);
    await waitFor(() => hanging("HANGC"));
    expect(stage("HANGC")).toBe("working");
    await app.tasks.stopTask(b.id, "test");
    await app.tasks.stopTask(c.id, "test");
  }, 180_000);

  it("/stop <n> from WeChat and the UI stop button stop one task; chat and the agent process carry on", async () => {
    const host = app.agent.host("default");
    const pid = host.pid;
    await research("HANGS1");
    await waitFor(() => hanging("HANGS1"));
    // /tasks 列出编号；/stop 1 停掉它（插队，不进会话队列）
    ilink.push(OWNER, "/tasks");
    await waitFor(() => sentTo("后台任务：").length >= 1);
    expect(sentTo("后台任务：").at(-1)!.text).toMatch(/^后台任务：\n1\. 调研 HANGS1 · 进行中/);
    ilink.push(OWNER, "/stop 1");
    await waitFor(() => sentTo("已停止后台任务「调研 HANGS1」").length === 1);
    await waitFor(() => stage("HANGS1") === "stopped");
    ilink.push(OWNER, "PING stopped1");
    await waitFor(() => sentTo("PONG-stopped1").length === 1);
    // 界面的停止
    const t2 = await research("HANGS2");
    await waitFor(() => hanging("HANGS2"));
    const r = await api(`/tasks/${t2.id}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.task.stage.key).toBe("stopped");
    ilink.push(OWNER, "PING stopped2");
    await waitFor(() => sentTo("PONG-stopped2").length === 1);
    // 停掉的任务不发任何东西；代理进程没重启
    await new Promise((r) => setTimeout(r, 1000));
    expect(ilink.state.sent.filter((s) => /HANGS[12]/.test(s.text) && !/已停止|ACK-/.test(s.text))).toEqual([]);
    expect(host.pid).toBe(pid);
    expect(host.state).toBe("running");
  }, 180_000);

  it("an app restart mid-task: the task resumes with the recovery note (once), and its result still arrives once", async () => {
    const t = await research("HANGR");
    await waitFor(() => hanging("HANGR"));
    const sessionId = app.store.getTask(t.id)!.sessionId;
    // 应用退出：跑着的 run 留在库里
    await app.stop();
    for (const r of hung.splice(0)) r.destroy();
    // 重新启动（同一个数据目录）：run 记为中断，排恢复；恢复说明是新 run 的第一条输入
    app = makeApp();
    await app.start();
    base = app.web!.url.replace(/\/+$/, "");
    await waitFor(() => sentTo("RECOVERED-HANGR").length === 1, 90_000);
    await waitFor(() => stage("HANGR") === "ready");
    const d = await api(`/tasks/${t.id}`);
    expect(d.runs.map((r: any) => [r.cause, r.outcome])).toEqual([
      ["launch", "interrupted"],
      ["recover", "done"],
    ]);
    // 同一个会话恢复过来（历史里还有原来的任务说明），恢复说明只交了一次
    expect(app.store.getTask(t.id)!.sessionId).toBe(sessionId);
    const last = calls.filter((c) => c.task && c.users.some((u) => u.includes("RESEARCH HANGR"))).at(-1)!;
    expect(last.users.filter((u) => /The app restarted while you were working/.test(u))).toHaveLength(1);
    expect(last.users.filter((u) => u.includes("[用户的原话]\nRESEARCH HANGR"))).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1500));
    await app.outbox.idle();
    expect(sentTo("RECOVERED-HANGR")).toHaveLength(1);
    expect(app.store.listOutbox({ botId: "default", limit: 500 }).filter((r) => r.id.startsWith(`task:${t.id}:`))).toHaveLength(1);
    // 重启前的任务结果没有被重发
    expect(sentTo("RESULT-SLOWY")).toHaveLength(1);
  }, 240_000);
});
