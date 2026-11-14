// 删除机器人：侧栏和机器人设置共用一份确认和请求，两处说法、行为都一样。
import { markCatalogRemoved } from "./catalog.js";
import { api } from "./api.js";
import { channelName } from "./access.js";
import { confirmSheet, failed, toast } from "./store.js";
import { t } from "./i18n.js";

/**
 * 它默认回复的渠道账号之后交给谁（后端的规则见 src/core/routes.ts：默认机器人没了，交给第一个机器人）。
 * 这件事删掉之后才发现会很意外，所以在确认框里说清楚。查不到就不提。
 */
async function handoverNote(bot) {
  const [{ accounts }, { bots }] = await Promise.all([api("/channel-accounts"), api("/bots")]).catch(() => [{ accounts: [] }, { bots: [] }]);
  const mine = accounts.filter((a) => a.defaultBot === bot.id);
  if (!mine.length) return "";
  const names = [...new Set(mine.map((a) => channelName(a.channel)))].join(t("sidebar.delete.listSep"));
  const heir = bots.find((b) => b.id !== bot.id);
  return heir ? t("sidebar.delete.handover", { channels: names, bot: heir.name }) : t("sidebar.delete.handoverNone", { channels: names });
}

/** 问过用户后删除。目录 Bot 是「移除」：还能在发现页找到，可以选择保留数据。返回是否真的删了 */
export async function deleteBot(bot) {
  const fromCatalog = bot.origin === "catalog";
  const note = await handoverNote(bot);
  const body = t(fromCatalog ? "botapp.remove.body" : "sidebar.delete.body");
  const keep = fromCatalog ? { label: t("botapp.remove.keep"), value: true } : null;
  const ok = await confirmSheet({
    title: t(fromCatalog ? "botapp.remove.title" : "sidebar.delete.title", { name: bot.name }),
    body: note ? `${body} ${note}` : body,
    confirmLabel: t(fromCatalog ? "botapp.remove.confirm" : "sidebar.delete.confirm"),
    danger: true,
    check: keep,
  });
  if (!ok) return false;
  try {
    await api(`/bots/${bot.id}${keep?.value ? "?keepData=1" : ""}`, { method: "DELETE" });
    if (fromCatalog && bot.app?.catalogId) markCatalogRemoved(bot.app.catalogId);
    toast(t(fromCatalog ? "botapp.remove.done" : "sidebar.delete.done", { name: bot.name }));
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}
