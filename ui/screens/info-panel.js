// 信息面板：点悬浮胶囊或 ⌘⇧I 打开，面板自己的 ✕ 关闭，⚙ 进机器人设置。
import { useCallback, useEffect, useState } from "preact/hooks";
import { html, Icon, Badge, Sheet, Spinner, Skeleton } from "../components/ui.js";
import { PromptCard } from "./chat.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, saved, toast } from "../lib/store.js";
import { markDone } from "../lib/guide.js";
import { fmtAgo, fmtClock, fmtTime } from "../lib/format.js";
import { t } from "../lib/i18n.js";

export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fn().then((d) => (setData(d), setErr(""))).catch((e) => setErr(e.message)), deps);
  useEffect(() => {
    load();
    if (!ms) return;
    const timer = setInterval(load, ms);
    return () => clearInterval(timer);
  }, [load, ms]);
  return [data, err, load];
}

/** 渠道名（渲染时取，跟着界面语言）；不认识的渠道原样显示 id */
const channelName = (c) => ({ web: t("info.channel.web"), feishu: t("info.channel.feishu"), weixin: t("info.channel.weixin") })[c];

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
    if (!(await confirmSheet({ title: t("info.feishu.disconnectTitle"), body: t("info.feishu.disconnectBody"), confirmLabel: t("info.feishu.disconnect"), danger: true }))) return;
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
      <div class="who"><div class="name">${t("info.channel.feishu")}</div><div class="sub">${st.detail || (bot.feishuAppId ? bot.feishuAppId : t("info.feishu.sub"))}</div></div>
      <${Badge} s=${st.state} />
    </div>
    ${open && html`<div class="row-edit">
      <label>App ID<input class="field mono" value=${appId} placeholder="cli_xxxxxxxx" onInput=${(e) => setAppId(e.target.value)} /></label>
      <label>App Secret${bot.feishuAppSecretMasked && html`<span class="hint">${t("info.feishu.secretSaved", { masked: bot.feishuAppSecretMasked })}</span>`}
        <input class="field mono" type="password" autocomplete="off" value=${secret} onInput=${(e) => setSecret(e.target.value)} /></label>
      <div class="actions">
        <button type="button" class="btn primary" disabled=${!appId.trim() || busy} onClick=${save}>${busy ? html`<${Spinner} />` : t("info.feishu.saveConnect")}</button>
        ${bot.feishuAppId && html`<button type="button" class="text danger" onClick=${clear}>${t("info.feishu.disconnect")}</button>`}
      </div>
      <p class="hint">${t("info.feishu.setupHint", { event: html`<code>im.message.receive_v1</code>`, p1: html`<code>im:message.p2p_msg:readonly</code>`, p2: html`<code>im:message:send_as_bot</code>`, p3: html`<code>cardkit:card:write</code>` })}</p>
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
    const timer = setInterval(reload, 1500);
    return () => clearInterval(timer);
  }, [active]);
  const call = (path, body = {}) => api(`/bots/${bot.id}/weixin${path}`, { method: path ? "POST" : "PUT", body }).then(reload).catch(failed);
  const logout = async () => {
    if (await confirmSheet({ title: t("info.weixin.unlinkTitle"), body: t("info.weixin.unlinkBody"), confirmLabel: t("info.weixin.unlink"), danger: true })) call("/logout");
  };
  return html`<div class="row clickable" data-guide="weixin" onClick=${() => setOpen((v) => !v)} role="button" tabindex="0" aria-expanded=${open}
      onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((v) => !v))}>
      <div class="who"><div class="name">${t("info.channel.weixin")}</div><div class="sub">${st.account ? t("info.weixin.linked", { id: st.account.ilinkBotId }) : st.detail || t("info.weixin.sub")}</div></div>
      <${Badge} s=${st.state} />
    </div>
    ${open && html`<div class="row-edit">
      ${login && login.state !== "idle" && html`<div class="actions"><${Badge} s=${login.state} /><span class="hint">${login.message}</span></div>`}
      ${active && login.qrDataUrl && html`<img class="panel-qr" src=${login.qrDataUrl} alt=${t("info.weixin.qrAlt")} />
        <p class="hint">${t("info.weixin.scanHint")}</p>`}
      ${login && login.state === "need_verifycode" && html`<div class="actions"><input class="field" style="width:140px" placeholder=${t("info.weixin.verifyCode")} value=${code} onInput=${(e) => setCode(e.target.value)} />
        <button type="button" class="btn" onClick=${() => call("/verify", { code }).then(() => setCode(""))}>${t("info.weixin.submit")}</button></div>`}
      ${st.account && st.account.pausedUntil > Date.now() && html`<p class="hint">${t("info.weixin.pausedUntil", { time: fmtTime(st.account.pausedUntil) })}</p>`}
      <div class="actions">
        ${active ? html`<button type="button" class="btn" onClick=${() => call("/cancel")}>${t("common.cancel")}</button>` : html`<button type="button" class="btn primary" onClick=${() => call("/login")}>${st.account ? t("info.weixin.relogin") : t("info.weixin.login")}</button>`}
        <button type="button" class="text" onClick=${() => call("", { enabled: !bot.weixinEnabled })}>${bot.weixinEnabled ? t("info.weixin.disable") : t("info.weixin.enable")}</button>
        ${st.account && html`<button type="button" class="text danger" onClick=${logout}>${t("info.weixin.unlink")}</button>`}
      </div>
      ${st.quota && st.quota.length > 0 && html`<p class="hint">${t("info.weixin.quota", { list: st.quota.map((q) => t("info.weixin.quotaItem", { user: q.userId.slice(0, 8), count: q.remaining })).join(t("info.weixin.quotaSep")) })}</p>`}
    </div>`}`;
}

function MemorySection({ botId }) {
  const [d, err, reload] = usePoll(() => api(`/bots/${botId}/memory`), 0, [botId]);
  const forget = async (sc, text, topic) => {
    if (!(await confirmSheet({ title: t("info.memory.deleteTitle"), body: text, confirmLabel: t("common.delete"), danger: true }))) return;
    try {
      await api(`/bots/${botId}/memory/forget`, { method: "POST", body: { kind: sc.kind, id: sc.id, match: text, topic } });
      toast(t("info.memory.deleted"));
      reload();
    } catch (e) {
      failed(e);
    }
  };
  const all = d ? d.scopes.flatMap((sc) => [...sc.entries.map((e) => ({ sc, e })), ...sc.topics.flatMap((tp) => tp.entries.map((e) => ({ sc, e, topic: tp.name })))]) : [];
  return html`<div class="list-head">${t("info.memory.title")}<span class="grow"></span><button type="button" class="icon-btn" title=${t("common.refresh")} aria-label=${t("info.memory.refresh")} onClick=${reload}><${Icon} name="refresh" size="sm" /></button></div>
    <div class="list">
      ${!d && html`<div class="row"><span class="hint">${err || t("common.loading")}</span></div>`}
      ${d && !all.length && html`<div class="row"><span class="hint">${t("info.memory.empty")}</span></div>`}
      ${all.slice(0, 30).map(({ sc, e, topic }) => html`<div class="row compact">
        <div class="who"><div class="sub wrap selectable tone-fg t-control">${e.text}</div><div class="sub">${sc.label}${topic ? " · " + topic : ""}</div></div>
        <button type="button" class="icon-btn" title=${t("common.delete")} aria-label=${t("info.memory.delete")} onClick=${() => forget(sc, e.text, topic)}><${Icon} name="trash" size="sm" /></button>
      </div>`)}
    </div>`;
}

function ConversationSheet({ conv, onClose }) {
  const [d] = usePoll(() => api(`/conversations/${encodeURIComponent(conv.id)}/messages`), 0, [conv.id]);
  return html`<${Sheet} title=${`${channelName(conv.channel) || conv.channel} · ${conv.title || conv.peerId}`} wide onClose=${onClose}>
    <div class="transcript">
      ${!d && html`<span class="hint">${t("common.loading")}</span>`}
      ${d && !d.messages.length && html`<span class="hint">${t("info.noMessages")}</span>`}
      ${d && d.messages.map((m) => html`<div class=${`transcript-msg${m.role === "user" ? " user" : ""}`}>
        <div class="bubble selectable">${m.content}</div>
        <div class="hint">${fmtTime(m.createdAt)}</div>
      </div>`)}
    </div>
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>${t("common.close")}</button></div>
  <//>`;
}

export function InfoPanel({ bot, leaving, onClose, onOpenBotSettings, onOpenChat }) {
  const [detail, , reloadDetail] = usePoll(() => api(`/bots/${bot.id}`), 5000, [bot.id]);
  const [appr, , reloadAppr] = usePoll(() => api(`/approvals?status=pending&bot=${encodeURIComponent(bot.id)}`), 4000, [bot.id]);
  const [convs] = usePoll(() => api(`/conversations?bot=${encodeURIComponent(bot.id)}`), 8000, [bot.id]);
  const [viewing, setViewing] = useState(null);
  const pending = (appr && appr.approvals) || [];
  // 上手清单：微信扫码绑定了，或飞书连上了，就算接好了渠道
  useEffect(() => {
    const ch = detail && detail.channels;
    if (ch && (ch.weixin.account || ch.feishu.state === "connected")) markDone("weixin");
  }, [detail]);
  // leaving：关上后还在播滑出的那一小会儿（main.js 的 usePresence），不再接收操作
  return html`<aside class=${`panel${leaving ? " leaving" : ""}`} aria-label=${t("info.aria")} inert=${leaving || undefined}>
    <div class="panel-head">
      <span class="title">${bot.name}</span>
      <button type="button" class="icon-btn" title=${t("info.botSettings")} aria-label=${t("info.botSettings")} onClick=${onOpenBotSettings}><${Icon} name="gear" size="md" /></button>
      <button type="button" class="icon-btn panel-close" title=${t("info.closeTitle")} aria-label=${t("info.closeAria")} onClick=${onClose}><${Icon} name="close" size="md" /></button>
    </div>
    <div class="panel-body">
      <div class="list-head">${t("info.channels")}</div>
      <div class="list">
        ${detail && detail.bot
          ? html`<${FeishuRow} bot=${detail.bot} st=${detail.channels.feishu} reload=${reloadDetail} /><${WeixinRow} bot=${detail.bot} st=${detail.channels.weixin} reload=${reloadDetail} />`
          : html`<div class="row"><${Skeleton} w="50%" /></div><div class="row"><${Skeleton} w="40%" /></div>`}
      </div>

      <div class="list-head">${t("info.approvals")}${pending.length > 0 && html`<span class="badge count warn">${pending.length}</span>`}</div>
      ${pending.length
        ? html`<div class="stack">${pending.map((a) => html`<div key=${a.id} class="stack approval" style="--gap: var(--space-1)">
            <span class="hint">${channelName(a.conversationId.split(":")[1]) || ""} · ${fmtAgo(a.createdAt)} · ${t("info.due", { time: fmtClock(a.expiresAt) })}</span>
            <${PromptCard} requestId=${a.id} fallback="" />
          </div>`)}
          <button type="button" class="text" style="justify-self:start" onClick=${reloadAppr}>${t("common.refresh")}</button></div>`
        : html`<div class="list"><div class="row"><span class="hint">${t("info.noApprovals")}</span></div></div>`}

      <${MemorySection} botId=${bot.id} />

      <div class="list-head">${t("info.recent")}</div>
      <div class="list">
        ${!convs && html`<div class="row"><${Skeleton} w="60%" /></div>`}
        ${convs && !convs.conversations.length && html`<div class="row"><span class="hint">${t("info.noConvs")}</span></div>`}
        ${convs && convs.conversations.slice(0, 12).map((c) => html`<div class="row compact clickable" role="button" tabindex="0"
            onClick=${() => (c.channel === "web" ? onOpenChat() : setViewing(c))} onKeyDown=${(e) => e.key === "Enter" && (c.channel === "web" ? onOpenChat() : setViewing(c))}>
          <div class="who"><div class="name">${channelName(c.channel) || c.channel} · ${c.title || c.peerId}</div><div class="sub">${(c.lastMessage || "").replace(/^⚠️\s*/, "") || t("info.emptyMessage")}</div></div>
          <span class="hint num">${fmtAgo(c.updatedAt)}</span>
        </div>`)}
      </div>
    </div>
    ${viewing && html`<${ConversationSheet} conv=${viewing} onClose=${() => setViewing(null)} />`}
  </aside>`;
}
