// 首页各章节的交互。HTML 默认是完成态（无 JS / 减少动态效果时直接可读），这里只负责"播放"和切换。
import { gazeAt, mountDoze, playShot, setState } from "../lib/eyes";
import { mountLoop, mountTour } from "./tour";
import { mountScrollFx } from "./scroll-fx";

// —— 桌面端的滚动联动、跑马灯离屏暂停，见 scroll-fx.ts ——
mountScrollFx();

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const track = (n: string, p?: object) => { try { (window as any).umami?.track(n, p); } catch { /* 忽略 */ } };

// —— 数据去向图：桌面上是节点旁的浮层，手机上是底部抽屉 ——
(() => {
  const nodes = $$<HTMLButtonElement>(".flow-node");
  if (!nodes.length) return;
  const mobile = matchMedia("(max-width: 767px)");
  const sheet = document.getElementById("flow-sheet") as HTMLDialogElement | null;
  const closeAll = (except?: HTMLElement) => nodes.forEach((b) => {
    if (b === except) return;
    b.setAttribute("aria-expanded", "false");
    const body = document.getElementById(b.getAttribute("aria-controls")!); if (body) body.hidden = true;
  });
  nodes.forEach((b) => b.addEventListener("click", () => {
    const body = document.getElementById(b.getAttribute("aria-controls")!)!;
    track("flow_node_open", { node_id: b.dataset.node });
    if (mobile.matches && sheet) {
      closeAll();
      $("[data-flow-sheet-title]", sheet)!.textContent = b.dataset.title ?? "";
      $("[data-flow-sheet-body]", sheet)!.innerHTML = body.innerHTML;
      sheet.showModal();
      return;
    }
    const open = b.getAttribute("aria-expanded") !== "true";
    closeAll(b);
    b.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  }));
  document.addEventListener("click", (e) => { if (!(e.target as Element).closest(".flow__nodes li")) closeAll(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = nodes.find((b) => b.getAttribute("aria-expanded") === "true");
    if (open) { closeAll(); open.focus(); }
  });
})();

// —— 模型演示：场景切换 + 模型选择器（预录，不实时调用） ——
(() => {
  const root = $("[data-model-demo]");
  if (!root) return;
  const data = JSON.parse($("[data-model-demo-data]", root)!.textContent!) as {
    prices: Record<string, [string, string]>; logos: Record<string, string>; priceLine: string;
    scenarios: Record<string, { model: string; q: string; a: string }>;
  };
  const pill = $<HTMLButtonElement>("[data-model-pill]", root)!;
  const list = $("[data-model-list]", root)!;
  const search = $<HTMLInputElement>("[data-model-search]", root)!;
  const opts = $$("[role=option]", root);
  const q = $("[data-q]", root)!, a = $("[data-a]", root)!;
  let scenario = "copy", model = data.scenarios.copy.model, active = -1, turn = 0;
  const logo = root.querySelector<SVGSVGElement>("[data-model-logo]");
  const setModel = (m: string) => {
    model = m;
    $("[data-model-name]", root)!.textContent = m;
    // 胶囊里的厂商标志跟着换；这家没有标志就藏起来
    if (logo) { const k = data.logos[m]; logo.style.display = k ? "" : "none"; if (k) logo.querySelector("use")?.setAttribute("href", `#vl-${k}`); }
    const [i, o] = data.prices[m] ?? ["—", "—"];
    $("[data-price-line]", root)!.textContent = data.priceLine.replace("{model}", m).replace("{input}", i).replace("{output}", o);
    opts.forEach((x) => x.setAttribute("aria-selected", String(x.dataset.model === m)));
  };
  // 晶晶先歪头想一会儿（宝石浮起来转），再一边读一边打字，打完蹦一下；连续切换时上一段直接作废
  const face = $<HTMLElement>(".msg--bot .bot-face", root);
  const answer = async () => {
    const s = data.scenarios[scenario], me = ++turn;
    track("model_demo_use", { scenario, model_id: model });
    q.textContent = s.q;
    if (reduce) { a.textContent = s.a; return; }
    a.textContent = ""; a.classList.add("is-typing");
    if (face) setState(face, "thinking");
    await wait(720);
    if (me !== turn) return;
    if (face) setState(face, "replying");
    for (let i = 1; i <= s.a.length; i++) {
      if (me !== turn) return;
      a.textContent = s.a.slice(0, i);
      await wait(1000 / 60);
    }
    a.classList.remove("is-typing");
    if (face) { setState(face, "idle"); playShot(face, "done"); }
  };
  const close = (focus = true) => { list.hidden = true; pill.setAttribute("aria-expanded", "false"); if (focus) pill.focus(); };
  const visible = () => opts.filter((o) => !o.hidden);
  const setActive = (i: number) => {
    const v = visible(); if (!v.length) return;
    active = (i + v.length) % v.length;
    v.forEach((o, k) => o.classList.toggle("is-active", k === active));
    v[active].scrollIntoView({ block: "nearest" });
    search.setAttribute("aria-activedescendant", v[active].id);
  };
  $$("[data-scenario]", root).forEach((b) => b.addEventListener("click", () => {
    $$("[data-scenario]", root).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    scenario = b.dataset.scenario!;
    setModel(data.scenarios[scenario].model);
    answer();
  }));
  pill.addEventListener("click", () => {
    const open = list.hidden;
    list.hidden = !open; pill.setAttribute("aria-expanded", String(open));
    if (open) { search.value = ""; opts.forEach((o) => (o.hidden = false)); $$(".model-list__group", root).forEach((g) => (g.hidden = false)); search.focus(); setActive(opts.findIndex((o) => o.dataset.model === model)); }
  });
  search.addEventListener("input", () => {
    const s = search.value.trim().toLowerCase();
    opts.forEach((o) => (o.hidden = !!s && !o.dataset.model!.toLowerCase().includes(s)));
    $$(".model-list__group", root).forEach((g) => {
      let n = g.nextElementSibling as HTMLElement | null, any = false;
      while (n && !n.classList.contains("model-list__group")) { if (!n.hidden) any = true; n = n.nextElementSibling as HTMLElement | null; }
      g.hidden = !any;
    });
    setActive(0);
  });
  const choose = (o: HTMLElement) => { setModel(o.dataset.model!); close(); answer(); };
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = visible()[active]; if (o) choose(o); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  opts.forEach((o) => o.addEventListener("click", () => choose(o)));
  document.addEventListener("click", (e) => { if (!list.hidden && !(e.target as Element).closest("[data-model-list], [data-model-pill]")) close(false); });
})();

// —— 能动手、会记住：两章故事。视口正中那条窄带碰到哪一章，右边吸顶的舞台卡就换到哪一幕、底光换成那一章的颜色 ——
(() => {
  const story = $("[data-story]");
  if (!story) return;
  const chs = $$("[data-ch]", story);
  const scenes = $$("[data-scene]", story);
  const tabs = $$<HTMLButtonElement>("[data-goto-ch]", story);
  const stage = $("[data-story-stage]", story);
  let cur = -1;
  const set = (i: number) => {
    if (i === cur || i < 0) return;
    cur = i;
    chs.forEach((c, k) => c.classList.toggle("is-on", k === i));
    scenes.forEach((sc, k) => { sc.classList.toggle("is-on", k === i); sc.classList.toggle("is-past", k < i); });
    tabs.forEach((b, k) => b.classList.toggle("is-on", k === i));
    stage?.style.setProperty("--stage-glow", chs[i].style.getPropertyValue("--tint"));
  };
  set(0);
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) set(chs.indexOf(e.target as HTMLElement)); }), { rootMargin: "-45% 0px -45% 0px" });
  chs.forEach((c) => io.observe(c));
  tabs.forEach((b) => b.addEventListener("click", () => chs[Number(b.dataset.gotoCh)]?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" })));
})();

// —— 换脑舞台：外环上亮起右边对话正在用的模型；点外环上的模型 = 在右边列表里选它；换模型时中间的晶晶点个头 ——
(() => {
  const orbit = $("[data-orbit]");
  const demo = $("[data-model-demo]");
  const name = demo && $("[data-model-name]", demo);
  if (!orbit || !demo || !name) return;
  const chips = $$("[data-orbit-model]", orbit);
  const core = $<HTMLElement>(".orbit__core .bot-face", orbit);
  let last = "";
  const sync = () => {
    const m = name.textContent?.trim() ?? "";
    if (m === last) return;
    const first = !last; last = m;
    chips.forEach((c) => c.classList.toggle("is-on", c.dataset.orbitModel === m));
    if (core && !first) playShot(core, "poke");
  };
  sync();
  new MutationObserver(sync).observe(name, { childList: true, characterData: true, subtree: true });
  chips.forEach((c) => c.addEventListener("click", () => $$("[role=option]", demo).find((o) => o.dataset.model === c.dataset.orbitModel)?.click()));
})();

// —— 由你定义：人设是 WAI-ARIA tabs，角色是单选，两根轴互不相干 ——
// 换人设：名牌绕竖轴翻面、挂绳晃一下，人设逐字写出来，手机里再按这段人设回话；脸和名字不变。
// 换角色：名牌上、手机里的脸和名字一起换，打个招呼，其余几张脸转头看它；人设一个字不动。
// 鼠标拨过名牌它会晃（阻尼弹簧，转轴在挂绳顶端，写 --swing）。窄屏上一排人设可横滑，选中的滚到中间；舞台上左右滑动也能换人设。
(() => {
  const tabs = $$<HTMLButtonElement>("[data-persona-tabs] [role=tab]");
  const crew = $("[data-crew]");
  if (!tabs.length || !crew) return;
  const list = tabs[0].parentElement!;
  const stage = $("[data-bot-stage]", crew);
  const hang = $("[data-badge]", crew);
  const card = $("[data-badge-card]", crew);
  const photo = $(".badge-card__photo", crew);
  const looks = $$<HTMLButtonElement>("[data-looks] [role=radio]", crew);
  const log = $(".phone__log", crew);
  const faceOf = (el: Element | null | undefined) => el?.querySelector<HTMLElement>(".bot-face") ?? null;
  const bigFace = (k: string) => faceOf($(`.badge-card__photo [data-for-look="${k}"]`, crew));

  // 名牌的摆：角度 a（度）、角速度 v（度/秒）；劲度 70、阻尼 5，|a| ≤ 7°
  let a = 0, v = 0, last = 0, raf = 0;
  const step = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    v += (-70 * a - 5 * v) * dt;
    a = Math.max(-7, Math.min(7, a + v * dt));
    if (Math.abs(a) < 0.02 && Math.abs(v) < 0.05) { a = v = 0; raf = 0; hang!.style.setProperty("--swing", "0deg"); return; }
    hang!.style.setProperty("--swing", `${a.toFixed(3)}deg`);
    raf = requestAnimationFrame(step);
  };
  const kick = (dv: number) => {
    if (reduce || !hang) return;
    v += dv;
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
  };
  if (hang && !reduce) {
    let lx = NaN;
    // 指针往右推，名牌下沿往右荡（CSS 里顺时针为正，所以取反）
    hang.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" && !Number.isNaN(lx)) kick(Math.max(-24, Math.min(24, (lx - e.clientX) * 0.9)));
      lx = e.clientX;
    });
    hang.addEventListener("pointerleave", () => (lx = NaN));
  }

  // 先写人设（总长约 0.9 秒），手机里显示"正在输入"的三个点，人设写完再逐字打出回答；连续切换时上一段直接补全
  let token = 0;
  const fullText = (el: HTMLElement) => el.dataset.text || (el.dataset.text = el.textContent ?? "");
  const settle = () => $$<HTMLElement>("[data-text]", crew).forEach((el) => { el.textContent = el.dataset.text!; el.classList.remove("is-typing"); });
  const typeOut = async (el: HTMLElement, ms: number, me: number) => {
    const text = fullText(el);
    for (let i = 1; i <= text.length; i++) {
      if (me !== token) return false;
      el.textContent = text.slice(0, i);
      await wait(ms);
    }
    el.classList.remove("is-typing");
    return me === token;
  };
  const write = async (p: string) => {
    const me = ++token;
    settle();
    if (reduce) return;
    const persona = $<HTMLElement>(`[data-panel="${p}"] [data-persona-text]`, crew);
    const reply = $<HTMLElement>(`.msg--bot[data-view="${p}"]`, crew);
    if (!persona || !reply) return;
    const words = fullText(persona).length;
    fullText(reply);
    persona.textContent = ""; persona.classList.add("is-typing");
    reply.textContent = ""; reply.classList.add("is-typing");
    if (!(await typeOut(persona, Math.max(8, Math.min(22, 900 / words)), me))) return;
    await wait(320);
    if (me === token) await typeOut(reply, 26, me);
  };

  let flip = 0;
  const select = (p: string, focus = false, quiet = false) => {
    const prev = crew.dataset.persona ?? p;
    tabs.forEach((t) => {
      const on = t.dataset.personaTab === p;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus({ preventScroll: true });
      if (on && list.scrollWidth > list.clientWidth) list.scrollTo({ left: t.offsetLeft - (list.clientWidth - t.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
    });
    crew.dataset.persona = p;

    // 名牌翻面：转到侧面（看不见的那一刻）换内容，再转回来。脸和名字不换：人设和角色无关
    const swap = () => {
      $$("[data-panel]", crew).forEach((el) => el.classList.toggle("is-off", el.dataset.panel !== p));
      $$("[data-view]", crew).forEach((el) => (el.hidden = el.dataset.view !== p));
      if (log && !reduce) { log.classList.remove("is-swap"); void log.offsetWidth; log.classList.add("is-swap"); }
      const f = bigFace(crew.dataset.char ?? "");
      if (f) playShot(f, "hello");
      write(p);
    };
    const me = ++flip;
    if (reduce || !card || prev === p) swap();
    else {
      card.classList.add("is-out");
      setTimeout(() => { if (me === flip) { swap(); card.classList.remove("is-out"); } }, 170);
      const order = tabs.map((t) => t.dataset.personaTab);
      kick((order.indexOf(p) > order.indexOf(prev) ? -1 : 1) * 46);
    }
    if (!quiet) track("persona_select", { persona_id: p });
  };

  // 选中的那张脸看大头像，其余几张转头看它
  const gazeLooks = (k: string) => {
    const sel = faceOf(looks.find((b) => b.dataset.look === k));
    looks.forEach((b) => { const f = faceOf(b); if (f) gazeAt(f, b.dataset.look === k ? photo : sel); });
  };
  const pick = (k: string, focus = false) => {
    looks.forEach((b) => {
      const on = b.dataset.look === k;
      b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus({ preventScroll: true });
    });
    crew.dataset.char = k;
    $$("[data-for-look]", crew).forEach((el) => (el.hidden = el.dataset.forLook !== k));
    $$("[data-look-id]", crew).forEach((el) => el.classList.toggle("is-off", el.dataset.lookId !== k));
    const f = bigFace(k);
    if (f) playShot(f, "hello");
    gazeLooks(k);
    track("look_select", { look_id: k });
  };

  const current = () => Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));

  // 第一次滚到名牌：打个招呼，把人设和回答写一遍（看名牌而不是整张舞台卡：窄屏上舞台卡比一屏高，永远到不了阈值）
  const intro = $(".crew__badge", crew);
  if (intro) {
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      gazeLooks(crew.dataset.char ?? "");
      select(tabs[current()].dataset.personaTab!, false, true);
    }, { threshold: 0.4 });
    io.observe(intro);
  }
  // 触屏横向滑过舞台换人设；纵向滚动交给浏览器（CSS 里 touch-action: pan-y）
  if (stage) {
    let x0 = 0, y0 = 0, id = -1;
    stage.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") { x0 = e.clientX; y0 = e.clientY; id = e.pointerId; } });
    stage.addEventListener("pointercancel", () => (id = -1));
    stage.addEventListener("pointerup", (e) => {
      if (e.pointerId !== id) return;
      id = -1;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      select(tabs[(current() + (dx < 0 ? 1 : -1) + tabs.length) % tabs.length].dataset.personaTab!);
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t.dataset.personaTab!));
    t.addEventListener("keydown", (e) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (k == null) return;
      e.preventDefault();
      select(tabs[(k + tabs.length) % tabs.length].dataset.personaTab!, true);
    });
  });
  looks.forEach((b, i) => {
    b.addEventListener("click", () => pick(b.dataset.look!));
    b.addEventListener("keydown", (e) => {
      const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1 }[e.key];
      if (k == null) return;
      e.preventDefault();
      pick(looks[(k + looks.length) % looks.length].dataset.look!, true);
    });
  });
})();

// —— 在哪都找得到它：入口行的"查看步骤"打开接入指南（client.ts 管开关对话框），这里切到对应的那一页；
//    指南顶上的一排标签是 tabs（← → / ↑ ↓ / Home / End 切换）。有 .hub__host 时它看向选中的标签、蹦一下（现在的版式里没有） ——
(() => {
  const hub = $("[data-hub]");
  if (!hub) return;
  const tabs = $$<HTMLButtonElement>("[data-hub-tab]", hub);
  const panels = $$("[data-hub-panel]", hub);
  const host = $<HTMLElement>(".hub__host", hub);
  let gt = 0;
  const select = (id: string, focus = false) => {
    tabs.forEach((b) => {
      const on = b.dataset.hubTab === id;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panels.forEach((p) => p.classList.toggle("is-on", p.dataset.hubPanel === id));
    const tab = tabs.find((b) => b.dataset.hubTab === id);
    if (host && tab) {
      gazeAt(host, tab); playShot(host, "poke");
      clearTimeout(gt); gt = window.setTimeout(() => gazeAt(host, null), 2200);
    }
    if (tab?.dataset.kind === "chat") track("channel_guide_open", { channel: id });
    else track("device_card_click", { device: id });
  };
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => { if (b.getAttribute("aria-selected") !== "true") select(b.dataset.hubTab!); });
    b.addEventListener("keydown", (e) => {
      const k = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
      if (k == null) return;
      e.preventDefault();
      select(tabs[(k + tabs.length) % tabs.length].dataset.hubTab!, true);
    });
  });
  // 入口行的链接：对话框在同一次点击里打开，等它显示出来再把焦点放到选中的标签上
  document.addEventListener("click", (e) => {
    const o = (e.target as Element).closest<HTMLElement>("[data-hub-open]");
    if (o?.dataset.hubOpen) { const id = o.dataset.hubOpen; requestAnimationFrame(() => select(id, true)); }
  });
})();

// —— FAQ 展开：旁边的闪闪看向刚打开的问题，点个头 ——
(() => {
  const bot = $<HTMLElement>(".faq-wrap__bot");
  let t = 0;
  $$<HTMLDetailsElement>("[data-faq]").forEach((d) => d.addEventListener("toggle", () => {
    if (!d.open) return;
    track("faq_open", { question_id: d.dataset.faq });
    if (!bot) return;
    gazeAt(bot, d.querySelector("summary"));
    playShot(bot, "poke");
    clearTimeout(t); t = window.setTimeout(() => gazeAt(bot, null), 2600);
  }));
})();

// —— 收尾横幅：指针移到下载按钮上，六个机器人一起看过去、挨个蹦一下；点下载就一起庆祝 ——
(() => {
  const cta = document.getElementById("cta-final");
  const bots = $$<HTMLElement>(".final__bots .bot-face");
  if (!cta || !bots.length) return;
  const zone = cta.closest(".split") ?? cta;
  zone.addEventListener("pointerenter", () => bots.forEach((b, i) => { gazeAt(b, cta); setTimeout(() => playShot(b, "poke"), i * 70); }));
  zone.addEventListener("pointerleave", () => bots.forEach((b) => gazeAt(b, null)));
  zone.addEventListener("click", () => bots.forEach((b, i) => setTimeout(() => playShot(b, "done"), i * 90)));
})();

// —— 章节头上的主持机器人：第一次完整进入视口时打个招呼 ——
(() => {
  const hosts = $$<HTMLElement>(".shead__host");
  if (!hosts.length || reduce) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    setTimeout(() => playShot(e.target as HTMLElement, "hello"), 200);
  }), { threshold: 1, rootMargin: "0px 0px -12% 0px" });
  hosts.forEach((h) => io.observe(h));
})();

// —— 演示导览与循环示意动画 ——
const tour = document.getElementById("demo-tour") as HTMLDialogElement | null;
if (tour) mountTour(tour);
$$("[data-loop]").forEach(mountLoop);

// —— 打瞌睡：[data-doze] 里的机器人，你半天不动就挨个睡着，一动就惊醒 ——
mountDoze();
