/** 需要你、后台任务、规则、审批。 */
import fs from "node:fs";
import type { RuleMode } from "../../store/db.js";
import { normalizeSchedule, parseSchedule, previewSchedule, type Schedule } from "../../tasks/schedule.js";
import type { StageGroup } from "../../tasks/stage.js";
import { normalizeLang, t, withLang, t as tr } from "../../i18n/index.js";
import { HttpError, readJson, send, sendMarkdown, publicApproval, type Route, type WebContext } from "../http.js";

export function tasksRoutes(ctx: WebContext): Route {
  const { app } = ctx;
  return async (req, res, url, seg, p, m) => {
    if (seg[0] === "attention") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { items: app.attention.list() });
      const id = decodeURIComponent(seg[1] ?? "");
      const action = seg[2] ?? "";
      if (seg.length !== 3 || m !== "POST") throw new HttpError(404, "not found");
      const item = app.attention.list().find((x) => x.id === id);
      if (!item) throw new HttpError(409, tr("web.alreadyHandled"));
      if (!(item.actions as string[]).includes(action)) throw new HttpError(400, tr("web.unsupportedAction"));
      const b = await readJson(req);
      let ok = false;
      if (item.id.startsWith("missed:") && ["dismiss", "change-time", "keep-awake"].includes(action)) { app.tasks.dismissMissed(item.ruleId!); ok = true; }
      else if (action === "approve" || action === "deny") ok = app.agent.approvals.decide(item.approvalId!, action === "approve", "web");
      else if (action === "answer") {
        ok = Array.isArray(b.answers)
          ? app.agent.approvals.answer(item.approvalId!, { answers: b.answers.map((a: any) => ({ id: String(a.id), selected: (a.selected ?? []).map(String), ...(a.custom ? { custom: String(a.custom) } : {}) })) }, "web")
          : app.agent.approvals.answerText(item.approvalId!, String(b.text ?? ""), "web");
      } else if (item.kind === "delivery" && (action === "retry" || action === "dismiss")) ok = app.delivery.act(item.id, action);
      // 观察够了的规则：改为执行（和规则详情里切模式一样）、继续观察（这一版不再问）
      else if (item.kind === "suggest") ok = action === "act" ? !app.tasks.updateRule(item.ruleId!, { mode: "act" }).error : app.tasks.keepObserving(item.ruleId!);
      else if (item.kind === "rule" && action === "retry") ok = !app.tasks.resumeRule(item.ruleId!).error;
      // 加预算接着做：规则每月再给 $3，任务再给 $1
      else if (item.kind === "rule" && action === "continue") ok = !app.tasks.addRuleBudget(item.ruleId!).error;
      else if (action === "continue") ok = !(await app.tasks.addBudget(item.taskId!, undefined, "web")).error;
      else if (action === "retry") ok = !(await app.tasks.retry(item.taskId!)).error;
      else if (action === "stop") ok = await app.tasks.stopTask(item.taskId!, "web");
      if (!ok) throw new HttpError(409, tr("web.couldntComplete"));
      app.attention.kick();
      return send(res, 200, { ok: true, items: app.attention.list() });
    }
    // —— 后台任务（3a：列表、详情、一个 run 的步骤、停止；3f：分组、大小、改预算、保留、打开文件夹、删除、导出）——
    if (seg[0] === "tasks") {
      if (seg.length === 1 && m === "GET") {
        const recent = url.searchParams.get("recent");
        // group=working|needs|ended（可以用逗号写几组）：进行中、等你、结束了（归档了的不列）
        const groups = (url.searchParams.get("group") || "").split(",").map((g) => g.trim()).filter(Boolean);
        if (groups.some((g) => !["working", "needs", "ended"].includes(g))) throw new HttpError(400, tr("web.badGroup"));
        return send(res, 200, {
          tasks: app.tasks.list({
            botId: url.searchParams.get("bot") || undefined,
            conversationId: url.searchParams.get("conversation") || undefined,
            since: recent ? Date.now() - Math.min(30, Math.max(0, Number(recent) || 1)) * 86400_000 : undefined,
            limit: Math.min(100, Number(url.searchParams.get("limit")) || 50),
            group: groups as StageGroup[],
          }),
        });
      }
      const task = seg[1] ? app.tasks.get(decodeURIComponent(seg[1])) : undefined;
      if (!task) throw new HttpError(404, tr("web.taskNotFound"));
      if (seg.length === 2 && m === "GET") {
        const runs = app.store
          .listRuns({ taskId: task.id })
          .map((r) => ({ id: r.id, cause: r.cause, state: r.state, outcome: r.outcome, error: r.error, costUsd: r.costUsd, queuedAt: r.queuedAt, startedAt: r.startedAt, endedAt: r.endedAt, steps: app.tasks.activity(r.id).length }));
        // 来自（渠道、时间、原话）、文件夹和会话记录的大小、能不能在系统里打开文件夹（桌面版）
        return send(res, 200, { task, runs, origin: app.tasks.origin(task.id), sizes: app.tasks.sizes(task.id), canOpen: !!app.desktop?.openPath });
      }
      // 删掉任务：在跑的先停下，文件夹、会话记录、运行记录一起删
      if (seg.length === 2 && m === "DELETE") {
        await app.tasks.deleteTask(task.id, "web");
        return send(res, 200, { ok: true });
      }
      // 预算（3e、3f）：{addUsd} 加多少（默认 $1），或 {budgetUsd} 改成多少；停在预算上的任务接着做
      if (seg.length === 3 && seg[2] === "budget" && m === "POST") {
        const b = await readJson(req);
        const r =
          b.budgetUsd !== undefined
            ? await app.tasks.setBudget(task.id, Number(b.budgetUsd), "web")
            : await app.tasks.addBudget(task.id, b.addUsd === undefined ? undefined : Number(b.addUsd), "web");
        if (r.error) throw new HttpError(400, r.error);
        return send(res, 200, { task: r.task });
      }
      // 保留文件夹：定了清理的不清理了，从现在起再算 30 天
      if (seg.length === 3 && seg[2] === "keep" && m === "POST") {
        const v = app.tasks.keepFolder(task.id);
        if (!v) throw new HttpError(409, tr("web.couldntComplete"));
        return send(res, 200, { task: v });
      }
      // 在系统的文件管理器里打开任务文件夹（桌面版）
      if (seg.length === 3 && seg[2] === "open" && m === "POST") {
        const dir = app.tasks.folderPath(task.id);
        if (!app.desktop?.openPath) throw new HttpError(400, tr("web.desktopOnly"));
        if (!dir) throw new HttpError(404, tr("web.taskNotFound"));
        fs.mkdirSync(dir, { recursive: true });
        app.desktop.openPath(dir);
        return send(res, 200, { ok: true });
      }
      // 导出成 Markdown：?lang= 是界面的语言（下载链接带不了请求头）
      if (seg.length === 3 && seg[2] === "export" && m === "GET") {
        const r = withLang(normalizeLang(url.searchParams.get("lang")), () => app.tasks.exportTask(task.id));
        if (!r) throw new HttpError(404, tr("web.taskNotFound"));
        return sendMarkdown(res, r.title, r.text);
      }
      if (seg.length === 5 && seg[2] === "runs" && seg[4] === "activity" && m === "GET") {
        const run = app.store.getRun(decodeURIComponent(seg[3]));
        if (!run || run.taskId !== task.id) throw new HttpError(404, tr("web.runNotFound"));
        return send(res, 200, { steps: app.tasks.activity(run.id) });
      }
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        const ok = await app.tasks.stopTask(task.id, "web");
        if (!ok) throw new HttpError(409, tr("web.taskAlreadyStopped"));
        return send(res, 200, { task: app.tasks.get(task.id) });
      }
      throw new HttpError(404, "not found");
    }
    // —— 规则（3d）：列表、新建、改（原话、时间表、模式、发到哪）、删、立即运行、运行记录与一次运行的步骤 ——
    if (seg[0] === "rules") {
      if (seg[1] === "destinations" && m === "GET") {
        const bot = url.searchParams.get("bot") || "";
        return send(res, 200, { destinations: app.tasks.ruleDestinations(bot), groups: app.store.listGroups().filter((g) => g.members.includes(bot)).map((g) => ({ id: g.id, name: g.name })), timeZone: app.delivery.timeZone });
      }
      if (seg[1] === "preview" && m === "POST") {
        const b = await readJson(req);
        const now = Date.now();
        const r = b.schedule?.kind === "once" && typeof b.schedule.local === "string"
          ? parseSchedule(`once ${b.schedule.local.replace("T", " ")}`, b.schedule.tz || app.delivery.timeZone, now)
          : normalizeSchedule(b.schedule, app.delivery.timeZone, now);
        if (!r.schedule) throw new HttpError(400, r.error || t("rules.badSchedule"));
        return send(res, 200, { schedule: r.schedule, ...previewSchedule(r.schedule, now) });
      }
      if (seg[1] === "actions") {
        if (seg.length === 2 && m === "GET" && url.searchParams.get("group")) {
          const group = url.searchParams.get("group")!;
          return send(res, 200, { actions: app.store.groupConversations(group).flatMap((c) => app.tasks.ruleActions(c.id)) });
        }
        if (seg.length === 2 && m === "GET") return send(res, 200, { actions: app.tasks.ruleActions(url.searchParams.get("conversation") || "") });
        if (seg.length === 4 && m === "POST" && ["undo", "restore"].includes(seg[3])) {
          const result = seg[3] === "undo" ? app.tasks.undoRuleAction(seg[2]) : app.tasks.restoreRuleAction(seg[2]);
          if (result.error) throw new HttpError(409, result.error);
          return send(res, 200, { ok: true });
        }
        throw new HttpError(404, "not found");
      }
      const scheduleOf = (raw: unknown, tz: string): Schedule => {
        const r = normalizeSchedule(raw, tz, Date.now());
        if (!r.schedule) throw new HttpError(400, r.error ?? t("rules.badSchedule"));
        return r.schedule;
      };
      if (seg.length === 1 && m === "GET") {
        return send(res, 200, { rules: app.tasks.listRules({ botId: url.searchParams.get("bot") || undefined, conversationId: url.searchParams.get("conversation") || undefined }), timeZone: app.delivery.timeZone });
      }
      if (seg.length === 1 && m === "POST") {
        const b = await readJson(req);
        // 检查默认执行；mode observe = 用户在编辑器里选了先观察
        if (b.mode !== undefined && !["off", "observe", "act"].includes(b.mode)) throw new HttpError(400, t("rules.badMode"));
        const r = app.tasks.createRule({
          botId: String(b.botId ?? ""),
          conversationId: String(b.conversationId ?? ""),
          title: String(b.title ?? ""),
          instruction: String(b.instruction ?? ""),
          kind: b.kind === "remind" ? "remind" : "check",
          mode: b.mode || "act",
          missedPolicy: b.missedPolicy === "skip" ? "skip" : "catchup",
          message: String(b.message ?? ""),
          schedule: scheduleOf(b.schedule, app.delivery.timeZone),
          ...(b.runBudgetUsd !== undefined ? { runBudgetUsd: Number(b.runBudgetUsd) } : {}),
          ...(b.monthBudgetUsd !== undefined ? { monthBudgetUsd: Number(b.monthBudgetUsd) } : {}),
        });
        if (!r.rule) throw new HttpError(400, r.error ?? t("rules.createFailed"));
        return send(res, 200, { rule: app.tasks.getRuleView(r.rule.id) });
      }
      const rule = seg[1] ? app.store.getRule(decodeURIComponent(seg[1])) : undefined;
      if (!rule || rule.undoneUntil) throw new HttpError(404, t("rules.notFound"));
      if (seg.length === 2 && m === "GET") return send(res, 200, { rule: app.tasks.getRuleView(rule.id) });
      if (seg.length === 2 && m === "PUT") {
        const b = await readJson(req);
        const patch: Parameters<typeof app.tasks.updateRule>[1] = {};
        if (b.missedPolicy !== undefined) {
          if (!["catchup", "skip"].includes(b.missedPolicy)) throw new HttpError(400, t("rules.badSchedule"));
          patch.missedPolicy = b.missedPolicy;
        }
        if (b.sourceGroupId !== undefined) patch.sourceGroupId = String(b.sourceGroupId);
        if (b.title !== undefined) patch.title = String(b.title);
        if (b.instruction !== undefined) patch.instruction = String(b.instruction);
        if (b.message !== undefined) patch.message = String(b.message);
        if (b.conversationId !== undefined) patch.conversationId = String(b.conversationId);
        if (b.runBudgetUsd !== undefined) patch.runBudgetUsd = Number(b.runBudgetUsd);
        if (b.monthBudgetUsd !== undefined) patch.monthBudgetUsd = Number(b.monthBudgetUsd);
        if (b.mode !== undefined) {
          if (!["off", "observe", "act"].includes(b.mode)) throw new HttpError(400, t("rules.badMode"));
          patch.mode = b.mode as RuleMode;
        }
        if (b.schedule !== undefined) patch.schedule = scheduleOf(b.schedule, rule.trigger.kind === "schedule" ? rule.trigger.schedule.tz : app.delivery.timeZone);
        const r = app.tasks.updateRule(rule.id, patch);
        if (!r.rule) throw new HttpError(400, r.error ?? t("rules.saveFailed"));
        return send(res, 200, { rule: app.tasks.getRuleView(rule.id) });
      }
      if (seg.length === 2 && m === "DELETE") {
        await app.tasks.deleteRule(rule.id);
        return send(res, 200, { ok: true });
      }
      if (seg.length === 3 && seg[2] === "run" && m === "POST") {
        const r = rule.pausedReason ? app.tasks.resumeRule(rule.id) : app.tasks.runRuleNow(rule.id);
        if (r.error) throw new HttpError(409, r.error);
        return send(res, 200, { rule: app.tasks.getRuleView(rule.id) });
      }
      if (seg.length === 3 && seg[2] === "runs" && m === "GET") {
        const before = Number(url.searchParams.get("before")) || undefined;
        return send(res, 200, { runs: app.tasks.ruleLog(rule.id, { before, limit: Math.min(100, Number(url.searchParams.get("limit")) || 20) }) });
      }
      // 运行记录导出成 Markdown（3f）
      if (seg.length === 3 && seg[2] === "export" && m === "GET") {
        const r = withLang(normalizeLang(url.searchParams.get("lang")), () => app.tasks.exportRule(rule.id));
        if (!r) throw new HttpError(404, t("rules.notFound"));
        return sendMarkdown(res, r.title, r.text);
      }
      if (seg.length === 5 && seg[2] === "runs" && seg[4] === "activity" && m === "GET") {
        const run = app.store.getRun(decodeURIComponent(seg[3]));
        if (!run || run.ruleId !== rule.id) throw new HttpError(404, t("rules.runNotFound"));
        return send(res, 200, { steps: app.tasks.activity(run.id) });
      }
      throw new HttpError(404, "not found");
    }
    if (seg[0] === "approvals") {
      if (seg.length === 1 && m === "GET") {
        const status = url.searchParams.get("status") || undefined;
        return send(res, 200, { approvals: app.store.listApprovals({ status: status as any, botId: url.searchParams.get("bot") || undefined, limit: 100 }).map((r) => publicApproval(r, app.store)) });
      }
      const row = seg[1] ? app.store.getApproval(decodeURIComponent(seg[1])) : undefined;
      if (!row) throw new HttpError(404, t("web.requestNotFound"));
      if (seg.length === 2 && m === "GET") return send(res, 200, { approval: publicApproval(row, app.store) });
      if (seg.length === 3 && m === "POST" && (seg[2] === "approve" || seg[2] === "deny")) {
        if (row.kind !== "approval") throw new HttpError(400, t("web.notApproval"));
        // always：应用工具的「以后这个工具都允许」（只对写入类的卡片有效，见 agent/approvals.ts）
        const body = await readJson(req).catch(() => ({}));
        const ok = app.agent.approvals.decide(row.id, seg[2] === "approve", "web", { always: body?.always === true });
        if (!ok) throw new HttpError(409, t("web.requestDone"));
        return send(res, 200, { approval: publicApproval(app.store.getApproval(row.id)!, app.store) });
      }
      if (seg.length === 3 && m === "POST" && seg[2] === "answer") {
        if (row.kind !== "question" || row.status !== "pending") throw new HttpError(409, t("web.requestDone"));
        const b = await readJson(req);
        const ok = Array.isArray(b.answers)
          ? app.agent.approvals.answer(row.id, { answers: b.answers.map((a: any) => ({ id: String(a.id), selected: (a.selected ?? []).map(String), ...(a.custom ? { custom: String(a.custom) } : {}) })) }, "web")
          : app.agent.approvals.answerText(row.id, String(b.text ?? ""), "web");
        if (!ok) throw new HttpError(409, t("web.submitFailed"));
        return send(res, 200, { approval: publicApproval(app.store.getApproval(row.id)!, app.store) });
      }
    }
    return false;
  };
}
