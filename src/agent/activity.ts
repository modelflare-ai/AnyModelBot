/**
 * 代理回合的活动记录：把 DSH 的会话事件折叠成看得懂的几类步骤（模型请求、工具调用、重试、子代理、压缩、出错）。
 * 网页对话里折叠在"用时"下面，微信/飞书会话在信息面板里看；/status 和看门狗用它说明卡在哪一步。
 */
import { summarizeCall } from "./host.js";

export interface ActivityStep {
  /** 同一步的更新沿用同一个 id（工具调用 id、m<回合>.<步>…） */
  id: string;
  kind: "model" | "tool" | "retry" | "subagent" | "compact" | "error";
  /** 模型名、工具名… */
  title: string;
  /** 一行摘要：命令、路径、回复开头、失败原因 */
  summary?: string;
  /** 展开后看到的参数 / 输出（已截断） */
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  /** 没做完就被打断（回合出错、/stop、看门狗、超时）：说明时仍按"正在做"来说 */
  cut?: boolean;
  at: number;
  ms?: number;
  tokens?: { input?: number; output?: number };
}

const MAX_STEPS = 120;
const MAX_INPUT = 1000;
const MAX_OUTPUT = 2000;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string, n = 140) => clip(s.replace(/\s+/g, " ").trim(), n);

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((b: any) => (b?.type === "text" ? String(b.text ?? "") : b?.type === "image" ? "[图片]" : ""))
    .filter(Boolean)
    .join("\n");
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args || "{}"), null, 2);
  } catch {
    return args;
  }
}

export class ActivityLog {
  readonly steps: ActivityStep[] = [];

  /** model：这一轮用的模型（DSH 只在会话第一次请求时报 request/context，之后的回合靠它起名） */
  constructor(
    private onChange?: (step: ActivityStep) => void,
    private model = "",
  ) {}

  get last(): ActivityStep | undefined {
    return this.steps.at(-1);
  }

  /**
   * 喂一条 DSH 会话事件（子代理通知用 subagent/started、subagent/finished）。
   * 返回这条事件算不算"有进展"：模型在重试不算，看门狗靠它判断回合是不是卡住了。
   */
  apply(type: string, data: any, time = Date.now()): boolean {
    data ??= {};
    switch (type) {
      case "request/context": {
        // step/start 在它之前：第一步建出来时还不知道模型名
        if (!data.model) return true;
        this.model = String(data.model);
        const cur = this.steps.findLast((s) => s.kind === "model" && s.status === "running");
        if (cur && cur.title !== this.model) this.put({ ...cur, title: this.model });
        return true;
      }
      case "step/start":
        this.put({ id: `m${data.turn}.${data.step}`, kind: "model", title: this.model || "模型", status: "running", at: time });
        return true;
      case "assistant/message": {
        const msg = data.message ?? {};
        const content: any[] = Array.isArray(msg.content) ? msg.content : [];
        const calls = content.filter((b) => b?.type === "tool-call").map((b) => String(b.name));
        const text = content.filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
        const thinking = content.filter((b) => b?.type === "reasoning" || b?.type === "thinking").map((b) => String(b.text ?? b.reasoning ?? "")).join("\n").trim();
        const model = String(msg.source?.model ?? "") || this.model;
        if (model) this.model = model;
        const id = `m${data.turn}.${data.step}`;
        const prev = this.find(id);
        const at = prev?.at ?? time;
        const u = data.usage ?? {};
        this.put({
          id,
          kind: "model",
          title: model || "模型",
          summary: text ? oneLine(text) : calls.length ? `调用 ${calls.join("、")}` : thinking ? "（只有思考，没有文字）" : "（空回复）",
          output: clip([thinking && `[思考]\n${thinking}`, text].filter(Boolean).join("\n\n"), MAX_OUTPUT) || undefined,
          status: "ok",
          at,
          ms: Math.max(0, time - at),
          tokens: u.inputTokens || u.outputTokens ? { input: Number(u.inputTokens) || 0, output: Number(u.outputTokens) || 0 } : undefined,
        });
        return true;
      }
      case "tool/call": {
        const name = String(data.name ?? "tool");
        const args = String(data.arguments ?? "");
        const sum = summarizeCall(name, args);
        this.put({
          id: String(data.callId),
          kind: "tool",
          title: name,
          summary: sum === name ? undefined : sum.slice(name.length + 2),
          input: clip(prettyArgs(args), MAX_INPUT),
          status: "running",
          at: time,
        });
        return true;
      }
      case "tool/result": {
        const msg = data.message ?? {};
        const prev = this.find(String(msg.toolCallId ?? ""));
        if (!prev) return true;
        this.put({ ...prev, status: msg.isError ? "error" : "ok", ms: Math.max(0, time - prev.at), output: clip(textOf(msg.content), MAX_OUTPUT) || undefined });
        return true;
      }
      case "llm/retry": {
        const f = data.failure ?? {};
        const why = String(f.message ?? f.code ?? "请求失败");
        const of = data.maxRetries ? `${data.retry}/${data.maxRetries}` : String(data.retry ?? "");
        this.put({
          id: `r${data.retryId ?? data.turn}.${data.retry}`,
          kind: "retry",
          title: "模型请求失败，重试",
          summary: oneLine(`第 ${of} 次，${Math.round((Number(data.delayMs) || 0) / 1000)} 秒后：${why}`),
          status: "error",
          at: time,
        });
        return false;
      }
      case "llm/retry-started":
        return false;
      case "compaction/start":
        this.put({ id: `c${time}`, kind: "compact", title: "压缩上下文", status: "running", at: time });
        return true;
      case "compaction/end": {
        const prev = this.steps.findLast((s) => s.kind === "compact" && s.status === "running");
        if (prev) this.put({ ...prev, status: "ok", ms: Math.max(0, time - prev.at) });
        return true;
      }
      case "subagent/started":
        this.put({ id: `s${data.childSessionId}`, kind: "subagent", title: "子代理", status: "running", at: time });
        return true;
      case "subagent/finished": {
        const prev = this.find(`s${data.childSessionId}`);
        const last = textOf(data.lastAssistantMessage);
        this.put({
          id: `s${data.childSessionId}`,
          kind: "subagent",
          title: "子代理",
          summary: last ? oneLine(last) : String(data.stopReason ?? "") || undefined,
          output: last ? clip(last, MAX_OUTPUT) : undefined,
          status: data.status === "ok" ? "ok" : "error",
          at: prev?.at ?? time,
          ms: prev ? Math.max(0, time - prev.at) : undefined,
        });
        return true;
      }
      case "turn/end": {
        const r = data.reason ?? {};
        if (r.kind === "error") {
          // 还挂着的步骤（模型请求、工具）跟着这个错误结束
          for (const s of this.steps) if (s.status === "running") this.put({ ...s, status: "error", cut: true, ms: Math.max(0, time - s.at) });
          this.put({ id: `e${data.turn}`, kind: "error", title: "回合出错", summary: oneLine(String(r.error?.message ?? "unknown error"), 300), status: "error", at: time });
        }
        return true;
      }
      default:
        return true;
    }
  }

  /** 外部原因结束（/stop、看门狗、超时）：还在进行的步骤标成失败，再记一条说明 */
  end(why: string, time = Date.now()): void {
    for (const s of this.steps) if (s.status === "running") this.put({ ...s, status: "error", cut: true, ms: Math.max(0, time - s.at) });
    this.put({ id: `x${time}`, kind: "error", title: "已中止", summary: why, status: "error", at: time });
  }

  private find(id: string): ActivityStep | undefined {
    return this.steps.find((s) => s.id === id);
  }

  private put(step: ActivityStep): void {
    for (const k of Object.keys(step) as Array<keyof ActivityStep>) if (step[k] === undefined) delete step[k];
    const i = this.steps.findIndex((s) => s.id === step.id);
    if (i >= 0) this.steps[i] = step;
    else {
      this.steps.push(step);
      if (this.steps.length > MAX_STEPS) this.steps.shift();
    }
    this.onChange?.({ ...step });
  }
}

/** 一步的口语说明（/status、排队提示、中止消息里用） */
export function describeStep(s: ActivityStep): string {
  const what = s.summary ? `${s.title}：${s.summary}` : s.title;
  const doing = s.status === "running" || !!s.cut;
  switch (s.kind) {
    case "model":
      return doing ? `等待 ${s.title} 回复` : `${s.title} 回复了${s.summary ? `：${s.summary}` : ""}`;
    case "tool":
      return doing ? `正在运行 ${what}` : `${what}（${s.status === "error" ? "失败" : "完成"}）`;
    case "retry":
      return `模型请求失败，正在重试（${s.summary ?? ""}）`;
    case "subagent":
      return doing ? "子代理在工作" : `子代理结束${s.summary ? `：${s.summary}` : ""}`;
    case "compact":
      return doing ? "正在压缩上下文" : "压缩了上下文";
    case "error":
      return what;
  }
}

/** "12 秒" / "3 分 5 秒" */
export function fmtSecs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分${s % 60 ? ` ${s % 60} 秒` : "钟"}`;
}
