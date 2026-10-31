// 侧栏 280（参考 Grok Bot，宽度可以拖右边的分隔条调整）：顶部只有新建按钮，常驻搜索框，
// 机器人行（头像 + 名称 + 时间 + 一行预览；悬停出现"更多"，和右键是同一份菜单），左下角账户（打开设置）。
// 新建在主区的新建页（screens/new-bot.js）；新建页打开时列表顶部有一行占位的"新机器人"。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Menu, Skeleton } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { GuidePill } from "../components/guide.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { fmtAgo } from "../lib/format.js";
import { MF_TOPUP, usd } from "../lib/links.js";
import { t } from "../lib/i18n.js";

/** 左下角账户：头像字母 + 名称（登录后是 Modelflare 账户名）与余额 + 齿轮，点开设置 */
export function AccountButton({ username, account, on, onClick }) {
  const me = ((account && account.state === "signed_in" && account.name) || username || t("sidebar.localUser")).trim();
  const bal = account && account.balanceUsd !== null && account.balanceUsd !== undefined ? usd(account.balanceUsd) : "";
  return html`<button type="button" class=${`account${on ? " on" : ""}`} title=${t("sidebar.settingsTitle")} aria-label=${t("sidebar.openSettings")} onClick=${onClick}>
    <span class="me" aria-hidden="true">${me.slice(0, 1).toUpperCase()}</span>
    <span class="who">${me}${bal && html`<span class=${`bal num${account.lowBalance ? " low" : ""}`}>${t("sidebar.balance", { amount: bal })}</span>`}</span>
    <${Icon} name="gear" size="md" />
  </button>`;
}

/** 余额低于提醒线时，侧栏底部常驻一条提示 */
function LowBalance({ account }) {
  if (!account || !account.lowBalance) return null;
  return html`<a class="low-balance" href=${MF_TOPUP} target="_blank" rel="noopener noreferrer" role="status">
    ${t("sidebar.lowBalance", { amount: usd(account.balanceUsd) })}
  </a>`;
}

export function Sidebar({ bots, botsError, reloadBots, selectedId, view, previews, pending, working, username, account, onNew, onSelect, onDeleted, onOpenSettings, onBotSettings, onGuide }) {
  const [q, setQ] = useState("");
  const [ctx, setCtx] = useState(null); // 行的操作菜单：右键 { bot, x, y }，或者"更多"按钮 { bot, el }
  const [renaming, setRenaming] = useState("");
  const [renameText, setRenameText] = useState("");
  const root = useRef(null);
  const searchRef = useRef(null);
  const renameRef = useRef(null);
  useEffect(() => {
    if (renaming) requestAnimationFrame(() => (renameRef.current?.focus(), renameRef.current?.select()));
  }, [renaming]);

  const rename = async (bot) => {
    const n = renameText.trim();
    setRenaming("");
    if (!n || n === bot.name) return;
    try {
      await api(`/bots/${bot.id}`, { method: "PUT", body: { name: n } });
      reloadBots();
      toast(t("sidebar.renamed"));
    } catch (e) {
      failed(e);
    }
  };
  const del = async (bot) => {
    if (!(await confirmSheet({ title: t("sidebar.delete.title", { name: bot.name }), body: t("sidebar.delete.body"), confirmLabel: t("sidebar.delete.confirm"), danger: true }))) return;
    try {
      await api(`/bots/${bot.id}`, { method: "DELETE" });
      onDeleted(bot.id);
    } catch (e) {
      failed(e);
    }
  };

  const needle = q.trim().toLowerCase();
  const list = (bots || []).filter((b) => !needle || b.name.toLowerCase().includes(needle) || (previews[b.id]?.text || "").toLowerCase().includes(needle));

  return html`<aside class="side" ref=${root} aria-label=${t("sidebar.bots")}>
    <div class="side-top">
      <span class="side-brand"><img src="/amb/static/assets/favicon-64.png" alt="" /><span>AnyModelBot</span></span>
      <${IconButton} icon="plus" iconSize="md" label=${t("sidebar.newShortcut")} on=${view === "new"} onClick=${onNew} />
    </div>
    <label class="side-search">
      <${Icon} name="search" size="sm" />
      <input ref=${searchRef} type="search" placeholder=${t("common.search")} aria-label=${t("sidebar.search")} value=${q} onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))} />
    </label>
    <nav class="side-list" aria-label=${t("sidebar.list")}>
      ${view === "new" && html`<div class="thread sel" aria-current="page"><${BotAvatar} neutral size=${38} />
        <span class="body"><span class="line"><span class="title">${t("sidebar.newBot")}</span></span><span class="line"><span class="snip">${t("sidebar.creating")}</span></span></span></div>`}
      ${botsError && html`<div class="side-empty"><span>${t("sidebar.loadFailed")}</span><button type="button" class="btn" onClick=${reloadBots}>${t("common.retry")}</button></div>`}
      ${!bots && !botsError && [0, 1, 2].map((k) => html`<div class="thread" key=${k}><${Skeleton} w="38px" circle /><span class="thread-skel"><${Skeleton} w="50%" /><${Skeleton} w="75%" /></span></div>`)}
      ${bots && !bots.length && view !== "new" && html`<div class="side-empty"><span>${t("sidebar.empty")}</span><button type="button" class="btn primary" onClick=${onNew}>${t("sidebar.create")}</button></div>`}
      ${bots && needle && !list.length && html`<p class="hint">${t("sidebar.noMatch")}</p>`}
      ${list.map((b) => {
        const sel = (view === "chat" || view === "bot-settings") && b.id === selectedId;
        const n = pending[b.id] || 0;
        if (renaming === b.id)
          return html`<div class="thread sel" key=${b.id}><${BotAvatar} bot=${b} size=${38} />
            <input class="field" value=${renameText} aria-label=${t("sidebar.newName")} ref=${renameRef}
              onInput=${(e) => setRenameText(e.target.value)} onBlur=${() => rename(b)}
              onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(""); } }} /></div>`;
        const pv = previews[b.id];
        const menuOpen = !!(ctx && ctx.el && ctx.bot.id === b.id);
        return html`<div class="thread-item" key=${b.id}>
          <button type="button" class=${`thread bot-hover${sel ? " sel" : ""}`} aria-current=${sel ? "page" : undefined}
            onClick=${() => onSelect(b.id)} onContextMenu=${(e) => { e.preventDefault(); setCtx({ bot: b, x: e.clientX, y: e.clientY }); }}>
            <span class="avatar-wrap"><${BotAvatar} bot=${b} size=${38} state=${n > 0 ? "waiting" : working[b.id] ? "working" : "idle"} />${working[b.id] && html`<span class="working-dot" title=${t("sidebar.working")}></span>`}</span>
            <span class="body">
              <span class="line"><span class="title">${b.name}</span>${pv?.at && html`<span class="when num">${fmtAgo(pv.at)}</span>`}</span>
              <span class="line"><span class="snip">${working[b.id] ? t("sidebar.workingNow") : pv?.text || t("sidebar.noChats")}</span>${n > 0 && html`<span class="badge count" title=${t("sidebar.pending", { count: n })}>${n}</span>`}</span>
            </span>
          </button>
          <${IconButton} icon="more" class="thread-more" label=${t("sidebar.moreFor", { name: b.name })} aria-haspopup="menu" aria-expanded=${menuOpen}
            onClick=${(e) => { const el = e.currentTarget; setCtx((c) => (c && c.el && c.bot.id === b.id ? null : { bot: b, el })); }} />
        </div>`;
      })}
    </nav>
    <${LowBalance} account=${account} />
    ${bots && bots.length > 0 && html`<${GuidePill} onGo=${onGuide} />`}
    <div class="side-foot"><${AccountButton} username=${username} account=${account} onClick=${onOpenSettings} /></div>
    ${ctx && html`<${Menu} anchor=${ctx.el || { left: ctx.x, right: ctx.x, top: ctx.y, bottom: ctx.y, width: 0 }} align=${ctx.el ? "right" : undefined}
      width=${200} label=${t("sidebar.actionsFor", { name: ctx.bot.name })} onClose=${() => setCtx(null)}
      items=${[
        ...(onBotSettings ? [{ label: t("sidebar.menu.settings"), onSelect: () => onBotSettings(ctx.bot.id) }, { sep: true }] : []),
        { label: t("common.rename"), onSelect: () => { setRenameText(ctx.bot.name); setRenaming(ctx.bot.id); } },
        { label: t("sidebar.menu.copyId"), onSelect: () => navigator.clipboard?.writeText(ctx.bot.id).then(() => toast(t("common.copied"))).catch(failed) },
        { sep: true },
        { label: t("sidebar.menu.delete"), danger: true, onSelect: () => del(ctx.bot) },
      ]} />`}
  </aside>`;
}
