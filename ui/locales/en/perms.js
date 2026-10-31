// perms · en
export default {
  workspace: "Workspace write",
  workspaceNote: "Can only change this bot's workspace; anything outside asks you first",
  readonly: "Read-only",
  readonlyNote: "Can't change files; commands run in a read-only sandbox",
  full: "Full access",
  fullNote: "Commands run without a sandbox and can read and change all your files; recursive deletes still ask first",
  fullWarning: "Commands run without a sandbox, directly as your user: they can read and change any file on your computer, including AnyModelBot's own data (conversation history, channel tokens and keys). Out-of-bounds actions no longer ask for approval; only recursive deletes (rm -r, Remove-Item -Recurse and the like) still ask first. Only turn this on when you trust the current model and task.",
  confirmTitle: "Turn on full access?",
  confirmLabel: "Turn on full access",
};
