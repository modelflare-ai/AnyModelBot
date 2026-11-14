// 上手清单：完成事实由服务端保存；引导、预填和示例图仅属于当前界面。
import { blankBotDraft } from "./template-flow.js";
import { templateOf } from "./templates.js";
import { createStore, toast, failed } from "./store.js";
import { api } from "./api.js";
import { getLang, has, t } from "./i18n.js";
export const STEPS = ["hello", "memory", "second", "hands", "weixin"].map((id) => ({ id, target: id === "weixin" ? "info" : "composer" }));
export const GUIDE_CHANNELS = ["weixin", "feishu", "telegram", "slack", "discord"];
export const DEFAULT_NAMES = ["我的助手", "My Assistant", "マイアシスタント", "내 도우미", "Мой помощник", "Mi asistente", "Meu assistente"]; // i18n-ignore: persisted default names from every supported language
export const guide = createStore({ loaded: false, done: [], skipped: [], hidden: false, seen: [], focus: null, hints: [], owner: "", welcome: false, primaryBotId: "default", botCount: 0, connectedChannels: [] });
export const completed = createStore(null);
export const completionCard = createStore(null);
export const fill = createStore(null);
export const demo = createStore(null);
export const composerBusy = createStore(false);
export const guideBlocked = createStore(false);
export const guideOverlay = createStore(false);
export const templateDraft = createStore(null);
export const guideChannel = (g = guide.get()) => GUIDE_CHANNELS.includes(g.channel) ? g.channel : getLang() === "zh-CN" ? "weixin" : "telegram";
export const channelLabel = (id) => has(`access.channel.${id}`) ? t(`access.channel.${id}`) : id;
export const visibleSteps = () => STEPS;
export const stepFinished = (id, g = guide.get()) => g.done.includes(id) || (id === "weixin" && g.skipped.includes(id));
export const progress = (g = guide.get()) => STEPS.filter((s) => stepFinished(s.id, g)).length;
export const currentStep = (g = guide.get()) => STEPS.find((s) => !stepFinished(s.id, g));
export const nextStep = (id, g = guide.get()) => STEPS.slice(STEPS.findIndex((s) => s.id === id) + 1).find((s) => !stepFinished(s.id, g)) || STEPS.find((s) => s.id !== id && !stepFinished(s.id, g));
export const isActive = (g = guide.get()) => g.loaded && !g.hidden && !g.seen.includes("completed");
export const stepText = (s, field, name = guide.get().primaryBotName || t("guide.defaultBotName")) => has(`welcome.steps.${s.id}.${field}`) ? t(`welcome.steps.${s.id}.${field}`, { name }) : "";
export const stepHow = () => [];

function apply(d, quiet = false) {
  const old = guide.get();
  const same = old.owner === d.owner;
  const fresh = old.loaded && same ? d.done.filter((id) => !old.done.includes(id)) : [];
  const g = { ...old, ...d, loaded: true, welcome: old.loaded && same ? old.welcome : !!d.welcomeAvailable,
    ...(!same ? { focus: null, hints: [] } : {}) };
  const all = g.seen.includes("completed");
  if (all || g.hidden) { g.focus = null; g.hints = []; }
  else if (fresh.includes("second") && g.focus === "second") g.focus = null;
  guide.set(g);
  if (!quiet && !d.migration && same && !old.hidden) {
    if (fresh.length) {
      const id = fresh.at(-1);
      completed.set({ id, n: progress(g), total: 5, all, at: Date.now() });
      if (id === "second" && !all) requestHint("second-done");
      if (fresh.includes("hello") && !all) requestHint("model-hint");
    }
    if (all && !old.seen.includes("completed")) {
      completed.set({ id: fresh.at(-1) || "weixin", n: 5, total: 5, all: true, at: Date.now() });
      completionCard.set({ pending: true });
    }
  }
}
let writes = Promise.resolve();
function change(body) {
  const owner = guide.get().owner;
  const run = writes.then(() => api("/guide", { method: "PUT", body: { ...body, owner } })).then((d) => {
    if (guide.get().owner === owner) apply(d, !!body.reset);
    return d;
  });
  writes = run.catch(() => {});
  return run;
}
let loadEpoch = 0;
export async function loadGuide() {
  const epoch = ++loadEpoch;
  const d = await api("/guide").catch(() => null);
  if (d && epoch === loadEpoch) apply(d, true);
}
export function leaveGuideSession() {
  ++loadEpoch;
  guide.set((g) => ({ ...g, loaded: false, owner: "", welcome: false, focus: null, hints: [] }));
  completionCard.set(null);
}
export const refreshGuide = () => {
  const epoch = loadEpoch;
  return writes.then(() => api("/guide")).then((d) => { if (epoch === loadEpoch && guide.get().loaded) apply(d); }).catch(() => {});
};
let soonTimers = [];
export function refreshGuideSoon() {
  soonTimers.forEach(clearTimeout);
  soonTimers = [1500, 4000, 8000, 20_000, 60_000, 100_000].map((ms) => setTimeout(() => isActive() && refreshGuide(), ms));
}
export const markDone = (id) => {
  if (!STEPS.some((s) => s.id === id) || !guide.get().loaded || guide.get().done.includes(id)) return;
  void change({ done: id }).catch(() => {});
};
export const setGuideChannel = (channel) => { if (GUIDE_CHANNELS.includes(channel)) void change({ channel }).catch(() => {}); };
export const skipChannel = () => change({ skip: "weixin" }).catch(failed);
export const setFocus = (focus) => guide.set((g) => ({ ...g, focus, focusAuto: false }));
export const arm = (id) => setFocus(id);
export function markSeen(key) {
  guide.set((g) => ({ ...g, seen: [...new Set([...g.seen, key])], hints: g.hints.filter((x) => x !== key) }));
  void change({ seen: key }).catch(() => {});
}
export function requestHint(id) {
  guide.set((g) => !isActive(g) || g.seen.includes(id) || g.hints.includes(id) ? g : { ...g, hints: [...g.hints, id] });
}
export function enteredWelcome() { void change({ entered: true }).catch(() => {}); }
export function consumeWelcome() { guide.set((g) => ({ ...g, welcome: false })); enteredWelcome(); }
export async function resetGuide() { const d = await change({ reset: true }); apply(d, true); }
export async function showGuide() { await change({ hidden: false }); }
export function hideGuide() {
  guide.set((g) => ({ ...g, hidden: true, welcome: false, focus: null, hints: [] }));
  void change({ hidden: true }).catch(() => {});
  toast(t("welcome.hiddenToast"));
}
export const fillComposer = (text, target) => fill.set({ text, target, at: Date.now() });
export const sendToChat = (text, target) => fill.set({ text, target, at: Date.now(), send: true });
export const runMediaDemo = () => demo.set({ at: Date.now() });
export const isMediaFile = (name) => /\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm)$/i.test(name || "");
export function startTemplate(key) { blankBotDraft.set(null); templateDraft.set({ key }); setFocus(null); location.hash = `/new?guide=${Date.now()}`; }
export function templateCreated(bot, key, sample) {
  templateDraft.set(null);
  fillComposer(sample || templateOf(key).sample, bot.id);
  guide.set((g) => ({ ...g, secondBotId: bot.id, focus: "second", focusAuto: false }));
}
export const signInForDrawing = () => window.dispatchEvent(new Event("amb-sign-in"));
