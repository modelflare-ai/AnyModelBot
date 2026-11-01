#!/usr/bin/env python3
"""
把 anymodelbot_design/logo avator/ 里的 6 张毛绒机器人原图拆成可动的图层，输出 ui/design/bots/<key>.webp。

每个角色一张横向精灵图，8 格，每格 CELL×CELL，坐标系相同（叠在一起就是原图）：
  0 head      头（不含耳朵和头顶配件；面罩上的眼睛已抹掉，眼睛由 avatar.js 用 SVG 画，才能眨眼、换表情）
  1 earL      左耳（向头里多留一截，转动时不露缝；头那一层盖住多出来的部分）
  2 earR      右耳
  3 top       头顶配件（天线球 / 星星 / 嫩芽 / 角 / 宝石 / 天线），同样向头里多留一截
  4–7         上面四层各自的"发光部分"（哒哒的灯带、晶晶的霓虹线），没有就是空的

只用 numpy + Pillow：  python3 scripts/build-bot-avatars.py
官网的 AVIF 版要从无损的精灵图编码（site/scripts/make-bot-avif.ts）：  python3 scripts/build-bot-avatars.py --out <目录> --png
  --out 改输出目录（默认 ui/design/bots），--png 另存一份无损 PNG
几何（源图像素）和 ui/components/avatar.js 里的 BOT_CHARS 是同一套数，改一边要改另一边。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "anymodelbot_design", "logo avator")
OUT = os.path.join(ROOT, "ui", "design", "bots")

# 源图 1536×1024。取以 (767, 511) 为中心、边长 1290 的正方形（刚好装下最宽的哒哒），缩到 CELL。
SIDE, CX, CY = 1290, 767, 511
CELL = 448
QUALITY = 86

CHARS = {
    # eyes: 两眼中心；er: 眼睛半径；patch: 抹眼睛（连同光晕）的实心 / 渐隐半径（× er）
    # visor: 面罩 x0, y0, x1, y1, 圆角（抹眼睛只在面罩里进行，不碰外圈绒毛）
    # ear: cutL/cutR 是头的侧边（耳朵和头的分界），y0–y1 是耳朵的纵向范围
    # top: x0–x1 × (0, cut) 是配件；stem 是配件插进头里的那一段（多留的部分只在这段宽度里）
    # keep: 抹眼睛时要保住的椭圆（闪闪面罩上的腮红）
    # glow: 发光部分 = (通道, 从, 到, 出现在哪些层：h 头 / l 左耳 / r 右耳 / t 配件)
    "blue": dict(src="主-蓝色.png", eyes=[(622.7, 678.6), (906.6, 678.6)], er=44, patch=(1.5, 2.3), visor=(460, 532, 1075, 820, 140),
                 ear=dict(cutL=356, cutR=1179, y0=515, y1=822), top=dict(x0=630, x1=900, cut=276, stem=(718, 815))),
    "yellow": dict(src="黄色小萌.png", eyes=[(622.7, 679.3), (908.5, 679.3)], er=46, patch=(1.6, 2.4), visor=(458, 531, 1076, 821, 140),
                   keep=[(538, 746, 52, 31), (997, 746, 52, 31)],
                   ear=dict(cutL=353, cutR=1183, y0=510, y1=825), top=dict(x0=625, x1=910, cut=270, stem=(715, 820))),
    "green": dict(src="绿草.png", eyes=[(622.6, 679.6), (910.0, 679.7)], er=45, patch=(1.5, 2.3), visor=(458, 532, 1078, 820, 140),
                  ear=dict(cutL=353, cutR=1180, y0=512, y1=838), top=dict(x0=520, x1=1035, cut=270, stem=(722, 812))),
    "red": dict(src="红魔.png", eyes=[(606.1, 632.9), (924.9, 632.8)], er=50, patch=(1.6, 2.4), visor=(432, 478, 1104, 785, 150),
                ear=dict(cutL=374, cutR=1160, y0=380, y1=850), top=dict(x0=645, x1=890, cut=232, stem=(660, 875)),
                glow=("g", 70, 140, "lrt")),
    "purple": dict(src="紫钻.png", eyes=[(623.0, 679.5), (908.0, 679.5)], er=45, patch=(1.5, 2.3), visor=(470, 550, 1068, 812, 130),
                   ear=dict(cutL=356, cutR=1179, y0=520, y1=835), top=dict(x0=640, x1=890, cut=290, stem=(700, 830)),
                   glow=("g", 80, 170, "hlrt")),
    "orange": dict(src="橙色探险者.png", eyes=[(615.0, 663.0), (920.0, 663.0)], er=46, patch=(1.6, 2.4), visor=(447, 517, 1090, 805, 90),
                   ear=dict(cutL=324, cutR=1210, y0=488, y1=830), top=dict(x0=655, x1=880, cut=220, stem=(695, 842))),
}


def ramp(v, a, b):
    """a→b 之间从 0 平滑到 1（a > b 时反过来）"""
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def refine_eyes(rgb, eyes, er):
    """在给定位置附近找亮斑的质心，修正手量的眼睛中心"""
    v = rgb.max(axis=2).astype(np.float32)
    out = []
    for ex, ey in eyes:
        x0, y0 = int(ex - er * 1.6), int(ey - er * 1.6)
        win = v[y0 : y0 + int(er * 3.2), x0 : x0 + int(er * 3.2)]
        m = win > 225
        ys, xs = np.nonzero(m)
        if len(xs) < 50:
            out.append((ex, ey))
            continue
        out.append((x0 + xs.mean(), y0 + ys.mean()))
    return out


def rounded_rect(xx, yy, x0, y0, x1, y1, rr, inset):
    """圆角矩形内为 1（向内收 inset，边缘 6px 渐变）"""
    x0, y0, x1, y1, rr = x0 + inset, y0 + inset, x1 - inset, y1 - inset, max(rr - inset, 1)
    qx = np.maximum(np.maximum(x0 + rr - xx, xx - (x1 - rr)), 0)
    qy = np.maximum(np.maximum(y0 + rr - yy, yy - (y1 - rr)), 0)
    d = np.hypot(qx, qy) - rr
    inside_box = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    return np.where(inside_box, ramp(d, 0, -6), 0.0)


def paint_out_eyes(rgb, c):
    """用两眼正中间一条干净的面罩绒毛（镜像平铺）盖住眼睛和它在面罩上的光晕"""
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    (ax, ay), (bx, by) = c["eyes"]
    mx, my = int(round((ax + bx) / 2)), int(round((ay + by) / 2))
    r = c["er"]
    hw = max(int((bx - ax) / 2 - r * 2.3), 16)
    tile = rgb[my - 90 : my + 90, mx - hw : mx + hw].astype(np.float32)
    tile = np.concatenate([tile, tile[:, ::-1]], axis=1)
    tile = np.concatenate([tile, tile[::-1]], axis=0)
    th, tw = tile.shape[:2]
    ty = ((np.arange(h) - (my - 90)) % th)[:, None]
    tx = ((np.arange(w) - (mx - hw)) % tw)[None, :]
    tex = tile[ty, tx]
    x0, y0, x1, y1, rr = c["visor"]
    m = np.zeros((h, w), np.float32)
    for ex, ey in c["eyes"]:
        m = np.maximum(m, 1 - ramp(np.hypot(xx - ex, yy - ey), r * c["patch"][0], r * c["patch"][1]))
    m *= rounded_rect(xx, yy, x0, y0, x1, y1, rr, 10)
    for kx, ky, krx, kry in c.get("keep", []):
        m *= ramp(((xx - kx) / krx) ** 2 + ((yy - ky) / kry) ** 2, 1.0, 1.6)
    return rgb.astype(np.float32) * (1 - m[..., None]) + tex * m[..., None]


def build(key, c):
    im = Image.open(os.path.join(SRC, c["src"])).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3] / 255.0
    c = dict(c, eyes=refine_eyes(rgb, c["eyes"], c["er"]))
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    f = 3.0  # 切口羽化（源图像素）
    ext = 42.0  # 向头里多留的长度

    e, t = c["ear"], c["top"]
    in_ear_y = ramp(yy, e["y0"] - 8, e["y0"] + 8) * (1 - ramp(yy, e["y1"] - 8, e["y1"] + 8))
    ear_l = ramp(xx, e["cutL"] + f, e["cutL"] - f)  # x < cutL → 1
    ear_r = ramp(xx, e["cutR"] - f, e["cutR"] + f)
    in_top_x = ramp(xx, t["x0"] - f, t["x0"] + f) * (1 - ramp(xx, t["x1"] - f, t["x1"] + f))
    top = in_top_x * ramp(yy, t["cut"] + f, t["cut"] - f)

    head_m = alpha * (1 - ear_l) * (1 - ear_r) * (1 - top)
    earL_m = alpha * ramp(xx, e["cutL"] + ext, e["cutL"] + ext - 10) * in_ear_y
    earR_m = alpha * ramp(xx, e["cutR"] - ext, e["cutR"] - ext + 10) * in_ear_y
    stem_x = ramp(xx, t["stem"][0] - 6, t["stem"][0] + 6) * (1 - ramp(xx, t["stem"][1] - 6, t["stem"][1] + 6))
    top_m = alpha * np.maximum(top, stem_x * ramp(yy, t["cut"] + ext, t["cut"] + ext - 10))

    head_rgb = paint_out_eyes(rgb, c)

    # 发光部分：按通道取色，并避开绒毛外缘（外缘被背光照亮，颜色和灯带相近）
    g = np.zeros_like(alpha)
    parts = ""
    if "glow" in c:
        ch, lo, hi, parts = c["glow"]
        inner = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(25))) / 255.0
        g = ramp(rgb[..., "rgb".index(ch)], lo, hi) * inner
    zone_l, zone_r, zone_t = ear_l * in_ear_y, ear_r * in_ear_y, top
    zone_h = np.clip(1 - zone_l - zone_r - zone_t, 0, 1)
    eye_d = np.min([np.hypot(xx - ex, yy - ey) for ex, ey in c["eyes"]], axis=0)
    on = lambda p: 1.0 if p in parts else 0.0
    g_head = g * zone_h * ramp(eye_d, c["er"] * c["patch"][1], c["er"] * c["patch"][1] + 6) * on("h")

    layers = [
        (head_rgb, head_m),
        (rgb, earL_m),
        (rgb, earR_m),
        (rgb, top_m),
        (rgb, g_head),
        (rgb, g * zone_l * on("l")),
        (rgb, g * zone_r * on("r")),
        (rgb, g * zone_t * on("t")),
    ]
    x0, y0 = CX - SIDE // 2, CY - SIDE // 2
    sheet = Image.new("RGBA", (CELL * len(layers), CELL), (0, 0, 0, 0))
    for i, (col, m) in enumerate(layers):
        layer = np.dstack([np.clip(col, 0, 255), np.clip(m * 255, 0, 255)]).astype(np.uint8)
        canvas = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
        canvas.paste(Image.fromarray(layer, "RGBA"), (-x0, -y0))
        # 预乘后再缩放：透明处原图的黑底不会渗进绒毛边缘
        pre = np.asarray(canvas).astype(np.float32)
        pre[..., :3] *= pre[..., 3:4] / 255.0
        small = np.asarray(Image.fromarray(pre.astype(np.uint8), "RGBA").resize((CELL, CELL), Image.LANCZOS)).astype(np.float32)
        a8 = small[..., 3:4]
        small[..., :3] = np.where(a8 > 0, small[..., :3] * 255.0 / np.maximum(a8, 1), 0)
        sheet.paste(Image.fromarray(np.clip(small, 0, 255).astype(np.uint8), "RGBA"), (i * CELL, 0))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, key + ".webp")
    sheet.save(path, "WEBP", quality=QUALITY, alpha_quality=90, method=6)
    if PNG:
        sheet.save(os.path.join(OUT, key + ".png"))

    k = CELL / SIDE
    to = lambda x, y: (round((x - x0) * k / CELL * 100, 2), round((y - y0) * k / CELL * 100, 2))
    eyes = [tuple(float(v) for v in to(*p)) for p in c["eyes"]]
    print(f"{key}: {os.path.getsize(path) // 1024}KB eyes={eyes} r={round(c['er'] * k / CELL * 100, 2)}% "
          f"earL={to(e['cutL'], (e['y0'] + e['y1']) / 2)} earR={to(e['cutR'], (e['y0'] + e['y1']) / 2)} "
          f"top={to((t['stem'][0] + t['stem'][1]) / 2, t['cut'])}")


PNG = False

if __name__ == "__main__":
    args = sys.argv[1:]
    if "--out" in args:
        i = args.index("--out")
        OUT = os.path.abspath(args[i + 1])
        del args[i:i + 2]
    if "--png" in args:
        PNG = True
        args.remove("--png")
    for key in args or CHARS:
        build(key, CHARS[key])
