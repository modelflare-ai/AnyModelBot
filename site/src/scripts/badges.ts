// 收录徽章的两件事（样式和原因见 styles/footer.css）。
const root = document.querySelector<HTMLElement>(".footer__featured");
const list = root?.querySelector<HTMLElement>(".footer__badges");
const more = root?.querySelector<HTMLButtonElement>(".footer__more");

if (list) {
  // 站方的图加载成功后，才显示出来盖住本地备份。失败不用处理：站方的图一直是透明的，留着备份。
  const reveal = (img: Element) => {
    if (!img.matches(".footer__badge-copy")) img.closest(".footer__badge")?.classList.add("is-loaded");
  };
  // load 事件不冒泡，只能在捕获阶段收；脚本运行前就加载完的图错过了事件，单独补一次
  list.addEventListener("load", (e) => { if (e.target instanceof HTMLImageElement) reveal(e.target); }, true);
  list.querySelectorAll("img").forEach((img) => { if (img.complete && img.naturalWidth) reveal(img); });
}

if (root && list && more) {
  // 展开和收起。高度过渡用 Web Animations 做：结束后高度交回给 CSS，窗口再怎么变都不用重新量
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let anim: Animation | undefined;
  const setOpen = (open: boolean) => {
    const from = list.getBoundingClientRect().height;
    anim?.cancel(); // 上一次还没播完时，先量到当前位置再取消，否则量不到新状态的真实高度
    root.classList.toggle("is-open", open);
    more.setAttribute("aria-expanded", String(open));
    if (reduced.matches) return;
    const to = list.getBoundingClientRect().height;
    // max-height 要一起动：收起时 CSS 的 max-height 立刻生效，只动 height 会直接跳过去
    anim = list.animate({ height: [`${from}px`, `${to}px`], maxHeight: [`${from}px`, `${to}px`] }, { duration: 240, easing: "cubic-bezier(.2, .8, .2, 1)" });
  };
  more.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
  // 被裁掉的链接还在 Tab 顺序里：键盘走到折叠线以下时自动展开，焦点不会落到看不见的地方
  list.addEventListener("focusin", (e) => {
    if (root.classList.contains("is-open") || !(e.target instanceof Element)) return;
    if (e.target.getBoundingClientRect().top >= list.getBoundingClientRect().bottom) setOpen(true);
  });
}
