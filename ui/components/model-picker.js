// 模型选择器（magpie picker 的样式；数据来自 Modelflare 的 /v1/models）。
// 不做厂商图标栏：各厂商 logo 是第三方商标，未取得授权前不用。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Popover, Icon } from "./ui.js";
import { api } from "../lib/api.js";
import { createStore, useStore } from "../lib/store.js";

/** 内置网关列出的模型带 "modelflare/" 前缀，Modelflare 直接列出的不带；两种写法都能调用，显示与比较时去掉它 */
export const normModel = (m) => (m && m.startsWith("modelflare/") ? m.slice("modelflare/".length) : m || "");
export const sameModel = (a, b) => !!a && !!b && normModel(a) === normModel(b);
export const shortModel = (m) => (m && m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m);

// —— 模型能力与参考价（/models/info，后端缓存一小时；界面第一次打开选择器时取一次）——
const infoStore = createStore(null);
let infoLoading = false;
function useModelInfo() {
  const info = useStore(infoStore);
  useEffect(() => {
    if (info || infoLoading) return;
    infoLoading = true;
    api("/models/info")
      .then((d) => infoStore.set(d.models || {}))
      .catch(() => infoStore.set({}))
      .finally(() => (infoLoading = false));
  }, []);
  return info || {};
}

const num = (n) => String(+Number(n).toFixed(n < 1 ? 3 : 2));
/** 一行说明：上下文 · 视觉 工具 推理 · 每百万 tokens 输入/输出参考价（按次计费的模型是每次） */
export function modelNote(info, id) {
  const n = normModel(id);
  const i = info[n] || info[n.slice(n.lastIndexOf("/") + 1)];
  if (!i) return "";
  const parts = [];
  if (i.context) parts.push(i.context >= 1e6 ? `${num(i.context / 1e6)}M` : `${Math.round(i.context / 1000)}K`);
  const caps = [i.vision && "视觉", i.tools && "工具", i.reasoning && "推理"].filter(Boolean).join(" ");
  if (caps) parts.push(caps);
  if (i.price) parts.push(i.price.perCall !== undefined ? `$${num(i.price.perCall)}/次` : `$${num(i.price.input)}/${i.price.output !== undefined ? num(i.price.output) : "—"}`);
  return parts.join(" · ");
}
const NOTE_TITLE = "上下文 · 能力 · 每百万 tokens 输入/输出的起步参考价（美元，以账单为准）";

/** 按 "厂商/模型" 的前缀分组（没有前缀的放在最后）；返回 [厂商, [[原始 id, 显示名]]] */
export function groupModels(models, q = "") {
  const needle = q.trim().toLowerCase();
  const groups = new Map();
  for (const m of models) {
    const n = normModel(m);
    if (needle && !n.toLowerCase().includes(needle)) continue;
    const k = n.includes("/") ? n.slice(0, n.indexOf("/")) : "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([m, k ? n.slice(k.length + 1) : n]);
  }
  return [...groups.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])));
}

/**
 * models: string[] | null（加载中）；error: 加载失败时的说明。
 * reset: { label, note, onSelect }  顶部"恢复默认"项；foot: { label, onClick, disabled } 底部操作。
 */
export function ModelPicker({ anchor, models, error, current, onPick, onClose, reset, foot, onRetry, prefer = "down", align = "left" }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const info = useModelInfo();
  const groups = useMemo(() => groupModels(models || [], q), [models, q]);
  const custom = q.trim() && !(models || []).some((m) => sameModel(m, q.trim())) ? q.trim() : "";
  const flat = [...(reset && !q ? [{ reset: true }] : []), ...groups.flatMap(([, ms]) => ms.map(([m]) => ({ m }))), ...(custom ? [{ m: custom, custom: true }] : [])];
  const choose = (it) => {
    onClose();
    if (it.reset) reset.onSelect();
    else onPick(it.m);
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && flat[sel]) {
      e.preventDefault();
      choose(flat[sel]);
    }
    requestAnimationFrame(() => listRef.current?.querySelector("li.sel")?.scrollIntoView({ block: "nearest" }));
  };
  let idx = -1;
  const item = (it, label, note) => {
    idx++;
    const i = idx;
    return html`<li role="option" aria-selected=${sel === i} class=${`${sel === i ? "sel" : ""} ${(!it.reset && sameModel(it.m, current)) || (it.reset && !current) ? "cur" : ""}`}
      onPointerMove=${() => setSel(i)} onClick=${() => choose(it)}>
      <span class="v">${label}</span>${note && html`<span class="n" title=${it.reset || it.custom ? undefined : NOTE_TITLE}>${note}</span>`}
      <span class="check"><${Icon} name="check" size=${14} /></span>
    </li>`;
  };
  return html`<${Popover} anchor=${anchor} onClose=${onClose} class="model-picker" width=${340} maxHeight=${420} prefer=${prefer} align=${align} label="选择模型">
    <div class="search"><${Icon} name="search" size=${14} />
      <input placeholder="筛选，或输入任意模型 ID" value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} aria-label="筛选模型" />
    </div>
    <ul role="listbox" ref=${listRef}>
      ${models === null && !error && [0, 1, 2, 3, 4].map((k) => html`<li key=${k}><span class="skel" style=${{ width: 60 + ((k * 37) % 30) + "%" }}></span></li>`)}
      ${error && html`<li class="explained" style="pointer-events:auto"><span class="v" style="white-space:normal;color:var(--red)">获取模型列表失败：${error}</span>
        ${onRetry && html`<button type="button" class="text" onClick=${onRetry}>重试</button>`}</li>`}
      ${reset && !q && item({ reset: true }, reset.label, reset.note)}
      ${groups.map(([g, ms]) => html`${g && html`<li class="group">${g}</li>`}${ms.map(([m, label]) => item({ m }, label, modelNote(info, m)))}`)}
      ${custom && item({ m: custom, custom: true }, `使用「${custom}」`, "自定义模型 ID")}
      ${models && !models.length && !q && html`<li class="explained"><span class="v" style="white-space:normal">没有可用模型：这个 Key 所在的分组还没有开放模型</span></li>`}
    </ul>
    ${foot && html`<div class="foot"><button type="button" disabled=${foot.disabled} onClick=${() => { onClose(); foot.onClick(); }}>${foot.label}</button></div>`}
  <//>`;
}
