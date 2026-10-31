import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { HistoryDenied, type FeishuMessageEvent, type FeishuTransport } from "../src/channels/feishu/transport.js";

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

/** Anthropic 的 content 可以是字符串或内容块数组：取出文字 */
const textOf = (c: any): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : "")).join("") : "");

/**
 * 模拟 Modelflare 的对话接口：/v1/models、流式 /v1/chat/completions，以及 Claude 用的 /v1/messages
 * （Anthropic 格式）。回声 + 模型名；calls[].api 记下走的是哪个接口。
 */
export async function mockOpenAI(opts: { models?: string[]; key?: string | string[]; reply?: (msgs: any[], model: string) => string; kinds?: Record<string, string> } = {}) {
  const models = opts.models ?? ["mock-a", "mock-b"];
  const keys = opts.key === undefined ? undefined : ([] as string[]).concat(opts.key);
  const calls: Array<{ model: string; messages: any[]; auth?: string; skill?: string; api: "chat" | "messages" }> = [];
  const stats = { aborted: 0 };
  const srv = await listen(async (req, res) => {
    if (keys && !keys.some((k) => req.headers.authorization === `Bearer ${k}`)) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
      return;
    }
    if (req.url?.endsWith("/models") && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model", ...(opts.kinds?.[id] !== undefined ? { kind: opts.kinds[id] } : {}) })) }),
      );
      return;
    }
    if (req.url?.endsWith("/chat/completions") && req.method === "POST") {
      const b = await body(req);
      calls.push({ model: b.model, messages: b.messages, auth: req.headers.authorization, skill: req.headers["x-modelflare-skill"] as string | undefined, api: "chat" });
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
    if (req.url?.split("?")[0].endsWith("/v1/messages") && req.method === "POST") {
      const b = await body(req);
      const messages = (b.messages ?? []).map((m: any) => ({ role: m.role, content: textOf(m.content) }));
      calls.push({ model: b.model, messages, auth: req.headers.authorization, skill: req.headers["x-modelflare-skill"] as string | undefined, api: "messages" });
      const text = opts.reply ? opts.reply(messages, b.model) : `[${b.model}] 你说：${messages.at(-1)?.content ?? ""}`;
      const usage = { input_tokens: 1, output_tokens: 1 };
      if (!b.stream) {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "msg_mock", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 0 } } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      for (const p of text.match(/.{1,4}/gsu) ?? []) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: p } });
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
      ev("message_stop", {});
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
    sent: [] as Array<{ to: string; text: string; contextToken?: string; item?: any }>,
    /** 与 sent 一一对应：每条消息的 client_id（出站队列给的是固定的） */
    clientIds: [] as string[],
    /** sendmessage 回 HTTP 500（模拟网络/服务端故障）：sendDown 一直失败，failSend 失败接下来的 N 次 */
    sendDown: false,
    failSend: 0,
    sendFailures: 0,
    /** 假 CDN：encrypt_query_param → 密文（下载）；上传的密文也存这里 */
    cdn: new Map<string, Buffer>(),
    cdnDownloads: [] as string[],
    typing: [] as number[],
    expireNext: false,
    authSeen: [] as string[],
  };
  let base = "";
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.headers.authorization) state.authSeen.push(String(req.headers.authorization));
    if (u.pathname === "/c2c/download") {
      const q = u.searchParams.get("encrypted_query_param") ?? "";
      state.cdnDownloads.push(q);
      const b = state.cdn.get(q);
      return b ? res.writeHead(200, { "content-type": "application/octet-stream" }).end(b) : res.writeHead(400, { "x-error-message": "invalid encrypted_param" }).end();
    }
    if (u.pathname === "/c2c/upload") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const id = `down-${state.cdn.size + 1}`;
      state.cdn.set(id, Buffer.concat(chunks));
      return res.writeHead(200, { "x-encrypted-param": id }).end();
    }
    switch (u.pathname) {
      case "/ilink/bot/get_bot_qrcode":
        return json({ qrcode: "qr-1", qrcode_img_content: "https://liteapp.weixin.qq.com/q/mock?qrcode=qr-1" });
      case "/ilink/bot/get_qrcode_status": {
        const s = state.statusSeq.shift() ?? "wait";
        if (s === "confirmed") return json({ status: s, bot_token: "tok-secret-123", ilink_bot_id: "bot@im.bot", baseurl: base, ilink_user_id: "owner@im.wechat" });
        return json({ status: s });
      }
      case "/ilink/bot/getupdates": {
        const b = await body(req);
        if (state.expireNext) {
          state.expireNext = false;
          return json({ ret: -14, errcode: -14, errmsg: "session timeout" });
        }
        // 像真实 iLink 一样按游标投递：inbox 只追加，get_updates_buf = 已经拿到第几条；
        // 客户端没处理完就停了（游标没前进），下次拉取会再拿到同样的消息
        const from = Number(/^cur-(\d+)$/.exec(String(b.get_updates_buf ?? ""))?.[1] ?? 0);
        const deadline = Date.now() + 300;
        while (state.inbox.length <= from && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        const msgs = state.inbox.slice(from);
        return json({ ret: 0, msgs, get_updates_buf: `cur-${from + msgs.length}` });
      }
      case "/ilink/bot/sendmessage": {
        const b = await body(req);
        if (state.sendDown || state.failSend > 0) {
          if (state.failSend > 0) state.failSend--;
          state.sendFailures++;
          return res.writeHead(500).end();
        }
        const item = b.msg.item_list[0];
        state.sent.push({ to: b.msg.to_user_id, text: item.text_item?.text ?? "", contextToken: b.msg.context_token, ...(item.text_item ? {} : { item }) });
        state.clientIds.push(b.msg.client_id);
        return json({ ret: 0 });
      }
      case "/ilink/bot/getuploadurl": {
        const b = await body(req);
        return json({ ret: 0, upload_param: `up-${b.filekey}` });
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
  const pushItems = (from: string, items: any[], ctx = "ctx-1") =>
    state.inbox.push({ seq: ++seq, message_id: `m${seq}`, from_user_id: from, to_user_id: "bot@im.bot", create_time_ms: Date.now(), message_type: 1, message_state: 2, context_token: ctx, item_list: items });
  const push = (from: string, text: string, ctx = "ctx-1") => pushItems(from, [{ type: 1, text_item: { text } }], ctx);
  /** 像微信那样把明文用随机密钥加密放到假 CDN，返回图片条目（密钥放在 image_item.aeskey） */
  const imageItem = (plain: Buffer) => {
    const key = crypto.randomBytes(16);
    const c = crypto.createCipheriv("aes-128-ecb", key, null);
    const q = `img+${crypto.randomBytes(4).toString("hex")}/=`;
    state.cdn.set(q, Buffer.concat([c.update(plain), c.final()]));
    return { type: 2, image_item: { aeskey: key.toString("hex"), media: { encrypt_query_param: q, aes_key: key.toString("base64"), encrypt_type: 1 } } };
  };
  /** 文件条目：aes_key 是十六进制密钥字符串的 base64（与微信一致） */
  const fileItem = (plain: Buffer, name: string) => {
    const key = crypto.randomBytes(16);
    const c = crypto.createCipheriv("aes-128-ecb", key, null);
    const q = `file+${crypto.randomBytes(4).toString("hex")}/=`;
    state.cdn.set(q, Buffer.concat([c.update(plain), c.final()]));
    return { type: 4, file_item: { file_name: name, len: String(plain.length), media: { encrypt_query_param: q, aes_key: Buffer.from(key.toString("hex")).toString("base64"), encrypt_type: 1 } } };
  };
  return { ...srv, state, push, pushItems, imageItem, fileItem, cdnBase: `${srv.url}/c2c` };
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
  private onState: ((s: "connecting" | "connected" | "error", d?: string) => void) | undefined;
  private n = 0;
  async start(onMessage: (ev: FeishuMessageEvent) => void, onState: (s: "connecting" | "connected" | "error", d?: string) => void) {
    this.onMessage = onMessage;
    this.onState = onState;
    onState("connected");
  }
  /** 断线重连（长连接又连上了） */
  reconnect() {
    this.onState?.("connecting", "reconnecting");
    this.onState?.("connected", "reconnected");
  }
  /** 会话历史（离线补消息）：chatId → 消息（senderType 默认 user）；denyHistory 时像没开权限一样抛 HistoryDenied */
  history = new Map<string, Array<FeishuMessageEvent & { senderType?: string }>>();
  denyHistory = false;
  listed: Array<{ chatId: string; since: number; limit: number; chatType: string }> = [];
  async listMessages(chatId: string, o: { since: number; limit: number; chatType: string }) {
    this.listed.push({ chatId, ...o });
    if (this.denyHistory) throw new HistoryDenied("im.message.list denied: code=99991672 msg=Access denied. One of the following scopes is required");
    return (this.history.get(chatId) ?? [])
      .filter((m) => (m.senderType ?? "user") === "user" && m.createTime > o.since)
      .sort((a, b) => a.createTime - b.createTime)
      .slice(-o.limit)
      .map(({ senderType: _s, ...m }) => ({ ...m, chatType: o.chatType }));
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
  async replyText(to: string, text: string, uuid?: string) {
    this.calls.push({ op: "text", args: [to, text, uuid] });
    this.texts.push(text);
  }
  /** 主动发到会话（使用请求通知、余额提醒） */
  notices: Array<{ chatId: string; text: string; uuid?: string }> = [];
  async sendText(chatId: string, text: string, uuid?: string) {
    this.calls.push({ op: "send", args: [chatId, text, uuid] });
    this.notices.push({ chatId, text, uuid });
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
    createTime: opts.createTime ?? Date.now(),
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

// —— Modelflare 账户（OIDC + connected-app）——

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const c of req) body += c;
  return new URLSearchParams(body);
}
export async function readJson(req: http.IncomingMessage): Promise<any> {
  let body = "";
  for await (const c of req) body += c;
  return body ? JSON.parse(body) : {};
}

/** 模拟 Modelflare：发现文档、授权码 + PKCE（公共客户端）、refresh 轮换、撤销、connected-app 接口 */
export async function mockModelflare() {
  const s = {
    pending: new Map<string, { challenge: string; redirect: string }>(),
    refresh: new Set<string>(),
    access: new Set<string>(),
    revoked: [] as string[],
    tokenForms: [] as Record<string, string>[],
    keys: [] as Array<{ id: number; name: string; limit_usd: number | null; used_usd: number }>,
    balance: 12.5,
    revokeAll: false,
    /** GET /api-keys 被请求的次数 */
    keyLists: 0,
  };
  let base = "";
  let n = 0;
  // Key 的 id 和服务端一样只增不减：删掉一把后新签发的不会和它重号
  let keySeq = 0;
  const keyOut = (k: (typeof s.keys)[number]) => ({ ...k, key_tail: `sk-key-${k.id}`.slice(-4), status: "enabled", unlimited: k.limit_usd === null, remain_usd: k.limit_usd });
  const issue = (res: http.ServerResponse) => {
    const access = `at-${++n}`;
    const refresh = `rt-${n}`;
    s.access.add(access);
    s.refresh.add(refresh);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 900, scope: "account api_keys offline_access openid profile" }));
  };
  const oauthError = (res: http.ServerResponse, code: string) => res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: code }));
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const json = (o: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (u.pathname === "/.well-known/openid-configuration") {
      return json({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, revocation_endpoint: `${base}/oauth/revoke` });
    }
    if (u.pathname === "/oauth/token" && req.method === "POST") {
      const f = Object.fromEntries(await readForm(req));
      s.tokenForms.push(f);
      if (f.client_id !== "anymodel-bot" || f.client_secret) return json({ error: "invalid_client" }, 401);
      if (f.grant_type === "authorization_code") {
        const p = s.pending.get(f.code);
        s.pending.delete(f.code);
        if (!p || p.redirect !== f.redirect_uri) return oauthError(res, "invalid_grant");
        const challenge = crypto.createHash("sha256").update(f.code_verifier ?? "").digest("base64url");
        if (challenge !== p.challenge) return oauthError(res, "invalid_grant");
        return issue(res);
      }
      if (f.grant_type === "refresh_token") {
        if (s.revokeAll || !s.refresh.delete(f.refresh_token)) return oauthError(res, "invalid_grant");
        return issue(res);
      }
      return oauthError(res, "unsupported_grant_type");
    }
    if (u.pathname === "/oauth/revoke" && req.method === "POST") {
      const f = await readForm(req);
      s.revoked.push(f.get("token") ?? "");
      s.refresh.delete(f.get("token") ?? "");
      s.keys = [];
      return res.writeHead(200).end();
    }
    if (u.pathname.startsWith("/api/connected-app/")) {
      const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (s.revokeAll || !s.access.has(token)) return json({ error: "invalid_token" }, 401);
      const p = u.pathname.slice("/api/connected-app".length);
      if (p === "/account") return json({ success: true, data: { display_name: "Ada", username: "ada", group: "default", balance_usd: s.balance, used_usd: 3, billed_to_enterprise: false, quota_per_unit: 500000 } });
      if (p === "/api-keys" && req.method === "POST") {
        const b = await readJson(req);
        const k = { id: ++keySeq, name: b.name, limit_usd: b.limit_usd ?? null, used_usd: 0 };
        s.keys.push(k);
        return json({ success: true, data: { ...keyOut(k), key: `sk-key-${k.id}` } });
      }
      if (p === "/api-keys" && req.method === "GET") {
        s.keyLists++;
        return json({ success: true, data: s.keys.map(keyOut) });
      }
      const m = p.match(/^\/api-keys\/(\d+)$/);
      if (m && req.method === "PATCH") {
        const k = s.keys.find((x) => x.id === Number(m[1]));
        if (!k) return json({ success: false, message: "not found" }, 404);
        Object.assign(k, { limit_usd: (await readJson(req)).limit_usd });
        return json({ success: true, data: k });
      }
      if (m && req.method === "DELETE") {
        s.keys = s.keys.filter((x) => x.id !== Number(m[1]));
        return json({ success: true });
      }
    }
    res.writeHead(404).end();
  });
  base = srv.url;
  return { ...srv, s };
}

/** 模拟浏览器：用户在授权页同意后，Modelflare 把授权码带回本机回调地址 */
export async function approveInBrowser(mf: Awaited<ReturnType<typeof mockModelflare>>, loginUrl: string): Promise<Response> {
  const u = new URL(loginUrl);
  const code = `code-${crypto.randomUUID()}`;
  const redirect = u.searchParams.get("redirect_uri")!;
  mf.s.pending.set(code, { challenge: u.searchParams.get("code_challenge")!, redirect });
  return fetch(`${redirect}?code=${code}&state=${encodeURIComponent(u.searchParams.get("state")!)}`);
}
