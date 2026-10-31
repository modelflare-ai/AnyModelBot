// 谁能使用机器人：信息面板（使用请求）和机器人设置（主人、允许名单）共用的说法。
export const CHANNEL_NAME = { web: "网页", feishu: "飞书", weixin: "微信" };

/** 允许名单里每个人是怎么来的 */
export const SOURCE_LABEL = {
  request: "你允许的",
  migration: "升级前已在使用",
  "previous-owner": "之前的主人",
  app: "在应用里添加",
  test: "测试",
};
