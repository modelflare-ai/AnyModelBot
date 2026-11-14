import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { validTopic } from "../src/agent/memory.js";
import { normalizeSettings } from "../src/domain/bot-settings.js";
import { templateStrings } from "../src/templates/catalog.js";
let app: App; let dir = ""; let url = "";
const token = "template-test-token-0123456789";
const request = async (body: Record<string, unknown>, language = "en") => {
  const response = await fetch(`${url}/amb/api/bots/from-template`, { method: "POST", headers: { "x-amb-token": token, "content-type": "application/json", "x-amb-lang": language }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() as any };
};
const draft = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ templateId: id, requestId: crypto.randomUUID(), ...extra });
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-templates-"));
  app = new App(loadConfig({ dataDir: dir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_UI_PORT: "0", AMB_UI_TOKEN: token, AMB_AGENT: "off", AMB_CATALOG: "off" } }), { printQrToTerminal: false });
  vi.spyOn(app.runtime, "listModels").mockResolvedValue(["model-x", "model-y"]);
  app.setDefaultModel("model-x"); await app.start(); url = app.web!.url.replace(/\/$/, "");
});
afterAll(async () => { await app?.stop(); vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
describe("从模板创建", () => {
  it("并发与重试只创建一次；来源保留，普通机器人权限不变", async () => {
    const body = draft("writer"); const before = app.store.listBots().length;
    const [a, b] = await Promise.all([request(body), request(body)]);
    expect(a.status).toBe(201); expect(a.data.bot.id).toBe(b.data.bot.id); expect(app.store.listBots().length).toBe(before + 1);
    expect(a.data.bot).toMatchObject({ origin: "user", templateId: "writer", templateVersion: 1, defaultModel: "" });
    expect((await request({ ...body, name: "Different request" })).status).toBe(409);
    expect(app.store.listBots().length).toBe(before + 1);
    const defaults = normalizeSettings({}); expect(a.data.bot.settings).toMatchObject({ permission: defaults.permission, computerUse: defaults.computerUse, budget: defaults.budget, apps: defaults.apps });
    const entries = app.agent.memory.entries({ kind: "bot", id: a.data.bot.id }, validTopic("Writing habits"));
    expect(entries[0].meta).toContain("source: template:writer"); expect(app.agent.memory.entries({ kind: "team", id: "" })).toEqual([]);
    const guide = await fetch(`${url}/amb/api/guide`, { headers: { "x-amb-token": token } }).then((r) => r.json()) as any;
    expect(guide.done).not.toContain("memory");
    app.store.updateBot(a.data.bot.id, { name: "My edited writer", systemPrompt: "My own persona" });
    expect(app.store.getBot(a.data.bot.id)).toMatchObject({ templateId: "writer", systemPrompt: "My own persona" });
  });
  it("关闭记忆不写入，新手简短路径也不悄悄写入预置笔记", async () => {
    for (const body of [draft("polish", { memoryEnabled: false }), draft("writer", { onboarding: true })]) {
      const r = await request(body); expect(r.status).toBe(201);
      expect(app.agent.memory.topics({ kind: "bot", id: r.data.bot.id })).toEqual([]);
      expect(app.store.listRules({ botId: r.data.bot.id })).toEqual([]);
      if (body.memoryEnabled === false) expect(r.data.bot.settings.memory.enabled).toBe(false);
    }
  });
  it("三条模板规则创建为关，无目标无运行时间；日报无来源群", async () => {
    for (const id of ["work-report", "day-planner", "digest"]) {
      const r = await request(draft(id)); expect(r.status).toBe(201);
      const rules = app.store.listRules({ botId: r.data.bot.id }); expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ mode: "off", conversationId: "", nextRunAt: 0, sourceGroupId: "", requiresGroup: id === "digest" });
      expect(app.store.ruleRuns(rules[0].id)).toEqual([]);
      expect(app.tasks.updateRule(rules[0].id, { mode: "act" }).error).toBeTruthy();
    }
  });
  it("启用时可选择尚无消息的当前对话；日报同时要求真实来源群", async () => {
    const day = await request(draft("day-planner")); const botId = day.data.bot.id;
    const rule = app.store.listRules({ botId })[0];
    expect(app.store.getConversation(`${botId}:web:console`)).toBeUndefined();
    expect(app.tasks.updateRule(rule.id, { mode: "act", conversationId: `${botId}:web:console` }).error).toBeUndefined();
    expect(app.store.getRule(rule.id)?.nextRunAt).toBeGreaterThan(Date.now());
    const digest = await request(draft("digest")); const digestId = digest.data.bot.id;
    const digestRule = app.store.listRules({ botId: digestId })[0];
    const conversationId = `${digestId}:web:console`;
    expect(app.tasks.updateRule(digestRule.id, { mode: "act", conversationId }).error).toBeTruthy();
    const group = app.store.createGroup("Project", [digestId, "default"]);
    expect(app.tasks.updateRule(digestRule.id, { mode: "act", conversationId, sourceGroupId: group.id }).error).toBeUndefined();
    app.tasks.updateRule(digestRule.id, { mode: "off" }); app.store.updateGroup(group.id, { members: ["default"] });
    expect(app.tasks.updateRule(digestRule.id, { mode: "act" }).error).toBeTruthy();
    expect(app.store.getRule(digestRule.id)?.mode).toBe("off");
  });
  it("规则写入失败整次回滚，保留重试机会，不留下机器人和记忆目录", async () => {
    const body = draft("work-report"); const before = app.store.listBots().map((b) => b.id);
    const create = vi.spyOn(app.tasks, "createRule").mockReturnValueOnce({ error: "test write failure" });
    const r = await request(body); expect(r.status).toBeGreaterThanOrEqual(400);
    expect(app.store.listBots().map((b) => b.id)).toEqual(before);
    expect(fs.readdirSync(dir).some((x) => x.startsWith(".template-"))).toBe(false);
    create.mockRestore(); expect((await request(body)).status).toBe(201);
  });
  it("启动阶段失败同样回滚已提交的机器人、规则、记忆及重试映射", async () => {
    const body = draft("day-planner"); const before = app.store.listBots().map((b) => b.id);
    const start = vi.spyOn(app, "startBot").mockRejectedValueOnce(new Error("test startup failure"));
    expect((await request(body)).status).toBeGreaterThanOrEqual(400);
    expect(app.store.listBots().map((b) => b.id)).toEqual(before);
    start.mockRestore(); expect((await request(body)).status).toBe(201);
  });
  it("拒绝模板请求中的权限、授权或开启规则设置", async () => {
    const before = app.store.listBots().length;
    for (const extra of [{ permission: "full" }, { apps: { mode: "all" } }, { mode: "act" }]) expect((await request(draft("writer", extra))).status).toBe(400);
    expect(app.store.listBots().length).toBe(before);
  });
  it("同名只给新机器人加后缀，具体模型固定、跟随默认则保留空值", async () => {
    app.store.createBot({ name: "Same" });
    const a = await request(draft("minutes", { name: "Same", defaultModel: "model-x" }));
    const b = await request(draft("minutes", { name: "Same" }));
    expect(a.data.bot.name).toBe("Same 2"); expect(b.data.bot.name).toBe("Same 3");
    app.setDefaultModel("model-y");
    expect(app.store.getBot(a.data.bot.id)?.defaultModel).toBe("model-x"); expect(app.store.getBot(b.data.bot.id)?.defaultModel).toBe("");
  });
  it("两页预览都自动选了同一个后缀时，提交仍从原名生成下一个数字", async () => {
    app.store.createBot({ name: "Counter" });
    const a = draft("minutes", { name: "Counter 2", nameBase: "Counter" });
    const b = draft("minutes", { name: "Counter 2", nameBase: "Counter" });
    const created = await Promise.all([request(a), request(b)]);
    expect(created.map((r) => r.data.bot.name).sort()).toEqual(["Counter 2", "Counter 3"]);
    expect((await request({ ...a, name: "Counter 4" })).data.bot.id).toBe(created[0].data.bot.id);
  });
  it("按添加时语言写入全文，后续请求切换语言不会翻译已创建内容", async () => {
    const r = await request(draft("study-buddy"), "ja"); expect(r.status).toBe(201);
    const copy = templateStrings("ja").roles["study-buddy"];
    expect(r.data.bot.systemPrompt).toBe(copy.persona); expect(r.data.sample).toBe(copy.sample);
    expect(app.agent.memory.entries({ kind: "bot", id: r.data.bot.id }, validTopic(copy.memoryTitle!))[0].text).toBe(copy.memory![0]);
  });
});
