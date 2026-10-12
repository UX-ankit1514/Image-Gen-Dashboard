"""Working out what an arnifi.com URL is before we fetch it."""
import re
import urllib.parse

HOST = 'arnifi.com'

LISTING_PRODUCT = 'listing-product'   # /product-listing?...     -> "product" records
LISTING_SERVICE = 'listing-service'   # /services/<type>?...     -> "service" records
DETAIL_PRODUCT = 'detail-product'     # /product-details/<slug>
DETAIL_SERVICE = 'detail-service'     # /services/<type>/<slug>
UNKNOWN = 'unknown'

LABELS = {
    LISTING_PRODUCT: 'Product listing',
    LISTING_SERVICE: 'Service listing',
    DETAIL_PRODUCT: 'Single product page',
    DETAIL_SERVICE: 'Single service page',
    UNKNOWN: 'Not an Arnifi page we can read',
}


def normalise(raw):
    u = (raw or '').strip().strip('<>,;')
    if not u:
        return ''
    if not re.match(r'^https?://', u):
        u = 'https://' + u.lstrip('/')
    return u


def detect(raw):
    """-> dict(kind, url, service_type, slug, label, ok)"""
    url = normalise(raw)
    out = dict(input=raw, url=url, kind=UNKNOWN, service_type=None, slug=None, ok=False)
    if not url:
        return _label(out)
    p = urllib.parse.urlparse(url)
    if HOST not in (p.netloc or ''):
        return _label(out)
    parts = [x for x in p.path.split('/') if x]

    if parts[:1] == ['product-listing']:
        out.update(kind=LISTING_PRODUCT, ok=True)
    elif parts[:1] == ['product-details'] and len(parts) >= 2:
        # both shapes exist: /product-details/<slug> and the canonical
        # /product-details/<type>/<authority>/<slug>. The slug is always last.
        out.update(kind=DETAIL_PRODUCT, slug=parts[-1], ok=True)
    elif parts[:1] == ['services'] and len(parts) == 2:
        out.update(kind=LISTING_SERVICE, service_type=parts[1], ok=True)
    elif parts[:1] == ['services'] and len(parts) >= 3:
        out.update(kind=DETAIL_SERVICE, service_type=parts[1], slug=parts[2], ok=True)
    return _label(out)


def _label(out):
    out['label'] = LABELS[out['kind']]
    return out


def listing_url(d):
    """The URL to actually fetch. `pageSize=100` is what makes 'Load More' unnecessary -
    it works on both /product-listing and /services/<type>."""
    p = urllib.parse.urlparse(d['url'])
    q = urllib.parse.parse_qsl(p.query, keep_blank_values=True)
    q = [(k, v) for k, v in q if k != 'pageSize'] + [('pageSize', '100')]
    return urllib.parse.urlunparse(p._replace(query=urllib.parse.urlencode(q)))


def _slug(s):
    return re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')


def detail_url(d, slug, authority=None, product_type=None):
    """The page to fetch for one record.

    `/product-details/<slug>` answers 200 but serves a stub without the
    "Highlights & benefits" section. The canonical
    `/product-details/<type>/<authority>/<slug>` serves the full page, so build that
    whenever the listing gave us the authority; the short form stays as the fallback.
    """
    if d['kind'] in (LISTING_SERVICE, DETAIL_SERVICE):
        return 'https://%s/services/%s/%s' % (HOST, d['service_type'], slug)
    if authority and product_type:
        return 'https://%s/product-details/%s/%s/%s' % (
            HOST, _slug(product_type), _slug(authority), slug)
    return 'https://%s/product-details/%s' % (HOST, slug)


def short_detail_url(d, slug):
    if d['kind'] in (LISTING_SERVICE, DETAIL_SERVICE):
        return 'https://%s/services/%s/%s' % (HOST, d['service_type'], slug)
    return 'https://%s/product-details/%s' % (HOST, slug)


# Arnifi's own spelling, kept in the scraped data but fixed in folder names so the set
# reads correctly on disk.
COUNTRY_FIXES = {'Malasiya': 'Malaysia'}


def folder_name(country):
    return COUNTRY_FIXES.get((country or '').strip(), country)


def set_name(d, records):
    """The folder name for one link: the page's own country label, else the filter."""
    for r in records:
        if r.get('country'):
            return r['country']
    if d.get('service_type'):
        return d['service_type']
    q = urllib.parse.parse_qs(urllib.parse.urlparse(d['url']).query)
    for k in ('countries', 'country', 'authority', 'jurisdictions', 'productType'):
        if k in q:
            return '%s-%s' % (k, '-'.join(q[k]))
    return 'set'
