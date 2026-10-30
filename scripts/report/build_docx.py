from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from PIL import Image

ROOT = Path.cwd()
MD_PATH = ROOT / "docs/课程设计报告-安全文件存储系统.md"
OUT_PATH = ROOT / "docs/课程设计报告-安全文件存储系统.docx"
DOCS_DIR = MD_PATH.parent

BODY_FONT = "宋体"
HEAD_FONT = "黑体"
CODE_FONT = "Consolas"
INK = RGBColor(0x1F, 0x2D, 0x3D)
GRAY = RGBColor(0x55, 0x5F, 0x6B)
BLUE = RGBColor(0x1F, 0x4F, 0x8F)
LIGHT_BLUE = "DCE8F7"
LIGHT_GRAY = "F2F2F2"


def set_run_font(run, name=BODY_FONT, size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = size
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_paragraph_shading(paragraph, fill):
    p_pr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    p_pr.append(shd)


def set_paragraph_border(paragraph, color="B8C2CC", size="4"):
    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    for edge in ("top", "left", "bottom", "right"):
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "4")
        element.set(qn("w:color"), color)
        borders.append(element)
    p_pr.append(borders)


def add_field(paragraph, instruction, placeholder=""):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = placeholder
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_sep)
    run._r.append(text)
    run._r.append(fld_end)


def add_inline_runs(paragraph, text, size=Pt(12), color=INK):
    pattern = re.compile(r"(\*\*.*?\*\*|`.*?`)")
    pos = 0
    for match in pattern.finditer(text):
        if match.start() > pos:
            run = paragraph.add_run(text[pos:match.start()])
            set_run_font(run, BODY_FONT, size, color=color)
        token = match.group(0)
        if token.startswith("**"):
            run = paragraph.add_run(token[2:-2])
            set_run_font(run, BODY_FONT, size, bold=True, color=color)
        else:
            run = paragraph.add_run(token[1:-1])
            set_run_font(run, CODE_FONT, Pt(max(8.5, size.pt - 1.5)), color=color)
        pos = match.end()
    if pos < len(text):
        run = paragraph.add_run(text[pos:])
        set_run_font(run, BODY_FONT, size, color=color)


def add_body_paragraph(doc, text, first_indent=True):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.line_spacing = 1.5
    paragraph.paragraph_format.space_after = Pt(4)
    if first_indent:
        paragraph.paragraph_format.first_line_indent = Pt(24)
    add_inline_runs(paragraph, text, Pt(12))
    return paragraph


def add_heading(doc, text, level):
    paragraph = doc.add_heading(level=level)
    paragraph.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    paragraph.paragraph_format.space_after = Pt(6)
    run = paragraph.add_run(text)
    sizes = {1: Pt(16), 2: Pt(14), 3: Pt(12)}
    set_run_font(run, HEAD_FONT, sizes.get(level, Pt(12)), bold=True, color=INK)
    return paragraph


def add_caption(doc, text, before=False):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(2)
    paragraph.paragraph_format.space_after = Pt(4 if before else 2)
    paragraph.paragraph_format.keep_with_next = before
    run = paragraph.add_run(text)
    set_run_font(run, BODY_FONT, Pt(10), bold=before, color=GRAY)
    return paragraph


def add_code_block(doc, code_lines):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Cm(0.25)
    paragraph.paragraph_format.right_indent = Cm(0.25)
    paragraph.paragraph_format.space_before = Pt(4)
    paragraph.paragraph_format.space_after = Pt(6)
    paragraph.paragraph_format.line_spacing = 1.0
    paragraph.paragraph_format.keep_together = False
    set_paragraph_shading(paragraph, LIGHT_GRAY)
    set_paragraph_border(paragraph)
    for index, line in enumerate(code_lines):
        if index:
            paragraph.add_run().add_break(WD_BREAK.LINE)
        run = paragraph.add_run(line if line else " ")
        set_run_font(run, CODE_FONT, Pt(8.5), color=INK)
    return paragraph


def add_image(doc, alt, src):
    path = (DOCS_DIR / src).resolve()
    if not path.exists():
        raise FileNotFoundError(path)
    with Image.open(path) as image:
        width_px, height_px = image.size
    max_width = 15.0
    max_height = 12.5
    width_cm = min(max_width, max_height * width_px / height_px)
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(4)
    paragraph.paragraph_format.space_after = Pt(2)
    run = paragraph.add_run()
    run.add_picture(str(path), width=Cm(width_cm))
    add_caption(doc, alt)


def add_table(doc, rows):
    if not rows:
        return
    cols = len(rows[0])
    table = doc.add_table(rows=1, cols=cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    header = table.rows[0]
    for index, value in enumerate(rows[0]):
        cell = header.cells[index]
        cell.text = ""
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_inline_runs(paragraph, value, Pt(9.5), color=INK)
        for run in paragraph.runs:
            run.bold = True
        set_cell_shading(cell, LIGHT_BLUE)
    # 表头跨页重复
    tr_pr = header._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)
    for row_values in rows[1:]:
        row = table.add_row()
        for index, value in enumerate(row_values):
            cell = row.cells[index]
            cell.text = ""
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.line_spacing = 1.0
            add_inline_runs(paragraph, value, Pt(9.5), color=INK)
    # 表格前后留白
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def is_table_start(lines, index):
    if index + 1 >= len(lines):
        return False
    return lines[index].strip().startswith("|") and re.match(
        r"^\s*\|?[\s:|-]+\|?\s*$", lines[index + 1]
    )


def parse_table(lines, index):
    rows = []
    while index < len(lines) and lines[index].strip().startswith("|"):
        raw = lines[index].strip().strip("|")
        cells = [cell.strip() for cell in raw.split("|")]
        if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            rows.append(cells)
        index += 1
    return rows, index


def setup_document(doc):
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.4)
    section.bottom_margin = Cm(2.2)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)
    section.different_first_page_header_footer = True

    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    normal.font.size = Pt(12)
    normal.font.color.rgb = INK
    normal.paragraph_format.line_spacing = 1.5

    for level, size in ((1, 16), (2, 14), (3, 12)):
        style = doc.styles[f"Heading {level}"]
        style.font.name = HEAD_FONT
        style._element.rPr.rFonts.set(qn("w:eastAsia"), HEAD_FONT)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = INK

    # 页眉（首页不显示）与页脚页码
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header.add_run("安全文件存储系统课程设计报告")
    set_run_font(run, BODY_FONT, Pt(9), color=GRAY)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run("第 ")
    set_run_font(run, BODY_FONT, Pt(9), color=GRAY)
    add_field(footer, "PAGE", "1")
    run = footer.add_run(" 页 / 共 ")
    set_run_font(run, BODY_FONT, Pt(9), color=GRAY)
    add_field(footer, "NUMPAGES", "20")
    run = footer.add_run(" 页")
    set_run_font(run, BODY_FONT, Pt(9), color=GRAY)

    # 打开文档时自动更新目录域
    settings = doc.settings.element
    update_fields = OxmlElement("w:updateFields")
    update_fields.set(qn("w:val"), "true")
    settings.append(update_fields)


def add_cover(doc, lines):
    # 顶部留白
    for _ in range(3):
        doc.add_paragraph()
    non_empty = [line.strip() for line in lines if line.strip()]
    title = non_empty[0] if non_empty else "安全文件存储系统"
    subtitle = non_empty[1] if len(non_empty) > 1 else "课程设计报告"
    rest = non_empty[2:]
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(title)
    set_run_font(run, HEAD_FONT, Pt(28), bold=True, color=INK)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(subtitle)
    set_run_font(run, HEAD_FONT, Pt(18), bold=True, color=BLUE)
    doc.add_paragraph()
    for line in rest:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.line_spacing = 1.8
        run = p.add_run(line)
        set_run_font(run, BODY_FONT, Pt(12), color=INK)


def main():
    lines = MD_PATH.read_text(encoding="utf-8").splitlines()
    doc = Document()
    setup_document(doc)
    doc.core_properties.title = "安全文件存储系统课程设计报告"
    doc.core_properties.subject = "题目3：安全文件存储系统"
    doc.core_properties.author = "【姓名】"

    index = 0
    in_cover = False
    cover_lines = []
    paragraph_buffer = []

    def flush_paragraph():
        nonlocal paragraph_buffer
        if paragraph_buffer:
            add_body_paragraph(doc, "".join(paragraph_buffer))
            paragraph_buffer = []

    while index < len(lines):
        raw = lines[index]
        line = raw.strip()

        if line == "<!-- cover -->":
            in_cover = True
            index += 1
            continue
        if line == "<!-- /cover -->":
            in_cover = False
            add_cover(doc, cover_lines)
            cover_lines = []
            index += 1
            continue
        if in_cover:
            cover_lines.append(raw)
            index += 1
            continue

        if line == "<!-- pagebreak -->":
            flush_paragraph()
            doc.add_page_break()
            index += 1
            continue
        if line == "<!-- toc -->":
            flush_paragraph()
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run("目录")
            set_run_font(run, HEAD_FONT, Pt(16), bold=True, color=INK)
            p = doc.add_paragraph()
            add_field(p, 'TOC \\o "1-3" \\h \\z \\u', "在 Word 中右键更新目录")
            p.paragraph_format.space_after = Pt(6)
            index += 1
            continue
        if line.startswith("```"):
            flush_paragraph()
            index += 1
            code = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code.append(lines[index])
                index += 1
            index += 1
            add_code_block(doc, code)
            continue
        if is_table_start(lines, index):
            flush_paragraph()
            rows, index = parse_table(lines, index)
            add_table(doc, rows)
            continue
        if line.startswith("#"):
            flush_paragraph()
            match = re.match(r"^(#{2,4})\s+(.*)$", line)
            if match:
                level = len(match.group(1)) - 1
                add_heading(doc, match.group(2), min(level, 3))
            index += 1
            continue
        image_match = re.match(r"!\[(.*?)\]\((.*?)\)", line)
        if image_match:
            flush_paragraph()
            add_image(doc, image_match.group(1), image_match.group(2))
            index += 1
            continue
        if line.startswith("表 "):
            flush_paragraph()
            add_caption(doc, line, before=True)
            index += 1
            continue
        if line.startswith(">"):
            flush_paragraph()
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(6)
            set_paragraph_shading(p, "F7F9FC")
            run = p.add_run(line.lstrip("> ").strip())
            set_run_font(run, BODY_FONT, Pt(11.5), color=INK)
            index += 1
            continue
        if not line:
            flush_paragraph()
            index += 1
            continue
        paragraph_buffer.append(line)
        index += 1

    flush_paragraph()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT_PATH)
    print("wrote", OUT_PATH)


if __name__ == "__main__":
    main()
