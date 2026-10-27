import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store/db.js";
import { ApprovalCenter, parseAnswer, promptText } from "../src/agent/approvals.js";
import { WeixinReply } from "../src/channels/weixin/channel.js";
import { WeixinQuota } from "../src/channels/weixin/quota.js";

let dir: string;
let store: Store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-ap-"));
  store = new Store(path.join(dir, "t.db"));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const base = { botId: "b", conversationId: "b:weixin:u1", sessionId: "s", tool: "bash", detail: "rm -rf build", reason: "" };

describe("ApprovalCenter", () => {
  it("formats the WeChat prompt and accepts 'y CODE' once", async () => {
    const c = new ApprovalCenter(store);
    const row = c.create({ kind: "approval", ...base });
    expect(row.code).toMatch(/^\d{4}$/);
    expect(promptText(row)).toBe(`需批准: bash \`rm -rf build\` — 回复 y ${row.code} / n ${row.code}`);
    expect(c.handleReply("b:weixin:u1", `y ${row.code}`, "u1")).toEqual({ handled: true, ack: `✅ 已批准 ${row.code}（仅本次）` });
    expect(store.getApproval(row.id)!.status).toBe("allowed");
    // 二次回复不再生效
    expect(c.handleReply("b:weixin:u1", `y ${row.code}`, "u1").ack).toContain("没有编号");
  });

  it("rejects codes from another conversation and requires a code when ambiguous", () => {
    const c = new ApprovalCenter(store);
    const a = c.create({ kind: "approval", ...base });
    const b = c.create({ kind: "approval", ...base });
    expect(c.handleReply("b:weixin:other", `y ${a.code}`, "x").ack).toContain("没有编号");
    expect(store.getApproval(a.id)!.status).toBe("pending");
    expect(c.handleReply("b:weixin:u1", "y", "u1").ack).toContain("请带上编号");
    expect(c.handleReply("b:weixin:u1", `n ${b.code}`, "u1").ack).toBe(`❌ 已拒绝 ${b.code}`);
    expect(c.handleReply("b:weixin:u1", "同意", "u1").ack).toBe(`✅ 已批准 ${a.code}（仅本次）`);
  });

  it("ignores unrelated text and slash commands", () => {
    const c = new ApprovalCenter(store);
    c.create({ kind: "approval", ...base });
    expect(c.handleReply("b:weixin:u1", "你好", "u1").handled).toBe(false);
    expect(c.handleReply("b:weixin:u1", "/status", "u1").handled).toBe(false);
    expect(c.handleReply("b:weixin:u2", "y", "u2").handled).toBe(false);
  });

  it("expires after the TTL and on restart", async () => {
    let now = 1_000;
    const c = new ApprovalCenter(store, { ttlMs: 1000, now: () => now });
    const r = c.create({ kind: "approval", ...base });
    now += 1500;
    c.sweep();
    expect(store.getApproval(r.id)!.status).toBe("expired");
    const r2 = c.create({ kind: "approval", ...base });
    const c2 = new ApprovalCenter(store);
    c2.start();
    c2.stop();
    expect(store.getApproval(r2.id)!.status).toBe("expired");
  });

  it("wait() resolves when decided", async () => {
    const c = new ApprovalCenter(store);
    const r = c.create({ kind: "approval", ...base });
    const w = c.wait(r.id, 5000);
    setTimeout(() => c.decide(r.id, true, "web"), 20);
    expect((await w)!.status).toBe("allowed");
  });

  it("answers a pending question from free text (even 'y')", () => {
    const c = new ApprovalCenter(store);
    const q = c.create({ kind: "question", ...base, tool: "", detail: "", payload: JSON.stringify([{ id: "q1", question: "继续吗？", options: [{ label: "是" }, { label: "否" }] }]) });
    expect(c.handleReply("b:weixin:u1", "2", "u1").handled).toBe(true);
    expect(JSON.parse(store.getApproval(q.id)!.result)).toEqual({ answers: [{ id: "q1", selected: ["否"] }] });
  });
});

describe("parseAnswer", () => {
  const qs = [
    { id: "a", question: "颜色", options: [{ label: "红" }, { label: "蓝" }, { label: "绿" }], multiSelect: true },
    { id: "b", question: "名字" },
  ];
  it("maps lines to questions, numbers to options, rest to custom", () => {
    expect(parseAnswer(qs, "1, 3\n小明")).toEqual({ answers: [{ id: "a", selected: ["红", "绿"] }, { id: "b", selected: [], custom: "小明" }] });
    expect(parseAnswer([qs[0]], "蓝")).toEqual({ answers: [{ id: "a", selected: ["蓝"] }] });
    expect(parseAnswer([qs[0]], "9")).toEqual({ answers: [{ id: "a", selected: [], custom: "9" }] });
  });
});

describe("WeixinReply progress batching", () => {
  function setup(remaining = 10) {
    store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: remaining, windowStartedAt: Date.now() });
    const sent: string[] = [];
    const client = {
      sendText: async (_u: string, t: string) => void sent.push(t),
      getTypingTicket: async () => "ticket",
      sendTyping: async () => {},
    } as any;
    return { sent, reply: new WeixinReply(client, "u1", "ctx", new WeixinQuota(store, "b"), 30) };
  }
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("batches progress lines into one message per flush, max 3 per turn", async () => {
    const { sent, reply } = setup();
    for (let round = 0; round < 5; round++) {
      await reply.apply({ type: "progress", text: `🔧 step ${round}a` });
      await reply.apply({ type: "progress", text: `🔧 step ${round}b` });
      await tick(60);
    }
    expect(sent.length).toBe(3);
    expect(sent[0]).toBe("⏳ 进行中：\n🔧 step 0a\n🔧 step 0b");
    await reply.apply({ type: "stream.finish", text: "完成" });
    await tick(10);
    expect(sent.at(-1)).toBe("完成");
  });

  it("keeps a quota reserve and drops pending progress when the final reply arrives", async () => {
    const low = setup(4);
    await low.reply.apply({ type: "progress", text: "🔧 x" });
    await tick(60);
    expect(low.sent).toEqual([]);
  });

  it("sends approval prompts raw (backticks intact) and flushes progress first", async () => {
    const { sent, reply } = setup();
    await reply.apply({ type: "progress", text: "🔧 bash ls" });
    await reply.apply({ type: "interactive", kind: "confirm", prompt: "需批准: bash `rm -rf build` — 回复 y 1234 / n 1234", requestId: "r1", code: "1234" } as any);
    await tick(10);
    expect(sent).toEqual(["⏳ 进行中：\n🔧 bash ls", "需批准: bash `rm -rf build` — 回复 y 1234 / n 1234"]);
  });
});
