# Architecture

## Decisions (confirmed 2026-10-12) and how they differ from the PRD stack

| PRD suggested | Built | Why |
|---|---|---|
| PostgreSQL + Prisma | **Firestore** | product decision |
| Next.js server | **Vite SPA + Hono on a Cloudflare Worker** | Cloudflare hosting; Next SSR needs the paid CPU tier and the editor is client-side |
| Redis + BullMQ | **Firestore job documents + Firebase Functions triggers** | Firebase backend; jobs survive restarts, retries are a status flip |
| S3 / R2 | **Cloudflare R2** (MinIO locally), one S3 client | Cloudflare storage |
| Konva canvas | **DOM/CSS renderer shared by editor and export** | pixel parity with shipped cards (proven) |
| user accounts | **none in-app; Cloudflare Access gates the URL** | product decision; roles are modelled for later |
| Layer table | Layers are typed objects inside Design JSON | versions stay immutable snapshots |

## Components

```
Browser SPA ──/api──► Cloudflare Worker (Hono) ──REST──► Firestore ◄──Admin── Firebase Functions
     │                    │  presigned URLs                                ├ node: ingest · render · export · expandServices · resumePaused
     └──── images ◄───── R2 (S3) ◄────────────────── S3 API ───────────────┘ python: on_scan (legacy extractor)
Local Companion (Mac) ──device token──► Worker /api/companion/*  → claude / codex CLIs
```

* **Worker** (`apps/web/worker`): JSON API, validation (zod), CSRF (custom header + same-origin), rate limits
  (Workers rate-limit binding), friendly errors, presigned asset URLs. Talks to Firestore over REST with a
  service-account JWT signed in WebCrypto (`packages/firestore/src/google-auth.ts`).
* **Functions (Node)** (`apps/functions`): one `onJob` trigger fires when a job document enters `queued`
  (created or retried), claims it in a transaction and runs `ingest`, `render` or `export`.
  `onScanNeedsBrowser` is the browser rung of the scraping ladder. `resumePaused` re-queues jobs paused on a
  provider usage limit.
* **Functions (Python)** (`python/main.py`): `on_scan` runs the legacy extractor (`legacy_pipeline/`,
  verbatim) through `scanner/` — SSRF-safe fetch, extra fields, image discovery, persistence, rescan diffs.
* **Companion** (`apps/companion`): pairs with a 6-digit code, heartbeats what is installed and how it is
  signed in, claims AI jobs, runs them with the official CLIs, uploads results.

## Data model (Firestore)

```
workspaces/{ws}                         recipes/{id}
projects/{p}                            scans/{id}          assets/{id}
  revisions/{rev}   ← immutable bases   jobs/{id}           batches/{id}
  pages/{id}/snapshots/{scan}           exports/{id}        auditEvents/{id}
  cards/{c}/versions/{v}                connections/{openai|claude}
  cards/{c}/feedback/{f}                companionDevices/{id}   pairingCodes/{hash}   oauthStates/{s}
  changes/{id} references/{id} suggestions/{id}
```

* **Project default + card override** (PRD §40): a project points at an immutable *defaults revision*
  (the full base design). A card version stores only `overrides` (sparse, by stable layer id) plus the
  revision it applies to. Resolved design = `applyOverrides(revision.base, overrides)`
  (`packages/renderer/src/resolve.ts`). A project-default change writes a new revision and new versions for
  the affected cards; approved cards keep theirs unless the user includes them.
* **Draft vs versions** (PRD §44, §65): the editor autosaves the card's `draft` (debounced, silent) and turns
  it into a named version at meaningful moments (⌘S, idle, leaving, review actions, AI apply, resize).
* **Approval pointer** (PRD §68): `approvedVersionId` never moves on edit; exports use it; rejecting the
  approved version clears it, so a rejected version can never ship.

## Rendering and parity (PRD §54–55)

`CardScene` (`packages/renderer/src/CardScene.tsx`) renders Design JSON to DOM. The editor mounts it scaled;
`packages/raster` renders the same component to a file page and screenshots it with Chrome launched with
`--force-device-scale-factor=2` (puppeteer's emulated DPR shifted text by ~1 px), then downsamples with a
bit-exact port of Pillow's LANCZOS (`packages/raster/src/lanczos.ts`; sharp's lanczos3 differed by 0.6/255).
`npm run parity` rebuilds 15 shipped cards (dark `card.py` and light `relight.py`, studio and legacy font
stacks, boosted cards) from their clean photos: 12 bit-identical, all ≤ 0.12/255 (Chrome drift since they
shipped). Cloud renders use `@sparticuz/chromium` on Linux, whose glyph anti-aliasing differs slightly from
macOS Chrome; legacy system-serif cards can only match exactly when rendered on a Mac.

## Scanning (PRD §13–15, §56–57)

Ladder: Arnifi Flight-payload records (legacy) → generic Next payload → DOM (any public page) → headless
Chrome for services listings whose payload has fewer records than its `total`. Every request and redirect
is DNS-checked against private ranges. Images are fetched, magic-byte validated, analysed (thumb + preview
variants, sha256, dHash, ink score → low-res / duplicate / possible text / aspect flags) and stored. Rescans
diff against snapshots and raise `changes`; approved cards are never modified.

## AI connection layer (PRD §3–6, §58–62)

`AIProvider` adapters with **detected** capabilities (`packages/providers/src/provider.ts`). Today both run on
the companion: Claude Code (text, vision, structured via `--json-schema`; no images) and Codex with ChatGPT
(text, vision, structured via `--output-schema`, image generation/editing via its built-in tool, capability
verified by use). The cloud OAuth (PKCE S256 + state, AES-GCM token vault, server-side refresh, revoke on
disconnect) is implemented and switched off until OpenAI issues an approved integration.

Every request is classified first (`router.ts`): gradient, layout, copy-with-quotes, dimensions and
repositioning are handled by rules instantly with no AI; the rest go to a provider with a strict schema.
Generation prompts are composed from the database (`compose.ts`): system rules, recipe, brief, rules, page,
design state, references, rejection history, negative constraints, request — and stored on the job.
A usage limit pauses the job (never an API fallback) and shows the PRD §60 dialog.

## Security (PRD §62, §78)

No passwords, cookies or provider tokens leave the Mac; companion device tokens are stored hashed; provider
OAuth tokens are encrypted at rest; Firestore rules deny all client access; asset URLs are presigned and
expiring; uploads are type-checked by content and size-capped; external URLs are SSRF-checked per hop;
mutations need a custom header and same origin; rate limits on the API and companion routes; audit events
for the PRD §80 list.
