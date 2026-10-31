// AnyModelBot 界面：Preact + htm，无构建步骤（原生 ES 模块）。
// 未连接 Modelflare → 整页引导；已连接 → 侧栏 + 对话（信息面板按需），设置与机器人设置占满主区。
import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, DialogHost, Notice, Toasts, Splitter, tokenPx } from "./components/ui.js";
import { Sidebar } from "./screens/sidebar.js";
import { ChatScreen } from "./screens/chat.js";
import { InfoPanel } from "./screens/info-panel.js";
import { SettingsScreen, SettingsSide, TABS } from "./screens/settings.js";
import { BotSettingsScreen } from "./screens/bot-settings.js";
import { NewBotScreen } from "./screens/new-bot.js";
import { NeedsYouScreen } from "./screens/needs-you.js";
import { BotAvatar, MAIN_CHAR, charOf } from "./components/avatar.js";
import { Onboarding } from "./screens/onboarding.js";
import { CoachMark } from "./components/guide.js";
import { api } from "./lib/api.js";
import { loadGuide, setFocus } from "./lib/guide.js";
import { setThemeMode } from "./lib/theme.js";
import { failed, toast, useStore } from "./lib/store.js";
import { prefs, setPrefs } from "./lib/prefs.js";
import { usePresence } from "./design/motion.js";
import { t, useLang, adoptServerLang, changeLang, getLangPref, LANG_NAMES } from "./lib/i18n.js";

// —— 路由：#/chat/<bot> · #/new · #/needs · #/settings/<tab>[/<row>] · #/bot/<bot>/settings[/<section>] ——
function parseHash() {
  const [kind, a, b, c] = location.hash.replace(/^#\/?/, "").split("/").map((x) => decodeURIComponent(x || ""));
  if (kind === "settings") return { view: "settings", tab: TABS.some(([t]) => t === a) ? a : "general", row: b || "" };
  if (kind === "bot" && a && b === "settings") return { view: "bot-settings", botId: a, section: c || "" };
  if (kind === "new") return { view: "new" };
  if (kind === "needs") return { view: "needs" };
  if (kind === "models") return { view: "settings", tab: "modelflare", row: "" }; // 旧链接
  return { view: "chat", botId: kind === "chat" ? a : "" };
}
const go = (path) => {
  if (location.hash !== "#" + path) location.hash = path;
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);

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

/** 环境光色相（OKLCH 色相角）：和头像角色的主色一致 */
const AURA_HUE = { blue: 245, yellow: 95, green: 155, red: 25, purple: 305, orange: 55 };

function App() {
  // 订阅界面语言：切换语言时整棵树跟着重渲染（子组件里的 t() 都在渲染时取）
  const lang = useLang();
  const [route, setRoute] = useState(parseHash);
  const [mf, mfErr, reloadMf] = useLoader(() => api("/modelflare"));
  const [status, , reloadStatus] = useLoader(() => api("/status"));
  const [settings, , reloadSettings, setSettings] = useLoader(() => api("/settings"));
  // 语言偏好以服务端配置为准（可能在另一个窗口 / 浏览器里改过）；本机缓存只管首帧
  useEffect(() => {
    if (settings) adoptServerLang(settings.lang);
  }, [settings && settings.lang]);
  const connected = !!(mf && (mf.mode === "external" || mf.connected));
  const [botsData, botsErr, reloadBots] = useLoader(() => (connected ? api("/bots") : Promise.resolve(null)), [connected]);
  const [modelsData, , loadModels] = useLoader(() => (connected ? api("/models") : Promise.resolve(null)), [connected]);
  // Modelflare 账户与余额：后端每 5 分钟读一次；界面每分钟取快照，切回窗口时请后端立刻刷新
  const [account, , , setAccount] = useLoader(() => api("/account"), [connected]);
  const managed = !!(mf && mf.mode === "managed");
  const [previews, setPreviews] = useState({});
  const [pending, setPending] = useState({});
  const [agentWorking, setAgentWorking] = useState({});
  // 有后台任务在进行的机器人：侧栏头像也是"工作中"（不算对话在忙，对话页不因此去接进行中的消息）
  const [bgWorking, setBgWorking] = useState({});
  // 「需要你」：件数（侧栏那一行，0 时没有）和每个机器人的件数、最早那件
  const [needs, setNeeds] = useState({ n: 0, bots: {} });
  const [localWorking, setLocalWorking] = useState({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settingsQ, setSettingsQ] = useState("");
  const [lastBot, setLastBot] = useState(readLastBot);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useInterval(() => api("/account").then(setAccount).catch(() => {}), 60_000, connected && managed);
  // 上手清单：连上 Modelflare 之后读进度（新用户在对话空状态里看到清单，老用户已做过的步骤会自动打勾）
  useEffect(() => {
    if (connected) loadGuide();
  }, [connected]);
  useEffect(() => {
    if (!connected || !managed) return;
    const on = () => document.visibilityState === "visible" && api("/account/refresh", { method: "POST", body: {} }).then(setAccount).catch(() => {});
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, [connected, managed]);
  // 授权在网页上被撤销时后端会断开连接：回到登录页；余额跌破提醒线时提示一次
  const prevAccount = useRef(null);
  useEffect(() => {
    const prev = prevAccount.current;
    prevAccount.current = account;
    if (!prev || !account) return;
    if (prev.state === "signed_in" && account.state !== "signed_in") reloadMf();
    if (!prev.lowBalance && account.lowBalance) toast(t("app.lowBalance", { amount: account.balanceUsd.toFixed(2) }), "err");
  }, [account]);

  const bots = botsData ? botsData.bots : null;
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

  // 信息面板：关上时多留一会儿，播完"列宽滑回 0、面板淡出"再卸载
  const panelOpen = route.view === "chat" && infoOpen && !!bot;
  const panelFx = usePresence(panelOpen, "--dur-slow");
  const lastPanel = useRef(null);
  if (panelOpen) lastPanel.current = bot;
  // 侧栏 / 信息面板的宽度：拖分隔条调整，存在本机偏好里（lib/prefs.js 把它写成 <html> 上的 --side-w-user / --panel-w-user）
  const { sideW, panelW } = useStore(prefs);
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
        for (const c of d.conversations || []) if (!latest[c.botId] || c.updatedAt > latest[c.botId].updatedAt) latest[c.botId] = c;
        setPreviews(Object.fromEntries(Object.entries(latest).map(([k, c]) => [k, { text: (c.lastMessage || "").replace(/^⚠️\s*/, "").replace(/\s+/g, " "), at: c.updatedAt }])));
      })
      .catch(() => {});
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
        })
        .catch(() => {}),
    [],
  );
  useInterval(pollWorking, 3000, connected);
  useEffect(() => void (connected && pollWorking()), [connected]);
  const working = useMemo(() => {
    const m = { ...agentWorking };
    for (const src of [bgWorking, localWorking]) for (const [k, v] of Object.entries(src)) if (v) m[k] = true;
    return m;
  }, [agentWorking, bgWorking, localWorking]);
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
    if (id) setLastBot(id);
    go(`/chat/${encodeURIComponent(id || (bot && bot.id) || "")}`);
  };
  const newBot = () => go("/new");
  // 清单里点一项：回到对话页，引导卡片指着要点的地方
  const startGuide = (id) => {
    setFocus(id);
    if (route.view !== "chat") openChat();
  };
  const openNeeds = () => go("/needs");
  // 「需要你」里的重新扫码：去这个机器人的对话，打开信息面板（渠道在最上面）
  const relogin = (id) => {
    openChat(id);
    setInfoOpen(true);
  };
  useEffect(() => {
    if (route.view !== "settings") setSettingsQ("");
  }, [route.view]);
  const openBotSettings = (id, section = "") => go(`/bot/${encodeURIComponent(id)}/settings${section ? "/" + section : ""}`);
  const onBotUpdated = () => reloadBots();
  const onDeleted = (id) => {
    reloadBots();
    if (bot && id === bot.id) {
      setLastBot("");
      go("/chat/");
    }
  };

  // —— 全局快捷键 ——
  useEffect(() => {
    const key = (e) => {
      if (!connected) return;
      if (mod(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (mod(e) && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (route.view === "chat") setInfoOpen((v) => !v);
      } else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newBot();
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const t = e.target;
        const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
        if (route.view === "bot-settings" && !typing) openChat(route.botId);
        else if (route.view === "new" && !typing && bots && bots.length) openChat();
        else if (route.view === "settings" && !typing) openChat();
        else if (route.view === "needs" && !typing) openChat();
        else if (route.view === "chat" && infoOpen && !typing) setInfoOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [connected, route, infoOpen, bot && bot.id]);

  // keys：搜索用的关键词（不显示），两种语言的词典各有一份
  const setLang = (l) => changeLang(l).then(() => toast(t("common.saved"))).catch(failed);
  const commands = [
    { label: t("app.cmd.settings"), kbd: isMac ? "⌘," : "Ctrl+,", keys: t("app.cmd.settingsKeys"), run: () => openSettings() },
    { label: t("app.cmd.newBot"), kbd: isMac ? "⌘N" : "Ctrl+N", keys: t("app.cmd.newBotKeys"), run: newBot },
    ...(needs.n > 0 ? [{ label: t("app.cmd.needs", { count: needs.n }), keys: t("app.cmd.needsKeys"), run: openNeeds }] : []),
    ...(route.view === "chat" ? [{ label: infoOpen ? t("app.cmd.closeInfo") : t("app.cmd.openInfo"), kbd: isMac ? "⌘⇧I" : "Ctrl+Shift+I", keys: t("app.cmd.infoKeys"), run: () => setInfoOpen((v) => !v) }] : []),
    // 任务和规则在当前机器人的信息面板里（「任务」组）
    ...(bot ? [{ label: t("app.cmd.tasks"), keys: t("app.cmd.tasksKeys"), run: () => (openChat(bot.id), setInfoOpen(true)) }] : []),
    ...(bot ? [{ label: t("app.cmd.botSettings", { name: bot.name }), keys: t("app.cmd.botSettingsKeys"), run: () => openBotSettings(bot.id) }] : []),
    { label: t("app.cmd.modelflare"), keys: t("app.cmd.modelflareKeys"), run: () => openSettings("modelflare") },
    { label: t("app.cmd.appearance"), keys: t("app.cmd.appearanceKeys"), run: () => openSettings("appearance") },
    { label: t("app.cmd.themeSystem"), keys: t("app.cmd.themeKeys"), run: () => setThemeMode("system") },
    { label: t("app.cmd.themeLight"), keys: t("app.cmd.themeLightKeys"), run: () => setThemeMode("light") },
    { label: t("app.cmd.themeDark"), keys: t("app.cmd.themeDarkKeys"), run: () => setThemeMode("dark") },
    // 语言：各语言用自己的文字写名字；当前选中的那一项不列
    ...[["system", t("common.lang.system")], ["zh-CN", LANG_NAMES["zh-CN"]], ["en", LANG_NAMES.en]]
      .filter(([v]) => v !== getLangPref())
      .map(([v, name]) => ({ label: t("app.cmd.lang", { name }), keys: t("app.cmd.langKeys"), run: () => setLang(v) })),
    ...(bots || []).map((b) => ({ label: t("app.cmd.switchBot", { name: b.name }), keys: "bot switch " + b.id, run: () => openChat(b.id) })),
  ];

  // —— 渲染 ——
  if (!mf) {
    return html`<main class="onboard" data-screen=${mfErr ? "error" : "loading"}>
      ${mfErr
        ? html`<div class="onboard-col"><div class="onboard-hero"><${BotAvatar} char=${MAIN_CHAR} size=${88} state="sleep" lively pokeable /></div>
            <${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${reloadMf}>${t("common.retry")}</button>`}>${t("app.serviceDown", { error: mfErr })}<//></div>`
        : html`<${BotAvatar} char=${MAIN_CHAR} size=${72} state="thinking" lively />`}
    </main>`;
  }
  if (!connected) {
    return html`<${Onboarding} status=${mf} gateway=${status && status.gateway} defaultModel=${settings && settings.defaultModel}
        onDone=${() => { reloadMf(); reloadSettings(); go("/chat/"); }} />
      <${Toasts} />`;
  }

  const view = route.view;
  const panelBot = view === "chat" && infoOpen && bot;
  const shownPanel = panelFx.mounted ? panelBot || lastPanel.current : null;
  const routedBot = view === "bot-settings" && bots ? bots.find((b) => b.id === route.botId) : null;
  // 环境光的色相跟着当前机器人角色的主色（设置页和新建页用缺省的冷色）
  const auraBot = view === "chat" ? bot : view === "bot-settings" ? routedBot : null;
  const auraHue = (auraBot && AURA_HUE[charOf(auraBot)]) || 250;
  return html`<div class=${`app${panelBot ? " with-panel" : ""}`} ref=${appRef} style=${{ "--aura-hue": String(auraHue) }}>
    ${view === "settings"
      ? html`<${SettingsSide} tab=${route.tab} query=${settingsQ} onQuery=${setSettingsQ} onTab=${(t) => openSettings(t)} onBack=${() => openChat()}
          username=${status && status.username} account=${managed ? account : null} />`
      : html`<${Sidebar} bots=${bots} botsError=${botsErr} reloadBots=${reloadBots} selectedId=${bot && bot.id} view=${view === "chat" && bots && !bots.length ? "new" : view}
          previews=${previews} pending=${pending} working=${working} needs=${needs} username=${status && status.username} account=${managed ? account : null}
          onNew=${newBot} onSelect=${openChat} onNeeds=${openNeeds} onDeleted=${onDeleted} onOpenSettings=${() => openSettings()} onBotSettings=${openBotSettings} onGuide=${startGuide} />`}
    <${Splitter} class="split-side" size="--side-w" label=${t("app.resizeSide")} value=${sideW} room=${room("--panel-track")} onCommit=${(v) => setPrefs({ sideW: v })} />
    <main class="main">
      ${view === "chat" && bot && html`<${ChatScreen} key=${bot.id} bot=${bot} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
        defaultModel=${settings && settings.defaultModel} infoOpen=${infoOpen} onToggleInfo=${() => setInfoOpen((v) => !v)}
        onWorking=${onWorking} pending=${pending[bot.id] || 0} serverBusy=${!!agentWorking[bot.id]} onOpenSettings=${openSettings} onOpenBotSettings=${openBotSettings} onBotUpdated=${onBotUpdated} />`}
      ${(view === "new" || (view === "chat" && bots && !bots.length)) && html`<${NewBotScreen} first=${!!bots && !bots.length}
        onCreated=${(b) => { reloadBots(); openChat(b.id); }} onCancel=${bots && bots.length ? () => openChat() : null} />`}
      ${view === "settings" && html`<${SettingsScreen} tab=${route.tab} query=${settingsQ} onQuery=${setSettingsQ} onTab=${(t) => openSettings(t)} focusRow=${route.row}
        mf=${mf} onMfChanged=${reloadMf} onSettings=${setSettings} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
        status=${status} bots=${bots} onOpenBotSettings=${openBotSettings} account=${managed ? account : null} onAccount=${setAccount} />`}
      ${view === "needs" && html`<${NeedsYouScreen} multiBot=${!!bots && bots.length > 1} onChanged=${pollWorking} onOpenChat=${openChat} onRelogin=${relogin} onOpenBotSettings=${openBotSettings} />`}
      ${view === "bot-settings" && routedBot && html`<${BotSettingsScreen} key=${routedBot.id} bot=${routedBot} section=${route.section}
        models=${models} modelsError=${modelsError} reloadModels=${reloadModels} defaultModel=${settings && settings.defaultModel}
        account=${managed ? account : null} onOpenSettings=${openSettings}
        onBack=${() => openChat(routedBot.id)} onBotUpdated=${onBotUpdated} onDeleted=${() => onDeleted(routedBot.id)} />`}
      ${view === "bot-settings" && bots && !routedBot && html`<div class="empty-state"><b>${t("app.botMissing")}</b><button type="button" class="text" onClick=${() => openChat()}>${t("app.backToChat")}</button></div>`}
    </main>
    ${panelBot && html`<${Splitter} class="split-panel" size="--panel-w" edge="end" label=${t("app.resizePanel")} value=${panelW} room=${room("--side-col")}
      onCommit=${(v) => setPrefs({ panelW: v })} />`}
    ${shownPanel && html`<div class=${`panel-scrim${panelFx.leaving ? " leaving" : ""}`} onClick=${() => setInfoOpen(false)}></div>`}
    ${shownPanel && html`<${InfoPanel} key=${shownPanel.id} bot=${shownPanel} leaving=${panelFx.leaving} onClose=${() => setInfoOpen(false)}
      onOpenBotSettings=${() => openBotSettings(shownPanel.id)} onOpenChat=${() => setInfoOpen(false)} />`}
    <${CoachMark} bot=${view === "chat" ? bot : null} view=${view} infoOpen=${!!panelBot} />
    ${palette && html`<${Palette} commands=${commands} onClose=${() => setPalette(false)} />`}
    <${DialogHost} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
