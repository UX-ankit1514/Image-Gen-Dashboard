"""Finding photos that may have words printed into them.

Arnifi's compliance banners are often document mock-ups with "AMENDMENT" and an authority
logo set into the artwork, so the finished card carries two headlines. Sending all 78 photos
to a vision model would be slow and wasteful; this narrows it to a handful of candidates
first, cheaply and locally.

The signal: printed matter is dark strokes sitting inside a bright field, which shows up as
a large gap between a pixel and a heavily blurred estimate of its background.
"""
import os

from PIL import Image, ImageFilter, ImageOps


def ink(path):
    """Fraction of the frame that looks like printed matter. 0 for a plain photograph."""
    try:
        im = Image.open(path).convert('RGB')
    except Exception:
        return 0.0
    im.thumbnail((900, 900), Image.LANCZOS)
    grey = ImageOps.grayscale(im)
    bg = grey.filter(ImageFilter.GaussianBlur(28))
    a, b = grey.load(), bg.load()
    w, h = grey.size
    hits = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if b[x, y] > 120 and a[x, y] < b[x, y] - 35:
                hits += 1
    return hits / float(((w + 1) // 2) * ((h + 1) // 2))


def candidates(records, base_dir, threshold=0.0, limit=40):
    """The distinct photos to put in front of Claude, worst score first.

    The score is kept for ordering and for the log, but it no longer decides anything. Three
    sets in, it has been wrong every time it was asked to judge: IFZA's mock-up scored below
    a genuine photo of people at a desk, and in the accounting set the one banner with a real
    printed headline and an authority logo - "Corporate Tax Registration", Federal Tax
    Authority - scored 0.019, the *lowest* of all 29. A threshold there would have skipped
    exactly the photo that mattered. So every distinct photo is looked at, and `limit` is the
    cost guard rather than the score.

    Identity is the source URL, not the saved filename. `download_images` numbers files per
    card, so one banner reused by three services is saved three times under three names; the
    liquidation set is 44 files but only 22 photos. Grouping by filename sent the same
    picture several times and still left most cards unjudged, so each entry carries the
    `aliases` it stands for and one look covers all of them.
    """
    groups = {}
    for r in records:
        rel = r.get('local_image')
        if not rel:
            continue
        name = os.path.basename(rel)
        key = r.get('image') or name
        g = groups.get(key)
        if g is None:
            g = groups[key] = {'photo': name,
                               'path': os.path.join(r.get('_base') or base_dir, rel),
                               'aliases': [], 'slug': r.get('slug')}
        g['aliases'].append(name)

    out = []
    for g in groups.values():
        score = ink(g['path'])
        if score >= threshold:
            g['score'] = round(score, 4)
            out.append(g)
    out.sort(key=lambda x: -x['score'])
    return out[:limit]
