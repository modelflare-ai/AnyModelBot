import { createStore, confirmSheet } from "./store.js";
import { t } from "./i18n.js";
export const blankBotDraft = createStore(null);
export const templateFlow = createStore({ entry: "", category: "all", scroll: 0, discoverScroll: 0, preview: null });
export async function openTemplates(entry = "") {
  if (templateFlow.get().preview) { await Promise.resolve(); if (!await mayLeaveTemplate("#/templates")) return; }
  templateFlow.set((s) => ({ ...s, entry }));
  location.hash = "/templates";
}
let pending = null;
export const clearTemplatePreview = () => templateFlow.set((s) => ({ ...s, preview: null }));
/** Return, sidebar links, keyboard shortcuts and browser back share the same guard. */
export async function mayLeaveTemplate(destination) {
  const draft = templateFlow.get().preview;
  if (!draft || destination.replace(/^#/, "") === `/templates/${draft.id}`) return true;
  if (draft.busy) return false;
  const dirty = draft.name !== draft.initialName || draft.persona !== draft.initialPersona;
  if (dirty) {
    // False is the safe action of confirmSheet (Escape/backdrop/cancel). Discard is explicit.
    pending ??= confirmSheet({ title: t("templates.discardTitle"), body: t("templates.discardBody"), confirmLabel: t("templates.discard"), cancelLabel: t("templates.keepEditing"), danger: false, confirmVariant: "ghost", cancelVariant: "primary" }).finally(() => { pending = null; });
    if (!await pending) return false;
  }
  clearTemplatePreview(); return true;
}
