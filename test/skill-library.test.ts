import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSkillZip } from "../src/skills/archive.js";
import { ItemError, LocalImports, inspectSkill, readSkillDir } from "../src/skills/local-import.js";
import { UserSkills } from "../src/skills/service.js";
import { Store } from "../src/store/db.js";
import { skillMd, skillZip } from "./skill-fixture.js";

const md = (name: string, body = "Do the thing.", extra = "") => `---\nname: ${name}\ndescription: Does ${name}\n${extra}---\n${body}\n`;
function put(root: string, rel: string, text: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
const files = (o: Record<string, string>) => Object.entries(o).map(([p, text]) => ({ path: p, data: Buffer.from(text) }));
const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ItemError ? [e.problem, e.detail] : ["other", String(e)];
  }
  return ["ok", ""];
};

describe("本机技能：校验一项（R2）", () => {
  it("合规的技能原样导入；BOM 只在副本里去掉", () => {
    const r = inspectSkill(files({ "SKILL.md": `﻿${md("weekly-report")}`, "references/a.md": "x" }), "weekly-report");
    expect(r).toMatchObject({ name: "weekly-report", description: "Does weekly-report", completed: [], scripts: 0, depsUnverified: false });
    expect(r.files.find((f) => f.path === "SKILL.md")!.data.toString()).toBe(md("weekly-report"));
  });
  it("缺名称、描述时按目录名和第一个标题补全，只写进副本；补全后仍要通过同一套检查", () => {
    const r = inspectSkill(files({ "SKILL.md": "---\nlicense: MIT\n---\n# Weekly report\nSteps" }), "Weekly-Report");
    expect(r.completed).toEqual([{ field: "name", value: "weekly-report" }, { field: "description", value: "Weekly report" }]);
    const text = r.files[0].data.toString();
    expect(text).toMatch(/^---\nname: "weekly-report"\ndescription: "Weekly report"\nlicense: MIT\n---\n/);
    expect(problem(() => inspectSkill(files({ "SKILL.md": "---\nlicense: MIT\n---\nno heading" }), "My Skill"))[0]).toBe("no_name");
    expect(problem(() => inspectSkill(files({ "SKILL.md": "---\nname: x\n---\nno heading" }), "x"))[0]).toBe("no_description");
  });
  it("写了不合规的调用名不改名、不导入；保留名不导入", () => {
    expect(problem(() => inspectSkill(files({ "SKILL.md": md("Weekly Report") }), "w"))[0]).toBe("bad_name");
    expect(problem(() => inspectSkill(files({ "SKILL.md": md("media") }), "media"))[0]).toBe("reserved_name");
  });
  it("保留手动调用和禁止自动调用；allow_implicit_invocation: false 写成 disable-model-invocation；没法等价保持的限制不导入", () => {
    const keep = inspectSkill(files({ "SKILL.md": md("a", "x", "disable-model-invocation: true\nuser-invocable: false\n") }), "a");
    expect(keep.restrictions).toEqual(["disable-model-invocation", "user-invocable"]);
    const codex = inspectSkill(files({ "SKILL.md": md("b"), "agents/openai.yaml": "policy:\n  allow_implicit_invocation: false\n" }), "b");
    expect(codex.completed).toEqual([{ field: "disable-model-invocation", value: "true" }]);
    expect(codex.files.find((f) => f.path === "SKILL.md")!.data.toString()).toContain("disable-model-invocation: true");
    for (const extra of ["allowed-tools: Read Bash\n", "hooks:\n  pre: x\n", "context: fork\n", "disableModelInvocation: true\n", "require-approval: true\n", "disable-model-invocation: maybe\n", "policy:\n  other: 1\n"]) {
      expect(problem(() => inspectSkill(files({ "SKILL.md": md("c", "x", extra) }), "c"))[0]).toBe("policy");
    }
    // 不像限制的未知字段当展示字段，列出来
    expect(inspectSkill(files({ "SKILL.md": md("d", "x", "color: blue\n") }), "d").unused).toEqual(["color"]);
  });
  it("不安全的 YAML、非 UTF-8、平台路径变量、根外和缺失的资源都不导入", () => {
    expect(problem(() => inspectSkill(files({ "SKILL.md": "---\nname: &a x\ndescription: *a\n---\nbody" }), "x"))[0]).toBe("bad_frontmatter");
    expect(problem(() => inspectSkill(files({ "SKILL.md": "---\nname: x\ndescription: !!js/function y\n---\nbody" }), "x"))[0]).toBe("bad_frontmatter");
    expect(problem(() => inspectSkill([{ path: "SKILL.md", data: Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]) }], "x"))[0]).toBe("not_utf8");
    expect(problem(() => inspectSkill(files({ "SKILL.md": md("x", "Run ${CLAUDE_PLUGIN_ROOT}/bin/x") }), "x"))).toEqual(["platform_var", "CLAUDE_PLUGIN_ROOT"]);
    expect(problem(() => inspectSkill(files({ "SKILL.md": md("x", "See [shared](../shared/a.md)") }), "x"))[0]).toBe("outside_ref");
    expect(problem(() => inspectSkill(files({ "SKILL.md": md("x", "See [tpl](references/tpl.md)") }), "x"))).toEqual(["missing_resource", "references/tpl.md"]);
    expect(problem(() => inspectSkill(files({ "SKILL.md": md("x", "See [tpl](references/tpl.md) and [web](https://a.b) [top](#x)"), "references/tpl.md": "t" }), "x"))[0]).toBe("ok");
  });
  it("有脚本、依赖清单时说「依赖尚未验证」", () => {
    expect(inspectSkill(files({ "SKILL.md": md("x"), "scripts/run.py": "print(1)" }), "x")).toMatchObject({ scripts: 1, depsUnverified: true });
    expect(inspectSkill(files({ "SKILL.md": md("x"), "requirements.txt": "x" }), "x").depsUnverified).toBe(true);
  });
  it("改了资源或脚本就是不同内容；路径和字节都相同才是同内容", () => {
    const a = inspectSkill(files({ "SKILL.md": md("x"), "scripts/run.py": "1" }), "x").digest;
    expect(inspectSkill(files({ "SKILL.md": md("x"), "scripts/run.py": "1" }), "y").digest).toBe(a);
    expect(inspectSkill(files({ "SKILL.md": md("x"), "scripts/run.py": "2" }), "x").digest).not.toBe(a);
    expect(inspectSkill(files({ "SKILL.md": md("x"), "scripts/run2.py": "1" }), "x").digest).not.toBe(a);
  });
});

describe("本机技能：读目录的边界（R4）", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amb-local-read-")));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it("只收普通文件；.git、__MACOSX、.DS_Store、._ 不算内容但列出来", async () => {
    put(dir, "s/SKILL.md", md("s"));
    put(dir, "s/.git/HEAD", "ref");
    put(dir, "s/.DS_Store", "x");
    put(dir, "s/._SKILL.md", "x");
    put(dir, "s/refs/a.txt", "a");
    const r = await readSkillDir(path.join(dir, "s"));
    expect(r.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "refs/a.txt"]);
    expect(r.ignored.sort()).toEqual([".DS_Store", "._SKILL.md", ".git"]);
  });
  it("疑似私人文件先拦下、不读内容；链接指到外面、断开、指向目录的整项不读；里面的文件链接照常", async () => {
    put(dir, "s/SKILL.md", md("s"));
    put(dir, "s/.env", "SECRET=1");
    await expect(readSkillDir(path.join(dir, "s"))).rejects.toMatchObject({ problem: "private_file", detail: ".env" });
    fs.rmSync(path.join(dir, "s/.env"));
    put(dir, "outside.txt", "secret");
    fs.symlinkSync(path.join(dir, "outside.txt"), path.join(dir, "s/leak.txt"));
    await expect(readSkillDir(path.join(dir, "s"))).rejects.toMatchObject({ problem: "link_outside" });
    fs.rmSync(path.join(dir, "s/leak.txt"));
    fs.symlinkSync(path.join(dir, "nope"), path.join(dir, "s/broken"));
    await expect(readSkillDir(path.join(dir, "s"))).rejects.toMatchObject({ problem: "link_broken" });
    fs.rmSync(path.join(dir, "s/broken"));
    fs.symlinkSync(path.join(dir, "s"), path.join(dir, "s/loop"));
    await expect(readSkillDir(path.join(dir, "s"))).rejects.toMatchObject({ problem: "link_dir" });
    fs.rmSync(path.join(dir, "s/loop"));
    fs.symlinkSync(path.join(dir, "s/SKILL.md"), path.join(dir, "s/copy.md"));
    const r = await readSkillDir(path.join(dir, "s"));
    expect(r.files.find((f) => f.path === "copy.md")!.data.toString()).toBe(md("s"));
  });
  it("特殊文件、不支持的文件名不读", async () => {
    put(dir, "s/SKILL.md", md("s"));
    put(dir, "s/bad:name.txt", "x");
    await expect(readSkillDir(path.join(dir, "s"))).rejects.toMatchObject({ problem: "unsafe_path" });
    fs.rmSync(path.join(dir, "s/bad:name.txt"));
    if (process.platform !== "win32") {
      const { execFileSync } = await import("node:child_process");
      execFileSync("mkfifo", [path.join(dir, "s/pipe")]);
      await expect(readSkillDir(path.join(dir, "s"))).rejects.toMatchObject({ problem: "special_file" });
    }
  });
});

describe("从本机导入（R1–R5）", () => {
  let dir: string;
  let home: string;
  let store: Store;
  let skills: UserSkills;
  let imports: LocalImports;
  let picked: string | undefined;
  const deployed = (bot: string, name: string) => path.join(dir, "data", "dsh", bot, "skills", name);
  const make = () => {
    skills = new UserSkills(path.join(dir, "data"), store);
    imports = new LocalImports({
      store,
      dataDir: path.join(dir, "data"),
      home,
      platform: "linux",
      lookup: { items: () => skills.libraryView().map((i) => ({ id: i.id, name: i.name, title: i.title, contentDigest: i.contentDigest })) },
      add: (o) => skills.library.add({ ...o, imported: true }),
      enable: (id, botId) => void skills.useLibrary(id, botId, true),
      findImported: (importId, key) => skills.library.list().find((e) => e.importId === importId && e.itemKey === key),
      botName: (id) => store.getBot(id)?.name,
      picker: () => async () => picked,
    });
  };
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amb-local-")));
    home = path.join(dir, "home");
    fs.mkdirSync(home);
    store = new Store(path.join(dir, "test.db"));
    store.createBot({ id: "a", name: "阿白" });
    store.createBot({ id: "b", name: "Bob" });
    picked = undefined;
    make();
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("只枚举六个自动根：共享目录只算一次，允许分类子目录，链到根外的那一项不读；不存在的说未找到", async () => {
    put(home, ".claude/skills/weekly-report/SKILL.md", md("weekly-report"));
    put(home, ".claude/skills/team/interview/SKILL.md", md("interview"));
    put(home, ".claude/skills/team/interview/examples/nested/SKILL.md", md("nested"));
    fs.mkdirSync(path.join(home, ".agents"), { recursive: true });
    fs.symlinkSync(path.join(home, ".claude/skills"), path.join(home, ".agents/skills"));
    put(dir, "elsewhere/organize/SKILL.md", md("organize"));
    fs.symlinkSync(path.join(dir, "elsewhere/organize"), path.join(home, ".claude/skills/organize"));
    put(home, ".codex/skills/.system/skill-creator/SKILL.md", md("skill-creator"));
    put(home, "projects/x/.claude/skills/p/SKILL.md", md("p"));
    const s = await imports.settled(imports.start("a").id);
    expect(s.state).toBe("done");
    const names = s.candidates.map((c) => c.name).sort();
    expect(names).toEqual(["interview", "organize", "weekly-report"]);
    expect(s.candidates.find((c) => c.name === "organize")!.blocked).toMatchObject({ problem: "link_outside" });
    // ~/.agents/skills 先查到（它链接到 ~/.claude/skills），同一个真实目录后面不再重复计数
    expect(s.candidates.find((c) => c.name === "interview")!.location).toBe("~/.agents/skills/team/interview");
    expect(s.roots.find((r) => r.id === "U03")).toMatchObject({ status: "found", count: 3, real: "~/.claude/skills" });
    expect(s.roots.find((r) => r.id === "U04")).toMatchObject({ status: "found", count: 0 });
    expect(s.roots.find((r) => r.id === "U05")).toMatchObject({ status: "missing" });
    expect(s.roots.map((r) => r.id)).toEqual(["U01", "U02", "U03", "U04", "U05", "U06"]);
  });

  it("取消发现：标未扫描完整，不当成 0 项", async () => {
    put(home, ".codebuddy/skills/a/SKILL.md", md("a"));
    const started = imports.start();
    const s = imports.cancelScan(started.id);
    expect(s.state).toBe("canceled");
    const done = await imports.settled(started.id);
    expect(done.state).toBe("canceled");
    expect(done.roots.some((r) => r.status === "partial")).toBe(true);
  });

  it("预览只读所选；同内容多处合成一项；导入后在当前机器人开启并部署；同一个请求号不重复入库", async () => {
    put(home, ".claude/skills/weekly-report/SKILL.md", md("weekly-report"));
    put(home, ".claude/skills/weekly-report/scripts/run.sh", "echo hi");
    put(home, ".cursor/skills/weekly-report/SKILL.md", md("weekly-report"));
    put(home, ".cursor/skills/weekly-report/scripts/run.sh", "echo hi");
    put(home, ".codex/skills/broken/SKILL.md", "no frontmatter but body\n");
    const s = await imports.settled(imports.start("a").id);
    const keys = s.candidates.map((c) => c.key);
    const p = await imports.preview(s.id, keys, "a");
    expect(p.items).toHaveLength(2);
    const ok = p.items.find((i) => i.name === "weekly-report")!;
    expect(ok).toMatchObject({ status: "ok", scripts: 1, depsUnverified: true });
    expect(ok.sources).toHaveLength(2);
    expect(p.items.find((i) => i.status === "incompatible")!.problem).toMatchObject({ code: "no_description" });
    const r = await imports.commit(s.id, { requestId: "req-00000001", previewId: p.preview, items: [{ key: ok.key, action: "import" }], botId: "a" });
    expect(r.items.find((i) => i.key === ok.key)).toMatchObject({ state: "added", enable: "on" });
    expect(skills.library.list()).toHaveLength(1);
    const again = await imports.commit(s.id, { requestId: "req-00000001", previewId: p.preview, items: [{ key: ok.key, action: "import" }], botId: "a" });
    expect(again).toEqual(r);
    expect(skills.library.list()).toHaveLength(1);
    // 部署到 a，b 不受影响
    skills.sync("a");
    skills.sync("b");
    expect(fs.readFileSync(path.join(deployed("a", "weekly-report"), "scripts/run.sh"), "utf8")).toBe("echo hi");
    expect(fs.existsSync(deployed("b", "weekly-report"))).toBe(false);
    // 再预览：已存在，保持原状态
    const p2 = await imports.preview(s.id, keys, "a");
    expect(p2.items.find((i) => i.name === "weekly-report")).toMatchObject({ status: "exists" });
  });

  it("同名不同内容默认跳过；另存一份是新条目，调用名和正文不改，同一个机器人上不能同时开", async () => {
    put(home, ".claude/skills/weekly-report/SKILL.md", md("weekly-report", "v1"));
    let s = await imports.settled(imports.start("a").id);
    let p = await imports.preview(s.id, s.candidates.map((c) => c.key), "a");
    await imports.commit(s.id, { requestId: "req-00000002", previewId: p.preview, items: [{ key: p.items[0].key, action: "import" }], botId: "a" });
    fs.writeFileSync(path.join(home, ".claude/skills/weekly-report/SKILL.md"), md("weekly-report", "v2"));
    s = await imports.settled(imports.start("a").id);
    p = await imports.preview(s.id, s.candidates.map((c) => c.key), "a");
    const item = p.items[0];
    expect(item).toMatchObject({ status: "conflict", copyTitle: "weekly-report (2)" });
    const skipped = await imports.commit(s.id, { requestId: "req-00000003", previewId: p.preview, items: [{ key: item.key, action: "import" }], botId: "a" });
    expect(skipped.items[0].state).toBe("skipped");
    const copied = await imports.commit(s.id, { requestId: "req-00000004", previewId: p.preview, items: [{ key: item.key, action: "copy" }], botId: "a" });
    expect(copied.items[0]).toMatchObject({ state: "added", enable: "failed", enableError: "name_on" });
    const entries = skills.library.list();
    expect(entries.map((e) => [e.name, e.title]).sort()).toEqual([["weekly-report", "weekly-report"], ["weekly-report", "weekly-report (2)"]]);
    // 另一台机器人上可以开另存的那一份；原来那份在 a 上的开关不变
    const copy = entries.find((e) => e.title === "weekly-report (2)")!;
    skills.useLibrary(copy.id, "b", true);
    expect(entries.find((e) => e.title === "weekly-report")!.uses.a.on).toBe(true);
    expect(() => skills.useLibrary(copy.id, "a", true)).toThrow("name_on");
  });

  it("预览后来源变了：这一项不写，提示重新预览；写入失败不留半包，其他项照常", async () => {
    put(home, ".claude/skills/a1/SKILL.md", md("a1"));
    put(home, ".claude/skills/a2/SKILL.md", md("a2"));
    put(home, ".claude/skills/a3/SKILL.md", md("a3"));
    const s = await imports.settled(imports.start().id);
    const p = await imports.preview(s.id, s.candidates.map((c) => c.key));
    fs.appendFileSync(path.join(home, ".claude/skills/a1/SKILL.md"), "changed");
    const a2 = p.items.find((i) => i.name === "a2")!;
    skills.library.failWrite = (digest) => {
      if (digest === a2.digest) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    };
    const r = await imports.commit(s.id, { requestId: "req-00000005", previewId: p.preview, items: p.items.map((i) => ({ key: i.key, action: "import" as const })) });
    const by = (n: string) => r.items.find((i) => i.key === p.items.find((x) => x.name === n)!.key)!;
    expect(by("a1")).toMatchObject({ state: "failed", error: { code: "changed" } });
    expect(by("a2")).toMatchObject({ state: "failed", error: { code: "write_failed" } });
    expect(by("a3")).toMatchObject({ state: "added" });
    expect(skills.library.list().map((e) => e.name)).toEqual(["a3"]);
    expect(fs.readdirSync(skills.library.root).filter((d) => d.startsWith(".stage-"))).toEqual([]);
    expect(fs.existsSync(skills.library.packageDir(a2.digest!))).toBe(false);
  });

  it("应用中途退出：按原记录核对，已写进库的算成功，没开始的记为已停止，不重复入库", async () => {
    put(home, ".claude/skills/a1/SKILL.md", md("a1"));
    const s = await imports.settled(imports.start().id);
    const p = await imports.preview(s.id, s.candidates.map((c) => c.key));
    store.setKV("skill-import:req-crashed1", JSON.stringify({ id: "req-crashed1", state: "running", at: 1, items: [{ key: p.items[0].key, title: "a1", state: "pending" }, { key: "zz", title: "x", state: "pending" }] }));
    skills.library.add({ files: files({ "SKILL.md": md("a1") }), name: "a1", title: "a1", description: "d", source: { type: "local", root: "U04", location: "~/x", installedAt: 1 }, importId: "req-crashed1", itemKey: p.items[0].key, imported: true });
    make();
    const r = imports.record("req-crashed1")!;
    expect(r.state).toBe("done");
    expect(r.items.map((i) => i.state)).toEqual(["added", "stopped"]);
  });

  it("选择文件夹：主目录、磁盘根、应用数据总根不递归；链接先给真实位置；项目只看已知相对位置；取消原选择不变", async () => {
    const s = imports.start();
    await imports.settled(s.id);
    picked = undefined;
    expect((await imports.pick(s.id)).status).toBe("canceled");
    fs.mkdirSync(path.join(home, ".config"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    for (const p of [home, "/", path.join(home, ".config"), path.join(dir, "data"), dir]) {
      picked = p;
      expect((await imports.pick(s.id)).status).toBe("too_broad");
    }
    put(dir, "work/proj/.claude/skills/p1/SKILL.md", md("p1"));
    put(dir, "work/proj/.codex/skills/p2/SKILL.md", md("p2"));
    put(dir, "work/proj/skills/hidden/SKILL.md", md("hidden"));
    fs.mkdirSync(path.join(dir, "work/proj/.git"));
    picked = path.join(dir, "work/proj");
    const r = await imports.pick(s.id);
    expect(r.status).toBe("picked");
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["p1", "p2"]);
    put(dir, "real/one/SKILL.md", md("one"));
    fs.symlinkSync(path.join(dir, "real/one"), path.join(dir, "linked"));
    picked = path.join(dir, "linked");
    const ask = await imports.pick(s.id);
    expect(ask.status).toBe("confirm");
    expect(ask.link).toMatchObject({ real: path.join(dir, "real/one") });
    const ok = await imports.confirmLink(s.id, true);
    expect(ok.status).toBe("picked");
    expect(ok.candidates.some((c) => c.name === "one")).toBe(true);
  });

  it("旧技能在同一个库里；加到别的机器人时登记进库（名字、内容、开关、来源不变），删机器人不删库", async () => {
    const pkg = await readSkillZip(skillZip([{ path: "SKILL.md", text: skillMd("legacy") }, { path: "references/template.txt", text: "t" }]));
    skills.install("a", pkg, null, { type: "github", owner: "o", repo: "r", path: "", ref: "main", commit: "c", url: "https://github.com/o/r", installedAt: 5 });
    skills.setEnabled("a", "legacy", false);
    skills.mine.create({ name: "my-notes", text: md("my-notes"), meta: { title: "Notes", description: "d", example: "", unverified: false, blocked: [], asks: [], kept: 0, apps: [], uses: [] }, botId: "a", botName: "阿白" });
    const view = skills.libraryView();
    expect(view.map((i) => [i.id, i.kind]).sort()).toEqual([["bot:a:legacy", "bot"], ["mine:my-notes", "mine"]]);
    // 导入同样内容：已存在，不重复入库
    put(home, ".claude/skills/legacy/SKILL.md", skillMd("legacy"));
    put(home, ".claude/skills/legacy/references/template.txt", "t");
    const s = await imports.settled(imports.start().id);
    expect((await imports.preview(s.id, s.candidates.map((c) => c.key))).items[0]).toMatchObject({ status: "exists", existing: { id: "bot:a:legacy" } });
    // 加到 b：登记进库，a 上仍是关着的
    skills.addFromLibrary("b", "bot:a:legacy");
    expect(skills.list("a")).toEqual([]);
    const e = skills.library.get("bot:a:legacy")!;
    expect(e).toMatchObject({ name: "legacy", source: { type: "github", repo: "r" }, uses: { a: { on: false }, b: { on: true } } });
    skills.addFromLibrary("b", "bot:a:legacy");
    expect(Object.keys(skills.library.get("bot:a:legacy")!.uses).sort()).toEqual(["a", "b"]);
    skills.sync("b");
    expect(fs.readFileSync(path.join(deployed("b", "legacy"), "references/template.txt"), "utf8")).toBe("t");
    // 我存的：走它原来的开关
    skills.addFromLibrary("b", "mine:my-notes");
    expect(skills.mine.get("my-notes")!.bots.sort()).toEqual(["a", "b"]);
    // 删机器人 a（App.deleteBot 先清理）：库条目保留，去掉 a 的关系
    skills.cleanup("a");
    store.deleteBot("a");
    expect(skills.library.get("bot:a:legacy")!.uses).not.toHaveProperty("a");
  });

  it("删机器人时它装的旧技能登记进库，不随机器人删掉", async () => {
    const pkg = await readSkillZip(skillZip([{ path: "SKILL.md", text: skillMd("only-a") }]));
    skills.install("a", pkg, null);
    skills.cleanup("a");
    store.deleteBot("a");
    expect(skills.library.get("bot:a:only-a")).toMatchObject({ name: "only-a", uses: {} });
    expect(skills.libraryView().find((i) => i.id === "bot:a:only-a")).toMatchObject({ removable: true });
  });

  it("关闭只影响这个机器人；开着的不能从库移除，任务还在用的也不能；移除只删库里这一份", async () => {
    put(home, ".claude/skills/x/SKILL.md", md("x"));
    const s = await imports.settled(imports.start("a").id);
    const p = await imports.preview(s.id, s.candidates.map((c) => c.key), "a");
    const r = await imports.commit(s.id, { requestId: "req-00000006", previewId: p.preview, items: [{ key: p.items[0].key, action: "import" }], botId: "a" });
    const id = r.items[0].entryId!;
    skills.useLibrary(id, "b", true);
    skills.useLibrary(id, "a", false);
    expect(skills.library.get(id)!.uses).toMatchObject({ a: { on: false }, b: { on: true } });
    expect(() => skills.removeFromLibrary(id, () => false)).toThrow("in_use");
    skills.useLibrary(id, "b", false);
    expect(() => skills.removeFromLibrary(id, (bot) => bot === "b")).toThrow("in_use");
    const digest = skills.library.get(id)!.digest;
    skills.removeFromLibrary(id, () => false);
    expect(skills.library.get(id)).toBeUndefined();
    expect(fs.existsSync(skills.library.packageDir(digest))).toBe(false);
    expect(fs.existsSync(path.join(home, ".claude/skills/x/SKILL.md"))).toBe(true);
  });

  it("机器人容量满了：开启失败、库里的内容保留；只入库不占名额", async () => {
    for (let i = 0; i < 100; i++) skills.install("a", await readSkillZip(skillZip([{ path: "SKILL.md", text: skillMd(`s${i}`) }])), null);
    put(home, ".claude/skills/x/SKILL.md", md("extra"));
    const s = await imports.settled(imports.start("a").id);
    const p = await imports.preview(s.id, s.candidates.map((c) => c.key), "a");
    const r = await imports.commit(s.id, { requestId: "req-00000007", previewId: p.preview, items: [{ key: p.items[0].key, action: "import" }], botId: "a" });
    expect(r.items[0]).toMatchObject({ state: "added", enable: "failed", enableError: "bot_full" });
    expect(skills.library.list()).toHaveLength(1);
  });

  it("原入口（ZIP / GitHub）替换库条目：说明还有哪些机器人在用，所有用它的机器人一同换上完整的新内容", async () => {
    put(home, ".claude/skills/x/SKILL.md", skillMd("shared-skill", "v1"));
    const s = await imports.settled(imports.start("a").id);
    const p = await imports.preview(s.id, s.candidates.map((c) => c.key), "a");
    const r = await imports.commit(s.id, { requestId: "req-00000008", previewId: p.preview, items: [{ key: p.items[0].key, action: "import" }], botId: "a" });
    const id = r.items[0].entryId!;
    skills.useLibrary(id, "b", true);
    const next = await readSkillZip(skillZip([{ path: "SKILL.md", text: skillMd("shared-skill", "v2") }]));
    const pre = skills.preview("a", next);
    expect(pre).toMatchObject({ replaces: skills.library.get(id)!.digest, shared: ["Bob"], replacesSource: { type: "local" } });
    expect(() => skills.install("a", next, "stale")).toThrow("conflict");
    skills.install("a", next, pre.replaces);
    expect(skills.list("a")).toEqual([]);
    expect(skills.library.text(id)).toContain("v2");
    skills.sync("b");
    expect(fs.readFileSync(path.join(deployed("b", "shared-skill"), "SKILL.md"), "utf8")).toContain("v2");
  });

  it("同一机器人同调用名只开一份：库条目开着时，同名的旧技能不能再打开；我存的同名也不能打开", async () => {
    const pkg = await readSkillZip(skillZip([{ path: "SKILL.md", text: skillMd("dup") }]));
    skills.install("a", pkg, null);
    skills.setEnabled("a", "dup", false);
    put(home, ".claude/skills/dup/SKILL.md", md("dup", "other content"));
    const s = await imports.settled(imports.start().id);
    const p = await imports.preview(s.id, s.candidates.map((c) => c.key));
    expect(p.items[0].status).toBe("conflict");
    const r = await imports.commit(s.id, { requestId: "req-00000009", previewId: p.preview, items: [{ key: p.items[0].key, action: "copy" }] });
    skills.useLibrary(r.items[0].entryId!, "a", true);
    expect(() => skills.setEnabled("a", "dup", true)).toThrow("name_on");
    skills.sync("a");
    expect(fs.readFileSync(path.join(deployed("a", "dup"), "SKILL.md"), "utf8")).toContain("other content");
  });
});
