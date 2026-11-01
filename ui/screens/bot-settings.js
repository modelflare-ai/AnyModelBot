// 机器人设置（信息面板的 ⚙，参考 Codex 的编辑页）：返回 + 头像 + 大标题；身份是头像角色 + 带标签的输入框，其余是白色圆角 list + 行，改动即保存。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Seg, Switch, MenuButton, Notice, Skeleton, autoGrow } from "../components/ui.js";
import { BotAvatar, AvatarPicker, charOf } from "../components/avatar.js";
import { ModelPicker, shortModel } from "../components/model-picker.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, saved } from "../lib/store.js";
import { usd } from "../lib/links.js";
import { perms, fullWarning, confirmPermission } from "../lib/perms.js";
import { t } from "../lib/i18n.js";
import { RuleEditor } from "../components/rules.js";

/** 免打扰的起止：整点 */
const HOURS = Array.from({ length: 24 }, (_, h) => {
  const v = `${String(h).padStart(2, "0")}:00`;
  return [v, v];
});

function Row({ id, name, sub, title, children, off }) {
  return html`<div class=${`row${off ? " off" : ""}`} id=${`bot-${id}`} title=${title}>
    <div class="who"><div class="name">${name}</div>${sub && html`<div class="sub">${sub}</div>`}</div>
    <div class="ctl">${children}</div>
  </div>`;
}

function ModelButton({ value, models, modelsError, reloadModels, resetLabel, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return html`<button type="button" class="pick" ref=${ref} aria-haspopup="listbox" aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>
      <span class="v">${value ? shortModel(value) : resetLabel}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${ModelPicker} anchor=${ref.current} align="right" models=${models} error=${modelsError} onRetry=${reloadModels} current=${value}
      onPick=${onChange} onClose=${() => setOpen(false)} reset=${{ label: resetLabel, onSelect: () => onChange("") }} />`}`;
}

/**
 * 预算：开启后机器人用自己的 Modelflare API Key，最多花设定的美元数（包括这把 Key 已经花掉的）；
 * 用完后它的请求会被拒绝，其他机器人不受影响。需要登录 Modelflare 账户。
 */
function BudgetRows({ bot, budget, account, onSaved, onOpenSettings }) {
  const [limit, setLimit] = useState(String(budget.limitUsd));
  const [busy, setBusy] = useState(false);
  const [use, setUse] = useState(null);
  const signedIn = !!(account && account.state === "signed_in");
  useEffect(() => setLimit(String(budget.limitUsd)), [budget.limitUsd]);
  useEffect(() => {
    if (!signedIn || !budget.enabled) return setUse(null);
    api("/account/budgets").then((r) => setUse(r.budgets[bot.id] || null)).catch(() => setUse(null));
  }, [signedIn, budget.enabled, budget.limitUsd, bot.id]);
  const save = async (enabled, limitUsd) => {
    setBusy(true);
    try {
      const r = await api(`/bots/${bot.id}/budget`, { method: "PUT", body: { enabled, limitUsd } });
      onSaved(r.settings);
      saved();
    } catch (e) {
      failed(e);
      setLimit(String(budget.limitUsd));
    } finally {
      setBusy(false);
    }
  };
  const commitLimit = () => {
    const v = Number(limit);
    if (!Number.isFinite(v) || v < 0) return setLimit(String(budget.limitUsd));
    if (v !== budget.limitUsd) save(budget.enabled, v);
  };
  if (!signedIn) {
    return html`<${Row} id="budget" name=${t("botSettings.budget.name")} sub=${t("botSettings.budget.signedOut")}>
      <button type="button" class="text accent" onClick=${() => onOpenSettings("modelflare", "account")}>${t("botSettings.budget.signIn")}</button>
    <//>`;
  }
  const sub = !budget.enabled
    ? t("botSettings.budget.off")
    : use
      ? t(use.status === "exhausted" ? "botSettings.budget.exhausted" : "botSettings.budget.usage", { used: usd(use.used_usd), remain: usd(use.remain_usd) })
      : t("botSettings.budget.on");
  return html`<${Row} id="budget" name=${t("botSettings.budget.name")} sub=${sub}>
      <${Switch} label=${t("botSettings.budget.name")} value=${budget.enabled} disabled=${busy} onChange=${(v) => save(v, Number(limit) || budget.limitUsd)} />
    <//>
    <${Row} id="budget-limit" name=${t("botSettings.budget.limit")} sub=${t("botSettings.budget.limitSub")} off=${!budget.enabled}>
      <input class="field num-in" type="number" min="0" step="1" inputmode="decimal" aria-label=${t("botSettings.budget.limitLabel")} value=${limit} disabled=${!budget.enabled || busy}
        onInput=${(e) => setLimit(e.target.value)} onBlur=${commitLimit} onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} />
    <//>`;
}

/**
 * 谁能使用：只有主人和允许名单里的人。主人 = 扫码登录的微信 / 连上之后第一个发消息的人，后者可以更换（下一个发消息的人成为主人）。
 * 允许名单和拒绝过的人可以移除（移除后他再发消息会重新申请）。没有的项不显示。
 */
export function BotSettingsScreen({ bot, section, models, modelsError, reloadModels, defaultModel, account, onOpenSettings, onBack, onBotUpdated, onDeleted }) {
  const [d, setD] = useState(null);
  const [name, setName] = useState(bot.name);
  const [prompt, setPrompt] = useState(bot.systemPrompt || "");
  const promptRef = useRef(null);
  const [hi, setHi] = useState(null);
  // 规则（3d）：在这里新建；列表、详情和运行记录在信息面板的「任务」组里
  const [rules, setRules] = useState(null);
  const [newRule, setNewRule] = useState(false);
  const loadRules = () => api(`/rules?bot=${encodeURIComponent(bot.id)}`).then((x) => setRules(x.rules)).catch(() => setRules([]));
  useEffect(() => {
    setName(bot.name);
    setPrompt(bot.systemPrompt || "");
    api(`/bots/${bot.id}/settings`).then(setD).catch(failed);
    loadRules();
  }, [bot.id]);
  useEffect(() => autoGrow(promptRef.current, 320), [prompt, d]);
  useEffect(() => {
    if (section && d) requestAnimationFrame(() => document.getElementById(`bot-${section}`)?.scrollIntoView({ block: "center" }));
  }, [section, !!d]);

  const putBot = async (body) => {
    try {
      const r = await api(`/bots/${bot.id}`, { method: "PUT", body });
      onBotUpdated(r.bot);
      saved();
    } catch (e) {
      failed(e);
    }
  };
  const put = async (body) => {
    try {
      setD(await api(`/bots/${bot.id}/settings`, { method: "PUT", body }));
      saved();
    } catch (e) {
      failed(e);
    }
  };
  // 完全权限先确认
  const pickPerm = async (v) => {
    if (await confirmPermission(v)) await put({ permission: v });
  };
  const pickAvatar = async (k) => {
    await put({ avatar: k });
    setHi({ kind: "hello", at: Date.now() });
    onBotUpdated();
  };
  const del = async () => {
    if (!(await confirmSheet({ title: t("botSettings.delete.title", { name: bot.name }), body: t("botSettings.delete.body"), confirmLabel: t("botSettings.delete.confirm"), danger: true }))) return;
    try {
      await api(`/bots/${bot.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      failed(e);
    }
  };
  const commitName = () => {
    const n = name.trim();
    if (!n) return setName(bot.name);
    if (n !== bot.name) putBot({ name: n });
  };

  const s = d && d.settings;
  const cu = d && d.computerUse;
  const codex = cu && cu.backends && cu.backends.find((b) => b.id === "codex");
  return html`<section class="settings view" data-screen="bot-settings">
    <div class="set-head">
      <button type="button" class="icon-btn set-back" aria-label=${t("botSettings.back")} title=${t("botSettings.backTitle")} onClick=${onBack}><${Icon} name="arrowLeft" size="md" /></button>
      <${BotAvatar} bot=${bot} char=${s && s.avatar} size=${36} cue=${hi} pokeable />
      <div class="set-titles"><h1 class="set-title">${bot.name}</h1><div class="set-sub">${t("botSettings.title")}</div></div>
    </div>
    <div class="set-body">
      <div class="list-head">${t("botSettings.identity")}</div>
      <div class="set-field" id="bot-avatar">
        <span class="k">${t("botSettings.avatar")}<span class="hint">${t("botSettings.avatarHint")}</span></span>
        ${s ? html`<${AvatarPicker} value=${s.avatar} fallback=${charOf(bot)} onChange=${pickAvatar} />` : html`<${Skeleton} w="60%" />`}
      </div>
      <label class="set-field" id="bot-name">
        <span class="k">${t("botSettings.name")}</span>
        <input class="field" value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)} onBlur=${commitName}
          onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setName(bot.name); requestAnimationFrame(() => e.target.blur()); } }} />
      </label>
      <label class="set-field" id="bot-prompt">
        <span class="k">${t("botSettings.prompt")}<span class="hint">${t("botSettings.promptHint")}</span></span>
        <textarea class="field" ref=${promptRef} placeholder=${t("botSettings.promptPlaceholder")} value=${prompt}
          onInput=${(e) => setPrompt(e.target.value)} onBlur=${() => prompt !== (bot.systemPrompt || "") && putBot({ systemPrompt: prompt })} />
      </label>

      <div class="list-head">${t("botSettings.model.head")}</div>
      <div class="list">
        <${Row} id="model" name=${t("botSettings.model.default")} sub=${t("botSettings.model.defaultSub")}>
          <${ModelButton} value=${bot.defaultModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
            resetLabel=${defaultModel ? t("botSettings.model.followGlobalWith", { model: shortModel(defaultModel) }) : t("botSettings.model.followGlobal")} onChange=${(m) => putBot({ defaultModel: m })} />
        <//>
        <${Row} id="utility" name=${t("botSettings.model.utility")} sub=${t("botSettings.model.utilitySub")}>
          ${s && html`<${ModelButton} value=${s.utilityModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} resetLabel=${t("botSettings.model.sameAsChat")} onChange=${(m) => put({ utilityModel: m })} />`}
        <//>
        ${s && account && html`<${BudgetRows} bot=${bot} budget=${s.budget} account=${account} onOpenSettings=${onOpenSettings}
          onSaved=${(settings) => setD((v) => ({ ...v, settings }))} />`}
      </div>

      ${!s && html`<div class="list"><div class="row"><${Skeleton} w="45%" /></div><div class="row"><${Skeleton} w="35%" /></div></div>`}
      ${s && html`
        <div class="list-head">${t("botSettings.perm.head")}</div>
        <div class="list">
          <${Row} id="permission" name=${t("botSettings.perm.name")} sub=${perms()[s.permission]?.note ?? ""}
            title=${t("botSettings.perm.title")}>
            <${Seg} label=${t("botSettings.perm.name")} value=${s.permission} onChange=${pickPerm} options=${[["workspace", t("botSettings.perm.workspace")], ["readonly", t("botSettings.perm.readonly")], ["full", t("botSettings.perm.full")]]} />
          <//>
        </div>
        ${s.permission === "full" && html`<${Notice} tone="red">${fullWarning()}<//>`}


        <div class="list-head">${t("botSettings.memory.head")}</div>
        <div class="list">
          <${Row} id="memory" name=${t("botSettings.memory.name")} sub="remember / forget / recall">
            <${Switch} label=${t("botSettings.memory.name")} value=${s.memory.enabled} onChange=${(v) => put({ memory: { enabled: v } })} />
          <//>
          <${Row} id="memory-review" name=${t("botSettings.memory.review")} off=${!s.memory.enabled}>
            <${Switch} label=${t("botSettings.memory.reviewLabel")} value=${s.memory.review} disabled=${!s.memory.enabled} onChange=${(v) => put({ memory: { review: v } })} />
          <//>
          <${Row} id="memory-team" name=${t("botSettings.memory.team")} sub=${t("botSettings.memory.teamSub")} off=${!s.memory.enabled}>
            <${Switch} label=${t("botSettings.memory.teamLabel")} value=${s.memory.teamWrite} disabled=${!s.memory.enabled} onChange=${(v) => put({ memory: { teamWrite: v } })} />
          <//>
        </div>

        <div class="list-head">${t("botSettings.context.head")}</div>
        <div class="list">
          <${Row} id="steward" name=${t("botSettings.context.name")} sub=${t("botSettings.context.sub")}>
            <${Switch} label=${t("botSettings.context.label")} value=${s.steward.enabled} onChange=${(v) => put({ steward: { enabled: v } })} />
          <//>
        </div>

        <div class="list-head">${t("botSettings.proactive.head")}</div>
        <div class="list">
          <${Row} id="pause" name=${t("botSettings.proactive.pause")} sub=${t("botSettings.proactive.pauseSub")}>
            <${Switch} label=${t("botSettings.proactive.pause")} value=${s.paused} onChange=${(v) => put({ paused: v })} />
          <//>
          <${Row} id="quiet" name=${t("botSettings.proactive.quiet")} sub=${t("botSettings.proactive.quietSub")}>
            ${s.quietHours.enabled && html`<${MenuButton} label=${t("botSettings.proactive.quietFrom")} value=${s.quietHours.from} width=${120} options=${HOURS}
                onChange=${(v) => put({ quietHours: { from: v } })} />
              <span class="range-dash">–</span>
              <${MenuButton} label=${t("botSettings.proactive.quietTo")} value=${s.quietHours.to} width=${120} options=${HOURS}
                onChange=${(v) => put({ quietHours: { to: v } })} />`}
            <${Switch} label=${t("botSettings.proactive.quiet")} value=${s.quietHours.enabled} onChange=${(v) => put({ quietHours: { enabled: v } })} />
          <//>
          <${Row} id="nudge" name=${t("botSettings.proactive.nudge")} sub=${t("botSettings.proactive.nudgeSub")}>
            <${Switch} label=${t("botSettings.proactive.nudge")} value=${s.nudge} onChange=${(v) => put({ nudge: v })} />
          <//>
          <${Row} id="rules" name=${t("botSettings.proactive.rules")} sub=${rules && rules.length ? t("botSettings.proactive.rulesCount", { count: rules.length }) : t("botSettings.proactive.rulesSub")}>
            <button type="button" class="btn" onClick=${() => setNewRule(true)}>${t("botSettings.proactive.newRule")}</button>
          <//>
        </div>
        ${newRule && html`<${RuleEditor} botId=${bot.id} onClose=${() => setNewRule(false)} onSaved=${() => (setNewRule(false), loadRules())} />`}

        <div class="list-head">${t("botSettings.computer.head")}</div>
        <div class="list">
          <${Row} id="computer" name=${t("botSettings.computer.head")} sub=${cu ? cu.reason : ""} title=${cu && cu.notice}>
            <span class=${`dot ${cu && cu.available ? "ok" : "err"}`}></span>
            <${Switch} label=${t("botSettings.computer.head")} value=${s.computerUse.enabled} onChange=${(v) => put({ computerUse: { enabled: v } })} />
          <//>
          <${Row} id="computer-backend" name=${t("botSettings.computer.backend")} off=${!s.computerUse.enabled}>
            <${MenuButton} label=${t("botSettings.computer.backendLabel")} value=${s.computerUse.backend} disabled=${!s.computerUse.enabled} onChange=${(v) => put({ computerUse: { backend: v } })}
              options=${[["cua", "Cua Driver", t("botSettings.computer.cuaNote")], ...(codex ? [["codex", t("botSettings.computer.codex"), codex.available ? t("botSettings.computer.macOnly") : t("botSettings.computer.macOnlyUnavailable")]] : [])]} />
          <//>
          <${Row} id="computer-approval" name=${t("botSettings.computer.approval")} sub=${s.computerUse.approval === "auto" ? t("botSettings.computer.autoSub") : t("botSettings.computer.askSub")} off=${!s.computerUse.enabled}>
            <${Seg} label=${t("botSettings.computer.approvalLabel")} value=${s.computerUse.approval} disabled=${!s.computerUse.enabled} onChange=${(v) => put({ computerUse: { approval: v } })}
              options=${[["auto", t("botSettings.computer.auto")], ["ask-input", t("botSettings.computer.ask")]]} />
          <//>
        </div>

        <div class="list-head">${t("botSettings.media.head")}</div>
        <div class="list">
          <${Row} id="media-confirm" name=${t("botSettings.media.confirm")}
            sub=${s.media.confirm === "always" ? t("botSettings.media.alwaysSub") : t("botSettings.media.autoSub")}>
            <${Seg} label=${t("botSettings.media.confirm")} value=${s.media.confirm} onChange=${(v) => put({ media: { confirm: v } })}
              options=${[["auto", t("botSettings.media.auto")], ["always", t("botSettings.media.always")]]} />
          <//>
        </div>
      `}

      <div class="list-head">${t("botSettings.danger.head")}</div>
      <div class="list">
        <${Row} id="delete" name=${t("botSettings.danger.delete")} sub=${t("botSettings.danger.deleteSub")}>
          <button type="button" class="text danger" onClick=${del}>${t("botSettings.danger.delete")}</button>
        <//>
      </div>
    </div>
  </section>`;
}
