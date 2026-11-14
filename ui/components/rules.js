// 规则（3d）：信息面板「任务」组里一条规则一行——时间表 · 标题，下面一句状态和下次运行（用户选了观察的，观察够了要不要改为执行，
// 在「需要你」里问，从不推送）。点开是规则的详情：用户的原话、模式（观察 / 执行 / 关）、立即运行、编辑、删除，
// 和运行记录（一次一行：时间 · 模式 · 本会发送 / 保持安静 / 失败 / 跳过），每行再点开看报告、步骤、版本和权限；运行记录可以导出成
// Markdown（3f）。编辑器里有每次、每月的预算（3f，检查才有）；新建的检查还能选执行（默认）或观察。
// 健康时不多说话：状态是"点 + 文字"（绿 = 执行中、提醒，灰 = 观察中、关了，红 = 暂停了）。
import { useEffect, useState } from "preact/hooks";
import { html, Icon, Button, Seg, Sheet, Spinner, Switch } from "./ui.js";
import { ActivityLine } from "./activity.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { t, locale } from "../lib/i18n.js";
import { exportUrl, hasCost, money } from "./tasks.js";
import { openRule, rulesChanged, RULES_CHANGED } from "../lib/scheduled.js";

const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayDiff = (at, now = Date.now()) => {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(new Date(at)) - day(new Date(now))) / 86_400_000);
};
const shortDate = (d) => d.toLocaleDateString(locale(), { month: "numeric", day: "numeric" });

/** 运行记录里的时间：今天 08:00 / 昨天 08:00 / 10/27 08:00 */
export function fmtRunAt(at, now = Date.now(), zone) {
  if (zone) return fmtNext(at, now, zone);
  const d = new Date(at);
  const n = dayDiff(at, now);
  if (n === 0) return t("time.today", { time: hm(d) });
  if (n === -1) return t("time.yesterday", { time: hm(d) });
  return t("time.dateTime", { date: shortDate(d), time: hm(d) });
}

/** 下次运行（放在句子里，英文小写）：今天 15:00 / 明天 08:00 / 周一 09:00 / 11/20 09:00 */
export function fmtNext(at, now = Date.now(), zone) {
  if (zone) return new Intl.DateTimeFormat(locale(), { timeZone: zone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const d = new Date(at);
  const n = dayDiff(at, now);
  if (n <= 0) return t("rules.today", { time: hm(d) });
  if (n === 1) return t("rules.tomorrow", { time: hm(d) });
  if (n < 7) return t("rules.weekdayTime", { day: d.toLocaleDateString(locale(), { weekday: "short" }), time: hm(d) });
  return t("time.dateTime", { date: shortDate(d), time: hm(d) });
}

/** 行的第二行，一句话：观察中，明天 08:00 再运行；明天 08:00 提醒你；正在运行；连续失败 3 次，已暂停（其余的状态文字由服务端按界面语言给） */
export function ruleSub(rule, now = Date.now()) {
  if (rule.mode === "off" || rule.state.key === "off") return t(!rule.conversationId ? "scheduled.offNoDestination" : rule.requiresGroup && !rule.sourceGroupId ? "scheduled.offNoGroup" : "scheduled.offReady");
  if (rule.live) return t(rule.live.state === "queued" ? "rules.queued" : "rules.running");
  if (rule.state.key === "paused") return rule.pausedReason === "budget" ? t("rules.pausedBudget") : t("rules.paused", { count: rule.failures });
  if (rule.needsAttention && rule.last) return `${fmtRunAt(rule.last.at, now, rule.trigger?.schedule?.tz)} · ${rule.last.line}`;
  if (rule.mode === "observe" || rule.state.key === "observe") return t("scheduled.observing");
  return rule.nextRunAt ? t("rules.actNext", { next: fmtNext(rule.nextRunAt, now, rule.trigger?.schedule?.tz) }) : rule.state.label;
}

async function put(rule, body, done) {
  try {
    const d = await api(`/rules/${encodeURIComponent(rule.id)}`, { method: "PUT", body });
    rulesChanged();
    done?.(d.rule);
    return d.rule;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** 信息面板里的一行：点开是详情（和行同一块，像普通的折叠一样展开） */
export function RuleRow({ rule, onChanged, open, onToggle, full = false, timeZone }) {
  const zone = rule.trigger?.schedule?.tz;
  const mismatch = zone && zone !== (timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const sub = full && (rule.mode === "off" || !rule.needsAttention) ? `${rule.when} · ${rule.mode === "off" ? t("scheduled.offRow") : rule.nextRunAt ? t("rules.next", { time: fmtNext(rule.nextRunAt, Date.now(), zone) }) : rule.state.label}` : ruleSub(rule);
  const run = async () => { try { await api(`/rules/${rule.id}/run`, { method: "POST", body: {} }); rulesChanged(); onChanged?.(); } catch (e) { failed(e); } };
  return html`<div class=${`row compact rule-row${open ? " open" : ""}${full ? " rule-full" : ""}`} data-rule-id=${rule.id}>
    <button type="button" class="rule-row-main" aria-expanded=${open} onClick=${onToggle}>
      <span class=${`dot ${rule.needsAttention && !rule.pausedReason ? "warn" : rule.state.dot}`} aria-hidden="true"></span>
      <div class="who">
        <div class="name">${rule.title}</div>
        <div class=${`sub${rule.needsAttention ? " tone-warning" : ""}`}>${sub}</div>
        ${mismatch && html`<div class="hint">${t(timeZone ? "scheduled.deliveryZoneMismatch" : "scheduled.zoneMismatch", { zone })}</div>`}
      </div>
    </button>
    ${full && html`<span class=${`rule-destination${rule.destination ? "" : " tone-warning"}`}>${rule.destination || t("scheduled.destinationMissing")}</span>`}
    ${rule.needsAttention && !rule.pausedReason && html`<${Button} size="sm" disabled=${!!rule.live} onClick=${run}>${t("rules.runNow")}<//>`}
    ${rule.state.key !== "done" && html`<${RuleMode} rule=${rule} onChanged=${onChanged} />`}
    </div>
    ${open && html`<div class="row-edit rule-edit"><${RuleDetail} rule=${rule} onChanged=${onChanged} /></div>`}`;
}

/** 运行记录的一行：时间 · 模式 · 一句话 · 花了多少（有了才写）；点开看报告、步骤、版本和权限（不另起一块） */
function RunItem({ rule, run }) {
  const [open, setOpen] = useState(false);
  const mode = rule.kind === "remind" || !["observe", "act"].includes(run.mode) ? "" : t(`rules.mode.${run.mode}`);
  const meta = [t("rules.version", { n: run.version }), run.permission, run.cause === "manual" ? t("rules.manual") : run.cause === "event" ? t("rules.event") : ""].filter(Boolean).join(" · ");
  return html`<li class=${`rule-run${open ? " open" : ""}`}>
    <button type="button" class="rule-run-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <span class="at num">${fmtRunAt(run.at, Date.now(), rule.trigger?.schedule?.tz)}</span>${mode && html`<span class="m">${mode}</span>`}<span class="l">${run.line}</span>
      ${hasCost(run.costUsd) && html`<span class="c num">${t("tasks.costShort", { spent: money(run.costUsd) })}</span>`}
      <${Icon} name="chevRight" size="xs" class="chev" />
    </button>
    ${open && html`<div class="rule-run-body">
      ${run.summary && html`<p class="selectable">${run.summary}</p>`}
      ${run.would && html`<p class="selectable"><span class="t-label">${t("rules.would")}</span> ${run.would}</p>`}
      ${meta && html`<span class="hint">${meta}</span>`}
      ${run.steps > 0 && html`<${ActivityLine} label=${t("rules.steps")} count=${run.steps} load=${() => api(`/rules/${encodeURIComponent(rule.id)}/runs/${encodeURIComponent(run.id)}/activity`).then((x) => x.steps)} />`}
    </div>`}
  </li>`;
}

/** 规则的详情：原话、模式、操作、运行记录。runs 给了就不去取（样例页用） */
export function RuleDetail({ rule, runs: given, onChanged }) {
  const [runs, setRuns] = useState(given || null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const load = (before) =>
    api(`/rules/${encodeURIComponent(rule.id)}/runs${before ? `?before=${before}` : ""}`)
      .then((d) => (setRuns((v) => (before ? [...(v || []), ...d.runs] : d.runs)), setMore(d.runs.length >= 20)))
      .catch(() => setRuns((v) => v || []));
  useEffect(() => {
    if (given) return;
    load();
    if (!rule.live) return;
    const t = setInterval(() => load(), 3000);
    return () => clearInterval(t);
  }, [rule.id, rule.updatedAt, !!rule.live, rule.last?.at]);
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      rulesChanged();
      onChanged?.();
    } catch (e) {
      failed(e);
    }
    setBusy("");
  };
  const runNow = () => act("run", () => api(`/rules/${encodeURIComponent(rule.id)}/run`, { method: "POST", body: {} }));
  const del = async () => {
    if (!(await confirmSheet({ title: t("rules.deleteTitle", { title: rule.title }), body: t("rules.deleteBody"), confirmLabel: t("common.delete"), danger: true }))) return;
    act("del", () => api(`/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" }).then(() => toast(t("rules.deleted"))));
  };
  const where = rule.destination || "";
  const zone = rule.trigger?.schedule?.tz;
  const next = rule.nextRunAt && rule.state.key !== "paused" && rule.mode !== "off" ? t("rules.next", { time: fmtNext(rule.nextRunAt, Date.now(), zone) }) : "";
  // 本月的花费：有了才写（规则详情的 下次 … · 发到 … · 本月 约 $0.41 / $3.00）
  const month = hasCost(rule.monthUsd) ? t("rules.month", { spent: money(rule.monthUsd), budget: money(rule.monthBudgetUsd) }) : "";
  const line = [next, where && t("rules.sendsTo", { where }), month].filter(Boolean).join(" · ");
  return html`<div class="rule-detail">
    <p class="rule-words selectable">${t("rules.words", { text: rule.kind === "remind" ? rule.message : rule.instruction })}</p>
    ${line && html`<span class="hint">${line}</span>`}
    ${zone && html`<span class="hint">${rule.when} · ${zone}</span>`}
    ${rule.requiresGroup && html`<p class="hint">${t("scheduled.groupLabel")} · ${rule.sourceGroupName || t("scheduled.groupMissing")}</p>`}
    ${zone && zone !== Intl.DateTimeFormat().resolvedOptions().timeZone && html`<button type="button" class="text" onClick=${() => act("zone", () => put(rule, { schedule: { ...rule.trigger.schedule, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }))}>${t("scheduled.useCurrentZone")}</button>`}
    ${rule.estimatedMonthUsd !== undefined && html`<p class="hint">${t("scheduled.estimate", { amount: rule.estimatedMonthUsd.toFixed(2) })}</p>`}
    <div class="actions">
      <${RuleMode} rule=${rule} segments onChanged=${onChanged} />
      <span class="grow"></span>
      <${Button} size="sm" loading=${busy === "run"} disabled=${!!busy || !!rule.live || rule.mode === "off"} onClick=${runNow}>${t("rules.runNow")}<//>
    </div>
    ${rule.kind === "check" && rule.mode === "observe" && html`<span class="hint">${t("rules.observeHelp")}</span>`}
    <span class="hint">${t("scheduled.stopHint")}</span>
    <div class="actions">
      <button type="button" class="text" onClick=${() => setEditing(true)}>${t("common.edit")}</button>
      ${!given && html`<a class="text" href=${exportUrl("rules", rule.id)} download>${t("rules.export")}</a>`}
      <button type="button" class="text danger" disabled=${busy === "del"} onClick=${del}>${t("common.delete")}</button>
    </div>
    <div class="t-label">${t("rules.log")}</div>
    ${!runs && html`<span class="hint">${t("common.loading")}</span>`}
    ${runs && !runs.length && html`<span class="hint">${t("rules.noRuns")}</span>`}
    ${runs && runs.length > 0 && html`<ol class="rule-runs">${runs.map((r) => html`<${RunItem} key=${r.id + r.state} rule=${rule} run=${r} />`)}</ol>`}
    ${more && html`<button type="button" class="text" onClick=${() => load(runs.at(-1).at)}>${t("rules.earlier")}</button>`}
    ${editing && html`<${RuleEditor} botId=${rule.botId} rule=${rule} onClose=${() => setEditing(false)} onSaved=${() => (setEditing(false), onChanged?.())} />`}
  </div>`;
}

const COMMON_KINDS = ["daily", "weekdays", "weekly", "monthly", "once"];
const DAY_PICKS = [1, 2, 3, 4, 5, 6, 0];
const dayName = (d) => new Date(2026, 10, 1 + d).toLocaleDateString(locale(), { weekday: "short" });
const localInput = (at, zone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
function formOf(s) {
  const base = { kind: "daily", time: "08:00", days: [1], day: 1, minutes: 60, at: "", cron: "0 8 * * 1-5" };
  if (!s) return base;
  if (s.kind === "daily" && s.days?.length && s.days.join() !== "1,2,3,4,5" && s.days.length < 7) return { ...base, ...s, kind: "weekly" };
  return { ...base, ...s, kind: s.kind === "daily" && (s.days || []).join() === "1,2,3,4,5" ? "weekdays" : s.kind, at: s.kind === "once" ? localInput(s.at, s.tz) : "" };
}
function scheduleOf(f, tz) {
  if (f.kind === "weekdays") return { kind: "daily", time: f.time, days: [1, 2, 3, 4, 5], tz };
  if (f.kind === "daily") return { kind: "daily", time: f.time, tz };
  if (f.kind === "weekly") return { kind: "weekly", time: f.time, days: f.days, tz };
  if (f.kind === "monthly") return { kind: "monthly", day: f.day === "last" ? "last" : Number(f.day), time: f.time, tz };
  if (f.kind === "every") return { kind: "every", minutes: Number(f.minutes), ...(f.from ? { from: f.from } : {}), tz };
  if (f.kind === "once") return { kind: "once", local: f.at, tz };
  return { kind: "cron", cron: f.cron, tz };
}

function DestinationPicker({ destinations, value, onChange }) {
  const section = (d) => d.channel !== "web" ? "channels" : d.kind === "group" ? "groups" : "desktop";
  return html`<div class="rule-destinations" role="radiogroup" aria-label=${t("rules.to")}>
    ${destinations.map((d, i) => html`${(!i || section(destinations[i - 1]) !== section(d)) && html`<span class="t-label">${t(`scheduled.${section(d)}`)}</span>`}<label class="rule-destination-option" key=${d.id}><input type="radio" name="rule-destination" value=${d.id} checked=${value === d.id} onChange=${() => onChange(d.id)} /><span>${d.title}</span>${d.default && html`<span class="hint">${t("scheduled.default")}</span>`}</label>`)}
  </div><p class="hint rule-destination-hint">${t("scheduled.destinationHint")}</p>`;
}
function GroupPicker({ groups, value, onChange }) {
  return html`<label>${t("scheduled.groupLabel")}${groups.length ? html`<select class="field" value=${value} onChange=${(e) => onChange(e.target.value)}><option value="">${t("scheduled.groupMissing")}</option>${groups.map((g) => html`<option key=${g.id} value=${g.id}>${g.name}</option>`)}</select>` : html`<span class="hint">${t("scheduled.noGroups")}</span>`}</label>`;
}

/** 三个入口共用的开关、补选确认框和预算恢复入口。 */
export function RuleMode({ rule, segments = false, onChanged }) {
  const [activation, setActivation] = useState(null);
  const [choices, setChoices] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = async (mode) => {
    if (mode !== "off" && rule.pausedReason === "budget") return setEditing(true);
    if (mode !== "off" && (!rule.conversationId || !rule.destination || rule.requiresGroup && (!rule.sourceGroupId || !rule.sourceGroupName))) {
      setActivation({ mode, conversationId: rule.destination ? rule.conversationId : "", sourceGroupId: rule.sourceGroupName ? rule.sourceGroupId : "" });
      try { setChoices(await api(`/rules/destinations?bot=${encodeURIComponent(rule.botId)}`)); } catch (e) { failed(e); }
      return;
    }
    setBusy(true); await put(rule, { mode }, onChanged); setBusy(false);
  };
  const activate = async () => {
    setBusy(true);
    const r = await put(rule, activation, onChanged);
    if (r) setActivation(null);
    setBusy(false);
  };
  const modes = rule.kind === "remind" ? [["act", t("rules.mode.on")], ["off", t("rules.mode.off")]] : [["observe", t("rules.mode.observe")], ["act", t("rules.mode.act")], ["off", t("rules.mode.off")]];
  return html`${segments ? html`<${Seg} label=${t("rules.modeLabel")} options=${modes} value=${rule.pausedReason ? "off" : rule.mode} disabled=${busy} onChange=${change} />` : html`<${Switch} label=${`${rule.title} · ${t(rule.mode !== "off" && !rule.pausedReason ? "scheduled.on" : "scheduled.off")}`} value=${rule.mode !== "off" && !rule.pausedReason} disabled=${busy} onChange=${(on) => change(on ? "act" : "off")} />`}
    ${activation && html`<${Sheet} title=${t("scheduled.activateTitle")} onClose=${() => setActivation(null)}>
      <p class="hint rule-activation-hint">${t(rule.requiresGroup ? "scheduled.activateGroupHint" : "scheduled.activateHint")}</p>
      ${!choices ? html`<${Spinner} />` : html`<div class="rule-form">
        ${rule.requiresGroup && html`<${GroupPicker} groups=${choices.groups} value=${activation.sourceGroupId} onChange=${(id) => setActivation({ ...activation, sourceGroupId: id })} />`}
        <span class="t-label">${t("rules.to")}</span><${DestinationPicker} destinations=${choices.destinations} value=${activation.conversationId} onChange=${(id) => setActivation({ ...activation, conversationId: id })} />
      </div>`}
      <div class="actions"><${Button} onClick=${() => setActivation(null)}>${t("common.cancel")}<//><${Button} variant="primary" loading=${busy} disabled=${!choices || !activation.conversationId || rule.requiresGroup && !activation.sourceGroupId} onClick=${activate}>${t("scheduled.activate")}<//></div>
    <//>`}
    ${editing && html`<${RuleEditor} botId=${rule.botId} rule=${rule} advanced onClose=${() => setEditing(false)} onSaved=${() => { setEditing(false); onChanged?.(); }} />`}
  `;
}

export function RuleEditor({ botId, rule, onClose, onSaved, advanced = false }) {
  const [kind, setKind] = useState(rule?.kind || "check");
  const [title, setTitle] = useState(rule?.title || "");
  const [words, setWords] = useState(rule ? (rule.kind === "remind" ? rule.message : rule.instruction) : "");
  const [orig] = useState(() => formOf(rule?.trigger?.schedule));
  const [f, setF] = useState(orig);
  const [conv, setConv] = useState(rule?.conversationId || "");
  const [group, setGroup] = useState(rule?.sourceGroupId || "");
  const [enabled, setEnabled] = useState(true);
  const [observe, setObserve] = useState(rule?.mode === "observe");
  const [choices, setChoices] = useState(null);
  const [zone, setZone] = useState(rule?.trigger?.schedule?.tz || "");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(["every", "cron"].includes(orig.kind));
  const [missed, setMissed] = useState(rule?.missedPolicy || "catchup");
  const [runB, setRunB] = useState(String(rule?.runBudgetUsd ?? 0.1));
  const [monthB, setMonthB] = useState(String(rule?.monthBudgetUsd ?? 3));
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const event = rule && rule.trigger.kind !== "schedule";
  const unchanged = !!rule && JSON.stringify(f) === JSON.stringify(orig);
  useEffect(() => {
    let alive = true;
    api(`/rules/destinations?bot=${encodeURIComponent(botId)}`).then((d) => {
      if (!alive) return;
      setChoices(d); if (!zone) setZone(d.timeZone);
      if (!rule) setConv(d.destinations.find((c) => c.default)?.id || "");
    }).catch(failed);
    return () => { alive = false; };
  }, [botId]);
  useEffect(() => {
    if (!zone || event) return;
    let alive = true;
    setPreview(null); setError("");
    const timer = setTimeout(() => api("/rules/preview", { method: "POST", body: { schedule: scheduleOf(f, zone) } }).then((d) => { if (alive) setPreview(d); }).catch((e) => { if (alive) setError(e.message); }), 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [JSON.stringify(f), zone]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleDay = (d) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] });
  const remind = kind === "remind";
  const channel = choices?.destinations.find((c) => c.id === conv)?.channel || rule?.channel;
  const save = async () => {
    setBusy(true);
    try {
      const body = { title, ...(remind ? { message: words, ...(!rule ? { instruction: words } : {}) } : { instruction: words }), conversationId: conv,
        ...(event || unchanged ? {} : { schedule: preview.schedule }), missedPolicy: missed,
        ...(rule?.requiresGroup ? { sourceGroupId: group } : {}),
        ...(!remind ? { runBudgetUsd: Number(runB), monthBudgetUsd: Number(monthB) } : {}) };
      const d = rule ? await api(`/rules/${rule.id}`, { method: "PUT", body }) : await api("/rules", { method: "POST", body: { ...body, botId, kind, mode: !enabled ? "off" : !remind && observe ? "observe" : "act" } });
      rulesChanged(); toast(t("common.saved")); onSaved?.(d.rule);
    } catch (e) { failed(e); }
    setBusy(false);
  };
  const ok = title.trim() && words.trim() && (conv || rule?.mode === "off") && (event || unchanged || preview) && (remind || Number(runB) > 0 && Number(monthB) > 0) && (!rule?.requiresGroup || rule.mode === "off" || group);
  return html`<${Sheet} title=${rule ? t("rules.editTitle") : t("rules.newTitle")} onClose=${onClose}>
    <div class="rule-form">
      ${!rule && html`<${Seg} label=${t("rules.kind")} options=${[["remind", t("rules.kindRemind")], ["check", t("rules.kindCheck")]]} value=${kind} onChange=${setKind} />`}
      <label>${t("rules.name")}<input class="field" data-autofocus value=${title} maxlength="40" onInput=${(e) => setTitle(e.target.value)} /></label>
      <label>${remind ? t("rules.wordsRemind") : t("rules.wordsCheck")}<textarea class="field" rows=${remind ? 2 : 3} maxlength=${remind ? 300 : 2000} value=${words} onInput=${(e) => setWords(e.target.value)}></textarea></label>
      ${!event && html`<div class="rule-when"><span class="t-label">${t("rules.when")}</span>
        <${Seg} label=${t("rules.when")} options=${COMMON_KINDS.map((k) => [k, t(k === "monthly" ? "scheduled.monthly" : `rules.kinds.${k}`)])} value=${f.kind} onChange=${(kind) => setF({ ...f, kind })} />
        <button type="button" class="text" aria-expanded=${more} onClick=${() => setMore(!more)}>${t("scheduled.more")}</button>
        ${more && html`<${Seg} label=${t("scheduled.more")} options=${["every", "cron"].map((k) => [k, t(`rules.kinds.${k}`)])} value=${f.kind} onChange=${(kind) => setF({ ...f, kind })} />`}
        <div class="rule-when-row">
          ${f.kind === "monthly" && html`<select class="field" value=${f.day} onChange=${set("day")}>${Array.from({ length: 31 }, (_, i) => html`<option value=${i + 1}>${i + 1}</option>`)}<option value="last">${t("scheduled.lastDay")}</option></select>`}
          ${["daily", "weekdays", "weekly", "monthly"].includes(f.kind) && html`<input class="field num" type="time" aria-label=${t("rules.when")} value=${f.time} onInput=${set("time")} />`}
          ${f.kind === "every" && html`<input class="field num" type="number" min="15" max="10080" step="1" aria-label=${t("rules.minutes")} value=${f.minutes} onInput=${set("minutes")} /><span class="hint">${t("rules.minutes")}</span>`}
          ${f.kind === "once" && html`<input class="field num" type="datetime-local" aria-label=${t("rules.when")} value=${f.at} onInput=${set("at")} />`}
          ${f.kind === "cron" && html`<input class="field mono" aria-label="cron" value=${f.cron} onInput=${set("cron")} />`}
        </div>
        ${f.kind === "weekly" && html`<div class="rule-days">${DAY_PICKS.map((d) => html`<button type="button" class=${`chip${f.days.includes(d) ? " on" : ""}`} aria-pressed=${f.days.includes(d)} onClick=${() => toggleDay(d)}>${dayName(d)}</button>`)}</div>`}
        <span class="hint">${zone}</span>
        ${preview && html`<span class="hint">${t("scheduled.next", { times: preview.times.map((at) => fmtNext(at, Date.now(), zone)).join(" · ") })}</span><span class="hint">${t(preview.monthlyRuns === 1 ? "scheduled.frequencyOne" : "scheduled.frequency", { count: preview.monthlyRuns })}</span>${!remind && preview.monthlyRuns > 300 && html`<p class="tone-warning">${t("scheduled.frequent")}</p>`}`}
        ${error && !unchanged && html`<p class="tone-danger" role="alert">${error}</p>`}
      </div>`}
      ${rule?.requiresGroup && choices && html`<${GroupPicker} groups=${choices.groups} value=${group} onChange=${setGroup} />`}
      <span class="t-label">${t("rules.to")}</span>
      ${choices ? html`<${DestinationPicker} destinations=${choices.destinations} value=${conv} onChange=${setConv} />` : html`<${Spinner} />`}
      ${channel === "weixin" && html`<p class="hint">${t("rules.weixinNote")}</p>`}
      ${!rule && html`<div class="rule-when"><span class="t-label">${t("scheduled.afterCreating")}</span><${Seg} label=${t("scheduled.afterCreating")} options=${[["on", t("scheduled.turnOnNow")], ["off", t("scheduled.keepOff")]]} value=${enabled ? "on" : "off"} onChange=${(v) => setEnabled(v === "on")} />${!enabled && html`<span class="hint">${t("scheduled.offHint")}</span>`}</div>`}
      <details open=${advanced}><summary>${t("scheduled.advanced")}</summary><div class="rule-form">
        ${!remind && !rule && html`<div class="actions"><span>${t("scheduled.tryFirst")}</span><span class="grow"></span><${Switch} label=${t("scheduled.tryFirst")} value=${observe} onChange=${setObserve} /></div>`}
        ${f.kind !== "every" && html`<span class="t-label">${t("scheduled.missedPolicy")}</span><${Seg} label=${t("scheduled.missedPolicy")} options=${[["catchup", t("scheduled.catchup")], ["skip", t("scheduled.skip")]]} value=${missed} onChange=${setMissed} />`}
        ${!remind && html`<div class="rule-when-row"><label>${t("rules.perRun")} ($)<input class="field num" type="number" min="0.01" step="0.01" value=${runB} onInput=${(e) => setRunB(e.target.value)} /></label><label>${t("rules.perMonth")} ($)<input class="field num" type="number" min="0.01" step="0.5" value=${monthB} onInput=${(e) => setMonthB(e.target.value)} /></label></div>`}
        <p class="hint">${t(!event && ["daily", "weekdays", "weekly", "monthly", "once"].includes(f.kind) && missed === "catchup" ? "scheduled.localCatchup" : "scheduled.localOnly")}</p>
      </div></details>
    </div>
    <div class="actions"><${Button} onClick=${onClose}>${t("common.cancel")}<//><${Button} variant="primary" loading=${busy} disabled=${!ok} onClick=${save}>${rule ? t("common.save") : t("rules.create")}<//></div>
  <//>`;
}

export function useRuleActions(conversationId, groupId = "") {
  const [actions, setActions] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => api(`/rules/actions?${groupId ? `group=${encodeURIComponent(groupId)}` : `conversation=${encodeURIComponent(conversationId)}`}`).then((d) => { if (alive) setActions(d.actions); }).catch(() => {});
    load(); const timer = setInterval(load, 3000); window.addEventListener(RULES_CHANGED, load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener(RULES_CHANGED, load); };
  }, [conversationId, groupId]);
  return actions;
}
export function RuleCard({ action }) {
  const [busy, setBusy] = useState(false);
  const run = async (op) => {
    setBusy(true);
    try { await api(`/rules/actions/${action.id}/${op}`, { method: "POST", body: {} }); rulesChanged(); } catch (e) { failed(e); }
    setBusy(false);
  };
  const rule = action.rule;
  const gone = action.state === "deleted";
  const undone = action.state === "undone";
  return html`<div class=${`rule-chat-card${gone || undone ? " muted" : ""}`}>
    <div class="actions"><b>${undone ? html`<s>${t("scheduled.rule")} · ${action.title}</s>` : `${t(action.kind === "update" ? "scheduled.updated" : "scheduled.rule")} · ${rule?.title || action.title}`}</b><span class="grow"></span>${rule && rule.state.key !== "done" && html`<span class="hint">${t(rule.mode !== "off" && !rule.pausedReason ? "scheduled.on" : "scheduled.off")}</span><${RuleMode} rule=${rule} />`}</div>
    ${gone ? html`<p>${t("scheduled.deleted")}</p>` : undone ? html`<p>${t("scheduled.undone")} · ${t("scheduled.restoreUntil", { time: fmtNext(action.restoreUntil) })}</p>` : rule && html`<p>${rule.when} (${rule.trigger?.schedule?.tz || ""})</p><p>${t("rules.sendsTo", { where: rule.destination || t("scheduled.destinationMissing") })}</p>${rule.nextRunAt > 0 && html`<p>${t("rules.next", { time: fmtNext(rule.nextRunAt, Date.now(), rule.trigger?.schedule?.tz) })}</p>`}`}
    ${action.kind === "update" && action.canUndo && html`<p class="hint">${t("scheduled.updateUndoHint")}</p>`}
    ${action.state === "reverted" && html`<p class="hint">${t("scheduled.updateUndone")}</p>`}
    <div class="actions">${rule && html`<${Button} size="sm" onClick=${() => openRule(rule)}>${t("scheduled.view")}<//>`}${action.canUndo && html`<${Button} size="sm" disabled=${busy} onClick=${() => run("undo")}>${t("scheduled.undo")}<//>`}${action.canRestore && html`<${Button} size="sm" disabled=${busy} onClick=${() => run("restore")}>${t("scheduled.restore")}<//>`}</div>
  </div>`;
}
export function RuleSource({ source, botId }) {
  return source && html`<button type="button" class=${`rule-source${source.late ? " tone-warning" : ""}`} onClick=${() => openRule({ id: source.ruleId, botId })}>${t("scheduled.fromRule", { name: source.title, time: source.late ? t("scheduled.late", { time: fmtNext(source.dueAt, Date.now(), source.timeZone) }) : fmtNext(source.dueAt, Date.now(), source.timeZone) })}</button>`;
}
