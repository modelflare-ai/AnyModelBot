// anymodel bot 管理界面：Preact + htm（无构建步骤，原生 ES 模块）
// 壳：左栏机器人/会话 · 中间对话 · 右栏上下文（渠道/设置/记忆/审批）
import { h, render } from "preact";
import { useEffect, useState, useCallback, useRef, useMemo } from "preact/hooks";
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
const initials = (name) => {
  const s = String(name || "?").trim();
  return s.slice(0, 1).toUpperCase();
};

function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fn().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)), deps);
  useEffect(() => { load(); if (!ms) return; const t = setInterval(load, ms); return () => clearInterval(t); }, [load]);
  return [data, err, load];
}

function useTheme() {
  const read = () => localStorage.getItem("amb-theme") || "system";
  const [mode, setMode] = useState(read);
  const apply = (m) => {
    const root = document.documentElement;
    if (m === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", m);
  };
  useEffect(() => { apply(mode); localStorage.setItem("amb-theme", mode); }, [mode]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (mode === "system") apply("system"); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [mode]);
  const resolved = useMemo(() => {
    if (mode === "light" || mode === "dark") return mode;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [mode]);
  return [mode, setMode, resolved];
}

const Mark = () => html`<div class="brand-mark" aria-hidden="true">
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M4 12.5V5.5L9 10l5-4.5v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</div>`;

// ---------------- 概览（管理视图） ----------------
const PRESETS = ["deepseek", "openai", "anthropic", "google", "moonshot-cn", "qwen-cn", "zhipu", "volcengine", "xai", "minimax-cn", "groq", "mistral"];
function Overview({ goChat }) {
  const [st] = usePoll(() => api("/status"), 3000);
  const [models, , reloadModels] = usePoll(() => api("/models"), 0);
  const [preset, setPreset] = useState("deepseek");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  if (!st) return html`<p class="muted">加载中…</p>`;
  const mp = st.magpie;
  const add = async () => {
    setMsg("添加中…");
    try { const r = await api("/providers", { method: "POST", body: { preset, apiKey: key } }); setKey(""); setMsg(`✓ 已添加 ${r.id}`); setTimeout(reloadModels, 800); }
    catch (e) { setMsg("✗ " + e.message); }
  };
  return html`
    <div class="page-head"><h2>概览</h2><p class="sub">网关状态与快速添加服务商</p></div>
    ${st.notices.slice(0, 3).map((n) => html`<div class="notice">${fmt(n.at)} ${n.text}</div>`)}
    <div class="kpi-strip">
      <div class="kpi"><div class="lbl">网关</div><div class="val">${mp.state}<span class="unit">${mp.mode || ""}</span></div></div>
      <div class="kpi"><div class="lbl">服务商</div><div class="val">${mp.providers ?? "—"}</div></div>
      <div class="kpi"><div class="lbl">重启</div><div class="val">${mp.restarts ?? 0}</div></div>
      <div class="kpi"><div class="lbl">版本</div><div class="val" style="font-size:14px">${st.version || "—"}</div></div>
    </div>
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
      <p class="muted">${msg} 更多配置请打开「模型」面板（magpie）。</p>
    </div>`}
    <div class="card muted">数据目录：<code>${st.dataDir}</code> · 版本 ${st.version}
      <div style="margin-top:8px"><button onClick=${goChat}>返回对话</button></div>
    </div>`;
}

// ---------------- 机器人编辑（右栏 / 管理） ----------------
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
    <h3>身份</h3>
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

function BotSettings({ botId, models }) {
  const [d, err, reload] = usePoll(() => api(`/bots/${botId}/settings`), 0, [botId]);
  const [msg, setMsg] = useState("");
  if (!d) return html`<div class="card"><p class="muted">${err || "加载中…"}</p></div>`;
  const s = d.settings, cu = d.computerUse;
  const put = async (body) => {
    try { await api(`/bots/${botId}/settings`, { method: "PUT", body }); setMsg("✓ 已保存（空闲时自动生效）"); reload(); }
    catch (e) { setMsg("✗ " + e.message); }
  };
  const chk = (label, val, body) => html`<label class="row" style="font-weight:normal"><input type="checkbox" style="width:auto" checked=${val} onChange=${(e) => put(body(e.target.checked))} /> ${label}</label>`;
  return html`<div class="card"><h3>设置</h3>
    <label>权限预设</label>
    <select value=${s.permission} onChange=${(e) => put({ permission: e.target.value })}>
      <option value="workspace">工作区可写（默认）：只能改本机器人工作区，越界操作需审批</option>
      <option value="readonly">只读：不能改文件，命令在只读沙箱中运行</option>
    </select>
    <label>长期记忆</label>
    ${chk("启用长期记忆（remember / forget / recall）", s.memory.enabled, (v) => ({ memory: { enabled: v } }))}
    ${chk("回合结束后自动整理记忆", s.memory.review, (v) => ({ memory: { review: v } }))}
    ${chk("允许写入团队记忆（所有机器人共享）", s.memory.teamWrite, (v) => ({ memory: { teamWrite: v } }))}
    <label>上下文管家</label>
    ${chk("上下文变长时自动压缩或开新段（带交接便条）", s.steward.enabled, (v) => ({ steward: { enabled: v } }))}
    <label>后台小任务模型（记忆整理 / 管家 / 交接）</label>
    <select value=${s.utilityModel} onChange=${(e) => put({ utilityModel: e.target.value })}>
      <option value="">与对话模型相同</option>
      ${[...new Set([...(models || []), s.utilityModel].filter(Boolean))].map((m) => html`<option value=${m}>${m}</option>`)}
    </select>
    <label>电脑操作（Computer Use）</label>
    <p class="muted">${cu ? (cu.available ? "✓ " : "✗ ") + cu.reason : ""}</p>
    ${cu && cu.notice && html`<p class="muted">ℹ️ ${cu.notice}</p>`}
    ${chk("启用电脑操作", s.computerUse.enabled, (v) => ({ computerUse: { enabled: v } }))}
    <select value=${s.computerUse.backend} disabled=${!s.computerUse.enabled} onChange=${(e) => put({ computerUse: { backend: e.target.value } })}>
      <option value="cua">Cua Driver（默认，随附，macOS / Windows / Linux）</option>
      ${cu && cu.backends.some((b) => b.id === "codex") && html`<option value="codex">Codex Computer Use 桥（仅 macOS${cu.backends.find((b) => b.id === "codex").available ? "" : "，本机不可用"}）</option>`}
    </select>
    <select value=${s.computerUse.approval} disabled=${!s.computerUse.enabled} onChange=${(e) => put({ computerUse: { approval: e.target.value } })}>
      <option value="auto">所有操作自动执行，无需审批（默认）</option>
      <option value="ask-input">点击、输入等改变界面的操作先问我；读取界面仍自动</option>
    </select>
    <p class="muted">${msg}</p>
  </div>`;
}

function MemoryViewer({ botId }) {
  const [d, err, reload] = usePoll(() => api(`/bots/${botId}/memory`), 0, [botId]);
  const [msg, setMsg] = useState("");
  if (!d) return html`<div class="card"><p class="muted">${err || "加载中…"}</p></div>`;
  const forget = async (sc, text, topic) => {
    if (!confirm(`删除这条记忆？\n${text}`)) return;
    try { await api(`/bots/${botId}/memory/forget`, { method: "POST", body: { kind: sc.kind, id: sc.id, match: text, topic } }); setMsg("✓ 已删除"); reload(); }
    catch (e) { setMsg("✗ " + e.message); }
  };
  const list = (sc, entries, topic) => entries.map((e) => html`<div class="row"><span class="grow">• ${e.text}</span><button onClick=${() => forget(sc, e.text, topic)}>删除</button></div>`);
  return html`<div class="card"><h3>长期记忆 <button class="ghost" onClick=${reload}>刷新</button></h3>
    ${d.scopes.map((sc) => html`<div><b>${sc.label}</b>
      ${!sc.entries.length && !sc.topics.length ? html`<p class="muted">（空）</p>` : ""}
      ${list(sc, sc.entries)}
      ${sc.topics.map((t) => html`<div class="muted">主题：${t.name}</div>${list(sc, t.entries, t.name)}`)}
    </div>`)}
    <p class="muted">${msg}</p>
    <details><summary>变更日志（最近 ${d.journal.length} 条）</summary>
      ${d.journal.slice().reverse().map((j) => html`<div class="muted">${fmt(j.at)} ${j.op === "add" ? "＋" : "－"} [${j.file}] ${j.text} · ${j.by}</div>`)}</details>
    <details><summary>上下文管家记录（最近 ${d.steward.length} 条）</summary>
      ${d.steward.slice().reverse().map((l) => html`<div class="muted">${fmt(l.at)} ${l.action} ${l.detail}</div>`)}</details>
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
    <p class="muted">需在飞书开放平台启用「机器人」能力，事件订阅选择「使用长连接接收事件」并订阅 <code>im.message.receive_v1</code>；权限：<code>im:message.p2p_msg:readonly</code>、<code>im:message:send_as_bot</code>、<code>cardkit:card:write</code>。</p>
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
    ${active && login.qrDataUrl && html`<p><img class="qr" src=${login.qrDataUrl} alt="微信登录二维码" /></p><p class="muted">用微信扫一扫，然后在手机上确认。</p>`}
    ${login && login.state === "need_verifycode" && html`<div class="row"><input style="width:160px" value=${code} placeholder="验证码" onInput=${(e) => setCode(e.target.value)} /><button onClick=${verify}>提交</button></div>`}
    <div class="row" style="margin-top:12px">
      ${active ? html`<button onClick=${cancel}>取消</button>` : html`<button class="pri" onClick=${start}>${st.account ? "重新扫码登录" : "扫码登录"}</button>`}
      ${st.account && html`<button class="danger" onClick=${logout}>解除绑定</button>`}
      <button onClick=${toggle}>${bot.weixinEnabled ? "停用微信渠道" : "启用微信渠道"}</button>
    </div>
    ${st.quota && st.quota.length > 0 && html`<h4>出站配额（每条入站消息后 24 小时内最多 10 条）</h4>
      <table>${st.quota.map((q) => html`<tr><td><code>${q.userId}</code></td><td>剩余 <b>${q.remaining}</b> 条</td><td class="muted">窗口开始 ${fmt(q.windowStartedAt)}</td></tr>`)}</table>`}
  </div>`;
}

function ChannelsPanel({ botId }) {
  const [bots] = usePoll(() => api("/bots"), 0);
  const bot = bots && (bots.bots.find((b) => b.id === botId) || bots.bots[0]);
  const [detail, , reload] = usePoll(() => (bot ? api(`/bots/${bot.id}`) : Promise.resolve(null)), 5000, [bot && bot.id]);
  if (!bots || !bot) return html`<p class="muted">加载中…</p>`;
  return html`<div>
    ${detail && detail.bot && html`<${Feishu} bot=${detail.bot} st=${detail.channels.feishu} reload=${reload} /><${Weixin} bot=${detail.bot} st=${detail.channels.weixin} reload=${reload} />`}
  </div>`;
}

// ---------------- 会话列表（管理视图） ----------------
function ConversationsAdmin({ onOpen }) {
  const [data] = usePoll(() => api("/conversations"), 5000);
  const [sel, setSel] = useState("");
  const [msgs] = usePoll(() => (sel ? api(`/conversations/${encodeURIComponent(sel)}/messages`) : Promise.resolve(null)), 5000, [sel]);
  if (!data) return html`<p class="muted">加载中…</p>`;
  return html`<div>
    <div class="page-head"><h2>会话</h2><p class="sub">全部渠道会话</p></div>
    <div class="cols">
      <div class="card list" style="padding:0">${data.conversations.length === 0 && html`<p class="muted" style="padding:12px">暂无会话</p>`}
        ${data.conversations.map((c) => html`<div class="item ${c.id === sel ? "sel" : ""}" onClick=${() => { setSel(c.id); onOpen && onOpen(c); }}>
          <b>${c.channel}</b> · ${c.title || c.peerId}<div class="muted">${c.botId} · ${c.messageCount} 条 · ${fmt(c.updatedAt)}${c.model ? " · " + c.model : ""}</div>
          <div class="muted">${c.lastMessage}</div></div>`)}</div>
      <div class="card">${msgs ? html`<div class="msgs">${msgs.messages.map((m) => html`<div class=${`msg-row ${m.role}`}><div class=${`msg-bubble ${m.role === "assistant" ? "cardish" : ""}`}>${m.content}</div></div>`)}</div>` : html`<p class="muted">选择左侧会话查看消息</p>`}</div>
    </div>
  </div>`;
}

// ---------------- 审批（DSH，原生面板） ----------------
const AP_STATUS = { pending: "待处理", allowed: "已批准", rejected: "已拒绝", expired: "已过期", answered: "已回答", cancelled: "已取消" };
function QuestionForm({ a, done }) {
  const [text, setText] = useState("");
  const submit = async () => { await api(`/approvals/${a.id}/answer`, { method: "POST", body: { text } }); setText(""); done(); };
  return html`<div>${(a.questions || []).map((q, i) => html`<div><b>${i + 1}. ${q.question}</b>${(q.options || []).map((o, j) => html`<div class="muted">　${j + 1}) ${o.label}${o.description ? " — " + o.description : ""}</div>`)}</div>`)}
    <div class="row" style="margin-top:8px"><input class="grow" style="width:auto" placeholder="每行回答一个问题，可填选项编号" value=${text} onInput=${(e) => setText(e.target.value)} /><button class="pri" disabled=${!text.trim()} onClick=${submit}>回答</button></div></div>`;
}
function Approvals({ botId, compact }) {
  const [filter, setFilter] = useState("pending");
  const [data, err, reload] = usePoll(() => api(`/approvals${filter ? "?status=" + filter : ""}`), 3000, [filter]);
  const [agent] = usePoll(() => api("/agent"), 5000);
  const decide = async (id, ok) => { try { await api(`/approvals/${id}/${ok ? "approve" : "deny"}`, { method: "POST", body: {} }); } catch (e) { alert(e.message); } reload(); };
  const list = (data && data.approvals || []).filter((a) => !botId || a.botId === botId);
  return html`<div>
    ${!compact && html`<div class="page-head"><h2>审批</h2><p class="sub">DSH 代理请求与提问</p></div>`}
    ${agent && html`<div class="card"><h3>代理（DSH） ${agent.enabled ? html`<span class="badge running">已启用</span>` : html`<span class="badge disabled">未启用（普通对话）</span>`}</h3>
      ${Object.entries(agent.hosts || {}).filter(([id]) => !botId || id === botId).map(([id, h]) => html`<div class="row"><b>${id}</b><${Badge} s=${h.state} /><span class="muted">pid ${h.pid || "-"} · ${h.model || "默认模型"} · 重启 ${h.restarts} 次 · 进行中 ${h.activeTurns}${h.lastError ? " · " + h.lastError : ""}</span></div>`)}
      ${!compact && html`<p class="muted">每个机器人一个 DSH 子进程；bash 默认在工作区沙箱中运行，越权操作会在这里和聊天中请求批准（10 分钟未处理自动拒绝）。</p>`}
    </div>`}
    <div class="row" style="margin-bottom:12px"><span class="muted">筛选</span><select style="width:140px" value=${filter} onChange=${(e) => setFilter(e.target.value)}>
      <option value="pending">待处理</option><option value="">全部</option><option value="allowed">已批准</option><option value="rejected">已拒绝</option><option value="expired">已过期</option></select>
      ${err && html`<span class="muted">✗ ${err}</span>`}</div>
    ${list.length === 0 && html`<div class="empty">暂无${filter ? AP_STATUS[filter] : ""}请求</div>`}
    ${list.map((a) => html`<div class="card">
      <div class="row"><b>${a.kind === "question" ? "提问" : "需批准"} · ${a.code}</b><span class="badge ${a.status === "pending" ? "connecting" : a.status === "allowed" || a.status === "answered" ? "connected" : "disabled"}">${AP_STATUS[a.status] || a.status}</span>
        <span class="muted">${a.botId} · ${a.conversationId} · ${fmt(a.createdAt)}${a.status === "pending" ? " · 截止 " + fmt(a.expiresAt) : a.decidedBy ? " · " + a.decidedBy : ""}</span></div>
      ${a.kind === "approval" && html`<p><code>${a.tool}</code> <code>${a.detail}</code></p>${a.reason && html`<p class="muted">${a.reason}</p>`}`}
      ${a.kind === "question" && (a.status === "pending" ? html`<${QuestionForm} a=${a} done=${reload} />` : html`<p class="muted">${(a.questions || []).map((q) => q.question).join(" / ")}</p>`)}
      ${a.kind === "approval" && a.status === "pending" && html`<div class="row"><button class="pri" onClick=${() => decide(a.id, true)}>批准（仅本次）</button><button class="danger" onClick=${() => decide(a.id, false)}>拒绝</button></div>`}
    </div>`)}
  </div>`;
}

const Models = ({ theme }) => html`<iframe class="magpie" src=${`/magpie/?theme=${theme}`} title="magpie"></iframe>`;

// ---------------- 中栏：对话 ----------------
function ChatPane({ bot, onToggleRight, rightOpen }) {
  const [text, setText] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState("");
  const bottom = useRef(null);
  const ta = useRef(null);

  // 加载该机器人最近的网页测试会话消息（若有）
  useEffect(() => {
    setLog([]); setConvId(""); setText("");
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/conversations");
        const mine = (data.conversations || []).filter((c) => c.botId === bot.id && c.channel === "web");
        mine.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (mine[0]) {
          setConvId(mine[0].id);
          const m = await api(`/conversations/${encodeURIComponent(mine[0].id)}/messages`);
          if (!cancelled) setLog((m.messages || []).map((x) => ({ role: x.role, content: x.content, at: x.createdAt })));
        }
      } catch (_) { /* 首次无会话 */ }
    })();
    return () => { cancelled = true; };
  }, [bot.id]);

  useEffect(() => { bottom.current?.scrollIntoView?.({ behavior: "smooth" }); }, [log, busy]);

  const sendMsg = async () => {
    const t = text.trim(); if (!t || busy) return;
    setText(""); setBusy(true);
    setLog((l) => [...l, { role: "user", content: t, at: Date.now() }]);
    try {
      const r = await api(`/bots/${bot.id}/chat`, { method: "POST", body: { text: t } });
      if (r.conversationId) setConvId(r.conversationId);
      const extra = [...(r.prompts || []).map((p) => ({ role: "prompt", content: p.prompt }))];
      const files = (r.files || []).map((f) => ({ role: "progress", content: "📎 已交付文件：" + f + "（微信/飞书会直接发送；网页端请在机器人工作区查看）" }));
      setLog((l) => [...l, ...extra, { role: "assistant", content: r.reply, at: Date.now() }, ...files]);
    } catch (e) {
      setLog((l) => [...l, { role: "assistant", content: "✗ " + e.message }]);
    }
    setBusy(false);
    ta.current?.focus?.();
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  };

  return html`<div class="center">
    <div class="chat-head">
      <div>
        <div class="chat-head-title">${bot.name}</div>
        <div class="chat-head-sub">${bot.defaultModel || "自动模型"}${convId ? " · " + convId.slice(0, 8) : ""}</div>
      </div>
      <div class="chat-head-actions">
        <button class="ghost" title="切换右侧面板" onClick=${onToggleRight}>${rightOpen ? "收起详情" : "详情"}</button>
      </div>
    </div>
    <div class="transcript">
      ${log.length === 0 && !busy && html`<div class="empty-chat">
        <h2>和 ${bot.name} 对话</h2>
        <p>直接在此测试机器人。支持 <code>/model</code>、<code>/reset</code>、<code>/new</code>、<code>/help</code>。渠道与审批在右侧。</p>
      </div>`}
      ${log.map((m) => {
        if (m.role === "progress" || m.role === "prompt") {
          return html`<div class="msg-progress"><span class="dot"></span><span>${m.content}</span></div>`;
        }
        const role = m.role === "user" ? "user" : "assistant";
        return html`<div class=${`msg-row ${role}`}>
          <div class=${`msg-bubble ${role === "assistant" ? "" : ""}`}>${m.content}</div>
          ${m.at && html`<div class="msg-meta">${fmt(m.at)}</div>`}
        </div>`;
      })}
      ${busy && html`<div class="msg-progress"><span class="dot"></span><span>正在处理…</span></div>`}
      <div ref=${bottom}></div>
    </div>
    <div class="composer-wrap">
      <div class="composer">
        <textarea ref=${ta} rows="1" placeholder=${`给 ${bot.name} 发消息`}
          value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey}
          disabled=${busy} />
        <button class="send" disabled=${busy || !text.trim()} onClick=${sendMsg}>${busy ? "…" : "发送"}</button>
      </div>
      <div class="composer-hint">Enter 发送 · Shift+Enter 换行 · 指令 /model /reset /new /help</div>
    </div>
  </div>`;
}

// ---------------- 右栏 ----------------
function RightPane({ bot, models, onSaved, onDeleted, onClose }) {
  const [tab, setTab] = useState("channels");
  const tabs = [
    ["channels", "渠道"],
    ["settings", "设置"],
    ["memory", "记忆"],
    ["approvals", "审批"],
  ];
  return html`<div class="right">
    <div class="right-head">
      <div class="row" style="gap:8px">
        <div class="thread-avatar" style="width:28px;height:28px;font-size:12px">${initials(bot.name)}</div>
        <b style="font-size:14px">${bot.name}</b>
      </div>
      <button class="icon-btn" title="收起" onClick=${onClose}>✕</button>
    </div>
    <div class="right-tabs">
      ${tabs.map(([id, label]) => html`<button class=${tab === id ? "on" : ""} onClick=${() => setTab(id)}>${label}</button>`)}
    </div>
    <div class="right-body">
      ${tab === "channels" && html`<${ChannelsPanel} botId=${bot.id} />`}
      ${tab === "settings" && html`
        <${BotEditor} key=${bot.id} bot=${bot} models=${models} onSaved=${onSaved} onDeleted=${onDeleted} />
        <${BotSettings} key=${"s" + bot.id} botId=${bot.id} models=${models} />
      `}
      ${tab === "memory" && html`<${MemoryViewer} key=${"m" + bot.id} botId=${bot.id} />`}
      ${tab === "approvals" && html`<${Approvals} botId=${bot.id} compact=${true} />`}
    </div>
  </div>`;
}

// ---------------- 左栏 ----------------
function LeftRail({ bots, botId, setBotId, view, setView, themeMode, setThemeMode, onCreate }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [convs] = usePoll(() => api("/conversations"), 8000);
  const byBot = useMemo(() => {
    const map = {};
    for (const c of (convs && convs.conversations) || []) {
      if (!map[c.botId] || (c.updatedAt || 0) > (map[c.botId].updatedAt || 0)) map[c.botId] = c;
    }
    return map;
  }, [convs]);

  const create = async () => {
    const n = name.trim(); if (!n) return;
    setCreating(true);
    try {
      const r = await api("/bots", { method: "POST", body: { name: n } });
      setName(""); setCreating(false); onCreate(r.bot);
    } catch (e) { alert(e.message); setCreating(false); }
  };

  return html`<div class="left">
    <div class="brand">
      <${Mark} />
      <div>
        <div class="brand-name">anymodel bot</div>
        <div class="brand-sub">本机控制台</div>
      </div>
    </div>
    <div class="left-tools">
      <button class="grow-btn" onClick=${() => setCreating((v) => !v)}>+ 新建机器人</button>
    </div>
    ${creating && html`<div style="padding:0 12px 10px">
      <div class="row">
        <input class="grow" style="width:auto" placeholder="名称" value=${name} onInput=${(e) => setName(e.target.value)}
          onKeyDown=${(e) => e.key === "Enter" && create()} />
        <button class="pri" disabled=${!name.trim()} onClick=${create}>创建</button>
      </div>
    </div>`}
    <div class="left-scroll">
      <div class="sec-label">机器人</div>
      ${(bots || []).map((b) => {
        const snip = byBot[b.id];
        return html`<button type="button" class=${`thread ${view === "chat" && b.id === botId ? "sel" : ""}`}
          onClick=${() => { setBotId(b.id); setView("chat"); }}>
          <div class="thread-avatar">${initials(b.name)}</div>
          <div class="thread-body">
            <div class="thread-title">${b.name}</div>
            <div class="thread-snip">${snip ? (snip.lastMessage || snip.title || snip.channel) : (b.defaultModel || "尚未对话")}</div>
            ${snip && html`<div class="thread-meta">${fmt(snip.updatedAt)}</div>`}
          </div>
        </button>`;
      })}
      ${(!bots || bots.length === 0) && html`<div class="empty" style="margin:8px">还没有机器人。点上方新建。</div>`}
    </div>
    <div class="left-foot">
      <div class="admin-links">
        <button class=${view === "overview" ? "on" : ""} onClick=${() => setView("overview")}>概览</button>
        <button class=${view === "approvals" ? "on" : ""} onClick=${() => setView("approvals")}>审批</button>
        <button class=${view === "conversations" ? "on" : ""} onClick=${() => setView("conversations")}>会话</button>
        <button class=${view === "models" ? "on" : ""} onClick=${() => setView("models")}>模型</button>
      </div>
      <div class="theme-toggle">
        <button class=${themeMode === "system" ? "on" : ""} onClick=${() => setThemeMode("system")}>系统</button>
        <button class=${themeMode === "light" ? "on" : ""} onClick=${() => setThemeMode("light")}>浅色</button>
        <button class=${themeMode === "dark" ? "on" : ""} onClick=${() => setThemeMode("dark")}>深色</button>
      </div>
    </div>
  </div>`;
}

// ---------------- 外壳 ----------------
function App() {
  const hash = location.hash.slice(1);
  const initialView = ["overview", "approvals", "conversations", "models", "chat"].includes(hash) ? hash : "chat";
  const [view, setViewRaw] = useState(initialView);
  const [botId, setBotId] = useState("");
  const [rightOpen, setRightOpen] = useState(true);
  const [themeMode, setThemeMode, theme] = useTheme();
  const [botsData, , reloadBots] = usePoll(() => api("/bots"), 0);
  const [models] = usePoll(() => api("/models"), 0);

  const setView = (v) => { setViewRaw(v); location.hash = v; };
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (["overview", "approvals", "conversations", "models", "chat"].includes(h)) setViewRaw(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const bots = botsData ? botsData.bots : null;
  const bot = bots && (bots.find((b) => b.id === botId) || bots[0]);
  useEffect(() => { if (bot && bot.id !== botId) setBotId(bot.id); }, [bots, bot && bot.id]);

  const shellClass = [
    "app",
    view === "chat" && !rightOpen ? "right-collapsed" : "",
    view === "models" ? "view-models" : "",
    view !== "chat" && view !== "models" ? "view-admin" : "",
  ].filter(Boolean).join(" ");

  return html`<div class=${shellClass}>
    <${LeftRail}
      bots=${bots || []}
      botId=${bot && bot.id}
      setBotId=${setBotId}
      view=${view}
      setView=${setView}
      themeMode=${themeMode}
      setThemeMode=${setThemeMode}
      onCreate=${(b) => { reloadBots(); setBotId(b.id); setView("chat"); }}
    />
    ${view === "chat" && bot && html`<${ChatPane} bot=${bot} rightOpen=${rightOpen} onToggleRight=${() => setRightOpen((v) => !v)} />`}
    ${view === "chat" && !bot && html`<div class="center"><div class="transcript"><div class="empty-chat"><h2>开始</h2><p>在左侧新建一个机器人，然后直接对话。</p></div></div></div>`}
    ${view === "overview" && html`<div class="admin-pane"><${Overview} goChat=${() => setView("chat")} /></div>`}
    ${view === "approvals" && html`<div class="admin-pane"><${Approvals} /></div>`}
    ${view === "conversations" && html`<div class="admin-pane"><${ConversationsAdmin} onOpen=${(c) => { setBotId(c.botId); setView("chat"); }} /></div>`}
    ${view === "models" && html`<div class="admin-pane bleed"><${Models} theme=${theme} /></div>`}
    ${view === "chat" && rightOpen && bot && html`<${RightPane}
      bot=${bot}
      models=${models && models.models}
      onSaved=${() => reloadBots()}
      onDeleted=${() => { setBotId(""); reloadBots(); }}
      onClose=${() => setRightOpen(false)}
    />`}
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
