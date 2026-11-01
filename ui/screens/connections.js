// 设置 › 连接：已授权账号。全局一份，所有机器人共用；同一个服务可以加多个账号。
// 用户可以对任何机器人说「看我第一个飞书和第二个飞书的消息」，序号就是这里显示的序号。
// 令牌不会回到界面：接口只给名字、序号和状态（src/agent/accounts.ts）。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Sheet, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, saved } from "../lib/store.js";
import { t } from "../lib/i18n.js";

const NOTION_PORTAL = "https://www.notion.so/developers";
const POLL_MS = 2000;
/** 等浏览器里授权最多轮询这么久，和授权页的有效期一致 */
const OAUTH_WAIT_MS = 10 * 60_000;

const serviceName = (service) => (service === "feishu" ? t("settings.connections.feishu") : "Notion");

/** 账号列表和正在打开的弹窗 */
export function useConnections() {
  const [accounts, setAccounts] = useState([]);
  const [sheet, setSheet] = useState(null);
  useEffect(() => {
    api("/connections").then((r) => setAccounts(r.accounts)).catch(failed);
  }, []);
  return { accounts, setAccounts, sheet, setSheet };
}

/** 设置页的行：每个服务一行添加入口，下面是这个服务已加的账号 */
export function connectionRows({ accounts, setAccounts, setSheet }) {
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

/** 飞书：一键授权要扫两次（创建应用、授权读消息）；用已有应用只扫第二次 */
function FeishuSheet({ conn, mode, onClose }) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
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
        conn.setAccounts(r.accounts);
        saved();
        onClose();
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
  const start = async (body) => {
    setError("");
    try {
      const r = await api("/connections/feishu", { method: "POST", body });
      live.current = r.flow.id;
      setFlow(r.flow);
      timer.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  useEffect(() => {
    if (mode === "oneclick") start({});
    return () => {
      clearTimeout(timer.current);
      if (live.current) api(`/connections/flows/${live.current}`, { method: "DELETE" }).catch(() => {});
    };
  }, []);

  const failedText = flow && flow.state === "failed" ? flow.error : error;
  const steps = flow && (flow.state === "create-app" || flow.state === "authorize");
  return html`<${Sheet} title=${t("settings.connections.feishuTitle")} onClose=${onClose}>
    ${mode === "app" && !flow && html`<form onSubmit=${(e) => { e.preventDefault(); start({ appId: appId.trim(), appSecret: appSecret.trim() }); }}>
      <p class="hint">${t("settings.connections.feishuAppHint")}</p>
      <label class="set-field"><span class="k">App ID</span><input class="field mono" value=${appId} placeholder="cli_xxxxxxxx" onInput=${(e) => setAppId(e.target.value)} /></label>
      <label class="set-field"><span class="k">App Secret</span><input class="field mono" type="password" autocomplete="off" value=${appSecret} onInput=${(e) => setAppSecret(e.target.value)} /></label>
      <div class="actions"><button type="submit" class="btn primary" disabled=${!appId.trim() || !appSecret.trim()}>${t("settings.connections.next")}</button></div>
    </form>`}
    ${steps && html`<p>${t(flow.state === "create-app" ? "settings.connections.feishuStepCreate" : "settings.connections.feishuStepAuthorize")}</p>
      ${flow.qr && html`<img class="panel-qr" src=${flow.qr} alt=${t("settings.connections.qrAlt")} />`}
      ${flow.url && html`<p><a class="text" href=${flow.url} target="_blank" rel="noopener noreferrer">${t("settings.connections.openInBrowser")}</a></p>`}
      <p class="hint"><${Spinner} /> ${t("settings.connections.waiting")}</p>`}
    ${!flow && mode === "oneclick" && !failedText && html`<p class="hint"><${Spinner} /></p>`}
    <${ErrorLine} text=${failedText} />
    ${failedText && html`<div class="actions"><button type="button" class="btn" onClick=${() => { setFlow(null); setError(""); if (mode === "oneclick") start({}); }}>${t("settings.connections.retry")}</button></div>`}
  <//>`;
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

export function ConnectionSheets({ conn }) {
  const { sheet, setSheet } = conn;
  const close = () => setSheet(null);
  if (!sheet) return null;
  if (sheet.kind === "notion-oauth") return html`<${NotionOAuthSheet} conn=${conn} onClose=${close} />`;
  if (sheet.kind === "notion-token") return html`<${NotionTokenSheet} conn=${conn} onClose=${close} />`;
  if (sheet.kind === "feishu") return html`<${FeishuSheet} conn=${conn} mode=${sheet.mode} onClose=${close} />`;
  if (sheet.kind === "rename") return html`<${RenameSheet} conn=${conn} account=${sheet.account} onClose=${close} />`;
  return null;
}
