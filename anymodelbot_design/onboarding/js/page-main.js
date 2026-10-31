// 01 上手清单：清单依次浮现 → 发出第一句 → 清单缩进左下角 → 小蓝思考、逐字回复 → 第 1 步完成
import * as P from "./proto.js";

P.init({ progress: 0 });
const { $, $$ } = P;
const intro = $("#intro"), log = $("#log"), coach = $("#coach"), input = $("#input"), send = $("#send");
const composerBox = input.parentElement;
const head = P.headFace();
const host = $("#intro .bot-face");

const ANSWER = "我能帮你聊天答疑、写东西、整理资料，也能在自己的工作区里写文件、跑命令，还能画图、做视频。把我接到微信，出门也能找我。想先试试哪个？";

// 出场：章节头、进度条、清单一行一行浮上来；主持机器人跟着章节头一起从细线上弹出来（hello 是入场动画，必须在这一帧播）
[$("#intro > header"), ...$$("#intro > div"), ...$$("#intro li")].forEach((el, i) => P.enter(el, "rise", 80 + i * 70));
if (host) P.playShot(host, "hello");
setTimeout(() => host && P.say(host, "先跟我打个招呼吧！", 2600), 1500);

let busy = false, done = false;
const chat = P.composer({ input, send, onSend: run });
$("#try").addEventListener("click", () => run("你能帮我做什么？"));
$("#collapse").addEventListener("click", collapse);
$("#c-later").addEventListener("click", () => P.leave(coach));
// 在输入：头像竖起耳朵听
input.addEventListener("input", () => !busy && P.setState(head, input.value.trim() ? "listening" : "idle"));

async function collapse() {
  if (intro.hidden) return;
  const pill = P.pill();
  await P.flyTo(intro, pill, 650);
  intro.hidden = true;
  P.setProgress(done ? 1 : 0);
}

async function run(text) {
  if (busy) return;
  busy = true;
  composerBox.classList.remove("spot-soft");
  await collapse();
  log.hidden = false;
  P.userBubble(log, text);
  P.setState(head, "thinking");
  const reply = P.botReply(log);
  await P.wait(1200);
  P.setState(head, "replying");
  const generic = !/做什么|能干|会什么|你好|嗨|hi|hello/i.test(text);
  const answer = generic ? `收到：「${text.slice(0, 24)}」。${ANSWER}` : ANSWER;
  await reply.say(answer);
  reply.done();
  P.setState(head, "idle");
  P.lastMessage(answer.slice(0, 16) + "…");
  if (!done) {
    done = true;
    await P.wait(300);
    P.stepDone(1, "跟小蓝打个招呼", head);
    await P.wait(800);
    P.coach(coach);
  }
  busy = false;
  chat.focus();
}
