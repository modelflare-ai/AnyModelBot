#!/usr/bin/env node
// 录制 README 的应用截图和功能 GIF：真实的 ui/ 界面 + 模拟后端（mock-server.mjs）+ 演示数据，
// 用无头 Chromium（playwright-core）驱动，CDP 的 Page.startScreencast 带时间戳收帧，再交给 encode.py 按目标帧率重采样编码。
//
// 用法（在仓库根目录）：
//   node docs/assets/_src/record/record.mjs                 # 录全部（截图 + GIF）
//   node docs/assets/_src/record/record.mjs model-switch    # 只录名字里含这段文字的素材，可以给多个
//   node docs/assets/_src/record/record.mjs --list          # 列出全部素材
//   node docs/assets/_src/record/record.mjs --check         # 不开浏览器，核对全部成品的规格与上次录制的报错记录
// 环境变量：
//   PLAYWRIGHT_CORE   playwright-core 的目录（默认 site/node_modules/playwright-core）
//   CHROMIUM_PATH     Chromium 可执行文件（默认用 playwright-core 自带的查找规则）
//   AMB_NODE_MODULES  装了 preact 和 htm 的 node_modules（默认仓库根目录的 node_modules）
//   REC_TMP           帧和中间文件放哪里（默认系统临时目录下的 amb-record）
//   REC_FONT_DIR      额外的字体目录（机器上没装 emoji 字体时用）
//   REC_KEEP_FRAMES=1 编码后保留原始帧
// 详见同目录的 README.md。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startMock, REPO } from "./mock-server.mjs";
import { SCENES } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(REPO, "docs", "assets");
const TMP = path.resolve(process.env.REC_TMP || path.join(os.tmpdir(), "amb-record"));
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const now = () => Date.now() / 1000;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = [process.env.PLAYWRIGHT_CORE, path.join(REPO, "site", "node_modules", "playwright-core"), path.join(REPO, "node_modules", "playwright-core")].filter(Boolean);
  for (const p of tries) {
    try {
      return require(p);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(`找不到 playwright-core：cd site && npm install，或用 PLAYWRIGHT_CORE 指定（试过：${tries.join("、")}）`);
}

/** 字体：界面的字体栈在 Linux 上都落到 system-ui / sans-serif，统一指向 Noto Sans SC；等宽用 DejaVu Sans Mono */
function fontConfig() {
  const f = path.join(TMP, "fonts.conf");
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(
    f,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
${process.env.REC_FONT_DIR ? `  <dir>${path.resolve(process.env.REC_FONT_DIR)}</dir>\n` : ""}  <alias binding="strong"><family>sans-serif</family><prefer><family>Noto Sans SC</family></prefer></alias>
  <alias binding="strong"><family>system-ui</family><prefer><family>Noto Sans SC</family></prefer></alias>
  <alias binding="strong"><family>monospace</family><prefer><family>DejaVu Sans Mono</family><family>Noto Sans SC</family></prefer></alias>
</fontconfig>
`,
  );
  return f;
}

/** 每个 frame 都注入：把鼠标事件换算成舞台（最外层页面）坐标，交给舞台上的假鼠标 */
const CURSOR_HOOK = `(() => {
  const fwd = (e) => {
    try {
      let x = e.clientX, y = e.clientY, w = window;
      while (w !== w.parent) {
        const r = w.frameElement.getBoundingClientRect();
        x += r.left + w.frameElement.clientLeft;
        y += r.top + w.frameElement.clientTop;
        w = w.parent;
      }
      if (w.__cursor) w.__cursor(e.type, x, y);
    } catch (_) {}
  };
  for (const t of ["mousemove", "mousedown", "mouseup"]) window.addEventListener(t, fwd, true);
})();`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

/** 录制时可用的动作：鼠标（每次移动 ≥ 0.6 s、点击前停 0.3 s）、逐字输入、按时间点等待、舞台调用 */
class Rec {
  constructor(page, mock, spec, dir) {
    this.page = page;
    this.mock = mock;
    this.spec = spec;
    this.dir = dir;
    this.pos = { x: -1, y: -1 };
    this.t0 = 0;
    this.marks = [];
    this.frames = [];
    this.frameDir = path.join(dir, "frames");
    this.app = page.mainFrame();
  }
  /** 时间线上的秒数（从 start() 起） */
  t() {
    return this.t0 ? now() - this.t0 : 0;
  }
  start() {
    this.t0 = now();
    this.mark("start");
  }
  mark(name) {
    if (this.t0) this.marks.push([+(now() - this.t0).toFixed(2), name]);
  }
  async until(t) {
    await sleep((this.t0 + t - now()) * 1000);
  }
  /** 应用里的元素（舞台布局时在 iframe 里） */
  $(sel) {
    return this.app.locator(sel);
  }
  /** 在舞台上打开应用窗口（iframe），之后 $() 都在应用里找元素 */
  async openApp(opts) {
    await this.stage("openApp", opts);
    this.app = this.page.frame({ name: "app" });
    await this.app.waitForFunction(() => document.fonts.ready.then(() => true));
  }
  /** 舞台上的元素 */
  s$(sel) {
    return this.page.locator(sel);
  }
  stage(fn, ...args) {
    return this.page.evaluate(([f, a]) => f.split(".").reduce((o, k) => o[k], window.stage)(...a), [fn, args]);
  }
  async wait(sel, opts = {}) {
    const loc = typeof sel === "string" ? this.$(sel) : sel;
    await loc.first().waitFor({ state: "visible", timeout: opts.timeout ?? 20000 });
    return loc.first();
  }
  async waitFn(fn, arg, timeout = 20000) {
    await this.app.waitForFunction(fn, arg, { timeout, polling: 50 });
  }
  async point(target, at = [0.5, 0.5]) {
    if (target && typeof target.x === "number" && target.w === undefined) return target;
    const loc = typeof target === "string" ? this.$(target).first() : target.first ? target.first() : target;
    await loc.waitFor({ state: "visible", timeout: 20000 });
    const b = await loc.boundingBox();
    if (!b) throw new Error(`找不到元素的位置：${target}`);
    return { x: b.x + b.width * at[0], y: b.y + b.height * at[1] };
  }
  /** 不动画，直接把鼠标放到某处（开始录之前用） */
  async place(x, y) {
    await this.page.mouse.move(x, y);
    this.pos = { x, y };
  }
  /** 平滑移动：缓入缓出、略带弧度，dur 秒（不少于 0.6） */
  async move(target, { dur = 0.7, at } = {}) {
    const to = await this.point(target, at);
    const from = this.pos.x < 0 ? to : this.pos;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist < 1.5) return to;
    dur = Math.max(0.6, dur);
    const nx = -(to.y - from.y) / (dist || 1);
    const ny = (to.x - from.x) / (dist || 1);
    const bend = Math.min(60, dist * 0.08);
    const cx = (from.x + to.x) / 2 + nx * bend;
    const cy = (from.y + to.y) / 2 + ny * bend;
    const t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const x = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
      const y = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
      await this.page.mouse.move(x, y);
      if (k >= 1) break;
      await sleep(14);
    }
    this.pos = to;
    return to;
  }
  /** 移到目标、停 pause 秒、点击（double 时双击） */
  async click(target, { dur = 0.7, pause = 0.3, double = false, at, label } = {}) {
    await this.move(target, { dur, at });
    await sleep(pause * 1000);
    const n = double ? 2 : 1;
    for (let i = 0; i < n; i++) {
      await this.page.mouse.down({ clickCount: i + 1 });
      await sleep(70);
      await this.page.mouse.up({ clickCount: i + 1 });
      if (i + 1 < n) await sleep(90);
    }
    this.mark(`click ${label ?? (typeof target === "string" ? target : "")}`.trim());
  }
  /** 逐字输入：总共 dur 秒（每条提示词不超过 4 秒），字间隔有自然的快慢 */
  async type(text, { dur } = {}) {
    const chars = [...text];
    dur = Math.min(dur ?? chars.length * 0.11, 4);
    const per = (dur * 1000) / chars.length;
    const t0 = performance.now();
    this.mark(`type「${text}」`);
    for (let i = 0; i < chars.length; i++) {
      await this.page.keyboard.type(chars[i]);
      const target = per * (i + 1) * (0.85 + 0.3 * ((i * 7919) % 13) / 13);
      await sleep(Math.min(per * 1.6, target - (performance.now() - t0)));
    }
    this.mark("typed");
  }
  async press(key) {
    await this.page.keyboard.press(key);
    this.mark(`press ${key}`);
  }
  /** 等到某个模拟后端事件 */
  once(name, pred = () => true, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => (this.mock.events.off(name, on), reject(new Error(`等 ${name} 超时`))), timeout);
      const on = (d) => {
        if (!pred(d)) return;
        clearTimeout(t);
        this.mock.events.off(name, on);
        resolve(d);
      };
      this.mock.events.on(name, on);
    });
  }
}

/** 截屏流：每张帧写成 PNG，记下时间戳（秒） */
async function startCapture(page, rec, everyNth = 2) {
  const cdp = await page.context().newCDPSession(page);
  fs.mkdirSync(rec.frameDir, { recursive: true });
  let seq = 0;
  const writes = [];
  cdp.on("Page.screencastFrame", (f) => {
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    const file = path.join(rec.frameDir, String(++seq).padStart(6, "0") + ".png");
    rec.frames.push([f.metadata.timestamp, file]);
    writes.push(fs.promises.writeFile(file, Buffer.from(f.data, "base64")));
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: everyNth });
  return async () => {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(writes);
    await cdp.detach().catch(() => {});
  };
}

function python(args) {
  return execFileSync("python3", [path.join(HERE, "encode.py"), ...args], { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
}

/** 录一个素材：起模拟后端和浏览器上下文 → spec.run(R) → 编码 → 核对 */
async function recordOne(chromium, spec, fontsConf, genDir) {
  const dir = path.join(TMP, spec.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const logs = { console: [], pageErrors: [], failed: [] };
  const mock = await startMock({ scene: spec.scene, sceneOpts: spec.sceneOpts || {}, genDir, log: (s) => logs.console.push(`[mock] ${s}`) });
  if (spec.chat) mock.onChat = spec.chat;
  if (spec.weixin) mock.onWeixin = spec.weixin;
  if (spec.delays) mock.delays = spec.delays;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    env: { ...process.env, FONTCONFIG_FILE: fontsConf },
  });
  const shot = spec.kind === "webp";
  const [vw, vh] = spec.viewport;
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: shot ? 2 : 1,
    colorScheme: shot ? "light" : "dark",
    locale: "zh-CN",
    userAgent: UA,
  });
  await ctx.addInitScript(CURSOR_HOOK);
  if (spec.storage)
    await ctx.addInitScript((kv) => {
      if (location.pathname !== "/" || sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, spec.storage);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") logs.console.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.pageErrors.push(e.message));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText || "";
    // 切走时中止的流式请求不算错
    if (!/ERR_ABORTED/.test(why)) logs.failed.push(`${r.method()} ${r.url()} ${why}`);
  });
  const R = new Rec(page, mock, spec, dir);
  let result;
  try {
    if (shot) {
      await page.goto(mock.url + (spec.hash || ""));
      await spec.run(R);
      result = await shots(R, spec);
    } else {
      await page.goto(mock.url + "__stage/");
      await page.evaluate(() => document.fonts.ready);
      const stop = await startCapture(page, R);
      await spec.run(R);
      await R.until(spec.duration + 0.3);
      R.mark("end");
      await stop();
      const job = { kind: "gif", frames: R.frames, t0: R.t0, duration: spec.duration, fps: spec.fps, size: spec.size, crop: spec.crop || null, out: path.join(ASSETS, spec.out), limit: spec.limit, hold: 1.0 };
      fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job));
      result = JSON.parse(python([path.join(dir, "job.json")]));
      if (!process.env.REC_KEEP_FRAMES) fs.rmSync(R.frameDir, { recursive: true, force: true });
    }
  } finally {
    await browser.close().catch(() => {});
    await mock.close();
  }
  const report = { id: spec.id, out: spec.out, result, marks: R.marks, logs, unimplemented: mock.unimplemented, mockErrors: mock.errors };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}

/** 截图：同一时刻先浅色后深色（只切系统配色，界面跟随系统），鼠标的位置由 spec 决定 */
async function shots(R, spec) {
  const page = R.page;
  const outs = [];
  const texts = [];
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await sleep(900);
    if (spec.blur !== false) await page.evaluate(() => document.activeElement?.blur?.());
    const png = path.join(R.dir, `${scheme}.png`);
    await page.screenshot({ path: png, animations: "disabled", caret: "hide" });
    texts.push(await page.evaluate(() => [document.documentElement.dataset.theme, document.body.innerText]));
    const out = path.join(ASSETS, spec.out.replace("{theme}", scheme));
    const job = { kind: "webp", src: png, size: [1600, 1093], quality: 82, out, limit: spec.limit };
    fs.writeFileSync(path.join(R.dir, `${scheme}.json`), JSON.stringify(job));
    outs.push(JSON.parse(python([path.join(R.dir, `${scheme}.json`)])));
  }
  return { files: outs, themes: texts.map((t) => t[0]), sameText: texts[0][1] === texts[1][1] };
}

/** --check：不开浏览器，逐个核对成品是否符合规格（尺寸、时长、帧率、体积上限、空白 / 全黑帧段），并汇总上次录制留下的报错记录 */
function check() {
  const rows = [];
  let bad = 0;
  for (const spec of SCENES) {
    const outs = spec.kind === "webp" ? ["light", "dark"].map((t) => spec.out.replace("{theme}", t)) : [spec.out];
    for (const out of outs) {
      const file = path.join(ASSETS, out);
      if (!fs.existsSync(file)) {
        rows.push(`✗ ${out}：不存在`);
        bad++;
        continue;
      }
      const r = JSON.parse(python(["--verify", file]));
      const [w, h] = spec.kind === "webp" ? [1600, 1093] : spec.size;
      const errs = [];
      // 体积压缩的最后一档（encode.py：帧率 8、宽度 800）是规范允许的结果，见 docs/assets/README.md
      const narrowed = spec.kind === "gif" && w > 800 && r.width === 800 && Math.abs(r.height - Math.round((h * 800) / w)) <= 1;
      if ((r.width !== w || r.height !== h) && !narrowed) errs.push(`尺寸 ${r.width}×${r.height} ≠ ${w}×${h}`);
      if (spec.kind === "gif" && Math.abs(r.duration_ms - spec.duration * 1000) > 50) errs.push(`时长 ${r.duration_ms} ms ≠ ${spec.duration * 1000}`);
      if (spec.kind === "gif" && r.frames > spec.duration * spec.fps) errs.push(`帧数 ${r.frames} 超过 ${spec.duration}×${spec.fps}`);
      if (r.bytes > spec.limit) errs.push(`体积 ${r.bytes} > ${spec.limit}`);
      if (r.flat_frames.length) errs.push(`有 ${r.flat_frames.length} 帧是一片纯色（${r.black ? "黑" : r.blank ? "白" : "其他"}）`);
      const rep = path.join(TMP, spec.id, "report.json");
      if (fs.existsSync(rep)) {
        const j = JSON.parse(fs.readFileSync(rep, "utf8"));
        const n = j.logs.console.filter((l) => !l.startsWith("[mock]")).length + j.logs.pageErrors.length + j.logs.failed.length + j.unimplemented.length + j.mockErrors.length;
        if (n) errs.push(`录制时有 ${n} 条报错 / 未实现接口（${rep}）`);
      }
      const size = r.bytes >= 1048576 ? `${(r.bytes / 1048576).toFixed(2)} MB` : `${(r.bytes / 1024).toFixed(0)} KB`;
      const lim = spec.limit >= 1048576 ? `${(spec.limit / 1048576).toFixed(1)} MB` : `${spec.limit / 1024} KB`;
      rows.push(`${errs.length ? "✗" : "✓"} ${out.padEnd(36)} ${`${r.width}×${r.height}`.padEnd(10)} ${spec.kind === "gif" ? `${r.frames} 帧 / ${(r.duration_ms / 1000).toFixed(1)} s / ${spec.fps} fps`.padEnd(22) : "静态".padEnd(22)} ${size.padStart(8)} / ${lim}${narrowed ? "  （按规范压到 800 宽、8 fps）" : ""}${errs.length ? "  " + errs.join("；") : ""}`);
      if (errs.length) bad++;
    }
  }
  console.log(rows.join("\n"));
  console.log(bad ? `\n${bad} 个文件不合格` : `\n全部 ${rows.length} 个文件合格`);
  if (bad) process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--check")) return check();
  if (argv.includes("--list")) {
    for (const s of SCENES) console.log(`${s.id.padEnd(18)} ${s.out}`);
    return;
  }
  const want = argv.filter((a) => !a.startsWith("--"));
  const list = SCENES.filter((s) => !want.length || want.some((w) => s.id.includes(w) || s.out.includes(w)));
  if (!list.length) throw new Error(`没有匹配的素材：${want.join(" ")}（--list 查看全部）`);
  const { chromium } = loadPlaywright();
  const fontsConf = fontConfig();
  const genDir = path.join(TMP, "gen");
  if (list.some((s) => s.needsIllustration)) execFileSync("python3", [path.join(HERE, "make-illustration.py"), path.join(genDir, "sleepy-bot.png")], { stdio: "inherit" });
  const reports = [];
  for (const spec of list) {
    process.stdout.write(`录制 ${spec.id} → ${spec.out} … `);
    const t = Date.now();
    try {
      const r = await recordOne(chromium, spec, fontsConf, genDir);
      reports.push(r);
      const bad = r.logs.console.filter((l) => !l.startsWith("[mock]")).length + r.logs.pageErrors.length + r.logs.failed.length + r.unimplemented.length + r.mockErrors.length;
      console.log(`${((Date.now() - t) / 1000).toFixed(0)} s${bad ? `，有 ${bad} 条问题，见 ${path.join(TMP, spec.id, "report.json")}` : ""}`);
    } catch (e) {
      console.log("失败");
      console.error(e);
      process.exitCode = 1;
    }
  }
  // 汇总：控制台报错、页面异常、请求失败、未实现的接口
  const sum = (k) => reports.flatMap((r) => (k === "unimplemented" ? r.unimplemented : k === "mockErrors" ? r.mockErrors : r.logs[k]).map((x) => `${r.id}: ${x}`));
  const all = { console: sum("console"), pageErrors: sum("pageErrors"), failed: sum("failed"), unimplemented: sum("unimplemented"), mockErrors: sum("mockErrors") };
  fs.writeFileSync(path.join(TMP, "summary.json"), JSON.stringify({ reports, ...all }, null, 2));
  console.log(`\n控制台报错/警告 ${all.console.length}，页面异常 ${all.pageErrors.length}，请求失败 ${all.failed.length}，未实现的接口 ${all.unimplemented.length}，模拟后端错误 ${all.mockErrors.length}`);
  for (const [k, v] of Object.entries(all)) for (const line of v) console.log(`  ${k}: ${line}`);
  console.log(`详细记录：${path.join(TMP, "summary.json")}`);
}

await main();
