# Post-processing for the README screenshots taken by shots.mjs (docs/img), in place:
# screens get rounded corners and a thin edge, Esteban with his bubble becomes a sticker on a transparent background.
# Usage: python3 frame.py [DIR]
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from scipy.ndimage import binary_fill_holes

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / 'docs/img')
WIDTH, RADIUS, EDGE = 1600, 22, (200, 204, 208, 255)


def done(im):
    # Already processed: the top-left corner is transparent.
    return im.mode == 'RGBA' and im.getpixel((0, 0))[3] == 0


def screen(path):
    im = Image.open(path)
    if done(im):
        return
    im = im.convert('RGB')
    if im.width > WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    # Supersampled rounded mask for a smooth corner.
    s = 4
    big = Image.new('L', (im.width * s, im.height * s), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, big.width - 1, big.height - 1), RADIUS * s, fill=255)
    mask = big.resize(im.size, Image.LANCZOS)
    rgba = im.convert('RGBA')
    edge = Image.new('L', (im.width * s, im.height * s), 0)
    ImageDraw.Draw(edge).rounded_rectangle((0, 0, edge.width - 1, edge.height - 1), RADIUS * s, outline=255, width=2 * s)
    rgba = Image.composite(Image.new('RGBA', im.size, EDGE), rgba, edge.resize(im.size, Image.LANCZOS))
    rgba.putalpha(mask)
    rgba.save(path, optimize=True)


def sticker(path, pad=18):
    im = Image.open(path)
    if done(im):
        return
    im = im.convert('RGB')
    # Trim the white around the drawing, leaving room for the contour.
    im = im.crop(ImageChops.difference(im, Image.new('RGB', im.size, 'white')).getbbox())
    m = pad * 2
    framed = Image.new('RGB', (im.width + 2 * m, im.height + 2 * m), 'white')
    framed.paste(im, (m, m))
    im = framed
    ink = np.array(im.convert('L')) < 215
    # Silhouette: ink grown by `pad` px with a smooth edge, holes filled (the bubble, between the arms).
    grown = np.array(Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(pad / 2))) > 8
    grown = binary_fill_holes(grown)
    sil = Image.fromarray((grown * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    # A thin grey line just inside the silhouette edge, like a cut-out sticker.
    inner = sil.filter(ImageFilter.MinFilter(5))
    line = ImageChops.subtract(sil, inner)
    body = Image.new('RGBA', im.size, (255, 255, 255, 0))
    body.paste(im.convert('RGBA'), (0, 0), sil)
    body = Image.composite(Image.new('RGBA', im.size, (190, 194, 198, 255)), body, line.point(lambda v: v * 0.8))
    body.putalpha(sil)
    # Soft shadow under the sticker.
    shadow = Image.new('RGBA', im.size, (0, 36, 57, 0))
    shadow.putalpha(sil.filter(ImageFilter.GaussianBlur(6)).point(lambda v: v * 0.22))
    canvas = Image.new('RGBA', im.size, (0, 0, 0, 0))
    canvas.alpha_composite(shadow, (0, 4))
    canvas.alpha_composite(body)
    canvas.save(path, optimize=True)


for p in sorted(out.glob('*.png')):
    if p.name == 'esteban-usual.png':
        sticker(p)
    elif p.name != 'esteban-assistant.png':
        screen(p)
print('framed', out)
