// Modelflare 账户相关的弹层：登录、近 N 天用量、通知。设置页「Modelflare」分页里的行会打开它们。
import { useEffect, useState } from "preact/hooks";
import { html, Seg, Sheet, Skeleton } from "../components/ui.js";
import { AccountLogin } from "./onboarding.js";
import { api } from "../lib/api.js";
import { MF_SITE, tagLink, usd } from "../lib/links.js";
import { t } from "../lib/i18n.js";
import { fmtTime } from "../lib/format.js";

/** 通知里的链接：站内路径补成官网地址；只放行 https */
const notifLink = (link) => {
  const raw = !link ? "" : link.startsWith("/") && !link.startsWith("//") ? MF_SITE + link : /^https:\/\//.test(link) ? link : "";
  return raw && tagLink(raw, "amb_notice");
};

export function LoginSheet({ onClose, onSignedIn }) {
  return html`<${Sheet} title=${t("account.login.title")} onClose=${onClose}>
    <p class="hint">${t("account.login.hint")}</p>
    <${AccountLogin} onSignedIn=${(s) => { onSignedIn(s); onClose(); }} />
  <//>`;
}

const RANGES = () => [7, 30].map((n) => [n, t("account.usage.days", { n })]);

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
  return html`<${Sheet} title=${t("account.usage.title")} wide onClose=${onClose}>
    <div class="row compact"><div class="who"><div class="name">${d ? t("account.usage.total", { amount: usd(d.totalUsd) }) : t("common.reading")}</div></div>
      <${Seg} label=${t("account.usage.range")} options=${RANGES()} value=${days} onChange=${setDays} /></div>
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    ${!d && !err && html`<${Skeleton} w="100%" h=${120} />`}
    ${d && html`<div class="usage-days" role="img" aria-label=${t("account.usage.daily")}>
        ${d.days.map((x) => html`<div class="bar" title=${t("account.usage.bar", { date: x.date, amount: usd(x.usd), count: x.requests })}>
          <i style=${{ height: `${max > 0 ? Math.max(2, (x.usd / max) * 100) : 2}%` }}></i>${days <= 7 ? x.date.slice(5) : ""}
        </div>`)}
      </div>
      <div class="set-part">${t("account.usage.byModel")}</div>
      <div class="usage-models">
        ${d.models.slice(0, 12).map((m) => html`<div><span class="v">${m.model}</span><span class="n">${usd(m.usd)} · ${t("account.usage.requests", { count: m.requests })}</span></div>`)}
        ${!d.models.length && html`<p class="hint">${t("account.usage.empty")}</p>`}
      </div>`}
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>${t("common.close")}</button></div>
  <//>`;
}

export function NotificationsSheet({ onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/account/notifications").then((r) => setD(r.data || { items: [] })).catch((e) => setErr(e.message));
  }, []);
  return html`<${Sheet} title=${t("account.notifications.title")} wide onClose=${onClose}>
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    ${!d && !err && html`<${Skeleton} w="100%" h=${80} />`}
    ${d && !d.items.length && html`<p class="hint">${t("account.notifications.empty")}</p>`}
    ${d && d.items.map((n) => html`<div class=${`notif${n.read_at ? "" : " unread"}`}>
        ${n.title && html`<b>${n.title}</b>`}
        <p>${n.content}</p>
        <time>${fmtTime(n.created_at * 1000)}</time>
        ${notifLink(n.link) && html`<a class="text" href=${notifLink(n.link)} target="_blank" rel="noopener noreferrer">${t("account.notifications.details")}</a>`}
      </div>`)}
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>${t("common.close")}</button></div>
  <//>`;
}
