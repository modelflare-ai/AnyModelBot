// 设置 → 故障排查：状态（网关、代理进程、版本、目录）、测试模型（经内置网关 vs 直连端点）、测试代理（逐段定位卡在哪）、
// 重启代理进程、最近日志、复制诊断信息。所有内容由后端脱敏，界面不再拼接任何密钥。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, CopyButton, Icon, Skeleton } from "../components/ui.js";
import { api } from "../lib/api.js";
import { failed, toast } from "../lib/store.js";
import { PWSH_INSTALL_URL, PWSH_WINGET, recheckPwsh } from "../lib/pwsh.js";

const GATEWAY = { running: ["运行中", "ok"], starting: ["启动中", "warn"], restarting: ["重启中", "warn"], failed: ["失败", "err"], stopped: ["已停止", "off"], external: ["外部端点", "ok"] };
const HOST = { running: ["运行中", "ok"], starting: ["启动中", "warn"], backoff: ["等待重试", "warn"], error: ["已暂停", "err"], stopped: ["未启动", "off"] };
const STAGE = { ok: ["通过", "ok"], warn: ["注意", "warn"], fail: ["失败", "err"], timeout: ["超时", "err"], skipped: ["未执行", "off"], pending: ["进行中", "warn"] };
const INIT_STAGE = { prepare: "准备", "bridge ready": "模型桥已就绪", "sdk loaded": "加载运行时", "patch written": "写入配置", "child spawned": "进程已拉起", initializing: "初始化（加载插件）" };

/** 代理进程一行的说明：启动中显示进度和阶段，运行中显示上次启动用时 */
function hostSub(h) {
  const secs = (ms) => (ms >= 10_000 ? `${Math.round(ms / 1000)} 秒` : `${(ms / 1000).toFixed(1)} 秒`);
  if (h.state === "starting")
    return join(`已 ${secs(h.startingForMs || 0)}`, h.initStage && `阶段：${INIT_STAGE[h.initStage] || h.initStage}`, h.firstStart && "首次启动可能需要几分钟（杀毒软件会逐个扫描运行时文件）", h.initTimeoutMs && `最多等 ${Math.round(h.initTimeoutMs / 60000)} 分钟`);
  return join(
    h.pid && `pid ${h.pid}`,
    h.model,
    h.lastInitMs && `启动用时 ${secs(h.lastInitMs)}`,
    h.restarts ? `重启 ${h.restarts} 次` : "",
    h.activeTurns ? `${h.activeTurns} 轮进行中` : "",
    h.retryInMs ? `${Math.ceil(h.retryInMs / 60000)} 分钟后自动重试，或点下面的"重启代理进程"` : "",
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
  const [text, kind] = map[s] || [s || "未知", "off"];
  return html`<span class="ts-state"><span class=${`dot ${kind === "off" ? "" : kind}`}></span>${text}</span>`;
};

const Verdict = ({ ok }) => html`<span class="ts-state"><span class=${`dot ${ok ? "ok" : "err"}`}></span>${ok ? "正常" : "有问题"}</span>`;

const ms = (v) => (v === undefined || v === null ? "" : v >= 10_000 ? `${(v / 1000).toFixed(1)} 秒` : `${v} ms`);
const exitText = (e) => (e ? `上次退出 code=${e.code ?? "-"}${e.signal ? ` signal=${e.signal}` : ""}` : "");
const join = (...a) => a.filter(Boolean).join(" · ");
const PS_SOURCE = { "program-files": "安装目录", path: "PATH", preview: "预览版", store: "Microsoft Store" };

/** PowerShell（只在 Windows 上）：版本或"未安装"；没有 7 时下面多一行安装命令和下载链接 */
function PwshRows({ ps, busy, onRecheck }) {
  if (!ps || !ps.applicable) return null;
  const [text, kind] = ps.checking ? ["检测中", ""] : !ps.missing ? [ps.version || "7", "ok"] : ps.found && ps.version ? [ps.version, "warn"] : ["未安装", "warn"];
  const sub = ps.checking
    ? "正在找 PowerShell 7"
    : !ps.missing
      ? join(ps.path, PS_SOURCE[ps.source], "代理用它执行命令")
      : ps.found
        ? join(ps.path, "版本较旧：装上 PowerShell 7，命令执行快得多，也更稳定")
        : "代理执行命令用的是系统自带的 Windows PowerShell 5.1，每条可能要二三十秒。装上 PowerShell 7，命令执行快得多，也更稳定";
  return html`<${Row} id="pwsh" name="PowerShell" sub=${sub}>
      <span class="ts-state"><span class=${`dot ${kind}`}></span>${text}</span>
      <button type="button" class="text" disabled=${!!busy} aria-busy=${busy === "pwsh" || undefined} onClick=${onRecheck}>${busy === "pwsh" ? "检测中…" : "重新检测"}</button>
    <//>
    ${ps.missing && html`<${Row} compact id="pwsh-install" name="安装 PowerShell 7" sub=${PWSH_WINGET} mono>
      <${CopyButton} text=${PWSH_WINGET} label="复制安装命令" />
      <a class="btn sm" href=${PWSH_INSTALL_URL} target="_blank" rel="noopener noreferrer">下载安装 ↗</a>
    <//>`}`;
}

function ProbeRow({ name, p }) {
  if (!p) return null;
  if (p.skipped) return html`<${Row} compact name=${name} sub=${p.skipped}><span class="ts-state"><span class="dot"></span>未测</span><//>`;
  const sub = p.ok ? join(p.url, p.echoedModel && `回显模型 ${p.echoedModel}`, p.reply && `回复 “${p.reply}”`) : join(p.url, p.error);
  return html`<${Row} compact name=${name} sub=${sub} mono=${!p.ok}>
    <span class="ts-state"><span class=${`dot ${p.ok ? "ok" : "err"}`}></span>${p.status ? `HTTP ${p.status}` : p.ok ? "正常" : "失败"}</span>
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
      .catch((e) => setLogs({ lines: [`读取日志失败：${e.message}`] }));

  useEffect(() => {
    loadStatus();
    loadLogs();
    const t = setInterval(loadStatus, 3000);
    return () => clearInterval(t);
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
      toast(r.restarted.length ? "代理进程已重启" : "代理进程还没有启动，下一条消息时启动");
    });
  const recheckPs = () => run("pwsh", recheckPwsh);
  const copy = () =>
    run("copy", async () => {
      const { text } = await api("/diagnostics/report?lines=200");
      await navigator.clipboard.writeText(text);
      toast("诊断信息已复制（已去掉密钥）");
    });

  if (!st) return html`<div class="list"><div class="row"><${Skeleton} w="40%" /></div><div class="row"><${Skeleton} w="55%" /></div></div>`;

  const g = st.gateway || {};
  const hosts = Object.entries(st.agent?.hosts || {});
  const tail = hosts.flatMap(([, h]) => h.stderrTail || []).slice(-12);
  return html`
    <div class="set-part">状态</div>
    <div class="list">
      <${Row} id="gateway" name="模型网关"
        sub=${g.mode === "managed" ? join(g.pid && `pid ${g.pid}`, g.restarts ? `重启 ${g.restarts} 次` : "", exitText(g.lastExit), g.lastError) : join("由 AMB_MAGPIE_BASE_URL 指定", g.url)}>
        <${State} map=${GATEWAY} s=${g.state} />
      <//>
      ${!st.agent?.available && html`<${Row} id="agent" name="代理进程" sub=${st.agent?.enabled ? "找不到代理运行时（DSH），机器人只能纯对话" : "代理模式已关闭，机器人只做纯对话"}><${State} map=${HOST} s="error" /><//>`}
      ${st.agent?.available && !hosts.length && html`<${Row} id="agent" name="代理进程" sub="收到第一条消息时启动"><${State} map=${HOST} s="stopped" /><//>`}
      ${hosts.map(([id, h]) => html`<${Row} key=${id} id=${`agent-${id}`} name=${hosts.length > 1 ? `代理进程 · ${botName(id)}` : "代理进程"}
        sub=${hostSub(h)}>
        <${State} map=${HOST} s=${h.state} />
      <//>`)}
      ${tail.length > 0 && html`<div class="row-edit ts-tail"><span class="t-label">代理进程输出（stderr 最后 ${tail.length} 行）</span><pre class="ts-mono">${tail.join("\n")}</pre></div>`}
      <${PwshRows} ps=${st.pwsh} busy=${busy} onRecheck=${recheckPs} />
      <${Row} id="version" name="版本" sub=${join(st.os, st.electron && `Electron ${st.electron}`, `Node ${st.node}`)}>
        <span class="val">${st.version} · ${st.platform} ${st.arch}</span>
      <//>
      <${Row} id="data-dir" name="数据目录">
        <span class="val" title=${st.dataDir}>${st.dataDir}</span><${CopyButton} text=${st.dataDir} label="复制路径" />
        ${desktop && html`<button type="button" class="text" onClick=${() => api("/desktop/open-data-dir", { method: "POST", body: {} }).catch(failed)}>打开</button>`}
      <//>
      <${Row} id="log-file" name="日志文件" sub="按大小轮转，保留最近 4 个文件">
        <span class="val" title=${st.logFile || ""}>${st.logFile || "未启用"}</span>${st.logFile && html`<${CopyButton} text=${st.logFile} label="复制路径" />`}
      <//>
    </div>

    <div class="set-part">检测</div>
    <div class="list">
      <${Row} id="test-model" name="测试模型" sub="发一个最小请求：经内置网关、直连端点各一次，对比两边的状态码、耗时与回显的模型名">
        <${Button} size="sm" loading=${busy === "model"} disabled=${!!busy} onClick=${testModel}>测试<//>
      <//>
      ${modelRes && html`
        <${Row} compact name=${modelRes.verdict} sub=${`模型 ${modelRes.model || "（无）"}`}>
          <${Verdict} ok=${modelRes.direct.ok && (modelRes.gateway.ok || !!modelRes.gateway.skipped)} />
        <//>
        <${ProbeRow} name="经内置网关" p=${modelRes.gateway} />
        <${ProbeRow} name="直连端点" p=${modelRes.direct} />`}
      <${Row} id="test-agent" name="测试代理" sub="让代理进程完整跑一轮最小对话（不进聊天记录），看卡在哪一步：启动 → 插件 → 模型 → 回复">
        <${Button} size="sm" loading=${busy === "agent"} disabled=${!!busy} onClick=${testAgent}>测试<//>
      <//>
      ${agentRes && html`
        <${Row} compact name=${agentRes.ok ? "代理正常" : `卡在：${(agentRes.stages.find((s) => s.id === agentRes.stuckAt) || {}).label || "未知"}`}
          sub=${join(`机器人 ${botName(agentRes.botId)}`, agentRes.model && `模型 ${agentRes.model}`, `共 ${ms(agentRes.ms)}`)}>
          <${Verdict} ok=${agentRes.ok} />
        <//>
        ${agentRes.stages.map((s) => html`<${Row} compact key=${s.id} name=${s.label} sub=${s.detail} mono=${s.status === "fail" || s.status === "timeout"}>
          <${State} map=${STAGE} s=${s.status} />${s.ms !== undefined && html`<span class="val num">${ms(s.ms)}</span>`}
        <//>`)}`}
      <${Row} id="restart-agent" name="重启代理进程" sub="回复一直转圈时用：结束代理进程并清掉重试等待，下一条消息重新启动">
        <${Button} size="sm" loading=${busy === "restart"} disabled=${!!busy} onClick=${restart}>重启<//>
      <//>
    </div>

    <div class="set-part ts-log-head">
      <span>最近日志</span><span class="t-meta">${logs ? `${logs.lines.length} 行` : ""}</span><span class="grow"></span>
      <button type="button" class="text" onClick=${loadLogs}><${Icon} name="refresh" size=${13} /> 刷新</button>
      <${Button} size="sm" icon="copy" loading=${busy === "copy"} disabled=${!!busy && busy !== "copy"} onClick=${copy}>复制诊断信息<//>
    </div>
    <pre class="ts-log" ref=${logRef} tabindex="0" aria-label="最近日志">${logs ? logs.lines.join("\n") || "（还没有日志）" : "加载中…"}</pre>
    <p class="ts-note">复制的诊断信息包含上面的状态、最近一次测试结果和日志，API Key、令牌等已替换成 ***，可以直接发给支持人员。</p>
  `;
}
