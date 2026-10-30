/**
 * Modelflare 账户：本机回环 PKCE 登录、令牌轮换、撤销、设备 Key、预算 Key，以及相关纯函数。
 * 用本地 mock 模拟 Modelflare 的 OIDC 与 connected-app 接口（不连真实服务）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listen, mockModelflare, approveInBrowser, readJson } from "./helpers.js";
import { discover, startLogin, pkcePair } from "../src/account/oauth.js";
import { AccountManager, summarizeUsage, type AccountHooks } from "../src/account/manager.js";
import { AccountVault } from "../src/account/vault.js";
import { referencePrice } from "../src/account/model-info.js";
import { MediaService } from "../src/agent/media.js";
import { AgentManager } from "../src/agent/manager.js";
import { locateDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { Store } from "../src/store/db.js";
import { bareModel, isBotProviderModel, routeModel, skillHeader } from "../src/modelflare.js";

describe("回环 PKCE 登录", () => {
  let mf: Awaited<ReturnType<typeof mockModelflare>>;
  beforeEach(async () => (mf = await mockModelflare()));
  afterEach(async () => mf.close());

  it("授权地址带公共客户端参数；state 不对的回调被忽略，正确的回调换到令牌且不带客户端密钥", async () => {
    const ep = await discover(mf.url);
    const attempt = await startLogin(ep, { clientId: "anymodel-bot", scope: "openid offline_access account api_keys", extra: { utm_source: "anymodelbot" } });
    const u = new URL(attempt.url);
    expect(u.origin + u.pathname).toBe(`${mf.url}/oauth/authorize`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: "anymodel-bot", code_challenge_method: "S256", prompt: "consent", utm_source: "anymodelbot" });
    expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    // 别的网页带着伪造的 state 来敲回调：不结束这次登录
    const forged = await fetch(`${u.searchParams.get("redirect_uri")}?code=x&state=forged`);
    expect(forged.status).toBe(404);

    const ok = await approveInBrowser(mf, attempt.url);
    expect(ok.status).toBe(200);
    const tokens = await attempt.result;
    expect(tokens.accessToken).toMatch(/^at-/);
    expect(tokens.refreshToken).toMatch(/^rt-/);
    const form = mf.s.tokenForms[0];
    expect(form.grant_type).toBe("authorization_code");
    expect(form.client_secret).toBeUndefined();
    // 回调端口只接受一次：再来一次连不上或 404
    const again = await fetch(`${u.searchParams.get("redirect_uri")}?code=y&state=${u.searchParams.get("state")}`).catch(() => undefined);
    expect(again === undefined || again.status === 404).toBe(true);
  });

  it("用户在授权页拒绝：登录以 access_denied 结束", async () => {
    const attempt = await startLogin(await discover(mf.url), { clientId: "anymodel-bot", scope: "openid offline_access" });
    const u = new URL(attempt.url);
    await fetch(`${u.searchParams.get("redirect_uri")}?error=access_denied&state=${u.searchParams.get("state")}`);
    await expect(attempt.result).rejects.toMatchObject({ code: "access_denied" });
  });

  it("发现文档把端点指到别的主机时拒绝", async () => {
    const evil = await listen((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ issuer: "x", authorization_endpoint: "https://evil.example/a", token_endpoint: "https://evil.example/t", revocation_endpoint: "https://evil.example/r" })));
    try {
      await expect(discover(evil.url)).rejects.toMatchObject({ code: "discovery" });
    } finally {
      await evil.close();
    }
  });

  it("PKCE challenge 是 verifier 的 SHA-256（base64url）", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(crypto.createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("AccountManager", () => {
  let mf: Awaited<ReturnType<typeof mockModelflare>>;
  let dir: string;
  let store: Store;
  let calls: string[];
  let alerts: string[];
  let manager: AccountManager;
  const hooks = (): AccountHooks => ({
    connectKey: async (key) => void calls.push(`connect:${key}`),
    disconnect: async () => void calls.push("disconnect"),
    setBotKey: async (botId, key) => void calls.push(`bot:${botId}:${key}`),
    removeBotKey: async (botId) => void calls.push(`unbot:${botId}`),
    keyBalance: async () => undefined,
    alert: (text) => void alerts.push(text),
  });
  const make = () => {
    const m = new AccountManager({ issuer: mf.url, vault: AccountVault.at(dir), store, hooks: hooks(), alerts: () => ({ lowBalanceUsd: 5, push: false }), hostname: "test-pc" });
    m.init();
    return m;
  };
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fn()).toBe(true);
  };
  const signIn = async () => {
    const url = await manager.startLogin();
    await approveInBrowser(mf, url);
    await until(() => manager.status().state === "signed_in");
  };

  beforeEach(async () => {
    mf = await mockModelflare();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-acct-"));
    store = new Store(":memory:");
    calls = [];
    alerts = [];
    manager = make();
  });
  afterEach(async () => {
    manager.cancelLogin();
    store.close();
    await mf.close();
  });

  it("登录后签发本机 Key 并接到内置网关；refresh token 只存在 600 权限的账户文件里", async () => {
    await signIn();
    expect(calls).toEqual(["connect:sk-key-1"]);
    expect(mf.s.keys[0].name).toBe("AnyModelBot · test-pc");
    const st = manager.status();
    expect(st).toMatchObject({ state: "signed_in", name: "Ada", source: "account", balanceUsd: 12.5 });
    expect(JSON.stringify(st)).not.toMatch(/rt-|at-/);
    const file = AccountVault.at(dir).file;
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(AccountVault.at(dir).load()).toMatchObject({ refreshToken: "rt-1", deviceKeyId: 1 });
  });

  it("重启后用 refresh token 换新令牌，轮换后的值立刻写回", async () => {
    await signIn();
    const again = make();
    expect(again.status().state).toBe("signed_in");
    await again.refresh();
    expect(again.status().balanceUsd).toBe(12.5);
    expect(AccountVault.at(dir).load()!.refreshToken).toBe("rt-2");
    expect(mf.s.refresh.has("rt-1")).toBe(false);
  });

  it("授权在网页上被撤销：断开内置网关、清掉账户文件、提示重新登录", async () => {
    await signIn();
    mf.s.revokeAll = true;
    const st = await manager.refresh();
    expect(st.state).toBe("signed_out");
    expect(calls).toContain("disconnect");
    expect(fs.existsSync(AccountVault.at(dir).file)).toBe(false);
    expect(alerts.some((a) => a.includes("授权已失效"))).toBe(true);
  });

  it("退出登录撤销 refresh token，再断开网关", async () => {
    await signIn();
    const r = await manager.logout();
    expect(r.revoked).toBe(true);
    expect(mf.s.revoked).toEqual(["rt-1"]);
    expect(calls.at(-1)).toBe("disconnect");
    expect(manager.status().state).toBe("signed_out");
  });

  it("余额跌破提醒线只提醒一次，回到线上后才会再提醒", async () => {
    await signIn();
    mf.s.balance = 4;
    await manager.refresh();
    await manager.refresh();
    expect(alerts.filter((a) => a.includes("余额只剩"))).toHaveLength(1);
    expect(manager.status().lowBalance).toBe(true);
    mf.s.balance = 6;
    await manager.refresh();
    mf.s.balance = 2;
    await manager.refresh();
    expect(alerts.filter((a) => a.includes("余额只剩"))).toHaveLength(2);
  });

  it("机器人预算：开启签发自己的 Key，调整只改上限，关闭删除 Key", async () => {
    await signIn();
    await manager.setBotBudget("b1", "写作助手", { enabled: true, limitUsd: 5 });
    expect(calls).toContain("bot:b1:sk-key-2");
    expect(mf.s.keys.find((k) => k.id === 2)).toMatchObject({ name: "AnyModelBot · 写作助手", limit_usd: 5 });
    await manager.setBotBudget("b1", "写作助手", { enabled: true, limitUsd: 8 });
    expect(mf.s.keys).toHaveLength(2);
    expect(mf.s.keys.find((k) => k.id === 2)!.limit_usd).toBe(8);
    expect(await manager.botBudgets()).toMatchObject({ b1: { limit_usd: 8 } });
    await manager.setBotBudget("b1", "写作助手", { enabled: false, limitUsd: 8 });
    expect(mf.s.keys.map((k) => k.id)).toEqual([1]);
    expect(calls).toContain("unbot:b1");
  });

  it("没登录时不能设预算", async () => {
    await expect(manager.setBotBudget("b1", "x", { enabled: true, limitUsd: 1 })).rejects.toMatchObject({ status: 409 });
  });
});

describe("账户文件加密", () => {
  it("有钥匙串时整份加密，换到没有钥匙串的运行方式读不出来", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-vault-"));
    const box = { encrypt: (p: string) => Buffer.from([...Buffer.from(p)].map((b) => b ^ 0x5a)), decrypt: (d: Buffer) => Buffer.from([...d].map((b) => b ^ 0x5a)).toString() };
    const rec = { issuer: "https://modelflare.dev", refreshToken: "rt-secret", scope: "openid", deviceKeyId: 3, signedInAt: 1 };
    AccountVault.at(dir, box).save(rec);
    expect(fs.readFileSync(AccountVault.at(dir).file, "utf8")).not.toContain("rt-secret");
    expect(AccountVault.at(dir, box).load()).toEqual(rec);
    expect(() => AccountVault.at(dir).load()).toThrow(/桌面版加密/);
  });
});

describe("模型路由与归因", () => {
  it("每个请求都限定 provider，同一模型在不同 provider 之间不会混用", () => {
    expect(routeModel("openai/gpt-x", "modelflare")).toBe("modelflare/openai/gpt-x");
    expect(routeModel("modelflare/openai/gpt-x", "mfb-b1")).toBe("mfb-b1/openai/gpt-x");
    expect(routeModel("mfb-b1/openai/gpt-x", "modelflare")).toBe("modelflare/openai/gpt-x");
    expect(bareModel("mfb-b1/x")).toBe("x");
    expect(isBotProviderModel("mfb-b1/openai/gpt-x")).toBe(true);
    expect(isBotProviderModel("modelflare/openai/gpt-x")).toBe(false);
  });

  it("归因头只接受纯数字版本号", () => {
    expect(skillHeader("0.1.3")).toEqual({ "X-Modelflare-Skill": "anymodel-bot/0.1.3" });
    expect(skillHeader("0.1.3-beta")).toEqual({});
  });
});

describe("用量汇总", () => {
  it("按本地日期与模型合计，金额 = quota / quota_per_unit", () => {
    const start = new Date(2026, 9, 28).getTime();
    const at = (d: number, h: number) => Math.floor(new Date(2026, 9, d, h).getTime() / 1000);
    const sum = summarizeUsage(
      [
        { model_name: "a", created_at: at(28, 9), count: 2, quota: 500_000, token_used: 10 },
        { model_name: "b", created_at: at(28, 23), count: 1, quota: 250_000, token_used: 10 },
        { model_name: "a", created_at: at(30, 1), count: 3, quota: 1_000_000, token_used: 10 },
      ],
      500_000,
      start,
      3,
    );
    expect(sum.days).toEqual([
      { date: "2026-10-28", usd: 1.5, requests: 3 },
      { date: "2026-10-29", usd: 0, requests: 0 },
      { date: "2026-10-30", usd: 2, requests: 3 },
    ]);
    expect(sum.models[0]).toEqual({ model: "a", usd: 3, requests: 5 });
    expect(sum.totalUsd).toBe(3.5);
  });
});

describe("参考价", () => {
  const catalog = { group_ratio: { default: 1, vip: 0.8, hidden: 0.1 }, usable_group: { default: "", vip: "" } };
  it("按可用公开分组里最低的倍率算每百万 tokens 的输入 / 输出价", () => {
    expect(referencePrice({ model_name: "m", quota_type: 0, input_price: 2.5, completion_ratio: 4, enable_groups: ["default", "vip", "hidden"] }, catalog)).toEqual({ input: 2, output: 8 });
  });
  it("按次计费；复杂计费和没有可用分组的不给价格", () => {
    expect(referencePrice({ model_name: "m", quota_type: 1, model_price: 0.05, enable_groups: ["default"] }, catalog)).toEqual({ perCall: 0.05 });
    expect(referencePrice({ model_name: "m", quota_type: 0, input_price: 1, billing_mode: "tiered_expr", enable_groups: ["default"] }, catalog)).toBeUndefined();
    expect(referencePrice({ model_name: "m", quota_type: 0, input_price: 1, enable_groups: ["hidden"] }, catalog)).toBeUndefined();
  });
});

describe("生图 / 生视频", () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  it("用机器人的 Key 调 Images API，图片存进工作区 media/；视频建任务、轮询、下载", async () => {
    const seen: Array<{ path: string; auth?: string; skill?: string }> = [];
    let polls = 0;
    const srv = await listen(async (req, res) => {
      const u = new URL(req.url!, "http://x");
      seen.push({ path: u.pathname + u.search, auth: req.headers.authorization, skill: req.headers["x-modelflare-skill"] as string });
      const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (u.pathname === "/v1/models") {
        return json({ data: u.searchParams.get("kind") === "image" ? [{ id: "gemini-img", kind: "image", image_route: "gemini-generate-content" }, { id: "gpt-image", kind: "image", image_route: "images" }] : [{ id: "veo", kind: "video" }] });
      }
      if (u.pathname === "/v1/images/generations") {
        expect(await readJson(req)).toMatchObject({ model: "gpt-image", prompt: "一只猫" });
        return json({ data: [{ b64_json: png.toString("base64") }] });
      }
      if (u.pathname === "/v1/videos" && req.method === "POST") return json({ id: "task-1", status: "queued" });
      if (u.pathname === "/v1/videos/task-1") return json({ id: "task-1", status: ++polls < 2 ? "in_progress" : "completed" });
      if (u.pathname === "/v1/videos/task-1/content") return res.writeHead(200, { "content-type": "video/mp4" }).end(Buffer.from("mp4"));
      res.writeHead(404).end();
    });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-media-"));
    try {
      const media = new MediaService({ baseUrl: () => srv.url + "/v1", keyFor: (b) => (b === "b1" ? "sk-bot" : ""), headers: () => skillHeader("0.1.3"), workspace: () => ws, pollMs: 5 });
      const text = await media.run("b1", "image", { prompt: "一只猫", model: "gpt-image" });
      const rel = text.match(/media\/image-[\w-]+\.png/)![0];
      expect(fs.readFileSync(path.join(ws, rel))).toEqual(png);
      expect(text).toContain("present");
      const vtext = await media.run("b1", "video", { prompt: "海浪" });
      expect(fs.readFileSync(path.join(ws, vtext.match(/media\/video-[\w-]+\.mp4/)![0]), "utf8")).toBe("mp4");
      expect(seen.every((x) => x.auth === "Bearer sk-bot" && x.skill === "anymodel-bot/0.1.3")).toBe(true);
      await expect(media.run("b2", "image", { prompt: "x" })).rejects.toThrow(/还没有连接/);
      await expect(media.run("b1", "image", { prompt: "x", model: "nope" })).rejects.toThrow(/没有这个模型/);
    } finally {
      await srv.close();
    }
  });
});

describe("amb-media 插件与 bridge", () => {
  const runtime = locateDshRuntime(findAppRoot());

  it.skipIf(!runtime)("用真实的 dsh-tools 注册 generate_image / generate_video，调用经 bridge 带上机器人与会话", async () => {
    const seen: any[] = [];
    const bridge = await listen(async (req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: await readJson(req) });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: "ok" }));
    });
    const env = { ...process.env };
    try {
      Object.assign(process.env, { AMB_BRIDGE_URL: bridge.url, AMB_BRIDGE_TOKEN: "tok", AMB_BOT_ID: "b1" });
      const plugin = await import(path.join(runtime!, "plugins", "amb-media.mjs"));
      const tools: any[] = [];
      plugin.apply({ tools: { register: (t: any) => tools.push(t) } });
      expect(tools.map((t) => t.name)).toEqual(["generate_image", "generate_video"]);
      expect(await tools[0].execute({ prompt: "猫" }, { agent: { session: { id: "s1" } }, signal: AbortSignal.timeout(5000) })).toEqual({ text: "ok" });
      expect(seen).toEqual([{ url: "/dsh/media", auth: "Bearer tok", body: { botId: "b1", sessionId: "s1", op: "image", args: { prompt: "猫" } } }]);
    } finally {
      process.env = env;
      await bridge.close();
    }
  });

  it("bridge 只在该机器人有回合进行中时受理生图（别的机器人不能借它的 Key）", async () => {
    const store = new Store(":memory:");
    const calls: string[] = [];
    const media = { run: async (botId: string) => (calls.push(botId), "done") } as unknown as MediaService;
    const mgr = new AgentManager({ store, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "amb-mgr-")), runtimeDir: undefined, upstream: () => ({ baseUrl: "", apiKey: "" }), enabled: false, media });
    await mgr.bridge.start();
    try {
      const r = await fetch(`${mgr.bridge.url}/dsh/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${mgr.bridge.token}`, "content-type": "application/json" },
        body: JSON.stringify({ botId: "b1", op: "image", args: { prompt: "x" } }),
      });
      expect(await r.json()).toEqual({ error: "unknown bot" });
      expect(calls).toEqual([]);
      const anon = await fetch(`${mgr.bridge.url}/dsh/media`, { method: "POST", body: "{}" });
      expect(anon.status).toBe(401);
    } finally {
      await mgr.bridge.stop();
      store.close();
    }
  });
});
