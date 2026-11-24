/**
 * 从本机导入技能（PRD 2026-11-25 R1、R2、R4）：在这台电脑上找到其他工具装好的技能，选好、预览，一次复制进「我的技能库」。
 *
 * 发现（R1）
 * - 自动根只有 U01–U06（主目录下的六个技能目录，见 AUTO_ROOTS）；只枚举目录项和 SKILL.md 文件名，不读正文。
 *   同一个真实目录只算一次（共享目录不代表装过某个平台）；不存在、没权限、取消各自说明，取消时已找到的照样能选。
 * - 「选择文件夹…」由桌面版的系统选择器给出路径（不接受网页传来的路径）：一个技能文件夹、装着多个技能的根、或一个项目
 *   （只看 PROJECT_ROOTS 里的已知相对位置）。主目录、磁盘根、应用数据总根、本应用的数据目录不递归，提示选具体位置。
 *   选的根本身是链接时先给出真实位置，确认后才读；根里的链接指到根外、断开、成环的那一项不读。
 * - 只在库宿主自己的桌面版里开放（app.desktop，且请求来自本机回环地址）；网页、远端、Docker 说明原因，原 ZIP / GitHub 照常。
 *
 * 预览和导入（R2、R4）
 * - 「下一步」才读所选技能的完整目录（有界：64 MiB、2000 项、SKILL.md 256 KiB），逐项校验，同内容的多个来源合成一项。
 *   和库里比：完整相对路径和字节都相同 → 已存在；同调用名不同内容 → 默认跳过，可「另存一份」（展示名加后缀，调用名和正文不改）。
 * - 确认时每一项重新读来源核对摘要：变了、没了、库里同时多了同名的 → 这一项不写，提示重新预览；不用旧的确认覆盖。
 * - 每项完整写入后才进索引（SkillLibrary.add）；开启失败不影响已入库的。同一个请求号重复提交返回原结果（kv skill-import:<号>）。
 * - 不执行脚本、不装依赖、不替换平台路径变量；文件内容和私人路径不进日志、不交给模型。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import type { BundleFile } from "../botkit/bundle.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import { NEW_RESERVED_SKILLS, SCRIPT_FILE, SKILL_LIMITS, SkillError, reservedSkill, skillName, skillPath } from "./archive.js";
import { contentDigest, type LibraryEntry, type LocalSource } from "./library.js";

const log = logger("skills.local");

/** 自动发现的六个用户级位置（R1 表 U01–U06）；project：项目里也查同样的相对位置（U02 不推导到项目） */
export const AUTO_ROOTS = [
  { id: "U01", rel: ".codebuddy/skills", project: true },
  { id: "U02", rel: ".qwenworkcn/skills", project: false },
  { id: "U03", rel: ".agents/skills", project: true },
  { id: "U04", rel: ".claude/skills", project: true },
  { id: "U05", rel: ".cursor/skills", project: true },
  { id: "U06", rel: ".codex/skills", project: true },
] as const;
export const PROJECT_ROOTS = AUTO_ROOTS.filter((r) => r.project);

/** 只给定位提示、不自动扫描的位置（M01、M02）：按这台电脑的系统给出 */
export function manualHints(platform: NodeJS.Platform = process.platform): string[] {
  const hints = ["~/.workbuddy/skills/", "<project>/.workbuddy/skills/"];
  if (platform === "darwin") hints.push("~/Library/Application Support/DoubaoWork/…/.doubaowork/agent_mode/workspace/.user_skills/");
  if (platform === "win32") hints.push("%LOCALAPPDATA%/DoubaoWork/User Data/…/.doubaowork/agent_mode/workspace/.user_skills/", "%APPDATA%/DoubaoWork/…/.doubaowork/agent_mode/workspace/.user_skills/");
  return hints;
}

/** 不算技能内容、也不计数的东西（可以在「查看」里看到） */
const IGNORED = (name: string) => name === ".git" || name === "__MACOSX" || name === ".DS_Store" || name.startsWith("._");
/** 枚举分类子目录时不进去的目录 */
const SKIP_DIR = (name: string) => name.startsWith(".") || name === "node_modules" || name === "__MACOSX";
/** 疑似私人文件：这一项先不读、不导入，请用户自己整理后重选（不保证认出所有秘密） */
const PRIVATE = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.htpasswd|memory\.md|secrets?\.(?:json|ya?ml|toml)|token\.json|.+\.(?:pem|p12|pfx|keystore|jks))$/i;
const PRIVATE_OK = /^\.env\.(?:example|sample|template|dist)$/i;
export const privateName = (name: string) => PRIVATE.test(name) && !PRIVATE_OK.test(name);

/** 依赖清单：有它们（或有脚本）就说「依赖尚未验证」 */
const DEP_FILES = /^(?:requirements[^/]*\.txt|package\.json|pyproject\.toml|Pipfile|Gemfile|go\.mod|Cargo\.toml|environment\.ya?ml)$/i;

/** 发现时最多看多少个目录、多深（根 → 分类 → 子分类 → 技能） */
const SCAN_MAX_DIRS = 4000;
const SCAN_MAX_DEPTH = 4;

// ———————————————————— 一项技能为什么不能导入 ————————————————————

export type ItemProblem =
  | "not_utf8" | "no_definition" | "bad_frontmatter" | "bad_name" | "no_name" | "no_description" | "long_description" | "empty_body"
  | "reserved_name" | "policy" | "platform_var" | "outside_ref" | "missing_resource" | "private_file"
  | "too_large" | "too_many_files" | "large_definition" | "unsafe_path" | "special_file" | "link_outside" | "link_broken" | "link_dir"
  | "unreadable" | "changed" | "gone";

export class ItemError extends Error {
  constructor(readonly problem: ItemProblem, readonly detail = "") {
    super(problem);
  }
}

// ———————————————————— 位置 ————————————————————

const inside = (p: string, root: string) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
async function real(p: string): Promise<string | undefined> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return undefined;
  }
}
const errCode = (e: unknown) => (e as NodeJS.ErrnoException)?.code ?? "";
const denied = (e: unknown) => ["EACCES", "EPERM"].includes(errCode(e));
const tick = () => new Promise<void>((r) => setImmediate(r));

// ———————————————————— 读一项技能（R4 的边界） ————————————————————

export interface ReadResult {
  files: BundleFile[];
  /** 没算进内容的（.git、__MACOSX、.DS_Store、._ 资源分支） */
  ignored: string[];
}

/** 读一个文件最多 cap 字节（文件在读的时候变大也不多读） */
async function readBounded(file: string, cap: number): Promise<Buffer> {
  // 不跟链接、不在管道上卡住；打开之后再确认是普通文件（检查和打开之间被换掉的不读）
  const fh = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    if (!(await fh.stat()).isFile()) throw new ItemError("special_file");
    const chunks: Buffer[] = [];
    let total = 0;
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > cap) throw new ItemError("too_large");
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks);
  } finally {
    await fh.close();
  }
}

/**
 * 读一项技能的完整目录（dir 是真实路径）。只收普通文件；目录里的链接只认指向这一项里面的普通文件，
 * 指到外面、断开、指向目录（可能成环）的整项不读。疑似私人文件按名字先拦，不读内容。
 */
export async function readSkillDir(dir: string, signal?: { canceled: boolean }): Promise<ReadResult> {
  const files: BundleFile[] = [];
  const ignored: string[] = [];
  const seen = new Map<string, boolean>();
  const privates: string[] = [];
  let entries = 0;
  let total = 0;
  const stack = [""];
  while (stack.length) {
    if (signal?.canceled) throw new ItemError("changed");
    const rel = stack.pop()!;
    let list: fs.Dirent[];
    try {
      list = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true });
    } catch (e) {
      throw new ItemError(denied(e) ? "unreadable" : errCode(e) === "ENOENT" ? "gone" : "unreadable");
    }
    list.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of list) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (IGNORED(e.name)) {
        ignored.push(p);
        continue;
      }
      if (++entries > SKILL_LIMITS.files) throw new ItemError("too_many_files");
      if (privateName(e.name)) {
        privates.push(p);
        continue;
      }
      if (!skillPath(p)) throw new ItemError("unsafe_path", p);
      const key = p.normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new ItemError("unsafe_path", p);
      seen.set(key, true);
      const abs = path.join(dir, p);
      let st: fs.Stats;
      try {
        st = await fs.promises.lstat(abs);
      } catch (err) {
        throw new ItemError(denied(err) ? "unreadable" : "gone", p);
      }
      if (st.isDirectory()) {
        stack.push(p);
        continue;
      }
      let target = abs;
      if (st.isSymbolicLink()) {
        const to = await real(abs);
        if (!to) throw new ItemError("link_broken", p);
        if (!inside(to, dir)) throw new ItemError("link_outside", p);
        try {
          st = await fs.promises.stat(to);
        } catch {
          throw new ItemError("link_broken", p);
        }
        if (st.isDirectory()) throw new ItemError("link_dir", p);
        target = to;
      }
      if (!st.isFile()) throw new ItemError("special_file", p);
      const cap = SKILL_LIMITS.unpacked - total;
      if (st.size > cap) throw new ItemError("too_large");
      let data: Buffer;
      try {
        data = await readBounded(target, cap);
      } catch (err) {
        if (err instanceof ItemError) throw err;
        throw new ItemError(denied(err) ? "unreadable" : errCode(err) === "ELOOP" ? "link_broken" : "gone", p);
      }
      total += data.length;
      files.push({ path: p, data });
    }
  }
  if (privates.length) throw new ItemError("private_file", privates.slice(0, 5).join(", "));
  if (!files.some((f) => f.path === "SKILL.md")) throw new ItemError("no_definition");
  return { files, ignored };
}

// ———————————————————— 校验一项技能（R2） ————————————————————

/** 和 DSH 一致的布尔写法（dsh-skill-filesystem frontmatterBoolean） */
function bool(v: unknown): boolean | undefined {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    if (/^(true|yes|on|1)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0)$/i.test(v.trim())) return false;
  }
  return undefined;
}

/** 展示用的字段（不影响怎么用；不认识的普通字段也当展示字段，在「查看」里列出来） */
const DISPLAY_FIELDS = new Set(["name", "description", "metadata", "license", "version", "author", "authors", "compatibility", "tags", "keywords", "homepage", "repository", "title", "argument-hint", "when_to_use", "whenToUse", "when-to-use", "icon", "category", "categories", "language", "created", "updated", "display_name", "short_description"]);
/** 运行环境没法等价保持的策略、hooks、权限、运行方式：不导入（不当成展示字段忽略） */
const POLICY_FIELDS = new Set(["hooks", "allowed-tools", "allowed_tools", "allowedTools", "disallowed-tools", "disallowed_tools", "disallowedTools", "tools", "context", "agent", "model", "effort", "permissions", "permission-mode", "permissionMode", "sandbox", "paths", "shell", "disableModelInvocation", "modelInvocable", "userInvocable"]);
/** 名字像限制的未知字段：也不当展示字段 */
const RESTRICTIVE = /allow|deny|disallow|disable|enable|permi|polic|restrict|invoc|hook|sandbox|approv|trust|tool|only|exclusive|require|scope|access|auth|implicit/i;
/** 平台路径变量：不替换，用到的不导入 */
const PLATFORM_VAR = /\$\{?((?:CLAUDE|CODEX|CURSOR|CODEBUDDY|WORKBUDDY|QWEN|DOUBAO)_[A-Z0-9_]+)\}?/;

function parseYaml(text: string): Record<string, unknown> | undefined {
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length || doc.warnings.length) return undefined;
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    return undefined;
  }
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) return undefined;
  return data as Record<string, unknown>;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface Inspected {
  name: string;
  title: string;
  description: string;
  example?: string;
  /** 补全的字段（名称、描述、禁止自动调用），确认导入时一并接受 */
  completed: Array<{ field: string; value: string }>;
  /** 保留下来的调用限制（不让模型自己用、不让用户用 / 调用） */
  restrictions: string[];
  /** 没用上的展示字段 */
  unused: string[];
  scripts: number;
  depsUnverified: boolean;
  /** 最终写进库里的副本（去掉 BOM、写进补全值） */
  files: BundleFile[];
  digest: string;
}

/** 按 SKILL.md 写的或补全的值检查一份副本（补全后也要过同一套检查） */
function checkDefinition(text: string): { data: Record<string, unknown>; body: string } {
  const m = FRONT.exec(text);
  if (!m) throw new ItemError("bad_frontmatter");
  const data = parseYaml(m[1]);
  if (!data) throw new ItemError("bad_frontmatter");
  const body = text.slice(m[0].length);
  if (!skillName(data.name)) throw new ItemError("bad_name");
  if (typeof data.description !== "string" || !data.description.trim()) throw new ItemError("no_description");
  if (data.description.length > 1024) throw new ItemError("long_description");
  if (!body.trim()) throw new ItemError("empty_body");
  return { data, body };
}

/** 一项技能读出来的文件 → 能不能导入、导入成什么样。dirName 是它的目录名（补全名称、默认标题） */
export function inspectSkill(files: BundleFile[], dirName: string): Inspected {
  const def = files.find((f) => f.path === "SKILL.md");
  if (!def) throw new ItemError("no_definition");
  if (def.data.length > SKILL_LIMITS.markdown) throw new ItemError("large_definition");
  let raw: string;
  try {
    // ignoreBOM：保留开头的 BOM 再自己去掉（默认会悄悄吞掉，副本就会原样带着 BOM）
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(def.data);
  } catch {
    throw new ItemError("not_utf8");
  }
  const text = raw.replace(/^﻿/, "");
  const m = FRONT.exec(text);
  const hasFront = !!m;
  const data = m ? parseYaml(m[1]) : {};
  if (!data) throw new ItemError("bad_frontmatter");
  const body = m ? text.slice(m[0].length) : text;
  if (!body.trim()) throw new ItemError("empty_body");
  if (!hasFront && /^\s*---\s*$/m.test(text.split(/\r?\n/, 1)[0] ?? "")) throw new ItemError("bad_frontmatter");

  const completed: Array<{ field: string; value: string }> = [];
  const restrictions: string[] = [];
  const unused: string[] = [];
  let depsUnverified = false;

  // 调用名：写了就必须合规（不改调用名）；没写时只在目录名本身就是合规名字（大小写除外）时补全
  let name: string;
  if (data.name === undefined || data.name === null || data.name === "") {
    const n = dirName.toLowerCase();
    if (!skillName(n)) throw new ItemError("no_name");
    name = n;
    completed.push({ field: "name", value: n });
  } else if (!skillName(data.name)) throw new ItemError("bad_name", String(data.name).slice(0, 80));
  else name = data.name;
  if (reservedSkill(name) || (NEW_RESERVED_SKILLS as readonly string[]).includes(name)) throw new ItemError("reserved_name", name);

  // 描述：写了就要非空、不超过 1024；没写时取正文第一个标题
  let description: string;
  if (data.description === undefined || data.description === null || (typeof data.description === "string" && !data.description.trim())) {
    const h = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1]?.trim();
    if (!h || h.length > 1024) throw new ItemError("no_description");
    description = h;
    completed.push({ field: "description", value: h });
  } else if (typeof data.description !== "string") throw new ItemError("no_description");
  else if (data.description.length > 1024) throw new ItemError("long_description");
  else description = data.description.trim();

  // 调用限制：DSH 认的两个照原样保留；allow_implicit_invocation: false 等价于禁止自动调用（写进副本）；
  // 没法等价保持的策略、hooks、权限字段，以及名字像限制的未知字段，整项不导入
  let implicit: boolean | undefined;
  const policyOf = (v: unknown, where: string) => {
    if (v === undefined) return;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new ItemError("policy", where);
    for (const [k, x] of Object.entries(v)) {
      if (k !== "allow_implicit_invocation") throw new ItemError("policy", `${where}.${k}`);
      const b = bool(x);
      if (b === undefined) throw new ItemError("policy", `${where}.${k}`);
      implicit = implicit === false ? false : b;
    }
  };
  for (const [k, v] of Object.entries(data)) {
    if (k === "disable-model-invocation" || k === "user-invocable") {
      if (bool(v) === undefined) throw new ItemError("policy", k);
      if ((k === "disable-model-invocation" && bool(v)) || (k === "user-invocable" && !bool(v))) restrictions.push(k);
      continue;
    }
    if (k === "allow_implicit_invocation") {
      const b = bool(v);
      if (b === undefined) throw new ItemError("policy", k);
      implicit = implicit === false ? false : b;
      continue;
    }
    if (k === "policy") {
      policyOf(v, "policy");
      continue;
    }
    if (POLICY_FIELDS.has(k)) throw new ItemError("policy", k);
    if (k === "compatibility" && v) depsUnverified = true;
    if (DISPLAY_FIELDS.has(k)) continue;
    if (RESTRICTIVE.test(k)) throw new ItemError("policy", k);
    unused.push(k);
  }
  // Codex 的 agents/openai.yaml：policy 里的 allow_implicit_invocation 同样保留；声明了依赖的说「依赖尚未验证」
  const agentYaml = files.find((f) => f.path === "agents/openai.yaml" || f.path === "agents/openai.yml");
  if (agentYaml) {
    let y: Record<string, unknown> | undefined;
    try {
      y = parseYaml(new TextDecoder("utf-8", { fatal: true }).decode(agentYaml.data));
    } catch {
      y = undefined;
    }
    if (!y) throw new ItemError("policy", agentYaml.path);
    policyOf(y.policy, `${agentYaml.path} policy`);
    if (y.dependencies) depsUnverified = true;
  }
  if (implicit === false && !restrictions.includes("disable-model-invocation")) {
    if (data["disable-model-invocation"] !== undefined) throw new ItemError("policy", "allow_implicit_invocation");
    completed.push({ field: "disable-model-invocation", value: "true" });
    restrictions.push("disable-model-invocation");
  }

  // 平台路径变量、根外和缺失的资源
  const v = PLATFORM_VAR.exec(text);
  if (v) throw new ItemError("platform_var", v[1]);
  const have = new Set(files.map((f) => f.path));
  const dirs = new Set(files.flatMap((f) => f.path.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
  for (const link of body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    let ref = link[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) continue;
    ref = ref.replace(/[?#].*$/, "");
    try {
      ref = decodeURI(ref);
    } catch {
      /* 保留原样 */
    }
    if (!ref) continue;
    if (path.isAbsolute(ref) || /^[a-zA-Z]:[\\/]/.test(ref) || ref.startsWith("~")) throw new ItemError("outside_ref", ref);
    const n = path.posix.normalize(ref.replace(/^\.\//, "")).replace(/\/$/, "");
    if (n === ".." || n.startsWith("../")) throw new ItemError("outside_ref", ref);
    if (n && n !== "." && !have.has(n) && !dirs.has(n)) throw new ItemError("missing_resource", ref);
  }

  const scripts = files.filter((f) => SCRIPT_FILE.test(f.path)).length;
  if (scripts || files.some((f) => DEP_FILES.test(f.path.split("/").pop() ?? ""))) depsUnverified = true;

  // 副本：去掉 BOM；补全的字段写进 frontmatter 开头（JSON 字符串是合法的 YAML 双引号标量）
  let out = text;
  if (completed.length) {
    const lines = completed.map((c) => `${c.field}: ${c.field === "disable-model-invocation" ? "true" : JSON.stringify(c.value)}`).join("\n");
    out = hasFront ? text.replace(/^---\r?\n/, (s) => `${s}${lines}\n`) : `---\n${lines}\n---\n${text}`;
  }
  const final = checkDefinition(out);
  if (final.data.name !== name) throw new ItemError("bad_name");
  const outFiles = files.map((f) => (f.path === "SKILL.md" ? { path: f.path, data: out === raw ? f.data : Buffer.from(out, "utf8") } : f));
  if (outFiles.find((f) => f.path === "SKILL.md")!.data.length > SKILL_LIMITS.markdown) throw new ItemError("large_definition");

  const meta = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? (data.metadata as Record<string, unknown>) : {};
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 200) : undefined);
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1];
  const title = str(meta.title) ?? str(data.title) ?? str(heading) ?? dirName;
  const example = str(meta.example);
  return { name, title, description, ...(example ? { example } : {}), completed, restrictions, unused, scripts, depsUnverified, files: outFiles, digest: contentDigest(outFiles) };
}

// ———————————————————— 会话：发现、预览、导入 ————————————————————

export type RootStatus = "found" | "missing" | "denied" | "partial" | "error";
export interface RootView {
  id: string;
  kind: "auto" | "manual" | "project";
  location: string;
  /** 根本身是链接时：真实位置（给人看） */
  real?: string;
  status: RootStatus;
  count: number;
}
export interface Candidate {
  key: string;
  root: string;
  name: string;
  location: string;
  /** 发现时就知道不能读的（链接指到根外、断开） */
  blocked?: { problem: ItemProblem; detail?: string };
}
interface CandidateInternal extends Candidate {
  dir: string;
}

export type PreviewStatus = "ok" | "exists" | "conflict" | "incompatible";
export interface PreviewItem {
  key: string;
  sources: Array<{ key: string; location: string; root: string }>;
  status: PreviewStatus;
  problem?: { code: ItemProblem; detail?: string };
  name?: string;
  title?: string;
  description?: string;
  files?: number;
  bytes?: number;
  scripts?: number;
  depsUnverified?: boolean;
  completed?: Array<{ field: string; value: string }>;
  restrictions?: string[];
  unused?: string[];
  paths?: string[];
  ignored?: string[];
  digest?: string;
  /** 已存在的那一个（同内容） */
  existing?: { id: string; title: string; many: boolean };
  /** 同名不同内容的那一个（库里的或同一批前面的） */
  conflict?: { id?: string; title: string };
  /** 选「另存一份」时的展示名 */
  copyTitle?: string;
}

export type ImportItemState = "added" | "skipped" | "failed" | "pending" | "stopped";
export interface ImportItemResult {
  key: string;
  title: string;
  state: ImportItemState;
  entryId?: string;
  /** 开启的结果：on 已开启 · failed 开启失败（error 是原因） */
  enable?: "on" | "failed";
  enableError?: string;
  error?: { code: string; detail?: string };
  /** 跳过的原因：incompatible 不兼容（error 是原因）· exists 已存在 · conflict 同名不同内容选了跳过 · unselected 没选 */
  why?: "incompatible" | "exists" | "conflict" | "unselected";
}
export interface ImportRecord {
  id: string;
  state: "running" | "done";
  canceled?: boolean;
  bot?: string;
  botName?: string;
  at: number;
  items: ImportItemResult[];
}

/** 库里已有的（新条目和旧来源合在一起，UserSkills.libraryView）：按内容摘要和调用名对比 */
export interface LibraryLookup {
  items(): Array<{ id: string; name: string; title: string; contentDigest: string }>;
}

export interface LocalImportOptions {
  store: Store;
  dataDir: string;
  lookup: LibraryLookup;
  /** 写进库：成功返回条目（失败抛错，这一项不发布半包） */
  add: (o: { files: BundleFile[]; name: string; title: string; description: string; example?: string; source: LocalSource; completed: Array<{ field: string; value: string }>; depsUnverified: boolean; copyOf?: string; importId: string; itemKey: string }) => LibraryEntry;
  /** 在机器人上开启（检查同名、容量）；失败抛 SkillError */
  enable: (entryId: string, botId: string) => void;
  /** 库里按导入号和项找已写进去的条目（结果未知时核对） */
  findImported: (importId: string, itemKey: string) => LibraryEntry | undefined;
  botName: (botId: string) => string | undefined;
  /** 系统目录选择器（桌面版）：返回选中的路径，取消返回 undefined */
  picker?: () => ((o?: { purpose?: "skills" }) => Promise<string | undefined>) | undefined;
  home?: string;
  platform?: NodeJS.Platform;
  now?: () => number;
}

interface Session {
  id: string;
  botId?: string;
  at: number;
  state: "scanning" | "done" | "canceled";
  roots: RootView[];
  rootReals: Set<string>;
  candidates: CandidateInternal[];
  dirReals: Set<string>;
  cancel: { canceled: boolean };
  pendingLink?: { path: string; real: string };
  preview?: { id: string; items: PreviewItem[]; botId?: string };
  scan?: Promise<void>;
}

const SESSION_TTL = 30 * 60_000;
const KV = "skill-import:";
const KEEP_RECORDS = 200;

export class LocalImports {
  private sessions = new Map<string, Session>();
  private running = new Map<string, { cancel: boolean }>();
  readonly home: string;
  readonly platform: NodeJS.Platform;

  constructor(private o: LocalImportOptions) {
    this.home = o.home ?? os.homedir();
    this.platform = o.platform ?? process.platform;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }
  /** 给人看的位置：主目录写成 ~，统一用 / */
  display(p: string): string {
    const rel = path.relative(this.home, p);
    const shown = rel === "" ? "~" : !rel.startsWith("..") && !path.isAbsolute(rel) ? `~/${rel}` : p;
    return shown.split(path.sep).join("/");
  }
  get canPick(): boolean {
    return !!this.o.picker?.();
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, s] of this.sessions) if (now - s.at > SESSION_TTL) {
      s.cancel.canceled = true;
      this.sessions.delete(id);
    }
  }
  private session(id: string): Session {
    this.sweep();
    const s = this.sessions.get(id);
    if (!s) throw new SkillError("not_found", 404);
    s.at = this.now();
    return s;
  }

  view(s: Session) {
    return {
      id: s.id,
      state: s.state,
      machine: os.hostname(),
      roots: s.roots,
      candidates: s.candidates.map(({ dir: _dir, ...c }) => c),
      hints: manualHints(this.platform),
      picker: this.canPick,
      ...(s.pendingLink ? { link: { location: this.display(s.pendingLink.path), real: this.display(s.pendingLink.real) } } : {}),
    };
  }

  /** 打开「从本机导入…」：开一个会话，后台枚举六个自动根 */
  start(botId?: string) {
    this.sweep();
    const s: Session = { id: crypto.randomBytes(12).toString("base64url"), ...(botId ? { botId } : {}), at: this.now(), state: "scanning", roots: [], rootReals: new Set(), candidates: [], dirReals: new Set(), cancel: { canceled: false } };
    this.sessions.set(s.id, s);
    s.scan = this.scanAuto(s).catch((e) => log.warn("skill discovery failed", { message: (e as Error).message?.slice(0, 120) })).finally(() => {
      if (s.state === "scanning") s.state = "done";
    });
    return this.view(s);
  }
  get(id: string) {
    return this.view(this.session(id));
  }
  /** 等发现结束（测试和需要一次拿全结果的调用方用） */
  async settled(id: string) {
    await this.session(id).scan;
    return this.get(id);
  }
  /** 取消发现：停在这里，已找到的照样能选；没扫完的根标「未扫描完整」 */
  cancelScan(id: string) {
    const s = this.session(id);
    if (s.state === "scanning") {
      s.cancel.canceled = true;
      s.state = "canceled";
      for (const r of s.roots) if (r.status === "found" && (r as RootView & { scanning?: boolean }).scanning) r.status = "partial";
    }
    return this.view(s);
  }
  close(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.cancel.canceled = true;
    this.sessions.delete(id);
  }

  private async scanAuto(s: Session): Promise<void> {
    for (const r of AUTO_ROOTS) {
      if (s.cancel.canceled) {
        s.roots.push({ id: r.id, kind: "auto", location: `~/${r.rel}`, status: "partial", count: 0 });
        continue;
      }
      await this.addRoot(s, path.join(this.home, ...r.rel.split("/")), r.id, "auto");
    }
  }

  /** 加一个根：不存在、没权限各自说明；同一个真实目录只算一次 */
  private async addRoot(s: Session, p: string, id: string, kind: RootView["kind"], location = this.display(p)): Promise<RootView> {
    const view: RootView & { scanning?: boolean } = { id, kind, location, status: "found", count: 0 };
    s.roots.push(view);
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(p);
    } catch (e) {
      view.status = denied(e) ? "denied" : "missing";
      return view;
    }
    if (!st.isDirectory()) {
      view.status = "missing";
      return view;
    }
    const r = await real(p);
    if (!r) {
      view.status = "missing";
      return view;
    }
    if (r !== path.resolve(p)) view.real = this.display(r);
    if (s.rootReals.has(r)) {
      // 共享目录（另一个根链接到这里）：已经数过，不重复
      view.status = "found";
      return view;
    }
    s.rootReals.add(r);
    view.scanning = true;
    try {
      await this.enumerate(s, r, view, kind === "auto" ? SCAN_MAX_DEPTH : SCAN_MAX_DEPTH - 1);
      if (s.cancel.canceled) view.status = "partial";
    } catch (e) {
      view.status = denied(e) ? "denied" : "error";
    } finally {
      delete view.scanning;
    }
    return view;
  }

  /** 在根里找技能：目录里有 SKILL.md 就是一项（不再往里找）；否则当分类目录往下找。只看目录项和文件名 */
  private async enumerate(s: Session, root: string, view: RootView, maxDepth: number): Promise<void> {
    const visited = new Set<string>([root]);
    const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root, rel: "", depth: 0 }];
    let dirs = 0;
    while (queue.length) {
      if (s.cancel.canceled) return;
      const { dir, rel, depth } = queue.shift()!;
      if (++dirs > SCAN_MAX_DIRS) {
        view.status = "partial";
        return;
      }
      if (dirs % 50 === 0) await tick();
      let list: fs.Dirent[];
      try {
        list = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        if (depth === 0) throw e;
        continue;
      }
      const def = list.find((e) => e.name === "SKILL.md");
      if (def && (def.isFile() || def.isSymbolicLink())) {
        this.addCandidate(s, view, dir, rel, path.basename(dir));
        continue;
      }
      if (depth >= maxDepth) continue;
      // 手选的根和分类目录里：有 .git 的是一个仓库，不往里找（项目只查已知位置）
      if (depth > 0 && view.kind !== "auto" && list.some((e) => e.name === ".git")) continue;
      for (const e of list.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (SKIP_DIR(e.name)) continue;
        const p = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) {
          const to = await real(p);
          if (!to) {
            this.addCandidate(s, view, p, r, e.name, { problem: "link_broken" });
            continue;
          }
          if (!inside(to, root)) {
            this.addCandidate(s, view, p, r, e.name, { problem: "link_outside", detail: this.display(to) });
            continue;
          }
          let st: fs.Stats | undefined;
          try {
            st = await fs.promises.stat(to);
          } catch {
            st = undefined;
          }
          if (!st?.isDirectory() || visited.has(to)) continue;
          visited.add(to);
          queue.push({ dir: to, rel: r, depth: depth + 1 });
        } else if (e.isDirectory()) {
          if (visited.has(p)) continue;
          visited.add(p);
          queue.push({ dir: p, rel: r, depth: depth + 1 });
        }
      }
    }
  }

  private addCandidate(s: Session, view: RootView, dir: string, rel: string, name: string, blocked?: Candidate["blocked"]): void {
    const key = blocked ? `x:${dir}` : dir;
    if (s.dirReals.has(key)) return;
    s.dirReals.add(key);
    view.count++;
    s.candidates.push({ key: crypto.randomBytes(9).toString("base64url"), root: view.id, name, location: rel ? `${view.location.replace(/\/$/, "")}/${rel}` : view.location, dir, ...(blocked ? { blocked } : {}) });
  }

  // ———————————————— 选择文件夹… ————————————————

  /** 不递归的位置：主目录、磁盘根、应用数据总根、本应用的数据目录（和它的上层） */
  private tooBroad(r: string): boolean {
    const home = path.resolve(this.home);
    const same = (a: string, b: string) => (this.platform === "linux" ? a === b : a.toLowerCase() === b.toLowerCase());
    if (path.parse(r).root === r || same(r, home)) return true;
    const data = path.resolve(this.o.dataDir);
    if (inside(r, data) || inside(data, r)) return true;
    const env = (k: string) => process.env[k];
    const appRoots = [
      path.join(home, "Library"),
      path.join(home, "Library", "Application Support"),
      path.join(home, ".config"),
      path.join(home, ".local"),
      path.join(home, ".local", "share"),
      path.join(home, "AppData"),
      env("APPDATA") ?? "",
      env("LOCALAPPDATA") ?? "",
      env("APPDATA") ? path.dirname(env("APPDATA")!) : "",
      env("PROGRAMDATA") ?? "",
      path.join(home, "Library", "Application Support", "DoubaoWork"),
      env("LOCALAPPDATA") ? path.join(env("LOCALAPPDATA")!, "DoubaoWork") : "",
      env("LOCALAPPDATA") ? path.join(env("LOCALAPPDATA")!, "DoubaoWork", "User Data") : "",
      env("APPDATA") ? path.join(env("APPDATA")!, "DoubaoWork") : "",
    ].filter(Boolean);
    return appRoots.some((a) => same(path.resolve(a), r));
  }

  /**
   * 「选择文件夹…」：弹系统选择器。取消时原选择不变；选到链接先返回真实位置等确认；
   * 太大的范围（主目录、磁盘根、应用数据总根）不读，提示选具体位置。
   */
  async pick(id: string): Promise<{ status: "picked" | "canceled" | "confirm" | "too_broad" | "missing" | "duplicate"; added?: number } & ReturnType<LocalImports["view"]>> {
    const s = this.session(id);
    const pick = this.o.picker?.();
    if (!pick) throw new SkillError("desktop_only", 400);
    const chosen = await pick({ purpose: "skills" });
    if (!chosen) return { status: "canceled", ...this.view(s) };
    if (!path.isAbsolute(chosen) || chosen.includes("\0")) return { status: "missing", ...this.view(s) };
    let lst: fs.Stats;
    try {
      lst = await fs.promises.lstat(chosen);
    } catch {
      return { status: "missing", ...this.view(s) };
    }
    if (lst.isSymbolicLink()) {
      const r = await real(chosen);
      if (!r) return { status: "missing", ...this.view(s) };
      s.pendingLink = { path: chosen, real: r };
      return { status: "confirm", ...this.view(s) };
    }
    s.pendingLink = undefined;
    return this.addManual(s, chosen);
  }

  /** 选到的是链接：用户确认按真实位置读（只读真实位置里面），或者不读 */
  async confirmLink(id: string, ok: boolean) {
    const s = this.session(id);
    const link = s.pendingLink;
    s.pendingLink = undefined;
    if (!link || !ok) return { status: "canceled" as const, ...this.view(s) };
    // 确认之后真实位置又变了：不读
    if ((await real(link.path)) !== link.real) return { status: "missing" as const, ...this.view(s) };
    return this.addManual(s, link.real, this.display(link.path));
  }

  private async addManual(s: Session, chosen: string, shown?: string) {
    const r = await real(chosen);
    if (!r) return { status: "missing" as const, ...this.view(s) };
    if (this.tooBroad(r)) return { status: "too_broad" as const, ...this.view(s) };
    let list: fs.Dirent[];
    try {
      list = await fs.promises.readdir(r, { withFileTypes: true });
    } catch (e) {
      s.roots.push({ id: "M01", kind: "manual", location: shown ?? this.display(r), status: denied(e) ? "denied" : "missing", count: 0 });
      return { status: "picked" as const, added: 0, ...this.view(s) };
    }
    const before = s.candidates.length;
    if (s.rootReals.has(r)) return { status: "duplicate" as const, ...this.view(s) };
    const names = new Set(list.map((e) => e.name));
    const project = PROJECT_ROOTS.filter((p) => names.has(p.rel.split("/")[0]));
    if (names.has("SKILL.md")) {
      // 一个技能文件夹
      s.rootReals.add(r);
      const view: RootView = { id: "M01", kind: "manual", location: shown ?? this.display(r), status: "found", count: 0 };
      s.roots.push(view);
      this.addCandidate(s, view, r, "", path.basename(r));
    } else if (project.length || names.has(".git")) {
      // 一个项目：只看表里的已知相对位置，不往别处找
      s.rootReals.add(r);
      for (const p of project) await this.addRoot(s, path.join(r, ...p.rel.split("/")), `P${p.id.slice(1)}`, "project", `${shown ?? this.display(r)}/${p.rel}`);
      if (!project.length) s.roots.push({ id: "P00", kind: "project", location: shown ?? this.display(r), status: "missing", count: 0 });
    } else {
      // 装着多个技能的根（允许分类子目录）
      await this.addRoot(s, r, "M01", "manual", shown ?? this.display(r));
    }
    return { status: "picked" as const, added: s.candidates.length - before, ...this.view(s) };
  }

  // ———————————————— 预览（R2） ————————————————

  /** 「下一步」：只读所选的这几项，逐项校验，同内容的合成一项，和库里比 */
  async preview(id: string, keys: string[], botId?: string) {
    const s = this.session(id);
    const picked = s.candidates.filter((c) => keys.includes(c.key));
    const items: PreviewItem[] = [];
    const byDigest = new Map<string, PreviewItem>();
    for (const c of picked) {
      const source = { key: c.key, location: c.location, root: c.root };
      if (c.blocked) {
        items.push({ key: c.key, sources: [source], status: "incompatible", problem: { code: c.blocked.problem, ...(c.blocked.detail ? { detail: c.blocked.detail } : {}) }, title: c.name });
        continue;
      }
      try {
        const read = await readSkillDir(c.dir);
        const ins = inspectSkill(read.files, c.name);
        const same = byDigest.get(ins.digest);
        if (same) {
          same.sources.push(source);
          continue;
        }
        const item: PreviewItem = {
          key: c.key,
          sources: [source],
          status: "ok",
          name: ins.name,
          title: ins.title,
          description: ins.description,
          files: ins.files.length,
          bytes: ins.files.reduce((n, f) => n + f.data.length, 0),
          scripts: ins.scripts,
          depsUnverified: ins.depsUnverified,
          completed: ins.completed,
          restrictions: ins.restrictions,
          unused: ins.unused,
          paths: ins.files.map((f) => f.path).sort(),
          ignored: read.ignored,
          digest: ins.digest,
        };
        byDigest.set(ins.digest, item);
        items.push(item);
      } catch (e) {
        if (!(e instanceof ItemError)) {
          log.warn("reading a local skill failed", { message: (e as Error).message?.slice(0, 120) });
          items.push({ key: c.key, sources: [source], status: "incompatible", problem: { code: "unreadable" }, title: c.name });
          continue;
        }
        items.push({ key: c.key, sources: [source], status: "incompatible", problem: { code: e.problem, ...(e.detail ? { detail: e.detail } : {}) }, title: c.name });
      }
    }
    this.classify(items);
    s.preview = { id: crypto.randomBytes(9).toString("base64url"), items, ...(botId ? { botId } : {}) };
    return { preview: s.preview.id, items, ...(botId ? { bot: { id: botId, name: this.o.botName(botId) ?? "" } } : {}) };
  }

  /** 和库里、和同一批前面的比：已存在 / 同名不同内容 / 可导入；另存的展示名先算好 */
  private classify(items: PreviewItem[]): void {
    const lib = this.o.lookup.items();
    const titles = new Set(lib.map((x) => x.title));
    const batch = new Map<string, PreviewItem>();
    for (const it of items) {
      if (it.status === "incompatible" || !it.digest || !it.name) continue;
      delete it.existing;
      delete it.conflict;
      delete it.copyTitle;
      const same = lib.filter((x) => x.contentDigest === it.digest);
      if (same.length) {
        it.status = "exists";
        it.existing = { id: same[0].id, title: same[0].title, many: same.length > 1 };
        continue;
      }
      const named = lib.find((x) => x.name === it.name);
      const earlier = batch.get(it.name);
      if (named || earlier) {
        it.status = "conflict";
        it.conflict = named ? { id: named.id, title: named.title } : { title: earlier!.title ?? it.name };
        let n = 2;
        const base = it.title ?? it.name;
        while (titles.has(`${base} (${n})`)) n++;
        it.copyTitle = `${base} (${n})`;
        titles.add(it.copyTitle);
      } else {
        it.status = "ok";
        batch.set(it.name, it);
      }
      titles.add(it.title ?? it.name);
    }
  }

  // ———————————————— 导入（R2 最后一步、R3 结果、R4 异常） ————————————————

  private records(): ImportRecord[] {
    return this.o.store
      .listKV(KV)
      .map(([, v]) => {
        try {
          return JSON.parse(v) as ImportRecord;
        } catch {
          return undefined;
        }
      })
      .filter((r): r is ImportRecord => !!r);
  }
  private saveRecord(r: ImportRecord): void {
    this.o.store.setKV(KV + r.id, JSON.stringify(r));
  }

  /** 查一次导入的结果：上次没跑完（应用退出、崩溃）的按库里实际写进去的核对，没写进去的记为已停止 */
  record(requestId: string): ImportRecord | undefined {
    const raw = this.o.store.getKV(KV + requestId);
    if (!raw) return undefined;
    let r: ImportRecord;
    try {
      r = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (r.state === "running" && !this.running.has(r.id)) {
      r = {
        ...r,
        state: "done",
        items: r.items.map((it) => {
          if (it.state !== "pending") return it;
          const entry = this.o.findImported(r.id, it.key);
          return entry ? { ...it, state: "added" as const, entryId: entry.id } : { ...it, state: "stopped" as const };
        }),
      };
      this.saveRecord(r);
    }
    return r;
  }

  /** 停下还没开始的项（已经写进去的保留，正在写的那一项写完再停） */
  cancelImport(requestId: string): ImportRecord | undefined {
    const run = this.running.get(requestId);
    if (run) run.cancel = true;
    return this.record(requestId);
  }

  /**
   * 确认导入。requestId 由界面生成：同一个号再提交一次（没收到结果后重试）返回原结果，不重复入库。
   * items：要导入的项和动作（import 导入 · copy 另存一份）；没列出的、跳过的不导入。botId：导入后在这个机器人上开启
   */
  async commit(id: string, o: { requestId: string; previewId: string; items: Array<{ key: string; action: "import" | "copy" }>; botId?: string; retry?: boolean }): Promise<ImportRecord> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(o.requestId)) throw new SkillError("invalid_skill");
    const prior = this.record(o.requestId);
    if (prior) return prior;
    const s = this.session(id);
    if (!s.preview || s.preview.id !== o.previewId) throw new SkillError("changed", 409);
    const preview = s.preview.items;
    const botId = o.botId || undefined;
    const record: ImportRecord = {
      id: o.requestId,
      state: "running",
      ...(botId ? { bot: botId, botName: this.o.botName(botId) ?? "" } : {}),
      at: this.now(),
      // 重试失败项：结果里只列这次重新提交的；第一次提交列出全部（不兼容、已存在的也带着原因）
      items: (o.retry ? preview.filter((p) => o.items.some((x) => x.key === p.key)) : preview).map((p) => {
        const want = o.items.find((x) => x.key === p.key);
        const go = want && (p.status === "ok" || (p.status === "conflict" && want.action === "copy"));
        const title = (p.status === "conflict" && want?.action === "copy" ? p.copyTitle : p.title) ?? p.name ?? "";
        if (go) return { key: p.key, title, state: "pending" as const };
        const why = p.status === "incompatible" ? ("incompatible" as const) : p.status === "exists" ? ("exists" as const) : p.status === "conflict" ? ("conflict" as const) : ("unselected" as const);
        return { key: p.key, title, state: "skipped" as const, why, ...(p.problem ? { error: { code: p.problem.code, ...(p.problem.detail ? { detail: p.problem.detail } : {}) } } : {}) };
      }),
    };
    this.saveRecord(record);
    this.prune();
    const run = { cancel: false };
    this.running.set(record.id, run);
    try {
      for (const it of record.items) {
        if (it.state !== "pending") continue;
        if (run.cancel) {
          it.state = "stopped";
          continue;
        }
        const p = preview.find((x) => x.key === it.key)!;
        const copy = p.status === "conflict";
        try {
          const entry = await this.importOne(s, p, copy, record.id);
          it.state = "added";
          it.entryId = entry.id;
        } catch (e) {
          it.state = "failed";
          it.error = e instanceof ItemError ? { code: e.problem, ...(e.detail ? { detail: e.detail } : {}) } : { code: "write_failed" };
          if (!(e instanceof ItemError)) log.warn("writing an imported skill failed", { code: errCode(e) || (e as Error).name });
          this.saveRecord(record);
          continue;
        }
        if (botId) {
          try {
            if (!this.o.botName(botId)) throw new SkillError("not_found", 404);
            this.o.enable(it.entryId!, botId);
            it.enable = "on";
          } catch (e) {
            it.enable = "failed";
            it.enableError = e instanceof SkillError ? e.code : "enable_failed";
          }
        }
        this.saveRecord(record);
      }
    } finally {
      this.running.delete(record.id);
      record.state = "done";
      if (run.cancel) record.canceled = true;
      this.saveRecord(record);
    }
    return record;
  }

  /** 一项：重新读来源核对摘要和库里的状态，没变才写进库 */
  private async importOne(s: Session, p: PreviewItem, copy: boolean, importId: string): Promise<LibraryEntry> {
    const c = s.candidates.find((x) => x.key === p.sources[0].key);
    if (!c) throw new ItemError("changed");
    let ins: Inspected;
    try {
      const read = await readSkillDir(c.dir);
      ins = inspectSkill(read.files, c.name);
    } catch (e) {
      if (e instanceof ItemError && (e.problem === "gone" || e.problem === "no_definition")) throw new ItemError("gone");
      throw new ItemError("changed");
    }
    if (ins.digest !== p.digest) throw new ItemError("changed");
    // 库里的状态也要和预览时一样（期间别处新增了同名或同内容的，就回到预览）
    const again: PreviewItem = { ...p, status: "ok" };
    this.classify([again]);
    if (again.status !== p.status) throw new ItemError("changed");
    const already = this.o.findImported(importId, p.key);
    if (already) return already;
    const source: LocalSource = { type: "local", root: c.root, location: c.location, installedAt: this.now() };
    return this.o.add({
      files: ins.files,
      name: ins.name,
      title: copy ? p.copyTitle ?? ins.title : ins.title,
      description: ins.description,
      ...(ins.example ? { example: ins.example } : {}),
      source,
      completed: ins.completed,
      depsUnverified: ins.depsUnverified,
      ...(copy && p.conflict?.id ? { copyOf: p.conflict.id } : {}),
      importId,
      itemKey: p.key,
    });
  }

  private prune(): void {
    const all = this.records().sort((a, b) => b.at - a.at);
    for (const r of all.slice(KEEP_RECORDS)) this.o.store.deleteKV(KV + r.id);
  }
}
