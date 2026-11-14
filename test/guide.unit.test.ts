import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { GUIDE_STEPS, deriveGuide, guideComplete, mergeGuide, normalizeGuide } from "../src/guide.js";

describe("上手清单迁移与判定", () => {
  it("统一五步，旧生图进度保留为交付文件，已隐藏与完成里程碑不丢", () => {
    expect(GUIDE_STEPS).toEqual(["hello", "memory", "second", "hands", "weixin"]);
    expect(normalizeGuide({ done: ["media", "hello", "model", "unknown"], hidden: true, seen: ["completed", "intro", "intro", "bad id!"] })).toEqual({
      version: 2, done: ["hello", "hands"], hidden: true, seen: ["completed", "intro"], skipped: [],
    });
    expect(guideComplete(normalizeGuide({ seen: ["completed"] }))).toBe(true);
  });
  it("只有渠道可跳过；跳过不会伪装成连接，后来连接改为完成", () => {
    const g = normalizeGuide({ done: ["hello", "memory", "second", "hands"], skipped: ["weixin", "second"] });
    expect(g.skipped).toEqual(["weixin"]);
    expect(g.done).not.toContain("weixin");
    expect(guideComplete(g)).toBe(true);
    expect(guideComplete(normalizeGuide({ skipped: ["hello", "weixin"] }))).toBe(false);
    expect(mergeGuide(g, ["weixin"]).skipped).toEqual([]);
  });
  it("回复、第二个机器人、任意文件都按事实判定，设置模型不算完成", () => {
    const base = { conversations: [], bots: [{ id: "default", defaultModel: "model-x", feishuAppId: "configured-only" }], channelBound: () => false, memoryCount: () => 0 };
    expect(deriveGuide(base)).toEqual([]);
    expect(deriveGuide({ ...base, conversations: [{ botId: "default", model: "", messageCount: 2, successfulReply: false }] })).toEqual([]);
    expect(deriveGuide({ ...base, conversations: [{ botId: "cat-research", model: "", messageCount: 2, successfulReply: true, deliveredFile: true }], memoryCount: () => 1, channelBound: () => true })).toEqual([...GUIDE_STEPS]);
    expect(deriveGuide({ ...base, conversations: [{ botId: "default", model: "", messageCount: 2, successfulReply: true }] })).toEqual(["hello"]);
  });
});

describe("界面接口 /guide", () => {
  let app: App; let base = ""; let dataDir = "";
  const TOKEN = "ui-token-guide-0123456789";
  const api = async (p: string, body?: unknown) => {
    const res = await fetch(`${base}/amb/api${p}`, { method: body === undefined ? "GET" : "PUT", headers: { "x-amb-token": TOKEN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
  };
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-guide-"));
    app = new App(loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_UI_PORT: "0", AMB_UI_TOKEN: TOKEN, AMB_AGENT: "off", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9" } }), { printQrToTerminal: false });
    await app.start(); base = app.web!.url.replace(/\/$/, "");
  });
  beforeEach(() => {
    for (const b of app.store.listBots()) app.store.deleteBot(b.id);
    app.store.createBot({ id: "default", name: "renamed assistant" });
    app.config.ui.guide = normalizeGuide({});
    app.store.deleteKV("guide.owner.local"); app.store.deleteKV("guide.welcomeConsumed");
  });
  afterAll(async () => { await app?.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  it("新用户落点身份不依赖名称；欢迎只消费一次", async () => {
    expect((await api("/guide")).json).toMatchObject({ done: [], skipped: [], welcomeAvailable: true, primaryBotId: "default", primaryBotName: "renamed assistant" });
    await api("/guide", { entered: true });
    expect((await api("/guide")).json.welcomeAvailable).toBe(false);
  });
  it("隐藏与重新显示保留进度，状态写回本机配置", async () => {
    await api("/guide", { done: "hands", hidden: true, seen: "intro" });
    expect(loadConfig({ dataDir, env: {} }).ui.guide).toMatchObject({ version: 2, done: ["hands"], hidden: true, seen: ["intro"] });
    expect((await api("/guide", { hidden: false })).json).toMatchObject({ done: ["hands"], hidden: false });
    expect((await api("/guide", { done: "fly" })).status).toBe(400);
    expect((await api("/guide", { skip: "memory" })).status).toBe(400);
    expect((await api("/guide", { channel: "fax" })).status).toBe(400);
  });
  it("已有正常回复即排除欢迎；历史回复不受最近20条限制，图片也算文件", async () => {
    const b = app.store.createBot({ name: "writer" });
    const c = app.store.ensureConversation(b.id, "web", "console");
    app.store.addMessage(c.id, "user", "Please help");
    app.store.addMessage(c.id, "assistant", "Done", undefined, { files: ["/workspace/result.png"] });
    for (let i = 0; i < 30; i++) app.store.addMessage(c.id, "assistant", "⚠️ failed");
    const r = (await api("/guide")).json;
    expect(r.done).toEqual(["hello", "second", "hands"]); expect(r.welcomeAvailable).toBe(false);
    app.store.deleteBot(b.id);
    expect((await api("/guide")).json.done).toEqual(r.done);
  });
  it("命令回执和错误回复不算正常对话", async () => {
    const c = app.store.ensureConversation("default", "web", "console");
    app.store.addMessage(c.id, "user", "/model model-x"); app.store.addMessage(c.id, "assistant", "Model changed");
    app.store.addMessage(c.id, "user", "Hi"); app.store.addMessage(c.id, "assistant", "⚠️ no credits");
    expect((await api("/guide")).json.done).toEqual([]);
  });
  it("模板和自动整理的记忆不完成教学，对话保存成功才完成且不回退", async () => {
    const scope = { kind: "bot" as const, id: "default" };
    app.agent.memory.remember(scope, "模板自带偏好", { source: "template:writer" });
    app.agent.memory.remember(scope, "自动推断的偏好", { source: "review" });
    expect((await api("/guide")).json.done).not.toContain("memory");
    app.agent.memory.remember(scope, "回答简短，结论优先", { source: "chat:web" });
    expect((await api("/guide")).json.done).toContain("memory");
    app.agent.memory.forget(scope, "回答简短，结论优先", { by: "test" });
    expect((await api("/guide")).json.done).toContain("memory");
  });
  it("完成前四步再跳过渠道可结束；完成里程碑不因数据删除消失", async () => {
    await api("/guide", { done: ["hello", "memory", "second", "hands"] });
    const r = (await api("/guide", { skip: "weixin" })).json;
    expect(r.seen).toContain("completed"); expect(r.done).not.toContain("weixin");
    expect((await api("/guide")).json.seen).toContain("completed");
    expect((await api("/guide", { done: "weixin" })).json.skipped).toEqual([]);
  });
  it("旧完成与隐藏状态迁移，账号迟到请求拒绝写入", async () => {
    app.store.setKV("guide.owner.local", JSON.stringify({ done: ["hello", "media"], hidden: true, seen: ["completed"] }));
    const r = (await api("/guide")).json;
    expect(r).toMatchObject({ done: ["hello", "hands"], hidden: true, migration: true, seen: ["completed"] });
    expect((await api("/guide")).json.migration).toBe(false);
    expect((await api("/guide", { owner: "another-account", done: "memory" })).status).toBe(409);
  });
  it("并发步骤请求合并，已做过的步骤不丢", async () => {
    await Promise.all([api("/guide", { done: "hello" }), api("/guide", { done: "memory" }), api("/guide", { done: "hands" })]);
    expect((await api("/guide")).json.done).toEqual(["hello", "memory", "hands"]);
  });
  it("删除所有机器人后重启不会重新创建默认助手", async () => {
    const config = app.config;
    await app.deleteBot("default"); await app.stop();
    app = new App(config, { printQrToTerminal: false }); await app.start();
    base = app.web!.url.replace(/\/$/, "");
    expect(app.store.listBots()).toEqual([]);
  });

});
