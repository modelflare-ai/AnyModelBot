/**
 * 「我的技能库」的库存（PRD 2026-11-25 从本机快速导入技能）：这台机器、这个运行实例里的一份技能，不同步、不跨机器合库。
 *
 * - <数据目录>/skill-library/index.json：条目（调用名、展示标题、描述、内容摘要、来源）和各机器人的使用关系（uses[botId] = { on }）。
 * - packages/<内容摘要>/：条目的完整内容，只有库里这一份；机器人开着时由 UserSkills.sync 在空闲时拷进 DSH 的 skills/（运行部署副本）。
 * - 每项先在 .stage-* 写完整，再改名进 packages/，最后改 index.json（原子替换）：没写完的不会出现在索引里，也就不会被部署。
 * - 存进来的有两种：从本机导入的新条目（imported，没人用时可「从库移除」）；旧的各机器人技能登记过来的（id 沿用 bot:<机器人>:<名字>，
 *   名字、内容、开关和来源不变）。旧的「我存的」不搬，仍在 skills/mine.ts（见 UserSkills.libraryView 的适配）。
 * - 写入只有应用里的这一个实例；代理宿主里的实例只读（部署时读）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BundleFile } from "../botkit/bundle.js";
import { SCRIPT_FILE, SkillError } from "./archive.js";
import type { SkillSource } from "./service.js";

/** 本机导入的来源：自动根（U01–U06）、项目里的同名位置（P 前缀）、手选的文件夹（M01）。location 是给人看的位置（主目录写成 ~） */
export interface LocalSource {
  type: "local";
  root: string;
  location: string;
  installedAt: number;
}
export type LibrarySource = LocalSource | SkillSource;

export interface LibraryUse {
  on: boolean;
  at: number;
}

export interface LibraryEntry {
  id: string;
  /** 调用名（SKILL.md 的 name，导入时不改） */
  name: string;
  /** 展示标题：原标题或目录名；另存的一份带「(2)」这样的后缀 */
  title: string;
  description: string;
  example?: string;
  /** 内容摘要（完整相对路径 + 文件字节），也是 packages/ 下的目录名 */
  digest: string;
  files: number;
  bytes: number;
  scripts: number;
  source: LibrarySource;
  createdAt: number;
  updatedAt: number;
  uses: Record<string, LibraryUse>;
  /** 导入时补全的字段（只写进库里的副本） */
  completed?: Array<{ field: string; value: string }>;
  /** 依赖没法静态核实（有脚本、声明了依赖） */
  depsUnverified?: boolean;
  /** 从本机导入的新条目（可以轻量「从库移除」）；登记过来的旧条目没有 */
  imported?: boolean;
  /** 另存的一份：和哪个条目同名 */
  copyOf?: string;
  /** 哪一次导入、哪一项写进来的（结果未知时按它核对，不重复入库） */
  importId?: string;
  itemKey?: string;
  /** 从哪个机器人的旧技能登记过来（中断后按它把旧记录收尾） */
  legacy?: { botId: string; digest: string };
}

interface Index {
  revision: string;
  entries: LibraryEntry[];
}

/** 库里文件的内容摘要：按相对路径排序，路径、长度和字节都算进去（改了资源或脚本就是不同内容） */
export function contentDigest(files: ReadonlyArray<BundleFile>): string {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(Buffer.from(f.path, "utf8"));
    h.update(Buffer.from([0]));
    h.update(String(f.data.length));
    h.update(Buffer.from([0]));
    h.update(f.data);
  }
  return h.digest("hex");
}

/** 一个目录里的全部普通文件（部署好的包、旧技能的包都是自己写的，没有链接） */
export function readPackageFiles(dir: string): BundleFile[] {
  const out: BundleFile[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push({ path: p, data: fs.readFileSync(path.join(dir, p)) });
    }
  };
  walk("");
  return out;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export type LibraryEvent = { type: "added" | "updated" | "removed" | "use"; entry: LibraryEntry; botId?: string };

export class SkillLibrary {
  /** 改动之后（应用里那个实例才会写）：空闲的代理进程换新的 */
  onChange: ((e: LibraryEvent) => void) | undefined;
  /** 测试用：写包时出错（磁盘满、没权限） */
  failWrite: ((digest: string) => void) | undefined;

  constructor(private dataDir: string) {}

  get root(): string {
    return path.join(this.dataDir, "skill-library");
  }
  private index(): Index {
    return readJson<Index>(path.join(this.root, "index.json"), { revision: "", entries: [] });
  }
  private save(entries: LibraryEntry[]): void {
    writeJson(path.join(this.root, "index.json"), { revision: crypto.randomUUID(), entries });
  }
  private emit(e: LibraryEvent): void {
    try {
      this.onChange?.(e);
    } catch {
      /* 监听方自己记日志 */
    }
  }

  list(): LibraryEntry[] {
    return this.index().entries;
  }
  get(id: string): LibraryEntry | undefined {
    return this.list().find((e) => e.id === id);
  }
  /** 和这个机器人有使用关系的（开着、关着都算） */
  forBot(botId: string): LibraryEntry[] {
    return this.list().filter((e) => Object.hasOwn(e.uses, botId));
  }
  /** 在这个机器人上开着的 */
  enabledFor(botId: string): LibraryEntry[] {
    return this.list().filter((e) => e.uses[botId]?.on);
  }
  /** 这个机器人该部署的库条目的指纹：开着的条目和它们的内容变了才变 */
  botRevision(botId: string): string {
    const on = this.enabledFor(botId).map((e) => `${e.name}:${e.digest}`).sort();
    return on.length ? crypto.createHash("sha256").update(on.join("\n")).digest("hex").slice(0, 16) : "";
  }
  packageDir(digest: string): string {
    return path.join(this.root, "packages", digest);
  }
  text(id: string): string {
    const e = this.get(id);
    if (!e) throw new SkillError("not_found", 404);
    return fs.readFileSync(path.join(this.packageDir(e.digest), "SKILL.md"), "utf8");
  }
  /** 条目里的相对路径（「查看」里列出来） */
  paths(id: string): string[] {
    const e = this.get(id);
    if (!e) throw new SkillError("not_found", 404);
    try {
      return readPackageFiles(this.packageDir(e.digest)).map((f) => f.path).sort();
    } catch {
      return [];
    }
  }

  /** 把完整内容写进 packages/<摘要>（先写临时目录再改名）；同内容已有就复用 */
  private writePackage(files: ReadonlyArray<BundleFile>, digest: string): void {
    const dest = this.packageDir(digest);
    if (fs.existsSync(path.join(dest, "SKILL.md"))) return;
    const tmp = path.join(this.root, `.stage-${crypto.randomUUID()}`);
    try {
      fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
      for (const f of files) {
        const target = path.join(tmp, f.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.data, { mode: SCRIPT_FILE.test(f.path) ? 0o700 : 0o600 });
      }
      this.failWrite?.(digest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** 没有条目再用到的包、上次没写完的临时目录删掉 */
  gc(entries = this.list()): void {
    const keep = new Set(entries.map((e) => e.digest));
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(path.join(this.root, "packages"));
    } catch {
      /* 还没有 */
    }
    for (const d of dirs) if (!keep.has(d)) fs.rmSync(path.join(this.root, "packages", d), { recursive: true, force: true });
    try {
      for (const d of fs.readdirSync(this.root)) if (d.startsWith(".stage-")) fs.rmSync(path.join(this.root, d), { recursive: true, force: true });
    } catch {
      /* 还没有 */
    }
  }

  /** 新增一个条目（完整写进 packages/ 后才进索引） */
  add(o: Omit<LibraryEntry, "id" | "digest" | "files" | "bytes" | "scripts" | "createdAt" | "updatedAt" | "uses"> & { id?: string; files: ReadonlyArray<BundleFile>; uses?: Record<string, LibraryUse>; now?: number }): LibraryEntry {
    const digest = contentDigest(o.files);
    this.writePackage(o.files, digest);
    const at = o.now ?? Date.now();
    const { files, now: _now, ...rest } = o;
    const entry: LibraryEntry = {
      ...rest,
      id: o.id ?? `lib_${crypto.randomBytes(9).toString("base64url")}`,
      digest,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.data.length, 0),
      scripts: files.filter((f) => SCRIPT_FILE.test(f.path)).length,
      createdAt: at,
      updatedAt: at,
      uses: o.uses ?? {},
    };
    const entries = this.list();
    if (entries.some((e) => e.id === entry.id)) throw new SkillError("conflict", 409);
    this.save([...entries, entry]);
    this.emit({ type: "added", entry });
    return entry;
  }

  /** 原入口（ZIP、GitHub 替换）改了内容：所有用它的机器人一同换成新的完整内容，开关不变 */
  replace(id: string, files: ReadonlyArray<BundleFile>, meta: { description: string; title?: string; example?: string; source: LibrarySource }): LibraryEntry {
    const digest = contentDigest(files);
    this.writePackage(files, digest);
    const entries = this.list();
    const cur = entries.find((e) => e.id === id);
    if (!cur) throw new SkillError("not_found", 404);
    const next: LibraryEntry = {
      ...cur,
      description: meta.description,
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.example ? { example: meta.example } : {}),
      source: meta.source,
      digest,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.data.length, 0),
      scripts: files.filter((f) => SCRIPT_FILE.test(f.path)).length,
      updatedAt: Date.now(),
    };
    const list = entries.map((e) => (e.id === id ? next : e));
    this.save(list);
    this.gc(list);
    this.emit({ type: "updated", entry: next });
    return next;
  }

  /** 在一个机器人上开或关（新加关系也走这里）。能不能开由调用方先查（重名、容量） */
  setUse(id: string, botId: string, on: boolean, now = Date.now()): LibraryEntry {
    const entries = this.list();
    const cur = entries.find((e) => e.id === id);
    if (!cur) throw new SkillError("not_found", 404);
    if (cur.uses[botId]?.on === on) return cur;
    const next = { ...cur, uses: { ...cur.uses, [botId]: { on, at: now } } };
    this.save(entries.map((e) => (e.id === id ? next : e)));
    this.emit({ type: "use", entry: next, botId });
    return next;
  }

  /** 从库移除：只删本机库里的这一份和已关闭的引用 */
  remove(id: string): LibraryEntry {
    const entries = this.list();
    const cur = entries.find((e) => e.id === id);
    if (!cur) throw new SkillError("not_found", 404);
    const list = entries.filter((e) => e.id !== id);
    this.save(list);
    this.gc(list);
    this.emit({ type: "removed", entry: cur });
    return cur;
  }

  /** 机器人被删：去掉它的使用关系（库里的内容保留） */
  dropBot(botId: string): void {
    const entries = this.list();
    if (!entries.some((e) => Object.hasOwn(e.uses, botId))) return;
    this.save(entries.map((e) => {
      if (!Object.hasOwn(e.uses, botId)) return e;
      const uses = { ...e.uses };
      delete uses[botId];
      return { ...e, uses };
    }));
  }
}
