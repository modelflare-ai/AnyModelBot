/** 内部 bridge：生视频这种长调用不能被子进程里 fetch 的 5 分钟超时打断。 */
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentBridge } from "../src/agent/bridge.js";

let bridge: AgentBridge | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await bridge?.stop();
  bridge = undefined;
});

/** 像 amb-media 插件那样 POST /dsh/media；返回响应头到达的时刻和逐段收到的正文 */
function post(b: AgentBridge, path: string, body: unknown) {
  const chunks: string[] = [];
  let ended!: () => void;
  const end = new Promise<void>((r) => (ended = r));
  const response = new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(b.url + path, { method: "POST", headers: { authorization: `Bearer ${b.token}`, "content-type": "application/json" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (c: string) => chunks.push(c));
      res.on("end", ended);
      resolve(res);
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
  return { response, chunks, end };
}

const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

describe("bridge /dsh/media", () => {
  it("answers with headers at once and keeps the connection alive until a long generation finishes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let finish!: (v: unknown) => void;
    const seen: unknown[] = [];
    bridge = new AgentBridge({
      upstream: () => ({ baseUrl: "", apiKey: "" }),
      ask: async () => ({ id: "" }),
      wait: async () => ({}),
      cancel: async () => undefined,
      media: (b) => (seen.push(b), new Promise((r) => (finish = r))),
    });
    await bridge.start();
    const r = post(bridge, "/dsh/media", { botId: "b", op: "video", args: { prompt: "a cat" } });
    // 子进程里的 fetch 只等 5 分钟响应头：头必须在生成完成之前就到
    const res = await within(r.response, 2000);
    expect(res, "no response headers while the generation runs").not.toBe("timeout");
    expect((res as http.IncomingMessage).statusCode).toBe(200);
    expect(seen).toEqual([{ botId: "b", op: "video", args: { prompt: "a cat" } }]);
    // 每分钟一个空格，fetch 两段数据之间也只等 5 分钟
    for (let i = 1; i <= 6; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(r.chunks.join("")).toBe(" ".repeat(i)));
    }
    finish({ text: "已用 v1 生成视频，保存在工作区：media/video-1.mp4。" });
    await r.end;
    expect(JSON.parse(r.chunks.join(""))).toEqual({ text: "已用 v1 生成视频，保存在工作区：media/video-1.mp4。" });
  });

  it("a failing handler still ends with a JSON error the plugin can show", async () => {
    bridge = new AgentBridge({
      upstream: () => ({ baseUrl: "", apiKey: "" }),
      ask: async () => ({ id: "" }),
      wait: async () => ({}),
      cancel: async () => undefined,
      media: async () => {
        throw new Error("boom");
      },
    });
    await bridge.start();
    const r = post(bridge, "/dsh/media", {});
    await r.end;
    expect(JSON.parse(r.chunks.join(""))).toEqual({ error: "boom" });
  });
});
