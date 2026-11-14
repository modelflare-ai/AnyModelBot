import catalog from "../data/bot-templates.json" with { type: "json" };
import { t, getLang, has } from "./i18n.js";
import { tiers, levelOf } from "./frontier.js";
import { normModel } from "./models.js";
export const TEMPLATE_META = catalog;
export const templateRequestId = () => globalThis.crypto?.randomUUID?.() || `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const TEMPLATE_ALIASES = { translate: "polish", coder: "coding-partner" };
export function templateOf(id) {
  const item = catalog.find((x) => x.id === (TEMPLATE_ALIASES[id] || id));
  if (!item) return null;
  const key = `templates.roles.${item.id}`;
  const memory = []; for (let i = 0; has(`${key}.memory.${i}`); i++) memory.push(t(`${key}.memory.${i}`));
  return { ...item, name: t(`${key}.name`), desc: t(`${key}.desc`), persona: t(`${key}.persona`), sample: t(`${key}.sample`),
    memoryTitle: item.memory ? t(`${key}.memoryTitle`) : "", memoryNotes: memory, memoryHint: t(`${key}.memoryHint`),
    appIds: getLang() !== "zh-CN" && item.globalApps ? item.globalApps : item.apps,
    channelText: item.channelHint ? t(`${key}.channelHint`) : "",
    ruleTitle: item.rule ? t(`${key}.rule.title`) : "", ruleInstruction: item.rule ? t(`${key}.rule.instruction`) : "" };
}
export function availableName(raw, bots) {
  const cut = (s, n) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");
  const base = cut(raw.trim(), 60); const names = new Set((bots || []).map((b) => b.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) { const tail = ` ${i}`; const next = cut(base, 60 - tail.length) + tail; if (!names.has(next)) return next; }
}
export const templateInfo = (info, id) => info?.[normModel(id)] || info?.[normModel(id).split("/").at(-1)] || {};
export function capabilityState(template, model, info) {
  const data = templateInfo(info, model);
  const required = ["tools", "reasoning"].filter((key) => template[key]);
  if (required.some((key) => data[key] === false)) return "incompatible";
  if (required.some((key) => data[key] !== true)) return "unknown";
  return "ok";
}
/** The existing frontier has up to five stops. Templates target its low/middle/high regions. */
export function recommendTemplate(template, models, info, strategy, defaultModel, newUser = false) {
  if (newUser && defaultModel) return { model: "", reason: "starter" };
  if (!models || !info) return { model: "", reason: "unavailable" };
  const { stops, points } = tiers(models, info, strategy, defaultModel);
  if (stops.length < 3) return { model: "", reason: "unranked" };
  const target = Math.floor(template.tier * (stops.length - 1) / 4);
  const nearest = (p) => stops.reduce((best, s, i) => Math.abs(s.intelligence - p.intelligence) < Math.abs(stops[best].intelligence - p.intelligence) ? i : best, 0);
  const candidates = points.filter((p) => nearest(p) === target && capabilityState(template, p.id, info) === "ok");
  if (!candidates.length) return { model: "", reason: "incompatible" };
  candidates.sort((a, b) => {
    const x = templateInfo(info, a.id), y = templateInfo(info, b.id);
    return (template.vision ? Number(y.vision === true) - Number(x.vision === true) : 0)
      || (template.longContext ? (y.context || 0) - (x.context || 0) : 0) || a.cost - b.cost || b.intelligence - a.intelligence || a.id.localeCompare(b.id);
  });
  return { model: candidates[0].id, reason: "recommended", level: levelOf(target, stops.length) };
}
