import { AsyncLocalStorage } from "node:async_hooks";

/** 当前任务的"让位"函数（见 KeyedQueue.releaser） */
const slot = new AsyncLocalStorage<() => void>();

/**
 * 按 key 串行执行（同一会话的消息按到达顺序处理），不同 key 并行。
 * 任务可以提前让位（KeyedQueue.releaser()）：之后同 key 的下一个任务不再等它结束，由任务自己保证先后
 * （运行时在代理回合交给代理后让位，后来的消息才能并入进行中的回合）。
 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();

  run(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const start = () => slot.run(release, task);
    const done = prev.then(start, start).catch(() => {});
    // 下一个任务在这个结束或让位时开始
    const next = Promise.race([done, released]);
    this.tails.set(key, next);
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return done;
  }

  /** 正在执行的队列任务的让位函数（不在队列任务里时为 undefined）；在任务开始处同步取 */
  static releaser(): (() => void) | undefined {
    return slot.getStore();
  }

  get size(): number {
    return this.tails.size;
  }
}

/** 带 TTL 的去重集合（飞书事件 3 秒未确认会重推）。 */
export class Dedup {
  private seen = new Map<string, number>();
  constructor(private ttlMs = 10 * 60_000, private max = 5000) {}

  /** 第一次见到返回 true，重复返回 false。 */
  firstSeen(id: string, now = Date.now()): boolean {
    this.gc(now);
    const t = this.seen.get(id);
    if (t !== undefined && now - t <= this.ttlMs) return false;
    this.seen.set(id, now);
    return true;
  }

  private gc(now: number): void {
    if (this.seen.size < this.max / 2) return;
    for (const [k, t] of this.seen) {
      if (now - t > this.ttlMs || this.seen.size > this.max) this.seen.delete(k);
    }
  }
}
