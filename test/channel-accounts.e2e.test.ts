/**
 * 全局渠道账号端到端：真实 App/Web（外部模型端点模式）+ 假传输层。
 * 一个账号所有机器人共用，发一次 /bot 就切换并记住；同一个渠道可以加多个账号；别名；名单跟着账号；删机器人不影响账号；升级时老数据不用搬。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botPrompt, botTeam } from "../src/agent/prompts/index.js";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { botForPeer, defaultBotFor, findBot, setBotForPeer } from "../src/core/routes.js";
import { Store } from "../src/store/db.js";
import { FakeFeishu, FakeMessenger, messengerEvent, mockOpenAI } from "./helpers.js";

let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let app: App;
let base: string;
/** 账号 key → 假 Telegram（检查凭据和真正连上用的是两个对象，留最后建的） */
const fakes = new Map<string, FakeMessenger>();
let secondBot = "";

async function api(p: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(base + "/amb/api" + p, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const say = async (key: string, chatId: string, text: string) => {
  fakes.get(key)!.onMessage!(messengerEvent(text, { chatId, senderId: chatId, senderName: chatId }));
  await app.channels.get(key)!.messengers!.telegram!.idle();
};
const shown = (key: string, chatId: string) => fakes.get(key)!.lastShown(chatId);
const account = async (key: string) => (await api("/channel-accounts")).json.accounts.find((a: any) => a.key === key);

beforeAll(async () => {
  llm = await mockOpenAI({ key: "gw-key" });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-channel-accounts-"));
  const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_AGENT: "off" } });
  app = new App(config, {
    printQrToTerminal: false,
    feishuTransport: () => new FakeFeishu(),
    messengerTransport: (id, key) => {
      const f = new FakeMessenger(id);
      fakes.set(key, f);
      return f;
    },
  });
  await app.start();
  base = app.web!.url.replace(/\/$/, "");
  await api("/bots/default", { method: "PUT", body: { defaultModel: "mock-a" } });
  const second = await api("/bots", { method: "POST", body: { name: "阿紫", defaultModel: "mock-b" } });
  secondBot = second.json.bot.id;
});

afterAll(async () => {
  await app?.stop();
  await llm?.close();
});

describe("一个账号，所有机器人共用", () => {
  it("新账号：要一个 key，连上才真的存；默认由第一个机器人回复", async () => {
    const { key } = (await api("/channel-accounts/new-key", { method: "POST", body: {} })).json;
    expect(key).toMatch(/^acct_/);
    expect(await account(key)).toBeUndefined();
    expect((await api(`/channel-accounts/${key}/telegram`, { method: "PUT", body: { token: "1:SECRET-TOKEN-VALUE" } })).status).toBe(200);
    const a = await account(key);
    expect(a).toMatchObject({ channel: "telegram", number: 1, defaultBot: "default", enabled: true });
    expect(JSON.stringify((await api("/channel-accounts")).json)).not.toContain("SECRET-TOKEN-VALUE");
    await say(key, "boss", "你好");
    expect(shown(key, "boss")).toBe("[mock-a] 你说：你好");
  });

  it("/bot 列出所有机器人，标出现在是哪个，不碰模型", async () => {
    const key = (await api("/channel-accounts")).json.accounts[0].key;
    const before = llm.calls.length;
    await say(key, "boss", "/bot");
    const text = shown(key, "boss")!;
    expect(text).toMatch(/1\. .*（现在）/);
    expect(text).toContain("2. 阿紫");
    expect(llm.calls.length).toBe(before);
  });

  it("发一次 /bot 名字：切换并记住，之后不用每句都带", async () => {
    const key = (await api("/channel-accounts")).json.accounts[0].key;
    await say(key, "boss", "/bot 阿紫");
    expect(shown(key, "boss")).toContain("阿紫");
    await say(key, "boss", "第一句");
    expect(shown(key, "boss")).toBe("[mock-b] 你说：第一句");
    await say(key, "boss", "第二句");
    expect(shown(key, "boss")).toBe("[mock-b] 你说：第二句");
    // 会话归新机器人，记着走哪个账号
    const conv = app.store.getConversation(`${secondBot}:telegram:boss`)!;
    expect(conv.account).toBe(key);
    expect(app.store.listMessages(conv.id).map((m) => m.content)).toContain("第二句");
    // 重启后还记得
    await app.restartBot(key);
    await say(key, "boss", "重启后");
    expect(shown(key, "boss")).toBe("[mock-b] 你说：重启后");
    // 序号也能切回去
    await say(key, "boss", "/bot 1");
    await say(key, "boss", "回来了");
    expect(shown(key, "boss")).toBe("[mock-a] 你说：回来了");
  });

  it("没这个机器人：说清楚，不换", async () => {
    const key = (await api("/channel-accounts")).json.accounts[0].key;
    await say(key, "boss", "/bot 不存在的");
    expect(shown(key, "boss")).toContain("没找到");
    await say(key, "boss", "还是原来的");
    expect(shown(key, "boss")).toBe("[mock-a] 你说：还是原来的");
  });

  it("名单跟着账号：主人切到别的机器人也不用再申请", async () => {
    const key = (await api("/channel-accounts")).json.accounts[0].key;
    await say(key, "boss", "/bot 阿紫");
    await say(key, "boss", "还能用吗");
    expect(shown(key, "boss")).toBe("[mock-b] 你说：还能用吗");
    const access = (await api(`/channel-accounts/${key}/access`)).json;
    expect(access.owners.telegram).toMatchObject({ peer: "boss" });
    expect(access.requests).toEqual([]);
    await say(key, "boss", "/bot 1");
  });

  it("主动消息走这个账号（渠道换了机器人也不串）", async () => {
    const key = (await api("/channel-accounts")).json.accounts[0].key;
    await app.channels.get(key)!.messengers!.telegram!.notify("boss", "通知一下", "notice:test");
    await app.channels.get(key)!.messengers!.telegram!.idle();
    const row = app.store.getOutbox("notice:test")!;
    expect(row.account).toBe(key);
    expect(row.botId).toBe("default");
    expect(row.status).toBe("sent");
    expect(fakes.get(key)!.lastShown("boss")).toBe("通知一下");
  });

  it("/help 里有 /bot", async () => {
    const key = (await api("/channel-accounts")).json.accounts[0].key;
    await say(key, "boss", "/help");
    expect(shown(key, "boss")).toContain("/bot");
  });
});

describe("同一个渠道多个账号", () => {
  it("第二个账号：序号往后排，默认名字不重复，可以指定别的默认机器人", async () => {
    const first = (await api("/channel-accounts")).json.accounts[0];
    const { key } = (await api("/channel-accounts/new-key", { method: "POST", body: {} })).json;
    await api(`/channel-accounts/${key}/telegram`, { method: "PUT", body: { token: "2:OTHER" } });
    const a = await account(key);
    expect(a.number).toBe(2);
    expect(a.label).not.toBe(first.label);
    expect((await api(`/channel-accounts/${key}/telegram/settings`, { method: "PUT", body: { defaultBot: secondBot } })).status).toBe(200);
    await say(key, "fan", "你是谁");
    expect(shown(key, "fan")).toBe("[mock-b] 你说：你是谁");
    // 另一个账号的主人是分开的
    expect((await api(`/channel-accounts/${key}/access`)).json.owners.telegram).toMatchObject({ peer: "fan" });
    expect((await api(`/channel-accounts/${first.key}/access`)).json.owners.telegram).toMatchObject({ peer: "boss" });
  });

  it("别名：同一个渠道不能重复（不分大小写），不能为空或全是数字；默认机器人要存在", async () => {
    const [a, b] = (await api("/channel-accounts")).json.accounts;
    const set = (key: string, body: unknown) => api(`/channel-accounts/${key}/telegram/settings`, { method: "PUT", body });
    expect((await set(a.key, { label: "Work" })).status).toBe(200);
    expect((await set(b.key, { label: "work" })).status).toBe(400);
    expect((await set(b.key, { label: "  " })).status).toBe(400);
    expect((await set(b.key, { label: "2" })).status).toBe(400);
    expect((await set(b.key, { defaultBot: "nobody" })).status).toBe(404);
    expect((await set(a.key, { label: "WORK" })).status).toBe(200);
    expect((await account(a.key)).label).toBe("WORK");
    expect((await set("nope", { label: "x" })).status).toBe(404);
  });

  it("移除账号：连接断开，凭据和名单都清掉，机器人和聊天记录都在", async () => {
    const accounts = (await api("/channel-accounts")).json.accounts;
    const { key } = accounts[1];
    const fake = fakes.get(key)!;
    expect((await api(`/channel-accounts/${key}/telegram`, { method: "DELETE" })).status).toBe(200);
    expect(fake.stopped).toBe(1);
    expect(await account(key)).toBeUndefined();
    expect(app.store.getMessengerAccount(key, "telegram")).toBeUndefined();
    expect(app.store.listAccess({ botId: key, channel: "telegram" })).toEqual([]);
    expect(app.store.getBot(secondBot)).toBeTruthy();
    expect(app.store.getConversation(`${secondBot}:telegram:fan`)).toBeTruthy();
  });
});

describe("删除机器人", () => {
  it("账号不受影响：选过它的人回到默认机器人，账号的默认机器人没了就用第一个", async () => {
    const third = (await api("/bots", { method: "POST", body: { name: "小橙", defaultModel: "mock-b" } })).json.bot.id;
    const { key } = (await api("/channel-accounts")).json.accounts[0];
    const fake = fakes.get(key)!;
    await say(key, "boss", "/bot 小橙");
    await say(key, "boss", "在吗");
    expect(shown(key, "boss")).toBe("[mock-b] 你说：在吗");
    await api(`/channel-accounts/${key}/telegram/settings`, { method: "PUT", body: { defaultBot: third } });
    expect((await api(`/bots/${third}`, { method: "DELETE" })).status).toBe(200);
    expect(fake.stopped).toBe(0);
    expect((await account(key)).defaultBot).toBe("default");
    await say(key, "boss", "还在");
    expect(shown(key, "boss")).toBe("[mock-a] 你说：还在");
  });
});

describe("升级：老数据变成全局账号", () => {
  it("机器人上的飞书、微信、其他平台：key 沿用机器人 id，默认机器人是它自己，名字不撞车", async () => {
    const bot = app.store.createBot({ id: "old-bot", name: "WORK", systemPrompt: "", feishuAppId: "cli_old", feishuAppSecret: "old-secret", weixinEnabled: false });
    app.store.saveWeixinAccount({ botId: bot.id, botToken: "t", ilinkBotId: "i", baseUrl: "http://127.0.0.1:1", ownerUserId: "me" });
    app.store.saveMessengerAccount({ botId: bot.id, channel: "telegram", credentials: { token: "3:OLD" }, name: "" });
    await app.startBot(bot.id);
    const rows = app.store.listChannelAccounts().filter((a) => a.key === bot.id);
    expect(rows.map((a) => a.channel).sort()).toEqual(["feishu", "telegram", "weixin"]);
    expect(rows.every((a) => a.defaultBot === bot.id)).toBe(true);
    // 飞书凭据搬进账号，机器人上清掉，移除账号后不会又变回来
    expect(app.store.getBot(bot.id)!.feishuAppId).toBe("");
    expect(app.store.getChannelAccount(bot.id, "feishu")!.credentials).toEqual({ appId: "cli_old", appSecret: "old-secret" });
    // 微信关着的还是关着
    expect(app.store.getChannelAccount(bot.id, "weixin")!.enabled).toBe(false);
    expect(app.channels.get(bot.id)!.weixin).toBeUndefined();
    // 已经有账号叫 WORK：Telegram 的默认名字让开
    expect(app.store.getChannelAccount(bot.id, "telegram")!.label).toBe("WORK 2");
    expect((await api(`/channel-accounts/${bot.id}/channels`)).json.feishu.account).toEqual({ appId: "cli_old", saved: { appSecret: "****cret" } });
    await api(`/channel-accounts/${bot.id}/feishu`, { method: "DELETE" });
    await app.restartBot(bot.id);
    expect(app.store.getChannelAccount(bot.id, "feishu")).toBeUndefined();
    await api(`/channel-accounts/${bot.id}/telegram`, { method: "DELETE" });
    await api(`/channel-accounts/${bot.id}/weixin/logout`, { method: "POST", body: {} });
  });
});

describe("分发规则", () => {
  const store = () => {
    const s = new Store(":memory:");
    for (const [id, name] of [["a", "小蓝"], ["b", "小绿"], ["c", "小绿茶"]]) s.createBot({ id, name, systemPrompt: "", feishuAppId: "", feishuAppSecret: "", weixinEnabled: false });
    return s;
  };

  it("这个人选过的 → 账号的默认机器人 → key 同名的机器人 → 第一个机器人", () => {
    const s = store();
    expect(botForPeer(s, "nothing", "telegram", "p")).toBe("a");
    expect(botForPeer(s, "b", "telegram", "p")).toBe("b");
    s.saveChannelAccount({ key: "k", channel: "telegram", label: "x", defaultBot: "c", enabled: true, credentials: {}, createdAt: 1 });
    expect(defaultBotFor(s, "k", "telegram")).toBe("c");
    expect(botForPeer(s, "k", "telegram", "p")).toBe("c");
    setBotForPeer(s, "k", "telegram", "p", "b");
    expect(botForPeer(s, "k", "telegram", "p")).toBe("b");
    // 别人、别的账号不受影响
    expect(botForPeer(s, "k", "telegram", "q")).toBe("c");
    s.deleteBot("b");
    expect(botForPeer(s, "k", "telegram", "p")).toBe("c");
    s.deleteBot("c");
    expect(botForPeer(s, "k", "telegram", "p")).toBe("a");
  });

  it("按序号或名字找机器人；名字模糊时不猜", () => {
    const s = store();
    expect(findBot(s, "2")?.id).toBe("b");
    expect(findBot(s, "9")).toBeUndefined();
    expect(findBot(s, "小绿")?.id).toBe("b");
    expect(findBot(s, "绿茶")?.id).toBe("c");
    expect(findBot(s, "小")).toBeUndefined();
    expect(findBot(s, "没有")).toBeUndefined();
  });
});

describe("每个机器人都知道有哪些机器人", () => {
  const others = [{ name: "阿紫", persona: "写代码的助手。\n第二行不要" }, { name: "小橙", persona: "" }];

  it("系统提示词里有其他机器人的名单和切换方法；只有一个机器人时不写", () => {
    const text = botPrompt({ name: "小蓝", persona: "", memory: false, others });
    expect(text).toContain("阿紫：写代码的助手。");
    expect(text).not.toContain("第二行不要");
    expect(text).toContain("- 小橙");
    expect(text).toContain("/bot");
    expect(text).toContain("不用每句都带");
    expect(botTeam([])).toBe("");
    expect(botPrompt({ name: "小蓝", persona: "", memory: false })).not.toContain("其他机器人");
  });
});
