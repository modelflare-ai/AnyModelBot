/**
 * 出站队列端到端：mock iLink + 真实 App。
 * - 回复发不出去时进程被 kill -9，重启后补发，而且只发一次；
 * - 同一条入站消息重启后被重复投递：回复的 id 相同，不会再发一遍；
 * - 重启后发现对方超过 24 小时没说话 / 本轮配额用完：标记 gone，信息面板能看到原因，可以"知道了"。
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
    await until(() => rows().some((r) => r.attempts >= 1), 5000);
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
    await until(() => sentTo(OWNER, "只答一次").length >= 1, 8000);
    await app!.stop();
    const calls = llm.calls.length;
    await startApp();
    ilink.state.inbox.push({ ...msg });
    await until(() => llm.calls.length > calls, 8000);
    await app!.channels.get("default")!.weixin!.idle();
    await new Promise((r) => setTimeout(r, 300));
    expect(sentTo(OWNER, "只答一次")).toHaveLength(1);
  });

  it("重启后对方的 24 小时窗口已过 / 配额已用完：标记 gone，信息面板能看到原因，可以「知道了」", async () => {
    await startApp();
    ilink.state.sendDown = true;
    ilink.push(OWNER, "过期测试");
    await until(() => rows().some((r) => JSON.parse(r.body).text?.includes("过期测试") && r.attempts >= 1), 8000);
    app!.access.allow("default", "weixin", "friend@im.wechat", "test");
    await app!.stop();
    // 关机期间：主人的窗口过了 24 小时；朋友那边还有一条没发出去的回复，而他这一轮的配额已经用完
    const s = new Store(dbFile());
    const owner = s.getWeixinPeer("default", OWNER)!;
    s.upsertWeixinPeer({ ...owner, windowStartedAt: Date.now() - 25 * 3600_000 });
    s.upsertWeixinPeer({ botId: "default", userId: "friend@im.wechat", contextToken: "ctx-f", quotaRemaining: 0, windowStartedAt: Date.now() });
    s.insertOutbox({ id: "wx:default:test-quota:0", botId: "default", channel: "weixin", conversationId: "default:weixin:friend@im.wechat", peerId: "friend@im.wechat", kind: "text", body: { text: "配额测试的回复" }, replyTo: "", due: Date.now(), createdAt: Date.now(), expiresAt: Date.now() + 3600_000 });
    s.close();
    ilink.state.sendDown = false;

    await startApp();
    await until(() => rows().filter((r) => r.status === "gone").length >= 2, 8000);
    const box = await api("/bots/default/outbox");
    const reasons = box.json.failed.map((f: any) => [f.to, f.preview, f.error]);
    expect(reasons).toEqual(
      expect.arrayContaining([
        ["微信主人", "[mock-a] 你说：过期测试", expect.stringMatching(/超过 24 小时/)],
        ["微信用户 friend", "配额测试的回复", expect.stringMatching(/本轮可发送条数已用完/)],
      ]),
    );
    expect(sentTo(OWNER, "过期测试")).toHaveLength(0);
    // 状态里也记了一笔
    expect((await api("/status")).json.notices.some((n: any) => n.text.includes("没能发出去"))).toBe(true);
    for (const f of box.json.failed) expect((await api(`/bots/default/outbox/${encodeURIComponent(f.id)}/dismiss`, { method: "POST", body: {} })).status).toBe(200);
    expect((await api("/bots/default/outbox")).json.failed).toEqual([]);
  });
});
