// 收录徽章：站方的图加载成功后，才显示出来盖住本地备份（样式和原因见 styles/footer.css）。
// 失败不用处理：站方的图一直是透明的，格子里留着备份。
const list = document.querySelector(".footer__badges");
if (list) {
  const reveal = (img: Element) => {
    if (!img.matches(".footer__badge-copy")) img.closest(".footer__badge")?.classList.add("is-loaded");
  };
  // load 事件不冒泡，只能在捕获阶段收；脚本运行前就加载完的图错过了事件，单独补一次
  list.addEventListener("load", (e) => { if (e.target instanceof HTMLImageElement) reveal(e.target); }, true);
  list.querySelectorAll("img").forEach((img) => { if (img.complete && img.naturalWidth) reveal(img); });
}
