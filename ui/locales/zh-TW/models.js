// models · zh-TW：模型選擇器（components/model-picker.js）
export default {
  /** 認不出的模型族 */
  otherFamily: "其他",
  caps: {
    vision: "視覺",
    tools: "工具",
    reasoning: "推理",
  },
  /** 按次計費的參考價，price 形如 $0.04 */
  perCall: "{price}/次",
  noteTitle: "上下文 · 能力 · 每百萬 tokens 輸入/輸出的起步參考價（美元，以帳單為準）",
  choose: "選擇模型",
  filter: "篩選模型",
  filterOrId: "篩選，或輸入任意模型 ID",
  loadFailed: "取得模型清單失敗：{error}",
  useCustom: "使用「{id}」",
  customId: "自訂模型 ID",
  none: "沒有可用模型：你的帳號還沒有開放模型",
  effort: {
    name: "推理強度",
    auto: "自動",
    low: "低",
    medium: "中",
    high: "高",
  },
  /** 選擇器的兩個滑塊 */
  tiers: {
    value: "性價比",
    strategy: {
      low_cost: "省錢",
      balanced: "均衡",
      stable: "品質",
    },
    intelligence: "模型智慧",
    /** 第二個滑塊的檔名，從省到強 */
    level: {
      min: "最低",
      low: "低",
      medium: "中",
      high: "高",
      max: "最高",
    },
    custom: "自訂",
    valueText: "{level}：{model}",
    cheaper: "更省",
    smarter: "更強",
    allModels: "全部模型",
    back: "返回",
    reset: "還原預設",
    /** aa 是指向 Artificial Analysis 的連結 */
    foot: "沿帕累托前沿選擇模型，資料來自 {aa}",
  },
};
