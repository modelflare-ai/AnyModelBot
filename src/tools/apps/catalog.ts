/**
 * 第一期内置的 10 个应用：国内 5 个（飞书、腾讯文档、钉钉、高德地图、语雀），海外 5 个（Notion、GitHub、Linear、Atlassian、Canva）。
 * 认证方式和自定义连接器是同一套（types.ts AuthMethod），这里只是替用户把地址、默认方式和说明链接填好。
 *
 * 地址和认证方式都对着线上服务核对过（2026-11-11）：飞书、腾讯文档、Linear、Atlassian、Canva 回 401 并给出授权服务器，
 * 授权服务器都支持动态注册；GitHub 的授权登录要先注册应用，第一期用个人令牌；高德把 Key 放在地址里；
 * 语雀只有本地程序（npm 包 yuque-mcp，随安装包带一份固定版本，见 vendor/yuque-mcp）。
 *
 * 界面上的说明、步骤、示例句在 ui/locales/<语言>/apps.js（apps.catalog.<id>.*）。
 */
import type { ToolCategory } from "./types.js";

export type BuiltinMethod =
  /** 授权登录：点连接就打开浏览器。variants：同一个应用的另一个站点（飞书国际版 Lark） */
  | { kind: "oauth"; url: string; variants?: Array<{ id: string; label: string; url: string }> }
  /** 粘贴令牌，放进一个请求头。prefix 加在令牌前面（"Bearer "） */
  | { kind: "header"; url: string; header: string; prefix?: string; getUrl: string }
  /** 专属链接：用户从服务商那里复制一整条地址 */
  | { kind: "dedicatedUrl"; getUrl: string }
  /** 只填 Key，由我们拼进地址；整条地址按密钥处理 */
  | { kind: "key"; urlTemplate: string; getUrl: string }
  /** 预置的本地程序 + 一个放进环境变量的令牌 */
  | { kind: "localToken"; program: "yuque"; env: string[]; getUrl: string }
  /** 现有的原生实现（accounts/notion.ts）：一键授权和令牌 */
  | { kind: "notion-oauth" }
  | { kind: "notion-token"; getUrl: string };

export interface BuiltinApp {
  id: string;
  /** 中文名和英文名（其他语言用英文名） */
  name: { zh: string; "zh-TW"?: string; en: string };
  /** 国内应用在中文界面置顶，海外应用在其他语言置顶 */
  region: "cn" | "global";
  /** 搜索用的别名和用途词（中英文） */
  keywords: string[];
  /** 连接方式，第一个是默认；两个时连接弹窗里可以切换 */
  methods: BuiltinMethod[];
  /** 官方文档 */
  docs: string;
  /** 官方说明里的权益前提链接（语雀） */
  termsUrl?: string;
  /** 工具类别：按名字给定的优先；没有标注时按名字里的动词判断（官方服务可信）；allRead = 只有查询 */
  categories?: Record<string, ToolCategory>;
  allRead?: boolean;
}

/** 飞书远程 MCP 的工具（mcp.feishu.cn 的 scope 清单）：云文档读写 + 只读的消息，没有发消息，也没有删除 */
const FEISHU_TOOLS: Record<string, ToolCategory> = {
  "search-doc": "read",
  "fetch-doc": "read",
  "list-docs": "read",
  "list-docs-v2": "read",
  "get-comments": "read",
  "search-user": "read",
  "get-user": "read",
  "fetch-file": "read",
  "fetch-file-v2": "read",
  "search-groups": "read",
  "get-group-members": "read",
  "get-messages": "read",
  "get-thread-messages": "read",
  "search-messages": "read",
  "get-read-status": "read",
  "create-doc": "write",
  "update-doc": "write",
  "add-comments": "write",
};

export const BUILTIN_APPS: readonly BuiltinApp[] = [
  {
    id: "feishu",
    name: { zh: "飞书", "zh-TW": "飛書", en: "Feishu" },
    region: "cn",
    keywords: ["飞书", "feishu", "lark", "云文档", "雲端文件", "訊息", "文档", "消息", "群聊", "协作", "docs", "messages", "chat"],
    methods: [{ kind: "oauth", url: "https://mcp.feishu.cn/mcp", variants: [{ id: "lark", label: "Lark", url: "https://mcp.larksuite.com/mcp" }] }],
    docs: "https://open.feishu.cn/document/mcp_open_tools/developers-call-remote-mcp-server",
    categories: FEISHU_TOOLS,
  },
  {
    id: "tencent-docs",
    name: { zh: "腾讯文档", "zh-TW": "騰訊文件", en: "Tencent Docs" },
    region: "cn",
    keywords: ["腾讯文档", "tencent docs", "qq docs", "文档", "表格", "幻灯片", "投影片", "在线文档", "docs", "sheets", "slides", "spreadsheet"],
    methods: [
      { kind: "oauth", url: "https://docs.qq.com/openapi/mcp" },
      { kind: "header", url: "https://docs.qq.com/openapi/mcp", header: "Authorization", getUrl: "https://docs.qq.com/open/auth/mcp.html" },
    ],
    docs: "https://docs.qq.com/open/document/mcp/",
  },
  {
    id: "dingtalk",
    name: { zh: "钉钉", "zh-TW": "釘釘", en: "DingTalk" },
    region: "cn",
    keywords: ["钉钉", "dingtalk", "日程", "待办", "通讯录", "通訊錄", "行事曆", "待辦", "办公", "calendar", "todo", "contacts"],
    methods: [{ kind: "dedicatedUrl", getUrl: "https://open.dingtalk.com/document/development/mcp-square-introduction" }],
    docs: "https://open.dingtalk.com/document/development/mcp-square-introduction",
  },
  {
    id: "amap",
    name: { zh: "高德地图", "zh-TW": "高德地圖", en: "Amap" },
    region: "cn",
    keywords: ["高德", "高德地图", "amap", "gaode", "地图", "路线", "导航", "天气", "周边", "出行", "地址", "map", "maps", "route", "weather", "navigation"],
    methods: [{ kind: "key", urlTemplate: "https://mcp.amap.com/mcp?key={key}", getUrl: "https://console.amap.com/dev/key/app" }],
    docs: "https://developer.amap.com/api/mcp-server/gettingstarted",
    allRead: true,
  },
  {
    id: "yuque",
    name: { zh: "语雀", "zh-TW": "語雀", en: "Yuque" },
    region: "cn",
    keywords: ["语雀", "yuque", "知识库", "知識庫", "筆記", "文档", "笔记", "小记", "knowledge base", "wiki", "docs", "notes"],
    // 包读的是 YUQUE_PERSONAL_TOKEN；YUQUE_TOKEN 是文档里的旧名，一起给
    methods: [{ kind: "localToken", program: "yuque", env: ["YUQUE_PERSONAL_TOKEN", "YUQUE_TOKEN"], getUrl: "https://www.yuque.com/settings/tokens" }],
    docs: "https://github.com/yuque/yuque-mcp-server",
    termsUrl: "https://www.yuque.com/yuque/developer/api",
  },
  {
    id: "notion",
    name: { zh: "Notion", en: "Notion" },
    region: "global",
    keywords: ["notion", "知识库", "知識庫", "筆記", "文档", "笔记", "数据库", "資料庫", "页面", "knowledge base", "wiki", "docs", "notes", "database", "pages"],
    methods: [{ kind: "notion-oauth" }, { kind: "notion-token", getUrl: "https://www.notion.so/developers" }],
    docs: "https://developers.notion.com/docs/mcp",
  },
  {
    id: "github",
    name: { zh: "GitHub", en: "GitHub" },
    region: "global",
    keywords: ["github", "代码", "仓库", "儲存庫", "程式碼", "issue", "pr", "pull request", "开发", "code", "repo", "repository"],
    methods: [{ kind: "header", url: "https://api.githubcopilot.com/mcp/", header: "Authorization", prefix: "Bearer ", getUrl: "https://github.com/settings/personal-access-tokens" }],
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    id: "linear",
    name: { zh: "Linear", en: "Linear" },
    region: "global",
    keywords: ["linear", "项目管理", "專案管理", "任务", "issue", "工单", "进度", "project", "tasks", "tickets"],
    methods: [{ kind: "oauth", url: "https://mcp.linear.app/mcp" }],
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "atlassian",
    name: { zh: "Atlassian", en: "Atlassian" },
    region: "global",
    keywords: ["atlassian", "jira", "confluence", "工单", "项目管理", "專案管理", "知识库", "知識庫", "筆記", "wiki", "tickets", "project"],
    methods: [{ kind: "oauth", url: "https://mcp.atlassian.com/v1/mcp" }],
    docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
  },
  {
    id: "canva",
    name: { zh: "Canva", en: "Canva" },
    region: "global",
    keywords: ["canva", "可画", "设计", "設計", "海报", "幻灯片", "投影片", "design", "poster", "slides", "presentation"],
    methods: [{ kind: "oauth", url: "https://mcp.canva.com/mcp" }],
    docs: "https://www.canva.dev/docs/connect/canva-mcp-server-setup/",
  },
];

export const CUSTOM_APP = "custom";
/** 自定义连接器最多几个 */
export const MAX_CUSTOM = 20;

export function builtinApp(id: string): BuiltinApp | undefined {
  return BUILTIN_APPS.find((a) => a.id === id);
}

/** Match the display name in any supported script. The caller has already trimmed and lowercased the input. */
export function matchesAppName(app: BuiltinApp | undefined, lowerName: string): boolean {
  return !!app && Object.values(app.name).some((name) => name.toLowerCase() === lowerName);
}

/** 给模型和日志看的名字（英文）；界面按语言选 name.zh / name.en */
export function appName(id: string, lang = "en"): string {
  const a = builtinApp(id);
  if (!a) return id;
  if (lang === "zh-TW") return a.name["zh-TW"] ?? a.name.en;
  return lang.startsWith("zh") ? a.name.zh : a.name.en;
}

/** 机器人设置和权限里指一个应用的键：内置应用是它的 id，自定义连接器是 custom:<连接 id> */
export const customKey = (connectionId: string) => `${CUSTOM_APP}:${connectionId}`;
export const isCustomKey = (key: string) => key.startsWith(`${CUSTOM_APP}:`);
export const customIdOf = (key: string) => key.slice(CUSTOM_APP.length + 1);
