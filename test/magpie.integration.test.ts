/**
 * 集成测试：真实内置 magpie（受管模式）+ mock Modelflare 上游。需要先 npm run build:magpie；没有二进制时跳过。
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
    llm = await mockOpenAI({ key: "mf-upstream-key-a1b2", models: ["up-model"] });
    // 仅测试：把 Modelflare 基址指向本地 mock（界面无法设置这个变量）
    process.env.AMB_MODELFLARE_BASE_URL = llm.url + "/v1";
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-int-"));
    app = new App(loadConfig({ dataDir, env: { AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_AGENT: "off" } }), {
      feishuTransport: () => new FakeFeishu(),
      printQrToTerminal: false,
    });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  }, 60_000);

  afterAll(async () => {
    delete process.env.AMB_MODELFLARE_BASE_URL;
    await app?.stop();
    await llm?.close();
  });

  const api = async (p: string, method = "GET", body?: unknown) => {
    const r = await fetch(base + "/amb/api" + p, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, text: await r.clone().text(), json: (await r.json().catch(() => ({}))) as any };
  };

  it("magpie 已在隔离目录中以 gateway 模式运行，初始未连接 Modelflare", async () => {
    expect(app.magpie!.state).toBe("running");
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, "magpie", "config", "magpie", "settings.json"), "utf8"));
    expect(s.noAutoUpdate).toBe(true);
    expect(s.noAccountDiscovery).toBe(true);
    // 没有从真实 HOME 发现任何订阅账号
    expect(app.magpie!.listProviders()).toEqual([]);
    const st = await api("/modelflare");
    expect(st.json).toMatchObject({ mode: "managed", connected: false, keyTail: "" });
  });

  it("无效 Key：返回 401 文案，不创建任何连接", async () => {
    expect((await api("/modelflare", "PUT", {})).status).toBe(400);
    const r = await api("/modelflare", "PUT", { apiKey: "wrong-key" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ code: "invalid_key", status: 401 });
    expect(app.magpie!.listProviders()).toEqual([]);
  });

  it("连接 Modelflare → 模型可用 → 对话经网关转发；Key 不出现在参数、日志与接口里", async () => {
    const r = await api("/modelflare", "PUT", { apiKey: "mf-upstream-key-a1b2" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ connected: true, keyTail: "a1b2", models: ["up-model"] });
    expect(r.text).not.toContain("mf-upstream-key");
    expect((await api("/modelflare")).text).not.toContain("mf-upstream-key");
    expect(app.magpie!.recentLog.join("\n")).not.toContain("mf-upstream-key");
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "magpie", "config", "magpie", "providers.json"), "utf8"));
    const arr: any[] = Array.isArray(raw) ? raw : raw.providers;
    expect(arr.map((p) => p.id)).toEqual(["modelflare"]);
    expect(arr[0].key).toBe("mf-upstream-key-a1b2");
    let models: string[] = [];
    await until(async () => {
      models = (await api("/models")).json.models;
      return models.length > 0;
    }, 15_000, 300);
    expect(models.some((m) => m.includes("up-model"))).toBe(true);
    const chat = await api("/bots/default/chat", "POST", { text: "经过网关" });
    expect(chat.json.reply).toContain("你说：经过网关");
    expect(llm.calls.at(-1)!.auth).toBe("Bearer mf-upstream-key-a1b2");
  }, 30_000);

  it("切换线路写入 config.json，Key 保持不变", async () => {
    const r = await api("/modelflare/line", "PUT", { line: "cn" });
    expect(r.json).toMatchObject({ connected: true, line: "cn", keyTail: "a1b2" });
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")).modelflare.line).toBe("cn");
  });

  it("不再反代内置网关：/magpie/、/v1、magpie 绝对路径都是 404", async () => {
    for (const p of ["/magpie/", "/v1/models", "/api/providers", "/icons/favicon.svg"]) expect((await fetch(base + p)).status, p).toBe(404);
  });

  it("崩溃后自动重启", async () => {
    const before = app.magpie!.restarts;
    app.magpie!.killForTest();
    await until(() => app.magpie!.restarts > before && app.magpie!.state === "running", 20_000, 100);
    expect(await app.magpie!.healthy()).toBe(true);
  }, 30_000);

  it("断开 Modelflare：回到未连接，机器人与会话保留", async () => {
    const r = await api("/modelflare", "DELETE");
    expect(r.status).toBe(200);
    expect(r.json.connected).toBe(false);
    expect(app.magpie!.listProviders()).toEqual([]);
    expect((await api("/bots")).json.bots.length).toBeGreaterThan(0);
    expect((await api("/conversations?bot=default")).json.conversations.length).toBeGreaterThan(0);
  }, 30_000);
});
