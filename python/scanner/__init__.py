"""Creative Studio's scanner: the legacy Arnifi extractor (legacy_pipeline/) wrapped for Firestore.

The legacy functions (detect, flight, scrape._record, scrape.parse_detail) are used unchanged; this
package only adds an SSRF-safe fetch, the extra fields the PRD asks for (§13), image discovery (§15),
persistence, and change detection on rescans (§57).
"""
import os
import sys

LEGACY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'legacy_pipeline')
if LEGACY not in sys.path:
    sys.path.insert(0, LEGACY)
