"""Rendering records into cards.

Batches of BATCH cards are stacked into one HTML page and screenshotted in a single
headless Chrome run at 2x, then sliced and downsampled with Lanczos - far faster than
one Chrome process per card, and the supersample keeps the type crisp over low-res photos.
"""
import collections
import math
import os
import subprocess

from PIL import Image, ImageStat

import card as T


def _looks_styled(im):
    """Guard against the failure that silently blanked 28 cards once: if the stylesheet
    does not apply, the photo shows through raw - the headline area is not dark and the
    logo area is not light. Cheap to check, and it fails the run instead of the eye."""
    bottom_left = sum(ImageStat.Stat(im.crop((60, 780, 700, 940))).mean) / 3
    logo = sum(ImageStat.Stat(im.crop((64, 52, 260, 110))).mean) / 3
    return bottom_left <= 118 and logo >= 55


def prepare_crops(records, base_dir, work_dir):
    """Write cropped copies of any photo the editorial pass said to crop.

    Cropping happens here rather than in CSS so the Lanczos downsample still runs on real
    pixels. fit_crop refuses a region too small to fill the frame, in which case the photo
    is used whole and only the flag survives.
    """
    made = 0
    for r in records:
        region = r.get('crop')
        if not region or not r.get('local_image'):
            continue
        src = os.path.join(base_dir, r['local_image'])
        try:
            im = Image.open(src).convert('RGB')
            box = T.fit_crop(region, im.size)
            if not box:
                continue
            os.makedirs(work_dir, exist_ok=True)
            dst = os.path.join(work_dir, os.path.basename(r['local_image']) + '.crop.png')
            im.crop(box).save(dst)
            r['_render_image'] = dst
            made += 1
        except Exception:
            continue
    return made


def assign_focus(records, vary=True):
    """Repeats of one photo get different framing so the set is not visibly copy-pasted."""
    seen = collections.Counter()
    for r in records:
        key = os.path.basename(r.get('image') or '')
        r['_focus'] = T.FOCUS[seen[key] % len(T.FOCUS)] if (vary and key) else T.FOCUS[0]
        seen[key] += 1
    return records


def render(records, base_dir, out_dir, start=1, resume=True, log=lambda *a: None):
    """Render every record with a local photo. Returns the list of files written."""
    os.makedirs(out_dir, exist_ok=True)
    usable = [r for r in records if r.get('local_image')]
    for r in records:
        if not r.get('local_image'):
            log('warn', 'no photo, card skipped: %s' % (r.get('name') or r.get('slug')))

    names = ['%02d_%s.jpg' % (start + i, T.slug(r.get('slug') or r.get('name')))
             for i, r in enumerate(usable)]
    written, batches = [], math.ceil(len(usable) / T.BATCH) or 1

    for b in range(0, len(usable), T.BATCH):
        group = usable[b:b + T.BATCH]
        group_names = names[b:b + T.BATCH]
        paths = [os.path.join(out_dir, n) for n in group_names]

        if resume and all(os.path.exists(p) for p in paths):
            written.extend(group_names)
            log('progress', len(written), len(usable))
            continue

        html_path = os.path.join(out_dir, '_batch%03d.html' % b)
        png_path = os.path.join(out_dir, '_batch%03d.png' % b)
        doc = T.document([T.card(r, r.get('_render_image') or os.path.join(base_dir, r['local_image']),
                                 r.get('_focus', T.FOCUS[0])) for r in group])
        with open(html_path, 'w') as fh:
            fh.write(doc)

        subprocess.run([T.CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--force-device-scale-factor=%d' % T.SCALE,
                        '--window-size=%d,%d' % (T.W, T.H * len(group)),
                        '--virtual-time-budget=30000',
                        '--screenshot=%s' % png_path,
                        'file://' + os.path.abspath(html_path)],
                       capture_output=True)
        if not os.path.exists(png_path):
            raise RuntimeError('Chrome produced no screenshot for batch %d' % (b // T.BATCH + 1))

        sheet = Image.open(png_path).convert('RGB')
        for i, path in enumerate(paths):
            y = i * T.H * T.SCALE
            im = sheet.crop((0, y, T.W * T.SCALE, y + T.H * T.SCALE)).resize(
                (T.OUT_W, T.OUT_H), Image.LANCZOS)
            if not _looks_styled(im):
                raise RuntimeError(
                    'card rendered unstyled (%s) - the stylesheet or brand assets did not '
                    'load; refusing to write a broken set' % os.path.basename(path))
            im.save(path, **T.JPEG)
            written.append(os.path.basename(path))

        os.remove(png_path)
        os.remove(html_path)
        log('progress', len(written), len(usable))
        log('phase', 'render', 'batch %d/%d' % (b // T.BATCH + 1, batches))

    return written


def contact_sheet(files, out_path, cols=6, tw=520, th=325):
    if not files:
        return None
    rows = math.ceil(len(files) / cols)
    sheet = Image.new('RGB', (cols * tw, rows * th), (11, 9, 34))
    for i, f in enumerate(files):
        sheet.paste(Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS),
                    ((i % cols) * tw, (i // cols) * th))
    sheet.save(out_path, quality=88, optimize=True, progressive=True)
    return out_path
