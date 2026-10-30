// 侧栏 280（参考 Grok Bot）：顶部只有新建按钮，常驻搜索框，机器人行（头像 + 名称 + 时间 + 一行预览），左下角账户（打开设置）。
// 新建在主区的新建页（screens/new-bot.js）；新建页打开时列表顶部有一行占位的"新机器人"。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Menu, Skeleton } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { fmtAgo } from "../lib/format.js";
import { MF_TOPUP, usd } from "../lib/links.js";

/** 左下角账户：头像字母 + 名称（登录后是 Modelflare 账户名）与余额 + 齿轮，点开设置 */
export function AccountButton({ username, account, on, onClick }) {
  const me = ((account && account.state === "signed_in" && account.name) || username || "本机用户").trim();
  const bal = account && account.balanceUsd !== null && account.balanceUsd !== undefined ? usd(account.balanceUsd) : "";
  return html`<button type="button" class=${`account${on ? " on" : ""}`} title="设置（⌘,）" aria-label="打开设置" onClick=${onClick}>
    <span class="me" aria-hidden="true">${me.slice(0, 1).toUpperCase()}</span>
    <span class="who">${me}${bal && html`<span class=${`bal num${account.lowBalance ? " low" : ""}`}>余额 ${bal}</span>`}</span>
    <${Icon} name="gear" size=${15} />
  </button>`;
}

/** 余额低于提醒线时，侧栏底部常驻一条提示 */
function LowBalance({ account }) {
  if (!account || !account.lowBalance) return null;
  return html`<a class="low-balance" href=${MF_TOPUP} target="_blank" rel="noopener noreferrer" role="status">
    余额只剩 ${usd(account.balanceUsd)}，去充值 ↗
  </a>`;
}

export function Sidebar({ bots, botsError, reloadBots, selectedId, view, previews, pending, working, username, account, onNew, onSelect, onDeleted, onOpenSettings }) {
  const [q, setQ] = useState("");
  const [ctx, setCtx] = useState(null); // { bot, x, y }
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
      toast("已重命名");
    } catch (e) {
      failed(e);
    }
  };
  const del = async (bot) => {
    if (!(await confirmSheet({ title: `删除「${bot.name}」？`, body: "会永久删除这个机器人及其全部会话，无法恢复。", confirmLabel: "永久删除", danger: true }))) return;
    try {
      await api(`/bots/${bot.id}`, { method: "DELETE" });
      onDeleted(bot.id);
    } catch (e) {
      failed(e);
    }
  };

  const needle = q.trim().toLowerCase();
  const list = (bots || []).filter((b) => !needle || b.name.toLowerCase().includes(needle) || (previews[b.id]?.text || "").toLowerCase().includes(needle));

  return html`<aside class="side" ref=${root} aria-label="机器人">
    <div class="side-top">
      <${IconButton} icon="plus" iconSize=${16} label="新建机器人（⌘N）" on=${view === "new"} onClick=${onNew} />
    </div>
    <label class="side-search">
      <${Icon} name="search" size=${14} />
      <input ref=${searchRef} type="search" placeholder="搜索" aria-label="搜索机器人" value=${q} onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))} />
    </label>
    <nav class="side-list" aria-label="机器人列表">
      ${view === "new" && html`<div class="thread sel" aria-current="page"><${BotAvatar} neutral size=${38} />
        <span class="body"><span class="line"><span class="title">新机器人</span></span><span class="line"><span class="snip">正在创建…</span></span></span></div>`}
      ${botsError && html`<div class="side-empty"><span>无法读取机器人列表</span><button type="button" class="btn" onClick=${reloadBots}>重试</button></div>`}
      ${!bots && !botsError && [0, 1, 2].map((k) => html`<div class="thread" key=${k}><${Skeleton} w="38px" circle /><span class="thread-skel"><${Skeleton} w="50%" /><${Skeleton} w="75%" /></span></div>`)}
      ${bots && !bots.length && view !== "new" && html`<div class="side-empty"><span>还没有机器人</span><button type="button" class="btn primary" onClick=${onNew}>新建机器人</button></div>`}
      ${bots && needle && !list.length && html`<p class="hint">没有匹配的机器人</p>`}
      ${list.map((b) => {
        const sel = (view === "chat" || view === "bot-settings") && b.id === selectedId;
        const n = pending[b.id] || 0;
        if (renaming === b.id)
          return html`<div class="thread sel" key=${b.id}><${BotAvatar} bot=${b} size=${38} />
            <input class="field" value=${renameText} aria-label="新名称" ref=${renameRef}
              onInput=${(e) => setRenameText(e.target.value)} onBlur=${() => rename(b)}
              onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(""); } }} /></div>`;
        const pv = previews[b.id];
        return html`<button type="button" key=${b.id} class=${`thread bot-hover${sel ? " sel" : ""}`} aria-current=${sel ? "page" : undefined}
          onClick=${() => onSelect(b.id)} onContextMenu=${(e) => { e.preventDefault(); setCtx({ bot: b, x: e.clientX, y: e.clientY }); }}>
          <span class="avatar-wrap"><${BotAvatar} bot=${b} size=${38} state=${n > 0 ? "waiting" : working[b.id] ? "working" : "idle"} />${working[b.id] && html`<span class="working-dot" title="工作中"></span>`}</span>
          <span class="body">
            <span class="line"><span class="title">${b.name}</span>${pv?.at && html`<span class="when num">${fmtAgo(pv.at)}</span>`}</span>
            <span class="line"><span class="snip">${working[b.id] ? "正在工作…" : pv?.text || "还没有对话"}</span>${n > 0 && html`<span class="badge count" title=${`${n} 个待审批`}>${n}</span>`}</span>
          </span>
        </button>`;
      })}
    </nav>
    <${LowBalance} account=${account} />
    <div class="side-foot"><${AccountButton} username=${username} account=${account} onClick=${onOpenSettings} /></div>
    ${ctx && html`<${Menu} anchor=${{ left: ctx.x, right: ctx.x, top: ctx.y, bottom: ctx.y, width: 0 }} width=${200} label=${`${ctx.bot.name} 的操作`} onClose=${() => setCtx(null)}
      items=${[
        { label: "重命名", onSelect: () => { setRenameText(ctx.bot.name); setRenaming(ctx.bot.id); } },
        { label: "复制机器人 ID", onSelect: () => navigator.clipboard?.writeText(ctx.bot.id).then(() => toast("已复制")).catch(failed) },
        { sep: true },
        { label: "删除机器人", danger: true, onSelect: () => del(ctx.bot) },
      ]} />`}
  </aside>`;
}
