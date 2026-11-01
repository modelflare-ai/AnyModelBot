// 新手引导的界面：对话空状态里的「上手清单」卡、侧栏左下角的清单入口、指着要点的地方的引导卡片、全部完成时的彩带。
// 状态与文案在 lib/guide.js；样式在 css/guide.css。
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Menu } from "./ui.js";
import { ActivityLine } from "./activity.js";
import { BotAvatar } from "./avatar.js";
import { useStore } from "../lib/store.js";
import { ms, reducedMotion } from "../design/motion.js";
import {
  STEPS, arm, completed, currentStep, fillComposer, guide, hideGuide, isActive, markDone, markSeen, nextStep, refreshGuide, runMediaDemo, setFocus, stepHow, stepText, visibleSteps,
} from "../lib/guide.js";
import { t } from "../lib/i18n.js";
import { MF_CONSOLE } from "../lib/links.js";

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const px = (name, fallback) => {
  const n = parseFloat(token(name));
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 进度格：做完的格子点亮时弹一下（key 带着状态，点亮的那一格重新挂载、重播动画） */
function Progress({ steps, done }) {
  return html`<span class="guide-bar" aria-hidden="true" style=${{ "--n": String(steps.length) }}>
    ${steps.map((s, i) => {
      const on = done.includes(s.id);
      return html`<i key=${`${s.id}-${on}`} class=${on ? "on" : ""} style=${{ "--i": String(i) }}></i>`;
    })}
  </span>`;
}

/** 对话空状态里的清单：当前这一步展开（说明、怎么做、试试这句），其余一行一项；可以收起到左下角 */
export function GuideChecklist({ bot, onSend }) {
  const g = useStore(guide);
  const [open, setOpen] = useState("");
  if (!isActive(g) || g.seen.includes("intro")) return null;
  const steps = visibleSteps(g);
  const cur = currentStep(g);
  if (!cur) return null;
  const shown = open && !g.done.includes(open) ? open : cur.id;
  const n = steps.filter((s) => g.done.includes(s.id)).length;
  const txt = (s, field) => stepText(s, field, bot.name);
  return html`<section class="guide-card" aria-label=${t("guide.title")}>
    <div class="guide-card-head">
      <span class="t-label">${t("guide.title")}</span><span class="guide-count num">${n} / ${steps.length}</span>
      <span class="grow"></span>
      <button type="button" class="text" onClick=${() => markSeen("intro")}>${t("guide.collapse")}</button>
    </div>
    <${Progress} steps=${steps} done=${g.done} />
    <ol class="guide-steps">
      ${steps.map((s, i) => {
        const done = g.done.includes(s.id);
        const style = { "--anim-delay": `calc(var(--stagger) * ${i} / 3)` };
        if (done) {
          return html`<li key=${s.id} class="guide-step done anim-rise-in" style=${style}>
            <span class="n"><${Icon} name="check" size="xs" strong /></span><span class="title">${txt(s, "title")}</span>
          </li>`;
        }
        if (s.id !== shown) {
          return html`<li key=${s.id} class="anim-rise-in" style=${style}>
            <button type="button" class="guide-step" onClick=${() => setOpen(s.id)}>
              <span class="n num">${i + 1}</span><span class="title">${txt(s, "title")}</span><${Icon} name="chevRight" size="sm" />
            </button>
          </li>`;
        }
        const sample = txt(s, "try");
        return html`<li key=${s.id} class="guide-step open anim-rise-in" style=${style}>
          <span class="n num">${i + 1}</span>
          <div class="body">
            <div class="title">${txt(s, "title")}</div>
            <p class="desc">${txt(s, "desc")}</p>
            <ul class="how">${stepHow(s).map((h) => html`<li>${h}</li>`)}</ul>
            ${s.id === "media" && html`<p class="t-meta">${txt(s, "demoNote")}</p>`}
            ${s.id === "media"
              ? html`<div class="guide-try">
                  <span class="t-label">${t("guide.demoThis")}</span>
                  <span class="txt">${sample}</span>
                  <button type="button" class="btn primary sm" onClick=${() => (arm(s.id), runMediaDemo())}>${t("guide.watchDemo")}</button>
                </div>`
              : sample
              ? html`<div class="guide-try">
                  <span class="t-label">${t("guide.tryThis")}</span>
                  <span class="txt">${sample}</span>
                  <button type="button" class="btn primary sm" onClick=${() => (arm(s.id), onSend(sample))}>${t("guide.sendThis")}</button>
                </div>`
              : html`<div class="guide-try">
                  <span class="txt tone-muted">${t("guide.followHint")}</span>
                  <button type="button" class="btn primary sm" onClick=${() => setFocus(s.id)}>${t("guide.takeMe")}</button>
                </div>`}
          </div>
        </li>`;
      })}
    </ol>
  </section>`;
}

/** 侧栏左下角的清单入口：进度格 + n/6；点开是清单菜单，点一项就带你去做；全部完成后这次还留着，下次启动就不再出现 */
export function GuidePill({ onGo }) {
  const g = useStore(guide);
  const last = useStore(completed);
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  if (!isActive(g)) return null;
  const steps = visibleSteps(g);
  const n = steps.filter((s) => g.done.includes(s.id)).length;
  const finished = n === steps.length;
  if (finished && !(last && last.all)) return null;
  const cur = currentStep(g);
  return html`<button type="button" ref=${ref} class=${`guide-pill${last && !finished ? " bumped" : ""}`} key=${last ? last.at : 0}
      aria-haspopup="menu" aria-expanded=${open} title=${t("guide.title")} onClick=${() => setOpen((v) => !v)}>
      <${Progress} steps=${steps} done=${g.done} />
      <span class="v">${finished ? t("guide.allDone") : t("guide.title")}</span>
      <span class="num">${n}/${steps.length}</span>
    </button>
    ${open && html`<${Menu} anchor=${ref.current} prefer="up" width=${280} label=${t("guide.title")} onClose=${() => setOpen(false)}
      items=${[
        { group: t("guide.progress", { progress: `${n}/${steps.length}` }) },
        ...steps.map((s) => ({
          label: stepText(s, "title", t("guide.nameGeneric")),
          note: g.done.includes(s.id) ? t("guide.completed") : cur && s.id === cur.id ? t("guide.upNext") : undefined,
          cur: g.done.includes(s.id),
          onSelect: () => onGo(s.id),
        })),
        { sep: true },
        { label: t("guide.hide"), onSelect: hideGuide },
      ]} />`}`;
}

/** 全部完成：撒一把彩带（颜色是六个机器人的眼睛色和品牌黄绿） */
const CONFETTI = ["--accent-solid", "--bot-blue-eye", "--bot-yellow-glow", "--bot-green-glow", "--bot-red-eye", "--bot-purple-eye", "--bot-orange-eye"];
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

/**
 * 引导卡片：指着当前步骤要点的地方（data-guide="…"），那里亮起一圈；卡片放在它旁边，跟着它移动。
 * 指着的东西被菜单盖住（模型菜单打开）时先藏起来；做完后同一张卡片换成「做好了 → 下一步」。
 */
export function CoachMark({ bot, view, infoOpen }) {
  const g = useStore(guide);
  const last = useStore(completed);
  const card = useRef(null);
  const [pos, setPos] = useState(null);
  // 第一次放好位置之后才开始"滑过去"，否则会从左上角飘过来
  const [glide, setGlide] = useState(false);
  useEffect(() => {
    if (!pos) return setGlide(false);
    const r = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(r);
  }, [!!pos]);
  const id = g.focus;
  const step = id ? STEPS.find((s) => s.id === id) : null;
  const done = !!step && g.done.includes(id);
  const active = isActive(g) && !!step && view === "chat" && !!bot;
  const sel = !step ? "" : step.target === "weixin" ? (infoOpen ? '[data-guide="weixin"]' : '[data-guide="info"]') : `[data-guide="${step.target}"]`;

  // 全部完成：撒彩带（只认挂载之后完成的，重新挂载时不重放）
  const born = useRef(Date.now());
  useEffect(() => {
    if (last && last.all && last.at > born.current) confetti();
  }, [last && last.at]);

  // 渠道这一步：扫码发生在微信里，隔几秒问一次后端有没有连上
  useEffect(() => {
    if (!active || done || id !== "weixin") return;
    const timer = setInterval(refreshGuide, ms("--dur-pulse", 1400) * 2);
    return () => clearInterval(timer);
  }, [active, done, id]);

  useLayoutEffect(() => {
    if (!active) return setPos(null);
    let el = null;
    const place = () => {
      const a = document.querySelector(sel);
      if (a !== el) {
        el?.classList.remove("guide-spot");
        el = a;
      }
      // 模型菜单打开时它盖住了按钮：先藏起来，选完再出来
      if (!a || !a.getClientRects().length || (step.target === "model" && a.getAttribute("aria-expanded") === "true")) return setPos(null);
      a.classList.toggle("guide-spot", !done);
      const r = a.getBoundingClientRect();
      const w = card.current ? card.current.offsetWidth : 300;
      const h = card.current ? card.current.offsetHeight : 240;
      const gap = px("--space-3", 12);
      const edge = px("--pane-gap", 8);
      const vw = innerWidth;
      const vh = innerHeight;
      const side = r.left > vw * 0.6 && r.left - w - gap > edge ? "left" : r.top - h - gap > edge ? "up" : "down";
      let left;
      let top;
      if (side === "left") {
        left = r.left - w - gap;
        top = clamp(r.top + r.height / 2 - h / 2, edge, vh - h - edge);
      } else {
        // 很宽的目标（输入框）：卡片靠右，箭头指向发送钮那一侧
        left = clamp(r.width > w * 1.5 ? r.right - w : r.left + r.width / 2 - w / 2, edge, vw - w - edge);
        top = side === "up" ? r.top - h - gap : r.bottom + gap;
      }
      const ax = clamp((r.width > w * 1.5 ? r.right - 48 : r.left + r.width / 2) - left, 20, w - 20);
      const ay = clamp(r.top + r.height / 2 - top, 20, h - 20);
      const open = a.getAttribute("aria-expanded") === "true";
      setPos((p) => (p && p.left === left && p.top === top && p.side === side && p.ax === ax && p.ay === ay && p.open === open ? p : { left, top, side, ax, ay, open }));
    };
    place();
    const timer = setInterval(place, ms("--dur-moderate", 240));
    addEventListener("resize", place);
    return () => {
      clearInterval(timer);
      removeEventListener("resize", place);
      el?.classList.remove("guide-spot");
    };
  }, [active, sel, done]);

  if (!active) return null;
  const list = visibleSteps(g);
  const idx = list.findIndex((s) => s.id === id) + 1;
  const next = done ? nextStep(id, g) : null;
  const txt = (s, field) => stepText(s, field, bot.name);
  const sample = txt(step, "try");
  // 渠道那一步：① 打开信息面板 → ② 点「微信」→ ③ 扫码（微信那一行展开了）
  const sub = id === "weixin" ? (!infoOpen ? 1 : pos && pos.open ? 3 : 2) : 0;
  // 生图那一步：引导里只放预置演示，不替用户调用真的模型花钱
  const demoOnly = id === "media";
  const style = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px`, "--ax": `${pos.ax}px`, "--ay": `${pos.ay}px` }
    : { left: "0px", top: "0px", visibility: "hidden" };
  return html`<div key=${id} ref=${card} class=${`guide-coach ${pos ? pos.side : "up"}${glide ? " glide" : ""}`} style=${style} role="dialog" aria-label=${t("guide.coachLabel")}
      onKeyDown=${(e) => e.key === "Escape" && (e.stopPropagation(), setFocus(null))}>
    <span class="guide-coach-arrow" aria-hidden="true"></span>
    <div class="guide-coach-top">
      <${BotAvatar} bot=${bot} size=${30} greet cue=${done ? { kind: "done", at: last ? last.at : 1 } : undefined} />
      <span class="t-label">${t("guide.progress", { progress: html`<span class="num">${idx}/${list.length}</span>` })}</span>
      ${done && html`<span class="guide-done"><${Icon} name="check" size="xs" strong />${t("common.done")}</span>`}
      <span class="grow"></span>
      <${IconButton} icon="close" size="xs" iconSize="xs" label=${t("guide.closeCoach")} onClick=${() => setFocus(null)} />
    </div>
    <div class="guide-coach-body anim-fade-in" key=${String(done)}>
      <h3>${done ? t("guide.doneTitle") : txt(step, "title")}</h3>
      <p class="desc">${done ? txt(step, demoOnly && !g.media ? "noModelText" : "doneText") : txt(step, "desc")}</p>
      ${!done && html`<ol class=${`how${sub ? " steps" : ""}`}>${stepHow(step).map((h, i) => html`<li class=${sub && i + 1 === sub ? "cur" : sub && i + 1 < sub ? "past" : ""}>${h}</li>`)}</ol>`}
      ${!done && txt(step, "note") && html`<p class="t-meta">${txt(step, "note")}</p>`}
      ${!done && demoOnly && html`<p class="t-meta">${txt(step, "demoNote")}</p>`}
      ${!done && sample && html`<div class="guide-try">
        <span class="txt">${sample}</span>
        ${demoOnly
          ? html`<button type="button" class="btn primary sm" onClick=${runMediaDemo}>${t("guide.watchDemo")}</button>`
          : html`<button type="button" class="btn sm" onClick=${() => fillComposer(sample)}>${t("guide.fill")}</button>`}
      </div>`}
      ${done && demoOnly && !g.media && html`<a class="t-meta" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">${t("guide.openConsole")}</a>`}
    </div>
    <div class="guide-coach-actions">
      <button type="button" class="text" onClick=${() => setFocus(null)}>${done ? t("guide.stopHere") : t("guide.later")}</button>
      ${done && (next
        ? html`<button type="button" class="btn primary sm" onClick=${() => setFocus(next.id)}>${t("guide.next", { title: txt(next, "title") })}</button>`
        : html`<button type="button" class="btn primary sm" onClick=${() => setFocus(null)}>${t("common.done")}</button>`)}
    </div>
  </div>`;
}

/**
 * 生图的预置演示：和真的默认流程一样，说一句就直接生成：工作状态行（正在生成）→ 图片交付在对话里（同一种缩略图）。
 * 不发给机器人、不调用模型、不扣费，图是客户端自带的示例（assets/guide-demo.svg），下面一行说明这一点。看完就算做完了这一步。
 * 自带的图不在会话的文件里，桌面版没法交给系统程序打开：点开是在原地放大。
 */
export function MediaDemo({ onLoad }) {
  const g = useStore(guide);
  const [done, setDone] = useState(false);
  const [big, setBig] = useState(false);
  // 生成用时是模拟的，不是动画：文字微光扫一遍的时长（关闭动画时也不变）
  useEffect(() => {
    const timer = setTimeout(() => {
      setDone(true);
      markDone("media");
    }, ms("--dur-sheen", 2400));
    return () => clearTimeout(timer);
  }, []);
  // 放大 / 缩小后，本来跟着底部的对话再贴一次底
  useEffect(() => {
    if (done) onLoad?.();
  }, [big]);
  return html`<div class="guide-demo">
    <${ActivityLine} label=${done ? t("guide.demo.label") : t("guide.demo.generating")} phase=${done ? "done" : "gen"} live=${!done} />
    ${done && html`<div class="msg-files anim-rise-in">
        <button type="button" class=${`msg-img${big ? " big" : ""}`} aria-expanded=${big} title=${big ? t("guide.demo.zoomOut") : t("guide.demo.zoomIn")} onClick=${() => setBig((v) => !v)}>
          <img src="/amb/static/assets/guide-demo.svg" alt=${t("guide.demo.alt")} onLoad=${onLoad} />
        </button>
      </div>
      <p class="guide-demo-note t-meta">
        ${t("guide.demo.caption")}
        ${!g.media && html` <a href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">${t("guide.demo.enable")}</a>`}
      </p>`}
  </div>`;
}
