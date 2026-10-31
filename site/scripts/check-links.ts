// 站内链接检查：dist/ 里每个站内 href 都要指向存在的页面或文件，页内锚点都要有对应 id。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const pages: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith(".html")) pages.push(p);
  }
})(dist);

const exists = (url: string) => {
  const p = path.join(dist, decodeURIComponent(url));
  return [p, path.join(p, "index.html"), `${p}.html`].some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
};
const htmlOf = (url: string) => {
  const p = path.join(dist, url);
  const f = [path.join(p, "index.html"), `${p}.html`, p].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  return f ? fs.readFileSync(f, "utf8") : "";
};
const bad: string[] = [];
for (const page of pages) {
  const html = fs.readFileSync(page, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const rel = path.relative(dist, page);
  for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|data:|\{)/.test(href)) continue;
    const [p, hash] = href.split("#");
    const target = p ? p.split("?")[0] : null;
    if (target && !exists(target)) { bad.push(`${rel} → ${href}（页面不存在）`); continue; }
    if (hash) {
      const doc = target ? htmlOf(target) : html;
      if (!doc.includes(`id="${hash}"`)) bad.push(`${rel} → ${href}（锚点不存在）`);
    }
  }
}
if (bad.length) { console.error(`✗ 站内链接 ${bad.length} 处失效：\n  ${[...new Set(bad)].join("\n  ")}`); process.exit(1); }
console.log(`站内链接检查通过（${pages.length} 个页面）`);
