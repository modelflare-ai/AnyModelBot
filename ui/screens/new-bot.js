// 新建机器人（参考 Grok Bot 的创建页）：头像角色 + 名称 + 人设，下面是从模板开始。
// 默认是主角小蓝；每个模板配了一个合适的角色（avatar），选模板时一起换，也可以自己挑。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Button, autoGrow } from "../components/ui.js";
import { BotAvatar, AvatarPicker, MAIN_CHAR } from "../components/avatar.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";
import { t } from "../lib/i18n.js";

/** 模板。名称、简介和人设在词典 newBot.tpl.<key> 里，读的时候按当前语言翻译（选模板时按当时的语言填进表单） */
const template = (key, icon, avatar) => ({
  key,
  icon,
  avatar,
  get name() {
    return t(`newBot.tpl.${key}.name`);
  },
  get desc() {
    return t(`newBot.tpl.${key}.desc`);
  },
  get prompt() {
    return t(`newBot.tpl.${key}.prompt`);
  },
});
export const TEMPLATES = [
  template("digest", "file", "green"),
  template("support", "chat", "yellow"),
  template("translate", "globe", "orange"),
  template("minutes", "clock", "blue"),
  template("writer", "compose", "purple"),
  template("coder", "code", "red"),
];

export function NewBotScreen({ first, onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tpl, setTpl] = useState("");
  const [avatar, setAvatar] = useState(MAIN_CHAR);
  const [hi, setHi] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);
  const promptRef = useRef(null);
  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);
  useEffect(() => autoGrow(promptRef.current, 240), [prompt]);

  const pick = (tp) => {
    setTpl(tp.key);
    if (tp.avatar !== avatar) choose(tp.avatar);
    setName(tp.name);
    setPrompt(tp.prompt);
    requestAnimationFrame(() => (nameRef.current?.focus(), nameRef.current?.select()));
  };
  const choose = (k) => {
    setAvatar(k);
    setHi({ kind: "hello", at: Date.now() });
  };
  const create = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const r = await api("/bots", { method: "POST", body: { name: n, systemPrompt: prompt.trim(), avatar } });
      onCreated(r.bot);
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
            onInput=${(e) => { setPrompt(e.target.value); setTpl(""); }} />
        </label>
        <${Button} type="submit" variant="primary" size="lg" loading=${busy} disabled=${!name.trim()}>${t("newBot.create")}<//>
      </form>
      <div class="new-sugg">
        <div class="list-head">${t("newBot.fromTemplate")}</div>
        <div class="tpl-grid">
          ${TEMPLATES.map((tp) => html`<button type="button" key=${tp.key} class=${`tpl${tpl === tp.key ? " on" : ""}`} aria-pressed=${tpl === tp.key} onClick=${() => pick(tp)}>
            <span class="tpl-ic"><${Icon} name=${tp.icon} size="lg" /></span>
            <span class="tpl-name">${tp.name}</span>
            <span class="tpl-desc">${tp.desc}</span>
          </button>`)}
        </div>
      </div>
    </div>
  </section>`;
}
