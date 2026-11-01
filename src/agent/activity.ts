/**
 * 代理回合的活动记录：把 DSH 的会话事件折叠成看得懂的几类步骤（模型请求、工具调用、重试、子代理、压缩、出错）。
 * 网页对话里折叠在"用时"下面，微信/飞书会话在信息面板里看；/status 和看门狗用它说明卡在哪一步。
 */
import { summarizeCall } from "./host.js";
import { t as tr } from "../i18n/index.js";

export interface ActivityStep {
  /** 同一步的更新沿用同一个 id（工具调用 id、m<回合>.<步>…） */
  id: string;
  kind: "model" | "tool" | "retry" | "subagent" | "compact" | "error" | "job" | "steer";
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
    .map((b: any) => (b?.type === "text" ? String(b.text ?? "") : b?.type === "image" ? tr("activity.image") : ""))
    .filter(Boolean)
    .join("\n");
}

/** 工具结果说命令转到了后台（前台等太久，DSH 把它改成后台任务）：返回任务 id */
export function promotedJob(data: any): string | undefined {
  const text = textOf(data?.message?.content);
  return /\[still running after \d+ms; moved to background job (\S+?)\]/.exec(text)?.[1];
}

/** 后台任务结束的通知（tool-jobs 在会话里插的用户消息）：任务 id 与摘要 */
function jobNotice(data: any): { id: string; summary: string } | undefined {
  if (data?.source?.kind !== "tool-jobs") return undefined;
  const id = /^background job (\S+)/.exec(textOf(data.content))?.[1];
  return id ? { id, summary: String(data.source.summary ?? "") } : undefined;
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

  /**
   * model：这一轮用的模型（DSH 只在会话第一次请求时报 request/context，之后的回合靠它起名）。
   * chat：聊天回合——模型说的话（回复和回合中间说的话）进了对话，模型那一步不再重复这些文字，只留调用了什么和思考
   */
  constructor(
    private onChange?: (step: ActivityStep) => void,
    private model = "",
    private opts: { chat?: boolean } = {},
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
        this.put({ id: `m${data.turn}.${data.step}`, kind: "model", title: this.model || tr("activity.model"), status: "running", at: time });
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
        // 聊天里已经显示了这段话（被打断的那一步除外，它的话不进对话）
        const said = this.opts.chat && !data.interrupted ? text : "";
        const callLine = calls.length ? tr("activity.calls", { list: calls.join(tr("activity.listSep")) }) : "";
        this.put({
          id,
          kind: "model",
          title: model || tr("activity.model"),
          summary: said ? callLine || undefined : text ? oneLine(text) : callLine || (thinking ? tr("activity.thinkingOnly") : tr("activity.emptyReply")),
          output: clip([thinking && `${tr("activity.thinkingTag")}\n${thinking}`, said ? "" : text].filter(Boolean).join("\n\n"), MAX_OUTPUT) || undefined,
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
        // 命令跑得太久，转到了后台：单独记一步，结束时（job/settled 或结束通知）更新
        const job = promotedJob(data);
        if (job) this.put({ id: `j:${job}`, kind: "job", title: tr("activity.job"), summary: prev.summary, input: prev.input, status: "running", at: time });
        return true;
      }
      case "job/settled": {
        const prev = this.find(`j:${data.jobId}`);
        if (!prev || prev.status !== "running") return true;
        const ok = data.status === "completed" && !/exit code: [1-9]/.test(String(data.detail ?? ""));
        this.put({ ...prev, status: ok ? "ok" : "error", ms: Math.max(0, (Number(data.finishedAt) || time) - prev.at), output: data.detail ? String(data.detail) : prev.output });
        return true;
      }
      case "user/message": {
        // 后台命令结束，DSH 把结果交给代理（回合进行中并进下一步，空闲时唤醒代理开一轮）
        const n = jobNotice(data);
        if (!n) return true;
        const prev = this.find(`j:${n.id}`);
        if (prev?.status === "running") this.put({ ...prev, status: "ok", ms: Math.max(0, time - prev.at) });
        else if (!prev) this.put({ id: `j:${n.id}`, kind: "job", title: tr("activity.jobDone"), summary: oneLine(n.summary) || undefined, status: "ok", at: time });
        return true;
      }
      case "steer":
        // 宿主发的：用户在回合进行中又发了一条，并进了这一轮
        this.put({ id: `u${time}`, kind: "steer", title: tr("activity.steer"), summary: oneLine(String(data.text ?? "")), status: "ok", at: time });
        return true;
      case "llm/retry": {
        const f = data.failure ?? {};
        const why = String(f.message ?? f.code ?? tr("activity.requestFailed"));
        const of = data.maxRetries ? `${data.retry}/${data.maxRetries}` : String(data.retry ?? "");
        this.put({
          id: `r${data.retryId ?? data.turn}.${data.retry}`,
          kind: "retry",
          title: tr("activity.retryTitle"),
          summary: oneLine(tr("activity.retrySummary", { n: of, s: Math.round((Number(data.delayMs) || 0) / 1000), why })),
          status: "error",
          at: time,
        });
        return false;
      }
      case "llm/retry-started":
        return false;
      case "api/fallback":
        // 宿主发的：上游不接受这个接口上的请求，换 Chat Completions 重做这一轮
        this.put({ id: `f${time}`, kind: "retry", title: tr("activity.fallbackTitle"), summary: oneLine(tr("activity.fallbackSummary", { from: String(data.from ?? ""), reason: String(data.reason ?? "") })), status: "ok", at: time });
        return true;
      case "compaction/start":
        this.put({ id: `c${time}`, kind: "compact", title: tr("activity.compact"), status: "running", at: time });
        return true;
      case "compaction/end": {
        const prev = this.steps.findLast((s) => s.kind === "compact" && s.status === "running");
        if (prev) this.put({ ...prev, status: "ok", ms: Math.max(0, time - prev.at) });
        return true;
      }
      // bridge 在后台让上游压缩了这个会话的历史（不是 DSH 事件，见 server-compaction.ts）；不算代理有进展
      case "server-compaction": {
        const k = (n: unknown) => `${Math.round((Number(n) || 0) / 1000)}k`;
        this.put({ id: `sc${time}`, kind: "compact", title: tr("activity.serverCompact"), summary: tr("activity.compactSummary", { before: k(data.before), after: k(data.after) }), status: "ok", at: time, ms: Number(data.ms) || undefined });
        return false;
      }
      case "subagent/started":
        this.put({ id: `s${data.childSessionId}`, kind: "subagent", title: tr("activity.subagent"), status: "running", at: time });
        return true;
      case "subagent/finished": {
        const prev = this.find(`s${data.childSessionId}`);
        const last = textOf(data.lastAssistantMessage);
        this.put({
          id: `s${data.childSessionId}`,
          kind: "subagent",
          title: tr("activity.subagent"),
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
          this.put({ id: `e${data.turn}`, kind: "error", title: tr("activity.turnError"), summary: oneLine(String(r.error?.message ?? "unknown error"), 300), status: "error", at: time });
        }
        return true;
      }
      default:
        return true;
    }
  }

  /** 回合正常结束：还在后台跑的命令不算失败，注明回复时它仍在运行（结束后代理会被唤醒，另发一条回复） */
  finish(time = Date.now()): void {
    for (const s of this.steps) if (s.kind === "job" && s.status === "running") this.put({ ...s, status: "ok", summary: [s.summary, tr("activity.stillRunning")].filter(Boolean).join(" "), ms: Math.max(0, time - s.at) });
  }

  /** 外部原因结束（/stop、看门狗、超时）：还在进行的步骤标成失败，再记一条说明 */
  end(why: string, time = Date.now()): void {
    for (const s of this.steps) if (s.status === "running") this.put({ ...s, status: "error", cut: true, ms: Math.max(0, time - s.at) });
    this.put({ id: `x${time}`, kind: "error", title: tr("activity.stopped"), summary: why, status: "error", at: time });
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
      return doing ? tr("activity.descWaiting", { model: s.title }) : tr("activity.descReplied", { model: s.title, summary: s.summary ? tr("activity.withSummary", { text: s.summary }) : "" });
    case "tool":
      return doing ? tr("activity.descRunning", { what }) : tr(s.status === "error" ? "activity.descFailed" : "activity.descDone", { what });
    case "retry":
      return tr("activity.descRetry", { summary: s.summary ?? "" });
    case "subagent":
      return doing ? tr("activity.descSubagent") : tr("activity.descSubagentDone", { summary: s.summary ? tr("activity.withSummary", { text: s.summary }) : "" });
    case "compact":
      return tr(doing ? "activity.descCompacting" : "activity.descCompacted");
    case "job":
      return doing ? tr("activity.descJob", { summary: s.summary ? tr("activity.withSummary", { text: s.summary }) : "" }) : `${s.title}${s.summary ? tr("activity.withSummary", { text: s.summary }) : ""}`;
    case "steer":
      return tr("activity.descSteer", { summary: s.summary ? tr("activity.withSummary", { text: s.summary }) : "" });
    case "error":
      return what;
  }
}

/** "12 秒" / "3 分 5 秒" */
export function fmtSecs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? tr("activity.secs", { s }) : s % 60 ? tr("activity.minSecs", { m: Math.floor(s / 60), s: s % 60 }) : tr("activity.mins", { m: Math.floor(s / 60) });
}
