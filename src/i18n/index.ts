/**
 * 服务端多语言：简体中文 / English。界面那一份见 ui/lib/i18n.js，两边的语言代码一致（zh-CN | en）。
 *
 * 用哪种语言（lang()）：
 *   1. 正在处理的界面请求：请求头 x-amb-lang（界面解析后的语言），由 web/server.ts 用 requestLang() 包住整个请求，
 *      请求里抛出的报错、返回的状态文字都是界面当前的语言。请求结束后这个语言就失效：在请求里启动、之后还在跑的
 *      后台任务（渠道收消息循环、代理进程的回调、排队的工作）自动退回应用语言，不会一直沿用某次请求的语言；
 *   2. 其他时候（后台任务、机器人发到微信 / 飞书的系统消息、托盘菜单）：应用的语言偏好 config.ui.lang；
 *      偏好是"跟随系统"时用系统语言——桌面版取系统首选语言（electron/main.ts 调 setSystemLang），
 *      命令行 / Docker 先看 AMB_LANG，再看 LC_ALL / LC_MESSAGES / LANG，都没有（或是 C / POSIX）时用简体中文。
 *
 * 文案在 src/i18n/messages/<命名空间>.ts；t() 的键有类型检查，写错键或漏了英文都编译不过。
 * 日志、给模型看的提示词和工具说明不走这里：前者给开发者看，后者模型两种语言都懂。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { catalogs } from "./messages/index.js";
import type { Msg } from "./types.js";

export type Lang = "zh-CN" | "en";
export type LangPref = "system" | Lang;
export const LANGS: readonly Lang[] = ["zh-CN", "en"];

type Catalogs = typeof catalogs;
export type MessageKey = { [N in keyof Catalogs]: `${N & string}.${Extract<keyof Catalogs[N]["zh"], string>}` }[keyof Catalogs];
export type Params = Record<string, string | number | boolean | null | undefined>;

/** "zh" / "zh_CN.UTF-8" / "zh-Hans" → zh-CN；"en-US" → en；其他 → undefined */
export function normalizeLang(s: unknown): Lang | undefined {
  const v = String(s ?? "").trim().toLowerCase();
  if (v.startsWith("zh")) return "zh-CN";
  if (v.startsWith("en")) return "en";
  return undefined;
}
export function normalizeLangPref(s: unknown): LangPref {
  return s === "system" ? "system" : (normalizeLang(s) ?? "system");
}

/** 命令行 / Docker 的系统语言：AMB_LANG → LC_ALL → LC_MESSAGES → LANG；没设或是 C / POSIX 时用简体中文（产品的默认语言），其他语言用英文 */
export function envLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const explicit = normalizeLang(env.AMB_LANG);
  if (explicit) return explicit;
  for (const k of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const v = String(env[k] ?? "").trim();
    if (!v) continue;
    if (/^(c|posix)([._].*)?$/i.test(v)) return "zh-CN";
    return normalizeLang(v) ?? "en";
  }
  return "zh-CN";
}

let systemLang: Lang = envLang();
let pref: LangPref = "system";
const listeners = new Set<(l: Lang) => void>();
/** live：请求还没结束。AsyncLocalStorage 会把 store 传给请求里派生出去的所有异步任务，结束时把它关掉 */
interface Scope {
  lang: Lang;
  live: boolean;
}
const als = new AsyncLocalStorage<Scope>();

/** 应用的语言（不看当前请求） */
export function appLang(): Lang {
  return pref === "system" ? systemLang : pref;
}
/** 当前该用的语言：界面请求里用请求的语言，否则用应用的语言 */
export function lang(): Lang {
  const s = als.getStore();
  return s && s.live ? s.lang : appLang();
}
export function getLangPref(): LangPref {
  return pref;
}

function changed(before: Lang): void {
  const now = appLang();
  if (now !== before) for (const fn of listeners) fn(now);
}
/** 系统语言（桌面版启动时按系统首选语言设一次） */
export function setSystemLang(l: Lang): void {
  const before = appLang();
  systemLang = l;
  changed(before);
}
/** 应用的语言偏好（读配置、界面里改了语言时调用） */
export function setLangPref(p: LangPref): void {
  const before = appLang();
  pref = normalizeLangPref(p);
  changed(before);
}
/** 应用语言变了（托盘菜单据此重建）；返回取消订阅的函数 */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 在指定语言下执行（含其中所有的 await）；l 为空时照常用应用语言 */
export function withLang<T>(l: Lang | undefined, fn: () => T): T {
  return l ? als.run({ lang: l, live: true }, fn) : fn();
}

/** 一次界面请求的语言：run() 里（含派生出去的异步任务）用 l，end() 之后它们都退回应用语言 */
export function requestLang(l: Lang | undefined): { run<T>(fn: () => T): T; end(): void } {
  const scope: Scope | undefined = l ? { lang: l, live: true } : undefined;
  return {
    run: (fn) => (scope ? als.run(scope, fn) : fn()),
    end: () => {
      if (scope) scope.live = false;
    },
  };
}

/** 不带任何请求的语言执行：常驻的后台循环从这里启动，一开始就用应用语言 */
export function detached<T>(fn: () => T): T {
  return als.exit(fn);
}

const rules = new Map<Lang, Intl.PluralRules>();
function pick(m: Msg, l: Lang, params?: Params): string {
  if (typeof m === "string") return m;
  const n = Number(params?.count);
  if (!Number.isFinite(n)) return m.other;
  let r = rules.get(l);
  if (!r) rules.set(l, (r = new Intl.PluralRules(l)));
  return (r.select(n) === "one" && m.one) || m.other;
}

function format(s: string, params?: Params): string {
  if (!params || !s.includes("{")) return s;
  return s.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k] ?? "") : all));
}

function lookup(l: Lang, key: string): Msg | undefined {
  const i = key.indexOf(".");
  const ns = (catalogs as Record<string, { zh: Record<string, Msg>; en: Record<string, Msg> }>)[key.slice(0, i)];
  if (!ns) return undefined;
  const k = key.slice(i + 1);
  return (l === "en" ? ns.en[k] : undefined) ?? ns.zh[k];
}

/** 按指定语言取文案 */
export function tl(l: Lang, key: MessageKey, params?: Params): string {
  const m = lookup(l, key);
  return m === undefined ? key : format(pick(m, l, params), params);
}
/** 按当前语言（lang()）取文案 */
export function t(key: MessageKey, params?: Params): string {
  return tl(lang(), key, params);
}
/** 只给拼出来的动态键用：键不存在时返回 undefined */
export function tMaybe(key: string, params?: Params): string | undefined {
  const l = lang();
  const m = lookup(l, key);
  return m === undefined ? undefined : format(pick(m, l, params), params);
}
