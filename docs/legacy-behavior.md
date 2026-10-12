# Legacy behaviour (what Creative Studio must preserve)

PRD §105: "Inspect the complete existing Arnifi Studio repository … Document existing behavior. Do not
remove working production logic." This file records what the existing tools do, where the logic lives
now, and where it lives in Creative Studio. The originals are untouched; `python/legacy_pipeline/` is a
verbatim copy of `~/Desktop/files/arnifi-studio/pipeline/` taken on 2026-10-12.

## Sources inspected

| Tool | Path | Role today |
|---|---|---|
| Arnifi Card Studio | `~/Desktop/files/arnifi-studio/` | Vite/Express/Razorpay Blade app that drives the Python pipeline; dark cards |
| Light-gradient relight | `~/Desktop/files/new images/_system/` | `relight.py`, `gradient.py`, per-page builders (legal, visa, attestation, …); current production look |
| Earlier one-off builders | `arnifi-country-cards/`, `Start your Business - …/build_*.py`, `Service - Post setup compliance/` | superseded by the studio pipeline; read-only history |

## Scraping (`legacy_pipeline/detect.py`, `flight.py`, `scrape.py`)

* **URL kinds** (`detect.detect`): `/product-listing?…` → product listing, `/services/<type>` → service
  listing, `/product-details/<…>/<slug>` → single product, `/services/<type>/<slug>` → single service.
  Anything not on `arnifi.com` is rejected.
* **`pageSize=100`** is appended to listing URLs so "Load More" never has to be clicked
  (`detect.listing_url`). This works for product listings. For `/services/<type>` the page still only
  server-renders 12 records and "Load More" pages through `prodapi.arnifi.com` with a buggy `skip=11`;
  the API answers 502 to outside requests, so `new images/_system/services.mjs` fetches
  `https://prodapi.arnifi.com/api/micro-services/<Type>?page=1&pageSize=100` from *inside* the page in
  headless Chrome. Known API names: Funds, Liquidation, `Post-Setup Compliance`, `Legal Service`
  (singular), `Visa Services` (plural), Attestation, `Accounting & Bookkeeping`.
* **Data source**: React-Flight chunks `self.__next_f.push([1,"…"])`, joined and scanned for
  `"product":{…}` / `"service":{…}` objects with a brace-matching scanner (`flight.objects`). Never the
  Emotion class hashes (`mui-29kdqi`), which change every site build.
* **Record normalisation** (`scrape._record`): product → name/slug/authority/country/flag/banner
  (`productBanner.SliderImages[0]`)/price/currency/category; service → `bottomTitle`|`topTitle`,
  `bottomSubTitle`|`topSubTitle`, `badgeLabel`|`chips[0].label` (Attestation keeps its country in chips),
  `banner`, `startingPrice`, `estimatedDeliveryTime`, `type`.
* **Detail URL**: the canonical `/product-details/<type>/<authority>/<slug>` serves the full page; the
  short `/product-details/<slug>` answers 200 but is a stub *without* Highlights — silent failure. Short
  form kept as fallback.
* **Detail parsing** (`scrape.parse_detail`): `<h1>` word for word; the Highlights & Benefits section
  in two markups (h3 titles, or older h2/p pairs), ending at "Documents from" / "Process Flow" / "FAQs".
* **Huge banners**: will-drafting banners are 21328×11396 (243 MP). Pillow's bomb limit is raised and
  anything over 60 MP is resampled to a 4000 px long edge on the way in.
* Dedupe by slug on listings (`relight.py` dedupes by product **id**: the CMS has duplicate slugs).
* Country spelling fix for folder names only: `Malasiya` → `Malaysia`.

Creative Studio: `python/main.py` wraps these functions unchanged (SSRF-safe fetch injected, extra fields
extracted on top). The in-page services fetch is ported to `apps/functions/src/scan/expandServices.ts`.

## The card template (`legacy_pipeline/card.py`) — "Arnifi Classic"

1600×1000, background `#0b0922`.

| Element | Rule |
|---|---|
| Photo | `object-fit:cover; object-position:center 42%`; filter `saturate(.60) contrast(1.07) brightness(.86)` |
| wash | `mix-blend-mode:multiply`, `linear-gradient(130deg, rgba(52,45,124,.70) 0%, rgba(84,74,148,.46) 44%, rgba(46,46,163,.58) 100%)` |
| tone | `linear-gradient(180deg, rgba(16,13,50,.46) 0%, rgba(16,13,50,.08) 30%, rgba(13,11,42,.52) 68%, rgba(10,8,32,.88) 100%)` |
| side | `linear-gradient(90deg, rgba(10,8,34,.66) 0%, rgba(10,8,34,.18) 42%, rgba(10,8,34,0) 66%)` |
| vig | `radial-gradient(118% 94% at 62% 32%, rgba(0,0,0,0) 44%, rgba(8,6,30,.58) 100%)` |
| grain | `grain.png` tiled at 256 px, opacity .05, `overlay` |
| Logo | Arnifi SVG with `#2E2EA3` → `#FFFFFF`, `top:52 left:64`, 196×55, `drop-shadow(0 2px 12px rgba(0,0,0,.55))` |
| Text block | `left:64 right:120 bottom:64`, flow layout: kicker → h1 → rule |
| Kicker | 38×2 `#a79eff` line, gap 13, then Inter 16/600, `.17em`, uppercase, `#d3ceff`, `text-shadow:0 1px 10px rgba(0,0,0,.65)`; 20 px below it |
| Headline | Lora 500, line-height 1.19, `#fff`, `-.005em`, `text-shadow:0 2px 26px rgba(5,3,24,.78), 0 1px 3px rgba(5,3,24,.5)` |
| Size ladder | `fsize`: ≤34 chars 66 px, ≤48 58, ≤62 52, else 46 |
| Rule | 26 px under the headline, 96×3, radius 2, `linear-gradient(90deg,#a79eff,rgba(167,158,255,0))` |

* **Key line** (`card.kicker`): AI-chosen highlight if present, else `highlights[0].title`, else
  authority, else country; trailing punctuation stripped.
* **Repeated photos** (`render.assign_focus`): the n-th reuse of the same banner file gets
  `FOCUS[n % 7]` = `center 42%`, `32% 46%`, `68% 38%`, `46% 30%`, `58% 55%`, `24% 34%`, `76% 50%`.
* **`fit_crop`**: the largest 16:10 box inside a clear region; refuses anything narrower than 700 px.

## Rendering (`legacy_pipeline/render.py`)

* 5 cards stacked in one HTML page, one headless Chrome run, `--force-device-scale-factor=2`, window
  1600×(1000·n), `--virtual-time-budget=30000`; each 3200×2000 slice resized to 1600×1000 with Pillow
  `LANCZOS`; JPEG quality 91, `subsampling=0` (4:4:4), optimize, progressive.
* **`_looks_styled` guard**: the headline area (60,780)-(700,940) must average ≤118 and the logo area
  ≥55, or the run stops — this once caught 28 cards rendered without their stylesheet.
* Contact sheet: 6 columns of 520×325, background `#0b0922`, JPEG 88.

Creative Studio: `packages/renderer` renders the same CSS from Design JSON (one React component for
editor and export); `apps/functions/src/render` reproduces the 2× + Lanczos + JPEG settings with sharp;
`tools/parity` proves the output matches shipped cards before anything depends on it.

## The light gradient (`new images/_system/relight.py`, `gradient.py`) — "Arnifi Light"

* Same text/logo/photo rules as above (`BASE_CSS`), photo filter `saturate(1.08) contrast(1.10)`.
* Three full-frame image layers built from one colour field (`gradient.py`, 3200×2000, dithered):
  `light-grade.png` as `color` at .75, `light-grade.png` as `multiply` at .90, `light-tint.png` normal.
* **Depth boost**: when the key line's contrast against the photo falls below WCAG AA 4.5:1, that card
  alone gets `linear-gradient(90deg, rgba(35,38,86,.62) 0%, rgba(35,38,86,.42) 45%, rgba(35,38,86,0) 82%)`
  masked by `linear-gradient(180deg, transparent 52%, #000 84%)`, and is re-rendered.
* **Per-card layout overrides** measured off ChatGPT re-exports: `h1_px`, `bottom`, `kicker_gap`,
  `nowrap`, `suffix` (a `<small>` at `.6em`).
* **Two font stacks**: `studio` (Lora + Inter + grain loaded) and `legacy` (`build_real.py` linked
  `brand/` relatively, so no web fonts loaded: headline in the system serif, kicker in the system sans).
* **Verify-then-build**: every card is first rebuilt with the *old* dark wash and diffed against the live
  card (67/69 within ≤1.7/255) — only then is the light card trusted. Creative Studio's parity threshold
  (mean ≤2/255) comes from here.
* User decisions recorded in memory: keep the 1600×1000 format (logo top-left, key line + headline
  bottom-left) for every page; the 2:1 `wide` layout was rejected.

## Audit warnings (`legacy_pipeline/audit.py`)

shared photo ("One photo is the background for N cards"), no Highlights (key line falls back to the
authority), zero/missing price, no photo (no card made), low resolution (min side < 700 px, with the
upscale factor). Creative Studio maps these to card warnings and Exception Inbox categories.

## Photo text (`legacy_pipeline/phototext.py`)

`ink()` scores dark strokes inside bright fields. The README is explicit that it misjudged real cases
(a printed "Corporate Tax Registration" banner scored lowest of 29), so it orders candidates but never
decides. Creative Studio: the ink score only raises *possible text*; AI vision confirms.

## Outputs (`legacy_pipeline/outputs.py`)

`INDEX.csv` columns: `file, headline, key_point, authority, country, est_time, price, page_url,
source_photo, headline_source, key_line_source, photo_flag`; `links.txt`; `MASTER-INDEX.csv` with a `set`
column; `all-links.txt`; `run.json` manifest. File names `NN_<slug>.jpg`. Creative Studio exports keep
these files inside the ZIP alongside the PRD's naming template.

## Claude pass (`legacy_pipeline/review.py`)

`claude -p --output-format json --disable-slash-commands --strict-mcp-config --setting-sources ""`,
model/effort presets best = opus/high, balanced = sonnet/medium, fast = haiku/low; tools disallowed
for text; photos judged with `--allowed-tools Read` plus `--add-dir`. Never fatal: not signed in,
timeout or bad JSON all fall back to deterministic values. Empty replies (0 input tokens) are retried.
Creative Studio: the same invocation lives in the companion's Claude executor.

## Codex image generation (from the relight work)

`codex exec` signed in with ChatGPT generated the Legal/Visa/Attestation/Accounting photos. Gotchas:
needs `< /dev/null`; `-i <image>` goes *after* the prompt for edits; ≥3 parallel jobs hit 429; the
proxy cooldown can outlast the real limit; models invent real-sounding names and airline codes, and can
leave paper blank, so every image needs checking. Creative Studio's companion caps image jobs at 2 and
backs off on 429.
