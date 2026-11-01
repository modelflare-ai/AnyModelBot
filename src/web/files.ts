/**
 * 对话里交付的文件：网页里图片直接显示、点开在新标签页打开，桌面版用系统的默认程序打开、在文件夹中显示。
 *
 * 只给两种文件：这个会话交付过的，和这个机器人工作区里的。都按解析符号链接之后的真实路径判断，路径里不许有 ..；
 * 数据目录里工作区以外的地方（数据库、令牌、密钥、别的机器人）一律不给。硬链接也不给：看不出它指向哪里。
 *
 * 代理生成的内容不在应用的源里运行：浏览器里直接显示的只有图片（SVG 除外）、PDF 和纯文本，其余一律下载（attachment）；
 * 全部带 nosniff，PDF 以外都加 CSP sandbox（浏览器自带的 PDF 阅读器在 sandbox 里打不开）。
 * 桌面版里打开就会运行的文件（.exe、.bat、脚本…）不直接打开，只在文件夹中显示。
 */
import type http from "node:http";
import fs from "node:fs";
import path from "node:path";

/** 界面上的一个交付文件：image 的在对话里直接显示；gone = 文件已经不在了 */
export interface ShownFile {
  path: string;
  name: string;
  size?: number;
  image?: boolean;
  gone?: boolean;
}

/** 在对话里直接显示的图片（SVG 能带脚本，不算） */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const TEXT = "text/plain; charset=utf-8";
/** 浏览器里可以直接显示的类型；其余一律下载 */
const INLINE_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  ".pdf": "application/pdf",
  ".txt": TEXT,
  ".log": TEXT,
  ".md": TEXT,
  ".csv": TEXT,
  ".tsv": TEXT,
  ".json": TEXT,
};

/** 打开就会运行的类型（Windows、macOS、Linux）：桌面版只在文件夹中显示 */
const RUNNABLE = new Set(
  [
    "exe com bat cmd msi msp mst msc msix msixbundle appx appxbundle ps1 psm1 psd1 vb vbs vbe js jse ws wsc wsf wsh sct hta scr pif cpl dll ocx sys",
    "lnk url reg inf scf shb shs appref-ms application gadget settingcontent-ms library-ms search-ms diagcab chm hlp xll mde ade adp iso img vhd vhdx jar",
    "docm dotm xlsm xltm xlam pptm potm ppam",
    "app command tool terminal workflow pkg mpkg dmg sh bash zsh csh ksh fish run bin appimage desktop py pyw rb pl php",
  ]
    .join(" ")
    .split(" ")
    .map((e) => "." + e),
);

const isWin = process.platform === "win32";
/** Windows 的路径不分大小写 */
const norm = (p: string) => (isWin ? p.toLowerCase() : p);
const samePath = (a: string, b: string) => norm(a) === norm(b);
function inside(p: string, root: string): boolean {
  const r = norm(root);
  const x = norm(p);
  return x === r || x.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

function realpath(p: string): string | undefined {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
}

/** 界面要的样子：名字、大小、是不是直接显示的图片；文件不在了标 gone */
export function describeFile(p: string, name = path.basename(p)): ShownFile {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) throw new Error("not a file");
    return { path: p, name, size: st.size, ...(IMAGE_TYPES[path.extname(name).toLowerCase()] ? { image: true } : {}) };
  } catch {
    return { path: p, name, gone: true };
  }
}

/** 机器人的工作区 <数据目录>/workspaces/<id>（同 AgentHost.workspace）；id 不是一段普通的名字时不给 */
export function botWorkspace(dataDir: string, botId: string): string | undefined {
  return /^[\w-][\w.-]*$/.test(botId) ? path.join(dataDir, "workspaces", botId) : undefined;
}

export interface FileScope {
  /** 机器人工作区 */
  workspace: string;
  /** 数据目录：工作区以外的部分一律不给 */
  dataDir: string;
  /** 这个会话交付过的文件（存下的真实路径） */
  delivered: string[];
}

export interface ResolvedFile {
  /** 真实路径 */
  path: string;
  size: number;
  mtimeMs: number;
  mode: number;
}

/**
 * 界面给的路径（交付时存下的真实路径，或相对工作区的路径）→ 能给出去的文件；不能给（不存在、越界、不是普通文件）返回 undefined。
 */
export function resolveFile(input: string, scope: FileScope): ResolvedFile | undefined {
  if (!input || input.includes("\0") || input.split(/[\\/]/).includes("..")) return undefined;
  const ws = realpath(scope.workspace);
  const data = realpath(scope.dataDir);
  if (!ws || !data) return undefined;
  const real = realpath(path.resolve(ws, input));
  if (!real) return undefined;
  // 数据目录里只认这个机器人的工作区
  if (inside(real, data) && !inside(real, ws)) return undefined;
  if (!inside(real, ws) && !scope.delivered.some((d) => samePath(realpath(d) ?? "", real))) return undefined;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return undefined;
  }
  if (!st.isFile() || st.nlink > 1) return undefined;
  return { path: real, size: st.size, mtimeMs: st.mtimeMs, mode: st.mode };
}

/** 桌面版打开就会运行它：只在文件夹中显示 */
export function runnable(f: Pick<ResolvedFile, "path" | "mode">): boolean {
  const ext = path.extname(f.path).toLowerCase();
  if (RUNNABLE.has(ext)) return true;
  // 没有扩展名的可执行文件（macOS 会交给终端运行）
  return !isWin && !ext && (f.mode & 0o111) !== 0;
}

/** 回给浏览器的头：能直接显示的 inline，其余 attachment；都带 nosniff，PDF 以外加 CSP sandbox */
export function fileHeaders(name: string): Record<string, string> {
  const ext = path.extname(name).toLowerCase();
  const inline = INLINE_TYPES[ext];
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "content-type": inline ?? "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
    ...(ext === ".pdf" ? {} : { "content-security-policy": "sandbox" }),
    // 别的网站不能把它嵌进自己的页面
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, no-cache",
  };
}

/** 把文件发给浏览器（带 ETag，没变时 304） */
export function sendFile(req: http.IncomingMessage, res: http.ServerResponse, f: ResolvedFile): void {
  const etag = `W/"${f.size.toString(36)}-${Math.floor(f.mtimeMs).toString(36)}"`;
  const headers = { ...fileHeaders(path.basename(f.path)), etag };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  const stream = fs.createReadStream(f.path);
  stream.once("open", () => {
    res.writeHead(200, { ...headers, "content-length": String(f.size) });
    stream.pipe(res);
  });
  stream.once("error", () => {
    if (!res.headersSent) res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    else res.destroy();
  });
  res.once("close", () => stream.destroy());
}
