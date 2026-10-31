/**
 * 模型选择器里的能力与参考价：
 * - 能力来自 GET {线路}/v1/model-profiles（带 Key；上下文、视觉、工具调用、推理）。
 * - 价格与模型支持的接口来自公开价格目录 GET https://modelflare.dev/api/pricing（不带 Key，国内线路不开放）。
 *   只算按 token 计费和按次计费的模型：价格 = 基础价 × 该模型可用公开分组里最低的分组倍率 ×
 *   模型售价倍率，单位美元 / 百万 tokens（按次为美元 / 次）。这是“起步参考价”，实际以账单为准；
 *   阶梯计费、图片、视频等复杂计费不展示价格。
 */
export interface ModelInfo {
  context?: number;
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  price?: { input?: number; output?: number; perCall?: number };
  /** 支持的接口（目录的 supported_endpoint_types：openai、openai-response、openai-response-compact、anthropic、gemini…） */
  endpoints?: string[];
}

interface Profile {
  context_window?: number;
  input_modalities?: string[];
  tool_calling?: boolean;
  reasoning?: boolean;
}

export interface PricingEntry {
  model_name: string;
  context_window?: number;
  quota_type: number;
  input_price?: number;
  model_ratio?: number;
  model_price?: number;
  completion_ratio?: number;
  enable_groups?: string[];
  billing_mode?: string;
  pricing_rules?: unknown;
  sale_price_multiplier?: number;
  supported_endpoint_types?: string[];
}

export interface PricingCatalog {
  data?: PricingEntry[];
  group_ratio?: Record<string, number>;
  usable_group?: Record<string, unknown>;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** 一个模型的起步参考价；算不出来（复杂计费、没有可用分组）时 undefined */
export function referencePrice(entry: PricingEntry, catalog: PricingCatalog): ModelInfo["price"] {
  if (entry.billing_mode || entry.pricing_rules) return undefined;
  const ratios = (entry.enable_groups ?? [])
    .filter((g) => !catalog.usable_group || g in catalog.usable_group)
    .map((g) => catalog.group_ratio?.[g])
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r >= 0);
  if (!ratios.length) return undefined;
  const sale = Number(entry.sale_price_multiplier) > 0 ? Number(entry.sale_price_multiplier) : 1;
  const factor = Math.min(...ratios) * sale;
  if (entry.quota_type === 1) return typeof entry.model_price === "number" ? { perCall: round(entry.model_price * factor) } : undefined;
  if (entry.quota_type !== 0) return undefined;
  const base = typeof entry.input_price === "number" ? entry.input_price : Number(entry.model_ratio) * 2;
  if (!Number.isFinite(base)) return undefined;
  const output = Number(entry.completion_ratio);
  return { input: round(base * factor), ...(Number.isFinite(output) ? { output: round(base * output * factor) } : {}) };
}

export async function loadModelInfo(o: {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  pricingUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, ModelInfo>> {
  const f = o.fetchImpl ?? fetch;
  const get = async <T>(url: string, headers: Record<string, string>): Promise<T | undefined> => {
    try {
      const res = await f(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(10_000) });
      return res.ok ? ((await res.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  };
  const [profiles, catalog] = await Promise.all([
    o.apiKey ? get<{ data?: Record<string, Profile> }>(`${o.baseUrl}/model-profiles`, { Authorization: `Bearer ${o.apiKey}`, ...o.headers }) : undefined,
    get<PricingCatalog>(o.pricingUrl, {}),
  ]);
  const out: Record<string, ModelInfo> = {};
  for (const [id, p] of Object.entries(profiles?.data ?? {})) {
    out[id] = {
      ...(p.context_window ? { context: p.context_window } : {}),
      ...(p.input_modalities ? { vision: p.input_modalities.includes("image") } : {}),
      ...(typeof p.tool_calling === "boolean" ? { tools: p.tool_calling } : {}),
      ...(typeof p.reasoning === "boolean" ? { reasoning: p.reasoning } : {}),
    };
  }
  for (const entry of catalog?.data ?? []) {
    const price = referencePrice(entry, catalog!);
    if (price) out[entry.model_name] = { ...out[entry.model_name], price };
    // 没有 Key（拿不到 model-profiles）时，上下文长度用公开目录里的
    if (Number(entry.context_window) > 0 && !out[entry.model_name]?.context) out[entry.model_name] = { ...out[entry.model_name], context: Number(entry.context_window) };
    if (Array.isArray(entry.supported_endpoint_types)) out[entry.model_name] = { ...out[entry.model_name], endpoints: entry.supported_endpoint_types.map(String) };
  }
  return out;
}
