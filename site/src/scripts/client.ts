// 所有页面共用的交互：主题、语言提示、导航、菜单、对话框、复制、Toast、下载识别、入场动画、埋点。
// 每块都先判断元素在不在；本地存储一律 try/catch（隐私模式下可能抛错）。
import { mountEyes } from "../lib/eyes";
import { detectPlatform } from "../lib/platform";
import { initBanner } from "./banner";
import "./sections";

type Data = {
  version: string; publishedAt: string; docker: string; github: string; lang: "zh" | "en";
  platforms: Record<string, { url: string; sha256: string; sizeMB: number }>;
  i18n: Record<"win" | "mac" | "linux" | "mobile" | "generic" | "downloading" | "started" | "copied" | "copyFailed" | "bannerLeft" | "bannerLastDay", string>;
};
const data: Data = JSON.parse(document.getElementById("amb-data")?.textContent || "{}");
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 存不了就算了 */ } },
};

// —— 埋点（Umami；脚本不在时为空操作） ——
export function track(name: string, props?: Record<string, unknown>) {
  const u = (window as unknown as { umami?: { track: (n: string, p?: object) => void } }).umami;
  try { u?.track(name, props); } catch { /* 统计失败不影响页面 */ }
}
document.addEventListener("click", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-track]");
  if (!el) return;
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.dataset)) if (k.startsWith("track") && k !== "track") props[k.slice(5).toLowerCase()] = v!;
  track(el.dataset.track!, props);
});

// —— Toast ——
export function toast(msg: string, kind: "ok" | "error" = "ok") {
  const box = document.querySelector("[data-toasts]");
  if (!box) return;
  const n = document.createElement("div");
  n.className = "toast"; n.dataset.kind = kind; n.textContent = msg;
  box.append(n);
  setTimeout(() => n.remove(), 3000);
}

(window as unknown as { ambToast: typeof toast }).ambToast = toast;

// —— 复制 ——
async function copyText(text: string, btn?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    toast(data.i18n?.copied ?? "Copied");
    if (btn) { btn.dataset.state = "copied"; setTimeout(() => delete btn.dataset.state, 1600); }
  } catch {
    toast(data.i18n?.copyFailed ?? "Copy failed", "error");
    const code = btn?.closest(".code")?.querySelector("code");
    if (code) { const r = document.createRange(); r.selectNodeContents(code); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); }
  }
}
document.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-copy-text], [data-copy-from], [data-copy-code]");
  if (!b) return;
  const text = b.dataset.copyText
    ?? (b.dataset.copyFrom ? b.closest("[data-dl], .dl-card")?.querySelector(`[data-dl-${b.dataset.copyFrom}]`)?.textContent : undefined)
    ?? b.closest(".code")?.querySelector("code")?.textContent;
  if (text) copyText(text.trim(), b);
});

// —— 主题 ——
function applyTheme(pref: string) {
  const d = document.documentElement;
  const dark = pref === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : pref !== "light";
  const from = d.dataset.themePref;
  d.dataset.theme = dark ? "dark" : "light";
  d.dataset.themePref = pref;
  document.querySelector("meta[data-theme-color]")?.setAttribute("content", dark ? "#060706" : "#f4f5f7");
  $$("[data-theme-set]").forEach((b) => {
    b.setAttribute(b.getAttribute("role") === "menuitemradio" ? "aria-checked" : "aria-pressed", String(b.dataset.themeSet === pref));
  });
  if (from && from !== pref) track("theme_switch", { from, to: pref });
}
applyTheme(document.documentElement.dataset.themePref || "dark");
document.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-theme-set], [data-theme-cycle]");
  if (!b) return;
  const order = ["dark", "light", "system"];
  const pref = b.dataset.themeSet ?? order[(order.indexOf(document.documentElement.dataset.themePref || "dark") + 1) % 3];
  store.set("amb-theme", pref);
  applyTheme(pref);
  closeMenus();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => document.documentElement.dataset.themePref === "system" && applyTheme("system"));

// —— 语言：首次访问按浏览器语言提示一次（在顶部公告条里，见 scripts/banner.ts），不强制跳转；点了切换就记住 ——
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>("a[data-lang-switch]");
  if (!a) return;
  const to = data.lang === "zh" ? "en" : "zh";
  store.set("amb-lang", to);
  track("lang_switch", { from: data.lang, to });
});

// —— 菜单（下载平台、主题） ——
function closeMenus(except?: Element) {
  $$("[data-menu-toggle][aria-expanded='true']").forEach((b) => {
    if (b === except) return;
    b.setAttribute("aria-expanded", "false");
    const m = b.parentElement?.querySelector<HTMLElement>(".menu"); if (m) m.hidden = true;
  });
}
document.addEventListener("click", (e) => {
  const t = e.target as Element;
  const b = t.closest<HTMLElement>("[data-menu-toggle]");
  if (b) {
    const m = b.parentElement!.querySelector<HTMLElement>(".menu")!;
    const open = b.getAttribute("aria-expanded") !== "true";
    closeMenus(b);
    b.setAttribute("aria-expanded", String(open)); m.hidden = !open;
    // 单选菜单（语言、外观）落在当前项上，其他菜单落在第一项
    if (open) (m.querySelector<HTMLElement>('[aria-checked="true"]') ?? m.querySelector<HTMLElement>("a,button"))?.focus();
    return;
  }
  if (!t.closest(".menu")) closeMenus();
  else if (t.closest(".menu a, .menu button")) setTimeout(() => closeMenus(), 0);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const open = document.querySelector<HTMLElement>("[data-menu-toggle][aria-expanded='true']");
    if (open) { closeMenus(); open.focus(); }
  }
  const menu = (e.target as Element).closest?.(".menu");
  if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const items = $$("a,button", menu), i = items.indexOf(e.target as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
});

// —— 对话框 / 抽屉（原生 <dialog>：焦点陷阱与 Esc 自带） ——
document.addEventListener("click", (e) => {
  const t = e.target as Element;
  const opener = t.closest<HTMLElement>("[data-open-dialog]");
  if (opener) {
    const d = document.getElementById(opener.dataset.openDialog!) as HTMLDialogElement | null;
    if (d && !d.open) { d.showModal(); if (opener.dataset.track) { /* 已由 data-track 处理 */ } }
    return;
  }
  const closer = t.closest("[data-close-dialog]");
  if (closer) (closer.closest("dialog") as HTMLDialogElement | null)?.close();
  else if (t instanceof HTMLDialogElement && t.classList.contains("sheet")) t.close(); // 点背景关闭
});

// —— 导航：滚动后胶囊加实底与阴影 ——
const nav = document.querySelector("[data-nav]");
if (nav) {
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
}

// —— 导航链接：底色跟着悬停 / 焦点滑动，平时停在当前章节（首页滚动跟随）或当前页上 ——
const navLinks = document.querySelector<HTMLElement>("[data-nav-links]");
const navPill = navLinks?.querySelector<HTMLElement>(".nav__pill");
if (navLinks && navPill) {
  const items = $$<HTMLAnchorElement>(".nav__link", navLinks);
  let active: HTMLElement | null = items.find((a) => a.getAttribute("aria-current") === "page") ?? null;
  let hot: HTMLElement | null = null;
  const place = () => {
    items.forEach((a) => a.classList.toggle("is-hot", a === hot));
    const el = hot ?? active;
    if (!el) { navLinks.classList.remove("has-pill"); return; }
    // 底色从隐藏到出现时直接落位再淡入，不从上一个位置滑过来
    const snap = !navLinks.classList.contains("has-pill");
    if (snap) navLinks.classList.add("pill-snap");
    navLinks.style.setProperty("--pill-x", `${el.offsetLeft}px`);
    navLinks.style.setProperty("--pill-w", `${el.offsetWidth}px`);
    navLinks.classList.add("has-pill");
    if (snap) { void navPill.offsetWidth; navLinks.classList.remove("pill-snap"); }
  };
  items.forEach((a) => a.addEventListener("pointerenter", () => { hot = a; place(); }));
  navLinks.addEventListener("pointerleave", () => { hot = null; place(); });
  navLinks.addEventListener("focusin", (e) => { const a = (e.target as Element).closest<HTMLElement>(".nav__link"); if (a) { hot = a; place(); } });
  navLinks.addEventListener("focusout", (e) => { if (!navLinks.contains(e.relatedTarget as Node | null)) { hot = null; place(); } });

  // 首页的章节锚点：视口中间一条窄带碰到哪一章，就标哪一章
  const spy = items
    .filter((a) => a.getAttribute("href")?.startsWith("#"))
    .map((a) => ({ a, sec: document.getElementById(a.hash.slice(1)) }))
    .filter((p): p is { a: HTMLAnchorElement; sec: HTMLElement } => !!p.sec);
  if (spy.length && "IntersectionObserver" in window) {
    const seen = new Set<Element>();
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)));
      const next = spy.find((p) => seen.has(p.sec))?.a ?? null;
      if (next === active) return;
      active?.classList.remove("is-active");
      active = next;
      active?.classList.add("is-active");
      place();
    }, { rootMargin: "-40% 0px -55% 0px" });
    spy.forEach((p) => io.observe(p.sec));
  }
  place();
  // 字体加载完、窗口尺寸变了，链接宽度会变，重新量一次
  document.fonts?.ready.then(place);
  addEventListener("resize", place, { passive: true });
}

// —— 入场动画：只播一次 ——
const reveal = $$(".reveal, .reveal-hl, [data-inview]");
if ("IntersectionObserver" in window && reveal.length) {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("is-in");
    e.target.dispatchEvent(new CustomEvent("amb:inview"));
    io.unobserve(e.target);
  }), { threshold: 0.4, rootMargin: "0px 0px -8% 0px" });
  reveal.forEach((el) => io.observe(el));
} else reveal.forEach((el) => el.classList.add("is-in"));

// —— 下载：识别系统，改主按钮的文字和链接 ——
const platform = detectPlatform().then((p) => {
  document.documentElement.dataset.os = p.os;
  track("page_view", { lang: data.lang, theme: document.documentElement.dataset.theme, referrer_host: document.referrer ? new URL(document.referrer).host : "", os_detected: p.os });
  return p;
});
(async () => {
  const groups = $$("[data-dl]");
  if (!groups.length || !data.platforms) return;
  const p = await platform;
  const label = p.os === "win" ? data.i18n.win : p.os === "mac" ? data.i18n.mac : p.os === "linux" ? data.i18n.linux : p.os === "mobile" ? data.i18n.mobile : data.i18n.generic;
  const pid = p.os === "win" ? "win-x64" : p.os === "mac" ? (p.arch === "x64" ? "mac-x64" : "mac-arm64") : p.os === "linux" ? "linux-x64" : null;
  groups.forEach((g) => {
    const main = g.querySelector<HTMLAnchorElement>("[data-dl-main]")!;
    const lab = g.querySelector<HTMLElement>("[data-dl-label]")!;
    if (!g.dataset.short) lab.textContent = label;
    if (p.os === "mobile") { main.href = `${data.lang === "en" ? "/en/" : "/"}#devices`; main.dataset.platform = "mobile"; }
    else if (pid) {
      main.href = data.platforms[pid].url; main.setAttribute("download", ""); main.dataset.dlPlatform = pid;
    }
    // 识别出的平台在下拉里排第一
    if (pid) { const item = g.querySelector(`.menu [data-dl-platform="${pid}"]`); item?.parentElement?.prepend(item); }
  });
})();
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>("a[data-dl-platform]");
  if (!a) return;
  const placement = a.closest<HTMLElement>("[data-dl]")?.dataset.placement ?? a.closest<HTMLElement>("[data-placement]")?.dataset.placement ?? "page";
  track("download_start", { platform: a.dataset.dlPlatform, version: data.version, location: placement });
  track("cta_click", { location: placement, label: "download", os_detected: document.documentElement.dataset.os });
  const lab = a.matches("[data-dl-main]") ? a.querySelector<HTMLElement>("[data-dl-label]") : null;
  if (lab) {
    const prev = lab.textContent; lab.textContent = data.i18n.downloading;
    setTimeout(() => (lab.textContent = prev), 2000);
  }
  toast(data.i18n.started);
});

// —— 滚动深度 25/50/75/100 ——
(() => {
  const hit = new Set<number>();
  addEventListener("scroll", () => {
    const pct = Math.round(((scrollY + innerHeight) / document.documentElement.scrollHeight) * 100);
    for (const s of [25, 50, 75, 100]) if (pct >= s && !hit.has(s)) { hit.add(s); track("scroll_depth", { pct: s }); }
  }, { passive: true });
})();

// —— 顶部公告条：轮播、关闭、下载直链、倒计时 ——
initBanner({ track, platform, data, store });

mountEyes();
