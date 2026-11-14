// 侧栏分组：用户自己建、自己起名、上下拖着排的分组，每个分组里放机器人、群聊和目录 Bot，行可以移到别的分组。
// 布局存在服务端（GET / PUT /sidebar-layout，形状和整理规则见 src/domain/sidebar-layout.ts），桌面窗口和浏览器共用一份；
// 折叠只是本机的显示偏好，存在 localStorage。
//
// 默认两个分组：「我的」（默认分组）和「上新」（收件分组）。哪一行进哪个分组：
// - 新机器人、新群聊，以及第一次用的目录 Bot（用之前不在任何分组里）进默认分组的末尾；
// - 新上架、还没用过的目录 Bot 进收件分组的最上面；收件分组删掉之后，它们只在发现页出现；
// - 目录 Bot 用过之后还是同一个键（c:<目录 id>），留在原来的分组里。
// 删掉一个分组时，里面的机器人和群聊移到默认分组（删的就是默认分组时，剩下的第一个分组接着当默认分组）；
// 没用过的目录 Bot 不跟着移：收件分组还在就回到那里，不在就只在发现页。
import { createStore } from "./store.js";
import { api } from "./api.js";

export const keyOfBot = (b) => (b.app?.catalogId ? `c:${b.app.catalogId}` : `b:${b.id}`);
export const keyOfGroup = (g) => `g:${g.id}`;
export const keyOfEntry = (e) => `c:${e.id}`;

export function defaultLayout() {
  return {
    version: 1,
    sections: [
      { id: "mine", name: "", preset: "mine", default: true, items: [] },
      { id: "latest", name: "", preset: "latest", inbox: true, items: [] },
    ],
  };
}

const copy = (layout) => ({ version: 1, sections: layout.sections.map((s) => ({ ...s, items: [...s.items] })) });
const without = (layout, key) => layout.sections.forEach((s) => (s.items = s.items.filter((k) => k !== key)));

/** 新的分组 id（服务端只认 [A-Za-z0-9_-]{1,40}） */
export const newSectionId = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const sectionOf = (layout, key) => layout.sections.find((s) => s.items.includes(key));

/**
 * 还不在任何分组里的行放进去：机器人和群聊进默认分组的末尾，没用过的目录 Bot 进收件分组的最上面。
 * 某一类还没读到时传 null，那一类先不动。没有要放的时候原样返回同一个对象（调用方靠这个判断要不要保存）。
 */
export function place(layout, { bots, groups, catalog }) {
  const removed = new Set((catalog || []).filter((e) => e.userRemoved && !e.instanceId).map(keyOfEntry));
  if (layout.sections.some((s) => s.items.some((key) => removed.has(key)))) {
    layout = copy(layout); for (const s of layout.sections) s.items = s.items.filter((key) => !removed.has(key));
  }
  const placed = new Set(layout.sections.flatMap((s) => s.items));
  const take = (key) => (placed.has(key) ? false : (placed.add(key), true));
  const toDefault = [
    ...(bots || []).map(keyOfBot).filter((key) => !removed.has(key)).filter(take),
    ...(groups || []).map(keyOfGroup).filter(take),
  ];
  const inbox = layout.sections.find((s) => s.inbox);
  // 用过的目录 Bot 由它的机器人那一行负责（同一个键）；目录按上架时间从新到旧排好了，保持这个顺序放在最上面
  const toInbox = inbox ? (catalog || []).filter((e) => !e.instanceId && !e.userRemoved).map(keyOfEntry).filter(take) : [];
  if (!toDefault.length && !toInbox.length) return layout;
  const next = copy(layout);
  const def = next.sections.find((s) => s.default) || next.sections[0];
  def.items.push(...toDefault);
  if (toInbox.length) {
    const box = next.sections.find((s) => s.inbox);
    box.items.unshift(...toInbox);
  }
  return next;
}

/**
 * 丢掉已经不在的机器人和群聊（b: / g: 键，has(key) 为 false 的）。目录 Bot 的键（c:）不动：用过又删掉的目录 Bot 还会以没用过的样子回到原处。
 * 没有要丢的时候原样返回同一个对象。
 */
export function prune(layout, has) {
  const stale = (k) => (k.startsWith("b:") || k.startsWith("g:")) && !has(k);
  if (!layout.sections.some((s) => s.items.some(stale))) return layout;
  const next = copy(layout);
  for (const s of next.sections) s.items = s.items.filter((k) => !stale(k));
  return next;
}

/** 把一行移到 toId 分组里 beforeKey 的前面（null = 末尾） */
export function moveItem(layout, key, toId, beforeKey = null) {
  if (!layout.sections.some((s) => s.id === toId) || key === beforeKey) return layout;
  const next = copy(layout);
  without(next, key);
  const to = next.sections.find((s) => s.id === toId);
  const i = beforeKey ? to.items.indexOf(beforeKey) : -1;
  to.items.splice(i < 0 ? to.items.length : i, 0, key);
  return next;
}

/** 把分组移到 beforeId 的前面（null = 最后） */
export function moveSection(layout, id, beforeId = null) {
  const sec = layout.sections.find((s) => s.id === id);
  if (!sec || id === beforeId) return layout;
  const next = copy(layout);
  const rest = next.sections.filter((s) => s.id !== id);
  const i = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  rest.splice(i < 0 ? rest.length : i, 0, next.sections.find((s) => s.id === id));
  next.sections = rest;
  return next;
}

/** 新建分组，放在 afterId 后面（不给就放最后）；items 是一起放进去的行（从别的分组里拿出来） */
export function addSection(layout, name, { afterId, items = [] } = {}) {
  const id = newSectionId();
  const next = copy(layout);
  for (const k of items) without(next, k);
  const at = afterId ? next.sections.findIndex((s) => s.id === afterId) : -1;
  next.sections.splice(at < 0 ? next.sections.length : at + 1, 0, { id, name, items: [...items] });
  return { layout: next, id };
}

export function renameSection(layout, id, name) {
  const next = copy(layout);
  const s = next.sections.find((x) => x.id === id);
  if (!s) return layout;
  s.name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return next;
}

/**
 * 删掉分组。keep(key) 为 true 的行（还在的机器人和群聊）移到默认分组末尾，其余的（没用过的目录 Bot、已经删掉的行）丢掉。
 * 只剩一个分组时不删。返回 { layout, to }：to 是接收这些行的分组。
 */
export function deleteSection(layout, id, keep) {
  const gone = layout.sections.find((s) => s.id === id);
  if (!gone || layout.sections.length <= 1) return { layout, to: null };
  const next = copy(layout);
  next.sections = next.sections.filter((s) => s.id !== id);
  let def = next.sections.find((s) => s.default);
  if (!def) {
    def = next.sections[0];
    def.default = true;
  }
  def.items.push(...gone.items.filter(keep));
  return { layout: next, to: def };
}

// —— 存取 ——

/** 当前布局；null = 还没读到 */
export const sideLayout = createStore(null);
let loaded = false; // 读到过服务端的布局（或确认服务端还没有）：读失败时不自动保存，免得拿默认布局盖掉服务端那份
let loading = null;
let chain = Promise.resolve();

export function loadSideLayout() {
  if (loaded || loading) return loading;
  loading = api("/sidebar-layout")
    .then((d) => {
      loaded = true;
      sideLayout.set(d.layout || defaultLayout());
    })
    .catch(() => {
      if (!sideLayout.get()) sideLayout.set(defaultLayout());
    })
    .finally(() => (loading = null));
  return loading;
}

/** 自动放行（place 的结果）只在读到过服务端的布局之后才存 */
export const sideLayoutLoaded = () => loaded;

// 删掉的机器人和群聊的键：每次打开应用清一次（prune）。不在删的当下清：那一行还要在原来的位置淡出
let pruned = false;
export const sideLayoutPruned = () => pruned;
export const markSideLayoutPruned = () => void (pruned = true);

/**
 * 先改界面再存。按顺序一个一个发，后发的不会被先发的盖掉。存失败时重新读一遍服务端的布局，错误抛给调用方。
 */
export function saveSideLayout(next) {
  sideLayout.set(next);
  const run = chain.then(() => api("/sidebar-layout", { method: "PUT", body: { layout: next } }));
  chain = run.catch(() => {});
  return run.catch((e) => {
    loaded = false;
    void loadSideLayout();
    throw e;
  });
}

// —— 折叠（本机） ——

const FOLD = "amb-side-fold";
const OLD_FOLD = "amb-catalog-fold"; // 以前只有「上新」能折叠
const readFold = () => {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD) || "null");
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    return JSON.parse(localStorage.getItem(OLD_FOLD) || "false") === true ? ["latest"] : [];
  } catch {
    return [];
  }
};
export const sideFold = createStore(readFold());
export function toggleSideFold(id) {
  sideFold.set((list) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-100);
    try {
      localStorage.setItem(FOLD, JSON.stringify(next));
    } catch {
      /* 存不了：只影响下次打开时的折叠 */
    }
    return next;
  });
}
