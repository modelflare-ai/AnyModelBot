// anymodel bot 管理界面：Preact + htm（无构建步骤，原生 ES 模块）
import { h, render } from "preact";
import { useEffect, useState, useCallback } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);

async function api(path, opts = {}) {
  const res = await fetch("/amb/api" + path, {
    method: opts.method || "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const STATE_TEXT = {
  disabled: "未启用", connecting: "连接中", connected: "已连接", error: "错误", expired: "已过期", paused: "已暂停",
  login_required: "未登录", running: "运行中", starting: "启动中", restarting: "重启中", failed: "失败", stopped: "已停止",
  wait: "等待扫码", scaned: "已扫码", need_verifycode: "需验证码", confirmed: "已确认", already_bound: "已绑定", cancelled: "已取消", idle: "空闲", fetching: "获取中",
};
const Badge = ({ s }) => html`<span class="badge ${s}">${STATE_TEXT[s] || s}</span>`;
const fmt = (t) => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "");

function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fn().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)), deps);
  useEffect(() => { load(); if (!ms) return; const t = setInterval(load, ms); return () => clearInterval(t); }, [load]);
  return [data, err, load];
}

// ---------------- 概览 ----------------
const PRESETS = ["deepseek", "openai", "anthropic", "google", "moonshot-cn", "qwen-cn", "zhipu", "volcengine", "xai", "minimax-cn", "groq", "mistral"];
function Overview({ go }) {
  const [st] = usePoll(() => api("/status"), 3000);
  const [models, , reloadModels] = usePoll(() => api("/models"), 0);
  const [preset, setPreset] = useState("deepseek");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  if (!st) return html`<p>加载中…</p>`;
  const mp = st.magpie;
  const add = async () => {
    setMsg("添加中…");
    try { const r = await api("/providers", { method: "POST", body: { preset, apiKey: key } }); setKey(""); setMsg(`✓ 已添加 ${r.id}`); setTimeout(reloadModels, 800); }
    catch (e) { setMsg("✗ " + e.message); }
  };
  return html`
    ${st.notices.slice(0, 3).map((n) => html`<div class="notice">${fmt(n.at)} ${n.text}</div>`)}
    <div class="card">
      <h3>模型网关（内置 magpie）</h3>
      <div class="row"><span>状态</span><${Badge} s=${mp.state} />
        ${mp.mode === "managed" && html`<span class="muted">gateway 127.0.0.1:${mp.gatewayPort} · 重启 ${mp.restarts} 次 · 服务商 ${mp.providers} 个</span>`}
      </div>
      ${mp.lastError && html`<p class="muted">最近错误：${mp.lastError}</p>`}
      <p class="muted">可用模型：${models ? (models.models.length ? models.models.join("、") : models.error || "暂无，请添加服务商") : "…"}</p>
    </div>
    ${mp.mode === "managed" && html`<div class="card">
      <h3>快速添加模型服务商</h3>
      <div class="row">
        <select style="width:180px" value=${preset} onChange=${(e) => setPreset(e.target.value)}>${PRESETS.map((p) => html`<option>${p}</option>`)}</select>
        <input class="grow" style="width:auto" type="password" placeholder="API Key（仅保存在本机的 magpie 隔离配置中）" value=${key} onInput=${(e) => setKey(e.target.value)} />
        <button class="pri" disabled=${!key} onClick=${add}>添加</button>
      </div>
      <p class="muted">${msg} 更多服务商、自定义端点、路由与用量请到 <a href="#" onClick=${(e) => { e.preventDefault(); go("models"); }}>「模型」</a> 页（magpie 完整界面）。</p>
    </div>`}
    <div class="card muted">数据目录：<code>${st.dataDir}</code> · 版本 ${st.version}</div>`;
}

// ---------------- 机器人 ----------------
function BotEditor({ bot, models, onSaved, onDeleted }) {
  const [f, setF] = useState(bot);
  const [msg, setMsg] = useState("");
  useEffect(() => setF(bot), [bot.id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { const r = await api(`/bots/${bot.id}`, { method: "PUT", body: { name: f.name, systemPrompt: f.systemPrompt, defaultModel: f.defaultModel } }); setMsg("✓ 已保存"); onSaved(r.bot); }
    catch (e) { setMsg("✗ " + e.message); }
  };
  const del = async () => { if (confirm(`删除机器人「${bot.name}」及其全部会话？`)) { await api(`/bots/${bot.id}`, { method: "DELETE" }); onDeleted(); } };
  return html`<div class="card">
    <label>名称</label><input value=${f.name} onInput=${set("name")} />
    <label>人设 / 系统提示词</label><textarea value=${f.systemPrompt} onInput=${set("systemPrompt")} />
    <label>默认模型（会话内可用 /model 覆盖）</label>
    <select value=${f.defaultModel} onChange=${set("defaultModel")}>
      <option value="">自动（第一个可用模型）</option>
      ${[...new Set([...(models || []), f.defaultModel].filter(Boolean))].map((m) => html`<option value=${m}>${m}</option>`)}
    </select>
    <div class="row" style="margin-top:12px"><button class="pri" onClick=${save}>保存</button><button class="danger" onClick=${del}>删除</button><span class="muted">${msg}</span></div>
  </div>`;
}

function TestChat({ botId }) {
  const [text, setText] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const sendMsg = async () => {
    const t = text.trim(); if (!t) return;
    setText(""); setBusy(true); setLog((l) => [...l, { role: "user", content: t }]);
    try { const r = await api(`/bots/${botId}/chat`, { method: "POST", body: { text: t } }); setLog((l) => [...l, { role: "assistant", content: r.reply }]); }
    catch (e) { setLog((l) => [...l, { role: "assistant", content: "✗ " + e.message }]); }
    setBusy(false);
  };
  return html`<div class="card"><h3>测试对话</h3>
    <div class="msgs">${log.map((m) => html`<div class="msg ${m.role}">${m.content}</div>`)}</div>
    <div class="row" style="margin-top:12px"><input class="grow" style="width:auto" placeholder="输入消息，支持 /model /reset /help" value=${text}
      onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && !busy && sendMsg()} />
      <button class="pri" disabled=${busy} onClick=${sendMsg}>${busy ? "生成中…" : "发送"}</button></div></div>`;
}

function Bots({ botId, setBotId }) {
  const [data, , reload] = usePoll(() => api("/bots"), 0);
  const [models] = usePoll(() => api("/models"), 0);
  const [name, setName] = useState("");
  if (!data) return html`<p>加载中…</p>`;
  const bot = data.bots.find((b) => b.id === botId) || data.bots[0];
  const create = async () => { const r = await api("/bots", { method: "POST", body: { name } }); setName(""); await reload(); setBotId(r.bot.id); };
  return html`<div class="cols">
    <div>
      <div class="card list" style="padding:0">${data.bots.map((b) => html`<div class="item ${bot && b.id === bot.id ? "sel" : ""}" onClick=${() => setBotId(b.id)}><b>${b.name}</b><div class="muted">${b.id} · ${b.defaultModel || "自动模型"}</div></div>`)}</div>
      <div class="card"><label>新建机器人</label><div class="row"><input class="grow" style="width:auto" value=${name} placeholder="名称" onInput=${(e) => setName(e.target.value)} /><button disabled=${!name.trim()} onClick=${create}>创建</button></div>
      <p class="muted">一个机器人对应一个飞书应用；微信每个机器人扫码绑定一次。</p></div>
    </div>
    <div>${bot && html`<${BotEditor} key=${bot.id} bot=${bot} models=${models && models.models} onSaved=${reload} onDeleted=${() => { setBotId(""); reload(); }} /><${TestChat} key=${"c" + bot.id} botId=${bot.id} />`}</div>
  </div>`;
}

// ---------------- 渠道 ----------------
function Feishu({ bot, st, reload }) {
  const [appId, setAppId] = useState(bot.feishuAppId);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => setAppId(bot.feishuAppId), [bot.id]);
  const save = async () => { setMsg("保存并连接中…"); try { await api(`/bots/${bot.id}/feishu`, { method: "PUT", body: { appId, appSecret: secret } }); setSecret(""); setMsg("✓ 已保存"); reload(); } catch (e) { setMsg("✗ " + e.message); } };
  const clear = async () => { await api(`/bots/${bot.id}/feishu`, { method: "DELETE" }); setAppId(""); reload(); };
  return html`<div class="card"><h3>飞书 <${Badge} s=${st.state} /></h3>
    ${st.detail && html`<p class="muted">${st.detail}</p>`}
    <label>App ID</label><input value=${appId} placeholder="cli_xxxxxxxx" onInput=${(e) => setAppId(e.target.value)} />
    <label>App Secret ${bot.feishuAppSecretMasked && html`<span class="muted">（已保存 ${bot.feishuAppSecretMasked}，留空则不修改）</span>`}</label>
    <input type="password" value=${secret} onInput=${(e) => setSecret(e.target.value)} />
    <div class="row" style="margin-top:12px"><button class="pri" disabled=${!appId} onClick=${save}>保存并连接</button>${bot.feishuAppId && html`<button class="danger" onClick=${clear}>断开</button>`}<span class="muted">${msg}</span></div>
    <p class="muted">需在飞书开放平台启用「机器人」能力，事件订阅选择「使用长连接接收事件」并订阅 <code>im.message.receive_v1</code>；权限：<code>im:message.p2p_msg:readonly</code>、<code>im:message:send_as_bot</code>、<code>cardkit:card:write</code>。详见 README。</p>
  </div>`;
}

function Weixin({ bot, st, reload }) {
  const [code, setCode] = useState("");
  const login = st.login;
  const active = login && ["fetching", "wait", "scaned", "need_verifycode"].includes(login.state);
  useEffect(() => { if (!active) return; const t = setInterval(reload, 1500); return () => clearInterval(t); }, [active]);
  const start = async () => { await api(`/bots/${bot.id}/weixin/login`, { method: "POST", body: {} }); reload(); };
  const cancel = async () => { await api(`/bots/${bot.id}/weixin/cancel`, { method: "POST", body: {} }); reload(); };
  const logout = async () => { if (confirm("解除微信绑定？")) { await api(`/bots/${bot.id}/weixin/logout`, { method: "POST", body: {} }); reload(); } };
  const verify = async () => { await api(`/bots/${bot.id}/weixin/verify`, { method: "POST", body: { code } }); setCode(""); };
  const toggle = async () => { await api(`/bots/${bot.id}/weixin`, { method: "PUT", body: { enabled: !bot.weixinEnabled } }); reload(); };
  return html`<div class="card"><h3>微信（iLink 官方通道） <${Badge} s=${st.state} /></h3>
    ${st.detail && html`<p class="muted">${st.detail}</p>`}
    ${st.account && html`<p class="muted">已绑定：${st.account.ilinkBotId}${st.account.pausedUntil > Date.now() ? ` · 暂停至 ${fmt(st.account.pausedUntil)}` : ""}</p>`}
    ${login && login.state !== "idle" && html`<div class="row"><${Badge} s=${login.state} /><span>${login.message}</span></div>`}
    ${active && login.qrDataUrl && html`<p><img class="qr" src=${login.qrDataUrl} alt="微信登录二维码" /></p><p class="muted">用微信扫一扫，然后在手机上确认。二维码同时保存在数据目录。</p>`}
    ${login && login.state === "need_verifycode" && html`<div class="row"><input style="width:160px" value=${code} placeholder="验证码" onInput=${(e) => setCode(e.target.value)} /><button onClick=${verify}>提交</button></div>`}
    <div class="row" style="margin-top:12px">
      ${active ? html`<button onClick=${cancel}>取消</button>` : html`<button class="pri" onClick=${start}>${st.account ? "重新扫码登录" : "扫码登录"}</button>`}
      ${st.account && html`<button class="danger" onClick=${logout}>解除绑定</button>`}
      <button onClick=${toggle}>${bot.weixinEnabled ? "停用微信渠道" : "启用微信渠道"}</button>
    </div>
    ${st.quota && st.quota.length > 0 && html`<h4>出站配额（每条入站消息后 24 小时内最多 10 条）</h4>
      <table style="width:100%">${st.quota.map((q) => html`<tr><td><code>${q.userId}</code></td><td>剩余 <b>${q.remaining}</b> 条</td><td class="muted">窗口开始 ${fmt(q.windowStartedAt)}</td></tr>`)}</table>`}
  </div>`;
}

function Channels({ botId, setBotId }) {
  const [bots] = usePoll(() => api("/bots"), 0);
  const bot = bots && (bots.bots.find((b) => b.id === botId) || bots.bots[0]);
  const [detail, , reload] = usePoll(() => (bot ? api(`/bots/${bot.id}`) : Promise.resolve(null)), 5000, [bot && bot.id]);
  if (!bots) return html`<p>加载中…</p>`;
  return html`<div>
    <div class="row" style="margin-bottom:12px"><span>机器人</span><select style="width:240px" value=${bot && bot.id} onChange=${(e) => setBotId(e.target.value)}>${bots.bots.map((b) => html`<option value=${b.id}>${b.name}</option>`)}</select></div>
    ${detail && detail.bot && html`<${Feishu} bot=${detail.bot} st=${detail.channels.feishu} reload=${reload} /><${Weixin} bot=${detail.bot} st=${detail.channels.weixin} reload=${reload} />`}
  </div>`;
}

// ---------------- 会话 ----------------
function Conversations() {
  const [data] = usePoll(() => api("/conversations"), 5000);
  const [sel, setSel] = useState("");
  const [msgs] = usePoll(() => (sel ? api(`/conversations/${encodeURIComponent(sel)}/messages`) : Promise.resolve(null)), 5000, [sel]);
  if (!data) return html`<p>加载中…</p>`;
  return html`<div class="cols">
    <div class="card list" style="padding:0">${data.conversations.length === 0 && html`<p class="muted" style="padding:12px">暂无会话</p>`}
      ${data.conversations.map((c) => html`<div class="item ${c.id === sel ? "sel" : ""}" onClick=${() => setSel(c.id)}>
        <b>${c.channel}</b> · ${c.title || c.peerId}<div class="muted">${c.botId} · ${c.messageCount} 条 · ${fmt(c.updatedAt)}${c.model ? " · " + c.model : ""}</div>
        <div class="muted">${c.lastMessage}</div></div>`)}</div>
    <div class="card">${msgs ? html`<div class="msgs">${msgs.messages.map((m) => html`<div class="msg ${m.role}" title=${fmt(m.createdAt)}>${m.content}</div>`)}</div>` : html`<p class="muted">选择左侧会话查看消息</p>`}</div>
  </div>`;
}

// ---------------- 模型（magpie） ----------------
const Models = () => html`<iframe class="magpie" src="/magpie/" title="magpie"></iframe>`;

// ---------------- 外壳 ----------------
const TABS = [["overview", "概览"], ["bots", "机器人"], ["channels", "渠道"], ["conversations", "会话"], ["models", "模型"]];
function App() {
  const [tab, setTab] = useState(location.hash.slice(1) || "overview");
  const [botId, setBotId] = useState("");
  const go = (t) => { setTab(t); location.hash = t; };
  return html`<div class="layout">
    <nav><h1>anymodel bot</h1>${TABS.map(([id, label]) => html`<a class=${tab === id ? "active" : ""} onClick=${() => go(id)}>${label}</a>`)}</nav>
    <main class=${tab === "models" ? "full" : ""}>
      ${tab === "overview" && html`<${Overview} go=${go} />`}
      ${tab === "bots" && html`<${Bots} botId=${botId} setBotId=${setBotId} />`}
      ${tab === "channels" && html`<${Channels} botId=${botId} setBotId=${setBotId} />`}
      ${tab === "conversations" && html`<${Conversations} />`}
      ${tab === "models" && html`<${Models} />`}
    </main></div>`;
}
render(html`<${App} />`, document.getElementById("app"));
