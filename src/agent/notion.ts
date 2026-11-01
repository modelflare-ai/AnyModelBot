/**
 * Notion 账号（accounts.ts）：一个账号要么是令牌，要么是一键授权，用户添加时自己选。模型看到的是同一套工具。
 *
 * - 令牌（个人访问令牌或内部连接的令牌）：走 REST API，页面内容用 Markdown 接口（v2，官方推荐）。
 * - 一键授权：OAuth 2.0 + PKCE + 动态注册，不需要客户端密钥。拿到的令牌只能用于 Notion 的远程 MCP，
 *   所以这边自己用 HTTP 调它的工具（不用 mcp-client 插件）：只调下面用到的那几个，令牌也不进代理进程。
 *   每次刷新都会轮换 refresh token，旧的再用可能吊销整个授权，所以同一账号的刷新要排队、新令牌马上落盘。
 *
 * 没有删除页面的操作；改内容时也不允许删掉子页面和子数据库（Notion 默认拒绝，这里不打开）。
 */
import crypto from "node:crypto";
import { logger } from "../log.js";
import { AccountStore, ConnectionError, capped, clampLimit, wait, type ConnectedAccount, type NotionOAuthAuth } from "./accounts.js";
import { parseRpcReply } from "./search.js";

const log = logger("agent.notion");

const API = "https://api.notion.com";
export const NOTION_VERSION = "2026-03-11";
const MARKDOWN_VERSION = "v2";
const MCP_ORIGIN = "https://mcp.notion.com";
const MCP_URL = `${MCP_ORIGIN}/mcp`;
const MCP_PROTOCOL = "2025-06-18";
const TIMEOUT_MS = 30_000;
/** 被限流时最多等多久再重试：再长就让模型晚点再试，别占着工具调用 */
const MAX_RATE_WAIT_S = 15;
const MAX_RATE_RETRIES = 2;
const MAX_TITLE = 2000;
/** 令牌快到期就提前换（官方建议提前 5～10 分钟） */
const REFRESH_MARGIN_MS = 8 * 60_000;
/** 授权页最多等多久 */
const AUTH_TTL_MS = 10 * 60_000;
export const NOTION_CLIENTS_KV = "notion-oauth-clients";

const RECONNECT = "Ask the user to re-authorize this account in Settings > Connections.";

export const NOTION_WRITE_OPS: readonly string[] = ["create", "update"];

/** 页面或数据库的 ID：模型可能给 UUID（带不带横线都行）或 Notion 链接。查询参数不算（?v= 是视图，?p= 是预览的页面） */
export function notionId(input: unknown): string {
  const raw = String(input ?? "").trim();
  const path = raw.split(/[?#]/)[0];
  const all = path.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi);
  const hex = all?.[all.length - 1]?.replaceAll("-", "").toLowerCase();
  if (!hex) throw new ConnectionError(`"${raw.slice(0, 80)}" is not a Notion ID or link.`, 400);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const plain = (rich: unknown): string => (Array.isArray(rich) ? rich.map((r) => r?.plain_text ?? "").join("") : "");

/** 一个属性值的纯文字，给模型看。读不懂的类型回空 */
export function propertyText(p: any): string {
  if (!p || typeof p !== "object") return "";
  const v = p[p.type];
  const names = (list: unknown) => (Array.isArray(list) ? list.map((x) => x?.name ?? x?.id).filter(Boolean).join(", ") : "");
  switch (p.type) {
    case "title":
    case "rich_text":
      return plain(v);
    case "select":
    case "status":
      return v?.name ?? "";
    case "multi_select":
    case "people":
    case "files":
    case "relation":
      return names(v);
    case "date":
      return v ? (v.end ? `${v.start} → ${v.end}` : String(v.start ?? "")) : "";
    case "checkbox":
      return v ? "yes" : "no";
    case "number":
    case "url":
    case "email":
    case "phone_number":
    case "created_time":
    case "last_edited_time":
      return v === null || v === undefined ? "" : String(v);
    case "created_by":
    case "last_edited_by":
      return v?.name ?? v?.id ?? "";
    case "unique_id":
      return v ? `${v.prefix ? `${v.prefix}-` : ""}${v.number}` : "";
    case "formula": {
      const x = v?.[v?.type];
      return x === null || x === undefined ? "" : typeof x === "object" ? String(x.start ?? "") : String(x);
    }
    case "rollup":
      if (v?.type === "array") return (Array.isArray(v.array) ? v.array : []).map(propertyText).filter(Boolean).join(", ");
      return propertyText(v);
    default:
      return "";
  }
}

/**
 * 模型给的属性值是简单写法（{"Status":"Done","Done":true,"Tags":["a"],"Due":{"start":"2026-11-02"}}），两种连接方式共用。
 * REST 要按列的类型转成 Notion 的结构；已经是 Notion 结构的（{"status":{"name":"Done"}}）原样用。
 */
export function restProperties(schema: Record<string, any>, flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const text = (v: unknown) => [{ text: { content: String(v ?? "") } }];
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const [name, v] of Object.entries(flat)) {
    const type = schema?.[name]?.type;
    if (!type) throw new ConnectionError(`There is no column "${name}". Columns: ${Object.keys(schema ?? {}).join(", ")}`, 400);
    if (v && typeof v === "object" && !Array.isArray(v) && type in v) {
      out[name] = v;
      continue;
    }
    switch (type) {
      case "title":
      case "rich_text":
        out[name] = { [type]: text(v) };
        break;
      case "number":
        out[name] = { number: v === null ? null : Number(v) };
        break;
      case "select":
      case "status":
        out[name] = { [type]: v === null ? null : { name: String(v) } };
        break;
      case "multi_select":
        out[name] = { multi_select: list(v).map((n) => ({ name: n })) };
        break;
      case "checkbox":
        out[name] = { checkbox: v === true || v === "true" };
        break;
      case "date":
        out[name] = { date: v === null ? null : typeof v === "object" ? v : { start: String(v) } };
        break;
      case "url":
      case "email":
      case "phone_number":
        out[name] = { [type]: v === null ? null : String(v) };
        break;
      case "people":
      case "relation":
        out[name] = { [type]: list(v).map((id) => ({ id })) };
        break;
      default:
        throw new ConnectionError(`Column "${name}" (${type}) can't be written.`, 400);
    }
  }
  return out;
}

/** 远程 MCP 的属性写法：日期拆成 date:列名:start，勾选框是 __YES__ / __NO__，多选是 JSON 字符串 */
export function mcpProperties(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(flat)) {
    if (typeof v === "boolean") out[name] = v ? "__YES__" : "__NO__";
    else if (Array.isArray(v)) out[name] = JSON.stringify(v);
    else if (v && typeof v === "object") {
      const d = v as Record<string, unknown>;
      if (d.start !== undefined) out[`date:${name}:start`] = d.start;
      if (d.end !== undefined) out[`date:${name}:end`] = d.end;
    } else out[name] = v;
  }
  return out;
}

const pageTitle = (page: any): string => {
  const props = Object.values(page?.properties ?? {}) as any[];
  return plain(props.find((p) => p?.type === "title")?.title) || "(untitled)";
};
const sourceTitle = (source: any): string => plain(source?.title) || "(untitled)";

/** 数据库的列：名字、类型，选项型的列带上选项（模型写属性时要用） */
function columnsText(schema: Record<string, any>): string {
  return Object.entries(schema ?? {})
    .map(([name, c]) => {
      const options = c?.[c?.type]?.options;
      const list = Array.isArray(options) ? `: ${options.slice(0, 20).map((o: any) => o?.name).join(", ")}` : "";
      return `${name} (${c?.type}${list})`;
    })
    .join("; ");
}

function required(args: Record<string, unknown>, key: string): string {
  const v = typeof args[key] === "string" ? (args[key] as string).trim() : "";
  if (!v) throw new ConnectionError(`Missing ${key}.`, 400);
  return v;
}

const flatProps = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

export interface NotionServiceOptions {
  accounts: AccountStore;
  kv: { getKV(key: string): string | undefined; setKV(key: string, value: string): void };
  /** 桌面版是 Electron 的 net.fetch（系统代理）；缺省 Node 的 fetch。每次请求时取 */
  fetch?: () => typeof fetch | undefined;
  timeoutMs?: number;
}

export class NotionService {
  private refreshing = new Map<string, Promise<string>>();
  private pending = new Map<string, { verifier: string; clientId: string; redirectUri: string; expires: number }>();
  private meta: { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string } | undefined;
  private rpcId = 1;
  private mcpSessions = new Map<string, string>();

  constructor(private o: NotionServiceOptions) {}

  private send(): typeof fetch {
    return this.o.fetch?.() ?? fetch;
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timer = AbortSignal.timeout(this.o.timeoutMs ?? TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timer]) : timer;
  }

  /** 执行一次工具调用，回给模型看的文字 */
  async run(account: ConnectedAccount, op: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    if (account.auth.kind === "notion-oauth") {
      switch (op) {
        case "search":
          return this.mcpSearch(account, args, signal);
        case "read":
          return capped(await this.mcpTool(account, "notion-fetch", { id: required(args, "page") }, signal));
        case "query":
          return this.mcpQuery(account, args, signal);
        case "create":
          return this.mcpCreate(account, args, signal);
        case "update":
          return this.mcpUpdate(account, args, signal);
      }
    } else {
      switch (op) {
        case "search":
          return this.restSearch(account, args, signal);
        case "read":
          return this.restRead(account, args, signal);
        case "query":
          return this.restQuery(account, args, signal);
        case "create":
          return this.restCreate(account, args, signal);
        case "update":
          return this.restUpdate(account, args, signal);
      }
    }
    throw new ConnectionError(`Unknown Notion operation: ${op}`);
  }

  // ---------- 令牌：REST ----------

  /** 添加令牌前试一下，顺便知道它是谁。只有 Notion 明确拒绝才算无效；连不上不算（可能是网络问题，先存着） */
  async verifyToken(token: string, signal?: AbortSignal): Promise<{ rejected: boolean; label: string; identity: string }> {
    const fallback = `token:${crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
    try {
      const me = await this.rest(token, undefined, "GET", "/v1/users/me", undefined, signal);
      return { rejected: false, label: String(me?.bot?.workspace_name || me?.name || "Notion"), identity: me?.id ? `token:${me.id}` : fallback };
    } catch (e) {
      if (e instanceof ConnectionError && e.status === 401) return { rejected: true, label: "", identity: "" };
      if (signal?.aborted) throw e;
      return { rejected: false, label: "Notion", identity: fallback };
    }
  }

  private call(account: ConnectedAccount, method: string, path: string, body: unknown, signal?: AbortSignal): Promise<any> {
    return this.rest(account.auth.kind === "notion-token" ? account.auth.token : "", account.id, method, path, body, signal);
  }

  private async restSearch(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const type = args.type === "page" ? "page" : args.type === "database" ? "data_source" : undefined;
    const r = await this.call(
      account,
      "POST",
      "/v1/search",
      {
        query: typeof args.query === "string" ? args.query : "",
        page_size: clampLimit(args.limit, 10, 50),
        ...(type ? { filter: { property: "object", value: type } } : {}),
      },
      signal,
    );
    const results: any[] = Array.isArray(r?.results) ? r.results : [];
    if (!results.length) return "Nothing found. On this account search only matches titles, and only sees what the token can access.";
    return capped(
      results
        .map((x) => (x?.object === "data_source" ? `- [database] ${sourceTitle(x)} | id: ${x.id} | ${x.url ?? ""}` : `- [page] ${pageTitle(x)} | id: ${x?.id} | ${x?.url ?? ""}`))
        .join("\n"),
    );
  }

  private async restRead(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const id = notionId(args.page);
    const page = await this.call(account, "GET", `/v1/pages/${id}`, undefined, signal);
    const body = await this.call(account, "GET", `/v1/pages/${id}/markdown?markdown_version=${MARKDOWN_VERSION}`, undefined, signal);
    const props = Object.entries(page?.properties ?? {})
      .filter(([, p]: [string, any]) => p?.type !== "title")
      .map(([name, p]) => `${name}: ${propertyText(p)}`)
      .filter((line) => !line.endsWith(": "));
    return capped(
      [
        `# ${pageTitle(page)}`,
        `URL: ${page?.url ?? ""}`,
        ...(props.length ? [`Properties: ${props.join("; ")}`] : []),
        "",
        String(body?.markdown ?? ""),
        ...(body?.truncated ? ["", "[Notion cut this page off: it has too many blocks.]"] : []),
      ].join("\n"),
    );
  }

  /** 链接和搜索结果给的可能是数据库 ID，也可能是数据源 ID：先按数据源取，取不到再按数据库取它的第一个数据源 */
  private async dataSource(account: ConnectedAccount, input: unknown, signal?: AbortSignal): Promise<any> {
    const id = notionId(input);
    try {
      return await this.call(account, "GET", `/v1/data_sources/${id}`, undefined, signal);
    } catch (e) {
      if (!(e instanceof ConnectionError) || e.status !== 404) throw e;
    }
    const db = await this.call(account, "GET", `/v1/databases/${id}`, undefined, signal);
    const first = Array.isArray(db?.data_sources) ? db.data_sources[0]?.id : undefined;
    if (!first) throw new ConnectionError("This Notion database has no data source this account can read.", 404);
    return this.call(account, "GET", `/v1/data_sources/${first}`, undefined, signal);
  }

  private async restQuery(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const source = await this.dataSource(account, args.database, signal);
    const r = await this.call(
      account,
      "POST",
      `/v1/data_sources/${source.id}/query`,
      {
        page_size: clampLimit(args.limit, 25, 100),
        ...(args.filter && typeof args.filter === "object" ? { filter: args.filter } : {}),
        ...(Array.isArray(args.sorts) && args.sorts.length ? { sorts: args.sorts } : {}),
        ...(typeof args.cursor === "string" && args.cursor ? { start_cursor: args.cursor } : {}),
      },
      signal,
    );
    const rows: any[] = Array.isArray(r?.results) ? r.results : [];
    const lines = rows.map((row) => {
      const props = Object.entries(row?.properties ?? {})
        .filter(([, p]: [string, any]) => p?.type !== "title")
        .map(([name, p]) => `${name}: ${propertyText(p)}`)
        .filter((line) => !line.endsWith(": "));
      return [`- ${pageTitle(row)}`, `id: ${row?.id}`, row?.url ?? "", ...props].join(" | ");
    });
    return capped(
      [
        `Database: ${sourceTitle(source)} | id: ${source.id} | ${source.url ?? ""}`,
        `Columns: ${columnsText(source.properties)}`,
        rows.length ? `Rows (${rows.length}):` : "No matching rows.",
        ...lines,
        ...(r?.has_more && r?.next_cursor ? [`More rows: call again with cursor "${r.next_cursor}".`] : []),
      ].join("\n"),
    );
  }

  private async restCreate(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const title = required(args, "title").slice(0, MAX_TITLE);
    const titleValue = { title: [{ text: { content: title } }] };
    const content = typeof args.content === "string" ? args.content : "";
    const markdown = content.trim() ? { markdown: content, markdown_version: MARKDOWN_VERSION } : {};
    let body: Record<string, unknown>;
    if (args.parent_type === "database") {
      const source = await this.dataSource(account, args.parent, signal);
      const titleColumn = Object.entries(source?.properties ?? {}).find(([, c]: [string, any]) => c?.type === "title")?.[0];
      if (!titleColumn) throw new ConnectionError("This Notion database has no title column.", 400);
      const extra = restProperties(source.properties, flatProps(args.properties) ?? {});
      body = { parent: { data_source_id: source.id }, properties: { ...extra, [titleColumn]: titleValue }, ...markdown };
    } else {
      body = { parent: { page_id: notionId(args.parent) }, properties: { title: titleValue }, ...markdown };
    }
    const page = await this.call(account, "POST", "/v1/pages", body, signal);
    return `Created "${title}" | id: ${page?.id} | ${page?.url ?? ""}`;
  }

  private async restUpdate(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const id = notionId(args.page);
    const flat = flatProps(args.properties);
    const edits = Array.isArray(args.edits) ? (args.edits as Array<{ old?: unknown; new?: unknown }>) : [];
    const append = typeof args.append === "string" && args.append.trim() ? args.append : "";
    if (!(flat && Object.keys(flat).length) && !edits.length && !append) throw new ConnectionError("Nothing to change: give properties, edits or append.", 400);

    const done: string[] = [];
    const notes: string[] = [];
    const patch = async (body: Record<string, unknown>) => {
      const r = await this.call(account, "PATCH", `/v1/pages/${id}/markdown`, { ...body, markdown_version: MARKDOWN_VERSION }, signal);
      for (const w of Array.isArray(r?.warnings) ? r.warnings : []) if (w?.message) notes.push(String(w.message));
    };
    try {
      if (flat && Object.keys(flat).length) {
        const page = await this.call(account, "GET", `/v1/pages/${id}`, undefined, signal);
        await this.call(account, "PATCH", `/v1/pages/${id}`, { properties: restProperties(page?.properties ?? {}, flat) }, signal);
        done.push("updated properties");
      }
      if (edits.length) {
        const content_updates = edits.map((e) => ({ old_str: String(e?.old ?? ""), new_str: String(e?.new ?? "") }));
        await patch({ type: "update_content", update_content: { content_updates } });
        done.push("edited content");
      }
      if (append) {
        await patch({ type: "insert_content", insert_content: { content: append } });
        done.push("appended content");
      }
    } catch (e) {
      // 前面几步已经生效了：要告诉模型，它才不会整个重来
      if (e instanceof ConnectionError && done.length) throw new ConnectionError(`Already done: ${done.join(", ")}. Then this failed: ${e.message}`, e.status);
      throw e;
    }
    return [`Page ${id}: ${done.join(", ")}.`, ...notes.map((n) => `Notion warning: ${n}`)].join("\n");
  }

  private async rest(token: string, accountId: string | undefined, method: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<any> {
    const route = path.split("/").slice(0, 3).join("/");
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.send()(API + path, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "notion-version": NOTION_VERSION,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: this.deadline(signal),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        log.warn("notion request failed", { route });
        throw new ConnectionError("Could not reach Notion. Try again in a moment.");
      }
      if (res.status === 429) {
        const seconds = Number(res.headers.get("retry-after")) || 1;
        if (attempt >= MAX_RATE_RETRIES || seconds > MAX_RATE_WAIT_S) throw new ConnectionError(`Notion's rate limit was reached. Try again in about ${Math.ceil(seconds)} seconds.`, 429);
        await wait(seconds * 1000, signal);
        continue;
      }
      const data = await res.json().catch(() => undefined);
      if (res.ok) {
        if (accountId && this.o.accounts.get(accountId)?.needsReauth) this.o.accounts.update(accountId, { needsReauth: false });
        return data;
      }
      log.warn("notion request refused", { route, status: res.status, code: String(data?.code ?? "") });
      throw this.failure(res.status, data, accountId);
    }
  }

  private failure(status: number, data: any, accountId: string | undefined): ConnectionError {
    const message = String(data?.message ?? "").slice(0, 500);
    switch (status) {
      case 400:
        return new ConnectionError(`Notion refused the request: ${message}`, status);
      case 401:
        if (accountId) this.o.accounts.update(accountId, { needsReauth: true });
        return new ConnectionError(`Notion rejected this account's token. ${RECONNECT}`, status);
      case 403:
        return new ConnectionError(`This Notion account isn't allowed to do that: ${message}`, status);
      case 404:
        return new ConnectionError(
          "Not found in Notion. The ID may be wrong, it may be a database rather than a page (or the other way round), or it isn't shared with this connection: an internal connection only sees pages shared with it from the page's Connections menu.",
          status,
        );
      case 409:
        return new ConnectionError("Notion reported a conflict. Read the page again, then retry.", status);
      default:
        return new ConnectionError("Notion is temporarily unavailable. Try again in a moment.", status);
    }
  }

  // ---------- 一键授权：OAuth ----------

  private async oauthMeta(signal?: AbortSignal) {
    if (this.meta) return this.meta;
    const res = await this.send()(`${MCP_ORIGIN}/.well-known/oauth-authorization-server`, { signal: this.deadline(signal) });
    if (!res.ok) throw new ConnectionError("Could not reach Notion's sign-in service. Try again in a moment.");
    const meta = (await res.json()) as NotionService["meta"];
    if (!meta?.authorization_endpoint || !meta.token_endpoint) throw new ConnectionError("Notion's sign-in service gave an unexpected reply.");
    this.meta = meta;
    return meta;
  }

  /** 同一个回调地址只注册一次客户端：官方说重新注册会让之前的授权失效 */
  private async oauthClient(redirectUri: string, signal?: AbortSignal): Promise<string> {
    let clients: Record<string, string> = {};
    try {
      clients = JSON.parse(this.o.kv.getKV(NOTION_CLIENTS_KV) ?? "{}");
    } catch {
      clients = {};
    }
    if (clients[redirectUri]) return clients[redirectUri];
    const meta = await this.oauthMeta(signal);
    if (!meta.registration_endpoint) throw new ConnectionError("Notion's sign-in service doesn't accept new clients.");
    const res = await this.send()(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "AnyModelBot", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
      signal: this.deadline(signal),
    });
    const data: any = await res.json().catch(() => undefined);
    if (!res.ok || !data?.client_id) throw new ConnectionError("Notion's sign-in service refused to register this app.");
    clients[redirectUri] = String(data.client_id);
    this.o.kv.setKV(NOTION_CLIENTS_KV, JSON.stringify(clients));
    return clients[redirectUri];
  }

  /** 开始一键授权：回授权页地址，用户在浏览器里同意后回到 redirectUri */
  async startAuthorization(redirectUri: string, signal?: AbortSignal): Promise<string> {
    const meta = await this.oauthMeta(signal);
    const clientId = await this.oauthClient(redirectUri, signal);
    const { verifier, challenge } = pkce();
    const state = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    this.pending.set(state, { verifier, clientId, redirectUri, expires: now + AUTH_TTL_MS });
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state }).toString();
    return url.toString();
  }

  /** 授权页跳回来：state 对得上才换令牌（一次性），账号写进列表。已有的同一账号只换令牌 */
  async finishAuthorization(params: { state?: string | null; code?: string | null; error?: string | null }, signal?: AbortSignal): Promise<ConnectedAccount> {
    const flow = params.state ? this.pending.get(params.state) : undefined;
    if (!flow || flow.expires < Date.now()) throw new ConnectionError("This sign-in link has expired. Start again from Settings.");
    this.pending.delete(params.state!);
    if (params.error || !params.code) throw new ConnectionError(params.error === "access_denied" ? "You declined the authorization." : "Notion didn't complete the authorization.");
    const meta = await this.oauthMeta(signal);
    const res = await this.send()(meta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: params.code, code_verifier: flow.verifier, client_id: flow.clientId, redirect_uri: flow.redirectUri }).toString(),
      signal: this.deadline(signal),
    });
    const data: any = await res.json().catch(() => undefined);
    if (!res.ok || !data?.access_token || !data?.refresh_token) {
      log.warn("notion token exchange failed", { status: res.status, error: String(data?.error ?? "") });
      throw new ConnectionError("Notion didn't complete the authorization. Try again.");
    }
    const auth: NotionOAuthAuth = { kind: "notion-oauth", clientId: flow.clientId, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    const identity = data.workspace_id && data.user_id ? `oauth:${data.workspace_id}:${data.user_id}` : `oauth:${data.bot_id ?? crypto.randomBytes(8).toString("hex")}`;
    return this.o.accounts.upsert({ service: "notion", label: String(data.workspace_name || "Notion"), identity, auth });
  }

  /** 换新令牌。同一账号排队，新的 refresh token 马上落盘（旧的再用可能吊销整个授权） */
  private accessToken(account: ConnectedAccount, signal: AbortSignal | undefined, force = false): Promise<string> {
    const current = this.o.accounts.get(account.id)?.auth ?? account.auth;
    if (current.kind !== "notion-oauth") return Promise.reject(new ConnectionError("This account has no sign-in."));
    if (!force && current.expiresAt - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(current.accessToken);
    let job = this.refreshing.get(account.id);
    if (!job) {
      job = this.refresh(account.id, signal).finally(() => this.refreshing.delete(account.id));
      this.refreshing.set(account.id, job);
    }
    return job;
  }

  private async refresh(id: string, signal: AbortSignal | undefined): Promise<string> {
    const auth = this.o.accounts.get(id)?.auth;
    if (auth?.kind !== "notion-oauth") throw new ConnectionError("This account has no sign-in.");
    const meta = await this.oauthMeta(signal);
    let res: Response;
    try {
      res = await this.send()(meta.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refreshToken, client_id: auth.clientId }).toString(),
        signal: this.deadline(signal),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ConnectionError("Could not reach Notion. Try again in a moment.");
    }
    const data: any = await res.json().catch(() => undefined);
    if (res.ok && data?.access_token) {
      this.o.accounts.update(id, {
        needsReauth: false,
        auth: { ...auth, accessToken: data.access_token, refreshToken: data.refresh_token || auth.refreshToken, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 },
      });
      return data.access_token;
    }
    if (data?.error === "invalid_grant") {
      this.o.accounts.update(id, { needsReauth: true });
      throw new ConnectionError(`This Notion account's authorization has expired. ${RECONNECT}`, 401);
    }
    log.warn("notion token refresh failed", { status: res.status, error: String(data?.error ?? "") });
    throw new ConnectionError("Notion is temporarily unavailable. Try again in a moment.", res.status);
  }

  // ---------- 一键授权：调远程 MCP 的工具 ----------

  private async rpc(account: ConnectedAccount, body: Record<string, unknown>, signal: AbortSignal | undefined): Promise<{ res: Response; text: string }> {
    const token = await this.accessToken(account, signal);
    const send = (bearer: string) =>
      this.send()(MCP_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL,
          ...(this.mcpSessions.has(account.id) ? { "mcp-session-id": this.mcpSessions.get(account.id)! } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
        signal: this.deadline(signal),
      });
    try {
      let res = await send(token);
      if (res.status === 401) res = await send(await this.accessToken(account, signal, true));
      return { res, text: await res.text() };
    } catch (e) {
      if (signal?.aborted || e instanceof ConnectionError) throw e;
      log.warn("notion mcp request failed", { method: String(body.method ?? "") });
      throw new ConnectionError("Could not reach Notion. Try again in a moment.");
    }
  }

  private async mcpTool(account: ConnectedAccount, name: string, args: Record<string, unknown>, signal: AbortSignal | undefined): Promise<string> {
    if (!this.mcpSessions.has(account.id)) {
      const init = await this.rpc(account, { id: this.rpcId++, method: "initialize", params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "AnyModelBot", version: "1" } } }, signal);
      this.mcpSessions.set(account.id, init.res.headers.get("mcp-session-id") ?? "");
      if (!this.mcpSessions.get(account.id)) this.mcpSessions.delete(account.id);
      if (init.res.ok) await this.rpc(account, { method: "notifications/initialized" }, signal);
    }
    for (let attempt = 0; ; attempt++) {
      const { res, text } = await this.rpc(account, { id: this.rpcId++, method: "tools/call", params: { name, arguments: args } }, signal);
      if (res.status === 429) {
        const seconds = Number(res.headers.get("retry-after")) || 1;
        if (attempt >= MAX_RATE_RETRIES || seconds > MAX_RATE_WAIT_S) throw new ConnectionError(`Notion's rate limit was reached. Try again in about ${Math.ceil(seconds)} seconds.`, 429);
        await wait(seconds * 1000, signal);
        continue;
      }
      if (res.status === 401) {
        this.o.accounts.update(account.id, { needsReauth: true });
        throw new ConnectionError(`Notion rejected this account's sign-in. ${RECONNECT}`, 401);
      }
      if (!res.ok) throw new ConnectionError("Notion is temporarily unavailable. Try again in a moment.", res.status);
      let msg: any;
      try {
        msg = parseRpcReply(text);
      } catch {
        throw new ConnectionError("Notion gave an unexpected reply. Try again in a moment.");
      }
      if (msg?.error) throw new ConnectionError(`Notion refused the request: ${String(msg.error.message ?? "").slice(0, 800)}`, 400);
      const parts: any[] = Array.isArray(msg?.result?.content) ? msg.result.content : [];
      const out = parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("\n");
      if (msg?.result?.isError) throw new ConnectionError(`Notion refused the request: ${out.slice(0, 800)}`, 400);
      return out;
    }
  }

  private async mcpSearch(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return capped(await this.mcpTool(account, "notion-search", { query: typeof args.query === "string" ? args.query : "" }, signal));
  }

  /** 数据库的结构和它的 collection:// 地址（远程 MCP 按这个地址查和写） */
  private async mcpSource(account: ConnectedAccount, input: unknown, signal?: AbortSignal): Promise<{ text: string; id: string; url: string }> {
    const text = await this.mcpTool(account, "notion-fetch", { id: required({ v: input }, "v") }, signal);
    const m = text.match(/collection:\/\/([0-9a-f-]{32,36})/i);
    if (!m) throw new ConnectionError("This doesn't look like a Notion database. Use notion_read_page for pages.", 400);
    return { text, id: m[1], url: `collection://${m[1]}` };
  }

  private async mcpQuery(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const source = await this.mcpSource(account, args.database, signal);
    const rows = await this.mcpTool(
      account,
      "notion-query-data-sources",
      {
        mode: "rows",
        data_source_url: source.url,
        limit: clampLimit(args.limit, 25, 100),
        ...(args.filter && typeof args.filter === "object" ? { filter: args.filter } : {}),
        ...(Array.isArray(args.sorts) && args.sorts.length ? { sort: args.sorts } : {}),
      },
      signal,
    );
    return capped(`Database: ${source.url}\nRows:\n${rows}\n\nDatabase details:\n${source.text}`);
  }

  private async mcpCreate(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const title = required(args, "title").slice(0, MAX_TITLE);
    const content = typeof args.content === "string" && args.content.trim() ? { content: args.content } : {};
    let parent: Record<string, string>;
    let properties: Record<string, unknown> = { title };
    if (args.parent_type === "database") {
      const source = await this.mcpSource(account, args.parent, signal);
      parent = { data_source_id: source.id };
      const column = source.text.match(/"([^"]+)"\s*:\s*\{[^{}]*"type"\s*:\s*"title"/)?.[1] ?? "title";
      properties = { ...mcpProperties(flatProps(args.properties) ?? {}), [column]: title };
    } else {
      parent = { page_id: notionId(args.parent) };
    }
    const reply = await this.mcpTool(account, "notion-create-pages", { parent, pages: [{ properties, ...content }] }, signal);
    return capped(`Created "${title}".\n${reply}`);
  }

  private async mcpUpdate(account: ConnectedAccount, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const page_id = notionId(args.page);
    const flat = flatProps(args.properties);
    const edits = Array.isArray(args.edits) ? (args.edits as Array<{ old?: unknown; new?: unknown }>) : [];
    const append = typeof args.append === "string" && args.append.trim() ? args.append : "";
    if (!(flat && Object.keys(flat).length) && !edits.length && !append) throw new ConnectionError("Nothing to change: give properties, edits or append.", 400);
    const done: string[] = [];
    const replies: string[] = [];
    const call = async (body: Record<string, unknown>) => {
      const r = await this.mcpTool(account, "notion-update-page", { page_id, ...body }, signal);
      if (r.includes("warnings")) replies.push(r);
    };
    try {
      if (flat && Object.keys(flat).length) {
        await call({ command: "update_properties", properties: mcpProperties(flat) });
        done.push("updated properties");
      }
      if (edits.length) {
        await call({ command: "update_content", content_updates: edits.map((e) => ({ old_str: String(e?.old ?? ""), new_str: String(e?.new ?? "") })) });
        done.push("edited content");
      }
      if (append) {
        // 远程 MCP 没有"追加"：找到页面最后一行，把新内容接在它后面。这样不用整页重写
        const page = await this.mcpTool(account, "notion-fetch", { id: page_id }, signal);
        const body = page.match(/<content>([\s\S]*)<\/content>/)?.[1] ?? "";
        const last = body.split("\n").map((l) => l.trim()).filter(Boolean).pop();
        await call(last ? { command: "update_content", content_updates: [{ old_str: last, new_str: `${last}\n${append}` }] } : { command: "replace_content", new_str: append });
        done.push("appended content");
      }
    } catch (e) {
      if (e instanceof ConnectionError && done.length) throw new ConnectionError(`Already done: ${done.join(", ")}. Then this failed: ${e.message}`, e.status);
      throw e;
    }
    return [`Page ${page_id}: ${done.join(", ")}.`, ...replies.map((r) => `Notion said: ${r.slice(0, 1000)}`)].join("\n");
  }
}
