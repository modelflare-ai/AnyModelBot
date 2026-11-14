// 侧栏 280（参考 Grok Bot，宽度可以拖右边的分隔条调整）：顶部收起按钮靠左、搜索和新建靠右（见 SideActions），
// 机器人行（头像 + 名称 + 时间 + 一行预览；悬停出现"更多"，和右键是同一份菜单），左下角账户（点头像打开菜单，余额在设置 › 模型中的 Modelflare 账户区 中展示）。
// 侧栏收起后，同样三个按钮浮在主区左上角（SideRail）。
// 新建在主区的新建页（screens/new-bot.js）；新建页打开时，机器人列表末尾（建好后它就在这）有一行占位，跟着显示头像和名字。
// 机器人和群聊的增删：新行淡入并定位到它（新机器人的头像打个招呼），删掉的行淡出（design/motion.js 的 useListPresence）。
// 群聊排在机器人后面（screens/group.js）；有两个以上机器人时，新建按钮是一个菜单（机器人 / 群聊）。
// 顶部按钮下面是固定的导航（和设置导航同一种行）：「发现」「定时」，有事在等你时下面多一行「需要你 N」（没事时没有这一行）；
// 导航之下才是可滚动的分组列表（lib/sections.js）：默认「我的」和「上新」，用户可以新建、改名、删除分组，拖分组标题上下排；
// 机器人、群聊和目录 Bot 的行可以拖到别的分组（或用行菜单里的「移到分组」）。分组标题点一下折叠。
// 有事在等的机器人，行的第二行换成最早那件事。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Menu, Popover, Skeleton, Spinner } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { UserAvatar } from "../components/user-avatar.js";
import { GuidePill } from "../components/guide.js";
import { api } from "../lib/api.js";
import { updateDescription, updateError } from "../components/app-update.js";
import { confirmSheet, failed, toast, useStore } from "../lib/store.js";
import { deleteBot } from "../lib/bots.js";
import { useListPresence } from "../design/motion.js";
import { newBotDraft } from "./new-bot.js";
import { fmtAgo } from "../lib/format.js";
import { t, useLang } from "../lib/i18n.js";
import { NeedsRow } from "./needs-you.js";
import { catalogSeen, locallyRemoved, tr } from "../lib/catalog.js";
import { addSection, defaultLayout, deleteSection, keyOfBot, keyOfEntry, keyOfGroup, loadSideLayout, markSideLayoutPruned, moveItem, moveSection, place, prune, renameSection, saveSideLayout, sectionOf, sideFold, sideLayout, sideLayoutLoaded, sideLayoutPruned, toggleSideFold } from "../lib/sections.js";
import { resumeAccountLogin } from "../lib/account-login.js";
import { AccountLogin } from "./onboarding.js";
import { previewText } from "../lib/errors.js";
import { appsStore } from "../lib/apps.js";
import { ScheduledButton } from "./scheduled.js";
import { GroupAvatars } from "./group.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * 左下角账户区（第 12、10、19 项）：
 * - 头像 + 昵称常驻，整行可点，向上展开菜单：设置、连接应用、意见和反馈、检查更新。
 *   退出登录放在设置 › 常规底部的账户区域；设置入口还有 ⌘, 快捷键，账户行旁边不再单独摆齿轮。
 *   菜单贴着整个账户区往上开、和账户区一样宽。
 * - 余额和 Bot 额度在设置 › 模型中的 Modelflare 账户区 顶部直接展示，账户行只保留头像、昵称和菜单入口。
 * - 用自己的 API Key、没登录 Modelflare 时，账户行上面是"登录 Modelflare"的独立入口，不显示不存在的余额。
 * - 余额加载中 / 读取失败不显示成 0；登录后优先显示缓存资料；没有可显示资料时使用 Modelflare 账号，不显示本地账户占位。
 */
export function AccountButton({ account, onSettings, update, onUpdateChanged }) {
  // 连接应用：侧栏和设置页的账户菜单都有这一项，直接改地址（main.js 的路由）；提醒点读共享的应用状态
  const appsAttention = useStore(appsStore).attention;
  const onApps = () => {
    location.hash = "/apps";
  };
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateRequest = useRef(false);
  const [check, setCheck] = useState(""); // 这次手动检查的结果：checking / latest / failed（没检查过时为空，不说"已是最新"）
  const ref = useRef(null);
  const stackRef = useRef(null);
  const signedIn = account?.state === "signed_in";
  useEffect(() => resumeAccountLogin(account), [account?.state]);
  const me = signedIn ? account.name?.trim() || t("welcome.accountFallback") : t("firstUse.myAccount");
  const profileLoading = signedIn && !account.profileReady && !account.name && !account.error;
  const changed = () => window.dispatchEvent(new Event("amb-connection-change"));
  const phase = update?.phase;
  const ready = phase === "ready";
  const updateWorking = ["checking", "downloading", "installing"].includes(phase);
  const runUpdate = async () => {
    if (updateRequest.current || updateWorking || (ready && update?.busy)) return;
    setOpen(false);
    // 有新版本：已下载好的按"重启更新"（有任务在跑时服务端会拒绝）；没下载的开始下载；不支持应用内更新的打开下载页
    if (!update?.supported) return void window.open(update?.downloadUrl || update?.releaseUrl || "https://github.com/modelflare-ai/AnyModelBot/releases", "_blank", "noopener");
    updateRequest.current = true;
    setUpdating(true);
    try {
      await api(`/update/${ready ? "install" : "download"}`, { method: "POST", body: {} });
    } catch (e) {
      failed(updateError(e));
    } finally {
      updateRequest.current = false;
      setUpdating(false);
      onUpdateChanged?.();
    }
  };
  const checkUpdate = async () => {
    if (update?.available) return runUpdate();
    if (!update?.supported) { setOpen(false); return void window.open(update?.releaseUrl || "https://github.com/modelflare-ai/AnyModelBot/releases", "_blank", "noopener"); }
    setCheck("checking");
    try {
      const result = await api("/update/check", { method: "POST", body: {} });
      setCheck(result.error ? "failed" : result.available ? "" : "latest");
    } catch {
      setCheck("failed");
    } finally {
      onUpdateChanged?.();
    }
  };
  const checkLabel = check === "checking" || phase === "checking" ? t("firstUse.checking")
    : updateWorking || ready ? updateDescription(update)
    : update?.available ? t("sidebar.update", { version: update.latest || "" })
    : check === "failed" ? t("firstUse.updateFailed")
    : check === "latest" ? t("firstUse.latest")
    : t("firstUse.checkUpdate");
  const showUpdate = update?.available || ["downloading", "installing", "ready"].includes(phase);
  const updateLabel = ready && update?.busy ? t("updates.busy") : updateWorking ? updateDescription(update)
    : [t(ready ? "updates.restart" : "updates.download"), update?.latest].filter(Boolean).join(" · ");
  return html`<div class="account-stack" ref=${stackRef}>
    ${!signedIn && account && account.state !== "unavailable" && html`<${AccountLogin} inline manual=${!!account.manualLogin} />`}
    <div class=${`account-row${open ? " on" : ""}`}>
      <button type="button" class=${`account${open ? " on" : ""}`} ref=${ref} title=${me} aria-label=${t("firstUse.accountMenu", { name: me })} aria-haspopup="menu" aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>
        <${UserAvatar} name=${me} src=${signedIn ? account.avatar : ""} fallback=${signedIn && !account.name} loading=${profileLoading} class="me" /><span class="who" title=${profileLoading ? "" : me}>${profileLoading ? html`<span class="account-name-skeleton skel"></span>` : me}</span>
        ${appsAttention && html`<span class="dot warn account-dot" title=${t("apps.attention")}></span>`}
        <${Icon} name="chevDown" size="xs" class="account-chevron" />
      </button>
      ${showUpdate && html`<button type="button" class="icon-btn side-update" title=${updateLabel} aria-label=${updateLabel}
        disabled=${updating || updateWorking || (ready && update?.busy)} aria-busy=${updating || updateWorking} onClick=${runUpdate}>
        ${updating || updateWorking ? html`<${Spinner} />` : html`<${Icon} name=${ready ? "refresh" : "down"} size="md" />`}
      </button>`}
    </div>
    ${open && html`<${Popover} class="account-popover" anchor=${stackRef.current} trigger=${ref.current} prefer="up" width=${stackRef.current?.offsetWidth || 280} label=${t("sidebar.account")} onClose=${() => setOpen(false)}>
      <div class="account-menu-head">
        <${UserAvatar} name=${me} src=${signedIn ? account.avatar : ""} fallback=${signedIn && !account.name} loading=${profileLoading} class="account-menu-avatar" />
        <div class="account-menu-identity"><span class="name">${me}</span><span class="hint">${signedIn ? "Modelflare" : t("sidebar.localUser")}</span></div>
      </div>
      <div class="account-menu primary" role="menu">
        <button type="button" role="menuitem" onClick=${() => { setOpen(false); onSettings?.(); }}>
          <span class="menu-icon"><${Icon} name="gear" size="md" /></span><span class="menu-label">${t("sidebar.settings")}</span><kbd>${isMac ? "⌘," : "Ctrl+,"}</kbd></button>
        <button type="button" role="menuitem" onClick=${() => { setOpen(false); onApps?.(); }}>
          <span class="menu-icon"><${Icon} name="link" size="md" /></span><span class="menu-label">${t("apps.menu")}</span>${appsAttention && html`<span class="dot warn" title=${t("apps.attention")}></span>`}</button>
        <a role="menuitem" href="https://github.com/modelflare-ai/AnyModelBot/issues/new/choose" target="_blank" rel="noopener noreferrer" onClick=${() => setOpen(false)}>
          <span class="menu-icon"><${Icon} name="chat" size="md" /></span><span class="menu-label">${t("firstUse.feedback")}</span><${Icon} name="ext" size="xs" class="menu-trail" /></a>
        <button type="button" role="menuitem" disabled=${check === "checking" || updating || updateWorking || (ready && update.busy)} title=${ready && update.busy ? t("updates.busy") : ""} onClick=${checkUpdate}>
          <span class="menu-icon"><${Icon} name="refresh" size="md" /></span><span class="menu-label" role="status">${checkLabel}</span>${update?.available && html`<span class="dot new"></span>`}</button>
      </div>
    <//>`}
  </div>`;
}

/**
 * 顶部只保留收起、搜索、新建：收起靠左，搜索和新建靠右，新建使用常驻底色。
 * children 放在收起之后（Windows 的应用名和撑开的空白）；定时作为带文字的导航行。
 */
export function SideActions({ collapsed, bots, onToggleSide, onOpenSearch, onNew, onTemplates, onNewGroup, children }) {
  const [newMenu, setNewMenu] = useState(null); // 新建菜单的锚点
  const canGroup = !!bots && bots.length >= 2;
  return html`
    <${IconButton} icon="sidebar" iconSize="md" class="side-toggle" label=${t(collapsed ? "sidebar.expand" : "sidebar.collapse")} onClick=${onToggleSide} />
    ${children}
    <${IconButton} icon="search" iconSize="md" class="side-search-btn" label=${t("sidebar.searchShortcut", { keys: isMac ? "⌘⇧F" : "Ctrl+Shift+F" })} aria-haspopup="dialog" onClick=${() => onOpenSearch?.()} />
    <${IconButton} icon="plus" iconSize="md" class="side-new" label=${t("sidebar.newMenu")} on=${!!newMenu} aria-haspopup="menu" aria-expanded=${!!newMenu}
      onClick=${(e) => { const el = e.currentTarget; setNewMenu((m) => (m ? null : el)); }} />
    ${newMenu && html`<${Menu} anchor=${newMenu} align=${collapsed ? undefined : "right"} width=${180} label=${t("sidebar.newMenu")} onClose=${() => setNewMenu(null)}
      items=${[
        { label: t("sidebar.newBotItem"), icon: "spark", kbd: isMac ? "⌘N" : "Ctrl+N", onSelect: onNew },
        ...(canGroup ? [{ label: t("sidebar.newGroupItem"), icon: "chat", onSelect: onNewGroup }] : []),
        { label: t("templates.title"), icon: "compass", onSelect: onTemplates },
      ]} />`}`;
}

/** 侧栏收起后：三个按钮浮在主区左上角，保持展开、搜索、新建的顺序。 */
export function SideRail(props) {
  return html`<div class="side-rail anim-fade-in"><${SideActions} collapsed ...${props} /></div>`;
}

export function Sidebar({ bots, botsError, reloadBots, selectedId, view, previews, pending, working, needs = { n: 0, bots: {} }, username, account, update, onUpdateChanged, onNew, onTemplates, onSelect, onNeeds, onDeleted, onOpenSettings, onBotSettings, onGuide, groups = [], groupsLoaded = true, groupId, onNewGroup, onSelectGroup, onEditGroup, onDeletedGroup, catalog = [], catalogId, onDiscover, onOpenCatalog, onOpenSearch, collapsed, onToggleSide }) {
  const lang = useLang();
  const seen = useStore(catalogSeen);
  const removedNow = useStore(locallyRemoved);
  catalog = catalog.map((e) => removedNow.includes(e.id) ? { ...e, userRemoved: true, instanceId: undefined } : e);
  const fold = useStore(sideFold);
  const stored = useStore(sideLayout);
  const hasNew = catalog.some((e) => !e.instanceId && !e.userRemoved && !seen.includes(e.id));
  const [ctx, setCtx] = useState(null); // 行的操作菜单：右键 { bot, x, y }，或者"更多"按钮 { bot, el }
  const [groupCtx, setGroupCtx] = useState(null); // 群聊行的操作菜单：{ group, x, y } 或 { group, el }
  const [secCtx, setSecCtx] = useState(null); // 分组标题的操作菜单：{ sec, x, y } 或 { sec, el }
  const [moveCtx, setMoveCtx] = useState(null); // 「移到分组」菜单：{ key, x, y } 或 { key, el }
  const [secRenaming, setSecRenaming] = useState("");
  const [secText, setSecText] = useState("");
  const secRenameRef = useRef(null);
  const secCancel = useRef(false); // 按了 Esc：输入框随后失焦时不保存
  const [drag, setDrag] = useState(null); // 正在拖的：{ type: "item", key } 或 { type: "section", id }
  const [drop, setDrop] = useState(null); // 落点：{ sec, key?, where: "before" | "after" | "into" }
  const [renaming, setRenaming] = useState("");
  const [renameText, setRenameText] = useState("");
  const root = useRef(null);
  const renameRef = useRef(null);
  useEffect(() => {
    if (renaming) requestAnimationFrame(() => (renameRef.current?.focus(), renameRef.current?.select()));
  }, [renaming]);
  useEffect(() => {
    if (secRenaming) requestAnimationFrame(() => (secRenameRef.current?.focus(), secRenameRef.current?.select()));
  }, [secRenaming]);
  useEffect(() => void loadSideLayout(), []);

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
    if (await deleteBot(bot)) onDeleted(bot.id);
  };

  const delGroup = async (g) => {
    if (!(await confirmSheet({ title: t("group.delete.title", { name: g.name }), body: t("group.delete.body"), confirmLabel: t("group.delete.confirm"), danger: true }))) return;
    try {
      await api(`/groups/${encodeURIComponent(g.id)}`, { method: "DELETE" });
      onDeletedGroup?.(g.id);
    } catch (e) {
      failed(e);
    }
  };
  const groupBots = (g) => g.members.map((id) => (bots || []).find((b) => b.id === id)).filter(Boolean);

  const draft = useStore(newBotDraft);
  const botRows = useListPresence(bots);
  const groupRows = useListPresence(groupsLoaded ? groups : null);
  // 还不在任何分组里的行放进去（新机器人 / 群聊进默认分组，新上架的目录 Bot 进「上新」），放好的结果存回服务端
  const layout = place(stored || defaultLayout(), { bots, groups: groupsLoaded ? groups : null, catalog });
  useEffect(() => {
    if (!stored || !sideLayoutLoaded()) return;
    let next = layout;
    // 打开应用后第一次读齐机器人和群聊时，顺手丢掉已经删掉的那些的键
    if (bots && groupsLoaded && !sideLayoutPruned()) {
      markSideLayoutPruned();
      const alive = new Set([...bots.map(keyOfBot), ...groups.map(keyOfGroup)]);
      next = prune(next, (k) => alive.has(k));
    }
    if (next !== stored) saveSideLayout(next).catch(() => {});
  }, [layout, !!bots, groupsLoaded]);
  // 拖回原处、移到本来就在的分组：内容没变就不存
  const save = (next) => JSON.stringify(next) !== JSON.stringify(layout) && saveSideLayout(next).catch(failed);
  // 键 → 行。淡出中的行也在（useListPresence），删掉的机器人在原来的位置淡出
  const botByKey = new Map(botRows.map((r) => [keyOfBot(r.item), r]));
  const groupByKey = new Map(groupRows.map((r) => [keyOfGroup(r.item), r]));
  const entryByKey = new Map(catalog.filter((e) => !e.instanceId && !e.userRemoved).map((e) => [keyOfEntry(e), e]));
  const rowOf = (key) => {
    if (botByKey.has(key)) return { kind: "bot", key, row: botByKey.get(key) };
    if (bots && groupByKey.has(key)) return { kind: "group", key, row: groupByKey.get(key) }; // 群聊行要用到机器人列表
    if (entryByKey.has(key)) return { kind: "entry", key, entry: entryByKey.get(key) };
    return null; // 已经删掉的行：键留到下次打开应用时再丢（prune）
  };
  const rowsIn = (s) => s.items.map(rowOf).filter(Boolean);
  // 没有目录时空着的「上新」不显示
  const sections = layout.sections.filter((s) => !(s.inbox && !catalog.length && !rowsIn(s).length));
  const secName = (s) => s.name || (s.preset ? t(`botapp.sidebar.${s.preset}`) : t("sidebar.section.untitled"));
  // 新行可能在列表下面看不见的地方：滚过去
  const entered = [...botRows, ...groupRows].filter((r) => r.state === "enter").map((r) => r.item.id).join();
  useEffect(() => {
    if (entered || view === "new") root.current?.querySelector(".thread-item.anim-fade-in, .thread.draft")?.scrollIntoView({ block: "nearest" });
  }, [entered, view === "new"]);
  // 定时常驻于导航区；发现、需要你按已有条件显示，不占用顶部工具栏。
  const discoverOn = view === "discover";
  const showHeads = sections.length > 1 || catalog.length > 0 || needs.n > 0;

  // —— 分组操作 ——
  const newSection = ({ afterId, items } = {}) => {
    const name = t("sidebar.section.untitled");
    const { layout: next, id } = addSection(layout, name, { afterId, items });
    save(next);
    startRenameSec(id, name);
  };
  const startRenameSec = (id, text) => {
    secCancel.current = false;
    setSecText(text);
    setSecRenaming(id);
  };
  const renameSec = (s) => {
    const text = secText.trim();
    setSecRenaming("");
    if (secCancel.current) return void (secCancel.current = false);
    // 清空名字：预设的分组回到预设名（跟着语言变），自己建的保持原名
    if (text === s.name || (!text && !s.preset)) return;
    save(renameSection(layout, s.id, text));
  };
  const delSection = async (s) => {
    const moving = rowsIn(s).filter((r) => r.kind !== "entry").length;
    const to = s.default ? layout.sections.find((x) => x.id !== s.id) : layout.sections.find((x) => x.default);
    // 没有要移走的机器人和群聊时直接删（没用过的目录 Bot 回到「上新」或只在发现页，都还找得到）
    if (moving || s.inbox) {
      const body = [moving ? t("sidebar.section.deleteMove", { name: to ? secName(to) : "" }) : "", s.inbox ? t("sidebar.section.deleteInbox") : ""].filter(Boolean).join(" ");
      if (!(await confirmSheet({ title: t("sidebar.section.deleteTitle", { name: secName(s) }), body, confirmLabel: t("sidebar.section.delete"), danger: true }))) return;
    }
    // 确认框开着时布局可能变了：按现在的布局删
    const now = place(sideLayout.get() || defaultLayout(), { bots, groups: groupsLoaded ? groups : null, catalog });
    saveSideLayout(deleteSection(now, s.id, (k) => botByKey.has(k) || groupByKey.has(k)).layout).catch(failed);
  };
  const moveTo = (key, secId) => save(moveItem(layout, key, secId));
  const at = (c) => c.el || { left: c.x, right: c.x, top: c.y, bottom: c.y, width: 0 };

  // —— 拖动：行拖到行的上半 / 下半（插在前面 / 后面）或分组里的空处（放到末尾）；分组标题拖到别的分组的上半 / 下半 ——
  const startDrag = (e, d) => {
    e.stopPropagation();
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-amb-side", d.key || d.id);
    } catch {
      /* 个别浏览器不让写：照样拖 */
    }
    setDrag(d);
  };
  const endDrag = () => (setDrag(null), setDrop(null));
  const half = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "before" : "after";
  };
  const over = (e, next) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDrop((d) => (d?.sec === next?.sec && d?.key === next?.key && d?.where === next?.where ? d : next));
  };
  const onDropHere = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const d = drag;
    const to = drop;
    endDrag();
    if (!d || !to) return;
    if (d.type === "item") {
      if (to.key === d.key) return;
      let before = null;
      if (to.key) {
        const keys = rowsIn(layout.sections.find((s) => s.id === to.sec) || { items: [] }).map((r) => r.key);
        before = to.where === "before" ? to.key : keys[keys.indexOf(to.key) + 1] ?? null;
      }
      save(moveItem(layout, d.key, to.sec, before));
    } else {
      const ids = sections.map((s) => s.id);
      const before = to.where === "before" ? to.sec : ids[ids.indexOf(to.sec) + 1] ?? null;
      if (to.sec === d.id || before === d.id) return;
      save(moveSection(layout, d.id, before));
    }
  };
  /** 行的拖动属性；淡出中、改名中的行不能拖 */
  const itemDnd = (key, sec, on = true) =>
    on
      ? {
          draggable: true,
          onDragStart: (e) => startDrag(e, { type: "item", key }),
          onDragEnd: endDrag,
          onDragOver: (e) => drag?.type === "item" && over(e, drag.key === key ? null : { sec, key, where: half(e) }),
          onDrop: onDropHere,
        }
      : {};
  const itemFx = (key) => (drop?.key === key ? ` drop-${drop.where}` : "") + (drag?.type === "item" && drag.key === key ? " drag-src" : "");

  /** 机器人行 */
  const botRow = ({ item: b, state: rowState }, key, sec) => {
    const sel = (view === "chat" || view === "bot-settings" || view === "app") && b.id === selectedId;
    // 等你的：「需要你」里这个机器人的件数和最早那件（没有时退回待审批数）
    const nd = needs.bots[b.id];
    const n = nd?.n || pending[b.id] || 0;
    if (renaming === b.id)
      return html`<div class="thread sel" key=${b.id}><${BotAvatar} bot=${b} size=${38} />
        <input class="field" value=${renameText} aria-label=${t("sidebar.newName")} ref=${renameRef}
          onInput=${(e) => setRenameText(e.target.value)} onBlur=${() => rename(b)}
          onKeyDown=${(e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(""); } }} /></div>`;
    const pv = previews[b.id];
    const menuOpen = !!(ctx && ctx.el && ctx.bot.id === b.id);
    const rowFx = rowState === "enter" ? " anim-fade-in" : rowState === "leave" ? " anim-fade-out" : "";
    return html`<div class=${`thread-item${rowFx}${itemFx(key)}`} key=${b.id} inert=${rowState === "leave" || undefined} ...${itemDnd(key, sec, rowState !== "leave")}>
      <button type="button" class=${`thread bot-hover${sel && rowState !== "leave" ? " sel" : ""}`} aria-current=${sel ? "page" : undefined}
        onClick=${() => onSelect(b.id)} onContextMenu=${(e) => { e.preventDefault(); setCtx({ bot: b, x: e.clientX, y: e.clientY }); }}>
        <span class="avatar-wrap"><${BotAvatar} bot=${b} size=${38} greet=${rowState === "enter"} state=${n > 0 ? "waiting" : working[b.id] ? "working" : "idle"} />${working[b.id] && html`<span class="working-dot" title=${t("sidebar.working")}></span>`}</span>
        <span class="body">
          <span class="line"><span class="title">${b.name}</span>${pv?.at && html`<span class="when num">${fmtAgo(pv.at)}</span>`}</span>
          <span class="line"><span class="snip">${nd?.line || (working[b.id] ? t("sidebar.workingNow") : pv?.text || t("sidebar.noChats"))}</span>${n > 0 && html`<span class="needs-dot" role="img" title=${t("sidebar.needs", { count: n })} aria-label=${t("sidebar.needs", { count: n })}></span>`}</span>
        </span>
      </button>
      <${IconButton} icon="more" class="thread-more" label=${t("sidebar.moreFor", { name: b.name })} aria-haspopup="menu" aria-expanded=${menuOpen}
        onClick=${(e) => { const el = e.currentTarget; setCtx((c) => (c && c.el && c.bot.id === b.id ? null : { bot: b, el })); }} />
    </div>`;
  };
  /** 群聊行 */
  const groupRow = ({ item: g, state: rowState }, key, sec) => {
    const sel = view === "group" && g.id === groupId && rowState !== "leave";
    const who = g.last?.botId ? (bots.find((b) => b.id === g.last.botId)?.name ?? "") : "";
    const line = g.running && g.current ? t("group.working", { name: bots.find((b) => b.id === g.current)?.name ?? "" }) : g.last ? `${who ? `${who}: ` : ""}${previewText(g.last.text)}` : t("group.noMessages");
    const menuOpen = !!(groupCtx && groupCtx.el && groupCtx.group.id === g.id);
    const rowFx = rowState === "enter" ? " anim-fade-in" : rowState === "leave" ? " anim-fade-out" : "";
    return html`<div class=${`thread-item${rowFx}${itemFx(key)}`} key=${"g" + g.id} inert=${rowState === "leave" || undefined} ...${itemDnd(key, sec, rowState !== "leave")}>
      <button type="button" class=${`thread${sel ? " sel" : ""}`} aria-current=${sel ? "page" : undefined}
        onClick=${() => onSelectGroup(g.id)} onContextMenu=${(e) => { e.preventDefault(); setGroupCtx({ group: g, x: e.clientX, y: e.clientY }); }}>
        <span class="avatar-wrap"><${GroupAvatars} bots=${groupBots(g)} size=${38} pile />${g.running && html`<span class="working-dot" title=${t("sidebar.working")}></span>`}</span>
        <span class="body">
          <span class="line"><span class="title">${g.name}</span>${g.last?.at && html`<span class="when num">${fmtAgo(g.last.at)}</span>`}</span>
          <span class="line"><span class="snip">${line}</span></span>
        </span>
      </button>
      <${IconButton} icon="more" class="thread-more" label=${t("sidebar.moreFor", { name: g.name })} aria-haspopup="menu" aria-expanded=${menuOpen}
        onClick=${(e) => { const el = e.currentTarget; setGroupCtx((c) => (c && c.el && c.group.id === g.id ? null : { group: g, el })); }} />
    </div>`;
  };
  /** 还没用过的目录 Bot：点开是示例界面；"更多"里只有「移到分组」 */
  const entryRow = (e, key, sec) => {
    const on = view === "preview" && catalogId === e.id;
    return html`<div class=${`thread-item${itemFx(key)}`} key=${"c" + e.id} ...${itemDnd(key, sec)}>
      <button type="button" class=${`thread bot-hover${on ? " sel" : ""}`} aria-current=${on ? "page" : undefined} onClick=${() => onOpenCatalog(e)}
        onContextMenu=${(ev) => { ev.preventDefault(); setMoveCtx({ key, x: ev.clientX, y: ev.clientY }); }}>
        <span class="avatar-wrap"><${BotAvatar} char=${e.avatar} size=${38} /></span>
        <span class="body">
          <span class="line"><span class="title">${tr(e.name, lang)}</span>${!seen.includes(e.id) && html`<span class="thread-new-dot" title=${t("botapp.sidebar.new")}></span>`}</span>
          <span class="line"><span class="snip">${tr(e.summary, lang)}</span></span>
        </span>
      </button>
      <${IconButton} icon="more" class="thread-more" label=${t("sidebar.section.moveFor", { name: tr(e.name, lang) })} aria-haspopup="menu" aria-expanded=${!!(moveCtx && moveCtx.el && moveCtx.key === key)}
        onClick=${(ev) => { const el = ev.currentTarget; setMoveCtx((c) => (c && c.el && c.key === key ? null : { key, el })); }} />
    </div>`;
  };

  // 收起时侧栏滑出窗口（shell.css 的 .side-off），这期间和收起之后都不让它拿到焦点
  return html`<aside class="side" ref=${root} aria-label=${t("sidebar.bots")} inert=${collapsed || undefined}>
    <div class="side-top">
      <${SideActions} bots=${bots} view=${view} onToggleSide=${onToggleSide} onOpenSearch=${onOpenSearch} onNew=${onNew} onTemplates=${onTemplates} onNewGroup=${onNewGroup}>
        <span class="side-brand"><img src="/amb/static/assets/favicon-64.png" alt="" /><span>AnyModelBot</span></span>
        <span class="grow"></span>
      <//>
    </div>
    <div class="side-nav">
      ${catalog.length > 0 && html`<button type="button" class=${`nav-item${discoverOn ? " sel" : ""}`} aria-current=${discoverOn ? "page" : undefined} onClick=${onDiscover}>
        <${Icon} name="compass" size="md" /><span class="label">${t("botapp.sidebar.discover")}</span>${hasNew && html`<span class="thread-new-dot" title=${t("botapp.sidebar.new")}></span>`}
      </button>`}
      <${ScheduledButton} active=${view === "scheduled"} />
      <${NeedsRow} count=${needs.n} on=${view === "needs"} onClick=${onNeeds} />
    </div>
    <nav class="side-list" aria-label=${t("sidebar.list")} onDragLeave=${(e) => drag && !e.currentTarget.contains(e.relatedTarget) && setDrop(null)}>
      ${sections.map((s) => {
        const rows = rowsIn(s);
        const name = secName(s);
        const folded = showHeads && fold.includes(s.id);
        const secFx = (drop?.sec === s.id && !drop.key ? ` drop-${drop.where}` : "") + (drag?.type === "section" && drag.id === s.id ? " drag-src" : "");
        const menuOpen = !!(secCtx && secCtx.el && secCtx.sec.id === s.id);
        return html`<div role="group" aria-label=${name} class=${`side-sec${secFx}`} key=${"s" + s.id}
          onDragOver=${(e) => drag && over(e, drag.type === "section" ? (drag.id === s.id ? null : { sec: s.id, where: half(e) }) : { sec: s.id, where: "into" })}
          onDrop=${onDropHere}>
          ${showHeads && (secRenaming === s.id
            ? html`<div class="side-sec-head editing"><input class="field" value=${secText} maxlength="40" aria-label=${t("sidebar.section.name")} ref=${secRenameRef}
                onInput=${(e) => setSecText(e.target.value)} onBlur=${() => renameSec(s)}
                onKeyDown=${(e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); secCancel.current = true; setSecRenaming(""); } }} /></div>`
            : html`<div class="side-sec-head" draggable="true" onDragStart=${(e) => startDrag(e, { type: "section", id: s.id })} onDragEnd=${endDrag}
                onContextMenu=${(e) => { e.preventDefault(); setSecCtx({ sec: s, x: e.clientX, y: e.clientY }); }}>
                <button type="button" class="side-group text" aria-expanded=${!folded} onClick=${() => toggleSideFold(s.id)}>
                  <span class="text t-label">${name}</span><${Icon} name=${folded ? "chevRight" : "chevDown"} size="sm" />
                </button>
                <${IconButton} icon="more" class="side-sec-more" label=${t("sidebar.section.moreFor", { name })} aria-haspopup="menu" aria-expanded=${menuOpen}
                  onClick=${(e) => { const el = e.currentTarget; setSecCtx((c) => (c && c.el && c.sec.id === s.id ? null : { sec: s, el })); }} />
              </div>`)}
          ${s.default && !folded && html`
          ${botsError && html`<div class="side-empty"><span>${t("sidebar.loadFailed")}</span><button type="button" class="btn" onClick=${reloadBots}>${t("common.retry")}</button></div>`}
          ${!bots && !botsError && [0, 1, 2].map((k) => html`<div class="thread" key=${k}><${Skeleton} w="38px" circle /><span class="thread-skel"><${Skeleton} w="50%" /><${Skeleton} w="75%" /></span></div>`)}
          ${bots && !bots.length && html`<div class="side-empty"><span>${t("sidebar.empty")}</span><button type="button" class="btn primary" onClick=${onNew}>${t("sidebar.create")}</button><button type="button" class="text" onClick=${onTemplates}>${t("templates.orTemplate")}</button></div>`}
          `}
          ${!folded && rows.map(({ kind, key, row, entry }) => {
            const sec = s.id;
            if (kind === "bot") return botRow(row, key, sec);
            if (kind === "group") return groupRow(row, key, sec);
            return entryRow(entry, key, sec);
          })}
          ${s.default && !folded && html`
          ${view === "new" && html`<div class="thread sel draft anim-fade-in" aria-current="page"><${BotAvatar} char=${draft?.avatar} neutral size=${38} />
            <span class="body"><span class="line"><span class="title">${draft?.name || t("sidebar.newBot")}</span></span><span class="line"><span class="snip">${t("sidebar.creating")}</span></span></span></div>`}
          `}
          ${!folded && !rows.length && drag?.type === "item" && html`<div class="side-sec-drop">${t("sidebar.section.dropHere")}</div>`}
        </div>`;
      })}
    </nav>
    ${bots && bots.length > 0 && html`<${GuidePill} onGo=${onGuide} />`}
    <div class="side-foot"><${AccountButton} username=${username} account=${account} update=${update} onUpdateChanged=${onUpdateChanged} onSettings=${() => onOpenSettings()} onModelflare=${() => onOpenSettings("modelflare")} /></div>
    ${ctx && html`<${Menu} anchor=${ctx.el || { left: ctx.x, right: ctx.x, top: ctx.y, bottom: ctx.y, width: 0 }} align=${ctx.el ? "right" : undefined}
      width=${200} label=${t("sidebar.actionsFor", { name: ctx.bot.name })} onClose=${() => setCtx(null)}
      items=${[
        ...(onBotSettings ? [{ label: t("sidebar.menu.settings"), icon: "gear", onSelect: () => onBotSettings(ctx.bot.id) }, { sep: true }] : []),
        { label: t("common.rename"), icon: "compose", onSelect: () => { setRenameText(ctx.bot.name); setRenaming(ctx.bot.id); } },
        { label: t("sidebar.section.moveItem"), icon: "folder", onSelect: () => setMoveCtx({ ...ctx, key: keyOfBot(ctx.bot) }) },
        { label: t("sidebar.menu.copyId"), icon: "copy", onSelect: () => navigator.clipboard?.writeText(ctx.bot.id).then(() => toast(t("common.copied"))).catch(failed) },
        { sep: true },
        { label: t("sidebar.menu.delete"), icon: "trash", danger: true, onSelect: () => del(ctx.bot) },
      ]} />`}
    ${groupCtx && html`<${Menu} anchor=${groupCtx.el || { left: groupCtx.x, right: groupCtx.x, top: groupCtx.y, bottom: groupCtx.y, width: 0 }} align=${groupCtx.el ? "right" : undefined}
      width=${200} label=${t("sidebar.groupActionsFor", { name: groupCtx.group.name })} onClose=${() => setGroupCtx(null)}
      items=${[
        { label: t("sidebar.groupEdit"), icon: "compose", onSelect: () => onEditGroup(groupCtx.group) },
        { label: t("sidebar.section.moveItem"), icon: "folder", onSelect: () => setMoveCtx({ ...groupCtx, key: keyOfGroup(groupCtx.group) }) },
        { sep: true },
        { label: t("sidebar.menu.delete"), icon: "trash", danger: true, onSelect: () => delGroup(groupCtx.group) },
      ]} />`}
    ${secCtx && (() => {
      const s = secCtx.sec;
      const i = sections.findIndex((x) => x.id === s.id);
      return html`<${Menu} anchor=${at(secCtx)} align=${secCtx.el ? "right" : undefined} width=${200} label=${t("sidebar.section.actionsFor", { name: secName(s) })} onClose=${() => setSecCtx(null)}
        items=${[
          { label: t("common.rename"), icon: "compose", onSelect: () => startRenameSec(s.id, secName(s)) },
          { label: t("sidebar.section.new"), icon: "plus", onSelect: () => newSection({ afterId: s.id }) },
          { sep: true },
          { label: t("sidebar.section.up"), icon: "up", disabled: i <= 0, onSelect: () => save(moveSection(layout, s.id, sections[i - 1].id)) },
          { label: t("sidebar.section.down"), icon: "down", disabled: i < 0 || i >= sections.length - 1, onSelect: () => save(moveSection(layout, s.id, sections[i + 2]?.id ?? null)) },
          { sep: true },
          { label: t("sidebar.section.delete"), icon: "trash", danger: true, disabled: layout.sections.length <= 1, onSelect: () => delSection(s) },
        ]} />`;
    })()}
    ${moveCtx && html`<${Menu} anchor=${at(moveCtx)} align=${moveCtx.el ? "right" : undefined} width=${220} label=${t("sidebar.section.moveTo")} onClose=${() => setMoveCtx(null)}
      items=${[
        { group: t("sidebar.section.moveTo") },
        ...sections.map((s) => ({ label: secName(s), icon: "folder", cur: sectionOf(layout, moveCtx.key)?.id === s.id, onSelect: () => sectionOf(layout, moveCtx.key)?.id !== s.id && moveTo(moveCtx.key, s.id) })),
        { sep: true },
        { label: t("sidebar.section.new"), icon: "plus", onSelect: () => newSection({ items: [moveCtx.key] }) },
      ]} />`}
  </aside>`;
}
