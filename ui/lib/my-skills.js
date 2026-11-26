// 「我的技能」和技能列表在界面上的公共部分：技能是哪一类（我的技能 / GitHub / 本地 ZIP）、列表怎么排、
// 筛选胶囊和搜索、打开技能详情（机器人设置里的「查看」「管理」和过程区里点技能名是同一份详情）、往某个机器人的对话里发一句话。
import { createStore } from "./store.js";
import { sendToChat } from "./guide.js";
import { getLang } from "./i18n.js";
import { fold } from "./text-fold.js";

/** 技能列表超过这么多个时出搜索框和筛选胶囊 */
export const LIST_SEARCH_AT = 10;
/** 选「全部」且不在搜索时先显示这么多个 */
export const LIST_FOLD_AT = 20;

/** 技能的来源：mine 我的技能（对话里存下的）· github 按链接装的 · local 从本机导入的 · zip ZIP 导入的（0.1.35 及以前导入、没有记录的也算） */
export const kindOf = (s) => (s?.source?.type === "mine" || s?.mine ? "mine" : s?.source?.type === "github" ? "github" : s?.source?.type === "local" ? "local" : "zip");

/** 界面上显示的名字（「我的技能」是标题，库里的是库里的标题，其余是技能名） */
export const shownName = (s) => s?.title || s?.name || "";

const HAN = /^\p{Script=Han}/u;
/**
 * 开着的在前、关着的在后；组内按显示的名字排：中文名按拼音（不管界面是什么语言），其余按界面语言的排序规则，
 * 中文名排在其他名字后面（和中文排序规则里拉丁字母在汉字前面一致）
 */
export function sortSkills(list, lang = getLang()) {
  const ui = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
  const hanOrder = lang === "zh-TW" ? ui : new Intl.Collator("zh-CN-u-co-pinyin", { sensitivity: "base", numeric: true });
  const han = (s) => HAN.test(shownName(s));
  return [...(list || [])].sort((a, b) =>
    Number(!a.enabled) - Number(!b.enabled)
    || Number(han(a)) - Number(han(b))
    || (han(a) ? hanOrder : ui).compare(shownName(a), shownName(b))
    || a.name.localeCompare(b.name));
}

/** 搜索：文件名、标题和描述里有这段字（不分大小写） */
export const matches = (s, q) => {
  const needle = fold(q);
  return !needle || [s.name, s.title, s.summary, s.description].some((f) => f && fold(f).includes(needle));
};

/** 筛选胶囊：全部 / 我的技能 / GitHub / 本机导入 / 本地 ZIP / 已关闭（一个技能可以同时在「已关闭」和它的来源里） */
export const CHIPS = ["all", "mine", "github", "local", "zip", "off"];
export const inChip = (s, chip) => chip === "all" || (chip === "off" ? !s.enabled : kindOf(s) === chip);

/** 每个胶囊的数量（在搜索时是命中数） */
export function chipCounts(list, q) {
  const hits = (list || []).filter((s) => matches(s, q));
  return Object.fromEntries(CHIPS.map((c) => [c, hits.filter((s) => inChip(s, c)).length]));
}

/** 打开机器人设置技能区时先选好的筛选（草稿卡上「管理我的技能」）：{ botId, chip } */
export const skillsFilter = createStore(null);
/** 去这个机器人设置的技能区，并筛选「我的技能」 */
export function manageMySkills(botId) {
  skillsFilter.set({ botId, chip: "mine" });
  location.hash = `#/bot/${encodeURIComponent(botId)}/settings/skills`;
}

// —— 技能详情（只读的「查看」、带「导出 ZIP / 恢复上一版 / 删除」的「管理」）——
export const skillDetail = createStore(null); // { botId, name, manage }
export const openSkillDetail = (o) => skillDetail.set({ at: Date.now(), ...o });
export const closeSkillDetail = () => skillDetail.set(null);

/** 打开这个机器人的对话并发一句话（「重试」整理技能、「设成定时」） */
export function sendChatTo(botId, text) {
  if (!botId || !text) return;
  const id = encodeURIComponent(botId);
  const here = [`#/chat/${id}`, `#/app/${id}`].some((r) => location.hash === r || location.hash.startsWith(`${r}/`));
  if (!here) location.hash = `#/chat/${id}`;
  // 页面换过来、对话挂上之后再发（对话页只认挂载之后的请求）
  setTimeout(() => sendToChat(text, botId), here ? 0 : 60);
}
