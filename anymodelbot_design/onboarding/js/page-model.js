// 02 换个模型：模型按钮在呼吸 → 点开选择器（按厂商折叠，可展开）→ 选一个 → 按钮上的名字换掉、对话里留一行说明 → 第 2 步完成
import * as P from "./proto.js";

P.init({ progress: 1 });
const { $, $$ } = P;
const picker = $("#picker"), chip = $("#chip"), coach = $("#coach"), arrow = $("#arrow"), log = $("#log");
const head = P.headFace();
let model = "claude-sonnet-5-5", done = false, busy = false;

const FAMILY = {
  OpenAI: [["gpt-6.1-terra", "1.05M", ["视觉", "工具", "推理"], "$0.08 / $0.40"], ["gpt-5.6-sol", "1.05M", ["视觉", "工具", "推理"], "$0.40 / $2.40"]],
  Google: [["gemini-3.8-flash", "1M", ["视觉", "工具"], "$0.23 / $1.13"]],
  DeepSeek: [["deepseek-v4-flash", "1M", ["工具", "推理"], "$0.26 / $0.77"]],
};
const MONO = "font-family: 'Geist Mono', ui-monospace, monospace";
const tag = (t) => `<span style="padding: 0 6px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18)">${t}</span>`;
const rowHtml = ([id, ctx, caps, price]) => `<button type="button" role="option" aria-selected="false" data-model="${id}" style="display: flex; flex-direction: column; align-items: stretch; gap: 2px; width: 100%; padding: 8px 10px 8px 22px; border-radius: 10px; text-align: left">
  <span style="${MONO}; font-size: 13px">${id}</span>
  <span style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #a1a1aa; font-size: 11.5px"><span style="${MONO}">${ctx}</span>${caps.map(tag).join("")}<span style="flex: 1"></span><span style="${MONO}">${price}</span></span>
</button>`;

// 每一行记下自己是哪个模型
$$('[role="option"]', picker).forEach((b) => {
  b.dataset.model ??= $$("span", b).map((s) => s.textContent.trim()).find((x) => /^(claude|gpt|gemini|deepseek|grok|kimi)/.test(x));
});

// —— 引导卡片的三段 ——
const kick = $("#c-kick");
function stage(s) {
  const st = coach.style, a = arrow.style;
  if (s === "B") {
    Object.assign(st, { right: "440px", bottom: "64px" });
    Object.assign(a, { right: "-7px", bottom: "34px", boxShadow: "1px -1px 0 rgba(255,255,255,.18)" });
  } else {
    Object.assign(st, { right: "0px", bottom: "calc(100% + 20px)" });
    Object.assign(a, { right: "112px", bottom: "-7px", boxShadow: "1px 1px 0 rgba(255,255,255,.18)" });
  }
  const t = $("#c-title"), b = $("#c-body"), l = $("#c-list");
  if (s === "A") {
    t.textContent = "换个模型";
    b.textContent = "一个账户就能用 GPT、Claude、Gemini 等模型。先点输入框右下角的模型名。";
    l.hidden = true;
  } else if (s === "B") {
    t.textContent = "挑一个就换好了";
    b.textContent = "试试展开 OpenAI，换成 gpt-6.1-terra。";
    l.hidden = false;
  } else {
    t.textContent = "换好了";
    b.textContent = `现在小蓝用的是 ${model}，只对这段对话生效。问它一句试试，或者继续下一步。`;
    l.hidden = true;
    if (!$("#c-badge")) kick.insertAdjacentHTML("beforeend", `<span id="c-badge" style="display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; background: #d7ff00; color: #161a00; ${MONO}; font-size: 11px; letter-spacing: 0">${P.ICON.check}完成</span>`);
  }
}
setTimeout(() => P.coach(coach, () => stage("A")), 500);
$("#c-later").addEventListener("click", () => P.leave(coach));

// —— 选择器 ——
function open() {
  chip.classList.remove("spot");
  chip.setAttribute("aria-expanded", "true");
  $("#chip-chev").style.transform = "rotate(180deg)";
  P.enter(picker, "pop");
  $('input[type="search"]', picker).focus();
  if (!done) P.coach(coach, () => stage("B"));
}
async function close() {
  chip.setAttribute("aria-expanded", "false");
  $("#chip-chev").style.transform = "";
  await P.leave(picker);
}
chip.addEventListener("click", () => (picker.hidden ? open() : close()));
addEventListener("pointerdown", (e) => { if (!picker.hidden && !picker.contains(e.target) && !chip.contains(e.target)) close(); });
addEventListener("keydown", (e) => e.key === "Escape" && !picker.hidden && close());

// 厂商分组：展开时一行一行冒出来
picker.addEventListener("click", (e) => {
  const fam = e.target.closest("button[aria-expanded]");
  if (fam && picker.contains(fam)) return toggleFamily(fam);
  const opt = e.target.closest('[role="option"]');
  if (opt) pick(opt);
});
function rowsAfter(head) {
  const out = [];
  for (let n = head.nextElementSibling; n && n.getAttribute("role") === "option"; n = n.nextElementSibling) out.push(n);
  return out;
}
function toggleFamily(fam) {
  const name = $("span", fam).textContent.trim();
  const opening = fam.getAttribute("aria-expanded") !== "true";
  let rows = rowsAfter(fam);
  if (opening && !rows.length && FAMILY[name]) {
    fam.insertAdjacentHTML("afterend", FAMILY[name].map(rowHtml).join(""));
    rows = rowsAfter(fam);
  }
  rows.forEach((r, i) => (opening ? P.enter(r, "rise", i * 60) : (r.hidden = true)));
  fam.setAttribute("aria-expanded", String(opening));
  $("path", fam).setAttribute("d", opening ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6");
}
$('input[type="search"]', picker).addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  $$('[role="option"]', picker).slice(1).forEach((r) => (r.hidden = !!q && !r.dataset.model.includes(q)));
});

async function pick(opt) {
  model = opt.dataset.model || model;
  $$('[role="option"]', picker).forEach((r) => { r.setAttribute("aria-selected", String(r === opt)); r.style.background = r === opt ? "rgba(215,255,0,.14)" : ""; });
  await P.wait(160);
  await close();
  const label = $("#chip-label");
  label.textContent = model;
  P.enter(label, "swap");
  P.playShot(head, "poke");
  const note = document.createElement("p");
  note.style.cssText = "align-self: center; margin: 0; padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,.05); color: #a1a1aa; font: 12px var(--font-mono)";
  note.textContent = `已切换到 ${model} · 只对这段对话生效`;
  log.append(note);
  P.enter(note, "pop");
  if (!done) {
    done = true;
    P.stepDone(2, "换个模型", head);
    await P.wait(500);
    P.coach(coach, () => stage("C"));
    chat.set("用一句话介绍你自己");
  }
}

$("#set-default").addEventListener("click", () => P.toast("已设为小蓝的默认模型", model));

// —— 换了模型后问一句 ——
const chat = P.composer({ input: $("#input"), send: $("#send"), onSend: ask });
async function ask(text) {
  if (busy) return;
  busy = true;
  P.userBubble(log, text);
  P.setState(head, "thinking");
  const r = P.botReply(log);
  await P.wait(900);
  P.setState(head, "replying");
  await r.say(`现在是 ${model} 在回答你：我是住在你电脑里的小蓝，能聊、能写、能动手，还记得你交代过的事。`);
  r.done(`${model} · `);
  P.setState(head, "idle");
  busy = false;
}
