// 官网的 Bot 目录：内容来自 bots/*/bot.json，由 scripts/sync-from-app.ts 同步到 data/catalog-bots.json。
import data from "../data/catalog-bots.json";
import type { Lang } from "../i18n";

type Localized<T> = Record<string, T>;
export interface CatalogBot {
  id: string;
  minAppVersion: string;
  avatar: string;
  name: Localized<string>;
  summary: Localized<string>;
  about: Localized<string[]>;
  starters: Localized<string[]>;
}
export const catalogBots = data as CatalogBot[];

const CODE: Record<Lang, string> = { zh: "zh-CN", "zh-TW": "zh-TW", en: "en", ja: "ja", ko: "ko", ru: "ru", es: "es", pt: "pt", tr: "tr" };
/** 各种语言都有；万一缺了退回英文，和 App 的规则一样 */
export const textOf = <T>(field: Localized<T>, lang: Lang): T => field[CODE[lang]] ?? field.en;
export const stillOf = (bot: CatalogBot): string => `/bot-stills/${bot.avatar}.webp`;
