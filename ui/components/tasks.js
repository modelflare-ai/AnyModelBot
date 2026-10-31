// 后台任务（3a）：对话里请求那条消息下面的任务胶囊「后台任务 · 标题 · 进行中 ›」，点开是最新进展、每次运行折叠的处理过程和停止；
// 信息面板里一行一个任务。状态是"点 + 文字"：绿 = 进行中，黄 = 等你，红 = 失败，灰 = 已完成 / 已停止。健康时不多占地方。
import { useEffect, useState } from "preact/hooks";
import { html, Icon } from "./ui.js";
import { ActivityLine } from "./activity.js";
import { api } from "../lib/api.js";
import { failed, toast } from "../lib/store.js";
import { fmtAgo, fmtDur } from "../lib/format.js";
import { t, has } from "../lib/i18n.js";

/** 阶段 → 状态点 */
export function stageDot(stage) {
  if (!stage) return "";
  if (stage.key === "failed") return "err";
  if (stage.group === "working") return "ok";
  if (stage.group === "needs") return "warn";
  return "";
}

/** 每次运行怎么来的（launch、followup、recover、retry、continue、answer、manual） */
const cause = (c) => (has(`tasks.cause.${c}`) ? t(`tasks.cause.${c}`) : c);

/** 运行一行："第 2 次 · 重启后继续 · 3 分钟" */
function runLabel(r, i, now) {
  const ms = (r.endedAt || now) - (r.startedAt || r.queuedAt);
  const tail = r.state === "queued" ? t("tasks.queued") : r.startedAt ? fmtDur(ms) : "";
  return [t("tasks.run", { n: i + 1 }), cause(r.cause), tail].filter(Boolean).join(" · ");
}

export async function stopTask(task) {
  try {
    await api(`/tasks/${encodeURIComponent(task.id)}/stop`, { method: "POST", body: {} });
    toast(t("tasks.stopped", { title: task.title }));
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/** 任务的详情：最新进展、文件夹、每次运行（折叠的处理过程）、停止。working 时每 3 秒刷新 */
export function TaskDetail({ task, onChanged }) {
  const [d, setD] = useState(null);
  const [stopping, setStopping] = useState(false);
  const working = task.stage.group === "working";
  useEffect(() => {
    let on = true;
    const load = () => api(`/tasks/${encodeURIComponent(task.id)}`).then((x) => on && setD(x)).catch(() => {});
    load();
    if (!working) return () => (on = false);
    const timer = setInterval(load, 3000);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, [task.id, working, task.updatedAt]);
  const now = Date.now();
  const runs = d?.runs || [];
  const stop = async () => {
    setStopping(true);
    if (await stopTask(task)) onChanged?.();
    setStopping(false);
  };
  return html`<div class="task-detail">
    ${task.latest && html`<div class="task-line"><span class="t-label">${t("tasks.latest")}</span><span class="v selectable">${task.latest}</span></div>`}
    <div class="task-line"><span class="t-label">${t("tasks.folder")}</span><span class="v mono selectable">${task.folder}</span></div>
    ${runs.map(
      (r, i) => html`<${ActivityLine} key=${r.id + (r.state === "ended" ? ":e" : "")} label=${runLabel(r, i, now)} live=${r.state === "running" || r.state === "settling"} count=${r.steps}
        load=${() => api(`/tasks/${encodeURIComponent(task.id)}/runs/${encodeURIComponent(r.id)}/activity`).then((x) => x.steps)} />`,
    )}
    ${working && html`<div class="task-actions"><button type="button" class="text danger" disabled=${stopping} onClick=${stop}>${stopping ? t("tasks.stopping") : t("tasks.stop")}</button></div>`}
  </div>`;
}

/** 对话里的任务胶囊：「后台任务 · 标题 · 进行中 ›」，点开看详情 */
export function TaskChip({ task, onChanged }) {
  const [open, setOpen] = useState(false);
  const dot = stageDot(task.stage);
  return html`<div class=${`task-chip${open ? " open" : ""}`}>
    <button type="button" class="task-pill" aria-expanded=${open} title=${open ? t("tasks.collapse") : t("tasks.view")} onClick=${() => setOpen(!open)}>
      <span class=${`dot ${dot}`} aria-hidden="true"></span>
      <span class="k">${t("tasks.chip")}</span><span class="sep">·</span><span class="t">${task.title}</span><span class="sep">·</span><span class="st">${task.stage.label}</span>
      <${Icon} name="chevRight" size=${12} class="chev" />
    </button>
    ${open && html`<${TaskDetail} task=${task} onChanged=${onChanged} />`}
  </div>`;
}

/** 信息面板里的一行：状态点 + 标题，下面一行是状态、什么时候开始的、最新进展；进行中的可以停止 */
export function TaskRow({ task, onChanged, onOpen }) {
  const [stopping, setStopping] = useState(false);
  const working = task.stage.group === "working";
  const when = working ? t("tasks.minutes", { count: Math.max(1, Math.round((Date.now() - task.createdAt) / 60_000)) }) : fmtAgo(task.endedAt || task.updatedAt);
  const stop = async (e) => {
    e.stopPropagation();
    setStopping(true);
    if (await stopTask(task)) onChanged?.();
    setStopping(false);
  };
  return html`<div class="row compact task-row${onOpen ? " clickable" : ""}" role=${onOpen ? "button" : undefined} tabindex=${onOpen ? "0" : undefined}
      onClick=${onOpen} onKeyDown=${(e) => onOpen && e.key === "Enter" && onOpen()}>
    <span class=${`dot ${stageDot(task.stage)}`} aria-hidden="true"></span>
    <div class="who">
      <div class="name">${task.title}</div>
      <div class="sub">${task.stage.label} · ${when}</div>
    </div>
    ${working && html`<button type="button" class="text danger" disabled=${stopping} onClick=${stop}>${stopping ? t("tasks.stopping") : t("tasks.stop")}</button>`}
  </div>`;
}
