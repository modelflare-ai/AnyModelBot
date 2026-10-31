// 顶部公告条（components/SiteBanner.astro）的内容：发版下载提示 + 宣传 / 公告。改这一个文件就行，页面里不写死。
//
// - 同时有效的条目轮播：6 秒一条，鼠标悬停 / 键盘聚焦 / 标签页在后台时暂停，系统开了"减少动态效果"就不自动轮播；
//   访客可以左右翻（手机上左右滑）。点 × 关掉后，这些条目按 id 记在访客本机，不再出现——想让关过的人重新看到，换个 id。
// - start / end：显示时间窗。只写日期时按北京时间算整天（start 当天 0 点起，end 当天 24 点止），
//   也可以写完整时间，如 "2026-11-11T20:00+08:00"。构建时已经过期的条目不输出；还没开始的照常输出但隐藏，
//   到点由浏览器自己显示（站点每天重建一次，过期的条目在浏览器里也会按时隐藏）。
// - countdown：在文案后显示"截至 11 月 30 日"，最后 7 天变成"还剩 N 天"（需要 end）。
// - 链接以 / 开头是站内路径，自动加语言前缀（/pricing → /en/pricing）；http(s) 开头的在新标签页打开。
// - 文案里可以用构建变量 {modelCount}、{version} 等（i18n 的 buildVars）。
// - 预览：任意页面地址后加 ?banner=preview，忽略关闭记录和时间窗，显示全部条目和语言提示。

/** 标签配色：accent 品牌色实底（发版用）、promo 品牌色浅底、neutral 中性描边、warn 琥珀色（维护、故障） */
export type Tone = "accent" | "promo" | "neutral" | "warn";
export interface BannerLink { label: string; href: string }
export interface BannerCopy {
  /** 左侧小标签，2–6 个字 */
  tag: string;
  /** 一句话，越短越好（中文 ≤ 20 字左右） */
  text: string;
  /** 主操作，带箭头 */
  cta?: BannerLink;
  /** 次要链接，手机上隐藏 */
  link?: BannerLink;
}
export interface Announcement {
  id: string;
  /** promo = 宣传 / 活动，notice = 公告 */
  kind: "promo" | "notice";
  /** 默认 promo → "promo"，notice → "neutral" */
  tone?: Tone;
  start?: string;
  end?: string;
  countdown?: boolean;
  zh: BannerCopy;
  en: BannerCopy;
}

/** 发版提示：版本号和下载地址取自 releases.json；按钮按访客的系统直接下载对应安装包（识别不出时去 /download）。 */
export const RELEASE = {
  enabled: true,
  /** 发布后显示多少天；releases.json 里没有有效发布日期时一直显示 */
  days: 30,
  /** 各版本的一句话亮点（可选），没有就显示"AnyModelBot {version} 已发布" */
  highlights: {
    "0.1.10": { zh: "机器人能收微信里的图片和文件了", en: "Bots can now see the images and files you send" },
  } as Record<string, { zh: string; en: string }>,
};

/** 轮播间隔（毫秒） */
export const ROTATE_MS = 6000;

/** 宣传 / 公告，按顺序排在发版提示后面 */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "promo-free-app",
    kind: "promo",
    zh: { tag: "免费开源", text: "一个 Key 用上 {modelCount} 个模型", cta: { label: "看价格", href: "/pricing" } },
    en: { tag: "Free app", text: "One key for {modelCount} models", cta: { label: "Pricing", href: "/pricing" } },
  },
  // 公告示例（维护通知）：到点自动出现、过期自动消失，复制后改 id、时间和文案即可
  // {
  //   id: "notice-2026-11-maintenance",
  //   kind: "notice",
  //   tone: "warn",
  //   start: "2026-11-07",
  //   end: "2026-11-08",
  //   countdown: true,
  //   zh: { tag: "维护", text: "11 月 8 日 02:00–04:00（北京时间）下载服务维护", link: { label: "更新日志", href: "/changelog" } },
  //   en: { tag: "Maintenance", text: "Downloads are under maintenance on Nov 8, 02:00–04:00 (UTC+8)", link: { label: "Changelog", href: "/changelog" } },
  // },
];
