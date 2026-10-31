// 价格规则单测：固定使用 2026-10-30 抓取的原始数据（§6.5 C / D 的验收值）
import { describe, expect, it } from "vitest";
import raw from "./fixtures/pricing-2026-10-30.json";
import { buildSnapshot } from "../src/lib/snapshot";
import { pricingConfig } from "../src/data/pricing.config";
import { estimate, fmtMoney, fmtSmall, PRESETS, calcGroups } from "../src/lib/calc";
import { fmtPrice, tierFor } from "../src/lib/pricing";

const snap = buildSnapshot(raw, pricingConfig, new Date("2026-10-30T13:24:41Z"));
const row = (m: string) => snap.rows.find((r) => r.model === m)!;

describe("快照", () => {
  it("计数与时间", () => {
    expect(snap.fetchedAt).toBe("2026-10-30T21:24:41+08:00");
    expect(snap.counts).toEqual({ models: 70, text: 41, media: 29, vendors: 13 });
    expect(snap.pricingVersion).toBe("20260821-gemini-image-resolution-v1");
  });
  it("示例模型", () => {
    expect(snap.sample).toEqual({ model: "gpt-5.6-sol", input: "$0.4", output: "$2.4", officialIn: "$5", officialOut: "$30", monthly: "$3.96" });
  });
});

describe("精选行（默认线路，USD / 1M tokens）", () => {
  const cases: [string, string, number, number, number, number, number][] = [
    ["gpt-5.6-sol", "openai-stable", 0.4, 2.4, 5, 30, 0.08],
    ["gpt-6.1-terra", "openai-stable", 0.08, 0.4, 1, 5, 0.08],
    ["claude-opus-5-5", "claude-stable", 1.26, 6.3, 4, 20, 0.315],
    ["claude-sonnet-5-5", "claude-stable", 0.63, 3.15, 2, 10, 0.315],
    ["claude-haiku-5-5", "claude-stable", 0.0315, 0.1575, 0.1, 0.5, 0.315],
    ["deepseek-v4-flash", "deepseek-stable", 0.257143, 0.771429, 0.428571, 1.285714, 0.6],
  ];
  it.each(cases)("%s", (m, g, i, o, oi, oo, ratio) => {
    const r = row(m);
    expect(r.defaultGroup).toBe(g);
    expect([r.input, r.output, r.officialInput, r.officialOutput, r.ratio]).toEqual([i, o, oi, oo, ratio]);
  });
  it("gpt-5.6-sol 全部线路", () => {
    const gs = row("gpt-5.6-sol").groups.map((g) => [g.id, g.ratio, g.input, g.output, g.conditional?.minTopupUSD ?? null]);
    expect(gs).toEqual([
      ["openai-award", 0.03, 0.15, 0.9, null],
      ["openai-stable", 0.08, 0.4, 2.4, null],
      ["openai-premium", 0.13, 0.65, 3.9, null],
      ["openai-enterprise", 0.5, 2.5, 15, null],
      ["openai-first-topup", 0.015, 0.075, 0.45, 20],
    ]);
  });
  it("分档阈值", () => {
    expect(tierFor(row("gpt-5.6-sol"), 272_000).label).toBe("standard");
    expect(tierFor(row("gpt-5.6-sol"), 272_001).label).toBe("long_context");
    expect(row("claude-haiku-5-5").tiers[0].maxInputTokens).toBe(100_000);
  });
});

describe("官方价规则（与 modelflare.dev/pricing 前端一致）", () => {
  it("没有 official_input_price 时用基础价", () => {
    const r = row("deepseek-v4-flash");
    expect([r.officialInput, r.officialOutput]).toEqual([0.428571, 1.285714]);
  });
  it("有 official_input_price 时用它，输出 × official_completion_ratio", () => {
    const data = structuredClone(raw) as any;
    const m = data.data.find((x: any) => x.model_name === "claude-opus-5-5");
    m.official_input_price = 5; m.official_completion_ratio = 6;
    const r = buildSnapshot(data, pricingConfig, new Date()).rows.find((x) => x.model === "claude-opus-5-5")!;
    expect([r.officialInput, r.officialOutput]).toEqual([5, 30]);
  });
});

describe("全部文本模型", () => {
  it("都有默认线路，且默认线路不是条件价", () => {
    for (const r of snap.rows) {
      const d = r.groups.find((g) => g.id === r.defaultGroup)!;
      expect(d, r.model).toBeTruthy();
      expect(d.conditional, r.model).toBeUndefined();
      expect(Number.isFinite(r.input) && Number.isFinite(r.output), r.model).toBe(true);
    }
  });
  it("条件价线路都带解锁金额", () => {
    const cond = snap.rows.flatMap((r) => r.groups.filter((g) => g.conditional));
    expect(cond.length).toBeGreaterThan(0);
    for (const g of cond) expect(g.conditional!.minTopupUSD).toBeGreaterThan(0);
    expect(row("claude-opus-5-5").groups.find((g) => g.conditional)!.conditional!.minTopupUSD).toBe(50);
  });
});

describe("计算器（30 天，默认线路）", () => {
  const vec: [string, number, number, number, number][] = [
    ["gpt-5.6-sol", 0.67, 3.96, 69.6, 49.5],
    ["gpt-6.1-terra", 0.12, 0.72, 13.2, 9],
    ["claude-opus-5-5", 1.89, 11.34, 207.9, 36],
    ["claude-sonnet-5-5", 0.95, 5.67, 103.95, 18],
    ["claude-haiku-5-5", 0.05, 0.28, 5.2, 0.9],
    ["deepseek-v4-flash", 0.29, 1.85, 37.8, 3.09],
  ];
  it.each(vec)("%s", (m, light, every, heavy, official) => {
    const r = row(m);
    const run = (p: (typeof PRESETS)[keyof typeof PRESETS]) => estimate(r, { group: r.defaultGroup, ...p });
    // 页面显示的是两位小数（与 §6.5 D 的验收表逐格一致）
    expect([run(PRESETS.light), run(PRESETS.everyday), run(PRESETS.heavy)].map((e) => fmtMoney(e.monthly))).toEqual([light, every, heavy].map(fmtMoney));
    const o = run(PRESETS.everyday).official;
    expect(fmtMoney(o)).toBe(fmtMoney(official!));
  });
  it("分项与每条", () => {
    const r = row("gpt-5.6-sol");
    const e = estimate(r, { group: r.defaultGroup, ...PRESETS.everyday });
    expect([fmtMoney(e.input), fmtMoney(e.output), fmtSmall(e.perMsg)]).toEqual(["$1.80", "$2.16", "$0.00264"]);
  });
  it("award 线路可选，条件价不可选", () => {
    expect(calcGroups(row("gpt-5.6-sol")).map((g) => g.id)).toEqual(["openai-stable", "openai-award"]);
    const r = row("gpt-5.6-sol");
    expect(estimate(r, { group: "openai-first-topup", ...PRESETS.everyday }).monthly).toBeCloseTo(3.96, 2);
  });
});

describe("格式", () => {
  it("价格", () => {
    expect([fmtPrice(0.0315), fmtPrice(0.2571428571), fmtPrice(1.26), fmtPrice(0.39999999999999997)]).toEqual(["$0.0315", "$0.257143", "$1.26", "$0.4"]);
  });
  it("金额", () => {
    expect([fmtMoney(0.004), fmtMoney(3.955), fmtMoney(1234.5)]).toEqual(["< $0.01", "$3.96", "$1,234.50"]);
  });
});
