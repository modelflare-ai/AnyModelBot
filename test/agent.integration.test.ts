import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import module from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RETRY_NOTE, SHELL_LIMITS, locateDshRuntime } from "../src/agent/host.js";
import { CHAT_RULES, MEMORY_GUIDE, botIdentity } from "../src/agent/prompts/index.js";
import { STEER_ACK } from "../src/core/runtime.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { listen, mockIlink } from "./helpers.js";

/**
 * 真实 DSH 子进程 + 脚本化的模型（会发出工具调用），Chat Completions、Responses、Anthropic Messages 三种接口都能答。
 * 验证：插件加载、bridge 注入密钥、bash 沙箱、审批流程（API 批准/拒绝）、读围栏、回环 API 防护、按模型选接口。
 * 服务端压缩（server-compaction.ts）全程接着：目录列出压缩端点的模型，压缩端点就是这个 mock。
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
  const calls: Array<{ api: "chat" | "responses" | "messages"; model: string; body: any; headers: http.IncomingHttpHeaders; error?: string; sealed?: boolean }> = [];
  /** 服务端压缩：/v1/responses/compact 收到的请求；sealedRejects 里的模型，带 compaction 项的 Responses 请求一律 400 */
  const compacts: Array<{ model: string; body: any }> = [];
  const sealedRejects = new Set<string>();
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
      if (messages[i].role === "user" && /QUICKSORT|ESCALATE|SECRET|READFILE|LOOPBACK|PRESENT|ASKQ|NATIVES|LOOKIMG|HANG|COUNTER|OUTWRITE|RMRF|RMWS|CHILDRM|SUBRM|SUBASK|SUBHELLO|PADDED|STEERME|SLOWOK|BGJOB|TOKENS|^background job |\[用户消息\]/.test(textOf(messages[i].content))) { lastUser = i; break; }
    }
    const user = textOf(messages[lastUser]?.content);
    const tools = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
    // 卡住的模型：请求收下了，一直不回
    if (/HANG/.test(user)) return { hang: true };
    // 插话：先跑一条几秒的命令；命令结束后看有没有并进来的用户消息（文字、图片）
    if (/STEERME/.test(user)) {
      const later = messages.slice(lastUser + 1).filter((m) => m.role === "user");
      const img = later.find((m) => Array.isArray(m.content) && m.content.some((p: any) => p?.type === "image_url"));
      if (img) return { text: `SAWIMG<<${img.content.filter((p: any) => p?.type === "image_url").map((p: any) => String(p.image_url?.url ?? "").split(",")[0]).join(" ")}|${/\[图片 inbox\/[^\]]+\.png\]/.test(textOf(img.content)) ? "path" : "nopath"}>>` };
      const steered = later.find((m) => /STEERTEXT/.test(textOf(m.content)));
      if (steered) return { text: `SAW<<${textOf(steered.content)}>>` };
      if (!tools.length) return { tool: { name: "bash", args: { description: "run", command: "sleep 3 && echo first-done" } } };
      return { text: "NOSTEER" };
    }
    // 后台命令结束，代理被唤醒：读它的输出，再跑一条一秒的命令（这一轮有时间看 /status），然后回复
    if (/^background job /.test(user)) {
      const id = /^background job (\S+)/.exec(user)?.[1];
      if (tools.length === 0) return { tool: { name: "job_output", args: { job_id: id } } };
      if (tools.length === 1) return { tool: { name: "bash", args: { description: "run", command: "sleep 1 && echo wake-step" } } };
      return { text: `BGDONE<<${tools.map((t) => textOf(t.content)).join("|")}>>` };
    }
    // 长回复：让会话历史很快长过系统提示和工具（服务端压缩用例）
    if (/PADDED/.test(user)) return { text: "PADDED-OK " + "z".repeat(12_000) };
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
      [/SLOWOK/, [{ name: "bash", args: { description: "run", command: "sleep 4 && echo slow-done" } }]],
      // 跑得比转后台的阈值久：命令转到后台，这一轮先回复"还在跑"
      [/BGJOB/, [{ name: "bash", args: { description: "run", command: "sleep 4 && echo bg-finished-42" } }]],
      [/TOKENS/, [{ name: "bash", args: { description: "run", command: "echo token=${AMB_BRIDGE_TOKEN:-none} control=${AMB_CONTROL_TOKEN:-none} key=${AMB_MAGPIE_KEY:-none} url=${AMB_BRIDGE_URL:-none}" } }]],
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
      [/SUBASK/, [{ name: "subagent", args: { description: "hello", prompt: "SUBHELLO now" } }]],
    ];
    for (const [re, steps] of scripts) {
      if (!re.test(user)) continue;
      if (tools.length < steps.length) return { tool: steps[tools.length] };
      if (/BGJOB/.test(user)) return { text: `STILL-RUNNING<<${tools.map((t) => textOf(t.content)).join("|")}>>` };
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
      // 服务端压缩的压缩端点：照 Modelflare 实测的样子回（object 是 response，output 只有一个 compaction 项）
      if (url.endsWith("/v1/responses/compact")) {
        compacts.push({ model: b.model, body: b });
        const item = { type: "compaction", id: "cmp_" + rnd(), status: "completed", summary: "earlier turns", encrypted_content: `ENC.${b.model}.${compacts.length}` };
        const usage = { input_tokens: 900, output_tokens: 1200, output_tokens_details: { reasoning_tokens: 1000 }, total_tokens: 2100 };
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "resp_" + rnd(), object: "response", status: "completed", model: b.model, output: [item], usage }));
      }
      const api = url.endsWith("/v1/responses") ? "responses" : url.endsWith("/v1/messages") ? "messages" : "chat";
      const sealed = api === "responses" && (b.input ?? []).some((it: any) => it?.type === "compaction");
      const msgs = api === "responses" ? fromResponses(b.input) : api === "messages" ? fromAnthropic(b.messages) : b.messages;
      const error = api === "responses" ? responsesError(b) : api === "messages" ? messagesError(b) : undefined;
      const said = (msgs ?? []).filter((m: any) => m.role === "user").map((m: any) => textOf(m.content)).findLast((t: string) => /FLAKY/.test(t));
      const flaky = api !== "chat" && b.tools && said && !flaked.has(said) ? (flaked.add(said), api === "responses" ? 503 : 429) : 0;
      calls.push({ api, model: b.model, body: b, headers: req.headers, error: error ?? (flaky ? `${flaky}` : undefined), sealed });
      if (error) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: error } }));
      if (flaky) return void res.writeHead(flaky, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: flaky === 429 ? "rate_limit_error" : "api_error", message: "slow down" } }));
      // Modelflare 实测：带着 compaction 项的 /v1/responses 回 400「无效的参数」
      if (sealed && sealedRejects.has(b.model)) {
        calls[calls.length - 1].error = "400";
        return void res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message: `无效的参数 (request id: ${rnd()})`, type: "invalid_request_error", param: "", code: "invalid_request" } }));
      }
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
      // 非流式的 Responses（服务端压缩探测的续接请求）
      if (api === "responses" && b.stream === false) {
        const msg = { type: "message", id: "msg_" + rnd(), role: "assistant", status: "completed", content: [{ type: "output_text", text: step.text ?? "", annotations: [] }] };
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "resp_" + rnd(), object: "response", status: "completed", model: b.model, output: [msg], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
      }
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
    // 服务端压缩：外部端点模式下 App 不给压缩端点（代理只走 Chat）；这里按注入的目录打开，压缩端点就是这个 mock。
    // 模型窗口都很大，平常的用例到不了压缩线，只有压缩用例把线调低
    const sc = (app.agent as any).o.serverCompaction;
    sc.listed = async (model: string) => (catalog[model] ? catalog[model].includes("openai-response-compact") : undefined);
    sc.endpoint = (model: string) => ({ baseUrl: llm.url + "/v1", apiKey: "gw-key", model });
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

  // —— 系统提示词：我们的人设与机器人段（每次请求现读），而不是 DSH 的 coding agent 人设 ——
  /** 模型请求里的系统提示词（Chat：system 消息；Responses：instructions 与 system 条目；Messages：system） */
  const systemOf = (c: { api: string; body: any }): string => {
    if (c.api === "chat") return c.body.messages.filter((m: any) => m.role === "system" || m.role === "developer").map((m: any) => textOf(m.content)).join("\n\n");
    if (c.api === "messages") return textOf(c.body.system);
    return [c.body.instructions ?? "", ...(c.body.input ?? []).filter((it: any) => it.role === "system" || it.role === "developer").map((it: any) => textOf(it.content))].filter(Boolean).join("\n\n");
  };
  /** 带着这段文字的第一个模型请求（这一轮的第一步） */
  const requestFor = (marker: string) => calls.find((c) => c.body.tools && JSON.stringify(c.body).includes(marker))!;
  const userTexts = (c: { body: any }) => (c.body.messages ?? []).filter((m: any) => m.role === "user").map((m: any) => textOf(m.content)) as string[];
  const DEFAULT_PERSONA = "你是一个乐于助人的中文助手，回答简洁准确。";
  /**
   * 系统提示词加工具定义的字符数上限（DSH 自己的部分 + 我们的人设、机器人段和工具；基线 32,208 = 提示词 3,310 + 工具 28,898，上限高约 5%）。
   * 缩短了就调低；要调高，在提交说明里写清原因。电脑操作的 MCP 工具随平台变化，不计入。
   */
  const SURFACE_BUDGET = 33_800;

  it("the system prompt has our persona and the bot's section, not DSH's coding persona; the segment's first message has channel and memory", async () => {
    await chat("/reset");
    expect((await chat("SYSPROMPT one")).reply).toBe("好的");
    const c = requestFor("SYSPROMPT one");
    const sys = systemOf(c);
    // 第一段就是我们的人设（没有 "powered by DeepSeek Harness"），模型名由 DSH 填入
    expect(sys).toMatch(/^你是用户的个人助手，由 \S*mock-agent 模型驱动/);
    expect(sys).not.toMatch(/coding agent|DeepSeek Harness/);
    expect(sys).toContain(CHAT_RULES);
    expect(sys).toContain(MEMORY_GUIDE);
    // 机器人段在最后：名字和人设
    expect(sys.trimEnd().endsWith(botIdentity("我的助手", DEFAULT_PERSONA))).toBe(true);
    // 每段第一条消息：渠道、记忆快照、用户消息；人设和记忆说明不在这里
    const first = userTexts(c).find((t) => t.includes("SYSPROMPT one"))!;
    expect(first).toMatch(/^\[对话渠道\]\n本机网页对话/);
    expect(first).toContain("[长期记忆快照]");
    expect(first).toContain("[用户消息]\nSYSPROMPT one");
    expect(first).not.toContain(DEFAULT_PERSONA);
    expect(first).not.toContain("remember / forget / recall");
    const tools = (c.body.tools as any[]).filter((t) => !String(t.function?.name ?? t.name).startsWith("mcp__"));
    expect(sys.length + JSON.stringify(tools).length, `${sys.length} characters of prompt and ${JSON.stringify(tools).length} of tools`).toBeLessThanOrEqual(SURFACE_BUDGET);
  }, 120_000);

  it("an edited persona reaches the next model request of the same agent session (no /new); an unchanged one keeps the system prompt byte-identical", async () => {
    const conv = "default:web:console";
    const session = app.store.getAgentSession(conv);
    await chat("SYSPROMPT two");
    const before = systemOf(requestFor("SYSPROMPT two"));
    expect(before).toBe(systemOf(requestFor("SYSPROMPT one")));
    const put = (systemPrompt: string) => fetch(`${base}/amb/api/bots/default`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ systemPrompt }) });
    expect((await put("你是海盗船长，每句话都以 Arr 结尾。")).status).toBe(200);
    try {
      await chat("SYSPROMPT three");
      const after = systemOf(requestFor("SYSPROMPT three"));
      expect(after).toContain("你是海盗船长，每句话都以 Arr 结尾。");
      expect(after).not.toContain(DEFAULT_PERSONA);
      // 同一个代理会话；人设前面的部分一个字没变（前缀缓存）
      expect(app.store.getAgentSession(conv)).toBe(session);
      const head = (s: string) => s.slice(0, s.indexOf("# 机器人设定"));
      expect(head(after)).toBe(head(before));
    } finally {
      await put(DEFAULT_PERSONA);
    }
  }, 120_000);

  it("subagents do not get the bot's section: they do not talk to the user", async () => {
    const from = calls.length;
    await chat("SUBASK please");
    // 子代理在后台跑：等它发出第一个模型请求
    const childOf = () => calls.slice(from).find((c) => c.body.tools && userTexts(c).some((t) => t.includes("SUBHELLO")));
    for (let i = 0; i < 300 && !childOf(); i++) await new Promise((r) => setTimeout(r, 50));
    const child = childOf()!;
    expect(child).toBeTruthy();
    expect(systemOf(child)).not.toContain("# 聊天规则");
    expect(systemOf(child)).not.toContain("# 机器人设定");
    expect(systemOf(requestFor("SUBASK please"))).toContain("# 聊天规则");
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
      app.access.allow("default", "weixin", user, "test");
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

  it("a turn without progress is stopped by the watchdog: only that conversation's turn is cancelled (no restart), the reply keeps its steps", async () => {
    const o = (app.agent as any).o;
    const prev = o.idleTimeoutMs;
    o.idleTimeoutMs = 3000;
    try {
      expect((await chat("/reset")).reply).toMatch(/已清空/);
      expect((await chat("hello before the hang")).reply).toBe("好的");
      const pid = app.agent.host("default").pid;
      const t0 = Date.now();
      const r = await chat("HANG please");
      expect(r.reply).toBe("⚠️ 代理 3 秒没有任何进展，已自动中止。卡在：等待 mock-agent 回复。可以重新发送，或用 /model 换个模型试试。");
      expect(Date.now() - t0).toBeLessThan(30_000);
      expect(app.agent.host("default").pid).toBe(pid);
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
    expect((await chat("/status")).reply).toMatch(/本会话上一条消息还在处理（已 \d+ 秒，1 步，现在：等待 mock-agent 回复），新消息会并入正在进行的处理。发送 \/stop 可以中止/);
    const pid = app.agent.host("default").pid;
    expect((await chat("/stop")).reply).toMatch(/^正在中止上一条消息（已处理 \d+ 秒）…$/);
    expect((await pending).reply).toMatch(/^已中止（处理了 \d+ 秒）。可以继续发消息。$/);
    // 只中止了这个会话的回合（agent.cancel），代理进程没有重启
    expect(app.agent.host("default").pid).toBe(pid);
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
    expect(final).toMatch(/^已中止（处理了 \d+ 秒）。可以继续发消息。$/);
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
    expect(s.texts().at(-1)).toMatch(/^已中止（处理了 \d+ 秒）。可以继续发消息。$/);
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
    app.access.allow("default", "weixin", user, "test");
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

  // —— 服务端压缩：改写过（换上压缩历史）的请求被拒，bridge 先用原请求重发；这不算接口被拒，模型不改走 Chat ——
  it("server compaction over Responses: a rewritten request the upstream rejects is resent unmodified; no Chat fallback", async () => {
    const M = "gpt-6-compact-mock";
    catalog[M] = ["openai", "openai-response", "openai-response-compact"];
    const sc = app.agent.serverCompaction!;
    const host = app.agent.host("default");
    process.env.AMB_SERVER_COMPACTION_TOKENS = "2000";
    try {
      const from = calls.length;
      // 过线：后台探测（直连压缩 + 经网关续接）；会话往后长、历史长过系统提示后在后台压缩，下一轮带着压缩窗口发
      let n = 0;
      while (!callsFor(M, from).some((c) => c.sealed && c.body.stream) && n < 8) {
        expect((await turnOn("sc-user", M, `PADDED ${++n}`)).reply).toMatch(/^PADDED-OK z+$/);
        await sc.settled();
      }
      expect(sc.status()[M]).toMatchObject({ ok: true, reason: "probe passed" });
      expect(compacts.filter((c) => c.model === M).length).toBeGreaterThanOrEqual(2);
      const first = callsFor(M, from).find((c) => c.sealed && c.body.stream)!;
      expect(first).toBeDefined();
      expect(first.error).toBeUndefined();
      expect(first.body.input[0].role).toBe("system");
      expect(host.api).toBe("openai-responses");

      // 上游开始拒收 compaction 项（Modelflare 实测的 400「无效的参数」）：bridge 用原请求重发，回合照常
      sealedRejects.add(M);
      const next = calls.length;
      const r = await turnOn("sc-user", M, `PADDED ${++n}`);
      expect(r.reply).toMatch(/^PADDED-OK z+$/);
      const mine = callsFor(M, next).filter((c) => c.body.tools && c.body.stream);
      expect(mine.map((c) => `${c.api}:${c.sealed ? "sealed" : "plain"}:${c.error ?? "ok"}`)).toEqual(["responses:sealed:400", "responses:plain:ok"]);
      // 不改走 Chat：没有回退记录，代理进程仍走 Responses，活动里没有"改用 Chat Completions 重试"
      expect(app.agent.apiFallbacks.get(M)).toBeUndefined();
      expect(host.api).toBe("openai-responses");
      expect(r.steps.some((s) => s.kind === "retry")).toBe(false);
      expect(sc.status()[M]).toMatchObject({ ok: false, reason: expect.stringContaining("rewritten request rejected (400): 无效的参数") });

      // 之后原样发，照常走 Responses
      const after = calls.length;
      expect((await turnOn("sc-user", M, `PADDED ${++n}`)).reply).toMatch(/^PADDED-OK z+$/);
      const later = callsFor(M, after).filter((c) => c.body.tools);
      expect(later.length).toBeGreaterThan(0);
      expect(later.map((c) => `${c.api}:${c.sealed ? "sealed" : "plain"}:${c.error ?? "ok"}`)).toEqual(later.map(() => "responses:plain:ok"));
      expect(app.agent.apiFallbacks.get(M)).toBeUndefined();
    } finally {
      delete process.env.AMB_SERVER_COMPACTION_TOKENS;
      sealedRejects.delete(M);
      await sc.settled();
    }
  }, 300_000);

  it("server compaction: when the unmodified resend is rejected too, the Chat fallback still applies, with the original's reason", async () => {
    const M = "gpt-6-compact-fb-mock";
    catalog[M] = ["openai", "openai-response", "openai-response-compact"];
    const sc = app.agent.serverCompaction!;
    process.env.AMB_SERVER_COMPACTION_TOKENS = "2000";
    try {
      const from = calls.length;
      let n = 0;
      while (!callsFor(M, from).some((c) => c.sealed && c.body.stream) && n < 8) {
        expect((await turnOn("sc-fb", M, `PADDED ${++n}`)).reply).toMatch(/^PADDED-OK z+$/);
        await sc.settled();
      }
      expect(callsFor(M, from).some((c) => c.sealed && c.body.stream && !c.error)).toBe(true);
      // 改写的被拒（「无效的参数」），原请求重发后也被拒（参数不支持）：只有后者报给代理接口回退
      sealedRejects.add(M);
      rejects[M] = "always";
      const next = calls.length;
      const r = await turnOn("sc-fb", M, `PADDED ${++n}`);
      expect(r.reply).toMatch(/^PADDED-OK z+$/);
      const mine = callsFor(M, next).filter((c) => c.body.tools && c.body.stream);
      expect(mine.map((c) => `${c.api}:${c.sealed ? "sealed" : "plain"}:${c.error ?? "ok"}`)).toEqual(["responses:sealed:400", "responses:plain:400", "chat:plain:ok"]);
      const fb = app.agent.apiFallbacks.get(M);
      expect(fb).toMatchObject({ from: "openai-responses", reason: expect.stringContaining("HTTP 400: Unsupported parameter") });
      expect(fb!.reason).not.toContain("无效的参数");
      expect(r.steps.find((s) => s.kind === "retry")).toMatchObject({ title: "改用 Chat Completions 重试" });
      expect(app.agent.host("default").api).toBe("openai-completions");
    } finally {
      delete process.env.AMB_SERVER_COMPACTION_TOKENS;
      sealedRejects.delete(M);
      delete rejects[M];
      await sc.settled();
    }
  }, 300_000);

  it("server compaction probe on a grok-like upstream: compact works, the follow-up with its item is rejected → unsupported, no rewrite, no Chat fallback", async () => {
    const M = "gpt-6-grokish-mock";
    catalog[M] = ["openai", "openai-response", "openai-response-compact"];
    sealedRejects.add(M);
    const sc = app.agent.serverCompaction!;
    process.env.AMB_SERVER_COMPACTION_TOKENS = "2000";
    try {
      const from = calls.length;
      for (let n = 1; n <= 3; n++) {
        expect((await turnOn("sc-grok", M, `PADDED ${n}`)).reply).toMatch(/^PADDED-OK z+$/);
        await sc.settled();
      }
      expect(compacts.filter((c) => c.model === M)).toHaveLength(1);
      expect(sc.status()[M]).toMatchObject({ ok: false, reason: expect.stringMatching(/^probe: compact call ok, but the follow-up \/v1\/responses carrying its compaction item was rejected \(HTTP 400\): 无效的参数/) });
      // 探测的续接不经 bridge：不算这个机器人的请求被拒；真实请求都原样发、都成功
      const real = callsFor(M, from).filter((c) => c.body.stream);
      expect(real.length).toBeGreaterThan(0);
      expect(real.every((c) => c.api === "responses" && !c.sealed && !c.error)).toBe(true);
      expect(app.agent.apiFallbacks.get(M)).toBeUndefined();
      expect(app.agent.host("default").api).toBe("openai-responses");
    } finally {
      delete process.env.AMB_SERVER_COMPACTION_TOKENS;
      sealedRejects.delete(M);
      await sc.settled();
    }
  }, 300_000);

  // —— 实时控制：插话、按会话中止、同一进程里各会话各用各的模型、长命令转后台 ——
  /** 一个微信会话发一条消息，不等它结束：返回 { done（回复文字）, conv } */
  const startOn = (user: string, model: string, text: string, images: Buffer[] = []) => {
    const conv = app.store.ensureConversation("default", "weixin", user, user, "dm");
    app.access.allow("default", "weixin", user, "test");
    app.store.setConversationModel(conv.id, model);
    const ops: any[] = [];
    const parts = [{ type: "text" as const, text }, ...images.map((data) => ({ type: "image" as const, data, mime: "image/png" }))];
    const done = app.runtime
      .handle({ id: `${user}-${rnd()}`, channel: "weixin", botId: "default", conversation: { kind: "dm", id: user }, sender: { id: user }, parts, replyHandle: {}, receivedAt: Date.now() }, { apply: async (op) => void ops.push(op) })
      .then(() => ops.findLast((o) => o.type === "stream.finish" || o.type === "text")?.text as string);
    return { done, conv: conv.id, ops };
  };
  const toolRunning = async (conv: string) => ((await api(`/conversations/${encodeURIComponent(conv)}/turn`)) as any).turn?.steps?.some((s: any) => s.kind === "tool" && s.status === "running");

  it("a message sent while a turn runs is steered into it: one reply, history in order, the web live registry consistent, no restart", async () => {
    expect((await chat("/reset")).reply).toMatch(/已清空/);
    expect((await chat("hello before steering")).reply).toBe("好的");
    const host = app.agent.host("default");
    const pid = host.pid;
    const conv = (await console_()).conversationId;
    const first = chat("STEERME please");
    await waitFor(() => toolRunning(conv));
    const before = calls.length;
    const second = chat("STEERTEXT extra-xyz");
    // 网页的 live 登记里两条都在：第二条并进了第一条，没有自己的回复
    let d: any;
    await waitFor(async () => (d = await api("/bots/default/chat")).live?.length === 2 && d.live[1].steered);
    expect(d.live.map((t: any) => [t.userText, t.steered])).toEqual([
      ["STEERME please", false],
      ["STEERTEXT extra-xyz", true],
    ]);
    expect((await first).reply).toBe("SAW<<STEERTEXT extra-xyz>>");
    expect((await second).reply).toBe(STEER_ACK);
    // 第二条没有单独开一轮：之后的模型请求都带着第一条（同一轮里的下一步）
    expect(calls.slice(before).every((c) => JSON.stringify(c.body).includes("STEERME please"))).toBe(true);
    const after = await console_();
    expect(after.messages.slice(-3).map((m: any) => [m.role, m.content])).toEqual([
      ["user", "STEERME please"],
      ["user", "STEERTEXT extra-xyz"],
      ["assistant", "SAW<<STEERTEXT extra-xyz>>"],
    ]);
    expect(after.messages.filter((m: any) => m.content === "STEERTEXT extra-xyz")).toHaveLength(1);
    expect(((await api("/bots/default/chat")) as any).live).toEqual([]);
    const a = await api(`/conversations/${encodeURIComponent(conv)}/messages/${after.messages.at(-1).id}/activity`);
    expect(a.steps.some((s: any) => s.kind === "steer" && s.summary === "STEERTEXT extra-xyz")).toBe(true);
    expect(host.pid).toBe(pid);
  }, 120_000);

  it("an image sent while a turn runs reaches the agent with the steered message", async () => {
    if (!app.agent.host("default").imageInput) return; // Linux 上的 Electron：只给路径
    const a = startOn("steer-img", "gpt-5-mock", "STEERME with a picture");
    await waitFor(() => toolRunning(a.conv));
    const b = startOn("steer-img", "gpt-5-mock", "LOOKSTEER", [png]);
    expect(await a.done).toMatch(/^SAWIMG<<data:image\/(png|jpeg|webp);base64\|path>>$/);
    expect(await b.done).toBe(STEER_ACK);
    const hist = app.store.listMessages(a.conv).map((m) => [m.role, m.content.replace(/inbox\/\S+\.png/, "inbox/X.png")]);
    expect(hist.slice(-3)).toEqual([
      ["user", "STEERME with a picture"],
      ["user", "LOOKSTEER\n[图片 inbox/X.png]"],
      ["assistant", expect.stringMatching(/^SAWIMG<</)],
    ]);
  }, 120_000);

  it("/stop cancels only that conversation's turn: another conversation of the same bot keeps running, no restart", async () => {
    const host = app.agent.host("default");
    const pid = host.pid;
    const restarts = host.restarts;
    const b = startOn("stop-b", "mock-agent", "SLOWOK b");
    const a = startOn("stop-a", "mock-agent", "HANG stop-a");
    await waitFor(() => toolRunning(b.conv));
    await waitFor(async () => ((await api(`/conversations/${encodeURIComponent(a.conv)}/turn`)) as any).turn?.steps?.length > 0);
    expect(app.runtime.stop(a.conv)).toBe(true);
    expect(await a.done).toMatch(/^已中止（处理了 \d+ 秒）。可以继续发消息。$/);
    expect(await b.done).toContain("slow-done");
    expect(host.pid).toBe(pid);
    expect(host.restarts).toBe(restarts);
    expect(host.state).toBe("running");
  }, 120_000);

  it("each conversation runs on its own model in one agent process: a switch, even to a model the patch did not list, needs no restart", async () => {
    catalog["gpt-6-mock"] = ["openai", "openai-response", "openai-response-compact"];
    catalog["claude-switch-mock"] = ["anthropic", "openai"];
    const host = app.agent.host("default");
    expect(host.state).toBe("running");
    const pid = host.pid;
    expect((host.status() as any).models).not.toContain("claude-switch-mock");
    const from = calls.length;
    // 会话 X 在 gpt-6-mock（Responses）上跑一条几秒的命令；同时会话 Y 用一个新模型（Anthropic Messages）
    const x = startOn("switch-x", "gpt-6-mock", "SLOWOK on responses");
    await waitFor(() => toolRunning(x.conv));
    const y = await turnOn("switch-y", "claude-switch-mock", "QUICKSORT on a new model");
    expect(y.reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(await x.done).toContain("slow-done");
    expect(callsFor("claude-switch-mock", from).map((c) => c.api)).toEqual(callsFor("claude-switch-mock", from).map(() => "messages"));
    expect(callsFor("claude-switch-mock", from).length).toBeGreaterThan(0);
    expect(callsFor("gpt-6-mock", from).filter((c) => c.body.tools).every((c) => c.api === "responses")).toBe(true);
    // 每个请求都是它所在会话的模型
    for (const c of calls.slice(from).filter((c) => c.body.tools)) {
      const body = JSON.stringify(c.body);
      if (body.includes("SLOWOK on responses")) expect(c.model).toBe("gpt-6-mock");
      if (body.includes("QUICKSORT on a new model")) expect(c.model).toBe("claude-switch-mock");
    }
    // 会话 Y 再换回 gpt-6-mock：同一个会话、同一个进程
    const again = calls.length;
    expect((await turnOn("switch-y", "gpt-6-mock", "QUICKSORT after switching back")).reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(callsFor("gpt-6-mock", again).filter((c) => c.body.tools).every((c) => c.api === "responses")).toBe(true);
    expect(callsFor("claude-switch-mock", again)).toEqual([]);
    expect(host.pid).toBe(pid);
    expect((host.status() as any).models).toEqual(expect.arrayContaining(["gpt-6-mock", "claude-switch-mock"]));
  }, 180_000);

  it("tool processes never see the bridge token or the control channel id (DSH scrubs *TOKEN*/*KEY* from their environment)", async () => {
    const r = await chat("TOKENS check");
    expect(r.reply).toContain("token=none control=none key=none");
    expect(r.reply).not.toContain(app.agent.bridge.token);
    expect(r.reply).not.toContain(app.agent.host("default").control.id);
  }, 120_000);

  it("a long command moves to the background; the turn replies at once; when it ends the agent wakes and the follow-up reaches the chat", async () => {
    const host = app.agent.host("default");
    const saved = { ...SHELL_LIMITS };
    // 测试里把转后台的阈值调到 1.5 秒（真实是 30 秒），重启代理进程让补丁生效
    Object.assign(SHELL_LIMITS, { bashMs: 1500, bashMaxMs: 3000 });
    try {
      await host.restart();
      expect((await chat("/reset")).reply).toMatch(/已清空/);
      const conv = (await console_()).conversationId;
      const t0 = Date.now();
      const r = await chat("BGJOB now");
      expect(r.reply).toMatch(/^STILL-RUNNING<<\[still running after 1500ms; moved to background job bash-\S+\]/);
      // 没有等命令跑完（它要 4 秒）：这一轮的回复里还没有它的输出
      expect(r.reply).not.toContain("bg-finished-42");
      expect(Date.now() - t0).toBeLessThan(30_000);
      const first = await console_();
      const steps1 = (await api(`/conversations/${encodeURIComponent(conv)}/messages/${first.messages.at(-1).id}/activity`)).steps;
      expect(steps1.find((s: any) => s.kind === "job")).toMatchObject({ title: "后台命令", status: "ok", summary: expect.stringContaining("（回复时仍在后台运行）") });
      // 命令结束：代理被唤醒，宿主像普通回合一样跟着这一轮：网页 live 里有一条（没有用户消息），/status 和信息面板都认它
      let live: any;
      await waitFor(async () => !!(live = ((await api("/bots/default/chat")) as any).live.find((t: any) => t.userText === "")), 30_000);
      expect(live.steered).toBe(false);
      await waitFor(async () => !!((await api(`/conversations/${encodeURIComponent(conv)}/turn`)) as any).turn);
      expect((await chat("/status")).reply).toMatch(/本会话上一条消息还在处理/);
      expect((await api("/agent")).busy).toEqual(["default"]);
      // 回复存进历史、发到会话里
      let d: any;
      await waitFor(async () => /BGDONE/.test((d = await console_()).messages.at(-1)?.content ?? ""), 60_000);
      const reply = d.messages.at(-1);
      expect(reply.role).toBe("assistant");
      expect(reply.content).toContain("bg-finished-42");
      expect(reply.content).toContain("wake-step");
      expect(d.messages.slice(-3).map((m: any) => m.role)).toEqual(["user", "assistant", "assistant"]);
      const steps2 = (await api(`/conversations/${encodeURIComponent(conv)}/messages/${reply.id}/activity`)).steps;
      expect(steps2.map((s: any) => s.kind)).toEqual(expect.arrayContaining(["job", "model", "tool"]));
      await waitFor(async () => ((await api("/bots/default/chat")) as any).live.length === 0);
      expect(((await api(`/conversations/${encodeURIComponent(conv)}/turn`)) as any).turn).toBeNull();
    } finally {
      Object.assign(SHELL_LIMITS, saved);
      await host.restart();
    }
  }, 180_000);

  it("a wake-up turn can be stopped like any other; nothing restarts", async () => {
    const host = app.agent.host("default");
    const saved = { ...SHELL_LIMITS };
    Object.assign(SHELL_LIMITS, { bashMs: 1500, bashMaxMs: 3000 });
    try {
      await host.restart();
      expect((await chat("/reset")).reply).toMatch(/已清空/);
      const conv = (await console_()).conversationId;
      expect((await chat("BGJOB again")).reply).toMatch(/^STILL-RUNNING/);
      const pid = host.pid;
      await waitFor(async () => !!((await api(`/conversations/${encodeURIComponent(conv)}/turn`)) as any).turn, 30_000);
      expect((await chat("/stop")).reply).toMatch(/^正在中止上一条消息/);
      let d: any;
      await waitFor(async () => /^已中止/.test((d = await console_()).messages.at(-1)?.content ?? ""), 30_000);
      expect(d.messages.at(-1).content).toMatch(/^已中止（处理了 \d+ 秒）。可以继续发消息。$/);
      expect(host.pid).toBe(pid);
      // 同一个会话、同一个代理进程照常接着用
      expect((await chat("QUICKSORT after stopping the wake-up turn")).reply).toContain("[1, 2, 3, 5, 7, 9]");
      expect(host.pid).toBe(pid);
    } finally {
      Object.assign(SHELL_LIMITS, saved);
      await host.restart();
    }
  }, 180_000);

  // —— 微信端到端（真实 DSH + mock iLink）：插话的"收到"、后台命令结束后的回复都经出站队列发到微信，各只发一次 ——
  describe("on WeChat (mock iLink)", () => {
    const OWNER = "owner@im.wechat";
    const FRIEND = "friend@im.wechat";
    let ilink: Awaited<ReturnType<typeof mockIlink>>;
    const sentTo = (user: string, text: string) => ilink.state.sent.filter((s) => s.to === user && s.text.includes(text));
    const outboxRows = (user: string) => app.store.listOutbox({ botId: "default", limit: 500 }).filter((r) => r.peerId === user).reverse();

    beforeAll(async () => {
      ilink = await mockIlink();
      // 已经扫码登录：扫码的是 OWNER；渠道连到 mock iLink
      app.store.saveWeixinAccount({ botId: "default", botToken: "tok", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: OWNER });
      await app.restartBot("default");
    });
    afterAll(async () => {
      await app.channels.get("default")?.weixin?.stop();
      await ilink?.close();
    });

    it("a long command is backgrounded; when it ends the follow-up reply reaches WeChat exactly once, through the outbox", async () => {
      const host = app.agent.host("default");
      const saved = { ...SHELL_LIMITS };
      Object.assign(SHELL_LIMITS, { bashMs: 1500, bashMaxMs: 3000 });
      try {
        await host.restart();
        const conv = `default:weixin:${OWNER}`;
        app.store.setConversationModel(conv, "");
        ilink.push(OWNER, "BGJOB on wechat");
        // 这一轮先回"还在跑"
        await waitFor(() => sentTo(OWNER, "STILL-RUNNING").length === 1, 60_000);
        expect(sentTo(OWNER, "bg-finished-42")).toHaveLength(0);
        // 命令结束：代理醒来，回复作为一条新消息发到微信
        await waitFor(() => sentTo(OWNER, "BGDONE").length === 1, 60_000);
        const done = sentTo(OWNER, "BGDONE")[0];
        expect(done.text).toContain("bg-finished-42");
        expect(done.text).toContain("wake-step");
        // 经出站队列：id 由 DSH 会话和回合号推出（wx:<机器人>:wake:<会话>:t<回合>:final），状态 sent
        const rows = outboxRows(OWNER);
        const wake = rows.filter((r) => /^wx:default:wake:[^:]+:t\d+:final$/.test(r.id));
        expect(wake).toHaveLength(1);
        expect(wake[0]).toMatchObject({ status: "sent", kind: "text", channel: "weixin" });
        expect(wake[0].body.text).toContain("BGDONE");
        expect(wake[0].id).toBe(`wx:default:wake:${app.store.getAgentSession(conv)}:t2:final`);
        // 先是这一轮的回复，再是后台命令结束后的那条（按会话顺序）
        expect(rows.map((r) => r.body.text?.split("<<")[0])).toEqual(["STILL-RUNNING", "BGDONE"]);
        // 再等一会儿：没有重发，平台的 client_id 都不一样
        await new Promise((r) => setTimeout(r, 2000));
        await app.outbox.idle();
        expect(sentTo(OWNER, "BGDONE")).toHaveLength(1);
        expect(new Set(ilink.state.clientIds).size).toBe(ilink.state.clientIds.length);
        // 历史：用户消息、这一轮的回复、后台命令结束后的回复；没有正在进行的回合，重启标记清掉了
        const hist = app.store.listMessages(conv).map((m) => [m.role, m.content.split("<<")[0]]);
        expect(hist.slice(-3)).toEqual([
          ["user", "BGJOB on wechat"],
          ["assistant", "STILL-RUNNING"],
          ["assistant", "BGDONE"],
        ]);
        await waitFor(() => !app.agent.turnsInProgress.has(conv));
        expect(app.store.getKV(`inflight:${conv}`)).toBeFalsy();
      } finally {
        Object.assign(SHELL_LIMITS, saved);
        await host.restart();
      }
    }, 180_000);

    it("a message sent while the turn runs is steered: the 收到 ack and the one reply go through the outbox, once each", async () => {
      const conv = `default:weixin:${OWNER}`;
      const before = ilink.state.sent.length;
      ilink.push(OWNER, "STEERME on wechat");
      await waitFor(() => toolRunning(conv), 60_000);
      ilink.push(OWNER, "STEERTEXT from wechat");
      await waitFor(() => sentTo(OWNER, "SAW<<STEERTEXT from wechat>>").length === 1, 60_000);
      await app.outbox.idle();
      const mine = ilink.state.sent.slice(before).filter((s) => s.to === OWNER).map((s) => s.text);
      expect(mine).toEqual([STEER_ACK, "SAW<<STEERTEXT from wechat>>"]);
      // ack 的出站记录：短有效期、只发一次
      const ack = outboxRows(OWNER).filter((r) => r.body.text === STEER_ACK);
      expect(ack).toHaveLength(1);
      expect(ack[0].status).toBe("sent");
      expect(ack[0].expiresAt - ack[0].createdAt).toBeLessThanOrEqual(10 * 60_000);
      expect(app.store.listMessages(conv).slice(-3).map((m) => [m.role, m.content])).toEqual([
        ["user", "STEERME on wechat"],
        ["user", "STEERTEXT from wechat"],
        ["assistant", "SAW<<STEERTEXT from wechat>>"],
      ]);
      await waitFor(() => !app.agent.turnsInProgress.has(conv));
      expect(app.store.getKV(`inflight:${conv}`)).toBeFalsy();
    }, 120_000);

    it("a steer never bypasses the allowlist: removed while its turn runs, the next message is refused, not steered", async () => {
      const entry = app.access.allow("default", "weixin", FRIEND, "test");
      const conv = `default:weixin:${FRIEND}`;
      ilink.push(FRIEND, "STEERME from a friend");
      await waitFor(() => toolRunning(conv), 60_000);
      // 主人在回合进行中把他移出允许名单
      app.access.remove(entry.id);
      ilink.push(FRIEND, "STEERTEXT should not get in");
      await waitFor(() => sentTo(FRIEND, "NOSTEER").length === 1, 60_000);
      await app.outbox.idle();
      expect(sentTo(FRIEND, "SAW<<")).toHaveLength(0);
      expect(sentTo(FRIEND, STEER_ACK)).toHaveLength(0);
      expect(app.store.listMessages(conv).map((m) => m.content)).not.toContain("STEERTEXT should not get in");
      // 模型从没见过这条
      expect(calls.some((c) => JSON.stringify(c.body).includes("STEERTEXT should not get in"))).toBe(false);
    }, 120_000);
  });
});
