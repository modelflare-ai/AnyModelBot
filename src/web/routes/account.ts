/** Modelflare 账户：登录、刷新、余额与提醒、性价比、退出。 */
import { normalizeLowBalance, saveConfigFile } from "../../config.js";
import { ROUTING_STRATEGIES } from "../../account/client.js";
import { t } from "../../i18n/index.js";
import { HttpError, readJson, send, accountCall, isLoopback, type Route, type WebContext } from "../http.js";

export function accountRoutes(ctx: WebContext): Route {
  const { app, host, stopConversation } = ctx;
  const cfg = app.config;
  return async (req, res, url, seg, p, m) => {
    if (seg[0] === "account") {
      const sub = seg.slice(1).join("/");
      if (m !== "GET" && !app.magpie) throw new HttpError(409, t("web.externalNoAccount"));
      // 浏览器登录的回调落在本程序所在机器的 127.0.0.1；界面监听在非本机地址（Docker、远程部署）时，
      // 用户的浏览器回不到它：登录后把地址栏里的链接贴回来
      const manualLogin = !isLoopback(host);
      const status = () => ({ ...app.account.status(), manualLogin });
      if (sub === "" && m === "GET") return send(res, 200, status());
      if (sub === "refresh" && m === "POST") {
        // 切回窗口时界面会来刷新，20 秒内刚读过就直接返回。打开额度卡片、对话刚处理完时界面要最新的数，
        // 带 maxAgeMs 缩短这个间隔，最短 3 秒（并发的刷新本来就合并成一次）
        const b = await readJson(req).catch(() => ({}));
        const maxAge = Math.min(20_000, Math.max(3_000, Number(b?.maxAgeMs) || 20_000));
        if (Date.now() - app.account.status().updatedAt >= maxAge) await app.account.refresh();
        return send(res, 200, status());
      }
      if (sub === "login" && m === "POST") {
        const loginUrl = await accountCall(() => app.account.startLogin());
        app.desktop?.openExternal(loginUrl);
        return send(res, 200, { ...status(), loginUrl, opened: !!app.desktop });
      }
      if (sub === "login/complete" && m === "POST") {
        const b = await readJson(req);
        await accountCall(async () => app.account.completeLoginFromLink(String(b.link ?? "")));
        return send(res, 200, status());
      }
      if (sub === "login/cancel" && m === "POST") {
        app.account.cancelLogin();
        return send(res, 200, status());
      }
      if (sub === "logout" && m === "POST") {
        // 用户在确认框里知道有任务在跑、仍选择退出：先停下正在进行的对话（已生成的部分保留），
        // 不让它们在连接断开后各自报一串凭据错误。后台任务由任务服务记为中断，重新接入后可以继续
        const b = await readJson(req).catch(() => ({}));
        if (b?.stopRunning) for (const conv of app.runtime.activeConversations()) stopConversation(conv);
        const r = await app.account.logout();
        app.store.setKV("connection.setup", "1");
        app.store.setKV("guide.welcomeConsumed", "1");
        return send(res, 200, { ...status(), revoked: r.revoked });
      }
      if (sub === "setup" && m === "POST") {
        const b = await readJson(req).catch(() => ({}));
        if (b?.stopRunning) for (const conv of app.runtime.activeConversations()) stopConversation(conv);
        app.store.setKV("connection.setup", "1");
        app.store.setKV("guide.welcomeConsumed", "1");
        return send(res, 200, { ok: true });
      }
      if (sub === "continue" && m === "POST") {
        app.store.deleteKV("connection.setup");
        return send(res, 200, { ok: true });
      }
      if (sub === "key-notice" && m === "DELETE") {
        app.dismissKeyChangeNotice();
        return send(res, 200, { ok: true });
      }
      if (sub === "alerts" && m === "PUT") {
        const b = await readJson(req);
        const mf = cfg.modelflare;
        if (b.lowBalanceUsd !== undefined) {
          const v = normalizeLowBalance(b.lowBalanceUsd);
          if (v !== Number(b.lowBalanceUsd)) throw new HttpError(400, t("web.lowBalanceRange"));
          mf.lowBalanceUsd = v;
        }
        if (b.lowBalancePush !== undefined) mf.lowBalancePush = !!b.lowBalancePush;
        saveConfigFile(cfg.dataDir, (f) => (f.modelflare = { ...(f.modelflare ?? {}), lowBalanceUsd: mf.lowBalanceUsd, lowBalancePush: mf.lowBalancePush }));
        return send(res, 200, status());
      }
      if (sub === "usage" && m === "GET") {
        // Modelflare 一次最多给 30 天的用量
        const days = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get("days") || 7)) || 7));
        return send(res, 200, await accountCall(() => app.account.usage(days)));
      }
      if (sub === "notifications" && m === "GET") return send(res, 200, { data: await accountCall(() => app.account.notifications()) });
      if (sub === "invite" && m === "GET") return send(res, 200, await accountCall(() => app.account.invite()));
      if (sub === "budgets" && m === "GET") return send(res, 200, { budgets: await accountCall(() => app.account.botBudgets()) });
      if (sub === "key-quality" && m === "PUT") {
        const b = await readJson(req);
        const strategy = ROUTING_STRATEGIES.find((x) => x === b.strategy);
        if (!strategy) throw new HttpError(400, t("account.routing_invalid"));
        await accountCall(() => app.account.setRoutingStrategy(strategy));
        return send(res, 200, status());
      }
    }
    return false;
  };
}
