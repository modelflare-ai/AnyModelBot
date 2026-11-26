/**
 * "更新了什么"：更新日志的解析和取法（安装包里的、新版本标签下的）、这一版要不要弹（全新安装不弹、升级上来弹一次）、
 * 管理接口，以及弹窗把版本分成"这次的新内容 / 更早的版本"。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App, appVersion } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store/db.js";
import { changelogFile, fetchChangelog, parseChangelog, readLocalChangelog } from "../src/changelog.js";

const root = path.resolve(import.meta.dirname, "..");
const SAMPLE = `# 更新日志

说明文字。

## 未发布

- 还没发的

## 0.1.30 - 2026-11-10

### 新增

- **Bot 额度：** 左下角显示。

## 0.1.29 - 2026-11-09

- 自动下载更新。

## 0.1.28

## v0.1.27 - 2026-11-08

- 旧的。
`;

describe("更新日志解析", () => {
  it("按版本切开，新的在前；跳过不是 x.y.z 的段落和空版本；版本号前的 v 去掉", () => {
    expect(parseChangelog(SAMPLE)).toEqual([
      { version: "0.1.30", date: "2026-11-10", markdown: "### 新增\n\n- **Bot 额度：** 左下角显示。" },
      { version: "0.1.29", date: "2026-11-09", markdown: "- 自动下载更新。" },
      { version: "0.1.27", date: "2026-11-08", markdown: "- 旧的。" },
    ]);
  });

  it("界面语言对应的文件：简体中文是 CHANGELOG.md，不认识的语言用英文", () => {
    expect(changelogFile("zh-CN")).toBe("CHANGELOG.md");
    expect(changelogFile("zh-TW")).toBe("CHANGELOG_zh-TW.md");
    expect(changelogFile("zh-Hant")).toBe("CHANGELOG_zh-TW.md");
    expect(changelogFile("ja")).toBe("CHANGELOG_ja.md");
    expect(changelogFile("fr")).toBe("CHANGELOG_en.md");
  });

  it("仓库里每种语言的更新日志都读得出来，版本一致，当前版本在里面", () => {
    const versions = (lang: string) => readLocalChangelog(lang, root).map((e) => e.version);
    const zh = versions("zh-CN");
    expect(zh).toContain(appVersion());
    for (const lang of ["zh-TW", "en", "ja", "ko", "ru", "es", "pt", "tr"]) expect(versions(lang)).toEqual(zh);
  });

  it("读不到文件时回空列表", () => {
    expect(readLocalChangelog("en", os.tmpdir())).toEqual([]);
  });
});

describe("新版本的更新日志（升级前）", () => {
  const ok = (text: string) => vi.fn(async (_url: string) => new Response(text, { status: 200 }));

  it("从那个版本标签下取对应语言的文件，缓存在内存里", async () => {
    const f = ok(SAMPLE);
    const a = await fetchChangelog("0.1.30", "zh-CN", f as unknown as typeof fetch);
    expect(a[0].version).toBe("0.1.30");
    expect(f.mock.calls[0][0]).toBe("https://raw.githubusercontent.com/modelflare-ai/AnyModelBot/v0.1.30/CHANGELOG.md");
    await fetchChangelog("0.1.30", "zh-CN", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("里面没有这个版本、HTTP 出错时报错，失败的不缓存；版本号写法不对直接拒绝", async () => {
    await expect(fetchChangelog("0.1.31", "en", ok(SAMPLE) as unknown as typeof fetch)).rejects.toThrow(/0\.1\.31/);
    const bad = vi.fn(async () => new Response("", { status: 404 }));
    await expect(fetchChangelog("0.1.32", "en", bad as unknown as typeof fetch)).rejects.toThrow(/404/);
    const good = ok(SAMPLE.replace("0.1.30", "0.1.32"));
    expect((await fetchChangelog("0.1.32", "en", good as unknown as typeof fetch))[0].version).toBe("0.1.32");
    await expect(fetchChangelog("../x", "en", good as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("这一版要不要弹", () => {
  let app: App | undefined;
  const dirs: string[] = [];
  afterEach(async () => {
    await app?.stop();
    app = undefined;
  });
  const start = async (dataDir: string) => {
    app = new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_MAGPIE_API_KEY: "k", AMB_UI_PORT: "0", AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } }), { printQrToTerminal: false });
    await app.start();
    return app;
  };
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "amb-whatsnew-"));
    dirs.push(d);
    return d;
  };
  const api = async (a: App, p: string, method = "GET") => {
    const r = await fetch(a.web!.url.replace(/\/$/, "") + "/amb/api" + p, { method, headers: method === "POST" ? { "content-type": "application/json" } : {}, body: method === "POST" ? "{}" : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };

  it("全新安装：第一次启动直接记成当前版本，不弹", async () => {
    const a = await start(tmp());
    expect(a.whatsNew()).toEqual({ show: false, current: appVersion(), seen: appVersion() });
  });

  it("升级上来（库已经在、还没有记录）：弹一次这一版，关掉后记下，不再弹", async () => {
    const dir = tmp();
    new Store(path.join(dir, "anymodel.db")).close();
    const a = await start(dir);
    expect((await api(a, "/whats-new")).json).toEqual({ show: true, current: appVersion(), seen: "" });
    expect((await api(a, "/whats-new/seen", "POST")).json).toMatchObject({ show: false, seen: appVersion() });
    expect((await api(a, "/whats-new")).json.show).toBe(false);
  });

  it("看过的是旧版本时弹，比当前还新（装回旧版）时不弹", async () => {
    const dir = tmp();
    const s = new Store(path.join(dir, "anymodel.db"));
    s.setKV("whatsNew.seen", "0.0.1");
    s.close();
    const a = await start(dir);
    expect(a.whatsNew()).toMatchObject({ show: true, seen: "0.0.1" });
    a.store.setKV("whatsNew.seen", "99.0.0");
    expect(a.whatsNew().show).toBe(false);
  });

  it("接口：不带版本时给安装包里的更新日志（按语言）；不认识的版本号 400", async () => {
    const a = await start(tmp());
    const local = await api(a, "/changelog?lang=en");
    expect(local.status).toBe(200);
    expect(local.json.version).toBe(appVersion());
    expect(local.json.entries[0]).toMatchObject({ version: appVersion() });
    expect(local.json.entries[0].markdown).toMatch(/[A-Za-z]/);
    expect((await api(a, "/changelog?lang=en&version=99.0.0")).status).toBe(400);
  });

  it("接口：检查到的新版本去取那个版本标签下的更新日志；取不到时 502 并给出发布页", async () => {
    const a = await start(tmp());
    const [major, minor, patch] = appVersion().split(".").map(Number);
    const latest = `${major}.${minor}.${patch + 1}`;
    const releaseUrl = `https://github.com/modelflare-ai/AnyModelBot/releases/tag/v${latest}`;
    const status = a.updates.status();
    vi.spyOn(a.updates, "status").mockReturnValue({ ...status, available: true, latest, releaseUrl });
    const real = globalThis.fetch;
    let remote = SAMPLE.replace("0.1.30", latest);
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (!u.startsWith("https://raw.githubusercontent.com/")) return real(url, init);
      seen.push(u);
      return remote ? new Response(remote) : new Response("", { status: 404 });
    });
    try {
      const r = await api(a, `/changelog?lang=ja&version=${latest}`);
      expect(r.status).toBe(200);
      expect(r.json.entries[0].version).toBe(latest);
      expect(seen).toEqual([`https://raw.githubusercontent.com/modelflare-ai/AnyModelBot/v${latest}/CHANGELOG_ja.md`]);
      remote = "";
      const failed = await api(a, `/changelog?lang=ko&version=${latest}`);
      expect(failed.status).toBe(502);
      expect(failed.json.releaseUrl).toBe(releaseUrl);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("打包", () => {
  it("安装包和 Docker 镜像里都带上更新日志", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.build.files).toContain("CHANGELOG*.md");
    expect(fs.readFileSync(path.join(root, "Dockerfile"), "utf8")).toMatch(/^COPY .*CHANGELOG\*\.md/m);
  });
});

describe("界面：弹窗里的版本分组", () => {
  const load = async () => {
    (globalThis as any).window ??= { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    (globalThis as any).document ??= { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} };
    (globalThis as any).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
    // @ts-expect-error 界面代码是不经构建的 JS
    return import("../ui/components/whats-new.js");
  };
  const e = (version: string) => ({ version, date: "", markdown: "-" });
  const list = [e("0.1.31"), e("0.1.30"), e("0.1.29"), e("0.1.28"), e("0.1.10")];
  const v = (xs: Array<{ version: string }>) => xs.map((x) => x.version);

  it("版本号按数字比较", async () => {
    const { cmpVersion } = await load();
    expect(cmpVersion("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(cmpVersion("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(cmpVersion("1.0.0", "1.0.0")).toBe(0);
  });

  it("升级后：看过的版本之后、到当前为止都算新内容（跳过的版本一起列），更早的全部接在下面", async () => {
    const { splitEntries } = await load();
    const r = splitEntries(list, "0.1.30", "0.1.28");
    expect(v(r.fresh)).toEqual(["0.1.30", "0.1.29"]);
    expect(v(r.older)).toEqual(["0.1.28", "0.1.10"]);
  });

  it("不知道看过哪一版（从没有这个功能的版本升上来）：只算当前这一版", async () => {
    const { splitEntries } = await load();
    const r = splitEntries(list, "0.1.30", "");
    expect(v(r.fresh)).toEqual(["0.1.30"]);
    expect(v(r.older)).toEqual(["0.1.29", "0.1.28", "0.1.10"]);
  });

  it("升级前：本机版本之后到新版本都是新内容；比新版本还新的不列", async () => {
    const { splitEntries } = await load();
    const r = splitEntries(list, "0.1.30", "0.1.29");
    expect(v(r.fresh)).toEqual(["0.1.30"]);
    expect(v(r.older)).toEqual(["0.1.29", "0.1.28", "0.1.10"]);
  });
});
