/**
 * 代理接口的回退：某个模型在 Responses / Anthropic Messages 上被上游拒绝（请求形状不被接受）后，
 * 记下"这个模型 → Chat Completions"，一段时间内（默认 24 小时）代理对它直接走 Chat。
 * 按去掉内置网关前缀的模型 id 记（所有机器人共用），存在数据目录里，重启后仍然有效。
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../log.js";
import { bareModel } from "../modelflare.js";

const log = logger("agent.api");

export const API_FALLBACK_TTL_MS = 24 * 3600_000;

export interface ApiFallback {
  /** 被拒的接口 */
  from: string;
  /** 一行原因（状态码与上游的说法，已脱敏） */
  reason: string;
  at: number;
  until: number;
}

/** 这些状态码说明是请求本身不被这个接口接受（参数、路径、格式），不是限流、余额、权限或上游故障 */
const SHAPE_STATUSES = new Set([400, 404, 405, 415, 422]);
/** 没有状态码时（流里才报错）：错误说的是参数 / 接口不支持 */
const SHAPE_TEXT =
  /\b(unsupported|unknown|unrecognized|unexpected|invalid)[ _-](parameter|param|field|argument|endpoint|api|protocol|path|route)s?\b|\b(not|isn't|is not) supported\b|\bdoes not support\b|\bunsupported_(parameter|value|api|endpoint)\b|\bunknown_parameter\b|\bno route\b|\bnot found\b.*\b(endpoint|path|route)\b/i;
/** 状态码像，但其实是别的问题（上下文太长、内容审核、额度、限流）：换接口也没用，不回退 */
const NOT_SHAPE_TEXT =
  /context[ _-]?(length|window)|too long|too many tokens|maximum context|token limit|content[ _-]?(policy|filter|management)|safety|flagged|rate[ _-]?limit|quota|insufficient|balance|credit|budget|billing/i;
/** 没有状态码时，错误里带着这些状态码就不算 */
const NOT_SHAPE_STATUS = /\b(401|402|403|408|409|429|5\d\d)\b/;

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

/** 上游错误体里的那句话（OpenAI、Anthropic 都是 error.message） */
function upstreamMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message ?? j?.message ?? j?.detail;
    if (typeof m === "string" && m.trim()) return m;
  } catch {
    /* 不是 JSON */
  }
  return body;
}

/**
 * 这个回合失败是不是因为接口不接受我们的请求：返回一行原因，不是则 undefined。
 * rejections 是 bridge 在这一轮看到的、本机器人发往 Responses / Messages 的上游错误（状态码 + 错误体）；
 * turnError 是代理报的错误（流里才出错时只有它）。
 */
export function shapeRejection(rejections: Array<{ status: number; error: string }>, turnError: string): string | undefined {
  for (const r of [...rejections].reverse()) {
    if (!SHAPE_STATUSES.has(r.status)) continue;
    const msg = upstreamMessage(r.error);
    if (NOT_SHAPE_TEXT.test(msg)) continue;
    return clip(`HTTP ${r.status}${msg ? `: ${msg}` : ""}`, 200);
  }
  if (SHAPE_TEXT.test(turnError) && !NOT_SHAPE_TEXT.test(turnError) && !NOT_SHAPE_STATUS.test(turnError)) return clip(turnError, 200);
  return undefined;
}

/** 模型 → 回退记录。file 不给时只在内存里（测试、没有数据目录时） */
export class ApiFallbacks {
  private m = new Map<string, ApiFallback>();

  constructor(
    private file?: string,
    private ttlMs = API_FALLBACK_TTL_MS,
  ) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [k, v] of Object.entries(j?.models ?? {})) {
        const e = v as ApiFallback;
        if (Number(e?.until) > Date.now()) this.m.set(k, { from: String(e.from ?? ""), reason: String(e.reason ?? ""), at: Number(e.at) || 0, until: Number(e.until) });
      }
    } catch {
      /* 没有或坏了：从空开始 */
    }
  }

  private key(model: string): string {
    return bareModel(model.trim());
  }

  get(model: string): ApiFallback | undefined {
    const k = this.key(model);
    const e = this.m.get(k);
    if (e && e.until <= Date.now()) {
      this.m.delete(k);
      this.save();
      return undefined;
    }
    return e;
  }

  set(model: string, from: string, reason: string): ApiFallback {
    const at = Date.now();
    const e = { from, reason, at, until: at + this.ttlMs };
    this.m.set(this.key(model), e);
    this.save();
    return e;
  }

  list(): Array<ApiFallback & { model: string }> {
    const now = Date.now();
    return [...this.m].filter(([, e]) => e.until > now).map(([model, e]) => ({ model, ...e }));
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ models: Object.fromEntries(this.m) }, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      log.warn("saving agent API fallbacks failed", { message: (e as Error).message });
    }
  }
}
