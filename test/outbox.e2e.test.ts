/**
 * 出站队列端到端：mock iLink + 真实 App。
 * - 回复发不出去时进程被 kill -9，重启后补发，而且只发一次；
 * - 同一条入站消息重启后被重复投递：回复的 id 相同，不会再发一遍；
 * - 重启后发现对方超过 24 小时没说话 / 本轮配额用完：留着；对方下次发消息时先收到合成的「你不在时：…」，再收到这次的回复，只收到一次。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store/db.js";
import { stableId } from "../src/core/outbox.js";
import { mockIlink, mockOpenAI, until } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "owner@im.wechat";
let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let ilink: Awaited<ReturnType<typeof mockIlink>>;
let dataDir: string;
let app: App | undefined;
let child: ChildProcess | undefined;

const dbFile = () => path.join(dataDir, "anymodel.db");
const config = () =>
  loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_WEIXIN_CDN_BASE: ilink.cdnBase, AMB_AGENT: "off" } });
async function startApp(): Promise<App> {
  app = new App(config(), { weixinPollTimeoutMs: 2000, printQrToTerminal: false });
  await app.start();
  return app;
}
async function api(p: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(app!.web!.url.replace(/\/$/, "") + "/amb/api" + p, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
/** 不经 App 读库（子进程还在写时也能读，WAL） */
function rows(): Array<{ id: string; status: string; attempts: number; error: string; body: string }> {
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    return db.prepare("SELECT id, status, attempts, error, body FROM outbox ORDER BY seq").all() as any;
  } finally {
    db.close();
  }
}
/** 不经 App 读会话的重启标记（同 rows） */
function inflightMarker(conversationId: string): string | undefined {
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    return (db.prepare("SELECT value FROM kv WHERE key = ?").get(`inflight:${conversationId}`) as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}
const sentTo = (user: string, text: string) => ilink.state.sent.filter((s) => s.to === user && s.text.includes(text));

beforeAll(async () => {
  llm = await mockOpenAI({ key: "gw-key" });
  ilink = await mockIlink();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-outbox-e2e-"));
  // 已经扫码登录过：扫码的是 owner@im.wechat
  const s = new Store(dbFile());
  s.createBot({ id: "default", name: "我的助手", weixinEnabled: true });
  s.saveWeixinAccount({ botId: "default", botToken: "tok", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: OWNER });
  s.close();
});

afterEach(async () => {
  child?.kill("SIGKILL");
  child = undefined;
  await app?.stop();
  app = undefined;
});

afterAll(async () => {
  await llm?.close();
  await ilink?.close();
});

describe("出站队列：崩溃与重启", () => {
  it("回复发不出去时进程被 kill -9：重启后补发，只发一次，再重启也不重发", async () => {
    ilink.state.sendDown = true;
    child = spawn(process.execPath, ["--import", "tsx", path.join(root, "test/fixtures/app-child.ts"), dataDir, llm.url, ilink.url, ilink.cdnBase], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (out += d));
    await until(() => out.includes("READY"), 30_000, 50);

    ilink.push(OWNER, "崩溃前的问题");
    await until(() => ilink.state.sendFailures >= 1, 15_000);
    await until(() => rows().some((r) => r.attempts >= 1), 15_000);
    // 这一轮已经答完：回复落进了出站队列（等着重试），重启标记清掉了。崩溃发生在这之后，重启后只补发回复，不该再说「没处理完」
    await until(() => !inflightMarker(`default:weixin:${OWNER}`), 15_000);
    const [row] = rows();
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    // id 由入站消息推出：同一条入站只有一个最终回复
    expect(row.id).toMatch(/^wx:default:m\d+:final$/);
    expect(JSON.parse(row.body).text).toBe("[mock-a] 你说：崩溃前的问题");

    // 崩溃：不给任何收尾的机会
    const exited = new Promise((r) => child!.once("exit", r));
    child.kill("SIGKILL");
    await exited;
    child = undefined;
    ilink.state.sendDown = false;

    await startApp();
    await until(() => sentTo(OWNER, "崩溃前的问题").length >= 1, 10_000);
    await app!.outbox.idle();
    await new Promise((r) => setTimeout(r, 300));
    const got = sentTo(OWNER, "崩溃前的问题");
    expect(got).toHaveLength(1);
    expect(ilink.state.clientIds[ilink.state.sent.indexOf(got[0])]).toBe(`amb:${stableId(row.id, 0)}`);
    expect(app!.store.getOutbox(row.id)).toMatchObject({ status: "sent", attempts: 1 });

    await app!.stop();
    await startApp();
    await new Promise((r) => setTimeout(r, 500));
    await app!.outbox.idle();
    expect(sentTo(OWNER, "崩溃前的问题")).toHaveLength(1);
  }, 60_000);

  it("同一条入站消息在重启后又被投递：模型可能再答一遍，但用户只收到一次回复", async () => {
    await startApp();
    const msg = { seq: 900, message_id: "dup-1", from_user_id: OWNER, to_user_id: "bot@im.bot", create_time_ms: Date.now(), message_type: 1, message_state: 2, context_token: "ctx-1", item_list: [{ type: 1, text_item: { text: "只答一次" } }] };
    ilink.state.inbox.push(msg);
    await until(() => sentTo(OWNER, "只答一次").length >= 1, 20_000);
    await app!.stop();
    const calls = llm.calls.length;
    await startApp();
    ilink.state.inbox.push({ ...msg });
    await until(() => llm.calls.length > calls, 20_000);
    await app!.channels.get("default")!.weixin!.idle();
    await new Promise((r) => setTimeout(r, 300));
    expect(sentTo(OWNER, "只答一次")).toHaveLength(1);
  }, 60_000);

  it("重启后对方的 24 小时窗口已过 / 配额已用完：留着；对方下次发消息时先收到「你不在时：…」，再收到这次的回复，只收到一次", async () => {
    await startApp();
    ilink.state.sendDown = true;
    ilink.push(OWNER, "过期测试");
    await until(() => rows().some((r) => JSON.parse(r.body).text?.includes("过期测试") && r.attempts >= 1), 20_000);
    // 这一轮已经答完（回复在出站队列里等着重发），不是被重启打断的
    await app!.channels.get("default")!.weixin!.idle();
    app!.access.allow("default", "weixin", "friend@im.wechat", "test");
    await app!.stop();
    // 关机期间：主人的窗口过了 24 小时；朋友那边还有两条没发出去的回复，而他这一轮的配额已经用完
    const s = new Store(dbFile());
    const owner = s.getWeixinPeer("default", OWNER)!;
    s.upsertWeixinPeer({ ...owner, windowStartedAt: Date.now() - 25 * 3600_000 });
    s.upsertWeixinPeer({ botId: "default", userId: "friend@im.wechat", contextToken: "ctx-f", quotaRemaining: 0, windowStartedAt: Date.now() });
    for (const [i, text] of ["配额测试的第一条", "配额测试的第二条"].entries()) {
      s.insertOutbox({ id: `wx:default:test-quota:${i}`, botId: "default", channel: "weixin", conversationId: "default:weixin:friend@im.wechat", peerId: "friend@im.wechat", kind: "text", body: { text }, replyTo: "", due: Date.now(), createdAt: Date.now(), expiresAt: Date.now() + 24 * 3600_000 });
    }
    s.close();
    ilink.state.sendDown = false;

    await startApp();
    await until(() => rows().filter((r) => r.status === "held").length >= 3, 20_000);
    await app!.outbox.idle();
    expect(rows().filter((r) => r.status === "gone")).toEqual([]);
    expect(rows().find((r) => JSON.parse(r.body).text?.includes("过期测试"))!.error).toMatch(/超过 24 小时/);
    expect(sentTo(OWNER, "过期测试")).toHaveLength(0);
    expect(sentTo("friend@im.wechat", "配额测试")).toHaveLength(0);
    // 没有"没发出去的消息"面板，也不再提示
    expect((await api("/bots/default/outbox")).status).toBe(404);
    expect((await api("/status")).json.notices.some((n: any) => n.text.includes("没能发出去"))).toBe(false);

    // 主人回来了：先收到留着的回复，再收到这次的回复
    const from = ilink.state.sent.length;
    const since = (user: string) => ilink.state.sent.slice(from).filter((x) => x.to === user).map((x) => x.text);
    ilink.push(OWNER, "我回来了");
    await until(() => since(OWNER).length >= 2, 20_000);
    expect(since(OWNER)).toEqual(["你不在时：[mock-a] 你说：过期测试", "[mock-a] 你说：我回来了"]);
    // 朋友：两条合成一条，顺序不变
    ilink.push("friend@im.wechat", "在吗");
    await until(() => since("friend@im.wechat").length >= 2, 20_000);
    expect(since("friend@im.wechat")).toEqual(["你不在时：\n配额测试的第一条\n\n配额测试的第二条", "[mock-a] 你说：在吗"]);
    expect(app!.store.getOutbox("wx:default:test-quota:0")).toMatchObject({ status: "sent" });
    expect(app!.store.getOutbox("wx:default:test-quota:1")).toMatchObject({ status: "merged" });

    // 只送一次：重启、再发消息都不会再补发
    await app!.stop();
    await startApp();
    ilink.push(OWNER, "再来一句");
    ilink.push("friend@im.wechat", "还在");
    await until(() => since(OWNER).length >= 3 && since("friend@im.wechat").length >= 3, 20_000);
    await app!.channels.get("default")!.weixin!.idle();
    await new Promise((r) => setTimeout(r, 300));
    expect(since(OWNER)).toEqual(["你不在时：[mock-a] 你说：过期测试", "[mock-a] 你说：我回来了", "[mock-a] 你说：再来一句"]);
    expect(since("friend@im.wechat")).toHaveLength(3);
    expect(sentTo(OWNER, "你不在时")).toHaveLength(1);
    expect(sentTo("friend@im.wechat", "你不在时")).toHaveLength(1);
  }, 90_000);
});
