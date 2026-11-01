// 更新日志页（views/ChangelogView.astro）：把仓库根目录的 CHANGELOG 解析成版本列表。原文由 sync-from-app 同步到 data/。
// 只认更新日志用到的那点 Markdown：## 版本 - 日期、### 分组、- 条目、**粗体**、`代码`。
export interface ChangelogRelease {
  version: string;
  date: string;
  groups: { title: string; items: string[] }[];
}

/** 条目转成 HTML：先转义，内容来自仓库里的文件，也不留任何原始 HTML */
export function inlineHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const out: ChangelogRelease[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const release = /^## +(\S+)(?: +- +(\S+))?/.exec(line);
    const current = out[out.length - 1];
    if (release) out.push({ version: release[1], date: release[2] ?? "", groups: [] });
    else if (current && line.startsWith("### ")) current.groups.push({ title: line.slice(4).trim(), items: [] });
    else if (current && line.startsWith("- ")) {
      if (!current.groups.length) current.groups.push({ title: "", items: [] });
      current.groups[current.groups.length - 1].items.push(inlineHtml(line.slice(2)));
    }
  }
  return out;
}
