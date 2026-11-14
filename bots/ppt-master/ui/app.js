// PPT 大师的桌面工作区：左边是项目（顶上"上传文档"），右边是选中的项目——工具栏（名称、页数 | 打开导出的 PPTX）+
// 要你处理的卡片（选好的文件怎么用、待确认的方案）+ 进度 + 幻灯片查看器（大图 + 缩略图，像演示软件那样翻页）+ 导出文件。
// 数据都来自 app/state.json，改数据都交给 Bot。
import { Workspace, html, mount, useBot, useEffect, useRef, useState, Card, Row, Button, Field, Notice, Empty, Meter } from "/amb/botapp/kit/kit.js";

const ACCEPT = ".pdf,.docx,.doc,.md,.txt,.html,.htm,.epub,.ipynb,.xlsx,.xlsm,.pptx,.png,.jpg,.jpeg,.webp";
const RUNNING = new Set(["routed", "guard", "importing", "authoring", "finalizing", "exporting"]);

/** 这条路线会经过哪些阶段 */
function stepsOf(job) {
  if (job.route === "edit_native") return ["importing", "spec_pending", "authoring", "exporting", "done"];
  if (job.route === "create_template" || job.profile === "quick") return ["importing", "authoring", "exporting", "done"];
  return ["importing", "spec_pending", "authoring", "finalizing", "exporting", "done"];
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 一页预览。示例项目的图在界面包里（sample/…），其余的进入视野才从工作区读 */
function PageImage({ bot, page, large, on, onClick }) {
  const bundled = page.path.startsWith("sample/");
  const [src, setSrc] = useState(bundled ? `./${page.path}` : "");
  const [missing, setMissing] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (bundled) return undefined;
    let alive = true;
    setMissing(false);
    const load = () =>
      bot
        .readImage(page.path)
        .then((r) => {
          if (!alive) return;
          if (r?.url) setSrc(r.url);
          else setMissing(true);
        })
        .catch(() => alive && setMissing(true));
    if (large || !box.current || typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        alive = false;
      };
    }
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        load();
      }
    });
    seen.observe(box.current);
    return () => {
      alive = false;
      seen.disconnect();
    };
  }, [page.path, page.mtime, large]);
  return html`<button type="button" ref=${box} class=${`ppt-page${large ? " large" : ""}${on ? " on" : ""}`} title=${page.name} aria-current=${on ? "true" : undefined} onClick=${onClick}>
    ${src && !missing ? html`<img src=${src} alt=${page.name} onError=${() => setMissing(true)} />` : html`<span class="t-meta">${missing ? bot.t("previews.unreadable") : page.name}</span>`}
  </button>`;
}

function JobCard({ bot, job }) {
  const steps = stepsOf(job);
  const now = steps.indexOf(job.phase);
  const stalled = RUNNING.has(job.phase) && !bot.busy && !job.background && !job.sample && !bot.sample;
  const route = job.route === "generate" ? `${bot.t("route.generate")} · ${bot.t(`profile.${job.profile || "default"}`)}` : bot.t(`route.${job.route}`);
  return html`<${Card}>
    <div class="ppt-job-head">
      <span class="ppt-strong">${route}</span>
      <span class=${`t-meta${job.phase === "error" ? " tone-danger" : ""}`}>${job.background && RUNNING.has(job.phase) ? bot.t("job.background") : bot.t(`phase.${job.phase}`)}</span>
    </div>
    ${now >= 0 && html`<ol class="ppt-steps">${steps.map((s, i) => html`<li key=${s} class=${i < now || job.phase === "done" ? "past" : i === now ? "now" : ""} aria-current=${i === now ? "step" : undefined}>${bot.t(`phase.${s}`)}</li>`)}</ol>`}
    ${job.total > 0 && job.phase === "authoring" && html`<div class="ppt-progress"><${Meter} value=${job.done || 0} max=${job.total} label=${bot.t("job.pages", { done: job.done || 0, total: job.total })} /><span class="t-meta">${bot.t("job.pages", { done: job.done || 0, total: job.total })}</span></div>`}
    ${job.message && html`<p class="ppt-text">${job.message}</p>`}
    ${(job.warnings || []).map((w) => html`<p class="ppt-text t-meta" key=${w}>${w}</p>`)}
    ${bot.busy && RUNNING.has(job.phase) && html`<${Row}><${Button} onClick=${() => bot.stop()}>${bot.t("job.stop")}<//><//>`}
    ${stalled && html`<p class="ppt-text t-meta">${bot.t("job.stalled")}</p><${Row}><${Button} onClick=${() => bot.send(bot.t("job.resumeMsg"), { type: "resume", projectId: job.projectId })}>${bot.t("job.resume")}<//><//>`}
  <//>`;
}

/** 需要用户确认的方案：确认之前 Bot 不会往下走 */
function SpecCard({ bot, spec, projectId }) {
  const recommended = (spec.choices || []).find((c) => c.recommended)?.id ?? spec.choices?.[0]?.id;
  const [choice, setChoice] = useState(recommended);
  const [note, setNote] = useState("");
  useEffect(() => setChoice(recommended), [spec.stage, spec.title]);
  const confirm = () => bot.send(bot.t("spec.confirmMsg"), { type: "confirm_spec", stage: spec.stage, projectId, ...(choice ? { choice } : {}) });
  const revise = () => {
    const text = note.trim();
    if (!text) return;
    setNote("");
    bot.send(text, { type: "revise_spec", stage: spec.stage, projectId });
  };
  return html`<${Card} on=${true} class="ppt-spec">
    <span class="t-label">${bot.t(`spec.${spec.stage}`)}</span>
    <h2 class="t-heading ppt-heading">${spec.title}</h2>
    <p class="ppt-text">${spec.summary}</p>
    ${spec.fields?.length > 0 && html`<dl class="ppt-fields">${spec.fields.map((f) => html`<div key=${f.label}><dt class="t-meta">${f.label}</dt><dd>${f.value}</dd></div>`)}</dl>`}
    ${spec.choices?.length > 0 && html`<div class="ppt-choices" role="radiogroup">${spec.choices.map((c) => html`<label key=${c.id} class=${`ppt-choice${choice === c.id ? " on" : ""}`}>
      <input type="radio" name="ppt-spec-choice" checked=${choice === c.id} onChange=${() => setChoice(c.id)} />
      <span><span class="ppt-strong">${c.label}</span>${c.recommended && html`<span class="t-meta"> · ${bot.t("spec.recommended")}</span>`}${c.description && html`<span class="t-meta ppt-block">${c.description}</span>`}</span>
    </label>`)}</div>`}
    <${Row}><${Button} primary disabled=${bot.busy} onClick=${confirm}>${bot.t("spec.confirm")}<//><//>
    <div class="ppt-revise">
      <${Field} label=${bot.t("spec.reviseLabel")} placeholder=${bot.t("spec.revisePlaceholder")} value=${note} onInput=${(e) => setNote(e.target.value)} />
      <${Button} disabled=${bot.busy || !note.trim()} onClick=${revise}>${bot.t("spec.revise")}<//>
    </div>
  <//>`;
}

/** 选好文件之后问一句怎么用。这一步不调模型，点了才开始 */
function PickedCard({ bot, files, onClear }) {
  const paths = files.map((f) => f.path);
  const pptx = files.length === 1 && /\.pptx$/i.test(files[0].name);
  const start = (key, action) => {
    onClear();
    bot.send(bot.t(`start.${key}Msg`), { type: "start", files: paths, ...action });
  };
  const options = pptx
    ? [["edit", { route: "edit_native" }], ["beautify", { route: "generate", profile: "beautify" }], ["template", { route: "create_template" }]]
    : [["quick", { route: "generate", profile: "quick" }], ["default", { route: "generate", profile: "default" }], ["template", { route: "create_template" }]];
  return html`<${Card}>
    <span class="t-label">${bot.t("picked.title")}</span>
    <p class="ppt-text">${files.map((f) => f.name).join("、")}</p>
    <${Row}>
      ${options.map(([key, action], i) => html`<${Button} key=${key} primary=${i === 0} disabled=${bot.busy} onClick=${() => start(key, action)}>${bot.t(`start.${key}`)}<//>`)}
      <${Button} onClick=${onClear}>${bot.t("picked.clear")}<//>
    <//>
  <//>`;
}

function Exports({ bot, project, onError }) {
  const list = project?.exports || [];
  const open = (path, reveal) => bot.openFile(path, { reveal }).catch(() => onError(bot.t("exports.failed")));
  if (!list.length) return html`<${Empty}>${bot.t("exports.empty")}<//>`;
  return html`<div class="ppt-exports">
    ${list.map((f) => html`<div class="ppt-export" key=${f.path}>
      <span class="ppt-export-text"><span class="truncate ppt-strong" title=${f.name}>${f.name}</span>
        <span class="t-meta">${[bot.t(`exports.kind.${f.kind || "standard"}`), f.slides ? bot.t("project.pages", { n: f.slides }) : "", f.size ? fmtSize(f.size) : ""].filter(Boolean).join(" · ")}</span></span>
      ${project.sample
        ? html`<span class="t-meta">${bot.t("exports.sample")}</span>`
        : html`<${Row}>
            <${Button} class="sm" onClick=${() => open(f.path, false)}>${bot.t(bot.desktop ? "exports.open" : "exports.download")}<//>
            ${bot.desktop && html`<${Button} class="sm ghost" onClick=${() => open(f.path, true)}>${bot.t("exports.reveal")}<//>`}
          <//>`}
    </div>`)}
  </div>`;
}

/** 放映：盖满整个界面的深色底，一页一屏；→ / 空格 / 点击下一页，← 上一页，Esc 退出。做完先在这里过一遍 */
function Show({ bot, previews, start, onClose }) {
  const [i, setI] = useState(start);
  const box = useRef(null);
  useEffect(() => box.current?.focus(), []);
  const last = previews.length - 1;
  const go = (d) => setI((x) => Math.max(0, Math.min(last, x + d)));
  const onKey = (e) => {
    if (["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(e.key)) (e.preventDefault(), go(1));
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) (e.preventDefault(), go(-1));
    else if (e.key === "Home") (e.preventDefault(), setI(0));
    else if (e.key === "End") (e.preventDefault(), setI(last));
    else if (e.key === "Escape") (e.preventDefault(), onClose());
  };
  return html`<div class="ppt-show" role="dialog" aria-modal="true" aria-label=${bot.t("show.title")} tabindex="-1" ref=${box} onKeyDown=${onKey}>
    <${PageImage} key=${`show:${previews[i].path}`} bot=${bot} page=${previews[i]} large=${true} onClick=${() => (i === last ? onClose() : go(1))} />
    <div class="ppt-show-bar">
      <span class="ppt-count">${bot.t("previews.at", { n: i + 1, total: previews.length })}</span>
      <span class="ppt-show-hint">${bot.t("show.hint")}</span>
      <button type="button" class="btn sm ppt-show-exit" onClick=${onClose}>${bot.t("show.exit")}</button>
    </div>
  </div>`;
}

/** 幻灯片查看器：选中的一页大图（限高，左右键翻页）+ 下面一排缩略图；"放映"从这一页开始 */
function Slides({ bot, project }) {
  const previews = project?.previews || [];
  const [at, setAt] = useState(0);
  const [showing, setShowing] = useState(false);
  useEffect(() => setAt(0), [project?.id]);
  if (!previews.length) return html`<${Empty}>${bot.t("previews.empty")}<//>`;
  const i = Math.min(at, previews.length - 1);
  const page = previews[i];
  const go = (d) => setAt((x) => Math.max(0, Math.min(previews.length - 1, x + d)));
  const onKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), go(1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), go(-1));
  };
  return html`<section class="ppt-viewer" aria-label=${project?.previewsDraft ? bot.t("previews.draft") : bot.t("previews.title")} onKeyDown=${onKey}>
    <div class="ppt-stage">
      <${PageImage} key=${`large:${page.path}`} bot=${bot} page=${page} large=${true} onClick=${() => go(1)} />
    </div>
    <div class="ppt-pager">
      <${Button} class="sm ghost" disabled=${i === 0} onClick=${() => go(-1)}>${bot.t("previews.prev")}<//>
      <span class="t-meta ppt-count">${bot.t("previews.at", { n: i + 1, total: previews.length })}${project?.previewsDraft ? ` · ${bot.t("previews.draftShort")}` : ""}</span>
      <${Button} class="sm ghost" disabled=${i === previews.length - 1} onClick=${() => go(1)}>${bot.t("previews.next")}<//>
      <${Button} class="sm" onClick=${() => setShowing(true)}>${bot.t("show.start")}<//>
    </div>
    <div class="ppt-strip">${previews.map((p, n) => html`<${PageImage} key=${p.path} bot=${bot} page=${p} on=${n === i} onClick=${() => setAt(n)} />`)}</div>
    ${showing && html`<${Show} bot=${bot} previews=${previews} start=${i} onClose=${() => setShowing(false)} />`}
  </section>`;
}

const SIZES = ["5", "8", "12"];
const USES = ["launch", "report", "training", "review"];

/**
 * 新建：两条路。没有文档的，写一句主题、点选用途和页数，界面把要求写成一句话发给 Bot（下面看得到这句话）；
 * 有文档的，直接上传。先看方案还是直接生成也在这里选，第一次用的人不用知道 Bot 能听懂哪些说法。
 */
function NewDeck({ bot, onPick, onDone }) {
  const { t } = bot;
  const [topic, setTopic] = useState("");
  const [size, setSize] = useState("8");
  const [use, setUse] = useState("launch");
  const [plan, setPlan] = useState(true);
  const message = topic.trim() ? t(plan ? "new.qPlan" : "new.qQuick", { n: size, use: t(`use.${use}`), topic: topic.trim() }) : "";
  const start = (e) => {
    e.preventDefault();
    if (!message || bot.busy) return;
    bot.send(message);
    onDone?.();
  };
  return html`<div class="ppt-new">
    <form class="ppt-new-form" onSubmit=${start}>
      <h2 class="t-label">${t("new.fromTopic")}</h2>
      <${Field} label=${t("new.topic")} placeholder=${t("new.topicHint")} value=${topic} onInput=${(e) => setTopic(e.target.value)} />
      <fieldset class="ppt-set"><legend class="t-label">${t("new.use")}</legend>
        <div class="ppt-chips">${USES.map((k) => html`<button type="button" key=${k} class="ppt-chip" aria-pressed=${use === k} onClick=${() => setUse(k)}>${t(`use.${k}`)}</button>`)}</div></fieldset>
      <div class="ppt-sets">
        <fieldset class="ppt-set"><legend class="t-label">${t("new.size")}</legend>
          <div class="kit-tabs" role="radiogroup">${SIZES.map((k) => html`<button type="button" key=${k} role="radio" aria-checked=${size === k} aria-selected=${size === k} onClick=${() => setSize(k)}>${t("project.pages", { n: k })}</button>`)}</div></fieldset>
        <fieldset class="ppt-set"><legend class="t-label">${t("new.mode")}</legend>
          <div class="kit-tabs" role="radiogroup">${[[true, "new.plan"], [false, "new.quick"]].map(([v, key]) => html`<button type="button" key=${key} role="radio" aria-checked=${plan === v} aria-selected=${plan === v} onClick=${() => setPlan(v)}>${t(key)}</button>`)}</div></fieldset>
      </div>
      <div class="ppt-preview" aria-live="polite"><span class="t-label">${t("new.preview")}</span><p>${message || t("new.previewEmpty")}</p></div>
      <div class="cluster"><button type="submit" class="btn primary" disabled=${!message || bot.busy}>${t("new.start")}</button>
        ${onDone && html`<${Button} class="ghost" onClick=${onDone}>${t("picked.clear")}<//>`}</div>
    </form>
    <section class="ppt-new-doc">
      <h2 class="t-label">${t("new.fromDoc")}</h2>
      <p class="ppt-text t-meta">${t("new.docHint")}</p>
      <${Button} onClick=${onPick}>${t("upload")}<//>
    </section>
  </div>`;
}

function App() {
  const bot = useBot();
  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const activeId = bot.state?.activeProjectId;
  // Bot 开始做新项目时跟过去
  useEffect(() => {
    setSelected(null);
    setCreating(false);
  }, [activeId]);
  if (!bot.ready) return null;

  const state = bot.state || {};
  const projects = state.projects || [];
  const project = projects.find((p) => p.id === selected) ?? projects.find((p) => p.id === activeId) ?? projects[0];
  const job = state.job && (state.job.projectId === project?.id || RUNNING.has(state.job.phase)) ? state.job : null;
  // 做完了、没什么要说的任务不再占一块：进度只在进行中、出错或有提醒时出现
  const showJob = !!job && (job.phase !== "done" || !!job.message || job.warnings?.length > 0);
  const runtime = state.runtime;
  const latest = project?.exports?.[0];
  const showNew = creating || !project;

  const pick = async () => {
    setError("");
    try {
      const files = await bot.pickFile({ accept: ACCEPT, multiple: true });
      if (files?.length) {
        setPicked(files);
        setCreating(false);
      }
    } catch {
      setError(bot.t("picked.failed"));
    }
  };
  const open = (path, reveal) => bot.openFile(path, { reveal }).catch(() => setError(bot.t("exports.failed")));

  return html`<${Workspace} label=${bot.t("project.title")} current=${showNew ? bot.t("new.title") : project.name}>
    <nav class="kit-ws-list" aria-label=${bot.t("project.title")}>
      <div class="kit-list-head"><h2 class="t-label">${bot.t("project.title")}</h2><${Button} class="sm" onClick=${() => setCreating(true)}>${bot.t("new.button")}<//></div>
      ${projects.map((p) => html`<button type="button" key=${p.id} class=${`kit-item${!showNew && p.id === project?.id ? " on" : ""}`} aria-current=${!showNew && p.id === project?.id ? "true" : undefined} onClick=${() => { setSelected(p.id); setCreating(false); }}>
        <span class="kit-item-title">${p.name}</span>
        <span class="kit-item-meta"><span>${[bot.t(`kind.${p.kind}`), p.pages ? bot.t("project.pages", { n: p.pages }) : ""].filter(Boolean).join(" · ")}</span></span>
      </button>`)}
      ${!projects.length && html`<p class="kit-foot">${bot.t("project.none")}</p>`}
    </nav>
    <main class="kit-ws-main">
      ${showNew && html`<header class="kit-bar"><div class="kit-bar-text"><h1>${bot.t("new.title")}</h1><p>${bot.t("sub")}</p></div></header>`}
      ${!showNew && project && html`<header class="kit-bar">
        <div class="kit-bar-text"><h1>${project.name}</h1><p>${[bot.t(`kind.${project.kind}`), project.pages ? bot.t("project.pages", { n: project.pages }) : "", job ? bot.t(`phase.${job.phase}`) : ""].filter(Boolean).join(" · ")}</p></div>
        <div class="kit-bar-actions">
          ${bot.busy && job && RUNNING.has(job.phase) && html`<${Button} onClick=${() => bot.stop()}>${bot.t("job.stop")}<//>`}
          ${latest && !project.sample && bot.desktop && html`<${Button} class="ghost" onClick=${() => open(latest.path, true)}>${bot.t("exports.reveal")}<//>`}
          ${latest && html`<${Button} primary disabled=${!!project.sample} title=${project.sample ? bot.t("exports.sample") : latest.name} onClick=${() => open(latest.path, false)}>${bot.t(bot.desktop ? "exports.openPptx" : "exports.download")}<//>`}
        </div>
      </header>`}
      <div class="kit-ws-body">
        ${runtime && runtime.ready === false && html`<${Notice}>
          <div class="ppt-notice"><span>${bot.t(`runtime.${runtime.problem || "not_installed"}`)}</span>
          ${runtime.problem !== "guard" && html`<${Button} disabled=${bot.busy} onClick=${() => bot.send(bot.t("runtime.recheckMsg"), { type: "recheck" })}>${bot.t("runtime.recheck")}<//>`}</div>
        <//>`}
        ${error && html`<${Notice}>${error}<//>`}
        ${picked.length > 0 && html`<${PickedCard} bot=${bot} files=${picked} onClear=${() => setPicked([])} />`}
        ${state.pendingSpec && html`<${SpecCard} bot=${bot} spec=${state.pendingSpec} projectId=${state.job?.projectId || project?.id || ""} />`}
        ${showJob && html`<${JobCard} bot=${bot} job=${job} />`}
        ${showNew
          ? !picked.length && html`<${NewDeck} bot=${bot} onPick=${pick} onDone=${project ? () => setCreating(false) : null} />`
          : html`<${Slides} bot=${bot} project=${project} />
            <section class="ppt-sec"><h2 class="t-label">${bot.t("exports.title")}</h2><${Exports} bot=${bot} project=${project} onError=${setError} /></section>`}
      </div>
    </main>
  <//>`;
}

mount(App);
