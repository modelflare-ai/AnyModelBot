import crypto from "node:crypto";

/** 发给代理进程里 amb-control 插件的一条指令 */
export interface ControlCommand {
  id: string;
  op: string;
  [k: string]: unknown;
}

/** 插件多久没来取指令就算断开（长轮询每 25 秒一轮） */
const STALE_MS = 35_000;
const POLL_MS = 25_000;

/**
 * 宿主 → 代理子进程的指令通道（SDK 只有 prompt/resume，没有中止、插话、换模型）：
 * 子进程里的 amb-control 插件经 bridge 长轮询 /dsh/control/poll 取指令，执行完 POST /dsh/control/result 回报。
 * 每次拉起子进程换一个通道 id（AMB_CONTROL_TOKEN）：旧进程的轮询拿到 stop，发出去没回音的指令随旧进程一起失败。
 * 鉴权沿用 bridge 令牌；指令和结果里都没有令牌。
 */
export class ControlChannel {
  /** 当前子进程的通道 id；空 = 没有子进程 */
  id = "";
  private queue: ControlCommand[] = [];
  private waiter: ((cmds: ControlCommand[]) => void) | undefined;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private lastSeen = 0;
  private seq = 0;
  private onSeen = new Set<() => void>();

  /** 新子进程：换通道 id，旧的指令作废 */
  reset(): string {
    this.close("代理进程已重启");
    this.id = crypto.randomBytes(12).toString("hex");
    return this.id;
  }

  /** 子进程没了：等着的指令全部失败 */
  close(reason = "代理进程已退出"): void {
    this.id = "";
    this.lastSeen = 0;
    this.queue = [];
    const w = this.waiter;
    this.waiter = undefined;
    w?.([]);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  /** 插件在线：正挂着一个轮询，或刚来过 */
  get connected(): boolean {
    return !!this.id && (!!this.waiter || Date.now() - this.lastSeen < STALE_MS);
  }

  /** 等插件第一次来取指令（子进程刚起来时） */
  async ready(ms: number): Promise<boolean> {
    if (this.connected) return true;
    return new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(t);
        this.onSeen.delete(seen);
        resolve(v);
      };
      const seen = () => done(true);
      const t = setTimeout(() => done(this.connected), ms);
      this.onSeen.add(seen);
    });
  }

  private seen(): void {
    this.lastSeen = Date.now();
    for (const fn of [...this.onSeen]) fn();
  }

  /** 插件的长轮询：有指令马上给，没有就最多挂 waitMs；signal = 连接断了 */
  poll(body: any, signal?: AbortSignal, waitMs = POLL_MS): Promise<{ commands?: ControlCommand[]; stop?: true }> {
    if (!this.id || String(body?.controlId ?? "") !== this.id) return Promise.resolve({ stop: true });
    this.seen();
    if (this.queue.length) return Promise.resolve({ commands: this.queue.splice(0) });
    // 同一时刻只留一个轮询
    const old = this.waiter;
    this.waiter = undefined;
    old?.([]);
    return new Promise((resolve) => {
      const done = (cmds: ControlCommand[]) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", gone);
        if (this.waiter === done) this.waiter = undefined;
        if (this.id) this.lastSeen = Date.now();
        resolve({ commands: cmds });
      };
      // 连接断了（子进程退出）：不再往这里派指令
      const gone = () => {
        if (this.waiter === done) this.waiter = undefined;
        clearTimeout(timer);
        resolve({ commands: [] });
      };
      const timer = setTimeout(() => done([]), waitMs);
      signal?.addEventListener("abort", gone, { once: true });
      this.waiter = done;
    });
  }

  /** 插件回报一条指令的结果 */
  result(body: any): void {
    if (!this.id || String(body?.controlId ?? "") !== this.id) return;
    this.seen();
    const p = this.pending.get(String(body?.id ?? ""));
    if (!p) return;
    this.pending.delete(String(body.id));
    clearTimeout(p.timer);
    if (body.ok) p.resolve(body.result ?? {});
    else p.reject(new Error(String(body.error ?? "control command failed").slice(0, 500)));
  }

  /** 发一条指令，等插件回报；超时或子进程退出时失败 */
  send<T = Record<string, unknown>>(op: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
    if (!this.id) return Promise.reject(new Error("代理进程没有运行"));
    const id = `c${++this.seq}`;
    const cmd: ControlCommand = { ...args, id, op };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queue = this.queue.filter((c) => c !== cmd);
        reject(new Error(`代理进程没有响应（${op}）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const w = this.waiter;
      this.waiter = undefined;
      if (w) w([cmd]);
      else this.queue.push(cmd);
    });
  }
}
