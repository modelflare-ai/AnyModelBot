// 页脚"眼睛田"（components/Footer.astro 的 [data-eyefield]）：AnyModelBot 字标由几百枚迷你 Eyes 标记拼成——一格一张小机器人脸。
// 讲的是产品本身：一群机器人（满屏的脸）、它们看着你（目光跟指针）、任意模型（每隔几秒一道波扫过，换个脑子就换个眼睛色，
// 角上显示真实的模型 ID）、发条消息就有回应（点一下，涟漪扫过的脸眯眼笑）、没人理就打瞌睡（指针一动从那里一圈圈醒过来）。
// 只在页脚进视口、标签页可见时跑；"减少动态效果"时只画一张静止的字标。纯逻辑在 lib/eyefield.ts。
import { MARK, wordLines, cellSize, sampleCells, aim, lens, blinkLid, blinkSpan, easeOutBack, EYE_TOKENS, PLATE_TOKENS, mixHex, pickColor, rng, type Cell } from "../lib/eyefield";

// —— 节奏（毫秒 / 像素） ——
const INTRO_SWEEP = 1100;   // 入场：从左到右一路"醒过来"
const INTRO_POP = 420;      // 每张脸弹出来的时长
const EYES_OPEN = 220;      // 弹出后多久睁眼
const BLINK_MS = 150;
const BLINK_GAP: [number, number] = [2600, 9000];
const SWITCH_EVERY = 7000;  // 多久换一次模型
const SWITCH_SWEEP = 1300;  // 换模型的波扫过整块字标的时长
const RIPPLE_SPEED = 0.9;   // 消息涟漪 px/ms
const HAPPY_MS = 650;
const DOZE_AFTER = 9000;    // 指针多久不动就开始犯困
const DOZE_IN = 4000;       // 从清醒到睡着
const WAKE_SPEED = 1.4;     // 叫醒的波 px/ms
const REACH = 420;          // 目光满幅的距离
const LENS_CELLS = 4.5;     // "注意到你"的范围（格）：指针附近的脸探出头、眼睛睁大
const LENS_MAX = 0.45;      // 最多探出多少（不是放大镜，只是凑近一点）
const TOUCH_HOLD = 1600;    // 手机上点一下后，大家看着那里多久

interface Face extends Cell {
  size: number; phase: number; lag: number;
  t0: number;                       // 入场时刻
  color: number; next: number; swapAt: number;
  gx: number; gy: number;           // 当前目光
  s: number; bump: number;          // 注意到你时探出的程度、一次性的弹跳
  blinkAt: number; blinkStart: number; dbl: boolean;
  happyUntil: number;
  sleep: number; wakeAt: number;
  hit: number;                      // 最近一次被哪道涟漪扫到
}
interface Ripple { x: number; y: number; t: number; id: number }

const root = document.querySelector<HTMLElement>("[data-eyefield]");
if (root) mount(root);

function mount(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>("canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const modelEl = root.querySelector<HTMLElement>("[data-field-model]");
  const models: string[] = (() => { try { return JSON.parse(root.dataset.models || "[]"); } catch { return []; } })();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  let w = 0, h = 0, dpr = 1, cell = 12, bleed = 0;
  let faces: Face[] = [];
  // 两种画法（footer.css 的变量决定）：
  //   发光：深色——统一的灰面罩 + 角色色的眼睛 + 光晕
  //   淡彩：浅色（有 --field-ink 时）——面罩是角色色和底色调出来的淡彩、上浅下深，眼睛统一墨色，面罩一圈极细的边
  let plate = "#1c1e19", cut = "#fff", glow = 0, eyes: string[] = [], plateBase: string[] = [];
  let ink = "", edge = "", tintTop = 0.14, tintBottom = 0.32;
  let plateFill: (string | CanvasGradient)[] = [];
  let main = 0, modelIdx = 0;
  let visible = false, raf = 0, last = 0;
  let introStart = -1, introDone = false, nextSwitch = 0;
  // 指针存视口坐标，每帧再换成画布坐标：页面滚动时眼睛仍然看着指针
  let cx = NaN, cy = NaN, px = NaN, py = NaN, mouse = false, down = false, lastMove = performance.now(), touchUntil = 0;
  let doze = 0;
  const ripples: Ripple[] = [];
  let rippleId = 0;

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  function readTheme() {
    const cs = getComputedStyle(root);
    const num = (k: string, d: number) => { const v = parseFloat(cs.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
    plate = cs.getPropertyValue("--field-plate").trim() || plate;
    cut = cs.getPropertyValue("--field-cut").trim() || cut;
    glow = num("--field-glow", 0);
    ink = cs.getPropertyValue("--field-ink").trim();
    edge = cs.getPropertyValue("--field-edge").trim();
    tintTop = num("--field-tint-top", 0.14); tintBottom = num("--field-tint-bottom", 0.32);
    eyes = EYE_TOKENS.map((t) => cs.getPropertyValue(t).trim() || "#d7ff00");
    plateBase = PLATE_TOKENS.map((t) => cs.getPropertyValue(t).trim() || "#d7ff00");
    buildFills();
    setDot();
  }
  /** 每个角色一份面罩填充：淡彩模式是从字标顶到底的渐变（上浅下深，像光从上面打下来），发光模式就是统一的灰 */
  function buildFills() {
    if (!ink) { plateFill = EYE_TOKENS.map(() => plate); return; }
    const top = bleed, bottom = Math.max(top + 1, h - bleed);
    plateFill = plateBase.map((c) => {
      const g = ctx!.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, mixHex(c, cut, tintTop));
      g.addColorStop(1, mixHex(c, cut, tintBottom));
      return g;
    });
  }
  /** 角上"换脑"前面的小圆点：当前这一轮的颜色（淡彩模式取面罩色，发光模式取眼睛色） */
  function setDot() {
    root.style.setProperty("--field-dot", ink ? mixHex(plateBase[main], cut, tintBottom + 0.12) : eyes[main]);
  }

  /** 把字标画进一张离屏画布，按格子采样出每张脸的位置 */
  function layout() {
    const cw = canvas!.clientWidth, ch = canvas!.clientHeight;
    if (!cw || !ch) return;
    const sameBox = cw === w && ch === h;
    w = cw; h = ch; dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas!.width !== bw || canvas!.height !== bh) { canvas!.width = bw; canvas!.height = bh; }   // 改尺寸会清空画布，只在真的变了时改
    // 画布比字标盒子上下各多出 --field-bleed：探头、弹跳的脸可以画出去，盒子本身就能贴着字形，不用为它们留白
    bleed = parseFloat(getComputedStyle(root).getPropertyValue("--field-bleed")) || 0;
    const th = Math.max(1, h - 2 * bleed);
    if (sameBox && faces.length) { buildFills(); redraw(); return; }

    const lines = wordLines(w, th);
    const fam = getComputedStyle(root).getPropertyValue("--font-sans").trim() || "sans-serif";
    const mask = document.createElement("canvas");
    mask.width = Math.ceil(w); mask.height = Math.ceil(h);
    const m = mask.getContext("2d", { willReadFrequently: true });
    if (!m) return;
    const TRACK = 0.07, GAP = 0.12;   // 字距、行距（em）：拼成格子后字母之间至少空出一格
    const widthAt = (s: string, size: number) => {
      m.font = `800 ${size}px ${fam}`;
      return [...s].reduce((a, c) => a + m.measureText(c).width, 0) + TRACK * size * (s.length - 1);
    };
    const vert = (s: string, size: number) => { m.font = `800 ${size}px ${fam}`; const k = m.measureText(s); return [k.actualBoundingBoxAscent, k.actualBoundingBoxDescent]; };
    // 先按 100px 量一遍，再按宽、高两个方向取较小的缩放
    const w100 = Math.max(...lines.map((l) => widthAt(l, 100)));
    const v100 = lines.map((l) => vert(l, 100));
    const h100 = v100.reduce((a, [asc, desc]) => a + asc + desc, 0) + GAP * 100 * (lines.length - 1);
    const size = Math.min((w * 0.985) / w100, (th * 0.96) / h100) * 100;
    const [capH] = vert("M", size);
    cell = cellSize(capH, lines.length > 1 ? 6 : 8);

    m.clearRect(0, 0, mask.width, mask.height);
    m.fillStyle = "#000"; m.textBaseline = "alphabetic"; m.font = `800 ${size}px ${fam}`;
    const s = size / 100;
    let y = bleed + (th - h100 * s) / 2;
    lines.forEach((line, i) => {
      const [asc, desc] = v100[i];
      y += asc * s;
      let x = (w - widthAt(line, size)) / 2;
      for (const c of line) { m.fillText(c, x, y); x += m.measureText(c).width + TRACK * size; }
      y += desc * s + GAP * size;
    });
    const img = m.getImageData(0, 0, mask.width, mask.height);
    const alpha = (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return 0;
      return img.data[(iy * img.width + ix) * 4 + 3] / 255;
    };

    const r = rng(7 + lines.length);
    const now = performance.now();
    const playedIntro = introStart >= 0;
    faces = sampleCells(w, h, cell, alpha).map((c) => {
      const delay = (c.x / w) * INTRO_SWEEP + (1 - c.y / h) * 150 + r() * 220;
      return {
        ...c, size: 0.94 + r() * 0.12, phase: r() * Math.PI * 2, lag: 0.1 + r() * 0.12,
        t0: playedIntro ? -Infinity : delay,   // 没入场时先存相对延迟，进视口时再加上起点
        color: pickColor(main, EYE_TOKENS.length, r(), r()), next: -1, swapAt: -1,
        gx: 0, gy: 0, s: 1, bump: 0,
        blinkAt: now + rand(...BLINK_GAP), blinkStart: -1, dbl: false,
        happyUntil: 0, sleep: 0, wakeAt: 0, hit: -1,
      };
    });
    buildFills();
    redraw();
  }
  /** 没在跑动画时补画一帧（静止版、或入场后滚出视口时的尺寸 / 主题变化）；入场前不画，免得先闪出整块字标 */
  function redraw() {
    if (reduce.matches) still();
    else if (!raf && introStart >= 0) draw(performance.now());
  }

  // —— 事件 ——
  function toLocal() {
    if (Number.isNaN(cx)) { px = py = NaN; return; }
    const r = canvas!.getBoundingClientRect();
    px = cx - r.left; py = cy - r.top;
  }
  function wake(now: number) {
    toLocal();
    if (Number.isNaN(px)) return;
    for (const f of faces) if (f.sleep > 0.05) f.wakeAt = now + Math.hypot(f.x - px, f.y - py) / WAKE_SPEED;
    doze = 0;
  }
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    cx = e.clientX; cy = e.clientY; mouse = true;
    if (!visible) return;
    const now = performance.now();
    lastMove = now;
    if (doze > 0.2) wake(now);
  }, { passive: true });
  window.addEventListener("scroll", () => { if (visible) lastMove = performance.now(); }, { passive: true });
  document.addEventListener("pointerout", (e) => { if (!e.relatedTarget && e.pointerType !== "touch") { cx = cy = NaN; mouse = false; } });
  canvas.addEventListener("pointerdown", (e) => {
    if (reduce.matches) return;
    const now = performance.now();
    cx = e.clientX; cy = e.clientY;
    if (e.pointerType === "touch") { mouse = false; touchUntil = now + TOUCH_HOLD; }
    lastMove = now;
    if (doze > 0.2) wake(now);
    toLocal();
    down = true;
    ripples.push({ x: px, y: py, t: now, id: ++rippleId });
  });
  window.addEventListener("pointerup", () => { down = false; });
  window.addEventListener("pointercancel", () => { down = false; });

  // —— 换模型：主色换一个，一道斜波从左扫到右，扫到的脸眨一下眼、睁开就是新颜色；角上的模型名跟着换 ——
  function switchModel(now: number) {
    main = (main + 1) % EYE_TOKENS.length;
    for (const f of faces) {
      f.next = pickColor(main, EYE_TOKENS.length, Math.random(), Math.random());
      const k = (f.x + (h - f.y) * 0.35) / (w + h * 0.35);
      f.swapAt = now + k * SWITCH_SWEEP;
      if (f.sleep < 0.5) { f.blinkStart = f.swapAt - BLINK_MS / 2; f.dbl = false; }
    }
    setDot();
    if (modelEl && models.length) {
      modelIdx = (modelIdx + 1) % models.length;
      modelEl.classList.remove("is-swap");
      void modelEl.offsetWidth;   // 重新触发换字动画
      modelEl.textContent = models[modelIdx];
      modelEl.classList.add("is-swap");
    }
  }

  // —— 每一帧：先算状态，再画 ——
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - (last || now), 50); last = now;
    if (!faces.length) return;   // 字体还没到、还没排版
    if (introStart < 0) {
      introStart = now;
      for (const f of faces) f.t0 += now;
    }
    if (!introDone && now > introStart + INTRO_SWEEP + INTRO_POP + 600) { introDone = true; nextSwitch = now + SWITCH_EVERY; }
    if (touchUntil && now > touchUntil) { touchUntil = 0; cx = cy = NaN; }
    toLocal();

    const idle = now - lastMove;
    doze = introDone && idle > DOZE_AFTER ? Math.min(1, doze + dt / DOZE_IN) : Math.max(0, doze - dt / 400);
    // 睡着的时候不换模型（它们在睡觉）；按住的时候也不换
    if (introDone && !down && doze < 0.5 && now >= nextSwitch) { switchModel(now); nextSwitch = now + SWITCH_EVERY; }
    const lensR = cell * LENS_CELLS;
    const hasPointer = !Number.isNaN(px);

    for (let i = ripples.length - 1; i >= 0; i--) if ((now - ripples[i].t) * RIPPLE_SPEED > Math.hypot(w, h) + cell) ripples.splice(i, 1);

    for (const f of faces) {
      // 目光：有指针就看指针，没有就自己慢慢东张西望；犯困时往下耷拉
      let tx: number, ty: number;
      if (hasPointer) [tx, ty] = aim(px - f.x, py - f.y, REACH);
      else { tx = 0.35 * Math.sin(now * 0.0005 + f.phase); ty = 0.2 * Math.sin(now * 0.0007 + f.phase * 1.3); }
      ty += 0.6 * f.sleep;
      const k = 1 - Math.pow(1 - f.lag, dt / 16.7);
      f.gx += (tx - f.gx) * k; f.gy += (ty - f.gy) * k;

      // 注意到你：鼠标附近的脸探出头（手机上没有悬停，不做）
      const d = hasPointer ? Math.hypot(px - f.x, py - f.y) : Infinity;
      const near = mouse ? lens(d, lensR) : 0;
      f.s += (1 + LENS_MAX * near - f.s) * (1 - Math.pow(0.8, dt / 16.7));
      f.bump *= Math.pow(0.9, dt / 16.7);

      // 消息涟漪扫到：眯眼笑 + 弹一下
      for (const rp of ripples) {
        if (f.hit === rp.id) continue;
        if (Math.abs(Math.hypot(f.x - rp.x, f.y - rp.y) - (now - rp.t) * RIPPLE_SPEED) < cell) { f.hit = rp.id; f.happyUntil = now + HAPPY_MS; f.bump = 0.45; }
      }
      // 换色
      if (f.swapAt > 0 && now >= f.swapAt) { f.color = f.next; f.swapAt = -1; }
      // 犯困 / 被叫醒（醒的那一刻弹一下）
      if (f.wakeAt) {
        if (now >= f.wakeAt) { f.wakeAt = 0; if (f.sleep > 0.2) f.bump = Math.max(f.bump, 0.3); f.sleep = 0; }
      } else {
        f.sleep += (doze - f.sleep) * (1 - Math.pow(1 - f.lag * 0.25, dt / 16.7));
      }
      // 眨眼（睡着了不眨）
      if (f.blinkStart < 0 && now >= f.blinkAt && f.sleep < 0.5) { f.blinkStart = now; f.dbl = Math.random() < 0.15; }
      if (f.blinkStart >= 0 && now - f.blinkStart > BLINK_MS * blinkSpan(f.dbl)) { f.blinkStart = -1; f.blinkAt = now + rand(...BLINK_GAP); }
    }
    draw(now, down && mouse ? lensR : 0);   // 按下时，附近的脸一起眯眼（"被戳了"）
  }

  function rr(p: Path2D, x: number, y: number, ww: number, hh: number, r: number) {
    r = Math.min(r, ww / 2, hh / 2);
    p.moveTo(x + r, y);
    p.arcTo(x + ww, y, x + ww, y + hh, r);
    p.arcTo(x + ww, y + hh, x, y + hh, r);
    p.arcTo(x, y + hh, x, y, r);
    p.arcTo(x, y, x + ww, y, r);
    p.closePath();
  }

  /** 把一张脸加进路径：面罩、眼睛、笑眼都按角色分组（同一组一次画完） */
  function addFace(f: Face, sc: number, now: number, squintR: number, plateP: Path2D[], eyeP: Path2D[], happyP: Path2D[]) {
    const c = cell * sc * f.size;
    const cx = f.x + f.gx * MARK.headX * c, cy = f.y + f.gy * MARK.headY * c;
    rr(plateP[f.color], cx - (MARK.plateW * c) / 2, cy - (MARK.plateH * c) / 2, MARK.plateW * c, MARK.plateH * c, MARK.plateR * c);
    const intro = Math.min(1, Math.max(0, (now - f.t0 - EYES_OPEN) / 180));
    if (intro <= 0) return;
    const ew = MARK.eyeW * c, eh0 = MARK.eyeH * c;
    const ey = cy + f.gy * MARK.ampY * c;
    const happy = now < f.happyUntil;
    for (const side of [-1, 1]) {
      const ex = cx + side * MARK.eyeDX * c + f.gx * MARK.ampX * c;
      if (happy) {
        const p = happyP[f.color];
        p.moveTo(ex - ew * 0.9, ey + eh0 * 0.12);
        p.quadraticCurveTo(ex, ey - eh0 * 0.5, ex + ew * 0.9, ey + eh0 * 0.12);
        continue;
      }
      let lid = f.blinkStart >= 0 ? blinkLid((now - f.blinkStart) / BLINK_MS, f.dbl) : 1;
      lid = Math.min(lid, 1 - 0.85 * f.sleep) * intro;
      if (squintR && Math.hypot(px - f.x, py - f.y) < squintR) lid *= 0.55;
      else lid *= 1 + 0.14 * Math.max(0, sc - 1) / LENS_MAX;   // 探出头的脸眼睛睁得更大（注意到你了）
      const eh = Math.max(eh0 * lid, ew * 0.6);
      rr(eyeP[f.color], ex - ew / 2, ey - eh / 2, ew, eh, ew / 2);
    }
  }

  function paint(plateP: Path2D[], eyeP: Path2D[], happyP: Path2D[], ring: number) {
    const g = ctx!;
    plateP.forEach((p, i) => {
      if (ring) { g.lineWidth = ring; g.strokeStyle = cut; g.stroke(p); }   // 探出头的脸外面一圈底色，压在邻居上时分得开
      g.fillStyle = plateFill[i] ?? plate; g.fill(p);
      if (edge) { g.lineWidth = 0.75; g.strokeStyle = edge; g.stroke(p); }  // 淡彩面罩的细边：最浅的颜色也压得住浅底
    });
    eyeP.forEach((p, i) => {
      if (glow && !ink) { g.globalAlpha = glow; g.lineWidth = cell * 0.16; g.strokeStyle = eyes[i]; g.stroke(p); g.globalAlpha = 1; }
      g.fillStyle = ink || eyes[i]; g.fill(p);
    });
    happyP.forEach((p, i) => { g.lineWidth = cell * MARK.eyeW * 0.85; g.lineCap = "round"; g.strokeStyle = ink || eyes[i]; g.stroke(p); });
  }

  function draw(now: number, squintR = 0) {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, w, h);
    // 消息不画成一圈扩散的线：它怎么传开，只看小脸按远近一张张笑起来（"挨个收到了"）
    const n = EYE_TOKENS.length;
    const fresh = () => Array.from({ length: n }, () => new Path2D());
    const plateP = fresh(), eyeP = fresh(), happyP = fresh();
    const big: [Face, number][] = [];
    for (const f of faces) {
      const pop = easeOutBack(Math.min(1, (now - f.t0) / INTRO_POP));
      const sc = pop * (f.s + f.bump);
      if (sc <= 0.02) continue;
      if (sc > 1.04) { big.push([f, sc]); continue; }
      addFace(f, sc, now, squintR, plateP, eyeP, happyP);
    }
    paint(plateP, eyeP, happyP, 0);
    // 放大的脸最后画、从小到大叠上去
    big.sort((a, b) => a[1] - b[1]);
    for (const [f, sc] of big) {
      const p = fresh(), e = fresh(), hp = fresh();
      addFace(f, sc, now, squintR, p, e, hp);
      paint(p, e, hp, cell * 0.14 * sc);
    }
  }

  // —— 生命周期：可见才跑；换主题重读颜色；尺寸变了重排 ——
  function start() { if (!raf && visible && !reduce.matches && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function still() {   // 静止版：一次性画好，所有脸睁眼、朝前
    stop();
    for (const f of faces) { f.t0 = -Infinity; f.gx = f.gy = 0; f.s = 1; f.bump = 0; f.sleep = 0; f.blinkStart = -1; f.happyUntil = 0; }
    draw(performance.now());
  }

  readTheme();
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) { lastMove = performance.now(); if (reduce.matches) still(); else start(); } else stop();
  }, { rootMargin: "80px 0px" }).observe(root);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reduce.addEventListener?.("change", () => (reduce.matches ? still() : start()));
  new MutationObserver(() => { readTheme(); redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(layout);
  }).observe(canvas);

  // 字体到位再排（Geist 没加载完时用回退字体量出来的字形会对不上）
  const ready = document.fonts?.load ? document.fonts.load(`800 100px Geist`).catch(() => undefined) : Promise.resolve();
  ready.then(layout);
}
