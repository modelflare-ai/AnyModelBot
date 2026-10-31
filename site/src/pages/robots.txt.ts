import type { APIRoute } from "astro";
import { ORIGIN } from "../lib/site";
export const GET: APIRoute = () => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain" } });
