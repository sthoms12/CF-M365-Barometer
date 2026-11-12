# Production Handoff

Last updated: November 12, 2026

This describes the repository as it is now. It does not record live row counts, secret values, or whether a deploy is currently enabled. Check those where this document says to check.

## Repository

- GitHub repository: <https://github.com/sthoms12/CF-M365-Barometer>
- Default branch: `main`
- Worker name: `m365-barometer` (`wrangler.jsonc`)
- D1 database name used by the deploy workflow: `m365-barometer`
- Canonical origin hardcoded for public pages: `https://www.m365-barometer.com` (`CANONICAL_ORIGIN` in `src/worker/seo.ts`)
- Public pages: `/`, `/products`, `/products/:slug`, `/methodology`, `/about`, plus Markdown mirrors
- Health route: `GET /api/health` returns `{"ok":true}`

The deployed origin is the `PUBLIC_BASE_URL` repository variable. When `CUSTOM_DOMAIN` is set, `scripts/render-production-config.mjs` turns off `workers.dev` and adds that hostname as a route. Neither variable is stored in the repository.

## Catalog in migrations

`migrations/0002_seed_products.sql` inserts these products:

| Slug | Name |
| --- | --- |
| `new-outlook` | New Outlook |
| `microsoft-365-copilot` | Microsoft 365 Copilot |
| `copilot-chat` | Copilot Chat |
| `teams-premium` | Teams Premium |
| `teams-phone` | Teams Phone |
| `microsoft-loop` | Microsoft Loop |
| `microsoft-planner` | Microsoft Planner |
| `microsoft-lists` | Microsoft Lists |
| `sharepoint-agents` | SharePoint Agents |
| `microsoft-intune` | Microsoft Intune |
| `microsoft-entra` | Microsoft Entra |

`migrations/0003_archive_non_m365_products.sql` sets `is_active = 0` for `microsoft-loop`, `microsoft-entra`, and `microsoft-intune`. On a fresh database that file runs before `lifecycle_status` exists. `migrations/0003_product_validation.sql` then adds `lifecycle_status` with default `active`. Public pages and the sitemap include a product only when `is_active = 1` and `lifecycle_status = 'active'` (`getProducts` and `listSitemapProducts` in `src/worker/db.ts`).

`migrations/0004_weekly_signals.sql` creates the `signals` table and writes Wikipedia and Hacker News match settings onto the seeded rows.

A database that already applied an earlier copy of a migration will not replay that file. Do not treat the migration text as a live inventory. To see what production currently stores, query D1 database `m365-barometer`:

- `products` for the catalog (`slug`, `is_active`, `lifecycle_status`, `last_analyzed_at`)
- `sentiment_snapshots` for completed sentiment readings
- `signals` for weekly supply and demand rows
- `d1_migrations` for which migration files have been applied

The same catalog is the JSON from `GET /api/products` on the deployed origin, and the HTML at `/products`.

## Deploy

Workflow: `.github/workflows/deploy.yml` (`Deploy Cloudflare`).

It runs on pull requests to `main`, pushes to `main`, and `workflow_dispatch`.

The `check` job always runs: `npm ci`, `npm run check`, and `npm run build`.

The `deploy` job runs only when the event is not a pull request and the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is `true`. Until that variable is `true`, pushes still run check and build and skip deploy. Confirm the variable and recent runs in the repository's Actions settings, or with `gh variable list` and `gh run list --repo sthoms12/CF-M365-Barometer --workflow deploy.yml`.

When deploy runs, it:

1. Checks that `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `INGEST_TOKEN` are present.
2. Finds or creates D1 database `m365-barometer`.
3. Renders ignored `wrangler.production.jsonc` from `wrangler.jsonc`, the discovered database id, `PUBLIC_BASE_URL`, and `CUSTOM_DOMAIN`.
4. Applies remote D1 migrations.
5. Deploys the Worker with `npx wrangler deploy --config wrangler.production.jsonc`.
6. Sets the Worker secret `INGEST_TOKEN`.
7. Smoke-checks the Cloudflare API for script `m365-barometer`. The public URL is not fetched from GitHub runners. The job fails unless `modified_on` is present and the deployment is under 15 minutes old.

`wrangler.jsonc` keeps a local placeholder database id. Production config is generated in the workflow and is not committed.

Repository secrets named by the workflow:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `INGEST_TOKEN`

Repository variables named by the workflow:

- `CLOUDFLARE_DEPLOY_ENABLED`
- `PUBLIC_BASE_URL`
- `CUSTOM_DOMAIN`

This document does not record whether those are set. Do not commit secret values.

## Cron

`wrangler.jsonc` schedules `15 6 * * *` (06:15 UTC). The scheduled handler calls `runScheduledMonitoring` in `src/worker/automation.ts`. Each step is isolated:

1. Time out analysis runs still `pending`, `dispatched`, `collecting`, or `synthesizing` 30 minutes after `requested_at`. Those runs are marked `failed` with `error_code` `RUN_TIMEOUT`. The product's `next_analysis_at` moves one day later when no newer completed run exists.
2. Delete `source_mentions` and `sentiment_snapshots` older than 12 months, keeping the latest snapshot for each product.
3. Collect weekly supply and demand for the last completed ISO week from Message Center (`https://mc.merill.net/messages-index.json`), the Microsoft 365 Roadmap feed (`https://www.microsoft.com/releasecommunications/api/v1/m365`), Wikipedia pageviews, and Hacker News.

The cron does not collect sentiment evidence. It does not call X, YouTube, or Tech Community. Reddit is not a supply or demand source.

## Internal API and weekly analysis

Every `/api/internal/*` route requires `Authorization: Bearer` with `INGEST_TOKEN`. The contract is [Bot analysis](bot-analysis.md).

Sentiment readings are bot-driven:

1. `GET /api/internal/analysis-runs/due` lists active products whose `next_analysis_at` is null or due.
2. `POST /api/internal/analysis-runs` creates a `pending` run and returns the product query plan. The plan asks for public search results from Reddit, YouTube, Hacker News, GitHub, and the web. Reddit is only evidence from those searches.
3. `POST /api/internal/analysis-runs/:id/start` moves the run to `collecting`.
4. `POST /api/internal/analysis-runs/:id/ingest` sends the evidence. Workers AI classifies it (`AI_MODEL` in `wrangler.jsonc`). Worker code in `src/worker/metrics.ts` computes the 0–100 barometer score, temperature, momentum, confidence, and discussion volume. A successful ingest stores a `sentiment_snapshots` row and sets `next_analysis_at` seven days later.
5. `POST /api/internal/analysis-runs/:id/fail`, an AI scoring failure, or the cron timeout marks the run `failed` and sets `next_analysis_at` one day later.

Weekly supply and demand is separate from that sentiment score. The cron writes Message Center, Roadmap, Wikipedia, and Hacker News rows into `signals`. X counts (demand), YouTube counts (supply), and Tech Community counts are pushed to `POST /api/internal/signals`. `POST /api/internal/signals/backfill` can backfill Wikipedia and Hacker News, up to 26 weeks. A source stays out of the published indexes until that product has 4 weeks of it (`MIN_SOURCE_WEEKS` in `src/worker/signal-catalog.ts`). Supply and demand figures are estimates. The public explanation is `/methodology`.

## Resume checks

```powershell
git fetch origin main
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
npm install
npm run check
```

`npm run check` generates Worker types, typechecks, and runs the test suite.

Confirm deploy state from GitHub Actions rather than from this file. Confirm the live catalog and completed readings from D1 or `GET /api/products`, not from the seed migration.
