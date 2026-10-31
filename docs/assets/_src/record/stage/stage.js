// 录制舞台：record.mjs 用 page.evaluate 调这里的 window.stage.*，按脚本的时间点摆出各个窗口。
// 真实的应用界面在 iframe（同源）里；其余窗口都是风格化示意。假鼠标由 __cursor() 驱动：
// record.mjs 在每个 frame 注入的脚本把 mousemove / mousedown / mouseup 换算成舞台坐标后转给它。
(() => {
  const screen = document.getElementById("screen");
  const cursor = document.getElementById("cursor");
  const touch = document.getElementById("touch");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const APP_ICON = "/__repo-assets/icon.png";
  const WB = `<span class="wb"><svg viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2"/></svg></span>
    <span class="wb"><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>
    <span class="wb"><svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2"/></svg></span>`;
  const titlebar = (title, icon = "") => `<div class="titlebar">${icon ? `<img src="${icon}" alt="">` : ""}<span class="t">${title}</span>${WB}</div>`;
  const place = (node, r) => Object.assign(node.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });

  // —— 假鼠标 ——
  let down = false;
  window.__cursor = (type, x, y) => {
    cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
    cursor.classList.add("on");
    if (type === "mousedown") {
      down = true;
      cursor.classList.add("down");
      cursor.classList.remove("click");
      void cursor.offsetWidth;
      cursor.classList.add("click");
    } else if (type === "mouseup" && down) {
      down = false;
      cursor.classList.remove("down");
    }
  };

  const stage = {
    sleep,
    /** 背景：wallpaper（桌面）| black（黑底，G9 左侧留边）| none */
    init({ background = "none" } = {}) {
      screen.innerHTML = "";
      if (background === "wallpaper") screen.append(el(`<div class="wallpaper"></div>`));
      if (background === "black") screen.append(el(`<div class="blackout"></div>`));
    },
    hideCursor: () => cursor.classList.remove("on"),
    /** 手机上的点按反馈 */
    tap(x, y) {
      Object.assign(touch.style, { left: x + "px", top: y + "px" });
      touch.classList.remove("tap");
      void touch.offsetWidth;
      touch.classList.add("tap");
    },

    /** 应用窗口：rect 是内容区（iframe）的位置和大小；title 时上面加一条 34px 的示意标题栏 */
    async openApp({ src = "/", rect, title = false, enter = false }) {
      const h = rect.h + (title ? 34 : 0);
      const w = el(`<div class="win app-win${title ? "" : " plain"}${enter ? " enter" : ""}" id="app-win">${title ? titlebar("AnyModelBot", APP_ICON) : ""}<div class="win-body"></div></div>`);
      place(w, { x: rect.x, y: rect.y - (title ? 34 : 0), w: rect.w, h });
      const f = document.createElement("iframe");
      f.id = "app";
      f.name = "app";
      Object.assign(f, { width: rect.w, height: rect.h });
      Object.assign(f.style, { width: rect.w + "px", height: rect.h + "px" });
      w.querySelector(".win-body").append(f);
      screen.append(w);
      await new Promise((r) => {
        f.onload = r;
        f.src = src;
      });
    },

    // —— 浏览器里的 Modelflare 授权页（G1、G6）——
    browser: {
      show(rect, { loading = 0 } = {}) {
        const b = el(`<div class="win browser enter" id="browser">
          <div class="tabs"><div class="tab"><i></i>授权 AnyModelBot</div></div>
          <div class="bar"><span class="nav">‹ › ↻</span><div class="addr"><svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="6" width="10" height="7" rx="1.5" fill="#9a9a95"/><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="#9a9a95" stroke-width="1.6"/></svg><span><b>modelflare.dev</b>/oauth/authorize?client_id=anymodelbot&amp;response_type=code</span></div></div>
          <div class="page${loading ? " loading" : ""}">
            <div class="auth-card">
              <div class="marks"><img src="/__docs/brand/logo-eyes.svg" alt=""><span class="dots">• • •</span><span class="mf">M</span></div>
              <h1>AnyModelBot 想连接你的 Modelflare 账户</h1>
              <div class="who">登录身份：演示账户</div>
              <ul><li>读取账户名称和钱包余额</li><li>为这台电脑签发一把 API Key</li><li>可以随时在 Modelflare 网页上撤销</li></ul>
              <div class="btns"><button class="btn-s primary" id="auth-ok">继续</button><button class="btn-s ghost">取消</button></div>
            </div>
            <div class="auth-done"><div class="ok"><svg width="26" height="26" viewBox="0 0 26 26"><path d="M6 13.5l4.5 4.5L20 8" fill="none" stroke="#d7ff00" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
              <h2>已连接</h2><p>可以回到 AnyModelBot 了，这个页面可以关掉。</p></div>
          </div></div>`);
        place(b, rect);
        screen.append(b);
        if (loading) setTimeout(() => b.querySelector(".page").classList.remove("loading"), loading);
      },
      done: () => document.getElementById("browser")?.classList.add("done"),
      async hide() {
        const b = document.getElementById("browser");
        if (!b) return;
        b.classList.add("leave");
        await sleep(190);
        b.remove();
      },
    },

    // —— 下载文件夹（G2）——
    explorer: {
      show(rect, file) {
        const w = el(`<div class="win explorer" id="explorer">${titlebar("下载")}
          <div class="tool"><span>‹ ›</span><div class="crumb">此电脑 › 下载</div></div>
          <div class="body"><nav><div><i></i>桌面</div><div class="on"><i></i>下载</div><div><i></i>文档</div><div><i></i>图片</div></nav>
            <div class="list"><div class="head"><span>名称</span><span>修改日期</span><span>类型</span><span>大小</span></div>
              <div class="item" id="exe"><span class="n"><img src="${APP_ICON}" alt="">${file.name}</span><span>${file.date}</span><span>应用程序</span><span>${file.size}</span></div>
            </div></div></div>`);
        place(w, rect);
        screen.append(w);
      },
      select: () => document.getElementById("exe")?.classList.add("sel"),
    },

    // —— 安装向导（G2）：选项 → 位置 → 进度 → 完成 ——
    installer: {
      show(rect) {
        const w = el(`<div class="win installer enter" id="installer">${titlebar("anymodel bot 安装")}
          <div class="head"><div><b id="ins-title">安装选项</b><span id="ins-sub">为这台电脑上的哪些用户安装？</span></div><img src="${APP_ICON}" alt=""></div>
          <div class="pg on" data-p="1"><div>请选择要为哪些用户安装 anymodel bot：</div>
            <div class="radio"><i></i>为使用这台电脑的任何人安装</div><div class="radio on"><i></i>仅为我安装（demo）</div>
            <div class="hint">仅为你安装时不需要管理员权限。</div></div>
          <div class="pg" data-p="2"><div>安装程序会把 anymodel bot 安装到下面的文件夹。</div>
            <div class="path"><div>C:\\Users\\demo\\AppData\\Local\\Programs\\anymodel bot</div><span>浏览…</span></div>
            <div class="hint">所需空间：612 MB</div></div>
          <div class="pg" data-p="3"><div>正在安装，请稍候…</div><div class="prog"><i id="ins-bar"></i></div><div class="file" id="ins-file">解压：resources\\app.asar</div></div>
          <div class="pg" data-p="4"><div>anymodel bot 已经安装到你的电脑上。</div><div class="check"><i><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2l2 2L8 3" fill="none" stroke="#161a00" stroke-width="1.8"/></svg></i>运行 anymodel bot</div></div>
          <div class="foot"><span class="b dis" id="ins-back">上一步</span><span class="b primary" id="ins-next">下一步</span><span class="b" id="ins-cancel">取消</span></div></div>`);
        place(w, rect);
        screen.append(w);
      },
      page(n) {
        const w = document.getElementById("installer");
        w.querySelectorAll(".pg").forEach((p) => p.classList.toggle("on", p.dataset.p === String(n)));
        const T = { 1: ["安装选项", "为这台电脑上的哪些用户安装？"], 2: ["选择安装位置", "选择 anymodel bot 的安装文件夹。"], 3: ["正在安装", "正在安装 anymodel bot。"], 4: ["安装完成", "anymodel bot 已安装完成。"] }[n];
        w.querySelector("#ins-title").textContent = T[0];
        w.querySelector("#ins-sub").textContent = T[1];
        const next = w.querySelector("#ins-next");
        next.textContent = { 1: "下一步", 2: "安装", 3: "下一步", 4: "完成" }[n];
        next.classList.toggle("dis", n === 3);
        next.classList.toggle("primary", n !== 3);
        w.querySelector("#ins-back").classList.toggle("dis", n !== 2);
        w.querySelector("#ins-cancel").classList.toggle("dis", n >= 3);
      },
      /** 进度条在 ms 毫秒内走完，下面滚动显示正在解压的文件 */
      async progress(ms) {
        const bar = document.getElementById("ins-bar");
        const file = document.getElementById("ins-file");
        const files = ["resources\\app.asar", "resources\\dsh\\dsh.asar", "resources\\bin\\magpie.exe", "resources\\cua-driver\\cua-driver.exe", "locales\\zh-CN.pak", "anymodel bot.exe", "Uninstall anymodel bot.exe"];
        const t0 = performance.now();
        for (;;) {
          const k = Math.min(1, (performance.now() - t0) / ms);
          bar.style.width = (100 * (1 - Math.pow(1 - k, 1.6))).toFixed(1) + "%";
          file.textContent = "解压：" + files[Math.min(files.length - 1, Math.floor(k * files.length))];
          if (k >= 1) break;
          await sleep(30);
        }
      },
      async close() {
        const w = document.getElementById("installer");
        w.classList.add("leave");
        await sleep(190);
        w.remove();
      },
    },

    // —— 桌面图标（G4）——
    icon(id, kind, label, x, y, enter = false) {
      const i = el(`<div class="icon${enter ? " enter" : ""}" id="${id}"><div class="${kind}"></div><span>${label}</span></div>`);
      Object.assign(i.style, { left: x + "px", top: y + "px" });
      screen.append(i);
    },

    // —— 文本编辑器（G4）：打开、逐字输入、另存为 ——
    notepad: {
      open(rect) {
        const w = el(`<div class="win notepad enter" id="notepad">${titlebar("无标题 - 记事本")}
          <div class="menu"><span>文件</span><span>编辑</span><span>格式</span><span>查看</span></div>
          <div class="text"><span id="np-text"></span><i class="caret"></i></div>
          <div class="status"><span id="np-pos">第 1 行，第 1 列</span><span>100%</span><span>UTF-8</span></div></div>`);
        place(w, rect);
        screen.append(w);
      },
      async type(text, ms) {
        const t = document.getElementById("np-text");
        const pos = document.getElementById("np-pos");
        const step = ms / text.length;
        for (const ch of text) {
          t.textContent += ch;
          pos.textContent = `第 1 行，第 ${t.textContent.length + 1} 列`;
          await sleep(step * (0.7 + Math.random() * 0.6));
        }
      },
      /** 另存为：弹出对话框，逐字填文件名，确认后标题变成 name */
      async saveAs(folder, name, ms) {
        const w = document.getElementById("notepad");
        const d = el(`<div class="dlg"><div class="dh">另存为</div><div class="db">
          <div class="row2"><span>保存位置</span><div class="fld">${folder}</div></div>
          <div class="row2"><span>文件名</span><div class="fld" id="np-name"></div></div>
          <div class="row2"><span>编码</span><div class="fld">UTF-8</div></div></div>
          <div class="df"><span class="primary">保存</span><span>取消</span></div></div>`);
        w.append(d);
        await sleep(ms * 0.25);
        const f = d.querySelector("#np-name");
        for (const ch of name) {
          f.textContent += ch;
          await sleep((ms * 0.5) / name.length);
        }
        await sleep(ms * 0.25);
        d.remove();
        w.querySelector(".titlebar .t").textContent = `${name} - 记事本`;
      },
    },

    // —— 看图窗口（G5，示意）——
    viewer: {
      show(rect, { src, name, info }) {
        const w = el(`<div class="win viewer enter" id="viewer">${titlebar(name)}<div class="img"><img src="${src}" alt=""></div><div class="vbar"><span>${info}</span><span>100%</span></div></div>`);
        place(w, rect);
        screen.append(w);
      },
    },

    // —— 手机聊天（G9，示意）——
    phone: {
      show(rect, { title, clock }) {
        const a = el(`<div class="phone-area" id="phone-area"><div class="phone"><div class="scr">
          <div class="sb"><span>${clock}</span><span class="ic"><i style="width:17px;height:10px"></i><i style="width:24px;height:11px;border-radius:3px"></i></span></div>
          <div class="hd"><span class="back"></span><b>${title}</b></div>
          <div class="msgs" id="ph-msgs"><div class="stamp">${clock}</div></div>
          <div class="in"><div class="f ph" id="ph-in">发消息</div><div class="send" id="ph-send">发送</div></div>
          <div class="hb"></div></div></div></div>`);
        place(a, rect);
        screen.append(a);
      },
      async type(text, ms) {
        const f = document.getElementById("ph-in");
        f.classList.remove("ph");
        f.innerHTML = `<span></span><i class="caret"></i>`;
        const s = f.firstChild;
        for (const ch of text) {
          s.textContent += ch;
          await sleep((ms / text.length) * (0.7 + Math.random() * 0.6));
        }
        document.getElementById("ph-send").classList.add("on");
      },
      send() {
        const f = document.getElementById("ph-in");
        const text = f.textContent;
        f.className = "f ph";
        f.textContent = "发消息";
        document.getElementById("ph-send").classList.remove("on");
        stage.phone.add("me", text);
      },
      add(who, text) {
        document.getElementById("ph-typing")?.remove();
        const m = el(`<div class="m ${who}"><span class="av"></span><div class="bb"></div></div>`);
        m.querySelector(".bb").textContent = text;
        document.getElementById("ph-msgs").append(m);
      },
      /** 机器人正在输入（微信渠道会发"正在输入"状态） */
      typing() {
        if (!document.getElementById("ph-typing")) document.getElementById("ph-msgs").append(el(`<div class="typing" id="ph-typing"><i></i><i></i><i></i></div>`));
      },
    },
  };
  window.stage = stage;
})();
