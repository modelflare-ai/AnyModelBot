#!/usr/bin/env node
// README 素材录制用的模拟后端：零依赖（只用 Node 内置模块）。
//
// - 提供 ui/ 的静态文件（与 src/web/server.ts 同样的路径：/、/amb/static/*、/amb/vendor/*），preact / htm 取自 node_modules；
// - 用演示数据实现界面实际调用的 /amb/api/* 接口，响应格式照抄 src/web/server.ts；
// - 网页对话的流式回复（POST /bots/:id/chat/stream，SSE）按场景脚本分段推送：activity / prompt / text / file / done；
//   审批卡片会一直等到界面上点了允许或拒绝，脚本才继续；
// - /__stage/* 提供录制用的舞台页面（stage/），/__gen/* 提供生成的图片，/__docs/* 与 /__repo-assets/* 提供仓库里的品牌素材和应用图标；
// - 界面请求了没实现的接口时记日志（unimplemented），录制结束时由 record.mjs 汇总。
//
// 单独运行（在浏览器里手动看演示数据）：
//   node docs/assets/_src/record/mock-server.mjs --scene demo --port 4173
//   然后打开 http://127.0.0.1:4173/
// 场景：fresh（全新安装）、signed-out（已退出登录，六个机器人还在）、demo（演示就绪）。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import * as D from "./demo-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..", "..", "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** preact / htm 的 ESM 文件：AMB_NODE_MODULES > 仓库的 node_modules（npm ci 之后） */
function vendorFiles() {
  const dirs = [process.env.AMB_NODE_MODULES, path.join(REPO, "node_modules")].filter(Boolean);
  const nm = dirs.find((d) => fs.existsSync(path.join(d, "preact", "dist", "preact.mjs")));
  if (!nm) throw new Error(`找不到 preact：先在仓库根目录 npm ci，或用 AMB_NODE_MODULES 指向一个装了 preact 和 htm 的 node_modules（试过：${dirs.join("、")}）`);
  return {
    "preact.mjs": path.join(nm, "preact", "dist", "preact.mjs"),
    "hooks.mjs": path.join(nm, "preact", "hooks", "dist", "hooks.mjs"),
    "htm.mjs": path.join(nm, "htm", "dist", "htm.mjs"),
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const min = 60_000;

/** 不可扫描的装饰性"二维码"（三个定位角 + 随机模块），只用来占位，不编码任何内容 */
function fakeQrDataUrl() {
  const n = 29;
  const cell = 8;
  let seed = 20261031;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const finder = (x, y) =>
    `<rect x="${x * cell}" y="${y * cell}" width="${7 * cell}" height="${7 * cell}" fill="#111"/>` +
    `<rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/>` +
    `<rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#111"/>`;
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  let mods = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inFinder(x, y) && rnd() < 0.47) mods += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
  const s = n * cell;
  const pad = 2 * cell;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${s + 2 * pad} ${s + 2 * pad}" shape-rendering="crispEdges"><rect x="${-pad}" y="${-pad}" width="${s + 2 * pad}" height="${s + 2 * pad}" fill="#fff"/><g fill="#111">${mods}</g>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ---------------------------------------------------------------------------
// 场景状态
// ---------------------------------------------------------------------------

function botRecord(b, now, extra = {}) {
  return {
    id: b.id,
    name: b.name,
    systemPrompt: b.systemPrompt,
    defaultModel: extra.defaultModel ?? D.BOT_MODEL,
    settings: {
      permission: "workspace",
      memory: { enabled: true, review: true, teamWrite: false },
      steward: { enabled: true },
      computerUse: { enabled: true, backend: "cua", approval: extra.cuApproval ?? "auto" },
      utilityModel: "",
      avatar: b.avatar,
      budget: { enabled: false, limitUsd: 5 },
    },
    createdAt: now - 30 * 86_400_000 + (extra.order ?? 0) * 60_000,
    updatedAt: now - 2 * 86_400_000,
  };
}

/**
 * 场景：
 *   fresh       全新安装：未连接 Modelflare，只有应用自建的「我的助手」
 *   signed-out  退出登录后：六个机器人和会话都在，回到登录页
 *   demo        演示就绪：已登录、六个机器人、小黄的飞书 / 微信已连接
 * opts：weixinBound（默认 true）、cuApproval（小黄的电脑操作审批 auto / ask-input）、memory（小黄的机器人记忆）、
 *       history（是否给六个机器人预置会话，默认 true）、extraConvs（小黄的微信 / 飞书会话，默认 true）
 */
export function createState(scene = "demo", opts = {}) {
  const now = Date.now();
  const connected = scene === "demo";
  const st = {
    scene,
    mf: { connected, keyTail: connected ? D.ACCOUNT.keyTail : "", line: "auto" },
    account: {
      state: connected ? "signed_in" : "signed_out",
      name: connected ? D.ACCOUNT.name : "",
      source: connected ? "account" : "none",
      balanceUsd: connected ? D.ACCOUNT.balanceUsd : null,
      usedUsd: connected ? D.ACCOUNT.usedUsd : null,
      billedToEnterprise: false,
      updatedAt: connected ? now - 4 * min : 0,
      error: "",
      alerts: { lowBalanceUsd: opts.lowBalanceUsd ?? 1, push: false },
    },
    settings: { defaultModel: scene === "fresh" ? "" : D.BOT_MODEL, imageModel: "", videoModel: "", closeToTray: true, zoom: 1 },
    bots: [],
    channels: {},
    convs: new Map(),
    approvals: new Map(),
    memory: {},
    turns: new Map(), // 网页对话进行中的消息：convId → [LiveTurn]
    agentTurns: new Map(), // 其它渠道进行中的回合：convId → { since, lastProgress, steps: Map }
    msgSeq: 1000,
  };
  const list = scene === "fresh" ? [D.DEFAULT_BOT] : D.BOTS;
  list.forEach((b, i) => {
    const isYellow = b.id === D.YELLOW;
    st.bots.push(botRecord(b, now, { order: i, defaultModel: scene === "fresh" ? "" : D.BOT_MODEL, cuApproval: isYellow ? opts.cuApproval : undefined }));
    const weixinBound = isYellow && scene === "demo" && opts.weixinBound !== false;
    st.channels[b.id] = {
      feishu: isYellow && scene === "demo" && opts.feishu !== false ? { state: "connected", since: now - 3 * 3600_000 } : { state: "disabled", detail: "未配置凭据", since: 0 },
      weixin: weixinBound ? { state: "connected", since: now - 3 * 3600_000 } : { state: "login_required", detail: "尚未扫码登录", since: 0 },
      account: weixinBound ? { ilinkBotId: D.WEIXIN_BOT_ID, pausedUntil: 0 } : undefined,
      login: undefined,
    };
    st.memory[b.id] = isYellow ? [...(opts.memory ?? [])] : [];
    if (scene !== "fresh" && opts.history !== false) {
      const conv = ensureConv(st, b.id, "web", "console", "控制台");
      for (const [ago, role, content] of D.history(b.id)) addMessage(st, conv.id, role, content, role === "assistant" ? [] : undefined, now - ago * min);
    }
  });
  // 小黄的另外两段会话（信息面板 → 最近会话）
  if (scene === "demo" && opts.extraConvs !== false) {
    const wx = ensureConv(st, D.YELLOW, "weixin", D.WEIXIN_USER, D.WEIXIN_USER, now - 300 * min);
    addMessage(st, wx.id, "user", "明早 9 点提醒我交周报", undefined, now - 52 * min);
    addMessage(st, wx.id, "assistant", "好的，周报的要点我先帮你列在这里：本周完成、下周计划、需要协调的事。", [], now - 51 * min);
    const fs1 = ensureConv(st, D.YELLOW, "feishu", "ou_demo_7d8a", D.FEISHU_PEER, now - 400 * min);
    addMessage(st, fs1.id, "user", "帮我看看这份需求文档有没有遗漏", undefined, now - 128 * min);
    addMessage(st, fs1.id, "assistant", "整体完整，建议补充两点：异常流程和上线后的回滚方案。", [], now - 127 * min);
  }
  return st;
}

function ensureConv(st, botId, channel, peerId, title = "", at = Date.now()) {
  const id = `${botId}:${channel}:${peerId}`;
  let c = st.convs.get(id);
  if (!c) {
    c = { id, botId, channel, peerId, title, model: "", kind: "dm", createdAt: at, updatedAt: at, messages: [] };
    st.convs.set(id, c);
  }
  return c;
}

function addMessage(st, convId, role, content, activity, at = Date.now()) {
  const c = st.convs.get(convId);
  const m = { id: ++st.msgSeq, conversationId: convId, role, content, createdAt: at, activity: activity || [] };
  c.messages.push(m);
  c.updatedAt = Math.max(c.updatedAt, at);
  return m;
}

const publicMsg = (m) => ({ id: m.id, conversationId: m.conversationId, role: m.role, content: m.content, createdAt: m.createdAt, ...(m.activity.length ? { steps: m.activity.length } : {}) });
const publicConv = (c) => ({
  id: c.id, botId: c.botId, channel: c.channel, peerId: c.peerId, title: c.title, model: c.model, kind: c.kind, createdAt: c.createdAt, updatedAt: c.updatedAt,
  messageCount: c.messages.length, lastMessage: (c.messages.at(-1)?.content ?? "").slice(0, 120),
});
function publicApproval(r) {
  const { payload, result, ...rest } = r;
  let questions;
  if (r.kind === "question") {
    try {
      questions = JSON.parse(payload);
    } catch {
      questions = [];
    }
  }
  return { ...rest, questions };
}

// ---------------------------------------------------------------------------
// 进行中的一条网页消息（对应 src/web/live.ts 的 LiveTurn）
// ---------------------------------------------------------------------------

class LiveTurn {
  constructor(convId, botId, userText, afterMessageId) {
    this.id = crypto.randomUUID();
    this.startedAt = Date.now();
    this.convId = convId;
    this.botId = botId;
    this.userText = userText;
    this.afterMessageId = afterMessageId;
    this.text = "";
    this.steps = new Map();
    this.prompts = [];
    this.files = [];
    this.stopping = false;
    this.done = false;
    this.subs = new Set();
  }
  emit(ev, data) {
    for (const fn of [...this.subs]) {
      try {
        fn(ev, data);
      } catch {
        /* 某个连接写失败不影响其它订阅者 */
      }
    }
  }
  snapshot() {
    return { id: this.id, startedAt: this.startedAt, userText: this.userText, text: this.text, steps: [...this.steps.values()], prompts: [...this.prompts], files: [...this.files], stopping: this.stopping };
  }
}

function sse(res) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", connection: "keep-alive" });
  let closed = false;
  res.on("close", () => (closed = true));
  return {
    send(event, data) {
      if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end(event, data) {
      this.send(event, data);
      if (!closed && !res.writableEnded) res.end();
    },
  };
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------

/**
 * startMock({ port, host, scene, sceneOpts, genDir, log }) → controller
 * controller：url、state、events（EventEmitter）、setScene()、authorize()、weixinConfirm()、weixinInbound()、
 *   onChat（网页对话脚本：async (turnApi, botId, text) => void）、onWeixin（微信回合脚本）、unimplemented、requests、close()
 */
export async function startMock({ port = 0, host = "127.0.0.1", scene = "demo", sceneOpts = {}, genDir = "", log = () => {} } = {}) {
  const uiDir = path.join(REPO, "ui");
  const stageDir = path.join(HERE, "stage");
  const vendor = vendorFiles();
  const events = new EventEmitter();
  const ctl = {
    url: "",
    state: createState(scene, sceneOpts),
    events,
    unimplemented: [],
    requests: [],
    errors: [],
    onChat: null,
    onWeixin: null,
    /** 某些接口的人为延迟（毫秒），模拟真实启动时的等待 */
    delays: {},
  };
  ctl.setScene = (name, opts = {}) => {
    ctl.state = createState(name, opts);
    ctl.onChat = null;
    ctl.onWeixin = null;
    ctl.delays = {};
  };

  const S = () => ctl.state;
  const bot = (id) => S().bots.find((b) => b.id === id);
  const status = () => {
    const a = S().account;
    return { ...a, loginUrl: a.state === "signing_in" ? LOGIN_URL : "", lowBalance: a.balanceUsd !== null && a.alerts.lowBalanceUsd > 0 && a.balanceUsd < a.alerts.lowBalanceUsd, loginAvailable: true };
  };
  const mfStatus = () => ({ mode: "managed", connected: S().mf.connected, keyTail: S().mf.keyTail, line: S().mf.line, baseUrl: "https://api.modelflare.dev", gateway: "running" });
  /** 全局渠道账号：key 是账号的命名空间，演示数据里小黄的账号 key 就是它的 id（和升级后的老账号一样） */
  const channelOf = (key) => (S().channels[key] ??= { feishu: { state: "disabled", detail: "未配置凭据", since: 0 }, weixin: { state: "login_required", detail: "尚未扫码登录", since: 0 }, account: undefined, login: undefined });
  const channelStatus = (key) => {
    const ch = channelOf(key);
    const off = { state: "disabled", since: 0 };
    return {
      feishu: { ...ch.feishu, ...(ch.feishu.state === "connected" ? { account: { appId: D.FEISHU_APP_ID, saved: { appSecret: "****7c1e" } } } : {}) },
      weixin: { ...ch.weixin, ...(ch.account ? { account: ch.account } : {}), login: ch.login, quota: [] },
      telegram: off,
      slack: off,
      discord: off,
    };
  };
  const channelAccounts = () => {
    const out = [];
    const seen = {};
    for (const key of Object.keys(S().channels)) {
      const ch = S().channels[key];
      const row = (channel, label, status) => {
        seen[channel] = (seen[channel] ?? 0) + 1;
        out.push({ key, channel, number: seen[channel], label, defaultBot: D.YELLOW, enabled: true, status, requests: 0 });
      };
      if (ch.account) row("weixin", "我的微信", channelStatus(key).weixin);
      if (ch.feishu.state === "connected") row("feishu", "工作飞书", channelStatus(key).feishu);
    }
    return out;
  };
  const LOGIN_URL = "https://modelflare.dev/oauth/authorize?client_id=anymodelbot&response_type=code&utm_source=anymodelbot";

  /** 浏览器里点了「继续」：登录完成，本机 Key 已签发 */
  ctl.authorize = () => {
    const st = S();
    st.account = { ...st.account, state: "signed_in", name: D.ACCOUNT.name, source: "account", balanceUsd: D.ACCOUNT.balanceUsd, usedUsd: D.ACCOUNT.usedUsd, updatedAt: Date.now(), error: "" };
    st.mf = { ...st.mf, connected: true, keyTail: D.ACCOUNT.keyTail };
    events.emit("authorized");
  };
  /** 微信扫码确认（二维码 → 已连接） */
  ctl.weixinConfirm = (key) => {
    const ch = channelOf(key);
    ch.login = { state: "confirmed", message: "✅ 微信已连接", refreshCount: 0 };
    ch.account = { ilinkBotId: D.WEIXIN_BOT_ID, pausedUntil: 0 };
    ch.weixin = { state: "connected", since: Date.now() };
  };

  // —— 代理回合的脚本接口：网页对话和微信回合共用 ——
  function turnApi(sink, botId) {
    let seq = 0;
    const steps = new Map();
    const put = (s) => {
      steps.set(s.id, s);
      sink.activity({ ...s });
      return s;
    };
    const st0 = S();
    const b0 = bot(botId);
    const api = {
      botId,
      steps,
      sleep,
      /** 这一轮用的模型：会话里切换过的 > 机器人默认 > 全局默认 */
      modelId: st0.convs.get(sink.convId)?.model || b0?.defaultModel || st0.settings.defaultModel || D.BOT_MODEL,
      /** remember 工具写进机器人记忆 */
      remember: (text) => st0.memory[botId].push(text),
      /** 模型请求一步：running → done(summary) */
      model(title = api.modelId) {
        const s = put({ id: `m1.${++seq}`, kind: "model", title, status: "running", at: Date.now() });
        return {
          done: (summary, more = {}) => put({ ...s, status: "ok", summary, ms: Date.now() - s.at, tokens: more.tokens ?? { input: 8000 + seq * 1700, output: 120 + seq * 40 }, ...(more.output ? { output: more.output } : {}) }),
        };
      },
      /** 工具调用一步（title = 工具名，summary = 主要参数） */
      tool(name, summary, input) {
        const s = put({ id: `call_${crypto.randomBytes(4).toString("hex")}`, kind: "tool", title: name, ...(summary ? { summary } : {}), input: input ?? JSON.stringify(summary ? { command: summary } : {}, null, 2), status: "running", at: Date.now() });
        return {
          done: (output) => put({ ...s, status: "ok", ms: Date.now() - s.at, ...(output ? { output } : {}) }),
          fail: (output) => put({ ...s, status: "error", ms: Date.now() - s.at, ...(output ? { output } : {}) }),
        };
      },
      /** 审批：建一条 pending，推 prompt 事件，等界面决定；返回 "allowed" / "rejected" */
      approval({ tool, detail, reason }) {
        return createPrompt(sink, botId, { kind: "approval", tool, detail, reason, payload: "" });
      },
      /** 提问（生图确认等）：返回回答 { answers: [{ id, selected, custom }] } */
      question(questions, tool = "ask_user_question") {
        return createPrompt(sink, botId, { kind: "question", tool, detail: questions.map((q) => q.question).join(" / "), reason: "", payload: JSON.stringify(questions) });
      },
      file: (name) => sink.files.push(name),
    };
    return api;
  }

  async function createPrompt(sink, botId, { kind, tool, detail, reason, payload }) {
    const st = S();
    const now = Date.now();
    const pending = new Set([...st.approvals.values()].filter((r) => r.status === "pending").map((r) => r.code));
    let code;
    do code = String(crypto.randomInt(1000, 10000));
    while (pending.has(code));
    const row = { id: crypto.randomUUID(), code, kind, botId, conversationId: sink.convId, sessionId: "dsh-demo-session", tool, detail, reason, payload, status: "pending", result: "", decidedBy: "", createdAt: now, expiresAt: now + 10 * min, decidedAt: 0 };
    st.approvals.set(row.id, row);
    sink.prompt({ kind, prompt: kind === "approval" ? `需要你的批准 · ${code}` : "", requestId: row.id, code });
    events.emit("prompt", row);
    await new Promise((resolve) => {
      const on = (r) => {
        if (r.id !== row.id) return;
        events.off("decided", on);
        resolve();
      };
      events.on("decided", on);
    });
    return kind === "question" ? JSON.parse(row.result || "{}") : row.status;
  }

  /** 网页对话的一条消息：登记 LiveTurn（发消息的请求先订阅，再开始跑脚本，第一步不会漏掉） */
  function startWebTurn(botId, text) {
    const st = S();
    const conv = ensureConv(st, botId, "web", "console", "控制台");
    const t = new LiveTurn(conv.id, botId, text, conv.messages.at(-1)?.id ?? 0);
    st.turns.set(conv.id, [...(st.turns.get(conv.id) ?? []), t]);
    return t;
  }
  /** 跑场景脚本，结束时存消息、发 done */
  async function runWebTurn(t) {
    const st = S();
    const { botId, userText: text } = t;
    const conv = st.convs.get(t.convId);
    const sink = {
      convId: conv.id,
      files: [],
      activity: (s) => {
        t.steps.set(s.id, s);
        t.emit("activity", s);
      },
      prompt: (p) => {
        t.prompts.push(p);
        t.emit("prompt", p);
      },
    };
    const api = turnApi(sink, botId);
    let final = "";
    api.reply = (s) => (final = s);
    t.emit("typing", { on: true });
    const script = ctl.onChat || defaultChat;
    try {
      await script(api, botId, text);
    } catch (e) {
      final = `⚠️ ${e.message}`;
      ctl.errors.push(`脚本出错：${e.stack || e.message}`);
    }
    final ||= "（已完成，没有文字回复）";
    const steps = [...api.steps.values()];
    addMessage(st, conv.id, "user", text, undefined, t.startedAt);
    addMessage(st, conv.id, "assistant", final, steps);
    t.text = final;
    t.emit("text", { text: final, final: true });
    for (const name of sink.files) {
      t.files.push(name);
      t.emit("file", { name });
    }
    t.emit("typing", { on: false });
    // 结束：先移出登记，再通知订阅者
    const rest = (st.turns.get(conv.id) ?? []).filter((x) => x !== t);
    if (rest.length) st.turns.set(conv.id, rest);
    else st.turns.delete(conv.id);
    t.done = true;
    t.emit("done", { conversationId: conv.id });
    t.subs.clear();
    events.emit("turn-end", { botId, convId: conv.id, text: final });
  }

  /** 没有场景脚本时的回复：一步模型请求 + 一句话 */
  async function defaultChat(t, botId, text) {
    log(`（没有为「${text}」写脚本，用默认回复）`);
    const m = t.model(bot(botId)?.defaultModel || D.BOT_MODEL);
    await sleep(1500);
    m.done("好的，我来处理。");
    t.reply("好的，我来处理。这是演示环境里的默认回复。");
  }

  /** 微信发来一条消息：建会话、跑回合（信息面板的 /turn 能看到进度），结束时存消息并回给手机 */
  ctl.weixinInbound = async (botId, userId, text) => {
    const st = S();
    const conv = ensureConv(st, botId, "weixin", userId, userId);
    conv.updatedAt = Date.now();
    const at = Date.now();
    const turn = { since: at, lastProgress: 0, steps: new Map() };
    st.agentTurns.set(conv.id, turn);
    const sink = {
      convId: conv.id,
      files: [],
      activity: (s) => {
        turn.steps.set(s.id, s);
        turn.lastProgress = Date.now();
      },
      prompt: () => {},
    };
    const api = turnApi(sink, botId);
    let final = "";
    api.reply = (s) => (final = s);
    await (ctl.onWeixin || defaultChat)(api, botId, text);
    addMessage(st, conv.id, "user", text, undefined, at);
    addMessage(st, conv.id, "assistant", final, [...api.steps.values()]);
    st.agentTurns.delete(conv.id);
    events.emit("weixin-reply", { botId, userId, text: final });
    return final;
  };

  async function readJson(req) {
    let body = "";
    for await (const c of req) body += c;
    return body ? JSON.parse(body) : {};
  }
  function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  async function api(req, res, url) {
    const st = S();
    const p = url.pathname.slice("/amb/api".length);
    const m = req.method || "GET";
    const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
    if ((m === "POST" || m === "PUT" || m === "PATCH") && !/^application\/json/i.test(String(req.headers["content-type"] || ""))) throw new HttpError(415, "需要 application/json");
    const delay = ctl.delays[p];
    if (delay) await sleep(delay);

    if (p === "/status" && m === "GET")
      return send(res, 200, { version: "0.1.13", dataDir: "C:\\Users\\demo\\AppData\\Roaming\\anymodel bot\\data", username: "demo", desktop: true, platform: "win32", gateway: { mode: "managed", state: "running", lastError: "", restarts: 0 }, notices: [] });
    if (p === "/models" && m === "GET") return send(res, 200, { models: st.mf.connected ? D.MODEL_IDS : [] });
    if (p === "/models/info" && m === "GET") return send(res, 200, { models: st.mf.connected ? D.modelInfo() : {} });
    if (p === "/media/models" && m === "GET") return send(res, 200, st.mf.connected ? D.MEDIA : { image: [], video: [], recommended: { image: "", video: "" } });
    if (p === "/modelflare" && m === "GET") return send(res, 200, mfStatus());
    if (p === "/pwsh" && m === "GET") return send(res, 200, { applicable: false, checking: false, dismissed: false });
    if (seg[0] === "account") {
      const sub = seg.slice(1).join("/");
      if (sub === "" && m === "GET") return send(res, 200, status());
      if (sub === "refresh" && m === "POST") return send(res, 200, status());
      if (sub === "login" && m === "POST") {
        st.account = { ...st.account, state: "signing_in", error: "" };
        events.emit("login-started");
        return send(res, 200, { ...status(), loginUrl: LOGIN_URL, opened: true });
      }
      if (sub === "login/cancel" && m === "POST") {
        st.account = { ...st.account, state: "signed_out" };
        return send(res, 200, status());
      }
      if (sub === "usage" && m === "GET") return send(res, 200, D.usage(Math.min(30, Math.max(1, Number(url.searchParams.get("days") || 7)))));
      if (sub === "notifications" && m === "GET") return send(res, 200, { data: { unread_count: 0, items: [] } });
      if (sub === "invite" && m === "GET") return send(res, 200, { code: "DEMO26", url: "https://modelflare.dev/sign-up?aff=DEMO26&utm_source=anymodelbot&utm_medium=app&utm_campaign=invite" });
      if (sub === "budgets" && m === "GET") return send(res, 200, { budgets: {} });
      if (sub === "alerts" && m === "PUT") {
        const b = await readJson(req);
        if (b.lowBalanceUsd !== undefined) st.account.alerts.lowBalanceUsd = Number(b.lowBalanceUsd);
        if (b.lowBalancePush !== undefined) st.account.alerts.push = !!b.lowBalancePush;
        return send(res, 200, status());
      }
    }
    if (p === "/settings") {
      if (m === "PUT") {
        const b = await readJson(req);
        for (const k of ["defaultModel", "imageModel", "videoModel", "closeToTray", "zoom"]) if (b[k] !== undefined) st.settings[k] = b[k];
        events.emit("settings", b);
      }
      return send(res, 200, {
        ...st.settings,
        autostart: { supported: true, on: true },
        desktop: true,
        webSearch: { provider: "auto", url: "", keyTail: "", keyRejected: false },
        listen: { host: "127.0.0.1", port: 52713, tokenRequired: true },
        dataDir: "C:\\Users\\demo\\AppData\\Roaming\\anymodel bot\\data",
      });
    }
    if (p === "/agent" && m === "GET") {
      const busy = new Set([...st.turns.values()].flat().map((t) => t.botId));
      for (const c of st.agentTurns.keys()) busy.add(c.split(":")[0]);
      return send(res, 200, { enabled: true, runtime: "found", hosts: Object.fromEntries(st.bots.map((b) => [b.id, { state: "running", activeTurns: busy.has(b.id) ? 1 : 0 }])), busy: [...busy] });
    }
    if (seg[0] === "approvals") {
      if (seg.length === 1 && m === "GET") {
        const want = url.searchParams.get("status");
        const b = url.searchParams.get("bot");
        return send(res, 200, { approvals: [...st.approvals.values()].filter((r) => (!want || r.status === want) && (!b || r.botId === b)).map(publicApproval) });
      }
      const row = st.approvals.get(seg[1]);
      if (!row) throw new HttpError(404, "请求不存在");
      if (seg.length === 2 && m === "GET") return send(res, 200, { approval: publicApproval(row) });
      if (seg.length === 3 && m === "POST" && (seg[2] === "approve" || seg[2] === "deny")) {
        if (row.status !== "pending") throw new HttpError(409, "请求已处理或已过期");
        Object.assign(row, { status: seg[2] === "approve" ? "allowed" : "rejected", decidedBy: "web", decidedAt: Date.now() });
        events.emit("decided", row);
        return send(res, 200, { approval: publicApproval(row) });
      }
      if (seg.length === 3 && m === "POST" && seg[2] === "answer") {
        if (row.status !== "pending") throw new HttpError(409, "请求已处理或已过期");
        const b = await readJson(req);
        Object.assign(row, { status: "answered", result: JSON.stringify({ answers: b.answers || [] }), decidedBy: "web", decidedAt: Date.now() });
        events.emit("decided", row);
        return send(res, 200, { approval: publicApproval(row) });
      }
    }
    if (seg[0] === "conversations") {
      if (seg.length === 1 && m === "GET") {
        const b = url.searchParams.get("bot");
        const list = [...st.convs.values()].filter((c) => !b || c.botId === b).sort((x, y) => y.updatedAt - x.updatedAt);
        return send(res, 200, { conversations: list.map(publicConv) });
      }
      const conv = st.convs.get(seg[1]);
      if (seg.length === 3 && seg[2] === "messages" && m === "GET") {
        if (!conv) throw new HttpError(404, "会话不存在");
        return send(res, 200, { conversation: publicConv(conv), messages: conv.messages.map(publicMsg) });
      }
      if (seg.length === 5 && seg[2] === "messages" && seg[4] === "activity" && m === "GET") {
        const msg = conv?.messages.find((x) => x.id === Number(seg[3]));
        return send(res, 200, { steps: msg ? msg.activity : [] });
      }
      if (seg.length === 3 && seg[2] === "turn" && m === "GET") {
        const t = st.agentTurns.get(seg[1]);
        return send(res, 200, { turn: t ? { since: t.since, lastProgress: t.lastProgress, steps: [...t.steps.values()] } : null });
      }
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") return send(res, 200, { stopped: false });
    }
    // 已授权的数据账号（设置 › 连接）
    if (p === "/connections" && m === "GET") {
      return send(res, 200, { accounts: [
        { id: "demo-notion", service: "notion", number: 1, label: "产品团队", method: "oauth", needsReauth: false },
        { id: "demo-feishu", service: "feishu", number: 1, label: "工作飞书", method: "oauth", needsReauth: false },
      ] });
    }
    // 全局渠道账号（设置 › 连接）
    if (seg[0] === "channel-accounts") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { accounts: channelAccounts() });
      if (p === "/channel-accounts/new-key" && m === "POST") return send(res, 200, { key: "acct_demo" });
      const key = decodeURIComponent(seg[1] ?? "");
      const sub = seg.slice(2).join("/");
      if (sub === "channels" && m === "GET") return send(res, 200, channelStatus(key));
      if (sub === "access" && m === "GET") {
        const owner = channelOf(key).account ? { peer: D.WEIXIN_USER.slice(0, 8), name: "演示用户", via: "login" } : null;
        return send(res, 200, { policy: "owner-allowlist", owners: { weixin: owner, feishu: null, telegram: null, slack: null, discord: null }, requests: [], entries: [] });
      }
      if (sub === "weixin/login" && m === "POST") {
        const ch = channelOf(key);
        ch.login = { state: "wait", message: "请用微信扫码", qrDataUrl: fakeQrDataUrl(), refreshCount: 0 };
        events.emit("weixin-login", key);
        return send(res, 200, ch.login);
      }
      if (sub === "weixin/login" && m === "GET") return send(res, 200, channelOf(key).login ?? { state: "idle" });
      if (sub === "weixin/cancel" && m === "POST") {
        channelOf(key).login = { state: "cancelled", message: "已取消", refreshCount: 0 };
        return send(res, 200, { ok: true });
      }
    }
    if (seg[0] === "bots") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { bots: st.bots });
      const b = bot(seg[1]);
      if (!b) throw new HttpError(404, "机器人不存在");
      const sub = seg.slice(2).join("/");
      if (seg.length === 2 && m === "GET") return send(res, 200, { bot: b });
      if (seg.length === 2 && m === "PUT") {
        const body = await readJson(req);
        for (const k of ["name", "systemPrompt", "defaultModel"]) if (body[k] !== undefined) b[k] = String(body[k]);
        return send(res, 200, { bot: b });
      }
      if (sub === "settings" && m === "GET") {
        const cu = b.settings.computerUse;
        return send(res, 200, {
          settings: b.settings,
          computerUse: { available: true, enabled: cu.enabled, active: cu.enabled, backend: "cua", selectedBackend: "cua", approval: cu.approval, reason: `Cua Driver: 可用（Windows）；${cu.approval === "ask-input" ? "点击/输入前先问我" : "操作自动执行"}`, backends: [{ id: "cua", available: true, reason: "Cua Driver: 可用（Windows）" }] },
        });
      }
      if (sub === "memory" && m === "GET") {
        const entries = (st.memory[b.id] || []).map((text) => ({ text, meta: "source: web; added: 2026-10-20" }));
        return send(res, 200, { scopes: [{ kind: "team", id: "", label: "团队记忆", entries: [], topics: [] }, { kind: "bot", id: b.id, label: "机器人记忆", entries, topics: [] }], journal: [], steward: [] });
      }
      if (sub === "chat" && m === "GET") {
        const conv = st.convs.get(`${b.id}:web:console`);
        const turns = st.turns.get(`${b.id}:web:console`) ?? [];
        const cut = turns[0]?.afterMessageId ?? Infinity;
        return send(res, 200, {
          conversationId: `${b.id}:web:console`,
          model: conv?.model ?? "",
          messages: conv ? conv.messages.filter((x) => x.id <= cut).map(publicMsg) : [],
          pending: [...st.approvals.values()].filter((r) => r.status === "pending" && r.conversationId === `${b.id}:web:console`).map(publicApproval),
          live: turns.map((t) => t.snapshot()),
        });
      }
      if (sub === "chat/model" && m === "PUT") {
        const body = await readJson(req);
        const conv = ensureConv(st, b.id, "web", "console", "控制台");
        conv.model = String(body.model ?? "");
        events.emit("model", { botId: b.id, model: conv.model });
        return send(res, 200, { conversationId: conv.id, model: conv.model });
      }
      if (sub === "chat/live" && m === "GET") {
        const turns = st.turns.get(`${b.id}:web:console`) ?? [];
        const want = url.searchParams.get("turn");
        const t = want ? turns.find((x) => x.id === want) : turns[0];
        const out = sse(res);
        if (!t) return out.end("done", { conversationId: `${b.id}:web:console`, ended: true });
        out.send("snapshot", t.snapshot());
        const fn = (e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d));
        t.subs.add(fn);
        res.on("close", () => t.subs.delete(fn));
        return;
      }
      if (sub === "chat/stream" && m === "POST") {
        const body = await readJson(req);
        const text = String(body.text ?? "").trim();
        if (!text) throw new HttpError(400, "内容为空");
        const out = sse(res);
        events.emit("chat", { botId: b.id, text });
        // 命令（/new 等）由运行时直接回一句，不进代理回合
        if (text.startsWith("/")) {
          const cmd = text.split(/\s+/)[0].toLowerCase();
          const reply = cmd === "/new" ? "✅ 已开始新的一段对话（旧对话已归档并留下交接便条，长期记忆保留）" : cmd === "/help" ? "可用命令：/model /new /reset /status /stop /help" : `已执行 ${cmd}`;
          await sleep(cmd === "/new" ? 700 : 200);
          out.send("text", { text: reply, final: true });
          events.emit("command", { botId: b.id, cmd });
          return out.end("done", { conversationId: `${b.id}:web:console` });
        }
        const t = startWebTurn(b.id, text);
        const fn = (e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d));
        t.subs.add(fn);
        res.on("close", () => t.subs.delete(fn));
        await runWebTurn(t);
        return;
      }
    }
    ctl.unimplemented.push(`${m} ${url.pathname}${url.search}`);
    log(`未实现的接口：${m} ${url.pathname}${url.search}`);
    throw new HttpError(404, "not found");
  }

  function serveFile(res, file) {
    fs.readFile(file, (err, data) => {
      if (err) {
        ctl.unimplemented.push(`静态文件缺失：${file}`);
        return void res.writeHead(404).end("not found");
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(data);
    });
  }
  const safeJoin = (dir, rel) => path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    ctl.requests.push({ at: Date.now(), method: req.method, path: url.pathname + url.search });
    events.emit("request", { at: Date.now(), method: req.method, path: url.pathname });
    if (url.pathname.startsWith("/amb/api/")) {
      api(req, res, url).catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) ctl.errors.push(`${url.pathname}: ${e.stack || e.message}`);
        if (!res.headersSent) send(res, status, { error: e.message });
      });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return serveFile(res, path.join(uiDir, "index.html"));
    if (url.pathname.startsWith("/amb/static/")) return serveFile(res, safeJoin(uiDir, url.pathname.slice("/amb/static/".length)));
    if (url.pathname.startsWith("/amb/vendor/")) {
      const f = vendor[url.pathname.slice("/amb/vendor/".length)];
      return f ? serveFile(res, f) : void res.writeHead(404).end();
    }
    if (url.pathname === "/__stage/" || url.pathname === "/__stage") return serveFile(res, path.join(stageDir, "index.html"));
    if (url.pathname.startsWith("/__stage/")) return serveFile(res, safeJoin(stageDir, url.pathname.slice("/__stage/".length)));
    if (url.pathname.startsWith("/__repo-assets/")) return serveFile(res, safeJoin(path.join(REPO, "assets"), url.pathname.slice("/__repo-assets/".length)));
    if (url.pathname.startsWith("/__docs/")) return serveFile(res, safeJoin(path.join(REPO, "docs", "assets"), url.pathname.slice("/__docs/".length)));
    if (url.pathname.startsWith("/__gen/") && genDir) return serveFile(res, safeJoin(genDir, url.pathname.slice("/__gen/".length)));
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
    ctl.unimplemented.push(`${req.method} ${url.pathname}`);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  ctl.url = `http://${host}:${server.address().port}/`;
  ctl.close = () =>
    new Promise((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    });
  return ctl;
}

// —— 命令行：单独启动，手动浏览演示数据 ——
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const scene = arg("--scene", "demo");
  const port = Number(arg("--port", 4173));
  // 场景脚本（录制工具的其余部分）还没写好时，所有提示词都用默认回复
  const { scripts } = await import("./scenes.mjs").catch(() => ({ scripts: {} }));
  const ctl = await startMock({ port, scene, sceneOpts: { memory: D.MEMORY_PREFS }, log: (s) => console.log(s) });
  // 手动浏览时：已知的演示提示词都用 scenes.mjs 里的脚本回答
  if (scripts[Object.keys(scripts)[0]]) ctl.onChat = (t, botId, text) => (scripts[text] || scripts.__default)(t, botId, text);
  console.log(`模拟后端已启动：${ctl.url}（场景 ${scene}）`);
  if (scene !== "demo") console.log("登录页点「登录 / 注册 Modelflare」后，在这个终端按回车模拟浏览器里的授权。");
  process.stdin.on("data", () => {
    ctl.authorize();
    console.log("已模拟授权");
  });
}
