// 信息面板：点悬浮胶囊或 ⌘⇧I 打开，面板自己的 ✕ 关闭，⚙ 进机器人设置。
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Badge, Button, Sheet, Skeleton } from "../components/ui.js";
import { ActivityLine, currentStep, useNow } from "../components/activity.js";
import { PromptCard } from "./chat.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { markDone } from "../lib/guide.js";
import { fmtAgo, fmtClock, fmtDur, fmtTime } from "../lib/format.js";
import { PausedLine, TaskGroup } from "../components/tasks.js";
import { DeliveredFiles } from "../components/files.js";
import { t } from "../lib/i18n.js";

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
        <div class="bubble selectable">${[...(m.interim || []), m.content].join("\n\n")}</div>
        <${DeliveredFiles} files=${m.files} conv=${conv.id} canOpen=${d.canOpen} />
        <div class="hint">${fmtTime(m.createdAt)}</div>
      </div>`)}
      ${turn && html`<${LiveTurn} key=${turn.since} turn=${turn} convId=${conv.id} />`}
    </div>
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>${t("common.close")}</button></div>
  <//>`;
}

export function InfoPanel({ bot, leaving, onClose, onOpenBotSettings, onOpenChat, onOpenConnections }) {
  const [detail, , reloadDetail] = usePoll(() => api(`/bots/${bot.id}`), 5000, [bot.id]);
  const [channels] = usePoll(() => api("/channel-accounts"), 5000, []);
  const [appr, , reloadAppr] = usePoll(() => api(`/approvals?status=pending&bot=${encodeURIComponent(bot.id)}`), 4000, [bot.id]);
  const [convs] = usePoll(() => api(`/conversations?bot=${encodeURIComponent(bot.id)}`), 8000, [bot.id]);
  const [viewing, setViewing] = useState(null);
  // 任务来自的会话：网页的就是这里的对话，微信、飞书的在会话记录里看
  const openConv = (task) => (task.channel === "web" ? onOpenChat() : setViewing((convs?.conversations || []).find((c) => c.id === task.conversationId) || null));
  const pending = (appr && appr.approvals) || [];
  // 上手清单：加了任何一个聊天渠道账号，就算接好了渠道
  const mine = (channels?.accounts || []).filter((a) => a.defaultBot === bot.id);
  useEffect(() => {
    if (channels?.accounts?.length) markDone("weixin");
  }, [channels]);
  // leaving：关上后还在播滑出的那一小会儿（main.js 的 usePresence），不再接收操作
  return html`<aside class=${`panel${leaving ? " leaving" : ""}`} aria-label=${t("info.aria")} inert=${leaving || undefined}>
    <div class="panel-head">
      <span class="title">${bot.name}</span>
      <button type="button" class="icon-btn" title=${t("info.botSettings")} aria-label=${t("info.botSettings")} onClick=${onOpenBotSettings}><${Icon} name="gear" size="md" /></button>
      <button type="button" class="icon-btn panel-close" title=${t("info.closeTitle")} aria-label=${t("info.closeAria")} onClick=${onClose}><${Icon} name="close" size="md" /></button>
    </div>
    <div class="panel-body">
      ${detail?.bot?.settings?.paused && html`<${PausedLine} onResume=${async () => (await api(`/bots/${bot.id}/settings`, { method: "PUT", body: { paused: false } }), reloadDetail())} />`}
      <div class="list-head">${t("info.channels")}</div>
      <div class="list">
        ${mine.map((a) => html`<div key=${`${a.channel}-${a.key}`} class="row clickable" role="button" tabindex="0" onClick=${onOpenConnections} onKeyDown=${(e) => e.key === "Enter" && onOpenConnections()}>
          <div class="who"><div class="name">${channelName(a.channel)} · ${a.label}</div><div class="sub">${a.status?.detail || t("info.channelsDefault")}</div></div>
          <${Badge} s=${a.status?.state} />
        </div>`)}
        <div class="row clickable" data-guide="weixin" role="button" tabindex="0" onClick=${onOpenConnections} onKeyDown=${(e) => e.key === "Enter" && onOpenConnections()}>
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

      <${TaskGroup} key=${bot.id} botId=${bot.id} onOpenConv=${openConv} />

      <${MemorySection} botId=${bot.id} />

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
    </div>
    ${viewing && html`<${ConversationSheet} conv=${viewing} onClose=${() => setViewing(null)} />`}
  </aside>`;
}
