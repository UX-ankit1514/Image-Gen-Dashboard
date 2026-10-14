"""Firebase Functions (Python): the scanner.

Triggered when a scan document is written with status `queued` (a new scan) or `enrich` (the Node
function finished fetching a services listing from inside the page). Everything else about a scan —
images, renders — happens in the Node functions via job documents.
"""
from firebase_admin import firestore, initialize_app
from firebase_functions import firestore_fn, options

from scanner.runner import run_scan

options.set_global_options(region='asia-south1', memory=options.MemoryOption.MB_512, timeout_sec=540, max_instances=5)
initialize_app()


def _db():
    return firestore.client()


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
