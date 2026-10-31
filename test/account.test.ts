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
import { loadModelInfo, referencePrice } from "../src/account/model-info.js";
import { MediaService, docSection, estimateUsd, type MediaModel } from "../src/agent/media.js";
import { AgentManager, MEDIA_ASK_USD, mediaAsk } from "../src/agent/manager.js";
import { normalizeSettings } from "../src/agent/settings.js";
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

describe("模型资料", () => {
  it("上下文长度：有 Key 用 model-profiles，没有就用公开价格目录里的", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/model-profiles")) return Response.json({ data: { "gpt-6.1-terra": { context_window: 1_050_000, input_modalities: ["text", "image"] } } });
      return Response.json({ data: [{ model_name: "gpt-6.1-terra", quota_type: 0, context_window: 999 }, { model_name: "grok-4.7", quota_type: 0, context_window: 256_000 }] });
    }) as any;
    const base = { baseUrl: "http://mf/v1", headers: {}, pricingUrl: "http://mf/api/pricing", fetchImpl };
    const withKey = await loadModelInfo({ ...base, apiKey: "k" });
    expect(withKey["gpt-6.1-terra"]).toMatchObject({ context: 1_050_000, vision: true });
    expect(withKey["grok-4.7"].context).toBe(256_000);
    const noKey = await loadModelInfo({ ...base, apiKey: "" });
    expect(noKey["gpt-6.1-terra"].context).toBe(999);
  });

  it("支持的接口：公开目录里的 supported_endpoint_types；推理能力来自 model-profiles", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/model-profiles")) return Response.json({ data: { "gpt-6.1-terra": { reasoning: true }, "claude-sonnet-5": { reasoning: true } } });
      return Response.json({
        data: [
          { model_name: "gpt-6.1-terra", quota_type: 0, supported_endpoint_types: ["openai-response", "openai-response-compact", "openai"] },
          { model_name: "claude-sonnet-5", quota_type: 0, supported_endpoint_types: ["anthropic", "openai"] },
          { model_name: "old-model", quota_type: 0 },
        ],
      });
    }) as any;
    const info = await loadModelInfo({ baseUrl: "http://mf/v1", apiKey: "k", headers: {}, pricingUrl: "http://mf/api/pricing", fetchImpl });
    expect(info["gpt-6.1-terra"]).toMatchObject({ reasoning: true, endpoints: ["openai-response", "openai-response-compact", "openai"] });
    expect(info["claude-sonnet-5"].endpoints).toEqual(["anthropic", "openai"]);
    expect(info["old-model"]?.endpoints).toBeUndefined();
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

  it("按文档写的请求体原样发出：填上 model，工作区文件换成 data URL / Base64，工作区外的文件不让引用", async () => {
    const bodies: Array<{ path: string; body: any }> = [];
    const srv = await listen(async (req, res) => {
      const u = new URL(req.url!, "http://x");
      const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (u.pathname === "/v1/models") {
        return json({ data: u.searchParams.get("kind") === "image" ? [{ id: "gemini-img", kind: "image", image_route: "gemini-generate-content" }, { id: "gpt-image", kind: "image", image_route: "images" }] : [{ id: "kling-x", kind: "video" }] });
      }
      if (req.method !== "POST") return res.writeHead(404).end();
      bodies.push({ path: u.pathname, body: await readJson(req) });
      if (u.pathname.endsWith(":generateContent")) return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] });
      if (u.pathname === "/v1/images/edits") return json({ data: [{ b64_json: png.toString("base64") }] });
      if (u.pathname === "/v1/videos") return json({ id: "t1" });
      res.writeHead(404).end();
    });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-media-"));
    fs.mkdirSync(path.join(ws, "media"));
    fs.writeFileSync(path.join(ws, "media", "ref.png"), png);
    try {
      const media = new MediaService({ baseUrl: () => srv.url + "/v1", keyFor: () => "sk", headers: () => ({}), workspace: () => ws, pollMs: 5, videoTimeoutMs: 1 });
      await media.run("b1", "image", {
        prompt: "换成水彩",
        model: "gemini-img",
        body: { model: "ignored", contents: [{ role: "user", parts: [{ text: "换成水彩" }, { inline_data: { mime_type: "image/png", data: "workspace-base64:media/ref.png" } }] }] },
      });
      expect(bodies[0].path).toBe("/v1/models/gemini-img:generateContent");
      expect(bodies[0].body).toEqual({ contents: [{ role: "user", parts: [{ text: "换成水彩" }, { inline_data: { mime_type: "image/png", data: png.toString("base64") } }] }] });

      await media.run("b1", "image", { prompt: "加一顶帽子", model: "gpt-image", endpoint: "edits", body: JSON.stringify({ prompt: "加一顶帽子", images: [{ image_url: "workspace:media/ref.png" }] }) });
      expect(bodies[1]).toEqual({ path: "/v1/images/edits", body: { prompt: "加一顶帽子", images: [{ image_url: `data:image/png;base64,${png.toString("base64")}` }], model: "gpt-image" } });

      // 视频：body 原样带上 model 发出（这个 mock 不回答轮询，只看建任务的请求）
      await expect(media.run("b1", "video", { prompt: "猫", body: { contents: [{ type: "prompt", text: "猫" }], settings: { duration: 5 } } })).rejects.toThrow();
      expect(bodies[2]).toEqual({ path: "/v1/videos", body: { contents: [{ type: "prompt", text: "猫" }], settings: { duration: 5 }, model: "kling-x" } });

      await expect(media.run("b1", "image", { prompt: "x", model: "gemini-img", body: { a: "workspace:../../etc/passwd" } })).rejects.toThrow(/工作区/);
      await expect(media.run("b1", "image", { prompt: "x", model: "gemini-img", body: "{oops" })).rejects.toThrow(/JSON/);
      expect(bodies).toHaveLength(3);
    } finally {
      await srv.close();
    }
  });

  it("默认模型：设置里选的优先；没选时按价格目录的推荐顺序，跳过必须带参考素材的；确认时附参考价", async () => {
    const srv = await listen(async (req, res) => {
      const u = new URL(req.url!, "http://x");
      const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (u.pathname === "/v1/models") return json({ data: [{ id: "a-i2v", kind: "video" }, { id: "b-t2v", kind: "video" }, { id: "c-pro", kind: "video" }] });
      if (u.pathname === "/api/pricing") {
        return json({
          group_ratio: { Media: 1 },
          usable_group: { Media: "" },
          data: [
            { model_name: "a-i2v", enable_groups: ["Media"], media_options: { video: { requires_reference: true, resolutions: ["720p"] } } },
            { model_name: "b-t2v", enable_groups: ["Media"], video_resolution_price: { "720p": 0.05, "1080p": 0.1 }, media_options: { video: { default_resolution: "720p", seconds: [-1, 4, 10] } } },
            { model_name: "c-pro", enable_groups: ["Media"], display_priority: 5 },
          ],
        });
      }
      res.writeHead(404).end();
    });
    const defaults = { image: "", video: "" };
    try {
      const media = new MediaService({ baseUrl: () => srv.url + "/v1", keyFor: () => "sk", headers: () => ({}), workspace: () => os.tmpdir(), defaults: () => defaults, pricingUrl: () => srv.url + "/api/pricing" });
      const list = await media.models("b1", "video");
      expect(list.map((m) => m.id)).toEqual(["c-pro", "b-t2v", "a-i2v"]);
      expect(list[1].price).toBe("$0.05/秒（720p）");
      let plan = await media.prepare("b1", "video", { prompt: "海浪" });
      expect(plan.model.id).toBe("c-pro");
      expect(plan.candidates.map((m) => m.id)).toEqual(["b-t2v"]);
      defaults.video = "b-t2v";
      plan = await media.prepare("b1", "video", { prompt: "海浪", body: { duration: 10, ratio: "16:9", content: [{ image_url: { url: "workspace:media/x.png" } }] } });
      expect(plan.model.id).toBe("b-t2v");
      expect(plan.custom).toBe(true);
      // 带了参考素材，必须带参考素材的模型也列进可选
      expect(plan.candidates.map((m) => m.id)).toEqual(["c-pro", "a-i2v"]);
      expect(plan.summary).toContain("10 秒");
      expect(plan.summary).toContain("1 个参考素材");
      expect(plan.summary).toContain("参考价：$0.05/秒（720p）");
      expect(await media.listText("b1", "video")).toMatch(/- b-t2v（默认） — \$0\.05\/秒（720p） — 时长 4–10 秒/);
      // 预计花费：按秒数和分辨率；没写时长按最长的算；没有价格的算不出来
      expect(plan.estimate).toBeCloseTo(0.5);
      expect((await media.prepare("b1", "video", { prompt: "海浪", body: { duration: 4, resolution: "1080p" } })).estimate).toBeCloseTo(0.4);
      expect((await media.prepare("b1", "video", { prompt: "海浪" })).estimate).toBeCloseTo(0.5);
      expect((await media.prepare("b1", "video", { prompt: "海浪", seconds: 4 })).estimate).toBeCloseTo(0.2);
      expect((await media.prepare("b1", "video", { prompt: "海浪", model: "c-pro" })).estimate).toBeUndefined();
    } finally {
      await srv.close();
    }
  });

  it("预计花费：图片按张数，按次计费的按次数", () => {
    const img: MediaModel = { id: "i", kind: "image", route: "images", requiresReference: false, price: "$0.04/张", cost: { per: "image", usd: 0.04 }, priority: 1 };
    expect(estimateUsd(img, undefined, {})).toBeCloseTo(0.04);
    expect(estimateUsd(img, { n: 4 }, {})).toBeCloseTo(0.16);
    expect(estimateUsd(img, { generationConfig: { candidateCount: 2 } }, {})).toBeCloseTo(0.08);
    expect(estimateUsd({ ...img, cost: undefined }, undefined, {})).toBeUndefined();
  });

  it("文档：从全文里取出该模型那一节", () => {
    const full = [
      "# Overview\n\nSource: https://docs.x/\n\nhello",
      "# kling-3.0 API\n\nSource: https://docs.x/models/video/kling-3-0/\n\nbody A",
      "# kling-3.0-turbo API\n\nSource: https://docs.x/models/video/kling-3-0-turbo/\n\nbody B\n\n## Params\n\n| a |",
    ].join("\n\n---\n\n");
    expect(docSection(full, "https://docs.x", "video", "kling-3.0")).toBe("# kling-3.0 API\n\nSource: https://docs.x/models/video/kling-3-0/\n\nbody A");
    expect(docSection(full, "https://docs.x", "video", "kling-3.0-turbo")).toMatch(/^# kling-3\.0-turbo API[\s\S]*\| a \|$/);
    expect(docSection(full, "https://docs.x", "image", "kling-3.0")).toBe("");
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
      expect(tools.map((t) => t.name)).toEqual(["media_models", "media_docs", "generate_image", "generate_video"]);
      const image = tools.find((t) => t.name === "generate_image");
      const body = { contents: [{ parts: [{ text: "猫" }, { inline_data: { mime_type: "image/png", data: "workspace-base64:media/a.png" } }] }] };
      expect(await image.execute({ prompt: "猫", body }, { agent: { session: { id: "s1" } }, signal: AbortSignal.timeout(5000) })).toEqual({ text: "ok" });
      expect(seen).toEqual([{ url: "/dsh/media", auth: "Bearer tok", body: { botId: "b1", sessionId: "s1", op: "image", args: { prompt: "猫", body } } }]);
    } finally {
      process.env = env;
      await bridge.close();
    }
  });

  it("什么时候先问：每次都问 > 代理说要问 > 花费超过上限（视频算不出也算）> 不是默认模型（用户点名的除外）", () => {
    const M1 = { id: "m1" } as MediaModel;
    const M2 = { id: "m2" } as MediaModel;
    const plan = (o: { model?: MediaModel; estimate?: number; kind?: "image" | "video" } = {}) => ({ kind: o.kind ?? ("image" as const), model: o.model ?? M1, default: M1, estimate: o.estimate });
    expect(mediaAsk(plan({ estimate: 0.04 }), undefined, "auto")).toBeUndefined();
    expect(mediaAsk(plan({ estimate: 0.04 }), undefined, "always")).toBe("always");
    expect(mediaAsk(plan({ estimate: 0.04 }), true, "auto")).toBe("agent");
    expect(mediaAsk(plan({ estimate: 0.04 }), "true", "auto")).toBe("agent");
    expect(mediaAsk(plan({ estimate: MEDIA_ASK_USD }), undefined, "auto")).toBeUndefined();
    expect(mediaAsk(plan({ estimate: MEDIA_ASK_USD + 0.01 }), false, "auto")).toBe("cost");
    // 图片算不出花费不问（便宜），视频算不出就问
    expect(mediaAsk(plan({}), undefined, "auto")).toBeUndefined();
    expect(mediaAsk(plan({ kind: "video" }), undefined, "auto")).toBe("cost");
    expect(mediaAsk(plan({ kind: "video", estimate: 0.3 }), undefined, "auto")).toBeUndefined();
    expect(mediaAsk(plan({ model: M2, estimate: 0.04 }), undefined, "auto")).toBe("model");
    expect(mediaAsk(plan({ model: M2, estimate: 0.04 }), false, "auto")).toBeUndefined();
  });

  it("默认模型、花费不高直接生成；换模型、花费高、代理要问、设成每次都问时先问；换模型后按新文档重写的那一次免确认", async () => {
    const store = new Store(":memory:");
    store.createBot({ id: "b1", name: "b1" });
    const M1 = { id: "m1", kind: "image", price: "$0.03/张" };
    const M2 = { id: "m2", kind: "image", price: "" };
    const ran: string[] = [];
    const media = {
      prepare: async (_b: string, op: string, args: any) => ({
        kind: op,
        model: args.model === "m2" ? M2 : M1,
        default: M1,
        candidates: [M2],
        all: [M1, M2],
        custom: !!args.body,
        summary: "提示词：猫",
        estimate: 0.03 * (args.body?.n ?? 1),
      }),
      execute: async (_b: string, model: { id: string }) => (ran.push(model.id), `done ${model.id}`),
    } as unknown as MediaService;
    const mgr = new AgentManager({ store, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "amb-mgr-")), runtimeDir: undefined, upstream: () => ({ baseUrl: "", apiKey: "" }), enabled: false, media });
    // 模拟机器人 b1 在会话 c1 里有回合进行中
    (mgr as any).hosts.set("b1", {});
    (mgr as any).activeConvs.set("b1", new Set(["c1"]));
    await mgr.bridge.start();
    const call = (args: Record<string, unknown>) =>
      fetch(`${mgr.bridge.url}/dsh/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${mgr.bridge.token}`, "content-type": "application/json" },
        body: JSON.stringify({ botId: "b1", sessionId: "s1", op: "image", args }),
      }).then((r) => r.json());
    const answer = async (a: { selected?: string[]; custom?: string }) => {
      for (let i = 0; i < 100; i++) {
        const q = mgr.approvals.pending("c1", "question")[0];
        if (q) {
          const [item] = JSON.parse(q.payload);
          mgr.approvals.answer(q.id, { answers: [{ id: "model", selected: a.selected ?? [], ...(a.custom ? { custom: a.custom } : {}) }] }, "test");
          return item;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("没有等到确认");
    };
    try {
      // 默认模型、花费不高：不问，直接生成
      expect(await call({ prompt: "猫" })).toEqual({ text: "done m1" });
      expect(mgr.approvals.pending("c1", "question")).toEqual([]);
      // 用户点名了别的模型（confirm: false）：也不问
      expect(await call({ prompt: "猫", model: "m2", confirm: false })).toEqual({ text: "done m2" });

      // 代理自己换了模型：问，并说明默认是哪个
      let [r, q] = await Promise.all([call({ prompt: "猫", model: "m2" }), answer({ selected: ["m2"] })]);
      expect(q.question).toBe("这次用 m2 生成图片吗？");
      expect(q.detail).toContain("不是默认模型（默认是 m1）");
      expect(q.options.map((o: any) => o.label)).toEqual(["m2", "m2", "取消"]);
      expect(r).toEqual({ text: "done m2" });

      // 花费超过上限：就算 confirm: false 也问；附上预计花费
      [r, q] = await Promise.all([call({ prompt: "猫", body: { n: 30 }, confirm: false }), answer({ selected: ["取消"] })]);
      expect(q.detail).toContain(`预计花费约 $0.9，超过 $${MEDIA_ASK_USD}`);
      expect(r.text).toMatch(/取消/);

      // 要求不明确（confirm: true）：问；请求体按 m1 的文档写的，换成 m2 时先让代理按 m2 的文档重写，重写后的那一次不再确认
      [r, q] = await Promise.all([call({ prompt: "猫", body: { a: 1 }, confirm: true }), answer({ custom: "用 M2" })]);
      expect(q.options[0]).toEqual({ label: "m1", description: "默认 · $0.03/张" });
      expect(r.text).toMatch(/media_docs 查 m2/);
      expect(await call({ prompt: "猫", model: "m2", body: { b: 1 } })).toEqual({ text: "done m2" });

      [r] = await Promise.all([call({ prompt: "猫", confirm: true }), answer({ custom: "好的" })]);
      expect(r).toEqual({ text: "done m1" });
      [r] = await Promise.all([call({ prompt: "猫", confirm: true }), answer({ custom: "换成竖屏的" })]);
      expect(r.text).toMatch(/「换成竖屏的」/);

      // 机器人设成每次都问
      store.updateBot("b1", { settings: normalizeSettings({ media: { confirm: "always" } }) });
      [r] = await Promise.all([call({ prompt: "猫" }), answer({ selected: ["m1"] })]);
      expect(r).toEqual({ text: "done m1" });
      expect(ran).toEqual(["m1", "m2", "m2", "m2", "m1", "m1"]);
    } finally {
      await mgr.bridge.stop();
      store.close();
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
