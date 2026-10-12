"""Turning an Arnifi URL into normalised card records.

The universal rule, unchanged from the 188 cards already shipped:
    background photo <- the page's own banner image
    headline         <- the detail page's <h1>
    key line         <- the first entry under "Highlights & Benefits"
"""
import concurrent.futures as cf
import html
import os
import re
import urllib.parse
import urllib.request

from PIL import Image

import detect
from flight import objects, payload

# Arnifi's will-drafting banners are 21328x11396 PNGs - 243 megapixels for a web banner.
# Pillow refuses anything over ~179MP as a decompression bomb, which killed the run before
# a card was drawn, and Chrome takes minutes over one. Anything past this gets resampled to
# LONG_EDGE on the way in; the card is 1600x1000, so nothing visible is lost.
Image.MAX_IMAGE_PIXELS = 400_000_000
HUGE_PIXELS = 60_000_000
LONG_EDGE = 4000

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
TIMEOUT = 120


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=TIMEOUT).read().decode('utf-8', 'replace')


def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<!--.*?-->', '', s or ''))).strip()


def _dig(o, *path):
    for k in path:
        if isinstance(o, list):
            o = o[k] if len(o) > k else None
        elif isinstance(o, dict):
            o = o.get(k)
        else:
            return None
    return o


def _record(o, d, kind):
    """The one normalised shape. `product` and `service` records differ only in naming."""
    if kind == 'product':
        r = dict(
            name=(o.get('productName') or '').strip(),
            slug=o.get('slug'),
            authority=_dig(o, 'authority_name', 'AuthorityName'),
            country=_dig(o, 'country', 'countryName'),
            flag=_dig(o, 'country', 'countryFlag', 'url'),
            image=_dig(o, 'productBanner', 'SliderImages', 0, 'url'),
            price=o.get('starting_price') or o.get('startingArnifiPrice'),
            currency=o.get('currency') or _dig(o, 'country', 'currency'),
            est_time=None,
            category=o.get('productType'),
        )
    else:
        # Two service shapes. Post-setup/liquidation/accounting use bottomTitle + badgeLabel;
        # Attestation uses topTitle and carries its country in `chips`, which left every
        # attestation record nameless and countryless until this fallback existed.
        chip = _dig(o, 'chips', 0) or {}
        r = dict(
            name=((o.get('bottomTitle') or o.get('topTitle') or '')).strip(),
            slug=o.get('slug'),
            authority=((o.get('bottomSubTitle') or o.get('topSubTitle') or '')).strip() or None,
            country=((o.get('badgeLabel') or chip.get('label') or '')).strip() or None,
            flag=o.get('badgeIcon') or chip.get('icon'),
            image=o.get('banner'),
            price=o.get('startingPrice'),
            currency=o.get('currency'),
            est_time=o.get('estimatedDeliveryTime'),
            category=o.get('type'),
        )
    if r['slug']:
        r['url'] = detect.detail_url(d, r['slug'], r.get('authority'), o.get('productType'))
        r['url_fallback'] = detect.short_detail_url(d, r['slug'])
    else:
        r['url'] = d['url']
        r['url_fallback'] = None
    r['h1'] = None
    r['highlights'] = []
    r['local_image'] = None
    return r


def listing(d, log=lambda *a: None):
    """All records on a listing page. `pageSize=100` means no 'Load More' to click."""
    url = detect.listing_url(d)
    buf = payload(fetch(url))
    key = 'product' if d['kind'] == detect.LISTING_PRODUCT else 'service'
    seen, out = set(), []
    for o in objects(buf, key):
        if not o.get('slug') or o['slug'] in seen:
            continue
        seen.add(o['slug'])
        out.append(_record(o, d, key))
    log('listing', '%d found' % len(out))
    return url, out


def single(d):
    """A record for a link that is already a detail page."""
    key = 'product' if d['kind'] == detect.DETAIL_PRODUCT else 'service'
    buf = payload(fetch(d['url']))
    for o in objects(buf, key):
        if o.get('slug') == d['slug']:
            return [_record(o, d, key)]
    # the record is not always inlined on its own page; fall back to the bare minimum
    r = _record({'slug': d['slug']}, d, key)
    r['name'] = d['slug'].replace('-', ' ').title()
    return [r]


HL_END = ('Documents from', 'PROCESS FLOW', 'Process Flow', 'FAQs', 'Frequently')


def parse_detail(page, fallback):
    """<h1> plus the Highlights & Benefits list, in either of the two markups Arnifi uses."""
    m = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S)
    h1 = clean(m.group(1)) if m else ''
    a0 = page.lower().find('highlights')
    hl = []
    if a0 > 0:
        ends = [e for e in (page.find(k, a0) for k in HL_END) if e > a0]
        seg = page[a0:min(ends) if ends else a0 + 9000]
        titles = [x for x in (clean(x) for x in re.findall(r'<h3[^>]*>(.*?)</h3>', seg, re.S)) if x]
        if titles:
            hl = [dict(title=t, desc='') for t in titles]
        else:  # older markup: h2 title + p description pairs
            text = re.sub(r'\|+', '\n', html.unescape(re.sub(r'<[^>]+>', '|', seg)))
            lines = [x.strip() for x in text.split('\n') if x.strip()][1:]
            hl = [dict(title=t, desc=(lines[i * 2 + 1] if i * 2 + 1 < len(lines) else ''))
                  for i, t in enumerate(lines[0::2])]
    return (h1 or fallback), hl


def enrich(records, workers=6, log=lambda *a: None):
    """Fetch every detail page for the h1 and the highlights."""
    done = [0]

    def one(r):
        urls = [u for u in (r['url'], r.get('url_fallback')) if u]
        for i, u in enumerate(urls):
            try:
                r['h1'], r['highlights'] = parse_detail(fetch(u), r['name'])
                r['url'] = u
                break
            except Exception as exc:      # a dead page must not kill the run; try the
                if i == len(urls) - 1:    # short URL shape before giving up on it
                    r['h1'], r['highlights'] = r['name'], []
                    log('warn', 'detail page failed: %s (%s)' % (u, exc))
        done[0] += 1
        log('progress', done[0], len(records))
        return r

    with cf.ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, records))


def _shrink_if_huge(path, log=lambda *a: None):
    """Resample a wildly oversized source photo in place. See HUGE_PIXELS above."""
    try:
        with Image.open(path) as im:
            w, h = im.size
            if w * h <= HUGE_PIXELS:
                return
            im = im.convert('RGB') if im.mode not in ('RGB', 'L') else im
            scale = float(LONG_EDGE) / max(w, h)
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        im.save(path)
        log('warn', 'source photo was %dx%d (%.0f megapixels), resampled to %dx%d: %s'
            % (w, h, w * h / 1e6, im.size[0], im.size[1], os.path.basename(path)))
    except Exception as exc:
        log('warn', 'could not resample oversized photo %s (%s)' % (os.path.basename(path), exc))


def download_images(records, folder, start=1, workers=6, log=lambda *a: None):
    os.makedirs(folder, exist_ok=True)
    done = [0]

    def one(i_r):
        i, r = i_r
        if r.get('image'):
            ext = os.path.splitext(urllib.parse.urlparse(r['image']).path)[1] or '.jpg'
            name = '%02d_%s%s' % (i, (r['slug'] or 'item')[:56], ext)
            path = os.path.join(folder, name)
            try:
                if not (os.path.exists(path) and os.path.getsize(path) > 0):
                    req = urllib.request.Request(r['image'], headers=UA)
                    with open(path, 'wb') as fh:
                        fh.write(urllib.request.urlopen(req, timeout=TIMEOUT).read())
                _shrink_if_huge(path, log)
                r['local_image'] = os.path.join(os.path.basename(folder), name)
            except Exception as exc:
                log('warn', 'photo failed: %s (%s)' % (r['image'], exc))
        done[0] += 1
        log('progress', done[0], len(records))
        return r

    with cf.ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, enumerate(records, start)))
