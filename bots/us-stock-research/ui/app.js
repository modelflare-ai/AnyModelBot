// 研究工作区：面板中用记录选择器，展开后显示记录列表；报告先读结论、数字和趋势，再展开原始数据。
// 时间线和完整报告从这次研究的文件读（脚本写的 tools.jsonl、Bot 写的 report.md）；示例数据没有这些文件，退回 state 里的 calls 和 preview。
// 选哪一条、看哪一页是界面本地状态，不用走模型。正在研究、还没有报告时默认看研究过程，有报告后看报告。
import { Workspace, html, mount, useBot, useEffect, useState, Button, Empty, Meter } from "/amb/botapp/kit/kit.js";
import { parseBlocks, parseInline, parseTrace } from "./md.js";
import { Charts, Kpis, chartsFrom } from "./chart.js";

const ACTIVE = new Set(["planning", "running", "validating"]);
const POLL_MS = 2500;

const stalled = (bot, status) => ACTIVE.has(status) && !bot.busy && !bot.sample;
const statusText = (bot, status) => (stalled(bot, status) ? bot.t("status.stalled") : bot.t(`status.${status}`));
const statusTone = (bot, status) => (status === "done" ? "ok" : status === "error" || stalled(bot, status) ? "err" : "warn");

function dateOf(iso, lang) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(lang, { month: "short", day: "numeric" });
}

const readText = async (bot, path) => {
  try {
    const file = await bot.readFile(path);
    return typeof file?.text === "string" ? file.text : null;
  } catch {
    return null;
  }
};

/** 读这次研究的文件。Bot 工作时定时刷新，时间线才能实时更新且不用多花一轮模型 */
function useRunFiles(bot, run) {
  const [files, setFiles] = useState({ id: null, report: null, trace: null });
  const id = run?.id;
  const stamp = `${run?.status}|${run?.updatedAt}`;
  useEffect(() => {
    if (!id || bot.sample) return undefined;
    let alive = true;
    const load = async () => {
      const [report, trace] = await Promise.all([readText(bot, `app/reports/${id}/report.md`), readText(bot, `app/reports/${id}/tools.jsonl`)]);
      if (alive) setFiles({ id, report, trace });
    };
    void load();
    const timer = bot.busy ? setInterval(load, POLL_MS) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [id, stamp, bot.busy, bot.sample]);
  return files.id === id ? files : { report: null, trace: null };
}

const Inline = ({ text }) =>
  parseInline(text).map((part) => {
    if (part.type === "code") return html`<code>${part.text}</code>`;
    if (part.type === "strong") return html`<strong>${part.text}</strong>`;
    if (part.type === "em") return html`<em>${part.text}</em>`;
    if (part.type === "link") return html`${part.text} <span class="t-meta md-url">${part.url}</span>`;
    return part.text;
  });

function Block({ block, t }) {
  switch (block.type) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 2, 6)}`;
      return html`<${Tag} class=${`md-h md-h${block.level}`}><${Inline} text=${block.text} /><//>`;
    }
    case "rule":
      return html`<hr class="md-rule" />`;
    case "quote":
      return html`<blockquote class="md-quote"><${Inline} text=${block.text} /></blockquote>`;
    case "code":
      return html`<pre class="md-code">${block.text}</pre>`;
    case "ul":
      return html`<ul class="md-list">${block.items.map((item) => html`<li><${Inline} text=${item} /></li>`)}</ul>`;
    case "ol":
      return html`<ol class="md-list">${block.items.map((item) => html`<li><${Inline} text=${item} /></li>`)}</ol>`;
    case "table":
      return html`<details class="us-data"><summary>${t("chart.data", { count: block.rows.length })}</summary><div class="md-scroll"><table class="md-table">
        <thead><tr>${block.head.map((cell, i) => html`<th class=${block.align[i] || ""}><${Inline} text=${cell} /></th>`)}</tr></thead>
        <tbody>${block.rows.map((row) => html`<tr>${row.map((cell, i) => html`<td class=${block.align[i] || ""}><${Inline} text=${cell} /></td>`)}</tr>`)}</tbody>
      </table></div></details>`;
    default:
      return html`<p class="md-p"><${Inline} text=${block.text} /></p>`;
  }
}

const Markdown = ({ blocks, t }) => html`<div class="md">${blocks.map((block) => html`<${Block} block=${block} t=${t} />`)}</div>`;

const METRICS = ["revenue", "grossMargin", "operatingMargin", "netIncome", "fcf", "risks"];
const PERIODS = ["3", "5", "latest"];

/**
 * 研究向导：选公司、想看的内容和时间范围，界面替你把问题写成一句话（下面看得到这句话），再发给 Bot。
 * 不知道怎么问的人照着点就行；熟悉的人直接在输入框里说，效果一样。
 */
function Wizard({ bot, onDone }) {
  const { t } = bot;
  const [company, setCompany] = useState("");
  const [compare, setCompare] = useState("");
  const [what, setWhat] = useState(["revenue", "grossMargin"]);
  const [period, setPeriod] = useState("5");
  const toggle = (k) => setWhat((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k]));
  const items = METRICS.filter((k) => what.includes(k)).map((k) => t(`mq.${k}`));
  const list = items.length > 1 ? `${items.slice(0, -1).join(t("q.join"))}${t("q.and")}${items[items.length - 1]}` : items[0] || "";
  const ready = company.trim() && items.length;
  const question = ready ? t(compare.trim() ? "q.compare" : "q.single", { company: company.trim(), compare: compare.trim(), what: list, period: t(`p.${period}`) }) : "";
  const start = (e) => {
    e.preventDefault();
    if (!question || bot.busy) return;
    bot.send(question);
    onDone?.();
  };
  return html`<form class="wiz" onSubmit=${start}>
    <div class="wiz-two">
      <label class="kit-field"><span class="t-label">${t("wiz.company")}</span><input class="field" value=${company} placeholder=${t("wiz.companyHint")} onInput=${(e) => setCompany(e.currentTarget.value)} /></label>
      <label class="kit-field"><span class="t-label">${t("wiz.compare")}</span><input class="field" value=${compare} placeholder=${t("wiz.compareHint")} onInput=${(e) => setCompare(e.currentTarget.value)} /></label>
    </div>
    <fieldset class="wiz-set"><legend class="t-label">${t("wiz.what")}</legend>
      <div class="wiz-chips">${METRICS.map((k) => html`<button type="button" key=${k} class="wiz-chip" aria-pressed=${what.includes(k)} onClick=${() => toggle(k)}>${t(`m.${k}`)}</button>`)}</div>
    </fieldset>
    <fieldset class="wiz-set"><legend class="t-label">${t("wiz.period")}</legend>
      <div class="kit-tabs" role="radiogroup">${PERIODS.map((k) => html`<button type="button" key=${k} role="radio" aria-checked=${period === k} aria-selected=${period === k} onClick=${() => setPeriod(k)}>${t(`p.${k}`)}</button>`)}</div>
    </fieldset>
    <div class="wiz-preview" aria-live="polite"><span class="t-label">${t("wiz.preview")}</span><p>${question || t("wiz.previewEmpty")}</p></div>
    <div class="cluster"><button type="submit" class="btn primary" disabled=${!question || bot.busy}>${t("wiz.start")}</button>
      ${onDone && html`<${Button} class="ghost" onClick=${onDone}>${t("wiz.cancel")}<//>`}</div>
  </form>`;
}

function RunList({ bot, runs, current, creating, onPick, onNew }) {
  return html`<nav class="kit-ws-list" aria-label=${bot.t("runs")}>
    <div class="kit-list-head"><h2 class="t-label">${bot.t("runs")}</h2><${Button} class="sm" onClick=${onNew}>${bot.t("wiz.new")}<//></div>
    ${runs.map(
      (run) => html`<button type="button" key=${run.id} class=${!creating && run.id === current?.id ? "kit-item on" : "kit-item"} aria-current=${!creating && run.id === current?.id ? "true" : undefined} onClick=${() => onPick(run.id)}>
        <span class="kit-item-title">${run.question}</span>
        <span class="kit-item-meta"><span class=${`badge ${statusTone(bot, run.status)}`}>${statusText(bot, run.status)}</span><span>${dateOf(run.updatedAt, bot.lang)}</span></span>
      </button>`,
    )}
    ${!runs.length && html`<p class="kit-foot">${bot.t("empty")}</p>`}
    <p class="kit-foot">${bot.t("scope")}</p>
  </nav>`;
}

function Plan({ bot, run }) {
  const plan = run.plan || [];
  if (!plan.length) return html`<section class="us-sec"><h2 class="t-label">${bot.t("plan")}</h2><${Empty}>${bot.t("noPlan")}<//></section>`;
  const done = plan.filter((step) => step.done).length;
  return html`<section class="us-sec">
    <h2 class="t-label">${bot.t("plan")}</h2>
    <${Meter} value=${done} max=${plan.length} label=${bot.t("progress", { done, total: plan.length })} />
    <ol class="plan">
      ${plan.map(
        (step) => html`<li class=${step.done ? "step done" : "step"}>
          <span class="step-mark" role="img" aria-label=${bot.t(step.done ? "stepDone" : "stepTodo")}>${step.done ? "✓" : "○"}</span>
          <span>${step.text}</span>
        </li>`,
      )}
    </ol>
  </section>`;
}

function Timeline({ bot, calls }) {
  return html`<section class="us-sec">
    <h2 class="t-label">${bot.t("calls")}</h2>
    ${calls.length
      ? html`<ol class="calls">
          ${calls.map(
            (call) => html`<li class="call">
              <span class="call-tool">${call.tool}</span>
              <span class="call-main">
                <span class="call-target" title=${call.target}>${call.target}</span>
                ${call.url && call.url !== call.target && html`<span class="call-url" title=${call.url}>${call.url}</span>`}
              </span>
              <span class="call-state">${call.status >= 300 || call.status === 0 ? html`<span class="badge err">${bot.t("callFailed", { status: call.status })}</span>` : call.cached ? bot.t("callCached") : ""}</span>
            </li>`,
          )}
        </ol>`
      : html`<${Empty}>${bot.t("noCalls")}<//>`}
  </section>`;
}

function Limitations({ bot, run }) {
  if (!run.limitations?.length) return null;
  return html`<section class="us-sec">
    <h2 class="t-label">${bot.t("limitations")}</h2>
    <ul class="md-list">${run.limitations.map((text) => html`<li>${text}</li>`)}</ul>
  </section>`;
}

function Report({ bot, run, report }) {
  const text = report ?? run.preview;
  if (!text) return html`<${Empty}>${bot.t("noReport")}<//>`;
  const blocks = parseBlocks(text);
  const charts = chartsFrom(blocks, bot.lang);
  const tableAt = blocks.findIndex((b) => b.type === "table");
  let split = tableAt;
  while (split > 0 && blocks[split - 1].type !== "heading") split--;
  if (split > 0) split--;
  const lead = charts && split > 0 ? blocks.slice(0, split) : [];
  const rest = lead.length ? blocks.slice(split) : blocks;
  return html`<article class="us-report">
    ${lead.length > 0 && html`<div class="us-summary"><${Markdown} blocks=${lead} t=${bot.t} /></div>`}
    ${charts && html`<${Kpis} data=${charts} t=${bot.t} lang=${bot.lang} /><${Charts} data=${charts} lang=${bot.lang} t=${bot.t} />`}
    <${Markdown} blocks=${rest} t=${bot.t} />
    ${report && html`<p class="kit-foot md-url">${bot.t("reportFile", { path: `app/reports/${run.id}/report.md` })}</p>`}
  </article>`;
}

function RunView({ bot, run, files }) {
  const [tab, setTab] = useState(null);
  const trace = parseTrace(files.trace);
  const calls = trace.length ? trace : run.calls || [];
  const hasReport = !!(files.report ?? run.preview);
  const shown = tab || (hasReport || !ACTIVE.has(run.status) ? "report" : "process");
  const plan = run.plan || [];
  const done = plan.filter((s) => s.done).length;
  const meta = [statusText(bot, run.status), plan.length && run.status !== "done" ? bot.t("progress", { done, total: plan.length }) : "", dateOf(run.updatedAt, bot.lang)].filter(Boolean).join(" · ");
  const tabs = [["report", bot.t("report")], ["process", bot.t("process")]];
  return html`<main class="kit-ws-main">
    <header class="kit-bar">
      <div class="kit-bar-text"><h1 title=${run.question}>${run.question}</h1><p>${meta}</p></div>
      ${bot.busy && ACTIVE.has(run.status) && html`<div class="kit-bar-actions"><${Button} onClick=${() => bot.stop()}>${bot.t("stop")}<//></div>`}
    </header>
    <div class="kit-ws-body">
      <div class="kit-tabs" role="tablist">
        ${tabs.map(([id, label]) => html`<button type="button" key=${id} role="tab" aria-selected=${shown === id} onClick=${() => setTab(id)}>${label}</button>`)}
      </div>
      ${shown === "report"
        ? html`<${Report} bot=${bot} run=${run} report=${files.report} />`
        : html`<div class="us-process"><${Plan} bot=${bot} run=${run} /><${Limitations} bot=${bot} run=${run} /><${Timeline} bot=${bot} calls=${calls} /></div>`}
      <p class="kit-foot">${bot.t("notice")}</p>
    </div>
  </main>`;
}

function NewView({ bot, onDone }) {
  return html`<main class="kit-ws-main">
    <header class="kit-bar"><div class="kit-bar-text"><h1>${bot.t("wiz.title")}</h1><p>${bot.t("scope")}</p></div></header>
    <div class="kit-ws-body"><${Wizard} bot=${bot} onDone=${onDone} /><p class="kit-foot">${bot.t("notice")}</p></div>
  </main>`;
}

function App() {
  const bot = useBot();
  const [picked, setPicked] = useState(null);
  const [creating, setCreating] = useState(false);
  const runs = bot.state?.runs || [];
  const newest = runs[0]?.id;
  // 新研究开始时跳到它
  useEffect(() => {
    setPicked(null);
    setCreating(false);
  }, [newest]);
  const run = runs.find((r) => r.id === picked) || runs[0];
  const files = useRunFiles(bot, run);
  if (!bot.ready) return null;
  const showNew = creating || !run;
  return html`<${Workspace} label=${bot.t("runs")} current=${showNew ? bot.t("wiz.title") : run.question}>
    <${RunList} bot=${bot} runs=${runs} current=${run} creating=${showNew} onPick=${(id) => { setPicked(id); setCreating(false); }} onNew=${() => setCreating(true)} />
    ${showNew
      ? html`<${NewView} bot=${bot} onDone=${run ? () => setCreating(false) : null} />`
      : html`<${RunView} key=${run.id} bot=${bot} run=${run} files=${files} />`}
  <//>`;
}

mount(App);
