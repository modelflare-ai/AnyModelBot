import type { RuleRow, Store } from "../store/db.js";

/** 对话里的每一次变更独立落库；旧卡的撤销不能覆盖后续修改。 */
export interface RuleAction {
  id: string;
  ruleId: string;
  conversationId: string;
  actor?: string;
  title: string;
  kind: "create" | "update";
  before?: RuleRow;
  revision: number;
  createdAt: number;
  expiresAt: number;
  messageId: number;
  acknowledgementId?: number;
  state: "active" | "undone" | "reverted";
  restoreUntil: number;
  sequence?: number;
}
export const ACTION_PREFIX = "rule.action:";
export function actions(store: Store, conversationId?: string): RuleAction[] {
  return store.listKV(ACTION_PREFIX).flatMap(([, raw]) => {
    try {
      const a = JSON.parse(raw) as RuleAction;
      return !conversationId || a.conversationId === conversationId ? [a] : [];
    } catch { return []; }
  }).sort((a, b) => a.createdAt - b.createdAt || (a.sequence ?? 0) - (b.sequence ?? 0));
}
export function saveAction(store: Store, action: RuleAction): void {
  store.setKV(ACTION_PREFIX + action.id, JSON.stringify(action));
}
export function canUndo(store: Store, a: RuleAction, now: number): boolean {
  const rule = store.getRule(a.ruleId);
  return !!rule && !rule.undoneUntil && a.state === "active" && a.expiresAt > now && (rule.revision ?? 1) === a.revision
    && !store.ruleRuns(rule.id, { limit: 500 }).some((r) => r.startedAt >= a.createdAt && r.startedAt > 0);
}
