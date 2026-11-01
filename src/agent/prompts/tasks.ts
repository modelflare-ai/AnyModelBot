/**
 * 后台任务的提示词：任务会话的系统提示词段（amb-tasks 插件加在机器人段之后，优先于聊天规则）、任务的第一条输入、
 * 重启后的恢复说明、没有报告时的提醒。改这里的文字要过 test/prompts.unit.test.ts（必须有、不能有的句子和长度上限）。
 *
 * 沟通规则改编自 dsh-superagent（MIT，DeepSeek）的 worker 提示词：只在做完、需要决定或做不下去时说话，一句话，不汇报进展。
 * 需要决定时：自己定，在结果里说明选了什么；语言、格式、范围、风格从不问（产品负责人 2026-11-01：自动做，不要一直问）。
 * 只在猜错会造成损失、花钱或白做大半，要用户才有的东西（登录、文件、密码），或这一步不可撤回时问，一次一个问题。
 * 猜错只会白做的尽早问、带上 default（3b 之后的不阻塞提问），接着做不依赖回答的部分，没等到回答就按默认做完；
 * 其余的先做完不依赖它的部分再问，结束这一轮等回答。
 */

/** 任务会话的系统提示词段：名字与位置（排在机器人段 amb:bot 之后，同时冲突时以它为准） */
export const TASK_SECTION = "amb:task";
export const TASK_SECTION_ORDER = 20_100;

/** 任务会话的规则 */
export const TASK_RULES = [
  "# 后台任务（优先于上面的聊天规则）",
  "你在后台独立完成一个任务，用户不在旁边。任务和用户的原话在第一条消息里；当前目录是这个任务的文件夹，产出的文件放在这里。",
  "- 自己做决定，在结果里说明选了什么。语言、格式、范围、风格都不问：用对话的语言，选最合理的做法。",
  "- 只在这些时候用 task_report 报 needs_you 问一个问题：猜错会造成损失、花钱或白做大半；要用户才有的东西（登录、文件、密码）；这一步不可撤回（付款、删除用户的数据、给别人发消息）。",
  "  猜错只会白做的，尽早问、给 default，接着只做不依赖回答的部分，做完还没回答就按默认；其余的先做完不依赖回答的部分再问，然后结束这一轮。",
  "- 做会改变外部的事（发送、发帖、付款、删除、调用会改动东西的接口）之前和之后，各在 .task/journal.md 里追加一行。",
  "- 做完或做不下去时调用 task_report：state 为 done 或 failed，message 是给用户的一句话（不超过 300 字：结果是什么、在哪里），files 列出要发给用户的文件。然后结束这一轮。",
  "- 中途不用汇报；想记下进展可以报 progress，不会发给用户。",
  "- 不调用 task_report，用户就收不到任何结果。",
].join("\n");

export interface TaskBriefInput {
  title: string;
  /** 用户的原话（原样） */
  original: string;
  /** 对话助手写的说明（最多 1500 字） */
  brief: string;
  /** 请求之前的最近几条对话 */
  recent: Array<{ role: "user" | "assistant"; text: string }>;
  /** 附件在工作区里的路径（inbox/…） */
  attachments: string[];
  /** 冻结的记忆快照；undefined = 关着记忆 */
  memory?: string;
  /** 任务文件夹（相对工作区） */
  folder: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** 任务的第一条输入：用户原话在最前（说明不能替代原话），再是说明、最近的对话、附件、记忆快照 */
export function taskBrief(o: TaskBriefInput): string {
  const parts = [`[后台任务]\n${o.title}（文件夹 ${o.folder}）`, `[用户的原话]\n${o.original.trim()}`];
  if (o.brief.trim()) parts.push(`[对话助手的说明]\n${clip(o.brief.trim(), 1500)}`);
  if (o.recent.length) parts.push(`[之前的对话]\n${o.recent.map((m) => `${m.role === "user" ? "用户" : "助手"}：${clip(m.text.replace(/\s+/g, " ").trim(), 300)}`).join("\n")}`);
  if (o.attachments.length) parts.push(`[附件]\n${o.attachments.join("\n")}`);
  if (o.memory !== undefined) parts.push(`[长期记忆快照]\n${o.memory.trim() || "（目前为空）"}`);
  return parts.join("\n\n");
}

/** 用户原话里提到的工作区附件（inbox/…） */
export function attachmentsOf(text: string): string[] {
  return [...new Set(text.match(/inbox\/[^\s\]]+/g) ?? [])];
}

/**
 * 重启后的第一条输入（给模型的，英文，和技能说明一样）：上一步可能没做完，后台命令被停了；重复外部动作之前先看日志和外部系统。
 * jobs：被停掉的后台命令（没有就是 none）。
 */
export function recoveryNote(jobs: string[]): string {
  const list = jobs.length ? jobs.join("; ") : "none";
  return `The app restarted while you were working on this task. Your last step may not have finished, and these background jobs were stopped: ${list}. Before repeating any outside action (sending, posting, paying, deleting, or calling an API that changes something), read \`.task/journal.md\`, check your folder and check the outside system. Then continue and report with task_report.`;
}

/**
 * 被宿主停下之后接着做（3e，给模型的，英文）：budget = 任务的预算用完停下、用户加了预算；reserve = 机器人的预算快用完时
 * 为了给聊天留着而暂停、现在恢复了。和恢复说明一样：上一步可能没做完，后台命令被停了，重复外部动作之前先查。
 */
export function resumeNote(why: "budget" | "reserve", jobs: string[]): string {
  const list = jobs.length ? jobs.join("; ") : "none";
  const head = why === "budget" ? "This task was stopped when it used its budget, and the user has now added more." : "The app paused this task to keep the bot's remaining budget for chat, and has now resumed it.";
  return `${head} Your last step may not have finished, and these background jobs were stopped: ${list}. Before repeating any outside action, read \`.task/journal.md\` and check your folder. Then continue and report with task_report.`;
}

/** 一轮结束了却没有 task_report：提醒一次 */
export const NUDGE = "Report this task's state with task_report now: state done with a one-line message for the user if it is finished, failed with the reason if you cannot finish it. If there is still work to do, do it first and then report.";

/** 上一轮出错（模型请求失败等）：过一会儿接着做 */
export function retryNote(error: string): string {
  return `Your previous step failed with an error: ${clip(error.replace(/\s+/g, " "), 300)}. Continue the task from where you were, and report with task_report when it is done.`;
}

/** 会话没法恢复、换了新会话：从宿主记下的任务重新交代一遍 */
export function rebrief(brief: string, last: string | undefined): string {
  return `${brief}\n\n[说明]\n之前的会话记录丢了，这是重新交代。${last ? `上次的进展：${clip(last, 600)}。` : ""}先看看文件夹里已经有什么，再接着做。`;
}
