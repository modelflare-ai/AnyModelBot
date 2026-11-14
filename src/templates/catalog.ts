import fs from "node:fs";
import path from "node:path";
import { findAppRoot } from "../magpie/supervisor.js";
import { lang, type Lang } from "../i18n/index.js";
import type { Schedule } from "../domain/schedule.js";
export interface BotTemplate {
  id: string; version: number; avatar: string; category: string; tier: number;
  tools?: boolean; reasoning?: boolean; vision?: boolean; longContext?: boolean;
  apps: string[]; globalApps?: string[]; memory?: boolean; channelHint?: boolean;
  rule?: { kind: "remind" | "check"; sourceRequired?: boolean; schedule: Omit<Extract<Schedule, { kind: "daily" | "weekly" }>, "tz"> };
}
export interface TemplateCopy {
  name: string; desc: string; persona: string; sample: string; memoryTitle?: string; memory?: string[];
  memoryHint: string; channelHint?: string; rule?: { title: string; instruction: string };
}
const root = () => findAppRoot();
export function templateCatalog(): BotTemplate[] {
  return JSON.parse(fs.readFileSync(path.join(root(), "ui/data/bot-templates.json"), "utf8"));
}
export function templateStrings(language: Lang = lang()): { roles: Record<string, TemplateCopy>; errors: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(root(), "ui/locales", language, "templates.json"), "utf8"));
}
/** Names remain non-unique for ordinary creation. Only template creation uses a suffix. */
export function templateName(raw: string, existing: readonly string[]): string {
  const cut = (s: string, n: number) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");
  const base = cut(raw.trim(), 60); const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) { const suffix = ` ${n}`; const value = cut(base, 60 - suffix.length) + suffix; if (!used.has(value)) return value; }
}
