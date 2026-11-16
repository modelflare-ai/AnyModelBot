/**
 * 连接应用（src/tools/apps）：凭证文件和旧令牌的搬迁、工具分类、主程序这边的 MCP 连接（Streamable HTTP、旧式 SSE、本地命令）、
 * 授权登录、内置应用和自定义连接器的连接与状态、按机器人分配、审批判定。
 * 对面是这里起的假 MCP 服务器和假授权服务器，不连外网。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ACCOUNTS_KV, AccountStore } from "../src/tools/accounts/index.js";
import { ConnectionService } from "../src/tools/accounts/connections.js";
import { MemorySecrets, SecretsFile } from "../src/tools/apps/secrets.js";
import { classifyTool, describeTools, keyParams, toolHash, verbCategory } from "../src/tools/apps/classify.js";
import { BUILTIN_APPS, MAX_CUSTOM, customKey } from "../src/tools/apps/catalog.js";
import { AppService, AppUserError, MASK, MAX_RESULT, maskedUrl, type GateInput } from "../src/tools/apps/service.js";
import { AppError, mcpSecretId } from "../src/tools/apps/types.js";
import { CONNECTIONS_KV } from "../src/tools/apps/store.js";
import { DEFAULT_SETTINGS, normalizeBotApps } from "../src/domain/bot-settings.js";
import { redactText } from "../src/log.js";

function memoryKv() {
  const m = new Map<string, string>();
  return { getKV: (k: string) => m.get(k), setKV: (k: string, v: string) => void m.set(k, v), dump: () => [...m.values()].join("\n") };
}

const TOOLS = [
  { name: "search_docs", description: "Search documents by keyword.", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] }, annotations: { readOnlyHint: true } },
  { name: "create_doc", description: "Create a document.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] } },
  { name: "delete_doc", description: "Delete a document.", inputSchema: { type: "object", properties: { id: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "send_message", description: "Send a message to a person.", inputSchema: { type: "object", properties: { to: { type: "string" }, text: { type: "string" } } } },
  { name: "big", description: "Return a very long text.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "broken", description: "Always fails.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
];

interface Fake {
  url: string;
  origin: string;
  port: number;
  /** 收到的工具调用 */
  calls: Array<{ name: string; args: any; auth: string }>;
  /** 签发过的访问令牌（当前有效的那一个） */
  token: string;
  /** 让当前的访问令牌失效（下次请求 401，客户端该去续期） */
  expire(): void;
  /** 续期时拒绝（授权不再有效） */
  refuseRefresh: boolean;
  registered: any[];
  tokenRequests: URLSearchParams[];
  close(): Promise<void>;
}

/**
 * 假服务器：/mcp 是 Streamable HTTP（回 JSON），/sse 是旧式 SSE；auth 决定要什么凭证。同一个端口上还有授权服务器的那几个地址。
 * mode：none 公开 · header 要 x-key: good · query 要 ?key=good · oauth 要签发的 Bearer 令牌 · notmcp 回一段普通 JSON（高德对错的 Key）
 */
async function fake(mode: "none" | "header" | "query" | "oauth" | "notmcp", opts: { sseOnly?: boolean; noRegistration?: boolean; tools?: any[] } = {}): Promise<Fake> {
  const tools = opts.tools ?? TOOLS;
  const state: Fake = { url: "", origin: "", port: 0, calls: [], token: "", expire: () => (state.token = `expired-${crypto.randomUUID()}`), refuseRefresh: false, registered: [], tokenRequests: [], close: async () => {} };
  const codes = new Map<string, { challenge?: string }>();
  const sse = new Map<string, http.ServerResponse>();
  const rpc = (msg: any, authHeader: string): any => {
    if (msg.method === "initialize") return { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } };
    if (msg.method === "tools/list") return { tools };
    if (msg.method === "tools/call") {
      state.calls.push({ name: msg.params.name, args: msg.params.arguments, auth: authHeader });
      if (msg.params.name === "big") return { content: [{ type: "text", text: "x".repeat(MAX_RESULT + 500) }] };
      if (msg.params.name === "broken") return { content: [{ type: "text", text: "it broke" }], isError: true };
      return { content: [{ type: "text", text: `ran ${msg.params.name} ${JSON.stringify(msg.params.arguments ?? {})}` }] };
    }
    return undefined;
  };
  const authorized = (req: http.IncomingMessage, url: URL): boolean => {
    if (mode === "header") return req.headers["x-key"] === "good";
    if (mode === "query") return url.searchParams.get("key") === "good";
    if (mode === "oauth") return !!state.token && req.headers.authorization === `Bearer ${state.token}`;
    return true;
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", state.origin);
    let body = "";
    for await (const c of req) body += c;
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    // —— 授权服务器 ——
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(200, { resource: `${state.origin}/mcp`, authorization_servers: [state.origin], scopes_supported: ["docs"] });
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
      return json(200, { issuer: state.origin, authorization_endpoint: `${state.origin}/authorize`, token_endpoint: `${state.origin}/token`, ...(opts.noRegistration ? {} : { registration_endpoint: `${state.origin}/register` }), response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none", "client_secret_post"], code_challenge_methods_supported: ["S256"] });
    }
    if (url.pathname === "/register") {
      const meta = JSON.parse(body);
      state.registered.push(meta);
      return json(201, { client_id: `client-${state.registered.length}`, redirect_uris: meta.redirect_uris });
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      state.tokenRequests.push(form);
      if (form.get("grant_type") === "authorization_code") {
        const code = codes.get(form.get("code") ?? "");
        if (!code) return json(400, { error: "invalid_grant" });
        if (code.challenge && crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== code.challenge) return json(400, { error: "invalid_grant" });
        codes.delete(form.get("code")!);
      } else if (form.get("grant_type") === "refresh_token") {
        if (state.refuseRefresh || !String(form.get("refresh_token")).startsWith("refresh-")) return json(400, { error: "invalid_grant" });
      } else return json(400, { error: "unsupported_grant_type" });
      state.token = `access-${crypto.randomUUID()}`;
      return json(200, { access_token: state.token, token_type: "Bearer", expires_in: 3600, refresh_token: `refresh-${crypto.randomUUID()}`, scope: "docs" });
    }
    // —— MCP ——
    const unauthorized = () => json(401, { error: "invalid_token" }, mode === "oauth" ? { "www-authenticate": `Bearer resource_metadata="${state.origin}/.well-known/oauth-protected-resource", scope="docs"` } : {});
    if (url.pathname === "/sse" && req.method === "GET") {
      if (!authorized(req, url)) return unauthorized();
      const id = crypto.randomUUID();
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(`event: endpoint\ndata: /messages?sid=${id}\n\n`);
      sse.set(id, res);
      req.on("close", () => sse.delete(id));
      return;
    }
    if (url.pathname === "/messages" && req.method === "POST") {
      const stream = sse.get(url.searchParams.get("sid") ?? "");
      if (!stream) return json(404, {});
      const msg = JSON.parse(body);
      res.writeHead(202).end();
      const result = rpc(msg, String(req.headers.authorization ?? ""));
      if (msg.id !== undefined) stream.write(`event: message\ndata: ${JSON.stringify(result === undefined ? { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } } : { jsonrpc: "2.0", id: msg.id, result })}\n\n`);
      return;
    }
    if (url.pathname === "/mcp") {
      if (opts.sseOnly) return json(404, { error: "not found" });
      if (mode === "notmcp") return json(200, { status: "0", info: "INVALID_USER_KEY", infocode: "10001" });
      if (!authorized(req, url)) return unauthorized();
      if (req.method !== "POST") return void res.writeHead(405).end();
      const msg = JSON.parse(body || "{}");
      if (msg.id === undefined) return void res.writeHead(202).end();
      const result = rpc(msg, String(req.headers.authorization ?? ""));
      return json(200, result === undefined ? { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } } : { jsonrpc: "2.0", id: msg.id, result });
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.port = (server.address() as any).port;
  state.origin = `http://127.0.0.1:${state.port}`;
  state.url = `${state.origin}/mcp`;
  // 授权页：测试里不开浏览器，直接替用户「同意」——从授权地址里取出回调要带的 code
  (state as any).approve = (authUrl: string) => {
    const u = new URL(authUrl);
    const code = crypto.randomUUID();
    codes.set(code, { challenge: u.searchParams.get("code_challenge") ?? undefined });
    return { state: u.searchParams.get("state"), code, redirect: u.searchParams.get("redirect_uri"), clientId: u.searchParams.get("client_id"), scope: u.searchParams.get("scope"), challenge: u.searchParams.get("code_challenge") };
  };
  state.close = () =>
    new Promise<void>((r) => {
      for (const s of sse.values()) s.end();
      (server as any).closeAllConnections?.();
      server.close(() => r());
    });
  return state;
}
const approve = (f: Fake, authUrl: string) => (f as any).approve(authUrl) as { state: string; code: string; redirect: string; clientId: string; scope: string | null; challenge: string | null };

const REDIRECT = "http://127.0.0.1:5800/oauth/apps/callback";
const fakes: Fake[] = [];
const services: AppService[] = [];
async function newFake(...a: Parameters<typeof fake>) {
  const f = await fake(...a);
  fakes.push(f);
  return f;
}
function setup(opts: { fetch?: typeof fetch; yuque?: string } = {}) {
  const kv = memoryKv();
  const secrets = new MemorySecrets();
  const connections = new ConnectionService({ kv, secrets });
  const apps = new AppService({ kv, secrets, connections, ...(opts.fetch ? { fetch: () => opts.fetch } : {}), yuqueProgram: () => opts.yuque });
  services.push(apps);
  return { kv, secrets, connections, apps };
}
/** 把内置应用的线上地址换到假服务器上（主程序的 MCP 连接和授权登录都走注入的 fetch） */
function rewrite(map: Record<string, string>): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [from, to] of Object.entries(map)) if (url.startsWith(from)) url = to + url.slice(from.length);
    return fetch(url, init);
  }) as typeof fetch;
}
const input = (over: Partial<GateInput> = {}): GateInput => ({ permission: "workspace", apps: DEFAULT_SETTINGS.apps, allowed: true, ...over });

afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.stop()));
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

describe("凭证：单独的文件，不进数据库", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-secrets-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("凭证文件权限 600，重新打开能读回；删掉一条后文件里就没有了", () => {
    const file = path.join(dir, "app-secrets.json");
    const s = new SecretsFile(file);
    s.set("mcp:a", { headers: { Authorization: "Bearer secret-token-1" } });
    s.set("mcp:b", { url: "https://gw.example.com/u/private-path" });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const again = new SecretsFile(file);
    expect(again.get("mcp:a")).toEqual({ headers: { Authorization: "Bearer secret-token-1" } });
    expect(again.ids().sort()).toEqual(["mcp:a", "mcp:b"]);
    again.delete("mcp:a");
    expect(fs.readFileSync(file, "utf8")).not.toContain("secret-token-1");
  });

  it("存进去的值都登记到日志脱敏：令牌、Bearer 后面的那一段、整条专属链接", () => {
    const s = new MemorySecrets();
    s.set("x", { headers: { Authorization: "Bearer zzz-very-secret-99" }, url: "https://gw.example.com/u/private-path-77" });
    expect(redactText("got zzz-very-secret-99 from https://gw.example.com/u/private-path-77")).not.toMatch(/zzz-very-secret-99|private-path-77/);
  });

  it("文件坏了当作没有凭证，不让整个应用起不来", () => {
    const file = path.join(dir, "broken.json");
    fs.writeFileSync(file, "{nope");
    expect(new SecretsFile(file).ids()).toEqual([]);
  });

  it("旧版本写在数据库里的 Notion、飞书令牌：升级时搬到凭证文件，数据库里不再有；账号、别名、序号都在，不用重新授权", () => {
    const kv = memoryKv();
    kv.setKV(
      ACCOUNTS_KV,
      JSON.stringify([
        { id: "n1", service: "notion", label: "Acme", identity: "w1", createdAt: 1, auth: { kind: "notion-token", token: "ntn_old_plaintext_token" } },
        { id: "f1", service: "feishu", label: "工作", identity: "u1", createdAt: 2, auth: { kind: "feishu-user", brand: "feishu", appId: "cli_x", appSecret: "old-app-secret-xyz", accessToken: "u-old-access", refreshToken: "ur-old-refresh", expiresAt: 5 } },
      ]),
    );
    const secrets = new MemorySecrets();
    const store = new AccountStore(kv, secrets);
    expect(store.view().map((a) => [a.service, a.number, a.label])).toEqual([["notion", 1, "Acme"], ["feishu", 1, "工作"]]);
    expect(kv.dump()).not.toMatch(/ntn_old_plaintext_token|old-app-secret-xyz|u-old-access|ur-old-refresh/);
    expect(secrets.get<any>("account:n1").token).toBe("ntn_old_plaintext_token");
    // 再启动一次：从凭证文件读回，令牌照旧能用
    const again = new AccountStore(kv, secrets);
    expect((again.get("f1")!.auth as any).refreshToken).toBe("ur-old-refresh");
    // 令牌轮换后落盘的也不进数据库；移除账号时凭证一起删
    again.update("f1", { auth: { ...(again.get("f1")!.auth as any), accessToken: "u-new-access-123" } });
    expect(kv.dump()).not.toContain("u-new-access-123");
    again.remove("n1");
    expect(secrets.get("account:n1")).toBeUndefined();
  });
});

describe("工具分类", () => {
  it("名字里的动词：读、写、删、发；看不出来是 undefined", () => {
    expect(verbCategory("search_docs")).toBe("read");
    expect(verbCategory("getIssue")).toBe("read");
    expect(verbCategory("create-doc")).toBe("write");
    expect(verbCategory("update_page")).toBe("write");
    expect(verbCategory("delete_page")).toBe("delete");
    expect(verbCategory("archive_project")).toBe("delete");
    expect(verbCategory("send_email")).toBe("send");
    expect(verbCategory("get_messages")).toBe("read");
    expect(verbCategory("maps_weather")).toBe("read");
    expect(verbCategory("frobnicate")).toBeUndefined();
  });

  it("内置应用（官方服务）：按名字给定的优先，其次标注，没有标注按动词，都没有按写入", () => {
    const ctx = { trusted: true, fixed: { "create-doc": "write" as const } };
    expect(classifyTool("create-doc", { readOnlyHint: true }, ctx)).toBe("write");
    expect(classifyTool("list_things", undefined, ctx)).toBe("read");
    expect(classifyTool("yuque_update_doc", undefined, ctx)).toBe("write");
    expect(classifyTool("frobnicate", undefined, ctx)).toBe("write");
    expect(classifyTool("anything", undefined, { trusted: true, allRead: true })).toBe("read");
    expect(classifyTool("wipe", { destructiveHint: true }, ctx)).toBe("delete");
  });

  it("自定义连接器：没有标注的一律至少是写入；标了只读、名字却是删除或发送的，按名字算", () => {
    const ctx = { trusted: false };
    expect(classifyTool("list_things", undefined, ctx)).toBe("write");
    expect(classifyTool("list_things", { readOnlyHint: true }, ctx)).toBe("read");
    expect(classifyTool("delete_everything", { readOnlyHint: true }, ctx)).toBe("delete");
    expect(classifyTool("send_message", { readOnlyHint: true }, ctx)).toBe("send");
    expect(classifyTool("delete_doc", undefined, ctx)).toBe("delete");
    expect(classifyTool("update_doc", { readOnlyHint: false }, ctx)).toBe("write");
    // 规范里 destructiveHint 没写时默认是 true：没写的不算删除，显式写了才算
    expect(classifyTool("update_doc", { destructiveHint: true }, ctx)).toBe("delete");
  });

  it("用户改过的类别最优先", () => {
    expect(classifyTool("list_things", undefined, { trusted: false, overrides: { list_things: "read" } })).toBe("read");
    expect(classifyTool("search", { readOnlyHint: true }, { trusted: true, overrides: { search: "send" } })).toBe("send");
  });

  it("定义的指纹：说明、参数、标注变了就变；键的顺序不影响", () => {
    const a = toolHash({ name: "t", description: "d", inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } } });
    expect(toolHash({ name: "t", description: "d", inputSchema: { properties: { b: { type: "number" }, a: { type: "string" } }, type: "object" } })).toBe(a);
    expect(toolHash({ name: "t", description: "d2", inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } } })).not.toBe(a);
    expect(describeTools([{ name: "x" }, { name: "x" }, { name: "" } as any], { trusted: false })).toHaveLength(1);
  });

  it("审批卡片上的关键参数：先标题、目标、收件人，长的截短，像密钥的不要", () => {
    expect(keyParams({ body: "long text", title: "周报 11.11", token: "sk-secret", to: ["a@x.com", "b@x.com"], nested: { a: 1 } })).toEqual([["title", "周报 11.11"], ["to", "a@x.com, b@x.com"], ["body", "long text"]]);
    expect(keyParams({ text: "x".repeat(200) })[0][1]).toHaveLength(81);
    expect(keyParams(null)).toEqual([]);
  });
});

describe("过程区按应用的 key 显示名字（keyOf）", () => {
  it("内置应用认 id 和中英文名，自定义连接器认 key 和名称（名称可以只写一部分）；认不出时没有", async () => {
    const f = await newFake("header");
    const { apps } = setup();
    const saved = await apps.saveCustom({ name: "团队文档库", transport: "http", url: f.url, auth: "headers", headers: [["x-key", "good"]] }, { redirectUri: REDIRECT });
    const key = saved.app.key;
    expect(["notion", "Notion", "飞书", "Feishu", "tencent-docs", "Tencent Docs"].map((x) => apps.keyOf(x))).toEqual(["notion", "notion", "feishu", "feishu", "tencent-docs", "tencent-docs"]);
    expect([apps.keyOf(key), apps.keyOf("团队文档库"), apps.keyOf("文档库")]).toEqual([key, key, key]);
    expect([apps.keyOf("custom:nope"), apps.keyOf("没有这个"), apps.keyOf(" ")]).toEqual([undefined, undefined, undefined]);
  });
});

describe("自定义连接器", () => {
  it("请求头：密钥不对也保存，但保持关闭、状态是密钥被拒；改对之后已连接、开启，工具分好类", async () => {
    const f = await newFake("header");
    const { apps, kv, secrets } = setup();
    const bad = await apps.saveCustom({ name: "docs", transport: "http", url: f.url, auth: "headers", headers: [["x-key", "bad-key-000000"]] }, { redirectUri: REDIRECT });
    expect(bad.app).toMatchObject({ custom: true, name: "docs", state: "key-rejected", enabled: false, connected: false });
    const id = bad.app.accounts[0].id;
    // 编辑：没改的密钥界面发回的是掩码，这里保留已存的；把值改对
    const good = await apps.saveCustom({ name: "docs", transport: "http", url: f.url, auth: "headers", headers: [["x-key", "good"]] }, { id, redirectUri: REDIRECT });
    expect(good.app).toMatchObject({ state: "connected", enabled: true, connected: true });
    expect(good.app.tools.map((x) => [x.name, x.category])).toEqual([["search_docs", "read"], ["create_doc", "write"], ["delete_doc", "delete"], ["send_message", "send"], ["big", "read"], ["broken", "read"]]);
    expect(good.app.config).toMatchObject({ transport: "http", url: f.url, auth: "headers", headers: [["x-key", MASK]] });
    // 凭证只在凭证文件里：数据库和给界面的清单里都没有
    expect(kv.dump()).not.toContain("bad-key-000000");
    expect(JSON.stringify(apps.view())).not.toContain("good\"");
    expect(secrets.get<any>(mcpSecretId(id)).headers).toEqual({ "x-key": "good" });
    // 只改名字，密钥发回掩码：保留已存的
    const renamed = await apps.saveCustom({ name: "文档库", transport: "http", url: f.url, auth: "headers", headers: [["x-key", MASK]] }, { id, redirectUri: REDIRECT });
    expect(renamed.app).toMatchObject({ name: "文档库", state: "connected" });
    // 键改了名，掩码对不上：要用户重新填
    await expect(apps.saveCustom({ name: "x", transport: "http", url: f.url, auth: "headers", headers: [["x-other", MASK]] }, { id, redirectUri: REDIRECT })).rejects.toBeInstanceOf(AppUserError);
  });

  it("查询参数和专属链接：密钥拼进地址去连；给界面的地址打码", async () => {
    const f = await newFake("query");
    const { apps, kv } = setup();
    const q = await apps.saveCustom({ transport: "http", url: f.url, auth: "query", query: [["key", "good"]] }, { redirectUri: REDIRECT });
    expect(q.app.state).toBe("connected");
    expect(q.app.config).toMatchObject({ url: f.url, query: [["key", MASK]] });
    const d = await apps.saveCustom({ name: "ded", transport: "http", url: `${f.url}?key=good`, auth: "dedicatedUrl" }, { redirectUri: REDIRECT });
    expect(d.app.state).toBe("connected");
    expect(d.app.config!.url).toBe(MASK);
    expect(kv.dump()).not.toContain("key=good");
    expect(maskedUrl("https://gw.example.com/u/secret?k=1")).toBe(`https://gw.example.com/${MASK}`);
    // 专属链接失效：状态是链接无效，不是密钥被拒
    const bad = await apps.saveCustom({ name: "ded2", transport: "http", url: `${f.url}?key=nope`, auth: "dedicatedUrl" }, { redirectUri: REDIRECT });
    expect(bad.app).toMatchObject({ state: "link-invalid", enabled: false });
  });

  it("自动：公开的服务直接连上，认证方式落成无需认证；名字留空按地址起，重名加序号", async () => {
    const f = await newFake("none");
    const { apps } = setup();
    const a = await apps.saveCustom({ transport: "http", url: f.url, auth: "auto" }, { redirectUri: REDIRECT });
    expect(a.app).toMatchObject({ state: "connected", name: "127.0.0.1-" + f.port });
    expect(a.app.config!.auth).toBe("none");
    const b = await apps.saveCustom({ transport: "http", url: f.url, auth: "none" }, { redirectUri: REDIRECT });
    expect(b.app.name).toBe(`127.0.0.1-${f.port} 2`);
  });

  it("只有旧式 SSE 的服务：Streamable HTTP 连不上就退回 SSE，下次先试 SSE", async () => {
    const f = await newFake("none", { sseOnly: true });
    const { apps, kv } = setup();
    const r = await apps.saveCustom({ name: "old", transport: "http", url: `${f.origin}/sse`, auth: "none" }, { redirectUri: REDIRECT });
    expect(r.app).toMatchObject({ state: "connected", enabled: true });
    expect(r.app.config!.sse).toBe(true);
    expect(JSON.parse(kv.getKV(CONNECTIONS_KV)!)[0].sse).toBe(true);
    const p = apps.prepare("b1", input(), { app: "old", tool: "search_docs" });
    expect(await apps.call(p.conn, "search_docs", { q: "x" })).toBe('ran search_docs {"q":"x"}');
  });

  it("连不上（地址不对）：保存、关着、状态是连不上；不亮提醒点（多半是网络）", async () => {
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "gone", transport: "http", url: "http://127.0.0.1:9/mcp", auth: "none" }, { redirectUri: REDIRECT });
    expect(r.app).toMatchObject({ state: "unreachable", enabled: false });
    expect(apps.attention()).toBe(false);
    await expect(apps.saveCustom({ name: "bad", transport: "http", url: "ftp://x", auth: "none" }, { redirectUri: REDIRECT })).rejects.toBeInstanceOf(AppUserError);
  });

  it("最多 20 个：第 21 个添加时提示已达上限", async () => {
    const f = await newFake("none");
    const { apps } = setup();
    for (let i = 0; i < MAX_CUSTOM; i++) await apps.saveCustom({ name: `c${i}`, transport: "http", url: f.url, auth: "none" }, { redirectUri: REDIRECT });
    expect(apps.view()).toMatchObject({ customCount: MAX_CUSTOM, maxCustom: MAX_CUSTOM });
    await expect(apps.saveCustom({ name: "one-more", transport: "http", url: f.url, auth: "none" }, { redirectUri: REDIRECT })).rejects.toThrow(String(MAX_CUSTOM));
  });

  it("开关：关掉后机器人用不了；开启时先测试，测试不过还是关着", async () => {
    const f = await newFake("header");
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "docs", transport: "http", url: f.url, auth: "headers", headers: [["x-key", "good"]] }, { redirectUri: REDIRECT });
    const id = r.app.accounts[0].id;
    expect((await apps.setEnabled(id, false)).state).toBe("off");
    expect(apps.botApps("b1", input())).toEqual([]);
    expect((await apps.setEnabled(id, true)).connected).toBe(true);
    await f.close();
    await apps.setEnabled(id, false);
    expect(await apps.setEnabled(id, true)).toMatchObject({ enabled: false, state: "unreachable" });
  });

  it("用户改工具的类别：之后按改过的判定；恢复默认回到原来的", async () => {
    const f = await newFake("none");
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "docs", transport: "http", url: f.url, auth: "none" }, { redirectUri: REDIRECT });
    expect(apps.setCategory(r.app.key, "create_doc", "read")).toBe(true);
    expect(apps.viewOf(r.app.key)!.tools.find((x) => x.name === "create_doc")).toMatchObject({ category: "read", overridden: true });
    expect(apps.gate(input(), r.app.key, apps.prepare("b1", input(), { app: "docs", tool: "create_doc" }).tool)).toEqual({ action: "allow" });
    apps.setCategory(r.app.key, "create_doc", null);
    expect(apps.viewOf(r.app.key)!.tools.find((x) => x.name === "create_doc")!.category).toBe("write");
  });
});

describe("本地命令", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-stdio-"));
  const script = path.join(dir, "server.mjs");
  beforeAll(() => {
    // 最小的 stdio MCP 服务器：一行一条 JSON-RPC。环境变量 NEED_KEY 不对就马上退出（密钥靠环境变量给）
    fs.writeFileSync(
      script,
      `import readline from "node:readline";
if (process.env.NEED_KEY && process.env.API_KEY !== process.env.NEED_KEY) { console.error("bad API_KEY " + (process.env.API_KEY ?? "")); process.exit(2); }
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local", version: "1" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "yuque_get_user", description: "who", inputSchema: { type: "object", properties: {} } }, { name: "yuque_create_doc", description: "create", inputSchema: { type: "object", properties: { title: { type: "string" } } } }] } });
  else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: process.env.YUQUE_PERSONAL_TOKEN === "bad" ? { content: [{ type: "text", text: "401 Unauthorized" }], isError: true } : { content: [{ type: "text", text: JSON.stringify({ login: "amb", name: "小安", token: process.env.YUQUE_PERSONAL_TOKEN ?? process.env.API_KEY ?? "" }) }] } });
  else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } });
});
`,
    );
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("能添加并连上；环境变量的值只在凭证文件里；命令不存在是「本地程序启动失败」", async () => {
    const { apps, kv } = setup();
    const ok = await apps.saveCustom({ name: "local", transport: "stdio", command: process.execPath, args: [script], env: [["API_KEY", "env-secret-424242"]] }, { redirectUri: REDIRECT });
    expect(ok.app).toMatchObject({ state: "connected", enabled: true });
    expect(ok.app.config).toMatchObject({ transport: "stdio", command: process.execPath, args: [script], env: [["API_KEY", MASK]] });
    expect(kv.dump()).not.toContain("env-secret-424242");
    const p = apps.prepare("b1", input(), { app: "local", tool: "yuque_get_user" });
    expect(await apps.call(p.conn, "yuque_get_user", {})).toContain("env-secret-424242"); // 程序确实拿到了环境变量
    const missing = await apps.saveCustom({ name: "nope", transport: "stdio", command: "amb-no-such-command-xyz", args: [] }, { redirectUri: REDIRECT });
    expect(missing.app).toMatchObject({ state: "local-failed", enabled: false, detail: "notFound" });
    await expect(apps.saveCustom({ transport: "stdio", command: "  " }, { redirectUri: REDIRECT })).rejects.toBeInstanceOf(AppUserError);
  });

  it("程序启动后马上退出：启动失败，最后的输出留着给「查看日志」（脱敏后）", async () => {
    const { apps } = setup();
    // 本地程序拿到的环境是干净的（不继承主程序的环境变量），要的值都从这条连接的环境变量里给
    const r = await apps.saveCustom({ name: "picky", transport: "stdio", command: process.execPath, args: [script], env: [["NEED_KEY", "right"], ["API_KEY", "wrong-key-987654"]] }, { redirectUri: REDIRECT });
    expect(r.app).toMatchObject({ state: "local-failed", enabled: false });
    expect(r.app.log).toContain("bad API_KEY");
    expect(r.app.log).not.toContain("wrong-key-987654");
  });

  it("语雀（内置应用预置的本地程序）：只给 Token；Token 不能用时说清可能的原因，不留下半成品账号", async () => {
    const { apps } = setup({ yuque: script });
    await expect(apps.connectBuiltin("yuque", { token: "bad", redirectUri: REDIRECT })).rejects.toThrow(/超级会员/);
    expect(apps.accounts("yuque")).toEqual([]);
    const r = await apps.connectBuiltin("yuque", { token: "yq-token-555555", redirectUri: REDIRECT });
    expect(r).toMatchObject({ key: "yuque" });
    const view = apps.viewOf("yuque")!;
    expect(view).toMatchObject({ connected: true, state: "connected" });
    expect(view.accounts[0]).toMatchObject({ label: "小安", method: "token", number: 1 });
    // 没有标注的官方工具按名字里的动词分
    expect(view.tools.map((x) => x.category)).toEqual(["read", "write"]);
    await expect(apps.connectBuiltin("yuque", { token: "  ", redirectUri: REDIRECT })).rejects.toBeInstanceOf(AppUserError);
  });

  it("随安装包带的语雀程序不在：启动失败", async () => {
    const { apps } = setup({ yuque: undefined });
    await expect(apps.connectBuiltin("yuque", { token: "x-token-1", redirectUri: REDIRECT })).rejects.toBeInstanceOf(AppUserError);
  });
});

describe("授权登录", () => {
  it("自动：服务器要登录、找得到授权服务器 → 动态注册、PKCE、回调后连上；令牌只在凭证文件里", async () => {
    const f = await newFake("oauth");
    const { apps, kv, secrets } = setup();
    const r = await apps.saveCustom({ name: "svc", transport: "http", url: f.url, auth: "auto" }, { redirectUri: REDIRECT });
    // 先保存下来（关着、需要登录），再去授权
    expect(r.app).toMatchObject({ state: "needs-login", enabled: false });
    expect(r.flow).toMatchObject({ state: "waiting" });
    expect(f.registered).toHaveLength(1);
    expect(f.registered[0]).toMatchObject({ client_name: "AnyModelBot", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const a = approve(f, r.flow!.url);
    expect(a).toMatchObject({ redirect: REDIRECT, clientId: "client-1", scope: "docs" });
    expect(a.challenge).toBeTruthy();
    const done = await apps.oauthCallback({ state: a.state, code: a.code });
    expect(done.label).toBe("svc");
    expect(apps.flow(r.flow!.id)).toMatchObject({ state: "done", key: r.app.key });
    expect(apps.viewOf(r.app.key)).toMatchObject({ state: "connected", enabled: true });
    expect(apps.viewOf(r.app.key)!.config!.auth).toBe("oauth");
    const stored = secrets.get<any>(mcpSecretId(r.app.accounts[0].id)).oauth;
    expect(stored).toMatchObject({ clientId: "client-1", accessToken: f.token });
    expect(kv.dump()).not.toContain(f.token);
    // 用过的 state 不能再用
    await expect(apps.oauthCallback({ state: a.state, code: a.code })).rejects.toBeInstanceOf(AppUserError);
  });

  it("令牌过期能自动续期：不打断，状态保持已连接；续不了才变成授权过期，调用给出修复提示", async () => {
    const f = await newFake("oauth");
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "svc", transport: "http", url: f.url, auth: "oauth" }, { redirectUri: REDIRECT });
    const a = approve(f, r.flow!.url);
    await apps.oauthCallback({ state: a.state, code: a.code });
    const p = () => apps.prepare("b1", input(), { app: "svc", tool: "search_docs" });
    const first = f.token;
    f.expire();
    expect(await apps.call(p().conn, "search_docs", { q: "a" })).toContain("ran search_docs");
    expect(f.token).not.toBe(first);
    expect(f.tokenRequests.at(-1)!.get("grant_type")).toBe("refresh_token");
    expect(apps.viewOf(r.app.key)!.state).toBe("connected");
    f.expire();
    f.refuseRefresh = true;
    const err = await apps.call(p().conn, "search_docs", { q: "b" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.repair).toEqual({ app: r.app.key, state: "expired" });
    expect(apps.viewOf(r.app.key)!.state).toBe("expired");
    expect(apps.attention()).toBe(true);
    expect(apps.repairKind(r.app.key)).toMatchObject({ kind: "reauthorize", custom: true });
    // 重新授权：同一条连接，回调后又是已连接
    f.refuseRefresh = false;
    const flow = await apps.authorizeCustom(r.app.accounts[0].id, REDIRECT);
    const again = approve(f, flow.url);
    await apps.oauthCallback({ state: again.state, code: again.code });
    expect(apps.viewOf(r.app.key)!.state).toBe("connected");
    // 回调地址没变：用的还是上次注册的客户端，不重新注册
    expect(f.registered).toHaveLength(1);
  });

  it("预注册的客户端、关闭 PKCE：不去动态注册，授权地址里没有 code_challenge", async () => {
    const f = await newFake("oauth", { noRegistration: true });
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "svc", transport: "http", url: f.url, auth: "oauth", oauth: { clientId: "preset-client", clientSecret: "preset-secret-1", scopes: ["a", "b"], pkce: false } }, { redirectUri: REDIRECT });
    const a = approve(f, r.flow!.url);
    expect(a).toMatchObject({ clientId: "preset-client", scope: "a b", challenge: null });
    await apps.oauthCallback({ state: a.state, code: a.code });
    expect(apps.viewOf(r.app.key)!.state).toBe("connected");
    expect(f.registered).toHaveLength(0);
    expect(f.tokenRequests[0].get("client_secret")).toBe("preset-secret-1");
    expect(f.tokenRequests[0].get("code_verifier")).toBeNull();
    expect(apps.viewOf(r.app.key)!.config!.oauth).toEqual({ clientId: "preset-client", clientSecret: MASK, scopes: ["a", "b"], pkce: false });
  });

  it("服务不接受动态注册、又没填客户端 ID：说清要填客户端 ID，连接留着（需要登录）", async () => {
    const f = await newFake("oauth", { noRegistration: true });
    const { apps } = setup();
    await expect(apps.saveCustom({ name: "svc", transport: "http", url: f.url, auth: "oauth" }, { redirectUri: REDIRECT })).rejects.toThrow(/客户端 ID/);
    expect(apps.view().apps.find((x) => x.custom)).toMatchObject({ name: "svc", state: "needs-login", enabled: false });
  });

  it("关掉弹窗就取消：之后回调来了也不会冒出一个连接（内置应用新连的账号）", async () => {
    const f = await newFake("oauth");
    const { apps } = setup({ fetch: rewrite({ "https://mcp.linear.app": f.origin }) });
    const r = (await apps.connectBuiltin("linear", { redirectUri: REDIRECT })) as { flow: { id: string; url: string } };
    const a = approve(f, r.flow.url);
    apps.cancelFlow(r.flow.id);
    await expect(apps.oauthCallback({ state: a.state, code: a.code })).rejects.toBeInstanceOf(AppUserError);
    expect(apps.accounts("linear")).toEqual([]);
    expect(apps.flow(r.flow.id)).toMatchObject({ state: "cancelled" });
  });

  it("用户拒绝授权：流程失败，写明原因；授权页没跳回本机时可以把回跳地址粘贴进来", async () => {
    const f = await newFake("oauth");
    const { apps } = setup({ fetch: rewrite({ "https://mcp.linear.app": f.origin }) });
    const r1 = (await apps.connectBuiltin("linear", { redirectUri: REDIRECT })) as { flow: { id: string; url: string } };
    const a1 = approve(f, r1.flow.url);
    await expect(apps.oauthCallback({ state: a1.state, error: "access_denied" })).rejects.toThrow(/取消/);
    expect(apps.flow(r1.flow.id)).toMatchObject({ state: "failed" });
    const r2 = (await apps.connectBuiltin("linear", { redirectUri: "https://amb.example.com/oauth/apps/callback" })) as { flow: { id: string; url: string } };
    const a2 = approve(f, r2.flow.url);
    await expect(apps.finishFromUrl(r2.flow.id, "https://other.example.com/?state=nope&code=x")).rejects.toBeInstanceOf(AppUserError);
    await apps.finishFromUrl(r2.flow.id, `https://amb.example.com/oauth/apps/callback?code=${a2.code}&state=${a2.state}`);
    expect(apps.viewOf("linear")).toMatchObject({ connected: true });
    expect(apps.accounts("linear")[0].label).toBe("Linear");
  });
});

describe("内置应用", () => {
  it("清单：国内 5 个、海外 6 个，没有 Google；每个都有连接方式和官方文档", () => {
    expect(BUILTIN_APPS.map((a) => a.id)).toEqual(["feishu", "tencent-docs", "dingtalk", "amap", "yuque", "notion", "github", "linear", "atlassian", "canva", "levea"]);
    expect(BUILTIN_APPS.filter((a) => a.region === "cn")).toHaveLength(5);
    expect(BUILTIN_APPS.some((a) => /google/i.test(a.id + a.name.en + a.keywords.join(" ")))).toBe(false);
    for (const a of BUILTIN_APPS) {
      expect(a.methods.length, a.id).toBeGreaterThan(0);
      expect(a.docs, a.id).toMatch(/^https:\/\//);
    }
    expect(BUILTIN_APPS.find((a) => a.id === "tencent-docs")!.methods.map((m) => m.kind)).toEqual(["oauth", "header"]);
    expect(BUILTIN_APPS.find((a) => a.id === "yuque")!.termsUrl).toBeTruthy();
  });

  it("GitHub（粘贴个人令牌）：令牌被拒就不保存；连上后同一张卡片下可以有多个账号，各有序号和别名", async () => {
    const f = await newFake("oauth");
    const { apps } = setup({ fetch: rewrite({ "https://api.githubcopilot.com/mcp/": f.url }) });
    await expect(apps.connectBuiltin("github", { token: "ghp_wrong", redirectUri: REDIRECT })).rejects.toThrow(/密钥被拒/);
    expect(apps.accounts("github")).toEqual([]);
    f.token = "ghp_right_token_1";
    await apps.connectBuiltin("github", { token: f.token, redirectUri: REDIRECT });
    await apps.connectBuiltin("github", { token: f.token, redirectUri: REDIRECT });
    const view = apps.view();
    expect(view.apps.filter((a) => a.app === "github")).toHaveLength(1);
    const gh = apps.viewOf("github")!;
    expect(gh.accounts.map((a) => [a.number, a.label, a.method, a.state])).toEqual([[1, "GitHub", "headers", "connected"], [2, "GitHub 2", "headers", "connected"]]);
    expect(f.calls).toHaveLength(0);
    // 别名：同一个应用里不能重名、不能全是数字
    expect(apps.rename(gh.accounts[1].id, "GitHub")).toBe("taken");
    expect(apps.rename(gh.accounts[1].id, "42")).toBe("invalid");
    expect(apps.rename(gh.accounts[1].id, "工作")).toBe("ok");
    // 没说用哪个：报错让模型选；设了主账号就用主账号；按序号、按名字都能选
    expect(() => apps.resolveAccount("github", undefined, "mcp")).toThrow(/Several GitHub accounts/);
    apps.setPrimary("github", gh.accounts[1].id);
    expect(apps.resolveAccount("github", undefined, "mcp").label).toBe("工作");
    expect(apps.resolveAccount("github", "1", "mcp").label).toBe("GitHub");
    expect(apps.resolveAccount("github", "工作", "mcp").id).toBe(gh.accounts[1].id);
    expect(apps.viewOf("github")!.accounts[1].primary).toBe(true);
    // 修改密钥：就地更新，别名和序号不变
    f.token = "ghp_rotated_token_2";
    await apps.connectBuiltin("github", { token: f.token, redirectUri: REDIRECT, accountId: gh.accounts[1].id });
    expect(apps.viewOf("github")!.accounts.map((a) => a.label)).toEqual(["GitHub", "工作"]);
    // 断开一个，剩下的还在；主账号没了就清掉
    apps.remove(gh.accounts[1].id);
    expect(apps.viewOf("github")!.accounts.map((a) => a.label)).toEqual(["GitHub"]);
    expect(apps.store.primary().github).toBeUndefined();
  });

  it("高德（只填 Key）：Key 放进地址；对错的 Key 服务器回的不是 MCP，判成密钥被拒", async () => {
    const bad = await newFake("notmcp");
    const { apps } = setup({ fetch: rewrite({ "https://mcp.amap.com/mcp": bad.url }) });
    await expect(apps.connectBuiltin("amap", { key: "wrong-key", redirectUri: REDIRECT })).rejects.toThrow(/密钥被拒/);
    const good = await newFake("query", { tools: [{ name: "maps_weather", description: "weather", inputSchema: { type: "object" } }] });
    const s2 = setup({ fetch: rewrite({ "https://mcp.amap.com/mcp": good.url }) });
    await s2.apps.connectBuiltin("amap", { key: "good", redirectUri: REDIRECT });
    const view = s2.apps.viewOf("amap")!;
    expect(view.accounts[0]).toMatchObject({ method: "query", state: "connected", label: "高德地图" });
    // 高德只有查询：没有标注也都是只读
    expect(view.tools).toMatchObject([{ name: "maps_weather", category: "read" }]);
    expect(s2.kv.dump()).not.toContain("key=good");
  });

  it("钉钉（专属链接）：整条地址按密钥保存；不是地址的不收", async () => {
    const f = await newFake("query");
    const { apps, kv } = setup();
    await expect(apps.connectBuiltin("dingtalk", { url: "not a url", redirectUri: REDIRECT })).rejects.toBeInstanceOf(AppUserError);
    await apps.connectBuiltin("dingtalk", { url: `${f.url}?key=good`, redirectUri: REDIRECT });
    expect(apps.viewOf("dingtalk")!.accounts[0]).toMatchObject({ method: "dedicatedUrl", state: "connected" });
    expect(kv.dump()).not.toContain("key=good");
  });

  it("飞书（授权登录）：工具按内置的清单分类；Lark 是同一张卡片的另一个站点", async () => {
    const tools = [{ name: "search-doc", description: "search", inputSchema: { type: "object" } }, { name: "create-doc", description: "create", inputSchema: { type: "object" } }, { name: "get-messages", description: "read", inputSchema: { type: "object" } }];
    const f = await newFake("oauth", { tools });
    const { apps } = setup({ fetch: rewrite({ "https://mcp.feishu.cn": f.origin, "https://mcp.larksuite.com": f.origin }) });
    const r = (await apps.connectBuiltin("feishu", { redirectUri: REDIRECT })) as { flow: { id: string; url: string } };
    const a = approve(f, r.flow.url);
    await apps.oauthCallback({ state: a.state, code: a.code });
    const lark = (await apps.connectBuiltin("feishu", { variant: "lark", redirectUri: REDIRECT })) as { flow: { id: string; url: string } };
    const b = approve(f, lark.flow.url);
    await apps.oauthCallback({ state: b.state, code: b.code });
    const view = apps.viewOf("feishu")!;
    expect(view.accounts.map((x) => [x.label, x.method, x.state])).toEqual([["飞书", "oauth", "connected"], ["飞书 2", "oauth", "connected"]]);
    expect(view.tools.map((x) => [x.name, x.category])).toEqual([["search-doc", "read"], ["create-doc", "write"], ["get-messages", "read"]]);
    expect(apps.store.list("feishu").map((c) => c.url)).toEqual(["https://mcp.feishu.cn/mcp", "https://mcp.larksuite.com/mcp"]);
  });
});

describe("现有的 Notion、飞书账号（升级前连好的）", () => {
  function withLegacy() {
    const s = setup();
    s.connections.accounts.upsert({ service: "notion", label: "Acme", identity: "w1", auth: { kind: "notion-token", token: "ntn_token_abcdef" } });
    s.connections.accounts.upsert({ service: "feishu", label: "工作", identity: "u1", auth: { kind: "feishu-user", brand: "feishu", appId: "cli_1", appSecret: "app-secret-1", accessToken: "u-access-1", refreshToken: "ur-refresh-1", expiresAt: Date.now() + 3600_000 } });
    return s;
  }

  it("升级后打开就是已连接：各自一张卡片，原来的工具照旧，序号和别名不变", () => {
    const { apps } = withLegacy();
    const view = apps.view();
    expect(view.apps.filter((a) => a.app === "notion" || a.app === "feishu").map((a) => [a.key, a.connected, a.state])).toEqual([["feishu", true, "connected"], ["notion", true, "connected"]]);
    expect(apps.viewOf("notion")!.accounts).toMatchObject([{ number: 1, label: "Acme", method: "token", legacy: true, state: "connected" }]);
    expect(apps.viewOf("notion")!.tools.map((x) => [x.name, x.category])).toEqual([["notion_search", "read"], ["notion_read_page", "read"], ["notion_query_database", "read"], ["notion_create_page", "write"], ["notion_update_page", "write"]]);
    expect(apps.viewOf("feishu")!.accounts[0]).toMatchObject({ label: "工作", legacy: true, upgradable: true });
    expect(view.attention).toBe(false);
  });

  it("插件注册哪些现有工具：只读机器人没有写工具；关掉的、没分给它的应用没有", () => {
    const { apps } = withLegacy();
    expect(apps.pluginConfig("b1", input())).toEqual({ apps: true, tools: ["feishu_list_chats", "feishu_read_chat", "feishu_search_messages", "notion_search", "notion_read_page", "notion_query_database", "notion_create_page", "notion_update_page"] });
    expect(apps.pluginConfig("b1", input({ permission: "readonly" })).tools).not.toContain("notion_create_page");
    expect(apps.pluginConfig("b1", input({ apps: normalizeBotApps({ toolsOff: { notion: ["notion_search"] } }) })).tools).not.toContain("notion_search");
    expect(apps.pluginConfig("b1", input({ apps: normalizeBotApps({ mode: "selected", selected: ["feishu"] }) })).tools).toEqual(["feishu_list_chats", "feishu_read_chat", "feishu_search_messages"]);
    apps.setAccess("notion", ["b2"]);
    expect(apps.pluginConfig("b1", input()).tools.some((n) => n.startsWith("notion_"))).toBe(false);
    expect(apps.pluginConfig("b2", input()).tools).toContain("notion_search");
    // 目录 Bot 没声明 accounts 权限：什么都没有
    expect(apps.pluginConfig("b1", input({ allowed: false }))).toEqual({ apps: false, tools: [] });
  });

  it("授权失效的现有账号亮提醒点，对话里的修复卡片是「重新授权」", () => {
    const { apps, connections } = withLegacy();
    connections.accounts.update(connections.accounts.list("notion")[0].id, { needsReauth: true });
    expect(apps.attention()).toBe(true);
    expect(apps.viewOf("notion")).toMatchObject({ state: "expired", connected: false });
    expect(apps.repairKind("notion")).toMatchObject({ kind: "reauthorize", accountId: connections.accounts.list("notion")[0].id });
    expect(apps.repairKind("feishu")).toBeUndefined();
    expect(apps.repairKind("linear")).toMatchObject({ kind: "connect" });
  });

  it("飞书的现有账号授权云文档：换成 MCP 连接，占原来的位置——别名、序号不变，原来的账号去掉", async () => {
    const f = await newFake("oauth", { tools: [{ name: "search-doc", description: "s", inputSchema: { type: "object" } }] });
    const s = setup({ fetch: rewrite({ "https://mcp.feishu.cn": f.origin }) });
    s.connections.accounts.upsert({ service: "feishu", label: "工作", identity: "u1", auth: { kind: "feishu-user", brand: "feishu", appId: "cli_1", appSecret: "app-secret-1", accessToken: "u-access-1", refreshToken: "ur-refresh-1", expiresAt: Date.now() + 3600_000 } });
    const legacyId = s.connections.accounts.list("feishu")[0].id;
    await new Promise((r) => setTimeout(r, 5)); // 账号按添加时间排：两个账号隔开几毫秒
    // 先另外连一个新账号：排在现有账号后面
    const extra = (await s.apps.connectBuiltin("feishu", { redirectUri: REDIRECT })) as { flow: { url: string } };
    const e = approve(f, extra.flow.url);
    await s.apps.oauthCallback({ state: e.state, code: e.code });
    expect(s.apps.viewOf("feishu")!.accounts.map((a) => [a.number, a.label, !!a.legacy])).toEqual([[1, "工作", true], [2, "飞书", false]]);
    // 现有的那几个工具只能用现有账号；app_call 只能用 MCP 账号。选错了说清楚该用哪个
    expect(() => s.apps.resolveAccount("feishu", "2", "legacy")).toThrow(/app_call/);
    expect(() => s.apps.resolveAccount("feishu", "1", "mcp")).toThrow(/feishu_read_chat/);
    expect(s.apps.resolveAccount("feishu", undefined, "legacy").label).toBe("工作");
    const up = (await s.apps.connectBuiltin("feishu", { redirectUri: REDIRECT, accountId: legacyId })) as { flow: { url: string } };
    // 取消的话现有账号原样留着
    const u = approve(f, up.flow.url);
    expect(s.connections.accounts.list("feishu")).toHaveLength(1);
    await s.apps.oauthCallback({ state: u.state, code: u.code });
    expect(s.connections.accounts.list("feishu")).toHaveLength(0);
    expect(s.apps.viewOf("feishu")!.accounts.map((a) => [a.number, a.label, !!a.legacy])).toEqual([[1, "工作", false], [2, "飞书", false]]);
  });
});

describe("按机器人分配与模型看到的东西", () => {
  async function connected() {
    const f = await newFake("none");
    const s = setup();
    const r = await s.apps.saveCustom({ name: "docs", transport: "http", url: f.url, auth: "none" }, { redirectUri: REDIRECT });
    return { ...s, f, key: r.app.key };
  }

  it("默认所有机器人都能用；应用那边指定了机器人、或机器人这边只选了别的应用，就看不到也调不了", async () => {
    const { apps, key } = await connected();
    expect(apps.botApps("b1", input()).map((a) => a.key)).toEqual([key]);
    apps.setAccess(key, ["b2"]);
    expect(apps.botApps("b1", input())).toEqual([]);
    expect(apps.botApps("b2", input()).map((a) => a.key)).toEqual([key]);
    expect(() => apps.prepare("b1", input(), { app: "docs", tool: "search_docs" })).toThrow(AppError);
    apps.setAccess(key, "all");
    const selected = input({ apps: normalizeBotApps({ mode: "selected", selected: [] }) });
    expect(apps.botApps("b1", selected)).toEqual([]);
    expect(apps.allows("b1", normalizeBotApps({ mode: "selected", selected: [key] }), key)).toBe(true);
    // 机器人处于「仅选定」时，之后新连的应用不会自动加进来
    expect(apps.allows("b1", normalizeBotApps({ mode: "selected", selected: ["github"] }), key)).toBe(false);
  });

  it("按工具关闭：模型不再看到这个工具，直接调也被拒；其他机器人不受影响", async () => {
    const { apps, key } = await connected();
    const off = input({ apps: normalizeBotApps({ toolsOff: { [key]: ["create_doc"] } }) });
    expect(apps.searchTools("b1", off, { app: "docs" })).not.toContain("create_doc");
    expect(apps.searchTools("b2", input(), { app: "docs" })).toContain("create_doc");
    expect(() => apps.prepare("b1", off, { app: "docs", tool: "create_doc" })).toThrow(/no tool/);
    expect(apps.gate(off, key, { name: "create_doc", category: "write", hash: "h" })).toMatchObject({ action: "deny" });
  });

  it("三个固定工具给模型的文字：清单、找工具（带类别和参数）、看参数；没连的应用提示用 app_connect", async () => {
    const { apps } = await connected();
    const list = apps.listText("b1", input());
    expect(list).toContain('docs (custom connector, app "docs")');
    expect(list).toMatch(/Not connected yet.*feishu.*canva/);
    const found = apps.searchTools("b1", input(), { query: "create document" });
    expect(found.split("\n")[0]).toBe("- docs / create_doc [write] (title*: string, body: string): Create a document.");
    expect(apps.searchTools("b1", input(), { query: "zzzz" })).toMatch(/No tool matches/);
    const schema = apps.toolSchema("b1", input(), { app: "docs", tool: "search_docs" });
    expect(schema).toContain("docs / search_docs [read]");
    expect(schema).toContain('"required": [');
    const err = (() => { try { apps.prepare("b1", input(), { app: "feishu", tool: "search-doc" }); } catch (e) { return e as AppError; } })()!;
    expect(err.message).toMatch(/app_connect/);
    expect(err.repair).toEqual({ app: "feishu", state: "off" });
    expect(() => apps.prepare("b1", input(), { app: "nope", tool: "x" })).toThrow(/There is no app/);
    expect(apps.promptText("b1", input())).toMatch(/Connected apps.*docs[\s\S]*app_connect/);
    expect(apps.promptText("b1", input({ allowed: false }))).toBe("");
  });

  it("工具很多的服务器：一次只列一部分，搜得到需要的那个；设置里看得到全部", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ name: `tool_${i}`, description: i === 77 ? "Export the quarterly revenue report" : `Tool number ${i}`, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }));
    const f = await newFake("none", { tools: many });
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "big", transport: "http", url: f.url, auth: "none" }, { redirectUri: REDIRECT });
    expect(r.app.tools).toHaveLength(120);
    const listed = apps.searchTools("b1", input(), { app: "big" });
    expect(listed.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(40);
    expect(listed).toContain("and 80 more");
    expect(apps.searchTools("b1", input(), { query: "quarterly revenue" })).toContain("big / tool_77");
    const p = apps.prepare("b1", input(), { app: "big", tool: "tool_77" });
    expect(await apps.call(p.conn, "tool_77", {})).toContain("ran tool_77");
  });

  it("超长的结果截断，末尾写明被截断了；工具自己报错时把原话给模型", async () => {
    const { apps } = await connected();
    const big = await apps.call(apps.prepare("b1", input(), { app: "docs", tool: "big" }).conn, "big", {});
    expect(big.length).toBeLessThan(MAX_RESULT + 100);
    expect(big).toMatch(/结果过长，已截断。\]$/);
    await expect(apps.call(apps.prepare("b1", input(), { app: "docs", tool: "broken" }).conn, "broken", {})).rejects.toThrow("it broke");
  });

  it("调用时密钥被拒：连接的状态改掉，给出修复提示（对话里出「更新密钥」卡片）", async () => {
    const f = await newFake("header");
    const { apps } = setup();
    const r = await apps.saveCustom({ name: "docs", transport: "http", url: f.url, auth: "headers", headers: [["x-key", "good"]] }, { redirectUri: REDIRECT });
    const p = apps.prepare("b1", input(), { app: "docs", tool: "search_docs" });
    // 服务端把这把钥匙作废了（用一个只认别的钥匙的服务器顶替同一个端口太绕，这里直接改凭证模拟）
    apps.store.setSecrets(p.conn.id, { headers: { "x-key": "revoked" } });
    await (apps as any).dropSession(p.conn.id);
    const err = await apps.call(p.conn, "search_docs", { q: "a" }).catch((e) => e);
    expect(err.repair).toEqual({ app: r.app.key, state: "key-rejected" });
    expect(apps.viewOf(r.app.key)!.state).toBe("key-rejected");
    expect(apps.repairKind(r.app.key)).toMatchObject({ kind: "key" });
    // 之后的调用不再去撞服务器，直接说要更新密钥
    await expect(apps.call(p.conn, "search_docs", { q: "b" })).rejects.toThrow(/update it/);
  });
});

describe("审批判定（三档权限 × 四类工具）", () => {
  const key = "docs-app";
  const tool = (category: any, name = "t") => ({ name, category, hash: "h1" });
  const { apps } = setup();

  it("只读工具：任何档位直接用", () => {
    for (const permission of ["readonly", "workspace", "full"] as const) expect(apps.gate(input({ permission }), key, tool("read"))).toEqual({ action: "allow" });
  });

  it("只读机器人：写入、删除、对外发送都不给", () => {
    for (const c of ["write", "delete", "send"]) expect(apps.gate(input({ permission: "readonly" }), key, tool(c))).toMatchObject({ action: "deny", reason: expect.stringMatching(/read-only/) });
  });

  it("工作区可写（默认）：写入先问、可以「以后都允许」；删除和对外发送每次都问、没有「以后都允许」", () => {
    expect(apps.gate(input(), key, tool("write"))).toEqual({ action: "ask", always: true });
    expect(apps.gate(input(), key, tool("delete"))).toEqual({ action: "ask", always: false });
    expect(apps.gate(input(), key, tool("send"))).toEqual({ action: "ask", always: false });
  });

  it("完全权限：写入直接执行；删除和对外发送仍然每次都问", () => {
    expect(apps.gate(input({ permission: "full" }), key, tool("write"))).toEqual({ action: "allow" });
    expect(apps.gate(input({ permission: "full" }), key, tool("delete"))).toEqual({ action: "ask", always: false });
    expect(apps.gate(input({ permission: "full" }), key, tool("send"))).toEqual({ action: "ask", always: false });
  });

  it("「以后这个工具都允许」：只对这个机器人的这一个工具；工具的定义变了（指纹对不上）就重新问；对删除、发送不起作用", () => {
    const granted = input({ apps: normalizeBotApps({ alwaysAllow: { [key]: { t: "h1", wipe: "h1" } } }) });
    expect(apps.gate(granted, key, tool("write"))).toEqual({ action: "allow" });
    expect(apps.gate(granted, key, tool("write", "other"))).toEqual({ action: "ask", always: true });
    expect(apps.gate(granted, key, { name: "t", category: "write", hash: "h2" })).toEqual({ action: "ask", always: true });
    expect(apps.gate(granted, "another-app", tool("write"))).toEqual({ action: "ask", always: true });
    expect(apps.gate(granted, key, tool("delete", "wipe"))).toEqual({ action: "ask", always: false });
  });

  it("「只观察」的规则：读可以，写入、删除、对外发送都拒绝并说明原因", () => {
    const observe = input({ permission: "full", ruleMode: "observe" });
    expect(apps.gate(observe, key, tool("read"))).toEqual({ action: "allow" });
    for (const c of ["write", "delete", "send"]) expect(apps.gate(observe, key, tool(c))).toEqual({ action: "deny", reason: "This task is observe-only and can't use write, delete, or outbound tools." });
    expect(apps.gate(input({ ruleMode: "act" }), key, tool("write"))).toEqual({ action: "ask", always: true });
  });

  it("现有的 Notion 工具也走同一套：建页面、改页面是写入", () => {
    expect(apps.legacyTool("notion", "create")).toMatchObject({ key: "notion", tool: { name: "notion_create_page", category: "write" } });
    expect(apps.legacyTool("notion", "search")!.tool.category).toBe("read");
    expect(apps.legacyTool("feishu", "read")!.tool.category).toBe("read");
    expect(apps.legacyTool("github", "x")).toBeUndefined();
  });

  it("机器人的应用设置：不认识的字段丢掉，默认是使用全部", () => {
    expect(normalizeBotApps(undefined)).toEqual({ mode: "all", selected: [], toolsOff: {}, alwaysAllow: {} });
    expect(normalizeBotApps({ mode: "selected", selected: ["feishu", "custom:abc", 3, "bad key!"], toolsOff: { feishu: ["a", "a", ""], "bad key!": ["x"] }, alwaysAllow: { feishu: { t: "h", u: 1 } } })).toEqual({ mode: "selected", selected: ["feishu", "custom:abc"], toolsOff: { feishu: ["a"] }, alwaysAllow: { feishu: { t: "h" } } });
  });
});
