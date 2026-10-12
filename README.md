# Arnifi Creative Studio

A persistent visual workspace for Arnifi's branded marketing cards (PRD: `~/Documents/Dashboard PRD.rtf`).
Paste an Arnifi page or section, see what was found, create cards, edit them on a real canvas, review and
approve, export — and come back a week later to find every card, version, position, approval and source
link exactly where you left it. AI (your own ChatGPT / Claude subscriptions) helps; it is never required.

```
URL ─► scan (legacy Arnifi extractor) ─► pages + images ─► cards ─► editor ─► review ─► export ZIP
                                                   ▲                    │
                     ChatGPT / Claude via the Local Companion ──────────┘  (suggestions, copy, backgrounds)
```

## Run it locally

Requirements (macOS): Node ≥ 22.17, Java 21 (Firestore emulator), Google Chrome, `brew install minio python@3.12`,
Firebase CLI (`npm i -g firebase-tools`).

```bash
npm install
(cd python && python3.12 -m venv venv && venv/bin/pip install -r requirements.txt)
npm run dev            # MinIO + Firestore/Functions emulators + Worker + SPA
open http://localhost:5173
```

`npm run dev` keeps emulator data in `.data/` between runs. Emulator UI: http://127.0.0.1:4000.

### Connect your AI subscriptions (optional)

AI Connections → **Pair a companion** shows a 6-digit code, then on the same Mac:

```bash
npm run companion -- pair --url http://localhost:5173 --code 123456
npm run companion        # keep it running
```

The companion runs the official `claude` (Claude Code, signed in with Claude Pro/Max) and `codex`
(signed in with ChatGPT) CLIs. It refuses API-key sign-ins and strips API keys from the environment, so a
subscription is never swapped for paid API usage.

## Tests

| Command | What it proves |
|---|---|
| `npm test` | unit tests: overrides, size ladder, resize, layout warnings, intent router, prompt composer, naming, crypto, matcher |
| `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test` | domain flows against the emulator (versions, approval pointer, export safety, batch, project defaults, transactions) |
| `npm run test:py` | the scanner on recorded Arnifi pages — legacy extractor output unchanged, change detection, SSRF blocks |
| `npm run parity` | **the renderer gate**: 15 shipped cards rebuilt from their photos, 12 bit-identical, all ≤ 0.12/255 |
| `npm run e2e` | PRD §102 end to end through the UI on a live Arnifi section (needs `npm run dev`) |
| `npm run typecheck` | everything compiles |

## Layout

```
apps/web          Vite React SPA + Hono API on a Cloudflare Worker
apps/functions    Firebase Functions (Node): ingest, render, export, services-listing browser step
apps/companion    Local Companion CLI (claude / codex)
python/           Firebase Functions (Python): the scanner; legacy_pipeline/ is a verbatim copy of arnifi-studio/pipeline
packages/types    Design JSON + domain + API schemas (zod)
packages/renderer CardScene (the one renderer), recipes, gradient presets, resize, layout warnings, legacy mapping
packages/raster   Design → pixels with Chrome at 2× + Pillow-exact Lanczos (export + previews)
packages/firestore domain services over Firestore (REST for the Worker, Admin SDK in Functions)
packages/providers AI provider contract, intent router, prompt composer, OAuth (PKCE) scaffold
packages/scraper  SSRF-safe fetch, image analysis (variants, dHash, ink score), in-page services fetch
packages/storage  S3-compatible client (R2 in production, MinIO locally)
tools/parity      visual-regression gate against shipped cards
tools/import-legacy  bulk import of previous card runs into projects
tests/e2e         Playwright (PRD §102)
docs/             legacy-behavior · architecture · deploy · prd-traceability
```

Read next: [docs/architecture.md](docs/architecture.md) · [docs/deploy.md](docs/deploy.md) ·
[docs/prd-traceability.md](docs/prd-traceability.md) · [docs/legacy-behavior.md](docs/legacy-behavior.md)
