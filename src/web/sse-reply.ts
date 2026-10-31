import type http from "node:http";
import type { OutboundOp, ReplySession } from "../core/types.js";

/**
 * 运行时的 OutboundOp → 网页对话的 SSE 事件：text（到目前为止的完整回复，覆盖式）、typing、prompt（审批/提问）、
 * file、activity（代理的一步，按 id 覆盖）。stream.start 不发。
 */
export function opEvent(op: OutboundOp): [string, unknown] | undefined {
  switch (op.type) {
    case "typing":
      return ["typing", { on: op.on }];
    case "stream.start":
      return undefined;
    case "stream.update":
      return ["text", { text: op.text }];
    case "stream.finish":
    case "text":
      return ["text", { text: op.text, final: true }];
    case "file":
      return ["file", { name: op.name }];
    case "interactive":
      return ["prompt", { kind: op.kind, prompt: op.prompt, requestId: op.requestId, code: op.code }];
    case "activity":
      return ["activity", op.step];
  }
}

/**
 * 网页对话渠道：把事件写成 text/event-stream。
 * 事件见 opEvent，另有 snapshot（接上进行中的回合时先发一次）、stopping、done、error。
 * 运行时的 stream.update 本身就是累计文本，所以前端只需整体替换，不用拼接增量。
 */
export class SseReply implements ReplySession {
  private closed = false;
  text = "";

  constructor(private res: http.ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    res.on("close", () => (this.closed = true));
    // 代理回合可能长时间没有输出：定期发注释行，避免中间层断开空闲连接
    const beat = setInterval(() => this.raw(": keep-alive\n\n"), 15_000);
    res.on("close", () => clearInterval(beat));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(event: string, data: unknown): void {
    this.raw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private raw(chunk: string): void {
    if (this.closed || this.res.writableEnded) return;
    this.res.write(chunk);
  }

  async apply(op: OutboundOp): Promise<void> {
    if (op.type === "stream.update" || op.type === "stream.finish" || op.type === "text") this.text = op.text;
    const ev = opEvent(op);
    if (ev) this.send(ev[0], ev[1]);
  }

  end(event: "done" | "error", data: unknown): void {
    this.send(event, data);
    if (!this.closed && !this.res.writableEnded) this.res.end();
  }
}
