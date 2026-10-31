// 文件权限的三个预设：输入框左下角的权限胶囊和机器人设置共用。完全权限有风险，切换前先确认。
// 文案跟着界面语言：写成函数，渲染时再取（不在模块顶层缓存翻译）。
import { confirmSheet } from "./store.js";
import { t } from "./i18n.js";

export const perms = () => ({
  workspace: { label: t("perms.workspace"), icon: "shield", note: t("perms.workspaceNote") },
  readonly: { label: t("perms.readonly"), icon: "lock", note: t("perms.readonlyNote") },
  full: { label: t("perms.full"), icon: "unlock", note: t("perms.fullNote"), danger: true },
});

/** 完全权限意味着什么（确认框与机器人设置里的提示用同一段话） */
export const fullWarning = () => t("perms.fullWarning");

/** 切到完全权限前确认；切到其他预设不用 */
export function confirmPermission(p) {
  if (p !== "full") return Promise.resolve(true);
  return confirmSheet({ title: t("perms.confirmTitle"), body: fullWarning(), confirmLabel: t("perms.confirmLabel"), danger: true });
}
