// Eyes 标记与毛绒机器人的"看"（§7.7、§7.9）。一个全局 pointermove + rAF 合并；IntersectionObserver 管可见性；
// 先统一读 getBoundingClientRect，再统一写 --look-x/--look-y。无依赖。
import { eyeShapes } from "./eye-shapes";
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Mark { el: SVGSVGElement; visible: boolean; x: number; y: number; target: Element | null; glanceT?: number }
interface Face { el: HTMLElement; visible: boolean; x: number; y: number; target: Element | null }
const marks = new Map<SVGSVGElement, Mark>();
const faces = new Map<HTMLElement, Face>();
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let px = NaN, py = NaN, raf = 0, idleT = 0, bound = false;
let io: IntersectionObserver | null = null;

function setMode(m: Mark, mode: "idle" | "follow" | "static") { if (m.el.dataset.mode !== mode) m.el.dataset.mode = mode; }
function write(m: Mark | Face, x: number, y: number) {
  if (Math.abs(x - m.x) < 0.01 && Math.abs(y - m.y) < 0.01) return;
  m.x = x; m.y = y;
  m.el.style.setProperty("--look-x", x.toFixed(3));
  m.el.style.setProperty("--look-y", y.toFixed(3));
}

/** 单位圆内的目光向量：近处就明显转动，远处趋近 1；|向量| ≤ 1，所以眼睛永远不出面罩（§7.5） */
export function aim(r: { left: number; top: number; width: number; height: number }, tx: number, ty: number): [number, number] {
  const dx = tx - (r.left + r.width / 2), dy = ty - (r.top + r.height / 2), d = Math.hypot(dx, dy);
  if (d < 2) return [0, 0];
  const t = Math.min(d / clamp(r.width * 3.2, 200, 520), 1), e = 1 - (1 - t) * (1 - t);
  return [(dx / d) * e, (dy / d) * e];
}
/** 机器人：与 App 的 BotAvatar 同一套衰减——只在指针附近才看过去 */
export function aimFace(r: { left: number; top: number; width: number; height: number }, tx: number, ty: number): [number, number] {
  const dx = tx - (r.left + r.width / 2), dy = ty - (r.top + r.height / 2);
  const fall = Math.max(0, 1 - Math.hypot(dx, dy) / Math.max(140, r.width * 4));
  return [clamp((dx / (r.width * 0.7)) * fall, -1, 1), clamp((dy / (r.height * 0.7)) * fall, -1, 1)];
}

/** 机器人看向另一个元素（指针不在附近时）：方向单位化，水平满幅的 85%、竖直 60%，不会转到"翻白眼" */
export function toward(r: { left: number; top: number; width: number; height: number }, t: { left: number; top: number; width: number; height: number }): [number, number] {
  const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2), d = Math.hypot(dx, dy);
  if (d < 2) return [0, 0];
  return [(dx / d) * 0.85, (dy / d) * 0.6];
}

function frame() {
  raf = 0;
  const vm = [...marks.values()].filter((m) => m.visible && !m.glanceT);
  const vf = [...faces.values()].filter((f) => f.visible);
  const rm = vm.map((m) => m.el.getBoundingClientRect());
  const rf = vf.map((f) => f.el.getBoundingClientRect());
  const rt = vf.map((f) => f.target?.getBoundingClientRect() ?? null);
  vm.forEach((m, i) => { const [x, y] = Number.isNaN(px) ? [0, 0] : aim(rm[i], px, py); setMode(m, "follow"); write(m, x, y); });
  vf.forEach((f, i) => {
    let [x, y] = Number.isNaN(px) ? [0, 0] : aimFace(rf[i], px, py);
    if (rt[i] && Math.hypot(x, y) < 0.08) [x, y] = toward(rf[i], rt[i]!);
    write(f, x, y);
  });
}
function toIdle() {
  px = py = NaN;
  faces.forEach((f) => (f.target ? write(f, ...toward(f.el.getBoundingClientRect(), f.target.getBoundingClientRect())) : write(f, 0, 0)));
  marks.forEach((m) => { if (m.glanceT) return; write(m, 0, 0); setTimeout(() => { if (!m.glanceT && Number.isNaN(px)) setMode(m, "idle"); }, 220); });
}
function onMove(e: PointerEvent) {
  if (e.pointerType === "touch") return;
  px = e.clientX; py = e.clientY;
  if (!raf) raf = requestAnimationFrame(frame);
  clearTimeout(idleT); idleT = window.setTimeout(toIdle, 3000);
}
function onLeave(e: MouseEvent) { if (!e.relatedTarget) { clearTimeout(idleT); idleT = window.setTimeout(toIdle, 600); } }

/** 看向某个元素 ms 毫秒后回空闲（触屏一瞥、空闲时看 data-look-at 目标、悬停入口卡） */
export function glanceAt(el: SVGSVGElement, target: Element, ms = 1400) {
  const m = marks.get(el);
  if (!m || reduce.matches) return;
  const t = target.getBoundingClientRect(), r = m.el.getBoundingClientRect();
  const [x, y] = aim(r, t.left + t.width / 2, t.top + t.height / 2);
  setMode(m, "follow"); write(m, x, y);
  clearTimeout(m.glanceT);
  m.glanceT = window.setTimeout(() => {
    m.glanceT = undefined;
    if (!Number.isNaN(px)) return;
    write(m, 0, 0); setTimeout(() => Number.isNaN(px) && setMode(m, "idle"), 220);
  }, ms);
}
function scheduleGlance(m: Mark) {
  if (!m.target) return;
  setTimeout(() => {
    if (m.visible && m.el.dataset.mode === "idle" && m.target) glanceAt(m.el, m.target);
    scheduleGlance(m);
  }, rnd(6000, 10000));
}

/** 机器人没有被指针吸引时看向 target（null = 看前方）：一排机器人一起看被选中的那个、看下载按钮…… */
export function gazeAt(el: HTMLElement, target: Element | null) {
  const f = faces.get(el);
  if (!f) return;
  f.target = target;
  const r = el.getBoundingClientRect();
  if (!Number.isNaN(px) && Math.hypot(...aimFace(r, px, py)) >= 0.08) return;
  if (target) write(f, ...toward(r, target.getBoundingClientRect()));
  else write(f, 0, 0);
}

// —— 持续状态：和 App 的 BotAvatar 同一套 data-state；状态粒子（打呼的 z、等批准的 !、思考泡泡、天天的信号圈、星星）随状态加上 ——
const BUSY = new Set(["thinking", "replying", "working"]);
const sizeOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).getPropertyValue("--s")) || el.offsetWidth;
export function setState(el: HTMLElement, st: string) {
  if (el.dataset.state === st) return;
  el.dataset.state = st;
  const body = el.querySelector(".bf-body");
  body?.querySelectorAll(".fx-st").forEach((n) => n.remove());
  if (!el.dataset.shot) el.dataset.eyes = st === "sleep" ? "closed" : "open";
  if (!body || sizeOf(el) < 36) return;
  const add = (h: string) => body.insertAdjacentHTML("beforeend", h);
  if (st === "waiting") add(`<span class="fx fx-st fx-bang">!</span>`);
  if (st === "thinking") add(`<span class="fx fx-st fx-think"><i></i><i></i><i></i></span>`);
  if (reduce.matches) return;
  if (st === "sleep") add(`<span class="fx fx-st fx-zzz"><i>z</i><i>z</i><i>z</i></span>`);
  if (BUSY.has(st) && el.dataset.char === "blue") add(`<span class="fx fx-st fx-rings"><i></i><i></i><i></i></span>`);
  if (BUSY.has(st) && (el.dataset.char === "yellow" || el.dataset.char === "purple")) add(`<span class="fx fx-st fx-twinkle"><i></i><i></i><i></i></span>`);
}
const restEyes = (el: HTMLElement) => (el.dataset.state === "sleep" ? "closed" : "open");

// —— 机器人的一次性反应：戳一下开心，1.8 秒内连戳三下冒爱心、六下晕（同 App）；startle = 打瞌睡被吵醒 ——
const SHOT_EYES: Record<string, string> = { hello: "happy", poke: "happy", love: "heart", dizzy: "spiral", done: "happy", error: "error", startle: "open" };
const SHOT_MS: Record<string, number> = { hello: 1600, poke: 700, love: 1600, dizzy: 2200, done: 1300, error: 1500, startle: 900 };
const BURST = [0, 45, 90, 135, 180, 225, 270, 315];
export function playShot(el: HTMLElement, kind: keyof typeof SHOT_MS) {
  if (reduce.matches) {
    el.dataset.eyes = SHOT_EYES[kind];
    setTimeout(() => (el.dataset.eyes = restEyes(el)), SHOT_MS[kind]);
    return;
  }
  const shot = el.querySelector<HTMLElement>(".bf-shot");
  delete el.dataset.shot;
  shot?.querySelectorAll(".fx-dyn").forEach((n) => n.remove());
  void el.offsetWidth; // 让同一种反应可以重新播放
  el.dataset.shot = kind;
  el.dataset.eyes = SHOT_EYES[kind];
  const big = el.offsetWidth >= 36;
  if (shot && big) {
    const add = (html: string) => shot.insertAdjacentHTML("beforeend", html);
    if (kind === "hello" || kind === "love" || kind === "done") add(`<span class="fx fx-burst fx-dyn">${BURST.map((a, i) => `<i style="--a:${a}deg;--i:${i}"></i>`).join("")}</span>`);
    if (kind === "love") add(`<span class="fx fx-hearts fx-dyn"><i></i><i></i><i></i></span>`);
    if (kind === "dizzy") add(`<span class="fx fx-orbit fx-dyn"><i></i><i></i><i></i></span>`);
    if (kind === "done" && el.dataset.char === "green") add(`<span class="fx fx-leaf fx-dyn"></span>`);
    if (kind === "startle") add(`<span class="fx fx-bang fx-dyn">!</span>`);
  }
  clearTimeout(Number(el.dataset.shotT));
  el.dataset.shotT = String(window.setTimeout(() => {
    delete el.dataset.shot; el.dataset.eyes = restEyes(el);
    shot?.querySelectorAll(".fx-dyn").forEach((n) => n.remove());
  }, SHOT_MS[kind]));
}

// —— 台词气泡：文案在页面里的 #amb-quips（i18n 的 quips），戳一下按顺序轮流说，爱心 / 晕 / 撸 / 被吵醒各有一句 ——
type QuipKind = "poke" | "love" | "dizzy" | "pet" | "wake";
type Quips = Record<string, { poke: string[]; love: string; dizzy: string; pet: string }> & { wake?: string[] };
let quipData: Quips | null = null;
const quipTurn = new Map<string, number>();
export function quipFor(char: string | undefined, kind: QuipKind): string | undefined {
  if (!quipData) { try { quipData = JSON.parse(document.getElementById("amb-quips")?.textContent || "{}"); } catch { quipData = {} as Quips; } }
  const list = kind === "wake" ? quipData!.wake : kind === "poke" ? quipData![char ?? ""]?.poke : undefined;
  if (list?.length) {
    const key = `${char}:${kind}`, i = quipTurn.get(key) ?? (kind === "wake" ? Math.floor(Math.random() * list.length) : 0);
    quipTurn.set(key, i + 1);
    return list[i % list.length];
  }
  return kind === "wake" || kind === "poke" ? undefined : quipData![char ?? ""]?.[kind];
}
const bubbles = new WeakMap<HTMLElement, HTMLElement>();
/** 在机器人头顶冒一个气泡（挂在 body 上、按页面坐标定位，所以不受父级 overflow 影响，跟着页面滚动） */
export function say(el: HTMLElement, text: string, ms = 2400) {
  bubbles.get(el)?.remove();
  const r = el.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
  const b = document.createElement("div");
  b.className = "quip";
  b.setAttribute("aria-hidden", "true");
  b.textContent = text;
  const scope = el.closest<HTMLElement>("[data-theme]");
  if (scope && scope !== document.documentElement) b.dataset.theme = scope.dataset.theme;
  document.body.append(b);
  const w = b.offsetWidth, cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - w / 2, 10), document.documentElement.clientWidth - w - 10);
  b.style.left = `${left + scrollX}px`;
  b.style.top = `${r.top + scrollY + r.height * 0.1}px`;
  b.style.setProperty("--tail", `${Math.min(Math.max(cx - left, 16), w - 16)}px`);
  bubbles.set(el, b);
  setTimeout(() => {
    b.classList.add("is-out");
    setTimeout(() => b.remove(), 220);
    if (bubbles.get(el) === b) bubbles.delete(el);
  }, ms);
}
const talk = (el: HTMLElement, kind: QuipKind) => {
  if (el.offsetWidth < 40) return;
  const q = quipFor(el.dataset.char, kind);
  if (q) say(el, q);
};

const pokes = new WeakMap<HTMLElement, number[]>();
function poke(el: HTMLElement) {
  const now = performance.now();
  const list = (pokes.get(el) ?? []).filter((t) => now - t < 1800).concat(now);
  const k = list.length;
  pokes.set(el, k >= 6 ? [] : list);
  const kind = k >= 6 ? "dizzy" : k >= 3 ? "love" : "poke";
  if (el.dataset.state === "sleep") { setState(el, "idle"); playShot(el, "startle"); talk(el, "wake"); return; }
  playShot(el, kind);
  if (kind !== "love" || k === 3) talk(el, kind);
}

// —— 撸一撸：鼠标在大头像上来回蹭（1.2 秒内换向 5 次、每段至少 12px）→ 冒爱心、说一句 ——
interface Pet { lx: number; dir: number; run: number; flips: number[]; cool: number }
const pets = new WeakMap<HTMLElement, Pet>();
function onPet(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget as HTMLElement;
  if (el.offsetWidth < 56) return;
  const s = pets.get(el) ?? { lx: e.clientX, dir: 0, run: 0, flips: [], cool: 0 };
  pets.set(el, s);
  const dx = e.clientX - s.lx;
  s.lx = e.clientX;
  if (Math.abs(dx) < 1) return;
  const dir = Math.sign(dx), now = performance.now();
  if (dir === s.dir) { s.run += Math.abs(dx); return; }
  if (s.dir && s.run >= 12) s.flips = s.flips.filter((t) => now - t < 1200).concat(now);
  s.dir = dir; s.run = Math.abs(dx);
  if (s.flips.length >= 5 && now > s.cool && !el.dataset.shot) {
    s.flips = []; s.cool = now + 2600;
    playShot(el, "love");
    talk(el, "pet");
  }
}
const petReset = (e: PointerEvent) => pets.delete(e.currentTarget as HTMLElement);

// —— 打瞌睡：[data-doze] 里的大头像，可见且你 20 秒没动静时一个接一个睡着（闭眼、歪头、冒 z）；
// 一动鼠标 / 滚动 / 按键就全部惊醒（跳一下、头顶一个 !），第一个醒的嘴硬说一句"我没睡" ——
export function mountDoze(root: ParentNode = document) {
  const groups = [...root.querySelectorAll<HTMLElement>("[data-doze]")];
  if (!groups.length || reduce.matches) return;
  const IDLE = 20000;
  const seen = new Set<Element>(), asleep = new Set<HTMLElement>(), timers: number[] = [];
  let idleT = 0, last = 0;
  const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))), { threshold: 0.2 });
  groups.forEach((g) => io.observe(g));
  const doze = () => groups.filter((g) => seen.has(g)).forEach((g) => {
    const fs = [...g.querySelectorAll<HTMLElement>(".bot-face.lively")].filter((f) => f.offsetParent && f.dataset.state === "idle");
    fs.sort(() => Math.random() - 0.5).forEach((f, i) => timers.push(window.setTimeout(() => {
      if (f.dataset.state !== "idle" || f.dataset.shot) return;
      setState(f, "sleep"); asleep.add(f);
    }, 300 + i * rnd(900, 2400))));
  });
  const wake = () => {
    const now = performance.now();
    if (now - last < 200 && !asleep.size) return;
    last = now;
    timers.splice(0).forEach(clearTimeout);
    clearTimeout(idleT); idleT = window.setTimeout(doze, IDLE);
    if (!asleep.size) return;
    const list = [...asleep].sort((a, b) => sizeOf(b) - sizeOf(a));
    asleep.clear();
    list.forEach((f, i) => setTimeout(() => {
      if (f.dataset.state !== "sleep") return;
      setState(f, "idle"); playShot(f, "startle");
      if (i === 0) setTimeout(() => talk(f, "wake"), 380);
    }, i * rnd(70, 180)));
  };
  for (const ev of ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"]) addEventListener(ev, wake, { passive: true });
  wake();
}

export function mountEyes(root: ParentNode = document) {
  const markEls = [...root.querySelectorAll<SVGSVGElement>("[data-amb-mark]")].filter((el) => !marks.has(el));
  const faceEls = [...root.querySelectorAll<HTMLElement>(".bot-face")].filter((el) => !faces.has(el));
  faceEls.forEach((el) => {
    if (!el.classList.contains("pokeable") || el.dataset.pokeBound) return;
    el.dataset.pokeBound = "1";
    el.addEventListener("click", () => poke(el));
    if (el.classList.contains("lively") && !reduce.matches) { el.addEventListener("pointermove", onPet); el.addEventListener("pointerleave", petReset); }
  });
  if (reduce.matches) { markEls.forEach((el) => (el.dataset.mode = "static")); return; }

  io ??= new IntersectionObserver((es) => es.forEach((e) => {
    const el = e.target as HTMLElement & SVGSVGElement;
    const m = marks.get(el) ?? faces.get(el);
    if (!m) return;
    m.visible = e.isIntersecting;
    if (marks.has(el)) el.dataset.visible = String(e.isIntersecting);
  }), { rootMargin: "120px" });

  markEls.forEach((el) => {
    const sel = el.dataset.lookAt;
    const m: Mark = { el, visible: false, x: 0, y: 0, target: sel ? document.querySelector(sel) : null };
    marks.set(el, m);
    el.style.setProperty("--idle-delay", `${-rnd(0, 7.2).toFixed(2)}s`);
    el.style.setProperty("--blink-delay", `${-rnd(0, 5).toFixed(2)}s`);
    el.querySelector(".amb-mark__lids")?.addEventListener("animationiteration", () => {
      el.style.setProperty("--blink-period", `${rnd(3.2, 7.2).toFixed(2)}s`);
      el.classList.toggle("is-double", Math.random() < 0.15);
    });
    if (!el.closest("a,button")) el.addEventListener("click", () => { el.dataset.state = "happy"; setTimeout(() => delete el.dataset.state, 900); });
    io!.observe(el);
    scheduleGlance(m);
  });
  faceEls.forEach((el) => { faces.set(el, { el, visible: false, x: 0, y: 0, target: null }); io!.observe(el); });

  if (!bound) {
    bound = true;
    addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseout", onLeave);
    addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      marks.forEach((m) => m.visible && hit && glanceAt(m.el, hit, 1200));
    }, { passive: true });
    document.addEventListener("visibilitychange", () => document.documentElement.toggleAttribute("data-tab-hidden", document.hidden));
    reduce.addEventListener("change", () => location.reload());
  }
}

// HTML 里每只眼睛只有睁眼的圆，这里补上其余表情（原因见 lib/eye-shapes.ts）。切换 data-eyes 的代码都在这个模块里，所以放在模块加载时做
document.querySelectorAll(".bf-lid").forEach((lid) => {
  const r = Number(lid.querySelector("circle")?.getAttribute("r"));
  if (r) lid.insertAdjacentHTML("beforeend", eyeShapes(r));
});
