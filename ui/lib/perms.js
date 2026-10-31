// 文件权限的三个预设：输入框左下角的权限胶囊和机器人设置共用。完全权限有风险，切换前先确认。
import { confirmSheet } from "./store.js";

export const PERMS = {
  workspace: { label: "工作区可写", icon: "shield", note: "只能改这个机器人的工作区，越界操作先问你" },
  readonly: { label: "只读", icon: "lock", note: "不能改文件，命令在只读沙箱里运行" },
  full: { label: "完全权限", icon: "unlock", note: "命令不经沙箱，可读写你的所有文件；递归删除仍会先问你", danger: true },
};

/** 完全权限意味着什么（确认框与机器人设置里的提示用同一段话） */
export const FULL_WARNING =
  "命令不经沙箱，以你的用户身份直接运行：可以读取和修改你电脑上的任何文件，包括 AnyModelBot 自己的数据（会话记录、渠道令牌和密钥）。越界操作不再请求批准，只有递归删除（rm -r、Remove-Item -Recurse 等）仍会先问你。只在你信任当前模型和任务时开启。";

/** 切到完全权限前确认；切到其他预设不用 */
export function confirmPermission(p) {
  if (p !== "full") return Promise.resolve(true);
  return confirmSheet({ title: "开启完全权限？", body: FULL_WARNING, confirmLabel: "开启完全权限", danger: true });
}
