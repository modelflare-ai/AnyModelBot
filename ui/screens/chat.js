// 对话页（参考 Grok Bot 的顶栏、Codex 的对话与输入框）：顶栏左侧头像 + 名称，右侧新对话 / 信息面板；
// 760 阅读列，用户消息是浅灰气泡，机器人回复是整列正文，上方一行"思考中 / 正在回复 / 用时"；底部两行输入框。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, CopyButton, Menu, Popover, Badge, Notice, Skeleton, Spinner, autoGrow } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { Markdown, Linkified } from "../components/markdown.js";
import { ModelPicker, shortModel, sameModel } from "../components/model-picker.js";
import { PwshHint } from "../components/pwsh-hint.js";
import { ActivityLine, currentStep, upsertStep } from "../components/activity.js";
import { TaskChip } from "../components/tasks.js";
import { GuideChecklist, MediaDemo } from "../components/guide.js";
import { api, attachChat, streamChat } from "../lib/api.js";
import { confirmSheet, failed, saved, useStore } from "../lib/store.js";
import { completed, currentStep as guideStep, demo, fill, guide, isActive, isMediaFile, markDone, refreshGuide } from "../lib/guide.js";
import { fmtSep, fmtClock, fmtDur } from "../lib/format.js";
import { perms, confirmPermission } from "../lib/perms.js";
import { prefs } from "../lib/prefs.js";
import { t, useLang } from "../lib/i18n.js";
import { notify, plainSnippet } from "../lib/notify.js";
import { reducedMotion, usePresence } from "../design/motion.js";

// 文案跟着界面语言：渲染时再取（写成函数，不在模块顶层缓存翻译）
const commands = () => [
  ["/model", t("chat.commands.model")],
  ["/new", t("chat.commands.new")],
  ["/reset", t("chat.commands.reset")],
  ["/status", t("chat.commands.status")],
  ["/stop", t("chat.commands.stop")],
  ["/tasks", t("chat.commands.tasks")],
  ["/help", t("chat.commands.help")],
];
// 文件权限（输入框左下角，参考 Codex 的权限胶囊）：机器人设置里的同一项，预设在 lib/perms.js
const NEAR_BOTTOM = 80;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_ENTER = isMac ? "⌘Enter" : "Ctrl+Enter";
let seq = 0;
const uid = () => `l${++seq}`;

const isError = (s) => typeof s === "string" && s.startsWith("⚠️");
const errText = (s) => s.replace(/^⚠️\s*/, "");
// 服务端报错的文字（两种语言都认）
const isAuthError = (s) => /HTTP 401\b|\b401\b.*(key|密钥|unauthor)/i.test(s); // i18n-ignore

// steps：代理回合的活动记录有几步（展开时按 mid 取）
function toItems(messages) {
  return messages.map((m) =>
    m.role === "assistant" && isError(m.content)
      ? { kind: "error", id: "m" + m.id, mid: m.id, text: errText(m.content), at: m.createdAt, steps: m.steps }
      : { kind: "msg", id: "m" + m.id, mid: m.id, role: m.role === "user" ? "user" : "assistant", text: m.content, at: m.createdAt, steps: m.steps },
  );
}

// 进行中的一条消息（服务端的 live 快照）：用户消息 + 到目前为止的回复；turn 标记这些项属于哪条进行中的消息。
// 代理自己醒来的一轮（后台命令结束）没有用户消息；并进前一条处理的消息没有自己的回复
function liveItems(t, cards = []) {
  return [
    ...(t.userText ? [{ kind: "msg", id: "u" + t.id, role: "user", text: t.userText, at: t.startedAt, turn: t.id }] : []),
    ...cards.map((c) => ({ ...c, turn: t.id })),
    ...(t.steered ? [] : [{ kind: "msg", id: "a" + t.id, role: "assistant", text: t.text, at: t.startedAt, live: true, startedAt: t.startedAt, activity: t.steps, turn: t.id }]),
    ...t.files.map((name, i) => ({ kind: "file", id: `f${t.id}-${i}`, name, turn: t.id })),
  ];
}

// —— 审批 / 提问卡片 ——
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function PromptCard({ requestId, fallback }) {
  const [row, setRow] = useState(null);
  const [gone, setGone] = useState(false);
  const [picked, setPicked] = useState({});
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/approvals/${encodeURIComponent(requestId)}`).then((d) => setRow(d.approval)).catch(() => setGone(true)), [requestId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!row || row.status !== "pending") return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [row && row.status]);

  if (gone || (!row && !requestId)) return html`<${Notice}><span class="pre-wrap">${fallback}</span><//>`;
  if (!row) return html`<div class="card"><${Skeleton} w="60%" /><${Skeleton} w="40%" /></div>`;
  const pending = row.status === "pending";
  const decide = async (ok) => {
    setBusy(true);
    try {
      const r = await api(`/approvals/${row.id}/${ok ? "approve" : "deny"}`, { method: "POST", body: {} });
      setRow(r.approval);
    } catch (e) {
      failed(e);
      load();
    }
    setBusy(false);
  };
  if (row.kind === "approval") {
    return html`<div class=${`card${pending ? "" : " done"}`}>
      <div class="meta"><span>${t(row.taskTitle ? "chat.approval.neededTask" : "chat.approval.needed", { title: row.taskTitle, code: html`<span class="num">${row.code}</span>` })}</span>${!pending && html`<${Badge} s=${row.status} />`}</div>
      <div class="q">${row.reason || t("chat.approval.fallbackReason")}</div>
      ${(row.tool || row.detail) && html`<div class="cmd">${row.tool}${row.detail ? "  " + row.detail : ""}</div>`}
      ${pending && html`<div class="actions">
        <button type="button" class="btn primary" disabled=${busy} onClick=${() => decide(true)}>${t("chat.approval.allowOnce")}</button>
        <button type="button" class="btn" disabled=${busy} onClick=${() => decide(false)}>${t("chat.approval.deny")}</button>
      </div>`}
    </div>`;
  }
  const qs = row.questions || [];
  const submit = async (answers) => {
    setBusy(true);
    try {
      const r = await api(`/approvals/${row.id}/answer`, { method: "POST", body: { answers } });
      setRow(r.approval);
    } catch (e) {
      failed(e);
      load();
    }
    setBusy(false);
  };
  const single = qs.length === 1 && (qs[0].options || []).length && !qs[0].multiSelect;
  const choose = (q, label) => {
    if (!pending || busy) return;
    if (single) {
      setPicked({ [q.id]: [label] });
      return submit([{ id: q.id, selected: [label] }]);
    }
    setPicked((p) => {
      const cur = p[q.id] || [];
      const next = q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label];
      return { ...p, [q.id]: next };
    });
  };
  const sendAll = () =>
    submit(qs.map((q, i) => ({ id: q.id, selected: picked[q.id] || [], ...(i === qs.length - 1 && custom.trim() ? { custom: custom.trim() } : {}) })));
  return html`<div class=${`card${pending ? "" : " done"}`}>
    ${row.taskTitle && html`<div class="meta"><span>${t("chat.question.taskAsks", { title: row.taskTitle })}</span></div>`}
    ${qs.map((q) => html`<div class="q-block">
      <div class="q">${q.question}</div>
      ${q.detail && html`<div class="q-detail">${q.detail}</div>`}
      ${(q.options || []).length > 0 && html`<div class="opts" role=${q.multiSelect ? "group" : "radiogroup"}>
        ${q.options.map((o, i) => html`<button type="button" class=${`opt${(picked[q.id] || []).includes(o.label) ? " picked" : ""}`} disabled=${!pending || busy}
          role=${q.multiSelect ? "checkbox" : "radio"} aria-checked=${(picked[q.id] || []).includes(o.label)} onClick=${() => choose(q, o.label)}>
          <span class="letter">${LETTERS[i] || i + 1}</span>
          <span>${o.label}${o.description && html`<span class="desc">${o.description}</span>`}</span>
        </button>`)}
      </div>`}
    </div>`)}
    ${pending && !single && html`<div class="answer">
      <input class="field" placeholder=${qs.some((q) => (q.options || []).length) ? t("chat.question.otherOptional") : t("chat.question.yourAnswer")} value=${custom}
        onInput=${(e) => setCustom(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && !e.isComposing && sendAll()} />
      <button type="button" class="btn primary" disabled=${busy || (!custom.trim() && !Object.values(picked).some((v) => v.length))} onClick=${sendAll}>${t("chat.question.submit")}</button>
    </div>`}
    ${pending && single && html`<div class="answer">
      <input class="field" placeholder=${t("chat.question.orOther")} value=${custom} onInput=${(e) => setCustom(e.target.value)}
        onKeyDown=${(e) => e.key === "Enter" && !e.isComposing && custom.trim() && submit([{ id: qs[0].id, selected: [], custom: custom.trim() }])} />
    </div>`}
    ${!pending && html`<div class="meta"><${Badge} s=${row.status} /></div>`}
  </div>`;
}

function FileCard({ name }) {
  return html`<div class="file-card">
    <${Icon} name="file" size="xl" />
    <div class="grow">
      <div class="fname">${name}</div>
      <div class="fsub">${t("chat.file.delivered")}</div>
    </div>
  </div>`;
}

/**
 * 回复上方的工作状态：没出字时"思考中 · 正在做的那一步"，出字后"正在回复 N 秒"，结束后"用时 N 秒"（短于 3 秒且没有步骤时不显示）。
 * 代理回合有步骤时这一行可以展开成处理过程（默认折叠）；历史消息只知道步数，展开时用 load 取。
 */
function WorkLine({ live, stopping, text, startedAt, workedMs, steps, count, load }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const ms = live ? Date.now() - startedAt : workedMs;
  if (!live && !(ms >= 3000) && !steps?.length && !count) return null;
  const cur = live && !text ? currentStep(steps) : "";
  // 按了停止：代理要重启进程，可能要几秒，先说清楚在停
  const label = live
    ? stopping
      ? t("chat.work.stopping", { extra: ms >= 3000 ? t("chat.work.processedFor", { d: fmtDur(ms) }) : "" })
      : `${text ? t("chat.work.replying", { d: fmtDur(ms) }) : ms >= 3000 ? t("chat.work.thinkingFor", { d: fmtDur(ms) }) : t("chat.work.thinking")}${cur ? ` · ${cur}` : ""}`
    : ms >= 3000 ? t("chat.work.done", { d: fmtDur(ms) }) : t("chat.work.process");
  // 换阶段（思考 → 回复 → 用时）时文字淡入：key 变才重播，秒数跳动不重播
  const phase = !live ? "done" : stopping ? "stop" : text ? "reply" : "think";
  return html`<${ActivityLine} label=${label} phase=${phase} live=${live} steps=${steps} count=${count} load=${load} />`;
}

/** 消息下方的操作：复制 + 时刻（悬停时出现，最后一条回复常显） */
function MsgActions({ text, at }) {
  return html`<div class="msg-actions"><${CopyButton} text=${text} label=${t("chat.copyMessage")} />${at && html`<span class="when num">${fmtClock(at)}</span>`}</div>`;
}

function ErrorNotice({ text, onRetry, onFixKey }) {
  const auth = isAuthError(text);
  return html`<${Notice} tone="red" action=${html`${auth && onFixKey && html`<button type="button" class="btn" onClick=${onFixKey}>${t("chat.error.fixKey")}</button>`}
    ${onRetry && html`<button type="button" class="btn" onClick=${onRetry}>${t("common.retry")}</button>`}`}>${auth ? t("chat.error.authInvalid") : text}<//>`;
}

export function ChatScreen({ bot, models, modelsError, reloadModels, defaultModel, infoOpen, onToggleInfo, onWorking, onOpenSettings, onOpenBotSettings, onBotUpdated, pending = 0, serverBusy = false }) {
  const [items, setItems] = useState(null);
  const [convModel, setConvModel] = useState("");
  const [text, setText] = useState("");
  // generating：正在跟着一条消息（本页发出的，或切回 / 刷新后接上的）；stopping：按了停止，等服务端收尾
  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [scrolled, setScrolled] = useState(false); // 内容滚到顶栏底下了：顶栏出现细线
  const [unseen, setUnseen] = useState(false);
  const [menu, setMenu] = useState(null); // "plus" | "perm" | "model" | null
  const [perm, setPerm] = useState("");
  const [slashSel, setSlashSel] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [cue, setCue] = useState(null); // 头像的一次性反应（出错）；完成时头像自己会播
  const lang = useLang();
  const scroller = useRef(null);
  const stick = useRef(true);
  const ta = useRef(null);
  const plusRef = useRef(null);
  const modelRef = useRef(null);
  const permRef = useRef(null);
  // 正在跟的那条消息的事件流 { ac, local }：同一时刻只跟一条，切走时断开（消息在服务端照常处理）
  const following = useRef(null);
  const mounted = useRef(true);
  const lastUser = useRef("");
  const convId = useRef("");
  const attachRef = useRef(null);
  // 处理中又发的消息（并进正在进行的回复）结束后重新读一次历史：存下的顺序是两条用户消息、一条回复
  const reloadAfter = useRef(false);
  // 这个会话的后台任务（胶囊挂在请求它的那条消息的回复下面）；任务结束时结果写进了历史，重新读一次
  const [tasks, setTasks] = useState([]);
  const taskGroups = useRef({});
  const sentOnce = useRef(false); // 发过消息：之后发送钮换回箭头时才播"升回来"，打开页面时不动
  // 上手清单：完成一步时头像开心一下；引导卡片「填入」的句子进输入框（只认这个页面挂载之后的请求）
  const g = useStore(guide);
  const justDone = useStore(completed);
  const fillReq = useStore(fill);
  const demoReq = useStore(demo);
  const { sendKey } = useStore(prefs);
  const born = useRef(Date.now());
  // 生图的预置演示：只在本地对话流里放一遍（你的那句话 + 演示卡片），不发给机器人，刷新后就没了
  useEffect(() => {
    if (!demoReq || demoReq.at < born.current) return;
    stick.current = true;
    setItems((l) => [...(l || []), { kind: "msg", id: uid(), role: "user", text: demoReq.text, at: Date.now(), enter: true }, { kind: "media-demo", id: uid(), text: demoReq.text, enter: true }]);
  }, [demoReq && demoReq.at]);
  useEffect(() => {
    if (justDone && justDone.at > born.current) setCue({ kind: "done", at: justDone.at });
  }, [justDone && justDone.at]);
  useEffect(() => {
    if (!fillReq || fillReq.at < born.current) return;
    setText(fillReq.text);
    setSlashOff(true);
    requestAnimationFrame(() => {
      ta.current?.focus();
      autoGrow(ta.current);
    });
  }, [fillReq && fillReq.at]);

  // ended：刚接着的那条消息结束了 { since, ms }，存下的回复照样显示"用时"（和一直停在这页时一样）
  const load = useCallback(async (ended) => {
    try {
      const d = await api(`/bots/${encodeURIComponent(bot.id)}/chat`);
      if (!mounted.current) return;
      convId.current = d.conversationId || "";
      setConvModel(d.model || "");
      const list = toItems(d.messages || []);
      const reply = ended && list.findLast((x) => x.role !== "user");
      if (reply && reply.at >= ended.since) reply.workedMs = ended.ms;
      const cards = (d.pending || []).map((a) => ({ kind: "prompt", id: "p" + a.id, requestId: a.id, prompt: "" }));
      // 进行中的消息（切走前、刷新前或别的窗口发的）：显示用户消息和到目前为止的回复，再接上它继续更新。
      // 已经在跟一条了（本页刚发的）就保留本页的那几项，不重复接
      const turns = following.current ? [] : d.live || [];
      turns.forEach((t, i) => list.push(...liveItems(t, i === 0 ? cards : [])));
      if (!turns.length && !following.current) list.push(...cards);
      setItems((prev) => (following.current ? [...list, ...(prev || []).filter((x) => x.turn)] : list));
      setLoadErr("");
      if (turns.length) attachRef.current(turns[0]);
    } catch (e) {
      if (mounted.current) {
        setItems((v) => v || []);
        setLoadErr(e.message);
      }
    }
  }, [bot.id]);

  useEffect(() => {
    mounted.current = true;
    load();
    requestAnimationFrame(() => ta.current?.focus());
    return () => {
      mounted.current = false;
      following.current?.ac.abort();
    };
  }, [load]);
  useEffect(() => {
    api(`/bots/${encodeURIComponent(bot.id)}/settings`).then((d) => mounted.current && setPerm(d.settings.permission)).catch(() => {});
  }, [bot.id]);
  useEffect(() => onWorking(bot.id, generating), [generating]);
  // 服务端开始处理这个机器人的消息，而本页没在跟（代理自己醒来的一轮、别的窗口发的）：读一次，接上进行中的那条
  useEffect(() => {
    if (serverBusy && !following.current && mounted.current) load();
  }, [serverBusy]);
  useEffect(() => () => onWorking(bot.id, false), []);

  const loadTasks = useCallback(
    () =>
      api(`/tasks?conversation=${encodeURIComponent(`${bot.id}:web:console`)}&limit=20`)
        .then((d) => {
          if (!mounted.current) return;
          const list = d.tasks || [];
          const finished = list.some((t) => taskGroups.current[t.id] === "working" && t.stage.group !== "working");
          taskGroups.current = Object.fromEntries(list.map((t) => [t.id, t.stage.group]));
          setTasks(list);
          if (finished && !following.current) load();
        })
        .catch(() => {}),
    [bot.id, load],
  );
  const tasksWorking = tasks.some((t) => t.stage.group === "working");
  useEffect(() => {
    taskGroups.current = {};
    setTasks([]);
    loadTasks();
  }, [bot.id]);
  // 回复结束（可能刚开了一个任务）就看一次；有任务在进行时 3 秒一次，否则 15 秒
  useEffect(() => {
    if (!generating) loadTasks();
  }, [generating]);
  useEffect(() => {
    const timer = setInterval(loadTasks, tasksWorking ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [loadTasks, tasksWorking]);

  // 只有用户本来就在底部附近时才跟随新内容；否则亮出"回到底部"
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [items]);
  const onScroll = () => {
    const el = scroller.current;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    stick.current = near;
    setAtBottom(near);
    setScrolled(el.scrollTop > 2);
    if (near) setUnseen(false);
  };
  const toBottom = () => {
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    setUnseen(false);
  };

  const patchLive = (id, fn) => mounted.current && setItems((l) => (l || []).map((it) => (it.id === id ? fn(it) : it)));

  /**
   * 跟着一条消息走到结束：本页发出的（chat/stream）和接上的（chat/live）事件一样。返回最后的回复文字；
   * 切走了（组件卸载、事件流被断开）返回 null。liveId 是回复那一项，turn 是这条消息的几项共用的标记。
   */
  const follow = async (liveId, turn, open) => {
    const f = { ac: new AbortController(), local: false, turn };
    following.current = f;
    setGenerating(true);
    let finalText = "";
    const card = (d) =>
      mounted.current &&
      setItems((l) => {
        if (d.requestId && l.some((x) => x.kind === "prompt" && x.requestId === d.requestId)) return l;
        const i = l.findIndex((x) => x.id === liveId);
        const c = { kind: "prompt", id: uid(), requestId: d.requestId, prompt: d.prompt, turn, enter: true };
        return i < 0 ? [...l, c] : [...l.slice(0, i), c, ...l.slice(i)];
      });
    try {
      await open(
        {
          snapshot: (d) => {
            finalText = d.text;
            patchLive(liveId, (it) => ({ ...it, text: d.text, activity: d.steps, startedAt: d.startedAt }));
            d.prompts.forEach(card);
            if (d.stopping && mounted.current) setStopping(true);
          },
          text: (d) => {
            finalText = d.text;
            patchLive(liveId, (it) => ({ ...it, text: d.text }));
          },
          activity: (d) => patchLive(liveId, (it) => ({ ...it, activity: upsertStep(it.activity, d) })),
          prompt: (d) => {
            notify(bot.name, t("notify.prompt"), `amb-prompt-${bot.id}`);
            card(d);
          },
          file: (d) => {
            markDone(isMediaFile(d.name) ? "media" : "hands");
            if (mounted.current) setItems((l) => [...l, { kind: "file", id: uid(), name: d.name, turn, enter: true }]);
          },
          stopping: () => mounted.current && setStopping(true),
          error: (d) => {
            finalText = "⚠️ " + (d.message || t("common.error"));
          },
        },
        f.ac.signal,
      );
    } catch (e) {
      if (e.name !== "AbortError") finalText = "⚠️ " + e.message;
    }
    if (following.current === f) following.current = null;
    if (!mounted.current || (f.ac.signal.aborted && !f.local)) return null;
    setGenerating(false);
    setStopping(false);
    return finalText;
  };

  // 接上进行中的消息；结束后重新读历史（存下的用户消息和回复替换掉这几项，不重复）
  const attach = async (t) => {
    if (following.current) return;
    stick.current = true;
    const finalText = await follow("a" + t.id, t.id, (h, signal) => attachChat(bot.id, t.id, h, signal));
    reloadAfter.current = false;
    if (finalText === null) return;
    if (isError(finalText)) {
      setCue({ kind: "error", at: Date.now() });
      failed(errText(finalText));
    }
    load({ since: t.startedAt, ms: Date.now() - t.startedAt });
  };
  attachRef.current = attach;

  /**
   * 回复还在进行时又发一条（不是命令）：交给服务端并进正在进行的处理，模型下一步就看到它，回复在那一条里一起给。
   * 用户消息先插在进行中的回复上面；服务端没能并入（那一轮刚好结束）时它按普通消息处理，结束后重新读历史。
   */
  const steer = async (msg) => {
    setText("");
    requestAnimationFrame(() => autoGrow(ta.current));
    lastUser.current = msg;
    stick.current = true;
    const turn = following.current?.turn;
    setItems((l) => {
      const list = l || [];
      const user = { kind: "msg", id: uid(), role: "user", text: msg, at: Date.now(), enter: true, turn };
      const i = list.findIndex((x) => x.live && x.turn === turn);
      return i < 0 ? [...list, user] : [...list.slice(0, i), user, ...list.slice(i)];
    });
    reloadAfter.current = true;
    try {
      await streamChat(bot.id, msg, {}, new AbortController().signal);
    } catch (e) {
      failed(e);
    }
    if (mounted.current && !following.current && reloadAfter.current) {
      reloadAfter.current = false;
      load();
    }
  };

  const send = async (raw) => {
    const msg = (raw ?? text).trim();
    if (msg && (generating || following.current) && !msg.startsWith("/") && raw === undefined) return steer(msg);
    if (!msg || generating || following.current) return;
    if (raw === undefined) {
      setText("");
      requestAnimationFrame(() => autoGrow(ta.current));
    }
    if (!msg.startsWith("/")) lastUser.current = msg;
    sentOnce.current = true;
    stick.current = true;
    const liveId = uid();
    const isReset = /^\/reset\b/i.test(msg);
    setItems((l) => [...(l || []), { kind: "msg", id: uid(), role: "user", text: msg, at: Date.now(), enter: true, turn: liveId }, { kind: "msg", id: liveId, role: "assistant", text: "", at: Date.now(), live: true, startedAt: Date.now(), turn: liveId }]);
    const finalText = await follow(liveId, liveId, (h, signal) => streamChat(bot.id, msg, h, signal));
    if (finalText === null) return;
    // 窗口不在前台时通知（设置 › 常规 › 回复完成时通知）
    if (finalText) notify(bot.name, isError(finalText) ? t("notify.replyError", { text: plainSnippet(errText(finalText)) }) : plainSnippet(finalText) || t("notify.replyDone"), `amb-reply-${bot.id}`);
    // 上手清单：普通消息有了回复就算打过招呼；/model 切换成功算换过模型；其余能从数据里看出来的（记忆、渠道）问一次后端
    if (finalText && !isError(finalText)) {
      if (!msg.startsWith("/")) markDone("hello");
      else if (/^\/model\s+\S/i.test(msg)) markDone("model");
      const gs = guide.get();
      if (isActive(gs) && guideStep(gs)) refreshGuide();
    }
    if (isError(finalText)) setCue({ kind: "error", at: Date.now() });
    if (reloadAfter.current) {
      reloadAfter.current = false;
      return load();
    }
    setItems((l) => {
      const out = [];
      for (const item of l || []) {
        if (item.turn !== liveId) {
          out.push(item);
          continue;
        }
        const { turn, ...it } = item; // 结束了：不再属于进行中的消息
        if (it.id !== liveId) out.push(it);
        else if (isError(finalText)) out.push({ kind: "error", id: liveId, text: errText(finalText), retry: msg.startsWith("/") ? undefined : msg, at: it.at, activity: it.activity, workedMs: Date.now() - it.startedAt, enter: true });
        else if (finalText || it.activity?.length) out.push({ ...it, text: finalText, live: false, workedMs: Date.now() - it.startedAt });
      }
      return isReset && !isError(finalText) ? out.filter((x) => x.id === liveId) : out;
    });
    if (/^\/model\s+\S/i.test(msg)) load();
  };

  /**
   * 停止：交给服务端（/conversations/:id/stop），纯对话、排队中、等代理启动、代理回合、接上的消息都是这一条路；
   * 事件流照常收到"已中止"再结束。代理要重启进程，可能要几秒，这期间显示"正在停止…"。
   */
  const stop = async () => {
    if (stopping || !following.current) return;
    setStopping(true);
    try {
      const r = await api(`/conversations/${encodeURIComponent(convId.current || `${bot.id}:web:console`)}/stop`, { method: "POST", body: {} });
      // 服务端已经没有在处理的了（刚好结束）：事件流马上会收尾；万一没有，几秒后在本页收尾
      if (!r.stopped) {
        const f = following.current;
        setTimeout(() => {
          if (f && following.current === f) {
            f.local = true;
            f.ac.abort();
          }
        }, 3000);
      }
    } catch (e) {
      if (mounted.current) setStopping(false);
      failed(t("chat.error.stopFailed", { error: e.message }));
    }
  };
  const loadActivity = (mid) => () => api(`/conversations/${encodeURIComponent(convId.current)}/messages/${mid}/activity`).then((d) => d.steps);

  // —— 斜杠命令菜单 ——
  const slashQuery = /^\/\S*$/.test(text) && !slashOff ? text.toLowerCase() : null;
  const slashHits = slashQuery !== null ? commands().filter(([c]) => c.startsWith(slashQuery)) : [];
  const slashOpen = slashHits.length > 0 && !(slashHits.length === 1 && slashHits[0][0] === text);
  const completeSlash = (cmd) => {
    setText(cmd === "/model" ? "/model " : cmd);
    setSlashOff(cmd === "/model");
    ta.current?.focus();
  };

  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        return setSlashSel((s) => (s + 1) % slashHits.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        return setSlashSel((s) => (s - 1 + slashHits.length) % slashHits.length);
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        return completeSlash(slashHits[Math.min(slashSel, slashHits.length - 1)][0]);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        return setSlashOff(true);
      }
    }
    // 发送键（设置 › 常规 › 发送消息）：Enter 发送、Shift+Enter 换行；或 ⌘/Ctrl+Enter 发送、Enter 换行
    if (e.key === "Enter" && !e.shiftKey && (sendKey !== "mod" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && generating) {
      e.preventDefault();
      stop();
    }
  };

  // —— 文件权限 ——
  const pickPerm = async (p) => {
    if (!(await confirmPermission(p))) return;
    const prev = perm;
    setPerm(p);
    try {
      const d = await api(`/bots/${encodeURIComponent(bot.id)}/settings`, { method: "PUT", body: { permission: p } });
      setPerm(d.settings.permission);
      saved();
    } catch (e) {
      setPerm(prev);
      failed(e);
    }
  };

  // —— 模型 ——
  const effective = convModel || bot.defaultModel || defaultModel || (models && models[0]) || "";
  const pickModel = async (m) => {
    try {
      await api(`/bots/${encodeURIComponent(bot.id)}/chat/model`, { method: "PUT", body: { model: m } });
      setConvModel(m);
      saved();
      markDone("model");
    } catch (e) {
      failed(e);
    }
  };
  const setBotDefault = async () => {
    try {
      const r = await api(`/bots/${encodeURIComponent(bot.id)}`, { method: "PUT", body: { defaultModel: effective } });
      await api(`/bots/${encodeURIComponent(bot.id)}/chat/model`, { method: "PUT", body: { model: "" } });
      setConvModel("");
      onBotUpdated(r.bot);
      saved();
      markDone("model");
    } catch (e) {
      failed(e);
    }
  };
  const plusItems = [
    { label: t("chat.menu.switchModel"), onSelect: () => requestAnimationFrame(() => setMenu("model")) },
    { sep: true },
    { label: t("chat.menu.newConv"), note: "/new", onSelect: () => send("/new") },
    {
      label: t("chat.menu.reset"),
      note: "/reset",
      onSelect: async () => {
        if (await confirmSheet({ title: t("chat.reset.title"), body: t("chat.reset.body", { name: bot.name }), confirmLabel: t("chat.reset.confirm"), danger: true })) send("/reset");
      },
    },
    { label: t("chat.menu.status"), note: "/status", onSelect: () => send("/status") },
    { label: t("chat.menu.allCommands"), note: "/help", onSelect: () => send("/help") },
  ];

  // —— 渲染 ——
  /** 任务胶囊挂在哪一项后面：请求那条用户消息之后的第一条回复；那一轮还在进行时挂在进行中的回复后面 */
  const chipsAfter = useMemo(() => {
    const map = new Map();
    const list = items || [];
    for (const t of [...tasks].sort((a, b) => a.createdAt - b.createdAt)) {
      const i = list.findIndex((x) => x.mid === t.originMessageId);
      let at;
      if (i >= 0) at = list.find((x, k) => k > i && !(x.kind === "msg" && x.role === "user")) ?? list[i];
      else if (list.some((x) => x.live)) at = list.findLast((x) => x.turn);
      if (!at) continue;
      map.set(at.id, [...(map.get(at.id) || []), t]);
    }
    return map;
  }, [items, tasks]);

  const chips = (it) => (chipsAfter.get(it.id) || []).map((t) => html`<${TaskChip} key=${t.id} task=${t} onChanged=${loadTasks} />`);
  const rows = useMemo(() => {
    const out = [];
    let prev = null;
    const lastAi = (items || []).findLast((x) => x.kind === "msg" && x.role === "assistant" && !x.live)?.id;
    for (const it of items || []) {
      if (it.at && (!prev?.at || new Date(it.at).toDateString() !== new Date(prev.at).toDateString() || it.at - prev.at > 15 * 60_000)) {
        out.push(html`<div class="time-sep" key=${"t" + it.id}>${fmtSep(it.at)}</div>`);
        prev = null;
      }
      const role = it.kind === "msg" ? it.role : "assistant";
      const cont = prev && (prev.kind === "msg" ? prev.role : "assistant") === role;
      const cls = `msg-row ${role}${cont ? " cont" : ""}${it.enter ? " enter" : ""}${it.live ? " live" : ""}`;
      if (it.kind === "msg") {
        out.push(html`<div class=${`${cls}${it.id === lastAi ? " last" : ""}`} key=${it.id}>
          ${it.role === "user"
            ? html`<div class="msg"><${Linkified} text=${it.text} /></div><${MsgActions} text=${it.text} at=${it.at} />`
            : html`${(it.live || it.workedMs || it.steps) && html`<${WorkLine} live=${it.live} stopping=${it.live && stopping} text=${it.text} startedAt=${it.startedAt} workedMs=${it.workedMs}
                steps=${it.activity} count=${it.steps} load=${it.mid ? loadActivity(it.mid) : undefined} />`}
              ${it.text && html`<div class="msg"><${Markdown} text=${it.text} /></div>`}
              ${chips(it)}
              ${!it.live && html`<${MsgActions} text=${it.text} at=${it.at} />`}`}
        </div>`);
      } else if (it.kind === "prompt") {
        out.push(html`<div class=${cls} key=${it.id}><${PromptCard} requestId=${it.requestId} fallback=${it.prompt} /></div>`);
      } else if (it.kind === "file") {
        out.push(html`<div class=${cls} key=${it.id}><${FileCard} name=${it.name} /></div>`);
      } else if (it.kind === "media-demo") {
        out.push(html`<div class=${cls} key=${it.id}><${MediaDemo} prompt=${it.text} /></div>`);
      } else if (it.kind === "error") {
        out.push(html`<div class=${cls} key=${it.id}>
          ${(it.activity?.length || it.steps) && html`<${WorkLine} workedMs=${it.workedMs} steps=${it.activity} count=${it.steps} load=${it.mid ? loadActivity(it.mid) : undefined} />`}
          <${ErrorNotice} text=${it.text} onRetry=${it.retry ? () => send(it.retry) : undefined} onFixKey=${() => onOpenSettings("modelflare", "connection")} />
        </div>`);
      }
      // 回复下面直接挂在同一行里（在复制按钮之前）；挂在卡片、文件、出错提示后面时自成一行
      if (!(it.kind === "msg" && it.role === "assistant") && chipsAfter.has(it.id)) out.push(html`<div class="msg-row assistant cont" key=${"task-" + it.id}>${chips(it)}</div>`);
      prev = it;
    }
    return out;
  }, [items, generating, stopping, chipsAfter, lang]);

  const empty = items && items.length === 0;
  const showGuide = isActive(g) && !g.seen.includes("intro") && !!guideStep(g);
  // 头像跟着对话走：等你批准 > 还没出字（思考）/ 出字了（回复）> 你在输入（在听）
  const replying = generating && (items || []).some((x) => x.live && x.text);
  const face = pending > 0 ? "waiting" : generating ? (replying ? "replying" : "thinking") : text.trim() ? "listening" : "idle";
  const toBottomBtn = usePresence(!atBottom);
  // 点发送 / 停止不抢输入框的焦点：光标留在原处，接着就能打下一句（键盘 Tab 过去照样能按）
  const keepFocus = (e) => e.preventDefault();
  const permMap = perms();
  return html`<section class=${`chat${scrolled ? " scrolled" : ""}`} data-screen="chat" aria-label=${t("chat.aria", { name: bot.name })}>
    <header class="chat-head">
      <button type="button" class="head-bot bot-hover" data-guide="info" aria-pressed=${infoOpen} title=${t("chat.infoPanel")} onClick=${onToggleInfo}>
        <${BotAvatar} bot=${bot} size=${22} state=${face} cue=${cue} />
        <span class="name">${bot.name}</span>
      </button>
      <span class="grow"></span>
      <${IconButton} icon="compose" iconSize="md" label=${t("chat.newConvCmd")} disabled=${generating} onClick=${() => send("/new")} />
      <${IconButton} icon="panel" iconSize="md" label=${t("chat.infoPanel")} on=${infoOpen} aria-pressed=${infoOpen} onClick=${onToggleInfo} />
    </header>
    <div class="chat-scroll" ref=${scroller} onScroll=${onScroll}>
      <div class=${`chat-col${items ? " ready" : ""}`} role="log" aria-live="polite" aria-busy=${generating}>
        ${loadErr && html`<${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${() => load()}>${t("common.retry")}</button>`}>${t("chat.error.loadHistory", { error: loadErr })}<//>`}
        ${items === null && html`<div class="chat-skel"><${Skeleton} w="40%" /><${Skeleton} w="28%" /></div>`}
        ${empty && html`<div class=${`chat-empty${showGuide ? " with-guide" : ""}`}>
          <${BotAvatar} bot=${bot} size=${88} state=${face} cue=${cue} lively pokeable greet />
          ${showGuide
            ? html`<h2>${t("chat.empty.guideTitle", { name: bot.name })}</h2>
              <p>${t("chat.empty.guideBody")}</p>
              <${GuideChecklist} bot=${bot} onSend=${(x) => send(x)} />`
            : html`<h2>${t("chat.empty.title", { name: bot.name })}</h2>
              <p>${t("chat.empty.body")}</p>
              <div class="chips">
                <button type="button" class="chip" onClick=${() => send(t("chat.empty.sample"))}>${t("chat.empty.sample")}</button>
                <button type="button" class="chip" onClick=${() => send("/help")}>${t("chat.empty.helpChip")}</button>
              </div>`}
          <${PwshHint} />
        </div>`}
        ${rows}
      </div>
    </div>
    ${toBottomBtn.mounted && html`<button type="button" class=${`to-bottom${toBottomBtn.leaving ? " leaving" : ""}`} aria-label=${t("chat.toBottom")} onClick=${toBottom}><${Icon} name="down" size="md" />${unseen && html`<span class="new"></span>`}</button>`}
    <div class="composer-dock">
      <div class="composer" data-guide="composer">
        <textarea ref=${ta} rows="1" placeholder=${t("chat.composer.placeholder", { name: bot.name })} aria-label=${t("chat.composer.label")} value=${text}
          onInput=${(e) => { setText(e.target.value); setSlashOff(false); setSlashSel(0); autoGrow(e.target); }}
          onKeyDown=${onKey} />
        <div class="composer-bar">
        <button type="button" class="plus" ref=${plusRef} aria-label=${t("chat.menu.more")} aria-haspopup="menu" aria-expanded=${menu === "plus"} onClick=${() => setMenu(menu === "plus" ? null : "plus")}><${Icon} name="plus" size="md" /></button>
        ${permMap[perm] && html`<button type="button" class=${`model-chip perm ${perm}`} ref=${permRef} title=${t("chat.perm.title", { note: permMap[perm].note })} aria-haspopup="menu" aria-expanded=${menu === "perm"}
          onClick=${() => setMenu(menu === "perm" ? null : "perm")}>
          <${Icon} name=${permMap[perm].icon} size="sm" class="lead" /><span class="v">${permMap[perm].label}</span><${Icon} name="chevDown" />
        </button>`}
        <span class="grow"></span>
        <button type="button" class="model-chip" ref=${modelRef} data-guide="model" title=${effective ? t("chat.composer.currentModel", { model: effective }) : t("chat.composer.pickModel")} aria-haspopup="listbox" aria-expanded=${menu === "model"}
          onClick=${() => setMenu(menu === "model" ? null : "model")}>
          <span class="v">${effective ? shortModel(effective) : t("chat.composer.pickModel")}</span><${Icon} name="chevDown" />
        </button>
        ${generating && text.trim() && !text.trim().startsWith("/") && !stopping
          ? html`<button type="button" class="send" aria-label=${t("chat.composer.steer")} title=${t("chat.composer.steerTitle", { key: sendKey === "mod" ? MOD_ENTER : "Enter" })} onMouseDown=${keepFocus} onClick=${() => send()}><${Icon} name="up" size="md" strong /></button>`
          : null}
        ${generating
          ? html`<button type="button" class="send stop" aria-label=${stopping ? t("chat.composer.stopping") : t("chat.composer.stop")} title=${stopping ? t("chat.composer.stopping") : t("chat.composer.stopTitle")}
              disabled=${stopping} aria-busy=${stopping} onMouseDown=${keepFocus} onClick=${stop}>${stopping ? html`<${Spinner} />` : html`<${Icon} name="stop" size="md" />`}</button>`
          : html`<button type="button" class=${`send${sentOnce.current ? " back" : ""}`} aria-label=${t("chat.composer.send")} title=${t("chat.composer.sendTitle", { key: sendKey === "mod" ? MOD_ENTER : "Enter" })} disabled=${!text.trim()} onMouseDown=${keepFocus} onClick=${() => send()}><${Icon} name="up" size="md" strong /></button>`}
        </div>
      </div>
    </div>
    ${slashOpen && ta.current && html`<${Popover} anchor=${ta.current} prefer="up" width=${320} keepFocus label=${t("chat.commandsLabel")} onClose=${() => setSlashOff(true)}>
      <ul role="listbox" aria-label=${t("chat.commandsLabel")}>
        ${slashHits.map(([c, d], i) => html`<li role="option" aria-selected=${i === slashSel} class=${`explained${i === Math.min(slashSel, slashHits.length - 1) ? " sel" : ""}`}
          onPointerDown=${(e) => e.preventDefault()} onPointerMove=${() => setSlashSel(i)} onClick=${() => completeSlash(c)}>
          <span class="v">${c}</span><span class="n">${d}</span>
        </li>`)}
      </ul>
    <//>`}
    ${menu === "plus" && html`<${Menu} anchor=${plusRef.current} prefer="up" width=${240} label=${t("chat.menu.more")} onClose=${() => setMenu(null)} items=${plusItems} />`}
    ${menu === "perm" && html`<${Menu} anchor=${permRef.current} prefer="up" width=${280} label=${t("chat.perm.menu")} onClose=${() => setMenu(null)}
      items=${[
        { group: t("chat.perm.menu") },
        ...Object.entries(permMap).map(([k, p]) => ({ label: p.label, note: p.note, icon: p.icon, danger: p.danger, cur: k === perm, onSelect: () => k !== perm && pickPerm(k) })),
        { sep: true },
        { label: t("chat.perm.more"), onSelect: () => onOpenBotSettings?.(bot.id, "permission") },
      ]} />`}
    ${menu === "model" && html`<${ModelPicker} anchor=${modelRef.current} prefer="up" align="right" models=${models} error=${modelsError} onRetry=${reloadModels}
      current=${convModel || bot.defaultModel || defaultModel} onPick=${pickModel} onClose=${() => setMenu(null)}
      reset=${{ label: t("chat.model.followBot"), note: shortModel(bot.defaultModel || defaultModel) || t("common.auto"), onSelect: () => pickModel("") }}
      foot=${{ label: t("chat.model.setDefault"), disabled: !effective || sameModel(effective, bot.defaultModel), onClick: setBotDefault }} />`}
  </section>`;
}
