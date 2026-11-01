// 需要你（3b）：所有机器人里在等你的事，一行一件，操作就在行里（回答、批准、重试、加预算继续…）；点标题那一行展开详情。
// 任务问的有默认回答的问题（任务接着在做）：问题下面一句不回复会怎样（「不回复就按中文做」）。
// 没事时侧栏没有这一行，直接打开这一页只有一句「没有需要你处理的事」。状态是"点 + 文字"：黄 = 等你，红 = 失败 / 登录过期。
// 预算（3e）：任务预算用完是一个提问（「已用约 $1.00，再给 $1 继续？」继续 / 停止）；规则本月预算用完可以继续；
// 机器人的预算留给聊天、后台工作停着的，去机器人设置调整预算。
// 观察够了的规则（用户选了观察的）：问要不要改为执行（第二行是最近那次的「本会发送：…」），可以改为执行或继续观察；排在最后，不推送、不发系统通知。
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Button, Skeleton } from "../components/ui.js";
import { TaskDetail } from "../components/tasks.js";
import { RuleDetail } from "../components/rules.js";
import { api } from "../lib/api.js";
import { failed, toast } from "../lib/store.js";
import { fmtAgo } from "../lib/format.js";
import { t } from "../lib/i18n.js";

/** 侧栏机器人列表上方的「需要你」：只有件数大于 0 时才有 */
export function NeedsRow({ count, on, onClick }) {
  if (!count) return null;
  return html`<button type="button" class=${`needs-row${on ? " sel" : ""}`} aria-current=${on ? "page" : undefined} onClick=${onClick}>
    <span class="mark" aria-hidden="true"><span class="dot warn"></span></span><span class="label">${t("needs.title")}</span><span class="badge count warn">${count}</span>
  </button>`;
}

/** 单选、有选项的一个问题：选项直接是按钮；其余（多选、没有选项、几个问题）写一句话回答 */
function choices(item) {
  const qs = item.questions || [];
  const q = qs.length === 1 ? qs[0] : null;
  return q && !q.multiSelect && (q.options || []).length ? q.options : null;
}

/**
 * 一件事：标题行（一句话和时间：「小蓝的「GPU 价格调研」在等你回答」；只有一个机器人时不写机器人名）、第二行（问题 / 命令 / 原因）、
 * 行内操作。onAct(action, body) 返回 Promise
 */
export function NeedItem({ item, multiBot, onAct, onOpenChat, onRelogin, onOpenBotSettings }) {
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const input = useRef(null);
  const opts = item.kind === "question" ? choices(item) : null;
  const can = (a) => (item.actions || []).includes(a);
  useEffect(() => {
    if (writing) requestAnimationFrame(() => input.current?.focus());
  }, [writing]);
  const act = async (action, body = {}, key = action) => {
    setBusy(key);
    let ok = false;
    try {
      await onAct(action, body);
      ok = true;
    } catch (e) {
      failed(e);
    }
    setBusy("");
    return ok;
  };
  const send = () => text.trim() && act("answer", { text: text.trim() }, "text");
  // 详情一下就能看到：任务的展开处理过程，规则的展开运行记录；网页对话里的去对话
  const expands = !!item.taskId || !!item.ruleId;
  const canOpen = expands || item.channel === "web";
  const head = () => (expands ? setOpen((v) => !v) : onOpenChat?.(item.botId));
  // 几个机器人时前面加上名字；那一句以数字、字母开头时中间空一格（「小蓝的 1 条结果…」）
  const who = multiBot ? t(/^[0-9A-Za-z]/.test(item.head) ? "needs.headSpaced" : "needs.head", { bot: html`<b>${item.botName}</b>`, what: item.head }) : item.head;
  const headIn = html`<span class="need-who">${who}</span>
    <span class="need-when num">${fmtAgo(item.since)}</span>
    ${expands && html`<${Icon} name="chevRight" size=${12} class="chev" />`}`;
  return html`<div class=${`need${open ? " open" : ""}`}>
    <span class=${`dot ${item.severity === "err" ? "err" : "warn"}`} aria-hidden="true"></span>
    ${canOpen
      ? html`<button type="button" class="need-head" aria-expanded=${expands ? open : undefined} title=${expands ? (open ? t("needs.collapse") : item.ruleId ? t("needs.viewRule") : t("needs.viewTask")) : t("needs.openChat")} onClick=${head}>${headIn}</button>`
      : html`<div class="need-head">${headIn}</div>`}
    ${item.line && html`<div class=${`need-line selectable${item.kind === "approval" ? " mono" : ""}`}>${item.line}</div>`}
    ${item.note && html`<div class="need-note">${item.note}</div>`}
    <div class="need-actions">
      ${opts && opts.map((o, i) => html`<${Button} loading=${busy === `o${i}`} disabled=${!!busy} onClick=${() => act("answer", { text: String(i + 1) }, `o${i}`)}>${o.label}<//>`)}
      ${item.kind === "question" && !writing && html`<button type="button" class="text" disabled=${!!busy} onClick=${() => setWriting(true)}>${t("needs.reply")}</button>`}
      ${item.kind === "approval" && html`<${Button} variant="primary" loading=${busy === "approve"} disabled=${!!busy} onClick=${() => act("approve")}>${t("needs.approveOnce")}<//>
        <${Button} loading=${busy === "deny"} disabled=${!!busy} onClick=${() => act("deny")}>${t("needs.deny")}<//>`}
      ${item.kind === "failed" && (can("continue")
        ? html`<${Button} variant="primary" loading=${busy === "continue"} disabled=${!!busy} onClick=${() => act("continue")}>${t("needs.continue")}<//>`
        : html`<${Button} loading=${busy === "retry"} disabled=${!!busy} onClick=${() => act("retry")}>${t("common.retry")}<//>`)}
      ${item.kind === "failed" && html`<button type="button" class="text danger" disabled=${!!busy} onClick=${() => act("stop")}>${t("needs.stop")}</button>`}
      ${item.kind === "rule" && (can("continue")
        ? html`<${Button} variant="primary" loading=${busy === "continue"} disabled=${!!busy} onClick=${() => act("continue")}>${t("needs.continue")}<//>`
        : html`<${Button} loading=${busy === "retry"} disabled=${!!busy} onClick=${() => act("retry")}>${t("common.retry")}<//>`)}
      ${item.kind === "budget" && html`<${Button} onClick=${() => onOpenBotSettings?.(item.botId, "budget")}>${t("needs.raiseBudget")}<//>`}
      ${item.kind === "delivery" && item.actions.includes("retry") && html`<${Button} loading=${busy === "retry"} disabled=${!!busy} onClick=${() => act("retry")}>${t("common.retry")}<//>`}
      ${item.kind === "delivery" && item.actions.includes("dismiss") && html`<button type="button" class="text" disabled=${!!busy} onClick=${() => act("dismiss")}>${t("needs.dismiss")}</button>`}
      ${item.kind === "login" && html`<${Button} onClick=${() => onRelogin?.(item.botId)}>${t("needs.relogin")}<//>`}
      ${item.kind === "suggest" && html`<${Button} loading=${busy === "act"} disabled=${!!busy} onClick=${async () => (await act("act")) && toast(t("rules.nowActs", { title: item.ruleTitle }))}>${t("needs.toAct")}<//>
        <button type="button" class="text" disabled=${!!busy} onClick=${() => act("dismiss")}>${t("needs.keepObserving")}</button>`}
    </div>
    ${writing && html`<div class="need-reply">
      <input ref=${input} class="field" placeholder=${t("needs.answerPlaceholder")} value=${text} disabled=${busy === "text"}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => {
          if (e.key === "Enter" && !e.isComposing) send();
          if (e.key === "Escape") (e.stopPropagation(), setWriting(false));
        }} />
      <${Button} variant="primary" loading=${busy === "text"} disabled=${!text.trim()} onClick=${send}>${t("needs.send")}<//>
    </div>`}
    ${open && item.taskId && html`<div class="need-detail"><${TaskDetail} task=${{ id: item.taskId, title: item.subject, stage: { group: "needs" } }} question=${false} /></div>`}
    ${open && item.ruleId && html`<div class="need-detail"><${RuleOpen} id=${item.ruleId} /></div>`}
  </div>`;
}

/** 「需要你」里展开的规则：取到最新的规则再画详情（运行记录、模式、重试） */
function RuleOpen({ id }) {
  const [rule, setRule] = useState(null);
  const load = useCallback(() => api(`/rules/${encodeURIComponent(id)}`).then((d) => setRule(d.rule)).catch(() => setRule(false)), [id]);
  useEffect(() => void load(), [load]);
  if (rule === false) return html`<span class="hint">${t("rules.gone")}</span>`;
  return rule ? html`<${RuleDetail} rule=${rule} onChanged=${load} />` : html`<${Skeleton} w="60%" />`;
}

/** 主区的「需要你」：每 3 秒看一次；处理掉的那件立刻消失（onChanged 让侧栏的件数也跟上） */
export function NeedsYouScreen({ multiBot, onChanged, onOpenChat, onRelogin, onOpenBotSettings }) {
  const [items, setItems] = useState(null);
  const load = useCallback(() => api("/attention").then((d) => setItems(d.items || [])).catch(() => setItems((v) => v || [])), []);
  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    return () => clearInterval(timer);
  }, [load]);
  const onAct = (it) => async (action, body) => {
    const d = await api(`/attention/${encodeURIComponent(it.id)}/${action}`, { method: "POST", body });
    setItems(d.items || []);
    onChanged?.();
  };
  return html`<div class="settings needs view" data-screen="needs">
    <div class="set-head"><h1 class="set-title">${t("needs.title")}</h1></div>
    <div class="set-body">
      ${!items && html`<div class="list needs-list"><div class="need"><${Skeleton} w="50%" /><${Skeleton} w="70%" /></div></div>`}
      ${items && !items.length && html`<p class="set-none">${t("needs.none")}</p>`}
      ${items && items.length > 0 && html`<div class="list needs-list">
        ${items.map((it) => html`<${NeedItem} key=${it.id} item=${it} multiBot=${multiBot} onAct=${onAct(it)} onOpenChat=${onOpenChat} onRelogin=${onRelogin} onOpenBotSettings=${onOpenBotSettings} />`)}
      </div>`}
    </div>
  </div>`;
}
