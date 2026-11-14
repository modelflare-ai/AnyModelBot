// AST → Preact 节点。文本始终作为文本节点渲染；链接已在解析时经 safeHref 过滤。
import { h } from "preact";
import { parseMarkdown, linkify } from "../lib/markdown.js";
import { html, CopyButton } from "./ui.js";
import { appFileResource, fileResource, resourceFileUrl, openResource, plainClick, previewWebsite } from "../lib/resource-preview.js";
import { t } from "../lib/i18n.js";

function inline(nodes, ctx) {
  return nodes.map((n, i) => {
    if (typeof n === "string") return n;
    switch (n.t) {
      case "br":
        return h("br", { key: i });
      case "code":
        return h("code", { key: i }, n.text);
      case "b":
        return h("strong", { key: i }, inline(n.c, ctx));
      case "i":
        return h("em", { key: i }, inline(n.c, ctx));
      case "s":
        return h("del", { key: i }, inline(n.c, ctx));
      case "a":
        return h("a", { key: i, href: n.href, target: "_blank", rel: "noopener noreferrer", onClick: previewWebsite }, inline(n.c, ctx));
      case "file": {
        let path = n.path;
        if (ctx?.filePath && !/^(?:[A-Za-z]:[\\/]|\/)/.test(path)) path = ctx.filePath.replace(/[^\\/]+$/, "") + path;
        if (!path || !(ctx?.conv || ctx?.botId)) return inline(n.c, ctx);
        const resource = ctx.botId ? appFileResource(path, ctx.botId, ctx.canOpen) : fileResource({ path }, ctx.conv, ctx.canOpen);
        if (!resource) return inline(n.c, ctx);
        return h("a", { key: i, href: resourceFileUrl(resource), target: "_blank", rel: "noopener noreferrer", onClick: (e) => {
          if (plainClick(e) && openResource(resource)) e.preventDefault();
        } }, inline(n.c, ctx));
      }
      default:
        return null;
    }
  });
}

function CodeBlock({ lang, text }) {
  return html`<div class="codeblock">
    <div class="bar"><span class="lang">${lang || t("markdown.code")}</span><${CopyButton} text=${text} label=${t("markdown.copyCode")} /></div>
    <pre><code>${text}</code></pre>
  </div>`;
}

function blocks(list, ctx) {
  return list.map((b, i) => {
    switch (b.t) {
      case "p":
        return h("p", { key: i }, inline(b.c, ctx));
      case "h":
        return h("h" + Math.min(4, b.level), { key: i }, inline(b.c, ctx));
      case "hr":
        return h("hr", { key: i });
      case "code":
        return h(CodeBlock, { key: i, lang: b.lang, text: b.text });
      case "quote":
        return h("blockquote", { key: i }, blocks(b.c, ctx));
      case "ul":
      case "ol":
        return h(b.t, { key: i, start: b.t === "ol" && b.start !== 1 ? b.start : undefined }, b.items.map((it, k) => h("li", { key: k }, inline(it.c, ctx), it.sub.length ? blocks(it.sub, ctx) : null)));
      case "table":
        return h(
          "div",
          { key: i, class: "table-wrap" },
          h("table", null, h("thead", null, h("tr", null, b.head.map((c, k) => h("th", { key: k, style: b.align[k] ? { textAlign: b.align[k] } : undefined }, inline(c, ctx))))), h("tbody", null, b.rows.map((r, k) => h("tr", { key: k }, r.map((c, j) => h("td", { key: j, style: b.align[j] ? { textAlign: b.align[j] } : undefined }, inline(c, ctx))))))),
        );
      default:
        return null;
    }
  });
}

export function Markdown({ text, conv, botId, filePath, canOpen }) {
  return h("div", { class: "md" }, blocks(parseMarkdown(text, !!(conv || botId)), { conv, botId, filePath, canOpen }));
}

export function Linkified({ text }) {
  return inline(linkify(text));
}
