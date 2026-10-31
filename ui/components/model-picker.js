// 模型选择器（magpie picker 的样式；数据来自 Modelflare 的 /v1/models）。按模型族分组，组头可以展开收起。
// 不做厂商图标栏：各厂商 logo 是第三方商标，未取得授权前不用。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Popover, Icon } from "./ui.js";
import { api } from "../lib/api.js";
import { createStore, useStore } from "../lib/store.js";
import { t } from "../lib/i18n.js";
import { OTHER_FAMILY, groupModels, modelFamily, normModel, sameModel, shortModel } from "../lib/models.js";

export { groupModels, normModel, sameModel, shortModel } from "../lib/models.js";

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
  const caps = [i.vision && t("models.caps.vision"), i.tools && t("models.caps.tools"), i.reasoning && t("models.caps.reasoning")].filter(Boolean).join(" ");
  if (caps) parts.push(caps);
  if (i.price) parts.push(i.price.perCall !== undefined ? t("models.perCall", { price: `$${num(i.price.perCall)}` }) : `$${num(i.price.input)}/${i.price.output !== undefined ? num(i.price.output) : "—"}`);
  return parts.join(" · ");
}

/** 族名的显示：认不出的族（OTHER_FAMILY）按当前语言显示，其余是品牌名原样 */
export const familyName = (g) => (g === OTHER_FAMILY ? t("models.otherFamily") : g);

// —— 模型族的开合：当前模型所在的族默认展开（没有当前模型时展开第一个）；用户点过的按点的算，本次运行内记住 ——
const famOpen = new Map();
export function useFamilies(groups, current) {
  const [, redraw] = useState(0);
  const curFam = current ? modelFamily(current) : groups[0]?.[0];
  const isOpen = (g) => famOpen.get(g) ?? g === curFam;
  const toggle = (g) => {
    famOpen.set(g, !isOpen(g));
    redraw((n) => n + 1);
  };
  return { isOpen, toggle };
}

/** 组头的内容：族名、收起时里面的当前模型、数量、箭头（展开时转向下） */
export function FamilyHead({ name, count, current }) {
  return html`<span class="v">${familyName(name)}</span><span class="n">${current || ""}</span><span class="cnt">${count}</span><${Icon} name="chevRight" size="xs" class="chev" />`;
}

/**
 * models: string[] | null（加载中）；error: 加载失败时的说明。
 * reset: { label, note, onSelect }  顶部"恢复默认"项；foot: { label, onClick, disabled } 底部操作。
 * 不筛选时按模型族折叠（只有一个族时不出组头）；筛选时全部展开，组名只作标签。
 */
export function ModelPicker({ anchor, models, error, current, onPick, onClose, reset, foot, onRetry, prefer = "down", align = "left" }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const info = useModelInfo();
  const groups = useMemo(() => groupModels(models || [], q), [models, q]);
  const { isOpen, toggle } = useFamilies(groups, current);
  const folding = !q.trim() && groups.length > 1;
  const custom = q.trim() && !(models || []).some((m) => sameModel(m, q.trim())) ? q.trim() : "";
  const flat = [
    ...(reset && !q ? [{ reset: true }] : []),
    ...groups.flatMap(([g, ms]) => {
      const rows = ms.map(([m]) => ({ m, g }));
      return folding ? [{ fam: g }, ...(isOpen(g) ? rows : [])] : rows;
    }),
    ...(custom ? [{ m: custom, custom: true }] : []),
  ];
  // 列表到了以后，指向并滚到当前模型
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !models?.length) return;
    placed.current = true;
    const i = flat.findIndex((it) => it.m && sameModel(it.m, current));
    if (i < 0) return;
    setSel(i);
    requestAnimationFrame(() => listRef.current?.querySelector("li.cur")?.scrollIntoView({ block: "nearest" }));
  }, [models]);
  const choose = (it) => {
    onClose();
    if (it.reset) reset.onSelect();
    else onPick(it.m);
  };
  const onKey = (e) => {
    const it = flat[sel];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && it) {
      e.preventDefault();
      if (it.fam) toggle(it.fam);
      else choose(it);
    } else if (folding && it && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      // 输入框是空的（folding 时 q 为空），左右键不会挪光标：→ 展开，← 收起；在模型上按 ← 收起它所在的族
      e.preventDefault();
      const g = it.fam || it.g;
      if (!g || (it.m && e.key === "ArrowRight")) return;
      if (isOpen(g) !== (e.key === "ArrowRight")) toggle(g);
      if (it.m) setSel(flat.findIndex((x) => x.fam === g));
    }
    requestAnimationFrame(() => listRef.current?.querySelector("li.sel")?.scrollIntoView({ block: "nearest" }));
  };
  let idx = -1;
  const item = (it, label, note) => {
    idx++;
    const i = idx;
    return html`<li role="option" aria-selected=${sel === i} class=${`${sel === i ? "sel" : ""} ${(!it.reset && sameModel(it.m, current)) || (it.reset && !current) ? "cur" : ""}`}
      onPointerMove=${() => setSel(i)} onClick=${() => choose(it)}>
      <span class="v">${label}</span>${note && html`<span class="n" title=${it.reset || it.custom ? undefined : t("models.noteTitle")}>${note}</span>`}
      <span class="check"><${Icon} name="check" size="sm" /></span>
    </li>`;
  };
  const head = (g, ms) => {
    idx++;
    const i = idx;
    const open = isOpen(g);
    const cur = open ? undefined : ms.find(([m]) => sameModel(m, current));
    return html`<li class=${`fam ${sel === i ? "sel" : ""}`} aria-expanded=${open} onPointerMove=${() => setSel(i)} onClick=${() => toggle(g)}>
      <${FamilyHead} name=${g} count=${ms.length} current=${cur?.[1]} />
    </li>`;
  };
  const rows = (ms) => ms.map(([m, label]) => item({ m }, label, modelNote(info, m)));
  return html`<${Popover} anchor=${anchor} onClose=${onClose} class="model-picker" width=${340} maxHeight=${420} prefer=${prefer} align=${align} label=${t("models.choose")}>
    <div class="search"><${Icon} name="search" size="sm" />
      <input placeholder=${t("models.filterOrId")} value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} aria-label=${t("models.filter")} />
    </div>
    <ul role="listbox" ref=${listRef}>
      ${models === null && !error && [0, 1, 2, 3, 4].map((k) => html`<li key=${k}><span class="skel" style=${{ width: 60 + ((k * 37) % 30) + "%" }}></span></li>`)}
      ${error && html`<li class="explained" style="pointer-events:auto"><span class="v" style="white-space:normal;color:var(--red)">${t("models.loadFailed", { error })}</span>
        ${onRetry && html`<button type="button" class="text" onClick=${onRetry}>${t("common.retry")}</button>`}</li>`}
      ${reset && !q && item({ reset: true }, reset.label, reset.note)}
      ${groups.map(([g, ms]) =>
        folding ? html`${head(g, ms)}${isOpen(g) && rows(ms)}` : html`${groups.length > 1 && html`<li class="group">${familyName(g)}</li>`}${rows(ms)}`,
      )}
      ${custom && item({ m: custom, custom: true }, t("models.useCustom", { id: custom }), t("models.customId"))}
      ${models && !models.length && !q && html`<li class="explained"><span class="v" style="white-space:normal">${t("models.none")}</span></li>`}
    </ul>
    ${foot && html`<div class="foot"><button type="button" disabled=${foot.disabled} onClick=${() => { onClose(); foot.onClick(); }}>${foot.label}</button></div>`}
  <//>`;
}

/**
 * 菜单按钮 + 模型选择器（设置页、首次设置用）。value 为空时按钮显示 resetLabel；
 * 给了 resetLabel 时列表顶部有一项"恢复默认"，选它 onChange("")。
 */
export function PickModel({ value, models, modelsError, reloadModels, onChange, resetLabel, align = "right", label = t("models.choose") }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return html`<button type="button" class="pick" ref=${ref} aria-haspopup="listbox" aria-expanded=${open} aria-label=${label} onClick=${() => setOpen((v) => !v)}>
      <span class="v">${value ? shortModel(value) : resetLabel || label}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${ModelPicker} anchor=${ref.current} align=${align} models=${models} error=${modelsError} onRetry=${reloadModels} current=${value}
      onPick=${onChange} onClose=${() => setOpen(false)} reset=${resetLabel ? { label: resetLabel, onSelect: () => onChange("") } : undefined} />`}`;
}
