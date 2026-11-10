# The "move to the app" icon, drawn by hand on the same 24×24 grid as the generated set: a
# terminal, a bold arrow out of it and the app window it lands in. Writes desktop.svg and its
# preview and adds the icon to icons.json; with a page given, writes the JSON into it too.
#   python3 -I artifact/icons/desktop.py artifact/icons [artifact/crab-sessions.html]
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

PALETTE = {
    'o': '#080008',  # outline
    'g': '#81857f',  # bezel
    's': '#5c605a',  # bezel shade
    'k': '#131516',  # terminal screen
    'p': '#86c45a',  # prompt
    'b': '#384964',  # title bar
    'B': '#5878c0',  # title bar highlight
    'w': '#e0effc',  # window body
    'W': '#b7c7d8',  # window body shade
    'A': '#6cc24a',  # arrow
    'h': '#b4ec7c',  # arrow highlight
    'a': '#2f7a24',  # arrow shade
}

# '.' is transparent; each layer is drawn over the one before
TERMINAL = [
    'ooooooooooooo',
    'ogggggggggggo',
    'ogkkkkkkkkkso',
    'ogkpkkkkkkkso',
    'ogkkpkkkkkkso',
    'ogkkkpkkkkkso',
    'ogkkpkkkkkkso',
    'ogkpkkppppkso',
    'ogkkkkkkkkkso',
    'ogsssssssssso',
    'ooooooooooooo',
]
WINDOW = [
    'ooooooooooooooooo',
    'oBBBBBBBBBBBBBBbo',
    'obbbbbbbbbbbbbbbo',
    'ooooooooooooooooo',
    'owwwwwwwwwwwwwwWo',
    'owwwwwwwwwwwwwwWo',
    'owwwwwwwwwwwwwwWo',
    'owwwwwwwwwwwwwwWo',
    'owwwwwwwwwwwwwwWo',
    'owwwwwwwwwwwwwwWo',
    'owwwwwwwwwwwwwwWo',
    'oWWWWWWWWWWWWWWWo',
    'ooooooooooooooooo',
]
ARROW = [
    'oooooooooo...',
    'hhhhhhhhho...',
    'AAAAAAhAao...',
    'aaaaaahAao...',
    'oooooohAao...',
    '.....ohAao...',
    '.....ohAao...',
    '..oooohAaoooo',
    '...ohhAAAaao.',
    '....ohAAaao..',
    '.....ohAao...',
    '......oao....',
    '.......o.....',
]


def draw() -> list[list[str]]:
    grid = [['.'] * 24 for _ in range(24)]
    for layer, (left, top) in ((TERMINAL, (0, 0)), (WINDOW, (7, 11)), (ARROW, (11, 1))):
        for dy, line in enumerate(layer):
            for dx, ch in enumerate(line):
                if ch != '.':
                    grid[top + dy][left + dx] = ch
    return grid


def main(out_dir: str, html_path: str | None = None) -> None:
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('pixelate', here / 'pixelate.py')
    assert spec and spec.loader
    pixelate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pixelate)

    grid = draw()
    rects = []
    for y, row in enumerate(grid):
        x = 0
        while x < 24:
            ch = row[x]
            start = x
            while x < 24 and row[x] == ch:
                x += 1
            if ch != '.':
                rects.append([start, y, x - start, PALETTE[ch]])

    out = Path(out_dir)
    (out / 'desktop.svg').write_text(pixelate.svg(rects))
    img = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
    for x, y, w, color in rects:
        for i in range(w):
            img.putpixel((x + i, y), tuple(int(color[j:j + 2], 16) for j in (1, 3, 5)) + (255,))
    img.resize((24 * 8, 24 * 8), Image.Resampling.NEAREST).save(out / 'desktop.preview.png')

    data = json.loads((out / 'icons.json').read_text())
    data['icons']['desktop'] = rects
    text = json.dumps(data, separators=(',', ':'))
    (out / 'icons.json').write_text(text)
    if html_path:
        pixelate.inject(html_path, text)
    print('desktop in icons.json' + (f', inserita in {html_path}' if html_path else ''))


if __name__ == '__main__':
    main(*sys.argv[1:3])
