// 05 让它记住你：发「记住……」→ 回复下冒出「已写入记忆」→ 小标签飞进右边的「记忆」→ 新条目闪一下 → 第 5 步完成；
// 之后自动整理再记一条；问「还记得吗」会答出来；说「忘掉……」或点垃圾桶会删掉
import * as P from "./proto.js";

P.init({ progress: 4 });
const { $, $$ } = P;
const log = $("#log"), mem = $("#mem"), count = $("#mem-count"), coach = $("#coach"), input = $("#input");
const head = P.headFace();
const [e1, e2] = $$("#mem > div");
const textOf = (e) => $("span span", e);
const SENTENCE = "记住：回答尽量简短，结论放在最前面。";
const orig = { body: $("#c-body").textContent };
let busy = false, done = false;

// 一开始还没有记忆
log.innerHTML = "";
e1.hidden = e2.hidden = true;
mem.insertAdjacentHTML("afterbegin", '<div id="mem-empty" style="padding: 14px; color: #a1a1aa; font-size: 13px">还没有长期记忆</div>');
const empty = $("#mem-empty");
function refresh() {
  const n = [e1, e2].filter((e) => !e.hidden).length;
  count.textContent = `${n} 条`;
  P.enter(count, "roll");
  empty.hidden = n > 0;
  e1.style.borderBottom = !e1.hidden && !e2.hidden ? "1px solid rgba(255,255,255,.10)" : "0";
}
refresh();

// —— 引导卡片 ——
const tryBtn = document.createElement("button");
tryBtn.type = "button";
tryBtn.textContent = "填入";
tryBtn.style.cssText = "min-height: 30px; padding: 0 12px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); font-size: 12.5px";
$("#c-try").append(tryBtn);
tryBtn.addEventListener("click", () => { chat.set($("#c-try-text").textContent); chat.focus(); input.parentElement.classList.add("spot-soft"); });
function stage(s) {
  const b = s === "B";
  $("#c-badge").hidden = !b;
  $("#c-title").textContent = b ? "记住了，也能忘掉" : "让它记住你";
  $("#c-body").textContent = b ? "右边就是它记下的东西。开新对话、到微信里，它都记得。" : orig.body;
  $("#c-try-label").textContent = b ? "再试试" : "试试这句";
  $("#c-try-text").textContent = b ? "你还记得我的习惯吗？" : SENTENCE;
}
setTimeout(() => P.coach(coach, () => stage("A")), 500);
$("#c-later").addEventListener("click", () => P.leave(coach));

const chat = P.composer({ input, send: $("#send"), onSend: run });
chat.set(SENTENCE);
input.parentElement.classList.add("spot-soft");

async function reply(text) {
  P.setState(head, "thinking");
  const r = P.botReply(log);
  await P.wait(900);
  P.setState(head, "replying");
  await r.say(text);
  r.done();
  P.setState(head, "idle");
  return r;
}
function show(e, text) {
  if (text) textOf(e).textContent = text;
  P.enter(e, "rise");
  e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash");
  refresh();
}
async function drop(e) {
  if (e.hidden) return;
  if (!P.reduce) await e.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }], { duration: 260, easing: "ease-in" }).finished;
  e.hidden = true;
  refresh();
  P.toast("已删除这条记忆");
}
$$('#mem button[aria-label="删除这条记忆"]').forEach((b) => b.addEventListener("click", () => drop(b.closest("#mem > div"))));

async function run(text) {
  if (busy) return;
  busy = true;
  input.parentElement.classList.remove("spot-soft");
  P.userBubble(log, text);
  if (/还记得|记得.*[吗？?]/.test(text)) {
    await reply(e1.hidden && e2.hidden ? "我还没记住你的习惯。告诉我「记住……」就行。"
      : [!e1.hidden && `记得：${textOf(e1).textContent}。`, !e2.hidden && `还有，${textOf(e2).textContent}。`].filter(Boolean).join(""));
  } else if (/^(忘掉|忘记|别记)/.test(text)) {
    const target = /待办/.test(text) ? e2 : !e1.hidden ? e1 : e2;
    if (target.hidden) await reply("目前没有可以忘掉的记忆。");
    else { await reply("好，已经忘掉了。"); await drop(target); }
  } else if (/^(记住|记一下|帮我记)/.test(text)) {
    await remember(text.replace(/^(记住|记一下|帮我记)[：:，,\s]*/, "").replace(/[。.]$/, ""));
  } else {
    await reply("收到。想让我记住什么，就说「记住……」。");
  }
  busy = false;
}

async function remember(content) {
  const r = await reply(content === "回答尽量简短，结论放在最前面" ? "记下了。以后先说结论，尽量简短。" : `记下了：${content}。`);
  // 回复下面冒出「已写入记忆」，然后飞进右边的记忆列表
  const chip = document.createElement("span");
  chip.style.cssText = "display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; background: rgba(215,255,0,.10); box-shadow: inset 0 0 0 1px rgba(215,255,0,.30); color: #d7ff00; font-size: 12px";
  chip.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14v16l-7-4-7 4z"/></svg>已写入记忆';
  r.wrap.append(chip);
  P.enter(chip, "pop");
  await P.wait(500);
  await P.flyTo(chip, mem, 700);
  show(e1, content);
  mem.classList.add("spot");
  setTimeout(() => mem.classList.remove("spot"), 3200);
  if (done) return;
  done = true;
  P.lastMessage("记下了。以后先说结论…");
  P.stepDone(5, "让它记住你", head);
  await P.wait(600);
  P.coach(coach, () => stage("B"));
  // 回合结束后自动整理：又记下一条
  await P.wait(2600);
  show(e2);
  P.toast("自动整理了一条记忆", "每天的待办记在「今日待办.md」");
}
