// 侧栏 280：顶部搜索 / 新建两个圆形按钮，应用标志，机器人行（头像 + 名称 + 一行预览），左下角账户按钮（打开设置）。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Menu } from "../components/ui.js";
import { AppMark, BotAvatar, usePointerLook } from "../components/avatar.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";

export function Sidebar({ bots, botsError, reloadBots, selectedId, view, previews, pending, working, username, creating, setCreating, onSelect, onCreated, onDeleted, onOpenSettings }) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState(null); // { bot, x, y }
  const [renaming, setRenaming] = useState("");
  const [renameText, setRenameText] = useState("");
  const root = useRef(null);
  const searchRef = useRef(null);
  const newRef = useRef(null);
  const renameRef = useRef(null);
  usePointerLook(root);
  useEffect(() => {
    if (creating) requestAnimationFrame(() => newRef.current?.focus());
  }, [creating]);
  useEffect(() => {
    if (renaming) requestAnimationFrame(() => (renameRef.current?.focus(), renameRef.current?.select()));
  }, [renaming]);

  useEffect(() => {
    if (searching) requestAnimationFrame(() => searchRef.current?.focus());
    else setQ("");
  }, [searching]);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const r = await api("/bots", { method: "POST", body: { name: n } });
      setName("");
      setCreating(false);
      onCreated(r.bot);
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
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
  const list = (bots || []).filter((b) => !needle || b.name.toLowerCase().includes(needle) || (previews[b.id] || "").toLowerCase().includes(needle));
  const me = (username || "本机用户").trim();

  return html`<aside class="side" ref=${root} aria-label="机器人">
    <div class="side-top">
      ${searching
        ? html`<input class="side-search" ref=${searchRef} placeholder="搜索机器人" aria-label="搜索机器人" value=${q} onInput=${(e) => setQ(e.target.value)}
            onKeyDown=${(e) => e.key === "Escape" && (e.stopPropagation(), setSearching(false))} onBlur=${() => !q && setSearching(false)} />`
        : html`<button type="button" class="round-btn" title="搜索" aria-label="搜索机器人" onClick=${() => setSearching(true)}><${Icon} name="search" /></button>`}
      <button type="button" class=${`round-btn${creating ? " on" : ""}`} title="新建机器人（⌘N）" aria-label="新建机器人" onClick=${() => setCreating(!creating)}><${Icon} name="plus" /></button>
    </div>
    ${!searching && html`<div class="side-hero"><${AppMark} size=${56} /><span class="name">AnyModelBot</span></div>`}
    <nav class="side-list" aria-label="机器人列表">
      ${creating && html`<form class="thread-new" onSubmit=${(e) => { e.preventDefault(); create(); }}>
        <input class="field" placeholder="新机器人的名称" aria-label="新机器人的名称" value=${name} ref=${newRef}
          onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === "Escape" && (e.stopPropagation(), setCreating(false))} />
        <button type="submit" class="btn primary" disabled=${!name.trim() || busy}>创建</button>
      </form>`}
      ${botsError && html`<div class="side-empty"><span>无法读取机器人列表</span><button type="button" class="btn" onClick=${reloadBots}>重试</button></div>`}
      ${!bots && !botsError && [0, 1, 2].map((k) => html`<div class="thread" key=${k}><span class="skel" style="width:34px;height:34px;border-radius:50%"></span><span style="flex:1;display:grid;gap:6px"><span class="skel" style="width:50%"></span><span class="skel" style="width:75%"></span></span></div>`)}
      ${bots && !bots.length && !creating && html`<div class="side-empty"><span>还没有机器人</span><button type="button" class="btn primary" onClick=${() => setCreating(true)}>新建机器人</button></div>`}
      ${bots && needle && !list.length && html`<p class="hint" style="padding:8px 10px">没有匹配的机器人</p>`}
      ${list.map((b) => {
        const sel = view === "chat" && b.id === selectedId;
        const n = pending[b.id] || 0;
        if (renaming === b.id)
          return html`<div class="thread sel" key=${b.id}><${BotAvatar} name=${b.name} id=${b.id} size=${34} />
            <input class="field" style="height:30px" value=${renameText} aria-label="新名称" ref=${renameRef}
              onInput=${(e) => setRenameText(e.target.value)} onBlur=${() => rename(b)}
              onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(""); } }} /></div>`;
        return html`<button type="button" key=${b.id} class=${`thread${sel ? " sel" : ""}`} aria-current=${sel ? "page" : undefined}
          onClick=${() => onSelect(b.id)} onContextMenu=${(e) => { e.preventDefault(); setCtx({ bot: b, x: e.clientX, y: e.clientY }); }}>
          <span class="avatar-wrap"><${BotAvatar} name=${b.name} id=${b.id} size=${34} working=${!!working[b.id]} />${working[b.id] && html`<span class="working-dot" title="工作中"></span>`}</span>
          <span class="body">
            <span class="title" style="display:block">${b.name}</span>
            <span class="snip" style="display:block">${previews[b.id] || "还没有对话"}</span>
          </span>
          ${n > 0 && html`<span class="badge count" title=${`${n} 个待审批`}>${n}</span>`}
        </button>`;
      })}
    </nav>
    <div class="side-foot">
      <button type="button" class=${`account${view === "settings" ? " on" : ""}`} title="设置（⌘,）" aria-label="打开设置" onClick=${onOpenSettings}>
        <span class="me" aria-hidden="true">${me.slice(0, 1).toUpperCase()}</span>
        <span class="who">${me}</span>
      </button>
    </div>
    ${ctx && html`<${Menu} anchor=${{ left: ctx.x, right: ctx.x, top: ctx.y, bottom: ctx.y, width: 0 }} width=${200} label=${`${ctx.bot.name} 的操作`} onClose=${() => setCtx(null)}
      items=${[
        { label: "重命名", onSelect: () => { setRenameText(ctx.bot.name); setRenaming(ctx.bot.id); } },
        { label: "复制机器人 ID", onSelect: () => navigator.clipboard?.writeText(ctx.bot.id).then(() => toast("已复制")).catch(failed) },
        { sep: true },
        { label: "删除机器人", danger: true, onSelect: () => del(ctx.bot) },
      ]} />`}
  </aside>`;
}
