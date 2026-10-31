// 动画时间线：演示导览（components/DemoTour.astro，点开即自动轮播）和"能动手、会记住"的循环示意都用它。
// 一个 rAF 时钟，暂停就停表，所以 CSS 不用写延迟：data-at（毫秒）到点加 .on；data-type 逐字打出；
// data-fill="起:止" 画进度条（data-fill-text 同一段写成百分比文字）；data-moves="[[毫秒, x%, y%], …]" 移动光标；
// data-flow="起:止" 把这段行程的进度写成 --k（0 → 1，匀速；完成态不写，样式自己决定停在哪）——Hero 两侧的流动卡片用它。
// 机器人：data-states="[[毫秒, 状态], …]" 切持续状态；data-shots="[[毫秒, 反应], …]" 走过那一刻时播一次；
// data-say-at="毫秒" + data-say="台词" 走过那一刻时冒气泡。完成态（at = Infinity）只设状态，不播反应、不说话。
// 整幕切换：data-steps="[[毫秒, 值], …]" 把此刻的值写到 data-step（Hero 舞台用它换机器人、换对话、换环境光）。
import { playShot, say, setState } from "../lib/eyes";

const lastAt = new WeakMap<HTMLElement, number>();
// 解析过的 [[毫秒, 值], …]：按元素 + 属性名缓存（同一个元素可以同时有 data-states 和 data-shots）
const parsed = new WeakMap<HTMLElement, Partial<Record<string, [number, string][]>>>();
const pairs = (el: HTMLElement, key: "states" | "shots" | "steps") => {
  let m = parsed.get(el);
  if (!m) parsed.set(el, (m = {}));
  return (m[key] ??= JSON.parse(el.dataset[key]!) as [number, string][]);
};
/** 列表里此刻生效的那一项（时间 ≤ at 的最后一项；还没到第一项时取第一项） */
const current = (list: [number, string][], at: number) => ([...list].reverse().find(([t]) => at >= t) ?? list[0])[1];

/** 把 scope 里的时间线渲染到时刻 at（毫秒）；at = Infinity 即完成态 */
export function renderAt(scope: HTMLElement, at: number) {
  scope.querySelectorAll<HTMLElement>("[data-at]").forEach((el) => el.classList.toggle("on", at >= Number(el.dataset.at)));
  scope.querySelectorAll<HTMLElement>("[data-type]").forEach((el) => {
    const text = el.dataset.type!, start = Number(el.dataset.at ?? 0), cps = Number(el.dataset.cps ?? 20);
    const n = at < start ? 0 : Math.min(text.length, Math.floor(((at - start) / 1000) * cps));
    if (el.textContent!.length !== n) el.textContent = text.slice(0, n);
    el.classList.toggle("is-done", n === text.length);
  });
  scope.querySelectorAll<HTMLElement>("[data-fill-text]").forEach((el) => {
    const [a, b] = el.dataset.fillText!.split(":").map(Number);
    const v = `${Math.round(Math.max(0, Math.min(1, (at - a) / (b - a))) * 100)}%`;
    if (el.textContent !== v) el.textContent = v;
  });
  scope.querySelectorAll<HTMLElement>("[data-fill]").forEach((el) => {
    const [a, b] = el.dataset.fill!.split(":").map(Number);
    el.style.width = `${Math.max(0, Math.min(1, (at - a) / (b - a))) * 100}%`;
  });
  scope.querySelectorAll<HTMLElement>("[data-flow]").forEach((el) => {
    if (!Number.isFinite(at)) { el.style.removeProperty("--k"); return; }
    const [a, b] = el.dataset.flow!.split(":").map(Number);
    const k = Math.max(0, Math.min(1, (at - a) / (b - a))).toFixed(4);
    if (el.style.getPropertyValue("--k") !== k) el.style.setProperty("--k", k);
  });
  scope.querySelectorAll<HTMLElement>("[data-moves]").forEach((el) => {
    const moves = JSON.parse(el.dataset.moves!) as [number, number, number][];
    const m = [...moves].reverse().find(([mt]) => at >= mt) ?? moves[0];
    el.style.left = `${m[1]}%`; el.style.top = `${m[2]}%`;
  });
  // 走过 ms 这一刻：本帧在 (上一帧, 这一帧]；循环回绕时从 0 算起
  const prev = lastAt.get(scope) ?? -1;
  lastAt.set(scope, at);
  const crossed = (ms: number) => Number.isFinite(at) && (at < prev ? ms <= at : ms > prev && ms <= at);
  scope.querySelectorAll<HTMLElement>("[data-states]").forEach((el) => setState(el, current(pairs(el, "states"), at)));
  // data-steps="[[毫秒, 值], …]"：把此刻的值写到 data-step 上，样式按它切换整幕（值可以是空格隔开的几个词，用 ~= 匹配）
  scope.querySelectorAll<HTMLElement>("[data-steps]").forEach((el) => {
    const v = current(pairs(el, "steps"), at);
    if (el.dataset.step !== v) el.dataset.step = v;
  });
  scope.querySelectorAll<HTMLElement>("[data-shots]").forEach((el) => pairs(el, "shots").forEach(([t, k]) => crossed(t) && playShot(el, k as Parameters<typeof playShot>[1])));
  scope.querySelectorAll<HTMLElement>("[data-say-at]").forEach((el) => crossed(Number(el.dataset.sayAt)) && say(el, el.dataset.say ?? ""));
}

/** 循环播放（只在可见时走表）：<div data-loop="10000">…</div>；
 *  data-loop-threshold 是露出多少算"看得见"（默认 .25；首屏里只露出上半截的元素调小） */
export function mountLoop(el: HTMLElement) {
  const period = Number(el.dataset.loop) || 10000;
  const threshold = Number(el.dataset.loopThreshold ?? 0.25);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { renderAt(el, Infinity); return; }
  let t = 0, last = 0, raf = 0, visible = false;
  const tick = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    t = (t + now - last) % period; last = now;
    renderAt(el, t);
    raf = requestAnimationFrame(tick);
  };
  renderAt(el, 0);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }, { threshold }).observe(el);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && visible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); } });
}

/** 演示导览：打开就从第 1 幕自动轮播，最后一幕播完回到第 1 幕，关掉才停。
 *  下面的步骤标签（[data-goto]，写 --p 画这一幕的进度、aria-selected 标当前）点哪一幕看哪一幕；
 *  舞台两侧的箭头（[data-tour-prev] / [data-tour-next]）和 ← → 键前后翻，切过去接着往下播。
 *  减少动态效果时照样按时翻页，但每幕直接显示完成态，不放逐字、光标这些细动画。 */
export function mountTour(root: HTMLDialogElement) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scenes = [...root.querySelectorAll<HTMLElement>(".tour__scene")];
  const caps = [...root.querySelectorAll<HTMLElement>("[data-caption]")];
  const bars = [...root.querySelectorAll<HTMLElement>("[data-goto]")];
  const n = scenes.length;

  let cur = 0, t = 0, last = 0, raf = 0;
  const dur = (i: number) => Number(scenes[i].dataset.duration) || 15000;

  function render(at: number) {
    renderAt(scenes[cur], reduce ? Infinity : at);
    bars.forEach((b, k) => b.style.setProperty("--p", String(k < cur ? 1 : k > cur ? 0 : Math.min(1, at / dur(cur)))));
  }
  function show(i: number) {
    cur = (i + n) % n; t = 0;
    scenes.forEach((s, k) => s.classList.toggle("is-active", k === cur));
    caps.forEach((c, k) => (c.hidden = k !== cur));
    bars.forEach((b, k) => { b.setAttribute("aria-selected", String(k === cur)); b.tabIndex = k === cur ? 0 : -1; });
    bars[cur]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    render(0);
  }
  function tick(now: number) {
    raf = 0;
    if (!root.open) return;
    // 切走标签页时 rAF 会停，回来那一帧不把离开的时间一次算进去
    t += Math.min(now - last, 100); last = now;
    if (t >= dur(cur)) show(cur + 1);
    else render(t);
    raf = requestAnimationFrame(tick);
  }
  function start(i: number) {
    show(i);
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  bars.forEach((b) => b.addEventListener("click", () => start(Number(b.dataset.goto))));
  root.querySelector("[data-tour-prev]")?.addEventListener("click", () => start(cur - 1));
  root.querySelector("[data-tour-next]")?.addEventListener("click", () => start(cur + 1));
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); start(cur + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); start(cur - 1); }
  });
  root.addEventListener("close", () => { cancelAnimationFrame(raf); raf = 0; });
  // 一打开就从第 1 步播起
  new MutationObserver(() => { if (root.open) start(0); }).observe(root, { attributes: true, attributeFilter: ["open"] });
  show(0);
}
