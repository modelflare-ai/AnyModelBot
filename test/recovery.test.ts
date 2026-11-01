/**
 * 重启恢复：应用退出或崩溃时还在处理的消息，下次启动在原会话里说一次「没处理完，请重新发送」，不自动重发。
 * 运行时：标记的写入、清除，以及退出时被打断的回合；App：启动时经网页 / 微信（context_token、配额）/ 飞书告诉用户，
 * 发不出去的等那个会话的下一条消息。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AgentManager } from "../src/agent/manager.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import { BotRuntime } from "../src/core/runtime.js";
import { deferNotice, interruptedText, markInflight, previewOf, takeInterrupted, takeNotice } from "../src/core/recovery.js";
import type { InboundEvent, OutboundOp } from "../src/core/types.js";
import { Store } from "../src/store/db.js";
import { FakeFeishu, mockIlink, mockOpenAI, until } from "./helpers.js";

describe("重启标记", () => {
  it("每个会话一个标记，启动时取走一次；提醒里带上那条消息的开头", () => {
    const store = new Store(":memory:");
    markInflight(store, "b:web:console", "帮我把这份很长很长的周报整理成三段，每段不超过一百字，然后发给老板", 100);
    markInflight(store, "b:web:console", "第二条", 200);
    markInflight(store, "b:weixin:u1", "\n  你好\n第二行", 300);
    expect(takeInterrupted(store)).toEqual([
      { conversationId: "b:web:console", at: 100, preview: "帮我把这份很长很长的周报整理成三段，每段不超过一百字，然后…" },
      { conversationId: "b:weixin:u1", at: 300, preview: "你好" },
    ]);
    expect(takeInterrupted(store)).toEqual([]);
    expect(interruptedText("你好")).toBe("上次的消息「你好」因为应用重启没有处理完，请重新发送。");
    expect(interruptedText(previewOf(""))).toBe("上次的消息因为应用重启没有处理完，请重新发送。");
    deferNotice(store, "b:weixin:u1", "提醒");
    expect(takeNotice(store, "b:weixin:u1")).toBe("提醒");
    expect(takeNotice(store, "b:weixin:u1")).toBe("");
    store.close();
  });
});

describe("运行时：处理中留标记，处理完清掉；退出时被打断的不回复、标记留着", () => {
  const ev = (text: string): InboundEvent => ({
    id: Math.random().toString(36),
    channel: "web",
    botId: "b1",
    conversation: { kind: "dm", id: "console" },
    sender: { id: "owner" },
    parts: [{ type: "text", text }],
    replyHandle: {},
    receivedAt: Date.now(),
  });
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-recovery-"));
    const store = new Store(path.join(dir, "a.db"));
    store.createBot({ id: "b1", name: "测试" });
    let finish: { ok: (v: unknown) => void; fail: (e: Error) => void } | undefined;
    const inputs: string[] = [];
    const host = { state: "running", workspace: dir, diagnostics: () => ({}), ensure: async () => {} };
    const agent = {
      available: true,
      host: () => host,
      approvals: { bindSink: () => () => {}, handleReply: () => ({ handled: false }), pending: () => [] },
      turnsInProgress: new Map(),
      settings: () => DEFAULT_SETTINGS,
      memoryPrefix: () => "",
      takeSeed: () => "",
      runTurn: (_bot: string, input: any) => {
        inputs.push(input.text);
        return new Promise((ok, fail) => (finish = { ok, fail }));
      },
      stopTurn: () => false,
      // 回合进行中来的消息都能并进去
      canSteer: () => true,
      steer: async () => true,
    } as unknown as AgentManager;
    const models = { listModels: async () => ["m1"], streamChat: async () => "纯对话" };
    const rt = new BotRuntime({ store, models: models as any, defaultModel: () => "m1", contextMessages: 20, contextChars: 20_000, agent });
    const ops: OutboundOp[] = [];
    const out = { apply: async (op: OutboundOp) => void ops.push(op) };
    const texts = () => ops.filter((o): o is Extract<OutboundOp, { text: string }> => "text" in o).map((o) => o.text);
    const marked = () => store.listKV("inflight:").map(([k]) => k);
    return { rt, store, out, texts, marked, inputs, finish: () => finish! };
  }

  it("处理完（成功或失败并回复了）就清掉标记", async () => {
    const { rt, out, texts, marked, inputs, finish } = setup();
    let p = rt.handle(ev("你好"), out);
    await until(() => inputs.length === 1);
    expect(marked()).toEqual(["inflight:b1:web:console"]);
    finish().ok({ text: "好的", sessionId: "s", files: [], usage: { tokens: 1, window: 1, maxTokens: 1 } });
    await p;
    expect(texts().at(-1)).toBe("好的");
    expect(marked()).toEqual([]);
    p = rt.handle(ev("再来"), out);
    await until(() => inputs.length === 2);
    finish().fail(new Error("runtime closed"));
    await p;
    expect(texts().at(-1)).toMatch(/没有处理完，请重新发送/);
    expect(marked()).toEqual([]);
  });

  /** 渠道关"正在输入"要等一次网络请求（微信 sendtyping）：卡住它，看标记是不是在收尾之前就清了 */
  function slowTypingOff() {
    let unblock!: () => void;
    const blocked = new Promise<void>((r) => (unblock = r));
    const ops: OutboundOp[] = [];
    const out = {
      apply: async (op: OutboundOp) => {
        ops.push(op);
        if (op.type === "typing" && !op.on) await blocked;
      },
    };
    return { out, ops, unblock, typingOff: () => ops.some((o) => o.type === "typing" && !o.on) };
  }
  const done = { text: "好的", sessionId: "s", files: [], usage: { tokens: 1, window: 1, maxTokens: 1 } };

  it("回复交给渠道就清掉标记，不等收尾：关「正在输入」时崩溃，下次启动不会误报没处理完；并进这一轮的消息随它一起答完", async () => {
    const { rt, marked, inputs, finish } = setup();
    const s = slowTypingOff();
    const first = rt.handle(ev("整理周报"), s.out);
    await until(() => inputs.length === 1);
    // 第二条并进进行中的这一轮：它的回复就是这一轮的回复
    const steered = rt.handle(ev("顺便加一段总结"), s.out);
    await until(() => s.ops.some((o) => o.type === "text" && o.ack));
    finish().ok(done);
    await until(s.typingOff);
    expect(s.ops.find((o) => o.type === "stream.finish")).toMatchObject({ text: "好的" });
    expect(marked()).toEqual([]);
    s.unblock();
    await Promise.all([first, steered]);
    expect(marked()).toEqual([]);
  });

  it("这一轮答完时会话里还有排着、没答的消息：标记留着，等它也答完", async () => {
    const { rt, marked, inputs, finish } = setup();
    const s = slowTypingOff();
    const first = rt.handle(ev("整理周报"), s.out);
    await until(() => inputs.length === 1);
    // 命令不并入进行中的回合，排在它后面
    const queued = rt.handle(ev("/help"), s.out);
    finish().ok(done);
    await until(s.typingOff);
    expect(marked()).toEqual(["inflight:b1:web:console"]);
    s.unblock();
    await Promise.all([first, queued]);
    expect(s.ops.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("/help") });
    expect(marked()).toEqual([]);
  });

  it("应用退出时代理进程被关掉：不回复、不改用纯对话，标记留给下次启动；第一条消息带着渠道", async () => {
    const { rt, store, out, texts, marked, inputs, finish } = setup();
    const p = rt.handle(ev("整理周报"), out);
    await until(() => inputs.length === 1);
    expect(inputs[0]).toMatch(/^\[对话渠道\]\n本机网页对话/);
    rt.shutdown();
    finish().fail(new Error("runtime closed"));
    await p;
    expect(texts().filter((t) => !t.startsWith("代理"))).toEqual([]);
    expect(marked()).toEqual(["inflight:b1:web:console"]);
    expect(takeInterrupted(store)[0].preview).toBe("整理周报");
  });
});

describe("App 启动时告诉用户", () => {
  let llm: Awaited<ReturnType<typeof mockOpenAI>>;
  let ilink: Awaited<ReturnType<typeof mockIlink>>;
  let app: App;
  const feishu = new (class extends FakeFeishu {
    sent: Array<{ chatId: string; text: string }> = [];
    async sendText(chatId: string, text: string) {
      this.sent.push({ chatId, text });
    }
  })();

  beforeAll(async () => {
    llm = await mockOpenAI({ key: "gw-key" });
    ilink = await mockIlink();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-recovery-app-"));
    // 上次运行留下的：机器人、会话、微信登录与两个联系人（alice 有配额，bob 的 24 小时窗口过了），以及四个没处理完的标记
    const store = new Store(path.join(dataDir, "anymodel.db"));
    store.createBot({ id: "default", name: "我的助手", feishuAppId: "cli_x", feishuAppSecret: "sec", weixinEnabled: true });
    store.saveWeixinAccount({ botId: "default", botToken: "tok-secret-123", ilinkBotId: "bot@im.bot", baseUrl: ilink.url, ownerUserId: "alice@im.wechat" });
    store.upsertWeixinPeer({ botId: "default", userId: "alice@im.wechat", contextToken: "ctx-alice", quotaRemaining: 10, windowStartedAt: Date.now() });
    store.upsertWeixinPeer({ botId: "default", userId: "bob@im.wechat", contextToken: "ctx-bob", quotaRemaining: 10, windowStartedAt: Date.now() - 25 * 3600_000 });
    for (const [channel, peer, text] of [
      ["web", "console", "网页里的长任务"],
      ["weixin", "alice@im.wechat", "微信里的长任务"],
      ["weixin", "bob@im.wechat", "隔天的任务"],
      ["feishu", "oc_x", "飞书里的长任务"],
    ]) {
      const conv = store.ensureConversation("default", channel, peer, peer, "dm");
      markInflight(store, conv.id, text);
    }
    store.close();
    const config = loadConfig({
      dataDir,
      env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilink.url, AMB_WEIXIN_CDN_BASE: ilink.cdnBase, AMB_AGENT: "off" },
    });
    app = new App(config, { feishuTransport: () => feishu, weixinPollTimeoutMs: 1000, printQrToTerminal: false, noWeb: true });
    // 只有主人和允许名单里的人能用：bob 上次就在用（这里的库是直接造的，没有经过升级迁移）
    app.access.allow("default", "weixin", "bob@im.wechat", "test");
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
    await llm?.close();
    await ilink?.close();
  });

  it("网页记进会话历史，微信用存下的 context_token，飞书发到原单聊；只说一次，不重发原消息", async () => {
    await until(() => ilink.state.sent.length >= 1 && feishu.sent.length >= 1);
    expect(app.store.listMessages("default:web:console").map((m) => [m.role, m.content])).toEqual([["assistant", "上次的消息「网页里的长任务」因为应用重启没有处理完，请重新发送。"]]);
    expect(ilink.state.sent).toEqual([{ to: "alice@im.wechat", contextToken: "ctx-alice", text: "上次的消息「微信里的长任务」因为应用重启没有处理完，请重新发送。" }]);
    // 先发出去，再扣配额：等它扣完
    await until(() => app.store.getWeixinPeer("default", "alice@im.wechat")!.quotaRemaining === 9);
    expect(feishu.sent).toEqual([{ chatId: "oc_x", text: "上次的消息「飞书里的长任务」因为应用重启没有处理完，请重新发送。" }]);
    expect(app.store.listKV("inflight:")).toEqual([]);
    expect(llm.calls).toEqual([]);
  });

  it("微信过了 24 小时窗口发不出去：等这个人发下一条消息时先说，再回答新消息", async () => {
    expect(ilink.state.sent.some((s) => s.to === "bob@im.wechat")).toBe(false);
    ilink.push("bob@im.wechat", "在吗", "ctx-bob-2");
    await until(() => ilink.state.sent.filter((s) => s.to === "bob@im.wechat").length >= 2, 8000);
    const toBob = ilink.state.sent.filter((s) => s.to === "bob@im.wechat");
    expect(toBob[0]).toEqual({ to: "bob@im.wechat", contextToken: "ctx-bob-2", text: "上次的消息「隔天的任务」因为应用重启没有处理完，请重新发送。" });
    expect(toBob[1].text).toContain("在吗");
    // 原消息没有被重发给模型
    expect(JSON.stringify(llm.calls)).not.toContain("隔天的任务");
    expect(app.store.listKV("notice:")).toEqual([]);
  });
});
