import sourceExceptions from "../src/i18n/source-exceptions.json";
// zh / en 文案 key 一致性（§14）：结构、数组长度都要一致。
import { zh } from "../src/i18n/zh";
import { RAW_DICTS } from "../src/i18n/catalogs";
import { LANGS, LOCALES, READY_LANGS } from "../src/i18n/locales";
import { CHANNELS } from "../src/data/channels";
import { ANNOUNCEMENTS } from "../src/data/announcements";
import fs from "node:fs";

const diffs: string[] = [];
function cmp(a: unknown, b: unknown, p: string) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { diffs.push(`${p}：数组长度不同`); return; }
    a.forEach((x, i) => cmp(x, b[i], `${p}[${i}]`));
  } else if (a && typeof a === "object") {
    if (!b || typeof b !== "object") { diffs.push(`${p}：类型不同`); return; }
    const ka = Object.keys(a), kb = Object.keys(b);
    for (const k of ka) if (!kb.includes(k)) diffs.push(`${p}.${k}：缺少译文`);
    for (const k of kb) if (!ka.includes(k)) diffs.push(`${p}.${k}：多余的键`);
    for (const k of ka) if (kb.includes(k)) cmp((a as any)[k], (b as any)[k], `${p}.${k}`);
  } else if (typeof a !== typeof b) diffs.push(`${p}：类型不同`);
  else if (typeof a === "string") {
    const prefix = p.indexOf(".");
    const translated = !["zh", "en"].includes(p.slice(0, prefix));
    if (translated && a.trim() && !(b as string).trim()) diffs.push(`${p}：空译文`);
    const exception = (sourceExceptions as Record<string, { value: string; reason: string }>)[p.slice(prefix + 1)];
    if (translated && !(exception?.value === a && exception.reason) && a === b && a.length > 18 && /[A-Za-z]{3,}\s+[a-z]{3,}/.test(a) && !/[`{}<>]|https?:\/\//.test(a)) diffs.push(`${p}：尚未翻译的英文正文`);
    const va = [...a.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(","), vb = [...(b as string).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (va !== vb) diffs.push(`${p}：变量不同（${va} / ${vb}）`);
  }
}
const selected = process.argv.includes("--release") ? LANGS : READY_LANGS;
for (const lang of selected) cmp(lang === "zh" || lang === "en" ? zh : RAW_DICTS.en, RAW_DICTS[lang], lang);
for (const lang of selected.filter((l) => !["zh", "en"].includes(l))) {
  if ((RAW_DICTS[lang] as any).meta?.lang !== LOCALES[lang].tag) diffs.push(`${lang}.meta.lang：HTML 语言标记错误`);
  cmp(CHANNELS.en, CHANNELS[lang], `${lang}.channels`);
  CHANNELS[lang].forEach((channel, i) => {
    if (channel.id !== CHANNELS.en[i]?.id || channel.icon !== CHANNELS.en[i]?.icon) diffs.push(`${lang}.channels[${i}]：技术标识不能翻译`);
  });
  ANNOUNCEMENTS.forEach((a) => cmp(a.en, a[lang], `${lang}.announcements.${a.id}`));
  for (const kind of ["changelog", "third-party"]) {
    const url = new URL(`../src/data/${kind}.${lang}.md`, import.meta.url);
    if (!fs.existsSync(url) || !fs.readFileSync(url, "utf8").trim()) diffs.push(`${lang}.${kind}：缺少文档`);
  }
  const image = (RAW_DICTS[lang] as any).meta?.ogImage;
  if (!image || !fs.existsSync(new URL(`../public${image}`, import.meta.url))) diffs.push(`${lang}.meta.ogImage：缺少分享图片`);
}
if (diffs.length) { console.error(diffs.join("\n")); process.exit(1); }
console.log(`${selected.join(" / ")} 文案 key 一致`);
