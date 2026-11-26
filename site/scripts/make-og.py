# 生成静态图形资源：各语言的 OG 分享图（1200×630）。
# 产物提交到 public/；改了文案或标记后手动运行：python3 scripts/make-og.py（需要 Pillow 与 Noto Sans SC）。
# 中文首页的微信分享方图单独生成：python3 scripts/make-og.py wechat-home
# favicon / App 图标和桌面 App 是同一个毛绒机器人图标，不在这里画：在仓库根目录运行 python3 scripts/build-app-icons.py site。
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.dirname(SITE)
PUB = os.path.join(SITE, "public")
LIME, INK, BG, TEXT, MUTED = (215, 255, 0), (22, 26, 0), (6, 7, 6), (250, 250, 247), (161, 161, 170)
CJK = "/usr/share/fonts/truetype/noto-cjk/NotoSansSC.ttf"
GEIST = os.path.join(SITE, "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf")
GEIST_R = os.path.join(SITE, "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf")
MONO = os.path.join(SITE, "node_modules/geist/dist/fonts/geist-mono/GeistMono-Medium.ttf")
BOTS = ["主-蓝色", "黄色小萌", "绿草", "红魔", "紫钻", "橙色探险者"]

COPY = {
    "zh": {"h1": ["你的 AI 机器人团队，", "跑在自己的电脑上。"], "mark": "跑在自己的电脑上", "sub": "任意模型，每台设备，数据留在你电脑上。", "chips": ["对话存本机", "按量付费 · App 免费", "MIT 开源"]},
    "zh-TW": {"h1": ["你的 AI 機器人團隊，", "在自己的電腦上執行。"], "mark": "在自己的電腦上執行", "sub": "模型任你選，對話和檔案留在自己的電腦。", "chips": ["對話儲存於本機", "App 免費 · 依用量付費", "MIT 開放原始碼"]},
    "en": {"h1": ["Your team of AI bots,", "running on your computer."], "mark": "running on your computer", "sub": "Any model. Every device. Your data, your machine.", "chips": ["Chats stay local", "Pay per use · App is free", "MIT open source"]},
    "ja": {"h1": ["あなたのパソコンで動く", "AI ボットのチーム。"], "mark": "AI ボットのチーム", "sub": "好きなモデルで。チャットは手元に保存。", "chips": ["チャットは本機に保存", "アプリ無料・従量課金", "MIT オープンソース"]},
    "ko": {"h1": ["내 컴퓨터에서 실행하는", "나만의 AI 봇 팀."], "mark": "나만의 AI 봇 팀", "sub": "원하는 모델로. 대화는 내 기기에 저장.", "chips": ["대화는 내 기기에", "앱 무료 · 사용량 과금", "MIT 오픈 소스"]},
    "ru": {"h1": ["Ваша команда ИИ-ботов", "на вашем компьютере."], "mark": "на вашем компьютере", "sub": "Любая модель. Разговоры хранятся у вас.", "chips": ["История у вас", "Приложение бесплатно", "Открытый код · MIT"]},
    "es": {"h1": ["Tu equipo de bots de IA,", "en tu computadora."], "mark": "en tu computadora", "sub": "Cualquier modelo y dispositivo. Tus datos, contigo.", "chips": ["Chats en local", "Pago por uso · App gratis", "Código abierto MIT"]},
    "pt": {"h1": ["Sua equipe de bots de IA,", "no seu computador."], "mark": "no seu computador", "sub": "Qualquer modelo e aparelho. Seus dados com você.", "chips": ["Chats locais", "Pague pelo uso · App grátis", "Código aberto MIT"]},
    "tr": {"h1": ["Yapay zeka bot ekibin,", "kendi bilgisayarında."], "mark": "kendi bilgisayarında", "sub": "İstediğin model. Verilerin sende kalsın.", "chips": ["Sohbetler cihazda", "Kullandıkça öde · Uygulama ücretsiz", "MIT açık kaynak"]},
}

# Source fonts from google/fonts (SIL OFL), supplied at generation time. The website
# keeps using system fonts; these large font files are not shipped to visitors.
LOCAL_FONTS = {
    "zh-TW": os.environ.get("AMB_OG_FONT_ZH_TW", "/usr/share/fonts/truetype/noto-cjk/NotoSansTC.ttf"),
    "ja": os.environ.get("AMB_OG_FONT_JA", "/usr/share/fonts/truetype/noto-cjk/NotoSansJP.ttf"),
    "ko": os.environ.get("AMB_OG_FONT_KO", "/usr/share/fonts/truetype/noto-cjk/NotoSansKR.ttf"),
    "ru": os.environ.get("AMB_OG_FONT_RU", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
}


def mark(size, plate=LIME, eye=INK, scale=4):
    """Eyes 标记（viewBox 100）：面罩 94×82 圆角 36，眼睛 13×28 竖胶囊，居中静态"""
    s = size * scale
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = s / 100
    d.rounded_rectangle([3 * u, 9 * u, 97 * u, 91 * u], radius=36 * u, fill=plate)
    for x in (29, 58):
        d.rounded_rectangle([x * u, 36 * u, (x + 13) * u, 64 * u], radius=6.5 * u, fill=eye)
    return im.resize((size, size), Image.LANCZOS)


def font(path, size, weight=None):
    f = ImageFont.truetype(path, size)
    if weight:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


def og(lang):
    c = COPY[lang]
    W, H = 1200, 630
    im = Image.new("RGBA", (W, H), BG + (255,))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.15, -H * 0.55, W * 0.85, H * 0.55], fill=LIME + (46,))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
    d = ImageDraw.Draw(im)
    head = font(CJK, 64, 600) if lang == "zh" else font(GEIST, 68)
    sub = font(CJK, 28, 400) if lang == "zh" else font(GEIST_R, 28)
    chip = font(CJK, 20, 400) if lang == "zh" else font(MONO, 18)
    # 标题太长时缩小字号，别压到右边的机器人（x ≥ 760）
    size = 64 if lang == "zh" else 68
    while lang not in LOCAL_FONTS and max(d.textlength(line, font=head) for line in c["h1"]) > 680:
        size -= 1
        head = font(CJK, size, 600) if lang == "zh" else font(GEIST, size)
    if lang in LOCAL_FONTS:
        face = LOCAL_FONTS[lang]
        if not os.path.isfile(face):
            raise FileNotFoundError(f"Set AMB_OG_FONT_{lang.upper().replace('-', '_')} to a font supporting {lang}: {face}")
        size = 62
        head = font(face, size, 600)
        while max(d.textlength(line, font=head) for line in c["h1"]) > 680:
            size -= 1
            head = font(face, size, 600)
        sub = font(face, 26, 400)
        size = 20
        chip = font(face, size, 500)
        while sum(d.textlength(text, font=chip) + 32 for text in c["chips"]) + 24 > 680:
            size -= 1
            chip = font(face, size, 500)
    brand = font(GEIST, 34)
    # 品牌锁定组合
    m = mark(56)
    im.alpha_composite(m, (72, 64))
    d.text((140, 70), "AnyModelBot", font=brand, fill=TEXT)
    # 标题（第二行带荧光笔）
    y = 176
    d.text((72, y), c["h1"][0], font=head, fill=TEXT)
    y += 92
    line2 = c["h1"][1]
    pre = line2.split(c["mark"])[0]
    x = 72 + d.textlength(pre, font=head)
    d.text((72, y), pre, font=head, fill=TEXT)
    mw = d.textlength(c["mark"], font=head)
    box = d.textbbox((x, y), c["mark"], font=head)
    d.rounded_rectangle([x - 6, box[1] - 6, x + mw + 6, box[3] + 10], radius=6, fill=LIME)
    d.text((x, y), c["mark"], font=head, fill=INK)
    d.text((x + mw, y), line2[len(pre) + len(c["mark"]):], font=head, fill=TEXT)
    d.text((72, y + 104), c["sub"], font=sub, fill=MUTED)
    # 信任 chip
    cx, cy = 72, 520
    for t in c["chips"]:
        w = d.textlength(t, font=chip) + 32
        d.rounded_rectangle([cx, cy, cx + w, cy + 40], radius=20, outline=(255, 255, 255, 40), width=1)
        d.text((cx + 16, cy + 9), t, font=chip, fill=MUTED)
        cx += w + 12
    # 六个毛绒机器人（原画）
    bx = 760
    for i, n in enumerate(BOTS):
        p = os.path.join(APP, "anymodelbot_design", "logo avator", f"{n}.png")
        if not os.path.exists(p):
            continue
        b = Image.open(p).convert("RGBA")
        b = b.crop(b.getbbox())
        size = 150 if i == 0 else 112
        b.thumbnail((size, size), Image.LANCZOS)
        pos = [(860, 150), (770, 300), (960, 300), (760, 440), (900, 430), (1040, 440)][i]
        im.alpha_composite(b, pos)
    out = os.path.join(PUB, "og", f"og-{lang}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.convert("RGB").save(out, optimize=True)
    print(out, os.path.getsize(out) // 1024, "KB")


def wechat_home():
    """中文首页的微信分享方图（600×600）：版式同 og/wechat-share.png，字够大，缩到聊天里的小方格也看得清"""
    S = 1200  # 先画两倍再缩小，字的边缘更干净
    im = Image.new("RGBA", (S, S), BG + (255,))
    m = mark(480)
    im.alpha_composite(m, ((S - m.width) // 2, 122))
    d = ImageDraw.Draw(im)
    d.text((S / 2, 676), "你的 AI 机器人团队", font=font(CJK, 124, 800), fill=TEXT, anchor="ma")
    d.text((S / 2, 940), "AnyModelBot", font=font(CJK, 96, 700), fill=LIME, anchor="ma")
    out = os.path.join(PUB, "og", "wechat-home.png")
    im.resize((600, 600), Image.LANCZOS).convert("RGB").save(out, optimize=True)
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    if sys.argv[1:] == ["wechat-home"]:
        wechat_home()
        sys.exit(0)
    selected = sys.argv[1:] or list(COPY)
    for lang in selected:
        if lang not in COPY:
            raise SystemExit(f"Unknown language: {lang}; choose {', '.join(COPY)}")
        og(lang)
    sys.exit(0)
