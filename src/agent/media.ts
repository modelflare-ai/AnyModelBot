/**
 * 生图 / 生视频：代理的 generate_image / generate_video 工具经内部 bridge 调到这里，由宿主带着
 * 该机器人用的 Key 直连 Modelflare（代理子进程拿不到任何密钥），结果存进机器人工作区的 media/，
 * 再由代理用 present 交付到聊天。
 * - 模型取自 GET /v1/models?scope=authorized&kind=image|video（这把 Key 真正能用的）。
 * - 图片：Gemini 图片模型走 /v1/models/{id}:generateContent，其余走 /v1/images/generations。
 * - 视频：POST /v1/videos 建任务 → 轮询 → GET /v1/videos/{id}/content 下载。
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../log.js";

const log = logger("agent.media");

export interface MediaOptions {
  /** Modelflare /v1 基址（随线路） */
  baseUrl: () => string;
  /** 该机器人用的 Key：它自己的预算 Key，没有就用共用 Key；未连接时为空 */
  keyFor: (botId: string) => string;
  /** 额外请求头（调用归因） */
  headers: () => Record<string, string>;
  workspace: (botId: string) => string;
  fetchImpl?: typeof fetch;
  /** 视频轮询间隔与上限（测试用） */
  pollMs?: number;
  videoTimeoutMs?: number;
}

interface MediaModel {
  id: string;
  kind?: string;
  image_route?: string;
}

const MAX_BYTES = 200 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };

export class MediaError extends Error {}

export class MediaService {
  constructor(private o: MediaOptions) {}

  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }

  /** bridge 入口：返回给模型的一段文字 */
  async run(botId: string, op: string, args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new MediaError("缺少 prompt");
    if (op === "image") return this.image(botId, prompt, args);
    if (op === "video") return this.video(botId, prompt, args);
    throw new MediaError(`未知操作 ${op}`);
  }

  private key(botId: string): string {
    const key = this.o.keyFor(botId);
    if (!key) throw new MediaError("还没有连接 Modelflare，无法生成图片或视频");
    return key;
  }

  private async call(botId: string, method: string, p: string, body?: unknown, timeoutMs = 300_000): Promise<Response> {
    const res = await this.fetch(`${this.o.baseUrl()}${p}`, {
      method,
      headers: { Authorization: `Bearer ${this.key(botId)}`, ...this.o.headers(), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
      const msg = detail.error?.message || `HTTP ${res.status}`;
      throw new MediaError(detail.error?.code === "model_not_found" ? `这把 Key 不能用这个模型：${msg}` : `Modelflare 返回错误：${msg}`);
    }
    return res;
  }

  private async models(botId: string, kind: "image" | "video"): Promise<MediaModel[]> {
    const res = await this.call(botId, "GET", `/models?scope=authorized&kind=${kind}`, undefined, 20_000);
    const body = (await res.json()) as { data?: MediaModel[] };
    return (body.data ?? []).filter((m) => m.id && (!m.kind || m.kind === kind));
  }

  private async pick(botId: string, kind: "image" | "video", wanted: unknown): Promise<MediaModel> {
    const list = await this.models(botId, kind);
    const usable = kind === "image" ? list.filter((m) => m.image_route === "images" || m.image_route === "gemini-generate-content") : list;
    if (!usable.length) throw new MediaError(kind === "image" ? "这把 Key 没有可用的图片模型" : "这把 Key 没有可用的视频模型");
    const name = String(wanted ?? "").trim();
    if (!name) return usable[0];
    const hit = usable.find((m) => m.id === name);
    if (!hit) throw new MediaError(`没有这个模型：${name}。可用：${usable.map((m) => m.id).join("、")}`);
    return hit;
  }

  private save(botId: string, kind: "image" | "video", data: Buffer, mime: string): string {
    const dir = path.join(this.o.workspace(botId), "media");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    const ext = EXT[mime.split(";")[0].trim()] ?? (kind === "image" ? "png" : "mp4");
    let name = `${kind}-${stamp}.${ext}`;
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${kind}-${stamp}-${i}.${ext}`;
    fs.writeFileSync(path.join(dir, name), data);
    return `media/${name}`;
  }

  /** 结果地址不带我们的 Key 去取（通常是对象存储的签名地址） */
  private async download(url: string): Promise<{ data: Buffer; mime: string }> {
    if (!/^https:\/\//i.test(url)) throw new MediaError("结果地址无效");
    const res = await this.fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new MediaError(`下载结果失败（HTTP ${res.status}）`);
    return this.readBody(res);
  }

  private async readBody(res: Response): Promise<{ data: Buffer; mime: string }> {
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_BYTES) throw new MediaError("结果文件过大");
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) throw new MediaError("结果文件过大");
    return { data, mime: res.headers.get("content-type") || "" };
  }

  private async image(botId: string, prompt: string, args: Record<string, unknown>): Promise<string> {
    const model = await this.pick(botId, "image", args.model);
    const files: string[] = [];
    if (model.image_route === "gemini-generate-content") {
      const res = await this.call(botId, "POST", `/models/${encodeURIComponent(model.id)}:generateContent`, { contents: [{ role: "user", parts: [{ text: prompt }] }] });
      const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }> };
      for (const c of body.candidates ?? [])
        for (const p of c.content?.parts ?? []) {
          const data = p.inlineData?.data ?? p.inline_data?.data;
          if (data) files.push(this.save(botId, "image", Buffer.from(data, "base64"), p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? "image/png"));
        }
    } else {
      const size = typeof args.size === "string" && /^\d{2,5}x\d{2,5}$/.test(args.size) ? args.size : undefined;
      const res = await this.call(botId, "POST", "/images/generations", { model: model.id, prompt, ...(size ? { size } : {}) });
      const body = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      for (const item of body.data ?? []) {
        if (item.b64_json) files.push(this.save(botId, "image", Buffer.from(item.b64_json, "base64"), "image/png"));
        else if (item.url) {
          const d = await this.download(item.url);
          files.push(this.save(botId, "image", d.data, d.mime || "image/png"));
        }
      }
    }
    if (!files.length) throw new MediaError(`${model.id} 没有返回图片`);
    log.info("image generated", { bot: botId, model: model.id, files: files.length });
    return `已用 ${model.id} 生成 ${files.length} 张图片，保存在工作区：${files.join("、")}。要发给用户，请用 present 工具交付这些文件。`;
  }

  private async video(botId: string, prompt: string, args: Record<string, unknown>): Promise<string> {
    const model = await this.pick(botId, "video", args.model);
    const seconds = Number(args.seconds);
    const size = typeof args.size === "string" && /^\d{2,5}x\d{2,5}$/.test(args.size) ? args.size : undefined;
    const created = (await (await this.call(botId, "POST", "/videos", { model: model.id, prompt, ...(Number.isFinite(seconds) && seconds > 0 ? { seconds: String(Math.round(seconds)) } : {}), ...(size ? { size } : {}) })).json()) as { id?: string; task_id?: string };
    const id = created.id || created.task_id;
    if (!id) throw new MediaError("Modelflare 没有返回视频任务编号");
    const deadline = Date.now() + (this.o.videoTimeoutMs ?? 20 * 60_000);
    for (;;) {
      const t = (await (await this.call(botId, "GET", `/videos/${encodeURIComponent(id)}`, undefined, 30_000)).json()) as { status?: string; error?: { message?: string } | null };
      if (t.status === "completed") break;
      if (t.status === "failed") throw new MediaError(`视频生成失败：${t.error?.message || "未知原因"}`);
      if (Date.now() > deadline) throw new MediaError(`视频任务 ${id} 超时还没完成，可以稍后再试`);
      await new Promise((r) => setTimeout(r, this.o.pollMs ?? 5000));
    }
    const content = await this.call(botId, "GET", `/videos/${encodeURIComponent(id)}/content`, undefined, 600_000);
    const d = await this.readBody(content);
    const file = this.save(botId, "video", d.data, d.mime || "video/mp4");
    log.info("video generated", { bot: botId, model: model.id });
    return `已用 ${model.id} 生成视频，保存在工作区：${file}。要发给用户，请用 present 工具交付这个文件。`;
  }
}
