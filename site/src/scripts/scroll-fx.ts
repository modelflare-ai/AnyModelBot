// 桌面端的滚动联动（参考 bevel.health：卡片随滚动升起、浮动元素视差、百叶窗转场），不引第三方库。
//
// [data-fx] 元素随滚动拿到 --p（0 → 1），样式里用 calc() 把它换成位移、缩放、倾斜。
// 只在宽屏（≥1024px）、有悬停的指针设备、没开"减少动态效果"时运行，并给 <html> 加 .fx；
// 联动样式都挂在 html.fx 下——窄屏、无 JS、减少动态效果时不加任何变换，元素停在终态。
//
// data-fx 的取值（位置都是视口高度的比例）：
//   ""（默认） 元素顶边从 data-fx-from（默认 1，视口底）走到 data-fx-to（默认 .55）时 --p 从 0 到 1。用于"升起来、摆正"。
//   "through"  顶边在视口底 → 底边在视口顶；元素在视口正中时 --p = .5。用于视差。
// data-fx-prev：同时把进度写到前一个兄弟元素的 --next-p（叠卡：后一张盖上来时前一张往后退）。
// 页面滚到底也到不了终点的元素（比如最后一块），终点提前到"滚到底"那一刻，保证 --p 能走到 1。
//
// .marquee：离开视口时加 .is-off，让跑马灯停下来，不在屏幕外白跑。

const WIDE = "(min-width: 1024px) and (hover: hover) and (prefers-reduced-motion: no-preference)";

interface Item { el: HTMLElement; through: boolean; from: number; to: number; prev: HTMLElement | null; last: string }

const num = (v: string | undefined, d: number) => (v == null || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function mountScrollFx() {
  const root = document.documentElement;
  const items: Item[] = [...document.querySelectorAll<HTMLElement>("[data-fx]")].map((el) => {
    const through = el.dataset.fx === "through";
    return {
      el, through,
      from: num(el.dataset.fxFrom, 1),
      to: num(el.dataset.fxTo, through ? 0 : 0.55),
      prev: "fxPrev" in el.dataset ? (el.previousElementSibling as HTMLElement | null) : null,
      last: "",
    };
  });
  const byEl = new Map(items.map((it) => [it.el, it]));
  const live = new Set<Item>();
  let raf = 0;

  const update = (it: Item, vh: number, maxScroll: number) => {
    const r = it.el.getBoundingClientRect();
    let p: number;
    if (it.through) p = (vh - r.top) / (vh + r.height);
    else {
      const from = it.from * vh;
      let to = it.to * vh;
      const lowest = r.top - (maxScroll - scrollY); // 滚到底时顶边落在哪
      if (lowest >= from) p = 1; // 贴着页面底部、连起点都到不了：直接终态
      else {
        if (lowest > to) to = lowest;
        p = (from - r.top) / (from - to);
      }
    }
    const v = clamp01(p).toFixed(3);
    if (v === it.last) return;
    it.last = v;
    it.el.style.setProperty("--p", v);
    it.prev?.style.setProperty("--next-p", v);
  };
  const frame = () => {
    raf = 0;
    const vh = innerHeight, max = root.scrollHeight - vh;
    live.forEach((it) => update(it, vh, max));
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      const it = byEl.get(e.target as HTMLElement);
      if (!it) return;
      if (e.isIntersecting) live.add(it); else live.delete(it);
    });
    queue();
  }, { rootMargin: "25% 0px" });

  const wide = matchMedia(WIDE);
  const start = () => {
    root.classList.add("fx");
    const vh = innerHeight, max = root.scrollHeight - vh;
    items.forEach((it) => { update(it, vh, max); io.observe(it.el); });
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue, { passive: true });
  };
  const stop = () => {
    root.classList.remove("fx");
    io.disconnect(); live.clear();
    removeEventListener("scroll", queue);
    removeEventListener("resize", queue);
    items.forEach((it) => { it.last = ""; it.el.style.removeProperty("--p"); it.prev?.style.removeProperty("--next-p"); });
  };
  if (items.length) {
    if (wide.matches) start();
    wide.addEventListener("change", () => (wide.matches ? start() : stop()));
  }

  // —— 跑马灯、模型环：屏幕外暂停 ——
  const marquees = document.querySelectorAll<HTMLElement>(".marquee, .orbit");
  if (marquees.length) {
    const mio = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("is-off", !e.isIntersecting)));
    marquees.forEach((m) => mio.observe(m));
  }
}
