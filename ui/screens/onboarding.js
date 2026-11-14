// 首次启动 / 退出登录后："未连接"时的整页空态：大头像 + 一句 slogan + 一个登录按钮（在系统浏览器里完成，
// 回来后自动连接）。Docker / 远程部署时浏览器登录的回调回不到这台机器，登录后要把地址栏里的链接贴回来。
// 不是向导路由。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Menu, Notice, Spinner, CopyButton, Popover, tokenPx } from "../components/ui.js";
import { BotAvatar, MAIN_CHAR } from "../components/avatar.js";
import { FamilyHead, PickModel, familyName, groupModels, useFamilies } from "../components/model-picker.js";
import { OfficialStart } from "../components/official-keys.js";
import { api } from "../lib/api.js";
import { accountLogin, startAccountLogin, cancelAccountLogin, resumeAccountLogin } from "../lib/account-login.js";
import { useStore, failed } from "../lib/store.js";
import { LANGS, LANG_NAMES, changeLang, getLangPref, t, useLang } from "../lib/i18n.js";
import { MF_CONSOLE, MF_DOCS } from "../lib/links.js";

export { MF_CONSOLE, MF_DOCS };

/**
 * 登录 / 注册 Modelflare：桌面版由主进程在系统浏览器里打开授权页；浏览器版在新标签页打开（被拦截时
 * 用下面的链接）。等待期间每秒读一次账户状态，登录完成后 onSignedIn(status)。
 * manual：Docker / 远程部署，回调回不到这台机器：等待时让用户把登录后地址栏里的链接贴回来。
 * explain / gift：按钮下面写上"新用户注册送 $1 Bot 额度"（首次启动的登录页、填 API Key 页里的"改用账号登录"）。
 */
export function AccountLogin({ onSignedIn, onFace, manual = false, label = t("welcome.loginButton"), secondary = false, gift = false, inline = false }) {
  const state = useStore(accountLogin);
  const [link, setLink] = useState(""); const [sending, setSending] = useState(false);
  const [paste, setPaste] = useState(false); const [err, setErr] = useState(""); const anchor = useRef(null);
  const seen = useRef(state.success);
  useEffect(() => onFace?.(state.waiting ? "thinking" : state.error ? "error" : "idle"), [state.waiting, state.error]);
  useEffect(() => { if (state.success > seen.current) { seen.current = state.success; onSignedIn?.(state.account); setPaste(false); } }, [state.success]);
  const submitLink = async (e) => {
    e.preventDefault(); if (!link.trim() || sending) return;
    setSending(true); setErr("");
    try { await api("/account/login/complete", { method: "POST", body: { link: link.trim() } }); }
    catch (e) { setErr(e.message); }
    finally { setSending(false); }
  };
  const manualForm = html`<form class="login-manual" onSubmit=${submitLink}><p class="hint">${t("onboarding.login.manualHint")}</p>
    <input class="field mono" value=${link} readonly=${sending} aria-label=${t("onboarding.login.manualLabel")} placeholder="http://127.0.0.1:…/callback?code=…" onInput=${(e) => { setLink(e.target.value); setErr(""); }} />
    ${err && html`<div class="err-text" role="alert">${err}</div>`}<button class="btn primary" type="submit" disabled=${sending || !link.trim()}>${t("onboarding.login.manualSubmit")}</button></form>`;
  const links = html`<div class="login-links">
    <a class="text" href=${state.url || undefined} aria-disabled=${!state.url} target="_blank" rel="noopener noreferrer">${t(inline ? "welcome.reopen" : "onboarding.login.reopen")}</a>
    <${CopyButton} text=${state.url} label=${t("onboarding.login.copyLink")} />
    <button type="button" class="text" onClick=${cancelAccountLogin}>${t("common.cancel")}</button>
    ${inline && manual && html`<button type="button" class="text" onClick=${() => setPaste(!paste)}>${t("welcome.pasteLink")}</button>`}</div>`;
  if (inline) return state.waiting
    ? html`<div class="account-login waiting" ref=${anchor} role="status"><span class="account-login-icon"><${Spinner} /></span><div class="account-login-copy"><span class="account-login-title">${t("welcome.signingIn")}</span>${links}</div></div>
      ${paste && html`<${Popover} anchor=${anchor.current} width=${300} prefer="up" onClose=${() => setPaste(false)}>${manualForm}<//>`}`
    : html`<button type="button" class="account-login" onClick=${startAccountLogin}><span class="account-login-icon"><${Icon} name="login" /></span>
      <span class="account-login-copy"><span class="account-login-title">${t("firstUse.signIn")}</span><span class="hint" title=${t("welcome.signInSub")}>${t("welcome.signInSub")}</span></span><${Icon} name="ext" size="sm" /></button>`;
  return html`<div class="login-cta">
    ${state.waiting ? html`<div class="login-wait" role="status"><${Spinner} />${t("onboarding.login.waiting")}</div>${links}${manual && manualForm}`
      : html`<button type="button" class=${`btn ${secondary ? "outline" : "primary"} lg block`} onClick=${startAccountLogin}>${label}</button>`}
    ${gift && html`<p class="login-gift"><${Icon} name="spark" size="sm" />${t("firstUse.signupGift")}</p>`}
    ${state.error && html`<div class="err-text" role="alert">${state.error}</div>`}</div>`;
}

function ModelStep({ models, initial, onDone, auto }) {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const groups = useMemo(() => groupModels(models, q), [models, q]);
  const { isOpen, toggle } = useFamilies(groups, cur);
  const folding = !q.trim() && groups.length > 1;
  // 默认的图片 / 视频模型：之前选过且还能用就沿用，否则用推荐的
  const [media, setMedia] = useState(null);
  const [img, setImg] = useState("");
  const [vid, setVid] = useState("");
  useEffect(() => {
    Promise.all([api("/media/models"), api("/settings").catch(() => ({}))])
      .then(([d, st]) => {
        setMedia(d);
        setImg(d.image.includes(st.imageModel) ? st.imageModel : d.recommended.image || "");
        setVid(d.video.includes(st.videoModel) ? st.videoModel : d.recommended.video || "");
      })
      .catch(() => setMedia({ image: [], video: [] }));
  }, []);
  const hasMedia = media && (media.image.length > 0 || media.video.length > 0);
  const start = async () => {
    setBusy(true);
    try {
      await api("/settings", {
        method: "PUT",
        body: { defaultModel: cur, ...(media && media.image.length ? { imageModel: img } : {}), ...(media && media.video.length ? { videoModel: vid } : {}) },
      });
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  // 目录里有 Bot 时不让新用户先选模型：直接用默认的，进入助手对话
  useEffect(() => {
    if (auto && cur && models.includes(cur)) void start();
  }, []);
  if (auto && cur && models.includes(cur) && !err) return html`<div class="login-cta" role="status"><div class="login-wait"><${Spinner} /></div></div>`;
  // 首用默认模型（第 8 项）：服务端只在找到"支持工具、预占和代表性任务花费都在体验额度内"的模型时才预选；
  // 没找到时不替用户挑一个可能马上耗尽额度的，说明原因、请用户自己选
  const noPick = models.length > 0 && !(initial && models.includes(initial));
  return html`<div class="list">
    <div class="connected"><span class="dot ok"></span>${t("onboarding.model.found", { count: models.length, n: html`<span class="num">${models.length}</span>` })}</div>
    ${noPick && html`<${Notice} tone="amber">${t("firstUse.noFirstModel")}<//>`}
    ${models.length
      ? html`<p class="hint">${t("onboarding.model.hint")}</p>
        <input class="field" placeholder=${t("onboarding.model.filter")} value=${q} onInput=${(e) => setQ(e.target.value)} aria-label=${t("onboarding.model.filter")} />
        <div class="picklist" role="listbox" aria-label=${t("onboarding.model.default")}>
          ${groups.map(([g, ms]) => {
            const rows = ms.map(([m, label]) => html`<button type="button" role="option" aria-selected=${m === cur} class=${m === cur ? "cur" : ""} onClick=${() => setCur(m)} onDblClick=${start}>
              <span class="v">${label}</span>${m === cur && html`<span class="check"><${Icon} name="check" size="sm" /></span>`}
            </button>`);
            if (!folding) return html`${groups.length > 1 && html`<div class="group">${familyName(g)}</div>`}${rows}`;
            const open = isOpen(g);
            const hit = open ? undefined : ms.find(([m]) => m === cur);
            return html`<button type="button" class="fam" aria-expanded=${open} onClick=${() => toggle(g)}><${FamilyHead} name=${g} count=${ms.length} current=${hit?.[1]} /></button>${open && rows}`;
          })}
          ${!groups.length && html`<p class="hint">${t("onboarding.model.noMatch")}</p>`}
        </div>
        ${hasMedia && html`<div class="media-pick">
          <p class="hint">${t("onboarding.model.mediaHint")}</p>
          ${media.image.length > 0 && html`<div class="row compact">
            <div class="who"><div class="name">${t("onboarding.model.image")}</div></div>
            <${PickModel} value=${img} models=${media.image} onChange=${setImg} label=${t("onboarding.model.imageLabel")} />
          </div>`}
          ${media.video.length > 0 && html`<div class="row compact">
            <div class="who"><div class="name">${t("onboarding.model.video")}</div></div>
            <${PickModel} value=${vid} models=${media.video} onChange=${setVid} label=${t("onboarding.model.videoLabel")} />
          </div>`}
        </div>`}`
      : html`<${Notice} tone="amber" action=${html`<a class="btn" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">${t("onboarding.model.console")}</a>`}>${t("onboarding.model.empty")}<//>`}
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    <button type="button" class="btn primary lg block" disabled=${busy || (models.length > 0 && !(cur && models.includes(cur)))} onClick=${start}>${busy ? html`<${Spinner} /> ${t("onboarding.model.saving")}` : models.length ? t("onboarding.model.start") : t("onboarding.model.startAnyway")}</button>
  </div>`;
}

/** 语言切换：在引导列顶上靠右。新用户连接前就能换语言（按钮上是当前界面语言的名字，菜单里勾的是偏好） */
function LangSwitch() {
  const lang = useLang();
  const pref = getLangPref();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const label = t("common.lang.label");
  const opts = [["system", t("common.lang.system")], ...LANGS.map((l) => [l, LANG_NAMES[l]])];
  return html`<div class="onboard-lang">
    <button type="button" class="pick" ref=${ref} aria-haspopup="menu" aria-expanded=${open} aria-label=${label} title=${label} onClick=${() => setOpen((v) => !v)}>
      <${Icon} name="globe" size="sm" class="lead" /><span class="v">${LANG_NAMES[lang]}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${Menu} anchor=${ref.current} width=${180} align="right" label=${label} onClose=${() => setOpen(false)}
      items=${opts.map(([v, text]) => ({ label: text, cur: v === pref, onSelect: () => v !== pref && changeLang(v).catch(failed) }))} />`}
  </div>`;
}

export function Onboarding({ gateway, defaultModel, onDone, skipModelStep, existingConnection, connection }) {
  const [models, setModels] = useState(null);
  const [suggested, setSuggested] = useState(defaultModel || "");
  // Docker / 远程部署：浏览器登录的回调到不了本程序，登录后要把链接贴回来
  const [manual, setManual] = useState(false);
  // 授权在网页上被撤销后会回到这里：说明原因
  const [why, setWhy] = useState("");
  useEffect(() => {
    api("/account")
      .then((a) => {
        resumeAccountLogin(a);
        if (a.error) setWhy(a.error);
        if (a.manualLogin) setManual(true);
      })
      .catch(() => {});
  }, []);
  const [providers, setProviders] = useState([]);
  const loginState = useStore(accountLogin);
  const [keyBusy, setKeyBusy] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { api("/official").then((d) => setProviders(d.providers || [])).catch(() => {}); api("/status").then((d) => setDesktop(!!d.desktop)).catch(() => {}); }, []);
  const [face, setFace] = useState("idle");
  const [cue, setCue] = useState(null);
  // 用自己的官方 API Key，不登录 Modelflare
  const [ownKey, setOwnKey] = useState(false);
  const onFace = (f) => (f === "error" ? setCue({ kind: "error", at: Date.now() }) : setFace(f));
  // 读模型列表失败时不当成"没有模型"：给出原因和重试，不静默换模型
  const [modelsErr, setModelsErr] = useState("");
  const loadModels = () => {
    setModelsErr("");
    return Promise.all([api("/models"), api("/settings")])
      .then(([d, st]) => {
        if (d.error && !(d.models || []).length) throw new Error(d.error);
        setSuggested(st.defaultModel || "");
        setModels(d.models || []);
      })
      .catch((e) => setModelsErr(e.message || t("common.error")));
  };
  const connectedProviders = providers.filter((p) => p.connected);
  const configs = [...connectedProviders.map((p) => t("welcome.setupLine", { service: p.name, last4: p.keyTail, n: p.models })),
    ...(connection?.connected && connection?.keyTail ? [t("welcome.setupAccount", { last4: connection.keyTail })] : [])];
  const wait = loginState.waiting;
  return html`<main class="onboard" data-screen="onboarding"><${LangSwitch} />
    <div class=${`onboard-col${existingConnection && !ownKey ? " returning" : ""}`}>
      ${ownKey && models === null && html`<button type="button" class="text onboard-back" disabled=${keyBusy} onClick=${() => { setOwnKey(false); setFace("idle"); }}>${t("welcome.back")}</button>`}
      <div class="onboard-hero"><${BotAvatar} char=${MAIN_CHAR} size=${models === null ? tokenPx("--onboard-avatar", 120) : 88} state=${face} cue=${cue} lively pokeable greet />
        <h1>${t(ownKey ? "official.useOwn" : "onboarding.slogan")}</h1>
        ${models === null && html`<p>${t(ownKey ? "welcome.keySubtitle" : existingConnection ? "welcome.returnSubtitle" : "welcome.loginSubtitle")}</p>`}</div>
      ${gateway?.mode === "managed" && gateway.state === "failed" && html`<${Notice} tone="red">${t("onboarding.gatewayFailed", { error: gateway.lastError || t("onboarding.unknownReason") })}<//>`}
      ${why && models === null && !modelsErr && html`<${Notice} tone="amber">${why}<//>`}
      ${modelsErr && models === null && html`<${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${loadModels}>${t("common.retry")}</button>`}>${t("firstUse.modelsLoadFailed", { error: modelsErr })}<//>`}
      ${models !== null ? html`<${ModelStep} models=${models} initial=${suggested} onDone=${onDone} auto=${skipModelStep || existingConnection} />`
        : ownKey ? html`<${OfficialStart} desktop=${desktop} onBusy=${setKeyBusy} onFace=${onFace} onConnected=${async () => { if (existingConnection) onDone(); else await loadModels(); }} />`
        : html`${existingConnection && html`<div class=${`onboard-setup${wait ? " waiting" : ""}`}><span class="hint">${t("welcome.currentSetup")}</span>
            <div class="onboard-configs">${configs.slice(0, 3).map((line) => html`<div>${line}</div>`)}${configs.length > 3 && html`<div class="hint">${t("welcome.moreServices", { n: configs.length - 3 })}</div>`}</div>
            <button type="button" class="btn primary lg block" disabled=${wait} onClick=${async () => { try { await api("/account/continue", { method: "POST", body: {} }); onDone(); } catch (e) { setWhy(e.message); } }}>${t("welcome.continue")}</button></div>
            <div class=${`onboard-divider${wait ? " waiting" : ""}`}><span>${t("welcome.orAnother")}</span></div>`}
          <${AccountLogin} secondary=${!!existingConnection} gift manual=${manual} onFace=${onFace} onSignedIn=${loadModels} />
          ${!existingConnection && html`<div class=${`onboard-divider${wait ? " waiting" : ""}`}><span>${t("welcome.or")}</span></div>`}
          <div class=${`onboard-alternative${wait ? " waiting" : ""}`}><button type="button" class="btn outline lg block" disabled=${wait} onClick=${() => setOwnKey(true)}>${t(existingConnection ? "welcome.addKey" : "official.useOwn")}</button>
            <p class="hint">${t(existingConnection ? "welcome.addKeyHint" : "welcome.ownKeyHint")}</p></div>`}
    </div></main>`;
}
