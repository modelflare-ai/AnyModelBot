/**
 * 网页对话进行中的消息：切走 / 刷新后接上（GET /chat 的 live、GET /chat/live），以及停止在各种状态下都真的停下来。
 * 真实 App + Web 服务（外部模型端点、纯对话模式）+ 能"卡住"的模拟模型；代理路径用假的 AgentManager 测运行时。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { BotRuntime } from "../src/core/runtime.js";
import { Store } from "../src/store/db.js";
import { TurnStopped } from "../src/agent/host.js";
import { DEFAULT_SETTINGS } from "../src/agent/settings.js";
import type { AgentManager } from "../src/agent/manager.js";
import type { InboundEvent, OutboundOp } from "../src/core/types.js";
import { listen, until } from "./helpers.js";

/** 读 SSE：事件陆续进 events，done 在流结束时 resolve；abort 模拟切走（断开连接） */
function sseStream(url: string, init: RequestInit = {}) {
  const ac = new AbortController();
  const events: Array<[string, any]> = [];
  const done = (async () => {
    const res = await fetch(url, { ...init, signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    let buf = "";
    const dec = new TextDecoder();
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev && data) events.push([ev, JSON.parse(data)]);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") throw e;
    }
  })();
  return {
    events,
    done,
    abort: () => ac.abort(),
    texts: () => events.filter(([e]) => e === "text").map(([, d]) => d.text as string),
    names: () => events.map(([e]) => e),
  };
}

describe("网页对话：进行中的消息（纯对话）", () => {
  let app: App;
  let base: string;
  let llm: Awaited<ReturnType<typeof listen>>;
  /** 收到的每个模型请求：最后一条用户消息、是否被中途断开 */
  const calls: Array<{ user: string; aborted: boolean; released: boolean }> = [];
  /** HOLD 开头的消息一直慢慢出字，直到 release() */
  const release = () => calls.forEach((c) => (c.released = true));
  const conv = encodeURIComponent("default:web:console");

  beforeAll(async () => {
    llm = await listen(async (req, res) => {
      if (req.url?.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-slow", object: "model" }] }));
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const b = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const user = String(b.messages?.at(-1)?.content ?? "");
      const call = { user, aborted: false, released: false };
      calls.push(call);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.on("close", () => {
        if (!res.writableEnded) call.aborted = true;
      });
      const send = (t: string) => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      if (user.startsWith("HOLD")) {
        for (let n = 1; !call.released && !call.aborted; n++) {
          send(`第${n}段。`);
          await new Promise((r) => setTimeout(r, 40));
        }
        if (call.aborted) return;
        send("完。");
      } else send(`好的：${user}`);
      res.end("data: [DONE]\n\n");
    });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-live-"));
    app = new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "k", AMB_UI_PORT: "0", AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } }), {
      printQrToTerminal: false,
    });
    await app.start();
    base = app.web!.url.replace(/\/$/, "") + "/amb/api";
  });
  afterAll(async () => {
    release();
    await app?.stop();
    await llm?.close();
  });

  const api = async (p: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(base + p, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "content-type": "application/json" } : {},
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  const post = (text: string) => sseStream(base + "/bots/default/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const attach = (turn = "") => sseStream(base + `/bots/default/chat/live${turn ? `?turn=${turn}` : ""}`);
  const stop = () => api(`/conversations/${conv}/stop`, { method: "POST", body: {} });
  const history = async () => ((await api("/bots/default/chat")).json.messages as any[]).map((m) => [m.role, m.content]);

  it("切走再切回：GET /chat 的 live 有用户消息和到目前为止的回复；接上后先 snapshot、再更新、最后 done；历史里各一次", async () => {
    const s = post("HOLD 第一条");
    await until(() => s.texts().length >= 2);
    const d = (await api("/bots/default/chat")).json;
    expect(d.live).toHaveLength(1);
    const t = d.live[0];
    expect(t).toMatchObject({ userText: "HOLD 第一条", stopping: false, steps: [], prompts: [], files: [] });
    expect(t.text).toMatch(/^第1段。/);
    expect(Date.now() - t.startedAt).toBeLessThan(10_000);
    // 纯对话路径先存了用户消息：进行中时由 live 显示，历史里不重复
    expect(d.messages.map((m: any) => m.content)).not.toContain("HOLD 第一条");
    // 侧栏"正在工作"
    expect((await api("/agent")).json.busy).toEqual(["default"]);

    // 切走：断开发消息的请求，消息照常处理（不中止模型请求）
    s.abort();
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.at(-1)!.aborted).toBe(false);

    const a = attach(t.id);
    await until(() => a.events.length >= 1);
    expect(a.events[0][0]).toBe("snapshot");
    expect(a.events[0][1]).toMatchObject({ id: t.id, userText: "HOLD 第一条", startedAt: t.startedAt });
    expect(a.events[0][1].text.length).toBeGreaterThan(t.text.length);
    const n = a.texts().length;
    await until(() => a.texts().length >= n + 2);
    release();
    await a.done;
    expect(a.events.at(-1)).toEqual(["done", { conversationId: "default:web:console" }]);
    const final = a.texts().at(-1)!;
    expect(final).toMatch(/完。$/);
    expect(calls.at(-1)!.aborted).toBe(false);

    const after = (await api("/bots/default/chat")).json;
    expect(after.live).toEqual([]);
    const h = after.messages.map((m: any) => [m.role, m.content]);
    expect(h.filter(([, c]: string[]) => c === "HOLD 第一条")).toHaveLength(1);
    expect(h.slice(-2)).toEqual([
      ["user", "HOLD 第一条"],
      ["assistant", final],
    ]);
    expect((await api("/agent")).json.busy).toEqual([]);
  });

  it("接上一条已经结束的：直接 done", async () => {
    const a = attach("no-such-turn");
    await a.done;
    expect(a.events).toEqual([["done", { conversationId: "default:web:console", ended: true }]]);
  });

  it("停止：发消息的请求已经断开（切走、刷新）也能中止模型请求；已生成的部分保留并注明已中止", async () => {
    const before = calls.length;
    const s = post("HOLD 停下");
    await until(() => s.texts().length >= 2);
    s.abort();
    const a = attach();
    await until(() => a.events.length >= 1);
    const r = await stop();
    expect(r).toEqual({ status: 200, json: { stopped: true } });
    await a.done;
    expect(a.names()).toContain("stopping");
    expect(a.events.at(-1)![0]).toBe("done");
    const final = a.texts().at(-1)!;
    expect(final).toMatch(/^第1段。.*\n\n（已中止）$/s);
    await until(() => calls[before].aborted, 3000);
    expect(calls).toHaveLength(before + 1);
    const h = await history();
    expect(h.slice(-2)).toEqual([
      ["user", "HOLD 停下"],
      ["assistant", final],
    ]);
    expect((await stop()).json.stopped).toBe(false);
    // 停止要 JSON 请求体（界面以前不带，一直 415）
    expect((await fetch(base + `/conversations/${conv}/stop`, { method: "POST" })).status).toBe(415);
  });

  it("停止：还没出字就停，回复是一句已中止", async () => {
    const s = post("HOLD 马上停");
    await until(async () => (await api("/bots/default/chat")).json.live.length === 1);
    await stop();
    await s.done;
    expect(s.texts().at(-1)).toMatch(/^(已中止（处理了 \d+ 秒）。|第1段。\n\n（已中止）)$/);
    expect(s.events.at(-1)![0]).toBe("done");
  });

  it("停止：排在后面的消息一起停，它不会再发给模型", async () => {
    const before = calls.length;
    const a = post("HOLD 前一条");
    await until(() => a.texts().length >= 1);
    const b = post("排队的那条");
    await until(async () => (await api("/bots/default/chat")).json.live.length === 2);
    const live = (await api("/bots/default/chat")).json.live;
    expect(live.map((t: any) => t.userText)).toEqual(["HOLD 前一条", "排队的那条"]);
    expect((await stop()).json.stopped).toBe(true);
    await Promise.all([a.done, b.done]);
    expect(a.texts().at(-1)).toMatch(/（已中止）$/);
    expect(b.texts().at(-1)).toMatch(/^已中止（处理了 \d+ 秒）。$/);
    expect(b.names()).toContain("stopping");
    expect(calls).toHaveLength(before + 1);
    const h = await history();
    expect(h.slice(-4).map(([r, c]: string[]) => [r, c.replace(/\d+ 秒/, "N 秒")])).toEqual([
      ["user", "HOLD 前一条"],
      ["assistant", a.texts().at(-1)!],
      ["user", "排队的那条"],
      ["assistant", "已中止（处理了 N 秒）。"],
    ]);
    // 停完会话照常能用
    const c = post("还在吗");
    await c.done;
    expect(c.texts().at(-1)).toBe("好的：还在吗");
  });

  it("/stop：微信等渠道的纯对话也能停（以前只停代理回合）", async () => {
    const ev = (id: string, text: string): InboundEvent => ({ id, channel: "weixin", botId: "default", conversation: { kind: "dm", id: "wx-1" }, sender: { id: "wx-1" }, parts: [{ type: "text", text }], replyHandle: {}, receivedAt: Date.now() });
    const out: string[] = [];
    const before = calls.length;
    const p = app.runtime.handle(ev("w1", "HOLD 微信"), { apply: async (op: OutboundOp) => void (op.type === "stream.finish" && out.push(op.text)) });
    await until(() => calls.length === before + 1);
    expect(app.runtime.busyBots()).toEqual(["default"]);
    expect(app.runtime.interceptReply(ev("w2", "/stop")).ack).toMatch(/^正在中止上一条消息（已处理 \d+ 秒）…$/);
    await p;
    expect(out.at(-1)).toMatch(/（已中止）$|^已中止/);
    await until(() => calls[before].aborted, 3000);
    expect(app.runtime.interceptReply(ev("w3", "/stop")).ack).toBe("当前没有正在处理的消息。");
  });

  it("网页里的 /stop 同样停下进行中的消息", async () => {
    const s = post("HOLD 用命令停");
    await until(() => s.texts().length >= 1);
    const r = await api("/bots/default/chat", { method: "POST", body: { text: "/stop" } });
    expect(r.json.reply).toMatch(/^正在中止上一条消息/);
    await s.done;
    expect(s.texts().at(-1)).toMatch(/（已中止）$/);
  });
});

// —— 代理路径：用假的 AgentManager，覆盖"代理还在启动""排队时就停了""回合进行中"三种状态 ——
describe("运行时的停止（代理路径）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-stop-"));
  const ev = (text: string): InboundEvent => ({ id: Math.random().toString(36), channel: "web", botId: "b1", conversation: { kind: "dm", id: "console" }, sender: { id: "owner" }, parts: [{ type: "text", text }], replyHandle: {}, receivedAt: Date.now() });

  function setup(hostState: "running" | "starting") {
    const store = new Store(path.join(dir, `${Math.random().toString(36).slice(2)}.db`));
    store.createBot({ id: "b1", name: "测试" });
    const turns = new Map<string, any>();
    const seen = { runTurn: 0, stopTurn: 0 };
    let halt: ((e: Error) => void) | undefined;
    const host = { state: hostState as string, workspace: dir, diagnostics: () => ({}), ensure: () => new Promise<void>(() => {}) };
    const agent = {
      available: true,
      host: () => host,
      approvals: { bindSink: () => () => {}, handleReply: () => ({ handled: false }), pending: () => [] },
      turnsInProgress: turns,
      settings: () => DEFAULT_SETTINGS,
      memoryPrefix: () => "",
      takeSeed: () => "",
      runTurn: (_bot: string, input: any) => {
        seen.runTurn++;
        const t = { since: Date.now(), activity: { steps: [] } };
        turns.set(input.conversationId, t);
        return new Promise((_, rej) => (halt = rej)).finally(() => turns.delete(input.conversationId));
      },
      stopTurn: (conv: string) => {
        seen.stopTurn++;
        const t = turns.get(conv);
        if (!t) return false;
        halt?.(new TurnStopped("user", Date.now() - t.since));
        return true;
      },
    } as unknown as AgentManager;
    const models = { listModels: async () => ["m1"], streamChat: async () => "纯对话" };
    const rt = new BotRuntime({ store, models: models as any, defaultModel: () => "m1", contextMessages: 20, contextChars: 20_000, agent });
    const ops: OutboundOp[] = [];
    const out = { apply: async (op: OutboundOp) => void ops.push(op) };
    const texts = () => ops.filter((o): o is Extract<OutboundOp, { text: string }> => "text" in o).map((o) => o.text);
    const history = () => store.listMessages("b1:web:console").map((m) => [m.role, m.content.replace(/\d+ 秒/, "N 秒")]);
    return { rt, store, seen, out, texts, history, turns };
  }

  it("代理还在启动：停止立刻收尾，消息不交给代理（以前要等满 90 秒，期间 stop 返回 false）", async () => {
    const { rt, seen, out, texts, history } = setup("starting");
    const ac = new AbortController();
    const p = rt.handle(ev("你好"), out, { signal: ac.signal });
    await until(() => texts().some((t) => t.startsWith("代理正在启动")));
    const t0 = Date.now();
    ac.abort();
    await p;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(texts().at(-1)).toMatch(/^已中止（处理了 \d+ 秒）。$/);
    expect(seen.runTurn).toBe(0);
    expect(history()).toEqual([
      ["user", "你好"],
      ["assistant", "已中止（处理了 N 秒）。"],
    ]);
  });

  it("代理还在启动：/stop 也能停", async () => {
    const { rt, seen, out, texts } = setup("starting");
    const p = rt.handle(ev("你好"), out);
    await until(() => texts().some((t) => t.startsWith("代理正在启动")));
    expect(rt.busyBots()).toEqual(["b1"]);
    expect(rt.interceptReply(ev("/stop")).ack).toMatch(/^正在中止上一条消息（已处理 \d+ 秒）…$/);
    await p;
    expect(texts().at(-1)).toMatch(/^已中止/);
    expect(seen.runTurn).toBe(0);
    expect(rt.busyBots()).toEqual([]);
  });

  it("回合进行中：停止交给代理中止（stopTurn），回复是已中止", async () => {
    const { rt, seen, out, texts, turns } = setup("running");
    const ac = new AbortController();
    const p = rt.handle(ev("干活"), out, { signal: ac.signal });
    await until(() => turns.size === 1);
    ac.abort();
    await p;
    expect(seen.stopTurn).toBe(1);
    expect(texts().at(-1)).toMatch(/^已中止（处理了 \d+ 秒）。可以继续发消息。$/);
  });

  it("排队时就停了：不处理、命令也不执行，消息记成已中止", async () => {
    const { rt, seen, out, texts, history, store } = setup("running");
    store.ensureConversation("b1", "web", "console", "x");
    store.addMessage("b1:web:console", "user", "旧消息");
    const ac = new AbortController();
    ac.abort();
    await rt.handle(ev("/reset"), out, { signal: ac.signal });
    expect(history()).toEqual([["user", "旧消息"]]);
    await rt.handle(ev("新消息"), out, { signal: ac.signal });
    expect(seen.runTurn).toBe(0);
    expect(texts()).toEqual([expect.stringMatching(/^已中止/), expect.stringMatching(/^已中止/)]);
    expect(history()).toEqual([
      ["user", "旧消息"],
      ["user", "新消息"],
      ["assistant", "已中止（处理了 N 秒）。"],
    ]);
  });
});
