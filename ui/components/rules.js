// 规则（3d）：信息面板「任务」组里一条规则一行——时间表 · 标题，下面一行是状态和下次运行；观察了 3 次的，行里多一句
// 「已观察 3 次 · 改为执行？」（只在这里，从不推送）。点开是规则的详情：用户的原话、模式（观察 / 执行 / 关）、立即运行、编辑、删除，
// 和运行记录（一次一行：时间 · 模式 · 本会发送 / 保持安静 / 失败 / 跳过），每行再点开看报告、步骤、版本和权限。
// 健康时不多说话：状态是"点 + 文字"（绿 = 执行中、提醒，灰 = 观察中、关了，红 = 暂停了）。
import { useEffect, useState } from "preact/hooks";
import { html, Icon, Button, Seg, Sheet, Spinner } from "./ui.js";
import { ActivityLine } from "./activity.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { CHANNEL_NAME } from "../lib/access.js";

const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const dayDiff = (t, now = Date.now()) => {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(new Date(t)) - day(new Date(now))) / 86_400_000);
};

/** 运行记录里的时间：今天 08:00 / 昨天 08:00 / 前天 08:00 / 10/27 08:00 */
export function fmtRunAt(t, now = Date.now()) {
  const d = new Date(t);
  const n = dayDiff(t, now);
  if (n === 0) return `今天 ${hm(d)}`;
  if (n === -1) return `昨天 ${hm(d)}`;
  if (n === -2) return `前天 ${hm(d)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`;
}

/** 下次运行：今天 15:00 / 明天 08:00 / 周一 09:00 / 11/20 09:00 */
export function fmtNext(t, now = Date.now()) {
  const d = new Date(t);
  const n = dayDiff(t, now);
  if (n <= 0) return `今天 ${hm(d)}`;
  if (n === 1) return `明天 ${hm(d)}`;
  if (n < 7) return `${WEEK[d.getDay()]} ${hm(d)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`;
}

const MODE = { observe: "观察", act: "执行" };

/** 行的第二行：观察中 · 下次 明天 08:00；正在运行；已暂停 · 连续失败 3 次 */
export function ruleSub(rule, now = Date.now()) {
  if (rule.live) return rule.live.state === "queued" ? `${rule.state.label} · 排队中` : `${rule.state.label} · 正在运行`;
  if (rule.state.key === "paused") return `已暂停 · 连续失败 ${rule.failures} 次`;
  if (rule.state.key === "off" || rule.state.key === "done") return rule.state.label;
  return rule.nextRunAt ? `${rule.state.label} · 下次 ${fmtNext(rule.nextRunAt, now)}` : rule.state.label;
}

async function put(rule, body, done) {
  try {
    const d = await api(`/rules/${encodeURIComponent(rule.id)}`, { method: "PUT", body });
    done?.(d.rule);
    return d.rule;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** 信息面板里的一行：点开是详情（和行同一块，像普通的折叠一样展开） */
export function RuleRow({ rule, onChanged, open, onToggle }) {
  const [busy, setBusy] = useState(false);
  const toAct = async (e) => {
    e.stopPropagation();
    setBusy(true);
    if (await put(rule, { mode: "act" })) (toast(`「${rule.title}」改为执行`), onChanged?.());
    setBusy(false);
  };
  return html`<div class=${`row compact clickable rule-row${open ? " open" : ""}`} role="button" tabindex="0" aria-expanded=${open}
      onClick=${onToggle} onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}>
      <span class=${`dot ${rule.state.dot}`} aria-hidden="true"></span>
      <div class="who">
        <div class="name">${rule.when} · ${rule.title}</div>
        <div class="sub">${ruleSub(rule)}</div>
        ${rule.hint && html`<button type="button" class="text rule-hint" disabled=${busy} onClick=${toAct} onKeyDown=${(e) => e.stopPropagation()}>已观察 ${rule.observed} 次 · 改为执行？</button>`}
      </div>
    </div>
    ${open && html`<div class="row-edit rule-edit"><${RuleDetail} rule=${rule} onChanged=${onChanged} /></div>`}`;
}

/** 运行记录的一行：时间 · 模式 · 一句话；点开看报告、步骤、版本和权限（不另起一块） */
function RunItem({ rule, run }) {
  const [open, setOpen] = useState(false);
  const mode = rule.kind === "remind" ? "" : MODE[run.mode] || "";
  const meta = [`第 ${run.version} 版`, run.permission, run.cause === "manual" ? "手动运行" : run.cause === "event" ? "事件" : ""].filter(Boolean).join(" · ");
  return html`<li class=${`rule-run${open ? " open" : ""}`}>
    <button type="button" class="rule-run-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <span class="at num">${fmtRunAt(run.at)}</span>${mode && html`<span class="m">${mode}</span>`}<span class="l">${run.line}</span>
      <${Icon} name="chevRight" size=${12} class="chev" />
    </button>
    ${open && html`<div class="rule-run-body">
      ${run.summary && html`<p class="selectable">${run.summary}</p>`}
      ${run.would && html`<p class="selectable"><span class="t-label">本会做</span> ${run.would}</p>`}
      ${meta && html`<span class="hint">${meta}</span>`}
      ${run.steps > 0 && html`<${ActivityLine} label="处理过程" count=${run.steps} load=${() => api(`/rules/${encodeURIComponent(rule.id)}/runs/${encodeURIComponent(run.id)}/activity`).then((x) => x.steps)} />`}
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
      onChanged?.();
    } catch (e) {
      failed(e);
    }
    setBusy("");
  };
  const setMode = (mode) => act("mode", () => put(rule, { mode }));
  const runNow = () => act("run", () => api(`/rules/${encodeURIComponent(rule.id)}/run`, { method: "POST", body: {} }));
  const del = async () => {
    if (!(await confirmSheet({ title: `删除「${rule.title}」？`, body: "运行记录一起删除。", confirmLabel: "删除", danger: true }))) return;
    act("del", () => api(`/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" }).then(() => toast("已删除")));
  };
  const modes = rule.kind === "remind" ? [["act", "开"], ["off", "关"]] : [["observe", "观察"], ["act", "执行"], ["off", "关"]];
  const where = CHANNEL_NAME[rule.channel] || rule.channel;
  const line = [rule.nextRunAt && rule.state.key !== "paused" && rule.mode !== "off" ? `下次 ${fmtNext(rule.nextRunAt)}` : "", where && `发到 ${where}`].filter(Boolean).join(" · ");
  return html`<div class="rule-detail">
    <p class="rule-words selectable">「${rule.kind === "remind" ? rule.message : rule.instruction}」</p>
    ${line && html`<span class="hint">${line}</span>`}
    <div class="actions">
      <${Seg} label="模式" options=${modes} value=${rule.mode} disabled=${busy === "mode"} onChange=${setMode} />
      <span class="grow"></span>
      <${Button} size="sm" loading=${busy === "run"} disabled=${!!busy || !!rule.live || rule.mode === "off"} onClick=${runNow}>立即运行<//>
    </div>
    ${rule.mode === "act" && rule.observeLeft > 0 && html`<span class="hint">改了规则，先观察 ${rule.observeLeft} 次再执行</span>`}
    ${rule.kind === "check" && rule.mode === "observe" && html`<span class="hint">观察时不发消息、不改文件，但拦不住命令联网。</span>`}
    <div class="actions">
      <button type="button" class="text" onClick=${() => setEditing(true)}>编辑</button>
      <button type="button" class="text danger" disabled=${busy === "del"} onClick=${del}>删除</button>
    </div>
    <div class="t-label">运行记录</div>
    ${!runs && html`<span class="hint">加载中…</span>`}
    ${runs && !runs.length && html`<span class="hint">还没有运行过</span>`}
    ${runs && runs.length > 0 && html`<ol class="rule-runs">${runs.map((r) => html`<${RunItem} key=${r.id + r.state} rule=${rule} run=${r} />`)}</ol>`}
    ${more && html`<button type="button" class="text" onClick=${() => load(runs.at(-1).at)}>更早的</button>`}
    ${editing && html`<${RuleEditor} botId=${rule.botId} rule=${rule} onClose=${() => setEditing(false)} onSaved=${() => (setEditing(false), onChanged?.())} />`}
  </div>`;
}

const KINDS = [
  ["daily", "每天"],
  ["weekdays", "工作日"],
  ["weekly", "每周"],
  ["every", "每隔"],
  ["once", "一次"],
  ["cron", "cron"],
];
const DAY_PICKS = [1, 2, 3, 4, 5, 6, 0];

/** 规则的时间表 → 编辑器里的字段 */
function formOf(s) {
  const base = { kind: "daily", time: "08:00", days: [1], minutes: 60, at: "", cron: "0 8 * * 1-5" };
  if (!s) return base;
  if (s.kind === "daily" && (s.days || []).join(",") === "1,2,3,4,5") return { ...base, kind: "weekdays", time: s.time };
  if (s.kind === "daily") return { ...base, time: s.time };
  if (s.kind === "weekly") return { ...base, kind: "weekly", time: s.time, days: s.days };
  if (s.kind === "every") return { ...base, kind: "every", minutes: s.minutes };
  if (s.kind === "once") {
    const d = new Date(s.at);
    return { ...base, kind: "once", at: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hm(d)}` };
  }
  return { ...base, kind: "cron", cron: s.cron };
}

/** 编辑器里的字段 → 接口要的时间表 */
function scheduleOf(f) {
  if (f.kind === "weekdays") return { kind: "daily", time: f.time, days: [1, 2, 3, 4, 5] };
  if (f.kind === "daily") return { kind: "daily", time: f.time };
  if (f.kind === "weekly") return { kind: "weekly", time: f.time, days: f.days };
  if (f.kind === "every") return { kind: "every", minutes: Number(f.minutes) };
  if (f.kind === "once") return { kind: "once", at: f.at ? new Date(f.at).getTime() : 0 };
  return { kind: "cron", cron: f.cron };
}

/** 发到哪：最近的几个会话；同一渠道只有一个时只写渠道名 */
function convOptions(convs, current) {
  const list = convs.slice(0, 5);
  if (current && !list.some((c) => c.id === current)) {
    const cur = convs.find((c) => c.id === current);
    if (cur) list.push(cur);
  }
  const n = (ch) => list.filter((c) => c.channel === ch).length;
  return list.map((c) => {
    const name = CHANNEL_NAME[c.channel] || c.channel;
    return [c.id, n(c.channel) > 1 ? `${name} · ${(c.title || c.peerId).slice(0, 8)}` : name];
  });
}

/**
 * 新建或编辑一条规则（对话框）：名称、要做什么（用户的原话）或提醒的那句话、时间、发到哪个会话。
 * 新建的检查从观察开始；改了原话的执行中的规则先观察 1 次（服务端处理）。发到微信时说清 24 小时的限制。
 * 对话框里不放下拉菜单（玻璃对话框会裁掉它）：选项都用分段。时间表没改就不发，every 的起点不会被挪动。
 */
export function RuleEditor({ botId, rule, onClose, onSaved }) {
  const [kind, setKind] = useState(rule?.kind || "check");
  const [title, setTitle] = useState(rule?.title || "");
  const [words, setWords] = useState(rule ? (rule.kind === "remind" ? rule.message : rule.instruction) : "");
  const [orig] = useState(() => formOf(rule?.trigger?.kind === "schedule" ? rule.trigger.schedule : undefined));
  const [f, setF] = useState(orig);
  const [conv, setConv] = useState(rule?.conversationId || "");
  const [convs, setConvs] = useState(null);
  const [busy, setBusy] = useState(false);
  const event = rule && rule.trigger.kind !== "schedule";
  useEffect(() => {
    api(`/conversations?bot=${encodeURIComponent(botId)}`)
      .then((d) => {
        setConvs(d.conversations);
        if (!conv && d.conversations.length) setConv((d.conversations.find((c) => c.channel === "weixin") || d.conversations[0]).id);
      })
      .catch(() => setConvs([]));
  }, [botId]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleDay = (d) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] });
  const channel = (convs || []).find((c) => c.id === conv)?.channel || rule?.channel;
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title,
        ...(kind === "remind" ? { message: words, ...(rule ? {} : { instruction: words }) } : { instruction: words }),
        ...(event || (rule && JSON.stringify(scheduleOf(f)) === JSON.stringify(scheduleOf(orig))) ? {} : { schedule: scheduleOf(f) }),
        ...(conv ? { conversationId: conv } : {}),
      };
      const d = rule
        ? await api(`/rules/${encodeURIComponent(rule.id)}`, { method: "PUT", body })
        : await api("/rules", { method: "POST", body: { ...body, botId, kind } });
      toast(rule ? "已保存" : kind === "remind" ? "已建好提醒" : "已建好规则，先观察");
      onSaved?.(d.rule);
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  const ok = title.trim() && words.trim() && conv && (event || f.kind !== "weekly" || f.days.length);
  return html`<${Sheet} title=${rule ? "编辑规则" : "新规则"} onClose=${onClose}>
    <div class="rule-form">
      ${!rule && html`<${Seg} label="类型" options=${[["check", "检查"], ["remind", "提醒"]]} value=${kind} onChange=${setKind} />`}
      <label>名称<input class="field" data-autofocus value=${title} maxlength="40" placeholder=${kind === "remind" ? "开会" : "看 X 价格"} onInput=${(e) => setTitle(e.target.value)} /></label>
      <label>${kind === "remind" ? "提醒的话" : "要做什么"}
        <textarea class="field" rows=${kind === "remind" ? 2 : 3} value=${words} placeholder=${kind === "remind" ? "该去开会了。" : "看看 X 的价格，低于 200 告诉我"} onInput=${(e) => setWords(e.target.value)}></textarea></label>
      ${!event && html`<div class="rule-when">
        <span class="t-label">时间</span>
        <${Seg} label="时间" options=${KINDS} value=${f.kind} onChange=${(v) => setF({ ...f, kind: v })} />
        <div class="rule-when-row">
          ${["daily", "weekdays", "weekly"].includes(f.kind) && html`<input class="field num" type="time" value=${f.time} onInput=${set("time")} />`}
          ${f.kind === "every" && html`<input class="field num" type="number" min="15" step="5" value=${f.minutes} onInput=${set("minutes")} /><span class="hint">分钟</span>`}
          ${f.kind === "once" && html`<input class="field num" type="datetime-local" value=${f.at} onInput=${set("at")} />`}
          ${f.kind === "cron" && html`<input class="field mono" value=${f.cron} placeholder="0 8 * * 1-5" onInput=${set("cron")} />`}
        </div>
        ${f.kind === "weekly" && html`<div class="rule-days" role="group" aria-label="星期">
          ${DAY_PICKS.map((d) => html`<button type="button" class=${`chip${f.days.includes(d) ? " on" : ""}`} aria-pressed=${f.days.includes(d)} onClick=${() => toggleDay(d)}>${WEEK[d].slice(1)}</button>`)}
        </div>`}
      </div>`}
      <div class="rule-when">
        <span class="t-label">发到</span>
        ${!convs ? html`<${Spinner} />` : convs.length ? html`<${Seg} label="发到" options=${convOptions(convs, conv)} value=${conv} onChange=${setConv} />` : html`<span class="hint">先在微信、飞书或网页里和机器人说句话</span>`}
      </div>
      ${channel === "weixin" && html`<p class="hint">微信只在你 24 小时内发过消息时才能主动发给你；否则会在你下次发消息时一起送到，并显示在桌面端。</p>`}
    </div>
    <div class="actions">
      <${Button} onClick=${onClose}>取消<//>
      <${Button} variant="primary" loading=${busy} disabled=${!ok} onClick=${save}>${rule ? "保存" : "建好"}<//>
    </div>
  <//>`;
}
