/**
 * macOS 电脑操作的系统权限（第 18 项）：辅助功能（点击、输入）和屏幕录制（看屏幕）。
 *
 * - 首次启动不索要任何权限；机器人真正要用电脑操作工具时，amb-computer-use-gate 插件经 bridge 问这里。
 *   缺哪项就拦下这次工具调用、记下"这个机器人在等授权"，宿主随即结束这一轮（不让模型反复重试），
 *   聊天里显示按缺项说明的授权卡片。普通聊天不受影响。
 * - 权限归属：Cua Driver 以 --direct 模式作为本应用的子进程运行，系统按"负责的进程"（本应用）判定授权，
 *   所以这里查的是本应用自己的授权状态（Electron systemPreferences）。尚未在 macOS 真机上验证这一点。
 * - 请求优先用系统原生的方式（辅助功能：系统的授权提示；屏幕录制：触发系统的录屏提示），不仿造系统弹窗；
 *   用户拒绝后不再自动弹，只在用户点"打开系统设置"时打开对应的设置页。
 * - 屏幕录制改了以后，系统通常要求重新打开应用才生效：用户请求过、状态却还没变成已授权时，界面提示可以重新打开应用。
 * 其他平台、命令行、Docker 没有这些钩子：一律放行（各平台另有自己的说明，见 cua-driver.ts）。
 */
import { CUA_INPUT_TOOLS } from "./cua-driver.js";
import type { Store } from "../../store/db.js";

export type CuPermissionKind = "accessibility" | "screen";
export type CuPermissionState = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

export interface CuPermissionHooks {
  status(): Record<CuPermissionKind, CuPermissionState>;
  /** 系统原生请求（只在用户点了以后调用） */
  request(kind: CuPermissionKind): Promise<void>;
  /** 打开系统设置里对应的那一页 */
  openSettings(kind: CuPermissionKind): void;
}

export const CU_PERMISSION_KINDS: readonly CuPermissionKind[] = ["accessibility", "screen"];

/** 不碰屏幕内容也不发输入的工具：不需要系统权限 */
const FREE_TOOLS = new Set(["list_apps", "check_permissions", "get_screen_size", "get_cursor_position"]);
/** 只看画面（截图、放大）：要屏幕录制 */
const SCREEN_ONLY = new Set(["zoom"]);
/** 读窗口结构又带截图：两项都要 */
const BOTH = new Set(["get_window_state", "get_desktop_state", "verify_state"]);

/**
 * 这个工具要哪些权限：发输入（点击、输入、按键、拖拽、启动应用、改窗口……）和读窗口列表走辅助功能；
 * 截图、放大走屏幕录制；读窗口状态的几个两样都要。不认识的工具按两样都要算（宁可多问一句）。
 */
export function permissionsFor(tool: string): CuPermissionKind[] {
  if (FREE_TOOLS.has(tool)) return [];
  if (SCREEN_ONLY.has(tool)) return ["screen"];
  if (BOTH.has(tool)) return ["accessibility", "screen"];
  if (CUA_INPUT_TOOLS.includes(tool) || tool === "list_windows") return ["accessibility"];
  return ["accessibility", "screen"];
}

export interface CuBlocked {
  missing: CuPermissionKind[];
  at: number;
  tool: string;
  conversationId?: string;
  sessionId?: string;
  messageId?: number;
  lastUserId?: number;
  background?: boolean;
  collapsed?: boolean;
  state?: "waiting" | "ready" | "continuing" | "done";
  completedAt?: number;
  requestText?: string;
}

export interface CuPermissionView {
  supported: boolean;
  status: Record<CuPermissionKind, CuPermissionState>;
  blocked: Record<string, CuBlocked>;
  /** 用户这次打开应用后请求过屏幕录制、状态还没变：可能要重新打开应用才生效 */
  restartSuggested: boolean;
}

export class CuPermissions {
  private blocked = new Map<string, CuBlocked>();
  private screenRequested = false;
  private requested = new Set<CuPermissionKind>();
  private store?: Store;
  private timer?: NodeJS.Timeout;
  private resume?: (botId: string, pending: CuBlocked) => Promise<void>;

  constructor(private hooks: () => CuPermissionHooks | undefined) {}

  bindStore(store: Store): void {
    this.store = store;
    try {
      const saved = JSON.parse(store.getKV("cu.pending") || "{}");
      for (const [id, value] of Object.entries(saved)) {
        const p = value as CuBlocked;
        // 恢复过程中退出后不自动重放：需要用户显式继续。
        this.blocked.set(id, { ...p, ...(p.state === "continuing" ? { state: "ready" as const } : {}) });
      }
      this.requested = new Set(JSON.parse(store.getKV("cu.requested") || "[]"));
    } catch { this.blocked.clear(); }
  }
  private save(): void { this.store?.setKV("cu.pending", JSON.stringify(Object.fromEntries(this.blocked))); }
  attach(botId: string, pending: Partial<CuBlocked>): void {
    const b = this.blocked.get(botId);
    if (b && pending.background && this.store && !pending.messageId) {
      const conv = this.store.ensureConversation(botId, "web", "console", "控制台");
      pending.messageId = this.store.addMessage(conv.id, "assistant", "", undefined, { permissionWait: true });
    }
    if (b) { this.blocked.set(botId, { ...b, ...pending, state: "waiting" }); this.save(); }
  }
  start(resume: (botId: string, pending: CuBlocked) => Promise<void>): void {
    this.resume = resume;
    clearInterval(this.timer);
    this.timer = setInterval(() => { void this.check(); }, 3000);
    this.timer.unref?.();
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined; }
  async check(botId?: string, force = false): Promise<void> {
    if (!this.supported) return;
    const status = this.status();
    for (const [id, pending] of this.blocked) {
      if (botId && botId !== id) continue;
      if (pending.state === "done") {
        if (Date.now() - (pending.completedAt || 0) >= 5000) { this.blocked.delete(id); this.save(); }
        continue;
      }
      if (pending.state === "continuing" || pending.missing.some((k) => status[k] !== "granted")) continue;
      if (pending.background) { pending.state = "done"; pending.completedAt = Date.now(); this.save(); continue; }
      if (!pending.conversationId || !pending.messageId || !this.resume) continue;
      const lastUser = this.store?.listMessages(pending.conversationId, 30).filter((m) => m.role === "user").at(-1)?.id || 0;
      if (!force && (pending.state === "ready" || Date.now() - pending.at > 30 * 60_000 || lastUser !== pending.lastUserId)) {
        pending.state = "ready"; this.save(); continue;
      }
      pending.state = "continuing"; this.save();
      try {
        await this.resume(id, { ...pending });
        if (this.blocked.get(id) === pending) { pending.state = "done"; pending.completedAt = Date.now(); }
      } catch (error) { if (this.blocked.get(id) === pending) pending.state = (error as { retryable?: boolean })?.retryable ? "waiting" : "ready"; }
      this.save();
    }
  }

  get supported(): boolean {
    return !!this.hooks();
  }

  private status(): Record<CuPermissionKind, CuPermissionState> {
    const h = this.hooks();
    if (!h) return { accessibility: "granted", screen: "granted" };
    try {
      return h.status();
    } catch {
      return { accessibility: "unknown", screen: "unknown" };
    }
  }

  /** 这次工具调用缺哪些权限（tool 是去掉 mcp__computer-use__ 前缀的工具名） */
  missing(tool: string): CuPermissionKind[] {
    const need = permissionsFor(tool);
    if (!this.supported || !need.length) return [];
    const st = this.status();
    return need.filter((k) => st[k] !== "granted");
  }

  /** 插件问：放行，或者记下这个机器人在等授权 */
  gate(botId: string, tool: string): { ok: true } | { ok: false; missing: CuPermissionKind[] } {
    const missing = this.missing(tool);
    if (!missing.length) {
      // 授权后重新发起的任务能用了：收起这个机器人的授权卡片
      if (!FREE_TOOLS.has(tool) && !this.blocked.get(botId)?.conversationId) { this.blocked.delete(botId); this.save(); }
      return { ok: true };
    }
    this.blocked.set(botId, { missing, at: Date.now(), tool, state: "waiting" });
    this.save();
    return { ok: false, missing };
  }

  isBlocked(botId: string): boolean {
    const p = this.blocked.get(botId);
    return !!p && p.state !== "done" && p.state !== "continuing";
  }

  /** 用户点了"稍后"或者已经重新发起任务：收起这个机器人的授权卡片 */
  dismiss(botId: string): void {
    const p = this.blocked.get(botId);
    if (p) p.collapsed = true;
    this.save();
  }
  expand(botId: string): void {
    const pending = this.blocked.get(botId);
    if (pending) { pending.collapsed = false; this.save(); }
  }

  async request(kind: CuPermissionKind): Promise<void> {
    if (this.requested.has(kind)) return this.openSettings(kind);
    this.requested.add(kind);
    this.store?.setKV("cu.requested", JSON.stringify([...this.requested]));
    if (kind === "screen") this.screenRequested = true;
    await this.hooks()?.request(kind);
  }

  openSettings(kind: CuPermissionKind): void {
    if (kind === "screen") this.screenRequested = true;
    this.hooks()?.openSettings(kind);
  }

  view(): CuPermissionView {
    const status = this.status();
    return {
      supported: this.supported,
      status,
      blocked: Object.fromEntries(this.blocked),
      restartSuggested: this.screenRequested && status.screen !== "granted",
    };
  }
}
