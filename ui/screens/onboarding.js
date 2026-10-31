// 首次启动 / 退出登录后："未连接"时的整页空态：大头像 + 一句 slogan + 一个登录按钮（在系统浏览器里完成，
// 回来后自动签发本机 Key 并连接）。只有 Docker / 远程部署（浏览器登录的回调回不到这台机器）才显示粘贴 API Key。
// 不是向导路由。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Menu, Notice, Seg, Spinner, CopyButton } from "../components/ui.js";
import { BotAvatar, MAIN_CHAR } from "../components/avatar.js";
import { FamilyHead, PickModel, familyName, groupModels, useFamilies } from "../components/model-picker.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";
import { LANG_NAMES, changeLang, getLangPref, t, useLang } from "../lib/i18n.js";
import { MF_CONSOLE, MF_DOCS, MF_KEYS } from "../lib/links.js";

export { MF_CONSOLE, MF_DOCS };
/** Modelflare 线路的选项 [值, 显示名]（引导页"高级"和设置页共用；按当前语言，渲染时再调） */
export const lineOptions = () => [
  ["auto", t("common.auto")],
  ["global", t("onboarding.line.global")],
  ["cn", t("onboarding.line.cn")],
];

/** 粘贴 Key → 校验（GET /v1/models）→ 写入。onConnected(result) 收到 { models, keyTail, … } */
/** onFace(state)：给旁边的头像用——"listening"（在输入）/ "thinking"（正在校验）/ "idle" / "error"（一次性） */
export function KeyForm({ line: initialLine = "auto", onConnected, onFace, showLine = true, submitLabel = t("onboarding.key.submit") }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [line, setLine] = useState(initialLine);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState(null);
  const input = useRef(null);
  const btn = useRef(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => onFace?.(busy ? "thinking" : key.trim() ? "listening" : "idle"), [busy, !!key.trim()]);

  const submit = async (lineOverride) => {
    const k = key.trim();
    if (!k || busy) return;
    const useLine = lineOverride || line;
    if (lineOverride) setLine(lineOverride);
    setBusy(true);
    setErr(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      const r = await api("/modelflare", { method: "PUT", body: { apiKey: k, line: useLine } });
      setKey("");
      onConnected(r);
    } catch (e) {
      setErr({ message: e.message, code: e.data?.code, suggestLine: e.data?.suggestLine });
      onFace?.("error");
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
      setSlow(false);
    }
  };
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setKey(text);
        setErr(null);
        requestAnimationFrame(() => btn.current?.focus());
      }
    } catch {
      input.current?.focus();
    }
  };
  const retype = () => {
    input.current?.focus();
    input.current?.select();
  };

  return html`<form class="list" onSubmit=${(e) => { e.preventDefault(); submit(); }}>
    <label class="k" for="mf-key">${t("onboarding.key.label")}</label>
    <div class="field-wrap">
      <input id="mf-key" ref=${input} class=${`field mono${err?.code === "invalid_key" ? " err" : ""}`} type=${show ? "text" : "password"}
        autocomplete="off" spellcheck="false" placeholder=${t("onboarding.key.placeholder")} value=${key} readonly=${busy}
        aria-invalid=${!!err} aria-describedby="mf-key-note"
        onInput=${(e) => { setKey(e.target.value); setErr(null); }}
        onPaste=${() => requestAnimationFrame(() => btn.current?.focus())} />
      <span class="tail">
        <button type="button" class="icon-btn" title=${t("onboarding.key.paste")} aria-label=${t("onboarding.key.paste")} onClick=${paste}><${Icon} name="paste" size="sm" /></button>
        <button type="button" class="icon-btn" title=${show ? t("onboarding.key.hide") : t("onboarding.key.show")} aria-label=${show ? t("onboarding.key.hideKey") : t("onboarding.key.showKey")} onClick=${() => setShow((v) => !v)}><${Icon} name=${show ? "eyeOff" : "eye"} size="sm" /></button>
      </span>
    </div>
    ${err && html`<div class="err-text" role="alert">
      <span>${err.message}</span>
      ${err.code === "invalid_key" && html`<button type="button" class="text" onClick=${retype}>${t("onboarding.key.retype")}</button>`}
      ${err.code === "forbidden" && html`<a href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">${t("onboarding.key.checkGroup")}</a>`}
      ${(err.code === "rate_limited" || err.code === "upstream" || err.code === "bad_response") && html`<button type="button" class="text" onClick=${() => submit()}>${t("common.retry")}</button>`}
      ${err.code === "network" && err.suggestLine === "cn" && html`<button type="button" class="text accent" onClick=${() => submit("cn")}>${t("onboarding.key.useCn")}</button>`}
    </div>`}
    <p class="hint" id="mf-key-note">${t("onboarding.key.note")}</p>
    <button type="submit" ref=${btn} class="btn primary lg block" disabled=${!key.trim() || busy}>
      ${busy ? html`<${Spinner} /> ${t("onboarding.key.connecting")}` : submitLabel}
    </button>
    ${slow && html`<p class="slow">${showLine ? t("onboarding.key.slowLine") : t("onboarding.key.slow")}</p>`}
    ${showLine && html`<details>
      <summary>${t("onboarding.key.advanced")} <${Icon} name="chevDown" size="xs" /></summary>
      <div class="row compact">
        <div class="who"><div class="name">${t("onboarding.line.label")}</div><div class="sub">${t("onboarding.line.sub")}</div></div>
        <${Seg} label=${t("onboarding.line.label")} options=${lineOptions()} value=${line} onChange=${setLine} disabled=${busy} />
      </div>
    </details>`}
  </form>`;
}

/**
 * 登录 / 注册 Modelflare：桌面版由主进程在系统浏览器里打开授权页；浏览器版在新标签页打开（被拦截时
 * 用下面的链接）。等待期间每秒读一次账户状态，登录完成（本机 Key 已接上）后 onSignedIn(status)。
 */
export function AccountLogin({ onSignedIn, onFace, label = t("onboarding.login.label") }) {
  const [waiting, setWaiting] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => onFace?.(waiting ? "thinking" : "idle"), [waiting]);
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const poll = setInterval(async () => {
      const s = await api("/account").catch(() => null);
      if (!s || stop) return;
      if (s.state === "signed_in") {
        stop = true;
        setWaiting(false);
        onSignedIn(s);
      } else if (s.state !== "signing_in") {
        stop = true;
        setWaiting(false);
        if (s.error) {
          setErr(s.error);
          onFace?.("error");
        }
      }
    }, 1000);
    return () => clearInterval(poll);
  }, [waiting]);
  const start = async () => {
    setErr("");
    try {
      const r = await api("/account/login", { method: "POST", body: {} });
      setUrl(r.loginUrl);
      setWaiting(true);
      if (!r.opened) window.open(r.loginUrl, "_blank", "noopener");
    } catch (e) {
      setErr(e.message);
      onFace?.("error");
    }
  };
  const cancel = () => {
    setWaiting(false);
    api("/account/login/cancel", { method: "POST", body: {} }).catch(() => {});
  };
  if (waiting) {
    return html`<div class="login-cta" role="status">
      <div class="login-wait"><${Spinner} /> ${t("onboarding.login.waiting")}</div>
      <div class="login-links">
        <a class="text" href=${url} target="_blank" rel="noopener noreferrer">${t("onboarding.login.reopen")}</a>
        <${CopyButton} text=${url} label=${t("onboarding.login.copyLink")} />
        <button type="button" class="text" onClick=${cancel}>${t("common.cancel")}</button>
      </div>
    </div>`;
  }
  return html`<div class="login-cta">
    <button type="button" class="btn primary lg block" onClick=${start}>${label}</button>
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
  </div>`;
}

function ModelStep({ models, initial, onDone }) {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(initial && models.includes(initial) ? initial : models[0] || "");
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
  return html`<div class="list">
    <div class="connected"><span class="dot ok"></span>${t("onboarding.model.found", { count: models.length, n: html`<span class="num">${models.length}</span>` })}</div>
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
    <button type="button" class="btn primary lg block" disabled=${busy} onClick=${start}>${busy ? html`<${Spinner} /> ${t("onboarding.model.saving")}` : models.length ? t("onboarding.model.start") : t("onboarding.model.startAnyway")}</button>
  </div>`;
}

/** 语言切换：在引导列顶上靠右。新用户连接前就能换语言（按钮上是当前界面语言的名字，菜单里勾的是偏好） */
function LangSwitch() {
  const lang = useLang();
  const pref = getLangPref();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const label = t("common.lang.label");
  const opts = [["system", t("common.lang.system")], ["zh-CN", LANG_NAMES["zh-CN"]], ["en", LANG_NAMES.en]];
  return html`<div class="onboard-lang">
    <button type="button" class="pick" ref=${ref} aria-haspopup="menu" aria-expanded=${open} aria-label=${label} title=${label} onClick=${() => setOpen((v) => !v)}>
      <${Icon} name="globe" size="sm" class="lead" /><span class="v">${LANG_NAMES[lang]}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${Menu} anchor=${ref.current} width=${180} align="right" label=${label} onClose=${() => setOpen(false)}
      items=${opts.map(([v, text]) => ({ label: text, cur: v === pref, onSelect: () => v !== pref && changeLang(v).catch(failed) }))} />`}
  </div>`;
}

export function Onboarding({ status, gateway, defaultModel, onDone }) {
  const [models, setModels] = useState(null);
  // Docker / 远程部署：浏览器登录的回调到不了本程序，只能用 API Key
  const [useKey, setUseKey] = useState(false);
  // 授权在网页上被撤销后会回到这里：说明原因
  const [why, setWhy] = useState("");
  useEffect(() => {
    api("/account")
      .then((a) => {
        if (a.error) setWhy(a.error);
        if (a.loginAvailable === false) setUseKey(true);
      })
      .catch(() => {});
  }, []);
  const [face, setFace] = useState("idle");
  const [cue, setCue] = useState(null);
  const onFace = (f) => (f === "error" ? setCue({ kind: "error", at: Date.now() }) : setFace(f));
  const loadModels = () =>
    api("/models")
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
  return html`<main class="onboard" data-screen="onboarding">
    <div class="onboard-col">
      <${LangSwitch} />
      <div class="onboard-hero">
        <${BotAvatar} char=${MAIN_CHAR} size=${models === null ? 168 : 88} state=${face} cue=${cue} lively pokeable greet />
        <h1>${t("onboarding.slogan")}</h1>
      </div>
      ${gateway && gateway.mode === "managed" && gateway.state === "failed" && html`<${Notice} tone="red">${t("onboarding.gatewayFailed", { error: gateway.lastError || t("onboarding.unknownReason") })}<//>`}
      ${why && models === null && html`<${Notice} tone="amber">${why}<//>`}
      ${models !== null
        ? html`<${ModelStep} models=${models} initial=${defaultModel} onDone=${onDone} />`
        : useKey
          ? html`<${KeyForm} line=${status.line} onFace=${onFace} onConnected=${(r) => (setFace("idle"), setModels(r.models || []))} />
            <div class="links">
              <span>${t("onboarding.keyOnly")}</span>
              <a href=${MF_KEYS} target="_blank" rel="noopener noreferrer">${t("onboarding.createKey")}</a>
            </div>`
          : html`<${AccountLogin} onFace=${onFace} onSignedIn=${loadModels} />`}
    </div>
  </main>`;
}
