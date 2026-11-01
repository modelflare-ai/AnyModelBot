/**
 * 主动消息的送达规则（设计文档第 6 节「Transparency without noise」、决定 4 和 8）。机制在 outbox.ts，这里只定规则：
 *
 * - 免打扰（默认 22:00–08:00，主人的时区，每个机器人可关、可改时段）：任务结果、失败、规则命中排到时段结束再发；
 *   用户 10 分钟内刚发过消息（人醒着）或任务、规则要求马上告诉（anytime）时不拦。聊天里的回复从不推迟。
 * - 合并：上一条主动消息发出不到 2 分钟时，新的排到 2 分钟后；同一时间到期的合成一条摘要，一项一行。
 * - 每天上限（每个机器人每个会话）：微信 3 条、飞书 5 条；超出的排到下一个早上，合成一条摘要。
 * - 对方发消息时，留着的和排着的先发（outbox.release），排在这次的回复前面。
 * - 微信配额预留：进行中的任务、排着的主动消息（以及 3b 的待答问题、3d 的执行中规则）各留 1 条，最多 3 条；
 *   聊天回复只能用剩下的（deliverWeixin）。
 * - 微信续期提醒：24 小时窗口关闭前约 2 小时，窗口关闭后还有东西要发给这个人时，发一句「回个 ok」；
 *   每个窗口最多一次，免打扰时不发，用掉 10 条里的 1 条，可按机器人关掉；没有要发的就不发。
 * - 没送到的（微信要对方先发消息、一直失败、放弃了）是「需要你」里的一项（attentionItems），原因没了就自己消失。
 * - 暂停后台工作（机器人设置 paused）：主动消息都排着（reason paused），对方发消息时也不放，不发续期提醒；
 *   恢复时（resume）马上按上面的规则重新排。聊天里的回复不受影响。
 *
 * 给 3b / 3d 的接口：addReserver（占配额）、addUpcoming（续期提醒里列出要来的规则）、attentionItems / act / onChange。
 */
import path from "node:path";
import type { BotSettings } from "../agent/settings.js";
import type { OutboxKind, OutboxPurpose, OutboxRow, Store } from "../store/db.js";
import { botForPeer } from "./routes.js";
import type { HeldGroup, Outbox } from "./outbox.js";
import { DEFAULT_QUIET, fmtWhen, inQuiet, minuteOf, nextAt, quietEnd, quietStart, startOfDay, systemTimeZone, type QuietHours } from "./quiet.js";
import { QUOTA_WINDOW_MS, WeixinQuota } from "../channels/weixin/quota.js";
import { combineHeld, filterMarkdown } from "../channels/weixin/channel.js";
import { MESSENGER_LABEL, isMessenger, type PushChannel } from "./types.js";
import { logger } from "../log.js";
import { t as tr } from "../i18n/index.js";

const log = logger("delivery");

/** 上一条主动消息发出不到这么久，新的就等到这时再发（期间来的合成一条） */
export const COALESCE_MS = 2 * 60_000;
/** 每个机器人每个会话每天最多几条主动消息；超出的合成一条摘要，排到下一个早上 */
export const DAILY_CAP: Readonly<Record<string, number>> = { weixin: 3, feishu: 5 };
/** 微信：给主动消息留的配额最多几条 */
export const MAX_RESERVED = 3;
/** 用户这么久之内发过消息：人醒着，免打扰不拦 */
export const AWAKE_MS = 10 * 60_000;
/** 续期提醒：窗口关闭前多久 */
export const NUDGE_BEFORE_MS = 2 * 3600_000;
/** 离窗口关闭不到这么久就不提醒了（来不及回） */
export const NUDGE_LATEST_MS = 10 * 60_000;
/** 续期提醒最长隔多久看一次 */
const NUDGE_TICK_MS = 15 * 60_000;
/** 「需要你」：试了这么多次还没发出去就算 */
export const FAILS_FOR_ATTENTION = 3;
/** 放弃了的、没处理掉的，在「需要你」里留多久 */
const GONE_SHOWN_MS = 7 * 86400_000;
/** 暂停时排着的主动消息隔多久再看一次（恢复时由 resume 马上放出来，这只是兜底） */
const PAUSED_RECHECK_MS = 3600_000;
/** 摘要一条最长多少字（微信一条 4000 字，留余地） */
const DIGEST_MAX = 3500;

/** 主动推送的用途（续期提醒由这里自己发） */
export type PushPurpose = Exclude<OutboxPurpose, "" | "nudge">;

export interface PushInput {
  /** 确定的 id（同一 id 只发一次），如 task:<任务>:result:<run> */
  id: string;
  botId: string;
  channel: PushChannel;
  /** 微信：用户 id；飞书和其他平台：chat id */
  peerId: string;
  purpose: PushPurpose;
  /** 是什么：任务标题、规则名（摘要、续期提醒、「需要你」里用） */
  subject: string;
  /** 一句话（设计里的消息样式：一行，细节按需） */
  text: string;
  /** 单独发出去时接在后面的提示（任务结果：引用 / 回复这条消息可以继续问）；合成摘要时不带 */
  hint?: string;
  /** 跟在后面的文件 */
  files?: string[];
  /** 飞书：回复在哪条消息下；kind = notice 时直接发到会话 */
  replyTo?: string;
  kind?: Extract<OutboxKind, "text" | "notice">;
  /** 飞书：交互卡片（任务提问的选项按钮），给了就发卡片，发不了时发 text */
  card?: Record<string, unknown>;
  /** 微信：原样发送，不过 Markdown 过滤（提问的编号选项、审批的命令） */
  raw?: boolean;
  /** 不受免打扰和每天上限限制（用户说了做完马上告诉他） */
  anytime?: boolean;
  /** 来自哪里：task:<id>、rule:<id> */
  ref?: string;
}

/** 一个人（一个会话）：机器人、渠道、对方 */
export interface Peer {
  botId: string;
  channel: string;
  peerId: string;
  conversationId: string;
}

/** 接下来要发给这个人的一项（续期提醒里列出来）：at 是预计的时间（不知道就不给） */
export interface Upcoming {
  label: string;
  at?: number;
  kind: "task" | "rule" | "reminder" | "message";
}

/** 这个人现在要给主动消息留几条配额（3b：待答问题；3d：执行中的规则） */
export type Reserver = (p: Peer) => number;
/** 窗口关闭（after）之后还要发给这个人的（3d：规则下次运行） */
export type UpcomingSource = (p: Peer, after: number) => Upcoming[];

/**
 * 「需要你」里的一项：没送到的消息，按会话分组。held = 等对方在微信里发条消息（自己会好）；failed = 一直失败或放弃了。
 * 3b 的「需要你」视图读 attentionItems()，按钮调 act()。
 */
export interface AttentionItem {
  id: string;
  kind: "delivery";
  state: "held" | "failed";
  botId: string;
  conversationId: string;
  channel: string;
  severity: "warn" | "error";
  /** 第一行：1 条结果未送达微信 */
  title: string;
  /** 第二行（可能为空） */
  line: string;
  /** 从什么时候起 */
  since: number;
  /** 没送到的内容（「在这里查看」） */
  messages: Array<{ id: string; text: string; at: number; ref: string }>;
  actions: Array<"retry" | "dismiss">;
}

const channelName = (c: string) => (c === "weixin" ? tr("delivery.chWeixin") : c === "feishu" ? tr("delivery.chFeishu") : isMessenger(c) ? MESSENGER_LABEL[c] : c);
const ACK = /^(ok|okay|k|好|好的|好滴|嗯|嗯嗯|收到|行|可以)[\s!！。.~～]*$/i;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const peerOf = (botId: string, channel: string, peerId: string): Peer => ({ botId, channel, peerId, conversationId: `${botId}:${channel}:${peerId}` });

/** 一条要不要人管：留着等对方、一直失败、放弃了且没在「需要你」里点不再提示（合进别的一条的，传那一条进来） */
export function needsPerson(row: OutboxRow | undefined): boolean {
  if (!row) return false;
  return row.status === "held" || (row.status === "gone" && !row.seenAt) || (row.status === "pending" && row.attempts >= FAILS_FOR_ATTENTION);
}

/** 摘要：一条就是它自己；几条就是「N 个后台任务：」加一项一行 */
export function digestText(items: Array<{ purpose: string; text: string }>): string {
  if (items.length === 1) return items[0].text;
  const all = (...k: string[]) => items.every((i) => k.includes(i.purpose));
  const head = tr(all("result", "failure") ? "delivery.digestTasks" : all("rule", "reminder") ? "delivery.digestReminders" : "delivery.digestMessages", { count: items.length });
  return [head, ...items.map((i) => `· ${oneLine(i.text)}`)].join("\n");
}

/** 续期提醒的那句话：「接下来还有 2 条提醒要发给你（明早 8:00 天气、周一 9:00 周报）。回个「ok」我就能继续按时提醒你。」 */
export function nudgeText(items: Upcoming[], now: number, tz: string): { text: string; noun: string } {
  const all = (...k: string[]) => items.every((i) => k.includes(i.kind));
  const noun = all("rule", "reminder") ? "提醒" : all("task") ? "结果" : "消息";
  const list = items
    .slice(0, 3)
    .map((i) => (i.at ? `${fmtWhen(i.at, now, tz)} ` : "") + clip(oneLine(i.label), 20))
    .join(tr("delivery.listSep"));
  const kind = noun === "提醒" ? "Reminders" : noun === "结果" ? "Results" : "Messages";
  return { text: tr(`delivery.nudge${kind}` as "delivery.nudgeMessages", { count: items.length, list, more: items.length > 3 ? tr("delivery.andMore") : "" }), noun };
}

/**
 * 续期提醒什么时候发：窗口关闭前 2 小时；那时在免打扰里，就挪到免打扰结束（离关闭至少还有 30 分钟）
 * 或开始前一分钟（窗口已经开了），哪个离 2 小时前近用哪个；都不行就不发（Infinity）
 */
export function nudgeAt(start: number, close: number, quiet: QuietHours, tz: string): number {
  const target = close - NUDGE_BEFORE_MS;
  if (!inQuiet(target, quiet, tz)) return target;
  const after = quietEnd(target, quiet, tz);
  const before = quietStart(target, quiet, tz) - 60_000;
  const okAfter = after <= close - 3 * NUDGE_LATEST_MS;
  const okBefore = before >= start;
  if (okAfter && (!okBefore || after - target <= target - before)) return after;
  if (okBefore) return before;
  return Infinity;
}

export interface DeliveryOptions {
  store: Store;
  outbox: Outbox;
  now?: () => number;
  /** 主人的时区（默认本机的） */
  timeZone?: string;
  /** 测试注入：每天上限（默认 DAILY_CAP）、合并间隔（默认 COALESCE_MS） */
  dailyCap?: Readonly<Record<string, number>>;
  coalesceMs?: number;
}

export class Delivery {
  private reservers = new Set<Reserver>();
  private sources = new Set<UpcomingSource>();
  private listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private emitting = false;
  private offOutbox: (() => void) | undefined;

  constructor(private o: DeliveryOptions) {
    o.outbox.planner = { promote: (rows, now) => this.promote(rows, now), waits: (r) => (r.purpose && this.paused(r.botId) ? "paused" : undefined) };
  }

  private get store(): Store {
    return this.o.store;
  }
  private now(): number {
    return (this.o.now ?? Date.now)();
  }
  get timeZone(): string {
    return this.o.timeZone ?? systemTimeZone();
  }

  /** 这个机器人的后台工作暂停了（机器人设置 paused）：主动消息排着，对方发消息时也不放，恢复后按平常的规则发 */
  paused(botId: string): boolean {
    return !!this.store.getBot(botId)?.settings?.paused;
  }

  /** 后台工作恢复了：因为暂停排着的主动消息马上重新排（免打扰、每天上限、合并照旧） */
  resume(botId: string): number {
    const now = this.now();
    const rows = this.store.listOutbox({ botId, status: "scheduled", limit: 500 }).filter((r) => r.reason === "paused");
    for (const r of rows) this.store.updateOutbox(r.id, { due: now }, now);
    if (rows.length) log.info("background work resumed; pushes that waited go out", { bot: botId, count: rows.length });
    this.o.outbox.wake();
    return rows.length;
  }

  /** 这个机器人的免打扰时段与续期提醒开关 */
  settingsOf(botId: string): { quiet: QuietHours; nudge: boolean } {
    const s: Partial<BotSettings> | undefined = this.store.getBot(botId)?.settings;
    return { quiet: s?.quietHours ?? DEFAULT_QUIET, nudge: s?.nudge ?? true };
  }

  /** 开始：续期提醒的定时器；出站队列的变化转给「需要你」 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.offOutbox = this.o.outbox.onChange(() => this.emit());
    this.arm(1000);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.offOutbox?.();
    this.offOutbox = undefined;
  }

  // ---------- 推送 ----------

  /** 主动推送（任务结果、失败；3d 的规则命中、提醒）：按规则算出什么时候发，写进出站队列（同步落库） */
  push(p: PushInput): { due: number; reason: string } {
    const peer = peerOf(p.botId, p.channel, p.peerId);
    const now = this.now();
    const { due, reason } = this.plan(peer, p.purpose, !!p.anytime, now);
    const common = { botId: p.botId, channel: p.channel, peerId: p.peerId, replyTo: p.replyTo ?? "", purpose: p.purpose, subject: clip(oneLine(p.subject), 60), ref: p.ref ?? "", due, reason };
    const flag = p.anytime ? { anytime: true } : {};
    const extra = { ...(p.card ? { card: p.card } : {}), ...(p.raw ? { raw: true } : {}), ...(p.hint ? { hint: p.hint } : {}) };
    void this.o.outbox.send({ ...common, id: p.id, kind: p.card ? "card" : (p.kind ?? "text"), body: { text: p.text, ...extra, ...flag } });
    (p.files ?? []).forEach((f, i) => void this.o.outbox.send({ ...common, id: `${p.id}:file:${i}`, kind: "file", body: { path: f, name: path.basename(f), ...flag } }));
    if (due > now) log.info("proactive message scheduled", { id: p.id, channel: p.channel, reason, inMin: Math.round((due - now) / 60_000) });
    return { due, reason };
  }

  /** 推了还没发出去的不用再发了（任务的提问在别处回答了）：撤回 */
  withdraw(id: string, reason: string): boolean {
    return this.o.outbox.withdraw(id, reason);
  }

  /** 什么时候发：免打扰 → 每天上限 → 合并（离上一条不到 2 分钟就等，和排着的一起发） */
  plan(p: Peer, purpose: OutboxPurpose, anytime: boolean, now: number): { due: number; reason: string } {
    // 后台工作暂停了：排着，恢复时再按下面的规则排（resume）
    if (this.paused(p.botId)) return { due: now + PAUSED_RECHECK_MS, reason: "paused" };
    const { quiet } = this.settingsOf(p.botId);
    const tz = this.timeZone;
    const free = anytime || this.awake(p, now);
    let due = now;
    let reason = "";
    if (!free && inQuiet(due, quiet, tz)) [due, reason] = [quietEnd(due, quiet, tz), "quiet_hours"];
    if (!anytime) {
      const capped = this.afterCap(p, due, quiet);
      if (capped !== due) [due, reason] = [capped, "daily_cap"];
    }
    // 问题单独发，不合并
    if (purpose === "question") return { due, reason: due > now ? reason : "" };
    const last = this.store.lastPushAt(p.conversationId);
    const gap = this.o.coalesceMs ?? COALESCE_MS;
    if (last && due < last + gap) {
      [due, reason] = [last + gap, reason || "coalesce"];
      if (!free && inQuiet(due, quiet, tz)) [due, reason] = [quietEnd(due, quiet, tz), "quiet_hours"];
    }
    const with_ = this.store.scheduledPushes(p.conversationId).find((r) => r.purpose !== "question" && Math.abs(r.due - due) <= gap);
    if (with_) [due, reason] = [Math.max(with_.due, now), with_.reason || reason];
    return { due, reason: due > now ? reason : "" };
  }

  /** 这天到上限了就挪到下一个早上（免打扰结束的时间），直到有一天没满 */
  private afterCap(p: Peer, due: number, quiet: QuietHours): number {
    const tz = this.timeZone;
    const cap = (this.o.dailyCap ?? DAILY_CAP)[p.channel] ?? 5;
    const morning = minuteOf(quiet.to) ?? minuteOf(DEFAULT_QUIET.to)!;
    for (let i = 0; i < 7; i++) {
      const d0 = startOfDay(due, tz);
      if (this.store.countPushes(p.conversationId, d0, nextAt(d0, 0, tz)) < cap) return due;
      due = nextAt(due, morning, tz);
    }
    return due;
  }

  /** 用户刚发过消息（人醒着）：免打扰不拦 */
  private awake(p: Peer, now: number): boolean {
    let last = this.store.lastUserMessageAt(p.conversationId);
    if (p.channel === "weixin") last = Math.max(last, this.store.getWeixinPeer(this.store.getConversation(p.conversationId)?.account || p.botId, p.peerId)?.windowStartedAt ?? 0);
    return last > now - AWAKE_MS && last <= now + 1000;
  }

  /** 排着的主动消息到时间了：还在免打扰里（设置改过）或这天满了就再排，否则合成一条 */
  private promote(rows: OutboxRow[], now: number): { later: number; reason: string } | HeldGroup[] {
    const r0 = rows[0];
    if (!r0.purpose || r0.purpose === "nudge") return rows.map((r) => ({ rows: [r] }));
    const p = peerOf(r0.botId, r0.channel, r0.peerId);
    if (this.paused(p.botId)) return { later: now + PAUSED_RECHECK_MS, reason: "paused" };
    const { quiet } = this.settingsOf(p.botId);
    const anytime = rows.every((r) => r.body.anytime);
    if (!anytime && !this.awake(p, now) && inQuiet(now, quiet, this.timeZone)) return { later: quietEnd(now, quiet, this.timeZone), reason: "quiet_hours" };
    if (!anytime) {
      const capped = this.afterCap(p, now, quiet);
      if (capped !== now) return { later: capped, reason: "daily_cap" };
    }
    return this.combine(rows);
  }

  /**
   * 一起发的几条怎么合（到时间的一批、对方发消息时放出来的）：有等对方的（held）就照「你不在时：…」合（微信）；
   * 只是排着的就合成摘要，文字一条（放得下就合），文件、问题、发了一半的照原样排在后面。飞书的摘要直接发到会话。
   */
  combine(rows: OutboxRow[]): HeldGroup[] {
    if (!rows.length) return [];
    if (rows.some((r) => r.status === "held")) return rows[0].channel === "weixin" ? combineHeld(rows) : rows.map((r) => ({ rows: [r] }));
    const mergeable = (r: OutboxRow) => (r.kind === "text" || r.kind === "notice") && r.progress === 0 && !!r.purpose && r.purpose !== "question" && r.purpose !== "nudge" && !!(r.body.text ?? "").trim();
    const groups: HeldGroup[] = [];
    let cur: OutboxRow[] = [];
    let len = 0;
    const flush = () => {
      if (cur.length) groups.push(this.digestGroup(cur));
      cur = [];
      len = 0;
    };
    for (const r of rows.filter(mergeable)) {
      const n = this.textOf(r).length + 4;
      if (cur.length && len + n > DIGEST_MAX) flush();
      cur.push(r);
      len += n;
    }
    flush();
    return [...groups, ...rows.filter((r) => !mergeable(r)).map((r) => ({ rows: [r] }))];
  }

  private textOf(r: OutboxRow): string {
    const t = r.body.text ?? "";
    return r.channel === "weixin" && !r.body.raw ? filterMarkdown(t) : t.trim();
  }

  private digestGroup(rows: OutboxRow[]): HeldGroup {
    if (rows.length === 1) return { rows };
    const text = digestText(rows.map((r) => ({ purpose: r.purpose, text: this.textOf(r) })));
    return { rows, body: { text, raw: true, digest: true }, ...(rows[0].channel === "feishu" ? { kind: "notice" as const, replyTo: "" } : {}) };
  }

  // ---------- 微信配额预留 ----------

  /** 登记一种占配额的东西（返回注销函数）：3b 的待答问题、3d 的执行中规则 */
  addReserver(fn: Reserver): () => void {
    this.reservers.add(fn);
    return () => this.reservers.delete(fn);
  }

  /** 这个人现在要给主动消息留几条：排着的主动消息 1 条，加上登记的（进行中的任务各 1 条…），最多 3 条 */
  reserved(botId: string, channel: string, peerId: string): number {
    const p = peerOf(botId, channel, peerId);
    let n = this.store.scheduledPushes(p.conversationId).length ? 1 : 0;
    for (const fn of this.reservers) {
      try {
        n += Math.max(0, Math.floor(fn(p) || 0));
      } catch (e) {
        log.warn("reserver failed", { message: (e as Error).message });
      }
    }
    return Math.min(MAX_RESERVED, n);
  }

  // ---------- 续期提醒 ----------

  /** 登记"之后还要发给这个人的"来源（返回注销函数）：3d 的规则下次运行 */
  addUpcoming(fn: UpcomingSource): () => void {
    this.sources.add(fn);
    return () => this.sources.delete(fn);
  }

  /** after（窗口关闭）之后还要发给这个人的：排到那之后的、留着的主动消息，加上登记的（进行中的任务…），按时间排 */
  upcoming(p: Peer, after: number): Upcoming[] {
    const out: Upcoming[] = [];
    for (const r of this.store.waitingOutbox(p.conversationId)) {
      if (r.kind === "file" || !r.purpose || r.purpose === "nudge") continue;
      if (r.status === "scheduled" && r.due < after) continue;
      const kind = r.purpose === "result" || r.purpose === "failure" ? "task" : r.purpose === "rule" ? "rule" : r.purpose === "reminder" ? "reminder" : "message";
      out.push({ label: r.subject || oneLine(r.body.text ?? ""), ...(r.status === "scheduled" ? { at: r.due } : {}), kind });
    }
    for (const fn of this.sources) {
      try {
        out.push(...fn(p, after));
      } catch (e) {
        log.warn("upcoming source failed", { message: (e as Error).message });
      }
    }
    return out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  }

  /** 续期提醒的 id：每个窗口一个（同一 id 只发一次） */
  static nudgeId(botId: string, userId: string, windowStartedAt: number): string {
    return `nudge:${botId}:${userId}:${windowStartedAt}`;
  }

  /** 看一遍所有开着的微信窗口：到了提醒时间、有东西要发、还有配额、不在免打扰里就发一句；之后定好下次看的时间 */
  tick(): void {
    if (!this.running) return;
    const now = this.now();
    const tz = this.timeZone;
    let next = now + NUDGE_TICK_MS;
    // 微信账号是全局的：按账号走一遍联系人，每个人的提醒看他现在在和哪个机器人聊（用它的免打扰和开关）
    for (const account of this.store.weixinPeerAccounts()) {
      const row = this.store.getChannelAccount(account, "weixin");
      if (!(row ? row.enabled : this.store.getBot(account)?.weixinEnabled)) continue;
      const quota = new WeixinQuota(this.store, account, () => now);
      for (const peer of this.store.listWeixinPeers(account)) {
        const botId = botForPeer(this.store, account, "weixin", peer.userId);
        const st = this.settingsOf(botId);
        if (!st.nudge || this.paused(botId)) continue;
        const close = peer.windowStartedAt + QUOTA_WINDOW_MS;
        if (!peer.contextToken || close <= now + NUDGE_LATEST_MS) continue;
        const at = nudgeAt(peer.windowStartedAt, close, st.quiet, tz);
        if (at > now) {
          next = Math.min(next, at);
          continue;
        }
        if (inQuiet(now, st.quiet, tz)) continue;
        const id = Delivery.nudgeId(botId, peer.userId, peer.windowStartedAt);
        if (this.store.getOutbox(id) || quota.remaining(peer.userId) <= 0) continue;
        const p = peerOf(botId, "weixin", peer.userId);
        const items = this.upcoming(p, close);
        if (!items.length) continue;
        const { text, noun } = nudgeText(items, now, tz);
        void this.o.outbox.send({ id, botId, account, channel: "weixin", peerId: peer.userId, kind: "text", body: { text, raw: true }, purpose: "nudge", subject: noun, ttlMs: close - now });
        if (this.store.getConversation(p.conversationId)) this.store.addMessage(p.conversationId, "assistant", text);
        log.info("weixin window nudge", { bot: botId, items: items.length, closesInMin: Math.round((close - now) / 60_000) });
      }
    }
    this.arm(next - now);
  }

  private arm(ms: number): void {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), Math.min(NUDGE_TICK_MS, Math.max(1000, ms)));
    this.timer.unref?.();
  }

  /**
   * 对方回了「ok」一类的话，而机器人最近发的一条是还没回过的续期提醒：不进模型，返回要回的那句（否则 undefined）。
   * 渠道先调这个，再放出留着的消息。
   */
  ack(botId: string, channel: string, peerId: string, text: string): string | undefined {
    if (!ACK.test(text.trim())) return undefined;
    const last = this.store.lastSentOutbox(`${botId}:${channel}:${peerId}`);
    if (!last || last.purpose !== "nudge" || last.reason === "acked" || this.now() - last.sentAt > QUOTA_WINDOW_MS + NUDGE_BEFORE_MS) return undefined;
    this.store.updateOutbox(last.id, { reason: "acked" }, this.now());
    return last.subject === "提醒" ? tr("delivery.ackReminder") : tr("delivery.ackSend");
  }

  // ---------- 需要你 ----------

  /** 「需要你」有变化时通知（3b：刷新视图、托盘计数、桌面通知） */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    if (this.emitting || !this.listeners.size) return;
    this.emitting = true;
    queueMicrotask(() => {
      this.emitting = false;
      for (const fn of this.listeners) {
        try {
          fn();
        } catch (e) {
          log.warn("attention listener failed", { message: (e as Error).message });
        }
      }
    });
  }

  /**
   * 没送到、要人管的消息，按会话分两种：等对方在微信里发条消息的（自己会好，没有按钮），一直失败或放弃了的（重试、不再提示）。
   * 只算主动推的结果和提醒：聊天里的回复对方下次发消息时会补上（不单列，产品负责人否掉过「没发出去的消息」），
   * 续期提醒没送到就算了，提问在「需要你」里本来就有一行。
   */
  attentionItems(botId?: string): AttentionItem[] {
    const now = this.now();
    const rows = this.store
      .undeliveredOutbox({ botId, minAttempts: FAILS_FOR_ATTENTION, since: now - GONE_SHOWN_MS })
      .filter((r) => r.purpose !== "" && r.purpose !== "nudge" && r.purpose !== "question");
    const groups = new Map<string, OutboxRow[]>();
    for (const r of rows) {
      const key = `delivery:${r.conversationId}:${r.status === "held" ? "held" : "failed"}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const items: AttentionItem[] = [];
    for (const [id, list] of groups) {
      const r0 = list[0];
      const held = r0.status === "held";
      const ch = channelName(r0.channel);
      // 合成过的一条按里面的条数算；文件不单算
      const parts = list.flatMap((r) => [r, ...(r.body.digest || r.body.away ? this.store.mergedOutbox(r.id) : [])]).filter((r) => r.kind !== "file");
      const n = Math.max(1, parts.length);
      const results = parts.length > 0 && parts.every((r) => r.purpose === "result" || r.purpose === "failure");
      items.push({
        id,
        kind: "delivery",
        state: held ? "held" : "failed",
        botId: r0.botId,
        conversationId: r0.conversationId,
        channel: r0.channel,
        severity: held ? "warn" : "error",
        title: tr(held ? (results ? "delivery.heldResults" : "delivery.heldMessages") : results ? "delivery.failedResults" : "delivery.failedMessages", { count: n, channel: ch }),
        line: held ? tr("delivery.heldLine", { channel: ch }) : list.some((r) => r.status === "pending") ? tr("delivery.retrying") : "",
        since: Math.min(...list.map((r) => r.createdAt)),
        messages: list.map((r) => ({ id: r.id, text: r.kind === "file" ? tr("delivery.fileItem", { name: r.body.name ?? "" }) : (r.body.text ?? ""), at: r.createdAt, ref: r.ref })),
        actions: held ? [] : list.some((r) => r.status === "gone") ? ["retry", "dismiss"] : ["retry"],
      });
    }
    return items.sort((a, b) => a.since - b.since);
  }

  /** 「需要你」里的按钮：retry 再发一次；dismiss 不再提示（只对放弃了的） */
  act(id: string, action: "retry" | "dismiss"): boolean {
    const item = this.attentionItems().find((i) => i.id === id);
    if (!item || !item.actions.includes(action)) return false;
    const now = this.now();
    for (const m of item.messages) {
      const row = this.store.getOutbox(m.id);
      if (!row) continue;
      if (action === "retry") this.o.outbox.retry(m.id);
      else if (row.status === "gone") this.store.updateOutbox(m.id, { seenAt: now }, now);
    }
    this.emit();
    return true;
  }
}
