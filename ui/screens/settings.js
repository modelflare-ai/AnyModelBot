// 设置页（参考 Codex）：侧栏换成设置导航（返回应用 + 查找 + 分页），主区是大标题 + 按用途分段的 list，一行一项；改动即保存。
// 外观的主题是三张缩略图，Modelflare 顶部是账户和余额；搜索时它们退回普通的行（searchOnly）。
// 入口只有左下角账户按钮、⌘/Ctrl+, 和命令面板。
// 外观（主题、字体、动画…）和对话习惯（发送键、通知）是本机界面偏好，存在浏览器里（lib/theme.js、lib/prefs.js）；
// 其余设置走服务端 /settings。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Button, Icon, IconButton, Seg, Switch, Sheet, CopyButton, Skeleton, MenuButton } from "../components/ui.js";
import { AccountButton, SideActions } from "./sidebar.js";
import { AccountBalance, balanceText } from "../components/account-balance.js";
import { PickModel, effortOptions, setEffort, shortModel, showsStrategy, strategyOptions, useEffort } from "../components/model-picker.js";
import { DomainConnection } from "../components/domain-connection.js";
import { NotificationsSheet, UsageSheet } from "./account.js";
import { api } from "../lib/api.js";
import { UpdateActions, updateDescription } from "../components/app-update.js";
import { MF_CONSOLE, MF_DOCS_LINK, MF_TOPUP, usd } from "../lib/links.js";
import { useStore, confirmSheet, failed, saved, toast } from "../lib/store.js";
import { guide, resetGuide, showGuide, progress, visibleSteps } from "../lib/guide.js";
import { themeMode, setThemeMode } from "../lib/theme.js";
import { prefs, setPrefs, resetAppearance, appearanceChanged, fontStack } from "../lib/prefs.js";
import { canNotify, requestNotify } from "../lib/notify.js";
import { TroubleshootPane } from "./troubleshoot.js";
import { ConnectionSheets, connectionRows, useConnections } from "./connections.js";
import { PwshHint } from "../components/pwsh-hint.js";
import { OfficialKeyForm, officialName } from "../components/official-keys.js";
import { AccountLogin } from "./onboarding.js";
import { t, has, useLang, getLangPref, onLangChange, changeLang, LANGS, LANG_NAMES } from "../lib/i18n.js";
import { fmtTimeOfDay } from "../lib/format.js";

/** [id, 标题的文案键, 图标]；标题渲染时再 t()（tabLabel） */
export const TABS = [
  ["general", "settings.tabs.general", "sliders"],
  ["appearance", "settings.tabs.appearance", "palette"],
  ["modelflare", "settings.tabs.modelflare", "spark"],
  ["computer", "settings.tabs.computer", "monitor"],
  ["connections", "settings.tabs.connections", "link"],
  ["privacy", "settings.tabs.privacy", "lock"],
  ["network", "settings.tabs.network", "globe"],
  ["data", "settings.tabs.data", "database"],
  ["troubleshoot", "settings.tabs.troubleshoot", "pulse"],
  ["about", "settings.tabs.about", "info"],
];
const tabLabel = (key) => t(key);
const ZOOMS = [
  [1, "100%"],
  [1.1, "110%"],
  [1.25, "125%"],
  [1.5, "150%"],
];
// 带文案的选项都写成函数：切换语言后重新取
const gatewayState = (st) => (has(`settings.gateway.${st}`) ? t(`settings.gateway.${st}`) : st);
const THEMES = () => [["system", t("common.system")], ["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")]];
const TEXT_SIZES = () => ["sm", "md", "lg", "xl"].map((v) => [v, t(`settings.textSize.${v}`)]);
const FONTS = () => ["system", "serif", "custom"].map((v) => [v, t(`settings.font.${v}`)]);
const WIDTHS = () => ["normal", "wide", "full"].map((v) => [v, t(`settings.width.${v}`)]);
const AUTO_ON_OFF = () => [["system", t("common.system")], ["on", t("common.on")], ["off", t("common.off")]];
const LANG_OPTIONS = () => [["system", t("common.lang.system")], ...LANGS.map((lang) => [lang, LANG_NAMES[lang]])];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_ENTER = isMac ? "⌘Enter" : "Ctrl+Enter";
// 本机没开放字体列表（queryLocalFonts）时的候选：常见的中文 / 西文界面字体与等宽字体
const SUGGEST_UI = ["LXGW WenKai", "霞鹜文楷", "HarmonyOS Sans SC", "MiSans", "Source Han Sans SC", "Noto Sans SC", "Sarasa UI SC", "Inter"]; // i18n-ignore
const SUGGEST_CODE = ["JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "Source Code Pro", "Sarasa Mono SC", "Maple Mono"];
const ALERT_LINES = () => [
  [0, t("settings.rows.lowBalance.none")],
  [1, "$1"],
  [5, "$5"],
  [20, "$20"],
];

function Row({ id, name, sub, title, children, flash, off }) {
  return html`<div class=${`row${flash ? " flash" : ""}${off ? " off" : ""}`} id=${`set-${id}`} title=${title}>
    <div class="who"><div class="name">${name}</div>${sub && html`<div class="sub">${sub}</div>`}</div>
    <div class="ctl">${children}</div>
  </div>`;
}

// 本机已安装字体（Local Font Access API）：第一次聚焦字体输入框时读一次，浏览器里可能会先弹权限
let localFonts = null;
function loadLocalFonts() {
  if (!localFonts)
    localFonts = (typeof window.queryLocalFonts === "function" ? window.queryLocalFonts() : Promise.resolve([]))
      .then((list) => [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b)))
      .catch(() => {
        localFonts = null; // 拒绝了或不支持：下次聚焦再试，这次先用候选
        return [];
      });
  return localFonts;
}

/** 字体名输入框：边打字边生效（外观实时变），离开或从候选里选中时提示"已保存"；输入框自己用这个字体显示 */
function FontInput({ id, value, onChange, placeholder, suggest, fallback, label }) {
  const ref = useRef(null);
  const [v, setV] = useState(value);
  const [fonts, setFonts] = useState(null);
  // 外面改了（恢复默认）且没在输入时，跟着变
  useEffect(() => {
    if (document.activeElement !== ref.current) setV(value);
  }, [value]);
  const stack = fontStack(v);
  return html`<input ref=${ref} class="field font-in" type="text" list=${`${id}-list`} aria-label=${label} placeholder=${placeholder} value=${v}
      spellcheck="false" autocomplete="off" style=${{ fontFamily: stack ? `${stack}, ${fallback}` : "" }}
      onFocus=${() => !(fonts && fonts.length) && loadLocalFonts().then(setFonts)}
      onInput=${(e) => { setV(e.target.value); onChange(e.target.value); }}
      onChange=${() => saved()} />
    <datalist id=${`${id}-list`}>${(fonts && fonts.length ? fonts : suggest).map((f) => html`<option key=${f} value=${f} />`)}</datalist>`;
}

// 联网搜索的接口：自动 = 免费搜索，不用 Key
const SEARCH_OPTIONS = () => [
  ["auto", t("settings.rows.webSearch.auto")],
  ["tavily", "Tavily"],
  ["exa", "Exa"],
  ["bocha", t("settings.rows.webSearch.bocha")],
  ["zhipu", t("settings.rows.webSearch.zhipu")],
  ["keenable", "Keenable"],
  ["searxng", "SearXNG"],
];

/** 填 Key 或地址：回车或离开输入框时保存。Key 输入框总是空的（服务端只回末 4 位，显示在占位里），地址照原样显示 */
function SaveInput({ id, value = "", secret, label, placeholder, onSave }) {
  const ref = useRef(null);
  const [v, setV] = useState(value);
  useEffect(() => {
    if (document.activeElement !== ref.current) setV(value);
  }, [value]);
  const commit = () => {
    const x = v.trim();
    if (secret ? x : x !== value) onSave(x);
    if (secret) setV("");
  };
  return html`<input ref=${ref} id=${id} class="field mono key-in" type=${secret ? "password" : "url"} autocomplete="off" spellcheck="false"
    aria-label=${label} placeholder=${placeholder} value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${commit}
    onKeyDown=${(e) => e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && (e.preventDefault(), e.currentTarget.blur())} />`;
}

/** 主题的缩略图：一扇小窗口，局部 data-theme 让它用那个主题的真实颜色 */
const ThemeSketch = ({ theme }) => html`<span class="tsk" data-theme=${theme}><i class="tsk-side"></i><span class="tsk-main"><i class="tsk-bubble"></i><i class="tsk-line"></i><i class="tsk-line short"></i><i class="tsk-box"></i></span></span>`;

/** 外观分页顶部：三张主题缩略图。跟随系统那张左半浅、右半深 */
function ThemeCards({ value, flash, onChange }) {
  return html`<div class=${`theme-cards${flash ? " flash" : ""}`} id="set-theme" role="group" aria-label=${t("settings.rows.theme.name")}>
    ${THEMES().map(([v, label]) => html`<button type="button" key=${v} class=${`theme-card${value === v ? " on" : ""}`} aria-pressed=${value === v} onClick=${() => onChange(v)}>
      <span class=${`theme-thumb${v === "system" ? " split" : ""}`} aria-hidden="true">
        ${v === "system" ? html`<${ThemeSketch} theme="light" /><${ThemeSketch} theme="dark" />` : html`<${ThemeSketch} theme=${v} />`}
      </span>
      <span class="theme-name">${label}</span>
    </button>`)}
  </div>`;
}

/** 文字预览：排在「文字」这组的最后，跟着字体大小、字体、代码字体和代码换行实时变 */
function TextPreview() {
  return html`<div class="text-sample" aria-hidden="true">
    <span class="t-label">${t("settings.preview.label")}</span>
    <p>${t("settings.preview.reply", { b: html`<b>${t("settings.rows.codeWrap.name")}</b>` })}</p>
    <pre>const res = await fetch(\`\${base}/v1/chat/completions\`, { method: "POST", headers, body: JSON.stringify({ model, messages }) });</pre>
  </div>`;
}

/** 按 group 分段：相邻同组的行排在一块 .list 里，第一段可以没有标题 */
function groupRows(list) {
  const out = [];
  for (const r of list) {
    const key = r.group || "";
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, label: key ? t(`settings.groups.${key}`) : "", note: r.groupNote, rows: [r] });
  }
  return out;
}

function NoticesSheet({ onClose }) {
  const [d, setD] = useState(null);
  const lang = useLang();
  useEffect(() => {
    let active = true;
    setD(null);
    api("/notices").then((value) => active && setD(value)).catch((e) => active && setD({ license: e.message, notices: "" }));
    return () => { active = false; };
  }, [lang]);
  return html`<${Sheet} title=${t("settings.rows.licenses.name")} wide onClose=${onClose}>
    <pre class="doc">${d ? `${d.license}\n\n${d.notices}` : t("common.loading")}</pre>
  <//>`;
}

/** 设置时的侧栏：返回应用 | 查找设置 | 分页 | 账户 */
export function SettingsSide({ tab, query, onQuery, onTab, onBack, username, account, update, onUpdateChanged, nav }) {
  const searching = !!query.trim();
  return html`<aside class="side" aria-label=${t("settings.side.label")}>
    <div class="side-top start">
      ${nav && html`<${SideActions} ...${nav}><span class="grow"></span><//>`}
    </div><div class="settings-back-row">
      <button type="button" class="side-back" title=${t("settings.side.backTitle")} onClick=${onBack}><${Icon} name="arrowLeft" size="md" />${t("settings.side.back")}</button>
    </div>
    <label class="side-search">
      <${Icon} name="search" size="sm" />
      <input type="search" placeholder=${t("settings.side.search")} aria-label=${t("settings.side.search")} value=${query} onInput=${(e) => onQuery(e.target.value)}
        onKeyDown=${(e) => e.key === "Escape" && !e.isComposing && e.keyCode !== 229 && query && (e.stopPropagation(), onQuery(""))} />
    </label>
    <nav class="side-list" aria-label=${t("settings.side.nav")}>
      ${TABS.map(([id, label, icon]) => {
        const on = !searching && id === tab;
        return html`<button type="button" key=${id} class=${`nav-item${on ? " sel" : ""}`} aria-current=${on ? "page" : undefined}
          onClick=${() => { onQuery(""); onTab(id); }}><${Icon} name=${icon} size="md" /><span>${tabLabel(label)}</span></button>`;
      })}
    </nav>
    <div class="side-foot"><${AccountButton} username=${username} account=${account} update=${update} onUpdateChanged=${onUpdateChanged} settingsOn onSettings=${() => onTab("general")} onModelflare=${() => { onQuery(""); onTab("modelflare"); }} /></div>
  </aside>`;
}

export function SettingsScreen({ tab, query: q, onQuery: setQ, onTab, focusRow, mf, onMfChanged, onSettings, models, modelsError, reloadModels, status, update, onUpdateChanged, bots, onOpenBotSettings, account: acct, onAccount, onOpenApps }) {
  const [s, setS] = useState(null);
  const g = useStore(guide);
  const effort = useEffort();
  const [notices, setNotices] = useState(false);
  const [sheet, setSheet] = useState(""); // usage | notifications | login
  const [leaving, setLeaving] = useState(false);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const balanceRequest = useRef(null);
  // 官方 API：各家的连接状态；keySheet 是正在填 Key 的那一家
  const [official, setOfficial] = useState(null);
  const [keySheet, setKeySheet] = useState(null);
  const [invite, setInvite] = useState(null);
  const [unread, setUnread] = useState(null);
  const [cu, setCu] = useState(null);
  const [flash, setFlash] = useState("");
  const mode = useStore(themeMode);
  const p = useStore(prefs);
  const lang = useLang();
  // 语言偏好单独订阅：系统语言本来就是英文时，"跟随系统" → "English" 不改变界面语言，useLang() 不会变
  const [langPref, setLangPrefView] = useState(getLangPref);
  useEffect(() => onLangChange(() => setLangPrefView(getLangPref())), []);

  // 图片 / 视频模型（共用 Key 能用的，按推荐顺序）：连上 Modelflare 后取
  const [media, setMedia] = useState(null);
  const loadMedia = () =>
    api("/media/models")
      .then(setMedia)
      .catch((e) => setMedia({ image: [], video: [], recommended: {}, error: e.message }));
  useEffect(() => {
    api("/settings").then(setS).catch(failed);
  }, []);
  useEffect(() => {
    if (mf && mf.connected) loadMedia();
  }, [mf && mf.connected]);
  useEffect(() => {
    if (bots && bots[0]) api(`/bots/${encodeURIComponent(bots[0].id)}/settings`).then((d) => setCu(d.computerUse)).catch(() => {});
  }, [bots && bots[0] && bots[0].id]);
  useEffect(() => {
    if (!focusRow) return;
    setQ("");
    requestAnimationFrame(() => {
      document.getElementById(`set-${focusRow}`)?.scrollIntoView({ block: "center" });
      setFlash(focusRow);
      setTimeout(() => setFlash(""), 1300);
    });
  }, [focusRow, tab]);

  const put = async (patch, rollback) => {
    const prev = s;
    setS((v) => ({ ...v, ...rollback }));
    try {
      const next = await api("/settings", { method: "PUT", body: patch });
      setS(next);
      onSettings?.(next);
      if (patch.autoDownloadUpdates !== undefined) onUpdateChanged?.();
      saved();
    } catch (e) {
      setS(prev);
      failed(e);
    }
  };
  const setLine = async (line) => {
    try {
      await api("/modelflare/line", { method: "PUT", body: { line } });
      onMfChanged();
      saved();
    } catch (e) {
      failed(e);
    }
  };
  const refreshBalance = () => {
    if (balanceRequest.current) return balanceRequest.current;
    setBalanceRefreshing(true);
    balanceRequest.current = api("/account/refresh", { method: "POST", body: { maxAgeMs: 3000 } })
      .then(onAccount)
      .catch(failed)
      .finally(() => { balanceRequest.current = null; setBalanceRefreshing(false); });
    return balanceRequest.current;
  };
  // 账户操作只放在常规页底部，保留运行中任务提示和退出前的确认。
  const leaveAccount = async () => {
    if (leaving) return;
    try {
      const state = await api("/agent").catch(() => ({}));
      const busy = !!(state.busy?.length || Object.values(state.background || {}).some((n) => Number(n) > 0));
      const title = t(signedIn ? "firstUse.logout" : "firstUse.backConfig");
      const body = signedIn ? t(busy ? "firstUse.logoutBusy" : "firstUse.logoutBody") : t("firstUse.backConfigBody");
      if (!(await confirmSheet({ title, body, confirmLabel: title, danger: signedIn }))) return;
      setLeaving(true);
      const result = await api(signedIn ? "/account/logout" : "/account/setup", { method: "POST", body: signedIn ? { stopRunning: busy } : {} });
      if (signedIn && result.revoked === false) failed(t("settings.logout.notRevoked"));
      window.dispatchEvent(new Event("amb-connection-change"));
    } catch (e) {
      failed(e);
    } finally {
      setLeaving(false);
    }
  };
  // 性价比（Key 的路由策略）：Modelflare 不支持时状态里 supported 变成 false，这一行随之消失
  const putKeyQuality = (strategy) =>
    api("/account/key-quality", { method: "PUT", body: { strategy } })
      .then((r) => {
        onAccount(r);
        saved();
      })
      .catch((e) => {
        failed(e);
        return api("/account").then(onAccount).catch(() => {});
      });
  const putAlerts = (patch) =>
    api("/account/alerts", { method: "PUT", body: patch })
      .then((r) => {
        onAccount(r);
        saved();
      })
      .catch(failed);
  const putSearch = (patch) => put({ webSearch: patch }, { webSearch: { ...s.webSearch, ...(patch.provider ? { provider: patch.provider } : {}) } });
  const conn = useConnections(tab === "connections" ? focusRow : "");
  const desktop = !!(s && s.desktop);
  const pickFont = (v) => {
    setPrefs({ font: v });
    if (v === "custom") requestAnimationFrame(() => document.querySelector("#set-font-name input")?.focus());
    else saved();
  };
  const toggleNotify = async (v) => {
    if (v && !(await requestNotify())) return failed(t("settings.notifyDenied"));
    setPrefs({ notify: v });
    saved();
  };
  const customized = mode !== "system" || appearanceChanged(p) || (desktop && s.zoom !== 1);
  const resetLook = () => {
    setThemeMode("system");
    resetAppearance();
    if (desktop && s.zoom !== 1) put({ zoom: 1 }, { zoom: 1 });
    else saved();
  };
  const managed = mf && mf.mode === "managed";
  const signedIn = !!(acct && acct.state === "signed_in");
  useEffect(() => {
    if (tab === "modelflare" && managed && mf.connected && acct) void refreshBalance();
  }, [tab, managed, !!mf?.connected, !!acct]);
  useEffect(() => {
    if (managed && tab === "modelflare") api("/official").then((r) => setOfficial(r.providers)).catch(failed);
  }, [managed, tab]);
  const officialChanged = async (r) => {
    setOfficial(r.providers);
    setKeySheet(null);
    onMfChanged();
    reloadModels?.();
    saved();
  };
  const removeOfficial = async (p) => {
    const last = !(mf && mf.connected) && official.filter((x) => x.connected).length === 1;
    if (!(await confirmSheet({ title: t("official.remove.title", { name: officialName(p) }), body: last ? t("official.remove.bodyLast") : t("official.remove.body"), confirmLabel: t("official.remove.confirm"), danger: true }))) return;
    try {
      await officialChanged(await api(`/official/${encodeURIComponent(p.id)}`, { method: "DELETE" }));
    } catch (e) {
      failed(e);
    }
  };
  // 登录后才有邀请码和通知；进入模型分页时读一次
  useEffect(() => {
    if (!signedIn || tab !== "modelflare") return;
    api("/account/invite").then(setInvite).catch(() => setInvite(null));
    api("/account/notifications").then((r) => setUnread(r.data ? r.data.unread_count : null)).catch(() => setUnread(null));
  }, [signedIn, tab]);

  // —— 行定义：每行一个稳定 id，可被搜索、可被深链（#/settings/<tab>/<id>）——
  const rows = useMemo(() => {
    if (!s) return [];
    const guideSteps = g.loaded ? visibleSteps(g) : [];
    const acctName = signedIn ? acct.name ? `${acct.name}${acct.email ? ` · ${acct.email}` : ""}` : t("settings.rows.account.signedIn") : "";
    const gw = status && status.gateway;
    const alertLines = ALERT_LINES();
    return [
      { tab: "general", id: "language", name: t("common.lang.label"), sub: t("settings.rows.language.sub"), keys: t("settings.rows.language.keys"),
        ctl: html`<${MenuButton} width=${220} label=${t("common.lang.label")} value=${langPref} onChange=${(v) => changeLang(v).then(() => saved()).catch(failed)} options=${LANG_OPTIONS()} />` },
      { tab: "general", id: "send-key", name: t("settings.rows.sendKey.name"), sub: t("settings.rows.sendKey.sub", { key: p.sendKey === "mod" ? "Enter" : "Shift+Enter" }), keys: t("settings.rows.sendKey.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.sendKey.name")} value=${p.sendKey} onChange=${(v) => { setPrefs({ sendKey: v }); saved(); }} options=${[["enter", "Enter"], ["mod", MOD_ENTER]]} />` },
      canNotify && { tab: "general", id: "notify", name: t("settings.rows.notify.name"), sub: t("scheduled.notifySub"), keys: t("settings.rows.notify.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.notify.name")} value=${p.notify} onChange=${toggleNotify} />` },
      desktop && { tab: "general", id: "rules-awake", name: t("scheduled.keepAwakeSetting"), sub: t("scheduled.keepAwakeHint"), keys: "schedule sleep 定时 睡眠", // i18n-ignore: multilingual command search keywords
        ctl: html`<${Switch} label=${t("scheduled.keepAwakeSetting")} value=${!!s.keepAwakeForRules} onChange=${(v) => put({ keepAwakeForRules: v }, { keepAwakeForRules: v })} />` },
      g.loaded && { tab: "general", id: "guide", name: t("settings.rows.guide.name"),
        sub: g.seen.includes("completed") ? t("guide.completed") : g.hidden ? t("settings.rows.guide.hidden") : t("settings.rows.guide.progress", { done: progress(g), total: guideSteps.length }),
        keys: t("settings.rows.guide.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => (g.hidden ? showGuide() : resetGuide()).catch(failed)}>${t(g.hidden ? "welcome.showAgain" : "settings.rows.guide.restart")}</button>` },
      desktop && { tab: "general", group: "desktop", id: "close", name: t("settings.rows.close.name"), sub: t("settings.rows.close.sub"), keys: t("settings.rows.close.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.close.name")} value=${s.closeToTray} onChange=${(v) => put({ closeToTray: v }, { closeToTray: v })} options=${[[true, t("settings.rows.close.tray")], [false, t("settings.rows.close.quit")]]} />` },
      desktop && s.autostart.supported && { tab: "general", group: "desktop", id: "autostart", name: t("settings.rows.autostart.name"), sub: t("settings.rows.autostart.sub"), keys: t("settings.rows.autostart.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.autostart.name")} value=${s.autostart.on} onChange=${(v) => put({ autostart: v }, { autostart: { ...s.autostart, on: v } })} />` },
      desktop && { tab: "general", group: "desktop", id: "auto-download-updates", name: t("updates.autoDownload"),
        sub: t(s.autoUpdateSupported ? "updates.autoDownloadHint" : "updates.manualOnly"), keys: t("settings.rows.version.keys"),
        ctl: html`<${Switch} label=${t("updates.autoDownload")} value=${s.autoDownloadUpdates !== false} disabled=${!s.autoUpdateSupported}
          onChange=${(v) => put({ autoDownloadUpdates: v }, { autoDownloadUpdates: v })} />` },
      desktop && { tab: "general", group: "desktop", id: "browser", name: t("settings.rows.browser.name"), sub: t("settings.rows.browser.sub"), keys: t("settings.rows.browser.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => api("/desktop/open-in-browser", { method: "POST", body: {} }).catch(failed)}>${t("common.open")}</button>` },
      { tab: "general", group: "account", id: "account-session", name: signedIn ? t("settings.rows.account.name") : t("settings.rows.connection.name"),
        sub: signedIn ? acctName : t("firstUse.backConfigBody"), keys: `${t("settings.rows.account.keys")} ${t(signedIn ? "firstUse.logout" : "firstUse.backConfig")}`,
        ctl: html`<button type="button" class="text" disabled=${leaving} onClick=${leaveAccount}>${t(signedIn ? "firstUse.logout" : "firstUse.backConfig")}</button>` },

      { tab: "appearance", searchOnly: true, id: "theme", name: t("settings.rows.theme.name"), sub: t("settings.rows.theme.sub"), keys: t("settings.rows.theme.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.theme.name")} value=${mode} onChange=${(m) => { setThemeMode(m); saved(); }} options=${THEMES()} />` },
      { tab: "appearance", group: "text", id: "text-size", name: t("settings.rows.textSize.name"), sub: desktop ? t("settings.rows.textSize.subDesktop") : t("settings.rows.textSize.sub"), keys: t("settings.rows.textSize.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.textSize.name")} value=${p.text} onChange=${(v) => { setPrefs({ text: v }); saved(); }} options=${TEXT_SIZES()} />` },
      { tab: "appearance", group: "text", id: "font", name: t("settings.rows.font.name"), sub: t("settings.rows.font.sub"), keys: t("settings.rows.font.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.font.name")} value=${p.font} onChange=${pickFont} options=${FONTS()} />` },
      p.font === "custom" && { tab: "appearance", group: "text", id: "font-name", name: t("settings.rows.fontName.name"), sub: p.fontName ? t("settings.rows.fontName.subSet") : t("settings.rows.fontName.subEmpty"), keys: t("settings.rows.fontName.keys"),
        ctl: html`<${FontInput} id="font-ui" label=${t("settings.rows.fontName.name")} value=${p.fontName} placeholder=${t("settings.rows.fontName.placeholder")} suggest=${SUGGEST_UI} fallback="var(--font-system)"
          onChange=${(v) => setPrefs({ fontName: v })} />` },
      { tab: "appearance", group: "text", id: "code-font", name: t("settings.rows.codeFont.name"), sub: t("settings.rows.codeFont.sub"), keys: t("settings.rows.codeFont.keys"),
        ctl: html`<${FontInput} id="font-code" label=${t("settings.rows.codeFont.name")} value=${p.codeFont} placeholder=${t("settings.rows.codeFont.placeholder")} suggest=${SUGGEST_CODE} fallback="var(--code-system)"
          onChange=${(v) => setPrefs({ codeFont: v })} />` },
      { tab: "appearance", group: "text", id: "code-wrap", name: t("settings.rows.codeWrap.name"), sub: t("settings.rows.codeWrap.sub"), keys: t("settings.rows.codeWrap.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.codeWrap.name")} value=${p.codeWrap} onChange=${(v) => { setPrefs({ codeWrap: v }); saved(); }} />` },
      { tab: "appearance", group: "text", id: "text-preview", custom: html`<${TextPreview} key="text-preview" />` },
      desktop && { tab: "appearance", group: "layout", id: "zoom", name: t("settings.rows.zoom.name"), sub: t("settings.rows.zoom.sub"), keys: t("settings.rows.zoom.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.zoom.name")} value=${s.zoom} onChange=${(z) => put({ zoom: z }, { zoom: z })} options=${ZOOMS} />` },
      { tab: "appearance", group: "layout", id: "chat-width", name: t("settings.rows.chatWidth.name"), sub: t("settings.rows.chatWidth.sub"), keys: t("settings.rows.chatWidth.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.chatWidth.name")} value=${p.width} onChange=${(v) => { setPrefs({ width: v }); saved(); }} options=${WIDTHS()} />` },
      { tab: "appearance", group: "effects", id: "motion", name: t("settings.rows.motion.name"), sub: t("settings.rows.motion.sub"), keys: t("settings.rows.motion.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.motion.name")} value=${p.motion} onChange=${(v) => { setPrefs({ motion: v }); saved(); }} options=${AUTO_ON_OFF()} />` },
      { tab: "appearance", id: "reset-appearance", name: t("settings.rows.resetAppearance.name"), sub: desktop ? t("settings.rows.resetAppearance.subDesktop") : t("settings.rows.resetAppearance.sub"), keys: t("settings.rows.resetAppearance.keys"),
        ctl: html`<button type="button" class="text" disabled=${!customized} onClick=${resetLook}>${t("settings.rows.resetAppearance.button")}</button>` },

      managed && acct && { tab: "modelflare", searchOnly: true, id: "account", name: t("settings.rows.account.name"),
        sub: signedIn ? (acct.billedToEnterprise ? t("settings.rows.account.enterprise", { name: acct.name || t("welcome.accountFallback") }) : acctName) : acct.state === "unavailable" ? acct.error : t("settings.rows.account.signedOut"), keys: t("settings.rows.account.keys"),
        ctl: signedIn
          ? html`${!acct.name && html`<a class="text" href=${acct.profileUrl} target="_blank" rel="noopener noreferrer">${t("welcome.setNickname")}</a>`}<span class="badge ok">${t("settings.rows.account.signedIn")}</span>`
          : acct.state === "signed_out" ? html`<button type="button" class="btn" onClick=${() => setSheet("login")}>${t("settings.rows.account.login")}</button>` : null },
      !managed && { tab: "modelflare", id: "connection", name: t("settings.rows.connection.name"), sub: t("settings.rows.connection.subExternal"), keys: "",
        ctl: html`<span class="val" title=${mf && mf.baseUrl}>${mf && mf.baseUrl}</span>` },
      managed && acct && mf.connected && { tab: "modelflare", searchOnly: true, id: "balance", name: t("settings.rows.balance.name"),
        sub: acct.error ? t("settings.rows.balance.error", { error: acct.error }) : acct.updatedAt ? t("settings.rows.balance.updated", { time: fmtTimeOfDay(acct.updatedAt) }) : t("common.reading"), keys: t("settings.rows.balance.keys"),
        ctl: html`${acct.lowBalance && !acct.error && html`<span class="dot warn"></span>`}<span class="balance">${balanceText(acct)}</span>
          <${Button} variant="ghost" size="sm" icon="refresh" aria-label=${t("settings.rows.balance.refresh")} loading=${balanceRefreshing} onClick=${refreshBalance}>${t("common.refresh")}<//>
          <a class="btn" href=${acct.topupUrl || MF_TOPUP} target="_blank" rel="noopener noreferrer">${t("settings.rows.balance.topUp")}</a>` },
      managed && acct && mf.connected && { tab: "modelflare", group: "account", id: "low-balance", name: t("settings.rows.lowBalance.name"), sub: t("settings.rows.lowBalance.sub"), keys: t("settings.rows.lowBalance.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.lowBalance.name")} value=${acct.alerts.lowBalanceUsd} onChange=${(v) => putAlerts({ lowBalanceUsd: v })}
          options=${alertLines.some(([v]) => v === acct.alerts.lowBalanceUsd) ? alertLines : [...alertLines, [acct.alerts.lowBalanceUsd, usd(acct.alerts.lowBalanceUsd)]]} />` },
      managed && acct && mf.connected && acct.alerts.lowBalanceUsd > 0 && { tab: "modelflare", group: "account", id: "low-balance-push", name: t("settings.rows.lowBalancePush.name"), sub: t("settings.rows.lowBalancePush.sub"), keys: t("settings.rows.lowBalancePush.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.lowBalancePush.name")} value=${acct.alerts.push} onChange=${(v) => putAlerts({ lowBalancePush: v })} />` },
      signedIn && { tab: "modelflare", group: "account", id: "usage", name: t("settings.rows.usage.name"), sub: t("settings.rows.usage.sub"), keys: t("settings.rows.usage.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => setSheet("usage")}>${t("common.view")}</button>` },
      signedIn && { tab: "modelflare", group: "account", id: "notifications", name: t("settings.rows.notifications.name"), sub: unread ? t("settings.rows.notifications.unread", { count: unread }) : t("settings.rows.notifications.sub"), keys: t("settings.rows.notifications.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => setSheet("notifications")}>${t("common.view")}</button>` },
      signedIn && invite && { tab: "modelflare", group: "account", id: "invite", name: t("settings.rows.invite.name"), sub: t("settings.rows.invite.sub"), keys: t("settings.rows.invite.keys"),
        ctl: html`<span class="val">${invite.code}</span><${CopyButton} text=${invite.url} label=${t("settings.rows.invite.copy")} />` },
      (!managed || mf.connected) && { tab: "modelflare", group: "account", id: "console", name: t("settings.rows.console.name"), sub: t("settings.rows.console.sub"), keys: t("settings.rows.console.keys"),
        ctl: html`<a class="text" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">${t("common.openExternal")}</a>` },
      { tab: "modelflare", group: "models", id: "default-model", name: t("settings.rows.defaultModel.name"), sub: t("settings.rows.defaultModel.sub"), keys: t("settings.rows.defaultModel.keys"),
        ctl: html`<${PickModel} value=${s.defaultModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} resetLabel=${t("settings.rows.defaultModel.auto")}
          onChange=${(m) => put({ defaultModel: m }, { defaultModel: m })} />` },
      managed && mf.connected && { tab: "modelflare", group: "models", id: "image-model", name: t("settings.rows.imageModel.name"), sub: t("settings.rows.imageModel.sub"), keys: t("settings.rows.imageModel.keys"),
        ctl: html`<${PickModel} value=${s.imageModel} models=${media ? media.image : null} modelsError=${media && media.error} reloadModels=${loadMedia}
          resetLabel=${media && media.recommended.image ? t("settings.rows.autoModel", { model: shortModel(media.recommended.image) }) : t("common.auto")} label=${t("settings.rows.imageModel.name")}
          onChange=${(m) => put({ imageModel: m }, { imageModel: m })} />` },
      managed && mf.connected && { tab: "modelflare", group: "models", id: "video-model", name: t("settings.rows.videoModel.name"), sub: t("settings.rows.videoModel.sub"), keys: t("settings.rows.videoModel.keys"),
        ctl: html`<${PickModel} value=${s.videoModel} models=${media ? media.video : null} modelsError=${media && media.error} reloadModels=${loadMedia}
          resetLabel=${media && media.recommended.video ? t("settings.rows.autoModel", { model: shortModel(media.recommended.video) }) : t("common.auto")} label=${t("settings.rows.videoModel.name")}
          onChange=${(m) => put({ videoModel: m }, { videoModel: m })} />` },
      { tab: "modelflare", group: "models", id: "models", name: t("settings.rows.models.name"), sub: modelsError ? t("settings.rows.models.error", { error: modelsError }) : t("settings.rows.models.sub"), keys: t("settings.rows.models.keys"),
        ctl: html`<span class="val num">${models ? t("settings.rows.models.count", { count: models.length }) : "…"}</span><button type="button" class="text" onClick=${() => reloadModels().then(() => saved())}>${t("common.refresh")}</button>` },
      managed && mf.connected && { tab: "modelflare", group: "models", id: "reasoning-effort", name: t("models.effort.name"), sub: t("settings.rows.effort.sub"), keys: t("settings.rows.effort.keys"),
        ctl: html`<${Seg} label=${t("models.effort.name")} value=${effort} onChange=${(v) => setEffort(v).then((ok) => ok && saved())} options=${effortOptions()} />` },
      showsStrategy(acct) && { tab: "modelflare", group: "models", id: "key-quality", name: t("settings.rows.keyQuality.name"), sub: t("settings.rows.keyQuality.sub"), keys: t("settings.rows.keyQuality.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.keyQuality.name")} value=${acct.keyQuality.strategy} onChange=${putKeyQuality} options=${strategyOptions()} />` },
      ...(managed && official
        ? [
            ...official.filter((p) => p.connected).map((p, i) => ({
              tab: "modelflare", group: "official", groupNote: i === 0 ? t("official.note") : undefined, id: `official-${p.id}`, name: officialName(p),
              sub: t("official.connected", { tail: p.keyTail, count: p.models }), keys: t("official.keys"),
              ctl: html`<button type="button" class="text" onClick=${() => setKeySheet(p)}>${t("official.replace")}</button>
                <button type="button" class="text danger" onClick=${() => removeOfficial(p)}>${t("official.removeButton")}</button>`,
            })),
            official.some((p) => !p.connected) && {
              tab: "modelflare", group: "official", groupNote: official.some((p) => p.connected) ? undefined : t("official.note"), id: "official-add", name: t("official.addName"), sub: t("official.addSub"), keys: t("official.keys"),
              ctl: html`<${MenuButton} label=${t("official.addName")} value="" onChange=${(id) => setKeySheet(official.find((p) => p.id === id))} options=${[["", t("official.choose")], ...official.filter((p) => !p.connected).map((p) => [p.id, officialName(p)])]} />`,
            },
          ]
        : []),
      managed && mf.connected && { tab: "modelflare", group: "line", id: "line", name: t("settings.rows.line.name"), sub: t("settings.rows.line.sub"), keys: t("settings.rows.line.keys"),
        ctl: html`<${DomainConnection} value=${mf.line} onChange=${setLine} />` },

      { tab: "computer", id: "cu-status", name: t("settings.rows.cuStatus.name"), sub: cu ? cu.reason : t("common.reading"), keys: t("settings.rows.cuStatus.keys"),
        ctl: cu && html`<span class=${`badge ${cu.available ? "ok" : "err"}`}>${t(cu.available ? "settings.rows.cuStatus.ready" : "settings.rows.cuStatus.notReady")}</span>` },
      cu && cu.notice && { tab: "computer", id: "cu-notice", name: t("settings.rows.cuNotice.name"), sub: cu.notice, title: cu.notice, keys: t("settings.rows.cuNotice.keys"), ctl: null },
      { tab: "computer", id: "cu-per-bot", name: t("settings.rows.cuPerBot.name"), sub: t("settings.rows.cuPerBot.sub"), keys: t("settings.rows.cuPerBot.keys"),
        ctl: bots && bots[0] && html`<button type="button" class="text" onClick=${() => onOpenBotSettings(bots[0].id, "computer")}>${t("settings.rows.cuPerBot.open")}</button>` },

      { tab: "privacy", id: "key-storage", name: t("settings.rows.keyStorage.name"), sub: t("settings.rows.keyStorage.sub"), ctl: null, keys: t("settings.rows.keyStorage.keys") },
      { tab: "privacy", id: "account-storage", name: t("settings.rows.accountStorage.name"), sub: t("settings.rows.accountStorage.sub"), ctl: null, keys: t("settings.rows.accountStorage.keys") },
      { tab: "privacy", id: "token", name: t("settings.rows.token.name"), sub: s.listen.tokenRequired ? t("settings.rows.token.required") : t("settings.rows.token.local"), keys: t("settings.rows.token.keys"),
        ctl: html`<span class=${`badge ${s.listen.tokenRequired ? "ok" : "off"}`}>${t(s.listen.tokenRequired ? "common.on" : "common.off")}</span>` },
      { tab: "privacy", id: "sandbox", name: t("settings.rows.sandbox.name"), sub: t("settings.rows.sandbox.sub"), ctl: null, keys: t("settings.rows.sandbox.keys") },
      { tab: "privacy", id: "screens", name: t("settings.rows.screens.name"), sub: t("settings.rows.screens.sub"), ctl: null, keys: t("settings.rows.screens.keys") },

      ...connectionRows(conn, bots, onOpenApps),
      { tab: "network", id: "web-search", name: t("settings.rows.webSearch.name"), sub: t("settings.rows.webSearch.sub"), keys: t("settings.rows.webSearch.keys"),
        ctl: html`<${MenuButton} label=${t("settings.rows.webSearch.name")} value=${s.webSearch.provider} width=${200} options=${SEARCH_OPTIONS()} onChange=${(v) => putSearch({ provider: v })} />` },
      s.webSearch.provider === "searxng" && { tab: "network", id: "web-search-url", name: t("settings.rows.webSearchUrl.name"), keys: t("settings.rows.webSearchUrl.keys"),
        ctl: html`<${SaveInput} id="web-search-url-in" value=${s.webSearch.url} label=${t("settings.rows.webSearchUrl.name")} placeholder="https://searx.example.org" onSave=${(url) => putSearch({ url })} />` },
      s.webSearch.provider !== "auto" && s.webSearch.provider !== "searxng" && (() => {
        const ws = s.webSearch;
        const name = t("settings.rows.webSearchKey.name", { provider: SEARCH_OPTIONS().find(([v]) => v === ws.provider)[1] });
        return { tab: "network", id: "web-search-key", name, sub: ws.keyRejected ? t("settings.rows.webSearchKey.rejected") : "", keys: t("settings.rows.webSearchKey.keys"),
          ctl: html`<${SaveInput} key=${ws.provider} id="web-search-key-in" secret label=${name} placeholder=${ws.keyTail ? `••••${ws.keyTail}` : t("settings.rows.webSearchKey.placeholder")} onSave=${(key) => putSearch({ key })} />
            ${ws.keyTail && html`<button type="button" class="text danger" onClick=${() => putSearch({ key: "" })}>${t("settings.rows.webSearchKey.remove")}</button>`}` };
      })(),
      { tab: "network", id: "listen", name: t("settings.rows.listen.name"), sub: t("settings.rows.listen.sub"), keys: t("settings.rows.listen.keys"),
        ctl: html`<span class="val">${s.listen.host}:${s.listen.port}</span><${CopyButton} text=${`http://${s.listen.host === "0.0.0.0" ? "127.0.0.1" : s.listen.host}:${s.listen.port}/`} label=${t("settings.rows.listen.copy")} />` },

      { tab: "data", id: "data-dir", name: t("settings.rows.dataDir.name"), sub: t("settings.rows.dataDir.sub"), keys: t("settings.rows.dataDir.keys"),
        ctl: html`<span class="val" title=${s.dataDir}>${s.dataDir}</span><${CopyButton} text=${s.dataDir} label=${t("settings.rows.dataDir.copy")} />
          ${desktop && html`<button type="button" class="text" onClick=${() => api("/desktop/open-data-dir", { method: "POST", body: {} }).catch(failed)}>${t("common.open")}</button>`}` },

      { tab: "about", id: "version", name: t("settings.rows.version.name"), keys: t("settings.rows.version.keys"),
        sub: updateDescription(update),
        ctl: html`<span class="val">${status ? status.version : ""}</span>
          <${UpdateActions} update=${update} onChanged=${onUpdateChanged} />` },
      { tab: "about", id: "licenses", name: t("settings.rows.licenses.name"), sub: t("settings.rows.licenses.sub"), keys: t("settings.rows.licenses.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => setNotices(true)}>${t("common.view")}</button>` },
      { tab: "about", id: "diagnostics", name: t("settings.rows.diagnostics.name"),
        sub: gw ? [t("settings.rows.diagnostics.gateway"), gatewayState(gw.state), gw.restarts && t("settings.rows.diagnostics.restarts", { count: gw.restarts }), gw.lastError].filter(Boolean).join(" · ") : "",
        keys: t("settings.rows.diagnostics.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => onTab?.("troubleshoot")}>${t("settings.tabs.troubleshoot")}</button>` },
      // 故障排查页是单独的面板（troubleshoot.js），这一行只给搜索用：搜"日志""测试模型"时能找到入口
      { tab: "troubleshoot", id: "troubleshoot", name: t("settings.tabs.troubleshoot"), sub: t("settings.rows.troubleshoot.sub"), keys: t("settings.rows.troubleshoot.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => { setQ(""); onTab?.("troubleshoot"); }}>${t("common.open")}</button>` },
      { tab: "about", id: "links", name: "Modelflare", sub: t("settings.rows.links.sub"),
        ctl: html`<a class="text" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">modelflare.dev ↗</a><a class="text" href=${MF_DOCS_LINK} target="_blank" rel="noopener noreferrer">${t("settings.rows.links.docs")}</a>` },
    ].filter(Boolean);
  }, [s, mf, mode, p, models, modelsError, cu, status, update, bots, acct, invite, unread, g, media, lang, langPref, conn.accounts, conn.channelAccounts, effort, official, leaving, balanceRefreshing]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => !r.custom && `${r.name} ${r.sub || ""} ${r.keys || ""}`.toLowerCase().includes(needle)) : rows.filter((r) => r.tab === tab && !r.searchOnly);
  // 搜索时按分页分段，平时按 group 分段
  const parts = needle ? TABS.map(([id, label]) => ({ label: tabLabel(label), rows: shown.filter((r) => r.tab === id) })).filter((x) => x.rows.length) : groupRows(shown);
  const acctRow = rows.find((r) => r.id === "account");
  const balRow = rows.find((r) => r.id === "balance");

  const title = needle ? t("settings.searchResults") : tabLabel((TABS.find(([id]) => id === tab) || TABS[0])[1]);
  return html`<section class="settings view" data-screen="settings" key=${needle ? "search" : tab}>
    <div class="set-head"><h1 class="set-title">${title}</h1></div>
    <div class="set-body">
      ${!s && html`<div class="list"><div class="row"><${Skeleton} w="40%" /></div><div class="row"><${Skeleton} w="55%" /></div></div>`}
      ${s && !shown.length && html`<p class="set-none">${t("settings.noMatch")}</p>`}
      ${s && !needle && tab === "general" && html`<${PwshHint} />`}
      ${s && !needle && tab === "appearance" && html`<div class="set-part">${t("settings.groups.theme")}</div>
        <${ThemeCards} value=${mode} flash=${flash === "theme"} onChange=${(m) => { setThemeMode(m); saved(); }} />`}
      ${s && !needle && tab === "modelflare" && acctRow && html`<div class="list acct-card">
        <${Row} id=${acctRow.id} name=${acctRow.name} sub=${acctRow.sub} title=${acctRow.sub} flash=${flash === acctRow.id}>${acctRow.ctl}<//>
        ${balRow && html`<${AccountBalance} account=${acct} refreshing=${balanceRefreshing} onRefresh=${refreshBalance} flash=${flash === balRow.id} />`}
      </div>`}
      ${s && !needle && tab === "troubleshoot" ? html`<${TroubleshootPane} bots=${bots} desktop=${desktop} />` : parts.map(({ label, note, rows: list }) => html`${label && html`<div class="set-part">${label}</div>`}${note && html`<p class="set-note">${note}</p>`}
        <div class="list">${list.map((r) => r.custom || html`<${Row} key=${r.id} id=${r.id} name=${r.name} sub=${r.sub} title=${r.title || r.sub} flash=${flash === r.id || conn.fresh === r.id}>${r.ctl}<//>`)}</div>`)}
    </div>
    ${notices && html`<${NoticesSheet} onClose=${() => setNotices(false)} />`}
    <${ConnectionSheets} conn=${conn} bots=${bots} />
    ${sheet === "usage" && html`<${UsageSheet} onClose=${() => setSheet("")} />`}
    ${sheet === "notifications" && html`<${NotificationsSheet} onClose=${() => { setSheet(""); setUnread(null); }} />`}
    ${sheet === "login" && html`<${Sheet} title=${t("settings.rows.account.login")} onClose=${() => setSheet("")}>
      <${AccountLogin} manual=${!!(acct && acct.manualLogin)} onSignedIn=${(a) => { setSheet(""); if (a) onAccount(a); onMfChanged(); reloadModels?.(); }} />
    <//>`}
    ${keySheet && html`<${Sheet} title=${officialName(keySheet)} onClose=${() => setKeySheet(null)}>
      <${OfficialKeyForm} desktop=${!!status?.desktop} provider=${keySheet} onConnected=${officialChanged} />
    <//>`}
  </section>`;
}
