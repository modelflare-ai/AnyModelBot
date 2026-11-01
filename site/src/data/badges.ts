// 页脚 "Featured on / 被收录于" 那一排（components/Footer.astro）。
// 这些目录站的免费收录要求我们站放它们的徽章或反链，校验机器人多半只读服务器输出的 HTML，
// 所以这里存站方给的原码，构建时直接写进静态页；不要改成前端渲染，出站链接也不要加 nofollow。
// 不少站会定期复查（AI Tool Trek、MarketingDB 等），徽章移除后会下架或把链接降为 nofollow，删之前先确认。
//
// 图片故意外链到站方：校验可能看图片地址。隐私说明（i18n 的 privacy.body）写了这个例外，这里改动外链方式时那边要同步。
// 站方的图不一定连得上（对方限流、访客网络不通、被插件拦截），所以 public/badges/ 里每张都有一份备份垫在下面，
// 站方的图加载成功才盖上去。新增或换了图片徽章要跑 npm run badges:copies，check-images 会查缺的文件。
//
// 除了下面注明的几处，代码都和站方页面一字不差。

export interface Badge {
  name: string;
  /** 站方原码。有 dark 时这是浅色主题用的款式，没有就两个主题共用 */
  html: string;
  /** 站方的深色款，深色主题用 */
  dark?: string;
  /**
   * 默认：图片徽章，统一缩放到一个高度。
   * natural：图片徽章，但本身就矮，保持站方尺寸。
   * text：站方只要一条文字链接。
   * html：站方用 HTML 画的徽章，页脚的样式会盖掉它自带的底色和边框。
   */
  kind?: "natural" | "text" | "html";
  /** 取不到站方的图，没有本地备份：站方的图加载出来之前，格子里显示站名 */
  noCopy?: boolean;
}

export interface BadgeVariant {
  html: string;
  /** 只在这个主题下显示；没有就两个主题都显示 */
  on?: "dark" | "light";
  /** 站方图片的地址和它在 public/ 下的备份。文字徽章没有图，HTML 画的徽章只有一个小 logo，都不备份 */
  copy?: { remote: string; path: string };
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** 页脚实际输出的条目：有深色款的徽章出两条，由 CSS 按主题显示一条 */
export function badgeVariants({ name, html, dark, kind, noCopy }: Badge): BadgeVariant[] {
  const list = dark ? [{ html: dark, on: "dark" as const }, { html, on: "light" as const }] : [{ html }];
  if (kind === "text" || kind === "html" || noCopy) return list;
  return list.map((v) => {
    const remote = v.html.match(/<img\b[^>]*?\ssrc="([^"]+)"/)?.[1];
    if (!remote) throw new Error(`徽章 ${name} 的代码里找不到图片地址`);
    const suffix = "on" in v ? `-${v.on}` : "";
    return { ...v, copy: { remote, path: `badges/${slug(name)}${suffix}.webp` } };
  });
}

export const BADGES: Badge[] = [
  {
    // 站方的深色款（...-dark.png）在深色底上字几乎看不清，两个主题都用彩色款
    name: "Whatsthebigdata",
    html: `<a href="https://whatsthebigdata.com/ai-tools/" target="_blank" rel="noopener" title="Whatsthebigdata AI Tools Directory"><img src="https://whatsthebigdata.com/badges/featured-on-whatsthebigdata-color.png" alt="Featured on Whatsthebigdata" width="240" style="max-width:100%;height:auto"/></a>`,
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
    kind: "html",
    html: `<a data-topaitools4u-badge="verified-listing" href="https://www.topaitools4u.site" target="_blank" rel="noopener" aria-label="Listed on TopAITools4U" style="display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #d9d9d9;border-radius:12px;background:#ffffff;color:#111111;font-family:Inter,Arial,sans-serif;text-decoration:none;">
  <img src="https://www.topaitools4u.site/logo.svg" alt="TopAITools4U" width="32" height="32" style="display:block;width:32px;height:32px;border-radius:9px;" />
  <span style="display:flex;flex-direction:column;line-height:1.15;">
    <span style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Listed on</span>
    <span style="font-size:15px;font-weight:700;">TopAITools4U</span>
  </span>
</a>`,
  },
  {
    // 站方码的链接是首页 nicklaunches.com/，校验要求指向我们的产品页，这里改了
    name: "Nick Launches",
    html: `<a href="https://nicklaunches.com/products/anymodelbot/" target="_blank" rel="noopener"><img src="https://nicklaunches.com/badges/featured.png" alt="Featured on Nick Launches" width="244" height="56" /></a>`,
    dark: `<a href="https://nicklaunches.com/products/anymodelbot/" target="_blank" rel="noopener"><img src="https://nicklaunches.com/badges/featured-dark.png" alt="Featured on Nick Launches" width="244" height="56" /></a>`,
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
  {
    // 站方开了 Vercel 安全检查，服务器请求这张图只拿到 429 和验证页（2026-11-01），所以没有备份；访客的浏览器能否加载也不确定
    name: "Startup Fame",
    noCopy: true,
    html: `<a href="https://startupfa.me/s/anymodelbot?utm_source=anymodel.bot" target="_blank"><img src="https://startupfa.me/badges/featured-badge.webp" alt="AnyModelBot - Featured on Startup Fame" width="171" height="54" /></a>`,
  },
  {
    name: "SaaSCity",
    html: `<a href="https://saascity.io" target="_blank" rel="noopener">
  <img src="https://saascity.io/badges/featured-dark.svg" alt="Featured on SaaSCity" width="150" height="54" />
</a>`,
  },
  {
    // 站方只给图片没给 HTML，这段是按它品牌页的 "Featured on ToolPilot" 黑底图拼的
    name: "ToolPilot",
    html: `<a href="https://www.toolpilot.ai" target="_blank"><img src="https://www.toolpilot.ai/cdn/shop/files/f-b_690x151_crop_center.png" alt="Featured on ToolPilot" width="150" height="33" /></a>`,
  },
  {
    name: "Findly.tools",
    html: `<a href="https://findly.tools/anymodelbot?utm_source=anymodelbot" target="_blank" rel="noopener noreferrer">
  <img src="https://findly.tools/badges/findly-tools-badge-dark.svg" alt="Featured on Findly.tools" width="175" height="55" />
</a>`,
  },
  {
    name: "Fazier",
    html: `<a href="https://fazier.com" target="_blank"><img src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=featured&theme=light" width=250 alt="Fazier badge" /></a>`,
  },
  {
    name: "Neeed Directory",
    html: `<a href="https://neeed.directory/products/anymodelbot?utm_source=anymodelbot" target="_blank" rel="noopener">
  <img src="https://neeed.directory/badges/neeed-badge-dark.svg" alt="Featured on neeed.directory" width="139" />
</a>`,
  },
  {
    name: "Turbo0",
    html: `<a href="https://turbo0.com/item/anymodelbot" target="_blank" rel="noopener noreferrer">
  <img src="https://img.turbo0.com/badge-listed-dark.svg" alt="Listed on Turbo0" style="height: 54px; width: auto;" />
</a>`,
  },
  {
    name: "Smol Launch",
    html: `<a href="https://smollaunch.com" target="_blank" rel="noopener">
  <img src="https://smollaunch.com/badges/featured-dark.svg" alt="AnyModelBot — Featured on Smol Launch" loading="lazy" width="250" height="60" />
</a>`,
  },
  {
    name: "IndieHunt",
    html: `<a href="https://indiehunt.io/project/anymodelbot" target="_blank" rel="noopener">
  <img src="https://indiehunt.io/badges/indiehunt-badge-dark.svg" alt="Featured on IndieHunt" width="265" height="58" />
</a>`,
  },
  {
    // 链接必须指向我们在站方的产品页，否则验证不过。站方原码是浅色款 light.svg，这里按站方的说法换成了深色款 dark.svg
    name: "Aidirs",
    html: `<a href="https://aidirs.best/item/any-model-bot" target="_blank" rel="noopener">
  <img src="https://aidirs.best/dark.svg" alt="AnyModelBot | Aidirs" width="200" height="56" />
</a>`,
  },
  {
    name: "StartupTrusted",
    html: `<a href="https://startuptrusted.com?ref=anymodel.bot" target="_blank" rel="noopener">
  <img src="https://startuptrusted.com/api/badge?type=featured&style=dark" alt="AnyModelBot on StartupTrusted" width="240" height="54" />
</a>`,
  },
  {
    // 站方要求徽章长期保留
    name: "Uno Directory",
    html: `<a href="https://uno.directory" target="_blank" rel="noopener">
  <img src="https://uno.directory/uno-directory.svg" alt="Listed on Uno Directory" width="120" height="30" />
</a>`,
  },
  {
    name: "Huzzler",
    html: `<a href="https://huzzler.so/products/gZTJSjWHoU/anymodelbot?utm_source=huzzler_product_website&amp;utm_medium=badge&amp;utm_campaign=badge" target="_blank" rel="noopener noreferrer">
    <img alt="Huzzler Embed Badge" src="https://huzzler.so/assets/images/embeddable-badges/featured.png" width="159" height="55" />
</a>`,
  },
  {
    name: "ShipBoost",
    html: `<a href="https://shipboost.io/tools/anymodelbot" data-shipboost-badge="free-launch" target="_blank" rel="noopener">
  <img src="https://shipboost.io/badge/cmvx0coz20001qh0t19nupsyp?theme=dark" alt="Featured on ShipBoost" width="244" height="56" style="width:244px;height:56px;" />
</a>`,
  },
  {
    // 站方只给了白色版，深色款是把地址里的 white 换成 dark；页脚必须放
    name: "ShowMeBestAI",
    html: `<a href="https://showmebest.ai" target="_blank"><img src="https://showmebest.ai/badge/feature-badge-white.webp" alt="Featured on ShowMeBestAI" width="220" height="60"></a>`,
    dark: `<a href="https://showmebest.ai" target="_blank"><img src="https://showmebest.ai/badge/feature-badge-dark.webp" alt="Featured on ShowMeBestAI" width="220" height="60"></a>`,
  },
  {
    // 站方要求：首页页脚、服务端输出，href 和 src 都不能改，不加 nofollow 和 utm
    name: "ScrollLaunch",
    html: `<a href="https://www.scrolllaunch.com/products/anymodelbot?ref=badge" target="_blank" rel="noopener">
  <img src="https://www.scrolllaunch.com/api/badge/anymodelbot?variant=launched&theme=dark" alt="AnyModelBot - Featured on ScrollLaunch" width="220" height="48" />
</a>`,
  },
  {
    name: "AI Toolz Dir",
    kind: "text",
    html: `<a href="https://www.aitoolzdir.com" target="_blank">AI Toolz Dir</a>`,
  },
  {
    name: "AI Tool Trek",
    kind: "text",
    html: `<a href='https://aitooltrek.com' title='AI Tool Trek'>AI Tool Trek</a>`,
  },
  {
    name: "AI Hustle",
    kind: "text",
    html: `<a href="https://aihustle.tools" target="_blank">AI Hustle</a>`,
  },
  {
    // 站方说链接或徽章都行；它的深色徽章内嵌超长 SVG，这里用最简的文字链接。必须放首页
    name: "Bowora",
    kind: "text",
    html: `<a href="https://bowora.com/?via=6oyuqkbm" target="_blank">Featured on Bowora</a>`,
  },
  {
    name: "AiToolSaver",
    kind: "text",
    html: `<a href="https://www.aitoolsaver.com" target="_blank">Featured on AiToolSaver</a>`,
  },
];
