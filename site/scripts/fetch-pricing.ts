// 构建时抓取 modelflare.dev/api/pricing → src/data/pricing.snapshot.json（§13.3）。
//   默认（定时任务用）：抓取或校验失败 → 退出码 1，不改快照，任务标红。
//   --lenient（普通构建用）：失败时沿用已提交的快照并标 stale=true，构建继续。
//   --from <file>：从本地文件读取原始数据（单测夹具、离线调试）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, SOURCE } from "../src/lib/snapshot";
import { pricingConfig } from "../src/data/pricing.config";
import type { Snapshot } from "../src/lib/pricing";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "src/data/pricing.snapshot.json");
const args = process.argv.slice(2);
const lenient = args.includes("--lenient");
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;

async function fetchRaw(): Promise<unknown> {
  if (from) return JSON.parse(fs.readFileSync(from, "utf8"));
  const waits = [1000, 3000, 9000];
  let last: unknown;
  for (let i = 0; i <= waits.length; i++) {
    try {
      const res = await fetch(SOURCE, { headers: { "User-Agent": "anymodelbot-site-build" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < waits.length) await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
  throw last;
}

/** 精选模型的默认线路价相对上一版变化超过 5 倍 → 视为数据异常 */
function sanity(next: Snapshot, prev: Snapshot | null) {
  if (next.counts.text < 30) throw new Error(`文本模型只有 ${next.counts.text} 个（应 ≥ 30）`);
  if (!prev) return;
  for (const id of pricingConfig.featuredModels) {
    const a = prev.rows.find((r) => r.model === id);
    const b = next.rows.find((r) => r.model === id)!;
    if (!a) continue;
    for (const k of ["input", "output"] as const) {
      const ratio = b[k] / a[k];
      if (!(ratio <= 5 && ratio >= 0.2)) throw new Error(`${id} ${k} 价格从 ${a[k]} 变为 ${b[k]}（超过 5 倍）`);
    }
  }
}

const prev: Snapshot | null = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
try {
  const snap = buildSnapshot(await fetchRaw(), pricingConfig, new Date());
  sanity(snap, prev);
  fs.writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
  console.log(`价格快照已更新：${snap.pricingVersion}，${snap.counts.models} 个模型（文本 ${snap.counts.text}），抓取于 ${snap.fetchedAt}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!lenient || !prev) {
    console.error(`价格抓取失败：${msg}`);
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify({ ...prev, stale: true }, null, 2) + "\n");
  console.warn(`价格抓取失败，沿用 ${prev.fetchedAt} 的快照（stale）：${msg}`);
}
