// 首次启动 / 退出登录后："未连接"时的整页空态：大头像 + 一句 slogan + 一个登录按钮（在系统浏览器里完成，
// 回来后自动签发本机 Key 并连接）。只有 Docker / 远程部署（浏览器登录的回调回不到这台机器）才显示粘贴 API Key。
// 不是向导路由。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Notice, Seg, Spinner, CopyButton } from "../components/ui.js";
import { BotAvatar, MAIN_CHAR } from "../components/avatar.js";
import { groupModels } from "../components/model-picker.js";
import { api } from "../lib/api.js";
import { MF_CONSOLE, MF_DOCS, MF_KEYS } from "../lib/links.js";

export { MF_CONSOLE, MF_DOCS };
export const LINE_OPTIONS = [
  ["auto", "自动"],
  ["global", "国际"],
  ["cn", "中国大陆优化"],
];

/** 粘贴 Key → 校验（GET /v1/models）→ 写入。onConnected(result) 收到 { models, keyTail, … } */
/** onFace(state)：给旁边的头像用——"listening"（在输入）/ "thinking"（正在校验）/ "idle" / "error"（一次性） */
export function KeyForm({ line: initialLine = "auto", onConnected, onFace, showLine = true, submitLabel = "连接 Modelflare" }) {
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
    const t = setTimeout(() => setSlow(true), 4000);
    try {
      const r = await api("/modelflare", { method: "PUT", body: { apiKey: k, line: useLine } });
      setKey("");
      onConnected(r);
    } catch (e) {
      setErr({ message: e.message, code: e.data?.code, suggestLine: e.data?.suggestLine });
      onFace?.("error");
    } finally {
      clearTimeout(t);
      setBusy(false);
      setSlow(false);
    }
  };
  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) {
        setKey(t);
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
    <label class="k" for="mf-key">API Key</label>
    <div class="field-wrap">
      <input id="mf-key" ref=${input} class=${`field mono${err?.code === "invalid_key" ? " err" : ""}`} type=${show ? "text" : "password"}
        autocomplete="off" spellcheck="false" placeholder="粘贴你的 Modelflare API Key" value=${key} readonly=${busy}
        aria-invalid=${!!err} aria-describedby="mf-key-note"
        onInput=${(e) => { setKey(e.target.value); setErr(null); }}
        onPaste=${() => requestAnimationFrame(() => btn.current?.focus())} />
      <span class="tail">
        <button type="button" class="icon-btn" title="从剪贴板粘贴" aria-label="从剪贴板粘贴" onClick=${paste}><${Icon} name="paste" size=${14} /></button>
        <button type="button" class="icon-btn" title=${show ? "隐藏" : "显示"} aria-label=${show ? "隐藏 Key" : "显示 Key"} onClick=${() => setShow((v) => !v)}><${Icon} name=${show ? "eyeOff" : "eye"} size=${14} /></button>
      </span>
    </div>
    ${err && html`<div class="err-text" role="alert">
      <span>${err.message}</span>
      ${err.code === "invalid_key" && html`<button type="button" class="text" onClick=${retype}>重新输入</button>`}
      ${err.code === "forbidden" && html`<a href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">去控制台检查分组 ↗</a>`}
      ${(err.code === "rate_limited" || err.code === "upstream" || err.code === "bad_response") && html`<button type="button" class="text" onClick=${() => submit()}>重试</button>`}
      ${err.code === "network" && err.suggestLine === "cn" && html`<button type="button" class="text accent" onClick=${() => submit("cn")}>改用大陆优化线路并重试</button>`}
    </div>`}
    <p class="hint" id="mf-key-note">密钥只保存在本机，不会写入日志或命令行参数。</p>
    <button type="submit" ref=${btn} class="btn primary lg block" disabled=${!key.trim() || busy}>
      ${busy ? html`<${Spinner} /> 正在连接…` : submitLabel}
    </button>
    ${slow && html`<p class="slow">网络较慢${showLine ? "，可在「高级」里切换线路" : ""}。</p>`}
    ${showLine && html`<details>
      <summary>高级 <${Icon} name="chevDown" size=${12} /></summary>
      <div class="row compact">
        <div class="who"><div class="name">线路</div><div class="sub">中国大陆访问可选优化线路</div></div>
        <${Seg} label="线路" options=${LINE_OPTIONS} value=${line} onChange=${setLine} disabled=${busy} />
      </div>
    </details>`}
  </form>`;
}

/**
 * 登录 / 注册 Modelflare：桌面版由主进程在系统浏览器里打开授权页；浏览器版在新标签页打开（被拦截时
 * 用下面的链接）。等待期间每秒读一次账户状态，登录完成（本机 Key 已接上）后 onSignedIn(status)。
 */
export function AccountLogin({ onSignedIn, onFace, label = "登录 / 注册 Modelflare" }) {
  const [waiting, setWaiting] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => onFace?.(waiting ? "thinking" : "idle"), [waiting]);
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const t = setInterval(async () => {
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
    return () => clearInterval(t);
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
      <div class="login-wait"><${Spinner} /> 在浏览器里完成登录后，会自动回到这里</div>
      <div class="login-links">
        <a class="text" href=${url} target="_blank" rel="noopener noreferrer">重新打开登录页 ↗</a>
        <${CopyButton} text=${url} label="复制链接" />
        <button type="button" class="text" onClick=${cancel}>取消</button>
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
  const start = async () => {
    setBusy(true);
    try {
      await api("/settings", { method: "PUT", body: { defaultModel: cur } });
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return html`<div class="list">
    <div class="connected"><span class="dot ok"></span>已连接 · 找到 <span class="num">${models.length}</span> 个模型</div>
    ${models.length
      ? html`<p class="hint">选一个默认模型，之后随时可在对话里切换。</p>
        <input class="field" placeholder="筛选模型" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="筛选模型" />
        <div class="picklist" role="listbox" aria-label="默认模型">
          ${groups.map(([g, ms]) => html`${g && html`<div class="group">${g}</div>`}
            ${ms.map(([m, label]) => html`<button type="button" role="option" aria-selected=${m === cur} class=${m === cur ? "cur" : ""} onClick=${() => setCur(m)} onDblClick=${start}>
              <span class="v">${label}</span>${m === cur && html`<span class="check"><${Icon} name="check" size=${14} /></span>`}
            </button>`)}`)}
          ${!groups.length && html`<p class="hint">没有匹配的模型</p>`}
        </div>`
      : html`<${Notice} tone="amber" action=${html`<a class="btn" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">去控制台 ↗</a>`}>这个 Key 所在的分组暂无可用模型。可以在控制台给分组开放模型后再回来刷新。<//>`}
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    <button type="button" class="btn primary lg block" disabled=${busy} onClick=${start}>${busy ? html`<${Spinner} /> 正在保存…` : models.length ? "开始对话" : "仍然开始"}</button>
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
      <div class="onboard-hero">
        <${BotAvatar} char=${MAIN_CHAR} size=${models === null ? 168 : 88} state=${face} cue=${cue} lively pokeable greet />
        <h1>任意模型，一个助手</h1>
      </div>
      ${gateway && gateway.mode === "managed" && gateway.state === "failed" && html`<${Notice} tone="red">内置模型网关没有启动：${gateway.lastError || "未知原因"}。修复后重启应用再连接。<//>`}
      ${why && models === null && html`<${Notice} tone="amber">${why}<//>`}
      ${models !== null
        ? html`<${ModelStep} models=${models} initial=${defaultModel} onDone=${onDone} />`
        : useKey
          ? html`<${KeyForm} line=${status.line} onFace=${onFace} onConnected=${(r) => (setFace("idle"), setModels(r.models || []))} />
            <div class="links">
              <span>Docker 或远程部署无法用浏览器登录，请填写 API Key</span>
              <a href=${MF_KEYS} target="_blank" rel="noopener noreferrer">在 Modelflare 控制台创建 Key ↗</a>
            </div>`
          : html`<${AccountLogin} onFace=${onFace} onSignedIn=${loadModels} />`}
    </div>
  </main>`;
}
