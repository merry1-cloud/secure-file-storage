from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path.cwd()
SHOTS = ROOT / "docs/report-assets/screenshots"
OUT = ROOT / "docs/report-assets/figures/fig-3-3-test-evidence.png"

FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")
font = ImageFont.truetype(str(FONT_PATH), 30) if FONT_PATH.exists() else ImageFont.load_default()
small = ImageFont.truetype(str(FONT_PATH), 22) if FONT_PATH.exists() else ImageFont.load_default()

items = [
    ("t01-wrong-password.png", (330, 80, 1115, 700), "T01  错误口令：E_WRONG_PASSWORD"),
    ("t02-tamper-ciphertext.png", (225, 720, 1420, 1430), "T02  密文篡改：E_AUTH_TAG"),
    ("t03-tamper-signature.png", (225, 720, 1420, 1430), "T03  替换签名：E_SIGNATURE"),
    ("t04-imported-decrypt.png", (320, 75, 1125, 735), "T04  拖拽导入后解密：哈希校验通过"),
]

PANEL_W = 780
HEADER_H = 48
GAP = 28
MARGIN = 28

panels = []
for filename, crop_box, title in items:
    image = Image.open(SHOTS / filename).convert("RGB")
    panel = image.crop(crop_box)
    ratio = PANEL_W / panel.width
    panel = panel.resize((PANEL_W, int(panel.height * ratio)), Image.LANCZOS)
    canvas = Image.new("RGB", (PANEL_W, HEADER_H + panel.height), "white")
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, PANEL_W, HEADER_H), fill=(31, 79, 143))
    draw.text((14, 8), title, font=font, fill="white")
    canvas.paste(panel, (0, HEADER_H))
    draw.rectangle((0, 0, PANEL_W - 1, canvas.height - 1), outline=(200, 208, 218), width=2)
    panels.append(canvas)

row1 = panels[:2]
row2 = panels[2:]
row1_h = max(p.height for p in row1)
row2_h = max(p.height for p in row2)
width = MARGIN * 2 + PANEL_W * 2 + GAP
height = MARGIN * 2 + row1_h + row2_h + GAP
out = Image.new("RGB", (width, height), "white")
for index, panel in enumerate(row1):
    out.paste(panel, (MARGIN + index * (PANEL_W + GAP), MARGIN))
for index, panel in enumerate(row2):
    out.paste(panel, (MARGIN + index * (PANEL_W + GAP), MARGIN + row1_h + GAP))
out.save(OUT, quality=95)
print("wrote", OUT, out.size)
