import type { PricingConfig } from "../lib/pricing";

export const pricingConfig: PricingConfig = {
  featuredModels: ["gpt-5.6-sol", "gpt-6.1-terra", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "deepseek-v4-flash"],
  sampleModel: "gpt-5.6-sol",
  sampleUsage: { days: 30, msgs: 50, inTok: 3000, outTok: 600 },
};

/** 示例人设配的模型（§6.9，可在 App 里随时更换） */
export const personaModels = {
  pair: "claude-sonnet-5-5",
  expenses: "gpt-5.6-sol",
  secretary: "deepseek-v4-flash",
  german: "gemini-3.5-flash",
  editor: "claude-opus-5-5",
  home: "claude-haiku-5-5",
} as const;

/** 模型演示的三个场景（§6.4） */
export const demoModels = { copy: "claude-sonnet-5-5", code: "gpt-5.6-sol", research: "gemini-3.5-flash" } as const;
