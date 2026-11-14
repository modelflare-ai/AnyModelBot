// 连接应用的界面状态：应用清单（内置应用 + 自定义连接器）、正在打开的弹窗，以及状态、认证方式、修复按钮的对应关系。
// 清单是全局一份：应用页、机器人设置的「应用」一节、对话里的连接卡片、头像菜单上的提醒点都读它。
import { createStore } from "./store.js";
import { api } from "./api.js";
import { getLang, has, t } from "./i18n.js";

const EMPTY = { loaded: false, error: "", catalog: [], apps: [], attention: false, customCount: 0, maxCustom: 20 };
export const appsStore = createStore(EMPTY);

/** 接口回来的清单（任何带 apps 的回复都可以直接交给它） */
export function setApps(data) {
  if (!data || !Array.isArray(data.apps)) return;
  appsStore.set((s) => ({ ...s, loaded: true, error: "", catalog: data.catalog ?? s.catalog, apps: data.apps, attention: !!data.attention, customCount: data.customCount ?? s.customCount, maxCustom: data.maxCustom ?? s.maxCustom }));
}

let loading = null;
export function loadApps() {
  loading ??= api("/apps")
    .then(setApps)
    .catch((e) => {
      appsStore.set((s) => ({ ...s, error: e?.message || t("common.error") }));
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

// —— 弹窗：全局一个（main.js 的 AppDialogHost），哪里都能打开 ——
// { kind: "connect", app, accountId?, example? } 连接内置应用的一个账号（给了 accountId 是修复：重新授权、修改密钥、更新链接）
// { kind: "manage", key }                       管理一个应用或自定义连接器
// { kind: "custom", id? }                       添加 / 编辑自定义连接器
export const appDialog = createStore(null);
export const openConnect = (app, opts = {}) => appDialog.set({ kind: "connect", app, ...opts });
export const openManage = (key) => appDialog.set({ kind: "manage", key });
export const openCustom = (id) => appDialog.set({ kind: "custom", ...(id ? { id } : {}) });
export const closeAppDialog = () => appDialog.set(null);

/** 对话里的连接 / 修复卡片、「需要你」里的「去连接」：打开对应的弹窗。c = { app, custom, kind, accountId } */
export function openRepair(c) {
  if (!c) return;
  // 自定义连接器：关着的去管理里开启；凭证的问题（要登录、密钥被拒、链接失效）打开编辑，改完保存就重新测试、需要时去授权
  if (c.custom) return c.kind === "connect" || !c.accountId ? openManage(c.app) : openCustom(c.accountId);
  openConnect(c.app, c.accountId ? { accountId: c.accountId } : {});
}

/** 界面语言是不是中文（内置应用的名字、置顶顺序按它分） */
const zh = (lang) => String(lang || "").toLowerCase().startsWith("zh");

/** 内置应用的名字：中文界面用中文名，其他语言用英文名 */
export function builtinName(entry, lang) {
  return entry ? (zh(lang) ? entry.name.zh : entry.name.en) : "";
}

/** 审批卡片、连接卡片上的应用名：内置应用按界面语言取，清单还没到时用后端给的名字 */
export function appDisplayName(appId, fallback) {
  const entry = appsStore.get().catalog.find((c) => c.id === appId);
  return entry ? builtinName(entry, getLang()) : fallback || appId;
}

/** 一个应用（内置或自定义）在界面上的名字 */
export function appLabel(view, catalog, lang) {
  if (!view) return "";
  if (view.custom) return view.name || "MCP";
  return builtinName(catalog.find((c) => c.id === view.app), lang) || view.app;
}

/** 非中文界面置顶的顺序；其余按清单原来的顺序排在后面 */
const GLOBAL_FIRST = ["github", "notion", "linear", "atlassian", "canva"];
/** 中文界面：国内 5 个 + Notion 在前，其余在后；其他语言：GitHub、Notion、Linear、Atlassian、Canva 在前 */
export function orderCatalog(catalog, lang) {
  const list = [...catalog];
  if (zh(lang)) {
    const ids = ["feishu", "tencent-docs", "dingtalk", "amap", "yuque", "notion"];
    const top = ids.map((id) => list.find((c) => c.id === id)).filter(Boolean);
    return [...top, ...list.filter((c) => !top.includes(c))];
  }
  const top = GLOBAL_FIRST.map((id) => list.find((c) => c.id === id)).filter(Boolean);
  return [...top, ...list.filter((c) => !top.includes(c))];
}

/** 卡片上写的接入方式：内置应用的第一种连接方式 → 认证方式的名字 */
export function builtinMethod(entry) {
  const kind = entry?.methods?.[0]?.kind;
  return kind === "oauth" || kind === "notion-oauth" ? "oauth" : kind === "header" ? "headers" : kind === "localToken" || kind === "notion-token" ? "token" : "dedicatedUrl";
}
export const methodLabel = (method) => (has(`apps.method.${method}`) ? t(`apps.method.${method}`) : method);

/** 状态的文字：已连接带工具数 */
export function stateText(state, tools) {
  if (state === "connected") return tools ? t("apps.state.connectedTools", { n: tools }) : t("apps.state.connected");
  return has(`apps.state.${state}`) ? t(`apps.state.${state}`) : "";
}
/** 状态的语气：ok 正常 · warn 要用户处理 · off 关着 / 测试中 */
export function stateTone(state) {
  if (state === "connected") return "ok";
  if (state === "off" || state === "testing" || state === "none") return "off";
  return "warn";
}
/** 要用户处理凭证的状态（提醒点） */
export const ATTENTION = ["needs-login", "key-rejected", "link-invalid", "expired"];

/**
 * 这个状态给哪些修复按钮：[{ id, label }]。id：
 * enable 开启 · authorize 去授权 / 去登录 / 重新授权 · key 修改密钥 · link 更新链接 · retry 重试 · network 检查网络设置 · logs 查看日志 · edit 编辑命令
 */
export function repairActions(state, { custom = false, method = "" } = {}) {
  switch (state) {
    case "off":
      return custom ? [{ id: "enable", label: t("apps.fix.enable") }] : [];
    case "needs-login":
      return [{ id: "authorize", label: t(method === "oauth" || !method ? "apps.fix.authorize" : "apps.fix.signIn") }];
    case "expired":
      return [{ id: "authorize", label: t("apps.fix.reauthorize") }];
    case "key-rejected":
      return [{ id: "key", label: t("apps.fix.key") }];
    case "link-invalid":
      return [{ id: "link", label: t("apps.fix.link") }];
    case "unreachable":
      return [
        { id: "retry", label: t("apps.fix.retry") },
        { id: "network", label: t("apps.fix.network") },
      ];
    case "local-failed":
      return [
        { id: "logs", label: t("apps.fix.logs") },
        ...(custom ? [{ id: "edit", label: t("apps.fix.edit") }] : [{ id: "retry", label: t("apps.fix.retry") }]),
      ];
    default:
      return [];
  }
}

/** 搜索：应用名、中英文别名、用途词、已连接账号的别名 */
export function matchesApp(q, { entry, view, lang }) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = [];
  if (entry) hay.push(entry.name.zh, entry.name.en, entry.id, ...(entry.keywords || []));
  if (view) {
    if (view.name) hay.push(view.name);
    for (const a of view.accounts || []) hay.push(a.label);
  }
  if (entry && has(`apps.catalog.${entry.id}.desc`)) hay.push(t(`apps.catalog.${entry.id}.desc`));
  void lang;
  return hay.some((x) => String(x || "").toLowerCase().includes(needle));
}

/** 内置应用的几步说明：apps.catalog.<id>.steps.<方式>.0、1、2… */
export function stepsOf(appId, method, params) {
  const out = [];
  for (let i = 0; has(`apps.catalog.${appId}.steps.${method}.${i}`); i++) out.push(t(`apps.catalog.${appId}.steps.${method}.${i}`, params));
  return out;
}
