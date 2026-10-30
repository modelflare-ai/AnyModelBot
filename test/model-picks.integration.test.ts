/**
 * 集成测试：真实内置 magpie。它对超过 24 个模型、又没有 picks 的服务商只放出列表前 24 个（没放出的
 * 连 "provider/model" 也不服务）；连接 Modelflare 时要把全部对话模型写成 picks，决策模型不算。
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

// 按字母排序时第 24 个之后的模型，正是以前被截掉的那些
const chat = Array.from({ length: 30 }, (_, i) => `model-${String(i).padStart(2, "0")}`);
const kinds: Record<string, string> = { ...Object.fromEntries(chat.map((m) => [m, "text"])), "jev-decide": "", "img-gen": "image" };

d("Modelflare 模型很多时全部启用", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let app: App;

  beforeAll(async () => {
    llm = await mockOpenAI({ key: "mf-many-key", models: [...chat, "jev-decide", "img-gen"], kinds });
    process.env.AMB_MODELFLARE_BASE_URL = llm.url + "/v1";
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-picks-"));
    app = new App(loadConfig({ dataDir, env: { AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_AGENT: "off" } }), {
      feishuTransport: () => new FakeFeishu(),
      printQrToTerminal: false,
      noWeb: true,
    });
    await app.start();
  }, 60_000);

  afterAll(async () => {
    delete process.env.AMB_MODELFLARE_BASE_URL;
    await app?.stop();
    await llm?.close();
  });

  it("列出全部 30 个对话模型，不含决策与生图模型；第 24 个之后的也能对话", async () => {
    const r = await app.connectModelflare("mf-many-key", "auto");
    expect(r.ok && r.chatModels).toEqual(chat);
    let list: string[] = [];
    await until(async () => {
      list = await app.runtime.listModels(true).catch(() => []);
      return list.length >= chat.length;
    }, 15_000, 200);
    expect(list.map((m) => m.replace(/^modelflare\//, "")).sort()).toEqual(chat);
    app.store.updateBot("default", { defaultModel: "model-29" });
    const out = { text: "", async apply(op: any) { if (op.type === "stream.finish") this.text = op.text; } };
    await app.runtime.handle({ id: "e1", channel: "web", botId: "default", conversation: { kind: "dm", id: "c" }, sender: { id: "u" }, parts: [{ type: "text", text: "你好" }], replyHandle: {}, receivedAt: Date.now() }, out);
    expect(out.text).toContain("[model-29] 你说：你好");
  }, 40_000);
});
