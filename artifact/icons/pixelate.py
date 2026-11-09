# Turns the generated sprite sheet into real pixel-art icons: slices the 4×3 grid, crops each
# icon to its content, snaps it to a GRID×GRID pixel grid, keeps a few colours, and writes one
# SVG of <rect> runs per icon plus a JSON; with a page given, writes the JSON into it too.
#   python3 -I artifact/icons/pixelate.py artifact/icons/sheet.png artifact/icons [artifact/crab-sessions.html]
import json
import re
import sys
from pathlib import Path

from PIL import Image

NAMES = ['open', 'compact', 'clear', 'split', 'archive', 'hide', 'show', 'back', 'run', 'changes', 'graph', 'agent']
COLS, ROWS = 4, 3
GRID = 24
COLORS = 6
ALPHA_MIN = 128
# gpt-image-2 draws no transparency: the prompt asks for a flat magenta ground, taken out here
KEY_DISTANCE = 90


def key_out(sheet: Image.Image) -> Image.Image:
    """Makes the ground colour (read from the corners) transparent, when the sheet has none."""
    if sheet.getchannel('A').getextrema()[0] < 255:
        return sheet
    corners = [sheet.getpixel(p) for p in ((0, 0), (sheet.width - 1, 0), (0, sheet.height - 1), (sheet.width - 1, sheet.height - 1))]
    ground = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    px = sheet.load()
    for y in range(sheet.height):
        for x in range(sheet.width):
            r, g, b, _ = px[x, y]
            if abs(r - ground[0]) + abs(g - ground[1]) + abs(b - ground[2]) < KEY_DISTANCE:
                px[x, y] = (0, 0, 0, 0)
    return sheet


def cell_icon(cell: Image.Image) -> Image.Image:
    box = cell.getchannel('A').point(lambda a: 255 if a >= ALPHA_MIN else 0).getbbox()
    if box:
        cell = cell.crop(box)
    # square canvas, the icon centred, so every icon keeps its proportions on the grid
    side = max(cell.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
    # BOX averages each block: the colour a pixel-art pixel had, not one stray sample
    return square.resize((GRID, GRID), Image.Resampling.BOX)


def to_rects(icon: Image.Image) -> list[list]:
    rgb = icon.convert('RGB').quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT).convert('RGB')
    alpha = icon.getchannel('A')
    rects = []
    for y in range(GRID):
        x = 0
        while x < GRID:
            if alpha.getpixel((x, y)) < ALPHA_MIN:
                x += 1
                continue
            color = rgb.getpixel((x, y))
            start = x
            while x < GRID and alpha.getpixel((x, y)) >= ALPHA_MIN and rgb.getpixel((x, y)) == color:
                x += 1
            rects.append([start, y, x - start, '#%02x%02x%02x' % color])
    return rects


def svg(rects: list[list]) -> str:
    body = ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="{c}"/>' for x, y, w, c in rects)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID} {GRID}" shape-rendering="crispEdges">{body}</svg>'


def inject(html_path: str, data: str) -> None:
    page = Path(html_path)
    text, count = re.subn(r'/\*ICON_ART\*/[^\n]*', lambda _: '/*ICON_ART*/' + data, page.read_text())
    if count != 1:
        raise SystemExit(f'segnaposto ICON_ART non trovato in {html_path}')
    page.write_text(text)


def main(sheet_path: str, out_dir: str, html_path: str | None = None) -> None:
    sheet = key_out(Image.open(sheet_path).convert('RGBA'))
    out = Path(out_dir)
    cw, ch = sheet.width // COLS, sheet.height // ROWS
    icons = {}
    for i, name in enumerate(NAMES):
        col, row = i % COLS, i // COLS
        icon = cell_icon(sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)))
        rects = to_rects(icon)
        icons[name] = rects
        (out / f'{name}.svg').write_text(svg(rects))
        icon.resize((GRID * 8, GRID * 8), Image.Resampling.NEAREST).save(out / f'{name}.preview.png')
    data = json.dumps({'grid': GRID, 'icons': icons}, separators=(',', ':'))
    (out / 'icons.json').write_text(data)
    if html_path:
        inject(html_path, data)
    print(f'{len(icons)} icone in {out}' + (f', inserite in {html_path}' if html_path else ''))


if __name__ == '__main__':
    main(*sys.argv[1:4])
