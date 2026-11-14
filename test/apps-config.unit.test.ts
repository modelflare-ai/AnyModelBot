/**
 * 自定义连接器的配置（ui/lib/connector-config.js）：粘贴识别（链接、mcpServers JSON、claude mcp add、本地启动命令）、
 * 表单 ⇄ JSON（密钥打码、切回来不丢）、占位符、校验。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error 界面库是纯 JS
import * as cfg from "../ui/lib/connector-config.js";

const { MASK, parsePaste, draftToJson, jsonToDraft, draftProblem, placeholdersIn, isPlaceholder, shellSplit, splitHeaderLine, nameFromUrl, nameFromCommand, emptyDraft } = cfg;

describe("粘贴识别", () => {
  it("一条 MCP 链接：按地址起名，认证方式先定为自动", () => {
    const r = parsePaste("https://mcp.linear.app/mcp");
    expect(r.kind).toBe("url");
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({ name: "linear", transport: "http", url: "https://mcp.linear.app/mcp", auth: "auto", sse: false });
  });

  it("地址里带着像密钥的查询参数：认证方式是查询参数，参数挪出来单独放", () => {
    const d = parsePaste("https://mcp.amap.com/mcp?key=abc123").drafts[0];
    expect(d.auth).toBe("query");
    expect(d.query).toEqual([["key", "abc123"]]);
    expect(d.url).toBe("https://mcp.amap.com/mcp");
  });

  it("路径里有一长串像密钥的东西：专属链接", () => {
    expect(parsePaste("https://mcp-gw.dingtalk.com/server/a1B2c3D4e5F6g7H8i9J0k1L2").drafts[0].auth).toBe("dedicatedUrl");
  });

  it("以 /sse 结尾的地址记成 SSE（主程序会先试它）", () => {
    expect(parsePaste("https://mcp.example.com/sse").drafts[0].sse).toBe(true);
  });

  it("mcpServers JSON：带请求头的是请求头，带 query 的是查询参数，带 auth.oauth 的是授权登录", () => {
    const r = parsePaste(JSON.stringify({ mcpServers: { a: { url: "https://a.example.com/mcp", headers: { Authorization: "Bearer k" } }, b: { url: "https://b.example.com/mcp", query: { apiKey: "v" } }, c: { url: "https://c.example.com/mcp", auth: { method: "oauth", oauth: { clientId: "id", pkce: false, scopes: ["offline_access"] } } } } }));
    expect(r.kind).toBe("json");
    expect(r.drafts.map((d: any) => [d.name, d.auth])).toEqual([["a", "headers"], ["b", "query"], ["c", "oauth"]]);
    expect(r.drafts[0].headers).toEqual([["Authorization", "Bearer k"]]);
    expect(r.drafts[2].oauth).toEqual({ clientId: "id", clientSecret: "", scopes: ["offline_access"], pkce: false });
  });

  it("也接受 VS Code 的 servers、单个服务对象、一层「名称 → 配置」的映射，和只贴了一段 \"name\": {…}", () => {
    expect(parsePaste('{"servers":{"x":{"type":"http","url":"https://x.example.com/mcp"}}}').drafts[0].name).toBe("x");
    expect(parsePaste('{"url":"https://solo.example.com/mcp"}').drafts[0]).toMatchObject({ name: "example", auth: "auto" });
    expect(parsePaste('{"one":{"command":"npx","args":["-y","pkg-one"]},"two":{"url":"https://two.example.com/mcp"}}').drafts.map((d: any) => d.transport)).toEqual(["stdio", "http"]);
    expect(parsePaste('"docs": { "url": "https://docs.example.com/mcp" },').drafts[0].name).toBe("docs");
  });

  it("SSE 的配置（type: sse）能识别，记成 SSE", () => {
    expect(parsePaste('{"mcpServers":{"old":{"type":"sse","url":"https://old.example.com/events"}}}').drafts[0]).toMatchObject({ transport: "http", sse: true });
  });

  it("claude mcp add：远程（带 --header）和本地（-- 后面是命令，-e 是环境变量）", () => {
    const remote = parsePaste('claude mcp add --transport http notion https://mcp.notion.com/mcp --header "Authorization: Bearer $TOKEN"');
    expect(remote.kind).toBe("claude");
    expect(remote.drafts[0]).toMatchObject({ name: "notion", transport: "http", url: "https://mcp.notion.com/mcp", auth: "headers", headers: [["Authorization", "Bearer $TOKEN"]] });
    const local = parsePaste("claude mcp add -e API_KEY=secret airtable -- npx -y airtable-mcp-server").drafts[0];
    expect(local).toMatchObject({ name: "airtable", transport: "stdio", command: "npx", args: ["-y", "airtable-mcp-server"], env: [["API_KEY", "secret"]] });
  });

  it("claude mcp add-json", () => {
    const d = parsePaste(`claude mcp add-json weather '{"type":"http","url":"https://weather.example.com/mcp","headers":{"X-Key":"k"}}'`).drafts[0];
    expect(d).toMatchObject({ name: "weather", auth: "headers", headers: [["X-Key", "k"]] });
  });

  it("本地启动命令：npx、uvx、bunx、pnpm dlx、yarn dlx、docker run；命令前的 KEY=value 记入环境变量", () => {
    expect(parsePaste("YUQUE_TOKEN=abc npx -y yuque-mcp").drafts[0]).toMatchObject({ transport: "stdio", command: "npx", args: ["-y", "yuque-mcp"], env: [["YUQUE_TOKEN", "abc"]], name: "yuque-mcp" });
    expect(parsePaste("uvx mcp-server-time --local-timezone Asia/Shanghai").drafts[0]).toMatchObject({ command: "uvx", name: "mcp-server-time" });
    expect(parsePaste("bunx @scope/tool").drafts[0].name).toBe("tool");
    expect(parsePaste("pnpm dlx some-mcp").drafts[0].command).toBe("pnpm");
    expect(parsePaste("yarn dlx some-mcp").drafts[0].args).toEqual(["dlx", "some-mcp"]);
    expect(parsePaste("docker run -i --rm -e KEY=v ghcr.io/acme/server:1.2").drafts[0]).toMatchObject({ command: "docker", name: "server" });
  });

  it("认不出来的不乱猜：普通的话、不是启动服务的命令、写坏的 JSON 分开报", () => {
    expect(parsePaste("帮我连一下飞书").error).toBe("unrecognized");
    expect(parsePaste("pnpm install").error).toBe("unrecognized");
    expect(parsePaste("docker ps").error).toBe("unrecognized");
    expect(parsePaste('{"mcpServers": {').error).toBe("json");
    expect(parsePaste("   ").error).toBe("empty");
  });
});

describe("占位符", () => {
  it("$TOKEN、${VAR}、YOUR_API_KEY、<token>、xxx 都算；真实的值、掩码不算", () => {
    for (const v of ["$TOKEN", "${DASHSCOPE_API_KEY}", "YOUR_API_KEY", "Bearer YOUR_API_KEY", "<your-token>", "xxxx", "your-api-key", "{{token}}"]) expect(isPlaceholder(v), v).toBe(true);
    for (const v of ["sk-live-abcdef123456", "Bearer ghp_abcdefghijklmnop", MASK, "", "production"]) expect(isPlaceholder(v), v).toBe(false);
  });

  it("有没填的占位符时不能添加，并说得出是哪个字段", () => {
    const d = parsePaste('{"mcpServers":{"bailian":{"url":"https://dashscope.example.com/mcp","headers":{"Authorization":"Bearer ${DASHSCOPE_API_KEY}"}}}}').drafts[0];
    expect(placeholdersIn(d)).toEqual(["headers.Authorization"]);
    expect(draftProblem(d)).toBe("placeholder");
    d.headers = [["Authorization", "Bearer sk-real-123456"]];
    expect(draftProblem(d)).toBe("");
  });
});

describe("表单 ⇄ JSON", () => {
  const form = () => ({ ...emptyDraft(), name: "docs", url: "https://docs.example.com/mcp", auth: "headers", headers: [["Authorization", "Bearer real-token"], ["X-Org", "acme"]] });

  it("JSON 里密钥打码，写成别的工具也认的 mcpServers", () => {
    const json = JSON.parse(draftToJson(form()));
    expect(json).toEqual({ mcpServers: { docs: { url: "https://docs.example.com/mcp", headers: { Authorization: MASK, "X-Org": MASK } } } });
    expect(JSON.parse(draftToJson(form(), { mask: false })).mcpServers.docs.headers.Authorization).toBe("Bearer real-token");
  });

  it("切回表单：还是掩码的换回原值，JSON 里写了新值的用新值，字段不丢", () => {
    const prev = form();
    const text = draftToJson(prev).replace(`"X-Org": "${MASK}"`, '"X-Org": "other"');
    const back = jsonToDraft(text, prev).draft;
    expect(back.headers).toEqual([["Authorization", "Bearer real-token"], ["X-Org", "other"]]);
    expect(back).toMatchObject({ name: "docs", url: prev.url, auth: "headers" });
  });

  it("专属链接整段打码；查询参数单独写在 query 里；授权登录的字段放在 auth 里", () => {
    const dedicated = { ...emptyDraft(), name: "ding", url: "https://gw.example.com/u/secret-path", auth: "dedicatedUrl" };
    const j1 = JSON.parse(draftToJson(dedicated));
    expect(j1.mcpServers.ding).toEqual({ url: MASK, auth: { method: "dedicatedUrl" } });
    expect(jsonToDraft(draftToJson(dedicated), dedicated).draft).toMatchObject({ url: dedicated.url, auth: "dedicatedUrl" });

    const query = { ...emptyDraft(), name: "amap", url: "https://mcp.amap.com/mcp", auth: "query", query: [["key", "real"]] };
    expect(JSON.parse(draftToJson(query)).mcpServers.amap).toEqual({ url: "https://mcp.amap.com/mcp", query: { key: MASK } });
    expect(jsonToDraft(draftToJson(query), query).draft.query).toEqual([["key", "real"]]);

    const oauth = { ...emptyDraft(), name: "svc", url: "https://svc.example.com/mcp", auth: "oauth", oauth: { clientId: "cid", clientSecret: "shh", scopes: ["a", "b"], pkce: false } };
    expect(JSON.parse(draftToJson(oauth)).mcpServers.svc.auth).toEqual({ method: "oauth", oauth: { pkce: false, clientId: "cid", clientSecret: MASK, scopes: ["a", "b"] } });
    expect(jsonToDraft(draftToJson(oauth), oauth).draft.oauth).toEqual(oauth.oauth);
  });

  it("本地命令：环境变量的值打码，切回来还在", () => {
    const local = { ...emptyDraft("stdio"), name: "time", command: "uvx", args: ["mcp-server-time"], env: [["TZ_KEY", "v"]] };
    expect(JSON.parse(draftToJson(local)).mcpServers.time).toEqual({ command: "uvx", args: ["mcp-server-time"], env: { TZ_KEY: MASK } });
    expect(jsonToDraft(draftToJson(local), local).draft).toMatchObject({ transport: "stdio", command: "uvx", args: ["mcp-server-time"], env: [["TZ_KEY", "v"]] });
  });

  it("JSON 写错了说得出是哪一类错，不清空表单（返回 error，没有 draft）", () => {
    expect(jsonToDraft("{oops", form())).toEqual({ error: "json" });
    expect(jsonToDraft('{"mcpServers":{}}', form())).toEqual({ error: "missing" });
    expect(jsonToDraft('{"mcpServers":{"a":{"args":["x"]}}}', form())).toEqual({ error: "missing" });
    expect(jsonToDraft('{"mcpServers":{"a":{"url":"https://a.example.com","headers":["x"]}}}', form())).toEqual({ error: "headers" });
    expect(jsonToDraft('{"mcpServers":{"a":{"url":"https://a.example.com","query":{"k":{"x":1}}}}}', form())).toEqual({ error: "query" });
    expect(jsonToDraft('{"mcpServers":{"a":{"command":"npx","env":[1]}}}', form())).toEqual({ error: "env" });
    expect(jsonToDraft('{"mcpServers":{"a":{"url":"https://a.example.com","auth":{"method":"magic"}}}}', form())).toEqual({ error: "auth" });
  });
});

describe("校验和小工具", () => {
  it("远程要完整的 http(s) 地址；选了请求头、查询参数要有完整的键值；本地要有命令", () => {
    expect(draftProblem({ ...emptyDraft(), url: "mcp.example.com" })).toBe("url");
    expect(draftProblem({ ...emptyDraft(), url: "ftp://x" })).toBe("url");
    expect(draftProblem({ ...emptyDraft(), url: "https://x.example.com", auth: "headers" })).toBe("headersEmpty");
    expect(draftProblem({ ...emptyDraft(), url: "https://x.example.com", auth: "headers", headers: [["Authorization", ""]] })).toBe("headers");
    expect(draftProblem({ ...emptyDraft(), url: "https://x.example.com", auth: "query", query: [["", "v"]] })).toBe("query");
    expect(draftProblem({ ...emptyDraft("stdio") })).toBe("command");
    expect(draftProblem({ ...emptyDraft("stdio"), command: "npx", env: [["K", ""]] })).toBe("env");
    expect(draftProblem({ ...emptyDraft(), url: "https://x.example.com" })).toBe("");
  });

  it("命令行拆词认引号和续行；「Authorization: Bearer …」整行拆成键和值", () => {
    expect(shellSplit(`npx -y "@scope/pkg" --name 'a b' \\\n  --flag`)).toEqual(["npx", "-y", "@scope/pkg", "--name", "a b", "--flag"]);
    expect(splitHeaderLine("Authorization: Bearer abc")).toEqual(["Authorization", "Bearer abc"]);
    expect(splitHeaderLine("Authorization")).toBeNull();
  });

  it("自动起名：地址去掉 mcp. / api. 这些前缀，命令取软件包名", () => {
    expect(nameFromUrl("https://api.githubcopilot.com/mcp/")).toBe("githubcopilot");
    expect(nameFromUrl("https://docs.qq.com/openapi/mcp")).toBe("qq");
    expect(nameFromUrl("http://127.0.0.1:8080/mcp")).toBe("127.0.0.1-8080");
    expect(nameFromCommand("npx", ["-y", "@modelcontextprotocol/server-filesystem@1.2.0", "/tmp"])).toBe("server-filesystem");
    expect(nameFromCommand("uvx", ["mcp-server-time"])).toBe("mcp-server-time");
  });
});

describe("JSON 与表单切换不被必填项拦截", () => {
  it("空白和缺失 URL 的合法 JSON 带回已识别字段，提交仍校验", () => {
    const previous = emptyDraft();
    const partial = jsonToDraft('{"mcpServers":{"notes":{"url":"","headers":{"X-Key":"abc"},"query":{"region":"cn"},"auth":{"method":"headers"}}}}', previous, { partial: true });
    expect(partial.draft).toMatchObject({ name: "notes", url: "", headers: [["X-Key", "abc"]], query: [["region", "cn"]], auth: "headers" });
    expect(draftProblem(partial.draft)).toBe("url");
    expect(jsonToDraft('{}', previous, { partial: true }).draft).toMatchObject({ name: "", url: "" });
  });
  it("格式错误不改动原表单；掩码切换仍保留原密钥", () => {
    const previous = { ...emptyDraft(), name: "notes", url: "https://example.com", auth: "headers", headers: [["X-Key", "secret-value"]] };
    expect(jsonToDraft('{"mcpServers":', previous, { partial: true })).toEqual({ error: "json" });
    expect(previous.headers).toEqual([["X-Key", "secret-value"]]);
    expect(jsonToDraft(draftToJson(previous), previous, { partial: true }).draft.headers).toEqual(previous.headers);
  });
});
