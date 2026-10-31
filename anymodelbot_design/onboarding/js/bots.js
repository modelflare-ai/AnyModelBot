// 把页面里的 <span class="face" data-char="blue" style="width: 34px; …"> 换成会动的毛绒机器人。
// 结构与官网 site/src/components/BotFace.astro、App 的 ui/components/avatar.js 一致；几何抄自 site/src/lib/bots.ts。
const CHARS = {
  blue: { eyes: [[38.81, 62.99], [60.82, 62.99]], r: 3.41, earL: [18.14, 62.21], earR: [81.94, 62.21], top: [49.96, 31.78], tip: [49.8, 21.2] },
  yellow: { eyes: [[38.34, 63.5], [61.4, 63.48]], r: 3.57, earL: [17.91, 62.13], earR: [82.25, 62.13], top: [50.04, 31.32], tip: [50, 19.7] },
  green: { eyes: [[38.8, 63.07], [61.09, 63.08]], r: 3.49, earL: [17.91, 62.71], earR: [82.02, 62.71], top: [50, 31.32], tip: [50.2, 21.2] },
  red: { eyes: [[37.53, 59.46], [62.24, 59.45]], r: 3.88, earL: [19.53, 58.06], earR: [80.47, 58.06], top: [50.04, 28.37], tip: [50, 15] },
  purple: { eyes: [[38.86, 63.04], [60.96, 63.04]], r: 3.49, earL: [18.14, 62.91], earR: [81.94, 62.91], top: [49.84, 32.87], tip: [50, 22] },
  orange: {
    eyes: [[38.18, 61.84], [61.83, 61.84]], r: 3.57, earL: [15.66, 61.47], earR: [84.34, 61.47], top: [50.12, 27.44], tip: [50, 17],
    lens: [[35.27, 40.85], [64.81, 40.85], 6.4],
  },
};

const pct = (p) => `${p[0]}% ${p[1]}%`;

function eyesSvg(c) {
  const R = c.r, f = (n) => +(n * R).toFixed(2);
  const spiral = Array.from({ length: 29 }, (_, i) => {
    const t = (i / 28) * Math.PI * 4.2, rr = (0.12 + (0.9 * i) / 28) * R;
    return `${i ? "L" : "M"}${(Math.cos(t) * rr).toFixed(2)} ${(Math.sin(t) * rr).toFixed(2)}`;
  }).join("");
  const eye = (e, i) => `<g transform="translate(${e[0]} ${e[1]})${i ? " scale(-1 1)" : ""}"><g class="bf-lid">
    <circle class="e e-open" r="${R}"/>
    <path class="e e-happy line" d="M${f(-1.05)} ${f(0.45)}Q0 ${f(-1.3)} ${f(1.05)} ${f(0.45)}"/>
    <path class="e e-closed line" d="M${f(-1.05)} ${f(-0.15)}Q0 ${f(0.8)} ${f(1.05)} ${f(-0.15)}"/>
    <path class="e e-sad" d="M${f(-1.05)} 0L${f(1.05)} 0A${f(1.05)} ${f(1.05)} 0 0 1 ${f(-1.05)} 0Z"/>
    <path class="e e-x line" d="M${f(-0.8)} ${f(-0.8)}L${f(0.8)} ${f(0.8)}M${f(0.8)} ${f(-0.8)}L${f(-0.8)} ${f(0.8)}"/>
    <path class="e e-spiral line thin" d="${spiral}"/>
    <path class="e e-heart" d="M0 ${f(1.05)}C${f(-1.7)} ${f(-0.05)} ${f(-1)} ${f(-1.4)} 0 ${f(-0.5)}C${f(1)} ${f(-1.4)} ${f(1.7)} ${f(-0.05)} 0 ${f(1.05)}Z"/>
  </g></g>`;
  return `<svg class="bf-eyes" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g class="bf-gaze"><g class="bf-glance">${c.eyes.map(eye).join("")}</g></g></svg>`;
}

/** 一个占位 → 一个 .bot-face；保留占位上的定位样式和 id / data-*。48px 以上的大头像会呼吸、眨眼、四处看 */
export function renderFace(slot) {
  const char = CHARS[slot.dataset.char] ? slot.dataset.char : "blue";
  const c = CHARS[char];
  const size = parseFloat(slot.style.width) || 48;
  const lively = size >= 48;
  const el = document.createElement("div");
  el.style.cssText = slot.style.cssText;
  for (const a of slot.attributes) if (a.name === "id" || (a.name.startsWith("data-") && a.name !== "data-char")) el.setAttribute(a.name, a.value);
  el.className = ["bot-face", "pokeable", lively && "lively", size < 36 && "sm"].filter(Boolean).join(" ");
  el.dataset.char = char;
  el.dataset.state = "idle";
  el.dataset.eyes = "open";
  el.setAttribute("aria-hidden", "true");
  [
    ["--s", `${size}px`],
    ["--bf-sprite", `url("/assets/bots/${char}.webp")`],
    ["--o-el", pct(c.earL)], ["--o-er", pct(c.earR)], ["--o-top", pct(c.top)],
    ["--tip-x", `${c.tip[0]}%`], ["--tip-y", `${c.tip[1]}%`],
    ["--bf-seed", Math.random().toFixed(3)],
  ].forEach(([k, v]) => el.style.setProperty(k, v));
  const part = (k) => `<i class="bf-part bf-${k}"><i class="bf-pin"><b class="bf-img"></b><b class="bf-glow"></b></i></i>`;
  const lens = c.lens ? c.lens.slice(0, 2).map((l) => `<i class="bf-lens" style="left:${l[0]}%;top:${l[1]}%;--lens:${c.lens[2] * 2}%"></i>`).join("") : "";
  const blush = c.eyes.map((e) => `<i class="bf-blush" style="left:${(e[0] + (e[0] < 50 ? -5.6 : 5.6)).toFixed(2)}%;top:${(e[1] + 6.2).toFixed(2)}%"></i>`).join("");
  el.innerHTML = `${lively ? '<i class="bf-shadow"></i>' : ""}<i class="bf-aura"></i><div class="bf-body"><div class="bf-shot"><div class="bf-look">
    ${part("ear-l")}${part("ear-r")}${part("top")}<i class="bf-part bf-head"><b class="bf-img"></b><b class="bf-glow"></b></i>
    ${lens}${blush}${eyesSvg(c)}</div></div></div>`;
  slot.replaceWith(el);
  return el;
}

export function mountFaces(root = document) {
  return [...root.querySelectorAll(".face[data-char]")].map(renderFace);
}
