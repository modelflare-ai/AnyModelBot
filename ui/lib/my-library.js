// 「我的技能库」（PRD 2026-11-25）：库里的条目（新导入的、各机器人装的、我存的合成一份）、本机导入对话框和
// 「从技能库添加…」弹窗的开关。接口见 src/web/routes/skill-library.ts。
import { createStore } from "./store.js";
import { api } from "./api.js";
import { has, t } from "./i18n.js";

/** 库里的全部：items 条目，discover 这一端能不能查找本机技能（{ available, reason }） */
export const myLibrary = createStore({ items: null, discover: null, error: "" });

let loading = null;
export function loadMyLibrary() {
  loading ??= api("/skill-library")
    .then((d) => {
      myLibrary.set({ items: d.items, discover: d.discover, error: "" });
      return d;
    })
    .catch((e) => {
      myLibrary.set((s) => ({ ...s, error: e?.message || "error" }));
      throw e;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** 本机导入对话框：{ botId?, botName? }（从机器人进来时带上，确认页默认在它上面使用） */
export const localImport = createStore(null);
export const openLocalImport = (o = {}) => localImport.set({ at: Date.now(), ...o });
export const closeLocalImport = () => localImport.set(null);

/** 「从技能库添加…」：{ botId, botName } */
export const libraryAdd = createStore(null);
export const openLibraryAdd = (o) => libraryAdd.set({ at: Date.now(), ...o });
export const closeLibraryAdd = () => libraryAdd.set(null);

/** 去「我的技能库」页面 */
export const openMyLibrary = () => {
  location.hash = "/skills/library";
};

/** 不能导入、开不了、移除不了的原因（服务端的 code → 一句话） */
export function reasonText(code, detail = "") {
  if (code === "reserved_name" && !detail) return t("skillLib.reason.reserved");
  if (has(`skillLib.reason.${code}`)) return t(`skillLib.reason.${code}`, { detail });
  if (has(`skillLib.errors.${code}`)) return t(`skillLib.errors.${code}`);
  return t("skillLib.reason.unknown");
}

/** 接口报错 → 一句话 */
export const errorText = (e) => (e?.data?.code ? reasonText(e.data.code, e.data.name || "") : e?.message || t("common.error"));

/** 条目的来源一行：本机导入 / 我存的 / 本地 ZIP / GitHub · 仓库 */
export function sourceLabel(source) {
  if (source?.type === "local") return t("skillLib.sourceLocal");
  if (source?.type === "mine") return t("skillLib.sourceMine");
  if (source?.type === "github") return t("skillLib.sourceGithub", { repo: `${source.owner}/${source.repo}` });
  return t("skillLib.sourceZip");
}

/** 一次导入的请求号：没收到回应时按它查结果，不重复提交 */
export const newRequestId = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
