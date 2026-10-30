// 设置页（参考 Codex）：侧栏换成设置导航（返回应用 + 查找 + 分页），主区是大标题 + 白色圆角 list，一行一项；改动即保存。
// 入口只有左下角账户按钮、⌘/Ctrl+, 和命令面板。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html, Icon, Seg, Switch, Sheet, CopyButton, Skeleton } from "../components/ui.js";
import { AccountButton } from "./sidebar.js";
import { ModelPicker, shortModel } from "../components/model-picker.js";
import { KeyForm, LINE_OPTIONS } from "./onboarding.js";
import { LoginSheet, NotificationsSheet, UsageSheet } from "./account.js";
import { api } from "../lib/api.js";
import { MF_CONSOLE, MF_DOCS, MF_TOPUP, usd } from "../lib/links.js";
import { useStore, confirmSheet, failed, saved } from "../lib/store.js";
import { themeMode, setThemeMode } from "../lib/theme.js";
import { TroubleshootPane } from "./troubleshoot.js";

export const TABS = [
  ["general", "常规", "sliders"],
  ["modelflare", "Modelflare", "spark"],
  ["computer", "电脑操作", "monitor"],
  ["privacy", "隐私与安全", "lock"],
  ["network", "网络与访问", "globe"],
  ["data", "数据", "database"],
  ["troubleshoot", "故障排查", "pulse"],
  ["about", "关于", "info"],
];
const ZOOMS = [
  [1, "100%"],
  [1.1, "110%"],
  [1.25, "125%"],
  [1.5, "150%"],
];
const GATEWAY = { running: "运行中", starting: "启动中", restarting: "重启中", failed: "失败", stopped: "已停止", external: "外部端点" };
const ALERT_LINES = [
  [0, "不提醒"],
  [1, "$1"],
  [5, "$5"],
  [20, "$20"],
];

function Row({ id, name, sub, title, children, flash, off }) {
  return html`<div class=${`row${flash ? " flash" : ""}${off ? " off" : ""}`} id=${`set-${id}`} title=${title}>
    <div class="who"><div class="name">${name}</div>${sub && html`<div class="sub">${sub}</div>`}</div>
    <div class="ctl">${children}</div>
  </div>`;
}

function PickModel({ value, models, modelsError, reloadModels, onChange, resetLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return html`<button type="button" class="pick" ref=${ref} aria-haspopup="listbox" aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>
      <span class="v">${value ? shortModel(value) : resetLabel}</span><${Icon} name="chevDown" />
    </button>
    ${open && html`<${ModelPicker} anchor=${ref.current} align="right" models=${models} error=${modelsError} onRetry=${reloadModels} current=${value}
      onPick=${onChange} onClose=${() => setOpen(false)} reset=${{ label: resetLabel, onSelect: () => onChange("") }} />`}`;
}

function NoticesSheet({ onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api("/notices").then(setD).catch((e) => setD({ license: e.message, notices: "" }));
  }, []);
  return html`<${Sheet} title="许可与第三方声明" wide onClose=${onClose}>
    <pre class="doc">${d ? `${d.license}\n\n${d.notices}` : "加载中…"}</pre>
    <div class="actions"><button type="button" class="btn" data-autofocus onClick=${onClose}>关闭</button></div>
  <//>`;
}

/** 设置时的侧栏：返回应用 | 查找设置 | 分页 | 账户 */
export function SettingsSide({ tab, query, onQuery, onTab, onBack, username, account }) {
  const searching = !!query.trim();
  return html`<aside class="side" aria-label="设置">
    <div class="side-top start">
      <button type="button" class="side-back" title="返回应用（Esc）" onClick=${onBack}><${Icon} name="arrowLeft" size=${15} />返回应用</button>
    </div>
    <label class="side-search">
      <${Icon} name="search" size=${14} />
      <input type="search" placeholder="查找设置" aria-label="查找设置" value=${query} onInput=${(e) => onQuery(e.target.value)}
        onKeyDown=${(e) => e.key === "Escape" && query && (e.stopPropagation(), onQuery(""))} />
    </label>
    <nav class="side-list side-nav" aria-label="设置分页">
      ${TABS.map(([t, label, icon]) => {
        const on = !searching && t === tab;
        return html`<button type="button" key=${t} class=${`nav-item${on ? " sel" : ""}`} aria-current=${on ? "page" : undefined}
          onClick=${() => { onQuery(""); onTab(t); }}><${Icon} name=${icon} size=${16} /><span>${label}</span></button>`;
      })}
    </nav>
    <div class="side-foot"><${AccountButton} username=${username} account=${account} on onClick=${() => onTab("general")} /></div>
  </aside>`;
}

export function SettingsScreen({ tab, query: q, onQuery: setQ, onTab, focusRow, mf, onMfChanged, onSettings, models, modelsError, reloadModels, status, bots, onOpenBotSettings, account: acct, onAccount }) {
  const [s, setS] = useState(null);
  const [rekey, setRekey] = useState(false);
  const [notices, setNotices] = useState(false);
  const [sheet, setSheet] = useState(""); // login | usage | notifications
  const [invite, setInvite] = useState(null);
  const [unread, setUnread] = useState(null);
  const [cu, setCu] = useState(null);
  const [flash, setFlash] = useState("");
  const mode = useStore(themeMode);

  useEffect(() => {
    api("/settings").then(setS).catch(failed);
  }, []);
  useEffect(() => {
    if (bots && bots[0]) api(`/bots/${encodeURIComponent(bots[0].id)}/settings`).then((d) => setCu(d.computerUse)).catch(() => {});
  }, [bots && bots[0] && bots[0].id]);
  useEffect(() => {
    if (!focusRow) return;
    setQ("");
    requestAnimationFrame(() => {
      document.getElementById(`set-${focusRow}`)?.scrollIntoView({ block: "center" });
      setFlash(focusRow);
      setTimeout(() => setFlash(""), 1300);
    });
  }, [focusRow, tab]);

  const put = async (patch, rollback) => {
    const prev = s;
    setS((v) => ({ ...v, ...rollback }));
    try {
      const next = await api("/settings", { method: "PUT", body: patch });
      setS(next);
      onSettings?.(next);
      saved();
    } catch (e) {
      setS(prev);
      failed(e);
    }
  };
  const setLine = async (line) => {
    try {
      await api("/modelflare/line", { method: "PUT", body: { line } });
      onMfChanged();
      saved();
    } catch (e) {
      failed(e);
    }
  };
  const disconnect = async () => {
    if (!(await confirmSheet({ title: "断开 Modelflare？", body: "会从本机删除这个 API Key。机器人和会话都会保留，重新连接后继续使用。", confirmLabel: "断开", danger: true }))) return;
    try {
      await api("/modelflare", { method: "DELETE" });
      onMfChanged();
    } catch (e) {
      failed(e);
    }
  };
  const logout = async () => {
    if (!(await confirmSheet({ title: "退出 Modelflare 账户？", body: "会撤销这台电脑的授权，并删除登录时为它和各机器人签发的 API Key。机器人和会话都会保留。", confirmLabel: "退出登录", danger: true }))) return;
    try {
      const r = await api("/account/logout", { method: "POST", body: {} });
      if (!r.revoked) failed("服务端没有确认撤销：本机已退出，可在 Modelflare 网页的「已授权的应用」里再撤销一次");
      onAccount(r);
      onMfChanged();
    } catch (e) {
      failed(e);
    }
  };
  const refreshBalance = () =>
    api("/account/refresh", { method: "POST", body: {} })
      .then(onAccount)
      .catch(failed);
  const putAlerts = (patch) =>
    api("/account/alerts", { method: "PUT", body: patch })
      .then((r) => {
        onAccount(r);
        saved();
      })
      .catch(failed);
  const desktop = !!(s && s.desktop);
  const managed = mf && mf.mode === "managed";
  const signedIn = !!(acct && acct.state === "signed_in");
  // 登录后才有邀请码和通知；进入 Modelflare 分页时读一次
  useEffect(() => {
    if (!signedIn || tab !== "modelflare") return;
    api("/account/invite").then(setInvite).catch(() => setInvite(null));
    api("/account/notifications").then((r) => setUnread(r.data ? r.data.unread_count : null)).catch(() => setUnread(null));
  }, [signedIn, tab]);

  // —— 行定义：每行一个稳定 id，可被搜索、可被深链（#/settings/<tab>/<id>）——
  const rows = useMemo(() => {
    if (!s) return [];
    return [
      { tab: "general", id: "appearance", name: "外观", sub: "浅色、深色，或跟随系统", keys: "主题 深色 浅色 theme dark",
        ctl: html`<${Seg} label="外观" value=${mode} onChange=${(m) => { setThemeMode(m); saved(); }} options=${[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} />` },
      desktop && { tab: "general", id: "zoom", name: "文字大小", sub: "放大窗口里的一切", keys: "缩放 字号 zoom",
        ctl: html`<${Seg} label="文字大小" value=${s.zoom} onChange=${(z) => put({ zoom: z }, { zoom: z })} options=${ZOOMS} />` },
      desktop && { tab: "general", id: "close", name: "关闭窗口时", sub: "隐藏到托盘时机器人继续在后台收发消息", keys: "托盘 退出 tray",
        ctl: html`<${Seg} label="关闭窗口时" value=${s.closeToTray} onChange=${(v) => put({ closeToTray: v }, { closeToTray: v })} options=${[[true, "隐藏到托盘"], [false, "退出"]]} />` },
      desktop && s.autostart.supported && { tab: "general", id: "autostart", name: "开机自启", sub: "登录系统后在后台启动", keys: "启动 login",
        ctl: html`<${Switch} label="开机自启" value=${s.autostart.on} onChange=${(v) => put({ autostart: v }, { autostart: { ...s.autostart, on: v } })} />` },
      desktop && { tab: "general", id: "browser", name: "在浏览器中打开", sub: "用系统浏览器打开同一个本机界面", keys: "browser",
        ctl: html`<button type="button" class="text" onClick=${() => api("/desktop/open-in-browser", { method: "POST", body: {} }).catch(failed)}>打开</button>` },

      managed && acct && { tab: "modelflare", id: "account", name: "Modelflare 账户",
        sub: signedIn ? `${acct.name || "已登录"}${acct.billedToEnterprise ? " · 由企业钱包付费" : ""}` : acct.state === "unavailable" ? acct.error : "登录后可以查看用量、通知和邀请链接，也能给机器人单独设预算", keys: "登录 注册 账户 退出 account login",
        ctl: signedIn
          ? html`<button type="button" class="text danger" onClick=${logout}>退出登录</button>`
          : acct.loginAvailable === false
            ? html`<span class="val">Docker / 远程部署不支持浏览器登录</span>`
            : html`<button type="button" class="text accent" onClick=${() => setSheet("login")}>登录 / 注册</button>` },
      { tab: "modelflare", id: "connection", name: signedIn ? "本机 Key" : "连接",
        sub: !managed ? "由环境变量 AMB_MAGPIE_BASE_URL 指定的端点（开发/测试）" : signedIn ? "登录时为这台电脑签发，退出登录会一并删除" : "API Key 只保存在本机", keys: "密钥 key api 断开 更换",
        ctl: managed
          ? html`<span class="mf-state"><span class=${`dot ${mf.connected ? "ok" : "err"}`}></span>${mf.connected ? "已连接" : "未连接"}</span>
              ${mf.keyTail && html`<span class="val">••••${mf.keyTail}</span>`}
              ${!signedIn && html`<button type="button" class="text" onClick=${() => setRekey(true)}>更换密钥</button>
                <button type="button" class="text danger" onClick=${disconnect}>断开</button>`}`
          : html`<span class="val" title=${mf && mf.baseUrl}>${mf && mf.baseUrl}</span>` },
      managed && acct && mf.connected && { tab: "modelflare", id: "balance", name: "余额",
        sub: acct.error ? `读取失败：${acct.error}` : acct.source === "key" ? "这把 Key 所在账户的钱包余额" : acct.updatedAt ? `更新于 ${new Date(acct.updatedAt).toLocaleTimeString()}` : "读取中…", keys: "余额 充值 钱包 balance top up",
        ctl: html`<span class=${`balance${acct.lowBalance ? " low" : ""}`}>${usd(acct.balanceUsd)}</span>
          <button type="button" class="icon-btn" title="刷新" aria-label="刷新余额" onClick=${refreshBalance}><${Icon} name="refresh" size=${14} /></button>
          <a class="btn" href=${MF_TOPUP} target="_blank" rel="noopener noreferrer">充值 ↗</a>` },
      managed && acct && mf.connected && { tab: "modelflare", id: "low-balance", name: "余额提醒", sub: "余额低于这个数时在应用里提醒一次，充值后重新计", keys: "提醒 余额不足 low balance",
        ctl: html`<${Seg} label="余额提醒" value=${acct.alerts.lowBalanceUsd} onChange=${(v) => putAlerts({ lowBalanceUsd: v })}
          options=${ALERT_LINES.some(([v]) => v === acct.alerts.lowBalanceUsd) ? ALERT_LINES : [...ALERT_LINES, [acct.alerts.lowBalanceUsd, usd(acct.alerts.lowBalanceUsd)]]} />` },
      managed && acct && mf.connected && acct.alerts.lowBalanceUsd > 0 && { tab: "modelflare", id: "low-balance-push", name: "提醒也发到微信 / 飞书", sub: "由机器人发给你：微信发给扫码登录的人（需要他最近发过消息），飞书发到最近的单聊", keys: "推送 提醒 微信 飞书",
        ctl: html`<${Switch} label="提醒也发到微信 / 飞书" value=${acct.alerts.push} onChange=${(v) => putAlerts({ lowBalancePush: v })} />` },
      signedIn && { tab: "modelflare", id: "usage", name: "用量", sub: "按天、按模型的花费", keys: "用量 花费 账单 usage",
        ctl: html`<button type="button" class="text" onClick=${() => setSheet("usage")}>查看</button>` },
      signedIn && { tab: "modelflare", id: "notifications", name: "通知", sub: unread ? `${unread} 条未读` : "Modelflare 发给你的通知与公告", keys: "通知 公告 消息 notification",
        ctl: html`<button type="button" class="text" onClick=${() => setSheet("notifications")}>查看</button>` },
      signedIn && invite && { tab: "modelflare", id: "invite", name: "邀请好友", sub: "好友通过你的链接注册并充值，你会获得返利", keys: "邀请 返利 推广 invite",
        ctl: html`<span class="val">${invite.code}</span><${CopyButton} text=${invite.url} label="复制邀请链接" />` },
      managed && { tab: "modelflare", id: "line", name: "线路", sub: "中国大陆访问更稳定可选优化线路；切换后新请求生效", keys: "大陆 国际 origin 网络",
        ctl: html`<${Seg} label="线路" value=${mf.line} onChange=${setLine} options=${LINE_OPTIONS} />` },
      { tab: "modelflare", id: "default-model", name: "默认模型", sub: "机器人没有单独指定时使用", keys: "模型 model",
        ctl: html`<${PickModel} value=${s.defaultModel} models=${models} modelsError=${modelsError} reloadModels=${reloadModels} resetLabel="自动（列表第一个）"
          onChange=${(m) => put({ defaultModel: m }, { defaultModel: m })} />` },
      { tab: "modelflare", id: "models", name: "可用模型", sub: modelsError ? `获取失败：${modelsError}` : "这个 Key 所在分组开放的模型", keys: "列表 刷新",
        ctl: html`<span class="val num">${models ? `${models.length} 个` : "…"}</span><button type="button" class="text" onClick=${() => reloadModels().then(() => saved())}>刷新</button>` },
      { tab: "modelflare", id: "console", name: "Modelflare 控制台", sub: "账单、发票与 API Key 管理", keys: "控制台 账单 console",
        ctl: html`<a class="text" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">打开 ↗</a>` },

      { tab: "computer", id: "cu-status", name: "电脑操作后端", sub: cu ? cu.reason : "读取中…", keys: "computer use cua 辅助功能 屏幕录制",
        ctl: html`<span class=${`dot ${cu ? (cu.available ? "ok" : "err") : ""}`}></span>` },
      cu && cu.notice && { tab: "computer", id: "cu-notice", name: "系统权限", sub: cu.notice, title: cu.notice, keys: "权限 permission", ctl: null },
      { tab: "computer", id: "cu-per-bot", name: "按机器人开启", sub: "每个机器人可以单独开启电脑操作并设置审批方式", keys: "机器人",
        ctl: bots && bots[0] && html`<button type="button" class="text" onClick=${() => onOpenBotSettings(bots[0].id, "computer")}>打开机器人设置</button>` },

      { tab: "privacy", id: "key-storage", name: "密钥存放", sub: "Modelflare 密钥只在本机内置网关的隔离配置里，不写日志、不进命令行参数", ctl: null, keys: "安全" },
      { tab: "privacy", id: "account-storage", name: "账户凭据", sub: "登录 Modelflare 的凭据只存在数据目录，桌面版用系统钥匙串加密；界面只拿到账户名称", ctl: null, keys: "安全 登录 钥匙串" },
      { tab: "privacy", id: "token", name: "访问令牌", sub: s.listen.tokenRequired ? "需要令牌：界面监听在非本机地址，或桌面版每次启动随机生成" : "只监听本机，无需令牌", keys: "token 令牌",
        ctl: html`<span class=${`dot ${s.listen.tokenRequired ? "ok" : ""}`}></span>` },
      { tab: "privacy", id: "sandbox", name: "机器人沙箱", sub: "来自机器人沙箱的请求会被本机界面拒绝，机器人无法自行批准操作或读取配置", ctl: null, keys: "安全 dsh" },
      { tab: "privacy", id: "screens", name: "截图", sub: "电脑操作的截图只发给模型，不会发到聊天里", ctl: null, keys: "隐私" },

      { tab: "network", id: "listen", name: "监听地址", sub: "修改需设置 AMB_UI_HOST / AMB_UI_PORT 并重启", keys: "端口 port host",
        ctl: html`<span class="val">${s.listen.host}:${s.listen.port}</span><${CopyButton} text=${`http://${s.listen.host === "0.0.0.0" ? "127.0.0.1" : s.listen.host}:${s.listen.port}/`} label="复制地址" />` },

      { tab: "data", id: "data-dir", name: "数据目录", sub: "SQLite、机器人工作区、微信登录态与内置网关配置", keys: "路径 目录 folder",
        ctl: html`<span class="val" title=${s.dataDir}>${s.dataDir}</span><${CopyButton} text=${s.dataDir} label="复制路径" />
          ${desktop && html`<button type="button" class="text" onClick=${() => api("/desktop/open-data-dir", { method: "POST", body: {} }).catch(failed)}>打开</button>`}` },

      { tab: "about", id: "version", name: "版本", keys: "version", ctl: html`<span class="val">${status ? status.version : ""}</span>` },
      { tab: "about", id: "licenses", name: "许可与第三方声明", sub: "MIT；界面部分样式改编自 magpie（MIT）", keys: "license",
        ctl: html`<button type="button" class="text" onClick=${() => setNotices(true)}>查看</button>` },
      { tab: "about", id: "diagnostics", name: "诊断信息", sub: status ? `内置模型网关 · ${GATEWAY[status.gateway.state] || status.gateway.state}${status.gateway.restarts ? ` · 重启 ${status.gateway.restarts} 次` : ""}${status.gateway.lastError ? ` · ${status.gateway.lastError}` : ""}` : "", keys: "网关 gateway magpie",
        ctl: html`<button type="button" class="text" onClick=${() => onTab?.("troubleshoot")}>故障排查</button>` },
      // 故障排查页是单独的面板（troubleshoot.js），这一行只给搜索用：搜"日志""测试模型"时能找到入口
      { tab: "troubleshoot", id: "troubleshoot", name: "故障排查", sub: "模型网关与代理进程的状态、测试模型、测试代理、最近日志、复制诊断信息", keys: "日志 log 测试 test 代理 agent 卡住 转圈 诊断 diagnostics 重启",
        ctl: html`<button type="button" class="text" onClick=${() => { setQ(""); onTab?.("troubleshoot"); }}>打开</button>` },
      { tab: "about", id: "links", name: "Modelflare", sub: "官网与文档",
        ctl: html`<a class="text" href=${MF_CONSOLE} target="_blank" rel="noopener noreferrer">modelflare.dev ↗</a><a class="text" href=${MF_DOCS} target="_blank" rel="noopener noreferrer">文档 ↗</a>` },
    ].filter(Boolean);
  }, [s, mf, mode, models, modelsError, cu, status, bots, acct, invite, unread]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.name} ${r.sub || ""} ${r.keys || ""}`.toLowerCase().includes(needle)) : rows.filter((r) => r.tab === tab);
  const parts = needle ? TABS.map(([t, label]) => [label, shown.filter((r) => r.tab === t)]).filter(([, l]) => l.length) : [["", shown]];

  const title = needle ? "搜索结果" : (TABS.find(([t]) => t === tab) || TABS[0])[1];
  return html`<section class="settings view" data-screen="settings" key=${needle ? "search" : tab}>
    <div class="set-head"><h1 class="set-title">${title}</h1></div>
    <div class="set-body">
      ${!s && html`<div class="list"><div class="row"><${Skeleton} w="40%" /></div><div class="row"><${Skeleton} w="55%" /></div></div>`}
      ${s && !shown.length && html`<p class="set-none">没有匹配的设置</p>`}
      ${s && !needle && tab === "troubleshoot" ? html`<${TroubleshootPane} bots=${bots} desktop=${desktop} />` : parts.map(([label, list]) => html`${label && html`<div class="set-part">${label}</div>`}
        <div class="list">${list.map((r) => html`<${Row} key=${r.id} id=${r.id} name=${r.name} sub=${r.sub} title=${r.title || r.sub} flash=${flash === r.id}>${r.ctl}<//>`)}</div>`)}
    </div>
    ${rekey && html`<${Sheet} title="更换 Modelflare 密钥" onClose=${() => setRekey(false)}>
      <${KeyForm} line=${mf.line} showLine=${false} submitLabel="验证并保存" onConnected=${() => { setRekey(false); saved(); onMfChanged(); reloadModels(); }} />
    <//>`}
    ${notices && html`<${NoticesSheet} onClose=${() => setNotices(false)} />`}
    ${sheet === "login" && html`<${LoginSheet} onClose=${() => setSheet("")} onSignedIn=${(r) => { onAccount(r); onMfChanged(); reloadModels(); }} />`}
    ${sheet === "usage" && html`<${UsageSheet} onClose=${() => setSheet("")} />`}
    ${sheet === "notifications" && html`<${NotificationsSheet} onClose=${() => { setSheet(""); setUnread(null); }} />`}
  </section>`;
}
