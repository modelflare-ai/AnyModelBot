// 机器人精灵图的 AVIF 版（public/bots/<角色>.avif）：同样的 8 格、同样的分辨率，体积约是 WebP 的一半。
// 支持 AVIF 的浏览器用它，其他用 WebP（styles/bots.css 的 image-set）。
//
// 必须从无损的精灵图编码：拿 WebP 再转一次会叠两层压缩损失，要保住现在的画质就几乎省不下体积。
// 所以这里重跑应用的 scripts/build-bot-avatars.py（--out 临时目录 --png），先确认它重新生成的 WebP 和
// public/bots 里的一模一样（原图、拆层参数都没变），再把同一次生成的 PNG 编成 AVIF。
// 质量 q58：和 WebP q86 比，按预乘 RGBA 的 PSNR 算，六个角色的最低值和平均值都不低于 WebP（45.4 / 46.4 对 43.6 / 45.9 dB）。
//
// 用法：npm run bots:avif（需要仓库根目录、python3 + numpy + Pillow；sharp 随 Astro 安装，锁定在 package-lock 里）。
// 精灵图更新后（npm run sync 带来新的 WebP）要重跑一次；check-images 按 src/data/bots-avif.json 记下的 WebP 哈希把关。
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const QUALITY = 58;
const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = path.dirname(site);
const script = path.join(app, "scripts/build-bot-avatars.py");
const pub = path.join(site, "public/bots");
const manifest = path.join(site, "src/data/bots-avif.json");

if (!fs.existsSync(script)) {
  console.error("✗ 没有找到应用的 scripts/build-bot-avatars.py：要在完整的仓库里运行");
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amb-bots-"));
try {
  execFileSync("python3", [script, "--out", tmp, "--png"], { stdio: "inherit" });
  const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(pub).filter((f) => f.endsWith(".webp")).sort()) {
    const key = f.slice(0, -5);
    const fresh = path.join(tmp, f);
    if (!fs.existsSync(fresh) || sha(fresh) !== sha(path.join(pub, f))) {
      console.error(`✗ ${f}：重新生成的精灵图和 public/bots 里的不一样。先在仓库根目录跑 python3 scripts/build-bot-avatars.py，再 npm run sync`);
      process.exit(1);
    }
    const avif = path.join(pub, `${key}.avif`);
    await sharp(path.join(tmp, `${key}.png`)).avif({ quality: QUALITY, effort: 6, chromaSubsampling: "4:4:4" }).toFile(avif);
    out[key] = sha(path.join(pub, f));
    console.log(`${key}.avif ${Math.round(fs.statSync(avif).size / 1024)} KB（WebP ${Math.round(fs.statSync(path.join(pub, f)).size / 1024)} KB）`);
  }
  fs.writeFileSync(manifest, JSON.stringify({ _: "public/bots/*.avif 是从哪一版 WebP 生成的（sha256）；scripts/make-bot-avif.ts 写、check-images.ts 查", ...out }, null, 2) + "\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
