/**
 * 飞书离线时漏掉的消息：长连接不补推离线时发来的事件（SDK 重连时不带任何位置，开放平台只对推了没回 200 的重推），
 * 所以启动、断线重连时从会话历史里补。真实 App（纯对话 + mock 模型）+ 假飞书传输层：
 * 只补见到的最后一条之后、24 小时内的，每个会话最多 20 条，7 天内有过来往的会话才看；补上的和收到的走同一条路
 * （去重、准入、群里的规则照旧）；没有读历史消息的权限时记一次、提示一次，渠道照常。另外：真实传输层怎么读历史、怎么认没权限。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { HistoryDenied, LarkTransport, historyDenied, historyEvent } from "../src/channels/feishu/transport.js";
import { CATCH_UP_MAX } from "../src/channels/feishu/channel.js";
import { FakeFeishu, feishuEvent, mockOpenAI, until } from "./helpers.js";

const H = 3600_000;

describe("飞书离线补消息（假传输层）", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let app: App;
  let dataDir: string;
  const feishu = new FakeFeishu();
  const ch = () => app.channels.get("default")!.feishu!;
  /** 模型收到的每次请求里最后一条用户消息 */
  const asked = (from = 0) => llm.calls.slice(from).map((c) => String(c.messages.at(-1)?.content ?? ""));
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 50));
    await ch().idle();
  };
  /** 一条历史里的用户消息 */
  const msg = (chatId: string, id: string, text: string, at: number, extra: Record<string, unknown> = {}) => ({ ...feishuEvent(text, { chatId, messageId: id, createTime: at }), ...extra });

  beforeAll(async () => {
    llm = await mockOpenAI({ key: "gw-key" });
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-feishu-catchup-"));
    process.env.FEISHU_APP_ID = "cli_test";
    process.env.FEISHU_APP_SECRET = "secret_test";
    app = new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_FEISHU_THROTTLE_MS: "30", AMB_AGENT: "off" } }), {
      feishuTransport: () => feishu,
      printQrToTerminal: false,
    });
    await app.start();
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });

  afterAll(async () => {
    await app?.stop();
    await llm?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("离线时发来的：重连后从历史里补上、照常回复；只补见到的最后一条之后的，最多 20 条，按先后；再连一次、平台又推一次都不重复", async () => {
    const now = Date.now();
    // 主人在线时说过一句（连上后第一个发单聊的人就是主人）
    const first = msg("oc_chat1", "om_first", "你好", now - 3 * H);
    feishu.onMessage!(first);
    await settle();
    const before = llm.calls.length;
    expect(asked(before - 1)).toEqual(["你好"]);
    // 离线时：主人又发了 25 条；历史里还有机器人自己的一条和之前那条
    const missed = Array.from({ length: 25 }, (_, i) => msg("oc_chat1", `om_off${i + 1}`, `离线 ${i + 1}`, now - 2 * H + i * 10_000));
    feishu.history.set("oc_chat1", [first, ...missed, msg("oc_chat1", "om_bot", "机器人的回复", now - H, { senderType: "app" })]);
    feishu.reconnect();
    await until(() => llm.calls.length - before >= CATCH_UP_MAX, 15_000);
    await settle();
    // 最新的 20 条，按先后；每条都回复在它自己下面
    expect(asked(before)).toEqual(missed.slice(-CATCH_UP_MAX).map((m) => m.content && JSON.parse(m.content).text));
    const repliedTo = new Set(feishu.calls.filter((c) => c.op === "reply").map((c) => c.args[0]));
    for (const m of missed.slice(-CATCH_UP_MAX)) expect(repliedTo.has(m.messageId)).toBe(true);
    expect(feishu.listed.at(-1)).toMatchObject({ chatId: "oc_chat1", since: first.createTime, limit: CATCH_UP_MAX, chatType: "p2p" });
    // 再连一次：从见到的最后一条之后取，什么都不补；平台把其中一条又推了一次：去重
    const after = llm.calls.length;
    feishu.reconnect();
    await settle();
    expect(feishu.listed.at(-1)!.since).toBe(missed.at(-1)!.createTime);
    feishu.onMessage!(missed.at(-1)!);
    await settle();
    expect(llm.calls.length).toBe(after);
  });

  it("7 天内有过来往的会话才看；24 小时之前的不补；群聊和没被允许的人照常的规则：群消息不处理，陌生人只收到一句提示", async () => {
    const now = Date.now();
    const store = app.store;
    const db = (store as any).db;
    // 一个 8 天没来往的会话：不看
    store.ensureConversation("default", "feishu", "oc_old", "老会话");
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now - 8 * 24 * H, "default:feishu:oc_old");
    feishu.history.set("oc_old", [msg("oc_old", "om_old1", "很久以前", now - H)]);
    // 允许的人，最后见到的是 3 天前：只补 24 小时内的
    app.access.allow("default", "feishu", "oc_day", "test");
    store.ensureConversation("default", "feishu", "oc_day", "同事");
    store.setKV("feishu-seen:default:oc_day", JSON.stringify({ at: now - 72 * H, id: "om_day0" }));
    feishu.history.set("oc_day", [msg("oc_day", "om_day1", "两天前的", now - 30 * H), msg("oc_day", "om_day2", "两小时前的", now - 2 * H)]);
    // 群聊（目前只处理单聊）：@ 了机器人的也不处理
    store.ensureConversation("default", "feishu", "oc_group", "群", "group");
    store.setKV("feishu-seen:default:oc_group", JSON.stringify({ at: now - 3 * H, id: "om_g0" }));
    feishu.history.set("oc_group", [msg("oc_group", "om_g1", "@小蓝 帮个忙", now - H, { mentions: [{ key: "@_user_1", name: "小蓝", openId: "ou_bot" }] })]);
    // 不在允许名单里的人：照常只回一句，不进模型
    store.ensureConversation("default", "feishu", "oc_stranger", "陌生人");
    store.setKV("feishu-seen:default:oc_stranger", JSON.stringify({ at: now - 3 * H, id: "om_s0" }));
    feishu.history.set("oc_stranger", [msg("oc_stranger", "om_s1", "在吗", now - H, { senderOpenId: "ou_stranger" })]);
    // 还没记过见到哪一条（升级前就有的会话）：从最后一次来往之后取，之前的不重放
    store.ensureConversation("default", "feishu", "oc_new", "新会话");
    app.access.allow("default", "feishu", "oc_new", "test");
    feishu.history.set("oc_new", [msg("oc_new", "om_n1", "早就回过的", now - H)]);
    const before = llm.calls.length;
    const listedBefore = feishu.listed.length;
    feishu.reconnect();
    await until(() => llm.calls.length > before, 10_000);
    await settle();
    const listed = feishu.listed.slice(listedBefore);
    expect(listed.map((l) => l.chatId).sort()).toEqual(["oc_chat1", "oc_day", "oc_group", "oc_new", "oc_stranger"]);
    expect(listed.find((l) => l.chatId === "oc_group")!.chatType).toBe("group");
    expect(now - 24 * H - listed.find((l) => l.chatId === "oc_day")!.since).toBeLessThanOrEqual(1000);
    expect(asked(before)).toEqual(["两小时前的"]);
    expect(feishu.texts.at(-1)).toMatch(/还没有被允许使用这个机器人/);
    expect(feishu.calls.filter((c) => c.op === "text" && c.args[0] === "om_s1")).toHaveLength(1);
  });

  it("没有读历史消息的权限：记一次、提示一次，渠道照常收发；有了权限之后再没有，会再提示", async () => {
    const notices = () => app.recentNotices.filter((n) => n.text.includes("读不到飞书的历史消息"));
    feishu.denyHistory = true;
    feishu.reconnect();
    await settle();
    feishu.reconnect();
    await settle();
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({ level: "warn" });
    expect(notices()[0].text).toContain("im:message.history:readonly");
    expect(ch().status.state).toBe("connected");
    // 渠道照常
    const before = llm.calls.length;
    feishu.onMessage!(msg("oc_chat1", "om_live", "还在吗", Date.now()));
    await settle();
    expect(asked(before)).toEqual(["还在吗"]);
    // 开了权限：不再提示；之后又没了：再提示一次
    feishu.denyHistory = false;
    feishu.reconnect();
    await settle();
    feishu.denyHistory = true;
    feishu.reconnect();
    await settle();
    expect(notices()).toHaveLength(2);
    feishu.denyHistory = false;
  });
});

describe("飞书传输层：读会话历史", () => {
  const item = (id: string, at: number, extra: Record<string, unknown> = {}) => ({
    message_id: id,
    chat_id: "oc_1",
    msg_type: "text",
    create_time: String(at),
    sender: { id: "ou_1", id_type: "open_id", sender_type: "user" },
    body: { content: JSON.stringify({ text: id }) },
    mentions: [{ key: "@_user_1", id: "ou_bot", id_type: "open_id", name: "小蓝" }],
    ...extra,
  });
  const lark = (list: (payload: any) => Promise<any>) => {
    const t = new LarkTransport("cli_x", "secret_x");
    (t as any).client = { im: { v1: { message: { list } } } };
    return t;
  };

  it("按秒问、最新的在前；只要用户发的、没撤回的、晚于上次见到的，旧的在前交回；事件的样子和收到的一样", async () => {
    let params: any;
    const t = lark(async (p) => {
      params = p.params;
      return { code: 0, data: { items: [item("om_4", 4500), item("om_bot", 4000, { sender: { id: "cli_x", id_type: "app_id", sender_type: "app" } }), item("om_del", 3500, { deleted: true }), item("om_2", 2500), item("om_1", 2000)] } };
    });
    const out = await t.listMessages("oc_1", { since: 2000, limit: 20, chatType: "p2p" });
    expect(params).toEqual({ container_id_type: "chat", container_id: "oc_1", start_time: "2", sort_type: "ByCreateTimeDesc", page_size: 20 });
    expect(out.map((e) => e.messageId)).toEqual(["om_2", "om_4"]);
    expect(out[0]).toEqual({ messageId: "om_2", chatId: "oc_1", chatType: "p2p", messageType: "text", content: '{"text":"om_2"}', senderOpenId: "ou_1", mentions: [{ key: "@_user_1", name: "小蓝", openId: "ou_bot" }], createTime: 2500 });
    expect(historyEvent({ message_id: "x", sender: { id: "u", id_type: "user_id" } }, "group")).toMatchObject({ senderOpenId: "", chatType: "group", content: "{}", mentions: [] });
  });

  it("没权限（HTTP 403、缺权限范围、缺必要权限、机器人不在群里）抛 HistoryDenied；别的错误照常抛", async () => {
    const http = (status: number, code: number, msg: string) => lark(async () => Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { code, msg } } })));
    await expect(http(400, 99991672, "Access denied. One of the following scopes is required: [im:message.history:readonly]").listMessages("oc_1", { since: 0, limit: 20, chatType: "p2p" })).rejects.toBeInstanceOf(HistoryDenied);
    await expect(http(403, 0, "forbidden").listMessages("oc_1", { since: 0, limit: 20, chatType: "p2p" })).rejects.toBeInstanceOf(HistoryDenied);
    await expect(lark(async () => ({ code: 230027, msg: "Lack of necessary permissions." })).listMessages("oc_1", { since: 0, limit: 20, chatType: "p2p" })).rejects.toBeInstanceOf(HistoryDenied);
    const other = lark(async () => ({ code: 230001, msg: "invalid param" })).listMessages("oc_1", { since: 0, limit: 20, chatType: "p2p" });
    await expect(other).rejects.toThrow(/im.message.list failed: code=230001/);
    await expect(other).rejects.not.toBeInstanceOf(HistoryDenied);
    expect([historyDenied(undefined, 230002), historyDenied(undefined, 230013), historyDenied(500, 1, "internal error"), historyDenied(undefined, undefined, "缺少权限")]).toEqual([true, true, false, true]);
  });
});
