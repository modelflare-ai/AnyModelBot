// perms · zh-CN
export default {
  workspace: "工作区可写",
  workspaceNote: "只能改这个机器人的工作区，越界操作先问你",
  readonly: "只读",
  readonlyNote: "不能改文件，命令在只读沙箱里运行",
  full: "完全权限",
  fullNote: "命令不经沙箱，可读写你的所有文件；递归删除仍会先问你",
  fullWarning: "命令不经沙箱，以你的用户身份直接运行：可以读取和修改你电脑上的任何文件，包括 AnyModelBot 自己的数据（会话记录、渠道令牌和密钥）。越界操作不再请求批准，只有递归删除（rm -r、Remove-Item -Recurse 等）仍会先问你。只在你信任当前模型和任务时开启。",
  confirmTitle: "开启完全权限？",
  confirmLabel: "开启完全权限",
};
