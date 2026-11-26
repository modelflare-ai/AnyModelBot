/**
 * 任务库（PRD 2026-11-15）：应用内置的一组定时任务。任务本身不运行；「用起来」时按用户填的参数生成一条普通规则
 * （名称、原话、时间表、结果样式、来源），之后的显示、开关、编辑、运行都走规则的老路。
 *
 * - 任务数据：ui/data/routine-library.json（id、version、分类、推荐顺序、类型、结果样式、默认时间、参数、依赖、推荐模板……）；
 *   文案：ui/locales/<语言>/routineLibrary.json（名称、一句话、适合谁、步骤、参数名、占位、示例结果、原话模板）。
 *   两份都随应用打包，不远程下发。界面经 GET /routines 拿当前语言的那一份，命令面板和对话里的 routine_library 也用它。
 * - 原话模板：{key} 换成参数（选项换成这种语言的说法，{key.say} 换成「怎么说」那一栏）；[……] 里有没填的参数时整段去掉。
 *   末尾按任务属性统一追加要求（联网、读应用、没新内容不发、简报），模板里不重复写。
 * - 时间表：默认时间的结构和规则的一样，不带时区；字段可以是 { param: key }（按参数填：每月几号、提前几天、每年几月几日），
 *   整个时间表也可以按一个参数选（收盘简报按市场）。用户的时区在用起来时补上。
 * - 应用 id 当前版本没有、要求的最低版本比当前高的任务不显示。
 */
import fs from "node:fs";
import path from "node:path";
import { findAppRoot } from "../magpie/supervisor.js";
import { lang as currentLang, type Lang } from "../i18n/index.js";
import type { Schedule } from "../domain/schedule.js";
import { appName as builtinName, BUILTIN_APPS } from "../tools/apps/catalog.js";
import { isNewer } from "../updates/check.js";
import { appVersion } from "../version.js";
import { describe, normalizeSchedule, previewSchedule } from "./schedule.js";

export type RoutineParamType = "text" | "list" | "select" | "multiselect" | "number" | "date" | "dayOfMonth" | "repo" | "group" | "app";
export interface RoutineParam {
  key: string;
  type: RoutineParamType;
  required?: boolean;
  /** 文字最多几个字（列表是每一项）；数字是最大值 */
  max?: number;
  /** 列表、多选最少几项 */
  min?: number;
  maxItems?: number;
  options?: string[];
  default?: string | string[];
  /** 预填这种语言的一句（提醒的话）：文案里的 prefill */
  prefill?: boolean;
}
export interface RoutineNeeds {
  web?: boolean;
  apps?: Array<{ id: string; required: boolean; alternatives?: string[] }>;
  group?: boolean;
}
export interface RoutineTask {
  id: string;
  version: number;
  category: "news" | "work" | "learning" | "life" | "money";
  rank: number;
  kind: "check" | "remind";
  resultStyle: "line" | "brief";
  quietWhenNothing: boolean;
  icon: string;
  /** 默认时间；{ param, map } = 按这个参数选一个 */
  schedule: Record<string, unknown>;
  params: RoutineParam[];
  needs: RoutineNeeds;
  suggestedTemplate?: string;
  replacesTemplateRule?: boolean;
  fallback?: string;
  budget?: { runUsd?: number; monthUsd?: number };
  minVersion?: string;
  /** 规则名称里带哪个参数（行业早报 · 新能源汽车） */
  titleParam?: string;
  /** 不在任务库里列出来：只能从别的任务的「改用联网版」到 */
  hidden?: boolean;
}
export interface RoutineParamCopy {
  label: string;
  placeholder?: string;
  prefill?: string;
  hint?: string;
  options?: Record<string, string>;
  /** 选项在句子里怎么说（提前 3 天 → 3 天后）；没写的选项在句子里不出现 */
  say?: Record<string, string>;
}
export interface RoutineCopy {
  title: string;
  oneLine: string;
  audience: string;
  steps: string[];
  sample: string;
  /** 原话模板（提醒是到点发的那句话） */
  instruction: string;
  params: Record<string, RoutineParamCopy>;
  /** 默认时间要等参数（每月 {日}、交易日收盘后）时给人看的那句 */
  when?: string;
}
export interface LibraryStrings {
  listSep: string;
  dayOfMonth: string;
  lastDay: string;
  append: { web: string; apps: string; quiet: string; brief: string };
  tasks: Record<string, RoutineCopy>;
}

const root = () => findAppRoot();
let cachedTasks: RoutineTask[] | undefined;
const cachedStrings = new Map<Lang, LibraryStrings>();

/** 全部任务（包括隐藏的联网版）；当前版本没有的应用、版本不够的不算 */
export function libraryTasks(): RoutineTask[] {
  if (!cachedTasks) {
    const all = (JSON.parse(fs.readFileSync(path.join(root(), "ui/data/routine-library.json"), "utf8")).tasks ?? []) as RoutineTask[];
    const apps = new Set(BUILTIN_APPS.map((a) => a.id));
    const version = appVersion();
    cachedTasks = all
      .filter((x) => (x.needs.apps ?? []).every((a) => apps.has(a.id) && (a.alternatives ?? []).every((b) => apps.has(b))))
      .filter((x) => !x.minVersion || !version || !isNewer(x.minVersion, version))
      .sort((a, b) => a.rank - b.rank);
  }
  return cachedTasks;
}

export function libraryStrings(l: Lang = currentLang()): LibraryStrings {
  let s = cachedStrings.get(l);
  if (!s) {
    s = JSON.parse(fs.readFileSync(path.join(root(), "ui/locales", l, "routineLibrary.json"), "utf8")) as LibraryStrings;
    cachedStrings.set(l, s);
  }
  return s;
}

export function libraryTask(id: string): RoutineTask | undefined {
  return libraryTasks().find((x) => x.id === id);
}

/** 应用的名字（中文界面用中文名） */
export function appName(id: string, l: Lang = currentLang()): string {
  return builtinName(id, l);
}

// ---------- 参数 ----------

export type ParamValues = Record<string, unknown>;
/** 参数的问题：没填、太长、格式不对（仓库 owner/repo、日期）、项太多、不是选项里的 */
export type ParamError = "required" | "tooLong" | "tooMany" | "format" | "repoFormat" | "invalid";

const flat = (s: unknown) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function listOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,，、;；]+/) : [];
  return [...new Set(raw.map(flat).filter(Boolean))];
}

/**
 * 整理用户填的参数：文字里的换行换成空格，列表去重去空，没填的用默认值（预填的提醒用这种语言的那句）。
 * 返回整理后的值和每个参数的问题（没问题的不在 errors 里）。超长不截断：界面上不能继续输入，接口这边报 tooLong。
 */
export function normalizeParams(task: RoutineTask, raw: ParamValues, l: Lang = currentLang(), ctx: { groups?: string[] } = {}): { values: ParamValues; errors: Record<string, ParamError> } {
  const copy = libraryStrings(l).tasks[task.id];
  const values: ParamValues = {};
  const errors: Record<string, ParamError> = {};
  for (const p of task.params) {
    const given = raw?.[p.key];
    const fallback = p.prefill ? copy?.params[p.key]?.prefill : p.default;
    switch (p.type) {
      case "text": {
        const v = given === undefined ? flat(fallback) : flat(given);
        if (v) values[p.key] = v;
        if (p.max && [...v].length > p.max) errors[p.key] = "tooLong";
        break;
      }
      case "list":
      case "repo": {
        const v = given === undefined ? listOf(fallback) : listOf(given);
        if (v.length) values[p.key] = v;
        if (p.maxItems && v.length > p.maxItems) errors[p.key] = "tooMany";
        else if (p.max && v.some((x) => [...x].length > p.max!)) errors[p.key] = "tooLong";
        else if (p.type === "repo" && v.some((x) => !REPO.test(x.replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "")))) errors[p.key] = "repoFormat";
        if (p.type === "repo" && v.length) values[p.key] = v.map((x) => x.replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, ""));
        if (!errors[p.key] && p.min && v.length < p.min && (p.required || v.length)) errors[p.key] = "required";
        break;
      }
      case "select":
      case "app": {
        const v = flat(given === undefined || given === "" ? fallback : given);
        if (v && !(p.options ?? []).includes(v)) errors[p.key] = "invalid";
        else if (v) values[p.key] = v;
        break;
      }
      case "multiselect": {
        const list = given === undefined ? (Array.isArray(fallback) ? fallback : []) : Array.isArray(given) ? given.map(String) : listOf(given);
        const v = (p.options ?? []).filter((o) => list.includes(o));
        if (list.some((x) => !(p.options ?? []).includes(x))) errors[p.key] = "invalid";
        if (v.length) values[p.key] = v;
        if (p.min && v.length < p.min && p.required) errors[p.key] = "required";
        break;
      }
      case "number": {
        const s = flat(given ?? fallback).replace(/[,，\s]/g, "");
        if (!s) break;
        const n = Number(s);
        if (!Number.isFinite(n) || n <= 0 || (p.max && n > p.max)) errors[p.key] = "format";
        else values[p.key] = n;
        break;
      }
      case "date": {
        const s = flat(given ?? fallback);
        if (!s) break;
        const m = /^(\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
        const month = m ? Number(m[1]) : 0, day = m ? Number(m[2]) : 0;
        if (!m || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) errors[p.key] = "format";
        else values[p.key] = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        break;
      }
      case "dayOfMonth": {
        const s = flat(given ?? fallback);
        if (!s) break;
        const n = Number(s);
        if (s === "last") values[p.key] = "last";
        else if (!Number.isInteger(n) || n < 1 || n > 31) errors[p.key] = "format";
        else values[p.key] = n;
        break;
      }
      case "group": {
        const v = flat(given ?? fallback);
        if (v && ctx.groups && !ctx.groups.includes(v)) errors[p.key] = "invalid";
        else if (v) values[p.key] = v;
        break;
      }
    }
    if (p.required && values[p.key] === undefined && !errors[p.key]) errors[p.key] = "required";
  }
  return { values, errors };
}

/** 参数在句子里的样子：选项换成这种语言的说法，列表用这种语言的顿号连起来；say = 选项「怎么说」那一栏 */
export function paramText(task: RoutineTask, key: string, values: ParamValues, l: Lang = currentLang(), ctx: { groupName?: (id: string) => string } = {}, say = false): string {
  const strings = libraryStrings(l);
  const p = task.params.find((x) => x.key === key);
  const copy = strings.tasks[task.id]?.params[key];
  const v = values[key];
  if (!p || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
  // 「怎么说」那一栏没写的选项在句子里不出现（今日日程：选「全部」时什么都不加）
  const option = (o: string) => (say && copy?.say ? copy.say[o] ?? "" : copy?.options?.[o] ?? (p.type === "app" ? appName(o, l) : o));
  switch (p.type) {
    case "select":
    case "app":
      return option(String(v));
    case "multiselect":
      return (v as string[]).map(option).join(strings.listSep);
    case "list":
    case "repo":
      return (v as string[]).join(strings.listSep);
    case "dayOfMonth":
      return v === "last" ? strings.lastDay : strings.dayOfMonth.replace("{day}", String(v));
    case "date": {
      const [month, day] = String(v).split("-").map(Number);
      return new Intl.DateTimeFormat(l, { month: l === "en" ? "short" : "long", day: "numeric", timeZone: "UTC" }).format(Date.UTC(2024, month - 1, day));
    }
    case "group":
      return ctx.groupName?.(String(v)) || String(v);
    default:
      return String(v);
  }
}

/** 模板 → 句子：先去掉有没填参数的 [……]，再换 {key} / {key.say} */
export function fillTemplate(template: string, text: (key: string, say: boolean) => string): string {
  const keys = (s: string) => [...s.matchAll(/\{(\w+)(\.say)?\}/g)].map((m) => ({ key: m[1], say: !!m[2] }));
  const kept = template.replace(/\[([^\[\]]*)\]/g, (_, inner: string) => (keys(inner).every((k) => text(k.key, k.say)) ? inner : ""));
  return kept.replace(/\{(\w+)(\.say)?\}/g, (_, key: string, say?: string) => text(key, !!say)).replace(/[ \t]{2,}/g, " ").trim();
}

export interface RoutineDraft {
  title: string;
  /** 检查：完整的原话（模板 + 统一追加的要求）；提醒：和 message 一样 */
  instruction: string;
  /** 提醒：到点发的那句话 */
  message: string;
  kind: "check" | "remind";
  resultStyle: "line" | "brief";
  values: ParamValues;
  errors: Record<string, ParamError>;
  /** 默认时间（补上了时区）；时间要等参数而参数还没填时没有 */
  schedule?: Schedule;
}

/** 按任务和参数写出规则的名称、原话（不校验依赖：应用连没连、群在不在由调用方看） */
export function draftRule(task: RoutineTask, raw: ParamValues, o: { lang?: Lang; tz: string; now: number; groups?: Array<{ id: string; name: string }> }): RoutineDraft {
  const l = o.lang ?? currentLang();
  const strings = libraryStrings(l);
  const copy = strings.tasks[task.id];
  const { values, errors } = normalizeParams(task, raw, l, o.groups ? { groups: o.groups.map((g) => g.id) } : {});
  const ctx = { groupName: (id: string) => o.groups?.find((g) => g.id === id)?.name ?? "" };
  const text = (key: string, say: boolean) => paramText(task, key, values, l, ctx, say);
  const body = fillTemplate(copy.instruction, text);
  const extra = task.kind === "check"
    ? [task.needs.web && strings.append.web, task.needs.apps?.length && strings.append.apps, task.quietWhenNothing && strings.append.quiet, task.resultStyle === "brief" && strings.append.brief].filter(Boolean)
    : [];
  const instruction = [body, ...extra].join("\n");
  const suffix = task.titleParam ? text(task.titleParam, false) : "";
  const title = suffix ? `${copy.title} · ${suffix}` : copy.title;
  return { title, instruction, message: task.kind === "remind" ? body : "", kind: task.kind, resultStyle: task.kind === "check" ? task.resultStyle : "line", values, errors, schedule: scheduleFor(task, values, o.tz, o.now) };
}

/** 按参数定下的默认时间（补上时区）；要的参数没填时 undefined */
export function scheduleFor(task: RoutineTask, values: ParamValues, tz: string, now: number): Schedule | undefined {
  let raw = task.schedule;
  if (typeof raw.param === "string") {
    const p = task.params.find((x) => x.key === raw.param);
    const key = String(values[raw.param as string] ?? p?.default ?? "");
    raw = ((raw.map ?? {}) as Record<string, Record<string, unknown>>)[key];
    if (!raw) return undefined;
  }
  const spec: Record<string, unknown> = { ...raw, tz };
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object" || Array.isArray(v) || typeof (v as { param?: unknown }).param !== "string") continue;
    const p = task.params.find((x) => x.key === (v as { param: string }).param);
    const value = values[(v as { param: string }).param] ?? p?.default;
    if (value === undefined || value === "") {
      if (k === "before") { delete spec[k]; continue; }
      return undefined;
    }
    if (k === "date") {
      const [month, day] = String(value).split("-").map(Number);
      delete spec.date;
      spec.month = month;
      spec.day = day;
    } else spec[k] = k === "before" ? Number(value) : value;
  }
  return normalizeSchedule(spec, tz, now).schedule;
}

/** 卡片、详情上的默认时间：等参数的用文案里的那句，其余按时间表说 */
export function defaultWhen(task: RoutineTask, l: Lang, tz: string, now: number): { text: string; monthlyRuns?: number; yearly?: boolean } {
  const copy = libraryStrings(l).tasks[task.id];
  const s = scheduleFor(task, {}, tz, now);
  if (task.schedule.kind === "yearly") return { text: copy.when ?? (s ? describe(s, false, l) : ""), yearly: true };
  if (task.schedule.kind === "monthly" && !s) return { text: copy.when ?? "", monthlyRuns: 1 };
  return { text: copy.when ?? (s ? describe(s, false, l) : ""), ...(s ? { monthlyRuns: previewSchedule(s, now).monthlyRuns } : {}) };
}

/** 搜索用的字：当前语言、中文和英文的名称、说明、适合谁、参数名，加上依赖的应用名（中英文） */
export function searchText(task: RoutineTask, l: Lang): string {
  const langs = [...new Set<Lang>([l, "zh-CN", "en"])];
  const parts: string[] = [];
  for (const x of langs) {
    const c = libraryStrings(x).tasks[task.id];
    if (!c) continue;
    parts.push(c.title, c.oneLine, c.audience, ...Object.values(c.params).map((p) => p.label));
  }
  for (const a of task.needs.apps ?? []) for (const id of [a.id, ...(a.alternatives ?? [])]) parts.push(...langs.map((lang) => appName(id, lang)), id);
  for (const p of task.params) if (p.type === "app") for (const id of p.options ?? []) parts.push(...langs.map((lang) => appName(id, lang)));
  return parts.join(" ").toLowerCase();
}

/** 两次「用起来」的参数是不是一样（重复检测）：整理后的值逐项比 */
export function sameParams(a: ParamValues | undefined, b: ParamValues | undefined): boolean {
  const norm = (v: ParamValues | undefined) => JSON.stringify(Object.keys(v ?? {}).sort().map((k) => [k, v![k]]));
  return norm(a) === norm(b);
}
