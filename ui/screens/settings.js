// 设置页（参考 Codex）：侧栏换成设置导航（返回应用 + 查找 + 分页），主区是大标题 + 白色圆角 list，一行一项；改动即保存。
// 入口只有左下角账户按钮、⌘/Ctrl+, 和命令面板。
// 外观（主题、字体、动画、毛玻璃…）和对话习惯（发送键、通知）是本机界面偏好，存在浏览器里（lib/theme.js、lib/prefs.js）；
// 其余设置走服务端 /settings。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Seg, Switch, Sheet, CopyButton, Skeleton, MenuButton } from "../components/ui.js";
import { AccountButton } from "./sidebar.js";
import { PickModel, shortModel } from "../components/model-picker.js";
import { KeyForm, lineOptions } from "./onboarding.js";
import { LoginSheet, NotificationsSheet, UsageSheet } from "./account.js";
import { api } from "../lib/api.js";
import { MF_CONSOLE, MF_DOCS_LINK, MF_TOPUP, usd } from "../lib/links.js";
import { useStore, confirmSheet, failed, saved, toast } from "../lib/store.js";
import { guide, resetGuide, visibleSteps } from "../lib/guide.js";
import { themeMode, setThemeMode } from "../lib/theme.js";
import { prefs, setPrefs, resetAppearance, appearanceChanged, fontStack } from "../lib/prefs.js";
import { canNotify, requestNotify } from "../lib/notify.js";
import { TroubleshootPane } from "./troubleshoot.js";
import { PwshHint } from "../components/pwsh-hint.js";
import { t, has, useLang, getLangPref, onLangChange, changeLang, LANG_NAMES } from "../lib/i18n.js";
import { fmtTimeOfDay } from "../lib/format.js";

/** [id, 标题的文案键, 图标]；标题渲染时再 t()（tabLabel） */
export const TABS = [
  ["general", "settings.tabs.general", "sliders"],
  ["appearance", "settings.tabs.appearance", "palette"],
  ["modelflare", "settings.tabs.modelflare", "spark"],
  ["computer", "settings.tabs.computer", "monitor"],
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
const LANG_OPTIONS = () => [["system", t("common.lang.system")], ["zh-CN", LANG_NAMES["zh-CN"]], ["en", LANG_NAMES.en]];
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
    onKeyDown=${(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())} />`;
}

/** 外观分页顶部的预览：一问一答 + 一行代码，跟着字体大小、字体、代码字体和代码换行实时变 */
function AppearancePreview() {
  return html`<div class="ap-preview" aria-hidden="true">
    <div class="ap-bubble">${t("settings.preview.ask")}</div>
    <div class="ap-reply">${t("settings.preview.reply", { b: html`<b>${t("settings.rows.codeWrap.name")}</b>` })}</div>
    <pre class="ap-code">const res = await fetch(\`\${base}/v1/chat/completions\`, { method: "POST", headers, body: JSON.stringify({ model, messages }) });</pre>
  </div>`;
}

function NoticesSheet({ onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api("/notices").then(setD).catch((e) => setD({ license: e.message, notices: "" }));
  }, []);
  return html`<${Sheet} title=${t("settings.rows.licenses.name")} wide onClose=${onClose}>
    <pre class="doc">${d ? `${d.license}\n\n${d.notices}` : t("common.loading")}</pre>
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>${t("common.close")}</button></div>
  <//>`;
}

/** 设置时的侧栏：返回应用 | 查找设置 | 分页 | 账户 */
export function SettingsSide({ tab, query, onQuery, onTab, onBack, username, account }) {
  const searching = !!query.trim();
  return html`<aside class="side" aria-label=${t("settings.side.label")}>
    <div class="side-top start">
      <button type="button" class="side-back" title=${t("settings.side.backTitle")} onClick=${onBack}><${Icon} name="arrowLeft" size="md" />${t("settings.side.back")}</button>
    </div>
    <label class="side-search">
      <${Icon} name="search" size="sm" />
      <input type="search" placeholder=${t("settings.side.search")} aria-label=${t("settings.side.search")} value=${query} onInput=${(e) => onQuery(e.target.value)}
        onKeyDown=${(e) => e.key === "Escape" && query && (e.stopPropagation(), onQuery(""))} />
    </label>
    <nav class="side-list side-nav" aria-label=${t("settings.side.nav")}>
      ${TABS.map(([id, label, icon]) => {
        const on = !searching && id === tab;
        return html`<button type="button" key=${id} class=${`nav-item${on ? " sel" : ""}`} aria-current=${on ? "page" : undefined}
          onClick=${() => { onQuery(""); onTab(id); }}><${Icon} name=${icon} size="md" /><span>${tabLabel(label)}</span></button>`;
      })}
    </nav>
    <div class="side-foot"><${AccountButton} username=${username} account=${account} on onClick=${() => onTab("general")} /></div>
  </aside>`;
}

export function SettingsScreen({ tab, query: q, onQuery: setQ, onTab, focusRow, mf, onMfChanged, onSettings, models, modelsError, reloadModels, status, bots, onOpenBotSettings, account: acct, onAccount }) {
  const [s, setS] = useState(null);
  const g = useStore(guide);
  const [rekey, setRekey] = useState(false);
  const [notices, setNotices] = useState(false);
  const [sheet, setSheet] = useState(""); // login | usage | notifications
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
  const disconnect = async () => {
    if (!(await confirmSheet({ title: t("settings.disconnect.title"), body: t("settings.disconnect.body"), confirmLabel: t("settings.disconnect.confirm"), danger: true }))) return;
    try {
      await api("/modelflare", { method: "DELETE" });
      onMfChanged();
    } catch (e) {
      failed(e);
    }
  };
  const logout = async () => {
    if (!(await confirmSheet({ title: t("settings.logout.title"), body: t("settings.logout.body"), confirmLabel: t("settings.logout.confirm"), danger: true }))) return;
    try {
      const r = await api("/account/logout", { method: "POST", body: {} });
      if (!r.revoked) failed(t("settings.logout.notRevoked"));
      onAccount(r);
      onMfChanged();
    } catch (e) {
      failed(e);
    }
  };
  const refreshBalance = () =>
    api("/account/refresh", { method: "POST", body: {} })
      .then(onAccount)
      .catch(failed);
  const putAlerts = (patch) =>
    api("/account/alerts", { method: "PUT", body: patch })
      .then((r) => {
        onAccount(r);
        saved();
      })
      .catch(failed);
  const putSearch = (patch) => put({ webSearch: patch }, { webSearch: { ...s.webSearch, ...(patch.provider ? { provider: patch.provider } : {}) } });
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
  // 登录后才有邀请码和通知；进入 Modelflare 分页时读一次
  useEffect(() => {
    if (!signedIn || tab !== "modelflare") return;
    api("/account/invite").then(setInvite).catch(() => setInvite(null));
    api("/account/notifications").then((r) => setUnread(r.data ? r.data.unread_count : null)).catch(() => setUnread(null));
  }, [signedIn, tab]);

  // —— 行定义：每行一个稳定 id，可被搜索、可被深链（#/settings/<tab>/<id>）——
  const rows = useMemo(() => {
    if (!s) return [];
    const guideSteps = g.loaded ? visibleSteps(g) : [];
    const acctName = signedIn ? acct.name || t("settings.rows.account.signedIn") : "";
    const gw = status && status.gateway;
    const alertLines = ALERT_LINES();
    return [
      { tab: "general", id: "language", name: t("common.lang.label"), sub: t("settings.rows.language.sub"), keys: t("settings.rows.language.keys"),
        ctl: html`<${Seg} label=${t("common.lang.label")} value=${langPref} onChange=${(v) => changeLang(v).then(() => saved()).catch(failed)} options=${LANG_OPTIONS()} />` },
      { tab: "general", id: "send-key", name: t("settings.rows.sendKey.name"), sub: t("settings.rows.sendKey.sub", { key: p.sendKey === "mod" ? "Enter" : "Shift+Enter" }), keys: t("settings.rows.sendKey.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.sendKey.name")} value=${p.sendKey} onChange=${(v) => { setPrefs({ sendKey: v }); saved(); }} options=${[["enter", "Enter"], ["mod", MOD_ENTER]]} />` },
      canNotify && { tab: "general", id: "notify", name: t("settings.rows.notify.name"), sub: t("settings.rows.notify.sub"), keys: t("settings.rows.notify.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.notify.name")} value=${p.notify} onChange=${toggleNotify} />` },
      desktop && { tab: "general", id: "close", name: t("settings.rows.close.name"), sub: t("settings.rows.close.sub"), keys: t("settings.rows.close.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.close.name")} value=${s.closeToTray} onChange=${(v) => put({ closeToTray: v }, { closeToTray: v })} options=${[[true, t("settings.rows.close.tray")], [false, t("settings.rows.close.quit")]]} />` },
      desktop && s.autostart.supported && { tab: "general", id: "autostart", name: t("settings.rows.autostart.name"), sub: t("settings.rows.autostart.sub"), keys: t("settings.rows.autostart.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.autostart.name")} value=${s.autostart.on} onChange=${(v) => put({ autostart: v }, { autostart: { ...s.autostart, on: v } })} />` },
      desktop && { tab: "general", id: "browser", name: t("settings.rows.browser.name"), sub: t("settings.rows.browser.sub"), keys: t("settings.rows.browser.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => api("/desktop/open-in-browser", { method: "POST", body: {} }).catch(failed)}>${t("common.open")}</button>` },
      g.loaded && { tab: "general", id: "guide", name: t("settings.rows.guide.name"),
        sub: g.hidden ? t("settings.rows.guide.hidden") : t("settings.rows.guide.progress", { done: guideSteps.filter((x) => g.done.includes(x.id)).length, total: guideSteps.length }),
        keys: t("settings.rows.guide.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => resetGuide().then(() => toast(t("settings.rows.guide.restarted"))).catch(failed)}>${t("settings.rows.guide.restart")}</button>` },

      { tab: "appearance", id: "theme", name: t("settings.rows.theme.name"), sub: t("settings.rows.theme.sub"), keys: t("settings.rows.theme.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.theme.name")} value=${mode} onChange=${(m) => { setThemeMode(m); saved(); }} options=${THEMES()} />` },
      { tab: "appearance", id: "text-size", name: t("settings.rows.textSize.name"), sub: desktop ? t("settings.rows.textSize.subDesktop") : t("settings.rows.textSize.sub"), keys: t("settings.rows.textSize.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.textSize.name")} value=${p.text} onChange=${(v) => { setPrefs({ text: v }); saved(); }} options=${TEXT_SIZES()} />` },
      { tab: "appearance", id: "font", name: t("settings.rows.font.name"), sub: t("settings.rows.font.sub"), keys: t("settings.rows.font.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.font.name")} value=${p.font} onChange=${pickFont} options=${FONTS()} />` },
      p.font === "custom" && { tab: "appearance", id: "font-name", name: t("settings.rows.fontName.name"), sub: p.fontName ? t("settings.rows.fontName.subSet") : t("settings.rows.fontName.subEmpty"), keys: t("settings.rows.fontName.keys"),
        ctl: html`<${FontInput} id="font-ui" label=${t("settings.rows.fontName.name")} value=${p.fontName} placeholder=${t("settings.rows.fontName.placeholder")} suggest=${SUGGEST_UI} fallback="var(--font-system)"
          onChange=${(v) => setPrefs({ fontName: v })} />` },
      { tab: "appearance", id: "code-font", name: t("settings.rows.codeFont.name"), sub: t("settings.rows.codeFont.sub"), keys: t("settings.rows.codeFont.keys"),
        ctl: html`<${FontInput} id="font-code" label=${t("settings.rows.codeFont.name")} value=${p.codeFont} placeholder=${t("settings.rows.codeFont.placeholder")} suggest=${SUGGEST_CODE} fallback="var(--code-system)"
          onChange=${(v) => setPrefs({ codeFont: v })} />` },
      desktop && { tab: "appearance", id: "zoom", name: t("settings.rows.zoom.name"), sub: t("settings.rows.zoom.sub"), keys: t("settings.rows.zoom.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.zoom.name")} value=${s.zoom} onChange=${(z) => put({ zoom: z }, { zoom: z })} options=${ZOOMS} />` },
      { tab: "appearance", id: "chat-width", name: t("settings.rows.chatWidth.name"), sub: t("settings.rows.chatWidth.sub"), keys: t("settings.rows.chatWidth.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.chatWidth.name")} value=${p.width} onChange=${(v) => { setPrefs({ width: v }); saved(); }} options=${WIDTHS()} />` },
      { tab: "appearance", id: "code-wrap", name: t("settings.rows.codeWrap.name"), sub: t("settings.rows.codeWrap.sub"), keys: t("settings.rows.codeWrap.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.codeWrap.name")} value=${p.codeWrap} onChange=${(v) => { setPrefs({ codeWrap: v }); saved(); }} />` },
      { tab: "appearance", id: "motion", name: t("settings.rows.motion.name"), sub: t("settings.rows.motion.sub"), keys: t("settings.rows.motion.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.motion.name")} value=${p.motion} onChange=${(v) => { setPrefs({ motion: v }); saved(); }} options=${AUTO_ON_OFF()} />` },
      { tab: "appearance", id: "glass", name: t("settings.rows.glass.name"), sub: t("settings.rows.glass.sub"), keys: t("settings.rows.glass.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.glass.name")} value=${p.glass} onChange=${(v) => { setPrefs({ glass: v }); saved(); }} options=${AUTO_ON_OFF()} />` },
      { tab: "appearance", id: "reset-appearance", name: t("settings.rows.resetAppearance.name"), sub: desktop ? t("settings.rows.resetAppearance.subDesktop") : t("settings.rows.resetAppearance.sub"), keys: t("settings.rows.resetAppearance.keys"),
        ctl: html`<button type="button" class="text" disabled=${!customized} onClick=${resetLook}>${t("settings.rows.resetAppearance.button")}</button>` },

      managed && acct && { tab: "modelflare", id: "account", name: t("settings.rows.account.name"),
        sub: signedIn ? (acct.billedToEnterprise ? t("settings.rows.account.enterprise", { name: acctName }) : acctName) : acct.state === "unavailable" ? acct.error : t("settings.rows.account.signedOut"), keys: t("settings.rows.account.keys"),
        ctl: signedIn
          ? html`<button type="button" class="text danger" onClick=${logout}>${t("settings.rows.account.logout")}</button>`
          : acct.loginAvailable === false
            ? html`<span class="val">${t("settings.rows.account.noBrowserLogin")}</span>`
            : html`<button type="button" class="text accent" onClick=${() => setSheet("login")}>${t("settings.rows.account.login")}</button>` },
      { tab: "modelflare", id: "connection", name: signedIn ? t("settings.rows.connection.nameSignedIn") : t("settings.rows.connection.name"),
        sub: !managed ? t("settings.rows.connection.subExternal") : signedIn ? t("settings.rows.connection.subSignedIn") : t("settings.rows.connection.sub"), keys: t("settings.rows.connection.keys"),
        ctl: managed
          ? html`<span class="mf-state"><span class=${`dot ${mf.connected ? "ok" : "err"}`}></span>${mf.connected ? t("common.connected") : t("common.notConnected")}</span>
              ${mf.keyTail && html`<span class="val">••••${mf.keyTail}</span>`}
              ${!signedIn && html`<button type="button" class="text" onClick=${() => setRekey(true)}>${t("settings.rows.connection.rekey")}</button>
                <button type="button" class="text danger" onClick=${disconnect}>${t("settings.rows.connection.disconnect")}</button>`}`
          : html`<span class="val" title=${mf && mf.baseUrl}>${mf && mf.baseUrl}</span>` },
      managed && acct && mf.connected && { tab: "modelflare", id: "balance", name: t("settings.rows.balance.name"),
        sub: acct.error ? t("settings.rows.balance.error", { error: acct.error }) : acct.source === "key" ? t("settings.rows.balance.fromKey") : acct.updatedAt ? t("settings.rows.balance.updated", { time: fmtTimeOfDay(acct.updatedAt) }) : t("common.reading"), keys: t("settings.rows.balance.keys"),
        ctl: html`<span class=${`balance${acct.lowBalance ? " low" : ""}`}>${usd(acct.balanceUsd)}</span>
          <button type="button" class="icon-btn" title=${t("common.refresh")} aria-label=${t("settings.rows.balance.refresh")} onClick=${refreshBalance}><${Icon} name="refresh" size="sm" /></button>
          <a class="btn" href=${MF_TOPUP} target="_blank" rel="noopener noreferrer">${t("settings.rows.balance.topUp")}</a>` },
      managed && acct && mf.connected && { tab: "modelflare", id: "low-balance", name: t("settings.rows.lowBalance.name"), sub: t("settings.rows.lowBalance.sub"), keys: t("settings.rows.lowBalance.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.lowBalance.name")} value=${acct.alerts.lowBalanceUsd} onChange=${(v) => putAlerts({ lowBalanceUsd: v })}
          options=${alertLines.some(([v]) => v === acct.alerts.lowBalanceUsd) ? alertLines : [...alertLines, [acct.alerts.lowBalanceUsd, usd(acct.alerts.lowBalanceUsd)]]} />` },
      managed && acct && mf.connected && acct.alerts.lowBalanceUsd > 0 && { tab: "modelflare", id: "low-balance-push", name: t("settings.rows.lowBalancePush.name"), sub: t("settings.rows.lowBalancePush.sub"), keys: t("settings.rows.lowBalancePush.keys"),
        ctl: html`<${Switch} label=${t("settings.rows.lowBalancePush.name")} value=${acct.alerts.push} onChange=${(v) => putAlerts({ lowBalancePush: v })} />` },
      signedIn && { tab: "modelflare", id: "usage", name: t("settings.rows.usage.name"), sub: t("settings.rows.usage.sub"), keys: t("settings.rows.usage.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => setSheet("usage")}>${t("common.view")}</button>` },
      signedIn && { tab: "modelflare", id: "notifications", name: t("settings.rows.notifications.name"), sub: unread ? t("settings.rows.notifications.unread", { count: unread }) : t("settings.rows.notifications.sub"), keys: t("settings.rows.notifications.keys"),
        ctl: html`<button type="button" class="text" onClick=${() => setSheet("notifications")}>${t("common.view")}</button>` },
      signedIn && invite && { tab: "modelflare", id: "invite", name: t("settings.rows.invite.name"), sub: t("settings.rows.invite.sub"), keys: t("settings.rows.invite.keys"),
        ctl: html`<span class="val">${invite.code}</span><${CopyButton} text=${invite.url} label=${t("settings.rows.invite.copy")} />` },
      managed && { tab: "modelflare", id: "line", name: t("settings.rows.line.name"), sub: t("settings.rows.line.sub"), keys: t("settings.rows.line.keys"),
        ctl: html`<${Seg} label=${t("settings.rows.line.name")} value=${mf.line} onChange=${setLine} options=${lineOptions()} />` },
      { tab: "modelflare", id: "default-model", name: t("settings.rows.defaultModel.name"), sub: t("settings.rows.defaultModel.sub"), keys: t("settings.rows.defaultModel.keys"),
        ctl: html`<${PickModel} value=${s.defaultModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} resetLabel=${t("settings.rows.defaultModel.auto")}
          onChange=${(m) => put({ defaultModel: m }, { defaultModel: m })} />` },
      managed && mf.connected && { tab: "modelflare", id: "image-model", name: t("settings.rows.imageModel.name"), sub: t("settings.rows.imageModel.sub"), keys: t("settings.rows.imageModel.keys"),
        ctl: html`<${PickModel} value=${s.imageModel} models=${media ? media.image : null} modelsError=${media && media.error} reloadModels=${loadMedia}
          resetLabel=${media && media.recommended.image ? t("settings.rows.autoModel", { model: shortModel(media.recommended.image) }) : t("common.auto")} label=${t("settings.rows.imageModel.name")}
          onChange=${(m) => put({ imageModel: m }, { imageModel: m })} />` },
      managed && mf.connected && { tab: "modelflare", id: "video-model", name: t("settings.rows.videoModel.name"), sub: t("settings.rows.videoModel.sub"), keys: t("settings.rows.videoModel.keys"),
        ctl: html`<${PickModel} value=${s.videoModel} models=${media ? media.video : null} modelsError=${media && media.error} reloadModels=${loadMedia}
          resetLabel=${media && media.recommended.video ? t("settings.rows.autoModel", { model: shortModel(media.recommended.video) }) : t("common.auto")} label=${t("settings.rows.videoModel.name")}
          onChange=${(m) => put({ videoModel: m }, { videoModel: m })} />` },
      { tab: "modelflare", id: "models", name: t("settings.rows.models.name"), sub: modelsError ? t("settings.rows.models.error", { error: modelsError }) : t("settings.rows.models.sub"), keys: t("settings.rows.models.keys"),
        ctl: html`<span class="val num">${models ? t("settings.rows.models.count", { count: models.length }) : "…"}</span><button type="button" class="text" onClick=${() => reloadModels().then(() => saved())}>${t("common.refresh")}</button>` },
      { tab: "modelflare", id: "console", name: t("settings.rows.console.name"), sub: t("settings.rows.console.sub"), keys: t("settings.rows.console.keys"),
        ctl: html`<a class="text" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">${t("common.openExternal")}</a>` },

      { tab: "computer", id: "cu-status", name: t("settings.rows.cuStatus.name"), sub: cu ? cu.reason : t("common.reading"), keys: t("settings.rows.cuStatus.keys"),
        ctl: html`<span class=${`dot ${cu ? (cu.available ? "ok" : "err") : ""}`}></span>` },
      cu && cu.notice && { tab: "computer", id: "cu-notice", name: t("settings.rows.cuNotice.name"), sub: cu.notice, title: cu.notice, keys: t("settings.rows.cuNotice.keys"), ctl: null },
      { tab: "computer", id: "cu-per-bot", name: t("settings.rows.cuPerBot.name"), sub: t("settings.rows.cuPerBot.sub"), keys: t("settings.rows.cuPerBot.keys"),
        ctl: bots && bots[0] && html`<button type="button" class="text" onClick=${() => onOpenBotSettings(bots[0].id, "computer")}>${t("settings.rows.cuPerBot.open")}</button>` },

      { tab: "privacy", id: "key-storage", name: t("settings.rows.keyStorage.name"), sub: t("settings.rows.keyStorage.sub"), ctl: null, keys: t("settings.rows.keyStorage.keys") },
      { tab: "privacy", id: "account-storage", name: t("settings.rows.accountStorage.name"), sub: t("settings.rows.accountStorage.sub"), ctl: null, keys: t("settings.rows.accountStorage.keys") },
      { tab: "privacy", id: "token", name: t("settings.rows.token.name"), sub: s.listen.tokenRequired ? t("settings.rows.token.required") : t("settings.rows.token.local"), keys: t("settings.rows.token.keys"),
        ctl: html`<span class=${`dot ${s.listen.tokenRequired ? "ok" : ""}`}></span>` },
      { tab: "privacy", id: "sandbox", name: t("settings.rows.sandbox.name"), sub: t("settings.rows.sandbox.sub"), ctl: null, keys: t("settings.rows.sandbox.keys") },
      { tab: "privacy", id: "screens", name: t("settings.rows.screens.name"), sub: t("settings.rows.screens.sub"), ctl: null, keys: t("settings.rows.screens.keys") },

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

      { tab: "about", id: "version", name: t("settings.rows.version.name"), keys: t("settings.rows.version.keys"), ctl: html`<span class="val">${status ? status.version : ""}</span>` },
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
  }, [s, mf, mode, p, models, modelsError, cu, status, bots, acct, invite, unread, g, media, lang, langPref]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.name} ${r.sub || ""} ${r.keys || ""}`.toLowerCase().includes(needle)) : rows.filter((r) => r.tab === tab);
  const parts = needle ? TABS.map(([id, label]) => [tabLabel(label), shown.filter((r) => r.tab === id)]).filter(([, l]) => l.length) : [["", shown]];

  const title = needle ? t("settings.searchResults") : tabLabel((TABS.find(([id]) => id === tab) || TABS[0])[1]);
  return html`<section class="settings view" data-screen="settings" key=${needle ? "search" : tab}>
    <div class="set-head"><h1 class="set-title">${title}</h1></div>
    <div class="set-body">
      ${!s && html`<div class="list"><div class="row"><${Skeleton} w="40%" /></div><div class="row"><${Skeleton} w="55%" /></div></div>`}
      ${s && !shown.length && html`<p class="set-none">${t("settings.noMatch")}</p>`}
      ${s && !needle && tab === "general" && html`<${PwshHint} />`}
      ${s && !needle && tab === "appearance" && html`<${AppearancePreview} />`}
      ${s && !needle && tab === "troubleshoot" ? html`<${TroubleshootPane} bots=${bots} desktop=${desktop} />` : parts.map(([label, list]) => html`${label && html`<div class="set-part">${label}</div>`}
        <div class="list">${list.map((r) => html`<${Row} key=${r.id} id=${r.id} name=${r.name} sub=${r.sub} title=${r.title || r.sub} flash=${flash === r.id}>${r.ctl}<//>`)}</div>`)}
    </div>
    ${rekey && html`<${Sheet} title=${t("settings.rekey.title")} onClose=${() => setRekey(false)}>
      <${KeyForm} line=${mf.line} showLine=${false} submitLabel=${t("settings.rekey.submit")} onConnected=${() => { setRekey(false); saved(); onMfChanged(); reloadModels(); }} />
    <//>`}
    ${notices && html`<${NoticesSheet} onClose=${() => setNotices(false)} />`}
    ${sheet === "login" && html`<${LoginSheet} onClose=${() => setSheet("")} onSignedIn=${(r) => { onAccount(r); onMfChanged(); reloadModels(); }} />`}
    ${sheet === "usage" && html`<${UsageSheet} onClose=${() => setSheet("")} />`}
    ${sheet === "notifications" && html`<${NotificationsSheet} onClose=${() => { setSheet(""); setUnread(null); }} />`}
  </section>`;
}
