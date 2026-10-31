// guide · zh-CN：新手引导（上手清单）。lib/guide.js 的步骤文案 + components/guide.js 的界面
export default {
  /** 文案里 {name} 的缺省值：主角机器人的名字 */
  defaultBotName: "小蓝",
  /** 清单菜单里各步骤标题的 {name}（不针对某个机器人） */
  nameGeneric: "机器人",
  /** 完成一步时提示里的 {name} */
  nameToast: "它",
  title: "上手清单",
  allDone: "上手清单全部完成",
  /** 「上手清单 · 3/6」；progress 可以是带样式的数字 */
  progress: "上手清单 · {progress}",
  toastProgress: "上手清单 {progress} · {title}",
  collapse: "收起到左下角",
  demoThis: "演示这句",
  watchDemo: "看演示",
  tryThis: "试试这句",
  sendThis: "发送这句",
  followHint: "跟着提示点一下就好",
  takeMe: "带我去",
  completed: "已完成",
  upNext: "接下来做这个",
  hide: "不再显示清单",
  coachLabel: "上手引导",
  closeCoach: "关闭引导",
  doneTitle: "做好了",
  fill: "填入",
  openConsole: "去 Modelflare 控制台开通图片模型 ↗",
  later: "稍后再说",
  stopHere: "先到这里",
  next: "下一步：{title}",
  demo: {
    detail: "提示词：{prompt}\n尺寸 1024×1024 · 1 张\n这是预置演示：不调用模型，也不扣费。",
    label: "生成图片 · 预置演示",
    question: "这次用「示例图片模型」生成图片吗？",
    pickModel: "选择模型",
    sampleModel: "示例图片模型",
    sampleDesc: "默认 · 演示不扣费",
    cancelDesc: "这次不生成",
    alt: "示例图：戴着耳机的蓝色小机器人，扁平插画风",
    generating: "正在生成（演示）…",
    caption: "示例图 · 客户端自带，没有调用模型",
    enable: "开通图片模型 ↗",
    cancelled: "已取消：没有生成，也没有扣费。",
    again: "再来一次",
  },
  /**
   * 各步骤（id 与 src/guide.ts 的 GUIDE_STEPS 一致）：title、desc、how（几条怎么做）、try（可以一键发出的示例，没有就不给按钮）、
   * note、doneText（做完后）；生图那一步另有 demoNote、noModelText（账户还没有图片模型时的 doneText）。{name} = 机器人的名字
   */
  steps: {
    hello: {
      title: "跟{name}打个招呼",
      desc: "在这里直接和机器人聊天，回复会边写边出来。",
      how: ["Enter 发送，Shift + Enter 换行", "Esc 让它停下", "输入 / 查看全部命令"],
      try: "你能帮我做什么？",
      doneText: "以后在这里随时找它；左下角的清单会一直陪着你。",
    },
    model: {
      title: "换个模型",
      desc: "一个账户就能用 GPT、Claude、Gemini 等模型，不同的事可以交给不同的模型。",
      how: ["点输入框右下角的模型名，挑一个就换好了", "只对这段对话生效；想一直用它，点列表底部的「设为此机器人的默认模型」", "每个模型都标着上下文长度、能力和参考价"],
      doneText: "换好了，只对这段对话生效。问它一句试试。",
    },
    weixin: {
      title: "把{name}接到微信",
      desc: "扫码后，在微信里直接私聊它，不用装新 App。电脑开着，它就在线。",
      how: ["点顶部的机器人名字，打开信息面板", "在「渠道」里点「微信」→「扫码登录」", "用微信扫码，在手机上确认"],
      note: "微信的规定：你每发一条消息，它 24 小时内最多回 10 条。用飞书的话，在同一处填飞书应用的 App ID 和 App Secret。",
      doneText: "在微信里给它发条消息试试：同一个机器人，同一份记忆。",
    },
    hands: {
      title: "让它动手做件事",
      desc: "它能在自己的工作区里写文件、跑命令，做好的文件会交给你。",
      how: ["它只改自己工作区里的东西", "要动工作区以外的文件，会先在对话里问你，你点「允许」才做", "不放心？把输入框左下角的权限切成「只读」"],
      try: "在你的工作区建一个「今日待办.md」，列三件今天要做的事，然后发给我。",
      doneText: "做好的文件在对话里；在微信、飞书里会直接发给你。",
    },
    memory: {
      title: "让它记住你",
      desc: "告诉它你的习惯和常用信息，开新对话、到微信里它都记得。密码、密钥这类内容它不会记。",
      how: ["说「记住……」就行，聊天中它也会自己记下重要的事", "想让它忘掉，说「忘掉……」，或在信息面板的「记忆」里删掉"],
      try: "记住：回答尽量简短，结论放在最前面。",
      doneText: "记下了。信息面板的「记忆」里能看到、也能删掉。",
    },
    media: {
      title: "生成一张图",
      desc: "它可以画图、做视频。每次生成前都会先问你用哪个模型，并给出参考价，你确认了才会花钱。",
      how: ["描述你想要的画面", "在对话里的确认卡片上选模型、确认", "10 分钟内没回答就不生成"],
      try: "画一只戴着耳机的蓝色小机器人，扁平插画风。",
      demoNote: "看一遍演示就知道怎么操作：流程和真的一样，但不调用模型、不扣费。",
      doneText: "刚才是演示。想真的画，直接跟它说一句；生成前它会先问你用哪个模型、标出参考价，你确认了才花钱。",
      noModelText: "刚才是演示。你的账户暂时还没有可用的图片模型，开通后同样一句话它就会真的画给你。",
    },
  },
};
