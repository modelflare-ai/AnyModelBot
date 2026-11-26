import { describe, expect, it, vi } from "vitest";
import { AccountStore, ConnectionError, LocalizedConnectionError, connectionUserMessage } from "../src/tools/accounts/index.js";
import { FeishuAccounts } from "../src/tools/accounts/feishu.js";
import { NotionService } from "../src/tools/accounts/notion.js";
import { requestLang, tl, withLang } from "../src/i18n/index.js";

// No database or network: authorization state uses a plain in-memory map and fake responses.
function memoryStore() {
  const data = new Map<string, string>();
  const kv = { getKV: (key: string) => data.get(key), setKV: (key: string, value: string) => void data.set(key, value) };
  return { kv, accounts: new AccountStore(kv) };
}

function replies(...items: (Response | Error)[]): typeof fetch {
  return vi.fn(async () => {
    const item = items.shift();
    if (!item) throw new Error("Unexpected request in authorization test");
    if (item instanceof Error) throw item;
    return item;
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const meta = () => json({
  authorization_endpoint: "https://mcp.notion.com/authorize",
  token_endpoint: "https://mcp.notion.com/token",
  registration_endpoint: "https://mcp.notion.com/register",
});

async function failedFlow(feishu: FeishuAccounts, id: string): Promise<void> {
  await vi.waitFor(() => expect(feishu.flow(id)?.state).toBe("failed"));
}

describe("connection authorization error localization", () => {
  it("keeps model-only diagnostics unchanged and renders authorization errors lazily", () => {
    const modelError = new ConnectionError("Use notion_read_page for pages.", 400);
    expect(withLang("ja", () => modelError.userMessage())).toBe(modelError.message);
    const error = withLang("ja", () => new LocalizedConnectionError("connections.notionLinkExpired", undefined, 400));
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("This sign-in link has expired. Start again from Settings.");
    for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "ru", "es", "pt", "tr"] as const) {
      expect(withLang(locale, () => connectionUserMessage(error))).toBe(tl(locale, "connections.notionLinkExpired"));
    }
    expect(withLang("ko", () => error.userMessage())).toContain("로그인 링크");
    expect(withLang("ru", () => error.userMessage())).toContain("Срок действия");
  });

  it("rerenders a stored Feishu denial in the polling request's language", async () => {
    const send = replies(
      json({ device_code: "device", user_code: "pair", interval: 1, expires_in: 60 }),
      json({ error: "access_denied" }),
    );
    const feishu = new FeishuAccounts({ ...memoryStore(), fetch: () => send });
    const initialRequest = requestLang("ja");
    const flow = initialRequest.run(() => feishu.startFlow());
    initialRequest.end();
    await failedFlow(feishu, flow.id);
    for (const locale of ["en", "ja", "ko", "ru", "es", "pt", "tr"] as const) {
      const poll = requestLang(locale);
      expect(poll.run(() => feishu.flow(flow.id)?.error)).toBe(tl(locale, "connections.feishuDeclined"));
      poll.end();
    }
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("localizes a rejected Feishu app without returning upstream details", async () => {
    const send = replies(json({ error: "invalid_client", error_description: "private upstream details" }, 400));
    const feishu = new FeishuAccounts({ ...memoryStore(), fetch: () => send });
    const flow = feishu.startFlow({ appId: "app", appSecret: "secret" });
    await failedFlow(feishu, flow.id);
    expect(withLang("ko", () => feishu.flow(flow.id)?.error)).toBe(tl("ko", "connections.feishuAppRefused"));
    expect(feishu.flow(flow.id)?.error).not.toContain("private upstream details");
  });

  it("uses localized fallbacks for unexpected connection and Feishu failures", async () => {
    const failure = new TypeError("fetch failed: private upstream details");
    expect(withLang("ja", () => connectionUserMessage(failure))).toBe(tl("ja", "connections.failed"));
    const send = replies(failure);
    const feishu = new FeishuAccounts({ ...memoryStore(), fetch: () => send });
    const flow = feishu.startFlow();
    await failedFlow(feishu, flow.id);
    expect(withLang("ru", () => feishu.flow(flow.id)?.error)).toBe(tl("ru", "connections.feishuAuthIncomplete"));
    expect(feishu.flow(flow.id)?.error).not.toContain("private upstream details");
  });

  it("retains localized Notion errors through metadata discovery and the callback", async () => {
    const failedMeta = new NotionService({ ...memoryStore(), fetch: () => replies(json({}, 503)) });
    await expect(failedMeta.startAuthorization("http://127.0.0.1/callback")).rejects.toMatchObject({ key: "connections.notionUnavailable" });

    const send = replies(meta(), json({ client_id: "client" }));
    const notion = new NotionService({ ...memoryStore(), fetch: () => send });
    const url = new URL(await notion.startAuthorization("http://127.0.0.1/callback"));
    const state = url.searchParams.get("state");
    const failure = await notion.finishAuthorization({ state, error: "access_denied" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LocalizedConnectionError);
    expect(withLang("ja", () => connectionUserMessage(failure))).toBe("認証をキャンセルしました。");
    // The callback state is consumed even when authorization is declined.
    await expect(notion.finishAuthorization({ state, code: "unused" })).rejects.toMatchObject({ key: "connections.notionLinkExpired" });
  });

  it("localizes a failed Notion token exchange without exposing its response", async () => {
    const send = replies(meta(), json({ client_id: "client" }), json({ error: "invalid_grant", error_description: "private upstream details" }, 400));
    const notion = new NotionService({ ...memoryStore(), fetch: () => send });
    const url = new URL(await notion.startAuthorization("http://127.0.0.1/callback"));
    const failure = await notion.finishAuthorization({ state: url.searchParams.get("state"), code: "code" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LocalizedConnectionError);
    expect(withLang("ko", () => connectionUserMessage(failure))).toBe(tl("ko", "connections.notionExchangeFailed"));
    expect(connectionUserMessage(failure)).not.toContain("private upstream details");
  });
});
