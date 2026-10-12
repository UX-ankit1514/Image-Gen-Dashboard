"""Command line entry point. Everything it prints on stdout is one JSON object per line,
so the Node server can stream progress straight through to the browser.

    python3 cli.py detect --url <u>
    python3 cli.py run --out <dir> --mode per-link|single --url <u> [--url <u> ...]
"""
import argparse
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audit as audit_mod          # noqa: E402
import phototext                   # noqa: E402
import review as review_mod        # noqa: E402
import card as T                   # noqa: E402
import detect as detect_mod        # noqa: E402
import outputs                     # noqa: E402
import render as render_mod        # noqa: E402
import scrape                      # noqa: E402


def emit(event, **kw):
    kw['event'] = event
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def make_logger(link_index):
    def log(kind, *args):
        if kind == 'progress':
            emit('progress', link=link_index, done=args[0], total=args[1])
        elif kind == 'warn':
            emit('warn', link=link_index, message=args[0])
        else:
            emit('phase', link=link_index, phase=kind if kind != 'phase' else args[0],
                 message=args[-1] if args else '')
    return log


def collect(d, log):
    """Records for one link, with detail pages fetched and photos still remote."""
    if d['kind'] in (detect_mod.LISTING_PRODUCT, detect_mod.LISTING_SERVICE):
        url, records = scrape.listing(d, log)
    else:
        url, records = d['url'], scrape.single(d)
        log('listing', '1 page')
    log('phase', 'detail', 'reading %d detail pages' % len(records))
    records = scrape.enrich(records, log=log)
    return url, records


def editorial(records, base_dir, images_dir, args, log, link_index):
    """Claude reads the pages before anything is rendered.

    Never fatal. Not signed in, a timeout, or malformed JSON all fall through to the
    deterministic values, so a run always finishes.
    """
    if not review_mod.signed_in():
        emit('warn', link=link_index,
             message='Not signed in to Claude, so the pages were used exactly as written.')
        return []
    model, effort = review_mod.resolve(args.quality, args.model, args.effort)
    emit('phase', link=link_index, phase='review',
         message='Claude is reading %d pages (%s)' % (len(records), model))

    decisions, cost = review_mod.review(records, model, effort, log)

    photos = {}
    if args.check_photos:
        cands = phototext.candidates(records, base_dir)
        if cands:
            emit('phase', link=link_index, phase='review',
                 message='looking at %d photos' % len(cands))
            verdicts, pcost = review_mod.photo_pass(cands, model, effort, log)
            cost += pcost
            # one look covers every card that reuses the same banner
            for c in cands:
                v = verdicts.get(c['photo'])
                if v:
                    for a in c.get('aliases') or [c['photo']]:
                        photos[a] = v

    notes = review_mod.apply_decisions(records, decisions,
                                       tighten_headlines=args.tighten_headlines,
                                       crop_photos=args.apply_crops)
    by_slug = {n['slug']: n for n in notes}
    for r in records:
        v = photos.get(os.path.basename(r.get('local_image') or ''))
        if not v:
            continue
        r['photo_flag'] = v.get('flag') or ''
        n = by_slug.get(r.get('slug'))
        if n:
            n['photo_flag'] = v.get('flag')
            n['photo_note'] = v.get('note') or ''
        if v.get('flag') == 'printed-text' and v.get('crop'):
            r['ai_crop'] = v['crop']
            if n:
                n['crop'] = v['crop']
            if args.apply_crops:
                r['crop'] = v['crop']

    for n in notes:
        emit('review', link=link_index, **n)
    emit('phase', link=link_index, phase='review',
         message='done - %d pages, $%.3f' % (len(decisions), cost))
    return notes


def run(args):
    root = os.path.abspath(args.out)
    os.makedirs(root, exist_ok=True)
    links = [detect_mod.detect(u) for u in args.url]
    good = [d for d in links if d['ok']]
    for d in links:
        if not d['ok']:
            emit('warn', message='Skipped, not a readable Arnifi page: %s' % d['input'])
    if not good:
        emit('error', message='None of the links could be read.')
        return 1

    per_link = args.mode == 'per-link'
    by_country = args.mode == 'by-country'
    split = per_link or by_country
    sets, master, flat, all_cards, warnings, all_notes = [], [], [], [], [], []
    counter, set_no = 1, 1

    for i, d in enumerate(good, 1):
        log = make_logger(i)
        emit('phase', link=i, phase='start', message=d['url'])
        url, records = collect(d, log)

        # One listing can hold several countries and the site filters them in the browser,
        # not in the query - so `by-country` splits the records here instead of re-fetching.
        if by_country:
            order, bucket = [], {}
            for r in records:
                k = r.get('country') or detect_mod.set_name(d, records)
                if k not in bucket:
                    bucket[k], _ = [], order.append(k)
                bucket[k].append(r)
            buckets = [(k, bucket[k]) for k in order]
        else:
            buckets = [(detect_mod.set_name(d, records), records)]

        # Folders and photos first for every bucket, so Claude reads the whole link at once
        # instead of once per country.
        plans = []
        for name, group in buckets:
            if split:
                folder = os.path.join(root,
                                      '%02d-%s' % (set_no, T.slug(detect_mod.folder_name(name))))
                images_dir, final_dir, start = (os.path.join(folder, 'images'),
                                                os.path.join(folder, 'final'), 1)
            else:
                folder = root
                images_dir, final_dir, start = (os.path.join(root, 'images'),
                                                os.path.join(root, 'final'), counter)
            os.makedirs(folder, exist_ok=True)
            log('phase', 'photos', 'downloading %d photos%s'
                % (len(group), (' for %s' % name) if by_country else ''))
            group = scrape.download_images(group, images_dir, start=start, log=log)
            for r in group:
                r['_base'] = folder          # where this record's images/ actually lives
            plans.append(dict(name=name, group=group, folder=folder,
                              final_dir=final_dir, start=start))
            set_no += 1

        records = [r for p in plans for r in p['group']]
        notes = []
        if args.claude:
            notes = editorial(records, root, None, args, log, i)
        all_notes.extend(notes)
        render_mod.assign_focus(records, vary=args.vary_focus)

        for p in plans:
            name, group, folder = p['name'], p['group'], p['folder']
            final_dir, start = p['final_dir'], p['start']
            if args.apply_crops:
                render_mod.prepare_crops(group, folder, os.path.join(folder, '.crops'))

            data_name = 'data.json' if split else 'data-%02d.json' % i
            with open(os.path.join(folder, data_name), 'w') as fh:
                json.dump([{k: v for k, v in r.items() if k != '_base'} for r in group],
                          fh, indent=2, ensure_ascii=False)

            log('phase', 'render', 'rendering %d cards'
                % len([r for r in group if r.get('local_image')]))
            render_mod.render(group, folder, final_dir, start=start,
                              resume=args.resume, log=log)

            rs = outputs.rows(group, start=start)
            set_dir = os.path.relpath(folder, root)
            for r in rs:
                emit('card', link=i, set=set_dir,
                     file=os.path.relpath(os.path.join(final_dir, r['file']), root),
                     headline=r['headline'], key_point=r['key_point'], page_url=r['page_url'])
            if split:
                outputs.write_index(rs, final_dir)
            flat.extend(rs)
            master.extend([dict(set=set_dir, **r) for r in rs])
            all_cards.extend(os.path.join(final_dir, r['file']) for r in rs)
            counter += len(rs)

            for w in audit_mod.audit(group, folder):
                w['set'] = set_dir
                warnings.append(w)
                emit('warn', link=i, message=w['message'], detail=w.get('detail'), code=w['code'])

            sets.append(dict(dir=set_dir, name=name, n=len(rs), listing_url=url, source=d['url']))
            emit('phase', link=i, phase='set-done', message='%s: %d cards' % (set_dir, len(rs)))

    if not split:
        outputs.write_index(flat, os.path.join(root, 'final'))
    outputs.write_master(master, root)

    sheet = None
    if args.contact_sheet and all_cards:
        sheet = render_mod.contact_sheet(all_cards, os.path.join(root, 'CONTACT-SHEET.jpg'))
        sheet = os.path.relpath(sheet, root)

    outputs.write_manifest(root, dict(mode=args.mode, sets=sets, cards=len(master),
                                      contact_sheet=sheet, warnings=warnings,
                                      notes=all_notes, links=[d['url'] for d in good]))
    emit('done', cards=len(master), sets=sets, dir=root, contact_sheet=sheet,
         warnings=warnings, notes=all_notes)
    return 0


def main():
    ap = argparse.ArgumentParser(prog='arnifi-pipeline')
    sub = ap.add_subparsers(dest='cmd', required=True)

    d = sub.add_parser('detect')
    d.add_argument('--url', action='append', required=True)

    r = sub.add_parser('run')
    r.add_argument('--url', action='append', required=True)
    r.add_argument('--out', required=True)
    r.add_argument('--mode', choices=['per-link', 'single', 'by-country'],
                   default='per-link')
    r.add_argument('--resume', action='store_true')
    r.add_argument('--vary-focus', action='store_true')
    r.add_argument('--contact-sheet', action='store_true')
    r.add_argument('--claude', action='store_true',
                   help='let Claude read each page and choose the key line')
    r.add_argument('--quality', choices=['best', 'balanced', 'fast'], default='balanced')
    r.add_argument('--model', default=None, help='override the preset model')
    r.add_argument('--effort', default=None, help='override the preset effort')
    r.add_argument('--check-photos', action='store_true',
                   help='also look at the photos for printed text')
    r.add_argument('--tighten-headlines', action='store_true',
                   help='apply shortened headlines instead of only suggesting them')
    r.add_argument('--apply-crops', action='store_true',
                   help='apply suggested crops instead of only suggesting them')

    args = ap.parse_args()
    if args.cmd == 'detect':
        print(json.dumps([detect_mod.detect(u) for u in args.url], ensure_ascii=False))
        return 0
    try:
        return run(args)
    except Exception as exc:
        emit('error', message=str(exc), trace=traceback.format_exc()[-1500:])
        return 1


if __name__ == '__main__':
    sys.exit(main())
