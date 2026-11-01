// 后台任务（3a，3f 补全）：对话里请求那条消息下面的任务胶囊「后台任务 · 标题 · 进行中 ›」，点开是任务的详情；
// 信息面板的「任务」组（TaskGroup）是一个机器人的全部任务和规则：进行中、等你的、规则，结束了的收在最后一行「已结束 3」里，
// 点开才列出来。一个任务一行，点开是同一块里的详情（和规则一样，像普通的折叠一样展开）。
// 详情：来自（渠道、时间、原话）、它问你的问题（有默认回答时下面一句「不回复就按中文做」）、最新进展、预算（约 $0.08 / $1.00，
// 可以改）、文件夹（大小、打开）、要清理时的日期和保留、每次运行折叠的处理过程，以及停止 / 导出 / 删除。
// 状态是"点 + 文字"：绿 = 进行中（问了个有默认回答的问题、接着在做的也是：「进行中，有个问题等你回答」），黄 = 等你，
// 红 = 失败，灰 = 已完成 / 已停止。
// 健康时不多占地方：花费有了才写，清理只在定了日期时出现。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Notice } from "./ui.js";
import { ActivityLine } from "./activity.js";
import { RuleRow } from "./rules.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { fmtAgo, fmtDay, fmtDur, fmtSep, fmtSize } from "../lib/format.js";
import { channelName } from "../lib/access.js";
import { t, has, getLang } from "../lib/i18n.js";

/** 阶段 → 状态点 */
export function stageDot(stage) {
  if (!stage) return "";
  if (stage.key === "failed") return "err";
  if (stage.group === "working") return "ok";
  if (stage.group === "needs") return "warn";
  return "";
}

/** 估算的花费到了一分钱才显示（之前什么都不写） */
export const hasCost = (usd) => Number(usd) >= 0.005;
export const money = (usd) => `$${Number(usd || 0).toFixed(2)}`;

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

/** 导出成 Markdown 的下载地址（下载链接带不了请求头，语言写在查询参数里） */
export const exportUrl = (kind, id) => `/amb/api/${kind}/${encodeURIComponent(id)}/export?lang=${encodeURIComponent(getLang())}`;

/** 原话太长时只留开头 */
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * 任务的详情：来自、问题、最新进展、预算、文件夹、清理、每次运行（折叠的处理过程）、停止 / 导出 / 删除。working 时每 3 秒刷新。
 * origin=false 时不写来自（对话里的胶囊就在请求那条消息下面）；question=false 时不写问题（「需要你」里那一行就是它）；
 * onOpenConv 给了，来自那一行点开会话；data 给了就不去取（样例页）
 */
export function TaskDetail({ task, onChanged, origin = true, question = true, onOpenConv, data }) {
  const [d, setD] = useState(data || null);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [tick, setTick] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    if (editing) requestAnimationFrame(() => (input.current?.focus(), input.current?.select()));
  }, [editing]);
  const view = d?.task || task;
  const working = view.stage.group === "working";
  const id = encodeURIComponent(task.id);
  useEffect(() => {
    if (data) return;
    let on = true;
    const load = () => api(`/tasks/${id}`).then((x) => on && setD(x)).catch(() => {});
    load();
    if (!working) return () => (on = false);
    const timer = setInterval(load, 3000);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, [task.id, working, task.updatedAt, tick]);
  const now = Date.now();
  const runs = d?.runs || [];
  // 结束了的（已完成、已停止）不用改预算：追加时还不够会再问
  const ended = view.stage.group === "ended";
  const reload = () => (setTick((n) => n + 1), onChanged?.());
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      failed(e);
    }
    setBusy("");
  };
  const stop = () => act("stop", async () => (await stopTask(view)) && reload());
  const saveBudget = () =>
    Number(amount) > 0 &&
    act("budget", async () => {
      await api(`/tasks/${id}/budget`, { method: "POST", body: { budgetUsd: Number(amount) } });
      setEditing(false);
      reload();
    });
  const keep = () => act("keep", async () => (await api(`/tasks/${id}/keep`, { method: "POST", body: {} }), reload()));
  const open = () => act("open", () => api(`/tasks/${id}/open`, { method: "POST", body: {} }));
  const del = async () => {
    const size = d?.sizes ? d.sizes.folder + d.sizes.sessions : 0;
    const body = size ? t("tasks.deleteBody", { size: fmtSize(size) }) : t("tasks.deleteBodyEmpty");
    if (!(await confirmSheet({ title: t("tasks.deleteTitle", { title: view.title }), body, confirmLabel: t("common.delete"), danger: true }))) return;
    act("del", async () => {
      await api(`/tasks/${id}`, { method: "DELETE" });
      toast(t("tasks.deleted"));
      onChanged?.();
    });
  };
  const o = origin && d?.origin;
  const from = o && t("tasks.originLine", { where: channelName(o.channel), when: fmtSep(o.at), text: clip(o.text.replace(/\s+/g, " "), 60) });
  const budget = hasCost(view.spentUsd) ? t("tasks.costOf", { spent: money(view.spentUsd), budget: money(view.budgetUsd) }) : money(view.budgetUsd);
  const asked = question && view.question;
  return html`<div class="task-detail">
    ${from && html`<div class="task-line"><span class="t-label">${t("tasks.origin")}</span>
      ${onOpenConv ? html`<button type="button" class="v task-origin" title=${t("tasks.openConv")} onClick=${onOpenConv}>${from}</button>` : html`<span class="v selectable">${from}</span>`}</div>`}
    ${asked && html`<div class="task-line"><span class="t-label">${t("tasks.question")}</span>
      <span class="v selectable">${asked.text}${asked.note && html`<span class="task-note">${asked.note}</span>`}</span></div>`}
    ${view.latest && html`<div class="task-line"><span class="t-label">${t("tasks.latest")}</span><span class="v selectable">${view.latest}</span></div>`}
    ${(!ended || hasCost(view.spentUsd)) && html`<div class="task-line"><span class="t-label">${t("tasks.budget")}</span>
      ${editing
        ? html`<span class="v task-budget-edit">$<input ref=${input} class="field num" type="number" min="0.01" step="0.5" value=${amount} aria-label=${t("tasks.budget")}
              onInput=${(e) => setAmount(e.target.value)} onKeyDown=${(e) => (e.key === "Enter" && saveBudget(), e.key === "Escape" && (e.stopPropagation(), setEditing(false)))} />
            <button type="button" class="text accent" disabled=${!(Number(amount) > 0) || busy === "budget"} onClick=${saveBudget}>${t("common.save")}</button>
            <button type="button" class="text" onClick=${() => setEditing(false)}>${t("common.cancel")}</button></span>`
        : html`<span class="v num">${budget}</span>${!ended && html`<button type="button" class="text" onClick=${() => (setAmount(String(view.budgetUsd)), setEditing(true))}>${t("tasks.change")}</button>`}`}
    </div>`}
    ${view.folder && html`<div class="task-line"><span class="t-label">${t("tasks.folder")}</span>
      <span class="v mono selectable">${view.folder}</span>${d?.sizes?.folder > 0 && html`<span class="n num">${fmtSize(d.sizes.folder)}</span>`}
      ${d?.canOpen && html`<button type="button" class="text" disabled=${busy === "open"} onClick=${open}>${t("common.open")}</button>`}</div>`}
    ${view.cleanupAt > 0 && html`<div class="task-line"><span class="t-label">${t("tasks.cleanup")}</span>
      <span class="v">${t("tasks.cleanupOn", { date: fmtDay(view.cleanupAt) })}</span><button type="button" class="text" disabled=${busy === "keep"} onClick=${keep}>${t("tasks.keep")}</button></div>`}
    ${runs.map(
      (r, i) => html`<${ActivityLine} key=${r.id + (r.state === "ended" ? ":e" : "")} label=${runLabel(r, i, now)} live=${r.state === "running" || r.state === "settling"} count=${r.steps} steps=${r.stepList}
        load=${() => api(`/tasks/${id}/runs/${encodeURIComponent(r.id)}/activity`).then((x) => x.steps)} />`,
    )}
    <div class="task-actions">
      ${working && html`<button type="button" class="text danger" disabled=${busy === "stop"} onClick=${stop}>${busy === "stop" ? t("tasks.stopping") : t("tasks.stop")}</button>`}
      ${!data && html`<a class="text" href=${exportUrl("tasks", task.id)} download>${t("tasks.export")}</a>`}
      ${!working && html`<button type="button" class="text danger" disabled=${busy === "del"} onClick=${del}>${t("common.delete")}</button>`}
    </div>
  </div>`;
}

/** 对话里的任务胶囊：「后台任务 · 标题 · 进行中 ›」，点开看详情（data 给了就不去取：样例页） */
export function TaskChip({ task, onChanged, data }) {
  const [open, setOpen] = useState(false);
  const dot = stageDot(task.stage);
  return html`<div class=${`task-chip${open ? " open" : ""}`}>
    <button type="button" class="task-pill" aria-expanded=${open} title=${open ? t("tasks.collapse") : t("tasks.view")} onClick=${() => setOpen(!open)}>
      <span class=${`dot ${dot}`} aria-hidden="true"></span>
      <span class="k">${t("tasks.chip")}</span><span class="sep">·</span><span class="t">${task.title}</span><span class="sep">·</span><span class="st">${task.stage.label}</span>
      <${Icon} name="chevRight" size=${12} class="chev" />
    </button>
    ${open && html`<${TaskDetail} task=${task} origin=${false} onChanged=${onChanged} data=${data} />`}
  </div>`;
}

/**
 * 信息面板里的一行：状态点 + 标题，下面一行是状态、多久了（进行中）或什么时候结束的、花了多少（有了花费才写）；
 * 进行中的可以直接停止。点开是同一块里的详情（data 给了就是样例页）
 */
export function TaskRow({ task, onChanged, open, onToggle, onOpenConv, data }) {
  const [stopping, setStopping] = useState(false);
  const working = task.stage.group === "working";
  const when = working ? t("tasks.minutes", { count: Math.max(1, Math.round((Date.now() - task.createdAt) / 60_000)) }) : fmtAgo(task.endedAt || task.updatedAt);
  const stop = async (e) => {
    e.stopPropagation();
    setStopping(true);
    if (await stopTask(task)) onChanged?.();
    setStopping(false);
  };
  return html`<div class=${`row compact clickable task-row${open ? " open" : ""}`} role="button" tabindex="0" aria-expanded=${!!open}
      onClick=${onToggle} onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle?.())}>
      <span class=${`dot ${stageDot(task.stage)}`} aria-hidden="true"></span>
      <div class="who">
        <div class="name">${task.title}</div>
        <div class="sub">${task.stage.label} · ${when}${hasCost(task.spentUsd) ? ` · ${t("tasks.costShort", { spent: money(task.spentUsd) })}` : ""}</div>
      </div>
      ${working && !open && html`<button type="button" class="text danger" disabled=${stopping} onClick=${stop} onKeyDown=${(e) => e.stopPropagation()}>${stopping ? t("tasks.stopping") : t("tasks.stop")}</button>`}
    </div>
    ${open && html`<div class="row-edit task-edit"><${TaskDetail} task=${task} data=${data} onChanged=${onChanged} onOpenConv=${onOpenConv} /></div>`}`;
}

/** 行的第二行：一次性规则跑完了只留一天 */
const freshRule = (r, now = Date.now()) => r.state.key !== "done" || now - (r.last?.at || r.updatedAt) < 86_400_000;

/**
 * 信息面板的「任务」组：这个机器人的任务和规则。进行中、等你的任务（GET /tasks?group=working,needs，每 4 秒）在前，规则其次，
 * 结束了的（group=ended，留 30 天）收在最后一行「已结束 3」里，点开才列出来。什么都没有时整组不画。
 * 一次只展开一个任务或规则；onOpenConv(任务) 打开任务来自的那个会话。tasks / rules / ended 给了就不去取（样例页）
 */
export function TaskGroup({ botId, onOpenConv, tasks: givenTasks, rules: givenRules, ended: givenEnded, details }) {
  const sample = !!givenTasks;
  const [tasks, setTasks] = useState(givenTasks || null);
  const [rules, setRules] = useState(givenRules || null);
  const [ended, setEnded] = useState(givenEnded || null);
  const [openId, setOpenId] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const bot = encodeURIComponent(botId);
  const loadTasks = () => api(`/tasks?bot=${bot}&group=working,needs&limit=20`).then((d) => setTasks(d.tasks)).catch(() => {});
  const loadRules = () => api(`/rules?bot=${bot}`).then((d) => setRules(d.rules)).catch(() => {});
  const loadEnded = () => api(`/tasks?bot=${bot}&group=ended&limit=50`).then((d) => setEnded(d.tasks)).catch(() => {});
  const reload = () => (loadTasks(), loadRules(), loadEnded());
  useEffect(() => {
    if (sample) return;
    reload();
    const fast = setInterval(() => document.visibilityState === "visible" && (loadTasks(), loadRules()), 4000);
    const slow = setInterval(() => document.visibilityState === "visible" && loadEnded(), 15000);
    return () => (clearInterval(fast), clearInterval(slow));
  }, [botId]);
  const list = (tasks || []).slice(0, 12);
  const rs = (rules || []).filter((r) => freshRule(r));
  const done = ended || [];
  if (!list.length && !rs.length && !done.length) return null;
  const toggle = (id) => setOpenId(openId === id ? "" : id);
  const row = (x) => html`<${TaskRow} key=${x.id} task=${x} open=${openId === x.id} onToggle=${() => toggle(x.id)} onChanged=${reload} data=${details?.[x.id]}
    onOpenConv=${onOpenConv && (() => onOpenConv(x))} />`;
  return html`<div class="list-head">${t("info.tasks")}</div>
    <div class="list task-group">
      ${list.map(row)}
      ${rs.map((r) => html`<${RuleRow} key=${r.id} rule=${r} open=${openId === r.id} onToggle=${() => toggle(r.id)} onChanged=${reload} />`)}
      ${done.length > 0 && html`<button type="button" class=${`row compact clickable task-ended${showEnded ? " open" : ""}`} aria-expanded=${showEnded} onClick=${() => setShowEnded(!showEnded)}>
        <span class="who"><span class="name">${t("tasks.ended", { count: done.length })}</span></span><${Icon} name="chevRight" size=${12} class="chev" />
      </button>`}
      ${showEnded && done.map(row)}
    </div>`;
}

/** 后台工作暂停时，信息面板顶部的一行（没暂停时不画）：任务、规则和主动消息都停着，点「恢复」接着来 */
export function PausedLine({ onResume }) {
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      await onResume();
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  return html`<${Notice} action=${html`<button type="button" class="btn" disabled=${busy} aria-busy=${busy || undefined} onClick=${resume}>${t("tasks.resume")}</button>`}>${t("tasks.paused")}<//>`;
}
