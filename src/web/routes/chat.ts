/** 消息搜索、应用内群聊、会话（停止、活动记录）。 */
import path from "node:path";
import { SseReply } from "../sse-reply.js";
import { botWorkspace, resolveFile, runnable, sendFile } from "../files.js";
import { FilePreviews } from "../file-previews.js";
import { groupPeer } from "../../store/db.js";
import { ChatSearchInputError } from "../../store/chat-search.js";
import { t } from "../../i18n/index.js";
import { HttpError, readJson, send, publicMessage, publicApproval, type Route, type WebContext } from "../http.js";

export function chatRoutes(ctx: WebContext, previews = new FilePreviews()): Route {
  const { app, stopConversation, groups, groupTurns, publicGroup, groupMembers } = ctx;
  const cfg = app.config;
  return async (req, res, url, seg, p, m) => {
    if (seg[0] === "messages" && m === "GET") {
      const num = (key: string) => url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined;
      try {
        if (seg.length === 2 && seg[1] === "scopes") return send(res, 200, { conversations: app.store.chatSearch.conversations() });
        // 搜索弹窗没输入时的"最近对话"
        if (seg.length === 2 && seg[1] === "recent") return send(res, 200, { conversations: app.store.chatSearch.recent(num("limit")) });
        if (seg.length === 2 && seg[1] === "search") {
          return send(res, 200, app.store.chatSearch.search({
            query: url.searchParams.get("q") || "", botId: url.searchParams.get("bot") || undefined,
            groupId: url.searchParams.get("group") || undefined, conversationId: url.searchParams.get("conversation") || undefined,
            channel: url.searchParams.get("channel") || undefined, from: num("from"), to: num("to"),
            cursor: url.searchParams.get("cursor") || undefined, limit: num("limit"),
          }));
        }
        if (seg.length === 3 && seg[2] === "context") {
          const context = app.store.chatSearch.context(Number(seg[1]), num("before"), num("after"));
          if (!context) throw new HttpError(404, t("web.messageNotFound"));
          return send(res, 200, { ...context, messages: context.messages.map(publicMessage), canOpen: !!app.desktop?.openPath });
        }
      } catch (e) {
        if (e instanceof ChatSearchInputError) throw new HttpError(400, t("web.badMessageSearch"));
        throw e;
      }
    }
    if (seg[0] === "groups") {
      if (seg.length === 1) {
        if (m === "GET") return send(res, 200, { groups: app.store.listGroups().map(publicGroup) });
        if (m === "POST") {
          const b = await readJson(req);
          const members = groupMembers(b.members);
          const name = String(b.name ?? "").trim() || members.map((id) => app.store.getBot(id)!.name).join("、");
          return send(res, 200, { group: publicGroup(app.store.createGroup(name, members)) });
        }
      }
      const groupId = decodeURIComponent(seg[1] ?? "");
      const group = app.store.getGroup(groupId);
      if (!group) throw new HttpError(404, t("web.groupNotFound"));
      if (seg.length === 2) {
        if (m === "GET") {
          // 正在答的那一轮由 live 显示；它开始之后存下的回复先不列，免得重复
          const turn = groupTurns.get(groupId);
          const messages = app.store.listGroupMessages(groupId).filter((x) => !(turn && x.conversationId === turn.conversationId && x.id > turn.afterMessageId));
          return send(res, 200, {
            group: publicGroup(group),
            messages: messages.map(publicMessage),
            live: turn ? { botId: turn.botId, conversationId: turn.conversationId, ...turn.snapshot() } : null,
            pending: app.store.groupConversations(groupId).flatMap((c) => app.store.listApprovals({ status: "pending", conversationId: c.id, limit: 50 }).map((r) => publicApproval(r, app.store))),
            canOpen: !!app.desktop?.openPath,
          });
        }
        if (m === "PUT") {
          const b = await readJson(req);
          app.store.updateGroup(groupId, {
            ...(b.name !== undefined && String(b.name).trim() ? { name: String(b.name).trim() } : {}),
            ...(b.members !== undefined ? { members: groupMembers(b.members) } : {}),
          });
          return send(res, 200, { group: publicGroup(app.store.getGroup(groupId)!) });
        }
        if (m === "DELETE") {
          groups.stop(groupId);
          for (const c of app.store.groupConversations(groupId)) {
            stopConversation(c.id);
            app.agent.resetConversation(c.id);
            app.agent.memory.dropGroup(c.id);
          }
          app.store.deleteGroup(groupId);
          return send(res, 200, { ok: true });
        }
      }
      if (seg.length === 3 && seg[2] === "messages" && m === "POST") {
        const b = await readJson(req);
        const text = String(b.text ?? "").trim();
        if (!text) throw new HttpError(400, t("web.emptyText"));
        if (!group.members.some((id) => app.store.getBot(id))) throw new HttpError(400, t("web.groupTooFew"));
        groups.send(groupId, text);
        return send(res, 200, { ok: true });
      }
      // 接着这个群：先发正在答的那一轮，之后转发事件（turn、同 chat/stream 的事件、turnEnd），都答完了发 idle 结束
      if (seg.length === 3 && seg[2] === "live" && m === "GET") {
        const out = new SseReply(res);
        if (!groups.isRunning(groupId)) return out.end("done", { idle: true });
        const turn = groupTurns.get(groupId);
        if (turn) out.send("turn", { botId: turn.botId, conversationId: turn.conversationId, ...turn.snapshot() });
        const off = groups.subscribe(groupId, (e, d) => (e === "idle" ? out.end("done", { idle: true }) : out.send(e, d)));
        res.on("close", off);
        return;
      }
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        const botId = groups.stop(groupId);
        if (botId) stopConversation(`${botId}:web:${groupPeer(groupId)}`);
        return send(res, 200, { stopped: !!botId });
      }
    }
    if (seg[0] === "conversations") {
      if (seg.length === 1 && m === "GET") return send(res, 200, { conversations: app.store.listConversations(url.searchParams.get("bot") || undefined) });
      if (seg.length === 3 && seg[2] === "messages" && m === "GET") {
        const conv = app.store.getConversation(decodeURIComponent(seg[1]));
        if (!conv) throw new HttpError(404, t("web.conversationNotFound"));
        return send(res, 200, { conversation: conv, messages: app.store.listMessages(conv.id).map(publicMessage), canOpen: !!app.desktop?.openPath });
      }
      // 一条回复的代理活动记录（展开时才取）
      if (seg.length === 5 && seg[2] === "messages" && seg[4] === "activity" && m === "GET") {
        return send(res, 200, { steps: app.store.getActivity(decodeURIComponent(seg[1]), Number(seg[3])) });
      }
      // 正在处理的回合：处理了多久、最近一次进展、到目前为止的步骤（信息面板轮询）
      if (seg.length === 3 && seg[2] === "turn" && m === "GET") {
        const t = app.agent.turnsInProgress.get(decodeURIComponent(seg[1]));
        return send(res, 200, { turn: t ? { since: t.since, lastProgress: t.lastProgress, steps: t.activity.steps, interim: t.interim } : null });
      }
      // 停止：网页消息（排队的也算）、纯对话、还在等代理启动的、代理回合，都在这里停
      if (seg.length === 3 && seg[2] === "stop" && m === "POST") {
        return send(res, 200, { stopped: stopConversation(decodeURIComponent(seg[1])) });
      }
      // 交付的文件（web/files.ts）：GET file?path= 发给浏览器（图片、PDF、纯文本直接显示，其余下载）；
      // 桌面版 POST file/open 用系统的默认程序打开（打开就会运行的只在文件夹中显示），file/reveal 在文件夹中显示。
      // 只给这个会话交付过的文件和这个机器人工作区里的文件
      if (seg[2] === "file" && (seg.length === 3 ? m === "GET" : seg.length === 4 && (seg[3] === "preview" ? m === "GET" : (seg[3] === "open" || seg[3] === "reveal") && m === "POST"))) {
        const conv = app.store.getConversation(decodeURIComponent(seg[1]));
        if (!conv) throw new HttpError(404, t("web.conversationNotFound"));
        const desktop = app.desktop;
        if (m === "POST" && !desktop?.openPath) throw new HttpError(400, t("web.desktopOnly"));
        const input = m === "GET" ? url.searchParams.get("path") : (await readJson(req)).path;
        const ws = botWorkspace(cfg.dataDir, conv.botId);
        const f = ws ? resolveFile(String(input ?? ""), { workspace: ws, dataDir: cfg.dataDir, delivered: app.store.deliveredFiles(conv.id) }) : undefined;
        if (!f) throw new HttpError(404, t("web.fileNotFound"));
        if (m === "GET" && seg[3] === "preview") return send(res, 200, await previews.describe(f, { workspace: ws!, dataDir: cfg.dataDir, delivered: app.store.deliveredFiles(conv.id) }));
        if (m === "GET") return sendFile(req, res, f, undefined, url.searchParams.get("download") === "1");
        if (seg[3] === "open" && !runnable(f)) {
          desktop!.openPath!(f.path);
          return send(res, 200, { ok: true });
        }
        if (desktop!.showItemInFolder) desktop!.showItemInFolder(f.path);
        else desktop!.openPath!(path.dirname(f.path));
        return send(res, 200, { ok: true, revealed: true });
      }
    }
    return false;
  };
}
