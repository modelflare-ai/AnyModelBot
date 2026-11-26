import { describe, expect, it, vi } from "vitest";
import { explainLocalProxyError, localProxyFailureHint } from "../src/network-error.js";
import { withLang } from "../src/i18n/index.js";
import { ActivityLog } from "../src/agent/activity.js";
import { turnFailedText } from "../src/core/runtime.js";
import { probeChat, testModel } from "../src/diagnostics.js";
import { registerSecret } from "../src/log.js";

const windowsError = 'Modelflare: Post "https://modelflare.dev/v1/responses": proxyconnect tcp: dial tcp 127.0.0.1:7897: connectex: No connection could be made because the target machine actively refused it.';
const agentError = `magpie-responses API error (502): ${JSON.stringify({ code: null, message: windowsError, param: null, type: "api_error" })}`;

describe("local network proxy failures", () => {
  it("recognizes the reported nested Windows error before it is truncated", () => withLang("zh-CN", () => {
    const message = turnFailedText(new Error(agentError), []);
    expect(message).toContain("本机网络代理 127.0.0.1:7897 拒绝连接");
    expect(message).toContain("彻底退出并重开 AnyModelBot");
    expect(message).not.toContain("API error");
    expect(message).not.toContain("换域名");
  }));

  it.each(["127.0.0.1:7897", "127.0.0.2:8080", "localhost:3128", "[::1]:1080", "[0:0:0:0:0:0:0:1]:8080"])("recognizes loopback proxy %s on Unix", (address) => {
    expect(localProxyFailureHint(`proxyconnect tcp: dial tcp ${address}: connect: connection refused`)).toContain(address);
  });

  it.each([
    "API error (502): upstream unavailable",
    "dial tcp 127.0.0.1:7897: connect: connection refused",
    "connect ECONNREFUSED 127.0.0.1:7897",
    "proxyconnect tcp: dial tcp 10.0.0.1:7897: connect: connection refused",
    "proxyconnect tcp: dial tcp [2001:db8::1]:7897: connect: connection refused",
    "proxyconnect tcp: dial tcp 127.999.0.1:7897: connect: connection refused",
    "proxyconnect tcp: dial tcp 127.0.0.1:99999: connect: connection refused",
    "proxyconnect tcp: dial tcp 127.0.0.1:0: connect: connection refused",
    "proxyconnect tcp: dial tcp 127.0.0.1:7897: i/o timeout",
    "proxyconnect tcp: Proxy Authentication Required",
  ])("does not misdiagnose a different failure: %s", (message) => {
    expect(localProxyFailureHint(message)).toBeUndefined();
    expect(explainLocalProxyError(message)).toBe(message);
  });

  it.each(["zh-CN", "zh-TW", "en", "ja", "ko", "ru", "es", "pt", "tr"] as const)("localizes the advice in %s", (lang) => withLang(lang, () => {
    const hint = localProxyFailureHint(agentError)!;
    expect(hint).toContain("127.0.0.1:7897");
    expect(hint).toContain("AnyModelBot");
    expect(hint).not.toMatch(/runtime\.|\{address\}/);
  }));

  it("keeps raw details available without repeating the advice", () => {
    const detailed = explainLocalProxyError(agentError);
    expect(detailed).toContain(agentError);
    expect(explainLocalProxyError(detailed)).toBe(detailed);
  });

  it("shows useful advice in retry and failure steps while retaining sanitized details", () => withLang("zh-CN", () => {
    const secret = "network-test-private-credential";
    registerSecret(secret);
    const message = `${agentError} credential=${secret}`;
    const log = new ActivityLog();
    log.apply("llm/retry", { retry: 1, maxRetries: 3, delayMs: 1000, failure: { message } });
    log.apply("turn/end", { turn: 1, reason: { kind: "error", error: { message } } });
    for (const step of log.steps) {
      expect(step.summary).toContain("本机网络代理 127.0.0.1:7897");
      expect(step.output).toContain("proxyconnect tcp");
      expect(step.output).not.toContain(secret);
    }
  }));

  it("keeps HTTP 502 and the original error in diagnostics with no extra requests", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: { message: windowsError } }), { status: 502 }));
    const result = await probeChat("gateway", "http://127.0.0.1:4444/v1", "", "test", { fetchImpl: request });
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.error).toContain(localProxyFailureHint(windowsError));
    expect(result.error).toContain(windowsError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("explains the proxy when the gateway fails but the separate direct test succeeds", async () => {
    const app = {
      store: { listBots: () => [{ id: "b" }] },
      routeModel: (_id: string, model: string) => model,
      magpie: { state: "running", baseUrl: "http://127.0.0.1:4444/v1", gatewayKey: "", upstreamEndpoint: () => ({ baseUrl: "https://modelflare.dev/v1", apiKey: "" }) },
      requestHeaders: () => ({}), lastDiagnostics: {},
    } as any;
    const result = await testModel(app, { model: "test", fetchImpl: async (url) => String(url).startsWith("http://127.")
      ? new Response(JSON.stringify({ error: { message: windowsError } }), { status: 502 })
      : Response.json({ choices: [{ message: { content: "pong" } }] }) });
    expect(result.direct.ok).toBe(true);
    expect(result.gateway.ok).toBe(false);
    expect(result.verdict).toBe(localProxyFailureHint(windowsError));
  });
});
