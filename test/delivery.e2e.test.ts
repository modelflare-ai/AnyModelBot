/**
 * 主动消息的送达规则（3c）端到端：mock iLink + 真实 App（真实的出站队列、微信渠道、后台任务服务），钟是假的（只假 Date，拨着走），
 * 时区是上海。主人在微信里用自己的机器人。
 * - 退出演示：23:00 做好的结果 08:00 才发；微信窗口已经关了时留着、出现在「需要你」里，主人下次发消息时排在回复前面先到；
 * - 免打扰里做好的几条到早上合成一条摘要；夜里的聊天回复照常马上回；
 * - 续期提醒：窗口关闭前约 2 小时、还有任务在跑时发一次，只发一次；没有要发的就不发；回「ok」不进模型。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store/db.js";
import { mockIlink, mockOpenAI, until } from "./helpers.js";

const OWNER = "owner@im.wechat";
const FRIEND = "friend@im.wechat";
const CONV = `default:weixin:${OWNER}`;
/** 上海时间 → 时间戳 */
const at = (s: string) => Date.parse(`${s}:00+08:00`);

let llm: Awaited<ReturnType<typeof mockOpenAI>>;
let ilink: Awaited<ReturnType<typeof mockIlink>>;
let dataDir: string;
let app: App;
let n = 0;

/** 拨钟：出站队列和续期提醒马上重新看一遍 */
async function clock(t: string): Promise<void> {
  vi.setSystemTime(at(t));
  app.outbox.wake();
  app.delivery.tick();
  await settle();
}
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
  await app.channels.get("default")!.weixin!.idle();
}
/** 发给某人的消息（从 from 条之后） */
const to = (user: string, from = 0) => ilink.state.sent.slice(from).filter((s) => s.to === user).map((s) => s.text);
/** 主人发一条消息，等到回复 */
async function say(user: string, text: string): Promise<string[]> {
  const from = ilink.state.sent.length;
  ilink.push(user, text);
  await until(() => to(user, from).some((t) => t.includes(`你说：${text}`)), 8000);
  await settle();
  return to(user, from);
}
/** 一个后台任务做完了（结果是 message）：写进库，让任务服务把结果发出去 */
function finish(title: string, message: string): string {
  const id = `t_e2e${++n}`;
  const now = Date.now();
  app.store.insertTask({ id, botId: "default", conversationId: CONV, originMessageId: 0, originRef: "", title, brief: title, sessionId: `task-${id}`, folder: `tasks/x-${id}`, model: "", permission: "workspace", budgetUsd: 1, createdAt: now, updatedAt: now });
  app.store.insertRun({ id: `r_${id}`, botId: "default", taskId: id, sessionId: `task-${id}`, cause: "launch", queuedAt: now });
  app.store.updateRun(`r_${id}`, { state: "ended", outcome: "done", startedAt: now, endedAt: now, report: { state: "done", summary: "", message, at: now } });
  app.store.updateTask(id, { endedAt: now, endReason: "done", report: { state: "done", summary: "", message, at: now } });
  // 应用重启时任务服务会补送结束了却没送出的结果；这里用同一条路
  app.tasks.start();
  return id;
}
const stage = (id: string) => app.tasks.get(id)!.stage.label;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(at("2026-11-06T21:00"));
  llm = await mockOpenAI({ key: "gw-key" });
  ilink = await mockIlink();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-delivery-e2e-"));
  const s = new Store(path.join(dataDir, "anymodel.db"));
  s.createBot({ id: "default", name: "小蓝", weixinEnabled: true });
  s.saveWeixinAccount({ botId: "default", botToken: "tok", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: OWNER });
  s.close();
  const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_WEIXIN_CDN_BASE: ilink.cdnBase, AMB_AGENT: "off" } });
  app = new App(config, { weixinPollTimeoutMs: 1000, printQrToTerminal: false, timeZone: "Asia/Shanghai" });
  await app.start();
  app.access.allow("default", "weixin", FRIEND, "test");
});

afterAll(async () => {
  await app?.stop();
  await llm?.close();
  await ilink?.close();
  vi.useRealTimers();
});

describe("退出演示：免打扰与微信窗口", () => {
  it("23:00 做好的结果 08:00 才发；夜里的聊天照常马上回", async () => {
    // 周五 21:00 主人说了句话（窗口到周六 21:00）
    expect(await say(OWNER, "晚上好")).toEqual(["[mock-a] 你说：晚上好"]);
    await clock("2026-11-06T23:00");
    const from = ilink.state.sent.length;
    const t = finish("GPU 价格调研", "GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800。");
    await settle();
    expect(to(OWNER, from)).toEqual([]);
    expect(stage(t)).toBe("已完成");
    // 健康：排着等早上，「需要你」里什么都没有
    expect(app.delivery.attentionItems()).toEqual([]);
    // 朋友夜里发消息：回复照常马上回（聊天回复从不推迟）
    expect(await say(FRIEND, "睡了吗")).toEqual(["[mock-a] 你说：睡了吗"]);
    await clock("2026-11-07T07:59");
    expect(to(OWNER, from)).toEqual([]);
    await clock("2026-11-07T08:00");
    await until(() => to(OWNER, from).length >= 1, 5000);
    // 单独发出去的结果带着设计里的那句提示；「你不在时」和摘要里不带（见下面两个）
    expect(to(OWNER, from)).toEqual(["GPU 价格调研好了：A100 包月最便宜的是 X 云，约 ¥7,800。引用这条消息可以继续问。"]);
    await clock("2026-11-07T09:00");
    expect(to(OWNER, from)).toHaveLength(1);
  });

  it("窗口已经关了：留着，出现在「需要你」里；主人下次发消息时排在回复前面先到，只到一次", async () => {
    // 周六 23:00 又做好一个；主人周五 21:00 之后再没说话，窗口周六 21:00 已经关了
    await clock("2026-11-07T23:00");
    const from = ilink.state.sent.length;
    const t = finish("季度报告", "季度报告做好了，在 tasks 文件夹里。");
    await clock("2026-11-08T08:00");
    await until(() => app.store.getOutbox(`task:${t}:result:r_${t}`)?.status === "held", 5000);
    expect(to(OWNER, from)).toEqual([]);
    expect(stage(t)).toBe("未送达");
    const items = app.delivery.attentionItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "delivery", botId: "default", title: "1 条结果未送达微信", line: "在微信里发条消息就能收到", severity: "warn" });
    expect(items[0].messages.map((m) => m.text)).toEqual(["季度报告做好了，在 tasks 文件夹里。"]);
    // 「需要你」里就这一行（任务那一份不重复列），没送到的那句在这里就能看到
    expect(app.attention.list().map((x) => [x.kind, x.subject, x.status, x.line, x.actions])).toEqual([["delivery", "1 条结果未送达微信", "在微信里发条消息就能收到", "季度报告做好了，在 tasks 文件夹里。", []]]);
    // 主人周日 09:00 发消息：先收到留着的结果，再收到这次的回复
    await clock("2026-11-08T09:00");
    expect(await say(OWNER, "早")).toEqual(["你不在时：季度报告做好了，在 tasks 文件夹里。", "[mock-a] 你说：早"]);
    expect(app.delivery.attentionItems()).toEqual([]);
    expect(app.attention.list()).toEqual([]);
    expect(stage(t)).toBe("已完成");
    expect(await say(OWNER, "好的")).toEqual(["[mock-a] 你说：好的"]);
  });

  it("免打扰里做好的几条，到早上合成一条摘要", async () => {
    // 窗口从周日 09:00 开到周一 09:00
    await clock("2026-11-08T23:00");
    const from = ilink.state.sent.length;
    finish("周报", "周报写好了。");
    await clock("2026-11-08T23:40");
    finish("发票整理", "发票整理好了，一共 12 张。");
    await clock("2026-11-09T02:00");
    finish("域名续费", "⚠️「域名续费」没做完：支付页要登录。");
    await clock("2026-11-09T07:00");
    expect(to(OWNER, from)).toEqual([]);
    await clock("2026-11-09T08:00");
    await until(() => to(OWNER, from).length >= 1, 5000);
    await settle();
    expect(to(OWNER, from)).toEqual(["3 个后台任务：\n· 周报写好了。\n· 发票整理好了，一共 12 张。\n· ⚠️「域名续费」没做完：支付页要登录。"]);
  });
});

describe("续期提醒", () => {
  it("窗口关闭前约 2 小时、还有任务在跑：提醒一次，只一次；回「ok」不进模型；没东西要发的人收不到", async () => {
    // 周一 10:00 主人和朋友都说了话：窗口到周二 10:00，提醒时间周二 08:00
    await clock("2026-11-09T10:00");
    await say(OWNER, "帮我后台调研 Y");
    await say(FRIEND, "在吗");
    const now = Date.now();
    app.store.insertTask({ id: "t_live", botId: "default", conversationId: CONV, originMessageId: 0, originRef: "", title: "调研 Y", brief: "", sessionId: "task-t_live", folder: "tasks/y", model: "", permission: "workspace", budgetUsd: 1, createdAt: now, updatedAt: now });
    app.store.insertRun({ id: "r_live", botId: "default", taskId: "t_live", sessionId: "task-t_live", cause: "launch", queuedAt: now });
    app.store.updateRun("r_live", { state: "running", startedAt: now });
    // 进行中的任务给它留了一条配额
    expect(app.delivery.reserved("default", "weixin", OWNER)).toBe(1);
    const from = ilink.state.sent.length;
    await clock("2026-11-10T07:59");
    expect(to(OWNER, from)).toEqual([]);
    await clock("2026-11-10T08:00");
    await until(() => to(OWNER, from).length >= 1, 5000);
    const nudge = "接下来还有 1 条结果要发给你（调研 Y）。回个「ok」我就能继续发给你。";
    expect(to(OWNER, from)).toEqual([nudge]);
    await clock("2026-11-10T08:30");
    await clock("2026-11-10T09:30");
    expect(to(OWNER, from)).toEqual([nudge]);
    // 朋友那边没有要发的：什么都没收到
    expect(to(FRIEND, from)).toEqual([]);
    // 主人回「ok」：窗口重新开始，回一句，不进模型
    const calls = llm.calls.length;
    ilink.push(OWNER, "ok");
    await until(() => to(OWNER, from).length >= 2, 5000);
    await settle();
    expect(to(OWNER, from)).toEqual([nudge, "好的，到时发给你。"]);
    expect(llm.calls.length).toBe(calls);
    expect(app.store.listMessages(CONV).slice(-3).map((m) => [m.role, m.content])).toEqual([["assistant", nudge], ["user", "ok"], ["assistant", "好的，到时发给你。"]]);
    // 任务做完了、结果发了：下一个窗口快关时没有要发的，不再提醒
    app.store.updateRun("r_live", { state: "ended", outcome: "done", endedAt: Date.now(), delivery: "x:dropped" });
    app.store.updateTask("t_live", { endedAt: Date.now(), endReason: "done" });
    const later = ilink.state.sent.length;
    await clock("2026-11-11T07:40");
    await clock("2026-11-11T08:30");
    expect(to(OWNER, later)).toEqual([]);
  });
});
