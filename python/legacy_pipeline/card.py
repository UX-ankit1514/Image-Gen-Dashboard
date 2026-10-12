"""The card template - the single source of truth for all Arnifi hero cards.

The CSS below is the exact stylesheet the 188 shipped cards were rendered with, lifted
from arnifi-hero-cards/build_real.py. It is a PLAIN string with real braces: the two
older builders regex it out of that file's f-string body and had to un-double the
escapes by hand, which is what silently blanked 28 country cards. Nothing here is an
f-string, so that failure mode cannot come back.
"""
import html
import os
import re

W, H, SCALE, BATCH = 1600, 1000, 2, 5
OUT_W, OUT_H = 1600, 1000
JPEG = dict(quality=91, subsampling=0, optimize=True, progressive=True)
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
BRAND = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'brand')

# Arnifi reuses one authority photo across many products, so repeats of the same file
# get a different focal point rather than N identical-looking cards.
FOCUS = ['center 42%', '32% 46%', '68% 38%', '46% 30%', '58% 55%', '24% 34%', '76% 50%']

_CSS_TEMPLATE = """\
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:{W}px;overflow:hidden;background:#0b0922}
body{font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.card{position:relative;width:{W}px;height:{H}px;overflow:hidden;background:#0b0922}
.photo{position:absolute;inset:0}
.photo img{width:100%;height:100%;object-fit:cover;object-position:center 42%;
  filter:saturate(.60) contrast(1.07) brightness(.86)}
/* ---- the universal brand wash: identical on every card ---- */
.wash{position:absolute;inset:0;mix-blend-mode:multiply;
  background:linear-gradient(130deg,rgba(52,45,124,.70) 0%,rgba(84,74,148,.46) 44%,rgba(46,46,163,.58) 100%)}
.tone{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(16,13,50,.46) 0%,rgba(16,13,50,.08) 30%,rgba(13,11,42,.52) 68%,rgba(10,8,32,.88) 100%)}
.side{position:absolute;inset:0;
  background:linear-gradient(90deg,rgba(10,8,34,.66) 0%,rgba(10,8,34,.18) 42%,rgba(10,8,34,0) 66%)}
.vig{position:absolute;inset:0;
  background:radial-gradient(118% 94% at 62% 32%,rgba(0,0,0,0) 44%,rgba(8,6,30,.58) 100%)}
.grain{position:absolute;inset:0;background-image:url(brand/grain.png);background-size:256px 256px;
  opacity:.05;mix-blend-mode:overlay}
.logo{position:absolute;top:52px;left:64px;width:196px;height:55px;
  filter:drop-shadow(0 2px 12px rgba(0,0,0,.55))}
.content{position:absolute;left:64px;right:120px;bottom:64px}
.kicker{display:flex;align-items:center;gap:13px;margin-bottom:20px}
.kicker span{font-size:16px;font-weight:600;letter-spacing:.17em;text-transform:uppercase;color:#d3ceff;
  text-shadow:0 1px 10px rgba(0,0,0,.65)}
.kicker::before{content:"";width:38px;height:2px;background:#a79eff;flex:none}
h1{font-family:Lora,serif;font-weight:500;line-height:1.19;color:#fff;letter-spacing:-.005em;
  text-shadow:0 2px 26px rgba(5,3,24,.78),0 1px 3px rgba(5,3,24,.5)}
.rule{margin-top:26px;width:96px;height:3px;border-radius:2px;
  background:linear-gradient(90deg,#a79eff,rgba(167,158,255,0))}"""

CSS = (_CSS_TEMPLATE
       .replace('{W}', str(W))
       .replace('{H}', str(H))
       .replace('url(brand/grain.png)', 'url(file://' + BRAND + '/grain.png)'))
assert '{{' not in CSS and '.wash{' in CSS and '{W}' not in CSS, 'CSS did not normalise'

LOGO = re.sub(r'<svg ', '<svg class="logo" ',
              open(os.path.join(BRAND, 'arnifi-logo.svg')).read(),
              count=1).replace('#2E2EA3', '#FFFFFF')
FONTS_HREF = 'file://' + BRAND + '/fonts-local.css'


def esc(s):
    return html.escape(s or '')


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')[:64]


def fsize(t):
    """Headline size ladder - longer headlines step down so the block stays one shape."""
    n = len(t or '')
    return 66 if n <= 34 else 58 if n <= 48 else 52 if n <= 62 else 46


def kicker(p):
    """The small caps line.

    The page's first Highlights & Benefits entry, unless the editorial pass picked a more
    specific one or wrote one because the page had no Highlights at all.
    """
    hl = p.get('highlights') or []
    k = p.get('ai_key_line') or (hl[0].get('title') if hl else None) \
        or p.get('authority') or p.get('country')
    return re.sub(r'[\s:;,.\-]+$', '', k or '')


def card(p, image_path, focus='center 42%'):
    """One card's markup. Photo, headline and key line all come from the page."""
    src = 'file://' + os.path.abspath(image_path)
    t = p.get('h1') or p.get('name') or ''
    return ('<div class="card">\n'
            '  <div class="photo"><img src="' + esc(src) + '" alt=""'
            ' style="object-position:' + focus + '"></div>\n'
            '  <div class="wash"></div><div class="tone"></div><div class="side"></div>\n'
            '  <div class="vig"></div><div class="grain"></div>\n'
            '  ' + LOGO + '\n'
            '  <div class="content">\n'
            '    <div class="kicker"><span>' + esc(kicker(p)) + '</span></div>\n'
            '    <h1 style="font-size:' + str(fsize(t)) + 'px">' + esc(t) + '</h1>\n'
            '    <div class="rule"></div>\n'
            '  </div>\n'
            '</div>')


def document(cards):
    """A batch of cards stacked in one page, screenshotted in a single Chrome run."""
    return ('<!doctype html><html><head><meta charset="utf-8">'
            '<link rel="stylesheet" href="' + FONTS_HREF + '">'
            '<style>' + CSS + '</style></head><body>' + ''.join(cards) + '</body></html>')


def fit_crop(region, size, min_width=700):
    """The largest 16:10 box that fits inside a clear region of a photo.

    Claude reports where a photo is free of printed text; the card still has to be 1600x1000,
    so the geometry is settled here rather than by the model. Returns a pixel box for
    Image.crop, or None when the clear area is too small to fill the frame without the
    upscaling becoming visible.
    """
    if not region:
        return None
    iw, ih = size
    x = max(0.0, float(region.get('x', 0))) * iw
    y = max(0.0, float(region.get('y', 0))) * ih
    w = min(1.0, float(region.get('w', 1))) * iw
    h = min(1.0, float(region.get('h', 1))) * ih
    w = min(w, iw - x)
    h = min(h, ih - y)
    if w <= 0 or h <= 0:
        return None
    ar = float(OUT_W) / OUT_H
    # fit inside the region: the shorter dimension relative to 16:10 is the limit
    cw, ch = (h * ar, h) if w / h > ar else (w, w / ar)
    if cw < min_width:
        return None
    cx = x + (w - cw) / 2.0
    cy = y + (h - ch) / 2.0
    return (int(round(cx)), int(round(cy)), int(round(cx + cw)), int(round(cy + ch)))
