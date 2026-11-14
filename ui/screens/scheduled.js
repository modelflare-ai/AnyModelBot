import { useEffect, useState } from "preact/hooks";
import { html, Icon, Button, Sheet, Seg, Spinner } from "../components/ui.js";
import { RuleEditor, RuleRow } from "../components/rules.js";
import { failed, useStore } from "../lib/store.js";
import { loadRules, openScheduled, scheduled, RULES_CHANGED } from "../lib/scheduled.js";
import { sideLayout, keyOfBot } from "../lib/sections.js";
import { t, useLang } from "../lib/i18n.js";

export const newRule = () => window.dispatchEvent(new Event("amb-new-rule"));
export function ScheduledSync() {
  const lang = useLang();
  useEffect(() => {
    const load = () => loadRules().catch(() => {});
    load(); const timer = setInterval(load, 5000);
    window.addEventListener(RULES_CHANGED, load);
    return () => { clearInterval(timer); window.removeEventListener(RULES_CHANGED, load); };
  }, [lang]);
  return null;
}
export function ScheduledButton({ active }) {
  const { rules } = useStore(scheduled);
  const count = rules.filter((r) => r.needsAttention).length;
  const label = t(count === 1 ? "scheduled.attentionOne" : count ? "scheduled.attention" : "scheduled.title", { count });
  return html`<button type="button" class=${`nav-item scheduled-nav${active ? " sel" : ""}`} title=${label} aria-label=${label} aria-current=${active ? "page" : undefined} onClick=${openScheduled}><${Icon} name="clock" size="md" /><span class="label">${t("scheduled.title")}</span>${count > 0 && html`<span class="scheduled-dot" aria-hidden="true"></span>`}</button>`;
}
export function NewRuleHost({ bots }) {
  const [open, setOpen] = useState(false);
  const [botId, setBotId] = useState("");
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    const show = () => { setEditing(null); setBotId(""); setOpen(true); };
    const edit = (event) => { setEditing(event.detail); setBotId(event.detail.botId); setOpen(true); };
    window.addEventListener("amb-new-rule", show);
    window.addEventListener("amb-edit-rule", edit);
    return () => { window.removeEventListener("amb-new-rule", show); window.removeEventListener("amb-edit-rule", edit); };
  }, []);
  if (!open) return null;
  return botId ? html`<${RuleEditor} key=${editing?.id || botId} botId=${botId} rule=${editing} onClose=${() => setOpen(false)} onSaved=${() => setOpen(false)} />` : html`<${Sheet} title=${t("scheduled.chooseBot")} onClose=${() => setOpen(false)}><div class="rule-bot-picker">${bots.map((bot) => html`<button type="button" class="row clickable" key=${bot.id} onClick=${() => setBotId(bot.id)}>${bot.name}</button>`)}</div><div class="actions"><${Button} onClick=${() => setOpen(false)}>${t("common.cancel")}<//></div><//>`;
}
export function ScheduledPage({ bots }) {
  const data = useStore(scheduled);
  const layout = useStore(sideLayout);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState("");
  const keys = layout?.sections?.flatMap((s) => s.items) || [];
  const position = (bot) => { const i = keys.indexOf(keyOfBot(bot)); return i < 0 ? keys.length : i; };
  const ordered = [...bots].sort((a, b) => position(a) - position(b));
  const count = data.rules.filter((r) => r.needsAttention).length;
  const refresh = () => loadRules().catch(failed);
  const rows = data.rules.filter((r) => filter !== "needs" || r.needsAttention);
  return html`<section class="scheduled-page" data-screen="scheduled">
    <header class="scheduled-head"><div><h1>${t("scheduled.title")}</h1><p class="hint">${t("scheduled.description", { zone: data.timeZone })}</p></div><${Button} variant="primary" icon="plus" onClick=${newRule}>${t("scheduled.newRule")}<//></header>
    <${Seg} label=${t("scheduled.title")} options=${[["all", `${t("scheduled.all")} ${data.rules.length}`], ["needs", `${t("scheduled.needs")} ${count}`]]} value=${filter} onChange=${setFilter} />
    ${!data.loaded && html`<${Spinner} />`}
    ${data.loaded && !data.rules.length && html`<div class="empty-state"><p>${t("scheduled.empty")} ${t("scheduled.example")}</p><${Button} icon="plus" onClick=${newRule}>${t("scheduled.newRule")}<//></div>`}
    ${ordered.map((bot) => {
      const rules = rows.filter((r) => r.botId === bot.id).sort((a, b) => Number(a.mode === "off") - Number(b.mode === "off") || (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity) || a.createdAt - b.createdAt);
      return rules.length ? html`<section class="scheduled-group" key=${bot.id}><h2>${bot.name}</h2>${rules.map((rule) => html`<${RuleRow} key=${rule.id} full rule=${rule} timeZone=${data.timeZone} open=${open === rule.id} onToggle=${() => setOpen(open === rule.id ? "" : rule.id)} onChanged=${refresh} />`)}</section>` : null;
    })}
  </section>`;
}
