// @ts-nocheck 第三方模块的路径由服务端映射（web/botapp.ts），这里解析不到
// 界面套件：Bot 的专属界面只引用这一个文件（/amb/botapp/kit/kit.js），文档见 docs/bot-framework.md。
// 界面跑在沙箱 iframe 里，不能联网、不能碰 App 的接口：数据和操作都经 useBot() 走父页面（ui/lib/bot-bridge.js）。
// 主题、语言、字号、动效偏好由父页面下发，这里写到 <html> 上，设计系统的 token 自动跟随，Bot 不用管。
import { h, render } from "./vendor/preact.mjs";
import { useEffect, useMemo, useRef, useState } from "./vendor/hooks.mjs";
import htm from "./vendor/htm.mjs";

export const html = htm.bind(h);
export { useEffect, useMemo, useRef, useState };

/** Compact project picker in a side panel; persistent navigation in a wide workspace.
 * Keep both the navigation and editor mounted while changing layout. */
export function Workspace({ label, current, children }) {
  const picker = useRef(null);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    const outside = (event) => {
      if (!media.matches && picker.current?.open && !picker.current.contains(event.target)) picker.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); media.removeEventListener("change", change); };
  }, []);
  const [navigation, ...content] = Array.isArray(children) ? children : [children];
  return html`<div class="kit-ws">
    <details class="kit-ws-picker" ref=${picker} open=${wide || undefined} onKeyDown=${(event) => {
      if (!wide && event.key === "Escape" && picker.current.open) {
        event.preventDefault(); event.stopPropagation(); picker.current.open = false;
        picker.current.querySelector("summary")?.focus();
      }
    }} onClick=${(event) => {
      if (!wide && event.target.closest(".kit-item, .kit-list-head button")) {
        picker.current.open = false;
        picker.current.querySelector("summary")?.focus();
      }
    }}>
      <summary class="kit-ws-choice" title=${current}><span class="t-meta">${label}</span><strong>${current || label}</strong><span aria-hidden="true">▾</span></summary>
      <div class="kit-ws-options">${navigation}</div>
    </details>
    ${content}
  </div>`;
}

let seq = 0;
const waiting = new Map();
const listeners = new Set();
const mediaHandles = new Map();

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (!m || m.amb !== 1) return;
  if (m.id !== undefined && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) reject(new Error(m.error));
    else resolve(m.result);
    return;
  }
  if (m.event) for (const l of listeners) l(m.event, m.data);
});

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    // 沙箱页是不透明来源，父页面靠 event.source 认人
    window.parent.postMessage({ amb: 1, id, method, params }, "*");
  });
}

const on = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function applyEnv(env) {
  const root = document.documentElement;
  if (env.lang) root.setAttribute("lang", env.lang);
  if (env.theme) root.setAttribute("data-theme", env.theme);
  if (env.text) root.setAttribute("data-text", env.text);
  if (env.motion) root.setAttribute("data-motion", env.motion);
}

const fillParams = (s, params) => (params ? String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m)) : s);

/**
 * Bot 的全部能力：
 * ready、sample（还是示例数据）、state（app/state.json 的内容，不合约定的部分已剪掉）、issues、busy（Bot 正在回复）、lang、bot、t(key, params)、
 * desktop（桌面版，能用系统程序打开文件）、send(text, action)、stop()、pickFile({ accept, multiple })、readFile(path)、
 * readImage(path)（读 app/ 下的图片，返回 { url }，放进 <img>）、openFile(path, { reveal })（要在用户点击时调用：
 * 在右侧预览，reveal 在文件夹中显示，面板中另有下载/系统打开）、openUrl(url)（用户确认后在右侧预览网页）。state 有变化时界面自动重新渲染。
 */
export function useBot() {
  const [s, set] = useState({ ready: false, sample: false, desktop: false, state: null, issues: [], busy: false, lang: "en", bot: null, messages: {} });
  const reload = useRef(() => {});
  useEffect(() => {
    let alive = true;
    let lang;
    reload.current = async () => {
      try {
        const f = await call("readFile", { path: "app/state.json" });
        if (alive) set((x) => ({ ...x, state: f.json ?? null, issues: f.issues || [] }));
      } catch {
        if (alive) set((x) => ({ ...x, state: null }));
      }
    };
    call("init").then((env) => {
      applyEnv(env);
      if (!alive) return;
      lang = env.lang;
      set((x) => ({ ...x, ready: true, sample: !!env.sample, desktop: !!env.desktop, expanded: !!env.expanded, lang: env.lang, bot: env.bot, messages: env.messages || {} }));
      reload.current();
      call("subscribe").catch(() => {});
    });
    const off = on((event, data) => {
      if (event === "env") {
        applyEnv(data);
        set((x) => ({ ...x, lang: data.lang ?? x.lang, expanded: data.expanded ?? x.expanded, sample: data.sample ?? x.sample, desktop: data.desktop ?? x.desktop, messages: data.messages ?? x.messages, bot: data.bot ?? x.bot }));
        // 示例数据分语言：切语言后换成对应的那一份
        if (data.sample && data.lang && data.lang !== lang) reload.current();
        lang = data.lang ?? lang;
      } else if (event === "file" && data?.path === "app/state.json") reload.current();
      else if (event === "turn") {
        set((x) => ({ ...x, busy: !!data?.busy }));
        if (!data?.busy) reload.current();
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (!s.expanded) return;
    const collapse = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      call("setExpanded", { expanded: false }).catch(() => {});
    };
    document.addEventListener("keydown", collapse);
    return () => document.removeEventListener("keydown", collapse);
  }, [s.expanded]);
  return useMemo(
    () => ({
      ...s,
      t: (key, params) => fillParams(s.messages[key] ?? key, params),
      send: (text, action) => call("send", { text, action }),
      stop: () => call("stop"),
      pickFile: (opts = {}) => call("pickFile", opts),
      readFile: (path) => call("readFile", { path }),
      readImage: (path) => call("readImage", { path }),
      readMedia: async (path) => {
        const r = await call("readMedia", { path });
        try {
          const url = URL.createObjectURL(r.blob);
          mediaHandles.set(url, r.handle);
          return { url, size: r.size };
        } catch (e) {
          await call("releaseMedia", { handle: r.handle });
          throw e;
        }
      },
      releaseMedia: (url) => {
        const handle = mediaHandles.get(url);
        if (handle === undefined) return Promise.resolve(true);
        URL.revokeObjectURL(url);
        mediaHandles.delete(url);
        return call("releaseMedia", { handle });
      },
      openFile: (path, opts = {}) => call("openFile", { path, reveal: !!opts.reveal }),
      openUrl: (url) => call("openUrl", { url }),
      setExpanded: (expanded) => call("setExpanded", { expanded: !!expanded }),
    }),
    [s],
  );
}

/** 挂载界面。出错时告诉父页面：父页面退回对话视图，顶部提示一行 */
export function mount(App) {
  const fail = (message) => call("reportError", { message: String(message).slice(0, 500) }).catch(() => {});
  // ResizeObserver 的"循环"提示是浏览器的无害警告（尺寸在同一帧里又变了一次），不是界面坏了，不能因此退回对话
  window.addEventListener("error", (e) => !/ResizeObserver loop/i.test(String(e.message)) && fail(e.message));
  window.addEventListener("unhandledrejection", (e) => fail(e.reason?.message || e.reason));
  render(h(App, {}), document.getElementById("app") || document.body);
  call("rendered").catch(() => {});
}

// —— 基础组件：都是设计系统的类，界面只用这些，不写死颜色和间距 ——
const cx = (...a) => a.filter(Boolean).join(" ");

export const Page = ({ title, sub, actions, children }) => html`<main class="kit-page">
  ${(title || actions) && html`<header class="kit-head"><div class="kit-head-text">${title && html`<h1 class="t-title">${title}</h1>`}${sub && html`<p class="t-meta">${sub}</p>`}</div>${actions && html`<div class="cluster">${actions}</div>`}</header>`}
  ${children}
</main>`;
export const Section = ({ title, children }) => html`<section class="kit-section">${title && html`<h2 class="t-label">${title}</h2>`}${children}</section>`;
export const Card = ({ on, children, class: c }) => html`<div class=${cx("kit-card", on && "kit-changed", c)}>${children}</div>`;
export const Row = ({ children, class: c }) => html`<div class=${cx("cluster", c)}>${children}</div>`;
export const Stack = ({ children, class: c }) => html`<div class=${cx("stack", c)}>${children}</div>`;
export const Grid = ({ children, class: c }) => html`<div class=${cx("kit-grid", c)}>${children}</div>`;
export const Button = ({ primary, children, onClick, disabled, class: c }) => html`<button type="button" class=${cx("btn", primary && "primary", c)} disabled=${disabled} onClick=${onClick}>${children}</button>`;
export const Field = ({ label, value, onInput, placeholder, type = "text" }) => html`<label class="kit-field"><span class="t-label">${label}</span><input class="field" type=${type} value=${value} placeholder=${placeholder} onInput=${onInput} /></label>`;
export const Notice = ({ children }) => html`<div class="notice" role="status">${children}</div>`;
// 沙箱里的 <a> 打不开新窗口，点下去还会把界面自己带走：一律经父页面打开，打开前让用户确认
export const Link = ({ href, children, class: c }) => html`<a class=${cx("kit-link", c)} href=${href} onClick=${(e) => (e.preventDefault(), call("openUrl", { url: href }).catch(() => {}))}>${children}</a>`;
export const Empty = ({ children }) => html`<div class="kit-empty t-meta">${children}</div>`;
export const Meter = ({ value, max = 100, label }) => html`<div class="kit-meter" role="meter" aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value} aria-label=${label}><i style=${{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }}></i></div>`;
export function Table({ columns, rows, rowKey = (_, i) => i }) {
  return html`<table class="kit-table"><thead><tr>${columns.map((c) => html`<th class=${c.num ? "num" : ""}>${c.title}</th>`)}</tr></thead>
    <tbody>${rows.map((r, i) => html`<tr key=${rowKey(r, i)} class=${r.changed ? "kit-changed" : ""}>${columns.map((c) => html`<td class=${c.num ? "num" : ""}>${c.render ? c.render(r) : r[c.key]}</td>`)}</tr>`)}</tbody></table>`;
}
