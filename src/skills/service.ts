/**
 * 用户导入的技能独立保存；DSH 空闲重启时才将启用项部署到 skills/。
 *
 * 三处存放，合成一份「我的技能库」索引（libraryView）：
 * - skills/<机器人>/：旧入口（ZIP、GitHub、对话安装）装在某个机器人上的技能，原地保留，按 bot:<机器人>:<名字> 登记；
 * - my-skills/：对话里存下的「我存的」（skills/mine.ts），按 mine:<名字> 登记；
 * - skill-library/：从本机导入的新条目，以及旧技能被加到别的机器人、或所在机器人被删时登记过来的那一份（skills/library.ts）。
 * 每个技能只有一份可写的内容；机器人只记开关。同一个机器人上同一个调用名只开一份。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Store } from "../store/db.js";
import { SCRIPT_FILE, SkillError, SKILL_LIMITS, reservedSkill, skillName, type SkillPackage } from "./archive.js";
import { MySkills } from "./mine.js";
import { SkillLibrary, contentDigest, readPackageFiles, type LibraryEntry, type LibrarySource } from "./library.js";

/** 技能从哪来：本地 ZIP，或按 GitHub 链接安装（仓库、路径、分支、安装时的提交号）。0.1.35 及以前导入的没有记录，按本地 ZIP 显示 */
export type SkillSource =
  | { type: "zip"; installedAt: number }
  | { type: "github"; owner: string; repo: string; path: string; ref: string; commit: string; url: string; installedAt: number };

export interface UserSkill {
  name: string;
  description: string;
  digest: string;
  enabled: boolean;
  files: number;
  bytes: number;
  source?: SkillSource;
  /** SKILL.md frontmatter metadata 里的标题和「试试这样说」（导出的「我的技能」带着；技能库外的 ZIP 技能用它显示名字） */
  title?: string;
  example?: string;
}
interface Index { revision: string; skills: UserSkill[] }

/** 和 DSH 一样读 frontmatter 的布尔值（dsh-skill-filesystem frontmatterBoolean） */
const truthy = (v: unknown) => v === true || v === 1 || (typeof v === "string" && /^(true|yes|on|1)$/i.test(v.trim()));
/** 包的摘要 → 模型能不能自己用它（SKILL.md 写了 disable-model-invocation: true 的只能由用户在消息里写 /技能名 调用）。包内容不变，按摘要缓存 */
const invocable = new Map<string, boolean>();
/** 旧包（ZIP 摘要、「我存的」的正文摘要）→ 内容摘要（和库里的条目比「相同内容」）。包内容不变，按目录缓存 */
const contents = new Map<string, string>();

/** 「我的技能库」里的一项（三处来源合在一起）：kind 是它存在哪 */
export interface LibraryItem {
  id: string;
  kind: "library" | "bot" | "mine";
  name: string;
  title: string;
  description: string;
  example?: string;
  /** 内容摘要（完整相对路径 + 字节） */
  contentDigest: string;
  source: LibrarySource | { type: "mine"; installedAt: number };
  files: number;
  bytes: number;
  scripts: number;
  /** 使用它的机器人：开着 / 关着 */
  bots: Array<{ id: string; on: boolean }>;
  createdAt: number;
  /** 从本机导入时补全的字段、依赖没核实 */
  completed?: Array<{ field: string; value: string }>;
  depsUnverified?: boolean;
  /** 能「从库移除」（存在库里的条目，没有机器人开着） */
  removable: boolean;
}

/** 库条目在某个机器人上能不能开：同名已开着（name_on）、保留名（reserved_name） */
export type UseBlock = "name_on" | "reserved_name";

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw e; }
}
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
}

export class UserSkills {
  /** 「我的技能」：全局一份，和这里按机器人存的技能一起部署（skills/mine.ts） */
  readonly mine: MySkills;
  /** 「我的技能库」的库存：从本机导入的、登记过来的（skills/library.ts） */
  readonly library: SkillLibrary;
  constructor(private dataDir: string, private store: Store) {
    this.mine = new MySkills(dataDir);
    this.library = new SkillLibrary(dataDir);
  }
  private root(botId: string): string {
    if (!this.store.getBot(botId)) throw new SkillError("not_found", 404);
    return path.join(this.dataDir, "skills", botId);
  }
  private index(botId: string): Index { return readJson(path.join(this.root(botId), "index.json"), { revision: "", skills: [] }); }
  /** 这个机器人要部署的技能的版本：导入的技能变了，或在它上面打开的「我的技能」、库条目变了 */
  revision(botId: string): string {
    if (!this.store.getBot(botId)) return "";
    const mine = this.mine.botRevision(botId);
    const lib = this.library.botRevision(botId);
    const own = this.index(botId).revision;
    return lib ? `${own}|${mine}|${lib}` : mine ? `${own}|${mine}` : own;
  }
  list(botId: string): UserSkill[] { return this.index(botId).skills; }
  /** 模型能不能自己用这个技能：SKILL.md 里 disable-model-invocation 为真时不能（DSH 不把它放进模型的技能目录） */
  modelInvocable(botId: string, skill: Pick<UserSkill, "digest"> & { library?: boolean }): boolean {
    let ok = invocable.get(skill.digest);
    if (ok === undefined) {
      ok = true;
      try {
        const text = fs.readFileSync(path.join(skill.library ? this.library.packageDir(skill.digest) : path.join(this.root(botId), "packages", skill.digest), "SKILL.md"), "utf8");
        const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
        ok = !truthy(front ? parse(front[1], { maxAliasCount: 0 })?.["disable-model-invocation"] : undefined);
      } catch { /* 读不到按默认（模型可以用） */ }
      invocable.set(skill.digest, ok);
    }
    return ok;
  }
  /** 上次部署（sync）到机器人进程里的技能：名字 → 包的摘要。还没部署过时没有 */
  applied(botId: string): ReadonlyMap<string, string> | undefined { return this.deployed.get(botId); }
  private deployed = new Map<string, Map<string, string>>();
  detail(botId: string, name: string): UserSkill & { instructions: string } {
    const skill = this.list(botId).find((s) => s.name === name);
    if (!skill) {
      // 装到库条目上的（这个机器人用着的同名库条目被 ZIP / GitHub 替换过）
      const lib = this.libraryTarget(botId, name);
      if (!lib) throw new SkillError("not_found", 404);
      return { ...this.asUserSkill(lib, botId), instructions: this.library.text(lib.id) };
    }
    return { ...skill, instructions: fs.readFileSync(path.join(this.root(botId), "packages", skill.digest, "SKILL.md"), "utf8") };
  }
  /** 库条目在一个机器人上的样子（和按机器人存的技能同一种字段） */
  asUserSkill(e: LibraryEntry, botId: string): UserSkill {
    return { name: e.name, description: e.description, digest: e.digest, enabled: !!e.uses[botId]?.on, files: e.files, bytes: e.bytes, source: e.source.type === "local" ? { type: "zip", installedAt: e.source.installedAt } : e.source, title: e.title, ...(e.example ? { example: e.example } : {}) };
  }
  /** 这个机器人用着的同名库条目（开着的优先）：ZIP / GitHub 装同名技能时替换的就是它 */
  libraryTarget(botId: string, name: string): LibraryEntry | undefined {
    const mine = this.library.forBot(botId).filter((e) => e.name === name);
    return mine.find((e) => e.uses[botId]?.on) ?? mine[0];
  }
  private assertAvailable(botId: string, name: string): void {
    if (!skillName(name) || reservedSkill(name)) throw new SkillError("reserved_name", 400, { name });
    if (this.store.getBot(botId)?.app?.skills.includes(name)) throw new SkillError("reserved_name", 400, { name });
    const applied = readJson<string[]>(path.join(this.root(botId), "applied.json"), []);
    if (fs.existsSync(path.join(this.dataDir, "dsh", botId, "skills", name)) && !applied.includes(name)) throw new SkillError("reserved_name", 400, { name });
  }
  /** 这个机器人上已经开着同名的库条目：不再开第二份（先关掉那一个） */
  private assertNoneOn(botId: string, name: string): void {
    if (this.library.enabledFor(botId).some((e) => e.name === name)) throw new SkillError("name_on", 409, { name });
  }
  /** 「我的技能」占用的名字不能再装（不管它在不在这个机器人上打开） */
  private assertNotMine(name: string): void {
    const mine = this.mine.get(name);
    if (mine) throw new SkillError("mine_name", 400, { name, title: mine.title });
  }
  /**
   * 「我的技能」能不能在这个机器人上打开：名字不能和保留名、自带技能、这个机器人已装的技能（开着关着都算），
   * 以及 skills/ 里不归这里管的目录重名
   */
  mineAvailable(botId: string, name: string): boolean {
    if (!skillName(name) || reservedSkill(name)) return false;
    if (this.store.getBot(botId)?.app?.skills.includes(name)) return false;
    if (this.list(botId).some((s) => s.name === name)) return false;
    if (this.library.enabledFor(botId).some((e) => e.name === name)) return false;
    const applied = readJson<string[]>(path.join(this.root(botId), "applied.json"), []);
    return !(fs.existsSync(path.join(this.dataDir, "dsh", botId, "skills", name)) && !applied.includes(name));
  }
  preview(botId: string, pkg: SkillPackage) {
    this.assertAvailable(botId, pkg.name);
    this.assertNotMine(pkg.name);
    const skills = this.list(botId);
    const old = skills.find((s) => s.name === pkg.name);
    // 这个机器人用着的同名库条目：替换的是库里那一份，用它的其他机器人一同生效（先说明是哪些）
    const lib = old ? undefined : this.libraryTarget(botId, pkg.name);
    if (!old && !lib) this.assertNoneOn(botId, pkg.name);
    // 装不下的在确认之前就说（替换同名的不占新名额）
    if (!old && !lib && skills.length >= SKILL_LIMITS.installed) throw new SkillError("too_many");
    const shared = lib ? this.sharedBots(lib, botId) : [];
    return {
      name: pkg.name, description: pkg.description, files: pkg.files.length, bytes: pkg.bytes, scripts: pkg.files.filter((f) => SCRIPT_FILE.test(f.path)).length, instructions: pkg.instructions,
      replaces: old?.digest ?? lib?.digest ?? null,
      replacesSource: old ? (old.source ?? { type: "zip" as const, installedAt: 0 }) : lib ? lib.source : null,
      ...(shared.length ? { shared } : {}),
    };
  }
  /** 除了这个机器人，还有哪些机器人开着这个库条目（名字） */
  sharedBots(e: LibraryEntry, botId?: string): string[] {
    return Object.entries(e.uses).filter(([b, u]) => u.on && b !== botId).map(([b]) => this.store.getBot(b)?.name ?? "").filter(Boolean);
  }
  install(botId: string, pkg: SkillPackage, replaces: string | null, source: SkillSource = { type: "zip", installedAt: Date.now() }): UserSkill {
    this.assertAvailable(botId, pkg.name);
    this.assertNotMine(pkg.name);
    const index = this.index(botId);
    const old = index.skills.find((s) => s.name === pkg.name);
    const lib = old ? undefined : this.libraryTarget(botId, pkg.name);
    if (lib) {
      // 原入口改了库条目的内容：统一发布完整的新内容，所有用它的机器人空闲后一起换上，开关不变
      if (lib.digest !== replaces) throw new SkillError("conflict", 409);
      const next = this.library.replace(lib.id, pkg.files, { description: pkg.description, ...(pkg.title ? { title: pkg.title } : {}), ...(pkg.example ? { example: pkg.example } : {}), source });
      return this.asUserSkill(next, botId);
    }
    if ((old?.digest ?? null) !== replaces) throw new SkillError("conflict", 409);
    if (!old) this.assertNoneOn(botId, pkg.name);
    if (!old && index.skills.length >= SKILL_LIMITS.installed) throw new SkillError("too_many");
    const root = this.root(botId);
    const dest = path.join(root, "packages", pkg.digest);
    if (!fs.existsSync(dest)) {
      const tmp = path.join(root, `.import-${crypto.randomUUID()}`);
      try {
        fs.mkdirSync(tmp, { recursive: true });
        for (const f of pkg.files) {
          const target = path.join(tmp, f.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, f.data, { mode: SCRIPT_FILE.test(f.path) ? 0o700 : 0o600 });
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(tmp, dest);
      } finally { fs.rmSync(tmp, { force: true, recursive: true }); }
    }
    const skill: UserSkill = { name: pkg.name, description: pkg.description, digest: pkg.digest, enabled: old?.enabled ?? true, files: pkg.files.length, bytes: pkg.bytes, source, ...(pkg.title ? { title: pkg.title } : {}), ...(pkg.example ? { example: pkg.example } : {}) };
    this.save(botId, [...index.skills.filter((s) => s.name !== pkg.name), skill]);
    if (old && old.digest !== pkg.digest) fs.rmSync(path.join(root, "packages", old.digest), { recursive: true, force: true });
    return skill;
  }
  setEnabled(botId: string, name: string, enabled: boolean): void {
    const skills = this.list(botId);
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new SkillError("not_found", 404);
    if (enabled && !skill.enabled) {
      this.assertAvailable(botId, name);
      this.assertNoneOn(botId, name);
    }
    if (skill.enabled === enabled) return;
    skill.enabled = enabled;
    this.save(botId, skills);
  }
  remove(botId: string, name: string): void {
    const skills = this.list(botId);
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new SkillError("not_found", 404);
    this.save(botId, skills.filter((s) => s !== skill));
    fs.rmSync(path.join(this.root(botId), "packages", skill.digest), { recursive: true, force: true });
  }
  private save(botId: string, skills: UserSkill[]): void {
    writeJson(path.join(this.root(botId), "index.json"), { revision: crypto.randomUUID(), skills: skills.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  /** 只在代理未运行时调用。仅清理曾由本服务部署的目录，不触碰内置或目录 Bot 技能。 */
  sync(botId: string): string {
    const index = this.index(botId);
    const root = this.root(botId);
    const state = path.join(root, "applied.json");
    const previous = readJson<string[]>(state, []);
    const revision = this.revision(botId);
    // 在这个机器人上打开的「我的技能」：和已装的技能、自带技能重名的不部署（打开时已经拦过，这里兜底）
    const mine = this.mine.forBot(botId).filter((s) => !index.skills.some((x) => x.name === s.name) && this.mineAvailable(botId, s.name));
    const catalog = this.store.getBot(botId)?.app?.skills ?? [];
    // 在这个机器人上开着的库条目：和开着的已装技能、「我的技能」、自带技能重名的不部署（开启时已经拦过，这里兜底；同名只部署一份）
    const taken = new Set([...index.skills.filter((s) => s.enabled).map((s) => s.name), ...mine.map((s) => s.name), ...catalog]);
    const lib = this.library.enabledFor(botId).filter((e) => {
      if (!skillName(e.name) || reservedSkill(e.name) || taken.has(e.name)) return false;
      taken.add(e.name);
      return true;
    });
    const deployed = new Map([...index.skills.filter((s) => s.enabled), ...mine, ...lib].map((s) => [s.name, s.digest]));
    if (!index.skills.length && !mine.length && !lib.length && !previous.length) { this.deployed.set(botId, deployed); return revision; }
    const dest = path.join(this.dataDir, "dsh", botId, "skills");
    const enabled = index.skills.filter((s) => s.enabled);
    for (const skill of enabled) this.assertAvailable(botId, skill.name);
    fs.mkdirSync(dest, { recursive: true });
    // 先记录所有本服务可能写入的名字，进程意外退出后也能清理半成品。
    const owned = [...new Set([...previous, ...enabled.map((s) => s.name), ...mine.map((s) => s.name), ...lib.map((e) => e.name)])].filter((name) => skillName(name) && !reservedSkill(name) && !catalog.includes(name));
    writeJson(state, owned);
    for (const name of owned) fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    for (const skill of enabled) fs.cpSync(path.join(root, "packages", skill.digest), path.join(dest, skill.name), { recursive: true });
    for (const skill of mine) fs.cpSync(this.mine.packageDir(skill.digest), path.join(dest, skill.name), { recursive: true });
    for (const e of lib) fs.cpSync(this.library.packageDir(e.digest), path.join(dest, e.name), { recursive: true });
    writeJson(state, [...enabled.map((s) => s.name), ...mine.map((s) => s.name), ...lib.map((e) => e.name)]);
    this.deployed.set(botId, deployed);
    return revision;
  }
  cleanup(botId: string): void {
    // App.deleteBot 在删数据库记录前调用。删机器人不删库：它装的技能先登记进库（不带使用关系），库条目上它的使用关系去掉
    for (const s of this.list(botId)) {
      try {
        this.promote(botId, s.name, false);
      } catch {
        /* 登记不了的照旧随机器人删除（原来的行为） */
      }
    }
    this.library.dropBot(botId);
    const previous = readJson<string[]>(path.join(this.root(botId), "applied.json"), []);
    const catalog = this.store.getBot(botId)?.app?.skills ?? [];
    for (const name of previous) if (skillName(name) && !reservedSkill(name) && !catalog.includes(name)) fs.rmSync(path.join(this.dataDir, "dsh", botId, "skills", name), { recursive: true, force: true });
    fs.rmSync(this.root(botId), { recursive: true, force: true });
  }

  // ———————————————— 「我的技能库」：三处来源合成一份索引，机器人从库里添加、开关 ————————————————

  /** 库条目在这个机器人上能不能开：保留名、自带技能、不归这里管的目录 → reserved_name；同名的已开着 → name_on */
  useBlock(botId: string, e: Pick<LibraryEntry, "id" | "name">): UseBlock | undefined {
    if (!skillName(e.name) || reservedSkill(e.name)) return "reserved_name";
    if (this.store.getBot(botId)?.app?.skills.includes(e.name)) return "reserved_name";
    if (this.list(botId).some((s) => s.enabled && s.name === e.name)) return "name_on";
    if (this.mine.forBot(botId).some((m) => m.name === e.name)) return "name_on";
    if (this.library.enabledFor(botId).some((x) => x.id !== e.id && x.name === e.name)) return "name_on";
    const applied = readJson<string[]>(path.join(this.root(botId), "applied.json"), []);
    if (fs.existsSync(path.join(this.dataDir, "dsh", botId, "skills", e.name)) && !applied.includes(e.name)) return "reserved_name";
    return undefined;
  }

  /**
   * 在一个机器人上开或关一个库条目（没有关系时新加）：只影响这个机器人。开的时候查同名（不自动关掉旧的）和容量
   * （机器人的技能名额和原来的导入一样算：已装的 + 开着的库条目，最多 100；只入库不占名额）
   */
  useLibrary(entryId: string, botId: string, on: boolean): LibraryEntry {
    const e = this.library.get(entryId);
    if (!e || !this.store.getBot(botId)) throw new SkillError("not_found", 404);
    if (on && !e.uses[botId]?.on) {
      const block = this.useBlock(botId, e);
      if (block) throw new SkillError(block, 409, { name: e.name });
      if (this.list(botId).length + this.library.enabledFor(botId).length >= SKILL_LIMITS.installed) throw new SkillError("bot_full", 409);
    }
    return this.library.setUse(entryId, botId, on);
  }

  /**
   * 「从技能库添加…」：把库里的一项用到这个机器人上（已有关系的不重复加，关着的打开）。
   * 「我存的」走它原来的开关；别的机器人装的旧技能先登记进库（名字、内容、开关、来源不变），再加上这个机器人
   */
  addFromLibrary(botId: string, itemId: string): void {
    if (!this.store.getBot(botId)) throw new SkillError("not_found", 404);
    this.reconcile();
    if (itemId.startsWith("mine:")) {
      const m = this.mine.get(itemId.slice(5));
      if (!m) throw new SkillError("not_found", 404);
      if (m.bots.includes(botId)) return;
      if (!this.mineAvailable(botId, m.name)) throw new SkillError("name_on", 409, { name: m.name });
      this.mine.setEnabled(m.name, botId, true);
      return;
    }
    if (!this.library.get(itemId)) {
      const m = /^bot:([^:]+):(.+)$/.exec(itemId);
      if (!m) throw new SkillError("not_found", 404);
      const [, owner, name] = m;
      if (owner === botId) {
        // 本来就装在这个机器人上：关着的打开
        const own = this.list(botId).find((s) => s.name === name);
        if (!own) throw new SkillError("not_found", 404);
        if (!own.enabled) this.setEnabled(botId, name, true);
        return;
      }
      if (!this.store.getBot(owner)) throw new SkillError("not_found", 404);
      this.promote(owner, name, true);
    }
    this.useLibrary(itemId, botId, true);
  }

  /**
   * 旧技能登记进库：内容原样复制进 skill-library/（id 沿用 bot:<机器人>:<名字>），开关按原来的，再去掉旧记录。
   * 中途断了再来一次不会重复：库里已有这个 id 就只做收尾
   */
  promote(owner: string, name: string, keepUse: boolean): LibraryEntry {
    const id = `bot:${owner}:${name}`;
    const skill = this.list(owner).find((s) => s.name === name);
    let entry = this.library.get(id);
    if (!entry) {
      if (!skill) throw new SkillError("not_found", 404);
      const files = readPackageFiles(path.join(this.root(owner), "packages", skill.digest));
      const at = Date.now();
      entry = this.library.add({
        id,
        files,
        name: skill.name,
        title: skill.title ?? skill.name,
        description: skill.description,
        ...(skill.example ? { example: skill.example } : {}),
        source: skill.source ?? { type: "zip", installedAt: 0 },
        legacy: { botId: owner, digest: skill.digest },
        uses: keepUse ? { [owner]: { on: skill.enabled, at } } : {},
      });
    }
    if (skill && entry.legacy?.botId === owner && entry.legacy.digest === skill.digest) this.dropLegacy(owner, name);
    return entry;
  }
  private dropLegacy(botId: string, name: string): void {
    const skills = this.list(botId);
    const skill = skills.find((s) => s.name === name);
    if (!skill) return;
    this.save(botId, skills.filter((s) => s !== skill));
    fs.rmSync(path.join(this.root(botId), "packages", skill.digest), { recursive: true, force: true });
  }
  /** 上次登记到一半（库里有了、旧记录还在）：把旧记录收尾 */
  reconcile(): void {
    for (const e of this.library.list()) {
      if (!e.legacy || !this.store.getBot(e.legacy.botId)) continue;
      const old = this.list(e.legacy.botId).find((s) => s.name === e.name);
      if (old && old.digest === e.legacy.digest) this.dropLegacy(e.legacy.botId, e.name);
    }
  }

  /** 旧包的内容摘要（和库里的新条目用同一种算法） */
  private legacyDigest(key: string, dir: string): string {
    let d = contents.get(key);
    if (!d) {
      try {
        d = contentDigest(readPackageFiles(dir));
      } catch {
        d = `missing:${key}`;
      }
      contents.set(key, d);
    }
    return d;
  }

  /** 「我的技能库」：库里的条目、各机器人装的旧技能、「我存的」，合成一份（未登记的也在，不会当成不存在而重复导入） */
  libraryView(): LibraryItem[] {
    this.reconcile();
    const items: LibraryItem[] = [];
    for (const e of this.library.list()) {
      items.push({
        id: e.id, kind: "library", name: e.name, title: e.title, description: e.description, ...(e.example ? { example: e.example } : {}),
        contentDigest: e.digest, source: e.source, files: e.files, bytes: e.bytes, scripts: e.scripts,
        bots: Object.entries(e.uses).filter(([b]) => this.store.getBot(b)).map(([id, u]) => ({ id, on: u.on })),
        createdAt: e.createdAt,
        ...(e.completed?.length ? { completed: e.completed } : {}),
        ...(e.depsUnverified ? { depsUnverified: true } : {}),
        removable: !Object.entries(e.uses).some(([b, u]) => u.on && this.store.getBot(b)),
      });
    }
    for (const bot of this.store.listBots()) {
      for (const s of this.list(bot.id)) {
        if (this.library.get(`bot:${bot.id}:${s.name}`)) continue;
        items.push({
          id: `bot:${bot.id}:${s.name}`, kind: "bot", name: s.name, title: s.title ?? s.name, description: s.description, ...(s.example ? { example: s.example } : {}),
          contentDigest: this.legacyDigest(`b:${s.digest}`, path.join(this.root(bot.id), "packages", s.digest)),
          source: s.source ?? { type: "zip", installedAt: 0 }, files: s.files, bytes: s.bytes, scripts: 0,
          bots: [{ id: bot.id, on: s.enabled }], createdAt: s.source?.installedAt ?? 0, removable: false,
        });
      }
    }
    for (const m of this.mine.list()) {
      items.push({
        id: `mine:${m.name}`, kind: "mine", name: m.name, title: m.title, description: m.description, example: m.example,
        contentDigest: this.legacyDigest(`m:${m.digest}`, this.mine.packageDir(m.digest)),
        source: { type: "mine", installedAt: m.savedAt }, files: 1, bytes: 0, scripts: 0,
        bots: m.bots.filter((b) => this.store.getBot(b)).map((id) => ({ id, on: true })), createdAt: m.createdAt, removable: false,
      });
    }
    return items;
  }

  /**
   * 从库移除（只给存在库里的条目）：只删本机库里的这一份和已关闭的引用，来源不动。
   * 有机器人开着、或者关了但正在跑的任务还用着（inUse）的，先关闭并等任务结束
   */
  removeFromLibrary(id: string, inUse: (botId: string, name: string, digest: string) => boolean): LibraryEntry {
    const e = this.library.get(id);
    if (!e) throw new SkillError("not_found", 404);
    if (Object.entries(e.uses).some(([b, u]) => u.on && this.store.getBot(b))) throw new SkillError("in_use", 409);
    if (Object.keys(e.uses).some((b) => inUse(b, e.name, e.digest))) throw new SkillError("in_use", 409);
    return this.library.remove(id);
  }
}
