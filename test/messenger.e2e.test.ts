/**
 * Telegram、Slack、Discord 端到端：真实 App/Web（外部模型端点模式）+ 假传输层。
 * 连接和断开、第一个发消息的人成为主人、陌生人被拦、群里的不处理、文件下载、主动通知。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { refusalText } from "../src/core/access.js";
import type { MessengerId } from "../src/core/types.js";
import { FakeMessenger, messengerEvent, mockOpenAI, until } from "./helpers.js";

let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let app: App;
let base: string;
const fakes = new Map<MessengerId, FakeMessenger>();
/** 下一个新建的传输层检查凭据时被拒 */
let rejectNext = "";
const created: Array<{ id: MessengerId; credentials: Record<string, string> }> = [];

async function api(p: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(base + "/amb/api" + p, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const channel = (id: MessengerId) => app.channels.get("default")!.messengers![id]!;
const say = async (id: MessengerId, text: string, o: Parameters<typeof messengerEvent>[1] = {}) => {
  fakes.get(id)!.onMessage!(messengerEvent(text, o));
  await channel(id).idle();
};

beforeAll(async () => {
  llm = await mockOpenAI({ key: "gw-key" });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-messenger-e2e-"));
  const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_AGENT: "off" } });
  app = new App(config, {
    printQrToTerminal: false,
    messengerTransport: (id, _bot, credentials) => {
      created.push({ id, credentials });
      const f = new FakeMessenger(id);
      if (rejectNext) {
        f.rejectVerify = rejectNext;
        rejectNext = "";
      }
      // 检查凭据和真正连上用的是两个对象：测试看最后建的那个
      fakes.set(id, f);
      return f;
    },
  });
  await app.start();
  base = app.web!.url.replace(/\/$/, "");
});

afterAll(async () => {
  await app?.stop();
  await llm?.close();
});

describe("连接", () => {
  it("凭据被拒：报错、不保存", async () => {
    rejectNext = "telegram getMe: 401 Unauthorized";
    const r = await api("/channel-accounts/default/telegram", { method: "PUT", body: { token: "bad" } });
    expect(r.status).toBe(400);
    expect(r.json.error ?? r.json.message).toContain("401");
    expect(app.store.getMessengerAccount("default", "telegram")).toBeUndefined();
  });

  it("没填全：报错", async () => {
    const r = await api("/channel-accounts/default/slack", { method: "PUT", body: { botToken: "xoxb-1" } });
    expect(r.status).toBe(400);
  });

  it("连上：状态在线、显示平台上的名字；状态里没有完整的 token", async () => {
    const r = await api("/channel-accounts/default/telegram", { method: "PUT", body: { token: "123456:SECRETSECRETSECRET" } });
    expect(r.status).toBe(200);
    await until(async () => (await api("/channel-accounts/default/channels")).json.telegram.state === "connected");
    const st = (await api("/channel-accounts/default/channels")).json;
    expect(st.telegram.account.name).toBe("@fake_bot");
    expect(JSON.stringify(st)).not.toContain("SECRETSECRETSECRET");
    expect(st.discord.state).toBe("disabled");
    expect(st.feishu).toBeDefined();
    expect(JSON.stringify((await api("/bots/default")).json)).not.toContain("SECRETSECRETSECRET");
  });

  it("不是平台的路径不受理；Slack 留空的 token 沿用已保存的", async () => {
    await api("/channel-accounts/default/slack", { method: "PUT", body: { botToken: "xoxb-1", appToken: "xapp-1" } });
    created.length = 0;
    expect((await api("/channel-accounts/default/slack", { method: "PUT", body: { appToken: "xapp-2" } })).status).toBe(200);
    expect(created.at(-1)).toMatchObject({ id: "slack", credentials: { botToken: "xoxb-1", appToken: "xapp-2" } });
    await api("/channel-accounts/default/slack", { method: "DELETE" });
  });

  it("重启后接着连（凭据在库里）；stopBot 会停掉", async () => {
    const before = fakes.get("telegram")!;
    await app.restartBot("default");
    expect(before.stopped).toBe(1);
    expect(fakes.get("telegram")).not.toBe(before);
    expect(fakes.get("telegram")!.started).toBe(1);
  });
});

describe("对话", () => {
  it("第一个发消息的人成为主人，流式显示并写成最终回复", async () => {
    expect((await api("/channel-accounts/default/access")).json.owners.telegram).toBeNull();
    await say("telegram", "我是老板", { chatId: "boss", senderId: "boss", senderName: "Boss" });
    expect(fakes.get("telegram")!.lastShown("boss")).toBe("[mock-a] 你说：我是老板");
    expect((await api("/channel-accounts/default/access")).json.owners.telegram).toEqual({ via: "first-message", peer: "boss", name: "Boss" });
    const conv = app.store.getConversation("default:telegram:boss");
    expect(conv?.channel).toBe("telegram");
  });

  it("陌生人：只回一句、不碰模型；主人收到配对码，回复后对方能用", async () => {
    const f = fakes.get("telegram")!;
    const asked = llm.calls.length;
    await say("telegram", "让我用用", { chatId: "guest", senderId: "guest", senderName: "Guest" });
    expect(f.lastShown("guest")).toBe(refusalText());
    expect(llm.calls.length).toBe(asked);
    const notice = f.sent.filter((s) => s.chatId === "boss").at(-1)!.text;
    const code = /\d{4}/.exec(notice)![0];
    await say("telegram", `同意 ${code}`, { chatId: "boss", senderId: "boss" });
    await until(() => f.sent.some((s) => s.chatId === "guest" && s.text !== refusalText()));
    await say("telegram", "现在呢", { chatId: "guest", senderId: "guest" });
    expect(f.lastShown("guest")).toBe("[mock-a] 你说：现在呢");
  });

  it("群里的消息不处理（不回复、不碰模型）；重复投递只处理一次", async () => {
    const f = fakes.get("telegram")!;
    const asked = llm.calls.length;
    const sent = f.sent.length;
    await say("telegram", "群里说话", { chatId: "group", senderId: "boss", dm: false });
    expect(f.sent.length).toBe(sent);
    expect(llm.calls.length).toBe(asked);
    await say("telegram", "一次", { id: "dup", chatId: "boss", senderId: "boss" });
    const n = llm.calls.length;
    await say("telegram", "一次", { id: "dup", chatId: "boss", senderId: "boss" });
    expect(llm.calls.length).toBe(n);
  });

  it("收到的文件下载好交给运行时；下载失败时消息照常处理并说明原因", async () => {
    let downloaded = 0;
    const ok = { type: "file" as const, name: "报告.txt", download: async () => (downloaded++, Buffer.from("内容")) };
    const bad = { type: "file" as const, name: "坏.txt", download: async () => { throw new Error("HTTP 500"); } };
    await say("telegram", "看看", { chatId: "boss", senderId: "boss", files: [ok, bad] });
    const last = String(llm.calls.at(-1)!.messages.at(-1)?.content);
    expect(downloaded).toBe(1);
    expect(last).toContain("[文件 报告.txt]");
    expect(last).toContain("HTTP 500");
  });

  it("主动通知经出站队列发到主人；更换主人后下一个发消息的人成为主人", async () => {
    const f = fakes.get("telegram")!;
    expect(await app.pushToOwner("余额不足")).toBe(true);
    await channel("telegram").idle();
    expect(f.lastShown("boss")).toContain("余额不足");
    expect((await api("/channel-accounts/default/access/owner/telegram", { method: "DELETE" })).status).toBe(200);
    await say("telegram", "换我", { chatId: "new", senderId: "new", senderName: "New" });
    expect((await api("/channel-accounts/default/access")).json.owners.telegram).toMatchObject({ peer: "new" });
  });

  it("断开：渠道停下、凭据清掉、主人清掉", async () => {
    const f = fakes.get("telegram")!;
    expect((await api("/channel-accounts/default/telegram", { method: "DELETE" })).status).toBe(200);
    expect(f.stopped).toBe(1);
    expect(app.store.getMessengerAccount("default", "telegram")).toBeUndefined();
    const st = (await api("/channel-accounts/default/channels")).json;
    expect(st.telegram.state).toBe("disabled");
    expect(st.telegram.account).toBeUndefined();
    expect((await api("/channel-accounts/default/access")).json.owners.telegram).toBeNull();
  });
});

describe("连不上（凭据失效）", () => {
  it("信息面板显示原因", async () => {
    await api("/channel-accounts/default/discord", { method: "PUT", body: { token: "t" } });
    const f = fakes.get("discord")!;
    await until(() => !!f.onState);
    f.onState!("error", "the bot token was rejected", true);
    const st = (await api("/channel-accounts/default/channels")).json.discord;
    expect(st).toMatchObject({ state: "error", detail: "the bot token was rejected" });
  });
});

