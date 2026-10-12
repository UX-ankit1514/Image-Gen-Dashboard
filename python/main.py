"""Firebase Functions (Python): the scanner.

Triggered when a scan document is written with status `queued` (a new scan) or `enrich` (the Node
function finished fetching a services listing from inside the page). Everything else about a scan —
images, renders — happens in the Node functions via job documents.
"""
from firebase_admin import firestore, initialize_app
from firebase_functions import firestore_fn, options

from scanner import scan as S

options.set_global_options(region='asia-south1', memory=options.MemoryOption.MB_512, timeout_sec=540, max_instances=5)
initialize_app()


def _db():
    return firestore.client()


def _commit(db, writes):
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
    if not snap.exists or snap.get('status') != expected:
        return None
    tx.update(ref, {'status': 'scanning', 'phase': 'Reading pages', 'updatedAt': S.now()})
    return snap.to_dict()


def run_scan(db, ref, expected):
    scan = _claim(db.transaction(), ref, expected)
    if not scan:
        return
    project_id = scan['projectId']
    try:
        def log(kind, *args):
            if kind == 'phase':
                ref.update({'phase': args[0][:200], 'updatedAt': S.now()})

        result = S.collect(scan['urls'], browser_records=scan.get('browserRecords') or None, log=log)
        if result['needs_browser'] and not scan.get('browserRecords'):
            # hand over to the Node function (headless Chrome), keep what we have
            ref.update({'status': 'needs_browser', 'browserFor': result['needs_browser'], 'phase': 'Opening the listing in a browser',
                        'warnings': result['warnings'], 'updatedAt': S.now()})
            return
        pages = {d.id: d.to_dict() for d in db.collection('projects/%s/pages' % project_id).stream()}
        assets = [d.to_dict() for d in db.collection('assets').where('projectId', '==', project_id).stream()]
        cards = [d.to_dict() for d in db.collection('projects/%s/cards' % project_id).stream()]
        writes, scan_patch = S.plan_writes(project_id, scan, result, pages, assets, cards)
        _commit(db, writes)
        ref.update(scan_patch)
        db.document('projects/%s' % project_id).update({'lastEditedAt': S.now()})
    except Exception as exc:  # never a raw trace in the UI (PRD §81)
        ref.update({'status': 'failed', 'error': S.friendly(exc), 'errorDetail': repr(exc)[:2000], 'updatedAt': S.now()})
        raise


@firestore_fn.on_document_written(document='scans/{scanId}')
def on_scan(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    after = event.data.after
    if after is None or not after.exists:
        return
    status = after.get('status')
    before = event.data.before
    if before is not None and before.exists and before.get('status') == status:
        return
    if status in ('queued', 'enrich'):
        run_scan(_db(), after.reference, status)
