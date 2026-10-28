// 本机后端接口：JSON 请求 + 流式对话（POST + text/event-stream，EventSource 不支持 POST）。
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
    headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
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

/** 流式对话。返回 Promise（结束或中止时 resolve）。handlers: text/typing/prompt/file/done/error */
export async function streamChat(botId, text, handlers, signal) {
  const res = await fetch(`/amb/api/bots/${encodeURIComponent(botId)}/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
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
