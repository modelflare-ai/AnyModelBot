import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FeishuMessageEvent, FeishuTransport } from "../src/channels/feishu/transport.js";

export async function listen(handler: http.RequestListener): Promise<{ url: string; port: number; close: () => Promise<void>; server: http.Server }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    server,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}

/** 模拟 OpenAI 兼容端点：/v1/models + 流式 /v1/chat/completions（回声 + 模型名） */
export async function mockOpenAI(opts: { models?: string[]; key?: string; reply?: (msgs: any[], model: string) => string } = {}) {
  const models = opts.models ?? ["mock-a", "mock-b"];
  const calls: Array<{ model: string; messages: any[]; auth?: string }> = [];
  const stats = { aborted: 0 };
  const srv = await listen(async (req, res) => {
    if (opts.key && req.headers.authorization !== `Bearer ${opts.key}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
      return;
    }
    if (req.url?.endsWith("/models") && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
      return;
    }
    if (req.url?.endsWith("/chat/completions") && req.method === "POST") {
      const b = await body(req);
      calls.push({ model: b.model, messages: b.messages, auth: req.headers.authorization });
      const last = b.messages[b.messages.length - 1]?.content ?? "";
      const text = opts.reply ? opts.reply(b.messages, b.model) : `[${b.model}] 你说：${last}`;
      if (!b.stream) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const pieces = text.match(/.{1,4}/gsu) ?? [];
      let gone = false;
      res.on("close", () => {
        if (!res.writableEnded) (gone = true), stats.aborted++;
      });
      for (const p of pieces) {
        if (gone) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 2));
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  return {
    ...srv,
    calls,
    models,
    /** 流式回复中途被客户端断开的次数 */
    get aborted() {
      return stats.aborted;
    },
  };
}

/** 模拟 iLink：登录（wait→scaned→confirmed）、getupdates（队列）、sendmessage、getconfig、sendtyping、-14 */
export async function mockIlink() {
  const state = {
    statusSeq: ["wait", "scaned", "confirmed"] as string[],
    inbox: [] as any[],
    sent: [] as Array<{ to: string; text: string; contextToken?: string }>,
    typing: [] as number[],
    expireNext: false,
    authSeen: [] as string[],
    cursor: 0,
  };
  let base = "";
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.headers.authorization) state.authSeen.push(String(req.headers.authorization));
    switch (u.pathname) {
      case "/ilink/bot/get_bot_qrcode":
        return json({ qrcode: "qr-1", qrcode_img_content: "https://liteapp.weixin.qq.com/q/mock?qrcode=qr-1" });
      case "/ilink/bot/get_qrcode_status": {
        const s = state.statusSeq.shift() ?? "wait";
        if (s === "confirmed") return json({ status: s, bot_token: "tok-secret-123", ilink_bot_id: "bot@im.bot", baseurl: base, ilink_user_id: "owner@im.wechat" });
        return json({ status: s });
      }
      case "/ilink/bot/getupdates": {
        await body(req);
        if (state.expireNext) {
          state.expireNext = false;
          return json({ ret: -14, errcode: -14, errmsg: "session timeout" });
        }
        const deadline = Date.now() + 300;
        while (!state.inbox.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        const msgs = state.inbox.splice(0);
        return json({ ret: 0, msgs, get_updates_buf: `cur-${++state.cursor}` });
      }
      case "/ilink/bot/sendmessage": {
        const b = await body(req);
        state.sent.push({ to: b.msg.to_user_id, text: b.msg.item_list[0].text_item.text, contextToken: b.msg.context_token });
        return json({ ret: 0 });
      }
      case "/ilink/bot/getconfig":
        await body(req);
        return json({ ret: 0, typing_ticket: "ticket-1" });
      case "/ilink/bot/sendtyping": {
        const b = await body(req);
        state.typing.push(b.status);
        return json({ ret: 0 });
      }
    }
    res.writeHead(404).end();
  });
  base = srv.url;
  let seq = 0;
  const push = (from: string, text: string, ctx = "ctx-1") =>
    state.inbox.push({ seq: ++seq, message_id: `m${seq}`, from_user_id: from, to_user_id: "bot@im.bot", create_time_ms: Date.now(), message_type: 1, message_state: 2, context_token: ctx, item_list: [{ type: 1, text_item: { text } }] });
  return { ...srv, state, push };
}

/** 假飞书传输层：记录全部调用 */
export class FakeFeishu implements FeishuTransport {
  calls: Array<{ op: string; args: unknown[] }> = [];
  cards = new Map<string, string>();
  finished = new Set<string>();
  texts: string[] = [];
  failCreate = false;
  failFinish = false;
  onMessage: ((ev: FeishuMessageEvent) => void) | undefined;
  private n = 0;
  async start(onMessage: (ev: FeishuMessageEvent) => void, onState: (s: "connecting" | "connected" | "error") => void) {
    this.onMessage = onMessage;
    onState("connected");
  }
  async stop() {}
  async createStreamingCard(initial: string) {
    this.calls.push({ op: "create", args: [initial] });
    if (this.failCreate) throw new Error("cardkit denied");
    const id = `card${++this.n}`;
    this.cards.set(id, initial);
    return id;
  }
  async sendCardReply(to: string, cardId: string) {
    this.calls.push({ op: "reply", args: [to, cardId] });
  }
  async updateCardText(cardId: string, el: string, text: string, seq: number) {
    this.calls.push({ op: "update", args: [cardId, el, text, seq] });
    this.cards.set(cardId, text);
  }
  async finishCard(cardId: string, seq: number) {
    this.calls.push({ op: "finish", args: [cardId, seq] });
    if (this.failFinish) throw new Error("finish failed");
    this.finished.add(cardId);
  }
  async replyText(to: string, text: string) {
    this.calls.push({ op: "text", args: [to, text] });
    this.texts.push(text);
  }
}

export function feishuEvent(text: string, opts: Partial<FeishuMessageEvent> = {}): FeishuMessageEvent {
  return {
    messageId: opts.messageId ?? `om_${Math.random().toString(36).slice(2)}`,
    chatId: opts.chatId ?? "oc_chat1",
    chatType: opts.chatType ?? "p2p",
    messageType: opts.messageType ?? "text",
    content: opts.content ?? JSON.stringify({ text }),
    senderOpenId: opts.senderOpenId ?? "ou_user1",
    mentions: opts.mentions ?? [],
    createTime: Date.now(),
  };
}

export async function until(fn: () => boolean | Promise<boolean>, ms = 5000, step = 20): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error("until: timeout");
}
