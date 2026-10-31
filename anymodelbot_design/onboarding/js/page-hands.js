// 04 让它动手：输入框里已替你写好一句 → 发送 → 小蓝思考、干活（头像上下浮动）→ 逐字回复、清单逐条出现 →
// 文件卡片弹出、内容一行行写进去 → 余额扣一点 → 第 4 步完成
import * as P from "./proto.js";

P.init({ progress: 3 });
const { $, $$ } = P;
const log = $("#log"), r1 = $("#r1"), wl = $("#r1-wl"), file = $("#file"), pre = $("#file-pre");
const coach = $("#coach"), arrow = $("#arrow"), input = $("#input");
const head = P.headFace();
const SENTENCE = "在你的工作区建一个「今日待办.md」，列三件今天要做的事，然后发给我。";
const items = $$("#r1-list li");
const preText = pre.textContent;
const orig = { title: $("#c-title").textContent, body: $("#c-body").textContent };
items.forEach((li) => (li.hidden = true));
pre.textContent = "";
const bal = P.balanceEl();
if (bal) bal.textContent = "$12.39";

function stage(s) {
  const done = s === "B";
  coach.style.marginTop = done ? "180px" : "0px";
  arrow.hidden = !done;
  $("#c-badge").hidden = !done;
  $("#c-list").hidden = !done;
  $("#c-title").textContent = done ? orig.title : "让它动手做件事";
  $("#c-body").textContent = done ? orig.body : "小蓝能在自己的工作区里写文件、跑命令，做好的文件会交给你。输入框里已经替你写好了一句，点发送试试。";
}
setTimeout(() => P.coach(coach, () => stage("A")), 500);
$("#c-later").addEventListener("click", () => P.leave(coach));

const chat = P.composer({ input, send: $("#send"), onSend: run });
chat.set(SENTENCE);
input.parentElement.classList.add("spot-soft");

let busy = false;
async function run(text) {
  if (busy) return;
  busy = true;
  input.parentElement.classList.remove("spot-soft");
  P.leave(coach);
  log.insertBefore(P.userBubble(log, text), r1);
  P.enter(r1, "fade-in");
  wl.innerHTML = '思考中<span class="dots"><i></i><i></i><i></i></span>';
  P.setState(head, "thinking");
  await P.wait(1300);
  P.setState(head, "working");
  await P.wait(1500);
  P.setState(head, "replying");
  const t0 = performance.now(), sec = () => Math.max(1, Math.round((performance.now() - t0) / 1000) + 3);
  wl.textContent = `正在回复 ${sec()} 秒`;
  const tick = setInterval(() => (wl.textContent = `正在回复 ${sec()} 秒`), 1000);
  await P.stream($("#r1-a"), "建好了，先帮你列了三件：");
  for (const li of items) { P.enter(li, "rise"); await P.wait(260); }
  await P.stream($("#r1-b"), "文件已经发给你，想改哪条直接告诉我。");
  // 文件卡片：弹出来，内容一行一行写进去
  P.enter(file, "pop");
  file.classList.add("spot");
  for (const line of preText.split("\n")) {
    pre.textContent += (pre.textContent ? "\n" : "") + line;
    await P.wait(220);
  }
  clearInterval(tick);
  wl.textContent = `用时 ${sec()} 秒`;
  P.setState(head, "idle");
  if (bal) P.countTo(bal, 12.39, 12.37);
  P.lastMessage("建好了，列了三件事…");
  P.stepDone(4, "让它动手做件事", head);
  await P.wait(700);
  P.coach(coach, () => stage("B"));
  setTimeout(() => file.classList.remove("spot"), 6000);
  busy = false;
}

// 文件卡上的两个按钮在原型里只给反馈
$$("#file button").forEach((b) => b.addEventListener("click", () => P.toast(b.textContent.trim() === "打开" ? "用系统默认应用打开" : "在访达 / 资源管理器中显示", "今日待办.md")));
