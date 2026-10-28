// 机器人设置（信息面板的 ⚙）：同样的白色圆角 list + 行，改动即保存。
import { useEffect, useRef, useState } from "preact/hooks";
import { html, Icon, Seg, MenuButton, autoGrow } from "../components/ui.js";
import { BotAvatar } from "../components/avatar.js";
import { ModelPicker, shortModel } from "../components/model-picker.js";
import { api } from "../lib/api.js";
import { confirmSheet, failed, saved } from "../lib/store.js";

const ONOFF = [
  [false, "关"],
  [true, "开"],
];

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

export function BotSettingsScreen({ bot, section, models, modelsError, reloadModels, defaultModel, onBack, onBotUpdated, onDeleted }) {
  const [d, setD] = useState(null);
  const [name, setName] = useState(bot.name);
  const [prompt, setPrompt] = useState(bot.systemPrompt || "");
  const promptRef = useRef(null);
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
      <div class="bot-head">
        <button type="button" class="icon-btn" aria-label="返回对话" title="返回对话（Esc）" onClick=${onBack}><${Icon} name="chevLeft" /></button>
        <${BotAvatar} name=${bot.name} id=${bot.id} size=${26} />
        <span class="grow">${bot.name} · 设置</span>
      </div>
    </div>
    <div class="set-body">
      <div class="list-head">身份</div>
      <div class="list">
        <${Row} id="name" name="名称">
          <input class="inline-input" value=${name} aria-label="名称" maxlength="60" onInput=${(e) => setName(e.target.value)} onBlur=${commitName}
            onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.stopPropagation(); setName(bot.name); requestAnimationFrame(() => e.target.blur()); } }} />
        <//>
        <${Row} id="prompt" name="人设 / 系统提示词" sub="离开输入框时保存" />
        <div class="prompt-edit">
          <textarea class="field" ref=${promptRef} aria-label="人设 / 系统提示词" placeholder="例如：你是一个乐于助人的中文助手，回答简洁准确。" value=${prompt}
            onInput=${(e) => setPrompt(e.target.value)} onBlur=${() => prompt !== (bot.systemPrompt || "") && putBot({ systemPrompt: prompt })} />
        </div>
      </div>

      <div class="list-head">模型</div>
      <div class="list">
        <${Row} id="model" name="默认模型" sub="会话里还可以临时切换">
          <${ModelButton} value=${bot.defaultModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels}
            resetLabel=${`跟随全局默认${defaultModel ? `（${shortModel(defaultModel)}）` : ""}`} onChange=${(m) => putBot({ defaultModel: m })} />
        <//>
        <${Row} id="utility" name="后台小任务模型" sub="记忆整理、上下文管家与交接便条">
          ${s && html`<${ModelButton} value=${s.utilityModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} resetLabel="与对话模型相同" onChange=${(m) => put({ utilityModel: m })} />`}
        <//>
      </div>

      ${!s && html`<div class="list" style="margin-top:8px"><div class="row"><span class="skel" style="width:45%"></span></div><div class="row"><span class="skel" style="width:35%"></span></div></div>`}
      ${s && html`
        <div class="list-head">权限</div>
        <div class="list">
          <${Row} id="permission" name="文件权限" sub=${s.permission === "readonly" ? "不能改文件，命令在只读沙箱中运行" : "只能改本机器人工作区，越界操作需要你批准"}
            title="工作区可写（默认）：只能改本机器人工作区，越界操作需审批；只读：不能改文件，命令在只读沙箱中运行">
            <${Seg} label="文件权限" value=${s.permission} onChange=${(v) => put({ permission: v })} options=${[["workspace", "工作区可写"], ["readonly", "只读"]]} />
          <//>
        </div>

        <div class="list-head">记忆</div>
        <div class="list">
          <${Row} id="memory" name="长期记忆" sub="remember / forget / recall">
            <${Seg} label="长期记忆" value=${s.memory.enabled} onChange=${(v) => put({ memory: { enabled: v } })} options=${ONOFF} />
          <//>
          <${Row} id="memory-review" name="回合结束后自动整理" off=${!s.memory.enabled}>
            <${Seg} label="自动整理记忆" value=${s.memory.review} disabled=${!s.memory.enabled} onChange=${(v) => put({ memory: { review: v } })} options=${ONOFF} />
          <//>
          <${Row} id="memory-team" name="允许写入团队记忆" sub="所有机器人共享" off=${!s.memory.enabled}>
            <${Seg} label="团队记忆" value=${s.memory.teamWrite} disabled=${!s.memory.enabled} onChange=${(v) => put({ memory: { teamWrite: v } })} options=${ONOFF} />
          <//>
        </div>

        <div class="list-head">上下文</div>
        <div class="list">
          <${Row} id="steward" name="自动压缩或开新段" sub="上下文变长时整理，并留下交接便条">
            <${Seg} label="上下文管家" value=${s.steward.enabled} onChange=${(v) => put({ steward: { enabled: v } })} options=${ONOFF} />
          <//>
        </div>

        <div class="list-head">电脑操作</div>
        <div class="list">
          <${Row} id="computer" name="电脑操作" sub=${cu ? cu.reason : ""} title=${cu && cu.notice}>
            <span class=${`dot ${cu && cu.available ? "ok" : "err"}`}></span>
            <${Seg} label="电脑操作" value=${s.computerUse.enabled} onChange=${(v) => put({ computerUse: { enabled: v } })} options=${ONOFF} />
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
