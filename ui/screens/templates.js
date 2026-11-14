import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Button, Icon, Notice, Switch, autoGrow } from "../components/ui.js";
import { BotAvatar, AvatarPicker } from "../components/avatar.js";
import { ModelButton } from "./bot-settings.js";
import { shortModel, sameModel, strategyOf, useModelInfoRaw } from "../components/model-picker.js";
import { api } from "../lib/api.js";
import { failed, toast, useStore } from "../lib/store.js";
import { getLang, t, useLang } from "../lib/i18n.js";
import { TEMPLATE_META, TEMPLATE_ALIASES, templateRequestId, templateOf, availableName, recommendTemplate, capabilityState } from "../lib/templates.js";
import { templateFlow, blankBotDraft, clearTemplatePreview } from "../lib/template-flow.js";
import { appsStore, loadApps, builtinName } from "../lib/apps.js";
import { fillComposer, guide, isActive } from "../lib/guide.js";
const appName = (apps, id, lang) => builtinName(apps.catalog.find((a) => a.id === id), lang) || id;
const back = () => { location.hash = "/templates"; };
const list = (children) => html`<div class="list">${children}</div>`;
export function TemplateGallery({ bots }) {
  const lang = useLang(); const flow = useStore(templateFlow); const apps = useStore(appsStore); const root = useRef(null);
  useEffect(() => { loadApps(); }, []);
  useLayoutEffect(() => { const el = root.current; el.scrollTop = flow.scroll; return () => templateFlow.set((s) => ({ ...s, scroll: el.scrollTop })); }, []);
  const categories = ["all", "writing", "work", "learning", "coding"];
  const items = TEMPLATE_META.filter((x) => flow.category === "all" || x.category === flow.category).map((x) => templateOf(x.id));
  const preview = (id) => { location.hash = `/templates/${id}`; };
  return html`<section class="discover templates" ref=${root} data-screen="templates">
    <header class="discover-head">${flow.entry && html`<button type="button" class="text" onClick=${() => { location.hash = flow.entry === "discover" ? "/discover" : "/new"; }}>${t(flow.entry === "discover" ? "templates.backDiscover" : "templates.backNew")}</button>`}
      <h1 class="t-page">${t("templates.title")}</h1><p>${t("templates.lead")}</p></header>
    <div class="template-categories" role="group" aria-label=${t("templates.category")}>
      ${categories.map((c) => html`<button type="button" class=${`btn sm${flow.category === c ? " primary" : " ghost"}`} aria-pressed=${flow.category === c} onClick=${() => templateFlow.set((s) => ({ ...s, category: c, scroll: 0 }))}>${t(`templates.categories.${c}`)}</button>`)}</div>
    <div class="template-grid">${items.map((item) => html`<article class="template-card" key=${item.id}>
      <button type="button" class="template-card-main" onClick=${() => preview(item.id)} aria-label=${t("templates.addLabel", { name: item.name, category: t(`templates.categories.${item.category}`) })}>
        <span class="template-card-heading"><${BotAvatar} char=${item.avatar} size=${48} /><span><b>${item.name}</b><small>${t(`templates.categories.${item.category}`)}${bots.some((b) => (TEMPLATE_ALIASES[b.templateId] || b.templateId) === item.id) ? ` · ${t("templates.addedBefore")}` : ""}</small></span></span>
        <span class="template-description">${item.desc}</span><span class="template-sample">${t("templates.try", { prompt: item.sample })}</span>
        <span class="template-meta">${item.appIds.length ? html`<span title=${item.appIds.map((id) => appName(apps, id, lang)).join(", ")}>${t("templates.worksWith", { apps: item.appIds.map((id) => appName(apps, id, lang)).join(", ") })}</span>` : null}
          ${item.rule && html`<span>${t("templates.includesRule")}</span>`}</span></button>
      <button type="button" class="btn ghost sm template-add" onClick=${() => preview(item.id)} aria-label=${t("templates.addLabel", { name: item.name, category: t(`templates.categories.${item.category}`) })}>${t("templates.add")}</button>
    </article>`)}</div></section>`;
}
export function TemplatePreview({ id, bots, models, modelsError, reloadModels, defaultModel, account, onCreated }) {
  useLang(); const item = templateOf(id); const info = useModelInfoRaw(); const g = useStore(guide); const apps = useStore(appsStore);
  const [draft, setDraft] = useState(() => {
    const existing = templateFlow.get().preview;
    if (existing?.id === id) return existing;
    if (!item) return null;
    const name = availableName(item.name, bots);
    return { id, name, persona: item.persona, avatar: item.avatar, model: "", memory: true, initialName: name, initialPersona: item.persona,
      baseName: item.name, automaticName: name !== item.name, conflict: name !== item.name ? item.name : "", modelTouched: false, requestId: templateRequestId(), busy: false };
  });
  const prompt = useRef(null); const nameRef = useRef(null);
  const [timeZone, setTimeZone] = useState("");
  useEffect(() => {
    if (!item?.rule) return;
    let alive = true;
    api("/rules/preview", { method: "POST", body: { schedule: item.rule.schedule } }).then((d) => { if (alive) setTimeZone(d.schedule.tz); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  useEffect(() => { loadApps(); }, []);
  useLayoutEffect(() => { templateFlow.set((s) => ({ ...s, preview: draft })); }, [draft]);
  useEffect(() => autoGrow(prompt.current, 1000), [draft?.persona]);
  const rec = useMemo(() => item ? !g.loaded ? { model: "", reason: "unavailable" } : recommendTemplate(item, models, info, strategyOf(account), defaultModel, isActive(g)) : null, [id, models, info, account?.keyQuality?.strategy, defaultModel, g.loaded, g.hidden, g.seen]);
  useEffect(() => { if (rec && !draft?.modelTouched && !draft?.busy) setDraft((d) => ({ ...d, model: rec.model })); }, [rec?.model, rec?.reason]);
  const patch = (value) => setDraft((d) => { const next = { ...d, ...value }; templateFlow.set((s) => ({ ...s, preview: next })); return next; });
  if (!item || !draft) return html`<section class="empty-state"><p>${t("templates.errors.missing")}</p><button class="btn" onClick=${back}>${t("templates.back")}</button></section>`;
  const effective = draft.model || defaultModel;
  const validModel = !!effective && (models?.some((m) => sameModel(m, effective)) || (!!modelsError && !draft.model && !!defaultModel));
  const capability = capabilityState(item, effective, info);
  const added = async (event) => {
    event.preventDefault(); if (draft.busy || !draft.name.trim() || !validModel) return;
    const name = availableName(draft.automaticName ? draft.baseName : draft.name, bots); const snapshot = { ...draft, name, busy: true };
    if (name !== draft.name) snapshot.conflict = draft.name;
    setDraft(snapshot); templateFlow.set((s) => ({ ...s, preview: snapshot }));
    try {
      const result = await api("/bots/from-template", { method: "POST", body: { templateId: id, requestId: draft.requestId, name, systemPrompt: draft.persona,
        avatar: draft.avatar, defaultModel: draft.model, memoryEnabled: draft.memory, ...(draft.automaticName ? { nameBase: draft.baseName } : {}) } });
      clearTemplatePreview(); blankBotDraft.set(null); fillComposer(result.sample, result.bot.id);
      await onCreated(result.bot);
      const layout = await api("/sidebar-layout").catch(() => ({}));
      const group = layout.layout?.sections.find((s) => s.default);
      const groupName = group?.name || t(group?.preset === "latest" ? "botapp.sidebar.latest" : "botapp.sidebar.mine");
      toast(t("templates.success", { name: result.bot.name, group: groupName }));
    } catch (e) { failed(e); patch({ busy: false }); }
  };
  const connectedApp = (id) => apps.apps.some((a) => a.key === id && a.state === "connected");
  const appStatus = (id) => !apps.loaded || apps.error ? t("templates.appUnknown") : t(connectedApp(id) ? "apps.state.connected" : "templates.notConnected");
  const level = t(`templates.levels.${item.tier === 0 ? "low" : item.tier === 2 ? "medium" : "high"}`);
  return html`<section class="template-preview" data-screen="template-preview">
    <header class="chat-head"><span>${t("templates.previewTitle")}</span></header>
    <form class="template-preview-body" onSubmit=${added}>
      <button type="button" class="text template-back" disabled=${draft.busy} onClick=${back}>${t("templates.backArrow")}</button>
      <fieldset disabled=${draft.busy} class="template-columns">
        <div class="template-identity"><${BotAvatar} char=${draft.avatar} size=${96} lively /><${AvatarPicker} value=${draft.avatar} onChange=${(avatar) => patch({ avatar })} size=${36} />
          <p class="hint">${t("templates.avatarHint")}</p>
          <label class="set-field"><span class="k">${t("newBot.name")}</span><input class="field" ref=${nameRef} maxlength="60" value=${draft.name}
            onInput=${(e) => patch({ name: e.target.value, automaticName: false, conflict: bots.some((b) => b.name === e.target.value.trim()) ? e.target.value.trim() : "" })} />
            ${draft.conflict && html`<span class="hint">${t("templates.nameConflict", { name: draft.conflict, newName: availableName(draft.name, bots) })}</span>`}</label>
          <label class="set-field"><span class="k">${t("newBot.persona")}</span><span class="hint">${t("templates.personaHint")}</span>
            <textarea class="field" rows="10" ref=${prompt} value=${draft.persona} onInput=${(e) => patch({ persona: e.target.value })} /></label></div>
        <div class="template-details">
          <section><h2 class="list-head">${t("botSettings.model.head")}</h2>${list(html`<div class="row"><div class="who"><div class="name">${t("botSettings.model.default")}</div>
            <div class="sub">${t(`templates.model.${rec?.reason || "unavailable"}`, { level })}</div></div>
            <${ModelButton} value=${draft.model} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
              resetLabel=${t(defaultModel ? "botSettings.model.followGlobalWith" : "botSettings.model.followGlobal", { model: shortModel(defaultModel || "") })}
              onChange=${(model) => patch({ model, modelTouched: true })} tiers=${{ account, onAccount: () => {}, effective: defaultModel, draftOnly: true }} /></div>`)}
            ${rec?.reason !== "recommended" && html`<p class="hint">${t("templates.usualTier", { level })}</p>`}
            ${capability !== "ok" && html`<${Notice} tone="amber">${t(`templates.capability.${capability}`)}<//>`}
            ${modelsError && html`<${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${reloadModels}>${t("common.retry")}</button>`}>${t("firstUse.modelFailed")}<//>`}</section>
          <section><h2 class="list-head">${t("templates.capabilities")}</h2>${list(html`<div class="row"><div class="who"><div class="name">${t("templates.memory")}</div><div class="sub">${item.memoryHint}</div></div>
            <${Switch} label=${t("templates.memory")} value=${draft.memory} onChange=${(memory) => patch({ memory })} /></div>
            ${["search", "workspace"].map((key) => html`<div class="row"><span>${t(`templates.${key}`)}</span><span class="hint">${t("templates.builtIn")}</span></div>`)}`)}
            ${id === "coding-partner" && html`<p class="hint">${t("templates.codingBoundary")}</p>`}</section>
          ${item.appIds.length > 0 && html`<section><h2 class="list-head">${t("templates.apps")}</h2>${list(item.appIds.map((app) => html`<div class="row"><span>${appName(apps, app, getLang())}</span>
            <span class=${apps.loaded && !apps.error && connectedApp(app) ? "template-connected" : "hint"}>${appStatus(app)}</span></div>`))}<p class="hint">${t("templates.appsHint")}</p></section>`}
          ${item.memory && html`<section><h2 class="list-head">${t("templates.startingMemory")}</h2><div class="template-note"><b>${item.memoryTitle}</b>${item.memoryNotes.map((note) => html`<p>${note}</p>`)}</div><p class="hint">${t(draft.memory ? "templates.memoryOnHint" : "templates.memoryOffHint")}</p></section>`}
          ${item.rule && html`<section><h2 class="list-head">${t("templates.scheduledRule")}</h2><div class="template-note"><div class="row compact"><b>${item.ruleTitle}</b><span class="badge">${t("templates.ruleOff")}</span></div>
            <p>${t(item.rule.schedule.kind === "weekly" ? "templates.friday" : "templates.weekdays", { time: item.rule.schedule.time })}${timeZone ? ` · ${timeZone}` : ""}</p><p>${item.ruleInstruction}</p></div><p class="hint">${t("templates.ruleHint")}</p>${item.rule.sourceRequired && html`<p class="hint">${t("templates.digestSourceHint")}</p>`}</section>`}
          <section><h2 class="list-head">${t("templates.sampleTitle")}</h2><p class="template-note">${item.sample}</p><p class="hint">${t("templates.sampleHint")}</p>${item.channelText && html`<p class="hint">${item.channelText}</p>`}</section>
        </div></fieldset>
      <footer class="template-footer"><${Button} disabled=${draft.busy} onClick=${back}>${t("templates.back")}<//><${Button} type="submit" variant="primary" size="lg" loading=${draft.busy} disabled=${!draft.name.trim() || !validModel}>${t("templates.addBot")}<//></footer>
    </form></section>`;
}
