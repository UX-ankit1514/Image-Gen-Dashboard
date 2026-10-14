"""Running one scan against Firestore, whatever starts it.

Firebase Functions call `run_scan` from a document trigger (main.py, local emulator); on Vercel the
job runner calls the scanner function over HTTP (vercel_scan.py), because there are no triggers.
"""
from google.cloud import firestore

from . import scan as S


def commit(db, writes):
    for i in range(0, len(writes), 400):
        b = db.batch()
        for op, path, data in writes[i:i + 400]:
            ref = db.document(path)
            if op == 'set':
                b.set(ref, data)
            elif op == 'update':
                b.update(ref, data)
        b.commit()


@firestore.transactional
def _claim(tx, ref, expected):
    snap = ref.get(transaction=tx)
    if not snap.exists or snap.get('status') not in expected:
        return None
    tx.update(ref, {'status': 'scanning', 'phase': 'Reading pages', 'updatedAt': S.now()})
    return snap.to_dict()


def run_scan(db, ref, expected=('queued', 'enrich')):
    """Claims the scan (a second caller gets None and does nothing) and runs it to the next state."""
    if isinstance(expected, str):
        expected = (expected,)
    scan = _claim(db.transaction(), ref, expected)
    if not scan:
        return None
    project_id = scan['projectId']
    try:
        def log(kind, *args):
            if kind == 'phase':
                ref.update({'phase': args[0][:200], 'updatedAt': S.now()})

        result = S.collect(scan['urls'], browser_records=scan.get('browserRecords') or None, log=log)
        if result['needs_browser'] and not scan.get('browserRecords'):
            # hand over to the Node side (headless Chrome), keep what we have
            ref.update({'status': 'needs_browser', 'browserFor': result['needs_browser'], 'phase': 'Opening the listing in a browser',
                        'warnings': result['warnings'], 'updatedAt': S.now()})
            return 'needs_browser'
        pages = {d.id: d.to_dict() for d in db.collection('projects/%s/pages' % project_id).stream()}
        assets = [d.to_dict() for d in db.collection('assets').where(filter=firestore.FieldFilter('projectId', '==', project_id)).stream()]
        cards = [d.to_dict() for d in db.collection('projects/%s/cards' % project_id).stream()]
        writes, scan_patch = S.plan_writes(project_id, scan, result, pages, assets, cards)
        commit(db, writes)
        ref.update(scan_patch)
        db.document('projects/%s' % project_id).update({'lastEditedAt': S.now()})
        return 'done'
    except Exception as exc:  # never a raw trace in the UI (PRD §81)
        ref.update({'status': 'failed', 'error': S.friendly(exc), 'errorDetail': repr(exc)[:2000], 'updatedAt': S.now()})
        raise
