import { html, Button } from "./ui.js";
import { MF_TOPUP, usd } from "../lib/links.js";
import { fmtTimeOfDay } from "../lib/format.js";
import { t } from "../lib/i18n.js";

/** 未读到或读取失败时不把余额展示成零；搜索结果与账户概览共用。 */
export function balanceText(account) {
  if (account?.error) return t("firstUse.balanceUnavailable");
  return account?.balanceUsd == null ? t("firstUse.balanceLoading") : usd(account.balanceUsd);
}

/** 设置中的常驻账户概览：余额为主、Bot 额度为辅，操作入口直接可见。 */
export function AccountBalance({ account, refreshing = false, onRefresh, flash = false }) {
  const pending = !!account.error || account.balanceUsd == null;
  const bot = account.error ? null : account.bot;
  const percent = Math.min(100, Math.max(0, Number(bot?.remainingPercent) || 0));
  const updated = account.error ? t("settings.rows.balance.error", { error: account.error })
    : account.updatedAt ? t("settings.rows.balance.updated", { time: fmtTimeOfDay(account.updatedAt) }) : "";
  return html`<section id="set-balance" class=${`account-balance${flash ? " flash" : ""}`} aria-label=${t("settings.rows.balance.name")} aria-busy=${refreshing}>
    <div class="account-balance-main">
      <dl class="account-balance-value"><dt>${t("settings.rows.balance.name")}</dt>
        <dd class=${`num${pending ? " pending" : ""}`}>${balanceText(account)}</dd></dl>
      <a class="btn primary" href=${account.topupUrl || MF_TOPUP} target="_blank" rel="noopener noreferrer">${t("settings.rows.balance.topUp")}</a>
    </div>
    ${!pending && account.lowBalance && html`<p class="account-balance-warning"><span class="dot warn" aria-hidden="true"></span>${t("sidebar.belowLine", { amount: usd(account.alerts?.lowBalanceUsd) })}</p>`}
    ${bot && html`<div class="account-credit">
      <div class="account-credit-heading"><span>${t("sidebar.botQuota")}</span><strong class="num">${usd(bot.balanceUsd)}</strong><span class="account-credit-percent num">${t("sidebar.botLeft", { percent })}</span></div>
      <div class="account-credit-meter" role="meter" aria-label=${t("sidebar.botQuota")} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent} aria-valuetext=${t("sidebar.botLeft", { percent })}><span style=${{ width: `${percent}%` }}></span></div>
      <p>${t("sidebar.botQuotaScope")}</p>
    </div>`}
    <div class="account-balance-footer"><span class="account-balance-updated" role="status">${updated}</span>
      <${Button} variant="ghost" size="sm" icon="refresh" aria-label=${t("settings.rows.balance.refresh")} loading=${refreshing} onClick=${onRefresh}>${t("common.refresh")}<//>
    </div>
  </section>`;
}
