import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { App } from "../app.js";
import { MemoryStore } from "../agent/memory.js";
import { normalizeSettings, PICKABLE_AVATARS } from "../domain/bot-settings.js";
import { HttpError } from "../web/http.js";
import { normalizeSchedule } from "../tasks/schedule.js";
import { templateCatalog, templateName, templateStrings } from "./catalog.js";

/** One request creates one owned bot, with closed rules and optional seed memory. */
export class TemplateCreator {
  private pending = new Map<string, { signature: string; run: Promise<{ bot: NonNullable<ReturnType<App["store"]["getBot"]>>; sample: string }> }>();
  constructor(private app: App) {}
  create(body: Record<string, unknown>) {
    const allowed = new Set(["templateId", "requestId", "nameBase", "name", "systemPrompt", "avatar", "defaultModel", "memoryEnabled", "onboarding"]);
    const copy = templateStrings();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, copy.errors.request);
    for (const field of ["name", "nameBase", "systemPrompt", "avatar", "defaultModel", "templateId", "requestId"]) if (body[field] !== undefined && typeof body[field] !== "string") throw new HttpError(400, copy.errors.fields);
    for (const field of ["memoryEnabled", "onboarding"]) if (body[field] !== undefined && typeof body[field] !== "boolean") throw new HttpError(400, copy.errors.fields);
    if (body.onboarding && !["writer", "polish", "minutes"].includes(String(body.templateId))) throw new HttpError(400, copy.errors.fields);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw new HttpError(400, copy.errors.fields);
    if (typeof body.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)) throw new HttpError(400, copy.errors.request);
    const key = `template.create.${crypto.createHash("sha256").update(`${this.app.account.ownerKey}:${body.requestId}`).digest("hex")}`;
    const payload: Record<string, unknown> = { ...body, name: body.nameBase || body.name }; delete payload.requestId;
    const signature = crypto.createHash("sha256").update(JSON.stringify(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
    const existing = this.pending.get(key);
    if (existing) { if (existing.signature !== signature) throw new HttpError(409, copy.errors.changedRequest); return existing.run; }
    const run = this.run(body, key, signature).finally(() => this.pending.delete(key)); this.pending.set(key, { signature, run }); return run;
  }
  private async run(b: Record<string, unknown>, key: string, signature: string) {
    const app = this.app; const strings = templateStrings();
    const template = templateCatalog().find((x) => x.id === b.templateId);
    if (!template) throw new HttpError(404, strings.errors.missing);
    const copy = strings.roles[template.id];
    const stored = app.store.getKV(key);
    if (stored) { const saved = JSON.parse(stored); if (saved.signature && saved.signature !== signature) throw new HttpError(409, strings.errors.changedRequest); const bot = app.store.getBot(saved.botId); if (!bot) throw new HttpError(409, strings.errors.removed); return { bot, sample: saved.sample }; }
    const name = typeof b.name === "string" ? b.name.trim() : copy.name;
    const nameBase = typeof b.nameBase === "string" ? b.nameBase.trim() : name;
    if (!name || name.length > 60 || !nameBase || nameBase.length > 60) throw new HttpError(400, strings.errors.name);
    const persona = typeof b.systemPrompt === "string" ? b.systemPrompt : copy.persona;
    if (persona.length > 30_000) throw new HttpError(400, strings.errors.persona);
    const avatar = typeof b.avatar === "string" ? b.avatar : template.avatar;
    if (!(PICKABLE_AVATARS as readonly string[]).includes(avatar)) throw new HttpError(400, strings.errors.avatar);
    const model = typeof b.defaultModel === "string" ? b.defaultModel : "";
    const effective = model || app.config.llm.defaultModel;
    const models = await app.runtime.listModels().catch(() => null);
    if (!effective || (models && !models.some((m) => m.replace(/^modelflare\//, "") === effective.replace(/^modelflare\//, ""))) || (!models && !!model)) throw new HttpError(400, strings.errors.model);
    let id: string;
    do { id = crypto.randomUUID().slice(0, 8); } while (app.store.getBot(id) || fs.existsSync(app.agent.memory.dir({ kind: "bot", id })));
    const staging = fs.mkdtempSync(path.join(app.config.dataDir, ".template-"));
    const memory = new MemoryStore(path.join(staging, "memory"));
    const scope = { kind: "bot" as const, id };
    const destination = app.agent.memory.dir(scope);
    const enabled = b.memoryEnabled !== false;
    let committed = false;
    let memoryMoved = false;
    try {
      // Onboarding keeps the short creation flow; no unseen seed notes or schedules.
      if (enabled && template.memory && !b.onboarding) {
        for (const note of copy.memory || []) memory.remember(scope, note, { topic: copy.memoryTitle, source: `template:${template.id}`, by: "template" });
      }
      const bot = app.store.transaction(() => {
        const bot = app.store.createBot({ id, name: templateName(nameBase, app.store.listBots().map((x) => x.name)), systemPrompt: persona,
          defaultModel: model, templateId: template.id, templateVersion: template.version,
          settings: normalizeSettings({ avatar, memory: { enabled } }) });
        if (template.rule && !b.onboarding) {
          const schedule = normalizeSchedule(template.rule.schedule, app.delivery.timeZone, Date.now());
          if (!schedule.schedule) throw new Error(schedule.error);
          const result = app.tasks.createRule({ botId: id, conversationId: "", kind: template.rule.kind,
            title: copy.rule!.title, instruction: copy.rule!.instruction, message: template.rule.kind === "remind" ? copy.rule!.instruction : "",
            schedule: schedule.schedule, mode: "off", allowEmptyDestination: true, requiresGroup: !!template.rule.sourceRequired, missedPolicy: "catchup" });
          if (!result.rule) throw new Error(result.error);
        }
        if (fs.existsSync(memory.dir(scope))) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.renameSync(memory.dir(scope), destination); memoryMoved = true; }
        app.store.setKV(key, JSON.stringify({ botId: id, sample: copy.sample, signature }));
        return bot;
      });
      committed = true;
      await app.startBot(id);
      return { bot, sample: copy.sample };
    } catch (e) {
      if (committed) { await app.stopBot(id).catch(() => {}); app.store.deleteBot(id); app.store.deleteKV(key); }
      if (memoryMoved) fs.rmSync(destination, { recursive: true, force: true });
      throw e;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
}
