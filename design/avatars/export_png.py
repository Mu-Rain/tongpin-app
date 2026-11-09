# -*- coding: utf-8 -*-
"""把 generate.py 产出的 7 个 SVG 导成 400x400 PNG，直接覆盖 app/static/avatars/。

流程：generate.py 生成 _sheet.html（4 列 × 2 行，每格 400×400）
  → 无头 Edge 截 1600×800 → 按格裁切 → 写回 app/static/avatars/av-*.png

为什么绕一圈浏览器：SVG 转 PNG 需要真正的渲染器，项目里没有装 cairosvg/sharp，
而 Edge 本来就在机器上。截图得到的抗锯齿质量也最接近设计稿。
"""
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = os.path.join(HERE, '_sheet.html')
SHOT = os.path.join(HERE, '_sheet.png')
DST = os.path.normpath(os.path.join(HERE, '..', '..', 'app', 'static', 'avatars'))
KEYS = ['study', 'fitness', 'photo', 'meal', 'sport', 'competition', 'other']

EDGE_CANDIDATES = [
    r'C:/Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:/Program Files\Microsoft\Edge\Application\msedge.exe',
]


def find_edge():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    sys.exit('找不到 Edge，请把 msedge.exe 路径加到 EDGE_CANDIDATES')


def main():
    subprocess.check_call([sys.executable, os.path.join(HERE, 'generate.py')])

    if os.path.exists(SHOT):
        os.remove(SHOT)

    subprocess.check_call([
        find_edge(), '--headless=new', '--disable-gpu', '--no-sandbox',
        '--user-data-dir=' + os.path.join(HERE, '_edge_profile'),
        '--window-size=1600,800', '--hide-scrollbars',
        '--screenshot=' + SHOT, '--virtual-time-budget=4000',
        'file:///' + SHEET.replace('\\', '/') + '?v=1',
    ])

    im = Image.open(SHOT)
    cw, ch = im.size[0] // 4, im.size[1] // 2
    os.makedirs(DST, exist_ok=True)
    for i, k in enumerate(KEYS):
        x, y = (i % 4) * cw, (i // 4) * ch
        cell = im.crop((x, y, x + cw, y + ch)).resize((400, 400), Image.LANCZOS)
        cell.save(os.path.join(DST, 'av-%s.png' % k), optimize=True)
        print('%-12s -> av-%s.png' % (k, k))


if __name__ == '__main__':
    main()
