# PRD traceability

Status: **Done** = built and exercised (tests, E2E or a live run) · **Partial** = built with a stated gap ·
**Deviation** = built differently by decision (see architecture.md) · **Gated** = built, switched off
pending an outside approval.

| § | Requirement | Where | Status |
|---|---|---|---|
| 1–2 | One workspace for the four modes; dashboard holds the context | whole app; context in Firestore, never in prompts | Done |
| 3 | Bring your own subscription; no API keys | `apps/companion`, `packages/providers` | Done |
| 4.1 | ChatGPT via OpenAI-supported sign-in, capabilities detected | companion runs the official Codex CLI signed in with ChatGPT; cloud OAuth/PKCE in `packages/providers/src/oauth.ts` + `worker/routes/ai.ts` | Done (companion) · Gated (cloud OAuth) |
| 5 | Claude via Local Companion + Claude Code subscription | `apps/companion/src/providers/claude.ts` | Done (live run) |
| 6 | Provider abstraction, capability-driven UI, never silently switch to API | `provider.ts`, `pickProvider`, env scrubbing in `exec.ts` | Done |
| 7–9 | Goals, non-goals, Workspace → Project → Cards → Versions | domain model | Done |
| 10 | Minimal navigation | `shell/AppShell.tsx` | Done |
| 11 | Projects home with stats and actions | `pages/Projects.tsx` | Done |
| 12 | New project in six decisions; any layer combination | `pages/NewProject.tsx` | Done |
| 13 | URL classification, structured-first extraction, all fields | `python/scanner/scan.py` over `legacy_pipeline/` | Done |
| 14 | Scan results before generation, select, create, rescan | `pages/Scan.tsx` | Done |
| 15 | Every candidate image with dims/format/source; flags; user chooses | Scan → image discovery; `packages/scraper/src/image.ts` | Done (text/logo confirmed by AI vision on demand) |
| 16 | Paste/drop/upload screenshots; analysis; no pretend scrape; attach URL | uploads + auto vision analysis; “No live page connected” + Attach | Done |
| 17 | Project workspace grid with filters and card status | `pages/Workspace.tsx` | Done |
| 18 | Card editor layout | `editor/EditorPage.tsx` | Done |
| 19 | Layer-based canvas with full layer properties | `CardScene` + `editor/Canvas.tsx` | Deviation (DOM, not Konva) |
| 20 | Layer panel: visibility, lock, drag order, duplicate, delete-where-permitted | `editor/LeftPanel.tsx` | Done |
| 21 | Background sources and controls, independent focal point | `BackgroundInspector.tsx` | Done |
| 22 | Gradient controls and presets | `GradientInspector.tsx`, `presets.ts` | Done |
| 23 | Prompt-based gradient editing as structured config with preview/apply/apply-to-selected | `router.ts`, `PromptBar.tsx` | Done (E2E) |
| 24 | Logo controls, aspect lock, safe area, warnings | `LogoInspector.tsx`, `validate.ts`, render contrast check | Done |
| 25–26 | Heading/subheading with provenance; never silently replace | `TextInspector.tsx` | Done |
| 27–28 | Dimensions any time; scale / keep / reflow; previous kept | `ResizeDialog`, `resize.ts` | Done (E2E) |
| 29 | Select, drag, resize, snap, multi-select, nudge, undo/redo, zoom, pan, guides | `Canvas.tsx`, `store.ts` | Done (rotation by number, no rotate handle) |
| 30–31 | Prompt bar; intent router; smallest change | `router.ts` (10 intents) + AI classifier | Done |
| 32 | Scope: card / selected / project / project default | prompt bar, batch bar | Done |
| 33–36 | Generation with auto context, variations, never overwrite, prompt architecture, negative constraints | `compose.ts`, `GenerateDialog.tsx`, `services/ai.ts` | Done (live run via ChatGPT plan) |
| 37 | Editable brief always sent to AI | Brief & rules dialog | Done |
| 38 | Templates / recipes | `recipes.ts`, `pages/Templates.tsx` | Partial (edit name/brief/negatives; layer defaults edited via project defaults) |
| 39 | Batch editing with versions per card | `BatchBar`, `services/batch.ts` | Done |
| 40 | Project default + card override, no duplication | defaults revisions + sparse overrides | Done |
| 41 | Card states and pipeline | `CardStatus`, `CardStage` | Done |
| 42 | Structured rejection with feedback | `RejectDialog`, `rejectCard` | Done (E2E) |
| 43 | Regeneration context from rejection | `composeGenerationPrompt` | Done |
| 44 | Every meaningful change is a version with metadata; preview/compare/restore/duplicate | history panel | Done |
| 45 | Side-by-side / slider / overlay | `editor/Compare.tsx` | Done |
| 46 | Asset library (project + global) | `pages/Assets.tsx` | Done |
| 47 | Duplicate detection (URL, hash, perceptual) and actions | ingest dHash/sha256, `DuplicatesNotice` | Done |
| 48 | Exception inbox | `pages/Review.tsx`, `buildInbox` | Done |
| 49 | Nothing important only in browser memory | Firestore + drafts + keepalive flush | Done (E2E reload) |
| 50–51 | Operational database and entities | Firestore collections | Deviation (Firestore) |
| 52 | Design JSON | `packages/types/src/design.ts` | Done |
| 53 | Object storage layout | `packages/storage` | Done (R2/MinIO) |
| 54 | Provider-independent rendering, same coordinates | `CardScene` + `packages/raster` | Done |
| 55 | Legacy migration with parity tests first | `tools/parity` (15/15), `tools/import-legacy`, folder import | Done |
| 56 | Scraping hierarchy, persist, no rescrape on open | scanner + `expandServices` | Done |
| 57 | Site change detection, approved untouched | `diff_page`, `SourceChangesBanner` | Done (unit-tested) |
| 58–60 | AI Connections page, plan wording, usage limits | `pages/Connections.tsx`, `UsageLimitDialog` | Done |
| 61 | Local companion, 6-digit pairing, device token | `apps/companion`, `pairDevice` | Done (live) |
| 62 | Provider security rules | see architecture.md | Done |
| 63 | Tech stack | — | Deviation (see table) |
| 64 | Background jobs, statuses, retry failed | job documents, `JobsStrip` | Done |
| 65–66 | Autosave, undo/redo | `EditorPage`, `store.ts` | Done |
| 67–69 | Export formats, scales, extras, safety, naming | `ExportDialog`, `jobs/export.ts` | Done (E2E) |
| 70–74 | Visual language, typography, spacing, editor styling | Tailwind tokens in `styles.css` | Done |
| 75 | Keyboard shortcuts | `EditorPage` | Done |
| 76 | Performance: thumbnails only, lazy loading, async batches | `Thumb`, variants | Done |
| 77 | Reliability on refresh, retryable jobs | — | Done |
| 78 | Security requirements | — | Done |
| 79 | Roles modelled, no permission UX | `Workspace.members` | Done (no auth by decision; Access gate) |
| 80 | Audit events | `services/audit.ts`, Settings → Activity | Done |
| 81–82 | Friendly errors, empty states | `friendly()`, `Empty` | Done |
| 83 | Success metrics | `/api/stats`, Settings | Done |
| 84–88 | Phases 1–5 | — | Done |
| 89–90 | Intelligence: change detection, similarity, consistency review, rule suggestions | `consistencyTask`, `SuggestionsPanel` | Done (live run) |
| 91–99 | Edge cases | needs-image status + actions, repeated image, text flags, auto-fit floor, mapping screen, AI optional, pause on limit, disconnect, page removed | Done |
| 100 | Engineering rules | legacy untouched, parity first, separation, adapters, DB context | Done |
| 102 | Definition of done scenario | `tests/e2e/definition-of-done.spec.ts` | Done (passes) |
| 104 | Connect your AI | — | Done |
