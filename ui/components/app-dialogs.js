// 连接应用的三个弹窗（全局一个，见 main.js 的 AppDialogHost；从应用页、机器人设置、对话里的卡片、「需要你」都能打开）：
// - 连接内置应用（ConnectSheet）：按应用预置好默认的认证方式和说明；授权登录点开就去浏览器，其余粘贴令牌 / Key / 专属链接。
//   给了 accountId 是修复已有的账号（重新授权、修改密钥、更新链接），别名和序号不变。
// - 管理（ManageSheet）：状态和账号、别名、主账号、谁能用、修复、断开；自定义连接器还有开关、编辑、每个工具的类别。
// - 自定义连接器在 custom-connector.js。
// 关掉连接弹窗就取消这一次连接：授权登录的流程作废，不会过一会儿冒出一个账号。令牌不会回到界面。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, CopyButton, Icon, IconButton, MenuButton, Notice, Seg, Sheet, Spinner, Switch } from "./ui.js";
import { AppMark } from "./app-mark.js";
import { api } from "../lib/api.js";
import { ATTENTION, appDialog, appLabel, appsStore, builtinName, closeAppDialog, methodLabel, openConnect, openCustom, repairActions, setApps, stateText, stateTone, stepsOf } from "../lib/apps.js";
import { confirmSheet, failed, saved, toast, useStore } from "../lib/store.js";
import { sendToChat } from "../lib/guide.js";
import { has, t, useLang } from "../lib/i18n.js";
import { CustomConnectorSheet } from "./custom-connector.js";

const POLL_MS = 2000;
/** 等浏览器里授权最多这么久，和授权页的有效期一致 */
const OAUTH_WAIT_MS = 10 * 60_000;
const outLink = (href, text) => html`<a class="text" href=${href} target="_blank" rel="noopener noreferrer">${text} ↗</a>`;

export function ErrorLine({ text }) {
  return text ? html`<p class="hint tone-danger" role="alert">${text}</p>` : null;
}

/** 密钥输入框：默认打码，可以一键显示 / 隐藏 */
export function SecretInput({ value, onInput, placeholder, label, autoFocus, disabled }) {
  const [show, setShow] = useState(false);
  return html`<span class="field-wrap">
    <input class="field mono" type=${show ? "text" : "password"} autocomplete="off" spellcheck="false" autocapitalize="off" data-autofocus=${autoFocus ? "" : undefined}
      aria-label=${label} placeholder=${placeholder} value=${value} disabled=${disabled} onInput=${(e) => onInput(e.target.value)} />
    <span class="tail"><${IconButton} icon=${show ? "eyeOff" : "eye"} label=${t(show ? "apps.hide" : "apps.show")} onClick=${() => setShow((v) => !v)} /></span>
  </span>`;
}

/** 编号步骤（和设置里添加聊天渠道的步骤同一套样式） */
function Steps({ items }) {
  if (!items.length) return null;
  return html`<ol class="conn-steps">${items.map((text, i) => html`<li key=${i}><span class="n num">${i + 1}</span><span class="txt">${text}</span></li>`)}</ol>`;
}

/**
 * 授权登录的流程：打开授权页、轮询、回跳地址的粘贴兜底。begin(flow) 开始；关掉（卸载）就取消。
 * 状态：waiting 等用户在浏览器里同意 · failed 没完成（拒绝、超时、出错）· done。
 */
export function useOAuthFlow(onDone) {
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState("");
  const live = useRef("");
  const timer = useRef(0);
  const until = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;
  const drop = (cancel) => {
    clearTimeout(timer.current);
    if (live.current && cancel) api(`/apps/flows/${encodeURIComponent(live.current)}`, { method: "DELETE" }).catch(() => {});
    live.current = "";
  };
  const fail = (text) => {
    drop(true);
    setError(text || t("apps.connect.authUnfinished"));
    setFlow((f) => (f ? { ...f, state: "failed" } : f));
  };
  const poll = async () => {
    if (!live.current) return;
    try {
      const r = await api(`/apps/flows/${encodeURIComponent(live.current)}`);
      if (!live.current) return;
      if (r.flow.state === "done") {
        live.current = "";
        setApps(r);
        setFlow(r.flow);
        done.current?.(r.flow);
        return;
      }
      if (r.flow.state !== "waiting") return fail(r.flow.error);
    } catch (e) {
      if (e?.status === 404) return fail("");
    }
    if (Date.now() > until.current) return fail("");
    timer.current = setTimeout(poll, POLL_MS);
  };
  const begin = (f) => {
    drop(true);
    setError("");
    live.current = f.id;
    until.current = Date.now() + OAUTH_WAIT_MS;
    setFlow(f);
    window.open(f.url, "_blank", "noopener");
    timer.current = setTimeout(poll, POLL_MS);
  };
  const paste = async (url) => {
    if (!flow) return;
    const r = await api(`/apps/flows/${encodeURIComponent(flow.id)}/paste`, { method: "POST", body: { url } });
    clearTimeout(timer.current);
    live.current = "";
    setApps(r);
    setFlow(r.flow);
    done.current?.(r.flow);
  };
  useEffect(() => () => drop(true), []);
  return { flow, error, begin, paste, cancel: () => (drop(true), setFlow(null)), setError };
}

/** 等授权的那一块：说明、重新打开、可复制的链接、回跳地址的粘贴兜底。login：自定义连接器里「请在浏览器里完成登录」 */
export function OAuthWait({ oauth, onRetry }) {
  const [pasting, setPasting] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const f = oauth.flow;
  const waiting = f && f.state === "waiting";
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await oauth.paste(url.trim());
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(false);
  };
  return html`<div class="apps-wait">
    ${waiting && html`<p class="apps-wait-head"><${Spinner} /> <b>${t("apps.connect.authWaiting")}</b></p>
      <p class="hint">${t("apps.connect.authWaitingSub")}</p>
      <div class="apps-wait-actions">
        <${Button} onClick=${() => window.open(f.url, "_blank", "noopener")}>${t("apps.connect.reopen")}<//>
        <span class="apps-copy"><span class="hint">${t("apps.connect.copyLink")}</span><${CopyButton} text=${f.url} label=${t("apps.connect.copyLink")} /></span>
      </div>
      ${!pasting && html`<button type="button" class="text" onClick=${() => setPasting(true)}>${t("apps.connect.noReturn")}</button>`}
      ${pasting && html`<form class="apps-paste" onSubmit=${submit}>
        <p class="hint">${t("apps.connect.pasteHint")}</p>
        <div class="apps-inline"><input class="field mono" aria-label=${t("apps.connect.pasteLabel")} placeholder="http://127.0.0.1:…/?code=…" value=${url} onInput=${(e) => setUrl(e.target.value)} />
          <${Button} type="submit" loading=${busy} disabled=${!url.trim()}>${t("apps.connect.pasteSubmit")}<//></div>
        <${ErrorLine} text=${error} />
      </form>`}`}
    ${!waiting && html`<${ErrorLine} text=${oauth.error || t("apps.connect.authUnfinished")} />
      <div class="apps-wait-actions"><${Button} onClick=${onRetry}>${t("apps.connect.reopen")}<//></div>`}
  </div>`;
}

/** 连上之后：已连接、账号名、下一步、一句可以直接发给机器人的示例 */
export function ConnectedStep({ title, label, sub, example, chatBot, onClose }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(example);
      toast(t("common.copied"));
    } catch {
      failed(t("common.error"));
    }
  };
  const send = () => {
    onClose();
    if (chatBot?.route) location.hash = chatBot.route;
    sendToChat(example, chatBot?.target || chatBot?.id);
  };
  return html`<div class="apps-done">
    <p class="apps-done-head"><span class="apps-done-mark"><${Icon} name="check" size="sm" strong /></span><b>${title || t("apps.connect.done")}</b>${label && html`<span class="tone-muted">${label}</span>`}</p>
    ${sub && html`<p class="hint">${sub}</p>`}
    ${example && html`<p class="hint">${t("apps.connect.next")}</p><p class="apps-example">${example}</p>`}
    <div class="actions">
      ${example && (chatBot ? html`<${Button} onClick=${send}>${t("apps.connect.sendToBot")}<//>` : html`<${Button} onClick=${copy}>${t("apps.connect.copyExample")}<//>`)}
      <${Button} variant="primary" data-autofocus onClick=${onClose}>${t("apps.connect.finish")}<//>
    </div>
  </div>`;
}

/** 已有账号修复时用哪种连接方式（沿用它原来的） */
function methodsFor(entry, account) {
  if (!account) return entry.methods;
  const want = account.legacy ? (entry.id === "notion" ? (account.method === "token" ? "notion-token" : "notion-oauth") : "oauth") : account.method === "oauth" ? "oauth" : account.method === "headers" ? "header" : account.method === "dedicatedUrl" ? "dedicatedUrl" : account.method === "query" ? "key" : account.method === "token" ? "localToken" : "";
  const hit = entry.methods.filter((m) => m.kind === want);
  return hit.length ? hit : entry.methods;
}

function repairTitle(state, name) {
  if (state === "expired") return t("apps.repair.reauthorize", { app: name });
  if (state === "needs-login") return t("apps.repair.signIn", { app: name });
  if (state === "key-rejected") return t("apps.repair.key", { app: name });
  if (state === "link-invalid") return t("apps.repair.link", { app: name });
  return t("apps.connect.title", { name });
}

/** 连接内置应用的一个账号 */
function ConnectSheet({ dialog, catalog, apps, chatBot, onClose }) {
  const lang = useLang();
  const entry = catalog.find((c) => c.id === dialog.app);
  const view = apps.find((a) => a.key === dialog.app);
  const account = dialog.accountId ? view?.accounts.find((a) => a.id === dialog.accountId) : null;
  const methods = entry ? methodsFor(entry, account) : [];
  const [mi, setMi] = useState(0);
  const m = methods[Math.min(mi, methods.length - 1)];
  const variants = m?.variants || [];
  // 飞书有两个站点：中文界面默认飞书，其他语言默认 Lark；可以切换
  const [variant, setVariant] = useState(() => (variants.length && !String(lang).toLowerCase().startsWith("zh") ? variants[0].id : ""));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const name = builtinName(entry, lang);
  const finish = (accountId) => {
    const next = appsStore.get().apps.find((a) => a.key === dialog.app);
    const acc = next?.accounts.find((a) => a.id === accountId) || next?.accounts[next.accounts.length - 1];
    setDone({ label: acc?.label || "" });
  };
  const oauth = useOAuthFlow((f) => finish(f.accountId));
  const isOAuth = m && (m.kind === "oauth" || m.kind === "notion-oauth");

  // 授权登录：打开弹窗（或换了方式、站点）就开始，不用再点一次
  useEffect(() => {
    if (!m || done) return;
    setError("");
    if (m.kind === "oauth") {
      let stop = false;
      setBusy(true);
      api(`/apps/builtin/${encodeURIComponent(entry.id)}/connect`, { method: "POST", body: { method: "oauth", variant: variant || undefined, accountId: dialog.accountId } })
        .then((r) => !stop && r.flow && oauth.begin(r.flow))
        .catch((e) => !stop && setError(e.message || String(e)))
        .finally(() => !stop && setBusy(false));
      return () => {
        stop = true;
        oauth.cancel();
      };
    }
    if (m.kind === "notion-oauth") return notionOAuth();
  }, [mi, variant, attempt, !!done]);

  /** Notion 一键授权（现有的实现）：同意后跳回本机，这里等账号列表变化 */
  const [notion, setNotion] = useState(null);
  const notionOAuth = () => {
    let stop = false;
    let timer;
    const before = JSON.stringify((view?.accounts || []).map((a) => [a.id, a.state]));
    const until = Date.now() + OAUTH_WAIT_MS;
    setNotion(null);
    const poll = async () => {
      if (stop) return;
      try {
        const r = await api("/apps");
        const now = r.apps.find((a) => a.key === "notion");
        if (JSON.stringify((now?.accounts || []).map((a) => [a.id, a.state])) !== before) {
          setApps(r);
          const fresh = now.accounts.find((a) => !(view?.accounts || []).some((p) => p.id === a.id)) || now.accounts.find((a) => a.id === dialog.accountId);
          setDone({ label: fresh?.label || "" });
          return;
        }
      } catch {
        /* 下一轮再试 */
      }
      if (Date.now() > until) return setNotion({ failed: true });
      timer = setTimeout(poll, POLL_MS);
    };
    api("/connections/notion/oauth", { method: "POST", body: {} })
      .then((r) => {
        if (stop) return;
        setNotion({ url: r.url });
        window.open(r.url, "_blank", "noopener");
        timer = setTimeout(poll, POLL_MS);
      })
      .catch((e) => !stop && setError(e.message || String(e)));
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  };

  if (!entry || !m) return null;
  const submit = async (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setError("");
    try {
      if (m.kind === "notion-token") {
        await api("/connections/notion/token", { method: "POST", body: { token: v } });
        const prev = (view?.accounts || []).map((a) => a.id);
        const next = await api("/apps");
        setApps(next);
        const acc = next.apps.find((a) => a.key === "notion")?.accounts.find((a) => !prev.includes(a.id));
        setDone({ label: acc?.label || "" });
      } else {
        const body = { method: m.kind, accountId: dialog.accountId, ...(m.kind === "dedicatedUrl" ? { url: v } : m.kind === "key" ? { key: v } : { token: v }) };
        const r = await api(`/apps/builtin/${encodeURIComponent(entry.id)}/connect`, { method: "POST", body });
        setApps(r);
        finish(r.accountId);
      }
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(false);
  };

  const title = account ? repairTitle(account.state, name) : t("apps.connect.title", { name });
  const steps = stepsOf(entry.id, m.kind);
  const example = has(`apps.catalog.${entry.id}.example`) ? t(`apps.catalog.${entry.id}.example`) : "";
  // 输入框的标签和占位：钉钉是专属链接，高德是 Key，语雀和腾讯文档、GitHub 是令牌
  const fieldKey = m.kind === "dedicatedUrl" ? "url" : m.kind === "key" ? "key" : has(`apps.catalog.${entry.id}.tokenLabel`) ? "custom" : "token";
  const fieldLabel = fieldKey === "custom" ? t(`apps.catalog.${entry.id}.tokenLabel`) : t(`apps.connect.${fieldKey}Label`);
  const fieldHint = has(`apps.catalog.${entry.id}.placeholder`) ? t(`apps.catalog.${entry.id}.placeholder`) : t(`apps.connect.${fieldKey === "custom" ? "token" : fieldKey}Placeholder`);
  const waitingNotion = m.kind === "notion-oauth" && notion && !notion.failed;

  const heading = done ? t("apps.connect.title", { name }) : title;
  return html`<${Sheet} label=${heading} title=${html`<span class="apps-title"><${AppMark} app=${entry.id} name=${name} size="sm" /><span>${heading}</span></span>`} sticky onClose=${onClose}>
    ${done && html`<${ConnectedStep} label=${done.label} example=${example} chatBot=${chatBot} onClose=${onClose} />`}
    ${!done && html`<form class="apps-form" onSubmit=${submit}>
      ${methods.length > 1 && html`<${Seg} label=${t("apps.connect.method")} value=${String(mi)} onChange=${(v) => { setMi(Number(v)); setValue(""); setError(""); }}
        options=${methods.map((x, i) => [String(i), t(x.kind === "oauth" || x.kind === "notion-oauth" ? "apps.connect.methodSignIn" : "apps.connect.methodToken")])} />`}
      ${m.kind === "oauth" && variants.length > 0 && html`<${Seg} label=${name} value=${variant} onChange=${setVariant}
        options=${[["", name], ...variants.map((v) => [v.id, v.label])]} />`}
      ${has(`apps.catalog.${entry.id}.notice`) && html`<${Notice}>${t(`apps.catalog.${entry.id}.notice`)}<//>`}
      <${Steps} items=${steps} />
      ${(m.getUrl || entry.termsUrl || entry.docs) && html`<p class="apps-links">
        ${m.getUrl && outLink(m.getUrl, has(`apps.catalog.${entry.id}.getLabel`) ? t(`apps.catalog.${entry.id}.getLabel`) : t("apps.connect.get"))}
        ${entry.termsUrl && outLink(entry.termsUrl, t("apps.connect.terms"))}
        ${entry.docs && outLink(entry.docs, html`<${Icon} name="file" size="sm" />${name} · ${t("apps.connect.docs")}`)}
      </p>`}
      ${m.kind === "oauth" && (oauth.flow ? html`<${OAuthWait} oauth=${oauth} onRetry=${() => setAttempt((n) => n + 1)} />` : busy ? html`<p class="apps-wait-head"><${Spinner} /> ${t("apps.connect.preparing")}</p>` : null)}
      ${m.kind === "notion-oauth" && html`<div class="apps-wait">
        ${waitingNotion && html`<p class="apps-wait-head"><${Spinner} /> <b>${t("apps.connect.authWaiting")}</b></p><p class="hint">${t("apps.connect.authWaitingSub")}</p>
          <div class="apps-wait-actions"><${Button} onClick=${() => window.open(notion.url, "_blank", "noopener")}>${t("apps.connect.reopen")}<//>
            <span class="apps-copy"><span class="hint">${t("apps.connect.copyLink")}</span><${CopyButton} text=${notion.url} label=${t("apps.connect.copyLink")} /></span></div>`}
        ${notion?.failed && html`<${ErrorLine} text=${t("apps.connect.authUnfinished")} /><div class="apps-wait-actions"><${Button} onClick=${() => setAttempt((n) => n + 1)}>${t("apps.connect.reopen")}<//></div>`}
      </div>`}
      ${!isOAuth && html`<label class="set-field"><span class="k">${fieldLabel}</span>
        <${SecretInput} value=${value} onInput=${setValue} label=${fieldLabel} placeholder=${fieldHint} autoFocus disabled=${busy} />
      </label>`}
      <${ErrorLine} text=${error} />
      <div class="actions">
        <${Button} onClick=${onClose}>${t("common.cancel")}<//>
        ${isOAuth
          ? html`<${Button} variant="primary" disabled>${t("apps.connect.waitingButton")}<//>`
          : html`<${Button} type="submit" variant="primary" disabled=${!value.trim() || busy}>${busy ? html`<${Spinner} /> ${t("apps.connect.connecting")}` : t(account ? "common.save" : "apps.connect.submit")}<//>`}
      </div>
    </form>`}
  <//>`;
}

/** 管理弹窗里的一个账号：状态、别名、主账号、修复、断开 */
function AccountRow({ view, account, multi, onChanged, onOpenSettings }) {
  const [label, setLabel] = useState(account.label);
  const [busy, setBusy] = useState("");
  useEffect(() => setLabel(account.label), [account.label]);
  const call = async (id, run) => {
    setBusy(id);
    try {
      const r = await run();
      if (r) setApps(r);
      onChanged?.();
    } catch (e) {
      failed(e);
    }
    setBusy("");
  };
  const rename = () => {
    const next = label.trim();
    if (!next || next === account.label) return setLabel(account.label);
    call("rename", async () => {
      const r = await api(`/apps/connections/${account.id}`, { method: "PUT", body: { label: next } });
      saved();
      return r;
    });
  };
  const fix = (id) => {
    if (id === "retry") return call("retry", () => api(`/apps/connections/${account.id}/test`, { method: "POST", body: {} }));
    if (id === "network") return (closeAppDialog(), onOpenSettings?.("network"));
    if (id === "logs") return (closeAppDialog(), onOpenSettings?.("troubleshoot"));
    openConnect(view.app, { accountId: account.id });
  };
  const disconnect = async () => {
    if (!(await confirmSheet({ title: t("apps.manage.disconnectTitle", { name: account.label }), body: t(multi ? "apps.manage.disconnectAccountBody" : "apps.manage.disconnectBody"), confirmLabel: t("apps.manage.disconnect"), danger: true }))) return;
    call("remove", () => api(`/apps/connections/${account.id}`, { method: "DELETE" }));
  };
  const actions = repairActions(account.state, { method: account.method });
  const tone = stateTone(account.state);
  return html`<div class="apps-account">
    <div class="apps-account-head">
      <span class="apps-account-name">${multi && html`<span class="num tone-muted">${account.number}</span>`}<b>${account.label}</b>${account.primary && multi && html`<span class="badge">${t("apps.manage.primary")}</span>`}</span>
      <span class=${`apps-state ${tone}`}>${account.state === "testing" && html`<${Spinner} />`}${stateText(account.state, account.tools)}</span>
    </div>
    <p class="hint">${methodLabel(account.method)}${account.upgradable ? ` · ${t("apps.manage.feishuLegacy")}` : ""}</p>
    <div class="apps-inline">
      <input class="field" maxlength="80" aria-label=${t("apps.manage.alias")} value=${label} onInput=${(e) => setLabel(e.target.value)} onBlur=${rename}
        onKeyDown=${(e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }} />
    </div>
    <div class="apps-account-actions">
      ${actions.map((a) => html`<${Button} key=${a.id} size="sm" variant=${ATTENTION.includes(account.state) ? "primary" : undefined} loading=${busy === a.id} onClick=${() => fix(a.id)}>${a.label}<//>`)}
      ${account.upgradable && account.state === "connected" && html`<${Button} size="sm" onClick=${() => openConnect(view.app, { accountId: account.id })}>${t("apps.manage.feishuUpgrade")}<//>`}
      ${multi && !account.primary && html`<button type="button" class="text" disabled=${!!busy} onClick=${() => call("primary", () => api(`/apps/app/${encodeURIComponent(view.key)}/primary`, { method: "POST", body: { accountId: account.id } }))}>${t("apps.manage.setPrimary")}</button>`}
      <span class="grow"></span>
      <button type="button" class="text danger" disabled=${!!busy} onClick=${disconnect}>${t("apps.manage.disconnect")}</button>
    </div>
  </div>`;
}

const CATEGORIES = ["read", "write", "delete", "send"];

/** 谁能用：全部机器人，或指定几个（和机器人设置里的「应用」是同一份设置的两头） */
function AccessEditor({ view, bots }) {
  const all = view.access === "all";
  const picked = all ? [] : view.access;
  const put = async (bots) => {
    try {
      setApps(await api(`/apps/app/${encodeURIComponent(view.key)}/access`, { method: "PUT", body: { bots } }));
      saved();
    } catch (e) {
      failed(e);
    }
  };
  const list = bots || [];
  return html`<div class="apps-block">
    <div class="apps-block-head"><b>${t("apps.manage.who")}</b>
      <${Seg} label=${t("apps.manage.who")} value=${all ? "all" : "some"} onChange=${(v) => put(v === "all" ? "all" : list.map((b) => b.id))}
        options=${[["all", t("apps.manage.allBots")], ["some", t("apps.manage.someBots")]]} /></div>
    ${!all && html`<div class="apps-checks">
      ${list.map((b) => html`<label key=${b.id} class="sheet-check"><input type="checkbox" checked=${picked.includes(b.id)}
        onChange=${(e) => put(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))} /><span>${b.name}</span></label>`)}
      ${!list.length && html`<p class="hint">${t("apps.manage.noBots")}</p>`}
    </div>`}
  </div>`;
}

/** 工具清单：名称一行、说明一行；自定义连接器可以改每个工具的类别（服务器自己报的标注不一定可信） */
function ToolList({ view, editable }) {
  const [open, setOpen] = useState(false);
  if (!view.tools.length) return null;
  const set = async (tool, category) => {
    try {
      setApps(await api(`/apps/app/${encodeURIComponent(view.key)}/tools/${encodeURIComponent(tool)}`, { method: "PUT", body: { category } }));
    } catch (e) {
      failed(e);
    }
  };
  return html`<div class="apps-block">
    <button type="button" class="apps-fold" aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>
      <b>${t("apps.manage.tools", { n: view.tools.length })}</b><${Icon} name=${open ? "chevDown" : "chevRight"} size="sm" /></button>
    ${open && html`${editable && html`<p class="hint">${t("apps.manage.categoryHint")}</p>`}
      <ul class="apps-tools">${view.tools.map((x) => html`<li key=${x.name}>
        <span class="apps-tool-text"><span class="apps-tool-name mono">${x.name}</span>${x.description && html`<span class="hint">${x.description}</span>`}</span>
        ${editable
          ? html`<${MenuButton} label=${t("apps.category.label")} value=${x.category} width=${200} onChange=${(v) => set(x.name, v === "reset" ? null : v)}
              options=${[...CATEGORIES.map((c) => [c, t(`apps.category.${c}`)]), ...(x.overridden ? [["reset", t("apps.category.reset")]] : [])].map(([v, text]) => [v, text])} />`
          : html`<span class="badge">${t(`apps.category.${x.category}`)}</span>`}
      </li>`)}</ul>`}
  </div>`;
}

/** 管理一个内置应用或一个自定义连接器 */
function ManageSheet({ dialog, catalog, apps, bots, onClose, onOpenSettings }) {
  const lang = useLang();
  const view = apps.find((a) => a.key === dialog.key);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!view || (!view.custom && !view.accounts.length)) onClose();
  }, [!view, view && view.accounts.length]);
  if (!view || (!view.custom && !view.accounts.length)) return null;
  const name = appLabel(view, catalog, lang);
  const multi = view.accounts.length > 1;
  const toggle = async (on) => {
    setBusy(true);
    try {
      const r = await api(`/apps/custom/${view.accounts[0].id}/enabled`, { method: "POST", body: { on } });
      setApps(r);
      if (on && r.app && r.app.state !== "connected") failed(stateText(r.app.state) || t("common.error"));
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  return html`<${Sheet} label=${name} title=${html`<span class="apps-title"><${AppMark} app=${view.custom ? undefined : view.app} name=${name} size="sm" /><span>${name}</span></span>`} wide onClose=${onClose}>
    <div class="apps-manage">
      ${view.custom && html`<div class="apps-block-head"><b>${t(view.enabled ? "apps.manage.on" : "apps.manage.off")}</b>
        <span class="apps-inline">${busy && html`<${Spinner} />`}<${Switch} value=${!!view.enabled} disabled=${busy} label=${t("apps.manage.enable")} onChange=${toggle} />
          <${Button} size="sm" onClick=${() => openCustom(view.accounts[0].id)}>${t("apps.manage.edit")}<//></span></div>`}
      ${view.accounts.map((a) => html`<${AccountRow} key=${a.id} view=${view} account=${a} multi=${multi} onOpenSettings=${onOpenSettings} />`)}
      ${view.custom && view.log && html`<details class="skill-instructions"><summary>${t("apps.manage.log")}</summary><pre>${view.log}</pre></details>`}
      ${!view.custom && html`<div><${Button} size="sm" icon="plus" onClick=${() => openConnect(view.app)}>${t("apps.manage.addAccount")}<//></div>`}
      <${AccessEditor} view=${view} bots=${bots} />
      <${ToolList} view=${view} editable=${view.custom} />
    </div>
    <div class="actions"><${Button} variant="primary" data-autofocus onClick=${onClose}>${t("apps.connect.finish")}<//></div>
  <//>`;
}

/** 全局的弹窗出口。chatBot：主区正在和哪个机器人对话（连接成功后的示例句可以直接发给它） */
export function AppDialogHost({ bots, chatBot, onOpenSettings }) {
  const dialog = useStore(appDialog);
  const s = useStore(appsStore);
  if (!dialog) return null;
  const close = () => {
    // 回到管理弹窗的场合（从管理里点了修复、添加账号）不做：关了就是关了，清单已经是最新的
    closeAppDialog();
  };
  if (!s.loaded) return null;
  if (dialog.kind === "connect") return html`<${ConnectSheet} key=${`${dialog.app}:${dialog.accountId || ""}`} dialog=${dialog} catalog=${s.catalog} apps=${s.apps} chatBot=${chatBot} onClose=${close} />`;
  if (dialog.kind === "manage") return html`<${ManageSheet} key=${dialog.key} dialog=${dialog} catalog=${s.catalog} apps=${s.apps} bots=${bots} onClose=${close} onOpenSettings=${onOpenSettings} />`;
  if (dialog.kind === "custom") return html`<${CustomConnectorSheet} key=${dialog.id || "new"} id=${dialog.id} apps=${s.apps} full=${s.customCount >= s.maxCustom} chatBot=${chatBot} onClose=${close} />`;
  return null;
}
