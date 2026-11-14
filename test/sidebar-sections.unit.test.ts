/**
 * 侧栏分组：服务端怎么整理收到的布局（domain/sidebar-layout.ts），界面怎么把新行放进分组、移动行和分组、新建 / 改名 / 删除分组（ui/lib/sections.js），
 * 以及 GET / PUT /sidebar-layout 存取一趟。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeSidebarLayout, MAX_SECTION_NAME } from "../src/domain/sidebar-layout.js";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const load = async () => {
  // 界面模块在浏览器里跑：只补上它们加载时要的那一点
  (globalThis as any).window ??= { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  (globalThis as any).document ??= { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} };
  (globalThis as any).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  // @ts-expect-error 界面代码是不经构建的 JS
  return await import("../ui/lib/sections.js");
};

const bot = (id: string, catalogId?: string) => ({ id, name: id, ...(catalogId ? { app: { catalogId } } : {}) });
const entry = (id: string, used = false) => ({ id, ...(used ? { instanceId: `cat-${id}` } : {}) });
const items = (layout: any) => Object.fromEntries(layout.sections.map((s: any) => [s.id, s.items]));

describe("sanitizeSidebarLayout", () => {
  it("不是分组列表、一个合法分组都没有时返回 null", () => {
    expect(sanitizeSidebarLayout(null)).toBeNull();
    expect(sanitizeSidebarLayout({ sections: "x" })).toBeNull();
    expect(sanitizeSidebarLayout({ sections: [{ id: "坏 id", items: [] }, { items: [] }] })).toBeNull();
  });

  it("一行只留在第一个分组里；坏键、重复 id 丢掉；名字压成一行并截断", () => {
    const out = sanitizeSidebarLayout({
      sections: [
        { id: "a", name: "  工作\n  项目 ", items: ["b:1", "b:1", "g:2", "x:3", "b:has space", 5] },
        { id: "a", name: "重复", items: ["b:9"] },
        { id: "b", name: "长".repeat(80), items: ["b:1", "c:ppt"] },
      ],
    })!;
    expect(out.sections.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out.sections[0]).toMatchObject({ name: "工作 项目", items: ["b:1", "g:2"] });
    expect(out.sections[1].items).toEqual(["c:ppt"]);
    expect(out.sections[1].name).toHaveLength(MAX_SECTION_NAME);
  });

  it("默认分组和收件分组各至多一个；没有默认分组时第一个就是", () => {
    const none = sanitizeSidebarLayout({ sections: [{ id: "a", items: [] }, { id: "b", inbox: true, items: [] }, { id: "c", inbox: true, items: [] }] })!;
    expect(none.sections.map((s) => [s.id, !!s.default, !!s.inbox])).toEqual([["a", true, false], ["b", false, true], ["c", false, false]]);
    const two = sanitizeSidebarLayout({ sections: [{ id: "a", items: [] }, { id: "b", default: true, items: [] }, { id: "c", default: true, items: [] }] })!;
    expect(two.sections.filter((s) => s.default).map((s) => s.id)).toEqual(["b"]);
  });

  it("预设只认 mine / latest", () => {
    const out = sanitizeSidebarLayout({ sections: [{ id: "a", preset: "mine", items: [] }, { id: "b", preset: "其他", items: [] }] })!;
    expect(out.sections.map((s) => s.preset)).toEqual(["mine", undefined]);
  });
});

describe("界面：新行放进哪个分组（place）", () => {
  it("机器人、群聊进默认分组末尾，没用过的目录 Bot 按目录顺序进「上新」最上面；用过的目录 Bot 跟着它的机器人", async () => {
    const S = await load();
    const base = S.defaultLayout();
    base.sections[1].items = ["c:old"];
    const out = S.place(base, {
      bots: [bot("a"), bot("cat-used", "used")],
      groups: [{ id: "g1" }],
      catalog: [entry("new1"), entry("new2"), entry("used", true), entry("old")],
    });
    expect(items(out)).toEqual({ mine: ["b:a", "c:used", "g:g1"], latest: ["c:new1", "c:new2", "c:old"] });
  });

  it("没有要放的时候原样返回同一个对象；某一类还没读到（null）时先不动", async () => {
    const S = await load();
    const once = S.place(S.defaultLayout(), { bots: [bot("a")], groups: null, catalog: null });
    expect(items(once)).toEqual({ mine: ["b:a"], latest: [] });
    expect(S.place(once, { bots: [bot("a")], groups: [], catalog: [] })).toBe(once);
  });

  it("目录 Bot 用过之后留在原来的分组里（同一个键）", async () => {
    const S = await load();
    const before = S.place(S.defaultLayout(), { bots: [], groups: [], catalog: [entry("ppt")] });
    const moved = S.moveItem(before, "c:ppt", "mine");
    expect(S.place(moved, { bots: [bot("cat-ppt", "ppt")], groups: [], catalog: [entry("ppt", true)] })).toBe(moved);
    expect(S.sectionOf(moved, S.keyOfBot(bot("cat-ppt", "ppt"))).id).toBe("mine");
  });

  it("打开应用时丢掉已经删掉的机器人和群聊的键，目录 Bot 的键留着；没有要丢的原样返回", async () => {
    const S = await load();
    const l = S.place(S.defaultLayout(), { bots: [bot("a"), bot("gone"), bot("cat-ppt", "ppt")], groups: [{ id: "g" }, { id: "old" }], catalog: [entry("x")] });
    const alive = new Set(["b:a", "g:g"]);
    const out = S.prune(l, (k: string) => alive.has(k));
    expect(items(out)).toEqual({ mine: ["b:a", "c:ppt", "g:g"], latest: ["c:x"] });
    expect(S.prune(out, (k: string) => alive.has(k))).toBe(out);
  });

  it("「上新」删掉之后，新上架的目录 Bot 不进任何分组", async () => {
    const S = await load();
    const { layout } = S.deleteSection(S.defaultLayout(), "latest", () => true);
    expect(items(S.place(layout, { bots: [], groups: [], catalog: [entry("x")] }))).toEqual({ mine: [] });
  });
});

describe("界面：移动、新建、改名、删除", () => {
  const start = async () => {
    const S = await load();
    const l = S.place(S.defaultLayout(), { bots: [bot("a"), bot("b"), bot("c")], groups: [{ id: "g" }], catalog: [entry("x")] });
    return { S, l };
  };

  it("行移到别的分组的某一行前面或末尾；移到自己前面不动", async () => {
    const { S, l } = await start();
    expect(items(S.moveItem(l, "b:c", "mine", "b:a")).mine).toEqual(["b:c", "b:a", "b:b", "g:g"]);
    expect(items(S.moveItem(l, "b:a", "latest"))).toEqual({ mine: ["b:b", "b:c", "g:g"], latest: ["c:x", "b:a"] });
    expect(S.moveItem(l, "b:a", "mine", "b:a")).toBe(l);
    expect(S.moveItem(l, "b:a", "没有这个分组")).toBe(l);
  });

  it("分组移到另一个分组前面或最后", async () => {
    const { S, l } = await start();
    const { layout: three } = S.addSection(l, "工作");
    const id = three.sections[2].id;
    expect(S.moveSection(three, id, "mine").sections.map((s: any) => s.id)).toEqual([id, "mine", "latest"]);
    expect(S.moveSection(three, "mine", null).sections.map((s: any) => s.id)).toEqual(["latest", id, "mine"]);
  });

  it("新建分组可以放在某个分组后面，并把行一起带过去", async () => {
    const { S, l } = await start();
    const { layout, id } = S.addSection(l, "工作", { afterId: "mine", items: ["b:b", "g:g"] });
    expect(layout.sections.map((s: any) => s.id)).toEqual(["mine", id, "latest"]);
    expect(items(layout)).toEqual({ mine: ["b:a", "b:c"], [id]: ["b:b", "g:g"], latest: ["c:x"] });
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it("改名压成一行、截到 40 个字；原布局不变", async () => {
    const { S, l } = await start();
    const out = S.renameSection(l, "mine", "  日常\t工具  ");
    expect(out.sections[0].name).toBe("日常 工具");
    expect(l.sections[0].name).toBe("");
  });

  it("删分组：机器人和群聊移到默认分组，没用过的目录 Bot 丢掉；删默认分组时剩下的第一个接着当；只剩一个不删", async () => {
    const { S, l } = await start();
    const { layout: withWork, id } = S.addSection(l, "工作", { items: ["b:b", "c:x"] });
    const keep = (k: string) => k.startsWith("b:") || k.startsWith("g:");
    const del = S.deleteSection(withWork, id, keep);
    expect(del.to.id).toBe("mine");
    expect(items(del.layout)).toEqual({ mine: ["b:a", "b:c", "g:g", "b:b"], latest: [] });

    const delDefault = S.deleteSection(l, "mine", keep);
    expect(delDefault.layout.sections).toMatchObject([{ id: "latest", default: true, inbox: true, items: ["c:x", "b:a", "b:b", "b:c", "g:g"] }]);
    expect(S.deleteSection(delDefault.layout, "latest", keep).layout).toBe(delDefault.layout);
  });
});

describe("GET / PUT /sidebar-layout", () => {
  let app: App;
  let base: string;
  let dataDir: string;
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-sidebar-layout-"));
    const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_MAGPIE_API_KEY: "x", AMB_UI_PORT: "0", AMB_AGENT: "off" } });
    app = new App(config, { printQrToTerminal: false });
    await app.start();
    base = app.web!.url.replace(/\/$/, "") + "/amb/api/sidebar-layout";
  });
  afterAll(async () => {
    await app?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const put = (layout: unknown) => fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout }) });

  it("还没存过时是 null；存进去的按整理后的样子读回来；坏的布局 400 且不覆盖", async () => {
    expect(await (await fetch(base)).json()).toEqual({ layout: null });
    const res = await put({ sections: [{ id: "mine", preset: "mine", items: ["b:1", "b:1"] }, { id: "s-1", name: " 工作 ", items: ["g:2"] }] });
    expect(res.status).toBe(200);
    const saved = { version: 1, sections: [{ id: "mine", name: "", preset: "mine", default: true, items: ["b:1"] }, { id: "s-1", name: "工作", items: ["g:2"] }] };
    expect((await res.json()).layout).toEqual(saved);
    expect((await put({ sections: [] })).status).toBe(400);
    expect((await (await fetch(base)).json()).layout).toEqual(saved);
  });
});

describe("移除的官方 Bot", () => {
  it("从全部分组移除且目录同步不会放回；重新添加进入默认分组末尾", async () => {
    const S = await load();
    const base = S.place(S.defaultLayout(), { bots: [bot("a"), bot("cat-old", "old")], groups: [], catalog: [entry("new")] });
    const removed = S.place(base, { bots: [bot("a")], groups: [], catalog: [{ ...entry("old"), userRemoved: true }, entry("new")] });
    expect(items(removed)).toEqual({ mine: ["b:a"], latest: ["c:new"] });
    expect(S.place(removed, { bots: [bot("a")], groups: [], catalog: [{ ...entry("old"), userRemoved: true }, entry("new")] })).toBe(removed);
    const added = S.place(removed, { bots: [bot("a"), bot("cat-old", "old")], groups: [], catalog: [entry("old", true), entry("new")] });
    expect(items(added)).toEqual({ mine: ["b:a", "c:old"], latest: ["c:new"] });
  });
});
