import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";

/**
 * 同源反向代理到 magpie web：
 * - /magpie/* 去掉前缀转发（magpie 的 index.html 使用相对资源路径，可在子路径下工作）；
 * - magpie 前端写死的绝对路径（/api/*、/_magpie/*、/icons/*、插件页等）由“兜底”路由转发；
 * - /v1* 转发到 gateway 端口（web 端口会把 /v1 当作“来自其他机器”而拒绝）；
 * - 服务端注入 magpie_web_<port> cookie，用户无需二次登录；浏览器端拿不到 magpie key。
 */
export interface ProxyTarget {
  webOrigin: () => string; // http://127.0.0.1:<webPort>
  gatewayOrigin: () => string; // http://127.0.0.1:<gwPort>
  cookie: () => string; // magpie_web_<port>=<key>
  gatewayKey: () => string;
  ready: () => boolean;
}

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

function mapPath(url: string): { gateway: boolean; path: string } {
  let p = url;
  if (p === "/magpie") p = "/";
  else if (p.startsWith("/magpie/")) p = p.slice("/magpie".length);
  else if (p.startsWith("/magpie?")) p = "/" + p.slice("/magpie".length);
  const gateway = p === "/v1" || p.startsWith("/v1/") || p.startsWith("/v1?");
  return { gateway, path: p };
}

function outHeaders(req: http.IncomingMessage, t: ProxyTarget, gateway: boolean, targetHost: string): http.OutgoingHttpHeaders {
  const h: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== "cookie" && k !== "authorization") h[k] = v;
  h.host = targetHost;
  // 不把我们自己的 cookie 转给 magpie，只注入 magpie 的
  h.cookie = t.cookie();
  if (gateway) h.authorization = `Bearer ${t.gatewayKey()}`;
  // magpie 用 Origin/Referer 判断同源；改写成目标源
  if (h.origin) h.origin = `http://${targetHost}`;
  if (h.referer) h.referer = `http://${targetHost}/`;
  return h;
}

/**
 * 纵深防御：即使 magpie 界面里有入口，也拒绝会改写本机 agent 配置、发现/复用订阅凭据、
 * 自更新或交接本机代理的接口（magpie 已以 --gateway 模式和隔离 HOME 运行，此处再兜一层）。
 */
const BLOCKED = [/^\/api\/agents(\/|$|\?)/, /^\/api\/agent-models(\/|$|\?)/, /^\/api\/accounts(\/|$|\?)/, /^\/api\/update(\/|$|\?)/, /^\/api\/handover(\/|$|\?)/];
export function isBlockedPath(url: string): boolean {
  let p = mapPath(url).path.split("?")[0]!;
  try {
    p = decodeURIComponent(p);
  } catch {
    return true;
  }
  p = path.posix.normalize(p.replace(/\\/g, "/").replace(/\/+/g, "/")).toLowerCase();
  return BLOCKED.some((r) => r.test(p));
}

export function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, t: ProxyTarget): void {
  if (isBlockedPath(req.url || "/")) {
    res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "anymodel bot 已禁用此 magpie 功能（agent 配置改写 / 订阅凭据复用 / 自更新）" }));
    return;
  }
  if (!t.ready()) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("magpie 尚未启动");
    return;
  }
  const { gateway, path } = mapPath(req.url || "/");
  const origin = new URL(gateway ? t.gatewayOrigin() : t.webOrigin());
  const upstream = http.request(
    { hostname: origin.hostname, port: origin.port, method: req.method, path, headers: outHeaders(req, t, gateway, origin.host) },
    (up) => {
      const headers = { ...up.headers };
      // 防止 magpie 的 Set-Cookie 覆盖/泄露 key；我们在服务端统一注入
      delete headers["set-cookie"];
      // 重定向改写回 /magpie/ 子路径
      if (headers.location && headers.location.startsWith("/") && !headers.location.startsWith("/magpie")) {
        const loc = headers.location.replace(/([?&])k=[^&]*&?/, "$1").replace(/[?&]$/, "");
        headers.location = loc === "/" || loc.startsWith("/?") ? "/magpie" + loc : loc;
      }
      res.writeHead(up.statusCode || 502, headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`magpie proxy error: ${e.message}`);
  });
  req.pipe(upstream);
}

export function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, t: ProxyTarget): void {
  if (isBlockedPath(req.url || "/")) {
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  if (!t.ready()) return void socket.destroy();
  const { gateway, path } = mapPath(req.url || "/");
  const origin = new URL(gateway ? t.gatewayOrigin() : t.webOrigin());
  const up = net.connect(Number(origin.port), origin.hostname, () => {
    const h = outHeaders(req, t, gateway, origin.host);
    h.connection = "Upgrade";
    h.upgrade = req.headers.upgrade || "websocket";
    let raw = `${req.method} ${path} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(h)) if (v !== undefined) raw += `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`;
    up.write(raw + "\r\n");
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
}
