/**
 * 侧栏分组（ui/lib/sections.js）：用户自己建的分组、分组的顺序、每个分组里放哪些行。存在 kv 里，桌面窗口和浏览器共用一份。
 * 这里只把收到的数据整理成合法的形状；哪一行该放进哪个分组（新机器人进默认分组、新上架的目录 Bot 进收件分组）由界面算。
 *
 * 行的键：`b:<机器人 id>`、`g:<群聊 id>`、`c:<目录 Bot id>`（目录 Bot 用没用过都是同一个键，用过之后留在原地）。
 */

export const SIDEBAR_LAYOUT_KEY = "sidebar-layout";
export const MAX_SECTIONS = 50;
export const MAX_SECTION_NAME = 40;
export const MAX_ITEMS = 2000;

export interface SidebarSection {
  id: string;
  /** 用户起的名字；空 = 用预设的名字（preset 对应的界面文案，跟着语言变） */
  name: string;
  /** 默认就有的两个分组：mine = 我的，latest = 上新 */
  preset?: "mine" | "latest";
  /** 新机器人、新群聊、被删分组里的行都进这里；总有且只有一个 */
  default?: true;
  /** 新上架的目录 Bot 进这里；删掉之后新上架的只在发现页出现 */
  inbox?: true;
  items: string[];
}

export interface SidebarLayout {
  version: 1;
  sections: SidebarSection[];
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const ITEM = /^[bgc]:[^\s]{1,120}$/;

/** 收到的布局整理成合法的形状；整理不出一个分组时返回 null */
export function sanitizeSidebarLayout(raw: unknown): SidebarLayout | null {
  const list = raw && typeof raw === "object" ? (raw as { sections?: unknown }).sections : undefined;
  if (!Array.isArray(list)) return null;
  const sections: SidebarSection[] = [];
  const ids = new Set<string>();
  const placed = new Set<string>();
  let total = 0;
  for (const s of list.slice(0, MAX_SECTIONS)) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID.test(r.id) || ids.has(r.id)) continue;
    ids.add(r.id);
    const items: string[] = [];
    // 一行只能在一个分组里：重复的以前面的为准
    for (const it of Array.isArray(r.items) ? r.items : []) {
      if (typeof it !== "string" || !ITEM.test(it) || placed.has(it) || total >= MAX_ITEMS) continue;
      placed.add(it);
      items.push(it);
      total++;
    }
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, MAX_SECTION_NAME) : "";
    const preset = r.preset === "mine" || r.preset === "latest" ? r.preset : undefined;
    sections.push({ id: r.id, name, ...(preset ? { preset } : {}), ...(r.default === true ? { default: true as const } : {}), ...(r.inbox === true ? { inbox: true as const } : {}), items });
  }
  if (!sections.length) return null;
  // 默认分组和收件分组各至多一个；没有默认分组时第一个就是
  const def = sections.findIndex((s) => s.default);
  sections.forEach((s, i) => (i === Math.max(def, 0) ? (s.default = true) : delete s.default));
  const inbox = sections.findIndex((s) => s.inbox);
  sections.forEach((s, i) => i !== inbox && delete s.inbox);
  return { version: 1, sections };
}

/** A removed catalog entry must not be resurrected by a stale client layout. */
export function withoutRemovedCatalog(layout: SidebarLayout | null, removed: (id: string) => boolean): SidebarLayout | null {
  if (!layout) return null;
  return { ...layout, sections: layout.sections.map((s) => ({ ...s, items: s.items.filter((key) => !key.startsWith("c:") || !removed(key.slice(2))) })) };
}
