import fs from "node:fs";
import path from "node:path";
import { t, tl, lang, type Lang } from "../i18n/index.js";

/**
 * 三层长期记忆（机器人 / 群 / 团队），Markdown 存储：
 *   <data>/memory/bots/<botId>/MEMORY.md + topics/<topic>.md
 *   <data>/memory/groups/<groupKey>/…
 *   <data>/memory/team/…
 *   <data>/memory/journal.jsonl   每次变更一行（谁、何时、哪个文件、增/删了哪一行）
 *
 * 设计参考 DS Bot（Apache-2.0，Copyright 2026 Fei2411 and the DS Bot contributors）的
 * docs/plans/2026-10-09-context-and-memory.md；秘密检测的模式移植自 ds-bot/src/host/memory.js。
 * 其余为本项目自行实现。数据目录对代理的 bash/文件工具不可见，记忆只能经 remember/forget/recall 工具读写。
 */

export const ENTRY_MAX = 300;
export const MEMORY_MAX = 4000;
export const TOPIC_MAX = 16000;
export const TOPICS_MAX = 40;

export type ScopeKind = "bot" | "group" | "team";
export interface Scope {
  kind: ScopeKind;
  /** bot：botId；group：群键；team：空 */
  id: string;
}

export interface Entry {
  text: string;
  meta: string;
  line: string;
}

export class MemoryError extends Error {}

/** 记忆操作的回执与报错：回给代理（工具结果），也显示在界面的记忆页（删除），按当前语言。remember 里的局部变量 t 会遮住 t()，所以起个别名 */
const msg: typeof t = (key, params) => t(key, params);

// ---------- 秘密检测（模式移植自 DS Bot ds-bot/src/host/memory.js，Apache-2.0） ----------
const KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
];
const PASSWORD_GIVEN =
  /(?:密码(?!管理|策略|规则)|口令|验证码|校验码|\bpassw(?:or)?d\b(?!\s*(?:managers?|polic(?:y|ies)|rules?|resets?|strength|less)\b)|\bpwd\b|\bpin(?: code)?\b|\bpass(?:code|phrase)\b|\b(?:otp|cvv|cvc)\b|\b(?:security|verification) code\b|\b(?:api[_ -]?key|secret|token)\b)[^\n.。;；,，]{0,40}?(?:是|(?<![因作认成以行])为|还是|改成|改为|换成|设为|设成|叫|:|：|=|\b(?:is|are|was|becomes)\b|\b(?:set|changed) to\b)\s*\S/i;
const PASSWORD_AFTER = /用(?![户于来途])[^\n,，。;；]{1,40}?(?:当作?|作为?|做)\s*\S{0,6}?(?:密码(?!管理)|口令|验证码)/;
const ID_GIVEN =
  /(?:\bssn\b|\bpassport\b|\bid (?:card|number)\b|护照|身份证|社保|税号|驾驶证|驾照)[^\n.。;；,，]{0,30}?(?<![A-Za-z0-9-])(?!\d{4}-\d{1,2}-\d{1,2}(?!\d))[a-z]{0,2}\d[\d -]{4,}\d/i;

export function looksSecret(text: string): boolean {
  if (KEY_PATTERNS.some((p) => p.test(text))) return true;
  const bare = text.replace(/\bhttps?:\/\/\S+/g, " ");
  if ((bare.match(/[A-Za-z0-9+=]{32,}/g) ?? []).some((r) => /[a-z]/.test(r) && /[A-Z]/.test(r) && /\d/.test(r))) return true;
  if (PASSWORD_GIVEN.test(text) || PASSWORD_AFTER.test(text) || ID_GIVEN.test(text)) return true;
  return /\d{15,}/.test(bare.replace(/(?<=\d) (?=\d)/g, "").replace(/(?<=\d{3})-(?=\d{3})/g, ""));
}

// ---------- 格式 ----------
const META_RE = /\s*\[(source:[^\]]*)\]\s*$/;
const INDEX_RE = /^##\s+index\s*$/i;

export function parseEntries(md: string): Entry[] {
  const out: Entry[] = [];
  for (const line of md.split("\n")) {
    if (INDEX_RE.test(line.trim())) break;
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!m) continue;
    const meta = META_RE.exec(m[1]);
    out.push({ text: (meta ? m[1].slice(0, meta.index) : m[1]).trim(), meta: meta ? meta[1] : "", line });
  }
  return out;
}

export function validTopic(topic: string): string {
  const s = topic.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(s)) throw new MemoryError(msg("agent.memTopicInvalid", { topic }));
  if (s === "memory" || s === "index") throw new MemoryError(msg("agent.memTopicReserved", { topic }));
  return s;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 作用域名称：默认按当前语言（界面的记忆页、记忆操作的回执）。
 * 写进 MEMORY.md 的标题和给模型的快照 / 检索结果固定用中文（FILE_LANG）：文件内容与提示前缀不随界面语言变。
 */
export function scopeLabel(s: Scope, l: Lang = lang()): string {
  return tl(l, s.kind === "team" ? "agent.scopeTeam" : s.kind === "group" ? "agent.scopeGroup" : "agent.scopeBot");
}
const FILE_LANG: Lang = "zh-CN";

function safeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9@._-]/g, "_").slice(0, 120) || "_";
}

export interface JournalLine {
  at: number;
  scope: string;
  file: string;
  op: "add" | "remove";
  text: string;
  by: string;
}

export class MemoryStore {
  constructor(readonly root: string) {}

  dir(s: Scope): string {
    if (s.kind === "team") return path.join(this.root, "team");
    return path.join(this.root, s.kind === "bot" ? "bots" : "groups", safeKey(s.id));
  }

  private file(s: Scope, topic?: string): string {
    return topic ? path.join(this.dir(s), "topics", `${topic}.md`) : path.join(this.dir(s), "MEMORY.md");
  }

  private read(f: string): string {
    try {
      return fs.readFileSync(f, "utf8");
    } catch {
      return "";
    }
  }

  private write(f: string, text: string): void {
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, f);
  }

  private journal(j: Omit<JournalLine, "at">): void {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(this.root, "journal.jsonl"), JSON.stringify({ at: Date.now(), ...j }) + "\n", { mode: 0o600 });
  }

  topics(s: Scope): string[] {
    try {
      return fs
        .readdirSync(path.join(this.dir(s), "topics"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3))
        .sort();
    } catch {
      return [];
    }
  }

  entries(s: Scope, topic?: string): Entry[] {
    return parseEntries(this.read(this.file(s, topic)));
  }

  /** MEMORY.md 全文（含索引）；没有则空串。 */
  main(s: Scope): string {
    return this.read(this.file(s));
  }

  topicText(s: Scope, topic: string): string {
    return this.read(this.file(s, validTopic(topic)));
  }

  private render(s: Scope, entries: Entry[], topic?: string): string {
    const lines = entries.map((e) => `- ${e.text}${e.meta ? ` [${e.meta}]` : ""}`);
    if (topic) return [`# ${topic}`, "", ...lines, ""].join("\n");
    const topics = this.topics(s);
    const idx = topics.length ? ["", "## Index", "", ...topics.map((t) => `- [[${t}]] — ${this.entries(s, t).length} 条`)] : [];
    return [`# ${scopeLabel(s, FILE_LANG)}`, "", ...lines, ...idx, ""].join("\n");
  }

  remember(s: Scope, text: string, opts: { topic?: string; source: string; by?: string }): string {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) throw new MemoryError(msg("agent.memEmpty"));
    if (t.length > ENTRY_MAX) throw new MemoryError(msg("agent.memTooLong", { max: ENTRY_MAX, n: t.length }));
    if (looksSecret(t)) throw new MemoryError(msg("agent.memSecret"));
    const topic = opts.topic ? validTopic(opts.topic) : undefined;
    if (topic && !this.topics(s).includes(topic) && this.topics(s).length >= TOPICS_MAX) throw new MemoryError(msg("agent.memTopicsFull", { max: TOPICS_MAX }));
    const list = this.entries(s, topic);
    if (list.some((e) => squash(e.text) === squash(t))) return msg("agent.memDuplicate");
    const entry: Entry = { text: t, meta: `source: ${opts.source.replace(/[\];]/g, "")}; added: ${today()}`, line: "" };
    const next = this.render(s, [...list, entry], topic);
    const cap = topic ? TOPIC_MAX : MEMORY_MAX;
    if (next.length > cap)
      throw new MemoryError(topic ? msg("agent.memTopicFull", { topic, cap }) : msg("agent.memMainFull", { cap }));
    this.write(this.file(s, topic), next);
    if (topic) this.write(this.file(s), this.render(s, this.entries(s)));
    this.journal({ scope: this.key(s), file: topic ?? "MEMORY", op: "add", text: t, by: opts.by ?? opts.source });
    return msg("agent.memRemembered", { where: `${scopeLabel(s)}${topic ? ` · ${topic}` : ""}` });
  }

  /** 按内容片段删除；多条匹配且未指定 all 时报错并列出候选。 */
  forget(s: Scope, match: string, opts: { topic?: string; all?: boolean; by: string }): string {
    const key = squash(match);
    if (!key) throw new MemoryError(msg("agent.memForgetEmpty"));
    const topics = opts.topic ? [validTopic(opts.topic)] : [undefined, ...this.topics(s)];
    const hits: Array<{ topic?: string; e: Entry }> = [];
    for (const t of topics) for (const e of this.entries(s, t)) if (squash(e.text).includes(key)) hits.push({ topic: t, e });
    if (!hits.length) throw new MemoryError(msg("agent.memForgetNone", { scope: scopeLabel(s), match }));
    const exact = hits.filter((h) => squash(h.e.text) === key);
    const chosen = exact.length === 1 ? exact : hits;
    if (chosen.length > 1 && !opts.all)
      throw new MemoryError(
        msg("agent.memForgetMany", { count: chosen.length, list: chosen.map((h) => `- ${h.e.text}${h.topic ? msg("agent.memInTopic", { topic: h.topic }) : ""}`).join("\n") }),
      );
    const byTopic = new Map<string | undefined, Entry[]>();
    for (const h of chosen) byTopic.set(h.topic, [...(byTopic.get(h.topic) ?? []), h.e]);
    for (const [t, gone] of byTopic) {
      const keep = this.entries(s, t).filter((e) => !gone.some((g) => g.text === e.text));
      if (t && keep.length === 0) fs.rmSync(this.file(s, t), { force: true });
      else this.write(this.file(s, t), this.render(s, keep, t));
      for (const g of gone) this.journal({ scope: this.key(s), file: t ?? "MEMORY", op: "remove", text: g.text, by: opts.by });
    }
    this.write(this.file(s), this.render(s, this.entries(s)));
    return msg("agent.memForgotten", { count: chosen.length, scope: scopeLabel(s) });
  }

  /** 检索：所有关键词都出现的条目（不区分大小写）；中文无空格时按整串匹配。 */
  search(scopes: Scope[], query: string, limit = 30): string[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out: string[] = [];
    for (const s of scopes) {
      for (const t of [undefined, ...this.topics(s)]) {
        for (const e of this.entries(s, t)) {
          const hay = e.text.toLowerCase();
          if (terms.every((w) => hay.includes(w))) out.push(`[${scopeLabel(s, FILE_LANG)}${t ? ` · ${t}` : ""}] ${e.text}`);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  /** 冻结快照：会话（段）开始时注入一次，之后整段不变以复用提示缓存。团队 → 机器人 → 群（群放最后）。 */
  snapshot(scopes: Scope[]): string {
    const parts: string[] = [];
    for (const s of scopes) {
      const es = this.entries(s);
      const ts = this.topics(s);
      if (!es.length && !ts.length) continue;
      parts.push(`## ${scopeLabel(s, FILE_LANG)}`, ...es.map((e) => `- ${e.text}`));
      if (ts.length) parts.push(`（主题，用 recall 读取：${ts.join("、")}）`);
      parts.push("");
    }
    return parts.join("\n").trim();
  }

  journalTail(n = 50): JournalLine[] {
    const text = this.read(path.join(this.root, "journal.jsonl"));
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l) as JournalLine;
        } catch {
          return undefined;
        }
      })
      .filter((x): x is JournalLine => !!x);
  }

  key(s: Scope): string {
    return s.kind === "team" ? "team" : `${s.kind}:${s.id}`;
  }
}
