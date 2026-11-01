/**
 * 准入端到端：mock iLink + 假飞书 + 真实 App/Web（外部模型端点模式）。
 * 陌生人被拦（只回一句、不碰模型）→ 主人在微信里「同意 1234」或在应用里批准 → 对方能对话；拒绝、移除；
 * 飞书连上后第一个发消息的人成为主人（可以更换）；升级前已在对话的人自动加入允许名单。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { approvedText, refusalText } from "../src/core/access.js";
import { FakeFeishu, feishuEvent, mockIlink, mockOpenAI, until } from "./helpers.js";

let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let ilink: Awaited<ReturnType<typeof mockIlink>>;
let app: App;
let base: string;
const feishu = new FakeFeishu();
const OWNER = "owner@im.wechat";

async function api(p: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(base + "/amb/api" + p, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
/** 发给某人的微信消息（按顺序） */
const to = (user: string) => ilink.state.sent.filter((s) => s.to === user).map((s) => s.text);

beforeAll(async () => {
  llm = await mockOpenAI({ key: "gw-key" });
  ilink = await mockIlink();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-access-e2e-"));
  // 升级前的库：已经有人在用（微信 old@、飞书 oc_old），还没有允许名单
  const old = new DatabaseSync(path.join(dataDir, "anymodel.db"));
  old.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, channel TEXT NOT NULL, peer_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  const conv = old.prepare("INSERT INTO conversations(id, bot_id, channel, peer_id, title, created_at, updated_at) VALUES(?, 'default', ?, ?, ?, 1, 1)");
  conv.run("default:weixin:old@im.wechat", "weixin", "old@im.wechat", "old@im.wechat");
  conv.run("default:feishu:oc_old", "feishu", "oc_old", "ou_old");
  old.close();
  const config = loadConfig({
    dataDir,
    env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_WEIXIN_CDN_BASE: ilink.cdnBase, AMB_FEISHU_THROTTLE_MS: "30", AMB_AGENT: "off" },
  });
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret_test";
  app = new App(config, { feishuTransport: () => feishu, weixinPollTimeoutMs: 2000, printQrToTerminal: false });
  await app.start();
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  base = app.web!.url.replace(/\/$/, "");
  // 扫码登录：扫码的是 owner@im.wechat
  await api("/channel-accounts/default/weixin/login", { method: "POST", body: {} });
  await until(async () => (await api("/channel-accounts/default/channels")).json.weixin.state === "connected", 8000);
});

afterAll(async () => {
  await app?.stop();
  await llm?.close();
  await ilink?.close();
});

describe("微信：只有主人和允许的人", () => {
  it("扫码的人就是主人，直接能用", async () => {
    ilink.push(OWNER, "你好");
    await until(() => to(OWNER).length >= 1, 8000);
    expect(to(OWNER)[0]).toBe("[mock-a] 你说：你好");
    const acc = await api("/channel-accounts/default/access");
    expect(acc.json.owners.weixin).toMatchObject({ via: "login" });
    expect(acc.json.policy).toBe("owner-allowlist");
  });

  let code = "";
  it("陌生人：只回一句、不碰模型；主人在微信里收到带配对码的通知；请求出现在信息面板", async () => {
    const calls = llm.calls.length;
    const ownerMsgs = to(OWNER).length;
    ilink.push("zhang@im.wechat", "我是张三，想借用一下");
    await until(() => to("zhang@im.wechat").length >= 1 && to(OWNER).length > ownerMsgs, 8000);
    expect(to("zhang@im.wechat")).toEqual([refusalText()]);
    const notice = to(OWNER).at(-1)!;
    expect(notice).toContain("我是张三");
    code = /同意 (\d{4})/.exec(notice)![1];
    const acc = await api("/channel-accounts/default/access");
    expect(acc.json.requests).toEqual([expect.objectContaining({ channel: "weixin", code, text: "我是张三，想借用一下", status: "pending", requests: 1 })]);
    // 再发：不再回复、不再通知主人，模型一直没被调用
    ilink.push("zhang@im.wechat", "在吗？");
    await until(async () => (await api("/channel-accounts/default/access")).json.requests[0]?.requests === 2, 8000);
    await app.channels.get("default")!.weixin!.idle();
    expect(to("zhang@im.wechat")).toHaveLength(1);
    expect(to(OWNER).at(-1)).toBe(notice);
    expect(llm.calls.length).toBe(calls);
    expect(app.store.getConversation("default:weixin:zhang@im.wechat")).toBeUndefined();
  });

  it("主人回复「同意 1234」：对方收到通知，之后能正常对话", async () => {
    ilink.push(OWNER, `同意 ${code}`);
    await until(() => to(OWNER).at(-1)!.startsWith("✅"), 8000);
    expect(to(OWNER).at(-1)).toMatch(/^✅ 已允许「微信用户 .+」使用这个机器人$/);
    await until(() => to("zhang@im.wechat").length >= 2, 8000);
    expect(to("zhang@im.wechat")[1]).toBe(approvedText());
    ilink.push("zhang@im.wechat", "现在呢");
    await until(() => to("zhang@im.wechat").length >= 3, 8000);
    expect(to("zhang@im.wechat")[2]).toBe("[mock-a] 你说：现在呢");
    const acc = await api("/channel-accounts/default/access");
    expect(acc.json.requests).toEqual([]);
    expect(acc.json.entries).toEqual(expect.arrayContaining([expect.objectContaining({ channel: "weixin", status: "allowed", source: "request" })]));
  });

  it("在应用里拒绝：对方之后发什么都不回；在应用里批准、再移除：又被拦下", async () => {
    ilink.push("li@im.wechat", "hi");
    ilink.push("wang@im.wechat", "hello");
    await until(async () => (await api("/channel-accounts/default/access")).json.requests.length === 2, 8000);
    const reqs = (await api("/channel-accounts/default/access")).json.requests as any[];
    const li = reqs.find((r) => r.text === "hi");
    const wang = reqs.find((r) => r.text === "hello");
    expect((await api(`/channel-accounts/default/access/${li.id}/deny`, { method: "POST", body: {} })).json.entry.status).toBe("denied");
    expect((await api(`/channel-accounts/default/access/${wang.id}/approve`, { method: "POST", body: {} })).json.entry.status).toBe("allowed");
    expect((await api(`/channel-accounts/default/access/${wang.id}/approve`, { method: "POST", body: {} })).status).toBe(409);
    await until(() => to("wang@im.wechat").length >= 2, 8000);
    expect(to("wang@im.wechat")).toEqual([refusalText(), approvedText()]);

    const calls = llm.calls.length;
    ilink.push("li@im.wechat", "再试试");
    ilink.push("wang@im.wechat", "我能用了吗");
    await until(() => to("wang@im.wechat").length >= 3, 8000);
    await app.channels.get("default")!.weixin!.idle();
    expect(to("li@im.wechat")).toEqual([refusalText()]);
    expect(llm.calls.length).toBe(calls + 1);

    expect((await api(`/channel-accounts/default/access/${wang.id}`, { method: "DELETE" })).status).toBe(200);
    ilink.push("wang@im.wechat", "还能用吗");
    await until(async () => (await api("/channel-accounts/default/access")).json.requests.length === 1, 8000);
    await app.channels.get("default")!.weixin!.idle();
    expect(to("wang@im.wechat")).toHaveLength(4);
    expect(to("wang@im.wechat")[3]).toBe(refusalText());
    expect(llm.calls.length).toBe(calls + 1);
  });

  it("/status 显示谁能使用", async () => {
    ilink.push(OWNER, "/status");
    await until(() => to(OWNER).at(-1)!.includes("当前模型"), 8000);
    expect(to(OWNER).at(-1)).toMatch(/谁能使用：只有主人和允许名单里的人（微信主人 \S+，飞书主人未设置；已允许 \d+ 人）；1 个使用请求待处理/);
  });

  it("升级：升级前已在对话的人自动在允许名单里，能继续用，可以移除", async () => {
    const acc = await api("/channel-accounts/default/access");
    const old = acc.json.entries.filter((e: any) => e.source === "migration");
    expect(old.map((e: any) => e.channel).sort()).toEqual(["feishu", "weixin"]);
    ilink.push("old@im.wechat", "我还能用吗");
    await until(() => to("old@im.wechat").length >= 1, 8000);
    expect(to("old@im.wechat")).toEqual(["[mock-a] 你说：我还能用吗"]);
  });
});

describe("飞书：第一个发消息的人成为主人", () => {
  it("还没有主人：第一个发消息的人成为主人，这条消息照常回复；之后的人是使用请求，主人在飞书里「允许 1234」", async () => {
    // 模拟过了一小时：上面的请求通知不占这里的限额
    app.store.db.prepare("UPDATE access SET notified_at = 0").run();
    const ch = app.channels.get("default")!.feishu!;
    expect((await api("/channel-accounts/default/access")).json.owners.feishu).toBeNull();
    const texts = feishu.texts.length;
    feishu.onMessage!(feishuEvent("我是老板", { chatId: "oc_boss", senderOpenId: "ou_boss" }));
    await ch.idle();
    expect([...feishu.cards.values()].at(-1)).toBe("[mock-a] 你说：我是老板");
    expect(feishu.texts.length).toBe(texts);
    const acc = (await api("/channel-accounts/default/access")).json;
    expect(acc.owners.feishu).toEqual({ via: "first-message", peer: "oc_boss", name: "ou_boss" });
    expect(acc.requests.filter((r: any) => r.channel === "feishu")).toEqual([]);

    // 同事来了：飞书主人和微信主人都收到配对码，主人在飞书里回复「允许 1234」
    const ownerWx = to(OWNER).length;
    feishu.onMessage!(feishuEvent("借用一下", { chatId: "oc_colleague", senderOpenId: "ou_colleague" }));
    await ch.idle();
    expect(feishu.texts.at(-1)).toBe(refusalText());
    const notice = feishu.notices.at(-1)!;
    expect(notice.chatId).toBe("oc_boss");
    const code = /同意 (\d{4})/.exec(notice.text)![1];
    await until(() => to(OWNER).length > ownerWx, 8000);
    expect(to(OWNER).at(-1)).toContain(`同意 ${code}`);
    feishu.onMessage!(feishuEvent(`允许 ${code}`, { chatId: "oc_boss", senderOpenId: "ou_boss" }));
    await ch.idle();
    expect(feishu.texts.at(-1)).toMatch(/^✅ 已允许「飞书用户 .+」使用这个机器人$/);
    expect(feishu.notices.at(-1)).toMatchObject({ chatId: "oc_colleague", text: approvedText() });
    feishu.onMessage!(feishuEvent("谢谢", { chatId: "oc_colleague", senderOpenId: "ou_colleague" }));
    await ch.idle();
    expect([...feishu.cards.values()].at(-1)).toBe("[mock-a] 你说：谢谢");
  });

  it("更换：清掉主人，下一个发消息的人成为主人；扫码登录的微信主人不能这样换", async () => {
    const ch = app.channels.get("default")!.feishu!;
    expect((await api("/channel-accounts/default/access/owner/weixin", { method: "DELETE" })).status).toBe(409);
    expect((await api("/channel-accounts/default/access/owner/feishu", { method: "DELETE" })).status).toBe(200);
    expect((await api("/channel-accounts/default/access")).json.owners.feishu).toBeNull();
    feishu.onMessage!(feishuEvent("这是我自己的飞书", { chatId: "oc_me", senderOpenId: "ou_me" }));
    await ch.idle();
    expect([...feishu.cards.values()].at(-1)).toBe("[mock-a] 你说：这是我自己的飞书");
    expect((await api("/channel-accounts/default/access")).json.owners.feishu).toMatchObject({ via: "first-message", peer: "oc_me" });
    // 原来的主人要重新申请；被允许的同事照常能用
    feishu.onMessage!(feishuEvent("我还是主人吗", { chatId: "oc_boss", senderOpenId: "ou_boss" }));
    await ch.idle();
    expect(feishu.texts.at(-1)).toBe(refusalText());
    feishu.onMessage!(feishuEvent("我还能用吗", { chatId: "oc_colleague", senderOpenId: "ou_colleague" }));
    await ch.idle();
    expect([...feishu.cards.values()].at(-1)).toBe("[mock-a] 你说：我还能用吗");
  });

  it("升级前的飞书单聊照常能用", async () => {
    const ch = app.channels.get("default")!.feishu!;
    feishu.onMessage!(feishuEvent("老用户", { chatId: "oc_old", senderOpenId: "ou_old" }));
    await ch.idle();
    expect([...feishu.cards.values()].at(-1)).toBe("[mock-a] 你说：老用户");
  });

  it("网页控制台不受限制", async () => {
    const r = await api("/bots/default/chat", { method: "POST", body: { text: "控制台" } });
    expect(r.json.reply).toBe("[mock-a] 你说：控制台");
  });
});
