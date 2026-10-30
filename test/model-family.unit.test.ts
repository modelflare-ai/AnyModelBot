/** 模型选择器的模型族分组：Modelflare 的 ID 不带厂商前缀，按名字归族，族内版本新的在前。 */
import { describe, it, expect } from "vitest";
// @ts-expect-error 界面代码是不经构建的 JS
import { groupModels, modelFamily } from "../ui/lib/models.js";

// Modelflare 2026-10-30 公开的对话模型（节选）
const LIST = [
  "claude-fable-5", "claude-fable-5-1", "claude-haiku-4-5", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5",
  "codex-auto-review", "deepseek-v4-flash", "deepseek-v4.1-flash", "gemini-3.1-pro-preview", "gemini-3.8-flash",
  "glm-5.3", "gpt-5.4", "gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol", "grok-4.5", "grok-4.7", "kimi-k3", "muse-spark-1.3", "qwen3.8-max",
];

describe("模型族", () => {
  it("按名字认族；认不出的归「其他」，带 modelflare/ 前缀也一样", () => {
    expect(modelFamily("gpt-6-sol")).toBe("GPT");
    expect(modelFamily("o3-mini")).toBe("GPT");
    expect(modelFamily("codex-auto-review")).toBe("GPT");
    expect(modelFamily("modelflare/claude-opus-5-5")).toBe("Claude");
    expect(modelFamily("qwen3.8-max")).toBe("Qwen");
    expect(modelFamily("kimi-k3")).toBe("Kimi");
    expect(modelFamily("muse-spark-1.3")).toBe("其他");
  });

  it("族按固定顺序，「其他」最后；族内版本新的在前，同版本按名字", () => {
    const g = groupModels(LIST);
    expect(g.map(([f]: [string]) => f)).toEqual(["GPT", "Claude", "Gemini", "Grok", "DeepSeek", "Qwen", "Kimi", "GLM", "其他"]);
    const of = (f: string) => g.find(([x]: [string]) => x === f)[1].map(([, label]: [string, string]) => label);
    expect(of("GPT")).toEqual(["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.4", "codex-auto-review"]);
    expect(of("Claude")).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5", "claude-opus-5", "claude-haiku-4-5"]);
    expect(of("DeepSeek")).toEqual(["deepseek-v4.1-flash", "deepseek-v4-flash"]);
  });

  it("日期后缀不当版本号；筛选只留匹配的族", () => {
    const g = groupModels(["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-opus-4-1"]);
    expect(g[0][1].map(([m]: [string]) => m)).toEqual(["claude-opus-4-1", "claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"]);
    expect(groupModels(LIST, "flash").map(([f]: [string]) => f)).toEqual(["Gemini", "DeepSeek"]);
  });
});
