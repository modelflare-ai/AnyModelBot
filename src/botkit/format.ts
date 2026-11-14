/**
 * Bot 包格式：一个 Bot 就是一个目录（docs/bot-framework.md）。这里定义 bot.json 的结构、权限和各种上限，
 * App 运行时、amb-bot 工具和约束检查都只认这一份。
 */
import fs from "node:fs";
import path from "node:path";
import { BOT_AVATARS, CATALOG_AVATARS, type BotAvatarKey } from "../domain/bot-settings.js";
import { BOT_PERMISSIONS, type BotPermission } from "../domain/app-ref.js";
import { RESERVED_SKILLS } from "../skills/archive.js";
export { BOT_PERMISSIONS, normalizeAppRef, type BotAppRef, type BotPermission } from "../domain/app-ref.js";

/** 文案必须有这两种语言；其余语言缺了退回 en */
export const REQUIRED_LANGS = ["zh-CN", "en"] as const;
export const BOT_LANGS = ["zh-CN", "en", "ja", "ko", "ru", "es", "pt"] as const;

/** 示例数据按语言放一份：sample.<语言>.json。规则和文案一样，zh-CN、en 必须有，其余语言缺了退回 en */
export const sampleName = (lang: string): string => `sample.${lang}.json`;
export const SAMPLE_FILES = BOT_LANGS.map(sampleName);

/** 这种语言该显示哪一份示例数据。lang 来自请求头，不在语言列表里的一律退回 en */
export function samplePath(dir: string, lang: string): string {
  const own = (BOT_LANGS as readonly string[]).includes(lang) ? path.join(dir, sampleName(lang)) : "";
  return own && fs.existsSync(own) ? own : path.join(dir, sampleName("en"));
}

/** 允许引入的技能许可证（SPDX）。仓库没有许可证的一律不用 */
export const LICENSE_ALLOW = ["MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0"] as const;

export const LIMITS = {
  /** 界面包（ui/、示例数据、数据约定）压缩后的上限 */
  uiBundleBytes: 500 * 1024,
  /** 运行包（人设、技能）压缩后的上限 */
  runtimeBundleBytes: 20 * 1024 * 1024,
  /** 解开后的总大小上限：防压缩炸弹 */
  unpackedBytes: 100 * 1024 * 1024,
  files: 2000,
  /** app/ 下单个文件的读取上限 */
  stateBytes: 2 * 1024 * 1024,
  /** 用户放进 app/inbox/ 的单个文件上限 */
  inboxBytes: 32 * 1024 * 1024,
  /** 界面用 readImage 读的单个图片上限 */
  imageBytes: 16 * 1024 * 1024,
  /** 音视频预览经父页面下载为 Blob，限制单次内存占用。 */
  mediaBytes: 200 * 1024 * 1024,
} as const;

/**
 * 界面套件后来加的能力，从哪个 App 版本开始有。套件随 App 发布，界面用到的话 minAppVersion 不能更低，
 * 否则老版本的 App 上这些调用会失败。加新能力时在这里登记（check.ts 的 ui.min-app-version）。
 */
export const KIT_SINCE: Record<string, string> = { readImage: "0.1.20", openFile: "0.1.20", openUrl: "0.1.20", Link: "0.1.20", readMedia: "0.1.23", releaseMedia: "0.1.23", Workspace: "0.1.33", setExpanded: "0.1.33" };

export const BOT_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+(\.\d+){1,3}(-[\w.]+)?$/;

export type Localized<T = string> = Partial<Record<(typeof BOT_LANGS)[number], T>>;

export interface SkillRef {
  name: string;
  /** clawhub:<slug>@<版本> 或 github:<owner>/<repo>/<路径>@<commit> */
  source: string;
  /** 这个技能目录的内容哈希（bundle.ts dirHash） */
  sha256: string;
  author: string;
  license: string;
  url: string;
}

export interface BotManifest {
  id: string;
  version: string;
  minAppVersion: string;
  name: Localized;
  summary: Localized;
  /** 三行说明（信息面板） */
  about: Localized<string[]>;
  avatar: BotAvatarKey;
  permissions: BotPermission[];
  /** 2–3 句可点的话 */
  starters: Localized<string[]>;
  /** 引入的技能；自己写的技能放 skills/，不用列在这里 */
  skills: SkillRef[];
}

export interface Issue {
  /** 规则名，比如 format.name；不通过时指出具体哪一条 */
  rule: string;
  message: string;
  file?: string;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function checkLocalized(field: string, v: unknown, issues: Issue[], each: (x: unknown, path: string) => void): void {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    issues.push({ rule: `format.${field}`, message: `${field} 要写成 { "zh-CN": …, "en": … }`, file: "bot.json" });
    return;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(BOT_LANGS as readonly string[]).includes(k)) issues.push({ rule: `format.${field}`, message: `${field} 里有不支持的语言 ${k}`, file: "bot.json" });
    else each(o[k], `${field}.${k}`);
  }
  for (const l of REQUIRED_LANGS) if (o[l] === undefined) issues.push({ rule: `format.${field}`, message: `${field} 缺少 ${l}`, file: "bot.json" });
}

/** 校验 bot.json。有 issues 时 manifest 也可能给出（能解析出多少给多少），调用方自己判断 */
export function parseManifest(raw: unknown): { manifest?: BotManifest; issues: Issue[] } {
  const issues: Issue[] = [];
  const fail = (rule: string, message: string) => issues.push({ rule: `format.${rule}`, message, file: "bot.json" });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("json", "bot.json 不是一个 JSON 对象");
    return { issues };
  }
  const r = raw as Record<string, any>;
  if (typeof r.id !== "string" || !BOT_ID.test(r.id)) fail("id", "id 只能用小写字母、数字和连字符，2–48 个字符");
  if (typeof r.version !== "string" || !VERSION.test(r.version)) fail("version", "version 要写成 1.0.0 这样的版本号");
  if (typeof r.minAppVersion !== "string" || !VERSION.test(r.minAppVersion)) fail("minAppVersion", "minAppVersion 要写成 0.1.18 这样的版本号");
  checkLocalized("name", r.name, issues, (x, p) => {
    if (!isStr(x) || x.length > 24) fail("name", `${p} 要写 1–24 个字符`);
  });
  checkLocalized("summary", r.summary, issues, (x, p) => {
    if (!isStr(x) || x.length > 80) fail("summary", `${p} 要写 1–80 个字符`);
  });
  checkLocalized("about", r.about, issues, (x, p) => {
    if (!Array.isArray(x) || x.length < 1 || x.length > 3 || !x.every(isStr)) fail("about", `${p} 要写 1–3 行说明`);
  });
  checkLocalized("starters", r.starters, issues, (x, p) => {
    if (!Array.isArray(x) || x.length < 2 || x.length > 3 || !x.every(isStr)) fail("starters", `${p} 要写 2–3 句可点的话`);
  });
  if (!(BOT_AVATARS as readonly unknown[]).includes(r.avatar)) fail("avatar", `avatar 只能是 ${BOT_AVATARS.join("、")} 之一`);
  else {
    const owner = (CATALOG_AVATARS as Record<string, string>)[r.avatar];
    if (owner && owner !== r.id) fail("avatar", `${r.avatar} 是 ${owner} 的专属形象，别的 Bot 不能用`);
  }
  if (!Array.isArray(r.permissions) || !r.permissions.every((p) => (BOT_PERMISSIONS as readonly unknown[]).includes(p))) fail("permissions", `permissions 只能包含 ${BOT_PERMISSIONS.join("、")}`);
  else if (new Set(r.permissions).size !== r.permissions.length) fail("permissions", "permissions 里有重复项");
  if (!Array.isArray(r.skills)) fail("skills", "skills 要写成数组，没有引入技能时写 []");
  else {
    const seen = new Set<string>();
    for (const [i, s] of (r.skills as any[]).entries()) {
      const at = `skills[${i}]`;
      if (!s || typeof s !== "object") {
        fail("skills", `${at} 不是对象`);
        continue;
      }
      if (typeof s.name !== "string" || !SKILL_NAME.test(s.name)) fail("skills", `${at}.name 只能用小写字母、数字和连字符`);
      else if ((RESERVED_SKILLS as readonly string[]).includes(s.name)) fail("skills", `${at}.name 不能用保留名字 ${s.name}`);
      else if (seen.has(s.name)) fail("skills", `${at}.name 重复：${s.name}`);
      else seen.add(s.name);
      if (!isStr(s.source)) fail("skills", `${at}.source 必填`);
      if (typeof s.sha256 !== "string" || !SHA256.test(s.sha256)) fail("skills", `${at}.sha256 要写 64 位十六进制`);
      if (!isStr(s.author)) fail("skills", `${at}.author 必填`);
      if (!isStr(s.license)) fail("skills", `${at}.license 必填`);
      if (typeof s.url !== "string" || !/^https:\/\//.test(s.url)) fail("skills", `${at}.url 要写来源原页面的 https 地址`);
    }
  }
  return issues.length ? { manifest: undefined, issues } : { manifest: r as BotManifest, issues };
}

/** 按语言取文案：缺了退回 en，再退回 zh-CN */
export function localized<T>(v: Localized<T> | undefined, lang: string): T | undefined {
  if (!v) return undefined;
  return v[lang as keyof Localized<T>] ?? v.en ?? v["zh-CN"];
}

/** a ≥ b（只比数字段；-后缀不参与） */
export function versionGte(a: string, b: string): boolean {
  const parts = (s: string) => s.split("-")[0].split(".").map((x) => Number(x) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
}
