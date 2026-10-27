import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { locateDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { listen } from "./helpers.js";

/**
 * 真实 DSH 子进程 + 脚本化的 OpenAI 兼容模型（会发出工具调用）。
 * 验证：插件加载、bridge 注入密钥、bash 沙箱、审批流程（API 批准/拒绝）、读围栏、回环 API 防护。
 */
const runtime = locateDshRuntime(findAppRoot());
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

describe.skipIf(!runtime || !hasBwrap || process.platform !== "linux")("agent host (DSH)", () => {
  let app: App;
  let dataDir: string;
  let llm: Awaited<ReturnType<typeof listen>>;
  const seenAuth = new Set<string>();
  let base = "";

  /** 根据最后一条用户消息与之后的工具结果数量决定下一步 */
  function plan(messages: any[]): { tool?: { name: string; args: any }; text?: string } {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && /QUICKSORT|ESCALATE|SECRET|READFILE|LOOPBACK|\[用户消息\]/.test(textOf(messages[i].content))) { lastUser = i; break; }
    }
    const user = textOf(messages[lastUser]?.content);
    const tools = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
    const scripts: Array<[RegExp, Array<{ name: string; args: any }>]> = [
      [/QUICKSORT/, [{ name: "bash", args: { description: "run", command: "cat > qs.py <<'PY'\ndef qs(a):\n    return a if len(a)<2 else qs([x for x in a[1:] if x<a[0]])+[a[0]]+qs([x for x in a[1:] if x>=a[0]])\nprint(qs([5,3,9,1,7,2]))\nPY\npython3 qs.py" } }]],
      [/ESCALATE/, [{ name: "bash", args: { description: "run", command: "echo escalated-$((40+2))", sandbox_permissions: "danger-full-access", justification: "测试提权" } }]],
      [/SECRET/, [{ name: "bash", args: { description: "run", command: `ls ${dataDir} 2>&1; cat ${path.join(dataDir, "anymodel.db")} >/dev/null 2>&1 && echo DB-READABLE || echo DB-HIDDEN` } }]],
      [/READFILE/, [{ name: "read", args: { file_path: path.join(dataDir, "config.json") } }, { name: "read", args: { file_path: "qs.py" } }]],
      [/LOOPBACK/, [{ name: "bash", args: { description: "run", command: `python3 -c "import urllib.request as u\ntry:\n  print('API', u.urlopen('${base}/amb/api/status').status)\nexcept Exception as e:\n  print('API', getattr(e,'code',e))"` } }]],
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
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-agent", object: "model" }] }));
        return;
      }
      const b = await body(req);
      const step = b.tools ? plan(b.messages) : { text: "标题" };
      if (process.env.AMB_TEST_LLM_LOG) fs.appendFileSync(process.env.AMB_TEST_LLM_LOG, JSON.stringify({ url: req.url, stream: b.stream, tools: (b.tools ?? []).map((t: any) => t.function?.name), msgs: b.messages.map((m: any) => [m.role, textOf(m.content).slice(0, 200), m.tool_calls?.map((t: any) => t.function?.name)]), step }) + "\n");
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
    app = new App(
      loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_DEFAULT_MODEL: "mock-agent" } }),
      { printQrToTerminal: false },
    );
    await app.start();
    base = app.web!.url.replace(/\/+$/, "");
  }, 60_000);

  afterAll(async () => {
    await app?.stop();
    await llm?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const chat = async (text: string) => {
    const r = await fetch(`${base}/amb/api/bots/default/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    expect(r.status).toBe(200);
    return (await r.json()) as { reply: string; progress: string[]; prompts: any[] };
  };

  it("runs a sandboxed bash tool in the bot workspace (quicksort)", async () => {
    const r = await chat("QUICKSORT please");
    expect(r.reply).toContain("[1, 2, 3, 5, 7, 9]");
    expect(fs.existsSync(path.join(dataDir, "workspaces", "default", "qs.py"))).toBe(true);
    // 模型只看到真实上游密钥，子进程只拿到 bridge 令牌
    expect([...seenAuth]).toEqual(["Bearer gw-key"]);
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

  it("blocks loopback management API calls from the agent", async () => {
    const r = await chat("LOOPBACK check");
    expect(r.reply).toContain("API 403");
  }, 120_000);
});
