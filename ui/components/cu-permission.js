// macOS 权限只占请求所在的一处；检测与继续由宿主统一处理。
import { useEffect, useState } from "preact/hooks";
import { html, Icon, Button } from "./ui.js";
import { api } from "../lib/api.js";
import { createStore, failed, useStore } from "../lib/store.js";
import { relaunchDrafts } from "../lib/relaunch.js";
import { t } from "../lib/i18n.js";

export const permissionState = createStore(null);
const load = () => api("/computer-use/permissions").then((v) => permissionState.set(v)).catch(() => {});
export function PermissionSync() {
  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    const focus = () => { permissionState.set((v) => v && { ...v, checking: true }); api("/computer-use/permissions/check", { method: "POST", body: {} }).then((v) => permissionState.set(v)).catch(load); };
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, []);
  return null;
}
export function CuPermissionCard({ botId, messageId }) {
  const v = useStore(permissionState);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  if (!v?.supported) return null;
  const blocked = v.blocked[botId];
  if (!blocked || blocked.messageId !== messageId) return null;
  const missing = blocked.missing.filter((k) => v.status[k] !== "granted");
  const key = (s) => `scheduled.permission.${s}`;
  const call = async (path, body) => {
    setBusy(true);
    try { permissionState.set(await api(`/computer-use/permissions/${path}`, { method: "POST", body })); } catch (e) { failed(e); }
    setBusy(false);
  };
  const enable = () => missing.length && call("request", { kind: missing[0], botId });
  const later = () => api(`/computer-use/permissions/blocked/${encodeURIComponent(botId)}`, { method: "DELETE" }).then((v) => permissionState.set(v)).catch(failed);
  const reopen = async () => {
    setBusy(true);
    try { await api("/computer-use/permissions/relaunch", { method: "POST", body: relaunchDrafts() }); } catch (e) { failed(e); setBusy(false); }
  };
  const done = !missing.length;
  const needsReopen = v.restartSuggested && missing.includes("screen") && !missing.includes("accessibility");
  const continuing = blocked.state === "continuing" || blocked.state === "done";
  const heading = done ? t(key(blocked.background ? "nextRun" : continuing ? "continuing" : "ready")) : needsReopen ? t(key("reopenTitle")) : t(key(missing.length === 1 ? "titleOne" : "title"), { count: missing.length });
  if (blocked.collapsed && !done) return html`<div class="cu-permission-collapsed"><span>${t(key(needsReopen ? "reopenTitle" : "collapsed"))}</span><button type="button" class="text" disabled=${busy} onClick=${needsReopen ? reopen : enable}>${t(key(needsReopen ? "reopen" : "turnOn"))}</button></div>`;
  return html`<div class=${`cu-permission-card${done ? " granted" : ""}`} role="status" aria-busy=${busy}>
    <div class="actions"><${Icon} name=${done ? "check" : "info"} size="md" /><b>${heading}</b></div>
    ${!done && html`<p class="hint">${t(key(needsReopen ? "reopenHint" : "explanation"))}</p>`}
    ${blocked.missing.map((k) => html`<div class="cu-perm-row" key=${k}><div class="cu-perm-what"><b>${t(`firstUse.cu.${k}`)}</b><span class="hint">${t(`firstUse.cu.${k}Why`)}</span></div><span class="hint">${t(key(v.checking ? "checking" : v.status[k] === "granted" ? "on" : "off"))}</span></div>`)}
    <div class="actions">
      ${!done && html`<${Button} variant="primary" loading=${busy} onClick=${needsReopen ? reopen : enable}>${t(key(needsReopen ? "reopen" : "turnOn"))}<//><button type="button" class="text" disabled=${busy} onClick=${later}>${t(key("later"))}</button>`}
      ${done && !continuing && !blocked.background && html`<${Button} variant="primary" loading=${busy} onClick=${() => call("continue", { botId })}>${t(key("continue"))}<//>`}
    </div>
    ${!done && !needsReopen && html`<details open=${manual} onToggle=${(e) => setManual(e.currentTarget.open)}><summary>${t(key("manual"))}</summary>
      <p class="hint">${t(key("path"), { item: t(`firstUse.cu.${missing[0]}`) })}</p><button type="button" class="text" onClick=${() => call("open", { kind: missing[0] })}>${t("firstUse.cu.openSettings")}</button>
    </details>`}
  </div>`;
}
