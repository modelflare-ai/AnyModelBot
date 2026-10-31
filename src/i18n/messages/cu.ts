// cu：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  // Codex Computer Use 桥（computer-use.ts）
  codexUnavailable: "Codex Computer Use 桥: 需要 macOS 14.4+ 和已安装的 Codex Computer Use",
  codexOff: "{base}（{why}）",
  codexNotMac: "当前系统不是 macOS",
  codexOldMac: "macOS 版本低于 14.4",
  codexNoBridge: "安装包缺少 kimi-computer-use 组件",
  codexNoClient: "未找到 Codex Computer Use 客户端",
  codexNoLauncher: "未找到 ChatGPT/Codex 应用自带的 codex 启动器",
  codexAvailable: "Codex Computer Use 桥: 可用（macOS）",
  codexFallback: "（Codex 桥不可用，已改用 Cua Driver：{reason}）",
  // Cua Driver（cua-driver.ts）
  cuaOff: "Cua Driver: 不可用（{why}）",
  cuaAvailable: "Cua Driver: 可用（{os}）",
  cuaUnsupported: "不支持 {platform}",
  cuaMissing: "安装包缺少 {plat} 的 cua-driver {version}",
  cuaNoDisplay: "没有图形会话：DISPLAY / WAYLAND_DISPLAY 均未设置",
  cuaAtspi: "需要 AT-SPI（at-spi2-core）才能读取窗口元素",
  cuaWayland: "Wayland 会话：功能降级——窗口读取依赖 AT-SPI，键鼠输入走 XWayland，只能操作前台窗口；{atspi}",
  cuaX11: "X11 会话；{atspi}",
  cuaMacNotice: "首次使用需在「系统设置 → 隐私与安全性」给本应用打开「辅助功能」和「屏幕录制」。以 --direct 模式运行，授权应归属本应用（尚未在真机验证）。",
  cuaWinNotice: "需在已登录用户的交互式桌面会话中运行；无法操作以管理员权限运行的窗口（除非本应用也以管理员运行）。",
  cuaNonInteractive: "需要在已登录用户的交互式会话中运行（检测到服务或非交互会话）",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  codexUnavailable: "Codex Computer Use bridge: requires macOS 14.4+ with Codex Computer Use installed",
  codexOff: "{base} ({why})",
  codexNotMac: "this system isn't macOS",
  codexOldMac: "macOS is older than 14.4",
  codexNoBridge: "the kimi-computer-use component is missing from the installation",
  codexNoClient: "Codex Computer Use client not found",
  codexNoLauncher: "the codex launcher bundled with the ChatGPT/Codex app was not found",
  codexAvailable: "Codex Computer Use bridge: available (macOS)",
  codexFallback: " (Codex bridge unavailable, using Cua Driver instead: {reason})",
  cuaOff: "Cua Driver: unavailable ({why})",
  cuaAvailable: "Cua Driver: available ({os})",
  cuaUnsupported: "{platform} is not supported",
  cuaMissing: "cua-driver {version} for {plat} is missing from the installation",
  cuaNoDisplay: "no graphical session: neither DISPLAY nor WAYLAND_DISPLAY is set",
  cuaAtspi: "reading window elements requires AT-SPI (at-spi2-core)",
  cuaWayland: "Wayland session: limited — reading windows relies on AT-SPI, keyboard and mouse input go through XWayland, and only the foreground window can be operated; {atspi}",
  cuaX11: "X11 session; {atspi}",
  cuaMacNotice:
    "On first use, turn on Accessibility and Screen Recording for this app in System Settings → Privacy & Security. It runs in --direct mode, so the permissions should belong to this app (not yet verified on a real Mac).",
  cuaWinNotice: "Must run in a signed-in user's interactive desktop session; windows running as administrator can't be operated (unless this app also runs as administrator).",
  cuaNonInteractive: "must run in a signed-in user's interactive session (a service or non-interactive session was detected)",
};
