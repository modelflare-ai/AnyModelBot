// 机器人眼睛除了睁眼以外的表情。它们平时透明，只有脚本切换 data-eyes 时才显示，
// 而首页有近百个头像、每个两只眼，全写进 HTML 要多出约 130 KB，部分目录站的校验会嫌页面太大。
// 所以 BotFace.astro 只输出睁眼的圆（无 JS 的静态第一帧也只用到它），其余由 lib/eyes.ts 启动时补上。
export function eyeShapes(R: number): string {
  const f = (n: number) => +(n * R).toFixed(2);
  const spiral = Array.from({ length: 29 }, (_, i) => {
    const t = (i / 28) * Math.PI * 4.2, rr = (0.12 + (0.9 * i) / 28) * R;
    return `${i ? "L" : "M"}${(Math.cos(t) * rr).toFixed(2)} ${(Math.sin(t) * rr).toFixed(2)}`;
  }).join("");
  return [
    ["e e-happy line", `M${f(-1.05)} ${f(0.45)}Q0 ${f(-1.3)} ${f(1.05)} ${f(0.45)}`],
    ["e e-closed line", `M${f(-1.05)} ${f(-0.15)}Q0 ${f(0.8)} ${f(1.05)} ${f(-0.15)}`],
    ["e e-sad", `M${f(-1.05)} 0L${f(1.05)} 0A${f(1.05)} ${f(1.05)} 0 0 1 ${f(-1.05)} 0Z`],
    ["e e-x line", `M${f(-0.8)} ${f(-0.8)}L${f(0.8)} ${f(0.8)}M${f(0.8)} ${f(-0.8)}L${f(-0.8)} ${f(0.8)}`],
    ["e e-spiral line thin", spiral],
    ["e e-heart", `M0 ${f(1.05)}C${f(-1.7)} ${f(-0.05)} ${f(-1)} ${f(-1.4)} 0 ${f(-0.5)}C${f(1)} ${f(-1.4)} ${f(1.7)} ${f(-0.05)} 0 ${f(1.05)}Z`],
  ].map(([cls, d]) => `<path class="${cls}" d="${d}"></path>`).join("");
}
