/** 按 key 串行执行（同一会话的消息按到达顺序处理），不同 key 并行。 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();

  run(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).catch(() => {});
    this.tails.set(key, next);
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return next;
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
