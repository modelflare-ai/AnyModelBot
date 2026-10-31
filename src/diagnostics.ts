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
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `超时（${Math.round(timeoutMs / 1000)} 秒内没有响应）`;
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
  if (!base) return { ...res, error: "没有配置端点地址" };
  if (!model) return { ...res, error: "没有可用的模型：请先在 Modelflare 里选择默认模型" };
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
    if (typeof content !== "string") return { ...res, error: `响应里没有 choices[0].message.content：${redactText(text.slice(0, 500))}` };
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
  if (g.skipped) return d.ok ? "端点正常" : `端点出错：${d.status ? `HTTP ${d.status}` : d.error}`;
  if (g.ok && d.ok) return "内置网关与直连端点都正常";
  if (g.ok && !d.ok) return d.skipped ? "内置网关正常" : "经内置网关正常，直连端点失败（网关可能用了别的线路或重试）";
  if (!g.ok && d.ok) return "端点本身正常，问题在内置网关";
  if (d.skipped) return "内置网关出错，未能直连对比";
  return `端点本身出错（${d.status ? `HTTP ${d.status}` : d.error}），内置网关也失败`;
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
      mp.state === "running" || r.ok ? r : { ...r, error: `${r.error ?? ""}（内置网关状态：${mp.state}${mp.lastError ? `，${redactText(mp.lastError)}` : ""}）` },
    );
    const up = mp.upstreamEndpoint(model.includes("/") ? model.split("/")[0] : undefined);
    direct = up
      ? probeChat("direct", up.baseUrl, up.apiKey, bareModel(model), { ...probeOpts, headers: app.requestHeaders() })
      : Promise.resolve({ route: "direct", url: "", ok: false, skipped: "还没有连接 Modelflare" });
  } else {
    const base = app.config.magpie.externalBaseUrl;
    gateway = Promise.resolve({ route: "gateway", url: "", ok: false, skipped: "外部端点模式：机器人直接调用该端点，不经内置网关" });
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

const STAGES: Array<[StageId, string]> = [
  ["queue", "消息队列"],
  ["spawn", "启动代理进程"],
  ["plugins", "加载插件"],
  ["model", "调用模型"],
  ["reply", "得到回复"],
];

const TIMEOUT_DETAIL: Record<StageId, (s: number) => string> = {
  queue: () => "",
  spawn: (s) => `代理进程 ${s} 秒内没有完成启动（initialize 没有返回）`,
  plugins: (s) => `代理进程已启动，但 ${s} 秒内没有发出模型请求`,
  model: (s) => `模型请求已发出，${s} 秒内上游没有响应`,
  reply: (s) => `模型已响应，但代理 ${s} 秒内没有结束这一轮`,
};

/**
 * 让代理进程完整跑一轮最小对话（独立的诊断会话，不进聊天记录），按事件判断每一步：
 * 启动（spawn + initialize）→ 插件（模型请求里有插件注册的工具）→ 模型调用（bridge 看到上游响应）→ 回复（回合结束）。
 */
export async function testAgent(app: App, opts: { botId?: string; model?: string; timeoutMs?: number } = {}): Promise<AgentTestResult> {
  const t0 = Date.now();
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 120_000, 5_000), 600_000);
  const botId = opts.botId || app.store.listBots()[0]?.id || "default";
  const stages: AgentStage[] = STAGES.map(([id, label]) => ({ id, label, status: "pending" }));
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
    mark("spawn", "fail", app.config.agent.mode === "off" ? "代理模式已关闭（AMB_AGENT=off），机器人只做纯对话" : "找不到代理运行时（DSH），机器人只能纯对话");
    return finish();
  }
  const picked = await pickModel(app, botId, opts.model);
  result.model = picked ? app.routeModel(botId, picked) : "";
  if (!result.model) {
    mark("spawn", "fail", "没有可用的模型：请先连接 Modelflare 并选择默认模型");
    return finish();
  }

  const host = app.agent.host(botId);
  const nonce = crypto.randomBytes(4).toString("hex");
  const marker = `[诊断 ${nonce}]`;
  const ours = new Set<number>();
  const memory = app.agent.settings(botId).memory.enabled;
  const expectedTools = ["present", "ask_user_question", ...(memory ? ["remember"] : [])];

  // 同一机器人正在处理的回合：同一会话里后来的消息（包括用户看到"一直思考中"的那条）并入它（代理还没接手时排在它后面）
  const turns = app.agent.diagnostics().turns.filter((t) => t.botId === botId);
  if (!turns.length) mark("queue", "ok", "没有正在处理的回合", 0);
  else mark("queue", "warn", `${turns.length} 轮对话正在处理（最长已 ${Math.round(Math.max(...turns.map((t) => t.forMs)) / 1000)} 秒）；同一会话的新消息会并入正在进行的回合（代理还没接手时排在后面）。卡住时用 /stop，或下面的"重启代理进程"`, 0);

  begun.spawn = Date.now();
  if (host.state === "starting") {
    const d = host.diagnostics() as { startingForMs?: number; initStage?: string };
    st("spawn").detail = `等待正在进行的启动（已 ${Math.round((d.startingForMs ?? 0) / 1000)} 秒，阶段：${d.initStage ?? "-"}）`;
  }
  /** 这一轮 Responses / Messages 被拒、代理换 Chat 重做：模型这一步等重做的结果，期间的重启不算失败 */
  let rejected: { path: string; why: string } | undefined;
  const offHost = host.on((e: HostEvent) => {
    if (e.type === "spawned") st("spawn").detail = `pid ${e.pid ?? "?"}，等待初始化…`;
    else if (e.type === "initialized") mark("spawn", "ok", `pid ${e.pid ?? "?"}`, e.ms);
    else if (e.type === "failed") mark("spawn", "fail", e.message);
    else if (e.type === "exit") {
      // 接口被拒、代理换到 Chat Completions 重做：这次退出是有意的重启
      if (rejected && st("model").status === "pending") return;
      const pending = failedAlready() ? undefined : stages.find((s) => s.status === "pending");
      if (pending) mark(pending.id, "fail", `代理进程退出（code=${e.code ?? "-"}, signal=${e.signal ?? "-"}）${host.stderrTail.length ? `；stderr：${host.stderrTail.slice(-5).join(" | ")}` : ""}`);
    }
  });
  const offProxy = app.agent.bridge.onProxy((e: ProxyEvent) => {
    if (!isModelPath(e.path)) return;
    if (e.phase === "request") {
      if (!e.lastUser?.includes(marker)) return;
      ours.add(e.id);
      if (st("plugins").status === "pending") {
        const missing = expectedTools.filter((t) => !e.tools?.includes(t));
        mark("plugins", missing.length ? "fail" : "ok", missing.length ? `模型请求里缺少插件提供的工具：${missing.join(", ")}` : `${e.tools?.length ?? 0} 个工具`);
      }
      return;
    }
    if (!ours.has(e.id) || st("model").status !== "pending") return;
    // Responses / Messages 第一次被拒（请求形状不被接受）：代理会换 Chat Completions 重做，等重做的结果
    if (e.phase === "response" && !rejected && /\/v1\/(responses|messages)$/.test(e.path)) {
      const why = e.status >= 400 ? shapeRejection([{ status: e.status, error: e.error ?? "" }], "") : undefined;
      if (why) return void (rejected = { path: e.path, why });
    }
    const after = rejected ? `（${rejected.path} 被拒：${rejected.why}；已改用 Chat Completions）` : "";
    if (e.phase === "response") mark("model", e.status < 400 ? "ok" : "fail", e.status < 400 ? `HTTP ${e.status}${after}` : `HTTP ${e.status}${e.error ? `：${e.error}` : ""}${after}`, e.ms);
    else mark("model", "fail", e.error, e.ms);
  });

  const conv = `${botId}:diag:test-agent`;
  app.store.clearAgentSession(conv);
  let timer: NodeJS.Timeout | undefined;
  try {
    if (host.state === "running" && host.pid) mark("spawn", "ok", `已在运行（pid ${host.pid}）`, 0);
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
      if (st("plugins").status === "pending") mark("plugins", "ok", "（没有观察到模型请求）");
      if (st("model").status === "pending") mark("model", "ok", "（没有观察到上游响应）");
      mark("reply", outcome.r.text.trim() ? "ok" : "fail", outcome.r.text.trim() ? result.reply : "回合结束了，但没有文字回复");
    } else if (outcome.kind === "error") {
      result.error = redactText(outcome.e.message.slice(0, 1500));
      // 已经有一步明确失败（启动失败、上游报错）时不再往后记
      const pending = failedAlready() ? undefined : stages.find((s) => s.status === "pending");
      if (pending) mark(pending.id, "fail", result.error);
    } else {
      const pending = stages.find((s) => s.status === "pending");
      const stageNow = pending?.id === "spawn" && host.initStage ? `；当前阶段：${host.initStage}${host.stderrTail.length ? `；最近输出：${host.stderrTail.at(-1)}` : ""}` : "";
      if (pending) mark(pending.id, "timeout", TIMEOUT_DETAIL[pending.id](Math.round(timeoutMs / 1000)) + stageNow);
      result.error = "超时";
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
    last: app.lastDiagnostics,
  };
}

const ts = (t?: number) => (t ? new Date(t).toISOString() : "-");

function probeLine(name: string, p: ProbeResult): string {
  if (p.skipped) return `  ${name}: 未测（${p.skipped}）`;
  return `  ${name}: ${p.ok ? "正常" : "失败"} · HTTP ${p.status ?? "-"} · ${p.ms ?? "-"} ms · ${p.url}${p.echoedModel ? ` · 回显模型 ${p.echoedModel}` : ""}${p.reply ? ` · 回复 ${JSON.stringify(p.reply)}` : ""}${p.error ? `\n    错误：${p.error}` : ""}`;
}

/** 可复制的纯文本诊断报告：状态 + 最近的测试结果 + 日志尾部，整体再脱敏一遍。 */
export function diagnosticsReport(app: App, lines = 200): string {
  const s = diagnosticsStatus(app) as any;
  const out: string[] = [];
  out.push(`anymodel bot 诊断信息 · ${ts(s.at)}`);
  out.push(`版本 ${s.version} · ${s.platform} ${s.arch} · ${s.os}${s.electron ? ` · Electron ${s.electron}` : ""} · Node ${s.node} · 运行 ${s.uptimeSec} 秒`);
  out.push(`数据目录 ${s.dataDir}`);
  out.push(`日志文件 ${s.logFile ?? "（未启用）"}`);
  out.push(`默认模型 ${s.defaultModel || "（自动）"}`);
  out.push("");
  const g = s.gateway;
  out.push(`[模型网关] ${g.mode === "managed" ? `内置 magpie · ${g.state} · pid ${g.pid ?? "-"} · 重启 ${g.restarts} 次${g.lastExit ? ` · 上次退出 code=${g.lastExit.code} signal=${g.lastExit.signal}` : ""}${g.lastError ? ` · ${g.lastError}` : ""}` : `外部端点 ${g.url}`}`);
  for (const l of g.logTail ?? []) out.push(`  | ${l}`);
  const a = s.agent;
  out.push(`[代理] ${a.enabled ? "已启用" : "未启用"} · 运行时 ${a.runtimeDir ?? "缺失"}`);
  for (const [id, h] of Object.entries<any>(a.hosts ?? {})) {
    out.push(`  机器人 ${id}: ${h.state} · pid ${h.pid ?? "-"} · 重启 ${h.restarts} 次 · 进行中 ${h.activeTurns}${h.lastExit ? ` · 上次退出 code=${h.lastExit.code} signal=${h.lastExit.signal} @ ${ts(h.lastExit.at)}` : ""}${h.lastError ? `\n    最近错误：${h.lastError}` : ""}`);
    for (const l of h.stderrTail ?? []) out.push(`    | ${l}`);
  }
  const ps = pwshReportLine(s.pwsh);
  if (ps) out.push(ps);
  const m = app.lastDiagnostics.model;
  if (m) {
    out.push("");
    out.push(`[测试模型] ${ts(m.at)} · 模型 ${m.model || "-"} · ${m.verdict}`);
    out.push(probeLine("经内置网关", m.gateway));
    out.push(probeLine("直连端点", m.direct));
  }
  const t = app.lastDiagnostics.agent;
  if (t) {
    out.push("");
    out.push(`[测试代理] ${ts(t.at)} · 机器人 ${t.botId} · 模型 ${t.model || "-"} · ${t.ok ? "通过" : `未通过（${t.stuckAt ?? "?"}）`} · ${t.ms} ms`);
    for (const st of t.stages) out.push(`  ${st.label}: ${st.status}${st.ms !== undefined ? ` · ${st.ms} ms` : ""}${st.detail ? ` · ${st.detail}` : ""}`);
  }
  out.push("");
  out.push(`[最近 ${lines} 行日志]`);
  out.push(...readLogTail(lines));
  return redactText(out.join("\n"));
}

/** 状态对象再过一遍脱敏（字段名像密钥的整项替换，字符串里的密钥原文替换） */
export function safeStatus(app: App): unknown {
  return redactValue(diagnosticsStatus(app));
}
