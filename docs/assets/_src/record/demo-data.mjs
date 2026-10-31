// 演示数据：机器人、模型目录、会话、记忆、账户。全部是虚构的演示内容，不含真实邮箱、姓名、Key。
//
// 模型 ID、上下文长度参照 Modelflare 公开价格目录（https://modelflare.dev/api/pricing）的格式与数值。参考价是演示数字：
// 目录里的基础价（input_price × completion_ratio）× 各厂商 stable 分组的倍率，单位美元 / 百万 tokens，换算方式同 src/account/model-info.ts。

/** 六个机器人：名字是演示用的，头像角色对应 ui/components/avatar.js 的 BOT_CHARS 键 */
export const BOTS = [
  { id: "a3f91c2e", name: "小黄", avatar: "yellow", systemPrompt: "你是一个乐于助人的中文助手，回答简洁准确。" },
  { id: "5b7d04e9", name: "小蓝", avatar: "blue", systemPrompt: "你是会议纪要助手。把会议记录整理成结论、待办和待定问题。" },
  { id: "c80e6f13", name: "小绿", avatar: "green", systemPrompt: "你是群聊日报助手。把群里的讨论整理成日报。" },
  { id: "1d4a9b70", name: "小橙", avatar: "orange", systemPrompt: "你是翻译官。中英互译，保留语气、术语和格式。" },
  { id: "e62c5a38", name: "小紫", avatar: "purple", systemPrompt: "你是写作助手。帮我起草和润色公告、邮件、周报。" },
  { id: "97f3d2b4", name: "小红", avatar: "red", systemPrompt: "你是代码助手。阅读和修改工作区里的代码，编写脚本解决问题。" },
];
export const YELLOW = BOTS[0].id;

/** 首次启动时应用自己建的默认机器人（src/app.ts seedDefaultBot） */
export const DEFAULT_BOT = { id: "default", name: "我的助手", avatar: "blue", systemPrompt: "你是一个乐于助人的中文助手，回答简洁准确。" };

/** 机器人默认模型：支持工具调用和图片输入的主流模型 */
export const BOT_MODEL = "claude-sonnet-5-5";

/**
 * 对话模型（GET /models 的顺序，即 Modelflare /v1/models 返回的顺序；选择器会按模型族分组、族内按版本排序）。
 * context：上下文长度；caps：v 视觉 / t 工具 / r 推理；price：[输入, 输出] 美元 / 百万 tokens。
 */
export const CHAT_MODELS = [
  ["claude-opus-5-5", 1_000_000, "vtr", [1.26, 6.3]],
  ["claude-sonnet-5-5", 1_000_000, "vtr", [0.63, 3.15]],
  ["claude-opus-4-8", 1_000_000, "vtr", [1.575, 7.875]],
  ["claude-haiku-4-5", 200_000, "vtr", [0.315, 1.575]],
  ["gpt-6.1-terra", 1_050_000, "vtr", [0.08, 0.4]],
  ["gpt-6-sol", 1_050_000, "vtr", [0.16, 0.8]],
  ["gpt-6-luna", 1_050_000, "vtr", [0.02, 0.1]],
  ["gpt-5.4", 1_000_000, "vtr", [0.2, 1.2]],
  ["gemini-3.8-flash", 1_000_000, "vtr", [0.225, 1.125]],
  ["gemini-3.1-pro-preview", 1_000_000, "vtr", [0.3, 1.8]],
  ["grok-4.7", 500_000, "vtr", [0.22, 0.66]],
  ["deepseek-v4-pro", 1_000_000, "tr", [0.771, 2.314]],
  ["deepseek-v4.1-flash", 1_000_000, "tr", [0.194, 0.774]],
  ["qwen3.8-max", 1_000_000, "tr", [1.371, 4.114]],
  ["kimi-k3", 1_000_000, "vtr", [1.857, 9.286]],
  ["glm-5.3", 200_000, "tr", [0.571, 2]],
  ["glm-5.3-flash", 1_000_000, "tr", [0.057, 0.2]],
];
export const MODEL_IDS = CHAT_MODELS.map(([id]) => id);

/** GET /models/info：{ id: { context, vision, tools, reasoning, price } } */
export function modelInfo() {
  const out = {};
  for (const [id, context, caps, price] of CHAT_MODELS) {
    out[id] = {
      context,
      vision: caps.includes("v"),
      tools: caps.includes("t"),
      reasoning: caps.includes("r"),
      ...(price ? { price: { input: price[0], output: price[1] } } : {}),
      endpoints: id.startsWith("claude") ? ["anthropic", "openai"] : ["openai", "openai-response"],
    };
  }
  return out;
}

/** 图片 / 视频模型（GET /media/models，按推荐顺序）与生图确认卡里的参考价（src/agent/media.ts priceNote） */
export const MEDIA = {
  image: ["gemini-2.5-flash-image", "gpt-image-2", "seedream-5-0-lite-260128", "wan2.7-image"],
  video: ["kling-3.0-turbo", "seedance-2.0-fast", "wan2.7-t2v"],
  recommended: { image: "gemini-2.5-flash-image", video: "kling-3.0-turbo" },
};
export const MEDIA_PRICE = {
  "gemini-2.5-flash-image": "$0.033/张",
  "gpt-image-2": "按 token 计费",
  "seedream-5-0-lite-260128": "$0.033/张",
  "wan2.7-image": "$0.021/张",
};

/** 演示账户（登录后）：不含真实姓名与邮箱 */
export const ACCOUNT = { name: "演示账户", balanceUsd: 12.4, usedUsd: 7.62, keyTail: "a3f9" };

/** 近 7 天用量（UsageSheet）：按天的花费与按模型的合计 */
export function usage(days = 7) {
  const perDay = [0.42, 0.88, 0.31, 1.26, 0.67, 0.95, 0.53, 0.74, 0.22, 0.61, 1.08, 0.36, 0.58, 0.81];
  const reqs = [38, 71, 26, 112, 54, 83, 47, 60, 19, 52, 91, 30, 49, 66];
  const pad = (n) => String(n).padStart(2, "0");
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const k = (days - 1 - i) % perDay.length;
    out.push({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, usd: perDay[k], requests: reqs[k] });
  }
  const total = Math.round(out.reduce((s, x) => s + x.usd, 0) * 100) / 100;
  const share = [
    ["claude-sonnet-5-5", 0.58, 0.55],
    ["claude-opus-5-5", 0.17, 0.08],
    ["deepseek-v4.1-flash", 0.09, 0.25],
    ["gemini-2.5-flash-image", 0.09, 0.03],
    ["kimi-k3", 0.07, 0.09],
  ];
  const n = out.reduce((s, x) => s + x.requests, 0);
  return {
    days: out,
    models: share.map(([model, u, r]) => ({ model, usd: Math.round(total * u * 100) / 100, requests: Math.max(1, Math.round(n * r)) })),
    totalUsd: total,
  };
}

/** 侧栏的历史会话：每个机器人一段网页对话（[分钟前, 角色, 内容]） */
export function history(botId) {
  const H = {
    [BOTS[0].id]: [
      [190, "user", "下午三点的评审会，帮我列一下要准备的材料"],
      [189, "assistant", "可以按这三类准备：\n\n- **背景**：需求来源、目标指标\n- **方案**：架构图、关键取舍、风险\n- **排期**：里程碑和需要协调的人\n\n需要的话我可以先起草方案部分的提纲。"],
    ],
    [BOTS[1].id]: [
      [95, "user", "把今天站会的记录整理成纪要"],
      [94, "assistant", "已整理：3 条结论、5 个待办（都标了负责人和截止时间），还有 1 个待定问题。"],
    ],
    [BOTS[2].id]: [
      [150, "user", "总结一下产品群今天的讨论"],
      [149, "assistant", "今天主要讨论了新版引导页：结论是先上线文案修改，动效下周再评估。"],
    ],
    [BOTS[3].id]: [
      [240, "user", "把这段发布说明翻成英文"],
      [239, "assistant", "Here is the English version, keeping the original bullet structure and terms."],
    ],
    [BOTS[4].id]: [
      [320, "user", "帮我润色一下这封邀请邮件"],
      [319, "assistant", "润色好了，语气更自然，开头直接说明时间和地点。"],
    ],
    [BOTS[5].id]: [
      [420, "user", "写个脚本，把日志里的 ERROR 行按小时统计"],
      [418, "assistant", "脚本放在工作区的 count_errors.py，用法：python count_errors.py app.log"],
    ],
  };
  return H[botId] || [];
}

/** chat 截图：用户问 Raft，回复是一段 Markdown 列表加一个代码块 */
export const RAFT_Q = "用三句话讲讲 Raft 为什么要选主";
export const RAFT_A = [
  "Raft 选主是为了让一致性问题变简单：",
  "",
  "1. **只有一个写入口**：所有写请求都交给 Leader，日志只从它流向 Follower，不会出现两份互相冲突的日志。",
  "2. **顺序由 Leader 说了算**：Leader 给每条日志编号，多数派确认后才提交，大家按同一顺序执行。",
  "3. **故障时能自动接班**：Leader 心跳中断后，Follower 超时发起投票，拿到多数票的节点成为新 Leader。",
  "",
  "核心规则可以写成几行伪代码：",
  "",
  "```go",
  "if time.Since(lastHeartbeat) > electionTimeout {",
  "    term++                 // 进入新任期",
  "    votes := requestVotes(term)",
  "    if votes > len(peers)/2 {",
  "        becomeLeader(term) // 拿到多数票才当选",
  "    }",
  "}",
  "```",
].join("\n");

/** memory 截图：信息面板里的 4 条偏好记忆 */
export const MEMORY_PREFS = [
  "先给结论，再给细节；列表不超过 5 条",
  "代码示例默认用 TypeScript",
  "日期统一写成 YYYY-MM-DD",
  "称呼用「你」，不用「您」",
];

/** 演示用的渠道身份（虚构） */
export const WEIXIN_BOT_ID = "7f3a9c21d4@im.bot";
export const WEIXIN_USER = "wxdemo_8k2m@im.wechat";
export const FEISHU_APP_ID = "cli_a5f3d9e0demo";
export const FEISHU_PEER = "演示同事";
