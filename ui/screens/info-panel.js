// 右侧面板里关于这个机器人的几个标签（screens/work-panel.js 摆放）：概览（渠道、待审批、最近会话，目录 Bot 的说明）、任务、记忆。
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Badge, Button, Sheet, Skeleton } from "../components/ui.js";
import { ActivityLine, currentStep, useNow } from "../components/activity.js";
import { PromptCard } from "./chat.js";
import { api } from "../lib/api.js";
import { accountName } from "../lib/access.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { markDone } from "../lib/guide.js";
import { fmtAgo, fmtClock, fmtDur, fmtTime } from "../lib/format.js";
import { PausedLine, TaskGroup } from "../components/tasks.js";
import { DeliveredFiles } from "../components/files.js";
import { Markdown, Linkified } from "../components/markdown.js";
import { tr } from "../lib/catalog.js";
import { t, useLang } from "../lib/i18n.js";

export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fn().then((d) => (setData(d), setErr(""))).catch((e) => setErr(e.message)), deps);
  useEffect(() => {
    load();
    if (!ms) return;
    const timer = setInterval(load, ms);
    return () => clearInterval(timer);
  }, [load, ms]);
  return [data, err, load];
}

/** 渠道名（渲染时取，跟着界面语言）；不认识的渠道原样显示 id */
const channelName = (c) => ({ web: t("info.channel.web"), feishu: t("info.channel.feishu"), weixin: t("info.channel.weixin"), telegram: t("info.channel.telegram"), slack: t("info.channel.slack"), discord: t("info.channel.discord") })[c];

function MemorySection({ botId }) {
  const [d, err, reload] = usePoll(() => api(`/bots/${botId}/memory`), 0, [botId]);
  const forget = async (sc, text, topic) => {
    if (!(await confirmSheet({ title: t("info.memory.deleteTitle"), body: text, confirmLabel: t("common.delete"), danger: true }))) return;
    try {
      await api(`/bots/${botId}/memory/forget`, { method: "POST", body: { kind: sc.kind, id: sc.id, match: text, topic } });
      toast(t("info.memory.deleted"));
      reload();
    } catch (e) {
      failed(e);
    }
  };
  const all = d ? d.scopes.flatMap((sc) => [...sc.entries.map((e) => ({ sc, e })), ...sc.topics.flatMap((tp) => tp.entries.map((e) => ({ sc, e, topic: tp.name })))]) : [];
  return html`<div class="list-head">${t("info.memory.title")}<span class="grow"></span><button type="button" class="icon-btn" title=${t("common.refresh")} aria-label=${t("info.memory.refresh")} onClick=${reload}><${Icon} name="refresh" size="sm" /></button></div>
    <div class="list">
      ${!d && html`<div class="row"><span class="hint">${err || t("common.loading")}</span></div>`}
      ${d && !all.length && html`<div class="row"><span class="hint">${t("info.memory.empty")}</span></div>`}
      ${all.slice(0, 30).map(({ sc, e, topic }) => html`<div class="row compact">
        <div class="who"><div class="sub wrap selectable tone-fg t-control">${e.text}</div><div class="sub">${sc.label}${topic ? " · " + topic : ""}</div></div>
        <button type="button" class="icon-btn" title=${t("common.delete")} aria-label=${t("info.memory.delete")} onClick=${() => forget(sc, e.text, topic)}><${Icon} name="trash" size="sm" /></button>
      </div>`)}
    </div>`;
}

/** 会话里正在处理的那一轮：处理了多久、多久没进展、现在在做什么（可展开看步骤），以及"中止" */
function LiveTurn({ turn, convId }) {
  const now = useNow(true);
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    try {
      await api(`/conversations/${encodeURIComponent(convId)}/stop`, { method: "POST", body: {} });
    } catch (e) {
      failed(t("info.turn.stopFailed", { error: e.message }));
      setStopping(false);
    }
  };
  const idle = turn.lastProgress ? now - turn.lastProgress : 0;
  const cur = currentStep(turn.steps);
  // 一句话：有一步在做时是那一步（「运行 bash，已用 12 秒」），代理进程还没接手时说在等它
  const d = fmtDur(now - turn.since);
  const step = cur || (turn.lastProgress ? "" : t("info.turn.waitingAgent"));
  const label = step ? t("activity.stepFor", { step, d }) : t("info.turn.processing", { d });
  return html`<div class="transcript-turn">
    <${ActivityLine} label=${label} live steps=${turn.steps} />
    ${turn.interim?.length > 0 && html`<div class="transcript-msg"><div class="bubble selectable">${turn.interim.join("\n\n")}</div></div>`}
    <div class="cluster">
      ${idle >= 60_000 && html`<span class="hint">${t("info.turn.idle", { d: fmtDur(idle) })}</span>`}
      <span class="grow"></span>
      <${Button} variant="danger" size="sm" loading=${stopping} onClick=${stop}>${t("info.turn.stop")}</${Button}>
    </div>
  </div>`;
}

function ConversationSheet({ conv, onClose }) {
  const enc = encodeURIComponent(conv.id);
  const [d, , reload] = usePoll(() => api(`/conversations/${enc}/messages`), 0, [conv.id]);
  const [tr] = usePoll(() => api(`/conversations/${enc}/turn`), 2000, [conv.id]);
  const turn = tr?.turn;
  // 那一轮结束了：重新取消息，新回复和它的处理过程出现在列表里
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current && !turn) reload();
    busy.current = !!turn;
  }, [!!turn]);
  return html`<${Sheet} title=${`${channelName(conv.channel) || conv.channel} · ${conv.title || conv.peerId}`} wide onClose=${onClose}>
    <div class="transcript">
      ${!d && html`<span class="hint">${t("common.loading")}</span>`}
      ${d && !d.messages.length && !turn && html`<span class="hint">${t("info.noMessages")}</span>`}
      ${d && d.messages.map((m) => html`<div class=${`transcript-msg${m.role === "user" ? " user" : ""}`}>
        ${m.steps && html`<${ActivityLine} label=${t("info.turn.activity")} count=${m.steps} load=${() => api(`/conversations/${enc}/messages/${m.id}/activity`).then((x) => x.steps)} />`}
        <div class="bubble selectable">${m.role === "user" ? html`<${Linkified} text=${m.content} />` : html`<${Markdown} text=${[...(m.interim || []), m.content].join("\n\n")} conv=${conv.id} canOpen=${d.canOpen} />`}</div>
        <${DeliveredFiles} files=${m.files} conv=${conv.id} canOpen=${d.canOpen} />
        <div class="hint">${fmtTime(m.createdAt)}</div>
      </div>`)}
      ${turn && html`<${LiveTurn} key=${turn.since} turn=${turn} convId=${conv.id} />`}
    </div>
  <//>`;
}

/** 目录 Bot 的说明：能做什么、用到的技能（作者和许可证，链回原页面）、需要的权限。和面板上别的分组同一种写法 */
export function AboutSection({ entry }) {
  const lang = useLang();
  const notes = (list) => html`<div class="list">${list.map((x) => html`<div key=${x} class="row compact"><div class="who"><div class="sub wrap tone-fg t-control">${x}</div></div></div>`)}</div>`;
  return html`<div class="list-head">${t("botapp.info.what")}</div>
    ${notes(tr(entry.about, lang) || [])}
    ${entry.skills.length > 0 && html`<div class="list-head">${t("botapp.info.skills")}</div>
      <div class="list">${entry.skills.map((s) => html`<a key=${s.url} class="row compact clickable" href=${s.url} target="_blank" rel="noopener noreferrer">
        <div class="who"><div class="name">${s.name}</div><div class="sub">${s.author} · ${s.license}</div></div>
      </a>`)}</div>`}
    <div class="list-head">${t("botapp.info.perms")}</div>
    ${notes(entry.permissions.map((p) => t(`botapp.perm.${p}`)))}`;
}

/**
 * 「概览」标签：暂停的提示、待审批、渠道、最近会话；目录 Bot 在最后列出它的说明（AboutSection）。
 * 还没有实例的目录 Bot（bot 为空）只有说明。
 */
export function OverviewTab({ bot, entry, onOpenChat, onOpenConnections }) {
  return html`${bot && html`<${BotOverview} key=${bot.id} bot=${bot} onOpenChat=${onOpenChat} onOpenConnections=${onOpenConnections} />`}
    ${entry && html`<${AboutSection} entry=${entry} />`}`;
}

function BotOverview({ bot, onOpenChat, onOpenConnections }) {
  const [detail, , reloadDetail] = usePoll(() => api(`/bots/${bot.id}`), 5000, [bot.id]);
  const [channels] = usePoll(() => api("/channel-accounts"), 5000, []);
  const [appr, , reloadAppr] = usePoll(() => api(`/approvals?status=pending&bot=${encodeURIComponent(bot.id)}`), 4000, [bot.id]);
  const [convs] = usePoll(() => api(`/conversations?bot=${encodeURIComponent(bot.id)}`), 8000, [bot.id]);
  const [viewing, setViewing] = useState(null);
  const pending = (appr && appr.approvals) || [];
  // 上手清单：只有实际连接成功才完成，保存配置本身不算。
  const mine = (channels?.accounts || []).filter((a) => a.defaultBot === bot.id);
  useEffect(() => {
    if (channels?.accounts?.some((a) => a.status?.state === "connected")) markDone("weixin");
  }, [channels]);
  return html`${detail?.bot?.settings?.paused && html`<${PausedLine} onResume=${async () => (await api(`/bots/${bot.id}/settings`, { method: "PUT", body: { paused: false } }), reloadDetail())} />`}
      <div class="list-head">${t("info.channels")}</div>
      <div class="list">
        ${mine.map((a) => html`<div key=${`${a.channel}-${a.key}`} class="row clickable" role="button" tabindex="0" onClick=${() => onOpenConnections(`channel-${a.channel}-${a.key}`)} onKeyDown=${(e) => e.key === "Enter" && onOpenConnections(`channel-${a.channel}-${a.key}`)}>
          <div class="who"><div class="name">${accountName(a)}</div><div class="sub">${a.status?.detail || t("info.channelsDefault")}</div></div>
          <${Badge} s=${a.status?.state} />
        </div>`)}
        <div class="row clickable" data-guide="weixin" role="button" tabindex="0" onClick=${() => onOpenConnections()} onKeyDown=${(e) => e.key === "Enter" && onOpenConnections()}>
          <div class="who"><div class="name">${t("info.channelsManage")}</div><div class="sub">${t("info.channelsSub")}</div></div>
        </div>
      </div>

      <div class="list-head">${t("info.approvals")}${pending.length > 0 && html`<span class="badge count warn">${pending.length}</span>`}</div>
      ${pending.length
        ? html`<div class="stack">${pending.map((a) => html`<div key=${a.id} class="stack approval" style="--gap: var(--space-1)">
            <span class="hint">${channelName(a.conversationId.split(":")[1]) || ""} · ${fmtAgo(a.createdAt)} · ${t("info.due", { time: fmtClock(a.expiresAt) })}</span>
            <${PromptCard} requestId=${a.id} fallback="" />
          </div>`)}
          <button type="button" class="text" style="justify-self:start" onClick=${reloadAppr}>${t("common.refresh")}</button></div>`
        : html`<div class="list"><div class="row"><span class="hint">${t("info.noApprovals")}</span></div></div>`}

      <div class="list-head">${t("info.recent")}</div>
      <div class="list">
        ${!convs && html`<div class="row"><${Skeleton} w="60%" /></div>`}
        ${convs && !convs.conversations.length && html`<div class="row"><span class="hint">${t("info.noConvs")}</span></div>`}
        ${convs && convs.conversations.slice(0, 12).map((c) => html`<div class="row compact clickable" role="button" tabindex="0"
            onClick=${() => (c.channel === "web" ? onOpenChat() : setViewing(c))} onKeyDown=${(e) => e.key === "Enter" && (c.channel === "web" ? onOpenChat() : setViewing(c))}>
          <div class="who"><div class="name">${channelName(c.channel) || c.channel} · ${c.title || c.peerId}</div><div class="sub">${(c.lastMessage || "").replace(/^⚠️\s*/, "") || t("info.emptyMessage")}</div></div>
          <span class="hint num">${fmtAgo(c.updatedAt)}</span>
        </div>`)}
      </div>
    ${viewing && html`<${ConversationSheet} conv=${viewing} onClose=${() => setViewing(null)} />`}`;
}

/** 「任务」标签：这个机器人的任务和规则（components/tasks.js 的 TaskGroup）。任务来自的会话：网页的就是中间的对话，微信、飞书的在会话记录里看 */
export function TasksTab({ bot, onOpenChat }) {
  const [viewing, setViewing] = useState(null);
  const openConv = (task) => {
    if (task.channel === "web") return onOpenChat();
    api(`/conversations?bot=${encodeURIComponent(bot.id)}`)
      .then((d) => setViewing((d.conversations || []).find((c) => c.id === task.conversationId) || null))
      .catch(failed);
  };
  return html`<${TaskGroup} key=${bot.id} botId=${bot.id} onOpenConv=${openConv} head=${false} empty=${t("info.noTasks")} />
    ${viewing && html`<${ConversationSheet} conv=${viewing} onClose=${() => setViewing(null)} />`}`;
}

/** 「记忆」标签 */
export function MemoryTab({ bot }) {
  return html`<${MemorySection} key=${bot.id} botId=${bot.id} />`;
}
