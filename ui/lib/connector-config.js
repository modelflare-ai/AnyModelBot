// 自定义连接器的配置：粘贴识别、表单 ⇄ JSON、校验。纯函数，没有界面（test/apps-config.unit.test.ts）。
//
// 表单和 JSON 表达的是同一份配置（draft）：
//   { name, transport: "http" | "stdio", url, sse, auth, headers: [[k, v]], query: [[k, v]],
//     oauth: { clientId, clientSecret, scopes: [], pkce }, command, args: [], env: [[k, v]] }
// JSON 是 mcpServers 的写法（url / headers / command / args / env），别的工具能直接用；查询参数可以单独写在 query 里，
// 也可以合并进 url；我们多出来的认证字段放在 auth 里，别的工具不认识可以忽略。
//
// 密钥（请求头的值、查询参数的值、专属链接、环境变量的值、客户端密钥）在 JSON 里显示成 MASK；切回表单时 MASK 换回原值，
// 用户在 JSON 里写了新值就用新值。编辑已保存的连接时界面手里没有原值：保存时 MASK 原样发给后端，后端保留已存的那一份。

export const MASK = "••••••••";
export const AUTH_METHODS = ["auto", "none", "headers", "query", "dedicatedUrl", "oauth"];

/** 还没换成真实值的占位符：$TOKEN、${VAR}、<your-key>、YOUR_API_KEY、xxx… */
export function isPlaceholder(v) {
  const s = String(v ?? "").trim();
  if (!s || s === MASK) return false;
  const bare = s.replace(/^(Bearer|Basic|Token)\s+/i, "");
  return (
    /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(bare) ||
    /^<[^>]+>$/.test(bare) ||
    /^\{\{[^}]+\}\}$/.test(bare) ||
    /^(your|my)[-_ ]?[a-z0-9-_ ]*(key|token|secret|password|id)$/i.test(bare) ||
    /^(YOUR|REPLACE|INSERT|PUT|ENTER|CHANGE)[-_A-Z0-9 ]*(KEY|TOKEN|SECRET|HERE|ME|VALUE)[-_A-Z0-9 ]*$/.test(bare) ||
    /^x{3,}$/i.test(bare) ||
    /^\*{3,}$/.test(bare) ||
    /^\.{3,}$|^…$/.test(bare)
  );
}

export function emptyDraft(transport = "http") {
  return { name: "", transport, url: "", sse: false, auth: transport === "http" ? "auto" : "none", headers: [], query: [], oauth: { clientId: "", clientSecret: "", scopes: [], pkce: true }, command: "", args: [], env: [] };
}

const pairs = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).map(([k, v]) => [String(k), v === null || v === undefined ? "" : String(v)]) : []);

/** 命令行拆词：认单引号、双引号和反斜杠；行尾的 \ 续行 */
export function shellSplit(text) {
  const out = [];
  let cur = "";
  let quote = "";
  let has = false;
  const s = String(text ?? "").replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/** 地址里像密钥的查询参数：key、token、apikey、access_token、secret、sig… */
const SECRET_PARAM = /^(key|api[-_]?key|apikey|token|access[-_]?token|auth|secret|sig|signature|password|pwd|ak|sk|app[-_]?key|code)$/i;

/** 从地址给连接起名：mcp.linear.app → linear；api.githubcopilot.com → githubcopilot；带路径的取有意义的那一段 */
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|mcp|api|open|openapi)\./, "");
    const parts = host.split(".");
    const base = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    const generic = /^(com|net|org|co|ai|io|dev|app|cn)$/;
    const name = generic.test(base) && parts.length > 2 ? parts[parts.length - 3] : base;
    if (/^(localhost|\d+)$/.test(name) || /^\d+(\.\d+){3}$/.test(u.hostname)) return `${u.hostname}${u.port ? `-${u.port}` : ""}`;
    return name || u.hostname;
  } catch {
    return "";
  }
}

/** 从命令给连接起名：npx -y @scope/pkg-mcp → pkg-mcp；uvx tool → tool；docker run … image:tag → image */
export function nameFromCommand(command, args = []) {
  // 选项（-y、--rm）和 KEY=value（docker run -e 后面的那种）不是名字
  const words = [command, ...args].filter((w) => w && !w.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const runners = new Set(["npx", "uvx", "bunx", "pnpm", "yarn", "dlx", "docker", "run", "node", "python", "python3", "uv", "bun", "deno", "exec", "tool", "pipx"]);
  const pick = words.find((w) => !runners.has(w.toLowerCase().replace(/\.(cmd|exe)$/, ""))) ?? command;
  return String(pick ?? "")
    .replace(/^.*[\\/]/, "")
    .replace(/^@[^/]+\//, "")
    .replace(/@[\w.^~<>=-]+$/, "")
    .replace(/:[\w.-]+$/, "")
    .replace(/\.(m?js|py|ts|exe|cmd)$/i, "")
    .slice(0, 60);
}

export function autoName(draft) {
  return draft.transport === "stdio" ? nameFromCommand(draft.command, draft.args) : nameFromUrl(draft.url);
}

/** 「Authorization: Bearer …」整行贴进键这一格：拆成键和值 */
export function splitHeaderLine(text) {
  const m = /^\s*([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*:\s*(\S[\s\S]*)$/.exec(String(text ?? ""));
  return m ? [m[1], m[2].trim()] : null;
}

/** 一个服务对象（mcpServers 里的一项）→ draft。认不出来回 null */
function serverToDraft(name, cfg, partial = false) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const d = emptyDraft();
  d.name = String(name ?? cfg.name ?? "").trim();
  const type = String(cfg.type ?? cfg.transport ?? cfg.transportType ?? "").toLowerCase();
  const url = cfg.url ?? cfg.serverUrl ?? cfg.httpUrl ?? cfg.endpoint ?? cfg.baseUrl;
  if ((typeof url === "string" && url.trim()) || (partial && type !== "stdio" && typeof cfg.command !== "string")) {
    d.transport = "http";
    d.url = typeof url === "string" ? url.trim() : "";
    d.sse = type === "sse" || /\/sse\/?(\?|$)/i.test(d.url);
    d.headers = pairs(cfg.headers ?? cfg.requestInit?.headers);
    d.query = pairs(cfg.query);
    const auth = cfg.auth && typeof cfg.auth === "object" ? cfg.auth : cfg.oauth && typeof cfg.oauth === "object" ? { method: "oauth", oauth: cfg.oauth } : null;
    const method = String(auth?.method ?? "");
    if (AUTH_METHODS.includes(method)) d.auth = method;
    else if (auth?.oauth || cfg.oauth === true) d.auth = "oauth";
    else if (d.headers.length) d.auth = "headers";
    else if (d.query.length) d.auth = "query";
    else d.auth = "auto";
    if (auth?.oauth && typeof auth.oauth === "object") {
      const o = auth.oauth;
      d.oauth = {
        clientId: String(o.clientId ?? o.client_id ?? ""),
        clientSecret: String(o.clientSecret ?? o.client_secret ?? ""),
        scopes: Array.isArray(o.scopes) ? o.scopes.map(String) : typeof o.scope === "string" ? o.scope.split(/\s+/).filter(Boolean) : [],
        pkce: o.pkce !== false,
      };
    }
    if (d.auth === "query" && !d.query.length) moveQueryOut(d);
    return d;
  }
  if ((typeof cfg.command === "string" && cfg.command.trim()) || (partial && (type === "stdio" || typeof cfg.command === "string"))) {
    d.transport = "stdio";
    d.auth = "none";
    const words = shellSplit(cfg.command || "");
    // command 里写了整条命令（"npx -y pkg"）时拆开
    d.command = words[0] ?? "";
    d.args = [...words.slice(1), ...(Array.isArray(cfg.args) ? cfg.args.map(String) : [])];
    d.env = pairs(cfg.env);
    return d;
  }
  return null;
}

/** 认证方式是查询参数、参数却写在 url 里：把像密钥的参数挪到 query（没有像密钥的就全挪） */
function moveQueryOut(d) {
  try {
    const u = new URL(d.url);
    const all = [...u.searchParams.entries()];
    const secret = all.filter(([k]) => SECRET_PARAM.test(k));
    const take = secret.length ? secret : all;
    for (const [k, v] of take) {
      d.query.push([k, v]);
      u.searchParams.delete(k);
    }
    d.url = u.toString();
  } catch {
    /* 地址不对：留给校验去说 */
  }
}

/** JSON 文本 → 若干 draft。error：json 不是合法 JSON · empty 里面没有服务 */
export function draftsFromJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { drafts: [], error: "json" };
  }
  if (!data || typeof data !== "object") return { drafts: [], error: "empty" };
  const drafts = [];
  const add = (name, cfg) => {
    const d = serverToDraft(name, cfg);
    if (d) drafts.push(d);
  };
  const map = data.mcpServers ?? data.servers ?? data.mcp?.servers ?? data["mcp.servers"];
  if (map && typeof map === "object" && !Array.isArray(map)) for (const [name, cfg] of Object.entries(map)) add(name, cfg);
  else if (Array.isArray(map)) for (const cfg of map) add(cfg?.name, cfg);
  else if (typeof data.url === "string" || typeof data.command === "string" || typeof data.serverUrl === "string") add(data.name ?? "", data);
  else for (const [name, cfg] of Object.entries(data)) add(name, cfg); // 一层「名称 → 配置」
  return drafts.length ? { drafts } : { drafts: [], error: "empty" };
}

/** claude mcp add [选项] <name> <url | -- 命令…>、claude mcp add-json <name> '<json>' */
function fromClaudeCommand(words) {
  if (words[0] !== "claude" || words[1] !== "mcp") return null;
  const sub = words[2];
  const rest = words.slice(3);
  if (sub === "add-json") {
    const name = rest.find((w) => !w.startsWith("-"));
    const json = rest.filter((w) => !w.startsWith("-"))[1];
    if (!name || !json) return null;
    try {
      const d = serverToDraft(name, JSON.parse(json));
      return d ? [d] : null;
    } catch {
      return null;
    }
  }
  if (sub !== "add") return null;
  const d = emptyDraft();
  const positional = [];
  let transport = "";
  let after = null;
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (w === "--") {
      after = rest.slice(i + 1);
      break;
    }
    const eq = /^(--[a-z-]+)=(.*)$/.exec(w);
    const flag = eq ? eq[1] : w;
    const val = () => (eq ? eq[2] : rest[++i] ?? "");
    if (flag === "-t" || flag === "--transport") transport = val().toLowerCase();
    else if (flag === "-H" || flag === "--header") {
      const kv = splitHeaderLine(val());
      if (kv) d.headers.push(kv);
    } else if (flag === "-e" || flag === "--env") {
      const m = /^([^=]+)=(.*)$/.exec(val());
      if (m) d.env.push([m[1], m[2]]);
    } else if (flag === "-s" || flag === "--scope" || flag === "--client-id" || flag === "--callback-port") val();
    else if (flag.startsWith("-")) continue;
    else positional.push(w);
  }
  d.name = positional[0] ?? "";
  const target = positional[1];
  if (after?.length || (target && !/^https?:\/\//i.test(target) && transport !== "http" && transport !== "sse")) {
    const cmd = after?.length ? after : positional.slice(1);
    if (!cmd.length) return null;
    d.transport = "stdio";
    d.auth = "none";
    d.command = cmd[0];
    d.args = cmd.slice(1);
    d.headers = [];
    return [d];
  }
  if (!target) return null;
  d.transport = "http";
  d.url = target;
  d.sse = transport === "sse" || /\/sse\/?(\?|$)/i.test(target);
  d.env = [];
  d.auth = d.headers.length ? "headers" : "auto";
  return [d];
}

const RUNNERS = /^(npx|uvx|bunx|pnpm|yarn|docker|node|python3?|uv|bun|deno|pipx)(\.cmd|\.exe)?$/i;

/** 本地启动命令：前面的 KEY=value 记入环境变量 */
function fromLocalCommand(words) {
  const env = [];
  let i = 0;
  if (words[i] === "env") i++;
  for (; i < words.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(words[i]);
    if (!m) break;
    env.push([m[1], m[2]]);
  }
  const cmd = words.slice(i);
  if (!cmd.length || !RUNNERS.test(cmd[0])) return null;
  const name = cmd[0].toLowerCase().replace(/\.(cmd|exe)$/, "");
  // pnpm / yarn 只认 dlx，docker 只认 run：别的子命令不是在启动一个服务
  if ((name === "pnpm" || name === "yarn") && cmd[1] !== "dlx") return null;
  if (name === "docker" && cmd[1] !== "run") return null;
  if (cmd.length < 2) return null;
  const d = emptyDraft("stdio");
  d.command = cmd[0];
  d.args = cmd.slice(1);
  d.env = env;
  // docker run -e KEY=value：值也算密钥，但留在参数里（docker 自己读）
  return [d];
}

/**
 * 粘贴框里的内容 → 若干 draft。kind：url | json | claude | command。
 * 认不出来：{ drafts: [], error: "unrecognized" }；JSON 写坏了：error: "json"。
 */
export function parsePaste(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { drafts: [], error: "empty" };
  if (/^[[{]/.test(raw)) {
    const r = draftsFromJson(raw);
    if (r.drafts.length) return finish(r.drafts, "json");
    // 只贴了 "name": { … } 这一段（没有外面的花括号）
    return { drafts: [], error: r.error === "json" ? "json" : "unrecognized" };
  }
  if (/^"[^"]+"\s*:\s*\{/.test(raw)) {
    const r = draftsFromJson(`{${raw.replace(/,\s*$/, "")}}`);
    if (r.drafts.length) return finish(r.drafts, "json");
  }
  if (/^https?:\/\/\S+$/i.test(raw)) {
    const d = emptyDraft();
    d.url = raw;
    d.sse = /\/sse\/?(\?|$)/i.test(raw);
    d.auth = guessUrlAuth(raw);
    if (d.auth === "query") moveQueryOut(d);
    return finish([d], "url");
  }
  const words = shellSplit(raw);
  const claude = fromClaudeCommand(words);
  if (claude) return finish(claude, "claude");
  const local = fromLocalCommand(words);
  if (local) return finish(local, "command");
  return { drafts: [], error: "unrecognized" };
}

/** 只有一条地址：带着像密钥的查询参数 → 查询参数；路径里有一长串像密钥的东西 → 专属链接；其余自动 */
function guessUrlAuth(url) {
  try {
    const u = new URL(url);
    if ([...u.searchParams.keys()].some((k) => SECRET_PARAM.test(k))) return "query";
    if (u.pathname.split("/").some((seg) => seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg))) return "dedicatedUrl";
  } catch {
    /* 不是地址 */
  }
  return "auto";
}

function finish(drafts, kind) {
  for (const d of drafts) if (!d.name) d.name = autoName(d);
  return { drafts, kind };
}

/** 这份配置里还是占位符的字段：["url", "headers.Authorization", "query.key", "env.TOKEN", "oauth.clientSecret"] */
export function placeholdersIn(d) {
  const out = [];
  if (d.transport === "http") {
    if (isPlaceholder(d.url) || /\$\{?[A-Za-z_]\w*\}?|<[^>]+>|YOUR[-_]/.test(String(d.url ?? ""))) out.push("url");
    if (d.auth === "headers") for (const [k, v] of d.headers) if (isPlaceholder(v)) out.push(`headers.${k}`);
    if (d.auth === "query") for (const [k, v] of d.query) if (isPlaceholder(v)) out.push(`query.${k}`);
    if (d.auth === "oauth" && isPlaceholder(d.oauth?.clientSecret)) out.push("oauth.clientSecret");
  } else {
    for (const [k, v] of d.env) if (isPlaceholder(v)) out.push(`env.${k}`);
  }
  return out;
}

/**
 * 能不能添加。返回第一处问题的代号（界面按它在对应字段下写提示），没有问题是 ""。
 * url 地址不是 http(s) · command 没填命令 · headers / query / env 有一行不完整（没有键或没有值）· headersEmpty / queryEmpty
 * 选了请求头 / 查询参数却一行都没有 · placeholder 还有没换掉的占位符
 */
export function draftProblem(d) {
  const complete = (rows) => rows.every(([k, v]) => String(k).trim() && String(v).trim());
  if (d.transport === "http") {
    let ok = false;
    try {
      ok = /^https?:$/.test(new URL(String(d.url ?? "").trim()).protocol);
    } catch {
      ok = String(d.url ?? "") === MASK;
    }
    if (!ok) return "url";
    if (d.auth === "headers") {
      if (!d.headers.length) return "headersEmpty";
      if (!complete(d.headers)) return "headers";
    }
    if (d.auth === "query") {
      if (!d.query.length) return "queryEmpty";
      if (!complete(d.query)) return "query";
    }
  } else {
    if (!String(d.command ?? "").trim()) return "command";
    if (!d.env.every(([k, v]) => String(k).trim() && String(v).trim())) return "env";
  }
  if (placeholdersIn(d).length) return "placeholder";
  return "";
}

/**
 * draft → mcpServers JSON 文本。mask：密钥显示成 MASK（界面上的 JSON 页）；不打码的那份只在内存里用。
 * 认证方式是自动且没有额外字段时不写 auth，和别的工具的写法一样。
 */
export function draftToJson(d, { mask = true } = {}) {
  const m = (v) => (mask && String(v ?? "") !== "" ? MASK : v);
  const name = d.name.trim();
  const obj = {};
  if (d.transport === "stdio") {
    obj.command = d.command;
    if (d.args.length) obj.args = [...d.args];
    if (d.env.length) obj.env = Object.fromEntries(d.env.map(([k, v]) => [k, m(v)]));
  } else {
    obj.url = d.auth === "dedicatedUrl" ? m(d.url) : d.url;
    if (d.sse) obj.type = "sse";
    if (d.auth === "headers" && d.headers.length) obj.headers = Object.fromEntries(d.headers.map(([k, v]) => [k, m(v)]));
    if (d.auth === "query" && d.query.length) obj.query = Object.fromEntries(d.query.map(([k, v]) => [k, m(v)]));
    if (d.auth === "oauth") {
      const o = { pkce: d.oauth.pkce !== false };
      if (d.oauth.clientId) o.clientId = d.oauth.clientId;
      if (d.oauth.clientSecret) o.clientSecret = m(d.oauth.clientSecret);
      if (d.oauth.scopes?.length) o.scopes = [...d.oauth.scopes];
      obj.auth = { method: "oauth", oauth: o };
    } else if (d.auth === "none" || d.auth === "dedicatedUrl") obj.auth = { method: d.auth };
    else if (d.auth === "auto" && (d.headers.length || d.query.length)) obj.auth = { method: "auto" };
  }
  return JSON.stringify({ mcpServers: { [name]: obj } }, null, 2);
}

/**
 * JSON 页的文本 → draft（只取第一个服务）。prev 是切到 JSON 之前的 draft：JSON 里还是 MASK 的值换回 prev 里同名的那一个
 * （prev 里也没有，说明是已保存连接的密钥，MASK 原样留着，后端保留已存的）。
 * error：json 不是合法 JSON · missing 缺少名称或地址 / 命令 · headers / query / env 写法不对 · auth 认证字段不完整
 */
export function jsonToDraft(text, prev, { partial = false } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "json" };
  }
  const map = data?.mcpServers ?? data?.servers;
  const entries = map && typeof map === "object" && !Array.isArray(map) ? Object.entries(map) : typeof data?.url === "string" || typeof data?.command === "string" || (partial && data && typeof data === "object" && !Array.isArray(data)) ? [[data.name ?? "", data]] : [];
  if (!entries.length) return { error: "missing" };
  const [name, cfg] = entries[0];
  if (!cfg || typeof cfg !== "object") return { error: "missing" };
  const flat = (o) => o === undefined || (o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
  if (!partial && !flat(cfg.headers)) return { error: "headers" };
  if (!partial && !flat(cfg.query)) return { error: "query" };
  if (!partial && !flat(cfg.env)) return { error: "env" };
  if (!partial && cfg.auth !== undefined && (typeof cfg.auth !== "object" || !cfg.auth || (cfg.auth.method !== undefined && !AUTH_METHODS.includes(String(cfg.auth.method))))) return { error: "auth" };
  if (!partial && cfg.auth?.method === "oauth" && cfg.auth.oauth !== undefined && (typeof cfg.auth.oauth !== "object" || !cfg.auth.oauth)) return { error: "auth" };
  const d = serverToDraft(name, cfg, partial);
  if (!d) return { error: "missing" };
  if (prev) {
    const unmask = (rows, old) => rows.map(([k, v]) => [k, v === MASK ? (old.find(([ok]) => ok === k)?.[1] ?? MASK) : v]);
    d.headers = unmask(d.headers, prev.headers ?? []);
    d.query = unmask(d.query, prev.query ?? []);
    d.env = unmask(d.env, prev.env ?? []);
    if (d.url === MASK) d.url = prev.url ?? MASK;
    if (d.oauth.clientSecret === MASK) d.oauth.clientSecret = prev.oauth?.clientSecret ?? MASK;
    // JSON 里没写 auth、表单里原来选的方式还说得通时，留着原来的选择（专属链接、无需认证不写字段也不丢）
    if (cfg.auth === undefined && d.transport === "http" && prev.transport === "http" && d.auth === "auto" && (prev.auth === "dedicatedUrl" || prev.auth === "none")) d.auth = prev.auth;
  }
  return { draft: d };
}

/** 识别结果那一行用的摘要：类型和认证方式的代号，界面去翻译 */
export function draftSummary(d) {
  return { name: d.name || autoName(d), type: d.transport === "stdio" ? "local" : "remote", auth: d.transport === "stdio" ? (d.env.length ? "env" : "none") : d.auth };
}
