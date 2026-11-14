import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, MenuButton, Spinner, tokenPx } from "./ui.js";
import { api } from "../lib/api.js";
import { t } from "../lib/i18n.js";
import { ms } from "../design/motion.js";
export const officialName = (p) => p.region ? t("official.named", { name: p.name, region: t(`official.region.${p.region}`) }) : p.name;
export function OfficialKeyForm({ provider, autoFocus = true, onConnected, onBusy, onFace, desktop = true }) {
  const [key, setKey] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [visible, setVisible] = useState(false); const [success, setSuccess] = useState(null); const input = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { setKey(""); setErr(""); setVisible(false); setSuccess(null); if (autoFocus) input.current?.focus(); }, [provider.id]);
  const spaces = /\s/.test(key); const error = spaces ? t("welcome.keySpaces") : err;
  const name = officialName(provider);
  const submit = async (e) => {
    e.preventDefault(); if (!key || spaces || busy || success !== null) return;
    setBusy(true); onBusy?.(true); onFace?.("thinking"); setErr("");
    try {
      const r = await api(`/official/${encodeURIComponent(provider.id)}`, { method: "PUT", body: { key } });
      if (!mounted.current) return;
      setSuccess(r.models?.length || 0); onFace?.("idle");
      await new Promise((resolve) => setTimeout(resolve, ms("--dur-hold", 600)));
      if (mounted.current) await onConnected(r);
    } catch (e2) {
      if (!mounted.current) return;
      setErr(e2.message); onFace?.("error"); setSuccess(null);
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    } finally { if (mounted.current) setBusy(false); onBusy?.(false); }
  };
  return html`<form class="official-form" onSubmit=${submit}>
    <div class="official-key-label"><label for="official-key-input">${t("official.keyLabel", { name })}</label>
      <a class="text" href=${busy || success !== null ? undefined : provider.keysUrl} aria-disabled=${busy || success !== null} target="_blank" rel="noopener noreferrer">${t("official.getKey")}</a></div>
    <div class=${`official-secret${error ? " err" : ""}`}><input id="official-key-input" ref=${input} class=${`field mono${error ? " err" : ""}`} type=${visible ? "text" : "password"}
      autocomplete="off" spellcheck="false" placeholder=${t("welcome.pasteKey")} value=${key} readonly=${busy || success !== null} aria-invalid=${!!error}
      onInput=${(e) => { const value = e.target.value.trim(); e.target.value = value; setKey(value); setErr(""); }} />
      <button type="button" class="icon-btn" disabled=${busy || success !== null} title=${t(visible ? "welcome.hideKey" : "welcome.showKey")} aria-label=${t(visible ? "welcome.hideKey" : "welcome.showKey")} onClick=${() => setVisible(!visible)}><${Icon} name=${visible ? "eyeOff" : "eye"} /></button></div>
    ${error ? html`<div class="err-text" role="alert"><${Icon} name="warning" size="sm" />${error}</div>` : provider.connected && html`<p class="hint official-replace">${t("welcome.replaceKey", { last4: provider.keyTail })}</p>`}
    <button type="submit" class=${`btn primary lg block${busy ? " checking" : ""}`} disabled=${!key || spaces || busy || success !== null}>
      ${success !== null ? html`<${Icon} name="check" />${t("welcome.keySuccess", { n: success })}` : busy ? html`<${Spinner} />${t("official.connecting")}` : t("official.connect")}</button>
    <p class="hint official-privacy">${t(desktop ? "welcome.keyPrivacy" : "welcome.keyPrivacyServer", { name })}</p>
  </form>`;
}
export function OfficialStart({ onConnected, onBusy, onFace, desktop }) {
  const [list, setList] = useState(null); const [cur, setCur] = useState("openai"); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api("/official").then((r) => { setList(r.providers); setCur(r.providers.find((p) => p.id === "openai")?.id || r.providers[0]?.id || ""); }).catch((e) => setErr(e.message)); }, []);
  const provider = list?.find((p) => p.id === cur);
  return html`<div class="official-start">${err && html`<div class="err-text" role="alert">${err}</div>`}${!list && !err && html`<${Spinner} />`}
    ${provider && html`<div class="set-field"><span class="k">${t("welcome.provider")}</span>
      <${MenuButton} label=${t("welcome.provider")} value=${cur} disabled=${busy} width=${Math.min(tokenPx("--onboard-col-w", 400), window.innerWidth - 2 * tokenPx("--space-6", 24))} align="left" onChange=${setCur}
        options=${list.map((p) => [p.id, html`<span class="provider-option"><span>${officialName(p)}</span>${p.connected && html`<small>${t("welcome.keyConnected", { last4: p.keyTail })}</small>`}</span>`])} /></div>
      <${OfficialKeyForm} provider=${provider} desktop=${desktop} onFace=${onFace} onBusy=${(v) => { setBusy(v); onBusy?.(v); }} onConnected=${onConnected} />`}</div>`;
}
