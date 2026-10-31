#!/usr/bin/env python3
"""G5 生图演示里的"成图"：黄色小机器人趴在键盘上打瞌睡，扁平插画风格。

只用仓库里的角色素材（ui/design/bots/yellow.webp，图层顺序和几何同 docs/assets/_src/make-assets.py 与
ui/components/avatar.js），其余是几何形状；不用任何网上的图片。依赖：Python 3 + Pillow。

用法：python3 make-illustration.py <输出.png> [边长，默认 1024]
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
SPRITE = 448
EYES = [(38.34, 63.5), (61.4, 63.48)]  # avatar.js BOT_CHARS.yellow.eyes（方框的百分比）
EYE_R = 3.57
EYE, GLOW = (252, 252, 220), (255, 194, 26)
FONT = os.environ.get("NOTO_SC", "/usr/share/fonts/truetype/noto-cjk/NotoSansSC.ttf")


def sprite_base(key="yellow"):
    s = Image.open(os.path.join(ROOT, "ui", "design", "bots", f"{key}.webp")).convert("RGBA")
    base = Image.new("RGBA", (SPRITE, SPRITE), (0, 0, 0, 0))
    for i in (1, 2, 3, 0):  # 左耳、右耳、头顶配件、头（同 make-assets.py）
        base.alpha_composite(s.crop((i * SPRITE, 0, (i + 1) * SPRITE, SPRITE)))
    return base


def sleepy_bot(n):
    """n×n 的黄色机器人：闭着眼（avatar.js 的 e-closed 曲线）、脸颊微红"""
    im = sprite_base().resize((n, n), Image.LANCZOS)
    u = n / 100
    lines = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(lines)
    blush = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    db = ImageDraw.Draw(blush)
    for ex, ey in EYES:
        r = EYE_R * u
        cx, cy = ex * u, ey * u
        # e-closed：M -1.05R,-0.15R  Q 0,0.8R  1.05R,-0.15R
        pts = []
        for i in range(25):
            t = i / 24
            x = (1 - t) ** 2 * (-1.05 * r) + 2 * (1 - t) * t * 0 + t * t * (1.05 * r)
            y = (1 - t) ** 2 * (-0.15 * r) + 2 * (1 - t) * t * (0.8 * r) + t * t * (-0.15 * r)
            pts.append((cx + x, cy + y))
        d.line(pts, fill=255, width=max(2, round(r * 0.55)), joint="curve")
        bx = cx + (-5.6 * u if ex < 50 else 5.6 * u)
        by = cy + 6.2 * u
        db.ellipse([bx - 2.6 * u, by - 1.4 * u, bx + 2.6 * u, by + 1.4 * u], fill=(255, 120, 140, 120))
    glow = Image.new("RGBA", (n, n), GLOW + (0,))
    glow.putalpha(lines.filter(ImageFilter.GaussianBlur(n * 0.012)))
    eye = Image.new("RGBA", (n, n), EYE + (0,))
    eye.putalpha(lines)
    im.alpha_composite(blush.filter(ImageFilter.GaussianBlur(n * 0.006)))
    im.alpha_composite(glow)
    im.alpha_composite(eye)
    return im


def rrect(d, box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)


def main(out, size=1024):
    S = 2  # 先画两倍大再缩小，边缘更平滑
    W = size * S
    im = Image.new("RGBA", (W, W), (46, 58, 99, 255))  # 夜色的墙
    d = ImageDraw.Draw(im)
    k = W / 1024
    # 月亮和几颗星
    d.ellipse([735 * k, 120 * k, 875 * k, 260 * k], fill=(247, 231, 166))
    d.ellipse([775 * k, 98 * k, 915 * k, 238 * k], fill=(46, 58, 99))
    for x, y, r in [(170, 150, 7), (300, 92, 5), (560, 170, 6), (930, 360, 5), (120, 330, 4), (640, 70, 4)]:
        d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=(247, 231, 166))
    # 桌面
    d.rectangle([0, 700 * k, W, W], fill=(201, 138, 91))
    d.rectangle([0, 700 * k, W, 724 * k], fill=(222, 162, 112))
    # 键盘的影子和键盘
    d.ellipse([170 * k, 838 * k, 870 * k, 900 * k], fill=(168, 111, 71))
    rrect(d, [170 * k, 640 * k, 860 * k, 860 * k], 34 * k, (59, 66, 82))
    keys_y = [668, 714, 760, 806]
    for row, y in enumerate(keys_y):
        n = 12 - (row == 3) * 3
        x0, x1 = 196 + row * 8, 834 - row * 8
        step = (x1 - x0) / n
        for i in range(n):
            if row == 3 and i == 4:
                rrect(d, [(x0 + i * step) * k, y * k, (x0 + (i + 4) * step - 8) * k, (y + 36) * k], 8 * k, (91, 100, 117))
            if row == 3 and 4 <= i < 8:
                continue
            rrect(d, [(x0 + i * step + 4) * k, y * k, (x0 + (i + 1) * step - 4) * k, (y + 36) * k], 8 * k, (91, 100, 117))
    # 杯子
    rrect(d, [880 * k, 616 * k, 968 * k, 724 * k], 18 * k, (240, 240, 232))
    d.ellipse([948 * k, 640 * k, 1000 * k, 700 * k], outline=(240, 240, 232), width=round(14 * k))
    d.rectangle([880 * k, 640 * k, 968 * k, 656 * k], fill=(215, 255, 0))
    # 机器人：歪着头趴在键盘上
    n = round(640 * k)
    bot = sleepy_bot(n).rotate(14, resample=Image.BICUBIC, expand=True)
    bx = round(512 * k - bot.width / 2 - 20 * k)
    by = round(745 * k - bot.height * 0.78)
    shadow = Image.new("RGBA", bot.size, (0, 0, 0, 0))
    shadow.putalpha(bot.getchannel("A").point(lambda a: a * 0.28))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10 * k)), (bx + round(10 * k), by + round(22 * k)))
    im.alpha_composite(bot, (bx, by))
    # 两只小手搭在键盘上
    for cx in (330, 640):
        rrect(d, [(cx - 52) * k, 690 * k, (cx + 52) * k, 742 * k], 26 * k, (255, 206, 64))
        rrect(d, [(cx - 52) * k, 722 * k, (cx + 52) * k, 742 * k], 12 * k, (238, 178, 34))
    # Zzz
    try:
        font = ImageFont.truetype(FONT, 10)
        font.set_variation_by_name("Bold")
    except Exception:
        font = None
    for (x, y, s) in [(740, 430, 54), (800, 350, 72), (870, 250, 96)]:
        f = ImageFont.truetype(FONT, round(s * k)) if font else ImageFont.load_default()
        try:
            f.set_variation_by_name("Bold")
        except Exception:
            pass
        d.text((x * k, y * k), "Z", font=f, fill=(247, 231, 166))
    im = im.resize((size, size), Image.LANCZOS).convert("RGB")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    im.save(out, "PNG", optimize=True)
    return im


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    img = main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 1024)
    # 程序核对（不看图）：尺寸、不是纯色、黄色角色确实画进去了
    px = img.resize((64, 64)).getdata()
    yellow = sum(1 for r, g, b in px if r > 200 and g > 150 and b < 90)
    print(f"{sys.argv[1]}: {img.size[0]}×{img.size[1]}，黄色像素占 {yellow / len(px):.1%}")
