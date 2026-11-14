// 桌面工作区：左边是尽调任务（顶上"新建"），右边是选中的任务——工具栏（公司、状态、操作）+ 三页：报告、来源、流程。
// 界面只显示 app/state.json，开始、取消、导出、删除都交给 Bot（send）。选哪个任务、看哪一页只影响这个界面，不用发消息；
// 正在跑、还没有报告时默认看流程，有报告后看报告；Bot 指定了 view（report / sources）时跟着 Bot。
import { Workspace, html, mount, useBot, useEffect, useRef, useState, Button, Empty, Field, Link, Meter, Notice } from "/amb/botapp/kit/kit.js";
import { Report, parseBlocks } from "./report.js";

const RESEARCH = [["financial_analyst", "financial"], ["news_scanner", "news"], ["industry_analyst", "industry"], ["company_analyst", "company"]];
const AFTER_RESEARCH = ["collector", "curator", "enricher", "briefing", "editor"];
const ACTIVE = new Set(["pending", "grounding", "researching", "collecting", "curating", "enriching", "briefing", "editing"]);
/** 这么久没有进展，这一轮多半已经断了（回合被中止、App 重启） */
const STALE_MS = 15 * 60_000;
const NO_FORM = { company: "", url: "", industry: "", hq: "" };

const statusTone = (status) => (status === "completed" ? "ok" : status === "failed" ? "err" : status === "cancelled" ? "off" : "warn");
const nodeTone = (status) => (status === "done" ? "ok" : status === "failed" ? "err" : status === "running" ? "warn" : "off");

function timeOf(iso, lang) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * 任务的出错信息（Bot 写进 state.json 的，可能是模型服务返回的原始 JSON）：同一个错误在对话里已经有主要提示，
 * 这里只说一句"没有完成"，原文折叠起来、可以复制（复制前去掉看起来像凭据的内容），长内容不撑破双栏。
 */
const looksRaw = (s) => /[{[]\s*"/.test(s) || /\b[45]\d\d\b/.test(s) || s.length > 160;
const redact = (s) =>
  String(s)
    .replace(/\b(sk|mf|pk|rk|key)-[A-Za-z0-9_-]{8,}/g, (k) => `${k.slice(0, 3)}…${k.slice(-4)}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer …");
function JobError({ t, error }) {
  const text = String(error);
  if (!looksRaw(text)) return html`<${Notice}>${text}<//>`;
  const safe = redact(text);
  return html`<${Notice}>
    <span class="cr-error">${t("job.failedShort")}</span>
    <details class="cr-error-details"><summary>${t("job.errorDetails")}</summary><pre>${safe}</pre>
      <button type="button" class="text" onClick=${() => navigator.clipboard?.writeText(safe).catch(() => {})}>${t("job.copyDetails")}</button>
    </details>
  <//>`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 读 app/ 下的文本文件。示例数据和文件不存在时返回 null，界面用状态里的预览 */
function useAppFile(bot, path, version) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!path || bot.sample) return void setText(null);
    let alive = true;
    bot.readFile(path).then((f) => alive && setText(typeof f?.text === "string" ? f.text : null)).catch(() => alive && setText(null));
    return () => {
      alive = false;
    };
  }, [path, version, bot.sample]);
  return text;
}

function parseSources(text) {
  if (!text) return null;
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter((s) => s && typeof s.url === "string") : null;
  } catch {
    return null;
  }
}

function NewJob({ bot, onDone }) {
  const { t } = bot;
  const [form, setForm] = useState(NO_FORM);
  const field = (key) => ({ value: form[key], onInput: (e) => setForm((f) => ({ ...f, [key]: e.currentTarget.value })) });
  const start = (e) => {
    e.preventDefault();
    const company = form.company.trim();
    if (!company || bot.busy) return;
    const action = { type: "start_research", company };
    if (form.url.trim()) action.company_url = form.url.trim();
    if (form.industry.trim()) action.industry = form.industry.trim();
    if (form.hq.trim()) action.hq_location = form.hq.trim();
    bot.send(t("action.start", { company }), action);
    setForm(NO_FORM);
    onDone?.();
  };
  return html`<form class="cr-form" onSubmit=${start}>
    <${Field} label=${t("form.company")} placeholder=${t("form.companyHint")} ...${field("company")} />
    <div class="cr-form-more">
      <${Field} label=${t("form.url")} ...${field("url")} />
      <${Field} label=${t("form.industry")} ...${field("industry")} />
      <${Field} label=${t("form.hq")} ...${field("hq")} />
    </div>
    <div class="cluster"><button type="submit" class="btn primary" disabled=${bot.busy || !form.company.trim()}>${t("form.start")}</button>
      ${onDone && html`<${Button} class="ghost" onClick=${onDone}>${t("form.cancel")}<//>`}</div>
    <p class="kit-foot">${t("form.hint")}</p>
  </form>`;
}

function JobList({ bot, jobs, jobId, creating, onPick, onNew }) {
  const { t, lang } = bot;
  return html`<nav class="kit-ws-list" aria-label=${t("jobs.title")}>
    <div class="kit-list-head"><h2 class="t-label">${t("jobs.title")}</h2><${Button} class="sm" onClick=${onNew}>${t("jobs.new")}<//></div>
    ${jobs.map((job) => html`<button type="button" key=${job.id} class=${`kit-item${!creating && job.id === jobId ? " on" : ""}`} aria-current=${!creating && job.id === jobId ? "true" : undefined} onClick=${() => onPick(job.id)}>
      <span class="kit-item-title">${job.company}</span>
      <span class="kit-item-meta"><span class=${`badge ${statusTone(job.status)}`}>${t(`status.${job.status}`)}</span><span>${job.sample ? t("jobs.sample") : timeOf(job.updatedAt, lang)}</span></span>
    </button>`)}
    ${!jobs.length && html`<p class="kit-foot">${t("jobs.empty")}</p>`}
  </nav>`;
}

/** 流程图：定位 → 四路研究（每路一条横条，长度是取到的篇数）→ 汇总、策展、补洞、简报、终稿 */
function Pipeline({ bot, job }) {
  const { t } = bot;
  const counts = RESEARCH.map(([, key]) => job.docCounts?.[key] ?? 0);
  const most = Math.max(1, ...counts);
  const dot = (node) => html`<span class=${`badge ${nodeTone(job.nodes?.[node] ?? "pending")}`}>${t(`node.${node}`)}</span>`;
  return html`<section class="cr-sec" aria-label=${t("pipeline.title")}>
    <h2 class="t-label">${t("pipeline.title")}</h2>
    <ol class="cr-flow">
      <li>${dot("grounding")}</li>
      <li class="cr-lanes">
        ${RESEARCH.map(([node], i) => html`<div class="cr-lane" key=${node}>
          ${dot(node)}
          <span class="cr-bar" aria-hidden="true"><i style=${{ width: `${(counts[i] / most) * 100}%` }}></i></span>
          <span class="cr-count">${t("node.docs", { count: counts[i] })}</span>
        </div>`)}
      </li>
      ${AFTER_RESEARCH.map((node) => html`<li key=${node}>${dot(node)}${node === "curator" && job.curation ? html`<span class="t-meta">${t("pipeline.curation", { kept: job.curation.kept ?? 0, total: job.curation.total ?? 0 })}</span>` : null}</li>`)}
    </ol>
  </section>`;
}

function Timeline({ bot, entries }) {
  const { t, lang } = bot;
  if (!entries.length) return null;
  return html`<section class="cr-sec">
    <h2 class="t-label">${t("timeline.title")}</h2>
    <ul class="cr-timeline">
      ${entries.map((e, n) => html`<li key=${n}>
        <span class="cr-time">${timeOf(e.at, lang)}</span>
        <span>${e.node ? t(`node.${e.node}`) : ""}${e.status ? ` · ${t(`nodeStatus.${e.status}`)}` : ""}${e.text ? `${e.node ? ": " : ""}${e.text}` : ""}</span>
      </li>`)}
    </ul>
  </section>`;
}

/**
 * 来源：按领域筛（财务 / 新闻 / 行业 / 业务，带篇数），可以只看报告里引用了的；每条有相关度条。
 * 懂行的人拿它核对出处，第一次用的人也能看出"这份报告是从哪些地方来的"。
 */
function Sources({ bot, list, curation }) {
  const { t } = bot;
  const [domain, setDomain] = useState("");
  const [usedOnly, setUsedOnly] = useState(false);
  if (!list?.length) return html`<${Empty}>${t("sources.empty")}<//>`;
  const domains = RESEARCH.map(([, key]) => key).filter((key) => list.some((s) => s.domain === key));
  const shown = list.filter((s) => (!domain || s.domain === domain) && (!usedOnly || s.used !== false));
  return html`<div class="cr-sources">
    <div class="cr-filter">
      <div class="kit-tabs" role="tablist" aria-label=${t("sources.filter")}>
        ${[["", t("sources.all"), list.length], ...domains.map((key) => [key, t(`domain.${key}`), list.filter((s) => s.domain === key).length])].map(([key, label, n]) => html`<button type="button" key=${key} role="tab" aria-selected=${domain === key} onClick=${() => setDomain(key)}>${label} <span class="cr-n">${n}</span></button>`)}
      </div>
      <label class="cr-check"><input type="checkbox" checked=${usedOnly} onChange=${(e) => setUsedOnly(e.currentTarget.checked)} /> ${t("sources.usedOnly")}</label>
    </div>
    ${curation && html`<p class="t-meta">${t("pipeline.curation", { kept: curation.kept ?? 0, total: curation.total ?? 0 })}</p>`}
    <ul>
      ${shown.map((s) => html`<li key=${s.url} class=${s.used === false ? "unused" : ""}>
        <span class="cr-src-main">
          <${Link} href=${s.url}>${s.title || hostOf(s.url)}<//>
          <span class="t-meta">${hostOf(s.url)}${s.domain ? ` · ${t(`domain.${s.domain}`)}` : ""}${s.used === false ? ` · ${t("sources.unused")}` : ""}</span>
        </span>
        ${typeof s.score === "number" && html`<span class="cr-score" title=${t("sources.score", { score: s.score.toFixed(2) })}>
          <span class="cr-bar" aria-hidden="true"><i style=${{ width: `${Math.max(0, Math.min(1, s.score)) * 100}%` }}></i></span>
          <span class="cr-count">${s.score.toFixed(2)}</span>
        </span>`}
      </li>`)}
    </ul>
    ${!shown.length && html`<${Empty}>${t("sources.none")}<//>`}
  </div>`;
}

/** 报告目录：二级标题排成一排，点了滚到那一节。长报告不用一路往下翻 */
function Toc({ text, rootRef }) {
  const heads = parseBlocks(text).filter((b) => b.type === "heading" && b.level === 2).map((b) => b.text.replace(/\*\*/g, ""));
  if (heads.length < 3) return null;
  const go = (i) => rootRef.current?.querySelectorAll(".cr-report h3")[i]?.scrollIntoView({ block: "start", behavior: "smooth" });
  return html`<nav class="cr-toc">${heads.map((h, i) => html`<button type="button" key=${i} class="wiz-chip" onClick=${() => go(i)}>${h}</button>`)}</nav>`;
}

function Actions({ bot, job, stale }) {
  const { t } = bot;
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const active = ACTIVE.has(job.status);
  const company = job.company;
  const sendCancel = () => bot.send(t("action.cancel", { company }), { type: "cancel", jobId: job.id });
  const cancel = async () => {
    if (!bot.busy) return sendCancel();
    setCancelling(true);
    await bot.stop();
  };
  // 回合停下来之后才能发取消，否则这句话会排在正在跑的回合后面
  useEffect(() => {
    if (cancelling && !bot.busy) {
      setCancelling(false);
      sendCancel();
    }
  }, [cancelling, bot.busy]);
  useEffect(() => setConfirming(false), [job.id]);
  return html`<div class="kit-bar-actions">
    ${!active && !job.sample && (confirming
      ? html`<${Button} class="danger" disabled=${bot.busy} onClick=${() => bot.send(t("action.delete", { company }), { type: "delete_job", jobId: job.id })}>${t("action.deleteConfirm")}<//>`
      : html`<${Button} class="ghost" disabled=${bot.busy} onClick=${() => setConfirming(true)}>${t("action.deleteLabel")}<//>`)}
    ${active && html`<${Button} disabled=${cancelling} onClick=${cancel}>${t("action.cancelLabel")}<//>`}
    ${stale && html`<${Button} primary disabled=${bot.busy} onClick=${() => bot.send(t("action.resume", { company }), { type: "resume", jobId: job.id })}>${t("action.resumeLabel")}<//>`}
    ${job.status === "completed" && html`<${Button} primary=${!job.pdfPath} disabled=${bot.busy} onClick=${() => bot.send(t("action.pdf", { company }), { type: "export_pdf", jobId: job.id })}>${t(job.pdfPath ? "action.pdfAgainLabel" : "action.pdfLabel")}<//>`}
    ${job.pdfPath && html`<${Button} primary onClick=${() => bot.openFile(job.pdfPath).catch(() => {})}>${t("action.openPdf")}<//>`}
  </div>`;
}

function JobView({ bot, state, job, entries }) {
  const { t } = bot;
  const [tab, setTab] = useState(null);
  const page = useRef(null);
  // Bot 换了要看的那一页时跟着 Bot 走
  useEffect(() => setTab(null), [state.view]);
  const stale = !bot.sample && !job.sample && !bot.busy && ACTIVE.has(job.status) && Date.now() - new Date(job.updatedAt ?? 0).getTime() > STALE_MS;
  const selected = job.id === state.selectedJobId;
  const reportFile = useAppFile(bot, job.reportPath, job.updatedAt);
  const sourcesFile = useAppFile(bot, job.sourcesPath, job.updatedAt);
  const report = reportFile ?? (selected ? state.reportPreview : "");
  const sources = parseSources(sourcesFile) ?? (selected ? state.sourcesPreview : null);
  const active = ACTIVE.has(job.status);
  const shown = tab || (selected && state.view) || (report || !active ? "report" : "process");
  const tabs = [["report", t("tab.report")], ["sources", t("tab.sources")], ["process", t("tab.process")]];
  const meta = [t(`status.${job.status}`), job.industry, job.hqLocation, job.sample ? t("jobs.sampleNote") : job.track ? t(`track.${job.track}`) : ""].filter(Boolean).join(" · ");
  return html`<main class="kit-ws-main">
    <header class="kit-bar">
      <div class="kit-bar-text"><h1>${job.company}</h1><p>${meta}${job.companyUrl && html` · <${Link} href=${job.companyUrl}>${hostOf(job.companyUrl)}<//>`}</p></div>
      <${Actions} bot=${bot} job=${job} stale=${stale} />
    </header>
    <div class="kit-ws-body">
      ${active && html`<${Meter} value=${job.progress ?? 0} label=${t("pipeline.progress")} />`}
      ${job.error && html`<${JobError} t=${t} error=${job.error} />`}
      ${job.pdfError && html`<${Notice}>${t("pdf.failed", { error: job.pdfError })}<//>`}
      ${stale && html`<${Notice}>${t("job.stale")}<//>`}
      <div class="kit-tabs" role="tablist">
        ${tabs.map(([id, label]) => html`<button type="button" key=${id} role="tab" aria-selected=${shown === id} onClick=${() => setTab(id)}>${label}</button>`)}
      </div>
      <div class="cr-page" ref=${page}>
        ${shown === "report" && (report ? html`<${Toc} text=${report} rootRef=${page} /><${Report} text=${report} />` : html`<${Empty}>${t(active ? "report.running" : "report.empty")}<//>`)}
        ${shown === "sources" && html`<${Sources} bot=${bot} list=${sources} curation=${job.curation} />`}
        ${shown === "process" && html`<${Pipeline} bot=${bot} job=${job} /><${Timeline} bot=${bot} entries=${entries} />`}
      </div>
      ${job.pdfPath && html`<p class="kit-foot cr-path">${job.pdfPath}</p>`}
      <p class="kit-foot">${t("disclaimer")}</p>
    </div>
  </main>`;
}

function NewView({ bot, onDone }) {
  const { t } = bot;
  return html`<main class="kit-ws-main">
    <header class="kit-bar"><div class="kit-bar-text"><h1>${t("jobs.newTitle")}</h1><p>${t("jobs.newSub")}</p></div></header>
    <div class="kit-ws-body"><${NewJob} bot=${bot} onDone=${onDone} /><p class="kit-foot">${t("disclaimer")}</p></div>
  </main>`;
}

function App() {
  const bot = useBot();
  const state = bot.state || {};
  const jobs = state.jobs || [];
  const [picked, setPicked] = useState(null);
  const [creating, setCreating] = useState(false);
  // Bot 换了选中的任务时跟着 Bot 走（新开的尽调也会切过去）
  useEffect(() => {
    setPicked(null);
    setCreating(false);
  }, [state.selectedJobId, jobs.length]);
  if (!bot.ready) return null;
  const job = jobs.find((j) => j.id === picked) ?? jobs.find((j) => j.id === state.selectedJobId) ?? jobs[0];
  const entries = job ? (state.timeline || []).filter((e) => e.jobId === job.id).slice(-30).reverse() : [];
  const showNew = creating || !job;
  return html`<${Workspace} label=${bot.t("jobs.title")} current=${showNew ? bot.t("jobs.new") : job.company}>
    <${JobList} bot=${bot} jobs=${jobs} jobId=${job?.id} creating=${showNew} onPick=${(id) => { setPicked(id); setCreating(false); }} onNew=${() => setCreating(true)} />
    ${showNew
      ? html`<${NewView} bot=${bot} onDone=${job ? () => setCreating(false) : null} />`
      : html`<${JobView} key=${job.id} bot=${bot} state=${state} job=${job} entries=${entries} />`}
  <//>`;
}

mount(App);
