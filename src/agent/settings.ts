/** 每个机器人的身份与行为设置（存在 bots.settings JSON 列，网页可编辑）。 */
export type PermissionPreset = "readonly" | "workspace";
export type CuBackend = "cua" | "codex";
export type CuApproval = "auto" | "ask-input";

export interface BotSettings {
  /** 权限预设：readonly = 只读（不能改文件、命令只读沙箱）；workspace = 可写本机器人工作区（默认），越界操作需审批 */
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
  /** 后台小任务（记忆整理、上下文管家、交接摘要）用的模型；空 = 用对话模型 */
  utilityModel: string;
}

export const DEFAULT_SETTINGS: BotSettings = {
  permission: "workspace",
  memory: { enabled: true, review: true, teamWrite: false },
  steward: { enabled: true },
  computerUse: { enabled: true, backend: "cua", approval: "auto" },
  utilityModel: "",
};

export function normalizeSettings(raw: unknown): BotSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const m = r.memory && typeof r.memory === "object" ? r.memory : {};
  const st = r.steward && typeof r.steward === "object" ? r.steward : {};
  const cu = r.computerUse && typeof r.computerUse === "object" ? r.computerUse : {};
  const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    permission: r.permission === "readonly" ? "readonly" : "workspace",
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
    utilityModel: typeof r.utilityModel === "string" ? r.utilityModel.trim().slice(0, 200) : "",
  };
}

export function permissionMode(p: PermissionPreset): string {
  return p === "readonly" ? "read-only" : "workspace-write";
}
