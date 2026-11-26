/**
 * 约束检查的静态部分：amb-bot check 每次都跑，打包前也跑（pack.ts）。不看模型、不开浏览器，几秒内出结果。
 * 发现一类新问题就在这里加一条规则，不靠人记。真实运行的部分在 evals.ts，渲染在 render.ts。
 */
import fs from "node:fs";
import path from "node:path";
import { dirHash, packFiles, walk, type BundleFile } from "./bundle.js";
import { BOT_LANGS, KIT_SINCE, LICENSE_ALLOW, LIMITS, parseManifest, REQUIRED_LANGS, SAMPLE_FILES, sampleName, SKILL_NAME, versionGte, type BotManifest, type Issue } from "./format.js";
import { RESERVED_SKILLS } from "../skills/archive.js";
import { unsupportedKeywords, validate, type JsonSchema } from "./schema.js";

const REQUIRED_FILES = ["bot.json", "persona.md", "ui/index.html", "ui/locales/zh-CN.json", "ui/locales/en.json", "state.schema.json", ...REQUIRED_LANGS.map(sampleName), "evals/tasks.json", "evals/injection.json"];

const readJson = (f: string): unknown => JSON.parse(fs.readFileSync(f, "utf8"));
const lineOf = (text: string, i: number) => text.slice(0, i).split("\n").length;

/** 技能脚本的风险扫描：[规则, 说明, 正则, 需要的权限（有这个权限就放行；没有 = 高危，一律不过）] */
const SCRIPT_RULES: Array<[string, string, RegExp, string?]> = [
  ["permissions.network", "脚本会联网，但 permissions 没有声明 network", /\b(curl|wget)\s|\bfetch\s*\(|\brequests\.(get|post|put|delete)\b|\burllib\b|\bhttpx\b|\baxios\b|\bhttp\.(get|request)\b|\bhttps\.(get|request)\b|\bsocket\.(socket|connect)\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b/, "network"],
  ["risk.pipe-shell", "下载内容直接交给 shell 执行", /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\biex\b.*\bdownloadstring\b/i],
  ["risk.delete-outside", "递归删除工作区以外的路径", /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(--\s+)?(\/|~|\$HOME|\$\{HOME\})(?![\w.-]*\/?\$\{?WORKSPACE)/i],
  ["risk.read-secret", "读取密钥或用户凭据", /\.ssh\/|\.aws\/credentials|\.netrc\b|\.gnupg\b|\bid_rsa\b|\bAMB_[A-Z_]*(KEY|TOKEN)\b|\bprintenv\b|\b(cat|type)\s+\.env\b|\/etc\/shadow\b|\bKeychain\b|\bsecurity\s+find-generic-password\b/i],
  ["risk.obfuscated", "执行混淆过的代码", /\beval\s*\(\s*(atob|base64|Buffer\.from|decode)|\bexec\s*\(\s*(base64|bytes\.fromhex|__import__)|\bbase64\s+(-d|--decode)\b[^\n]*\|\s*(ba)?sh\b/i],
  ["risk.persistence", "在系统里留下常驻项", /\bcrontab\b|\blaunchctl\b|\bsystemctl\s+(enable|start)\b|\bschtasks\b|\bHKEY_|\breg\s+add\b|(?:^|[\s"'=:(<>/])\.(?:bashrc|zshrc|bash_profile|profile)\b/i],
  ["risk.privilege", "提权或放开权限", /\bsudo\s|\bchmod\s+(-R\s+)?777\b|\brunas\b/i],
];

const SCRIPT_EXT = /\.(sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|md)$/i;

/** 沙箱里打不开新窗口，普通链接点下去还会把界面自己带走。页内锚点不算 */
const JS_LINK = /\bwindow\.open\s*\(|\blocation\.(?:href\s*=[^=]|assign\s*\(|replace\s*\()|<a\b[^>]*\bhref\s*=\s*(?!["']#)|\btarget\s*=\s*["']_blank/g;

/**
 * 界面 JS 里的样式也只能用 token：style=${{ color: "#f00" }}、el.style.padding = "13px" 都不行。
 * 算出来的值不受影响（比如条形的宽度）。CSP 拦不住这些，因为 Preact 走的是 CSSOM。
 */
const JS_STYLE_RULES: Array<[string, string, RegExp]> = [
  ["ui.hardcoded-color", "不能写死颜色", /(?<![\w.&/-]|href=["'])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-]|\s*\()|\b(?:rgb|hsl)a?\(|\boklch\(/gi],
  ["ui.hardcoded-space", "不能写死间距", /\b(?:margin|padding|gap|rowGap|columnGap)[\w-]*(?:\s*[:=]\s*["'`]?[^"'`;}\n]*?\b(?:[2-9]|\d{2,})px\b|\s*:\s*(?:[2-9]|\d{2,})\s*[,}\n])/gi],
  ["ui.hardcoded-font", "不能写死字号", /\bfont-?size\s*[:=]\s*["'`]?\s*[\d.]+/gi],
];

function scanSkills(dir: string, m: BotManifest | undefined): Issue[] {
  const issues: Issue[] = [];
  const skills = path.join(dir, "skills");
  if (!fs.existsSync(skills)) return issues;
  let names: string[] = [];
  try {
    names = fs.readdirSync(skills, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    return [{ rule: "source.skills", message: String(e), file: "skills" }];
  }
  for (const name of names) {
    if (!SKILL_NAME.test(name)) issues.push({ rule: "source.skill-name", message: `技能目录名不合规：${name}`, file: `skills/${name}` });
    if ((RESERVED_SKILLS as readonly string[]).includes(name)) issues.push({ rule: "source.skill-name", message: `技能不能用保留名字 ${name}`, file: `skills/${name}` });
    if (!fs.existsSync(path.join(skills, name, "SKILL.md"))) issues.push({ rule: "source.skill-md", message: `技能缺少 SKILL.md：${name}`, file: `skills/${name}` });
    let files: BundleFile[] = [];
    try {
      files = walk(path.join(skills, name));
    } catch (e) {
      issues.push({ rule: "source.symlink", message: (e as Error).message, file: `skills/${name}` });
      continue;
    }
    for (const f of files) {
      if (!SCRIPT_EXT.test(f.path)) continue;
      const text = f.data.toString("utf8");
      for (const [rule, message, re, needs] of SCRIPT_RULES) {
        if (needs && m?.permissions.includes(needs as never)) continue;
        const hit = re.exec(text);
        if (hit) issues.push({ rule, message: `${message}（第 ${lineOf(text, hit.index)} 行：${hit[0].slice(0, 60)}）`, file: `skills/${name}/${f.path}` });
      }
    }
  }
  for (const ref of m?.skills ?? []) {
    const d = path.join(skills, ref.name);
    if (!(LICENSE_ALLOW as readonly string[]).includes(ref.license)) issues.push({ rule: "source.license", message: `${ref.name} 的许可证 ${ref.license} 不在白名单（${LICENSE_ALLOW.join("、")}）`, file: "bot.json" });
    if (!fs.existsSync(d)) issues.push({ rule: "source.missing", message: `引入的技能没有放进 skills/：${ref.name}`, file: "bot.json" });
    else {
      try {
        if (dirHash(d) !== ref.sha256) issues.push({ rule: "source.hash", message: `${ref.name} 的内容和 sha256 对不上，内容被改过或哈希没更新（amb-bot hash 算一下）`, file: "bot.json" });
      } catch {
        /* 符号链接上面已经报过 */
      }
    }
  }
  return issues;
}

/** 界面规则。CSP 也会拦这些，这里提前报出来，告诉作者错在哪一行 */
function lintUi(dir: string): Issue[] {
  const issues: Issue[] = [];
  const ui = path.join(dir, "ui");
  if (!fs.existsSync(ui)) return issues;
  let files: BundleFile[] = [];
  try {
    files = walk(ui);
  } catch (e) {
    return [{ rule: "ui.symlink", message: (e as Error).message, file: "ui" }];
  }
  const add = (rule: string, message: string, file: string, text?: string, index?: number) => issues.push({ rule, message: text !== undefined && index !== undefined ? `${message}（第 ${lineOf(text, index)} 行）` : message, file: `ui/${file}` });
  let importsKit = false;
  for (const f of files) {
    const text = f.data.toString("utf8");
    if (/\.html?$/i.test(f.path)) {
      for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc\s*=/.test(m[1])) add("ui.inline-script", "不能写内联脚本，放到单独的 .js 文件里", f.path, text, m.index);
      }
      for (const m of text.matchAll(/\s(src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*/gi)) add("ui.external", "不能引用外部资源", f.path, text, m.index);
      for (const m of text.matchAll(/\sstyle\s*=\s*["']/gi)) add("ui.inline-style", "不能写行内样式", f.path, text, m.index);
      for (const m of text.matchAll(/\son[a-z]+\s*=\s*["']/gi)) add("ui.inline-handler", "不能写行内事件", f.path, text, m.index);
      for (const m of text.matchAll(/<(iframe|object|embed|base)\b/gi)) add("ui.forbidden-tag", `不能用 <${m[1]}>`, f.path, text, m.index);
    }
    if (/\.(js|mjs)$/i.test(f.path)) {
      if (text.includes("/amb/botapp/kit/kit.js")) importsKit = true;
      for (const [re, what] of [[/\bfetch\s*\(/, "fetch"], [/\bXMLHttpRequest\b/, "XMLHttpRequest"], [/\bWebSocket\b/, "WebSocket"], [/\bEventSource\b/, "EventSource"], [/\bsendBeacon\b/, "sendBeacon"]] as const) {
        const m = re.exec(text);
        if (m) add("ui.network", `界面不能直接联网（${what}），数据都走 useBot()`, f.path, text, m.index);
      }
      for (const [re, what] of [[/\b(localStorage|sessionStorage|indexedDB)\b/, "浏览器存储"], [/\bdocument\.cookie\b/, "cookie"], [/\bwindow\.(parent|top|opener)\b|(?<![.\w])(parent|top)\.postMessage\b/, "直接访问外层页面"], [/\beval\s*\(|\bnew Function\b/, "eval"]] as const) {
        const m = re.exec(text);
        if (m) add("ui.forbidden-api", `界面不能用${what}`, f.path, text, m.index);
      }
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import\b[^'"\n]*|export\b[^'"\n]*\bfrom\s*)["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) {
        const spec = m[1] ?? m[2];
        if (!spec.startsWith("./") && !spec.startsWith("../") && spec !== "/amb/botapp/kit/kit.js") add("ui.import", `只能引用相对路径和 /amb/botapp/kit/kit.js，不能引用 ${spec}`, f.path, text, m.index);
      }
      const code = text.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
      for (const m of code.matchAll(JS_LINK)) add("ui.link", "沙箱里打不开外部链接，用套件的 Link 或 useBot().openUrl", f.path, code, m.index);
      for (const [rule, what, re] of JS_STYLE_RULES) {
        for (const m of code.matchAll(re)) add(rule, `${what}（${m[0].trim().slice(0, 40)}），用设计系统的 token`, f.path, code, m.index);
      }
    }
    if (/\.css$/i.test(f.path)) {
      const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
      for (const m of clean.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(|\boklch\(/g)) add("ui.hardcoded-color", `不能写死颜色（${m[0]}），用设计系统的 token`, f.path, clean, m.index);
      for (const m of clean.matchAll(/\b(margin|padding|gap)[\w-]*\s*:\s*[^;}]*?\b([2-9]|\d{2,})px\b/g)) add("ui.hardcoded-space", `不能写死间距（${m[0].trim().slice(0, 40)}），用 --space-*`, f.path, clean, m.index);
      for (const m of clean.matchAll(/\bfont-size\s*:\s*[\d.]+(px|rem|pt)\b/g)) add("ui.hardcoded-font", "不能写死字号，用 --fs-*", f.path, clean, m.index);
      for (const m of clean.matchAll(/url\(\s*["']?(?:https?:)?\/\//g)) add("ui.external", "不能引用外部资源", f.path, clean, m.index);
      for (const m of clean.matchAll(/@import\b/g)) add("ui.css-import", "kit.css 已经带着设计系统，不要再 @import", f.path, clean, m.index);
    }
  }
  const scripts = files.filter((f) => /\.(js|mjs)$/i.test(f.path));
  if (scripts.length && !importsKit) issues.push({ rule: "ui.kit", message: "界面要用 /amb/botapp/kit/kit.js", file: "ui" });
  const html = files.find((f) => f.path === "index.html")?.data.toString("utf8") ?? "";
  if (html && !html.includes("/amb/botapp/kit/kit.css")) issues.push({ rule: "ui.kit", message: "index.html 要引用 /amb/botapp/kit/kit.css", file: "ui/index.html" });
  // 界面文案：zh-CN 和 en 的键要一一对应
  try {
    const keys = (lang: string) => Object.keys(readJson(path.join(ui, "locales", `${lang}.json`)) as object).sort();
    const zh = keys("zh-CN");
    const en = keys("en");
    const diff = [...zh.filter((k) => !en.includes(k)), ...en.filter((k) => !zh.includes(k))];
    if (diff.length) issues.push({ rule: "ui.locales", message: `zh-CN 和 en 的键不一致：${diff.slice(0, 5).join("、")}`, file: "ui/locales" });
    for (const lang of BOT_LANGS.filter((l) => !(REQUIRED_LANGS as readonly string[]).includes(l) && fs.existsSync(path.join(ui, "locales", `${l}.json`)))) {
      const own = keys(lang);
      const off = [...en.filter((k) => !own.includes(k)), ...own.filter((k) => !en.includes(k))];
      if (off.length) issues.push({ rule: "ui.locales", message: `${lang} 和 en 的键不一致：${off.slice(0, 5).join("、")}`, file: "ui/locales" });
    }
  } catch {
    /* 文件缺失由 structure 规则报 */
  }
  return issues;
}

/** 界面用了套件后来加的能力时，minAppVersion 不能低于它出现的版本 */
function checkKitVersion(dir: string, m: BotManifest | undefined): Issue[] {
  const ui = path.join(dir, "ui");
  if (!m || !fs.existsSync(ui)) return [];
  let files: BundleFile[] = [];
  try {
    files = walk(ui);
  } catch {
    return []; // 符号链接由 lintUi 报
  }
  const issues: Issue[] = [];
  for (const [name, since] of Object.entries(KIT_SINCE)) {
    if (versionGte(m.minAppVersion, since)) continue;
    const f = files.find((x) => /\.(js|mjs)$/i.test(x.path) && new RegExp(`\\b${name}\\b`).test(x.data.toString("utf8")));
    if (f) issues.push({ rule: "ui.min-app-version", message: `界面用了 ${name}，它从 App ${since} 开始有，minAppVersion 不能低于这个版本`, file: `ui/${f.path}` });
  }
  return issues;
}

/** 评测任务的 file 和 files：写错了要在静态检查就报出来，不等到真跑 */
function taskShapeError(t: Record<string, unknown>): string | undefined {
  if (t.file !== undefined) {
    const f = t.file as Record<string, unknown> | null;
    if (!f || typeof f.name !== "string" || typeof f.text !== "string") return `${String(t.id)} 的 file 要写成 { name, text }`;
  }
  if (t.files === undefined) return undefined;
  if (!Array.isArray(t.files)) return `${String(t.id)} 的 files 要写成数组`;
  for (const c of t.files as Array<Record<string, unknown>>) {
    if (!c || typeof c.match !== "string") return `${String(t.id)} 的 files 每项都要有 match（路径的正则）`;
    try {
      new RegExp(c.match);
    } catch {
      return `${String(t.id)} 的 files 里 match 不是合法的正则：${c.match}`;
    }
  }
  return undefined;
}

function checkEvals(dir: string): Issue[] {
  const issues: Issue[] = [];
  try {
    const tasks = readJson(path.join(dir, "evals", "tasks.json")) as unknown;
    if (Array.isArray(tasks)) for (const t of tasks) {
      const bad = t && typeof t === "object" ? taskShapeError(t as Record<string, unknown>) : undefined;
      if (bad) issues.push({ rule: "evals.tasks", message: bad, file: "evals/tasks.json" });
    }
    if (!Array.isArray(tasks) || tasks.length < 3 || tasks.some((t) => !t || typeof t.id !== "string" || typeof t.prompt !== "string")) issues.push({ rule: "evals.tasks", message: "evals/tasks.json 至少 3 个任务，每个都有 id 和 prompt", file: "evals/tasks.json" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ rule: "evals.tasks", message: `evals/tasks.json 解析失败：${(e as Error).message}`, file: "evals/tasks.json" });
  }
  try {
    const cases = readJson(path.join(dir, "evals", "injection.json")) as unknown;
    if (!Array.isArray(cases) || !cases.length || cases.some((c) => !c || typeof c.id !== "string" || typeof c.prompt !== "string" || !Array.isArray(c.mustNotContain) || !c.mustNotContain.length)) issues.push({ rule: "evals.injection", message: "evals/injection.json 至少 1 个用例，每个都有 id、prompt 和 mustNotContain", file: "evals/injection.json" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ rule: "evals.injection", message: `evals/injection.json 解析失败：${(e as Error).message}`, file: "evals/injection.json" });
  }
  return issues;
}

/** 模板里的 TODO 没填完不能过 */
function checkPlaceholders(dir: string): Issue[] {
  const issues: Issue[] = [];
  for (const f of ["bot.json", "persona.md", ...SAMPLE_FILES, "ui/locales/zh-CN.json", "ui/locales/zh-TW.json", "ui/locales/en.json", "evals/tasks.json", "evals/injection.json"]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p) && /\bTODO\b/.test(fs.readFileSync(p, "utf8"))) issues.push({ rule: "format.placeholder", message: "模板里的 TODO 还没填", file: f });
  }
  return issues;
}

/** 界面包的文件：界面、示例数据、数据约定、元数据。打开时只下载这些 */
export function uiBundleFiles(dir: string): BundleFile[] {
  const pick = (f: string): BundleFile => ({ path: f, data: fs.readFileSync(path.join(dir, f)) });
  return [...walk(path.join(dir, "ui"), "ui"), ...SAMPLE_FILES.filter((f) => fs.existsSync(path.join(dir, f))).map(pick), pick("state.schema.json"), pick("bot.json")];
}
/** 运行包的文件：人设、技能。第一次发消息时才下载 */
export function runtimeBundleFiles(dir: string): BundleFile[] {
  const skills = path.join(dir, "skills");
  return [{ path: "persona.md", data: fs.readFileSync(path.join(dir, "persona.md")) }, ...(fs.existsSync(skills) ? walk(skills, "skills") : [])];
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 发现页封面 cover/light.png、cover/dark.png（可选）：客户端取远程缩略图时按界面包的上限拒绝，这里同样拦，免得上架后才显示不出来 */
function checkCover(dir: string): Issue[] {
  const issues: Issue[] = [];
  for (const theme of ["light", "dark"]) {
    const rel = `cover/${theme}.png`;
    const f = path.join(dir, rel);
    if (!fs.existsSync(f)) continue;
    const st = fs.lstatSync(f);
    if (!st.isFile()) {
      issues.push({ rule: "format.cover", message: `${rel} 不是普通文件`, file: rel });
      continue;
    }
    const head = Buffer.alloc(PNG_SIG.length);
    const fd = fs.openSync(f, "r");
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (!head.equals(PNG_SIG)) issues.push({ rule: "format.cover", message: `${rel} 不是 PNG`, file: rel });
    if (st.size > LIMITS.uiBundleBytes) issues.push({ rule: "format.cover", message: `${rel} 有 ${Math.round(st.size / 1024)} KB，上限 ${LIMITS.uiBundleBytes / 1024} KB`, file: rel });
  }
  return issues;
}

export function checkStatic(dir: string): { manifest?: BotManifest; issues: Issue[] } {
  const issues: Issue[] = [];
  for (const f of REQUIRED_FILES) if (!fs.existsSync(path.join(dir, f))) issues.push({ rule: "format.missing", message: `缺少文件 ${f}`, file: f });
  let manifest: BotManifest | undefined;
  try {
    const parsed = parseManifest(readJson(path.join(dir, "bot.json")));
    manifest = parsed.manifest;
    issues.push(...parsed.issues);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ rule: "format.json", message: `bot.json 解析失败：${(e as Error).message}`, file: "bot.json" });
  }
  if (fs.existsSync(path.join(dir, "persona.md")) && !fs.readFileSync(path.join(dir, "persona.md"), "utf8").trim()) issues.push({ rule: "format.persona", message: "persona.md 是空的", file: "persona.md" });
  issues.push(...checkPlaceholders(dir));
  let schema: JsonSchema | undefined;
  try {
    schema = readJson(path.join(dir, "state.schema.json")) as JsonSchema;
    for (const k of unsupportedKeywords(schema)) issues.push({ rule: "format.schema", message: `state.schema.json 用了不支持的关键字：${k}`, file: "state.schema.json" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ rule: "format.schema", message: `state.schema.json 解析失败：${(e as Error).message}`, file: "state.schema.json" });
  }
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^sample\b.*\.json$/.test(n)) : []) {
    if (!(SAMPLE_FILES as string[]).includes(f)) {
      issues.push({ rule: "format.sample", message: `${f} 不会被用到：示例数据要写成 sample.<语言>.json，语言只能是 ${BOT_LANGS.join("、")}`, file: f });
      continue;
    }
    try {
      const sample = readJson(path.join(dir, f));
      if (schema) for (const e of validate(sample, schema)) issues.push({ rule: "format.sample", message: `示例数据不符合约定：${e}`, file: f });
    } catch (e) {
      issues.push({ rule: "format.sample", message: `${f} 解析失败：${(e as Error).message}`, file: f });
    }
  }
  if (manifest && !manifest.permissions.includes("workspace-write")) issues.push({ rule: "permissions.state", message: "Bot 要改 app/state.json，permissions 必须有 workspace-write", file: "bot.json" });
  issues.push(...scanSkills(dir, manifest));
  issues.push(...lintUi(dir));
  issues.push(...checkKitVersion(dir, manifest));
  issues.push(...checkEvals(dir));
  issues.push(...checkCover(dir));
  if (!issues.some((i) => i.rule === "format.missing" || i.rule.endsWith("symlink"))) {
    const uiFiles = uiBundleFiles(dir);
    const rtFiles = runtimeBundleFiles(dir);
    // 客户端解包时也按这些上限拒绝（bundle.ts readBundle）。这里不拦的话，要到用户安装时才失败
    for (const [rule, what, files] of [["ui", "界面包", uiFiles], ["source", "运行包", rtFiles]] as const) {
      if (files.length > LIMITS.files) issues.push({ rule: `${rule}.files`, message: `${what}有 ${files.length} 个文件，上限 ${LIMITS.files}`, file: rule === "ui" ? "ui" : "skills" });
      const bytes = files.reduce((n, f) => n + f.data.length, 0);
      if (bytes > LIMITS.unpackedBytes) issues.push({ rule: `${rule}.unpacked`, message: `${what}解开后 ${Math.round(bytes / 1024 / 1024)} MB，上限 ${LIMITS.unpackedBytes / 1024 / 1024} MB`, file: rule === "ui" ? "ui" : "skills" });
    }
    const ui = packFiles(uiFiles).length;
    if (ui > LIMITS.uiBundleBytes) issues.push({ rule: "ui.size", message: `界面包压缩后 ${Math.round(ui / 1024)} KB，上限 ${LIMITS.uiBundleBytes / 1024} KB`, file: "ui" });
    const rt = packFiles(rtFiles).length;
    if (rt > LIMITS.runtimeBundleBytes) issues.push({ rule: "source.size", message: `运行包压缩后 ${Math.round(rt / 1024 / 1024)} MB，上限 ${LIMITS.runtimeBundleBytes / 1024 / 1024} MB`, file: "skills" });
  }
  return { manifest, issues };
}
