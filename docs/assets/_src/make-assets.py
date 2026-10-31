#!/usr/bin/env python3
"""生成 README 用的品牌、图表和角色素材（需要实机录制的截图与 GIF 不在这里）。

产物（路径相对仓库根目录）：
  docs/assets/brand/logo-eyes.svg            静态 Eyes 标志（居中）
  docs/assets/brand/logo-eyes.webp           Eyes 动图：240×240、透明底、20 fps、6 s、无限循环
  docs/assets/brand/wordmark-{light,dark}.svg  「AnyModelBot」字标，文字已转曲线
  docs/assets/brand/social-preview.png       GitHub 分享预览图 1280×640
  docs/assets/diagrams/data-flow-{light,dark}.svg      数据流向图，文字已转曲线
  docs/assets/diagrams/architecture-{light,dark}.svg   架构图，文字已转曲线
  docs/assets/screenshots/bots-{light,dark}.webp       六个角色横排 1600×480
  docs/assets/features/characters-eyes.gif             六个角色的眼睛跟着指针转 960×300、15 fps
  docs/assets/modelflare/modelflare-logo.png           只在加 --fetch-modelflare-logo 时下载（原样保存，不重新编码）

依赖：
  - Python 3.10+，Pillow ≥ 10（需要动画 WebP 支持：python3 -c "from PIL import features; print(features.check('webp_anim'))"）
  - fontTools、uharfbuzz：pip install --target <目录> fontTools uharfbuzz，运行时 PYTHONPATH=<目录>
  - 字体：Geist（cd site && npm install 后在 site/node_modules/geist 里）；
    Noto Sans SC 可变字体，默认 /usr/share/fonts/truetype/noto-cjk/NotoSansSC.ttf，可用环境变量 NOTO_SC 指定
  - 角色精灵图与几何：ui/design/bots/*.webp、ui/components/avatar.js（BOT_CHARS），换图后要同步更新下面的 CHARS

用法（在仓库根目录）：
  PYTHONPATH=<目录> python3 docs/assets/_src/make-assets.py               # 生成全部
  PYTHONPATH=<目录> python3 docs/assets/_src/make-assets.py brand bots    # 只生成某几组：brand diagrams bots eyes-gif
  PYTHONPATH=<目录> python3 docs/assets/_src/make-assets.py --fetch-modelflare-logo   # 另外重新下载 Modelflare 官方 Logo
结束时打印每个文件的尺寸、帧数、时长、体积，以及是否在需求稿 §6.1 的体积上限内。
"""
import io
import math
import os
import sys
import urllib.request

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

import uharfbuzz as hb
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "docs", "assets")
GEIST_DIR = os.path.join(ROOT, "site", "node_modules", "geist", "dist", "fonts", "geist-sans")
GEIST_SEMI = os.path.join(GEIST_DIR, "Geist-SemiBold.ttf")
GEIST_REG = os.path.join(GEIST_DIR, "Geist-Regular.ttf")
NOTO_SC = os.environ.get("NOTO_SC", "/usr/share/fonts/truetype/noto-cjk/NotoSansSC.ttf")
MODELFLARE_LOGO_URL = "https://modelflare.dev/logo.png"

LIME, INK, PAGE_DARK, PAGE_LIGHT, TEXT_DARK = "#d7ff00", "#161a00", "#060706", "#fafaf7", "#fafaf7"
ACCENT_LIGHT = "#5f711c"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def out(*parts):
    p = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# ---------------------------------------------------------------------------
# Eyes 标志（§7.2）：viewBox 100，面罩 94×82 圆角 36，眼睛 13×28 竖胶囊
# ---------------------------------------------------------------------------
EYES_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="AnyModelBot">'
            '<rect x="3" y="9" width="94" height="82" rx="36" fill="#d7ff00"/>'
            '<rect x="29" y="36" width="13" height="28" rx="6.5" fill="#161a00"/>'
            '<rect x="58" y="36" width="13" height="28" rx="6.5" fill="#161a00"/></svg>\n')


def draw_mark(size, dx=0.0, sy=1.0, plate=LIME, eye=INK, ss=4):
    """Eyes 标志位图。dx：眼睛水平偏移（viewBox 单位）；sy：眼睛纵向缩放（眨眼），以眼睛中心为原点。"""
    s = size * ss
    u = s / 100
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([3 * u, 9 * u, 97 * u, 91 * u], radius=36 * u, fill=plate)
    h = 28 * sy
    for x in (29, 58):
        x0, y0 = (x + dx) * u, (50 - h / 2) * u
        w_, h_ = 13 * u, h * u
        d.rounded_rectangle([x0, y0, x0 + w_, y0 + h_], radius=min(w_, h_) / 2, fill=eye)
    return im.resize((size, size), Image.LANCZOS)


def ease(t):
    """cubic in-out"""
    return 4 * t * t * t if t < .5 else 1 - (-2 * t + 2) ** 3 / 2


def eyes_offset(t):
    """§6.3 关键帧：0–1.2 居中；1.2–1.5 左移 5；保持到 2.1；2.1–2.4 移到右 +5；保持到 3.0；3.0–3.3 回中"""
    keys = [(0, 0), (1.2, 0), (1.5, -5), (2.1, -5), (2.4, 5), (3.0, 5), (3.3, 0), (6.0, 0)]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0)) if t1 > t0 else v1
    return 0.0


def eyes_blink(t):
    """4.2 s 眨眼一次：120 ms 内缩到 10% 再张开"""
    t0, dur = 4.2, 0.12
    if t0 <= t <= t0 + dur:
        p = (t - t0) / dur
        k = 1 - abs(2 * p - 1)  # 0 → 1 → 0
        return 1 - 0.9 * ease(k)
    return 1.0


def make_logo_webp(path):
    fps, secs, size = 20, 6.0, 240
    frames, durs = [], []
    for i in range(int(fps * secs)):
        t = i / fps
        im = draw_mark(size, dx=eyes_offset(t), sy=eyes_blink(t))
        if frames and im.tobytes() == frames[-1].tobytes():
            durs[-1] += 1000 // fps  # 静止的帧合并成一帧，延长时长
            continue
        frames.append(im)
        durs.append(1000 // fps)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0,
                   lossless=True, quality=100, method=6, minimize_size=True, allow_mixed=False, background=(0, 0, 0, 0))


# ---------------------------------------------------------------------------
# 文字：harfbuzz 排版（含字偶距），fontTools 取字形轮廓，输出相对坐标的紧凑 path
# ---------------------------------------------------------------------------
class Face:
    _cache = {}

    def __init__(self, path, wght=None):
        self.path, self.wght = path, wght
        self.tt = TTFont(path, lazy=True)
        self.upem = self.tt["head"].unitsPerEm
        self.cmap = self.tt.getBestCmap()
        self.loc = {"wght": wght} if wght and "fvar" in self.tt else None
        self.gs = self.tt.getGlyphSet(location=self.loc) if self.loc else self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.hbf = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
        if self.loc:
            self.hbf.set_variations(self.loc)
        self.key = os.path.basename(path) + (f"@{wght}" if wght else "")

    @classmethod
    def get(cls, path, wght=None):
        k = (path, wght)
        if k not in cls._cache:
            cls._cache[k] = Face(path, wght)
        return cls._cache[k]

    def has(self, ch):
        return ord(ch) in self.cmap

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hbf, buf, {"kern": True, "liga": True})
        return [(i.codepoint, p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def fmt_nums(nums):
    s = ""
    for n in nums:
        t = str(n)
        if s and not t.startswith("-"):
            s += " "
        s += t
    return s


class RelPathPen(BasePen):
    """把字形画成紧凑的相对坐标 path（y 轴翻转，单位 = 字体单位 / q，四舍五入为整数）。"""

    def __init__(self, glyphSet, q=1.0, ox=0.0, oy=0.0, scale=1.0, decimals=0):
        super().__init__(glyphSet)
        self.q, self.ox, self.oy, self.scale, self.dec = q, ox, oy, scale, decimals
        self.out = []
        self.cur = (0, 0)
        self.start = (0, 0)
        self.last = ""

    def _p(self, pt):
        x = (pt[0] * self.scale + self.ox) / self.q
        y = (-pt[1] * self.scale + self.oy) / self.q
        if self.dec:
            m = 10 ** self.dec
            return (round(x * m), round(y * m))
        return (round(x), round(y))

    def _num(self, v):
        if not self.dec:
            return v
        m = 10 ** self.dec
        r = v / m
        return int(r) if r == int(r) else round(r, self.dec)

    def _emit(self, cmd, pts):
        nums = []
        for (x, y) in pts:
            nums += [self._num(x - self.cur[0]), self._num(y - self.cur[1])]
        body = fmt_nums(nums)
        if cmd == self.last and cmd in "lqc":
            sep = "" if body.startswith("-") else " "
            self.out.append(sep + body)
        else:
            self.out.append(cmd + body)
        self.last = cmd
        self.cur = pts[-1]

    def _moveTo(self, pt):
        p = self._p(pt)
        self._emit("m", [p])
        self.start = p

    def _lineTo(self, pt):
        p = self._p(pt)
        if p == self.cur:
            return
        self._emit("l", [p])

    def _qCurveToOne(self, p1, p2):
        self._emit("q", [self._p(p1), self._p(p2)])

    def _curveToOne(self, p1, p2, p3):
        self._emit("c", [self._p(p1), self._p(p2), self._p(p3)])

    def _closePath(self):
        self.out.append("z")
        self.last = "z"
        self.cur = self.start

    _endPath = _closePath

    def d(self):
        return "".join(self.out)


def is_cjk(ch):
    o = ord(ch)
    return o >= 0x2E80 and not (0xFE00 <= o <= 0xFE0F)


def runs(text, latin, cjk):
    """按字体切分：中文与全角标点用 Noto Sans SC，其余用 Geist（Geist 没有的字回退到 Noto）。"""
    out_ = []
    for ch in text:
        f = cjk if (is_cjk(ch) or not latin.has(ch)) else latin
        if out_ and out_[-1][0] is f:
            out_[-1][1] += ch
        else:
            out_.append([f, ch])
    return out_


def layout(text, latin, cjk, letter_spacing_em=0.0):
    """返回 [(face, gid, x_font_units, y_font_units)], 总宽（字体单位，按 1000 upem）"""
    glyphs, x = [], 0.0
    for face, chunk in runs(text, latin, cjk):
        k = 1000 / face.upem
        for gid, adv, xo, yo in face.shape(chunk):
            glyphs.append((face, gid, x + xo * k, yo * k))
            x += adv * k + letter_spacing_em * 1000
    if glyphs:
        x -= letter_spacing_em * 1000
    return glyphs, x


# ---------------------------------------------------------------------------
# 字标（§6.4 B2）：Geist SemiBold，字距 −0.02em，单个 path，viewBox 520×96
# ---------------------------------------------------------------------------
def wordmark_path(text="AnyModelBot", width=520.0, height=96.0):
    face = Face.get(GEIST_SEMI)
    glyphs, _ = layout(text, face, face, -0.02)
    # 先量墨迹范围（字体单位）
    from fontTools.pens.boundsPen import BoundsPen
    xmin = ymin = 1e9
    xmax = ymax = -1e9
    for f, gid, gx, gy in glyphs:
        bp = BoundsPen(f.gs)
        f.gs[f.order[gid]].draw(bp)
        if bp.bounds:
            a, b, c, d = bp.bounds
            xmin, xmax = min(xmin, gx + a), max(xmax, gx + c)
            ymin, ymax = min(ymin, gy + b), max(ymax, gy + d)
    scale = width / (xmax - xmin)
    ink_h = (ymax - ymin) * scale
    # y 翻转后：顶 = -ymax*scale；让墨迹在 height 里垂直居中
    oy = (height - ink_h) / 2 + ymax * scale
    # 同一支笔画完所有字形：相对坐标要接着上一个字形的当前点算
    pen = RelPathPen(face.gs, q=1.0, scale=scale, decimals=1)
    for f, gid, gx, gy in glyphs:
        pen.ox, pen.oy = (gx - xmin) * scale, oy - gy * scale
        f.gs[f.order[gid]].draw(pen)
    return pen.d(), ink_h


def make_wordmarks():
    d, _ = wordmark_path()
    for name, color in (("wordmark-light.svg", INK), ("wordmark-dark.svg", TEXT_DARK)):
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 96" role="img" aria-label="AnyModelBot">'
               f'<title>AnyModelBot</title><path fill="{color}" d="{d}"/></svg>\n')
        with open(out("brand", name), "w") as fh:
            fh.write(svg)


# ---------------------------------------------------------------------------
# 分享预览图（§6.4 B3）
# ---------------------------------------------------------------------------
def draw_text_shaped(img, xy, text, path, px, fill, letter_spacing_em=0.0):
    """按 harfbuzz 的字距逐字画（Latin），返回 (墨迹 bbox)。xy = 基线左端。"""
    face = Face.get(path)
    font = ImageFont.truetype(path, px)
    glyphs, _ = layout(text, face, face, letter_spacing_em)
    d = ImageDraw.Draw(img)
    k = px / 1000
    for (f, gid, gx, gy), ch in zip(glyphs, text):
        d.text((xy[0] + gx * k, xy[1] - gy * k), ch, font=font, fill=fill, anchor="ls")


def ink_metrics(text, path, px, letter_spacing_em=0.0):
    tmp = Image.new("L", (int(px * len(text) * 1.2) + 40, int(px * 2.5)), 0)
    draw_text_shaped(tmp, (20, int(px * 1.6)), text, path, px, 255, letter_spacing_em)
    x0, y0, x1, y1 = tmp.getbbox()
    base = int(px * 1.6)
    return x1 - x0, y0 - base, y1 - base, x0 - 20  # 宽、墨迹顶（相对基线）、墨迹底、左侧空白


def make_social_preview(path):
    W, H, ss = 1280, 640, 2
    im = Image.new("RGBA", (W * ss, H * ss), rgb(PAGE_DARK) + (255,))
    # Eyes 面罩：面罩高 220 → 方框 220 / 0.82
    plate_h = 220
    box = round(plate_h / 0.82)
    mark = draw_mark(box * ss)
    # 字标：墨迹高约 72
    word = "AnyModelBot"
    px = 72
    for _ in range(4):
        _w, top, bot, _l = ink_metrics(word, GEIST_SEMI, round(px * ss), -0.02)
        px = px * (72 * ss) / (bot - top)
    px = round(px * ss)  # 之后都按 ss 倍的画布算
    w_word, top_w, bot_w, lpad_w = ink_metrics(word, GEIST_SEMI, px, -0.02)
    tag = "Your own AI bot, on your own computer."
    tpx = 28 * ss
    w_tag, top_t, bot_t, lpad_t = ink_metrics(tag, GEIST_REG, tpx)
    gap = 56 * ss
    plate_w = box * ss * 0.94
    text_w = max(w_word, w_tag)
    total = plate_w + gap + text_w
    x0 = (W * ss - total) / 2
    # 面罩
    mx = round(x0 - box * ss * 0.03)
    my = round(H * ss / 2 - box * ss * 0.5)
    im.alpha_composite(mark, (mx, my))
    # 文字块：字标 + 24 + 标语，整体垂直居中
    line_gap = 26 * ss
    block_h = (bot_w - top_w) + line_gap + (bot_t - top_t)
    ty = H * ss / 2 - block_h / 2
    tx = x0 + plate_w + gap
    draw_text_shaped(im, (tx - lpad_w, ty - top_w), word, GEIST_SEMI, px, rgb(TEXT_DARK) + (255,), -0.02)
    ty2 = ty + (bot_w - top_w) + line_gap
    draw_text_shaped(im, (tx - lpad_t, ty2 - top_t), tag, GEIST_REG, tpx, rgb(LIME) + (255,))
    im = im.resize((W, H), Image.LANCZOS).convert("RGB")
    im.save(path, optimize=True)
    return {"margin_left": x0 / ss, "margin_right": (W * ss - x0 - total) / ss, "plate_top": (H * ss / 2 - box * ss * 0.5 + box * ss * 0.09) / ss,
            "wordmark_ink_h": (bot_w - top_w) / ss}


# ---------------------------------------------------------------------------
# 图表（§6.4 D1、D2）：文字全部转曲线，同一字形只定义一次，用 <use> 引用
# ---------------------------------------------------------------------------
THEMES = {
    "light": {"text": INK, "accent": ACCENT_LIGHT, "line_op": ".30", "fill_op": ".045", "acc_fill_op": ".12", "muted": ".66", "arrow_op": ".72"},
    "dark": {"text": TEXT_DARK, "accent": LIME, "line_op": ".30", "fill_op": ".06", "acc_fill_op": ".12", "muted": ".70", "arrow_op": ".75"},
}
SIZE = {"title": (16, 13), "label": (14, 12)}
Q = 2  # 字形 path 的量化单位（字体单位）；1000 upem 下 14 px 字号时约 0.03 px，看不出


class Diagram:
    def __init__(self, w, h, theme):
        self.w, self.h, self.t = w, h, THEMES[theme]
        self.defs = {}
        self.defs_out = []
        self.body = []
        self.latin_r = Face.get(GEIST_REG)
        self.latin_b = Face.get(GEIST_SEMI)
        self.cjk_r = Face.get(NOTO_SC, 400)
        self.cjk_b = Face.get(NOTO_SC, 600)
        self.warnings = []

    def gref(self, face, gid):
        k = (face.key, gid)
        if k not in self.defs:
            pen = RelPathPen(face.gs, q=Q)
            face.gs[face.order[gid]].draw(pen)
            d = pen.d()
            if not d:
                self.defs[k] = None
            else:
                gid_s = self._id(len([v for v in self.defs.values() if v]))
                self.defs[k] = gid_s
                self.defs_out.append(f'<path id="{gid_s}" d="{d}"/>')
        return self.defs[k]

    @staticmethod
    def _id(n):
        a = "abcdefghijklmnopqrstuvwxyz"
        s = ""
        n += 1
        while n:
            n, r = divmod(n - 1, 26)
            s = a[r] + s
        return s

    def text_width(self, text, px, bold=False):
        _, w = layout(text, self.latin_b if bold else self.latin_r, self.cjk_b if bold else self.cjk_r)
        return w * px / 1000

    def text(self, x, y, text, px, bold=False, anchor="middle", color=None, opacity=None, max_w=None):
        latin = self.latin_b if bold else self.latin_r
        cjk = self.cjk_b if bold else self.cjk_r
        glyphs, w = layout(text, latin, cjk)
        wpx = w * px / 1000
        if max_w and wpx > max_w:
            self.warnings.append(f"文字超宽 {wpx:.0f}>{max_w:.0f}: {text}")
        x0 = x - wpx / 2 if anchor == "middle" else (x - wpx if anchor == "end" else x)
        s = px / 1000 * Q
        uses = []
        for f, gid, gx, gy in glyphs:
            ref = self.gref(f, gid)
            if not ref:
                continue
            ux = round(gx / Q)
            uy = round(-gy / Q)
            uses.append(f'<use href="#{ref}"' + (f' x="{ux}"' if ux else "") + (f' y="{uy}"' if uy else "") + "/>")
        attrs = f' fill="{color or self.t["text"]}"' + (f' fill-opacity="{opacity}"' if opacity else "")
        self.body.append(f'<g transform="translate({x0:.1f} {y:.1f}) scale({s:.4f})"{attrs}>' + "".join(uses) + "</g>")
        return wpx

    def bilabel(self, cx, cy, zh, en, kind="label", color=None, max_w=None, anchor="middle"):
        a, b = SIZE[kind]
        bold = kind == "title"
        if zh and en:
            gap = 5
            hgt = a + gap + b
            top = cy - hgt / 2
            self.text(cx, top + a * 0.84, zh, a, bold=bold, color=color, max_w=max_w, anchor=anchor)
            self.text(cx, top + a + gap + b * 0.84, en, b, bold=False, color=color, opacity=self.t["muted"], max_w=max_w, anchor=anchor)
        else:
            s = zh or en
            px = a if zh else (a + 2 if bold else a)
            self.text(cx, cy + px * 0.36, s, px, bold=bold, color=color, max_w=max_w, anchor=anchor)

    def rect(self, x, y, w, h, rx=14, accent=False, fill=True, stroke_w=1.25, dash=None):
        t = self.t
        stroke = t["accent"] if accent else t["text"]
        sop = "1" if accent else t["line_op"]
        if fill:
            fill_c = t["accent"] if accent else t["text"]
            fop = t["acc_fill_op"] if accent else t["fill_op"]
            fill_attr = f' fill="{fill_c}" fill-opacity="{fop}"'
        else:
            fill_attr = ' fill="none"'
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        self.body.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"{fill_attr} stroke="{stroke}" stroke-opacity="{sop}" stroke-width="{stroke_w}"{dash_attr}/>')

    def path(self, d, start=False, end=True, dashed=False, accent=False):
        t = self.t
        color = t["accent"] if accent else t["text"]
        attrs = f' fill="none" stroke="{color}" stroke-opacity="{"1" if accent else t["arrow_op"]}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'
        if dashed:
            attrs += ' stroke-dasharray="5 5"'
        if end:
            attrs += f' marker-end="url(#{"ha" if accent else "h"})"'
        if start:
            attrs += f' marker-start="url(#{"ha" if accent else "h"})"'
        self.body.append(f'<path d="{d}"{attrs}/>')

    def svg(self, title, desc):
        t = self.t
        markers = (
            f'<marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">'
            f'<path d="M1 1.5 9 5 1 8.5z" fill="{t["text"]}" fill-opacity="{t["arrow_op"]}"/></marker>'
            f'<marker id="ha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">'
            f'<path d="M1 1.5 9 5 1 8.5z" fill="{t["accent"]}"/></marker>'
        )
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" role="img" aria-labelledby="t d">'
                f'<title id="t">{title}</title><desc id="d">{desc}</desc>'
                f'<defs>{markers}{"".join(self.defs_out)}</defs>'
                + "".join(self.body) + "</svg>\n")


def diagram_data_flow(theme):
    g = Diagram(1200, 520, theme)
    # 左：你的设备
    g.rect(24, 24, 380, 288, rx=22, accent=True, fill=False, stroke_w=1.75)
    g.bilabel(214, 56, "你的设备", "Your device", kind="title")
    g.rect(44, 88, 340, 56, rx=12, accent=True)
    g.bilabel(214, 116, "AnyModelBot 应用", "AnyModelBot app", max_w=320)
    blocks = [
        (44, 160, "对话 · SQLite", "Conversations · SQLite"),
        (222, 160, "记忆 · Markdown", "Memory · Markdown"),
        (44, 236, "工作区文件", "Workspace files"),
        (222, 236, "API Key 与登录令牌", "API key & sign-in tokens"),
    ]
    for x, y, zh, en in blocks:
        g.rect(x, y, 162, 60, rx=12)
        g.bilabel(x + 81, y + 30, zh, en, max_w=150)
    # 中：Modelflare
    g.rect(592, 61, 216, 110, rx=18)
    g.bilabel(700, 98, "", "Modelflare", kind="title")
    g.bilabel(700, 136, "保留请求日志", "keeps request logs", max_w=196)
    # 右：模型供应商
    g.rect(944, 61, 232, 110, rx=18)
    g.bilabel(1060, 116, "你选定的模型供应商", "Model provider you chose", kind="title", max_w=212)
    # 实线箭头：模型请求
    g.path("M404 116H589")
    g.bilabel(498, 88, "模型请求", "Model requests", max_w=180)
    g.bilabel(498, 146, "提示词、文件内容、截图", "prompts, files, screenshots", max_w=184)
    g.path("M808 116H941")
    g.bilabel(876, 88, "转发", "forwarded", max_w=130)
    # 虚线双向：渠道消息
    g.path("M214 315V440H589", start=True, end=True, dashed=True)
    g.bilabel(403, 418, "渠道消息", "Channel messages", max_w=200)
    g.rect(592, 412, 216, 56, rx=14)
    g.bilabel(700, 440, "微信 / 飞书 平台", "WeChat / Feishu platforms", max_w=200)
    title = "数据流向 / Data flow"
    desc = ("对话、记忆、文件和密钥留在你的设备上；模型请求经 Modelflare 转发给模型供应商；微信和飞书的消息会经过这两个平台。"
            " Conversations, memory, files and keys stay on your device; model requests go through Modelflare to the model provider;"
            " WeChat and Feishu messages pass through those platforms.")
    return g.svg(title, desc), g.warnings


def diagram_architecture(theme):
    g = Diagram(1200, 520, theme)
    # 第一层：入口
    entries = [(60, "Electron 桌面版", "Electron desktop app"), (348, "命令行 npm start", "Command line · npm start"), (636, "Docker 容器", "Docker container")]
    for x, zh, en in entries:
        g.rect(x, 24, 240, 56, rx=14)
        g.bilabel(x + 120, 52, zh, en, max_w=220)
        g.path(f"M{x + 120} 80V109")
    # 第二层：后端
    g.rect(24, 112, 888, 148, rx=22, accent=True, fill=False, stroke_w=1.75)
    g.bilabel(468, 142, "Node.js + TypeScript 后端", "Node.js + TypeScript backend", kind="title")
    inner = [(48, "Preact 界面", "Preact UI"), (262, "SQLite 数据库", "SQLite database"),
             (476, "渠道适配：飞书 / 微信", "Channels: Feishu / WeChat"), (690, "DSH 智能体运行时", "DSH agent runtime")]
    for x, zh, en in inner:
        g.rect(x, 176, 198, 60, rx=12, accent=zh.startswith("DSH"))
        g.bilabel(x + 99, 206, zh, en, max_w=186)
    # 电脑操作：独立块，与 DSH 连线
    g.rect(960, 176, 216, 60, rx=12)
    g.bilabel(1068, 206, "Cua Driver · 电脑操作", "Cua Driver · computer use", max_w=200)
    g.path("M888 206H957")
    # 第三、四层
    g.path("M468 260V289")
    g.rect(308, 292, 320, 56, rx=14)
    g.bilabel(468, 320, "magpie 网关（Go，127.0.0.1）", "magpie gateway (Go, 127.0.0.1)", max_w=300)
    g.path("M468 348V377")
    g.rect(348, 380, 240, 48, rx=14, accent=True)
    g.bilabel(468, 404, "", "Modelflare", kind="title")
    g.path("M468 428V453")
    g.rect(368, 456, 200, 44, rx=12)
    g.bilabel(468, 478, "模型供应商", "Model providers", max_w=190)
    title = "架构 / Architecture"
    desc = ("Electron 外壳、命令行或 Docker 启动 Node.js + TypeScript 后端，后端包含 Preact 界面、SQLite、DSH 智能体运行时和渠道适配，"
            "再调用内置的 magpie 网关，由它连到 Modelflare。 Electron shell, command line or Docker start a Node.js and TypeScript backend"
            " with a Preact UI, SQLite, the DSH agent runtime and channel adapters, which call the bundled magpie gateway, which calls Modelflare.")
    return g.svg(title, desc), g.warnings


def make_diagrams():
    warns = []
    for name, fn in (("data-flow", diagram_data_flow), ("architecture", diagram_architecture)):
        for theme in ("light", "dark"):
            svg, w = fn(theme)
            warns += [f"{name}-{theme}: {x}" for x in w]
            with open(out("diagrams", f"{name}-{theme}.svg"), "w") as fh:
                fh.write(svg)
    return warns


# ---------------------------------------------------------------------------
# 角色（ui/components/avatar.js + ui/design/components/avatar.css）
# 精灵图 8 帧横排（每帧 448×448）：0 头、1 左耳、2 右耳、3 头顶配件、4–7 发光层（默认不显示）。
# 叠放顺序：左耳 → 右耳 → 配件 → 头 → 眼睛 SVG（open：半径 r 的圆，带 drop-shadow 辉光）。
# 看指针：.bf-look translate(look-x·s·.03, look-y·s·.018) rotate(look-x·3deg)，原点 50% 60%；
#         .bf-gaze 再把眼睛平移 (look-x·2.4, look-y·1.6) 个 viewBox 单位。
# ---------------------------------------------------------------------------
CHARS = {  # 与 avatar.js 的 BOT_CHARS 一致（eyes、r），颜色取自 ui/design/tokens/primitives.css
    "blue": {"eyes": [(38.81, 62.99), (60.82, 62.99)], "r": 3.41, "eye": "#6dd4fb", "glow": "#2a9dff"},
    "yellow": {"eyes": [(38.34, 63.5), (61.4, 63.48)], "r": 3.57, "eye": "#fcfcdc", "glow": "#ffc21a"},
    "green": {"eyes": [(38.8, 63.07), (61.09, 63.08)], "r": 3.49, "eye": "#b5fbd6", "glow": "#2ee88a"},
    "red": {"eyes": [(37.53, 59.46), (62.24, 59.45)], "r": 3.88, "eye": "#fc9379", "glow": "#ff3b2a"},
    "purple": {"eyes": [(38.86, 63.04), (60.96, 63.04)], "r": 3.49, "eye": "#fdc1fb", "glow": "#c24dff"},
    "orange": {"eyes": [(38.18, 61.84), (61.83, 61.84)], "r": 3.57, "eye": "#fdd77c", "glow": "#ff8c1a"},
}
CHAR_KEYS = ["blue", "yellow", "green", "red", "purple", "orange"]  # avatar.js 的 CHAR_KEYS 顺序
SPRITE = 448
_sprite_cache = {}


def sprite_base(key):
    if key not in _sprite_cache:
        s = Image.open(os.path.join(ROOT, "ui", "design", "bots", f"{key}.webp")).convert("RGBA")
        base = Image.new("RGBA", (SPRITE, SPRITE), (0, 0, 0, 0))
        for i in (1, 2, 3, 0):
            base.alpha_composite(s.crop((i * SPRITE, 0, (i + 1) * SPRITE, SPRITE)))
        _sprite_cache[key] = base
    return _sprite_cache[key]


def eyes_layer(key, n, gx, gy, glow_px, ss=4):
    c = CHARS[key]
    big = Image.new("L", (n * ss, n * ss), 0)
    d = ImageDraw.Draw(big)
    u = n * ss / 100
    for (ex, ey) in c["eyes"]:
        cx, cy, r = (ex + gx) * u, (ey + gy) * u, c["r"] * u
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    mask = big.resize((n, n), Image.LANCZOS)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    # drop-shadow(0 0 blur glow)：CSS 的模糊半径 = 2 × 高斯标准差
    glow_a = mask.filter(ImageFilter.GaussianBlur(glow_px / 2))
    glow = Image.new("RGBA", (n, n), rgb(c["glow"]) + (0,))
    glow.putalpha(glow_a)
    layer.alpha_composite(glow)
    eye = Image.new("RGBA", (n, n), rgb(c["eye"]) + (0,))
    eye.putalpha(mask)
    layer.alpha_composite(eye)
    return layer


def render_avatar(key, size, look_x=0.0, look_y=0.0):
    n = SPRITE
    im = sprite_base(key).copy()
    im.alpha_composite(eyes_layer(key, n, look_x * 2.4, look_y * 1.6, glow_px=n * 0.028))
    if look_x or look_y:
        tx, ty = look_x * n * 0.03, look_y * n * 0.018
        im = im.rotate(-look_x * 3, resample=Image.BICUBIC, center=(n * 0.5, n * 0.6), translate=(tx, ty))
    return im.resize((size, size), Image.LANCZOS)


def row_positions(width, count):
    return [width * (i + 0.5) / count for i in range(count)]


def make_bots_row(path_light, path_dark):
    W, H, box = 1600, 480, 256
    look_x, look_y = 0.6, 0.05  # 略向右看
    faces = [render_avatar(k, box, look_x, look_y) for k in CHAR_KEYS]
    for path, bg in ((path_light, PAGE_LIGHT), (path_dark, PAGE_DARK)):
        im = Image.new("RGBA", (W, H), rgb(bg) + (255,))
        for cx, f in zip(row_positions(W, 6), faces):
            # 墨迹的竖直中心约在方框 50%，所以方框中心放在画面中线
            im.alpha_composite(f, (round(cx - box / 2), round(H / 2 - box * 0.5)))
        im.convert("RGB").save(path, "WEBP", quality=82, method=6)


def look_for(px, py, cx, cy, w):
    """avatar.js applyLook()：指针在 (px, py)，脸中心 (cx, cy)，方框宽 w"""
    if px is None:
        return 0.0, 0.0
    dx, dy = px - cx, py - cy
    fall = max(0.0, 1 - math.hypot(dx, dy) / max(140, w * 4))
    lx = max(-1.0, min(1.0, (dx / (w * 0.7)) * fall))
    ly = max(-1.0, min(1.0, (dy / (w * 0.7)) * fall))
    return lx, ly


def pointer_at(t, W):
    """§6.6 G10：0–1 s 在页面外；1–4.5 s 从最左匀速扫到最右；4.5–5.5 s 往上移出页面；之后在页面外"""
    y_row = 112
    if t < 1.0:
        return None, None
    if t <= 4.5:
        return (t - 1.0) / 3.5 * W, y_row
    if t <= 5.5:
        p = (t - 4.5) / 1.0
        x = W + (W * 0.82 - W) * p
        y = y_row + (-8 - y_row) * p
        return (x, y) if y >= 0 else (None, None)
    return None, None


def make_eyes_gif(path):
    W, H, box, fps, secs = 960, 300, 148, 15, 6.0
    cxs = row_positions(W, 6)
    cy = H / 2
    # CSS 过渡近似成一阶滞后：.bf-look 240 ms、.bf-gaze 120 ms（ease-out），这里只用一组 look 值
    tau = 0.075
    step = 1 / 240
    look = [(0.0, 0.0)] * 6
    frames_t = [i / fps for i in range(int(fps * secs))]
    sim_t = 0.0
    bg = Image.new("RGB", (W, H), rgb(PAGE_DARK))
    rendered = []
    cache = {}
    for ft in frames_t:
        while sim_t < ft - 1e-9:
            px, py = pointer_at(sim_t, W)
            a = 1 - math.exp(-step / tau)
            look = [(lx + (tx - lx) * a, ly + (ty - ly) * a)
                    for (lx, ly), (tx, ty) in zip(look, [look_for(px, py, cx, cy, box) for cx in cxs])]
            sim_t += step
        frame = bg.copy().convert("RGBA")
        for k, cx, (lx, ly) in zip(CHAR_KEYS, cxs, look):
            q = (k, round(lx, 3), round(ly, 3))
            if q not in cache:
                cache[q] = render_avatar(k, box, q[1], q[2])
            frame.alpha_composite(cache[q], (round(cx - box / 2), round(cy - box * 0.5)))
        rendered.append(frame.convert("RGB"))
    # 全局调色板（所有帧共用，帧间不闪），不抖动
    sample = Image.new("RGB", (W, H * 3))
    for i, idx in enumerate((0, len(rendered) // 2, len(rendered) * 3 // 4)):
        sample.paste(rendered[idx], (0, H * i))
    pal = sample.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    frames = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in rendered]
    # GIF 的时长单位是 10 ms：按累计时间取整，总长正好 6 s，再让最后一帧多停 1 s
    marks = [round(i * 100 / fps) * 10 for i in range(len(frames) + 1)]
    durs = [b - a for a, b in zip(marks, marks[1:])]
    durs[-1] += 1000
    # 合并完全相同的相邻帧
    mf, md = [frames[0]], [durs[0]]
    for f, d in zip(frames[1:], durs[1:]):
        if f.tobytes() == mf[-1].tobytes():
            md[-1] += d
        else:
            mf.append(f)
            md.append(d)
    mf[0].save(path, save_all=True, append_images=mf[1:], duration=md, loop=0, optimize=True, disposal=1)


# ---------------------------------------------------------------------------
# Modelflare 官方 Logo：原样下载，不重新编码
# ---------------------------------------------------------------------------
def fetch_modelflare_logo(path):
    with urllib.request.urlopen(MODELFLARE_LOGO_URL, timeout=30) as r:
        data = r.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SystemExit("modelflare logo: 下载到的不是 PNG")
    Image.open(io.BytesIO(data)).verify()
    with open(path, "wb") as fh:
        fh.write(data)


# ---------------------------------------------------------------------------
# 核对：尺寸、帧数、时长、体积（上限取自需求稿 §6.1）
# ---------------------------------------------------------------------------
LIMITS = {
    "brand/logo-eyes.svg": 2, "brand/logo-eyes.webp": 80, "brand/wordmark-light.svg": 12, "brand/wordmark-dark.svg": 12,
    "brand/social-preview.png": 400, "modelflare/modelflare-logo.png": 40,
    "diagrams/data-flow-light.svg": 60, "diagrams/data-flow-dark.svg": 60,
    "diagrams/architecture-light.svg": 60, "diagrams/architecture-dark.svg": 60,
    "screenshots/bots-light.webp": 300, "screenshots/bots-dark.webp": 300, "features/characters-eyes.gif": 1536,
}


def report():
    print(f"{'文件':44} {'尺寸':>11} {'帧':>4} {'时长':>7} {'体积':>9} {'上限':>7}")
    ok_all = True
    for rel, lim in LIMITS.items():
        p = os.path.join(OUT, rel)
        if not os.path.exists(p):
            print(f"{rel:44} {'(缺失)':>11}")
            continue
        kb = os.path.getsize(p) / 1024
        dims, nfr, dur = "", "", ""
        if rel.endswith(".svg"):
            import re
            m = re.search(r'viewBox="0 0 (\d+) (\d+)"', open(p).read())
            dims = f"{m.group(1)}×{m.group(2)}" if m else "?"
        else:
            im = Image.open(p)
            dims = f"{im.size[0]}×{im.size[1]}"
            n = getattr(im, "n_frames", 1)
            if n > 1:
                total = 0
                for i in range(n):
                    im.seek(i)
                    im.load()
                    total += im.info.get("duration", 0) or 0
                nfr, dur = str(n), f"{total / 1000:.2f}s"
        ok = kb <= lim
        ok_all &= ok
        print(f"{rel:44} {dims:>11} {nfr:>4} {dur:>7} {kb:>7.1f}KB {lim:>5}KB {'✓' if ok else '✗ 超限'}")
    return ok_all


def main(argv):
    groups = [a for a in argv if not a.startswith("--")] or ["brand", "diagrams", "bots", "eyes-gif"]
    if "--fetch-modelflare-logo" in argv:
        fetch_modelflare_logo(out("modelflare", "modelflare-logo.png"))
        print("modelflare-logo.png: 已下载")
    if "brand" in groups:
        with open(out("brand", "logo-eyes.svg"), "w") as fh:
            fh.write(EYES_SVG)
        make_logo_webp(out("brand", "logo-eyes.webp"))
        make_wordmarks()
        info = make_social_preview(out("brand", "social-preview.png"))
        print("social-preview:", {k: round(v, 1) for k, v in info.items()})
    if "diagrams" in groups:
        for w in make_diagrams():
            print("警告:", w)
    if "bots" in groups:
        make_bots_row(out("screenshots", "bots-light.webp"), out("screenshots", "bots-dark.webp"))
    if "eyes-gif" in groups:
        make_eyes_gif(out("features", "characters-eyes.gif"))
    ok = report()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
