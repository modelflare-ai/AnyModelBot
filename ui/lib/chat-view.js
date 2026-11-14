import { useCallback, useEffect, useState } from "preact/hooks";

// Window-local drafts and positions. Search never sends text to a model or persists
// an extra copy of chat contents in browser storage.
const views = new Map();
export const chatView = (id) => views.get(id) || { text: "", top: 0, atBottom: true };
export function saveChatView(id, patch) { views.set(id, { ...chatView(id), ...patch }); }
/** 没发出的草稿（只在系统要求重新打开应用时交给后端暂存一次，重新打开后放回去、随即删掉） */
export const allDrafts = () => Object.fromEntries([...views].filter(([, v]) => v.text && v.text.trim()).map(([k, v]) => [k, v.text]));
export function restoreDrafts(map) {
  let any = false;
  for (const [k, v] of Object.entries(map || {})) if (typeof v === "string" && v && !chatView(k).text) (saveChatView(k, { text: v }), (any = true));
  // 已经打开的对话页在初始化时读过草稿：通知它们重新取一次（只填空着的输入框，不覆盖已经打的字）
  if (any) window.dispatchEvent(new Event("amb-drafts-restored"));
}
export function useChatDraft(id) {
  const [text, set] = useState(() => chatView(id).text);
  useEffect(() => {
    const on = () => set((old) => old || chatView(id).text);
    window.addEventListener("amb-drafts-restored", on);
    return () => window.removeEventListener("amb-drafts-restored", on);
  }, [id]);
  const update = useCallback((value) => set((old) => {
    const next = typeof value === "function" ? value(old) : value;
    saveChatView(id, { text: next });
    return next;
  }), [id]);
  return [text, update];
}
