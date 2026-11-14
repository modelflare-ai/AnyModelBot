// 添加 / 编辑自定义连接器（自定义 MCP）。上方粘贴、下方表单，并可切到 JSON：三处表达的是同一份配置
// （lib/connector-config.js 的 draft）。认证方式是一个下拉，以后加新的方式只多一项。
// 保存后马上测试：通过就开启；不通过也保存，但保持关闭，写明原因。需要授权登录时自动打开浏览器。
// 本地命令在添加前一定先确认要运行的完整命令。密钥在界面上打码；已保存的密钥界面手里没有，原样发回掩码，后端保留已存的。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Button, Icon, IconButton, MenuButton, Notice, Seg, Sheet, Spinner } from "./ui.js";
import { api } from "../lib/api.js";
import { setApps, stateText } from "../lib/apps.js";
import { MASK, autoName, draftProblem, draftSummary, draftToJson, emptyDraft, jsonToDraft, parsePaste, placeholdersIn, shellSplit, splitHeaderLine } from "../lib/connector-config.js";
import { confirmSheet } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";
import { ConnectedStep, ErrorLine, OAuthWait, useOAuthFlow } from "./app-dialogs.js";

const AUTHS = ["auto", "none", "headers", "query", "dedicatedUrl", "oauth"];
const outLink = (href, text) => html`<a class="text" href=${href} target="_blank" rel="noopener noreferrer">${text} ↗</a>`;

/** 已保存的连接 → 表单的初始内容（密钥是掩码） */
function draftOf(view) {
  const c = view.config || {};
  const d = emptyDraft(c.transport === "stdio" ? "stdio" : "http");
  d.name = view.name || "";
  if (c.transport === "stdio") {
    d.command = c.command || "";
    d.args = [...(c.args || [])];
    d.env = (c.env || []).map((r) => [...r]);
  } else {
    d.url = c.url || "";
    d.sse = !!c.sse;
    d.auth = c.auth || "auto";
    d.headers = (c.headers || []).map((r) => [...r]);
    d.query = (c.query || []).map((r) => [...r]);
    d.oauth = { clientId: c.oauth?.clientId || "", clientSecret: c.oauth?.clientSecret || "", scopes: [...(c.oauth?.scopes || [])], pkce: c.oauth?.pkce !== false };
  }
  return d;
}

/** 键值多行（标头、查询参数、环境变量）：值打码。把「Authorization: Bearer …」整行贴进键这一格时拆成键和值 */
function Pairs({ rows, onChange, label, keyHint, splitLine, flagged = [] }) {
  const set = (i, col, v) => onChange(rows.map((r, j) => (j === i ? (col === 0 ? [v, r[1]] : [r[0], v]) : r)));
  const onKey = (i, v) => {
    const kv = splitLine ? splitHeaderLine(v) : null;
    if (kv) onChange(rows.map((r, j) => (j === i ? kv : r)));
    else set(i, 0, v);
  };
  return html`<div class="apps-pairs" role="group" aria-label=${label}>
    ${rows.map((r, i) => html`<div class="apps-pair" key=${i}>
      <input class="field mono" aria-label=${t("apps.custom.key")} placeholder=${keyHint || t("apps.custom.key")} value=${r[0]} spellcheck="false" autocapitalize="off" onInput=${(e) => onKey(i, e.target.value)} />
      <input class=${`field mono${flagged.includes(r[0]) ? " err" : ""}`} type=${r[1] === MASK ? "text" : "password"} autocomplete="off" aria-label=${t("apps.custom.value")} placeholder=${t("apps.custom.value")} value=${r[1]} spellcheck="false"
        onFocus=${(e) => r[1] === MASK && e.target.select()} onInput=${(e) => set(i, 1, e.target.value)} />
      <${IconButton} icon="close" label=${t("apps.custom.removeRow")} onClick=${() => onChange(rows.filter((_, j) => j !== i))} />
    </div>`)}
    <div><button type="button" class="text" onClick=${() => onChange([...rows, ["", ""]])}>${t("apps.custom.addRow")}</button></div>
  </div>`;
}

export function CustomConnectorSheet({ id, apps, full, chatBot, onClose }) {
  const lang = useLang();
  const zh = String(lang).toLowerCase().startsWith("zh");
  const editing = id ? apps.find((a) => a.custom && a.accounts[0]?.id === id) : null;
  const [draft, setDraft] = useState(() => (editing ? draftOf(editing) : emptyDraft()));
  const [paste, setPaste] = useState("");
  const [found, setFound] = useState(null);
  const [picked, setPicked] = useState([]);
  const [tab, setTab] = useState("form");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [formWarning, setFormWarning] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const jsonBase = useRef(null);
  const [advanced, setAdvanced] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [savedId, setSavedId] = useState(id || "");
  const [skipped, setSkipped] = useState([]);
  const oauth = useOAuthFlow((f) => setResult({ key: f.key }));
  const patch = (p) => { setDraft((d) => ({ ...d, ...p })); setError(""); };
  const flagged = useMemo(() => placeholdersIn(draft), [draft]);
  const problem = draftProblem(draft);

  // 探测到要预注册（服务不接受动态注册）时把「高级」打开
  useEffect(() => {
    if (draft.oauth?.clientId) setAdvanced(true);
  }, []);

  const recognize = (text) => {
    const raw = String(text ?? "").trim();
    if (!raw) return setFound(null);
    const r = parsePaste(raw);
    setFound(r);
    if (r.drafts.length === 1) {
      const d = r.drafts[0];
      // 表单里已经起的名字留着
      setDraft((old) => ({ ...d, name: old.name && !editing ? old.name : d.name }));
      setTab("form");
      if (d.auth === "oauth" && d.oauth?.clientId) setAdvanced(true);
    } else if (r.drafts.length > 1) setPicked(r.drafts.map((_, i) => i));
  };

  const toTab = (next) => {
    if (next === tab) return;
    if (next === "json") {
      if (!formWarning || draft !== jsonBase.current) setJson(draftToJson(draft, { mask: true }));
      jsonBase.current = draft;
      setJsonError("");
      setTab("json");
      return;
    }
    const r = jsonToDraft(json, draft, { partial: true });
    setFormWarning(!!r.error);
    if (!r.error) { setDraft(r.draft); jsonBase.current = r.draft; }
    setShowRequired(true);
    setJsonError("");
    setTab("form");
  };

  const setType = (transport) => {
    if (transport === draft.transport) return;
    const had = draft.transport === "http" ? !!(draft.url || draft.headers.length || draft.query.length) : !!(draft.command || draft.args.length || draft.env.length);
    setSwitched(had);
    setDraft({ ...emptyDraft(transport), name: draft.name });
  };

  /** 把完整命令贴进命令框：拆成命令和参数 */
  const splitCommand = () => {
    const words = shellSplit(draft.command);
    if (words.length > 1 && !draft.args.length) patch({ command: words[0], args: words.slice(1) });
  };

  const save = async (d, opts = {}) => {
    const body = { draft: d };
    return opts.id ? api(`/apps/custom/${encodeURIComponent(opts.id)}`, { method: "PUT", body }) : api("/apps/custom", { method: "POST", body });
  };

  const confirmLocal = async (list) => {
    for (const d of list) {
      if (d.transport !== "stdio") continue;
      const command = [d.command, ...d.args].join(" ");
      if (!(await confirmSheet({ title: t("apps.custom.runTitle"), body: t("apps.custom.runBody", { command }), confirmLabel: t("apps.custom.runConfirm"), danger: true }))) return false;
    }
    return true;
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    let d = draft;
    if (tab === "json") {
      const r = jsonToDraft(json, draft);
      if (r.error) return setJsonError(t(`apps.custom.jsonError.${r.error}`));
      d = r.draft;
      setDraft(d);
    }
    setShowRequired(true);
    if (!d.name.trim()) {
      if (tab === "json") setJsonError(t("apps.custom.jsonError.missing"));
      return;
    }
    const bad = draftProblem(d);
    if (bad) {
      // 表单里有问题的字段下面已经有提示；JSON 页把同一个问题写在编辑区下方
      (tab === "json" ? setJsonError : setError)(bad === "placeholder" ? t("apps.custom.placeholder") : bad === "url" ? t("apps.custom.problem.url") : t(`apps.custom.jsonError.${bad === "command" ? "missing" : bad.replace("Empty", "")}`));
      return;
    }
    // 自己添加的本地命令会在这台电脑上运行：先让用户看清完整命令再确认。取消就不添加、不启动
    if (!(await confirmLocal([d]))) return;
    setBusy(true);
    setError("");
    try {
      const r = await save(d, { id: savedId || undefined });
      setApps(r);
      setSavedId(r.app.accounts[0].id);
      if (r.flow) oauth.begin(r.flow);
      else setResult({ key: r.app.key });
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(false);
  };

  /** 一次粘贴了多个服务：选中的一起添加；超出上限的不加，并说明哪些没加上 */
  const addMany = async () => {
    const list = found.drafts.filter((_, i) => picked.includes(i));
    if (!list.length || busy) return;
    if (!(await confirmLocal(list))) return;
    setBusy(true);
    setError("");
    const missed = [];
    let last = null;
    for (const d of list) {
      if (draftProblem(d)) {
        missed.push(d.name || autoName(d));
        continue;
      }
      try {
        const r = await save(d);
        setApps(r);
        last = r.app.key;
      } catch (err) {
        missed.push(d.name || autoName(d));
        setError(err.message || String(err));
      }
    }
    setBusy(false);
    setSkipped(missed);
    if (last) setResult({ key: last, many: list.length - missed.length });
  };

  const view = result ? apps.find((a) => a.key === result.key) : null;
  const authOptions = AUTHS.map((a) => [a, t(`apps.method.${a}`), t(`apps.custom.authNote.${a}`)]);
  const title = t(editing || savedId ? "apps.custom.editTitle" : "apps.custom.title");

  // —— 结果：已连接 N 个工具；或者保存了但没连上（关着），写明原因，可以回去改 ——
  if (view) {
    const ok = view.state === "connected";
    return html`<${Sheet} title=${title} wide sticky onClose=${onClose}>
      ${ok
        ? html`<${ConnectedStep} title=${stateText("connected", view.tools.length)} label=${result.many > 1 ? t("apps.custom.addedMany", { n: result.many }) : view.name} chatBot=${chatBot} onClose=${onClose} sub=${skipped.length ? t("apps.custom.skipped", { names: skipped.join(", ") }) : ""} />`
        : html`<div class="apps-done">
            <${Notice} tone="amber">${t("apps.custom.savedOff", { state: stateText(view.state) || t("apps.state.off") })}<//>
            ${view.log && html`<details class="skill-instructions"><summary>${t("apps.manage.log")}</summary><pre>${view.log}</pre></details>`}
            <${ErrorLine} text=${error} />
            <div class="actions"><${Button} onClick=${() => { setResult(null); setDraft(draftOf(view)); setTab("form"); }}>${t("apps.custom.backToEdit")}<//>
              <${Button} variant="primary" data-autofocus onClick=${onClose}>${t("apps.connect.finish")}<//></div>
          </div>`}
    <//>`;
  }
  // —— 等授权登录 ——
  if (oauth.flow) {
    return html`<${Sheet} title=${title} wide sticky onClose=${onClose}>
      <${OAuthWait} oauth=${oauth} onRetry=${async () => {
        try {
          const r = await api(`/apps/custom/${encodeURIComponent(savedId)}/authorize`, { method: "POST", body: {} });
          oauth.begin(r.flow);
        } catch (err) {
          oauth.setError(err.message || String(err));
        }
      }} />
      <div class="actions"><${Button} onClick=${onClose}>${t("common.cancel")}<//><${Button} variant="primary" disabled>${t("apps.connect.waitingButton")}<//></div>
    <//>`;
  }

  const summary = found && found.drafts.length === 1 ? draftSummary(found.drafts[0]) : null;
  const remote = draft.transport === "http";
  const limitHit = full && !editing && !savedId;
  return html`<${Sheet} title=${html`<span class="apps-title"><${Icon} name="link" size="md" />${title}</span>`} label=${title} wide sticky onClose=${onClose}>
    <form class="apps-form" onSubmit=${submit}>
      ${limitHit && html`<${Notice} tone="amber">${t("apps.limit", { max: 20 })}<//>`}
      ${!editing && html`<label class="set-field"><span class="k">${t("apps.custom.pasteLabel")}</span>
        <textarea class="field mono apps-paste-box" rows="3" spellcheck="false" placeholder=${t("apps.custom.pastePlaceholder")} value=${paste}
          onInput=${(e) => setPaste(e.target.value)} onPaste=${(e) => { const text = e.clipboardData?.getData("text"); if (text) setTimeout(() => recognize(e.target.value), 0); }} onBlur=${() => recognize(paste)} />
        ${summary && html`<span class="hint">${t("apps.custom.recognized", { name: summary.name, type: t(`apps.custom.type.${summary.type}`), auth: t(`apps.method.${summary.auth}`) })}</span>`}
        ${found && found.error && found.error !== "empty" && html`<span class="hint tone-danger" role="alert">${t(found.error === "json" ? "apps.custom.jsonError.json" : "apps.custom.unrecognized")}</span>`}
        ${!found && html`<span class="hint">${t("apps.custom.pasteHelp")}${zh && html` ${outLink("https://www.modelscope.cn/mcp", t("apps.custom.sourceModelscope"))} ${outLink("https://help.aliyun.com/zh/model-studio/mcp-external-calls", t("apps.custom.sourceBailian"))}`}</span>`}
      </label>`}
      ${found && found.drafts.length > 1 && html`<div class="apps-block">
        <b>${t("apps.custom.many", { n: found.drafts.length })}</b>
        <div class="apps-checks">${found.drafts.map((d, i) => html`<label key=${i} class="sheet-check"><input type="checkbox" checked=${picked.includes(i)}
          onChange=${(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))} />
          <span>${d.name || autoName(d)} <span class="hint">${t(`apps.custom.type.${draftSummary(d).type}`)} · ${t(`apps.method.${draftSummary(d).auth}`)}${placeholdersIn(d).length ? ` · ${t("apps.custom.placeholderShort")}` : ""}</span></span></label>`)}</div>
        <${ErrorLine} text=${error} />
        <div class="actions"><${Button} onClick=${onClose}>${t("common.cancel")}<//><${Button} variant="primary" loading=${busy} disabled=${!picked.length || limitHit} onClick=${addMany}>${t("apps.custom.addMany", { n: picked.length })}<//></div>
      </div>`}
      ${!(found && found.drafts.length > 1) && html`
      <${Seg} label=${t("apps.custom.view")} value=${tab} onChange=${toTab} options=${[["form", t("apps.custom.form")], ["json", "JSON"]]} />
      ${tab === "json" && html`<label class="set-field"><span class="k">JSON<span class="hint">${t("apps.custom.jsonHint")}</span></span>
        <textarea class="field mono apps-json" rows="12" spellcheck="false" value=${json} onInput=${(e) => { setJson(e.target.value); setJsonError(""); }} />
        <${ErrorLine} text=${jsonError} />
      </label>`}
      ${tab === "form" && html`
        ${formWarning && html`<${Notice} tone="red">${t("welcome.jsonKept")}<//>`}
        <label class="set-field"><span class="k">${t("apps.custom.name")}</span>
          <input class="field" maxlength="60" placeholder=${t(remote ? "apps.custom.namePlaceholder" : "apps.custom.namePlaceholderLocal")} value=${draft.name} onInput=${(e) => patch({ name: e.target.value })} />${showRequired && !draft.name.trim() && html`<span class="hint tone-danger">${t("welcome.required")}</span>`}</label>
        <div class="set-field"><span class="k">${t("apps.custom.typeLabel")}</span>
          <${Seg} label=${t("apps.custom.typeLabel")} value=${draft.transport} onChange=${setType} options=${[["http", t("apps.custom.type.remote")], ["stdio", t("apps.custom.type.local")]]} />
          ${switched && html`<span class="hint">${t("apps.custom.switched")}</span>`}</div>
        ${remote && html`
          <label class="set-field"><span class="k">${t("apps.custom.url")} *</span>
            <input class=${`field mono${flagged.includes("url") ? " err" : ""}`} type=${draft.auth === "dedicatedUrl" && draft.url !== MASK ? "password" : "text"} autocomplete="off" spellcheck="false" placeholder=${t("apps.custom.urlPlaceholder")} value=${draft.url}
              onInput=${(e) => patch({ url: e.target.value })} />
            ${problem === "url" && (draft.url || showRequired) && html`<span class="hint tone-danger">${t("apps.custom.problem.url")}</span>`}</label>
          <div class="set-field"><span class="k">${t("apps.custom.auth")}</span>
            <${MenuButton} label=${t("apps.custom.auth")} value=${draft.auth} options=${authOptions} width=${340} align="left" onChange=${(v) => patch({ auth: v })} />
            <span class="hint">${t(`apps.custom.authNote.${draft.auth}`)}</span></div>
          ${draft.auth === "headers" && html`<div class="set-field"><span class="k">${t("apps.custom.headers")} *</span>
            <${Pairs} rows=${draft.headers} label=${t("apps.custom.headers")} keyHint="Authorization" splitLine flagged=${flagged.filter((f) => f.startsWith("headers.")).map((f) => f.slice(8))} onChange=${(headers) => patch({ headers })} /></div>`}
          ${draft.auth === "query" && html`<div class="set-field"><span class="k">${t("apps.custom.query")} *</span>
            <${Pairs} rows=${draft.query} label=${t("apps.custom.query")} keyHint="key" flagged=${flagged.filter((f) => f.startsWith("query.")).map((f) => f.slice(6))} onChange=${(query) => patch({ query })} /></div>`}
          ${draft.auth === "oauth" && html`<div class="set-field">
            <button type="button" class="apps-fold" aria-expanded=${advanced} onClick=${() => setAdvanced((v) => !v)}><b>${t("apps.custom.advanced")}</b><${Icon} name=${advanced ? "chevDown" : "chevRight"} size="sm" /></button>
            ${advanced && html`<div class="apps-advanced">
              <label class="set-field"><span class="k">${t("apps.custom.clientId")}</span><input class="field mono" spellcheck="false" value=${draft.oauth.clientId} onInput=${(e) => patch({ oauth: { ...draft.oauth, clientId: e.target.value } })} /></label>
              <label class="set-field"><span class="k">${t("apps.custom.clientSecret")}</span><input class="field mono" type=${draft.oauth.clientSecret === MASK ? "text" : "password"} autocomplete="off" value=${draft.oauth.clientSecret} onInput=${(e) => patch({ oauth: { ...draft.oauth, clientSecret: e.target.value } })} /></label>
              <label class="set-field"><span class="k">Scopes</span><input class="field mono" spellcheck="false" placeholder="offline_access" value=${draft.oauth.scopes.join(" ")} onInput=${(e) => patch({ oauth: { ...draft.oauth, scopes: e.target.value.split(/[\s,]+/).filter(Boolean) } })} /></label>
              <label class="sheet-check"><input type="checkbox" checked=${draft.oauth.pkce !== false} onChange=${(e) => patch({ oauth: { ...draft.oauth, pkce: e.target.checked } })} /><span>${t("apps.custom.pkce")}</span></label>
            </div>`}</div>`}`}
        ${!remote && html`
          <label class="set-field"><span class="k">${t("apps.custom.command")} *</span>
            <input class="field mono" spellcheck="false" autocapitalize="off" placeholder="npx -y package-name" value=${draft.command} onInput=${(e) => patch({ command: e.target.value })} onBlur=${splitCommand} /></label>
          <label class="set-field"><span class="k">${t("apps.custom.args")}<span class="hint">${t("apps.custom.argsHint")}</span></span>
            <textarea class="field mono apps-args" rows="3" spellcheck="false" value=${draft.args.join("\n")} onInput=${(e) => patch({ args: e.target.value.split("\n") })} onBlur=${() => patch({ args: draft.args.map((a) => a.trim()).filter(Boolean) })} /></label>
          <div class="set-field"><span class="k">${t("apps.custom.env")}</span>
            <${Pairs} rows=${draft.env} label=${t("apps.custom.env")} keyHint="API_KEY" flagged=${flagged.filter((f) => f.startsWith("env.")).map((f) => f.slice(4))} onChange=${(env) => patch({ env })} /></div>`}
        ${problem === "placeholder" && html`<span class="hint tone-danger" role="alert">${t("apps.custom.placeholder")}</span>`}
      `}
      <${ErrorLine} text=${error} />
      <div class="actions">
        <${Button} onClick=${onClose}>${t("common.cancel")}<//>
        <${Button} type="submit" variant="primary" disabled=${busy || limitHit}>${busy ? html`<${Spinner} /> ${t("apps.state.testing")}` : t(editing || savedId ? "common.save" : "apps.custom.add")}<//>
      </div>`}
    </form>
  <//>`;
}
