/**
 * 对话里交付的文件：哪些文件能给（这个会话交付过的、这个机器人工作区里的；数据目录的其它地方、.. 、符号链接逃出去、硬链接都不给），
 * 浏览器里怎么给（只有图片、PDF、纯文本直接显示，其余下载，都带 nosniff / CSP sandbox），桌面版打开 / 在文件夹中显示，
 * 以及历史里存下的说的话和文件（重启后照样在、照样能打开）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App, type DesktopHooks } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store/db.js";
import { botWorkspace, describeFile, fileHeaders, resolveFile, runnable } from "../src/web/files.js";

const isWin = process.platform === "win32";
/** 符号链接、硬链接在有的环境里建不了（Windows 没开开发者模式）：建不了就跳过那一条 */
function tryLink(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

function layout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amb-files-")));
  const data = path.join(root, "data");
  const ws = path.join(data, "workspaces", "b1");
  const other = path.join(data, "workspaces", "b2");
  const outside = path.join(root, "outside");
  for (const d of [ws, other, outside, path.join(ws, "out"), path.join(data, "dsh", "b1")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(data, "anymodel.db"), "SQLite format 3");
  fs.writeFileSync(path.join(data, "ui-token"), "SECRET-TOKEN");
  fs.writeFileSync(path.join(data, "dsh", "b1", "config.yaml"), "key: x");
  fs.writeFileSync(path.join(other, "theirs.txt"), "other bot");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
  fs.writeFileSync(path.join(ws, "out", "cover.png"), Buffer.from("89504e470d0a1a0a0000", "hex"));
  fs.writeFileSync(path.join(ws, "page.html"), "<script>alert(1)</script>");
  fs.writeFileSync(path.join(ws, "run.bat"), "echo hi");
  return { root, data, ws, other, outside };
}

describe("哪些文件能给", () => {
  const L = layout();
  const scope = (delivered: string[] = []) => ({ workspace: L.ws, dataDir: L.data, delivered });
  const ok = (p: string, delivered?: string[]) => resolveFile(p, scope(delivered))?.path;

  it("工作区里的文件：绝对路径和相对工作区的路径都行，给的是真实路径", () => {
    const png = path.join(L.ws, "out", "cover.png");
    expect(ok(png)).toBe(png);
    expect(ok("out/cover.png")).toBe(png);
    expect(resolveFile(png, scope())).toMatchObject({ size: 10 });
  });

  it("路径里有 .. 一律不给（哪怕解析完还在工作区里）", () => {
    expect(ok("../../anymodel.db")).toBeUndefined();
    expect(ok("out/../out/cover.png")).toBeUndefined();
    expect(ok(path.join(L.ws, "..", "..", "ui-token"))).toBeUndefined();
    expect(ok(`${L.ws}${path.sep}..${path.sep}b2${path.sep}theirs.txt`)).toBeUndefined();
  });

  it("工作区外、没交付过的不给；数据目录里工作区以外的地方（数据库、令牌、DSH 配置、别的机器人）交付过也不给", () => {
    expect(ok(path.join(L.outside, "secret.txt"))).toBeUndefined();
    for (const p of [path.join(L.data, "anymodel.db"), path.join(L.data, "ui-token"), path.join(L.data, "dsh", "b1", "config.yaml"), path.join(L.other, "theirs.txt")]) {
      expect(ok(p)).toBeUndefined();
      expect(ok(p, [p])).toBeUndefined();
    }
  });

  it("这个会话交付过的文件（不在数据目录里）能给", () => {
    const p = path.join(L.outside, "secret.txt");
    expect(ok(p, [p])).toBe(p);
  });

  it("符号链接逃出工作区：指向外面的文件、数据库、外面的文件夹，都不给", () => {
    const made =
      tryLink(() => fs.symlinkSync(path.join(L.outside, "secret.txt"), path.join(L.ws, "link.txt"))) &&
      tryLink(() => fs.symlinkSync(path.join(L.data, "anymodel.db"), path.join(L.ws, "db-link"))) &&
      tryLink(() => fs.symlinkSync(L.outside, path.join(L.ws, "outdir"), "dir"));
    if (!made) return;
    expect(ok("link.txt")).toBeUndefined();
    expect(ok(path.join(L.ws, "db-link"))).toBeUndefined();
    expect(ok("outdir/secret.txt")).toBeUndefined();
    // 交付过的是链接本身：解析完是数据库，照样不给
    expect(ok(path.join(L.ws, "db-link"), [path.join(L.ws, "db-link")])).toBeUndefined();
  });

  it("硬链接不给（看不出指向哪里）；文件夹、不存在的、带 NUL 的都不给", () => {
    if (tryLink(() => fs.linkSync(path.join(L.data, "anymodel.db"), path.join(L.ws, "hard.db")))) expect(ok("hard.db")).toBeUndefined();
    expect(ok("out")).toBeUndefined();
    expect(ok("nope.txt")).toBeUndefined();
    expect(ok("out/cover.png\0.txt")).toBeUndefined();
    expect(ok("")).toBeUndefined();
  });

  it("机器人 id 不是普通名字时没有工作区", () => {
    expect(botWorkspace(L.data, "b1")).toBe(L.ws);
    for (const id of ["..", "../b2", "a/b", "", ".hidden"]) expect(botWorkspace(L.data, id)).toBeUndefined();
  });

  it("界面上的样子：名字、大小、是不是直接显示的图片；不在了标 gone", () => {
    expect(describeFile(path.join(L.ws, "out", "cover.png"))).toEqual({ path: path.join(L.ws, "out", "cover.png"), name: "cover.png", size: 10, image: true });
    expect(describeFile(path.join(L.ws, "page.html"))).toMatchObject({ name: "page.html", size: 25 });
    expect(describeFile(path.join(L.ws, "page.html")).image).toBeUndefined();
    expect(describeFile(path.join(L.ws, "gone.svg"))).toEqual({ path: path.join(L.ws, "gone.svg"), name: "gone.svg", gone: true });
  });
});

describe("浏览器里怎么给", () => {
  it("图片（SVG 除外）、PDF、纯文本直接显示，其余一律下载；都带 nosniff，PDF 以外都有 CSP sandbox", () => {
    for (const [name, type] of [["a.png", "image/png"], ["a.JPG", "image/jpeg"], ["a.webp", "image/webp"], ["a.txt", "text/plain; charset=utf-8"], ["a.json", "text/plain; charset=utf-8"]]) {
      const h = fileHeaders(name);
      expect(h["content-type"]).toBe(type);
      expect(h["content-disposition"]).toMatch(/^inline;/);
      expect(h["content-security-policy"]).toBe("sandbox");
      expect(h["x-content-type-options"]).toBe("nosniff");
    }
    const pdf = fileHeaders("a.pdf");
    expect(pdf).toMatchObject({ "content-type": "application/pdf", "x-content-type-options": "nosniff" });
    expect(pdf["content-disposition"]).toMatch(/^inline;/);
    expect(pdf["content-security-policy"]).toBeUndefined();
    for (const name of ["a.html", "a.htm", "a.svg", "a.xml", "a.js", "a.mjs", "a.xhtml", "a.exe", "noext"]) {
      const h = fileHeaders(name);
      expect(h["content-type"]).toBe("application/octet-stream");
      expect(h["content-disposition"]).toMatch(/^attachment;/);
      expect(h["content-security-policy"]).toBe("sandbox");
      expect(h["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("中文文件名：filename 是 ASCII 兜底，filename* 是 UTF-8", () => {
    expect(fileHeaders("报告 \"v2\".pdf")["content-disposition"]).toBe(`inline; filename="__ _v2_.pdf"; filename*=UTF-8''${encodeURIComponent("报告 \"v2\".pdf")}`);
  });

  it("桌面版打开就会运行的文件只在文件夹中显示", () => {
    for (const n of ["a.exe", "a.BAT", "a.cmd", "a.ps1", "a.js", "a.vbs", "a.lnk", "a.sh", "a.command", "a.jar", "a.py"]) expect(runnable({ path: n, mode: 0o644 })).toBe(true);
    for (const n of ["a.png", "a.pdf", "a.txt", "a.docx", "a.html", "a.md"]) expect(runnable({ path: n, mode: 0o755 })).toBe(false);
    expect(runnable({ path: "/w/tool", mode: 0o755 })).toBe(!isWin);
    expect(runnable({ path: "/w/notes", mode: 0o644 })).toBe(false);
  });
});

describe("接口与历史", () => {
  let app: App;
  let base: string;
  let dataDir: string;
  let ws: string;
  const conv = "default:web:console";
  const enc = encodeURIComponent;
  const opened: Array<[string, string]> = [];
  const get = (p: string, headers: Record<string, string> = {}) => fetch(`${base}/conversations/${enc(conv)}/file?path=${enc(p)}`, { headers });
  const post = (action: string, p: string) => fetch(`${base}/conversations/${enc(conv)}/file/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: p }) });

  beforeAll(async () => {
    dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amb-files-app-")));
    app = new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_MAGPIE_API_KEY: "k", AMB_UI_PORT: "0", AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } }), { printQrToTerminal: false });
    await app.start();
    base = app.web!.url.replace(/\/$/, "") + "/amb/api";
    ws = path.join(dataDir, "workspaces", "default");
    fs.mkdirSync(path.join(ws, "out"), { recursive: true });
    fs.writeFileSync(path.join(ws, "out", "cover.png"), Buffer.from("89504e470d0a1a0a0000", "hex"));
    fs.writeFileSync(path.join(ws, "out", "page.html"), "<script>alert(1)</script>");
    fs.writeFileSync(path.join(ws, "out", "run.bat"), "echo hi");
    app.store.ensureConversation("default", "web", "console", "控制台");
    app.store.addMessage(conv, "user", "做张图");
    app.store.addMessage(conv, "assistant", "做好了。", [{ id: "m1.1", kind: "model", title: "m", status: "ok", at: 1 }], {
      interim: ["我先看看。", "开始画。"],
      files: [path.join(ws, "out", "cover.png"), path.join(ws, "out", "page.html"), path.join(ws, "out", "gone.pdf")],
    });
  });
  afterAll(async () => {
    await app?.stop();
  });

  it("GET /chat：历史里有说的话和文件（名字、大小、图片、不在了），网页里 canOpen 是 false", async () => {
    const d = (await (await fetch(`${base}/bots/default/chat`)).json()) as any;
    expect(d.canOpen).toBe(false);
    const m = d.messages.at(-1);
    expect(m).toMatchObject({ role: "assistant", content: "做好了。", interim: ["我先看看。", "开始画。"], steps: 1 });
    expect(m.files).toEqual([
      { path: path.join(ws, "out", "cover.png"), name: "cover.png", size: 10, image: true },
      { path: path.join(ws, "out", "page.html"), name: "page.html", size: 25 },
      { path: path.join(ws, "out", "gone.pdf"), name: "gone.pdf", gone: true },
    ]);
    const c = (await (await fetch(`${base}/conversations/${enc(conv)}/messages`)).json()) as any;
    expect(c.messages.at(-1).files[0].image).toBe(true);
    expect(c.messages.at(-1).interim).toEqual(["我先看看。", "开始画。"]);
  });

  it("图片直接显示，HTML 下载；没变时 304", async () => {
    const r = await get(path.join(ws, "out", "cover.png"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toMatch(/^inline; filename="cover.png"/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("sandbox");
    expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await r.arrayBuffer()).toString("hex")).toBe("89504e470d0a1a0a0000");
    const again = await get(path.join(ws, "out", "cover.png"), { "if-none-match": r.headers.get("etag")! });
    expect(again.status).toBe(304);
    const h = await get("out/page.html");
    expect(h.status).toBe(200);
    expect(h.headers.get("content-type")).toBe("application/octet-stream");
    expect(h.headers.get("content-disposition")).toMatch(/^attachment;/);
    await h.arrayBuffer();
  });

  it("数据库、令牌、.. 、不存在的文件、别的会话：404", async () => {
    fs.writeFileSync(path.join(dataDir, "ui-token"), "SECRET");
    for (const p of [path.join(dataDir, "anymodel.db"), path.join(dataDir, "ui-token"), "../../anymodel.db", path.join(ws, "..", "..", "anymodel.db"), path.join(ws, "out", "gone.pdf")]) {
      const r = await get(p);
      expect(r.status).toBe(404);
      expect(((await r.json()) as any).error).toBe("找不到这个文件");
    }
    const r = await fetch(`${base}/conversations/${enc("nope:web:console")}/file?path=${enc(path.join(ws, "out", "cover.png"))}`);
    expect(r.status).toBe(404);
    await r.arrayBuffer();
  });

  it("桌面版：打开用系统程序（打开就会运行的只在文件夹中显示）；在文件夹中显示；越界的不碰；网页里没有这两个操作", async () => {
    const web = await post("open", path.join(ws, "out", "cover.png"));
    expect(web.status).toBe(400);
    await web.arrayBuffer();
    const hooks: Partial<DesktopHooks> = { openPath: (p) => void opened.push(["open", p]), showItemInFolder: (p) => void opened.push(["reveal", p]) };
    app.desktop = hooks as DesktopHooks;
    try {
      const d = (await (await fetch(`${base}/bots/default/chat`)).json()) as any;
      expect(d.canOpen).toBe(true);
      expect(await (await post("open", path.join(ws, "out", "cover.png"))).json()).toEqual({ ok: true });
      expect(await (await post("open", path.join(ws, "out", "run.bat"))).json()).toEqual({ ok: true, revealed: true });
      expect(await (await post("reveal", "out/page.html")).json()).toEqual({ ok: true, revealed: true });
      for (const p of [path.join(dataDir, "anymodel.db"), "../../anymodel.db"]) {
        const r = await post("open", p);
        expect(r.status).toBe(404);
        await r.arrayBuffer();
      }
      expect(opened).toEqual([
        ["open", path.join(ws, "out", "cover.png")],
        ["reveal", path.join(ws, "out", "run.bat")],
        ["reveal", path.join(ws, "out", "page.html")],
      ]);
    } finally {
      app.desktop = undefined;
    }
  });

  it("重启之后：存下的说的话和文件照样在，交付过的文件照样认得", () => {
    const file = path.join(dataDir, "restart.db");
    const s1 = new Store(file);
    s1.createBot({ id: "b1", name: "x" });
    s1.ensureConversation("b1", "web", "console", "x");
    s1.addMessage("b1:web:console", "assistant", "好了", undefined, { interim: ["先看看"], files: ["/w/a.png", "/w/b.pdf"] });
    s1.addMessage("b1:web:console", "assistant", "又一个", undefined, { files: ["/w/a.png"] });
    s1.close();
    const s2 = new Store(file);
    expect(s2.listMessages("b1:web:console").map((m) => [m.content, m.interim, m.files])).toEqual([
      ["好了", ["先看看"], ["/w/a.png", "/w/b.pdf"]],
      ["又一个", undefined, ["/w/a.png"]],
    ]);
    expect(s2.deliveredFiles("b1:web:console")).toEqual(["/w/a.png", "/w/b.pdf"]);
    s2.close();
  });
});

describe("界面：交付的文件", () => {
  /** 组件返回的 vnode 树里找节点（htm 生成的是 preact 的 vnode：type + props.children） */
  function find(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
    if (Array.isArray(node)) node.forEach((n) => find(n, pred, out));
    else if (node && typeof node === "object") {
      if (pred(node)) out.push(node);
      find(node.props?.children, pred, out);
    }
    return out;
  }
  const load = async () => {
    (globalThis as any).window ??= { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    // @ts-expect-error 界面代码是不经构建的 JS
    const files = await import("../ui/components/files.js");
    // @ts-expect-error 同上
    const ui = await import("../ui/lib/i18n.js");
    ui.setLangPref("zh-CN");
    return files;
  };
  const conv = "b1:web:console";
  const pdf = { path: "/d/workspaces/b1/报告.pdf", name: "报告.pdf", size: 1258291 };
  const url = `/amb/api/conversations/${encodeURIComponent(conv)}/file?path=${encodeURIComponent(pdf.path)}`;

  it("网页：整张卡片是链接，在新标签页打开；名字下面是大小；没有「在文件夹中显示」", async () => {
    const { FileCard, fileUrl } = await load();
    expect(fileUrl(conv, pdf.path)).toBe(url);
    const v = FileCard({ file: pdf, conv, canOpen: false });
    expect(v.type).toBe("a");
    expect(v.props).toMatchObject({ class: "file-card", href: url, target: "_blank", rel: "noopener", title: "打开 报告.pdf" });
    expect(find(v, (n) => n.props?.class === "fsub num")[0].props.children).toBe("1.2 MB");
    expect(find(v, (n) => n.props?.icon === "folder")).toHaveLength(0);
  });

  it("桌面版：点卡片用系统程序打开，右边是「在文件夹中显示」；找不到的文件不能点", async () => {
    const { FileCard } = await load();
    const v = FileCard({ file: pdf, conv, canOpen: true });
    expect(v.type).toBe("div");
    expect(find(v, (n) => n.type === "button" && n.props?.class === "file-open")).toHaveLength(1);
    expect(find(v, (n) => n.props?.icon === "folder")[0].props.label).toBe("在文件夹中显示");
    const gone = FileCard({ file: { ...pdf, gone: true }, conv, canOpen: true });
    expect(gone.props.class).toBe("file-card off");
    expect(find(gone, (n) => n.type === "a" || n.type === "button")).toHaveLength(0);
    expect(find(gone, (n) => n.props?.class === "fsub num")[0].props.children).toBe("找不到文件");
  });

  it("图片：缩略图直接显示，网页里点开是新标签页，桌面版是按钮；其它文件是卡片", async () => {
    const { ImageFile, DeliveredFiles } = await load();
    const png = { path: "/d/workspaces/b1/cover.png", name: "cover.png", size: 10, image: true };
    // ImageFile 用了 useState：在组件外调用时给它一个假的 hooks 环境太麻烦，这里看 DeliveredFiles 把图片和文件分给谁
    const list = DeliveredFiles({ files: [png, pdf], conv, canOpen: false });
    const kids = find(list, (n) => n.type === ImageFile || (n.type && n.type.name === "FileCard"));
    expect(kids.map((k) => k.props.file.name)).toEqual(["cover.png", "报告.pdf"]);
    expect(DeliveredFiles({ files: [], conv, canOpen: false })).toBeNull();
  });
});
