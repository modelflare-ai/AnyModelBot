// 新建机器人（参考 Grok Bot 的创建页）：头像角色 + 名称 + 人设 + 模型，下面是从模板开始。
// 模型一组和机器人设置页的「模型」组是同一种结构（分组小标题 + 圆角卡片 + 一行默认模型，同一个下拉和面板），
// 只放默认模型这一行：后台小任务模型和预算有合理的默认值，创建后到机器人设置里改。
// 默认头像是天天。头像只管长相，选模板不会换头像：机器人做什么由人设决定。
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Button, Notice, autoGrow } from "../components/ui.js";
import { shortModel, sameModel } from "../components/model-picker.js";
import { ModelButton } from "./bot-settings.js";
import { BotAvatar, AvatarPicker, MAIN_CHAR } from "../components/avatar.js";
import { api } from "../lib/api.js";
import { createStore, failed } from "../lib/store.js";
import { templateOf, templateRequestId } from "../lib/templates.js";
import { blankBotDraft, openTemplates } from "../lib/template-flow.js";
import { templateDraft, templateCreated } from "../lib/guide.js";
import { t } from "../lib/i18n.js";

/** 正在填的新机器人：侧栏那一行占位跟着显示头像和名字，建好后原地换成真的那一行 */
export const newBotDraft = createStore(null);

export function NewBotScreen({ first, onCreated, onCancel, models, modelsError, reloadModels, defaultModel, account, onAccount }) {
  const [previous] = useState(() => blankBotDraft.get());
  const [onboarding] = useState(() => templateDraft.get() || previous?.onboarding);
  const initial = onboarding ? templateOf(onboarding.key) : null;
  const [name, setName] = useState(previous?.name ?? initial?.name ?? "");
  const [prompt, setPrompt] = useState(previous?.prompt ?? initial?.persona ?? "");
  useEffect(() => () => templateDraft.set(null), []);
  const [avatar, setAvatar] = useState(previous?.avatar ?? initial?.avatar ?? MAIN_CHAR);
  const [hi, setHi] = useState(null);
  const [busy, setBusy] = useState(false);
  // 模型设置（第 16 项）：默认跟随全局默认模型；全局默认没设、或者已经下架时不悄悄换成列表里的第一个，请用户自己选
  const [model, setModel] = useState(previous?.model || "");
  const [requestId] = useState(() => previous?.requestId || templateRequestId());
  useLayoutEffect(() => blankBotDraft.set({ name, prompt, avatar, model, onboarding, requestId }), [name, prompt, avatar, model]);
  const listed = (m) => !!m && !!models?.some((x) => sameModel(x, m));
  const inherited = listed(defaultModel) ? defaultModel : "";
  const effectiveModel = model || inherited;
  // 列表读不到时：跟随默认还能建（之后在对话里出错会提示换模型）；手选的模型核对不了，先重试
  const modelAvailable = listed(effectiveModel) || (!!modelsError && !model && !!defaultModel);
  const needsPick = !!models && !modelsError && !modelAvailable;
  const nameRef = useRef(null);
  const promptRef = useRef(null);
  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);
  useEffect(() => autoGrow(promptRef.current, 240), [prompt]);
  useEffect(() => {
    newBotDraft.set({ name: name.trim(), avatar });
  }, [name, avatar]);
  useEffect(() => () => {
    newBotDraft.set(null);
  }, []);

  const choose = (k) => {
    setAvatar(k);
    setHi({ kind: "hello", at: Date.now() });
  };
  const create = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy || !modelAvailable) return;
    setBusy(true);
    try {
      const r = await api(onboarding ? "/bots/from-template" : "/bots", { method: "POST", body: { name: n, systemPrompt: prompt.trim(), avatar, defaultModel: model, ...(onboarding ? { templateId: initial.id, requestId, onboarding: true } : {}) } });
      blankBotDraft.set(null);
      if (onboarding) templateCreated(r.bot, initial.id, r.sample);
      await onCreated(r.bot);
    } catch (err) {
      failed(err);
      setBusy(false);
    }
  };

  return html`<section class="new-bot view" data-screen="new-bot">
    <header class="chat-head">
      <span class="head-bot static"><${BotAvatar} char=${avatar} size=${22} /><span class="name">${t("newBot.headName")}</span></span>
      <span class="grow"></span>
      ${onCancel && html`<${IconButton} icon="close" iconSize="md" label=${t("newBot.cancel")} onClick=${onCancel} />`}
    </header>
    <div class="new-body">
      <form class="new-form" onSubmit=${create}>
        <${BotAvatar} char=${avatar} size=${96} lively pokeable greet cue=${hi} state=${busy ? "thinking" : name.trim() ? "listening" : "idle"} />
        <h1 class="new-title">${first ? t("newBot.firstTitle") : t("newBot.title")}</h1>
        <p class="new-lead">${t("newBot.lead")}</p>
        <${AvatarPicker} value=${avatar} onChange=${choose} size=${40} />
        <label class="set-field">
          <span class="k">${t("newBot.name")}</span>
          <input class="field" ref=${nameRef} maxlength="60" placeholder=${t("newBot.namePlaceholder")} value=${name} onInput=${(e) => setName(e.target.value)}
            onKeyDown=${(e) => e.key === "Escape" && name && (e.stopPropagation(), setName(""))} />
        </label>
        <label class="set-field">
          <span class="k">${t("newBot.persona")}<span class="hint">${t("newBot.personaHint")}</span></span>
          <textarea class="field" ref=${promptRef} rows="3" placeholder=${t("newBot.personaPlaceholder")} value=${prompt}
            onInput=${(e) => { setPrompt(e.target.value); }} />
        </label>
        <div class="new-model">
          <div class="list-head">${t("botSettings.model.head")}</div>
          <div class="list">
            <div class="row" id="new-bot-model">
              <div class="who"><div class="name">${t("botSettings.model.default")}</div><div class="sub">${t("botSettings.model.defaultSub")}</div></div>
              <div class="ctl"><${ModelButton} value=${model} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} onChange=${setModel}
                resetLabel=${inherited ? t("botSettings.model.followGlobalWith", { model: shortModel(inherited) }) : t("botSettings.model.followGlobal")}
                tiers=${{ account, onAccount: onAccount || (() => {}), effective: inherited || (models && models[0]) || "" }} /></div>
            </div>
          </div>
        </div>
        ${modelsError && html`<${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${reloadModels}>${t("common.retry")}</button>`}>${t("firstUse.modelFailed")}<//>`}
        ${needsPick && html`<${Notice} tone="amber">${t(model || defaultModel ? "firstUse.modelUnavailable" : "firstUse.modelPickFirst")}<//>`}
        <p class="hint new-note">${t("firstUse.moreCapabilities")}</p>
        <${Button} type="submit" variant="primary" size="lg" block loading=${busy} disabled=${!name.trim() || !modelAvailable}>${t("newBot.create")}<//>
      </form>
      <button type="button" class="template-entry" onClick=${() => openTemplates("new")}><span><b>${t("templates.newEntry")}</b><small>${t("templates.entryHint")}</small></span><span>${t("templates.browse")}</span></button>
    </div>
  </section>`;
}
