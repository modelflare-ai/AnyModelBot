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
  /** 代理回合的活动记录有几步（内容按需用 getActivity 取） */
  steps?: number;
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

/**
 * 谁能和机器人对话（每个机器人、每个渠道）：owner = 在应用里设的主人（微信的主人默认是扫码登录的人，不存在这里），
 * allowed = 允许名单，pending = 等主人处理的使用请求，denied = 被拒绝（不再回复，主人可移除）。
 * peerId 是单聊会话 id（微信 = 用户 id，飞书 = 单聊 chat_id）。
 */
export type AccessStatus = "owner" | "allowed" | "pending" | "denied";
export interface AccessEntry {
  id: string;
  botId: string;
  channel: string;
  peerId: string;
  /** 平台上的发送者 id（飞书 open_id；微信同 peerId） */
  senderId: string;
  name: string;
  status: AccessStatus;
  /** 怎么来的：request（发消息申请）、migration（升级前已在使用）、previous-owner（换了扫码的微信）、app（在应用里添加） */
  source: string;
  /** 待处理请求的配对码（主人回复「同意 1234」）；处理后清空 */
  code: string;
  /** 第一条消息（截断），帮主人认出是谁 */
  text: string;
  requests: number;
  createdAt: number;
  updatedAt: number;
  decidedAt: number;
  decidedBy: string;
  /** 上次给这个人回"还没被允许"的时间（限频） */
  repliedAt: number;
  /** 上次把这个请求通知给主人的时间（限频） */
  notifiedAt: number;
}

export type OutboxStatus = "pending" | "sent" | "gone";
/** 出站消息的内容：文本（最终回复、提示、通知）、文件、带按钮的卡片（飞书审批） */
export interface OutboxBody {
  text?: string;
  /** 微信：原样发送，不过 Markdown 过滤（审批提示里的反引号要保留） */
  raw?: boolean;
  path?: string;
  name?: string;
  /** 飞书交互卡片 JSON（发不了时发 text） */
  card?: Record<string, unknown>;
  /** 飞书流式卡片：最终回复先写进这张卡片，失败再发文本 */
  cardId?: string;
  cardSeq?: number;
  /** 卡片上已经是最终全文 */
  shown?: boolean;
}
export type OutboxKind = "text" | "file" | "card" | "notice";
/** 持久化的出站消息（见 core/outbox.ts） */
export interface OutboxRow {
  id: string;
  seq: number;
  botId: string;
  channel: string;
  /** 排序单位：同一会话按 seq 依次发送 */
  conversationId: string;
  peerId: string;
  kind: OutboxKind;
  body: OutboxBody;
  /** 飞书：回复的消息 id */
  replyTo: string;
  status: OutboxStatus;
  attempts: number;
  /** 已经发出去的分段数（长文本分多条发，崩溃后从这里接着发） */
  progress: number;
  due: number;
  /** 最近一次失败的原因；gone 时是发不出去的原因 */
  error: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  sentAt: number;
  dismissed: boolean;
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
CREATE TABLE IF NOT EXISTS access (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, channel TEXT NOT NULL, peer_id TEXT NOT NULL,
  sender_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  decided_at INTEGER NOT NULL DEFAULT 0, decided_by TEXT NOT NULL DEFAULT '',
  replied_at INTEGER NOT NULL DEFAULT 0, notified_at INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS access_peer ON access(bot_id, channel, peer_id);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL, bot_id TEXT NOT NULL, channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL, peer_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
  reply_to TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, seq);
CREATE INDEX IF NOT EXISTS outbox_bot ON outbox(bot_id, status);
`;

/** 旧库补列（CREATE TABLE IF NOT EXISTS 不会改已有表）。 */
const COLUMNS: Array<[string, string, string]> = [
  ["bots", "settings", "TEXT NOT NULL DEFAULT '{}'"],
  ["conversations", "kind", "TEXT NOT NULL DEFAULT 'dm'"],
  // 代理回合的活动记录（JSON 数组，见 agent/activity.ts）；只在助手消息上
  ["messages", "activity", "TEXT NOT NULL DEFAULT ''"],
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
    this.migrateAccess();
  }

  /**
   * 一次性迁移（引入允许名单时）：已经和机器人有单聊会话的人自动加入允许名单（来源 migration，可在机器人设置里移除），
   * 升级后不会被拦在外面。扫码登录的微信本来就是主人，不用加；群聊不受名单限制。
   */
  private migrateAccess(): void {
    const KEY = "migration.access-allowlist";
    if (this.getKV(KEY)) return;
    const now = Date.now();
    const rows = this.db.prepare("SELECT bot_id, channel, peer_id, title FROM conversations WHERE channel IN ('weixin', 'feishu') AND kind != 'group'").all() as Row[];
    for (const r of rows) {
      const botId = String(r.bot_id);
      const channel = String(r.channel);
      const peerId = String(r.peer_id);
      if (channel === "weixin" && this.getWeixinAccount(botId)?.ownerUserId === peerId) continue;
      this.db
        .prepare(
          `INSERT OR IGNORE INTO access(id, bot_id, channel, peer_id, sender_id, name, status, source, created_at, updated_at, decided_at, decided_by)
           VALUES(?, ?, ?, ?, ?, ?, 'allowed', 'migration', ?, ?, ?, 'migration')`,
        )
        .run(randomUUID(), botId, channel, peerId, channel === "weixin" ? peerId : "", String(r.title ?? ""), now, now, now);
    }
    this.setKV(KEY, String(now));
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
    this.db.prepare("DELETE FROM access WHERE bot_id = ?").run(id);
    this.db.prepare("DELETE FROM outbox WHERE bot_id = ?").run(id);
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
  addMessage(conversationId: string, role: Message["role"], content: string, activity?: unknown[]): number {
    const now = Date.now();
    const res = this.db
      .prepare("INSERT INTO messages(conversation_id, role, content, created_at, activity) VALUES(?, ?, ?, ?, ?)")
      .run(conversationId, role, content, now, activity?.length ? JSON.stringify(activity) : "");
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return Number(res.lastInsertRowid);
  }
  listMessages(conversationId: string, limit = 500): Message[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM (SELECT id, conversation_id, role, content, created_at, CASE WHEN json_valid(activity) THEN json_array_length(activity) ELSE 0 END AS steps FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
      )
      .all(conversationId, limit) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      conversationId: String(r.conversation_id),
      role: String(r.role) as Message["role"],
      content: String(r.content),
      createdAt: Number(r.created_at),
      ...(Number(r.steps) ? { steps: Number(r.steps) } : {}),
    }));
  }
  /** 一条消息的活动记录（没有则为空数组） */
  getActivity(conversationId: string, messageId: number): unknown[] {
    const r = this.db.prepare("SELECT activity FROM messages WHERE id = ? AND conversation_id = ?").get(messageId, conversationId) as Row | undefined;
    try {
      return r?.activity ? (JSON.parse(String(r.activity)) as unknown[]) : [];
    } catch {
      return [];
    }
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

  // ---------- access（允许名单与使用请求） ----------
  private toAccess(r: Row): AccessEntry {
    return {
      id: String(r.id),
      botId: String(r.bot_id),
      channel: String(r.channel),
      peerId: String(r.peer_id),
      senderId: String(r.sender_id),
      name: String(r.name),
      status: String(r.status) as AccessStatus,
      source: String(r.source),
      code: String(r.code),
      text: String(r.text),
      requests: Number(r.requests),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      decidedAt: Number(r.decided_at),
      decidedBy: String(r.decided_by),
      repliedAt: Number(r.replied_at),
      notifiedAt: Number(r.notified_at),
    };
  }
  getAccess(botId: string, channel: string, peerId: string): AccessEntry | undefined {
    const r = this.db.prepare("SELECT * FROM access WHERE bot_id = ? AND channel = ? AND peer_id = ?").get(botId, channel, peerId) as Row | undefined;
    return r ? this.toAccess(r) : undefined;
  }
  getAccessById(id: string): AccessEntry | undefined {
    const r = this.db.prepare("SELECT * FROM access WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toAccess(r) : undefined;
  }
  listAccess(opts: { botId?: string; channel?: string; status?: AccessStatus } = {}): AccessEntry[] {
    const where: string[] = [];
    const args: string[] = [];
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.channel) (where.push("channel = ?"), args.push(opts.channel));
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    const sql = `SELECT * FROM access ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 500`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toAccess(r));
  }
  /** 新建；同一机器人、渠道、会话已有一条时只改状态和来源 */
  putAccess(e: AccessEntry): AccessEntry {
    this.db
      .prepare(
        `INSERT INTO access(id, bot_id, channel, peer_id, sender_id, name, status, source, code, text, requests, created_at, updated_at, decided_at, decided_by, replied_at, notified_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, channel, peer_id) DO UPDATE SET status=excluded.status, source=excluded.source, code=excluded.code,
           updated_at=excluded.updated_at, decided_at=excluded.decided_at, decided_by=excluded.decided_by`,
      )
      .run(e.id, e.botId, e.channel, e.peerId, e.senderId, e.name, e.status, e.source, e.code, e.text, e.requests, e.createdAt, e.updatedAt, e.decidedAt, e.decidedBy, e.repliedAt, e.notifiedAt);
    return this.getAccess(e.botId, e.channel, e.peerId)!;
  }
  updateAccess(id: string, patch: Partial<Pick<AccessEntry, "status" | "source" | "code" | "requests" | "updatedAt" | "decidedAt" | "decidedBy" | "repliedAt" | "notifiedAt">>): void {
    const cols: Record<string, string> = { status: "status", source: "source", code: "code", requests: "requests", updatedAt: "updated_at", decidedAt: "decided_at", decidedBy: "decided_by", repliedAt: "replied_at", notifiedAt: "notified_at" };
    const keys = (Object.keys(patch) as Array<keyof typeof patch>).filter((k) => k in cols);
    if (!keys.length) return;
    this.db.prepare(`UPDATE access SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number), id);
  }
  deleteAccess(id: string): void {
    this.db.prepare("DELETE FROM access WHERE id = ?").run(id);
  }
  pendingAccessByCode(botId: string, code: string): AccessEntry | undefined {
    const r = this.db.prepare("SELECT * FROM access WHERE bot_id = ? AND code = ? AND status = 'pending' LIMIT 1").get(botId, code) as Row | undefined;
    return r ? this.toAccess(r) : undefined;
  }
  /** 待处理请求占用的配对码（与审批码同是 4 位数字，不能撞） */
  pendingAccessCodes(): string[] {
    return (this.db.prepare("SELECT code FROM access WHERE status = 'pending' AND code != ''").all() as Row[]).map((r) => String(r.code));
  }
  /** since 之后通知过主人的请求数（限频） */
  accessNotifiedSince(botId: string, since: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM access WHERE bot_id = ? AND notified_at > 0 AND notified_at > ?").get(botId, since) as Row;
    return Number(r.n);
  }

  // ---------- outbox（持久化的出站消息，见 core/outbox.ts） ----------
  private toOutbox(r: Row): OutboxRow {
    let body: OutboxBody = {};
    try {
      body = JSON.parse(String(r.body)) as OutboxBody;
    } catch {
      body = {};
    }
    return {
      id: String(r.id),
      seq: Number(r.seq),
      botId: String(r.bot_id),
      channel: String(r.channel),
      conversationId: String(r.conversation_id),
      peerId: String(r.peer_id),
      kind: String(r.kind) as OutboxKind,
      body,
      replyTo: String(r.reply_to),
      status: String(r.status) as OutboxStatus,
      attempts: Number(r.attempts),
      progress: Number(r.progress),
      due: Number(r.due),
      error: String(r.error),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      expiresAt: Number(r.expires_at),
      sentAt: Number(r.sent_at),
      dismissed: Number(r.dismissed) === 1,
    };
  }
  /** 同一 id 只写一次；返回是否是新写入的 */
  insertOutbox(o: Pick<OutboxRow, "id" | "botId" | "channel" | "conversationId" | "peerId" | "kind" | "body" | "replyTo" | "due" | "createdAt" | "expiresAt">): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox(id, seq, bot_id, channel, conversation_id, peer_id, kind, body, reply_to, due, created_at, updated_at, expires_at)
         VALUES(?, (SELECT IFNULL(MAX(seq), 0) + 1 FROM outbox), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(o.id, o.botId, o.channel, o.conversationId, o.peerId, o.kind, JSON.stringify(o.body), o.replyTo, o.due, o.createdAt, o.createdAt, o.expiresAt);
    return Number(res.changes) > 0;
  }
  getOutbox(id: string): OutboxRow | undefined {
    const r = this.db.prepare("SELECT * FROM outbox WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toOutbox(r) : undefined;
  }
  /** 还没发出去的，按写入顺序 */
  pendingOutbox(limit = 1000): OutboxRow[] {
    return (this.db.prepare("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?").all(limit) as Row[]).map((r) => this.toOutbox(r));
  }
  updateOutbox(id: string, patch: Partial<Pick<OutboxRow, "status" | "attempts" | "progress" | "due" | "error" | "sentAt" | "dismissed">>, now = Date.now()): void {
    const cols: Record<string, string> = { status: "status", attempts: "attempts", progress: "progress", due: "due", error: "error", sentAt: "sent_at", dismissed: "dismissed" };
    const keys = (Object.keys(patch) as Array<keyof typeof patch>).filter((k) => k in cols);
    if (!keys.length) return;
    const vals = keys.map((k) => (typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : (patch[k] as string | number)));
    this.db.prepare(`UPDATE outbox SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now, id);
  }
  listOutbox(opts: { botId?: string; status?: OutboxStatus; dismissed?: boolean; since?: number; limit?: number } = {}): OutboxRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.botId) (where.push("bot_id = ?"), args.push(opts.botId));
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    if (opts.dismissed !== undefined) (where.push("dismissed = ?"), args.push(opts.dismissed ? 1 : 0));
    if (opts.since) (where.push("updated_at >= ?"), args.push(opts.since));
    const sql = `SELECT * FROM outbox ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq DESC LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 100))}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.toOutbox(r));
  }
  /** 启动时：等着退避重试的马上再试一次 */
  resumeOutbox(now = Date.now()): number {
    return Number(this.db.prepare("UPDATE outbox SET due = ? WHERE status = 'pending' AND due > ?").run(now, now).changes);
  }
  /** 清理：发出去的留 7 天（这期间同一 id 不会再发），发不出去的留 30 天 */
  pruneOutbox(now = Date.now()): void {
    this.db.prepare("DELETE FROM outbox WHERE (status = 'sent' AND updated_at < ?) OR (status = 'gone' AND updated_at < ?)").run(now - 7 * 86400_000, now - 30 * 86400_000);
  }
}

function parseSettings(v: unknown): BotSettings {
  try {
    return normalizeSettings(JSON.parse(String(v ?? "{}")));
  } catch {
    return normalizeSettings({});
  }
}
