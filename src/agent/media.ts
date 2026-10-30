/**
 * 生图 / 生视频：代理的 media_models / media_docs / generate_image / generate_video 工具经内部 bridge 调到这里，
 * 由宿主带着该机器人用的 Key 直连 Modelflare（代理子进程拿不到任何密钥），结果存进机器人工作区的 media/，
 * 再由代理用 present 交付到聊天。每次生成前都由 AgentManager 向用户确认这次用哪个模型（manager.ts mediaOp）。
 * - 模型取自 GET /v1/models?scope=authorized&kind=image|video（这把 Key 真正能用的）；参数范围、是否必须带参考素材、
 *   参考价、推荐顺序取自公开价格目录 /api/pricing。
 * - 每个模型的请求格式都不一样，以 docs.modelflare.dev 上该模型的文档为准：代理先用 media_docs 读文档，按文档写
 *   请求体（body）；宿主只填 model、把 "workspace:路径" 换成文件内容、发请求、保存结果。不带 body 时发最简单的文字请求。
 * - 图片：Gemini 图片模型走 /v1/models/{id}:generateContent，其余走 /v1/images/generations（改图走 /v1/images/edits）。
 * - 视频：POST /v1/videos 建任务 → 轮询 → GET /v1/videos/{id}/content 下载。
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../log.js";

const log = logger("agent.media");

export type MediaKind = "image" | "video";

export interface MediaOptions {
  /** Modelflare /v1 基址（随线路） */
  baseUrl: () => string;
  /** 该机器人用的 Key：它自己的预算 Key，没有就用共用 Key；未连接时为空 */
  keyFor: (botId: string) => string;
  /** 额外请求头（调用归因） */
  headers: () => Record<string, string>;
  workspace: (botId: string) => string;
  /** 设置里选的默认图片 / 视频模型；空 = 按推荐顺序的第一个 */
  defaults?: () => { image: string; video: string };
  /** 公开价格目录（参数范围、参考价、推荐顺序）；取不到时只是少了这些信息 */
  pricingUrl?: () => string;
  /** 文档全文（每个模型一节） */
  docsUrl?: string;
  fetchImpl?: typeof fetch;
  /** 视频轮询间隔与上限（测试用） */
  pollMs?: number;
  videoTimeoutMs?: number;
}

export interface MediaModel {
  id: string;
  kind: MediaKind;
  /** images = OpenAI Images API；gemini = generateContent；videos = /v1/videos */
  route: "images" | "gemini" | "videos";
  /** 价格目录里的 media_options.image / media_options.video */
  options?: Record<string, unknown>;
  /** 必须带参考素材（图生视频之类），只有文字时不能用 */
  requiresReference: boolean;
  /** 一句参考价，如 "$0.03/张"、"$0.09/秒（720p）" */
  price: string;
  priority: number;
}

/** 一次生成要确认的内容 */
export interface MediaPlan {
  kind: MediaKind;
  /** 这次要用的模型（代理指定的，或默认） */
  model: MediaModel;
  /** 默认模型（设置里选的，或推荐的） */
  default: MediaModel;
  /** 确认时一并列出的其他选择 */
  candidates: MediaModel[];
  /** 这把 Key 能用的全部同类模型 */
  all: MediaModel[];
  /** 代理按文档写了自己的请求体：换模型后需要按新模型的文档重写 */
  custom: boolean;
  /** 给用户看的说明：提示词摘要、参数、参考素材 */
  summary: string;
}

interface CatalogEntry {
  model_name: string;
  display_priority?: number;
  quota_type?: number;
  model_price?: number;
  billing_unit?: string;
  enable_groups?: string[];
  video_resolution_price?: Record<string, number>;
  media_options?: { image?: Record<string, unknown>; video?: Record<string, unknown> };
}

interface Catalog {
  data?: CatalogEntry[];
  group_ratio?: Record<string, number>;
  usable_group?: Record<string, unknown>;
}

const MAX_BYTES = 200 * 1024 * 1024;
/** 参考素材按 data URL / Base64 嵌进请求，单个文件上限 */
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const CACHE_MS = 3600_000;
const DOCS_URL = "https://docs.modelflare.dev";
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
/** 请求体里的 "workspace:media/a.png"（data URL）或 "workspace-base64:media/a.png"（纯 Base64） */
const FILE_REF = /^workspace(-base64)?:(.+)$/;

export class MediaError extends Error {}

const num = (n: number) => String(+n.toFixed(n < 0.1 ? 4 : 3));

/** 推荐顺序：价格目录的 display_priority 小的在前，必须带参考素材的放后面，其余按名字 */
export function sortModels(list: MediaModel[]): MediaModel[] {
  return [...list].sort((a, b) => a.priority - b.priority || Number(a.requiresReference) - Number(b.requiresReference) || a.id.localeCompare(b.id, "en", { sensitivity: "base" }));
}

/** 设置里的默认模型还能用就用它，否则推荐顺序里第一个不需要参考素材的 */
export function pickDefault(list: MediaModel[], configured: string): MediaModel | undefined {
  return list.find((m) => m.id === configured) ?? list.find((m) => !m.requiresReference) ?? list[0];
}

/** 一句参考价；复杂计费（按 token）只说明计费方式 */
export function priceNote(e: CatalogEntry | undefined, catalog: Catalog): string {
  if (!e) return "";
  const ratios = (e.enable_groups ?? [])
    .filter((g) => !catalog.usable_group || g in catalog.usable_group)
    .map((g) => catalog.group_ratio?.[g])
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r >= 0);
  const factor = ratios.length ? Math.min(...ratios) : 1;
  const perSecond = Object.entries(e.video_resolution_price ?? {}).filter(([, p]) => typeof p === "number" && p > 0);
  if (perSecond.length) {
    const want = String(e.media_options?.video?.default_resolution ?? "");
    const [res, p] = perSecond.find(([r]) => r === want) ?? perSecond.sort((a, b) => a[1] - b[1])[0];
    return `$${num(p * factor)}/秒（${res}）`;
  }
  if (e.quota_type === 1 && typeof e.model_price === "number" && e.model_price > 0) return `$${num(e.model_price * factor)}/${e.billing_unit === "per_call" ? "次" : "张"}`;
  if (e.billing_unit === "token") return "按 token 计费";
  return "";
}

/** 一行参数范围：尺寸、比例、分辨率、时长、参考素材 */
export function optionsNote(m: MediaModel): string {
  const o = m.options ?? {};
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []);
  const parts: string[] = [];
  if (list("sizes").length) parts.push(`尺寸 ${list("sizes").join("/")}`);
  if (list("resolutions").length) parts.push(`分辨率 ${list("resolutions").join("/")}`);
  if (list("ratios").length) parts.push(`比例 ${list("ratios").join("/")}`);
  const secs = list("seconds").map(Number).filter((n) => n > 0);
  if (secs.length) parts.push(`时长 ${Math.min(...secs)}–${Math.max(...secs)} 秒`);
  const refs = list("reference_media");
  if (refs.length) parts.push(`参考素材 ${refs.join("/")}`);
  else if (o.reference_images === true || Number(o.max_references) > 0) parts.push(`参考图${Number(o.max_references) > 0 ? ` 最多 ${o.max_references} 张` : ""}`);
  if (m.requiresReference) parts.push("必须带参考素材");
  return parts.join(" · ");
}

/** 从请求体里挑出给用户看的参数（分辨率、比例、时长……），并数一数参考素材 */
export function describeBody(body: Record<string, unknown> | undefined): string {
  if (!body) return "";
  const keys: Record<string, string> = { resolution: "", aspect_ratio: "", ratio: "", size: "", imageSize: "", aspectRatio: "", seconds: "秒", duration: "秒", quality: "" };
  const seen = new Map<string, string>();
  let refs = 0;
  const walk = (v: unknown, depth: number) => {
    if (typeof v === "string") {
      if (FILE_REF.test(v) || /^https?:\/\//i.test(v) || v.startsWith("data:")) refs++;
      return;
    }
    if (!v || typeof v !== "object" || depth > 6) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k in keys && (typeof x === "string" || typeof x === "number")) {
        // 时长两种写法只显示一个
        const label = k === "duration" ? "seconds" : k === "aspectRatio" || k === "aspect_ratio" ? "ratio" : k === "imageSize" ? "size" : k;
        if (!seen.has(label)) seen.set(label, `${x}${keys[k] && Number(x) > 0 ? ` ${keys[k]}` : ""}`);
      } else walk(x, depth + 1);
    }
  };
  walk(body, 0);
  const parts = [...seen.values()];
  if (refs) parts.push(`${refs} 个参考素材`);
  return parts.join(" · ");
}

/** 从文档全文里取出某个模型的那一节（每节以 "# 标题" 开头、下一行是 "Source: <页面地址>"） */
export function docSection(full: string, docsUrl: string, kind: MediaKind, model: string): string {
  const slug = model.toLowerCase().replace(/\./g, "-");
  const marker = `\nSource: ${docsUrl}/models/${kind}/${slug}/\n`;
  const at = full.indexOf(marker);
  if (at < 0) return "";
  const start = full.lastIndexOf("\n# ", at);
  const next = full.indexOf("\n---\n\n# ", at + marker.length);
  return full.slice(start < 0 ? at : start + 1, next < 0 ? undefined : next).trim();
}

export class MediaService {
  private catalogCache: { at: number; data: Catalog } | undefined;
  private docsCache: { at: number; text: string } | undefined;

  constructor(private o: MediaOptions) {}

  private get fetch(): typeof fetch {
    return this.o.fetchImpl ?? fetch;
  }
  private get docsUrl(): string {
    return (this.o.docsUrl ?? DOCS_URL).replace(/\/+$/, "");
  }

  /** 直接生成（不经确认，测试与内部用）：解析模型后执行 */
  async run(botId: string, op: string, args: Record<string, unknown>): Promise<string> {
    const plan = await this.prepare(botId, op, args);
    return this.execute(botId, plan.model, args);
  }

  private key(botId: string): string {
    const key = this.o.keyFor(botId);
    if (!key) throw new MediaError("还没有连接 Modelflare，无法生成图片或视频");
    return key;
  }

  private async call(key: string, method: string, p: string, body?: unknown, timeoutMs = 300_000): Promise<Response> {
    const res = await this.fetch(`${this.o.baseUrl()}${p}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...this.o.headers(), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
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

  private async catalog(): Promise<Catalog> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CACHE_MS) return this.catalogCache.data;
    let data: Catalog = {};
    const url = this.o.pricingUrl?.();
    if (url) {
      try {
        const res = await this.fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (res.ok) data = (await res.json()) as Catalog;
      } catch (e) {
        log.warn("pricing catalog unavailable", { message: (e as Error).message.slice(0, 200) });
      }
    }
    this.catalogCache = { at: Date.now(), data };
    return data;
  }

  /** 这把 Key 能用的图片 / 视频模型，按推荐顺序 */
  async available(key: string, kind: MediaKind): Promise<MediaModel[]> {
    const [res, catalog] = await Promise.all([this.call(key, "GET", `/models?scope=authorized&kind=${kind}`, undefined, 20_000), this.catalog()]);
    const body = (await res.json()) as { data?: Array<{ id?: string; kind?: string; image_route?: string }> };
    const entries = new Map((catalog.data ?? []).map((e) => [e.model_name, e]));
    const out: MediaModel[] = [];
    for (const m of body.data ?? []) {
      if (!m.id || (m.kind && m.kind !== kind)) continue;
      const route = kind === "video" ? "videos" : m.image_route === "gemini-generate-content" ? "gemini" : m.image_route === "images" ? "images" : undefined;
      if (!route) continue;
      const e = entries.get(m.id);
      const options = e?.media_options?.[kind];
      out.push({
        id: m.id,
        kind,
        route,
        options,
        requiresReference: options?.requires_reference === true,
        price: priceNote(e, catalog),
        priority: typeof e?.display_priority === "number" ? e.display_priority : 1e9,
      });
    }
    return sortModels(out);
  }

  async models(botId: string, kind: MediaKind): Promise<MediaModel[]> {
    return this.available(this.key(botId), kind);
  }

  defaultId(kind: MediaKind): string {
    return this.o.defaults?.()[kind] ?? "";
  }

  /** media_models 工具：列出可用模型、默认模型、参数范围与参考价 */
  async listText(botId: string, kind: unknown): Promise<string> {
    const kinds: MediaKind[] = kind === "image" || kind === "video" ? [kind] : ["image", "video"];
    const blocks: string[] = [];
    for (const k of kinds) {
      const list = await this.models(botId, k);
      const name = k === "image" ? "图片" : "视频";
      if (!list.length) {
        blocks.push(`这把 Key 没有可用的${name}模型。`);
        continue;
      }
      const def = pickDefault(list, this.defaultId(k));
      const lines = list.map((m) => `- ${m.id}${m === def ? "（默认）" : ""}${[m.price, optionsNote(m)].filter(Boolean).map((s) => ` — ${s}`).join("")}`);
      blocks.push(`可用的${name}模型（按推荐顺序）：\n${lines.join("\n")}`);
    }
    blocks.push("生成前会由程序向用户确认这次用哪个模型。要用参考图、比例、分辨率、时长等参数时，先用 media_docs 读该模型的文档，按文档写 body。");
    return blocks.join("\n\n");
  }

  /** media_docs 工具：该模型在 docs.modelflare.dev 上的那一页（Markdown） */
  async docs(model: unknown): Promise<string> {
    const id = String(model ?? "").trim();
    if (!id) throw new MediaError("缺少 model");
    if (!this.docsCache || Date.now() - this.docsCache.at > CACHE_MS) {
      const res = await this.fetch(`${this.docsUrl}/llms-full.txt`, { signal: AbortSignal.timeout(30_000) }).catch((e: Error) => {
        throw new MediaError(`读取文档失败：${e.message}`);
      });
      if (!res.ok) throw new MediaError(`读取文档失败（HTTP ${res.status}）`);
      this.docsCache = { at: Date.now(), text: await res.text() };
    }
    const text = docSection(this.docsCache.text, this.docsUrl, "image", id) || docSection(this.docsCache.text, this.docsUrl, "video", id);
    if (!text) throw new MediaError(`文档里没有 ${id} 的页面，模型列表见 ${this.docsUrl}/models/`);
    const cap = 24_000;
    return `${text.length > cap ? `${text.slice(0, cap)}\n…（已截断）` : text}\n\n---\n按上面的请求格式写 generate_* 工具的 body（不用写 model，也不要自己用 curl 调接口：你没有 Key，程序会代发）。本地文件写成 "workspace:相对路径"（换成 data URL）或 "workspace-base64:相对路径"（换成纯 Base64，例如 Gemini 的 inline_data.data）。`;
  }

  /** 解析这次要用的模型与确认时列出的其他选择 */
  async prepare(botId: string, op: string, args: Record<string, unknown>): Promise<MediaPlan> {
    if (op !== "image" && op !== "video") throw new MediaError(`未知操作 ${op}`);
    const kind: MediaKind = op;
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new MediaError("缺少 prompt");
    const body = parseBody(args.body);
    const all = await this.models(botId, kind);
    if (!all.length) throw new MediaError(kind === "image" ? "这把 Key 没有可用的图片模型" : "这把 Key 没有可用的视频模型");
    const name = String(args.model ?? "").trim();
    const def = pickDefault(all, this.defaultId(kind))!;
    const model = name ? all.find((m) => m.id === name) : def;
    if (!model) throw new MediaError(`没有这个模型：${name}。可用：${all.map((m) => m.id).join("、")}`);
    const hasRefs = /"workspace(-base64)?:|"https?:\/\/|"data:/.test(JSON.stringify(body ?? {}));
    const candidates = [def, ...all].filter((m, i, a) => m !== model && a.indexOf(m) === i && (hasRefs || !m.requiresReference)).slice(0, 3);
    const params = describeBody(body) || [typeof args.size === "string" ? args.size : "", Number(args.seconds) > 0 ? `${args.seconds} 秒` : ""].filter(Boolean).join(" · ");
    const summary = [`提示词：${prompt.length > 120 ? `${prompt.slice(0, 120)}…` : prompt}`, params && `参数：${params}`, model.price && `参考价：${model.price}`].filter(Boolean).join("\n");
    return { kind, model, default: def, candidates, all, custom: !!body, summary };
  }

  /** 用确定下来的模型生成，返回给模型的一段文字 */
  async execute(botId: string, model: MediaModel, args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt ?? "").trim();
    const body = parseBody(args.body);
    const resolved = body ? (this.inline(botId, body) as Record<string, unknown>) : undefined;
    return model.kind === "image" ? this.image(botId, model, prompt, resolved, args) : this.video(botId, model, prompt, resolved, args);
  }

  /** 把请求体里的 "workspace:路径" 换成 data URL、"workspace-base64:路径" 换成纯 Base64；只认工作区里的文件 */
  private inline(botId: string, v: unknown): unknown {
    if (typeof v === "string") {
      const m = FILE_REF.exec(v);
      if (!m) return v;
      const file = this.workspaceFile(botId, m[2].trim());
      const data = fs.readFileSync(file);
      const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      return m[1] ? data.toString("base64") : `data:${mime};base64,${data.toString("base64")}`;
    }
    if (Array.isArray(v)) return v.map((x) => this.inline(botId, x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.inline(botId, x)]));
    return v;
  }

  private workspaceFile(botId: string, rel: string): string {
    const root = fs.realpathSync(this.o.workspace(botId));
    let real: string;
    try {
      real = fs.realpathSync(path.resolve(root, rel));
    } catch {
      throw new MediaError(`工作区里没有这个文件：${rel}`);
    }
    if (real !== root && !real.startsWith(root + path.sep)) throw new MediaError(`只能引用工作区里的文件：${rel}`);
    const st = fs.statSync(real);
    if (!st.isFile()) throw new MediaError(`不是文件：${rel}`);
    if (st.size > MAX_REFERENCE_BYTES) throw new MediaError(`参考素材太大（${rel}，上限 20 MB）`);
    return real;
  }

  private save(botId: string, kind: MediaKind, data: Buffer, mime: string): string {
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

  private async image(botId: string, model: MediaModel, prompt: string, body: Record<string, unknown> | undefined, args: Record<string, unknown>): Promise<string> {
    const key = this.key(botId);
    const files: string[] = [];
    if (model.route === "gemini") {
      const req = body ? withoutModel(body) : { contents: [{ role: "user", parts: [{ text: prompt }] }] };
      const res = await this.call(key, "POST", `/models/${encodeURIComponent(model.id)}:generateContent`, req);
      const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }> };
      for (const c of out.candidates ?? [])
        for (const p of c.content?.parts ?? []) {
          const data = p.inlineData?.data ?? p.inline_data?.data;
          if (data) files.push(this.save(botId, "image", Buffer.from(data, "base64"), p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? "image/png"));
        }
    } else {
      const size = typeof args.size === "string" && /^\d{2,5}x\d{2,5}$/.test(args.size) ? args.size : undefined;
      const req = body ? { ...body, model: model.id } : { model: model.id, prompt, ...(size ? { size } : {}) };
      const res = await this.call(key, "POST", args.endpoint === "edits" ? "/images/edits" : "/images/generations", req);
      const out = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      for (const item of out.data ?? []) {
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

  private async video(botId: string, model: MediaModel, prompt: string, body: Record<string, unknown> | undefined, args: Record<string, unknown>): Promise<string> {
    const key = this.key(botId);
    const seconds = Number(args.seconds);
    const size = typeof args.size === "string" && /^\d{2,5}x\d{2,5}$/.test(args.size) ? args.size : undefined;
    const req = body
      ? { ...body, model: model.id }
      : { model: model.id, prompt, ...(Number.isFinite(seconds) && seconds > 0 ? { seconds: String(Math.round(seconds)) } : {}), ...(size ? { size } : {}) };
    const created = (await (await this.call(key, "POST", "/videos", req)).json()) as { id?: string; task_id?: string };
    const id = created.id || created.task_id;
    if (!id) throw new MediaError("Modelflare 没有返回视频任务编号");
    const deadline = Date.now() + (this.o.videoTimeoutMs ?? 20 * 60_000);
    for (;;) {
      const t = (await (await this.call(key, "GET", `/videos/${encodeURIComponent(id)}`, undefined, 30_000)).json()) as {
        status?: string;
        error?: { message?: string } | null;
        error_message?: string;
      };
      if (t.status === "completed") break;
      if (t.status === "failed") throw new MediaError(`视频生成失败：${t.error?.message || t.error_message || "未知原因"}`);
      if (Date.now() > deadline) throw new MediaError(`视频任务 ${id} 超时还没完成，可以稍后再试`);
      await new Promise((r) => setTimeout(r, this.o.pollMs ?? 5000));
    }
    const content = await this.call(key, "GET", `/videos/${encodeURIComponent(id)}/content`, undefined, 600_000);
    const d = await this.readBody(content);
    const file = this.save(botId, "video", d.data, d.mime || "video/mp4");
    log.info("video generated", { bot: botId, model: model.id });
    return `已用 ${model.id} 生成视频，保存在工作区：${file}。要发给用户，请用 present 工具交付这个文件。`;
  }
}

/** body 可以是对象，也可以是 JSON 文本（有的模型会把它写成字符串） */
function parseBody(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  let o = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      throw new MediaError("body 不是合法的 JSON");
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new MediaError("body 必须是 JSON 对象");
  return o as Record<string, unknown>;
}

function withoutModel(body: Record<string, unknown>): Record<string, unknown> {
  const { model: _model, ...rest } = body;
  return rest;
}
