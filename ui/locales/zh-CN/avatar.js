// avatar · zh-CN：机器人头像角色（components/avatar.js）
export default {
  label: "头像",
  /** 每个角色：name 名字、role 定位、pick 介绍（头像选择器的提示里显示） */
  chars: {
    blue: { name: "小蓝", role: "主角 · 通用助手", pick: "天线一直在线，什么信号都接得住。默认助手、会议纪要。" },
    yellow: { name: "小萌", role: "客服 · 陪聊", pick: "头顶一颗小星星，一笑就脸红。客服、答疑、陪聊。" },
    green: { name: "绿草", role: "日报 · 整理", pick: "每天长高一点点。群聊日报、记忆整理、知识库。" },
    red: { name: "红魔", role: "代码 · 自动化", pick: "戴上耳机就进入状态。写代码、跑脚本、自动化。" },
    purple: { name: "紫钻", role: "写作 · 创意", pick: "灵感会在头顶结晶。写作、润色、出点子。" },
    orange: { name: "探险者", role: "翻译 · 搜索", pick: "护目镜一戴，满世界找答案。翻译、搜索、操作电脑。" },
  },
};
