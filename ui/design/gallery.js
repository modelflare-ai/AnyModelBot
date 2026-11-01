// 设计库样例页：token 表直接解析 tokens/*.css（单一来源，不会和代码脱节），组件用真实实现渲染。
import { render, createContext } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { html, Icon, ICONS, Button, IconButton, Seg, Switch, MenuButton, Menu, Badge, Notice, Skeleton, Spinner, CopyButton, Toasts, DialogHost, Splitter } from "../components/ui.js";
import { BotAvatar, AvatarPicker, AppMark, BOT_CHARS, CHAR_KEYS, MAIN_CHAR } from "../components/avatar.js";
import { NeedItem, NeedsRow } from "../screens/needs-you.js";
import { RuleRow, RuleDetail } from "../components/rules.js";
import { PausedLine, TaskChip, TaskGroup, TaskRow } from "../components/tasks.js";
import { Markdown } from "../components/markdown.js";
import { useStore, toast, saved, failed, confirmSheet } from "../lib/store.js";
import { themeMode, setThemeMode } from "../lib/theme.js";
import "../lib/prefs.js"; // 外观偏好（字体大小、动画、毛玻璃…）在样例页里也生效
import { usePresence } from "./motion.js";

const Compare = createContext(false);

// —— 解析 token 文件：取第一个规则块（或 from 之后的第一个），"/* —— 组名：说明 —— */" 分组，行尾注释作为说明 ——
async function loadTokens(file, from = "") {
  const text = await fetch(new URL(`./tokens/${file}`, import.meta.url)).then((r) => r.text());
  const start = from ? text.indexOf(from) : 0;
  const block = text.slice(text.indexOf("{", start) + 1, text.indexOf("\n}", start));
  const groups = [];
  let g = null;
  for (const line of block.split("\n")) {
    const head = line.match(/\/\*\s*——\s*(.+?)\s*——\s*\*\//);
    if (head) {
      const [name, ...hint] = head[1].split("：");
      groups.push((g = { name, hint: hint.join("："), tokens: [] }));
      continue;
    }
    const m = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*(?:\/\*\s*(.*?)\s*\*\/)?\s*$/);
    if (!m) continue;
    if (!g) groups.push((g = { name: "", hint: "", tokens: [] }));
    g.tokens.push({ name: m[1], src: m[2], note: m[3] || "" });
  }
  return groups;
}
const group = (groups, name) => groups.find((g) => g.name === name)?.tokens || [];

function useResolvedTheme() {
  const [t, setT] = useState(document.documentElement.dataset.theme);
  useEffect(() => {
    const mo = new MutationObserver(() => setT(document.documentElement.dataset.theme));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return t;
}

/** 读元素上的计算值（随主题作用域变化） */
function useComputed(ref, name, deps = []) {
  const [v, setV] = useState("");
  useLayoutEffect(() => setV(getComputedStyle(ref.current).getPropertyValue(name).trim()), deps);
  return v;
}

const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(`已复制 ${text}`));

// —— 样例卡：children 是函数，双主题对照时渲染两次 ——
function Demo({ title, note, code, col, flush, children }) {
  const compare = useContext(Compare);
  const cls = `gal-demo${col ? " col" : ""}${flush ? " flush" : ""}`;
  return html`<figure class="gal-specimen">
    ${title && html`<figcaption><b>${title}</b>${note && html`<span class="t-meta">${note}</span>`}</figcaption>`}
    ${compare
      ? html`<div class="gal-pair"><div class=${cls} data-theme="light">${children()}</div><div class=${cls} data-theme="dark">${children()}</div></div>`
      : html`<div class=${cls}>${children()}</div>`}
    ${code && html`<pre class="gal-code"><code>${code.trim()}</code></pre>`}
  </figure>`;
}

function Section({ id, title, lead, children }) {
  return html`<section class="gal-sec" id=${id}><h2>${title}</h2>${lead && html`<p class="lead">${lead}</p>`}${children}</section>`;
}

function TokenName({ t }) {
  return html`<div class="gal-name"><code onClick=${() => copy(`var(${t.name})`)} title="点击复制 var()">${t.name}</code>
    <span class="t-meta">${t.note || t.src}</span></div>`;
}

function ColorChip({ name, theme }) {
  const ref = useRef(null);
  const v = useComputed(ref, name, [theme]);
  return html`<div class="gal-chip" data-theme=${theme} ref=${ref} style=${{ "--sw": `var(${name})` }}><i></i><code>${v}</code></div>`;
}

function ColorRows({ tokens }) {
  const theme = useResolvedTheme();
  return html`<div class="gal-rows">
    <div class="gal-row"><span class="t-label">token</span><span class="t-label">浅色</span><span class="t-label">深色</span></div>
    ${tokens.map((t) => html`<div class="gal-row" key=${t.name}><${TokenName} t=${t} />
      <${ColorChip} name=${t.name} theme="light" key=${theme + "l"} /><${ColorChip} name=${t.name} theme="dark" key=${theme + "d"} /></div>`)}
  </div>`;
}

function ScaleRows({ tokens, sample }) {
  return html`<div class="gal-rows">${tokens.map((t) => html`<div class="gal-row scale" key=${t.name}><${TokenName} t=${t} />
    <code class="t-meta">${t.src}</code><div>${sample(t)}</div></div>`)}</div>`;
}

// —— 动效 ——
function bezierPath(v) {
  const m = v.match(/cubic-bezier\(([^)]+)\)/);
  const [x1, y1, x2, y2] = m ? m[1].split(",").map(Number) : [0, 0, 1, 1];
  return `M0 56 C${x1 * 56} ${56 - y1 * 56} ${x2 * 56} ${56 - y2 * 56} 56 0`;
}
function Runner({ d, e }) {
  const [on, setOn] = useState(false);
  return html`<div class="cluster grow">
    <div class=${`gal-track${on ? " on" : ""}`} style=${{ "--d": d && `var(${d})`, "--e": e && `var(${e})` }}><i></i></div>
    <${Button} size="sm" onClick=${() => setOn((v) => !v)}>播放<//>
  </div>`;
}
function Replay({ cls, label }) {
  const [n, setN] = useState(0);
  return html`<div class="gal-anim">
    <div key=${n} class=${`gal-anim-box ${cls}`}></div>
    <button type="button" class="text" onClick=${() => setN((k) => k + 1)}>${label} ↻</button>
  </div>`;
}

// —— 组件样例里有状态的小件 ——
function SegDemo() {
  const [v, setV] = useState("auto");
  return html`<${Seg} label="线路" value=${v} onChange=${setV} options=${[["auto", "自动"], ["intl", "国际"], ["cn", "中国大陆优化"]]} />
    <${Seg} label="禁用" value="a" disabled onChange=${() => {}} options=${[["a", "开"], ["b", "关"]]} />`;
}
function SwitchDemo() {
  const [on, setOn] = useState(true);
  return html`<${Switch} label="长期记忆" value=${on} onChange=${setOn} /><${Switch} label="关" value=${false} onChange=${() => {}} />
    <${Switch} label="小号" size="sm" value=${on} onChange=${setOn} /><${Switch} label="禁用" value=${true} disabled onChange=${() => {}} />`;
}
function MenuButtonDemo() {
  const [v, setV] = useState("auto");
  return html`<${MenuButton} label="默认模型" value=${v} onChange=${setV}
    options=${[["auto", "自动（列表第一个）"], ["opus", "claude-opus-5-5", "最强"], ["sonnet", "claude-sonnet-5-5", "均衡"]]} />`;
}
function MenuDemo() {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return html`<button type="button" class="btn" ref=${ref} aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>打开菜单<//>
    ${open && html`<${Menu} anchor=${ref.current} label="示例菜单" onClose=${() => setOpen(false)} items=${[
      { group: "机器人" }, { label: "重命名", onSelect: () => toast("重命名") }, { label: "机器人设置", cur: true, onSelect: () => {} },
      { sep: true }, { label: "删除", danger: true, onSelect: () => failed("只是演示") }, { label: "不可用", disabled: true },
    ]} />`}`;
}
function FieldDemo() {
  const [show, setShow] = useState(false);
  return html`<input class="field" placeholder="默认" />
    <input class="field mono" placeholder="mono：sk-…" />
    <input class="field err" value="err：格式不对" />
    <input class="field" readonly value="readonly" />
    <div class="field-wrap"><input class="field mono" type=${show ? "text" : "password"} value="sk-demo-0000" />
      <span class="tail"><${IconButton} icon=${show ? "eyeOff" : "eye"} label="显示" onClick=${() => setShow((v) => !v)} /><${CopyButton} text="sk-demo-0000" /></span></div>
    <textarea class="field" rows="3" placeholder="textarea.field"></textarea>`;
}
// —— 头像：6 个角色、平台里的状态、一次性反应、尺寸、配对 ——
const AV_STATES = [["idle", "空闲"], ["listening", "在听"], ["thinking", "思考"], ["replying", "回复"], ["waiting", "等批准"], ["sleep", "睡觉"]];
const AV_SHOTS = [["hello", "打招呼 · 新建后"], ["done", "完成 · 回复结束"], ["error", "出错"], ["poke", "戳一下"], ["love", "连戳三下"], ["dizzy", "戳太多"]];

function AvatarCastDemo() {
  return html`<div class="cluster" style="--gap: var(--space-6); align-items: start">
    ${CHAR_KEYS.map((k) => html`<div class="stack" style="--gap: var(--space-1); justify-items: center; text-align: center; width: 120px">
      <${BotAvatar} char=${k} size=${96} lively pokeable greet />
      <b class="t-title">${BOT_CHARS[k].name}${k === MAIN_CHAR ? " · 默认" : ""}</b>
      <span class="t-meta">${BOT_CHARS[k].about}</span>
    </div>`)}
  </div>`;
}

function AvatarStateDemo() {
  const [state, setState] = useState("thinking");
  const [char, setChar] = useState(MAIN_CHAR);
  const [cue, setCue] = useState(null);
  return html`<div class="stack" style="--gap: var(--space-4)">
    <${Seg} label="持续状态" value=${state} onChange=${setState} options=${AV_STATES} />
    <div class="cluster" style="--gap: var(--space-2)">
      ${AV_SHOTS.map(([k, l]) => html`<${Button} size="sm" onClick=${() => setCue({ kind: k, at: Date.now() })}>${l}<//>`)}
    </div>
    <div class="cluster" style="--gap: var(--space-4); align-items: end">
      <${BotAvatar} char=${char} size=${144} state=${state} cue=${cue} lively pokeable />
      ${CHAR_KEYS.filter((k) => k !== char).map((k) => html`<button type="button" class="avatar-opt" title="放大看" onClick=${() => setChar(k)}>
        <${BotAvatar} char=${k} size=${64} state=${state} cue=${cue} /><span>${BOT_CHARS[k].name}</span>
      </button>`)}
    </div>
  </div>`;
}

function AvatarSizeDemo() {
  const [working, setWorking] = useState(false);
  return html`<div class="stack" style="--gap: var(--space-4)">
    <div class="cluster" style="--gap: var(--space-5); align-items: end">
      ${[22, 38, 56, 96].map((s) => html`<div class="stack bot-hover" style="--gap: var(--space-1-5); justify-items: center"><${BotAvatar} char=${MAIN_CHAR} size=${s} working=${working} /><span class="t-meta">${s}px</span></div>`)}
      <div class="stack" style="--gap: var(--space-1-5); justify-items: center"><${BotAvatar} neutral size=${56} /><span class="t-meta">neutral（新建页占位）</span></div>
      <${Button} size="sm" onClick=${() => setWorking((v) => !v)}>${working ? "停下" : "开始工作"}<//>
    </div>
    <div class="cluster" style="--gap: var(--space-2)">${CHAR_KEYS.map((k) => html`<span class="bot-hover"><${BotAvatar} char=${k} size=${38} working=${working} /></span>`)}</div>
    <div class="cluster" style="--gap: var(--space-2)">${CHAR_KEYS.map((k) => html`<${BotAvatar} char=${k} size=${22} working=${working} />`)}</div>
  </div>`;
}

function AvatarPickerDemo() {
  const [v, setV] = useState("");
  return html`<${AvatarPicker} value=${v} fallback=${MAIN_CHAR} onChange=${setV} />`;
}

// —— 材质：环境光上叠几层玻璃，底下放有颜色的内容，才看得出透光和模糊 ——
const MATERIALS = [
  ["--glass-side", "侧栏", "只盖在环境光上，不模糊"],
  ["--glass-chrome", "顶栏", "--glass-filter"],
  ["--glass-float", "输入框 · 回到底部", "--glass-filter"],
  ["--glass-panel", "信息面板", "停靠时不模糊"],
  ["--glass-pop", "菜单 · 命令面板 · 提示", "--glass-filter-lg"],
  ["--glass-sheet", "对话框 · 引导卡片", "--glass-filter-lg"],
];
function GlassStage() {
  return html`<div class="gal-stage aura-bg" style="--aura-hue: 225">
    <div class="gal-stage-under" aria-hidden="true">
      ${["--accent-solid", "--green", "--red", "--amber", "--primary", "--accent-solid", "--green", "--red", "--amber", "--primary"].map((c, i) => html`<div class="cluster">
        <i class="gal-stage-swatch" style=${{ "--sw": `var(${c})` }}></i>
        <span>${["今日结论：周五前上线新版引导页", "客服话术改用新模板", "设计稿定稿（小林，周三）", "联调支付回调（阿杰，周四）", "价格以控制台为准"][i % 5]}</span></div>`)}
    </div>
    <div class="gal-stage-over">
      ${MATERIALS.map(([bg, label, blur]) => html`<div class="glass gal-mat" style=${{ "--glass-bg": `var(${bg})`, "--glass-blur": blur.startsWith("--") ? `var(${blur})` : "none" }}>
        <b>${label}</b><code class="t-meta">${bg}</code><span class="t-meta">${blur.startsWith("--") ? `模糊 ${blur}` : blur}</span></div>`)}
    </div>
  </div>`;
}

// —— 状态矩阵：每个组件的各种状态并排画出来，浅色一行、深色一行 ——
// 设计库把样式表里的 :hover / :active / :focus-visible / :focus-within / :focus 规则各复制一份，
// 换成 .is-hover / .is-active / .is-focus，于是悬停、按下、键盘焦点也能静态展示。只在设计库里做，产品代码不用这些类。
const PSEUDO = [[":focus-visible", ".is-focus"], [":focus-within", ".is-focus"], [":focus", ".is-focus"], [":hover", ".is-hover"], [":active", ".is-active"]];
function mirrorPseudoStates() {
  const visit = (owner) => {
    let rules;
    try {
      rules = owner.cssRules;
    } catch {
      return;
    }
    const adds = [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r instanceof CSSImportRule) r.styleSheet && visit(r.styleSheet);
      else if (r instanceof CSSStyleRule) {
        if (!/:(hover|active|focus)/.test(r.selectorText)) continue;
        const sel = PSEUDO.reduce((s, [p, c]) => s.split(p).join(c), r.selectorText);
        adds.push([i + 1, `${sel} { ${r.style.cssText} }`]);
      } else if (r.cssRules) visit(r); // @layer / @media / @supports：插回原来的层里，层叠顺序不变
    }
    for (const [i, text] of adds.reverse()) {
      try {
        owner.insertRule(text, i);
      } catch {
        /* 个别选择器复制后不合法：跳过 */
      }
    }
  };
  for (const s of document.styleSheets) visit(s);
}

const noop = () => {};
/** 默认 / 悬停 / 按下 / 键盘焦点 四个基本状态；render 收到要加的类名 */
const basic = (render) => [["默认", () => render("")], ["悬停", () => render("is-hover")], ["按下", () => render("is-active")], ["键盘焦点", () => render("is-focus")]];
const btn = (v, label) => (c) => html`<button type="button" class=${`btn ${v} ${c}`}>${label}</button>`;

function SegState({ st, disabled }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (st) ref.current?.querySelectorAll(".seg button")[1]?.classList.add(st);
  }, []);
  return html`<div ref=${ref}><${Seg} label="示例" value="a" disabled=${disabled} onChange=${noop} options=${[["a", "自动"], ["b", "国际"]]} /></div>`;
}
const thread = (c, { working } = {}) => html`<div class=${`thread-item ${c}`} style="width: 236px"><button type="button" class=${`thread ${c}`}>
  <span class="avatar-wrap"><${BotAvatar} id="a1f3c9d2" name="群聊日报" size=${38} working=${working} />${working && html`<span class="working-dot"></span>`}</span>
  <span class="body"><span class="line"><span class="title">群聊日报</span><span class="when num">09:24</span></span>
    <span class="line"><span class="snip">${working ? "正在工作…" : "今日结论：周五前上线"}</span></span></span>
</button><button type="button" class="icon-btn thread-more" tabindex="-1" aria-label="更多操作"><${Icon} name="more" size="sm" /></button></div>`;
/** 分隔条的静态样例：左右两块面板，中间的空隙就是分隔条 */
const splitStage = (c) => html`<div class="gal-split mini"><div class="gal-split-a"></div><div class=${`splitter ${c}`} aria-hidden="true"></div><div class="gal-split-b"></div></div>`;
const menuItem = (c, label = "机器人设置") => html`<div class="pop gal-pop-static"><ul>
  <li class=${c}><span class="v">${label}</span><span class="check"><${Icon} name="check" size="sm" /></span></li></ul></div>`;
const composer = (c) => html`<div class=${`composer ${c}`} style="width: 250px"><textarea rows="1" placeholder="发消息，/ 查看命令" tabindex="-1"></textarea>
  <div class="composer-bar"><button type="button" class="plus" tabindex="-1" aria-label="更多"><${Icon} name="plus" size="md" /></button><span class="grow"></span>
    <button type="button" class="send" tabindex="-1" aria-label="发送"><${Icon} name="up" size="md" strong /></button></div></div>`;

const STATE_ROWS = [
  { name: "主按钮", note: ".btn.primary · 加载保持本色只是不可点；禁用退成中性灰", cells: [...basic(btn("primary", "保存")), ["加载", () => html`<${Button} variant="primary" loading>保存<//>`], ["禁用", () => html`<button type="button" class="btn primary" disabled>保存</button>`]] },
  { name: "次按钮", note: ".btn", cells: [...basic(btn("", "取消")), ["加载", () => html`<${Button} loading>刷新<//>`], ["禁用", () => html`<button type="button" class="btn" disabled>取消</button>`]] },
  { name: "幽灵按钮", note: ".btn.ghost", cells: [...basic(btn("ghost", "跳过")), ["禁用", () => html`<button type="button" class="btn ghost" disabled>跳过</button>`]] },
  { name: "危险按钮", note: ".btn.danger", cells: [...basic(btn("danger", "永久删除")), ["禁用", () => html`<button type="button" class="btn danger" disabled>永久删除</button>`]] },
  { name: "图标按钮", note: ".icon-btn · 打开（on / aria-expanded）比悬停深一级", cells: [...basic((c) => html`<button type="button" class=${`icon-btn ${c}`} aria-label="信息面板"><${Icon} name="panel" /></button>`),
    ["打开", () => html`<button type="button" class="icon-btn on" aria-label="信息面板"><${Icon} name="panel" /></button>`], ["禁用", () => html`<button type="button" class="icon-btn" disabled aria-label="新对话"><${Icon} name="compose" /></button>`]] },
  { name: "文字按钮", note: ".text [accent | danger]", cells: [...basic((c) => html`<button type="button" class=${`text ${c}`}>更换密钥</button>`),
    ["强调", () => html`<button type="button" class="text accent">改用大陆线路</button>`], ["危险 · 悬停", () => html`<button type="button" class="text danger is-hover">删除</button>`], ["禁用", () => html`<button type="button" class="text" disabled>更换密钥</button>`]] },
  { name: "输入框", note: ".field · 错误状态聚焦时是红色光晕；只读聚焦不发光", cells: [
    ["默认", () => html`<input class="field" placeholder="App ID" style="width: 150px" />`], ["悬停", () => html`<input class="field is-hover" placeholder="App ID" style="width: 150px" />`],
    ["聚焦", () => html`<input class="field is-focus" value="cli_a1b2" style="width: 150px" />`], ["错误", () => html`<input class="field err" value="格式不对" style="width: 150px" />`],
    ["错误 · 聚焦", () => html`<input class="field err is-focus" value="格式不对" style="width: 150px" />`], ["只读", () => html`<input class="field" readonly value="https://…/v1" style="width: 150px" />`],
    ["禁用", () => html`<input class="field" disabled value="未启用" style="width: 150px" />`]] },
  { name: "开关 · 关", note: ".switch[aria-checked=false] · 按下时圆钮被按扁", cells: [...basic((c) => html`<button type="button" role="switch" aria-checked="false" aria-label="长期记忆" class=${`switch ${c}`}></button>`),
    ["禁用", () => html`<button type="button" role="switch" aria-checked="false" aria-label="长期记忆" class="switch" disabled></button>`]] },
  { name: "开关 · 开", note: ".switch[aria-checked=true]", cells: [...basic((c) => html`<button type="button" role="switch" aria-checked="true" aria-label="长期记忆" class=${`switch ${c}`}></button>`),
    ["禁用", () => html`<button type="button" role="switch" aria-checked="true" aria-label="长期记忆" class="switch" disabled></button>`]] },
  { name: "分段", note: ".seg · 状态画在第二项（未选中）上", cells: [["默认", () => html`<${SegState} />`], ["悬停", () => html`<${SegState} st="is-hover" />`], ["按下", () => html`<${SegState} st="is-active" />`],
    ["键盘焦点", () => html`<${SegState} st="is-focus" />`], ["禁用", () => html`<${SegState} disabled />`]] },
  { name: "菜单按钮", note: ".pick · 打开时箭头翻转", cells: [...basic((c) => html`<button type="button" class=${`pick ${c}`}><span class="v">claude-sonnet-5-5</span><${Icon} name="chevDown" /></button>`),
    ["打开", () => html`<button type="button" class="pick" aria-expanded="true"><span class="v">claude-sonnet-5-5</span><${Icon} name="chevDown" /></button>`],
    ["禁用", () => html`<button type="button" class="pick" disabled><span class="v">自动</span><${Icon} name="chevDown" /></button>`]] },
  { name: "菜单项", note: ".pop li · 悬停和键盘指着是同一个 .sel，同一时刻只有一项", cells: [["默认", () => menuItem("")], ["指着", () => menuItem("sel")], ["按下", () => menuItem("sel is-active")],
    ["当前", () => menuItem("cur")], ["危险 · 指着", () => menuItem("danger sel", "删除")], ["禁用", () => menuItem("disabled", "不可用")]] },
  { name: "侧栏行", note: ".thread-item > .thread + .thread-more · 悬停叠一层淡灰并亮出「更多」（时间让位），选中是浮起的白色玻璃片", ctx: "side", cells: [...basic((c) => thread(c)), ["选中", () => thread("sel")], ["工作中", () => thread("", { working: true })]] },
  { name: "分隔条", note: ".splitter · 平时看不见；指针停住 --dur-intent 后亮起细线，拖动和键盘焦点是 accent", ctx: "side", cells: [
    ["默认", () => splitStage("")], ["悬停", () => splitStage("is-hover")], ["拖动", () => splitStage("dragging")], ["键盘焦点", () => splitStage("is-focus")]] },
  { name: "设置导航", note: ".nav-item", ctx: "side", cells: [...basic((c) => html`<button type="button" class=${`nav-item ${c}`} style="width: 200px"><${Icon} name="sliders" />常规</button>`),
    ["选中", () => html`<button type="button" class="nav-item sel" style="width: 200px"><${Icon} name="sliders" />常规</button>`]] },
  { name: "侧栏搜索 · 账户", note: ".side-search · .account", ctx: "side", cells: [
    ["默认", () => html`<label class="side-search" style="width: 200px; margin: 0"><${Icon} name="search" size="sm" /><input placeholder="搜索" tabindex="-1" /></label>`],
    ["悬停", () => html`<label class="side-search is-hover" style="width: 200px; margin: 0"><${Icon} name="search" size="sm" /><input placeholder="搜索" tabindex="-1" /></label>`],
    ["聚焦", () => html`<label class="side-search is-focus" style="width: 200px; margin: 0"><${Icon} name="search" size="sm" /><input value="日报" tabindex="-1" /></label>`],
    ["账户 · 悬停", () => html`<button type="button" class="account is-hover" style="width: 200px"><span class="me">R</span><span class="who">root</span><${Icon} name="gear" /></button>`],
    ["账户 · 打开", () => html`<button type="button" class="account on" style="width: 200px"><span class="me">R</span><span class="who">root</span><${Icon} name="gear" /></button>`]] },
  { name: "余额不足提示", note: ".low-balance · 一层淡红 + 红点，字用 --fg；悬停、按下淡红加深", ctx: "side", cells: basic((c) => html`<a class=${`low-balance ${c}`} href="#states" style="width: 220px; margin: 0">余额只剩 $0.42，去充值 ↗</a>`) },
  { name: "选角色", note: ".avatar-opt · 选中比悬停深一级、名字变实，不描边", cells: [
    ...basic((c) => html`<button type="button" class=${`avatar-opt ${c}`}><${BotAvatar} char="green" size=${36} /><span class="avatar-name">${BOT_CHARS.green.name}</span></button>`),
    ["选中", () => html`<button type="button" class="avatar-opt on" aria-checked="true" role="radio"><${BotAvatar} char="blue" size=${36} /><span class="avatar-name">${BOT_CHARS.blue.name}</span></button>`]] },
  { name: "发送按钮", note: ".send · 空的时候是中性灰钮，能发了才亮起品牌色；悬停时箭头上提", cells: [
    ["空", () => html`<button type="button" class="send" disabled aria-label="发送"><${Icon} name="up" size="md" strong /></button>`],
    ...basic((c) => html`<button type="button" class=${`send ${c}`} aria-label="发送"><${Icon} name="up" size="md" strong /></button>`),
    ["停止", () => html`<button type="button" class="send stop" aria-label="停止"><${Icon} name="stop" size="md" /></button>`]] },
  { name: "对话输入框", note: ".composer · 输入中描边更实、投影更大；拖入文件时 accent 描边 + 一层黄绿", cells: [["默认", () => composer("")], ["悬停", () => composer("is-hover")], ["输入中", () => composer("is-focus")], ["拖入文件", () => composer("drag")]] },
  { name: "输入框工具", note: ".composer .model-chip / .plus · 打开时箭头翻转、加号转成叉", cells: [
    ...basic((c) => html`<div class="composer gal-bare"><button type="button" class=${`model-chip ${c}`}><span class="v">claude-sonnet-5-5</span><${Icon} name="chevDown" /></button></div>`),
    ["打开", () => html`<div class="composer gal-bare"><button type="button" class="model-chip" aria-expanded="true"><span class="v">claude-sonnet-5-5</span><${Icon} name="chevDown" /></button></div>`],
    ["加号 · 打开", () => html`<div class="composer gal-bare"><button type="button" class="plus" aria-expanded="true" aria-label="更多"><${Icon} name="plus" size="md" /></button></div>`]] },
  { name: "模板卡", note: ".tpl · 一块 --well；悬停底色深一级，选中是一层黄绿 + 黄绿图标，不描边", cells: [
    ...basic((c) => html`<button type="button" class=${`tpl ${c}`} style="width: 190px"><span class="tpl-ic"><${Icon} name="chat" size="lg" /></span><span class="tpl-name">群聊日报</span><span class="tpl-desc">每天整理群消息</span></button>`),
    ["选中", () => html`<button type="button" class="tpl on" style="width: 190px"><span class="tpl-ic"><${Icon} name="chat" size="lg" /></span><span class="tpl-name">群聊日报</span><span class="tpl-desc">每天整理群消息</span></button>`]] },
  { name: "建议胶囊", note: ".chip", cells: basic((c) => html`<button type="button" class=${`chip ${c}`}>你能帮我做什么？</button>`) },
  { name: "问题选项", note: ".card .opt", cells: [
    ...basic((c) => html`<div class="card gal-bare-card"><button type="button" class=${`opt ${c}`}><span class="letter">A</span><span>国内线路<span class="desc">延迟低</span></span></button></div>`),
    ["已选", () => html`<div class="card gal-bare-card"><button type="button" class="opt picked"><span class="letter">A</span><span>国内线路<span class="desc">延迟低</span></span></button></div>`],
    ["已结束", () => html`<div class="card done gal-bare-card"><button type="button" class="opt" disabled><span class="letter">B</span><span>海外线路<span class="desc">模型更全</span></span></button></div>`]] },
  { name: "列表行", note: ".row.clickable · 键盘焦点描边往里收（卡片会裁掉外描边）", cells: basic((c) => html`<div class="list" style="width: 220px"><div class=${`row compact clickable ${c}`} tabindex="0"><div class="who"><div class="name">最近会话</div><div class="sub">3 分钟前</div></div></div></div>`) },
];

function StateRow({ name, note, ctx = "surface", cells }) {
  return html`<figure class="gal-specimen gal-state">
    <figcaption><b>${name}</b>${note && html`<span class="t-meta">${note}</span>`}</figcaption>
    ${["light", "dark"].map((t) => html`<div class=${`gal-strip aura-bg ctx-${ctx}`} data-theme=${t} style=${{ "--aura-hue": ctx === "side" ? "155" : "225" }}>
      <div class="gal-strip-in">${cells.map(([label, el]) => html`<div class="gal-cell"><div class="gal-cell-stage">${el()}</div><span class="t-meta">${label}</span></div>`)}</div>
    </div>`)}
  </figure>`;
}

// —— Windows 标题栏：样例页里的模拟窗口，不是桌面版本身。iframe 是一份独立的文档（:root.win-app、真的样式表、自己的视口），
//    所以抽屉的断点、env(titlebar-area-*) 的回退值都和桌面版一样起作用。右上角的三个按钮是替身（.gal-caption），
//    桌面版里它们是系统画的（electron/main.ts 的 titleBarOverlay）——
const WIN_SHEETS = ["./index.css", "../css/shell.css", "../css/chat.css", "../css/settings.css", "./gallery.css"].map((f) => new URL(f, import.meta.url).href);
const WIN_DOC = `<!doctype html><html class="win-app"><head><meta charset="utf-8">${WIN_SHEETS.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}</head><body></body></html>`;

/** 一个 w 宽的窗口，靠右裁切（只看右边那一截）；children 渲染进 iframe 的 body */
function WinFrame({ w, theme, children }) {
  const [body, setBody] = useState(null);
  useEffect(() => {
    if (!body) return;
    body.parentElement.dataset.theme = theme;
    render(children, body);
  });
  useEffect(() => () => body && render(null, body), [body]);
  return html`<div class="gal-win"><iframe srcdoc=${WIN_DOC} title=${`模拟的 Windows 窗口（${theme === "dark" ? "深色" : "浅色"}）`} style=${{ "--gal-win-w": `${w}px` }}
    onLoad=${(e) => setBody(e.currentTarget.contentDocument.body)}></iframe></div>`;
}

/** 系统的最小化 / 最大化 / 关闭的替身：贴住右上角，和真的一样高、一样宽，背景透明 */
function GalCaption() {
  return html`<div class="gal-caption" aria-hidden="true">
    <span><svg viewBox="0 0 10 10"><path d="M0 5.5h10" /></svg></span>
    <span><svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" /></svg></span>
    <span class="close"><svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg></span>
  </div>`;
}

/** 应用的骨架：侧栏 | 主区（对话或设置）| 信息面板。点顶栏的面板钮开合，和桌面版一样滑 */
function WinApp({ screen = "chat", open: initial = false }) {
  const [open, setOpen] = useState(initial);
  const fx = usePresence(open, "--dur-slow");
  const toggle = () => setOpen((v) => !v);
  if (screen === "onboard")
    return html`<main class="onboard"><div class="onboard-col">
      <div class="onboard-lang"><button type="button" class="pick"><${Icon} name="globe" size="sm" class="lead" /><span class="v">简体中文</span><${Icon} name="chevDown" /></button></div>
      <div class="onboard-hero"><${BotAvatar} char=${MAIN_CHAR} size=${56} /><h1>任意模型，一个助手</h1></div>
    </div><${GalCaption} /></main>`;
  const settings = screen === "settings";
  return html`<div class=${`app${open ? " with-panel" : ""}`} style=${{ "--aura-hue": "225" }}>
    <aside class="side">
      ${settings
        ? html`<div class="side-top start"><button type="button" class="side-back"><${Icon} name="arrowLeft" size="md" />返回应用</button></div>`
        : html`<div class="side-top"><span class="side-brand"><img src="/amb/static/assets/favicon-64.png" alt="" /><span>AnyModelBot</span></span><${IconButton} icon="plus" iconSize="md" label="新建机器人" /></div>`}
      <label class="side-search"><${Icon} name="search" size="sm" /><input type="search" placeholder="搜索" /></label>
      <nav class="side-list">
        ${settings
          ? html`<button type="button" class="nav-item sel"><${Icon} name="sliders" size="md" /><span>常规</span></button>
            <button type="button" class="nav-item"><${Icon} name="palette" size="md" /><span>外观</span></button>`
          : html`<div class="thread sel"><${BotAvatar} char="blue" size=${38} /><span class="body">
              <span class="line"><span class="title">天天</span><span class="when num">09:26</span></span>
              <span class="line"><span class="snip">整理好了，截图按日期分进了 3 个文件夹</span></span></span></div>`}
      </nav>
    </aside>
    <main class="main">
      ${settings
        ? html`<section class="settings view"><div class="set-head"><h1 class="set-title">常规</h1></div>
            <div class="set-body"><div class="list">
              <div class="row"><div class="who"><div class="name">开机自启</div><div class="sub">登录系统后在后台启动</div></div><div class="ctl"><${Switch} label="开机自启" value=${true} onChange=${() => {}} /></div></div>
            </div></div></section>`
        : html`<section class="chat"><header class="chat-head">
              <button type="button" class="head-bot" aria-pressed=${open} onClick=${toggle}><${BotAvatar} char="blue" size=${22} /><span class="name">天天</span></button>
              <span class="grow"></span>
              <${IconButton} icon="compose" iconSize="md" label="新对话" />
              <${IconButton} icon="panel" iconSize="md" label="信息面板" on=${open} aria-pressed=${open} onClick=${toggle} />
            </header>
            <div class="chat-scroll"><div class="chat-col ready">
              <div class="msg-row user"><div class="msg">把下载目录里的截图整理一下</div></div>
              <div class="msg-row assistant"><div class="msg">整理好了，截图按日期分进了 3 个文件夹。</div></div>
            </div></div></section>`}
    </main>
    ${fx.mounted && html`<div class=${`panel-scrim${fx.leaving ? " leaving" : ""}`} onClick=${() => setOpen(false)}></div>
      <aside class=${`panel${fx.leaving ? " leaving" : ""}`}>
        <div class="panel-head"><span class="title">天天</span>
          <${IconButton} icon="gear" iconSize="md" label="机器人设置" /><${IconButton} icon="close" iconSize="md" label="关闭" class="panel-close" onClick=${() => setOpen(false)} /></div>
        <div class="panel-body"><div class="list-head">渠道</div><div class="list">
          <div class="row compact"><div class="who"><div class="name">微信</div><div class="sub">已连接</div></div></div>
          <div class="row compact"><div class="who"><div class="name">飞书</div><div class="sub">未连接</div></div></div>
        </div></div>
      </aside>`}
    <${GalCaption} />
  </div>`;
}

function WinCase({ name, note, w = 1240, ...app }) {
  return html`<figure class="gal-specimen">
    <figcaption><b>${name}</b>${note && html`<span class="t-meta">${note}</span>`}</figcaption>
    ${["light", "dark"].map((t) => html`<${WinFrame} key=${t} w=${w} theme=${t}><${WinApp} ...${app} /><//>`)}
  </figure>`;
}

// 回复里先是模型在回合中间说的话，最后的回复接在后面（chat.js 的 shownText）
const INTERIM_REPLY = "我先看看下载目录里有什么。\n\n找到 12 张截图，按日期分进了 3 个文件夹，顺手挑了一张做封面。\n\n整理好了：截图都在「截图/2026-10」下面，清单和封面在下面。";
const MD = "支持 **粗体**、`行内代码`、[链接](https://modelflare.dev)：\n\n- 列表项\n- 第二项\n\n```js\nconst ok = true;\n```";

function Gallery() {
  const mode = useStore(themeMode);
  const [compare, setCompare] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [prim, setPrim] = useState(null);
  const [sem, setSem] = useState(null);
  const [mot, setMot] = useState(null);
  const [roles, setRoles] = useState(null);
  const [radii, setRadii] = useState(null);
  useEffect(() => {
    loadTokens("primitives.css").then(setPrim);
    loadTokens("semantic.css").then(setSem);
    loadTokens("semantic.css", "\n:root {").then(setRoles);
    loadTokens("semantic.css", "/* 圆角角色").then(setRadii);
    loadTokens("motion.css").then(setMot);
  }, []);
  const motion = (mot || []).flatMap((g) => g.tokens);
  const nav = [
    ["原则", [["principles", "分层与约定"]]],
    ["Token", [["color", "颜色"], ["material", "材质"], ["type", "文字"], ["space", "间距与尺寸"], ["elevation", "投影与层级"], ["motion", "动效"]]],
    ["组件", [["states", "状态矩阵"], ["icons", "图标"], ["buttons", "按钮"], ["inputs", "输入"], ["menus", "菜单与分段"], ["status", "状态与反馈"], ["lists", "列表行"], ["splitter", "分隔条"], ["overlays", "对话框与提示"], ["avatars", "头像"]]],
    ["页面模式", [["patterns", "对话"], ["needs", "需要你"], ["rules", "规则"], ["win-caption", "Windows 标题栏"], ["custom", "定制"]]],
  ];
  return html`<${Compare.Provider} value=${compare}><div class="gal">
    <nav class="gal-nav" aria-label="目录">
      <div class="brand"><${AppMark} size=${24} />设计库</div>
      ${nav.map(([g, items]) => html`<div class="t-label">${g}</div>${items.map(([id, label]) => html`<a href=${"#" + id}>${label}</a>`)}`)}
    </nav>
    <main class="gal-main">
      <header class="gal-head">
        <span class="t-heading grow">AnyModelBot 设计库</span>
        <${Seg} label="主题" value=${mode} onChange=${setThemeMode} options=${[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} />
        <${Seg} label="对照" value=${compare ? "both" : "one"} onChange=${(v) => setCompare(v === "both")} options=${[["one", "单主题"], ["both", "双主题对照"]]} />
      </header>
      <div class="gal-body">

      <${Section} id="principles" title="分层与约定" lead="页面只用语义 token 和组件；组件通过自己的 --组件-* 变量对外开放定制。完整规范见 ui/design/README.md。">
        <${Demo} title="层叠顺序" note="后面的层总是赢，和选择器权重无关" code=${`
@layer tokens, base, components, app, utilities;
/* tokens      primitives.css（原始色板与尺度）→ semantic.css（按主题的语义色）→ motion.css
   base        reset、关键帧库
   components  .btn .field .badge .list/.row .seg .pick/.pop .sheet .toast .notice .spinner/.skel …
   app         ui/css/*.css 页面样式：覆盖组件只需改 --组件-* 变量
   utilities   .t-*（文字角色）.stack .cluster .grow .truncate .tone-* */`}>
          ${() => html`<${Notice} action=${html`<a class="btn" href="#custom">看定制示例</a>`}>写新界面前先在这里找现成的 token 和组件；找不到再加，并且加在 token 文件里。<//>`}
        <//>
        <${Demo} col title="容器与层次" note="一组东西 = 底色深一级（--well）+ 间距；里面不再套框；描边只留给输入框（≥ 3:1）和浮层玻璃" code=${`.card { background: var(--well); border-radius: var(--r-well); }        /* 不描边、不加投影 */
.card .cmd { font-family: var(--code); }                                /* 卡片里的命令是一行等宽字，不再套底 */
.notice.red { --notice-bg: var(--red-wash); --notice-ic: var(--red); }  /* 提示：淡底 + 图标 + --fg 字，不描边、无色条 */`}>
          ${() => html`<div class="card"><div class="meta">需要你的批准 · <span class="num">A7K2</span></div><div class="q">机器人想在工作区之外写入文件</div>
              <div class="cmd">write_file  ~/Documents/周报/2026-W44.md</div>
              <div class="actions"><${Button} variant="primary">允许（仅本次）<//><${Button}>拒绝<//></div></div>
            <${Notice} tone="red">模型请求失败：HTTP 529 上游繁忙，请稍后重试<//>
            <input class="field" placeholder="输入框保留自己的边" />`}
        <//>
      <//>

      <${Section} id="color" title="颜色" lead="页面与组件只用语义色。中性色按主题精调；品牌与状态色来自原始色板。点击 token 名复制 var()。">
        ${sem && ["环境", "材质", "表面", "线", "文字", "品牌", "状态"].map((g) => html`<h3 class="t-label">${g}</h3><${ColorRows} tokens=${group(sem, g).filter((t) => !/^[\d.]+$/.test(t.src))} />`)}
        ${prim && html`<h3 class="t-label">原始色板（只在 semantic.css 里引用）</h3>
          <${ColorRows} tokens=${[...group(prim, "品牌"), ...group(prim, "状态色"), ...group(prim, "黑白")]} />`}
      <//>

      <${Section} id="material" title="材质" lead="窗口最底层是环境光（--bg + 左上的品牌黄绿光 + 跟着当前机器人变的色相光）。侧栏直接盖在环境光上；主区和信息面板是浮起的面板；顶栏、输入框、菜单、对话框是盖在内容上的毛玻璃——半透明底 + 背景模糊 + 磨砂颗粒 + 顶边高光与细描边。系统开了「降低透明度」时，材质换成接近实色。">
        <${Demo} flush title="六种材质" note="底下是会滚过去的内容：顶栏、输入框、菜单、对话框会把它模糊掉" code=${`<div class="glass" style="--glass-bg: var(--glass-pop); --glass-blur: var(--glass-filter-lg); --glass-shadow: var(--shadow-pop)">…</div>
.pop { background: var(--grain), var(--glass-pop); backdrop-filter: var(--glass-filter-lg); box-shadow: var(--shadow-pop); }   /* 组件自己就是玻璃时直接写三行 */`}>
          ${() => html`<${GlassStage} />`}
        <//>
      <//>

      <${Section} id="type" title="文字" lead="9 级字号；新界面优先用文字角色类（.t-*），不再挑字号。">
        ${prim && html`<${ScaleRows} tokens=${group(prim, "字号")} sample=${(t) => html`<span style=${{ fontSize: `var(${t.name})` }}>模型网关 Modelflare 0123</span>`} />`}
        <h3 class="t-label">文字角色</h3>
        <${Demo} col code=${`<div class="t-heading">…</div>  <p class="t-meta">…</p>`}>
          ${() => html`${[["t-display", "引导页标题"], ["t-heading", "对话框 / 页面标题"], ["t-title", "列表标题"], ["t-prose", "对话正文：15px，行高 1.5"], ["t-body", "界面正文：13px"], ["t-control", "控件文字：12.5px"], ["t-meta", "次要说明：11.5px，muted"], ["t-label", "分组标题、菜单分组：11px semibold，不加字距"]].map(
            ([c, s]) => html`<div class="cluster"><code class="t-meta" style="width:96px">.${c}</code><span class=${c}>${s}</span></div>`,
          )}`}
        <//>
      <//>

      <${Section} id="space" title="间距与尺寸" lead="间距以 4 为步长；页面和组件优先用按用途命名的间距角色，一个角色只用一个值；圆角嵌套时内层 = 外层 − 内边距；控件高度 6 档。">
        ${prim && html`<h3 class="t-label">间距</h3><${ScaleRows} tokens=${group(prim, "间距")} sample=${(t) => html`<div class="gal-bar" style=${{ "--w": `var(${t.name})` }}></div>`} />`}
        ${roles && roles.map((g) => html`<h3 class="t-label">间距角色 · ${g.name}</h3><${ScaleRows} tokens=${g.tokens.map((t) => ({ ...t, src: t.src.replace(/^var\((--[\w-]+)\)$/, "$1") }))} sample=${(t) => html`<div class="gal-bar" style=${{ "--w": `var(${t.name})` }}></div>`} />`)}
        ${prim && html`
          <h3 class="t-label">圆角</h3><${ScaleRows} tokens=${group(prim, "圆角")} sample=${(t) => html`<div class="gal-radius" style=${{ "--r": `var(${t.name})` }}></div>`} />
          ${radii && html`<h3 class="t-label">圆角角色（同一种面只用一个圆角）</h3><${ScaleRows} tokens=${radii.flatMap((g) => g.tokens).map((t) => ({ ...t, src: t.src.replace(/^var\((--[\w-]+)\)$/, "$1") }))} sample=${(t) => html`<div class="gal-radius" style=${{ "--r": `var(${t.name})` }}></div>`} />`}
          <h3 class="t-label">控件高度</h3><${ScaleRows} tokens=${group(prim, "控件高度")} sample=${(t) => html`<div class="gal-height" style=${{ "--h": `var(${t.name})` }}></div>`} />`}
      <//>

      <${Section} id="elevation" title="投影与层级" lead="投影是主题 token（深色下更重）；层级只用 --z-*，同一窗格内的浮动件用 calc(var(--z-float) ± 1)。">
        <${Demo} title="投影">
          ${() => html`${["--shadow-xs", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-pane", "--shadow-tile", "--shadow-float", "--shadow-pop", "--primary-edge"].map((s) => html`<div class="gal-elev" style=${{ "--sh": `var(${s})` }}><code class="t-meta">${s}</code></div>`)}`}
        <//>
        ${prim && html`<${ScaleRows} tokens=${group(prim, "层级")} sample=${() => ""} />`}
      <//>

      <${Section} id="motion" title="动效" lead="状态反馈 fast，出现/消失 base，视图与面板 moderate，弹出层 slow/slower + spring。入场 ease-out，退场 ease-in。">
        <div class="cluster" style="margin-bottom: var(--space-3)">
          <${Seg} label="减少动态效果" value=${reduced ? "on" : "off"} onChange=${(v) => setReduced(v === "on")} options=${[["off", "正常"], ["on", "模拟减少动态效果（--motion: 0）"]]} />
        </div>
        <div style=${reduced ? { "--motion": "0" } : {}}>
          <h3 class="t-label">时长</h3>
          <div class="gal-rows">${motion.filter((t) => /^--dur-(fast|base|moderate|slow|slower)$/.test(t.name)).map((t) => html`<div class="gal-row scale" key=${t.name}>
            <${TokenName} t=${t} /><code class="t-meta">${t.src}</code><${Runner} d=${t.name} /></div>`)}</div>
          <h3 class="t-label">缓动</h3>
          <div class="gal-rows">${motion.filter((t) => t.name.startsWith("--ease-")).map((t) => html`<div class="gal-row scale" key=${t.name}>
            <${TokenName} t=${t} /><svg class="gal-curve" viewBox="0 0 56 56"><rect width="56" height="56" /><path d=${bezierPath(t.src)} /></svg><${Runner} d="--dur-slower" e=${t.name} /></div>`)}</div>
          <h3 class="t-label">关键帧库</h3>
          <${Demo} code=${`<div class="anim-rise-in">…</div>        /* 可用 --anim-dur / --anim-ease / --anim-delay 微调 */
.toast { --rise: 6px; animation: rise-in var(--dur-base) var(--ease-out); }   /* 组件里直接用关键帧 + token */
const { mounted, leaving } = usePresence(open);   /* design/motion.js：退场动画播完再卸载 */`}>
            ${() => html`${[["anim-fade-in", "fade-in"], ["anim-rise-in", "rise-in"], ["anim-slide-in", "slide-in"], ["anim-pop-in", "pop-in"], ["anim-scale-in", "scale-in"], ["anim-sink-out", "sink-out"], ["anim-pop-out", "pop-out"], ["anim-bump", "bump"], ["anim-flash", "flash"]].map(([c, l]) => html`<${Replay} cls=${c} label=${l} />`)}
              <div class="gal-anim"><${Spinner} /><span class="t-meta">spin</span></div>
              <div class="gal-anim"><span class="typing"><i></i><i></i><i></i></span><span class="t-meta">breathe（stagger）</span></div>
              <div class="gal-anim"><span><span class="caret"></span></span><span class="t-meta">blink</span></div>
              <div class="gal-anim"><span class="shimmer">思考中 12 秒</span><span class="t-meta">sheen（文字微光）</span></div>`}
          <//>
        </div>
      <//>

      <${Section} id="states" title="状态矩阵" lead="每个可交互组件的全部状态，浅色一行、深色一行，画在它真实所在的表面上（主区或侧栏玻璃）。悬停、按下、键盘焦点是把样式表里的伪类规则复制成 .is-hover / .is-active / .is-focus 静态画出来的，和真实交互用的是同一份样式；把指针移上去也能直接试。">
        ${STATE_ROWS.map((r) => html`<${StateRow} key=${r.name} ...${r} />`)}
      <//>

      <${Section} id="icons" title="图标" lead="16 格画布的线性图标，五档尺寸 xs 12 · sm 14 · md 16 · lg 20 · xl 24；线宽按显示像素算（--ic-stroke 1.25px），任何尺寸都一样细，实心面上的图标用 strong（1.6px）。默认 sm，顶栏、侧栏和对话输入框用 md。">
        <${Demo} title="全部图标" note="sm · 14px" code=${`<${"${Icon}"} name="gear" size="sm" />   /* 尺寸只用 xs / sm / md / lg / xl */
.pick .ic { --ic-size: var(--ic-xs); }   /* 上下文改尺寸只改 --ic-size，线宽自动跟着换算 */`}>
          ${() => ICONS.map((n) => html`<span class="gal-icon" key=${n} title=${n}><${Icon} name=${n} size="sm" /><span class="t-meta">${n}</span></span>`)}
        <//>
        <${Demo} title="五档尺寸" note="同一个图标放大缩小，线宽不变">
          ${() => html`${["xs", "sm", "md", "lg", "xl"].map((s) => html`<span class="gal-icon" key=${s}><span class="cluster" style="--gap: var(--space-2)"><${Icon} name="gear" size=${s} /><${Icon} name="chat" size=${s} /><${Icon} name="search" size=${s} /></span><span class="t-meta">${s}</span></span>`)}
            <span class="gal-icon"><button type="button" class="send" tabindex="-1" aria-label="发送"><${Icon} name="up" size="md" strong /></button><span class="t-meta">md strong</span></span>`}
        <//>
      <//>

      <${Section} id="buttons" title="按钮" lead="变体 primary / 默认 / ghost / danger，尺寸 sm / 默认 / lg。图标按钮必须有 label。">
        <${Demo} title=".btn" code=${`<button class="btn primary lg block">连接</button>
<${"${Button}"} variant="primary" size="lg" loading=\${busy} icon="plus">新建<//>`}>
          ${() => html`<${Button} variant="primary">主要<//><${Button}>默认<//><${Button} variant="ghost">幽灵<//><${Button} variant="danger">删除<//>
            <${Button} variant="primary" size="sm">小号<//><${Button} variant="primary" size="lg">大号<//>
            <${Button} icon="plus">带图标<//><${Button} variant="primary" loading>保存中<//><${Button} disabled>禁用<//>`}
        <//>
        <${Demo} title=".icon-btn · .text · CopyButton">
          ${() => html`<${IconButton} icon="gear" label="设置" /><${IconButton} icon="refresh" label="刷新" on /><${IconButton} icon="close" label="关闭" size="xs" iconSize="xs" />
            <${CopyButton} text="复制的内容" /><button type="button" class="text">文字按钮</button><button type="button" class="text accent">强调</button><button type="button" class="text danger">危险</button>`}
        <//>
      <//>

      <${Section} id="inputs" title="输入">
        <${Demo} col title=".field" note="唯一常驻描边的控件：--ctl-edge 对所在表面 ≥ 3:1；聚焦：accent 描边 + --ring 光晕" code=${`<input class="field mono err" />  <div class="field-wrap"><input class="field" /><span class="tail">…</span></div>`}>
          ${() => html`<${FieldDemo} />`}
        <//>
      <//>

      <${Section} id="menus" title="菜单与分段">
        <${Demo} title="Seg" note="两个以上的选项；中性 thumb 按值滑动">${() => html`<${SegDemo} />`}<//>
        <${Demo} title="Switch" note="只有开 / 关两态；打开 = 主操作色（浅色墨、深色黄绿）" code=${`<${"${Switch}"} label="长期记忆" value=\${on} onChange=\${setOn} />`}>${() => html`<${SwitchDemo} />`}<//>
        <${Demo} title="MenuButton · Menu" note="↑↓ 选择，Enter 执行，Esc 关闭">${() => html`<${MenuButtonDemo} /><${MenuDemo} />`}<//>
      <//>

      <${Section} id="status" title="状态与反馈">
        <${Demo} title="Badge · dot">
          ${() => html`${["connected", "running", "connecting", "pending", "error", "disabled"].map((s) => html`<${Badge} s=${s} />`)}
            <span class="badge count">3</span><span class="badge count warn">2</span>
            <span class="dot ok"></span><span class="dot warn"></span><span class="dot err"></span><span class="dot"></span>`}
        <//>
        <${Demo} col title="Notice" code=${`<${"${Notice}"} tone="amber" action=\${html\`<button class="btn">去控制台</button>\`}>…<//>`}>
          ${() => html`<${Notice} action=${html`<button type="button" class="btn">操作</button>`}>默认（中性）：内置网关已更新，重启后生效。<//>
            <${Notice} tone="amber" action=${html`<button type="button" class="btn">去控制台</button>`}>这个 Key 所在的分组暂无可用模型。<//>
            <${Notice} tone="red" action=${html`<button type="button" class="btn">重试</button>`}>无法连接本机服务：ECONNREFUSED<//>`}
        <//>
        <${Demo} col title="Skeleton · Spinner · 空状态">
          ${() => html`<div class="cluster"><${Skeleton} w="34px" circle /><div class="stack grow"><${Skeleton} w="40%" /><${Skeleton} w="70%" /></div></div>
            <div class="cluster"><${Spinner} /><span class="t-meta">加载中…</span></div>
            <div class="empty-state"><b>还没有会话</b>在微信或飞书里给机器人发一条消息试试</div>`}
        <//>
      <//>

      <${Section} id="lists" title="列表行" lead="设置页的基本单元：一组 .list（--well 底色、不描边），每行说明在左、控件在右，行与行之间一条细线，改动即保存。">
        <${Demo} flush>
          ${() => html`<div class="list">
            <div class="row"><div class="who"><div class="name">外观</div><div class="sub">跟随系统、浅色或深色</div></div><div class="ctl"><${SegDemo} /></div></div>
            <div class="row"><div class="who"><div class="name">长期记忆</div><div class="sub">开 / 关用 Switch</div></div><div class="ctl"><${Switch} label="长期记忆" value=${true} onChange=${() => {}} /></div></div>
            <div class="row"><div class="who"><div class="name">默认模型</div><div class="sub">新对话使用的模型</div></div><div class="ctl"><${MenuButtonDemo} /></div></div>
            <div class="row"><div class="who"><div class="name">Modelflare</div><div class="sub">已连接 ••••x9Qa</div></div><div class="ctl"><${Badge} s="connected" /><button type="button" class="text">更换密钥</button></div></div>
            <div class="row compact clickable"><div class="who"><div class="name">.row.compact.clickable</div><div class="sub">信息面板里的紧凑行</div></div><span class="hint num">3 分钟前</span></div>
            <div class="row-edit"><label>展开编辑区 .row-edit<input class="field" placeholder="App ID" /></label><div class="actions"><${Button} variant="primary">保存<//><${Button}>取消<//></div></div>
          </div>`}
        <//>
      <//>

      <${Section} id="splitter" title="分隔条" lead="两块面板之间的空隙可以拖：侧栏和主区、主区和信息面板。平时看不见，只有指针变成 ↔；停住一会儿空隙中间长出一道细线；拖到离默认宽度 6px 以内会吸附回去，到头了指针换成单向箭头；双击恢复默认。键盘：聚焦后 ← → 调整（Shift 大步）、Home / End 最窄 / 最宽、Enter 恢复默认。宽度存在本机偏好里。">
        <${Demo} flush title="Splitter" note="拖动中间的空隙试试（这里的宽度不保存）" code=${`<${"${Splitter}"} class="split-side" size="--side-w" label="调整侧栏宽度" value=\${sideW}
  room=\${() => innerWidth - 另一侧那一列 - mainMin} onCommit=\${(px) => setPrefs({ sideW: px })} />   /* px = 0：回到默认 */
.app { --side-col: clamp(var(--side-w-min), var(--side-w-user, var(--side-w)), min(var(--side-w-max), var(--side-w-cap))); }
.app > .split-side { --split-x: calc(var(--side-col) - var(--pane-gap) / 2); }   /* 分隔条在空隙正中 */`}>
          ${() => html`<div class="gal-split"><div class="gal-split-a"><span class="t-meta">侧栏</span></div>
            <${Splitter} size="--gal-split-w" label="调整示例侧栏宽度" />
            <div class="gal-split-b"><span class="t-meta">主区 · 双击空隙恢复默认宽度</span></div></div>`}
        <//>
      <//>

      <${Section} id="overlays" title="对话框与提示" lead="确认框默认聚焦「取消」；危险操作用 danger。对话框退场有动画（usePresence）。">
        <${Demo} title="confirmSheet · toast">
          ${() => html`<${Button} onClick=${() => confirmSheet({ title: "保存这些更改？", body: "改动会立即生效。" }).then((ok) => ok && saved())}>普通确认<//>
            <${Button} variant="danger" onClick=${() => confirmSheet({ title: "删除这个机器人？", body: "对话记录与记忆会一起删除，无法恢复。", confirmLabel: "删除", danger: true })}>危险确认<//>
            <${Button} onClick=${saved}>toast：已保存<//><${Button} onClick=${() => toast("配额快用完了", "warn")}>toast：warn<//><${Button} onClick=${() => failed("上游返回 HTTP 429")}>toast：err<//>`}
        <//>
      <//>

      <${Section} id="avatars" title="头像" lead="6 个内置毛绒角色，蓝色的天天是默认头像。每个机器人配一个，只决定长相，和它做什么无关：新建页和机器人设置里可以选，没选过时由 id 决定，默认机器人是天天。持续状态跟着平台走（你在输入、思考、回复、工作、等批准、睡觉），完成、出错、新建时播一次性反应；指针靠近时会看过去，大头像可以戳。">
        <${Demo} title="角色" note="96px · lively · 可以戳（连戳三下、六下试试）">${() => html`<${AvatarCastDemo} />`}<//>
        <${Demo} title="状态与反应" note="上面切持续状态，按钮播一次性反应；点右边的小头像换成主视图">${() => html`<${AvatarStateDemo} />`}<//>
        <${Demo} title="尺寸" note="22 顶栏 / 38 侧栏 / 56 / 96 空态；小于 36px 不画粒子。悬停 38px 那排，天线会弹一下">${() => html`<${AvatarSizeDemo} />`}<//>
        <${Demo} title="选择器" note="AvatarPicker：只选长相，和模板、人设无关">${() => html`<${AvatarPickerDemo} />`}<//>
      <//>

      <${Section} id="patterns" title="对话" lead="ui/css/chat.css 里的页面模式（顶栏参考 Grok Bot，对话流与输入框参考 Codex）：用户消息是浅灰气泡，回复是整列正文，上方一行工作状态，下方悬停出现操作。">
        <${Demo} col>
          ${() => html`<div class="gal-chat">
            <div class="msg-row user"><div class="msg">帮我比较一下几个模型</div><div class="msg-actions"><${CopyButton} text="帮我比较一下几个模型" /><span class="when num">09:24</span></div></div>
            <div class="msg-row assistant last"><div class="work-line"><span>用时 1 分 24 秒</span></div><div class="msg"><${Markdown} text=${MD} /></div>
              <div class="msg-actions"><${CopyButton} text=${MD} /><span class="when num">09:26</span></div></div>
            <div class="msg-row user"><div class="msg">再整理成日报</div></div>
            <div class="msg-row assistant"><div class="work-line live"><span class="shimmer">思考中 12 秒</span></div></div>
            <div class="msg-row assistant live"><div class="work-line live"><span class="shimmer">正在回复 4 秒</span></div><div class="msg"><${Markdown} text="好的，先按群把今天的消息分组，再挑出要你处理的" /></div></div>
            <div class="msg-row assistant"><div class="card"><div class="q-block"><div class="q">要用哪条线路？</div>
              <div class="opts"><button type="button" class="opt picked"><span class="letter">A</span><span>国内线路<span class="desc">延迟低</span></span></button>
              <button type="button" class="opt"><span class="letter">B</span><span>海外线路<span class="desc">模型更全</span></span></button></div></div></div></div>
            <div class="msg-row assistant"><div class="card"><div class="meta"><span>「竞品周报」想问你</span></div><div class="q-block"><div class="q">报告用中文还是英文？</div><div class="q-detail">不回复就按中文做</div>
              <div class="opts"><button type="button" class="opt"><span class="letter">A</span><span>中文</span></button>
              <button type="button" class="opt"><span class="letter">B</span><span>英文</span></button></div></div></div></div>
          </div>
          <div class="composer"><textarea rows="1" placeholder="给「我的助手」发消息，/ 查看命令"></textarea>
            <div class="composer-bar"><button type="button" class="plus" aria-label="更多"><${Icon} name="plus" size="md" /></button><span class="grow"></span>
              <button type="button" class="model-chip"><span class="v">claude-sonnet-5-5</span><${Icon} name="chevDown" /></button>
              <button type="button" class="send" aria-label="发送"><${Icon} name="up" size="md" strong /></button></div></div>
          <div class="chips"><button type="button" class="chip">总结今天的消息</button><button type="button" class="chip">写一封邮件</button></div>`}
        <//>
        <${Demo} col title="回合中间说的话与交付的文件" note="模型在工具调用之间说的话按顺序写在回复里，最后的回复接在后面，处理过程只列步骤；present 交付的文件挂在文字下面：图片直接显示（限宽 320、限高 240，保持比例，点开看大图），其它是文件卡片（桌面版点开用系统程序打开，右边在文件夹中显示；网页里点开在新标签页打开），找不到的文件不能点">
          ${() => html`<div class="gal-chat">
            <div class="msg-row user"><div class="msg">把下载目录里的截图整理一下，挑一张做封面</div></div>
            <div class="msg-row assistant live"><div class="activity"><button type="button" class="work-line toggle live" aria-expanded="false"><span class="wl shimmer">运行 bash，已用 6 秒</span><${Icon} name="chevRight" size=${12} class="chev" /></button></div>
              <div class="msg"><${Markdown} text="我先看看下载目录里有什么。" /></div></div>
            <div class="msg-row assistant last"><div class="activity"><button type="button" class="work-line toggle" aria-expanded="false"><span class="wl">用时 18 秒</span><${Icon} name="chevRight" size=${12} class="chev" /></button></div>
              <div class="msg"><${Markdown} text=${INTERIM_REPLY} /></div>
              <div class="msg-files">
                <button type="button" class="msg-img" title="打开 cover.png"><img src="../assets/guide-demo.svg" alt="cover.png" /></button>
                <div class="file-card"><button type="button" class="file-open" title="打开 截图清单.pdf"><${Icon} name="file" size="xl" class="fic" /><span class="grow"><span class="fname">截图清单.pdf</span><span class="fsub num">1.2 MB</span></span></button>
                  <${IconButton} icon="folder" label="在文件夹中显示" /></div>
                <a class="file-card" href="#patterns" title="打开 整理记录.md"><${Icon} name="file" size="xl" class="fic" /><span class="grow"><span class="fname">整理记录.md</span><span class="fsub num">2.4 KB</span></span></a>
                <div class="file-card off"><${Icon} name="file" size="xl" class="fic" /><span class="grow"><span class="fname">旧的截图.zip</span><span class="fsub">找不到文件</span></span></div>
              </div>
              <div class="msg-actions"><${CopyButton} text=${INTERIM_REPLY} /><span class="when num">10:02</span></div></div>
          </div>`}
        <//>
      <//>

      <${Section} id="needs" title="需要你" lead="所有机器人里在等你的事：提问和审批在前，再是失败、没送到、登录，问要不要改为执行的最后。侧栏那一行和托盘角标只在有事时出现；一件一块，操作在行里，点标题行展开任务详情。">
        <${Demo} title="侧栏" note="NeedsRow：件数为 0 时不画">
          ${() => html`<div class="gal-strip-in" style="width: 264px; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-side)">
            <${NeedsRow} count=${3} onClick=${() => {}} /><${NeedsRow} count=${2} on onClick=${() => {}} /><${NeedsRow} count=${0} />
          </div>`}
        <//>
        <${Demo} flush col title="列表" note="NeedItem：标题行是一句话，几个机器人时带上名字（「天天的「GPU 价格调研」在等你回答」）。等你回答 / 等你回答（任务接着在做，不回复就按默认）/ 等你批准 / 预算用完（再给 $1 继续？）/ 未送达 / 失败 / 规则本月预算用完 / 登录过期 / 预算留给聊天 / 观察够了，要不要改为执行（不推送）">
          ${() => html`<div class="list needs-list">${NEEDS.map((it) => html`<${NeedItem} item=${it} multiBot onAct=${async () => {}} />`)}</div>`}
        <//>
      <//>

      <${Section} id="rules" title="规则" lead="信息面板「任务」组里一条规则一行：时间表 · 标题，下面一句状态和下次运行（「观察中，明天 08:00 再运行」）。观察够了要不要改为执行，在「需要你」里问（从不推送）。点开是同一块里的详情和运行记录，记录一次一行、不画分隔线，再点开一行看报告。">
        <${Demo} title="行" note="RuleRow：观察中 / 执行中 / 暂停 / 提醒">
          ${() => html`<div class="panel-body" style="width: 340px; flex: none; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-panel)">
            <div class="list">${RULES.map((r) => html`<${RuleRow} rule=${r} open=${false} onToggle=${() => {}} />`)}</div>
          </div>`}
        <//>
        <${Demo} title="暂停" note="PausedLine：后台工作暂停时信息面板最上面这一行，没暂停时不画">
          ${() => html`<div class="panel-body" style="width: 340px; flex: none; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-panel)">
            <${PausedLine} onResume=${async () => {}} />
          </div>`}
        <//>
        <${Demo} title="详情与运行记录" note="RuleDetail：原话、模式、立即运行、运行记录（本会发送 / 保持安静 / 失败 / 跳过）">
          ${() => html`<div class="panel-body" style="width: 340px; flex: none; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-panel)">
            <div class="list"><div class="row-edit rule-edit"><${RuleDetail} rule=${RULES[0]} runs=${RULE_RUNS} /></div></div>
          </div>`}
        <//>
      <//>

      <${Section} id="tasks" title="任务" lead="信息面板的「任务」组就是一个机器人的全部任务和规则：进行中、等你的在前，规则其次，结束了的收在最后一行里，点开才列出来（留 30 天）。一个任务一行，第二行是一句话（「已进行 12 分钟，花了约 $0.08」「15:33 完成」），点开是同一块里的详情：来自、最新进展、预算（可以改）、文件夹（大小、打开）、要清理时的日期和保留、每次运行折叠的处理过程。什么都没有时整组不画。">
        <${Demo} title="「任务」组" note="TaskGroup：进行中 / 进行中，有个问题等你回答（问了个有默认回答的问题，接着在做）/ 等你回答 / 规则 / 已结束 1（点开列出结束了的，那个文件夹 3 天后清理）">
          ${() => html`<div class="panel-body" style="width: 340px; flex: none; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-panel)">
            <${TaskGroup} botId="b" tasks=${TASKS} rules=${[RULES[0]]} ended=${ENDED} details=${{ t1: TASK_DETAIL, t4: ASKING_DETAIL, t2: ASK_DETAIL, t3: ENDED_DETAIL }} />
          </div>`}
        <//>
        <${Demo} title="问了还在做" note="TaskRow 展开：问题（下面一句不回复就按中文做）· 最新进展 · 预算 · 运行中；对话里的胶囊点开是同一份详情">
          ${() => html`<div class="panel-body" style="width: 340px; flex: none; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-panel)">
            <div class="list"><${TaskRow} task=${ASKING} open data=${ASKING_DETAIL} onToggle=${() => {}} onOpenConv=${() => {}} /></div>
          </div>`}
        <//>
        <${Demo} col title="对话里的胶囊" note="TaskChip：一句话「后台任务「GPU 价格调研」进行中」，太长时只截标题；点开是详情（不写来自）">
          ${() => html`<div class="gal-chat"><div class="msg-row assistant"><${TaskChip} task=${TASKS[0]} data=${TASK_DETAIL} /></div>
            <div class="msg-row assistant"><${TaskChip} task=${ASKING} data=${ASKING_DETAIL} /></div></div>`}
        <//>
        <${Demo} title="详情" note="TaskRow 展开：来自 · 最新进展 · 预算 约 $0.08 / $1.00（改） · 文件夹 2.3 MB（打开） · 第 1 次运行，已进行 12 分钟 · 停止 / 导出">
          ${() => html`<div class="panel-body" style="width: 340px; flex: none; padding: var(--space-2); border-radius: var(--r-pane); background: var(--grain), var(--glass-panel)">
            <div class="list"><${TaskRow} task=${TASKS[0]} open data=${TASK_DETAIL} onToggle=${() => {}} onOpenConv=${() => {}} /></div>
          </div>`}
        <//>
      <//>

      <${Section} id="win-caption" title="Windows 标题栏" lead="Windows 桌面版的右上角是系统画的最小化、最大化、关闭，和侧栏顶部那一行一样高。最右边的面板贴住这个角，按钮落在它的顶栏上；顶栏的内容仍和侧栏顶部在同一条中线上。下面是模拟的窗口：真的样式表加上 win-app，右上角三个按钮是替身。">
        <${WinCase} name="信息面板关着" note="主区贴住右上角。点顶栏的面板钮开合，或悬停关闭钮" />
        <${WinCase} name="信息面板开着" note="信息面板贴住右上角，主区照旧浮着" open />
        <${WinCase} name="窗口窄：信息面板是抽屉" note="1000 宽；抽屉贴住右上角，主区在它底下不动" w=${1000} open />
        <${WinCase} name="设置" note="内容滚到窗口上沿，从按钮底下过" screen="settings" />
        <${WinCase} name="引导页" note="没有面板，按钮直接在环境光上" w=${1000} screen="onboard" />
      <//>

      <${Section} id="custom" title="定制" lead="不改组件源码：在上下文里覆盖组件变量；需要一块不同主题的区域时，加 data-theme。">
        <${Demo} title="覆盖组件变量" code=${`.notice .btn { --btn-h: var(--ctl-sm); --btn-px: var(--space-2-5); }      /* 上下文覆盖 */
<button class="btn" style="--btn-bg: var(--green-soft); --btn-fg: var(--green)">…</button>
.thread .badge.count { --badge-bg: var(--amber-soft); --badge-fg: var(--amber); }`}>
          ${() => html`<button type="button" class="btn" style="--btn-bg: var(--green-soft); --btn-fg: var(--green); --btn-bg-hover: var(--green-soft)">绿色按钮</button>
            <button type="button" class="btn primary" style="--btn-r: var(--r-full); --btn-px: var(--space-5)">胶囊主按钮</button>
            <span class="badge" style="--badge-fg: var(--accent)">自定义状态点</span>
            <div class="seg" style="--seg-thumb: var(--card); --seg-on: var(--fg)"><span class="thumb" style="width:52px;transform:translateX(0)"></span><button type="button" class="on">中性</button><button type="button">分段</button></div>`}
        <//>
        <${Demo} title="局部主题" code=${`<div data-theme="dark">…</div>   /* 子树换一套语义 token */`}>
          ${() => html`<div data-theme="dark" class="cluster" style="padding: var(--space-3); border-radius: var(--r-xl)"><${Button} variant="primary">深色区域<//><${Badge} s="running" /><span class="t-meta">--bg / --fg 自动切换</span></div>
            <div data-theme="light" class="cluster" style="padding: var(--space-3); border-radius: var(--r-xl)"><${Button} variant="primary">浅色区域<//><${Badge} s="running" /></div>`}
        <//>
      <//>
      </div>
    </main>
    <${Toasts} />
    <${DialogHost} />
  </div><//>`;
}

/** 「需要你」的样例（单人：一个人用自己的机器人） */
const NEEDS = [
  { id: "q", kind: "question", botName: "天天", subject: "GPU 价格调研", status: "等你回答", head: "「GPU 价格调研」在等你回答", line: "报告用中文还是英文？", since: Date.now() - 2 * 60_000, severity: "warn", questions: [{ id: "a", question: "报告用中文还是英文？", options: [{ label: "中文" }, { label: "英文" }] }] },
  { id: "qd", kind: "question", botName: "天天", subject: "竞品周报", status: "等你回答", head: "「竞品周报」在等你回答", line: "报告用中文还是英文？", note: "不回复就按中文做", since: Date.now() - 3 * 60_000, severity: "warn", taskId: "t4", questions: [{ id: "answer", question: "报告用中文还是英文？", options: [{ label: "中文" }, { label: "英文" }], default: "中文" }] },
  { id: "a", kind: "approval", botName: "天天", subject: "清理旧构建", status: "等你批准", head: "「清理旧构建」在等你批准", line: "rm -rf build/", since: Date.now() - 5 * 60_000, severity: "warn" },
  { id: "bq", kind: "question", botName: "天天", subject: "季度报告 PPT", status: "预算用完", head: "「季度报告 PPT」预算用完了", line: "已用约 $1.00，再给 $1 继续？", since: Date.now() - 8 * 60_000, severity: "warn", questions: [{ id: "budget", question: "已用约 $1.00，再给 $1 继续？", options: [{ label: "继续" }, { label: "停止" }] }] },
  { id: "d", kind: "delivery", botName: "天天", subject: "1 条结果未送达微信", status: "在微信里发条消息就能收到", head: "1 条结果未送达微信，在微信里发条消息就能收到", line: "季度报告做好了，在 tasks 文件夹里。", since: Date.now() - 20 * 60_000, severity: "warn", actions: [] },
  { id: "f", kind: "failed", botName: "哒哒", subject: "季度报告", status: "失败", head: "「季度报告」失败了", line: "X 云的价格页要登录，我进不去", since: Date.now() - 40 * 60_000, severity: "err" },
  { id: "r", kind: "rule", botName: "哒哒", subject: "规则「每日 issue 巡检」", status: "连续失败 3 次，已暂停", head: "规则「每日 issue 巡检」连续失败 3 次，已暂停", line: "GitHub 返回 401：令牌可能过期了", since: Date.now() - 90 * 60_000, severity: "err", actions: ["retry"] },
  { id: "rb", kind: "rule", botName: "天天", subject: "规则「看 X 价格」", status: "本月预算用完", head: "规则「看 X 价格」本月预算用完了", line: "已用约 $3.00，下月自动恢复。再给 $3 继续？", since: Date.now() - 2 * 3600_000, severity: "warn", actions: ["continue"] },
  { id: "l", kind: "login", botName: "芽芽", subject: "微信登录已过期", status: "", head: "微信登录已过期", line: "", since: Date.now() - 3 * 3600_000, severity: "err" },
  { id: "rs", kind: "budget", botName: "天天", subject: "后台工作已停", status: "", head: "后台工作已停", line: "机器人预算只剩约 $1.80（共 $10），留给聊天", since: Date.now() - 4 * 3600_000, severity: "warn", actions: ["open"] },
  { id: "s", kind: "suggest", botName: "天天", subject: "规则「看 X 价格」已观察 3 次，需要你来决定是否执行", status: "", head: "规则「看 X 价格」已观察 3 次，需要你来决定是否执行", line: "本会发送：“X 降价了，现在 ¥199（昨天 ¥259）”", since: Date.now() - 6 * 3600_000, severity: "warn", actions: ["act", "dismiss"], ruleTitle: "看 X 价格" },
];

/** 任务的样例（单人：自己的机器人天天）：在调研的、问了个有默认回答的问题接着在做的、等你回答的、昨天做完的（文件夹 3 天后清理） */
const ago = (min) => Date.now() - min * 60_000;
const task = (o) => ({ botId: "b", conversationId: "b:weixin:me", channel: "weixin", latest: "", runs: 1, spentUsd: 0, budgetUsd: 1, cleanupAt: 0, endedAt: 0, ...o });
const TASKS = [
  task({ id: "t1", title: "GPU 价格调研", stage: { key: "working", label: "进行中", group: "working" }, createdAt: ago(12), updatedAt: ago(1), spentUsd: 0.08, latest: "已比较 3 家，正在核对 B 云的包年价", folder: "tasks/gpu-prices-3f2a1c" }),
  task({ id: "t4", title: "竞品周报", stage: { key: "working/asking", label: "进行中，有个问题等你回答", group: "working" }, createdAt: ago(20), updatedAt: ago(3), spentUsd: 0.05, latest: "三家的更新都整理好了，在写对比", folder: "tasks/weekly-7d1e20", question: { text: "报告用中文还是英文？", note: "不回复就按中文做" } }),
  task({ id: "t2", title: "季度报告 PPT", stage: { key: "needs-you/answer", label: "等你回答", group: "needs" }, createdAt: ago(50), updatedAt: ago(5), spentUsd: 0.21, folder: "tasks/task-8c0d42", question: { text: "PPT 要几页？" } }),
];
const ASKING = TASKS[1];
const ENDED = [
  task({ id: "t3", title: "整理下载目录", stage: { key: "ready", label: "已完成", group: "ended" }, createdAt: ago(27 * 1440), endedAt: ago(27 * 1440 - 20), updatedAt: ago(27 * 1440 - 20), spentUsd: 0.02, latest: "按类型分到 6 个文件夹，重复的 14 个放进了 duplicates", folder: "tasks/downloads-9b1e07", cleanupAt: Date.now() + 3 * 86_400_000 }),
];
const step = (id, title, summary) => ({ id, kind: "tool", title, summary, status: "ok", at: 0 });
const TASK_DETAIL = {
  task: TASKS[0],
  origin: { channel: "weixin", at: ago(12), text: "帮我调研一下三家云的 GPU 价格，A100 包月的，好了告诉我" },
  sizes: { folder: 2_400_000, sessions: 1_100_000 },
  canOpen: true,
  runs: [{ id: "r1", cause: "launch", state: "running", outcome: "", queuedAt: ago(12), startedAt: ago(12), endedAt: 0, steps: 3, stepList: [step("s1", "web_fetch", "x-cloud.example/pricing"), step("s2", "web_fetch", "b-cloud.example/gpu"), step("s3", "write", "prices.md")] }],
};
const ASKING_DETAIL = {
  task: ASKING,
  origin: { channel: "weixin", at: ago(20), text: "后台帮我把三家竞品这周的更新整理成周报" },
  sizes: { folder: 640_000, sessions: 420_000 },
  canOpen: true,
  runs: [{ id: "r4", cause: "launch", state: "running", outcome: "", queuedAt: ago(20), startedAt: ago(20), endedAt: 0, steps: 2, stepList: [step("s4", "web_fetch", "a.example/changelog"), step("s5", "write", "weekly.md")] }],
};
const ASK_DETAIL = {
  task: TASKS[2],
  origin: { channel: "weixin", at: ago(50), text: "后台帮我把季度数据做成 PPT" },
  sizes: { folder: 5_600_000, sessions: 900_000 },
  canOpen: true,
  runs: [{ id: "r3", cause: "launch", state: "ended", outcome: "needs_you", queuedAt: ago(50), startedAt: ago(50), endedAt: ago(5), steps: 0 }],
};
const ENDED_DETAIL = {
  task: ENDED[0],
  origin: { channel: "weixin", at: ago(27 * 1440 + 10), text: "把下载目录整理一下" },
  sizes: { folder: 820_000, sessions: 300_000 },
  canOpen: true,
  runs: [{ id: "r2", cause: "launch", state: "ended", outcome: "done", queuedAt: ago(27 * 1440 + 10), startedAt: ago(27 * 1440 + 10), endedAt: ago(27 * 1440 - 20), steps: 0 }],
};

/** 规则的样例（单人：自己的机器人天天）：每天 8 点看 X 价格（观察中）、每周的 issue 周报、暂停了的巡检、一次性的提醒 */
const at = (days, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const rule = (o) => ({ botId: "b", kind: "check", mode: "observe", failures: 0, channel: "weixin", message: "", trigger: { kind: "schedule" }, version: 1, ...o });
const RULES = [
  rule({ id: "g1", title: "看 X 价格", when: "每天 08:00", instruction: "每天早上看看 X 的价格，降到 200 以下告诉我", state: { key: "observe", label: "观察中", dot: "" }, nextRunAt: at(1, 8), monthUsd: 0.41, monthBudgetUsd: 3 }),
  rule({ id: "g2", title: "issue 周报", when: "每周一 09:00", instruction: "每周一早上把仓库上周的 issue 汇总成三句话发给我", mode: "act", state: { key: "act", label: "执行中", dot: "ok" }, nextRunAt: at(3, 9) }),
  rule({ id: "g3", title: "每日 issue 巡检", when: "每天 08:30", instruction: "每天看看有没有新的 issue 需要我回复", mode: "act", state: { key: "paused", label: "已暂停", dot: "err" }, failures: 3, nextRunAt: 0 }),
  rule({ id: "g4", title: "交房租", when: "11月3日 12:00", kind: "remind", mode: "act", message: "该交房租了。", state: { key: "remind", label: "提醒", dot: "ok" }, nextRunAt: at(2, 12) }),
];
const RULE_RUNS = [
  { id: "x1", at: at(0, 8), mode: "observe", line: "本会发送：“X 降价了，现在 ¥199（昨天 ¥259）”", summary: "X 现在 ¥199，比昨天低 ¥60，低于 200。", would: "", version: 1, permission: "只读", steps: 0, cause: "schedule", costUsd: 0.03 },
  { id: "x2", at: at(-1, 8), mode: "observe", line: "本会保持安静：X 现在 ¥259", summary: "X 现在 ¥259，高于 200。", would: "", version: 1, permission: "只读", steps: 0, cause: "schedule", costUsd: 0.02 },
  { id: "x3", at: at(-2, 8), mode: "observe", line: "失败：页面打不开", summary: "", would: "", version: 1, permission: "只读", steps: 0, cause: "schedule", costUsd: 0.01 },
  { id: "x4", at: at(-5, 8), mode: "observe", line: "跳过：电脑没开", summary: "", would: "", version: 1, permission: "", steps: 0, cause: "schedule" },
];

// 等 @import 进来的样式表都加载完再复制伪类规则
if (document.readyState === "complete") mirrorPseudoStates();
else addEventListener("load", mirrorPseudoStates, { once: true });
render(html`<${Gallery} />`, document.getElementById("app"));
