/**
 * 目录 Bot 的接口：目录、示例、实例、界面读写文件。界面文件的静态路由在 botkit/static.ts（amb-bot check 渲染时也用它）。
 */
import http from "node:http";
import path from "node:path";
import { LIMITS } from "../botkit/format.js";
import type { BotCatalog, CatalogEntry } from "../botkit/catalog.js";
import { CatalogError, instanceId, uiBase, type BotInstaller } from "../botkit/installer.js";
import { botWorkspace, runnable, sendFile } from "./files.js";
import type { FilePreviews } from "./file-previews.js";
import { SseReply } from "./sse-reply.js";

/** 给界面的目录条目：开发目录的本机路径不外传 */
export function publicEntry(e: CatalogEntry, hasInstance: boolean) {
  const { dev, ui, runtime, ...rest } = e;
  return { ...rest, isDev: !!dev, instanceId: hasInstance ? instanceId(e.id) : undefined };
}

export interface ApiDeps {
  catalog: BotCatalog;
  installer: BotInstaller;
  getBot: (id: string) => any;
  publicBot: (bot: any) => unknown;
  deleteBot: (id: string, keepData: boolean) => Promise<void>;
  send: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<any>;
  appLang: () => string;
  /** 只有界面监听在本机时才能登记本机目录 */
  loopback: boolean;
  /** 桌面版才有：用系统程序打开、在文件夹中显示 */
  desktop?: { openPath?: (p: string) => unknown; showItemInFolder?: (p: string) => unknown };
  previews?: FilePreviews;
  dataDir?: string;
}

function fail(res: http.ServerResponse, d: ApiDeps, e: unknown): void {
  // 错误只给代码，文案在界面的词典里（botapp.errors.*）
  const code = e instanceof CatalogError ? e.code : "catalog_failed";
  if (!res.headersSent) d.send(res, e instanceof CatalogError ? e.status : 500, { error: code, code });
}

async function readLargeJson(req: http.IncomingMessage, limit: number): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new CatalogError("inbox_too_large", 413);
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** /amb/api/catalog*、/amb/api/bots/:id/app*。处理了返回 true */
export async function botAppApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, seg: string[], d: ApiDeps): Promise<boolean> {
  const m = req.method || "GET";
  try {
    if (seg[0] === "catalog") {
      if (seg.length === 1 && m === "GET") {
        d.send(res, 200, { bots: d.catalog.list().map((e) => ({ ...publicEntry(e, !!d.getBot(instanceId(e.id))), userRemoved: d.installer.isRemoved(e.id) })), syncedAt: d.catalog.syncedAt, enabled: d.catalog.enabled });
        return true;
      }
      if (seg[1] === "sync" && m === "POST") {
        await d.catalog.sync();
        d.send(res, 200, { ok: true, error: d.catalog.lastError || undefined });
        return true;
      }
      if (seg[1] === "dev") {
        if (!d.loopback) throw new CatalogError("dev_loopback_only", 403);
        if (seg.length === 2 && m === "POST") {
          const b = await d.readJson(req);
          let entry: CatalogEntry;
          try {
            entry = d.catalog.addDev(String(b.dir ?? ""));
          } catch {
            throw new CatalogError("dev_invalid", 400);
          }
          d.send(res, 200, { bot: publicEntry(entry, !!d.getBot(instanceId(entry.id))), base: uiBase(entry) });
          return true;
        }
        if (seg.length === 3 && m === "DELETE") {
          d.catalog.removeDev(decodeURIComponent(seg[2]));
          d.send(res, 200, { ok: true });
          return true;
        }
      }
      const id = decodeURIComponent(seg[1] ?? "");
      const entry = d.catalog.get(id);
      if (!entry) throw new CatalogError("catalog_not_found", 404);
      if (seg.length === 2 && m === "GET") {
        d.send(res, 200, { bot: publicEntry(entry, !!d.getBot(instanceId(id))) });
        return true;
      }
      if (seg[2] === "preview" && m === "POST") {
        // 打开只准备界面包（官方包从安装包解出）：不创建实例、不装技能、不起进程
        if (entry.removed) throw new CatalogError("catalog_removed", 410);
        await d.catalog.ensureUi(entry).catch(() => {
          throw new CatalogError("catalog_download_failed", 502);
        });
        d.send(res, 200, { bot: publicEntry(entry, !!d.getBot(instanceId(id))), base: uiBase(entry) });
        return true;
      }
      if (seg[2] === "file" && m === "GET") {
        const file = await d.installer.previewFile(entry, url.searchParams.get("path"), d.appLang());
        if (!file) throw new CatalogError("file_not_found", 404);
        d.send(res, 200, file);
        return true;
      }
      if (seg[2] === "install" && m === "POST") {
        const bot = await d.installer.install(id, d.appLang());
        d.send(res, 200, { bot: d.publicBot(bot), base: uiBase(entry) });
        return true;
      }
      return false;
    }
    if (seg[0] === "bots" && seg[2] === "app") {
      const botId = decodeURIComponent(seg[1]);
      const bot = d.getBot(botId);
      if (!bot?.app) throw new CatalogError("catalog_not_found", 404);
      const sub = seg.slice(3).join("/");
      if (sub === "" && m === "GET") {
        const info = d.installer.info(bot);
        d.send(res, 200, { ref: info.ref, base: info.base, updateAvailable: info.updateAvailable, bot: info.entry ? publicEntry(info.entry, true) : undefined });
        return true;
      }
      if (sub === "update" && m === "POST") {
        const result = await d.installer.update(botId);
        d.send(res, 200, { result, bot: d.publicBot(d.getBot(botId)) });
        return true;
      }
      if (sub === "file" && m === "GET") {
        const file = await d.installer.readFile(bot, url.searchParams.get("path"));
        if (!file) throw new CatalogError("file_not_found", 404);
        d.send(res, 200, file);
        return true;
      }
      if (sub === "image" && m === "GET") {
        const image = d.installer.readImage(bot, url.searchParams.get("path"));
        if (!image) throw new CatalogError("file_not_found", 404);
        d.send(res, 200, image);
        return true;
      }
      if (sub === "list" && m === "GET") {
        d.send(res, 200, { files: d.installer.listApp(botId) });
        return true;
      }
      if (sub === "media" && m === "GET") {
        const file = d.installer.mediaFile(bot, url.searchParams.get("path"));
        if (!file) throw new CatalogError("file_not_found", 404);
        sendFile(req, res, file, file.mime);
        return true;
      }
      if (sub === "download" && m === "GET") {
        const file = d.installer.appFile(bot, url.searchParams.get("path"));
        if (!file) throw new CatalogError("file_not_found", 404);
        sendFile(req, res, file, undefined, url.searchParams.get("download") === "1");
        return true;
      }
      if (sub === "preview" && m === "GET" && d.previews && d.dataDir) {
        const file = d.installer.appFile(bot, url.searchParams.get("path"));
        const workspace = botWorkspace(d.dataDir, botId);
        if (!file || !workspace) throw new CatalogError("file_not_found", 404);
        d.send(res, 200, await d.previews.describe(file, { workspace, dataDir: d.dataDir, delivered: [] }));
        return true;
      }
      // 打开就会运行的文件不直接打开，只在文件夹中显示（同 /conversations/:id/file/open）
      if (sub === "open" && m === "POST") {
        const b = await d.readJson(req);
        const file = d.installer.appFile(bot, b.path);
        if (!file) throw new CatalogError("file_not_found", 404);
        if (!d.desktop?.openPath) throw new CatalogError("desktop_only", 400);
        if (!b.reveal && !runnable(file)) {
          d.desktop.openPath(file.path);
          d.send(res, 200, { ok: true });
          return true;
        }
        if (d.desktop.showItemInFolder) d.desktop.showItemInFolder(file.path);
        else d.desktop.openPath(path.dirname(file.path));
        d.send(res, 200, { ok: true, revealed: true });
        return true;
      }
      if (sub === "inbox" && m === "POST") {
        const b = await readLargeJson(req, Math.ceil(LIMITS.inboxBytes * 1.4));
        const data = Buffer.from(String(b.base64 ?? ""), "base64");
        d.send(res, 200, { path: d.installer.saveInbox(botId, String(b.name ?? "file"), data), size: data.length });
        return true;
      }
      if (sub === "watch" && m === "GET") {
        const out = new SseReply(res);
        const off = d.installer.watch(botId, (rel) => out.send("file", { path: rel }));
        res.on("close", off);
        return true;
      }
    }
  } catch (e) {
    fail(res, d, e);
    return true;
  }
  return false;
}
