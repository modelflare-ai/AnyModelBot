/**
 * 模型访问接口。默认实现指向受管 magpie 的 OpenAI 兼容 /v1（流式 SSE）。
 * 运行时只依赖 ModelClient，可替换为任意 OpenAI 兼容端点。
 */
/** OpenAI 兼容的多模态内容；只有用户刚发来的图片会用到（data URL） */
export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

/**
 * 能看图的模型。Modelflare 的模型目录不带输入模态，只能按名字判断；不在其中的模型
 * （DeepSeek、GLM 文本版等）收到图片时只拿到它在工作区里的路径。
 */
const IMAGE_INPUT_MODELS = /claude|gpt-4o|gpt-4\.1|gpt-[5-9]|gemini|grok-4|kimi-k3|muse-spark|qvq|-vl\b|-omni\b|glm-[\d.]+v\b/i;
export function acceptsImages(model: string): boolean {
  return IMAGE_INPUT_MODELS.test(model);
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface ModelClient {
  listModels(): Promise<string[]>;
  /** 流式生成；onDelta 收到增量文本；返回完整文本 */
  streamChat(req: ChatRequest, onDelta: (delta: string) => void): Promise<string>;
}

export interface Endpoint {
  baseUrl: string; // 形如 http://127.0.0.1:1234/v1
  apiKey: string;
}

export class OpenAICompatClient implements ModelClient {
  constructor(private endpoint: () => Endpoint, private fetchImpl: typeof fetch = fetch) {}

  private headers(): Record<string, string> {
    const { apiKey } = this.endpoint();
    return { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.endpoint().baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`GET /models -> HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id).sort();
  }

  async streamChat(req: ChatRequest, onDelta: (delta: string) => void): Promise<string> {
    const res = await this.fetchImpl(`${this.endpoint().baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), Accept: "text/event-stream" },
      body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new ModelError(`HTTP ${res.status}`, res.status, detail.slice(0, 500));
    }
    let full = "";
    const parser = new SSEParser((data) => {
      if (data === "[DONE]") return;
      let chunk: { choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string } }>; error?: { message?: string } };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (chunk.error) throw new ModelError(chunk.error.message || "upstream error", 502, "");
      const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    });
    const decoder = new TextDecoder();
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      parser.push(decoder.decode(bytes, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
    return full;
  }
}

export class ModelError extends Error {
  constructor(message: string, readonly status: number, readonly detail: string) {
    super(message);
  }
}

/** 最小 SSE 解析器：按空行切事件，拼接多行 data:。 */
export class SSEParser {
  private buf = "";
  private data: string[] = [];
  constructor(private onData: (data: string) => void) {}

  push(text: string): void {
    this.buf += text;
    let idx: number;
    while ((idx = this.buf.search(/\r?\n/)) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + (this.buf[idx] === "\r" ? 2 : 1));
      this.line(line);
    }
  }

  end(): void {
    if (this.buf) this.line(this.buf);
    this.buf = "";
    this.line("");
  }

  private line(line: string): void {
    if (line === "") {
      if (this.data.length) {
        const d = this.data.join("\n");
        this.data = [];
        this.onData(d);
      }
      return;
    }
    if (line.startsWith(":")) return;
    if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
  }
}
