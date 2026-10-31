import sharp from "sharp";
import fs from "node:fs";
const [dir, ...qs] = process.argv.slice(2);
const names = ["blue","green","orange","purple","red","yellow"];
async function err(png, enc) {
  // 预乘后的 RGBA 均方误差 → PSNR（透明处颜色不算）
  const a = await sharp(png).raw().toBuffer(); const b = await sharp(enc).ensureAlpha().raw().toBuffer();
  let se = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i+3]/255, ba = b[i+3]/255;
    for (let c = 0; c < 3; c++) { const d = a[i+c]*aa - b[i+c]*ba; se += d*d; }
    const da = a[i+3]-b[i+3]; se += da*da; n += 4;
  }
  return 10*Math.log10(255*255/(se/n));
}
let line = `webp q86: `; let tot = 0, ps = [];
for (const k of names) { const f = `${dir}/${k}.webp`; tot += fs.statSync(f).size; ps.push(await err(`${dir}/${k}.png`, f)); }
console.log(line + Math.round(tot/1024) + "KB  psnr min/avg " + Math.min(...ps).toFixed(2) + "/" + (ps.reduce((a,b)=>a+b)/ps.length).toFixed(2));
for (const [q, eff] of qs.map((s) => s.split(":").map(Number))) {
  tot = 0; ps = [];
  for (const k of names) {
    const buf = await sharp(`${dir}/${k}.png`).avif({ quality: q, effort: eff, chromaSubsampling: "4:4:4" }).toBuffer();
    fs.writeFileSync(`${dir}/${k}.q${q}.avif`, buf); tot += buf.length;
    ps.push(await err(`${dir}/${k}.png`, `${dir}/${k}.q${q}.avif`));
  }
  console.log(`avif q${q} e${eff}: ` + Math.round(tot/1024) + "KB  psnr min/avg " + Math.min(...ps).toFixed(2) + "/" + (ps.reduce((a,b)=>a+b)/ps.length).toFixed(2));
}
