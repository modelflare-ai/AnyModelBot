/** 本地 ZIP 技能包。先验证并读完，确认安装时才写入文件系统。 */
import crypto from "node:crypto";
import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { parse } from "yaml";
import type { BundleFile } from "../botkit/bundle.js";
import { safeRelPath } from "../domain/paths.js";

/** 宿主自己生成的技能（生图、电脑操作、目录 Bot 界面），用户的技能和 Bot 包都不能占用这些名字 */
export const RESERVED_SKILLS = ["media", "computer-use", "amb-app"] as const;

/** zip：ZIP 的大小；按 GitHub 链接安装时没有打包这一步，同一个上限用在下载总量上 */
export const SKILL_LIMITS = { zip: 20 * 1024 * 1024, unpacked: 64 * 1024 * 1024, files: 2000, markdown: 256 * 1024, installed: 100 };
export type SkillErrorCode =
  | "invalid_zip" | "too_large" | "unsafe_path" | "missing_skill" | "multiple_skills" | "invalid_skill" | "reserved_name" | "conflict" | "not_found" | "too_many"
  // 按 GitHub 链接安装（skills/github.ts）
  | "invalid_link" | "repo_not_found" | "network" | "rate_limited"
  // 「我的技能」（skills/mine.ts）：名字被它占用、已满 100 个
  | "mine_name" | "mine_full"
  // 我的技能库（skills/library.ts、skills/local-import.ts）：只在桌面版查找、预览后变了、这个机器人已开着同名的、容量满了、还在用不能移除、不能轻量移除
  | "desktop_only" | "changed" | "name_on" | "bot_full" | "in_use" | "not_removable";
/** detail：多个技能时的个数 n、限流解除的时间 resetAt（毫秒）、被占用的技能名 name、占用它的「我的技能」的标题 title */
export class SkillError extends Error {
  constructor(readonly code: SkillErrorCode, readonly status = 400, readonly detail: { n?: number; resetAt?: number; name?: string; title?: string } = {}) { super(code); }
}

/** Finder 添加的资源分支不属于技能内容（ZIP 和 GitHub 都跳过） */
export const ignoredSkillPath = (name: string) => name.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"));
/** 装好后会作为程序运行的文件：安装确认里提示有几个；写入时给可执行权限 */
export const SCRIPT_FILE = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|bat|cmd|rb|pl|php)$/i;

// Windows 的设备名、ADS、末尾点/空格也拒绝，保证同一个包在三个平台上有相同含义。
export function skillPath(p: string): boolean {
  return safeRelPath(p) && p.split("/").every((s) => !/[<>:"|?*\x00-\x1f]/.test(s) && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
}
export const skillName = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 64 && skillPath(s);
export const reservedSkill = (name: string) => (RESERVED_SKILLS as readonly string[]).includes(name);
/** 新装的技能还不能叫这些名字：/skill 是「存成技能」的命令。已经装上的照常能用（部署时不查这一条） */
export const NEW_RESERVED_SKILLS = ["skill"] as const;

export interface SkillPackage {
  name: string;
  description: string;
  digest: string;
  bytes: number;
  files: BundleFile[];
  instructions: string;
  /** frontmatter metadata 里的标题和「试试这样说」（导出的「我的技能」带着，别的技能一般没有） */
  title?: string;
  example?: string;
}

export async function readSkillZip(buffer: Buffer): Promise<SkillPackage> {
  if (buffer.length > SKILL_LIMITS.zip) throw new SkillError("too_large", 413);
  const files: BundleFile[] = [];
  const seen = new Map<string, boolean>();
  let total = 0;
  try {
    const zip = await fromBufferPromise(buffer, { strictFileNames: true });
    try {
      if (zip.entryCount > SKILL_LIMITS.files) throw new SkillError("too_large", 413);
      for await (const entry of zip.eachEntry()) {
        const dir = entry.fileName.endsWith("/");
        const name = dir ? entry.fileName.slice(0, -1) : entry.fileName;
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (!skillPath(name) || (type && type !== (dir ? 0o040000 : 0o100000))) throw new SkillError("unsafe_path");
        const key = name.normalize("NFC").toLowerCase();
        if (seen.has(key)) throw new SkillError("unsafe_path");
        seen.set(key, dir);
        // 包括目录/文件重名以及大小写、Unicode 规范化冲突。
        for (let p = key; p.includes("/");) {
          p = p.slice(0, p.lastIndexOf("/"));
          if (seen.get(p) === false) throw new SkillError("unsafe_path");
        }
        if (!dir && [...seen.keys()].some((p) => p.startsWith(key + "/"))) throw new SkillError("unsafe_path");
        total += entry.uncompressedSize;
        if (total > SKILL_LIMITS.unpacked) throw new SkillError("too_large", 413);
        if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw new SkillError("invalid_zip");
        if (dir) continue;
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > entry.uncompressedSize || size > SKILL_LIMITS.unpacked) throw new SkillError("too_large", 413);
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc32) throw new SkillError("invalid_zip");
        // Finder 添加的资源分支不属于技能内容，但仍受以上解包限制约束。
        if (ignoredSkillPath(name)) continue;
        files.push({ path: name, data });
      }
    } finally { zip.close(); }
  } catch (e) {
    if (e instanceof SkillError) throw e;
    throw new SkillError("invalid_zip");
  }
  return packageFiles(files, crypto.createHash("sha256").update(buffer).digest("hex"));
}

/** 文件里的 SKILL.md（任意层级）；恰好一个才能装 */
export const skillRoots = (paths: string[]) => paths.filter((p) => p === "SKILL.md" || p.endsWith("/SKILL.md"));

/**
 * 读出来的文件 → 技能包：ZIP 导入和按 GitHub 链接安装共用，同一个技能在两边成功或失败的原因一致。
 * 路径安全和大小由调用方先查过（ZIP 边解包边查，GitHub 按目录树查）。
 */
export function packageFiles(files: BundleFile[], digest: string): SkillPackage {
  const roots = skillRoots(files.map((f) => f.path));
  if (!roots.length) throw new SkillError("missing_skill");
  if (roots.length !== 1) throw new SkillError("multiple_skills", 400, { n: roots.length });
  const root = files.find((f) => f.path === roots[0])!;
  if (root.data.length > SKILL_LIMITS.markdown) throw new SkillError("too_large", 413);
  const instructions = root.data.toString("utf8").replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(instructions);
  if (!match) throw new SkillError("invalid_skill");
  let metadata: any;
  try { metadata = parse(match[1], { maxAliasCount: 0 }); } catch { throw new SkillError("invalid_skill"); }
  if (!skillName(metadata?.name) || typeof metadata?.description !== "string" || !metadata.description.trim() || metadata.description.length > 1024 || !instructions.slice(match[0].length).trim()) throw new SkillError("invalid_skill");
  // 与当前 DSH 的调用策略解析保持一致，避免导入成功后被运行时悄悄忽略。
  if (["disableModelInvocation", "modelInvocable", "userInvocable"].some((key) => Object.hasOwn(metadata, key))) throw new SkillError("invalid_skill");
  for (const key of ["disable-model-invocation", "user-invocable"]) {
    if (Object.hasOwn(metadata, key) && ![true, false, 0, 1].includes(metadata[key]) && !(typeof metadata[key] === "string" && /^(true|false|yes|no|on|off|0|1)$/i.test(metadata[key]))) throw new SkillError("invalid_skill");
  }
  if (reservedSkill(metadata.name) || (NEW_RESERVED_SKILLS as readonly string[]).includes(metadata.name)) throw new SkillError("reserved_name", 400, { name: metadata.name });
  const meta = metadata.metadata && typeof metadata.metadata === "object" && !Array.isArray(metadata.metadata) ? metadata.metadata : {};
  const metaText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
  const prefix = root.path.slice(0, -"SKILL.md".length);
  const selected = files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  // DSH 的 frontmatter 解析器不接受 BOM；其他内容原样保留。
  selected.find((f) => f.path === "SKILL.md")!.data = Buffer.from(instructions);
  const title = metaText(meta.title);
  const example = metaText(meta.example);
  return { name: metadata.name, description: metadata.description.trim(), digest, bytes: selected.reduce((n, f) => n + f.data.length, 0), files: selected, instructions, ...(title ? { title } : {}), ...(example ? { example } : {}) };
}
