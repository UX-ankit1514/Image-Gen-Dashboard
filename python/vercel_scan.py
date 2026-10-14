"""The scanner as a Vercel Function (`/api/internal/scan`), for deployments without Firebase Functions.

The job runner (apps/functions/src/vercel.ts) POSTs {"scanId": ...} for each queued scan. This runs it
with the same code as the Firebase trigger (scanner/runner.py), then pokes the runner back, which
downloads the images the scan queued, or opens the listing in a browser when the scan asks for it.
Firestore is reached with the service account from the project's environment variables.
"""
import hashlib
import hmac
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler

from google.cloud import firestore

from scanner.runner import run_scan

_db = None


def _client():
    global _db
    if _db is None:
        project = os.environ['FIRESTORE_PROJECT_ID']
        if os.environ.get('FIRESTORE_EMULATOR_HOST'):
            from google.auth.credentials import AnonymousCredentials
            _db = firestore.Client(project=project, credentials=AnonymousCredentials())
        else:
            from google.oauth2 import service_account
            creds = service_account.Credentials.from_service_account_info({
                'type': 'service_account', 'project_id': project, 'client_email': os.environ['GOOGLE_SA_EMAIL'],
                'private_key': os.environ['GOOGLE_SA_KEY'].replace('\\n', '\n'), 'token_uri': 'https://oauth2.googleapis.com/token',
            })
            _db = firestore.Client(project=project, credentials=creds)
    return _db


def _token():
    """Same value as runnerToken() in packages/shared/src/crypto.ts."""
    return hmac.new(os.environ['TOKEN_KEY'].encode(), b'acs-runner-v1', hashlib.sha256).hexdigest()


def _poke_runner(origin, token):
    req = urllib.request.Request(origin + '/api/internal/run', data=b'{}', method='POST',
                                 headers={'content-type': 'application/json', 'x-acs-runner': token})
    try:
        urllib.request.urlopen(req, timeout=4).close()
    except Exception:  # still running after 4 s is fine; a missed poke is repaired by the next poll
        pass


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not os.environ.get('TOKEN_KEY'):
            return self._send(404, {'error': 'Not found.'})
        token = _token()
        if not hmac.compare_digest(self.headers.get('x-acs-runner') or '', token):
            return self._send(403, {'error': 'Request blocked.'})
        length = int(self.headers.get('content-length') or 0)
        try:
            scan_id = json.loads(self.rfile.read(length) or b'{}').get('scanId')
        except ValueError:
            scan_id = None
        if not isinstance(scan_id, str) or not scan_id or '/' in scan_id:
            return self._send(400, {'error': 'scanId is required.'})
        proto = (self.headers.get('x-forwarded-proto') or 'https').split(',')[0]
        origin = '%s://%s' % (proto, self.headers.get('x-forwarded-host') or self.headers.get('host'))
        db = _client()
        try:
            outcome = run_scan(db, db.document('scans/%s' % scan_id))
        except Exception as exc:  # run_scan already marked the scan failed with a friendly message
            print('scan %s failed: %r' % (scan_id, exc))
            outcome = 'failed'
        if outcome in ('done', 'needs_browser'):
            _poke_runner(origin, token)
        return self._send(200, {'scanId': scan_id, 'outcome': outcome or 'not_claimed'})
