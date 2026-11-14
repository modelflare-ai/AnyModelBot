// 应用页（头像菜单 › 连接应用）：把常用应用连上，机器人就能替你读写其中的内容。
// 推荐应用是内置的 10 个连接器（按界面语言置顶），我的 MCP 是自己添加的自定义连接器；每个应用只有一张卡片，账号都归在它下面。
// 页面和发现页同一种结构：占满主区、内容列居中、顶上一条通栏的拖动区。连接、管理、自定义连接器都是弹窗（components/app-dialogs.js）。
import { useEffect, useMemo, useState } from "preact/hooks";
import { html, Button, Icon, Seg, Skeleton, Spinner } from "../components/ui.js";
import { AppMark } from "../components/app-mark.js";
import { ATTENTION, appsStore, builtinMethod, builtinName, loadApps, matchesApp, methodLabel, openConnect, openCustom, openManage, orderCatalog, stateText, stateTone } from "../lib/apps.js";
import { useStore } from "../lib/store.js";
import { has, t, useLang } from "../lib/i18n.js";

/** 卡片上的状态：已连接（多个账号时带数量）、或者要处理的状态带一个提醒点 */
function CardState({ view }) {
  const attention = ATTENTION.includes(view.state);
  const tools = view.accounts.reduce((n, a) => Math.max(n, a.tools), 0);
  // 内置应用：已连接 + 账号名（多个账号时是数量）；自定义连接器：已连接 + 工具数；其余是状态
  const text = view.state !== "connected" || view.custom ? stateText(view.state, tools) : view.accounts.length > 1 ? t("apps.card.connectedAccounts", { n: view.accounts.length }) : `${t("apps.state.connected")}${view.accounts[0]?.label ? ` · ${view.accounts[0].label}` : ""}`;
  return html`<span class=${`apps-state ${stateTone(view.state)}`}>${attention && html`<span class="dot warn"></span>`}${view.state === "testing" && html`<${Spinner} />`}${text}</span>`;
}

function BuiltinCard({ entry, view, lang }) {
  const name = builtinName(entry, lang);
  const linked = view && view.accounts.length > 0;
  const open = () => (linked ? openManage(entry.id) : openConnect(entry.id));
  return html`<div class="apps-card" role="group" aria-label=${name}>
    <button type="button" class="apps-card-main" onClick=${open}>
      <span class="apps-card-head"><${AppMark} app=${entry.id} name=${name} /><span class="apps-card-name">${name}</span></span>
      <span class="apps-card-desc">${has(`apps.catalog.${entry.id}.desc`) ? t(`apps.catalog.${entry.id}.desc`) : ""}</span>
      <span class="apps-card-meta">${methodLabel(builtinMethod(entry))}${has(`apps.catalog.${entry.id}.requires`) ? html` · <span>${t(`apps.catalog.${entry.id}.requires`)}</span>` : ""}</span>
    </button>
    <span class="apps-card-foot">
      ${linked ? html`<${CardState} view=${view} />` : html`<span></span>`}
      <${Button} size="sm" variant=${linked ? undefined : "primary"} onClick=${open}>${t(linked ? "apps.card.manage" : "apps.card.connect")}<//>
    </span>
  </div>`;
}

function CustomCard({ view }) {
  const c = view.config || {};
  const open = () => openManage(view.key);
  return html`<div class="apps-card" role="group" aria-label=${view.name}>
    <button type="button" class="apps-card-main" onClick=${open}>
      <span class="apps-card-head"><${AppMark} name=${view.name} /><span class="apps-card-name">${view.name}</span></span>
      <span class="apps-card-desc">${t(c.transport === "stdio" ? "apps.custom.type.local" : "apps.custom.type.remote")} · ${methodLabel(view.accounts[0]?.method || "none")}</span>
      <span class="apps-card-meta mono">${c.transport === "stdio" ? [c.command, ...(c.args || [])].join(" ") : c.url}</span>
    </button>
    <span class="apps-card-foot"><${CardState} view=${view} /><${Button} size="sm" onClick=${open}>${t("apps.card.manage")}<//></span>
  </div>`;
}

function Skeletons() {
  return html`<div class="apps-grid">${[0, 1, 2, 3, 4, 5].map((i) => html`<div key=${i} class="apps-card skel-card"><${Skeleton} w="40%" /><${Skeleton} w="90%" /><${Skeleton} w="55%" /></div>`)}</div>`;
}

export function AppsScreen({ initialTab = "all" }) {
  const lang = useLang();
  const s = useStore(appsStore);
  const [tab, setTab] = useState(initialTab === "connected" ? "connected" : "all");
  const [q, setQ] = useState("");
  useEffect(() => {
    loadApps();
    // 测试、授权在后台变化（测试中 → 已连接）：停在这一页时隔一会儿取一次
    const timer = setInterval(loadApps, 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setTab(initialTab === "connected" ? "connected" : "all"), [initialTab]);

  const viewOf = (key) => s.apps.find((a) => a.key === key);
  const builtin = useMemo(() => orderCatalog(s.catalog, lang), [s.catalog, lang]);
  const connectedOnly = tab === "connected";
  const shownBuiltin = builtin.filter((e) => {
    const v = viewOf(e.id);
    if (connectedOnly && !(v && v.accounts.length)) return false;
    return matchesApp(q, { entry: e, view: v, lang });
  });
  const custom = s.apps.filter((a) => a.custom);
  const shownCustom = custom.filter((v) => (!connectedOnly || v.enabled) && matchesApp(q, { entry: null, view: v, lang }));
  const full = s.customCount >= s.maxCustom;
  const searching = !!q.trim();
  const nothing = !shownBuiltin.length && !shownCustom.length;

  return html`<section class="discover apps" data-screen="apps">
    <header class="discover-head">
      <h1 class="t-page">${t("apps.title")}</h1>
      <p>${t("apps.lead")}</p>
    </header>
    <div class="apps-bar">
      <${Seg} label=${t("apps.title")} value=${tab} onChange=${setTab} options=${[["all", t("apps.tab.all")], ["connected", t("apps.tab.connected")]]} />
      <label class="side-search apps-search"><${Icon} name="search" size="sm" />
        <input type="search" placeholder=${t("apps.search")} aria-label=${t("apps.search")} value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
    </div>
    ${!s.loaded && !s.error && html`<section class="discover-sec"><h2 class="discover-part">${t("apps.suggested")}</h2><${Skeletons} /></section>`}
    ${!s.loaded && s.error && html`<div class="apps-empty"><p>${t("apps.loadFailed")}</p><${Button} onClick=${loadApps}>${t("apps.fix.retry")}<//></div>`}
    ${s.loaded && html`
      ${shownBuiltin.length > 0 && html`<section class="discover-sec">
        <h2 class="discover-part">${t("apps.suggested")}</h2>
        <div class="apps-grid">${shownBuiltin.map((e) => html`<${BuiltinCard} key=${e.id} entry=${e} view=${viewOf(e.id)} lang=${lang} />`)}</div>
      </section>`}
      ${(!searching || shownCustom.length > 0) && !(connectedOnly && !shownCustom.length) && html`<section class="discover-sec">
        <div class="apps-sec-head"><h2 class="discover-part">${t("apps.mine")}</h2>
          <${Button} size="sm" icon="plus" disabled=${full} title=${full ? t("apps.limit", { max: s.maxCustom }) : ""} onClick=${() => openCustom()}>${t("apps.addCustom")}<//></div>
        ${full && html`<p class="hint">${t("apps.limit", { max: s.maxCustom })}</p>`}
        ${shownCustom.length > 0
          ? html`<div class="apps-grid">${shownCustom.map((v) => html`<${CustomCard} key=${v.key} view=${v} />`)}</div>`
          : html`<div class="apps-empty in-sec"><p>${t("apps.customEmpty")}</p><${Button} disabled=${full} onClick=${() => openCustom()}>${t("apps.addCustom")}<//></div>`}
      </section>`}
      ${nothing && searching && html`<div class="apps-empty"><p>${t("apps.searchEmpty")}</p><${Button} disabled=${full} onClick=${() => openCustom()}>${t("apps.addCustom")}<//></div>`}
      ${nothing && !searching && connectedOnly && html`<div class="apps-empty"><p>${t("apps.connectedEmpty")}</p><${Button} onClick=${() => setTab("all")}>${t("apps.goConnect")}<//></div>`}
    `}
  </section>`;
}
