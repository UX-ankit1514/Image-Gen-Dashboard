"""The light cinematic gradient - generated, not drawn.

Writes two PNGs into assets/, both 3200 x 2000 (the 2x render size of a 1600 x 1000 card):

  light-tint.png   RGBA, normal blend. Colour + alpha field: periwinkle top-left, powder
                   blue top-centre, blush/peach top-right, lavender haze in the middle,
                   indigo grounding in the lower 20-30% (heaviest bottom-left for the
                   headline). This is the "gradient asset" the brief describes.
  light-grade.png  RGBA, the same colour field with a sky-weighted alpha. relight.py lays
                   it twice under the tint: once as `color` (hue shift toward the palette)
                   and once as `multiply` (deepens the sky to periwinkle). Buildings keep
                   their own warm light because this alpha fades out below the horizon.

The field is defined on a coarse grid of control points (the colours from the brief),
interpolated, blurred heavily so there are no kinks or seams, and quantised with a
sub-LSB dither so 8-bit output shows no bands. No grain, no texture, no radial glow.

    python3 gradient.py            # writes assets/light-tint.png, assets/light-grade.png
    python3 gradient.py --preview  # also writes assets/light-gradient-preview.png
"""
import os
import sys

import numpy as np
from PIL import Image

W, H = 3200, 2000
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')

# ---- control grid: columns at x = 0 / .5 / 1, rows down the frame -------------------
# Tuned side by side against assets/reference-light.png on the Dubai Mainland card, then
# checked on the brightest and darkest photos in the set for headline legibility.
XS = [0.0, 0.5, 1.0]
#        y      left        centre      right
COLOR = [
    (0.00, ('#6685D4', '#9FAEE4', '#E7C1C5')),   # periwinkle | powder blue | blush
    (0.30, ('#7487D3', '#A7A6DC', '#F1C9B8')),   # sunset peach sits on the right horizon
    (0.50, ('#A6A5CF', '#AFABD0', '#B8B1D0')),   # lavender haze
    (0.68, ('#4E4F8C', '#5E5C96', '#6C68A0')),   # start of the indigo descent
    (0.84, ('#2A2C62', '#323469', '#3A3C72')),
    (1.00, ('#232656', '#282B5E', '#30336A')),   # deep indigo / navy-violet
]
# light-tint.png alpha (normal blend): almost nothing over the upper 60%, indigo below.
ALPHA = [
    (0.00, (0.16, 0.10, 0.12)),
    (0.30, (0.06, 0.04, 0.14)),   # photo fully readable; a breath of peach on the right
    (0.45, (0.06, 0.05, 0.10)),
    (0.60, (0.30, 0.14, 0.10)),   # bottom-left starts earlier and runs deeper ...
    (0.72, (0.58, 0.36, 0.26)),
    (0.86, (0.86, 0.70, 0.58)),   # ... than bottom-right, for white text over photography
    (1.00, (0.94, 0.88, 0.82)),
]
# light-grade.png alpha (colour + multiply blends): concentrated in the sky, so the sky
# takes the periwinkle -> blush palette while buildings keep their own warm light.
GRADE_ALPHA = [
    (0.00, (0.85, 0.70, 0.55)),
    (0.30, (0.60, 0.40, 0.40)),
    (0.45, (0.25, 0.15, 0.20)),
    (0.60, (0.12, 0.06, 0.08)),
    (0.80, (0.25, 0.15, 0.12)),
    (1.00, (0.40, 0.30, 0.25)),
]


def _hex(c):
    c = c.lstrip('#')
    return [int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]


def _grid(rows, decode):
    ys = np.array([r[0] for r in rows])
    vals = np.array([[decode(v) for v in r[1]] for r in rows], dtype=np.float64)  # (ny, nx, ...)
    return ys, vals


def _interp(ys, vals, w, h):
    """Piecewise-linear on the control grid, evaluated at w x h."""
    gx = np.linspace(0, 1, w)
    gy = np.linspace(0, 1, h)
    # along x for every control row
    rows = np.stack([np.stack([np.interp(gx, XS, vals[r, :, k]) for k in range(vals.shape[2])], -1)
                     for r in range(vals.shape[0])])                    # (ny, w, C)
    out = np.empty((h, w, vals.shape[2]))
    for k in range(vals.shape[2]):
        for i in range(w):
            out[:, i, k] = np.interp(gy, ys, rows[:, i, k])
    return out


def _blur(a, sigma):
    """Separable gaussian with reflected edges - removes every kink the linear grid leaves."""
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r, r)
        p = np.pad(a, pad, mode='reflect')
        a = np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), axis, p)
    return a


def field(alpha=None, w=W, h=H):
    """(h, w, 4) float array: RGB colour field + an alpha field (ALPHA by default), 0..1."""
    lw, lh = 320, 200                                  # low-res working field
    ys, cv = _grid(COLOR, _hex)
    ya, av = _grid(alpha or ALPHA, lambda v: [v])
    lo = np.concatenate([_interp(ys, cv, lw, lh), _interp(ya, av, lw, lh)], -1)
    lo = _blur(lo, sigma=14)                           # ~7% of frame height
    chans = [np.asarray(Image.fromarray(lo[..., k].astype(np.float32)).resize((w, h), Image.BICUBIC))
             for k in range(4)]
    return np.clip(np.stack(chans, -1), 0, 1)


def quantise(a, seed=7):
    """8-bit with a +-0.5 LSB triangular dither: kills banding, far below visible grain."""
    rng = np.random.default_rng(seed)
    d = (rng.random(a.shape) - rng.random(a.shape)) * 0.5
    return np.clip(np.round(a * 255 + d), 0, 255).astype(np.uint8)


def build(preview=False):
    os.makedirs(ASSETS, exist_ok=True)
    f = field()
    g = field(GRADE_ALPHA)
    Image.fromarray(quantise(f)).save(os.path.join(ASSETS, 'light-tint.png'), optimize=True)
    Image.fromarray(quantise(g)).save(os.path.join(ASSETS, 'light-grade.png'), optimize=True)
    # 2:1 services banner (relight.py wide): same field, 2x of 1920 x 960
    Image.fromarray(quantise(field(w=3840, h=1920))).save(os.path.join(ASSETS, 'light-tint-wide.png'), optimize=True)
    Image.fromarray(quantise(field(GRADE_ALPHA, 3840, 1920))).save(os.path.join(ASSETS, 'light-grade-wide.png'),
                                                                     optimize=True)
    if preview:   # the tint as it reads over flat mid-grey, for eyeballing the asset alone
        base = np.full(f[..., :3].shape, 0.62)
        comp = f[..., :3] * f[..., 3:] + base * (1 - f[..., 3:])
        Image.fromarray(quantise(comp)).resize((1600, 1000), Image.LANCZOS).save(
            os.path.join(ASSETS, 'light-gradient-preview.png'))
    return f


if __name__ == '__main__':
    build(preview='--preview' in sys.argv)
    print('wrote', ', '.join(sorted(os.listdir(ASSETS))))
