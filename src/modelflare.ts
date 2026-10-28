/**
 * Modelflare：本程序唯一的模型来源。
 * - 两条线路（文档《Which endpoint to call》）：国际 modelflare.dev、中国大陆优化 origin.modelflare.dev；
 *   飞行中的 POST 不跨主机重定向，所以线路由用户事先选定，不自动切换。
 * - 连接前用 GET {base}/models + Bearer 校验密钥；错误按状态码给出可操作的说明。
 */
export type ModelflareLine = "auto" | "global" | "cn";

export const MODELFLARE_LINES: Record<Exclude<ModelflareLine, "auto">, string> = {
  global: "https://modelflare.dev/v1",
  cn: "https://origin.modelflare.dev/v1",
};

export const MODELFLARE_PROVIDER = "modelflare";

export function normalizeLine(v: unknown): ModelflareLine {
  return v === "global" || v === "cn" ? v : "auto";
}

/** 线路 → 基址。AMB_MODELFLARE_BASE_URL 仅供开发/测试（指向本地 mock），不经界面设置。 */
export function modelflareBaseUrl(line: ModelflareLine, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AMB_MODELFLARE_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return line === "cn" ? MODELFLARE_LINES.cn : MODELFLARE_LINES.global;
}

export type VerifyFailure = "invalid_key" | "forbidden" | "rate_limited" | "upstream" | "network" | "bad_response";

export type VerifyResult =
  | { ok: true; models: string[] }
  | { ok: false; code: VerifyFailure; status?: number; message: string; suggestLine?: ModelflareLine };

/** 校验密钥：只发一次 GET /models，不重试、不换线路。 */
export async function verifyModelflareKey(
  baseUrl: string,
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; line?: ModelflareLine } = {},
): Promise<VerifyResult> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (e) {
    const host = safeHost(baseUrl);
    return {
      ok: false,
      code: "network",
      message: `连不上 ${host}（${(e as Error).name === "TimeoutError" ? "超时" : (e as Error).message}）`,
      ...(opts.line !== "cn" ? { suggestLine: "cn" as const } : {}),
    };
  }
  if (res.status === 401) return { ok: false, code: "invalid_key", status: 401, message: "Key 无效或已被撤销" };
  if (res.status === 403) return { ok: false, code: "forbidden", status: 403, message: "这个 Key 没有权限调用该模型或分组" };
  if (res.status === 429) return { ok: false, code: "rate_limited", status: 429, message: `Modelflare 暂时不可用（HTTP 429）${retryAfter(res)}` };
  if (!res.ok) return { ok: false, code: "upstream", status: res.status, message: `Modelflare 暂时不可用（HTTP ${res.status}）` };
  try {
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(body.data)) throw new Error("no data[]");
    return { ok: true, models: body.data.map((m) => String(m.id ?? "")).filter(Boolean).sort() };
  } catch {
    return { ok: false, code: "bad_response", status: res.status, message: "Modelflare 返回了无法识别的模型列表" };
  }
}

function retryAfter(res: Response): string {
  const s = res.headers.get("retry-after");
  return s ? `，${s} 秒后重试` : "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 只用于展示的密钥尾号 */
export function keyTail(key: string): string {
  return key.length > 4 ? key.slice(-4) : "";
}
