// 对话里的技能安装卡片（src/skills/installs.ts）：读取中 → 等你确认 → 安装中 → 已安装 / 已替换；任一步可能失败，另有已取消、已过期。
// 用户点「安装」才写入文件，只装到这个机器人上。按钮都是原生按钮：Tab 聚焦、回车触发；状态变化经 aria-live 播报。
import { useCallback, useEffect, useState } from "preact/hooks";
import { html, Button, Icon, Spinner } from "./ui.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";
import { t } from "../lib/i18n.js";
import { openGithub } from "./skill-library.js";
import { copyExample, fillChat, useBotSkills, useSkillReady } from "../lib/usage.js";

const FINAL = ["installed", "replaced", "failed", "canceled", "expired"];

const fmtSize = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const sourceText = (src) => (src?.type === "github" ? t("skills.card.sourceGithub", { repo: `${src.owner}/${src.repo}` }) : src?.type === "local" ? t("skillLib.sourceLocal") : t("skills.card.sourceZip"));
const licenseText = (l) => (l === null || l === undefined ? t("skills.card.licenseNone") : l === "NOASSERTION" ? t("skills.detail.customLicense") : l);

function errorText(c) {
  const e = c.error || { code: "network" };
  // 名字被「我的技能」占用（R9）
  if (e.code === "mine_name") return t("mySkills.list.mineName", { name: e.name ?? "", title: e.title ?? "" });
  const known = ["invalid_link", "repo_not_found", "missing_skill", "multiple_skills", "invalid_skill", "too_large", "unsafe_path", "too_many", "reserved_name", "conflict", "rate_limited"];
  const code = known.includes(e.code) ? e.code : "network";
  const time = e.resetAt ? new Date(e.resetAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  return t(`skills.err.${code}`, { n: e.n ?? 2, bot: c.botName, name: e.name ?? "", time });
}

/**
 * 装好以后那一句：写明什么时候能用。还没取到状态时按加载中说（加载完成前不说已经可用）；
 * 关着的（替换时保留了关闭状态）、机器人已删除的照原来的说法。
 */
function readyText(c, mine) {
  const replaced = c.state === "replaced";
  const name = c.skill?.name ?? "";
  if (!c.botExists || mine?.enabled === false) return t(replaced ? "skills.card.replaced" : "skills.card.installed", { bot: c.botName, name });
  const state = !mine ? "loading" : mine.state === "waiting" || mine.state === "loading" ? mine.state : "active";
  const key = state === "active" ? "" : state === "waiting" ? "Waiting" : "Loading";
  return t(`skills.card.${replaced ? "replaced" : "installed"}${key}`, { bot: c.botName, name });
}

export function SkillInstallCard({ id }) {
  const [c, setC] = useState(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api(`/skill-installs/${encodeURIComponent(id)}`).then((d) => setC(d.install)).catch(() => setGone(true)), [id]);
  useEffect(() => {
    load();
  }, [load]);
  // 读取、安装时勤着看；等确认时也看（渠道里可能先回了 y / n，卡片还会过期）
  useEffect(() => {
    if (!c || FINAL.includes(c.state)) return;
    const timer = setInterval(load, c.state === "pending" ? 5000 : 1000);
    return () => clearInterval(timer);
  }, [c && c.state, load]);
  // GitHub 限流：到解除时间后「重试」按钮自己出来
  const [, tick] = useState(0);
  const resetAt = c?.state === "failed" && c.error?.code === "rate_limited" ? c.error.resetAt ?? 0 : 0;
  // 装好以后：这个技能现在能不能用、怎么说（机器人的技能清单，没生效时自己刷新）
  const done = !!c && (c.state === "installed" || c.state === "replaced");
  const botSkills = useBotSkills(done && c.botExists ? c.botId : null);
  // 还没生效（加载中、等当前任务结束）时自己刷新清单，说法跟着换（和存成技能的卡片一样）
  useSkillReady(done && c.botExists ? c.botId : null, c?.skill?.name);
  useEffect(() => {
    if (!resetAt || resetAt <= Date.now()) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(resetAt - Date.now() + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [resetAt]);
  if (gone) return html`<div class="card skill-card done"><div class="q-detail">${t("skills.card.missing")}</div></div>`;
  if (!c) return html`<div class="card skill-card"><span class="skill-card-line"><${Spinner} />${t("skills.card.reading")}</span></div>`;

  const act = async (op) => {
    setBusy(true);
    try {
      const r = await api(`/skill-installs/${encodeURIComponent(id)}/${op}`, { method: "POST", body: {} });
      setC(r.install);
    } catch (e) {
      failed(e);
      load();
    }
    setBusy(false);
  };
  const toggleFull = async () => {
    if (open) return setOpen(false);
    if (full === null) {
      try {
        setFull((await api(`/skill-installs/${encodeURIComponent(id)}/instructions`)).instructions);
      } catch (e) {
        return failed(e);
      }
    }
    setOpen(true);
  };
  const s = c.skill;
  const pending = c.state === "pending";
  const mine = done && s ? botSkills?.find((x) => x.name === s.name) : undefined;
  const example = mine?.enabled && mine.modelInvocable !== false ? mine.example : "";
  const where = s ? [`${s.source.owner}/${s.source.repo}`, s.source.path, s.source.ref].filter(Boolean).join(" · ") : "";
  const settingsHref = `#/bot/${encodeURIComponent(c.botId)}/settings/skills`;
  const retryable = c.state === "failed" && ["network", "rate_limited"].includes(c.error?.code || "network") && !(c.error?.code === "rate_limited" && (c.error.resetAt ?? 0) > Date.now());
  return html`<div class=${`card skill-card${FINAL.includes(c.state) ? " done" : ""}`} aria-live="polite">
    <div class="q">${t("skills.card.title", { bot: c.botName })}</div>
    ${c.state === "reading" && html`<span class="skill-card-line"><${Spinner} />${t("skills.card.reading")}</span>`}
    ${s && html`<div class="skill-card-body">
      <div class="skill-card-name">${s.name}</div>
      <div class=${`skill-card-desc${open ? "" : " clamp"}`}>${s.description}</div>
      ${pending && c.instructions && html`<button type="button" class="text skill-card-more" aria-expanded=${open} onClick=${toggleFull}>${t(open ? "skills.card.hideFull" : "skills.card.showFull")}</button>`}
      ${open && full !== null && html`<pre class="skill-card-full">${full}</pre>`}
      <div class="skill-card-meta">
        <span>${where}</span>
        <a href=${s.source.url} onClick=${(e) => (e.preventDefault(), openGithub(s.source.url))}>GitHub<${Icon} name="ext" size="xs" /></a>
      </div>
      <div class="skill-card-meta">${t("skills.card.license", { license: licenseText(s.license) })} · ${t("skills.card.files", { count: s.files, size: fmtSize(s.bytes) })}</div>
      ${pending && s.scripts > 0 && html`<p class="skill-card-hint">${t("skills.card.scripts", { count: s.scripts, permission: t(`skills.card.perm.${c.permission || "workspace"}`) })}</p>`}
      ${pending && s.replaces && html`<p class="skill-card-hint">${t("skills.card.replaceHint", { name: s.name, source: sourceText(s.replaces.source) })}</p>`}
      ${pending && s.replaces?.shared?.length > 0 && html`<p class="skill-card-hint">${t("skillLib.shared", { bots: s.replaces.shared.join(t("chat.use.sep")) })}</p>`}
    </div>`}
    ${c.state === "installing" && html`<span class="skill-card-line"><${Spinner} />${t("skills.card.installing")}</span>`}
    ${done && html`<div class="skill-card-result">${readyText(c, mine)}</div>`}
    ${done && example && html`<p class="skill-card-try">${t("chat.use.try", { example })}</p>`}
    ${done && mine?.enabled && mine.modelInvocable === false && html`<p class="skill-card-hint">${t("botSettings.skills.manualOnly", { name: mine.name })}</p>`}
    ${c.state === "canceled" && html`<div class="skill-card-result">${t("skills.card.canceled")}</div>`}
    ${c.state === "expired" && html`<div class="skill-card-result">${t("skills.card.expired")}</div>`}
    ${c.state === "failed" && html`<div class="skill-card-result warn">${errorText(c)}</div>`}
    ${pending && html`<div class="skill-card-foot">
      <span class="hint">${t("skills.card.scope", { bot: c.botName })}</span>
      <span class="actions">
        <${Button} disabled=${busy} onClick=${() => act("cancel")}>${t("skills.card.cancel")}<//>
        <${Button} variant="primary" disabled=${busy} onClick=${() => act("install")}>${t(s?.replaces ? "skills.card.replace" : "skills.card.install")}<//>
      </span>
    </div>`}
    ${done && c.botExists && html`<div class="actions">
      ${example && html`<${Button} variant="primary" onClick=${() => fillChat(c.botId, example)}>${t("chat.use.fill")}<//>`}
      ${example && html`<${Button} onClick=${() => copyExample(example)}>${t("chat.use.copy")}<//>`}
      <a class="btn" href=${settingsHref}>${t("skills.card.viewSettings")}</a>
    </div>`}
    ${c.state === "failed" && (retryable || c.error?.code === "network" || c.error?.code === "too_many") && html`<div class="actions">
      ${retryable && html`<${Button} disabled=${busy} onClick=${() => act("retry")}>${t("skills.card.retry")}<//>`}
      ${c.error?.code === "network" && html`<a class="btn" href="#/settings/network">${t("skills.card.network")}</a>`}
      ${c.error?.code === "too_many" && c.botExists && html`<a class="btn" href=${settingsHref}>${t("skills.card.openSettings")}</a>`}
    </div>`}
  </div>`;
}
