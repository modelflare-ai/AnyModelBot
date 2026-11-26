/** Animate headings without splitting Korean words or Japanese loanwords mid-line. */
export function headingUnits(text: string, lang: string): string[] {
  if (lang.startsWith("zh")) return Array.from(text);
  if (lang === "ja") return Array.from(new Intl.Segmenter("ja", { granularity: "word" }).segment(text), (part) => part.segment);
  return text.split(/(\s+)/).filter(Boolean);
}
