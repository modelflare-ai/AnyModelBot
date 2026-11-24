/**
 * 「我的技能库」和「从本机导入…」的接口（PRD 2026-11-25），不起代理进程：
 * - 没有桌面外壳（命令行 / Docker 打开的网页）时不查找本机技能，只说明原因；
 * - 桌面版：找 → 预览 → 导入并在当前机器人开启 → 机器人设置列表里出现、开关只影响这个机器人 → 从技能库添加到别的机器人 → 从库移除。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("我的技能库接口", () => {
  let app: App, dir: string, home: string, base: string;
  const call = async (p: string, method = "GET", body?: unknown) => {
    const res = await fetch(base + p, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as any };
  };
  beforeAll(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amb-skill-lib-web-")));
    home = path.join(dir, "home");
    fs.mkdirSync(path.join(home, ".claude/skills/weekly-report"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude/skills/weekly-report/SKILL.md"), "---\nname: weekly-report\ndescription: Weekly reports\n---\n# 运营周报\nSteps\n");
    app = new App(loadConfig({ dataDir: path.join(dir, "data"), env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_MAGPIE_API_KEY: "k", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_DEFAULT_MODEL: "m" } }), { printQrToTerminal: false });
    (app.localImports as any).home = home;
    await app.start();
    base = app.web!.url.replace(/\/+$/, "") + "/amb/api";
    app.store.createBot({ id: "other", name: "Other" });
  }, 60_000);
  afterAll(async () => {
    await app?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("不是桌面版：不查找本机技能，说明原因", async () => {
    const lib = await call("/skill-library");
    expect(lib.status).toBe(200);
    expect(lib.body.discover).toEqual({ available: false, reason: "web" });
    const scan = await call("/skill-library/scans", "POST", {});
    expect(scan).toMatchObject({ status: 409, body: { code: "desktop_only", reason: "web" } });
  });

  it("桌面版：找到、预览、导入并在当前机器人开启；开关只影响这个机器人；从库添加到别的机器人；开着时不能移除", async () => {
    (app as any).desktop = { ...(app.desktop ?? {}), pickFolder: async () => undefined };
    expect((await call("/skill-library")).body.discover).toEqual({ available: true });
    let scan = (await call("/skill-library/scans", "POST", { bot: "default" })).body.scan;
    for (let i = 0; scan.state === "scanning" && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 50));
      scan = (await call(`/skill-library/scans/${scan.id}`)).body.scan;
    }
    expect(scan.candidates.map((c: any) => c.name)).toEqual(["weekly-report"]);
    expect(scan.candidates[0].location).toBe("~/.claude/skills/weekly-report");
    // 取消系统选择器：原选择不变
    expect((await call(`/skill-library/scans/${scan.id}/pick`, "POST", {})).body).toMatchObject({ status: "canceled" });
    const preview = (await call(`/skill-library/scans/${scan.id}/preview`, "POST", { keys: [scan.candidates[0].key], bot: "default" })).body;
    expect(preview.items[0]).toMatchObject({ status: "ok", title: "运营周报", name: "weekly-report" });
    expect(preview.bot).toMatchObject({ id: "default" });
    const done = await call(`/skill-library/scans/${scan.id}/import`, "POST", { requestId: "web-req-0001", preview: preview.preview, items: [{ key: preview.items[0].key, action: "import" }], bot: "default" });
    expect(done.status).toBe(200);
    expect(done.body.record.items[0]).toMatchObject({ state: "added", enable: "on" });
    const id = done.body.record.items[0].entryId;
    expect(done.body.skills.find((s: any) => s.library?.id === id)).toMatchObject({ name: "weekly-report", title: "运营周报", enabled: true, source: { type: "local" } });
    // 结果没收到：按请求号查原结果
    expect((await call("/skill-library/imports/web-req-0001")).body.record.items[0].entryId).toBe(id);
    // 库里：本机导入，阿白（default）使用中
    const items = (await call("/skill-library")).body.items;
    expect(items.find((i: any) => i.id === id)).toMatchObject({ kind: "library", source: { type: "local" }, bots: [{ id: "default", on: true }], removable: false });
    // 从技能库添加到另一个机器人；重复添加不重复
    const added = await call("/bots/other/skill-library", "POST", { ids: [id] });
    expect(added.body.results).toEqual([{ id, ok: true }]);
    expect(added.body.skills.find((s: any) => s.library?.id === id)).toMatchObject({ enabled: true });
    await call("/bots/other/skill-library", "POST", { ids: [id] });
    // 关掉 default 上的：other 不受影响
    const off = await call(`/skill-library/items/${encodeURIComponent(id)}/bots/default`, "PUT", { on: false });
    expect(off.body.state).toBe("off");
    const detail = (await call(`/skill-library/items/${encodeURIComponent(id)}`)).body.item;
    expect(detail.bots).toEqual(expect.arrayContaining([{ id: "default", on: false, name: expect.any(String) }, { id: "other", on: true, name: "Other" }]));
    expect(detail.instructions).toContain("Weekly reports");
    expect(detail.paths).toEqual(["SKILL.md"]);
    // other 还开着：不能移除
    expect(await call(`/skill-library/items/${encodeURIComponent(id)}/remove`, "POST", {})).toMatchObject({ status: 409, body: { code: "in_use" } });
    await call(`/skill-library/items/${encodeURIComponent(id)}/bots/other`, "PUT", { on: false });
    expect((await call(`/skill-library/items/${encodeURIComponent(id)}/remove`, "POST", {})).status).toBe(200);
    expect((await call("/skill-library")).body.items.some((i: any) => i.id === id)).toBe(false);
    expect(fs.existsSync(path.join(home, ".claude/skills/weekly-report/SKILL.md"))).toBe(true);
  });
});
