"""The extra page fields Creative Studio extracts on top of the legacy record (PRD §13, §15)."""
import html as htmlmod
import re
import urllib.parse

_META = re.compile(r'<meta\s+[^>]*?(?:property|name)=["\']([^"\']+)["\'][^>]*?content=["\']([^"\']*)["\']', re.I | re.S)
_META_REV = re.compile(r'<meta\s+[^>]*?content=["\']([^"\']*)["\'][^>]*?(?:property|name)=["\']([^"\']+)["\']', re.I | re.S)
_TITLE = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)
_IMG = re.compile(r'<img\b([^>]*)>', re.I | re.S)
_ATTR = re.compile(r'([a-zA-Z:-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')', re.S)
_HREF = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\']', re.I)

SKIP_IMG = re.compile(r'(logo|icon|favicon|flag|avatar|sprite|placeholder|loader|badge|payment|whatsapp|\.svg(\?|$))', re.I)
IMG_EXT = re.compile(r'\.(png|jpe?g|webp|avif|gif)(\?|$)', re.I)


def clean(s):
    return htmlmod.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()


def meta(page):
    out = {}
    for k, v in _META.findall(page):
        out.setdefault(k.lower(), htmlmod.unescape(v).strip())
    for v, k in _META_REV.findall(page):
        out.setdefault(k.lower(), htmlmod.unescape(v).strip())
    t = _TITLE.search(page)
    if t:
        out['title'] = clean(t.group(1))
    return out


def _unwrap_next(src, base):
    """/_next/image?url=<encoded>&w=… → the original image URL."""
    u = urllib.parse.urljoin(base, htmlmod.unescape(src))
    p = urllib.parse.urlparse(u)
    if p.path.endswith('/_next/image'):
        q = urllib.parse.parse_qs(p.query)
        if q.get('url'):
            return urllib.parse.urljoin(base, q['url'][0])
    return u


def _attrs(tag):
    return {k.lower(): (a if a is not None and a != '' else b) for k, _, a, b in _ATTR.findall(tag)}


def images(page, base):
    """Every plausible content image on the page, largest srcset candidate first, deduped."""
    seen, out = set(), []
    for tag in _IMG.findall(page):
        a = _attrs(tag)
        cands = []
        srcset = a.get('srcset') or a.get('data-srcset') or ''
        if srcset:
            best, bw = None, -1
            for part in srcset.split(','):
                bits = part.strip().split()
                if not bits:
                    continue
                w = int(re.sub(r'\D', '', bits[1]) or 0) if len(bits) > 1 else 0
                if w >= bw:
                    best, bw = bits[0], w
            if best:
                cands.append(best)
        for k in ('src', 'data-src', 'data-lazy-src'):
            if a.get(k):
                cands.append(a[k])
        for c in cands:
            if c.startswith('data:'):
                continue
            u = _unwrap_next(c, base)
            if SKIP_IMG.search(u) or not IMG_EXT.search(urllib.parse.urlparse(u).path + '?'):
                continue
            if u not in seen:
                seen.add(u)
                out.append({'url': u, 'alt': clean(a.get('alt', '')), 'priority': a.get('fetchpriority') == 'high' or 'priority' in a})
            break
    return out


def related_links(page, base, pattern=r'/(product-details|services)/'):
    host = urllib.parse.urlparse(base).netloc
    seen, out = set(), []
    for href in _HREF.findall(page):
        u = urllib.parse.urljoin(base, htmlmod.unescape(href)).split('#')[0]
        p = urllib.parse.urlparse(u)
        if p.netloc != host or not re.search(pattern, p.path) or u.rstrip('/') == base.rstrip('/'):
            continue
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out[:60]


def h1(page):
    m = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S | re.I)
    return clean(m.group(1)) if m else ''
