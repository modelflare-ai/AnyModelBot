// 信息面板：点悬浮胶囊或 ⌘⇧I 打开，面板自己的 ✕ 关闭，⚙ 进机器人设置。
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Badge, Button, Sheet, Spinner, Skeleton } from "../components/ui.js";
import { ActivityLine, currentStep, useNow } from "../components/activity.js";
import { PromptCard } from "./chat.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, saved, toast } from "../lib/store.js";
import { fmtAgo, fmtDur, fmtTime } from "../lib/format.js";
import { CHANNEL_NAME } from "../lib/access.js";
import { TaskRow } from "../components/tasks.js";

export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fn().then((d) => (setData(d), setErr(""))).catch((e) => setErr(e.message)), deps);
  useEffect(() => {
    load();
    if (!ms) return;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [data, err, load];
}

function FeishuRow({ bot, st, reload }) {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState(bot.feishuAppId);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setAppId(bot.feishuAppId), [bot.id, bot.feishuAppId]);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/bots/${bot.id}/feishu`, { method: "PUT", body: { appId, appSecret: secret } });
      setSecret("");
      saved();
      reload();
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  const clear = async () => {
    if (!(await confirmSheet({ title: "断开飞书？", body: "会清除这个机器人的飞书 App ID 与 App Secret。", confirmLabel: "断开", danger: true }))) return;
    try {
      await api(`/bots/${bot.id}/feishu`, { method: "DELETE" });
      setAppId("");
      reload();
    } catch (e) {
      failed(e);
    }
  };
  return html`<div class="row clickable" onClick=${() => setOpen((v) => !v)} role="button" tabindex="0" aria-expanded=${open}
      onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((v) => !v))}>
      <div class="who"><div class="name">飞书</div><div class="sub">${st.detail || (bot.feishuAppId ? bot.feishuAppId : "长连接接收消息")}</div></div>
      <${Badge} s=${st.state} />
    </div>
    ${open && html`<div class="row-edit">
      <label>App ID<input class="field mono" value=${appId} placeholder="cli_xxxxxxxx" onInput=${(e) => setAppId(e.target.value)} /></label>
      <label>App Secret${bot.feishuAppSecretMasked && html`<span class="hint">已保存 ${bot.feishuAppSecretMasked}，留空则不修改</span>`}
        <input class="field mono" type="password" autocomplete="off" value=${secret} onInput=${(e) => setSecret(e.target.value)} /></label>
      <div class="actions">
        <button type="button" class="btn primary" disabled=${!appId.trim() || busy} onClick=${save}>${busy ? html`<${Spinner} />` : "保存并连接"}</button>
        ${bot.feishuAppId && html`<button type="button" class="text danger" onClick=${clear}>断开</button>`}
      </div>
      <p class="hint">在飞书开放平台启用「机器人」，事件订阅选「使用长连接接收事件」并订阅 <code>im.message.receive_v1</code>；权限：<code>im:message.p2p_msg:readonly</code>、<code>im:message:send_as_bot</code>、<code>cardkit:card:write</code>。</p>
    </div>`}`;
}

function WeixinRow({ bot, st, reload }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const login = st.login;
  const active = login && ["fetching", "wait", "scaned", "need_verifycode"].includes(login.state);
  useEffect(() => {
    if (!active) return;
    setOpen(true);
    const t = setInterval(reload, 1500);
    return () => clearInterval(t);
  }, [active]);
  const call = (path, body = {}) => api(`/bots/${bot.id}/weixin${path}`, { method: path ? "POST" : "PUT", body }).then(reload).catch(failed);
  const logout = async () => {
    if (await confirmSheet({ title: "解除微信绑定？", body: "解除后需要重新扫码才能收发微信消息。", confirmLabel: "解除绑定", danger: true })) call("/logout");
  };
  return html`<div class="row clickable" onClick=${() => setOpen((v) => !v)} role="button" tabindex="0" aria-expanded=${open}
      onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((v) => !v))}>
      <div class="who"><div class="name">微信</div><div class="sub">${st.account ? `已绑定 ${st.account.ilinkBotId}` : st.detail || "iLink 官方通道"}</div></div>
      <${Badge} s=${st.state} />
    </div>
    ${open && html`<div class="row-edit">
      ${login && login.state !== "idle" && html`<div class="actions"><${Badge} s=${login.state} /><span class="hint">${login.message}</span></div>`}
      ${active && login.qrDataUrl && html`<img class="panel-qr" src=${login.qrDataUrl} alt="微信登录二维码" />
        <p class="hint">用微信扫一扫，然后在手机上确认。</p>`}
      ${login && login.state === "need_verifycode" && html`<div class="actions"><input class="field" style="width:140px" placeholder="验证码" value=${code} onInput=${(e) => setCode(e.target.value)} />
        <button type="button" class="btn" onClick=${() => call("/verify", { code }).then(() => setCode(""))}>提交</button></div>`}
      ${st.account && st.account.pausedUntil > Date.now() && html`<p class="hint">暂停至 ${fmtTime(st.account.pausedUntil)}</p>`}
      <div class="actions">
        ${active ? html`<button type="button" class="btn" onClick=${() => call("/cancel")}>取消</button>` : html`<button type="button" class="btn primary" onClick=${() => call("/login")}>${st.account ? "重新扫码登录" : "扫码登录"}</button>`}
        <button type="button" class="text" onClick=${() => call("", { enabled: !bot.weixinEnabled })}>${bot.weixinEnabled ? "停用微信渠道" : "启用微信渠道"}</button>
        ${st.account && html`<button type="button" class="text danger" onClick=${logout}>解除绑定</button>`}
      </div>
      ${st.quota && st.quota.length > 0 && html`<p class="hint">出站配额（每条入站消息后 24 小时内最多 10 条）：${st.quota.map((q) => `${q.userId.slice(0, 8)}… 剩 ${q.remaining} 条`).join("；")}</p>`}
    </div>`}`;
}

/**
 * 使用请求：不在允许名单里的人给机器人发了消息（他只收到一句"还没被允许"，没有调用模型）。
 * 允许 / 拒绝；这个渠道还没有主人时，可以把他设为主人（多半就是你自己）。
 */
function AccessRequests({ botId, data, reload }) {
  const [busy, setBusy] = useState("");
  if (!data || !data.requests.length) return null;
  const act = async (r, what) => {
    setBusy(r.id + what);
    try {
      await api(`/bots/${botId}/access/${encodeURIComponent(r.id)}/${what}`, { method: "POST", body: {} });
      toast(what === "approve" ? `已允许「${r.who}」` : what === "deny" ? `已拒绝「${r.who}」` : `已设为${CHANNEL_NAME[r.channel]}主人`);
    } catch (e) {
      failed(e);
    }
    setBusy("");
    reload();
  };
  return html`<div class="list-head">使用请求<span class="badge count warn">${data.requests.length}</span></div>
    <div class="stack">${data.requests.map((r) => {
      const noOwner = !data.owners[r.channel];
      return html`<div key=${r.id} class="stack approval" style="--gap: var(--space-1)">
        <span class="hint">${CHANNEL_NAME[r.channel] || r.channel} · ${fmtAgo(r.createdAt)}${r.requests > 1 ? ` · 发了 ${r.requests} 条消息` : ""}</span>
        <div class="card">
          <div class="meta"><span>想使用这个机器人 · 配对码 <span class="num">${r.code}</span></span></div>
          <div class="q">${r.who}</div>
          ${r.text && html`<div class="q-detail selectable">「${r.text}」</div>`}
          <div class="actions">
            <${Button} variant="primary" loading=${busy === r.id + "approve"} disabled=${!!busy} onClick=${() => act(r, "approve")}>允许</${Button}>
            <${Button} loading=${busy === r.id + "deny"} disabled=${!!busy} onClick=${() => act(r, "deny")}>拒绝</${Button}>
            ${noOwner && html`<${Button} variant="ghost" loading=${busy === r.id + "owner"} disabled=${!!busy} onClick=${() => act(r, "owner")}>设为主人</${Button}>`}
          </div>
          <span class="hint">${noOwner
            ? `${CHANNEL_NAME[r.channel]}还没有主人。如果这是你自己，点「设为主人」，以后的请求也会发给你。`
            : `他只收到一句提示，没有调用模型。主人在聊天里回复「同意 ${r.code}」也可以。`}</span>
        </div>
      </div>`;
    })}</div>`;
}

/** 没发出去的消息：出站队列还在重试的，和发不出去、已经放弃的（附原因，可以"知道了"） */
function Undelivered({ botId }) {
  const [d, , reload] = usePoll(() => api(`/bots/${botId}/outbox`), 8000, [botId]);
  if (!d || (!d.failed.length && !d.waiting.length)) return null;
  const dismiss = async (f) => {
    try {
      await api(`/bots/${botId}/outbox/${encodeURIComponent(f.id)}/dismiss`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      failed(e);
    }
  };
  return html`<div class="list-head">没发出去的消息${d.failed.length > 0 && html`<span class="badge count warn">${d.failed.length}</span>`}</div>
    <div class="list">
      ${d.waiting.map((w) => html`<div key=${w.id} class="row compact">
        <div class="who">
          <div class="name">发给${w.to}</div>
          <div class="sub">${w.preview || "（空）"}</div>
          <div class="sub wrap">${w.attempts ? `第 ${w.attempts} 次没发出去，稍后自动重试` : "等渠道连上后发送"}${w.error ? `：${w.error}` : ""}</div>
        </div>
        <${Badge} s="retrying" />
      </div>`)}
      ${d.failed.map((f) => html`<div key=${f.id} class="row compact">
        <div class="who">
          <div class="name">发给${f.to} · ${fmtAgo(f.updatedAt)}</div>
          <div class="sub">${f.preview || "（空）"}</div>
          <div class="sub wrap">${f.error}</div>
        </div>
        <button type="button" class="text" onClick=${() => dismiss(f)}>知道了</button>
      </div>`)}
    </div>`;
}

function MemorySection({ botId }) {
  const [d, err, reload] = usePoll(() => api(`/bots/${botId}/memory`), 0, [botId]);
  const forget = async (sc, text, topic) => {
    if (!(await confirmSheet({ title: "删除这条记忆？", body: text, confirmLabel: "删除", danger: true }))) return;
    try {
      await api(`/bots/${botId}/memory/forget`, { method: "POST", body: { kind: sc.kind, id: sc.id, match: text, topic } });
      toast("已删除");
      reload();
    } catch (e) {
      failed(e);
    }
  };
  const all = d ? d.scopes.flatMap((sc) => [...sc.entries.map((e) => ({ sc, e })), ...sc.topics.flatMap((t) => t.entries.map((e) => ({ sc, e, topic: t.name })))]) : [];
  return html`<div class="list-head">记忆<span class="grow"></span><button type="button" class="icon-btn" title="刷新" aria-label="刷新记忆" onClick=${reload}><${Icon} name="refresh" size=${13} /></button></div>
    <div class="list">
      ${!d && html`<div class="row"><span class="hint">${err || "加载中…"}</span></div>`}
      ${d && !all.length && html`<div class="row"><span class="hint">还没有长期记忆</span></div>`}
      ${all.slice(0, 30).map(({ sc, e, topic }) => html`<div class="row compact">
        <div class="who"><div class="sub wrap selectable tone-fg t-control">${e.text}</div><div class="sub">${sc.label}${topic ? " · " + topic : ""}</div></div>
        <button type="button" class="icon-btn" title="删除" aria-label="删除这条记忆" onClick=${() => forget(sc, e.text, topic)}><${Icon} name="trash" size=${13} /></button>
      </div>`)}
    </div>`;
}

/** 会话里正在处理的那一轮：处理了多久、多久没进展、现在在做什么（可展开看步骤），以及"中止" */
function LiveTurn({ turn, convId }) {
  const now = useNow(true);
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    try {
      await api(`/conversations/${encodeURIComponent(convId)}/stop`, { method: "POST", body: {} });
    } catch (e) {
      failed(`中止失败：${e.message}`);
      setStopping(false);
    }
  };
  const idle = turn.lastProgress ? now - turn.lastProgress : 0;
  const cur = currentStep(turn.steps);
  const label = `正在处理 ${fmtDur(now - turn.since)}${cur ? ` · ${cur}` : turn.lastProgress ? "" : " · 等代理进程接手"}`;
  return html`<div class="transcript-turn">
    <${ActivityLine} label=${label} live steps=${turn.steps} />
    <div class="cluster">
      ${idle >= 60_000 && html`<span class="hint">${fmtDur(idle)}没有新进展</span>`}
      <span class="grow"></span>
      <${Button} variant="danger" size="sm" loading=${stopping} onClick=${stop}>中止</${Button}>
    </div>
  </div>`;
}

function ConversationSheet({ conv, onClose }) {
  const enc = encodeURIComponent(conv.id);
  const [d, , reload] = usePoll(() => api(`/conversations/${enc}/messages`), 0, [conv.id]);
  const [t] = usePoll(() => api(`/conversations/${enc}/turn`), 2000, [conv.id]);
  const turn = t?.turn;
  // 那一轮结束了：重新取消息，新回复和它的处理过程出现在列表里
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current && !turn) reload();
    busy.current = !!turn;
  }, [!!turn]);
  return html`<${Sheet} title=${`${CHANNEL_NAME[conv.channel] || conv.channel} · ${conv.title || conv.peerId}`} wide onClose=${onClose}>
    <div class="transcript">
      ${!d && html`<span class="hint">加载中…</span>`}
      ${d && !d.messages.length && !turn && html`<span class="hint">没有消息</span>`}
      ${d && d.messages.map((m) => html`<div class=${`transcript-msg${m.role === "user" ? " user" : ""}`}>
        ${m.steps && html`<${ActivityLine} label="处理过程" count=${m.steps} load=${() => api(`/conversations/${enc}/messages/${m.id}/activity`).then((x) => x.steps)} />`}
        <div class="bubble selectable">${m.content}</div>
        <div class="hint">${fmtTime(m.createdAt)}</div>
      </div>`)}
      ${turn && html`<${LiveTurn} key=${turn.since} turn=${turn} convId=${conv.id} />`}
    </div>
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>关闭</button></div>
  <//>`;
}

export function InfoPanel({ bot, onClose, onOpenBotSettings, onOpenChat }) {
  const [detail, , reloadDetail] = usePoll(() => api(`/bots/${bot.id}`), 5000, [bot.id]);
  const [appr, , reloadAppr] = usePoll(() => api(`/approvals?status=pending&bot=${encodeURIComponent(bot.id)}`), 4000, [bot.id]);
  const [convs] = usePoll(() => api(`/conversations?bot=${encodeURIComponent(bot.id)}`), 8000, [bot.id]);
  const [access, , reloadAccess] = usePoll(() => api(`/bots/${encodeURIComponent(bot.id)}/access`), 4000, [bot.id]);
  // 后台任务：只列还没结束的（进行中、等你的）；一个都没有时不显示这一组
  const [taskData, , reloadTasks] = usePoll(() => api(`/tasks?bot=${encodeURIComponent(bot.id)}&limit=20`), 4000, [bot.id]);
  const tasks = (taskData?.tasks || []).filter((t) => t.stage.group !== "ended");
  const [viewing, setViewing] = useState(null);
  const pending = (appr && appr.approvals) || [];
  return html`<aside class="panel" aria-label="信息面板">
    <div class="panel-head">
      <span class="title">${bot.name}</span>
      <button type="button" class="icon-btn" title="机器人设置" aria-label="机器人设置" onClick=${onOpenBotSettings}><${Icon} name="gear" /></button>
      <button type="button" class="icon-btn" title="关闭（⌘⇧I）" aria-label="关闭信息面板" onClick=${onClose}><${Icon} name="close" /></button>
    </div>
    <div class="panel-body">
      <div class="list-head">渠道</div>
      <div class="list">
        ${detail && detail.bot
          ? html`<${FeishuRow} bot=${detail.bot} st=${detail.channels.feishu} reload=${reloadDetail} /><${WeixinRow} bot=${detail.bot} st=${detail.channels.weixin} reload=${reloadDetail} />`
          : html`<div class="row"><${Skeleton} w="50%" /></div><div class="row"><${Skeleton} w="40%" /></div>`}
      </div>

      <${AccessRequests} botId=${bot.id} data=${access} reload=${reloadAccess} />

      <div class="list-head">待审批${pending.length > 0 && html`<span class="badge count warn">${pending.length}</span>`}</div>
      ${pending.length
        ? html`<div class="stack">${pending.map((a) => html`<div key=${a.id} class="stack approval" style="--gap: var(--space-1)">
            <span class="hint">${CHANNEL_NAME[a.conversationId.split(":")[1]] || ""} · ${fmtAgo(a.createdAt)} · 截止 ${fmtTime(a.expiresAt).slice(-8, -3)}</span>
            <${PromptCard} requestId=${a.id} fallback="" />
          </div>`)}
          <button type="button" class="text" style="justify-self:start" onClick=${reloadAppr}>刷新</button></div>`
        : html`<div class="list"><div class="row"><span class="hint">没有待处理的审批</span></div></div>`}

      ${tasks.length > 0 && html`<div class="list-head">任务</div>
        <div class="list">${tasks.slice(0, 8).map((t) => html`<${TaskRow} key=${t.id} task=${t} onChanged=${reloadTasks}
          onOpen=${() => (t.channel === "web" ? onOpenChat() : setViewing((convs?.conversations || []).find((c) => c.id === t.conversationId) || null))} />`)}</div>`}

      <${Undelivered} botId=${bot.id} />

      <${MemorySection} botId=${bot.id} />

      <div class="list-head">最近会话</div>
      <div class="list">
        ${!convs && html`<div class="row"><${Skeleton} w="60%" /></div>`}
        ${convs && !convs.conversations.length && html`<div class="row"><span class="hint">还没有会话</span></div>`}
        ${convs && convs.conversations.slice(0, 12).map((c) => html`<div class="row compact clickable" role="button" tabindex="0"
            onClick=${() => (c.channel === "web" ? onOpenChat() : setViewing(c))} onKeyDown=${(e) => e.key === "Enter" && (c.channel === "web" ? onOpenChat() : setViewing(c))}>
          <div class="who"><div class="name">${CHANNEL_NAME[c.channel] || c.channel} · ${c.title || c.peerId}</div><div class="sub">${(c.lastMessage || "").replace(/^⚠️\s*/, "") || "（空）"}</div></div>
          <span class="hint num">${fmtAgo(c.updatedAt)}</span>
        </div>`)}
      </div>
    </div>
    ${viewing && html`<${ConversationSheet} conv=${viewing} onClose=${() => setViewing(null)} />`}
  </aside>`;
}
