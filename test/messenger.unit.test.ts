/**
 * Telegram、Slack、Discord：格式转换、切段、出站发送、流式回复，以及三个传输层对平台接口的用法。
 * 平台都是本地假的（假 fetch、本地 WebSocket 服务器）；没有连过真实平台。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { MessengerReply, deliverMessenger, messengerParts } from "../src/channels/messenger/channel.js";
import { DiscordTransport, discordMessage } from "../src/channels/messenger/discord.js";
import { fenceTables, splitMarkdown, toSlackMrkdwn, toTelegramHtml } from "../src/channels/messenger/format.js";
import { SlackTransport, slackMessage } from "../src/channels/messenger/slack.js";
import { TelegramTransport, telegramMessage } from "../src/channels/messenger/telegram.js";
import { PlatformError, type MessengerMessage } from "../src/channels/messenger/transport.js";
import type { OutboxRow } from "../src/store/db.js";
import { FakeMessenger, listen, messengerEvent, until } from "./helpers.js";

const noDownload = async () => Buffer.alloc(0);
const row = (o: Partial<OutboxRow>) => ({ id: "r1", kind: "text", peerId: "c1", replyTo: "", progress: 0, attempts: 0, body: {}, ...o }) as OutboxRow;

describe("格式转换", () => {
  it("Telegram：常见的 Markdown 转成 HTML，尖括号转义，代码里的星号不算强调", () => {
    expect(toTelegramHtml("# 标题\n**粗** *斜* ~~删~~ `a*b*c`")).toBe("<b>标题</b>\n<b>粗</b> <i>斜</i> <s>删</s> <code>a*b*c</code>");
    expect(toTelegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    expect(toTelegramHtml("- 一\n- 二")).toBe("• 一\n• 二");
    expect(toTelegramHtml("[官网](https://anymodel.bot/)")).toBe('<a href="https://anymodel.bot/">官网</a>');
    expect(toTelegramHtml("```ts\nconst a = 1 < 2;\n```\n之后")).toBe("<pre>const a = 1 &lt; 2;</pre>\n之后");
  });

  it("Telegram：没关上的代码块算到结尾（流式显示时常见）；变量名里的下划线不算斜体", () => {
    expect(toTelegramHtml("开始\n```\ncode")).toBe("开始\n<pre>code</pre>");
    expect(toTelegramHtml("snake_case_name 和 2*3*4")).toBe("snake_case_name 和 2*3*4");
  });

  it("Slack：粗体是单星号、斜体是下划线、链接是 <url|文字>，不把粗体再转成斜体", () => {
    expect(toSlackMrkdwn("**粗** *斜* ~~删~~")).toBe("*粗* _斜_ ~删~");
    expect(toSlackMrkdwn("## 标题")).toBe("*标题*");
    expect(toSlackMrkdwn("[官网](https://anymodel.bot/)")).toBe("<https://anymodel.bot/|官网>");
    expect(toSlackMrkdwn("a<b & `x**y**`")).toBe("a&lt;b &amp; `x**y**`");
    expect(toSlackMrkdwn("```js\nlet a;\n```")).toBe("```\nlet a;\n```");
  });

  it("表格放进代码块，代码块里的不动", () => {
    expect(fenceTables("前\n| a | b |\n|---|---|\n| 1 | 2 |\n后")).toBe("前\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n后");
    const inCode = "```\n| a | b |\n|---|---|\n```";
    expect(fenceTables(inCode)).toBe(inCode);
    expect(fenceTables("a | b\nc | d")).toBe("a | b\nc | d");
  });

  it("切段：每段不超上限；切在代码块中间时收好这段、下一段重新打开；同样的文字切法不变", () => {
    const text = "```ts\n" + Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") + "\n```\n\n结尾";
    const chunks = splitMarkdown(text, 200);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect((c.match(/^```/gm) ?? []).length % 2).toBe(0);
    }
    expect(chunks[1].startsWith("```ts\n")).toBe(true);
    expect(chunks.at(-1)).toContain("结尾");
    expect(splitMarkdown(text, 200)).toEqual(chunks);
    expect(splitMarkdown("", 200)).toEqual([]);
  });
});

describe("出站发送", () => {
  it("有流式消息：第一段改写它，后面几段发新消息，都记下进度", async () => {
    const t = new FakeMessenger("telegram", 100);
    const done: number[] = [];
    await deliverMessenger(t, row({ body: { text: "第一段".repeat(20) + "\n\n" + "第二段".repeat(20), editId: "9" } }), (n) => done.push(n));
    expect(t.edits).toHaveLength(1);
    expect(t.edits[0].id).toBe("9");
    expect(t.sent).toHaveLength(1);
    expect(done).toEqual([1, 2]);
  });

  it("崩溃后重发：从下一段接着发，不再改写", async () => {
    const t = new FakeMessenger("telegram", 100);
    await deliverMessenger(t, row({ progress: 1, body: { text: "第一段".repeat(20) + "\n\n" + "第二段".repeat(20), editId: "9" } }), () => {});
    expect(t.edits).toEqual([]);
    expect(t.sent.map((s) => s.text.slice(0, 3))).toEqual(["第二段"]);
  });

  it("流式消息改不了了（平台拒绝）：发新的；网络问题：抛出去，出站队列会重试", async () => {
    const t = new FakeMessenger();
    t.failEdit = new PlatformError("message to edit not found", true);
    await deliverMessenger(t, row({ body: { text: "答案", editId: "9" } }), () => {});
    expect(t.sent.map((s) => s.text)).toEqual(["答案"]);

    const t2 = new FakeMessenger();
    t2.failEdit = new Error("fetch failed");
    await expect(deliverMessenger(t2, row({ body: { text: "答案", editId: "9" } }), () => {})).rejects.toThrow("fetch failed");
    expect(t2.sent).toEqual([]);
  });

  it("文件发不出去：网络问题先重试，平台拒绝直接改发一句说明", async () => {
    const t = new FakeMessenger();
    t.sendFile = async () => {
      throw new Error("socket hang up");
    };
    const r = row({ kind: "file", body: { path: "/x.pdf", name: "x.pdf" } });
    await expect(deliverMessenger(t, r, () => {})).rejects.toThrow("socket hang up");
    await deliverMessenger(t, { ...r, attempts: 2 }, () => {});
    expect(t.sent[0].text).toContain("x.pdf");

    const t2 = new FakeMessenger();
    t2.sendFile = async () => {
      throw new PlatformError("too big", true);
    };
    await deliverMessenger(t2, r, () => {});
    expect(t2.sent[0].text).toContain("x.pdf");
  });
});

describe("流式回复", () => {
  it("等第一句话时只显示正在输入；开始说话后发一条再改写；结束时写成最终回复，不多发消息", async () => {
    const t = new FakeMessenger();
    const r = new MessengerReply(t, "c1", 5);
    await r.apply({ type: "typing", on: true });
    expect(t.typed).toBe(1);
    await r.apply({ type: "stream.start" });
    expect(t.sent).toEqual([]);
    await r.apply({ type: "stream.update", text: "你" });
    await until(() => t.sent.length === 1);
    await r.apply({ type: "stream.update", text: "你好" });
    await until(() => t.edits.length === 1);
    await r.apply({ type: "stream.finish", text: "你好，世界" });
    await r.apply({ type: "typing", on: false });
    expect(t.sent).toHaveLength(1);
    expect(t.lastShown("c1")).toBe("你好，世界");
  });

  it("没有正在输入的平台：先发一条占位，最终回复改写它", async () => {
    const t = new FakeMessenger("slack");
    t.typing = undefined as never;
    const r = new MessengerReply(t, "c1", 5);
    await r.apply({ type: "stream.start" });
    await until(() => t.sent.length === 1);
    expect(t.sent[0].text).toBe("…");
    await r.apply({ type: "stream.finish", text: "答案" });
    expect(t.sent).toHaveLength(1);
    expect(t.lastShown("c1")).toBe("答案");
  });

  it("回合中间说的话留在最终回复前面；最后一句和回复一样时不重复", async () => {
    const t = new FakeMessenger();
    const r = new MessengerReply(t, "c1", 100_000);
    await r.apply({ type: "interim", text: "先看看" });
    await r.apply({ type: "interim", text: "看完了" });
    await r.apply({ type: "stream.finish", text: "看完了" });
    expect(t.sent.map((s) => s.text)).toEqual(["先看看\n\n看完了"]);
  });

  it("审批提示发文字", async () => {
    const t = new FakeMessenger();
    await new MessengerReply(t, "c1", 5).apply({ type: "interactive", kind: "ask_user", prompt: "选哪个", options: ["甲", "乙"] });
    expect(t.sent[0].text).toContain("1. 甲");
  });
});

describe("收到的消息", () => {
  it("引用、文字、文件变成 parts；图片按文件头认格式；下载失败写明原因；语音不下载", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const img = { type: "image" as const, download: noDownload };
    const bad = { type: "file" as const, name: "a.pdf", download: noDownload };
    const voice = { type: "voice" as const, download: noDownload };
    const m = messengerEvent("看图", { quote: "原话", files: [img, bad, voice] });
    expect(messengerParts(m, new Map<any, Buffer | Error>([[img, png], [bad, new Error("too big")]]))).toEqual([
      { type: "quote", text: "原话" },
      { type: "text", text: "看图" },
      { type: "image", data: png, mime: "image/png" },
      { type: "file", name: "a.pdf", error: "too big" },
      { type: "voice" },
    ]);
  });

  it("Telegram：取最大的照片；/start 换成 /help；群里的标出来；贴纸说明不支持", async () => {
    const got: string[] = [];
    const base = { message_id: 7, chat: { id: 42, type: "private" }, from: { id: 1, first_name: "Ann", last_name: "Lee" } };
    const m = telegramMessage({ message: { ...base, caption: "这张", photo: [{ file_id: "small" }, { file_id: "big" }] } }, async (id) => (got.push(id), Buffer.alloc(0)))!;
    expect(m).toMatchObject({ id: "42:7", chatId: "42", dm: true, senderId: "1", senderName: "Ann Lee", text: "这张" });
    await m.files[0].download();
    expect(got).toEqual(["big"]);
    expect(telegramMessage({ message: { ...base, text: "/start" } }, noDownload)!.text).toBe("/help");
    expect(telegramMessage({ message: { ...base, text: "/startup 别动" } }, noDownload)!.text).toBe("/startup 别动");
    expect(telegramMessage({ message: { ...base, chat: { id: -5, type: "group" }, text: "hi" } }, noDownload)!.dm).toBe(false);
    expect(telegramMessage({ message: { ...base, sticker: { file_id: "s" } } }, noDownload)!.unsupported).toBe("sticker");
    expect(telegramMessage({ message: { ...base, text: "好", reply_to_message: { text: "结果" } } }, noDownload)!.quote).toBe("结果");
    expect(telegramMessage({ message: { ...base, from: { id: 2, is_bot: true }, text: "x" } }, noDownload)).toBeUndefined();
    expect(telegramMessage({ edited_message: {} }, noDownload)).toBeUndefined();
  });

  it("Slack：只认真人发的；带文件的消息照收；频道里的不算单聊", () => {
    const ev = { type: "message", channel: "D1", channel_type: "im", user: "U1", ts: "1.2", text: "hi" };
    expect(slackMessage(ev, noDownload)).toMatchObject({ id: "D1:1.2", chatId: "D1", dm: true, senderId: "U1", text: "hi" });
    expect(slackMessage({ ...ev, bot_id: "B1" }, noDownload)).toBeUndefined();
    expect(slackMessage({ ...ev, subtype: "message_changed" }, noDownload)).toBeUndefined();
    expect(slackMessage({ ...ev, channel_type: "channel" }, noDownload)!.dm).toBe(false);
    const f = slackMessage({ ...ev, subtype: "file_share", files: [{ name: "a.png", mimetype: "image/png", url_private_download: "u" }, { name: "b.pdf", mimetype: "application/pdf", url_private: "v" }] }, noDownload)!;
    expect(f.files.map((x) => [x.type, x.name])).toEqual([["image", undefined], ["file", "b.pdf"]]);
  });

  it("Discord：服务器里的不算单聊；机器人发的跳过；回复带原文", () => {
    const d = { id: "9", channel_id: "C1", author: { id: "U1", global_name: "Ann" }, content: "hi", attachments: [] };
    expect(discordMessage(d, noDownload)).toMatchObject({ id: "9", chatId: "C1", dm: true, senderId: "U1", senderName: "Ann", text: "hi" });
    expect(discordMessage({ ...d, guild_id: "G" }, noDownload)!.dm).toBe(false);
    expect(discordMessage({ ...d, author: { id: "B", bot: true } }, noDownload)).toBeUndefined();
    expect(discordMessage({ ...d, referenced_message: { content: "结果" } }, noDownload)!.quote).toBe("结果");
    expect(discordMessage({ ...d, attachments: [{ url: "u", filename: "a.mp4", content_type: "video/mp4" }] }, noDownload)!.files[0].type).toBe("video");
  });
});

/** 假 fetch：按方法名回结果，记下每次调用 */
function fakeTelegram(handler: (method: string, body: any) => any) {
  const calls: Array<{ method: string; body: any }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").at(-1)!;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, body });
    const out = await handler(method, body);
    if (out?.__wait) await new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    return new Response(JSON.stringify(out?.error ? { ok: false, error_code: out.error, description: out.description ?? "" } : { ok: true, result: out }), { status: out?.error ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("Telegram 传输层", () => {
  it("长轮询：收到的消息交出去，收取位置存下；下次从那里接着收；stop 能打断长轮询", async () => {
    let offset = 0;
    let batch: any[] = [{ update_id: 10, message: { message_id: 1, chat: { id: 5, type: "private" }, from: { id: 5, first_name: "A" }, text: "你好" } }];
    const { calls, impl } = fakeTelegram((m) => {
      if (m !== "getUpdates") return true;
      const b = batch;
      batch = [];
      return b.length ? b : { __wait: true };
    });
    const t = new TelegramTransport("TOKEN", { fetchImpl: impl, offset: { get: () => offset, set: (n) => (offset = n) } });
    const got: MessengerMessage[] = [];
    const states: string[] = [];
    await t.start((m) => got.push(m), (s) => states.push(s));
    await until(() => got.length === 1);
    expect(got[0].text).toBe("你好");
    await until(() => offset === 11);
    await until(() => calls.filter((c) => c.method === "getUpdates").at(-1)!.body.offset === 11);
    expect(states).toContain("connected");
    expect(calls[0].method).toBe("deleteWebhook");
    await t.stop();
  });

  it("token 失效：报告一次、不再重试；另一个实例在收（409）：报错但继续试", async () => {
    const { impl } = fakeTelegram(() => ({ error: 401, description: "Unauthorized" }));
    const t = new TelegramTransport("BAD", { fetchImpl: impl });
    const states: Array<[string, boolean | undefined]> = [];
    await t.start(() => {}, (s, _d, fatal) => states.push([s, fatal]));
    await until(() => states.some(([, f]) => f));
    expect(states.at(-1)).toEqual(["error", true]);
    await t.stop();

    let n = 0;
    const { impl: conflict } = fakeTelegram((m) => (m === "getUpdates" ? (++n < 3 ? { error: 409, description: "Conflict" } : { __wait: true }) : true));
    const t2 = new TelegramTransport("T", { fetchImpl: conflict, backoffMs: [1] });
    await t2.start(() => {}, () => {});
    await until(() => n >= 3);
    await t2.stop();
  });

  it("发消息：先用 HTML，格式不被接受时发原文；改写内容没变不算错；平台拒绝和限流分得开", async () => {
    let first = true;
    const { calls, impl } = fakeTelegram((m, b) => {
      if (m === "sendMessage" && b.parse_mode && first) {
        first = false;
        return { error: 400, description: "Bad Request: can't parse entities" };
      }
      if (m === "editMessageText") return { error: 400, description: "Bad Request: message is not modified" };
      return { message_id: 33 };
    });
    const t = new TelegramTransport("T", { fetchImpl: impl });
    expect(await t.sendText("5", "**粗")).toBe("33");
    expect(calls.map((c) => [c.body.text, c.body.parse_mode])).toEqual([["**粗", "HTML"], ["**粗", undefined]]);
    await t.editText("5", "33", "同样的");

    const reject = new TelegramTransport("T", { fetchImpl: fakeTelegram(() => ({ error: 403, description: "bot was blocked" })).impl });
    await expect(reject.sendText("5", "x")).rejects.toMatchObject({ rejected: true });
    const limit = new TelegramTransport("T", { fetchImpl: fakeTelegram(() => ({ error: 429, description: "Too Many Requests" })).impl });
    await expect(limit.sendText("5", "x")).rejects.toMatchObject({ rejected: false });
  });

  it("文件：图片走 sendPhoto，其他走 sendDocument；下载经 getFile", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-tg-"));
    const f = path.join(dir, "a.bin");
    fs.writeFileSync(f, "x");
    const { calls, impl } = fakeTelegram(() => ({ message_id: 1 }));
    const t = new TelegramTransport("T", { fetchImpl: impl });
    await t.sendFile("5", f, "图.png");
    await t.sendFile("5", f, "报告.pdf");
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendDocument"]);
    expect((calls[0].body as FormData).get("chat_id")).toBe("5");
    expect(((calls[1].body as FormData).get("document") as File).name).toBe("报告.pdf");
  });
});

/** 本地 WebSocket 服务器 */
async function wsServer(onConn: (s: WebSocket, nth: number) => void) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.once("listening", r));
  let n = 0;
  wss.on("connection", (s) => onConn(s, ++n));
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    close: () => new Promise((r) => (wss.clients.forEach((c) => c.terminate()), wss.close(r))),
  };
}

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("Slack 传输层", () => {
  const event = (n: number) => ({ envelope_id: `e${n}`, type: "events_api", payload: { event: { type: "message", channel: "D1", channel_type: "im", user: "U1", ts: `${n}.0`, text: `消息${n}` } } });

  async function slackApi(ws: string, over: Record<string, any> = {}) {
    const calls: Array<{ method: string; body: string; auth?: string }> = [];
    const http = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const method = req.url!.split("/").at(-1)!;
      calls.push({ method, body: Buffer.concat(chunks).toString(), auth: req.headers.authorization });
      const out = over[method] ?? (method === "apps.connections.open" ? { ok: true, url: ws } : method === "auth.test" ? { ok: true, user: "bot", team: "T" } : { ok: true, ts: "1.5" });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
    cleanups.push(http.close);
    return { calls, http };
  }

  it("连上：hello 之后算在线；每个事件都回执；Slack 要换连接时重连", async () => {
    const acks: string[] = [];
    const srv = await wsServer((s, nth) => {
      s.on("message", (raw) => acks.push(JSON.parse(raw.toString()).envelope_id));
      s.send(JSON.stringify({ type: "hello" }));
      s.send(JSON.stringify(event(nth)));
      if (nth === 1) s.send(JSON.stringify({ type: "disconnect", reason: "refresh_requested" }));
    });
    cleanups.push(srv.close);
    const { http, calls } = await slackApi(srv.url);
    const t = new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url, reconnectMs: [1] });
    const got: MessengerMessage[] = [];
    const states: string[] = [];
    await t.start((m) => got.push(m), (s) => states.push(s));
    await until(() => got.length === 2);
    expect(got.map((m) => m.text)).toEqual(["消息1", "消息2"]);
    await until(() => acks.length === 2);
    expect(acks).toEqual(["e1", "e2"]);
    expect(states.filter((s) => s === "connected")).toHaveLength(2);
    expect(calls.filter((c) => c.method === "apps.connections.open").every((c) => c.auth === "Bearer xapp-1")).toBe(true);
    await t.stop();
  });

  it("连接断了但没报错（pong 不回）：自己发现并重连", async () => {
    let conns = 0;
    const srv = await wsServer((s) => {
      conns++;
      // 不回 pong：ws 默认自动回，这里关掉底层的自动回应
      (s as any)._receiver.removeAllListeners("ping");
      s.send(JSON.stringify({ type: "hello" }));
    });
    cleanups.push(srv.close);
    const { http } = await slackApi(srv.url);
    const t = new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url, reconnectMs: [1], pingMs: 10 });
    await t.start(() => {}, () => {});
    await until(() => conns >= 2);
    await t.stop();
  });

  it("app token 失效或没开 Socket Mode：提示一次，不一直重连", async () => {
    const { http } = await slackApi("ws://unused", { "apps.connections.open": { ok: false, error: "invalid_auth" } });
    const t = new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url, reconnectMs: [1] });
    const seen: Array<[string, boolean | undefined]> = [];
    await t.start(() => {}, (s, _d, f) => seen.push([s, f]));
    await until(() => seen.some(([, f]) => f));
    expect(seen.at(-1)).toEqual(["error", true]);
    await t.stop();
  });

  it("检查凭据：token 填反了直接说；机器人名字取自 auth.test", async () => {
    const { http } = await slackApi("ws://unused");
    await expect(new SlackTransport("xapp-1", "xoxb-1", { baseUrl: http.url }).verify()).rejects.toMatchObject({ rejected: true });
    expect(await new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url }).verify()).toEqual({ name: "@bot · T" });
  });

  it("发消息转成 mrkdwn；限流算暂时的；平台拒绝的不重试", async () => {
    const { http, calls } = await slackApi("ws://unused");
    const t = new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url });
    expect(await t.sendText("D1", "**粗**")).toBe("1.5");
    expect(JSON.parse(calls[0].body)).toMatchObject({ channel: "D1", text: "*粗*" });
    await t.editText("D1", "1.5", "改");
    expect(calls[1].method).toBe("chat.update");
    const { http: bad } = await slackApi("ws://unused", { "chat.postMessage": { ok: false, error: "channel_not_found" } });
    await expect(new SlackTransport("xoxb-1", "xapp-1", { baseUrl: bad.url }).sendText("D1", "x")).rejects.toMatchObject({ rejected: true });
    const { http: slow } = await slackApi("ws://unused", { "chat.postMessage": { ok: false, error: "ratelimited" } });
    await expect(new SlackTransport("xoxb-1", "xapp-1", { baseUrl: slow.url }).sendText("D1", "x")).rejects.toMatchObject({ rejected: false });
  });

  it("没有 files:read 时 Slack 返回登录页：说清楚，不把网页存成图片", async () => {
    const http = await listen((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html>"));
    cleanups.push(http.close);
    const t = new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url });
    await expect((t as any).download(http.url + "/f")).rejects.toThrow("files:read");
  });

  it("上传文件分三步：要地址、传上去、发到会话", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-slack-"));
    const f = path.join(dir, "a.txt");
    fs.writeFileSync(f, "hello");
    const up = await listen((req, res) => {
      void req.resume();
      res.writeHead(200).end("OK");
    });
    cleanups.push(up.close);
    const { http, calls } = await slackApi("ws://unused", { "files.getUploadURLExternal": { ok: true, upload_url: up.url + "/u", file_id: "F1" } });
    await new SlackTransport("xoxb-1", "xapp-1", { baseUrl: http.url }).sendFile("D1", f, "a.txt");
    expect(calls.map((c) => c.method)).toEqual(["files.getUploadURLExternal", "files.completeUploadExternal"]);
    expect(calls[0].body).toBe("filename=a.txt&length=5");
    expect(JSON.parse(calls[1].body)).toEqual({ files: [{ id: "F1", title: "a.txt" }], channel_id: "D1" });
  });
});

describe("Discord 传输层", () => {
  const hello = (s: WebSocket, ms = 60_000) => s.send(JSON.stringify({ op: 10, d: { heartbeat_interval: ms } }));
  const message = (n: number, d: Record<string, unknown> = {}) => ({ op: 0, s: n, t: "MESSAGE_CREATE", d: { id: String(n), channel_id: "C1", author: { id: "U1", username: "ann" }, content: `消息${n}`, ...d } });

  it("登录：只要单聊的 intent；READY 算在线；消息交出去", async () => {
    const sent: any[] = [];
    const srv = await wsServer((s) => {
      s.on("message", (raw) => {
        const p = JSON.parse(raw.toString());
        sent.push(p);
        if (p.op === 2) {
          s.send(JSON.stringify({ op: 0, s: 1, t: "READY", d: { session_id: "S", resume_gateway_url: "ws://unused" } }));
          s.send(JSON.stringify(message(2)));
        }
      });
      hello(s);
    });
    cleanups.push(srv.close);
    const t = new DiscordTransport("TOK", { gatewayUrl: srv.url });
    const got: MessengerMessage[] = [];
    const states: string[] = [];
    await t.start((m) => got.push(m), (s) => states.push(s));
    await until(() => got.length === 1);
    expect(got[0]).toMatchObject({ text: "消息2", dm: true });
    expect(sent[0]).toMatchObject({ op: 2, d: { token: "TOK", intents: 4096 } });
    expect(states).toContain("connected");
    await t.stop();
  });

  it("平台要换连接（op 7）：重连后带着会话和序号 RESUME，不重新登录", async () => {
    const seen: any[] = [];
    let url = "";
    const srv = await wsServer((s, nth) => {
      s.on("message", (raw) => {
        const p = JSON.parse(raw.toString());
        seen.push(p);
        if (p.op === 2) {
          s.send(JSON.stringify({ op: 0, s: 5, t: "READY", d: { session_id: "S", resume_gateway_url: url } }));
          s.send(JSON.stringify({ op: 7, d: null }));
        }
        if (p.op === 6) s.send(JSON.stringify({ op: 0, s: 6, t: "RESUMED", d: null }));
      });
      hello(s);
      void nth;
    });
    url = srv.url;
    cleanups.push(srv.close);
    const t = new DiscordTransport("TOK", { gatewayUrl: srv.url, reconnectMs: [1] });
    await t.start(() => {}, () => {});
    await until(() => seen.some((p) => p.op === 6));
    expect(seen.find((p) => p.op === 6).d).toEqual({ token: "TOK", session_id: "S", seq: 5 });
    expect(seen.filter((p) => p.op === 2)).toHaveLength(1);
    await t.stop();
  });

  it("会话失效（op 9，不能接上）：重新登录", async () => {
    const ops: number[] = [];
    let n = 0;
    const srv = await wsServer((s) => {
      s.on("message", (raw) => {
        const p = JSON.parse(raw.toString());
        ops.push(p.op);
        if (p.op === 2 && ++n === 1) s.send(JSON.stringify({ op: 9, d: false }));
      });
      hello(s);
    });
    cleanups.push(srv.close);
    const t = new DiscordTransport("TOK", { gatewayUrl: srv.url, reconnectMs: [1] });
    await t.start(() => {}, () => {});
    await until(() => ops.filter((o) => o === 2).length === 2);
    await t.stop();
  });

  it("心跳没有回应：断开重连", async () => {
    let conns = 0;
    const srv = await wsServer((s) => {
      conns++;
      hello(s, 5);
    });
    cleanups.push(srv.close);
    const t = new DiscordTransport("TOK", { gatewayUrl: srv.url, reconnectMs: [1] });
    await t.start(() => {}, () => {});
    await until(() => conns >= 2);
    await t.stop();
  });

  it("token 不对（关闭码 4004）：提示一次，不再重连", async () => {
    let conns = 0;
    const srv = await wsServer((s) => {
      conns++;
      s.close(4004, "Authentication failed");
    });
    cleanups.push(srv.close);
    const t = new DiscordTransport("BAD", { gatewayUrl: srv.url, reconnectMs: [1] });
    const seen: Array<[string, boolean | undefined]> = [];
    await t.start(() => {}, (s, _d, f) => seen.push([s, f]));
    await until(() => seen.some(([, f]) => f));
    await new Promise((r) => setTimeout(r, 30));
    expect(conns).toBe(1);
    await t.stop();
  });

  it("发消息：带 nonce 防重复，不让 @ 提醒到人；表格放进代码块；错误分得开", async () => {
    const calls: Array<{ method: string; url: string; body: any }> = [];
    let status = 200;
    const http = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      calls.push({ method: req.method!, url: req.url!, body: JSON.parse(Buffer.concat(chunks).toString() || "{}") });
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ id: "M1", message: "nope" }));
    });
    cleanups.push(http.close);
    const t = new DiscordTransport("TOK", { baseUrl: http.url });
    expect(await t.sendText("C1", "| a |\n|---|\n@everyone", "k".repeat(40))).toBe("M1");
    expect(calls[0]).toMatchObject({ method: "POST", url: "/channels/C1/messages", body: { nonce: "k".repeat(25), enforce_nonce: true, allowed_mentions: { parse: [] } } });
    expect(calls[0].body.content.startsWith("```\n| a |")).toBe(true);
    await t.editText("C1", "M1", "改");
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "/channels/C1/messages/M1" });
    status = 403;
    await expect(t.sendText("C1", "x")).rejects.toMatchObject({ rejected: true });
    status = 429;
    await expect(t.sendText("C1", "x")).rejects.toMatchObject({ rejected: false });
  });

  it("文件超过 10 MB：直接报太大，不去传", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-dc-"));
    const f = path.join(dir, "big.bin");
    fs.writeFileSync(f, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(new DiscordTransport("TOK", { baseUrl: "http://127.0.0.1:1" }).sendFile("C1", f, "big.bin")).rejects.toThrow(/过大|too large/i);
  });
});
