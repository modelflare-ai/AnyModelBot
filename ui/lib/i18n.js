// 界面多语言：简体中文 / English。
//
// 语言偏好（system | zh-CN | en）是应用级设置，以服务端配置 config.ui.lang 为准：托盘菜单、服务端报错、
// 机器人发到微信 / 飞书的系统消息都跟着它。localStorage 只缓存一份给首帧用（index.html 先按它设 <html lang>），
// 启动后 App 读到 /settings 里的 lang 再以服务端为准（adoptServerLang）。
// 每个 API 请求带 x-amb-lang（解析后的语言），服务端据此返回同一种语言的报错和状态文字。
//
// 文案在 ui/locales/<语言>/<命名空间>.js，键 = "命名空间.键"，可以嵌套（"settings.rows.theme.name"）。
//   t("chat.send")                              → 纯文本
//   t("chat.queued", { n: 3 })                  → 插值：文案里写 {n}
//   t("chat.files", { count: 2 })               → 复数：文案写成 { one: "…", other: "…" }，按 count 选（Intl.PluralRules）
//   t("appearance.hint", { b: html`<b>…</b>` }) → 插值里有 vnode 时返回数组，可直接放进 htm 模板
// 缺失的键先回退到简体中文，再回退到键名本身（开发时控制台警告一次）。
// 切换语言时 App 订阅 useLang() 整棵树重渲染：模块顶层不要缓存翻译后的字符串（写成函数，渲染时再取），
// useMemo 的依赖里要带上 useLang() 的返回值。
import { useEffect, useState } from "preact/hooks";
import zhCN from "../locales/zh-CN/index.js";
import en from "../locales/en/index.js";

export const LANGS = ["zh-CN", "en"];
/** 各语言用自己的文字写名字（语言菜单的惯例），不随界面语言翻译 */
export const LANG_NAMES = { "zh-CN": "简体中文", en: "English" }; // i18n-ignore
const DICTS = { "zh-CN": zhCN, en };
const FALLBACK = "zh-CN";
const KEY = "amb-lang";

/** "zh" / "zh-Hans-CN" / "zh-TW" → zh-CN；"en-US" → en；其他 → null */
export function normalizeLang(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v.startsWith("zh")) return "zh-CN";
  if (v.startsWith("en")) return "en";
  return null;
}
export const normalizePref = (s) => (s === "system" ? "system" : normalizeLang(s) || "system");

/** 系统语言：按浏览器的首选语言列表找第一个支持的；都不支持时用英文 */
export function systemLang() {
  const list = (typeof navigator !== "undefined" && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  for (const l of list) {
    const n = normalizeLang(l);
    if (n) return n;
  }
  return "en";
}

function readPref() {
  try {
    return normalizePref(localStorage.getItem(KEY));
  } catch {
    return "system";
  }
}

let pref = readPref();
let current = pref === "system" ? systemLang() : pref;
const subs = new Set();

/** 当前界面语言（解析后的 zh-CN | en） */
export const getLang = () => current;
/** 语言偏好（system | zh-CN | en） */
export const getLangPref = () => pref;
/** 给 Intl / toLocaleString 用的语言标签 */
export const locale = () => current;

function apply() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}

/** 只在本机生效（不写服务端）：读到服务端配置时、或保存失败回滚时用 */
export function setLangPref(next) {
  const p = normalizePref(next);
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* 隐私模式等：只在本次生效 */
  }
  const resolved = p === "system" ? systemLang() : p;
  const changed = resolved !== current || p !== pref;
  pref = p;
  current = resolved;
  apply();
  if (changed) for (const fn of subs) fn();
}

/** 用户在界面上换语言：本机立刻生效，再存到服务端（托盘菜单、系统消息跟着变）；保存失败时回滚并抛出 */
export async function changeLang(next) {
  const prev = pref;
  setLangPref(next);
  try {
    const res = await fetch("/amb/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-amb-lang": current },
      body: JSON.stringify({ lang: pref }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    setLangPref(prev);
    throw e;
  }
}

/** 启动时读到服务端的语言偏好：以服务端为准（同一份配置可能在另一个窗口 / 浏览器里改过） */
export function adoptServerLang(serverPref) {
  if (serverPref === undefined || serverPref === null) return;
  if (normalizePref(serverPref) !== pref) setLangPref(serverPref);
}

/** 订阅语言变化；返回取消订阅的函数 */
export function onLangChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** 组件里取当前语言并在切换时重渲染 */
export function useLang() {
  // 偏好变了但解析后的语言没变（系统本来就是英文，从"跟随系统"换到 English）也要重渲染：语言菜单的选中项变了
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  return current;
}

// 跟随系统时，系统语言变了（浏览器 / 系统设置里改了首选语言）也跟着变
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => pref === "system" && setLangPref("system"));
  // 同一浏览器开了多个标签页：一处改了，其他标签页跟着变
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) setLangPref(readPref());
  });
}
apply();

// —— 查表与格式化 ——
function lookup(dict, key) {
  let v = dict;
  for (const k of key.split(".")) {
    if (v === null || typeof v !== "object") return undefined;
    v = v[k];
  }
  return v;
}

const isPlural = (v) => v !== null && typeof v === "object" && typeof v.other === "string";
const rulesCache = {};
const pluralRules = (l) => (rulesCache[l] ||= new Intl.PluralRules(l));
const warned = new Set();

function resolve(key) {
  let v = lookup(DICTS[current], key);
  if (typeof v !== "string" && !isPlural(v)) v = lookup(DICTS[FALLBACK], key);
  if (typeof v === "string" || isPlural(v)) return v;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[i18n] missing message: ${key}`);
  }
  return undefined;
}

/** 这个键有没有文案（给拼出来的动态键用：t(has(k) ? k : "common.unknown")） */
export const has = (key) => {
  const v = lookup(DICTS[current], key) ?? lookup(DICTS[FALLBACK], key);
  return typeof v === "string" || isPlural(v);
};

/** 把 {name} 换成参数；参数里有 vnode（对象）时返回数组 */
export function format(s, params) {
  if (!params || !s.includes("{")) return s;
  const parts = s.split(/\{(\w+)\}/);
  let rich = false;
  const out = parts.map((p, i) => {
    if (i % 2 === 0) return p;
    if (!(p in params)) return `{${p}}`;
    const v = params[p];
    if (v !== null && typeof v === "object") {
      rich = true;
      return v;
    }
    return v === null || v === undefined ? "" : String(v);
  });
  return rich ? out.filter((x) => x !== "") : out.join("");
}

export function t(key, params) {
  let v = resolve(key);
  if (v === undefined) return key;
  if (isPlural(v)) {
    const n = Number(params?.count);
    v = (Number.isFinite(n) && v[pluralRules(current).select(n)]) || v.other;
  }
  return format(v, params);
}

/** 数字按当前语言分组：1,234 */
export const fmtNum = (n, opts) => (Number.isFinite(Number(n)) ? new Intl.NumberFormat(current, opts).format(Number(n)) : String(n ?? ""));
/** 列表连接："A、B 和 C" / "A, B, and C" */
export const fmtList = (items, type = "conjunction") => {
  try {
    return new Intl.ListFormat(current, { type }).format(items.map(String));
  } catch {
    return items.join(current === "en" ? ", " : "、"); // i18n-ignore
  }
};
