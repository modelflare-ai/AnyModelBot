// 影视创作室：面板中用项目选择器，展开后显示项目列表；主要页面是分镜、剧本、资产、成片。
// 分镜以当前画面为中心，下方切换镜头；描述、版本按需展开。画布与制作设置从工具栏进入。
// 分镜页只放一个"下一步"主按钮（按进度算：生成分镜 → 补图 → 补视频 → 配音 → 合成），其余操作收进"更多"。
// 数据都来自 app/state.json 和它指向的项目、分集文件，改数据都交给 Bot（send）。
import { Workspace, html, mount, useBot, useEffect, useRef, useState, Button, Field, Notice, Empty } from "/amb/botapp/kit/kit.js";
import { STYLES } from "./styles.js";
import { CANVAS, dragPosition, fitCanvas, limitZoom } from "./canvas-layout.js";

const TABS = ["storyboard", "script", "assets", "exports"];
const types = ["character", "scene", "prop", "material", "voice", "image", "video", "audio"];
const activeMedia = (o, k) => (o.media?.[k] || []).find((m) => m.id === o.selectedMedia?.[k]) || o.media?.[k]?.at(-1);
const newId = () => `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function Select({ label, value, options, onChange }) {
  return html`<label class="kit-field"><span class="t-label">${label}</span><select class="field" value=${value} onChange=${(e) => onChange(e.target.value)}>${options.map(([id, title]) => html`<option value=${id}>${title}</option>`)}</select></label>`;
}
function Text({ label, value, onChange, rows = 5 }) {
  return html`<label><span class="t-label">${label}</span><textarea class="field" rows=${rows} value=${value} onInput=${(e) => onChange(e.target.value)} /></label>`;
}
function useDocument(bot, path, revision, fallback) {
  const [doc, set] = useState({ data: fallback || null, error: "" });
  useEffect(() => {
    let alive = true;
    if (bot.sample || !path) { set({ data: fallback || null, error: "" }); return; }
    set({ data: null, error: "" });
    bot.readFile(path).then((f) => {
      const data = f.json || JSON.parse(f.text);
      if (alive) set({ data, error: "" });
    }).catch((e) => alive && set({ data: null, error: String(e.message) }));
    return () => { alive = false; };
  }, [path, revision, bot.sample]);
  return doc;
}

function Preview({ bot, file, kind = "image" }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setPlaying(false); setError(""); setUrl(""); }, [file]);
  useEffect(() => {
    if (!file || (kind !== "image" && !playing)) return;
    let alive = true, mediaUrl = "";
    if (bot.sample) { if (file.startsWith("./")) setUrl(file); return; }
    const request = kind === "image" ? bot.readImage(file) : bot.readMedia(file);
    request.then((r) => {
      if (kind !== "image") mediaUrl = r.url;
      if (alive) setUrl(r.url);
      else if (mediaUrl) bot.releaseMedia(mediaUrl).catch(() => {});
    }).catch(() => alive && setError(bot.t("previewError")));
    return () => { alive = false; if (mediaUrl) bot.releaseMedia(mediaUrl).catch(() => {}); };
  }, [file, kind, playing, bot.sample]);
  if (!file) return null;
  return html`<div class=${`pf-preview ${kind}`}>
    ${url && (kind === "image" ? html`<img src=${url} alt=${bot.t("preview")} loading="lazy" />` : kind === "audio" ? html`<audio src=${url} controls preload="metadata" />` : html`<video src=${url} controls preload="metadata" playsinline />`)}
    ${error && html`<p class="pf-error">${error}</p>`}
    ${(kind !== "image" || !bot.sample) && html`<div class="pf-actions">
      ${kind !== "image" && html`<${Button} class="sm" onClick=${() => { setPlaying(!playing); if (playing) setUrl(""); }}>${bot.t(playing ? "closePreview" : `play.${kind}`)}<//>`}
      ${!bot.sample && html`<${Button} class="sm ghost" onClick=${() => bot.openFile(file).catch((e) => setError(e.message))}>${bot.t("download")}<//>`}
    </div>`}
  </div>`;
}

/** 缩略图：示例里的图在界面包里（./samples/…），其余的从工作区读 */
function useImage(bot, path) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!path) return undefined;
    if (bot.sample) { if (path.startsWith("./")) setUrl(path); return undefined; }
    let alive = true;
    bot.readImage(path).then((r) => alive && setUrl(r.url)).catch(() => {});
    return () => { alive = false; };
  }, [path, bot.sample]);
  return url;
}

/** "更多"菜单：点外面或选了一项就收起 */
function Menu({ label, items, disabled }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return html`<details class="pf-menu" ref=${ref} onKeyDown=${(e) => {
    if (e.key === "Escape" && ref.current.open) { e.preventDefault(); e.stopPropagation(); ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
  }}>
    <summary class=${`btn${disabled ? " is-disabled" : ""}`}>${label}</summary>
    <div class="pf-menu-list" role="menu">
      ${items.filter(Boolean).map((it) => html`<button type="button" role="menuitem" disabled=${it.disabled} onClick=${() => { ref.current.open = false; it.run(); }}>${it.label}</button>`)}
    </div>
  </details>`;
}

function NewProject({ bot, send, close }) {
  const [form, set] = useState({ kind: "short", title: "", source: "" });
  const edit = (k, v) => set((x) => ({ ...x, [k]: v }));
  return html`<section class="pf-form pf-narrow">
    <div class="kit-tabs" role="tablist" aria-label=${bot.t("kind")}>${["short", "drama", "canvas"].map((k) => html`<button type="button" role="tab" aria-selected=${form.kind === k} onClick=${() => edit("kind", k)}>${bot.t(`kind.${k}`)}</button>`)}</div>
    <${Field} label=${bot.t("title")} value=${form.title} onInput=${(e) => edit("title", e.target.value)} />
    <${Text} label=${bot.t("source")} value=${form.source} onChange=${(v) => edit("source", v)} />
    <div class="pf-actions"><${Button} primary disabled=${bot.busy || !form.title.trim()} onClick=${() => { send("create", { ...form, settings: { language: bot.lang } }, false); close(); }}>${bot.t("create")}<//>${close && html`<${Button} class="ghost" onClick=${close}>${bot.t("close")}<//>`}</div>
  </section>`;
}

function Script({ bot, project: p, episode: ep, send }) {
  const [source, setSource] = useState(p.source);
  const [body, setBody] = useState(ep?.content || "");
  const [title, setTitle] = useState(ep?.title || "");
  const [summary, setSummary] = useState(ep?.summary || "");
  return html`<div class="pf-columns">
    <section class="pf-form"><h2 class="t-label">${bot.t("story")}</h2>
      <${Text} label=${bot.t("source")} value=${source} onChange=${setSource} rows=${8} />
      <div class="pf-actions"><${Button} disabled=${bot.busy} onClick=${() => send("apply", { source })}>${bot.t("save")}<//>
        <${Menu} label=${bot.t("more")} disabled=${bot.busy} items=${["summary", "outline", "scripts", "extractAssets"].map((action) => ({ label: bot.t(action), disabled: bot.busy, run: () => send(action) }))} /></div>
      ${Object.entries(p.summary || {}).filter(([, v]) => typeof v === "string").map(([k, v]) => html`<p class="pf-script" key=${k}>${v}</p>`)}
    </section>
    <section class="pf-form"><h2 class="t-label">${bot.t("episode")}</h2>
      ${ep ? html`<${Field} label=${bot.t("title")} value=${title} onInput=${(e) => setTitle(e.target.value)} />
        <${Text} label=${bot.t("episodeSummary")} value=${summary} onChange=${setSummary} rows=${3} />
        <${Text} label=${bot.t("screenplay")} value=${body} onChange=${setBody} rows=${14} />
        <div class="pf-actions"><${Button} primary disabled=${bot.busy} onClick=${() => send("apply", { episode: { title, content: body, summary } })}>${bot.t("save")}<//>
        ${["script", "optimize", "storyboard"].map((action) => html`<${Button} disabled=${bot.busy} onClick=${() => send(action)}>${bot.t(action)}<//>`)}</div>` : html`<${Empty}>${bot.t("noEpisode")}<//>`}
    </section>
  </div>`;
}

function TakePicker({ bot, obj, kind, send }) {
  const versions = obj.media?.[kind] || [];
  if (versions.length < 2) return null;
  return html`<${Select} label=${bot.t("takes")} value=${activeMedia(obj, kind)?.id || ""} options=${versions.map((v, i) => [v.id, `${i + 1} · ${v.model} · ${v.at}`])} onChange=${(id) => send("select-media", { target: obj.id, kind, id })} />`;
}

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const LANES = [["image", "lane.image"], ["video", "lane.video"], ["audio", "lane.audio"]];

/** 下一步该做什么：没有分镜就生成分镜，然后补图、补视频（静图成片不用）、配音（独立配音才要），最后合成。有中断的任务先恢复 */
function nextStep(p, ep) {
  if (!ep) return null;
  if ((p.jobs || []).some((j) => j.status === "interrupted")) return "resume";
  const shots = ep.shots || [];
  if (!shots.length) return "storyboard";
  if (shots.some((s) => !activeMedia(s, "image"))) return "images";
  if (p.settings?.mode !== "image_text" && shots.some((s) => !activeMedia(s, "video"))) return "videos";
  if (p.settings?.audioMode === "tts" && shots.some((s) => !activeMedia(s, "audio"))) return "voices";
  return "compose";
}

function Segment({ bot, shot: s, index, start, on, onPick }) {
  const url = useImage(bot, activeMedia(s, "image")?.path);
  return html`<button type="button" class=${`pf-seg${on ? " on" : ""}`} aria-current=${on ? "true" : undefined} style=${{ "--d": Math.max(1, Number(s.duration) || 1) }} onClick=${onPick} title=${s.title}>
    <span class="pf-seg-time">${fmtTime(start)}</span>
    <span class="pf-seg-img">${url ? html`<img src=${url} alt="" />` : html`<span class="pf-seg-none">${index + 1}</span>`}</span>
    <span class="pf-seg-name"><strong>${index + 1}</strong> ${s.title || bot.t("shot")}<span class="pf-seg-dur">${s.duration}s</span></span>
    <span class="pf-lanes" aria-hidden="true">${LANES.map(([k]) => html`<i key=${k} class=${activeMedia(s, k) ? "has" : ""}></i>`)}</span>
  </button>`;
}

/** 时间轴：每个镜头一段，宽度跟着时长走，底下三个小格是画面 / 视频 / 声音有没有做好 */
function Timeline({ bot, shots, selected, onPick }) {
  let t = 0;
  return html`<div class="pf-timeline" role="list" aria-label=${bot.t("timeline")}>
    ${shots.map((s, i) => {
      const start = t;
      t += Number(s.duration) || 0;
      return html`<${Segment} key=${s.id} bot=${bot} shot=${s} index=${i} start=${start} on=${s.id === selected} onPick=${() => onPick(s.id)} />`;
    })}
  </div>`;
}

const dialogueOf = (s) => (s.dialogue || []).map((d) => (typeof d === "string" ? d : [d.speaker || d.character || d.role, d.text || d.line || d.content].filter(Boolean).join("："))).filter(Boolean);

function SheetFrame({ bot, shot }) {
  const url = useImage(bot, activeMedia(shot, "image")?.path);
  return html`<span class="pf-sheet-img">${url ? html`<img src=${url} alt="" />` : null}</span>`;
}

/**
 * 分镜表：行业里常用的那种表——镜号、画面、起止时间、旁白和台词、画面描述、素材做到哪了。
 * 懂行的人一眼看全片的节奏和缺口；点一行，下面照样是这一镜的预览和操作。
 */
function Sheet({ bot, shots, selected, onPick }) {
  let at = 0;
  return html`<div class="pf-sheet-wrap"><table class="pf-sheet">
    <thead><tr>
      <th class="num">${bot.t("sheet.no")}</th><th>${bot.t("sheet.frame")}</th><th class="num">${bot.t("sheet.time")}</th>
      <th>${bot.t("sheet.words")}</th><th>${bot.t("sheet.visual")}</th><th>${bot.t("sheet.media")}</th>
    </tr></thead>
    <tbody>${shots.map((s, i) => {
      const start = at;
      at += Number(s.duration) || 0;
      const words = [s.narration, ...dialogueOf(s)].filter(Boolean);
      return html`<tr key=${s.id} class=${s.id === selected ? "on" : ""} aria-selected=${s.id === selected} tabindex="0" onClick=${() => onPick(s.id)} onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(s.id))}>
        <td class="num pf-sheet-no">${i + 1}</td>
        <td><${SheetFrame} bot=${bot} shot=${s} /></td>
        <td class="num">${fmtTime(start)}<span class="pf-meta">${s.duration}s</span></td>
        <td><strong>${s.title || bot.t("shot")}</strong>${words.map((w, n) => html`<p key=${n}>${w}</p>`)}</td>
        <td class="pf-meta">${s.visualPrompt}</td>
        <td><span class="pf-sheet-media">${LANES.map(([k, label]) => html`<span key=${k} class=${`badge ${activeMedia(s, k) ? "ok" : "off"}`}>${bot.t(label)}</span>`)}</span></td>
      </tr>`;
    })}</tbody>
  </table></div>`;
}

function ShotEditor({ bot, shot: s, project: p, send, done }) {
  const [draft, setDraft] = useState({ title: s.title, narration: s.narration, visualPrompt: s.visualPrompt, videoPrompt: s.videoPrompt, segmentScript: s.segmentScript, duration: s.duration, assetIds: s.assetIds });
  const change = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return html`<div class="pf-form pf-editor">
    <div class="pf-two"><${Field} label=${bot.t("title")} value=${draft.title} onInput=${(e) => change("title", e.target.value)} />
      <${Field} label=${bot.t("duration")} type="number" value=${draft.duration} onInput=${(e) => change("duration", Number(e.target.value))} /></div>
    ${["narration", "visualPrompt", "videoPrompt", "segmentScript"].map((k) => html`<${Text} key=${k} label=${bot.t(k)} value=${draft[k]} onChange=${(v) => change(k, v)} rows=${3} />`)}
    ${p.assets.length > 0 && html`<fieldset class="pf-refs"><legend class="t-label">${bot.t("references")}</legend>
      ${p.assets.map((a) => html`<label key=${a.id}><input type="checkbox" checked=${draft.assetIds.includes(a.id)} onChange=${(e) => change("assetIds", e.target.checked ? [...draft.assetIds, a.id] : draft.assetIds.filter((id) => id !== a.id))} /> ${a.name}</label>`)}
    </fieldset>`}
    ${["image", "video", "audio"].map((k) => html`<${TakePicker} key=${k} bot=${bot} obj=${s} kind=${k} send=${send} />`)}
    <div class="pf-actions"><${Button} primary disabled=${bot.busy || s.locked} onClick=${() => { send("apply", { shots: [{ id: s.id, ...draft }] }); done(); }}>${bot.t("save")}<//><${Button} class="ghost" onClick=${done}>${bot.t("close")}<//></div>
  </div>`;
}

/** 选中的镜头：左边预览（有视频看视频，没有看画面），右边文字和这一镜的操作 */
function ShotDetail({ bot, shot: s, project: p, episode: ep, index, send, navigation }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [s.id]);
  const video = activeMedia(s, "video");
  const audio = activeMedia(s, "audio");
  const move = (delta) => {
    const ids = ep.shots.map((x) => x.id), at = index + delta;
    [ids[index], ids[at]] = [ids[at], ids[index]];
    send("apply", { order: ids });
  };
  const refs = p.assets.filter((a) => s.assetIds?.includes(a.id)).map((a) => a.name);
  const jobs = (p.jobs || []).filter((j) => j.target === s.id && j.episodeId === ep.id && ["running", "interrupted", "failed"].includes(j.status));
  return html`<section class="pf-detail" aria-label=${s.title}>
    <div class="pf-detail-media">
      ${video ? html`<${Preview} bot=${bot} kind="video" file=${video.path} />` : activeMedia(s, "image") ? html`<${Preview} bot=${bot} file=${activeMedia(s, "image").path} />` : html`<div class="pf-preview pf-blank">${bot.t("noImage")}</div>`}
      ${audio && html`<${Preview} bot=${bot} kind="audio" file=${audio.path} />`}
      <header class="pf-detail-head"><h2 class="t-title">${index + 1}. ${s.title || bot.t("shot")}</h2><span class="t-meta">${s.duration}s${s.locked ? ` · ${bot.t("locked")}` : ""}</span></header>
      ${navigation}
    </div>
    <div class="pf-detail-text">
      <details class="pf-fold"><summary>${bot.t("shotDetails")}</summary><div class="pf-form">
        ${s.narration && html`<p class="pf-quote">${s.narration}</p>`}
        ${s.visualPrompt && html`<p class="pf-meta">${s.visualPrompt}</p>`}
        ${refs.length > 0 && html`<p class="pf-meta">${bot.t("references")}：${refs.join("、")}</p>`}
        <${Button} class="ghost" disabled=${bot.busy || s.locked} onClick=${() => setEditing(!editing)}>${bot.t(editing ? "close" : "edit")}<//>
      </div></details>
      ${LANES.some(([k]) => (s.media?.[k]?.length || 0) > 1) && html`<details class="pf-fold"><summary>${bot.t("takes")}</summary><div class="pf-form">
        ${LANES.map(([k]) => html`<${TakePicker} key=${k} bot=${bot} obj=${s} kind=${k} send=${send} />`)}
      </div></details>`}
      <ul class="pf-status">${LANES.map(([k, label]) => html`<li key=${k} class=${activeMedia(s, k) ? "has" : ""}><span class=${`badge ${activeMedia(s, k) ? "ok" : "off"}`}>${bot.t(label)}</span></li>`)}</ul>
      ${jobs.length > 0 && html`<div class="pf-list" aria-label=${bot.t("jobs")}>${jobs.map((j) => html`<article key=${j.id}>
        <span class=${`badge ${j.status === "failed" ? "err" : "warn"}`}>${bot.t(`media.${j.kind}`)} · ${bot.t(`status.${j.status}`)}</span>
        ${j.error && html`<p class="pf-error">${j.error}</p>`}
        ${j.status === "interrupted" && html`<${Button} class="sm" disabled=${bot.busy} onClick=${() => send("resume", { jobId: j.id }, false)}>${bot.t("resume")}<//>`}
      </article>`)}</div>`}
      <div class="pf-actions">
        <${Button} disabled=${bot.busy || s.locked} onClick=${() => send("image", { target: s.id, regenerate: true })}>${bot.t(activeMedia(s, "image") ? "regen.image" : "generate.image")}<//>
        ${p.settings?.mode !== "image_text" && html`<${Button} disabled=${bot.busy || s.locked} onClick=${() => send("video", { target: s.id, regenerate: true })}>${bot.t(video ? "regen.video" : "generate.video")}<//>`}
        <${Menu} label=${bot.t("more")} items=${[
          { label: bot.t("edit"), run: () => setEditing(true) },
          { label: bot.t("generate.voice"), disabled: bot.busy || s.locked, run: () => send("voice", { target: s.id, regenerate: true }) },
          { label: bot.t(s.locked ? "unlock" : "lock"), disabled: bot.busy, run: () => send("apply", { shots: [{ id: s.id, locked: !s.locked }] }) },
          { label: bot.t("earlier"), disabled: bot.busy || index === 0, run: () => move(-1) },
          { label: bot.t("later"), disabled: bot.busy || index === ep.shots.length - 1, run: () => move(1) },
          { label: bot.t("importMedia"), disabled: bot.busy, run: async () => { const files = await bot.pickFile({ accept: "image/*,video/*,audio/*", multiple: true }); if (files.length) send("importMedia", { target: s.id, files }); } },
          { label: bot.t("removeShot"), disabled: bot.busy || s.locked, run: () => send("apply", { removeShot: s.id }) },
        ]} />
      </div>
      ${editing && html`<${ShotEditor} key=${`${s.id}:${ep.revision}`} bot=${bot} shot=${s} project=${p} send=${send} done=${() => setEditing(false)} />`}
    </div>
  </section>`;
}

function Storyboard({ bot, project: p, episode: ep, send }) {
  const shots = ep?.shots || [];
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState("timeline");
  const index = Math.max(0, shots.findIndex((s) => s.id === selected));
  const shot = shots[index];
  const next = nextStep(p, ep);
  const total = shots.reduce((n, s) => n + (Number(s.duration) || 0), 0);
  const all = ["storyboard", "images", "videos", "voices", "resume", "compose"].filter((a) => a !== next);
  const navigation = shots.length > 0 && html`<div class="pf-shot-navigation">
    <div class="pf-row"><span class="t-meta">${bot.t("shotsTotal", { count: shots.length, time: fmtTime(total) })}</span><span class="grow"></span>
      <div class="kit-tabs" role="tablist" aria-label=${bot.t("view.label")}>${[["timeline", "view.timeline"], ["sheet", "view.sheet"]].map(([id, key]) => html`<button type="button" key=${id} role="tab" aria-selected=${mode === id} onClick=${() => setMode(id)}>${bot.t(key)}</button>`)}</div>
    </div>
    ${mode === "sheet" ? html`<${Sheet} bot=${bot} shots=${shots} selected=${shot?.id} onPick=${setSelected} />` : html`<${Timeline} bot=${bot} shots=${shots} selected=${shot?.id} onPick=${setSelected} />`}
  </div>`;
  return html`<div class="pf-stack">
    ${shots.length
      ? html`<${ShotDetail} key=${shot.id} bot=${bot} shot=${shot} index=${index} project=${p} episode=${ep} send=${send} navigation=${navigation} />`
      : html`<${Empty}>${bot.t(ep ? "noShots" : "noEpisode")}<//>`}
    <div class="pf-row pf-next">
      ${next && html`<${Button} primary disabled=${bot.busy} onClick=${() => send(next)}>${bot.t(next)}<//>`}
      <${Menu} label=${bot.t("more")} disabled=${!ep} items=${[
        ...all.map((a) => ({ label: bot.t(a), disabled: bot.busy || !ep, run: () => send(a) })),
        { label: bot.t("addShot"), disabled: bot.busy || !ep, run: () => send("apply", { shots: [{ title: bot.t("shot"), duration: 8 }] }) },
      ]} />
    </div>
  </div>`;
}

function AssetCard({ bot, asset: a, editing, onEdit, send, revision }) {
  const url = useImage(bot, activeMedia(a, "image")?.path);
  return html`<article class=${`pf-asset${editing ? " on" : ""}`}>
    <button type="button" class="pf-asset-img" onClick=${onEdit} aria-label=${bot.t("edit")}>${url ? html`<img src=${url} alt="" />` : html`<span class="pf-initial">${Array.from(a.name || "?")[0]}</span>`}</button>
    <div class="pf-asset-text"><strong>${a.name}</strong><span class="pf-meta">${bot.t(`asset.${a.type}`)}</span>${a.prompt && html`<p class="pf-meta pf-clamp">${a.prompt}</p>`}</div>
    <div class="pf-actions">
      <${Button} class="sm" disabled=${bot.busy} onClick=${() => send("image", { target: a.id, regenerate: true }, false)}>${bot.t(url ? "regen.image" : "generate.image")}<//>
      <${Menu} label=${bot.t("more")} items=${[
        { label: bot.t("edit"), run: onEdit },
        { label: bot.t("generate.video"), disabled: bot.busy, run: () => send("video", { target: a.id, regenerate: true }, false) },
        { label: bot.t("generate.voice"), disabled: bot.busy, run: () => send("voice", { target: a.id, regenerate: true }, false) },
        { label: bot.t("importMedia"), disabled: bot.busy, run: async () => { const files = await bot.pickFile({ accept: "image/*,video/*,audio/*", multiple: true }); if (files.length) send("importMedia", { target: a.id, files }, false); } },
        { label: bot.t("toLibrary"), disabled: bot.busy, run: () => send("library", { action: "publish", target: a.id }, false) },
      ]} />
    </div>
    ${editing && html`<${AssetEditor} key=${`${a.id}:${revision}`} bot=${bot} asset=${a} send=${send} />
      ${["image", "video", "audio"].map((k) => html`<${Preview} key=${`p${k}`} bot=${bot} kind=${k} file=${k === "image" ? "" : activeMedia(a, k)?.path} />`)}
      ${["image", "video", "audio"].map((k) => html`<${TakePicker} key=${`t${k}`} bot=${bot} obj=${a} kind=${k} send=${(x, d) => send(x, d, false)} />`)}`}
  </article>`;
}

function Assets({ bot, project: p, send }) {
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState("");
  const [library, setLibrary] = useState(null);
  const present = types.filter((k) => p.assets.some((a) => a.type === k));
  return html`<div class="pf-stack">
    <div class="pf-row">
      <${Button} primary onClick=${() => setEdit(edit === "new" ? "" : "new")}>${bot.t("addAsset")}<//>
      <${Menu} label=${bot.t("more")} items=${[
        { label: bot.t("extractAssets"), disabled: bot.busy, run: () => send("extractAssets", {}, false) },
        { label: bot.t("library"), disabled: bot.sample, run: () => bot.readFile("app/printfilm/library.json").then((f) => setLibrary(f.json || JSON.parse(f.text))).catch(() => setLibrary({ assets: [] })) },
      ]} />
      <span class="grow"></span>
      ${present.length > 1 && html`<div class="kit-tabs" role="tablist" aria-label=${bot.t("filter")}>${[["", bot.t("all")], ...present.map((k) => [k, bot.t(`asset.${k}`)])].map(([k, label]) => html`<button type="button" key=${k} role="tab" aria-selected=${filter === k} onClick=${() => setFilter(k)}>${label}</button>`)}</div>`}
    </div>
    ${edit === "new" && html`<section class="pf-panel"><${AssetEditor} bot=${bot} send=${send} /></section>`}
    ${library && html`<section class="pf-panel"><h2 class="t-label">${bot.t("library")}</h2><div class="pf-actions">${library.assets.map((a) => html`<${Button} class="sm" disabled=${bot.busy} onClick=${() => send("library", { action: "import", id: a.libraryId }, false)}>${a.name} · ${bot.t("import")}<//>`)}</div>${!library.assets.length && html`<p class="pf-meta">${bot.t("empty")}</p>`}</section>`}
    <div class="pf-assets">${p.assets.filter((a) => !filter || a.type === filter).map((a) => html`<${AssetCard} key=${a.id} bot=${bot} asset=${a} revision=${p.revision} editing=${edit === a.id} onEdit=${() => setEdit(edit === a.id ? "" : a.id)} send=${send} />`)}</div>
    ${!p.assets.length && html`<${Empty}>${bot.t("noAssets")}<//>`}
  </div>`;
}

function AssetEditor({ bot, asset, send }) {
  const [draft, set] = useState(asset || { type: "character", name: "", prompt: "", voice: "" });
  const change = (k, v) => set((s) => ({ ...s, [k]: v }));
  return html`<div class="pf-form pf-editor">
    <${Select} label=${bot.t("kind")} value=${draft.type} options=${types.map((k) => [k, bot.t(`asset.${k}`)])} onChange=${(v) => change("type", v)} />
    <${Field} label=${bot.t("name")} value=${draft.name} onInput=${(e) => change("name", e.target.value)} />
    <${Text} label=${bot.t("description")} value=${draft.prompt} onChange=${(v) => change("prompt", v)} />
    <${Field} label=${bot.t("voiceId")} value=${draft.voice} onInput=${(e) => change("voice", e.target.value)} />
    <${Button} disabled=${bot.busy || !draft.name} onClick=${() => send("apply", { assets: [{ ...(asset ? { id: asset.id } : {}), type: draft.type, name: draft.name, prompt: draft.prompt, voice: draft.voice }] }, false)}>${bot.t("save")}<//>
  </div>`;
}

function Canvas({ bot, project: p, episode: ep, send }) {
  const [canvas, set] = useState(p.canvas);
  const [selected, setSelected] = useState("");
  const [linkFrom, setLinkFrom] = useState("");
  const drag = useRef(null);
  const viewport = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(null);
  useEffect(() => {
    const el = viewport.current;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = zoom ?? fitCanvas(size.width, size.height);
  const add = (label, ref) => set((c) => ({ ...c, nodes: [...c.nodes, { id: newId(), label, x: 30 + (c.nodes.length % 5) * 220, y: 40 + Math.floor(c.nodes.length / 5) * 150, ...ref }] }));
  const pointerDown = (e, n) => {
    setSelected(n.id);
    if (linkFrom && linkFrom !== n.id) {
      set((c) => ({ ...c, edges: [...c.edges.filter((x) => !(x.from === linkFrom && x.to === n.id)), { from: linkFrom, to: n.id }] }));
      setLinkFrom(""); return;
    }
    drag.current = { id: n.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y, scale };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const pointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const position = dragPosition({ x: d.ox, y: d.oy }, e.clientX - d.x, e.clientY - d.y, d.scale);
    set((c) => ({ ...c, nodes: c.nodes.map((n) => n.id === d.id ? { ...n, ...position } : n) }));
  };
  return html`<div class="pf-stack"><h2 class="t-label">${bot.t("tab.canvas")}</h2><div class="pf-row">
    <${Button} primary disabled=${bot.busy} onClick=${() => send("runCanvas", { canvas })}>${bot.t("runCanvas")}<//>
    <${Button} disabled=${bot.busy} onClick=${() => send("apply", { canvas })}>${bot.t("saveCanvas")}<//>
    <${Menu} label=${bot.t("addNode")} items=${[
      ...p.assets.map((a) => ({ label: `${bot.t(`asset.${a.type}`)} · ${a.name}`, run: () => add(a.name, { assetId: a.id }) })),
      ...(ep?.shots || []).map((s, i) => ({ label: `${bot.t("shot")} ${i + 1} · ${s.title}`, run: () => add(`${i + 1}. ${s.title}`, { episodeId: ep.id, shotId: s.id }) })),
    ]} />
    <span class="grow"></span>
    <${Button} class="ghost" disabled=${!selected} onClick=${() => setLinkFrom(selected)}>${bot.t(linkFrom ? "pickTarget" : "connect")}<//>
    <${Button} class="ghost" disabled=${!selected} onClick=${() => { set((c) => ({ nodes: c.nodes.filter((n) => n.id !== selected), edges: c.edges.filter((e) => e.from !== selected && e.to !== selected) })); setSelected(""); }}>${bot.t("removeNode")}<//>
  </div><div class="pf-row pf-canvas-tools">
    <button type="button" class="btn ghost sm" aria-label=${bot.t("canvas.zoomOut")} onClick=${() => setZoom(limitZoom(scale - 0.1))}>−</button>
    <span class="t-meta num">${Math.round(scale * 100)}%</span>
    <button type="button" class="btn ghost sm" aria-label=${bot.t("canvas.zoomIn")} onClick=${() => setZoom(limitZoom(scale + 0.1))}>+</button>
    <${Button} class="sm ghost" onClick=${() => { setZoom(null); viewport.current.scrollTo(0, 0); }}>${bot.t("canvas.fit")}<//>
    <span class="grow"></span><${Button} class="sm ghost" onClick=${() => bot.setExpanded(!bot.expanded)}>${bot.t(bot.expanded ? "canvas.restore" : "canvas.expand")}<//>
  </div><p class="kit-foot">${bot.t("canvasHelp")}</p><div class="pf-canvas-scroll" ref=${viewport}>
    <div class="pf-canvas-stage" style=${{ width: `${CANVAS.width * scale}px`, height: `${CANVAS.height * scale}px` }}><div class="pf-canvas" style=${{ transform: `scale(${scale})` }}>
    <svg aria-hidden="true">${canvas.edges.map((e) => { const a = canvas.nodes.find((n) => n.id === e.from), b = canvas.nodes.find((n) => n.id === e.to); return a && b && html`<line x1=${a.x + 180} y1=${a.y + 40} x2=${b.x} y2=${b.y + 40} />`; })}</svg>
    ${canvas.nodes.map((n) => html`<button type="button" class="pf-node" aria-pressed=${selected === n.id} style=${{ left: `${n.x}px`, top: `${n.y}px` }} onPointerDown=${(e) => pointerDown(e, n)} onPointerMove=${pointerMove} onPointerUp=${() => { drag.current = null; }} onPointerCancel=${() => { drag.current = null; }} onKeyDown=${(e) => {
      const d = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
      if (d) { e.preventDefault(); set((c) => ({ ...c, nodes: c.nodes.map((a) => a.id === n.id ? { ...a, x: Math.max(0, a.x + d[0]), y: Math.max(0, a.y + d[1]) } : a) })); }
    }}>${n.label}<small>${n.assetId ? bot.t("asset") : bot.t("shot")}</small></button>`)}
  </div></div></div></div>`;
}

function Settings({ bot, project: p, send }) {
  const [form, set] = useState(p.settings);
  const edit = (k, v) => set((d) => ({ ...d, [k]: v }));
  return html`<section class="pf-form"><h2 class="t-label">${bot.t("settings")}</h2><div class="pf-grid">
    <${Select} label=${bot.t("mode")} value=${form.mode} options=${["video", "image_text"].map((k) => [k, bot.t(`mode.${k}`)])} onChange=${(v) => { edit("mode", v); if (v === "image_text" && form.audioMode === "native") edit("audioMode", "tts"); }} />
    <${Select} label=${bot.t("ratio")} value=${form.ratio} options=${["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"].map((v) => [v, v])} onChange=${(v) => edit("ratio", v)} />
    <${Select} label=${bot.t("resolution")} value=${form.resolution} options=${["480p", "720p", "768p", "1080p"].map((v) => [v, v])} onChange=${(v) => edit("resolution", v)} />
    <${Select} label=${bot.t("style")} value=${form.style} options=${STYLES.map(([id]) => [id, bot.t(`style.${id}`)])} onChange=${(v) => edit("style", v)} />
    <${Select} label=${bot.t("audioMode")} value=${form.audioMode} options=${["native", "tts", "silent"].map((k) => [k, bot.t(`audio.${k}`)])} onChange=${(v) => edit("audioMode", v)} />
    ${["voice", "imageModel", "videoModel", "language"].map((k) => html`<${Field} label=${bot.t(k)} value=${form[k]} onInput=${(e) => edit(k, e.target.value)} />`)}
    ${["targetDuration", "episodeCount", "bgmVolume"].map((k) => html`<${Field} label=${bot.t(k)} type="number" value=${form[k]} onInput=${(e) => edit(k, Number(e.target.value))} />`)}
    <label><span><input type="checkbox" checked=${form.subtitles} onChange=${(e) => edit("subtitles", e.target.checked)} /> ${bot.t("subtitles")}</span></label>
  </div><div class="pf-actions"><${Button} primary disabled=${bot.busy} onClick=${() => send("apply", { settings: form }, false)}>${bot.t("save")}<//>
    <${Button} disabled=${bot.busy} onClick=${async () => { const files = await bot.pickFile({ accept: "audio/*" }); if (files.length) edit("bgm", files[0].path); }}>${bot.t("chooseBgm")}<//>
    ${form.bgm && html`<${Button} class="ghost" onClick=${() => edit("bgm", "")}>${bot.t("clearBgm")}<//>`}
    <${Menu} label=${bot.t("more")} items=${[
      { label: bot.t("models"), disabled: bot.busy, run: () => send("models", {}, false) },
      { label: bot.t("doctor"), disabled: bot.busy, run: () => send("doctor", {}, false) },
      { label: bot.t(p.archived ? "unarchive" : "archive"), disabled: bot.busy, run: () => send("apply", { archived: !p.archived }, false) },
    ]} />
  </div></section>`;
}

/** 成片：导出的版本在上面，任务和修改历史在下面 */
function Exports({ bot, project: p, send }) {
  return html`<div class="pf-stack">
    <div class="pf-row"><${Button} primary disabled=${bot.busy} onClick=${() => send("compose")}>${bot.t("compose")}<//>
      <${Menu} label=${bot.t("more")} items=${[
        { label: bot.t("composeAll"), disabled: bot.busy, run: () => send("composeAll", {}, false) },
        { label: bot.t("exportProject"), disabled: bot.busy, run: () => send("export", {}, false) },
      ]} /></div>
    <div class="pf-exports">${p.exports.slice().reverse().map((e) => html`<article class="pf-export" key=${e.path}>
      ${e.kind === "video" ? html`<${Preview} bot=${bot} kind="video" file=${e.path} />` : html`<${Button} onClick=${() => bot.openFile(e.path)}>${bot.t("download")}<//>`}
      <div class="pf-actions"><span class="t-meta">${e.at}</span>
        ${e.subtitlePath && html`<${Button} class="sm ghost" onClick=${() => bot.openFile(e.subtitlePath)}>${bot.t("downloadSubtitles")}<//>`}
        ${e.timelinePath && html`<${Button} class="sm ghost" onClick=${() => bot.openFile(e.timelinePath)}>${bot.t("downloadTimeline")}<//>`}</div>
    </article>`)}</div>
    ${!p.exports.length && html`<${Empty}>${bot.t("noExports")}<//>`}
    <div class="pf-stack">
      <details class="pf-fold"><summary>${bot.t("jobs")} · ${p.jobs.length}</summary><div class="pf-list">
        ${p.jobs.slice().reverse().map((j) => html`<article key=${j.id}><span><strong>${bot.t(`media.${j.kind}`)}</strong> <span class=${`badge ${j.status === "done" ? "ok" : j.status === "failed" ? "err" : j.status === "running" ? "warn" : "off"}`}>${bot.t(`status.${j.status}`)}</span></span>
          <span class="pf-meta">${[j.model, j.updatedAt, j.estimateUsd != null ? `${bot.t("estimate")} $${j.estimateUsd}` : ""].filter(Boolean).join(" · ")}</span>${j.error && html`<span class="pf-error">${j.error}</span>`}
          ${["running", "interrupted"].includes(j.status) && html`<${Button} class="sm" disabled=${bot.busy} onClick=${() => send("resume", { jobId: j.id }, false)}>${bot.t("resume")}<//>`}</article>`)}
        ${!p.jobs.length && html`<p class="pf-meta">${bot.t("empty")}</p>`}</div></details>
      <details class="pf-fold"><summary>${bot.t("history")} · ${p.history.length}</summary><div class="pf-list">
        ${p.history.slice().reverse().map((h) => html`<article key=${h.id}><span>${h.label}</span><span class="pf-meta">${h.at}</span><${Button} class="sm ghost" disabled=${bot.busy} onClick=${() => send("restore", { id: h.id }, false)}>${bot.t("restore")}<//></article>`)}
        ${!p.history.length && html`<p class="pf-meta">${bot.t("empty")}</p>`}</div></details>
    </div>
  </div>`;
}

function App() {
  const liveBot = useBot();
  const bot = { ...liveBot, sample: liveBot.sample || !!liveBot.state?.sample };
  const [selected, setSelected] = useState("");
  const [episodeId, setEpisode] = useState("");
  const [tab, setTab] = useState("storyboard");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  const state = bot.state || {};
  const projects = state.projects || [];
  const descriptor = projects.find((p) => p.id === selected) || projects.find((p) => p.id === state.selectedProjectId) || projects[0];
  const projectDoc = useDocument(bot, descriptor?.path, descriptor?.revision, state.sampleProject);
  const p = projectDoc.data;
  const epDesc = p?.episodes?.find((e) => e.id === episodeId) || p?.episodes?.[0];
  const epDoc = useDocument(bot, epDesc?.path, epDesc?.revision, state.sampleEpisode);
  const ep = epDoc.data;
  if (!bot.ready) return null;
  const send = (action, data = {}, useEpisode = true) => {
    setError("");
    const payload = { type: action, projectId: bot.sample ? "" : p?.id || "", episodeId: bot.sample || !useEpisode ? "" : ep?.id || "", revision: p?.revision, data };
    bot.send(bot.t(`action.${action}`), payload).catch((e) => setError(e.message));
  };
  const shown = projects.filter((x) => archived || !x.archived || x.id === descriptor?.id);
  const hasArchived = projects.some((x) => x.archived);
  const showNew = creating || !descriptor;
  const meta = p ? [bot.t(`kind.${p.kind}`), p.settings?.ratio, bot.t(`style.${p.settings?.style}`), bot.sample ? bot.t("sampleShort") : ""].filter((x) => x && !String(x).startsWith("style.")).join(" · ") : "";
  return html`<${Workspace} label=${bot.t("project")} current=${showNew ? bot.t("newProject") : p?.title || descriptor.title}>
    <nav class="kit-ws-list" aria-label=${bot.t("project")}>
      <div class="kit-list-head"><h2 class="t-label">${bot.t("project")}</h2><${Button} class="sm" onClick=${() => setCreating(true)}>${bot.t("new")}<//></div>
      ${shown.map((x) => html`<button type="button" key=${x.id} class=${`kit-item${!showNew && x.id === descriptor?.id ? " on" : ""}`} aria-current=${!showNew && x.id === descriptor?.id ? "true" : undefined} onClick=${() => { setSelected(x.id); setEpisode(""); setCreating(false); }}>
        <span class="kit-item-title">${x.title}</span>
        <span class="kit-item-meta"><span>${[bot.t(`kind.${x.kind}`), x.episodes ? bot.t("episodesCount", { count: x.episodes }) : "", x.archived ? bot.t("archived") : ""].filter(Boolean).join(" · ")}</span></span>
      </button>`)}
      ${!projects.length && html`<p class="kit-foot">${bot.t("noProjects")}</p>`}
      ${hasArchived && html`<button type="button" class="btn ghost sm pf-archived" aria-pressed=${archived} onClick=${() => setArchived(!archived)}>${bot.t(archived ? "hideArchived" : "showArchived")}</button>`}
      ${bot.sample && html`<p class="kit-foot">${bot.t("sample")}</p>`}
    </nav>
    <main class="kit-ws-main">
      ${showNew
        ? html`<header class="kit-bar"><div class="kit-bar-text"><h1>${bot.t("newProject")}</h1><p>${bot.t("appSub")}</p></div></header>
          <div class="kit-ws-body"><${NewProject} bot=${bot} send=${send} close=${descriptor ? () => setCreating(false) : null} /></div>`
        : html`<header class="kit-bar">
            <div class="kit-bar-text"><h1>${p?.title || descriptor.title}</h1><p>${meta}</p></div>
            <div class="kit-bar-actions">
              ${p && p.episodes.length > 0 && html`<label class="pf-episode"><span class="sr-only">${bot.t("episode")}</span><select class="field" value=${epDesc?.id || ""} onChange=${(e) => (e.target.value === "+" ? send("apply", { episode: { number: Math.max(0, ...p.episodes.map((x) => x.number)) + 1, title: bot.t("newEpisode") } }, false) : setEpisode(e.target.value))}>
                ${p.episodes.map((x) => html`<option value=${x.id}>${bot.t("episodeN", { n: x.number, title: x.title })}</option>`)}
                <option value="+">${bot.t("newEpisode")}</option>
              </select></label>`}
              ${bot.busy && html`<${Button} onClick=${() => bot.stop().catch((e) => setError(e.message))}>${bot.t("stop")}<//>`}
              <${Menu} label=${bot.t("more")} disabled=${!p} items=${[
                { label: bot.t("tab.canvas"), run: () => setTab("canvas") },
                { label: bot.t("settings"), run: () => setTab("settings") },
              ]} />
            </div>
          </header>
          <div class="kit-ws-body">
            ${(error || projectDoc.error || epDoc.error) && html`<${Notice}>${error || projectDoc.error || epDoc.error}<//>`}
            ${p
              ? html`<div class="kit-tabs pf-tabs" role="tablist">${TABS.map((id) => html`<button type="button" key=${id} role="tab" aria-selected=${tab === id} onClick=${() => setTab(id)}>${bot.t(`tab.${id}`)}</button>`)}</div>
                <section role="tabpanel" class="pf-panelwrap">
                  ${tab === "script" && html`<${Script} key=${`${p.id}:${p.revision}:${ep?.id}`} bot=${bot} project=${p} episode=${ep} send=${send} />`}
                  ${tab === "storyboard" && html`<${Storyboard} key=${`${p.id}:${ep?.id}`} bot=${bot} project=${p} episode=${ep} send=${send} />`}
                  ${tab === "assets" && html`<${Assets} bot=${bot} project=${p} send=${send} />`}
                  ${tab === "canvas" && html`<${Canvas} key=${`${p.id}:${p.revision}`} bot=${bot} project=${p} episode=${ep} send=${send} />`}
                  ${tab === "settings" && html`<${Settings} key=${`${p.id}:${p.revision}`} bot=${bot} project=${p} send=${send} />`}
                  ${tab === "exports" && html`<${Exports} bot=${bot} project=${p} send=${send} />`}
                </section>`
              : !projectDoc.error && html`<${Empty}>${bot.t("loading")}<//>`}
          </div>`}
    </main>
  <//>`;
}
mount(App);
