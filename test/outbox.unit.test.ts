/**
 * 出站队列：先落库再发、同一 id 只发一次、按会话排队、退避重试、Later 不计失败、Gone 记下原因、过期、重启后接着发；
 * Held 留着，对方下次发消息时按顺序先发（合成「你不在时：…」），只发一次。
 * 以及微信 / 飞书的发送函数（配额、24 小时窗口、分段续发、卡片降级）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, type OutboxRow } from "../src/store/db.js";
import { Gone, HOLD_TTL_MS, Held, Later, OUTBOX_TTL_MS, Outbox, REJECTIONS_BEFORE_GONE, stableId } from "../src/core/outbox.js";
import { AWAY_PREFIX, combineHeld, deliverWeixin } from "../src/channels/weixin/channel.js";
import { WeixinQuota } from "../src/channels/weixin/quota.js";
import { deliverFeishu } from "../src/channels/feishu/card.js";
import { FakeFeishu, until } from "./helpers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "amb-outbox-"));
const input = (id: string, text: string, peerId = "u1") => ({ id, botId: "b", channel: "weixin" as const, peerId, kind: "text" as const, body: { text } });

describe("Outbox", () => {
  it("writes before sending, sends once per id, keeps per-conversation order", async () => {
    const store = new Store(":memory:");
    const ob = new Outbox(store);
    const sent: string[] = [];
    let release: (() => void) | undefined;
    ob.register("b", "weixin", async (row) => {
      if (row.body.text === "slow") await new Promise<void>((r) => (release = r));
      sent.push(`${row.peerId}:${row.body.text}`);
    });
    ob.start();
    const first = ob.send(input("a", "slow"));
    await until(() => !!release);
    expect(store.getOutbox("a")!.status).toBe("pending");
    // 同一会话：排在 slow 后面；别的会话不受影响
    await ob.send(input("b", "second"));
    await ob.send(input("c", "other", "u2"));
    expect(sent).toEqual(["u2:other"]);
    release!();
    await first;
    await ob.idle();
    expect(sent).toEqual(["u2:other", "u1:slow", "u1:second"]);
    // 同一 id 再写一遍：不再发
    await ob.send(input("a", "slow"));
    await ob.idle();
    expect(sent).toHaveLength(3);
    expect(store.getOutbox("a")).toMatchObject({ status: "sent", attempts: 0 });
  });

  it("transient failures back off and retry; a failing head holds back the rest of its conversation", async () => {
    const store = new Store(":memory:");
    const ob = new Outbox(store, { retry: [30, 200] });
    let fails = 2;
    const sent: string[] = [];
    ob.register("b", "weixin", async (row) => {
      if (row.body.text === "x" && fails-- > 0) throw new Error("ECONNRESET");
      sent.push(row.body.text!);
    });
    ob.start();
    const r = await ob.send(input("x", "x"));
    expect(r).toMatchObject({ status: "pending", attempts: 1, error: "ECONNRESET" });
    await ob.send(input("y", "y"));
    expect(sent).toEqual([]);
    await until(() => sent.length === 2, 3000);
    expect(sent).toEqual(["x", "y"]);
    expect(store.getOutbox("x")).toMatchObject({ status: "sent", attempts: 2, error: "" });
  });

  it("Later waits without counting; Gone and repeated rejections are kept with the reason", async () => {
    const store = new Store(":memory:");
    const ob = new Outbox(store, { retry: [20, 40] });
    let later = 3;
    ob.register("b", "weixin", async (row) => {
      if (row.body.text === "later" && later-- > 0) throw new Later("渠道没上线");
      if (row.body.text === "gone") throw new Gone("本轮可发送条数已用完");
      if (row.body.text === "rejected") throw Object.assign(new Error("sendmessage ret=-2"), { rejected: true });
    });
    ob.start();
    await ob.send(input("l", "later"));
    await ob.send(input("g", "gone", "u2"));
    await ob.send(input("r", "rejected", "u3"));
    await until(() => store.getOutbox("l")!.status === "sent" && store.getOutbox("r")!.status === "gone", 5000);
    expect(store.getOutbox("l")!.attempts).toBe(0);
    expect(store.getOutbox("g")).toMatchObject({ status: "gone", error: "本轮可发送条数已用完" });
    expect(store.getOutbox("r")).toMatchObject({ status: "gone", attempts: REJECTIONS_BEFORE_GONE - 1 });
    expect(store.getOutbox("r")!.error).toContain("ret=-2");
    expect(store.listOutbox({ botId: "b", status: "gone" }).map((r) => r.id).sort()).toEqual(["g", "r"]);
  });

  it("Held waits for the user's next message; then the held messages go out once, in order, merged into 「你不在时：…」, before the reply", async () => {
    const store = new Store(":memory:");
    const ob = new Outbox(store, { retry: [20, 40] });
    let open = false;
    const sent: string[] = [];
    ob.register("b", "weixin", async (row) => {
      if (!open) throw new Held("对方超过 24 小时没有发消息，等他下次发消息时再发");
      sent.push(row.kind === "file" ? `[file ${row.body.name}]` : row.body.text!);
    });
    ob.start();
    await ob.send(input("h1", "**结果**：A 云最便宜![图](https://x/a.png)"));
    await ob.send({ ...input("h2", "需批准：`rm -rf build/`", "u1"), body: { text: "需批准：`rm -rf build/`", raw: true } });
    await ob.send({ ...input("h3", "", "u1"), kind: "file", body: { path: "/tmp/r.md", name: "报告.md" } });
    await ob.send(input("h4", "第四条"));
    await ob.send(input("other", "别人的", "u2"));
    await ob.idle();
    expect(sent).toEqual([]);
    expect(store.listOutbox({ status: "held" }).map((r) => r.id).sort()).toEqual(["h1", "h2", "h3", "h4", "other"]);
    expect(store.getOutbox("h1")).toMatchObject({ attempts: 0, error: expect.stringMatching(/超过 24 小时/) });
    // 普通消息留得比 24 小时久，不会在对方回来前过期
    expect(store.getOutbox("h1")!.expiresAt - store.getOutbox("h1")!.createdAt).toBe(HOLD_TTL_MS);

    // u1 又发消息了：先发留着的（文字合成一条，文件照原样，顺序不变），再发这次的回复；u2 的继续留着
    open = true;
    expect(ob.release("b", "weixin", "u1", combineHeld)).toBe(4);
    await ob.send(input("reply", "这次的回复"));
    await ob.idle();
    // 普通回复先按微信的规则过滤 Markdown（图片去掉），审批提示原样
    expect(sent).toEqual([`${AWAY_PREFIX}\n**结果**：A 云最便宜\n\n需批准：\`rm -rf build/\``, "[file 报告.md]", `${AWAY_PREFIX}第四条`, "这次的回复"]);
    expect(["h1", "h2", "h3", "h4"].map((id) => store.getOutbox(id)!.status)).toEqual(["sent", "merged", "sent", "sent"]);
    expect(store.getOutbox("other")!.status).toBe("held");
    // 只发一次：再放一次、同一 id 再写一遍都不会重发
    expect(ob.release("b", "weixin", "u1", combineHeld)).toBe(0);
    await ob.send(input("h2", "需批准：`rm -rf build/`"));
    await ob.idle();
    expect(sent).toHaveLength(4);
  });

  it("held messages past their deadline are not sent when the user comes back; a merged message held again keeps one prefix", async () => {
    let now = 1_000_000;
    const store = new Store(":memory:");
    const ob = new Outbox(store, { now: () => now });
    let open = false;
    const sent: string[] = [];
    ob.register("b", "weixin", async (row) => {
      if (!open) throw new Held("本轮可发送条数已用完");
      sent.push(row.body.text!);
    });
    ob.start();
    // ack、审批提示这类短命的：留着也按自己的期限
    await ob.send({ ...input("ack", "收到"), ttlMs: 10 * 60_000 });
    await ob.send(input("final", "结果"));
    await ob.idle();
    expect(store.getOutbox("ack")!.expiresAt).toBe(1_000_000 + 10 * 60_000);
    expect(store.getOutbox("final")!.expiresAt).toBe(1_000_000 + HOLD_TTL_MS);
    expect(HOLD_TTL_MS).toBeGreaterThan(OUTBOX_TTL_MS);
    now += 3600_000;
    // 放回去时又发不出去：合成的那条再留着，下次不会叠两个前缀
    expect(ob.release("b", "weixin", "u1", combineHeld)).toBe(1);
    await ob.idle();
    expect(store.getOutbox("ack")).toMatchObject({ status: "gone", error: expect.stringMatching(/等待太久/) });
    expect(store.getOutbox("final")).toMatchObject({ status: "held", body: { text: `${AWAY_PREFIX}结果`, away: true } });
    open = true;
    ob.release("b", "weixin", "u1", combineHeld);
    await ob.idle();
    expect(sent).toEqual([`${AWAY_PREFIX}结果`]);
  });

  it("waits for the channel to register; expired messages are marked gone and the next one goes", async () => {
    let now = 1_000_000;
    const store = new Store(":memory:");
    const ob = new Outbox(store, { now: () => now });
    ob.start();
    await ob.send({ ...input("old", "过期的", "u1"), ttlMs: 1000 });
    await ob.send(input("new", "新的", "u1"));
    expect(store.getOutbox("old")!.status).toBe("pending");
    now += 2000;
    const sent: string[] = [];
    ob.register("b", "weixin", async (row) => void sent.push(row.body.text!));
    await ob.idle();
    await until(() => sent.length === 1);
    expect(store.getOutbox("old")!.status).toBe("gone");
    expect(store.getOutbox("old")!.error).toMatch(/等待太久/);
    expect(sent).toEqual(["新的"]);
  });

  it("survives a restart: unsent messages resume from their progress, sent ones are not repeated", async () => {
    const file = path.join(tmp(), "o.db");
    let store = new Store(file);
    let ob = new Outbox(store, { retry: [60_000, 60_000] });
    const got: string[] = [];
    ob.register("b", "weixin", async (row, progress) => {
      // 第一段发出去了，第二段时"断网"
      got.push(`${row.body.text}#${row.progress}`);
      progress(1);
      throw new Error("socket hang up");
    });
    ob.start();
    await ob.send(input("m1", "长回复"));
    await ob.stop();
    store.close();
    // 重启：等着退避的马上再试，从第 2 段接着发
    store = new Store(file);
    ob = new Outbox(store, { retry: [60_000, 60_000] });
    ob.register("b", "weixin", async (row) => void got.push(`${row.body.text}#${row.progress}`));
    ob.start();
    await ob.idle();
    await until(() => store.getOutbox("m1")!.status === "sent");
    expect(got).toEqual(["长回复#0", "长回复#1"]);
    await ob.stop();
    store.close();
    store = new Store(file);
    ob = new Outbox(store);
    ob.register("b", "weixin", async () => void got.push("again"));
    ob.start();
    await ob.idle();
    expect(got).toHaveLength(2);
    store.close();
  });
});

describe("deliverWeixin", () => {
  const setup = (quotaRemaining = 10, ageMs = 0) => {
    const store = new Store(":memory:");
    store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining, windowStartedAt: Date.now() - ageMs });
    const sent: Array<{ text: string; clientId?: string }> = [];
    let failAt = -1;
    const client = {
      sendText: async (_u: string, text: string, _ctx: string, clientId?: string) => {
        if (sent.length === failAt) throw new Error("fetch failed");
        sent.push({ text, clientId });
      },
    } as any;
    const quota = new WeixinQuota(store, "b");
    const row = (text: string, progress = 0) => ({ id: "wx:b:m1:0", peerId: "u1", kind: "text", body: { text }, progress, attempts: 0 }) as OutboxRow;
    return { store, sent, client, quota, row, fail: (n: number) => (failAt = n) };
  };

  it("splits long text, consumes quota only for what was sent, resumes from progress with the same client ids", async () => {
    const { sent, client, quota, row, fail } = setup();
    const text = "甲".repeat(3990) + "\n\n" + "乙".repeat(3990) + "\n\n" + "丙".repeat(100);
    fail(1);
    let progress = 0;
    await expect(deliverWeixin(client, quota, row(text), (n) => (progress = n))).rejects.toThrow("fetch failed");
    expect(progress).toBe(1);
    expect(quota.remaining("u1")).toBe(9);
    fail(-1);
    await deliverWeixin(client, quota, row(text, progress), (n) => (progress = n));
    expect(sent.map((s) => s.text[0])).toEqual(["甲", "乙", "丙"]);
    expect(sent.map((s) => s.clientId)).toEqual([0, 1, 2].map((i) => stableId("wx:b:m1:0", i)));
    expect(quota.remaining("u1")).toBe(7);
  });

  it("too little quota: truncates with a note; none left or the 24h window passed: held with the reason", async () => {
    const a = setup(1);
    await deliverWeixin(a.client, a.quota, a.row("x".repeat(5000)), () => {});
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0].text).toMatch(/已达到本轮可发送条数上限/);
    await expect(deliverWeixin(a.client, a.quota, a.row("再来一条"), () => {})).rejects.toThrow(/本轮可发送条数已用完/);
    await expect(deliverWeixin(a.client, a.quota, a.row("再来一条"), () => {})).rejects.toBeInstanceOf(Held);
    const b = setup(10, 25 * 3600_000);
    await expect(deliverWeixin(b.client, b.quota, b.row("晚了"), () => {})).rejects.toBeInstanceOf(Held);
    await expect(deliverWeixin(b.client, b.quota, b.row("晚了"), () => {})).rejects.toThrow(/超过 24 小时/);
    expect(b.sent).toEqual([]);
  });
});

describe("deliverFeishu", () => {
  const row = (over: Partial<OutboxRow>) => ({ id: "fs:b:om_1:0", peerId: "oc_1", replyTo: "om_1", kind: "text", body: {}, progress: 0, attempts: 0, ...over }) as OutboxRow;

  it("final reply goes into the streaming card; a retry after failure falls back to a text reply with a stable uuid", async () => {
    const t = new FakeFeishu();
    await deliverFeishu(t, row({ body: { text: "最终", cardId: "card1", cardSeq: 5 } }), () => {});
    expect(t.calls.map((c) => [c.op, c.args[3] ?? c.args[1]])).toEqual([["update", 5], ["finish", 6]]);
    expect(t.texts).toEqual([]);
    const t2 = new FakeFeishu();
    await deliverFeishu(t2, row({ body: { text: "最终", cardId: "card1", cardSeq: 5 }, attempts: 1 }), () => {});
    expect(t2.calls.filter((c) => c.op !== "text")).toEqual([]);
    expect(t2.calls[0].args).toEqual(["om_1", "最终", stableId("fs:b:om_1:0", 0)]);
  });

  it("notices go to the chat; a transport without proactive sends marks them gone", async () => {
    const t = new FakeFeishu();
    await deliverFeishu(t, row({ kind: "notice", body: { text: "有人想使用机器人" } }), () => {});
    expect(t.notices).toEqual([{ chatId: "oc_1", text: "有人想使用机器人", uuid: stableId("fs:b:om_1:0", 0) }]);
    const bare = new FakeFeishu() as any;
    bare.sendText = undefined;
    await expect(deliverFeishu(bare, row({ kind: "notice", body: { text: "x" } }), () => {})).rejects.toBeInstanceOf(Gone);
  });
});
