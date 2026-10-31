// 价格数据：把 modelflare.dev/api/pricing 的原始数据整理成页面用的行。
// 构建脚本（scripts/fetch-pricing.ts）、价格表、计算器和单测共用这一份规则，页面上不手写任何价格。
import { z } from "zod";

const Cond = z.object({ metric: z.string(), operator: z.string(), value: z.number() }).passthrough();
const Tier = z
  .object({
    label: z.string(),
    conditions: z.array(Cond).nullable(),
    unit_prices: z.object({ input: z.number(), output: z.number() }).passthrough(),
  })
  .passthrough();
const Model = z
  .object({
    model_name: z.string(),
    vendor_id: z.number().optional(),
    context_window: z.number().nullish(),
    input_price: z.number().nullish(),
    official_input_price: z.number().nullish(),
    official_completion_ratio: z.number().nullish(),
    completion_ratio: z.number().nullish(),
    billing_mode: z.string().nullish(),
    billing_unit: z.string().nullish(),
    enable_groups: z.array(z.string()),
    pricing_rules: z.object({ tiers: z.array(Tier).optional() }).passthrough().nullish(),
  })
  .passthrough();
const Group = z
  .object({
    id: z.string(),
    ratio: z.number(),
    default: z.boolean().optional(),
    kind: z.string().optional(),
    content_type: z.string().optional(),
    public: z.boolean().optional(),
  })
  .passthrough();
export const Pricing = z
  .object({
    pricing_version: z.string(),
    data: z.array(Model),
    group_ratio: z.record(z.number()),
    group_definitions: z.array(Group),
    vendors: z.array(z.object({ id: z.number(), name: z.string() }).passthrough()),
    first_topup_offers: z
      .array(z.object({ group: z.string(), minimum_topup_amount: z.number().optional(), ratio: z.number().optional() }).passthrough())
      .optional(),
  })
  .passthrough();
export type RawPricing = z.infer<typeof Pricing>;
type RawModel = RawPricing["data"][number];

export type GroupKind = "stable" | "award" | "campaign" | "enterprise" | "other";

export interface PriceTier { label: string; maxInputTokens: number | null; input: number; output: number }
export interface PriceGroup {
  id: string;
  kind: GroupKind;
  ratio: number;
  input: number;
  output: number;
  isDefault?: boolean;
  conditional?: { minTopupUSD: number };
}
export interface PriceRow {
  model: string;
  vendor: string;
  contextWindow: number | null;
  defaultGroup: string;
  /** 默认线路价，USD / 1M tokens（标准档） */
  input: number;
  output: number;
  /** 官方价：与 modelflare.dev/pricing 一致——有 official_input_price 用它，否则用基础价 */
  officialInput: number;
  officialOutput: number;
  ratio: number;
  /** 分档（无分档时为一档 standard，maxInputTokens = null） */
  tiers: PriceTier[];
  groups: PriceGroup[];
}

export interface PricingConfig {
  featuredModels: string[];
  sampleModel: string;
  sampleUsage: { days: number; msgs: number; inTok: number; outTok: number };
}

export interface PriceSample { model: string; input: string; output: string; officialIn: string; officialOut: string; monthly: string }

export interface Snapshot {
  fetchedAt: string;
  pricingVersion: string;
  source: string;
  stale: boolean;
  counts: { models: number; text: number; media: number; vendors: number };
  vendors: string[];
  config: Pick<PricingConfig, "featuredModels" | "sampleModel" | "sampleUsage">;
  rows: PriceRow[];
  sample: PriceSample;
}

export const isText = (m: RawModel) => m.billing_unit == null;

/** 6 位小数以内、去掉末尾 0：0.0315 / 0.257143 / 1.26 */
export const round6 = (n: number) => Number(n.toFixed(6));
export const fmtPrice = (n: number) => "$" + round6(n).toString();

function kindOf(id: string, def?: { kind?: string }): GroupKind {
  if (id.endsWith("-enterprise")) return "enterprise";
  const k = def?.kind;
  return k === "stable" || k === "award" || k === "campaign" ? k : "other";
}

export function deriveRows(raw: RawPricing): PriceRow[] {
  const defs = new Map(raw.group_definitions.map((g) => [g.id, g]));
  const offers = new Map((raw.first_topup_offers ?? []).map((o) => [o.group, o]));
  const vendors = new Map(raw.vendors.map((v) => [v.id, v.name]));
  // group_ratio 为准（group_ratio 与 group_definitions 的 id 偶有差异）；条件价线路的倍率在 first_topup_offers 里
  const ratioOf = (g: string) => raw.group_ratio[g] ?? offers.get(g)?.ratio ?? defs.get(g)?.ratio;

  return raw.data.filter(isText).map((m) => {
    const vendor = vendors.get(m.vendor_id ?? -1) ?? "—";
    const tiers = baseTiers(m);
    const std = tiers[0];
    const groups: PriceGroup[] = m.enable_groups
      .filter((g) => ratioOf(g) != null)
      .map((g) => {
        const ratio = ratioOf(g)!;
        const offer = offers.get(g);
        const out: PriceGroup = { id: g, kind: offer ? "campaign" : kindOf(g, defs.get(g)), ratio, input: round6(std.input * ratio), output: round6(std.output * ratio) };
        if (offer) out.conditional = { minTopupUSD: offer.minimum_topup_amount ?? 0 };
        return out;
      });
    const def = defaultGroup(groups, defs);
    groups.forEach((g) => g.id === def.id && (g.isDefault = true));
    groups.sort((a, b) => Number(!!a.conditional) - Number(!!b.conditional) || a.ratio - b.ratio);
    return {
      model: m.model_name,
      vendor,
      contextWindow: m.context_window ?? null,
      defaultGroup: def.id,
      input: def.input,
      output: def.output,
      ...officialOf(m, std),
      ratio: def.ratio,
      tiers,
      groups,
    };
  });
}

/** 默认线路：页面标 Default 的 → *-stable → 非活动、非 award 的最低倍率线路。条件价线路永远不做默认。 */
function defaultGroup(groups: PriceGroup[], defs: Map<string, { default?: boolean }>): PriceGroup {
  const open = groups.filter((g) => !g.conditional);
  const pick =
    open.find((g) => defs.get(g.id)?.default) ??
    open.find((g) => g.id.endsWith("-stable")) ??
    open.filter((g) => g.kind !== "campaign" && g.kind !== "award").sort((a, b) => a.ratio - b.ratio)[0];
  if (!pick) throw new Error(`没有可用的默认线路：${groups.map((g) => g.id).join(", ")}`);
  return pick;
}

/** 基础价（官方价）分档；tiered_expr 用 pricing_rules.tiers，否则 input_price 与 input_price × completion_ratio 一档 */
function baseTiers(m: RawModel): PriceTier[] {
  const t = m.pricing_rules?.tiers;
  if (m.billing_mode === "tiered_expr" && t?.length) {
    return t.map((x) => {
      const le = x.conditions?.find((c) => c.metric === "input_context_tokens" && (c.operator === "<=" || c.operator === "<"));
      const max = le ? (le.operator === "<" ? le.value - 1 : le.value) : null;
      return { label: x.label, maxInputTokens: max, input: x.unit_prices.input, output: x.unit_prices.output };
    });
  }
  if (m.input_price == null || m.completion_ratio == null) throw new Error(`${m.model_name} 缺少 input_price / completion_ratio`);
  return [{ label: "standard", maxInputTokens: null, input: m.input_price, output: m.input_price * m.completion_ratio }];
}

/** 官方价（modelflare.dev/pricing 的同一规则）：official_input_price > 0 时用它（输出 × official_completion_ratio ?? completion_ratio），否则用标准档基础价 */
function officialOf(m: RawModel, std: PriceTier) {
  const o = m.official_input_price;
  if (o != null && Number.isFinite(o) && o > 0) {
    return { officialInput: round6(o), officialOutput: round6(o * (m.official_completion_ratio ?? m.completion_ratio ?? 0)) };
  }
  return { officialInput: round6(std.input), officialOutput: round6(std.output) };
}

/** 单条请求的输入上下文落在哪一档（阈值按单条请求判断） */
export function tierFor(row: Pick<PriceRow, "tiers">, inTok: number): PriceTier {
  return row.tiers.find((t) => t.maxInputTokens == null || inTok <= t.maxInputTokens) ?? row.tiers[row.tiers.length - 1];
}
