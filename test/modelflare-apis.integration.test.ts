/**
 * 集成测试：真实内置 magpie + 模拟的 Modelflare。连接时把 Chat、Responses、Messages 三个地址都交给网关：
 * Claude 走 /v1/messages，其余走 /v1/chat/completions；0.1.8 及以前只写了 Chat 地址的连接在启动时补上。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { resolveMagpieBinary } from "../src/magpie/supervisor.js";
import { FakeFeishu, mockOpenAI, until } from "./helpers.js";

const d = resolveMagpieBinary() ? describe : describe.skip;

const models = ["claude-opus-5-5", "gpt-6-sol"];

d("Modelflare 的三种对话接口", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let app: App;
  let dataDir: string;
  const file = () => path.join(dataDir, "magpie", "config", "magpie", "providers.json");
  const provider = () => {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    return (Array.isArray(j) ? j : j.providers).find((p: any) => p.id === "modelflare");
  };
  const boot = async () => {
    app = new App(loadConfig({ dataDir, env: { AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_AGENT: "off" } }), {
      feishuTransport: () => new FakeFeishu(),
      printQrToTerminal: false,
      noWeb: true,
    });
    await app.start();
  };
  const say = async (model: string, text: string) => {
    app.store.updateBot("default", { defaultModel: model });
    const out = { text: "", async apply(op: any) { if (op.type === "stream.finish") this.text = op.text; } };
    await app.runtime.handle({ id: `e-${model}`, channel: "web", botId: "default", conversation: { kind: "dm", id: `c-${model}` }, sender: { id: "u" }, parts: [{ type: "text", text }], replyHandle: {}, receivedAt: Date.now() }, out);
    return out.text;
  };

  beforeAll(async () => {
    llm = await mockOpenAI({ key: "mf-api-key", models, kinds: Object.fromEntries(models.map((m) => [m, "text"])) });
    process.env.AMB_MODELFLARE_BASE_URL = llm.url + "/v1";
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-apis-"));
    await boot();
  }, 60_000);

  afterAll(async () => {
    delete process.env.AMB_MODELFLARE_BASE_URL;
    await app?.stop();
    await llm?.close();
  });

  it("连接时写入三个地址；Claude 走 Messages，GPT 走 Chat", async () => {
    const r = await app.connectModelflare("mf-api-key", "auto");
    expect(r.ok).toBe(true);
    expect(provider()).toMatchObject({ chat: llm.url + "/v1", responses: llm.url + "/v1", anthropic: llm.url });
    await until(async () => (await app.runtime.listModels(true).catch(() => [])).length >= models.length, 15_000, 200);

    expect(await say("claude-opus-5-5", "你好")).toContain("[claude-opus-5-5] 你说：你好");
    expect(llm.calls.at(-1)).toMatchObject({ api: "messages", model: "claude-opus-5-5", auth: "Bearer mf-api-key" });

    expect(await say("gpt-6-sol", "在吗")).toContain("[gpt-6-sol] 你说：在吗");
    expect(llm.calls.at(-1)).toMatchObject({ api: "chat", model: "gpt-6-sol" });
  }, 40_000);

  it("只写了 Chat 地址的旧连接：重启后补上 Responses 和 Messages", async () => {
    await app.stop();
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    for (const p of Array.isArray(j) ? j : j.providers) if (p.id === "modelflare") delete p.responses, delete p.anthropic;
    fs.writeFileSync(file(), JSON.stringify(j, null, 2));
    expect(provider().anthropic).toBeUndefined();

    await boot();
    await until(async () => provider().anthropic === llm.url, 20_000, 200);
    expect(provider()).toMatchObject({ chat: llm.url + "/v1", responses: llm.url + "/v1", anthropic: llm.url });
    expect(await say("claude-opus-5-5", "又见面了")).toContain("[claude-opus-5-5] 你说：又见面了");
    expect(llm.calls.at(-1)?.api).toBe("messages");
  }, 60_000);
});
