"""URL → source pages (PRD §13–15, §56–57).

Hierarchy, as the PRD orders it: Arnifi structured extractor (the legacy Flight-payload records) →
Next.js payload parser → DOM parser fallback (any public page) → browser fallback (services listings
whose payload holds fewer records than its `total`; done by the Node function, see expandServices).

`collect()` is pure given a fetch function; `persist()` writes Firestore. Scraped data is stored, so
opening the editor never re-scrapes.
"""
import concurrent.futures as cf
import datetime
import hashlib
import json
import re
import urllib.parse

from . import LEGACY  # noqa: F401  (puts legacy_pipeline on sys.path)
from . import extract
from .safe_fetch import BlockedUrl, fetch_bytes, fetch_text

import detect   # noqa: E402  legacy, unchanged
import scrape   # noqa: E402  legacy, unchanged
from flight import objects, payload  # noqa: E402

# the legacy module fetches through this name; route it through the SSRF-safe fetcher
scrape.fetch = fetch_text

WS = 'arnifi'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def sid(prefix, *parts):
    return '%s_%s' % (prefix, hashlib.sha1('|'.join(parts).encode()).hexdigest()[:16])


def friendly(exc):
    t = '%s %s' % (type(exc).__name__, exc)
    if isinstance(exc, BlockedUrl) or 'blocked_url' in t:
        return 'That address is not allowed (private or internal network).'
    if re.search(r'404|Not Found', t):
        return 'The page was not found (404). It may have been removed.'
    if re.search(r'timed? ?out|timeout', t, re.I):
        return 'The page took too long to respond.'
    if re.search(r'getaddrinfo|Name or service|nodename', t):
        return "That address doesn't resolve. Check the link."
    return "We couldn't retrieve this page."


def classify(d):
    """PRD §13: detail page / product listing / service section / jurisdiction listing."""
    if d['kind'] in (detect.DETAIL_PRODUCT, detect.DETAIL_SERVICE):
        return 'detail'
    if d['kind'] == detect.LISTING_SERVICE:
        return 'service_section'
    if d['kind'] == detect.LISTING_PRODUCT:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(d['url']).query)
        return 'jurisdiction_listing' if ('countries' in q or 'authority' in q or 'jurisdictions' in q) else 'product_listing'
    return 'unknown'


def _raw_images(o, key):
    """All banner images on a raw record (the legacy record keeps only the first)."""
    if key == 'product':
        return [x.get('url') for x in ((o.get('productBanner') or {}).get('SliderImages') or []) if x.get('url')]
    return [u for u in (o.get('banner'), o.get('image'), o.get('thumbnail')) if isinstance(u, str) and u]


def _records(d, raw, key):
    """Legacy normalisation, deduped by CMS id when there is one (the CMS has duplicate slugs)."""
    seen, recs = set(), []
    for o in raw:
        k = o.get('id') or o.get('slug')
        if not o.get('slug') or k in seen:
            continue
        seen.add(k)
        r = scrape._record(o, d, key)
        r['_images'] = _raw_images(o, key)
        r['_id'] = o.get('id')
        recs.append(r)
    return recs


def _price(r):
    p = r.get('price')
    if p in (None, 0, '0', ''):
        return None
    if isinstance(p, (int, float)):
        p = '{:,}'.format(p)
    return ('%s %s' % (r.get('currency') or '', p)).strip()


def _page_from_record(r, html, final_url, position, source):
    m = extract.meta(html) if html else {}
    hl = r.get('highlights') or []
    imgs, seen = [], set()

    def add(url, role, alt=''):
        if url and url not in seen:
            seen.add(url)
            imgs.append({'url': url, 'role': role, 'assetId': None, 'alt': alt})

    raw = r.get('_images') or []
    add(r.get('image') or (raw[0] if raw else None), 'banner')
    for u in raw[1:]:
        add(u, 'slider')
    add(m.get('og:image'), 'og')
    page_imgs = extract.images(html, final_url) if html else []
    hero = next((i for i in page_imgs if i['priority']), page_imgs[0] if page_imgs else None)
    if hero:
        add(hero['url'], 'hero', hero['alt'])
    for i in page_imgs[:14]:
        add(i['url'], 'content', i['alt'])

    url = r.get('url') or final_url
    record = {k: r.get(k) for k in ('name', 'slug', 'authority', 'country', 'flag', 'image', 'price', 'currency', 'est_time', 'category', 'url_fallback')}
    record['id'] = r.get('_id')
    page = {
        'url': url,
        'slug': r.get('slug') or urllib.parse.urlparse(url).path.rstrip('/').rsplit('/', 1)[-1],
        'pageType': 'detail',
        'title': m.get('title') or '',
        'name': r.get('name') or '',
        'h1': r.get('h1') or '',
        'subheading': (hl[0]['title'] if hl else '') or m.get('og:description') or m.get('description') or '',
        'highlights': hl,
        'benefits': [h['desc'] for h in hl if h.get('desc')],
        'country': detect.folder_name(r.get('country')) if r.get('country') else None,
        'jurisdiction': r.get('authority'),
        'authority': r.get('authority'),
        'category': r.get('category'),
        'price': _price(r),
        'estTime': r.get('est_time'),
        'images': imgs,
        'relatedLinks': extract.related_links(html, final_url) if html else [],
        'rawMetadata': {'position': position, 'source': source, 'record': record,
                        'meta': {k: v for k, v in m.items() if k in ('title', 'description', 'og:title', 'og:description', 'og:image', 'og:url')}},
        'status': 'ok',
        'error': r.get('_error'),
    }
    page['contentHash'] = hashlib.sha1(json.dumps([page['h1'], page['subheading'], [h['title'] for h in hl],
                                                    page['authority'], imgs[0]['url'] if imgs else None]).encode()).hexdigest()
    return page


def enrich(records, source, start=0, workers=6, log=lambda *a: None):
    """Legacy enrich(), but keeping each detail page's HTML for the extra fields."""
    def one(i_r):
        i, r = i_r
        html, final = '', r.get('url')
        urls = [u for u in (r.get('url'), r.get('url_fallback')) if u]
        for n, u in enumerate(urls):
            try:
                html_b, final = fetch_bytes(u)
                html = html_b.decode('utf-8', 'replace')
                r['h1'], r['highlights'] = scrape.parse_detail(html, r['name'])   # legacy parser
                r['url'] = u
                break
            except Exception as exc:
                if n == len(urls) - 1:
                    r['h1'], r['highlights'] = r['name'], []
                    r['_error'] = friendly(exc)
                    log('warn', 'detail page failed: %s (%s)' % (u, exc))
        return _page_from_record(r, html, final or r.get('url'), start + i + 1, source)

    with cf.ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, enumerate(records)))


def generic_page(url, position):
    """Any public page that isn't an Arnifi listing: DOM fallback (title, h1, OG, images)."""
    html_b, final = fetch_bytes(url)
    html = html_b.decode('utf-8', 'replace')
    m = extract.meta(html)
    name = extract.h1(html) or m.get('og:title') or m.get('title') or final
    r = {'name': name, 'slug': None, 'h1': extract.h1(html), 'highlights': [], 'url': final, 'image': None, '_images': []}
    page = _page_from_record(r, html, final, position, url)
    page['subheading'] = m.get('og:description') or m.get('description') or ''
    return page


def collect(urls, browser_records=None, log=lambda *a: None):
    """-> dict(sources, pages, warnings, needs_browser)"""
    browser_records = browser_records or {}
    sources, pages, warnings, needs = [], [], [], []
    for u in urls:
        d = detect.detect(u)
        if not d['ok']:
            try:
                pages.append(generic_page(d['url'] or u, len(pages) + 1))
                sources.append({'url': u, 'kind': 'detail', 'label': 'Web page', 'count': 1, 'generic': True})
            except Exception as exc:
                warnings.append({'code': 'failed_scrape', 'message': friendly(exc), 'url': u})
            continue
        kind = classify(d)
        try:
            if d['kind'] in (detect.LISTING_PRODUCT, detect.LISTING_SERVICE):
                key = 'product' if d['kind'] == detect.LISTING_PRODUCT else 'service'
                if u in browser_records:
                    recs = _records(d, browser_records[u], key)
                else:
                    buf = payload(fetch_text(detect.listing_url(d)))
                    recs = _records(d, objects(buf, key), key)
                    total = re.search(r'"total":(\d+)', buf)
                    total = int(total.group(1)) if total else None
                    if total and total > len(recs):
                        if key == 'service':
                            # Load More is buggy and the API refuses outside requests: fetch from inside the page
                            needs.append({'url': u, 'serviceType': d.get('service_type'), 'total': total, 'parsed': len(recs)})
                            continue
                        warnings.append({'code': 'partial_listing', 'message': 'The page lists %d products but %d could be read.' % (total, len(recs)), 'url': u})
            else:
                buf = payload(fetch_text(d['url']))
                key = 'product' if d['kind'] == detect.DETAIL_PRODUCT else 'service'
                match = [o for o in objects(buf, key) if o.get('slug') == d['slug']]
                recs = _records(d, match[:1], key) if match else scrape.single(d)
                for r in recs:
                    r.setdefault('_images', [])
        except Exception as exc:
            warnings.append({'code': 'failed_scrape', 'message': friendly(exc), 'url': u})
            continue
        log('phase', 'reading %d detail pages' % len(recs))
        got = enrich(recs, u, start=len(pages), log=log)
        for p in got:
            if p.get('error'):
                warnings.append({'code': 'failed_scrape', 'message': p['error'], 'url': p['url']})
        sources.append({'url': u, 'kind': kind, 'label': d['label'], 'count': len(got)})
        pages.extend(got)
    return {'sources': sources, 'pages': pages, 'warnings': warnings, 'needs_browser': needs}


# ------------------------------------------------------------------------------ persistence
CHANGE_FIELDS = (('headline', 'h1'), ('subheading', 'subheading'), ('authority', 'authority'))


def diff_page(prev, cur):
    """What changed on the website since the last snapshot (PRD §57)."""
    out = []
    for kind, field in CHANGE_FIELDS:
        a, b = (prev.get(field) or '').strip(), (cur.get(field) or '').strip()
        if a != b:
            out.append((kind, a or None, b or None))
    pb = next((i['url'] for i in prev.get('images') or [] if i['role'] == 'banner'), None)
    cb = next((i['url'] for i in cur.get('images') or [] if i['role'] == 'banner'), None)
    if pb != cb:
        out.append(('banner', pb, cb))
    ph = [h['title'] for h in prev.get('highlights') or []]
    ch = [h['title'] for h in cur.get('highlights') or []]
    if ph != ch and ('subheading', prev.get('subheading') or None, cur.get('subheading') or None) not in out:
        out.append(('highlights', ', '.join(ph[:3]) or None, ', '.join(ch[:3]) or None))
    return out


def job_doc(project_id, batch_id, inp, t):
    return {'id': sid('job', project_id, inp['url'], t), 'workspaceId': WS, 'projectId': project_id, 'cardId': None, 'batchId': batch_id,
            'type': 'ingest', 'executor': 'functions', 'status': 'queued', 'input': inp, 'output': None, 'provider': None,
            'error': None, 'errorDetail': None, 'pausedReason': None, 'resumeAt': None, 'attempts': 0, 'claimedBy': None,
            'createdAt': t, 'updatedAt': t, 'startedAt': None, 'endedAt': None}


def asset_doc(project_id, page_id, img, t):
    name = urllib.parse.unquote(urllib.parse.urlparse(img['url']).path.rsplit('/', 1)[-1])[:120] or 'image'
    return {'id': sid('ast', project_id, img['url']), 'workspaceId': WS, 'projectId': project_id, 'type': 'image', 'source': 'website',
            'role': img['role'], 'sourcePageId': page_id, 'sourceUrl': img['url'], 'name': name, 'storageKey': '', 'thumbKey': None,
            'previewKey': None, 'width': 0, 'height': 0, 'mimeType': '', 'bytes': 0, 'sha256': None, 'dhash': None, 'inkScore': None,
            'flags': {}, 'analysis': {'alt': img.get('alt')} if img.get('alt') else None, 'status': 'pending', 'error': None, 'createdAt': t}


def plan_writes(project_id, scan, result, existing_pages, existing_assets, existing_cards, t=None):
    """Everything persist() will write, as (op, path, data) tuples — pure, so it can be tested."""
    t = t or now()
    scan_id = scan['id']
    rescan = bool(scan.get('rescanOf')) or any(p.get('rawMetadata', {}).get('source') in scan['urls'] for p in existing_pages.values())
    assets_by_url = {a['sourceUrl']: a for a in existing_assets if a.get('sourceUrl')}
    batch_id = sid('bat', project_id, scan_id)
    writes, jobs, changes, card_flags = [], [], [], {}
    seen_ids = set()
    for p in result['pages']:
        page_id = sid('pg', project_id, p['url'])
        seen_ids.add(page_id)
        p = dict(p, id=page_id, projectId=project_id, scanId=scan_id, lastScannedAt=t)
        for img in p['images']:
            a = assets_by_url.get(img['url'])
            if a:
                img['assetId'] = a['id']
                continue
            a = asset_doc(project_id, page_id, img, t)
            assets_by_url[img['url']] = a
            img['assetId'] = a['id']
            writes.append(('set', 'assets/%s' % a['id'], a))
            jobs.append(job_doc(project_id, batch_id, {'assetId': a['id'], 'url': img['url'], 'mode': 'remote', 'projectId': project_id,
                                                        'sourcePageId': page_id, 'role': img['role'], 'scanId': scan_id}, t))
        prev = existing_pages.get(page_id)
        if prev and prev.get('contentHash') != p['contentHash']:
            for kind, a, b in diff_page(prev, p):
                ch = {'id': sid('chg', page_id, scan_id, kind), 'projectId': project_id, 'sourcePageId': page_id, 'scanId': scan_id,
                      'kind': kind, 'before': a, 'after': b, 'status': 'pending', 'createdAt': t}
                changes.append(ch)
                card_flags.setdefault(page_id, []).append(kind)
        elif not prev and rescan:
            changes.append({'id': sid('chg', page_id, scan_id, 'added'), 'projectId': project_id, 'sourcePageId': page_id, 'scanId': scan_id,
                            'kind': 'page_added', 'before': None, 'after': p.get('h1') or p.get('name'), 'status': 'pending', 'createdAt': t})
        writes.append(('set', 'projects/%s/pages/%s' % (project_id, page_id), p))
        writes.append(('set', 'projects/%s/pages/%s/snapshots/%s' % (project_id, page_id, scan_id), dict(p, snapshotOf=scan_id)))

    removed = []
    if rescan:
        for pid_, prev in existing_pages.items():
            src = (prev.get('rawMetadata') or {}).get('source')
            if pid_ not in seen_ids and src in scan['urls'] and prev.get('status') != 'removed':
                removed.append(pid_)
                writes.append(('update', 'projects/%s/pages/%s' % (project_id, pid_), {'status': 'removed', 'lastScannedAt': t}))
                changes.append({'id': sid('chg', pid_, scan_id, 'removed'), 'projectId': project_id, 'sourcePageId': pid_, 'scanId': scan_id,
                                'kind': 'page_removed', 'before': prev.get('h1') or prev.get('name'), 'after': None, 'status': 'pending', 'createdAt': t})

    for ch in changes:
        writes.append(('set', 'projects/%s/changes/%s' % (project_id, ch['id']), ch))
    # cards built from a changed or removed page get a warning; approved cards are not touched otherwise
    for c in existing_cards:
        spid = c.get('sourcePageId')
        if spid in card_flags or spid in removed:
            warn = [w for w in c.get('warnings') or [] if w.get('code') not in ('source_changed', 'source_removed')]
            if spid in removed:
                warn.append({'code': 'source_removed', 'severity': 'warning', 'message': 'Source page is no longer available.'})
            else:
                warn.append({'code': 'source_changed', 'severity': 'info', 'message': 'Website source changed: %s.' % ', '.join(card_flags[spid])})
            writes.append(('update', 'projects/%s/cards/%s' % (project_id, c['id']), {'warnings': warn, 'updatedAt': t}))

    attach = scan.get('attachTo')
    if attach and result['pages']:
        first = sid('pg', project_id, result['pages'][0]['url'])
        writes.append(('update', 'projects/%s/cards/%s' % (project_id, attach), {'sourcePageId': first, 'sourceLabel': 'Website', 'updatedAt': t}))
    if jobs:
        writes.append(('set', 'batches/%s' % batch_id, {'id': batch_id, 'projectId': project_id, 'kind': 'ingest', 'label': 'Downloading source images',
                                                         'total': len(jobs), 'completed': 0, 'failed': 0, 'status': 'running',
                                                         'jobIds': [j['id'] for j in jobs][:1000], 'createdAt': t, 'updatedAt': t}))
        for j in jobs:
            writes.append(('set', 'jobs/%s' % j['id'], j))
    images = len({i['url'] for p in result['pages'] for i in p['images']})
    scan_patch = {'status': 'done', 'phase': 'Found %d pages' % len(result['pages']), 'pages': len(result['pages']), 'images': images,
                  'warnings': result['warnings'], 'sources': result['sources'], 'changes': len(changes), 'ingestBatchId': batch_id if jobs else None,
                  'progress': {'done': len(scan['urls']), 'total': len(scan['urls'])}, 'updatedAt': t, 'error': None}
    if not result['pages'] and result['warnings']:
        scan_patch.update(status='failed', error=result['warnings'][0]['message'])
    return writes, scan_patch
