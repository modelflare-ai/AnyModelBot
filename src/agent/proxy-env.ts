/**
 * 代理子进程（和代理跑的命令）的网络设置：代理与证书。
 *
 * 子进程的环境是整个替换掉的（host.ts env()），不传这些变量时，用户的代理（国内常见 Clash / V2Ray 的 127.0.0.1:7890）在命令里就没了。
 * Windows 上更糟：Python 退回注册表里的系统代理，urllib 把不带协议的 127.0.0.1:7890 补成 https://127.0.0.1:7890，
 * pip 于是用 TLS 去连一个普通 HTTP 代理，报 SSLEOFError（EOF occurred in violation of protocol）。环境变量里的代理优先于注册表，
 * 所以把代理写成 http://host:port 传下去就好了。
 *
 * 这些都是用户自己的网络设置，不是 AnyModelBot 的密钥：名字固定（不含 KEY / TOKEN / SECRET / PASSWORD），模型密钥不在其中。
 * DSH 拉起命令时按名字过滤密钥样的变量（dsh-subprocess scrubbedParentEnv），这些都会照样传到命令里。
 */

/** 代理变量：大小写两种都传（Python、curl 先认小写） */
export const PROXY_ENV = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"] as const;

/** 证书与软件源：公司网络的根证书、国内镜像 */
export const CERT_ENV = [
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "PIP_CERT",
  "PIP_INDEX_URL",
  "PIP_EXTRA_INDEX_URL",
  "PIP_TRUSTED_HOST",
  "npm_config_registry",
  "GOPROXY",
] as const;

/** 回环地址永远不走代理：本机的 bridge、magpie 网关，命令里起的本地服务 */
export const LOOPBACK_NO_PROXY = ["127.0.0.1", "localhost", "::1"];

/** 拿来问系统代理的地址：按顺序问，第一个不是直连的算数（PAC 可能只给部分网站走代理） */
export const PROXY_PROBE_URLS = ["https://pypi.org/", "https://github.com/"];

/** 问系统代理最多等这么久（PAC 要下载时可能慢）；超时就当没有 */
export const SYSTEM_PROXY_TIMEOUT_MS = 3000;

type Env = Record<string, string | undefined>;

const PROXY_NAMES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];

/** 环境里设了代理（任一种、任一大小写） */
export function hasEnvProxy(env: Env): boolean {
  return PROXY_NAMES.some((k) => !!env[k]?.trim() || !!env[k.toLowerCase()]?.trim());
}

/** 把回环地址并进 NO_PROXY（保留用户原来的写法和顺序；`*` 本来就全部直连） */
export function withLoopback(noProxy: string | undefined): string {
  const entries = (noProxy ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.includes("*")) return "*";
  const have = new Set(entries.map((e) => e.toLowerCase()));
  return [...entries, ...LOOPBACK_NO_PROXY.filter((e) => !have.has(e))].join(",");
}

/**
 * Chromium 的代理解析结果（PAC 写法，如 "PROXY 127.0.0.1:7890; DIRECT"）→ 环境变量。
 * 按顺序取第一项：DIRECT 什么都不设；PROXY / HTTPS 设 HTTP_PROXY 和 HTTPS_PROXY（http:// 或 https://）；SOCKS 设 ALL_PROXY。
 */
export function proxyEnvFromPac(pac: string | undefined): Record<string, string> {
  for (const item of (pac ?? "").split(";")) {
    const [kind = "", hostPort = ""] = item.trim().split(/\s+/);
    const k = kind.toUpperCase();
    if (!k) continue;
    if (k === "DIRECT") return {};
    if (!/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(hostPort)) continue;
    const scheme = k === "PROXY" || k === "HTTP" ? "http" : k === "HTTPS" ? "https" : k === "SOCKS5" ? "socks5" : k === "SOCKS" || k === "SOCKS4" ? "socks4" : "";
    if (!scheme) continue;
    const url = `${scheme}://${hostPort}`;
    if (scheme.startsWith("socks")) return { ALL_PROXY: url, all_proxy: url };
    return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url };
  }
  return {};
}

/**
 * 问系统用的代理（桌面版：Electron 按系统设置和 PAC 解析）。从不抛错：出错、超时、全是直连都返回 {}。
 */
export async function systemProxyEnv(resolve: (url: string) => Promise<string | undefined>, timeoutMs = SYSTEM_PROXY_TIMEOUT_MS): Promise<Record<string, string>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Record<string, string>>((r) => {
    timer = setTimeout(() => r({}), timeoutMs);
    timer.unref?.();
  });
  const probe = (async () => {
    for (const url of PROXY_PROBE_URLS) {
      const env = proxyEnvFromPac(await resolve(url));
      if (Object.keys(env).length) return env;
    }
    return {};
  })().catch(() => ({}));
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 传给代理子进程的网络变量：parent 里的代理与证书变量原样传；parent 里没有代理时用 system（系统代理）。
 * 有任何代理时 NO_PROXY / no_proxy 都并进回环地址。
 */
export function networkEnv(parent: Env, system: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of [...PROXY_ENV, ...CERT_ENV]) {
    const v = parent[k];
    if (v?.trim()) env[k] = v;
  }
  if (!hasEnvProxy(parent)) Object.assign(env, system);
  if (hasEnvProxy(env)) {
    const upper = env.NO_PROXY;
    const lower = env.no_proxy;
    env.NO_PROXY = withLoopback(upper ?? lower);
    env.no_proxy = withLoopback(lower ?? upper);
  }
  return env;
}
