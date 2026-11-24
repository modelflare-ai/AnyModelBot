/**
 * 对话里的「存成技能」草稿卡：用户说「存成技能」（或点「+」›「存成技能…」、发 /skill），机器人用 save_skill 交来草稿，
 * 应用在这里补上用到的工具记录、删掉密钥、标出个人信息，出一张草稿卡；用户点「保存」或「更新」才写文件（skills/mine.ts）。
 *
 * - 状态：drafting 生成中 → pending 等你确认 → saving 保存中 → saved 已保存 / updated 已更新；
 *   另有 canceled 已取消、expired 已过期（30 分钟；对话里改了出新卡时旧卡也记为过期，superseded）、failed 失败（带重试）。
 *   处理过的卡片只留结果；卡片存在 kv（skill-draft:<id>），重启后状态不变，重启时还没处理完的记为过期。
 * - 技能文件由草稿拼出来（composeSkill）：标题和「试试这样说」写进 frontmatter 的 metadata，随导出带走；
 *   纠正改写成规则放进「注意事项」，取消勾选的不写；「运行时再问」的个人信息换成 {{占位}}，用技能时先问用户。
 *   用户点「编辑」改的是这份原文，改完重新检查密钥和名称，手机号、邮箱、路径重新标（人名、群名不重标）。
 * - 同一个技能（标题相同，或机器人判断是同一件事）：卡片顶部说「你已有…」和改了几处，按钮是「更新」「另存为新技能」。
 * - 渠道（微信、飞书、Telegram、Slack、Discord 的私聊）：发一段文字，回复「保存」「取消」「保留个人信息」（「另存」），
 *   其他回复交给机器人（改草稿时它会再出一张）；飞书卡片上有按钮。只有主人能存（调用方判断）。
 */
import crypto from "node:crypto";
import { stringify } from "yaml";
import type { Store } from "../store/db.js";
import type { OutboundOp } from "../core/types.js";
import { lang as currentLang, t } from "../i18n/index.js";
import { logger } from "../log.js";
import { SkillError, skillName } from "./archive.js";
import { findPersonal, findSecrets, scrubSecrets, type PersonalKind } from "./redact.js";
import { MY_PREFIX, MY_SKILLS_MAX, normalizeMyName, readFrontmatter, uniqueName, validMyName, type BlockedStep, type MySkill, type MySkillApp, type MySkillUse, type MySkills } from "./mine.js";
import type { UserSkills } from "./service.js";

const log = logger("skills.drafts");

export const DRAFT_TTL_MS = 30 * 60_000;
/** 技能正文（frontmatter 之后）最多多少字 */
export const BODY_MAX = 2000;
const KV = "skill-draft:";
const KEEP = 500;

export type DraftState = "drafting" | "pending" | "saving" | "saved" | "updated" | "canceled" | "expired" | "failed";
const LIVE: DraftState[] = ["drafting", "pending", "saving"];

export interface DraftPersonal {
  id: string;
  text: string;
  kind: PersonalKind;
  /** 改成占位时的名字（{{label}}） */
  label: string;
  /** true 保留原文；false 运行时再问（默认） */
  keep: boolean;
}

export interface DraftCorrection {
  /** 用户的原话 */
  quote: string;
  /** 改写成的规则（写进「注意事项」） */
  rule: string;
  /** 取消勾选的不写进技能 */
  on: boolean;
}

/** 宿主从这段对话的工具步骤里认出来的（agent/manager.ts skillRecords） */
export interface SkillRecords {
  /** 做事的工具调用有几次（没有就是「没有可存的事」） */
  work: number;
  blocked: BlockedStep[];
  apps: MySkillApp[];
  uses: MySkillUse[];
}

export interface Draft {
  title: string;
  name: string;
  description: string;
  steps: string[];
  corrections: DraftCorrection[];
  notes: string[];
  example: string;
  /** 没做完：卡在哪一步（存下来标未验证） */
  unfinished?: string;
  apps: MySkillApp[];
  uses: MySkillUse[];
  blocked: BlockedStep[];
  /** 生成时去掉了几处密钥 */
  secrets: number;
  personal: DraftPersonal[];
  /** 同一个技能：已有的那个 */
  same?: { name: string; title: string };
  /** 用户点「编辑」改过的原文（之后以它为准） */
  edited?: string;
}

export type DraftErrorCode = "draft_failed" | "save_failed" | "mine_full";

export interface DraftCard {
  id: string;
  botId: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  state: DraftState;
  /** 对话里改了、出了新卡：这张作废（记为过期） */
  superseded?: boolean;
  error?: { code: DraftErrorCode };
  draft?: Draft;
  /** 点了哪个：save 新存 · update 更新 · copy 另存为新技能（失败后「重试」照这个再来一次） */
  mode?: "save" | "update" | "copy";
  result?: { name: string; title: string; example: string; mode: "saved" | "updated" };
  decidedBy?: string;
}

export interface SkillDraftsOptions {
  store: Store;
  skills: UserSkills;
  /** 保存、更新后：空闲的代理进程换新的，下一条消息起可用 */
  onSaved?: (botIds: string[]) => void;
  /** 这个技能在这个机器人上的生效状态（成功回执里的说法）：active 下一条消息起 · waiting 当前任务结束后 · loading 加载中 */
  readiness?: (botId: string, name: string) => "active" | "waiting" | "loading";
  now?: () => number;
}

/** 草稿里每一段的上限（防止模型写出整本说明书） */
const LIMIT = { title: 40, name: 64, description: 1024, step: 300, steps: 20, note: 300, notes: 12, corrections: 10, quote: 200, example: 120, unfinished: 120, personal: 30 };

const clip = (s: unknown, n: number) => {
  const v = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
};
const list = (v: unknown, n: number, each: number) => (Array.isArray(v) ? v.map((x) => clip(x, each)).filter(Boolean).slice(0, n) : []);

const PLACEHOLDER = /\{\{([^{}\n]{1,40})\}\}/g;

/** 文字里的 {{占位}}（去重，按出现顺序） */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1].trim()).filter(Boolean))];
}

function askLabel(kind: PersonalKind): string {
  switch (kind) {
    case "phone":
      return t("mySkills.askPhone");
    case "email":
      return t("mySkills.askEmail");
    case "name":
      return t("mySkills.askName");
    case "group":
      return t("mySkills.askGroup");
    case "path":
      return t("mySkills.askPath");
    default:
      return t("mySkills.askOther");
  }
}

/** 占位名字不重复：收件人邮箱、收件人邮箱 2 */
function uniqueLabels(items: DraftPersonal[]): DraftPersonal[] {
  const used = new Map<string, number>();
  return items.map((p) => {
    const base = p.label.replace(/[{}\n]/g, "").trim().slice(0, 30) || askLabel(p.kind);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { ...p, label: n === 1 ? base : `${base} ${n}` };
  });
}

/** 把「运行时再问」的个人信息换成占位（长的先换，免得只换掉一半） */
function applyPersonal(text: string, personal: DraftPersonal[]): string {
  let out = text;
  for (const p of [...personal].filter((x) => !x.keep).sort((a, b) => b.text.length - a.text.length)) out = out.split(p.text).join(`{{${p.label}}}`);
  return out;
}

/** 拼出技能文件（frontmatter + 正文）。个人信息还是原文，占位在 finalText 里换 */
export function composeSkill(d: Draft): string {
  const front = stringify({ name: d.name, description: d.description, metadata: { title: d.title, example: d.example } }, { lineWidth: 0 }).trimEnd();
  const lines: string[] = [`# ${d.title}`, "", d.description];
  if (d.steps.length) lines.push("", `## ${t("mySkills.mdSteps")}`, ...d.steps.map((s, i) => `${i + 1}. ${s}`));
  const notes = [...d.corrections.filter((c) => c.on).map((c) => c.rule), ...d.notes];
  lines.push("", `## ${t("mySkills.mdNotes")}`, ...notes.map((n) => `- ${n}`), `- ${t("mySkills.mdDefaults")}`);
  if (d.unfinished) lines.push(`- ${t("mySkills.mdUnfinished", { step: d.unfinished })}`);
  const asks = d.personal.filter((p) => !p.keep).map((p) => p.label);
  if (asks.length) lines.push("", `## ${t("mySkills.mdAsks")}`, t("mySkills.mdAsksIntro"), ...asks.map((a) => `- {{${a}}}`));
  if (d.apps.length) lines.push("", `## ${t("mySkills.mdApps")}`, ...d.apps.map((a) => `- ${a.alias ? t("mySkills.mdAppAlias", { app: a.name, alias: a.alias }) : a.name}${a.sends ? ` — ${t("mySkills.mdAppSends")}` : ""}`));
  if (d.uses.length) {
    lines.push("", `## ${t("mySkills.mdUses")}`);
    for (const u of d.uses) {
      const where = u.source.type === "github" ? t("mySkills.mdUseGithub", { repo: `${u.source.owner}/${u.source.repo}`, url: u.source.url }) : u.source.type === "zip" ? t("mySkills.mdUseZip") : t("mySkills.mdUseMine");
      lines.push(`- ${u.title && u.title !== u.name ? t("mySkills.mdUseTitled", { name: u.name, title: u.title, where }) : t("mySkills.mdUseLine", { name: u.name, where })}`);
    }
  }
  return `---\n${front}\n---\n\n${lines.join("\n")}\n`;
}

/** 改 frontmatter 里的名字和标题（另存为新技能、补 my- 前缀），正文不动 */
export function withFrontmatter(text: string, patch: { name?: string; title?: string }): string {
  const m = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
  if (!m) return text;
  let head = m[2];
  if (patch.name !== undefined) head = /^name:.*$/m.test(head) ? head.replace(/^name:.*$/m, `name: ${patch.name}`) : `name: ${patch.name}\n${head}`;
  if (patch.title !== undefined) {
    const line = `  title: ${JSON.stringify(patch.title)}`;
    if (/^ {2}title:.*$/m.test(head)) head = head.replace(/^ {2}title:.*$/m, line);
    else if (/^metadata:\s*$/m.test(head)) head = head.replace(/^metadata:\s*$/m, `metadata:\n${line}`);
    else head = `${head}\nmetadata:\n${line}`;
  }
  return m[1] + head + m[3] + text.slice(m[0].length);
}

/** 两段文字按行比，改了几处（连续改动算一处）和每处的增删 */
export function lineDiff(before: string, after: string): Array<{ del: string[]; add: string[] }> {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // 最长公共子序列（技能正文不长，O(n·m) 足够）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: Array<{ del: string[]; add: string[] }> = [];
  let cur: { del: string[]; add: string[] } | undefined;
  let i = 0;
  let j = 0;
  const flush = () => {
    if (cur && (cur.del.length || cur.add.length)) hunks.push(cur);
    cur = undefined;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      (cur ??= { del: [], add: [] }).add.push(b[j++]);
    } else {
      (cur ??= { del: [], add: [] }).del.push(a[i++]);
    }
  }
  flush();
  return hunks.map((h) => ({ del: h.del.filter((x) => x.trim()), add: h.add.filter((x) => x.trim()) })).filter((h) => h.del.length || h.add.length);
}

const bodyOf = (text: string) => readFrontmatter(text)?.body ?? text;

export interface DraftCheck {
  name: boolean;
  description: boolean;
  /** 还有几处像密钥的内容 */
  secrets: number;
  tooLong: boolean;
  ok: boolean;
}

/** 这张卡片对应的回复 */
export interface ReplyResult {
  handled: boolean;
  ack?: string;
}

/** 渠道里认的回复词：当前语言、中文、英文都认 */
function words(key: "mySkills.wordSave" | "mySkills.wordCancel" | "mySkills.wordKeep" | "mySkills.wordCopy"): string[] {
  const zh: Record<string, string> = { "mySkills.wordSave": "保存", "mySkills.wordCancel": "取消", "mySkills.wordKeep": "保留个人信息", "mySkills.wordCopy": "另存" }; // i18n-ignore: reply words accepted in every language
  const en: Record<string, string> = { "mySkills.wordSave": "save", "mySkills.wordCancel": "cancel", "mySkills.wordKeep": "keep personal info", "mySkills.wordCopy": "save as new" };
  return [...new Set([t(key), zh[key], en[key]].map((w) => w.toLowerCase()))];
}
const norm = (s: string) => s.trim().replace(/^[「“"'《]+|[」”"'》。.!！]+$/g, "").trim().toLowerCase();

export class SkillDrafts {
  private timer: NodeJS.Timeout | undefined;
  private sinks = new Map<string, (card: DraftCard) => Promise<void>>();
  /** 应用内群聊：这条用户消息由哪个机器人出卡片（和技能安装卡片同一条规则，core/groups.ts） */
  groupOwner: ((groupId: string) => string | undefined) | undefined;

  constructor(private o: SkillDraftsOptions) {}

  private get mine(): MySkills {
    return this.o.skills.mine;
  }
  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  // —— 存取 ——

  start(): void {
    for (const c of this.all()) if (LIVE.includes(c.state)) this.save({ ...c, state: "expired", updatedAt: this.now() });
    this.timer ??= setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  sweep(): void {
    for (const c of this.all()) {
      if (c.state === "pending" && c.expiresAt <= this.now()) this.save({ ...c, state: "expired", updatedAt: this.now() });
      // 生成中太久（这一轮卡住了）：算整理失败
      else if (c.state === "drafting" && c.createdAt + 15 * 60_000 <= this.now()) this.save({ ...c, state: "failed", error: { code: "draft_failed" }, updatedAt: this.now() });
    }
  }
  private all(): DraftCard[] {
    const out: DraftCard[] = [];
    for (const [, v] of this.o.store.listKV(KV)) {
      try {
        out.push(JSON.parse(v));
      } catch {
        /* 坏的一条不影响别的 */
      }
    }
    return out;
  }
  private save(c: DraftCard): DraftCard {
    this.o.store.setKV(KV + c.id, JSON.stringify(c));
    return c;
  }
  get(id: string): DraftCard | undefined {
    const raw = this.o.store.getKV(KV + id);
    if (!raw) return undefined;
    let c: DraftCard;
    try {
      c = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (c.state === "pending" && c.expiresAt <= this.now()) c = this.save({ ...c, state: "expired", updatedAt: this.now() });
    return c;
  }
  list(conversationIds: string[]): DraftCard[] {
    const want = new Set(conversationIds);
    return this.all()
      .filter((c) => want.has(c.conversationId))
      .map((c) => (c.state === "pending" && c.expiresAt <= this.now() ? this.save({ ...c, state: "expired", updatedAt: this.now() }) : c))
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  private prune(): void {
    const all = this.all();
    if (all.length <= KEEP) return;
    for (const c of all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - KEEP)) if (!LIVE.includes(c.state)) this.o.store.deleteKV(KV + c.id);
  }
  dropBot(botId: string): void {
    for (const c of this.all()) if (c.botId === botId) this.o.store.deleteKV(KV + c.id);
  }

  bindSink(conversationId: string, fn: (card: DraftCard) => Promise<void>): () => void {
    this.sinks.set(conversationId, fn);
    return () => {
      if (this.sinks.get(conversationId) === fn) this.sinks.delete(conversationId);
    };
  }
  async deliver(conversationId: string, card: DraftCard): Promise<void> {
    await this.sinks.get(conversationId)?.(card).catch((e) => log.warn("deliver draft card failed", { message: (e as Error).message?.slice(0, 200) }));
  }

  /** 这个对话里还在等确认的那张（最新的） */
  pendingIn(conversationId: string): DraftCard | undefined {
    return this.list([conversationId]).findLast((c) => c.state === "pending");
  }

  // —— 生成 ——

  /** /skill、「存成技能…」：先出一张「正在整理技能…」的卡，机器人交来草稿时原位变成草稿卡 */
  begin(botId: string, conversationId: string): DraftCard {
    const at = this.now();
    this.supersede(conversationId);
    const card = this.save({ id: crypto.randomUUID(), botId, conversationId, createdAt: at, updatedAt: at, expiresAt: at + DRAFT_TTL_MS, state: "drafting" });
    this.prune();
    return card;
  }

  /** 这一轮结束了还在「生成中」的卡（机器人没交草稿）：整理失败，带重试 */
  settle(conversationId: string): DraftCard[] {
    const out: DraftCard[] = [];
    for (const c of this.list([conversationId])) if (c.state === "drafting") out.push(this.save({ ...c, state: "failed", error: { code: "draft_failed" }, updatedAt: this.now() }));
    return out;
  }

  /** 对话里出了新卡：之前没处理的作废 */
  private supersede(conversationId: string, keep?: string): void {
    for (const c of this.list([conversationId])) if ((c.state === "pending" || c.state === "drafting") && c.id !== keep) this.save({ ...c, state: "expired", superseded: true, updatedAt: this.now() });
  }

  /**
   * save_skill 交来的草稿 → 卡片。args 是模型给的（标题、文件名、什么时候用、步骤、纠正、注意事项、示例、没做完的那一步、
   * 个人信息、同一个技能的名字），records 是宿主从工具步骤里认出来的；context 是这段对话里用户说过的话（数密钥用）。
   */
  request(o: { botId: string; conversationId: string; args: Record<string, unknown>; records: SkillRecords; context?: string }): DraftCard {
    const a = o.args ?? {};
    const mark = t("mySkills.secretMark");
    const found = new Set<string>();
    const scrub = (s: string) => {
      const r = scrubSecrets(s, mark);
      for (const v of r.found) found.add(v);
      return r.text;
    };
    const title = scrub(clip(a.title, LIMIT.title)) || scrub(clip(a.name, LIMIT.title)) || "skill";
    const corrections: DraftCorrection[] = (Array.isArray(a.corrections) ? a.corrections : [])
      .slice(0, LIMIT.corrections)
      .map((c: any) => ({ quote: scrub(clip(c?.quote, LIMIT.quote)), rule: scrub(clip(c?.rule, LIMIT.note)), on: true }))
      .filter((c) => c.rule);
    const draft: Draft = {
      title,
      name: normalizeMyName(clip(a.name, LIMIT.name) || title),
      description: scrub(clip(a.description, LIMIT.description)),
      steps: list(a.steps, LIMIT.steps, LIMIT.step).map(scrub),
      corrections,
      notes: list(a.notes, LIMIT.notes, LIMIT.note).map(scrub),
      example: scrub(clip(a.example, LIMIT.example)),
      ...(clip(a.unfinished_step, LIMIT.unfinished) ? { unfinished: scrub(clip(a.unfinished_step, LIMIT.unfinished)) } : {}),
      apps: o.records.apps,
      uses: o.records.uses,
      blocked: o.records.blocked,
      secrets: 0,
      personal: [],
    };
    // 对话里出现过、被挡在技能外面的密钥也算「去掉」的
    for (const v of findSecrets(o.context ?? "")) found.add(v);
    draft.secrets = found.size;
    // 个人信息：模型标的（人名、群名、路径…）+ 规则认出来的（手机号、邮箱、带用户名的路径），默认运行时再问
    const text = composeSkill(draft);
    const flagged = (Array.isArray(a.personal) ? a.personal : []).slice(0, LIMIT.personal).flatMap((p: any) => {
      const s = clip(p?.text, 80);
      const kind = (["phone", "email", "name", "group", "path", "other"].includes(p?.kind) ? p.kind : "other") as PersonalKind;
      return s && s.length >= 2 && text.includes(s) ? [{ text: s, kind, label: clip(p?.label, 30) || askLabel(kind) }] : [];
    });
    const auto = findPersonal(text).filter((p) => !flagged.some((f: { text: string }) => f.text === p.text || f.text.includes(p.text)));
    draft.personal = uniqueLabels([...flagged, ...auto.map((p) => ({ ...p, label: askLabel(p.kind) }))].map((p) => ({ id: crypto.randomUUID().slice(0, 8), keep: false, ...p })));
    // 同一个技能：机器人判断是同一件事，或标题相同
    const sameName = typeof a.same_as === "string" ? a.same_as.trim() : "";
    const same = (sameName && this.mine.get(sameName)) || this.mine.byTitle(title);
    if (same) draft.same = { name: same.name, title: same.title };

    // 有「生成中」的卡（/skill 出的）就填进那一张，没有就新出一张；之前没处理的作废
    const at = this.now();
    const drafting = this.list([o.conversationId]).findLast((c) => c.state === "drafting" && c.botId === o.botId);
    this.supersede(o.conversationId, drafting?.id);
    const card = this.save({
      ...(drafting ?? { id: crypto.randomUUID(), botId: o.botId, conversationId: o.conversationId, createdAt: at }),
      updatedAt: at,
      expiresAt: at + DRAFT_TTL_MS,
      state: "pending",
      draft,
    });
    this.prune();
    return card;
  }

  // —— 卡片上的操作 ——

  /** 最终写进文件的那份：编辑过的原文或拼出来的，占位换好，my- 前缀补上 */
  finalText(d: Draft): string {
    let text = applyPersonal(d.edited ?? composeSkill(d), d.personal);
    const fm = readFrontmatter(text);
    const name = typeof fm?.name === "string" ? fm.name.trim() : "";
    if (name && !name.startsWith(MY_PREFIX) && skillName(MY_PREFIX + name)) text = withFrontmatter(text, { name: MY_PREFIX + name });
    return text;
  }

  check(d: Draft): DraftCheck {
    const text = this.finalText(d);
    const fm = readFrontmatter(text);
    const name = typeof fm?.name === "string" && validMyName(fm.name);
    const description = typeof fm?.description === "string" && !!fm.description.trim() && fm.description.length <= 1024;
    const secrets = findSecrets(text).length;
    const tooLong = (fm?.body ?? text).trim().length > BODY_MAX;
    return { name, description, secrets, tooLong, ok: name && description && !secrets && !tooLong && !!fm?.body.trim() };
  }

  /** 和已有的那个比：改了几处、每处的增删 */
  diff(d: Draft): Array<{ del: string[]; add: string[] }> | undefined {
    if (!d.same) return undefined;
    try {
      return lineDiff(bodyOf(this.mine.text(d.same.name)), bodyOf(this.finalText(d)));
    } catch {
      return undefined;
    }
  }

  private editable(id: string): DraftCard {
    const c = this.get(id);
    if (!c) throw new SkillError("not_found", 404);
    return c;
  }

  /** 纠正的勾选（取消的不写进技能） */
  setCorrection(id: string, index: number, on: boolean): DraftCard {
    const c = this.editable(id);
    if (c.state !== "pending" || !c.draft || c.draft.edited || !c.draft.corrections[index]) return c;
    const corrections = c.draft.corrections.map((x, i) => (i === index ? { ...x, on } : x));
    return this.save({ ...c, draft: { ...c.draft, corrections }, updatedAt: this.now() });
  }

  /** 个人信息：保留，还是运行时再问。id 不给时一次设全部（渠道里回「保留个人信息」） */
  setPersonal(id: string, itemId: string | undefined, keep: boolean): DraftCard {
    const c = this.editable(id);
    if (c.state !== "pending" || !c.draft) return c;
    const personal = c.draft.personal.map((p) => (!itemId || p.id === itemId ? { ...p, keep } : p));
    return this.save({ ...c, draft: { ...c.draft, personal }, updatedAt: this.now() });
  }

  /**
   * 「编辑」完成：以改过的原文为准；还在原文里的个人信息保留各自的选择，手机号、邮箱、路径重新标。
   * 编辑框里是换好占位的那份（「运行时再问」的已经是 {{占位}}）：先把这些占位换回原文再存，
   * 之后照旧按卡片上的「保留 / 运行时再问」换，编辑完这两个选项还在、还能改
   */
  edit(id: string, text: string): DraftCard {
    const c = this.editable(id);
    if (c.state !== "pending" || !c.draft) return c;
    let raw = String(text ?? "").replace(/\r\n/g, "\n").slice(0, 64 * 1024);
    for (const p of c.draft.personal) if (!p.keep) raw = raw.split(`{{${p.label}}}`).join(p.text);
    const fm = readFrontmatter(raw);
    const kept = c.draft.personal.filter((p) => raw.includes(p.text));
    const added = findPersonal(raw).filter((p) => !kept.some((k) => k.text === p.text || k.text.includes(p.text)));
    const personal = uniqueLabels([...kept, ...added.map((p) => ({ id: crypto.randomUUID().slice(0, 8), text: p.text, kind: p.kind, label: askLabel(p.kind), keep: false }))]);
    const draft: Draft = {
      ...c.draft,
      edited: raw,
      personal,
      ...(typeof fm?.name === "string" ? { name: fm.name.trim() } : {}),
      ...(typeof fm?.description === "string" ? { description: fm.description.trim() } : {}),
      ...(fm?.title ? { title: fm.title } : {}),
      ...(fm?.example ? { example: fm.example } : {}),
    };
    return this.save({ ...c, draft, updatedAt: this.now() });
  }

  cancel(id: string, by: string): DraftCard {
    const c = this.editable(id);
    if (c.state !== "pending" && c.state !== "drafting") return c;
    return this.save({ ...c, state: "canceled", updatedAt: this.now(), decidedBy: by });
  }

  /** 失败后的「重试」：保存失败的照上次点的再存一次；整理失败的由界面重新发 /skill（这里不动） */
  retry(id: string, by: string): DraftCard {
    const c = this.editable(id);
    if (c.state !== "failed" || !c.draft || !c.mode) return c;
    return this.commit({ ...c, state: "pending" }, c.mode, by);
  }

  /**
   * 「保存」「更新」「另存为新技能」：写进「我的技能」，只在这个机器人上打开。
   * 名字和标题按需加序号；满 100 个时新存失败（更新不受影响）；还有密钥、名称不合规、太长时不写，卡片照旧等确认。
   */
  confirm(id: string, mode: "save" | "update" | "copy", by: string): DraftCard {
    const c = this.editable(id);
    if (c.state !== "pending" || !c.draft) return c;
    if (!this.check(c.draft).ok) return c;
    const want = mode === "update" && c.draft.same && this.mine.get(c.draft.same.name) ? "update" : mode === "update" ? "save" : mode;
    return this.commit(c, want, by);
  }

  private commit(c: DraftCard, mode: "save" | "update" | "copy", by: string): DraftCard {
    const d = c.draft!;
    this.save({ ...c, state: "saving", mode, updatedAt: this.now(), decidedBy: by });
    let next: DraftCard;
    try {
      let text = this.finalText(d);
      const fm = readFrontmatter(text)!;
      const meta = {
        title: fm.title || d.title,
        description: String(fm.description ?? d.description).trim(),
        example: fm.example || d.example,
        unverified: !!d.unfinished,
        blocked: d.blocked,
        asks: placeholdersOf(text),
        kept: d.personal.filter((p) => p.keep).length,
        apps: d.apps,
        uses: d.uses,
      };
      let skill: MySkill;
      if (mode === "update" && d.same) {
        text = withFrontmatter(text, { name: d.same.name });
        skill = this.mine.update(d.same.name, { text, meta, now: this.now() });
      } else {
        if (this.mine.list().length >= MY_SKILLS_MAX) throw new SkillError("mine_full", 409);
        let title = meta.title;
        if (mode === "copy" || this.mine.byTitle(title)) for (let n = 2; this.mine.byTitle(title); n++) title = t("mySkills.copyTitle", { title: meta.title, n });
        const base = typeof fm.name === "string" && validMyName(fm.name) ? fm.name : normalizeMyName(String(fm.name ?? d.name));
        const name = uniqueName(base, (n) => !!this.mine.get(n) || !this.o.skills.mineAvailable(c.botId, n));
        text = withFrontmatter(text, { name, ...(title !== meta.title ? { title } : {}) });
        const bot = this.o.store.getBot(c.botId);
        skill = this.mine.create({ name, text, meta: { ...meta, title }, botId: c.botId, botName: bot?.name ?? c.botId, now: this.now() });
      }
      next = { ...c, state: mode === "update" ? "updated" : "saved", mode, error: undefined, updatedAt: this.now(), decidedBy: by, result: { name: skill.name, title: skill.title, example: skill.example, mode: mode === "update" ? "updated" : "saved" } };
      log.info("skill saved from a chat", { bot: c.botId, skill: skill.name, mode, unverified: skill.unverified });
    } catch (e) {
      const code: DraftErrorCode = e instanceof SkillError && e.code === "mine_full" ? "mine_full" : "save_failed";
      if (code === "save_failed") log.warn("saving a skill failed", { message: (e as Error).message?.slice(0, 200) });
      next = { ...c, state: "failed", mode, error: { code }, updatedAt: this.now(), decidedBy: by };
    }
    this.save(next);
    if (next.result) this.o.onSaved?.([...new Set([c.botId, ...(this.mine.get(next.result.name)?.bots ?? [])])]);
    return next;
  }

  // —— 界面 ——

  view(c: DraftCard) {
    const bot = this.o.store.getBot(c.botId);
    const d = c.draft;
    const check = d && c.state === "pending" ? this.check(d) : undefined;
    const diff = d && c.state === "pending" ? this.diff(d) : undefined;
    const skill = c.result ? this.mine.get(c.result.name) : undefined;
    // 要更新的「我存的」还在别的机器人上打开着：更新后那些机器人一同生效（卡片上说明是哪些）
    const shared = d?.same && c.state === "pending" ? this.sharedBots(d.same.name, c.botId) : [];
    return {
      ...c,
      ...(shared.length ? { shared } : {}),
      botName: bot?.name ?? c.botId,
      botExists: !!bot,
      ...(check ? { check } : {}),
      ...(diff ? { diff } : {}),
      full: this.mine.list().length >= MY_SKILLS_MAX,
      ...(c.result ? { skill: skill ? { exists: true, name: skill.name, title: skill.title, example: skill.example, unverified: skill.unverified, blocked: skill.blocked, sends: skill.apps.filter((a) => a.sends).map((a) => a.name), on: skill.bots.includes(c.botId) } : { exists: false } } : {}),
    };
  }

  /** 这个「我存的」除了 botId 还在哪些机器人上打开着（名字） */
  private sharedBots(name: string, botId: string): string[] {
    return (this.mine.get(name)?.bots ?? []).filter((b) => b !== botId).map((b) => this.o.store.getBot(b)?.name ?? "").filter(Boolean);
  }

  /** 「查看技能说明 ›」：等确认时是这张草稿的全文，存好以后是存进去的那份 */
  instructions(id: string): string | undefined {
    const c = this.get(id);
    if (!c?.draft) return undefined;
    if (c.result) {
      try {
        return this.mine.text(c.result.name);
      } catch {
        return undefined;
      }
    }
    return this.finalText(c.draft);
  }

  // —— 渠道 ——

  private ready(c: DraftCard, name: string): string {
    const r = this.o.readiness?.(c.botId, name) ?? "loading";
    return t(r === "active" ? "mySkills.readyActive" : r === "waiting" ? "mySkills.readyWaiting" : "mySkills.readyLoading");
  }

  /** 卡片现在的结果的一句话（渠道的回执、处理过的卡片） */
  resultText(c: DraftCard): string {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    switch (c.state) {
      case "drafting":
        return t("mySkills.drafting");
      case "pending":
        return t("mySkills.waiting");
      case "saving":
        return t("mySkills.saving");
      case "saved":
      case "updated": {
        const r = c.result!;
        const ready = this.ready(c, r.name);
        return c.state === "saved" ? t("mySkills.saved", { bot, ready, example: r.example }) : t("mySkills.updated", { title: r.title, ready, example: r.example });
      }
      case "canceled":
        return t("mySkills.canceled");
      case "expired":
        return t(c.superseded ? "mySkills.superseded" : "mySkills.expired");
      case "failed":
        return t(c.error?.code === "mine_full" ? "mySkills.full" : c.error?.code === "draft_failed" ? "mySkills.draftFailed" : "mySkills.saveFailed");
    }
  }

  /** 发到渠道的文字版草稿：标题、什么时候用、步骤、纠正、个人信息处数，以及怎么回复 */
  promptText(c: DraftCard): string {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    const head = t("mySkills.cardTitle", { bot });
    const d = c.draft;
    if (c.state !== "pending" || !d) return `${head}\n${this.resultText(c)}`;
    const lines = [head, ""];
    if (d.unfinished) lines.push(t("mySkills.lineUnfinished", { step: d.unfinished }), "");
    lines.push(t("mySkills.lineTitle", { title: d.title, name: d.name }), t("mySkills.lineWhen", { text: d.description }));
    if (d.steps.length) lines.push(t("mySkills.lineSteps"), ...d.steps.map((s, i) => `${i + 1}. ${s}`));
    const fixes = d.corrections.filter((x) => x.on);
    if (fixes.length) lines.push(t("mySkills.lineCorrections"), ...fixes.map((x) => `- ${x.quote ? t("mySkills.lineCorrection", { quote: x.quote, rule: x.rule }) : x.rule}`));
    if (d.secrets) lines.push(t("mySkills.lineSecrets", { n: d.secrets }));
    const ask = d.personal.filter((p) => !p.keep).length;
    if (ask) lines.push(t("mySkills.linePersonal", { n: d.personal.length }));
    const check = this.check(d);
    if (check.secrets) lines.push(t("mySkills.blockedSecrets", { n: check.secrets }));
    lines.push("");
    if (d.same) lines.push(t("mySkills.lineSame", { title: d.same.title }));
    const shared = d.same ? this.sharedBots(d.same.name, c.botId) : [];
    if (shared.length) lines.push(t("skills.sharedHint", { bots: new Intl.ListFormat(currentLang()).format(shared) }));
    lines.push(t("mySkills.lineConfirm"));
    return lines.join("\n");
  }

  /** 渠道的出站操作：等确认时带按钮（飞书），其余只有文字 */
  op(c: DraftCard): Extract<OutboundOp, { type: "interactive" }> {
    const bot = this.o.store.getBot(c.botId)?.name ?? c.botId;
    const pending = c.state === "pending" && !!c.draft;
    return {
      type: "interactive",
      kind: "skill_draft",
      title: t("mySkills.cardTitle", { bot }),
      prompt: this.promptText(c),
      requestId: c.id,
      ...(pending
        ? {
            buttons: [
              { label: t(c.draft!.same ? "mySkills.buttonUpdate" : "mySkills.buttonSave"), value: { amb: "skill-draft", id: c.id, op: c.draft!.same ? "update" : "save" }, style: "primary" as const },
              { label: t("mySkills.buttonCancel"), value: { amb: "skill-draft", id: c.id, op: "cancel" } },
            ],
          }
        : {}),
    };
  }

  /**
   * 渠道里的回复：「保存」存（同一个技能时是更新）、「另存」存成新技能、「取消」放弃、「保留个人信息」全部保留。
   * 只认这个对话里最新一张等确认的卡；其余的话交给机器人（它判断是不是在改草稿）。
   */
  handleReply(conversationId: string, text: string, by: string): ReplyResult {
    const c = this.pendingIn(conversationId);
    if (!c?.draft) return { handled: false };
    // 有审批、提问在等：「取消」这类回复先给它们
    if (this.o.store.listApprovals({ status: "pending", conversationId, limit: 1 }).length) return { handled: false };
    const said = norm(text);
    if (!said || said.length > 40) return { handled: false };
    if (words("mySkills.wordKeep").includes(said)) {
      const next = this.setPersonal(c.id, undefined, true);
      return { handled: true, ack: t("mySkills.keptPersonal", { n: next.draft?.personal.length ?? 0 }) };
    }
    if (words("mySkills.wordCancel").includes(said)) return { handled: true, ack: this.resultText(this.cancel(c.id, by)) };
    const copy = words("mySkills.wordCopy").includes(said);
    if (copy || words("mySkills.wordSave").includes(said)) {
      const check = this.check(c.draft);
      if (check.secrets) return { handled: true, ack: t("mySkills.blockedSecrets", { n: check.secrets }) };
      if (!check.name) return { handled: true, ack: t("mySkills.badName") };
      if (!check.description) return { handled: true, ack: t("mySkills.badDescription") };
      if (check.tooLong) return { handled: true, ack: t("mySkills.tooLong") };
      const done = this.confirm(c.id, copy ? "copy" : c.draft.same ? "update" : "save", by);
      return { handled: true, ack: this.resultText(done) };
    }
    return { handled: false };
  }

  /** 飞书卡片按钮 */
  cardAction(botId: string, value: Record<string, string>, by: string): { toast: string; ok: boolean } {
    const c = value?.id ? this.get(String(value.id)) : undefined;
    const owner = c && (this.o.store.getConversation(c.conversationId)?.account || c.botId);
    if (!c || owner !== botId) return { toast: t("mySkills.cardMissing"), ok: false };
    if (c.state !== "pending") return { toast: this.resultText(c), ok: false };
    const done = value.op === "cancel" ? this.cancel(c.id, by) : this.confirm(c.id, value.op === "update" ? "update" : "save", by);
    if (done.state === "pending" && done.draft) {
      const check = this.check(done.draft);
      return { toast: check.secrets ? t("mySkills.blockedSecrets", { n: check.secrets }) : !check.name ? t("mySkills.badName") : !check.description ? t("mySkills.badDescription") : t("mySkills.tooLong"), ok: false };
    }
    return { toast: this.resultText(done), ok: ["saved", "updated", "canceled"].includes(done.state) };
  }
}
