/**
 * 构造要发出的工单：结构化字段 + 本人在预览里看到的完整正文。只在本机做，不调用模型、不改写本人的话。
 *
 * 正文 = 本人写的内容（原样，已脱敏）→ 补充场景 / 合作背景 → 分隔行 → 分类、入口、场景、联系许可、联系方式、环境
 * → 已选的报错和诊断。可读标签按界面语言写，后面跟着和语言无关的机器标签（[ticket_type:use_case]、
 * [contact_consent:true]…）。Modelflare 核对这些标签和结构化字段一致、本人写的每一段都原样出现在正文里，
 * 对不上就拒收；标签不能代替结构化字段，本人在描述里打的同名标签会被当成冲突而不是第二个来源。
 *
 * 预算：主内容和联系方式先占，技术材料（报错、运行状态、日志）用剩下的额度，超出时有提示地裁剪；
 * 主内容本身超限就报错阻止，从不截断本人的话或剪断联系方式。
 */
import os from "node:os";
import { t } from "../i18n/index.js";
import { redactText } from "../log.js";
import { appVersion } from "../version.js";
import {
  BUSINESS_TEXT_KEYS,
  CONTEXT_KEYS,
  FEEDBACK_SCENARIOS,
  LEGACY_KIND,
  LIMITS,
  PRODUCT_INTERESTS,
  TEAM_SIZES,
  codePoints,
  effectiveText,
  normalizeText,
  validateDraft,
  type BusinessRole,
  type ContactChoice,
  type FeedbackScenario,
  type FeedbackSource,
  type FeedbackTab,
  type FieldError,
  type TabDraft,
} from "./model.js";

export interface FeedbackEnvironment {
  app_version: string;
  runtime: "desktop" | "web";
  locale: string;
  os_family: string;
  arch: string;
}

/** 最小环境：版本、运行方式、界面语言；问题分类另带系统家族和架构。主机名、路径、设备 ID 都不带 */
export function feedbackEnvironment(locale: string): FeedbackEnvironment {
  const family = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "other";
  return {
    app_version: appVersion().slice(0, 32),
    runtime: process.versions.electron ? "desktop" : "web",
    locale: /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(locale) ? locale : "en",
    os_family: family,
    arch: String(os.arch()).slice(0, 32),
  };
}

const LANGUAGE_NAMES: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文（台灣）",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  ru: "Русский",
  es: "Español",
  pt: "Português (Brasil)",
  tr: "Türkçe",
};
const OS_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux", other: "Other" };

/** 环境那一行（界面上"版本 0.1.42 · macOS · 桌面版"也用它的各段） */
export function environmentLine(env: FeedbackEnvironment, tab: FeedbackTab): string {
  const parts = [`AnyModelBot ${env.app_version}`, t(`feedback.runtime_${env.runtime}`), LANGUAGE_NAMES[env.locale] ?? env.locale];
  if (tab === "bug") parts.push(`${OS_NAMES[env.os_family] ?? env.os_family} ${env.arch}`);
  return t("feedback.line_environment", { value: parts.join(" · ") });
}

/** 本人在描述里写的同名机器标签：会被 Modelflare 当成冲突拒收，所以先在本机指出来 */
const TAG = /\[(ticket_type|source|scenario|role|contact_consent|contact_method):[^\]\s]*\]/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
/** 技术材料里的控制字符（终端颜色码等）去掉：工单正文只收可读文本 */
const clean = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

export interface ComposeInput {
  tab: FeedbackTab;
  source: FeedbackSource;
  draft: TabDraft;
  contact: ContactChoice;
  identity: { email?: string; revision?: string };
  policyVersion: string;
  environment: FeedbackEnvironment;
  diagnostics?: { includeError?: boolean; includeLogs?: boolean };
  errorContext?: { text?: string; requestId?: string; model?: string };
  /** 勾了运行状态和日志才读（读的时候已脱敏） */
  logs?: { summary: string; lines: string[] };
  clientSubmissionId: string;
}

export interface Composed {
  payload: Record<string, unknown>;
  body: string;
  /** 预览里"未包含"列表（按实际内容变化） */
  notIncluded: string[];
  notices: { errorTrimmed?: boolean; diagnosticsTrimmed?: boolean };
}

export class ComposeError extends Error {
  constructor(readonly errors: FieldError[]) {
    super(errors.map((e) => `${e.field}:${e.code}`).join(", "));
  }
}

/** 从开头取 max 个码点（不加省略号：要原样出现在正文里，Modelflare 按原文核对） */
const head = (s: string, max: number) => {
  const a = [...s];
  return a.length <= max ? s : a.slice(0, Math.max(0, max)).join("");
};

/** 运行状态取开头的整行，日志取结尾的整行，都不超过额度 */
function headLines(text: string, max: number): string {
  const out: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const n = codePoints(line) + 1;
    if (used + n > max) break;
    out.push(line);
    used += n;
  }
  return out.join("\n").trim();
}
function tailLines(lines: string[], max: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const n = codePoints(lines[i]) + 1;
    if (used + n > max) break;
    out.unshift(lines[i]);
    used += n;
  }
  return out;
}

export function composeFeedback(input: ComposeInput): Composed {
  const { tab, draft, contact } = input;
  const errors = validateDraft(tab, draft, contact, { emailAvailable: !!input.identity.email });
  if (contact.consent && contact.channel === "account_email" && input.identity.email && !input.identity.revision) errors.push({ field: "contact", code: "contact_email_unavailable" });
  const text = effectiveText(tab, draft, contact);

  // 本人写的每一段：脱敏后原样进正文（预览里看到的就是这一版）
  const description = redactText(text.description);
  const context: Record<string, string> = {};
  for (const k of CONTEXT_KEYS) if (text.context[k]) context[k] = redactText(text.context[k]!);
  const businessText: Record<string, string> = {};
  for (const k of BUSINESS_TEXT_KEYS) if (text.business[k]) businessText[k] = redactText(text.business[k]!);
  const freeFields: [string, string][] = [["description", description], ...Object.entries(context).map(([k, v]) => [`context.${k}`, v] as [string, string]), ...Object.entries(businessText).map(([k, v]) => [`business.${k}`, v] as [string, string])];
  for (const [field, value] of freeFields) {
    if (TAG.test(value)) errors.push({ field, code: "tag_conflict" });
    else if (CONTROL.test(value)) errors.push({ field, code: "invalid" });
  }
  // 脱敏后变短到不够字数（例如整段只有一个密钥）也要拦下：发出去的是脱敏后的这一版
  if (!errors.some((e) => e.field === "description") && codePoints(description) < LIMITS.descriptionMin) errors.push({ field: "description", code: "too_short", params: { min: LIMITS.descriptionMin } });
  if (errors.length) throw new ComposeError(errors);

  const role = tab === "enterprise" ? (draft.role as BusinessRole) : undefined;
  const scenarioId = tab === "enterprise" && FEEDBACK_SCENARIOS.includes(draft.scenarioId as FeedbackScenario) ? (draft.scenarioId as FeedbackScenario) : undefined;
  const teamSize = tab === "enterprise" && TEAM_SIZES.includes(draft.business?.team_size as never) ? (draft.business!.team_size as (typeof TEAM_SIZES)[number]) : undefined;
  const product = tab === "enterprise" && PRODUCT_INTERESTS.includes(draft.business?.product_interest as never) ? (draft.business!.product_interest as (typeof PRODUCT_INTERESTS)[number]) : undefined;
  const introduce = tab === "enterprise" && role === "enterprise_use" && draft.business?.introduce_to_own_company === true;

  // —— 主内容 ——
  const blocks: string[] = [description];
  const ctxLines = CONTEXT_KEYS.filter((k) => context[k]).map((k) => t("feedback.line_field", { label: t(`feedback.ctx_${k}`), value: context[k] }));
  if (ctxLines.length) blocks.push([t("feedback.heading_context"), ...ctxLines].join("\n"));
  if (tab === "enterprise") {
    const lines = [t("feedback.line_field", { label: t("feedback.biz_role"), value: `${t(`feedback.role_${role!}`)} [role:${role}]` })];
    if (businessText.company_name) lines.push(t("feedback.line_field", { label: t("feedback.biz_company_name"), value: businessText.company_name }));
    if (teamSize) lines.push(t("feedback.line_field", { label: t("feedback.biz_team_size"), value: t(`feedback.team_${teamSize}`) }));
    if (businessText.job_role) lines.push(t("feedback.line_field", { label: t("feedback.biz_job_role"), value: businessText.job_role }));
    if (businessText.current_systems) lines.push(t("feedback.line_field", { label: t("feedback.biz_current_systems"), value: businessText.current_systems }));
    if (product) lines.push(t("feedback.line_field", { label: t("feedback.biz_product_interest"), value: t(`feedback.product_${product}`) }));
    if (introduce) lines.push(t("feedback.line_field", { label: t("feedback.biz_introduce"), value: t("feedback.yes") }));
    if (businessText.partnership_context) lines.push(t("feedback.line_field", { label: t("feedback.biz_partnership_context"), value: businessText.partnership_context }));
    blocks.push(lines.join("\n"));
  }
  const meta = [t("feedback.separator"), t("feedback.line_field", { label: t("feedback.meta_category"), value: `${t(`feedback.tab_${tab}`)} [ticket_type:${tab}]` }), t("feedback.line_field", { label: t("feedback.meta_source"), value: `${t(`feedback.source_${input.source}`)} [source:${input.source}]` })];
  if (scenarioId) meta.push(t("feedback.line_field", { label: t("feedback.meta_scenario"), value: `${t("feedback.scenario_value", { name: t(`feedback.scenario_${scenarioId}`), keywords: t(`feedback.scenario_${scenarioId}_keywords`) })} [scenario:${scenarioId}]` }));
  let contactValue = "";
  if (contact.consent) {
    contactValue = contact.channel === "account_email" ? input.identity.email! : text.contactValue;
    meta.push(t("feedback.line_consent_yes", { version: input.policyVersion }));
    meta.push(t("feedback.line_contact", { channel: contact.channel!, value: contactValue }));
  } else meta.push(t("feedback.line_consent_no"));
  meta.push(environmentLine(input.environment, tab));

  // —— 技术材料（只有问题分类，而且本人选了） ——
  const isBug = tab === "bug";
  // 联系方式不进诊断：报错、运行状态、日志里出现留联值就换成 ***
  const scrubContact = (s: string) => (codePoints(contactValue) >= 3 ? s.split(contactValue).join("***") : s);
  const errorRaw = isBug && input.diagnostics?.includeError ? normalizeText(clean(input.errorContext?.text ?? "")) : "";
  const includeError = !!errorRaw;
  const requestId = includeError ? normalizeText(input.errorContext?.requestId).slice(0, 80) : "";
  const errorModel = includeError ? normalizeText(input.errorContext?.model).slice(0, 200) : "";
  if (requestId) meta.push(t("feedback.line_field", { label: t("feedback.meta_related_request"), value: requestId }));
  if (errorModel) meta.push(t("feedback.line_field", { label: t("feedback.meta_error_model"), value: errorModel }));

  const core = [...blocks, meta.join("\n")].join("\n\n");
  if (codePoints(core) > LIMITS.bodyMax) throw new ComposeError([{ field: "input_total", code: "too_long", params: { max: LIMITS.inputMax } }]);
  let room = LIMITS.bodyMax - codePoints(core);
  const notices: Composed["notices"] = {};
  const tail: string[] = [];

  let errorText = "";
  if (includeError) {
    const redacted = scrubContact(redactText(errorRaw));
    const heading = `\n\n${t("feedback.heading_error")}\n`;
    errorText = head(redacted, Math.min(LIMITS.errorMax, Math.max(0, room - codePoints(heading))));
    if (codePoints(redacted) > codePoints(errorText)) notices.errorTrimmed = true;
    if (errorText.trim()) {
      errorText = errorText.trim();
      tail.push(heading + errorText);
      room -= codePoints(heading) + codePoints(errorText);
    } else errorText = "";
  }

  let summary = "";
  let logLines: string[] = [];
  if (isBug && input.diagnostics?.includeLogs && input.logs) {
    const sumHeading = `\n\n${t("feedback.heading_runtime")}\n`;
    const logHeading = `\n\n${t("feedback.heading_logs")}\n`;
    const budget = room - codePoints(sumHeading) - codePoints(logHeading);
    const fullSummary = normalizeText(scrubContact(redactText(clean(input.logs.summary))));
    const fullLogs = input.logs.lines.slice(-LIMITS.logLines).map((l) => scrubContact(redactText(clean(l))).replace(/\n/g, " "));
    if (budget > 0) {
      summary = headLines(fullSummary, Math.floor(budget * 0.4));
      logLines = tailLines(fullLogs, budget - codePoints(summary) - 1);
      // 去掉首尾空行，保证和 Modelflare 去空白后的文本一致
      while (logLines.length && !logLines[0].trim()) logLines.shift();
      while (logLines.length && !logLines.at(-1)!.trim()) logLines.pop();
    }
    if (summary !== fullSummary || logLines.length < fullLogs.filter((l) => l.trim()).length) notices.diagnosticsTrimmed = true;
    if (summary) tail.push(sumHeading + summary);
    if (logLines.length) tail.push(logHeading + logLines.join("\n"));
  }
  const includeLogs = !!summary || logLines.length > 0;

  const body = (core + tail.join("")).trim();
  // 最后核对：整段再脱敏一次必须不变（拼接处不能凑出新的密钥形状），不变才发
  if (redactText(body) !== body || codePoints(body) > LIMITS.bodyMax) throw new ComposeError([{ field: "body", code: "review_again" }]);

  const business: Record<string, unknown> | undefined =
    tab === "enterprise"
      ? { role, ...businessText, ...(teamSize ? { team_size: teamSize } : {}), ...(product ? { product_interest: product } : {}), ...(introduce ? { introduce_to_own_company: true } : {}) }
      : undefined;
  const env = input.environment;
  const payload: Record<string, unknown> = {
    schema_version: 2,
    client_submission_id: input.clientSubmissionId,
    ticket_type: tab,
    kind: LEGACY_KIND[tab],
    source: input.source,
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
    description,
    ...(tab === "use_case" && Object.keys(context).length ? { use_case_context: context } : {}),
    ...(business ? { business } : {}),
    contact: contact.consent
      ? {
          consent: true,
          channel: contact.channel,
          purpose: "feedback_only",
          policy_version: input.policyVersion,
          ...(contact.channel === "account_email" ? { identity_revision: input.identity.revision } : { value: contactValue }),
        }
      : { consent: false },
    environment: { app_version: env.app_version, runtime: env.runtime, locale: env.locale, ...(isBug ? { os_family: env.os_family, arch: env.arch } : {}) },
    ...(isBug && (includeError || includeLogs)
      ? {
          diagnostics: {
            include_error: includeError,
            include_runtime_logs: includeLogs,
            ...(includeError ? { error_text: errorText } : {}),
            ...(errorModel ? { error_model: errorModel } : {}),
            ...(summary ? { runtime_summary: summary } : {}),
            ...(logLines.length ? { recent_logs: logLines.join("\n") } : {}),
          },
        }
      : {}),
    ...(requestId ? { related_request_id: requestId } : {}),
    body,
  };

  const hasCompany = tab === "enterprise" && (Object.keys(businessText).length > 0 || !!teamSize || !!product || introduce);
  const notIncluded = ["chat", "screenshots", "default_model"];
  if (!includeLogs) notIncluded.push("logs");
  if (!hasCompany) notIncluded.push("company");
  if (!contact.consent) notIncluded.push("contact");
  return { payload, body, notIncluded, notices };
}

/**
 * 邮件 / GitHub 的外部副本：单独构造，不复用私有快照。剔除联系许可、联系值、结构化企业背景和没选的诊断；
 * 本人在正文里写了已知的留联值（自填的联系方式、账号邮箱）也从副本里换成 ***，原稿不动。
 * 其他自己输入的敏感信息要本人检查，不声称能全部识别。
 */
export function externalCopy(input: { tab: FeedbackTab; draft: TabDraft; environment: FeedbackEnvironment; knownContacts: string[]; diagnostics?: { includeError?: boolean; includeLogs?: boolean }; errorText?: string; logs?: { summary: string; lines: string[] } }): { text: string; description: string; errorText: string } {
  const known = input.knownContacts.map((v) => v.trim()).filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
  const scrub = (s: string) => known.reduce((out, v) => out.split(v).join("***"), redactText(s));
  const text = effectiveText(input.tab, input.draft, { consent: false });
  const description = scrub(text.description);
  const parts = [description];
  const ctx = CONTEXT_KEYS.filter((k) => text.context[k]).map((k) => t("feedback.line_field", { label: t(`feedback.ctx_${k}`), value: scrub(text.context[k]!) }));
  if (ctx.length) parts.push(ctx.join("\n"));
  parts.push(environmentLine(input.environment, input.tab));
  const errorText = input.tab === "bug" && input.diagnostics?.includeError ? scrub(head(normalizeText(input.errorText), LIMITS.errorMax)) : "";
  if (errorText) parts.push(`${t("feedback.heading_error")}\n${errorText}`);
  if (input.tab === "bug" && input.diagnostics?.includeLogs && input.logs) {
    parts.push(`${t("feedback.heading_runtime")}\n${scrub(input.logs.summary)}`);
    const lines = input.logs.lines.slice(-LIMITS.logLines).map(scrub).join("\n").trim();
    if (lines) parts.push(`${t("feedback.heading_logs")}\n${lines}`);
  }
  return { text: parts.join("\n\n"), description, errorText };
}
