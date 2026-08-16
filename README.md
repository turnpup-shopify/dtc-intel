# Landing Page Copy Swipe File

A semi-automated pipeline that discovers competitor landing pages, extracts and scores their
copy against a fixed rubric, presents survivors in a fast human review queue, and stores the
saved copy in a searchable, tagged archive.

**The product is retrieval.** A block of copy is only worth storing if it can be found later at
the moment someone is writing.

Single-tenant. One ecommerce leader, plus a small marketing team later. No orgs, no roles.

---

## Stack

- **Next.js** (App Router) on **Vercel**, with **Vercel Cron** for scheduled jobs
- **Supabase** — Postgres, Storage, pgvector
- **Anthropic API** — `claude-sonnet-5` for extract + score
- **Scraping provider** behind an adapter interface (`src/lib/scrape/`)

---

## Deploy

### 1. Supabase

Create a project, then run the migration — either `supabase db push`, or paste
`supabase/migrations/0001_init.sql` into the SQL editor. It creates the schema, the
transactional `ingest_page_version` RPC, the `rebuild_ad_hooks` rollup, the
`search_copy_blocks` search function, and the private `screenshots` bucket.

### 2. Seed the brand list

```bash
cp .env.example .env.local     # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run seed
```

Loads `data/seed-brands-candidates.csv` into `companies`. Seven rows arrive with a verified
`meta_page_id` and are usable immediately; the rest are inert until you paste page_ids on
`/companies`. Re-running is idempotent.

### 3. Vercel

Push to GitHub, import the repo, set the environment variables from `.env.example`, deploy.
`vercel.json` registers both cron jobs — daily ad polling at 13:00 UTC, weekly sitemap diff
Mondays at 14:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically as long
as the env var is named `CRON_SECRET`.

Set `APP_PASSWORD` to put a shared-password gate in front of the app. Leave it unset and the
deployment is open to anyone with the URL — every route runs on the service-role key, so on a
public Vercel domain you want the gate.

---

## The five screens

| Route        | What it does |
|--------------|--------------|
| `/review`    | The core loop. Screenshot left, extracted blocks + six scores + rationale right. Keyboard-only. |
| `/hooks`     | Ranked ad headlines with a paste-back field for the landing page URL. |
| `/library`   | Saved pages, `stars desc, composite_score desc`. Filter by brand, tag, block type. |
| `/search`    | Full-text over `copy_blocks`. Results are **blocks**, not pages. |
| `/companies` | Admin table for pasting `meta_page_id` values. |

Review keys: `S` save · `X` discard · `0`–`3` stars · `T` tag · `J`/`K` next/prev · `Space` scroll.

---

## How a page gets in

Three tiers, all landing in the same queue:

1. **Manual paste** — the box at the top of `/review`, or `POST /api/pages { url }`.
2. **Ad hooks** — the daily poll pulls active US ads per seeded `page_id` and rolls them up by
   normalized headline. You click the snapshot, land on the page, paste the URL back.
3. **Sitemap diff** — weekly, `/sitemap_pages.xml` per brand, diffed against known URLs.

Each URL runs the same pipeline: fetch + screenshot → reduce to text → hash → one Anthropic
call for extract + score → gate on `SCORE_THRESHOLD` → write page/version/blocks/tags in one
transaction. Below threshold is inserted as `discarded` and never reaches the queue; that gate
is what keeps daily review survivable.

Recapture hashes the cleaned text. Same hash is a no-op (and skips the model call entirely).
Different hash inserts a new version, flips `is_current`, and leaves the old blocks intact —
so "this page's hero changed in March" comes for free.

**Human decisions are permanent; the gate's are not.** On recapture, a page you have never
reviewed (`reviewed_at IS NULL`) is re-gated against the new score — so a page auto-discarded
at 3.2 that gets rewritten and now scores 4.6 comes back into the queue instead of being
buried forever. Once you have ruled on a page, its status, stars, and tags are yours and
recapture never overwrites them.

---

## API

```
POST /api/pages           { url }        → enqueue manual page, run pipeline
GET  /api/queue                          → pages where status='queued'
POST /api/pages/:id/review { status, stars, tags[] }
GET  /api/hooks                          → ad_hooks where status='new', ranked
POST /api/hooks/:id       { status, resulting_url? }
GET  /api/search          ?q=&block_type=&company=&min_stars=
GET  /api/library         ?company=&tag=&block_type=
GET  /api/companies
POST /api/companies/:id   { meta_page_id }

POST /api/cron/poll-ads       (Bearer CRON_SECRET)
POST /api/cron/sitemap-diff   (Bearer CRON_SECRET)
```

---

## Choosing a scraping provider

`SCRAPER_PROVIDER` selects the adapter. Three ship:

- `scrapingbee` — renders JS, survives Cloudflare. Two calls per page (HTML, then screenshot);
  the vendor won't return both at once.
- `scrapfly` — HTML and screenshot metadata in one JSON response.
- `fetch` — plain `fetch`, no JS rendering, no screenshot. Local development only; Cloudflare
  blocks it and most Shopify landing pages render their hero client-side.

Spec §12 asks you to evaluate two or three against Shopify-heavy targets before committing.
Swapping is a one-env-var change; nothing above `src/lib/scrape/types.ts` knows the vendor.

---

## Build status

- **Phase 1 — manual loop.** Complete. Migration, seed load, scrape adapter, text reduction,
  extract + score, `/review`, `/library`.
- **Phase 2 — automated sourcing.** Complete. Ad Library polling, hook rollups, `/hooks`,
  sitemap diffing, both cron routes.
- **Phase 3 — retrieval.** Full-text `/search` complete. Hybrid semantic ranking is **not**
  built — see below.

### On embeddings

`copy_blocks.embedding vector(1536)` exists and pgvector is enabled, but nothing populates it.
Anthropic has no embeddings endpoint, so hybrid lexical + semantic ranking needs a second
vendor (Voyage, OpenAI, Cohere) that the spec doesn't name. Full-text search works today; the
column is there so adding semantic ranking later is a backfill, not a migration.

---

## Deviations from the spec

Three, all forced:

1. **`days_running` formula.** The spec writes it as `(last_seen_at::date - first_seen_at::date)`.
   Casting `timestamptz` to `date` is `STABLE`, not `IMMUTABLE`, so Postgres rejects it in a
   generated column. The stored column uses the equivalent immutable epoch form.
2. **`search_copy_blocks` projects `block_position`, not `position`.** `position` is reserved in
   a `RETURNS TABLE` clause. The `copy_blocks.position` column itself keeps its spec name.
3. **A shared-password gate exists** (`APP_PASSWORD`, `src/middleware.ts`). Not in the spec, and
   not multi-tenancy — just a lock on the front door, since the app runs entirely on the
   service-role key.

---

## Operational notes

- **Alert on zero-result poll days.** `/api/cron/poll-ads` returns an `alert` field and logs to
  stderr when every seeded page returns nothing. A silent scraper failure is indistinguishable
  from a quiet week — wire that field to whatever you actually watch.
- **Tier 1 is weak for six weeks.** There is no server-side longevity filter on the Ad Library,
  so variant count and days-running accumulate from your own polling history. Don't judge the
  hooks queue on its first fortnight.
- **Tune `SCORE_THRESHOLD` weekly** against save rate. Above 40% saved means the rubric is too
  loose; below 10% means sourcing is wrong.
- **Cron work is batched.** The sitemap diff processes at most `DAILY_PAGE_CAP` pages per run and
  reports the deferred count rather than looping through everything it found.

## Still yours to decide (spec §12)

1. Which scraping provider, after testing two or three against Shopify-heavy targets.
2. Whether the `advertorial` tier feeds this queue or a separate one. Those operators score high
   on objection handling and low on proof density; mixing them may distort the category baseline.
3. Rubric weights, after the first 50 reviewed pages.
