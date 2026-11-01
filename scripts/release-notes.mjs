#!/usr/bin/env node
/**
 * 发布说明：从 CHANGELOG.md 和 CHANGELOG_en.md 取出这个版本的那一段，中文在前。
 * .github/workflows/release.yml 用它；开始打包前就检查一次，这个版本没写更新日志就直接失败，不会发出空说明。
 *
 * 用法：node scripts/release-notes.mjs <版本号>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 取出 "## <版本> - 日期" 下面到下一个 "## " 之前的内容；没有或是空的回 undefined */
export function changelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const head = (line) => /^## /.test(line);
  const start = lines.findIndex((line) => head(line) && line.slice(3).trim().split(/\s+/)[0].replace(/^v/, "") === version);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(head);
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body || undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if (!version) {
    console.error("usage: release-notes.mjs <version>");
    process.exit(2);
  }
  const parts = [];
  for (const file of ["CHANGELOG.md", "CHANGELOG_en.md"]) {
    const section = changelogSection(fs.readFileSync(path.join(root, file), "utf8"), version);
    if (!section) {
      console.error(`${file} has no entry for ${version}. Write it before tagging the release.`);
      process.exit(1);
    }
    parts.push(section);
  }
  process.stdout.write(`${parts.join("\n\n---\n\n")}\n`);
}
