// Modelflare 账户相关的弹层：登录、近 N 天用量、通知。设置页「Modelflare」分页里的行会打开它们。
import { useEffect, useState } from "preact/hooks";
import { html, Seg, Sheet, Skeleton } from "../components/ui.js";
import { AccountLogin } from "./onboarding.js";
import { api } from "../lib/api.js";
import { MF_SITE, usd } from "../lib/links.js";

/** 通知里的链接：站内路径补成官网地址；只放行 https */
const notifLink = (link) => (!link ? "" : link.startsWith("/") && !link.startsWith("//") ? MF_SITE + link : /^https:\/\//.test(link) ? link : "");

export function LoginSheet({ onClose, onSignedIn }) {
  return html`<${Sheet} title="登录 Modelflare 账户" onClose=${onClose}>
    <p class="hint">登录后会为这台电脑签发一把专用 API Key，替换现在手动填的 Key。</p>
    <${AccountLogin} hint=${false} onSignedIn=${(s) => { onSignedIn(s); onClose(); }} />
  <//>`;
}

const RANGES = [
  [7, "7 天"],
  [30, "30 天"],
];

export function UsageSheet({ onClose }) {
  const [days, setDays] = useState(7);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setD(null);
    setErr("");
    api(`/account/usage?days=${days}`).then(setD).catch((e) => setErr(e.message));
  }, [days]);
  const max = d ? Math.max(...d.days.map((x) => x.usd), 0) : 0;
  return html`<${Sheet} title="用量" wide onClose=${onClose}>
    <div class="row compact"><div class="who"><div class="name">${d ? `合计 ${usd(d.totalUsd)}` : "读取中…"}</div></div>
      <${Seg} label="范围" options=${RANGES} value=${days} onChange=${setDays} /></div>
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    ${!d && !err && html`<${Skeleton} w="100%" h=${120} />`}
    ${d && html`<div class="usage-days" role="img" aria-label="每日花费">
        ${d.days.map((x) => html`<div class="bar" title=${`${x.date}：${usd(x.usd)}，${x.requests} 次请求`}>
          <i style=${{ height: `${max > 0 ? Math.max(2, (x.usd / max) * 100) : 2}%` }}></i>${days <= 7 ? x.date.slice(5) : ""}
        </div>`)}
      </div>
      <div class="set-part">按模型</div>
      <div class="usage-models">
        ${d.models.slice(0, 12).map((m) => html`<div><span class="v">${m.model}</span><span class="n">${usd(m.usd)} · ${m.requests} 次</span></div>`)}
        ${!d.models.length && html`<p class="hint">这段时间没有用量</p>`}
      </div>`}
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>关闭</button></div>
  <//>`;
}

export function NotificationsSheet({ onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/account/notifications").then((r) => setD(r.data || { items: [] })).catch((e) => setErr(e.message));
  }, []);
  return html`<${Sheet} title="Modelflare 通知" wide onClose=${onClose}>
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    ${!d && !err && html`<${Skeleton} w="100%" h=${80} />`}
    ${d && !d.items.length && html`<p class="hint">没有通知</p>`}
    ${d && d.items.map((n) => html`<div class=${`notif${n.read_at ? "" : " unread"}`}>
        ${n.title && html`<b>${n.title}</b>`}
        <p>${n.content}</p>
        <time>${new Date(n.created_at * 1000).toLocaleString()}</time>
        ${notifLink(n.link) && html`<a class="text" href=${notifLink(n.link)} target="_blank" rel="noopener noreferrer">查看详情 ↗</a>`}
      </div>`)}
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>关闭</button></div>
  <//>`;
}
