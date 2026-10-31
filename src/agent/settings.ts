/** 每个机器人的身份与行为设置（存在 bots.settings JSON 列，网页可编辑）。 */
export type PermissionPreset = "readonly" | "workspace" | "full";
export type CuBackend = "cua" | "codex";
export type CuApproval = "auto" | "ask-input";
/** auto = 只在需要时问（模型不是默认的、预计花费超过上限、要求不明确）；always = 每次生成前都问 */
export type MediaConfirm = "auto" | "always";
/** 内置头像角色（ui/components/avatar.js 的 BOT_CHARS）；blue 是主角 */
export const BOT_AVATARS = ["blue", "yellow", "green", "red", "purple", "orange"] as const;
export type BotAvatarKey = (typeof BOT_AVATARS)[number];

export interface BotSettings {
  /**
   * 权限预设：readonly = 只读（不能改文件、命令只读沙箱）；workspace = 可写本机器人工作区（默认），越界操作需审批；
   * full = 完全权限：命令不进沙箱、不再请求提权，以用户身份读写任何文件，只有递归删除仍要用户确认
   */
  permission: PermissionPreset;
  memory: {
    enabled: boolean;
    /** 回合结束后自动整理记忆 */
    review: boolean;
    /** 是否允许写团队记忆（所有机器人共享） */
    teamWrite: boolean;
  };
  steward: {
    enabled: boolean;
  };
  /** 电脑操作 */
  computerUse: {
    enabled: boolean;
    /** cua = 随附的 Cua Driver（默认，三个平台）；codex = macOS 上的 Codex Computer Use 桥（kimi-computer-use） */
    backend: CuBackend;
    /** auto = 所有操作自动执行（默认）；ask-input = 点击/输入等改变界面的操作先问用户，读取界面仍自动 */
    approval: CuApproval;
  };
  /** 生图 / 生视频 */
  media: {
    /** 生成前什么时候问用户用哪个模型（manager.ts mediaAsk） */
    confirm: MediaConfirm;
  };
  /** 后台小任务（记忆整理、上下文管家、交接摘要）用的模型；空 = 用对话模型 */
  utilityModel: string;
  /** 头像角色；空 = 由机器人 id 决定 */
  avatar: BotAvatarKey | "";
  /**
   * 预算（需要登录 Modelflare 账户）：开启后机器人用自己的 API Key，最多花 limitUsd 美元
   * （包括这把 Key 已经花掉的）；关闭时与其他机器人共用本机的 Key。
   */
  budget: { enabled: boolean; limitUsd: number };
}

export const DEFAULT_SETTINGS: BotSettings = {
  permission: "workspace",
  memory: { enabled: true, review: true, teamWrite: false },
  steward: { enabled: true },
  computerUse: { enabled: true, backend: "cua", approval: "auto" },
  media: { confirm: "auto" },
  utilityModel: "",
  avatar: "",
  budget: { enabled: false, limitUsd: 5 },
};

export function normalizeSettings(raw: unknown): BotSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const m = r.memory && typeof r.memory === "object" ? r.memory : {};
  const st = r.steward && typeof r.steward === "object" ? r.steward : {};
  const cu = r.computerUse && typeof r.computerUse === "object" ? r.computerUse : {};
  const bg = r.budget && typeof r.budget === "object" ? r.budget : {};
  const md = r.media && typeof r.media === "object" ? r.media : {};
  const limit = Number(bg.limitUsd);
  const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    permission: r.permission === "readonly" || r.permission === "full" ? r.permission : "workspace",
    memory: {
      enabled: b(m.enabled, DEFAULT_SETTINGS.memory.enabled),
      review: b(m.review, DEFAULT_SETTINGS.memory.review),
      teamWrite: b(m.teamWrite, DEFAULT_SETTINGS.memory.teamWrite),
    },
    steward: { enabled: b(st.enabled, DEFAULT_SETTINGS.steward.enabled) },
    computerUse: {
      enabled: b(cu.enabled, DEFAULT_SETTINGS.computerUse.enabled),
      backend: cu.backend === "codex" ? "codex" : "cua",
      // 旧值（always / readonly-free）一律迁移为自动执行
      approval: cu.approval === "ask-input" ? "ask-input" : "auto",
    },
    // 以前每次都问；升级后默认只在需要时问
    media: { confirm: md.confirm === "always" ? "always" : "auto" },
    utilityModel: typeof r.utilityModel === "string" ? r.utilityModel.trim().slice(0, 200) : "",
    avatar: (BOT_AVATARS as readonly string[]).includes(r.avatar) ? r.avatar : "",
    budget: {
      enabled: b(bg.enabled, DEFAULT_SETTINGS.budget.enabled),
      limitUsd: Number.isFinite(limit) && limit >= 0 && limit <= 100_000 ? Math.round(limit * 100) / 100 : DEFAULT_SETTINGS.budget.limitUsd,
    },
  };
}

/** DSH 的沙箱模式。full 用 danger-full-access，但宿主会把它的审批策略从 never 改成 ask（递归删除还要问，见 host.ts） */
export function permissionMode(p: PermissionPreset): string {
  return p === "readonly" ? "read-only" : p === "full" ? "danger-full-access" : "workspace-write";
}
