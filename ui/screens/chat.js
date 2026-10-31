// 对话页（参考 Grok Bot 的顶栏、Codex 的对话与输入框）：顶栏左侧头像 + 名称，右侧新对话 / 信息面板；
// 760 阅读列，用户消息是浅灰气泡，机器人回复是整列正文，上方一行"思考中 / 正在回复 / 用时"；底部两行输入框。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, CopyButton, Menu, Popover, Badge, Notice, Skeleton, autoGrow } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { Markdown, Linkified } from "../components/markdown.js";
import { ModelPicker, shortModel, sameModel } from "../components/model-picker.js";
import { PwshHint } from "../components/pwsh-hint.js";
import { GuideChecklist, MediaDemo } from "../components/guide.js";
import { api, streamChat } from "../lib/api.js";
import { confirmSheet, failed, saved, useStore } from "../lib/store.js";
import { completed, currentStep, demo, fill, guide, isActive, isMediaFile, markDone, refreshGuide } from "../lib/guide.js";
import { fmtSep, fmtClock, fmtDur } from "../lib/format.js";
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
  ["/help", t("chat.commands.help")],
];
// 文件权限（输入框左下角，参考 Codex 的权限胶囊）：机器人设置里的同一项
const perms = () => ({
  workspace: { label: t("chat.perm.workspace"), icon: "shield", note: t("chat.perm.workspaceNote") },
  readonly: { label: t("chat.perm.readonly"), icon: "lock", note: t("chat.perm.readonlyNote") },
});
const NEAR_BOTTOM = 80;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_ENTER = isMac ? "⌘Enter" : "Ctrl+Enter";
let seq = 0;
const uid = () => `l${++seq}`;

const isError = (s) => typeof s === "string" && s.startsWith("⚠️");
const errText = (s) => s.replace(/^⚠️\s*/, "");
// 服务端报错的文字（两种语言都认）
const isAuthError = (s) => /HTTP 401\b|\b401\b.*(key|密钥|unauthor)/i.test(s); // i18n-ignore

function toItems(messages) {
  return messages.map((m) =>
    m.role === "assistant" && isError(m.content)
      ? { kind: "error", id: "m" + m.id, text: errText(m.content), at: m.createdAt }
      : { kind: "msg", id: "m" + m.id, role: m.role === "user" ? "user" : "assistant", text: m.content, at: m.createdAt },
  );
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
      <div class="meta"><span>${t("chat.approval.needed", { code: html`<span class="num">${row.code}</span>` })}</span>${!pending && html`<${Badge} s=${row.status} />`}</div>
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

/** 回复上方的工作状态：没出字时"思考中"，出字后"正在回复 N 秒"，结束后"用时 N 秒"。
 *  短于 3 秒的不显示"用时"：这一行原样收起（.work.gone，CSS 里平滑折叠），正文不会突然跳上去 */
function WorkLine({ live, text, startedAt, workedMs }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const ms = live ? Date.now() - startedAt : workedMs;
  const gone = !live && !(ms >= 3000);
  const done = !live && !gone;
  // 换阶段时文字淡入（key 变），秒数跳动不重播；收起的那一行保持原来的字，不再换
  const phase = done ? "done" : text ? "reply" : "think";
  const label = done ? t("chat.work.done", { d: fmtDur(ms) }) : text ? t("chat.work.replying", { d: fmtDur(ms) }) : ms >= 3000 ? t("chat.work.thinkingFor", { d: fmtDur(ms) }) : t("chat.work.thinking");
  return html`<div class=${`work${gone ? " gone" : ""}`} aria-hidden=${gone ? "true" : undefined}><div class="work-in">
    <div class=${`work-line${live ? " live" : ""}`} aria-live="off"><span key=${phase} class=${`wl${live ? " shimmer" : ""}`}>${label}</span></div>
  </div></div>`;
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

export function ChatScreen({ bot, models, modelsError, reloadModels, defaultModel, infoOpen, onToggleInfo, onWorking, onOpenSettings, onOpenBotSettings, onBotUpdated, pending = 0 }) {
  const [items, setItems] = useState(null);
  const [convModel, setConvModel] = useState("");
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
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
  const ctrl = useRef(null);
  const mounted = useRef(true);
  const lastUser = useRef("");
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

  const load = useCallback(async () => {
    try {
      const d = await api(`/bots/${encodeURIComponent(bot.id)}/chat`);
      if (!mounted.current) return;
      setConvModel(d.model || "");
      const list = toItems(d.messages || []);
      for (const a of d.pending || []) list.push({ kind: "prompt", id: "p" + a.id, requestId: a.id, prompt: "" });
      setItems(list);
      setLoadErr("");
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
    };
  }, [load]);
  useEffect(() => {
    api(`/bots/${encodeURIComponent(bot.id)}/settings`).then((d) => mounted.current && setPerm(d.settings.permission)).catch(() => {});
  }, [bot.id]);
  useEffect(() => onWorking(bot.id, generating), [generating]);
  useEffect(() => () => onWorking(bot.id, false), []);

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

  const send = async (raw) => {
    const msg = (raw ?? text).trim();
    if (!msg || generating) return;
    if (raw === undefined) {
      setText("");
      requestAnimationFrame(() => autoGrow(ta.current));
    }
    if (!msg.startsWith("/")) lastUser.current = msg;
    sentOnce.current = true;
    stick.current = true;
    const liveId = uid();
    const isReset = /^\/reset\b/i.test(msg);
    setItems((l) => [...(l || []), { kind: "msg", id: uid(), role: "user", text: msg, at: Date.now(), enter: true }, { kind: "msg", id: liveId, role: "assistant", text: "", at: Date.now(), live: true, startedAt: Date.now() }]);
    const ac = new AbortController();
    ctrl.current = ac;
    setGenerating(true);
    let finalText = "";
    try {
      await streamChat(
        bot.id,
        msg,
        {
          text: (d) => {
            finalText = d.text;
            patchLive(liveId, (it) => ({ ...it, text: d.text }));
          },
          prompt: (d) => {
            notify(bot.name, t("notify.prompt"), `amb-prompt-${bot.id}`);
            if (mounted.current) setItems((l) => {
              const i = l.findIndex((x) => x.id === liveId);
              const card = { kind: "prompt", id: uid(), requestId: d.requestId, prompt: d.prompt, enter: true };
              return i < 0 ? [...l, card] : [...l.slice(0, i), card, ...l.slice(i)];
            });
          },
          file: (d) => {
            markDone(isMediaFile(d.name) ? "media" : "hands");
            if (mounted.current) setItems((l) => [...l, { kind: "file", id: uid(), name: d.name, enter: true }]);
          },
          error: (d) => {
            finalText = "⚠️ " + (d.message || t("common.error"));
          },
        },
        ac.signal,
      );
    } catch (e) {
      // 在收到第一个字节前就点了停止：不是错误
      if (e.name !== "AbortError") finalText = "⚠️ " + e.message;
    }
    // 窗口不在前台时通知（设置 › 常规 › 回复完成时通知）；自己点了停止的不算
    if (finalText && !ac.signal.aborted) notify(bot.name, isError(finalText) ? t("notify.replyError", { text: plainSnippet(errText(finalText)) }) : plainSnippet(finalText) || t("notify.replyDone"), `amb-reply-${bot.id}`);
    // 上手清单：普通消息有了回复就算打过招呼；/model 切换成功算换过模型；其余能从数据里看出来的（记忆、渠道）问一次后端
    if (finalText && !isError(finalText)) {
      if (!msg.startsWith("/")) markDone("hello");
      else if (/^\/model\s+\S/i.test(msg)) markDone("model");
      const gs = guide.get();
      if (isActive(gs) && currentStep(gs)) refreshGuide();
    }
    if (!mounted.current) return;
    ctrl.current = null;
    setGenerating(false);
    if (isError(finalText)) setCue({ kind: "error", at: Date.now() });
    setItems((l) => {
      const out = [];
      for (const it of l || []) {
        if (it.id !== liveId) out.push(it);
        else if (isError(finalText)) out.push({ kind: "error", id: liveId, text: errText(finalText), retry: msg.startsWith("/") ? undefined : msg, at: it.at, enter: true });
        else if (finalText) out.push({ ...it, text: finalText, live: false, workedMs: Date.now() - it.startedAt });
      }
      return isReset && !isError(finalText) ? out.filter((x) => x.id === liveId) : out;
    });
    if (/^\/model\s+\S/i.test(msg)) load();
  };

  const stop = () => {
    ctrl.current?.abort();
  };

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
            : html`${(it.live || it.workedMs) && html`<${WorkLine} live=${it.live} text=${it.text} startedAt=${it.startedAt} workedMs=${it.workedMs} />`}
              ${it.text && html`<div class="msg"><${Markdown} text=${it.text} /></div>`}
              ${!it.live && html`<${MsgActions} text=${it.text} at=${it.at} />`}`}
        </div>`);
      } else if (it.kind === "prompt") {
        out.push(html`<div class=${cls} key=${it.id}><${PromptCard} requestId=${it.requestId} fallback=${it.prompt} /></div>`);
      } else if (it.kind === "file") {
        out.push(html`<div class=${cls} key=${it.id}><${FileCard} name=${it.name} /></div>`);
      } else if (it.kind === "media-demo") {
        out.push(html`<div class=${cls} key=${it.id}><${MediaDemo} prompt=${it.text} /></div>`);
      } else if (it.kind === "error") {
        out.push(html`<div class=${cls} key=${it.id}><${ErrorNotice} text=${it.text} onRetry=${it.retry ? () => send(it.retry) : undefined} onFixKey=${() => onOpenSettings("modelflare", "connection")} /></div>`);
      }
      prev = it;
    }
    return out;
  }, [items, generating, lang]);

  const empty = items && items.length === 0;
  const showGuide = isActive(g) && !g.seen.includes("intro") && !!currentStep(g);
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
        ${loadErr && html`<${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${load}>${t("common.retry")}</button>`}>${t("chat.error.loadHistory", { error: loadErr })}<//>`}
        ${items === null && html`<div class="chat-skel"><${Skeleton} w="40%" /><${Skeleton} w="28%" /></div>`}
        ${empty && html`<div class=${`chat-empty${showGuide ? " with-guide" : ""}`}>
          <${BotAvatar} bot=${bot} size=${88} state=${face} cue=${cue} lively pokeable greet />
          ${showGuide
            ? html`<h2>${t("chat.empty.guideTitle", { name: bot.name })}</h2>
              <p>${t("chat.empty.guideBody")}</p>
              <${GuideChecklist} bot=${bot} onSend=${(s) => send(s)} />`
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
        ${generating
          ? html`<button type="button" class="send stop" aria-label=${t("chat.composer.stop")} title=${t("chat.composer.stopTitle")} onMouseDown=${keepFocus} onClick=${stop}><${Icon} name="stop" size="md" /></button>`
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
        ...Object.entries(permMap).map(([k, p]) => ({ label: p.label, note: p.note, icon: p.icon, cur: k === perm, onSelect: () => k !== perm && pickPerm(k) })),
        { sep: true },
        { label: t("chat.perm.more"), onSelect: () => onOpenBotSettings?.(bot.id, "permission") },
      ]} />`}
    ${menu === "model" && html`<${ModelPicker} anchor=${modelRef.current} prefer="up" align="right" models=${models} error=${modelsError} onRetry=${reloadModels}
      current=${convModel || bot.defaultModel || defaultModel} onPick=${pickModel} onClose=${() => setMenu(null)}
      reset=${{ label: t("chat.model.followBot"), note: shortModel(bot.defaultModel || defaultModel) || t("common.auto"), onSelect: () => pickModel("") }}
      foot=${{ label: t("chat.model.setDefault"), disabled: !effective || sameModel(effective, bot.defaultModel), onClick: setBotDefault }} />`}
  </section>`;
}
