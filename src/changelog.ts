/**
 * 更新日志（CHANGELOG*.md）给"更新了什么"弹窗用：解析成版本列表，按界面语言取对应的文件。
 * - 本机这一版和更早的：读安装包里的 CHANGELOG（随应用打包，不联网）。
 * - 还没装的新版本（升级前看看更新了什么）：用户点开时才去取那个版本标签下的 CHANGELOG（raw.githubusercontent.com，
 *   和检查更新、下载安装包是同一个仓库），按版本和语言缓存在内存里。请求里不带账户和对话内容。
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeLang } from "./i18n/index.js";
import { findAppRoot } from "./magpie/supervisor.js";

const REPO = "modelflare-ai/AnyModelBot";
const TIMEOUT_MS = 10_000;

export interface ChangelogEntry {
  version: string;
  /** "## 0.1.29 - 2026-11-09" 里的日期；没写时为空 */
  date: string;
  /** 这一版下面的内容（Markdown，不含版本标题） */
  markdown: string;
}

/** 界面语言 → 文件名：简体中文是 CHANGELOG.md，其他是 CHANGELOG_<语言>.md；不认识的语言用英文 */
export function changelogFile(lang: string): string {
  const locale = normalizeLang(lang) ?? "en";
  return locale === "zh-CN" ? "CHANGELOG.md" : `CHANGELOG_${locale}.md`;
}

/** 按 "## <版本> - <日期>" 切开；版本号不是 x.y.z 的段落（比如"未发布"）跳过，内容为空的也跳过。新的在前，和文件里一样 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: { version: string; date: string; lines: string[] } | undefined;
  const flush = () => {
    const body = cur?.lines.join("\n").trim();
    if (cur && body) out.push({ version: cur.version, date: cur.date, markdown: body });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      flush();
      const m = /^##\s+v?(\d+\.\d+\.\d+)\s*(?:[-–—]\s*(\S+))?/.exec(line);
      cur = m ? { version: m[1], date: m[2] ?? "", lines: [] } : undefined;
    } else cur?.lines.push(line);
  }
  flush();
  return out;
}

/** 安装包里的更新日志；读不到（源码里删了、打包漏了）时回空列表，弹窗就说"暂时看不到" */
export function readLocalChangelog(lang: string, root = findAppRoot()): ChangelogEntry[] {
  try {
    return parseChangelog(fs.readFileSync(path.join(root, changelogFile(lang)), "utf8"));
  } catch {
    return [];
  }
}

const remote = new Map<string, Promise<ChangelogEntry[]>>();

/** 某个已发布版本标签下的更新日志（升级前用）。取不到或里面没有这个版本时抛错，失败的不缓存 */
export function fetchChangelog(version: string, lang: string, fetchImpl: typeof fetch = fetch): Promise<ChangelogEntry[]> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return Promise.reject(new Error(`bad version ${version}`));
  const key = `${version}:${changelogFile(lang)}`;
  let p = remote.get(key);
  if (!p) {
    p = (async () => {
      const url = `https://raw.githubusercontent.com/${REPO}/v${version}/${changelogFile(lang)}`;
      const res = await fetchImpl(url, { headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = parseChangelog(await res.text());
      if (!entries.some((e) => e.version === version)) throw new Error(`no changelog entry for ${version}`);
      return entries;
    })();
    remote.set(key, p);
    p.catch(() => remote.delete(key));
  }
  return p;
}
