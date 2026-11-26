import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGithubLinks, parseSkillLink, readGithubSkill } from "../src/skills/github.js";
import { CARD_TTL_MS, SkillInstalls, installPromptLinks } from "../src/skills/installs.js";
import { UserSkills } from "../src/skills/service.js";
import { SkillError } from "../src/skills/archive.js";
import { Store } from "../src/store/db.js";
import { BotRuntime } from "../src/core/runtime.js";
import { GroupChats, withoutLeadingMentions } from "../src/core/groups.js";
import type { OutboundOp } from "../src/core/types.js";
import { webEvent } from "../src/web/http.js";
import { AgentManager } from "../src/agent/manager.js";
import { locateDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { listen, readJson } from "./helpers.js";

const SHA = "a".repeat(40);
const md = (name: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: Writes weekly reports\n---\n${body}\n`;

interface Repo {
  owner?: string;
  repo?: string;
  branches?: string[];
  license?: string | null;
  /** 仓库里的文件（相对仓库根）；值是内容 */
  files: Record<string, string>;
  symlinks?: string[];
  rateLimited?: boolean;
  missing?: boolean;
  offsite?: boolean;
}

/** 一个假的 GitHub：api.github.com 的仓库 / 提交 / 目录树和 raw.githubusercontent.com 的文件 */
function fakeGithub(r: Repo) {
  const owner = r.owner ?? "acme";
  const repo = r.repo ?? "skills";
  const branches = r.branches ?? ["main"];
  const calls: string[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.hostname}${url.pathname}`);
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    if (r.rateLimited) return json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" });
    if (r.offsite) {
      const res = json({});
      Object.defineProperty(res, "url", { value: "https://evil.example/x" });
      return res;
    }
    const base = `/repos/${owner}/${repo}`;
    if (url.hostname === "api.github.com") {
      if (r.missing) return json({ message: "Not Found" }, 404);
      if (url.pathname === base) return json({ full_name: `${owner}/${repo}`, default_branch: branches[0], private: false, license: r.license === undefined ? { spdx_id: "MIT" } : r.license === null ? null : { spdx_id: r.license } });
      const commit = /^\/repos\/[^/]+\/[^/]+\/commits\/(.+)$/.exec(url.pathname);
      if (commit) return branches.includes(decodeURIComponent(commit[1])) ? json({ sha: SHA }) : json({ message: "No commit found" }, 422);
      const tree = /^\/repos\/[^/]+\/[^/]+\/git\/trees\/(.+)$/.exec(url.pathname);
      if (tree) {
        const ref = decodeURIComponent(tree[1]);
        const dir = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : "";
        const prefix = dir ? `${dir}/` : "";
        const inside = Object.keys(r.files).filter((f) => f.startsWith(prefix));
        if (dir && !inside.length) return json({ message: "Not Found" }, 404);
        const entries = inside.map((f) => ({ path: f.slice(prefix.length), mode: r.symlinks?.includes(f) ? "120000" : "100644", type: "blob", size: Buffer.byteLength(r.files[f]) }));
        return json({ sha: "t", tree: entries, truncated: false });
      }
    }
    if (url.hostname === "raw.githubusercontent.com") {
      const p = decodeURIComponent(url.pathname.split("/").slice(4).join("/"));
      return p in r.files ? new Response(r.files[p]) : new Response("404", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

describe("技能链接", () => {
  it("认仓库根、/tree/ 目录和 /blob/…/SKILL.md，忽略末尾斜杠、.git、查询参数和锚点", () => {
    expect(parseSkillLink("https://github.com/acme/skills")).toMatchObject({ owner: "acme", repo: "skills", kind: "root", rest: [] });
    expect(parseSkillLink("https://github.com/acme/skills.git/")).toMatchObject({ repo: "skills", kind: "root" });
    expect(parseSkillLink("https://github.com/acme/skills/tree/main/skills/weekly?tab=readme#top")).toMatchObject({ kind: "tree", rest: ["main", "skills", "weekly"] });
    expect(parseSkillLink("https://www.github.com/acme/skills/blob/main/weekly/SKILL.md")).toMatchObject({ kind: "blob", rest: ["main", "weekly", "SKILL.md"] });
    for (const bad of ["https://gitlab.com/acme/skills", "https://github.com/acme", "https://github.com/acme/skills/issues/1", "https://github.com/acme/skills/blob/main/README.md", "ftp://github.com/acme/skills", "not a url"]) {
      expect(parseSkillLink(bad), bad).toBeNull();
    }
  });

  it("从文字里找链接：中文标点、括号不算进链接", () => {
    expect(findGithubLinks("装一下这个（https://github.com/acme/skills/tree/main/a）。还有 https://github.com/acme/b，谢谢")).toEqual(["https://github.com/acme/skills/tree/main/a", "https://github.com/acme/b"]);
  });

  it("技能库的安装指令：中英文两种格式，每行一条；夹着别的话就不算", () => {
    expect(installPromptLinks("幫我安裝這個技能：https://github.com/acme/skills/tree/main/a")).toEqual(["https://github.com/acme/skills/tree/main/a"]);
    expect(installPromptLinks("帮我安装这个技能：https://github.com/acme/skills/tree/main/a")).toEqual(["https://github.com/acme/skills/tree/main/a"]);
    expect(installPromptLinks("Install this skill for me: https://github.com/acme/b\n\ninstall this skill for me:https://github.com/acme/c")).toEqual(["https://github.com/acme/b", "https://github.com/acme/c"]);
    expect(installPromptLinks("帮我安装这个技能：https://github.com/acme/a\n顺便总结一下它")).toBeNull();
    expect(installPromptLinks("装一下这个 https://github.com/acme/a")).toBeNull();
  });

  it("群聊里行首的 @成员、@所有人 去掉后再认", () => {
    const members = [{ id: "b1", name: "小红" }, { id: "b2", name: "Writer Bot" }];
    expect(withoutLeadingMentions("@小红 @writer bot 帮我安装这个技能：https://github.com/a/b", members)).toBe("帮我安装这个技能：https://github.com/a/b");
    expect(withoutLeadingMentions("@所有人 Install this skill for me: https://github.com/a/b", members)).toBe("Install this skill for me: https://github.com/a/b");
  });
});

describe("从 GitHub 读取技能", () => {
  it("目录：只取这个目录，按提交号下载；来源记仓库、路径、分支、提交号；许可证取仓库的", async () => {
    const gh = fakeGithub({ files: { "skills/weekly/SKILL.md": md("weekly-report"), "skills/weekly/run.py": "print(1)", "skills/other/SKILL.md": md("other") } });
    const r = await readGithubSkill(parseSkillLink("https://github.com/acme/skills/tree/main/skills/weekly")!, { fetch: gh.fn });
    expect(r.pkg.name).toBe("weekly-report");
    expect(r.pkg.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "run.py"]);
    expect(r.source).toEqual({ owner: "acme", repo: "skills", path: "skills/weekly", ref: "main", commit: SHA, url: "https://github.com/acme/skills/tree/main/skills/weekly" });
    expect(r.license).toBe("MIT");
    // 3 次 API（仓库、提交、目录树），文件走 raw，不碰别的目录
    expect(gh.calls.filter((c) => c.startsWith("api.github.com"))).toHaveLength(3);
    expect(gh.calls.some((c) => c.includes("skills/other"))).toBe(false);
  });

  it("分支名带斜杠、/blob/ 指向 SKILL.md、仓库根都能读", async () => {
    const files = { "a/SKILL.md": md("alpha"), "SKILL.md": md("root-skill") };
    const gh = fakeGithub({ branches: ["release/v2"], files });
    const tree = await readGithubSkill(parseSkillLink("https://github.com/acme/skills/tree/release/v2/a")!, { fetch: gh.fn });
    expect(tree.source).toMatchObject({ ref: "release/v2", path: "a" });
    const blob = await readGithubSkill(parseSkillLink("https://github.com/acme/skills/blob/release/v2/a/SKILL.md")!, { fetch: gh.fn });
    expect(blob.pkg.name).toBe("alpha");
    const root = await readGithubSkill(parseSkillLink("https://github.com/acme/skills")!, { fetch: fakeGithub({ files: { "SKILL.md": md("root-skill"), "README.md": "x" } }).fn });
    expect(root.source).toMatchObject({ path: "", url: "https://github.com/acme/skills" });
  });

  it("失败原因和 ZIP 导入一致：找不到仓库、没有 SKILL.md、有多个技能、格式不对、符号链接", async () => {
    const read = (r: Repo, url = "https://github.com/acme/skills/tree/main/x") => readGithubSkill(parseSkillLink(url)!, { fetch: fakeGithub(r).fn }).then(() => "ok", (e: SkillError) => [e.code, e.detail]);
    expect(await read({ missing: true, files: {} })).toEqual(["repo_not_found", {}]);
    expect(await read({ files: { "x/README.md": "hi" } })).toEqual(["missing_skill", {}]);
    expect(await read({ files: { "y/SKILL.md": md("y") } })).toEqual(["missing_skill", {}]);
    expect(await read({ files: { "x/a/SKILL.md": md("a"), "x/b/SKILL.md": md("b"), "x/c/SKILL.md": md("c") } })).toEqual(["multiple_skills", { n: 3 }]);
    expect(await read({ files: { "x/SKILL.md": "---\nname: Bad Name\ndescription: d\n---\nbody" } })).toEqual(["invalid_skill", {}]);
    expect(await read({ files: { "x/SKILL.md": md("x"), "x/link.md": "SKILL.md" }, symlinks: ["x/link.md"] })).toEqual(["unsafe_path", {}]);
    expect(await read({ files: { "x/SKILL.md": md("x"), "x/big.bin": "a".repeat(10) } }).then(() => "ok")).toBe("ok");
  });

  it("限流单独报出解除时间；跳到 GitHub 以外的域名按连不上处理", async () => {
    const limited = await readGithubSkill(parseSkillLink("https://github.com/acme/skills")!, { fetch: fakeGithub({ rateLimited: true, files: {} }).fn }).catch((e) => e);
    expect(limited).toBeInstanceOf(SkillError);
    expect(limited.code).toBe("rate_limited");
    expect(limited.detail.resetAt).toBe(2_000_000_000_000);
    const off = await readGithubSkill(parseSkillLink("https://github.com/acme/skills")!, { fetch: fakeGithub({ offsite: true, files: {} }).fn }).catch((e) => e);
    expect(off.code).toBe("network");
  });
});

describe("技能安装卡片", () => {
  let dir: string;
  let store: Store;
  let skills: UserSkills;
  let now = 1_000_000;
  let installed: string[];
  const make = (r: Repo) => new SkillInstalls({ store, skills, fetch: () => fakeGithub(r).fn, now: () => now, onInstalled: (b) => installed.push(b), permission: () => "workspace" });
  const URL1 = "https://github.com/acme/skills/tree/main/weekly";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-skill-install-"));
    store = new Store(path.join(dir, "test.db"));
    store.createBot({ id: "b1", name: "小助手" });
    skills = new UserSkills(dir, store);
    installed = [];
    now = 1_000_000;
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("读取中 → 等确认；点「安装」才写入，记下来源；之后的消息起可用（换空闲进程）", async () => {
    const svc = make({ files: { "weekly/SKILL.md": md("weekly-report"), "weekly/run.sh": "echo hi" } });
    const [card] = svc.request({ botId: "b1", conversationId: "b1:web:console", urls: [URL1] });
    expect(card.state).toBe("reading");
    expect(skills.list("b1")).toEqual([]);
    const ready = (await svc.ready(card.id))!;
    expect(ready.state).toBe("pending");
    expect(ready.skill).toMatchObject({ name: "weekly-report", files: 2, scripts: 1, license: "MIT", replaces: null });
    expect(svc.instructions(card.id)).toContain("Do the thing.");
    expect(fs.existsSync(path.join(dir, "skills", "b1"))).toBe(false);
    const done = svc.install(card.id, "web");
    expect(done.state).toBe("installed");
    expect(installed).toEqual(["b1"]);
    const [skill] = skills.list("b1");
    expect(skill).toMatchObject({ name: "weekly-report", enabled: true, source: { type: "github", owner: "acme", repo: "skills", path: "weekly", ref: "main", commit: SHA } });
    // 装好后卡片只留结果，再点不会重复安装
    expect(svc.install(card.id, "web").state).toBe("installed");
    expect(installed).toEqual(["b1"]);
  });

  it("取消、过期、重启都不写入任何文件；重启时还在等确认的卡片显示已过期", async () => {
    const svc = make({ files: { "weekly/SKILL.md": md("weekly-report") } });
    const [a, b, c] = svc.request({ botId: "b1", conversationId: "b1:web:console", urls: [URL1, URL1, URL1] });
    await Promise.all([a, b, c].map((x) => svc.ready(x.id)));
    expect(svc.cancel(a.id, "web").state).toBe("canceled");
    now += CARD_TTL_MS + 1;
    expect(svc.get(b.id)!.state).toBe("expired");
    expect(svc.install(b.id, "web").state).toBe("expired");
    now -= CARD_TTL_MS;
    const after = make({ files: {} });
    after.start();
    expect(after.get(c.id)!.state).toBe("expired");
    after.stop();
    expect(skills.list("b1")).toEqual([]);
    expect(installed).toEqual([]);
  });

  it("同名只能替换：保留启用状态；确认前同名技能又被改过就失败", async () => {
    const svc = make({ files: { "weekly/SKILL.md": md("weekly-report") } });
    const first = svc.request({ botId: "b1", conversationId: "c", urls: [URL1] })[0];
    await svc.ready(first.id);
    svc.install(first.id, "web");
    skills.setEnabled("b1", "weekly-report", false);
    const svc2 = make({ files: { "weekly/SKILL.md": md("weekly-report", "Version two.") } });
    const second = svc2.request({ botId: "b1", conversationId: "c", urls: [URL1] })[0];
    const pending = (await svc2.ready(second.id))!;
    expect(pending.skill!.replaces).toMatchObject({ source: { type: "github", repo: "skills" } });
    expect(svc2.install(second.id, "web").state).toBe("replaced");
    expect(skills.list("b1")[0].enabled).toBe(false);
    expect(skills.detail("b1", "weekly-report").instructions).toContain("Version two.");
    // 卡片出来以后同名技能被删了：再点「替换」按冲突处理
    const svc3 = make({ files: { "weekly/SKILL.md": md("weekly-report", "Three.") } });
    const third = svc3.request({ botId: "b1", conversationId: "c", urls: [URL1] })[0];
    await svc3.ready(third.id);
    skills.remove("b1", "weekly-report");
    expect(svc3.install(third.id, "web")).toMatchObject({ state: "failed", error: { code: "conflict" } });
  });

  it("预检就拦下：链接无效、保留名、超过 100 个", async () => {
    const svc = make({ files: { "weekly/SKILL.md": md("media") } });
    const [bad, reserved] = svc.request({ botId: "b1", conversationId: "c", urls: ["https://gitlab.com/a/b", URL1] });
    expect(bad).toMatchObject({ state: "failed", error: { code: "invalid_link" } });
    expect(await svc.ready(reserved.id)).toMatchObject({ state: "failed", error: { code: "reserved_name", name: "media" } });
    const index = { revision: "x", skills: Array.from({ length: 100 }, (_, i) => ({ name: `s-${i}`, description: "d", digest: `d${i}`, enabled: true, files: 1, bytes: 1 })) };
    fs.mkdirSync(path.join(dir, "skills", "b1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "b1", "index.json"), JSON.stringify(index));
    const full = make({ files: { "weekly/SKILL.md": md("weekly-report") } });
    const [card] = full.request({ botId: "b1", conversationId: "c", urls: [URL1] });
    expect(await full.ready(card.id)).toMatchObject({ state: "failed", error: { code: "too_many" } });
  });

  it("一条消息最多 5 张卡片", () => {
    const svc = make({ files: {} });
    expect(svc.request({ botId: "b1", conversationId: "c", urls: Array.from({ length: 7 }, () => "https://gitlab.com/x/y") })).toHaveLength(5);
  });

  it("渠道：文字版卡片带编号，回「y 编号」安装、「n 编号」取消；只有一张时只回 y 也行", async () => {
    const svc = make({ files: { "weekly/SKILL.md": md("weekly-report"), "weekly/a.py": "1" } });
    const [card] = svc.request({ botId: "b1", conversationId: "b1:weixin:u1", urls: [URL1] });
    const ready = (await svc.ready(card.id))!;
    const op = svc.op(ready);
    expect(op).toMatchObject({ type: "interactive", kind: "skill_install", requestId: card.id, code: card.code });
    expect(op.prompt).toContain("weekly-report");
    expect(op.prompt).toContain(card.code);
    expect(op.buttons?.map((b) => b.value.op)).toEqual(["install", "cancel"]);
    expect(svc.handleReply("b1:weixin:u1", "随便聊聊", "weixin:u1").handled).toBe(false);
    expect(svc.handleReply("b1:weixin:u1", "y 0000" === `y ${card.code}` ? "y 9999" : "y 0000", "weixin:u1").handled).toBe(false);
    const r = svc.handleReply("b1:weixin:u1", `y ${card.code}`, "weixin:u1");
    expect(r.handled).toBe(true);
    expect(r.ack).toContain("小助手");
    expect(skills.list("b1").map((s) => s.name)).toEqual(["weekly-report"]);
    // 已经处理过：编号对上时告诉结果，不再装一遍
    expect(svc.handleReply("b1:weixin:u1", `n ${card.code}`, "weixin:u1").handled).toBe(true);
    const [other] = svc.request({ botId: "b1", conversationId: "b1:weixin:u1", urls: [URL1] });
    await svc.ready(other.id);
    expect(svc.handleReply("b1:weixin:u1", "n", "weixin:u1")).toMatchObject({ handled: true });
    expect(svc.get(other.id)!.state).toBe("canceled");
  });

  it("运行时：技能库的安装指令不经过模型，直接出卡片；渠道里不是主人的不出", async () => {
    const svc = make({ files: { "weekly/SKILL.md": md("weekly-report") } });
    let modelCalls = 0;
    const rt = new BotRuntime({ store, models: { listModels: async () => ["m1"], streamChat: async () => (modelCalls++, "reply") } as any, defaultModel: () => "m1", contextMessages: 20, contextChars: 20_000, skillInstalls: svc });
    const ops: OutboundOp[] = [];
    await rt.handle(webEvent("b1", `帮我安装这个技能：${URL1}`), { apply: async (op) => void ops.push(op) });
    expect(modelCalls).toBe(0);
    const cards = svc.list(["b1:web:console"]);
    expect(cards).toHaveLength(1);
    expect(ops.find((o) => o.type === "interactive")).toMatchObject({ kind: "skill_install", requestId: cards[0].id });
    expect(store.listMessages("b1:web:console").map((m) => m.role)).toEqual(["user"]);
    expect(await svc.ready(cards[0].id)).toMatchObject({ state: "pending" });
    // 普通消息照旧交给模型
    await rt.handle(webEvent("b1", "你好"), { apply: async () => undefined });
    expect(modelCalls).toBe(1);
    const denied = new BotRuntime({ store, models: { listModels: async () => ["m1"], streamChat: async () => "x" } as any, defaultModel: () => "m1", contextMessages: 20, contextChars: 20_000, skillInstalls: svc, access: { allowed: () => true, ownsConversation: () => false } as any });
    const said: OutboundOp[] = [];
    await denied.handle(webEvent("b1", `Install this skill for me: ${URL1}`), { apply: async (op) => void said.push(op) });
    expect(said.find((o) => o.type === "text")).toBeTruthy();
    expect(svc.list(["b1:web:console"])).toHaveLength(1);
  });

  it("群聊：安装指令由该出卡片的机器人出（@ 多个时第一个，@所有人 时成员列表第一个），别的成员不答", () => {
    store.createBot({ id: "b2", name: "写手" });
    const g = store.createGroup("小组", ["b1", "b2"]);
    const asked: string[] = [];
    const installs: Array<[string, string[]]> = [];
    const groups = new GroupChats({ store, runTurn: async (botId) => (asked.push(botId), ""), installLinks: installPromptLinks, install: (botId, _g, urls) => void installs.push([botId, urls]) });
    groups.send(g.id, `@写手 @小助手 帮我安装这个技能：${URL1}`);
    groups.send(g.id, `@所有人 Install this skill for me: ${URL1}`);
    expect(installs.map(([b]) => b)).toEqual(["b2", "b1"]);
    expect(asked).toEqual([]);
    expect(groups.installOwner(g.id)).toBe("b1");
    groups.send(g.id, "@写手 帮我看看这个 https://github.com/acme/skills");
    expect(groups.installOwner(g.id)).toBe("b2");
    expect(installs).toHaveLength(2);
  });
});

describe("install_skill 工具（amb-skills 插件 → bridge → 宿主）", () => {
  const runtime = locateDshRuntime(findAppRoot());

  it.skipIf(!runtime)("插件注册 install_skill，调用经 bridge 带上机器人、会话和链接", async () => {
    const seen: any[] = [];
    const bridge = await listen(async (req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: await readJson(req) });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: "card shown" }));
    });
    const env = { ...process.env };
    try {
      Object.assign(process.env, { AMB_BRIDGE_URL: bridge.url, AMB_BRIDGE_TOKEN: "tok", AMB_BOT_ID: "b1" });
      const plugin = await import(path.join(runtime!, "plugins", "amb-skills.mjs"));
      const tools: any[] = [];
      plugin.apply({ tools: { register: (t: any) => tools.push(t) } });
      expect(tools.map((t) => t.name)).toEqual(["install_skill"]);
      expect(tools[0].description).toMatch(/Want me to install this as a skill\?/);
      expect(await tools[0].execute({ urls: ["https://github.com/acme/skills"] }, { agent: { session: { id: "s1" } }, signal: AbortSignal.timeout(5000) })).toEqual({ text: "card shown" });
      expect(seen).toEqual([{ url: "/dsh/skills", auth: "Bearer tok", body: { botId: "b1", sessionId: "s1", args: { urls: ["https://github.com/acme/skills"] } } }]);
    } finally {
      process.env = env;
      await bridge.close();
    }
  });

  it("宿主出卡片、等读取结束再告诉模型；网页对话一出卡片就送到这一轮；渠道不是主人、群里不该它出、后台任务都不出", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-skill-tool-"));
    const store = new Store(":memory:");
    store.createBot({ id: "b1", name: "小助手" });
    store.createBot({ id: "b2", name: "写手" });
    const conv = store.ensureConversation("b1", "web", "console", "控制台").id;
    const skills = new UserSkills(dir, store);
    const installs = new SkillInstalls({ store, skills, fetch: () => fakeGithub({ files: { "weekly/SKILL.md": md("weekly-report") } }).fn });
    let owner = true;
    const mgr = new AgentManager({ store, dataDir: dir, runtimeDir: undefined, upstream: () => ({ baseUrl: "", apiKey: "" }), enabled: false, skillInstalls: installs, ownsConversation: () => owner });
    (mgr as any).hosts.set("b1", {});
    (mgr as any).activeConvs.set("b1", new Set([conv]));
    const delivered: string[] = [];
    const unbind = installs.bindSink(conv, async (card, phase) => void delivered.push(`${phase}:${card.state}`));
    await mgr.bridge.start();
    const call = (args: Record<string, unknown>, sessionId = "s1") =>
      fetch(`${mgr.bridge.url}/dsh/skills`, {
        method: "POST",
        headers: { authorization: `Bearer ${mgr.bridge.token}`, "content-type": "application/json" },
        body: JSON.stringify({ botId: "b1", sessionId, args }),
      }).then((r) => r.json());
    try {
      const r = await call({ urls: ["https://github.com/acme/skills/tree/main/weekly"] });
      expect(r.text).toContain('Card shown for "weekly-report"');
      expect(r.text).toMatch(/Never download or install the skill yourself/);
      expect(delivered).toEqual(["created:reading", "ready:pending"]);
      expect(installs.list([conv])).toHaveLength(1);
      expect(skills.list("b1")).toEqual([]);
      owner = false;
      expect((await call({ urls: ["https://github.com/acme/skills"] })).text).toMatch(/Only the bot's owner/);
      owner = true;
      expect((await call({ urls: ["https://github.com/acme/skills"] }, "task-1")).error).toMatch(/background task/);
      // 群里这条消息该由写手出卡片：小助手的调用被拦下
      const g = store.createGroup("小组", ["b1", "b2"]);
      const gconv = store.ensureConversation("b1", "web", `group:${g.id}`, "小组", "group").id;
      (mgr as any).activeConvs.set("b1", new Set([gconv]));
      installs.groupOwner = () => "b2";
      expect((await call({ urls: ["https://github.com/acme/skills"] })).text).toMatch(/写手 handles install requests/);
      expect(installs.list([gconv])).toEqual([]);
    } finally {
      unbind();
      await mgr.bridge.stop?.();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
