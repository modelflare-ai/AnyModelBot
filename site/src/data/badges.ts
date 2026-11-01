// 页脚 "Featured on / 被收录于" 那一排（components/Footer.astro）。
// 这些目录站的免费收录要求我们站放它们的徽章或反链，校验机器人多半只读服务器输出的 HTML，
// 所以这里存站方给的原码，构建时直接写进静态页；不要改成前端渲染，出站链接也不要加 nofollow。
// 不少站会定期复查（AI Tool Trek、MarketingDB 等），徽章移除后会下架或把链接降为 nofollow，删之前先确认。
//
// 图片故意外链到站方：校验可能看图片地址，而且很多 SVG 有几十 KB，放不进 public/ 的体积预算（check-images）。
// 隐私说明（i18n 的 privacy.body）写了这个例外，这里改动外链方式时那边要同步。
//
// 除了下面注明的两处，代码都和站方页面一字不差。

export interface Badge {
  name: string;
  /** 站方原码。有 dark 时这是浅色主题用的款式，没有就两个主题共用 */
  html: string;
  /** 站方的深色款，深色主题用 */
  dark?: string;
  /**
   * 默认：图片徽章，统一缩放到一个高度。
   * text：站方只要一条文字链接，页脚里画成小胶囊。
   * natural：保持站方尺寸（HTML 画的徽章，或本身就矮的徽章）。
   */
  kind?: "text" | "natural";
}

export const BADGES: Badge[] = [
  {
    name: "Whatsthebigdata",
    html: `<a href="https://whatsthebigdata.com/ai-tools/" target="_blank" rel="noopener" title="Whatsthebigdata AI Tools Directory"><img src="https://whatsthebigdata.com/badges/featured-on-whatsthebigdata-color.png" alt="Featured on Whatsthebigdata" width="240" style="max-width:100%;height:auto"/></a>`,
    dark: `<a href="https://whatsthebigdata.com/ai-tools/" target="_blank" rel="noopener" title="Whatsthebigdata AI Tools Directory"><img src="https://whatsthebigdata.com/badges/featured-on-whatsthebigdata-dark.png" alt="Featured on Whatsthebigdata" width="240" style="max-width:100%;height:auto"/></a>`,
  },
  {
    // rel 里的 nofollow sponsored 是站方原码自带的；要求放在 /en/ 上，页脚每页都有，满足
    name: "MarketingDB",
    html: `<a href="https://marketingdb.live" target="_blank" rel="noopener noreferrer nofollow sponsored"><img src="https://marketingdb.live/badges/classic-dark.svg" alt="Launched on MarketingDB" width="200" height="48"/></a>`,
  },
  {
    name: "Mydentify",
    kind: "natural",
    html: `<a href="https://mydentify.com/" aria-label="Listed on Mydentify"><img src="https://mydentify.com/badges/listed-on-mydentify.svg" alt="Listed on Mydentify" width="176" height="32"></a>`,
  },
  {
    name: "AI Toolz Dir",
    kind: "text",
    html: `<a href="https://www.aitoolzdir.com" target="_blank">AI Toolz Dir</a>`,
  },
  {
    name: "DeepLaunch.io",
    html: `<a href="https://deeplaunch.io" target="_blank"><img src="https://deeplaunch.io/badge/badge_light.svg" alt="Featured on DeepLaunch.io" width="200" height="54" /></a>`,
    dark: `<a href="https://deeplaunch.io" target="_blank"><img src="https://deeplaunch.io/badge/badge_dark.svg" alt="Featured on DeepLaunch.io" width="200" height="54" /></a>`,
  },
  {
    name: "Dofollow.Tools",
    html: `<a href="https://dofollow.tools" target="_blank"><img src="https://dofollow.tools/badge/badge_light.svg" alt="Featured on Dofollow.Tools" width="200" height="54" /></a>`,
    dark: `<a href="https://dofollow.tools" target="_blank"><img src="https://dofollow.tools/badge/badge_dark.svg" alt="Featured on Dofollow.Tools" width="200" height="54" /></a>`,
  },
  {
    name: "ToolDirs",
    html: `<a href="https://tooldirs.com" target="_blank"><img src="https://tooldirs.com/badge/badge_light.svg" alt="Featured on ToolDirs" width="200" height="54" /></a>`,
    dark: `<a href="https://tooldirs.com" target="_blank"><img src="https://tooldirs.com/badge/badge_dark.svg" alt="Featured on ToolDirs" width="200" height="54" /></a>`,
  },
  {
    name: "Twelve Tools",
    html: `<a href="https://twelve.tools" target="_blank"><img src="https://twelve.tools/badge0-light.svg" alt="Featured on Twelve Tools" width="200" height="54"></a>`,
    dark: `<a href="https://twelve.tools" target="_blank"><img src="https://twelve.tools/badge0-dark.svg" alt="Featured on Twelve Tools" width="200" height="54"></a>`,
  },
  {
    name: "TopAITools4U",
    kind: "natural",
    html: `<a data-topaitools4u-badge="verified-listing" href="https://www.topaitools4u.site" target="_blank" rel="noopener" aria-label="Listed on TopAITools4U" style="display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #d9d9d9;border-radius:12px;background:#ffffff;color:#111111;font-family:Inter,Arial,sans-serif;text-decoration:none;">
  <img src="https://www.topaitools4u.site/logo.svg" alt="TopAITools4U" width="32" height="32" style="display:block;width:32px;height:32px;border-radius:9px;" />
  <span style="display:flex;flex-direction:column;line-height:1.15;">
    <span style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Listed on</span>
    <span style="font-size:15px;font-weight:700;">TopAITools4U</span>
  </span>
</a>`,
  },
  {
    name: "AI Tool Trek",
    kind: "text",
    html: `<a href='https://aitooltrek.com' title='AI Tool Trek'>AI Tool Trek</a>`,
  },
  {
    name: "Nick Launches",
    html: `<a href="https://nicklaunches.com/" target="_blank" rel="noopener"><img src="https://nicklaunches.com/badges/featured.png" alt="Featured on Nick Launches" width="244" height="56" /></a>`,
    dark: `<a href="https://nicklaunches.com/" target="_blank" rel="noopener"><img src="https://nicklaunches.com/badges/featured-dark.png" alt="Featured on Nick Launches" width="244" height="56" /></a>`,
  },
  {
    // 改动一：站方码还带一条 7px 小字链接 "Launch your MCP" → mcpshelf.co（站方的姊妹产品），这里删了。
    // 站方 FAQ 说校验只认徽章图或指向 launchllama.co 的链接，不影响验证
    name: "Launch Llama",
    html: `<span style="display:inline-block;text-align:center;font-family:system-ui,sans-serif;line-height:1;"><a href="https://tools.launchllama.co?utm_source=badge&utm_medium=referral" target="_blank" rel="noopener noreferrer" style="display:block;line-height:0;"> <img src="https://tools.launchllama.co/featured-badge-white.jpg?v=5" alt="Launch Llama Tools" width="200" height="52" style="display:block;border:0;" /> </a></span>`,
    dark: `<span style="display:inline-block;text-align:center;font-family:system-ui,sans-serif;line-height:1;"><a href="https://tools.launchllama.co?utm_source=badge&utm_medium=referral" target="_blank" rel="noopener noreferrer" style="display:block;line-height:0;"> <img src="https://tools.launchllama.co/featured-badge.png?v=2" alt="Launch Llama Tools" width="200" height="52" style="display:block;border:0;" /> </a></span>`,
  },
  {
    // 改动二：站方深色款的图片地址写成了 https://https://（打不开），这里改成正确的地址
    name: "Aura++",
    html: `<a href=https://auraplusplus.com target="_blank" title="Featured on Aura++">
  <img
    src="https://auraplusplus.com/images/badges/featured-on-light.svg"
    alt="Featured on Aura++"
    width="150"
    height="44"
  />
</a>`,
    dark: `<a href=https://auraplusplus.com target="_blank" title="Featured on Aura++">
  <img
    src="https://auraplusplus.com/images/badges/featured-on-dark.svg"
    alt="Featured on Aura++"
    width="150"
    height="44"
  />
</a>`,
  },
  {
    name: "OpenHunts",
    html: `<a href="https://openhunts.com" target="_blank" title="OpenHunts Club">
  <img alt="OpenHunts Club Member" height="105" src="https://cdn.openhunts.com/badges/club.webp" style="width: 195px; height: auto;" width="486">
</a>`,
  },
];
