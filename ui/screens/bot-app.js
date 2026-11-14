import { useStore } from "../lib/store.js";
// 专业 Bot（目录 Bot）的页面：主区是常规的对话流，Bot 的专属界面（沙箱 iframe）在右侧面板的「工作台」标签里（screens/work-panel.js）。
// - 有实例：主区就是对话页（ChatScreen）。界面上的操作（[ui-action]）也经它发出，和打字一样出现在对话里、跟着回复；
//   回合的开始和结束转告界面（turn）。
// - 还没有实例：主区是 Bot 的开场白和示例（BotIntro），底部是和对话页同一个输入框；界面显示示例数据。
//   不创建实例、不装技能、不起进程。第一次发消息（打字或界面上的操作）才创建，主区换成对话页，这一句交给对话页发。
// iframe 由这里渲染、桥接也在这里，只是通过 Portal 放进面板给的宿主（frameHost）：面板关上时宿主没了，界面跟着卸载，再打开时重新载入。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, IconButton, Notice, Spinner, autoGrow } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { Composer, convModelOf, setConvModel } from "../components/composer.js";
import { OfficialGuideNotice } from "../components/guide.js";
import { ChatScreen } from "./chat.js";
import { Portal } from "./work-panel.js";
import { appFileResource, openResource, websiteResource } from "../lib/resource-preview.js";
import { api, watchApp } from "../lib/api.js";
import { attachBridge, currentEnv, pickFiles, safeExternalUrl, watchEnv } from "../lib/bot-bridge.js";
import { markCatalogSeen, tr } from "../lib/catalog.js";
import { guide, markSeen, requestHint, composerBusy } from "../lib/guide.js";
import { confirmSheet, failed, toast } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";

const errorText = (e) => {
  const key = `botapp.errors.${e?.data?.code || "catalog_failed"}`;
  const s = t(key);
  return s === key ? t("botapp.errors.catalog_failed") : s;
};

/**
 * 还没有实例时的对话页：Bot 用一段话介绍自己（一句话 + 能做什么），下面是完整的几句示例（不省略，点了就发），
 * 输入框照常在底部。给不知道该说什么的人一个像聊天一样的起点；发出第一句后实例建好，这里换成真正的对话。
 */
function BotIntro({ entry, lang, busy, onSend }) {
  if (!entry) return null;
  const about = tr(entry.about, lang) || [];
  const starters = tr(entry.starters, lang) || [];
  return html`<div class="botapp-intro">
    <div class="botapp-intro-col"><${OfficialGuideNotice} busy=${busy} />
      <div class="botapp-intro-msg">
        <${BotAvatar} char=${entry.avatar} size=${36} greet />
        <div class="botapp-intro-text">
          <p class="botapp-intro-hello">${t("botapp.intro.hello", { name: tr(entry.name, lang) })}</p>
          <p>${tr(entry.summary, lang)}</p>
          ${about.length > 0 && html`<ul>${about.map((x) => html`<li key=${x}>${x}</li>`)}</ul>`}
        </div>
      </div>
      ${starters.length > 0 && html`<div class="botapp-intro-try" role="list" aria-label=${t("botapp.intro.try")}>
        <h3 class="t-label">${t("botapp.intro.try")}</h3>
        ${starters.map((s) => html`<button type="button" role="listitem" class="botapp-intro-starter" key=${s} disabled=${busy} onClick=${() => onSend(s)}>${s}</button>`)}
      </div>`}
      <p class="botapp-intro-note">${t("botapp.intro.note")}</p>
    </div>
  </div>`;
}

/**
 * frameHost：右侧面板「工作台」标签的宿主节点（面板关着时为空）；panelOpen / onTogglePanel：顶栏的面板开关；
 * onEntry(entry)：读到目录条目后告诉外壳（面板的概览里列出 Bot 的说明）
 */
export function BotAppScreen({ catalogId, bot, frameHost, panelOpen, expanded, onExpand, onTogglePanel, onEntry, onInstalled, onBotUpdated, onOpenBotSettings, onOpenSettings, chatProps }) {
  const lang = useLang();
  const [entry, setEntry] = useState(null);
  const onboarding = useStore(guide);
  useEffect(() => { if (onboarding.loaded) requestHint("official-hint"); }, [onboarding.loaded]);
  const [base, setBase] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [uiFailed, setUiFailed] = useState(false);
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!bot) composerBusy.set(!!draft.trim() || busy); return () => { if (!bot) composerBusy.set(false); }; }, [bot?.id, !!draft.trim(), busy]);
  const [installErr, setInstallErr] = useState(""); // 第一次发消息时没能建好实例
  const [used, setUsed] = useState(!!bot);
  const [desktop, setDesktop] = useState(false);
  const [frame, setFrame] = useState(null); // 面板里的 iframe（Portal 渲染，ref 回调拿到）
  const ta = useRef(null);
  const bridge = useRef(null);
  const chat = useRef(null); // 对话页给的 { send(text) }：界面上的操作经它发出
  const busyRef = useRef(false); // 桥接的回调是接上时建的，读 busy 要用 ref
  const first = useRef(""); // 还没有实例时发的第一句，等对话页挂上再发
  const urlConfirming = useRef(false);
  // 桥接的回调要读到最新的状态
  const live = useRef(/** @type {any} */ ({}));
  live.current = { bot, entry, messages, used, desktop, expanded, onExpand };

  useEffect(() => {
    let alive = true;
    api("/status").then((s) => alive && setDesktop(!!s?.desktop)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 还没有实例时选的模型先记在这里，第一次发消息建好实例后写进对话（components/composer.js）
  const previewKey = `catalog:${catalogId}`;
  const readModel = (id) =>
    api(`/bots/${encodeURIComponent(id)}/chat/model`).then((d) => setConvModel(id, d.model)).catch(() => {});

  // 打开：有实例读实例，没有就只准备界面
  useEffect(() => {
    let alive = true;
    markCatalogSeen(catalogId);
    (async () => {
      try {
        if (bot) {
          const d = await api(`/bots/${encodeURIComponent(bot.id)}/app`);
          if (!alive) return;
          setEntry(d.bot || null);
          setBase(d.base);
          if (d.ref.removed?.security || !d.base) setUiFailed(true);
          // 有新版本就在打开时换上；正在工作或用户改过人设的由后端跳过
          if (d.updateAvailable && !d.bot?.isDev) {
            const r = await api(`/bots/${encodeURIComponent(bot.id)}/app/update`, { method: "POST", body: {} }).catch(() => null);
            if (r?.result === "updated" && alive) {
              const n = await api(`/bots/${encodeURIComponent(bot.id)}/app`);
              setBase(n.base);
              onBotUpdated?.();
            }
          }
        } else {
          const d = await api(`/catalog/${encodeURIComponent(catalogId)}/preview`, { method: "POST", body: {} });
          if (!alive) return;
          setEntry(d.bot);
          setBase(d.base);
        }
      } catch (e) {
        if (alive) setLoadErr(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [catalogId]);

  useEffect(() => onEntry?.(entry), [entry]);

  // 界面文案（ui/locales/<语言>.json）：缺了退回 en
  useEffect(() => {
    if (!base) return;
    let alive = true;
    const read = (l) => fetch(`${base}locales/${l}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    Promise.all([read("en"), read(lang)]).then(([en, cur]) => alive && setMessages({ ...en, ...cur }));
    return () => {
      alive = false;
    };
  }, [base, lang]);

  const envOf = () => {
    const { bot: b, entry: e, messages: m, desktop: d } = live.current;
    return { ...currentEnv(), expanded: !!live.current.expanded, sample: !b, desktop: !!d, messages: m || {}, bot: { id: b?.id || null, name: b?.name || tr(e?.name, lang) || "", avatar: e?.avatar || "" } };
  };

  /** 第一次发消息才创建实例 */
  const ensureInstance = async () => {
    if (live.current.bot) return live.current.bot;
    const d = await api(`/catalog/${encodeURIComponent(catalogId)}/install`, { method: "POST", body: {} });
    const picked = convModelOf(previewKey);
    if (picked) {
      await api(`/bots/${encodeURIComponent(d.bot.id)}/chat/model`, { method: "PUT", body: { model: picked } })
        .then(() => setConvModel(d.bot.id, picked))
        .catch(failed);
      setConvModel(previewKey, "");
    }
    live.current.bot = d.bot;
    onInstalled?.(d.bot);
    if (guide.get().trim) markSeen("first-bot");
    return d.bot;
  };

  /**
   * 发一句话：一律经对话页发出，出现在对话流里（流式回复、出错提示、重试、等你确认的卡片都在那里）。
   * 还没有实例时先建好实例，这一句记在 first 里，主区换成对话页后交给它（见下面的 effect）。返回发出去没有
   */
  const send = (text) => {
    const msg = String(text || "").trim();
    if (!msg) return false;
    if (live.current.bot && chat.current) return chat.current.send(msg);
    if (busyRef.current || first.current) return false;
    void install(msg);
    return true;
  };

  const install = async (msg) => {
    busyRef.current = true;
    setBusy(true);
    setInstallErr("");
    setUsed(true);
    first.current = msg;
    bridge.current?.post("turn", { busy: true });
    try {
      await ensureInstance();
      bridge.current?.post("env", envOf());
    } catch (e) {
      first.current = "";
      setInstallErr(errorText(e));
      bridge.current?.post("turn", { busy: false });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // 实例建好、主区换成了对话页（它在渲染时就填好了 chat）：把第一句交给它
  useEffect(() => {
    if (!bot || !first.current || !chat.current) return;
    const msg = first.current;
    first.current = "";
    chat.current.send(msg);
  }, [bot?.id]);
  // 对话页的回合开始、结束：照样告诉外壳（侧栏的"工作中"），也转告界面
  const onChatWorking = (id, on) => {
    chatProps?.onWorking?.(id, on);
    bridge.current?.post("turn", { busy: on });
  };

  const stop = () => {
    const b = live.current.bot;
    if (b) return api(`/conversations/${encodeURIComponent(`${b.id}:web:console`)}/stop`, { method: "POST", body: {} });
  };

  // 接上桥接：面板里的 iframe 换了（面板关上又打开）就重新接
  useEffect(() => {
    const el = frame;
    if (!el || !base || uiFailed) return;
    const fileApi = (path) => {
      const b = live.current.bot;
      const q = `file?path=${encodeURIComponent(path)}`;
      return api(b ? `/bots/${encodeURIComponent(b.id)}/app/${q}` : `/catalog/${encodeURIComponent(catalogId)}/${q}`);
    };
    const mediaHandles = new Set();
    const mediaAbort = new AbortController();
    let loadingMedia = 0;
    let mediaSeq = 0;
    const br = attachBridge(el, {
      init: () => envOf(),
      setExpanded: ({ expanded }) => {
        if (typeof expanded !== "boolean") throw new Error("invalid_expanded");
        if (expanded && navigator.userActivation && !navigator.userActivation.isActive) throw new Error("needs_user_gesture");
        live.current.onExpand?.(expanded);
        return true;
      },
      readFile: ({ path }) => fileApi(path),
      readImage: ({ path }) => {
        const b = live.current.bot;
        if (!b) throw new Error("no_instance");
        return api(`/bots/${encodeURIComponent(b.id)}/app/image?path=${encodeURIComponent(path)}`);
      },
      readMedia: async ({ path }) => {
        const b = live.current.bot;
        if (!b) throw new Error("no_instance");
        if (mediaHandles.size + loadingMedia >= 4) throw new Error("media_preview_limit");
        loadingMedia++;
        try {
          const r = await fetch(`/amb/api/bots/${encodeURIComponent(b.id)}/app/media?path=${encodeURIComponent(path)}`, { signal: mediaAbort.signal });
          if (!r.ok) throw new Error("media_not_found");
          const blob = await r.blob();
          if (mediaAbort.signal.aborted) throw new Error("media_preview_closed");
          // Blob URLs from this origin cannot be fetched by an opaque sandbox.
          // Structured-clone the Blob; kit.js creates its URL inside the iframe.
          const handle = String(++mediaSeq);
          mediaHandles.add(handle);
          return { blob, handle, size: blob.size };
        } finally {
          loadingMedia--;
        }
      },
      releaseMedia: ({ handle }) => {
        mediaHandles.delete(handle);
        return true;
      },
      // 只响应用户刚点过的操作：界面不能自己打开文件（点击的用户激活会传到父页面）
      openFile: async ({ path, reveal }) => {
        const b = live.current.bot;
        if (!b) throw new Error("no_instance");
        if (navigator.userActivation && !navigator.userActivation.isActive) throw new Error("needs_user_gesture");
        if (!reveal && openResource(appFileResource(path, b.id, live.current.desktop))) return { ok: true };
        const id = encodeURIComponent(b.id);
        if (live.current.desktop) return api(`/bots/${id}/app/open`, { method: "POST", body: { path, reveal: !!reveal } });
        window.open(`/amb/api/bots/${id}/app/download?path=${encodeURIComponent(path)}`, "_blank", "noopener");
        return { ok: true };
      },
      // 外部链接：地址可能来自网页内容，打开前让用户看清楚。同一时间只有一个确认框，界面刷不出一串弹窗
      openUrl: async ({ url }) => {
        const safe = safeExternalUrl(url);
        if (!safe) throw new Error("invalid_url");
        if (urlConfirming.current) return false;
        urlConfirming.current = true;
        try {
          const ok = await confirmSheet({ title: t("botapp.app.openUrlTitle"), body: safe, confirmLabel: t("botapp.app.openUrlConfirm") });
          if (ok && !openResource(websiteResource(safe))) window.open(safe, "_blank", "noopener,noreferrer");
          return !!ok;
        } finally {
          urlConfirming.current = false;
        }
      },
      send: ({ text, action }) => {
        // 界面上的操作以用户的身份发给 Bot（约定在 botkit/app-skill.ts）
        const line = action ? `[ui-action] ${JSON.stringify(action)}${text ? `\n${text}` : ""}` : text;
        return send(line);
      },
      stop,
      subscribe: () => true,
      pickFile: async (opts) => {
        const picked = await pickFiles(opts);
        if (!picked.length) return [];
        const b = await ensureInstance();
        return Promise.all(picked.map(async (f) => ({ name: f.name, size: f.size, ...(await api(`/bots/${encodeURIComponent(b.id)}/app/inbox`, { method: "POST", body: { name: f.name, base64: f.base64 } })) })));
      },
      openChannels: () => onOpenSettings?.("connections"),
      reportError: ({ message }) => {
        console.error("bot ui error", catalogId, message);
        setUiFailed(true);
      },
      rendered: () => true,
    });
    bridge.current = br;
    const offEnv = watchEnv(() => br.post("env", envOf()));
    return () => {
      br.close();
      offEnv();
      bridge.current = null;
      mediaAbort.abort();
      mediaHandles.clear();
    };
  }, [frame, base, uiFailed]);

  // 文案读到之后、知道是不是桌面版之后再告诉界面一次
  useEffect(() => {
    if (messages) bridge.current?.post("env", envOf());
  }, [messages, desktop, expanded]);

  // app/ 下的文件变了（Bot 改的，包括微信里改的）：转告界面
  const botId = bot?.id;
  useEffect(() => {
    if (botId) void readModel(botId);
  }, [botId]);
  useEffect(() => {
    if (!botId) return;
    const ac = new AbortController();
    watchApp(botId, { file: (d) => bridge.current?.post("file", d) }, ac.signal).catch(() => {});
    return () => ac.abort();
  }, [botId]);

  // 第一次真正用完离开时说一句（全局只说一次）
  useEffect(
    () => () => {
      if (live.current.used && live.current.bot && !guide.get().seen.includes("botapp-kept")) {
        markSeen("botapp-kept");
        toast(t("botapp.tip.kept", { name: live.current.bot.name }));
      }
    },
    [],
  );

  const starters = (entry && tr(entry.starters, lang)) || [];
  const name = bot?.name || tr(entry?.name, lang) || "";
  const removed = bot?.app?.removed;
  const submit = () => {
    const v = draft;
    if (!v.trim() || busy) return;
    setDraft("");
    void send(v);
    requestAnimationFrame(() => autoGrow(ta.current));
  };
  // 工作台标签里的东西：下架 / 界面出错的提示、界面本身、加载中
  const stage = html`<div class="work-app">
    ${removed && html`<${Notice} tone="amber">${t(removed.security ? "botapp.app.removedSecurity" : "botapp.app.removed")}<//>`}
    ${uiFailed && !removed && html`<${Notice} tone="amber">${t("botapp.app.uiFailed")}<//>`}
    ${loadErr && bot && html`<${Notice} tone="red">${loadErr}<//>`}
    ${base && !uiFailed && html`<iframe ref=${setFrame} class="botapp-frame" title=${name} src=${`${base}index.html`} sandbox="allow-scripts allow-forms"></iframe>`}
    ${!base && !loadErr && !uiFailed && html`<div class="botapp-loading"><${Spinner} /></div>`}
  </div>`;
  const portal = html`<${Portal} into=${frameHost}>${stage}<//>`;
  if (bot) {
    return html`<${ChatScreen} key=${bot.id} bot=${bot} ...${chatProps} onWorking=${onChatWorking} ctl=${chat} starters=${starters}
        infoOpen=${panelOpen} onToggleInfo=${onTogglePanel} />
      ${portal}`;
  }
  return html`<section class="botapp" data-screen="bot-app" aria-label=${name}>
      <header class="chat-head">
        <span class="head-bot static">${entry && html`<${BotAvatar} char=${entry.avatar} size=${22} />`}<span class="name">${name}</span></span>
        ${entry && html`<span class="botapp-sample">${t("botapp.app.sample")}</span>`}
        <span class="grow"></span>
        <${IconButton} icon="panel" iconSize="md" label=${t("chat.infoPanel")} on=${panelOpen} aria-pressed=${panelOpen} onClick=${onTogglePanel} />
      </header>
      ${loadErr && html`<${Notice} tone="red">${loadErr}<//>`}
      ${entry ? html`<${BotIntro} entry=${entry} lang=${lang} busy=${busy} onSend=${send} />` : html`<div class="botapp-loading">${!loadErr && html`<${Spinner} />`}</div>`}
      <div class="botapp-dock">
        ${installErr && html`<${Notice} tone="red">${installErr}<//>`}
        <${Composer} bot=${null} modelKey=${previewKey} text=${draft} setText=${setDraft} taRef=${ta} showPerm=${false}
          placeholder=${t("botapp.app.placeholder")} label=${t("botapp.app.placeholder")} generating=${busy} sent=${used}
          onSend=${(raw) => (raw === undefined ? submit() : send(raw))} onStop=${stop}
          models=${chatProps?.models} modelsError=${chatProps?.modelsError} reloadModels=${chatProps?.reloadModels} defaultModel=${chatProps?.defaultModel}
          account=${chatProps?.account} onAccount=${chatProps?.onAccount} onBotUpdated=${chatProps?.onBotUpdated} onOpenBotSettings=${onOpenBotSettings} />
      </div>
    </section>
    ${portal}`;
}
