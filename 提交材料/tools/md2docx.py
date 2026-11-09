# -*- coding: utf-8 -*-
import os
import re
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

BODY_FONT = '等线'
CODE_FONT = 'Consolas'
TICK = chr(96)


def set_cjk(run, name):
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = rpr.makeelement(qn('w:rFonts'), {})
        rpr.append(rfonts)
    rfonts.set(qn('w:eastAsia'), name)


def strip_inline(text):
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)\*', r'\1', text)
    return text.replace(TICK, '').strip()


def add_paragraph(doc, text, style=None, bold=False):
    p = doc.add_paragraph(style=style)
    run = p.add_run(strip_inline(text))
    run.bold = bold
    run.font.size = Pt(10.5)
    set_cjk(run, BODY_FONT)
    return p


def add_code(doc, block):
    for line in block.split(chr(10)):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.left_indent = Inches(0.25)
        run = p.add_run(line if line else ' ')
        run.font.name = CODE_FONT
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
        set_cjk(run, CODE_FONT)


def add_table(doc, rows):
    cols = max(len(r) for r in rows)
    table = doc.add_table(rows=0, cols=cols)
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        cells = table.add_row().cells
        for j in range(cols):
            text = strip_inline(row[j]) if j < len(row) else ''
            cell = cells[j]
            cell.text = ''
            p = cell.paragraphs[0]
            run = p.add_run(text)
            run.bold = (i == 0)
            run.font.size = Pt(9)
            set_cjk(run, BODY_FONT)


def parse_table(lines, start):
    rows = []
    i = start
    while i < len(lines) and lines[i].strip().startswith('|'):
        raw = lines[i].strip().strip('|')
        cells = [c.strip() for c in raw.split('|')]
        if not all(re.fullmatch(r':?-{2,}:?', c) for c in cells if c):
            rows.append(cells)
        i += 1
    return rows, i


def convert(md_path, docx_path, images_dir=None):
    with open(md_path, 'r', encoding='utf-8') as f:
        lines = f.read().split(chr(10))
    doc = Document()
    normal = doc.styles['Normal']
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), BODY_FONT)

    i = 0
    missing = []
    while i < len(lines):
        s = lines[i].strip()

        if s.startswith(TICK * 3):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith(TICK * 3):
                buf.append(lines[i])
                i += 1
            add_code(doc, chr(10).join(buf))
            i += 1
            continue

        if s.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|?$', lines[i + 1].strip()):
            rows, i = parse_table(lines, i)
            if rows:
                add_table(doc, rows)
                doc.add_paragraph()
            continue

        m = re.match(r'^(#{1,4})\s+(.*)$', s)
        if m:
            level = min(len(m.group(1)), 4)
            h = doc.add_heading(level=level)
            run = h.add_run(strip_inline(m.group(2)))
            run.font.size = Pt({1: 20, 2: 15, 3: 12.5, 4: 11}[level])
            run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
            set_cjk(run, BODY_FONT)
            i += 1
            continue

        m = re.match(r'^!\[(.*?)\]\((.*?)\)$', s)
        if m:
            alt, src = m.group(1), m.group(2)
            cand = src if os.path.isabs(src) else os.path.join(images_dir or os.path.dirname(md_path), src)
            done = False
            if not src.startswith('http') and os.path.isfile(cand):
                try:
                    doc.add_picture(cand, width=Inches(5.6))
                    cap = doc.add_paragraph()
                    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    crun = cap.add_run(alt)
                    crun.font.size = Pt(9)
                    set_cjk(crun, BODY_FONT)
                    done = True
                except Exception:
                    done = False
            if done:
                i += 1
                continue
            missing.append(alt + ' -> ' + src)
            add_paragraph(doc, '［图片位：' + alt + '］（截图后放到 ' + src + ' 即自动嵌入）')
            i += 1
            continue

        if s.startswith('- ') or s.startswith('* '):
            add_paragraph(doc, s[2:], style='List Bullet')
            i += 1
            continue

        m = re.match(r'^(\d+)[.)]\s+(.*)$', s)
        if m:
            add_paragraph(doc, m.group(2), style='List Number')
            i += 1
            continue

        if s.startswith('>'):
            p = add_paragraph(doc, s.lstrip('> ').strip())
            p.paragraph_format.left_indent = Inches(0.3)
            for run in p.runs:
                run.italic = True
            i += 1
            continue

        if s == '' or s == '---':
            i += 1
            continue

        add_paragraph(doc, s)
        i += 1

    out_dir = os.path.dirname(docx_path)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    doc.save(docx_path)
    return missing


if __name__ == '__main__':
    md, docx = sys.argv[1], sys.argv[2]
    images = sys.argv[3] if len(sys.argv) > 3 else None
    missing = convert(md, docx, images)
    print('saved ' + docx)
    print('missing_images ' + str(len(missing)))
    for m in missing[:12]:
        print('  ' + m)
