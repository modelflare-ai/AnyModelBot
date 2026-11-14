/** 这台电脑：电脑操作的系统权限（macOS 桌面版）、Windows 上代理用的 PowerShell。 */
import { saveConfigFile } from "../../config.js";
import { pwshProbe, type PwshMode } from "../../tools/pwsh/index.js";
import { t as tr } from "../../i18n/index.js";
import { HttpError, readJson, send, type Route, type WebContext } from "../http.js";

export function computerRoutes(ctx: WebContext): Route {
  const { app } = ctx;
  const cfg = app.config;
  return async (req, res, url, seg, p, m) => {
    // —— 电脑操作的系统权限（macOS 桌面版，第 18 项）：状态、系统原生请求、打开设置页、稍后、重新打开应用 ——
    if (p === "/computer-use/relaunch-drafts" && m === "GET") {
      const raw = app.store.getKV("relaunch.drafts");
      app.store.deleteKV("relaunch.drafts");
      let drafts = {};
      try {
        drafts = raw ? JSON.parse(raw) : {};
      } catch {
        drafts = {};
      }
      return send(res, 200, { drafts });
    }
    if (seg[0] === "computer-use" && seg[1] === "permissions") {
      const perms = app.cuPermissions;
      const kind = (v: unknown) => {
        if (v !== "accessibility" && v !== "screen") throw new HttpError(400, "unknown permission");
        return v;
      };
      if (seg.length === 2 && m === "GET") return send(res, 200, perms.view());
      if (seg[2] === "check" && m === "POST") {
        void perms.check();
        return send(res, 200, perms.view());
      }
      if (seg[2] === "continue" && m === "POST") {
        const b = await readJson(req);
        void perms.check(String(b.botId || ""), true);
        return send(res, 200, perms.view());
      }
      if (seg[2] === "request" && m === "POST") {
        const body = await readJson(req);
        if (body.botId) perms.expand(String(body.botId));
        await perms.request(kind(body.kind));
        return send(res, 200, perms.view());
      }
      if (seg[2] === "open" && m === "POST") {
        perms.openSettings(kind((await readJson(req)).kind));
        return send(res, 200, perms.view());
      }
      if (seg[2] === "blocked" && seg[3] && m === "DELETE") {
        perms.dismiss(decodeURIComponent(seg[3]));
        return send(res, 200, perms.view());
      }
      if (seg[2] === "relaunch" && m === "POST") {
        if (!app.desktop?.relaunch) throw new HttpError(404, "not supported");
        // 没发出的草稿暂存一次：重新打开后界面取回（GET …/relaunch-drafts）就删掉
        const b = await readJson(req).catch(() => ({}));
        const drafts = Object.fromEntries(Object.entries(b?.drafts && typeof b.drafts === "object" ? b.drafts : {})
          .filter(([k, v]) => typeof v === "string" && k.length <= 200).map(([k, v]) => [k, String(v)]));
        if (Object.keys(drafts).length) app.store.setKV("relaunch.drafts", JSON.stringify(drafts));
        send(res, 200, { ok: true });
        setTimeout(() => app.desktop?.relaunch?.(), 300);
        return;
      }
      throw new HttpError(404, "not found");
    }
    // —— Windows：代理用的 PowerShell（对话空状态、设置 → 常规、故障排查）——
    if (seg[0] === "pwsh") {
      const view = () => ({ ...pwshProbe.snapshot(), dismissed: cfg.ui.pwshHintDismissed });
      const setMode = (mode: PwshMode) => {
        if (cfg.agent.pwsh === mode) return;
        cfg.agent.pwsh = mode;
        saveConfigFile(cfg.dataDir, (f) => (f.agent = { ...(f.agent ?? {}), pwsh: mode }));
      };
      if (seg.length === 1 && m === "GET") {
        await pwshProbe.check();
        return send(res, 200, view());
      }
      // 重新检测：重新找、重新试运行（装好系统 PowerShell 7 后点它；空闲的代理进程随后换用）
      if (seg[1] === "recheck" && m === "POST") {
        await pwshProbe.check(true);
        return send(res, 200, view());
      }
      // 安装 / 重新安装应用内置的 PowerShell 7：后台进行，进度从 GET 读
      if (seg[1] === "install" && m === "POST") {
        if (process.platform !== "win32" || !pwshProbe.applicable) throw new HttpError(400, tr("web.windowsOnly"));
        const b = await readJson(req);
        setMode("auto");
        await pwshProbe.check();
        pwshProbe.install({ reinstall: !!b.reinstall });
        return send(res, 200, view());
      }
      // 改回系统默认（system）/ 重新用内置的（auto）
      if (seg[1] === "mode" && m === "PUT") {
        const b = await readJson(req);
        const mode: PwshMode = b.mode === "system" ? "system" : "auto";
        setMode(mode);
        pwshProbe.setMode(mode);
        return send(res, 200, view());
      }
      if (seg.length === 1 && m === "PUT") {
        const b = await readJson(req);
        if (b.dismissed !== undefined) {
          cfg.ui.pwshHintDismissed = !!b.dismissed;
          saveConfigFile(cfg.dataDir, (f) => (f.ui = { ...(f.ui ?? {}), pwshHintDismissed: cfg.ui.pwshHintDismissed }));
        }
        await pwshProbe.check();
        return send(res, 200, view());
      }
      throw new HttpError(405, "method not allowed");
    }
    return false;
  };
}
