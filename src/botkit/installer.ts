/**
 * 目录 Bot 的实例：第一次发消息时才创建（只打开看不会走到这里）。
 * 复制规格、安装技能、把示例数据写成初始状态；之后的升级、下架、移除也在这里。
 * 实例 id 固定是 cat-<目录 id>，所以移除时保留数据的话，再次使用能接上原来的工作区。
 */
import { SIDEBAR_LAYOUT_KEY, sanitizeSidebarLayout, withoutRemovedCatalog } from "../domain/sidebar-layout.js";
import fs from "node:fs";
import path from "node:path";
import type { Bot, Store } from "../store/db.js";
import { normalizeSettings, type BotSettings } from "../agent/settings.js";
import { logger } from "../log.js";
import { appSkill } from "./app-skill.js";
import { UserSkills } from "../skills/service.js";
import { safeRelPath } from "../domain/paths.js";
import type { BotCatalog, CatalogEntry } from "./catalog.js";
import { LIMITS, localized, samplePath, type BotAppRef } from "./format.js";
import { RESERVED_SKILLS } from "../skills/archive.js";
import { prune, validate, type JsonSchema } from "./schema.js";
import type { ResolvedFile } from "../web/files.js";

const log = logger("botkit");

export const instanceId = (catalogId: string) => `cat-${catalogId}`;
const STATE_FILE = "app/state.json";
/** 界面能用 readImage 读的类型。SVG 也可以：只放进沙箱页的 <img>，里面的脚本不会运行 */
const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const MEDIA_MIME: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac" };

export class CatalogError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

export interface InstallerOptions {
  dataDir: string;
  store: Store;
  catalog: BotCatalog;
  stopAgent: (botId: string) => Promise<void>;
  /** 这个 Bot 现在有没有在跑的回合、任务 */
  busy: (botId: string) => boolean;
  startBot: (botId: string) => Promise<void>;
}

/**
 * 0.1.30 及以前目录 Bot 借用领域专家当头像（PPT 大师和影视创作室还共用一个），那时装的实例没记 app.avatar。
 * 头像还是当年目录给的这个，就当用户没换过，跟着换成现在的专属形象。
 */
const BORROWED_AVATARS: Record<string, string> = { "ppt-master": "design", printfilm: "design", "company-research": "data", "us-stock-research": "finance" };

/** 目录 Bot 现在该用的头像：用户自己换过的不动，否则跟着目录 */
export function followedAvatar<A extends string>(current: A | "", ref: Pick<BotAppRef, "catalogId" | "avatar">, entryAvatar: A): A | "" {
  const fromCatalog = ref.avatar ?? BORROWED_AVATARS[ref.catalogId];
  return !current || current === fromCatalog ? entryAvatar : current;
}

export function settingsFor(entry: Pick<CatalogEntry, "permissions" | "avatar">): BotSettings {
  return normalizeSettings({
    avatar: entry.avatar,
    permission: entry.permissions.includes("workspace-write") ? "workspace" : "readonly",
    computerUse: { enabled: entry.permissions.includes("computer-use") },
  });
}

export class BotInstaller {
  constructor(readonly o: InstallerOptions) {}

  workspace(botId: string): string {
    return path.join(this.o.dataDir, "workspaces", botId);
  }
  private skillsDir(botId: string): string {
    return path.join(this.o.dataDir, "dsh", botId, "skills");
  }

  private readSchema(uiDir: string): { text: string; schema: JsonSchema | undefined } {
    try {
      const text = fs.readFileSync(path.join(uiDir, "state.schema.json"), "utf8");
      return { text, schema: JSON.parse(text) as JsonSchema };
    } catch {
      return { text: "{}", schema: undefined };
    }
  }

  /** 把技能装到位：先写到临时目录，全部成功才替换，失败时旧的还在 */
  private installSkills(botId: string, runtimeDir: string, uiDir: string, previous: string[]): string[] {
    const dest = this.skillsDir(botId);
    fs.mkdirSync(dest, { recursive: true });
    const src = path.join(runtimeDir, "skills");
    const names = fs.existsSync(src) ? fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
    const installed: string[] = [];
    const staged: Array<[string, string]> = [];
    const userSkills = this.o.store.getBot(botId) ? new UserSkills(this.o.dataDir, this.o.store).list(botId) : [];
    try {
      for (const name of names) {
        // media、computer-use 由宿主自己写；包里不能覆盖
        if ((RESERVED_SKILLS as readonly string[]).includes(name)) throw new CatalogError("reserved_skill");
        if (userSkills.some((s) => s.name === name)) throw new CatalogError("skill_conflict");
        const tmp = path.join(dest, `.${name}.${process.pid}.tmp`);
        fs.cpSync(path.join(src, name), tmp, { recursive: true, verbatimSymlinks: true });
        staged.push([tmp, path.join(dest, name)]);
        installed.push(name);
      }
      const appTmp = path.join(dest, `.amb-app.${process.pid}.tmp`);
      fs.mkdirSync(appTmp, { recursive: true });
      fs.writeFileSync(path.join(appTmp, "SKILL.md"), appSkill(this.readSchema(uiDir).text));
      staged.push([appTmp, path.join(dest, "amb-app")]);
    } catch (e) {
      for (const [tmp] of staged) fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
    for (const old of previous) if (!installed.includes(old)) fs.rmSync(path.join(dest, old), { recursive: true, force: true });
    for (const [tmp, final] of staged) {
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(tmp, final);
    }
    return installed;
  }

  /** 旧版只保留工作区时，状态文件是曾安装的证据；预览不会创建工作区。 */
  isRemoved(catalogId: string): boolean {
    if (this.o.store.getBot(instanceId(catalogId))) return false;
    if (this.o.store.getKV(`catalog.removed.${catalogId}`)) return true;
    let layout;
    try { layout = sanitizeSidebarLayout(JSON.parse(this.o.store.getKV(SIDEBAR_LAYOUT_KEY) || "null")); } catch { return false; }
    const placed = layout?.sections.some((s) => s.items.includes(`c:${catalogId}`));
    if (placed && (this.o.store.getKV(`catalog.installed.${catalogId}`) || fs.existsSync(path.join(this.workspace(instanceId(catalogId)), STATE_FILE)))) {
      this.markRemoved(catalogId); return true;
    }
    return false;
  }
  markRemoved(catalogId: string): void {
    this.o.store.setKV(`catalog.removed.${catalogId}`, "1");
    this.o.store.setKV(`catalog.installed.${catalogId}`, "1");
    try {
      const layout = sanitizeSidebarLayout(JSON.parse(this.o.store.getKV(SIDEBAR_LAYOUT_KEY) || "null"));
      if (layout) this.o.store.setKV(SIDEBAR_LAYOUT_KEY, JSON.stringify(withoutRemovedCatalog(layout, (id) => id === catalogId || !!this.o.store.getKV(`catalog.removed.${id}`))));
    } catch { /* Missing legacy layout does not prevent removal. */ }
  }
  /** 第一次使用：建实例。已经有实例就直接返回（重复点击、并发请求都安全） */
  async install(catalogId: string, lang: string): Promise<Bot> {
    const id = instanceId(catalogId);
    const existing = this.o.store.getBot(id);
    if (existing) return existing;
    const entry = this.o.catalog.get(catalogId);
    if (!entry) throw new CatalogError("catalog_not_found", 404);
    if (entry.removed) throw new CatalogError("catalog_removed", 410);
    // 技能和界面都校验过 sha256 才动本地状态：失败时什么都不创建
    const uiDir = await this.o.catalog.ensureUi(entry).catch(() => {
      throw new CatalogError("catalog_download_failed", 502);
    });
    const runtimeDir = await this.o.catalog.ensureRuntime(entry).catch(() => {
      throw new CatalogError("catalog_download_failed", 502);
    });
    const persona = fs.readFileSync(path.join(runtimeDir, "persona.md"), "utf8");
    const skills = this.installSkills(id, runtimeDir, uiDir, []);
    const state = path.join(this.workspace(id), STATE_FILE);
    // 移除时保留了数据的话接着用原来的
    if (!fs.existsSync(state)) {
      fs.mkdirSync(path.dirname(state), { recursive: true });
      fs.copyFileSync(samplePath(uiDir, lang), state);
    }
    const ref: BotAppRef = { catalogId, version: entry.version, ui: entry.ui.sha256, runtime: entry.runtime.sha256, permissions: entry.permissions, skills, avatar: entry.avatar };
    const bot = this.o.store.createBot({ id, name: localized(entry.name, lang) ?? catalogId, systemPrompt: persona, settings: settingsFor(entry), origin: "catalog", app: ref });
    this.o.store.setKV(`catalog.installed.${catalogId}`, "1");
    this.o.store.deleteKV(`catalog.removed.${catalogId}`);
    await this.o.startBot(id);
    return bot;
  }

  /** 界面要显示的信息：版本、有没有新版本、是否已下架 */
  info(bot: Bot): { ref: BotAppRef; entry: CatalogEntry | undefined; base: string; updateAvailable: boolean } {
    const ref = bot.app!;
    const entry = this.o.catalog.get(ref.catalogId);
    // 实例先显示已安装的界面；更新成功后才切换，避免新包尚未解压就请求它。
    const base = entry?.dev ? uiBase(entry) : ref.ui ? `/amb/botapp/b/${ref.ui}/` : "";
    const changed = !!entry && (!!entry.dev || entry.version !== ref.version || entry.ui.sha256 !== ref.ui || entry.runtime.sha256 !== ref.runtime);
    return { ref, entry, base, updateAvailable: !!entry && !entry.removed && !ref.customized && changed };
  }

  /**
   * 目录有新版本时替换技能和界面。用户改过人设的不跟随；正在工作的等下次。
   * 新包校验过才动本地，失败时旧版本继续用。
   */
  async update(botId: string): Promise<"updated" | "current" | "customized" | "busy" | "removed"> {
    const bot = this.o.store.getBot(botId);
    if (!bot?.app) throw new CatalogError("catalog_not_found", 404);
    const ref = bot.app;
    if (ref.customized) return "customized";
    const entry = this.o.catalog.get(ref.catalogId);
    if (!entry || entry.removed) return "removed";
    if (!entry.dev && entry.version === ref.version && entry.ui.sha256 === ref.ui && entry.runtime.sha256 === ref.runtime) return "current";
    if (this.o.busy(botId)) return "busy";
    const uiDir = await this.o.catalog.ensureUi(entry);
    const runtimeDir = await this.o.catalog.ensureRuntime(entry);
    const persona = fs.readFileSync(path.join(runtimeDir, "persona.md"), "utf8");
    const skills = this.installSkills(botId, runtimeDir, uiDir, ref.skills);
    await this.o.stopAgent(botId);
    this.o.store.updateBot(botId, {
      systemPrompt: persona,
      settings: { ...bot.settings, ...settingsFor(entry), avatar: followedAvatar(bot.settings.avatar, ref, entry.avatar) },
      app: { ...ref, version: entry.version, ui: entry.ui.sha256, runtime: entry.runtime.sha256, permissions: entry.permissions, skills, avatar: entry.avatar },
    });
    return "updated";
  }

  /** 用户改了人设：之后不再跟随目录升级 */
  markCustomized(botId: string): void {
    const bot = this.o.store.getBot(botId);
    if (bot?.app && !bot.app.customized) this.o.store.updateBot(botId, { app: { ...bot.app, customized: true } });
  }

  /**
   * 目录更新后调：目录换了头像，没换过头像的实例跟着换（不用等 Bot 升级，人设被改过、不再跟随升级的也换：头像和人设无关）。
   * 用户自己选过别的头像的不动。
   */
  followAvatars(): void {
    for (const bot of this.o.store.listBots()) {
      const ref = bot.app;
      const entry = ref && !ref.removed ? this.o.catalog.get(ref.catalogId) : undefined;
      if (!ref || !entry || entry.removed || ref.avatar === entry.avatar) continue;
      const avatar = followedAvatar(bot.settings.avatar, ref, entry.avatar);
      this.o.store.updateBot(bot.id, { ...(avatar !== bot.settings.avatar ? { settings: { ...bot.settings, avatar } } : {}), app: { ...ref, avatar: entry.avatar } });
    }
  }

  /** 目录更新后调：下架的记下来；安全原因下架的立刻停掉进程、删掉技能，用户的数据不动 */
  async applyTakedowns(): Promise<void> {
    for (const bot of this.o.store.listBots()) {
      const ref = bot.app;
      if (!ref || ref.removed) continue;
      const removed = this.o.catalog.get(ref.catalogId)?.removed;
      if (!removed) continue;
      if (removed.security) {
        await this.o.stopAgent(bot.id).catch((e) => log.warn("stop removed bot failed", { bot: bot.id, err: String(e) }));
        for (const name of ref.skills) fs.rmSync(path.join(this.skillsDir(bot.id), name), { recursive: true, force: true });
        log.warn("catalog bot taken down for security", { bot: bot.id, reason: removed.reason });
      }
      this.o.store.updateBot(bot.id, { app: { ...ref, removed, ...(removed.security ? { skills: [] } : {}) } });
    }
  }

  /** 移除：工作区、技能和进程目录都清掉；keepData 时留下工作区，再次使用能接上 */
  cleanup(botId: string, keepData: boolean): void {
    fs.rmSync(path.join(this.o.dataDir, "dsh", botId), { recursive: true, force: true });
    fs.rmSync(path.join(this.o.dataDir, "dsh", ".prompts", `${botId}.md`), { force: true });
    if (!keepData) fs.rmSync(this.workspace(botId), { recursive: true, force: true });
  }

  /** 工作区 app/ 下的绝对路径；走出 app/ 的（含符号链接）一律不给 */
  private resolveAppPath(botId: string, rel: unknown): string | undefined {
    if (!safeRelPath(rel) || !rel.startsWith("app/")) return undefined;
    const root = path.join(this.workspace(botId), "app");
    const f = path.join(this.workspace(botId), ...rel.split("/"));
    try {
      const real = fs.realpathSync(f);
      const realRoot = fs.realpathSync(root);
      return real === realRoot || real.startsWith(realRoot + path.sep) ? real : undefined;
    } catch {
      return undefined;
    }
  }

  private filePayload(buf: Buffer, rel: string, schema: JsonSchema | undefined): { path: string; text?: string; json?: unknown; issues: string[] } {
    const text = buf.toString("utf8");
    if (rel !== STATE_FILE || !schema) return { path: rel, text, issues: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { path: rel, json: null, issues: ["state.json 不是合法的 JSON"] };
    }
    const issues = validate(parsed, schema);
    return { path: rel, json: issues.length ? (prune(parsed, schema) ?? null) : parsed, issues };
  }

  /** 界面读文件：只读 app/ 下；state.json 先校验，不合法的部分剪掉 */
  async readFile(bot: Bot, rel: unknown): Promise<{ path: string; text?: string; json?: unknown; issues: string[] } | undefined> {
    const f = this.resolveAppPath(bot.id, rel);
    if (!f) return undefined;
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > LIMITS.stateBytes) return undefined;
    const entry = bot.app ? this.o.catalog.get(bot.app.catalogId) : undefined;
    const uiDir = entry?.dev ?? (bot.app?.ui ? this.o.catalog.uiDirIfPresent(bot.app.ui) : undefined);
    const schema = uiDir ? this.readSchema(uiDir).schema : undefined;
    const out = this.filePayload(fs.readFileSync(f), rel as string, schema);
    if (out.issues.length) log.warn("bot state does not match its schema", { bot: bot.id, issues: out.issues.slice(0, 5) });
    return out;
  }

  /** 界面读图片：只读 app/ 下，读成 data URL。沙箱页连不上接口，图片也只能这样给 */
  readImage(bot: Bot, rel: unknown): { path: string; url: string; size: number } | undefined {
    const f = this.resolveAppPath(bot.id, rel);
    const mime = f && IMAGE_MIME[path.extname(f).toLowerCase()];
    if (!f || !mime) return undefined;
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > LIMITS.imageBytes) return undefined;
    return { path: rel as string, url: `data:${mime};base64,${fs.readFileSync(f).toString("base64")}`, size: st.size };
  }

  /** 给「打开」和下载用：app/ 下的普通文件（硬链接看不出指向哪里，不给），走不出去 */
  appFile(bot: Bot, rel: unknown): ResolvedFile | undefined {
    const f = this.resolveAppPath(bot.id, rel);
    if (!f) return undefined;
    const st = fs.statSync(f);
    return st.isFile() && st.nlink === 1 ? { path: f, size: st.size, mtimeMs: st.mtimeMs, mode: st.mode } : undefined;
  }

  /** 预览只开放音视频；文件边界与下载一致，不能借 Blob 传递 HTML/脚本。 */
  mediaFile(bot: Bot, rel: unknown): (ResolvedFile & { mime: string }) | undefined {
    const file = this.appFile(bot, rel);
    const mime = file && MEDIA_MIME[path.extname(file.path).toLowerCase()];
    return file && mime && file.size <= LIMITS.mediaBytes ? { ...file, mime } : undefined;
  }

  /** 列出 app/ 下的文件（评测用它检查产物）。不跟随符号链接 */
  listApp(botId: string, limit = 5000): Array<{ path: string; size: number }> {
    const out: Array<{ path: string; size: number }> = [];
    const walkDir = (dir: string, rel: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= limit) return;
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walkDir(path.join(dir, e.name), r);
        else if (e.isFile()) out.push({ path: r, size: fs.statSync(path.join(dir, e.name)).size });
      }
    };
    const root = path.join(this.workspace(botId), "app");
    if (fs.existsSync(root)) walkDir(root, "app");
    return out;
  }

  /** 还没有实例时：界面读到的就是示例数据 */
  async previewFile(entry: CatalogEntry, rel: unknown, lang: string): Promise<{ path: string; text?: string; json?: unknown; issues: string[] } | undefined> {
    if (rel !== STATE_FILE) return undefined;
    const dir = await this.o.catalog.ensureUi(entry);
    return this.filePayload(fs.readFileSync(samplePath(dir, lang)), STATE_FILE, this.readSchema(dir).schema);
  }

  /** 用户选的文件放进 app/inbox/，重名时加序号；返回工作区里的相对路径 */
  saveInbox(botId: string, name: string, data: Buffer): string {
    if (data.length > LIMITS.inboxBytes) throw new CatalogError("inbox_too_large", 413);
    const clean = path.basename(name.replaceAll("\\", "/")).replace(/[\0-\x1f<>:"|?*]/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
    const dir = path.join(this.workspace(botId), "app", "inbox");
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(clean);
    const stem = clean.slice(0, clean.length - ext.length);
    let out = clean;
    for (let i = 2; fs.existsSync(path.join(dir, out)); i++) out = `${stem}-${i}${ext}`;
    fs.writeFileSync(path.join(dir, out), data);
    return `app/inbox/${out}`;
  }

  /** 看着 app/ 下的文件变化（界面据此刷新）。返回取消函数 */
  watch(botId: string, onChange: (rel: string) => void): () => void {
    const root = path.join(this.workspace(botId), "app");
    fs.mkdirSync(root, { recursive: true });
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const w = fs.watch(root, { recursive: true }, (_e, name) => {
      if (name) pending.add(`app/${String(name).replaceAll("\\", "/")}`);
      timer ??= setTimeout(() => {
        timer = undefined;
        for (const rel of pending) onChange(rel);
        pending.clear();
      }, 120);
    });
    w.on("error", (e) => log.warn("bot app watch failed", { bot: botId, err: String(e) }));
    return () => {
      if (timer) clearTimeout(timer);
      w.close();
    };
  }
}

/** 界面的地址前缀（iframe 从这里加载 index.html） */
export function uiBase(entry: CatalogEntry): string {
  return entry.dev ? `/amb/botapp/d/${encodeURIComponent(entry.id)}/` : `/amb/botapp/b/${entry.ui.sha256}/`;
}
