// 模型 ID 的显示与分组（不依赖界面，单元测试直接引入）。

/** 内置网关列出的模型带 "modelflare/" 前缀，Modelflare 直接列出的不带；两种写法都能调用，显示与比较时去掉它 */
export const normModel = (m) => (m && m.startsWith("modelflare/") ? m.slice("modelflare/".length) : m || "");
export const sameModel = (a, b) => !!a && !!b && normModel(a) === normModel(b);
export const shortModel = (m) => (m && m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m);

// —— 模型族：按名字认（Modelflare 的 ID 不带厂商前缀，如 gpt-6-sol、claude-opus-5-5）。数组顺序就是显示顺序，认不出的归 OTHER_FAMILY 放最后 ——
const FAMILIES = [
  ["GPT", /^(gpt|chatgpt|codex|o\d)/],
  ["Claude", /^claude/],
  ["Gemini", /^gemini/],
  ["Grok", /^grok/],
  ["DeepSeek", /^deepseek/],
  ["Qwen", /^(qwen|qwq)/],
  ["Kimi", /^(kimi|moonshot)/],
  ["GLM", /^(glm|chatglm)/],
  ["MiniMax", /^(minimax|abab)/],
  ["Doubao", /^(doubao|seed)/],
  ["Llama", /^llama/],
  ["Mistral", /^(mistral|mixtral|magistral|codestral|devstral|ministral)/],
];
/** 认不出的族：一个不随语言变的记号，显示时由界面翻译（model-picker.js 的 familyName，「其他」/ Other） */
export const OTHER_FAMILY = "other";
const ORDER = [...FAMILIES.map(([f]) => f), OTHER_FAMILY];

export function modelFamily(id) {
  const n = (shortModel(normModel(id)) || "").toLowerCase();
  return FAMILIES.find(([, re]) => re.test(n))?.[0] ?? OTHER_FAMILY;
}

/** 名字里第一个版本号（5-5、6.1、v4.1、qwen3.8）读成数字数组；4 位以上的数字是日期之类，到此为止 */
function version(id) {
  const m = id.match(/\d+(?:[.-]\d+)*/);
  const out = [];
  for (const p of m ? m[0].split(/[.-]/) : []) {
    if (p.length > 3) break;
    out.push(Number(p));
  }
  return out;
}

/** 族内排序：版本新的在前（6.1 > 6 > 5.6），同版本按名字 */
function newerFirst(a, b) {
  const x = version(a);
  const y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1);
    if (d) return d;
  }
  return a.localeCompare(b);
}

/** 按模型族分组并按 q 筛选；返回 [族名, [[原始 id, 显示名]]]，族按固定顺序 */
export function groupModels(models, q = "") {
  const needle = q.trim().toLowerCase();
  const groups = new Map();
  for (const m of models) {
    const n = normModel(m);
    if (needle && !n.toLowerCase().includes(needle)) continue;
    const f = modelFamily(m);
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push([m, n.includes("/") ? n.slice(n.indexOf("/") + 1) : n]);
  }
  for (const ms of groups.values()) ms.sort((a, b) => newerFirst(a[1], b[1]));
  return [...groups.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
}
