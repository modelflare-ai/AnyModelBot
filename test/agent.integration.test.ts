import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import module from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RETRY_NOTE, locateDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { listen } from "./helpers.js";

/**
 * 真实 DSH 子进程 + 脚本化的模型（会发出工具调用），Chat Completions、Responses、Anthropic Messages 三种接口都能答。
 * 验证：插件加载、bridge 注入密钥、bash 沙箱、审批流程（API 批准/拒绝）、读围栏、回环 API 防护、按模型选接口。
 */
const runtime = locateDshRuntime(findAppRoot());
/** workflow 脚本先剥离 TS 类型；Electron 自带的 Node 支持，部分发行版的系统 Node 不带 amaro。 */
const canStripTypes = (() => {
  try {
    (module as any).stripTypeScriptTypes("let a: number = 1");
    return true;
  } catch {
    return false;
  }
})();
const hasBwrap = fs.existsSync("/usr/bin/bwrap");

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function textOf(c: any): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  return "";
}

const rnd = () => Math.random().toString(36).slice(2, 10);
const imageUrl = (url: string) => ({ type: "image_url", image_url: { url } });

/** Responses 的 input → Chat 形状的消息（脚本只看 user / tool） */
function fromResponses(input: any[]): any[] {
  const out: any[] = [];
  for (const it of input ?? []) {
    if (it.type === "function_call_output") out.push({ role: "tool", content: typeof it.output === "string" ? it.output : textOf(it.output) });
    else if (it.role && (it.type === undefined || it.type === "message"))
      out.push({ role: it.role, content: typeof it.content === "string" ? it.content : it.content.map((p: any) => (p.type === "input_image" ? imageUrl(p.image_url) : { type: "text", text: p.text ?? "" })) });
  }
  return out;
}

/** Anthropic 的 messages → Chat 形状：tool_result 拆成 tool 消息 */
function fromAnthropic(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages ?? []) {
    const blocks: any[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const r of blocks.filter((b) => b.type === "tool_result")) out.push({ role: "tool", content: textOf(r.content) });
    const rest = blocks.filter((b) => b.type === "text" || b.type === "image");
    if (rest.length) out.push({ role: m.role, content: rest.map((b) => (b.type === "image" ? imageUrl(`data:${b.source.media_type};base64,${b.source.data}`) : { type: "text", text: b.text })) });
  }
  return out;
}

/** 像 OpenAI 那样校验 Responses 请求（store:false 时推理条目必须带 encrypted_content，工具结果要对得上调用） */
function responsesError(b: any): string | undefined {
  if (b.store !== false) return "store must be false";
  const calls = new Set<string>();
  for (const it of b.input ?? []) {
    if (it.type === "reasoning" && !it.encrypted_content) return `Item with id '${it.id}' not found. Items are not persisted when \`store\` is set to false.`;
    if (it.type === "function_call") {
      if (it.id !== undefined && !String(it.id).startsWith("fc")) return `Invalid 'input.id': '${it.id}'. Expected an ID that begins with 'fc'.`;
      calls.add(it.call_id);
    }
    if (it.type === "function_call_output" && !calls.has(it.call_id)) return `No tool call found for function call output with call_id ${it.call_id}.`;
  }
  return undefined;
}

/** 像 Anthropic 那样校验：max_tokens 必填，tool_result 紧跟在对应的 tool_use 之后 */
function messagesError(b: any): string | undefined {
  if (!(b.max_tokens > 0)) return "max_tokens: Field required";
  let pending = new Set<string>();
  for (const m of b.messages ?? []) {
    const blocks: any[] = typeof m.content === "string" ? [] : m.content;
    for (const r of blocks.filter((x) => x.type === "tool_result")) if (m.role !== "user" || !pending.has(r.tool_use_id)) return `unexpected tool_use_id found in tool_result blocks: ${r.tool_use_id}`;
    for (const t of blocks.filter((x) => x.type === "tool_use")) if (!/^[a-zA-Z0-9_-]+$/.test(t.id)) return `tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'`;
    pending = new Set(m.role === "assistant" ? blocks.filter((x) => x.type === "tool_use").map((x) => x.id) : []);
  }
  return undefined;
}

type Step = { tool?: { name: string; args: any }; text?: string; hang?: boolean };

/** OpenAI Responses 的流式事件；请求要了 encrypted_content 时先给一条加密推理 */
function responsesStream(res: http.ServerResponse, b: any, step: Step): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type: string, o: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
  const id = "resp_" + rnd();
  const output: any[] = [];
  const item = (done: any, added: any, between: (i: number) => void = () => {}) => {
    const i = output.length;
    ev("response.output_item.added", { output_index: i, item: added });
    between(i);
    ev("response.output_item.done", { output_index: i, item: done });
    output.push(done);
  };
  ev("response.created", { response: { id, object: "response", status: "in_progress", model: b.model, output: [] } });
  if (b.include?.includes("reasoning.encrypted_content")) {
    const rs = { type: "reasoning", id: "rs_" + rnd(), summary: [{ type: "summary_text", text: "想一想" }], encrypted_content: "enc-" + rnd() };
    item(rs, { type: "reasoning", id: rs.id, summary: [] }, (i) => ev("response.reasoning_summary_text.delta", { output_index: i, item_id: rs.id, summary_index: 0, delta: "想一想" }));
  }
  if (step.tool) {
    const args = JSON.stringify(step.tool.args);
    const fc = { type: "function_call", id: "fc_" + rnd(), call_id: "call_" + rnd(), name: step.tool.name, arguments: args, status: "completed" };
    item(fc, { ...fc, arguments: "", status: "in_progress" }, (i) => {
      ev("response.function_call_arguments.delta", { output_index: i, item_id: fc.id, delta: args });
      ev("response.function_call_arguments.done", { output_index: i, item_id: fc.id, arguments: args });
    });
  } else {
    const text = step.text ?? "";
    const msg = { type: "message", id: "msg_" + rnd(), role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
    item(msg, { ...msg, status: "in_progress", content: [] }, (i) => ev("response.output_text.delta", { output_index: i, item_id: msg.id, content_index: 0, delta: text }));
  }
  const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
  ev("response.completed", { response: { id, object: "response", status: "completed", model: b.model, output, usage } });
  res.end();
}

/** Anthropic Messages 的流式事件 */
function messagesStream(res: http.ServerResponse, b: any, step: Step): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type: string, o: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
  ev("message_start", { message: { id: "msg_" + rnd(), type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  if (step.tool) {
    ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_" + rnd(), name: step.tool.name, input: {} } });
    ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(step.tool.args) } });
  } else {
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: step.text ?? "" } });
  }
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: step.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  ev("message_stop", {});
  res.end();
}

describe.skipIf(!runtime || !hasBwrap || process.platform !== "linux")("agent host (DSH)", () => {
  let app: App;
  let dataDir: string;
  let llm: Awaited<ReturnType<typeof listen>>;
  const seenAuth = new Set<string>();
  /** 上游收到的每个模型请求：走的接口、模型、请求体与请求头 */
  const calls: Array<{ api: "chat" | "responses" | "messages"; model: string; body: any; headers: http.IncomingHttpHeaders; error?: string }> = [];
  /** 测试注入的 Modelflare 目录：模型 → 支持的接口（外部端点模式下 App 不查目录） */
  const catalog: Record<string, string[]> = {};
  /** FLAKY：每条这样的用户消息第一次请求先失败一次（Responses 503、Messages 429），看代理会不会重试 */
  const flaked = new Set<string>();
  /**
   * 上游不接受某个模型在 Responses / Messages 上的请求（Chat 照常）：always 每次都 400；after-tool 带着工具结果时 400；
   * busy 每次都 503（不是请求形状的问题）
   */
  const rejects: Record<string, "always" | "after-tool" | "busy"> = {};
  const hung: http.ServerResponse[] = [];
  let base = "";
  /** 工作区与数据目录之外的目录（完全权限测试用） */
  let outside = "";

  /** 根据最后一条用户消息与之后的工具结果数量决定下一步 */
  function plan(messages: any[]): Step {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && /QUICKSORT|ESCALATE|SECRET|READFILE|LOOPBACK|PRESENT|ASKQ|NATIVES|LOOKIMG|HANG|COUNTER|OUTWRITE|RMRF|RMWS|CHILDRM|SUBRM|\[用户消息\]/.test(textOf(messages[i].content))) { lastUser = i; break; }
    }
    const user = textOf(messages[lastUser]?.content);
    const tools = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
    // 卡住的模型：请求收下了，一直不回
    if (/HANG/.test(user)) return { hang: true };
    // 看图：回报模型收到的图片（data URL 的头）和文字里有没有工作区路径
    if (/LOOKIMG/.test(user)) {
      const content = messages[lastUser]?.content;
      const urls = (Array.isArray(content) ? content : []).filter((p: any) => p?.type === "image_url").map((p: any) => String(p.image_url?.url ?? "").split(",")[0]);
      return { text: `SEEN<<${urls.join(" ")}|${/\[图片 inbox\/[^\]]+\.png\]/.test(user) ? "path" : "nopath"}>>` };
    }
    const scripts: Array<[RegExp, Array<{ name: string; args: any }>]> = [
      [/QUICKSORT/, [{ name: "bash", args: { description: "run", command: "cat > qs.py <<'PY'\ndef qs(a):\n    return a if len(a)<2 else qs([x for x in a[1:] if x<a[0]])+[a[0]]+qs([x for x in a[1:] if x>=a[0]])\nprint(qs([5,3,9,1,7,2]))\nPY\npython3 qs.py" } }]],
      [/ESCALATE/, [{ name: "bash", args: { description: "run", command: "echo escalated-$((40+2))", sandbox_permissions: "danger-full-access", justification: "测试提权" } }]],
      [/SECRET/, [{ name: "bash", args: { description: "run", command: `ls ${dataDir} 2>&1; cat ${path.join(dataDir, "anymodel.db")} >/dev/null 2>&1 && echo DB-READABLE || echo DB-HIDDEN` } }]],
      [/READFILE/, [{ name: "read", args: { file_path: path.join(dataDir, "config.json") } }, { name: "read", args: { file_path: "qs.py" } }]],
      [/PRESENT/, [{ name: "bash", args: { description: "run", command: "printf 'hello deliverable' > report.txt" } }, { name: "present", args: { files: [{ path: "report.txt", description: "报告" }, { path: "/etc/hostname" }] } }]],
      [/ASKQ/, [{ name: "ask_user_question", args: { questions: [{ id: "lang", question: "用哪种语言？", options: [{ label: "Python" }, { label: "Go" }] }] } }]],
      // 原生依赖与子进程：ripgrep（grep/glob）、PTC 的 Node 子进程（workflow）
      [/NATIVES/, [
        { name: "bash", args: { description: "run", command: "printf 'needle-4711\\n' > hay.txt && printf 'x' > dot.png" } },
        { name: "grep", args: { pattern: "needle-47" } },
        { name: "glob", args: { pattern: "*.png" } },
        ...(canStripTypes ? [{ name: "workflow", args: { script: "return { answer: 6 * 7 }", meta: { name: "calc", description: "multiply" } } }] : []),
      ]],
      [/COUNTER/, [{ name: "bash", args: { description: "run", command: "echo ran >> counter.txt && wc -l < counter.txt" } }]],
      [/LOOPBACK/, [{ name: "bash", args: { description: "run", command: `python3 -c "import urllib.request as u\ntry:\n  print('API', u.urlopen('${base}/amb/api/status').status)\nexcept Exception as e:\n  print('API', getattr(e,'code',e))"` } }]],
      // 完全权限：写工作区外的目录、读宿主数据目录、显式要求 danger-full-access
      [/OUTWRITE/, [
        { name: "bash", args: { description: "run", command: `echo out-$((40+2)) > ${outside}/marker.txt; cat ${outside}/marker.txt; cat ${path.join(dataDir, "anymodel.db")} >/dev/null 2>&1 && echo DB-READABLE || echo DB-HIDDEN` } },
        { name: "bash", args: { description: "run", command: "echo escalated-$((40+2))", sandbox_permissions: "danger-full-access", justification: "测试提权" } },
      ]],
      // 普通删除直接执行，递归删除先问
      [/RMRF/, [
        { name: "bash", args: { description: "run", command: `rm ${outside}/single.txt && echo single-gone` } },
        { name: "bash", args: { description: "run", command: `rm -rf ${outside}/victim && echo victim-gone` } },
      ]],
      [/RMWS/, [{ name: "bash", args: { description: "run", command: "mkdir -p tree/sub && touch tree/sub/f && rm -rf tree && echo tree-gone" } }]],
      [/CHILDRM/, [{ name: "bash", args: { description: "run", command: `rm -rf ${outside}/victim2 && echo victim2-gone` } }]],
      [/SUBRM/, [{ name: "subagent", args: { description: "delete", prompt: "CHILDRM now" } }]],
    ];
    for (const [re, steps] of scripts) {
      if (!re.test(user)) continue;
      if (tools.length < steps.length) return { tool: steps[tools.length] };
      return { text: `RESULT<<${tools.map((t) => textOf(t.content)).join("|")}>>` };
    }
    return { text: "好的" };
  }

  beforeAll(async () => {
    llm = await listen(async (req, res) => {
      seenAuth.add(String(req.headers.authorization));
      const url = req.url?.split("?")[0] ?? "";
      if (url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-agent", object: "model" }] }));
        return;
      }
      const b = await body(req);
      const api = url.endsWith("/v1/responses") ? "responses" : url.endsWith("/v1/messages") ? "messages" : "chat";
      const msgs = api === "responses" ? fromResponses(b.input) : api === "messages" ? fromAnthropic(b.messages) : b.messages;
      const error = api === "responses" ? responsesError(b) : api === "messages" ? messagesError(b) : undefined;
      const said = (msgs ?? []).filter((m: any) => m.role === "user").map((m: any) => textOf(m.content)).findLast((t: string) => /FLAKY/.test(t));
      const flaky = api !== "chat" && b.tools && said && !flaked.has(said) ? (flaked.add(said), api === "responses" ? 503 : 429) : 0;
      calls.push({ api, model: b.model, body: b, headers: req.headers, error: error ?? (flaky ? `${flaky}` : undefined) });
      if (error) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: error } }));
      if (flaky) return void res.writeHead(flaky, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: flaky === 429 ? "rate_limit_error" : "api_error", message: "slow down" } }));
      const rule = api === "chat" ? undefined : rejects[b.model];
      if (rule === "busy") {
        calls[calls.length - 1].error = "503";
        return void res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "api_error", message: "upstream overloaded" } }));
      }
      if (rule === "always" || (rule === "after-tool" && msgs.some((m: any) => m.role === "tool"))) {
        calls[calls.length - 1].error = "400";
        return void res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning.summary' is not supported with this model.", type: "invalid_request_error", param: "reasoning.summary", code: "unsupported_parameter" } }));
      }
      const step = b.tools ? plan(msgs) : { text: "标题" };
      if ("hang" in step && step.hang) return void hung.push(res);
      if (process.env.AMB_TEST_LLM_LOG) fs.appendFileSync(process.env.AMB_TEST_LLM_LOG, JSON.stringify({ url: req.url, stream: b.stream, tools: (b.tools ?? []).map((t: any) => t.function?.name ?? t.name), msgs: msgs.map((m: any) => [m.role, textOf(m.content).slice(0, 200), m.tool_calls?.map((t: any) => t.function?.name)]), step }) + "\n");
      if (api === "responses") return responsesStream(res, b, step);
      if (api === "messages") return messagesStream(res, b, step);
      if (!b.stream) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: step.text ?? "" }, finish_reason: "stop" }] }));
        return;
      }
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
      res.write("data: [DONE]\n\n");
      res.end();
    });
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-agent-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "amb-outside-"));
    app = new App(
      loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_DEFAULT_MODEL: "mock-agent" } }),
      { printQrToTerminal: false },
    );
    // 外部端点模式下 App 不查 Modelflare 目录（只当它会 Chat）；这里注入目录，让模型名决定接口
    (app.agent as any).o.apiInfo = async (model: string) => (catalog[model] ? { endpoints: catalog[model] } : undefined);
    await app.start();
    base = app.web!.url.replace(/\/+$/, "");
  }, 60_000);

  afterAll(async () => {
    for (const r of hung) r.destroy();
    await app?.stop();
    await llm?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const chat = async (text: string) => {
    const r = await fetch(`${base}/amb/api/bots/default/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    expect(r.status).toBe(200);
    return (await r.json()) as { reply: string; progress?: string[]; prompts: any[]; files?: string[] };
  };

  it("runs a sandboxed bash tool in the bot workspace (quicksort)", async () => {
    const r = await chat("QUICKSORT please");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(fs.existsSync(path.join(dataDir, "workspaces", "default", "qs.py"))).toBe(true);
    // 模型只看到真实上游密钥，子进程只拿到 bridge 令牌
    expect([...seenAuth]).toEqual(["Bearer gw-key"]);
    // 工具调用不进入聊天：响应与会话历史里只有用户消息和最终回复
    expect(r.progress).toBeUndefined();
    const convs = ((await (await fetch(`${base}/amb/api/conversations?bot=default`)).json()) as any).conversations;
    const conv = convs.find((c: any) => String(c.id).includes("web"));
    const hist = ((await (await fetch(`${base}/amb/api/conversations/${encodeURIComponent(conv.id)}/messages`)).json()) as any).messages;
    expect(hist.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(hist)).not.toMatch(/🔧|tool|bash:/);
  }, 120_000);

  it("escalation waits for approval; approve via API allows once", async () => {
    const pending = chat("ESCALATE now");
    let row: any;
    for (let i = 0; i < 300 && !row; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const l = (await (await fetch(`${base}/amb/api/approvals?status=pending`)).json()) as any;
      row = l.approvals[0];
    }
    expect(row).toBeTruthy();
    expect(row.code).toMatch(/^\d{4}$/);
    expect(row.tool).toBe("bash");
    expect(row.detail).toContain("echo escalated");
    const ok = await fetch(`${base}/amb/api/approvals/${row.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(ok.status).toBe(200);
    const r = await pending;
    expect(r.reply).toContain("escalated-42");
    expect(r.prompts[0]?.prompt).toMatch(new RegExp(`需批准: bash \`echo escalated-\\$\\(\\(40\\+2\\)\\)\` — 回复 y ${row.code} / n ${row.code}`));
  }, 120_000);

  it("deny via chat reply 'n CODE' rejects", async () => {
    const pending = chat("ESCALATE again");
    let row: any;
    for (let i = 0; i < 300 && !row; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = ((await (await fetch(`${base}/amb/api/approvals?status=pending`)).json()) as any).approvals[0];
    }
    const ack = await chat(`n ${row.code}`);
    expect(ack.reply).toContain(`已拒绝 ${row.code}`);
    const r = await pending;
    expect(r.reply).not.toContain("escalated-42");
    expect(app.store.getApproval(row.id)!.status).toBe("rejected");
  }, 120_000);

  it("hides the host data dir from sandboxed commands", async () => {
    const r = await chat("SECRET check");
    expect(r.reply).toContain("DB-HIDDEN");
    expect(r.reply).not.toContain("anymodel.db");
  }, 120_000);

  it("in-process read tool cannot read the host data dir but can read the workspace", async () => {
    fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ ui: { token: "SECRET-TOKEN-XYZ" } }));
    const r = await chat("READFILE check");
    expect(r.reply).toContain("file access denied");
    expect(r.reply).not.toContain("SECRET-TOKEN-XYZ");
    expect(r.reply).toContain("def qs");
  }, 120_000);

  it("present delivers workspace files only", async () => {
    const r = await chat("PRESENT report");
    expect(r.files).toEqual(["report.txt"]);
  }, 120_000);

  it("ask_user_question becomes a numbered prompt answered by reply", async () => {
    const pending = chat("ASKQ please");
    let row: any;
    for (let i = 0; i < 300 && !row; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = ((await (await fetch(`${base}/amb/api/approvals?status=pending`)).json()) as any).approvals[0];
    }
    expect(row?.kind).toBe("question");
    await chat("2");
    const r = await pending;
    expect(r.prompts[0]?.prompt).toContain("1. Python");
    expect(r.prompts[0]?.prompt).toContain("2. Go");
    expect(r.reply).toContain("Go");
  }, 120_000);

  it("runs tools backed by native modules and Node subprocesses", async () => {
    const r = await chat("NATIVES check");
    const parts = r.reply.replace(/^RESULT<<|>>$/g, "").split("|");
    expect(parts).toHaveLength(canStripTypes ? 4 : 3);
    expect(parts[1]).toContain("hay.txt");
    expect(parts[1]).toContain("needle-4711");
    expect(parts[2]).toContain("dot.png");
    if (canStripTypes) expect(parts[3]).toContain("42");
  }, 120_000);

  it("blocks loopback management API calls from the agent", async () => {
    const r = await chat("LOOPBACK check");
    expect(r.reply).toContain("API 403");
  }, 120_000);

  it("troubleshooting: test agent passes every stage, restart respawns the host", async () => {
    const post = async (p: string, body: unknown = {}) =>
      (await (await fetch(`${base}/amb/api/diagnostics/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as any;
    const t = await post("test-agent", { timeoutMs: 60_000 });
    expect(t.stages.map((s: any) => `${s.id}:${s.status}`)).toEqual(["queue:ok", "spawn:ok", "plugins:ok", "model:ok", "reply:ok"]);
    expect(t.reply).toBe("好的");
    // 诊断会话不进聊天记录
    const convs = ((await (await fetch(`${base}/amb/api/conversations?bot=default`)).json()) as any).conversations;
    expect(convs.some((c: any) => String(c.id).includes("diag"))).toBe(false);
    const status = ((await (await fetch(`${base}/amb/api/diagnostics`)).json()) as any).agent.hosts.default;
    expect(status).toMatchObject({ state: "running" });
    expect(Array.isArray(status.stderrTail)).toBe(true);

    const r = await post("restart-agent");
    expect(r.restarted).toEqual(["default"]);
    expect(r.agent.hosts.default.state).toBe("stopped");
    // 重启后下一条消息重新拉起代理进程（脚本化模型按会话历史回答，这里只看不是错误）
    const again = await chat("hello after restart");
    expect(again.reply).toBeTruthy();
    expect(again.reply).not.toContain("⚠️");
    expect(app.agent.host("default").state).toBe("running");
  }, 180_000);

  it("images from chat: saved under the workspace inbox/; a vision model gets the image itself, a text model only the path", async () => {
    // 1x1 PNG（DSH 收图时会校验并规范化，必须是真图）
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const send = async (user: string, model: string) => {
      const conv = app.store.ensureConversation("default", "weixin", user, user, "dm");
      app.store.setConversationModel(conv.id, model);
      const ops: any[] = [];
      const ev = { id: `img-${user}`, channel: "weixin" as const, botId: "default", conversation: { kind: "dm" as const, id: user }, sender: { id: user }, parts: [{ type: "text" as const, text: "LOOKIMG" }, { type: "image" as const, data: png, mime: "image/png" }], replyHandle: {}, receivedAt: Date.now() };
      await app.runtime.handle(ev, { apply: async (op) => void ops.push(op) });
      return ops.find((o) => o.type === "stream.finish")?.text as string;
    };
    // Electron on Linux (scripts/test-dsh-bundle.mjs): sharp crashes there, so the host keeps images to paths
    if (app.agent.host("default").imageInput) expect(await send("img-vision", "gpt-5-mock")).toMatch(/^SEEN<<data:image\/(png|jpeg|webp);base64\|path>>$/);
    else expect(await send("img-vision", "gpt-5-mock")).toBe("SEEN<<|path>>");
    expect(await send("img-text", "mock-agent")).toBe("SEEN<<|path>>");
    const inbox = fs.readdirSync(path.join(dataDir, "workspaces", "default", "inbox"));
    expect(inbox.filter((f) => /^\d{8}-\d{6}-[0-9a-f]{6}\.png$/.test(f))).toHaveLength(2);
    expect(fs.readFileSync(path.join(dataDir, "workspaces", "default", "inbox", inbox[0])).equals(png)).toBe(true);
  }, 180_000);

  // —— 卡住的回合：看门狗、/stop、处理过程 ——
  const console_ = async () => (await (await fetch(`${base}/amb/api/bots/default/chat`)).json()) as { conversationId: string; messages: any[] };
  const api = async (p: string, init?: RequestInit) => (await fetch(`${base}/amb/api${p}`, init)).json();

  it("a turn without progress is stopped by the watchdog: the agent restarts and the reply keeps its steps", async () => {
    const o = (app.agent as any).o;
    const prev = o.idleTimeoutMs;
    o.idleTimeoutMs = 3000;
    try {
      const t0 = Date.now();
      const r = await chat("HANG please");
      expect(r.reply).toBe("⚠️ 代理 3 秒没有任何进展，已自动中止并重启代理进程。卡在：等待 mock-agent 回复。可以重新发送，或用 /model 换个模型试试。");
      expect(Date.now() - t0).toBeLessThan(30_000);
    } finally {
      o.idleTimeoutMs = prev;
    }
    const d = await console_();
    const last = d.messages.at(-1);
    expect(last.steps).toBe(2);
    const a = await api(`/conversations/${encodeURIComponent(d.conversationId)}/messages/${last.id}/activity`);
    expect(a.steps.map((s: any) => [s.kind, s.title, s.status, !!s.cut])).toEqual([["model", "mock-agent", "error", true], ["error", "已中止", "error", false]]);
    expect((await chat("/reset")).reply).toMatch(/已清空/);
    expect((await chat("hello again")).reply).toBe("好的");
  }, 120_000);

  it("/stop ends a stuck turn right away; status and the info panel show where it is", async () => {
    const conv = encodeURIComponent((await console_()).conversationId);
    const pending = chat("HANG again");
    let turn: any = null;
    for (let i = 0; i < 200 && !turn?.steps?.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      turn = (await api(`/conversations/${conv}/turn`)).turn;
    }
    expect(turn.steps.at(-1)).toMatchObject({ kind: "model", title: "mock-agent", status: "running" });
    expect((await chat("/status")).reply).toMatch(/本会话上一条消息还在处理（已 \d+ 秒，1 步，现在：等待 mock-agent 回复），新消息会排在它后面。发送 \/stop 可以中止/);
    expect((await chat("/stop")).reply).toMatch(/^正在中止上一条消息（已处理 \d+ 秒）…$/);
    expect((await pending).reply).toMatch(/^已中止（处理了 \d+ 秒）。代理进程已重启，可以继续发消息。$/);
    expect((await api(`/conversations/${conv}/turn`)).turn).toBeNull();
    expect((await chat("/stop")).reply).toBe("当前没有正在处理的消息。");
    expect((await chat("/reset")).reply).toMatch(/已清空/);
    expect((await chat("hello once more")).reply).toBe("好的");
  }, 120_000);

  // —— 网页对话：切走再切回接上进行中的回合；停止按钮在各种状态下都停得下来 ——
  const stream = (p: string, text?: string) => {
    const ac = new AbortController();
    const events: Array<[string, any]> = [];
    const done = (async () => {
      const res = await fetch(`${base}/amb/api${p}`, text === undefined ? { signal: ac.signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: ac.signal });
      let buf = "";
      const dec = new TextDecoder();
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += dec.decode(chunk, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (ev && data) events.push([ev, JSON.parse(data)]);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") throw e;
      }
    })();
    const texts = () => events.filter(([e]) => e === "text").map(([, d]) => d.text as string);
    return { events, done, abort: () => ac.abort(), texts };
  };
  const stopWeb = async () => api(`/conversations/${encodeURIComponent("default:web:console")}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return;
    throw new Error("waitFor: timeout");
  };

  it("web chat: a running agent turn is shown again after switching back (question + steps), re-attaches, and the stop button ends it", async () => {
    const s = stream("/bots/default/chat/stream", "HANG 网页里的这条");
    let d: any;
    await waitFor(async () => !!(d = await api("/bots/default/chat")).live?.[0]?.steps?.length);
    expect(d.live[0]).toMatchObject({ userText: "HANG 网页里的这条", stopping: false });
    expect(d.live[0].steps.at(-1)).toMatchObject({ kind: "model", title: "mock-agent", status: "running" });
    // 代理路径回合结束才存用户消息：进行中时由 live 显示
    expect(d.messages.map((m: any) => m.content)).not.toContain("HANG 网页里的这条");
    expect((await api("/agent")).busy).toEqual(["default"]);
    // 切走：断开发消息的请求，回合照常进行
    s.abort();
    await new Promise((r) => setTimeout(r, 300));
    expect((await api(`/conversations/${encodeURIComponent(d.conversationId)}/turn`)).turn).not.toBeNull();
    // 切回：接上，先 snapshot（步骤还在），再停止
    const a = stream("/bots/default/chat/live");
    await waitFor(() => a.events.length > 0);
    expect(a.events[0][0]).toBe("snapshot");
    expect(a.events[0][1]).toMatchObject({ id: d.live[0].id, userText: "HANG 网页里的这条", startedAt: d.live[0].startedAt });
    expect(a.events[0][1].steps.length).toBeGreaterThan(0);
    const t0 = Date.now();
    expect(await stopWeb()).toEqual({ stopped: true });
    await a.done;
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(a.events.map(([e]) => e)).toContain("stopping");
    const final = a.texts().at(-1)!;
    expect(final).toMatch(/^已中止（处理了 \d+ 秒）。代理进程已重启，可以继续发消息。$/);
    expect(a.events.at(-1)![0]).toBe("done");
    const after = await api("/bots/default/chat");
    expect(after.live).toEqual([]);
    expect(after.messages.filter((m: any) => m.content === "HANG 网页里的这条")).toHaveLength(1);
    expect(after.messages.slice(-2).map((m: any) => [m.role, m.content])).toEqual([
      ["user", "HANG 网页里的这条"],
      ["assistant", final],
    ]);
    expect((await api("/agent")).busy).toEqual([]);
    expect((await chat("/reset")).reply).toMatch(/已清空/);
  }, 120_000);

  it("web chat: stop while the agent is still starting ends the message at once; the agent never gets it", async () => {
    const h = app.agent.host("default");
    await h.restart();
    expect(h.state).toBe("stopped");
    // 启动慢一点（真实冷启动可能要几分钟）
    const ensure = h.ensure.bind(h);
    (h as any).ensure = async (m: string) => (await new Promise((r) => setTimeout(r, 5000)), ensure(m));
    const before = calls.length;
    try {
      const s = stream("/bots/default/chat/stream", "hello while starting");
      await waitFor(() => s.texts().some((t) => t.startsWith("代理正在启动")));
      expect((await api("/bots/default/chat")).live[0].text).toMatch(/^代理正在启动/);
      const t0 = Date.now();
      expect(await stopWeb()).toEqual({ stopped: true });
      await s.done;
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(s.texts().at(-1)).toMatch(/^已中止（处理了 \d+ 秒）。$/);
      expect(s.events.at(-1)![0]).toBe("done");
      expect(app.agent.turnsInProgress.size).toBe(0);
    } finally {
      delete (h as any).ensure;
    }
    await new Promise((r) => setTimeout(r, 5500));
    expect(calls.slice(before).some((c) => JSON.stringify(c.body).includes("hello while starting"))).toBe(false);
    expect((await chat("/reset")).reply).toMatch(/已清空/);
    expect((await chat("hello after the stop")).reply).toBe("好的");
  }, 120_000);

  it("web chat: stop while a question card waits cancels the card and ends the turn", async () => {
    const s = stream("/bots/default/chat/stream", "ASKQ 然后停下");
    await waitFor(() => s.events.some(([e]) => e === "prompt"), 60_000);
    const id = s.events.find(([e]) => e === "prompt")![1].requestId;
    expect((await api(`/bots/default/chat`)).live[0].prompts.map((p: any) => p.requestId)).toEqual([id]);
    expect(await stopWeb()).toEqual({ stopped: true });
    await s.done;
    expect(s.texts().at(-1)).toMatch(/^已中止（处理了 \d+ 秒）。代理进程已重启，可以继续发消息。$/);
    expect((await api(`/approvals/${id}`)).approval.status).toBe("cancelled");
    expect((await chat("/reset")).reply).toMatch(/已清空/);
    expect((await chat("hello once again")).reply).toBe("好的");
  }, 120_000);

  it("a normal agent reply records its model and tool steps", async () => {
    const r = await chat("QUICKSORT again");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    const d = await console_();
    const a = await api(`/conversations/${encodeURIComponent(d.conversationId)}/messages/${d.messages.at(-1).id}/activity`);
    expect(a.steps.map((s: any) => [s.kind, s.status])).toEqual([["model", "ok"], ["tool", "ok"], ["model", "ok"]]);
    expect(a.steps[1]).toMatchObject({ title: "bash", output: expect.stringContaining("[1, 2, 3, 5, 7, 9]") });
  }, 120_000);

  // —— 按模型选接口：Modelflare 目录里有 Responses 就走 Responses，只有 Anthropic 的（Claude）走 Messages ——
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  /** 用一个微信会话（可单独设模型）发一条消息：回复与这一轮的步骤 */
  const turnOn = async (user: string, model: string, text: string, images: Buffer[] = []) => {
    const conv = app.store.ensureConversation("default", "weixin", user, user, "dm");
    app.store.setConversationModel(conv.id, model);
    const ops: any[] = [];
    const parts = [{ type: "text" as const, text }, ...images.map((data) => ({ type: "image" as const, data, mime: "image/png" }))];
    await app.runtime.handle({ id: `${user}-${rnd()}`, channel: "weixin", botId: "default", conversation: { kind: "dm", id: user }, sender: { id: user }, parts, replyHandle: {}, receivedAt: Date.now() }, { apply: async (op) => void ops.push(op) });
    const msgs = (await api(`/conversations/${encodeURIComponent(conv.id)}/messages`)).messages;
    const activity = await api(`/conversations/${encodeURIComponent(conv.id)}/messages/${msgs.at(-1).id}/activity`);
    return { reply: ops.find((o) => o.type === "stream.finish")?.text as string, steps: (activity.steps ?? []) as any[] };
  };
  const callsFor = (model: string, from: number) => calls.slice(from).filter((c) => c.model === model);

  it("a model offering the Responses API is driven over /v1/responses: tool calls, encrypted reasoning replay, usage", async () => {
    catalog["gpt-6-mock"] = ["openai", "openai-response", "openai-response-compact"];
    const from = calls.length;
    const r = await turnOn("resp-user", "gpt-6-mock", "QUICKSORT over responses");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(app.agent.host("default").api).toBe("openai-responses");
    const mine = callsFor("gpt-6-mock", from);
    expect(mine.map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual(mine.map(() => "responses:ok"));
    const [first, second] = mine.filter((c) => c.body.tools);
    // 推理模型：要加密推理（store:false 下回放靠它），默认强度 medium
    expect(first.body).toMatchObject({ stream: true, store: false, reasoning: { effort: "medium" }, include: ["reasoning.encrypted_content"] });
    // 系统提示是 system 角色；工具显式 strict:false
    expect(first.body.input[0].role).toBe("system");
    expect(first.body.input.some((i: any) => i.role === "developer")).toBe(false);
    expect(first.body.tools.every((t: any) => t.type === "function" && t.strict === false)).toBe(true);
    // 第二次请求带回推理（含 encrypted_content）、工具调用与结果
    expect(second.body.input.find((i: any) => i.type === "reasoning")?.encrypted_content).toMatch(/^enc-/);
    const fc = second.body.input.find((i: any) => i.type === "function_call");
    expect(fc).toMatchObject({ name: "bash", id: expect.stringMatching(/^fc_/) });
    expect(second.body.input.find((i: any) => i.type === "function_call_output")).toMatchObject({ call_id: fc.call_id, output: expect.stringContaining("[1, 2, 3, 5, 7, 9]") });
    expect(mine.every((c) => c.headers.authorization === "Bearer gw-key")).toBe(true);
    // 步骤与用量照常记录
    expect(r.steps.map((s) => [s.kind, s.status])).toEqual([["model", "ok"], ["tool", "ok"], ["model", "ok"]]);
    expect(r.steps[0].tokens).toEqual({ input: 10, output: 5 });
  }, 180_000);

  it("Claude (Anthropic but no Responses) is driven over /v1/messages; the bridge swaps x-api-key for the real key", async () => {
    catalog["claude-mock"] = ["anthropic", "openai"];
    const from = calls.length;
    const r = await turnOn("claude-user", "claude-mock", "QUICKSORT over messages");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(app.agent.host("default").api).toBe("anthropic-messages");
    const mine = callsFor("claude-mock", from);
    expect(mine.map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual(mine.map(() => "messages:ok"));
    const [first, second] = mine.filter((c) => c.body.tools);
    expect(first.body).toMatchObject({ stream: true, max_tokens: 32_000 });
    expect(first.body.thinking).toBeUndefined();
    expect(second.body.messages.at(-1).content.some((b: any) => b.type === "tool_result")).toBe(true);
    for (const c of mine) {
      expect(c.headers["anthropic-version"]).toBeTruthy();
      expect(c.headers.authorization).toBe("Bearer gw-key");
      expect(c.headers["x-api-key"]).toBe("gw-key");
      // 子进程只有 bridge 令牌，它不会到上游
      expect(JSON.stringify(c.headers)).not.toContain(app.agent.bridge.token);
    }
    expect(r.steps.map((s) => [s.kind, s.status])).toEqual([["model", "ok"], ["tool", "ok"], ["model", "ok"]]);
    expect(r.steps[0].tokens).toEqual({ input: 10, output: 5 });
  }, 180_000);

  it("transient upstream errors are retried over Responses and Messages as over Chat", async () => {
    for (const [model, api, status] of [["gpt-6-mock", "responses", "503"], ["claude-mock", "messages", "429"]]) {
      const from = calls.length;
      const r = await turnOn(`flaky-${api}`, model, `FLAKY over ${api}`);
      expect(r.reply).toBe("好的");
      expect(callsFor(model, from).filter((c) => c.body.tools).map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual([`${api}:${status}`, `${api}:ok`]);
      expect(r.steps.some((s) => s.kind === "retry")).toBe(true);
      // 限流、上游故障不是接口的问题：不回退
      expect(app.agent.apiFallbacks.get(model)).toBeUndefined();
    }
  }, 180_000);

  // —— 安全网：Responses / Messages 被上游拒绝（请求形状不被接受）→ 这个模型改走 Chat Completions ——
  const fallbackFile = () => JSON.parse(fs.readFileSync(path.join(dataDir, "dsh", "api-fallback.json"), "utf8")).models;

  it("a 400 on /v1/responses: the turn is redone over Chat Completions, and the model stays on Chat", async () => {
    catalog["deepseek-mock"] = ["openai", "openai-response", "anthropic", "gemini"];
    rejects["deepseek-mock"] = "always";
    const host = app.agent.host("default");
    const from = calls.length;
    const r = await turnOn("fb-user", "deepseek-mock", "QUICKSORT despite rejection");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    const mine = callsFor("deepseek-mock", from).filter((c) => c.body.tools);
    expect(mine.map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual(["responses:400", "chat:ok", "chat:ok"]);
    // 重做的那次：用户这条消息只交给模型一次，工具只跑一次
    const users = mine[1].body.messages.filter((m: any) => m.role === "user" && /QUICKSORT despite/.test(textOf(m.content)));
    expect(users).toHaveLength(1);
    expect(textOf(mine[1].body.messages.findLast((m: any) => m.role === "user").content)).toBe(RETRY_NOTE);
    expect(r.steps.filter((s) => s.kind === "tool")).toHaveLength(1);
    expect(r.steps.find((s) => s.kind === "retry")).toMatchObject({ title: "改用 Chat Completions 重试", summary: expect.stringContaining("HTTP 400: Unsupported parameter") });
    // 状态、故障排查、磁盘上的记录（按去掉前缀的模型 id，24 小时）
    expect(host.api).toBe("openai-completions");
    expect(host.status().api).toBe("openai-completions (fallback: HTTP 400: Unsupported parameter: 'reasoning.summary' is not supported with this model.)");
    const diag = ((await (await fetch(`${base}/amb/api/diagnostics`)).json()) as any).agent;
    expect(diag.hosts.default.api).toContain("fallback: HTTP 400");
    expect(diag.apiFallbacks.map((f: any) => [f.model, f.from])).toContainEqual(["deepseek-mock", "openai-responses"]);
    const rec = fallbackFile()["deepseek-mock"];
    expect(rec).toMatchObject({ from: "openai-responses", reason: expect.stringContaining("HTTP 400") });
    expect(rec.until - rec.at).toBe(24 * 3600_000);
    expect(JSON.stringify(fallbackFile())).not.toContain("gw-key");

    // 下一轮直接走 Chat，不再先试 Responses
    const next = calls.length;
    expect((await turnOn("fb-user", "deepseek-mock", "QUICKSORT again on chat")).reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(callsFor("deepseek-mock", next).map((c) => c.api)).toEqual(callsFor("deepseek-mock", next).map(() => "chat"));
  }, 180_000);

  it("a persistent 503 is not a rejection of the API: no fallback, the turn fails as before", async () => {
    catalog["gpt-busy"] = ["openai", "openai-response"];
    rejects["gpt-busy"] = "busy";
    const from = calls.length;
    const r = await turnOn("busy-user", "gpt-busy", "hello busy");
    expect(r.reply).toMatch(/⚠️/);
    const mine = callsFor("gpt-busy", from).filter((c) => c.body.tools);
    expect(mine.length).toBeGreaterThan(1); // 代理自己重试过
    expect(mine.every((c) => c.api === "responses" && c.error === "503")).toBe(true);
    expect(app.agent.apiFallbacks.get("gpt-busy")).toBeUndefined();
    expect(app.agent.host("default").api).toBe("openai-responses");
    expect(r.steps.some((s) => s.title === "改用 Chat Completions 重试")).toBe(false);
  }, 180_000);

  it("a rejection after a tool ran is not redone (the tool is not run twice), but the next turn uses Chat", async () => {
    catalog["glm-mock"] = ["openai", "openai-response", "anthropic"];
    rejects["glm-mock"] = "after-tool";
    const counter = path.join(dataDir, "workspaces", "default", "counter.txt");
    fs.rmSync(counter, { force: true });
    const from = calls.length;
    const r = await turnOn("after-tool-user", "glm-mock", "COUNTER once");
    expect(r.reply).toMatch(/⚠️/);
    expect(r.reply).toContain("Unsupported parameter");
    expect(fs.readFileSync(counter, "utf8")).toBe("ran\n");
    expect(callsFor("glm-mock", from).filter((c) => c.body.tools).map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual(["responses:ok", "responses:400"]);
    expect(app.agent.apiFallbacks.get("mfb-x/glm-mock")).toMatchObject({ from: "openai-responses" });

    const next = calls.length;
    const again = await turnOn("after-tool-user", "glm-mock", "COUNTER twice");
    expect(again.reply).toContain("RESULT<<2");
    expect(fs.readFileSync(counter, "utf8")).toBe("ran\nran\n");
    expect(callsFor("glm-mock", next).filter((c) => c.body.tools).map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual(["chat:ok", "chat:ok"]);
    expect(app.agent.host("default").status().api).toMatch(/^openai-completions \(fallback: HTTP 400/);
  }, 180_000);

  it("vision models get the image itself over Responses and Messages too", async () => {
    if (!app.agent.host("default").imageInput) return; // Linux 上的 Electron：只给路径（见上一个图片用例）
    expect((await turnOn("resp-img", "gpt-6-mock", "LOOKIMG", [png])).reply).toMatch(/^SEEN<<data:image\/(png|jpeg|webp);base64\|path>>$/);
    expect(calls.at(-1)?.api).toBe("responses");
    expect((await turnOn("claude-img", "claude-mock", "LOOKIMG", [png])).reply).toMatch(/^SEEN<<data:image\/(png|jpeg|webp);base64\|path>>$/);
    expect(calls.at(-1)?.api).toBe("messages");
  }, 180_000);

  it("AMB_AGENT_API=chat forces Chat Completions; a conversation started over Chat continues over Responses", async () => {
    catalog["gpt-7-switch"] = ["openai", "openai-response"];
    const host = app.agent.host("default");
    process.env.AMB_AGENT_API = "chat";
    try {
      const r = await turnOn("switch-user", "gpt-7-switch", "QUICKSORT first");
      expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
      expect(host.api).toBe("openai-completions");
      expect(calls.at(-1)).toMatchObject({ api: "chat", model: "gpt-7-switch" });
    } finally {
      delete process.env.AMB_AGENT_API;
    }
    // 接口只在拉起子进程时选：重启后同一会话改走 Responses，上一轮 Chat 里的工具调用照样回放
    await host.restart();
    const from = calls.length;
    const r = await turnOn("switch-user", "gpt-7-switch", "QUICKSORT second");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(host.api).toBe("openai-responses");
    const mine = callsFor("gpt-7-switch", from).filter((c) => c.body.tools);
    expect(mine.map((c) => `${c.api}:${c.error ?? "ok"}`)).toEqual(mine.map(() => "responses:ok"));
    expect(mine[0].body.input.filter((i: any) => i.type === "function_call_output")).toHaveLength(1);
  }, 180_000);

  // —— 完全权限：不进沙箱、不请求提权；递归删除仍经审批 ——
  const setPermission = async (permission: string) => {
    const r = (await api("/bots/default/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ permission }) })) as any;
    expect(r.settings.permission).toBe(permission);
  };
  const approvalCount = () => app.store.listApprovals({ limit: 500 }).length;
  const pendingApproval = async () => {
    for (let i = 0; i < 300; i++) {
      const row = ((await api("/approvals?status=pending")) as any).approvals[0];
      if (row) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    return undefined;
  };

  it("workspace (default): writes outside the workspace stay in the sandbox, escalation asks", async () => {
    const pending = chat("OUTWRITE workspace");
    // 第二步显式要 danger-full-access：工作区模式下要审批（这里拒绝）
    const row = await pendingApproval();
    expect(row?.tool).toBe("bash");
    await api(`/approvals/${row.id}/deny`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const r = await pending;
    expect(r.reply).toContain("DB-HIDDEN");
    expect(r.reply).not.toContain("escalated-42");
    expect(fs.existsSync(path.join(outside, "marker.txt"))).toBe(false);
  }, 120_000);

  it("full: commands run unsandboxed with no approval prompt; the loopback API stays blocked", async () => {
    await setPermission("full");
    const before = approvalCount();
    const r = await chat("OUTWRITE full");
    expect(r.reply).toContain("out-42");
    expect(r.reply).toContain("DB-READABLE");
    expect(r.reply).toContain("escalated-42");
    expect(fs.readFileSync(path.join(outside, "marker.txt"), "utf8").trim()).toBe("out-42");
    expect(approvalCount()).toBe(before);
    expect(r.prompts).toEqual([]);
    expect((await chat("LOOPBACK full")).reply).toContain("API 403");
    expect((await chat("/status")).reply).toMatch(/运行方式：代理模式（DeepSeek Harness，完全权限：不经沙箱）\n注意：完全权限下命令以你的用户身份直接运行/);
  }, 180_000);

  it("full: rm -rf asks first; deny keeps the directory, a plain rm does not ask", async () => {
    fs.writeFileSync(path.join(outside, "single.txt"), "x");
    fs.mkdirSync(path.join(outside, "victim", "sub"), { recursive: true });
    fs.writeFileSync(path.join(outside, "victim", "sub", "f.txt"), "keep me");
    const pending = chat("RMRF deny");
    const row = await pendingApproval();
    expect(row).toMatchObject({ tool: "bash", reason: "递归删除，需要你确认（rm -rf）" });
    expect(row.detail).toContain(`rm -rf ${outside}/victim`);
    // 第一步的普通删除已经执行了，没有问
    expect(fs.existsSync(path.join(outside, "single.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outside, "victim"))).toBe(true);
    const no = await fetch(`${base}/amb/api/approvals/${row.id}/deny`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(no.status).toBe(200);
    const r = await pending;
    expect(r.reply).toContain("single-gone");
    expect(r.reply).toMatch(/rejected/);
    expect(r.reply).not.toContain("victim-gone");
    expect(fs.readFileSync(path.join(outside, "victim", "sub", "f.txt"), "utf8")).toBe("keep me");
    expect(r.prompts[0]?.prompt).toMatch(new RegExp(`需批准: bash \`rm -rf ${outside}/victim && echo victim-gone\` — 回复 y ${row.code} / n ${row.code}`));
  }, 180_000);

  it("full: approving the recursive delete runs it once", async () => {
    fs.writeFileSync(path.join(outside, "single.txt"), "x");
    const pending = chat("RMRF allow");
    const row = await pendingApproval();
    expect(row?.detail).toContain("rm -rf");
    const ok = await fetch(`${base}/amb/api/approvals/${row.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(ok.status).toBe(200);
    const r = await pending;
    expect(r.reply).toContain("victim-gone");
    expect(fs.existsSync(path.join(outside, "victim"))).toBe(false);
    expect(app.store.getApproval(row.id)!.status).toBe("allowed");
  }, 180_000);

  it("full: a subagent's recursive delete is gated too", async () => {
    fs.mkdirSync(path.join(outside, "victim2", "sub"), { recursive: true });
    const pending = chat("SUBRM please");
    const row = await pendingApproval();
    expect(row).toMatchObject({ tool: "bash", reason: "递归删除，需要你确认（rm -rf）" });
    await api(`/approvals/${row.id}/deny`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await pending;
    expect(fs.existsSync(path.join(outside, "victim2", "sub"))).toBe(true);
  }, 180_000);

  it("back to workspace: recursive deletes inside the workspace run without asking, as before", async () => {
    await setPermission("workspace");
    const before = approvalCount();
    const r = await chat("RMWS check");
    expect(r.reply).toContain("tree-gone");
    expect(approvalCount()).toBe(before);
    expect((await chat("/status")).reply).toContain("运行方式：代理模式（DeepSeek Harness，工作区沙箱）");
  }, 180_000);
});
