// 新建机器人（参考 Grok Bot 的创建页）：头像角色 + 名称 + 人设，下面是从模板开始。
// 默认是主角小蓝；每个模板配了一个合适的角色（avatar），选模板时一起换，也可以自己挑。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Button, autoGrow } from "../components/ui.js";
import { BotAvatar, AvatarPicker, MAIN_CHAR } from "../components/avatar.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";

export const TEMPLATES = [
  { key: "digest", icon: "file", avatar: "green", name: "群聊日报", desc: "把群里的讨论整理成日报：结论、待办和负责人",
    prompt: "你是群聊日报助手。被要求总结时，把群里的讨论整理成日报：先写三条以内的结论，再列待办（事项、负责人、时间），最后列还没解决的问题。只写群里确实说过的内容，不要编造。" },
  { key: "support", icon: "chat", avatar: "yellow", name: "客服助手", desc: "按已知资料回答客户问题，拿不准就转人工",
    prompt: "你是客服助手。用简洁、礼貌的中文回答客户问题，只依据已知的资料作答；资料里没有或拿不准时，直接说明会转给人工处理，不要猜测。" },
  { key: "translate", icon: "globe", avatar: "orange", name: "翻译官", desc: "中英互译，保留语气、术语和格式",
    prompt: "你是翻译官。收到中文就译成英文，收到其他语言就译成中文。保留原文的语气、术语和格式（列表、代码、链接），只输出译文。" },
  { key: "minutes", icon: "clock", avatar: "blue", name: "会议纪要", desc: "把会议记录整理成结论、待办和待定问题",
    prompt: "你是会议纪要助手。把会议记录或转写整理成：会议主题、结论、待办（事项、负责人、截止时间）、待定问题。语言精炼，不添加记录里没有的信息。" },
  { key: "writer", icon: "compose", avatar: "purple", name: "写作助手", desc: "起草公告、邮件和周报，按你的语气润色",
    prompt: "你是写作助手。帮我起草和润色公告、邮件、周报等文字。先弄清用途和读者，再给出成稿；语气自然、结构清楚，不写空话。" },
  { key: "coder", icon: "code", avatar: "red", name: "代码助手", desc: "读代码、写脚本，在自己的工作区里改文件",
    prompt: "你是代码助手。阅读和修改工作区里的代码，编写脚本解决问题。动手前先说明计划，改完说明改了什么、怎么验证。" },
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

  const pick = (t) => {
    setTpl(t.key);
    if (t.avatar !== avatar) choose(t.avatar);
    setName(t.name);
    setPrompt(t.prompt);
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
      <span class="head-bot static"><${BotAvatar} char=${avatar} size=${22} /><span class="name">新机器人</span></span>
      <span class="grow"></span>
      ${onCancel && html`<${IconButton} icon="close" iconSize=${15} label="取消（Esc）" onClick=${onCancel} />`}
    </header>
    <div class="new-body">
      <form class="new-form" onSubmit=${create}>
        <${BotAvatar} char=${avatar} size=${96} lively pokeable greet cue=${hi} state=${busy ? "thinking" : name.trim() ? "listening" : "idle"} />
        <h1 class="new-title">${first ? "创建你的第一个机器人" : "新建机器人"}</h1>
        <p class="new-lead">挑一个伙伴，起个名字、写几句人设，或者从下面的模板开始。</p>
        <${AvatarPicker} value=${avatar} onChange=${choose} size=${40} />
        <label class="set-field">
          <span class="k">名称</span>
          <input class="field" ref=${nameRef} maxlength="60" placeholder="例如：群聊日报" value=${name} onInput=${(e) => setName(e.target.value)}
            onKeyDown=${(e) => e.key === "Escape" && name && (e.stopPropagation(), setName(""))} />
        </label>
        <label class="set-field">
          <span class="k">人设<span class="hint">可选，之后在机器人设置里也能改</span></span>
          <textarea class="field" ref=${promptRef} rows="3" placeholder="例如：你是一个乐于助人的中文助手，回答简洁准确。" value=${prompt}
            onInput=${(e) => { setPrompt(e.target.value); setTpl(""); }} />
        </label>
        <${Button} type="submit" variant="primary" size="lg" loading=${busy} disabled=${!name.trim()}>创建<//>
      </form>
      <div class="new-sugg">
        <div class="list-head">从模板开始</div>
        <div class="tpl-grid">
          ${TEMPLATES.map((t) => html`<button type="button" key=${t.key} class=${`tpl${tpl === t.key ? " on" : ""}`} aria-pressed=${tpl === t.key} onClick=${() => pick(t)}>
            <span class="tpl-ic"><${Icon} name=${t.icon} size=${17} /></span>
            <span class="tpl-name">${t.name}</span>
            <span class="tpl-desc">${t.desc}</span>
          </button>`)}
        </div>
      </div>
    </div>
  </section>`;
}
