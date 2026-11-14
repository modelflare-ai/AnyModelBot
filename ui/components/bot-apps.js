// 机器人设置的「应用」一节：这个机器人能用哪些已连接的应用、每个应用里的哪些工具。
// 默认「使用全部已连接的应用」（之后新连的也算）；关掉后只用选定的。每个应用可以展开，按工具开关，
// 工具旁写着它的类别（只读 / 写入 / 删除 / 对外发送）；点过「以后这个工具都允许」的在这里能看到、能撤销。
// 应用页的「谁能用」是同一份设置的另一头：应用那边没把这个机器人算进去的，这里勾不了。
import { useEffect, useState } from "preact/hooks";
import { html, Button, Icon, Spinner, Switch } from "./ui.js";
import { AppMark } from "./app-mark.js";
import { ATTENTION, appLabel, appsStore, loadApps, openConnect, openCustom, repairActions, stateText, stateTone } from "../lib/apps.js";
import { useStore } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";

/** 一次最多直接列出这么多工具，其余的展开「显示全部」再看（上百个工具的服务器不把设置页撑得没法滚） */
const TOOLS_SHOWN = 40;

function ToolRows({ view, apps, onChange }) {
  const [all, setAll] = useState(false);
  const off = apps.toolsOff[view.key] || [];
  const granted = apps.alwaysAllow[view.key] || {};
  const tools = all ? view.tools : view.tools.slice(0, TOOLS_SHOWN);
  const toggle = (name, on) => {
    const next = on ? off.filter((x) => x !== name) : [...off, name];
    const toolsOff = { ...apps.toolsOff };
    if (next.length) toolsOff[view.key] = next;
    else delete toolsOff[view.key];
    onChange({ ...apps, toolsOff });
  };
  const revoke = (name) => {
    const rest = { ...granted };
    delete rest[name];
    const alwaysAllow = { ...apps.alwaysAllow };
    if (Object.keys(rest).length) alwaysAllow[view.key] = rest;
    else delete alwaysAllow[view.key];
    onChange({ ...apps, alwaysAllow });
  };
  return html`<ul class="apps-tools in-bot">
    ${tools.map((x) => html`<li key=${x.name}>
      <label class="sheet-check"><input type="checkbox" checked=${!off.includes(x.name)} onChange=${(e) => toggle(x.name, e.target.checked)} />
        <span class="apps-tool-text"><span class="apps-tool-name mono">${x.title || x.name}</span>${x.description && html`<span class="hint">${x.description}</span>`}</span></label>
      <span class="apps-tool-side">
        <span class="badge">${t(`apps.category.${x.category}`)}</span>
        ${granted[x.name] === x.hash && html`<span class="apps-granted">${t("apps.bot.always")}<button type="button" class="text" onClick=${() => revoke(x.name)}>${t("apps.bot.revoke")}</button></span>`}
      </span>
    </li>`)}
    ${!all && view.tools.length > TOOLS_SHOWN && html`<li><button type="button" class="text" onClick=${() => setAll(true)}>${t("apps.bot.showAll", { n: view.tools.length })}</button></li>`}
  </ul>`;
}

export function BotApps({ bot, apps, onPut, onOpenApps, onOpenSettings }) {
  const lang = useLang();
  const s = useStore(appsStore);
  const [open, setOpen] = useState("");
  useEffect(() => {
    loadApps();
  }, []);
  // 目录 Bot 没声明「使用你授权的账号」这项权限：它用不了任何应用
  const barred = !!bot.app && !(bot.app.permissions || []).includes("accounts");
  const usable = s.apps.filter((v) => (v.custom ? v.enabled : v.accounts.length > 0));
  const reachable = (v) => v.access === "all" || v.access.includes(bot.id);
  const mine = usable.filter((v) => reachable(v) && (apps.mode === "all" || apps.selected.includes(v.key)));
  const attention = mine.some((v) => ATTENTION.includes(v.state));
  const setMode = (allOn) => onPut({ apps: allOn ? { ...apps, mode: "all" } : { ...apps, mode: "selected", selected: usable.filter(reachable).map((v) => v.key) } });
  const pick = (key, on) => onPut({ apps: { ...apps, selected: on ? [...new Set([...apps.selected, key])] : apps.selected.filter((x) => x !== key) } });
  const fix = (v, id) => {
    if (id === "network") return onOpenSettings?.("network");
    if (id === "logs") return onOpenSettings?.("troubleshoot");
    if (v.custom) return openCustom(v.accounts[0].id);
    const account = v.accounts.find((a) => a.state === v.state) || v.accounts[0];
    openConnect(v.app, { accountId: account?.id });
  };
  return html`<div class="list-head" id="bot-apps">${t("apps.bot.head")}${attention && html`<span class="dot warn apps-head-dot" title=${t("apps.attention")}></span>`}</div>
    ${barred && html`<p class="set-note">${t("apps.bot.barred")}</p>`}
    ${!barred && html`<div class="list">
      <div class="row"><div class="who"><div class="name">${t("apps.bot.useAll")}</div><div class="sub">${t(apps.mode === "all" ? "apps.bot.useAllSub" : "apps.bot.selectedSub")}</div></div>
        <div class="ctl"><${Switch} value=${apps.mode === "all"} label=${t("apps.bot.useAll")} onChange=${setMode} /></div></div>
      ${!s.loaded && html`<div class="row"><${Spinner} /></div>`}
      ${s.loaded && usable.map((v) => {
        const name = appLabel(v, s.catalog, lang);
        const can = reachable(v);
        const on = can && (apps.mode === "all" || apps.selected.includes(v.key));
        const tools = v.tools.length;
        const expanded = open === v.key;
        const actions = ATTENTION.includes(v.state) ? repairActions(v.state, { custom: v.custom, method: v.accounts[0]?.method }) : [];
        return html`<div key=${v.key} class=${`row apps-bot-row${on ? "" : " off"}`}>
          <${AppMark} app=${v.custom ? undefined : v.app} name=${name} size="sm" />
          <div class="who">
            <label class="sheet-check apps-bot-name">${apps.mode === "selected" && html`<input type="checkbox" checked=${on} disabled=${!can} onChange=${(e) => pick(v.key, e.target.checked)} />`}<span class="name">${name}</span></label>
            <div class="sub"><span class=${`apps-state ${stateTone(v.state)}`}>${stateText(v.state, tools)}</span>${!can ? ` · ${t("apps.bot.notShared")}` : ""}</div>
          </div>
          <div class="ctl">
            ${actions.map((a) => html`<${Button} key=${a.id} size="sm" onClick=${() => fix(v, a.id)}>${a.label}<//>`)}
            ${on && tools > 0 && html`<button type="button" class="icon-btn" aria-expanded=${expanded} aria-label=${t("apps.bot.tools", { name })} title=${t("apps.bot.tools", { name })} onClick=${() => setOpen(expanded ? "" : v.key)}><${Icon} name=${expanded ? "chevDown" : "chevRight"} size="sm" /></button>`}
          </div>
          ${on && expanded && html`<${ToolRows} view=${v} apps=${apps} onChange=${(next) => onPut({ apps: next })} />`}
        </div>`;
      })}
      ${s.loaded && !usable.length && html`<div class="row"><div class="who"><div class="sub">${t("apps.bot.none")}</div></div></div>`}
      <div class="row"><div class="who"></div><div class="ctl"><${Button} onClick=${onOpenApps}>${t("apps.bot.more")}<//></div></div>
    </div>`}`;
}
