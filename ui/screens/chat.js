// 对话页：无顶栏，顶部居中悬浮名称胶囊（点开信息面板），960 内容列，560 气泡，底部悬浮输入胶囊。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Menu, Popover, Badge, autoGrow } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { Markdown, Linkified } from "../components/markdown.js";
import { ModelPicker, shortModel, sameModel } from "../components/model-picker.js";
import { api, streamChat } from "../lib/api.js";
import { confirmSheet, failed, saved } from "../lib/store.js";
import { fmtSep } from "../lib/format.js";

const COMMANDS = [
  ["/model", "列出或切换模型"],
  ["/new", "开始新的一段对话（旧对话归档并留交接便条）"],
  ["/reset", "清空本会话上下文"],
  ["/status", "查看当前模型与运行方式"],
  ["/help", "显示全部命令"],
];
const NEAR_BOTTOM = 80;
const LINE_PX = 22;
let seq = 0;
const uid = () => `l${++seq}`;

const isError = (t) => typeof t === "string" && t.startsWith("⚠️");
const errText = (t) => t.replace(/^⚠️\s*/, "");
const isAuthError = (t) => /HTTP 401\b|\b401\b.*(key|密钥|unauthor)/i.test(t);

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
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [row && row.status]);

  if (gone || (!row && !requestId)) return html`<div class="notice"><span class="notice-text" style="white-space:pre-wrap">${fallback}</span></div>`;
  if (!row) return html`<div class="card"><span class="skel" style="width:60%"></span><span class="skel" style="width:40%"></span></div>`;
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
      <div class="meta"><span>需要你的批准 · <span class="num">${row.code}</span></span>${!pending && html`<${Badge} s=${row.status} />`}</div>
      <div class="q">${row.reason || "机器人想执行一个超出工作区的操作"}</div>
      ${(row.tool || row.detail) && html`<div class="cmd">${row.tool}${row.detail ? "  " + row.detail : ""}</div>`}
      ${pending && html`<div class="actions">
        <button type="button" class="btn primary" disabled=${busy} onClick=${() => decide(true)}>允许（仅本次）</button>
        <button type="button" class="btn" disabled=${busy} onClick=${() => decide(false)}>拒绝</button>
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
    ${qs.map((q) => html`<div style="display:grid;gap:8px">
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
      <input class="field" placeholder=${qs.some((q) => (q.options || []).length) ? "其他回答（可选）" : "输入你的回答"} value=${custom}
        onInput=${(e) => setCustom(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && !e.isComposing && sendAll()} />
      <button type="button" class="btn primary" disabled=${busy || (!custom.trim() && !Object.values(picked).some((v) => v.length))} onClick=${sendAll}>提交</button>
    </div>`}
    ${pending && single && html`<div class="answer">
      <input class="field" placeholder="或者输入其他回答" value=${custom} onInput=${(e) => setCustom(e.target.value)}
        onKeyDown=${(e) => e.key === "Enter" && !e.isComposing && custom.trim() && submit([{ id: qs[0].id, selected: [], custom: custom.trim() }])} />
    </div>`}
    ${!pending && html`<div class="meta"><${Badge} s=${row.status} /></div>`}
  </div>`;
}

function FileCard({ name }) {
  return html`<div class="file-card">
    <${Icon} name="file" size=${32} stroke=${1.2} />
    <div style="min-width:0">
      <div class="fname">${name}</div>
      <div class="fsub">已交付到机器人工作区 · 微信/飞书会直接发送</div>
    </div>
  </div>`;
}

function ErrorNotice({ text, onRetry, onFixKey }) {
  const auth = isAuthError(text);
  return html`<div class="notice red" role="alert">
    <span class="notice-text">${auth ? "Modelflare 密钥失效或已被撤销。" : text}</span>
    ${auth && onFixKey && html`<button type="button" class="btn" onClick=${onFixKey}>去更新</button>`}
    ${onRetry && html`<button type="button" class="btn" onClick=${onRetry}>重试</button>`}
  </div>`;
}

export function ChatScreen({ bot, models, modelsError, reloadModels, defaultModel, infoOpen, onToggleInfo, onWorking, onOpenSettings, onBotUpdated }) {
  const [items, setItems] = useState(null);
  const [convModel, setConvModel] = useState("");
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const [menu, setMenu] = useState(null); // "plus" | "model" | null
  const [slashSel, setSlashSel] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const scroller = useRef(null);
  const stick = useRef(true);
  const ta = useRef(null);
  const plusRef = useRef(null);
  const modelRef = useRef(null);
  const ctrl = useRef(null);
  const mounted = useRef(true);
  const lastUser = useRef("");

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
    if (near) setUnseen(false);
  };
  const toBottom = () => {
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setUnseen(false);
  };

  const patchLive = (id, fn) => mounted.current && setItems((l) => (l || []).map((it) => (it.id === id ? fn(it) : it)));

  const send = async (raw) => {
    const t = (raw ?? text).trim();
    if (!t || generating) return;
    if (raw === undefined) {
      setText("");
      requestAnimationFrame(() => autoGrow(ta.current, LINE_PX * 8 + 8));
    }
    if (!t.startsWith("/")) lastUser.current = t;
    stick.current = true;
    const liveId = uid();
    const isReset = /^\/reset\b/i.test(t);
    setItems((l) => [...(l || []), { kind: "msg", id: uid(), role: "user", text: t, at: Date.now(), enter: true }, { kind: "msg", id: liveId, role: "assistant", text: "", at: Date.now(), live: true }]);
    const ac = new AbortController();
    ctrl.current = ac;
    setGenerating(true);
    let finalText = "";
    try {
      await streamChat(
        bot.id,
        t,
        {
          text: (d) => {
            finalText = d.text;
            patchLive(liveId, (it) => ({ ...it, text: d.text }));
          },
          prompt: (d) => mounted.current && setItems((l) => {
            const i = l.findIndex((x) => x.id === liveId);
            const card = { kind: "prompt", id: uid(), requestId: d.requestId, prompt: d.prompt };
            return i < 0 ? [...l, card] : [...l.slice(0, i), card, ...l.slice(i)];
          }),
          file: (d) => mounted.current && setItems((l) => [...l, { kind: "file", id: uid(), name: d.name }]),
          error: (d) => {
            finalText = "⚠️ " + (d.message || "出错了");
          },
        },
        ac.signal,
      );
    } catch (e) {
      // 在收到第一个字节前就点了停止：不是错误
      if (e.name !== "AbortError") finalText = "⚠️ " + e.message;
    }
    if (!mounted.current) return;
    ctrl.current = null;
    setGenerating(false);
    setItems((l) => {
      const out = [];
      for (const it of l || []) {
        if (it.id !== liveId) out.push(it);
        else if (isError(finalText)) out.push({ kind: "error", id: liveId, text: errText(finalText), retry: t.startsWith("/") ? undefined : t, at: it.at });
        else if (finalText) out.push({ ...it, text: finalText, live: false });
      }
      return isReset && !isError(finalText) ? out.filter((x) => x.id === liveId) : out;
    });
    if (/^\/model\s+\S/i.test(t)) load();
  };

  const stop = () => {
    ctrl.current?.abort();
  };

  // —— 斜杠命令菜单 ——
  const slashQuery = /^\/\S*$/.test(text) && !slashOff ? text.toLowerCase() : null;
  const slashHits = slashQuery !== null ? COMMANDS.filter(([c]) => c.startsWith(slashQuery)) : [];
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && generating) {
      e.preventDefault();
      stop();
    }
  };

  // —— 模型 ——
  const effective = convModel || bot.defaultModel || defaultModel || (models && models[0]) || "";
  const pickModel = async (m) => {
    try {
      await api(`/bots/${encodeURIComponent(bot.id)}/chat/model`, { method: "PUT", body: { model: m } });
      setConvModel(m);
      saved();
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
    } catch (e) {
      failed(e);
    }
  };
  const plusItems = [
    { label: "切换模型…", onSelect: () => requestAnimationFrame(() => setMenu("model")) },
    { sep: true },
    { label: "开始新的一段对话", note: "/new", onSelect: () => send("/new") },
    {
      label: "清空上下文",
      note: "/reset",
      onSelect: async () => {
        if (await confirmSheet({ title: "清空本会话上下文？", body: `「${bot.name}」会忘掉这段网页对话的内容；长期记忆保留。`, confirmLabel: "清空", danger: true })) send("/reset");
      },
    },
    { label: "查看状态", note: "/status", onSelect: () => send("/status") },
    { label: "全部命令", note: "/help", onSelect: () => send("/help") },
  ];

  // —— 渲染 ——
  const rows = useMemo(() => {
    const out = [];
    let prev = null;
    for (const it of items || []) {
      if (it.at && (!prev?.at || new Date(it.at).toDateString() !== new Date(prev.at).toDateString() || it.at - prev.at > 15 * 60_000)) {
        out.push(html`<div class="time-sep" key=${"t" + it.id}>${fmtSep(it.at)}</div>`);
        prev = null;
      }
      const role = it.kind === "msg" ? it.role : "assistant";
      const cont = prev && (prev.kind === "msg" ? prev.role : "assistant") === role;
      const cls = `msg-row ${role}${cont ? " cont" : ""}${it.enter ? " enter" : ""}`;
      if (it.kind === "msg") {
        out.push(html`<div class=${cls} key=${it.id}>
          ${it.role === "user"
            ? html`<div class="msg"><${Linkified} text=${it.text} /></div>`
            : it.live && !it.text
              ? html`<div class="msg" aria-label="正在回复"><span class="typing"><i></i><i></i><i></i></span></div>`
              : html`<div class="msg"><${Markdown} text=${it.text} />${it.live && html`<span class="caret" aria-hidden="true"></span>`}</div>`}
        </div>`);
      } else if (it.kind === "prompt") {
        out.push(html`<div class=${cls} key=${it.id}><${PromptCard} requestId=${it.requestId} fallback=${it.prompt} /></div>`);
      } else if (it.kind === "file") {
        out.push(html`<div class=${cls} key=${it.id}><${FileCard} name=${it.name} /></div>`);
      } else if (it.kind === "error") {
        out.push(html`<div class=${cls} key=${it.id}><${ErrorNotice} text=${it.text} onRetry=${it.retry ? () => send(it.retry) : undefined} onFixKey=${() => onOpenSettings("modelflare", "connection")} /></div>`);
      }
      prev = it;
    }
    return out;
  }, [items, generating]);

  const empty = items && items.length === 0;
  return html`<section class="chat" data-screen="chat" aria-label=${`和 ${bot.name} 的对话`}>
    <div class="drag-strip"></div>
    <button type="button" class="float-pill" aria-pressed=${infoOpen} title="信息面板（⌘⇧I）" onClick=${onToggleInfo}>
      <${BotAvatar} name=${bot.name} id=${bot.id} size=${21} working=${generating} />
      <span class="name">${bot.name}</span>
    </button>
    <div class="chat-scroll" ref=${scroller} onScroll=${onScroll}>
      <div class="chat-col" role="log" aria-live="polite" aria-busy=${generating}>
        ${loadErr && html`<div class="notice red" style="margin-top:8px"><span class="notice-text">读取历史消息失败：${loadErr}</span><button type="button" class="btn" onClick=${load}>重试</button></div>`}
        ${items === null && html`<div style="display:grid;gap:14px;margin-top:24px"><span class="skel" style="width:40%;height:34px;border-radius:17px"></span><span class="skel" style="width:28%;height:34px;border-radius:17px;justify-self:end"></span></div>`}
        ${empty && html`<div class="chat-empty">
          <${BotAvatar} name=${bot.name} id=${bot.id} size=${56} />
          <h2>和 ${bot.name} 开始对话</h2>
          <p>在这里直接测试机器人；飞书和微信渠道在信息面板里配置。</p>
          <div class="chips">
            <button type="button" class="chip" onClick=${() => send("你能帮我做什么？")}>你能帮我做什么？</button>
            <button type="button" class="chip" onClick=${() => send("/help")}>/help 查看命令</button>
          </div>
        </div>`}
        ${rows}
      </div>
    </div>
    ${!atBottom && html`<button type="button" class="to-bottom" aria-label="回到底部" onClick=${toBottom}><${Icon} name="down" />${unseen && html`<span class="new"></span>`}</button>`}
    <div class="composer-dock">
      <div class="composer">
        <button type="button" class="plus" ref=${plusRef} aria-label="更多操作" aria-haspopup="menu" aria-expanded=${menu === "plus"} onClick=${() => setMenu(menu === "plus" ? null : "plus")}><${Icon} name="plus" size=${14} stroke=${1.8} /></button>
        <textarea ref=${ta} rows="1" placeholder=${`给「${bot.name}」发消息`} aria-label="消息" value=${text}
          onInput=${(e) => { setText(e.target.value); setSlashOff(false); setSlashSel(0); autoGrow(e.target, LINE_PX * 8 + 8); }}
          onKeyDown=${onKey} />
        <button type="button" class="model-chip" ref=${modelRef} title=${effective ? `当前模型：${effective}` : "选择模型"} aria-haspopup="listbox" aria-expanded=${menu === "model"}
          onClick=${() => setMenu(menu === "model" ? null : "model")}>
          <span class="v">${effective ? shortModel(effective) : "选择模型"}</span><${Icon} name="chevDown" />
        </button>
        ${generating
          ? html`<button type="button" class="send stop" aria-label="停止生成（Esc）" title="停止（Esc）" onClick=${stop}><${Icon} name="stop" size=${12} /></button>`
          : html`<button type="button" class="send" aria-label="发送" title="发送（Enter）" disabled=${!text.trim()} onClick=${() => send()}><${Icon} name="up" size=${15} stroke=${2} /></button>`}
      </div>
    </div>
    ${slashOpen && ta.current && html`<${Popover} anchor=${ta.current} prefer="up" width=${320} keepFocus label="命令" onClose=${() => setSlashOff(true)}>
      <ul role="listbox" aria-label="命令">
        ${slashHits.map(([c, d], i) => html`<li role="option" aria-selected=${i === slashSel} class=${`explained${i === Math.min(slashSel, slashHits.length - 1) ? " sel" : ""}`}
          onPointerDown=${(e) => e.preventDefault()} onPointerMove=${() => setSlashSel(i)} onClick=${() => completeSlash(c)}>
          <span class="v">${c}</span><span class="n">${d}</span>
        </li>`)}
      </ul>
    <//>`}
    ${menu === "plus" && html`<${Menu} anchor=${plusRef.current} prefer="up" width=${240} label="更多操作" onClose=${() => setMenu(null)} items=${plusItems} />`}
    ${menu === "model" && html`<${ModelPicker} anchor=${modelRef.current} prefer="up" align="right" models=${models} error=${modelsError} onRetry=${reloadModels}
      current=${convModel || bot.defaultModel || defaultModel} onPick=${pickModel} onClose=${() => setMenu(null)}
      reset=${{ label: "跟随机器人默认", note: shortModel(bot.defaultModel || defaultModel) || "自动", onSelect: () => pickModel("") }}
      foot=${{ label: "设为此机器人的默认模型", disabled: !effective || sameModel(effective, bot.defaultModel), onClick: setBotDefault }} />`}
  </section>`;
}
