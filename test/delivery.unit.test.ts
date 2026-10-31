/**
 * 主动消息的送达规则（3c）：免打扰时段的时间计算（时区、跨午夜、夏令时）、什么时候发（免打扰、人醒着、anytime、合并、每天上限）、
 * 到时间时合成摘要、对方发消息时一起放出来、微信配额预留、续期提醒（时间、只发一次、没东西不发、免打扰不发、关掉、配额、「ok」）、
 * 「需要你」里的未送达（只有不健康的才有）。时钟都是注入的。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store, type OutboxRow } from "../src/store/db.js";
import { Outbox } from "../src/core/outbox.js";
import { Delivery, digestText, nudgeAt, nudgeText, type PushInput } from "../src/core/delivery.js";
import { DEFAULT_QUIET, fmtWhen, inQuiet, minuteOf, nextAt, quietEnd, startOfDay } from "../src/core/quiet.js";
import { deliverWeixin } from "../src/channels/weixin/channel.js";
import { WeixinQuota } from "../src/channels/weixin/quota.js";
import { normalizeSettings } from "../src/agent/settings.js";
import { Held } from "../src/core/outbox.js";

const TZ = "Asia/Shanghai";
/** 上海时间 "2026-11-06T23:00" → 时间戳 */
const at = (s: string) => Date.parse(`${s}${s.length === 16 ? ":00" : ""}+08:00`);
const H = 3600_000;

describe("免打扰时段：主人的时区", () => {
  const q = DEFAULT_QUIET;
  it("22:00–08:00 跨午夜，左闭右开", () => {
    expect(minuteOf("22:00")).toBe(1320);
    expect(minuteOf("24:00")).toBeUndefined();
    expect(["21:59", "22:00", "23:30", "03:00", "07:59", "08:00", "12:00"].map((t) => inQuiet(at(`2026-11-06T${t}`), q, TZ))).toEqual([false, true, true, true, true, false, false]);
  });
  it("结束时间：当晚的到第二天 8 点，凌晨的到当天 8 点；不在时段里就是现在", () => {
    expect(quietEnd(at("2026-11-06T23:00"), q, TZ)).toBe(at("2026-11-07T08:00"));
    expect(quietEnd(at("2026-11-07T03:10"), q, TZ)).toBe(at("2026-11-07T08:00"));
    expect(quietEnd(at("2026-11-07T09:00"), q, TZ)).toBe(at("2026-11-07T09:00"));
  });
  it("同一天里的时段、关掉、起止相同都行", () => {
    const noon = { enabled: true, from: "12:00", to: "13:30" };
    expect([inQuiet(at("2026-11-06T12:10"), noon, TZ), inQuiet(at("2026-11-06T13:30"), noon, TZ)]).toEqual([true, false]);
    expect(quietEnd(at("2026-11-06T12:10"), noon, TZ)).toBe(at("2026-11-06T13:30"));
    expect(inQuiet(at("2026-11-06T23:00"), { ...q, enabled: false }, TZ)).toBe(false);
    expect(inQuiet(at("2026-11-06T23:00"), { enabled: true, from: "08:00", to: "08:00" }, TZ)).toBe(false);
  });
  it("按时区算：纽约的 23:00 是上海的中午", () => {
    const t = Date.parse("2026-11-06T23:00:00-05:00");
    expect(inQuiet(t, q, "America/New_York")).toBe(true);
    expect(inQuiet(t, q, TZ)).toBe(false);
    expect(quietEnd(t, q, "America/New_York")).toBe(Date.parse("2026-11-07T08:00:00-05:00"));
  });
  it("夏令时那天按钟面时间：纽约 3 月 8 日凌晨跳过一小时，早上 8 点照样是 8 点", () => {
    const t = Date.parse("2026-03-07T23:00:00-05:00");
    expect(quietEnd(t, q, "America/New_York")).toBe(Date.parse("2026-03-08T08:00:00-04:00"));
    expect(nextAt(Date.parse("2026-11-01T00:30:00-04:00"), 8 * 60, "America/New_York")).toBe(Date.parse("2026-11-01T08:00:00-05:00"));
  });
  it("一天的开始；给用户看的时间", () => {
    expect(startOfDay(at("2026-11-06T23:00"), TZ)).toBe(at("2026-11-06T00:00"));
    const now = at("2026-11-07T08:00");
    expect(fmtWhen(at("2026-11-07T09:30"), now, TZ)).toBe("今天 9:30");
    expect(fmtWhen(at("2026-11-07T21:00"), now, TZ)).toBe("今晚 21:00");
    expect(fmtWhen(at("2026-11-08T08:00"), now, TZ)).toBe("明早 8:00");
    expect(fmtWhen(at("2026-11-08T15:00"), now, TZ)).toBe("明天 15:00");
    expect(fmtWhen(at("2026-11-09T09:00"), now, TZ)).toBe("周一 9:00");
    expect(fmtWhen(at("2026-11-20T09:00"), now, TZ)).toBe("11月20日 9:00");
  });
});

describe("消息样式", () => {
  it("摘要：一条就是它自己；后台任务、提醒、混在一起各有一句开头，一项一行", () => {
    expect(digestText([{ purpose: "result", text: "GPU 价格调研好了" }])).toBe("GPU 价格调研好了");
    expect(digestText([{ purpose: "result", text: "A 好了" }, { purpose: "failure", text: "⚠️「B」没做完：打不开" }])).toBe("2 个后台任务：\n· A 好了\n· ⚠️「B」没做完：打不开");
    expect(digestText([{ purpose: "rule", text: "X 降价到 ¥199" }, { purpose: "rule", text: "仓库 Y 的 issue #12 有新回复" }])).toBe("2 条提醒：\n· X 降价到 ¥199\n· 仓库 Y 的 issue #12 有新回复");
    expect(digestText([{ purpose: "rule", text: "a" }, { purpose: "result", text: "b\n第二行" }])).toBe("2 条消息：\n· a\n· b 第二行");
  });
  it("续期提醒：产品负责人给的那句话；任务的；多于 3 项", () => {
    const now = at("2026-11-07T08:00");
    const rules = [
      { label: "天气", at: at("2026-11-08T08:00"), kind: "rule" as const },
      { label: "周报", at: at("2026-11-09T09:00"), kind: "rule" as const },
    ];
    expect(nudgeText(rules, now, TZ)).toEqual({ text: "接下来还有 2 条提醒要发给你（明早 8:00 天气、周一 9:00 周报）。回个「ok」我就能继续按时提醒你。", noun: "提醒" });
    expect(nudgeText([{ label: "GPU 价格调研", kind: "task" }], now, TZ).text).toBe("接下来还有 1 条结果要发给你（GPU 价格调研）。回个「ok」我就能继续发给你。");
    const many = nudgeText([...rules, { label: "GPU", kind: "task" }, { label: "D", kind: "task" }], now, TZ).text;
    expect(many).toBe("接下来还有 4 条消息要发给你（明早 8:00 天气、周一 9:00 周报、GPU 等）。回个「ok」我就能继续发给你。");
  });
  it("续期提醒的时间：关闭前 2 小时；那时在免打扰里就挪到结束时或开始前，哪个近用哪个", () => {
    const q = DEFAULT_QUIET;
    // 10:00 发的消息，第二天 10:00 关：8:00 刚好不在免打扰里
    expect(nudgeAt(at("2026-11-06T10:00"), at("2026-11-07T10:00"), q, TZ)).toBe(at("2026-11-07T08:00"));
    // 9:00 关：7:00 在免打扰里，8:00 结束（离关闭还有 1 小时）比前一晚 21:59 近
    expect(nudgeAt(at("2026-11-06T09:00"), at("2026-11-07T09:00"), q, TZ)).toBe(at("2026-11-07T08:00"));
    // 凌晨 1:00 关：23:00 在免打扰里，结束时已经关了，只能在 21:59
    expect(nudgeAt(at("2026-11-06T01:00"), at("2026-11-07T01:00"), q, TZ)).toBe(at("2026-11-06T21:59"));
    // 7:40 关：结束时离关闭不到 30 分钟，前一晚 21:59
    expect(nudgeAt(at("2026-11-06T07:40"), at("2026-11-07T07:40"), q, TZ)).toBe(at("2026-11-06T21:59"));
    expect(nudgeAt(at("2026-11-06T09:00"), at("2026-11-07T09:00"), { ...q, enabled: false }, TZ)).toBe(at("2026-11-07T07:00"));
  });
});

/** 一个机器人、一个时钟、一个出站队列（发送函数只记下来）和送达规则 */
function rig(start: string) {
  let now = at(start);
  const store = new Store(":memory:");
  store.createBot({ id: "b", name: "小蓝", weixinEnabled: true });
  const outbox = new Outbox(store, { now: () => now, retry: [10, 20] });
  const delivery = new Delivery({ store, outbox, now: () => now, timeZone: TZ });
  const sent: OutboxRow[] = [];
  let fail: ((row: OutboxRow) => Error | undefined) | undefined;
  for (const ch of ["weixin", "feishu"])
    outbox.register("b", ch, async (row) => {
      const e = fail?.(row);
      if (e) throw e;
      sent.push(row);
    });
  outbox.start();
  delivery.start();
  const push = (id: string, text: string, o: Partial<PushInput> = {}) => delivery.push({ id, botId: "b", channel: "weixin", peerId: "u1", purpose: "result", subject: id, text, ...o });
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await outbox.idle();
      await new Promise((r) => setImmediate(r));
    }
  };
  /** 拨钟，让出站队列重新看一遍 */
  const go = async (t: string) => {
    now = at(t);
    outbox.wake();
    await new Promise((r) => setImmediate(r));
    await settle();
  };
  return {
    store,
    outbox,
    delivery,
    sent,
    push,
    settle,
    go,
    texts: () => sent.map((r) => r.body.text),
    now: () => now,
    setNow: (t: number) => (now = t),
    onFail: (f: typeof fail) => (fail = f),
    settings: (patch: Record<string, unknown>) => {
      const b = store.getBot("b")!;
      store.updateBot("b", { settings: normalizeSettings({ ...b.settings, ...patch }) });
    },
    close: () => {
      delivery.stop();
      void outbox.stop();
      store.close();
    },
  };
}

describe("什么时候发", () => {
  let r: ReturnType<typeof rig>;
  afterEach(() => r.close());

  it("23:00 的结果排到 08:00；聊天回复从不推迟", async () => {
    r = rig("2026-11-06T23:00");
    expect(r.push("t1", "GPU 价格调研好了")).toEqual({ due: at("2026-11-07T08:00"), reason: "quiet_hours" });
    await r.outbox.send({ id: "reply", botId: "b", channel: "weixin", peerId: "u1", kind: "text", body: { text: "这是聊天回复" } });
    await r.settle();
    expect(r.texts()).toEqual(["这是聊天回复"]);
    expect(r.store.getOutbox("t1")).toMatchObject({ status: "scheduled", reason: "quiet_hours" });
    await r.go("2026-11-07T07:59");
    expect(r.texts()).toEqual(["这是聊天回复"]);
    await r.go("2026-11-07T08:00");
    expect(r.texts()).toEqual(["这是聊天回复", "GPU 价格调研好了"]);
    expect(r.store.getOutbox("t1")).toMatchObject({ status: "sent" });
  });

  it("不受限的情况：任务说了马上告诉（anytime）、人 10 分钟内刚发过消息、免打扰关掉了", async () => {
    r = rig("2026-11-06T23:00");
    expect(r.push("a", "马上要的", { anytime: true }).reason).toBe("");
    r.store.upsertWeixinPeer({ botId: "b", userId: "u2", contextToken: "c", quotaRemaining: 10, windowStartedAt: at("2026-11-06T22:55") });
    expect(r.push("b", "人醒着", { peerId: "u2" }).reason).toBe("");
    r.store.upsertWeixinPeer({ botId: "b", userId: "u3", contextToken: "c", quotaRemaining: 10, windowStartedAt: at("2026-11-06T22:45") });
    expect(r.push("c", "15 分钟前说过话", { peerId: "u3" }).reason).toBe("quiet_hours");
    r.settings({ quietHours: { enabled: false } });
    expect(r.push("d", "关掉了", { peerId: "u4" }).reason).toBe("");
    r.settings({ quietHours: { enabled: true, from: "23:30", to: "07:00" } });
    expect(r.push("e", "时段改了", { peerId: "u5" }).reason).toBe("");
  });

  it("合并：上一条发出不到 2 分钟，后来的排到 2 分钟后，合成一条摘要（一项一行）", async () => {
    r = rig("2026-11-06T10:00");
    r.push("a", "A 好了");
    await r.settle();
    r.setNow(at("2026-11-06T10:00") + 30_000);
    expect(r.push("b", "B 好了")).toEqual({ due: at("2026-11-06T10:02"), reason: "coalesce" });
    r.setNow(at("2026-11-06T10:01"));
    expect(r.push("c", "C 好了").due).toBe(at("2026-11-06T10:02"));
    await r.go("2026-11-06T10:02");
    expect(r.texts()).toEqual(["A 好了", "2 个后台任务：\n· B 好了\n· C 好了"]);
    expect(r.store.getOutbox("c")).toMatchObject({ status: "merged", mergedInto: "b" });
    expect(r.store.getOutbox("b")!.body).toMatchObject({ digest: true });
    // 过了 2 分钟的照常马上发
    await r.go("2026-11-06T10:30");
    r.push("d", "D 好了");
    await r.settle();
    expect(r.texts().at(-1)).toBe("D 好了");
  });

  it("免打扰里到的几条到早上合成一条；文件排在摘要后面", async () => {
    r = rig("2026-11-06T23:00");
    r.push("a", "A 好了", { files: ["/w/a.pdf"] });
    r.setNow(at("2026-11-07T02:00"));
    r.push("b", "⚠️「B」没做完：页面要登录", { purpose: "failure" });
    r.setNow(at("2026-11-07T07:59"));
    r.push("c", "C 好了");
    await r.go("2026-11-07T08:00");
    expect(r.sent.map((x) => (x.kind === "file" ? `[${x.body.name}]` : x.body.text))).toEqual(["3 个后台任务：\n· A 好了\n· ⚠️「B」没做完：页面要登录\n· C 好了", "[a.pdf]"]);
  });

  it("每天上限：微信 3 条，第 4 条起排到第二天早上合成一条；飞书 5 条", async () => {
    r = rig("2026-11-06T09:00");
    for (const [i, t] of ["09:00", "11:00", "13:00"].entries()) {
      await r.go(`2026-11-06T${t}`);
      r.push(`w${i}`, `第 ${i + 1} 条`);
      await r.settle();
    }
    await r.go("2026-11-06T15:00");
    expect(r.push("w3", "第 4 条")).toEqual({ due: at("2026-11-07T08:00"), reason: "daily_cap" });
    await r.go("2026-11-06T18:00");
    expect(r.push("w4", "第 5 条").due).toBe(at("2026-11-07T08:00"));
    // 飞书单独算，5 条
    for (let i = 0; i < 5; i++) {
      await r.go(`2026-11-06T1${i}:30`);
      expect(r.push(`f${i}`, `飞书 ${i + 1}`, { channel: "feishu", peerId: "oc_1", kind: "notice" }).reason).toBe("");
      await r.settle();
    }
    expect(r.push("f5", "飞书 6", { channel: "feishu", peerId: "oc_1", kind: "notice" }).reason).toBe("daily_cap");
    await r.go("2026-11-07T08:00");
    expect(r.texts().filter((t) => !t!.startsWith("飞书"))).toEqual(["第 1 条", "第 2 条", "第 3 条", "2 个后台任务：\n· 第 4 条\n· 第 5 条"]);
    expect(r.texts().at(-1)).toBe("飞书 6");
  });

  it("到时间时再看一遍：设置改了还在免打扰里就再排", async () => {
    r = rig("2026-11-06T23:00");
    r.push("a", "A 好了");
    r.settings({ quietHours: { enabled: true, from: "22:00", to: "09:00" } });
    await r.go("2026-11-07T08:00");
    expect(r.texts()).toEqual([]);
    expect(r.store.getOutbox("a")).toMatchObject({ status: "scheduled", due: at("2026-11-07T09:00") });
    await r.go("2026-11-07T09:00");
    expect(r.texts()).toEqual(["A 好了"]);
  });

  it("对方发消息时排着的不用再等：一起放出来，合成摘要（不是「你不在时」）；有等对方的就是「你不在时」", async () => {
    r = rig("2026-11-06T23:00");
    r.push("a", "A 好了");
    r.push("b", "B 好了");
    expect(r.outbox.release("b", "weixin", "u1", (rows) => r.delivery.combine(rows))).toBe(2);
    await r.settle();
    expect(r.texts()).toEqual(["2 个后台任务：\n· A 好了\n· B 好了"]);
    // 一条留着（窗口关了）、一条排着：合成「你不在时」
    r.onFail((row) => (row.id === "c" ? new Held("窗口关了") : undefined));
    r.store.upsertWeixinPeer({ botId: "b", userId: "u2", contextToken: "c", quotaRemaining: 10, windowStartedAt: at("2026-11-05T09:00") });
    await r.go("2026-11-07T10:00");
    r.push("c", "C 好了", { peerId: "u2" });
    await r.settle();
    expect(r.store.getOutbox("c")).toMatchObject({ status: "held", reason: "window_closed" });
    r.setNow(at("2026-11-07T10:00") + 60_000);
    r.push("d", "D 好了", { peerId: "u2" });
    r.onFail(undefined);
    r.outbox.release("b", "weixin", "u2", (rows) => r.delivery.combine(rows));
    await r.settle();
    expect(r.texts().at(-1)).toBe("你不在时：\nC 好了\n\nD 好了");
  });

  it("飞书：摘要直接发到会话（不回复在某一条下面）；问题不合并", async () => {
    r = rig("2026-11-06T23:00");
    r.push("a", "A 好了", { channel: "feishu", peerId: "oc_1", replyTo: "om_a" });
    r.push("b", "B 好了", { channel: "feishu", peerId: "oc_1", replyTo: "om_b" });
    r.push("q", "❓ 中文还是英文？", { channel: "feishu", peerId: "oc_1", purpose: "question" });
    await r.go("2026-11-07T08:00");
    expect(r.sent.map((x) => [x.kind, x.replyTo, x.body.text])).toEqual([
      ["notice", "", "2 个后台任务：\n· A 好了\n· B 好了"],
      ["text", "", "❓ 中文还是英文？"],
    ]);
  });
});

describe("微信配额预留", () => {
  const setup = (remaining: number, reserved: number) => {
    const store = new Store(":memory:");
    store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: remaining, windowStartedAt: Date.now() });
    const sent: string[] = [];
    const client = { sendText: async (_u: string, text: string) => void sent.push(text) } as any;
    const quota = new WeixinQuota(store, "b");
    quota.reserver = () => reserved;
    const row = (text: string, purpose = "") => ({ id: "r", peerId: "u1", kind: "text", body: { text }, progress: 0, attempts: 0, purpose }) as OutboxRow;
    return { sent, client, quota, row };
  };
  it("聊天回复只能用剩下的减去留给后台任务的；后台任务的结果用全部剩下的", async () => {
    const a = setup(4, 3);
    await deliverWeixin(a.client, a.quota, a.row("x".repeat(9000)), () => {});
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]).toMatch(/已达到本轮可发送条数上限/);
    await expect(deliverWeixin(a.client, a.quota, a.row("再说一句"), () => {})).rejects.toMatchObject({ code: "quota" });
    await deliverWeixin(a.client, a.quota, a.row("GPU 价格调研好了", "result"), () => {});
    expect(a.sent.at(-1)).toBe("GPU 价格调研好了");
    expect(a.quota.remaining("u1")).toBe(2);
  });

  it("留几条：进行中的任务各 1 条（登记的）、排着的主动消息 1 条，最多 3 条", () => {
    const r = rig("2026-11-06T23:00");
    let live = 0;
    r.delivery.addReserver(() => live);
    expect(r.delivery.reserved("b", "weixin", "u1")).toBe(0);
    live = 1;
    expect(r.delivery.reserved("b", "weixin", "u1")).toBe(1);
    r.push("a", "A 好了");
    expect(r.delivery.reserved("b", "weixin", "u1")).toBe(2);
    live = 5;
    expect(r.delivery.reserved("b", "weixin", "u1")).toBe(3);
    expect(r.delivery.reserved("b", "weixin", "someone-else")).toBe(3);
    r.close();
  });
});

describe("续期提醒（「回个 ok」）", () => {
  let r: ReturnType<typeof rig>;
  afterEach(() => r.close());
  /** 用户周五 10:00 发了最后一条消息：窗口周六 10:00 关，提醒在周六 08:00 */
  beforeEach(() => {
    r = rig("2026-11-06T10:00");
    r.store.ensureConversation("b", "weixin", "u1");
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 6, windowStartedAt: at("2026-11-06T10:00") });
  });
  const rules = () => [
    { label: "天气", at: at("2026-11-08T08:00"), kind: "rule" as const },
    { label: "周报", at: at("2026-11-09T09:00"), kind: "rule" as const },
  ];

  it("关闭前约 2 小时、窗口关闭后还有要发的：发一句，只发一次；用掉一条配额；回「ok」不进模型", async () => {
    r.delivery.addUpcoming(() => rules());
    await r.go("2026-11-07T07:59");
    r.delivery.tick();
    await r.settle();
    expect(r.texts()).toEqual([]);
    await r.go("2026-11-07T08:00");
    r.delivery.tick();
    await r.settle();
    expect(r.texts()).toEqual(["接下来还有 2 条提醒要发给你（明早 8:00 天气、周一 9:00 周报）。回个「ok」我就能继续按时提醒你。"]);
    expect(r.sent[0]).toMatchObject({ purpose: "nudge", id: Delivery.nudgeId("b", "u1", at("2026-11-06T10:00")) });
    expect(r.store.listMessages("b:weixin:u1").at(-1)!.content).toBe(r.texts()[0]);
    await r.go("2026-11-07T09:00");
    r.delivery.tick();
    await r.settle();
    expect(r.sent).toHaveLength(1);
    // 回「ok」：认出来，回一句；再回一次就是普通聊天了
    expect(r.delivery.ack("b", "weixin", "u1", "今天天气怎么样")).toBeUndefined();
    expect(r.delivery.ack("b", "weixin", "u1", "OK！")).toBe("好的，到时提醒你。");
    expect(r.delivery.ack("b", "weixin", "u1", "ok")).toBeUndefined();
  });

  it("没有要发的就什么都不发；窗口关闭前就会送到的（排在 08:00 的）不算", async () => {
    await r.go("2026-11-06T23:00");
    r.push("t", "GPU 好了");
    expect(r.store.getOutbox("t")).toMatchObject({ status: "scheduled", due: at("2026-11-07T08:00") });
    // 拨到 08:00，先看提醒（出站队列还没把它发出去）
    r.setNow(at("2026-11-07T08:00"));
    r.delivery.tick();
    await r.settle();
    expect(r.sent.filter((x) => x.purpose === "nudge")).toEqual([]);
    expect(r.delivery.upcoming({ botId: "b", channel: "weixin", peerId: "u1", conversationId: "b:weixin:u1" }, at("2026-11-07T10:00"))).toEqual([]);
  });

  it("进行中的任务算（TaskService 登记的）；排在窗口关闭之后的主动消息算", async () => {
    r.delivery.addUpcoming((p) => (p.peerId === "u1" ? [{ label: "GPU 价格调研", kind: "task" }] : []));
    await r.go("2026-11-07T08:00");
    r.delivery.tick();
    await r.settle();
    expect(r.texts()).toEqual(["接下来还有 1 条结果要发给你（GPU 价格调研）。回个「ok」我就能继续发给你。"]);
    expect(r.delivery.ack("b", "weixin", "u1", "好的")).toBe("好的，到时发给你。");
    // 下一个窗口：一条排到周一的结果也算
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 6, windowStartedAt: at("2026-11-07T10:00") });
    await r.outbox.send({ id: "later", botId: "b", channel: "weixin", peerId: "u1", kind: "text", body: { text: "周报" }, purpose: "result", subject: "周报", due: at("2026-11-09T09:00") });
    await r.go("2026-11-08T08:00");
    r.delivery.tick();
    await r.settle();
    expect(r.texts().at(-1)).toBe("接下来还有 2 条结果要发给你（明早 9:00 周报、GPU 价格调研）。回个「ok」我就能继续发给你。");
  });

  it("免打扰时不发；按机器人关掉；配额用完、窗口已关不发", async () => {
    r.delivery.addUpcoming(() => rules());
    // 窗口凌晨 1:00 关：提醒挪到前一晚 21:59；22:30 才看到时已经在免打扰里，不发
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 6, windowStartedAt: at("2026-11-06T01:00") });
    await r.go("2026-11-06T22:30");
    r.delivery.tick();
    await r.settle();
    expect(r.sent).toEqual([]);
    await r.go("2026-11-06T21:59");
    r.settings({ nudge: false });
    r.delivery.tick();
    await r.settle();
    expect(r.sent).toEqual([]);
    r.settings({ nudge: true });
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 0, windowStartedAt: at("2026-11-06T01:00") });
    r.delivery.tick();
    await r.settle();
    expect(r.sent).toEqual([]);
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 3, windowStartedAt: at("2026-11-06T01:00") });
    r.delivery.tick();
    await r.settle();
    expect(r.sent).toHaveLength(1);
    // 发不出去（窗口刚好关了）：不留着，下个窗口也不补发
    await r.go("2026-11-07T08:00");
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 6, windowStartedAt: at("2026-11-06T10:00") });
    r.onFail(() => new Held("窗口关了"));
    r.delivery.tick();
    await r.settle();
    expect(r.store.getOutbox(Delivery.nudgeId("b", "u1", at("2026-11-06T10:00")))).toMatchObject({ status: "gone" });
    expect(r.delivery.attentionItems()).toEqual([]);
  });
});

describe("暂停后台工作：主动消息排着等恢复，聊天回复照常", () => {
  let r: ReturnType<typeof rig>;
  afterEach(() => r.close());

  it("暂停时推的排着（对方发消息也不放）、没发出去的改成排着，不挡后面的回复；不发续期提醒；恢复后按平常的规则发", async () => {
    r = rig("2026-11-06T10:00");
    r.store.ensureConversation("b", "weixin", "u1");
    r.store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 6, windowStartedAt: at("2026-11-06T10:00") });
    r.delivery.addUpcoming(() => [{ label: "天气", at: at("2026-11-08T08:00"), kind: "rule" }]);
    // 暂停前就在等着重发的一条结果（渠道一直失败）
    r.onFail((row) => (row.id === "early" ? new Error("网络断了") : undefined));
    r.push("early", "早一点的结果", { anytime: true });
    await r.settle();
    expect(r.store.getOutbox("early")).toMatchObject({ status: "pending", attempts: 1 });
    r.onFail(undefined);
    r.settings({ paused: true });
    expect(r.push("a", "A 好了", { anytime: true })).toMatchObject({ reason: "paused" });
    expect(r.store.getOutbox("a")).toMatchObject({ status: "scheduled", reason: "paused" });
    // 那条在等重发的改成排着；后面的聊天回复照常马上发
    await r.go("2026-11-06T10:01");
    await r.outbox.send({ id: "reply", botId: "b", channel: "weixin", peerId: "u1", kind: "text", body: { text: "聊天回复" } });
    await r.settle();
    expect(r.texts()).toEqual(["聊天回复"]);
    expect(r.store.getOutbox("early")).toMatchObject({ status: "scheduled", reason: "paused" });
    // 对方发消息：不放
    expect(r.outbox.release("b", "weixin", "u1", (rows) => r.delivery.combine(rows))).toBe(0);
    await r.settle();
    expect(r.texts()).toEqual(["聊天回复"]);
    // 到了续期提醒的时间也不发；到了该再看一遍的时间还在暂停，再排
    await r.go("2026-11-07T08:00");
    r.delivery.tick();
    await r.settle();
    expect(r.texts()).toEqual(["聊天回复"]);
    expect(r.store.getOutbox("a")).toMatchObject({ status: "scheduled", reason: "paused" });
    // 恢复：排着的按平常的规则发出去（两条一起到，合成一条）
    r.settings({ paused: false });
    expect(r.delivery.resume("b")).toBe(2);
    await r.settle();
    expect(r.texts()).toEqual(["聊天回复", "2 个后台任务：\n· 早一点的结果\n· A 好了"]);
    expect(r.delivery.attentionItems()).toEqual([]);
  });
});

describe("「需要你」里的未送达", () => {
  let r: ReturnType<typeof rig>;
  afterEach(() => r.close());

  it("健康的什么都没有：发出去的、排着等早上的", async () => {
    r = rig("2026-11-06T23:00");
    r.push("a", "A 好了");
    r.push("b", "B 好了", { anytime: true });
    await r.settle();
    expect(r.delivery.attentionItems()).toEqual([]);
  });

  it("微信窗口关了：一项「1 条结果未送达微信」，对方发消息后自己消失", async () => {
    r = rig("2026-11-06T10:00");
    let changes = 0;
    r.delivery.onChange(() => changes++);
    r.onFail(() => new Held("对方超过 24 小时没有发消息", "window_closed"));
    r.push("a", "GPU 价格调研好了");
    await r.settle();
    await new Promise((x) => setImmediate(x));
    const [item] = r.delivery.attentionItems();
    expect(item).toMatchObject({ id: "delivery:b:weixin:u1:held", kind: "delivery", state: "held", severity: "warn", title: "1 条结果未送达微信", line: "在微信里发条消息就能收到", actions: [] });
    expect(item.messages).toEqual([{ id: "a", text: "GPU 价格调研好了", at: at("2026-11-06T10:00"), ref: "" }]);
    expect(changes).toBeGreaterThan(0);
    r.onFail(undefined);
    r.outbox.release("b", "weixin", "u1", (rows) => r.delivery.combine(rows));
    await r.settle();
    expect(r.delivery.attentionItems()).toEqual([]);
  });

  it("一直失败（试了 3 次）：还在重试；放弃了：可以重试、可以不再提示；短命的提示和续期提醒不算", async () => {
    r = rig("2026-11-06T10:00");
    r.onFail(() => new Error("HTTP 500"));
    r.push("f", "A 好了", { channel: "feishu", peerId: "oc_1", replyTo: "om_1" });
    await r.outbox.send({ id: "ack", botId: "b", channel: "feishu", peerId: "oc_1", kind: "text", body: { text: "收到" }, ttlMs: 600_000 });
    for (let i = 1; i <= 3; i++) await r.go(`2026-11-06T10:0${i}`);
    expect(r.store.getOutbox("f")!.attempts).toBeGreaterThanOrEqual(3);
    expect(r.delivery.attentionItems()).toMatchObject([{ state: "failed", severity: "error", title: "1 条结果没能发到飞书", line: "还在重试", actions: ["retry"] }]);
    r.store.updateOutbox("f", { status: "gone", error: "发送失败" });
    const [item] = r.delivery.attentionItems();
    expect(item.actions).toEqual(["retry", "dismiss"]);
    expect(r.delivery.act(item.id, "dismiss")).toBe(true);
    expect(r.delivery.attentionItems()).toEqual([]);
    r.store.updateOutbox("f", { seenAt: 0 });
    r.onFail(undefined);
    expect(r.delivery.act(item.id, "retry")).toBe(true);
    await r.settle();
    expect(r.store.getOutbox("f")).toMatchObject({ status: "sent" });
    expect(r.delivery.attentionItems()).toEqual([]);
  });

  it("合成的一条按里面的条数算", async () => {
    r = rig("2026-11-06T23:00");
    r.push("a", "A 好了");
    r.push("b", "B 好了");
    r.onFail(() => new Held("窗口关了", "window_closed"));
    await r.go("2026-11-07T08:00");
    expect(r.delivery.attentionItems().map((i) => i.title)).toEqual(["2 条结果未送达微信"]);
  });
});
