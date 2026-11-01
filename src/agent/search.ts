/**
 * 联网搜索：代理的 web_search 工具（DSH 的 ctx.web 选中 amb-web-search 插件注册的 "amb" 提供方）经内部 bridge 调到这里，
 * 由宿主搜索。代理子进程里没有任何搜索 Key，也不用 DeepSeek 自带的搜索（它要 DeepSeek 的 Key）。
 *
 * - 网络：桌面版用 Chromium 的网络栈（Electron net.fetch：系统代理、PAC、系统证书），和下载 PowerShell 一样；
 *   命令行 / Docker 用 Node 的 fetch（Node 22.21+ 设 NODE_USE_ENV_PROXY=1 后认 HTTPS_PROXY）。
 * - 默认（自动）不用 Key：Exa 的公开 MCP → 必应网页 → DuckDuckGo 网页，上一次成功的排最前。某个出错（网络、超时、
 *   限流、人机验证页、必应给出与问题无关的结果）就冷却一段时间不用；全都在冷却时照样都试。某个说"没有结果"不算出错，
 *   接着问下一个。
 * - 设置里选了带 Key 的接口（Tavily / Exa / 博查 / 智谱）或填了 SearXNG 地址时先用它；它出错就退回免费的
 *   （Key 被拒记一条警告，设置页也会提示），同样冷却一段时间。
 * - 结果按 URL 去重、截到 maxResults 条；日志只记用了哪个后端、几条、耗时，不记查询内容和 Key。
 */
import { logger, registerSecret, mask } from "../log.js";
import { appLang, type Lang } from "../i18n/index.js";

const log = logger("agent.search");

// ---------- 设置 ----------

export const SEARCH_PROVIDERS = ["auto", "tavily", "exa", "bocha", "zhipu", "searxng"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];
/** 带 Key 的接口 */
export type KeyedProvider = Exclude<SearchProvider, "auto" | "searxng">;
const KEYED: readonly KeyedProvider[] = ["tavily", "exa", "bocha", "zhipu"];

/** 应用级（不分机器人）：存在 SQLite 的 kv 表，和渠道令牌一样只靠数据目录的权限保护；Key 按接口分开存，切换不丢 */
export interface WebSearchSettings {
  provider: SearchProvider;
  keys: Partial<Record<KeyedProvider, string>>;
  /** SearXNG 实例地址 */
  url: string;
}
export const WEB_SEARCH_KV = "web-search";

export function normalizeWebSearch(v: unknown): WebSearchSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, any>;
  const provider = SEARCH_PROVIDERS.includes(o.provider) ? (o.provider as SearchProvider) : "auto";
  const keys: WebSearchSettings["keys"] = {};
  for (const p of KEYED) {
    const k = typeof o.keys?.[p] === "string" ? o.keys[p].trim() : "";
    if (k) keys[p] = k;
  }
  const url = typeof o.url === "string" ? o.url.trim() : "";
  return { provider, keys, url };
}

/** SearXNG 地址：http(s)，去掉末尾的 /search 和斜杠；不合法返回 undefined */
export function normalizeSearxUrl(v: string): string | undefined {
  const s = v.trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.search = "";
    u.hash = "";
    return u.href.replace(/\/+$/, "").replace(/\/search$/, "");
  } catch {
    return undefined;
  }
}

interface KvStore {
  getKV(key: string): string | undefined;
  setKV(key: string, value: string): void;
}
export function loadWebSearch(store: KvStore): WebSearchSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(store.getKV(WEB_SEARCH_KV) ?? "null");
  } catch {
    raw = undefined;
  }
  const s = normalizeWebSearch(raw);
  for (const k of Object.values(s.keys)) registerSecret(k);
  return s;
}
export function saveWebSearch(store: KvStore, s: WebSearchSettings): void {
  for (const k of Object.values(s.keys)) registerSecret(k);
  store.setKV(WEB_SEARCH_KV, JSON.stringify(s));
}

/** 设置页看到的：接口、当前接口 Key 的末 4 位、SearXNG 地址；Key 最近被拒时 keyRejected */
export interface WebSearchView {
  provider: SearchProvider;
  keyTail: string;
  url: string;
  keyRejected: boolean;
}

// ---------- 结果与错误 ----------

export interface WebSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

/** network 网络不通；timeout 超时；auth Key 被拒；rate 限流；blocked 人机验证 / 拦截；unrelated 结果与问题无关；format 看不懂的回复 */
export type FailKind = "network" | "timeout" | "http" | "auth" | "rate" | "blocked" | "unrelated" | "format";

export class SearchFailure extends Error {
  constructor(
    readonly backend: string,
    readonly kind: FailKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
/** 调用方取消（工具超时、用户中止）：不算后端出错 */
export class SearchAborted extends Error {}

export interface BackendContext {
  fetch: typeof fetch;
  signal: AbortSignal;
  lang: Lang;
}
/** 一个搜索后端：返回结果（空数组 = 确实没有结果）；出错抛 SearchFailure */
export interface SearchBackend {
  id: string;
  search(query: string, count: number, ctx: BackendContext): Promise<WebSource[]>;
}

// ---------- 文本工具（不依赖 HTML 解析库：搜索页只取标题、链接、摘要几样） ----------

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  middot: "·", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", bull: "•", copy: "©", reg: "®", trade: "™", times: "×", deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML 片段 → 一行纯文本（行内标签如命中词的 <strong> 直接去掉，其他标签换成空格） */
export function htmlText(s: string): string {
  return decodeEntities(
    s
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(b|strong|em|i|u|mark|span|a|abbr|code|sup|sub|small|font|wbr)\b[^>]*>/gi, "")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** 开始标签里的一个属性值（已解码实体） */
export function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
}

const SNIPPET_MAX = 300;
/** 摘要：去掉 Markdown 标题符号和分隔线，压成一行，截到 SNIPPET_MAX */
export function tidy(s: string, max = SNIPPET_MAX): string {
  const t = s
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*(-{3,}|\*{3,}|\.{3})\s*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function source(url: string, title?: string, snippet?: string, publishedAt?: string): WebSource {
  const t = title ? tidy(title, 200) : "";
  const s = snippet ? tidy(snippet) : "";
  const d = (publishedAt ?? "").trim().replace(/T00:00:00(\.0+)?Z$/, "");
  return { url, ...(t ? { title: t } : {}), ...(s ? { snippet: s } : {}), ...(d && !/^n\/?a$/i.test(d) ? { publishedAt: d } : {}) };
}

const httpUrl = (u: string | undefined): u is string => !!u && /^https?:\/\/[^\s/]+/i.test(u);

// ---------- HTTP ----------

/** 普通桌面浏览器的请求头（必应、DuckDuckGo 的网页版对脚本样的请求给验证页或无关结果） */
export const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
function browserHeaders(lang: Lang): Record<string, string> {
  return {
    "user-agent": BROWSER_UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": lang === "zh-CN" ? "zh-CN,zh;q=0.9,en;q=0.8" : "en-US,en;q=0.9",
  };
}

async function send(backend: string, ctx: BackendContext, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (e) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? e;
    throw new SearchFailure(backend, "network", errText(e));
  }
}

async function read(backend: string, ctx: BackendContext, res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (e) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? e;
    throw new SearchFailure(backend, "network", errText(e));
  }
}

/** 非 2xx：401/403 对带 Key 的接口是 Key 被拒，对网页是被拦截；429 限流 */
async function httpFailure(backend: string, res: Response, keyed: boolean): Promise<SearchFailure> {
  const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
  const s = res.status;
  const kind: FailKind = s === 401 || s === 403 ? (keyed ? "auth" : "blocked") : s === 429 ? "rate" : "http";
  return new SearchFailure(backend, kind, `HTTP ${s}${body ? `: ${body}` : ""}`, s);
}

function errText(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `${err?.message ?? String(e)}${cause ? ` (${cause})` : ""}`.slice(0, 200);
}

// ---------- Exa 公开 MCP（免 Key，有频率限制） ----------

export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

/** MCP 的 HTTP 回复：JSON，或 SSE（data: 行）里的一条 JSON-RPC 消息 */
export function parseRpcReply(body: string): any {
  const t = body.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  let found: any;
  for (const event of t.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg && typeof msg === "object" && ("result" in msg || "error" in msg)) {
        if (msg.id === 1) return msg;
        found ??= msg;
      }
    } catch {
      /* 不是 JSON 的事件跳过 */
    }
  }
  if (found) return found;
  throw new Error("no JSON-RPC message in the reply");
}

/**
 * web_search_exa 的文字结果：每条是 "Title: …\nURL: …\nPublished: …\nAuthor: …\nHighlights:\n…"，条与条之间 "---"。
 * 正文里也可能有 "---"，所以按"Title: 行后面紧跟 URL: 行"找每条的开头。也认旧格式（Published Date: / Text:）和 JSON。
 */
export function parseExaText(text: string): WebSource[] {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.results) ? j.results : [];
      return list
        .filter((r) => httpUrl(r?.url))
        .map((r) => source(r.url, str(r.title), str(r.text) || (Array.isArray(r.highlights) ? r.highlights.join(" ") : "") || str(r.summary), str(r.publishedDate)));
    } catch {
      /* 不是 JSON：按文字解析 */
    }
  }
  const lines = t.split(/\r?\n/);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^Title:/.test(lines[i]) && lines.slice(i + 1, i + 4).some((l) => /^URL:\s*\S/.test(l))) starts.push(i);
  }
  const out: WebSource[] = [];
  starts.forEach((s, n) => {
    const rec = lines.slice(s, starts[n + 1] ?? lines.length);
    const title = rec[0].replace(/^Title:\s*/, "");
    let url = "";
    let published = "";
    let body: string[] = [];
    for (let i = 1; i < rec.length; i++) {
      const l = rec[i];
      const m = l.match(/^(URL|Published(?: Date)?|Author|Highlights|Text|Summary|Content):\s*(.*)$/);
      if (!m) continue;
      if (m[1] === "URL") url ||= m[2].trim();
      else if (m[1].startsWith("Published")) published ||= m[2].trim();
      else if (m[1] !== "Author") {
        body = [m[2], ...rec.slice(i + 1)];
        break;
      }
    }
    while (body.length && /^\s*(-{3,})?\s*$/.test(body[body.length - 1])) body.pop();
    if (httpUrl(url)) out.push(source(url, title, body.join("\n"), published));
  });
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** tools/call 的回复 → 结果；限流、出错抛 SearchFailure；"没有结果"返回空 */
export function exaMcpResults(msg: any): WebSource[] {
  if (msg?.error) throw new SearchFailure("exa-mcp", "format", `JSON-RPC error ${msg.error.code ?? ""}: ${String(msg.error.message ?? "").slice(0, 200)}`);
  const result = msg?.result;
  const text = (Array.isArray(result?.content) ? result.content : [])
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
  if (result?._meta?.["ai.exa/rateLimited"] === true || (/rate limit/i.test(text) && !/^URL:/m.test(text))) {
    throw new SearchFailure("exa-mcp", "rate", "free MCP rate limit");
  }
  if (result?.isError) throw new SearchFailure("exa-mcp", "format", text.slice(0, 200) || "tool error");
  const sources = parseExaText(text);
  if (sources.length) return sources;
  if (/no (search )?results found/i.test(text) || !text.trim()) return [];
  throw new SearchFailure("exa-mcp", "format", `unrecognized reply: ${text.slice(0, 120)}`);
}

export const exaMcp: SearchBackend = {
  id: "exa-mcp",
  async search(query, count, ctx) {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query, objective: query.slice(0, 4000), numResults: count } },
    };
    const res = await send("exa-mcp", ctx, EXA_MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await httpFailure("exa-mcp", res, false);
    const text = await read("exa-mcp", ctx, res);
    let msg: unknown;
    try {
      msg = parseRpcReply(text);
    } catch (e) {
      throw new SearchFailure("exa-mcp", "format", errText(e));
    }
    return exaMcpResults(msg);
  },
};

// ---------- 必应网页 ----------

/** 必应的跳转链接 bing.com/ck/a?…&u=a1<base64url> → 真实地址；不是跳转链接原样返回 */
export function bingTarget(href: string): string | undefined {
  let u: URL;
  try {
    u = new URL(href, "https://www.bing.com/");
  } catch {
    return undefined;
  }
  if (/(^|\.)bing\.com$/i.test(u.hostname) && u.pathname === "/ck/a") {
    const p = u.searchParams.get("u") ?? "";
    if (!p.startsWith("a1")) return undefined;
    try {
      const real = Buffer.from(p.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      return httpUrl(real) ? real : undefined;
    } catch {
      return undefined;
    }
  }
  return httpUrl(u.href) ? u.href : undefined;
}

/** 必应结果页：自然结果（li.b_algo：h2 > a 是标题和链接，.b_caption p 是摘要，span.news_dt 是日期）；noResults = 明确说没有结果 */
export function parseBing(html: string): { results: WebSource[]; noResults: boolean; page: boolean } {
  const results: WebSource[] = [];
  const starts = [...html.matchAll(/<li\s+class="b_algo[\s"]/g)].map((m) => m.index!);
  starts.forEach((s, i) => {
    let block = html.slice(s, starts[i + 1] ?? html.length);
    const end = block.indexOf("</ol>");
    if (end > 0) block = block.slice(0, end);
    const h2 = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    const a = h2?.[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!h2 || !a) return;
    const url = bingTarget(attr(a[0], "href") ?? "");
    if (!url) return;
    const rest = block.slice(h2.index! + h2[0].length);
    const p = rest.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    let snippet = p?.[1] ?? "";
    const date = snippet.match(/<span class="news_dt">([\s\S]*?)<\/span>/i);
    if (date) snippet = snippet.replace(date[0], "");
    snippet = htmlText(snippet).replace(/^[\s·•|-]+/, "");
    results.push(source(url, htmlText(a[2]), snippet, date ? htmlText(date[1]) : undefined));
  });
  return { results, noResults: /class="b_no"/.test(html), page: /id="b_results"/.test(html) };
}

const STOPWORDS = new Set(
  "the and for with what how why who when where which are was were is of to in on an by from about into vs not you your can does this that best new free top".split(" "),
);
/** 用来判断结果是否切题的词：拉丁等字母文字取 ≥3 个字符的词（去掉常见虚词），中日韩文字取相邻两字 */
export function queryTerms(q: string): string[] {
  const lower = q.toLowerCase();
  const out = new Set<string>();
  for (const w of lower.match(/[\p{L}\p{N}][\p{L}\p{N}.+#'_-]*/gu) ?? []) {
    const word = w.replace(/[.'_-]+$/, "");
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)) continue;
    if (word.length >= 3 && /\p{L}/u.test(word) && !STOPWORDS.has(word)) out.add(word);
  }
  for (const run of lower.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/**
 * 结果是否切题：至少三分之一的结果（标题、摘要、网址）含有查询里的词。必应对它认为是脚本的请求（常见于机房 IP）
 * 返回 200 和一页别的热门搜索的结果，只能这样识别出来，交给下一个后端。
 */
export function relevant(query: string, results: WebSource[]): boolean {
  const terms = queryTerms(query);
  if (!terms.length || !results.length) return true;
  const hit = results.filter((r) => {
    const hay = `${r.title ?? ""} ${r.snippet ?? ""} ${decodeURIComponentSafe(r.url)}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  }).length;
  return hit >= 1 && hit * 3 >= results.length;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const bing: SearchBackend = {
  id: "bing",
  async search(query, count, ctx) {
    // 中文界面先试 cn.bing.com（中国大陆直接可用）；在境外它会跳回 www.bing.com 首页，那就再试 www.bing.com
    const hosts = ctx.lang === "zh-CN" ? ["cn.bing.com", "www.bing.com"] : ["www.bing.com"];
    let last: SearchFailure | undefined;
    for (const host of hosts) {
      const res = await send("bing", ctx, `https://${host}/search?q=${encodeURIComponent(query)}`, { headers: browserHeaders(ctx.lang) });
      if (!res.ok) {
        last = await httpFailure("bing", res, false);
        continue;
      }
      const page = parseBing(await read("bing", ctx, res));
      if (page.results.length) {
        if (!relevant(query, page.results)) throw new SearchFailure("bing", "unrelated", "results do not match the query");
        return page.results.slice(0, count);
      }
      if (page.noResults) return [];
      last = new SearchFailure("bing", "blocked", page.page ? "results page without results" : "not a results page");
    }
    throw last ?? new SearchFailure("bing", "blocked", "not a results page");
  },
};

// ---------- DuckDuckGo 网页（html.duckduckgo.com） ----------

/** DuckDuckGo 的跳转链接 //duckduckgo.com/l/?uddg=<编码后的地址> → 真实地址；广告（y.js）不要 */
export function ddgTarget(href: string): string | undefined {
  let u: URL;
  try {
    u = new URL(href.startsWith("//") ? `https:${href}` : href, "https://html.duckduckgo.com/");
  } catch {
    return undefined;
  }
  if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) {
    if (u.pathname === "/l/" || u.pathname === "/l") {
      const real = u.searchParams.get("uddg") ?? "";
      if (!httpUrl(real)) return undefined;
      try {
        if (/(^|\.)duckduckgo\.com$/i.test(new URL(real).hostname)) return undefined;
      } catch {
        return undefined;
      }
      return real;
    }
    return undefined;
  }
  return httpUrl(u.href) ? u.href : undefined;
}

/** DuckDuckGo 结果页：.result（去掉 .result--ad），a.result__a 是标题和链接，.result__snippet 是摘要；challenge = 人机验证页 */
export function parseDdg(html: string): { results: WebSource[]; noResults: boolean; challenge: boolean } {
  const results: WebSource[] = [];
  const heads = [...html.matchAll(/<div\s+class="(result\b[^"]*)"/g)].filter((m) => /(^|\s)result(\s|$)/.test(m[1]));
  heads.forEach((m, i) => {
    if (/\bresult--ad\b/.test(m[1])) return;
    const block = html.slice(m.index!, heads[i + 1]?.index ?? html.length);
    const a = block.match(/<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i);
    if (!a) return;
    const url = ddgTarget(attr(a[0], "href") ?? "");
    if (!url) return;
    const sn = block.match(/<(a|div|td|span)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
    results.push(source(url, htmlText(a[2]), sn ? htmlText(sn[2]) : ""));
  });
  return {
    results,
    noResults: /class="no-results"/.test(html),
    challenge: /anomaly-modal|anomaly\.js|challenge-form/.test(html),
  };
}

export const duckduckgo: SearchBackend = {
  id: "duckduckgo",
  async search(query, count, ctx) {
    const res = await send("duckduckgo", ctx, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: browserHeaders(ctx.lang) });
    // 人机验证页回 202
    if (res.status === 202) throw new SearchFailure("duckduckgo", "blocked", "bot challenge", 202);
    if (!res.ok) throw await httpFailure("duckduckgo", res, false);
    const page = parseDdg(await read("duckduckgo", ctx, res));
    if (page.results.length) return page.results.slice(0, count);
    if (page.challenge) throw new SearchFailure("duckduckgo", "blocked", "bot challenge");
    if (page.noResults) return [];
    // 200 却一条也解析不出来、也没说没有结果：多半是验证页或改版，当出错
    throw new SearchFailure("duckduckgo", "blocked", "no results parsed");
  },
};

export const FREE_BACKENDS: readonly SearchBackend[] = [exaMcp, bing, duckduckgo];

// ---------- 带 Key 的接口 ----------

/** 带 Key 的接口（或 SearXNG）的一次请求：地址、请求参数，和把回复变成结果的函数 */
export interface KeyedRequest {
  url: string;
  init: RequestInit;
  parse(j: any): WebSource[];
}

/** 按设置构造请求；没填 Key / 地址时返回 undefined（直接用免费的） */
export function keyedRequest(s: WebSearchSettings, query: string, count: number): KeyedRequest | undefined {
  const json = (headers: Record<string, string>, body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  if (s.provider === "searxng") {
    if (!s.url) return undefined;
    return {
      url: `${s.url}/search?q=${encodeURIComponent(query)}&format=json`,
      init: { headers: { accept: "application/json" } },
      parse: (j) => list(j?.results).filter((r) => httpUrl(r?.url)).map((r) => source(r.url, str(r.title), str(r.content), str(r.publishedDate))),
    };
  }
  if (s.provider === "auto") return undefined;
  const key = s.keys[s.provider];
  if (!key) return undefined;
  switch (s.provider) {
    case "tavily":
      return {
        url: "https://api.tavily.com/search",
        init: json({ authorization: `Bearer ${key}` }, { query, max_results: Math.min(count, 20) }),
        parse: (j) => list(j?.results).filter((r) => httpUrl(r?.url)).map((r) => source(r.url, str(r.title), str(r.content), str(r.published_date))),
      };
    case "exa":
      return {
        url: "https://api.exa.ai/search",
        init: json({ "x-api-key": key }, { query, numResults: Math.min(count, 25), type: "auto", contents: { highlights: { maxCharacters: 300 } } }),
        parse: (j) =>
          list(j?.results)
            .filter((r) => httpUrl(r?.url))
            .map((r) => source(r.url, str(r.title), list(r.highlights).filter((h) => typeof h === "string").join(" ") || str(r.summary) || str(r.text), str(r.publishedDate))),
      };
    case "bocha":
      return {
        url: "https://api.bochaai.com/v1/web-search",
        init: json({ authorization: `Bearer ${key}` }, { query, count: Math.min(count, 50), summary: true }),
        parse: (j) => {
          if (j?.code !== undefined && Number(j.code) !== 200) throw new SearchFailure("bocha", "http", `code ${j.code}: ${str(j.msg).slice(0, 200)}`);
          return list(j?.data?.webPages?.value)
            .filter((r) => httpUrl(r?.url))
            .map((r) => source(r.url, str(r.name), str(r.summary) || str(r.snippet), str(r.datePublished)));
        },
      };
    case "zhipu":
      return {
        url: "https://open.bigmodel.cn/api/paas/v4/web_search",
        init: json({ authorization: `Bearer ${key}` }, { search_query: query.slice(0, 70), search_engine: "search_std", search_intent: false, count: Math.min(count, 50) }),
        parse: (j) => list(j?.search_result).filter((r) => httpUrl(r?.link)).map((r) => source(r.link, str(r.title), str(r.content), str(r.publish_date))),
      };
  }
}

/** 设置对应的后端（没填 Key / 地址时 undefined） */
export function keyedBackend(s: WebSearchSettings): SearchBackend | undefined {
  if (!keyedRequest(s, "q", 1)) return undefined;
  const id = s.provider;
  const keyed = s.provider !== "searxng";
  return {
    id,
    async search(query, count, ctx) {
      const r = keyedRequest(s, query, count)!;
      const res = await send(id, ctx, r.url, r.init);
      if (!res.ok) throw await httpFailure(id, res, keyed);
      const text = await read(id, ctx, res);
      let j: unknown;
      try {
        j = JSON.parse(text);
      } catch {
        throw new SearchFailure(id, "format", `not JSON: ${text.slice(0, 120)}`);
      }
      return r.parse(j);
    },
  };
}

// ---------- 服务 ----------

export interface SearchServiceOptions {
  settings: () => WebSearchSettings;
  /** 桌面版是 Electron 的 net.fetch（系统代理）；缺省 Node 的 fetch。每次搜索时取 */
  fetch?: () => typeof fetch | undefined;
  lang?: () => Lang;
  /** 每个后端最多等多久（DSH 的 web_search 工具总共等 60 秒） */
  timeoutMs?: number;
  /** 出错后多久不再用它 */
  cooldownMs?: number;
  now?: () => number;
  /** 测试注入：免费后端 */
  free?: readonly SearchBackend[];
}

export interface SearchOutcome {
  sources: WebSource[];
  /** 给出结果的后端；都没有结果时是最后问的那个 */
  backend: string;
}

export const SEARCH_TIMEOUT_MS = 12_000;
export const SEARCH_COOLDOWN_MS = 10 * 60_000;

export class SearchService {
  private cooldown = new Map<string, number>();
  private lastGood: string | undefined;
  /** 带 Key 的接口最近一次出错（设置变了就清掉）；Key 被拒时设置页提示 */
  private keyed: { sig: string; failure?: SearchFailure } = { sig: "" };

  constructor(private o: SearchServiceOptions) {}

  /** 设置页：当前接口、Key 末 4 位、SearXNG 地址、Key 是否刚被拒 */
  view(): WebSearchView {
    const s = this.o.settings();
    const key = s.provider === "auto" || s.provider === "searxng" ? "" : (s.keys[s.provider] ?? "");
    const f = this.keyed.sig === sig(s) ? this.keyed.failure : undefined;
    return { provider: s.provider, keyTail: key ? mask(key).slice(-4) : "", url: s.url, keyRejected: f?.kind === "auth" };
  }

  async search(query: string, maxResults = 8, signal?: AbortSignal): Promise<SearchOutcome> {
    const q = query.trim();
    const n = Math.max(1, Math.min(20, Math.floor(maxResults) || 8));
    const t0 = Date.now();
    const s = this.o.settings();
    if (this.keyed.sig !== sig(s)) {
      this.keyed = { sig: sig(s) };
      for (const k of [...this.cooldown.keys()]) if (k.startsWith("keyed:")) this.cooldown.delete(k);
    }
    const tried: string[] = [];
    let empty: string | undefined;
    const keyed = keyedBackend(s);
    const queue: Array<{ b: SearchBackend; slot: string }> = [];
    if (keyed && this.ready(`keyed:${keyed.id}`)) queue.push({ b: keyed, slot: `keyed:${keyed.id}` });
    for (const b of this.order()) queue.push({ b, slot: b.id });
    for (const { b, slot } of queue) {
      try {
        const got = dedupe(await this.attempt(b, q, n, signal)).slice(0, n);
        if (slot === `keyed:${b.id}`) this.keyed.failure = undefined;
        if (!got.length) {
          empty ??= b.id;
          tried.push(`${b.id}: no results`);
          continue;
        }
        this.cooldown.delete(slot);
        if (slot === b.id) this.lastGood = b.id;
        log.info("web search", { backend: b.id, results: got.length, ms: Date.now() - t0, ...(tried.length ? { before: tried } : {}) });
        return { sources: got, backend: b.id };
      } catch (e) {
        if (e instanceof SearchAborted) throw e;
        const f = e instanceof SearchFailure ? e : new SearchFailure(b.id, "format", errText(e));
        this.cooldown.set(slot, this.now() + (this.o.cooldownMs ?? SEARCH_COOLDOWN_MS));
        tried.push(`${b.id}: ${f.kind}`);
        if (slot === `keyed:${b.id}`) {
          this.keyed.failure = f;
          if (f.kind === "auth") log.warn("web search key rejected; using the free search", { provider: b.id, status: f.status });
          else log.warn("web search provider failed; using the free search", { provider: b.id, kind: f.kind, status: f.status, error: f.message });
        } else log.warn("web search backend failed", { backend: b.id, kind: f.kind, status: f.status, error: f.message });
      }
    }
    if (empty) {
      log.info("web search", { backend: empty, results: 0, ms: Date.now() - t0, tried });
      return { sources: [], backend: empty };
    }
    log.warn("web search failed on every backend", { ms: Date.now() - t0, tried });
    throw new SearchFailure("all", "network", tried.join("; "));
  }

  /** 免费后端的顺序：上次成功的在前；冷却中的跳过，全在冷却时按冷却先结束的顺序都试 */
  private order(): SearchBackend[] {
    const all = [...(this.o.free ?? FREE_BACKENDS)];
    const ready = all.filter((b) => this.ready(b.id));
    if (!ready.length) return all.sort((a, b) => (this.cooldown.get(a.id) ?? 0) - (this.cooldown.get(b.id) ?? 0));
    const i = ready.findIndex((b) => b.id === this.lastGood);
    if (i > 0) ready.unshift(...ready.splice(i, 1));
    return ready;
  }

  private ready(slot: string): boolean {
    return (this.cooldown.get(slot) ?? 0) <= this.now();
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private async attempt(b: SearchBackend, q: string, n: number, signal?: AbortSignal): Promise<WebSource[]> {
    if (signal?.aborted) throw new SearchAborted("aborted");
    const timeout = AbortSignal.timeout(this.o.timeoutMs ?? SEARCH_TIMEOUT_MS);
    const ctx: BackendContext = {
      fetch: this.o.fetch?.() ?? fetch,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      lang: this.o.lang?.() ?? appLang(),
    };
    try {
      return await b.search(q, n, ctx);
    } catch (e) {
      if (signal?.aborted) throw new SearchAborted("aborted");
      if (timeout.aborted && !(e instanceof SearchFailure)) throw new SearchFailure(b.id, "timeout", `no answer in ${this.o.timeoutMs ?? SEARCH_TIMEOUT_MS} ms`);
      throw e;
    }
  }
}

function sig(s: WebSearchSettings): string {
  return s.provider === "auto" ? "auto" : s.provider === "searxng" ? `searxng|${s.url}` : `${s.provider}|${s.keys[s.provider] ?? ""}`;
}

/** 按网址去重（忽略 #片段和末尾斜杠），保留先出现的 */
export function dedupe(list: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = r.url.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
