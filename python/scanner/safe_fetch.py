"""Fetching external pages without opening an SSRF hole (PRD §78).

Every request, and every redirect hop, is resolved first and refused if any address is private,
loopback, link-local, multicast or reserved. Only http(s) on 80/443. Responses are size-capped.
`ACS_ALLOW_HOSTS` (comma-separated host[:port]) whitelists hosts for local tests only.
"""
import ipaddress
import os
import socket
import urllib.error
import urllib.parse
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
TIMEOUT = 60
MAX_HTML = 15 * 1024 * 1024
MAX_REDIRECTS = 5


class BlockedUrl(Exception):
    """blocked_url: the address points somewhere we must not fetch."""


def _allowed_override(host, port):
    allow = [h.strip().lower() for h in os.environ.get('ACS_ALLOW_HOSTS', '').split(',') if h.strip()]
    return host.lower() in allow or ('%s:%s' % (host.lower(), port)) in allow


def check_url(url):
    p = urllib.parse.urlparse(url)
    if p.scheme not in ('http', 'https'):
        raise BlockedUrl('blocked_url: scheme %s not allowed' % p.scheme)
    host = p.hostname or ''
    port = p.port or (443 if p.scheme == 'https' else 80)
    if not host:
        raise BlockedUrl('blocked_url: no host')
    if _allowed_override(host, port):
        return
    if port not in (80, 443):
        raise BlockedUrl('blocked_url: port %s not allowed' % port)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise urllib.error.URLError('getaddrinfo failed for %s: %s' % (host, e))
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split('%')[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
                or ip.is_unspecified or (ip.version == 6 and ip.ipv4_mapped and ip.ipv4_mapped.is_private)):
            raise BlockedUrl('blocked_url: %s resolves to a private address' % host)


class _CheckedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_REDIRECTS

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(urllib.parse.urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_CheckedRedirect)


def fetch_bytes(url, limit=MAX_HTML, timeout=TIMEOUT):
    check_url(url)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*'})
    with _opener.open(req, timeout=timeout) as res:
        out = res.read(limit + 1)
        if len(out) > limit:
            raise ValueError('response too large: %s' % url)
        return out, res.geturl()


def fetch_text(url):
    """Drop-in for legacy scrape.fetch(url) -> str."""
    data, _ = fetch_bytes(url)
    return data.decode('utf-8', 'replace')
