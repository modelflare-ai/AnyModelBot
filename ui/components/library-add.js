// 机器人设置 › 技能 › 「从技能库添加…」（PRD 2026-11-25 R3）：从「我的技能库」里选几项，只用在当前机器人上。
// 已经和这个机器人有关系的（开着、关着的）标「已在此机器人上」，不重复添加；关着的在列表里用开关打开。
// 每项各自报告：同名已开着、容量满了都就近说原因，其他项照常添加。
import { useEffect, useState } from "preact/hooks";
import { html, Button, Icon, Sheet, Spinner } from "./ui.js";
import { api } from "../lib/api.js";
import { failed, toast, useStore } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";
import { fold } from "../lib/text-fold.js";
import { closeLibraryAdd, errorText, libraryAdd, loadMyLibrary, myLibrary, reasonText, sourceLabel } from "../lib/my-library.js";
import { setBotSkills } from "../lib/usage.js";

export function LibraryAddHost() {
  useLang();
  const req = useStore(libraryAdd);
  const lib = useStore(myLibrary);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    setQ(""); setPicked(new Set()); setErrors({});
    if (req) loadMyLibrary().catch((e) => failed(errorText(e)));
  }, [req?.at]);
  if (!req) return null;
  const botId = req.botId;
  const close = () => !busy && closeLibraryAdd();
  const items = lib.items || null;
  const needle = fold(q.trim());
  const rows = (items || []).filter((i) => !needle || [i.title, i.name, i.summary].some((f) => f && fold(f).includes(needle)));
  const inBot = (i) => i.bots.some((b) => b.id === botId);
  const toggle = (id) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const add = async () => {
    setBusy(true);
    try {
      const r = await api(`/bots/${encodeURIComponent(botId)}/skill-library`, { method: "POST", body: { ids: [...picked] } });
      setBotSkills(botId, r.skills);
      const bad = r.results.filter((x) => !x.ok);
      const ok = r.results.length - bad.length;
      loadMyLibrary().catch(() => {});
      if (!bad.length) {
        toast(t("skillLib.add.done", { count: ok }));
        closeLibraryAdd();
        return;
      }
      // 没加上的留在弹窗里，就近说原因
      setErrors(Object.fromEntries(bad.map((x) => [x.id, reasonText(x.code, x.code === "reserved_name" ? "" : x.name || "")])));
      setPicked(new Set(bad.map((x) => x.id)));
      toast(t("skillLib.add.partial", { ok, failed: bad.length }), ok ? "ok" : "err");
    } catch (e) {
      failed(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return html`<${Sheet} title=${t("skillLib.add.title")} wide framed class="library-add" onClose=${close}
    footer=${html`<div class="actions"><span class="hint la-count">${t("skillLib.add.selected", { count: picked.size })}</span><span class="grow"></span>
      <${Button} disabled=${busy} onClick=${close}>${t("common.cancel")}<//><${Button} variant="primary" loading=${busy} disabled=${busy || !picked.size} onClick=${add}>${t("skillLib.add.confirm")}<//></div>`}>
    <p class="hint">${t("skillLib.add.sub", { bot: req.botName || "" })}</p>
    <div class="search skill-search la-search"><${Icon} name="search" size="sm" />
      <input type="search" data-autofocus value=${q} placeholder=${t("skillLib.search")} aria-label=${t("skillLib.search")} onInput=${(e) => setQ(e.target.value)} /></div>
    <div class="list la-list">
      ${!items ? html`<div class="row"><${Spinner} /></div>`
        : !items.length ? html`<div class="row"><div class="sub">${t("skillLib.add.none")}</div></div>`
        : !rows.length ? html`<div class="row"><div class="sub">${t("skillLib.noMatch")}</div></div>`
        : rows.map((i) => {
            const here = inBot(i);
            return html`<label class=${`row la-row${here ? " here" : ""}`} key=${i.id}>
              <input type="checkbox" disabled=${here || busy} checked=${here || picked.has(i.id)} onChange=${() => toggle(i.id)} />
              <span class="who"><span class="name skill-name"><span>${i.title || i.name}</span>${i.title !== i.name && html`<span class="skill-file">${i.name}</span>`}</span>
                <span class="sub">${here ? t("skillLib.add.inBot") : sourceLabel(i.source)}</span>
                ${errors[i.id] && html`<span class="sub la-err" role="alert">${errors[i.id]}</span>`}</span>
            </label>`;
          })}
    </div>
  <//>`;
}
