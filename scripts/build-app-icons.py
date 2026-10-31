#!/usr/bin/env python3
"""
从 anymodelbot_design/icon/1024x1024.png（满版正方形原图）生成应用在各平台、各尺寸用到的图标。

  assets/icon.icns            macOS 打包（electron-builder mac.icon）：Apple 网格，1024 画布里 824 的圆角方块 + 轻投影，16–1024 全套
  assets/icon.ico             Windows 打包（win.icon、NSIS 安装包）+ 运行时窗口 / 托盘：16–256，<256 存 32 位 BMP，256 存 PNG
  assets/icons/<N>x<N>.png    Linux 打包（electron-builder linux.icon，AppImage / 桌面菜单）：16–512
  assets/icon.png             运行时窗口图标（Linux；macOS 忽略，Dock 用包里的 icns），256
  assets/tray.png, tray@2x    托盘（macOS 菜单栏 / Linux），18 / 36，Electron 在高分屏自动换 @2x
  ui/assets/favicon-*.png     管理界面的浏览器标签图标，32 / 64
  ui/assets/apple-touch-icon  手机浏览器加到主屏幕，180，满版不透明（iOS 自己切圆角）

只用 Pillow：  python3 scripts/build-app-icons.py
换图标时只替换原图（≥1024 的正方形），重跑脚本，提交生成的文件。
"""
import io
import os
import struct

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "anymodelbot_design", "icon", "1024x1024.png")
ASSETS = os.path.join(ROOT, "assets")
UI_ASSETS = os.path.join(ROOT, "ui", "assets")

LANCZOS = Image.Resampling.LANCZOS
CORNER = 0.225  # 圆角半径 / 方块边长（Apple 824 的方块配 185.4 的圆角）


def rounded_mask(n: int, ss: int = 8) -> Image.Image:
    """n×n 的圆角方块蒙版，放大 ss 倍画再缩回来，边缘抗锯齿。"""
    big = Image.new("L", (n * ss, n * ss), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, n * ss - 1, n * ss - 1), radius=CORNER * n * ss, fill=255)
    return big.resize((n, n), Image.Resampling.BOX)


def render(src: Image.Image, size: int, margin: int, shape: bool = True, shadow: bool = False) -> Image.Image:
    """在 size 画布中央放边长 size-2*margin 的图；shape=False 时保持满版直角（apple-touch-icon）。"""
    n = size - 2 * margin
    art = src.resize((n, n), LANCZOS)
    if n <= 32:  # 小尺寸毛绒纹理会糊成一片，轻微锐化让面罩和眼睛更清楚（只动颜色，不动透明度）
        rgb = art.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1, percent=50, threshold=2))
        art = Image.merge("RGBA", (*rgb.split(), art.getchannel("A")))
    if not shape:
        return art.convert("RGB")
    mask = rounded_mask(n)
    art.putalpha(ImageChops.multiply(art.getchannel("A"), mask))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if shadow:  # Apple 模板的投影：向下 ~1%、模糊 ~1%、30% 黑，原图左上角接近白色，靠它在浅色背景上看出轮廓
        a = Image.new("L", (size, size), 0)
        a.paste(mask, (margin, margin + round(size * 0.01)))
        a = a.filter(ImageFilter.GaussianBlur(size * 0.01)).point(lambda v: v * 30 // 100)
        sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sh.putalpha(a)
        out = Image.alpha_composite(out, sh)
    out.alpha_composite(art, (margin, margin))
    return out


def app_icon(src: Image.Image, size: int) -> Image.Image:
    """Windows / Linux / 浏览器：几乎满版的圆角方块，四周留约 1/32。"""
    return render(src, size, round(size / 32))


def mac_icon(src: Image.Image, size: int) -> Image.Image:
    """macOS：Apple 网格（1024 里四周各留 100），64 及以上带投影。"""
    return render(src, size, size * 100 // 1024, shadow=size >= 64)


def png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def save_png(im: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png_bytes(im))


def write_icns(src: Image.Image, path: str) -> None:
    # 类型 → 像素尺寸；ic11–ic14 是 @2x（16@2x=32 …），和同像素的 1x 共用一张图
    types = [(b"icp4", 16), (b"icp5", 32), (b"ic11", 32), (b"ic12", 64), (b"ic07", 128), (b"ic13", 256),
             (b"ic08", 256), (b"ic14", 512), (b"ic09", 512), (b"ic10", 1024)]
    data = {px: png_bytes(mac_icon(src, px)) for px in sorted({px for _, px in types})}
    entries = [(t, data[px]) for t, px in types]
    toc = b"TOC " + struct.pack(">I", 8 + 8 * len(entries)) + b"".join(t + struct.pack(">I", 8 + len(d)) for t, d in entries)
    body = toc + b"".join(t + struct.pack(">I", 8 + len(d)) + d for t, d in entries)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", 8 + len(body)) + body)


def ico_bmp(im: Image.Image) -> bytes:
    """ICO 里的 32 位 BMP 帧：BITMAPINFOHEADER（高度 ×2）+ 自下而上的 BGRA + 1 位 AND 蒙版（全透明处为 1）。"""
    w, h = im.size
    xor = im.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes("raw", "BGRA")
    row = (w + 31) // 32 * 4
    alpha = im.getchannel("A").transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes()
    mask = bytearray(row * h)
    for y in range(h):
        for x in range(w):
            if alpha[y * w + x] == 0:
                mask[y * row + x // 8] |= 0x80 >> (x % 8)
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + len(mask), 0, 0, 0, 0)
    return header + xor + bytes(mask)


def write_ico(src: Image.Image, path: str) -> None:
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]  # 100%–200% 缩放下任务栏、标题栏、资源管理器各视图用到的尺寸
    frames = [(s, png_bytes(app_icon(src, s)) if s >= 256 else ico_bmp(app_icon(src, s))) for s in sizes]
    offset = 6 + 16 * len(frames)
    head = struct.pack("<HHH", 0, 1, len(frames))
    for s, d in frames:
        head += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), offset)
        offset += len(d)
    with open(path, "wb") as f:
        f.write(head + b"".join(d for _, d in frames))


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    if src.width != src.height or src.width < 1024:
        raise SystemExit(f"原图需要是 ≥1024 的正方形：{SRC} 是 {src.width}×{src.height}")
    if src.width != 1024:
        src = src.resize((1024, 1024), LANCZOS)

    write_icns(src, os.path.join(ASSETS, "icon.icns"))
    write_ico(src, os.path.join(ASSETS, "icon.ico"))
    for s in [16, 24, 32, 48, 64, 128, 256, 512]:
        save_png(app_icon(src, s), os.path.join(ASSETS, "icons", f"{s}x{s}.png"))
    save_png(app_icon(src, 256), os.path.join(ASSETS, "icon.png"))
    # 托盘：菜单栏 18pt 高，图形占 16pt（四周各留 1pt）
    save_png(render(src, 18, 1), os.path.join(ASSETS, "tray.png"))
    save_png(render(src, 36, 2), os.path.join(ASSETS, "tray@2x.png"))
    save_png(app_icon(src, 32), os.path.join(UI_ASSETS, "favicon-32.png"))
    save_png(app_icon(src, 64), os.path.join(UI_ASSETS, "favicon-64.png"))
    save_png(render(src, 180, 0, shape=False), os.path.join(UI_ASSETS, "apple-touch-icon.png"))


if __name__ == "__main__":
    main()
