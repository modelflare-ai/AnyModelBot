import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { InboundEvent, ReplySession } from "./types.js";
import { eventText } from "./types.js";
import { acceptsImages, type ModelClient, type ChatMessage } from "../llm/client.js";
import type { TurnImage } from "../agent/host.js";
import type { Store } from "../store/db.js";
import { logger } from "../log.js";
import type { AgentManager } from "../agent/manager.js";
import { promptText, type QuestionItem } from "../agent/approvals.js";
import { MEMORY_GUIDE } from "../agent/steward.js";
import { pwshProbe, pwshStatusLine } from "../agent/pwsh.js";
import { isBotProviderModel } from "../modelflare.js";
import type { ApprovalRow } from "../store/db.js";
import { t } from "../i18n/index.js";

const log = logger("runtime");

const IMAGE_EXT: Record<TurnImage["mimeType"], string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const MAX_INLINE_IMAGES = 4;
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

/** 用户这条消息里能直接交给模型看的图片（格式已识别、不太大） */
export function inboundImages(ev: InboundEvent): TurnImage[] {
  const out: TurnImage[] = [];
  for (const p of ev.parts) {
    if (p.type !== "image" || !p.data || !(p.mime && p.mime in IMAGE_EXT) || p.data.length > MAX_INLINE_IMAGE_BYTES) continue;
    if (out.length < MAX_INLINE_IMAGES) out.push({ data: p.data.toString("base64"), mimeType: p.mime as TurnImage["mimeType"] });
  }
  return out;
}

/** 发送者给的文件名只留最后一段，去掉控制字符和开头的点 */
function safeFileName(name: string | undefined): string {
  const base = path.basename((name ?? "").replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f]/g, "").replace(/^\.+/, "").trim();
  return (base || "file").slice(-80);
}

/**
 * 把用户发来的图片/文件/视频存进机器人工作区的 inbox/，消息文字里换成相对路径：
 * 代理可以读取、处理，或当生图的参考素材（workspace:inbox/...）。
 */
export function storeInbound(workspace: string, ev: InboundEvent, now = new Date()): void {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  for (const p of ev.parts) {
    if ((p.type !== "image" && p.type !== "file" && p.type !== "video") || !p.data || p.path) continue;
    const id = `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
    const name =
      p.type === "image" ? `${id}${IMAGE_EXT[p.mime as TurnImage["mimeType"]] ?? ".jpg"}` : p.type === "video" ? `${id}.mp4` : `${id}-${safeFileName(p.name)}`;
    try {
      fs.mkdirSync(path.join(workspace, "inbox"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "inbox", name), p.data);
      p.path = `inbox/${name}`;
    } catch (e) {
      log.warn("save inbound media failed", { type: p.type, message: (e as Error).message.slice(0, 200) });
      p.error = "保存到工作区失败";
    }
  }
}

export interface RuntimeOptions {
  store: Store;
  models: ModelClient;
  defaultModel: () => string;
  contextMessages: number;
  contextChars: number;
  /** DSH 代理宿主；缺省或不可用时走纯对话路径 */
  agent?: AgentManager;
  /**
   * 发给模型网关前把模型 id 限定到该机器人用的 Key（共用 Key 或它自己的预算 Key）。
   * 会话与界面里保存的仍是不带 provider 的 id。缺省原样发送。
   */
  route?: (botId: string, model: string) => string;
}

const help = () => t("runtime.help");

/** 渠道无关的对话运行时：命令处理、上下文拼装、流式调用模型、持久化。 */
export class BotRuntime {
  private modelCache: { at: number; list: string[] } | undefined;
  constructor(private opts: RuntimeOptions) {}

  async listModels(force = false): Promise<string[]> {
    if (!force && this.modelCache && Date.now() - this.modelCache.at < 30_000) return this.modelCache.list;
    // 机器人预算 Key 的 provider 列出同一批模型，只展示共用连接的那份
    const list = (await this.opts.models.listModels()).filter((m) => !isBotProviderModel(m));
    this.modelCache = { at: Date.now(), list };
    return list;
  }

  private async resolveModel(convModel: string, botModel: string): Promise<string> {
    const m = convModel || botModel || this.opts.defaultModel();
    if (m) return m;
    const list = await this.listModels();
    if (!list.length) throw new Error(t("runtime.noModels"));
    return list[0];
  }

  /** signal：网页"停止"按钮；纯对话路径会中止模型请求并保留已生成的部分（代理回合无法中途打断，会在后台跑完） */
  async handle(ev: InboundEvent, out: ReplySession, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const { store } = this.opts;
    const bot = store.getBot(ev.botId);
    if (!bot) throw new Error(`unknown bot ${ev.botId}`);
    const conv = store.ensureConversation(bot.id, ev.channel, ev.conversation.id, ev.sender.name || ev.sender.id, ev.conversation.kind === "group" ? "group" : "dm");
    const agent = this.opts.agent;
    // 代理模式：收到的图片/文件先进工作区，消息里写路径
    if (agent?.available) storeInbound(agent.host(bot.id).workspace, ev);
    const text = eventText(ev);
    if (!text) return;
    const images = inboundImages(ev);

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
    const routed = this.opts.route ? this.opts.route(bot.id, model) : model;
    // 只有能看图的模型才收到图片本身；其余模型只看到文字里的“[图片 …]”
    const seen = acceptsImages(routed) ? images : [];

    let note = "";
    if (agent?.available) {
      const handled = await this.handleAgent(agent, bot.id, conv.id, text, routed, bot.systemPrompt, out, seen);
      if (handled === true) return;
      // 代理进程还在启动（第一次可能要几分钟）：这条消息先由模型直接回答，不让用户干等
      if (handled === "starting") note = t("runtime.startingNote");
    }

    store.addMessage(conv.id, "user", text);
    const history = store.contextWindow(conv.id, this.opts.contextMessages, this.opts.contextChars);
    const messages: ChatMessage[] = [];
    if (bot.systemPrompt.trim()) messages.push({ role: "system", content: bot.systemPrompt });
    for (const m of history) if (m.role !== "system") messages.push({ role: m.role, content: m.content });
    const last = messages[messages.length - 1];
    if (seen.length && last?.role === "user" && typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content }, ...seen.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))];
    }

    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    let acc = "";
    try {
      const full = await this.opts.models.streamChat({ model: routed, messages, signal: opts.signal }, (delta) => {
        acc += delta;
        void out.apply({ type: "stream.update", text: acc });
      });
      const finalText = full || acc || t("runtime.emptyReply");
      store.addMessage(conv.id, "assistant", finalText);
      await out.apply({ type: "stream.finish", text: note ? `${note}\n\n${finalText}` : finalText });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (opts.signal?.aborted) {
        if (acc) store.addMessage(conv.id, "assistant", acc);
        await out.apply({ type: "stream.finish", text: acc });
        return;
      }
      log.warn("model call failed", { model, status: err.status, message: err.message });
      const msg = acc ? `${acc}\n\n${t("runtime.interrupted", { error: err.message })}` : t("runtime.modelFailed", { model, error: err.message });
      await out.apply({ type: "stream.finish", text: msg });
    } finally {
      await out.apply({ type: "typing", on: false });
    }
  }

  /** 渠道在进入每会话串行队列之前调用：处理审批回复（y 1234 / n 1234）与提问回答。 */
  interceptReply(ev: InboundEvent): { handled: boolean; ack?: string } {
    const text = eventText(ev);
    const convId = `${ev.botId}:${ev.channel}:${ev.conversation.id}`;
    // /status、/help 只读、不碰模型和代理进程：不进会话队列，不会排在一个卡住或正在启动代理的回合后面
    const cmd = text.trim().toLowerCase();
    if (cmd === "/status" || cmd === "/help") {
      const bot = this.opts.store.getBot(ev.botId);
      if (bot) return { handled: true, ack: cmd === "/help" ? help() : this.statusText(bot.id, convId, this.opts.store.getConversation(convId)?.model ?? "", bot.defaultModel) };
    }
    const agent = this.opts.agent;
    if (!agent) return { handled: false };
    return agent.approvals.handleReply(convId, text, `${ev.channel}:${ev.sender.id}`);
  }

  /** /status 的内容：只读本地状态，立即返回 */
  statusText(botId: string, convId: string, convModel: string, botModel: string): string {
    const m = convModel || botModel || this.opts.defaultModel() || t("runtime.autoModel");
    const a = this.opts.agent;
    const mode = a?.available ? t("runtime.modeAgent") : t("runtime.modeChat");
    const pend = a ? a.approvals.pending(convId).map((r) => t(r.kind === "approval" ? "runtime.pendingApproval" : "runtime.pendingQuestion", { code: r.code })) : [];
    const cui = a?.available ? a.computerUse(botId) : undefined;
    const cu = cui
      ? [
          t("runtime.cuLine", { backend: cui.backend === "codex" ? t("runtime.cuCodex") : "Cua Driver", state: t(cui.active ? "runtime.cuOn" : "runtime.cuOff"), reason: cui.reason }),
          ...(cui.notice && cui.enabled ? [cui.notice] : []),
        ]
      : [];
    const host = a?.available ? [a.hostSummary(botId)] : [];
    // Windows：代理执行命令用的 PowerShell；没有 7 时建议安装
    const ps = a?.available ? pwshStatusLine(pwshProbe.snapshot()) : "";
    const turn = a?.turnsInProgress.get(convId);
    const busy = turn ? [t("runtime.busy", { s: Math.round((Date.now() - turn.since) / 1000) })] : [];
    return [
      t("runtime.currentModel", { model: m, suffix: convModel ? t("runtime.convSetting") : "" }),
      t("runtime.runMode", { mode }),
      ...host,
      ...(ps ? [ps] : []),
      ...busy,
      ...cu,
      ...(pend.length ? [t("runtime.pending", { list: pend.join(t("runtime.listSep")) })] : []),
    ].join("\n");
  }

  /** 卡片按钮回调：批准/拒绝/选择选项。 */
  cardAction(botId: string, value: Record<string, string>, by: string): { toast: string; ok: boolean } {
    const agent = this.opts.agent;
    const row = agent && value?.id ? this.opts.store.getApproval(String(value.id)) : undefined;
    if (!agent || !row || row.botId !== botId) return { toast: t("runtime.requestMissing"), ok: false };
    if (row.status !== "pending") return { toast: t("runtime.requestDone", { code: row.code }), ok: false };
    if (value.amb === "approval") {
      const allow = value.decision === "allow";
      return agent.approvals.decide(row.id, allow, by) ? { toast: t(allow ? "runtime.approvedOnce" : "runtime.rejected", { code: row.code }), ok: true } : { toast: t("runtime.expired"), ok: false };
    }
    if (value.amb === "question") {
      const r = agent.approvals.handleReply(row.conversationId, String(value.option ?? ""), by);
      return r.handled ? { toast: t("runtime.submitted"), ok: true } : { toast: t("runtime.submitFailed"), ok: false };
    }
    return { toast: t("runtime.unknownAction"), ok: false };
  }

  /**
   * 代理回合；返回 false 表示宿主不可用且尚无任何输出（调用方回退到纯对话），
   * "starting" 表示代理进程在等待时限内没有启动好（同样回退，启动在后台继续）。
   */
  private async handleAgent(agent: AgentManager, botId: string, convId: string, text: string, model: string, systemPrompt: string, out: ReplySession, images: TurnImage[] = []): Promise<boolean | "starting"> {
    const { store } = this.opts;
    let visible = false;
    const unbind = agent.approvals.bindSink(convId, async (row) => {
      visible = true;
      await out.apply(interactiveOp(row));
    });
    await out.apply({ type: "typing", on: true });
    await out.apply({ type: "stream.start" });
    // 代理进程还没就绪（第一次启动可能要几分钟）：先说清楚在等什么，而不是一直"思考中"。最终回复会替换这段文字
    const host = agent.host(botId);
    let startup: NodeJS.Timeout | undefined;
    if (host.state !== "running") {
      const since = Date.now();
      const show = () => {
        if (host.state === "running") {
          clearInterval(startup);
          return void out.apply({ type: "stream.update", text: t("runtime.agentReady") });
        }
        const s = Math.round((Date.now() - since) / 1000);
        const first = (host.diagnostics() as any).firstStart;
        void out.apply({ type: "stream.update", text: t("runtime.agentStarting", { elapsed: s >= 5 ? t("runtime.agentStartingElapsed", { s }) : "", first: first ? t("runtime.agentStartingFirst") : "" }) });
      };
      show();
      startup = setInterval(show, 5000);
    }
    try {
      if (host.state !== "running") {
        const waitMs = Number(process.env.AMB_AGENT_START_WAIT_MS) || 90_000;
        let timer: NodeJS.Timeout | undefined;
        const ready = await Promise.race([
          host.ensure(model).then(
            () => true,
            () => false,
          ),
          new Promise<boolean>((r) => (timer = setTimeout(() => r(false), waitMs))),
        ]).finally(() => clearTimeout(timer));
        if (!ready && (host.state as string) !== "running") {
          log.warn("agent host not ready, answering with plain chat", { bot: botId, state: host.state, waitedMs: waitMs });
          return host.state === "starting" ? "starting" : false;
        }
      }
      const input = store.getAgentSession(convId) ? text : firstInput(agent, botId, convId, systemPrompt, text);
      const r = await agent.runTurn(botId, {
        conversationId: convId,
        text: input,
        model,
        ...(images.length ? { images } : {}),
        observer: {
          // 工具调用不进入聊天：只用于判断代理已开始工作（不再回退到纯对话），正在输入状态由渠道维持
          onProgress: () => {
            visible = true;
          },
        },
      }).finally(() => clearInterval(startup));
      store.addMessage(convId, "user", text);
      const finalText = r.text.trim() || t("runtime.doneNoText");
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
      await out.apply({ type: "stream.finish", text: t("runtime.agentFailed", { error: err.message.slice(0, 300) }) });
      return true;
    } finally {
      clearInterval(startup);
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
        return help();
      case "/reset":
        this.opts.store.clearMessages(convId);
        this.opts.agent?.resetConversation(convId);
        return t("runtime.resetDone");
      case "/new": {
        const a = this.opts.agent;
        if (!a?.available) return t("runtime.newAgentOnly");
        if (!this.opts.store.getAgentSession(convId)) return t("runtime.alreadyNew");
        try {
          await a.newSegment(botId, convId, await this.resolveModel(convModel, botModel));
        } catch (e) {
          return t("runtime.newFailed", { error: (e as Error).message.slice(0, 200) });
        }
        return t("runtime.newDone");
      }
      case "/status":
        return this.statusText(botId, convId, convModel, botModel);
      case "/model": {
        let list: string[];
        try {
          list = await this.listModels(true);
        } catch (e) {
          return t("runtime.modelListFailed", { error: (e as Error).message });
        }
        if (!arg) {
          const cur = convModel || botModel || this.opts.defaultModel();
          if (!list.length) return t("runtime.modelListEmpty");
          return [t("runtime.modelListHead"), ...list.map((m, i) => `${i + 1}. ${m}${m === cur ? t("runtime.modelCurrent") : ""}`)].join("\n");
        }
        if (arg === "default" || arg === "reset") {
          this.opts.store.setConversationModel(convId, "");
          return t("runtime.modelReset");
        }
        const idx = /^\d+$/.test(arg) ? Number(arg) - 1 : -1;
        const target = idx >= 0 ? list[idx] : list.find((m) => m === arg) ?? list.find((m) => m.endsWith("/" + arg) || m.includes(arg));
        if (!target) return t("runtime.modelNotFound", { name: arg });
        this.opts.store.setConversationModel(convId, target);
        return t("runtime.modelSwitched", { model: target });
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
        { label: t("runtime.allowOnce"), value: { amb: "approval", id: row.id, decision: "allow" }, style: "primary" as const },
        { label: t("runtime.deny"), value: { amb: "approval", id: row.id, decision: "deny" }, style: "danger" as const },
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
