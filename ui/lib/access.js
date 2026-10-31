// 谁能使用机器人：信息面板（使用请求）和机器人设置（主人、允许名单）共用的说法。
// 文案跟着界面语言：写成函数，渲染时再取。不认识的渠道 / 来源原样显示。
import { t, has } from "./i18n.js";

export const channelName = (c) => (has(`access.channel.${c}`) ? t(`access.channel.${c}`) : c);

/** 允许名单里每个人是怎么来的 */
export const sourceLabel = (s) => (has(`access.source.${s}`) ? t(`access.source.${s}`) : s);
