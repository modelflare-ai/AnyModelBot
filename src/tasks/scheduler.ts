/**
 * 宿主的定时器（设计文档第 4 节：调度归宿主）：rules.next_run_at 里最早的那个设一个定时器，到点让任务服务开 run。
 * DSH 的 dsh-schedule 在 sdk 配置下加载不了，而且只在代理进程活着时才跑；宿主常驻托盘。
 *
 * - 一次最多睡 maxSleepMs（默认 5 分钟）就醒来看一眼：电脑睡眠、改了系统时间之后不会错过太久（Node 的定时器按单调时钟走）。
 * - wake()：规则改了、电脑醒了（Electron powerMonitor 的 resume）、时钟变了，马上重新看一遍。
 * - 错过的怎么办（宽限期内补跑一次、更早的记为跳过）由任务服务的 fireDue 决定，这里只管时间。
 */
import { logger } from "../log.js";

const log = logger("scheduler");

export const MAX_SLEEP_MS = 5 * 60_000;

export interface SchedulerOptions {
  /** 最早的下次运行时间；0 = 没有 */
  next(): number;
  /** 到点了：开该开的 run（错过太久的记为跳过），把它们的 next_run_at 往后挪 */
  fire(now: number): void;
  now?: () => number;
  maxSleepMs?: number;
}

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  /** 下一次醒来的时间（测试和状态页看） */
  wakeAt = 0;

  constructor(private o: SchedulerOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** 开始：先看一遍（应用没开时错过的，按宽限期补跑或跳过），再设定时器 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.wakeAt = 0;
  }

  /** 规则改了、电脑醒了、时钟变了：马上重新看一遍 */
  wake(): void {
    if (this.running) this.tick();
  }

  private tick(): void {
    if (!this.running) return;
    try {
      this.o.fire(this.now());
    } catch (e) {
      log.warn("firing due rules failed", { message: (e as Error).message.slice(0, 300) });
    }
    this.arm();
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (!this.running) return;
    const now = this.now();
    const next = this.o.next();
    const max = this.o.maxSleepMs ?? MAX_SLEEP_MS;
    const ms = next > 0 ? Math.min(max, Math.max(200, next - now)) : max;
    this.wakeAt = now + ms;
    this.timer = setTimeout(() => this.tick(), ms);
    this.timer.unref?.();
  }
}
