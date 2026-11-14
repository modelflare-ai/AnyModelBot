// 右侧面板：主区是对话流，右边一排标签页承载这个机器人的功能（参考 vibe coding 平台、Codex、Grok Bot 的右栏）。
// - 专业 Bot（目录 Bot：影视创作室、美股研报……）第一个标签是「工作台」，就是它的专属界面，打开 Bot 时面板默认开着、停在这个标签上。
//   界面（沙箱 iframe）和桥接归主区的 BotAppScreen 管（screens/bot-app.js）：这里只给一块宿主（onHost），它用 Portal 把界面渲染进来。
//   切到别的标签时宿主不卸载（只是藏起来），回来还是原来的分页和选中项。
// - 每个机器人都有「概览」（渠道、待审批、最近会话；目录 Bot 再列出它能做什么、技能、权限）、「任务」、「记忆」（screens/info-panel.js）。
//   还没有实例的目录 Bot 只有工作台和概览。只有当前标签挂载，看不见的标签不轮询。
// 面板放在外壳的第三列（main.js）：开合、分隔条调宽、窄窗口的抽屉、Windows 标题栏的角都和原来的信息面板一样；
// 有工作台时更宽（.app.panel-wide 用 --work-w），宽度单独记在 prefs.workW。
import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { html, Icon } from "../components/ui.js";
import { MemoryTab, OverviewTab, TasksTab } from "./info-panel.js";
import { t } from "../lib/i18n.js";
import { ResourcePreview } from "./resource-preview.js";

/** 面板有哪些标签：工作台只给有专属界面的目录 Bot（app），任务、记忆要有实例（bot） */
export const panelTabs = ({ app, bot, resourcesOnly = false }) => resourcesOnly ? ["resources"] : [...(app ? ["app"] : []), "overview", "resources", ...(bot ? ["tasks", "memory"] : [])];

/**
 * 把 children 渲染进另一处的 DOM 节点（into）：没有 preact/compat 的 createPortal，用一个独立的 render 根代替。
 * into 换了或卸载时清空原来那处。里面不用 context（这个界面也没有用 context 的地方）。
 */
export function Portal({ into, children }) {
  useLayoutEffect(() => {
    if (into) render(children, into);
  });
  useLayoutEffect(() => () => into && render(null, into), [into]);
  return null;
}

/**
 * 标签条放不放得下：顶栏一行里除了标签还有右边的按钮（Windows 上还要让出窗口按钮的宽度 --caption-w），
 * 面板窄、标签多或译文长时放不下，就把标签条换到顶栏下面单独一行（.tabs-wrap），不让标签滚出看不见。
 * 量的是标签本身要多宽（不随换不换行变化）和这一行除去按钮还剩多宽，所以不会来回跳
 */
function useTabsWrap(tabs) {
  const head = useRef(null);
  const strip = useRef(null);
  const [on, setOn] = useState(false);
  useLayoutEffect(() => {
    const h = head.current;
    const s = strip.current;
    if (!h || !s || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const hs = getComputedStyle(h);
      const ss = getComputedStyle(s);
      const gap = (cs) => parseFloat(cs.columnGap) || 0;
      const items = [...s.children];
      const need = items.reduce((w, el) => w + el.offsetWidth, 0) + gap(ss) * Math.max(0, items.length - 1) + (parseFloat(ss.paddingLeft) || 0) + (parseFloat(ss.paddingRight) || 0);
      const others = [...h.children].filter((el) => el !== s && !el.classList.contains("grow") && el.offsetWidth > 0);
      const avail = h.clientWidth - (parseFloat(hs.paddingLeft) || 0) - (parseFloat(hs.paddingRight) || 0) - others.reduce((w, el) => w + el.offsetWidth + gap(hs), 0);
      setOn(need > avail + 1);
    };
    const ro = new ResizeObserver(check);
    ro.observe(h);
    check();
    return () => ro.disconnect();
  }, [tabs.join()]);
  return { head, strip, on };
}

/**
 * tabs：panelTabs() 的结果；tab：当前标签（不在 tabs 里时用第一个）；onTab(id) 切换。
 * entry：目录 Bot 的条目（概览里的说明）；onHost(el)：工作台那块宿主挂上 / 卸下时调用（ref 回调）。
 */
export function WorkPanel({ bot, entry, tabs, tab, onTab, leaving, onClose, expanded, onExpand, onOpenBotSettings, onOpenChat, onOpenConnections, onHost, resources, onSelectResource, onRemoveResource }) {
  const cur = tabs.includes(tab) ? tab : tabs[0];
  const wrap = useTabsWrap(tabs);
  // 标签条的键盘：← → 换到相邻的标签（选中即切换），Home / End 到两头
  const onKey = (e) => {
    const i = tabs.indexOf(cur);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const id = tabs[(next + tabs.length) % tabs.length];
    onTab(id);
    requestAnimationFrame(() => document.getElementById(`work-tab-${id}`)?.focus());
  };
  const pane = (id) => ({ id: `work-pane-${id}`, role: "tabpanel", "aria-labelledby": `work-tab-${id}` });
  // leaving：关上后还在播滑出的那一小会儿（main.js 的 usePresence），不再接收操作
  return html`<aside class=${`panel${tabs.includes("app") ? " with-app" : ""}${leaving ? " leaving" : ""}`} aria-label=${t("info.aria")} inert=${leaving || undefined}>
    <div class=${`panel-head${wrap.on ? " tabs-wrap" : ""}`} ref=${wrap.head}>
      <div class="tabs bare panel-tabs" role="tablist" ref=${wrap.strip} aria-label=${t("info.tabsLabel")} onKeyDown=${onKey}>
        ${tabs.map((id) => html`<button type="button" role="tab" key=${id} id=${`work-tab-${id}`} aria-controls=${`work-pane-${id}`} aria-selected=${cur === id} tabindex=${cur === id ? 0 : -1}
          onClick=${() => onTab(id)}>${t(`info.tab.${id}`)}</button>`)}
      </div>
      <span class="grow"></span>
      ${tabs.includes("app") && html`<button type="button" class="text work-expand" aria-pressed=${!!expanded} onClick=${() => onExpand(!expanded)}>${t(expanded ? "info.restoreWorkspace" : "info.expandWorkspace")}</button>`}
      ${bot && html`<button type="button" class="icon-btn" title=${t("info.botSettings")} aria-label=${t("info.botSettings")} onClick=${onOpenBotSettings}><${Icon} name="gear" size="md" /></button>`}
      <button type="button" class="icon-btn panel-close" title=${t("info.closeTitle")} aria-label=${t("info.closeAria")} onClick=${onClose}><${Icon} name="close" size="md" /></button>
    </div>
    ${tabs.includes("app") && html`<div class="work-host" ...${pane("app")} hidden=${cur !== "app"} ref=${onHost}></div>`}
    ${cur === "resources" && html`<div class="preview-pane" ...${pane("resources")}><${ResourcePreview} state=${resources} onSelect=${onSelectResource} onRemove=${onRemoveResource} /></div>`}
    ${cur === "overview" && html`<div class="panel-body" ...${pane("overview")}><${OverviewTab} bot=${bot} entry=${entry} onOpenChat=${onOpenChat} onOpenConnections=${onOpenConnections} /></div>`}
    ${cur === "tasks" && bot && html`<div class="panel-body" ...${pane("tasks")}><${TasksTab} bot=${bot} onOpenChat=${onOpenChat} /></div>`}
    ${cur === "memory" && bot && html`<div class="panel-body" ...${pane("memory")}><${MemoryTab} bot=${bot} /></div>`}
  </aside>`;
}
