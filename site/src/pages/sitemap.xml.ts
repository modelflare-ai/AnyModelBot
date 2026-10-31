// sitemap（§15）：首页与附属页的中英文版本，带 hreflang 互指。
import type { APIRoute } from "astro";
import { ORIGIN } from "../lib/site";
import { href } from "../i18n";

const PATHS = ["/", "/download", "/security", "/pricing", "/changelog", "/privacy", "/licenses"];
export const GET: APIRoute = () => {
  const urls = PATHS.flatMap((p) =>
    (["zh", "en"] as const).map((lang) => {
      const alt = (["zh", "en"] as const).map((l) => `<xhtml:link rel="alternate" hreflang="${l === "zh" ? "zh-CN" : "en"}" href="${ORIGIN}${href(l, p)}"/>`).join("");
      return `<url><loc>${ORIGIN}${href(lang, p)}</loc>${alt}<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${href("zh", p)}"/></url>`;
    }),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
