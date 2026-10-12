"""Record the pages a scan fetches, so tests and the E2E fixture site can replay them offline.

    venv/bin/python tests/record.py <out dir> <url> [<url> ...]
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scanner import scan as S  # noqa: E402
from scanner import safe_fetch  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
index_path = os.path.join(out, 'index.json')
index = json.load(open(index_path)) if os.path.exists(index_path) else {}
real = safe_fetch.fetch_bytes


def recording(url, *a, **k):
    data, final = real(url, *a, **k)
    name = hashlib.sha1(url.encode()).hexdigest()[:16] + '.html'
    open(os.path.join(out, name), 'wb').write(data)
    index[url] = {'file': name, 'final': final}
    return data, final


S.fetch_bytes = recording
S.scrape.fetch = lambda u: recording(u)[0].decode('utf-8', 'replace')
S.fetch_text = S.scrape.fetch
res = S.collect(sys.argv[2:])
json.dump(index, open(index_path, 'w'), indent=1)
print('%d pages, %d fetches recorded, needs_browser=%s' % (len(res['pages']), len(index), res['needs_browser']))
