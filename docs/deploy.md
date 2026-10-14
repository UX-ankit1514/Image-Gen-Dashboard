# Deploying

Everything below is outward-facing and needs your accounts. Steps marked **you** happen in a console.

## 1. Firebase (database + backend jobs)

1. Create the project (or tell Claude to run it): `firebase projects:create arnifi-creative-studio`
2. **You:** Firebase console → upgrade to **Blaze** (Cloud Functions require it; the free quota covers normal use).
3. **You:** Firestore → Create database → Native mode → location **asia-south1** (permanent).
4. **You:** Project settings → Service accounts → *Generate new private key* (for the Worker). Keep the JSON safe.
5. Point the CLI at it: `firebase use --add arnifi-creative-studio` (alias `prod`).
6. Secrets for the functions (R2 keys from step 2.3):
   ```bash
   firebase functions:secrets:set STORAGE_ACCESS_KEY_ID
   firebase functions:secrets:set STORAGE_SECRET_ACCESS_KEY
   ```
7. Deploy rules, indexes and both function codebases:
   ```bash
   STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com STORAGE_BUCKET=arnifi-studio STORAGE_REGION=auto \
     npm run deploy:firebase -- --project prod
   ```
   (`firestore.rules` denies all client access — only the Worker's service account and the functions read/write.)

## 2. Cloudflare (app, API, files)

1. **You:** `! npx wrangler login`
2. **You:** dashboard → R2 → enable (needs a payment method; 10 GB free).
3. Bucket + S3 credentials: `npx wrangler r2 bucket create arnifi-studio`; **you:** R2 → *Manage API tokens* →
   create an Object Read & Write token scoped to the bucket (gives the access key id + secret).
4. Worker config: in `apps/web/wrangler.jsonc` set `FIRESTORE_PROJECT_ID` to the Firebase project id,
   `STORAGE_ENDPOINT` to `https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_REGION` to `auto`.
5. Worker secrets (from `apps/web`):
   ```bash
   npx wrangler secret put GOOGLE_SA_EMAIL        # client_email from the service-account JSON
   npx wrangler secret put GOOGLE_SA_KEY          # private_key from the JSON (with \n escapes)
   npx wrangler secret put STORAGE_ACCESS_KEY_ID
   npx wrangler secret put STORAGE_SECRET_ACCESS_KEY
   npx wrangler secret put TOKEN_KEY              # `openssl rand -base64 32`
   ```
6. Deploy: `npm run deploy:web` → prints `https://arnifi-creative-studio.<you>.workers.dev`.

## 2b. Vercel instead of Cloudflare (app, API and processing)

On Vercel, Firebase is only the database: no Firebase Functions and no Blaze plan. Files go to any
S3-compatible bucket (Backblaze B2, R2 …). From section 1 you only need the project, Firestore and the
service account, plus the rules and indexes (they deploy on the free Spark plan):
`firebase deploy --only firestore:rules,firestore:indexes --project <project-id>`.

* Project settings: **Root Directory `apps/web`**. `apps/web/vercel.json` sets the build
  (`npm run build:vercel`), which writes `.vercel/output`: the SPA as static files, the API as one Node.js
  function at `/api` (region `bom1`, next to Firestore in asia-south1), everything else → `index.html`.
* Processing runs in two more functions in the same deployment. `/api/internal/run`
  (`apps/functions/src/vercel.ts`, Node.js, headless Chrome) runs the image, render and export jobs and
  the browser step of a scan; `/api/internal/scan` (`python/vercel_scan.py`, Python 3.12) runs the
  scanner. There are no triggers: the API calls the runner after each change, and the job, scan and
  export polls call it again when work has waited more than 8 s, so a lost call costs seconds. Only one
  runner works at a time (`runner/lease` in Firestore). The functions call each other with a header
  derived from `TOKEN_KEY`.
* Limits (Hobby plan): a job gets at most 300 s, so an export of more than about 60 cards may stop and is
  retried, then marked failed; each poll of the project page reads the last day of jobs only, to stay
  inside Firestore's free 50,000 reads a day.
* Settings → Environment Variables (Production):
  `FIRESTORE_PROJECT_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY` (the private key, `\n` escapes are fine),
  `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION` (`auto` for R2), `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`, `TOKEN_KEY`. Redeploy after adding them. Until they are set, the app shows
  which ones are missing.
* Differences from the Worker: no Cloudflare Access gate in front (the URL is public; turn on Vercel
  Deployment Protection), no Workers rate-limit binding, and request bodies are capped at 4.5 MB, so
  uploads larger than that fail.

## 3. Cloudflare Access (no app login, but not public)

**You:** Zero Trust → Access → Applications → *Self-hosted* → the workers.dev hostname (or your domain):
* Policy **Allow** → *Emails* → your address(es) (one-time PIN login).
* A second application/policy for the path `/api/companion/*` → **Bypass** (the companion authenticates with
  its own device token; pairing codes are single-use and expire in 10 minutes).

## 4. Companion against production

```bash
npm run companion -- unpair      # if paired to localhost
npm run companion -- pair --url https://arnifi-creative-studio.<you>.workers.dev --code <code from AI Connections>
npm run companion
```

## 5. Smoke test

`ACS_URL=https://…/api npx tsx tools/dev/smoke.ts https://arnifi.com/services/will-drafting` (from a machine
that passes Access, or temporarily with a service token), then open the project in the browser.

## Optional: cloud "Sign in with ChatGPT"

When OpenAI approves the integration, set `OPENAI_OAUTH_AUTHORIZE_URL`, `OPENAI_OAUTH_TOKEN_URL`,
`OPENAI_OAUTH_CLIENT_ID` (and `OPENAI_OAUTH_REVOKE_URL` if provided) on the Worker; the
*Continue with ChatGPT* button appears and uses PKCE. The redirect URI is
`https://<host>/api/connections/openai/oauth/callback`.
