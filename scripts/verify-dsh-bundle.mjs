#!/usr/bin/env node
// Check the bundled DSH runtime (scripts/bundle-dsh.mjs) the way the app uses it: Electron in Node mode loads the
// SDK client from dsh.asar, native modules resolve to the real node_modules next to it, and a DSH host started
// from the archive answers one turn through a mock OpenAI-compatible model.
//   node scripts/verify-dsh-bundle.mjs <packaged executable>          # e.g. release/linux-unpacked/anymodel-bot
//   node scripts/verify-dsh-bundle.mjs <electron> <path/to/dsh.asar>  # e.g. node_modules/electron/dist/electron build/dsh/dsh.asar
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);

if (process.argv[2] !== "--child") {
  const exe = path.resolve(process.argv[2] ?? "");
  if (!process.argv[2] || !fs.existsSync(exe)) {
    console.error("usage: node scripts/verify-dsh-bundle.mjs <packaged executable> [dsh.asar]");
    process.exit(2);
  }
  // resources/ is next to the executable on Windows and Linux, Contents/Resources on macOS.
  const resources = process.platform === "darwin" ? path.join(path.dirname(exe), "..", "Resources") : path.join(path.dirname(exe), "resources");
  const runtime = path.resolve(process.argv[3] ?? path.join(resources, "dsh", "dsh.asar"));
  const r = spawnSync(exe, [self, "--child", runtime], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    timeout: 180_000,
    windowsHide: true,
  });
  if (r.error) console.error(r.error);
  process.exit(r.status ?? 1);
}

// ---------- child: runs inside the (packaged) Electron in Node mode ----------
const runtime = process.argv[3];
const nm = path.join(runtime, "node_modules");
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const detail = await fn();
    console.log(`ok   ${name} (${Date.now() - t} ms)${detail ? ` ${detail}` : ""}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e?.stack ?? e}`);
    process.exit(1);
  }
};
/** require() as seen from a DSH package inside the archive */
const from = (pkg) => createRequire(path.join(nm, pkg, "package.json"));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

if (!process.versions.electron) throw new Error("run me through Electron (ELECTRON_RUN_AS_NODE=1)");
console.log(`DSH bundle check: Electron ${process.versions.electron} (Node ${process.versions.node}) ${process.platform}-${process.arch}, ${runtime}`);

await step("archive readable", () => {
  if (!fs.existsSync(path.join(nm, "@deepseek-ai", "dsh-sdk-client", "package.json"))) throw new Error(`no dsh-sdk-client in ${runtime}`);
});
// One real turn first, so its timing is the cold start (nothing of DSH loaded yet in this process or the OS cache
// beyond what the previous steps touched): DSH host spawned by the SDK client from the archive, model = mock
// OpenAI-compatible server. DSH_HOST_INIT_MS is spawn -> initialize done, as the app waits for it (90 s timeout).
await step("DSH host answers through a mock model", async () => {
  const llm = http.createServer(async (req, res) => {
    if (req.url?.endsWith("/models")) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock", object: "model" }] }));
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    if (!body.stream) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "title" }, finish_reason: "stop" }] }));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: body.model, ...o })}\n\n`);
    send({ choices: [{ index: 0, delta: { role: "assistant", content: "bundle-pong" } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    send({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => llm.listen(0, "127.0.0.1", r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amb-dsh-check-"));
  const patch = path.join(home, "check.patch.yml");
  fs.writeFileSync(
    patch,
    [
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
      "      magpie:",
      "        api: openai-completions",
      `        baseURL: 'http://127.0.0.1:${llm.address().port}/v1'`,
      "        apiKeyEnv: AMB_CHECK_KEY",
      "        models:",
      "          - id: mock",
      "            name: mock",
      "            contextWindow: 128000",
      "            maxTokens: 16000",
      "",
    ].join("\n"),
  );
  const ti = Date.now();
  const { DeepSeekHarness } = await import(pathToFileURL(path.join(nm, "@deepseek-ai", "dsh-sdk-client", "lib", "index.js")).href);
  const sdkMs = Date.now() - ti;
  const env = { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot ?? "", LANG: "C.UTF-8", ELECTRON_RUN_AS_NODE: "1", AMB_CHECK_KEY: "k" };
  const h = new DeepSeekHarness({ profile: "sdk", patches: [patch], dshHome: home, env, cwd: home, processCwd: home, provider: "magpie", model: "mock", initializeTimeoutMs: 90_000, shutdownTimeoutMs: 3000 });
  const t = Date.now();
  try {
    await h.start();
    const started = Date.now() - t;
    console.log(`DSH_HOST_INIT_MS=${started}`);
    const r = await withTimeout(h.session().run("ping"), 60_000, "turn");
    if (!String(r.finalResponse).includes("bundle-pong")) throw new Error(`unexpected reply ${JSON.stringify(r.finalResponse)}`);
    return `(sdk import ${sdkMs} ms, host spawn -> initialized ${started} ms)`;
  } finally {
    await h.close().catch(() => {});
    llm.close();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
});
await step("koffi", () => `v${from("@deepseek-ai/dsh-subprocess-local")("koffi").version}`);
await step("node-addon-require-builtin", () => {
  from("@deepseek-ai/dsh-app-boot")("node-addon-require-builtin");
});
await step("sharp", async () => {
  const sharp = from("@deepseek-ai/dsh-attachment-local")("sharp");
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#3366ff" } }).png().toBuffer();
  // (not .metadata(): under Electron on Linux it crashes, unbundled too; see sharp's SharpElectronLinux warning)
  const small = await sharp(png).resize(2, 2).jpeg().toBuffer();
  return `png ${png.length} B -> jpeg ${small.length} B`;
});
await step("ripgrep", async () => {
  const entry = from("@deepseek-ai/dsh-tool-fs-search").resolve("@vscode/ripgrep");
  const { rgPath } = await import(pathToFileURL(entry).href);
  if (rgPath.includes(".asar" + path.sep)) throw new Error(`rg resolved inside the archive: ${rgPath}`);
  const r = spawnSync(rgPath, ["--version"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`${rgPath} --version: ${r.status} ${r.error ?? r.stderr}`);
  return r.stdout.split("\n")[0];
});
await step("node-pty", async () => {
  const pty = from("@deepseek-ai/dsh-subprocess-local")("node-pty");
  const [file, args] = process.platform === "win32" ? ["cmd.exe", ["/c", "echo pty-ok"]] : ["/bin/sh", ["-c", "echo pty-ok"]];
  const term = pty.spawn(file, args, { cols: 80, rows: 10, cwd: os.tmpdir(), env: process.env });
  let out = "";
  term.onData((d) => (out += d));
  await withTimeout(new Promise((r) => term.onExit(r)), 20_000, "pty");
  if (!out.includes("pty-ok")) throw new Error(`unexpected pty output ${JSON.stringify(out)}`);
});
if (process.platform === "linux") {
  await step("landlock-run", async () => {
    const entry = from("@deepseek-ai/dsh-sandbox-local").resolve("@deepseek-ai/node-addon-system/landlock-run");
    const { launcherPath } = await import(pathToFileURL(entry).href);
    const bin = launcherPath();
    fs.accessSync(bin, fs.constants.X_OK);
    return bin.includes(".asar" + path.sep) ? (() => { throw new Error(`launcher inside the archive: ${bin}`); })() : "";
  });
}

console.log("DSH bundle check passed");
process.exit(0);
