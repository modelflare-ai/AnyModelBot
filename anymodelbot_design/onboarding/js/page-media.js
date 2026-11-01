// 06 生成一张图：发出一句 → 天天想一下 → 弹出「先确认」卡片（头像跳着等你）→ 选模型、确认 →
// 生成中（闪光 + 进度）→ 图片从模糊到清晰 → 余额扣一点 → 第 6 步完成，清单全部完成，撒彩带
import * as P from "./proto.js";

P.init({ progress: 5 });
const { $, $$ } = P;
const log = $("#log"), status = $("#status"), form = $("#confirm"), result = $("#result"), coach = $("#coach"), arrow = $("#arrow"), input = $("#input");
const head = P.headFace();
const MONO = "font-family: 'Geist Mono', ui-monospace, monospace";
const SENTENCE = "画一只戴着耳机的蓝色小机器人，扁平插画风。";
const orig = { title: $("#c-title").textContent, body: $("#c-body").textContent };
const bal = P.balanceEl();
let busy = false;

// —— 引导卡片：A 试试这句 / B 先确认再花钱 / C 全部完成 / X 取消了 ——
function stage(s) {
  coach.style.marginTop = s === "B" ? "120px" : "0px";
  arrow.hidden = s !== "B";
  $("#c-list").hidden = s !== "B";
  $("#c-note").hidden = s !== "B";
  $("#c-next").hidden = s !== "C";
  const T = {
    A: ["生成一张图", "天天可以画图、做视频。输入框里已经替你写好了一句，点发送看看。"],
    B: [orig.title, orig.body],
    C: ["六件事都做完了", "天天已经准备好了。还有一些小提示，会在你第一次用到对应功能时出现。"],
    X: ["没关系，这次没花钱", "想好了再让它画。换个说法，或者换个模型都行。"],
  }[s];
  $("#c-title").textContent = T[0];
  $("#c-body").textContent = T[1];
  if (s === "C") {
    $("#c-next").textContent = "看看小提示";
    $("#c-next").href = "Tips.html";
    $("#c-kick").insertAdjacentHTML("beforeend", `<span style="display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; background: #d7ff00; color: #161a00; ${MONO}; font-size: 11px; letter-spacing: 0">${P.ICON.check}完成</span>`);
  }
}
setTimeout(() => P.coach(coach, () => stage("A")), 500);
$("#c-later").addEventListener("click", () => P.leave(coach));

const chat = P.composer({ input, send: $("#send"), onSend: run });
chat.set(SENTENCE);
input.parentElement.classList.add("spot-soft");

// —— 单选：选中的那一行亮起来 ——
const labels = $$("label", form).filter((l) => $('input[type="radio"]', l));
function paint() {
  labels.forEach((l) => {
    const on = $("input", l).checked;
    l.style.background = on ? "rgba(215,255,0,.10)" : "";
    l.style.boxShadow = on ? "inset 0 0 0 1px rgba(215,255,0,.45)" : "inset 0 0 0 1px rgba(255,255,255,.10)";
    $$("span", l)[0].style.color = on ? "#d7ff00" : "#a1a1aa";
  });
}
form.addEventListener("change", paint);

async function run(text) {
  if (busy) return;
  busy = true;
  input.parentElement.classList.remove("spot-soft");
  P.leave(coach);
  log.insertBefore(P.userBubble(log, text), status);
  P.setState(head, "thinking");
  await P.wait(1400);
  // 生成前先问：头像跳着等你、确认卡片带光圈出现
  P.enter(status, "fade-in");
  P.setState(head, "waiting");
  P.enter(form, "pop");
  form.classList.add("spot");
  P.coach(coach, () => stage("B"));
}

$("#go").addEventListener("click", async () => {
  const picked = labels.find((l) => $("input", l).checked);
  const cancel = $$("span", picked).some((s) => s.textContent.trim() === "取消");
  const name = $$("span", picked)[1].textContent.trim(), price = $$("span", picked)[2].textContent.trim();
  form.classList.remove("spot");
  await P.leave(form);
  const summary = document.createElement("div");
  summary.style.cssText = `align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: #0b0b10; box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); color: #a1a1aa; font-size: 12.5px`;
  summary.innerHTML = cancel ? "已取消 · 没有生成，也没有扣费" : `<span style="color: #d7ff00">${P.ICON.check}</span>已确认 · <span style="${MONO}; color: #fafaf7">${name}</span> · ${price.replace(/^默认 · /, "")}`;
  log.insertBefore(summary, result);
  P.enter(summary, "pop");
  if (cancel) {
    status.hidden = true;
    P.setState(head, "idle");
    P.playShot(head, "error");
    P.coach(coach, () => stage("X"));
    busy = false;
    chat.set(SENTENCE);
    return;
  }
  await generate(name);
});

// —— 生成中 → 出图 ——
async function generate(name) {
  P.setState(head, "working");
  $("#status-dot").style.background = "#d7ff00";
  $("#status-text").innerHTML = '正在生成<span class="dots"><i></i><i></i><i></i></span>';
  result.style.cssText = "width: 100%; max-width: 360px";
  result.innerHTML = `<div class="shimmer" style="aspect-ratio: 1; border-radius: 20px; background: #101110; box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); display: grid; place-items: center">
      <div style="display: grid; gap: 10px; justify-items: center; width: 60%">
        <span style="${MONO}; font-size: 12px; color: #a1a1aa" id="gen-t">${name} · 0 秒</span>
        <div class="bar" style="width: 100%"><i id="gen-bar"></i></div>
      </div></div>`;
  P.enter(result, "pop");
  const t0 = performance.now();
  for (let k = 1; k <= 10; k++) {
    await P.wait(430);
    $("#gen-bar").style.width = `${k * 10}%`;
    $("#gen-t").textContent = `${name} · ${Math.round((performance.now() - t0) / 1000)} 秒`;
  }
  result.innerHTML = `<figure style="margin: 0; display: grid; gap: 8px">
      <div style="overflow: hidden; border-radius: 20px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.10)">${ROBOT}</div>
      <figcaption style="display: flex; align-items: center; gap: 8px; color: #a1a1aa; font-size: 12.5px"><span style="${MONO}; color: #fafaf7">robot-headphones.png</span>已存到工作区 media/</figcaption>
    </figure>`;
  $("svg", result).classList.add("reveal-img");
  $("#status-dot").style.background = "#6fd99b";
  $("#status-text").textContent = `用时 ${Math.round((performance.now() - t0) / 1000) + 2} 秒`;
  P.setState(head, "idle");
  P.playShot(head, "love");
  if (bal) P.countTo(bal, 12.35, 12.31);
  P.lastMessage("画好了：robot-headphones.png");
  await P.wait(700);
  P.confetti(result, 70);
  P.stepDone(6, "生成一张图");
  setTimeout(() => P.toast("上手清单全部完成", "天天已经准备好了"), 900);
  await P.wait(800);
  P.coach(coach, () => stage("C"));
  busy = false;
}

// 生成结果：一张扁平插画（原型里的示意图）
const ROBOT = `<svg viewBox="0 0 320 320" width="100%" style="display: block" role="img" aria-label="生成的图片：戴着耳机的蓝色小机器人，扁平插画风">
  <rect width="320" height="320" fill="#eef6c8"/>
  <circle cx="262" cy="64" r="34" fill="#d7ff00"/>
  <circle cx="54" cy="260" r="22" fill="#d7ff00" opacity=".6"/>
  <ellipse cx="160" cy="292" rx="86" ry="10" fill="#161a00" opacity=".12"/>
  <rect x="112" y="222" width="96" height="66" rx="26" fill="#2a9dff"/>
  <rect x="140" y="240" width="40" height="10" rx="5" fill="#6dd4fb"/>
  <line x1="160" y1="104" x2="160" y2="74" stroke="#13233a" stroke-width="6" stroke-linecap="round"/>
  <circle cx="160" cy="66" r="11" fill="#ff7aa8"/>
  <rect x="80" y="102" width="160" height="128" rx="46" fill="#4fb6ff"/>
  <rect x="100" y="128" width="120" height="80" rx="34" fill="#13233a"/>
  <circle cx="136" cy="166" r="11" fill="#6dd4fb"/>
  <circle cx="184" cy="166" r="11" fill="#6dd4fb"/>
  <path d="M147 188q13 10 26 0" stroke="#6dd4fb" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M66 170C66 70 254 70 254 170" stroke="#161a00" stroke-width="12" fill="none" stroke-linecap="round"/>
  <rect x="48" y="140" width="36" height="66" rx="15" fill="#161a00"/>
  <rect x="236" y="140" width="36" height="66" rx="15" fill="#161a00"/>
  <rect x="57" y="154" width="18" height="38" rx="8" fill="#ff8c1a"/>
  <rect x="245" y="154" width="18" height="38" rx="8" fill="#ff8c1a"/>
  <path d="M266 248v-30l18-5v28" stroke="#161a00" stroke-width="5" fill="none" stroke-linejoin="round"/>
  <circle cx="260" cy="249" r="7" fill="#161a00"/>
  <circle cx="278" cy="243" r="7" fill="#161a00"/>
</svg>`;
