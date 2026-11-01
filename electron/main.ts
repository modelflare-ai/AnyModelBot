/**
 * Electron 桌面版主进程 = 启动器：
 *  - 单实例锁；数据目录 = <userData>/data（可用 AMB_DATA_DIR 覆盖）
 *  - 在进程内启动 App（机器人运行时 + 渠道 + 管理界面 + 受管 magpie 子进程）
 *  - 窗口加载本机管理界面（每次启动生成随机令牌，其他本机程序/浏览器无法直接访问）
 *  - 托盘：显示 / 开机自启 / 退出；关闭窗口=隐藏到托盘（可在设置 → 常规里改为退出）；退出时干净关闭 magpie
 *  - 「需要你」：托盘提示和角标是件数（没事时什么都不加），新的一件在窗口不在前台时发一条系统通知（每件最多一次）
 *  - 设置页里的开机自启、缩放、打开数据目录经 core.desktop 回调到这里（同进程，无需 preload/IPC）
 *  - 托盘菜单和对话框跟着应用语言（src/i18n）：跟随系统时取系统首选语言，界面里换了语言托盘菜单立刻重建
 * CLI（npm start）与 Docker 走同一套 src/ 代码，本文件只做桌面外壳。
 */
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, nativeTheme, net, powerMonitor, session, shell, dialog, safeStorage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { App } from "../src/app.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { initFileLog, logFilePath, logger, registerSecret, setConsoleLog } from "../src/log.js";
import { normalizeLang, onLangChange, setLangPref, setSystemLang, t } from "../src/i18n/index.js";
import { notificationOf, trayTitle, type AttentionItem } from "../src/tasks/attention.js";

const log = logger("desktop");
const SMOKE = process.env.AMB_ELECTRON_SMOKE; // 冒烟测试：截图到该路径后退出

let core: App | undefined;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let entryUrl = "";
let quitting = false;
let stopped = false;

// 图标由 scripts/build-app-icons.py 生成。Windows 窗口和托盘都用多尺寸 ico，系统按当前缩放挑对应的帧；
// 其他系统窗口用 icon.png（macOS 忽略，Dock 用包里的 icns），托盘用 18px 的 tray.png，高分屏自动换 tray@2x.png
function assetPath(name: string): string {
  const root = findAppRoot(path.dirname(fileURLToPath(import.meta.url)));
  return path.join(root, "assets", name);
}
const isWin = process.platform === "win32";
const windowIconPath = () => assetPath(isWin ? "icon.ico" : "icon.png");
const trayIconPath = () => assetPath(isWin ? "icon.ico" : "tray.png");

function showWindow(): void {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const PRODUCT = "AnyModelBot";
const canAutostart = process.platform === "darwin" || process.platform === "win32";

// Windows：也不要系统标题栏，侧栏顶部那一行就是标题栏——左上角是应用图标 + 名称（Windows 的习惯；macOS 那里是红绿灯），
// 右上角由 Electron 画系统的最小化 / 最大化 / 关闭（Window Controls Overlay），贴住窗口的右上角；界面里最右的面板也贴住这个角，
// 按钮落在它的顶栏上（界面在 Electron + Windows 下带 win-app，见 shell.css）。Linux 的窗口管理器各不相同，仍用系统标题栏。
// 叠层透明，高度 = 侧栏顶部那一行 = 贴角那块面板的顶栏（--pane-gap 8 + --head-h 52），跟着页面缩放一起变；
// 符号颜色跟界面主题：主题存在界面的 localStorage 里，界面解析后经 core.desktop.setTitleBarTheme 告诉这里，在那之前先按系统主题猜。
// 底色虽然透明，RGB 也不能随便填：Electron 按底色的亮度挑悬停时那层灰（亮底 → 黑色、暗底 → 白色）
const TITLE_BAR_H = 60;
let titleBarDark = nativeTheme.shouldUseDarkColors;
function titleBarOverlay(): Electron.TitleBarOverlay {
  return {
    color: titleBarDark ? "rgba(0, 0, 0, 0)" : "rgba(255, 255, 255, 0)",
    symbolColor: titleBarDark ? "#ececec" : "#1a1a1a", // = --fg
    height: Math.round(TITLE_BAR_H * (core?.config.ui.zoom ?? 1)),
  };
}
function updateTitleBar(): void {
  if (isWin && win && !win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlay());
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 860,
    minHeight: 520,
    title: PRODUCT,
    icon: windowIconPath(),
    show: !SMOKE,
    autoHideMenuBar: true,
    // macOS：无标题栏，红绿灯嵌进侧栏顶部（界面在 Electron + Mac 下给它留位）。
    // 侧栏顶部先让出 --pane-gap（8）再放 52 高的顶栏，和主区顶栏同一条中线，所以红绿灯也比顶栏原来的位置低 8。
    // Windows：无标题栏 + 窗口按钮叠层（见上面的 titleBarOverlay）；Linux 用系统标题栏
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 23 } } : {}),
    ...(isWin ? { titleBarStyle: "hidden" as const, titleBarOverlay: titleBarOverlay() } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const origin = new URL(entryUrl).origin;
  // 只允许停留在本机管理界面；外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== origin) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on("did-finish-load", () => win?.webContents.setZoomFactor(core?.config.ui.zoom ?? 1));
  win.on("close", (e) => {
    if (!quitting && tray && core?.config.ui.closeToTray !== false) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => {
    win = undefined;
    if (!quitting && core?.config.ui.closeToTray === false) app.quit();
  });
  void win.loadURL(entryUrl);
}

/** 打开窗口并切到「需要你」 */
function openNeeds(): void {
  showWindow();
  const go = () => void win?.webContents.executeJavaScript(`location.hash = "#/needs"`).catch(() => {});
  if (win?.webContents.isLoading()) win.webContents.once("did-finish-load", go);
  else go();
}

/** 「需要你」的件数（托盘菜单、提示、角标用） */
let needsCount = 0;

/**
 * 「需要你」变了：托盘提示与角标是件数（macOS 托盘标题和程序坞、Linux 的启动器角标、Windows 任务栏上的小黄点），
 * 没事时全部清掉；新的一件、窗口又不在前台时发一条系统通知，点开就是「需要你」。每件最多通知一次（core 记着）。
 */
function onAttention(items: AttentionItem[]): void {
  needsCount = items.length;
  tray?.setToolTip(trayTitle(PRODUCT, needsCount));
  if (process.platform === "darwin") tray?.setTitle(needsCount ? String(needsCount) : "");
  app.setBadgeCount(needsCount);
  if (isWin) win?.setOverlayIcon(needsCount ? overlayDot() : null, needsCount ? `${needsCount} 件事需要你` : "");
  renderTray?.();
  const fresh = core?.attention.takeNew(items) ?? [];
  const looking = !!win && win.isVisible() && win.isFocused();
  if (looking || !fresh.length || !Notification.isSupported()) return;
  // 一下来好几件时只发最早的两条，其余在「需要你」里
  for (const it of fresh.slice(0, 2)) {
    const n = new Notification({ ...notificationOf(it), icon: windowIconPath() });
    n.on("click", openNeeds);
    n.show();
  }
}

/** Windows 任务栏图标上的小黄点（16×16，BGRA）：有事时才挂上 */
let dot: Electron.NativeImage | undefined;
function overlayDot(): Electron.NativeImage {
  if (dot) return dot;
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const a = Math.max(0, Math.min(1, size / 2 - 1 - d));
      const i = (y * size + x) * 4;
      // 琥珀色（设计库的 --amber-300 #f2b544，深色界面里的 --amber）
      buf[i] = 0x44;
      buf[i + 1] = 0xb5;
      buf[i + 2] = 0xf2;
      buf[i + 3] = Math.round(a * 255);
    }
  dot = nativeImage.createFromBitmap(buf, { width: size, height: size });
  return dot;
}

function buildTray(): void {
  // 不要 resize：会丢掉 ico 的多尺寸帧和 @2x 图，托盘在高分屏上发糊
  tray = new Tray(nativeImage.createFromPath(trayIconPath()));
  tray.setToolTip(trayTitle(PRODUCT, needsCount));
  const render = () =>
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        // 有事在等你时才有这一项
        ...(needsCount ? [{ label: t("desktop.trayNeeds", { count: needsCount }), click: openNeeds }, { type: "separator" as const }] : []),
        { label: t("desktop.trayOpen", { product: PRODUCT }), click: showWindow },
        { label: t("desktop.trayOpenInBrowser"), click: () => void shell.openExternal(entryUrl) },
        { type: "separator" },
        {
          label: t("desktop.trayAutostart"),
          type: "checkbox",
          enabled: canAutostart,
          checked: canAutostart && app.getLoginItemSettings().openAtLogin,
          click: (item) => setAutostart(item.checked),
        },
        { label: t("desktop.trayOpenDataDir"), click: () => void shell.openPath(core!.config.dataDir) },
        { type: "separator" },
        { label: t("desktop.trayQuit"), click: () => app.quit() },
      ]),
    );
  renderTray = render;
  render();
  onLangChange(render); // 界面里换了语言：托盘菜单跟着换
  tray.on("click", showWindow);
}

let renderTray: (() => void) | undefined;
function setAutostart(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
  renderTray?.();
}

async function boot(): Promise<void> {
  const dataDir = process.env.AMB_DATA_DIR ? path.resolve(process.env.AMB_DATA_DIR) : path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  // 尽早打开日志文件：配置读取失败、启动失败也能留下记录
  initFileLog(path.join(dataDir, "logs"));
  const config = loadConfig({ dataDir });
  // 语言：跟随系统时用系统的首选语言（不支持的语言用英文）；偏好本身在 config.ui.lang
  setSystemLang(app.getPreferredSystemLanguages().map(normalizeLang).find(Boolean) ?? normalizeLang(app.getLocale()) ?? "en");
  setLangPref(config.ui.lang);
  // 桌面版：仅回环 + 每次启动随机令牌；端口沿用配置（默认 3600，被占用时自动换随机端口）
  config.ui.host = "127.0.0.1";
  if (!config.ui.token) config.ui.token = crypto.randomBytes(24).toString("base64url");
  registerSecret(config.ui.token);
  core = new App(config);
  core.desktop = {
    autostart: () => ({ supported: canAutostart, on: canAutostart && app.getLoginItemSettings().openAtLogin }),
    setAutostart,
    applyZoom: (z) => {
      win?.webContents.setZoomFactor(z);
      updateTitleBar(); // 叠层高度跟着缩放（调用方已把 z 写进 config.ui.zoom）
    },
    setTitleBarTheme: (dark) => {
      if (dark === titleBarDark) return;
      titleBarDark = dark;
      updateTitleBar();
    },
    openDataDir: () => void shell.openPath(config.dataDir),
    openPath: (p) => void shell.openPath(p),
    showItemInFolder: (p) => shell.showItemInFolder(p),
    openInBrowser: () => void shell.openExternal(entryUrl),
    openExternal: (url) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    },
    // 账户凭据用系统钥匙串加密（macOS 钥匙串、Windows DPAPI、Linux Secret Service）
    secretBox: safeStorage.isEncryptionAvailable()
      ? { encrypt: (plain) => safeStorage.encryptString(plain), decrypt: (data) => safeStorage.decryptString(data) }
      : undefined,
    // 下载内置 PowerShell 走 Chromium 的网络栈：和浏览器一样用系统代理设置与系统证书
    fetch: ((input: string | URL | Request, init?: RequestInit) => net.fetch(input instanceof URL ? input.href : input, init)) as typeof fetch,
    // 代理执行的命令用的系统代理：Chromium 按系统设置和 PAC 解析（代理进程每次拉起时问）
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
  };
  await core.start();
  if (!core.web) throw new Error(t("desktop.uiNotStarted"));
  // 规则的定时器：电脑醒来、解锁时马上重新看一遍（睡着时错过的按宽限期补跑一次或记为跳过）
  powerMonitor.on("resume", () => core?.tasks.scheduler.wake());
  powerMonitor.on("unlock-screen", () => core?.tasks.scheduler.wake());
  entryUrl = `${core.web.url.replace(/\/$/, "")}/?token=${encodeURIComponent(config.ui.token)}`;
  log.info(`数据目录：${dataDir}`);
  log.info(`管理界面：${core.web.url}`);
  if (!SMOKE) buildTray();
  // 「需要你」：托盘、角标、系统通知
  if (!SMOKE) core.attention.onChange(onAttention);
  const atLogin = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!atLogin || SMOKE) createWindow();
  if (SMOKE) await smoke(SMOKE);
}

async function smoke(out: string): Promise<void> {
  try {
    const wc = win!.webContents;
    await new Promise<void>((r) => (wc.isLoading() ? wc.once("did-finish-load", () => r()) : r()));
    // 未连接 Modelflare 时是引导页，已连接时是对话页；两者都带 data-screen
    let screen = "";
    for (let i = 0; i < 50; i++) {
      screen = String(await wc.executeJavaScript("document.querySelector('[data-screen]')?.getAttribute('data-screen') || ''"));
      if (screen) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const img = await wc.capturePage();
    fs.writeFileSync(out, img.toPNG());
    const status = await wc.executeJavaScript("fetch('/amb/api/status').then(r=>r.status)");
    const magpie = await wc.executeJavaScript("fetch('/magpie/').then(r=>r.status)");
    console.log(`SMOKE ${JSON.stringify({ hasUi: !!screen, screen, status, magpie, magpieState: core?.magpie?.state })}`);
  } finally {
    app.quit(); // 任何一步失败也退出，不让冒烟测试挂到超时
  }
}

// Windows 安装版是 GUI 程序：stdout/stderr 要么不存在，要么是别人的管道（读端关掉 = EPIPE，读端不读 = 同步写入卡住
// 主进程）。日志只写文件（设置 → 故障排查里能看），需要控制台输出时设 AMB_LOG_STDOUT=1。
if (process.platform === "win32" && app.isPackaged && process.env.AMB_LOG_STDOUT !== "1") setConsoleLog(false);

// 未捕获异常：Electron 默认弹一个同步的错误框，在用户关掉它之前整个主进程（本机服务、模型桥、所有对话）都卡住，
// 界面上就是一直"思考中"。这里改成记日志 + 非阻塞提示；stdio 写失败（EPIPE 等）只记日志不提示。
let lastErrorBox = 0;
process.on("uncaughtException", (e) => {
  const err = e as NodeJS.ErrnoException;
  log.error(`uncaught exception: ${err?.stack || String(e)}`);
  if (["EPIPE", "EBADF", "EOF", "ERR_STREAM_DESTROYED"].includes(String(err?.code))) return;
  if (Date.now() - lastErrorBox < 60_000 || !app.isReady()) return;
  lastErrorBox = Date.now();
  void dialog
    .showMessageBox({
      type: "error",
      title: PRODUCT,
      message: t("desktop.errorTitle", { product: PRODUCT }),
      detail: t("desktop.errorDetail", { message: err?.message ?? String(e), log: logFilePath() ?? t("desktop.logDisabled") }),
    })
    .catch(() => {});
});
process.on("unhandledRejection", (e) => log.warn(`unhandled rejection: ${(e as Error)?.stack || String(e)}`));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows 的系统通知（设置 › 常规 › 回复完成时通知）要求进程的 AppUserModelID 和安装器建的快捷方式一致（= build.appId）
  if (process.platform === "win32") app.setAppUserModelId("dev.anymodel.bot");
  app.on("second-instance", () => showWindow());
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.quit());
  app.on("window-all-closed", () => {
    if (!tray) app.quit(); // 有托盘时常驻
  });
  app.on("activate", () => entryUrl && showWindow());
  app.on("before-quit", (e) => {
    quitting = true;
    if (stopped || !core) return;
    e.preventDefault();
    const force = setTimeout(() => app.exit(1), 10_000);
    core
      .stop()
      .catch((err) => log.error(`退出时出错：${(err as Error).message}`))
      .finally(() => {
        clearTimeout(force);
        stopped = true;
        app.quit();
      });
  });
  app
    .whenReady()
    .then(boot)
    .catch((e) => {
      log.error((e as Error).stack || String(e));
      dialog.showErrorBox(t("desktop.bootFailed", { product: PRODUCT }), (e as Error).message);
      app.exit(1);
    });
}
