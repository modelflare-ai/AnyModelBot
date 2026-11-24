// 「我的技能库」页面（头像菜单 › 我的技能库，地址 #/skills/library；PRD 2026-11-25 R3）：
// 库里只存一份，机器人各自开关。只有名称／描述搜索、从本机导入、查看技能和使用它的机器人；保留「我存的」来源标记。
// 「⋯」里：查看；本次导入、登记进库的条目没人开着时可「从库移除」；「我存的」走原来的「管理」；各机器人装的旧技能去它的设置里管理。
import { useEffect, useState } from "preact/hooks";
import { html, Button, Icon, MoreButton, Skeleton } from "../components/ui.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast, useStore } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";
import { fold } from "../lib/text-fold.js";
import { openSkillDetail } from "../lib/my-skills.js";
import { errorText, loadMyLibrary, myLibrary, openLocalImport, sourceLabel } from "../lib/my-library.js";

const HAN = /^\p{Script=Han}/u;
function sortItems(items, lang) {
  const ui = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
  const pinyin = new Intl.Collator("zh-CN-u-co-pinyin", { sensitivity: "base", numeric: true });
  const han = (s) => HAN.test(s.title || s.name);
  return [...items].sort((a, b) => Number(han(a)) - Number(han(b)) || (han(a) ? pinyin : ui).compare(a.title || a.name, b.title || b.name) || a.id.localeCompare(b.id));
}

/** 使用情况：{机器人} 使用中 / 暂未使用（只开着的算使用中） */
function usage(item) {
  const on = item.bots.filter((b) => b.on).map((b) => b.name).filter(Boolean);
  return on.length ? t("skillLib.usedBy", { bots: on.join(t("chat.use.sep")) }) : t("skillLib.unused");
}

/** 进库页面时默认的「当前机器人」：上次打开的那个（导入确认页上不勾选，可以只入库） */
function lastBot(bots) {
  let id = "";
  try {
    id = localStorage.getItem("amb-bot") || "";
  } catch {
    /* 读不到就不给 */
  }
  const b = (bots || []).find((x) => x.id === id && x.origin !== "catalog");
  return b ? { id: b.id, name: b.name } : null;
}

export function MyLibraryScreen({ bots }) {
  const lang = useLang();
  const lib = useStore(myLibrary);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    loadMyLibrary().catch(() => {});
  }, []);
  const items = lib.items ? sortItems(lib.items, lang) : null;
  const needle = fold(q.trim());
  const rows = items ? items.filter((i) => !needle || [i.title, i.name, i.summary, i.description].some((f) => f && fold(f).includes(needle))) : null;
  const view = (item) => openSkillDetail({ kind: "library", id: item.id, name: item.name, onChanged: () => loadMyLibrary().catch(() => {}) });
  const remove = async (item) => {
    if (!(await confirmSheet({ title: t("skillLib.removeTitle", { name: item.title || item.name }), body: t("skillLib.removeBody"), confirmLabel: t("skillLib.remove"), danger: true }))) return;
    setBusy(item.id);
    try {
      await api(`/skill-library/items/${encodeURIComponent(item.id)}/remove`, { method: "POST", body: {} });
      toast(t("skillLib.removed", { name: item.title || item.name }));
      await loadMyLibrary();
    } catch (e) {
      failed(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const menu = (item) => {
    const out = [{ label: t("skillLib.view"), onSelect: () => view(item) }];
    if (item.kind === "library") out.push({ label: t("skillLib.remove"), danger: true, disabled: !item.removable, note: item.removable ? "" : t("skillLib.errors.in_use"), onSelect: () => remove(item) });
    if (item.kind === "mine") out.push({ label: t("skillLib.manageMine"), onSelect: () => openSkillDetail({ name: item.name, kind: "mine", manage: true, onChanged: () => loadMyLibrary().catch(() => {}) }) });
    if (item.kind === "bot" && item.bots[0]) out.push({ label: t("skillLib.manageIn", { bot: item.bots[0].name }), onSelect: () => (location.hash = `/bot/${encodeURIComponent(item.bots[0].id)}/settings/skills`) });
    return out;
  };
  const importLocal = () => openLocalImport({ defaultBot: lastBot(bots) });
  return html`<section class="discover my-library" data-screen="my-library">
    <header class="discover-head">
      <h1 class="t-page">${t("skillLib.title")}</h1>
      <p>${t("skillLib.lead")}</p>
    </header>
    <div class="ml-bar">
      <label class="side-search ml-search"><${Icon} name="search" size="sm" />
        <input type="search" placeholder=${t("skillLib.search")} aria-label=${t("skillLib.search")} value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
      <${Button} onClick=${importLocal}>${t("skillLib.importLocal")}<//>
    </div>
    <div class="list ml-list" aria-busy=${!items}>
      ${lib.error && !items ? html`<div class="row"><div class="who">${t("skillLib.loadFailed")}</div><${Button} onClick=${() => loadMyLibrary().catch(() => {})}>${t("skillLib.retry")}<//></div>`
        : !items ? html`<div class="row"><${Skeleton} w="60%" /></div><div class="row"><${Skeleton} w="45%" /></div>`
        : !items.length ? html`<div class="row ml-empty"><div class="sub">${t("skillLib.empty")}</div></div>`
        : !rows.length ? html`<div class="row ml-empty"><div class="sub">${t("skillLib.noMatch")}</div><button type="button" class="text" onClick=${() => setQ("")}>${t("skillLib.clearSearch")}</button></div>`
        : rows.map((item) => html`<div class="row ml-row" key=${item.id} data-item=${item.id}>
            <button type="button" class="who ml-open" onClick=${() => view(item)}>
              <span class="name skill-name"><span>${item.title || item.name}</span>${item.title !== item.name && html`<span class="skill-file">${item.name}</span>`}</span>
              <span class="sub">${sourceLabel(item.source)}</span>
            </button>
            <div class="ctl"><span class="sub ml-use">${usage(item)}</span><${MoreButton} name=${item.title || item.name} busy=${busy === item.id} items=${menu(item)} /></div>
          </div>`)}
    </div>
    ${items && items.length > 0 && html`<p class="hint ml-hint">${t("skillLib.hint")}</p>`}
  </section>`;
}
