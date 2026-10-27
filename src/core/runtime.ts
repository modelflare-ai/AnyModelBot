import path from "node:path";
import type { InboundEvent, ReplySession } from "./types.js";
import { eventText } from "./types.js";
import type { ModelClient, ChatMessage } from "../llm/client.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import type { AgentManager } from "../agent/manager.js";
import { promptText, type QuestionItem } from "../agent/approvals.js";
import { MEMORY_GUIDE } from "../agent/steward.js";
import type { ApprovalRow } from "../store/db.js";

const log = logger("runtime");

export interface RuntimeOptions {
  store: Store;
  models: ModelClient;
  defaultModel: () => string;
  contextMessages: number;
  contextChars: number;
  /** DSH 代理宿主；缺省或不可用时走纯对话路径 */
  agent?: AgentManager;
}

const HELP = [
  "可用命令：",
  "/model — 列出可用模型（带编号）",
  "/model <编号或模型名> — 切换当前会话的模型",
  "/reset — 清空当前会话的上下文（代理模式下同时开启新的代理会话；长期记忆保留）",
  "/new — 开始新的一段对话：旧对话归档并生成交接便条，长期记忆保留",
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
    const conv = store.ensureConversation(bot.id, ev.channel, ev.conversation.id, ev.sender.name || ev.sender.id, ev.conversation.kind === "group" ? "group" : "dm");
    const text = eventText(ev);
    if (!text) return;

    if (text.startsWith("/")) {
      const reply = await this.command(text, conv.id, conv.model, bot.defaultModel, bot.id);
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

    const agent = this.opts.agent;
    if (agent?.available) {
      const handled = await this.handleAgent(agent, bot.id, conv.id, text, model, bot.systemPrompt, out);
      if (handled) return;
    }

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

  /** 渠道在进入每会话串行队列之前调用：处理审批回复（y 1234 / n 1234）与提问回答。 */
  interceptReply(ev: InboundEvent): { handled: boolean; ack?: string } {
    const agent = this.opts.agent;
    if (!agent) return { handled: false };
    const text = eventText(ev);
    const convId = `${ev.botId}:${ev.channel}:${ev.conversation.id}`;
    return agent.approvals.handleReply(convId, text, `${ev.channel}:${ev.sender.id}`);
  }

  /** 卡片按钮回调：批准/拒绝/选择选项。 */
  cardAction(botId: string, value: Record<string, string>, by: string): { toast: string; ok: boolean } {
    const agent = this.opts.agent;
    const row = agent && value?.id ? this.opts.store.getApproval(String(value.id)) : undefined;
    if (!agent || !row || row.botId !== botId) return { toast: "请求不存在", ok: false };
    if (row.status !== "pending") return { toast: `请求 ${row.code} 已处理或已过期`, ok: false };
    if (value.amb === "approval") {
      const allow = value.decision === "allow";
      return agent.approvals.decide(row.id, allow, by) ? { toast: allow ? `已批准 ${row.code}（仅本次）` : `已拒绝 ${row.code}`, ok: true } : { toast: "已过期", ok: false };
    }
    if (value.amb === "question") {
      const r = agent.approvals.handleReply(row.conversationId, String(value.option ?? ""), by);
      return r.handled ? { toast: "已提交", ok: true } : { toast: "提交失败", ok: false };
    }
    return { toast: "未知操作", ok: false };
  }

  /** 代理回合；返回 false 表示宿主不可用且尚无任何输出，调用方回退到纯对话。 */
  private async handleAgent(agent: AgentManager, botId: string, convId: string, text: string, model: string, systemPrompt: string, out: ReplySession): Promise<boolean> {
    const { store } = this.opts;
    let visible = false;
    const unbind = agent.approvals.bindSink(convId, async (row) => {
      visible = true;
      await out.apply(interactiveOp(row));
    });
    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    try {
      const input = store.getAgentSession(convId) ? text : firstInput(agent, botId, convId, systemPrompt, text);
      const r = await agent.runTurn(botId, {
        conversationId: convId,
        text: input,
        model,
        observer: {
          // 工具调用不进入聊天：只用于判断代理已开始工作（不再回退到纯对话），正在输入状态由渠道维持
          onProgress: () => {
            visible = true;
          },
        },
      });
      store.addMessage(convId, "user", text);
      const finalText = r.text.trim() || "（已完成，没有文字回复）";
      store.addMessage(convId, "assistant", finalText);
      await out.apply({ type: "stream.finish", text: finalText });
      for (const f of r.files ?? []) {
        try {
          await out.apply({ type: "file", path: f, name: path.basename(f) });
        } catch (e) {
          log.warn("deliver file failed", { name: path.basename(f), message: (e as Error).message.slice(0, 200) });
        }
      }
      return true;
    } catch (e) {
      const err = e as Error;
      log.warn("agent turn failed", { message: err.message.slice(0, 300) });
      if (!visible && agent.host(botId).state !== "running") {
        log.warn("agent host unavailable, falling back to plain chat");
        return false;
      }
      store.addMessage(convId, "user", text);
      await out.apply({ type: "stream.finish", text: `⚠️ 代理执行失败：${err.message.slice(0, 300)}` });
      return true;
    } finally {
      unbind();
      await out.apply({ type: "typing", on: false });
    }
  }

  /** 返回 null 表示不是已知命令，按普通消息处理。 */
  private async command(text: string, convId: string, convModel: string, botModel: string, botId: string): Promise<string | null> {
    const [cmd, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "/help":
        return HELP;
      case "/reset":
        this.opts.store.clearMessages(convId);
        this.opts.agent?.resetConversation(convId);
        return "✅ 已清空本会话上下文";
      case "/new": {
        const a = this.opts.agent;
        if (!a?.available) return "⚠️ /new 只在代理模式下可用；纯对话模式请用 /reset";
        if (!this.opts.store.getAgentSession(convId)) return "当前已经是新的一段对话";
        try {
          await a.newSegment(botId, convId, await this.resolveModel(convModel, botModel));
        } catch (e) {
          return `⚠️ 开新段失败：${(e as Error).message.slice(0, 200)}`;
        }
        return "✅ 已开始新的一段对话（旧对话已归档并留下交接便条，长期记忆保留）";
      }
      case "/status": {
        const m = convModel || botModel || this.opts.defaultModel() || "（自动：第一个可用模型）";
        const a = this.opts.agent;
        const mode = a?.available ? "代理模式（DeepSeek Harness，工作区沙箱）" : "纯对话模式";
        const pend = a ? a.approvals.pending(convId).map((r) => `${r.kind === "approval" ? "待批准" : "待回答"} ${r.code}`) : [];
        const cui = a?.available ? a.computerUse(botId) : undefined;
        const cu = cui ? [`电脑操作：${cui.backend === "codex" ? "Codex 桥" : "Cua Driver"}，${cui.active ? "已启用" : "未启用"}——${cui.reason}`, ...(cui.notice && cui.enabled ? [cui.notice] : [])] : [];
        return [`当前模型：${m}${convModel ? "（会话设置）" : ""}`, `运行方式：${mode}`, ...cu, ...(pend.length ? [`未决：${pend.join("，")}`] : [])].join("\n");
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

/**
 * 一段代理会话的首条输入：机器人设定 + 记忆说明与冻结快照 + 交接便条（一次性）+ 用户消息。
 * 这一段之内不再变化，便于模型端前缀缓存；记忆在下一段才刷新（本段内用 recall 查最新）。
 */
export function firstInput(agent: AgentManager, botId: string, convId: string, systemPrompt: string, text: string): string {
  const parts: string[] = [];
  if (systemPrompt.trim()) parts.push(`[机器人设定]\n${systemPrompt.trim()}`);
  if (agent.settings(botId).memory.enabled) {
    const snap = agent.memoryPrefix(botId, convId);
    parts.push(`[长期记忆]\n${MEMORY_GUIDE}\n\n${snap || "（目前为空）"}`);
  }
  const seed = agent.takeSeed(convId);
  if (seed) parts.push(`[交接]\n以下是上一段对话留下的交接便条，供你延续上下文：\n${seed}`);
  if (!parts.length) return text;
  return `${parts.join("\n\n")}\n\n[用户消息]\n${text}`;
}

/** 审批/提问 → 出站交互操作（文本渠道用 prompt；卡片渠道用 buttons）。 */
export function interactiveOp(row: ApprovalRow) {
  if (row.kind === "approval") {
    return {
      type: "interactive" as const,
      kind: "approval" as const,
      prompt: promptText(row),
      requestId: row.id,
      code: row.code,
      buttons: [
        { label: "允许（仅本次）", value: { amb: "approval", id: row.id, decision: "allow" }, style: "primary" as const },
        { label: "拒绝", value: { amb: "approval", id: row.id, decision: "deny" }, style: "danger" as const },
      ],
    };
  }
  let qs: QuestionItem[] = [];
  try {
    qs = JSON.parse(row.payload);
  } catch {
    /* ignore */
  }
  const single = qs.length === 1 ? qs[0] : undefined;
  return {
    type: "interactive" as const,
    kind: "ask_user" as const,
    prompt: promptText(row),
    requestId: row.id,
    code: row.code,
    buttons: single?.options?.length && !single.multiSelect ? single.options.map((o, i) => ({ label: o.label, value: { amb: "question", id: row.id, option: String(i + 1) }, style: "default" as const })) : undefined,
  };
}
