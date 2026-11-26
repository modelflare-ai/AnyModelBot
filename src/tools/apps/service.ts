/**
 * 连接应用：内置的 10 个应用连接器（catalog.ts）和用户自己添加的自定义 MCP。连接一次，默认所有机器人都能用，
 * 可以按机器人、按工具收窄（机器人设置的 apps，见 domain/bot-settings.ts）。
 *
 * 一个应用在应用页只有一张卡片，下面可以有几个账号。账号有两种来历，对用户是同一套卡片、状态和审批：
 * - MCP 连接（McpConnectionStore）：远程 Streamable HTTP（连不上再试旧式 SSE）或本地命令，这里由主程序来连
 * - 原有的实现（accounts/：Notion 的令牌和一键授权、飞书用用户身份读消息）：升级前连好的账号照旧能用，不用重新授权；
 *   它们给模型的仍是原来那几个工具（notion_search、feishu_read_chat…），没有搬到 MCP 的原始工具上
 *
 * 模型怎么用：现有账号的那几个工具照旧直接给；MCP 连接的工具不一个个塞给模型（连几个应用就是上百个工具定义），
 * 而是三个固定的工具：app_tools 找工具、app_tool_schema 看参数、app_call 执行（dsh-runtime/plugins/amb-connections.mjs）。
 * 这样对话中途连上的应用马上能用，工具再多也不撑大每次请求。
 *
 * 审批（gate）：只读直接用；写入按机器人的权限档位（只读机器人不给，默认档位先问、可以「以后都允许」，完全权限直接执行）；
 * 删除和对外发送任何档位都每次问。「只观察」的规则不能写。判定在这里，问用户在 agent/manager.ts。
 *
 * 凭证只在主程序里（secrets.ts），不进机器人进程、不进数据库、不进日志。
 */
import crypto from "node:crypto";
import path from "node:path";
import { logger, redactText } from "../../log.js";
import { lang, t } from "../../i18n/index.js";
import type { BotApps, PermissionPreset } from "../../domain/bot-settings.js";
import type { ConnectedAccount } from "../accounts/index.js";
import { ConnectionError } from "../accounts/index.js";
import type { ConnectionService } from "../accounts/connections.js";
import { NOTION_WRITE_OPS } from "../accounts/notion.js";
import { BUILTIN_APPS, CUSTOM_APP, MAX_CUSTOM, appName, builtinApp, matchesAppName, customIdOf, customKey, isCustomKey, type BuiltinApp, type BuiltinMethod } from "./catalog.js";
import { describeTools, keyParams, toolHash, type ClassifyContext } from "./classify.js";
import { McpFailure, McpSession, type McpTarget, type RawTool } from "./mcp-client.js";
import { OAuthFlowError, OAuthManager, type OAuthChallenge } from "./oauth.js";
import { registerSecretsIn, type SecretStore } from "./secrets.js";
import { McpConnectionStore } from "./store.js";
import { ATTENTION_STATES, AUTH_METHODS, AppError, TOOL_CATEGORIES, type AuthMethod, type ConnState, type McpConnection, type McpSecrets, type ToolCategory, type ToolInfo } from "./types.js";

const log = logger("apps");

/** 界面上密钥的占位：编辑已保存的连接时，没改的值原样发回这个，这里保留已存的那一份（ui/lib/connector-config.js） */
export const MASK = "••••••••";
/** 远程测试最多等多久；超时按「连不上」 */
const REMOTE_TEST_MS = 30_000;
/** 本地命令测试最多等多久；超时按「本地程序启动失败」 */
const LOCAL_TEST_MS = 8_000;
/** npx、uvx 这类第一次要先下载软件包：没成功启动过的给足时间，下载不算进那 8 秒 */
const LOCAL_FIRST_RUN_MS = 180_000;
const CALL_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 30_000;
/** 连着的会话多久没用就关掉（本地程序不一直占着内存） */
const SESSION_IDLE_MS = 5 * 60_000;
/** 一次工具结果的上限（字符） */
export const MAX_RESULT = 60_000;
/** app_tools 一次最多列几个 */
const MAX_LISTED = 40;
const PACKAGE_RUNNERS = /^(npx|uvx|bunx|pnpm|yarn|docker|pipx|uv)(\.cmd|\.exe)?$/i;

/** 现有实现的那几个工具（dsh-runtime/plugins/amb-connections.mjs 里注册的名字）。op 是 accounts/ 里的操作名 */
export const LEGACY_TOOLS: Record<"notion" | "feishu", Array<{ name: string; op: string; category: ToolCategory }>> = {
  notion: [
    { name: "notion_search", op: "search", category: "read" },
    { name: "notion_read_page", op: "read", category: "read" },
    { name: "notion_query_database", op: "query", category: "read" },
    { name: "notion_create_page", op: "create", category: "write" },
    { name: "notion_update_page", op: "update", category: "write" },
  ],
  feishu: [
    { name: "feishu_list_chats", op: "chats", category: "read" },
    { name: "feishu_read_chat", op: "read", category: "read" },
    { name: "feishu_search_messages", op: "search", category: "read" },
  ],
};
type LegacyService = keyof typeof LEGACY_TOOLS;
const isLegacyService = (app: string): app is LegacyService => app === "notion" || app === "feishu";

function legacyToolInfo(service: LegacyService): ToolInfo[] {
  return LEGACY_TOOLS[service].map((x) => ({ name: x.name, description: "", inputSchema: { type: "object" }, category: x.category, hash: toolHash({ name: x.name }) }));
}

/** 一个应用下面的一个账号：现有实现的（legacy）或 MCP 连接 */
export type AppAccount =
  | { kind: "legacy"; id: string; label: string; createdAt: number; account: ConnectedAccount }
  | { kind: "mcp"; id: string; label: string; createdAt: number; conn: McpConnection };

/** 界面上的一个账号（没有任何凭证） */
export interface AccountView {
  id: string;
  /** 这个应用里的第几个，从 1 开始（对机器人说「第二个飞书」就是它） */
  number: number;
  label: string;
  primary: boolean;
  /** 怎么连的：oauth 授权登录 · headers 请求头 · query 查询参数 · dedicatedUrl 专属链接 · token 个人 Token · env 环境变量 · none */
  method: string;
  state: ConnState;
  detail?: string;
  tools: number;
  /** 现有实现的账号 */
  legacy?: boolean;
  /** 飞书的现有账号只能读消息：重新授权后可以用云文档 */
  upgradable?: boolean;
}

export interface ToolView {
  name: string;
  title?: string;
  description: string;
  category: ToolCategory;
  hash: string;
  /** 类别是用户改过的 */
  overridden?: boolean;
}

export interface AppView {
  /** 内置应用的 id，或 custom:<连接 id> */
  key: string;
  app: string;
  custom: boolean;
  /** 自定义连接器的名称（内置应用的名字界面自己按语言取） */
  name?: string;
  accounts: AccountView[];
  /** 能不能用：至少有一个账号连着（自定义连接器还要开着） */
  connected: boolean;
  /** 最要紧的状态：有账号要处理凭证时是那个状态 */
  state: ConnState | "none";
  detail?: string;
  access: "all" | string[];
  tools: ToolView[];
  /** 自定义连接器的配置（密钥打码） */
  config?: ConnectorConfigView;
  enabled?: boolean;
  /** 本地程序最后输出的几行（查看日志） */
  log?: string;
}

/** 自定义连接器的配置给界面：名字和地址原样，密钥只有名字、值是 MASK */
export interface ConnectorConfigView {
  transport: "http" | "stdio";
  url?: string;
  sse?: boolean;
  auth: AuthMethod;
  headers?: Array<[string, string]>;
  query?: Array<[string, string]>;
  oauth?: { clientId: string; clientSecret: string; scopes: string[]; pkce: boolean };
  command?: string;
  args?: string[];
  env?: Array<[string, string]>;
}

/** 界面发来的自定义连接器配置（ui/lib/connector-config.js 的 draft） */
export interface ConnectorDraft {
  name?: string;
  transport: "http" | "stdio";
  url?: string;
  sse?: boolean;
  auth?: AuthMethod;
  headers?: Array<[string, string]>;
  query?: Array<[string, string]>;
  oauth?: { clientId?: string; clientSecret?: string; scopes?: string[]; pkce?: boolean };
  command?: string;
  args?: string[];
  env?: Array<[string, string]>;
}

/** 等用户在浏览器里授权的一次连接 */
export interface ConnectFlow {
  id: string;
  app: string;
  state: "waiting" | "done" | "failed" | "cancelled";
  /** 授权页地址（弹不出浏览器时界面给一个可复制的链接） */
  url: string;
  /** 给用户看的失败原因 */
  error?: string;
  /** 连上之后：是哪个应用的哪个账号 */
  key?: string;
  accountId?: string;
}

interface FlowState extends ConnectFlow {
  draft: McpConnection;
  secrets: McpSecrets;
  /** 已经存在的连接（重新授权、自定义连接器）：不管成不成都留着；新连的内置应用成功了才存 */
  existing: boolean;
  createdAt: number;
}

/** 给用户看的连接错误（弹窗里输入框下面那一行），已经是当前语言 */
export class AppUserError extends Error {
  constructor(
    message: string,
    readonly state?: ConnState,
  ) {
    super(message);
    this.name = "AppUserError";
  }
}

export interface GateInput {
  permission: PermissionPreset;
  /** 规则（3d）会话：observe 只观察 */
  ruleMode?: "observe" | "act";
  apps: BotApps;
  /** 目录 Bot 没声明 accounts 权限：一个应用都不能用 */
  allowed: boolean;
}

export type GateDecision = { action: "allow" } | { action: "deny"; reason: string } | { action: "ask"; always: boolean };

export interface AppServiceOptions {
  kv: { getKV(key: string): string | undefined; setKV(key: string, value: string): void };
  secrets: SecretStore;
  /** 现有的 Notion、飞书账号 */
  connections: ConnectionService;
  fetch?: () => typeof fetch | undefined;
  /** 测试注入：怎么连一台 MCP 服务器 */
  open?: (target: McpTarget, opts: { timeoutMs: number }) => Promise<McpSession>;
  /** 随安装包带的语雀 MCP 在哪（vendor/yuque-mcp/yuque-mcp.mjs，打包后在 resources/yuque-mcp；由 app.ts 给）。没有就连不了语雀 */
  yuqueProgram?: () => string | undefined;
  now?: () => number;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** 专属链接、带 Key 的地址给界面和日志的样子：只留到主机，后面打码 */
export function maskedUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/${MASK}`;
  } catch {
    return MASK;
  }
}

export class AppService {
  readonly store: McpConnectionStore;
  readonly oauth: OAuthManager;
  private sessions = new Map<string, { opening: Promise<McpSession>; usedAt: number }>();
  private flows = new Map<string, FlowState>();
  private logs = new Map<string, string>();
  private listeners = new Set<() => void>();
  private sweeper: NodeJS.Timeout | undefined;
  /** 正在测试的连接（界面上显示「测试中…」；不写进数据库） */
  private testing = new Set<string>();

  constructor(private o: AppServiceOptions) {
    this.store = new McpConnectionStore(o.kv, o.secrets);
    this.oauth = new OAuthManager({ fetch: o.fetch, now: o.now });
    this.store.onChange(() => this.emit());
    o.connections.accounts.onChange(() => this.emit());
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** 连接变了（添加、移除、状态、工具清单、谁能用）：机器人的工具清单和提示跟着更新 */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        log.warn("apps listener failed", { message: (e as Error).message });
      }
    }
  }

  start(): void {
    this.sweeper ??= setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => s.opening.then((x) => x.close()).catch(() => {})));
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, s] of this.sessions) {
      if (now - s.usedAt < SESSION_IDLE_MS) continue;
      this.sessions.delete(id);
      void s.opening.then((x) => x.close()).catch(() => {});
    }
    for (const [id, f] of this.flows) if (now - f.createdAt > 15 * 60_000) this.flows.delete(id);
  }

  // ---------- 账号 ----------

  /** 一个应用下面的账号：现有实现的在前（按原来的顺序），MCP 连接按添加时间接在后面，序号从 1 开始 */
  accounts(app: string): AppAccount[] {
    const legacy: AppAccount[] = isLegacyService(app) ? this.o.connections.accounts.list(app).map((a) => ({ kind: "legacy", id: a.id, label: a.label, createdAt: a.createdAt, account: a })) : [];
    const mcp: AppAccount[] = this.store
      .list(app)
      .map((c): AppAccount => ({ kind: "mcp", id: c.id, label: c.label, createdAt: c.createdAt, conn: c }));
    // 稳定排序：时间一样（很早的账号没有时间）时保持现有账号在前
    return [...legacy, ...mcp].map((a, i) => ({ a, i })).sort((x, y) => x.a.createdAt - y.a.createdAt || x.i - y.i).map((x) => x.a);
  }

  private labelTaken(app: string, label: string, except?: string): boolean {
    const lower = label.toLowerCase();
    const pool = app === CUSTOM_APP ? this.store.list(CUSTOM_APP).map((c) => ({ id: c.id, label: c.label })) : this.accounts(app);
    return pool.some((a) => a.id !== except && a.label.toLowerCase() === lower);
  }

  /** 没人用的名字：重名时加序号，不覆盖 */
  private freeLabel(app: string, wanted: string, except?: string): string {
    const raw = wanted.trim().slice(0, 76) || (app === CUSTOM_APP ? "MCP" : appName(app, lang()));
    const base = /^\d+$/.test(raw) ? `${app === CUSTOM_APP ? "MCP" : appName(app, lang())} ${raw}` : raw;
    if (!this.labelTaken(app, base, except)) return base;
    for (let n = 2; ; n++) {
      const next = `${base} ${n}`;
      if (!this.labelTaken(app, next, except)) return next;
    }
  }

  /**
   * 模型给的 account：序号或名字。没给时：只有一个就是它，有主账号用主账号，否则报错列出来让模型选或问用户。
   * only：这次调用只能用哪一种账号（现有的那几个工具只能用现有账号，app_call 只能用 MCP 连接）。
   */
  resolveAccount(app: string, selector: unknown, only: "legacy" | "mcp"): AppAccount {
    const all = this.accounts(app);
    const name = appName(app);
    const usable = all.filter((a) => a.kind === only);
    const listText = () => all.map((a, i) => `${i + 1}. ${a.label}`).join("\n");
    const other = (a: AppAccount, n: number) =>
      new AppError(
        only === "legacy"
          ? `${name} account ${n} (${a.label}) is connected through the app connector: use app_tools and app_call with app "${app}" and account ${n}.`
          : `${name} account ${n} (${a.label}) uses the built-in ${name} tools (${LEGACY_TOOLS[app as LegacyService]?.map((x) => x.name).join(", ")}): call those with account ${n}.`,
      );
    if (!all.length) throw new AppError(`No ${name} account is connected.`, { app, state: "off" });
    const raw = selector === undefined || selector === null ? "" : String(selector).trim();
    if (!raw) {
      if (usable.length === 1) return usable[0];
      const primary = this.store.primary()[app];
      const pick = usable.find((a) => a.id === primary);
      if (pick) return pick;
      if (!usable.length) throw other(all[0], 1);
      throw new AppError(`Several ${name} accounts are connected. Say which one with account (number or name), or ask the user:\n${listText()}`);
    }
    let hit: AppAccount | undefined;
    let number = 0;
    if (/^\d+$/.test(raw)) {
      number = Number(raw);
      hit = all[number - 1];
    }
    if (!hit) {
      const lower = raw.toLowerCase();
      const exact = all.filter((a) => a.label.toLowerCase() === lower);
      const near = exact.length ? exact : all.filter((a) => a.label.toLowerCase().includes(lower));
      if (near.length > 1) throw new AppError(`Several ${name} accounts match "${raw.slice(0, 80)}". Say which one by number, or ask the user:\n${listText()}`);
      hit = near[0];
      number = hit ? all.indexOf(hit) + 1 : 0;
    }
    if (!hit) throw new AppError(`There is no ${name} account "${raw.slice(0, 80)}". Connected accounts:\n${listText()}`);
    if (hit.kind !== only) throw other(hit, number);
    return hit;
  }

  // ---------- 给界面的 ----------

  private methodOf(a: AppAccount): string {
    if (a.kind === "legacy") return a.account.auth.kind === "notion-token" ? "token" : "oauth";
    const c = a.conn;
    if (c.transport === "stdio") return c.builtinCommand ? "token" : c.envNames?.length ? "env" : "none";
    return c.auth;
  }

  private stateOfAccount(a: AppAccount): ConnState {
    if (a.kind === "legacy") return a.account.needsReauth ? "expired" : "connected";
    if (this.testing.has(a.conn.id)) return "testing";
    return a.conn.state;
  }

  private classifyContext(app: string, overrides?: Record<string, ToolCategory>): ClassifyContext {
    const b = builtinApp(app);
    return { trusted: !!b, fixed: b?.categories, allRead: b?.allRead, overrides };
  }

  private toolViews(tools: ToolInfo[], overrides?: Record<string, ToolCategory>): ToolView[] {
    return tools.map((x) => ({ name: x.name, ...(x.title ? { title: x.title } : {}), description: x.description.slice(0, 600), category: x.category, hash: x.hash, ...(overrides?.[x.name] ? { overridden: true } : {}) }));
  }

  /** 一个应用的全部工具（各账号的并集）：现有实现的那几个 + MCP 连接报的 */
  toolsOf(app: string, accounts = this.accounts(app)): ToolInfo[] {
    const seen = new Set<string>();
    const out: ToolInfo[] = [];
    const add = (list: ToolInfo[]) => {
      for (const x of list) {
        if (seen.has(x.name)) continue;
        seen.add(x.name);
        out.push(x);
      }
    };
    if (isLegacyService(app) && accounts.some((a) => a.kind === "legacy")) add(legacyToolInfo(app));
    for (const a of accounts) if (a.kind === "mcp") add(a.conn.tools);
    return out;
  }

  private worst(states: ConnState[]): ConnState | "none" {
    if (!states.length) return "none";
    for (const s of ATTENTION_STATES) if (states.includes(s)) return s;
    for (const s of ["local-failed", "unreachable", "testing", "connected", "off"] as ConnState[]) if (states.includes(s)) return s;
    return states[0];
  }

  private accountView(app: string, a: AppAccount, number: number, primary: string | undefined): AccountView {
    const state = this.stateOfAccount(a);
    return {
      id: a.id,
      number,
      label: a.label,
      primary: primary === a.id,
      method: this.methodOf(a),
      state,
      ...(a.kind === "mcp" && a.conn.detail && state !== "connected" ? { detail: a.conn.detail } : {}),
      tools: a.kind === "legacy" ? LEGACY_TOOLS[app as LegacyService].length : a.conn.tools.length,
      ...(a.kind === "legacy" ? { legacy: true } : {}),
      ...(a.kind === "legacy" && app === "feishu" ? { upgradable: true } : {}),
    };
  }

  private configView(c: McpConnection): ConnectorConfigView {
    if (c.transport === "stdio") return { transport: "stdio", auth: "none", command: c.command ?? "", args: c.args ?? [], env: (c.envNames ?? []).map((k) => [k, MASK]) };
    return {
      transport: "http",
      url: c.auth === "dedicatedUrl" ? MASK : (c.url ?? ""),
      ...(c.sse ? { sse: true } : {}),
      auth: c.auth,
      headers: (c.headerNames ?? []).map((k) => [k, MASK]),
      query: (c.queryNames ?? []).map((k) => [k, MASK]),
      oauth: { clientId: c.oauth?.clientId ?? "", clientSecret: this.store.secrets(c.id).oauth?.clientSecret && c.oauth?.clientId ? MASK : "", scopes: c.oauth?.scopes ?? [], pkce: c.oauth?.pkce !== false },
    };
  }

  /** 应用页：内置应用（连没连都列）和自定义连接器 */
  view(): { apps: AppView[]; attention: boolean; customCount: number; maxCustom: number } {
    const access = this.store.access();
    const primary = this.store.primary();
    const apps: AppView[] = [];
    for (const b of BUILTIN_APPS) {
      const accounts = this.accounts(b.id);
      const views = accounts.map((a, i) => this.accountView(b.id, a, i + 1, primary[b.id]));
      const state = this.worst(views.map((v) => v.state));
      const lead = views.find((v) => v.state === state);
      const overrides = Object.assign({}, ...accounts.map((a) => (a.kind === "mcp" ? (a.conn.categoryOverrides ?? {}) : {})));
      apps.push({
        key: b.id,
        app: b.id,
        custom: false,
        accounts: views,
        connected: views.some((v) => v.state === "connected"),
        state,
        ...(lead?.detail ? { detail: lead.detail } : {}),
        access: access[b.id] ?? "all",
        tools: this.toolViews(this.toolsOf(b.id, accounts), overrides),
      });
    }
    const custom = this.store.list(CUSTOM_APP);
    for (const c of custom) {
      const key = customKey(c.id);
      const a: AppAccount = { kind: "mcp", id: c.id, label: c.label, createdAt: c.createdAt, conn: c };
      const state = this.stateOfAccount(a);
      apps.push({
        key,
        app: CUSTOM_APP,
        custom: true,
        name: c.label,
        accounts: [this.accountView(CUSTOM_APP, a, 1, undefined)],
        connected: c.enabled && state === "connected",
        state: !c.enabled && (state === "connected" || state === "off") ? "off" : state,
        ...(c.detail && state !== "connected" ? { detail: c.detail } : {}),
        access: access[key] ?? "all",
        tools: this.toolViews(c.tools, c.categoryOverrides),
        config: this.configView(c),
        enabled: c.enabled,
        ...(this.logs.get(c.id) ? { log: this.logs.get(c.id) } : {}),
      });
    }
    return { apps, attention: this.attention(), customCount: custom.length, maxCustom: MAX_CUSTOM };
  }

  /** 有没有要用户处理凭证的连接（应用页入口和机器人设置上的提醒点） */
  attention(): boolean {
    if (this.o.connections.accounts.list().some((a) => a.needsReauth)) return true;
    return this.store.list().some((c) => (c.app !== CUSTOM_APP || c.enabled) && ATTENTION_STATES.includes(c.state));
  }

  // ---------- 连接 ----------

  private yuqueProgram(): string | undefined {
    return this.o.yuqueProgram?.();
  }

  private target(conn: McpConnection, secrets: McpSecrets): McpTarget {
    if (conn.transport === "stdio") {
      if (conn.builtinCommand === "yuque") {
        const program = this.yuqueProgram();
        if (!program) throw new McpFailure("spawn", "The bundled Yuque connector is missing.");
        return { transport: "stdio", command: process.execPath, args: [program], env: { ...(secrets.env ?? {}), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } };
      }
      return { transport: "stdio", command: conn.command ?? "", args: conn.args ?? [], env: secrets.env ?? {} };
    }
    let url = secrets.url ?? conn.url ?? "";
    if (secrets.query && Object.keys(secrets.query).length) {
      try {
        const u = new URL(url);
        for (const [k, v] of Object.entries(secrets.query)) u.searchParams.set(k, v);
        url = u.toString();
      } catch {
        /* 地址不对：连的时候会报 */
      }
    }
    const oauth = conn.auth === "oauth" || !!secrets.oauth?.accessToken;
    return {
      transport: "http",
      url,
      headers: secrets.headers ?? {},
      fetch: this.o.fetch?.(),
      preferSse: conn.sse === true,
      ...(oauth
        ? {
            auth: {
              token: () => this.accessToken(conn.id, secrets),
              onUnauthorized: async () => {
                await this.refreshTokens(conn.id);
              },
            },
          }
        : {}),
    };
  }

  /** 授权登录的访问令牌：快到期就先续期（续期失败时还是给旧的，让服务器说它过期了） */
  private async accessToken(id: string, fresh?: McpSecrets): Promise<string | undefined> {
    // 存着的优先（续期后的新令牌在那里）；刚授权完、还没存的那一次测试用传进来的
    const stored = this.store.secrets(id).oauth;
    const s = stored?.accessToken ? stored : fresh?.oauth;
    if (!s?.accessToken) return undefined;
    if (s !== stored) return s.accessToken;
    if (s.expiresAt && s.refreshToken && s.expiresAt - this.now() < 60_000) {
      try {
        return (await this.refreshTokens(id)) ?? s.accessToken;
      } catch {
        return s.accessToken;
      }
    }
    return s.accessToken;
  }

  /** 续期并马上落盘（有的服务每次都轮换 refresh token）。授权不再有效时抛 OAuthFlowError("exchange") */
  private async refreshTokens(id: string): Promise<string | undefined> {
    const conn = this.store.get(id) ?? [...this.flows.values()].find((f) => f.draft.id === id)?.draft;
    const secrets = this.store.secrets(id);
    const s = secrets.oauth;
    if (!conn || !s?.refreshToken || !s.clientId) throw new OAuthFlowError("exchange", "No refresh token.");
    const next = await this.oauth.refresh({ key: id, serverUrl: secrets.url ?? conn.url ?? "", client: { clientId: s.clientId, clientSecret: s.clientSecret, issuer: s.issuer }, refreshToken: s.refreshToken });
    // 续期期间连接可能被删了：不要把凭证写回去
    if (this.store.get(id)) this.store.setSecrets(id, { ...secrets, oauth: { ...s, accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt, ...(next.scope ? { scope: next.scope } : {}) } });
    return next.accessToken;
  }

  private open(target: McpTarget, timeoutMs: number): Promise<McpSession> {
    return (this.o.open ?? McpSession.open)(target, { timeoutMs });
  }

  private testTimeout(conn: McpConnection): number {
    if (conn.transport === "http") return REMOTE_TEST_MS;
    if (conn.builtinCommand) return LOCAL_TEST_MS * 2;
    return !conn.startedOnce && PACKAGE_RUNNERS.test(conn.command ?? "") ? LOCAL_FIRST_RUN_MS : LOCAL_TEST_MS;
  }

  private dropSession(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    void s.opening.then((x) => x.close()).catch(() => {});
  }

  /** 这条连接的会话：连着的接着用，没有就连一次 */
  private async session(conn: McpConnection): Promise<McpSession> {
    const cur = this.sessions.get(conn.id);
    if (cur) {
      const s = await cur.opening.catch(() => undefined);
      if (s && !s.closed) {
        cur.usedAt = this.now();
        return s;
      }
      this.sessions.delete(conn.id);
    }
    const opening = (async () => this.open(this.target(conn, this.store.secrets(conn.id)), this.testTimeout(conn)))();
    this.sessions.set(conn.id, { opening, usedAt: this.now() });
    try {
      return await opening;
    } catch (e) {
      if (this.sessions.get(conn.id)?.opening === opening) this.sessions.delete(conn.id);
      throw e;
    }
  }

  /** 失败对应哪个状态。凭证被拒时按认证方式分：授权登录要重新授权，请求头 / 查询参数 / 环境变量改密钥，专属链接换链接 */
  private failureState(conn: McpConnection, secrets: McpSecrets, f: McpFailure): { state: ConnState; detail: string } {
    if (f.kind === "spawn") return { state: "local-failed", detail: /not found/i.test(f.message) ? "notFound" : /in time/i.test(f.message) ? "timeout" : /missing/i.test(f.message) ? "missing" : "exited" };
    if (conn.transport === "stdio") return { state: "local-failed", detail: f.kind === "timeout" ? "timeout" : "exited" };
    if (f.kind === "unauthorized") {
      if (conn.auth === "oauth") return { state: secrets.oauth?.accessToken ? "expired" : "needs-login", detail: "" };
      if (conn.auth === "dedicatedUrl") return { state: "link-invalid", detail: "" };
      if (conn.auth === "auto") return { state: "needs-login", detail: "" };
      return { state: "key-rejected", detail: "" };
    }
    // 连上了却不是 MCP 的回答：地址里带着凭证的（专属链接、Key 在地址里）多半是凭证不对（高德对错的 Key 回一段普通 JSON）
    if (f.kind === "protocol" && conn.auth === "dedicatedUrl") return { state: "link-invalid", detail: "" };
    if (f.kind === "protocol" && conn.auth === "query") return { state: "key-rejected", detail: "" };
    if ((f.status === 404 || f.status === 410) && conn.auth === "dedicatedUrl") return { state: "link-invalid", detail: "" };
    return { state: "unreachable", detail: f.kind === "timeout" ? "timeout" : f.status ? `http${f.status}` : f.kind === "protocol" ? "protocol" : "network" };
  }

  /**
   * 测试一条连接（还没存的也行）：连上、列出工具。成功回带着工具清单的连接；失败回带着状态的连接和原因。
   * 不改数据库：调用方决定存不存。
   */
  private async probe(conn: McpConnection, secrets: McpSecrets): Promise<{ ok: true; conn: McpConnection; session: McpSession } | { ok: false; conn: McpConnection; failure: McpFailure }> {
    let session: McpSession | undefined;
    // 还没存的凭证也先登记到日志脱敏：测试失败时本地程序的输出、报错里可能带着它
    registerSecretsIn(secrets);
    try {
      session = await this.open(this.target(conn, secrets), this.testTimeout(conn));
      const raw: RawTool[] = await session.listTools(LIST_TIMEOUT_MS);
      const tools = describeTools(raw, this.classifyContext(conn.app, conn.categoryOverrides));
      this.logs.delete(conn.id);
      return { ok: true, session, conn: { ...conn, state: "connected", detail: undefined, tools, checkedAt: this.now(), ...(conn.transport === "http" ? { sse: session.usedSse || undefined } : { startedOnce: true }) } };
    } catch (e) {
      void session?.close();
      const failure = e instanceof McpFailure ? e : new McpFailure("unreachable", "Could not reach the server.");
      if (e instanceof OAuthFlowError) {
        const f = new McpFailure(e.code === "unavailable" ? "unreachable" : "unauthorized", e.message, 401);
        const st = this.failureState(conn, secrets, f);
        return { ok: false, failure: f, conn: { ...conn, ...st, detail: st.detail || undefined, checkedAt: this.now() } };
      }
      if (!(e instanceof McpFailure)) log.warn("connection test failed", { app: conn.app, message: redactText(String((e as Error)?.message ?? e)).slice(0, 200) });
      if (failure.output) {
        this.logs.set(conn.id, failure.output);
        log.warn("local program failed to start", { app: conn.app, name: conn.label, output: failure.output.slice(-1500) });
      }
      const st = this.failureState(conn, secrets, failure);
      return { ok: false, failure, conn: { ...conn, ...st, detail: st.detail || undefined, checkedAt: this.now() } };
    }
  }

  /** 这个状态给用户看的一句话（连接弹窗里输入框下面那一行） */
  private userMessage(conn: McpConnection, state: ConnState): string {
    if (conn.app === "yuque" && (state === "key-rejected" || state === "local-failed")) return state === "local-failed" ? t("apps.localFailed") : t("apps.yuqueRejected");
    switch (state) {
      case "key-rejected":
        return t("apps.keyRejected");
      case "link-invalid":
        return t("apps.linkInvalid");
      case "needs-login":
      case "expired":
        return t("apps.needsLogin");
      case "local-failed":
        return t(conn.detail === "notFound" ? "apps.localNotFound" : conn.detail === "timeout" ? "apps.localTimeout" : "apps.localFailed");
      default:
        return t("apps.unreachable");
    }
  }

  /** 把测试通过的会话留着接着用 */
  private keepSession(id: string, session: McpSession): void {
    this.dropSession(id);
    this.sessions.set(id, { opening: Promise.resolve(session), usedAt: this.now() });
  }

  /** 重新测试一条已存的连接，结果写回去。自定义连接器测试通过就开启 */
  async test(id: string): Promise<McpConnection> {
    const conn = this.store.get(id);
    if (!conn) throw new AppUserError(t("apps.notFound"));
    this.testing.add(id);
    this.emit();
    this.dropSession(id);
    try {
      const r = await this.probe(conn, this.store.secrets(id));
      if (!this.store.get(id)) throw new AppUserError(t("apps.notFound"));
      if (r.ok) this.keepSession(id, r.session);
      const { id: _id, ...patch } = r.conn;
      return this.store.update(id, { ...patch, ...(r.ok && conn.app === CUSTOM_APP ? { enabled: true } : {}) })!;
    } finally {
      this.testing.delete(id);
      this.emit();
    }
  }

  /** 应用页打开时：很久没测的、状态是连不上的，在后台再测一次（不打扰用户） */
  refreshStale(maxAgeMs = 10 * 60_000): void {
    const now = this.now();
    for (const c of this.store.list()) {
      if (this.testing.has(c.id) || (c.app === CUSTOM_APP && !c.enabled)) continue;
      if (c.state !== "unreachable" && now - c.checkedAt < maxAgeMs) continue;
      if (c.state === "needs-login" || c.state === "expired" || c.state === "off") continue;
      void this.test(c.id).catch(() => {});
    }
  }

  private builtinMethod(app: BuiltinApp, kind: string | undefined): BuiltinMethod {
    return app.methods.find((m) => m.kind === kind) ?? app.methods[0];
  }

  /**
   * 连接内置应用的一个账号。授权登录回一个 flow（界面打开授权页并轮询）；其余方式当场测试，
   * 通过才存、回连接；不通过抛 AppUserError（弹窗里保留已填内容，可以改完再试），不会留下半成品账号。
   * accountId：已有的账号（重新授权、修改密钥、更新链接）——就地更新，别名和序号不变。
   */
  async connectBuiltin(appId: string, input: { method?: string; variant?: string; token?: string; key?: string; url?: string; redirectUri: string; accountId?: string }): Promise<{ flow: ConnectFlow } | { key: string; accountId: string }> {
    const app = builtinApp(appId);
    if (!app) throw new AppUserError(t("apps.notFound"));
    const existing = input.accountId ? this.store.get(input.accountId) : undefined;
    if (input.accountId && (!existing || existing.app !== appId)) {
      // 飞书的现有账号重新授权：换成 MCP 连接，占原来的位置（别名、序号不变）
      const legacy = isLegacyService(appId) ? this.o.connections.accounts.get(input.accountId) : undefined;
      if (!legacy || appId !== "feishu") throw new AppUserError(t("apps.notFound"));
    }
    const method = existing ? this.methodForExisting(app, existing) : this.builtinMethod(app, input.method);
    const legacyUpgrade = input.accountId && !existing ? this.o.connections.accounts.get(input.accountId) : undefined;
    const base: McpConnection = existing
      ? { ...existing }
      : {
          id: this.store.newId(),
          app: appId,
          label: legacyUpgrade?.label ?? this.freeLabel(appId, ""),
          identity: "",
          transport: "http",
          auth: "none",
          enabled: true,
          state: "off",
          checkedAt: 0,
          tools: [],
          createdAt: legacyUpgrade ? legacyUpgrade.createdAt : this.now(),
        };
    if (!base.identity) base.identity = base.id;
    let secrets: McpSecrets = existing ? this.store.secrets(existing.id) : {};
    const need = (v: string | undefined, key: Parameters<typeof t>[0]) => {
      const s = String(v ?? "").trim();
      if (!s) throw new AppUserError(t(key));
      return s;
    };
    switch (method.kind) {
      case "oauth": {
        const url = method.variants?.find((v) => v.id === input.variant)?.url ?? (existing?.url && !input.variant ? existing.url : method.url);
        const draft: McpConnection = { ...base, transport: "http", url, auth: "oauth", oauth: { pkce: true } };
        const keep = secrets.oauth && hostOf(secrets.url ?? existing?.url ?? "") === hostOf(url) ? secrets.oauth : undefined;
        const flow = await this.startOAuth(draft, { oauth: keep ? { clientId: keep.clientId, clientSecret: keep.clientSecret, redirectUri: keep.redirectUri, issuer: keep.issuer } : undefined }, { redirectUri: input.redirectUri, existing: !!existing, replaces: legacyUpgrade?.id });
        return { flow };
      }
      case "header": {
        const token = need(input.token, "apps.tokenRequired");
        base.transport = "http";
        base.url = method.url;
        base.auth = "headers";
        base.headerNames = [method.header];
        base.oauth = undefined;
        secrets = { headers: { [method.header]: `${method.prefix ?? ""}${token}` } };
        break;
      }
      case "dedicatedUrl": {
        const url = need(input.url, "apps.urlRequired");
        if (!/^https?:\/\/\S+$/i.test(url)) throw new AppUserError(t("apps.badUrl"));
        base.transport = "http";
        base.url = maskedUrl(url);
        base.auth = "dedicatedUrl";
        secrets = { url };
        break;
      }
      case "key": {
        const key = need(input.key, "apps.keyRequired");
        const u = new URL(method.urlTemplate.replace("{key}", "KEY"));
        const param = [...u.searchParams.entries()].find(([, v]) => v === "KEY")?.[0] ?? "key";
        u.searchParams.delete(param);
        base.transport = "http";
        base.url = u.toString();
        base.auth = "query";
        base.queryNames = [param];
        secrets = { query: { [param]: key } };
        break;
      }
      case "localToken": {
        const token = need(input.token, "apps.tokenRequired");
        base.transport = "stdio";
        base.builtinCommand = method.program;
        base.auth = "none";
        base.envNames = method.env;
        secrets = { env: Object.fromEntries(method.env.map((k) => [k, token])) };
        break;
      }
      default:
        throw new AppUserError(t("apps.notFound"));
    }
    this.testing.add(base.id);
    this.emit();
    try {
      const r = await this.probe(base, secrets);
      if (!r.ok) throw new AppUserError(this.userMessage(r.conn, r.conn.state), r.conn.state);
      // 语雀的本地程序拿着错的 Token 也能启动：再调一次最简单的工具，看 Token 能不能用
      if (method.kind === "localToken") {
        const check = await r.session.callTool("yuque_get_user", {}, { timeoutMs: 20_000 }).catch(() => ({ text: "", isError: true }));
        if (check.isError) {
          void r.session.close();
          throw new AppUserError(t("apps.yuqueRejected"), "key-rejected");
        }
        const who = /"name"\s*:\s*"([^"]{1,60})"/.exec(check.text)?.[1] ?? /"login"\s*:\s*"([^"]{1,60})"/.exec(check.text)?.[1];
        if (who && !existing) r.conn.label = this.freeLabel(appId, who);
      }
      this.dropSession(base.id);
      this.store.put(r.conn, secrets);
      this.keepSession(base.id, r.session);
      return { key: appId, accountId: base.id };
    } finally {
      this.testing.delete(base.id);
      this.emit();
    }
  }

  /** 已有账号用的是哪种连接方式（修复时沿用它） */
  private methodForExisting(app: BuiltinApp, c: McpConnection): BuiltinMethod {
    const kind = c.transport === "stdio" ? "localToken" : c.auth === "oauth" ? "oauth" : c.auth === "headers" ? "header" : c.auth === "dedicatedUrl" ? "dedicatedUrl" : c.auth === "query" ? "key" : app.methods[0].kind;
    return this.builtinMethod(app, kind);
  }

  /** 开始授权登录：发现授权服务器、注册、回授权页地址。draft 还没存的话，成功之后才存 */
  private async startOAuth(draft: McpConnection, secrets: McpSecrets, opts: { redirectUri: string; existing: boolean; challenge?: OAuthChallenge; replaces?: string }): Promise<ConnectFlow> {
    const id = crypto.randomUUID();
    const known = secrets.oauth?.clientId ? { clientId: secrets.oauth.clientId, clientSecret: secrets.oauth.clientSecret, redirectUri: secrets.oauth.redirectUri, issuer: secrets.oauth.issuer } : undefined;
    let started: { state: string; url: string };
    try {
      started = await this.oauth.start({
        key: id,
        serverUrl: secrets.url ?? draft.url ?? "",
        redirectUri: opts.redirectUri,
        settings: draft.oauth ?? { pkce: true },
        clientSecret: draft.oauth?.clientId ? secrets.oauth?.clientSecret : undefined,
        // 预注册的客户端不拿上次动态注册的来用
        known: draft.oauth?.clientId ? undefined : known,
        challenge: opts.challenge,
      });
    } catch (e) {
      throw new AppUserError(this.oauthMessage(e));
    }
    const flow: FlowState = { id, app: draft.app, state: "waiting", url: started.url, draft, secrets, existing: opts.existing, createdAt: this.now(), ...(opts.replaces ? { accountId: opts.replaces } : {}) };
    this.flows.set(id, flow);
    return this.publicFlow(flow);
  }

  private oauthMessage(e: unknown): string {
    if (!(e instanceof OAuthFlowError)) {
      log.warn("authorization failed", { message: redactText(String((e as Error)?.message ?? e)).slice(0, 200) });
      return t("apps.oauthFailed");
    }
    const keys = { "no-oauth": "apps.oauthNoOauth", registration: "apps.oauthRegistration", pkce: "apps.oauthPkce", declined: "apps.oauthDeclined", expired: "apps.oauthExpired", exchange: "apps.oauthExchange", unavailable: "apps.oauthUnavailable" } as const;
    return t(keys[e.code]);
  }

  private publicFlow(f: FlowState): ConnectFlow {
    return { id: f.id, app: f.app, state: f.state, url: f.url, ...(f.error ? { error: f.error } : {}), ...(f.key ? { key: f.key } : {}), ...(f.state === "done" && f.accountId ? { accountId: f.accountId } : {}) };
  }

  flow(id: string): ConnectFlow | undefined {
    const f = this.flows.get(id);
    return f ? this.publicFlow(f) : undefined;
  }

  /** 关掉弹窗：这次授权作废，之后回调来了也不会冒出一个连接 */
  cancelFlow(id: string): void {
    const f = this.flows.get(id);
    this.oauth.cancel(id);
    if (f && f.state === "waiting") f.state = "cancelled";
  }

  /** 授权页跳回来（或用户把回跳地址粘贴进来）。回给回调页显示的账号名 */
  async oauthCallback(params: { state?: string | null; code?: string | null; error?: string | null }): Promise<{ label: string }> {
    const key = this.oauth.keyOf(String(params.state ?? ""));
    const f = key ? this.flows.get(key) : undefined;
    if (!f || f.state !== "waiting") throw new AppUserError(t("apps.oauthExpired"));
    try {
      const done = await this.oauth.finish(params);
      const secrets: McpSecrets = {
        ...f.secrets,
        oauth: {
          issuer: done.client.issuer,
          clientId: done.client.clientId,
          clientSecret: done.client.clientSecret,
          redirectUri: done.client.redirectUri,
          accessToken: done.tokens.accessToken,
          refreshToken: done.tokens.refreshToken,
          expiresAt: done.tokens.expiresAt,
          scope: done.tokens.scope,
        },
      };
      const draft: McpConnection = { ...f.draft, auth: "oauth" };
      const r = await this.probe(draft, secrets);
      if (f.state !== "waiting") throw new AppUserError(t("apps.oauthExpired")); // 等测试的时候用户关了弹窗
      if (!r.ok && !f.existing) throw new AppUserError(this.userMessage(r.conn, r.conn.state), r.conn.state);
      const conn: McpConnection = r.ok ? { ...r.conn, ...(draft.app === CUSTOM_APP ? { enabled: true } : {}) } : r.conn;
      // 飞书的现有账号换成 MCP 连接：原来的账号去掉，别名和位置留给新的
      if (f.accountId && !this.store.get(conn.id)) this.o.connections.accounts.remove(f.accountId);
      this.dropSession(conn.id);
      this.store.put(conn, secrets);
      if (r.ok) this.keepSession(conn.id, r.session);
      f.state = "done";
      f.key = conn.app === CUSTOM_APP ? customKey(conn.id) : conn.app;
      f.accountId = conn.id;
      return { label: conn.label };
    } catch (e) {
      f.state = "failed";
      f.error = e instanceof AppUserError ? e.message : this.oauthMessage(e);
      throw e instanceof AppUserError ? e : new AppUserError(f.error);
    }
  }

  /** 授权页没有跳回本机（远程访问、Docker）：用户把浏览器地址栏里的回跳地址粘贴进来 */
  async finishFromUrl(flowId: string, pasted: string): Promise<{ label: string }> {
    let u: URL;
    try {
      u = new URL(pasted.trim());
    } catch {
      throw new AppUserError(t("apps.oauthBadPaste"));
    }
    const state = u.searchParams.get("state");
    if (!state || this.oauth.keyOf(state) !== flowId) throw new AppUserError(t("apps.oauthBadPaste"));
    return this.oauthCallback({ state, code: u.searchParams.get("code"), error: u.searchParams.get("error") });
  }

  // ---------- 自定义连接器 ----------

  private rows(v: unknown, kind: "headers" | "query" | "env"): Array<[string, string]> {
    if (!Array.isArray(v)) return [];
    const out: Array<[string, string]> = [];
    for (const row of v) {
      if (!Array.isArray(row)) continue;
      const k = String(row[0] ?? "").trim();
      const val = String(row[1] ?? "");
      if (!k && !val.trim()) continue;
      if (!k || !val.trim()) throw new AppUserError(t(kind === "headers" ? "apps.badHeaders" : kind === "query" ? "apps.badQuery" : "apps.badEnv"));
      if (kind === "headers" && !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) throw new AppUserError(t("apps.badHeaders"));
      if (kind === "env" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new AppUserError(t("apps.badEnv"));
      out.push([k.slice(0, 200), val.slice(0, 8000)]);
    }
    return out.slice(0, 50);
  }

  /** 表单里的一组键值 → 存的值：还是 MASK 的保留已存的；已存的里面没有（键改名了）就要用户重新填 */
  private unmask(rows: Array<[string, string]>, stored: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of rows) {
      if (v === MASK) {
        const old = stored?.[k];
        if (old === undefined) throw new AppUserError(t("apps.badMasked", { name: k }));
        out[k] = old;
      } else out[k] = v;
    }
    return out;
  }

  /**
   * 添加或修改一个自定义连接器，保存后马上测试。测试通过就开启；不通过也保存，但保持关闭，状态里写着原因。
   * 需要授权登录时回一个 flow。本地命令在调用这里之前，界面已经让用户确认过要运行的完整命令。
   */
  async saveCustom(draft: ConnectorDraft, opts: { id?: string; redirectUri: string }): Promise<{ app: AppView; flow?: ConnectFlow }> {
    const existing = opts.id ? this.store.get(opts.id) : undefined;
    if (opts.id && (!existing || existing.app !== CUSTOM_APP)) throw new AppUserError(t("apps.notFound"));
    if (!existing && this.store.list(CUSTOM_APP).length >= MAX_CUSTOM) throw new AppUserError(t("apps.limit", { max: MAX_CUSTOM }));
    const stored = existing ? this.store.secrets(existing.id) : {};
    const transport = draft.transport === "stdio" ? "stdio" : "http";
    const conn: McpConnection = {
      id: existing?.id ?? this.store.newId(),
      app: CUSTOM_APP,
      label: "",
      identity: "",
      transport,
      auth: "none",
      enabled: false,
      state: "off",
      checkedAt: 0,
      tools: [],
      ...(existing?.categoryOverrides ? { categoryOverrides: existing.categoryOverrides } : {}),
      createdAt: existing?.createdAt ?? this.now(),
    };
    conn.identity = conn.id;
    const secrets: McpSecrets = {};
    let name = String(draft.name ?? "").trim();
    if (transport === "http") {
      const auth: AuthMethod = (AUTH_METHODS as readonly unknown[]).includes(draft.auth) ? draft.auth! : "auto";
      let url = String(draft.url ?? "").trim();
      if (url === MASK) {
        if (!stored.url) throw new AppUserError(t("apps.badUrl"));
        url = stored.url;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new AppUserError(t("apps.badUrl"));
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new AppUserError(t("apps.badUrl"));
      conn.auth = auth;
      if (draft.sse || /\/sse\/?$/i.test(parsed.pathname)) conn.sse = true;
      if (auth === "dedicatedUrl") {
        secrets.url = url;
        conn.url = maskedUrl(url);
      } else conn.url = url;
      if (auth === "headers" || auth === "auto") {
        const rows = this.rows(draft.headers, "headers");
        if (auth === "headers" && !rows.length) throw new AppUserError(t("apps.badHeaders"));
        if (rows.length) {
          secrets.headers = this.unmask(rows, stored.headers);
          conn.headerNames = rows.map(([k]) => k);
          if (auth === "auto") conn.auth = "headers";
        }
      }
      if (auth === "query") {
        const rows = this.rows(draft.query, "query");
        if (!rows.length) throw new AppUserError(t("apps.badQuery"));
        secrets.query = this.unmask(rows, stored.query);
        conn.queryNames = rows.map(([k]) => k);
      }
      if (auth === "oauth" || conn.auth === "auto") {
        const o = draft.oauth ?? {};
        const clientId = String(o.clientId ?? "").trim();
        const scopes = Array.isArray(o.scopes) ? o.scopes.map((s) => String(s).trim()).filter(Boolean).slice(0, 50) : [];
        conn.oauth = { ...(clientId ? { clientId } : {}), ...(scopes.length ? { scopes } : {}), pkce: o.pkce !== false };
        const secret = String(o.clientSecret ?? "");
        const clientSecret = secret === MASK ? stored.oauth?.clientSecret : secret.trim() || undefined;
        // 地址和客户端都没变：留着已有的令牌和注册信息，不用重新授权
        const same = existing && hostOf(stored.url ?? existing.url ?? "") === hostOf(url) && (existing.oauth?.clientId ?? "") === clientId;
        if (same && stored.oauth) secrets.oauth = { ...stored.oauth, ...(clientId ? { clientSecret } : {}) };
        else if (clientId) secrets.oauth = { clientId, clientSecret };
      }
      name ||= nameFromHost(parsed);
    } else {
      const command = String(draft.command ?? "").trim();
      if (!command) throw new AppUserError(t("apps.badCommand"));
      const args = Array.isArray(draft.args) ? draft.args.map((a) => String(a)).filter((a) => a !== "").slice(0, 100) : [];
      const rows = this.rows(draft.env, "env");
      conn.command = command;
      conn.args = args;
      if (rows.length) {
        secrets.env = this.unmask(rows, stored.env);
        conn.envNames = rows.map(([k]) => k);
      }
      if (existing?.command === command && JSON.stringify(existing.args ?? []) === JSON.stringify(args)) conn.startedOnce = existing.startedOnce;
      name ||= path.basename(args.find((a) => !a.startsWith("-")) ?? command).replace(/^@[^/]+\//, "");
    }
    conn.label = this.freeLabel(CUSTOM_APP, name.slice(0, 76), existing?.id);
    this.dropSession(conn.id);

    // 授权登录：先存下来（关着、需要登录），再去授权；用户关掉弹窗也留着，之后可以「去授权」
    const needsOAuth = async (challenge?: OAuthChallenge): Promise<{ app: AppView; flow?: ConnectFlow }> => {
      const saved = this.store.put({ ...conn, auth: "oauth", oauth: conn.oauth ?? { pkce: true }, state: "needs-login", enabled: false }, secrets);
      try {
        const flow = await this.startOAuth(saved, secrets, { redirectUri: opts.redirectUri, existing: true, challenge });
        return { app: this.viewOf(customKey(saved.id))!, flow };
      } catch (e) {
        if (!(e instanceof AppUserError)) throw e;
        // 这台服务器没有授权登录（或不支持动态注册）：留着，状态写明，让用户改成请求头、查询参数或专属链接，或填客户端 ID
        this.store.update(saved.id, { state: conn.auth === "auto" ? "key-rejected" : "needs-login", detail: "oauth" });
        throw e;
      }
    };
    if (conn.auth === "oauth" && !secrets.oauth?.accessToken) return needsOAuth();

    this.testing.add(conn.id);
    this.emit();
    let challenge: OAuthChallenge | undefined;
    let oauthNext = false;
    try {
      const r = await this.probe(conn, secrets);
      if (r.ok) {
        const auth: AuthMethod = conn.auth === "auto" ? "none" : conn.auth;
        this.store.put({ ...r.conn, auth, enabled: true }, secrets);
        this.keepSession(conn.id, r.session);
      } else if (conn.transport === "http" && r.failure.kind === "unauthorized" && (conn.auth === "auto" || conn.auth === "oauth") && (await this.oauth.discover(conn.url ?? "", r.failure.challenge).catch(() => undefined))) {
        // 自动：服务器要登录，而且找得到授权服务器，就走授权登录
        challenge = r.failure.challenge;
        oauthNext = true;
      } else {
        // 自动、服务器要凭证却没有授权登录：请用户改成请求头、查询参数或专属链接
        this.store.put({ ...r.conn, ...(conn.auth === "auto" && r.failure.kind === "unauthorized" ? { state: "key-rejected" as const } : {}), enabled: false }, secrets);
      }
    } finally {
      this.testing.delete(conn.id);
      this.emit();
    }
    if (oauthNext) return needsOAuth(challenge);
    return { app: this.viewOf(customKey(conn.id))! };
  }

  /** 已有的自定义连接器去授权（需要登录、授权过期） */
  async authorizeCustom(id: string, redirectUri: string): Promise<ConnectFlow> {
    const conn = this.store.get(id);
    if (!conn || conn.transport !== "http") throw new AppUserError(t("apps.notFound"));
    const secrets = this.store.secrets(id);
    return this.startOAuth({ ...conn, auth: "oauth", oauth: conn.oauth ?? { pkce: true } }, secrets, { redirectUri, existing: true });
  }

  /** 开启 / 关闭一个自定义连接器。开启时先测试，不通过就还是关着 */
  async setEnabled(id: string, on: boolean): Promise<AppView> {
    const conn = this.store.get(id);
    if (!conn || conn.app !== CUSTOM_APP) throw new AppUserError(t("apps.notFound"));
    if (!on) {
      this.dropSession(id);
      this.store.update(id, { enabled: false });
    } else {
      const next = await this.test(id);
      if (next.state !== "connected") this.store.update(id, { enabled: false });
    }
    return this.viewOf(customKey(id))!;
  }

  viewOf(key: string): AppView | undefined {
    return this.view().apps.find((a) => a.key === key);
  }

  // ---------- 管理 ----------

  /** 断开一个账号（内置应用）或删掉一个自定义连接器 */
  remove(id: string): boolean {
    const conn = this.store.get(id);
    if (conn) {
      this.dropSession(id);
      this.logs.delete(id);
      const ok = this.store.remove(id);
      if (conn.app === CUSTOM_APP) this.store.setAccess(customKey(id), "all");
      this.cleanPrimary(conn.app);
      return ok;
    }
    const legacy = this.o.connections.accounts.get(id);
    if (!legacy) return false;
    const ok = this.o.connections.accounts.remove(id);
    this.cleanPrimary(legacy.service);
    return ok;
  }

  private cleanPrimary(app: string): void {
    const p = this.store.primary()[app];
    if (p && !this.accounts(app).some((a) => a.id === p)) this.store.setPrimary(app, undefined);
  }

  /** 改别名。同一个应用里不能重名，也不能全是数字（模型把数字当序号） */
  rename(id: string, label: string): "ok" | "invalid" | "taken" {
    const name = label.trim().slice(0, 80);
    const conn = this.store.get(id);
    if (conn) {
      if (!name || /^\d+$/.test(name)) return "invalid";
      if (this.labelTaken(conn.app, name, id)) return "taken";
      this.store.update(id, { label: name });
      return "ok";
    }
    const legacy = this.o.connections.accounts.get(id);
    if (!legacy) return "invalid";
    if (name && !/^\d+$/.test(name) && this.store.list(legacy.service).some((c) => c.label.toLowerCase() === name.toLowerCase())) return "taken";
    return this.o.connections.accounts.rename(id, label);
  }

  setPrimary(app: string, accountId: string): boolean {
    if (!this.accounts(app).some((a) => a.id === accountId)) return false;
    this.store.setPrimary(app, accountId);
    return true;
  }

  setAccess(key: string, bots: string[] | "all"): boolean {
    if (isCustomKey(key) ? !this.store.get(customIdOf(key)) : !builtinApp(key)) return false;
    this.store.setAccess(key, bots);
    return true;
  }

  /** 改一个工具的类别（null = 恢复默认）。类别变了，这个工具原来的「以后都允许」不再算数（指纹里不含类别，由 gate 按类别重新判断） */
  setCategory(key: string, tool: string, category: ToolCategory | null): boolean {
    if (category !== null && !TOOL_CATEGORIES.includes(category)) return false;
    const conns = isCustomKey(key) ? [this.store.get(customIdOf(key))].filter((c): c is McpConnection => !!c) : this.store.list(key);
    if (!conns.length) return false;
    for (const c of conns) {
      const overrides = { ...(c.categoryOverrides ?? {}) };
      if (category === null) delete overrides[tool];
      else overrides[tool] = category;
      const ctx = this.classifyContext(c.app, overrides);
      const tools = c.tools.map((x) => ({ ...x, category: describeTools([x], ctx)[0]?.category ?? x.category }));
      this.store.update(c.id, { categoryOverrides: Object.keys(overrides).length ? overrides : undefined, tools });
    }
    return true;
  }

  // ---------- 机器人这边 ----------

  /** 这个机器人能不能用这个应用：应用那边允许它，机器人这边也选了它 */
  allows(botId: string, apps: BotApps, key: string): boolean {
    const access = this.store.access()[key];
    if (access && !access.includes(botId)) return false;
    return apps.mode === "all" || apps.selected.includes(key);
  }

  /** 这个机器人能用的应用（连着的），带着它能用的工具（关掉的不算） */
  botApps(botId: string, input: Pick<GateInput, "apps" | "allowed">): Array<{ key: string; app: string; name: string; accounts: AppAccount[]; tools: ToolInfo[]; legacyTools: string[] }> {
    if (!input.allowed) return [];
    const out: Array<{ key: string; app: string; name: string; accounts: AppAccount[]; tools: ToolInfo[]; legacyTools: string[] }> = [];
    const off = (key: string) => new Set(input.apps.toolsOff[key] ?? []);
    for (const b of BUILTIN_APPS) {
      if (!this.allows(botId, input.apps, b.id)) continue;
      const accounts = this.accounts(b.id).filter((a) => (a.kind === "legacy" ? true : a.conn.state === "connected" || ATTENTION_STATES.includes(a.conn.state) || a.conn.state === "unreachable"));
      if (!accounts.length) continue;
      const disabled = off(b.id);
      const mcp = this.toolsOf(b.id, accounts.filter((a) => a.kind === "mcp")).filter((x) => !disabled.has(x.name));
      const legacy = isLegacyService(b.id) && accounts.some((a) => a.kind === "legacy") ? LEGACY_TOOLS[b.id].map((x) => x.name).filter((n) => !disabled.has(n)) : [];
      out.push({ key: b.id, app: b.id, name: b.name.en, accounts, tools: mcp, legacyTools: legacy });
    }
    for (const c of this.store.list(CUSTOM_APP)) {
      const key = customKey(c.id);
      if (!c.enabled || !this.allows(botId, input.apps, key)) continue;
      const disabled = off(key);
      out.push({ key, app: CUSTOM_APP, name: c.label, accounts: [{ kind: "mcp", id: c.id, label: c.label, createdAt: c.createdAt, conn: c }], tools: c.tools.filter((x) => !disabled.has(x.name)), legacyTools: [] });
    }
    return out;
  }

  /** 没连、但这个机器人可以请用户去连的内置应用 */
  connectable(botId: string, input: Pick<GateInput, "apps" | "allowed">): BuiltinApp[] {
    if (!input.allowed) return [];
    return BUILTIN_APPS.filter((b) => !this.accounts(b.id).length && (!this.store.access()[b.id] || this.store.access()[b.id].includes(botId)));
  }

  /**
   * 代理进程启动时要注册哪些现有工具（amb-connections 插件的 AMB_CONNECTIONS）：
   * { apps: true, tools: [现有工具的名字] }。只读机器人不给写工具；应用没分给它、工具被关掉的也不给。
   */
  pluginConfig(botId: string, input: GateInput): { apps: boolean; tools: string[] } {
    if (!input.allowed) return { apps: false, tools: [] };
    const tools: string[] = [];
    for (const a of this.botApps(botId, input)) {
      for (const name of a.legacyTools) {
        const def = isLegacyService(a.app) ? LEGACY_TOOLS[a.app].find((x) => x.name === name) : undefined;
        if (!def || (def.category !== "read" && input.permission === "readonly")) continue;
        tools.push(name);
      }
    }
    return { apps: true, tools };
  }

  /**
   * 模型写的应用 → 应用的 key（过程区按它显示应用名）：内置应用的 id、中英文名，自定义连接器的 key 或名称。
   * 不看机器人能不能用（没分给它的调用也要显示成没用成）；认不出时 undefined。
   */
  keyOf(selector: string): string | undefined {
    const raw = selector.trim();
    const lower = raw.toLowerCase();
    if (!lower) return undefined;
    const b = BUILTIN_APPS.find((x) => x.id === lower || matchesAppName(x, lower));
    if (b) return b.id;
    const custom = this.store.list(CUSTOM_APP);
    if (isCustomKey(raw) && custom.some((c) => customKey(c.id) === raw)) return raw;
    const hit = custom.find((c) => c.label.toLowerCase() === lower) ?? (lower.length >= 2 ? custom.find((c) => c.label.toLowerCase().includes(lower)) : undefined);
    return hit ? customKey(hit.id) : undefined;
  }

  /**
   * 过程区「正在使用 {应用} · {工具}」的工具名：应用给了显示名称（MCP 工具的 title）就用它；没有、或认不出这个工具时 undefined，
   * 界面用工具名原文。key 是 keyOf 换出来的应用 key。
   */
  toolTitle(key: string, tool: string): string | undefined {
    const name = tool.trim();
    if (!name) return undefined;
    const tools = isCustomKey(key) ? this.store.list(CUSTOM_APP).find((c) => customKey(c.id) === key)?.tools ?? [] : builtinApp(key) ? this.toolsOf(key) : [];
    const hit = tools.find((x) => x.name === name) ?? tools.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return hit?.title?.trim() || undefined;
  }

  /** 模型用 app 参数指一个应用：内置应用的 id 或名字，自定义连接器的名称 */
  private findApp(botId: string, input: Pick<GateInput, "apps" | "allowed">, selector: unknown): { key: string; app: string; name: string; accounts: AppAccount[]; tools: ToolInfo[]; legacyTools: string[] } {
    const raw = String(selector ?? "").trim();
    const lower = raw.toLowerCase();
    const mine = this.botApps(botId, input);
    const hit =
      mine.find((a) => a.key.toLowerCase() === lower) ??
      mine.find((a) => a.name.toLowerCase() === lower || matchesAppName(builtinApp(a.app), lower)) ??
      mine.find((a) => a.name.toLowerCase().includes(lower) && lower.length >= 2);
    if (hit) return hit;
    const builtin = BUILTIN_APPS.find((b) => b.id === lower || matchesAppName(b, lower));
    if (builtin && !this.accounts(builtin.id).length) throw new AppError(`${builtin.name.en} is not connected yet. Call app_connect with app "${builtin.id}" and a short reason, so the user can connect it here.`, { app: builtin.id, state: "off" });
    if (builtin) throw new AppError(`${builtin.name.en} is connected but not available to this bot. The user can change that in this bot's settings under Apps.`);
    throw new AppError(`There is no app "${raw.slice(0, 80)}". Connected apps: ${mine.map((a) => (a.app === CUSTOM_APP ? a.name : a.key)).join(", ") || "none"}.`);
  }

  /** connected_accounts 工具：这个机器人能用的应用、账号，和可以请用户去连的应用 */
  listText(botId: string, input: Pick<GateInput, "apps" | "allowed">): string {
    const mine = this.botApps(botId, input);
    const parts: string[] = [];
    for (const a of mine) {
      const head = a.app === CUSTOM_APP ? `${a.name} (custom connector, app "${a.name}")` : `${a.name} (app "${a.key}")`;
      const accounts = this.accounts(a.app === CUSTOM_APP ? "" : a.app);
      const lines = a.app === CUSTOM_APP ? [] : a.accounts.map((acc) => `  ${accounts.findIndex((x) => x.id === acc.id) + 1}. ${acc.label}${this.stateOfAccount(acc) !== "connected" ? " (needs the user's attention)" : ""}${acc.kind === "legacy" ? ` — use ${LEGACY_TOOLS[a.app as LegacyService].map((x) => x.name).join(", ")}` : ""}`);
      const how = a.tools.length ? `  ${a.tools.length} tools through app_tools / app_call.` : "";
      parts.push([head, ...lines, how].filter(Boolean).join("\n"));
    }
    const more = this.connectable(botId, input).map((b) => b.id);
    return [
      parts.length ? `Connected apps:\n${parts.join("\n")}` : "No apps are connected.",
      more.length ? `Not connected yet (call app_connect when a task needs one): ${more.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** 提示词里的那一段：连了哪些应用、怎么用（agent/prompts） */
  promptText(botId: string, input: Pick<GateInput, "apps" | "allowed">): string {
    const mine = this.botApps(botId, input).filter((a) => a.tools.length);
    const more = this.connectable(botId, input);
    if (!mine.length && !more.length) return "";
    const lines: string[] = [];
    if (mine.length) {
      lines.push(`Connected apps (use app_tools to find a tool, app_tool_schema for its parameters, app_call to run it): ${mine.map((a) => (a.app === CUSTOM_APP ? a.name : `${a.name} ("${a.key}")`)).join(", ")}.`);
    }
    if (more.length) lines.push(`Apps the user can connect when a task needs them (call app_connect, do not tell the user to open settings): ${more.map((b) => `${b.name.en} ("${b.id}")`).join(", ")}.`);
    return lines.join("\n");
  }

  private toolLine(appLabel: string, x: ToolInfo): string {
    const schema = (x.inputSchema ?? {}) as { properties?: Record<string, any>; required?: string[] };
    const req = new Set(Array.isArray(schema.required) ? schema.required : []);
    const params = Object.entries(schema.properties ?? {})
      .slice(0, 12)
      .map(([k, v]) => `${k}${req.has(k) ? "*" : ""}: ${Array.isArray(v?.type) ? v.type.join("|") : (v?.type ?? (v?.enum ? "enum" : "any"))}`)
      .join(", ");
    const first = x.description.replace(/\s+/g, " ").trim();
    return `- ${appLabel} / ${x.name} [${x.category}]${params ? ` (${params})` : ""}: ${first.length > 220 ? `${first.slice(0, 220)}…` : first}`;
  }

  /** app_tools：找工具。给了 app 且工具不多就全列；否则按关键词打分 */
  searchTools(botId: string, input: Pick<GateInput, "apps" | "allowed">, args: { app?: unknown; query?: unknown }): string {
    const mine = this.botApps(botId, input);
    const scope = args.app !== undefined && String(args.app).trim() ? [this.findApp(botId, input, args.app)] : mine;
    const label = (a: (typeof mine)[number]) => (a.app === CUSTOM_APP ? a.name : a.key);
    const all = scope.flatMap((a) => a.tools.map((x) => ({ a, x })));
    if (!all.length) {
      const legacy = scope.filter((a) => a.legacyTools.length);
      if (legacy.length) return `These apps use their own tools directly: ${legacy.map((a) => `${a.name} (${a.legacyTools.join(", ")})`).join("; ")}.`;
      return mine.length ? "No tools match. Call connected_accounts to see what is connected." : "No apps are connected. Call connected_accounts to see which apps the user can connect.";
    }
    const words = String(args.query ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2);
    let hits = all;
    if (words.length) {
      const scored = all
        .map((it) => {
          const name = it.x.name.toLowerCase();
          const text = `${it.x.title ?? ""} ${it.x.description}`.toLowerCase();
          let score = 0;
          for (const w of words) score += (name.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0);
          return { it, score };
        })
        .filter((s) => s.score > 0)
        .sort((x, y) => y.score - x.score);
      hits = scored.map((s) => s.it);
      if (!hits.length) return `No tool matches "${words.join(" ")}". Try other words, or call app_tools with only app to list an app's tools.`;
    }
    const shown = hits.slice(0, MAX_LISTED);
    const rest = hits.length - shown.length;
    return [
      ...shown.map((it) => this.toolLine(label(it.a), it.x)),
      rest > 0 ? `… and ${rest} more. Narrow it down with query${args.app ? "" : " or app"}.` : "",
      "Parameters marked * are required. Call app_tool_schema for the full description, then app_call.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private findTool(a: { name: string; tools: ToolInfo[]; legacyTools: string[] }, name: unknown): ToolInfo {
    const raw = String(name ?? "").trim();
    const hit = a.tools.find((x) => x.name === raw) ?? a.tools.find((x) => x.name.toLowerCase() === raw.toLowerCase());
    if (hit) return hit;
    if (a.legacyTools.includes(raw)) throw new AppError(`${raw} is a tool of its own: call it directly instead of through app_call.`);
    throw new AppError(`${a.name} has no tool "${raw.slice(0, 80)}". Call app_tools with app to list its tools.`);
  }

  /** app_tool_schema：一个工具的完整说明和参数 */
  toolSchema(botId: string, input: Pick<GateInput, "apps" | "allowed">, args: { app?: unknown; tool?: unknown }): string {
    const a = this.findApp(botId, input, args.app);
    const x = this.findTool(a, args.tool);
    const schema = JSON.stringify(x.inputSchema ?? {}, null, 1);
    return [`${a.app === CUSTOM_APP ? a.name : a.key} / ${x.name} [${x.category}]`, x.description, `Parameters (JSON Schema):\n${schema.length > 20_000 ? `${schema.slice(0, 20_000)}\n…` : schema}`, a.accounts.length > 1 ? "Several accounts are connected: pass account (number or name) to app_call." : ""].filter(Boolean).join("\n\n");
  }

  /** 找到要调的应用、账号和工具（不执行）。审批卡片和判定都从这里拿 */
  prepare(botId: string, input: Pick<GateInput, "apps" | "allowed">, args: { app?: unknown; tool?: unknown; account?: unknown }): { key: string; app: string; name: string; tool: ToolInfo; conn: McpConnection } {
    const a = this.findApp(botId, input, args.app);
    const tool = this.findTool(a, args.tool);
    const acc = a.app === CUSTOM_APP ? a.accounts[0] : this.resolveAccount(a.app, args.account, "mcp");
    if (acc.kind !== "mcp") throw new AppError(`${a.name} uses its own tools directly.`);
    // 这个账号自己报的定义（各账号的工具清单通常一样；不一样时以要用的账号为准）
    const own = acc.conn.tools.find((x) => x.name === tool.name) ?? tool;
    return { key: a.key, app: a.app, name: a.name, tool: own, conn: acc.conn };
  }

  /**
   * 审批判定。只读直接用；写入：只读机器人不给，默认档位先问（可以「以后都允许」），完全权限直接执行；
   * 删除和对外发送任何档位都每次问。「只观察」的规则不能写、删、发。
   */
  gate(input: GateInput, key: string, tool: Pick<ToolInfo, "name" | "category" | "hash">): GateDecision {
    if (!input.allowed) return { action: "deny", reason: "Connected apps are not available to this bot." };
    if ((input.apps.toolsOff[key] ?? []).includes(tool.name)) return { action: "deny", reason: `The tool ${tool.name} is turned off for this bot (bot settings › Apps).` };
    if (tool.category === "read") return { action: "allow" };
    if (input.permission === "readonly") return { action: "deny", reason: "This bot is read-only, so it can't change anything in connected apps." };
    if (input.ruleMode === "observe") return { action: "deny", reason: "This task is observe-only and can't use write, delete, or outbound tools." };
    if (tool.category === "delete" || tool.category === "send") return { action: "ask", always: false };
    if (input.permission === "full") return { action: "allow" };
    return input.apps.alwaysAllow[key]?.[tool.name] === tool.hash ? { action: "allow" } : { action: "ask", always: true };
  }

  /** 现有的那几个工具（notion_create_page…）属于哪个应用、哪一类 */
  legacyTool(service: string, op: string): { key: string; tool: Pick<ToolInfo, "name" | "category" | "hash"> } | undefined {
    if (!isLegacyService(service)) return undefined;
    const def = LEGACY_TOOLS[service].find((x) => x.op === op);
    if (!def) return undefined;
    // 类别以这里为准，再对一遍 accounts/ 自己的写操作清单（两边不一致时按写入算）
    const category: ToolCategory = service === "notion" && NOTION_WRITE_OPS.includes(op) ? "write" : def.category;
    return { key: service, tool: { name: def.name, category, hash: toolHash({ name: def.name }) } };
  }

  /** 审批卡片上写的：哪个应用、哪个工具、关键参数（不含密钥） */
  approvalInfo(key: string, appId: string, name: string, tool: Pick<ToolInfo, "name" | "category"> & { title?: string }, args: unknown, always: boolean): { app: string; appName: string; custom: boolean; tool: string; toolTitle: string; category: ToolCategory; always: boolean; params: Array<[string, string]> } {
    return { app: key, appName: appId === CUSTOM_APP ? name : appName(appId, lang()), custom: appId === CUSTOM_APP, tool: tool.name, toolTitle: tool.title || tool.name, category: tool.category, always, params: keyParams(args).map(([k, v]) => [k, redactText(v)]) };
  }

  /** 结果太长就截断，并在末尾说明（界面和模型都看得到） */
  private cap(text: string): string {
    return text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n\n[${t("apps.truncated")}]`;
  }

  /**
   * 执行一个 MCP 工具。凭证被拒时先试一次续期（授权登录），还不行就把连接的状态改掉并抛 AppError（带 repair：
   * 对话里出「重新授权 / 更新密钥 / 更新链接」卡片，用户处理完后重试）。
   */
  async call(conn: McpConnection, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const key = conn.app === CUSTOM_APP ? customKey(conn.id) : conn.app;
    const name = conn.app === CUSTOM_APP ? conn.label : appName(conn.app);
    const cur = this.store.get(conn.id);
    if (!cur) throw new AppError(`${name} is no longer connected.`, { app: key, state: "off" });
    if (cur.app === CUSTOM_APP && !cur.enabled) throw new AppError(`${name} is turned off.`, { app: key, state: "off" });
    if (ATTENTION_STATES.includes(cur.state)) throw new AppError(this.repairText(name, cur.state), { app: key, state: cur.state });
    for (let attempt = 0; ; attempt++) {
      try {
        const session = await this.session(cur);
        const r = await session.callTool(tool, args, { timeoutMs: CALL_TIMEOUT_MS, signal });
        if (cur.state !== "connected") this.store.update(cur.id, { state: "connected", detail: undefined, checkedAt: this.now() });
        const text = this.cap(r.text || (r.isError ? "The tool reported an error without details." : "Done."));
        if (r.isError) throw new AppError(text);
        return text;
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (signal?.aborted) throw e;
        const failure = e instanceof McpFailure ? e : e instanceof OAuthFlowError ? new McpFailure(e.code === "unavailable" ? "unreachable" : "unauthorized", e.message, 401) : new McpFailure("unreachable", "Could not reach the server.");
        if (!(e instanceof McpFailure) && !(e instanceof OAuthFlowError)) log.warn("app tool call failed", { app: cur.app, tool, message: redactText(String((e as Error)?.message ?? e)).slice(0, 200) });
        this.dropSession(cur.id);
        // 连接断了（空闲太久、本地程序退出）：重连再试一次
        if (attempt === 0 && failure.kind !== "unauthorized") continue;
        const st = this.failureState(cur, this.store.secrets(cur.id), failure);
        if (failure.output) this.logs.set(cur.id, failure.output);
        this.store.update(cur.id, { state: st.state, detail: st.detail || undefined, checkedAt: this.now() });
        if (ATTENTION_STATES.includes(st.state)) throw new AppError(this.repairText(name, st.state), { app: key, state: st.state });
        throw new AppError(st.state === "local-failed" ? `${name}: the local program could not start. The user can check it in Connect apps.` : `${name} could not be reached right now. Try again later, or tell the user.`);
      }
    }
  }

  private repairText(name: string, state: ConnState): string {
    switch (state) {
      case "key-rejected":
        return `${name} rejected the saved key. The user needs to update it.`;
      case "link-invalid":
        return `${name}'s dedicated link no longer works. The user needs to update it.`;
      default:
        return `${name} needs the user to sign in again.`;
    }
  }

  /** 现有的那几个工具的调用（amb-connections 插件原来的 /dsh/connections）：按统一的账号序号选账号，再交给原实现 */
  async legacyCall(service: string, op: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    if (!isLegacyService(service)) throw new ConnectionError(`Unknown service: ${service}`);
    const acc = this.resolveAccount(service, args.account, "legacy");
    if (acc.kind !== "legacy") throw new ConnectionError("Unknown account.");
    return service === "notion" ? this.o.connections.notion.run(acc.account, op, args, signal) : this.o.connections.feishu.run(acc.account, op, args, signal);
  }

  /** 对话里的连接 / 修复卡片要的：这个应用现在要用户做什么。连着就是 undefined */
  repairKind(key: string): { kind: "connect" | "reauthorize" | "signin" | "key" | "link"; app: string; custom: boolean; name: string; accountId?: string } | undefined {
    if (isCustomKey(key)) {
      const c = this.store.get(customIdOf(key));
      if (!c) return undefined;
      const kind = c.state === "expired" ? "reauthorize" : c.state === "needs-login" ? "signin" : c.state === "key-rejected" ? "key" : c.state === "link-invalid" ? "link" : !c.enabled ? "connect" : undefined;
      return kind ? { kind, app: key, custom: true, name: c.label, accountId: c.id } : undefined;
    }
    const b = builtinApp(key);
    if (!b) return undefined;
    const accounts = this.accounts(key);
    if (!accounts.length) return { kind: "connect", app: key, custom: false, name: appName(key, lang()) };
    for (const a of accounts) {
      const s = this.stateOfAccount(a);
      const kind = s === "expired" ? "reauthorize" : s === "needs-login" ? "signin" : s === "key-rejected" ? "key" : s === "link-invalid" ? "link" : undefined;
      if (kind) return { kind, app: key, custom: false, name: appName(key, lang()), accountId: a.id };
    }
    return undefined;
  }
}

function nameFromHost(u: URL): string {
  const host = u.hostname.replace(/^(www|mcp|api|open|openapi)\./, "");
  const parts = host.split(".");
  if (/^\d+(\.\d+){3}$/.test(u.hostname) || parts.length < 2) return `${u.hostname}${u.port ? `-${u.port}` : ""}`;
  const base = parts[parts.length - 2];
  return /^(com|net|org|co|ai|io|dev|app|cn)$/.test(base) && parts.length > 2 ? parts[parts.length - 3] : base;
}
