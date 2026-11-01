// 设置 › 连接：全局一份，所有机器人共用；同一个服务可以加多个账号，都能起别名。两类账号：
// - 聊天渠道（微信、飞书、Telegram、Slack、Discord）：从这里和机器人聊。账号有一个默认机器人，聊天时发一次 /bot 名字
//   就换过去，之后这个会话一直和它聊（src/core/routes.ts）。
// - 数据账号（Notion、飞书消息）：机器人能读写的账号。可以对任何机器人说「看我第一个飞书和第二个飞书的消息」，
//   序号就是这里显示的序号（src/agent/accounts.ts）。
// 令牌不会回到界面：接口只给名字、序号、状态和掩码。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Badge, Button, MenuButton, Sheet, Skeleton, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { channelName, sourceLabel } from "../lib/access.js";
import { fmtAgo, fmtTime } from "../lib/format.js";
import { confirmSheet, failed, saved, toast } from "../lib/store.js";
import { t } from "../lib/i18n.js";

const NOTION_PORTAL = "https://www.notion.so/developers";
const POLL_MS = 2000;
/** 等浏览器里授权最多轮询这么久，和授权页的有效期一致 */
const OAUTH_WAIT_MS = 10 * 60_000;

const serviceName = (service) => (service === "feishu" ? t("settings.connections.feishu") : "Notion");

/** 聊天渠道，按这个顺序列 */
const CHANNELS = ["weixin", "feishu", "telegram", "slack", "discord"];
/** Telegram、Slack、Discord：填 token 连上。key 和后端 MESSENGER_FIELDS 对应 */
const MESSENGER_FIELDS = {
  telegram: [{ key: "token", placeholder: "123456789:AA…" }],
  slack: [{ key: "botToken", placeholder: "xoxb-…" }, { key: "appToken", placeholder: "xapp-…" }],
  discord: [{ key: "token", placeholder: "" }],
};
/** 接入说明里 <code> 包着的权限名、事件名 */
const code = (s) => html`<code>${s}</code>`;
const MESSENGER_HINT = {
  telegram: () => ({ bot: code("@BotFather"), cmd: code("/newbot") }),
  slack: () => ({ conn: code("connections:write"), s1: code("chat:write"), s2: code("im:history"), s3: code("files:read"), s4: code("files:write"), event: code("message.im") }),
  discord: () => ({}),
};
const FEISHU_HINT = () => ({ event: code("im.message.receive_v1"), p1: code("im:message.p2p_msg:readonly"), p2: code("im:message:send_as_bot"), p3: code("cardkit:card:write"), p4: code("im:message.history:readonly") });
const ACTIVE_LOGIN = ["fetching", "wait", "scaned", "need_verifycode"];

/** 账号列表和正在打开的弹窗。渠道账号的状态会变（连上、过期、有人申请使用），所以一直刷新 */
export function useConnections() {
  const [accounts, setAccounts] = useState([]);
  const [channelAccounts, setChannelAccounts] = useState([]);
  const [sheet, setSheet] = useState(null);
  const reloadChannels = () => api("/channel-accounts").then((r) => setChannelAccounts(r.accounts)).catch(() => {});
  useEffect(() => {
    api("/connections").then((r) => setAccounts(r.accounts)).catch(failed);
    reloadChannels();
    const timer = setInterval(reloadChannels, 5000);
    return () => clearInterval(timer);
  }, []);
  return { accounts, setAccounts, channelAccounts, setChannelAccounts, reloadChannels, sheet, setSheet };
}

/** 设置页的行：先是聊天渠道，再是数据账号 */
export function connectionRows(conn, bots) {
  return [...channelRows(conn, bots), ...dataRows(conn)];
}

function channelRows({ channelAccounts, setSheet }, bots) {
  const botName = (id) => (bots || []).find((b) => b.id === id)?.name ?? id;
  const rows = [];
  for (const channel of CHANNELS) {
    rows.push({
      tab: "connections",
      id: `add-channel-${channel}`,
      name: channelName(channel),
      sub: t("settings.connections.channelSub"),
      keys: t("settings.connections.channelKeys", { channel: channelName(channel) }),
      ctl: html`<button type="button" class="btn" onClick=${() => setSheet({ kind: "channel", channel })}>${t("settings.connections.addAccount")}</button>`,
    });
    for (const a of channelAccounts.filter((x) => x.channel === channel)) {
      const parts = [a.status?.detail, t("settings.connections.defaultIs", { bot: botName(a.defaultBot) }), a.requests ? t("settings.connections.requests", { count: a.requests }) : ""];
      rows.push({
        tab: "connections",
        id: `channel-${channel}-${a.key}`,
        name: `${channelName(channel)} ${a.number} · ${a.label}`,
        sub: parts.filter(Boolean).join(" · "),
        keys: `${channelName(channel)} ${a.label}`,
        ctl: html`${a.status && html`<${Badge} s=${a.status.state} />`}
          <button type="button" class="text" onClick=${() => setSheet({ kind: "channel", channel, accountKey: a.key })}>${t("settings.connections.manage")}</button>`,
      });
    }
  }
  return rows;
}

/** 数据账号：每个服务一行添加入口，下面是这个服务已加的账号 */
function dataRows({ accounts, setAccounts, setSheet }) {
  const remove = async (a) => {
    if (!(await confirmSheet({ title: t("settings.connections.removeTitle", { name: a.label }), body: t("settings.connections.removeBody"), confirmLabel: t("settings.connections.remove"), danger: true }))) return;
    try {
      setAccounts((await api(`/connections/${a.id}`, { method: "DELETE" })).accounts);
      saved();
    } catch (e) {
      failed(e);
    }
  };
  const reauthorize = (a) => setSheet(a.service === "feishu" ? { kind: "feishu", mode: "oneclick" } : a.method === "token" ? { kind: "notion-token" } : { kind: "notion-oauth" });
  const rows = [];
  for (const service of ["notion", "feishu"]) {
    rows.push({
      tab: "connections",
      id: `add-${service}`,
      name: serviceName(service),
      sub: t(`settings.connections.${service}Sub`),
      keys: t(`settings.connections.${service}Keys`),
      ctl: html`<button type="button" class="btn primary" onClick=${() => setSheet(service === "feishu" ? { kind: "feishu", mode: "oneclick" } : { kind: "notion-oauth" })}>${t("settings.connections.oneClick")}</button>
        <button type="button" class="text" onClick=${() => setSheet(service === "feishu" ? { kind: "feishu", mode: "app" } : { kind: "notion-token" })}>${t(`settings.connections.${service}Other`)}</button>`,
    });
    for (const a of accounts.filter((x) => x.service === service)) {
      rows.push({
        tab: "connections",
        id: `account-${a.id}`,
        name: `${serviceName(service)} ${a.number} · ${a.label}`,
        sub: a.needsReauth ? t("settings.connections.needsReauth") : t(a.method === "token" ? "settings.connections.viaToken" : "settings.connections.viaOAuth"),
        keys: `${serviceName(service)} ${a.label}`,
        ctl: html`${a.needsReauth && html`<button type="button" class="btn primary" onClick=${() => reauthorize(a)}>${t("settings.connections.reauthorize")}</button>`}
          <button type="button" class="text" onClick=${() => setSheet({ kind: "rename", account: a })}>${t("settings.connections.rename")}</button>
          <button type="button" class="text danger" onClick=${() => remove(a)}>${t("settings.connections.remove")}</button>`,
      });
    }
  }
  return rows;
}

function ErrorLine({ text }) {
  return text ? html`<p class="hint" role="alert">${text}</p>` : null;
}

/** Notion 一键授权：打开系统浏览器，同意后跳回本机；这里等账号列表变化 */
function NotionOAuthSheet({ conn, onClose }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let stop = false;
    let timer;
    const before = JSON.stringify(conn.accounts);
    const until = Date.now() + OAUTH_WAIT_MS;
    const poll = async () => {
      if (stop) return;
      try {
        const r = await api("/connections");
        if (JSON.stringify(r.accounts) !== before) {
          conn.setAccounts(r.accounts);
          saved();
          onClose();
          return;
        }
      } catch {
        /* 下一轮再试 */
      }
      if (Date.now() > until) return setWaiting(false);
      timer = setTimeout(poll, POLL_MS);
    };
    api("/connections/notion/oauth", { method: "POST", body: {} })
      .then((r) => {
        if (stop) return;
        setUrl(r.url);
        window.open(r.url, "_blank", "noopener");
        timer = setTimeout(poll, POLL_MS);
      })
      .catch((e) => {
        setWaiting(false);
        setError(e.message || t("settings.connections.oauthFailed"));
      });
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  return html`<${Sheet} title=${t("settings.connections.notionOAuthTitle")} onClose=${onClose}>
    <p>${error ? "" : t("settings.connections.notionOAuthBody")}</p>
    <${ErrorLine} text=${error} />
    ${url && html`<p><a class="text" href=${url} target="_blank" rel="noopener noreferrer">${t("settings.connections.openAgain")}</a></p>`}
    ${waiting && html`<p class="hint"><${Spinner} /> ${t("settings.connections.waiting")}</p>`}
  <//>`;
}

function NotionTokenSheet({ conn, onClose }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      conn.setAccounts((await api("/connections/notion/token", { method: "POST", body: { token: token.trim() } })).accounts);
      saved();
      onClose();
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  };
  return html`<${Sheet} title=${t("settings.connections.notionTokenTitle")} onClose=${onClose}>
    <form onSubmit=${submit}>
      <p class="hint">${t("settings.connections.notionTokenHint")} <a class="text" href=${NOTION_PORTAL} target="_blank" rel="noopener noreferrer">${t("settings.connections.createToken")}</a></p>
      <label class="set-field"><span class="k">${t("settings.connections.tokenLabel")}</span>
        <input class="field mono" type="password" autocomplete="off" spellcheck="false" value=${token} onInput=${(e) => setToken(e.target.value)} />
      </label>
      <${ErrorLine} text=${error} />
      <div class="actions"><button type="submit" class="btn primary" disabled=${!token.trim() || busy}>${busy ? html`<${Spinner} />` : t("settings.connections.add")}</button></div>
    </form>
  <//>`;
}

/** 飞书的扫码流程：开始之后轮询状态，完成时回调；关掉就取消 */
function useFeishuFlow(onDone) {
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState("");
  const live = useRef(null);
  const timer = useRef(null);
  const poll = async () => {
    if (!live.current) return;
    try {
      const r = await api(`/connections/flows/${live.current}`);
      setFlow(r.flow);
      if (r.flow.state === "done") {
        live.current = null;
        onDone(r);
        return;
      }
      if (r.flow.state === "failed") {
        live.current = null;
        return;
      }
    } catch {
      /* 下一轮再试 */
    }
    timer.current = setTimeout(poll, POLL_MS);
  };
  const start = async (path, body) => {
    setError("");
    setFlow(null);
    try {
      const r = await api(path, { method: "POST", body });
      live.current = r.flow.id;
      setFlow(r.flow);
      timer.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (live.current) api(`/connections/flows/${live.current}`, { method: "DELETE" }).catch(() => {});
    },
    [],
  );
  return { flow, error: flow && flow.state === "failed" ? flow.error : error, start };
}

/** 流程进行中：二维码、链接、等待 */
function FlowSteps({ flow, text }) {
  return html`<p>${text}</p>
    ${flow.qr && html`<img class="panel-qr" src=${flow.qr} alt=${t("settings.connections.qrAlt")} />`}
    ${flow.url && html`<p><a class="text" href=${flow.url} target="_blank" rel="noopener noreferrer">${t("settings.connections.openInBrowser")}</a></p>`}
    <p class="hint"><${Spinner} /> ${t("settings.connections.waiting")}</p>`;
}

/** 飞书消息：一键授权要扫两次（创建应用、授权读消息）；用已有应用只扫第二次 */
function FeishuSheet({ conn, mode, onClose }) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const { flow, error, start } = useFeishuFlow((r) => {
    conn.setAccounts(r.accounts);
    saved();
    onClose();
  });
  const begin = (body) => start("/connections/feishu", body);
  useEffect(() => {
    if (mode === "oneclick") begin({});
  }, []);
  const steps = flow && (flow.state === "create-app" || flow.state === "authorize");
  return html`<${Sheet} title=${t("settings.connections.feishuTitle")} onClose=${onClose}>
    ${mode === "app" && !flow && html`<form onSubmit=${(e) => { e.preventDefault(); begin({ appId: appId.trim(), appSecret: appSecret.trim() }); }}>
      <p class="hint">${t("settings.connections.feishuAppHint")}</p>
      <label class="set-field"><span class="k">App ID</span><input class="field mono" value=${appId} placeholder="cli_xxxxxxxx" onInput=${(e) => setAppId(e.target.value)} /></label>
      <label class="set-field"><span class="k">App Secret</span><input class="field mono" type="password" autocomplete="off" value=${appSecret} onInput=${(e) => setAppSecret(e.target.value)} /></label>
      <div class="actions"><button type="submit" class="btn primary" disabled=${!appId.trim() || !appSecret.trim()}>${t("settings.connections.next")}</button></div>
    </form>`}
    ${steps && html`<${FlowSteps} flow=${flow} text=${t(flow.state === "create-app" ? "settings.connections.feishuStepCreate" : "settings.connections.feishuStepAuthorize")} />`}
    ${!flow && mode === "oneclick" && !error && html`<p class="hint"><${Spinner} /></p>`}
    <${ErrorLine} text=${error} />
    ${error && mode === "oneclick" && html`<div class="actions"><button type="button" class="btn" onClick=${() => begin({})}>${t("settings.connections.retry")}</button></div>`}
  <//>`;
}

/** 飞书聊天账号：默认扫码创建应用，也可以填已有的应用 */
function FeishuChatConnect({ accountKey, st, reload }) {
  const [manual, setManual] = useState(false);
  const path = `/channel-accounts/${encodeURIComponent(accountKey)}/feishu/one-click`;
  const { flow, error, start } = useFeishuFlow(() => {
    saved();
    reload();
  });
  useEffect(() => {
    if (!manual) start(path, {});
  }, [manual]);
  if (manual) return html`<${CredentialConnect} accountKey=${accountKey} channel="feishu" st=${st} reload=${reload} />`;
  return html`${flow && flow.state === "create-app" && flow.url && html`<${FlowSteps} flow=${flow} text=${t("settings.connections.feishuChatStep")} />`}
    ${(!flow || !flow.url) && !error && html`<p class="hint"><${Spinner} /></p>`}
    <${ErrorLine} text=${error} />
    <div class="actions">
      ${error && html`<button type="button" class="btn" onClick=${() => start(path, {})}>${t("settings.connections.retry")}</button>`}
      <button type="button" class="text" onClick=${() => setManual(true)}>${t("settings.connections.feishuOther")}</button>
    </div>`;
}

function RenameSheet({ conn, account, onClose }) {
  const [label, setLabel] = useState(account.label);
  const submit = async (e) => {
    e.preventDefault();
    try {
      conn.setAccounts((await api(`/connections/${account.id}`, { method: "PUT", body: { label: label.trim() } })).accounts);
      saved();
      onClose();
    } catch (err) {
      failed(err);
    }
  };
  return html`<${Sheet} title=${t("settings.connections.rename")} onClose=${onClose}>
    <form onSubmit=${submit}>
      <p class="hint">${t("settings.connections.renameHint")}</p>
      <label class="set-field"><span class="k">${t("settings.connections.nameLabel")}</span><input class="field" maxlength="80" value=${label} onInput=${(e) => setLabel(e.target.value)} /></label>
      <div class="actions"><button type="submit" class="btn primary" disabled=${!label.trim()}>${t("settings.connections.save")}</button></div>
    </form>
  <//>`;
}

/** 谁能用这个账号：使用请求、主人、允许名单、拒绝过的人。名单跟着账号走，能用这个账号的人可以和任何机器人聊 */
function AccessPanel({ accountKey, channel, onChanged }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState("");
  const base = `/channel-accounts/${encodeURIComponent(accountKey)}/access`;
  const load = () => api(base).then(setD).catch(() => {});
  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [accountKey]);
  const call = async (path, method) => {
    try {
      await api(`${base}/${path}`, method === "DELETE" ? { method } : { method, body: {} });
      saved();
      load();
      onChanged();
    } catch (e) {
      failed(e);
    }
  };
  if (!d) return html`<div class="list-head">${t("botSettings.access.head")}</div><div class="list"><div class="row"><${Skeleton} w="45%" /></div></div>`;
  const own = (x) => x.channel === channel;
  const requests = d.requests.filter(own);
  const allowed = d.entries.filter((e) => own(e) && e.status === "allowed");
  const denied = d.entries.filter((e) => own(e) && e.status === "denied");
  const owner = d.owners[channel];
  const decide = async (r, what) => {
    setBusy(r.id + what);
    await call(`${encodeURIComponent(r.id)}/${what}`, "POST");
    toast(t(what === "approve" ? "info.access.allowed" : "info.access.denied", { who: r.who }));
    setBusy("");
  };
  const remove = async (e) => {
    const isDenied = e.status === "denied";
    if (!(await confirmSheet({
      title: t(isDenied ? "botSettings.access.removeDeniedTitle" : "botSettings.access.revokeTitle", { who: e.who }),
      body: t(isDenied ? "botSettings.access.removeDeniedBody" : "botSettings.access.revokeBody"),
      confirmLabel: t("botSettings.access.remove"),
      danger: !isDenied,
    }))) return;
    call(encodeURIComponent(e.id), "DELETE");
  };
  const resetOwner = async () => {
    const name = channelName(channel);
    if (!(await confirmSheet({ title: t("botSettings.access.resetOwnerTitle", { channel: name }), body: t("botSettings.access.resetOwnerBody", { channel: name, who: owner.name }), confirmLabel: t("botSettings.access.reset") }))) return;
    call(`owner/${channel}`, "DELETE");
  };
  const line = (id, name, sub, children) => html`<div class="row" key=${id}><div class="who"><div class="name">${name}</div>${sub && html`<div class="sub">${sub}</div>`}</div><div class="ctl">${children}</div></div>`;
  return html`<div class="list-head">${t("botSettings.access.head")}${requests.length > 0 && html`<span class="badge count warn">${requests.length}</span>`}</div>
    ${requests.map((r) => html`<div key=${r.id} class="card">
      <div class="meta"><span>${t("info.access.wants", { code: html`<span class="num">${r.code}</span>` })}</span> <span class="hint">${fmtAgo(r.createdAt)}</span></div>
      <div class="q">${r.who}</div>
      ${r.text && html`<div class="q-detail selectable">${t("info.access.quote", { text: r.text })}</div>`}
      <div class="actions">
        <${Button} variant="primary" loading=${busy === r.id + "approve"} disabled=${!!busy} onClick=${() => decide(r, "approve")}>${t("info.access.allow")}</${Button}>
        <${Button} loading=${busy === r.id + "deny"} disabled=${!!busy} onClick=${() => decide(r, "deny")}>${t("info.access.deny")}</${Button}>
      </div>
    </div>`)}
    <div class="list">
      ${line("policy", t("botSettings.access.policy"))}
      ${owner && line("owner", t("botSettings.access.owner", { channel: channelName(channel) }), owner.name, owner.via !== "login" && html`<button type="button" class="text" onClick=${resetOwner}>${t("botSettings.access.reset")}</button>`)}
      ${allowed.map((e) => line(e.id, e.who, [sourceLabel(e.source), e.decidedAt ? fmtAgo(e.decidedAt) : ""].filter(Boolean).join(" · "), html`<button type="button" class="text danger" onClick=${() => remove(e)}>${t("botSettings.access.remove")}</button>`))}
      ${denied.map((e) => line(e.id, e.who, t("botSettings.access.deniedSub", { when: fmtAgo(e.decidedAt) }), html`<button type="button" class="text accent" onClick=${() => call(`${encodeURIComponent(e.id)}/approve`, "POST")}>${t("botSettings.access.allow")}</button>
        <button type="button" class="text" onClick=${() => remove(e)}>${t("botSettings.access.remove")}</button>`))}
    </div>`;
}

/** 微信：扫码登录。账号在扫码成功后才出现 */
function WeixinConnect({ accountKey, st, reload }) {
  const [code2, setCode] = useState("");
  const login = st?.login;
  const active = login && ACTIVE_LOGIN.includes(login.state);
  const base = `/channel-accounts/${encodeURIComponent(accountKey)}/weixin`;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(reload, 1500);
    return () => clearInterval(timer);
  }, [active]);
  const call = (path, body = {}) => api(base + path, { method: "POST", body }).then(reload).catch(failed);
  return html`${login && login.state !== "idle" && html`<div class="actions"><${Badge} s=${login.state} /><span class="hint">${login.message}</span></div>`}
    ${active && login.qrDataUrl && html`<img class="panel-qr" src=${login.qrDataUrl} alt=${t("info.weixin.qrAlt")} /><p class="hint">${t("info.weixin.scanHint")}</p>`}
    ${login && login.state === "need_verifycode" && html`<div class="actions"><input class="field" style="width:140px" placeholder=${t("info.weixin.verifyCode")} value=${code2} onInput=${(e) => setCode(e.target.value)} />
      <button type="button" class="btn" onClick=${() => call("/verify", { code: code2 }).then(() => setCode(""))}>${t("info.weixin.submit")}</button></div>`}
    ${st?.account && st.account.pausedUntil > Date.now() && html`<p class="hint">${t("info.weixin.pausedUntil", { time: fmtTime(st.account.pausedUntil) })}</p>`}
    <div class="actions">
      ${active
        ? html`<button type="button" class="btn" onClick=${() => call("/cancel")}>${t("common.cancel")}</button>`
        : html`<button type="button" class="btn primary" onClick=${() => call("/login")}>${st?.account ? t("info.weixin.relogin") : t("info.weixin.login")}</button>`}
    </div>
    ${st?.quota && st.quota.length > 0 && html`<p class="hint">${t("info.weixin.quota", { list: st.quota.map((q) => t("info.weixin.quotaItem", { user: q.userId.slice(0, 8), count: q.remaining })).join(t("info.weixin.quotaSep")) })}</p>`}`;
}

/** 飞书、Telegram、Slack、Discord：填凭据连上。已保存的留空表示不改 */
function CredentialConnect({ accountKey, channel, st, reload }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const feishu = channel === "feishu";
  const fields = feishu ? [{ key: "appId", label: "App ID", placeholder: "cli_xxxxxxxx", plain: true }, { key: "appSecret", label: "App Secret", placeholder: "" }] : MESSENGER_FIELDS[channel].map((f) => ({ ...f, label: t(`info.messenger.${channel}.${f.key}`) }));
  const account = st?.account;
  const saved0 = (key) => account?.saved?.[key];
  const value = (f) => values[f.key] ?? (f.plain ? account?.appId ?? "" : "");
  const filled = (f) => !!value(f).trim();
  const ready = account ? fields.some((f) => (values[f.key] || "").trim()) : fields.every(filled);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/channel-accounts/${encodeURIComponent(accountKey)}/${channel}`, { method: "PUT", body: feishu ? { appId: value(fields[0]).trim(), appSecret: (values.appSecret || "").trim() } : values });
      setValues({});
      saved();
      reload();
    } catch (err) {
      failed(err);
    }
    setBusy(false);
  };
  return html`<form onSubmit=${save}>
    ${fields.map((f) => html`<label class="set-field" key=${f.key}><span class="k">${f.label}${saved0(f.key) && html`<span class="hint">${t("info.messenger.secretSaved", { masked: saved0(f.key) })}</span>`}</span>
      <input class="field mono" type=${f.plain ? "text" : "password"} autocomplete="off" spellcheck="false" placeholder=${f.placeholder} value=${value(f)} onInput=${(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))} />
    </label>`)}
    <div class="actions"><button type="submit" class="btn primary" disabled=${!ready || busy}>${busy ? html`<${Spinner} />` : t("info.messenger.saveConnect")}</button></div>
    <p class="hint">${feishu ? t("info.feishu.setupHint", FEISHU_HINT()) : t(`info.messenger.${channel}.setupHint`, MESSENGER_HINT[channel]())}</p>
  </form>`;
}

/** 管理一个渠道账号（别名、默认机器人、凭据、谁能用），或添加新账号（key 先要一个，连上才真的存） */
function ChannelSheet({ conn, bots, channel, accountKey, onClose }) {
  const [key, setKey] = useState(accountKey || "");
  const [st, setSt] = useState(null);
  const account = conn.channelAccounts.find((a) => a.key === key && a.channel === channel);
  const [label, setLabel] = useState(account?.label ?? "");
  const reload = () => {
    conn.reloadChannels();
    if (key) api(`/channel-accounts/${encodeURIComponent(key)}/channels`).then((r) => setSt(r[channel])).catch(() => {});
  };
  useEffect(() => {
    if (!key) api("/channel-accounts/new-key", { method: "POST", body: {} }).then((r) => setKey(r.key)).catch(failed);
    else reload();
  }, [key]);
  useEffect(() => {
    if (account) setLabel(account.label);
  }, [account?.label]);
  const put = async (body) => {
    try {
      conn.setChannelAccounts((await api(`/channel-accounts/${encodeURIComponent(key)}/${channel}/settings`, { method: "PUT", body })).accounts);
      saved();
    } catch (e) {
      failed(e);
      if (account) setLabel(account.label);
    }
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: t("settings.connections.removeTitle", { name: account.label }), body: t("settings.connections.removeChannelBody"), confirmLabel: t("settings.connections.remove"), danger: true }))) return;
    try {
      await api(`/channel-accounts/${encodeURIComponent(key)}/${channel}`, { method: "DELETE" });
      conn.reloadChannels();
      saved();
      onClose();
    } catch (e) {
      failed(e);
    }
  };
  const title = account ? `${channelName(channel)} ${account.number} · ${account.label}` : t("settings.connections.addChannelTitle", { channel: channelName(channel) });
  return html`<${Sheet} title=${title} wide onClose=${onClose}>
    ${account && html`<label class="set-field"><span class="k">${t("settings.connections.nameLabel")}</span>
        <input class="field" maxlength="80" value=${label} onInput=${(e) => setLabel(e.target.value)} onBlur=${() => label.trim() !== account.label && put({ label: label.trim() })} />
      </label>
      <div class="set-field"><span class="k">${t("settings.connections.defaultBot")}</span>
        <${MenuButton} label=${t("settings.connections.defaultBot")} value=${account.defaultBot} width=${260} options=${(bots || []).map((b) => [b.id, b.name])} onChange=${(v) => put({ defaultBot: v })} />
        <p class="hint">${t("settings.connections.defaultBotHint")}</p>
      </div>`}
    ${key && st && (channel === "weixin"
      ? html`<${WeixinConnect} accountKey=${key} st=${st} reload=${reload} />`
      : channel === "feishu" && !st.account
        ? html`<${FeishuChatConnect} accountKey=${key} st=${st} reload=${reload} />`
        : html`<${CredentialConnect} key=${key} accountKey=${key} channel=${channel} st=${st} reload=${reload} />`)}
    ${account && html`<${AccessPanel} accountKey=${key} channel=${channel} onChanged=${conn.reloadChannels} />
      <div class="actions"><button type="button" class="text danger" onClick=${remove}>${t("settings.connections.removeAccount")}</button></div>`}
  <//>`;
}

export function ConnectionSheets({ conn, bots }) {
  const { sheet, setSheet } = conn;
  const close = () => setSheet(null);
  if (!sheet) return null;
  if (sheet.kind === "channel") return html`<${ChannelSheet} key=${`${sheet.channel}-${sheet.accountKey ?? "new"}`} conn=${conn} bots=${bots} channel=${sheet.channel} accountKey=${sheet.accountKey} onClose=${close} />`;
  if (sheet.kind === "notion-oauth") return html`<${NotionOAuthSheet} conn=${conn} onClose=${close} />`;
  if (sheet.kind === "notion-token") return html`<${NotionTokenSheet} conn=${conn} onClose=${close} />`;
  if (sheet.kind === "feishu") return html`<${FeishuSheet} conn=${conn} mode=${sheet.mode} onClose=${close} />`;
  if (sheet.kind === "rename") return html`<${RenameSheet} conn=${conn} account=${sheet.account} onClose=${close} />`;
  return null;
}
