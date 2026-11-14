// 目录 Bot 端到端：真实的 App 和服务端（不起代理进程），走完登记、预览、安装、读状态、放文件、移除。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const ROOT = path.join(import.meta.dirname, "..");
const bot = (...args: string[]) => execFileSync(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(ROOT, "src", "cli", "amb-bot.ts"), ...args], { encoding: "utf8", env: { ...process.env, AMB_DATA_DIR: "" }, stdio: "pipe" });

let tmp: string;
let app: App;
let base: string;
const api = async (p: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}/amb/api${p}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const post = (p: string, body: unknown = {}) => api(p, { method: "POST", body: JSON.stringify(body) });

/** 用命令行起一个 Bot 包，把 TODO 填掉 */
function scaffold(dir: string, id: string): void {
  bot("new", id, "--dir", dir);
  for (const f of ["bot.json", "persona.md", "sample.zh-CN.json", "sample.en.json", "ui/locales/zh-CN.json", "ui/locales/en.json", "evals/tasks.json"]) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("TODO", "filled"));
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amb-botkit-e2e-"));
  app = new App(loadConfig({ dataDir: path.join(tmp, "data"), env: { AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_AGENT: "off" } }), { printQrToTerminal: false });
  await app.start();
  base = app.web!.url.replace(/\/$/, "");
}, 60_000);
afterAll(async () => {
  await app.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("命令行", () => {
  it("模板没填完不能过，填完能过；能生成密钥和算哈希", () => {
    const raw = path.join(tmp, "raw");
    bot("new", "raw-bot", "--dir", raw);
    let out = "";
    try {
      bot("check", raw);
    } catch (e) {
      out = String((e as { stdout?: string }).stdout);
    }
    expect(out).toContain("format.placeholder");
    const good = path.join(tmp, "good");
    scaffold(good, "good-bot");
    expect(bot("check", good)).toContain("静态检查通过");
    expect(bot("keygen")).toContain("CATALOG_PUBLIC_KEY");
    expect(bot("hash", path.join(good, "ui")).trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(() => bot("new", "Bad_ID")).toThrow();
  });
  it("打包、下架、查牵连", () => {
    const root = path.join(tmp, "repo");
    scaffold(path.join(root, "bots", "pack-bot"), "pack-bot");
    const out = path.join(tmp, "dist");
    const key = /私钥[^\n]*\n(\S+)/.exec(bot("keygen"))![1];
    const packed = execFileSync(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(ROOT, "src", "cli", "amb-bot.ts"), "pack", "--root", root, "--out", out], { encoding: "utf8", env: { ...process.env, AMB_CATALOG_PRIVATE_KEY: key } });
    expect(packed).toContain("1 个 Bot");
    expect(fs.existsSync(path.join(out, "index.json.sig"))).toBe(true);
    bot("takedown", "pack-bot", "--root", root, "--reason", "test", "--security");
    expect(JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8")).removed["pack-bot"]).toMatchObject({ reason: "test", security: true });
    expect(bot("who-uses", "nothing", "--root", root)).toContain("没有 Bot");
  });
});

describe("服务端", () => {
  const id = "e2e-bot";
  const inst = `cat-${id}`;
  let dir: string;
  beforeAll(() => {
    dir = path.join(tmp, "dev");
    scaffold(dir, id);
  });

  it("目录是空的：列表为空，现有的机器人不受影响", async () => {
    expect((await api("/catalog")).body.bots).toEqual([]);
    const bots = (await api("/bots")).body.bots;
    expect(bots.every((b: any) => b.origin === "user" && b.app === null)).toBe(true);
  });
  it("坏目录登记不上", async () => {
    expect((await post("/catalog/dev", { dir: path.join(tmp, "nope") })).status).toBe(400);
  });
  it("预览：界面能读，示例数据能读，没有实例", async () => {
    expect((await post("/catalog/dev", { dir })).status).toBe(200);
    const list = (await api("/catalog")).body.bots;
    expect(list.map((b: any) => b.id)).toEqual([id]);
    expect(list[0].dev).toBeUndefined();
    const pv = await post(`/catalog/${id}/preview`);
    expect(pv.body.base).toBe(`/amb/botapp/d/${id}/`);
    const html = await fetch(`${base}${pv.body.base}index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-security-policy")).toContain("connect-src 'none'");
    const file = await api(`/catalog/${id}/file?path=${encodeURIComponent("app/state.json")}`);
    expect(file.body.json.title).toBe("filled sample title");
    const zh = await api(`/catalog/${id}/file?path=${encodeURIComponent("app/state.json")}`, { headers: { "x-amb-lang": "zh-CN" } });
    expect(zh.body.json.title).toBe("filled 示例标题");
    expect((await api("/bots")).body.bots.some((b: any) => b.id === inst)).toBe(false);
    expect(fs.existsSync(path.join(tmp, "data", "workspaces", inst))).toBe(false);
  });
  it("界面套件和设计系统不要令牌也能读到", async () => {
    expect((await fetch(`${base}/amb/botapp/kit/kit.js`)).status).toBe(200);
    expect((await fetch(`${base}/amb/botapp/kit/kit.css`)).status).toBe(200);
    expect((await fetch(`${base}/amb/botapp/kit/vendor/preact.mjs`)).status).toBe(200);
    expect((await fetch(`${base}/amb/botapp/kit/vendor/htm.mjs`)).status).toBe(200);
    expect((await fetch(`${base}/amb/botapp/kit/design/index.css`)).status).toBe(200);
  });
  it("安装：实例带着来源和权限；只有工作区 app/ 能读", async () => {
    const r = await post(`/catalog/${id}/install`);
    expect(r.body.bot).toMatchObject({ id: inst, origin: "catalog", app: { catalogId: id, permissions: ["workspace-write"] } });
    expect((await api(`/bots/${inst}/app`)).body).toMatchObject({ base: `/amb/botapp/d/${id}/`, ref: { catalogId: id } });
    expect((await api(`/bots/${inst}/app/file?path=${encodeURIComponent("app/state.json")}`)).body.json.title).toBe("filled sample title");
    expect((await api(`/bots/${inst}/app/file?path=${encodeURIComponent("../../anymodel.db")}`)).status).toBe(404);
    expect((await api(`/catalog`)).body.bots[0].instanceId).toBe(inst);
  });
  it("普通机器人没有 app 接口", async () => {
    const other = (await api("/bots")).body.bots.find((b: any) => b.origin === "user");
    expect((await api(`/bots/${other.id}/app`)).status).toBe(404);
  });
  it("放文件", async () => {
    const r = await post(`/bots/${inst}/app/inbox`, { name: "a.txt", base64: Buffer.from("hi").toString("base64") });
    expect(r.body).toMatchObject({ path: "app/inbox/a.txt", size: 2 });
    expect(fs.readFileSync(path.join(tmp, "data", "workspaces", inst, "app", "inbox", "a.txt"), "utf8")).toBe("hi");
  });
  it("读图片、列文件、下载、打开：都只在 app/ 下", async () => {
    const q = (p: string) => encodeURIComponent(p);
    const app = path.join(tmp, "data", "workspaces", inst, "app");
    fs.mkdirSync(path.join(app, "out"), { recursive: true });
    fs.writeFileSync(path.join(app, "out", "p.svg"), "<svg/>");
    fs.writeFileSync(path.join(app, "out", "d.pptx"), "PK");
    const image = await api(`/bots/${inst}/app/image?path=${q("app/out/p.svg")}`);
    expect(image.body).toMatchObject({ path: "app/out/p.svg", url: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` });
    expect((await api(`/bots/${inst}/app/image?path=${q("app/out/d.pptx")}`)).status).toBe(404);
    expect((await api(`/bots/${inst}/app/image?path=${q("../../anymodel.db")}`)).status).toBe(404);
    fs.writeFileSync(path.join(app, "out/film.mp4"), "video fixture");
    const media = await fetch(`${base}/amb/api/bots/${inst}/app/media?path=${q("app/out/film.mp4")}`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("video/mp4");
    expect(await media.text()).toBe("video fixture");
    expect((await api(`/bots/${inst}/app/media?path=${q("app/out/p.svg")}`)).status).toBe(404);
    expect((await api(`/bots/${inst}/app/media?path=${q("../../anymodel.db")}`)).status).toBe(404);
    expect((await api(`/bots/${inst}/app/list`)).body.files).toContainEqual({ path: "app/out/d.pptx", size: 2 });
    const res = await fetch(`${base}/amb/api/bots/${inst}/app/download?path=${q("app/out/d.pptx")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.text()).toBe("PK");
    expect((await api(`/bots/${inst}/app/download?path=${q("../../anymodel.db")}`)).status).toBe(404);
    expect((await post(`/bots/${inst}/app/open`, { path: "../../anymodel.db" })).status).toBe(404);
    // 不是桌面版
    const open = await post(`/bots/${inst}/app/open`, { path: "app/out/d.pptx" });
    expect(open.status).toBe(400);
    expect(open.body.code).toBe("desktop_only");
  });
  it("文档和网站预览：只读 app/，HTML 使用隔离资源地址", async () => {
    const dir = path.join(tmp, "data", "workspaces", inst);
    fs.writeFileSync(path.join(dir, "app", "report.md"), "# Workbench report");
    fs.writeFileSync(path.join(dir, "app", "index.html"), '<link rel="stylesheet" href="style.css"><h1>Site</h1>');
    fs.writeFileSync(path.join(dir, "app", "style.css"), "h1 { color: blue; }");
    fs.writeFileSync(path.join(dir, "outside.md"), "outside app/");
    expect((await api(`/bots/${inst}/app/preview?path=app%2Freport.md`)).body).toMatchObject({ kind: "markdown", text: "# Workbench report" });
    for (const p of ["outside.md", "app/../outside.md", "../../anymodel.db"]) expect((await api(`/bots/${inst}/app/preview?path=${encodeURIComponent(p)}`)).status).toBe(404);
    const website = await api(`/bots/${inst}/app/preview?path=app%2Findex.html`);
    expect(website.body.kind).toBe("html");
    const page = new URL(website.body.url, base);
    expect(await (await fetch(page)).text()).toContain("<h1>Site</h1>");
    expect(await (await fetch(new URL("style.css", page))).text()).toContain("color: blue");
    const svg = await api(`/bots/${inst}/app/preview?path=app%2Fout%2Fp.svg`);
    expect(svg.body.kind).toBe("html");
    const download = await fetch(`${base}/amb/api/bots/${inst}/app/download?path=app%2Freport.md&download=1`);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    await download.arrayBuffer();
  });
  it("改过人设就不再跟随目录升级", async () => {
    await api(`/bots/${inst}`, { method: "PUT", body: JSON.stringify({ systemPrompt: "我自己写的" }) });
    expect((await api(`/bots/${inst}/app`)).body.ref.customized).toBe(true);
    expect((await post(`/bots/${inst}/app/update`)).body.result).toBe("customized");
  });
  it("目录 Bot 的工作区和技能都写在数据目录里，移除时按选择清理", async () => {
    const data = path.join(tmp, "data");
    expect(fs.existsSync(path.join(data, "dsh", inst, "skills", "amb-app", "SKILL.md"))).toBe(true);
    expect((await api(`/bots/${inst}?keepData=1`, { method: "DELETE" })).status).toBe(200);
    expect(fs.existsSync(path.join(data, "workspaces", inst, "app", "state.json"))).toBe(true);
    expect(fs.existsSync(path.join(data, "dsh", inst))).toBe(false);
    await post(`/catalog/${id}/install`);
    expect((await api(`/bots/${inst}`, { method: "DELETE" })).status).toBe(200);
    expect(fs.existsSync(path.join(data, "workspaces", inst))).toBe(false);
    expect((await api(`/catalog/dev/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api("/catalog")).body.bots).toEqual([]);
  });
});
