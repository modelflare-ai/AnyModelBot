// 首次启动 / 断开后：只有一个动作——粘贴 Modelflare API Key。不是向导路由，而是"未连接"时的整页空态。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Seg, Spinner } from "../components/ui.js";
import { AppMark } from "../components/avatar.js";
import { groupModels } from "../components/model-picker.js";
import { api } from "../lib/api.js";

// 控制台 API Keys 页还没有稳定的深链地址，先指向官网首页（登录后可进控制台）
export const MF_CONSOLE = "https://modelflare.dev";
export const MF_DOCS = "https://docs.modelflare.dev";
export const LINE_OPTIONS = [
  ["auto", "自动"],
  ["global", "国际"],
  ["cn", "中国大陆优化"],
];

/** 粘贴 Key → 校验（GET /v1/models）→ 写入。onConnected(result) 收到 { models, keyTail, … } */
export function KeyForm({ line: initialLine = "auto", onConnected, showLine = true, submitLabel = "连接 Modelflare" }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [line, setLine] = useState(initialLine);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState(null);
  const input = useRef(null);
  const btn = useRef(null);
  useEffect(() => input.current?.focus(), []);

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
          ${!groups.length && html`<p class="hint" style="padding:8px">没有匹配的模型</p>`}
        </div>`
      : html`<div class="notice amber"><span class="notice-text">这个 Key 所在的分组暂无可用模型。可以在控制台给分组开放模型后再回来刷新。</span>
          <a class="btn" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">去控制台 ↗</a></div>`}
    ${err && html`<div class="err-text" role="alert">${err}</div>`}
    <button type="button" class="btn primary lg block" disabled=${busy} onClick=${start}>${busy ? html`<${Spinner} /> 正在保存…` : models.length ? "开始对话" : "仍然开始"}</button>
  </div>`;
}

export function Onboarding({ status, gateway, defaultModel, onDone }) {
  const [models, setModels] = useState(null);
  return html`<main class="onboard" data-screen="onboarding">
    <div class="onboard-col">
      <div class="onboard-hero">
        <${AppMark} size=${44} />
        <h1>用 Modelflare 开始</h1>
        <p>粘贴 API Key，GPT、Claude、Grok、Gemini 等模型会自动列出。</p>
      </div>
      ${gateway && gateway.mode === "managed" && gateway.state === "failed" && html`<div class="notice red"><span class="notice-text">内置模型网关没有启动：${gateway.lastError || "未知原因"}。修复后重启应用再连接。</span></div>`}
      ${models === null
        ? html`<${KeyForm} line=${status.line} onConnected=${(r) => setModels(r.models || [])} />
          <div class="links">
            <a href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">还没有 Key？去 Modelflare 控制台创建 ↗</a>
          </div>`
        : html`<${ModelStep} models=${models} initial=${defaultModel} onDone=${onDone} />`}
    </div>
  </main>`;
}
