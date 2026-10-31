/**
 * 谁能和机器人对话：主人、允许名单、使用请求（配对码、限频）、升级迁移。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store/db.js";
import { AccessControl, NOTICE_LIMIT, refusalText, REFUSE_EVERY_MS } from "../src/core/access.js";
import { ApprovalCenter } from "../src/agent/approvals.js";
import type { InboundEvent } from "../src/core/types.js";

const ev = (channel: InboundEvent["channel"], peer: string, text: string, kind: "dm" | "group" = "dm"): InboundEvent => ({
  id: Math.random().toString(36).slice(2),
  channel,
  botId: "b",
  conversation: { kind, id: peer },
  sender: { id: channel === "feishu" ? `ou_${peer}` : peer },
  parts: [{ type: "text", text }],
  replyHandle: {},
  receivedAt: Date.now(),
});

function setup() {
  const store = new Store(":memory:");
  store.createBot({ id: "b", name: "小助手" });
  store.saveWeixinAccount({ botId: "b", botToken: "t", ilinkBotId: "bot@im.bot", baseUrl: "http://x", ownerUserId: "owner@im.wechat" });
  let now = 1_000_000;
  const sent: Array<{ channel: string; peerId: string; text: string; id: string }> = [];
  const access = new AccessControl(store, { now: () => now, notify: (to, text, id) => (sent.push({ channel: to.channel, peerId: to.peerId, text, id }), true) });
  return { store, access, sent, tick: (ms: number) => (now += ms) };
}

describe("AccessControl", () => {
  it("owner, web console and group chats pass; a stranger gets one reply per hour and the owner one notice with a code", () => {
    const { store, access, sent, tick } = setup();
    expect(access.admit(ev("weixin", "owner@im.wechat", "你好"))).toEqual({ ok: true });
    expect(access.admit(ev("web", "console", "hi"))).toEqual({ ok: true });
    expect(access.admit(ev("feishu", "oc_group", "hi", "group"))).toEqual({ ok: true });

    expect(access.admit(ev("weixin", "stranger@im.wechat", "我是张三，想用一下"))).toEqual({ ok: false, reply: refusalText() });
    const req = access.view("b").requests[0];
    expect(req).toMatchObject({ channel: "weixin", peerId: "stranger@im.wechat", status: "pending", text: "我是张三，想用一下", requests: 1 });
    expect(req.code).toMatch(/^\d{4}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "weixin", peerId: "owner@im.wechat", id: `access:${req.id}:weixin` });
    expect(sent[0].text).toContain(`同意 ${req.code}`);
    expect(sent[0].text).toContain("小助手");
    expect(sent[0].text).toContain("我是张三");

    // 一小时内再发：不回、不再通知主人
    expect(access.admit(ev("weixin", "stranger@im.wechat", "在吗"))).toEqual({ ok: false });
    expect(sent).toHaveLength(1);
    expect(store.getAccessById(req.id)!.requests).toBe(2);
    tick(REFUSE_EVERY_MS + 1);
    expect(access.admit(ev("weixin", "stranger@im.wechat", "在吗"))).toEqual({ ok: false, reply: refusalText() });
    expect(sent).toHaveLength(1);
  });

  it("notices to the owner are rate-limited per bot", () => {
    const { access, sent, tick } = setup();
    for (let i = 0; i < NOTICE_LIMIT + 2; i++) access.admit(ev("weixin", `s${i}@im.wechat`, "hi"));
    expect(sent).toHaveLength(NOTICE_LIMIT);
    expect(access.view("b").requests).toHaveLength(NOTICE_LIMIT + 2);
    tick(3600_000 + 1);
    access.admit(ev("weixin", "late@im.wechat", "hi"));
    expect(sent).toHaveLength(NOTICE_LIMIT + 1);
  });

  it("the owner approves with 同意 <code> from WeChat; strangers and wrong codes fall through", () => {
    const { access, sent } = setup();
    access.admit(ev("weixin", "s@im.wechat", "hi"));
    const { code, id } = access.view("b").requests[0];
    // 不是主人：不处理（交给后面的工具审批）
    expect(access.handleReply(ev("weixin", "other@im.wechat", `同意 ${code}`)).handled).toBe(false);
    expect(access.handleReply(ev("weixin", "owner@im.wechat", `同意 ${code === "0000" ? "0001" : "0000"}`)).handled).toBe(false);
    const r = access.handleReply(ev("weixin", "owner@im.wechat", `同意 ${code}`));
    expect(r).toEqual({ handled: true, ack: "✅ 已允许「微信用户 s」使用这个机器人" });
    expect(access.allowed(ev("weixin", "s@im.wechat", "x"))).toBe(true);
    expect(access.view("b").entries.find((e) => e.id === id)).toMatchObject({ status: "allowed", code: "", decidedBy: "weixin:owner@im.wechat" });
    // 告诉对方一声
    expect(sent.at(-1)).toMatchObject({ channel: "weixin", peerId: "s@im.wechat", text: expect.stringContaining("同意") });
    // 已处理：同一个码不再认
    expect(access.handleReply(ev("weixin", "owner@im.wechat", `同意 ${code}`)).handled).toBe(false);
  });

  it("denied senders get no reply; removing them lets them ask again", () => {
    const { access, tick } = setup();
    access.admit(ev("weixin", "spam@im.wechat", "hi"));
    const { id } = access.view("b").requests[0];
    expect(access.decide(id, false, "web")!.status).toBe("denied");
    tick(5 * 3600_000);
    expect(access.admit(ev("weixin", "spam@im.wechat", "hi"))).toEqual({ ok: false });
    expect(access.remove(id)).toBe(true);
    expect(access.admit(ev("weixin", "spam@im.wechat", "hi again"))).toEqual({ ok: false, reply: refusalText() });
    expect(access.view("b").requests[0].text).toBe("hi again");
  });

  it("Feishu: the first DM claims ownership and is handled normally; a second sender becomes a request the owner approves in Feishu", () => {
    const { access, sent } = setup();
    expect(access.owner("b", "feishu")).toBeUndefined();
    // 第一个发单聊消息的人：直接放行（这条消息照常处理），成为飞书主人，不通知谁
    expect(access.admit(ev("feishu", "oc_me", "我是主人"))).toEqual({ ok: true });
    expect(access.owner("b", "feishu")).toEqual({ peerId: "oc_me", via: "first-message", entryId: expect.any(String) });
    expect(access.view("b").requests).toEqual([]);
    expect(access.view("b").entries).toEqual([expect.objectContaining({ peerId: "oc_me", status: "owner", source: "first-message", senderId: "ou_oc_me", text: "我是主人" })]);
    expect(sent).toEqual([]);
    expect(access.admit(ev("feishu", "oc_me", "再来一句"))).toEqual({ ok: true });

    // 第二个、不同的人：使用请求，飞书主人和微信主人都收到配对码
    expect(access.admit(ev("feishu", "oc_colleague", "借用一下"))).toEqual({ ok: false, reply: refusalText() });
    const req = access.view("b").requests[0];
    expect(req).toMatchObject({ peerId: "oc_colleague", status: "pending" });
    expect(sent.filter((s) => s.id.startsWith(`access:${req.id}`)).map((s) => [s.channel, s.peerId]).sort()).toEqual([["feishu", "oc_me"], ["weixin", "owner@im.wechat"]]);
    // 主人在飞书里回复「允许 1234」
    expect(access.handleReply(ev("feishu", "oc_colleague", `允许 ${req.code}`)).handled).toBe(false);
    expect(access.handleReply(ev("feishu", "oc_me", `允许 ${req.code}`)).handled).toBe(true);
    expect(access.allowed(ev("feishu", "oc_colleague", "x"))).toBe(true);
    expect(access.owner("b", "feishu")!.peerId).toBe("oc_me");
  });

  it("更换: resetting the owner removes them; the next DM claims it again; denied senders never claim", () => {
    const { access } = setup();
    // 同事抢先发了一句，成了飞书主人；有人发广告，被拒绝
    expect(access.admit(ev("feishu", "oc_wrong", "我先发"))).toEqual({ ok: true });
    access.admit(ev("feishu", "oc_spam", "广告"));
    access.decide(access.view("b").requests[0].id, false, "web");

    expect(access.resetOwner("b", "feishu")).toBe(true);
    expect(access.owner("b", "feishu")).toBeUndefined();
    expect(access.allowed(ev("feishu", "oc_wrong", "x"))).toBe(false);
    // 拒绝过的人不能认领
    expect(access.admit(ev("feishu", "oc_spam", "我又来了"))).toEqual({ ok: false });
    expect(access.owner("b", "feishu")).toBeUndefined();
    // 下一个发消息的人成为主人；原来的主人要重新申请
    expect(access.admit(ev("feishu", "oc_me", "绑定"))).toEqual({ ok: true });
    expect(access.owner("b", "feishu")!.peerId).toBe("oc_me");
    expect(access.admit(ev("feishu", "oc_wrong", "我还能用吗"))).toEqual({ ok: false, reply: refusalText() });
    // 允许名单里的人在没有主人时也会认领（升级前就在用的人多半就是你自己）
    access.resetOwner("b", "feishu");
    access.allow("b", "feishu", "oc_old", "migration");
    expect(access.admit(ev("feishu", "oc_old", "hi"))).toEqual({ ok: true });
    expect(access.owner("b", "feishu")!.peerId).toBe("oc_old");
    expect(access.resetOwner("b", "weixin")).toBe(false);
  });

  it("WeChat login without the scanner's id: the first DM claims ownership; a later login with an id keeps them on the allowlist", () => {
    const { store, access } = setup();
    store.saveWeixinAccount({ botId: "b", botToken: "t", ilinkBotId: "bot@im.bot", baseUrl: "http://x", ownerUserId: "" });
    expect(access.owner("b", "weixin")).toBeUndefined();
    expect(access.admit(ev("weixin", "me@im.wechat", "你好"))).toEqual({ ok: true });
    expect(access.owner("b", "weixin")).toMatchObject({ peerId: "me@im.wechat", via: "first-message" });
    expect(access.admit(ev("weixin", "other@im.wechat", "hi"))).toEqual({ ok: false, reply: refusalText() });
    // 重新扫码拿到了扫码者（App 里登录成功时这样调用）
    access.resetOwner("b", "weixin", { keep: true });
    store.saveWeixinAccount({ botId: "b", botToken: "t", ilinkBotId: "bot@im.bot", baseUrl: "http://x", ownerUserId: "owner@im.wechat" });
    expect(access.owner("b", "weixin")).toEqual({ peerId: "owner@im.wechat", via: "login" });
    expect(store.getAccess("b", "weixin", "me@im.wechat")).toMatchObject({ status: "allowed", source: "previous-owner" });
  });

  it("pairing codes and tool approval codes never collide", () => {
    const { store, access } = setup();
    const approvals = new ApprovalCenter(store);
    for (let i = 0; i < 40; i++) {
      access.admit(ev("weixin", `p${i}@im.wechat`, "hi"));
      approvals.create({ kind: "approval", botId: "b", conversationId: "b:weixin:owner@im.wechat", sessionId: "s", tool: "bash", detail: "", reason: "" });
    }
    const codes = [...store.pendingAccessCodes(), ...store.listApprovals({ status: "pending", limit: 500 }).map((r) => r.code)];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("/status line names the policy, owners and pending requests", () => {
    const { access } = setup();
    access.allow("b", "weixin", "friend@im.wechat", "app");
    access.admit(ev("weixin", "s@im.wechat", "hi"));
    expect(access.policyLine("b")).toBe("谁能使用：只有主人和允许名单里的人（微信主人 owner，飞书主人未设置；已允许 1 人）；1 个使用请求待处理（回复「同意 编号」或在应用的信息面板里处理）");
  });
});

describe("upgrade: people who already talk to a bot are allowed once", () => {
  it("grandfathers existing DM peers (not the WeChat owner, not groups), only on the first open", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amb-access-")), "anymodel.db");
    // 旧版本的库：只有会话和微信账号，没有 access 表
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, channel TEXT NOT NULL, peer_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'dm');
      CREATE TABLE weixin_accounts (bot_id TEXT PRIMARY KEY, bot_token TEXT NOT NULL, ilink_bot_id TEXT NOT NULL, base_url TEXT NOT NULL,
      owner_user_id TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '', paused_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);`);
    const conv = old.prepare("INSERT INTO conversations(id, bot_id, channel, peer_id, title, created_at, updated_at, kind) VALUES(?, 'b', ?, ?, ?, 1, 1, ?)");
    conv.run("b:weixin:alice", "weixin", "alice@im.wechat", "alice", "dm");
    conv.run("b:weixin:owner", "weixin", "owner@im.wechat", "owner", "dm");
    conv.run("b:feishu:oc_1", "feishu", "oc_1", "ou_1", "dm");
    conv.run("b:feishu:oc_g", "feishu", "oc_g", "群", "group");
    conv.run("b:web:console", "web", "console", "控制台", "dm");
    old.prepare("INSERT INTO weixin_accounts(bot_id, bot_token, ilink_bot_id, base_url, owner_user_id, updated_at) VALUES('b', 't', 'i', 'u', 'owner@im.wechat', 1)").run();
    old.close();

    let store = new Store(file);
    const got = store.listAccess({ botId: "b" }).map((e) => [e.channel, e.peerId, e.status, e.source]).sort();
    expect(got).toEqual([
      ["feishu", "oc_1", "allowed", "migration"],
      ["weixin", "alice@im.wechat", "allowed", "migration"],
    ]);
    // 移除后不会在下次启动时又被加回来
    store.deleteAccess(store.getAccess("b", "weixin", "alice@im.wechat")!.id);
    store.close();
    store = new Store(file);
    expect(store.getAccess("b", "weixin", "alice@im.wechat")).toBeUndefined();
    store.close();
  });
});
