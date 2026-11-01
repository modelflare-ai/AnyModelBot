// GitHub 星数的显示：1000 以内写全，往上用 k（1.2k、12k）。两种语言写法一样。
export function fmtStars(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}
