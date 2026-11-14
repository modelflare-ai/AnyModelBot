/** Read-only previews. HTML gets a short-lived, directory-scoped capability so an
 * opaque sandbox can load its assets without receiving the console's credentials. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { IMAGE_TYPES, resolveFile, type FileScope, type ResolvedFile } from "./files.js";

const PREFIX = "/amb/file-preview/";
const TEXT_LIMIT = 2 * 1024 * 1024;
const ASSET_LIMIT = 32 * 1024 * 1024;
const TTL = 60 * 60 * 1000;
const TEXT_EXT = new Set(".txt .log .csv .tsv .json .yaml .yml .xml .js .mjs .cjs .ts .tsx .jsx .css .py .sh .sql .toml .ini .env .md .markdown".split(" "));
const ASSETS: Record<string, string> = {
  ...IMAGE_TYPES, ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
type Grant = { root: string; entry: string; scope: FileScope; expires: number };
const inside = (file: string, root: string) => {
  const rel = path.relative(root, file);
  return !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep);
};

export class FilePreviews {
  private grants = new Map<string, Grant>();

  async describe(file: ResolvedFile, scope: FileScope) {
    const name = path.basename(file.path);
    const ext = path.extname(name).toLowerCase();
    const meta = { name, size: file.size };
    if (IMAGE_TYPES[ext]) return { ...meta, kind: "image" };
    if (ext === ".pdf") return { ...meta, kind: "pdf" };
    if (ext === ".html" || ext === ".htm" || ext === ".svg") {
      if (file.size > ASSET_LIMIT) return { ...meta, kind: "unsupported", reason: "tooLarge" };
      const now = Date.now();
      for (const [key, grant] of this.grants) if (grant.expires <= now) this.grants.delete(key);
      while (this.grants.size >= 64) this.grants.delete(this.grants.keys().next().value!);
      const key = crypto.randomBytes(24).toString("base64url");
      this.grants.set(key, { root: path.dirname(file.path), entry: file.path, scope, expires: now + TTL });
      return { ...meta, kind: "html", url: `${PREFIX}${key}/${encodeURIComponent(name)}` };
    }
    if (!TEXT_EXT.has(ext)) return { ...meta, kind: "unsupported", reason: "unsupported" };
    if (file.size > TEXT_LIMIT) return { ...meta, kind: "unsupported", reason: "tooLarge" };
    // Bound the read even if the agent grows the file after it was resolved.
    const handle = await fs.promises.open(file.path, "r");
    try {
      const buf = Buffer.alloc(TEXT_LIMIT + 1);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      if (bytesRead > TEXT_LIMIT) return { ...meta, kind: "unsupported", reason: "tooLarge" };
      const text = buf.subarray(0, bytesRead).toString("utf8");
      if (text.includes("\0")) return { ...meta, kind: "unsupported", reason: "unsupported" };
      return { ...meta, kind: ext === ".md" || ext === ".markdown" ? "markdown" : "text", text };
    } finally { await handle.close(); }
  }

  static isAssetRequest(req: http.IncomingMessage, url: URL) {
    return url.pathname.startsWith(PREFIX) && (req.method === "GET" || req.method === "HEAD");
  }

  serve(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
    if (!FilePreviews.isAssetRequest(req, url)) return false;
    const fail = () => { res.writeHead(404, { "cache-control": "no-store" }).end("not found"); return true; };
    const [key, ...parts] = url.pathname.slice(PREFIX.length).split("/");
    const grant = this.grants.get(key);
    if (!grant || grant.expires <= Date.now()) { this.grants.delete(key); return fail(); }
    let rel: string;
    try { rel = parts.map(decodeURIComponent).join("/"); } catch { return fail(); }
    if (!rel || rel.includes("\\") || rel.includes("\0") || rel.split("/").some((p) => p === ".." || p === ".") || path.isAbsolute(rel)) return fail();
    const file = resolveFile(path.join(grant.root, rel), grant.scope);
    if (!file || !inside(file.path, grant.root) || file.size > ASSET_LIMIT) return fail();
    // Delivered files outside the workspace do not grant access to their siblings.
    let workspace: string;
    try { workspace = fs.realpathSync(grant.scope.workspace); } catch { return fail(); }
    if (!inside(grant.entry, workspace) && file.path !== grant.entry) return fail();
    const mime = ASSETS[path.extname(file.path).toLowerCase()];
    if (!mime) return fail();
    const host = req.headers.host || "localhost";
    const sources = [`http://${host}${PREFIX}${key}/`, `https://${host}${PREFIX}${key}/`].join(" ");
    const headers = {
      "content-type": mime, "content-length": String(file.size), "cache-control": "no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      // No cookies, console API access, parent access, popups, forms or nested frames.
      "content-security-policy": `sandbox allow-scripts; default-src 'none'; script-src ${sources} https: 'unsafe-inline'; style-src ${sources} https: 'unsafe-inline'; img-src ${sources} https: data: blob:; font-src ${sources} https: data:; media-src ${sources} blob:; connect-src ${sources}; frame-src 'none'; object-src 'none'; base-uri ${sources}; form-action 'none'; frame-ancestors 'self'`,
      // ES modules and fetch() inside the opaque sandbox use CORS without credentials.
      "access-control-allow-origin": "*",
    };
    if (req.method === "HEAD") { res.writeHead(200, headers).end(); return true; }
    const stream = fs.createReadStream(file.path);
    stream.once("open", () => { res.writeHead(200, headers); stream.pipe(res); });
    stream.once("error", () => { if (!res.headersSent) fail(); else res.destroy(); });
    res.once("close", () => stream.destroy());
    return true;
  }
}
