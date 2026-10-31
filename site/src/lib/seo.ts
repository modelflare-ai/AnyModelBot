// 结构化数据（§15）：SoftwareApplication（offers 只描述 App 本身：免费）、Organization、FAQPage（与可见文案一致）。
import { dict, fmt, buildVars, href, type Lang } from "../i18n";
import { ORIGIN, GITHUB_URL } from "./site";

export function homeJsonLd(lang: Lang) {
  const t = dict(lang);
  const v = buildVars(lang);
  const url = `${ORIGIN}${href(lang, "/")}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "AnyModelBot",
      applicationCategory: "ProductivityApplication",
      operatingSystem: "Windows, macOS, Linux",
      description: t.meta.description,
      url,
      inLanguage: t.meta.lang,
      license: "https://opensource.org/licenses/MIT",
      softwareVersion: String(v.version),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      codeRepository: GITHUB_URL,
    },
    { "@context": "https://schema.org", "@type": "Organization", name: "AnyModelBot", url: `${ORIGIN}/`, logo: `${ORIGIN}/icon-512.png`, sameAs: [GITHUB_URL] },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: t.meta.lang,
      mainEntity: t.faq.items.map((it) => ({ "@type": "Question", name: it.q, acceptedAnswer: { "@type": "Answer", text: fmt(it.a, v) } })),
    },
  ];
}
