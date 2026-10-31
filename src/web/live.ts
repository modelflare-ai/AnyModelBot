import crypto from "node:crypto";
import type { ActivityStep } from "../agent/activity.js";
import type { OutboundOp, ReplySession } from "../core/types.js";
import { opEvent } from "./sse-reply.js";

export interface LivePrompt {
  kind: string;
  prompt: string;
  requestId?: string;
  code?: string;
}

/** 进行中的一条消息到目前为止的样子：GET /chat 的 live，接上时的第一个 snapshot 事件 */
export interface LiveSnapshot {
  id: string;
  startedAt: number;
  userText: string;
  text: string;
  steps: ActivityStep[];
  prompts: LivePrompt[];
  files: string[];
  /** 已经按了停止，正在收尾 */
  stopping: boolean;
  /** 这条并进了它前面那条正在进行的处理：没有自己的回复，回复在前面那条里 */
  steered: boolean;
}

type Listener = (event: string, data: unknown) => void;

/**
 * 网页控制台的一条消息，从收到到回复结束（排队、等代理启动、流式回复都算）。
 * 代理自己醒来的一轮（后台命令结束）也登记成一条，userText 为空。
 * 运行时把 OutboundOp 写进来：这里记下到目前为止的状态，再原样转给订阅者——发消息的那个请求，
 * 以及切走再切回、刷新之后接上来的界面。
 */
export class LiveTurn implements ReplySession {
  readonly id = crypto.randomUUID();
  readonly startedAt = Date.now();
  text = "";
  readonly steps = new Map<string, ActivityStep>();
  readonly prompts: LivePrompt[] = [];
  readonly files: string[] = [];
  stopping = false;
  /** 并进了正在进行的处理（见 LiveSnapshot.steered） */
  steered = false;
  done = false;
  /** 停止按钮：交给 runtime.handle 的 signal（排队中的也能停） */
  readonly abort = new AbortController();
  private subs = new Set<Listener>();

  constructor(
    readonly conversationId: string,
    readonly botId: string,
    readonly userText: string,
    /** 收到时会话里最后一条消息的 id：之后存下的消息属于进行中的回合，由 live 代替显示 */
    readonly afterMessageId: number,
  ) {}

  async apply(op: OutboundOp): Promise<void> {
    if (this.done) return;
    if (op.type === "text" && op.ack) this.steered = true;
    if (op.type === "stream.update" || op.type === "stream.finish" || op.type === "text") this.text = op.text;
    else if (op.type === "activity") this.steps.set(op.step.id, op.step);
    else if (op.type === "file") this.files.push(op.name);
    else if (op.type === "interactive" && !this.prompts.some((p) => p.requestId && p.requestId === op.requestId)) {
      this.prompts.push({ kind: op.kind, prompt: op.prompt, requestId: op.requestId, code: op.code });
    }
    const ev = opEvent(op);
    if (ev) this.emit(ev[0], ev[1]);
  }

  snapshot(): LiveSnapshot {
    return {
      id: this.id,
      startedAt: this.startedAt,
      userText: this.userText,
      text: this.text,
      steps: [...this.steps.values()],
      prompts: [...this.prompts],
      files: [...this.files],
      stopping: this.stopping,
      steered: this.steered,
    };
  }

  /** 订阅之后的事件（含最后的 done / error）；返回取消函数 */
  subscribe(fn: Listener): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(event: string, data: unknown): void {
    for (const fn of [...this.subs]) {
      try {
        fn(event, data);
      } catch {
        /* 某个连接写失败不影响其它订阅者 */
      }
    }
  }

  stop(): void {
    if (this.done) return;
    if (!this.stopping) {
      this.stopping = true;
      this.emit("stopping", {});
    }
    this.abort.abort();
  }

  finish(event: "done" | "error", data: unknown): void {
    if (this.done) return;
    this.done = true;
    this.emit(event, data);
    this.subs.clear();
  }
}

/** 会话 → 进行中的网页消息（按收到的顺序；同一会话串行处理，第一条是正在处理的，后面的在排队） */
export class LiveTurns {
  private byConv = new Map<string, LiveTurn[]>();

  start(conversationId: string, botId: string, userText: string, afterMessageId: number): LiveTurn {
    const t = new LiveTurn(conversationId, botId, userText, afterMessageId);
    this.byConv.set(conversationId, [...(this.byConv.get(conversationId) ?? []), t]);
    return t;
  }

  list(conversationId: string): LiveTurn[] {
    return this.byConv.get(conversationId) ?? [];
  }

  /** 指定 id 的那条；不给 id 就是正在处理的那条 */
  get(conversationId: string, id?: string | null): LiveTurn | undefined {
    const l = this.list(conversationId);
    return id ? l.find((t) => t.id === id) : l[0];
  }

  /** 回合结束：先移出登记（界面收到 done 后重新读历史时，它已经不算进行中），再通知订阅者 */
  end(t: LiveTurn, event: "done" | "error", data: unknown): void {
    const rest = this.list(t.conversationId).filter((x) => x !== t);
    if (rest.length) this.byConv.set(t.conversationId, rest);
    else this.byConv.delete(t.conversationId);
    t.finish(event, data);
  }

  /** 停止会话里所有进行中的网页消息（正在处理的和排队的）；返回停了几条 */
  stop(conversationId: string): number {
    const l = this.list(conversationId);
    for (const t of l) t.stop();
    return l.length;
  }

  /** 有网页消息在处理的机器人 */
  bots(): string[] {
    return [...new Set([...this.byConv.values()].flat().map((t) => t.botId))];
  }
}
