// "更新了什么"弹窗。三种打开方式：
// - installed：升级后第一次打开主界面时弹一次（main.js 问 /whats-new），关掉就记成看过；
// - available：升级前，从设置 › 关于打开，看新版本更新了什么，底部直接下载 / 重启更新；
// - history：设置 › 关于里随时打开的更新日志。
// 内容来自 CHANGELOG：上面是这次的新内容（中间跳过的版本一起列出），下面接着是更早的全部版本，一直往下滑就能看完。
import { useEffect, useState } from "preact/hooks";
import { html, Button, Notice, Sheet, Spinner } from "./ui.js";
import { Markdown } from "./markdown.js";
import { updateError } from "./app-update.js";
import { api } from "../lib/api.js";
import { createStore, toast, useStore } from "../lib/store.js";
import { getLang, t } from "../lib/i18n.js";
import { usePresence } from "../design/motion.js";

const RELEASES = "https://github.com/modelflare-ai/AnyModelBot/releases";

/** 开着的弹窗：{ mode: "installed" | "available" | "history", version, since }；null = 没开 */
export const whatsNew = createStore(null);
export const openWhatsNew = (v) => whatsNew.set(v);

/** 版本号比较（x.y.z），a 新返回正数 */
export function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/**
 * 分成"这次的新内容"和"更早的版本"：新内容是 since 之后、到 version 为止的版本（since 为空时只算 version 这一版）；
 * 更早的是剩下不比 version 新的。都按新到旧。
 */
export function splitEntries(entries, version, since) {
  const upTo = entries.filter((e) => cmpVersion(e.version, version) <= 0).sort((a, b) => cmpVersion(b.version, a.version));
  const isNew = (e) => (since ? cmpVersion(e.version, since) > 0 : e.version === version);
  return { fresh: upTo.filter(isNew), older: upTo.filter((e) => !isNew(e)) };
}

function Entry({ e }) {
  return html`<section class="wn-entry">
    <h3 class="wn-ver"><span class="num">${e.version}</span>${e.date && html`<span class="wn-date num">${e.date}</span>`}</h3>
    <${Markdown} text=${e.markdown} />
  </section>`;
}

/** 升级前的主操作：下载更新 / 重启并更新；不支持应用内更新时打开安装包链接 */
function UpdateAction({ update, onDone, onChanged }) {
  const [pending, setPending] = useState(false);
  if (!update?.available) return null;
  const ready = update.phase === "ready";
  const working = ["checking", "downloading", "installing"].includes(update.phase);
  if (!update.supported) return html`<a class="btn primary" href=${update.downloadUrl || update.releaseUrl || RELEASES} target="_blank" rel="noopener noreferrer" onClick=${onDone}>${t("settings.rows.version.download")}</a>`;
  const act = async () => {
    if (pending) return;
    setPending(true);
    try {
      await api(`/update/${ready ? "install" : "download"}`, { method: "POST", body: {} });
      onDone();
    } catch (error) {
      toast(updateError(error), "err");
    } finally {
      setPending(false);
      onChanged?.();
    }
  };
  const label = ready ? t("updates.restart") : update.phase === "downloading" ? t("updates.downloadingAction") : update.phase === "installing" ? t("updates.installing") : t("updates.download");
  return html`<${Button} variant="primary" loading=${pending} disabled=${working || (ready && update.busy)} title=${ready && update.busy ? t("updates.busy") : ""} onClick=${act}>${label}<//>`;
}

function WhatsNewSheet({ open, update, onUpdateChanged, leaving, onClose }) {
  const { mode, version, since } = open;
  const [data, setData] = useState(null); // { entries } | { error, releaseUrl }
  useEffect(() => {
    const q = new URLSearchParams({ lang: getLang() });
    if (mode === "available") q.set("version", version);
    api(`/changelog?${q}`).then((d) => setData({ entries: d.entries || [] }), (e) => setData({ error: e.message || t("updates.whatsNew.failed"), releaseUrl: e.data?.releaseUrl }));
  }, [mode, version]);
  const title = mode === "installed" ? t("updates.whatsNew.title", { version }) : mode === "available" ? t("updates.whatsNew.availableTitle", { version }) : t("updates.whatsNew.historyTitle");
  const parts = data?.entries ? splitEntries(data.entries, version, since) : null;
  return html`<${Sheet} title=${title} wide leaving=${leaving} onClose=${onClose}>
    <div class="wn-body" tabindex="0">
      ${!data && html`<div class="wn-wait"><${Spinner} /> ${t("updates.whatsNew.loading")}</div>`}
      ${data?.error && html`<${Notice} tone="amber">${t("updates.whatsNew.failed")}<//>`}
      ${parts && !parts.fresh.length && !parts.older.length && html`<p class="hint">${t("updates.whatsNew.empty")}</p>`}
      ${parts && parts.fresh.map((e) => html`<${Entry} key=${e.version} e=${e} />`)}
      ${parts && parts.older.length > 0 && html`<h3 class="wn-earlier t-label">${t("updates.whatsNew.earlier")}</h3>
        ${parts.older.map((e) => html`<${Entry} key=${e.version} e=${e} />`)}`}
      ${parts && html`<p class="wn-more"><a class="text" href=${RELEASES} target="_blank" rel="noopener noreferrer">${t("updates.whatsNew.allReleases")}</a></p>`}
    </div>
    <div class="actions">
      ${data?.error && html`<a class="btn" href=${data.releaseUrl || update?.releaseUrl || RELEASES} target="_blank" rel="noopener noreferrer">${t("updates.whatsNew.viewOnGithub")}</a>`}
      ${mode === "available"
        ? html`<${Button} onClick=${onClose}>${t("updates.whatsNew.later")}<//><${UpdateAction} update=${update} onDone=${onClose} onChanged=${onUpdateChanged} />`
        : html`<${Button} variant="primary" data-autofocus onClick=${onClose}>${t("updates.whatsNew.gotIt")}<//>`}
    </div>
  <//>`;
}

/** 挂在 main.js：store 里有值就显示；installed 关掉时记成看过 */
export function WhatsNewHost({ update, onUpdateChanged }) {
  const cur = useStore(whatsNew);
  const [last, setLast] = useState(cur);
  useEffect(() => void (cur && setLast(cur)), [cur]);
  const { mounted, leaving } = usePresence(!!cur);
  const shown = cur || last;
  if (!mounted || !shown) return null;
  const close = () => {
    if (leaving) return;
    if (shown.mode === "installed") api("/whats-new/seen", { method: "POST", body: {} }).catch(() => {});
    whatsNew.set(null);
  };
  return html`<${WhatsNewSheet} key=${`${shown.mode}:${shown.version}`} open=${shown} update=${update} onUpdateChanged=${onUpdateChanged} leaving=${leaving} onClose=${close} />`;
}
