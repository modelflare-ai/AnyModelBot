import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store/db.js";
import { MemoryStore, MemoryError, looksSecret, MEMORY_MAX, ENTRY_MAX } from "../src/agent/memory.js";
import { linesFor, shouldJudge, parseDecision, parseReview, recentTranscript } from "../src/agent/steward.js";
import { DEFAULT_SETTINGS, normalizeSettings, permissionMode } from "../src/agent/settings.js";
import {
  adaptSkill,
  bundledRoots,
  clientPath,
  CU_UNAVAILABLE,
  detectComputerUse,
  macAtLeast144,
  mcpPatchLines,
  type CuProbe,
} from "../src/agent/computer-use.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-p3-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("MemoryStore", () => {
  const bot = { kind: "bot" as const, id: "b1" };
  it("remember / dedupe / topic index / forget / journal", () => {
    const m = new MemoryStore(dir);
    expect(m.remember(bot, "用户喜欢简短回答", { source: "test" })).toContain("已记住");
    expect(m.remember(bot, "用户喜欢简短回答 ", { source: "test" })).toBe("这条已经记过了");
    m.remember(bot, "项目用 TypeScript", { source: "test", topic: "project" });
    expect(m.topics(bot)).toEqual(["project"]);
    expect(m.main(bot)).toContain("[[project]]");
    expect(m.search([bot], "typescript")).toHaveLength(1);
    expect(m.snapshot([bot])).toContain("用户喜欢简短回答");
    expect(m.forget(bot, "简短", { by: "test" })).toContain("已删除 1 条");
    expect(m.entries(bot)).toHaveLength(0);
    m.forget(bot, "TypeScript", { by: "test" });
    expect(m.topics(bot)).toEqual([]);
    const j = m.journalTail(10);
    expect(j.map((x) => x.op)).toEqual(["add", "add", "remove", "remove"]);
  });
  it("rejects secrets, oversize entries and a full MEMORY.md", () => {
    const m = new MemoryStore(dir);
    expect(looksSecret("我的密码是 hunter2")).toBe(true);
    expect(looksSecret("sk-abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
    expect(looksSecret("用户喜欢猫")).toBe(false);
    expect(() => m.remember(bot, "api key: sk-abcdefghijklmnopqrstuvwxyz0123", { source: "t" })).toThrow(MemoryError);
    expect(() => m.remember(bot, "长".repeat(ENTRY_MAX + 1), { source: "t" })).toThrow(/最多/);
    let n = 0;
    expect(() => {
      for (; n < 100; n++) m.remember(bot, `第 ${n} 条：` + "字".repeat(200), { source: "t" });
    }).toThrow(/已满/);
    expect(m.main(bot).length).toBeLessThanOrEqual(MEMORY_MAX);
  });
  it("ambiguous forget lists candidates", () => {
    const m = new MemoryStore(dir);
    m.remember(bot, "喜欢猫", { source: "t" });
    m.remember(bot, "喜欢狗", { source: "t" });
    expect(() => m.forget(bot, "喜欢", { by: "t" })).toThrow(/2 条匹配/);
    expect(m.forget(bot, "喜欢", { by: "t", all: true })).toContain("2 条");
  });
});

describe("steward", () => {
  it("lines and judge cadence", () => {
    const l = linesFor(100_000, 10_000);
    expect(l.usable).toBe(90_000);
    expect(l.check).toBe(72_000);
    expect(shouldJudge(50_000, l, undefined)).toBe(false);
    expect(shouldJudge(72_000, l, undefined)).toBe(true);
    expect(shouldJudge(75_000, l, 72_000)).toBe(false);
    expect(shouldJudge(90_000, l, 72_000)).toBe(true);
  });
  it("parses decisions and reviews", () => {
    expect(parseDecision('think… {"action":"compact","reason":"x"}')).toBe("compact");
    expect(parseDecision('{"action":"switch"}')).toBe("switch");
    expect(parseDecision("nonsense")).toBeUndefined();
    const r = parseReview('{"add":[{"text":"喜欢简短","topic":"style"},"另一条"],"remove":["旧的"]}');
    expect(r.add).toEqual([{ text: "喜欢简短", topic: "style" }, { text: "另一条", topic: undefined }]);
    expect(r.remove).toEqual(["旧的"]);
    expect(parseReview("bad")).toEqual({ add: [], remove: [] });
    expect(recentTranscript([{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }])).toBe("user: hi\n\nassistant: yo");
  });
});

describe("settings", () => {
  it("normalizes with defaults and clamps unknown values", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ permission: "full", memory: { review: false }, computerUse: { approval: "never" } });
    expect(s.permission).toBe("workspace");
    expect(s.memory).toEqual({ enabled: true, review: false, teamWrite: false });
    expect(s.computerUse).toEqual({ enabled: true, approval: "always" });
    expect(permissionMode("readonly")).toBe("read-only");
    expect(permissionMode("workspace")).toBe("workspace-write");
  });
  it("store persists settings and migrates", () => {
    const store = new Store(path.join(dir, "t.db"));
    const b = store.createBot({ name: "x" } as any);
    expect(b.settings).toEqual(DEFAULT_SETTINGS);
    const u = store.updateBot(b.id, { settings: normalizeSettings({ permission: "readonly" }) })!;
    expect(u.settings.permission).toBe("readonly");
    const c = store.ensureConversation(b.id, "web", "p1", "t");
    expect(c.kind).toBe("dm");
    expect(store.ensureConversation(b.id, "web", "p1", "t", "group").kind).toBe("group");
    store.close();
    const again = new Store(path.join(dir, "t.db"));
    expect(again.getBot(b.id)!.settings.permission).toBe("readonly");
    again.close();
  });
});

describe("computer use detection", () => {
  const home = "/Users/u";
  const client = `${home}/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient`;
  const probe = (o: Partial<CuProbe> & { files?: string[] } = {}): CuProbe => {
    const files = new Set(o.files ?? []);
    return {
      platform: "darwin",
      release: "24.1.0",
      env: {},
      homedir: home,
      isExecutable: (p) => files.has(p),
      isFile: (p) => files.has(p),
      ...o,
    };
  };
  const root = "/app/vendor/kimi-computer-use";
  const bridge = `${root}/bin/computer-use-mcp-bridge.mjs`;
  const launcher = "/Applications/ChatGPT.app/Contents/Resources/codex";

  it("is disabled off macOS (this Linux box) with a clear reason", () => {
    const st = detectComputerUse([root]);
    expect(process.platform === "darwin" || !st.available).toBe(true);
    if (process.platform !== "darwin") expect(st.reason).toContain(CU_UNAVAILABLE);
    expect(detectComputerUse([root], probe({ platform: "linux", files: [bridge, client, launcher] })).reason).toMatch(/不是 macOS/);
  });
  it("requires macOS 14.4+, the bundle, the client and a launcher", () => {
    expect(macAtLeast144("23.4.0")).toBe(true);
    expect(macAtLeast144("23.3.0")).toBe(false);
    expect(macAtLeast144("25.0.0")).toBe(true);
    expect(detectComputerUse([root], probe({ release: "22.6.0", files: [bridge, client, launcher] })).reason).toMatch(/14\.4/);
    expect(detectComputerUse([root], probe({ files: [client, launcher] })).reason).toMatch(/缺少/);
    expect(detectComputerUse([root], probe({ files: [bridge, launcher] })).reason).toMatch(/客户端/);
    expect(detectComputerUse([root], probe({ files: [bridge, client] })).reason).toMatch(/启动器/);
    const ok = detectComputerUse([root], probe({ files: [bridge, client, launcher] }));
    expect(ok).toMatchObject({ available: true, client, launcher, bridge, codexHome: `${home}/.codex` });
    const direct = detectComputerUse([root], probe({ files: [bridge, client], env: { COMPUTER_USE_BRIDGE_DIRECT_LAUNCH: "1" } }));
    expect(direct.available).toBe(true);
  });
  it("honours CODEX_HOME like the upstream bridge", () => {
    expect(clientPath({ CODEX_HOME: "/x" }, home).client).toBe(
      "/x/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
    );
    expect(bundledRoots("/r/dsh")).toContain("/r/kimi-computer-use");
    expect(bundledRoots("/a/dsh-runtime")).toContain("/a/vendor/kimi-computer-use");
  });
  it("builds a secret-free stdio MCP config", () => {
    const ok = detectComputerUse([root], probe({ files: [bridge, client, launcher] }));
    const lines = mcpPatchLines(ok, "/usr/bin/node", (s) => JSON.stringify(s)).join("\n");
    expect(lines).toContain("serverName: computer-use");
    expect(lines).toContain('command: "/usr/bin/node"');
    expect(lines).toContain(`args: [${JSON.stringify(bridge)}]`);
    expect(lines).toContain(`CODEX_HOME: "${home}/.codex"`);
    expect(lines).not.toMatch(/KEY|TOKEN|SECRET|PASSWORD/i);
    expect(mcpPatchLines({ available: false, reason: "" }, "/n", JSON.stringify)).toEqual([]);
  });
  it("adapts the bundled skill to our tool names", () => {
    const md = fs.readFileSync(path.join(__dirname, "..", "vendor", "kimi-computer-use", "skills", "computer-use", "SKILL.md"), "utf8");
    const out = adaptSkill(md);
    expect(out.startsWith("---\nname: computer-use")).toBe(true);
    expect(out).toContain("mcp__computer-use__");
    expect(out).not.toContain("mcp__plugin-kimi-computer-use");
    expect(out).not.toMatch(/Do not\s+ask the user to approve/);
    expect(out).toContain("Songkeys");
  });
});

describe("computer use approval gate plugin", () => {
  it("asks for actions, lets readonly through when relaxed", async () => {
    const plugin = path.join(__dirname, "..", "dsh-runtime", "plugins", "amb-computer-use-gate.mjs");
    const run = async (mode: string | undefined, tool: string) => {
      const prev = process.env.AMB_CU_APPROVAL;
      if (mode) process.env.AMB_CU_APPROVAL = mode;
      else delete process.env.AMB_CU_APPROVAL;
      let hook: any;
      const mod = await import(plugin + `?t=${Math.random()}`);
      mod.apply({ on: (_ev: string, fn: any) => (hook = fn) });
      if (prev === undefined) delete process.env.AMB_CU_APPROVAL;
      else process.env.AMB_CU_APPROVAL = prev;
      return hook({ name: tool }, async () => ({ kind: "allow" }));
    };
    expect((await run(undefined, "mcp__computer-use__click")).kind).toBe("ask");
    expect((await run(undefined, "mcp__computer-use__get_app_state")).kind).toBe("ask");
    expect((await run("readonly-free", "mcp__computer-use__get_app_state")).kind).toBe("allow");
    expect((await run("readonly-free", "mcp__computer-use__type_text")).kind).toBe("ask");
    expect((await run(undefined, "read_file")).kind).toBe("allow");
  });
});

describe("permission preset plugin", () => {
  it("re-applies the bot preset to existing sessions before tools run", async () => {
    const plugin = path.join(__dirname, "..", "dsh-runtime", "plugins", "amb-permission.mjs");
    const prev = process.env.DSH_PERMISSION_MODE;
    process.env.DSH_PERMISSION_MODE = "read-only";
    const mod = await import(plugin + `?t=${Math.random()}`);
    const cur = new Map<string, string>([["s1", "workspace-write"], ["s2", "read-only"]]);
    const sets: string[] = [];
    let hook: any;
    mod.apply({
      on: (_ev: string, fn: any) => (hook = fn),
      permissionPresets: { current: (s: string) => cur.get(s), set: (s: string, m: string) => (sets.push(`${s}:${m}`), cur.set(s, m)) },
    });
    if (prev === undefined) delete process.env.DSH_PERMISSION_MODE;
    else process.env.DSH_PERMISSION_MODE = prev;
    expect((await hook({ agent: { session: "s1" } }, async () => ({ kind: "allow" }))).kind).toBe("allow");
    await hook({ agent: { session: "s2" } }, async () => ({ kind: "allow" }));
    expect(sets).toEqual(["s1:read-only"]);
  });
});
