import type { InboundEvent, ReplySession } from "./types.js";
import { eventText } from "./types.js";
import type { ModelClient, ChatMessage } from "../llm/client.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";

const log = logger("runtime");

export interface RuntimeOptions {
  store: Store;
  models: ModelClient;
  defaultModel: () => string;
  contextMessages: number;
  contextChars: number;
}

const HELP = [
  "可用命令：",
  "/model — 列出可用模型（带编号）",
  "/model <编号或模型名> — 切换当前会话的模型",
  "/reset — 清空当前会话的上下文",
  "/status — 查看当前会话使用的模型",
  "/help — 显示本帮助",
].join("\n");

/** 渠道无关的对话运行时：命令处理、上下文拼装、流式调用模型、持久化。 */
export class BotRuntime {
  private modelCache: { at: number; list: string[] } | undefined;
  constructor(private opts: RuntimeOptions) {}

  async listModels(force = false): Promise<string[]> {
    if (!force && this.modelCache && Date.now() - this.modelCache.at < 30_000) return this.modelCache.list;
    const list = await this.opts.models.listModels();
    this.modelCache = { at: Date.now(), list };
    return list;
  }

  private async resolveModel(convModel: string, botModel: string): Promise<string> {
    const m = convModel || botModel || this.opts.defaultModel();
    if (m) return m;
    const list = await this.listModels();
    if (!list.length) throw new Error("没有可用模型：请先在「模型」页（magpie）添加服务商并配置 API Key");
    return list[0];
  }

  async handle(ev: InboundEvent, out: ReplySession): Promise<void> {
    const { store } = this.opts;
    const bot = store.getBot(ev.botId);
    if (!bot) throw new Error(`unknown bot ${ev.botId}`);
    const conv = store.ensureConversation(bot.id, ev.channel, ev.conversation.id, ev.sender.name || ev.sender.id);
    const text = eventText(ev);
    if (!text) return;

    if (text.startsWith("/")) {
      const reply = await this.command(text, conv.id, conv.model, bot.defaultModel);
      if (reply !== null) {
        await out.apply({ type: "text", text: reply });
        return;
      }
    }

    const model = await this.resolveModel(conv.model, bot.defaultModel).catch(async (e: Error) => {
      await out.apply({ type: "text", text: `⚠️ ${e.message}` });
      return "";
    });
    if (!model) return;

    store.addMessage(conv.id, "user", text);
    const history = store.contextWindow(conv.id, this.opts.contextMessages, this.opts.contextChars);
    const messages: ChatMessage[] = [];
    if (bot.systemPrompt.trim()) messages.push({ role: "system", content: bot.systemPrompt });
    for (const m of history) if (m.role !== "system") messages.push({ role: m.role, content: m.content });

    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    let acc = "";
    try {
      const full = await this.opts.models.streamChat({ model, messages }, (delta) => {
        acc += delta;
        void out.apply({ type: "stream.update", text: acc });
      });
      const finalText = full || acc || "（模型没有返回内容）";
      store.addMessage(conv.id, "assistant", finalText);
      await out.apply({ type: "stream.finish", text: finalText });
    } catch (e) {
      const err = e as Error & { status?: number };
      log.warn("model call failed", { model, status: err.status, message: err.message });
      const msg = acc ? `${acc}\n\n⚠️ 生成中断：${err.message}` : `⚠️ 模型调用失败（${model}）：${err.message}`;
      await out.apply({ type: "stream.finish", text: msg });
    } finally {
      await out.apply({ type: "typing", on: false });
    }
  }

  /** 返回 null 表示不是已知命令，按普通消息处理。 */
  private async command(text: string, convId: string, convModel: string, botModel: string): Promise<string | null> {
    const [cmd, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "/help":
        return HELP;
      case "/reset":
        this.opts.store.clearMessages(convId);
        return "✅ 已清空本会话上下文";
      case "/status": {
        const m = convModel || botModel || this.opts.defaultModel() || "（自动：第一个可用模型）";
        return `当前模型：${m}${convModel ? "（会话设置）" : ""}`;
      }
      case "/model": {
        let list: string[];
        try {
          list = await this.listModels(true);
        } catch (e) {
          return `⚠️ 获取模型列表失败：${(e as Error).message}`;
        }
        if (!arg) {
          const cur = convModel || botModel || this.opts.defaultModel();
          if (!list.length) return "暂无可用模型，请先在「模型」页添加服务商。";
          return ["可用模型（回复 /model 编号 切换）：", ...list.map((m, i) => `${i + 1}. ${m}${m === cur ? "  ← 当前" : ""}`)].join("\n");
        }
        if (arg === "default" || arg === "reset") {
          this.opts.store.setConversationModel(convId, "");
          return "✅ 已恢复为机器人默认模型";
        }
        const idx = /^\d+$/.test(arg) ? Number(arg) - 1 : -1;
        const target = idx >= 0 ? list[idx] : list.find((m) => m === arg) ?? list.find((m) => m.endsWith("/" + arg) || m.includes(arg));
        if (!target) return `⚠️ 找不到模型「${arg}」，发送 /model 查看列表`;
        this.opts.store.setConversationModel(convId, target);
        return `✅ 本会话已切换到 ${target}`;
      }
      default:
        return null;
    }
  }
}
