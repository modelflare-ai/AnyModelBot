// 从本机导入技能（PRD 2026-11-25 R1–R4）：「我的技能库」和机器人设置的「从本机导入…」都打开这一个对话框。
// 三步：找到并多选（只看目录项和文件名，初始不勾选）→ 预览后一次导入（只读所选的；同名默认跳过、可另存一份；
// 「导入后在{机器人}上使用」一个勾选项）→ 在原界面汇总结果（入库和开启分别报告，失败项就近说明原因）。
// 只在库所在电脑的桌面版里能找；网页、远端只说明原因，ZIP / GitHub 照常。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, MenuButton, Sheet, Spinner } from "./ui.js";
import { api } from "../lib/api.js";
import { failed, useStore } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";
import { closeLocalImport, errorText, loadMyLibrary, localImport, newRequestId, openMyLibrary, reasonText } from "../lib/my-library.js";
import { loadBotSkills, setBotSkills, useBotSkills } from "../lib/usage.js";

const POLL_MS = 400;
const CHECK_MS = 1500;

/** 一个根的状态：找到几项 / 未找到 / 无权限 / 未扫描完整 */
function RootLine({ root }) {
  const text = root.status === "found" ? t("skillLib.import.rootFound", { count: root.count })
    : root.status === "missing" ? t("skillLib.import.rootMissing")
    : root.status === "denied" ? t("skillLib.import.rootDenied")
    : root.status === "partial" ? t("skillLib.import.incomplete")
    : t("skillLib.import.rootError");
  return html`<li class=${`li-root ${root.status}`}><span class="mono">${root.location}</span>${root.real && html`<span class="hint"> · ${t("skillLib.import.rootLink", { real: root.real })}</span>`}<span class="li-root-state">${text}</span></li>`;
}

/** 第一步：候选项（初始不勾选），选择文件夹…，下一步只读所选的 */
function Discover({ scan, selected, setSelected, busy, onPick, onStop, linkAsk, onLink, pickNote }) {
  const all = scan.candidates.filter((c) => !c.blocked);
  const allOn = all.length > 0 && all.every((c) => selected.has(c.key));
  const toggle = (key) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(all.map((c) => c.key)));
  const scanning = scan.state === "scanning";
  return html`
    <div class="li-head">
      <p class="hint">${t("skillLib.import.machine", { machine: scan.machine })} · ${t("skillLib.import.scope")}</p>
      ${scan.picker && html`<${Button} size="sm" disabled=${busy} onClick=${onPick}>${t("skillLib.import.choose")}<//>`}
    </div>
    ${linkAsk && html`<div class="li-link" role="alertdialog" aria-label=${t("skillLib.import.linkTitle")}>
      <b>${t("skillLib.import.linkTitle")}</b>
      <p>${t("skillLib.import.linkBody", { location: linkAsk.location, real: linkAsk.real })}</p>
      <div class="actions"><${Button} size="sm" onClick=${() => onLink(false)}>${t("skillLib.import.cancel")}<//><${Button} size="sm" variant="primary" onClick=${() => onLink(true)}>${t("skillLib.import.linkOk")}<//></div>
    </div>`}
    ${pickNote && html`<p class="li-note" role="status">${pickNote}</p>`}
    <div class="li-table" role="group" aria-label=${t("skillLib.import.colName")}>
      <div class="li-row li-th">
        <label class="li-check">${all.length > 0 && html`<input type="checkbox" checked=${allOn} aria-label=${t("skillLib.import.selectAll")} onChange=${toggleAll} />`}</label>
        <span>${t("skillLib.import.colName")}</span><span>${t("skillLib.import.colWhere")}</span><span>${t("skillLib.import.colStatus")}</span>
      </div>
      ${scan.candidates.map((c) => html`<label class=${`li-row${c.blocked ? " blocked" : ""}`} key=${c.key}>
        <span class="li-check"><input type="checkbox" disabled=${!!c.blocked} checked=${selected.has(c.key)} onChange=${() => toggle(c.key)} /></span>
        <span class="li-name">${c.name}</span>
        <span class="li-where mono" title=${c.location}>${c.location}</span>
        <span class="li-state">${c.blocked ? t("skillLib.import.blocked", { reason: reasonText(c.blocked.problem, c.blocked.detail) }) : t("skillLib.import.notRead")}</span>
      </label>`)}
      ${scanning && html`<div class="li-row li-wait"><${Spinner} /><span>${t("skillLib.import.scanning")}</span><${Button} size="sm" onClick=${onStop}>${t("skillLib.import.stop")}<//></div>`}
      ${!scanning && !scan.candidates.length && html`<div class="li-row li-empty">${scan.state === "canceled" ? t("skillLib.import.incomplete") : t("skillLib.import.empty")}</div>`}
      ${!scanning && scan.state === "canceled" && scan.candidates.length > 0 && html`<div class="li-row li-empty">${t("skillLib.import.incomplete")}</div>`}
    </div>
    ${scan.roots.filter((r) => r.status === "denied").map((r) => html`<p class="li-note" key=${r.location}>${t("skillLib.import.rootDenied")} · <span class="mono">${r.location}</span></p>`)}
    <p class="li-count">${t("skillLib.import.selected", { count: selected.size })}</p>
    <details class="li-where-more">
      <summary>${t("skillLib.import.findHint")}</summary>
      <p class="hint">${t("skillLib.import.roots")}</p>
      <ul class="li-roots">${scan.roots.map((r, i) => html`<${RootLine} key=${i} root=${r} />`)}</ul>
      <p class="hint">${t("skillLib.import.hints")}</p>
      <ul class="li-roots">${scan.hints.map((h) => html`<li class="mono" key=${h}>${h}</li>`)}</ul>
    </details>`;
}

/** 预览里一项的说明：状态 + 含脚本 / 依赖尚未验证 / 补全 */
function statusLine(it) {
  if (it.status === "incompatible") return t("skillLib.import.incompatible", { reason: reasonText(it.problem?.code, it.problem?.detail) });
  const bits = [t(`skillLib.import.${it.status}`)];
  if (it.scripts) bits.push(t("skillLib.import.scripts"));
  if (it.depsUnverified) bits.push(t("skillLib.import.deps"));
  return bits.join(" · ");
}

/** 「查看」：相对文件、原因、补全值、未计入的、来源位置 */
function ItemDetail({ it }) {
  const list = (label, items, mono = true) => items?.length ? html`<div class="li-detail-sec"><b>${label}</b><ul>${items.map((x) => html`<li class=${mono ? "mono" : ""} key=${x}>${x}</li>`)}</ul></div>` : null;
  return html`<div class="li-detail">
    ${it.description && html`<p>${it.description}</p>`}
    ${it.existing && html`<p class="hint">${t("skillLib.import.existsIn", { title: it.existing.title })}</p>`}
    ${list(t("skillLib.import.from"), it.sources.map((s) => s.location))}
    ${it.sources.length > 1 && html`<p class="hint">${t("skillLib.import.merged", { count: it.sources.length })}</p>`}
    ${list(t("skillLib.import.restrictions"), it.restrictions)}
    ${list(t("skillLib.import.paths"), it.paths)}
    ${list(t("skillLib.import.ignored"), it.ignored)}
    ${list(t("skillLib.import.unused"), it.unused)}
  </div>`;
}

/** 第二步：所选的每一项和处理方式；同名不同内容默认跳过、可另存一份；一个「导入后在{机器人}上使用」 */
function Review({ preview, actions, setAction, open, setOpen, bot, useBot, setUseBot }) {
  return html`
    <p class="hint">${t("skillLib.import.reviewSub")}</p>
    <div class="li-review">
      ${preview.items.map((it) => html`<div class=${`li-item ${it.status}`} key=${it.key}>
        <div class="li-item-main">
          <div class="li-item-title"><b>${it.title || it.name}</b>${it.name && it.title !== it.name && html`<span class="skill-file">${it.name}</span>`}</div>
          <div class="sub">${statusLine(it)}</div>
          ${(it.completed || []).map((c) => html`<div class="sub li-completed" key=${c.field}>${t("skillLib.import.completed", { field: t(`skillLib.import.field.${c.field}`), value: c.value })}</div>`)}
          ${it.status === "conflict" && actions[it.key] === "copy" && html`<div class="sub">${t("skillLib.import.copyAs", { title: it.copyTitle, name: it.name })}</div>`}
          ${open === it.key && html`<${ItemDetail} it=${it} />`}
        </div>
        <div class="li-item-ctl">
          ${it.status === "conflict" && html`<${MenuButton} label=${t("skillLib.import.conflict")} width=${180} value=${actions[it.key] || "skip"} onChange=${(v) => setAction(it.key, v)}
            options=${[["skip", t("skillLib.import.skip")], ["copy", t("skillLib.import.saveCopy")]]} />`}
          <${Button} size="sm" onClick=${() => setOpen(open === it.key ? "" : it.key)}>${open === it.key ? t("skillLib.import.hide") : t("skillLib.import.view")}<//>
        </div>
      </div>`)}
    </div>
    ${preview.items.some((it) => it.status === "conflict") && html`<p class="hint">${t("skillLib.import.conflictNote")}</p>`}
    ${bot && html`<label class="sheet-check li-use"><input type="checkbox" checked=${useBot} onChange=${(e) => setUseBot(e.target.checked)} />
      <span>${t("skillLib.import.useOn", { bot: bot.name })}<small class="hint">${t("skillLib.import.useNote")}</small></span></label>`}`;
}

/** 第三步：汇总（入库和开启分别报告），失败项就近说明；开启失败只重试开启 */
function Result({ record, botId, onRetryEnable, onRetryFailed, retrying }) {
  const skills = useBotSkills(botId || "");
  const added = record.items.filter((i) => i.state === "added").length;
  const enabled = record.items.filter((i) => i.enable === "on").length;
  const skipped = record.items.filter((i) => i.state === "skipped" || i.state === "stopped").length;
  const fails = record.items.filter((i) => i.state === "failed" || i.enable === "failed").length;
  const line = record.bot ? t("skillLib.import.result", { added, enabled, skipped, failed: fails, bot: record.botName || "" }) : t("skillLib.import.resultNoBot", { added, skipped, failed: fails });
  const stateOf = (it) => {
    if (it.state === "failed") return t("skillLib.import.itemFailed", { reason: reasonText(it.error?.code, it.error?.detail) });
    if (it.state === "skipped") {
      if (it.why === "incompatible") return t("skillLib.import.incompatible", { reason: reasonText(it.error?.code, it.error?.detail) });
      if (it.why === "exists") return t("skillLib.import.exists");
      if (it.why === "conflict") return `${t("skillLib.import.conflict")} · ${t("skillLib.import.itemSkipped")}`;
      return t("skillLib.import.itemSkipped");
    }
    if (it.state === "stopped") return t("skillLib.import.itemStopped");
    if (it.state === "pending") return t("skillLib.import.importing");
    if (it.enable === "failed") return t("skillLib.import.itemEnableFailed", { reason: reasonText(it.enableError) });
    if (it.enable === "on") {
      const row = (skills || []).find((s) => s.library?.id === it.entryId);
      return row && (row.state === "waiting" || row.state === "loading") ? t("skillLib.import.itemWaiting") : t("skillLib.import.itemEnabled");
    }
    return t("skillLib.import.itemAdded");
  };
  const writeFailed = record.items.some((i) => i.state === "failed");
  return html`
    <p class="li-summary" role="status">${line}</p>
    ${record.canceled && html`<p class="hint">${t("skillLib.import.stopped")}</p>`}
    <ul class="li-results">${record.items.map((it) => html`<li key=${it.key} class=${it.state === "failed" || it.enable === "failed" ? "warn" : ""}>
      <b>${it.title}</b><span class="sub">${stateOf(it)}</span>
      ${it.enable === "failed" && botId && html`<${Button} size="sm" disabled=${retrying} onClick=${() => onRetryEnable(it)}>${t("skillLib.import.retryEnable")}<//>`}
    </li>`)}</ul>
    ${writeFailed && html`<div class="actions li-retry"><${Button} size="sm" disabled=${retrying} onClick=${onRetryFailed}>${t("skillLib.import.retryFailed")}<//></div>`}`;
}

export function LocalImportHost() {
  useLang();
  const req = useStore(localImport);
  const [step, setStep] = useState("discover");
  const [scan, setScan] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [linkAsk, setLinkAsk] = useState(null);
  const [pickNote, setPickNote] = useState("");
  const [preview, setPreview] = useState(null);
  const [actions, setActions] = useState({});
  const [open, setOpen] = useState("");
  const [useBot, setUseBot] = useState(false);
  const [record, setRecord] = useState(null);
  const [note, setNote] = useState("");
  const rid = useRef("");
  const sid = scan?.id;
  const bot = req?.botId ? { id: req.botId, name: req.botName || "" } : req?.defaultBot || null;

  // 打开：开一个会话，开始找六个自动根
  useEffect(() => {
    setStep("discover"); setScan(null); setUnavailable(false); setSelected(new Set()); setLinkAsk(null); setPickNote("");
    setPreview(null); setActions({}); setOpen(""); setRecord(null); setNote(""); rid.current = "";
    setUseBot(!!req?.botId);
    if (!req) return;
    let alive = true;
    api("/skill-library/scans", { method: "POST", body: { bot: req.botId || "" } }).then(
      (d) => alive && setScan(d.scan),
      (e) => {
        if (!alive) return;
        if (e?.data?.code === "desktop_only") setUnavailable(true);
        else { failed(errorText(e)); closeLocalImport(); }
      },
    );
    return () => { alive = false; };
  }, [req?.at]);
  // 还在找：一会儿取一次进度
  useEffect(() => {
    if (!sid || scan?.state !== "scanning") return;
    const timer = setTimeout(() => api(`/skill-library/scans/${encodeURIComponent(sid)}`).then((d) => setScan(d.scan), () => {}), POLL_MS);
    return () => clearTimeout(timer);
  }, [sid, scan]);
  // 没收到导入的回应：按请求号查原结果，查到之前不让再提交
  useEffect(() => {
    if (step !== "checking" || !rid.current) return;
    const timer = setInterval(() => api(`/skill-library/imports/${encodeURIComponent(rid.current)}`).then((d) => {
      if (d.record?.state === "done") { setRecord(d.record); setStep("result"); loadMyLibrary().catch(() => {}); }
    }, (e) => {
      // 服务端没有这次提交的记录：请求没送到，可以再提交
      if (e?.status === 404) setStep("review");
    }), CHECK_MS);
    return () => clearInterval(timer);
  }, [step]);

  if (!req) return null;
  const close = () => {
    if (busy && step !== "importing") return;
    if (sid) api(`/skill-library/scans/${encodeURIComponent(sid)}`, { method: "DELETE" }).catch(() => {});
    loadMyLibrary().catch(() => {});
    if (req.botId) loadBotSkills(req.botId).catch(() => {});
    req.onDone?.();
    closeLocalImport();
  };
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { failed(errorText(e)); }
    finally { setBusy(false); }
  };
  const pick = () => run(async () => {
    setPickNote("");
    const r = await api(`/skill-library/scans/${encodeURIComponent(sid)}/pick`, { method: "POST", body: {} });
    setScan(r.scan);
    if (r.status === "confirm") setLinkAsk(r.scan.link);
    else setPickNote(r.status === "too_broad" ? t("skillLib.import.tooBroad") : r.status === "missing" ? t("skillLib.import.pickMissing") : r.status === "duplicate" ? t("skillLib.import.duplicate") : r.status === "picked" && !r.added ? t("skillLib.import.pickedNone") : "");
  });
  const link = (ok) => run(async () => {
    setLinkAsk(null);
    const r = await api(`/skill-library/scans/${encodeURIComponent(sid)}/link`, { method: "POST", body: { ok } });
    setScan(r.scan);
    if (ok) setPickNote(r.status === "too_broad" ? t("skillLib.import.tooBroad") : r.status === "missing" ? t("skillLib.import.pickMissing") : r.status === "duplicate" ? t("skillLib.import.duplicate") : r.status === "picked" && !r.added ? t("skillLib.import.pickedNone") : "");
  });
  const stop = () => run(async () => setScan((await api(`/skill-library/scans/${encodeURIComponent(sid)}/cancel`, { method: "POST", body: {} })).scan));
  const doPreview = (keys) => run(async () => {
    setStep("reading");
    try {
      const r = await api(`/skill-library/scans/${encodeURIComponent(sid)}/preview`, { method: "POST", body: { keys, bot: bot?.id || "" } });
      setPreview(r); setActions({}); setOpen(""); setNote(""); setStep("review");
    } catch (e) { setStep("discover"); throw e; }
  });
  const next = () => doPreview([...selected]);
  const eligible = preview ? preview.items.filter((it) => it.status === "ok" || (it.status === "conflict" && actions[it.key] === "copy")) : [];
  const submit = (items, retry = false) => run(async () => {
    rid.current = newRequestId();
    setStep("importing"); setNote("");
    const body = { requestId: rid.current, preview: preview.preview, items, bot: useBot && bot ? bot.id : "", retry };
    let r;
    try {
      r = await api(`/skill-library/scans/${encodeURIComponent(sid)}/import`, { method: "POST", body });
    } catch (e) {
      // 内容或目标已变化：回到确认页、重新预览；其他（连不上、超时）按请求号查原结果
      if (e?.data?.code === "changed" || e?.data?.code === "not_found") { setStep("review"); setNote(t("skillLib.reason.changed")); return; }
      if (e?.status && e.status < 500) { setStep("review"); throw e; }
      setStep("checking");
      return;
    }
    if (r.skills && bot) setBotSkills(bot.id, r.skills);
    setRecord(r.record); setStep("result");
    loadMyLibrary().catch(() => {});
  });
  const confirm = () => submit(eligible.map((it) => ({ key: it.key, action: it.status === "conflict" ? "copy" : "import" })));
  const stopImport = () => rid.current && api(`/skill-library/imports/${encodeURIComponent(rid.current)}/cancel`, { method: "POST", body: {} }).catch(() => {});
  const retryEnable = (it) => run(async () => {
    const r = await api(`/skill-library/items/${encodeURIComponent(it.entryId)}/bots/${encodeURIComponent(record.bot)}`, { method: "PUT", body: { on: true } }).catch((e) => ({ error: e }));
    if (r.error) { setRecord({ ...record, items: record.items.map((x) => (x.key === it.key ? { ...x, enableError: r.error?.data?.code || "other" } : x)) }); throw r.error; }
    setBotSkills(record.bot, r.skills);
    setRecord({ ...record, items: record.items.map((x) => (x.key === it.key ? { ...x, enable: "on", enableError: undefined } : x)) });
  });
  // 写入失败的那几项再提交一次（新的请求号）；来源变了就回到预览
  const retryFailed = () => {
    const keys = record.items.filter((i) => i.state === "failed").map((i) => i.key);
    const items = preview.items.filter((it) => keys.includes(it.key)).map((it) => ({ key: it.key, action: it.status === "conflict" ? "copy" : "import" }));
    submit(items, true);
  };
  const nothing = step === "review" && !eligible.length;

  const title = step === "result" ? t("skillLib.import.resultTitle") : ["review", "importing", "checking"].includes(step) ? t("skillLib.import.reviewTitle") : t("skillLib.import.title");
  const footer = unavailable ? html`<${Button} variant="primary" data-autofocus onClick=${close}>${t("skillLib.import.close")}<//>`
    : step === "discover" || step === "reading" ? html`<${Button} onClick=${close}>${t("skillLib.import.cancel")}<//><${Button} variant="primary" loading=${step === "reading"} disabled=${!selected.size || busy || !scan} onClick=${next}>${t("skillLib.import.next")}<//>`
    : step === "review" ? html`<${Button} disabled=${busy} onClick=${() => setStep("discover")}>${t("skillLib.import.back")}<//><${Button} variant="primary" disabled=${busy || nothing} onClick=${confirm}>${t("skillLib.import.confirm")}<//>`
    : step === "importing" ? html`<${Button} onClick=${stopImport}>${t("skillLib.import.stopImport")}<//><${Button} variant="primary" loading disabled>${t("skillLib.import.confirm")}<//>`
    : step === "checking" ? html`<${Button} variant="primary" loading disabled>${t("skillLib.import.confirm")}<//>`
    : html`${!location.hash.startsWith("#/skills/library") && html`<${Button} onClick=${() => { close(); openMyLibrary(); }}>${t("skillLib.import.openLibrary")}<//>`}<${Button} variant="primary" data-autofocus onClick=${close}>${t("skillLib.import.done")}<//>`;

  return html`<${Sheet} title=${title} wide framed sticky class="local-import" onClose=${close} footer=${html`<div class="actions">${footer}</div>`}>
    ${unavailable && html`<div class="li-unavailable"><p>${t("skillLib.import.unavailable")}</p><p class="hint">${t("skillLib.import.unavailableSub")}</p></div>`}
    ${!unavailable && !scan && html`<div class="li-wait"><${Spinner} /></div>`}
    ${!unavailable && scan && (step === "discover" || step === "reading") && html`<${Discover} scan=${scan} selected=${selected} setSelected=${setSelected} busy=${busy}
      onPick=${pick} onStop=${stop} linkAsk=${linkAsk} onLink=${link} pickNote=${pickNote} />`}
    ${step === "review" && preview && html`${note && html`<p class="li-note warn" role="alert">${note} <button type="button" class="text" onClick=${() => doPreview(preview.items.flatMap((it) => it.sources.map((s) => s.key)))}>${t("skillLib.import.previewAgain")}</button></p>`}
      <${Review} preview=${preview} actions=${actions} setAction=${(k, v) => setActions((a) => ({ ...a, [k]: v }))} open=${open} setOpen=${setOpen} bot=${bot} useBot=${useBot} setUseBot=${setUseBot} />
      ${nothing && html`<p class="hint">${t("skillLib.import.nothing")}</p>`}`}
    ${step === "importing" && html`<div class="li-wait"><${Spinner} /><span>${t("skillLib.import.importing")}</span></div>`}
    ${step === "checking" && html`<div class="li-wait" role="status"><${Spinner} /><span>${t("skillLib.import.checking")}</span></div>`}
    ${step === "result" && record && html`<${Result} record=${record} botId=${record.bot || ""} onRetryEnable=${retryEnable} onRetryFailed=${retryFailed} retrying=${busy} />`}
  <//>`;
}
