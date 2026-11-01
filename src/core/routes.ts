/**
 * 聊天渠道的账号是全局的，所有机器人共用（设置 › 连接）。一个人从某个账号发来的消息交给哪个机器人：
 * 1. 这个人在这个账号上用 /bot 选过的机器人；
 * 2. 账号的默认机器人；
 * 3. 默认机器人被删了：第一个机器人。
 *
 * 账号的 key 是命名空间：登录态、配额、名单、Telegram 收取位置都按 key 存。
 * 旧版的渠道存在机器人身上，升级时 key 直接用机器人 id（app.ts adoptBotChannels），这些数据都不用搬，默认机器人还是原来那个。
 */
import type { Store } from "../store/db.js";

const routeKey = (account: string, channel: string, peer: string) => `channel-route:${account}:${channel}:${peer}`;

export function botForPeer(store: Store, account: string, channel: string, peer: string): string {
  const chosen = store.getKV(routeKey(account, channel, peer));
  if (chosen && store.getBot(chosen)) return chosen;
  return defaultBotFor(store, account, channel);
}

export function defaultBotFor(store: Store, account: string, channel: string): string {
  const fallback = store.getChannelAccount(account, channel)?.defaultBot;
  if (fallback && store.getBot(fallback)) return fallback;
  if (store.getBot(account)) return account;
  return store.listBots()[0]?.id ?? account;
}

export function setBotForPeer(store: Store, account: string, channel: string, peer: string, botId: string): void {
  store.setKV(routeKey(account, channel, peer), botId);
}

/** 按序号或名字找机器人（/bot 用）：序号是 listBots 里的位置；名字先精确，再找唯一一个包含它的 */
export function findBot(store: Store, input: string): { id: string; name: string } | undefined {
  const bots = store.listBots();
  const raw = input.trim();
  if (/^\d+$/.test(raw)) return bots[Number(raw) - 1];
  const lower = raw.toLowerCase();
  const exact = bots.filter((b) => b.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const near = bots.filter((b) => b.name.toLowerCase().includes(lower));
  return near.length === 1 ? near[0] : undefined;
}
