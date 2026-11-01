/** 联网搜索（src/agent/search.ts）：免费后端的解析（真实页面裁剪的样本，不联网）、回退与冷却、带 Key 接口的请求。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentManager } from "../src/agent/manager.js";
import { locateDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { Store } from "../src/store/db.js";
import {
  SearchAborted,
  SearchFailure,
  SearchService,
  bing,
  bingTarget,
  ddgTarget,
  dedupe,
  duckduckgo,
  exaMcp,
  exaMcpResults,
  htmlText,
  keyedBackend,
  keyedRequest,
  normalizeSearxUrl,
  normalizeWebSearch,
  parseBing,
  parseDdg,
  parseExaText,
  parseRpcReply,
  queryTerms,
  relevant,
  type BackendContext,
  type SearchBackend,
  type WebSearchSettings,
  type WebSource,
} from "../src/agent/search.js";

const fixture = (f: string) => fs.readFileSync(path.join(__dirname, "fixtures", "web-search", f), "utf8");

/** 假 fetch：按地址回页面，记下每次请求 */
function fakeFetch(route: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return route(url, init);
  }) as typeof fetch;
  return { fn, calls };
}
const ctxOf = (f: typeof fetch, lang: "zh-CN" | "en" = "en"): BackendContext => ({ fetch: f, signal: AbortSignal.timeout(5000), lang });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

describe("Exa 公开 MCP", () => {
  it("SSE 回复：每条的标题、网址、发布日期、摘要；正文里的 --- 不会把一条切成两条", () => {
    const got = exaMcpResults(parseRpcReply(fixture("exa-mcp.sse")));
    expect(got.map((r) => r.url)).toEqual([
      "https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V22.md",
      "https://nodejs.org/en/blog/announcements/v22-release-announce",
      "https://nodejs.org/en/blog/release/v22.0.0/",
    ]);
    expect(got[1].title).toBe("Node.js 22 is now available!");
    expect(got[1].snippet).toMatch(/^Node\.js — Node\.js 22 is now available! /);
    // 正文里的分隔线和后面的段落仍属于这一条
    expect(got[1].snippet).not.toContain("---");
    // "Published: N/A" 不算日期；午夜的 ISO 时间只留日期
    expect(got[0].publishedAt).toBeUndefined();
    expect(got[2].publishedAt).toBe("2024-04-24");
    // 摘要压成一行、去掉 Markdown 标题符号、有长度上限
    expect(got[0].snippet!.startsWith("Node.js 22 ChangeLog")).toBe(true);
    for (const r of got) expect(r.snippet!.length).toBeLessThanOrEqual(300);
  });

  it("JSON 回复、旧格式（Published Date / Text）和 JSON 文本都认", () => {
    const text = "Title: A\nURL: https://a.example/x\nPublished Date: 2025-01-02\nAuthor: me\nText: first line\nsecond line\n\nTitle: B\nURL: https://b.example/\nText: b";
    const reply = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
    expect(exaMcpResults(parseRpcReply(reply))).toEqual([
      { url: "https://a.example/x", title: "A", snippet: "first line second line", publishedAt: "2025-01-02" },
      { url: "https://b.example/", title: "B", snippet: "b" },
    ]);
    expect(parseExaText(JSON.stringify({ results: [{ title: "J", url: "https://j.example/", publishedDate: "2025-02-03T00:00:00.000Z", highlights: ["h1", "h2"] }] }))).toEqual([
      { url: "https://j.example/", title: "J", snippet: "h1 h2", publishedAt: "2025-02-03" },
    ]);
  });

  it("SSE 里多个事件、CRLF 换行：取 id 对得上的那条", () => {
    const body = 'event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: T\\nURL: https://t.example/"}]}}\r\n\r\n';
    expect(exaMcpResults(parseRpcReply(body))).toEqual([{ url: "https://t.example/", title: "T" }]);
  });

  it("没有结果是空结果；限流、出错、看不懂都抛错（换下一个后端）", () => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });
    expect(exaMcpResults(reply({ content: [{ type: "text", text: "No search results found. Please try a different query." }] }))).toEqual([]);
    const fail = (msg: unknown) => {
      try {
        exaMcpResults(msg);
      } catch (e) {
        return e as SearchFailure;
      }
      throw new Error("expected a failure");
    };
    // 真实的限流回复（200 + _meta 标记 + 一段说明，没有结果）
    expect(fail(parseRpcReply(fixture("exa-mcp-rate-limited.sse")))).toMatchObject({ backend: "exa-mcp", kind: "rate" });
    expect(fail(reply({ content: [{ type: "text", text: "You've hit Exa's free MCP rate limit." }] })).kind).toBe("rate");
    expect(fail(reply({ isError: true, content: [{ type: "text", text: "Invalid arguments" }] })).kind).toBe("format");
    expect(fail({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } }).kind).toBe("format");
    expect(fail(reply({ content: [{ type: "text", text: "Something else entirely" }] })).kind).toBe("format");
  });

  it("请求：tools/call web_search_exa，同时接受 JSON 和 SSE；HTTP 出错按状态码分类", async () => {
    const f = fakeFetch(() => new Response(fixture("exa-mcp.sse"), { headers: { "content-type": "text/event-stream" } }));
    const got = await exaMcp.search("node 22", 3, ctxOf(f.fn));
    expect(got).toHaveLength(3);
    const { url, init } = f.calls[0];
    expect(url).toBe("https://mcp.exa.ai/mcp");
    expect((init.headers as Record<string, string>).accept).toBe("application/json, text/event-stream");
    expect(JSON.parse(String(init.body))).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "web_search_exa", arguments: { query: "node 22", numResults: 3 } } });
    const limited = fakeFetch(() => new Response("slow down", { status: 429 }));
    await expect(exaMcp.search("q", 3, ctxOf(limited.fn))).rejects.toMatchObject({ kind: "rate", status: 429 });
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    });
    await expect(exaMcp.search("q", 3, ctxOf(down.fn))).rejects.toMatchObject({ kind: "network", message: "fetch failed (ECONNRESET)" });
  });
});

describe("必应网页", () => {
  it("自然结果：h2 > a 的标题（命中词的 <strong> 不留空格）、跳转链接还原、摘要；广告不要", () => {
    const page = parseBing(fixture("bing.html"));
    expect(page.page).toBe(true);
    expect(page.results.map((r) => r.url)).toEqual(["https://www.weather.com.cn/weather/101010100.shtml", "https://www.nmc.cn/publish/forecast/ABJ/beijing.html", "https://www.msn.com/zh-cn/weather/forecast/in-%E5%8C%97%E4%BA%AC"]);
    expect(page.results[0].title).toBe("北京天气预报,北京7天天气预报,北京15天天气预报,北京天气查询");
    expect(page.results[1].snippet).toMatch(/^当前位置： 首页 北京市/);
    expect(page.results.some((r) => /aclick|Ad title/.test(`${r.url} ${r.title}`))).toBe(false);
  });

  it("日期（span.news_dt）拿出来作发布日期，摘要里不留日期和分隔点", () => {
    const block = `<ol id="b_results"><li class="b_algo"><h2><a href="https://example.org/a">Hello <strong>World</strong></a></h2><div class="b_caption"><p class="b_lineclamp2"><span class="news_dt">Oct 20, 2023</span>&nbsp;&#0183;&#32;Body &amp; more …</p></div></li></ol>`;
    expect(parseBing(block).results).toEqual([{ url: "https://example.org/a", title: "Hello World", snippet: "Body & more …", publishedAt: "Oct 20, 2023" }]);
    expect(parseBing('<ol id="b_results"><li class="b_no"><h1>There are no results</h1></li></ol>')).toMatchObject({ results: [], noResults: true });
  });

  it("跳转链接 bing.com/ck/a?…&u=a1<base64url>", () => {
    const enc = Buffer.from("https://例子.example/路径?q=1&x=_-").toString("base64url");
    expect(bingTarget(`https://www.bing.com/ck/a?!&&p=abc&u=a1${enc}&ntb=1`)).toBe("https://例子.example/路径?q=1&x=_-");
    expect(bingTarget("https://www.bing.com/ck/a?!&&p=abc&ntb=1")).toBeUndefined();
    expect(bingTarget("https://plain.example/x")).toBe("https://plain.example/x");
    expect(bingTarget("javascript:void(0)")).toBeUndefined();
  });

  it("给出与问题无关的一页（必应对脚本样的请求这么干）：当出错，交给下一个后端", async () => {
    const unrelated = parseBing(fixture("bing-unrelated.html")).results;
    expect(unrelated.length).toBe(3);
    expect(relevant("node.js 22 release notes", unrelated)).toBe(false);
    expect(relevant("北京天气", parseBing(fixture("bing.html")).results)).toBe(true);
    const f = fakeFetch(() => html(fixture("bing-unrelated.html")));
    await expect(bing.search("node.js 22 release notes", 5, ctxOf(f.fn))).rejects.toMatchObject({ backend: "bing", kind: "unrelated" });
  });

  it("切题词：拉丁文字取 ≥3 个字符的实词，中日韩取相邻两字", () => {
    expect(queryTerms("What is the Node.js 22 release?")).toEqual(["node.js", "release"]);
    expect(queryTerms("北京今天天气")).toEqual(["北京", "京今", "今天", "天天", "天气"]);
    expect(queryTerms("Rust 教程")).toEqual(["rust", "教程"]);
    // 查询里没有可用的词时不判断
    expect(relevant("22 ?", [{ url: "https://x.example/" }])).toBe(true);
  });

  it("中文界面先试 cn.bing.com，在境外被跳回首页时再试 www.bing.com", async () => {
    const f = fakeFetch((url) => (url.startsWith("https://cn.bing.com/") ? html("<html><body>homepage</body></html>") : html(fixture("bing.html"))));
    const got = await bing.search("北京天气", 2, ctxOf(f.fn, "zh-CN"));
    expect(got).toHaveLength(2);
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual(["cn.bing.com", "www.bing.com"]);
    expect(f.calls[1].url).toBe(`https://www.bing.com/search?q=${encodeURIComponent("北京天气")}`);
    const h = f.calls[1].init.headers as Record<string, string>;
    expect(h["user-agent"]).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
    expect(h["accept-language"]).toMatch(/^zh-CN/);
    // 英文界面只用 www.bing.com；都不是结果页就出错
    const g = fakeFetch(() => html("<html><body>captcha</body></html>"));
    await expect(bing.search("x", 2, ctxOf(g.fn))).rejects.toMatchObject({ kind: "blocked" });
    expect(g.calls).toHaveLength(1);
  });
});

describe("DuckDuckGo 网页", () => {
  it("结果：a.result__a 的标题、uddg 跳转还原、摘要；广告不要", () => {
    const page = parseDdg(fixture("ddg.html"));
    expect(page.challenge).toBe(false);
    expect(page.results).toEqual([
      expect.objectContaining({ url: "https://nodejs.org/en/blog/announcements/v22-release-announce", title: "Node.js 22 is now available!" }),
      expect.objectContaining({ url: "https://nodejs.org/en/blog/release/v22.22.0", title: "Node.js — Node.js 22.22.0 (LTS)" }),
      expect.objectContaining({ url: "https://versionlog.com/nodejs/22/", title: "Node.js 22 (LTS) - What's New, Support Lifecycle & EOL" }),
    ]);
    expect(page.results[0].snippet).toMatch(/Try out the new Node\.js 22 release! We're always happy/);
  });

  it("跳转链接 //duckduckgo.com/l/?uddg=…；广告跳转（y.js）和站内链接不要", () => {
    expect(ddgTarget("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fp%3Fx%3D1&amp;rut=abc")).toBe("https://a.example/p?x=1");
    expect(ddgTarget("//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_domain%3Dx")).toBeUndefined();
    expect(ddgTarget("https://direct.example/")).toBe("https://direct.example/");
    expect(ddgTarget("/html/?q=next")).toBeUndefined();
  });

  it("人机验证页（202，或 200 却解析不出结果）是出错，不是没有结果；明确没有结果才是空", async () => {
    expect(parseDdg(fixture("ddg-challenge.html"))).toMatchObject({ results: [], challenge: true });
    const challenge202 = fakeFetch(() => html(fixture("ddg-challenge.html"), 202));
    await expect(duckduckgo.search("q", 5, ctxOf(challenge202.fn))).rejects.toMatchObject({ backend: "duckduckgo", kind: "blocked", status: 202 });
    const challenge200 = fakeFetch(() => html(fixture("ddg-challenge.html")));
    await expect(duckduckgo.search("q", 5, ctxOf(challenge200.fn))).rejects.toMatchObject({ kind: "blocked" });
    const unknown = fakeFetch(() => html("<html><body>something new</body></html>"));
    await expect(duckduckgo.search("q", 5, ctxOf(unknown.fn))).rejects.toMatchObject({ kind: "blocked" });
    const none = fakeFetch(() => html('<div class="serp__results"><div class="no-results">No results.</div></div>'));
    expect(await duckduckgo.search("q", 5, ctxOf(none.fn))).toEqual([]);
    const ok = fakeFetch(() => html(fixture("ddg.html")));
    expect(await duckduckgo.search("node 22", 2, ctxOf(ok.fn))).toHaveLength(2);
    expect(ok.calls[0].url).toBe("https://html.duckduckgo.com/html/?q=node%2022");
  });
});

it("文字工具：实体、标签、去重", () => {
  expect(htmlText("<b>A</b>&nbsp;&amp;&#x27;b&#39;<br>c&unknown;")).toBe("A &'b' c&unknown;");
  const r = (url: string): WebSource => ({ url });
  expect(dedupe([r("https://a.example/x"), r("https://A.example/x/"), r("https://a.example/x#top"), r("https://b.example/")]).map((x) => x.url)).toEqual(["https://a.example/x", "https://b.example/"]);
});

/** 测试用后端：每次调用按脚本给结果或抛错，记下调用顺序 */
function scripted(id: string, script: Array<WebSource[] | FailKindOrError | "hang">) {
  const calls: string[] = [];
  const b: SearchBackend & { calls: string[] } = {
    id,
    calls,
    async search(query, _count, ctx) {
      calls.push(query);
      const step = script.length > 1 ? script.shift()! : script[0];
      if (step === "hang") return new Promise<WebSource[]>((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason)));
      if (Array.isArray(step)) return step;
      throw typeof step === "string" ? new SearchFailure(id, step, `${id} ${step}`) : step;
    },
  };
  return b;
}
type FailKindOrError = "network" | "rate" | "blocked" | "unrelated" | Error;
const hits = (...urls: string[]): WebSource[] => urls.map((u) => ({ url: `https://${u}/`, title: u }));

describe("回退与冷却", () => {
  const settings = (s: Partial<WebSearchSettings> = {}) => () => normalizeWebSearch(s);
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("按顺序试：出错的跳过并冷却，成功的下一次排最前；冷却过了再回来", async () => {
    const c = clock();
    const exa = scripted("exa-mcp", ["rate", hits("e1")]);
    const bg = scripted("bing", [hits("b1", "b2")]);
    const ddg = scripted("duckduckgo", [hits("d1")]);
    const svc = new SearchService({ settings: settings(), free: [exa, bg, ddg], now: c.now, cooldownMs: 600_000 });
    expect(await svc.search("q1")).toEqual({ backend: "bing", sources: hits("b1", "b2") });
    // exa 在冷却，bing 上次成功：直接问 bing
    expect(await svc.search("q2")).toMatchObject({ backend: "bing" });
    expect(exa.calls).toEqual(["q1"]);
    expect(bg.calls).toEqual(["q1", "q2"]);
    // 冷却结束：上次成功的 bing 仍排第一
    c.advance(600_001);
    await svc.search("q3");
    expect(bg.calls).toEqual(["q1", "q2", "q3"]);
    expect(exa.calls).toEqual(["q1"]);
    expect(ddg.calls).toEqual([]);
  });

  it("没有结果不算出错：接着问下一个；都没有结果时返回空", async () => {
    const exa = scripted("exa-mcp", [[]]);
    const bg = scripted("bing", [hits("b1")]);
    const svc = new SearchService({ settings: settings(), free: [exa, bg] });
    expect(await svc.search("q")).toMatchObject({ backend: "bing", sources: hits("b1") });
    // exa 没有被冷却
    expect(await svc.search("q2")).toMatchObject({ backend: "bing" });
    expect(exa.calls).toEqual(["q"]);
    const empty = new SearchService({ settings: settings(), free: [scripted("a", [[]]), scripted("b", ["network"])] });
    expect(await empty.search("q")).toEqual({ backend: "a", sources: [] });
  });

  it("全部出错时报错；全都在冷却时照样都试（冷却先结束的先试）", async () => {
    const c = clock();
    const a = scripted("a", ["network", hits("a1")]);
    const b = scripted("b", ["blocked", "blocked"]);
    const svc = new SearchService({ settings: settings(), free: [a, b], now: c.now, cooldownMs: 1000 });
    await expect(svc.search("q")).rejects.toMatchObject({ backend: "all", message: "a: network; b: blocked" });
    c.advance(10);
    expect(await svc.search("q2")).toMatchObject({ backend: "a", sources: hits("a1") });
    expect(b.calls).toEqual(["q"]);
  });

  it("每个后端有超时；调用方取消时立即停下，不算后端出错", async () => {
    const slow = scripted("slow", ["hang"]);
    const fast = scripted("fast", [hits("f1")]);
    const svc = new SearchService({ settings: settings(), free: [slow, fast], timeoutMs: 50 });
    expect(await svc.search("q")).toMatchObject({ backend: "fast" });
    const ac = new AbortController();
    const hang = scripted("hang", ["hang"]);
    const other = scripted("other", [hits("o1")]);
    const svc2 = new SearchService({ settings: settings(), free: [hang, other], timeoutMs: 10_000 });
    const p = svc2.search("q", 8, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toBeInstanceOf(SearchAborted);
    expect(other.calls).toEqual([]);
    // 没有冷却：下一次还是先问它
    const p2 = svc2.search("q2", 8, AbortSignal.timeout(20));
    await expect(p2).rejects.toBeInstanceOf(SearchAborted);
    expect(hang.calls).toEqual(["q", "q2"]);
  });

  it("去重并截到 maxResults", async () => {
    const svc = new SearchService({ settings: settings(), free: [scripted("a", [[...hits("x", "y"), { url: "https://x/" }, ...hits("z", "w")]])] });
    expect((await svc.search("q", 3)).sources.map((s) => s.url)).toEqual(["https://x/", "https://y/", "https://z/"]);
  });

  it("填了 Key 先用它；出错退回免费的并冷却；Key 被拒时设置页提示，换了 Key 就清掉", async () => {
    let cfg = normalizeWebSearch({ provider: "tavily", keys: { tavily: "tvly-secret-1234" } });
    const seen: string[] = [];
    let tavily: () => Response = () => Response.json({ results: [{ title: "T", url: "https://t.example/", content: "c" }] });
    const f = fakeFetch((url) => (seen.push(new URL(url).host), tavily()));
    const free = scripted("duckduckgo", [hits("d1")]);
    const svc = new SearchService({ settings: () => cfg, fetch: () => f.fn, free: [free] });
    expect(await svc.search("q")).toEqual({ backend: "tavily", sources: [{ url: "https://t.example/", title: "T", snippet: "c" }] });
    expect(svc.view()).toEqual({ provider: "tavily", keyTail: "1234", url: "", keyRejected: false });
    tavily = () => new Response('{"detail":{"error":"Unauthorized"}}', { status: 401 });
    expect(await svc.search("q2")).toMatchObject({ backend: "duckduckgo" });
    expect(svc.view().keyRejected).toBe(true);
    // 冷却中不再先问它
    await svc.search("q3");
    expect(seen).toEqual(["api.tavily.com", "api.tavily.com"]);
    // 换了 Key：清掉提示和冷却，马上再试
    cfg = normalizeWebSearch({ provider: "tavily", keys: { tavily: "tvly-other-5678" } });
    tavily = () => Response.json({ results: [] });
    expect(svc.view()).toMatchObject({ keyTail: "5678", keyRejected: false });
    expect(await svc.search("q4")).toMatchObject({ backend: "duckduckgo" });
    expect(seen).toHaveLength(3);
  });

  it("选了接口但没填 Key：直接用免费的", async () => {
    const free = scripted("duckduckgo", [hits("d1")]);
    const f = fakeFetch(() => {
      throw new Error("should not be called");
    });
    const svc = new SearchService({ settings: settings({ provider: "exa" }), fetch: () => f.fn, free: [free] });
    expect(await svc.search("q")).toMatchObject({ backend: "duckduckgo" });
    expect(f.calls).toEqual([]);
  });
});

describe("带 Key 的接口", () => {
  const cfg = (provider: string, key = "k-123456", url = "") => normalizeWebSearch({ provider, keys: { [provider]: key }, url });
  const body = (r: { init: RequestInit }) => JSON.parse(String(r.init.body));
  const headers = (r: { init: RequestInit }) => r.init.headers as Record<string, string>;

  it("Tavily：Bearer，query + max_results（≤20）；results[].title / url / content / published_date", () => {
    const r = keyedRequest(cfg("tavily"), "q", 30)!;
    expect(r.url).toBe("https://api.tavily.com/search");
    expect(headers(r).authorization).toBe("Bearer k-123456");
    expect(body(r)).toEqual({ query: "q", max_results: 20 });
    expect(r.parse({ results: [{ title: "A", url: "https://a/", content: "x", published_date: "2025-01-01" }, { title: "bad", url: "ftp://x" }] })).toEqual([{ url: "https://a/", title: "A", snippet: "x", publishedAt: "2025-01-01" }]);
  });

  it("Exa：x-api-key，numResults，contents.highlights；results[].highlights / publishedDate", () => {
    const r = keyedRequest(cfg("exa"), "q", 8)!;
    expect(r.url).toBe("https://api.exa.ai/search");
    expect(headers(r)["x-api-key"]).toBe("k-123456");
    expect(body(r)).toEqual({ query: "q", numResults: 8, type: "auto", contents: { highlights: { maxCharacters: 300 } } });
    expect(r.parse({ results: [{ title: "E", url: "https://e/", publishedDate: "2025-03-04T00:00:00.000Z", highlights: ["one", "two"] }] })).toEqual([{ url: "https://e/", title: "E", snippet: "one two", publishedAt: "2025-03-04" }]);
  });

  it("博查：Bearer，query + count + summary；data.webPages.value[].name / url / summary|snippet / datePublished", () => {
    const r = keyedRequest(cfg("bocha"), "天气", 8)!;
    expect(r.url).toBe("https://api.bochaai.com/v1/web-search");
    expect(headers(r).authorization).toBe("Bearer k-123456");
    expect(body(r)).toEqual({ query: "天气", count: 8, summary: true });
    const value = [{ name: "B", url: "https://b/", snippet: "s", summary: "long", datePublished: "2025-05-06T08:00:00+08:00" }, { name: "C", url: "https://c/", snippet: "s2" }];
    expect(r.parse({ code: 200, data: { webPages: { value } } })).toEqual([
      { url: "https://b/", title: "B", snippet: "long", publishedAt: "2025-05-06T08:00:00+08:00" },
      { url: "https://c/", title: "C", snippet: "s2" },
    ]);
    expect(() => r.parse({ code: 403, msg: "余额不足" })).toThrow(/403/);
  });

  it("智谱：Bearer，search_query（≤70 字）+ search_engine + search_intent + count；search_result[].title / link / content / publish_date", () => {
    const r = keyedRequest(cfg("zhipu"), "x".repeat(100), 8)!;
    expect(r.url).toBe("https://open.bigmodel.cn/api/paas/v4/web_search");
    expect(headers(r).authorization).toBe("Bearer k-123456");
    expect(body(r)).toEqual({ search_query: "x".repeat(70), search_engine: "search_std", search_intent: false, count: 8 });
    expect(r.parse({ search_result: [{ title: "Z", link: "https://z/", content: "zc", publish_date: "2025-06-07" }] })).toEqual([{ url: "https://z/", title: "Z", snippet: "zc", publishedAt: "2025-06-07" }]);
  });

  it("SearXNG：GET <地址>/search?q=…&format=json，不用 Key；results[].url / title / content / publishedDate", () => {
    const r = keyedRequest(normalizeWebSearch({ provider: "searxng", url: "https://searx.example/sub" }), "a b", 8)!;
    expect(r.url).toBe("https://searx.example/sub/search?q=a%20b&format=json");
    expect(r.init.method).toBeUndefined();
    expect(r.parse({ results: [{ url: "https://s/", title: "S", content: "sc", publishedDate: null }] })).toEqual([{ url: "https://s/", title: "S", snippet: "sc" }]);
    expect(normalizeSearxUrl(" https://searx.example/search/ ")).toBe("https://searx.example");
    expect(normalizeSearxUrl("https://searx.example/sub?x=1#y")).toBe("https://searx.example/sub");
    expect(normalizeSearxUrl("ftp://x")).toBeUndefined();
    expect(normalizeSearxUrl("not a url")).toBeUndefined();
    expect(normalizeSearxUrl("")).toBe("");
  });

  it("没填 Key / 地址、或是自动：没有带 Key 的后端；401/403 是 Key 被拒，SearXNG 的 403 是没开 JSON", async () => {
    expect(keyedRequest(normalizeWebSearch({ provider: "tavily" }), "q", 8)).toBeUndefined();
    expect(keyedRequest(normalizeWebSearch({ provider: "searxng" }), "q", 8)).toBeUndefined();
    expect(keyedRequest(normalizeWebSearch({ provider: "auto", keys: { tavily: "k" } }), "q", 8)).toBeUndefined();
    const forbidden = fakeFetch(() => new Response("Forbidden", { status: 403 }));
    await expect(keyedBackend(cfg("zhipu"))!.search("q", 5, ctxOf(forbidden.fn))).rejects.toMatchObject({ kind: "auth", status: 403 });
    await expect(keyedBackend(normalizeWebSearch({ provider: "searxng", url: "https://s.example" }))!.search("q", 5, ctxOf(forbidden.fn))).rejects.toMatchObject({ kind: "blocked" });
    const notJson = fakeFetch(() => new Response("<html>", { status: 200 }));
    await expect(keyedBackend(cfg("tavily"))!.search("q", 5, ctxOf(notJson.fn))).rejects.toMatchObject({ kind: "format" });
  });

  it("设置：不认识的接口当自动；Key 按接口分开存；空 Key 不存", () => {
    expect(normalizeWebSearch({ provider: "google", keys: { tavily: " t ", exa: "", bogus: "x" }, url: 3 })).toEqual({ provider: "auto", keys: { tavily: "t" }, url: "" });
    expect(normalizeWebSearch(null)).toEqual({ provider: "auto", keys: {}, url: "" });
  });
});

/** 宿主这一侧：bridge 的 /dsh/search 经 AgentManager 交给 SearchService */
async function hostWith(backends: SearchBackend[]) {
  const search = new SearchService({ settings: () => normalizeWebSearch({}), free: backends, timeoutMs: 10_000 });
  const mgr = new AgentManager({ store: new Store(":memory:"), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "amb-search-")), runtimeDir: undefined, upstream: () => ({ baseUrl: "", apiKey: "" }), enabled: false, search });
  (mgr as any).hosts.set("b1", {});
  await mgr.bridge.start();
  return mgr;
}

describe("bridge /dsh/search → 宿主搜索", () => {
  it("已知机器人的查询交给搜索服务，回结果；不认识的机器人、全部出错都只回 unavailable", async () => {
    const backend = scripted("duckduckgo", [hits("a.example", "b.example"), "blocked"]);
    const mgr = await hostWith([backend]);
    const post = (body: unknown) =>
      fetch(`${mgr.bridge.url}/dsh/search`, { method: "POST", headers: { authorization: `Bearer ${mgr.bridge.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    try {
      expect(await post({ botId: "b1", query: " node 22 ", maxResults: 1 })).toEqual({ sources: hits("a.example"), truncated: false });
      expect(backend.calls).toEqual(["node 22"]);
      expect(await post({ botId: "nobody", query: "q" })).toEqual({ error: "unavailable" });
      expect(await post({ botId: "b1", query: "q2" })).toEqual({ error: "unavailable" });
      expect(await post({ botId: "b1", query: "  " })).toEqual({ sources: [], truncated: false });
    } finally {
      await mgr.bridge.stop();
    }
  });
});

describe("amb-web-search 插件", () => {
  const runtime = locateDshRuntime(findAppRoot());

  it.skipIf(!runtime)("注册 amb 搜索提供方：查询经 bridge 由宿主搜索；出错只说暂时不可用、建议 web_fetch；取消一路传到宿主", async () => {
    let sawAbort = false;
    const hang: SearchBackend = {
      id: "hang",
      search: (_q, _n, ctx) =>
        new Promise((_, reject) =>
          ctx.signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(ctx.signal.reason);
          }),
        ),
    };
    let mode: "ok" | "fail" | "hang" = "ok";
    const ok = scripted("ok", [[{ url: "https://a.example/", title: "A", snippet: "s", publishedAt: "2025-01-02" }, { url: "https://b.example/" }]]);
    const mgr = await hostWith([
      { id: "switch", search: (q, n, ctx) => (mode === "ok" ? ok.search(q, n, ctx) : mode === "hang" ? hang.search(q, n, ctx) : Promise.reject(new SearchFailure("switch", "network", "down"))) },
    ]);
    const env = { ...process.env };
    try {
      Object.assign(process.env, { AMB_BRIDGE_URL: mgr.bridge.url, AMB_BRIDGE_TOKEN: mgr.bridge.token, AMB_BOT_ID: "b1" });
      const plugin = await import(path.join(runtime!, "plugins", "amb-web-search.mjs"));
      expect(plugin.inject).toEqual(["web"]);
      const providers: any[] = [];
      plugin.apply({ web: { registerSearchProvider: (p: any) => providers.push(p) } });
      expect(providers.map((p) => p.id)).toEqual(["amb"]);
      const amb = providers[0];
      expect(amb.available()).toBe(true);
      expect(await amb.search({ query: "q", maxResults: 5 }, AbortSignal.timeout(5000))).toEqual({
        sources: [{ url: "https://a.example/", title: "A", snippet: "s", publishedAt: "2025-01-02" }, { url: "https://b.example/" }],
        truncated: false,
      });
      // 搜不了：DSH 的 WebError，给模型的话里没有 DeepSeek、Key、设置页
      mode = "fail";
      const err = await amb.search({ query: "q2", maxResults: 5 }).catch((e: unknown) => e);
      expect(err).toMatchObject({ name: "WebError", code: "WEB_PROVIDER_ERROR" });
      expect(err.message).toBe("Web search is temporarily unavailable. If you know a relevant page, open it directly with web_fetch.");
      expect(err.message).not.toMatch(/deepseek|api key|setting/i);
      // 工具超时 / 回合中止：插件的 fetch 断开，宿主那边的搜索跟着取消
      mode = "hang";
      const ac = new AbortController();
      const p = amb.search({ query: "q3", maxResults: 5 }, ac.signal).catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 100));
      ac.abort();
      expect(await p).toMatchObject({ code: "WEB_ABORTED" });
      await expect.poll(() => sawAbort).toBe(true);
      // bridge 不在了：同样只是暂时不可用
      await mgr.bridge.stop();
      mode = "ok";
      expect(await amb.search({ query: "q4" }).catch((e: unknown) => e)).toMatchObject({ code: "WEB_PROVIDER_ERROR" });
    } finally {
      process.env = env;
      await mgr.bridge.stop();
    }
  });
});
