/**
 * 模型在回合中间说的话（interim）和回合中交付的文件（presented）：运行时怎么发给渠道、怎么存进历史；
 * 网页的进行中消息（LiveTurn）、微信（不多发）、飞书流式卡片（写进卡片）怎么接；处理过程里模型那一步不再重复这些话。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BotRuntime, TurnSaid } from "../src/core/runtime.js";
import { Store } from "../src/store/db.js";
import { TurnStopped, interimText, type TurnObserver } from "../src/agent/host.js";
import { ActivityLog } from "../src/agent/activity.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import { LiveTurn } from "../src/web/live.js";
import { WeixinReply } from "../src/channels/weixin/channel.js";
import { WeixinQuota } from "../src/channels/weixin/quota.js";
import { FeishuReply } from "../src/channels/feishu/card.js";
import type { AgentManager } from "../src/agent/manager.js";
import type { InboundEvent, OutboundOp } from "../src/core/types.js";
import { FakeFeishu } from "./helpers.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-said-"));
const ws = path.join(dir, "ws");
fs.mkdirSync(ws);
const png = path.join(fs.realpathSync(ws), "cover.png");
fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
const pdf = path.join(fs.realpathSync(ws), "report.pdf");
fs.writeFileSync(pdf, "%PDF-1.4");

const ev = (text: string, channel: InboundEvent["channel"] = "web"): InboundEvent => ({
  id: Math.random().toString(36),
  channel,
  botId: "b1",
  conversation: { kind: "dm", id: "console" },
  sender: { id: "owner" },
  parts: [{ type: "text", text }],
  replyHandle: {},
  receivedAt: Date.now(),
});

/** 假的代理：script 拿到观察者，像宿主那样陆续报"说了一段话""交付了文件"，返回这一轮的结果（或抛错） */
function setup(script: (o: TurnObserver) => Promise<{ text: string; files?: string[] }>) {
  const store = new Store(path.join(dir, `${Math.random().toString(36).slice(2)}.db`));
  store.createBot({ id: "b1", name: "测试" });
  const host = { state: "running", workspace: ws, diagnostics: () => ({}) };
  const agent = {
    available: true,
    host: () => host,
    approvals: { bindSink: () => () => {}, handleReply: () => ({ handled: false }), pending: () => [] },
    turnsInProgress: new Map(),
    settings: () => DEFAULT_SETTINGS,
    memoryPrefix: () => "",
    takeSeed: () => "",
    runTurn: async (_bot: string, input: any) => {
      input.observer?.onStart?.();
      input.observer?.onProgress?.("🔧 bash");
      const r = await script(input.observer);
      return { sessionId: "s1", usage: { tokens: 0, window: 0, maxTokens: 0 }, files: [], ...r };
    },
    stopTurn: () => false,
  } as unknown as AgentManager;
  const rt = new BotRuntime({ store, models: { listModels: async () => ["m1"], streamChat: async () => "纯对话" } as any, defaultModel: () => "m1", contextMessages: 20, contextChars: 20_000, agent });
  const ops: OutboundOp[] = [];
  const out = { apply: async (op: OutboundOp) => void ops.push(op) };
  const last = () => store.listMessages("b1:web:console").at(-1)!;
  return { rt, store, ops, out, last };
}

const kinds = (ops: OutboundOp[]) => ops.filter((o) => o.type !== "typing" && o.type !== "stream.start").map((o) => ("text" in o ? `${o.type}:${o.text}` : "path" in o ? `${o.type}:${path.basename(o.path)}` : o.type));

describe("运行时：回合中间说的话和交付的文件", () => {
  it("说的话一段段马上发出，文件在 present 时就给网页看；结束时回复照旧，历史里按顺序存下说的话和文件", async () => {
    const { rt, ops, out, last } = setup(async (o) => {
      o.onInterim?.("我先看看下载目录里有什么。");
      o.onPresent?.([png]);
      o.onInterim?.("找到 12 张截图。");
      o.onPresent?.([png, pdf]);
      return { text: "整理好了。", files: [png, pdf] };
    });
    await rt.handle(ev("整理截图"), out);
    expect(kinds(ops)).toEqual([
      "interim:我先看看下载目录里有什么。",
      "presented:cover.png",
      "interim:找到 12 张截图。",
      "presented:report.pdf",
      "stream.finish:整理好了。",
      "file:cover.png",
      "file:report.pdf",
    ]);
    expect(last()).toMatchObject({ role: "assistant", content: "整理好了。", interim: ["我先看看下载目录里有什么。", "找到 12 张截图。"], files: [png, pdf] });
  });

  it("最后没再说话：回合中间说的最后一句就是回复（微信收到的也是它），不在说的话里重复", async () => {
    const { rt, ops, out, last } = setup(async (o) => {
      o.onInterim?.("我先看看。");
      o.onInterim?.("图做好了，发给你：");
      return { text: "", files: [png] };
    });
    await rt.handle(ev("做张图"), out);
    expect(kinds(ops).filter((k) => k.startsWith("stream.finish"))).toEqual(["stream.finish:图做好了，发给你："]);
    expect(last()).toMatchObject({ content: "图做好了，发给你：", interim: ["我先看看。"], files: [png] });
  });

  it("什么都没说：照旧是「已完成，没有文字回复」，历史里没有多余的字段", async () => {
    const { rt, out, last } = setup(async () => ({ text: "" }));
    await rt.handle(ev("hi"), out);
    expect(last().content).toMatch(/已完成/);
    expect(last().interim).toBeUndefined();
    expect(last().files).toBeUndefined();
  });

  it("出错或中止：之前说过的话和交付过的文件留在历史里，回复是出错的说明", async () => {
    const { rt, out, last, ops } = setup(async (o) => {
      o.onInterim?.("我先看看。");
      o.onPresent?.([png]);
      throw new TurnStopped("user", 3000);
    });
    await rt.handle(ev("干活"), out);
    expect(last().content).toMatch(/^已中止/);
    expect(last()).toMatchObject({ interim: ["我先看看。"], files: [png] });
    // 出错时文件不再发到渠道
    expect(kinds(ops).filter((k) => k.startsWith("file:"))).toEqual([]);
  });

  it("等代理启动时的临时文字：模型说的第一段话来了就换掉", async () => {
    const ops: OutboundOp[] = [];
    const said = new TurnSaid({ apply: async (op) => void ops.push(op) });
    said.provisional = true;
    said.observer.onInterim("第一段");
    said.observer.onInterim("第二段");
    expect(kinds(ops)).toEqual(["stream.update:", "interim:第一段", "interim:第二段"]);
  });
});

describe("渠道怎么接", () => {
  it("网页（LiveTurn）：snapshot 里有说的话和文件；present 过的文件结束时不再显示一遍；文件带名字、大小、是不是图片", async () => {
    const t = new LiveTurn("b1:web:console", "b1", "整理截图", 0);
    const events: Array<[string, any]> = [];
    t.subscribe((e, d) => events.push([e, d]));
    await t.apply({ type: "interim", text: "我先看看。" });
    await t.apply({ type: "presented", path: png, name: "cover.png" });
    await t.apply({ type: "stream.finish", text: "好了" });
    await t.apply({ type: "file", path: png, name: "cover.png" });
    await t.apply({ type: "file", path: pdf, name: "report.pdf" });
    expect(events.map(([e]) => e)).toEqual(["interim", "file", "text", "file"]);
    const s = t.snapshot();
    expect(s.interim).toEqual(["我先看看。"]);
    expect(s.text).toBe("好了");
    expect(s.files).toEqual([
      { path: png, name: "cover.png", size: 8, image: true },
      { path: pdf, name: "report.pdf", size: 8 },
    ]);
  });

  it("微信：回合中间说的话和 present 都不发，只发最后的回复和文件（配额）", async () => {
    const store = new Store(path.join(dir, "wx.db"));
    store.upsertWeixinPeer({ botId: "b", userId: "u1", contextToken: "ctx", quotaRemaining: 10, windowStartedAt: Date.now() });
    const sent: string[] = [];
    const client = { sendText: async (_u: string, t: string) => void sent.push(t), getTypingTicket: async () => "ticket", sendTyping: async () => {} } as any;
    const reply = new WeixinReply(client, "u1", "ctx", new WeixinQuota(store, "b"));
    await reply.apply({ type: "stream.start" });
    await reply.apply({ type: "interim", text: "我先看看。" });
    await reply.apply({ type: "presented", path: png, name: "cover.png" });
    await reply.apply({ type: "interim", text: "快好了。" });
    await reply.apply({ type: "stream.finish", text: "整理好了。" });
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual(["整理好了。"]);
    store.close();
  });

  it("飞书：说的话写进流式卡片，最终回复接在后面，卡片上留着全部；回复就是最后一句时不重复", async () => {
    const t = new FakeFeishu();
    const r = new FeishuReply(t, "om_1", 5);
    await r.apply({ type: "stream.start" });
    await r.apply({ type: "stream.update", text: "代理已就绪，正在处理…" });
    await r.apply({ type: "stream.update", text: "" });
    await r.apply({ type: "interim", text: "我先看看。" });
    await new Promise((res) => setTimeout(res, 30));
    expect(t.cards.get("card1")).toBe("我先看看。");
    await r.apply({ type: "interim", text: "找到了。" });
    await r.apply({ type: "stream.finish", text: "整理好了。" });
    expect(t.cards.get("card1")).toBe("我先看看。\n\n找到了。\n\n整理好了。");
    expect(t.finished.has("card1")).toBe(true);
    expect(t.texts).toEqual([]);

    const t2 = new FakeFeishu();
    const r2 = new FeishuReply(t2, "om_2", 5);
    await r2.apply({ type: "stream.start" });
    await r2.apply({ type: "interim", text: "我先看看。" });
    await r2.apply({ type: "interim", text: "图做好了：" });
    await r2.apply({ type: "stream.finish", text: "图做好了：" });
    expect(t2.cards.get("card1")).toBe("我先看看。\n\n图做好了：");
  });
});

describe("处理过程不重复模型说的话", () => {
  const T0 = 1_800_000_000_000;
  const msg = (step: number, content: any[], extra: Record<string, unknown> = {}) => ({ turn: 1, step, message: { role: "assistant", content, source: { model: "grok-4.7" } }, ...extra });
  const call = { type: "tool-call", id: "c1", name: "bash", arguments: "{}" };

  it("聊天回合：模型那一步只留调用了什么和思考；最后的回答那一步不再带回答", () => {
    const log = new ActivityLog(undefined, "grok-4.7", { chat: true });
    log.apply("assistant/message", msg(1, [{ type: "reasoning", text: "看目录" }, { type: "text", text: "我先看看下载目录里有什么。" }, call]), T0);
    expect(log.last).toMatchObject({ kind: "model", summary: "调用 bash" });
    expect(log.last!.output).toContain("看目录");
    expect(log.last!.output).not.toContain("我先看看");
    log.apply("assistant/message", msg(2, [{ type: "text", text: "整理好了。" }]), T0 + 10);
    expect(log.last!.summary).toBeUndefined();
    expect(log.last!.output).toBeUndefined();
  });

  it("被打断的那一步说的话不进对话：步骤里照旧留着；任务（不是聊天）的步骤照旧", () => {
    const log = new ActivityLog(undefined, "grok-4.7", { chat: true });
    log.apply("assistant/message", msg(1, [{ type: "text", text: "说到一半" }, call], { interrupted: true }), T0);
    expect(log.last!.summary).toBe("说到一半");
    const task = new ActivityLog(undefined, "grok-4.7");
    task.apply("assistant/message", msg(1, [{ type: "text", text: "我先看看。" }, call]), T0);
    expect(task.last!.summary).toBe("我先看看。");
  });

  it("interimText：只认带工具调用、没被打断的那一步的文字", () => {
    expect(interimText(msg(1, [{ type: "text", text: " 我先看看。 " }, call]))).toBe("我先看看。");
    expect(interimText(msg(1, [{ type: "text", text: "最后的回答" }]))).toBe("");
    expect(interimText(msg(1, [{ type: "text", text: "半句" }, call], { interrupted: true }))).toBe("");
    expect(interimText(msg(1, [call]))).toBe("");
  });
});
