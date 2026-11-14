import { createStore } from "./store.js";
import { api } from "./api.js";

export const scheduled = createStore({ rules: [], timeZone: "", loaded: false });
export const ruleFocus = createStore(null);
export const RULES_CHANGED = "amb-rules-changed";
export const rulesChanged = () => window.dispatchEvent(new Event(RULES_CHANGED));
export async function loadRules() {
  const before = scheduled.get();
  const data = await api("/rules");
  scheduled.set({ ...data, loaded: true });
  if (before.loaded) {
    const changed = data.rules.filter((r) => JSON.stringify(r.last) !== JSON.stringify(before.rules.find((x) => x.id === r.id)?.last)).map((r) => r.botId);
    if (changed.length) window.dispatchEvent(new CustomEvent("amb-rule-results", { detail: changed }));
  }
  return data;
}
export function openRule(rule) {
  ruleFocus.set({ id: rule.id, botId: rule.botId, at: Date.now() });
  window.dispatchEvent(new CustomEvent("amb-open-rule", { detail: rule }));
}
export function openScheduled() {
  if (location.hash === "#/scheduled") document.querySelector('[data-screen="scheduled"]')?.scrollTo({ top: 0, behavior: "smooth" });
  else location.hash = "/scheduled";
}
