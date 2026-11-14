import { describe, expect, it } from "vitest";
import { templateCatalog, templateName, templateStrings } from "../src/templates/catalog.js";
import { validTopic, ENTRY_MAX } from "../src/agent/memory.js";
import { PICKABLE_AVATARS } from "../src/domain/bot-settings.js";
const languages = ["zh-CN", "en", "ja", "ko", "ru", "es", "pt"] as const;
describe("模板目录与七种语言", () => {
  it("十个稳定标识，头像不同、均可选且不用默认助手头像", () => {
    const catalog = templateCatalog();
    expect(catalog.map((x) => x.id)).toEqual(["writer", "polish", "work-report", "minutes", "day-planner", "digest", "researcher", "study-buddy", "coding-partner", "support"]);
    expect(new Set(catalog.map((x) => x.avatar)).size).toBe(10);
    for (const item of catalog) { expect(PICKABLE_AVATARS).toContain(item.avatar); expect(item.avatar).not.toBe("blue"); }
    expect(catalog.filter((x) => x.rule).map((x) => x.id)).toEqual(["work-report", "day-planner", "digest"]);
  });
  it.each(languages)("%s：人设、示例和初始记忆完整，主题名可实际写入", (language) => {
    const copy = templateStrings(language);
    for (const item of templateCatalog()) {
      const text = copy.roles[item.id]; expect(text.name.length).toBeLessThanOrEqual(60);
      expect(text.persona.length).toBeGreaterThan(50); expect(text.sample.length).toBeGreaterThan(10);
      if (item.memory) { expect(() => validTopic(text.memoryTitle!)).not.toThrow(); expect(text.memory?.length).toBeGreaterThan(0); for (const note of text.memory!) expect(note.length).toBeLessThanOrEqual(ENTRY_MAX); }
      if (item.rule) expect(text.rule?.instruction).toBeTruthy();
    }
  });
  it("后缀仅用于模板，保留60字上限，不截断代理对", () => {
    expect(templateName("Writer", ["Writer", "Writer 2"])).toBe("Writer 3");
    const long = "A".repeat(59) + "B";
    expect(templateName(long, [long])).toBe("A".repeat(58) + " 2");
    const unicode = "A".repeat(57) + "😀B";
    expect(templateName(unicode, [unicode])).toBe("A".repeat(57) + " 2");
  });
});

describe("模板模型推荐", () => {
  const load = async () => {
    // @ts-expect-error Native browser JS module.
    return await import("../ui/lib/templates.js");
  };
  const ids = ["a", "b", "c", "d", "e"];
  const info = Object.fromEntries(ids.map((id, i) => [id, { quality: { intelligence: i + 1, costPerTask: i + 1 }, factors: { balanced: 1 }, tools: true, reasoning: true, context: 1000 }]));
  it("共享五档的首中末，新手期跟随全局默认", async () => {
    const { recommendTemplate } = await load();
    for (const [tier, model] of [[0, "a"], [2, "c"], [4, "e"]]) expect(recommendTemplate({ tier }, ids, info, "balanced", "b").model).toBe(model);
    expect(recommendTemplate({ tier: 4 }, ids, info, "balanced", "b", true)).toMatchObject({ model: "", reason: "starter" });
  });
  it("硬性能力缺失回退且明确原因，不跳到别的档；未知不当作支持", async () => {
    const { recommendTemplate, capabilityState } = await load();
    const noTools = { ...info, e: { ...info.e, tools: false } };
    expect(recommendTemplate({ tier: 4, tools: true }, ids, noTools, "balanced", "b")).toMatchObject({ model: "", reason: "incompatible" });
    expect(capabilityState({ tools: true }, "unknown", info)).toBe("unknown");
    expect(recommendTemplate({ tier: 2 }, ["a", "b"], info, "balanced", "a").reason).toBe("unranked");
  });
  it("视觉优先，其后才比较上下文，同分档可选不在前沿上的兼容模型", async () => {
    const { recommendTemplate } = await load();
    const expanded = { ...info, e: { ...info.e, context: 10000, vision: false }, f: { ...info.e, context: 2000, vision: true, quality: { intelligence: 5, costPerTask: 6 } } };
    expect(recommendTemplate({ tier: 4, tools: true, vision: true, longContext: true }, [...ids, "f"], expanded, "balanced", "a").model).toBe("f");
  });
});
