// 原型的公共部分：机器人、翻页条、左下角清单与进度、吐司、彩带、流式打字、引导卡片的进出场。
// 每页的脚本（page-*.js）只写自己的流程，用这里的小工具拼起来。
import { mountEyes, playShot, setState, say } from "./eyes.js";
import { mountFaces } from "./bots.js";

export { playShot, setState, say };
export const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 80) : ms));

export const PAGES = ["Main.html", "Step2-Model.html", "Step3-Weixin.html", "Step4-Hands.html", "Step5-Memory.html", "Step6-Media.html", "Tips.html"];
export const STEPS = [
  ["跟小蓝打个招呼", "Main.html"],
  ["换个模型", "Step2-Model.html"],
  ["把小蓝接到微信", "Step3-Weixin.html"],
  ["让它动手做件事", "Step4-Hands.html"],
  ["让它记住你", "Step5-Memory.html"],
  ["生成一张图", "Step6-Media.html"],
];

const ICON = {
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="tick" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  spark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
};
export { ICON };

// —— 机器人的台词（戳一下会说话；同官网 i18n 的 quips） ——
const QUIPS = {
  blue: { poke: ["收到，信号满格。", "在呢在呢。", "戳一下就算已读了啊。"], love: "天线要冒火花了！", dizzy: "信号……丢……了……", pet: "滋滋——幸福满格。" },
  yellow: { poke: ["哎呀，被发现了～", "亲，请问有什么可以帮您？", "戳脸要收费的哦～"], love: "脸红了，脸红了！", dizzy: "星星……在转圈圈……", pet: "再摸摸～这里这里～" },
  green: { poke: ["别戳，我在长个子。", "光合作用 +1。", "已记入日报：被戳一次。"], love: "被你戳得发芽了。", dizzy: "叶子……打结了……", pet: "好舒服，又长高了一毫米。" },
  red: { poke: ["嘘，正放到副歌。", "别吵，在编译。", "这个 bug 是你放的吧？"], love: "行吧，摘一边耳机听你说。", dizzy: "Segmentation fault (core dumped)", pet: "节拍对了，继续。" },
  purple: { poke: ["灵感 +1。", "这一下可以写进诗里。", "别急，宝石还在结晶。"], love: "好了好了，给你写首诗。", dizzy: "灵感……碎了一地……", pet: "这手感，值得一个比喻。" },
  orange: { poke: ["护目镜被你戳歪了！", "Hola！Bonjour！你好！", "正在搜索：是谁在戳我"], love: "发现新大陆：你！", dizzy: "地图……拿反了……", pet: "此处风景甚好，标记一下。" },
  wake: ["我没睡！我在思考。", "嗯？刚才谁在打呼？", "在的在的，随时待命！"],
};

// —— 左下角「上手清单」：进度格、计数、点开的浮层 ——
let progress = 0;
const pillEl = () => $$("aside a, aside button").find((e) => e.textContent.includes("上手清单"));
const segsOf = (pill) => $$('span[aria-hidden="true"] > span', pill);
const countOf = (pill) => $$("span", pill).find((s) => !s.children.length && /\d+ \/ 6/.test(s.textContent));

function paintProgress(n, animate) {
  const pill = pillEl();
  if (!pill) return;
  segsOf(pill).forEach((s, i) => {
    const on = i < n;
    s.style.background = on ? "#d7ff00" : "rgba(255,255,255,.16)";
    if (animate && on && i >= progress) {
      s.classList.remove("seg-on");
      void s.offsetWidth;
      s.style.animationDelay = `${(i - progress) * 90}ms`;
      s.classList.add("seg-on");
    }
  });
  const c = countOf(pill);
  if (c) {
    c.innerHTML = animate ? `<span class="roll">${n}</span> / 6` : `${n} / 6`;
  }
  if (animate) {
    pill.classList.remove("bump");
    void pill.offsetWidth;
    pill.classList.add("bump");
  }
}
export function setProgress(n, { animate = true } = {}) {
  paintProgress(n, animate);
  progress = n;
}

let pop = null;
function closeChecklist() {
  if (!pop) return;
  const p = pop;
  pop = null;
  p.classList.add("is-out");
  setTimeout(() => p.remove(), 200);
}
function openChecklist(pill) {
  if (pop) return closeChecklist();
  const here = location.pathname.split("/").pop() || "Main.html";
  const items = STEPS.map(([t, href], i) => {
    const done = i < progress, cur = i === progress;
    return `<li><a href="${href}" class="${done ? "done" : cur ? "cur" : ""}"${href === here ? ' aria-current="page"' : ""}>
      <span class="n">${done ? ICON.check : i + 1}</span><span class="t">${t}</span>${cur ? '<span class="go">继续 →</span>' : ""}</a></li>`;
  }).join("");
  pop = document.createElement("div");
  pop.className = "cl-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "上手清单");
  pop.innerHTML = `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
      <h3>上手清单</h3><span style="font:12px var(--font-mono);color:var(--lime)">${progress} / 6</span></div>
    <div aria-hidden="true" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;margin-top:10px">
      ${STEPS.map((_, i) => `<span style="height:4px;border-radius:2px;background:${i < progress ? "var(--lime)" : "var(--line)"}"></span>`).join("")}</div>
    <ol>${items}</ol>
    <p style="margin:10px 4px 0;color:var(--text-2);font-size:12.5px">${progress >= 6 ? "全部完成！这个入口之后会自动收起。" : "做完一项会自动打勾，不用回来点。"}</p>`;
  document.body.append(pop);
  const r = pill.getBoundingClientRect();
  pop.style.left = `${Math.max(12, r.left)}px`;
  pop.style.bottom = `${innerHeight - r.top + 10}px`;
}

// —— 翻页条 ——
function mountNav() {
  const here = location.pathname.split("/").pop();
  const i = PAGES.indexOf(here);
  if (i < 0) return;
  const prev = i > 0 ? PAGES[i - 1] : "index.html";
  const next = i + 1 < PAGES.length ? PAGES[i + 1] : "index.html";
  const nav = document.createElement("nav");
  nav.className = "pv-nav";
  nav.setAttribute("aria-label", "预览导航");
  nav.innerHTML = `<a href="${prev}" aria-label="上一张">‹</a><a href="index.html">目录</a><span class="num">${i + 1} / ${PAGES.length}</span>
    <button type="button" title="从头再演示一遍" aria-label="重播">↻</button><a href="${next}" aria-label="下一张">›</a>`;
  nav.querySelector("button").addEventListener("click", () => location.reload());
  document.body.append(nav);
  addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea")) return;
    if (e.key === "ArrowLeft") location.href = prev;
    if (e.key === "ArrowRight") location.href = next;
  });
}

// —— 吐司与彩带 ——
let toasts = null;
export function toast(text, sub = "") {
  toasts ??= Object.assign(document.createElement("div"), { className: "toasts" });
  if (!toasts.isConnected) document.body.append(toasts);
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.innerHTML = `<span class="toast__ic">${ICON.check}</span><span>${text}${sub ? ` <span class="toast__sub">· ${sub}</span>` : ""}</span>`;
  toasts.append(t);
  setTimeout(() => { t.classList.add("is-out"); setTimeout(() => t.remove(), 260); }, 2800);
}

const CONFETTI = ["#d7ff00", "#e9ff66", "#6dd4fb", "#ffc21a", "#2ee88a", "#ff7aa8", "#c24dff", "#fafaf7"];
export function confetti(from, count = 46) {
  if (reduce) return;
  const r = from instanceof Element ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const layer = Object.assign(document.createElement("div"), { className: "confetti" });
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.style.background = CONFETTI[i % CONFETTI.length];
    p.style.left = `${x0}px`;
    p.style.top = `${y0}px`;
    if (i % 3 === 0) p.style.borderRadius = "50%";
    layer.append(p);
    const a = (Math.random() * 2 - 1) * Math.PI * 0.55 - Math.PI / 2, v = 160 + Math.random() * 260;
    const dx = Math.cos(a) * v, dy = Math.sin(a) * v;
    p.animate([
      { transform: "translate(-50%,-50%) rotate(0deg) scale(1)", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 540}deg) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx * 1.2}px, ${dy + 320 + Math.random() * 200}px) rotate(${Math.random() * 900}deg) scale(.6)`, opacity: 0 },
    ], { duration: 1500 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
  }
  setTimeout(() => layer.remove(), 2600);
}

// —— 文字：流式打出、数字滚动 ——
/** 像模型回复一样逐字出现（中文一次 1–2 个字，标点处稍停） */
export async function stream(el, text, cps = 34) {
  if (reduce) { el.textContent = text; return; }
  el.textContent = "";
  el.classList.add("caret");
  for (let i = 0; i < text.length; ) {
    const n = 1 + (Math.random() < 0.4 ? 1 : 0);
    el.textContent = text.slice(0, (i += n));
    const ch = text[i - 1];
    await new Promise((r) => setTimeout(r, (1000 / cps) * n * ("，。！？；".includes(ch) ? 4 : 1)));
  }
  el.classList.remove("caret");
}
export function countTo(el, from, to, ms = 900, fmt = (v) => `$${v.toFixed(2)}`) {
  if (reduce) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// —— 进出场 ——
export function enter(el, cls = "rise", delay = 0) {
  if (!el) return;
  el.hidden = false;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.style.setProperty("--d", `${delay}ms`);
  el.classList.add(cls);
}
export async function leave(el, cls = "coach-out") {
  if (!el || el.hidden) return;
  el.classList.add(cls);
  await wait(210);
  el.hidden = true;
  el.classList.remove(cls);
}
/** 引导卡片换一段内容：先淡出，换好再从下面浮上来；卡片里的主持机器人同时弹出来打招呼。
 *  hello 是入场动画（从缩放 0 弹出），只能在头像出现的同一帧播；对已经看得见的头像播会先消失再弹回来，看起来像闪了一下。
 *  已经在场的头像要表示「好的 / 完成」用 done 或 poke。 */
export async function coach(card, update) {
  if (!card.hidden) await leave(card);
  update?.(card);
  enter(card, "coach-in");
  const f = $(".bot-face", card);
  if (f) playShot(f, "hello");
}
/** 一个元素的「影子」飞到另一个元素上，再消失：清单收进左下角、记忆飞进面板 */
export function flyTo(from, to, ms = 700) {
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (reduce || !a.width) return Promise.resolve();
  const ghost = from.cloneNode(true);
  Object.assign(ghost.style, { position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: "0", zIndex: "1300", pointerEvents: "none", transformOrigin: "0 0" });
  document.body.append(ghost);
  const sx = b.width / a.width, sy = b.height / a.height;
  const anim = ghost.animate([
    { transform: "none", opacity: 1 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${sx}, ${sy})`, opacity: 0.15 },
  ], { duration: ms, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" });
  return anim.finished.then(() => ghost.remove());
}

/** 用户气泡：插到对话列里，从右下角弹出来 */
export function userBubble(log, text) {
  const b = document.createElement("div");
  b.style.cssText = "align-self: flex-end; max-width: 80%; padding: 10px 16px; border-radius: 18px; background: rgba(255,255,255,.07)";
  b.textContent = text;
  log.append(b);
  enter(b, "bubble-in");
  return b;
}
/** 机器人回复：上面一行工作状态（思考中 / 正在回复 N 秒 / 用时 N 秒），下面是正文 */
export function botReply(log) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display: flex; flex-direction: column; gap: 6px; align-items: flex-start";
  wrap.innerHTML = `<span class="wl" style="font: 11.5px var(--font-mono); color: var(--text-2)">思考中<span class="dots"><i></i><i></i><i></i></span></span><p class="tx" style="margin: 0; line-height: 1.75"></p>`;
  log.append(wrap);
  enter(wrap, "fade-in");
  const wl = $(".wl", wrap), tx = $(".tx", wrap), t0 = performance.now();
  let timer = 0;
  const secs = () => Math.max(1, Math.round((performance.now() - t0) / 1000));
  return {
    wrap,
    async say(text, cps) {
      wl.textContent = `正在回复 ${secs()} 秒`;
      timer = setInterval(() => (wl.textContent = `正在回复 ${secs()} 秒`), 1000);
      await stream(tx, text, cps);
    },
    done(extra = "") {
      clearInterval(timer);
      wl.textContent = `${extra}用时 ${secs() + 2} 秒`;
    },
  };
}

/** 输入框：Enter 发送（Shift+Enter 换行）；有字时发送键变亮并轻轻跳 */
export function composer({ input, send, onSend }) {
  const sync = () => send.classList.toggle("send-ready", !!input.value.trim());
  const fire = () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    sync();
    onSend(v);
  };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); fire(); } });
  send.addEventListener("click", fire);
  sync();
  return { set(v) { input.value = v; sync(); }, sync, focus: () => input.focus() };
}

/** 页面入口：机器人动起来、翻页条、左下角清单 */
export function init({ progress: n = 0 } = {}) {
  const q = Object.assign(document.createElement("script"), { type: "application/json", id: "amb-quips", textContent: JSON.stringify(QUIPS) });
  document.head.append(q);
  mountFaces();
  mountEyes();
  mountNav();
  setProgress(n, { animate: false });
  const pill = pillEl();
  pill?.addEventListener("click", (e) => { e.preventDefault(); openChecklist(pill); });
  addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target) && !pillEl()?.contains(e.target)) closeChecklist(); });
  addEventListener("keydown", (e) => e.key === "Escape" && closeChecklist());
  // 各页在 init() 之后同一个任务里挂好出场动画，下一帧才开始画，所以这里就可以显示了
  document.body.classList.add("ready");
}

/** 完成一步：进度 +1、吐司、机器人开心一下 */
export function stepDone(n, title, faceEl) {
  setProgress(n);
  toast(`第 ${n} 步完成`, title);
  if (faceEl) playShot(faceEl, "done");
}
export const pill = pillEl;
/** 侧栏左下角的余额数字 */
export const balanceEl = () => $$("span", $$("aside button").find((e) => e.textContent.includes("我的账户"))).find((s) => s.textContent.startsWith("$"));
/** 顶栏胶囊里的机器人 */
export const headFace = () => $("main header .bot-face");
/** 侧栏机器人那一行的最后一条消息 */
export function lastMessage(text) {
  const row = $("aside a[href='Main.html'] span span:last-child");
  if (row) row.textContent = text;
}
