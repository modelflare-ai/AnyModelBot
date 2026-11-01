// 每个素材的录制脚本：数据场景、代理回合脚本（模拟后端按它推送活动步骤、审批、回复）、鼠标与键盘的动作和时间点。
// 时间点对照 docs/assets/README.md 的「GIF 卡片」；卡片和应用的真实行为不一致时按真实行为录（见同目录 README.md）。
import * as D from "./demo-data.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KB = 1024;
const MB = 1024 * KB;
const APP = { x: 0, y: 0, w: 1200, h: 820 };
const Y = D.YELLOW;

// —— 提示词 ——
export const P = {
  raft: D.RAFT_Q,
  tidyShot: "整理桌面上的 demo-files",
  tidyHero: "把桌面上 demo-files 文件夹里的文件按类型整理一下",
  tidyFiles: "把 demo-files 里的文件按扩展名分到子文件夹，再把清单写到 整理清单.md 发给我",
  notepad: "打开记事本，写一句『今天也要加油』，保存到桌面，文件名 note.txt",
  draw: "画一只在键盘上打瞌睡的黄色小机器人，扁平插画",
  hello: "你好，介绍一下你自己",
  whichModel: "你现在是哪个模型？",
  remember: "记住：我喜欢简短的回答，周报用中文",
  weekly: "帮我起一个周报的开头",
  wxIntro: "用一句话介绍你自己",
};

// —— 代理回合用到的命令（Windows 上代理用 pwsh）——
const DEMO = "$HOME\\Desktop\\demo-files";
const LIST_CMD = `Get-ChildItem -File "${DEMO}" | Group-Object Extension | Select-Object Name, Count`;
const LIST_OUT = "Name  Count\n----  -----\n.docx     4\n.mp3      4\n.pdf      4\n.png      4\n.xlsx     4\n.zip      4";
const SIZE_CMD = `Get-ChildItem -File "${DEMO}" | Measure-Object Length -Sum`;
const SIZE_OUT = "Count    : 24\nSum      : 3268412";
const MOVE_CMD = `$d = "${DEMO}"; Get-ChildItem -File $d | ForEach-Object { $t = Join-Path $d $_.Extension.TrimStart('.'); New-Item -ItemType Directory -Force $t | Out-Null; Move-Item $_.FullName $t }`;
// 越界写入的审批理由：DSH 沙箱提权的固定格式（dsh-sandbox：允许本次操作使用 <模式> 权限：<模型写的理由>）
const MOVE_REASON = "允许本次操作使用 danger-full-access 权限：demo-files 在桌面上，不在工作区里，需要在里面建子文件夹并移动 24 个文件";
const CHECK_CMD = `Get-ChildItem -Directory "${DEMO}" | ForEach-Object { "$($_.Name)/ $((Get-ChildItem $_.FullName).Count)" }`;
const CHECK_OUT = "docx/ 4\nmp3/ 4\npdf/ 4\npng/ 4\nxlsx/ 4\nzip/ 4";
const TREE = ["demo-files/", "├── docx/   4 个文件", "├── mp3/    4 个文件", "├── pdf/    4 个文件", "├── png/    4 个文件", "├── xlsx/   4 个文件", "└── zip/    4 个文件"].join("\n");
const pw = (cmd) => JSON.stringify({ command: cmd }, null, 2);

/** 录制时由 spec.run 填进来，回合脚本借它去摆舞台上的窗口（记事本等） */
const ctx = { R: null, wxDelay: 2600 };

/** 代理回合脚本：t 是模拟后端给的接口（model / tool / approval / question / file / reply …） */
export const scripts = {
  async [P.raft](t) {
    const m = t.model();
    await sleep(4200);
    m.done("Raft 选主是为了让一致性问题变简单：", { output: D.RAFT_A });
    t.reply(D.RAFT_A);
  },

  // agent 截图：五步做完，第六步（越界移动文件）等审批；截图时一直停在这里
  async [P.tidyShot](t) {
    let m = t.model();
    await sleep(700);
    m.done("调用 pwsh");
    let c = t.tool("pwsh", LIST_CMD, pw(LIST_CMD));
    await sleep(380);
    c.done(LIST_OUT);
    m = t.model();
    await sleep(900);
    m.done("24 个文件、6 种扩展名。先看一下总大小，再按扩展名建子文件夹，把文件移进去。");
    c = t.tool("pwsh", SIZE_CMD, pw(SIZE_CMD));
    await sleep(300);
    c.done(SIZE_OUT);
    m = t.model();
    await sleep(600);
    m.done("调用 pwsh");
    t.tool("pwsh", MOVE_CMD, pw(MOVE_CMD));
    await t.approval({ tool: "pwsh", detail: MOVE_CMD, reason: MOVE_REASON });
    await sleep(60_000);
  },

  async [P.tidyHero](t) {
    let m = t.model();
    await sleep(900);
    m.done("调用 pwsh");
    let c = t.tool("pwsh", LIST_CMD, pw(LIST_CMD));
    await sleep(450);
    c.done(LIST_OUT);
    m = t.model();
    await sleep(1100);
    m.done("24 个文件、6 种扩展名：按扩展名建子文件夹，再把文件移进去。");
    c = t.tool("pwsh", MOVE_CMD, pw(MOVE_CMD));
    await t.approval({ tool: "pwsh", detail: MOVE_CMD, reason: MOVE_REASON });
    await sleep(800);
    c.done();
    c = t.tool("pwsh", CHECK_CMD, pw(CHECK_CMD));
    await sleep(420);
    c.done(CHECK_OUT);
    m = t.model();
    await sleep(1300);
    m.done("整理好了，24 个文件按类型分进了 6 个子文件夹");
    t.reply(`整理好了，24 个文件按类型分进了 6 个子文件夹：\n\n\`\`\`\n${TREE}\n\`\`\`\n\n文件名都没改，每个子文件夹 4 个文件。`);
  },

  async [P.tidyFiles](t) {
    let m = t.model();
    await sleep(1100);
    m.done("调用 pwsh");
    let c = t.tool("pwsh", LIST_CMD, pw(LIST_CMD));
    await sleep(600);
    c.done(LIST_OUT);
    m = t.model();
    await sleep(1500);
    m.done("方案：建 docx、mp3、pdf、png、xlsx、zip 六个子文件夹，按扩展名移动 24 个文件，再把清单写进 整理清单.md。");
    c = t.tool("pwsh", SIZE_CMD, pw(SIZE_CMD));
    await sleep(500);
    c.done(SIZE_OUT);
    m = t.model();
    await sleep(700);
    m.done("调用 pwsh");
    c = t.tool("pwsh", MOVE_CMD, pw(MOVE_CMD));
    await t.approval({ tool: "pwsh", detail: MOVE_CMD, reason: MOVE_REASON });
    await sleep(600);
    c.done();
    c = t.tool("write", "整理清单.md", JSON.stringify({ path: "整理清单.md", content: "# demo-files 整理清单\n…" }, null, 2));
    await sleep(500);
    c.done("已写入 整理清单.md（31 行）");
    c = t.tool("present", "", JSON.stringify({ files: [{ path: "整理清单.md", description: "整理后的文件清单" }] }, null, 2));
    await sleep(300);
    c.done();
    m = t.model();
    await sleep(800);
    m.done("整理好了：24 个文件分进 6 个子文件夹，清单在 整理清单.md。");
    t.file("整理清单.md");
    t.reply("整理好了：24 个文件按扩展名分进了 docx、mp3、pdf、png、xlsx、zip 六个子文件夹，每个 4 个。完整清单写在 **整理清单.md** 里，已经发给你。");
  },

  // G4：每个改变界面的操作都要审批（审批设为「改变界面前先问我」）；记事本是舞台上的示意窗口
  async [P.notepad](t) {
    const R = ctx.R;
    const CU = (a) => `mcp__computer-use__${a}`;
    let m = t.model();
    await sleep(700);
    m.done(`调用 ${CU("launch_app")}`);
    let c = t.tool(CU("launch_app"), "", JSON.stringify({ name: "notepad" }, null, 2));
    await t.approval({ tool: CU("launch_app"), detail: JSON.stringify({ name: "notepad" }), reason: "电脑操作：launch_app" });
    await sleep(250);
    await R?.stage("notepad.open", NOTEPAD);
    await sleep(250);
    c.done("已启动 记事本（pid 4812）");
    c = t.tool(CU("get_window_state"), "", JSON.stringify({ pid: 4812 }, null, 2));
    await sleep(350);
    c.done("窗口：无标题 - 记事本；文本框为空");
    m = t.model();
    await sleep(600);
    m.done(`调用 ${CU("type_text")}`);
    c = t.tool(CU("type_text"), "", JSON.stringify({ pid: 4812, text: "今天也要加油" }, null, 2));
    await t.approval({ tool: CU("type_text"), detail: JSON.stringify({ pid: 4812, text: "今天也要加油" }), reason: "电脑操作：type_text" });
    await sleep(200);
    await R?.stage("notepad.type", "今天也要加油", 900);
    c.done();
    m = t.model();
    await sleep(600);
    m.done(`调用 ${CU("run_steps")}`);
    const steps = { pid: 4812, steps: [{ action: "hotkey", keys: ["ctrl", "s"] }, { action: "type_text", text: "%USERPROFILE%\\Desktop\\note.txt" }, { action: "press_key", key: "enter" }] };
    c = t.tool(CU("run_steps"), "", JSON.stringify(steps, null, 2));
    await t.approval({ tool: CU("run_steps"), detail: JSON.stringify(steps), reason: "电脑操作：run_steps" });
    await sleep(200);
    await R?.stage("notepad.saveAs", "%USERPROFILE%\\Desktop\\note.txt", "note.txt", 1300);
    await R?.stage("icon", "ic-note", "doc", "note.txt", NOTE_ICON.x, NOTE_ICON.y, true);
    c.done("3 步都已执行");
    c = t.tool(CU("get_window_state"), "", JSON.stringify({ pid: 4812 }, null, 2));
    await sleep(600);
    c.done("窗口：note.txt - 记事本");
    m = t.model();
    await sleep(1400);
    m.done("已保存");
    t.reply("已保存：记事本里写好了「今天也要加油」，存到了桌面，文件名 note.txt。");
  },

  // G5：生图前先确认模型（src/agent/manager.ts confirmMedia 的格式），成图用 present 交付成文件卡片
  async [P.draw](t) {
    let m = t.model();
    await sleep(800);
    m.done("调用 generate_image");
    const prompt = "一只黄色的小机器人趴在电脑键盘上打瞌睡，闭着眼睛，旁边飘着几个 Z，扁平插画风格，配色柔和";
    const c = t.tool("generate_image", "", JSON.stringify({ prompt, size: "1024x1024" }, null, 2));
    const opt = (id, tag = "") => ({ label: id, description: [tag, D.MEDIA_PRICE[id]].filter(Boolean).join(" · ") || undefined });
    const def = D.MEDIA.recommended.image;
    await t.question(
      [
        {
          id: "model",
          header: "生成图片",
          question: `这次用 ${def} 生成图片吗？`,
          detail: `提示词：${prompt}\n参数：1024x1024\n参考价：${D.MEDIA_PRICE[def]}\n也可以直接回复其他模型名。`,
          options: [opt(def, "默认"), ...D.MEDIA.image.filter((x) => x !== def).slice(0, 3).map((x) => opt(x)), { label: "取消", description: "这次不生成" }],
        },
      ],
      "generate_image",
    );
    await sleep(2600);
    c.done(`已用 ${def} 生成 1 张图片，保存在工作区：media/sleepy-bot.png。要发给用户，请用 present 工具交付这些文件。`);
    const p = t.tool("present", "", JSON.stringify({ files: [{ path: "media/sleepy-bot.png" }] }, null, 2));
    await sleep(300);
    p.done();
    m = t.model();
    await sleep(700);
    m.done("画好了");
    t.file("sleepy-bot.png");
    t.reply("画好了：一只趴在键盘上打瞌睡的黄色小机器人，扁平插画风格，图片发在下面。");
  },

  async [P.hello](t) {
    const m = t.model();
    await sleep(2000);
    const a = "你好！我是你的 AI 助手，就住在这台电脑上。\n\n我可以陪你聊天、写东西，也能在工作区里读写文件、运行命令、帮你整理资料；连上微信或飞书之后，在手机上也能找到我。想先试试什么？";
    m.done("你好！我是你的 AI 助手，就住在这台电脑上。");
    t.reply(a);
  },

  async [P.whichModel](t) {
    const m = t.model();
    await sleep(550);
    m.done(`我现在用的是 ${t.modelId}`);
    t.reply(`我现在用的是 **${t.modelId}**，就是你刚才在这段对话里切换的模型。`);
  },

  async [P.remember](t) {
    let m = t.model();
    await sleep(700);
    m.done("调用 remember");
    const c = t.tool("remember", "", JSON.stringify({ text: "喜欢简短的回答；周报用中文", scope: "own" }, null, 2));
    t.remember("喜欢简短的回答；周报用中文");
    await sleep(300);
    c.done("已记住（机器人记忆）");
    m = t.model();
    await sleep(600);
    m.done("记住了");
    t.reply("记住了：以后回答尽量简短，周报一律用中文写。");
  },

  async [P.weekly](t) {
    const m = t.model();
    await sleep(1300);
    m.done("本周进展顺利");
    t.reply("本周进展顺利：新版引导页已上线，支付回调的问题也修好了；下周重点推进灰度发布。");
  },

  async [P.wxIntro](t) {
    const m = t.model();
    await sleep(ctx.wxDelay);
    const a = "我是小黄，住在你电脑上的 AI 助手：能聊天、整理文件、操作电脑，在微信里也随叫随到。";
    m.done(a);
    t.reply(a);
  },

  async __default(t, botId, text) {
    const m = t.model();
    await sleep(1200);
    m.done("好的");
    t.reply(`（演示环境没有为「${text}」准备回复）`);
  },
};
const chat = (t, botId, text) => (scripts[text] || scripts.__default)(t, botId, text);

// —— 舞台上的位置 ——
const NOTEPAD = { x: 1258, y: 96, w: 516, h: 520 };
const NOTE_ICON = { x: 1660, y: 840 };

// —— 共用的几个动作 ——
async function openChat(R, rect = APP, title = false) {
  await R.openApp({ src: `/#/chat/${Y}`, rect, title });
  await R.wait(".chat-col .msg-row");
  return R.wait(".composer textarea");
}
/** 等审批卡片出现，移过去点「允许（仅本次）」，等它变成已批准 */
async function allow(R, { pause = 0.35, dur = 0.65 } = {}) {
  const b = await R.wait(".card:not(.done) .actions .btn.primary", { timeout: 30000 });
  await R.click(b, { dur, pause, label: "允许" });
  await R.waitFn(() => !document.querySelector(".card:not(.done) .actions .btn.primary"));
}
const lastReply = (R, text) => R.wait(R.$(".msg-row.assistant .msg").filter({ hasText: text }));
const hhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** 截图前鼠标停到窗口右边缘的空白处（不悬停任何控件） */
const park = (R) => R.page.mouse.move(1196, 420);
/** 断言：元素都在可视区域里（截图卡片要求「审批按钮可见」之类） */
async function assertVisible(R, sels, within = ".chat-scroll") {
  const res = await R.app.evaluate(
    ([sels, within]) => {
      const box = within ? document.querySelector(within).getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
      return sels.map((s) => {
        const el = [...document.querySelectorAll(s)].at(-1);
        if (!el) return `${s}: 不存在`;
        const r = el.getBoundingClientRect();
        return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.width > 0 ? "" : `${s}: 不在可视区域（${Math.round(r.top)}–${Math.round(r.bottom)}，区域 ${Math.round(box.top)}–${Math.round(box.bottom)}）`;
      });
    },
    [sels, within],
  );
  const bad = res.filter(Boolean);
  if (bad.length) throw new Error("截图断言失败：" + bad.join("；"));
}

const shot = (id, extra) => ({ id: `shot-${id}`, out: `screenshots/${id}-{theme}.webp`, kind: "webp", viewport: [1200, 820], limit: 300 * KB, scene: "demo", storage: { "amb-bot": Y }, chat, ...extra });
const gif = (id, out, extra) => ({ id, out, kind: "gif", viewport: [1200, 820], size: [960, 656], fps: 10, limit: 3 * MB, scene: "demo", storage: { "amb-bot": Y }, chat, ...extra });

export const SCENES = [
  // ---------------------------------------------------------------- 截图（明暗成对）
  shot("chat", {
    hash: `#/chat/${Y}`,
    async run(R) {
      const ta = await R.wait(".composer textarea");
      await R.wait(".chat-col .msg-row");
      await ta.click();
      await R.page.keyboard.type(P.raft);
      await R.page.keyboard.press("Enter");
      await lastReply(R, "Raft 选主是为了");
      await R.wait(".msg-row.assistant.last pre");
      await park(R);
      await sleep(2200);
      await assertVisible(R, [".msg-row.user .msg", ".msg-row.assistant.last pre", ".msg-row.assistant.last ol"]);
      if ((await R.$(".side-list .thread").count()) !== 6) throw new Error("侧栏不是六个机器人");
      if (!/claude-sonnet-5-5/.test(await R.$(".composer .model-chip:not(.perm)").innerText())) throw new Error("模型按钮没显示模型名");
    },
  }),
  shot("agent", {
    hash: `#/chat/${Y}`,
    async run(R) {
      const ta = await R.wait(".composer textarea");
      await R.wait(".chat-col .msg-row");
      await ta.click();
      await R.page.keyboard.type(P.tidyShot);
      await R.page.keyboard.press("Enter");
      await R.wait(".card:not(.done) .actions .btn.primary", { timeout: 30000 });
      await (await R.wait("button.work-line.toggle.live")).click();
      await R.wait(".act-list .act-step");
      await sleep(400);
      // 展开的步骤列表不会自动滚到底：像用户一样滚一下
      await R.page.mouse.move(700, 400);
      await R.page.mouse.wheel(0, 1600);
      await park(R);
      await sleep(1500);
      const n = await R.$(".act-list .act-step.ok").count();
      const running = await R.$(".act-list .act-step.running").count();
      if (n < 4 || n > 5 || running !== 1) throw new Error(`步骤数不对：完成 ${n}，进行中 ${running}`);
      await assertVisible(R, [".card:not(.done) .actions .btn.primary", ".card:not(.done) .q", ".act-list .act-step.running"]);
    },
  }),
  shot("models", {
    hash: `#/chat/${Y}`,
    async run(R) {
      await R.wait(".chat-col .msg-row");
      await R.$(".composer .model-chip:not(.perm)").click();
      await R.wait(".model-picker li[role=option] .n");
      await R.$(".model-picker li.fam").filter({ hasText: "GPT" }).click();
      await sleep(300);
      // 列表一屏放得下 9 行：滚到 GPT 的第一个模型在顶上，这样 GPT 4 个 + Claude 4 个都在视野里
      const list = R.$(".model-picker ul");
      const b = await list.boundingBox();
      await R.page.mouse.move(b.x + b.width / 2, b.y + 60);
      const off = await R.app.evaluate(() => {
        const ul = document.querySelector(".model-picker ul");
        const first = [...ul.querySelectorAll("li[role=option]")].find((li) => li.textContent.startsWith("gpt-"));
        return first.getBoundingClientRect().top - ul.getBoundingClientRect().top - parseFloat(getComputedStyle(ul).paddingTop);
      });
      await R.page.mouse.wheel(0, off);
      await sleep(500);
      const third = R.$(".model-picker ul > li").nth(await R.app.evaluate(() => {
        const ul = document.querySelector(".model-picker ul");
        const top = ul.getBoundingClientRect().top;
        const lis = [...ul.children];
        return lis.findIndex((li) => li.getBoundingClientRect().top >= top - 1) + 2;
      }));
      const tb = await third.boundingBox();
      await R.page.mouse.move(tb.x + tb.width * 0.4, tb.y + tb.height / 2);
      await sleep(900);
      // 断言：搜索框为空；可见的模型行至少 8 个，每行都有上下文、能力和参考价；第三行是悬停高亮
      const info = await R.app.evaluate(() => {
        const ul = document.querySelector(".model-picker ul").getBoundingClientRect();
        const rows = [...document.querySelectorAll(".model-picker li[role=option]")].filter((li) => {
          const r = li.getBoundingClientRect();
          return r.top >= ul.top - 1 && r.bottom <= ul.bottom + 1 && !li.textContent.includes("跟随机器人默认");
        });
        return {
          q: document.querySelector(".model-picker input").value,
          rows: rows.map((li) => li.textContent),
          third: (() => {
            const lis = [...document.querySelectorAll(".model-picker ul > li")].filter((li) => li.getBoundingClientRect().top >= ul.top - 1);
            return lis[2].className + " " + lis[2].textContent;
          })(),
        };
      });
      const priced = info.rows.filter((t) => /\d(K|M) · 视觉|工具/.test(t) && /\$/.test(t));
      if (info.q || info.rows.length < 8 || priced.length !== info.rows.length || !/sel/.test(info.third)) throw new Error("模型选择器断言失败：" + JSON.stringify(info));
    },
  }),
  shot("memory", {
    hash: `#/chat/${Y}`,
    sceneOpts: { memory: D.MEMORY_PREFS },
    async run(R) {
      await R.wait(".chat-col .msg-row");
      await R.$('.chat-head button[aria-label^="信息面板"]').click();
      await R.wait(".panel .row .badge.ok");
      await R.waitFn(() => document.querySelectorAll(".panel .row.compact .selectable").length === 4);
      await R.waitFn(() => [...document.querySelectorAll(".panel .row.compact.clickable")].length === 3);
      await park(R);
      await sleep(1500);
      const ok = await R.$(".panel .badge.ok").count();
      if (ok !== 2) throw new Error(`渠道没有都显示已连接：${ok}`);
      await assertVisible(R, [".panel .row.compact.clickable"], ".panel-body");
    },
  }),
  shot("modelflare", {
    hash: "#/settings/modelflare",
    async run(R) {
      await R.wait("#set-balance");
      await R.wait("#set-default-model .pick");
      await R.$("#set-usage button").click();
      await R.wait(".usage-days .bar i");
      await park(R);
      await sleep(1500);
      const t = await R.app.evaluate(() => document.querySelector(".sheet").innerText);
      if (!/合计 \$/.test(t)) throw new Error("用量弹窗没有数据");
      if (!/\$12\.40/.test(await R.$("#set-balance").innerText())) throw new Error("余额不是 12.40");
    },
  }),

  // ---------------------------------------------------------------- GIF（一律深色）
  gif("hero-demo", "hero/hero-demo.gif", {
    fps: 12,
    duration: 20,
    limit: 5 * MB,
    scene: "signed-out",
    async run(R) {
      await R.openApp({ src: "/", rect: APP });
      const login = await R.wait(".login-cta .btn.primary");
      await R.place(640, 720);
      await R.move(login, { dur: 0.8 });
      await sleep(500);
      R.start();
      await R.until(1.2);
      const started = R.once("login-started");
      await R.click(login, { pause: 0.3, label: "登录 / 注册 Modelflare" });
      await started;
      await sleep(120);
      await R.stage("browser.show", APP, { loading: 200 });
      R.mark("浏览器授权页");
      await sleep(300);
      await R.click(R.s$("#auth-ok"), { dur: 0.6, pause: 0.3, label: "继续（授权）" });
      R.mock.authorize();
      await R.stage("browser.done");
      await sleep(320);
      await R.stage("browser.hide");
      R.mark("回到应用");
      const start = await R.wait(R.$(".onboard button").filter({ hasText: "开始对话" }));
      await R.click(start, { dur: 0.6, pause: 0.3, label: "开始对话" });
      const ta = await R.wait(".composer textarea");
      R.mark("主界面");
      await R.click(ta, { dur: 0.6, pause: 0.15, label: "输入框" });
      await R.type(P.tidyHero, { dur: 2.2 });
      await R.press("Enter");
      const tog = await R.wait("button.work-line.toggle.live");
      await R.click(tog, { dur: 0.6, pause: 0.3, label: "展开活动列表" });
      await allow(R, { pause: 0.4 });
      await R.move({ x: 760, y: 560 }, { dur: 0.8 });
      await lastReply(R, "整理好了");
      R.mark("回复完成");
    },
  }),

  gif("install-windows", "download/install-windows.gif", {
    viewport: [1920, 1080],
    size: [960, 540],
    duration: 12,
    limit: 2.5 * MB,
    scene: "fresh",
    storage: {},
    delays: { "/modelflare": 900 },
    async run(R) {
      await R.stage("init", { background: "wallpaper" });
      await R.stage("explorer.show", { x: 300, y: 190, w: 980, h: 560 }, { name: "anymodel-bot-0.1.13-win-x64.exe", date: "2026-10-31 15:42", size: "187 MB" });
      await R.place(1000, 820);
      await sleep(500);
      R.start();
      await R.until(0.3);
      await R.click(R.s$("#exe"), { dur: 0.8, pause: 0.3, double: true, label: "双击安装包" });
      await sleep(260);
      await R.stage("installer.show", { x: 640, y: 290, w: 640, h: 470 });
      R.mark("安装向导");
      await R.until(2.2);
      await R.click(R.s$("#ins-next"), { dur: 0.7, pause: 0.3, label: "下一步" });
      await R.stage("installer.page", 2);
      await R.until(3.4);
      await R.click(R.s$("#ins-next"), { dur: 0.6, pause: 0.5, label: "安装" });
      await R.stage("installer.page", 3);
      await R.stage("installer.progress", 2500);
      await R.stage("installer.page", 4);
      await R.until(6.8);
      await R.click(R.s$("#ins-next"), { dur: 0.6, pause: 0.5, label: "完成" });
      await R.stage("installer.close");
      await R.move({ x: 1040, y: 1000 }, { dur: 0.8 });
      await R.openApp({ src: "/", rect: { x: 360, y: 148, w: 1200, h: 820 }, title: true, enter: true });
      R.mark("应用启动");
      const login = await R.wait(".login-cta .btn.primary");
      R.mark("欢迎页");
      await R.until(10.0);
      await R.move(login, { dur: 0.8 });
      R.mark("停在登录按钮");
    },
  }),

  gif("agent-files", "features/agent-files.gif", {
    duration: 15,
    async run(R) {
      const ta = await openChat(R);
      await R.place(700, 520);
      await R.click(ta, { dur: 0.7, pause: 0.2 });
      await sleep(600);
      R.start();
      await R.until(0.2);
      await R.type(P.tidyFiles, { dur: 3.0 });
      await R.press("Enter");
      const tog = await R.wait("button.work-line.toggle.live");
      await R.click(tog, { dur: 0.6, pause: 0.3, label: "展开活动列表" });
      await allow(R, { pause: 0.5, dur: 0.7 });
      await R.move({ x: 860, y: 600 }, { dur: 0.8 });
      await R.wait(".file-card");
      R.mark("文件卡片");
    },
  }),

  gif("computer-use", "features/computer-use.gif", {
    viewport: [1800, 1012],
    size: [960, 540],
    duration: 18,
    sceneOpts: { cuApproval: "ask-input" },
    async run(R) {
      ctx.R = R;
      await R.stage("init", { background: "wallpaper" });
      await R.stage("icon", "ic-demo", "folder", "demo-files", 1660, 700);
      const ta = await openChat(R, { x: 24, y: 70, w: 1200, h: 820 }, true);
      await R.place(760, 600);
      await R.click(ta, { dur: 0.7, pause: 0.2 });
      await sleep(600);
      R.start();
      await R.until(0.15);
      await R.type(P.notepad, { dur: 2.7 });
      await R.press("Enter");
      for (let i = 0; i < 3; i++) await allow(R, { pause: 0.35 });
      await R.move({ x: 900, y: 560 }, { dur: 0.8 });
      await lastReply(R, "已保存");
      R.mark("回复已保存");
    },
  }),

  gif("media-generation", "features/media-generation.gif", {
    duration: 14,
    needsIllustration: true,
    async run(R) {
      const ta = await openChat(R);
      await R.place(700, 520);
      await R.click(ta, { dur: 0.7, pause: 0.2 });
      await sleep(600);
      R.start();
      await R.until(0.2);
      await R.type(P.draw, { dur: 2.6 });
      await R.press("Enter");
      const opts = R.$(".card:not(.done) .opt");
      await R.wait(opts);
      R.mark("确认卡片");
      await R.move(opts.nth(1), { dur: 0.7, at: [0.3, 0.5] });
      R.mark("指向换模型的选项");
      await sleep(1000);
      await R.click(opts.nth(0), { dur: 0.6, pause: 0.3, at: [0.3, 0.5], label: "确认默认模型" });
      await R.move({ x: 700, y: 640 }, { dur: 0.8 });
      await R.wait(".file-card");
      R.mark("文件卡片");
      await sleep(500);
      await R.stage("viewer.show", { x: 742, y: 96, w: 430, h: 470 }, { src: "/__gen/sleepy-bot.png", name: "sleepy-bot.png", info: "1024 × 1024 · PNG" });
      R.mark("看图窗口（示意）");
    },
  }),

  gif("first-run", "features/first-run.gif", {
    duration: 16,
    scene: "fresh",
    storage: {},
    async run(R) {
      await R.openApp({ src: "/", rect: APP });
      const login = await R.wait(".login-cta .btn.primary");
      await R.place(620, 300);
      await sleep(500);
      R.start();
      await R.until(0.6);
      const started = R.once("login-started");
      await R.click(login, { dur: 0.8, pause: 0.35, label: "登录 / 注册 Modelflare" });
      await started;
      await sleep(950);
      await R.stage("browser.show", APP, { loading: 400 });
      R.mark("浏览器授权页");
      await R.until(4.6);
      await R.click(R.s$("#auth-ok"), { dur: 0.8, pause: 0.35, label: "继续（授权）" });
      R.mock.authorize();
      await R.stage("browser.done");
      await sleep(900);
      await R.stage("browser.hide");
      R.mark("回到应用");
      const row = await R.wait(R.$(".picklist button[role=option]").filter({ hasText: "claude-sonnet-5-5" }));
      R.mark("模型列表");
      await R.until(Math.max(R.t(), 7.6));
      await R.click(row, { dur: 0.7, pause: 0.3, label: "选默认模型" });
      await R.click(R.$(".onboard button").filter({ hasText: "开始对话" }), { dur: 0.7, pause: 0.3, label: "开始对话" });
      const ta = await R.wait(".composer textarea");
      R.mark("对话页");
      await R.click(ta, { dur: 0.7, pause: 0.2 });
      await R.type(P.hello, { dur: 1.3 });
      await R.press("Enter");
      await R.move({ x: 860, y: 600 }, { dur: 0.8 });
      await lastReply(R, "你好！我是");
      R.mark("回复");
    },
  }),

  gif("model-switch", "features/model-switch.gif", {
    duration: 12,
    async run(R) {
      await openChat(R);
      await R.place(760, 380);
      await sleep(600);
      R.start();
      await R.until(0.6);
      await R.click(".composer .model-chip:not(.perm)", { dur: 0.65, pause: 0.3, label: "模型按钮" });
      const input = await R.wait(".model-picker .search input");
      await R.until(1.9);
      await R.type("claude", { dur: 0.8 });
      // 筛选后是 4 个 Claude 模型，外加一行「使用「claude」」（输入的不是现成的模型 ID 时界面会给这一行）
      await R.waitFn(() => [...document.querySelectorAll(".model-picker li[role=option]")].filter((li) => li.textContent.startsWith("claude-")).length === 4);
      const row = (id) => R.$(".model-picker li[role=option]").filter({ hasText: id });
      await R.until(3.8);
      await R.move(row("claude-opus-5-5"), { dur: 0.7, at: [0.35, 0.5] });
      R.mark("悬停 claude-opus-5-5");
      await sleep(1000);
      await R.move(row("claude-opus-4-8"), { dur: 0.7, at: [0.35, 0.5] });
      R.mark("悬停 claude-opus-4-8");
      await sleep(1000);
      await R.click(row("claude-opus-5-5"), { dur: 0.6, pause: 0.3, at: [0.35, 0.5], label: "选 claude-opus-5-5" });
      await R.waitFn(() => /claude-opus-5-5/.test(document.querySelector(".composer .model-chip:not(.perm)").textContent));
      R.mark("按钮已更新");
      await R.click(".composer textarea", { dur: 0.65, pause: 0.2 });
      await R.type(P.whichModel, { dur: 0.9 });
      await R.press("Enter");
      await lastReply(R, "我现在用的是");
      R.mark("回复");
      void input;
    },
  }),

  gif("memory", "features/memory.gif", {
    duration: 16,
    sceneOpts: { memory: D.MEMORY_PREFS.slice(0, 3) },
    async run(R) {
      const ta = await openChat(R);
      await R.place(700, 520);
      await R.click(ta, { dur: 0.7, pause: 0.2 });
      await sleep(600);
      R.start();
      await R.until(0.2);
      await R.type(P.remember, { dur: 2.0 });
      await R.press("Enter");
      await lastReply(R, "记住了");
      R.mark("机器人确认");
      await R.until(Math.max(R.t() + 0.2, 4.0));
      await R.click('.chat-head button[aria-label^="信息面板"]', { dur: 0.7, pause: 0.3, label: "信息面板" });
      await R.waitFn(() => [...document.querySelectorAll(".panel .row.compact .selectable")].some((e) => e.textContent.includes("周报用中文")));
      const entry = R.$(".panel .row.compact").filter({ hasText: "周报用中文" });
      await R.move(entry, { dur: 0.7, at: [0.45, 0.5] });
      R.mark("指着新记忆");
      await sleep(1100);
      await R.click('.chat-head button[aria-label^="开始新的一段对话"]', { dur: 0.7, pause: 0.3, label: "新对话" });
      await lastReply(R, "已开始新的一段对话");
      R.mark("新对话");
      await R.click(".composer textarea", { dur: 0.7, pause: 0.2 });
      await R.type(P.weekly, { dur: 1.2 });
      await R.press("Enter");
      await lastReply(R, "本周进展顺利");
      R.mark("回复");
    },
  }),

  gif("channels-wechat", "features/channels-wechat.gif", {
    viewport: [1600, 900],
    size: [960, 540],
    duration: 18,
    sceneOpts: { weixinBound: false, extraConvs: false, memory: D.MEMORY_PREFS.slice(0, 2) },
    async weixin(t, botId, text) {
      await scripts[text](t, botId, text);
    },
    async run(R) {
      ctx.R = R;
      await R.stage("init", { background: "black" });
      const rect = { x: 0, y: 40, w: 1200, h: 820 };
      await openChat(R, rect);
      await R.stage("phone.show", { x: 1200, y: 0, w: 400, h: 900 }, { title: "小黄", clock: hhmm() });
      // 录制开始前：信息面板 → 管理聊天渠道 → 微信「添加账号」→ 扫码登录，二维码出来
      await R.place(760, 300);
      await R.click('.chat-head button[aria-label^="信息面板"]', { dur: 0.6, pause: 0.2 });
      // 面板和弹窗都有进场动画，等它们停稳再取坐标，否则鼠标点到旧位置
      await R.wait('.panel [data-guide="weixin"]');
      await sleep(600);
      await R.click('.panel [data-guide="weixin"]', { dur: 0.6, pause: 0.2 });
      await R.wait("#set-add-channel-weixin");
      await sleep(500);
      await R.click("#set-add-channel-weixin button", { dur: 0.6, pause: 0.2 });
      await R.wait(".sheet .btn.primary");
      await sleep(500);
      await R.click(R.$(".sheet .btn.primary").filter({ hasText: "扫码登录" }), { dur: 0.6, pause: 0.2 });
      await R.wait(".sheet .panel-qr");
      await R.move(".sheet .panel-qr", { dur: 0.7, at: [0.5, 1.15] });
      await sleep(700);
      R.start();
      await R.until(2.0);
      R.mock.weixinConfirm("acct_demo");
      // 账号连上：弹窗换成账号管理（别名、默认机器人）
      await R.waitFn(() => [...document.querySelectorAll(".sheet .set-field")].some((f) => f.textContent.includes("默认机器人")));
      R.mark("微信已连接");
      // 手机上发消息
      const inp = await R.s$("#ph-in").boundingBox();
      await R.until(3.4);
      await R.stage("tap", inp.x + 80, inp.y + inp.height / 2);
      await sleep(200);
      await R.stage("phone.type", P.wxIntro, 1900);
      const send = await R.s$("#ph-send").boundingBox();
      await sleep(300);
      await R.stage("tap", send.x + send.width / 2, send.y + send.height / 2);
      await sleep(120);
      await R.stage("phone.send");
      R.mark("手机发出");
      ctx.wxDelay = 1700;
      const reply = R.mock.weixinInbound(Y, D.WEIXIN_USER, P.wxIntro);
      await sleep(500);
      await R.stage("phone.typing");
      const text = await reply;
      await R.stage("phone.add", "bot", text);
      R.mark("手机收到回复");
      // 回到对话页：信息面板打开时就取最近会话，微信这段对话已经在了
      await sleep(500);
      await R.press("Escape");
      await sleep(250);
      await R.click(".side-back", { dur: 0.6, pause: 0.2, label: "返回应用" });
      await R.wait(".chat-col .msg-row");
      if (!(await R.$(".panel").count())) await R.click('.chat-head button[aria-label^="信息面板"]', { dur: 0.5, pause: 0.2 });
      const row = R.$(".panel .row.compact.clickable").filter({ hasText: "微信 ·" });
      await R.wait(row);
      await sleep(500);
      R.mark("最近会话出现微信会话");
      await R.click(row, { dur: 0.7, pause: 0.3, label: "打开微信会话" });
      await R.waitFn(() => document.querySelectorAll(".sheet .transcript-msg").length >= 2);
      R.mark("桌面端显示同一段对话");
    },
  }),
];
