/** 应用本身：状态、更新与更新日志、通知、桌面版操作、代理状态、上手清单、故障排查。 */
import fs from "node:fs";
import path from "node:path";
import { appVersion } from "../../version.js";
import { findAppRoot } from "../../magpie/supervisor.js";
import { UpdateActionError } from "../../updates/check.js";
import { fetchChangelog, readLocalChangelog } from "../../changelog.js";
import { logger, logFilePath, readLogTail } from "../../log.js";
import { diagnosticsReport, safeStatus, testAgent, testModel } from "../../diagnostics.js";
import { saveConfigFile } from "../../config.js";
import { GUIDE_STEPS, guideComplete, deriveGuide, isGuideChannel, isGuideStep, mergeGuide, normalizeGuide, type GuideState } from "../../guide.js";
import { lang, t } from "../../i18n/index.js";
import { HttpError, readJson, send, type Route, type WebContext } from "../http.js";

const log = logger("web");

export function systemRoutes(ctx: WebContext): Route {
  const { app, live } = ctx;
  const cfg = app.config;
  /** /guide 在账户信息还没读到时补读账户的时间（离线时限流） */
  let guideRefreshAt = 0;
  return async (req, res, url, seg, p, m) => {
    if (p === "/status" && m === "GET") {
      const mp = app.magpie;
      return send(res, 200, {
        version: appVersion(),
        dataDir: cfg.dataDir,
        username: app.username,
        desktop: !!app.desktop,
        platform: process.platform,
        // 诊断信息：内置网关只是实现细节，界面里只在"关于 → 诊断信息"展示
        gateway: mp ? { mode: "managed", state: mp.state, lastError: mp.lastError, restarts: mp.restarts } : { mode: "external", state: "external" },
        notices: app.recentNotices,
      });
    }
    if (p === "/update" && m === "GET") return send(res, 200, (app.desktop?.updates ?? app.updates).status());
    // "更新了什么"：这一版要不要弹，看过之后记下
    if (p === "/whats-new" && m === "GET") return send(res, 200, app.whatsNew());
    if (p === "/whats-new/seen" && m === "POST") {
      app.markWhatsNewSeen();
      return send(res, 200, app.whatsNew());
    }
    // 更新日志：不带 version 或是本机这一版时读安装包里的；是检查到的新版本时（升级前看看）去取那个版本标签下的。
    // 只认这两种版本号，不替界面去取任意地址
    if (p === "/changelog" && m === "GET") {
      const lang = url.searchParams.get("lang") || "en";
      const current = appVersion();
      const version = url.searchParams.get("version") || current;
      if (version === current) return send(res, 200, { version, entries: readLocalChangelog(lang) });
      const update = (app.desktop?.updates ?? app.updates).status();
      if (!update.available || update.latest !== version) throw new HttpError(400, "unknown version");
      try {
        return send(res, 200, { version, entries: await fetchChangelog(version, lang) });
      } catch (e) {
        return send(res, 502, { error: (e as Error).message, releaseUrl: update.releaseUrl });
      }
    }
    if (["/update/check", "/update/download", "/update/install"].includes(p) && m === "POST") {
      try {
        const updates = app.desktop?.updates;
        if (!updates) throw new UpdateActionError("unsupported");
        if (p.endsWith("/check")) await updates.check();
        else if (p.endsWith("/download")) updates.download();
        else {
          if (app.busyForUpdate()) throw new UpdateActionError("busy");
          updates.install();
        }
        return send(res, 200, updates.status());
      } catch (error) {
        if (!(error instanceof UpdateActionError)) throw error;
        return send(res, error.code === "busy" ? 409 : 400, { error: error.code, code: error.code });
      }
    }
    if (p === "/notices" && m === "GET") {
      const read = (f: string) => {
        try {
          return fs.readFileSync(path.join(findAppRoot(), f), "utf8");
        } catch {
          return "";
        }
      };
      const locale = lang();
      const notices = locale === "zh-CN" ? "THIRD_PARTY_NOTICES.md" : `THIRD_PARTY_NOTICES_${locale}.md`;
      return send(res, 200, { license: read("LICENSE"), notices: read(notices) || read("THIRD_PARTY_NOTICES.md") });
    }
    if (p === "/desktop/open-data-dir" && m === "POST") {
      if (!app.desktop) throw new HttpError(400, t("web.desktopOnly"));
      app.desktop.openDataDir();
      return send(res, 200, { ok: true });
    }
    // 界面主题变了（或刚加载完）：窗口按钮的符号颜色跟着换。只有 Windows 桌面版有这个钩子，其他环境静默忽略
    if (p === "/desktop/preferences" && m === "POST") {
      const b = await readJson(req);
      if (app.desktop && typeof b.notify === "boolean") app.store.setKV("desktop.notify", String(b.notify));
      return send(res, 200, { ok: true });
    }
    if (p === "/desktop/title-bar" && m === "POST") {
      const b = await readJson(req);
      app.desktop?.setTitleBarTheme?.(b.dark === true);
      return send(res, 200, { ok: true });
    }
    if (p === "/desktop/open-in-browser" && m === "POST") {
      if (!app.desktop) throw new HttpError(400, t("web.desktopOnly"));
      app.desktop.openInBrowser();
      return send(res, 200, { ok: true });
    }
    // busy：有消息在处理的机器人（纯对话、排队、代理还在启动都算），侧栏的"正在工作"
    // background：每个机器人正在进行的后台任务数
    // attention："需要你"的件数（侧栏那一行，没有就是 0）；needs：每个机器人几件、最早那件（机器人行的第二行）
    if (p === "/agent" && m === "GET") {
      const items = app.attention.list();
      return send(res, 200, { ...app.agent.status(), busy: [...new Set([...live.bots(), ...app.runtime.busyBots()])], background: app.tasks.background(), attention: items.length, needs: app.attention.byBot(items),
        cuBlocked: Object.keys(app.cuPermissions.view().blocked),
        // 连接应用里有没有要用户处理凭证的连接（头像上的提醒点）
        appsAttention: app.apps.attention() });
    }
    // —— 新手引导（上手清单）：进度写进 config.json；读的时候把能从数据里看出来做过的步骤并进去 ——
    if (p === "/guide") {
      const body = m === "PUT" ? await readJson(req) : null;
      // 进度按当前用户存：登录了 Modelflare 按账户（ownerKey，本机由发行方 + 用户名算出的哈希），没登录按本机（local）。
      // 推导用的事实（会话、记忆、渠道）是这台电脑上的数据，换账户登录看到的也是同一份，所以照样用来推导。
      // 账户信息还没读到时补读一次；离线时一分钟最多试一次，不让每次轮询都等网络
      if (app.account.ownerKey === "pending-account" && Date.now() - guideRefreshAt > 60_000) {
        guideRefreshAt = Date.now();
        await app.account.refresh().catch(() => undefined);
      }
      const owner = app.account.ownerKey;
      // 账户信息还没读到（离线等）：只读不写，免得进度落到一个临时的命名空间里，之后真正的账户反而看不到
      const writable = owner !== "pending-account";
      const key = `guide.owner.${owner}`;
      const saved = app.store.getKV(key);
      // 这个用户还没有自己的进度时，从这台电脑上的进度（config.json 的 ui.guide：升级前的进度，或者没登录时做的）开始，
      // 先用自己的 Key、后来登录账户的人不会看到做完或关掉的清单又冒出来；之后各存各的
      let current = saved ? normalizeGuide(JSON.parse(saved)) : normalizeGuide(cfg.ui.guide);
      // 第一次登录继承本机状态；后续登录合并本机已完成项，绝不撤销已有里程碑。
      const local = normalizeGuide(cfg.ui.guide);
      const inherited = owner !== "local" && !app.store.getKV(`guide.inherited.${owner}`);
      if (inherited) {
        current = normalizeGuide({ ...current, done: [...current.done, ...local.done],
          skipped: [...current.skipped, ...local.skipped], seen: [...current.seen, ...local.seen], hidden: current.hidden || local.hidden });
        if (writable) app.store.setKV(`guide.inherited.${owner}`, "1");
      }
      const allDone = guideComplete;
      const migration = !saved || JSON.parse(saved).version !== 2;
      const save = (g: GuideState) => {
        // 全部完成是里程碑：记一次，之后断开渠道、删掉记忆都不会让清单重新出现
        if (allDone(g) && !g.seen.includes("completed")) g = { ...g, seen: [...g.seen, "completed"] };
        current = g;
        if (!writable) return;
        app.store.setKV(key, JSON.stringify(g));
        // 没登录账户时仍写回 config.json，和老版本兼容
        if (owner === "local") {
          cfg.ui.guide = g;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), guide: g }));
        }
      };
      if (m === "PUT") {
        const b = body;
        const add: unknown[] = b.done === undefined ? [] : Array.isArray(b.done) ? b.done : [b.done];
        if (!add.every(isGuideStep)) throw new HttpError(400, t("web.unknownGuideStep"));
        if (b.channel !== undefined && !isGuideChannel(b.channel)) throw new HttpError(400, t("web.unknownGuideStep"));
        // 换了账户以后，上一个账户的界面迟到的请求不能推进这个账户的清单
        if (b.owner && b.owner !== owner) throw new HttpError(409, "account changed");
        if (b.skip !== undefined && b.skip !== "weixin") throw new HttpError(400, t("web.unknownGuideStep"));
        if (b.entered) app.store.setKV("guide.welcomeConsumed", "1");
        const g = b.reset ? normalizeGuide({}) : current;
        save(normalizeGuide({
          ...g, done: [...g.done, ...add],
          skipped: b.skip === "weixin" ? ["weixin"] : g.skipped,
          hidden: b.hidden !== undefined ? !!b.hidden : g.hidden,
          // 重新开始时连"全部完成"的里程碑一起清掉；能从数据看出来做过的步骤下面照样并进来
          seen: [...g.seen, ...(typeof b.seen === "string" ? [b.seen] : [])],
          channel: b.channel ?? g.channel,
        }));
      } else if (m !== "GET") throw new HttpError(405, "method not allowed");
      const bots = app.store.listBots();
      // 已经打过勾的步骤不再去查：渠道状态、记忆文件都要读磁盘或问渠道
      const channelConnected = !current.done.includes("weixin") && app.store.listChannelAccounts().some((a) => (app.channelStatus(a.key) as Record<string, { state?: string } | undefined>)[a.channel]?.state === "connected");
      const memoryDone = current.done.includes("memory");
      // 打过招呼 = 有一条真正的回复（出错提示以 ⚠️ 开头，不算）。已经打过勾就不再翻消息；找到第一条就停
      const facts = ["hello", "second", "hands"].every((id) => current.done.includes(id as typeof GUIDE_STEPS[number])) ? [] : app.store.guideConversations();
      const derived = deriveGuide({
        conversations: facts,
        bots,
        // 至少有一个渠道真的连上了（只填了配置不算）
        channelBound: () => channelConnected,
        // 机器人自己的记忆或团队记忆里真的有条目（主文件 + 各主题）
        memoryCount: (id) => memoryDone ? 0 : [{ kind: "bot" as const, id }, { kind: "team" as const, id: "" }].reduce((n, scope) =>
          n + app.agent.memory.entries(scope).filter((e) => !/^source:\s*template:/.test(e.meta)).length + app.agent.memory.topics(scope).reduce((count, topic) => count + app.agent.memory.entries(scope, topic).filter((e) => !/^source:\s*template:/.test(e.meta)).length, 0), 0),
      });
      const merged = mergeGuide(current, derived);
      if (migration || inherited || !saved || JSON.stringify(merged) !== JSON.stringify(current) || (!current.seen.includes("completed") && allDone(current))) save(merged);
      return send(res, 200, { steps: GUIDE_STEPS, owner, ...current, migration,
        welcomeAvailable: !app.store.getKV("guide.welcomeConsumed") && !current.done.includes("hello") && !facts.some((c) => c.successfulReply),
        primaryBotId: "default", primaryBotName: bots.find((b) => b.id === "default")?.name || "",
        botCount: bots.length,
        connectedChannels: app.store.listChannelAccounts().filter((a) => (app.channelStatus(a.key) as Record<string, { state?: string } | undefined>)[a.channel]?.state === "connected").map((a) => a.channel) });
    }
    // —— 故障排查（设置 → 故障排查）：所有输出都已脱敏 ——
    if (seg[0] === "diagnostics") {
      const sub = seg.slice(1).join("/");
      if (sub === "" && m === "GET") return send(res, 200, safeStatus(app));
      if (sub === "logs" && m === "GET") {
        const n = Math.min(Math.max(Number(url.searchParams.get("lines")) || 200, 1), 2000);
        return send(res, 200, { file: logFilePath() ?? "", lines: readLogTail(n) });
      }
      if (sub === "report" && m === "GET") return send(res, 200, { text: diagnosticsReport(app, Math.min(Math.max(Number(url.searchParams.get("lines")) || 200, 1), 2000)) });
      if (sub === "test-model" && m === "POST") {
        const b = await readJson(req);
        const botId = b.botId ? String(b.botId) : undefined;
        if (botId && !app.store.getBot(botId)) throw new HttpError(404, t("web.botNotFound"));
        return send(res, 200, await testModel(app, { botId, model: b.model ? String(b.model) : undefined, timeoutMs: b.timeoutMs ? Number(b.timeoutMs) : undefined }));
      }
      if (sub === "test-agent" && m === "POST") {
        const b = await readJson(req);
        const botId = b.botId ? String(b.botId) : undefined;
        if (botId && !app.store.getBot(botId)) throw new HttpError(404, t("web.botNotFound"));
        return send(res, 200, await testAgent(app, { botId, model: b.model ? String(b.model) : undefined, timeoutMs: b.timeoutMs ? Number(b.timeoutMs) : undefined }));
      }
      if (sub === "restart-agent" && m === "POST") {
        const b = await readJson(req);
        const restarted = await app.agent.restartHosts(b.botId ? String(b.botId) : undefined);
        log.info("agent hosts restarted from troubleshooting", { restarted });
        return send(res, 200, { restarted, agent: (safeStatus(app) as any).agent });
      }
      throw new HttpError(404, "not found");
    }
    return false;
  };
}
