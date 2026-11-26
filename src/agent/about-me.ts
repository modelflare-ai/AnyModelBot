import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENTRY_MAX, looksSecret, type MemoryStore } from "./memory.js";

/**
 * 关于我：所有机器人共用的、关于用户本人的事（由「团队记忆」改名而来，PRD 2026-11-15 R1–R4）。
 * 存在 <data>/memory/about-me.json，不依赖登录和模型来源。
 *
 * - 每条是一句自然的话；来源：机器人从对话里记下（chat）、用户自己写或改过（you，带锁，机器人不能直接改）、原团队记忆（team）。
 * - 每次变更进变更历史（保留 30 天），还在、且这句还保持着那次变更后的样子时可以撤销：撤销「记下」= 删掉（之后仍可再记），
 *   撤销「改」= 恢复原句，撤销「删除」= 恢复这句并解除「不再记回」。
 * - 用户删掉的（页面上删、或在对话里说「忘掉」）进「不再记回」名单：机器人再听到同样内容不自动记，用户亲口明确再说才重新记。
 *   名单只在这里用，不给模型看（判断是不是同一件事由调用方用小模型做，见 judge）。
 * - 地址、电话、邮箱先问（确认卡「记下 / 只这次用」）；证件号、银行卡号和密码类不存。
 * - 机器人想改用户改过的句子：只出建议卡「改成这样 / 保持不变」。
 */

export const ABOUT_ME_FILE = "about-me.json";
/** 机器人新记时整份的上限（字）；搬迁进来的和用户自己写的不受它限制 */
export const ABOUT_ME_MAX = 4000;
/** 一次回复最多记几句 */
export const PER_TURN = 3;
/** 变更历史保留多久 */
export const HISTORY_MS = 30 * 86400_000;

export type AboutSource = "chat" | "you" | "team";
/** 先问的三类（证件号、银行卡号不存） */
export type Sensitive = "address" | "phone" | "email";

export interface LineState {
  text: string;
  source: AboutSource;
  locked: boolean;
  botId?: string;
  botName?: string;
  sensitive?: Sensitive;
  createdAt: number;
  updatedAt: number;
}

export interface AboutLine extends LineState {
  id: string;
}

export interface AboutChange {
  id: string;
  at: number;
  op: "add" | "edit" | "delete";
  lineId: string;
  before?: LineState;
  after?: LineState;
  by: "you" | "bot";
  botId?: string;
  botName?: string;
  /** 在哪个对话里（对话里的提示行按它找） */
  conversationId?: string;
  /** 这次变更被撤销的时间 */
  undoneAt?: number;
  /** 这一条是撤销哪一条变更产生的（自己不能再撤销） */
  undoOf?: string;
}

export interface AboutProposal {
  id: string;
  kind: "sensitive" | "change";
  conversationId: string;
  /** 代理会话（「同一段对话里不再问」按它算） */
  session: string;
  botId: string;
  botName: string;
  text: string;
  category?: Sensitive;
  /** 要改的那一句（change；sensitive 时是被替换的那句，可以没有） */
  lineId?: string;
  old?: string;
  status: "pending" | "added" | "once" | "changed" | "kept" | "stale";
  at: number;
  decidedAt?: number;
  changeId?: string;
}

interface Suppressed {
  lineId: string;
  text: string;
  at: number;
}

interface State {
  v: 1;
  /** 允许机器人记到这里 */
  enabled: boolean;
  /** 搬迁提示还没关 */
  notice: boolean;
  migratedAt: number;
  /** 每次变更加一：已开着的对话按它判断要不要带上新内容 */
  seq: number;
  lines: AboutLine[];
  history: AboutChange[];
  suppressed: Suppressed[];
  proposals: AboutProposal[];
}

export class AboutMeError extends Error {
  constructor(
    readonly code: "empty" | "tooLong" | "secret" | "idOrCard" | "missing" | "stale" | "notUndoable",
    message = code,
  ) {
    super(message);
  }
}

const hex = (n: number) => crypto.randomBytes(n).toString("hex");
const squash = (s: string) => s.replace(/İ/g, "I").toLowerCase().replace(/[\s，。,.!！?？；;：:、"'“”‘’「」]/g, "");
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------- 识别 ----------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<![\d.])(?:\+?\d{1,3}[\s-]?)?(?:1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}|\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})(?![\d.])/;
const PHONE_WORD = /(电话|手机|手機|座[机機]|市話|聯絡方式|联系方式|phone|mobile|cell|tel\b|telefone|teléfono|celular|電話|携帯|전화|휴대폰|телефон)/i;
const CN_MOBILE = /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/;
/** 门牌：数字 + 号 / 弄 / 栋 / 室…（中文），丁目、番地（日文），번지、호（韩文） */
const ADDR_NUMBER = /\d+\s*(号|號|弄|栋|棟|幢|室|单元|單元|号楼|丁目|番地|番|번지|호|동)/;
const ADDR_ROAD = /(路|街|道|巷|弄|胡同|大道|村|镇|鎮|区|區|县|縣|小区|社区|花园|公寓|大厦|町|丁目|로|길)/;
const ADDR_EN = /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,4}(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|drive|dr|way|court|ct|place|pl|rua|calle|avenida|av)\b\.?/i;
const ADDR_WORD = /(地址|住址|收件|寄到|address|endereço|dirección|住所|주소|адрес)/i;
/** 证件号、银行卡号（不存）：关键词，或 15 位以上的一串数字（中国身份证、银行卡） */
const ID_WORD = /(身[份分][证證]|[护護]照|[驾駕]照|[驾駕][驶駛][证證]|社保|[税稅][号號]|[证證]件[号號]|[银銀]行卡|卡[号號]|信用卡|借[记記]卡|金融卡|passport|\bssn\b|\bid (?:card|number)\b|card number|credit card|debit card|bank card|マイナンバー|パスポート|カード番号|주민등록|여권|카드번호|паспорт|номер карты|cpf|rg\b|dni|tarjeta|cartão)/i;

function longDigits(text: string): boolean {
  const s = text.replace(/(?<=\d)[\s-](?=\d)/g, "");
  return /\d{12,}/.test(s) || /\d{17}[\dXx]/.test(s);
}

/** 证件号、银行卡号：不存进关于我（这次对话里可以用） */
export function isIdOrCard(text: string): boolean {
  return longDigits(text) || (ID_WORD.test(text) && /\d{4,}/.test(text));
}

/** 地址、电话、邮箱：先问用户 */
export function sensitiveKind(text: string): Sensitive | undefined {
  if (EMAIL.test(text)) return "email";
  if (CN_MOBILE.test(text) || (PHONE_WORD.test(text) && PHONE.test(text))) return "phone";
  if ((ADDR_NUMBER.test(text) && ADDR_ROAD.test(text)) || ADDR_EN.test(text) || (ADDR_WORD.test(text) && /\d/.test(text) && ADDR_ROAD.test(text))) return "address";
  return undefined;
}

/** 密码、密钥、令牌、验证码（不存，也不问） */
export function isPasswordLike(text: string): boolean {
  return looksSecret(text) && !isIdOrCard(text);
}

// ---------- 结果 ----------

/** 机器人记一句的结果（manager 把它翻成给模型的那句话） */
export type BotAddResult =
  | { kind: "added"; change: AboutChange }
  | { kind: "edited"; change: AboutChange }
  | { kind: "duplicate" }
  | { kind: "off" }
  | { kind: "secret" }
  | { kind: "idOrCard" }
  | { kind: "full" }
  | { kind: "perTurn" }
  | { kind: "suppressed" }
  | { kind: "tooLong" }
  | { kind: "empty" }
  | { kind: "noTarget"; candidates: string[] }
  | { kind: "sensitive"; proposal: AboutProposal }
  /** 聊天软件里：不出确认卡，只这次用 */
  | { kind: "sensitiveOnce"; category: Sensitive }
  | { kind: "sensitiveAsked" }
  | { kind: "locked"; proposal?: AboutProposal; asked?: boolean; line: AboutLine };

export type BotForgetResult =
  | { kind: "deleted"; change: AboutChange }
  | { kind: "off" }
  | { kind: "none" }
  | { kind: "many"; candidates: string[] };

export interface BotContext {
  botId: string;
  botName: string;
  conversationId: string;
  /** 代理会话 id（同一段对话里不再问同一件事） */
  session: string;
  /** 这一轮开始的时间（一次回复最多记 3 句） */
  turnSince: number;
  /** 用户这一轮亲口明确说了「记住……」：用户删掉过的也能重新记 */
  explicit: boolean;
  /** 能出确认卡、建议卡（应用里的对话）；聊天软件里不能 */
  cards: boolean;
  /** 「不再记回」：新句子和这些是不是同一件事（小模型判断）；返回命中的下标，-1 = 不是 */
  judge?: (text: string, candidates: string[]) => Promise<number>;
}

export class AboutMe {
  private state: State | undefined;
  private readonly file: string;
  private listeners = new Set<() => void>();

  constructor(
    readonly root: string,
    private now: () => number = Date.now,
  ) {
    this.file = path.join(root, ABOUT_ME_FILE);
  }

  // ---------- 存取 ----------

  private load(): State {
    if (this.state) return this.state;
    let s: State | undefined;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<State>;
      if (raw && raw.v === 1) {
        s = {
          v: 1,
          enabled: raw.enabled !== false,
          notice: !!raw.notice,
          migratedAt: Number(raw.migratedAt) || 0,
          seq: Number(raw.seq) || 0,
          lines: Array.isArray(raw.lines) ? raw.lines : [],
          history: Array.isArray(raw.history) ? raw.history : [],
          suppressed: Array.isArray(raw.suppressed) ? raw.suppressed : [],
          proposals: Array.isArray(raw.proposals) ? raw.proposals : [],
        };
      }
    } catch {
      /* 还没有 */
    }
    this.state = s ?? { v: 1, enabled: true, notice: false, migratedAt: 0, seq: 0, lines: [], history: [], suppressed: [], proposals: [] };
    return this.state;
  }

  private save(changed = true): void {
    const s = this.load();
    if (changed) s.seq++;
    const cutoff = this.now() - HISTORY_MS;
    s.history = s.history.filter((h) => h.at >= cutoff);
    s.proposals = s.proposals.filter((p) => p.at >= cutoff);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    if (changed) for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }

  /** 有变化（界面刷新、已开着的对话下一条带上新内容） */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 升级迁移（一次）：原来团队记忆里的条目（主文件和各主题）原样搬进来，来源标「原团队记忆」，不算用户改过；
   * 有条目时页面顶部提示一次。原文件留着不动，之后不再读。
   */
  migrate(memory: MemoryStore): number {
    const s = this.load();
    if (s.migratedAt) return 0;
    const scope = { kind: "team" as const, id: "" };
    let n = 0;
    let mtime = this.now();
    try {
      mtime = fs.statSync(path.join(memory.dir(scope), "MEMORY.md")).mtimeMs;
    } catch {
      /* 没有团队记忆 */
    }
    for (const topic of [undefined, ...memory.topics(scope)]) {
      for (const e of memory.entries(scope, topic)) {
        const text = tidy(e.text);
        if (!text || s.lines.some((l) => squash(l.text) === squash(text))) continue;
        const added = /added:\s*(\d{4}-\d{2}-\d{2})/.exec(e.meta)?.[1];
        // 只记了日期：按那天的 0 点算，不晚于文件最后修改的时间（不显示成将来的时间）
        const at = Math.min(added ? Date.parse(`${added}T00:00:00`) || mtime : mtime, mtime, this.now());
        s.lines.push({ id: `l_${hex(5)}`, text, source: "team", locked: false, createdAt: at, updatedAt: at });
        n++;
      }
    }
    s.migratedAt = this.now();
    s.notice = n > 0;
    this.save(n > 0);
    return n;
  }

  // ---------- 读 ----------

  get enabled(): boolean {
    return this.load().enabled;
  }

  get seq(): number {
    return this.load().seq;
  }

  get notice(): boolean {
    return this.load().notice;
  }

  /** 按最近修改时间倒序 */
  lines(): AboutLine[] {
    return [...this.load().lines].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  line(id: string): AboutLine | undefined {
    return this.load().lines.find((l) => l.id === id);
  }

  /** 30 天内的变更，新的在前；undoable：现在还能撤销 */
  history(): Array<AboutChange & { undoable: boolean }> {
    const s = this.load();
    const cutoff = this.now() - HISTORY_MS;
    return s.history
      .filter((h) => h.at >= cutoff)
      .sort((a, b) => b.at - a.at)
      .map((h) => ({ ...h, undoable: this.canUndo(h) }));
  }

  /** 这个对话里机器人做的变更和出的卡（对话里的提示行、确认卡、建议卡） */
  forConversation(conversationId: string, since = 0): { changes: Array<AboutChange & { undoable: boolean }>; proposals: AboutProposal[] } {
    const s = this.load();
    return {
      changes: s.history.filter((h) => h.conversationId === conversationId && h.at >= since && (h.by === "bot" || !!h.undoOf || this.fromProposal(h))).map((h) => ({ ...h, undoable: this.canUndo(h) })),
      proposals: s.proposals.filter((p) => p.conversationId === conversationId && p.at >= since),
    };
  }

  private fromProposal(h: AboutChange): boolean {
    return this.load().proposals.some((p) => p.changeId === h.id);
  }

  /** 给模型看的：每段对话开头、recall、已开着的对话里有更新时 */
  text(): string {
    const lines = this.lines();
    return lines.length ? lines.map((l) => `- ${l.text}`).join("\n") : "";
  }

  search(query: string): string[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return this.lines()
      .filter((l) => terms.every((w) => l.text.toLowerCase().includes(w)))
      .map((l) => l.text);
  }

  private size(lines: AboutLine[]): number {
    return lines.reduce((n, l) => n + l.text.length + 3, 0);
  }

  /** 超过了机器人新记的上限（搬进来的或自己写的多了）：页面上建议删掉项目相关的 */
  get full(): boolean {
    return this.size(this.load().lines) > ABOUT_ME_MAX;
  }

  // ---------- 撤销 ----------

  private same(a: LineState | undefined, b: AboutLine | undefined): boolean {
    return !!a && !!b && a.text === b.text && a.locked === b.locked;
  }

  /** 还能撤销：没撤销过、不是撤销产生的，而且这一句还保持着那次变更后的样子 */
  canUndo(h: AboutChange): boolean {
    if (h.undoneAt || h.undoOf || h.at < this.now() - HISTORY_MS) return false;
    const line = this.line(h.lineId);
    if (h.op === "delete") return !line;
    return this.same(h.after, line);
  }

  undo(changeId: string, by: "you" | "bot" = "you", conversationId?: string): AboutChange {
    const s = this.load();
    const h = s.history.find((x) => x.id === changeId);
    if (!h) throw new AboutMeError("missing");
    if (!this.canUndo(h)) throw new AboutMeError("notUndoable");
    const now = this.now();
    const line = this.line(h.lineId);
    let change: AboutChange;
    if (h.op === "add") {
      // 撤销「记下」= 删掉这句；不进「不再记回」，之后仍可再记
      s.lines = s.lines.filter((l) => l.id !== h.lineId);
      change = { id: `c_${hex(5)}`, at: now, op: "delete", lineId: h.lineId, before: line && stateOf(line), by, undoOf: h.id, conversationId: conversationId ?? h.conversationId };
    } else if (h.op === "edit") {
      const before = h.before!;
      const restored: AboutLine = { ...line!, ...before, id: h.lineId, updatedAt: now };
      s.lines = s.lines.map((l) => (l.id === h.lineId ? restored : l));
      change = { id: `c_${hex(5)}`, at: now, op: "edit", lineId: h.lineId, before: line && stateOf(line), after: stateOf(restored), by, undoOf: h.id, conversationId: conversationId ?? h.conversationId };
    } else {
      // 撤销「删除」= 恢复这句，并解除「不再记回」
      const restored: AboutLine = { ...h.before!, id: h.lineId, updatedAt: now };
      s.lines.push(restored);
      s.suppressed = s.suppressed.filter((x) => x.lineId !== h.lineId);
      change = { id: `c_${hex(5)}`, at: now, op: "add", lineId: h.lineId, after: stateOf(restored), by, undoOf: h.id, conversationId: conversationId ?? h.conversationId };
    }
    h.undoneAt = now;
    s.history.push(change);
    this.save();
    return change;
  }

  // ---------- 用户在页面上 ----------

  private check(text: string): string {
    const t = tidy(text);
    if (!t) throw new AboutMeError("empty");
    if (t.length > ENTRY_MAX) throw new AboutMeError("tooLong");
    if (isIdOrCard(t)) throw new AboutMeError("idOrCard");
    if (looksSecret(t)) throw new AboutMeError("secret");
    return t;
  }

  /** ＋ 自己写一句：算你改过（带锁）；地址、电话、邮箱直接保存，不出确认卡 */
  userAdd(text: string): AboutChange {
    const t = this.check(text);
    const s = this.load();
    const now = this.now();
    const dup = s.lines.find((l) => squash(l.text) === squash(t));
    if (dup) return this.userEdit(dup.id, t);
    const line: AboutLine = { id: `l_${hex(5)}`, text: t, source: "you", locked: true, sensitive: sensitiveKind(t), createdAt: now, updatedAt: now };
    s.lines.push(line);
    // 自己写回来的，不再算「不再记回」
    s.suppressed = s.suppressed.filter((x) => squash(x.text) !== squash(t));
    const change: AboutChange = { id: `c_${hex(5)}`, at: now, op: "add", lineId: line.id, after: stateOf(line), by: "you" };
    s.history.push(change);
    this.save();
    return change;
  }

  userEdit(id: string, text: string): AboutChange {
    const t = this.check(text);
    const s = this.load();
    const line = s.lines.find((l) => l.id === id);
    if (!line) throw new AboutMeError("missing");
    const now = this.now();
    const next: AboutLine = { ...line, text: t, source: "you", locked: true, sensitive: sensitiveKind(t), updatedAt: now };
    s.lines = s.lines.map((l) => (l.id === id ? next : l));
    const change: AboutChange = { id: `c_${hex(5)}`, at: now, op: "edit", lineId: id, before: stateOf(line), after: stateOf(next), by: "you" };
    s.history.push(change);
    this.save();
    return change;
  }

  /** 删掉：之后机器人不会再把它记回来（用户亲口再说才重新记） */
  userDelete(id: string): AboutChange {
    const s = this.load();
    const line = s.lines.find((l) => l.id === id);
    if (!line) throw new AboutMeError("missing");
    return this.remove(line, { by: "you" });
  }

  private remove(line: AboutLine, o: { by: "you" | "bot"; botId?: string; botName?: string; conversationId?: string }): AboutChange {
    const s = this.load();
    const now = this.now();
    s.lines = s.lines.filter((l) => l.id !== line.id);
    s.suppressed = [...s.suppressed.filter((x) => x.lineId !== line.id), { lineId: line.id, text: line.text, at: now }].slice(-200);
    const change: AboutChange = { id: `c_${hex(5)}`, at: now, op: "delete", lineId: line.id, before: stateOf(line), by: o.by, ...(o.botId ? { botId: o.botId, botName: o.botName } : {}), ...(o.conversationId ? { conversationId: o.conversationId } : {}) };
    s.history.push(change);
    this.save();
    return change;
  }

  setEnabled(on: boolean): void {
    const s = this.load();
    if (s.enabled === on) return;
    s.enabled = on;
    this.save(false);
    for (const fn of this.listeners) fn();
  }

  dismissNotice(): void {
    const s = this.load();
    if (!s.notice) return;
    s.notice = false;
    this.save(false);
  }

  // ---------- 机器人在对话里 ----------

  /** 这一轮机器人已经记了几句 */
  private turnCount(c: BotContext): number {
    return this.load().history.filter((h) => h.by === "bot" && h.conversationId === c.conversationId && h.at >= c.turnSince && h.op !== "delete").length
      + this.load().proposals.filter((p) => p.conversationId === c.conversationId && p.at >= c.turnSince).length;
  }

  /** 按片段找一句（先全等，再包含） */
  private find(match: string): { line?: AboutLine; candidates: AboutLine[] } {
    const key = squash(match);
    if (!key) return { candidates: [] };
    const lines = this.load().lines;
    const exact = lines.filter((l) => squash(l.text) === key);
    if (exact.length === 1) return { line: exact[0], candidates: exact };
    const hits = lines.filter((l) => squash(l.text).includes(key) || key.includes(squash(l.text)));
    return hits.length === 1 ? { line: hits[0], candidates: hits } : { candidates: hits };
  }

  /**
   * 机器人记下一句（replaces：要替换的旧句片段，新事实和旧句冲突时以最新为准）。
   * 敏感（地址、电话、邮箱）先出确认卡；旧句是用户改过的只出建议卡；用户删掉的不自动记回。
   */
  async botAdd(text: string, c: BotContext, replaces?: string): Promise<BotAddResult> {
    const s = this.load();
    if (!s.enabled) return { kind: "off" };
    const t = tidy(text);
    if (!t) return { kind: "empty" };
    if (t.length > ENTRY_MAX) return { kind: "tooLong" };
    if (isIdOrCard(t)) return { kind: "idOrCard" };
    if (looksSecret(t)) return { kind: "secret" };
    let target: AboutLine | undefined;
    if (replaces?.trim()) {
      const f = this.find(replaces);
      if (!f.line) return { kind: "noTarget", candidates: f.candidates.map((l) => l.text) };
      target = f.line;
      if (squash(target.text) === squash(t)) return { kind: "duplicate" };
    } else if (s.lines.some((l) => squash(l.text) === squash(t))) return { kind: "duplicate" };
    if (this.turnCount(c) >= PER_TURN) return { kind: "perTurn" };
    // 用户删掉过的：亲口明确再说才记
    if (!c.explicit && s.suppressed.length) {
      const exact = s.suppressed.some((x) => squash(x.text) === squash(t));
      let hit = exact;
      if (!hit && c.judge) {
        const recent = s.suppressed.slice(-40);
        hit = (await c.judge(t, recent.map((x) => x.text)).catch(() => -1)) >= 0;
      }
      if (hit) return { kind: "suppressed" };
    }
    const sensitive = sensitiveKind(t);
    if (target?.locked) {
      if (!c.cards) return { kind: "locked", line: target };
      // 同一段对话里不再为同一句出建议卡
      const asked = s.proposals.find((p) => p.kind === "change" && p.lineId === target!.id && p.session === c.session);
      if (asked) return { kind: "locked", asked: true, line: target };
      const proposal = this.propose({ kind: "change", text: t, lineId: target.id, old: target.text, category: sensitive }, c);
      return { kind: "locked", proposal, line: target };
    }
    if (sensitive || target?.sensitive) {
      if (!c.cards) return { kind: "sensitiveOnce", category: (sensitive ?? target?.sensitive)! };
      const asked = s.proposals.find((p) => p.kind === "sensitive" && p.session === c.session && squash(p.text) === squash(t));
      if (asked) return { kind: "sensitiveAsked" };
      const proposal = this.propose({ kind: "sensitive", text: t, category: sensitive ?? target?.sensitive, ...(target ? { lineId: target.id, old: target.text } : {}) }, c);
      return { kind: "sensitive", proposal };
    }
    if (!target && this.size(s.lines) + t.length + 3 > ABOUT_ME_MAX) return { kind: "full" };
    if (c.explicit) s.suppressed = s.suppressed.filter((x) => squash(x.text) !== squash(t));
    const now = this.now();
    if (target) {
      const next: AboutLine = { ...target, text: t, source: "chat", botId: c.botId, botName: c.botName, updatedAt: now };
      s.lines = s.lines.map((l) => (l.id === target!.id ? next : l));
      const change: AboutChange = { id: `c_${hex(5)}`, at: now, op: "edit", lineId: target.id, before: stateOf(target), after: stateOf(next), by: "bot", botId: c.botId, botName: c.botName, conversationId: c.conversationId };
      s.history.push(change);
      this.save();
      return { kind: "edited", change };
    }
    const line: AboutLine = { id: `l_${hex(5)}`, text: t, source: "chat", locked: false, botId: c.botId, botName: c.botName, createdAt: now, updatedAt: now };
    s.lines.push(line);
    const change: AboutChange = { id: `c_${hex(5)}`, at: now, op: "add", lineId: line.id, after: stateOf(line), by: "bot", botId: c.botId, botName: c.botName, conversationId: c.conversationId };
    s.history.push(change);
    this.save();
    return { kind: "added", change };
  }

  private propose(p: Pick<AboutProposal, "kind" | "text" | "lineId" | "old" | "category">, c: BotContext): AboutProposal {
    const s = this.load();
    const proposal: AboutProposal = { id: `p_${hex(5)}`, ...p, conversationId: c.conversationId, session: c.session, botId: c.botId, botName: c.botName, status: "pending", at: this.now() };
    s.proposals.push(proposal);
    this.save(false);
    for (const fn of this.listeners) fn();
    return proposal;
  }

  /** 用户在对话里说「忘掉……」：删掉，进「不再记回」 */
  botForget(match: string, c: Pick<BotContext, "botId" | "botName" | "conversationId">): BotForgetResult {
    if (!this.load().enabled) return { kind: "off" };
    const f = this.find(match);
    if (!f.line) return f.candidates.length > 1 ? { kind: "many", candidates: f.candidates.map((l) => l.text) } : { kind: "none" };
    return { kind: "deleted", change: this.remove(f.line, { by: "bot", ...c }) };
  }

  /** 确认卡「记下 / 只这次用」、建议卡「改成这样 / 保持不变」 */
  decide(id: string, accept: boolean): AboutProposal {
    const s = this.load();
    const p = s.proposals.find((x) => x.id === id);
    if (!p) throw new AboutMeError("missing");
    if (p.status !== "pending") return p;
    const now = this.now();
    p.decidedAt = now;
    if (!accept) {
      p.status = p.kind === "sensitive" ? "once" : "kept";
      this.save(false);
      for (const fn of this.listeners) fn();
      return p;
    }
    const target = p.lineId ? s.lines.find((l) => l.id === p.lineId) : undefined;
    if (p.lineId && (!target || (p.old && target.text !== p.old))) {
      p.status = "stale";
      this.save(false);
      throw new AboutMeError("stale");
    }
    // 在确认卡、建议卡上点了确认的算用户改过（带锁）
    let change: AboutChange;
    if (target) {
      const next: AboutLine = { ...target, text: p.text, source: "you", locked: true, sensitive: p.category ?? sensitiveKind(p.text), updatedAt: now };
      s.lines = s.lines.map((l) => (l.id === target.id ? next : l));
      change = { id: `c_${hex(5)}`, at: now, op: "edit", lineId: target.id, before: stateOf(target), after: stateOf(next), by: "you", conversationId: p.conversationId };
    } else {
      const dup = s.lines.find((l) => squash(l.text) === squash(p.text));
      if (dup) {
        p.status = "added";
        this.save(false);
        return p;
      }
      const line: AboutLine = { id: `l_${hex(5)}`, text: p.text, source: "you", locked: true, sensitive: p.category, createdAt: now, updatedAt: now };
      s.lines.push(line);
      change = { id: `c_${hex(5)}`, at: now, op: "add", lineId: line.id, after: stateOf(line), by: "you", conversationId: p.conversationId };
    }
    s.suppressed = s.suppressed.filter((x) => squash(x.text) !== squash(p.text));
    s.history.push(change);
    p.status = p.kind === "sensitive" ? "added" : "changed";
    p.changeId = change.id;
    this.save();
    return p;
  }

  proposal(id: string): AboutProposal | undefined {
    return this.load().proposals.find((p) => p.id === id);
  }

  /** 渠道里回「撤销」：撤销这个对话里 since 之后机器人做的变更（新的先撤） */
  undoRecent(conversationId: string, since: number): AboutChange[] {
    const list = this.load().history.filter((h) => h.conversationId === conversationId && h.by === "bot" && h.at > since && this.canUndo(h)).sort((a, b) => b.at - a.at);
    return list.map((h) => this.undo(h.id, "you", conversationId));
  }
}

function stateOf(l: AboutLine): LineState {
  const { id: _id, ...rest } = l;
  return { ...rest };
}
