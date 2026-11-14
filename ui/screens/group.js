// 群聊（服务端见 src/core/groups.ts）：和单聊同一套对话流和输入框，每条回复上面多一行头像和名字。
// @ 谁谁回答；没 @ 时上一个回答的接着答。同一时刻只有一个机器人在答（live），答完重新读时间线。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, IconButton, Notice, Popover, Sheet, Skeleton, Spinner, autoGrow } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { Markdown, Linkified } from "../components/markdown.js";
import { RuleCard, RuleSource, useRuleActions } from "../components/rules.js";
import { upsertStep } from "../components/activity.js";
import { DeliveredFiles } from "../components/files.js";
import { api, attachGroup } from "../lib/api.js";
import { failed, saved, useStore } from "../lib/store.js";
import { fmtSep } from "../lib/format.js";
import { fill, refreshGuide, refreshGuideSoon } from "../lib/guide.js";
import { prefs } from "../lib/prefs.js";
import { t, useLang } from "../lib/i18n.js";
import { notify, plainSnippet } from "../lib/notify.js";
import { reducedMotion } from "../design/motion.js";
import { ErrorNotice, MsgActions, PromptCard, WorkLine, addFile, errText, isError, shownText } from "./chat.js";
import { ConversationFind, HistoryBar, HistoryPageButton, useMessageHistory } from "../components/chat-search.js";
import { chatView, saveChatView, useChatDraft } from "../lib/chat-view.js";

const NEAR_BOTTOM = 80;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_ENTER = isMac ? "⌘Enter" : "Ctrl+Enter";
/** 代表所有成员的那一项（选中后写进输入框的是 group.everyone） */
const EVERYONE = "*";

function toItems(messages) {
  return messages.map((m) => {
    const base = { id: "m" + m.id, mid: m.id, botId: m.botId, conv: m.conversationId, at: m.createdAt, steps: m.steps, interim: m.interim, files: m.files, ruleSource: m.ruleSource };
    if (m.role === "system") return { ...base, kind: "note", text: m.content };
    if (m.role === "assistant" && isError(m.content)) return { ...base, kind: "error", text: errText(m.content) };
    return { ...base, kind: "msg", role: m.role === "user" ? "user" : "assistant", text: m.content };
  });
}

/** 正在答的那一轮（事件 turn，内容是 LiveTurn 的快照） */
const liveFrom = (d) => ({ id: "live" + d.id, botId: d.botId, conv: d.conversationId, kind: "msg", role: "assistant", live: true, text: d.text, interim: d.interim || [], files: d.files || [], activity: d.steps || [], prompts: d.prompts || [], at: d.startedAt, startedAt: d.startedAt });

/** 光标前面正在输入的 @：{ start, query }；邮箱里的 @ 不算 */
export function mentionAt(value, caret) {
  const before = value.slice(0, caret);
  const m = /@([^\s@]*)$/.exec(before);
  if (!m || /[A-Za-z0-9_]/.test(before[m.index - 1] || "")) return null;
  return { start: m.index, query: m[1] };
}

/** 几个头像叠在一起：pile = 侧栏行里两个错开放进一个头像的位置，其余是一排 */
export function GroupAvatars({ bots, size = 22, pile }) {
  const shown = bots.slice(0, pile ? 2 : 4);
  return html`<span class=${`group-avatars${pile ? " pile" : ""}`} style=${{ "--ga-size": `${size}px` }} aria-hidden="true">
    ${shown.map((b) => html`<span class="ga" key=${b.id}><${BotAvatar} bot=${b} size=${pile ? Math.round(size * 0.68) : size} /></span>`)}
  </span>`;
}

/** 建群和改群：名称（可以不填，用成员的名字）+ 选成员（至少两个） */
export function GroupSheet({ group, bots, onClose, onSaved }) {
  const [name, setName] = useState(group ? group.name : "");
  const [picked, setPicked] = useState(group ? group.members.filter((id) => bots.some((b) => b.id === id)) : []);
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), members: picked };
      const d = group ? await api(`/groups/${encodeURIComponent(group.id)}`, { method: "PUT", body }) : await api("/groups", { method: "POST", body });
      if (group) saved();
      onSaved(d.group);
    } catch (err) {
      failed(err);
      setBusy(false);
    }
  };
  return html`<${Sheet} title=${group ? t("group.sheet.editTitle") : t("group.sheet.newTitle")} onClose=${onClose}>
    <form onSubmit=${submit}>
      ${!group && html`<p class="hint">${t("firstUse.groupPurpose")}</p>`}
      <label class="set-field"><span class="k">${t("group.sheet.name")}</span>
        <input class="field" maxlength="80" value=${name} placeholder=${t("firstUse.groupName")} onInput=${(e) => setName(e.target.value)} data-autofocus />
        <span class="hint">${t("firstUse.groupNameHint")}</span>
      </label>
      <div class="set-field">
        <span class="k">${t("group.sheet.members")}<span class="hint">${t("firstUse.groupMembers")}</span></span>
        <div class="group-picks">
          ${bots.map((b) => {
            const on = picked.includes(b.id);
            return html`<button type="button" key=${b.id} class=${`group-pick${on ? " on" : ""}`} aria-pressed=${on} onClick=${() => toggle(b.id)}>
              <${BotAvatar} bot=${b} size=${28} /><span class="v">${b.name}</span>${on && html`<${Icon} name="check" size="sm" strong />`}
            </button>`;
          })}
        </div>
      </div>
      <div class="actions"><button type="submit" class="btn primary" disabled=${busy || picked.length < 2}>${group ? t("group.sheet.save") : t("group.sheet.create")}</button></div>
    </form>
  <//>`;
}

export function GroupScreen({ group, bots, onEdit, onOpenSettings, onChanged, initialFocus, onBackToSearch, visible = true }) {
  const ruleActions = useRuleActions("", group.id);
  const viewId = `group:${group.id}`;
  const savedView = useRef(chatView(viewId));
  const restoreView = useRef(true);
  const [items, setItems] = useState(null);
  const fillReq = useStore(fill);
  const [live, setLive] = useState(null);
  const [pending, setPending] = useState([]);
  const [canOpen, setCanOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [text, setText] = useChatDraft(viewId);
  const [findOpen, setFindOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [mention, setMention] = useState(null);
  const [mentionSel, setMentionSel] = useState(0);
  const lang = useLang();
  const { sendKey } = useStore(prefs);
  const scroller = useRef(null);
  const stick = useRef(savedView.current.atBottom);
  const history = useMessageHistory({ scope: { group: group.id }, scroller, stick, initialFocus, visible });
  const ta = useRef(null);
  const mounted = useRef(true);
  const following = useRef(null);
  const attachRef = useRef(null);
  const enc = encodeURIComponent(group.id);
  const botOf = useCallback((id) => bots.find((b) => b.id === id), [bots]);
  const members = useMemo(() => group.members.map(botOf).filter(Boolean), [group.members, botOf]);

  const load = useCallback(async () => {
    try {
      const d = await api(`/groups/${enc}`);
      if (!mounted.current) return null;
      setItems(toItems(d.messages || []));
      setPending(d.pending || []);
      setCanOpen(!!d.canOpen);
      setLoadErr("");
      if (d.group.running) attachRef.current();
      return d;
    } catch (e) {
      if (mounted.current) {
        setItems((v) => v || []);
        setLoadErr(e.message);
      }
      return null;
    }
  }, [enc]);

  /** 接着这个群，直到都答完了；同一时刻只接一条 */
  const attach = () => {
    if (following.current) return;
    const ac = new AbortController();
    following.current = ac;
    setRunning(true);
    const patch = (fn) => mounted.current && setLive((x) => (x ? fn(x) : x));
    attachGroup(
      group.id,
      {
        turn: (d) => mounted.current && setLive(liveFrom(d)),
        text: (d) => patch((x) => ({ ...x, text: d.text })),
        interim: (d) => patch((x) => ({ ...x, interim: [...x.interim, d.text] })),
        activity: (d) => patch((x) => ({ ...x, activity: upsertStep(x.activity, d) })),
        file: (d) => patch((x) => ({ ...x, files: addFile(x.files, d) })),
        prompt: (d) => {
          notify(group.name, t("notify.prompt"), `amb-group-prompt-${group.id}`);
          patch((x) => (x.prompts.some((p) => p.requestId === d.requestId) ? x : { ...x, prompts: [...x.prompts, d] }));
        },
        stopping: () => mounted.current && setStopping(true),
        // 这一轮答完：存下的回复换掉进行中的那一项
        turnEnd: () => {
          if (!mounted.current) return;
          setLive(null);
          setStopping(false);
          load();
        },
      },
      ac.signal,
    )
      .catch((e) => mounted.current && failed(e))
      .finally(async () => {
        if (following.current === ac) following.current = null;
        if (!mounted.current || ac.signal.aborted) return;
        setRunning(false);
        setLive(null);
        setStopping(false);
        const d = await load();
        onChanged?.();
        const last = d?.messages?.findLast((m) => m.role === "assistant");
        if (last) notify(group.name, isError(last.content) ? t("notify.replyError", { text: plainSnippet(errText(last.content)) }) : plainSnippet(last.content) || t("notify.replyDone"), `amb-group-${group.id}`);
      });
  };
  attachRef.current = attach;

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      following.current?.abort();
    };
  }, [enc]);
  // 没在接着时有了新消息（后台任务的结果、别的窗口发的）：重新读一次
  const lastId = group.last?.id ?? 0;
  useEffect(() => {
    if (items && !following.current) load();
  }, [lastId, group.running]);

  useLayoutEffect(() => {
    if (!visible || history.context || items === null) return;
    if (restoreView.current && scroller.current) {
      restoreView.current = false;
      if (!savedView.current.atBottom) { scroller.current.scrollTop = savedView.current.top; return; }
    }
    if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [items, live, history.context, visible]);
  const onScroll = () => {
    const el = scroller.current;
    if (!visible || !el?.getClientRects().length) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    stick.current = history.context ? false : near;
    setAtBottom(history.context ? false : near);
    if (!history.context) saveChatView(viewId, { top: el.scrollTop, atBottom: near });
    setScrolled(el.scrollTop > 2);
  };
  const toBottom = () => {
    history.clear();
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  // —— @ 成员 ——
  const mentionHits = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const options = [...members.map((b) => ({ id: b.id, name: b.name, bot: b })), { id: EVERYONE, name: t("group.everyone") }];
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [mention, members, lang]);
  const mentionOpen = mentionHits.length > 0;
  const readMention = (el) => {
    setMention(mentionAt(el.value, el.selectionStart ?? el.value.length));
    setMentionSel(0);
  };
  const pickMention = (o) => {
    const el = ta.current;
    if (!el || !mention) return;
    const insert = `@${o.name} `;
    const caret = el.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    const at = mention.start + insert.length;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
      autoGrow(el);
    });
  };

  const send = async (raw) => {
    const msg = (typeof raw === "string" ? raw : text).trim();
    if (!msg) return;
    history.clear(); setFindOpen(false);
    if (typeof raw !== "string") setText("");
    setMention(null);
    requestAnimationFrame(() => autoGrow(ta.current));
    stick.current = true;
    try {
      await api(`/groups/${enc}/messages`, { method: "POST", body: { text: msg } });
      await load();
    } catch (e) {
      if (typeof raw !== "string") setText(msg);
      failed(e);
    }
  };
  useEffect(() => {
    if (!fillReq || fillReq.target !== viewId || items === null) return;
    fill.set(null);
    if (fillReq.send) void send(fillReq.text);
    else if (!text.trim()) setText(fillReq.text);
  }, [fillReq?.at, items !== null]);
  useEffect(() => { if (!running && items) { refreshGuide(); refreshGuideSoon(); } }, [running]);
  const stop = async () => {
    setStopping(true);
    try {
      await api(`/groups/${enc}/stop`, { method: "POST", body: {} });
    } catch (e) {
      setStopping(false);
      failed(e);
    }
  };
  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        return setMentionSel((s) => (s + 1) % mentionHits.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        return setMentionSel((s) => (s - 1 + mentionHits.length) % mentionHits.length);
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        return pickMention(mentionHits[Math.min(mentionSel, mentionHits.length - 1)]);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        return setMention(null);
      }
    }
    if (e.key === "Escape" && running && !stopping) {
      e.preventDefault();
      return stop();
    }
    if (e.key === "Enter" && !e.shiftKey && (sendKey !== "mod" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  // —— 渲染 ——
  const nameOf = (id) => botOf(id)?.name || t("group.removedBot");
  const loadActivity = (it) => () => api(`/conversations/${encodeURIComponent(it.conv)}/messages/${it.mid}/activity`).then((d) => d.steps);
  // 图片读完了高度才定下来：本来就跟着底部时，再贴一次底
  const onMedia = () => {
    if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  };
  const files = (it) => html`<${DeliveredFiles} files=${it.files} conv=${it.conv} canOpen=${canOpen} onLoad=${onMedia} />`;
  const rows = useMemo(() => {
    const out = [];
    let prev = null;
    const list = history.context ? toItems(history.context.messages) : [...(items || []), ...(live ? [live] : [])];
    const lastAi = (items || []).findLast((x) => x.kind === "msg" && x.role === "assistant")?.id;
    for (const it of list) {
      if (it.at && (!prev?.at || new Date(it.at).toDateString() !== new Date(prev.at).toDateString() || it.at - prev.at > 15 * 60_000)) {
        out.push(html`<div class="time-sep" key=${"t" + it.id}>${fmtSep(it.at)}</div>`);
        prev = null;
      }
      if (it.kind === "note") {
        out.push(html`<div class="group-note" key=${it.id}>${it.text}</div>`);
        prev = it;
        continue;
      }
      const isUser = it.kind === "msg" && it.role === "user";
      const same = prev && prev.kind !== "note" && (isUser ? prev.kind === "msg" && prev.role === "user" : prev.botId === it.botId);
      const author = !isUser && !same && html`<div class="msg-author"><${BotAvatar} bot=${botOf(it.botId) || { id: it.botId }} size=${20} state=${it.live ? "working" : "idle"} /><span>${nameOf(it.botId)}</span></div>`;
      const cls = `msg-row ${isUser ? "user" : "assistant"}${same ? " cont" : ""}${it.live ? " live" : ""}`;
      if (it.kind === "error") {
        out.push(html`<div class=${cls} data-message-id=${it.mid} key=${it.id}>${author}<${ErrorNotice} text=${it.text} onFixKey=${() => onOpenSettings("modelflare", "account")} /></div>`);
      } else if (isUser) {
        out.push(html`<div class=${cls} data-message-id=${it.mid} key=${it.id}><div class="msg"><${Linkified} text=${it.text} /></div><${MsgActions} text=${it.text} at=${it.at} /></div>`);
      } else {
        const shown = shownText(it);
        out.push(html`<div class=${`${cls}${it.id === lastAi ? " last" : ""}`} data-message-id=${it.mid} key=${it.id}>
          ${author}
          ${(it.live || it.steps) && html`<${WorkLine} live=${it.live} stopping=${it.live && stopping} text=${it.text} startedAt=${it.startedAt} steps=${it.activity} count=${it.steps} load=${it.mid ? loadActivity(it) : undefined} />`}
          ${(it.prompts || []).map((p) => html`<${PromptCard} key=${p.requestId} requestId=${p.requestId} fallback=${p.prompt} />`)}
          ${it.ruleSource && html`<${RuleSource} source=${it.ruleSource} botId=${it.botId} />`}
          ${shown && html`<div class="msg"><${Markdown} text=${shown} conv=${it.conv} canOpen=${canOpen} /></div>`}
          ${files(it)}
          ${ruleActions.filter((a) => a.messageId === it.mid).map((a) => html`<${RuleCard} key=${a.id} action=${a} />`)}
          ${!it.live && html`<${MsgActions} text=${shown} at=${it.at} />`}
        </div>`);
      }
      prev = it;
    }
    // 等你批准或回答的，已经挂在进行中的回复上的不重复
    const shownIds = new Set((live?.prompts || []).map((p) => p.requestId));
    for (const p of pending) if (!shownIds.has(p.id)) out.push(html`<div class="msg-row assistant" key=${"p" + p.id}><${PromptCard} requestId=${p.id} fallback="" /></div>`);
    return out;
  }, [items, history.context, live, pending, stopping, canOpen, bots, lang, ruleActions]);

  // 示例按真实成员生成（第 17 项）：名字里像"写作助手"的用起草的例子，否则用第一位成员的通用例子。
  // 只用在群里不重名的成员：填进去的 @名字 要能被服务端的点名解析（core/groups.ts mentionsIn）认成这个人
  const nameKey = (b) => b.name.trim().toLowerCase();
  const unique = members.filter((b) => b.name.trim() && members.filter((x) => nameKey(x) === nameKey(b)).length === 1);
  const writerWords = t("firstUse.writerWords").split("|").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const writer = unique.find((b) => writerWords.some((w) => nameKey(b).includes(w)));
  // 第一条：有写作类成员就用起草的例子，否则是第一位不重名成员的通用例子。两位不重名成员出 2 条，三位及以上最多 3 条：
  // 第二条请下一位提修改建议，第三条请再下一位整理结论——一眼看出可以换人接着干。没有不重名成员时不出示例
  const first = writer || unique[0];
  const rest = unique.filter((b) => b !== first);
  const examples = first
    ? [
        t(writer ? "firstUse.writerExample" : "firstUse.genericExample", { name: first.name.trim() }),
        ...(rest[0] ? [t("firstUse.reviseExample", { name: rest[0].name.trim() })] : []),
        ...(rest[1] ? [t("firstUse.summaryExample", { name: rest[1].name.trim() })] : []),
      ]
    : [];
  const fillExample = (example) => {
    // Append rather than discard a draft, using the member name the real mention parser accepts.
    setText((v) => v.trim() ? `${v}\n${example}` : example);
    requestAnimationFrame(() => { ta.current?.focus(); autoGrow(ta.current); });
  };
  const empty = !history.context && items && items.length === 0 && !live;
  const canSend = !!text.trim();
  return html`<section class=${`chat${scrolled ? " scrolled" : ""}${findOpen || history.context || history.loading || history.error ? " has-chat-tools" : ""}`} data-screen="group" aria-label=${group.name}>
    <header class="chat-head">
      ${onBackToSearch && html`<${IconButton} icon="chevLeft" label=${t("search.backResults")} onClick=${onBackToSearch} />`}
      <button type="button" class="head-bot" title=${t("group.editTitle")} onClick=${onEdit}>
        <${GroupAvatars} bots=${members} size=${22} />
        <span class="name">${group.name}</span>
      </button>
      <span class="grow"></span>
      <${IconButton} icon="search" label=${t("search.findInChat")} onClick=${() => setFindOpen(true)} />
    </header>
    <div class="chat-tools" hidden=${!(findOpen || history.context || history.loading || history.error)}>
      <${ConversationFind} scope=${{ group: group.id }} onMatch=${history.show} scroller=${scroller} open=${findOpen} onOpen=${() => setFindOpen(true)} onClose=${() => { setFindOpen(false); history.clearHighlight(); }} />
      <${HistoryBar} history=${history} onLatest=${toBottom} />
    </div>
    <div class="chat-scroll" ref=${scroller} onScroll=${onScroll}>
      <div class=${`chat-col${items ? " ready" : ""}`} role="log" aria-live="polite" aria-busy=${running}>
        <${HistoryPageButton} history=${history} direction="before" />
        ${loadErr && html`<${Notice} tone="red" action=${html`<button type="button" class="btn" onClick=${load}>${t("common.retry")}</button>`}>${t("chat.error.loadHistory", { error: loadErr })}<//>`}
        ${items === null && html`<div class="chat-skel"><${Skeleton} w="40%" /><${Skeleton} w="28%" /></div>`}
        ${empty && html`<div class="chat-empty group-empty">
          <${GroupAvatars} bots=${members} size=${56} />
          <h2>${group.name}</h2>
          <p>${t("firstUse.groupTitle")}</p>
          <ul class="group-rules">
            <li>${t("firstUse.groupRule1")}</li>
            <li>${t("firstUse.groupRule2")}</li>
            <li>${t("firstUse.groupRule3")}</li>
          </ul>
          ${examples.length > 0 && html`<div class="group-examples" role="list" aria-label=${t("firstUse.groupExamples")}>
            ${examples.map((e) => html`<button type="button" role="listitem" class="group-example" key=${e} onClick=${() => fillExample(e)}>${e}</button>`)}
          </div>`}
        </div>`}
        ${rows}
        <${HistoryPageButton} history=${history} direction="after" />
      </div>
    </div>
    ${!atBottom && html`<button type="button" class="to-bottom" aria-label=${t("chat.toBottom")} onClick=${toBottom}><${Icon} name="down" size="md" /></button>`}
    <div class="composer-dock">
      <div class="composer">
        <textarea ref=${ta} rows="1" placeholder=${t("firstUse.groupComposer")} aria-label=${t("chat.composer.label")} value=${text}
          onInput=${(e) => { setText(e.target.value); readMention(e.target); autoGrow(e.target); }}
          onClick=${(e) => readMention(e.target)} onKeyDown=${onKey} />
        <div class="composer-bar">
          <span class="grow"></span>
          ${running && html`<button type="button" class="send stop" aria-label=${stopping ? t("chat.composer.stopping") : t("chat.composer.stop")} title=${stopping ? t("chat.composer.stopping") : t("chat.composer.stopTitle")}
            disabled=${stopping} aria-busy=${stopping} onMouseDown=${(e) => e.preventDefault()} onClick=${stop}>${stopping ? html`<${Spinner} />` : html`<${Icon} name="stop" size="md" />`}</button>`}
          ${(!running || canSend) && html`<button type="button" class="send" aria-label=${t("chat.composer.send")} title=${t("chat.composer.sendTitle", { key: sendKey === "mod" ? MOD_ENTER : "Enter" })}
            disabled=${!canSend} onMouseDown=${(e) => e.preventDefault()} onClick=${send}><${Icon} name="up" size="md" strong /></button>`}
        </div>
      </div>
    </div>
    ${mentionOpen && ta.current && html`<${Popover} anchor=${ta.current} prefer="up" width=${260} keepFocus label=${t("group.mentionLabel")} onClose=${() => setMention(null)}>
      <ul role="listbox" aria-label=${t("group.mentionLabel")}>
        ${mentionHits.map((o, i) => html`<li role="option" key=${o.id} aria-selected=${i === mentionSel} class=${i === Math.min(mentionSel, mentionHits.length - 1) ? "sel" : ""}
          onPointerDown=${(e) => e.preventDefault()} onPointerMove=${() => setMentionSel(i)} onClick=${() => pickMention(o)}>
          ${o.bot ? html`<${BotAvatar} bot=${o.bot} size=${20} />` : null}<span class="v">${o.name}</span>
        </li>`)}
      </ul>
    <//>`}
  </section>`;
}
