/**
 * 事件触发的规则的接入点（3d 只做这个扩展点）：规则的触发是带标签的联合，schedule 走宿主的定时器，
 * event 由事件源把事件交到这里（RuleEvents.emit），开着的、来源相同、过滤条件对得上的规则各开一个 run，
 * 和定时的 run 走同一条路（观察 / 执行、名额、送达、自动暂停）。
 *
 * 以后用户自己配置的 workload（比如盯一个 GitHub 仓库）就接在这里：workload 负责拿到事件（轮询、webhook），
 * 调 emit(source, event)；这里不内置任何事件源，也没有界面。source 是 workload 的名字（如 "github:owner/repo"），
 * filter 是规则里存的一组键值，事件里对应的值相等（filter 的值是数组时，等于其中一个）才算对得上。
 */

/** 一个事件：任意 JSON；id 可选（同一个事件交两次时，以后可以按它去重） */
export type RuleEvent = Record<string, unknown>;

/** 事件对不对得上规则的过滤条件：每个键都要相等（数组 = 其中之一）；键可以是 a.b 这样的路径；没有条件就都算 */
export function matchesFilter(filter: Record<string, unknown> | undefined, event: RuleEvent): boolean {
  if (!filter) return true;
  for (const [key, want] of Object.entries(filter)) {
    const got = key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), event);
    const ok = Array.isArray(want) ? want.some((w) => same(w, got)) : same(want, got);
    if (!ok) return false;
  }
  return true;
}

const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && typeof a !== "object" && typeof b !== "object" && String(a) === String(b));

/** 任务服务里开 run 的那一个方法（一个写入者：规则、run、输入都由任务服务写） */
export interface RuleEventSink {
  emitRuleEvent(source: string, event: RuleEvent): string[];
}

/** 宿主进程里的事件入口：workload 拿到事件就调 emit；返回开了 run 的规则 id */
export class RuleEvents {
  constructor(private sink: RuleEventSink) {}

  emit(source: string, event: RuleEvent): string[] {
    if (!source.trim() || !event || typeof event !== "object") return [];
    return this.sink.emitRuleEvent(source.trim(), event);
  }
}
