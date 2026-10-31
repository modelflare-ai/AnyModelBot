// 需要你（3b）：所有机器人里在等你的事，一行一件，操作就在行里（回答、批准、重试…）；点标题那一行展开详情。
// 没事时侧栏没有这一行，直接打开这一页只有一句「没有需要你处理的事」。状态是"点 + 文字"：黄 = 等你，红 = 失败 / 登录过期。
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Button, Skeleton } from "../components/ui.js";
import { TaskDetail } from "../components/tasks.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";
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
 * 一件事：标题行（机器人 · 任务 · 状态 · 时间；只有一个机器人时不写机器人名）、第二行（问题 / 命令 / 原因）、行内操作。
 * onAct(action, body) 返回 Promise
 */
export function NeedItem({ item, multiBot, onAct, onOpenChat, onRelogin }) {
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const input = useRef(null);
  const opts = item.kind === "question" ? choices(item) : null;
  useEffect(() => {
    if (writing) requestAnimationFrame(() => input.current?.focus());
  }, [writing]);
  const act = async (action, body = {}, key = action) => {
    setBusy(key);
    try {
      await onAct(action, body);
    } catch (e) {
      failed(e);
    }
    setBusy("");
  };
  const send = () => text.trim() && act("answer", { text: text.trim() }, "text");
  // 详情一下就能看到：任务的展开处理过程；网页对话里的去对话
  const canOpen = !!item.taskId || item.channel === "web";
  const head = () => (item.taskId ? setOpen((v) => !v) : onOpenChat?.(item.botId));
  const [lead, ...rest] = [multiBot && item.botName, item.subject, item.status].filter(Boolean);
  const headIn = html`<span class="need-who"><b>${lead}</b>${rest.map((x) => ` · ${x}`).join("")}</span>
    <span class="need-when num">${fmtAgo(item.since)}</span>
    ${item.taskId && html`<${Icon} name="chevRight" size=${12} class="chev" />`}`;
  return html`<div class=${`need${open ? " open" : ""}`}>
    <span class=${`dot ${item.severity === "err" ? "err" : "warn"}`} aria-hidden="true"></span>
    ${canOpen
      ? html`<button type="button" class="need-head" aria-expanded=${item.taskId ? open : undefined} title=${item.taskId ? (open ? t("needs.collapse") : t("needs.viewTask")) : t("needs.openChat")} onClick=${head}>${headIn}</button>`
      : html`<div class="need-head">${headIn}</div>`}
    ${item.line && html`<div class=${`need-line selectable${item.kind === "approval" ? " mono" : ""}`}>${item.line}</div>`}
    <div class="need-actions">
      ${opts && opts.map((o, i) => html`<${Button} loading=${busy === `o${i}`} disabled=${!!busy} onClick=${() => act("answer", { text: String(i + 1) }, `o${i}`)}>${o.label}<//>`)}
      ${item.kind === "question" && !writing && html`<button type="button" class="text" disabled=${!!busy} onClick=${() => setWriting(true)}>${t("needs.reply")}</button>`}
      ${item.kind === "approval" && html`<${Button} variant="primary" loading=${busy === "approve"} disabled=${!!busy} onClick=${() => act("approve")}>${t("needs.approveOnce")}<//>
        <${Button} loading=${busy === "deny"} disabled=${!!busy} onClick=${() => act("deny")}>${t("needs.deny")}<//>`}
      ${item.kind === "failed" && html`<${Button} loading=${busy === "retry"} disabled=${!!busy} onClick=${() => act("retry")}>${t("common.retry")}<//>
        <button type="button" class="text danger" disabled=${!!busy} onClick=${() => act("stop")}>${t("needs.stop")}</button>`}
      ${item.kind === "delivery" && item.actions.includes("retry") && html`<${Button} loading=${busy === "retry"} disabled=${!!busy} onClick=${() => act("retry")}>${t("common.retry")}<//>`}
      ${item.kind === "delivery" && item.actions.includes("dismiss") && html`<button type="button" class="text" disabled=${!!busy} onClick=${() => act("dismiss")}>${t("needs.dismiss")}</button>`}
      ${item.kind === "login" && html`<${Button} onClick=${() => onRelogin?.(item.botId)}>${t("needs.relogin")}<//>`}
    </div>
    ${writing && html`<div class="need-reply">
      <input ref=${input} class="field" placeholder=${t("needs.answerPlaceholder")} value=${text} disabled=${busy === "text"}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => {
          if (e.key === "Enter" && !e.isComposing) send();
          if (e.key === "Escape") (e.stopPropagation(), setWriting(false));
        }} />
      <${Button} variant="primary" loading=${busy === "text"} disabled=${!text.trim()} onClick=${send}>${t("needs.send")}<//>
    </div>`}
    ${open && item.taskId && html`<div class="need-detail"><${TaskDetail} task=${{ id: item.taskId, title: item.subject, stage: { group: "needs" } }} /></div>`}
  </div>`;
}

/** 主区的「需要你」：每 3 秒看一次；处理掉的那件立刻消失（onChanged 让侧栏的件数也跟上） */
export function NeedsYouScreen({ multiBot, onChanged, onOpenChat, onRelogin }) {
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
        ${items.map((it) => html`<${NeedItem} key=${it.id} item=${it} multiBot=${multiBot} onAct=${onAct(it)} onOpenChat=${onOpenChat} onRelogin=${onRelogin} />`)}
      </div>`}
    </div>
  </div>`;
}
