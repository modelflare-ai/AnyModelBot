/**
 * 规则（3d）端到端：真实 DSH 子进程 + 脚本化的模型 + mock iLink（主人在微信里和自己的机器人聊）。
 * 退出演示：微信里说「每天 08:00 看 X 价格」，聊天代理 rule_create 建好规则（观察）；「三天」到点各跑一次（把 next_run_at 拨到现在、
 * 叫醒定时器），运行记录读得懂，什么都没发；提示改为执行；改了之后命中时推一句，只推一次。
 * 另外：每次运行一个新会话；观察只读（写不了文件），执行可写工作区；规则会话的工具（观察去掉能改变什么的）；检查用小模型、
 * 那一句用主模型写；观察时要批准的自动拒绝、记下来，「需要你」里没有；事件触发走同一条路。
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
import { RULE_RESULT_SYSTEM } from "../src/agent/prompts/index.js";
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

describe.skipIf(!runtime || !hasBwrap || process.platform !== "linux")("rules (real DSH, WeChat)", () => {
  const OWNER = "owner@im.wechat";
  const CONV = `default:weixin:${OWNER}`;
  let app: App;
  let dataDir: string;
  let llm: Awaited<ReturnType<typeof listen>>;
  let ilink: Awaited<ReturnType<typeof mockIlink>>;
  let base = "";
  /** 每个模型请求：模型、工具名、系统提示词、用户消息、是不是规则会话 */
  const calls: Array<{ model: string; tools: string[]; system: string; users: string[]; rule: boolean }> = [];

  /** 规则会话：按第一条输入里的规则走；聊天会话：按最后一条带记号的用户消息走 */
  function plan(messages: any[], tools: string[], system: string): Step {
    let last = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && !/^Current runtime context/.test(textOf(messages[i].content))) { last = i; break; }
    const user = textOf(messages[last]?.content);
    const done = messages.slice(last + 1).filter((m) => m.role === "tool").length;
    const outs = messages.slice(last + 1).filter((m) => m.role === "tool").map((m) => textOf(m.content)).join("|");
    if (!system.includes("# 规则（优先于上面的聊天规则）")) {
      if (/RULE PRICE/.test(user))
        return done ? { text: "ACK-RULE：已建好规则：每天 08:00 看 X 价格。先观察几天，只记录不打扰你。" } : { tool: { name: "rule_create", args: { title: "看 X 价格", instruction: "每天 08:00 看看 X 的价格，低于 200 告诉我", schedule: "daily 08:00" } } };
      const p = /PING (\w+)/.exec(user);
      if (p) return { text: `PONG-${p[1]}` };
      return { text: "好的" };
    }
    // 规则会话：第一条输入里有规则原话和这次是观察还是执行
    const brief = messages.map((m) => textOf(m.content)).find((t) => t.includes("[规则]")) ?? "";
    const act = brief.includes("[这次]\n执行");
    if (/^Report this check with task_report now/.test(user)) return done ? { text: "已报告" } : { tool: { name: "task_report", args: { state: "failed", summary: "没查到" } } };
    if (brief.includes("ESCALATE")) {
      if (done === 0) return { tool: { name: "bash", args: { description: "run", command: "echo esc-$((40+2))", sandbox_permissions: "danger-full-access", justification: "测试提权" } } };
      if (done === 1) return { tool: { name: "task_report", args: { state: "done", summary: outs.includes("esc-42") ? "ran" : "not run" } } };
      return { text: "已报告" };
    }
    if (brief.includes("[事件]")) {
      const n = /"number":(\d+)/.exec(brief)?.[1] ?? "?";
      return done ? { text: "已报告" } : { tool: { name: "task_report", args: { state: "done", summary: `issue ${n}`, message: `EVENT-${n}：有新 issue` } } };
    }
    // 看价格：先用文件工具、再用命令在自己的文件夹里各写一个文件（观察时都写不了），读工作区里的 price.txt
    const mode = act ? "act" : "observe";
    if (done === 0) return { tool: { name: "write", args: { file_path: `probe-write-${mode}.txt`, content: "probe" } } };
    if (done === 1) return { tool: { name: "bash", args: { description: "check", command: `cat ../../price.txt; (echo probe > probe-${mode}.txt) 2>/dev/null && echo WROTE || echo NOWRITE` } } };
    if (done === 2) {
      const bash = textOf(messages.filter((m) => m.role === "tool").at(-1)?.content);
      const price = Number(/(\d+)/.exec(bash)?.[1] ?? 0);
      const wrote = bash.includes("WROTE") ? "写文件成功" : "写文件失败";
      const msg = price < 200 ? `X 降到 ${price} 了` : "";
      return { tool: { name: "task_report", args: { state: "done", summary: `X 现在 ¥${price}；${wrote}`, ...(msg ? { message: msg } : {}), ...(act ? {} : { would: "" }) } } };
    }
    return { text: "已报告" };
  }

  const makeApp = () =>
    new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_DEFAULT_MODEL: "mock-agent", AMB_AGENT_PREWARM: "0" } }), {
      printQrToTerminal: false,
      weixinPollTimeoutMs: 1000,
      deliveryLimits: { dailyCap: { weixin: 1000 }, coalesceMs: 0 },
    });

  beforeAll(async () => {
    llm = await listen(async (req, res) => {
      const url = req.url?.split("?")[0] ?? "";
      if (url.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-agent", object: "model" }, { id: "mock-small", object: "model" }] }));
      const b = await body(req);
      const tools = (b.tools ?? []).map((t: any) => t.function?.name ?? t.name);
      const system = (b.messages ?? []).filter((m: any) => m.role === "system" || m.role === "developer").map((m: any) => textOf(m.content)).join("\n");
      let step: Step;
      if (b.tools) {
        step = plan(b.messages ?? [], tools, system);
        calls.push({ model: b.model, tools, system, users: (b.messages ?? []).filter((m: any) => m.role === "user").map((m: any) => textOf(m.content)), rule: system.includes("# 规则（优先于上面的聊天规则）") });
      } else if (system.includes(RULE_RESULT_SYSTEM.split("\n")[0])) {
        // 主模型写那一句
        const draft = /\[草稿\]\n(.+)/.exec(textOf(b.messages.at(-1).content))?.[1] ?? "";
        calls.push({ model: b.model, tools: [], system, users: [], rule: false });
        step = { text: `MAIN：${draft}（主模型写的）` };
      } else step = { text: "标题" };
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
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-rules-"));
    app = makeApp();
    app.store.createBot({ id: "default", name: "小蓝", weixinEnabled: true, settings: { avatar: "blue", utilityModel: "mock-small", quietHours: { enabled: false, from: "22:00", to: "08:00" } } as any });
    app.store.saveWeixinAccount({ botId: "default", botToken: "tok", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: OWNER });
    await app.start();
    base = app.web!.url.replace(/\/+$/, "");
  }, 60_000);

  afterAll(async () => {
    await app?.stop();
    await llm?.close();
    await ilink?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const api = async (p: string, init?: { method?: string; body?: unknown }) =>
    (await fetch(`${base}/amb/api${p}`, init ? { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body ?? {}) } : undefined)).json() as Promise<any>;
  const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 60_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return;
    throw new Error("waitFor: timeout");
  };
  const sentTo = (text: string) => ilink.state.sent.filter((s) => s.to === OWNER && s.text.startsWith(text));
  const ws = () => app.agent.host("default").workspace;
  /** 「到了 08:00」：把下次运行拨到现在，叫醒定时器，等这次跑完 */
  const tick = async (ruleId: string) => {
    const before = app.store.ruleRuns(ruleId, { limit: 100 }).length;
    app.store.updateRule(ruleId, { nextRunAt: Date.now() - 1000 });
    app.tasks.scheduler.wake();
    await waitFor(() => {
      const runs = app.store.ruleRuns(ruleId, { limit: 100 });
      return runs.length > before && runs[0].state === "ended";
    }, 90_000);
    return app.store.ruleRuns(ruleId, { limit: 1 })[0];
  };
  const price = (n: number) => fs.writeFileSync(path.join(ws(), "price.txt"), `${n}\n`);

  it("exit demo: 「每天 08:00 看 X 价格」 runs 3 days in observe with a readable log, then switches to act and pushes one line on a hit", async () => {
    // 微信里说一句，聊天代理建规则（观察），回复确认
    ilink.push(OWNER, "RULE PRICE");
    await waitFor(() => sentTo("ACK-RULE").length === 1);
    const chat = calls.find((c) => !c.rule && c.users.some((u) => u.includes("RULE PRICE")))!;
    expect(chat.tools).toEqual(expect.arrayContaining(["rule_create", "rule_update", "task_list"]));
    const [rule] = (await api("/rules?bot=default")).rules;
    expect(rule).toMatchObject({ title: "看 X 价格", when: "每天 08:00", mode: "observe", state: { key: "observe", label: "观察中" }, instruction: "每天 08:00 看看 X 的价格，低于 200 告诉我", conversationId: CONV, hint: false });
    // 三天：观察。每次一个新会话，检查用小模型；写不了文件（只读）；什么都不发
    price(259);
    const d1 = await tick(rule.id);
    price(199);
    const d2 = await tick(rule.id);
    price(262);
    const d3 = await tick(rule.id);
    expect([d1, d2, d3].map((r) => [r.mode, r.outcome, r.permission])).toEqual([
      ["observe", "done", "read-only"],
      ["observe", "done", "read-only"],
      ["observe", "done", "read-only"],
    ]);
    expect(new Set([d1, d2, d3].map((r) => r.sessionId)).size).toBe(3);
    expect(d1.report!.summary).toBe("X 现在 ¥259；写文件失败");
    const folder = path.join(ws(), app.store.getRule(rule.id)!.folder);
    expect(fs.existsSync(path.join(folder, "probe-observe.txt"))).toBe(false);
    // 文件工具也写不了（只读沙箱），模型看到的是被拒绝
    expect(fs.existsSync(path.join(folder, "probe-write-observe.txt"))).toBe(false);
    const ruleCalls = calls.filter((c) => c.rule);
    expect(new Set(ruleCalls.map((c) => c.model))).toEqual(new Set(["mock-small"]));
    // 第二天的输入里有第一天的结果（连续性靠宿主给的最近几次）
    expect(ruleCalls.find((c) => c.users.some((u) => u.includes("¥199")) || c.users.some((u) => u.includes("[最近几次的结果]\n- ")))).toBeTruthy();
    // 运行记录读得懂：新的在前；那一句用主模型写
    const log = (await api(`/rules/${rule.id}/runs`)).runs;
    expect(log.map((r: any) => [r.mode, r.line])).toEqual([
      ["observe", "本会保持安静：X 现在 ¥262；写文件失败"],
      ["observe", "本会发送：“MAIN：X 降到 199 了（主模型写的）”"],
      ["observe", "本会保持安静：X 现在 ¥259；写文件失败"],
    ]);
    expect(log[0]).toMatchObject({ permission: "只读", version: 1 });
    expect(log[0].steps).toBeGreaterThan(1);
    const steps = (await api(`/rules/${rule.id}/runs/${log[0].id}/activity`)).steps;
    expect(steps.length).toBe(log[0].steps);
    expect(calls.filter((c) => c.tools.length === 0 && c.system.includes(RULE_RESULT_SYSTEM.split("\n")[0])).map((c) => c.model)).toEqual(["mock-agent"]);
    await app.outbox.idle();
    expect(ilink.state.sent.filter((s) => /MAIN|199/.test(s.text))).toEqual([]);
    // 观察了 3 次：提示改为执行（只在界面上）
    expect((await api(`/rules/${rule.id}`)).rule).toMatchObject({ hint: true, observed: 3 });
    // 改为执行：命中时推一句（主模型写的），只推一次；执行能写自己的文件夹
    const put = await api(`/rules/${rule.id}`, { method: "PUT", body: { mode: "act" } });
    expect(put.rule).toMatchObject({ mode: "act", state: { key: "act", label: "执行中" }, hint: false });
    price(195);
    const d4 = await tick(rule.id);
    expect(d4).toMatchObject({ mode: "act", outcome: "done", permission: "workspace-write" });
    expect(d4.report!.summary).toBe("X 现在 ¥195；写文件成功");
    expect(fs.readFileSync(path.join(folder, "probe-write-act.txt"), "utf8")).toBe("probe");
    await waitFor(() => sentTo("MAIN：X 降到 195 了").length === 1);
    expect(sentTo("MAIN：X 降到 195 了")[0].text).toBe("MAIN：X 降到 195 了（主模型写的）");
    await new Promise((r) => setTimeout(r, 1000));
    await app.outbox.idle();
    expect(sentTo("MAIN：X 降到 195 了")).toHaveLength(1);
    expect(app.store.listOutbox({ botId: "default", limit: 100 }).filter((r) => r.id.startsWith(`rule:${rule.id}:`)).map((r) => [r.id, r.status, r.purpose])).toEqual([[`rule:${rule.id}:${d4.id}`, "sent", "rule"]]);
    expect((await api(`/rules/${rule.id}/runs`)).runs[0]).toMatchObject({ mode: "act", line: "已发送：“MAIN：X 降到 195 了（主模型写的）”", permission: "可写工作区" });
    // 没命中：不发
    price(240);
    await tick(rule.id);
    await new Promise((r) => setTimeout(r, 500));
    expect(ilink.state.sent.filter((s) => s.text.includes("240"))).toEqual([]);
    // 聊天代理下一轮知道发过什么（便条）
    ilink.push(OWNER, "PING after");
    await waitFor(() => sentTo("PONG-after").length === 1);
    const after = calls.findLast((c) => !c.rule && c.users.some((u) => u.includes("PING after")))!;
    expect(after.users.some((u) => u.includes("[规则「看 X 价格」发给了用户] MAIN：X 降到 195 了"))).toBe(true);
    expect((await api("/attention")).items).toEqual([]);
  }, 600_000);

  it("rule sessions get their own tools: observe loses everything that acts (memory writes, present, tasks, rules, media), act keeps memory; both report with task_report", async () => {
    const observe = calls.find((c) => c.rule && c.users.some((u) => u.includes("[这次]\n观察")))!;
    const act = calls.find((c) => c.rule && c.users.some((u) => u.includes("[这次]\n执行")))!;
    for (const t of ["task_report", "bash", "recall"]) expect(observe.tools).toContain(t);
    for (const t of ["remember", "forget", "present", "ask_user_question", "task_start", "task_message", "task_list", "rule_create", "rule_update", "generate_image", "generate_video"]) expect(observe.tools).not.toContain(t);
    expect(act.tools).toEqual(expect.arrayContaining(["task_report", "remember"]));
    expect(act.tools).not.toContain("rule_create");
    expect(observe.system).toContain("这次是观察：只看、只查，不改任何东西");
    expect(act.system).toContain("只做规则里写的事");
  });

  it("an approval asked in observe mode is rejected automatically and recorded as would-need; needs-you stays empty", async () => {
    const r = app.tasks.createRule({ botId: "default", conversationId: CONV, title: "提权", instruction: "ESCALATE 看看系统", schedule: { kind: "daily", time: "09:00", tz: "UTC" } });
    const run = await tick(r.rule!.id);
    expect(run).toMatchObject({ mode: "observe", outcome: "done" });
    expect(run.report!.summary).toBe("not run");
    expect(run.would).toMatch(/^需要批准：.*echo esc-\$\(\(40\+2\)\)/);
    expect(app.store.listApprovals({ ruleId: r.rule!.id })).toEqual([]);
    expect((await api("/attention")).items).toEqual([]);
    expect((await api(`/rules/${r.rule!.id}/runs`)).runs[0].line).toMatch(/^本会做：需要批准：/);
    await api(`/rules/${r.rule!.id}`, { method: "DELETE" });
    expect(app.store.getRule(r.rule!.id)).toBeUndefined();
  }, 180_000);

  it("the rule editor's API: a new check from the UI starts in observe, a reminder acts; a bad schedule is refused; editing the words of an acting rule observes once", async () => {
    const bad = await fetch(`${base}/amb/api/rules`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: "default", conversationId: CONV, title: "x", instruction: "x", schedule: { kind: "every", minutes: 5 } }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toBe("间隔至少 15 分钟");
    const c = (await api("/rules", { method: "POST", body: { botId: "default", conversationId: CONV, kind: "check", title: "看天气", instruction: "每个工作日早上看看会不会下雨", schedule: { kind: "daily", time: "07:30", days: [1, 2, 3, 4, 5] } } })).rule;
    expect(c).toMatchObject({ mode: "observe", when: "每个工作日 07:30", state: { key: "observe" } });
    const r = (await api("/rules", { method: "POST", body: { botId: "default", conversationId: CONV, kind: "remind", title: "喝水", message: "喝水。", schedule: { kind: "every", minutes: 120 } } })).rule;
    expect(r).toMatchObject({ kind: "remind", mode: "act", message: "喝水。", instruction: "喝水。", when: "每 2 小时", state: { key: "remind" } });
    await api(`/rules/${c.id}`, { method: "PUT", body: { mode: "act" } });
    const edited = (await api(`/rules/${c.id}`, { method: "PUT", body: { instruction: "每个工作日早上看看会不会下雨，下雨就提醒我带伞" } })).rule;
    expect(edited).toMatchObject({ mode: "act", observeLeft: 1, version: 2, state: { key: "observe" } });
    for (const id of [c.id, r.id]) await api(`/rules/${id}`, { method: "DELETE" });
    expect((await api("/rules?bot=default")).rules.map((x: any) => x.id)).not.toContain(c.id);
  });

  it("an event-triggered rule (the extension point for user workloads) runs through the same path when a fake source emits", async () => {
    const r = app.tasks.createRule({ botId: "default", conversationId: CONV, title: "新 issue", instruction: "仓库有新 issue 时告诉我", trigger: { kind: "event", source: "fake-repo", filter: { action: "opened" } } });
    app.tasks.updateRule(r.rule!.id, { mode: "act" });
    expect(app.ruleEvents.emit("fake-repo", { action: "closed", number: 7 })).toEqual([]);
    expect(app.ruleEvents.emit("fake-repo", { action: "opened", number: 8 })).toEqual([r.rule!.id]);
    await waitFor(() => app.store.ruleRuns(r.rule!.id, { limit: 1 })[0]?.state === "ended", 90_000);
    expect(app.store.ruleRuns(r.rule!.id, { limit: 1 })[0]).toMatchObject({ cause: "event", mode: "act", outcome: "done" });
    await waitFor(() => sentTo("MAIN：EVENT-8").length === 1);
  }, 180_000);
});
