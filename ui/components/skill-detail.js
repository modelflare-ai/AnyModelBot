// 技能的只读详情：机器人设置里的「查看」、过程区里点技能名、成功卡上的「查看」都打开这一份；
// 「我的技能」的「管理」是同一份详情加「导出 ZIP」「恢复上一版」「删除」。
// 「我的技能」读 /my-skills/<名字>（全局一份），其他来源读 /bots/<id>/skills/<名字>；技能已经不在了只提示一句，不打开。
import { useEffect, useState } from "preact/hooks";
import { html, Button, Icon, Sheet, Spinner } from "./ui.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, toast, useStore } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";
import { closeSkillDetail, kindOf, skillDetail } from "../lib/my-skills.js";
import { loadBotSkills } from "../lib/usage.js";
import { openGithub } from "./skill-library.js";
import { sourceLabel } from "../lib/my-library.js";

const when = (at) => (at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** 「查看」里的完整来源：仓库、路径、分支、安装时的提交号和安装时间（导入的技能） */
export function SourceDetail({ source }) {
  const at = when(source?.installedAt);
  if (source?.type !== "github") return html`<dl class="skill-source"><div><dt>${t("botSettings.skills.source")}</dt><dd>${t("botSettings.skills.zip")}</dd></div>${at && html`<div><dt>${t("botSettings.skills.installedAt")}</dt><dd>${at}</dd></div>`}</dl>`;
  return html`<dl class="skill-source">
    <div><dt>${t("botSettings.skills.source")}</dt><dd><a href=${source.url} onClick=${(e) => (e.preventDefault(), openGithub(source.url))}>${source.url}</a></dd></div>
    <div><dt>${t("botSettings.skills.repo")}</dt><dd>${source.owner}/${source.repo}</dd></div>
    <div><dt>${t("botSettings.skills.path")}</dt><dd class="mono">${source.path || t("botSettings.skills.root")}</dd></div>
    <div><dt>${t("botSettings.skills.branch")}</dt><dd class="mono">${source.ref}</dd></div>
    <div><dt>${t("botSettings.skills.commit")}</dt><dd class="mono">${source.commit.slice(0, 12)}</dd></div>
    ${at && html`<div><dt>${t("botSettings.skills.installedAt")}</dt><dd>${at}</dd></div>`}
  </dl>`;
}

/** 「我的技能」的字段：来源、已打开的机器人、用到的应用（没有时不显示）、保存时间、上一版（没有时不显示） */
function MineFields({ skill }) {
  const bots = (skill.bots || []).map((b) => skill.botNames?.[b] || b);
  const apps = (skill.apps || []).map((a) => (a.alias ? t("mySkills.card.appAlias", { app: a.name, alias: a.alias }) : a.name));
  return html`<dl class="skill-source">
    <div><dt>${t("mySkills.detail.source")}</dt><dd>${t("mySkills.detail.sourceValue")}</dd></div>
    <div><dt>${t("mySkills.detail.bots")}</dt><dd>${bots.length ? bots.join(t("chat.use.sep")) : t("mySkills.detail.noBots")}</dd></div>
    ${apps.length > 0 && html`<div><dt>${t("mySkills.detail.apps")}</dt><dd>${apps.join(t("chat.use.sep"))}</dd></div>`}
    <div><dt>${t("mySkills.detail.savedAt")}</dt><dd>${when(skill.savedAt)}</dd></div>
    ${skill.prev && html`<div><dt>${t("mySkills.detail.prev")}</dt><dd>${when(skill.prev.savedAt)}</dd></div>`}
  </dl>`;
}

/** 「我的技能库」里一项的字段：来源（本机导入时带位置）、使用它的机器人（关着的注明）、文件、导入时补全的、依赖和脚本 */
function LibraryFields({ skill }) {
  const bots = (skill.bots || []).map((b) => (b.on ? b.name : t("skillLib.detail.off", { bot: b.name })));
  const at = when(skill.source?.installedAt);
  return html`<dl class="skill-source">
    <div><dt>${t("skillLib.detail.source")}</dt><dd>${skill.source?.type === "github" ? html`<a href=${skill.source.url} onClick=${(e) => (e.preventDefault(), openGithub(skill.source.url))}>${sourceLabel(skill.source)}</a>` : sourceLabel(skill.source)}</dd></div>
    ${skill.source?.type === "local" && html`<div><dt>${t("skillLib.detail.location")}</dt><dd class="mono">${skill.source.location}</dd></div>`}
    <div><dt>${t("skillLib.detail.bots")}</dt><dd>${bots.length ? bots.join(t("chat.use.sep")) : t("skillLib.detail.noBots")}</dd></div>
    ${skill.kind !== "mine" && html`<div><dt>${t("skillLib.detail.files")}</dt><dd>${t("skillLib.detail.filesValue", { count: skill.files, size: Math.ceil((skill.bytes || 0) / 1024) })}${skill.scripts ? ` · ${t("skillLib.import.scripts")}` : ""}${skill.depsUnverified ? ` · ${t("skillLib.import.deps")}` : ""}</dd></div>`}
    ${skill.completed?.length > 0 && html`<div><dt>${t("skillLib.detail.completed")}</dt><dd>${skill.completed.map((c) => `${t(`skillLib.import.field.${c.field}`)}: ${c.value}`).join(t("chat.use.sep"))}</dd></div>`}
    ${at && skill.source?.type !== "mine" && html`<div><dt>${t("skillLib.detail.importedAt")}</dt><dd>${at}</dd></div>`}
  </dl>`;
}

/** 读一个技能的详情：「我的技能库」的条目按 id 读；「我的技能」优先（全局），其次这个机器人装的；都没有时返回 null */
export async function fetchSkillDetail(botId, name, kind, id) {
  if (kind === "library") {
    try {
      return { ...(await api(`/skill-library/items/${encodeURIComponent(id)}`)).item, libraryItem: true };
    } catch (e) {
      if (e?.status === 404) return null;
      throw e;
    }
  }
  if (kind !== "imported") {
    try {
      return { ...(await api(`/my-skills/${encodeURIComponent(name)}`)).skill, mine: true };
    } catch (e) {
      if (e?.status !== 404 || kind === "mine") throw e;
    }
  }
  if (!botId) return null;
  try {
    return (await api(`/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(name)}`)).skill;
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export function SkillDetailHost() {
  useLang();
  const req = useStore(skillDetail);
  const [skill, setSkill] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    setSkill(null);
    if (!req) return;
    let alive = true;
    fetchSkillDetail(req.botId, req.name, req.kind, req.id).then(
      (s) => {
        if (!alive) return;
        // 技能已删除，或已从这个机器人移除：只提示，不打开详情
        if (!s) {
          closeSkillDetail();
          return toast(t("mySkills.activity.gone"));
        }
        setSkill(s);
      },
      (e) => {
        if (!alive) return;
        closeSkillDetail();
        failed(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [req?.at]);
  if (!req) return null;
  if (!skill) return null;
  const close = () => !busy && closeSkillDetail();
  const mine = !skill.libraryItem && kindOf(skill) === "mine";
  const manage = mine && !!req.manage;
  const refresh = () => {
    if (req.botId) loadBotSkills(req.botId).catch(() => {});
    req.onChanged?.();
  };
  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      failed(e);
    }
    setBusy("");
  };
  const exportZip = () => run("export", async () => {
    if (skill.kept > 0 && !(await confirmSheet({ title: t("mySkills.detail.export"), body: t("mySkills.detail.exportBody", { count: skill.kept }), confirmLabel: t("mySkills.detail.exportAnyway") }))) return;
    const a = document.createElement("a");
    a.href = `/amb/api/my-skills/${encodeURIComponent(skill.name)}/export`;
    a.download = `${skill.name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(t("mySkills.detail.exported"));
  });
  const restore = () => run("restore", async () => {
    const r = await api(`/my-skills/${encodeURIComponent(skill.name)}/restore`, { method: "POST", body: {} });
    setSkill({ ...skill, ...r.skill, instructions: (await api(`/my-skills/${encodeURIComponent(skill.name)}`)).skill.instructions });
    toast(t("mySkills.detail.restored"));
    refresh();
  });
  const remove = () => run("delete", async () => {
    const rules = skill.rules || 0;
    if (!(await confirmSheet({ title: t("mySkills.detail.deleteTitle", { name: skill.title || skill.name }), body: rules ? t("mySkills.detail.deleteBodyRules", { count: rules }) : t("mySkills.detail.deleteBody"), confirmLabel: t("mySkills.detail.delete"), danger: true }))) return;
    await api(`/my-skills/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
    toast(t("mySkills.detail.deleted", { name: skill.title || skill.name }));
    closeSkillDetail();
    refresh();
  });
  const head = html`<span class="skill-detail-title"><span>${skill.title || skill.name}</span>${skill.title && skill.title !== skill.name && html`<span class="skill-file">${skill.name}</span>`}</span>`;
  return html`<${Sheet} title=${head} label=${skill.title || skill.name} onClose=${close} class="skill-detail">
    <p class="body">${skill.summary || skill.description}</p>
    ${mine && skill.unverified && html`<p class="body hint"><span class="badge skill-unverified">${t("mySkills.list.unverified")}</span> ${t("mySkills.detail.unverified")}</p>`}
    ${skill.libraryItem ? html`<${LibraryFields} skill=${skill} />` : mine ? html`<${MineFields} skill=${skill} />` : html`<p class="body skill-meta">${t("botSettings.skills.files", { count: skill.files, size: Math.ceil((skill.bytes || 0) / 1024) })}</p><${SourceDetail} source=${skill.source} />`}
    <details class="skill-instructions"><summary>${t("mySkills.card.showInstructions")}</summary><pre class="selectable">${skill.instructions}</pre></details>
    ${manage && html`<p class="hint skill-export-note">${t("mySkills.detail.exportNote")}</p>`}
    <div class="actions">
      ${manage && html`<${Button} variant="danger" class="skill-delete" loading=${busy === "delete"} disabled=${!!busy} onClick=${remove}>${t("mySkills.detail.delete")}<//>`}
      ${manage && html`<span class="grow"></span>`}
      ${manage && skill.prev && html`<${Button} loading=${busy === "restore"} disabled=${!!busy} onClick=${restore}><${Icon} name="refresh" size="sm" />${t("mySkills.detail.restore")}<//>`}
      ${manage && html`<${Button} loading=${busy === "export"} disabled=${!!busy} onClick=${exportZip}>${t("mySkills.detail.export")}<//>`}
      <${Button} data-autofocus disabled=${!!busy} onClick=${close}>${t("mySkills.detail.close")}<//>
    </div>
  <//>`;
}

/** 等详情加载时的占位（过程区点了技能名、详情还在读） */
export const DetailLoading = () => html`<span class="skill-detail-loading"><${Spinner} /></span>`;
