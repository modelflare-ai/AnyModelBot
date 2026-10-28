// AST → Preact 节点。文本始终作为文本节点渲染；链接已在解析时经 safeHref 过滤。
import { h } from "preact";
import { parseMarkdown, linkify } from "../lib/markdown.js";
import { html, CopyButton } from "./ui.js";

function inline(nodes) {
  return nodes.map((n, i) => {
    if (typeof n === "string") return n;
    switch (n.t) {
      case "br":
        return h("br", { key: i });
      case "code":
        return h("code", { key: i }, n.text);
      case "b":
        return h("strong", { key: i }, inline(n.c));
      case "i":
        return h("em", { key: i }, inline(n.c));
      case "s":
        return h("del", { key: i }, inline(n.c));
      case "a":
        return h("a", { key: i, href: n.href, target: "_blank", rel: "noopener noreferrer" }, inline(n.c));
      default:
        return null;
    }
  });
}

function CodeBlock({ lang, text }) {
  return html`<div class="codeblock">
    <div class="bar"><span class="lang">${lang || "代码"}</span><${CopyButton} text=${text} label="复制代码" /></div>
    <pre><code>${text}</code></pre>
  </div>`;
}

function blocks(list) {
  return list.map((b, i) => {
    switch (b.t) {
      case "p":
        return h("p", { key: i }, inline(b.c));
      case "h":
        return h("h" + Math.min(4, b.level), { key: i }, inline(b.c));
      case "hr":
        return h("hr", { key: i });
      case "code":
        return h(CodeBlock, { key: i, lang: b.lang, text: b.text });
      case "quote":
        return h("blockquote", { key: i }, blocks(b.c));
      case "ul":
      case "ol":
        return h(b.t, { key: i, start: b.t === "ol" && b.start !== 1 ? b.start : undefined }, b.items.map((it, k) => h("li", { key: k }, inline(it.c), it.sub.length ? blocks(it.sub) : null)));
      case "table":
        return h(
          "div",
          { key: i, class: "table-wrap" },
          h("table", null, h("thead", null, h("tr", null, b.head.map((c, k) => h("th", { key: k, style: b.align[k] ? { textAlign: b.align[k] } : undefined }, inline(c))))), h("tbody", null, b.rows.map((r, k) => h("tr", { key: k }, r.map((c, j) => h("td", { key: j, style: b.align[j] ? { textAlign: b.align[j] } : undefined }, inline(c))))))),
        );
      default:
        return null;
    }
  });
}

export function Markdown({ text }) {
  return h("div", { class: "md" }, blocks(parseMarkdown(text)));
}

export function Linkified({ text }) {
  return inline(linkify(text));
}
