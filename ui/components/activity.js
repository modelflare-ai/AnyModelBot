// 代理活动明细：回复上方那一行（"思考中 / 用时"）可以展开，默认折叠。展开后是这一轮的步骤——
// 模型请求、工具调用、重试、子代理、压缩上下文——每步一行：状态点 + 名称 + 等宽摘要 + 用时；
// 有参数或输出的步骤再点开看全文。对话页实时显示，信息面板里看微信 / 飞书会话的历史与正在处理的回合。
import { useEffect, useState } from "preact/hooks";
import { html, Icon } from "./ui.js";
import { fmtDur } from "../lib/format.js";

const KIND_ICON = { model: "spark", tool: "code", retry: "refresh", subagent: "chat", compact: "database", error: "alert", job: "clock", steer: "chat" };
const DOT = { ok: "ok", error: "err", running: "warn" };

/** 步骤用时：不到 1 秒显示一位小数 */
const stepDur = (ms) => (ms < 100 ? "<0.1 秒" : ms < 1000 ? `${(ms / 1000).toFixed(1)} 秒` : fmtDur(ms));
const kTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** 正在进行的那一步，用在工作状态行上："运行 bash" / "等待 grok-4.7 回复" */
export function currentStep(steps) {
  const s = (steps || []).findLast((x) => x.status === "running");
  if (!s) return "";
  if (s.kind === "model") return `等待 ${s.title} 回复`;
  if (s.kind === "tool") return `运行 ${s.title}`;
  if (s.kind === "subagent") return "子代理在工作";
  if (s.kind === "compact") return "压缩上下文";
  if (s.kind === "job") return "后台命令在运行";
  return s.title;
}

/** 按 id 新增或覆盖一步（SSE 的 activity 事件） */
export function upsertStep(steps, step) {
  const list = steps || [];
  const i = list.findIndex((s) => s.id === step.id);
  return i < 0 ? [...list, step] : [...list.slice(0, i), step, ...list.slice(i + 1)];
}

/** 有步骤在进行时每秒刷新一次（用时跟着走） */
export function useNow(on) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function Step({ s, now }) {
  const [open, setOpen] = useState(false);
  const more = !!(s.input || s.output || s.tokens);
  const ms = s.status === "running" ? now - s.at : s.ms;
  const head = html`<span class=${`dot ${DOT[s.status] || ""}`} aria-hidden="true"></span>
    <${Icon} name=${KIND_ICON[s.kind] || "info"} size=${14} class="k" />
    <span class="t">${s.kind === "model" && (s.status === "running" || s.cut) ? `等待 ${s.title} 回复` : s.title}</span>
    ${s.summary && html`<span class="s">${s.summary}</span>`}
    <span class="grow"></span>
    ${ms != null && html`<span class=${`d num${s.status === "running" ? " shimmer" : ""}`}>${stepDur(ms)}</span>`}
    ${more && html`<${Icon} name="chevRight" size=${12} class="chev" />`}`;
  const label = `${s.status === "error" ? "失败" : s.status === "running" ? "进行中" : "完成"}：${s.title}`;
  return html`<li class=${`act-step ${s.status}${open ? " open" : ""}`}>
    ${more
      ? html`<button type="button" class="act-head" aria-expanded=${open} aria-label=${`${label}，${open ? "收起" : "展开"}详情`} onClick=${() => setOpen(!open)}>${head}</button>`
      : html`<div class="act-head" aria-label=${label}>${head}</div>`}
    ${open && html`<div class="act-body">
      ${s.tokens && html`<div class="t-label num">输入 ${kTokens(s.tokens.input || 0)} tokens · 输出 ${kTokens(s.tokens.output || 0)} tokens</div>`}
      ${s.input && html`<div class="t-label">参数</div><pre class="selectable">${s.input}</pre>`}
      ${s.output && html`<div class="t-label">${s.kind === "model" ? "回复" : "输出"}</div><pre class="selectable">${s.output}</pre>`}
    </div>`}
  </li>`;
}

/** 步骤列表（一块 --well；步骤之间一条细线） */
export function ActivityList({ steps }) {
  const now = useNow((steps || []).some((s) => s.status === "running"));
  if (!steps?.length) return html`<div class="act-list empty"><span class="hint">还没有步骤</span></div>`;
  return html`<ol class="act-list">${steps.map((s) => html`<${Step} key=${s.id} s=${s} now=${now} />`)}</ol>`;
}

/**
 * 回复上方的工作状态行，可展开成活动明细。
 * live：进行中（label 由调用方给，比如"思考中 12 秒"）；steps：已有的步骤；count + load：历史消息只知道有几步，展开时再取。
 */
export function ActivityLine({ label, live, steps, count = 0, load }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [err, setErr] = useState("");
  const list = steps || loaded;
  const n = list?.length || count;
  useEffect(() => {
    if (!open || list || !load) return;
    load().then(setLoaded, (e) => setErr(e.message));
  }, [open]);
  const text = html`<span class=${live ? "shimmer" : ""}>${label}</span>`;
  if (!n && !live) return html`<div class="work-line">${text}</div>`;
  if (!n) return html`<div class="work-line live" aria-live="off">${text}</div>`;
  return html`<div class=${`activity${open ? " open" : ""}`}>
    <button type="button" class=${`work-line toggle${live ? " live" : ""}`} aria-expanded=${open} aria-live="off" title=${open ? "收起处理过程" : "查看处理过程"} onClick=${() => setOpen(!open)}>
      ${text}<span class="steps num">${n} 步</span><${Icon} name="chevRight" size=${12} class="chev" />
    </button>
    ${open && (list ? html`<${ActivityList} steps=${list} />` : html`<div class="act-list empty"><span class="hint">${err || "加载中…"}</span></div>`)}
  </div>`;
}
