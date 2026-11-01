import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store/db.js";
import { AgentHost } from "../src/agent/host.js";
import { CERT_ENV, PROXY_ENV, PROXY_PROBE_URLS, hasEnvProxy, networkEnv, proxyEnvFromPac, systemProxyEnv, withLoopback } from "../src/agent/proxy-env.js";

const LOOP = "127.0.0.1,localhost,::1";

describe("networkEnv: the user's proxy and certificate settings reach the agent child", () => {
  it("passes the proxy variables through", () => {
    const env = networkEnv({ HTTP_PROXY: "http://127.0.0.1:7890", HTTPS_PROXY: "http://127.0.0.1:7890", ALL_PROXY: "socks5://127.0.0.1:7891", PATH: "/bin" });
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.ALL_PROXY).toBe("socks5://127.0.0.1:7891");
    expect(env).not.toHaveProperty("PATH");
  });

  it("passes the lowercase forms through", () => {
    const env = networkEnv({ http_proxy: "http://p:1", https_proxy: "http://p:2", all_proxy: "socks5://p:3", no_proxy: "corp.example" });
    expect(env).toMatchObject({ http_proxy: "http://p:1", https_proxy: "http://p:2", all_proxy: "socks5://p:3" });
    expect(env.no_proxy).toBe(`corp.example,${LOOP}`);
  });

  it("passes certificate and package-index settings through", () => {
    const parent = Object.fromEntries(CERT_ENV.map((k) => [k, `v-${k}`]));
    expect(networkEnv(parent)).toEqual(parent);
  });

  it("merges loopback into NO_PROXY / no_proxy whenever a proxy is set", () => {
    const env = networkEnv({ HTTPS_PROXY: "http://p:1", NO_PROXY: "10.0.0.1, .corp.example,LOCALHOST" });
    // 用户的写法和顺序保留，已有的（不分大小写）不重复
    expect(env.NO_PROXY).toBe("10.0.0.1,.corp.example,LOCALHOST,127.0.0.1,::1");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    // 没写 NO_PROXY 也补上
    expect(networkEnv({ https_proxy: "http://p:1" })).toMatchObject({ NO_PROXY: LOOP, no_proxy: LOOP });
    // 只设了 ALL_PROXY 也算有代理
    expect(networkEnv({ ALL_PROXY: "socks5://p:1" }).NO_PROXY).toBe(LOOP);
    // 两种大小写写得不一样：各自保留
    expect(networkEnv({ HTTP_PROXY: "http://p:1", NO_PROXY: "a", no_proxy: "b" })).toMatchObject({ NO_PROXY: `a,${LOOP}`, no_proxy: `b,${LOOP}` });
    expect(withLoopback("*")).toBe("*");
  });

  it("leaves NO_PROXY alone and sets nothing without a proxy", () => {
    expect(networkEnv({})).toEqual({});
    expect(networkEnv({ NO_PROXY: "corp.example", HTTPS_PROXY: "  " })).toEqual({ NO_PROXY: "corp.example" });
  });

  it("uses the system proxy only when the environment names none", () => {
    const sys = proxyEnvFromPac("PROXY 127.0.0.1:7890");
    expect(networkEnv({}, sys)).toEqual({ ...sys, NO_PROXY: LOOP, no_proxy: LOOP });
    // 环境变量里的代理优先：系统代理整个不用
    expect(networkEnv({ https_proxy: "http://corp:3128" }, sys)).toEqual({ https_proxy: "http://corp:3128", NO_PROXY: LOOP, no_proxy: LOOP });
  });

  it("never carries a model key or token", () => {
    for (const k of [...PROXY_ENV, ...CERT_ENV]) expect(k).not.toMatch(/KEY|PASSWORD|SECRET|TOKEN/i);
    const env = networkEnv({ HTTPS_PROXY: "http://p:1", AMB_MAGPIE_API_KEY: "sk-real", OPENAI_API_KEY: "sk-x", FEISHU_APP_SECRET: "s", GITHUB_TOKEN: "t", HTTPS_PROXY_PASSWORD: "pw" });
    expect(Object.keys(env).sort()).toEqual(["HTTPS_PROXY", "NO_PROXY", "no_proxy"]);
  });
});

describe("system proxy (desktop: Electron resolveProxy)", () => {
  it("turns a PROXY result into http://host:port for both schemes", () => {
    const url = "http://127.0.0.1:7890";
    expect(proxyEnvFromPac("PROXY 127.0.0.1:7890")).toEqual({ HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url });
    // 第一项算数；后面的 DIRECT 是退路
    expect(proxyEnvFromPac("PROXY proxy.corp:3128; DIRECT").HTTPS_PROXY).toBe("http://proxy.corp:3128");
    expect(proxyEnvFromPac("PROXY a:1;PROXY b:2").HTTPS_PROXY).toBe("http://a:1");
    expect(proxyEnvFromPac("HTTPS secure.corp:443").HTTPS_PROXY).toBe("https://secure.corp:443");
    expect(proxyEnvFromPac("PROXY [::1]:7890").HTTP_PROXY).toBe("http://[::1]:7890");
  });

  it("turns a SOCKS result into ALL_PROXY", () => {
    expect(proxyEnvFromPac("SOCKS5 127.0.0.1:7891")).toEqual({ ALL_PROXY: "socks5://127.0.0.1:7891", all_proxy: "socks5://127.0.0.1:7891" });
    // Chromium 的 SOCKS（不带 5）是 SOCKS4
    expect(proxyEnvFromPac("SOCKS 127.0.0.1:1080").ALL_PROXY).toBe("socks4://127.0.0.1:1080");
  });

  it("DIRECT (or nothing usable) sets nothing", () => {
    for (const pac of ["DIRECT", "", undefined, "DIRECT; PROXY a:1", "PROXY", "PROXY not a host", "QUIC q:443"]) expect(proxyEnvFromPac(pac)).toEqual({});
  });

  it("asks for each probe URL until one is proxied; errors and timeouts mean no proxy", async () => {
    const asked: string[] = [];
    const env = await systemProxyEnv(async (u) => (asked.push(u), u.includes("github") ? "PROXY 127.0.0.1:7890" : "DIRECT"));
    expect(asked).toEqual(PROXY_PROBE_URLS);
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(await systemProxyEnv(async () => "DIRECT")).toEqual({});
    expect(await systemProxyEnv(async () => undefined)).toEqual({});
    expect(await systemProxyEnv(async () => Promise.reject(new Error("boom")))).toEqual({});
    expect(await systemProxyEnv(() => new Promise(() => {}), 20)).toEqual({});
  });
});

describe("AgentHost env(): proxy for the agent child", () => {
  const NAMES = [...PROXY_ENV, ...CERT_ENV, "AMB_MAGPIE_API_KEY", "OPENAI_API_KEY", "FEISHU_APP_SECRET"];
  let saved: Record<string, string | undefined>;
  let dataDir: string;
  beforeEach(() => {
    saved = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
    for (const k of NAMES) delete process.env[k];
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-proxy-"));
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const host = (systemProxy?: (url: string) => Promise<string | undefined>) => {
    const h = new AgentHost({ botId: "b", dataDir, runtimeDir: "/rt", bridge: { url: "http://127.0.0.1:1", token: "bridge-tok" } as any, store: new Store(":memory:"), systemProxy });
    fs.mkdirSync(h.home, { recursive: true });
    return h as any;
  };

  it("passes the environment's proxy and certificates, merges loopback, and leaks no model key", async () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    process.env.no_proxy = "corp.example";
    process.env.REQUESTS_CA_BUNDLE = "/etc/ssl/corp.pem";
    process.env.AMB_MAGPIE_API_KEY = "sk-real-model-key";
    process.env.OPENAI_API_KEY = "sk-other";
    process.env.FEISHU_APP_SECRET = "feishu-secret";
    let asked = 0;
    const h = host(async () => (asked++, "PROXY 10.9.9.9:8080"));
    // 环境里有代理：不问系统
    const env = h.env(await h.systemProxy());
    expect(asked).toBe(0);
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(env).not.toHaveProperty("HTTP_PROXY");
    expect(env.no_proxy).toBe(`corp.example,${LOOP}`);
    expect(env.NO_PROXY).toBe(`corp.example,${LOOP}`);
    expect(env.REQUESTS_CA_BUNDLE).toBe("/etc/ssl/corp.pem");
    // 宿主的 bridge 在回环上：不走代理
    expect(new URL(env.AMB_BRIDGE_URL).hostname).toBe("127.0.0.1");
    expect(env).not.toHaveProperty("NODE_USE_ENV_PROXY");
    const values = Object.values(env).join("\n");
    for (const secret of ["sk-real-model-key", "sk-other", "feishu-secret"]) expect(values).not.toContain(secret);
    expect(Object.keys(env).filter((k) => /KEY|SECRET/.test(k))).toEqual(["AMB_MAGPIE_KEY"]); // 这是 bridge 的令牌，不是模型密钥
    expect(env.AMB_MAGPIE_KEY).toBe("bridge-tok");
  });

  it("asks the desktop for the system proxy at every (re)start when the environment has none", async () => {
    let pac = "DIRECT";
    const h = host(async () => pac);
    expect(h.env(await h.systemProxy())).not.toHaveProperty("HTTPS_PROXY");
    // 用户后来开了代理：下次拉起就用上
    pac = "PROXY 127.0.0.1:7890";
    const env = h.env(await h.systemProxy());
    expect(env).toMatchObject({ HTTP_PROXY: "http://127.0.0.1:7890", HTTPS_PROXY: "http://127.0.0.1:7890", http_proxy: "http://127.0.0.1:7890", https_proxy: "http://127.0.0.1:7890", NO_PROXY: LOOP, no_proxy: LOOP });
  });

  it("command line and Docker: no desktop hook, nothing is invented", async () => {
    const h = host();
    expect(await h.systemProxy()).toEqual({});
    const env = h.env(await h.systemProxy());
    expect(hasEnvProxy(env)).toBe(false);
    expect(env).not.toHaveProperty("NO_PROXY");
  });
});
