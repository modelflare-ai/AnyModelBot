// 模型选择器（magpie picker 的样式；数据来自内置网关的 /v1/models：Modelflare 和官方 API 的模型都在里面）。按模型族分组，组头可以展开收起。
// 不做厂商图标栏：各厂商 logo 是第三方商标，未取得授权前不用。
// 对话和机器人设置里打开时先是 TierPanel：性价比（账户级，Key 的路由策略）、模型智能（沿帕累托前沿的几档，
// lib/frontier.js）和推理强度（全局）；点模型名进完整列表，照样可以手动选。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Popover, Icon, Seg, Stops } from "./ui.js";
import { api } from "../lib/api.js";
import { createStore, useStore, failed } from "../lib/store.js";
import { t } from "../lib/i18n.js";
import { OTHER_FAMILY, groupModels, modelFamily, normModel, sameModel, shortModel } from "../lib/models.js";
import { DEFAULT_STRATEGY, STRATEGIES, defaultStop, levelOf, tiers } from "../lib/frontier.js";

export { groupModels, normModel, sameModel, shortModel } from "../lib/models.js";

// —— 模型能力与参考价（/models/info，后端缓存一小时；界面第一次打开选择器时取一次）——
const infoStore = createStore(null);
let infoLoading = false;
/** 先取一次（对话页挂上时就取，打开选择器时滑块不用等） */
export function prefetchModelInfo() {
  if (infoStore.get() || infoLoading) return;
  infoLoading = true;
  api("/models/info")
    .then((d) => infoStore.set(d.models || {}))
    .catch(() => infoStore.set({}))
    .finally(() => (infoLoading = false));
}
/** 模型资料；还没取到时 null */
export function useModelInfoRaw() {
  const info = useStore(infoStore);
  useEffect(prefetchModelInfo, []);
  return info;
}

/** 模型资料按完整 id 查，查不到再按去掉前缀的名字查 */
function infoFor(info, id) {
  const n = normModel(id);
  return info[n] || info[n.slice(n.lastIndexOf("/") + 1)];
}

// —— 推理强度：全局一个（/settings 的 reasoningEffort），选择器和设置页共用这份状态 ——
const EFFORTS = ["auto", "low", "medium", "high"];
const effortStore = createStore(null);
let effortLoading = false;
function loadEffort() {
  if (effortStore.get() || effortLoading) return;
  effortLoading = true;
  api("/settings")
    .then((d) => effortStore.set(d.reasoningEffort || "auto"))
    .catch(() => {})
    .finally(() => (effortLoading = false));
}
export function useEffort() {
  const v = useStore(effortStore);
  useEffect(loadEffort, []);
  return v ?? "auto";
}
export const effortOptions = () => EFFORTS.map((e) => [e, t(`models.effort.${e}`)]);
/** 先显示再保存，失败时退回去；返回是否保存成功 */
export function setEffort(v) {
  const prev = effortStore.get();
  effortStore.set(v);
  return api("/settings", { method: "PUT", body: { reasoningEffort: v } }).then(
    () => true,
    (e) => {
      effortStore.set(prev);
      failed(e);
      return false;
    },
  );
}

const num = (n) => String(+Number(n).toFixed(n < 1 ? 3 : 2));
/** 一行说明：上下文 · 视觉 工具 推理 · 每百万 tokens 输入/输出参考价（按次计费的模型是每次） */
export function modelNote(info, id) {
  const i = infoFor(info, id);
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

// —— 两个滑块 ——
const AA_URL = "https://artificialanalysis.ai/";
/** 档名：levelOf 的 0…4 */
const LEVELS = ["min", "low", "medium", "high", "max"];

/** 第一个滑块显示不显示：登录了 Modelflare 账户，而且 Modelflare 认这个设置 */
export const showsStrategy = (account) => !!(account && account.state === "signed_in" && account.keyQuality && account.keyQuality.supported);
/** 按哪种性价比算花费：显示第一个滑块时用账户的，否则按均衡估 */
export const strategyOf = (account) => (showsStrategy(account) ? account.keyQuality.strategy : DEFAULT_STRATEGY);
export const strategyLabel = (s) => t(`models.tiers.strategy.${s}`);
/** 性价比的三个选项（设置页的分段控件也用） */
export const strategyOptions = () => STRATEGIES.map((s) => [s, strategyLabel(s)]);

/** 当前模型在第二个滑块上的档名；不在档上时是「自定义」 */
export const levelLabel = (cur, n) => (cur >= 0 ? t(`models.tiers.level.${LEVELS[levelOf(cur, n)]}`) : t("models.tiers.custom"));

/**
 * 选择器的面板（不带状态）。stops / cur / anchor 来自 frontier.js 的 tiers；model 是当前模型。
 * 推理强度只在当前模型支持时出现（showEffort）。
 * 没有第一个滑块时（没登录、Modelflare 不支持）只有模型智能；前沿不到两档时只剩模型名，点它进列表。
 * 右上角的恢复默认只在不是默认（均衡 + 居中那一档 + 自动）时出现。
 */
export function TierPanel({ strategy, showStrategy, stops, cur, anchor, model, canReset, onStrategy, onStop, onList, onReset, effort, showEffort, onEffort }) {
  const n = stops.length;
  const si = STRATEGIES.indexOf(strategy);
  const level = levelLabel(cur, n);
  // 彩蛋：看得见的滑块都拉到最右（质量 + 最强）时，弹窗发光、轨道流动、四周飘几粒光点
  const maxed = n >= 2 && cur === n - 1 && (!showStrategy || si === STRATEGIES.length - 1);
  return html`<div class=${`tiers${maxed ? " maxed" : ""}`}>
    ${maxed && html`<${Sparks} />`}
    ${canReset && html`<button type="button" class="icon-btn tiers-reset" title=${t("models.tiers.reset")} aria-label=${t("models.tiers.reset")} onClick=${onReset}><${Icon} name="reset" size="sm" /></button>`}
    ${showStrategy && html`<section class="tier">
      <div class="tier-head"><span class="tier-name">${t("models.tiers.value")}</span><span class="tier-val">${strategyLabel(strategy)}</span></div>
      <${Stops} count=${STRATEGIES.length} value=${si} label=${t("models.tiers.value")} valueText=${strategyLabel(strategy)} onChange=${(i) => onStrategy(STRATEGIES[i])} />
      <div class="tier-ticks">${STRATEGIES.map((s) => html`<span key=${s} class=${s === strategy ? "on" : ""}>${strategyLabel(s)}</span>`)}</div>
    </section>`}
    <section class="tier">
      <div class="tier-head"><span class="tier-name">${t("models.tiers.intelligence")}</span>${n >= 2 && html`<span class=${`tier-val${cur < 0 ? " custom" : ""}`}>${level}</span>`}</div>
      <button type="button" class="tier-model" title=${t("models.tiers.allModels")} onClick=${onList}><span class="v">${model ? shortModel(model) : t("common.auto")}</span><${Icon} name="chevRight" size="xs" /></button>
      ${n >= 2 && html`<${Stops} count=${n} value=${cur} anchor=${anchor} fallback=${defaultStop(n)} autoFocus label=${t("models.tiers.intelligence")}
          valueText=${cur >= 0 ? t("models.tiers.valueText", { level, model: shortModel(stops[cur].id) }) : level} onChange=${(i) => onStop(stops[i].id)} />
        <div class="tier-ticks ends"><span>${t("models.tiers.cheaper")}</span><span>${t("models.tiers.smarter")}</span></div>`}
    </section>
    ${showEffort && html`<section class="tier">
      <div class="tier-head"><span class="tier-name">${t("models.effort.name")}</span></div>
      <${Seg} label=${t("models.effort.name")} options=${effortOptions()} value=${effort} onChange=${onEffort} />
    </section>`}
    <p class="tier-foot">${t("models.tiers.foot", { aa: html`<a href=${AA_URL} target="_blank" rel="noopener noreferrer">Artificial Analysis</a>` })}</p>
  </div>`;
}

// 光点的位置、大小、节奏是固定的（重绘不跳）：沿着四条边各撒几粒
const SPARKS = [
  [9, 5, 3, 0], [31, 3, 2, 1.1], [57, 6, 3, 2.3], [83, 4, 2, 0.6],
  [16, 95, 2, 1.7], [44, 92, 3, 0.3], [70, 96, 2, 2.8], [91, 91, 3, 1.4],
  [3, 28, 2, 2.1], [5, 61, 3, 0.9], [96, 22, 3, 1.9], [94, 50, 2, 0.2], [97, 77, 3, 2.6],
];
function Sparks() {
  return html`<div class="tiers-sparks" aria-hidden="true">${SPARKS.map(([x, y, s, d], i) => html`<i key=${i} style=${`--x:${x}%;--y:${y}%;--s:${s}px;--d:${d}s`} />`)}</div>`;
}

/**
 * models: string[] | null（加载中）；error: 加载失败时的说明。
 * reset: { label, note, onSelect }  顶部"恢复默认"项；foot: { label, onClick, disabled } 底部操作。
 * 不筛选时按模型族折叠（只有一个族时不出组头）；筛选时全部展开，组名只作标签。
 * account / onAccount：给了就先打开两个滑块（对话、机器人设置）；前沿不到两档时直接是列表。
 * effective：current 为空（跟随默认）时实际用的模型，滑块按它定位。
 */
export function ModelPicker({ anchor, models, error, current, onPick, onClose, reset, foot, onRetry, prefer = "down", align = "left", account, onAccount, effective = "", draftOnly = false }) {
  const panelWanted = onAccount !== undefined;
  const infoRaw = useModelInfoRaw();
  const info = infoRaw || {};
  // 滑块拖到的那一档 / 刚选的性价比：保存完成前先这样显示
  const [picked, setPicked] = useState(null);
  const [pendingStrategy, setPendingStrategy] = useState(null);
  const strategy = pendingStrategy ?? strategyOf(account);
  const effort = useEffort();
  const shown = picked ?? (current || effective);
  const tier = useMemo(() => (panelWanted && models && infoRaw ? tiers(models, info, strategy, shown) : null), [panelWanted, models, infoRaw, strategy, shown]);
  // 打开时定下先看哪一面（数据还没到就等它到了再定），之后不再自己变
  const decide = () => (!panelWanted ? "list" : tier ? (tier.stops.length >= 2 ? "panel" : "list") : null);
  const [view, setView] = useState(decide);
  useEffect(() => {
    if (view === null && tier) setView(decide());
  }, [view, tier]);
  let body;
  if (view === "panel" && tier) {
    const pickStop = (m) => {
      if (sameModel(m, shown)) return;
      setPicked(m);
      Promise.resolve(onPick(m)).finally(() => setPicked(null));
    };
    const setStrategy = (s) => {
      if (s === strategy) return;
      setPendingStrategy(s);
      api("/account/key-quality", { method: "PUT", body: { strategy: s } })
        .then((r) => onAccount(r))
        .catch((e) => {
          failed(e);
          // Modelflare 不支持时状态里 supported 变成 false，第一个滑块随之收起
          return api("/account").then(onAccount).catch(() => {});
        })
        .finally(() => setPendingStrategy(null));
    };
    const showStrategy = !draftOnly && showsStrategy(account);
    const home = showStrategy && strategy !== DEFAULT_STRATEGY ? tiers(models, info, DEFAULT_STRATEGY, shown) : tier;
    const homeModel = home.stops.length ? home.stops[defaultStop(home.stops.length)].id : "";
    const showEffort = !draftOnly && !!infoFor(info, shown)?.effort;
    const effortChanged = showEffort && effort !== "auto";
    const onReset = () => {
      if (showStrategy && strategy !== DEFAULT_STRATEGY) setStrategy(DEFAULT_STRATEGY);
      if (effortChanged) setEffort("auto");
      if (homeModel) pickStop(homeModel);
    };
    body = html`<${TierPanel} strategy=${strategy} showStrategy=${showStrategy} stops=${tier.stops} cur=${tier.cur} anchor=${tier.anchor} model=${shown}
      canReset=${(showStrategy && strategy !== DEFAULT_STRATEGY) || effortChanged || (!!homeModel && !sameModel(homeModel, shown))}
      effort=${effort} showEffort=${showEffort} onEffort=${setEffort}
      onStrategy=${setStrategy} onStop=${pickStop} onList=${() => setView("list")} onReset=${onReset} />`;
  } else {
    body = html`<${ModelList} models=${models} error=${error} current=${current} onPick=${onPick} onClose=${onClose} reset=${reset} foot=${foot}
      onRetry=${onRetry} info=${info} onBack=${view === "list" && panelWanted && tier && tier.stops.length >= 2 ? () => setView("panel") : undefined} />`;
  }
  return html`<${Popover} anchor=${anchor} onClose=${onClose} class="model-picker" width=${340} maxHeight=${420} prefer=${prefer} align=${align} label=${t("models.choose")}>${body}<//>`;
}

/** 完整的模型列表（选择器原来的样子）；onBack：从滑块面板进来时，搜索框左边有返回 */
function ModelList({ models, error, current, onPick, onClose, reset, foot, onRetry, info, onBack }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  // 从面板切过来时面板上的焦点没了：交给搜索框
  useEffect(() => {
    if (onBack) searchRef.current?.focus();
  }, []);
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
    if (e.isComposing || e.keyCode === 229) return;
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
  return html`<div class="search">${onBack
      ? html`<button type="button" class="icon-btn xs search-back" title=${t("models.tiers.back")} aria-label=${t("models.tiers.back")} onClick=${onBack}><${Icon} name="chevLeft" size="sm" /></button>`
      : html`<${Icon} name="search" size="sm" />`}
      <input ref=${searchRef} placeholder=${t("models.filterOrId")} value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} aria-label=${t("models.filter")} />
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
  `;
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
