// avatar · zh-CN：机器人头像角色（components/avatar.js）。名字和介绍与官网一致（site/src/i18n/zh.ts 的 bots.looks）
export default {
  label: "头像",
  /** 每个角色：name 名字、about 一句介绍（头像选择器的提示里显示）。只讲长相和配饰，不写岗位：机器人做什么由人设决定 */
  chars: {
    blue: { name: "天天", about: "头顶的天线天天在线，消息一到就接住。" },
    yellow: { name: "闪闪", about: "头顶一颗小星星，一笑就闪闪发亮，还会脸红。" },
    green: { name: "芽芽", about: "头顶一株嫩芽，每天都长高一点。" },
    red: { name: "哒哒", about: "耳机一戴，节拍就哒哒哒响个不停。" },
    purple: { name: "晶晶", about: "头顶结着一颗水晶，转起来亮晶晶。" },
    orange: { name: "飞飞", about: "飞行护目镜一戴，随时准备起飞。" },
  },
};
