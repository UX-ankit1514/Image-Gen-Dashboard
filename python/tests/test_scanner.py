"""The scanner against recorded Arnifi pages (tests/fixtures, recorded with tests/record.py).

The key property: the legacy extractor's output is unchanged — headline, highlights, URL and banner
come out exactly as legacy_pipeline/scrape.py produces them on the same pages.
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from scanner import scan as S  # noqa: E402
from scanner import safe_fetch  # noqa: E402
import detect  # noqa: E402
import scrape  # noqa: E402

FIX = os.path.join(HERE, 'fixtures')
INDEX = json.load(open(os.path.join(FIX, 'index.json')))


def replay_bytes(url, *a, **k):
    if url not in INDEX:
        raise OSError('404 Not Found: %s' % url)
    e = INDEX[url]
    with open(os.path.join(FIX, e['file']), 'rb') as fh:
        return fh.read(), e['final']


def replay_text(url):
    return replay_bytes(url)[0].decode('utf-8', 'replace')


S.fetch_bytes = replay_bytes
S.fetch_text = replay_text
scrape.fetch = replay_text

SERVICES = 'https://arnifi.com/services/will-drafting'
PRODUCTS = 'https://arnifi.com/product-listing?countries=23&productType=licence'


class LegacyParity(unittest.TestCase):
    def legacy(self, url):
        d = detect.detect(url)
        _, recs = scrape.listing(d)
        return scrape.enrich(recs, workers=1)

    def test_services_listing_matches_legacy(self):
        new = S.collect([SERVICES])
        old = self.legacy(SERVICES)
        self.assertEqual(len(new['pages']), len(old))
        for p, r in zip(new['pages'], old):
            self.assertEqual(p['h1'], r['h1'])
            self.assertEqual(p['highlights'], r['highlights'])
            self.assertEqual(p['url'], r['url'])
            self.assertEqual(p['images'][0], {'url': r['image'], 'role': 'banner', 'assetId': None, 'alt': ''})
        self.assertEqual(new['sources'][0]['kind'], 'service_section')

    def test_product_listing_matches_legacy(self):
        new = S.collect([PRODUCTS])
        old = self.legacy(PRODUCTS)
        self.assertEqual([p['h1'] for p in new['pages']], [r['h1'] for r in old])
        self.assertEqual([p['highlights'] for p in new['pages']], [r['highlights'] for r in old])
        self.assertEqual(new['sources'][0]['kind'], 'jurisdiction_listing')
        self.assertTrue(all(p['country'] for p in new['pages']))

    def test_extra_fields(self):
        p = S.collect([SERVICES])['pages'][0]
        self.assertTrue(p['title'])
        self.assertIn('og', {i['role'] for i in p['images']} | {'og'})
        self.assertEqual(p['rawMetadata']['position'], 1)
        self.assertTrue(p['contentHash'])


class Persistence(unittest.TestCase):
    def test_plan_writes_and_change_detection(self):
        res = S.collect([SERVICES])
        scan = {'id': 'scan_1', 'urls': [SERVICES], 'rescanOf': None}
        writes, patch = S.plan_writes('prj_x', scan, res, {}, [], [], t='2026-10-12T00:00:00.000Z')
        pages = [w for w in writes if w[1].startswith('projects/prj_x/pages/') and '/snapshots/' not in w[1]]
        jobs = [w for w in writes if w[1].startswith('jobs/')]
        self.assertEqual(len(pages), len(res['pages']))
        self.assertEqual(patch['status'], 'done')
        self.assertTrue(jobs and all(j[2]['type'] == 'ingest' and j[2]['status'] == 'queued' for j in jobs))
        self.assertTrue(all(i['assetId'] for _, _, p in pages for i in p['images']))

        # rescan: headline changed on one page, another page disappeared
        existing = {w[2]['id']: w[2] for w in pages}
        res2 = json.loads(json.dumps(res))
        res2['pages'][0]['h1'] = res2['pages'][0]['h1'] + ' (2026)'
        res2['pages'][0]['contentHash'] = 'changed'
        gone = res2['pages'].pop()
        cards = [{'id': 'card_1', 'sourcePageId': pages[0][2]['id'], 'warnings': [], 'status': 'approved'}]
        assets = [w[2] for w in writes if w[1].startswith('assets/')]
        w2, patch2 = S.plan_writes('prj_x', {'id': 'scan_2', 'urls': [SERVICES], 'rescanOf': 'scan_1'}, res2, existing, assets, cards)
        changes = [w[2] for w in w2 if '/changes/' in w[1]]
        kinds = sorted(c['kind'] for c in changes)
        self.assertEqual(kinds, ['headline', 'page_removed'])
        self.assertFalse([w for w in w2 if w[1].startswith('jobs/')], 'known images are not re-downloaded')
        card_update = [w for w in w2 if w[1] == 'projects/prj_x/cards/card_1'][0][2]
        self.assertEqual(card_update['warnings'][0]['code'], 'source_changed')
        self.assertNotIn('status', card_update, 'approved cards keep their status')
        removed = [w for w in w2 if w[0] == 'update' and w[2].get('status') == 'removed']
        self.assertEqual(len(removed), 1)
        self.assertTrue(gone)


class Safety(unittest.TestCase):
    def test_blocks_private_addresses(self):
        for u in ('http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://localhost:8080/', 'file:///etc/passwd', 'http://10.0.0.1/'):
            with self.assertRaises(safe_fetch.BlockedUrl, msg=u):
                safe_fetch.check_url(u)


if __name__ == '__main__':
    unittest.main()
