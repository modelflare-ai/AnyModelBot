/**
 * 对话里的技能安装卡片：用户把技能的 GitHub 链接发给机器人（技能库的「复制安装指令」，或自己说「装一下这个」），
 * 应用读取并预检，出一张确认卡片；用户点「安装」才写入文件，只装到这个对话的机器人上。
 *
 * - 状态：reading 读取中 → pending 等你确认 → installing 安装中 → installed 已安装 / replaced 已替换；
 *   任一步可能 failed；另有 canceled 已取消、expired 已过期。卡片 30 分钟内有效。
 * - 读到的文件暂存在内存里（staged），点「安装」时装的就是这一份；取消、过期、重启都丢掉，不写任何文件。
 *   重启时还在读取、等确认的卡片一律记为过期（处理过的卡片只保留结果，重启后显示最终状态）。
 * - 卡片存在 kv（skill-install:<id>），对话历史按时间把它插回去；最多留最近 500 张。
 * - 渠道（微信、飞书等）没有网页卡片：发一段文字，带 4 位编号，主人回「y 1234」安装、「n 1234」取消；飞书卡片上有按钮。
 *   只有主人能装（由调用方判断，见 core/runtime.ts、agent/manager.ts）。
 */
import crypto from "node:crypto";
import type { Store } from "../store/db.js";
import type { OutboundOp } from "../core/types.js";
import { lang as currentLang, t } from "../i18n/index.js";
import { SkillError, type SkillPackage } from "./archive.js";
import { parseSkillLink, readGithubSkill, type GithubSkillSource, type SkillLink } from "./github.js";
import type { UserSkills } from "./service.js";
import type { LibrarySource } from "./library.js";
import { logger } from "../log.js";

const log = logger("skills.install");

export const CARD_TTL_MS = 30 * 60_000;
export const MAX_CARDS_PER_MESSAGE = 5;
const KV = "skill-install:";
const KEEP = 500;

export type InstallState = "reading" | "pending" | "installing" | "installed" | "replaced" | "failed" | "canceled" | "expired";
const LIVE: InstallState[] = ["reading", "pending", "installing"];

export interface InstallCard {
  id: string;
  botId: string;
  conversationId: string;
  /** 用户发来的链接 */
  url: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  state: InstallState;
  /** 渠道里回复用的 4 位编号 */
  code: string;
  error?: { code: string; n?: number; resetAt?: number; name?: string; title?: string };
  /** 预检通过后才有：SKILL.md 的 name / description、文件数、大小、脚本数、许可证、来源、同名的已有技能 */
  skill?: {
    name: string;
    description: string;
    files: number;
    bytes: number;
    scripts: number;
    license: string | null;
    source: GithubSkillSource;
    replaces: { digest: string; source: LibrarySource; shared?: string[] } | null;
  };
  decidedBy?: string;
}

export type Permission = "readonly" | "workspace" | "full";
const PERM_KEY = { readonly: "skills.permReadonly", workspace: "skills.permWorkspace", full: "skills.permFull" } as const;

export interface SkillInstallsOptions {
  store: Store;
  skills: UserSkills;
  /** 桌面版走系统代理的 fetch；缺省 Node 的 fetch */
  fetch?: () => typeof fetch | undefined;
  permission?: (botId: string) => Permission;
  /** 装好了：空闲的代理进程换新的，下一条消息起可用（正在跑的回合、后台任务结束后再换） */
  onInstalled?: (botId: string) => void;
  now?: () => number;
}

/** 技能库「复制安装指令」的固定格式：每行一条，前缀 + 链接（两种语言）。整条消息都是这种行时由应用直接出卡片，不经过模型 */
const PROMPT_LINE = /^(?:帮我安装这个技能\s*[：:]|install this skill for me\s*:)\s*(https?:\/\/\S+)$/i; // i18n-ignore: fixed install prompt formats
export function installPromptLinks(text: string): string[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const urls: string[] = [];
  for (const line of lines) {
    const m = PROMPT_LINE.exec(line);
    if (!m) return null;
    urls.push(m[1].replace(/[。，；、]+$/, ""));
  }
  return urls;
}

const YES = /^(y|yes|ok|是|好|同意|安装|install|替换|replace)$/i;
const REPLY = /^(y|yes|ok|是|好|同意|安装|install|替换|replace|n|no|否|不|取消|cancel)\s*[#:：]?\s*(\d{4})?$/i;

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class SkillInstalls {
  private staged = new Map<string, { pkg: SkillPackage; source: GithubSkillSource }>();
  private reads = new Map<string, Promise<InstallCard>>();
  private aborts = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | undefined;
  /** 正在回复的对话：install_skill 工具出的卡片经它送到这一轮的回复里（网页对话一出就送，渠道读完再送） */
  private sinks = new Map<string, (card: InstallCard, phase: "created" | "ready") => Promise<void>>();
  /** 应用内群聊：这条用户消息由哪个机器人出卡片（core/groups.ts，网页服务创建群聊时挂上） */
  groupOwner: ((groupId: string) => string | undefined) | undefined;

  constructor(private o: SkillInstallsOptions) {}

  bindSink(conversationId: string, fn: (card: InstallCard, phase: "created" | "ready") => Promise<void>): () => void {
    this.sinks.set(conversationId, fn);
    return () => {
      if (this.sinks.get(conversationId) === fn) this.sinks.delete(conversationId);
    };
  }

  async deliver(conversationId: string, cards: InstallCard[], phase: "created" | "ready"): Promise<void> {
    const sink = this.sinks.get(conversationId);
    if (!sink) return;
    for (const c of cards) await sink(c, phase).catch((e) => log.warn("deliver install card failed", { message: (e as Error).message?.slice(0, 200) }));
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** 启动：上次运行留下的读取中、等确认、安装中的卡片记为过期（暂存的文件已经没了）；之后定时清理过期的 */
  start(): void {
    for (const c of this.all()) if (LIVE.includes(c.state)) this.save({ ...c, state: "expired", updatedAt: this.now() });
    this.timer ??= setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const a of this.aborts.values()) a.abort();
  }

  sweep(): void {
    for (const c of this.all()) if (c.state === "pending" && c.expiresAt <= this.now()) this.expire(c);
  }

  private all(): InstallCard[] {
    const out: InstallCard[] = [];
    for (const [, v] of this.o.store.listKV(KV)) {
      try {
        out.push(JSON.parse(v));
      } catch {
        /* 坏的一条不影响别的 */
      }
    }
    return out;
  }

  private save(c: InstallCard): InstallCard {
    this.o.store.setKV(KV + c.id, JSON.stringify(c));
    return c;
  }

  private expire(c: InstallCard): InstallCard {
    this.staged.delete(c.id);
    return this.save({ ...c, state: "expired", updatedAt: this.now() });
  }

  get(id: string): InstallCard | undefined {
    const raw = this.o.store.getKV(KV + id);
    if (!raw) return undefined;
    let c: InstallCard;
    try {
      c = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (c.state === "pending" && c.expiresAt <= this.now()) c = this.expire(c);
    return c;
  }

  /** 这些对话里的卡片，按时间排 */
  list(conversationIds: string[]): InstallCard[] {
    const want = new Set(conversationIds);
    return this.all()
      .filter((c) => want.has(c.conversationId))
      .map((c) => (c.state === "pending" && c.expiresAt <= this.now() ? this.expire(c) : c))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private newCode(): string {
    const used = new Set([
      ...this.o.store.listApprovals({ status: "pending", limit: 500 }).map((r) => r.code),
      ...this.o.store.pendingAccessCodes(),
      ...this.all().filter((c) => LIVE.includes(c.state)).map((c) => c.code),
    ]);
    for (let i = 0; i < 50; i++) {
      const c = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      if (!used.has(c)) return c;
    }
    return String(crypto.randomInt(1000, 10000));
  }

  /** 这个对话在 since 之后出过几张卡片（一条消息最多 5 张） */
  countSince(conversationId: string, since: number): number {
    return this.list([conversationId]).filter((c) => c.createdAt >= since).length;
  }

  /** 为每个链接出一张卡片（最多 5 张，多的由调用方告诉用户分批发），在后台读取；ready(id) 等读取结束 */
  request(o: { botId: string; conversationId: string; urls: string[] }): InstallCard[] {
    const cards = o.urls.slice(0, MAX_CARDS_PER_MESSAGE).map((url) => {
      const link = parseSkillLink(url);
      const at = this.now();
      const card: InstallCard = {
        id: crypto.randomUUID(),
        botId: o.botId,
        conversationId: o.conversationId,
        url,
        createdAt: at,
        updatedAt: at,
        expiresAt: at + CARD_TTL_MS,
        state: link ? "reading" : "failed",
        code: this.newCode(),
        ...(link ? {} : { error: { code: "invalid_link" } }),
      };
      this.save(card);
      if (link) this.startRead(card, link);
      return card;
    });
    this.prune();
    return cards;
  }

  /** 读取结束（或本来就不在读）时的卡片 */
  async ready(id: string): Promise<InstallCard | undefined> {
    return (await this.reads.get(id)) ?? this.get(id);
  }

  private startRead(card: InstallCard, link: SkillLink): void {
    const ac = new AbortController();
    this.aborts.set(card.id, ac);
    // 没人等也不能变成未处理的拒绝（应用退出时库已经关了，读取才结束）
    const p = this.read(card, link, ac.signal)
      .catch((e) => {
        log.warn("finishing a skill read failed", { message: (e as Error).message?.slice(0, 200) });
        return card;
      })
      .finally(() => {
        this.reads.delete(card.id);
        this.aborts.delete(card.id);
      });
    this.reads.set(card.id, p);
  }

  private async read(card: InstallCard, link: SkillLink, signal: AbortSignal): Promise<InstallCard> {
    let next: InstallCard;
    try {
      const r = await readGithubSkill(link, { fetch: this.o.fetch?.(), signal, now: this.o.now });
      const preview = this.o.skills.preview(card.botId, r.pkg);
      const cur = this.get(card.id);
      if (!cur || cur.state !== "reading") return cur ?? card;
      this.staged.set(card.id, { pkg: r.pkg, source: r.source });
      next = {
        ...cur,
        state: "pending",
        updatedAt: this.now(),
        error: undefined,
        skill: {
          name: preview.name,
          description: preview.description,
          files: preview.files,
          bytes: preview.bytes,
          scripts: preview.scripts,
          license: r.license,
          source: r.source,
          replaces: preview.replaces && preview.replacesSource ? { digest: preview.replaces, source: preview.replacesSource, ...(preview.shared?.length ? { shared: preview.shared } : {}) } : null,
        },
      };
    } catch (e) {
      const cur = this.get(card.id);
      if (!cur || cur.state !== "reading") return cur ?? card;
      const err = e instanceof SkillError ? e : new SkillError("network", 502);
      if (!(e instanceof SkillError)) log.warn("reading a skill from GitHub failed", { message: (e as Error).message?.slice(0, 200) });
      next = { ...cur, state: "failed", updatedAt: this.now(), error: { code: err.code, ...err.detail } };
    }
    return this.save(next);
  }

  /** 读取失败（连不上、限流）后再读一次；卡片重新计 30 分钟 */
  retry(id: string): InstallCard {
    const c = this.get(id);
    if (!c) throw new SkillError("not_found", 404);
    const link = parseSkillLink(c.url);
    if (c.state !== "failed" || !link || c.error?.code === "invalid_link") return c;
    if (c.error?.code === "rate_limited" && (c.error.resetAt ?? 0) > this.now()) return c;
    const at = this.now();
    const next = this.save({ ...c, state: "reading", error: undefined, updatedAt: at, expiresAt: at + CARD_TTL_MS });
    this.startRead(next, link);
    return next;
  }

  /** 点「安装」/「替换」或渠道里回 y：写入文件。只在等确认时有效 */
  install(id: string, by: string): InstallCard {
    const c = this.get(id);
    if (!c) throw new SkillError("not_found", 404);
    if (c.state !== "pending" || !c.skill) return c;
    const staged = this.staged.get(id);
    if (!staged) return this.expire(c);
    this.save({ ...c, state: "installing", updatedAt: this.now(), decidedBy: by });
    let next: InstallCard;
    try {
      this.o.skills.install(c.botId, staged.pkg, c.skill.replaces?.digest ?? null, { type: "github", ...staged.source, installedAt: this.now() });
      next = { ...c, state: c.skill.replaces ? "replaced" : "installed", updatedAt: this.now(), decidedBy: by };
    } catch (e) {
      const code = e instanceof SkillError ? e.code : "network";
      if (!(e instanceof SkillError)) log.warn("installing a skill failed", { message: (e as Error).message?.slice(0, 200) });
      next = { ...c, state: "failed", updatedAt: this.now(), decidedBy: by, error: { code, ...(code === "reserved_name" ? { name: c.skill.name } : {}), ...(e instanceof SkillError && code === "mine_name" ? e.detail : {}) } };
    }
    this.staged.delete(id);
    this.save(next);
    if (next.state === "installed" || next.state === "replaced") {
      log.info("skill installed from GitHub", { bot: c.botId, skill: c.skill.name, repo: `${c.skill.source.owner}/${c.skill.source.repo}`, commit: c.skill.source.commit.slice(0, 12) });
      this.o.onInstalled?.(c.botId);
    }
    return next;
  }

  /** 点「取消」或渠道里回 n：不写任何文件 */
  cancel(id: string, by: string): InstallCard {
    const c = this.get(id);
    if (!c) throw new SkillError("not_found", 404);
    if (c.state !== "pending" && c.state !== "reading") return c;
    this.aborts.get(id)?.abort();
    this.staged.delete(id);
    return this.save({ ...c, state: "canceled", updatedAt: this.now(), decidedBy: by });
  }

  /** 卡片里「展开 SKILL.md 全文」：等确认时取暂存的这一份，装好后取装上的那一份 */
  instructions(id: string): string | undefined {
    const c = this.get(id);
    if (!c?.skill) return undefined;
    const staged = this.staged.get(id);
    if (staged) return staged.pkg.instructions;
    if (c.state === "installed" || c.state === "replaced") {
      try {
        return this.o.skills.detail(c.botId, c.skill.name).instructions;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** 界面用：卡片 + 机器人名字、它当前的权限档位、能不能展开 SKILL.md、有没有在读取 */
  view(c: InstallCard) {
    const bot = this.o.store.getBot(c.botId);
    return {
      ...c,
      botName: bot?.name ?? c.botId,
      botExists: !!bot,
      permission: this.o.permission?.(c.botId) ?? "workspace",
      instructions: !!c.skill && (this.staged.has(c.id) || c.state === "installed" || c.state === "replaced"),
    };
  }

  private prune(): void {
    const all = this.all();
    if (all.length <= KEEP) return;
    for (const c of all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - KEEP)) {
      if (LIVE.includes(c.state)) continue;
      this.o.store.deleteKV(KV + c.id);
    }
  }

  /** 机器人被删：它的卡片一起删（暂存的文件也丢掉） */
  dropBot(botId: string): void {
    for (const c of this.all()) {
      if (c.botId !== botId) continue;
      this.aborts.get(c.id)?.abort();
      this.staged.delete(c.id);
      this.o.store.deleteKV(KV + c.id);
    }
  }

  // —— 渠道 ——

  /**
   * 渠道里的回复：「y 1234」安装、「n 1234」取消；这个对话只有一张等确认的卡片、又没有别的审批在等时，只回 y / n 也行。
   * 编号对上了已经处理过的卡片：告诉用户它现在的结果。
   */
  handleReply(conversationId: string, text: string, by: string): { handled: boolean; ack?: string } {
    const m = REPLY.exec(text.trim());
    if (!m) return { handled: false };
    const cards = this.list([conversationId]);
    const pending = cards.filter((c) => c.state === "pending");
    let card: InstallCard | undefined;
    if (m[2]) card = cards.findLast((c) => c.code === m[2]);
    else if (pending.length === 1 && !this.o.store.listApprovals({ status: "pending", conversationId, limit: 1 }).length) card = pending[0];
    if (!card) return { handled: false };
    if (card.state !== "pending") return { handled: true, ack: this.resultText(card) };
    const done = YES.test(m[1]) ? this.install(card.id, by) : this.cancel(card.id, by);
    return { handled: true, ack: this.resultText(done) };
  }

  /** 飞书卡片按钮 */
  cardAction(botId: string, value: Record<string, string>, by: string): { toast: string; ok: boolean } {
    const c = value?.id ? this.get(String(value.id)) : undefined;
    const owner = c && (this.o.store.getConversation(c.conversationId)?.account || c.botId);
    if (!c || owner !== botId) return { toast: t("skills.cardMissing"), ok: false };
    if (c.state !== "pending") return { toast: this.resultText(c), ok: false };
    const done = value.op === "install" ? this.install(c.id, by) : this.cancel(c.id, by);
    return { toast: this.resultText(done), ok: done.state === "installed" || done.state === "replaced" || done.state === "canceled" };
  }

  /** 发到渠道的那段文字（网页对话显示的是卡片，不用它） */
  promptText(c: InstallCard): string {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    const head = t("skills.cardTitle", { bot });
    if (c.state !== "pending" || !c.skill) return `${head}\n${this.resultText(c)}`;
    const s = c.skill;
    const where = [`${s.source.owner}/${s.source.repo}`, s.source.path, s.source.ref].filter(Boolean).join(" · ");
    const license = s.license === null ? t("skills.licenseNone") : s.license === "NOASSERTION" ? t("skills.licenseCustom") : s.license;
    const lines = [
      head,
      `${s.name}：${s.description}`,
      t("skills.sourceLine", { where, url: s.source.url }),
      t("skills.metaLine", { license, count: s.files, size: fmtSize(s.bytes) }),
    ];
    if (s.scripts) lines.push(t("skills.scriptsHint", { count: s.scripts, permission: t(PERM_KEY[this.o.permission?.(c.botId) ?? "workspace"]) }));
    if (s.replaces) lines.push(t("skills.replaceHint", { name: s.name, source: this.sourceText(s.replaces.source) }));
    // 替换的是库里多个机器人共用的那一份：说明还有哪些机器人一同生效
    if (s.replaces?.shared?.length) lines.push(t("skills.sharedHint", { bots: new Intl.ListFormat(currentLang()).format(s.replaces.shared) }));
    lines.push(t(s.replaces ? "skills.replyReplace" : "skills.replyInstall", { code: c.code, bot }));
    return lines.join("\n");
  }

  sourceText(s: LibrarySource): string {
    return s.type === "github" ? t("skills.sourceGithub", { repo: `${s.owner}/${s.repo}` }) : s.type === "local" ? t("skills.sourceLocal") : t("skills.sourceZip");
  }

  /** 卡片当前结果的一句话（渠道的回执、失败卡片、编号对上已处理的卡片） */
  resultText(c: InstallCard): string {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    switch (c.state) {
      case "reading":
        return t("skills.reading");
      case "pending":
        return t("skills.waiting", { code: c.code });
      case "installing":
        return t("skills.installing");
      case "installed":
        return t("skills.installed", { bot });
      case "replaced":
        return t("skills.replaced", { name: c.skill?.name ?? "" });
      case "canceled":
        return t("skills.canceled");
      case "expired":
        return t("skills.expired");
      case "failed":
        return this.errorText(c);
    }
  }

  private errorText(c: InstallCard): string {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    const e = c.error ?? { code: "network" };
    switch (e.code) {
      case "invalid_link":
        return t("skills.errInvalidLink");
      case "repo_not_found":
        return t("skills.errRepoNotFound");
      case "missing_skill":
        return t("skills.errMissingSkill");
      case "multiple_skills":
        return t("skills.errMultipleSkills", { n: e.n ?? 2 });
      case "invalid_skill":
        return t("skills.errInvalidSkill");
      case "too_large":
        return t("skills.errTooLarge");
      case "unsafe_path":
        return t("skills.errUnsafePath");
      case "too_many":
        return t("skills.errTooMany", { bot });
      case "mine_name":
        return t("mySkills.mineName", { name: e.name ?? "", title: e.title ?? "" });
      case "reserved_name":
        return t("skills.errReservedName", { name: e.name ?? "" });
      case "conflict":
        return t("skills.errConflict");
      case "rate_limited":
        return t("skills.errRateLimited", { time: new Date(e.resetAt ?? this.now()).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) });
      default:
        return t("skills.errNetwork");
    }
  }

  /** 渠道的出站操作：等确认时带按钮（飞书），其余只有文字 */
  op(c: InstallCard): Extract<OutboundOp, { type: "interactive" }> {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    const pending = c.state === "pending" && !!c.skill;
    return {
      type: "interactive",
      kind: "skill_install",
      title: t("skills.cardTitle", { bot }),
      prompt: this.promptText(c),
      requestId: c.id,
      code: c.code,
      ...(pending
        ? {
            buttons: [
              { label: t(c.skill!.replaces ? "skills.replace" : "skills.install"), value: { amb: "skill", id: c.id, op: "install" }, style: "primary" as const },
              { label: t("skills.cancel"), value: { amb: "skill", id: c.id, op: "cancel" } },
            ],
          }
        : {}),
    };
  }
}
