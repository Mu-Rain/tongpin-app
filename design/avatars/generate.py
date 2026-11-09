# -*- coding: utf-8 -*-
"""生成 7 个「动作特写」自带头像 —— 线条轮廓 + 平涂色。

风格：
  · 描边 + 平涂色，主描边 #3B2C24；所有接头 round，圆润无尖角
  · 脸只留轮廓：没有眼睛、鼻子、嘴、眉毛、耳朵
  · 手是圆片，没有手指
  · 半身像：身体在画面下缘收成一个圆弧（不是一根长柱子）
  · 每个头像换一种发型，不套同一个模板
  · 细节线（衣领、肩缝、发丝、道具纹理）用 2.2px、55% 透明度的墨色，
    只做「收边」，不做阴影和渐变

绘制顺序：身体 → 手臂 → 手 → 道具 → 头（拍照例外：头 → 相机 → 手）
手臂必须用肤色 + 「粗墨线打底、细肤色盖面」两层，否则和衣服糊成一块。
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
W = H = 400

SKIN = '#F8DCC4'
HAIR = '#7A563E'
INK = '#3B2C24'
WHITE = '#FFFFFF'

C = {
    'study':       {'shirt': '#BFE3D4', 'prop': '#8FC6E8', 'prop2': '#D9EDF9'},
    'fitness':     {'shirt': '#FBE79A', 'prop': '#F58F6E', 'prop2': '#F7B49C'},
    'photo':       {'shirt': '#F7C9B4', 'prop': '#BDA8E8', 'prop2': '#D8CCF4'},
    'meal':        {'shirt': '#A9D6F0', 'prop': '#F58F80', 'prop2': '#F9B7AC'},
    'sport':       {'shirt': '#C9B6EE', 'prop': '#F2A25C', 'prop2': '#F7C08A'},
    'competition': {'shirt': '#F3EAD6', 'prop': '#E8BE55', 'prop2': '#F3D98D'},
    'other':       {'shirt': '#CBD9DE', 'prop': '#5FC3BC', 'prop2': '#9BDCD6'},
}

SW = 4.2          # 主描边
DW = 2.2          # 细节线
DETAIL = 'opacity="0.55"'

R = 50            # 头半径（头约 100，身体可见高度约 150 → 1:1.5 的半身像）
HEAD_Y = 118
BODY_TOP = 192
BODY_BOTTOM = 322


# ------------------------------------------------------------------ 基础图元
def shape(d, fill, w=SW):
    return ('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round" '
            'stroke-linecap="round"/>' % (d, fill, INK, w))


def circle(cx, cy, r, fill, w=SW):
    return ('<circle cx="%s" cy="%s" r="%s" fill="%s" stroke="%s" stroke-width="%s"/>'
            % (cx, cy, r, fill, INK, w))


def rect(x, y, w_, h_, r, fill, w=SW):
    return ('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s" stroke="%s" '
            'stroke-width="%s"/>' % (x, y, w_, h_, r, fill, INK, w))


def line(d, w=DW, color=INK, detail=True):
    return ('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" %s/>'
            % (d, color, w, DETAIL if detail else ''))


def limb(d, fill=SKIN, w=21):
    return ('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
            % (d, INK, w + SW * 2, d, fill, w))


# ------------------------------------------------------------------ 头（7 种发型）
def hair_front(fx, cy, r, low=0):
    """前发：外沿贴着头型走一圈，内沿是发际线。

    以前这里画的是一个椭圆，落在脸上像贴了块棕色膏药。
    现在改成「沿头顶外弧 → 回到发际线」的月牙形，发际线本身就是一条弧，
    和脸轮廓共圆心，看起来才是长在头上的头发。
    low 用来把发际线压低一点（卷发/厚刘海用）。
    """
    outer = r + 5
    inner = r - 2
    hairline_y = cy + 2 + low
    apex = cy - 12 + low
    return ('<path d="M %d %d A %d %d 0 0 1 %d %d L %d %d Q %d %d %d %d Z" '
            'fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
            % (fx - outer, cy + 6, outer, outer, fx + outer, cy + 6,
               fx + inner, hairline_y, fx, apex, fx - inner, hairline_y,
               HAIR, INK, SW))


def head(cx, cy, style='short', tilt=0, turn=0, r=R, cap=None):
    """发型：short 短发 / ponytail 马尾 / cap 鸭舌帽 / bun 丸子头 /
    bob 波波头 / long 长发 / curly 卷发。"""
    fx = cx + turn * 8
    g = ['<g transform="rotate(%d %d %d)">' % (tilt, cx, cy)]

    # ---- 后层 ----
    if style == 'ponytail':
        g.append(shape('M %d %d q 26 -6 30 22 q 4 26 -22 30 q -10 -24 -8 -52 Z'
                       % (fx + r - 12, cy - 6), HAIR))
    if style == 'long':
        g.append(rect(fx - r - 5, cy - 18, 19, 96, 9, HAIR))
        g.append(rect(fx + r - 14, cy - 18, 19, 96, 9, HAIR))
    if style == 'bun':
        g.append(circle(fx, cy - r - 4, 16, HAIR))

    # ---- 主发块 / 帽子 ----
    front = []          # 必须压在脸上面画的东西（帽檐、帽子主体）
    if style == 'cap':
        capc = cap or '#BDA8E8'
        # ★ 帽子要盖在额头上面，所以放进 front，等脸画完再画
        front.append(shape('M %d %d A %d %d 0 0 1 %d %d Z'
                           % (fx - r - 3, cy - 2, r + 3, r + 3, fx + r + 3, cy - 2), capc))
        front.append(rect(fx + r - 10, cy - 16, 38, 15, 7, capc))
    elif style in ('bob', 'long'):
        # 长发/波波头：发顶用扁椭圆，两侧单独出发片，不再整颗圆
        g.append('<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="%s" stroke="%s" '
                 'stroke-width="%s"/>' % (fx, cy - 14, r + 3, r - 4, HAIR, INK, SW))
    else:
        g.append(circle(cx, cy - 4, r + 4, HAIR))

    # ---- 脸 ----
    g.append(circle(fx, cy + 6, r, SKIN))
    g.extend(front)

    # ---- 前层：刘海 / 卷发 ----
    if style in ('short', 'ponytail', 'bun', 'long', 'bob'):
        g.append(hair_front(fx, cy, r))
        # 发丝：两道细线，让刘海不那么"一整块"
        g.append(line('M %d %d q 16 -6 30 2' % (fx - 32, cy - 30)))
        g.append(line('M %d %d q 14 -8 26 -2' % (fx - 8, cy - 34)))

    if style == 'curly':
        g.append(hair_front(fx, cy, r, low=4))
        for dx, dy in [(-38, -10), (-20, -20), (0, -24), (20, -20), (38, -10)]:
            g.append(circle(fx + dx, cy + dy, 14, HAIR))

    if style == 'bob':
        g.append(rect(fx - r - 3, cy - 20, 17, 66, 8, HAIR))
        g.append(rect(fx + r - 14, cy - 20, 17, 66, 8, HAIR))

    # 发带：贴着额头上沿的一条弧，先描墨边再盖色
    if style == 'band':
        bandc = cap or '#F2A25C'
        # 弧要落在额头（cy-4 处起拱），贴着发顶会只剩一条边看不见
        d = 'M %d %d A %d %d 0 0 1 %d %d' % (fx - r + 5, cy - 4, r, r, fx + r - 5, cy - 4)
        g.append('<path d="%s" fill="none" stroke="%s" stroke-width="19" stroke-linecap="round"/>'
                 % (d, INK))
        g.append('<path d="%s" fill="none" stroke="%s" stroke-width="11" stroke-linecap="round"/>'
                 % (d, bandc))

    g.append('</g>')
    return ''.join(g)


# ------------------------------------------------------------------ 身体
def torso(cx=200, top=BODY_TOP, half=66, color='#BFE3D4', bottom=BODY_BOTTOM):
    neck = rect(cx - 14, top - 32, 28, 34, 12, SKIN)
    body = ('<path d="M %d %d Q %d %d %d %d L %d %d Q %d %d %d %d L %d %d Q %d %d %d %d Z" '
            'fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
            % (cx - half, bottom, cx, bottom + 18, cx + half, bottom,
               cx + half, top + 40, cx + half, top, cx + 38, top,
               cx - 38, top, cx - half, top, cx - half, top + 40,
               color, INK, SW))
    # 衣领 + 肩缝：只加「收边」的细线，不加褶皱
    collar = line('M %d %d Q %d %d %d %d' % (cx - 17, top + 2, cx, top + 22, cx + 17, top + 2), w=2.6)
    seam_l = line('M %d %d q -10 12 -8 26' % (cx - 52, top + 10))
    seam_r = line('M %d %d q 10 12 8 26' % (cx + 52, top + 10))
    return neck + body + collar + seam_l + seam_r


def wrap(inner):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<rect width="%d" height="%d" fill="%s"/>%s</svg>' % (W, H, W, H, W, H, WHITE, inner))


# ------------------------------------------------------------------ 学习：俯身翻书
def study():
    c = C['study']
    s = [torso(color=c['shirt'])]
    s.append(limb('M 150 200 L 128 258 L 126 288'))
    s.append(limb('M 250 200 L 272 258 L 274 288'))
    # 摊开的书（书脊竖在中间）
    s.append(shape('M 200 258 L 116 252 L 120 302 L 200 308 Z', c['prop']))
    s.append(shape('M 200 258 L 284 252 L 280 302 L 200 308 Z', c['prop']))
    s.append(line('M 200 258 L 200 308', w=SW, detail=False))
    # 页面上的两行字（极简横线）
    s.append(line('M 130 268 L 188 272'))
    s.append(line('M 130 282 L 180 286'))
    s.append(line('M 212 272 L 270 268'))
    s.append(line('M 220 286 L 270 282'))
    # 正在翻起的一页
    s.append(shape('M 200 258 Q 184 228 164 220 L 172 210 Q 194 218 208 248 Z', c['prop2']))
    s.append(circle(126, 292, 12, SKIN))
    s.append(circle(274, 292, 12, SKIN))
    s.append(head(200, HEAD_Y, style='short', tilt=-13))
    return ''.join(s)


# ------------------------------------------------------------------ 健身：单臂弯举
def fitness():
    c = C['fitness']
    s = [torso(half=58, color=c['shirt'])]
    s.append(limb('M 154 202 L 146 282'))
    s.append(circle(144, 292, 12, SKIN))
    # 右臂：肩 → 肘 → 手（肩高），两段折线
    s.append(limb('M 246 202 L 268 256'))
    s.append(limb('M 268 256 L 258 196'))
    # 哑铃
    s.append(rect(214, 190, 92, 10, 5, c['prop']))
    s.append(rect(208, 170, 18, 50, 9, c['prop']))
    s.append(rect(294, 170, 18, 50, 9, c['prop']))
    s.append(line('M 222 178 L 222 212', w=2))
    s.append(line('M 298 178 L 298 212', w=2))
    # 手比之前小一档：握住杆的中间，两侧还要露出足够的杆身
    s.append(circle(260, 195, 10, SKIN))
    s.append(head(196, HEAD_Y, style='ponytail', tilt=-2, turn=1))
    return ''.join(s)


# ------------------------------------------------------------------ 拍照：举机取景
def photo():
    c = C['photo']
    s = [torso(half=62, color=c['shirt'])]
    s.append(limb('M 148 206 L 128 242 L 140 200'))
    s.append(limb('M 252 206 L 272 242 L 260 200'))
    s.append(head(200, HEAD_Y, style='bob', tilt=1))
    s.append(rect(152, 166, 96, 62, 15, c['prop']))
    s.append(rect(180, 157, 34, 15, 7, c['prop']))
    s.append(circle(200, 198, 18, c['prop2']))
    s.append(circle(200, 198, 9, c['prop']))
    s.append(rect(163, 174, 12, 7, 3, c['prop2'], 2.6))
    s.append(line('M 232 176 L 238 176', w=2.6))
    s.append(circle(142, 202, 11, SKIN))
    s.append(circle(258, 202, 11, SKIN))
    return ''.join(s)


# ------------------------------------------------------------------ 吃饭：端碗夹面
def meal():
    c = C['meal']
    s = [torso(half=62, color=c['shirt'])]
    s.append(limb('M 152 204 L 142 254 L 170 288'))
    s.append(limb('M 248 204 L 252 230'))
    # 碗
    s.append(shape('M 132 290 A 44 44 0 0 0 220 290 Z', c['prop']))
    s.append(rect(132, 284, 88, 10, 5, c['prop2']))
    s.append(line('M 142 298 q 34 14 68 0'))
    s.append(circle(176, 298, 12, SKIN))
    # 筷子
    s.append(line('M 240 232 L 204 180', w=4.6, detail=False))
    s.append(line('M 248 238 L 212 186', w=4.6, detail=False))
    # 垂下来的面
    s.append('<path d="M 206 186 q 8 14 -2 26 q -10 12 2 26" fill="none" stroke="%s" '
             'stroke-width="4.6" stroke-linecap="round"/>' % c['prop2'])
    s.append(circle(246, 234, 12, SKIN))
    s.append(head(200, HEAD_Y, style='bun', tilt=9, turn=-1))
    return ''.join(s)


# ------------------------------------------------------------------ 运动：仰手投篮
def sport():
    c = C['sport']
    s = [torso(half=60, color=c['shirt'])]
    s.append(limb('M 152 206 L 138 250 L 170 260'))
    s.append(circle(174, 261, 12, SKIN))
    s.append(limb('M 250 206 L 284 154 L 272 100', w=22))
    s.append(circle(272, 58, 30, c['prop']))
    s.append(line('M 246 46 q 26 14 52 0', w=3.4, detail=False))
    s.append(line('M 272 30 q 6 28 0 56', w=3.4, detail=False))
    s.append(circle(272, 96, 11, SKIN))
    s.append(head(206, HEAD_Y, style='band', tilt=11, turn=1, cap=c['prop']))
    return ''.join(s)


# ------------------------------------------------------------------ 竞赛：双手举杯
def competition():
    c = C['competition']
    s = [torso(half=62, color=c['shirt'])]
    s.append(limb('M 150 204 L 120 152 L 156 84'))
    s.append(limb('M 250 204 L 280 152 L 244 84'))
    # 奖杯
    s.append(shape('M 176 26 L 224 26 L 217 60 Q 200 74 183 60 Z', c['prop']))
    s.append(line('M 176 30 q -18 6 -14 20 q 4 11 16 9', w=5.4, detail=False))
    s.append(line('M 224 30 q 18 6 14 20 q -4 11 -16 9', w=5.4, detail=False))
    s.append(rect(193, 64, 14, 14, 4, c['prop']))
    s.append(rect(180, 76, 40, 12, 6, c['prop2']))
    s.append(line('M 190 34 L 190 52', w=2))
    s.append(circle(158, 80, 11, SKIN))
    s.append(circle(242, 80, 11, SKIN))
    s.append(head(200, HEAD_Y + 6, style='long', tilt=-3))
    return ''.join(s)


# ------------------------------------------------------------------ 其他：戴耳机听歌
def other():
    c = C['other']
    s = [torso(half=62, color=c['shirt'])]
    s.append(limb('M 152 206 L 134 178 L 148 154'))
    # ★ 头先画，耳机后画：卷发的发卷会把头梁和耳罩整块盖掉
    s.append(head(200, HEAD_Y, style='curly', tilt=-2, turn=1))
    s.append('<path d="M 148 112 A 54 54 0 0 1 252 112" fill="none" stroke="%s" '
             'stroke-width="13" stroke-linecap="round"/>' % INK)
    s.append('<path d="M 148 112 A 54 54 0 0 1 252 112" fill="none" stroke="%s" '
             'stroke-width="6" stroke-linecap="round"/>' % c['prop'])
    s.append(rect(132, 104, 24, 42, 11, c['prop']))
    s.append(rect(244, 104, 24, 42, 11, c['prop']))
    # 音符
    s.append(circle(292, 112, 9, c['prop']))
    s.append(rect(299, 82, 6, 32, 3, c['prop'], 3))
    s.append(line('M 305 82 q 15 3 15 16', w=5.4, detail=False))
    s.append(circle(148, 150, 11, SKIN))
    return ''.join(s)


SCENES = [
    ('study', study), ('fitness', fitness), ('photo', photo), ('meal', meal),
    ('sport', sport), ('competition', competition), ('other', other),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    cells = []
    for key, fn in SCENES:
        svg = wrap(fn())
        with open(os.path.join(OUT, '%s.svg' % key), 'w', encoding='utf-8') as f:
            f.write(svg)
        cells.append('<div class="cell">%s</div>' % svg)

    html = ('<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
            'html,body{margin:0;padding:0;background:#fff}'
            '.grid{display:grid;grid-template-columns:repeat(4,400px);grid-auto-rows:400px}'
            '.cell{width:400px;height:400px;overflow:hidden}'
            '.cell svg{display:block}'
            '</style></head><body><div class="grid">%s</div></body></html>' % ''.join(cells))
    with open(os.path.join(OUT, '_sheet.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', len(SCENES), 'svgs ->', OUT)


if __name__ == '__main__':
    main()
