// 03 接到微信：① 点顶部名字 → 信息面板滑出 ② 点「微信」→「扫码登录」→ 二维码 + 扫描线 ③ 模拟扫码 → 已扫码 → 已连接 → 第 3 步完成
import * as P from "./proto.js";

P.init({ progress: 2 });
const { $, $$ } = P;
const panel = $("#panel"), capsule = $("#capsule"), coach = $("#coach"), arrow = $("#arrow");
const wx = $("#wx"), row = $("#wx-row"), body = $("#wx-body"), login = $("#wx-login"), badgeEl = $("#wx-badge");
const qrParts = ["#wx-qr", "#wx-hint", "#wx-demo", "#wx-actions"].map((s) => $(s));
const head = P.headFace();
const MONO = "font-family: 'Geist Mono', ui-monospace, monospace";
let timers = [], done = false;

// —— 渠道状态徽标 ——
const BADGE = {
  idle: ["未登录", "background: #101110; box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); color: #a1a1aa"],
  fetch: ["获取二维码…", "background: #101110; box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); color: #a1a1aa"],
  wait: ["等待扫码", "background: rgba(215,255,0,.14); color: #d7ff00"],
  scanned: ["已扫码", "background: rgba(242,181,68,.14); color: #f2b544"],
  ok: ["已连接", "background: rgba(111,217,155,.12); color: #6fd99b"],
};
function badge(k) {
  const [text, css] = BADGE[k];
  badgeEl.style.cssText = `display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 999px; ${MONO}; font-size: 11px; line-height: 22px; ${css}`;
  badgeEl.innerHTML = `${k === "ok" ? '<span aria-hidden="true" style="width: 6px; height: 6px; border-radius: 50%; background: #6fd99b"></span>' : ""}${text}`;
  P.enter(badgeEl, "pop");
}

// —— 引导卡片：① ② ③ 三步依次点亮，完成后换成完成态 ——
function marker(n) { $$(".mk").forEach((m) => (m.hidden = Number(m.dataset.mk) !== n)); const m = $(`.mk[data-mk="${n}"]`); if (m) P.enter(m, "pop"); }
function stage(n) {
  const st = coach.style, a = arrow.style;
  if (n === 1) {
    Object.assign(st, { left: "16px", right: "auto", top: "70px" });
    Object.assign(a, { left: "34px", right: "auto", top: "-7px", boxShadow: "-1px -1px 0 rgba(255,255,255,.18)" });
  } else {
    Object.assign(st, { left: "auto", right: "22px", top: "150px" });
    Object.assign(a, { left: "auto", right: "-7px", top: n === 3 ? "200px" : "120px", boxShadow: "1px -1px 0 rgba(255,255,255,.18)" });
  }
  $$("#c-list li").forEach((li) => (li.style.opacity = Number(li.dataset.s) === n ? "1" : ".42"));
  if (n === 4) {
    $("#c-title").textContent = "天天已经在微信里了";
    $("#c-body").textContent = "在微信里给它发条消息试试：同一个机器人，同一份记忆。";
    $("#c-list").hidden = true;
    if (!$("#c-badge")) $("#c-kick").insertAdjacentHTML("beforeend", `<span id="c-badge" style="display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; background: #d7ff00; color: #161a00; ${MONO}; font-size: 11px; letter-spacing: 0">${P.ICON.check}完成</span>`);
    marker(0);
  } else marker(n);
}
marker(1);
setTimeout(() => P.coach(coach, () => stage(1)), 500);
$("#c-later").addEventListener("click", () => P.leave(coach));

// ① 打开信息面板
function togglePanel() {
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  if (!P.reduce) panel.animate([{ transform: "translateX(36px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 460, easing: "cubic-bezier(.16,1,.3,1)" });
  capsule.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,.18)";
  capsule.style.background = "rgba(255,255,255,.08)";
  capsule.setAttribute("aria-pressed", "true");
  if (!done && body.hidden) { wx.classList.add("spot"); P.coach(coach, () => stage(2)); }
}
capsule.addEventListener("click", togglePanel);
$("#panel-btn").addEventListener("click", togglePanel);

// ② 展开微信那一行 → 扫码登录
row.addEventListener("click", () => {
  const open = body.hidden;
  row.setAttribute("aria-expanded", String(open));
  if (!open) { body.hidden = true; return; }
  P.enter(body, "rise");
  if (!done && login.hidden === false) { wx.classList.remove("spot"); login.classList.add("spot"); }
});
login.addEventListener("click", async () => {
  login.hidden = true;
  login.classList.remove("spot");
  badge("fetch");
  await P.wait(700);
  qrParts.forEach((el, i) => P.enter(el, i ? "fade-in" : "pop", i * 90));
  $("#wx-scan").hidden = false;
  badge("wait");
  P.coach(coach, () => stage(3));
  // 演示：几秒后自动模拟扫码 → 手机上确认
  timers = [setTimeout(scanned, 4200), setTimeout(connected, 6600)];
});
function scanned() {
  $("#wx-scan").hidden = true;
  P.enter($("#wx-scanned"), "pop");
  badge("scanned");
  P.setState(head, "waiting");
}
$("#wx-cancel").addEventListener("click", () => {
  timers.forEach(clearTimeout);
  qrParts.forEach((el) => (el.hidden = true));
  $("#wx-scanned").hidden = true;
  P.setState(head, "idle");
  login.hidden = false;
  badge("idle");
  P.coach(coach, () => stage(2));
});

// ③ 已连接
async function connected() {
  done = true;
  qrParts.forEach((el) => (el.hidden = true));
  P.enter($("#wx-done"), "rise");
  badge("ok");
  P.setState(head, "idle");
  P.confetti(badgeEl, 36);
  P.playShot(head, "love");
  P.stepDone(3, "把天天接到微信");
  P.lastMessage("微信已连接");
  await P.wait(600);
  P.coach(coach, () => stage(4));
}
