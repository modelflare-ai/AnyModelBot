// AnyModelBot 界面：Preact + htm，无构建步骤（原生 ES 模块）。
// 没有任何模型来源（Modelflare 或官方 API Key）→ 整页引导；已连接 → 侧栏 + 对话（信息面板按需），设置与机器人设置占满主区。
import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, DialogHost, Notice, Toasts, Splitter, tokenPx } from "./components/ui.js";
import { Sidebar, SideRail } from "./screens/sidebar.js";
import { ChatScreen } from "./screens/chat.js";
import { ScheduledPage, ScheduledSync, NewRuleHost, newRule } from "./screens/scheduled.js";
import { openScheduled } from "./lib/scheduled.js";
import { PermissionSync } from "./components/cu-permission.js";
import { WorkPanel, panelTabs } from "./screens/work-panel.js";
import { SettingsScreen, SettingsSide, TABS } from "./screens/settings.js";
import { BotSettingsScreen } from "./screens/bot-settings.js";
import { TemplateGallery, TemplatePreview } from "./screens/templates.js";
import { openTemplates, mayLeaveTemplate, templateFlow, blankBotDraft } from "./lib/template-flow.js";
import { NewBotScreen } from "./screens/new-bot.js";
import { NeedsYouScreen } from "./screens/needs-you.js";
import { BotAppScreen } from "./screens/bot-app.js";
import { DiscoverScreen } from "./screens/discover.js";
import { AppsScreen } from "./screens/apps.js";
import { AppDialogHost } from "./components/app-dialogs.js";
import { appsStore, loadApps } from "./lib/apps.js";
import { GroupScreen, GroupSheet } from "./screens/group.js";
import { MessageSearchScreen, ConversationHistoryScreen } from "./screens/message-search.js";
import { BotAvatar, MAIN_CHAR } from "./components/avatar.js";
import { Onboarding } from "./screens/onboarding.js";
import { CoachMark } from "./components/guide.js";
import { WhatsNewHost, openWhatsNew } from "./components/whats-new.js";
import { api } from "./lib/api.js";
import { clearCatalogRemoved } from "./lib/catalog.js";
import { loadGuide, leaveGuideSession, refreshGuide, isActive, setFocus, templateDraft } from "./lib/guide.js";
import { restoreRelaunchDrafts } from "./lib/relaunch.js";
import { previewText } from "./lib/errors.js";
import { PREVIEW_EVENT, addResource, emptyResources, removeResource } from "./lib/resource-preview.js";
import { setThemeMode } from "./lib/theme.js";
import { failed, toast, useStore } from "./lib/store.js";
import { prefs, setPrefs } from "./lib/prefs.js";
import { trailingThrottle } from "./lib/throttle.js";
import { usePresence } from "./design/motion.js";
import { t, useLang, adoptServerLang, changeLang, getLangPref, LANG_NAMES, LANGS } from "./lib/i18n.js";

// —— 路由：#/chat/<bot> · #/group/<群> · #/new · #/needs · #/settings/<tab>[/<row>] · #/bot/<bot>/settings[/<section>] ——
/** @returns {{view: string, botId?: string, groupId?: string, conversationId?: string, messageId?: number, query?: string, tab?: string, row?: string, section?: string, catalogId?: string}} */
function parseHash() {
  const [pathname, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [kind, a, b, c] = pathname.split("/").map((x) => decodeURIComponent(x || ""));
  const focus = b === "message" && Number.isSafeInteger(Number(c)) && Number(c) > 0 ? { messageId: Number(c), query: (new URLSearchParams(query).get("q") || "").slice(0, 200) } : {};
  if (kind === "settings") return { view: "settings", tab: TABS.some(([t]) => t === a) ? a : "general", row: b || "" };
  if (kind === "bot" && a && b === "settings") return { view: "bot-settings", botId: a, section: c || "" };
  if (kind === "group" && a) return { view: "group", groupId: a, ...focus };
  if (kind === "conversation" && a && focus.messageId) return { view: "conversation", conversationId: a, ...focus };
  if (kind === "new") return { view: "new", query };
  if (kind === "templates") return { view: a ? "template-preview" : "templates", catalogId: a };
  if (kind === "needs") return { view: "needs" };
  if (kind === "discover") return { view: "discover" };
  if (kind === "scheduled") return { view: "scheduled" };
  if (kind === "apps") return { view: "apps", tab: a === "connected" ? "connected" : "all" };
  if (kind === "app" && a) return { view: "app", botId: a };
  if (kind === "preview" && a) return { view: "preview", catalogId: a };
  if (kind === "models") return { view: "settings", tab: "modelflare", row: "" }; // 旧链接
  return { view: "chat", botId: kind === "chat" ? a : "", ...focus };
}
const go = (path) => {
  if (location.hash !== "#" + path) location.hash = path;
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);
/** 窗口窄到右侧面板变成浮在对话上的抽屉（和 shell.css 的 @media 同一个断点） */
const drawerMode = () => window.matchMedia("(max-width: 1180px)").matches;

function readLastBot() {
  try {
    return localStorage.getItem("amb-bot") || "";
  } catch {
    return "";
  }
}

function useLoader(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(
    () =>
      fn()
        .then((d) => {
          setData(d);
          setErr("");
          return d;
        })
        .catch((e) => {
          setErr(e.message);
        }),
    deps,
  );
  useEffect(() => {
    load();
  }, [load]);
  return [data, err, load, setData];
}

function useInterval(fn, ms, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => document.visibilityState === "visible" && saved.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}

// —— 命令面板（⌘/Ctrl+K）——
function Palette({ commands, onClose }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef(null);
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  const needle = q.trim().toLowerCase();
  const hits = commands.filter((c) => !needle || `${c.label} ${c.keys || ""}`.toLowerCase().includes(needle));
  const run = (c) => {
    onClose();
    c.run();
  };
  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(hits.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && hits[sel]) {
      e.preventDefault();
      run(hits[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    requestAnimationFrame(() => ref.current?.querySelector("li.sel")?.scrollIntoView({ block: "nearest" }));
  };
  return html`<div class="palette-scrim" onPointerDown=${onClose}></div>
    <div class="palette" role="dialog" aria-modal="true" aria-label=${t("app.palette.title")}>
      <div class="search"><${Icon} name="search" size="md" />
        <input ref=${input} placeholder=${t("app.palette.placeholder")} aria-label=${t("app.palette.inputLabel")} value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} />
      </div>
      <ul role="listbox" ref=${ref}>
        ${hits.map((c, i) => html`<li role="option" aria-selected=${i === sel} class=${i === sel ? "sel" : ""} onPointerMove=${() => setSel(i)} onClick=${() => run(c)}>
          <span class="v">${c.label}</span>${c.kbd && html`<kbd>${c.kbd}</kbd>`}
        </li>`)}
        ${!hits.length && html`<li class="group" style="pointer-events:none">${t("app.palette.empty")}</li>`}
      </ul>
    </div>`;
}


function App() {
  // 订阅界面语言：切换语言时整棵树跟着重渲染（子组件里的 t() 都在渲染时取）
  const lang = useLang();
  const [route, setRoute] = useState(parseHash);
  const [mf, mfErr, reloadMf] = useLoader(() => api("/modelflare"));
  const [status, , reloadStatus] = useLoader(() => api("/status"));
  // 更新检查和下载在桌面主进程进行；这里只读状态，下载时更频繁地刷新进度。
  const [update, , reloadUpdate] = useLoader(() => api("/update"));
  useInterval(reloadUpdate, update?.supported ? (update.phase === "downloading" ? 1000 : 5000) : 60_000);
  const [settings, , reloadSettings, setSettings] = useLoader(() => api("/settings"));
  // 语言偏好以服务端配置为准（可能在另一个窗口 / 浏览器里改过）；本机缓存只管首帧
  useEffect(() => {
    if (settings) adoptServerLang(settings.lang);
  }, [settings && settings.lang]);
  const connected = !!(mf && !mf.setupRequired && (mf.mode === "external" || mf.connected || mf.official));
  const [botsData, botsErr, reloadBots, setBotsData] = useLoader(() => (connected ? api("/bots") : Promise.resolve(null)), [connected]);
  const [groupsData, , reloadGroups] = useLoader(() => (connected ? api("/groups") : Promise.resolve(null)), [connected]);
  const [groupSheet, setGroupSheet] = useState(null); // 建群 / 改群的弹窗：{ group? }
  const [modelsData, , loadModels] = useLoader(() => (connected ? api("/models") : Promise.resolve(null)), [connected]);
  // 目录 Bot：目录是空的时候界面和没有这个功能时一样
  const [catalogData, , reloadCatalog] = useLoader(() => api("/catalog"));
  const catalog = catalogData ? catalogData.bots : [];
  useInterval(reloadCatalog, 600_000);
  // Modelflare 账户与余额：后端每 5 分钟读一次；界面每分钟取快照，切回窗口时请后端立刻刷新
  const [account, , , setAccount] = useLoader(() => api("/account"), [connected]);
  const managed = !!(mf && mf.mode === "managed");
  // 登录 / 退出 / 回到接入配置：重新读连接状态、设置、模型和账户。用 ref 拿最新的加载函数：
  // loadModels 跟着 connected 变，事件处理里不能留着第一次渲染时的那个（那时可能还没连上，读不到模型）
  const onConnectionChange = useRef(null);
  onConnectionChange.current = () => { reloadMf(); reloadSettings(); loadModels(); api("/account").then(setAccount).catch(() => {}); };
  useEffect(() => {
    const changed = () => onConnectionChange.current?.();
    window.addEventListener("amb-connection-change", changed);
    return () => window.removeEventListener("amb-connection-change", changed);
  }, []);
  // 系统要求重新打开应用（电脑操作权限）前暂存的草稿：放回输入框，取一次就删
  const [restoringDrafts, setRestoringDrafts] = useState(true);
  useEffect(() => {
    api("/computer-use/relaunch-drafts").then(restoreRelaunchDrafts).catch(() => {}).finally(() => setRestoringDrafts(false));
  }, []);
  const [previews, setPreviews] = useState({});
  const [pending, setPending] = useState({});
  const [agentWorking, setAgentWorking] = useState({});
  // 有后台任务在进行的机器人：侧栏头像也是"工作中"（不算对话在忙，对话页不因此去接进行中的消息）
  const [bgWorking, setBgWorking] = useState({});
  // 「需要你」：件数（侧栏那一行，0 时没有）和每个机器人的件数、最早那件
  const [needs, setNeeds] = useState({ n: 0, bots: {} });
  // 电脑操作在等系统授权的机器人（macOS 桌面版）：对话页显示授权卡片
  const [cuBlocked, setCuBlocked] = useState([]);
  const [localWorking, setLocalWorking] = useState({});
  // 右侧面板（screens/work-panel.js）：普通机器人按需打开（infoOpen）；专业 Bot 默认开着，关上 / 打开按目录 id 记（这次打开应用期间），
  // 没动过的按默认来——窗口够宽就开着，窄窗口里面板是盖住对话的抽屉，先不开。当前标签两类各记一个
  const [infoOpen, setInfoOpen] = useState(false);
  const [appPanels, setAppPanels] = useState({});
  const [expandedScope, setExpandedScope] = useState("");
  const [panelTab, setPanelTab] = useState({ chat: "overview", app: "app" });
  const [resourcePanels, setResourcePanels] = useState({});
  const [extraPanelOpen, setExtraPanelOpen] = useState(false);
  const [appEntry, setAppEntry] = useState(null); // 专业 Bot 的目录条目 { catalogId, entry }（BotAppScreen 读到后给，概览里列出说明）
  const [workHost, setWorkHost] = useState(null); // 面板「工作台」标签的宿主节点，BotAppScreen 把界面渲染进去
  const [palette, setPalette] = useState(false);
  const [searchOpen, setSearchOpenValue] = useState(false);
  const searchOpenRef = useRef(false);
  const setSearchOpen = (value) => { searchOpenRef.current = value; setSearchOpenValue(value); };
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState(0);
  const [fromSearch, setFromSearch] = useState(false);
  const [messageJump, setMessageJump] = useState(0);
  const searchReturnFocus = useRef(null);
  const [settingsQ, setSettingsQ] = useState("");
  const [lastBot, setLastBot] = useState(readLastBot);

  const acceptedHash = useRef(location.hash);
  useEffect(() => {
    let sequence = 0;
    const on = async () => {
      const destination = location.hash; const current = ++sequence;
      if (destination === acceptedHash.current) return;
      if (templateFlow.get().preview) {
        history.replaceState(null, "", acceptedHash.current || "#/templates");
        if (!await mayLeaveTemplate(destination) || current !== sequence) return;
        history.replaceState(null, "", destination);
      }
      acceptedHash.current = destination;
      if (/^#\/new\?fresh=/.test(destination)) { blankBotDraft.set(null); templateDraft.set(null); }
      const next = parseHash();
      if (["chat", "app"].includes(next.view) && next.botId) setLastBot(next.botId);
      setRoute(next); setSearchOpen(false);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useInterval(() => api("/account").then(setAccount).catch(() => {}), 60_000, connected && managed);
  const guideConnected = useRef(false);
  // 上手清单：连上 Modelflare 之后读进度（新用户在对话空状态里看到清单，老用户已做过的步骤会自动打勾）
  useEffect(() => {
    if (!connected && guideConnected.current) leaveGuideSession();
    guideConnected.current = connected;
    if (connected) loadGuide();
  }, [connected, account?.state]);
  // 升级后第一次进到主界面：弹一次"更新了什么"（全新安装、首次登录引导时不弹）
  useEffect(() => {
    if (!connected) return;
    api("/whats-new").then((w) => w.show && openWhatsNew({ mode: "installed", version: w.current, since: w.seen })).catch(() => {});
  }, [connected]);
  useEffect(() => {
    if (!connected || !managed) return;
    const on = () => document.visibilityState === "visible" && api("/account/refresh", { method: "POST", body: {} }).then(setAccount).catch(() => {});
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, [connected, managed]);
  // 额度要最新的时候请后端立刻读一次（3 秒内读过就沿用）：手动请求刷新时（amb-account-refresh），
  // 以及每处理完一件事（下面看"工作中"的变化）。后者 10 秒内最多一次，期间又处理完的到时补一次
  const refreshAccount = useRef(null);
  refreshAccount.current = () => connected && managed && api("/account/refresh", { method: "POST", body: { maxAgeMs: 3000 } }).then(setAccount).catch(() => {});
  useEffect(() => {
    const on = () => refreshAccount.current?.();
    window.addEventListener("amb-account-refresh", on);
    return () => window.removeEventListener("amb-account-refresh", on);
  }, []);
  const usageRefresh = useMemo(() => trailingThrottle(() => refreshAccount.current?.(), 10_000, 1500), []);
  // 授权在网页上被撤销时后端会断开连接：回到登录页；余额跌破提醒线时提示一次
  const prevAccount = useRef(null);
  useEffect(() => {
    const prev = prevAccount.current;
    prevAccount.current = account;
    if (!prev || !account) return;
    if (prev.state === "signed_in" && account.state !== "signed_in") reloadMf();
  }, [account]);

  const bots = botsData ? botsData.bots : null;
  const appReturn = useRef(null);
  const wanted = route.botId || lastBot;
  const bot = bots && (bots.find((b) => b.id === wanted) || bots[0]);
  useEffect(() => {
    if (!bot) return;
    try {
      localStorage.setItem("amb-bot", bot.id);
    } catch {
      /* ignore */
    }
  }, [bot && bot.id]);

  if (route.view !== "apps") {
    if (["chat", "app"].includes(route.view) && bot) appReturn.current = { ...bot, route: `/${bot.origin === "catalog" ? "app" : "chat"}/${encodeURIComponent(bot.id)}`, target: bot.id };
    else if (route.view === "group" && route.groupId) appReturn.current = { id: route.groupId, route: `/group/${encodeURIComponent(route.groupId)}`, target: `group:${route.groupId}` };
    else appReturn.current = null;
  }
  // 目录 Bot（专业 Bot）的页面是 #/app/<实例>（还没有实例时 #/preview/<目录 id>）：对话在中间，专属界面在右侧面板；被安全原因下架的退回普通对话
  const isAppBot = (b) => !!b && b.origin === "catalog" && !b.app?.removed?.security;
  useEffect(() => {
    if (route.view === "chat" && !route.messageId && isAppBot(bot)) go(`/app/${encodeURIComponent(bot.id)}`);
  }, [route.view, route.messageId, bot && bot.id, bot && bot.origin]);
  const appCatalogId = route.view === "preview" ? route.catalogId : route.view === "app" && bot?.app ? bot.app.catalogId : "";
  const appBot = route.view === "preview" ? (bots || []).find((b) => b.app?.catalogId === route.catalogId) || null : route.view === "app" && appCatalogId ? bot : null;
  // 右侧面板：对话页是这个机器人的面板，专业 Bot 的页面是带工作台的面板；关上时多留一会儿，播完"列宽滑回 0、面板淡出"再卸载
  const panelKind = route.view === "chat" && bot ? "chat" : appCatalogId ? "app" : "resources";
  const resourceScope = appCatalogId ? `app:${appCatalogId}` : route.view === "chat" && bot ? `chat:${bot.id}` : `${route.view}:${route.groupId || route.conversationId || route.botId || ""}`;
  const resources = resourcePanels[resourceScope] || emptyResources();
  const appPanel = !!appCatalogId && (appPanels[appCatalogId] ?? !drawerMode());
  const panelOpen = panelKind === "chat" ? infoOpen : panelKind === "app" ? appPanel : extraPanelOpen && resources.items.length > 0;
  const workExpanded = panelKind === "app" && panelOpen && expandedScope === resourceScope;
  useEffect(() => { setExpandedScope(""); }, [resourceScope, panelOpen]);
  const setPanelOpen = (open) => {
    if (panelKind === "chat") setInfoOpen(open);
    else if (panelKind === "app") setAppPanels((m) => ({ ...m, [appCatalogId]: typeof open === "function" ? open(appPanel) : open }));
    else setExtraPanelOpen(open);
  };
  const togglePanel = () => setPanelOpen((v) => !v);
  useEffect(() => {
    const onOpen = (event) => {
      const item = event.detail;
      if (!item?.id || !["file", "website"].includes(item.type)) return;
      event.preventDefault();
      setResourcePanels((all) => ({ ...all, [resourceScope]: addResource(all[resourceScope], item) }));
      setPanelTab((tabs) => ({ ...tabs, [panelKind]: "resources" }));
      setPanelOpen(true);
    };
    window.addEventListener(PREVIEW_EVENT, onOpen);
    return () => window.removeEventListener(PREVIEW_EVENT, onOpen);
  }, [resourceScope, panelKind, appCatalogId]);
  const panel = panelOpen
    ? panelKind === "app"
      ? { kind: "app", key: resourceScope, bot: appBot, entry: appEntry?.catalogId === appCatalogId ? appEntry.entry : null, resources }
      : { kind: panelKind, key: resourceScope, bot: panelKind === "chat" ? bot : null, entry: null, resources }
    : null;
  const panelFx = usePresence(!!panel, "--dur-slow");
  const lastPanel = useRef(null);
  if (panel) lastPanel.current = panel;
  // 侧栏 / 右侧面板的宽度：拖分隔条调整，存在本机偏好里（lib/prefs.js 把它写成 <html> 上的 --side-w-user / --panel-w-user / --work-w-user；
  // 带工作台的面板更宽，宽度单独记）。侧栏收起也存在这里；设置页的侧栏是分页导航，不跟着收起
  const { sideW, panelW, workW, sideHidden, notify: notifyEnabled } = useStore(prefs);
  useEffect(() => {
    if (settings?.desktop) api("/desktop/preferences", { method: "POST", body: { notify: notifyEnabled } }).catch(() => {});
  }, [settings?.desktop, notifyEnabled]);
  const toggleSide = () => setPrefs({ sideHidden: !prefs.get().sideHidden });
  const appRef = useRef(null);
  /** 拖宽一侧时最多还能给多宽：窗口 − 另一侧那一列此刻的宽度 − 主区最小宽度 */
  const room = (otherCol) => () => window.innerWidth - tokenPx(otherCol, 0, appRef.current || undefined) - tokenPx("--main-w-min", 0);

  const models = modelsData ? modelsData.models : null;
  const modelsError = modelsData && modelsData.error ? modelsData.error : "";
  const reloadModels = () =>
    api("/models")
      .then((d) => {
        loadModels();
        return d;
      })
      .catch(failed);

  // 侧栏的预览、待审批数与"工作中"
  const pollSide = useCallback(() => {
    if (!connected) return;
    api("/conversations")
      .then((d) => {
        const latest = {};
        // 群里的话算在群聊那一行，不算在机器人这一行
        for (const c of d.conversations || []) if (!c.peerId?.startsWith("group:") && (!latest[c.botId] || c.updatedAt > latest[c.botId].updatedAt)) latest[c.botId] = c;
        setPreviews(Object.fromEntries(Object.entries(latest).map(([k, c]) => [k, { text: previewText(c.lastMessage), at: c.updatedAt, failed: (c.lastMessage || "").startsWith("⚠️") }])));
      })
      .catch(() => {});
    reloadGroups();
    api("/approvals?status=pending")
      .then((d) => {
        const n = {};
        for (const a of d.approvals || []) n[a.botId] = (n[a.botId] || 0) + 1;
        setPending(n);
      })
      .catch(() => {});
  }, [connected]);
  useEffect(pollSide, [pollSide]);
  useInterval(pollSide, 6000, connected);
  // 服务端的"正在工作"：代理回合，以及任何渠道正在处理（含排队、等代理启动、纯对话）的消息
  const pollWorking = useCallback(
    () =>
      api("/agent")
        .then((a) => {
          const map = {};
          for (const [id, h] of Object.entries(a.hosts || {})) map[id] = Number(h.activeTurns || 0) > 0;
          for (const id of a.busy || []) map[id] = true;
          setAgentWorking(map);
          const bg = {};
          for (const [id, n] of Object.entries(a.background || {})) if (Number(n) > 0) bg[id] = true;
          setBgWorking(bg);
          setNeeds({ n: Number(a.attention) || 0, bots: a.needs || {} });
          setCuBlocked((prev) => {
            const next = Array.isArray(a.cuBlocked) ? a.cuBlocked : [];
            return prev.join() === next.join() ? prev : next;
          });
          // 连接应用里有没有要处理凭证的连接（头像上的提醒点）
          appsStore.set((v) => (v.attention === !!a.appsAttention ? v : { ...v, attention: !!a.appsAttention }));
        })
        .catch(() => {}),
    [],
  );
  useInterval(pollWorking, 3000, connected);
  // 应用清单：对话里的连接卡片、机器人设置随时会打开连接弹窗，先取一份
  useEffect(() => void (connected && loadApps()), [connected]);
  useEffect(() => void (connected && pollWorking()), [connected]);
  const working = useMemo(() => {
    const m = { ...agentWorking };
    for (const src of [bgWorking, localWorking]) for (const [k, v] of Object.entries(src)) if (v) m[k] = true;
    return m;
  }, [agentWorking, bgWorking, localWorking]);
  // 某个机器人从"工作中"变回空闲（对话、渠道消息、后台任务处理完）：这次请求的花费已经记上，刷新额度
  const prevWorking = useRef({});
  useEffect(() => {
    const prev = prevWorking.current;
    prevWorking.current = working;
    if (Object.keys(prev).some((id) => prev[id] && !working[id])) {
      if (account?.state === "signed_in") usageRefresh();
      if (isActive()) refreshGuide();
    }
  }, [working]);
  const wantWorking = useRef({});
  const onWorking = useCallback((id, on) => {
    wantWorking.current[id] = on;
    if (on) return setLocalWorking((w) => (w[id] ? w : { ...w, [id]: true }));
    // 切走时消息可能还在服务端处理：先问一次服务端，再去掉本页的标记，侧栏不闪（期间又开始了就不去掉）
    pollWorking().finally(() => !wantWorking.current[id] && setLocalWorking((w) => (w[id] ? { ...w, [id]: false } : w)));
    setTimeout(pollSide, 300);
  }, [pollSide, pollWorking]);

  const openSettings = (tab = route.view === "settings" ? route.tab : "general", row = "") => {
    reloadStatus();
    go(`/settings/${tab}${row ? "/" + row : ""}`);
  };
  const openChat = (id) => {
    setSearchOpen(false); setFromSearch(false);
    const target = id || (bot && bot.id) || "";
    go(`/${isAppBot((bots || []).find((b) => b.id === target)) ? "app" : "chat"}/${encodeURIComponent(target)}`);
  };
  const openDiscover = () => {
    setSearchOpen(false);
    setFromSearch(false);
    go("/discover");
  };
  /** 连接应用（头像菜单、设置里原来的数据账号位置、机器人设置的「连接更多应用」）：tab = "connected" 时停在「已连接」 */
  const openApps = (tab = "") => {
    setSearchOpen(false);
    setFromSearch(false);
    go(tab === "connected" ? "/apps/connected" : "/apps");
  };
  const openCatalog = (e) => (e.instanceId ? openChat(e.instanceId) : go(`/preview/${encodeURIComponent(e.id)}`));
  // 第一次发消息创建了实例：地址换成实例，界面不重新加载（BotAppScreen 按目录 id 复用）
  const onInstalled = async (b) => {
    if (b.app?.catalogId) clearCatalogRemoved(b.app.catalogId);
    await reloadBots();
    reloadCatalog();
    setLastBot(b.id);
    history.replaceState(null, "", `#/app/${encodeURIComponent(b.id)}`);
    setRoute(parseHash());
  };
  useEffect(() => {
    const on = () => setGroupSheet({}); window.addEventListener("amb-new-group", on);
    return () => window.removeEventListener("amb-new-group", on);
  }, []);
  const newBot = () => go(`/new?fresh=${Date.now()}`);
  // 清单里点一项：回到对话页，引导卡片指着要点的地方
  const startGuide = (id) => {
    setFocus(id);
    if (route.view !== "chat") openChat();
  };
  const openNeeds = () => go("/needs");
  const openGroup = (id) => { setSearchOpen(false); setFromSearch(false); go(`/group/${encodeURIComponent(id)}`); };
  const openSearch = (focus = true) => {
    // 搜索是弹窗：关上后焦点回到打开它的地方（侧栏的搜索入口、聊天输入框等）
    if (!searchOpenRef.current) searchReturnFocus.current = document.activeElement;
    setSearchOpen(true); setPalette(false);
    if (focus || window.innerWidth <= 600) setSearchFocus((n) => n + 1);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => {
      const previous = searchReturnFocus.current;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    });
  };
  const openSearchHit = (hit, query) => {
    setSearchOpen(false); setFromSearch(true);
    setMessageJump((n) => n + 1);
    const tail = `/message/${hit.id}?q=${encodeURIComponent(query)}`;
    if (hit.groupId) go(`/group/${encodeURIComponent(hit.groupId)}${tail}`);
    else if (hit.channel === "web" && hit.conversationId === `${hit.botId}:web:console`) {
      setLastBot(hit.botId); go(`/chat/${encodeURIComponent(hit.botId)}${tail}`);
    } else go(`/conversation/${encodeURIComponent(hit.conversationId)}${tail}`);
  };
  const onDeletedGroup = (id) => {
    reloadGroups();
    if (route.view === "group" && route.groupId === id) go("/chat/");
  };
  // 「需要你」里的重新扫码（事项 id 是 login:<账号>:<渠道>）：直接打开这个账号的管理弹窗
  const relogin = (id) => {
    const [, key, channel] = id.split(":");
    openSettings("connections", `channel-${channel}-${key}`);
  };
  useEffect(() => {
    if (route.view !== "settings") setSettingsQ("");
  }, [route.view]);
  const openBotSettings = (id, section = "") => go(`/bot/${encodeURIComponent(id)}/settings${section ? "/" + section : ""}`);
  // 命令面板的「任务」：打开这个机器人的页面，右侧面板停在「任务」标签
  const openTasks = (b) => {
    const kind = isAppBot(b) ? "app" : "chat";
    openChat(b.id);
    setPanelTab((p) => ({ ...p, [kind]: "tasks" }));
    if (kind === "app") setAppPanels((m) => ({ ...m, [b.app.catalogId]: true }));
    else setInfoOpen(true);
  };
  useEffect(() => {
    const show = (event) => { const b = bots?.find((x) => x.id === event.detail.botId); if (b) openTasks(b); };
    window.addEventListener("amb-open-rule", show);
    return () => window.removeEventListener("amb-open-rule", show);
  }, [bots]);
  // 面板里点了网页上的这段对话：它就在中间；窄窗口里面板盖着对话，先关上
  const panelToChat = () => {
    if (drawerMode()) setPanelOpen(false);
    requestAnimationFrame(() => document.querySelector(".main .composer textarea")?.focus());
  };
  const onBotUpdated = () => { refreshGuide(); return reloadBots(); };
  // 建好后等列表里有了它再切过去：先切的话，新机器人还不在列表里，会闪一下第一个机器人
  const onCreated = async (b) => {
    await reloadBots();
    setLastBot(b.id);
    location.hash = `/chat/${encodeURIComponent(b.id)}`;
    setRoute(parseHash()); // 不等 hashchange：占位行和新行不同时出现
  };
  // 先从列表里拿掉：不留给对话页去请求已经删掉的机器人。正在看它时，回到剩余列表中的第一个机器人
  const onDeleted = (id) => {
    const list = bots || [];
    const rest = list.filter((b) => b.id !== id);
    const next = rest[0];
    setBotsData((d) => d && { ...d, bots: rest });
    reloadBots();
    refreshGuide();
    reloadCatalog(); // 目录 Bot 移除后，发现页要变回没打开过
    reloadGroups();
    if (!bot || bot.id !== id) return;
    setLastBot(next ? next.id : "");
    if (route.view !== "chat" && route.view !== "app" && route.view !== "bot-settings") return;
    if (next) openChat(next.id);
    else go("/chat/");
  };

  // —— 全局快捷键 ——
  useEffect(() => {
    // Search owns Escape before a previously focused composer can treat it as Stop.
    const closeSearchFirst = (e) => {
      if (connected && searchOpenRef.current && e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault(); e.stopPropagation(); closeSearch();
      }
    };
    const key = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (!connected) return;
      if (mod(e) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault(); openSearch();
      } else if (searchOpenRef.current && e.key === "Escape") {
        e.preventDefault(); closeSearch();
      } else if (mod(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (mod(e) && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        togglePanel();
      } else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newBot();
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const t = e.target;
        const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
        if (route.view === "bot-settings" && !typing) openChat(route.botId);
        else if (route.view === "template-preview" && !document.querySelector(".pop")) go("/templates");
        else if (route.view === "new" && !typing && bots && bots.length) openChat();
        else if (route.view === "settings" && !typing) openChat();
        else if ((route.view === "needs" || route.view === "discover" || route.view === "apps") && !typing) openChat();
        else if (workExpanded && !typing) setExpandedScope("");
        else if (panelOpen && !typing) setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keydown", closeSearchFirst, true);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keydown", closeSearchFirst, true); };
  }, [connected, route, panelKind, panelOpen, workExpanded, appCatalogId, searchOpen, bot && bot.id]);

  // keys：搜索用的关键词（不显示），两种语言的词典各有一份
  const setLang = (l) => changeLang(l).then(() => toast(t("common.saved"))).catch(failed);
  const commands = [
    { label: t("scheduled.command"), keys: "定时 规则 提醒 routine schedule rule", run: openScheduled }, // i18n-ignore: multilingual command search keywords
    { label: t("scheduled.newRule"), keys: "新规则 new routine schedule rule", run: newRule }, // i18n-ignore: multilingual command search keywords
    { label: t("search.title"), kbd: isMac ? "⌘⇧F" : "Ctrl+Shift+F", keys: t("search.commandKeys"), run: () => openSearch() },
    { label: t("app.cmd.settings"), kbd: isMac ? "⌘," : "Ctrl+,", keys: t("app.cmd.settingsKeys"), run: () => openSettings() },
    { label: t("templates.title"), keys: "template role 模板 角色", run: () => openTemplates() }, // i18n-ignore: search aliases
    { label: t("app.cmd.newBot"), kbd: isMac ? "⌘N" : "Ctrl+N", keys: t("app.cmd.newBotKeys"), run: newBot },
    ...(needs.n > 0 ? [{ label: t("app.cmd.needs", { count: needs.n }), keys: t("app.cmd.needsKeys"), run: openNeeds }] : []),
    ...(catalog.length > 0 ? [{ label: t("botapp.sidebar.discover"), keys: "discover", run: openDiscover }] : []),
    { label: t("apps.menu"), keys: t("apps.commandKeys"), run: () => openApps() },
    ...(panelKind !== "resources" || resources.items.length ? [{ label: panelOpen ? t("app.cmd.closeInfo") : t("app.cmd.openInfo"), kbd: isMac ? "⌘⇧I" : "Ctrl+Shift+I", keys: t("app.cmd.infoKeys"), run: togglePanel }] : []),
    // 任务和规则在当前机器人右侧面板的「任务」标签里
    ...(bot ? [{ label: t("app.cmd.tasks"), keys: t("app.cmd.tasksKeys"), run: () => openTasks(bot) }] : []),
    ...(bot ? [{ label: t("app.cmd.botSettings", { name: bot.name }), keys: t("app.cmd.botSettingsKeys"), run: () => openBotSettings(bot.id) }] : []),
    { label: t("app.cmd.modelflare"), keys: t("app.cmd.modelflareKeys"), run: () => openSettings("modelflare") },
    { label: t("app.cmd.appearance"), keys: t("app.cmd.appearanceKeys"), run: () => openSettings("appearance") },
    { label: t("app.cmd.themeSystem"), keys: t("app.cmd.themeKeys"), run: () => setThemeMode("system") },
    { label: t("app.cmd.themeLight"), keys: t("app.cmd.themeLightKeys"), run: () => setThemeMode("light") },
    { label: t("app.cmd.themeDark"), keys: t("app.cmd.themeDarkKeys"), run: () => setThemeMode("dark") },
    // 语言：各语言用自己的文字写名字；当前选中的那一项不列
    ...[["system", t("common.lang.system")], ...LANGS.map((l) => [l, LANG_NAMES[l]])]
      .filter(([v]) => v !== getLangPref())
      .map(([v, name]) => ({ label: t("app.cmd.lang", { name }), keys: t("app.cmd.langKeys"), run: () => setLang(v) })),
    ...(bots || []).map((b) => ({ label: t("app.cmd.switchBot", { name: b.name }), keys: "bot switch " + b.id, run: () => openChat(b.id) })),
  ];

  // —— 渲染 ——
  if (!mf || restoringDrafts) {
    return html`<main class="onboard" data-screen=${mfErr ? "error" : "loading"}>
      ${mfErr
        ? html`<div class="onboard-col"><div class="onboard-hero"><${BotAvatar} char=${MAIN_CHAR} size=${88} state="sleep" lively pokeable /></div>
            <${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${reloadMf}>${t("common.retry")}</button>`}>${t("app.serviceDown", { error: mfErr })}<//></div>`
        : html`<${BotAvatar} char=${MAIN_CHAR} size=${72} state="thinking" lively />`}
    </main>`;
  }
  if (!connected) {
    return html`<${Onboarding} gateway=${status && status.gateway} defaultModel=${settings && settings.defaultModel}
        connection=${mf} skipModelStep=${catalog.length > 0} existingConnection=${!!mf.setupRequired && (mf.official || mf.connected)}
        onDone=${() => { reloadMf(); reloadSettings(); go("/chat/"); }} />
      <${Toasts} />`;
  }

  const view = route.view;
  const groups = groupsData ? groupsData.groups : [];
  const returnTarget = appReturn.current;
  const appChatTarget = returnTarget && (returnTarget.target?.startsWith("group:") ? groups.some((g) => g.id === returnTarget.id) : (bots || []).some((b) => b.id === returnTarget.id)) ? returnTarget : null;
  const routedGroup = view === "group" ? groups.find((g) => g.id === route.groupId) : null;
  const shownPanel = panelFx.mounted ? panel || lastPanel.current : null;
  // 宽度由面板类型决定，切换标签沿用同一宽度与拖动设置；关闭过渡也保持原宽度。
  const wide = shownPanel?.kind === "app" || shownPanel?.kind === "resources";
  const routedBot = view === "bot-settings" && bots ? bots.find((b) => b.id === route.botId) : null;
  const sideOff = sideHidden;
  const sideView = view === "chat" && bots && !bots.length ? "new" : view;
  // SideRail 放在 main 后面：Electron 依次合并 drag / no-drag 区域，主区顶栏不能覆盖浮动按钮的 no-drag。
  return html`<div class=${`app${panel ? " with-panel" : ""}${wide ? " panel-wide" : ""}${workExpanded ? " panel-expanded" : ""}${sideOff ? " side-off" : ""}${fromSearch && route.messageId ? " search-reading" : ""}`} ref=${appRef}>
    ${view === "settings"
      ? html`<${SettingsSide} tab=${route.tab} query=${settingsQ} onQuery=${setSettingsQ} onTab=${(t) => openSettings(t)} onBack=${() => openChat()}
          nav=${{ bots, view, onToggleSide: toggleSide, onOpenSearch: openSearch, onNew: newBot, onTemplates: () => openTemplates(), onNewGroup: () => setGroupSheet({}) }}
          username=${status && status.username} account=${managed ? account : null} update=${update} onUpdateChanged=${reloadUpdate} />`
      : html`<${Sidebar} bots=${bots} botsError=${botsErr} reloadBots=${reloadBots} selectedId=${bot && bot.id} view=${sideView} collapsed=${sideOff} onToggleSide=${toggleSide}
          previews=${previews} pending=${pending} working=${working} needs=${needs} username=${status && status.username} account=${managed ? account : null} update=${update} onUpdateChanged=${reloadUpdate}
          onNew=${newBot} onTemplates=${() => openTemplates()} onSelect=${openChat} onNeeds=${openNeeds} onDeleted=${onDeleted} onOpenSettings=${(tab) => openSettings(tab)} onBotSettings=${openBotSettings} onGuide=${startGuide}
          groups=${groups} groupsLoaded=${!!groupsData} groupId=${route.groupId} onNewGroup=${() => setGroupSheet({})} onSelectGroup=${openGroup} onEditGroup=${(group) => setGroupSheet({ group })} onDeletedGroup=${onDeletedGroup}
          catalog=${catalog} catalogId=${route.catalogId} onDiscover=${openDiscover} onOpenCatalog=${openCatalog}
          onOpenSearch=${openSearch} />`}
    ${!sideOff && html`<${Splitter} class="split-side" size="--side-w" label=${t("app.resizeSide")} value=${sideW} room=${room("--panel-track")} onCommit=${(v) => setPrefs({ sideW: v })} />`}
    <main class="main">
      ${mf.keyChangeNotice && html`<div class="key-change-note"><${Notice} action=${html`<${IconButton} icon="close" label=${t("common.close")} onClick=${async () => { await api("/account/key-notice", { method: "DELETE" }); reloadMf(); }} />`}>${t("firstUse.keyChanged")}<//></div>`}
      <div class="route-content" inert=${searchOpen || undefined}>
      ${view === "chat" && bot && html`<${ChatScreen} key=${bot.id} bot=${bot} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
        initialFocus=${{ id: route.messageId, query: route.query, nonce: messageJump }} onBackToSearch=${fromSearch ? () => openSearch() : undefined}
        defaultModel=${settings && settings.defaultModel} infoOpen=${panelOpen} onToggleInfo=${togglePanel}
        onWorking=${onWorking} pending=${pending[bot.id] || 0} serverBusy=${!!agentWorking[bot.id]} onOpenSettings=${openSettings} onOpenBotSettings=${openBotSettings} onBotUpdated=${onBotUpdated}
        account=${managed ? account : null} onAccount=${setAccount} cuBlocked=${cuBlocked.includes(bot.id)} />`}
      ${view === "discover" && html`<${DiscoverScreen} catalog=${catalog} onOpen=${openCatalog} onTemplates=${() => openTemplates("discover")} />`}
      ${view === "templates" && html`<${TemplateGallery} bots=${bots || []} />`}
      ${view === "template-preview" && html`<${TemplatePreview} key=${route.catalogId} id=${route.catalogId} bots=${bots || []} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} defaultModel=${settings?.defaultModel || ""} account=${account} onCreated=${onCreated} />`}
      ${view === "scheduled" && html`<${ScheduledPage} bots=${bots || []} />`}
      ${view === "apps" && html`<${AppsScreen} initialTab=${route.tab} />`}
      ${appCatalogId && html`<${BotAppScreen} key=${appCatalogId} catalogId=${appCatalogId} bot=${appBot}
        expanded=${workExpanded} onExpand=${(open) => setExpandedScope(open ? resourceScope : "")}
        frameHost=${workHost} panelOpen=${panelOpen} onTogglePanel=${togglePanel} onEntry=${(entry) => setAppEntry({ catalogId: appCatalogId, entry })}
        onInstalled=${onInstalled} onBotUpdated=${onBotUpdated} onOpenBotSettings=${openBotSettings} onOpenSettings=${openSettings}
        chatProps=${{ models, modelsError, reloadModels, defaultModel: settings && settings.defaultModel, onWorking, pending: (bot && pending[bot.id]) || 0, serverBusy: !!(bot && agentWorking[bot.id]), onOpenSettings: openSettings, onOpenBotSettings: openBotSettings, onBotUpdated, account: managed ? account : null, onAccount: setAccount, cuBlocked: !!(bot && cuBlocked.includes(bot.id)) }} />`}
      ${view === "group" && routedGroup && bots && html`<${GroupScreen} key=${routedGroup.id} group=${routedGroup} bots=${bots} onEdit=${() => setGroupSheet({ group: routedGroup })} onOpenSettings=${openSettings} onChanged=${reloadGroups}
        initialFocus=${{ id: route.messageId, query: route.query, nonce: messageJump }} onBackToSearch=${fromSearch ? () => openSearch() : undefined} />`}
      ${view === "conversation" && html`<${ConversationHistoryScreen} key=${route.conversationId} conversationId=${route.conversationId} initialFocus=${{ id: route.messageId, query: route.query, nonce: messageJump }} onBack=${() => openSearch()} onBot=${openChat} bots=${bots || []} />`}
      ${view === "group" && groupsData && !routedGroup && html`<div class="empty-state"><b>${t("app.groupMissing")}</b><button type="button" class="text" onClick=${() => openChat()}>${t("app.backToChat")}</button></div>`}
      ${(view === "new" || (view === "chat" && bots && !bots.length)) && html`<${NewBotScreen} key=${route.query || ""} first=${!!bots && !bots.length}
        models=${models} modelsError=${modelsError} reloadModels=${reloadModels} defaultModel=${settings && settings.defaultModel}
        account=${managed ? account : null} onAccount=${setAccount}
        onCreated=${onCreated} onCancel=${bots && bots.length ? () => openChat() : null} />`}
      ${view === "settings" && html`<${SettingsScreen} tab=${route.tab} query=${settingsQ} onQuery=${setSettingsQ} onTab=${(t) => openSettings(t)} focusRow=${route.row}
        mf=${mf} onMfChanged=${reloadMf} onSettings=${setSettings} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
        status=${status} update=${update} onUpdateChanged=${reloadUpdate} bots=${bots} onOpenBotSettings=${openBotSettings} account=${managed ? account : null} onAccount=${setAccount}
        onOpenApps=${() => openApps("connected")} />`}
      ${view === "needs" && html`<${NeedsYouScreen} multiBot=${!!bots && bots.length > 1} onChanged=${pollWorking} onOpenChat=${openChat} onRelogin=${relogin} onOpenBotSettings=${openBotSettings} />`}
      ${view === "bot-settings" && routedBot && html`<${BotSettingsScreen} key=${routedBot.id} bot=${routedBot} section=${route.section}
        models=${models} modelsError=${modelsError} reloadModels=${reloadModels} defaultModel=${settings && settings.defaultModel}
        account=${managed ? account : null} onAccount=${setAccount} onOpenSettings=${openSettings} onOpenApps=${() => openApps()}
        onBack=${() => openChat(routedBot.id)} onBotUpdated=${onBotUpdated} onDeleted=${() => onDeleted(routedBot.id)} />`}
      ${view === "bot-settings" && bots && !routedBot && html`<div class="empty-state"><b>${t("app.botMissing")}</b><button type="button" class="text" onClick=${() => openChat()}>${t("app.backToChat")}</button></div>`}
      </div>
      <${MessageSearchScreen} open=${searchOpen} query=${searchQuery} onQuery=${setSearchQuery} bots=${bots || []} groups=${groups} onClose=${closeSearch} onSelect=${openSearchHit} onBot=${openChat} onGroup=${openGroup} focusToken=${searchFocus} />
    </main>
    ${sideOff && html`<${SideRail} bots=${bots} view=${sideView} onToggleSide=${toggleSide} onOpenSearch=${openSearch} onNew=${newBot} onTemplates=${() => openTemplates()} onNewGroup=${() => setGroupSheet({})} />`}
    ${panel && html`<${Splitter} key=${wide ? "work" : "info"} class="split-panel" size=${wide ? "--work-w" : "--panel-w"} edge="end" label=${t("app.resizePanel")} value=${wide ? workW : panelW} room=${room("--side-col")}
      onCommit=${(v) => setPrefs(wide ? { workW: v } : { panelW: v })} />`}
    ${shownPanel && html`<div class=${`panel-scrim${panelFx.leaving ? " leaving" : ""}`} onClick=${() => setPanelOpen(false)}></div>`}
    ${shownPanel && html`<${WorkPanel} key=${shownPanel.key} bot=${shownPanel.bot} entry=${shownPanel.entry} tabs=${panelTabs({ app: shownPanel.kind === "app", bot: shownPanel.bot, resourcesOnly: shownPanel.kind === "resources" })}
      expanded=${workExpanded} onExpand=${(open) => setExpandedScope(open ? resourceScope : "")}
      tab=${panelTab[shownPanel.kind]} onTab=${(id) => setPanelTab((p) => ({ ...p, [shownPanel.kind]: id }))} leaving=${panelFx.leaving} onClose=${() => setPanelOpen(false)} onHost=${setWorkHost}
      resources=${shownPanel.resources}
      onSelectResource=${(active) => setResourcePanels((all) => ({ ...all, [shownPanel.key]: { ...all[shownPanel.key], active } }))}
      onRemoveResource=${(id) => setResourcePanels((all) => ({ ...all, [shownPanel.key]: removeResource(all[shownPanel.key], id) }))}
      onOpenBotSettings=${() => shownPanel.bot && openBotSettings(shownPanel.bot.id)} onOpenChat=${panelToChat} onOpenConnections=${(row) => openSettings("connections", row || "")} />`}
    <${CoachMark} bot=${!searchOpen && ["chat", "app"].includes(view) ? bot : null} view=${searchOpen ? "search" : view} infoOpen=${panelKind === "chat" && !!panel} busy=${Object.values(working).some(Boolean)} blocked=${needs.n > 0 || !!cuBlocked.length} onConnections=${(channel) => openSettings("connections", `add-channel-${channel}`)} />
    <${ScheduledSync} /><${PermissionSync} /><${NewRuleHost} bots=${bots || []} />
    ${palette && html`<${Palette} commands=${commands} onClose=${() => setPalette(false)} />`}
    ${groupSheet && bots && html`<${GroupSheet} group=${groupSheet.group} bots=${bots} onClose=${() => setGroupSheet(null)}
      onSaved=${async (g) => { setGroupSheet(null); await reloadGroups(); openGroup(g.id); }} />`}
    <${WhatsNewHost} update=${update} onUpdateChanged=${reloadUpdate} />
    <${AppDialogHost} bots=${bots || []} chatBot=${!searchOpen ? appChatTarget : null} onOpenSettings=${(tab) => openSettings(tab)} />
    <${DialogHost} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
