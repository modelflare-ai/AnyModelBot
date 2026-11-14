import { useEffect, useState } from "preact/hooks";
import { html, Button, IconButton, MenuButton } from "../components/ui.js";
import { Markdown } from "../components/markdown.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";
import { resourceFileUrl, resourcePreviewPath, resourceFileAction, openResource, websiteResource } from "../lib/resource-preview.js";
import { t } from "../lib/i18n.js";

function WebsiteForm() {
  const [url, setUrl] = useState("");
  const [invalid, setInvalid] = useState(false);
  return html`<form class="preview-address" noValidate onSubmit=${(e) => {
    e.preventDefault();
    const resource = websiteResource(url);
    setInvalid(!resource);
    if (resource) { openResource(resource); setUrl(""); }
  }}>
    <label for="preview-address">${t("info.preview.address")}</label>
    <div class="preview-address-row"><input id="preview-address" class="field" type="url" inputMode="url" autoCapitalize="none" spellCheck=${false} required placeholder="https://" value=${url} aria-invalid=${invalid || undefined} aria-describedby=${invalid ? "preview-address-error" : undefined}
      onInput=${(e) => { setUrl(e.currentTarget.value); setInvalid(false); }} /><${Button} type="submit">${t("common.open")}<//></div>
    ${invalid && html`<p id="preview-address-error" class="preview-address-error" role="alert">${t("info.preview.invalidUrl")}</p>`}
  </form>`;
}

function Content({ item, revision }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setData(null); setError(""); setLoading(true); setSlow(false);
    if (item.type === "website") setData({ kind: "website", url: item.url });
    else api(resourcePreviewPath(item), { signal: abort.signal })
      .then((d) => { if (!abort.signal.aborted) { setData(d); setLoading(["html", "pdf", "image"].includes(d.kind)); } })
      .catch((e) => { if (!abort.signal.aborted) { setError(e.message); setLoading(false); } });
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [item.id, revision]);
  const loaded = () => setLoading(false);
  const broken = () => { setError(t("info.preview.loadFailed")); setLoading(false); };
  const src = item.type === "file" ? `${resourceFileUrl(item)}&v=${revision}` : item.url;
  return html`<div class="preview-content" aria-busy=${loading}>
    ${loading && html`<p class="preview-status" role="status">${t(slow ? "info.preview.slow" : "common.loading")}</p>`}
    ${error && html`<p class="preview-status" role="alert">${error}</p>`}
    ${data?.kind === "unsupported" && html`<p class="preview-status">${t(`info.preview.${data.reason}`)}</p>`}
    ${data?.kind === "markdown" && html`<article class="preview-document selectable"><${Markdown} text=${data.text} conv=${item.conv} botId=${item.botId} filePath=${item.path} canOpen=${item.canOpen} /></article>`}
    ${data?.kind === "text" && html`<pre class="preview-text selectable">${data.text}</pre>`}
    ${data?.kind === "image" && !error && html`<div class="preview-image"><img src=${src} alt=${item.name} onLoad=${loaded} onError=${broken} /></div>`}
    ${data?.kind === "pdf" && !error && html`<iframe class="preview-frame" title=${item.name} src=${src} onLoad=${loaded} onError=${broken}></iframe>`}
    ${["html", "website"].includes(data?.kind) && !error && html`<iframe class="preview-frame" title=${item.name} src=${data.url} sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" onLoad=${loaded} onError=${broken}></iframe>`}
  </div>`;
}

/** One active resource at a time; switching/closing releases the previous frame. */
export function ResourcePreview({ state = { items: [], active: "" }, onSelect, onRemove }) {
  const [revision, setRevision] = useState(0);
  const item = state.items.find((x) => x.id === state.active) || state.items.at(-1);
  const desktop = (action) => { const request = resourceFileAction(item, action); return api(request.path, { method: "POST", body: request.body }).catch(failed); };
  if (!item) return html`<div class="preview-empty"><p>${t("info.preview.empty")}</p><${WebsiteForm} /></div>`;
  const href = item.type === "website" ? item.url : resourceFileUrl(item);
  return html`<div class="resource-preview">
    <div class="preview-toolbar">
      <${MenuButton} label=${t("info.preview.opened")} value=${item.id} options=${state.items.map((x) => [x.id, x.name])} onChange=${onSelect} />
      <${IconButton} icon="refresh" label=${t("common.refresh")} onClick=${() => setRevision((v) => v + 1)} />
      <${IconButton} icon="close" label=${t("info.preview.closeFile")} onClick=${() => onRemove(item.id)} />
    </div>
    <div class="preview-actions">
      ${item.type === "file" && item.canOpen
        ? html`<button type="button" class="text" onClick=${() => desktop("open")}>${t("info.preview.openSystem")}</button><button type="button" class="text" onClick=${() => desktop("reveal")}>${t("chat.file.reveal")}</button>`
        : html`<a class="text" href=${href} target="_blank" rel="noopener noreferrer">${t("common.openExternal")}</a>`}
      ${item.type === "file" && html`<a class="text" href=${`${href}&download=1`} download=${item.name}>${t("info.preview.download")}</a>`}
    </div>
    ${item.type === "website" && html`<p class="preview-hint">${t("info.preview.websiteHint")}</p>`}
    <${Content} key=${`${item.id}:${revision}`} item=${item} revision=${revision} />
  </div>`;
}
