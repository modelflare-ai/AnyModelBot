import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { normalizeSettings, type BotSettings } from "../agent/settings.js";

/**
 * SQLite 存储（node:sqlite，无原生模块，Electron 下也无需 rebuild）。
 * 敏感字段（飞书 app_secret、iLink bot_token、context_token）只存本地数据目录，文件权限 600。
 */
export interface Bot {
  id: string;
  name: string;
  systemPrompt: string;
  defaultModel: string;
  feishuAppId: string;
  feishuAppSecret: string;
  weixinEnabled: boolean;
  /** 身份与行为设置（权限预设、记忆、上下文管家） */
  settings: BotSettings;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  botId: string;
  channel: string;
  peerId: string;
  title: string;
  model: string;
  /** dm 或 group（群聊使用群记忆） */
  kind: "dm" | "group";
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: number;
  conversationId: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface WeixinAccount {
  botId: string;
  botToken: string;
  ilinkBotId: string;
  baseUrl: string;
  ownerUserId: string;
  cursor: string;
  pausedUntil: number;
  updatedAt: number;
}

export interface WeixinPeer {
  botId: string;
  userId: string;
  contextToken: string;
  quotaRemaining: number;
  windowStartedAt: number;
}

export type ApprovalStatus = "pending" | "allowed" | "rejected" | "expired" | "cancelled" | "answered";

/** 需要用户决定的请求：工具审批（approval）或 ask_user_question（question）。 */
export interface ApprovalRow {
  id: string;
  code: string;
  kind: "approval" | "question";
  botId: string;
  conversationId: string;
  sessionId: string;
  tool: string;
  detail: string;
  reason: string;
  /** question 的原始问题 JSON */
  payload: string;
  status: ApprovalStatus;
  /** question 的回答 JSON */
  result: string;
  decidedBy: string;
  createdAt: number;
  expiresAt: number;
  decidedAt: number;
}

type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '',
  default_model TEXT NOT NULL DEFAULT '', feishu_app_id TEXT NOT NULL DEFAULT '',
  feishu_app_secret TEXT NOT NULL DEFAULT '', weixin_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, channel TEXT NOT NULL, peer_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS conv_peer ON conversations(bot_id, channel, peer_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS msg_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS weixin_accounts (
  bot_id TEXT PRIMARY KEY, bot_token TEXT NOT NULL, ilink_bot_id TEXT NOT NULL, base_url TEXT NOT NULL,
  owner_user_id TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '', paused_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS weixin_peers (
  bot_id TEXT NOT NULL, user_id TEXT NOT NULL, context_token TEXT NOT NULL DEFAULT '',
  quota_remaining INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, user_id));
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_sessions (
  conversation_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'approval', bot_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status, expires_at);
CREATE TABLE IF NOT EXISTS agent_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, session_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', handoff TEXT NOT NULL DEFAULT '', ended_at INTEGER NOT NULL);
`;

/** 旧库补列（CREATE TABLE IF NOT EXISTS 不会改已有表）。 */
const COLUMNS: Array<[string, string, string]> = [
  ["bots", "settings", "TEXT NOT NULL DEFAULT '{}'"],
  ["conversations", "kind", "TEXT NOT NULL DEFAULT 'dm'"],
];

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") {
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows 等平台忽略 */
      }
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    for (const [table, col, def] of COLUMNS) {
      const cols = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name));
      if (!cols.includes(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
    this.migrateComputerUseAuto();
  }

  /** 一次性迁移：电脑操作改为默认自动执行（旧的 always / readonly-free 审批设置一律改成 auto）。 */
  private migrateComputerUseAuto(): void {
    const KEY = "migration.computer-use-auto";
    if (this.getKV(KEY)) return;
    for (const r of this.db.prepare("SELECT id, settings FROM bots").all() as Row[]) {
      let raw: any = {};
      try {
        raw = JSON.parse(String(r.settings ?? "{}"));
      } catch {
        raw = {};
      }
      if (raw && typeof raw === "object" && raw.computerUse && typeof raw.computerUse === "object") raw.computerUse.approval = "auto";
      this.db.prepare("UPDATE bots SET settings = ? WHERE id = ?").run(JSON.stringify(normalizeSettings(raw)), String(r.id));
    }
    this.setKV(KEY, String(Date.now()));
  }

  close(): void {
    this.db.close();
  }

  // ---------- kv ----------
  getKV(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }
  setKV(key: string, value: string): void {
    this.db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  deleteKV(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
  /** 以 prefix 开头的全部键值 */
  listKV(prefix: string): Array<[string, string]> {
    const rows = this.db.prepare("SELECT key, value FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key").all(prefix.length, prefix) as Row[];
    return rows.map((r) => [String(r.key), String(r.value)]);
  }

  // ---------- bots ----------
  private toBot(r: Row): Bot {
    return {
      id: String(r.id),
      name: String(r.name),
      systemPrompt: String(r.system_prompt),
      defaultModel: String(r.default_model),
      feishuAppId: String(r.feishu_app_id),
      feishuAppSecret: String(r.feishu_app_secret),
      weixinEnabled: Number(r.weixin_enabled) === 1,
      settings: parseSettings(r.settings),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  listBots(): Bot[] {
    return (this.db.prepare("SELECT * FROM bots ORDER BY created_at").all() as Row[]).map((r) => this.toBot(r));
  }
  getBot(id: string): Bot | undefined {
    const r = this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toBot(r) : undefined;
  }
  createBot(input: Partial<Bot> & { name: string }): Bot {
    const now = Date.now();
    const id = input.id || randomUUID().slice(0, 8);
    this.db
      .prepare(
        `INSERT INTO bots(id, name, system_prompt, default_model, feishu_app_id, feishu_app_secret, weixin_enabled, settings, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.systemPrompt ?? "", input.defaultModel ?? "", input.feishuAppId ?? "", input.feishuAppSecret ?? "", input.weixinEnabled ? 1 : 0, JSON.stringify(normalizeSettings(input.settings)), now, now);
    return this.getBot(id)!;
  }
  updateBot(id: string, patch: Partial<Omit<Bot, "id" | "createdAt" | "updatedAt">>): Bot | undefined {
    const cur = this.getBot(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE bots SET name=?, system_prompt=?, default_model=?, feishu_app_id=?, feishu_app_secret=?, weixin_enabled=?, settings=?, updated_at=? WHERE id=?`,
      )
      .run(next.name, next.systemPrompt, next.defaultModel, next.feishuAppId, next.feishuAppSecret, next.weixinEnabled ? 1 : 0, JSON.stringify(normalizeSettings(next.settings)), Date.now(), id);
    return this.getBot(id);
  }
  deleteBot(id: string): void {
    const convs = this.db.prepare("SELECT id FROM conversations WHERE bot_id = ?").all(id) as Row[];
    for (const c of convs) this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(String(c.id));
    this.db.prepare("DELETE FROM agent_segments WHERE conversation_id IN (SELECT id FROM conversations WHERE bot_id = ?)").run(id);
    this.db.prepare("DELETE FROM conversations WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM weixin_accounts WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM weixin_peers WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM agent_sessions WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
  }

  // ---------- conversations ----------
  private toConv(r: Row): Conversation {
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      channel: String(r.channel),
      peerId: String(r.peer_id),
      title: String(r.title),
      model: String(r.model),
      kind: String(r.kind ?? "dm") === "group" ? "group" : "dm",
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
  ensureConversation(botId: string, channel: string, peerId: string, title = "", kind: "dm" | "group" = "dm"): Conversation {
    const r = this.db
      .prepare("SELECT * FROM conversations WHERE bot_id = ? AND channel = ? AND peer_id = ?")
      .get(botId, channel, peerId) as Row | undefined;
    if (r) {
      if (kind === "group" && String(r.kind) !== "group") this.db.prepare("UPDATE conversations SET kind = 'group' WHERE id = ?").run(String(r.id));
      return this.toConv({ ...r, kind: kind === "group" ? "group" : r.kind });
    }
    const now = Date.now();
    const id = `${botId}:${channel}:${peerId}`;
    this.db
      .prepare("INSERT INTO conversations(id, bot_id, channel, peer_id, title, model, kind, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '', ?, ?, ?)")
      .run(id, botId, channel, peerId, title, kind, now, now);
    return this.getConversation(id)!;
  }
  getConversation(id: string): Conversation | undefined {
    const r = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toConv(r) : undefined;
  }
  listConversations(botId?: string): Array<Conversation & { messageCount: number; lastMessage: string }> {
    const sql = `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n,
      (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last
      FROM conversations c ${botId ? "WHERE c.bot_id = ?" : ""} ORDER BY c.updated_at DESC LIMIT 200`;
    const rows = (botId ? this.db.prepare(sql).all(botId) : this.db.prepare(sql).all()) as Row[];
    return rows.map((r) => ({ ...this.toConv(r), messageCount: Number(r.n), lastMessage: r.last == null ? "" : String(r.last).slice(0, 120) }));
  }
  setConversationModel(id: string, model: string): void {
    this.db.prepare("UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?").run(model, Date.now(), id);
  }

  // ---------- messages ----------
  addMessage(conversationId: string, role: Message["role"], content: string): number {
    const now = Date.now();
    const res = this.db
      .prepare("INSERT INTO messages(conversation_id, role, content, created_at) VALUES(?, ?, ?, ?)")
      .run(conversationId, role, content, now);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return Number(res.lastInsertRowid);
  }
  listMessages(conversationId: string, limit = 500): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
      .all(conversationId, limit) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      conversationId: String(r.conversation_id),
      role: String(r.role) as Message["role"],
      content: String(r.content),
      createdAt: Number(r.created_at),
    }));
  }
  clearMessages(conversationId: string): void {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  }

  /**
   * 滑动窗口上下文：从最新往回取，直到条数或字符数超限；保证以 user 消息开头。
   */
  contextWindow(conversationId: string, maxMessages: number, maxChars: number): Array<Pick<Message, "role" | "content">> {
    const recent = this.listMessages(conversationId, maxMessages);
    const picked: Array<Pick<Message, "role" | "content">> = [];
    let chars = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const m = recent[i];
      if (picked.length > 0 && chars + m.content.length > maxChars) break;
      chars += m.content.length;
      picked.unshift({ role: m.role, content: m.content });
    }
    while (picked.length > 1 && picked[0].role !== "user") picked.shift();
    return picked;
  }

  // ---------- weixin ----------
  getWeixinAccount(botId: string): WeixinAccount | undefined {
    const r = this.db.prepare("SELECT * FROM weixin_accounts WHERE bot_id = ?").get(botId) as Row | undefined;
    if (!r) return undefined;
    return {
      botId: String(r.bot_id),
      botToken: String(r.bot_token),
      ilinkBotId: String(r.ilink_bot_id),
      baseUrl: String(r.base_url),
      ownerUserId: String(r.owner_user_id),
      cursor: String(r.cursor),
      pausedUntil: Number(r.paused_until),
      updatedAt: Number(r.updated_at),
    };
  }
  saveWeixinAccount(a: Omit<WeixinAccount, "cursor" | "pausedUntil" | "updatedAt">): void {
    this.db
      .prepare(
        `INSERT INTO weixin_accounts(bot_id, bot_token, ilink_bot_id, base_url, owner_user_id, cursor, paused_until, updated_at)
         VALUES(?, ?, ?, ?, ?, '', 0, ?)
         ON CONFLICT(bot_id) DO UPDATE SET bot_token=excluded.bot_token, ilink_bot_id=excluded.ilink_bot_id,
           base_url=excluded.base_url, owner_user_id=excluded.owner_user_id, cursor='', paused_until=0, updated_at=excluded.updated_at`,
      )
      .run(a.botId, a.botToken, a.ilinkBotId, a.baseUrl, a.ownerUserId, Date.now());
  }
  setWeixinCursor(botId: string, cursor: string): void {
    this.db.prepare("UPDATE weixin_accounts SET cursor = ?, updated_at = ? WHERE bot_id = ?").run(cursor, Date.now(), botId);
  }
  setWeixinPaused(botId: string, until: number): void {
    this.db.prepare("UPDATE weixin_accounts SET paused_until = ?, updated_at = ? WHERE bot_id = ?").run(until, Date.now(), botId);
  }
  deleteWeixinAccount(botId: string): void {
    this.db.prepare("DELETE FROM weixin_accounts WHERE bot_id = ?").run(botId);
    this.db.prepare("DELETE FROM weixin_peers WHERE bot_id = ?").run(botId);
  }
  getWeixinPeer(botId: string, userId: string): WeixinPeer | undefined {
    const r = this.db.prepare("SELECT * FROM weixin_peers WHERE bot_id = ? AND user_id = ?").get(botId, userId) as Row | undefined;
    if (!r) return undefined;
    return {
      botId: String(r.bot_id),
      userId: String(r.user_id),
      contextToken: String(r.context_token),
      quotaRemaining: Number(r.quota_remaining),
      windowStartedAt: Number(r.window_started_at),
    };
  }
  listWeixinPeers(botId: string): WeixinPeer[] {
    return (this.db.prepare("SELECT user_id FROM weixin_peers WHERE bot_id = ?").all(botId) as Row[]).map(
      (r) => this.getWeixinPeer(botId, String(r.user_id))!,
    );
  }
  upsertWeixinPeer(p: WeixinPeer): void {
    this.db
      .prepare(
        `INSERT INTO weixin_peers(bot_id, user_id, context_token, quota_remaining, window_started_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, user_id) DO UPDATE SET context_token=excluded.context_token,
           quota_remaining=excluded.quota_remaining, window_started_at=excluded.window_started_at`,
      )
      .run(p.botId, p.userId, p.contextToken, p.quotaRemaining, p.windowStartedAt);
  }

  // ---------- agent sessions（会话 ↔ DSH session） ----------
  getAgentSession(conversationId: string): string | undefined {
    const r = this.db.prepare("SELECT session_id FROM agent_sessions WHERE conversation_id = ?").get(conversationId) as Row | undefined;
    return r ? String(r.session_id) : undefined;
  }
  setAgentSession(conversationId: string, botId: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_sessions(conversation_id, bot_id, session_id, updated_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at`,
      )
      .run(conversationId, botId, sessionId, Date.now());
  }
  clearAgentSession(conversationId: string): void {
    this.db.prepare("DELETE FROM agent_sessions WHERE conversation_id = ?").run(conversationId);
  }
  /** 段落归档：上下文管家换段时记下旧 session 与交接便条。 */
  archiveSegment(conversationId: string, sessionId: string, reason: string, handoff: string): void {
    this.db
      .prepare("INSERT INTO agent_segments(conversation_id, session_id, reason, handoff, ended_at) VALUES(?, ?, ?, ?, ?)")
      .run(conversationId, sessionId, reason, handoff, Date.now());
  }
  listSegments(conversationId: string): Array<{ sessionId: string; reason: string; handoff: string; endedAt: number }> {
    return (this.db.prepare("SELECT * FROM agent_segments WHERE conversation_id = ? ORDER BY id").all(conversationId) as Row[]).map((r) => ({
      sessionId: String(r.session_id),
      reason: String(r.reason),
      handoff: String(r.handoff),
      endedAt: Number(r.ended_at),
    }));
  }
  /** 消息 id 大于 afterId 的消息（旧→新） */
  messagesAfter(conversationId: string, afterId: number, limit = 60): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT ?")
      .all(conversationId, afterId, limit) as Row[];
    return rows.reverse().map((r) => ({ id: Number(r.id), conversationId: String(r.conversation_id), role: String(r.role) as Message["role"], content: String(r.content), createdAt: Number(r.created_at) }));
  }

  conversationForSession(sessionId: string): string | undefined {
    const r = this.db.prepare("SELECT conversation_id FROM agent_sessions WHERE session_id = ?").get(sessionId) as Row | undefined;
    return r ? String(r.conversation_id) : undefined;
  }

  // ---------- approvals ----------
  private toApproval(r: Row): ApprovalRow {
    return {
      id: String(r.id),
      code: String(r.code),
      kind: String(r.kind) as ApprovalRow["kind"],
      botId: String(r.bot_id),
      conversationId: String(r.conversation_id),
      sessionId: String(r.session_id),
      tool: String(r.tool),
      detail: String(r.detail),
      reason: String(r.reason),
      payload: String(r.payload),
      status: String(r.status) as ApprovalStatus,
      result: String(r.result),
      decidedBy: String(r.decided_by),
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      decidedAt: Number(r.decided_at),
    };
  }
  insertApproval(a: Omit<ApprovalRow, "status" | "result" | "decidedBy" | "decidedAt">): ApprovalRow {
    this.db
      .prepare(
        `INSERT INTO approvals(id, code, kind, bot_id, conversation_id, session_id, tool, detail, reason, payload, status, created_at, expires_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(a.id, a.code, a.kind, a.botId, a.conversationId, a.sessionId, a.tool, a.detail, a.reason, a.payload, a.createdAt, a.expiresAt);
    return this.getApproval(a.id)!;
  }
  getApproval(id: string): ApprovalRow | undefined {
    const r = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toApproval(r) : undefined;
  }
  pendingApprovalByCode(code: string): ApprovalRow | undefined {
    const r = this.db.prepare("SELECT * FROM approvals WHERE code = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(code) as Row | undefined;
    return r ? this.toApproval(r) : undefined;
  }
  listApprovals(opts: { status?: ApprovalStatus; botId?: string; conversationId?: string; limit?: number } = {}): ApprovalRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.conversationId) (where.push("conversation_id = ?"), args.push(opts.conversationId));
    const sql = `SELECT * FROM approvals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 100))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toApproval(r));
  }
  /** 只在 pending 时生效，返回是否更新成功（防止重复决定）。 */
  decideApproval(id: string, status: Exclude<ApprovalStatus, "pending">, decidedBy: string, result = ""): boolean {
    const res = this.db
      .prepare("UPDATE approvals SET status = ?, decided_by = ?, result = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, decidedBy, result, Date.now(), id);
    return Number(res.changes) > 0;
  }
}

function parseSettings(v: unknown): BotSettings {
  try {
    return normalizeSettings(JSON.parse(String(v ?? "{}")));
  } catch {
    return normalizeSettings({});
  }
}
