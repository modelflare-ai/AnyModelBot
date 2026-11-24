/**
 * 「我的技能库」和「从本机导入…」的接口（PRD 2026-11-25）：
 *
 *   GET    /skill-library                           库里的全部（三处来源合成一份）、这一端能不能查找本机技能
 *   GET    /skill-library/items/:id                 查看：技能说明、相对文件、使用它的机器人
 *   POST   /skill-library/items/:id/remove          从库移除（只给从本机导入、登记进库的条目；没人开着、没有任务在用）
 *   PUT    /skill-library/items/:id/bots/:botId     在一个机器人上开 / 关 { on }（没有关系时新加），只影响这个机器人
 *   POST   /bots/:botId/skill-library               从技能库添加… { ids }：逐项应用到这个机器人，各自报告结果
 *
 *   POST   /skill-library/scans                     打开「从本机导入…」{ bot? }：后台枚举六个自动根（只看目录项和文件名）
 *   GET    /skill-library/scans/:sid                发现的进度和候选项
 *   POST   /skill-library/scans/:sid/cancel         取消发现（已找到的保留，标「未扫描完整」）
 *   POST   /skill-library/scans/:sid/pick           选择文件夹…（桌面版的系统选择器）；选到链接时先返回真实位置
 *   POST   /skill-library/scans/:sid/link           { ok }：确认按链接的真实位置读，或不读
 *   POST   /skill-library/scans/:sid/preview        「下一步」{ keys, bot? }：只读所选的这几项
 *   POST   /skill-library/scans/:sid/import         「确认导入」{ requestId, preview, items, bot? }
 *   DELETE /skill-library/scans/:sid                关掉对话框
 *   GET    /skill-library/imports/:requestId        查一次导入的结果（没收到回应时按请求号查，不重复提交）
 *   POST   /skill-library/imports/:requestId/cancel 停下还没开始的项
 *
 * 查找本机技能只在库宿主自己的桌面版里开放：有桌面外壳（app.desktop），而且请求来自本机回环地址。
 * 网页、远端打开的、命令行 / Docker 一律说明原因，不扫描任何一边的电脑；原 ZIP / GitHub 照常可用。
 */
import type http from "node:http";
import { SkillError } from "../../skills/archive.js";
import { skillDisplay, skillState } from "../../skills/display.js";
import type { LibraryItem } from "../../skills/service.js";
import { readJson, send, type Route, type WebContext } from "../http.js";
import { skillsView } from "../skills.js";

/** 请求是不是从本机来的（回环地址） */
function fromLoopback(req: http.IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1" || a.startsWith("127.");
}

export function skillLibraryRoutes(ctx: WebContext): Route {
  const { app } = ctx;
  const skills = app.userSkills;

  /** 这一端能不能查找本机技能：web 不是桌面版（命令行、Docker 打开的网页）· remote 桌面版但不是这台电脑上打开的 */
  const reasonOf = (req: http.IncomingMessage): "web" | "remote" | undefined => (!app.desktop ? "web" : !fromLoopback(req) ? "remote" : undefined);
  const botName = (id: string) => app.store.getBot(id)?.name ?? "";

  const itemView = (i: LibraryItem) => {
    const d = i.source.type === "github" ? skillDisplay({ name: i.name, description: i.description, source: i.source, title: i.title, example: i.example }) : undefined;
    return {
      id: i.id,
      kind: i.kind,
      name: i.name,
      title: d?.title ?? i.title,
      summary: d?.summary ?? i.description,
      description: i.description,
      source: i.source,
      files: i.files,
      bytes: i.bytes,
      scripts: i.scripts,
      bots: i.bots.map((b) => ({ ...b, name: botName(b.id) })),
      createdAt: i.createdAt,
      removable: i.removable,
      ...(i.completed ? { completed: i.completed } : {}),
      ...(i.depsUnverified ? { depsUnverified: true } : {}),
    };
  };
  /** 关了但正在跑的任务还用着（进程里部署的还是这一份）：不能移除 */
  const inUse = (botId: string, name: string, digest: string) => {
    const rt = app.agent.skillRuntime(botId);
    return !!rt?.running && rt.applied?.get(name) === digest;
  };
  /** 库条目在机器人上的生效状态：已开启（已生效）/ 等待空闲生效 / 加载中 / 已关闭 */
  const stateOf = (botId: string, entryId: string) => {
    const e = skills.library.get(entryId);
    if (!e) return "off";
    return skillState({ name: e.name, digest: e.digest, enabled: !!e.uses[botId]?.on }, app.agent.skillRuntime(botId));
  };
  const errorBody = (e: SkillError) => ({ error: e.code, code: e.code, ...e.detail });

  return async (req, res, _url, seg, _p, m) => {
    // 从技能库添加…（机器人设置）
    if (seg[0] === "bots" && seg[2] === "skill-library" && seg.length === 3) {
      if (m !== "POST") return false;
      const botId = decodeURIComponent(seg[1]);
      if (!app.store.getBot(botId)) return send(res, 404, { error: "not_found", code: "not_found" });
      const body = await readJson(req);
      const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 100) : [];
      const results = ids.map((id) => {
        try {
          skills.addFromLibrary(botId, id);
          return { id, ok: true };
        } catch (e) {
          if (!(e instanceof SkillError)) throw e;
          return { id, ok: false, code: e.code, ...e.detail };
        }
      });
      if (results.some((r) => r.ok)) void app.agent.refreshIdle();
      return send(res, 200, { results, skills: skillsView(botId, skills, app.agent.skillRuntime(botId)) });
    }
    if (seg[0] !== "skill-library") return false;
    try {
      if (seg.length === 1 && m === "GET") {
        const reason = reasonOf(req);
        return send(res, 200, { items: skills.libraryView().map(itemView), discover: { available: !reason, ...(reason ? { reason } : {}) } });
      }

      // —— 条目 ——
      if (seg[1] === "items" && seg.length >= 3) {
        const id = decodeURIComponent(seg[2]);
        const item = skills.libraryView().find((i) => i.id === id);
        if (!item) throw new SkillError("not_found", 404);
        if (seg.length === 3 && m === "GET") {
          const instructions = item.kind === "library" ? skills.library.text(id) : item.kind === "mine" ? skills.mine.text(item.name) : skills.detail(id.split(":")[1], item.name).instructions;
          const paths = item.kind === "library" ? skills.library.paths(id) : [];
          return send(res, 200, { item: { ...itemView(item), instructions, paths } });
        }
        if (seg.length === 4 && seg[3] === "remove" && m === "POST") {
          if (item.kind !== "library") throw new SkillError("not_removable", 409);
          skills.removeFromLibrary(id, inUse);
          return send(res, 200, { ok: true });
        }
        if (seg.length === 5 && seg[3] === "bots" && m === "PUT") {
          const botId = decodeURIComponent(seg[4]);
          if (!app.store.getBot(botId)) throw new SkillError("not_found", 404);
          const body = await readJson(req);
          if (typeof body?.on !== "boolean") throw new SkillError("invalid_skill");
          if (item.kind !== "library") throw new SkillError("not_found", 404);
          skills.useLibrary(id, botId, body.on);
          void app.agent.refreshIdle();
          return send(res, 200, { state: stateOf(botId, id), skills: skillsView(botId, skills, app.agent.skillRuntime(botId)) });
        }
        return send(res, 404, { error: "not_found", code: "not_found" });
      }

      // —— 一次导入的结果 ——
      if (seg[1] === "imports" && seg.length >= 3) {
        const rid = decodeURIComponent(seg[2]);
        const r = seg.length === 4 && seg[3] === "cancel" && m === "POST" ? app.localImports.cancelImport(rid) : seg.length === 3 && m === "GET" ? app.localImports.record(rid) : undefined;
        if (!r) throw new SkillError("not_found", 404);
        return send(res, 200, { record: r });
      }

      // —— 从本机导入… ——
      if (seg[1] === "scans") {
        if (seg.length === 2 && m === "POST") {
          const reason = reasonOf(req);
          if (reason) return send(res, 409, { error: "desktop_only", code: "desktop_only", reason });
          const body = await readJson(req);
          const bot = typeof body?.bot === "string" && app.store.getBot(body.bot) ? body.bot : undefined;
          return send(res, 200, { scan: app.localImports.start(bot) });
        }
        const sid = decodeURIComponent(seg[2] ?? "");
        if (seg.length === 3 && m === "DELETE") {
          app.localImports.close(sid);
          return send(res, 200, { ok: true });
        }
        if (seg.length === 3 && m === "GET") return send(res, 200, { scan: app.localImports.get(sid) });
        // 读本机内容的操作：每次都再核对一遍是不是这台电脑上的桌面版
        const reason = reasonOf(req);
        if (reason) return send(res, 409, { error: "desktop_only", code: "desktop_only", reason });
        if (seg.length === 4 && m === "POST") {
          const op = seg[3];
          if (op === "cancel") return send(res, 200, { scan: app.localImports.cancelScan(sid) });
          if (op === "pick") {
            const r = await app.localImports.pick(sid);
            const { status, added, ...scan } = r;
            return send(res, 200, { status, ...(added !== undefined ? { added } : {}), scan });
          }
          const body = await readJson(req);
          if (op === "link") {
            const r = await app.localImports.confirmLink(sid, body?.ok === true);
            const { status, ...scan } = r;
            return send(res, 200, { status, scan });
          }
          const bot = typeof body?.bot === "string" && body.bot ? body.bot : undefined;
          if (bot && !app.store.getBot(bot)) throw new SkillError("not_found", 404);
          if (op === "preview") {
            const keys: string[] = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === "string").slice(0, 500) : [];
            return send(res, 200, await app.localImports.preview(sid, keys, bot));
          }
          if (op === "import") {
            const items = Array.isArray(body?.items) ? body.items.filter((x: any) => typeof x?.key === "string").map((x: any) => ({ key: x.key, action: x.action === "copy" ? ("copy" as const) : ("import" as const) })) : [];
            const record = await app.localImports.commit(sid, { requestId: String(body?.requestId ?? ""), previewId: String(body?.preview ?? ""), items, ...(bot ? { botId: bot } : {}), retry: body?.retry === true });
            if (record.items.some((i) => i.enable === "on")) void app.agent.refreshIdle();
            return send(res, 200, { record, ...(bot ? { skills: skillsView(bot, skills, app.agent.skillRuntime(bot)) } : {}) });
          }
        }
      }
      return send(res, 404, { error: "not_found", code: "not_found" });
    } catch (e) {
      if (!(e instanceof SkillError)) throw e;
      return send(res, e.status, errorBody(e));
    }
  };
}
