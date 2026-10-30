#!/usr/bin/env node
// End-to-end check of the agent path in a real app process (installed build or `electron .`):
// a scripted OpenAI-compatible mock model, the app in external-endpoint mode pointing at it,
// one chat message through the local HTTP API, and a hard timeout. Everything is written to --out
// (app stdout/stderr, model requests, agent status polls, the data dir) so CI can upload it.
//
//   node scripts/e2e-agent.mjs --out <dir> [--timeout-ms 180000] [--procmon] [--tool] [--managed] [--stream]
//                              [--reasoning] [--observe-ms N] [--max-console-windows N] -- <app exe> [args...]
//
// --procmon (Windows): also log every process start and every visible console window while the app
//   runs (scripts/ci/procmon.ps1), which is how the "flashing console windows" report is checked.
// --max-console-windows N: fail when more than N new visible console windows appeared (needs --procmon).
// --expect-diagnostics: also require the troubleshooting page's "test model" and "test agent" to pass.
// --expect-pwsh7 (Windows): require that the app detected PowerShell 7 (/amb/api/pwsh and the diagnostics
//   status), passed it to DSH (the "patch written" log line) and that the --tool command ran in it
//   (the pwsh tool prints $PSVersionTable.PSVersion.Major). GitHub's windows-2025 image has PowerShell 7.
// --tool: the mock model asks for one shell tool call before answering (exercises tool spawning).
// --managed: use the bundled magpie gateway (as users do) with "Modelflare" pointed at the mock
//   (AMB_MODELFLARE_BASE_URL) and connected through the API; otherwise the app calls the mock directly.
// --stream: send the message through the UI's SSE endpoint (/chat/stream) instead of /chat.
// --reasoning: the mock streams reasoning_content deltas before the answer (like reasoning models).
// --observe-ms N: keep the app running N ms after the reply (process monitor keeps logging), then
//   send a second message.
// --launch node|shell|redirect (Windows): how the app is started. node (default) = child_process
//   with stdout/stderr to files; shell = PowerShell Start-Process without redirection, i.e.
//   ShellExecute like a Start-menu shortcut: the GUI app gets NO std handles; redirect =
//   Start-Process with -RedirectStandardOutput/-Error (what users do to capture output);
//   broken-pipe = stdout/stderr are pipes whose read end is closed right away (what PowerShell's
//   `*>` does to a GUI program): every console write fails with EPIPE.
// --cwd <dir>: working directory for shell/redirect launches (default: the exe's folder, like the
//   installed shortcut).
// --status-probes: send /status before anything else and again while the first message is
//   in flight; both must answer within 20 s (they must never wait behind the agent).
// Exit code 0 = the reply came back and contained the mock's answer; 1 otherwise.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const opts = dash >= 0 ? argv.slice(0, dash) : argv;
const cmd = dash >= 0 ? argv.slice(dash + 1) : [];
const opt = (k, d) => {
  const i = opts.indexOf(`--${k}`);
  return i >= 0 ? opts[i + 1] : d;
};
const flag = (k) => opts.includes(`--${k}`);
if (!cmd.length) {
  console.error("usage: e2e-agent.mjs --out <dir> [--timeout-ms N] [--procmon] [--tool] -- <app> [args...]");
  process.exit(2);
}
// A relative app path (node_modules/electron/dist/electron.exe) is resolved here: spawn() on Windows
// does not resolve paths with separators against the cwd.
if (/[\\/]/.test(cmd[0]) && !path.isAbsolute(cmd[0])) cmd[0] = path.resolve(cmd[0]);
const out = path.resolve(opt("out", "e2e-out"));
const timeoutMs = Number(opt("timeout-ms", 180_000));
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(out, { recursive: true });
// --data-dir: e.g. a path with CJK characters and spaces, like a Chinese Windows user name gives
const dataDir = path.resolve(opt("data-dir", path.join(out, "data")));
fs.mkdirSync(dataDir, { recursive: true });
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const say = (...a) => console.log(stamp(), ...a);
const jl = (file, obj) => fs.appendFileSync(path.join(out, file), JSON.stringify({ t: stamp(), ...obj }) + "\n");

const MODEL = "mock-agent";
const ANSWER = "pong-from-mock";
const wantTool = flag("tool");
const expectPwsh7 = flag("expect-pwsh7");
const managed = flag("managed");
const reasoning = flag("reasoning");
const observeMs = Number(opt("observe-ms", 0));
const maxConsoles = opt("max-console-windows");

function textOf(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  return "";
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// ---------- mock model ----------
const llm = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let b = {};
  try {
    b = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    /* ignore */
  }
  const tools = (b.tools ?? []).map((t) => t.function?.name ?? t.name);
  const msgs = b.messages ?? [];
  jl("llm-requests.jsonl", { method: req.method, url: req.url, model: b.model, stream: b.stream, tools, roles: msgs.map((m) => m.role), last: textOf(msgs.at(-1)?.content).slice(-200) });
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    return;
  }
  if (!req.url?.endsWith("/chat/completions")) return void res.writeHead(404).end();
  // One shell call first when asked (and the runtime offers a shell tool), then the answer.
  const shell = tools.find((n) => n === "bash" || n === "pwsh" || n === "powershell");
  const toolResults = msgs.filter((m) => m.role === "tool");
  // PowerShell also prints its major version, so the e2e can tell PowerShell 7 from Windows PowerShell 5.1
  const command = shell === "bash" ? "echo tool-ran-ok" : 'echo tool-ran-ok; "psver=$($PSVersionTable.PSVersion.Major)"';
  const call = wantTool && b.tools && shell && !toolResults.length ? { name: shell, args: { description: "say hi", command } } : undefined;
  const text = toolResults.length ? `${ANSWER} [${toolResults.map((m) => textOf(m.content)).join("|").slice(0, 300)}]` : ANSWER;
  if (!b.stream) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "c1", object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (o) => res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: b.model, ...o })}\n\n`);
  if (call) {
    send({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_" + crypto.randomBytes(4).toString("hex"), type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  } else {
    if (reasoning) for (const r of ["Thinking", " about", " it."]) send({ choices: [{ index: 0, delta: { role: "assistant", content: null, reasoning_content: r } }] });
    send({ choices: [{ index: 0, delta: { role: "assistant", content: text } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  }
  send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  res.end("data: [DONE]\n\n");
});
await new Promise((r) => llm.listen(0, "127.0.0.1", r));
const llmUrl = `http://127.0.0.1:${llm.address().port}`;
say("mock model at", llmUrl);

// ---------- optional process monitor (Windows) ----------
let procmon;
const stopFile = path.join(out, "procmon.stop");
if (flag("procmon") && process.platform === "win32") {
  procmon = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "ci", "procmon.ps1"), "-Out", path.join(out, "procmon.jsonl"), "-StopFile", stopFile], { stdio: ["ignore", fs.openSync(path.join(out, "procmon.stdout.log"), "w"), fs.openSync(path.join(out, "procmon.stderr.log"), "w")], windowsHide: true });
  await new Promise((r) => setTimeout(r, 4000)); // let the WMI subscription settle
}

// ---------- the app ----------
const port = await freePort();
const token = crypto.randomBytes(16).toString("hex");
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  AMB_DATA_DIR: dataDir,
  ...(managed ? { AMB_MODELFLARE_BASE_URL: llmUrl + "/v1" } : { AMB_MAGPIE_BASE_URL: llmUrl + "/v1", AMB_MAGPIE_API_KEY: "mock-key", AMB_DEFAULT_MODEL: MODEL }),
  AMB_UI_PORT: String(port),
  AMB_UI_TOKEN: token,
  AMB_LOG_LEVEL: "debug",
  AMB_DSH_TRACE: path.join(out, "dsh-trace.jsonl"),
  AMB_WEIXIN_API_BASE: "http://127.0.0.1:9",
  AMB_MEMORY_REVIEW_DELAY_MS: "600000",
};
const launch = opt("launch", "node");
say("launching", launch, JSON.stringify(cmd));
let app;
let appExit;
if (launch === "node" || launch === "broken-pipe") {
  const appOut = fs.openSync(path.join(out, "app.stdout.log"), "w");
  const appErr = fs.openSync(path.join(out, "app.stderr.log"), "w");
  app = spawn(cmd[0], cmd.slice(1), { env, stdio: launch === "node" ? ["ignore", appOut, appErr] : ["ignore", "pipe", "pipe"] });
  if (launch === "broken-pipe") {
    app.stdout.destroy();
    app.stderr.destroy();
  }
  app.on("exit", (code, signal) => {
    appExit = { code, signal };
    say("app exited", code, signal);
  });
  app.on("error", (e) => say("app spawn error", e.message));
} else {
  // Start-Process: ShellExecute (shell) or CreateProcess with file handles (redirect); env is inherited.
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const wd = opt("cwd", path.dirname(cmd[0]));
  const argList = cmd.length > 1 ? ` -ArgumentList ${cmd.slice(1).map(q).join(",")}` : "";
  const redirect = launch === "redirect" ? ` -RedirectStandardOutput ${q(path.join(out, "app.stdout.log"))} -RedirectStandardError ${q(path.join(out, "app.stderr.log"))}` : "";
  // The PID comes back through a file, and PowerShell gets no pipes from us: Start-Process with
  // redirection creates the app with inherited handles, and an inherited pipe would keep this
  // call waiting until the app exits.
  const pidFile = path.join(out, "app.pid");
  const ps = `(Start-Process -FilePath ${q(cmd[0])}${argList} -WorkingDirectory ${q(wd)}${redirect} -PassThru).Id | Out-File -Encoding ascii ${q(pidFile)}`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env, stdio: "ignore", windowsHide: true, timeout: 60_000 });
  const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").trim() : NaN);
  say("started pid", pid, "cwd", wd, r.error ? r.error.message : "");
  app = { pid, kill: () => {} };
  const alive = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      appExit = { code: "gone", signal: null };
      say("app exited");
      clearInterval(alive);
    }
  }, 1000);
  alive.unref();
}

const H = { "x-amb-token": token };
async function api(p, init = {}, ms = 15_000) {
  const r = await fetch(base + p, { ...init, headers: { ...H, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(ms) });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const summary = { appPid: app.pid, ok: false };

/** The UI's path: POST /chat/stream (SSE). Every event is logged with a timestamp. */
async function streamChat(text, ms) {
  const r = await fetch(`${base}/amb/api/bots/default/chat/stream`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(ms) });
  if (!r.ok || !r.body) return { status: r.status, reply: await r.text() };
  const dec = new TextDecoder();
  let buf = "";
  let reply = "";
  let last = "";
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1] ?? (block.startsWith(":") ? "comment" : "message");
      const data = /^data: (.*)$/m.exec(block)?.[1];
      jl("sse-events.jsonl", { ev, data: data?.slice(0, 300) });
      last = ev;
      if (ev === "text" && data) reply = JSON.parse(data).text ?? reply;
      if (ev === "error" && data) reply = `ERROR ${JSON.parse(data).message}`;
    }
  }
  return { status: r.status, reply, lastEvent: last };
}
let poll;
try {
  // 1) UI up
  let up = false;
  for (let i = 0; i < 180 && !up && !appExit; i++) {
    try {
      up = (await api("/amb/healthz", {}, 2000)).status === 200;
    } catch {
      /* not yet */
    }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error("app UI never came up");
  say("UI up");
  summary.status = (await api("/amb/api/status")).body;

  // 2) poll agent status while the turn runs
  poll = setInterval(() => {
    api("/amb/api/agent", {}, 5000).then((r) => jl("agent-status.jsonl", r.body), (e) => jl("agent-status.jsonl", { error: String(e?.message ?? e) }));
  }, 2000);

  // 2b) managed: connect "Modelflare" (= the mock) through the API, like onboarding does
  if (managed) {
    for (let i = 0; i < 60 && summary.status?.gateway?.state !== "running"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      summary.status = (await api("/amb/api/status")).body;
    }
    const c = await api("/amb/api/modelflare", { method: "PUT", body: JSON.stringify({ apiKey: "mf-e2e-key-0123456789", line: "auto" }) }, 60_000);
    summary.connect = { status: c.status, connected: c.body?.connected, error: c.body?.error, models: c.body?.models };
    say("modelflare connect:", JSON.stringify(summary.connect));
    summary.models = (await api("/amb/api/models", {}, 30_000)).body?.models;
    say("models:", JSON.stringify(summary.models));
  }

  // 3) chat
  const chat = async (text, ms = timeoutMs) => {
    const started = Date.now();
    try {
      if (flag("stream")) return { ...(await streamChat(text, ms)), ms: Date.now() - started };
      const r = await api("/amb/api/bots/default/chat", { method: "POST", body: JSON.stringify({ text }) }, ms);
      return { status: r.status, ms: Date.now() - started, reply: r.body?.reply ?? r.body };
    } catch (e) {
      return { error: String(e?.message ?? e), ms: Date.now() - started };
    }
  };
  const good = (c) => typeof c?.reply === "string" && c.reply.includes(ANSWER) && (!wantTool || c.reply.includes("tool-ran-ok"));
  const statusOk = (c) => typeof c?.reply === "string" && c.reply.includes("当前模型") && c.ms < 20_000;
  if (flag("status-probes")) {
    summary.statusFirst = await chat("/status", 20_000);
    say("/status (first):", JSON.stringify(summary.statusFirst).slice(0, 500));
  }
  summary.chatStartedAt = stamp();
  const first = chat(wantTool ? "Run the tool, then answer. TOOLTEST" : "Say hi. PINGTEST");
  if (flag("status-probes")) {
    await new Promise((r) => setTimeout(r, 3000));
    summary.statusDuring = await chat("/status", 20_000);
    say("/status (while the first message runs):", JSON.stringify(summary.statusDuring).slice(0, 500));
  }
  summary.chat = await first;
  say("chat:", JSON.stringify(summary.chat).slice(0, 600));
  summary.ok = good(summary.chat);
  if (flag("status-probes")) summary.ok &&= statusOk(summary.statusFirst) && statusOk(summary.statusDuring);
  if (observeMs > 0) {
    say(`observing for ${observeMs} ms`);
    await new Promise((r) => setTimeout(r, observeMs));
    summary.chat2 = await chat("Again. PINGTEST 2");
    say("chat2:", JSON.stringify(summary.chat2).slice(0, 600));
    summary.ok &&= good(summary.chat2);
  }
  summary.agent = (await api("/amb/api/agent").catch((e) => ({ body: String(e) }))).body;

  // 4) troubleshooting endpoints (present from 0.1.6)
  for (const [name, p, init] of [
    ["diag", "/amb/api/diagnostics"],
    ["testModel", "/amb/api/diagnostics/test-model", { method: "POST", body: "{}" }],
    ["testAgent", "/amb/api/diagnostics/test-agent", { method: "POST", body: "{}" }],
    ["logs", "/amb/api/diagnostics/logs?lines=400"],
  ]) {
    try {
      const r = await api(p, init, 150_000);
      fs.writeFileSync(path.join(out, `diag-${name}.json`), JSON.stringify(r, null, 2));
      if (name === "testAgent") summary.testAgent = r.body;
      if (name === "testModel") summary.testModel = r.body;
    } catch (e) {
      fs.writeFileSync(path.join(out, `diag-${name}.json`), JSON.stringify({ error: String(e?.message ?? e) }));
    }
  }
  if (flag("expect-diagnostics")) {
    // The troubleshooting page's own checks must pass against the same mock.
    const m = summary.testModel;
    const modelOk = !!m?.direct?.ok && (!!m?.gateway?.ok || !!m?.gateway?.skipped);
    say(`test model: ${modelOk ? "ok" : "FAILED"} (${m?.verdict ?? "no result"}); test agent: ${summary.testAgent?.ok ? "ok" : `FAILED at ${summary.testAgent?.stuckAt ?? "?"}`}`);
    summary.ok &&= modelOk && !!summary.testAgent?.ok;
  }
  if (expectPwsh7) {
    // PowerShell 7 detected, handed to DSH and actually used for the tool call
    const ps = (await api("/amb/api/pwsh", {}, 30_000)).body;
    const diagPs = JSON.parse(fs.readFileSync(path.join(out, "diag-diag.json"), "utf8")).body?.pwsh;
    fs.writeFileSync(path.join(out, "diag-pwsh.json"), JSON.stringify({ api: ps, diagnostics: diagPs }, null, 2));
    let patchLine = "";
    try {
      patchLine = fs.readFileSync(path.join(dataDir, "logs", "app.log"), "utf8").split(/\r?\n/).find((l) => l.includes("dsh start: patch written")) ?? "";
    } catch {
      /* no log */
    }
    const psver = [summary.chat, summary.chat2].map((c) => /psver=(\d+)/.exec(c?.reply ?? "")?.[1]).filter(Boolean);
    summary.pwsh = { api: ps, diagnostics: diagPs, patchLine: patchLine.slice(0, 400), psver };
    const ok7 = (x) => !!x?.applicable && !!x?.found && !x?.missing && /^7\./.test(x?.version ?? "");
    const checks = {
      detected: ok7(ps),
      diagnostics: ok7(diagPs),
      passedToDsh: /"pwsh":"[^"]*pwsh\.exe"/i.test(patchLine),
      toolRanInPwsh7: !wantTool || (psver.length > 0 && psver.every((v) => v === "7")),
    };
    say(`PowerShell: ${ps?.version ?? "-"} at ${ps?.path ?? "-"} (${ps?.source ?? "-"}); checks ${JSON.stringify(checks)}; tool psver ${psver.join(",") || "-"}`);
    summary.ok &&= Object.values(checks).every(Boolean);
  }
} catch (e) {
  summary.error = String(e?.message ?? e);
  say("error:", summary.error);
} finally {
  clearInterval(poll);
  summary.appExit = appExit;
  // Process tree snapshot before teardown (Windows), then stop everything.
  if (process.platform === "win32") {
    const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, "processes-before-exit.json"), ps.stdout || ps.stderr || "");
    if (!appExit && app?.pid) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true });
  } else if (!appExit) {
    app.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 3000));
    if (!appExit) app.kill("SIGKILL");
  }
  if (procmon) {
    fs.writeFileSync(stopFile, "");
    await new Promise((r) => setTimeout(r, 3000));
    try {
      procmon.kill();
    } catch {
      /* ignore */
    }
  }
  llm.close();
  // Startup timings: from the app's own log when it has one (0.1.7+), else time to the first model request.
  try {
    const log = fs.readFileSync(path.join(dataDir, "logs", "app.log"), "utf8").split(/\r?\n/);
    summary.dshStages = log.filter((l) => /dsh start: |dsh started|dsh still initializing|prewarming/.test(l)).map((l) => l.slice(0, 260));
  } catch {
    /* no app.log (0.1.6 and older) */
  }
  try {
    const reqs = fs.readFileSync(path.join(out, "llm-requests.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    const firstChat = reqs.find((r) => String(r.url).endsWith("/chat/completions") && (r.tools?.length ?? 0) > 0);
    summary.firstAgentModelRequestAt = firstChat?.t;
  } catch {
    /* ignore */
  }
  if (procmon) {
    // Visible console windows that appeared while the app ran (Windows Terminal or conhost windows;
    // ConPTY's PseudoConsoleWindow is never shown and is not counted).
    const lines = fs.existsSync(path.join(out, "procmon.jsonl")) ? fs.readFileSync(path.join(out, "procmon.jsonl"), "utf8").split(/\r?\n/).filter(Boolean) : [];
    const wins = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === "console-window" && !String(e.window).includes("|PseudoConsoleWindow|"));
    summary.consoleWindows = wins.map((w) => `${w.t} ${w.window}`);
    say(`visible console windows: ${wins.length}`);
    if (maxConsoles !== undefined && wins.length > Number(maxConsoles)) {
      summary.ok = false;
      summary.error = `${wins.length} console windows appeared (allowed ${maxConsoles})`;
    }
  }
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
  say("summary:", JSON.stringify({ ok: summary.ok, chat: summary.chat, error: summary.error }).slice(0, 800));
  process.exit(summary.ok ? 0 : 1);
}
