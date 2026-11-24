import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, Icon, Sheet, Switch, Skeleton } from "./ui.js";
import { openGithub } from "./skill-library.js";
import { api, uploadSkillZip } from "../lib/api.js";
import { confirmSheet, failed, saved, toast } from "../lib/store.js";
import { t, has } from "../lib/i18n.js";
import { fold } from "../lib/text-fold.js";
import { fillChat, installedExample, loadBotSkills, setBotSkills, skillReady, skillReadyToast, useBotSkills } from "../lib/usage.js";
import { CHIPS, LIST_FOLD_AT, LIST_SEARCH_AT, chipCounts, inChip, kindOf, matches, openSkillDetail, skillsFilter, sortSkills } from "../lib/my-skills.js";
import { openLibraryAdd, openLocalImport, reasonText } from "../lib/my-library.js";
import { useLang } from "../lib/i18n.js";

// 名字被「我的技能」占用（R9）：说是哪个「我的技能」
const errorText = (e) => e?.data?.code === "mine_name" ? t("mySkills.list.mineName", { name: e.data.name || "", title: e.data.title || "" })
  : has(`botSettings.skills.errors.${e?.data?.code}`) ? t(`botSettings.skills.errors.${e.data.code}`)
  : ["name_on", "bot_full", "in_use"].includes(e?.data?.code) ? reasonText(e.data.code) : e?.message || t("common.error");

/** 来源：GitHub 安装的带仓库（点了在浏览器打开），ZIP 导入的（含 0.1.35 及以前导入、没有记录的）是本地 ZIP，对话里存下的是我的技能 */
function SourceLine({ source }) {
  if (source?.type === "mine") return html`<div class="sub skill-source-line">${t("mySkills.list.sourceMine")}</div>`;
  if (source?.type === "local") return html`<div class="sub skill-source-line">${t("skillLib.sourceLine", { source: t("skillLib.sourceLocal") })}</div>`;
  if (source?.type !== "github") return html`<div class="sub skill-source-line">${t("botSettings.skills.sourceZip")}</div>`;
  const repo = `${source.owner}/${source.repo}`;
  return html`<div class="sub skill-source-line">${t("botSettings.skills.sourceGithub", { repo: "" })}<a href=${source.url} onClick=${(e) => (e.preventDefault(), openGithub(source.url))}>${repo}<${Icon} name="ext" size="xs" /></a></div>`;
}

/** 名字旁的生效状态：已生效 / 下一条消息起生效（机器人正在跑任务） / 加载中（关掉的不标） */
function StateBadge({ state }) {
  if (!["active", "waiting", "loading"].includes(state)) return null;
  return html`<span class=${`badge ${state === "active" ? "ok" : "warn"} skill-state`}>${t(`chat.use.state.${state}`)}</span>`;
}

/**
 * 常驻的一行「试试这样说」：点了打开这个机器人的对话，把这句填进输入框。模型不能自己用的技能改成说明怎么用。
 * 关着的（所有来源）置灰、不能点
 */
function TryLine({ botId, skill }) {
  if (!skill.enabled) return skill.example && skill.modelInvocable !== false ? html`<button type="button" class="text skill-try" disabled>${t("chat.use.try", { example: skill.example })}</button>` : null;
  if (skill.modelInvocable === false) return html`<div class="sub skill-try">${t("botSettings.skills.manualOnly", { name: skill.name })}</div>`;
  if (!skill.example) return null;
  return html`<button type="button" class="text skill-try" title=${t("chat.use.fillTitle")} onClick=${() => fillChat(botId, skill.example)}>${t("chat.use.try", { example: skill.example })}</button>`;
}

/**
 * 机器人设置的技能区：一个列表，导入的技能和「我的技能」在一起（每个机器人都列出全部「我的技能」，在这里打开的算开着）。
 * 开着的在前、关着的在后，组内按显示的名字排；超过 10 个时顶上出搜索框和筛选胶囊，选「全部」且不在搜索时先显示 20 个。
 * 「我的技能」的行：「查看」「管理」和开关（只影响这个机器人）；其他来源：「查看」「删除」和开关。
 */
export function Skills({ botId, botName = "", onBrowse }) {
  const lang = useLang();
  const base = `/bots/${encodeURIComponent(botId)}/skills`;
  // 和加号菜单共用一份清单（lib/usage.js）：有还没生效的会自己刷新，状态跟着变
  const skills = useBotSkills(botId);
  const setSkills = (list) => setBotSkills(botId, list);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [fresh, setFresh] = useState("");
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("all");
  const [all, setAll] = useState(false);
  const input = useRef(null);
  const working = useRef(false);
  useEffect(() => {
    setError("");
    setQ("");
    setAll(false);
    // 「管理我的技能」（草稿卡上满 100 个时）：打开时筛选「我的技能」
    const pre = skillsFilter.get();
    setChip(pre && pre.botId === botId ? pre.chip : "all");
    if (pre) skillsFilter.set(null);
    loadBotSkills(botId).catch((e) => setError(errorText(e)));
  }, [botId]);
  // 刚导入的那一行亮一下、滚到眼前（成功提示里的「试试这样说」就在这一行上）
  useEffect(() => {
    if (!fresh) return;
    requestAnimationFrame(() => document.querySelector(`.skill-list [data-skill="${CSS.escape(fresh)}"]`)?.scrollIntoView({ block: "nearest" }));
    const timer = setTimeout(() => setFresh(""), 2400);
    return () => clearTimeout(timer);
  }, [fresh]);
  const run = async (fn) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try { await fn(); } catch (e) { failed(errorText(e)); }
    finally { working.current = false; setBusy(false); }
  };
  const reload = () => run(async () => { const r = await api(base); setSkills(r.skills); setError(""); });
  const select = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return failed(t("botSettings.skills.errors.too_large"));
    run(async () => { const r = await uploadSkillZip(base + "/preview", file); setDetail({ ...r.skill, file }); });
  };
  const install = () => run(async () => {
    const q = detail.replaces ? `?replaces=${encodeURIComponent(detail.replaces)}` : "";
    const r = await uploadSkillZip(base + q, detail.file);
    setSkills(r.skills);
    setError("");
    const added = r.skills.find((x) => x.name === detail.name);
    setDetail(null);
    // 写明什么时候能用：已生效 / 当前任务结束后 / 加载中（加载完之前不说已经可用；变成已生效后提示里的说法跟着换）；
    // 下面一行示例和「填入输入框」「复制」。填入时切到这个机器人的对话（它最近的那条）再填
    const name = added?.title || detail.name;
    skillReadyToast((state) => t(`botSettings.skills.imported.${state}`, { name }), added ? skillReady(added) : "loading", botId, detail.name, installedExample(added || detail, name));
    setFresh(detail.name);
  });
  const toggle = (skill, enabled) => run(async () => {
    // 库里的条目：只改这个机器人的开关（同名已开着、容量满了就说原因，不自动关别的）
    if (skill.library) {
      const r = await api(`/skill-library/items/${encodeURIComponent(skill.library.id)}/bots/${encodeURIComponent(botId)}`, { method: "PUT", body: { on: enabled } });
      setSkills(r.skills);
      if (enabled) toast(t(r.state === "waiting" || r.state === "loading" ? "skillLib.toggleWaiting" : "skillLib.toggleOn"));
      else saved();
      return;
    }
    try {
      const r = await api(`${base}/${encodeURIComponent(skill.name)}`, { method: "PUT", body: { enabled } });
      setSkills(r.skills);
      saved();
    } catch (e) {
      // 「我的技能」打开时重名：这个机器人上已有同名的技能
      if (kindOf(skill) === "mine" && e?.data?.code === "reserved_name") throw new Error(t("mySkills.list.nameTaken", { bot: botName, name: skill.name }));
      throw e;
    }
  });
  const remove = (skill) => run(async () => {
    if (!await confirmSheet({ title: t("botSettings.skills.removeTitle", { name: skill.name }), body: t("botSettings.skills.removeBody"), confirmLabel: t("common.delete"), danger: true })) return;
    const r = await api(`${base}/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
    setSkills(r.skills);
    saved();
  });
  const view = (skill, manage = false) => skill.library ? openSkillDetail({ botId, name: skill.name, kind: "library", id: skill.library.id }) : openSkillDetail({ botId, name: skill.name, kind: kindOf(skill) === "mine" ? "mine" : "imported", manage });
  const close = () => { if (!working.current) setDetail(null); };

  // —— 排序、搜索、筛选、折叠 ——
  const sorted = sortSkills(skills || [], lang);
  const searching = sorted.length > LIST_SEARCH_AT;
  const needle = searching ? fold(q.trim()) : "";
  const counts = chipCounts(sorted, needle);
  // 选中的胶囊没了（数量为 0 不显示）：回到「全部」
  const cur = searching && chip !== "all" && counts[chip] > 0 ? chip : "all";
  const rows = sorted.filter((s) => (!searching || (inChip(s, cur) && matches(s, needle))));
  const folded = searching && cur === "all" && !needle && !all && rows.length > LIST_FOLD_AT;
  const shown = folded ? rows.slice(0, LIST_FOLD_AT) : rows;
  useEffect(() => {
    // 删到 10 个及以下：搜索和胶囊消失并清空
    if (!searching && (q || chip !== "all")) { setQ(""); setChip("all"); }
  }, [searching]);

  const row = (skill) => {
    const mine = kindOf(skill) === "mine";
    const lib = !!skill.library;
    return html`<div class=${`row${fresh === skill.name ? " fresh" : ""}${skill.enabled ? "" : " skill-off"}`} key=${lib ? `l:${skill.library.id}` : `${mine ? "m" : "s"}:${skill.name}`} data-skill=${skill.name}>
      <div class="who"><div class="name skill-name"><span>${skill.title || skill.name}</span>${mine && skill.title !== skill.name && html`<span class="skill-file">${skill.name}</span>`}${skill.enabled && html`<${StateBadge} state=${skill.state} />`}${mine && skill.mine?.unverified && html`<span class="badge skill-unverified">${t("mySkills.list.unverified")}</span>`}</div>
        <div class="sub skill-desc" title=${skill.summary || skill.description}>${skill.summary || skill.description}</div><${SourceLine} source=${skill.source} /><${TryLine} botId=${botId} skill=${skill} /></div>
      <div class="ctl">
        <button type="button" class="text" disabled=${busy} onClick=${() => view(skill)}>${t(mine ? "mySkills.list.view" : "common.view")}</button>
        ${lib ? null : mine
          ? html`<button type="button" class="text" disabled=${busy} onClick=${() => view(skill, true)}>${t("mySkills.list.manage")}</button>`
          : html`<button type="button" class="text danger" disabled=${busy} onClick=${() => remove(skill)}>${t("common.delete")}</button>`}
        <span class="skill-switch" title=${t("mySkills.list.toggleHint", { bot: botName })}><${Switch} label=${t("botSettings.skills.enable", { name: skill.title || skill.name })} value=${skill.enabled} disabled=${busy} onChange=${(v) => toggle(skill, v)} /></span>
      </div>
    </div>`;
  };
  return html`
    <div class="list-head" id="bot-skills">${t("botSettings.skills.head")}</div>
    <p class="set-note">${t("botSettings.skills.note")}</p>
    ${searching && html`<div class="skill-filter">
      <div class="search skill-search"><${Icon} name="search" size="sm" />
        <input type="search" value=${q} placeholder=${t("mySkills.list.search")} aria-label=${t("mySkills.list.search")} onInput=${(e) => setQ(e.target.value)} />
        ${q && html`<button type="button" class="text" onClick=${() => setQ("")}>${t("mySkills.list.clear")}</button>`}
      </div>
      <div class="skill-chips" role="radiogroup" aria-label=${t("mySkills.list.search")}>
        ${CHIPS.filter((c) => c === "all" || counts[c] > 0).map((c) => html`<button type="button" role="radio" aria-checked=${cur === c} class=${`chip${cur === c ? " on" : ""}`} onClick=${() => setChip(c)}>${t(`mySkills.list.chips.${c}`, { count: counts[c] })}</button>`)}
      </div>
    </div>`}
    <div class="list skill-list" aria-busy=${busy}>
      <div class="row">
        <div class="who"><div class="name">${t("botSettings.skills.import")}</div><div class="sub">${t("botSettings.skills.importSub")}</div></div>
        <div class="ctl"><input type="file" accept=".zip,application/zip" hidden ref=${input} onChange=${select} />
          ${onBrowse && html`<${Button} onClick=${onBrowse}>${t("botSettings.skills.browse")}<//>`}
          <${Button} disabled=${busy || skills === null} onClick=${() => input.current?.click()}>${busy ? t("common.loading") : t("botSettings.skills.import")}<//></div>
      </div>
      <div class="row skill-lib-row">
        <div class="who"><div class="name">${t("skillLib.title")}</div><div class="sub">${t("skillLib.botRowSub")}</div></div>
        <div class="ctl">
          <${Button} disabled=${busy} onClick=${() => openLocalImport({ botId, botName })}>${t("skillLib.importLocal")}<//>
          <${Button} disabled=${busy || skills === null} onClick=${() => openLibraryAdd({ botId, botName })}>${t("skillLib.addFromLibrary")}<//></div>
      </div>
      ${error ? html`<div class="row"><div class="who">${error}</div><${Button} disabled=${busy} onClick=${reload}>${t("common.retry")}<//></div>`
        : skills === null ? html`<div class="row"><${Skeleton} w="60%" /></div>`
        : !skills.length ? html`<div class="row"><div class="sub">${t("botSettings.skills.empty")}</div></div>`
        : !shown.length ? html`<div class="row skill-none"><div class="sub">${t("mySkills.list.noMatch", { q: q.trim() })}</div><button type="button" class="text" onClick=${() => setQ("")}>${t("mySkills.list.clearSearch")}</button></div>`
        : shown.map(row)}
      ${folded && html`<div class="row skill-more"><button type="button" class="text" onClick=${() => setAll(true)}>${t("mySkills.list.showAll", { count: rows.length })}</button></div>`}
    </div>
    ${detail && html`<${Sheet} title=${detail.name} onClose=${close}>
      <p class="body">${detail.description}</p>
      <p class="body skill-meta">${t("botSettings.skills.files", { count: detail.files, size: Math.ceil(detail.bytes / 1024) })}</p>
      <p class="body">${t(detail.replaces ? "botSettings.skills.replaceBody" : "botSettings.skills.addBody")}</p>
      ${detail.shared?.length > 0 && html`<p class="body hint">${t("skillLib.shared", { bots: detail.shared.join(t("chat.use.sep")) })}</p>`}
      <details class="skill-instructions"><summary>${t("botSettings.skills.instructions")}</summary><pre>${detail.instructions}</pre></details>
      <div class="actions">
        <${Button} disabled=${busy} data-autofocus onClick=${close}>${t("common.cancel")}<//>
        <${Button} variant="primary" disabled=${busy} onClick=${install}>${t(detail.replaces ? "botSettings.skills.replace" : "botSettings.skills.add")}<//>
      </div>
    <//>`}`;
}
