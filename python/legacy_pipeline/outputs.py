"""The files a run leaves behind besides the cards themselves."""
import csv
import json
import os

import card as T

COLUMNS = ['file', 'headline', 'key_point', 'authority', 'country', 'est_time',
           'price', 'page_url', 'source_photo', 'headline_source', 'key_line_source',
           'photo_flag']


def rows(records, start=1):
    out = []
    n = start
    for r in records:
        if not r.get('local_image'):
            continue
        price = ''
        if r.get('price'):
            price = ('%s %s' % (r.get('currency') or '', '{:,}'.format(r['price'])
                                if isinstance(r['price'], (int, float)) else r['price'])).strip()
        out.append({
            'file': '%02d_%s.jpg' % (n, T.slug(r.get('slug') or r.get('name'))),
            'headline': r.get('h1') or r.get('name'),
            'key_point': T.kicker(r),
            'authority': r.get('authority') or '',
            'country': r.get('country') or '',
            'est_time': r.get('est_time') or '',
            'price': price,
            'page_url': r.get('url') or '',
            'source_photo': os.path.basename(r.get('image') or ''),
            # where the words came from, so any card's provenance can be checked later
            'headline_source': r.get('headline_source') or 'page',
            'key_line_source': r.get('key_line_source') or 'highlight:0',
            'photo_flag': r.get('photo_flag') or '',
        })
        n += 1
    return out


def write_index(rs, folder):
    with open(os.path.join(folder, 'INDEX.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rs)
    with open(os.path.join(folder, 'links.txt'), 'w') as fh:
        fh.write('\n'.join(r['page_url'] for r in rs) + '\n')


def write_master(all_rows, root):
    if not all_rows:
        return
    with open(os.path.join(root, 'MASTER-INDEX.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['set'] + COLUMNS)
        w.writeheader()
        w.writerows(all_rows)
    with open(os.path.join(root, 'all-links.txt'), 'w') as fh:
        fh.write('\n'.join(r['page_url'] for r in all_rows) + '\n')


def write_manifest(root, manifest):
    with open(os.path.join(root, 'run.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
