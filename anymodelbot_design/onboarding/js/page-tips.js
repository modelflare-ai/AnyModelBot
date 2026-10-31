// 随用随教：卡片滚到才浮现；点「知道了」提示收起、变成「已读」，聚光停下；看到收尾横幅时机器人们一起打招呼
import * as P from "./proto.js";

P.init();
const { $, $$ } = P;

const cards = $$("main article, body > div article");
const banner = $$("section").pop();
[...cards, banner].forEach((el, i) => { el.classList.add("reveal"); el.style.setProperty("--d", `${(i % 3) * 90}ms`); });
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.classList.add("is-in");
  io.unobserve(e.target);
  if (e.target === banner) celebrate();
}), { threshold: 0.25 });
[...cards, banner].forEach((el) => io.observe(el));

const host = $("header .bot-face");
if (host) P.playShot(host, "hello");

// 「知道了」：提示收起，留一行「已读」
const READ = `<p class="pop" style="margin: 0; display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; background: rgba(111,217,155,.08); color: #6fd99b; font-size: 13px">${P.ICON.check}已读，之后不会再出现</p>`;
async function dismiss(btn, box) {
  const card = btn.closest("article");
  if (!P.reduce) await box.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(.98)" }], { duration: 220, easing: "ease-in" }).finished;
  box.outerHTML = READ;
  $$('[style*="0 0 0 2px #d7ff00"]', card).forEach((el) => (el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,.10)"));
  const f = $(".bot-face", card);
  if (f) P.playShot(f, "done");
}
$$("article button").forEach((b) => {
  const t = b.textContent.trim();
  if (t === "知道了") b.addEventListener("click", () => dismiss(b, b.closest('[style*="background: #101110; box-shadow: 0 0 0 1px"]')));
  else if (t === "好的" || t === "改为直接退出") b.addEventListener("click", () => { dismiss(b, b.closest('[role="dialog"]')); if (t !== "好的") P.toast("已改为：关闭窗口时直接退出"); });
  else if (t === "去设置审批") b.addEventListener("click", () => P.toast("打开 机器人设置 → 电脑操作 → 审批"));
});

// 收尾横幅：横幅浮现的同一帧机器人们一起弹出来（hello 是入场动画），随后挨个跳一下、撒一把彩带
function celebrate() {
  const faces = $$(".bot-face", banner);
  faces.forEach((f) => P.playShot(f, "hello"));
  faces.forEach((f, i) => setTimeout(() => P.playShot(f, "done"), 1900 + i * 160));
  setTimeout(() => P.confetti(banner, 60), 500);
}
$$("button", banner).forEach((b) => b.addEventListener("click", () => P.toast(b.textContent.includes("再养") ? "打开「新建机器人」" : "清单已收起", "原型演示")));
