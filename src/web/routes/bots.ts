/** 机器人：列表、新建、设置、技能、网页对话（含流式与接上进行中的消息），以及目录 Bot 接口的转发（web/botapp.ts）。 */
import { TemplateCreator } from "../../templates/create.js";
import { botAppApi } from "../botapp.js";
import { FilePreviews } from "../file-previews.js";
import { skillsApi } from "../skills.js";
import { SseReply } from "../sse-reply.js";
import { normalizeSettings } from "../../agent/settings.js";
import { scopeLabel } from "../../agent/memory.js";
import { t } from "../../i18n/index.js";
import { HttpError, readJson, send, publicBot, publicMessage, CollectReply, webEvent, consoleConvId, publicApproval, accountCall, isLoopback, type Route, type WebContext } from "../http.js";

/** 界面发回来的「以后都允许」只留下原来就有的（撤销可以，添加不行） */
function keepGranted(cur: Record<string, Record<string, string>>, next: unknown): Record<string, Record<string, string>> {
  if (!next || typeof next !== "object") return cur;
  const out: Record<string, Record<string, string>> = {};
  for (const [app, tools] of Object.entries(cur)) {
    const want = (next as Record<string, unknown>)[app];
    if (!want || typeof want !== "object") continue;
    const kept: Record<string, string> = {};
    for (const [name, hash] of Object.entries(tools)) if ((want as Record<string, unknown>)[name] === hash) kept[name] = hash;
    if (Object.keys(kept).length) out[app] = kept;
  }
  return out;
}

export function botsRoutes(ctx: WebContext, previews = new FilePreviews()): Route {
  const { app, host, live, startLive, runLive, interceptWeb } = ctx;
  const templates = new TemplateCreator(app);
  return async (req, res, url, seg, p, m) => {
    if (seg[0] === "catalog" || (seg[0] === "bots" && seg[2] === "app")) {
      const handled = await botAppApi(req, res, url, seg, {
        catalog: app.catalog,
        installer: app.botInstaller,
        getBot: (id) => app.store.getBot(id),
        publicBot,
        deleteBot: (id, keepData) => app.deleteBot(id, { keepData }),
        send,
        readJson,
        appLang: () => String(req.headers["x-amb-lang"] || "en"),
        loopback: isLoopback(host),
        desktop: app.desktop,
        previews,
        dataDir: app.config.dataDir,
      });
      if (handled) return;
    }
    if (p === "/bots/from-template" && m === "POST") {
      const result = await templates.create(await readJson(req));
      return send(res, 201, { bot: publicBot(result.bot), sample: result.sample });
    }
    if (seg[0] === "bots") {
      if (seg.length === 1) {
        if (m === "GET") return send(res, 200, { bots: app.store.listBots().map(publicBot) });
        if (m === "POST") {
          const b = await readJson(req);
          if (!String(b.name || "").trim()) throw new HttpError(400, t("web.nameRequired"));
          const bot = app.store.createBot({
            name: String(b.name).trim(),
            systemPrompt: String(b.systemPrompt ?? ""),
            defaultModel: String(b.defaultModel ?? ""),
            settings: normalizeSettings({ avatar: b.avatar }),
          });
          await app.startBot(bot.id);
          return send(res, 201, { bot: publicBot(bot) });
        }
      }
      const id = seg[1];
      const bot = id ? app.store.getBot(id) : undefined;
      if (!bot) throw new HttpError(404, t("web.botNotFound"));
      if (seg.length === 2) {
        if (m === "GET") return send(res, 200, { bot: publicBot(bot) });
        if (m === "PUT") {
          const b = await readJson(req);
          // 目录 Bot 的人设被用户改过：之后不再跟随目录升级
          if (bot.app && b.systemPrompt !== undefined && String(b.systemPrompt) !== bot.systemPrompt) app.botInstaller.markCustomized(id);
          const next = app.store.updateBot(id, {
            ...(b.name !== undefined ? { name: String(b.name) } : {}),
            ...(b.systemPrompt !== undefined ? { systemPrompt: String(b.systemPrompt) } : {}),
            ...(b.defaultModel !== undefined ? { defaultModel: String(b.defaultModel) } : {}),
          })!;
          return send(res, 200, { bot: publicBot(next) });
        }
        if (m === "DELETE") {
          await app.deleteBot(id, { keepData: url.searchParams.get("keepData") === "1" });
          return send(res, 200, { ok: true });
        }
      }
      const sub = seg.slice(2).join("/");
      if (seg[2] === "skills") return skillsApi(req, res, url, id, seg.slice(3), app.userSkills, readJson, () => { void app.agent.refreshIdle(); });
      if (sub === "settings" && m === "GET") return send(res, 200, { settings: bot.settings, computerUse: app.agent.computerUse(id) });
      if (sub === "settings" && m === "PUT") {
        const b = await readJson(req);
        // 只接受已知字段；未给出的沿用当前值
        const cur = bot.settings;
        const merged = normalizeSettings({
          ...cur,
          ...(b.permission !== undefined ? { permission: b.permission } : {}),
          ...(b.utilityModel !== undefined ? { utilityModel: b.utilityModel } : {}),
          ...(b.avatar !== undefined ? { avatar: b.avatar } : {}),
          ...(b.computerUse !== undefined ? { computerUse: { ...cur.computerUse, ...b.computerUse } } : {}),
          ...(b.media !== undefined ? { media: { ...cur.media, ...b.media } } : {}),
          ...(b.quietHours !== undefined ? { quietHours: { ...cur.quietHours, ...b.quietHours } } : {}),
          ...(b.nudge !== undefined ? { nudge: b.nudge } : {}),
          // 应用：整份换（界面每次给完整的一份）；「以后都允许」只能在对话里批出来，这里只能撤销（不能凭空加）
          ...(b.apps !== undefined ? { apps: { ...cur.apps, ...b.apps, alwaysAllow: keepGranted(cur.apps.alwaysAllow, b.apps?.alwaysAllow) } } : {}),
          memory: { ...cur.memory, ...(b.memory ?? {}) },
          steward: { ...cur.steward, ...(b.steward ?? {}) },
        });
        app.store.updateBot(id, { settings: merged });
        if (b.apps !== undefined) app.agent.refreshIdle().catch(() => {});
        // 暂停 / 恢复后台工作：恢复时排着的 run、主动消息要放出来，经任务服务改
        if (typeof b.paused === "boolean") app.tasks.setPaused(id, b.paused, "web");
        const next = app.store.getBot(id)!;
        return send(res, 200, { settings: next.settings, computerUse: app.agent.computerUse(id) });
      }
      if (sub === "budget" && m === "PUT") {
        const b = await readJson(req);
        const limitUsd = Number(b.limitUsd ?? bot.settings.budget.limitUsd);
        if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 100_000) throw new HttpError(400, t("web.budgetRange"));
        const next = await accountCall(() => app.setBotBudget(id, normalizeSettings({ budget: { enabled: !!b.enabled, limitUsd } }).budget));
        return send(res, 200, { settings: next.settings });
      }
      if (sub === "memory" && m === "GET") {
        const scopes = [
          { kind: "team" as const, id: "" },
          { kind: "bot" as const, id },
          ...app.store
            .listConversations(id)
            .filter((c) => c.kind === "group")
            .map((c) => ({ kind: "group" as const, id: c.id })),
        ];
        return send(res, 200, {
          scopes: scopes.map((s) => ({
            kind: s.kind,
            id: s.id,
            label: scopeLabel(s),
            entries: app.agent.memory.entries(s).map((e) => ({ text: e.text, meta: e.meta })),
            topics: app.agent.memory.topics(s).map((t) => ({ name: t, entries: app.agent.memory.entries(s, t).map((e) => ({ text: e.text, meta: e.meta })) })),
          })),
          journal: app.agent.memory.journalTail(30).filter((j) => j.scope === "team" || j.scope.includes(id)),
          steward: app.agent.stewardLog.filter((l) => l.conversationId.startsWith(id + ":")).slice(-20),
        });
      }
      if (sub === "memory/forget" && m === "POST") {
        const b = await readJson(req);
        const kind = String(b.kind ?? "bot");
        const scope = kind === "team" ? { kind: "team" as const, id: "" } : kind === "group" ? { kind: "group" as const, id: String(b.id ?? "") } : { kind: "bot" as const, id };
        if (scope.kind === "group" && !scope.id.startsWith(id + ":")) throw new HttpError(400, t("web.groupNotOwned"));
        try {
          const text = app.agent.memory.forget(scope, String(b.match ?? ""), { topic: b.topic ? String(b.topic) : undefined, by: "web" });
          return send(res, 200, { ok: true, text });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      // —— 谁能使用：主人、允许名单、使用请求 ——
      if (sub === "chat" && m === "GET") {
        const conv = app.store.getConversation(consoleConvId(id));
        // 进行中的消息由 live 显示（用户消息、到目前为止的回复与步骤）；它开始之后存下的消息先不列，免得重复
        const turns = live.list(consoleConvId(id));
        const cut = turns[0]?.afterMessageId ?? Infinity;
        return send(res, 200, {
          conversationId: consoleConvId(id),
          model: conv?.model ?? "",
          messages: conv ? app.store.listMessages(conv.id, 200).filter((x) => x.id <= cut).map(publicMessage) : [],
          pending: app.store.listApprovals({ status: "pending", conversationId: consoleConvId(id), limit: 50 }).map((r) => publicApproval(r, app.store)),
          live: turns.map((t) => t.snapshot()),
          // 桌面版：交付的文件用系统程序打开；网页里在新标签页打开
          canOpen: !!app.desktop?.openPath,
        });
      }
      // 接上进行中的消息（切走再切回、刷新后）：先发 snapshot，再转发之后的事件（同 chat/stream），最后 done / error。
      // turn 不给就接正在处理的那条；已经结束了直接 done
      if (sub === "chat/live" && m === "GET") {
        const t = live.get(consoleConvId(id), url.searchParams.get("turn"));
        const out = new SseReply(res);
        if (!t) return out.end("done", { conversationId: consoleConvId(id), ended: true });
        out.send("snapshot", t.snapshot());
        const off = t.subscribe((e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d)));
        res.on("close", off);
        return;
      }
      // 控制台对话当前用的模型（空 = 跟着 Bot）：目录 Bot 的界面打开时读，不用把整段历史取回来
      if (sub === "chat/model" && m === "GET") {
        return send(res, 200, { conversationId: consoleConvId(id), model: app.store.getConversation(consoleConvId(id))?.model ?? "" });
      }
      if (sub === "chat/model" && m === "PUT") {
        const b = await readJson(req);
        const conv = app.store.ensureConversation(id, "web", "console", "控制台");
        app.store.setConversationModel(conv.id, String(b.model ?? ""));
        return send(res, 200, { conversationId: conv.id, model: String(b.model ?? "") });
      }
      if (sub === "chat" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, t("web.emptyText"));
        const ev = webEvent(id, text);
        const intercepted = interceptWeb(ev);
        if (intercepted.handled) return send(res, 200, { reply: intercepted.ack ?? "", prompts: [] });
        const out = new CollectReply();
        const lt = startLive(id, text);
        await runLive(lt, ev, { apply: async (op) => (await lt.apply(op), await out.apply(op)) });
        return send(res, 200, { reply: out.text, prompts: out.prompts, files: out.files, conversationId: consoleConvId(id) });
      }
      // 断开连接（切走、刷新、关窗口）不再中止这条消息：回合照常跑完，界面回来时经 chat/live 接上；停止走 /conversations/:id/stop
      if (sub === "chat/stream" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, t("web.emptyText"));
        const ev = webEvent(id, text);
        const out = new SseReply(res);
        try {
          const intercepted = interceptWeb(ev);
          if (intercepted.handled) {
            if (intercepted.ack) out.send("text", { text: intercepted.ack, final: true, ack: true });
            return out.end("done", { conversationId: consoleConvId(id) });
          }
        } catch (e) {
          return out.end("error", { message: (e as Error).message });
        }
        const lt = startLive(id, text);
        const off = lt.subscribe((e, d) => (e === "done" || e === "error" ? out.end(e, d) : out.send(e, d)));
        res.on("close", off);
        await runLive(lt, ev);
        return;
      }
    }
    return false;
  };
}
