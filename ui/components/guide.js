import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Menu, MenuButton, Notice } from "./ui.js";
import { useStore } from "../lib/store.js";
import { ms, reducedMotion } from "../design/motion.js";
import { templateOf } from "../lib/templates.js";
import { t } from "../lib/i18n.js";
import {
  GUIDE_CHANNELS, STEPS, DEFAULT_NAMES, guide, completed, completionCard, composerBusy, guideBlocked, guideOverlay,
  channelLabel, currentStep, nextStep, progress, stepFinished, stepText, isActive, guideChannel,
  setGuideChannel, skipChannel, setFocus, markSeen, hideGuide, refreshGuide, fillComposer,
  runMediaDemo, startTemplate, signInForDrawing, enteredWelcome,
} from "../lib/guide.js";
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const px = (name, fallback) => parseFloat(token(name)) || fallback;
const discover = () => { setFocus(null); location.hash = "/discover"; };
const connect = (channel) => { setFocus(null); location.hash = `/settings/connections/add-channel-${channel}`; };
function Progress({ g }) {
  return html`<span class="guide-bar" aria-hidden="true" style=${{ "--n": "5" }}>${STEPS.map((s) => html`<i class=${stepFinished(s.id, g) ? "on" : ""}></i>`)}</span>`;
}
function Templates() {
  return html`<div class="guide-templates">${["writer", "polish", "minutes"].map((key) => html`<button type="button" class="guide-template" onClick=${() => startTemplate(key)}>
    <b>${templateOf(key).name}</b><span>${templateOf(key).desc}</span></button>`)}</div>
    <button type="button" class="text" onClick=${discover}>${t("welcome.orDiscover")}</button>`;
}
function StepAction({ step, g, bot }) {
  if (step.id === "second") return html`<${Templates} />`;
  if (step.id === "weixin") return html`<div class="guide-channel">
    <${MenuButton} label=${stepText(step, "title")} value=${guideChannel(g)} onChange=${setGuideChannel}
      options=${(guideChannel(g) === "weixin" || guideChannel(g) === "feishu" ? GUIDE_CHANNELS : ["telegram", "slack", "discord", "weixin", "feishu"]).map((c) => [c, channelLabel(c)])} />
    <button type="button" class="btn primary sm" onClick=${() => connect(guideChannel(g))}>${t("firstUse.connectChannel", { channel: channelLabel(guideChannel(g)) })}</button>
    ${!stepFinished("weixin", g) && html`<button type="button" class="text" onClick=${skipChannel}>${t("welcome.skip")}</button>`}</div>`;
  const sample = stepText(step, "try");
  return html`<div class="guide-try"><span class="t-label">${t("guide.tryThis")}</span><span class="txt">${sample}</span>
    <button type="button" class="btn primary sm" onClick=${() => { fillComposer(sample, bot?.id); setFocus(step.id); }}>${t("guide.takeMe")}</button></div>`;
}
export function Welcome({ bot }) {
  useEffect(enteredWelcome, []);
  return html`<h2 title=${bot.name}>${t(DEFAULT_NAMES.includes(bot.name.trim()) ? "welcome.title" : "welcome.namedTitle", { name: bot.name })}</h2>
    <p>${t("welcome.subtitle")}</p><div class="welcome-examples">${["hello", "memory", "rewrite"].map((key) => html`<button type="button" class="example-card" onClick=${() => fillComposer(t(`welcome.samples.${key}`), bot.id)}>${t(`welcome.samples.${key}`)}</button>`)}</div>
    <${GuideChecklist} bot=${bot} /><button type="button" class="text welcome-discover" onClick=${discover}>${t("welcome.discover")}</button>`;
}
export function GuideChecklist({ bot }) {
  const g = useStore(guide);
  const [open, setOpen] = useState("");
  if (!isActive(g) || g.seen.includes("intro")) return null;
  const shown = open && !g.done.includes(open) ? open : currentStep(g)?.id;
  return html`<section class="guide-card" aria-label=${t("guide.title")}>
    <div class="guide-card-head"><span class="t-label">${t("guide.title")}</span><span class="guide-count num">${progress(g)}/5</span><span class="grow"></span>
      <button type="button" class="text" onClick=${() => markSeen("intro")}>${t("welcome.collapse")}</button></div>
    <${Progress} g=${g} /><ol class="guide-steps">${STEPS.map((s, i) => {
      const done = g.done.includes(s.id); const skipped = g.skipped.includes(s.id);
      return html`<li class=${`guide-step${done ? " done" : shown === s.id ? " open" : ""}`}>
        <span class="n">${done ? html`<${Icon} name="check" size="xs" />` : i + 1}</span><div class="body">
          <button type="button" class="guide-step-title" disabled=${done} onClick=${() => setOpen(s.id)}>${stepText(s, "title", g.primaryBotName || bot.name)}</button>
          ${skipped && html`<span class="badge">${t("welcome.skipped")}</span>`}
          ${!done && shown === s.id && html`<p class="desc">${stepText(s, "desc")}</p><${StepAction} step=${s} g=${g} bot=${bot} />`}</div></li>`;
    })}</ol></section>`;
}
export function GuidePill({ onGo }) {
  const g = useStore(guide); const ref = useRef(null); const [open, setOpen] = useState(false);
  if (!isActive(g)) return null;
  return html`<button type="button" ref=${ref} class="guide-pill" aria-haspopup="menu" aria-expanded=${open} onClick=${() => { refreshGuide(); setOpen(!open); }}>
    <${Progress} g=${g} /><span class="v">${t("guide.title")}</span><span class="num">${progress(g)}/5</span></button>
    ${open && html`<${Menu} anchor=${ref.current} prefer="up" width=${280} onClose=${() => setOpen(false)} items=${[
      ...STEPS.map((s) => ({ label: stepText(s, "title"), cur: g.done.includes(s.id), note: g.skipped.includes(s.id) ? t("welcome.skipped") : undefined, onSelect: () => onGo(s.id) })),
      { sep: true }, { label: t("guide.hide"), onSelect: hideGuide },
    ]} />`}`;
}
const CONFETTI = ["--bot-blue-eye", "--bot-yellow-glow", "--bot-green-glow", "--bot-red-eye", "--bot-purple-eye", "--bot-orange-eye"];
function confetti() {
  if (reducedMotion()) return;
  const layer = document.createElement("div");
  layer.className = "guide-confetti";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const x0 = innerWidth / 2;
  const y0 = innerHeight * 0.42;
  const dur = ms("--bot-love", 1600);
  for (let i = 0; i < 64; i++) {
    const p = document.createElement("i");
    p.style.background = `var(${CONFETTI[i % CONFETTI.length]})`;
    p.style.left = `${x0}px`;
    p.style.top = `${y0}px`;
    if (i % 3 === 0) p.classList.add("dot");
    layer.append(p);
    const a = (Math.random() * 2 - 1) * Math.PI * 0.6 - Math.PI / 2;
    const v = 180 + Math.random() * 280;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v;
    p.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.2}px, ${dy + 340 + Math.random() * 200}px) rotate(${Math.random() * 900}deg) scale(.6)`, opacity: 0 },
      ],
      { duration: dur + Math.random() * dur * 0.6, easing: token("--ease-out") || "ease-out", fill: "forwards" },
    );
  }
  setTimeout(() => layer.remove(), dur * 1.8);
}

/** 一个出口处理主动引导和一次性提示；任务必需弹层总是优先。 */
export function CoachMark({ bot, view, busy, blocked }) {
  const g = useStore(guide); const typing = useStore(composerBusy); const taskBlocked = useStore(guideBlocked);
  const last = useStore(completed); const born = useRef(Date.now());
  const [overlay, setOverlay] = useState(false); const [pos, setPos] = useState(null); const card = useRef(null);
  const chat = ["chat", "app"].includes(view) && !!bot;
  const hint = g.hints.find((id) => id === "official-hint" ? ["preview", "app"].includes(view) : chat);
  const id = g.focus && chat ? g.focus : hint;
  const step = STEPS.find((s) => s.id === id); const done = step && g.done.includes(id);
  const automatic = !step;
  const active = isActive(g) && !!id && !overlay && !blocked && !taskBlocked && !busy && !(automatic && typing);
  useEffect(() => {
    const read = () => { const value = !!document.querySelector(".scrim, .pop, .palette"); setOverlay(value); guideOverlay.set(value); };
    const observer = new MutationObserver(read); observer.observe(document.body, { childList: true, subtree: true }); read();
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (last?.all && last.at > born.current) confetti(); }, [last?.at]);
  useEffect(() => {
    if (!active || !["weixin", "memory"].includes(id)) return;
    const timer = setInterval(refreshGuide, 3000); return () => clearInterval(timer);
  }, [active, id]);
  useLayoutEffect(() => {
    if (!active) { setPos(null); return; }
    let spot;
    const place = () => {
      const target = document.querySelector(id === "model-hint" ? '[data-guide="model"]' : step?.id === "weixin" ? '[data-guide="info"]' : '[data-guide="composer"]');
      if (spot !== target) spot?.classList.remove("guide-spot");
      spot = target; if (id !== "official-hint") spot?.classList.toggle("guide-spot", !done);
      const r = target?.getBoundingClientRect();
      const w = card.current?.offsetWidth || 320; const h = card.current?.offsetHeight || 250;
      setPos({ left: Math.max(16, Math.min(innerWidth - w - 16, r ? r.right - w : innerWidth / 2 - w / 2)),
        top: Math.max(16, Math.min(innerHeight - h - 16, id === "official-hint" ? 72 : r ? r.top - h - 12 : 72)) });
    };
    place(); const timer = setInterval(place, 180); addEventListener("resize", place);
    return () => { clearInterval(timer); removeEventListener("resize", place); spot?.classList.remove("guide-spot"); };
  }, [active, id, done]);
  if (!active || id === "official-hint") return null;
  const close = () => step ? setFocus(null) : markSeen(id);
  const next = step && nextStep(id, g);
  const secondSend = id === "second" && g.secondBotId === bot?.id && !done;
  const text = step ? secondSend ? t("welcome.secondSend", { name: bot.name }) : done ? id === "second" ? t("welcome.secondDone", { main: g.primaryBotName || t("guide.defaultBotName") }) : t("guide.doneTitle") : stepText(step, "desc")
    : t(id === "model-hint" ? "welcome.modelHint" : id === "second-done" ? "welcome.secondDone" : "welcome.officialHint", { main: g.primaryBotName || t("guide.defaultBotName") });
  return html`<div class="guide-coach up" ref=${card} role="dialog" aria-label=${t("guide.coachLabel")} style=${pos ? { left: `${pos.left}px`, top: `${pos.top}px`, "--ax": "calc(100% - 32px)" } : { visibility: "hidden" }}
    onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
    <span class="guide-coach-arrow" aria-hidden="true"></span><div class="guide-coach-top"><span class="t-label">${step ? stepText(step, "title") : t("guide.title")}</span><span class="grow"></span><${IconButton} icon="close" label=${t("common.close")} onClick=${close} /></div>
    <div class="guide-coach-body"><p>${text}</p>${step && !done && !secondSend && html`<${StepAction} step=${step} g=${g} bot=${bot} />`}</div>
    <div class="guide-coach-actions"><button type="button" class="btn ghost sm" onClick=${close}>${t(automatic ? "welcome.gotIt" : "guide.later")}</button>
      ${done && next && html`<button type="button" class="btn primary sm" onClick=${() => setFocus(next.id)}>${t("guide.next", { title: stepText(next, "title") })}</button>`}</div></div>`;
}
export function OfficialGuideNotice({ installed = false, busy = false }) {
  const g = useStore(guide); const typing = useStore(composerBusy); const blocked = useStore(guideBlocked); const overlay = useStore(guideOverlay);
  const first = g.hints.find((id) => id === "official-hint" || installed);
  if (!isActive(g) || first !== "official-hint" || (installed && g.focus) || busy || typing || blocked || overlay) return null;
  return html`<div class="official-guide-notice"><${Notice} action=${html`<${IconButton} icon="close" label=${t("common.close")} onClick=${() => markSeen("official-hint")} />`}>${t("welcome.officialHint")}<//></div>`;
}
export function GuideCompletion({ bot, account }) {
  const state = useStore(completionCard); const g = useStore(guide); const claimed = useRef(false);
  useEffect(() => {
    if (state?.pending && !state.botId) { claimed.current = true; completionCard.set({ ...state, pending: false, botId: bot.id }); }
  }, [state?.pending]);
  useEffect(() => () => { if (claimed.current) completionCard.set(null); }, []);
  if (!state || (!state.pending && state.botId !== bot.id)) return null;
  const channel = g.connectedChannels.includes(guideChannel(g)) ? guideChannel(g) : g.connectedChannels[0];
  const draw = () => account?.state === "signed_in" ? fillComposer(t("welcome.drawSample"), bot.id) : signInForDrawing();
  const rows = [
    ["apps", t("welcome.nextApps"), () => { location.hash = "/apps"; }],
    ["reminder", channel ? t("welcome.nextReminderChannel", { channel: channelLabel(channel) }) : t("welcome.nextReminder"), () => fillComposer(t(channel ? "welcome.reminderChannel" : "welcome.reminderSample", { channel: channelLabel(channel) }), bot.id)],
    ["draw", t(account?.state === "signed_in" ? "welcome.nextDraw" : "welcome.connectDraw"), draw],
    ...(g.botCount >= 2 ? [["group", t("welcome.nextGroup"), () => window.dispatchEvent(new Event("amb-new-group"))]] : []),
    ["discover", t("welcome.nextDiscover"), discover],
  ];
  return html`<section class="guide-card guide-completion"><div class="guide-card-head"><h3>${t("welcome.complete")}</h3><span class="grow"></span>
    <${IconButton} icon="close" label=${t("common.close")} onClick=${() => completionCard.set(null)} /></div><p>${t("welcome.next")}</p>
    <div class="list">${rows.map(([key, label, action]) => html`<div class="row guide-next-row"><button type="button" class="guide-next-main" onClick=${action}>${label}</button>
      ${key === "draw" && html`<button type="button" class="text" onClick=${runMediaDemo}>${t("welcome.seeExample")}</button>`}<${Icon} name="chevRight" size="sm" /></div>`)}</div></section>`;
}
export function MediaDemo({ onLoad, account }) {
  const [big, setBig] = useState(false); const signedIn = account?.state === "signed_in";
  return html`<div class="guide-demo"><span class="badge">${t("welcome.sampleBadge")}</span>
    <div class="msg-files"><button type="button" class=${`msg-img${big ? " big" : ""}`} aria-expanded=${big} onClick=${() => setBig(!big)}>
      <img src="/amb/static/assets/guide-demo.svg" alt=${t("welcome.sampleAlt")} onLoad=${onLoad} /></button></div>
    <p class="guide-demo-note t-meta">${signedIn
      ? html`${t("welcome.wantOwn")} <button type="button" class="text" onClick=${() => fillComposer(t("welcome.drawSample"))}>${t("welcome.describeDraw")}</button>`
      : html`${t("welcome.drawConnectBefore")}<button type="button" class="text guide-inline-link" onClick=${signInForDrawing}>${t("welcome.drawConnectLink")}</button>${t("welcome.drawConnectAfter")}`}</p></div>`;
}
