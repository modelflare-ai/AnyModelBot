// 本机后端接口：JSON 请求 + 流式对话（POST + text/event-stream，EventSource 不支持 POST）。
// 每个请求带 x-amb-lang（界面当前语言），服务端的报错和状态文字用同一种语言（src/i18n）。
import { getLang } from "./i18n.js";
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

export async function api(path, opts = {}) {
  const res = await fetch("/amb/api" + path, {
    method: opts.method || "GET",
    headers: { "x-amb-lang": getLang(), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
  return data;
}

/** 按空行切事件；回调 (event, data)。 */
export function sseParser(onEvent) {
  let buf = "";
  let event = "message";
  let data = [];
  const line = (l) => {
    if (l === "") {
      if (data.length) {
        let parsed;
        try {
          parsed = JSON.parse(data.join("\n"));
        } catch {
          parsed = data.join("\n");
        }
        onEvent(event, parsed);
      }
      event = "message";
      data = [];
      return;
    }
    if (l.startsWith(":")) return;
    if (l.startsWith("event:")) event = l.slice(6).trim();
    else if (l.startsWith("data:")) data.push(l.slice(5).replace(/^ /, ""));
  };
  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + (buf[i] === "\r" ? 2 : 1));
        line(l);
      }
    },
    end() {
      if (buf) line(buf);
      buf = "";
      line("");
    },
  };
}

/** 读完一个 text/event-stream 响应；中止时安静地返回 */
async function readEvents(req, handlers) {
  let res;
  try {
    res = await req;
  } catch (e) {
    if (e.name === "AbortError") return;
    throw e;
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
  }
  const parser = sseParser((ev, data) => handlers[ev]?.(data));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(dec.decode(value, { stream: true }));
    }
    parser.push(dec.decode());
    parser.end();
  } catch (e) {
    if (e.name === "AbortError") return;
    throw e;
  }
}

/**
 * 流式对话。返回 Promise（结束或中止时 resolve）。handlers: text/typing/activity/prompt/file/stopping/done/error。
 * 中止只是不再接收：消息在服务端照常处理（停止要调 /conversations/:id/stop），回来时用 attachChat 接上。
 */
export function streamChat(botId, text, handlers, signal) {
  return readEvents(
    fetch(`/amb/api/bots/${encodeURIComponent(botId)}/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-amb-lang": getLang() },
      body: JSON.stringify({ text }),
      signal,
    }),
    handlers,
  );
}

/** 接上进行中的那条消息（切走再切回、刷新后）：先 snapshot（到目前为止的样子），之后的事件同 streamChat，最后 done */
export function attachChat(botId, turnId, handlers, signal) {
  return readEvents(fetch(`/amb/api/bots/${encodeURIComponent(botId)}/chat/live?turn=${encodeURIComponent(turnId)}`, { headers: { "x-amb-lang": getLang() }, signal }), handlers);
}
