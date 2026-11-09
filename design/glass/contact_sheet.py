"""把 6 张 390x844@2x 的屏截图拼成一张联系表（3 列 × 2 行）。
每屏缩放到 0.62，带编号 + 名称，白底、圆角、轻阴影，适合贴进对话或放进文档。
"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = r"C:\Users\lenov\Documents\deepseek-harness\default-workspace"
SHOT = os.path.join(ROOT, ".shot")
OUT = os.path.join(SHOT, "contact-sheet.png")

SCREENS = [
    ("01", "首页 · 今天想找点什么", "home"),
    ("02", "搭子大厅 · 发布 + 筛选", "hall"),
    ("03", "搭子详情 · 我想搭", "detail"),
    ("04", "我的 · 资料 + 信誉", "me"),
    ("05", "个人主页 · 搭子关系", "profile"),
    ("06", "聊天 · 关系浮在会话里", "chat"),
]

SCALE = 0.62
COLS = 3
PAD = 34          # 卡片外留白
GAP_X = 40
GAP_Y = 46
CAP_H = 34        # 每屏上方的编号+名称行

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\segoeui.ttf",
]


def load_font(size, bold=False):
    paths = ([r"C:\Windows\Fonts\msyhbd.ttc"] if bold else []) + FONT_CANDIDATES
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main():
    imgs = []
    for no, name, key in SCREENS:
        path = os.path.join(SHOT, key + ".png")
        im = Image.open(path).convert("RGB")
        w = int(im.width * SCALE / 2)   # 截图是 @2x，先折半回到 390 设计宽度
        h = int(im.height * SCALE / 2)
        imgs.append((no, name, im.resize((w, h), Image.LANCZOS)))

    cell_w = imgs[0][2].width
    cell_h = imgs[0][2].height

    rows = (len(imgs) + COLS - 1) // COLS
    sheet_w = PAD * 2 + cell_w * COLS + GAP_X * (COLS - 1)
    sheet_h = PAD * 2 + (cell_h + CAP_H) * rows + GAP_Y * (rows - 1)

    sheet = Image.new("RGB", (sheet_w, sheet_h), (247, 242, 238))
    draw = ImageDraw.Draw(sheet)

    font_no = load_font(13)
    font_name = load_font(15, bold=True)

    for i, (no, name, im) in enumerate(imgs):
        r, c = divmod(i, COLS)
        x = PAD + c * (cell_w + GAP_X)
        y = PAD + r * (cell_h + CAP_H + GAP_Y)

        draw.text((x + 2, y + 6), no, font=font_no, fill=(150, 128, 120))
        draw.text((x + 32, y + 3), name, font=font_name, fill=(58, 44, 39))

        sy = y + CAP_H
        # 柔和投影：先画几层逐渐透明的圆角矩形
        shadow = Image.new("RGBA", (cell_w + 40, cell_h + 40), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle(
            (18, 20, cell_w + 20, cell_h + 22),
            radius=26,
            fill=(150, 78, 52, 40),
        )
        from PIL import ImageFilter
        shadow = shadow.filter(ImageFilter.GaussianBlur(11))
        sheet.paste(shadow, (x - 20, sy - 20), shadow)

        # 圆角裁切每屏，避免直角贴在白底上
        mask = Image.new("L", (cell_w, cell_h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, cell_w, cell_h), radius=24, fill=255)
        sheet.paste(im, (x, sy), mask)

    sheet.save(OUT, "PNG", optimize=True)
    print("saved", OUT, sheet.size, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
