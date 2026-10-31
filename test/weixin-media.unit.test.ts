/** 微信入站媒体：iLink CDN 下载解密、条目 → Part、存进工作区、交给模型的图片。 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IlinkClient, hasDownloadableMedia, parseAesKey, sniffImageMime, type MessageItem } from "../src/channels/weixin/api.js";
import { weixinParts } from "../src/channels/weixin/channel.js";
import { eventText, type InboundEvent, type Part } from "../src/core/types.js";
import { inboundImages, storeInbound } from "../src/core/runtime.js";
import { acceptsImages } from "../src/llm/client.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)]);
const enc = (b: Buffer, k: Buffer) => {
  const c = crypto.createCipheriv("aes-128-ecb", k, null);
  return Buffer.concat([c.update(b), c.final()]);
};

/** 假 CDN：/c2c/download?encrypted_query_param=… 与 full_url 两种取法 */
function cdn(blobs: Record<string, Buffer | number>) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    const u = new URL(url);
    const id = u.pathname === "/c2c/download" ? u.searchParams.get("encrypted_query_param")! : u.pathname.slice(1);
    const b = blobs[id];
    if (typeof b === "number") return new Response("", { status: b, headers: { "x-error-message": "boom" } });
    return b ? new Response(new Uint8Array(b)) : new Response("", { status: 400, headers: { "x-error-message": "invalid encrypted_param" } });
  }) as any;
  return { client: new IlinkClient({ baseUrl: "http://ilink", token: "t", fetchImpl, cdnBaseUrl: "http://cdn/c2c" }), urls };
}

describe("IlinkClient.downloadMedia", () => {
  const key = crypto.randomBytes(16);
  const hexKeyB64 = Buffer.from(key.toString("hex")).toString("base64");

  it("image: image_item.aeskey (hex) wins; query param is URL-encoded; format sniffed", async () => {
    const { client, urls } = cdn({ "a+b/=": enc(PNG, key) });
    const got = await client.downloadMedia({ type: 2, image_item: { aeskey: key.toString("hex"), media: { encrypt_query_param: "a+b/=", aes_key: "ignored" } } });
    expect(got).toMatchObject({ kind: "image", mime: "image/png" });
    expect(got.data.equals(PNG)).toBe(true);
    expect(urls[0]).toBe("http://cdn/c2c/download?encrypted_query_param=a%2Bb%2F%3D");
  });

  it("image: media.aes_key as base64 of the raw key, or no key at all (plain bytes)", async () => {
    const { client } = cdn({ e: enc(JPG, key), p: JPG });
    expect((await client.downloadMedia({ type: 2, image_item: { media: { encrypt_query_param: "e", aes_key: key.toString("base64") } } })).mime).toBe("image/jpeg");
    expect((await client.downloadMedia({ type: 2, image_item: { media: { encrypt_query_param: "p" } } })).data.equals(JPG)).toBe(true);
  });

  it("file: aes_key is base64 of the hex string; keeps the file name. video: same key form", async () => {
    const { client } = cdn({ f: enc(Buffer.from("季度数据\n"), key), v: enc(Buffer.from("mp4"), key) });
    const f = await client.downloadMedia({ type: 4, file_item: { file_name: "报告.txt", media: { encrypt_query_param: "f", aes_key: hexKeyB64 } } });
    expect(f).toMatchObject({ kind: "file", name: "报告.txt" });
    expect(f.data.toString()).toBe("季度数据\n");
    expect((await client.downloadMedia({ type: 5, video_item: { media: { encrypt_query_param: "v", aes_key: hexKeyB64 } } })).kind).toBe("video");
  });

  it("prefers full_url when the server gives one", async () => {
    const { client, urls } = cdn({ "dl/1": enc(PNG, key) });
    const got = await client.downloadMedia({ type: 2, image_item: { aeskey: key.toString("hex"), media: { full_url: "http://cdn2/dl/1", encrypt_query_param: "x" } } });
    expect(got.data.equals(PNG)).toBe(true);
    expect(urls).toEqual(["http://cdn2/dl/1"]);
  });

  it("errors: 4xx is final, 5xx is retried 3 times, wrong key, missing key, oversize, odd scheme", async () => {
    const { client, urls } = cdn({ bad: 503, img: enc(PNG, key) });
    await expect(client.downloadMedia({ type: 2, image_item: { media: { encrypt_query_param: "nope" } } })).rejects.toThrow(/HTTP 400 invalid encrypted_param/);
    expect(urls).toHaveLength(1);
    await expect(client.downloadMedia({ type: 2, image_item: { media: { encrypt_query_param: "bad" } } })).rejects.toThrow(/HTTP 503/);
    expect(urls.filter((u) => u.endsWith("=bad"))).toHaveLength(3);
    await expect(client.downloadMedia({ type: 2, image_item: { aeskey: crypto.randomBytes(16).toString("hex"), media: { encrypt_query_param: "img" } } })).rejects.toThrow(/解密失败/);
    await expect(client.downloadMedia({ type: 4, file_item: { media: { encrypt_query_param: "img" } } })).rejects.toThrow(/aes_key/);
    await expect(client.downloadMedia({ type: 2, image_item: { media: { encrypt_query_param: "img" } } }, 100)).rejects.toThrow(/过大/);
    await expect(client.downloadMedia({ type: 2, image_item: { media: { full_url: "file:///etc/passwd" } } })).rejects.toThrow(/http/);
  });

  it("helpers: key encodings, format sniffing, which items are downloadable", () => {
    expect(parseAesKey(key.toString("base64")).equals(key)).toBe(true);
    expect(parseAesKey(hexKeyB64).equals(key)).toBe(true);
    expect(() => parseAesKey(Buffer.from("short").toString("base64"))).toThrow();
    expect(sniffImageMime(Buffer.from("GIF89a....."))).toBe("image/gif");
    expect(sniffImageMime(Buffer.from("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("BM.........."))).toBeUndefined();
    expect(hasDownloadableMedia({ type: 2, image_item: { media: { encrypt_query_param: "q" } } })).toBe(true);
    expect(hasDownloadableMedia({ type: 2, image_item: {} })).toBe(false);
    expect(hasDownloadableMedia({ type: 3, voice_item: { media: { encrypt_query_param: "q" } } })).toBe(false); // 语音用转写文字
  });
});

describe("weixinParts with downloads", () => {
  const img: MessageItem = { type: 2, image_item: { media: { encrypt_query_param: "i" } } };
  const quotedImg: MessageItem = { type: 2, image_item: { media: { encrypt_query_param: "q" } } };
  const items: MessageItem[] = [
    { type: 1, text_item: { text: "这两张有什么不同？" }, ref_msg: { title: "[图片]", message_item: quotedImg } },
    img,
    { type: 4, file_item: { file_name: "a.pdf", media: { encrypt_query_param: "f" } } },
  ];

  it("before download: placeholders only (approval interception sees plain labels)", () => {
    expect(eventText(ev(weixinParts(items)))).toBe("[引用的图片]\n这两张有什么不同？\n[图片]\n[文件 a.pdf]");
  });

  it("after download: data on the parts, errors reported, quoted media instead of its title", () => {
    const media = new Map<MessageItem, any>([
      [img, { kind: "image", data: PNG, mime: "image/png" }],
      [quotedImg, { kind: "image", data: JPG, mime: "image/jpeg" }],
      [items[2], new Error("CDN 下载失败 HTTP 400")],
    ]);
    const parts = weixinParts(items, media);
    expect(parts.map((p) => p.type)).toEqual(["image", "text", "image", "file"]);
    expect(parts[0]).toMatchObject({ quoted: true, mime: "image/jpeg" });
    expect((parts[2] as any).data.equals(PNG)).toBe(true);
    expect(eventText(ev(parts))).toBe("[引用的图片]\n这两张有什么不同？\n[图片]\n[文件 a.pdf（未能下载：CDN 下载失败 HTTP 400）]");
  });
});

function ev(parts: Part[]): InboundEvent {
  return { id: "m1", channel: "weixin", botId: "b", conversation: { kind: "dm", id: "u" }, sender: { id: "u" }, parts, replyHandle: {}, receivedAt: 0 };
}

describe("storeInbound / inboundImages", () => {
  it("saves media under inbox/ with safe names and rewrites the message text to the paths", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "amb-inbox-"));
    const e = ev([
      { type: "text", text: "看看" },
      { type: "image", data: PNG, mime: "image/png" },
      { type: "image", data: Buffer.from("BM...."), mime: undefined },
      { type: "file", name: "../../etc/evil\u0007.txt", data: Buffer.from("x") },
      { type: "video", data: Buffer.from("v") },
      { type: "image", error: "CDN 下载失败 HTTP 400" },
    ]);
    storeInbound(ws, e, new Date("2026-10-31T06:43:12Z"));
    const paths = e.parts.map((p: any) => p.path).filter(Boolean);
    expect(paths).toHaveLength(4);
    expect(paths[0]).toMatch(/^inbox\/20261031-064312-[0-9a-f]{6}\.png$/);
    expect(paths[1]).toMatch(/\.jpg$/); // 认不出的格式按 jpg 存
    expect(paths[2]).toMatch(/^inbox\/20261031-064312-[0-9a-f]{6}-evil\.txt$/);
    expect(paths[3]).toMatch(/\.mp4$/);
    expect(fs.readFileSync(path.join(ws, paths[0])).equals(PNG)).toBe(true);
    expect(fs.readdirSync(ws)).toEqual(["inbox"]);
    expect(eventText(e)).toBe(`看看\n[图片 ${paths[0]}]\n[图片 ${paths[1]}]\n[文件 ../../etc/evil\u0007.txt → ${paths[2]}]\n[视频 ${paths[3]}]\n[图片（未能下载：CDN 下载失败 HTTP 400）]`);
  });

  it("only recognised, reasonably small images go to the model, at most 4", () => {
    const parts: Part[] = [
      { type: "image", data: PNG, mime: "image/png" },
      { type: "image", data: Buffer.from("BM"), mime: undefined },
      { type: "image", data: Buffer.alloc(11 * 1024 * 1024, 1), mime: "image/jpeg" },
      ...Array.from({ length: 5 }, () => ({ type: "image" as const, data: JPG, mime: "image/jpeg" })),
    ];
    const imgs = inboundImages(ev(parts));
    expect(imgs).toHaveLength(4);
    expect(imgs[0]).toEqual({ data: PNG.toString("base64"), mimeType: "image/png" });
    expect(imgs.slice(1).every((i) => i.mimeType === "image/jpeg")).toBe(true);
  });

  it("acceptsImages: vision families by name; DeepSeek / GLM text models / unknown are text-only", () => {
    for (const m of ["claude-opus-5-5", "gpt-5.4", "gpt-6.1-sol", "gemini-3.8-flash", "grok-4.7", "kimi-k3", "muse-spark-1.3", "qwen3-vl-plus", "glm-4.5v", "key1/claude-sonnet-5"]) expect(acceptsImages(m), m).toBe(true);
    for (const m of ["deepseek-v4-flash", "glm-5.3", "codex-auto-review", "qwen3.8-max", "mock-a", "jev-1.13"]) expect(acceptsImages(m), m).toBe(false);
  });
});
