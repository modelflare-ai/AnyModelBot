/**
 * 导出成 Markdown（3f）：规则的运行记录、任务的每次运行（结果、花费和折叠起来的处理过程）。
 * 给人看的文字跟着当前语言（接口用请求里的语言），时间按主人的时区写成 2026-11-01 08:00。写库、取数据的是任务服务。
 */
import type { ActivityStep } from "../agent/activity.js";
import { localParts } from "../core/quiet.js";
import { t as tr, tMaybe } from "../i18n/index.js";
import { usdText } from "./cost.js";
import type { RuleRunView, RuleView } from "./rules.js";
import type { Stage } from "./stage.js";

const pad2 = (n: number) => String(n).padStart(2, "0");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** 多行的文字放进引用块 */
const quote = (s: string) =>
  s
    .trim()
    .split("\n")
    .map((l) => `> ${l}`.trimEnd())
    .join("\n");

/** 2026-11-01 08:00（主人的时区） */
export function stampOf(ts: number, tz: string): string {
  const p = localParts(ts, tz);
  const m = Math.floor(p.minute);
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 有了花费才写（不到一分钱不写） */
const cost = (usd: number) => (usd >= 0.005 ? tr("tasks.exportCost", { spent: usdText(usd) }) : "");

/** 处理过程：一步一行（工具名：命令、路径或回复开头），出错的标出来 */
export function stepLines(steps: ActivityStep[]): string[] {
  return steps.map((s) => {
    const what = clip(oneLine(s.summary || ""), 200);
    const head = what ? `${s.title}: ${what}` : s.title;
    return `- ${head}${s.status === "error" ? ` (${tr("tasks.exportStepFailed")})` : ""}`;
  });
}

export interface ExportedRuleRun extends RuleRunView {
  stepList: ActivityStep[];
}

/** 规则：标题、原话、时间表和状态、本月花费，再是运行记录（新→旧），每次一节 */
export function ruleMarkdown(rule: RuleView, when: string, runs: ExportedRuleRun[], tz: string, now: number): string {
  const words = rule.kind === "remind" ? rule.message : rule.instruction;
  const month = rule.kind === "check" ? tr("tasks.exportMonth", { spent: usdText(rule.monthUsd), budget: usdText(rule.monthBudgetUsd) }) : "";
  const out = [`# ${rule.title}`, "", quote(words), "", [when, rule.state.label, month].filter(Boolean).join(" · "), "", tr("tasks.exportedAt", { time: stampOf(now, tz) }), "", `## ${tr("tasks.exportLog")}`, ""];
  if (!runs.length) out.push(tr("tasks.exportNoRuns"), "");
  for (const r of runs) {
    const mode = rule.kind === "remind" ? "" : (tMaybe(`tasks.exportMode_${r.mode}`) ?? "");
    out.push(`### ${[stampOf(r.at, tz), mode, cost(r.costUsd)].filter(Boolean).join(" · ")}`, "", r.line, "");
    if (r.summary && oneLine(r.summary) !== oneLine(r.line)) out.push(r.summary.trim(), "");
    if (r.would) out.push(`${tr("tasks.exportWould")}: ${r.would}`, "");
    const meta = [tr("tasks.exportVersion", { n: r.version }), r.permission].filter(Boolean).join(" · ");
    if (meta) out.push(meta, "");
    if (r.stepList.length) out.push(...stepLines(r.stepList), "");
  }
  return out.join("\n").trimEnd() + "\n";
}

export interface ExportedTaskRun {
  cause: string;
  outcome: string;
  error: string;
  message: string;
  summary: string;
  question: string;
  costUsd: number;
  queuedAt: number;
  startedAt: number;
  endedAt: number;
  steps: ActivityStep[];
}

/** 一次运行的结果：给用户的那句、失败原因、问用户的问题；停下、中断等用阶段的说法 */
function outcomeLine(r: ExportedTaskRun): string {
  if (r.outcome === "done") return r.message || tr("tasks.stageReady");
  if (r.outcome === "failed") return tr("tasks.exportFailed", { why: r.message || r.error || tr("tasks.noResult") });
  if (r.outcome === "needs_you") return r.question ? tr("tasks.exportAsked", { question: r.question }) : tr("tasks.stageAnswer");
  if (r.outcome === "budget") return tr("tasks.stageBudget");
  if (r.outcome === "stopped") return tr("tasks.stageStopped");
  if (r.outcome === "interrupted") return tr("tasks.exportInterrupted");
  return r.outcome ? r.outcome : tr("tasks.stageWorking");
}

/** 任务：标题、状态和花费、来自哪里（渠道、时间、原话）、文件夹、最新进展，再是每次运行（旧→新） */
export function taskMarkdown(
  task: { title: string; stage: Stage; spentUsd: number; budgetUsd: number; folder: string; latest: string },
  origin: { channel: string; at: number; text: string } | undefined,
  runs: ExportedTaskRun[],
  tz: string,
  now: number,
): string {
  const head = [task.stage.label, tr("tasks.exportBudget", { spent: usdText(task.spentUsd), budget: usdText(task.budgetUsd) })].join(" · ");
  const out = [`# ${task.title}`, "", head, ""];
  if (origin) {
    out.push(`- ${tr("tasks.exportFrom")}: ${[origin.channel, stampOf(origin.at, tz)].filter(Boolean).join(" · ")}`);
  }
  out.push(`- ${tr("tasks.exportFolder")}: \`${task.folder}\``);
  if (task.latest) out.push(`- ${tr("tasks.exportLatest")}: ${task.latest}`);
  out.push(`- ${tr("tasks.exportedAt", { time: stampOf(now, tz) })}`, "");
  if (origin?.text) out.push(quote(origin.text), "");
  runs.forEach((r, i) => {
    const mins = r.startedAt ? Math.max(1, Math.round(((r.endedAt || now) - r.startedAt) / 60_000)) : 0;
    const cause = tMaybe(`tasks.exportCause_${r.cause}`) ?? r.cause;
    const title = [tr("tasks.exportRun", { n: i + 1 }), cause, stampOf(r.queuedAt, tz), mins ? tr("tasks.exportMinutes", { count: mins }) : "", cost(r.costUsd)].filter(Boolean).join(" · ");
    out.push(`## ${title}`, "", outcomeLine(r), "");
    if (r.summary && oneLine(r.summary) !== oneLine(r.message)) out.push(r.summary.trim(), "");
    if (r.steps.length) out.push(...stepLines(r.steps), "");
  });
  return out.join("\n").trimEnd() + "\n";
}

/** 下载时的文件名：标题里不能进文件名的字符换成 -（Content-Disposition 用 RFC 5987 编码，中文照样） */
export function exportFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "export";
  return `${base}.md`;
}
