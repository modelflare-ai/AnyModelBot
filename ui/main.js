// AnyModelBot 界面：Preact + htm，无构建步骤（原生 ES 模块）。
// 未连接 Modelflare → 整页引导；已连接 → 侧栏 + 对话（信息面板按需），设置与机器人设置占满主区。
import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, DialogHost, Toasts } from "./components/ui.js";
import { Sidebar } from "./screens/sidebar.js";
import { ChatScreen } from "./screens/chat.js";
import { InfoPanel } from "./screens/info-panel.js";
import { SettingsScreen, TABS } from "./screens/settings.js";
import { BotSettingsScreen } from "./screens/bot-settings.js";
import { Onboarding } from "./screens/onboarding.js";
import { api } from "./lib/api.js";
import { setThemeMode } from "./lib/theme.js";
import { failed } from "./lib/store.js";

// —— 路由：#/chat/<bot> · #/settings/<tab>[/<row>] · #/bot/<bot>/settings[/<section>] ——
function parseHash() {
  const [kind, a, b, c] = location.hash.replace(/^#\/?/, "").split("/").map((x) => decodeURIComponent(x || ""));
  if (kind === "settings") return { view: "settings", tab: TABS.some(([t]) => t === a) ? a : "general", row: b || "" };
  if (kind === "bot" && a && b === "settings") return { view: "bot-settings", botId: a, section: c || "" };
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
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="search"><${Icon} name="search" />
        <input ref=${input} placeholder="输入命令或机器人名称" aria-label="命令" value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} />
      </div>
      <ul role="listbox" ref=${ref}>
        ${hits.map((c, i) => html`<li role="option" aria-selected=${i === sel} class=${i === sel ? "sel" : ""} onPointerMove=${() => setSel(i)} onClick=${() => run(c)}>
          <span class="v">${c.label}</span>${c.kbd && html`<kbd>${c.kbd}</kbd>`}
        </li>`)}
        ${!hits.length && html`<li class="group" style="pointer-events:none">没有匹配的命令</li>`}
      </ul>
    </div>`;
}

function App() {
  const [route, setRoute] = useState(parseHash);
  const [mf, mfErr, reloadMf] = useLoader(() => api("/modelflare"));
  const [status, , reloadStatus] = useLoader(() => api("/status"));
  const [settings, , reloadSettings, setSettings] = useLoader(() => api("/settings"));
  const connected = !!(mf && (mf.mode === "external" || mf.connected));
  const [botsData, botsErr, reloadBots] = useLoader(() => (connected ? api("/bots") : Promise.resolve(null)), [connected]);
  const [modelsData, , loadModels] = useLoader(() => (connected ? api("/models") : Promise.resolve(null)), [connected]);
  const [previews, setPreviews] = useState({});
  const [pending, setPending] = useState({});
  const [agentWorking, setAgentWorking] = useState({});
  const [localWorking, setLocalWorking] = useState({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastBot, setLastBot] = useState(readLastBot);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

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
        setPreviews(Object.fromEntries(Object.entries(latest).map(([k, c]) => [k, (c.lastMessage || "").replace(/\s+/g, " ")])));
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
  useInterval(
    () =>
      api("/agent")
        .then((a) => {
          const map = {};
          for (const [id, h] of Object.entries(a.hosts || {})) map[id] = Number(h.activeTurns || 0) > 0;
          setAgentWorking(map);
        })
        .catch(() => {}),
    3000,
    connected,
  );
  const working = useMemo(() => {
    const m = { ...agentWorking };
    for (const [k, v] of Object.entries(localWorking)) if (v) m[k] = true;
    return m;
  }, [agentWorking, localWorking]);
  const onWorking = useCallback((id, on) => {
    setLocalWorking((w) => (w[id] === on ? w : { ...w, [id]: on }));
    if (!on) setTimeout(pollSide, 300);
  }, [pollSide]);

  const openSettings = (tab = route.view === "settings" ? route.tab : "general", row = "") => {
    reloadStatus();
    go(`/settings/${tab}${row ? "/" + row : ""}`);
  };
  const openChat = (id) => {
    if (id) setLastBot(id);
    go(`/chat/${encodeURIComponent(id || (bot && bot.id) || "")}`);
  };
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
        setCreating(true);
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const t = e.target;
        const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
        if (route.view === "bot-settings" && !typing) openChat(route.botId);
        else if (route.view === "settings" && !typing) openChat();
        else if (route.view === "chat" && infoOpen && !typing) setInfoOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [connected, route, infoOpen, bot && bot.id]);

  const commands = [
    { label: "打开设置", kbd: isMac ? "⌘," : "Ctrl+,", keys: "settings preferences", run: () => openSettings() },
    { label: "新建机器人", kbd: isMac ? "⌘N" : "Ctrl+N", keys: "new bot", run: () => setCreating(true) },
    ...(route.view === "chat" ? [{ label: infoOpen ? "关闭信息面板" : "打开信息面板", kbd: isMac ? "⌘⇧I" : "Ctrl+Shift+I", keys: "info panel", run: () => setInfoOpen((v) => !v) }] : []),
    ...(bot ? [{ label: `「${bot.name}」的设置`, keys: "bot settings", run: () => openBotSettings(bot.id) }] : []),
    { label: "Modelflare 设置", keys: "modelflare key 密钥 模型", run: () => openSettings("modelflare") },
    { label: "外观：跟随系统", keys: "theme appearance 主题", run: () => setThemeMode("system") },
    { label: "外观：浅色", keys: "theme light 主题", run: () => setThemeMode("light") },
    { label: "外观：深色", keys: "theme dark 主题", run: () => setThemeMode("dark") },
    ...(bots || []).map((b) => ({ label: `切换到「${b.name}」`, keys: "bot switch " + b.id, run: () => openChat(b.id) })),
  ];

  // —— 渲染 ——
  if (!mf) {
    return html`<main class="onboard" data-screen=${mfErr ? "error" : "loading"}>
      ${mfErr ? html`<div class="onboard-col"><div class="notice red"><span class="notice-text">无法连接本机服务：${mfErr}</span><button type="button" class="btn" onClick=${reloadMf}>重试</button></div></div>` : html`<span class="spinner" style="color:var(--muted)"></span>`}
    </main>`;
  }
  if (!connected) {
    return html`<${Onboarding} status=${mf} gateway=${status && status.gateway} defaultModel=${settings && settings.defaultModel}
        onDone=${() => { reloadMf(); reloadSettings(); go("/chat/"); }} />
      <${Toasts} />`;
  }

  const view = route.view;
  const panelBot = view === "chat" && infoOpen && bot;
  const routedBot = view === "bot-settings" && bots ? bots.find((b) => b.id === route.botId) : null;
  return html`<div class=${`app${panelBot ? " with-panel" : ""}`}>
    <${Sidebar} bots=${bots} botsError=${botsErr} reloadBots=${reloadBots} selectedId=${bot && bot.id} view=${view}
      previews=${previews} pending=${pending} working=${working} username=${status && status.username}
      creating=${creating} setCreating=${setCreating}
      onSelect=${openChat} onCreated=${(b) => { reloadBots(); openChat(b.id); }} onDeleted=${onDeleted} onOpenSettings=${() => openSettings()} />
    <main class="main">
      ${view === "chat" && bot && html`<${ChatScreen} key=${bot.id} bot=${bot} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
        defaultModel=${settings && settings.defaultModel} infoOpen=${infoOpen} onToggleInfo=${() => setInfoOpen((v) => !v)}
        onWorking=${onWorking} onOpenSettings=${openSettings} onBotUpdated=${onBotUpdated} />`}
      ${view === "chat" && bots && !bots.length && html`<section class="chat" data-screen="chat"><div class="chat-empty">
        <h2>还没有机器人</h2><p>在左侧点 ＋ 新建一个，然后直接对话。</p>
        <button type="button" class="btn primary" onClick=${() => setCreating(true)}>新建机器人</button>
      </div></section>`}
      ${view === "settings" && html`<${SettingsScreen} tab=${route.tab} focusRow=${route.row} onTab=${(t) => openSettings(t)}
        mf=${mf} onMfChanged=${reloadMf} onSettings=${setSettings} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
        status=${status} bots=${bots} onOpenBotSettings=${openBotSettings} />`}
      ${view === "bot-settings" && routedBot && html`<${BotSettingsScreen} key=${routedBot.id} bot=${routedBot} section=${route.section}
        models=${models} modelsError=${modelsError} reloadModels=${reloadModels} defaultModel=${settings && settings.defaultModel}
        onBack=${() => openChat(routedBot.id)} onBotUpdated=${onBotUpdated} onDeleted=${() => onDeleted(routedBot.id)} />`}
      ${view === "bot-settings" && bots && !routedBot && html`<div class="empty-state"><b>机器人不存在</b><button type="button" class="text" onClick=${() => openChat()}>返回对话</button></div>`}
    </main>
    ${panelBot && html`<div class="panel-scrim" onClick=${() => setInfoOpen(false)}></div>`}
    ${panelBot && html`<${InfoPanel} key=${panelBot.id} bot=${panelBot} onClose=${() => setInfoOpen(false)}
      onOpenBotSettings=${() => openBotSettings(panelBot.id)} onOpenChat=${() => setInfoOpen(false)} />`}
    ${palette && html`<${Palette} commands=${commands} onClose=${() => setPalette(false)} />`}
    <${DialogHost} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
