/**
 * 故障排查（设置 → 故障排查）：状态汇总、"测试模型"（经内置网关 vs 直连端点）、"测试代理"（逐段定位卡在哪一步）、
 * 日志尾部与可复制的诊断报告。所有输出都经过脱敏；任何密钥都不出现在结果里。
 */
import crypto from "node:crypto";
import os from "node:os";
import { appVersion, type App } from "./app.js";
import type { HostEvent } from "./agent/host.js";
import { isModelPath, type ProxyEvent } from "./agent/bridge.js";
import { shapeRejection } from "./agent/api-fallback.js";
import { logFilePath, logger, readLogTail, redactText, redactValue } from "./log.js";
import { bareModel } from "./modelflare.js";
import { pwshProbe, pwshReportLine } from "./agent/pwsh.js";
import { t, type MessageKey, t as tr } from "./i18n/index.js";

const log = logger("diagnostics");

// ---------- 测试模型 ----------
export interface ProbeResult {
  route: "gateway" | "direct";
  /** 请求的端点（不含密钥） */
  url: string;
  ok: boolean;
  /** 没有测（例如外部端点模式下没有内置网关） */
  skipped?: string;
  status?: number;
  ms?: number;
  /** 发出去的模型名 */
  model?: string;
  /** 响应里回显的模型名 */
  echoedModel?: string;
  reply?: string;
  error?: string;
}

export interface ModelTestResult {
  at: number;
  model: string;
  gateway: ProbeResult;
  direct: ProbeResult;
  /** 一句话结论 */
  verdict: string;
}

export const PROBE_PROMPT = "Reply with the single word: pong";

function describeFetchError(e: unknown, timeoutMs: number): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return t("diag.fetch_timeout", { s: Math.round(timeoutMs / 1000) });
  const cause = err?.cause?.code || err?.cause?.message;
  return redactText(cause ? `${err.message}（${cause}）` : String(err?.message ?? err));
}

function errorText(j: any, text: string): string {
  const m = j?.error?.message ?? j?.error ?? j?.message;
  const body = typeof m === "string" && m ? `${m}${j?.error?.code ? `（${j.error.code}）` : ""}` : text;
  return redactText(String(body).slice(0, 2000));
}

/** 发一个最小的非流式对话请求，记录状态码、耗时、回显的模型名；失败时带回错误体。 */
export async function probeChat(
  route: ProbeResult["route"],
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; headers?: Record<string, string> } = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const base = baseUrl.replace(/\/+$/, "");
  const res: ProbeResult = { route, url: redactText(base), ok: false, model };
  if (!base) return { ...res, error: t("diag.no_endpoint") };
  if (!model) return { ...res, error: t("diag.no_model") };
  const t0 = Date.now();
  try {
    const r = await (opts.fetchImpl ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: { ...opts.headers, "content-type": "application/json", accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: "user", content: PROBE_PROMPT }], stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    res.ms = Date.now() - t0;
    res.status = r.status;
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      /* 不是 JSON */
    }
    if (typeof j?.model === "string") res.echoedModel = j.model;
    if (!r.ok) return { ...res, error: errorText(j, text) || `HTTP ${r.status}` };
    const content = j?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ...res, error: t("diag.no_content", { body: redactText(text.slice(0, 500)) }) };
    return { ...res, ok: true, reply: redactText(content.slice(0, 200)) };
  } catch (e) {
    return { ...res, ms: Date.now() - t0, error: describeFetchError(e, timeoutMs) };
  }
}

/** 机器人实际会用的模型：指定 → 机器人默认 → 全局默认 → 列表第一个。 */
export async function pickModel(app: App, botId?: string, explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const bot = botId ? app.store.getBot(botId) : undefined;
  if (bot?.defaultModel) return bot.defaultModel;
  if (app.config.llm.defaultModel) return app.config.llm.defaultModel;
  const list = await app.runtime.listModels(true).catch(() => [] as string[]);
  return list[0] ?? "";
}


function modelVerdict(g: ProbeResult, d: ProbeResult): string {
  if (g.skipped) return d.ok ? t("diag.verdict_endpoint_ok") : t("diag.verdict_endpoint_error", { error: d.status ? `HTTP ${d.status}` : d.error });
  if (g.ok && d.ok) return t("diag.verdict_both_ok");
  if (g.ok && !d.ok) return d.skipped ? t("diag.verdict_gateway_ok") : t("diag.verdict_direct_failed");
  if (!g.ok && d.ok) return t("diag.verdict_gateway_broken");
  if (d.skipped) return t("diag.verdict_gateway_failed_no_direct");
  return t("diag.verdict_both_failed", { error: d.status ? `HTTP ${d.status}` : d.error });
}

export async function testModel(app: App, opts: { botId?: string; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<ModelTestResult> {
  const botId = opts.botId || app.store.listBots()[0]?.id || "default";
  // 和机器人发出的请求一样：限定到它用的 provider（开了预算的机器人用自己的 Key）
  const model = app.routeModel(botId, await pickModel(app, botId, opts.model));
  const mp = app.magpie;
  const probeOpts = { timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl };
  let gateway: Promise<ProbeResult>;
  let direct: Promise<ProbeResult>;
  if (mp) {
    gateway = probeChat("gateway", mp.baseUrl, mp.gatewayKey, model, probeOpts).then((r) =>
      mp.state === "running" || r.ok
        ? r
        : { ...r, error: mp.lastError ? t("diag.gateway_state_error", { error: r.error ?? "", state: mp.state, lastError: redactText(mp.lastError) }) : t("diag.gateway_state", { error: r.error ?? "", state: mp.state }) },
    );
    const up = mp.upstreamEndpoint(model.includes("/") ? model.split("/")[0] : undefined);
    direct = up
      ? probeChat("direct", up.baseUrl, up.apiKey, bareModel(model), { ...probeOpts, headers: app.requestHeaders() })
      : Promise.resolve({ route: "direct", url: "", ok: false, skipped: t("diag.skip_not_connected") });
  } else {
    const base = app.config.magpie.externalBaseUrl;
    gateway = Promise.resolve({ route: "gateway", url: "", ok: false, skipped: t("diag.skip_external") });
    direct = probeChat("direct", base, app.config.magpie.externalApiKey, model, probeOpts);
  }
  const [g, d] = await Promise.all([gateway, direct]);
  const result: ModelTestResult = { at: Date.now(), model, gateway: g, direct: d, verdict: modelVerdict(g, d) };
  app.lastDiagnostics.model = result;
  log.info("test model", { model, gateway: summarizeProbe(g), direct: summarizeProbe(d) });
  return result;
}

function summarizeProbe(p: ProbeResult): string {
  if (p.skipped) return `skipped: ${p.skipped}`;
  return `${p.ok ? "ok" : "fail"} status=${p.status ?? "-"} ms=${p.ms ?? "-"}${p.echoedModel ? ` model=${p.echoedModel}` : ""}${p.error ? ` error=${p.error.slice(0, 200)}` : ""}`;
}

// ---------- 测试代理 ----------
export type StageId = "queue" | "spawn" | "plugins" | "model" | "reply";
export interface AgentStage {
  id: StageId;
  label: string;
  /** warn：不算失败，但值得注意（例如有回合正在处理，同一会话的新消息会排在后面） */
  status: "pending" | "ok" | "warn" | "fail" | "timeout" | "skipped";
  ms?: number;
  detail?: string;
}
export interface AgentTestResult {
  at: number;
  ok: boolean;
  botId: string;
  model: string;
  ms: number;
  /** 卡住或失败的那一步 */
  stuckAt?: StageId;
  stages: AgentStage[];
  reply?: string;
  error?: string;
}

const STAGES: Array<[StageId, MessageKey]> = [
  ["queue", "diag.stage_queue"],
  ["spawn", "diag.stage_spawn"],
  ["plugins", "diag.stage_plugins"],
  ["model", "diag.stage_model"],
  ["reply", "diag.stage_reply"],
];
const STAGE_LABEL = Object.fromEntries(STAGES) as Record<StageId, MessageKey>;

const TIMEOUT_DETAIL: Record<StageId, (s: number) => string> = {
  queue: () => "",
  spawn: (s) => t("diag.timeout_spawn", { s }),
  plugins: (s) => t("diag.timeout_plugins", { s }),
  model: (s) => t("diag.timeout_model", { s }),
  reply: (s) => t("diag.timeout_reply", { s }),
};

/**
 * 让代理进程完整跑一轮最小对话（独立的诊断会话，不进聊天记录），按事件判断每一步：
 * 启动（spawn + initialize）→ 插件（模型请求里有插件注册的工具）→ 模型调用（bridge 看到上游响应）→ 回复（回合结束）。
 */
export async function testAgent(app: App, opts: { botId?: string; model?: string; timeoutMs?: number } = {}): Promise<AgentTestResult> {
  const t0 = Date.now();
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 120_000, 5_000), 600_000);
  const botId = opts.botId || app.store.listBots()[0]?.id || "default";
  const stages: AgentStage[] = STAGES.map(([id, label]) => ({ id, label: t(label), status: "pending" }));
  const result: AgentTestResult = { at: Date.now(), ok: false, botId, model: "", ms: 0, stages };
  const st = (id: StageId) => stages.find((s) => s.id === id)!;
  const begun: Partial<Record<StageId, number>> = {};
  const mark = (id: StageId, status: AgentStage["status"], detail?: string, ms?: number) => {
    const s = st(id);
    if (s.status !== "pending") return;
    s.status = status;
    if (detail) s.detail = redactText(detail).slice(0, 1500);
    s.ms = ms ?? (begun[id] !== undefined ? Date.now() - begun[id]! : undefined);
    // 下一步从这里开始计时
    const next = STAGES[STAGES.findIndex(([x]) => x === id) + 1]?.[0];
    if (next && begun[next] === undefined) begun[next] = Date.now();
  };
  const failedAlready = () => stages.some((s) => s.status === "fail" || s.status === "timeout");
  const finish = (): AgentTestResult => {
    for (const s of stages) if (s.status === "pending") s.status = "skipped";
    result.ok = stages.every((s) => s.status === "ok" || s.status === "warn");
    result.stuckAt = stages.find((s) => s.status === "fail" || s.status === "timeout")?.id;
    result.ms = Date.now() - t0;
    app.lastDiagnostics.agent = result;
    log.info("test agent", { botId, model: result.model, ok: result.ok, stuckAt: result.stuckAt, ms: result.ms, stages: stages.map((s) => `${s.id}:${s.status}${s.ms !== undefined ? `/${s.ms}ms` : ""}`).join(" ") });
    return result;
  };

  if (!app.agent.available) {
    mark("spawn", "fail", app.config.agent.mode === "off" ? t("diag.agent_off") : t("diag.no_runtime"));
    return finish();
  }
  const picked = await pickModel(app, botId, opts.model);
  result.model = picked ? app.routeModel(botId, picked) : "";
  if (!result.model) {
    mark("spawn", "fail", t("diag.agent_no_model"));
    return finish();
  }

  const host = app.agent.host(botId);
  const nonce = crypto.randomBytes(4).toString("hex");
  const marker = `[诊断 ${nonce}]`;
  const ours = new Set<number>();
  const memory = app.agent.settings(botId).memory.enabled;
  const expectedTools = ["present", "ask_user_question", ...(memory ? ["remember"] : [])];

  // 同一机器人正在处理的回合：同一会话里后来的消息（包括用户看到"一直思考中"的那条）并入它（代理还没接手时排在它后面）
  const turns = app.agent.diagnostics().turns.filter((x) => x.botId === botId);
  if (!turns.length) mark("queue", "ok", t("diag.queue_idle"), 0);
  else mark("queue", "warn", t("diag.queue_busy", { count: turns.length, s: Math.round(Math.max(...turns.map((x) => x.forMs)) / 1000) }), 0);

  begun.spawn = Date.now();
  if (host.state === "starting") {
    const d = host.diagnostics() as { startingForMs?: number; initStage?: string };
    st("spawn").detail = t("diag.spawn_waiting", { s: Math.round((d.startingForMs ?? 0) / 1000), stage: d.initStage ?? "-" });
  }
  /** 这一轮 Responses / Messages 被拒、代理换 Chat 重做：模型这一步等重做的结果，期间的重启不算失败 */
  let rejected: { path: string; why: string } | undefined;
  const offHost = host.on((e: HostEvent) => {
    if (e.type === "spawned") st("spawn").detail = t("diag.spawn_initializing", { pid: e.pid ?? "?" });
    else if (e.type === "initialized") mark("spawn", "ok", `pid ${e.pid ?? "?"}`, e.ms);
    else if (e.type === "failed") mark("spawn", "fail", e.message);
    else if (e.type === "exit") {
      // 接口被拒、代理换到 Chat Completions 重做：这次退出是有意的重启
      if (rejected && st("model").status === "pending") return;
      const pending = failedAlready() ? undefined : stages.find((s) => s.status === "pending");
      if (pending) {
        const exit = { code: e.code ?? "-", signal: e.signal ?? "-" };
        mark(pending.id, "fail", host.stderrTail.length ? t("diag.agent_exited_stderr", { ...exit, stderr: host.stderrTail.slice(-5).join(" | ") }) : t("diag.agent_exited", exit));
      }
    }
  });
  const offProxy = app.agent.bridge.onProxy((e: ProxyEvent) => {
    if (!isModelPath(e.path)) return;
    if (e.phase === "request") {
      if (!e.lastUser?.includes(marker)) return;
      ours.add(e.id);
      if (st("plugins").status === "pending") {
        const missing = expectedTools.filter((x) => !e.tools?.includes(x));
        mark("plugins", missing.length ? "fail" : "ok", missing.length ? t("diag.plugins_missing", { tools: missing.join(", ") }) : t("diag.plugins_tools", { count: e.tools?.length ?? 0 }));
      }
      return;
    }
    if (!ours.has(e.id) || st("model").status !== "pending") return;
    // Responses / Messages 第一次被拒（请求形状不被接受）：代理会换 Chat Completions 重做，等重做的结果
    if (e.phase === "response" && !rejected && /\/v1\/(responses|messages)$/.test(e.path)) {
      const why = e.status >= 400 ? shapeRejection([{ status: e.status, error: e.error ?? "" }], "") : undefined;
      if (why) return void (rejected = { path: e.path, why });
    }
    const after = rejected ? t("diag.api_rejected", { path: rejected.path, why: rejected.why }) : "";
    if (e.phase === "response") mark("model", e.status < 400 ? "ok" : "fail", (e.status < 400 || !e.error ? `HTTP ${e.status}` : t("diag.http_error", { status: e.status, error: e.error })) + after, e.ms);
    else mark("model", "fail", e.error, e.ms);
  });

  const conv = `${botId}:diag:test-agent`;
  app.store.clearAgentSession(conv);
  let timer: NodeJS.Timeout | undefined;
  try {
    if (host.state === "running" && host.pid) mark("spawn", "ok", t("diag.already_running", { pid: host.pid }), 0);
    host.resetBackoff();
    const turn = host.runTurn({ conversationId: conv, text: `${marker} ${PROBE_PROMPT}`, model: result.model });
    const outcome = await Promise.race([
      turn.then(
        (r) => ({ kind: "done" as const, r }),
        (e) => ({ kind: "error" as const, e: e as Error }),
      ),
      new Promise<{ kind: "timeout" }>((r) => (timer = setTimeout(() => r({ kind: "timeout" }), timeoutMs))),
    ]);
    if (outcome.kind === "done") {
      result.reply = redactText(outcome.r.text.slice(0, 300));
      // 回合结束了但某一步没看到（例如 bridge 事件丢失）：按结果补齐
      if (st("spawn").status === "pending") mark("spawn", "ok");
      if (st("plugins").status === "pending") mark("plugins", "ok", t("diag.no_request_seen"));
      if (st("model").status === "pending") mark("model", "ok", t("diag.no_response_seen"));
      mark("reply", outcome.r.text.trim() ? "ok" : "fail", outcome.r.text.trim() ? result.reply : t("diag.no_text_reply"));
    } else if (outcome.kind === "error") {
      result.error = redactText(outcome.e.message.slice(0, 1500));
      // 已经有一步明确失败（启动失败、上游报错）时不再往后记
      const pending = failedAlready() ? undefined : stages.find((s) => s.status === "pending");
      if (pending) mark(pending.id, "fail", result.error);
    } else {
      const pending = stages.find((s) => s.status === "pending");
      const stageNow =
        pending?.id === "spawn" && host.initStage
          ? host.stderrTail.length
            ? t("diag.stage_now_output", { stage: host.initStage, line: host.stderrTail.at(-1) })
            : t("diag.stage_now", { stage: host.initStage })
          : "";
      if (pending) mark(pending.id, "timeout", TIMEOUT_DETAIL[pending.id](Math.round(timeoutMs / 1000)) + stageNow);
      result.error = t("diag.timeout");
      turn.catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    offHost();
    offProxy();
    app.store.clearAgentSession(conv);
  }
  return finish();
}

// ---------- 状态与报告 ----------
export function diagnosticsStatus(app: App): Record<string, unknown> {
  const mp = app.magpie;
  return {
    at: Date.now(),
    version: appVersion(),
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    electron: process.versions.electron,
    node: process.versions.node,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    dataDir: app.config.dataDir,
    logFile: logFilePath(),
    defaultModel: app.config.llm.defaultModel,
    gateway: mp
      ? {
          mode: "managed",
          state: mp.state,
          pid: mp.pid,
          restarts: mp.restarts,
          lastError: mp.lastError,
          lastExit: mp.lastExit,
          url: mp.state === "running" ? mp.baseUrl : undefined,
          logTail: mp.recentLog.slice(-20),
        }
      : { mode: "external", state: "external", url: redactText(app.config.magpie.externalBaseUrl) },
    agent: app.agent.diagnostics(),
    // Windows：代理执行命令用的 PowerShell（没有 7 时每条命令要二三十秒）
    pwsh: pwshProbe.snapshot(),
    outbox: outboxSummary(app),
    last: app.lastDiagnostics,
  };
}

/** 出站队列：等着发的、留着等对方发消息的、最近 7 天没发出去的（只有数量和原因，不含消息内容） */
function outboxSummary(app: App): Record<string, unknown> | undefined {
  try {
    const pending = app.store.listOutbox({ status: "pending", limit: 500 });
    const held = app.store.listOutbox({ status: "held", limit: 500 });
    const gone = app.store.listOutbox({ status: "gone", since: Date.now() - 7 * 86400_000, limit: 500 });
    return { pending: pending.length, retrying: pending.filter((r) => r.attempts > 0).length, lastError: pending.find((r) => r.error)?.error, held: held.length, gone7d: gone.length, lastGone: gone[0]?.error };
  } catch {
    return undefined;
  }
}

const ts = (t?: number) => (t ? new Date(t).toISOString() : "-");

function probeLine(name: string, p: ProbeResult): string {
  if (p.skipped) return `  ${t("diag.report_probe_skipped", { name, reason: p.skipped })}`;
  const head = t("diag.report_probe", { name, result: t(p.ok ? "diag.report_ok" : "diag.report_failed"), status: p.status ?? "-", ms: p.ms ?? "-", url: p.url });
  const echoed = p.echoedModel ? t("diag.report_echoed", { model: p.echoedModel }) : "";
  const reply = p.reply ? t("diag.report_reply", { reply: JSON.stringify(p.reply) }) : "";
  return `  ${head}${echoed}${reply}${p.error ? `\n    ${t("diag.report_error", { error: p.error })}` : ""}`;
}

/** 可复制的纯文本诊断报告：状态 + 最近的测试结果 + 日志尾部，整体再脱敏一遍。 */
export function diagnosticsReport(app: App, lines = 200): string {
  const s = diagnosticsStatus(app) as any;
  const out: string[] = [];
  out.push(t("diag.report_title", { at: ts(s.at) }));
  out.push(t("diag.report_version", { version: s.version, platform: s.platform, arch: s.arch, os: s.os, electron: s.electron ? ` · Electron ${s.electron}` : "", node: s.node, uptime: s.uptimeSec }));
  out.push(t("diag.report_data_dir", { dir: s.dataDir }));
  out.push(t("diag.report_log_file", { file: s.logFile ?? t("diag.report_not_enabled_paren") }));
  out.push(t("diag.report_default_model", { model: s.defaultModel || t("diag.report_auto") }));
  out.push("");
  const g = s.gateway;
  const lastExit = (x: any) => (x ? t("diag.report_last_exit", { code: x.code, signal: x.signal }) : "");
  out.push(
    g.mode === "managed"
      ? t("diag.report_gateway_managed", { state: g.state, pid: g.pid ?? "-", restarts: g.restarts, lastExit: lastExit(g.lastExit), lastError: g.lastError ? ` · ${g.lastError}` : "" })
      : t("diag.report_gateway_external", { url: g.url }),
  );
  for (const l of g.logTail ?? []) out.push(`  | ${l}`);
  const a = s.agent;
  out.push(t("diag.report_agent", { enabled: t(a.enabled ? "diag.report_enabled" : "diag.report_not_enabled"), runtime: a.runtimeDir ?? t("diag.report_missing") }));
  for (const [id, h] of Object.entries<any>(a.hosts ?? {})) {
    const exit = h.lastExit ? `${lastExit(h.lastExit)} @ ${ts(h.lastExit.at)}` : "";
    out.push(`  ${t("diag.report_host", { id, state: h.state, pid: h.pid ?? "-", restarts: h.restarts, active: h.activeTurns, lastExit: exit })}${h.lastError ? `\n    ${t("diag.report_last_error", { error: h.lastError })}` : ""}`);
    for (const l of h.stderrTail ?? []) out.push(`    | ${l}`);
  }
  const ps = pwshReportLine(s.pwsh);
  if (ps) out.push(ps);
  const ob = s.outbox;
  if (ob)
    out.push(
      tr("diag.outboxLine", {
        pending: ob.pending,
        retrying: ob.retrying,
        lastError: ob.lastError ? tr("diag.outboxLastError", { error: ob.lastError }) : "",
        held: ob.held ? tr("diag.outboxHeld", { n: ob.held }) : "",
        gone: ob.gone7d,
        lastGone: ob.lastGone ? tr("diag.outboxLastGone", { text: ob.lastGone }) : "",
      }),
    );
  const m = app.lastDiagnostics.model;
  if (m) {
    out.push("");
    // 结论按报告的语言重新给出（测试结果里存的是测试时的语言）
    out.push(t("diag.report_model_test", { at: ts(m.at), model: m.model || "-", verdict: modelVerdict(m.gateway, m.direct) }));
    out.push(probeLine(t("diag.report_via_gateway"), m.gateway));
    out.push(probeLine(t("diag.report_direct"), m.direct));
  }
  const ag = app.lastDiagnostics.agent;
  if (ag) {
    out.push("");
    const result = ag.ok ? t("diag.report_passed") : t("diag.report_not_passed", { stage: ag.stuckAt ?? "?" });
    out.push(t("diag.report_agent_test", { at: ts(ag.at), bot: ag.botId, model: ag.model || "-", result, ms: ag.ms }));
    for (const st of ag.stages) out.push(`  ${t(STAGE_LABEL[st.id])}: ${st.status}${st.ms !== undefined ? ` · ${st.ms} ms` : ""}${st.detail ? ` · ${st.detail}` : ""}`);
  }
  out.push("");
  out.push(t("diag.report_log_tail", { count: lines }));
  out.push(...readLogTail(lines));
  return redactText(out.join("\n"));
}

/** 状态对象再过一遍脱敏（字段名像密钥的整项替换，字符串里的密钥原文替换） */
export function safeStatus(app: App): unknown {
  return redactValue(diagnosticsStatus(app));
}
