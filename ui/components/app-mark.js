// 内置应用用随客户端分发的官方标志；自定义连接器仍用首字占位。来源见 assets/apps/sources.json。
import { html } from "./ui.js";

const LOGOS = {
  feishu: "feishu.svg",
  "tencent-docs": "tencent-docs.svg",
  dingtalk: "dingtalk.png",
  amap: "amap.png",
  yuque: "yuque.svg",
  notion: "notion.png",
  github: "github.png",
  linear: "linear.png",
  atlassian: "atlassian.png",
  canva: "canva.webp",
};

/** app 使用稳定的内置应用 ID，不根据翻译后的名称猜品牌。相邻文字提供可访问名称。 */
export function AppMark({ app, name, size }) {
  const logo = Object.hasOwn(LOGOS, app) ? LOGOS[app] : null;
  const cls = `apps-mark${size === "sm" ? " sm" : ""}`;
  if (logo) return html`<span class=${`${cls} branded`} aria-hidden="true"><img src=${`/amb/static/assets/apps/${logo}`} alt="" draggable="false" /></span>`;

  const text = String(name || "?").trim();
  const ch = [...text][0]?.toUpperCase() ?? "?";
  let h = 0;
  for (const c of text) h = (h * 31 + c.codePointAt(0)) % 6;
  return html`<span class=${`${cls} tone-${h}`} aria-hidden="true">${ch}</span>`;
}
