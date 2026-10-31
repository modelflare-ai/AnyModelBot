// zh / en 文案 key 一致性（§14）：结构、数组长度都要一致。
import { zh } from "../src/i18n/zh";
import { en } from "../src/i18n/en";

const diffs: string[] = [];
function cmp(a: unknown, b: unknown, p: string) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { diffs.push(`${p}：数组长度不同`); return; }
    a.forEach((x, i) => cmp(x, b[i], `${p}[${i}]`));
  } else if (a && typeof a === "object") {
    if (!b || typeof b !== "object") { diffs.push(`${p}：类型不同`); return; }
    const ka = Object.keys(a), kb = Object.keys(b);
    for (const k of ka) if (!kb.includes(k)) diffs.push(`${p}.${k}：en 缺少`);
    for (const k of kb) if (!ka.includes(k)) diffs.push(`${p}.${k}：zh 缺少`);
    for (const k of ka) if (kb.includes(k)) cmp((a as any)[k], (b as any)[k], `${p}.${k}`);
  } else if (typeof a !== typeof b) diffs.push(`${p}：类型不同`);
  else if (typeof a === "string") {
    const va = [...a.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(","), vb = [...(b as string).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (va !== vb) diffs.push(`${p}：变量不同（${va} / ${vb}）`);
  }
}
cmp(zh, en, "dict");
if (diffs.length) { console.error(diffs.join("\n")); process.exit(1); }
console.log("zh / en 文案 key 一致");
