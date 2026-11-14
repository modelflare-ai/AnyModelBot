// Shared entry point for chat, history, groups and Bot workbenches. A synchronous,
// cancelable event preserves normal link navigation when no panel is mounted.
export const PREVIEW_EVENT = "amb-open-preview";
export const fileUrl = (conv, path) => `/amb/api/conversations/${encodeURIComponent(conv)}/file?path=${encodeURIComponent(path)}`;

export function websiteResource(value, name = "", origin = globalThis.location?.origin) {
  try {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return null;
    const url = new URL(value.trim());
    if (url.username || url.password || url.origin === origin || url.href.length > 2048) return null;
    return { id: `web:${url.href}`, type: "website", url: url.href, name: name || url.hostname };
  } catch { return null; }
}

export function fileResource(file, conv, canOpen = false) {
  if (!conv || !file?.path || file.gone) return null;
  return { id: JSON.stringify([conv, file.path]), type: "file", conv, path: file.path, name: file.name || file.path.split(/[\\/]/).pop(), canOpen };
}

export function appFileResource(path, botId, canOpen = false) {
  if (typeof path !== "string" || !path.startsWith("app/") || !localFilePath(path)) return null;
  return { id: JSON.stringify(["app", botId, path]), type: "file", botId, path, name: path.split("/").pop(), canOpen };
}
export const resourceFileUrl = (item) => item.botId ? `/amb/api/bots/${encodeURIComponent(item.botId)}/app/download?path=${encodeURIComponent(item.path)}` : fileUrl(item.conv, item.path);
export const resourcePreviewPath = (item) => item.botId ? `/bots/${encodeURIComponent(item.botId)}/app/preview?path=${encodeURIComponent(item.path)}` : `/conversations/${encodeURIComponent(item.conv)}/file/preview?path=${encodeURIComponent(item.path)}`;
export const resourceFileAction = (item, action) => item.botId
  ? { path: `/bots/${encodeURIComponent(item.botId)}/app/open`, body: { path: item.path, reveal: action === "reveal" } }
  : { path: `/conversations/${encodeURIComponent(item.conv)}/file/${action}`, body: { path: item.path } };

export const plainClick = (event) => !event.defaultPrevented && (event.button == null || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
export function openResource(resource) {
  return !!resource && !window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: resource, cancelable: true }));
}
export function previewWebsite(event) {
  if (!plainClick(event)) return;
  const link = event.currentTarget;
  if (openResource(websiteResource(link.href, link.textContent))) event.preventDefault();
}

export const emptyResources = () => ({ items: [], active: "" });
export function addResource(state = emptyResources(), item) {
  const items = state.items.filter((x) => x.id !== item.id);
  return { items: [...items, item].slice(-12), active: item.id };
}
export function removeResource(state, id) {
  const index = state.items.findIndex((x) => x.id === id);
  const items = state.items.filter((x) => x.id !== id);
  return { items, active: state.active === id ? (items[Math.min(index, items.length - 1)]?.id || "") : state.active };
}

/** Local Markdown links only; authorization still belongs to the file API. */
export function localFilePath(value) {
  let p = String(value || "").trim();
  if (!p || /[\u0000-\u001f\u007f]/.test(p) || p.startsWith("#") || p.startsWith("//")) return null;
  if (/^sandbox:\//i.test(p)) p = p.slice("sandbox:".length);
  else if (/^file:\/\//i.test(p)) {
    try { const u = new URL(p); if (u.hostname && u.hostname !== "localhost") return null; p = u.pathname.replace(/^\/([A-Za-z]:\/)/, "$1"); } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(p) && !/^[A-Za-z]:[\\/]/.test(p)) return null;
  try { p = decodeURIComponent(p); } catch { return null; }
  if (!p || /[\u0000-\u001f\u007f]/.test(p) || p.split(/[\\/]/).includes("..")) return null;
  return p;
}
