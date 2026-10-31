// 顶部公告条的交互（components/SiteBanner.astro）：轮播、翻页 / 滑动、关闭、按系统换下载直链、倒计时、埋点。
// 显示哪些条目已由组件里的内联脚本在首帧前决定（带 data-on 的是当前这条），这里接着往下做。
import type { Platform } from "../lib/platform";

type Deps = {
  track: (name: string, props?: Record<string, unknown>) => void;
  platform: Promise<Platform>;
  data: { lang: "zh" | "en"; platforms?: Record<string, { url: string }>; i18n: Record<string, string> };
  store: { get: (k: string) => string | null; set: (k: string, v: string) => void };
};

const KEY = "amb-banner"; // 关过的条目 id（JSON 数组，只留最近 30 个）
const DAY = 864e5;

export function initBanner({ track, platform, data, store }: Deps) {
  const bar = document.querySelector<HTMLElement>("[data-sbar]");
  if (!bar || bar.hidden) return;
  const items = [...bar.querySelectorAll<HTMLElement>("[data-sbar-item]")].filter((el) => !el.hidden);
  if (!items.length) return;
  const chip = bar.querySelector<HTMLElement>("[data-sbar-chip]");
  const count = bar.querySelector<HTMLElement>("[data-sbar-count]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let cur = Math.max(0, items.findIndex((el) => el.hasAttribute("data-on")));

  // —— 曝光：每条第一次出现时记一次 ——
  const seen = new Set<string>();
  const view = () => {
    const el = items[cur], id = el.dataset.id!;
    if (seen.has(id)) return;
    seen.add(id);
    track("banner_view", { id, kind: el.dataset.kind });
  };
  view();

  // —— 切换：旧的往翻页方向淡出，新的从另一侧淡入 ——
  function show(n: number, dir: 1 | -1) {
    const next = (n + items.length) % items.length;
    if (next === cur) return;
    const prev = items[cur], el = items[next];
    prev.removeAttribute("data-on");
    delete prev.dataset.from;
    prev.dataset.out = dir > 0 ? "up" : "down";
    setTimeout(() => { if (!prev.hasAttribute("data-on")) delete prev.dataset.out; }, 500);
    delete el.dataset.out;
    el.dataset.from = dir > 0 ? "below" : "above";
    void el.offsetWidth; // 先落到起点再过渡
    el.setAttribute("data-on", "");
    cur = next;
    bar!.dataset.tone = el.dataset.tone;
    if (count) count.textContent = `${cur + 1}/${items.length}`;
    view();
  }

  // —— 自动轮播：悬停、聚焦、标签页在后台时暂停；访客自己翻过就不再自动；减少动态效果时不自动 ——
  const ms = Number(bar.dataset.rotate) || 6000;
  let timer = 0, hover = false, focus = false, manual = false;
  const schedule = () => {
    clearTimeout(timer);
    if (items.length < 2 || manual || hover || focus || reduce.matches || document.hidden || bar.hidden) return;
    timer = window.setTimeout(() => { show(cur + 1, 1); schedule(); }, ms);
  };
  const step = (dir: 1 | -1) => { manual = true; show(cur + dir, dir); schedule(); };
  bar.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hover = true; schedule(); } });
  bar.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hover = false; schedule(); } });
  bar.addEventListener("focusin", () => { focus = true; schedule(); });
  bar.addEventListener("focusout", (e) => { if (!bar.contains(e.relatedTarget as Node | null)) { focus = false; schedule(); } });
  document.addEventListener("visibilitychange", schedule);
  reduce.addEventListener?.("change", schedule);
  bar.querySelector("[data-sbar-prev]")?.addEventListener("click", () => step(-1));
  bar.querySelector("[data-sbar-next]")?.addEventListener("click", () => step(1));
  bar.addEventListener("keydown", (e) => {
    if (items.length < 2 || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    step(e.key === "ArrowRight" ? 1 : -1);
  });
  // 手机上左右滑
  const stack = bar.querySelector<HTMLElement>("[data-sbar-stack]");
  let x0 = 0, y0 = 0;
  stack?.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stack?.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (items.length > 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  schedule();

  // —— 关闭：记下这次看到的公告（换了 id 的新公告还会出现）；有语言提示时同时记住"留在当前语言" ——
  bar.querySelector("[data-sbar-close]")?.addEventListener("click", () => {
    const ids = items.filter((el) => el.dataset.kind !== "lang").map((el) => el.dataset.id!);
    let gone: unknown = [];
    try { gone = JSON.parse(store.get(KEY) || "[]"); } catch { /* 坏数据就当没有 */ }
    const list = Array.isArray(gone) ? gone.filter((x): x is string => typeof x === "string") : [];
    if (ids.length) store.set(KEY, JSON.stringify([...new Set([...list, ...ids])].slice(-30)));
    if (items.some((el) => el.dataset.kind === "lang") || (chip && !chip.hidden)) store.set("amb-lang", data.lang);
    track("banner_dismiss", { id: items[cur].dataset.id, kind: items[cur].dataset.kind, count: items.length });
    clearTimeout(timer);
    // 用键盘关的：焦点交给导航的第一个链接，不让它掉回页面开头
    if (bar.contains(document.activeElement)) document.querySelector<HTMLElement>("[data-nav] a")?.focus({ preventScroll: true });
    if (reduce.matches) { bar.hidden = true; return; }
    bar.style.height = `${bar.offsetHeight}px`;
    void bar.offsetHeight;
    bar.classList.add("is-closing");
    bar.style.height = "0px";
    const done = () => { bar.hidden = true; bar.classList.remove("is-closing"); bar.style.height = ""; };
    bar.addEventListener("transitionend", (e) => { if (e.target === bar && e.propertyName === "height") done(); });
    setTimeout(done, 600);
  });

  // —— 倒计时：截止前 7 天把"截至 11 月 30 日"换成"还剩 N 天"，最后一天显示"今天截止" ——
  const now = Date.now();
  items.forEach((el) => {
    const note = el.querySelector<HTMLElement>("[data-sbar-note]");
    const end = Date.parse(el.dataset.end || "");
    if (!note || Number.isNaN(end)) return;
    const n = Math.ceil((end - now) / DAY);
    if (n <= 1) note.textContent = data.i18n.bannerLastDay;
    else if (n <= 7) note.textContent = data.i18n.bannerLeft.replace("{n}", String(n));
  });

  // —— 发版条的下载按钮：识别出系统、且有安装包地址时，直接下载对应安装包（点击埋点和提示走 client.ts 的下载逻辑） ——
  const dl = [...bar.querySelectorAll<HTMLAnchorElement>("a[data-dl-auto]")];
  if (dl.length) platform.then((p) => {
    const pid = p.os === "win" ? "win-x64" : p.os === "mac" ? (p.arch === "x64" ? "mac-x64" : "mac-arm64") : p.os === "linux" ? "linux-x64" : null;
    const url = pid ? data.platforms?.[pid]?.url : undefined;
    if (!pid || !url || /\{[A-Z][A-Z0-9_]*\}/.test(url)) return; // 识别不出或还没有安装包：留在 /download
    dl.forEach((a) => {
      a.href = url;
      a.setAttribute("download", "");
      a.dataset.dlPlatform = pid;
      const lab = a.querySelector("[data-sbar-cta-label]");
      if (lab && data.i18n[p.os]) lab.textContent = data.i18n[p.os];
    });
  });
}
