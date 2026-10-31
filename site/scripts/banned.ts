// 禁词扫描（附录 B）：源码文案（src/i18n、src/data、src/pages、src/sections、src/views、src/components、src/islands）与 --dist 时的 dist 文本。命中即失败。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const BANNED: [RegExp, string][] = [
  [/绝对(的)?(数据)?安全|100% ?安全|零风险|军事级|银行级/, "安全夸大"],
  [/零遥测|不收集任何数据|不上传任何数据|zero[- ]telemetry(?!”|")|absolutely secure|military[- ]grade|bank[- ]grade/i, "安全/遥测夸大"],
  [/离线可用|本地大模型|works offline(?!\?)/i, "离线/本地模型"],
  [/全平台|全设备|支持 ?iOS ?和 ?Android/, "平台夸大"],
  [/最便宜|最划算|省\s?\d+\s?%|比.{0,12}便宜|cheapest|save \d+%/i, "价格比较"],
  [/Modelflare\s?(没有|无)(订阅|月费)|Modelflare (has )?no subscription/i, "Modelflare 订阅主语"],
  [/每次操作都会先征求你同意|asks? before every action/i, "审批夸大"],
  [/7\s?[×x]\s?24 ?自动|定时任务|教它一遍|多机器人协同|scheduled tasks|teach it once/i, "未实现能力"],
  [/群聊支持|supports group chats/i, "群聊"],
];
// "零遥测"在安全页里是以否定形式出现的（我们不声称零遥测）——允许"不声称“零遥测”"这一种写法
// 竞品（Grok Bot、OpenAI dots、Claude Duet）可以用文字名称做对比；仍不用它们的 Logo、配色和素材。
const ALLOW = [/不声称“零遥测”/, /don't claim “zero telemetry”/];

function walk(dir: string, exts: string[], out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const dist = process.argv.includes("--dist");
const files = dist
  ? walk(path.join(root, "dist"), [".html", ".xml", ".txt"])
  : ["src/i18n", "src/data", "src/pages", "src/sections", "src/views", "src/components", "src/islands", "src/layouts"].flatMap((d) => walk(path.join(root, d), [".ts", ".tsx", ".astro"]));

let hits = 0;
for (const f of files) {
  let text = fs.readFileSync(f, "utf8");
  if (dist) text = text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  for (const a of ALLOW) text = text.replace(new RegExp(a.source, "g"), "");
  for (const [re, why] of BANNED) {
    const m = text.match(re);
    if (m) { hits++; console.error(`✗ ${path.relative(root, f)}：「${m[0]}」（${why}）`); }
  }
}
if (hits) { console.error(`禁词扫描：${hits} 处命中`); process.exit(1); }
console.log(`禁词扫描通过（${files.length} 个文件）`);
