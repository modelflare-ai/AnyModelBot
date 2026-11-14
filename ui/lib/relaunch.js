// 只在用户选择重新打开时暂存；恢复完成后由后端删除，不持续保存输入内容。
import { allDrafts, restoreDrafts } from "./chat-view.js";
import { blankBotDraft, templateFlow } from "./template-flow.js";
import { templateDraft } from "./guide.js";

export function relaunchDrafts() {
  return {
    drafts: allDrafts(),
    forms: { blank: blankBotDraft.get(), flow: templateFlow.get(), onboarding: templateDraft.get() },
  };
}

export function restoreRelaunchDrafts(data) {
  restoreDrafts(data.drafts);
  const forms = data.forms;
  if (!forms || typeof forms !== "object") return;
  if (forms.blank && !blankBotDraft.get()) blankBotDraft.set(forms.blank);
  if (forms.onboarding && !templateDraft.get()) templateDraft.set(forms.onboarding);
  if (forms.flow?.preview && !templateFlow.get().preview) {
    templateFlow.set({ ...forms.flow, preview: { ...forms.flow.preview, busy: false } });
  }
}
