// 设置 › 聊天渠道：全局一份，所有机器人共用；同一个渠道可以加多个账号，都能起别名。
// 聊天渠道（微信、飞书、Telegram、Slack、Discord）是从哪里和机器人聊：账号有一个默认机器人，聊天时发一次 /bot 名字
// 就换过去，之后这个会话一直和它聊（src/core/routes.ts）。
// 机器人能读写的应用（Notion、飞书云文档和消息、自定义 MCP…）不在这里，在「连接应用」（screens/apps.js）；
// 这一页原来放数据账号的位置只留一句说明和入口。这里的「飞书」是聊天渠道，和应用页里的飞书不是一回事。
// 令牌不会回到界面：接口只给名字、序号、状态和掩码。
//
// 添加和管理是两个弹窗。添加只做一件事：照步骤连上，然后告诉你下一步做什么；管理才有别名、默认机器人、谁能用、更换连接方式。
// 关掉添加弹窗就取消进行中的扫码，不会过一会儿冒出一个账号。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Badge, Button, Icon, MenuButton, Sheet, Skeleton, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { accountName, channelName, sourceLabel } from "../lib/access.js";
import { fmtAgo, fmtTime } from "../lib/format.js";
import { markDone } from "../lib/guide.js";
import { confirmSheet, failed, saved, toast } from "../lib/store.js";
import { has, t } from "../lib/i18n.js";

const POLL_MS = 2000;

/** 聊天渠道，按这个顺序列 */
const CHANNELS = ["weixin", "feishu", "telegram", "slack", "discord"];
/** Telegram、Slack、Discord：填 token 连上。key 和后端 MESSENGER_FIELDS 对应 */
const MESSENGER_FIELDS = {
  telegram: [{ key: "token", placeholder: "123456789:AA…" }],
  slack: [{ key: "botToken", placeholder: "xoxb-…" }, { key: "appToken", placeholder: "xapp-…" }],
  discord: [{ key: "token", placeholder: "" }],
};
/** 这几个状态要用户处理：账号行上写明原因，管理弹窗把修复入口放到最上面 */
const PROBLEM = ["login_required", "expired", "error"];
/** 微信登录结束但没成功：给重试 */
const LOGIN_ENDED = ["failed", "already_bound", "cancelled"];
/** 步骤里 <code> 包着的权限名、事件名，和外部链接 */
const code = (s) => html`<code>${s}</code>`;
const outLink = (href, text) => html`<a class="text" href=${href} target="_blank" rel="noopener noreferrer">${text}</a>`;
const STEP_PARAMS = {
  telegram: () => ({ bot: code("@BotFather"), cmd: code("/newbot") }),
  slack: () => ({ link: outLink("https://api.slack.com/apps", "api.slack.com/apps ↗"), conn: code("connections:write"), s1: code("chat:write"), s2: code("im:history"), s3: code("files:read"), s4: code("files:write"), event: code("message.im") }),
  discord: () => ({ link: outLink("https://discord.com/developers/applications", "Discord Developer Portal ↗") }),
  feishuApp: () => ({ link: outLink("https://open.feishu.cn/app", t("settings.connections.feishuPortal")), event: code("im.message.receive_v1"), p1: code("im:message.p2p_msg:readonly"), p2: code("im:message:send_as_bot"), p3: code("cardkit:card:write"), p4: code("im:message.history:readonly") }),
};
const stepsOf = (name, params) => {
  const out = [];
  for (let i = 0; has(`settings.connections.steps.${name}.${i}`); i++) out.push(t(`settings.connections.steps.${name}.${i}`, params));
  return out;
};
const accountUrl = (key, rest = "") => `/channel-accounts/${encodeURIComponent(key)}${rest}`;
/** 连上之后去聊天的链接：Telegram 和飞书能直接打开那个机器人，其他 App 没有这样的链接 */
function chatLink(channel, st) {
  const name = st?.account?.name;
  if (channel === "telegram" && name?.startsWith("@")) return `https://t.me/${name.slice(1)}`;
  if (channel === "feishu" && st?.account?.appId) return `https://${st.account.brand === "lark" ? "applink.larksuite.com" : "applink.feishu.cn"}/client/bot/open?appId=${encodeURIComponent(st.account.appId)}`;
  return "";
}

/**
 * 账号列表和正在打开的弹窗。渠道账号的状态会变（连上、过期、有人申请使用），所以一直刷新。
 * focusRow 指向一个渠道账号时（信息面板、「需要你」跳过来）直接打开它的管理弹窗；账号有问题就同时打开修复。
 */
export function useConnections(focusRow = "") {
  const [channelAccounts, setChannelAccounts] = useState([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [fresh, setFresh] = useState("");
  const freshTimer = useRef(0);
  const reloadChannels = () => api("/channel-accounts").then((r) => (setChannelAccounts(r.accounts), setChannelsLoaded(true))).catch(() => {});
  /** 新账号回到列表时闪一下，告诉你它在哪 */
  const flashRow = (id) => {
    clearTimeout(freshTimer.current);
    setFresh(id);
    requestAnimationFrame(() => document.getElementById(`set-${id}`)?.scrollIntoView({ block: "nearest" }));
    freshTimer.current = setTimeout(() => setFresh(""), 1300);
  };
  const updateChannel = async (key, channel, body) => {
    try {
      setChannelAccounts((await api(accountUrl(key, `/${channel}/settings`), { method: "PUT", body })).accounts);
      saved();
      return true;
    } catch (e) {
      failed(e);
      return false;
    }
  };
  useEffect(() => {
    reloadChannels();
    const timer = setInterval(reloadChannels, 5000);
    return () => (clearInterval(timer), clearTimeout(freshTimer.current));
  }, []);
  useEffect(() => {
    const add = /^add-channel-(weixin|feishu|telegram|slack|discord)$/.exec(focusRow);
    if (add) setSheet({ kind: "channel", channel: add[1] });
    const m = /^channel-([a-z]+)-(.+)$/.exec(focusRow);
    if (m) setSheet({ kind: "channel", channel: m[1], accountKey: m[2], fix: true });
  }, [focusRow]);
  return { channelAccounts, channelsLoaded, reloadChannels, updateChannel, sheet, setSheet, fresh, flashRow };
}

/** 设置页的行：聊天渠道，最后一行指向「连接应用」 */
export function connectionRows(conn, bots, onOpenApps) {
  return [...channelRows(conn, bots), ...dataRows(conn, onOpenApps)];
}

/** 已连接的账号在前，没连的渠道在后，最后一行是给已连接的渠道再加一个账号 */
function channelRows({ channelAccounts, setSheet }, bots) {
  const botName = (id) => (bots || []).find((b) => b.id === id)?.name ?? id;
  const base = { tab: "connections", group: "channels", groupNote: t("settings.connections.channelSub") };
  const keysOf = (channel) => t("settings.connections.channelKeys", { channel: channelName(channel) });
  const add = (channel) => setSheet({ kind: "channel", channel });
  const rows = [];
  for (const channel of CHANNELS) {
    for (const a of channelAccounts.filter((x) => x.channel === channel)) {
      const state = a.status?.state;
      const problem = PROBLEM.includes(state);
      const parts = [state !== "connected" ? a.status?.detail : "", t("settings.connections.defaultIs", { bot: botName(a.defaultBot) }), !problem && !a.hasOwner ? t("settings.connections.waitingOwner") : "", a.requests ? t("settings.connections.requests", { count: a.requests }) : ""];
      rows.push({
        ...base,
        id: `channel-${channel}-${a.key}`,
        name: accountName(a),
        sub: parts.filter(Boolean).join(" · "),
        keys: `${channelName(channel)} ${a.label}`,
        ctl: html`${a.status && html`<${Badge} s=${state} />`}
          ${problem && channel === "weixin" && html`<button type="button" class="btn" onClick=${() => setSheet({ kind: "channel", channel, accountKey: a.key, fix: true })}>${t("info.weixin.relogin")}</button>`}
          <button type="button" class="text" onClick=${() => setSheet({ kind: "channel", channel, accountKey: a.key })}>${t("settings.connections.manage")}</button>`,
      });
    }
  }
  const linked = CHANNELS.filter((channel) => channelAccounts.some((a) => a.channel === channel));
  for (const channel of CHANNELS.filter((c) => !linked.includes(c))) {
    rows.push({
      ...base,
      id: `add-channel-${channel}`,
      name: channelName(channel),
      sub: t(`settings.connections.how.${channel}`),
      keys: keysOf(channel),
      ctl: html`<button type="button" class="btn" onClick=${() => add(channel)}>${t("settings.connections.connect")}</button>`,
    });
  }
  if (linked.length) {
    rows.push({
      ...base,
      id: "add-channel-more",
      name: t("settings.connections.addAnother"),
      sub: t("settings.connections.addAnotherSub"),
      keys: linked.map(keysOf).join(" "),
      ctl: linked.map((channel) => html`<button type="button" class="text" key=${channel} onClick=${() => add(channel)}>${channelName(channel)}</button>`),
    });
  }
  return rows;
}

/** 数据账号（Notion、飞书消息）已经搬到「连接应用」：原来的位置留一句说明和一个入口，打开应用页的「已连接」 */
function dataRows(_conn, onOpenApps) {
  return [{
    tab: "connections",
    group: "data",
    id: "data-moved",
    name: t("settings.connections.dataMoved"),
    keys: t("settings.connections.dataMovedKeys"),
    ctl: html`<button type="button" class="btn" onClick=${() => onOpenApps?.()}>${t("settings.connections.openApps")}</button>`,
  }];
}

function ErrorLine({ text }) {
  return text ? html`<p class="hint tone-danger" role="alert">${text}</p>` : null;
}

/** 编号步骤。给了 current：做完的打勾，正在做的这步加重，没轮到的变灰；没给就是一份普通的说明 */
function Steps({ items, current }) {
  const tracked = current !== undefined;
  return html`<ol class="conn-steps">
    ${items.map((text, i) => html`<li key=${i} class=${!tracked ? "" : i < current ? "done" : i === current ? "now" : "todo"}>
      <span class="n num">${tracked && i < current ? html`<${Icon} name="check" size="xs" strong />` : i + 1}</span>
      <span class="txt">${text}</span>
    </li>`)}
  </ol>`;
}

const QrPlaceholder = () => html`<div class="qr-img empty"><${Spinner} /></div>`;

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

/** 流程进行中：步骤、二维码、等待、备用链接 */
function FlowSteps({ flow, items, current }) {
  return html`<div class="qr-flow">
    <${Steps} items=${items} current=${current} />
    ${flow?.qr ? html`<img class="qr-img" src=${flow.qr} alt=${t("settings.connections.qrAlt")} />` : html`<${QrPlaceholder} />`}
    ${flow?.url && html`<p class="qr-wait"><${Spinner} /> ${t("settings.connections.waitingScan")}</p>`}
    ${flow?.url && outLink(flow.url, t("settings.connections.openInBrowser"))}
  </div>`;
}

/** 添加飞书聊天账号的第一步：扫码创建应用 */
function FeishuScan({ accountKey, onConfirmed, onManual }) {
  const path = accountUrl(accountKey, "/feishu/one-click");
  const { flow, error, start } = useFeishuFlow(onConfirmed);
  useEffect(() => {
    start(path, {});
  }, []);
  return html`${!error && html`<${FlowSteps} flow=${flow?.state === "create-app" ? flow : null} items=${stepsOf("feishu")} />`}
    <${ErrorLine} text=${error} />
    <div class="actions">
      <button type="button" class="text" onClick=${onManual}>${t("settings.connections.useApp")}</button>
      ${error && html`<button type="button" class="btn primary" onClick=${() => start(path, {})}>${t("settings.connections.retry")}</button>`}
    </div>`;
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

/**
 * 微信扫码：一打开就取二维码，不用再点一次。扫完在手机上确认时，第一步打勾、第二步加重。
 * 卸载时取消：用户关了弹窗，这次登录就作废。
 */
function WeixinScan({ accountKey, onConfirmed }) {
  const [login, setLogin] = useState({ state: "fetching" });
  const [verifyCode, setVerifyCode] = useState("");
  const base = accountUrl(accountKey, "/weixin");
  const start = () => {
    setLogin({ state: "fetching" });
    api(`${base}/login`, { method: "POST", body: {} }).then(setLogin).catch((e) => setLogin({ state: "failed", message: e.message }));
  };
  useEffect(() => {
    start();
    return () => void api(`${base}/cancel`, { method: "POST", body: {} }).catch(() => {});
  }, []);
  const ended = LOGIN_ENDED.includes(login.state) || login.state === "confirmed";
  useEffect(() => {
    if (ended) return;
    // 取二维码的请求还没回来时，这里可能读到 idle：不算数
    const timer = setInterval(() => api(`${base}/login`).then((s) => s.state !== "idle" && setLogin(s)).catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [ended]);
  useEffect(() => {
    if (login.state === "confirmed") onConfirmed();
  }, [login.state]);
  // 交上去后后端马上回"正在验证"；输错了会回到要验证码、带上 codeError，输入框清空让用户重输
  const verify = (e) => {
    e.preventDefault();
    if (!verifyCode.trim() || login.verifying) return;
    api(`${base}/verify`, { method: "POST", body: { code: verifyCode } })
      .then((s) => (setVerifyCode(""), s?.state && s.state !== "idle" && setLogin(s)))
      .catch(failed);
  };
  const scanned = login.state === "scaned" || login.state === "need_verifycode";
  const needCode = login.state === "need_verifycode";
  const codeRef = useRef(null);
  useEffect(() => {
    if (needCode && !login.verifying) codeRef.current?.focus();
  }, [needCode, login.verifying, login.codeError]);
  if (LOGIN_ENDED.includes(login.state)) {
    return html`<div class="qr-flow"><${ErrorLine} text=${login.message} /><button type="button" class="btn primary" onClick=${start}>${t("settings.connections.retry")}</button></div>`;
  }
  // 等用户输入验证码时不转圈（在等人，不是在等机器）；输错了用红字
  const waitingOnUser = needCode && !login.verifying;
  return html`<div class="qr-flow">
    <${Steps} items=${stepsOf("weixin")} current=${scanned ? 1 : 0} />
    ${login.qrDataUrl
      ? html`<span class=${`qr-box${scanned ? " scanned" : ""}`}><img class="qr-img" src=${login.qrDataUrl} alt=${t("info.weixin.qrAlt")} />${scanned && html`<span class="qr-check"><${Icon} name="check" size="md" strong /></span>`}</span>`
      : html`<${QrPlaceholder} />`}
    ${waitingOnUser && login.codeError
      ? html`<${ErrorLine} text=${login.message} />`
      : html`<p class="qr-wait" role="status">${!waitingOnUser && html`<${Spinner} />`} ${login.message || t("settings.connections.waitingScan")}</p>`}
    ${needCode && html`<form class="qr-code" onSubmit=${verify}>
      <input class="field num" ref=${codeRef} inputmode="numeric" autocomplete="one-time-code" spellcheck="false" aria-label=${t("info.weixin.verifyCode")} placeholder=${t("info.weixin.verifyCode")}
        aria-invalid=${!!login.codeError} disabled=${!!login.verifying} value=${verifyCode} onInput=${(e) => setVerifyCode(e.target.value)} />
      <button type="submit" class="btn primary" disabled=${!verifyCode.trim() || !!login.verifying}>${login.verifying ? html`<${Spinner} />` : t("info.weixin.submit")}</button>
    </form>`}
  </div>`;
}

/** 飞书、Telegram、Slack、Discord：先照步骤拿到凭据，再填进来连上。已保存的留空表示不改；凭据不对的错误直接写在表单里 */
function CredentialForm({ accountKey, channel, st, onSaved }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feishu = channel === "feishu";
  const fields = feishu ? [{ key: "appId", label: "App ID", placeholder: "cli_xxxxxxxx", plain: true }, { key: "appSecret", label: "App Secret", placeholder: "" }] : MESSENGER_FIELDS[channel].map((f) => ({ ...f, label: t(`info.messenger.${channel}.${f.key}`) }));
  const account = st?.account;
  const saved0 = (key) => account?.saved?.[key];
  const value = (f) => values[f.key] ?? (f.plain ? account?.appId ?? "" : "");
  const filled = (f) => !!value(f).trim();
  const ready = account ? fields.some((f) => (values[f.key] || "").trim()) : fields.every(filled);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(accountUrl(accountKey, `/${channel}`), { method: "PUT", body: feishu ? { appId: value(fields[0]).trim(), appSecret: (values.appSecret || "").trim() } : values });
      setValues({});
      onSaved();
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(false);
  };
  const stepKey = feishu ? "feishuApp" : channel;
  return html`<form class="conn-form" onSubmit=${submit}>
    <${Steps} items=${stepsOf(stepKey, STEP_PARAMS[stepKey]())} />
    ${fields.map((f) => html`<label class="set-field" key=${f.key}><span class="k">${f.label}${saved0(f.key) && html`<span class="hint">${t("info.messenger.secretSaved", { masked: saved0(f.key) })}</span>`}</span>
      <input class="field mono" type=${f.plain ? "text" : "password"} autocomplete="off" spellcheck="false" placeholder=${f.placeholder} value=${value(f)} onInput=${(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))} />
    </label>`)}
    <${ErrorLine} text=${error} />
    <div class="actions"><button type="submit" class="btn primary" disabled=${!ready || busy}>${busy ? html`<${Spinner} />` : t(account ? "info.messenger.saveConnect" : "settings.connections.connect")}</button></div>
  </form>`;
}

/**
 * 连上之后的最后一步：告诉用户接下来做什么。
 * 除了微信（扫码的人就是主人），都是第一个发消息的人成为主人，所以一直盯着，发了就告诉用户绑好了。
 */
function ConnectedStep({ conn, bots, account, channel, onDone, onFix }) {
  const [st, setSt] = useState(null);
  const [owner, setOwner] = useState(undefined);
  const key = account.key;
  useEffect(() => {
    const load = () => {
      conn.reloadChannels();
      api(accountUrl(key, "/channels")).then((r) => setSt(r[channel])).catch(() => {});
      api(accountUrl(key, "/access")).then((d) => setOwner(d.owners[channel] || null)).catch(() => {});
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [key]);
  const name = channelName(channel);
  const state = account.status?.state;
  if (PROBLEM.includes(state)) {
    return html`<${ErrorLine} text=${account.status.detail} />
      <div class="actions">
        <button type="button" class="text" onClick=${onDone}>${t("common.close")}</button>
        <button type="button" class="btn primary" data-autofocus onClick=${onFix}>${t("settings.connections.fix")}</button>
      </div>`;
  }
  const list = bots || [];
  const link = chatLink(channel, st);
  const limit = `settings.connections.limit.${channel}`;
  return html`<div class="conn-done">
    <${Steps} items=${[t("settings.connections.tryIt", { channel: name }), ...(list.length > 1 ? [t("settings.connections.switchBot")] : [])]} />
    ${owner !== undefined && html`<p class="conn-note">
      ${owner ? html`<${Icon} name="check" size="sm" strong />` : html`<${Spinner} />`}
      <span>${!owner ? t("settings.connections.ownerWaiting") : owner.via === "login" ? t("settings.connections.ownerLogin", { channel: name }) : t("settings.connections.ownerBound", { who: owner.name })}</span>
    </p>`}
    ${has(limit) && html`<p class="hint">${t(limit)}</p>`}
    ${list.length > 1
      ? html`<div class="set-field"><span class="k">${t("settings.connections.defaultBot")}</span>
          <${MenuButton} label=${t("settings.connections.defaultBot")} value=${account.defaultBot} width=${260} align="left" options=${list.map((b) => [b.id, b.name])} onChange=${(v) => conn.updateChannel(key, channel, { defaultBot: v })} />
        </div>`
      : list.length === 1 && html`<p class="hint">${t("settings.connections.defaultIs", { bot: list[0].name })}</p>`}
    <div class="actions">
      ${link && html`<a class="btn" href=${link} target="_blank" rel="noopener noreferrer">${t("settings.connections.openChat", { channel: name })}</a>`}
      <button type="button" class="btn primary" data-autofocus onClick=${onDone}>${t("settings.connections.done")}</button>
    </div>
  </div>`;
}

/** 添加聊天账号：照步骤连上 → 下一步。账号的 key 先要一个，连上才真的存 */
function AddChannelSheet({ conn, bots, channel, onClose }) {
  const [key, setKey] = useState("");
  const [linked, setLinked] = useState(false);
  const [manual, setManual] = useState(false);
  const account = key ? conn.channelAccounts.find((a) => a.key === key && a.channel === channel) : null;
  useEffect(() => {
    api("/channel-accounts/new-key", { method: "POST", body: {} })
      .then((r) => setKey(r.key))
      .catch((e) => (failed(e), onClose()));
  }, []);
  const onLinked = () => {
    setLinked(true);
    conn.reloadChannels();
  };
  // 确认之后账号要过一会儿才进列表（微信还要存登录态、启动渠道）
  useEffect(() => {
    if (!linked || account) return;
    const timer = setInterval(conn.reloadChannels, 1000);
    return () => clearInterval(timer);
  }, [linked, !!account]);
  useEffect(() => {
    if (account?.status?.state === "connected") markDone("weixin");
  }, [account?.status?.state]);
  const close = () => {
    if (account) conn.flashRow(`channel-${channel}-${key}`);
    onClose();
  };
  const name = channelName(channel);
  const state = account?.status?.state;
  const title = !linked
    ? t("settings.connections.connectTitle", { channel: name })
    : PROBLEM.includes(state)
      ? t("settings.connections.failedTitle", { channel: name })
      : state === "connected"
        ? t("settings.connections.connectedTitle", { channel: name })
        : t("settings.connections.connectingTitle", { channel: name });
  const connect = !key
    ? html`<div class="qr-flow"><${QrPlaceholder} /></div>`
    : channel === "weixin"
      ? html`<${WeixinScan} accountKey=${key} onConfirmed=${onLinked} />`
      : channel === "feishu" && !manual
        ? html`<${FeishuScan} accountKey=${key} onConfirmed=${onLinked} onManual=${() => setManual(true)} />`
        : html`<${CredentialForm} accountKey=${key} channel=${channel} onSaved=${onLinked} />
          ${channel === "feishu" && html`<div class="actions"><button type="button" class="text" onClick=${() => setManual(false)}>${t("settings.connections.useScan")}</button></div>`}`;
  return html`<${Sheet} title=${title} sticky=${!linked} onClose=${close}>
    ${!linked
      ? connect
      : account
        ? html`<${ConnectedStep} conn=${conn} bots=${bots} account=${account} channel=${channel} onDone=${close} onFix=${() => conn.setSheet({ kind: "channel", channel, accountKey: key, fix: true })} />`
        : html`<p class="qr-wait"><${Spinner} /></p>`}
  <//>`;
}

/** 管理一个渠道账号：状态、别名、默认机器人、谁能用、连接方式。账号有问题时，修复入口排到最上面 */
function ManageChannelSheet({ conn, bots, channel, accountKey: key, fix, onClose }) {
  const account = conn.channelAccounts.find((a) => a.key === key && a.channel === channel);
  const [st, setSt] = useState(null);
  const [label, setLabel] = useState(account?.label ?? "");
  const [changing, setChanging] = useState(false);
  const reload = () => {
    conn.reloadChannels();
    api(accountUrl(key, "/channels")).then((r) => setSt(r[channel])).catch(() => {});
  };
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [key]);
  useEffect(() => {
    if (account) setLabel(account.label);
  }, [account?.label]);
  // 跳转过来的链接可能指向已经移除的账号
  useEffect(() => {
    if (conn.channelsLoaded && !account) onClose();
  }, [conn.channelsLoaded, !!account]);
  const state = account?.status?.state;
  const problem = PROBLEM.includes(state);
  useEffect(() => {
    if (fix && problem) setChanging(true);
  }, [fix, problem]);
  if (!account) return null;
  const commitLabel = async () => {
    const next = label.trim();
    if (next === account.label) return;
    if (!(await conn.updateChannel(key, channel, { label: next }))) setLabel(account.label);
  };
  const changed = () => {
    setChanging(false);
    saved();
    reload();
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: t("settings.connections.removeTitle", { name: account.label }), body: t("settings.connections.removeChannelBody"), confirmLabel: t("settings.connections.remove"), danger: true }))) return;
    try {
      await api(accountUrl(key, `/${channel}`), { method: "DELETE" });
      conn.reloadChannels();
      toast(t("settings.connections.removed", { name: account.label }));
      onClose();
    } catch (e) {
      failed(e);
    }
  };
  const via = channel === "weixin"
    ? { name: t("settings.connections.viaScan"), sub: "", action: t("info.weixin.relogin") }
    : channel === "feishu"
      ? { name: "App ID", sub: st?.account?.appId, action: t("settings.connections.changeApp") }
      : { name: t("settings.connections.tokenLabel"), sub: Object.values(st?.account?.saved || {}).join(" · "), action: t("settings.connections.changeToken") };
  const method = html`<div class="conn-method">
    <div class="list-head">${t("settings.connections.connection")}</div>
    <div class="list"><div class="row">
      <div class="who"><div class="name">${via.name}</div>${via.sub && html`<div class="sub">${via.sub}</div>`}</div>
      <div class="ctl"><button type="button" class=${`btn${problem && !changing ? " primary" : ""}`} onClick=${() => setChanging((v) => !v)}>${changing ? t("common.cancel") : via.action}</button></div>
    </div></div>
    ${changing && (channel === "weixin"
      ? html`<${WeixinScan} accountKey=${key} onConfirmed=${changed} />`
      : html`<${CredentialForm} accountKey=${key} channel=${channel} st=${st} onSaved=${changed} />`)}
    ${st?.account?.pausedUntil > Date.now() && html`<p class="hint">${t("info.weixin.pausedUntil", { time: fmtTime(st.account.pausedUntil) })}</p>`}
    ${st?.quota?.length > 0 && html`<p class="hint">${t("info.weixin.quota", { list: st.quota.map((q) => t("info.weixin.quotaItem", { user: q.userId.slice(0, 8), count: q.remaining })).join(t("info.weixin.quotaSep")) })}</p>`}
  </div>`;
  return html`<${Sheet} title=${accountName(account)} wide sticky=${changing} onClose=${onClose}>
    <div class="conn-state"><${Badge} s=${state} />${state !== "connected" && account.status?.detail && html`<span>${account.status.detail}</span>`}</div>
    ${problem && method}
    <label class="set-field"><span class="k">${t("settings.connections.nameLabel")}</span>
      <input class="field" maxlength="80" value=${label} onInput=${(e) => setLabel(e.target.value)} onBlur=${commitLabel} />
    </label>
    <div class="set-field"><span class="k">${t("settings.connections.defaultBot")}</span>
      <${MenuButton} label=${t("settings.connections.defaultBot")} value=${account.defaultBot} width=${260} align="left" options=${(bots || []).map((b) => [b.id, b.name])} onChange=${(v) => conn.updateChannel(key, channel, { defaultBot: v })} />
      <p class="hint">${t("settings.connections.defaultBotHint")}</p>
    </div>
    <${AccessPanel} accountKey=${key} channel=${channel} onChanged=${conn.reloadChannels} />
    ${!problem && method}
    <div class="actions">
      <button type="button" class="text danger" onClick=${remove}>${t("settings.connections.removeAccount")}</button>
      <span class="grow"></span>
      <button type="button" class="btn primary" data-autofocus onClick=${onClose}>${t("settings.connections.done")}</button>
    </div>
  <//>`;
}

export function ConnectionSheets({ conn, bots }) {
  const { sheet, setSheet } = conn;
  const close = () => setSheet(null);
  if (!sheet) return null;
  if (sheet.kind === "channel" && sheet.accountKey) return html`<${ManageChannelSheet} key=${`${sheet.channel}-${sheet.accountKey}`} conn=${conn} bots=${bots} channel=${sheet.channel} accountKey=${sheet.accountKey} fix=${sheet.fix} onClose=${close} />`;
  if (sheet.kind === "channel") return html`<${AddChannelSheet} key=${sheet.channel} conn=${conn} bots=${bots} channel=${sheet.channel} onClose=${close} />`;
  return null;
}
