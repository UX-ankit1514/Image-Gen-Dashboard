"""The source-material problems worth surfacing rather than discovering by eye later.

Every one of these has actually bitten a previous run: a photo shared by ten services, a
628px banner upscaled 2.5x, a product priced AED 0, a page with no Highlights so the card
falls back to the authority name.
"""
import collections
import os

from PIL import Image


def audit(records, base_dir):
    out = []
    photos = collections.Counter(os.path.basename(r['image']) for r in records if r.get('image'))

    for name, n in photos.most_common():
        if n > 1:
            users = [r['name'] for r in records
                     if r.get('image') and os.path.basename(r['image']) == name]
            out.append(dict(code='shared_photo', severity='warning',
                            message='One photo is the background for %d cards' % n,
                            detail=name, items=users[:12]))

    for r in records:
        if not r.get('highlights'):
            out.append(dict(code='no_highlights', severity='warning',
                            message='No Highlights & Benefits on the page, so the key line '
                                    'falls back to the authority name',
                            detail=r.get('name'), url=r.get('url')))
        if r.get('price') in (0, '0', None):
            out.append(dict(code='zero_price', severity='info',
                            message='Listed with no price', detail=r.get('name'),
                            url=r.get('url')))
        if not r.get('local_image'):
            out.append(dict(code='no_photo', severity='error',
                            message='No banner photo on the page, so no card was made',
                            detail=r.get('name'), url=r.get('url')))
            continue
        try:
            w, h = Image.open(os.path.join(base_dir, r['local_image'])).size
        except Exception:
            continue
        if min(w, h) < 700:
            out.append(dict(code='low_res', severity='warning',
                            message='Source photo is %dx%d, upscaled %.1fx to fill the card'
                                    % (w, h, max(1600.0 / w, 1000.0 / h)),
                            detail=r.get('name'), url=r.get('url')))
    return out
