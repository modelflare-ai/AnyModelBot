/**
 * 集成测试：真实内置 magpie + 模拟的 Modelflare（OIDC、connected-app、/v1）。经管理接口走完
 * 登录 → 自动接上本机 Key → 机器人预算 → 退出登录。需要先 npm run build:magpie；没有二进制时跳过。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { resolveMagpieBinary } from "../src/magpie/supervisor.js";
import { FakeFeishu, approveInBrowser, mockModelflare, mockOpenAI, until } from "./helpers.js";

const d = resolveMagpieBinary() ? describe : describe.skip;

d("账户登录（经管理接口，真实内置网关）", () => {
  let mf: Awaited<ReturnType<typeof mockModelflare>>;
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let app: App;
  let base: string;
  let dataDir: string;

  beforeAll(async () => {
    mf = await mockModelflare();
    // 设备 Key 与机器人预算 Key 由 mock 依次签发为 sk-key-1、sk-key-2
    llm = await mockOpenAI({ key: ["sk-key-1", "sk-key-2"], models: ["up-model"] });
    process.env.AMB_MODELFLARE_BASE_URL = llm.url + "/v1";
    process.env.AMB_MODELFLARE_ISSUER = mf.url;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-acct-int-"));
    app = new App(loadConfig({ dataDir, env: { AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_AGENT: "off" } }), {
      feishuTransport: () => new FakeFeishu(),
      printQrToTerminal: false,
    });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  }, 60_000);

  afterAll(async () => {
    delete process.env.AMB_MODELFLARE_BASE_URL;
    delete process.env.AMB_MODELFLARE_ISSUER;
    await app?.stop();
    await llm?.close();
    await mf?.close();
  });

  const api = async (p: string, method = "GET", body?: unknown) => {
    const r = await fetch(base + "/amb/api" + p, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, text: await r.clone().text(), json: (await r.json().catch(() => ({}))) as any };
  };

  it("未登录：可以登录；不能设预算", async () => {
    expect((await api("/account")).json).toMatchObject({ state: "signed_out", loginAvailable: true, source: "none" });
    const r = await api("/bots/default/budget", "PUT", { enabled: true, limitUsd: 5 });
    expect(r.status).toBe(409);
  });

  it("登录：浏览器授权后自动签发本机 Key 并接到内置网关；接口不回显任何令牌", async () => {
    const start = await api("/account/login", "POST", {});
    expect(start.status).toBe(200);
    expect(start.json).toMatchObject({ state: "signing_in", opened: false });
    await approveInBrowser(mf, start.json.loginUrl);
    await until(async () => (await api("/account")).json.state === "signed_in", 15_000, 100);
    const acct = await api("/account");
    expect(acct.json).toMatchObject({ name: "Ada", source: "account", balanceUsd: 12.5 });
    expect(acct.text).not.toMatch(/rt-|at-|sk-key/);
    const conn = await api("/modelflare");
    expect(conn.json).toMatchObject({ connected: true, keyTail: "ey-1" });
    expect(conn.text).not.toContain("sk-key-1");
    const chat = await api("/bots/default/chat", "POST", { text: "登录后对话" });
    expect(chat.json.reply).toContain("你说：登录后对话");
    expect(llm.calls.at(-1)!.auth).toBe("Bearer sk-key-1");
  }, 30_000);

  it("机器人预算：开启后走它自己的 Key，用量可查；关闭后回到本机 Key", async () => {
    const on = await api("/bots/default/budget", "PUT", { enabled: true, limitUsd: 5 });
    expect(on.status).toBe(200);
    expect(on.json.settings.budget).toEqual({ enabled: true, limitUsd: 5 });
    expect((await api("/account/budgets")).json.budgets.default).toMatchObject({ limit_usd: 5 });
    await until(async () => {
      const r = await api("/bots/default/chat", "POST", { text: "预算" });
      return String(r.json.reply).includes("你说：预算") && llm.calls.at(-1)!.auth === "Bearer sk-key-2";
    }, 15_000, 300);
    const off = await api("/bots/default/budget", "PUT", { enabled: false });
    expect(off.json.settings.budget.enabled).toBe(false);
    expect(mf.s.keys.map((k) => k.id)).toEqual([1]);
    await api("/bots/default/chat", "POST", { text: "共用" });
    expect(llm.calls.at(-1)!.auth).toBe("Bearer sk-key-1");
  }, 40_000);

  it("余额提醒线：校验范围并写入 config.json", async () => {
    expect((await api("/account/alerts", "PUT", { lowBalanceUsd: 5000 })).status).toBe(400);
    const r = await api("/account/alerts", "PUT", { lowBalanceUsd: 20, lowBalancePush: true });
    expect(r.json.alerts).toEqual({ lowBalanceUsd: 20, push: true });
    expect(r.json.lowBalance).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")).modelflare).toMatchObject({ lowBalanceUsd: 20, lowBalancePush: true });
  });

  it("退出登录：撤销授权，断开内置网关，账户文件删除", async () => {
    const r = await api("/account/logout", "POST", {});
    expect(r.json).toMatchObject({ state: "signed_out", revoked: true });
    expect(mf.s.revoked).toHaveLength(1);
    expect((await api("/modelflare")).json.connected).toBe(false);
    expect(app.magpie!.listProviders()).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, "modelflare-account.json"))).toBe(false);
  }, 30_000);
});
