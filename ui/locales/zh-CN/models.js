// models · zh-CN：模型选择器（components/model-picker.js）
export default {
  /** 认不出的模型族 */
  otherFamily: "其他",
  caps: {
    vision: "视觉",
    tools: "工具",
    reasoning: "推理",
  },
  /** 按次计费的参考价，price 形如 $0.04 */
  perCall: "{price}/次",
  noteTitle: "上下文 · 能力 · 每百万 tokens 输入/输出的起步参考价（美元，以账单为准）",
  choose: "选择模型",
  filter: "筛选模型",
  filterOrId: "筛选，或输入任意模型 ID",
  loadFailed: "获取模型列表失败：{error}",
  useCustom: "使用「{id}」",
  customId: "自定义模型 ID",
  none: "没有可用模型：这个 Key 所在的分组还没有开放模型",
};
