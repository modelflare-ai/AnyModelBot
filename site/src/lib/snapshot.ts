// 原始价格数据 → 快照（构建脚本与单测共用）
import { estimate } from "./calc";
import { fmtMoney } from "./calc";
import { deriveRows, fmtPrice, Pricing, type PricingConfig, type Snapshot } from "./pricing";

export const SOURCE = "https://modelflare.dev/api/pricing";

/** 2026-10-30T21:24:41+08:00：时间一律按 UTC+8 写 */
export function isoUtc8(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19);
  return `${t}+08:00`;
}

export function buildSnapshot(input: unknown, cfg: PricingConfig, now: Date): Snapshot {
  const raw = Pricing.parse(input);
  const rows = deriveRows(raw);
  for (const id of [...cfg.featuredModels, cfg.sampleModel]) {
    if (!rows.some((r) => r.model === id)) throw new Error(`精选模型 ${id} 不在价格数据里`);
  }
  const sm = rows.find((r) => r.model === cfg.sampleModel) ?? rows.find((r) => r.model === cfg.featuredModels[0])!;
  const u = cfg.sampleUsage;
  const est = estimate(sm, { group: sm.defaultGroup, msgs: u.msgs, inTok: u.inTok, outTok: u.outTok }, u.days);
  const text = rows.length;
  const usedVendors = new Set(raw.data.map((m) => m.vendor_id));
  return {
    fetchedAt: isoUtc8(now),
    pricingVersion: raw.pricing_version,
    source: SOURCE,
    stale: false,
    counts: { models: raw.data.length, text, media: raw.data.length - text, vendors: raw.vendors.filter((v) => usedVendors.has(v.id)).length },
    vendors: raw.vendors.filter((v) => usedVendors.has(v.id)).map((v) => v.name),
    config: { featuredModels: cfg.featuredModels, sampleModel: sm.model, sampleUsage: cfg.sampleUsage },
    rows,
    sample: {
      model: sm.model,
      input: fmtPrice(sm.input),
      output: fmtPrice(sm.output),
      officialIn: fmtPrice(sm.officialInput),
      officialOut: fmtPrice(sm.officialOutput),
      monthly: fmtMoney(est.monthly),
    },
  };
}
