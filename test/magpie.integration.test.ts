/**
 * 集成测试：真实内置 magpie（受管模式）+ mock 上游模型。需要先 npm run build:magpie；没有二进制时跳过。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { resolveMagpieBinary } from "../src/magpie/supervisor.js";
import { FakeFeishu, mockOpenAI, until } from "./helpers.js";

const bin = resolveMagpieBinary();
const d = bin ? describe : describe.skip;

d("内置 magpie 集成", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let app: App;
  let base: string;
  let dataDir: string;

  beforeAll(async () => {
    llm = await mockOpenAI({ key: "upstream-key", models: ["up-model"] });
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-int-"));
    app = new App(loadConfig({ dataDir, env: { AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_AGENT: "off" } }), {
      feishuTransport: () => new FakeFeishu(),
      printQrToTerminal: false,
    });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  }, 60_000);

  afterAll(async () => {
    await app?.stop();
    await llm?.close();
  });

  it("magpie 已在隔离目录中以 gateway 模式运行", async () => {
    expect(app.magpie!.state).toBe("running");
    expect(fs.existsSync(path.join(dataDir, "magpie", "config", "magpie", "settings.json"))).toBe(true);
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, "magpie", "config", "magpie", "settings.json"), "utf8"));
    expect(s.noAutoUpdate).toBe(true);
    expect(s.noAccountDiscovery).toBe(true);
    // 没有从真实 HOME 发现任何订阅账号
    expect(app.magpie!.listProviders()).toEqual([]);
  });

  it("通过界面 API 添加自定义服务商 → 模型可用 → 对话经 magpie 转发", async () => {
    const r = await fetch(base + "/amb/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "mockup", url: llm.url + "/v1", apiKey: "upstream-key", models: "up-model" }),
    });
    expect(r.status).toBe(200);
    // 真实 key 没有出现在 magpie 进程参数/日志里，只在 magpie 的配置文件中
    expect(app.magpie!.recentLog.join("\n")).not.toContain("upstream-key");
    let models: string[] = [];
    await until(async () => {
      models = (await (await fetch(base + "/amb/api/models")).json()).models;
      return models.length > 0;
    }, 15_000, 300);
    expect(models.some((m) => m.includes("up-model"))).toBe(true);
    const chat = await fetch(base + "/amb/api/bots/default/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "经过网关" }) });
    const j = (await chat.json()) as { reply: string };
    expect(j.reply).toContain("你说：经过网关");
    expect(llm.calls.at(-1)!.auth).toBe("Bearer upstream-key");
  }, 30_000);

  it("预设服务商：key 不经命令行参数保存", async () => {
    const id = await app.magpie!.addPresetProvider("deepseek", "sk-fake-not-real-0000");
    expect(id).toMatch(/deepseek/);
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "magpie", "config", "magpie", "providers.json"), "utf8"));
    expect(raw.providers.find((p: any) => p.id === id).key).toBe("sk-fake-not-real-0000");
    const listed = await (await fetch(base + "/amb/api/providers")).text();
    expect(listed).not.toContain("sk-fake");
  }, 30_000);

  it("/magpie/ 内嵌：免二次登录、绝对路径兜底、/v1 走 gateway、敏感接口被拦截", async () => {
    const idx = await fetch(base + "/magpie/");
    expect(idx.status).toBe(200);
    const html = await idx.text();
    expect(html).toContain("<title>magpie</title>");
    expect(idx.headers.get("set-cookie")).toBeNull();
    const icon = await fetch(base + "/icons/favicon.svg");
    expect(icon.status).toBe(200);
    const trace = await fetch(base + "/api/gateway/trace?after=0");
    expect(trace.status).toBe(200);
    const v1 = await fetch(base + "/v1/models");
    expect(v1.status).toBe(200);
    expect(((await v1.json()) as any).data.length).toBeGreaterThan(0);
    expect((await fetch(base + "/api/agents/connect/claude", { method: "POST" })).status).toBe(403);
    expect((await fetch(base + "/magpie/api/accounts/authorize")).status).toBe(403);
  });

  it("崩溃后自动重启", async () => {
    const before = app.magpie!.restarts;
    app.magpie!.killForTest();
    await until(() => app.magpie!.restarts > before && app.magpie!.state === "running", 20_000, 100);
    expect((await fetch(base + "/magpie/")).status).toBe(200);
  }, 30_000);
});
