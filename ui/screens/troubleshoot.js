// 设置 → 故障排查：状态（网关、代理进程、版本、目录）、测试模型（经内置网关 vs 直连端点）、测试代理（逐段定位卡在哪）、
// 重启代理进程、最近日志、复制诊断信息。所有内容由后端脱敏，界面不再拼接任何密钥。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, CopyButton, Icon, Skeleton } from "../components/ui.js";
import { api } from "../lib/api.js";
import { failed, toast } from "../lib/store.js";
import { PWSH_INSTALL_URL, PWSH_WINGET, recheckPwsh } from "../lib/pwsh.js";
import { t } from "../lib/i18n.js";

// 状态 → [文字, 圆点颜色]。文字跟着界面语言，渲染时再取（写成函数）
const GATEWAY = () => ({
  running: [t("troubleshoot.gateway.running"), "ok"],
  starting: [t("troubleshoot.gateway.starting"), "warn"],
  restarting: [t("troubleshoot.gateway.restarting"), "warn"],
  failed: [t("troubleshoot.gateway.failed"), "err"],
  stopped: [t("troubleshoot.gateway.stopped"), "off"],
  external: [t("troubleshoot.gateway.external"), "ok"],
});
const HOST = () => ({
  running: [t("troubleshoot.host.running"), "ok"],
  starting: [t("troubleshoot.host.starting"), "warn"],
  backoff: [t("troubleshoot.host.backoff"), "warn"],
  error: [t("troubleshoot.host.error"), "err"],
  stopped: [t("troubleshoot.host.stopped"), "off"],
});
const STAGE = () => ({
  ok: [t("troubleshoot.stage.ok"), "ok"],
  warn: [t("troubleshoot.stage.warn"), "warn"],
  fail: [t("troubleshoot.stage.fail"), "err"],
  timeout: [t("troubleshoot.stage.timeout"), "err"],
  skipped: [t("troubleshoot.stage.skipped"), "off"],
  pending: [t("troubleshoot.stage.pending"), "warn"],
});
const initStage = (s) =>
  ({
    prepare: t("troubleshoot.init.prepare"),
    "bridge ready": t("troubleshoot.init.bridgeReady"),
    "sdk loaded": t("troubleshoot.init.sdkLoaded"),
    "patch written": t("troubleshoot.init.patchWritten"),
    "child spawned": t("troubleshoot.init.childSpawned"),
    initializing: t("troubleshoot.init.initializing"),
  })[s] || s;
const secsText = (n) => t("troubleshoot.secs", { s: n });

/** 代理进程一行的说明：启动中显示进度和阶段，运行中显示上次启动用时 */
function hostSub(h) {
  const secs = (ms) => secsText(ms >= 10_000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1));
  if (h.state === "starting")
    return join(
      t("troubleshoot.hostSub.elapsed", { time: secs(h.startingForMs || 0) }),
      h.initStage && t("troubleshoot.hostSub.stage", { stage: initStage(h.initStage) }),
      h.firstStart && t("troubleshoot.hostSub.firstStart"),
      h.initTimeoutMs && t("troubleshoot.hostSub.maxWait", { count: Math.round(h.initTimeoutMs / 60000) }),
    );
  return join(
    h.pid && `pid ${h.pid}`,
    h.model,
    h.lastInitMs && t("troubleshoot.hostSub.initTime", { time: secs(h.lastInitMs) }),
    h.restarts ? t("troubleshoot.restarts", { count: h.restarts }) : "",
    h.activeTurns ? t("troubleshoot.hostSub.activeTurns", { count: h.activeTurns }) : "",
    h.retryInMs ? t("troubleshoot.hostSub.retryIn", { count: Math.ceil(h.retryInMs / 60000) }) : "",
    exitText(h.lastExit),
    h.lastError,
  );
}

function Row({ id, name, sub, mono, children, compact }) {
  return html`<div class=${`row${compact ? " compact" : ""}`} id=${id ? `ts-${id}` : undefined}>
    <div class="who"><div class="name">${name}</div>${sub && html`<div class=${`sub wrap${mono ? " ts-mono" : ""}`}>${sub}</div>`}</div>
    <div class="ctl">${children}</div>
  </div>`;
}

const State = ({ map, s }) => {
  const [text, kind] = map[s] || [s || t("common.unknown"), "off"];
  return html`<span class="ts-state"><span class=${`dot ${kind === "off" ? "" : kind}`}></span>${text}</span>`;
};

const Verdict = ({ ok }) => html`<span class="ts-state"><span class=${`dot ${ok ? "ok" : "err"}`}></span>${ok ? t("troubleshoot.verdict.ok") : t("troubleshoot.verdict.bad")}</span>`;

const ms = (v) => (v === undefined || v === null ? "" : v >= 10_000 ? secsText((v / 1000).toFixed(1)) : `${v} ms`);
const exitText = (e) => (e ? t("troubleshoot.lastExit", { code: e.code ?? "-", signal: e.signal ? ` signal=${e.signal}` : "" }) : "");
const join = (...a) => a.filter(Boolean).join(" · ");
const psSource = (s) => ({ "program-files": t("troubleshoot.pwsh.source.programFiles"), path: "PATH", preview: t("troubleshoot.pwsh.source.preview"), store: "Microsoft Store" })[s];

/** PowerShell（只在 Windows 上）：版本或"未安装"；没有 7 时下面多一行安装命令和下载链接 */
function PwshRows({ ps, busy, onRecheck }) {
  if (!ps || !ps.applicable) return null;
  const [text, kind] = ps.checking ? [t("troubleshoot.pwsh.checking"), ""] : !ps.missing ? [ps.version || "7", "ok"] : ps.found && ps.version ? [ps.version, "warn"] : [t("troubleshoot.pwsh.missing"), "warn"];
  const sub = ps.checking
    ? t("troubleshoot.pwsh.looking")
    : !ps.missing
      ? join(ps.path, psSource(ps.source), t("troubleshoot.pwsh.usedBy"))
      : ps.found
        ? join(ps.path, t("troubleshoot.pwsh.old"))
        : t("troubleshoot.pwsh.builtin");
  return html`<${Row} id="pwsh" name="PowerShell" sub=${sub}>
      <span class="ts-state"><span class=${`dot ${kind}`}></span>${text}</span>
      <button type="button" class="text" disabled=${!!busy} aria-busy=${busy === "pwsh" || undefined} onClick=${onRecheck}>${busy === "pwsh" ? t("troubleshoot.pwsh.checkingBusy") : t("troubleshoot.pwsh.recheck")}</button>
    <//>
    ${ps.missing && html`<${Row} compact id="pwsh-install" name=${t("troubleshoot.pwsh.install")} sub=${PWSH_WINGET} mono>
      <${CopyButton} text=${PWSH_WINGET} label=${t("troubleshoot.pwsh.copyCmd")} />
      <a class="btn sm" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">${t("troubleshoot.pwsh.download")}</a>
    <//>`}`;
}

function ProbeRow({ name, p }) {
  if (!p) return null;
  if (p.skipped) return html`<${Row} compact name=${name} sub=${p.skipped}><span class="ts-state"><span class="dot"></span>${t("troubleshoot.probe.untested")}</span><//>`;
  const sub = p.ok ? join(p.url, p.echoedModel && t("troubleshoot.probe.echoed", { model: p.echoedModel }), p.reply && t("troubleshoot.probe.reply", { reply: p.reply })) : join(p.url, p.error);
  return html`<${Row} compact name=${name} sub=${sub} mono=${!p.ok}>
    <span class="ts-state"><span class=${`dot ${p.ok ? "ok" : "err"}`}></span>${p.status ? `HTTP ${p.status}` : p.ok ? t("troubleshoot.probe.ok") : t("common.failed")}</span>
    ${p.ms !== undefined && html`<span class="val num">${ms(p.ms)}</span>`}
  <//>`;
}

export function TroubleshootPane({ bots, desktop }) {
  const [st, setSt] = useState(null);
  const [logs, setLogs] = useState(null);
  const [busy, setBusy] = useState("");
  const [modelRes, setModelRes] = useState(null);
  const [agentRes, setAgentRes] = useState(null);
  const logRef = useRef(null);
  const botName = (id) => (bots || []).find((b) => b.id === id)?.name || id;

  const loadStatus = () =>
    api("/diagnostics")
      .then((d) => {
        setSt(d);
        // 最近一次结果在服务端保留：切走再回来也能看到
        if (d.last?.model) setModelRes((v) => v || d.last.model);
        if (d.last?.agent) setAgentRes((v) => v || d.last.agent);
      })
      .catch(() => {});
  const loadLogs = () =>
    api("/diagnostics/logs?lines=200")
      .then((d) => {
        setLogs(d);
        requestAnimationFrame(() => logRef.current && (logRef.current.scrollTop = logRef.current.scrollHeight));
      })
      .catch((e) => setLogs({ lines: [t("troubleshoot.logs.readFailed", { error: e.message })] }));

  useEffect(() => {
    loadStatus();
    loadLogs();
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  const run = async (what, fn) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      failed(e);
    } finally {
      setBusy("");
      loadStatus();
      loadLogs();
    }
  };
  const testModel = () => run("model", async () => setModelRes(await api("/diagnostics/test-model", { method: "POST", body: {} })));
  const testAgent = () => run("agent", async () => setAgentRes(await api("/diagnostics/test-agent", { method: "POST", body: { timeoutMs: 120000 } })));
  const restart = () =>
    run("restart", async () => {
      const r = await api("/diagnostics/restart-agent", { method: "POST", body: {} });
      toast(r.restarted.length ? t("troubleshoot.restart.done") : t("troubleshoot.restart.notRunning"));
    });
  const recheckPs = () => run("pwsh", recheckPwsh);
  const copy = () =>
    run("copy", async () => {
      const { text } = await api("/diagnostics/report?lines=200");
      await navigator.clipboard.writeText(text);
      toast(t("troubleshoot.copied"));
    });

  if (!st) return html`<div class="list"><div class="row"><${Skeleton} w="40%" /></div><div class="row"><${Skeleton} w="55%" /></div></div>`;

  const g = st.gateway || {};
  const hosts = Object.entries(st.agent?.hosts || {});
  const tail = hosts.flatMap(([, h]) => h.stderrTail || []).slice(-12);
  const stageMap = STAGE();
  return html`
    <div class="set-part">${t("troubleshoot.status")}</div>
    <div class="list">
      <${Row} id="gateway" name=${t("troubleshoot.gateway.name")}
        sub=${g.mode === "managed" ? join(g.pid && `pid ${g.pid}`, g.restarts ? t("troubleshoot.restarts", { count: g.restarts }) : "", exitText(g.lastExit), g.lastError) : join(t("troubleshoot.gateway.fromEnv", { env: "AMB_MAGPIE_BASE_URL" }), g.url)}>
        <${State} map=${GATEWAY()} s=${g.state} />
      <//>
      ${!st.agent?.available && html`<${Row} id="agent" name=${t("troubleshoot.agent.name")} sub=${st.agent?.enabled ? t("troubleshoot.agent.noRuntime") : t("troubleshoot.agent.disabled")}><${State} map=${HOST()} s="error" /><//>`}
      ${st.agent?.available && !hosts.length && html`<${Row} id="agent" name=${t("troubleshoot.agent.name")} sub=${t("troubleshoot.agent.startsOnFirst")}><${State} map=${HOST()} s="stopped" /><//>`}
      ${hosts.map(([id, h]) => html`<${Row} key=${id} id=${`agent-${id}`} name=${hosts.length > 1 ? t("troubleshoot.agent.nameFor", { bot: botName(id) }) : t("troubleshoot.agent.name")}
        sub=${hostSub(h)}>
        <${State} map=${HOST()} s=${h.state} />
      <//>`)}
      ${tail.length > 0 && html`<div class="row-edit ts-tail"><span class="t-label">${t("troubleshoot.agent.stderr", { count: tail.length })}</span><pre class="ts-mono">${tail.join("\n")}</pre></div>`}
      <${PwshRows} ps=${st.pwsh} busy=${busy} onRecheck=${recheckPs} />
      <${Row} id="version" name=${t("troubleshoot.version")} sub=${join(st.os, st.electron && `Electron ${st.electron}`, `Node ${st.node}`)}>
        <span class="val">${st.version} · ${st.platform} ${st.arch}</span>
      <//>
      <${Row} id="data-dir" name=${t("troubleshoot.dataDir")}>
        <span class="val" title=${st.dataDir}>${st.dataDir}</span><${CopyButton} text=${st.dataDir} label=${t("troubleshoot.copyPath")} />
        ${desktop && html`<button type="button" class="text" onClick=${() => api("/desktop/open-data-dir", { method: "POST", body: {} }).catch(failed)}>${t("common.open")}</button>`}
      <//>
      <${Row} id="log-file" name=${t("troubleshoot.logFile")} sub=${t("troubleshoot.logFileSub")}>
        <span class="val" title=${st.logFile || ""}>${st.logFile || t("troubleshoot.logFileOff")}</span>${st.logFile && html`<${CopyButton} text=${st.logFile} label=${t("troubleshoot.copyPath")} />`}
      <//>
    </div>

    <div class="set-part">${t("troubleshoot.checks")}</div>
    <div class="list">
      <${Row} id="test-model" name=${t("troubleshoot.testModel.name")} sub=${t("troubleshoot.testModel.sub")}>
        <${Button} size="sm" loading=${busy === "model"} disabled=${!!busy} onClick=${testModel}>${t("troubleshoot.test")}<//>
      <//>
      ${modelRes && html`
        <${Row} compact name=${modelRes.verdict} sub=${t("troubleshoot.model", { model: modelRes.model || t("troubleshoot.none") })}>
          <${Verdict} ok=${modelRes.direct.ok && (modelRes.gateway.ok || !!modelRes.gateway.skipped)} />
        <//>
        <${ProbeRow} name=${t("troubleshoot.testModel.viaGateway")} p=${modelRes.gateway} />
        <${ProbeRow} name=${t("troubleshoot.testModel.direct")} p=${modelRes.direct} />`}
      <${Row} id="test-agent" name=${t("troubleshoot.testAgent.name")} sub=${t("troubleshoot.testAgent.sub")}>
        <${Button} size="sm" loading=${busy === "agent"} disabled=${!!busy} onClick=${testAgent}>${t("troubleshoot.test")}<//>
      <//>
      ${agentRes && html`
        <${Row} compact name=${agentRes.ok ? t("troubleshoot.testAgent.ok") : t("troubleshoot.testAgent.stuckAt", { stage: (agentRes.stages.find((s) => s.id === agentRes.stuckAt) || {}).label || t("common.unknown") })}
          sub=${join(t("troubleshoot.testAgent.bot", { name: botName(agentRes.botId) }), agentRes.model && t("troubleshoot.model", { model: agentRes.model }), t("troubleshoot.testAgent.total", { time: ms(agentRes.ms) }))}>
          <${Verdict} ok=${agentRes.ok} />
        <//>
        ${agentRes.stages.map((s) => html`<${Row} compact key=${s.id} name=${s.label} sub=${s.detail} mono=${s.status === "fail" || s.status === "timeout"}>
          <${State} map=${stageMap} s=${s.status} />${s.ms !== undefined && html`<span class="val num">${ms(s.ms)}</span>`}
        <//>`)}`}
      <${Row} id="restart-agent" name=${t("troubleshoot.restart.name")} sub=${t("troubleshoot.restart.sub")}>
        <${Button} size="sm" loading=${busy === "restart"} disabled=${!!busy} onClick=${restart}>${t("troubleshoot.restart.button")}<//>
      <//>
    </div>

    <div class="set-part ts-log-head">
      <span>${t("troubleshoot.logs.title")}</span><span class="t-meta">${logs ? t("troubleshoot.logs.lines", { count: logs.lines.length }) : ""}</span><span class="grow"></span>
      <button type="button" class="text" onClick=${loadLogs}><${Icon} name="refresh" size="sm" /> ${t("common.refresh")}</button>
      <${Button} size="sm" icon="copy" loading=${busy === "copy"} disabled=${!!busy && busy !== "copy"} onClick=${copy}>${t("troubleshoot.copyReport")}<//>
    </div>
    <pre class="ts-log" ref=${logRef} tabindex="0" aria-label=${t("troubleshoot.logs.title")}>${logs ? logs.lines.join("\n") || t("troubleshoot.logs.empty") : t("common.loading")}</pre>
    <p class="ts-note">${t("troubleshoot.note")}</p>
  `;
}
