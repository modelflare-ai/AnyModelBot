// 机器人设置（信息面板的 ⚙，参考 Codex 的编辑页）：返回 + 头像 + 大标题；身份是头像角色 + 带标签的输入框，其余是白色圆角 list + 行，改动即保存。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Seg, Switch, MenuButton, Notice, Skeleton, autoGrow } from "../components/ui.js";
import { BotAvatar, AvatarPicker, charOf } from "../components/avatar.js";
import { ModelPicker, shortModel } from "../components/model-picker.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, saved } from "../lib/store.js";
import { usd } from "../lib/links.js";
import { PERMS, FULL_WARNING, confirmPermission } from "../lib/perms.js";
import { CHANNEL_NAME, SOURCE_LABEL } from "../lib/access.js";
import { fmtAgo } from "../lib/format.js";

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
    return html`<${Row} id="budget" name="预算" sub="登录 Modelflare 账户后，可以给这个机器人单独设花费上限">
      <button type="button" class="text accent" onClick=${() => onOpenSettings("modelflare", "account")}>去登录</button>
    <//>`;
  }
  const sub = !budget.enabled
    ? "与其他机器人共用本机的 Key，不单独限额"
    : use
      ? `已用 ${usd(use.used_usd)}，还剩 ${usd(use.remain_usd)}${use.status === "exhausted" ? " · 已用完，机器人暂停调用模型" : ""}`
      : "用这个机器人自己的 Key，花到上限就停";
  return html`<${Row} id="budget" name="预算" sub=${sub}>
      <${Switch} label="预算" value=${budget.enabled} disabled=${busy} onChange=${(v) => save(v, Number(limit) || budget.limitUsd)} />
    <//>
    <${Row} id="budget-limit" name="上限（美元）" sub="包括已经花掉的部分；调高后用完的 Key 会自动恢复" off=${!budget.enabled}>
      <input class="field num-in" type="number" min="0" step="1" inputmode="decimal" aria-label="预算上限（美元）" value=${limit} disabled=${!budget.enabled || busy}
        onInput=${(e) => setLimit(e.target.value)} onBlur=${commitLimit} onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} />
    <//>`;
}

/**
 * 谁能使用：只有主人和允许名单里的人。主人 = 扫码登录的微信 / 在应用里设的飞书主人；
 * 允许名单和拒绝过的人可以移除（移除后他再发消息会重新申请）。
 */
function AccessRows({ botId }) {
  const [d, setD] = useState(null);
  const load = () => api(`/bots/${botId}/access`).then(setD).catch(failed);
  useEffect(() => {
    load();
  }, [botId]);
  const call = async (path, method) => {
    try {
      await api(`/bots/${botId}/access/${path}`, method === "DELETE" ? { method } : { method, body: {} });
      saved();
      load();
    } catch (e) {
      failed(e);
    }
  };
  const remove = async (e) => {
    const denied = e.status === "denied";
    if (!(await confirmSheet({
      title: denied ? `移除「${e.who}」？` : `不再允许「${e.who}」使用？`,
      body: denied ? "移除后他再发消息，会重新出现在信息面板的使用请求里。" : "他再发消息时只会收到一句提示，需要你重新允许。",
      confirmLabel: "移除",
      danger: !denied,
    }))) return;
    call(encodeURIComponent(e.id), "DELETE");
  };
  const clearOwner = async (ch, o) => {
    if (!(await confirmSheet({ title: `取消${CHANNEL_NAME[ch]}主人？`, body: `「${o.who}」之后发消息需要重新被允许；下一个发消息的人可以在信息面板里设为主人。`, confirmLabel: "取消主人", danger: true }))) return;
    call(encodeURIComponent(o.entryId), "DELETE");
  };
  if (!d) return html`<div class="list-head">谁能使用</div><div class="list"><div class="row"><${Skeleton} w="45%" /></div></div>`;
  const allowed = d.entries.filter((e) => e.status === "allowed");
  const denied = d.entries.filter((e) => e.status === "denied");
  const owner = (ch) => {
    const o = d.owners[ch];
    const sub = o
      ? `${o.who} · ${o.via === "login" ? "扫码登录的微信" : "在应用里设的"}`
      : ch === "weixin"
        ? "扫码登录后，扫码的那个微信就是主人"
        : "还没有：第一个给机器人发消息的人会出现在信息面板，点「设为主人」";
    return html`<${Row} id=${`access-${ch}`} name=${`${CHANNEL_NAME[ch]}主人`} sub=${sub}>
      ${o && o.via === "app" && html`<button type="button" class="text" onClick=${() => clearOwner(ch, o)}>取消</button>`}
    <//>`;
  };
  return html`<div class="list-head">谁能使用</div>
    <div class="list">
      <${Row} id="access" name="只有主人和你允许的人" sub="其他人发消息只会收到一句提示，不会调用模型；请求出现在信息面板，也会带配对码发给主人" />
      ${owner("weixin")}
      ${owner("feishu")}
    </div>
    <div class="list-head">允许名单${allowed.length > 0 && html`<span class="badge count">${allowed.length}</span>`}</div>
    <div class="list">
      ${!allowed.length && html`<div class="row"><span class="hint">还没有允许别人。有人给机器人发消息后，会出现在信息面板的「使用请求」里。</span></div>`}
      ${allowed.map((e) => html`<${Row} key=${e.id} id=${`access-${e.id}`} name=${e.who} sub=${[SOURCE_LABEL[e.source] || e.source, e.decidedAt ? fmtAgo(e.decidedAt) : ""].filter(Boolean).join(" · ")}>
        <button type="button" class="text danger" onClick=${() => remove(e)}>移除</button>
      <//>`)}
    </div>
    ${denied.length > 0 && html`<div class="list-head">拒绝过的人</div>
      <div class="list">
        ${denied.map((e) => html`<${Row} key=${e.id} id=${`access-${e.id}`} name=${e.who} sub=${`${fmtAgo(e.decidedAt)}拒绝 · 他再发消息不会收到任何回复`}>
          <button type="button" class="text accent" onClick=${() => call(`${encodeURIComponent(e.id)}/approve`, "POST")}>允许</button>
          <button type="button" class="text" onClick=${() => remove(e)}>移除</button>
        <//>`)}
      </div>`}`;
}

export function BotSettingsScreen({ bot, section, models, modelsError, reloadModels, defaultModel, account, onOpenSettings, onBack, onBotUpdated, onDeleted }) {
  const [d, setD] = useState(null);
  const [name, setName] = useState(bot.name);
  const [prompt, setPrompt] = useState(bot.systemPrompt || "");
  const promptRef = useRef(null);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    setName(bot.name);
    setPrompt(bot.systemPrompt || "");
    api(`/bots/${bot.id}/settings`).then(setD).catch(failed);
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
    if (!(await confirmSheet({ title: `删除「${bot.name}」？`, body: "会永久删除这个机器人及其全部会话，无法恢复。", confirmLabel: "永久删除", danger: true }))) return;
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
      <button type="button" class="icon-btn set-back" aria-label="返回对话" title="返回对话（Esc）" onClick=${onBack}><${Icon} name="arrowLeft" size=${16} /></button>
      <${BotAvatar} bot=${bot} char=${s && s.avatar} size=${36} cue=${hi} pokeable />
      <div class="set-titles"><h1 class="set-title">${bot.name}</h1><div class="set-sub">机器人设置</div></div>
    </div>
    <div class="set-body">
      <div class="list-head">身份</div>
      <div class="set-field" id="bot-avatar">
        <span class="k">头像<span class="hint">每个角色有自己的小动作</span></span>
        ${s ? html`<${AvatarPicker} value=${s.avatar} fallback=${charOf(bot)} onChange=${pickAvatar} />` : html`<${Skeleton} w="60%" />`}
      </div>
      <label class="set-field" id="bot-name">
        <span class="k">名称</span>
        <input class="field" value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)} onBlur=${commitName}
          onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setName(bot.name); requestAnimationFrame(() => e.target.blur()); } }} />
      </label>
      <label class="set-field" id="bot-prompt">
        <span class="k">人设 / 系统提示词<span class="hint">离开输入框时保存，下一条消息起生效</span></span>
        <textarea class="field" ref=${promptRef} placeholder="例如：你是一个乐于助人的中文助手，回答简洁准确。" value=${prompt}
          onInput=${(e) => setPrompt(e.target.value)} onBlur=${() => prompt !== (bot.systemPrompt || "") && putBot({ systemPrompt: prompt })} />
      </label>

      <div class="list-head">模型</div>
      <div class="list">
        <${Row} id="model" name="默认模型" sub="会话里还可以临时切换">
          <${ModelButton} value=${bot.defaultModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
            resetLabel=${`跟随全局默认${defaultModel ? `（${shortModel(defaultModel)}）` : ""}`} onChange=${(m) => putBot({ defaultModel: m })} />
        <//>
        <${Row} id="utility" name="后台小任务模型" sub="记忆整理、上下文管家与交接便条">
          ${s && html`<${ModelButton} value=${s.utilityModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} resetLabel="与对话模型相同" onChange=${(m) => put({ utilityModel: m })} />`}
        <//>
        ${s && account && html`<${BudgetRows} bot=${bot} budget=${s.budget} account=${account} onOpenSettings=${onOpenSettings}
          onSaved=${(settings) => setD((v) => ({ ...v, settings }))} />`}
      </div>

      ${!s && html`<div class="list"><div class="row"><${Skeleton} w="45%" /></div><div class="row"><${Skeleton} w="35%" /></div></div>`}
      ${s && html`
        <div class="list-head">权限</div>
        <div class="list">
          <${Row} id="permission" name="文件权限" sub=${PERMS[s.permission] ? PERMS[s.permission].note : ""}
            title="工作区可写（默认）：只能改本机器人工作区，越界操作需审批；只读：不能改文件，命令在只读沙箱中运行；完全权限：命令不经沙箱，只有递归删除仍需确认">
            <${Seg} label="文件权限" value=${s.permission} onChange=${pickPerm} options=${[["workspace", "工作区可写"], ["readonly", "只读"], ["full", "完全权限"]]} />
          <//>
        </div>
        ${s.permission === "full" && html`<${Notice} tone="red">${FULL_WARNING}<//>`}

        <${AccessRows} botId=${bot.id} />

        <div class="list-head">记忆</div>
        <div class="list">
          <${Row} id="memory" name="长期记忆" sub="remember / forget / recall">
            <${Switch} label="长期记忆" value=${s.memory.enabled} onChange=${(v) => put({ memory: { enabled: v } })} />
          <//>
          <${Row} id="memory-review" name="回合结束后自动整理" off=${!s.memory.enabled}>
            <${Switch} label="自动整理记忆" value=${s.memory.review} disabled=${!s.memory.enabled} onChange=${(v) => put({ memory: { review: v } })} />
          <//>
          <${Row} id="memory-team" name="允许写入团队记忆" sub="所有机器人共享" off=${!s.memory.enabled}>
            <${Switch} label="团队记忆" value=${s.memory.teamWrite} disabled=${!s.memory.enabled} onChange=${(v) => put({ memory: { teamWrite: v } })} />
          <//>
        </div>

        <div class="list-head">上下文</div>
        <div class="list">
          <${Row} id="steward" name="自动压缩或开新段" sub="上下文变长时整理，并留下交接便条">
            <${Switch} label="上下文管家" value=${s.steward.enabled} onChange=${(v) => put({ steward: { enabled: v } })} />
          <//>
        </div>

        <div class="list-head">电脑操作</div>
        <div class="list">
          <${Row} id="computer" name="电脑操作" sub=${cu ? cu.reason : ""} title=${cu && cu.notice}>
            <span class=${`dot ${cu && cu.available ? "ok" : "err"}`}></span>
            <${Switch} label="电脑操作" value=${s.computerUse.enabled} onChange=${(v) => put({ computerUse: { enabled: v } })} />
          <//>
          <${Row} id="computer-backend" name="后端" off=${!s.computerUse.enabled}>
            <${MenuButton} label="电脑操作后端" value=${s.computerUse.backend} disabled=${!s.computerUse.enabled} onChange=${(v) => put({ computerUse: { backend: v } })}
              options=${[["cua", "Cua Driver", "随附，macOS / Windows / Linux"], ...(codex ? [["codex", "Codex 桥", codex.available ? "仅 macOS" : "仅 macOS，本机不可用"]] : [])]} />
          <//>
          <${Row} id="computer-approval" name="审批" sub=${s.computerUse.approval === "auto" ? "所有操作自动执行" : "点击、输入等改变界面的操作先问我；读取界面仍自动"} off=${!s.computerUse.enabled}>
            <${Seg} label="电脑操作审批" value=${s.computerUse.approval} disabled=${!s.computerUse.enabled} onChange=${(v) => put({ computerUse: { approval: v } })}
              options=${[["auto", "自动执行"], ["ask-input", "改变界面前先问我"]]} />
          <//>
        </div>

        <div class="list-head">生图 / 生视频</div>
        <div class="list">
          <${Row} id="media-confirm" name="生成前确认"
            sub=${s.media.confirm === "always" ? "每次生成前都问我用哪个模型" : "默认模型能用、花费不高时直接生成；换模型、预计超过 $0.5 或要求不明确时先问我"}>
            <${Seg} label="生成前确认" value=${s.media.confirm} onChange=${(v) => put({ media: { confirm: v } })}
              options=${[["auto", "需要时再问"], ["always", "每次都问"]]} />
          <//>
        </div>
      `}

      <div class="list-head">危险操作</div>
      <div class="list">
        <${Row} id="delete" name="删除机器人" sub="永久删除这个机器人及其全部会话">
          <button type="button" class="text danger" onClick=${del}>删除机器人</button>
        <//>
      </div>
    </div>
  </section>`;
}
