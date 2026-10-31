// 新手引导（上手清单）：进度的规整、从数据推导已做过的步骤、/guide 接口与 config.json 持久化。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { GUIDE_STEPS, deriveGuide, mergeGuide, normalizeGuide } from "../src/guide.js";

describe("引导进度", () => {
  it("规整：只留认识的步骤并按清单排序，seen 去重、过滤非法 id", () => {
    expect(normalizeGuide(undefined)).toEqual({ done: [], hidden: false, seen: [] });
    expect(normalizeGuide({ done: ["media", "hello", "nope", "hello"], hidden: true, seen: ["intro", "intro", "bad id!", 3] })).toEqual({
      done: ["hello", "media"],
      hidden: true,
      seen: ["intro"],
    });
  });

  it("推导：有过回复、换过模型、绑了渠道、记下过东西", () => {
    const none = { conversations: [], bots: [], weixinBound: () => false, memoryCount: () => 0 };
    expect(deriveGuide(none)).toEqual([]);
    expect(deriveGuide({ ...none, conversations: [{ messageCount: 1, model: "" }] })).toEqual([]);
    expect(
      deriveGuide({
        conversations: [{ messageCount: 2, model: "" }],
        bots: [{ id: "a", defaultModel: "gpt-x", feishuAppId: "" }, { id: "b", defaultModel: "", feishuAppId: "" }],
        weixinBound: (id) => id === "b",
        memoryCount: (id) => (id === "a" ? 1 : 0),
      }),
    ).toEqual(["hello", "model", "weixin", "memory"]);
    expect(deriveGuide({ ...none, bots: [{ id: "a", defaultModel: "", feishuAppId: "cli_x" }] })).toEqual(["weixin"]);
  });

  it("合并保持清单顺序", () => {
    expect(mergeGuide({ done: ["media"], hidden: false, seen: [] }, ["hello"]).done).toEqual(["hello", "media"]);
    expect(GUIDE_STEPS).toEqual(["hello", "model", "weixin", "hands", "memory", "media"]);
  });
});

describe("界面接口 /guide", () => {
  let app: App;
  let base = "";
  const TOKEN = "ui-token-guide-0123456789";
  const api = async (p: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}/amb/api${p}`, {
      method: init.method ?? "GET",
      headers: { "x-amb-token": TOKEN, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-guide-"));
    const config = loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_UI_PORT: "0", AMB_UI_TOKEN: TOKEN, AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } });
    app = new App(config, { printQrToTerminal: false });
    await app.start();
    base = app.web!.url.replace(/\/$/, "");
  });
  afterAll(async () => {
    await app?.stop();
  });

  it("新用户：什么都没做过", async () => {
    const r = await api("/guide");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ steps: [...GUIDE_STEPS], done: [], hidden: false, seen: [] });
  });

  it("标记完成、收起、不再显示都写进 config.json，重启后还在", async () => {
    expect((await api("/guide", { method: "PUT", body: { done: "hands" } })).json.done).toEqual(["hands"]);
    expect((await api("/guide", { method: "PUT", body: { done: "hands", seen: "intro" } })).json).toMatchObject({ done: ["hands"], seen: ["intro"] });
    expect((await api("/guide", { method: "PUT", body: { hidden: true } })).json.hidden).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(app.config.dataDir, "config.json"), "utf8")).ui.guide).toEqual({ done: ["hands"], hidden: true, seen: ["intro"] });
    expect(loadConfig({ dataDir: app.config.dataDir, env: {} }).ui.guide).toEqual({ done: ["hands"], hidden: true, seen: ["intro"] });
    expect((await api("/guide", { method: "PUT", body: { done: "fly" } })).status).toBe(400);
    expect((await api("/guide", { method: "DELETE" })).status).toBe(405);
  });

  it("能从数据看出来的步骤自动打勾，并记下来", async () => {
    const bot = app.store.createBot({ name: "小蓝" });
    app.store.updateBot(bot.id, { defaultModel: "gpt-x", feishuAppId: "cli_test" });
    const r = await api("/guide");
    expect(r.json.done).toEqual(["model", "weixin", "hands"]);
    expect(loadConfig({ dataDir: app.config.dataDir, env: {} }).ui.guide.done).toEqual(["model", "weixin", "hands"]);
  });

  it("重置后从头来（推导出的仍算做过）", async () => {
    const r = await api("/guide", { method: "PUT", body: { reset: true } });
    expect(r.json).toMatchObject({ done: ["model", "weixin"], hidden: false, seen: [] });
  });
});
